/**
 * T07-4 / Spec §5.1 — performance budget for the durable "admitted → prepared → send" audit gate.
 *
 *   cd webui
 *   npx tsx scripts/audit-overhead-bench.mts --run-id t07-4-$(date +%Y%m%d-%H%M) \
 *     [--baseline-ref HEAD] [--latency-sec 20] [--soak-sec 300] [--concurrency 16]
 *
 * What it measures (synthetic project, local upstream stub with a fixed reply, so
 * upstream time is excluded):
 *   - `tools/call` (lucy_read_source) and `resources/read` (governed skill) latency,
 *     p50 / p95 / p99, for this checkout (candidate) and for a baseline build taken
 *     from a git worktree of `--baseline-ref` (default HEAD: the commit before T07).
 *     Extra latency = candidate − baseline, at concurrency 1 and at --concurrency.
 *   - A soak of --soak-sec seconds (default 300) with --concurrency clients on the
 *     candidate, counting HTTP 503 and SQLite BUSY.
 * Budget (Spec §5.1): p95 extra ≤ 20 ms, p99 extra ≤ 50 ms, zero BUSY-caused 503.
 * The script never relaxes `synchronous=FULL`; it records the pragma it observed and
 * exits non-zero when the budget is missed — report that, do not loosen durability.
 *
 * Output: inbox/e2e/<runId>/audit-overhead.json. Exit: 0 pass, 1 budget missed, 2 error.
 */
import { execFileSync, fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const WEBUI_DIR = path.resolve(path.dirname(SELF), "..");
const REPO_ROOT = path.resolve(WEBUI_DIR, "..");

const BUDGET = { p95ExtraMs: 20, p99ExtraMs: 50, busy503: 0 } as const;
const TOKEN = "audit-bench-token";
const INTERNAL_TOKEN = "audit-bench-internal";
const SKILL_URI = "lucy-skill://bench/bench-skill";

type Scenario = "tools/call" | "resources/read";
const SCENARIOS: Scenario[] = ["tools/call", "resources/read"];

// ---------------------------------------------------------------- args

type Args = {
  runId: string;
  baselineRef: string;
  latencySec: number;
  soakSec: number;
  concurrency: number;
  out: string;
};

function parseArgs(argv: string[]): Args & { worker?: { buildDir: string; build: string } } {
  const get = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const num = (name: string, fallback: number): number => {
    const raw = get(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
  const buildDir = get("worker-build-dir");
  return {
    runId: get("run-id") ?? `t07-4-${stamp}`,
    baselineRef: get("baseline-ref") ?? "HEAD",
    latencySec: num("latency-sec", 20),
    soakSec: num("soak-sec", 300),
    concurrency: num("concurrency", 16),
    out: get("out") ?? path.join(REPO_ROOT, "inbox", "e2e"),
    worker: buildDir ? { buildDir, build: get("worker-build") ?? "unknown" } : undefined
  };
}

// ---------------------------------------------------------------- worker (proxy + upstream stub, one process)

const tokenHash = (token: string) => "sha256:" + createHash("sha256").update(token).digest("hex");

async function writeSyntheticProject(root: string): Promise<void> {
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "skills", "domains", "bench"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections:\n  mysql-aliyun:\n    type: mysql\n    database: dataforai\n", "utf8");
  await writeFile(
    path.join(root, "webui", "config", "access.yaml"),
    `roles:
  bench_role:
    description: Synthetic benchmark role
    allow:
      connections: [mysql-aliyun]
      tables: [dataforai.superstore_orders]
      tools: [lucy_catalog, lucy_read_source, lucy_skill_read, lucy_skill_search]
users:
  - id: bench_agent
    name: Bench Agent
    enabled: true
    role: bench_role
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: bench-token
        created: 2026-10-18
`,
    "utf8"
  );
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
    "utf8"
  );
  await writeFile(
    path.join(root, "skills", "domains", "bench", "bench-skill.skill.md"),
    `---
name: bench-skill
title: Synthetic Bench Skill
version: 1.0.0
domain: bench
status: published
roles_allowed: ["bench_role"]
description: Synthetic content for the audit overhead benchmark
---
# Synthetic Bench Skill
${"Synthetic paragraph. ".repeat(40)}
`,
    "utf8"
  );
}

type WorkerReport = {
  securityPragmaSynchronous: number | null;
  busyEvents: number;
  ledgerAppendFailures: number;
  auditWriteFailures: number | null;
};

async function runWorker(buildDir: string): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-bench-"));
  await writeSyntheticProject(root);
  Object.assign(process.env, {
    KTX_PROJECT_ROOT: root,
    LUCY_CONTENT_ROOT: ".",
    LUCY_AUDIT_DB: path.join(root, "audit.sqlite"),
    KTX_INTERNAL_TOKEN: INTERNAL_TOKEN
  });

  const upstream = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "x", result: { content: [{ type: "text", text: "bench-fixed-reply" }] } }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as { port: number }).port);

  const load = (rel: string) => import(pathToFileURL(path.join(buildDir, rel)).href);
  const proxyModule = await load("server/proxy/mcp-proxy.ts");
  const hasGate = existsSync(path.join(buildDir, "server/security/response-commit.ts"));

  // Same wiring as server/index.ts for the candidate: projection runs off the response path.
  let onOperationSettled: (() => void) | undefined;
  let busyEvents = 0;
  let ledgerFailures = 0;
  let readSyncPragma: () => number | null = () => null;
  let readAuditFailures: () => number | null = () => null;
  if (hasGate) {
    const instance = await load("server/security/instance.ts");
    const storeModule = await load("server/security/store.ts");
    const projector = await load("server/security/projector.ts");
    const auditModule = await load("server/admin/audit.ts");
    const health = await load("server/proxy/audit-write-health.ts");
    const scheduler = projector.createProjectionScheduler({
      getStore: instance.getSecurityStore,
      getTarget: auditModule.getAuditDb,
      onStatus: health.recordProjectionStatus
    });
    scheduler.start();
    onOperationSettled = () => scheduler.trigger();
    const proto = storeModule.SecurityStore.prototype;
    const original = proto.appendEvent;
    proto.appendEvent = function patched(this: unknown, input: unknown) {
      const result = original.call(this, input);
      if (!result.ok) {
        ledgerFailures += 1;
        if (result.reason === "busy") busyEvents += 1;
      }
      return result;
    };
    const store = await instance.getSecurityStore();
    if (!store.ok) throw new Error(`security store unavailable: ${store.message}`);
    readSyncPragma = () => {
      // Read-only probe of the same file: synchronous is per connection, so this checks the opener's setting.
      const probe = (store.value as unknown as { db: { pragma: (s: string, o: object) => unknown } }).db;
      return Number(probe.pragma("synchronous", { simple: true }));
    };
    readAuditFailures = () => health.readAuditWriteHealth().failedWrites;
  }

  const { server } = proxyModule.buildProxy(onOperationSettled ? { onOperationSettled } : {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  process.on("message", async (message: { type: string }) => {
    if (message.type !== "report") return;
    const report: WorkerReport = {
      securityPragmaSynchronous: readSyncPragma(),
      busyEvents,
      ledgerAppendFailures: ledgerFailures,
      auditWriteFailures: readAuditFailures()
    };
    process.send?.({ type: "report", report, hasGate });
  });
  process.send?.({ type: "ready", port, hasGate });

  const shutdown = async () => {
    server.closeAllConnections?.();
    upstream.closeAllConnections?.();
    await rm(root, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("disconnect", () => void shutdown());
}

// ---------------------------------------------------------------- load generator (parent)

type Sample = { ms: number; status: number };

function requestFor(scenario: Scenario, seq: number): string {
  return JSON.stringify(
    scenario === "tools/call"
      ? {
          jsonrpc: "2.0",
          id: seq,
          method: "tools/call",
          params: { name: "lucy_read_source", arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" } }
        }
      : { jsonrpc: "2.0", id: seq, method: "resources/read", params: { uri: SKILL_URI } }
  );
}

async function drive(
  port: number,
  scenarios: Scenario[],
  concurrency: number,
  seconds: number,
  warmupMs = 1500
): Promise<{ samples: Map<Scenario, Sample[]>; errors: number }> {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const samples = new Map<Scenario, Sample[]>(scenarios.map((s) => [s, []]));
  let errors = 0;
  const startedAt = performance.now();
  const stopAt = startedAt + seconds * 1000;
  let seq = 0;

  const once = (scenario: Scenario): Promise<Sample> =>
    new Promise((resolve) => {
      const payload = requestFor(scenario, ++seq);
      const began = performance.now();
      const req = http.request(
        {
          agent,
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            accept: "application/json",
            "content-length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ ms: performance.now() - began, status: res.statusCode ?? 0 }));
        }
      );
      req.on("error", () => {
        errors += 1;
        resolve({ ms: performance.now() - began, status: 0 });
      });
      req.end(payload);
    });

  const client = async (index: number) => {
    let turn = index;
    while (performance.now() < stopAt) {
      const scenario = scenarios[turn++ % scenarios.length]!;
      const sample = await once(scenario);
      if (performance.now() - startedAt >= warmupMs) samples.get(scenario)!.push(sample);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, index) => client(index)));
  agent.destroy();
  return { samples, errors };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

function summarize(samples: Sample[]) {
  const ok = samples.filter((s) => s.status === 200).map((s) => s.ms).sort((a, b) => a - b);
  const statusCounts: Record<string, number> = {};
  for (const sample of samples) statusCounts[sample.status] = (statusCounts[sample.status] ?? 0) + 1;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    requests: samples.length,
    okRequests: ok.length,
    statusCounts,
    p50Ms: round(percentile(ok, 50)),
    p95Ms: round(percentile(ok, 95)),
    p99Ms: round(percentile(ok, 99))
  };
}

// ---------------------------------------------------------------- orchestration

function startWorker(buildDir: string, build: string): Promise<{ child: ChildProcess; port: number; hasGate: boolean }> {
  return new Promise((resolve, reject) => {
    const child = fork(SELF, ["--worker-build-dir", buildDir, "--worker-build", build], {
      execArgv: process.execArgv,
      stdio: ["ignore", "ignore", "inherit", "ipc"]
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`worker ${build} exited early (${code})`)));
    child.on("message", (message: { type: string; port?: number; hasGate?: boolean }) => {
      if (message.type === "ready") {
        child.removeAllListeners("exit");
        resolve({ child, port: message.port!, hasGate: Boolean(message.hasGate) });
      }
    });
  });
}

function fetchReport(child: ChildProcess): Promise<{ report: WorkerReport; hasGate: boolean }> {
  return new Promise((resolve) => {
    child.once("message", (message: { type: string; report: WorkerReport; hasGate: boolean }) => {
      if (message.type === "report") resolve({ report: message.report, hasGate: message.hasGate });
    });
    child.send({ type: "report" });
  });
}

async function stopWorker(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

async function prepareBaseline(ref: string): Promise<{ dir: string; sha: string; cleanup: () => void }> {
  const sha = git("rev-parse", ref);
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-bench-baseline-"));
  git("worktree", "add", "--detach", dir, sha);
  const cleanup = () => {
    try {
      git("worktree", "remove", "--force", dir);
    } catch {
      // best effort; `git worktree prune` clears leftovers
    }
  };
  const baselineWebui = path.join(dir, "webui");
  if (existsSync(path.join(baselineWebui, "server/security/response-commit.ts"))) {
    cleanup();
    throw new Error(`baseline ${sha} already contains the T07 response gate; pass --baseline-ref <commit before T07>`);
  }
  await symlink(path.join(WEBUI_DIR, "node_modules"), path.join(baselineWebui, "node_modules"));
  return { dir: baselineWebui, sha, cleanup };
}

type CellResult = ReturnType<typeof summarize>;
type Cell = { scenario: Scenario; concurrency: number; baseline: CellResult; candidate: CellResult; extraMs: { p50: number; p95: number; p99: number }; pass: boolean };

async function measure(build: string, buildDir: string, concurrencies: number[], seconds: number) {
  const worker = await startWorker(buildDir, build);
  try {
    const out = new Map<string, CellResult>();
    for (const concurrency of concurrencies) {
      for (const scenario of SCENARIOS) {
        const run = await drive(worker.port, [scenario], concurrency, seconds);
        out.set(`${scenario}@${concurrency}`, summarize(run.samples.get(scenario)!));
      }
    }
    return out;
  } finally {
    await stopWorker(worker.child);
  }
}

const WORKER_KEEPS_RUNNING = -1;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.worker) {
    await runWorker(args.worker.buildDir);
    return WORKER_KEEPS_RUNNING;
  }
  const outDir = path.join(args.out, args.runId);
  await mkdir(outDir, { recursive: true });
  const concurrencies = [...new Set([1, args.concurrency])];
  const baseline = await prepareBaseline(args.baselineRef);
  // Never leave the baseline worktree behind if the run is interrupted.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      baseline.cleanup();
      process.exit(2);
    });
  }
  let result: Record<string, unknown>;
  try {
    console.log(`[bench] baseline ${baseline.sha}; latency ${args.latencySec}s per cell; soak ${args.soakSec}s @ ${args.concurrency}`);
    const baselineCells = await measure("baseline", baseline.dir, concurrencies, args.latencySec);
    const candidateCells = await measure("candidate", WEBUI_DIR, concurrencies, args.latencySec);

    const cells: Cell[] = [];
    for (const concurrency of concurrencies) {
      for (const scenario of SCENARIOS) {
        const key = `${scenario}@${concurrency}`;
        const b = baselineCells.get(key)!;
        const c = candidateCells.get(key)!;
        const extra = { p50: c.p50Ms - b.p50Ms, p95: c.p95Ms - b.p95Ms, p99: c.p99Ms - b.p99Ms };
        const round = (n: number) => Math.round(n * 1000) / 1000;
        cells.push({
          scenario,
          concurrency,
          baseline: b,
          candidate: c,
          extraMs: { p50: round(extra.p50), p95: round(extra.p95), p99: round(extra.p99) },
          pass: extra.p95 <= BUDGET.p95ExtraMs && extra.p99 <= BUDGET.p99ExtraMs
        });
      }
    }

    // Soak: candidate only, mixed tools/call + resources/read, counting 503 and BUSY.
    console.log("[bench] soak …");
    const soakWorker = await startWorker(WEBUI_DIR, "candidate-soak");
    let soak;
    try {
      const run = await drive(soakWorker.port, SCENARIOS, args.concurrency, args.soakSec);
      const all = SCENARIOS.flatMap((s) => run.samples.get(s)!);
      const { report } = await fetchReport(soakWorker.child);
      const status503 = all.filter((s) => s.status === 503).length;
      soak = {
        concurrency: args.concurrency,
        seconds: args.soakSec,
        ...summarize(all),
        clientErrors: run.errors,
        status503,
        busyEvents: report.busyEvents,
        busy503: report.busyEvents,
        ledgerAppendFailures: report.ledgerAppendFailures,
        auditWriteFailures: report.auditWriteFailures,
        securityPragmaSynchronous: report.securityPragmaSynchronous,
        pass: status503 === 0 && report.busyEvents === 0 && report.securityPragmaSynchronous === 2
      };
    } finally {
      await stopWorker(soakWorker.child);
    }

    const budgetPass = cells.every((cell) => cell.pass) && soak.pass;
    result = {
      runId: args.runId,
      generatedAt: new Date().toISOString(),
      task: "T07-4",
      spec: "enterprise-security-and-real-e2e §5.1 performance budget",
      budget: BUDGET,
      environment: {
        node: process.version,
        platform: `${os.platform()} ${os.arch()}`,
        cpu: os.cpus()[0]?.model,
        cores: os.cpus().length
      },
      candidate: { sha: git("rev-parse", "HEAD"), dirty: git("status", "--porcelain", "--", "webui/server").length > 0 },
      baseline: { ref: args.baselineRef, sha: baseline.sha },
      note: "Extra latency = candidate − baseline, upstream stubbed with a fixed reply. synchronous=FULL is verified, never relaxed.",
      cells,
      soak,
      verdict: budgetPass ? "pass" : "fail"
    };
  } finally {
    baseline.cleanup();
  }
  const file = path.join(outDir, "audit-overhead.json");
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`[bench] wrote ${file}`);
  console.log(`[bench] verdict: ${result.verdict}`);
  return result.verdict === "pass" ? 0 : 1;
}

main().then(
  (code) => {
    if (code !== WORKER_KEEPS_RUNNING) process.exit(code);
  },
  (error) => {
    console.error("[bench] error:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
);
