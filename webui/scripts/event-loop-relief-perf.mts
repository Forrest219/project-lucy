/**
 * REQ-030-042 — customer-scale event-loop relief (SC-13 / SC-14).
 *
 *   npm --prefix webui run perf:event-loop-relief
 *
 * Does not add worker threads when a bar is missed. The process exits 1 and
 * prints the measured numbers for the O1 decision.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_SCALE, seedAuditScale } from "../tests/performance/fixtures/audit-scale-fixture.ts";

const WEBUI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKOUT_ROOT = path.resolve(WEBUI_DIR, "..");

type Sample = { path: string; ms: number; status: number; busy: boolean };

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

async function timed(base: string, pathname: string): Promise<Sample> {
  const started = performance.now();
  const response = await fetch(`${base}${pathname}`);
  const text = await response.text();
  return {
    path: pathname,
    ms: performance.now() - started,
    status: response.status,
    busy: text.includes("DISPLAY_SNAPSHOT_BUSY")
  };
}

async function waitForMaintainer(readStatus: () => { complete: boolean; pendingUsers: number; lastCompletedAt: string | null }): Promise<void> {
  const deadline = Date.now() + 12 * 60_000;
  let sawWork = false;
  while (Date.now() < deadline) {
    const status = readStatus();
    if (status.pendingUsers > 0 || status.lastCompletedAt) sawWork = true;
    if (sawWork && status.complete) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const status = readStatus();
  throw new Error(`inferred-turn maintainer did not finish: pending=${status.pendingUsers} complete=${status.complete}`);
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-relief-perf-"));
  await writeFile(path.join(dir, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.KTX_PROJECT_ROOT = dir;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
  process.env.LUCY_DEPLOYMENT_MODE = "development";
  process.env.LUCY_CHART_DEPLOYMENT_MODE = "development";
  process.env.LUCY_WEBUI_AUTH = "off";
  delete process.env.LUCY_TURN_REBUILD_ON_READ;
  delete process.env.VITEST;

  const { getAuditDb } = await import("../server/admin/audit.ts");
  const database = await getAuditDb();
  const seededAt = Date.now();
  seedAuditScale(database);
  console.log(`seeded ${AUDIT_SCALE.rows} rows in ${Date.now() - seededAt}ms`);

  const { buildServer } = await import("../server/index.ts");
  const { inferredRebuildStatus } = await import("../server/admin/inferred-turn-maintainer.ts");
  const app = buildServer();
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const maintainStarted = Date.now();
  await waitForMaintainer(inferredRebuildStatus);
  const inferred = database.prepare(`SELECT COUNT(*) AS n FROM inferred_turns`).get() as { n: number };
  console.log(`maintainer complete in ${Date.now() - maintainStarted}ms; inferred_turns=${inferred.n}`);
  if (inferred.n <= 0) throw new Error("maintainer finished without writing inferred turns");

  const turnsPath = "/api/admin/audit/turns?hours=168&source=all";
  const warmup = await timed(base, turnsPath);
  if (warmup.status !== 200) throw new Error(`turns warmup returned ${warmup.status}`);
  const turns: Sample[] = [];
  for (let i = 0; i < 10; i += 1) turns.push(await timed(base, turnsPath));
  const turnsP95 = percentile(turns.map((sample) => sample.ms), 95);

  const overview = ["/api/project", "/api/sources", "/api/admin/agents"];
  const livez: number[] = [];
  let busy = 0;
  const loadDeadline = Date.now() + 60_000;
  const loaders = [
    (async () => {
      while (Date.now() < loadDeadline) {
        const sample = await timed(base, "/api/livez");
        livez.push(sample.ms);
      }
    })(),
    ...[0, 1, 2].map(async () => {
      while (Date.now() < loadDeadline) await timed(base, turnsPath);
    }),
    (async () => {
      while (Date.now() < loadDeadline) await timed(base, "/api/diff");
    })(),
    (async () => {
      while (Date.now() < loadDeadline) {
        for (const pathname of overview) {
          const sample = await timed(base, pathname);
          if (sample.busy) busy += 1;
        }
      }
    })()
  ];
  await Promise.all(loaders);
  const livezMax = livez.reduce((max, value) => Math.max(max, value), 0);
  const livezP99 = percentile(livez, 99);
  const sc13 = turnsP95 <= 3_000;
  const sc14 = livezMax <= 1_000 && livezP99 <= 400 && busy === 0;
  const report = {
    fixture: AUDIT_SCALE,
    sc13: { pass: sc13, turnsP95Ms: Math.round(turnsP95), samples: turns.map((sample) => Math.round(sample.ms)) },
    sc14: { pass: sc14, livezMaxMs: Math.round(livezMax), livezP99Ms: Math.round(livezP99), livezSamples: livez.length, displaySnapshotBusy: busy },
    measuredAt: new Date().toISOString()
  };
  const outDir = path.join(CHECKOUT_ROOT, "inbox");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "event-loop-relief-perf.json");
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  await app.close();
  if (!sc13 || !sc14) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
