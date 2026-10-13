/**
 * Spec 174 T0 — fixture-only production server entry.
 *
 * Started by `entry-performance.mts` through `child_process.fork` so the only
 * control channel is the parent-held IPC pipe. It runs the real Lucy startup
 * sequence (policy commit, catalog scan, Fastify, MCP proxy) against the
 * anonymous fixture and never exposes an HTTP reset/ready endpoint.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const processStartedAt = performance.timeOrigin;

type IpcRequest =
  | { id: number; type: "reset-display" }
  | { id: number; type: "counters" }
  | { id: number; type: "reset-counters" }
  | { id: number; type: "shutdown" };

function fail(message: string): never {
  console.error(`[entry-perf-server] ${message}`);
  process.exit(2);
}

function assertFixtureEnvironment(): string {
  if (typeof process.send !== "function") fail("must be started by the entry-performance runner over IPC");
  const projectRoot = process.env.KTX_PROJECT_ROOT;
  if (!projectRoot) fail("KTX_PROJECT_ROOT is required");
  const fixtureDir = path.dirname(path.resolve(projectRoot));
  if (!existsSync(path.join(fixtureDir, ".lucy-entry-perf-owner"))) {
    fail(`project root ${projectRoot} is not an entry-performance fixture`);
  }
  const accessOverride = process.env.LUCY_ACCESS_CONFIG_PATH;
  if (accessOverride && !path.resolve(accessOverride).startsWith(fixtureDir + path.sep)) {
    fail("LUCY_ACCESS_CONFIG_PATH must point inside the fixture");
  }
  if (process.env.LUCY_PERF_IPC_TOKEN?.length !== 32) fail("missing runner IPC token");
  return fixtureDir;
}

async function main(): Promise<void> {
  assertFixtureEnvironment();
  const ipcToken = process.env.LUCY_PERF_IPC_TOKEN!;
  delete process.env.LUCY_PERF_IPC_TOKEN;
  const displayPrewarm = process.env.LUCY_PERF_DISPLAY_PREWARM !== "0";

  const importStart = performance.now();
  const server = await import("../server/index.ts");
  const timingModule = await import("../server/entry-performance-timing.ts");
  const importMs = performance.now() - importStart;

  let displayModule: {
    resetDisplaySnapshotsForTests?: () => void;
    displaySnapshotDiagnostics?: () => unknown;
  } = {};
  try {
    displayModule = await import("../server/display-snapshot.ts");
  } catch {
    displayModule = {};
  }

  const started = await server.startServer({ displayPrewarm });
  const listenAt = performance.now();

  const send = (message: unknown) => process.send?.(message);
  process.on("message", async (raw: unknown) => {
    const message = raw as IpcRequest & { token?: string };
    if (!message || message.token !== ipcToken) return;
    try {
      if (message.type === "reset-display") {
        const available = typeof displayModule.resetDisplaySnapshotsForTests === "function";
        displayModule.resetDisplaySnapshotsForTests?.();
        timingModule.resetEntryPerfCounters();
        send({ id: message.id, ok: true, displayCacheAvailable: available });
      } else if (message.type === "counters") {
        send({
          id: message.id,
          ok: true,
          counters: timingModule.readEntryPerfCounters(),
          display: displayModule.displaySnapshotDiagnostics?.() ?? null
        });
      } else if (message.type === "reset-counters") {
        timingModule.resetEntryPerfCounters();
        send({ id: message.id, ok: true });
      } else if (message.type === "shutdown") {
        send({ id: message.id, ok: true });
        await started.app.close().catch(() => undefined);
        started.proxy.close();
        process.exit(0);
      }
    } catch (error) {
      send({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  process.on("disconnect", () => process.exit(0));

  send({
    type: "ready",
    port: started.port,
    host: started.host,
    displayCacheAvailable: typeof displayModule.resetDisplaySnapshotsForTests === "function",
    startup: {
      processToImportMs: importStart,
      importMs,
      ...started.timings,
      processToListenMs: listenAt,
      timeOrigin: processStartedAt
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
