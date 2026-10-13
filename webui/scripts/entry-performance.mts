/**
 * Spec 174 §8 / WO T0 — production-build entry performance runner.
 *
 *   npm --prefix webui run perf:entry -- --phase baseline --mode production \
 *     --scenario all --iterations 30 --output inbox/webui-entry-perf/baseline
 *
 * Only the KTX CLI is stubbed. Fastify, YAML/permission parsing, SQLite audit
 * statistics and page rendering run real code against an anonymous fixture.
 */
import { execFileSync, fork, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  computeFixtureContentHash,
  FIXTURE_OWNER_MARKER,
  FIXTURE_SEED,
  fixtureDirBytes,
  generatePerformanceFixture,
  readFixtureManifest,
  type FixtureManifest
} from "./entry-performance-fixture.mts";

export const ALL_SCENARIOS = [
  "api-warm",
  "display-cold",
  "service-cold",
  "browser-cold",
  "browser-warm-refresh",
  "route-warm",
  "route-query-cold",
  "login-required",
  "probe-load",
  "probe-load-slow",
  "behavior"
] as const;
export type ScenarioName = (typeof ALL_SCENARIOS)[number];

const BROWSER_SCENARIOS = new Set<ScenarioName>([
  "browser-cold",
  "browser-warm-refresh",
  "route-warm",
  "route-query-cold",
  "login-required",
  "probe-load",
  "probe-load-slow"
]);

export type CliOptions = {
  phase: "baseline" | "after";
  mode: "production";
  scenarios: ScenarioName[];
  iterations: number;
  warmup: number;
  output: string;
  baselineDir?: string;
  skipBuild: boolean;
};

export function parseCli(argv: string[]): CliOptions {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const phase = get("--phase");
  if (phase !== "baseline" && phase !== "after") throw new Error("--phase baseline|after is required");
  const mode = get("--mode") ?? "production";
  if (mode !== "production") throw new Error("only --mode production is supported (Vite dev is not a valid measurement)");
  const scenarioArg = get("--scenario") ?? "all";
  const scenarios = scenarioArg === "all"
    ? [...ALL_SCENARIOS]
    : scenarioArg.split(",").map((value) => value.trim()).filter(Boolean) as ScenarioName[];
  for (const scenario of scenarios) {
    if (!ALL_SCENARIOS.includes(scenario)) throw new Error(`unknown scenario ${scenario}`);
  }
  const iterations = Number(get("--iterations") ?? "30");
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("--iterations must be a positive integer");
  const warmup = Number(get("--warmup") ?? "5");
  const output = get("--output");
  if (!output) throw new Error("--output is required");
  const baselineDir = get("--baseline-dir");
  if (phase === "after" && !baselineDir) throw new Error("--phase after requires --baseline-dir");
  return { phase, mode, scenarios, iterations, warmup, output, baselineDir, skipBuild: argv.includes("--skip-build") };
}

/** Nearest-rank percentile: sorted[ceil(p*n)-1]. */
export function nearestRank(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1]!;
}

export type MetricSummary = { n: number; p50: number | null; p95: number | null; max: number | null; values: number[] };

export function summarize(values: number[]): MetricSummary {
  return {
    n: values.length,
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    max: values.length ? Math.max(...values) : null,
    values
  };
}

export type RawSample = {
  scenario: string;
  route: string;
  iteration: number;
  warmup: boolean;
  ok: boolean;
  error?: string;
  metrics: Record<string, unknown>;
};

export type RouteSummary = {
  measured: number;
  failures: number;
  warmupFailures: number;
  metrics: Record<string, MetricSummary>;
};

export function summarizeSamples(samples: RawSample[]): Record<string, Record<string, RouteSummary>> {
  const out: Record<string, Record<string, RouteSummary>> = {};
  for (const sample of samples) {
    const byRoute = (out[sample.scenario] ??= {});
    const summary = (byRoute[sample.route] ??= { measured: 0, failures: 0, warmupFailures: 0, metrics: {} });
    if (sample.warmup) {
      if (!sample.ok) summary.warmupFailures += 1;
      continue;
    }
    summary.measured += 1;
    if (!sample.ok) {
      summary.failures += 1;
      continue;
    }
    for (const [name, value] of Object.entries(sample.metrics)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const current = summary.metrics[name] ?? summarize([]);
      summary.metrics[name] = summarize([...current.values, value]);
    }
  }
  return out;
}

export type BudgetResult = {
  id: string;
  scenario: string;
  route: string;
  metric: string;
  stat: "p95" | "max";
  limit: number;
  actual: number | null;
  passed: boolean;
  note?: string;
};

type BudgetRule = { id: string; scenario: string; routes?: string[]; metric: string; stat: "p95" | "max"; limit: number };

export const BUDGET_RULES: BudgetRule[] = [
  { id: "PERF-01", scenario: "route-warm", routes: ["connections", "catalog", "overview", "agents"], metric: "feedbackMs", stat: "p95", limit: 50 },
  { id: "PERF-02", scenario: "route-warm", routes: ["connections", "catalog", "overview", "agents"], metric: "primaryReadyMs", stat: "p95", limit: 100 },
  { id: "PERF-03", scenario: "route-query-cold", metric: "primaryReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-03", scenario: "probe-load", routes: ["catalog", "overview", "agents"], metric: "primaryReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-04", scenario: "browser-cold", routes: ["connections", "catalog", "overview"], metric: "shellReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-04", scenario: "browser-warm-refresh", routes: ["connections", "catalog", "overview"], metric: "shellReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-05", scenario: "browser-cold", metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "browser-warm-refresh", metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "login-required", metric: "loginToPrimaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "probe-load", routes: ["connections"], metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "probe-load-slow", routes: ["connections"], metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-06", scenario: "api-warm", routes: ["sources"], metric: "httpTotalMs", stat: "p95", limit: 100 },
  { id: "PERF-06", scenario: "api-warm", routes: ["agents"], metric: "httpTotalMs", stat: "p95", limit: 200 },
  { id: "PERF-07", scenario: "display-cold", routes: ["sources"], metric: "buildMs", stat: "p95", limit: 500 },
  { id: "PERF-09", scenario: "browser-cold", metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "browser-warm-refresh", metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "route-warm", metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "route-query-cold", metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "probe-load", metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-10", scenario: "browser-cold", metric: "businessLongTasks", stat: "max", limit: 0 },
  { id: "PERF-10", scenario: "route-warm", metric: "businessLongTasks", stat: "max", limit: 0 },
  { id: "PERF-10", scenario: "route-warm", routes: ["catalog-filter"], metric: "businessLongTasks", stat: "max", limit: 0 }
];

export function evaluateBudgets(summary: Record<string, Record<string, RouteSummary>>): BudgetResult[] {
  const results: BudgetResult[] = [];
  for (const rule of BUDGET_RULES) {
    const byRoute = summary[rule.scenario];
    if (!byRoute) continue;
    const routes = rule.routes ?? Object.keys(byRoute).filter((route) => route !== "catalog-filter");
    for (const route of routes) {
      const routeSummary = byRoute[route];
      if (!routeSummary) {
        results.push({ id: rule.id, scenario: rule.scenario, route, metric: rule.metric, stat: rule.stat, limit: rule.limit, actual: null, passed: false, note: "no samples" });
        continue;
      }
      const metric = routeSummary.metrics[rule.metric];
      const actual = metric ? metric[rule.stat] : null;
      const passed = actual !== null && actual <= rule.limit && routeSummary.failures === 0;
      results.push({
        id: rule.id,
        scenario: rule.scenario,
        route,
        metric: rule.metric,
        stat: rule.stat,
        limit: rule.limit,
        actual,
        passed,
        ...(routeSummary.failures > 0 ? { note: `${routeSummary.failures} failed samples` } : {})
      });
    }
  }
  return results;
}

/** Long tasks ≥50 ms attributed to the main frame (or unattributed) count as business tasks. */
export function classifyLongTasks(tasks: Array<{ duration: number; container: string | null }>): { business: number; other: number } {
  let business = 0;
  let other = 0;
  for (const task of tasks) {
    if (task.duration < 50) continue;
    if (task.container === null || task.container === "window") business += 1;
    else other += 1;
  }
  return { business, other };
}

// ─── runtime helpers ────────────────────────────────────────────────────────

const WEBUI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKOUT_ROOT = path.resolve(WEBUI_DIR, "..");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

type ServerHandle = {
  child: ChildProcess;
  baseUrl: string;
  ready: { startup: Record<string, number | null>; displayCacheAvailable: boolean };
  forkToReadyMs: number;
  request: (type: string) => Promise<Record<string, unknown>>;
  stop: () => Promise<void>;
};

type ServerOptions = {
  fixture: FixtureManifest;
  runDir: string;
  label: string;
  auth: "off" | "required";
  displayPrewarm: boolean;
};

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("LUCY_") || key.startsWith("KTX_") || key.startsWith("PERF_")) continue;
    env[key] = value;
  }
  return env;
}

async function startFixtureServer(options: ServerOptions): Promise<ServerHandle> {
  const port = await freePort();
  const proxyPort = await freePort();
  const upstreamPort = await freePort(); // intentionally closed: no KTX daemon is contacted
  const token = randomBytes(16).toString("hex");
  const fixtureDir = path.dirname(options.fixture.paths.projectRoot);
  const logPath = path.join(options.runDir, "logs", `server-${options.label}.log`);
  await mkdir(path.dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  const env: NodeJS.ProcessEnv = {
    ...sanitizedEnv(),
    NODE_ENV: "production",
    PATH: `${options.fixture.paths.stubBin}${path.delimiter}${process.env.PATH ?? ""}`,
    KTX_PROJECT_ROOT: options.fixture.paths.projectRoot,
    LUCY_CONTENT_ROOT: options.fixture.paths.contentRoot,
    LUCY_WEBUI_DIST_DIR: path.join(WEBUI_DIR, "dist"),
    LUCY_WEBUI_HOST: "127.0.0.1",
    LUCY_WEBUI_PORT: String(port),
    LUCY_PROXY_HOST: "127.0.0.1",
    LUCY_PROXY_PORT: String(proxyPort),
    LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1",
    LUCY_PROXY_UPSTREAM_PORT: String(upstreamPort),
    LUCY_MCP_RUNTIME_PROBE_TIMEOUT_MS: "300",
    LUCY_PUBLIC_MCP_URL: `http://127.0.0.1:${proxyPort}/mcp`,
    LUCY_AUDIT_DB: options.fixture.paths.auditDb,
    LUCY_AUDIT_COLD_DIR: path.join(fixtureDir, "audit-cold"),
    LUCY_EVAL_DB: path.join(fixtureDir, "eval.sqlite"),
    LUCY_WEBUI_AUTH: options.auth,
    LUCY_ADMINS_CONFIG_PATH: options.auth === "required" ? options.fixture.paths.adminsPath : path.join(fixtureDir, "auth", "no-admins.yaml"),
    LUCY_WEBUI_SESSION_SECRET: randomBytes(24).toString("hex"),
    LUCY_PERF_STUB_CONFIG: options.fixture.paths.stubConfig,
    LUCY_PERF_STUB_LOG: options.fixture.paths.stubLog,
    LUCY_PERF_IPC_TOKEN: token,
    LUCY_PERF_DISPLAY_PREWARM: options.displayPrewarm ? "1" : "0",
    POSTHOG_DISABLED: "1"
  };
  const forkStart = performance.now();
  const child = fork(path.join(WEBUI_DIR, "scripts", "entry-performance-server.mts"), [], {
    cwd: WEBUI_DIR,
    env,
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", logFd, logFd, "ipc"]
  });
  closeSync(logFd);
  let nextId = 1;
  const pending = new Map<number, (value: Record<string, unknown>) => void>();
  const ready = await new Promise<{ port: number; startup: Record<string, number | null>; displayCacheAvailable: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture server ${options.label} did not become ready (see ${logPath})`)), 60_000);
    child.on("message", (raw) => {
      const message = raw as Record<string, unknown>;
      if (message.type === "ready") {
        clearTimeout(timer);
        resolve(message as never);
        return;
      }
      const id = Number(message.id);
      pending.get(id)?.(message);
      pending.delete(id);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture server ${options.label} exited early (${code}); see ${logPath}`));
    });
  });
  const forkToReadyMs = performance.now() - forkStart;
  if (ready.port !== port) throw new Error(`fixture server bound unexpected port ${ready.port}`);
  const request = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`IPC ${type} timed out`)), 15_000);
    pending.set(id, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
    child.send({ id, type, token });
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      await request("shutdown");
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  };
  return { child, baseUrl: `http://127.0.0.1:${port}`, ready, forkToReadyMs, request, stop };
}

function parseServerTiming(header: string | null): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  if (!header) return out;
  for (const part of header.split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    for (const param of params) {
      const [key, value] = param.split("=");
      if (key === "dur") out[name] = Number(value);
      if (key === "desc") out[name] = value ?? "";
    }
  }
  return out;
}

async function timedFetch(url: string): Promise<{ totalMs: number; status: number; bytes: number; serverTiming: Record<string, number | string> }> {
  const start = performance.now();
  const response = await fetch(url);
  const body = await response.arrayBuffer();
  const totalMs = performance.now() - start;
  return { totalMs, status: response.status, bytes: body.byteLength, serverTiming: parseServerTiming(response.headers.get("server-timing")) };
}

const API_ENDPOINTS: Record<string, string> = { sources: "/api/sources", agents: "/api/admin/agents" };

async function runApiWarm(server: ServerHandle, options: CliOptions): Promise<RawSample[]> {
  const samples: RawSample[] = [];
  for (const [route, endpoint] of Object.entries(API_ENDPOINTS)) {
    for (let i = 0; i < options.warmup + options.iterations; i += 1) {
      const warmup = i < options.warmup;
      try {
        const result = await timedFetch(`${server.baseUrl}${endpoint}`);
        if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
        samples.push({
          scenario: "api-warm",
          route,
          iteration: i,
          warmup,
          ok: true,
          metrics: {
            httpTotalMs: result.totalMs,
            serverTotalMs: Number(result.serverTiming.total ?? NaN),
            bytes: result.bytes,
            cache: String(result.serverTiming.cache ?? "none")
          }
        });
      } catch (error) {
        samples.push({ scenario: "api-warm", route, iteration: i, warmup, ok: false, error: String(error), metrics: {} });
      }
    }
  }
  return samples;
}

async function runDisplayCold(server: ServerHandle, options: CliOptions): Promise<RawSample[]> {
  const samples: RawSample[] = [];
  for (const [route, endpoint] of Object.entries(API_ENDPOINTS)) {
    for (let i = 0; i < options.warmup + options.iterations; i += 1) {
      const warmup = i < options.warmup;
      try {
        const reset = await server.request("reset-display");
        if (!reset.ok) throw new Error(`reset failed: ${String(reset.error)}`);
        const before = await server.request("counters");
        const beforeCounters = before.counters as Record<string, number>;
        if (beforeCounters.displayBuilds !== 0) throw new Error("display build counter did not reset to 0");
        const result = await timedFetch(`${server.baseUrl}${endpoint}`);
        if (result.status !== 200) throw new Error(`HTTP ${result.status}`);
        const after = (await server.request("counters")).counters as Record<string, number>;
        const cacheState = String(result.serverTiming.cache ?? "none");
        if (cacheState === "hit") throw new Error("cold sample served from display cache");
        samples.push({
          scenario: "display-cold",
          route,
          iteration: i,
          warmup,
          ok: true,
          metrics: {
            buildMs: Number(result.serverTiming.total ?? NaN),
            httpTotalMs: result.totalMs,
            cache: cacheState,
            displayCacheAvailable: Boolean(reset.displayCacheAvailable),
            displayBuilds: after.displayBuilds,
            manifestParses: after.manifestParses,
            overlayReads: after.overlayReads,
            sourceMapBuilds: after.sourceMapBuilds,
            accessReads: after.accessReads,
            enabledTableReads: after.enabledTableReads
          }
        });
      } catch (error) {
        samples.push({ scenario: "display-cold", route, iteration: i, warmup, ok: false, error: String(error), metrics: {} });
      }
    }
  }
  return samples;
}

async function runServiceCold(fixture: FixtureManifest, runDir: string, options: CliOptions): Promise<RawSample[]> {
  const samples: RawSample[] = [];
  for (let i = 0; i < options.warmup + options.iterations; i += 1) {
    const warmup = i < options.warmup;
    let server: ServerHandle | undefined;
    try {
      server = await startFixtureServer({ fixture, runDir, label: `service-cold`, auth: "off", displayPrewarm: true });
      const first = await timedFetch(`${server.baseUrl}/api/sources`);
      const counters = (await server.request("counters")).counters as Record<string, number>;
      const startup = server.ready.startup;
      samples.push({
        scenario: "service-cold",
        route: "sources",
        iteration: i,
        warmup,
        ok: first.status === 200,
        metrics: {
          processToSocketMs: server.forkToReadyMs,
          policyMs: Number(startup.policyMs ?? NaN),
          catalogScanMs: Number(startup.catalogScanMs ?? NaN),
          displayReadyMs: startup.displayReadyMs === null ? NaN : Number(startup.displayReadyMs),
          firstSourcesHttpMs: first.totalMs,
          firstSourcesServerMs: Number(first.serverTiming.total ?? NaN),
          firstSourcesCache: String(first.serverTiming.cache ?? "none"),
          manifestParses: counters.manifestParses,
          sourceMapBuilds: counters.sourceMapBuilds
        }
      });
    } catch (error) {
      samples.push({ scenario: "service-cold", route: "sources", iteration: i, warmup, ok: false, error: String(error), metrics: {} });
    } finally {
      await server?.stop();
    }
  }
  return samples;
}

function runCommand(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; logPath: string }): Promise<number> {
  return new Promise((resolve) => {
    const fd = openSync(options.logPath, "a");
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ["ignore", fd, fd] });
    child.on("exit", (code) => {
      closeSync(fd);
      resolve(code ?? 1);
    });
  });
}

type CommandRecord = { command: string; exitCode: number; logPath: string };

async function runPlaywright(
  server: ServerHandle,
  fixture: FixtureManifest,
  runDir: string,
  scenario: string,
  options: CliOptions,
  commands: CommandRecord[],
  specFile = "tests/performance/entry-performance.spec.ts",
  routes = "connections,catalog,overview,agents"
): Promise<RawSample[]> {
  const resultsFile = path.join(runDir, "raw", `${scenario}.jsonl`);
  await mkdir(path.dirname(resultsFile), { recursive: true });
  const logPath = path.join(runDir, "logs", `playwright-${scenario}.log`);
  const env: NodeJS.ProcessEnv = {
    ...sanitizedEnv(),
    PERF_RUNNER: "entry-performance",
    PERF_BASE_URL: server.baseUrl,
    PERF_SCENARIO: scenario,
    PERF_ITERATIONS: String(options.iterations),
    PERF_WARMUP: String(options.warmup),
    PERF_RESULTS_FILE: resultsFile,
    PERF_TRACE_DIR: path.join(runDir, "traces"),
    PERF_ROUTES: routes,
    PERF_PLAYWRIGHT_JSON: path.join(runDir, "raw", `playwright-${scenario}.json`),
    PERF_LOGIN_SECRET_FILE: fixture.paths.loginSecret,
    PERF_FIXTURE_DIR: path.dirname(fixture.paths.projectRoot),
    PERF_EXPECTED: JSON.stringify({
      connections: fixture.connectionIds.length,
      tables: fixture.tableCount,
      enabledTables: fixture.enabledTableCount,
      agents: fixture.agents.length,
      connectionIds: fixture.connectionIds
    })
  };
  const args = ["playwright", "test", "-c", "tests/performance/entry-performance.config.ts", specFile];
  const exitCode = await runCommand("npx", args, { cwd: WEBUI_DIR, env, logPath });
  commands.push({ command: `PERF_SCENARIO=${scenario} npx ${args.join(" ")}`, exitCode, logPath });
  if (!existsSync(resultsFile)) return [];
  const lines = (await readFile(resultsFile, "utf8")).split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as RawSample);
}

function postProcessBrowserSample(sample: RawSample): RawSample {
  const tasks = sample.metrics.longTasks as Array<{ duration: number; container: string | null }> | undefined;
  if (Array.isArray(tasks)) {
    const classified = classifyLongTasks(tasks);
    sample.metrics.businessLongTasks = classified.business;
    sample.metrics.otherLongTasks = classified.other;
  }
  return sample;
}

type AssetInfo = { path: string; bytes: number; gzipBytes: number; brBytes?: number };

async function listDistAssets(): Promise<AssetInfo[]> {
  const assetsDir = path.join(WEBUI_DIR, "dist", "assets");
  const entries = await readdir(assetsDir).catch(() => [] as string[]);
  const out: AssetInfo[] = [];
  for (const name of entries.sort()) {
    if (!/\.(js|css)$/.test(name)) continue;
    const raw = readFileSync(path.join(assetsDir, name));
    out.push({ path: `/assets/${name}`, bytes: raw.byteLength, gzipBytes: gzipSync(raw).byteLength });
  }
  return out;
}

/** PERF-08: gzip bytes of the JS/CSS a cold route actually requested before primary-ready. */
export function initialAssetBudget(samples: RawSample[], assets: AssetInfo[]): Record<string, { jsGzip: number; cssGzip: number; files: string[] }> {
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const out: Record<string, { jsGzip: number; cssGzip: number; files: string[] }> = {};
  for (const sample of samples) {
    if (sample.scenario !== "browser-cold" || sample.warmup || !sample.ok) continue;
    const resources = sample.metrics.resources as Array<{ path: string }> | undefined;
    if (!Array.isArray(resources)) continue;
    const files = [...new Set(resources.map((resource) => resource.path))].filter((file) => byPath.has(file)).sort();
    const jsGzip = files.filter((file) => file.endsWith(".js")).reduce((sum, file) => sum + (byPath.get(file)?.gzipBytes ?? 0), 0);
    const cssGzip = files.filter((file) => file.endsWith(".css")).reduce((sum, file) => sum + (byPath.get(file)?.gzipBytes ?? 0), 0);
    const current = out[sample.route];
    if (!current || jsGzip + cssGzip > current.jsGzip + current.cssGzip) out[sample.route] = { jsGzip, cssGzip, files };
  }
  return out;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: CHECKOUT_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch {
    return "";
  }
}

function chromiumVersion(): string {
  try {
    const out = execFileSync("npx", ["playwright", "--version"], { cwd: WEBUI_DIR, encoding: "utf8" }).trim();
    return out;
  } catch {
    return "unknown";
  }
}

function environmentInfo() {
  const cpus = os.cpus();
  return {
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpuModel: cpus[0]?.model ?? "unknown",
    cpuCount: cpus.length,
    totalMemBytes: os.totalmem(),
    node: process.version,
    playwright: chromiumVersion(),
    viewport: "1440x900",
    throttling: "none",
    network: "HTTP loopback 127.0.0.1"
  };
}

/** HAR/trace sanitisation guard: traces must not carry auth headers or the fixture password. */
async function scanArtifactsForSecrets(dir: string, secrets: string[]): Promise<string[]> {
  const offenders: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      offenders.push(...await scanArtifactsForSecrets(abs, secrets));
      continue;
    }
    const text = await readFile(abs, "utf8").catch(() => "");
    if (/"(cookie|authorization)"\s*:/i.test(text) || secrets.some((secret) => secret && text.includes(secret))) {
      offenders.push(abs);
    }
  }
  return offenders;
}

async function prepareFixture(options: CliOptions, runDir: string): Promise<{ manifest: FixtureManifest; cleanDir: string }> {
  const cleanDir = path.join(runDir, "fixture-clean");
  if (options.phase === "baseline") {
    await generatePerformanceFixture({ outDir: cleanDir, seed: FIXTURE_SEED, checkoutRoot: CHECKOUT_ROOT });
  } else {
    const baselineDir = path.resolve(CHECKOUT_ROOT, options.baselineDir!);
    const baselineClean = path.join(baselineDir, "fixture-clean");
    const baselineManifest = await readFixtureManifest(baselineClean);
    const recomputed = await computeFixtureContentHash(baselineManifest.paths.projectRoot);
    if (recomputed !== baselineManifest.contentHash) {
      throw new Error("baseline fixture-clean snapshot was modified; refusing to reuse it");
    }
    await cp(baselineClean, cleanDir, { recursive: true });
  }
  const cleanManifest = await readFixtureManifest(cleanDir);
  return { manifest: cleanManifest, cleanDir };
}

/** Copy the clean snapshot to a working dir and rebase the manifest paths. */
async function workingFixture(cleanDir: string, targetDir: string): Promise<FixtureManifest> {
  await cp(cleanDir, targetDir, { recursive: true });
  const manifest = await readFixtureManifest(cleanDir);
  const from = path.dirname(manifest.paths.projectRoot);
  const rebase = (p: string) => path.join(targetDir, path.relative(from, p));
  const paths = Object.fromEntries(Object.entries(manifest.paths).map(([key, value]) => [key, rebase(value)])) as FixtureManifest["paths"];
  const rebased = { ...manifest, paths };
  await writeFile(path.join(targetDir, "fixture-manifest.json"), `${JSON.stringify(rebased, null, 2)}\n`, "utf8");
  return rebased;
}

async function setStubConfig(fixture: FixtureManifest, lines: string[]): Promise<void> {
  await writeFile(fixture.paths.stubConfig, `# connId delayMs mode [kind]\n${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<number> {
  const options = parseCli(process.argv.slice(2));
  const runDir = path.resolve(CHECKOUT_ROOT, options.output);
  const inboxRoot = path.join(CHECKOUT_ROOT, "inbox", "webui-entry-perf");
  if (!runDir.startsWith(inboxRoot + path.sep)) throw new Error(`--output must be under inbox/webui-entry-perf/: ${runDir}`);
  if (existsSync(runDir)) throw new Error(`output ${runDir} already exists; use a new run directory`);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, FIXTURE_OWNER_MARKER), "lucy-entry-performance\n", "utf8");
  const runId = `${options.phase}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const commands: CommandRecord[] = [];
  const startedAt = new Date().toISOString();
  const env = environmentInfo();
  const diff = git(["diff", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", "webui", "docs"]);

  const { manifest: cleanManifest, cleanDir } = await prepareFixture(options, runDir);
  if (options.phase === "after") {
    const baselineResults = JSON.parse(await readFile(path.join(path.resolve(CHECKOUT_ROOT, options.baselineDir!), "results.json"), "utf8"));
    const mismatches: string[] = [];
    if (baselineResults.fixture.contentHash !== cleanManifest.contentHash) mismatches.push("fixture hash");
    if (baselineResults.fixture.seed !== cleanManifest.seed) mismatches.push("seed");
    if (baselineResults.fixture.anchorIso !== cleanManifest.anchorIso) mismatches.push("anchor");
    for (const key of ["cpuModel", "cpuCount", "totalMemBytes", "node", "playwright"] as const) {
      if (baselineResults.environment[key] !== env[key]) mismatches.push(`environment.${key}`);
    }
    if (mismatches.length > 0) throw new Error(`after run does not match baseline conditions: ${mismatches.join(", ")}`);
  }

  if (!options.skipBuild) {
    const logPath = path.join(runDir, "logs", "build.log");
    await mkdir(path.dirname(logPath), { recursive: true });
    const exitCode = await runCommand("npm", ["run", "build"], { cwd: WEBUI_DIR, logPath });
    commands.push({ command: "npm run build", exitCode, logPath });
    if (exitCode !== 0) throw new Error(`production build failed; see ${logPath}`);
  }
  const assets = await listDistAssets();
  const samples: RawSample[] = [];
  const has = (name: ScenarioName) => options.scenarios.includes(name);

  const warmFixture = await workingFixture(cleanDir, path.join(runDir, "fixture"));
  const warmScenarios = ["api-warm", "browser-cold", "browser-warm-refresh", "route-warm", "route-query-cold", "probe-load", "probe-load-slow"] as const;
  if (warmScenarios.some((name) => has(name))) {
    const server = await startFixtureServer({ fixture: warmFixture, runDir, label: "warm", auth: "off", displayPrewarm: true });
    try {
      if (has("api-warm")) samples.push(...await runApiWarm(server, options));
      for (const scenario of ["browser-cold", "browser-warm-refresh", "route-warm", "route-query-cold", "probe-load"] as const) {
        if (!has(scenario)) continue;
        await setStubConfig(warmFixture, ["* 50 ok"]);
        samples.push(...(await runPlaywright(server, warmFixture, runDir, scenario, options, commands)).map(postProcessBrowserSample));
      }
      if (has("probe-load-slow")) {
        await setStubConfig(warmFixture, ["* 50 ok", `${warmFixture.connectionIds[2]} 3000 ok test`]);
        samples.push(...(await runPlaywright(server, warmFixture, runDir, "probe-load-slow", options, commands, undefined, "connections")).map(postProcessBrowserSample));
        await setStubConfig(warmFixture, ["* 50 ok"]);
      }
    } finally {
      await server.stop();
    }
  }

  if (has("display-cold")) {
    const server = await startFixtureServer({ fixture: warmFixture, runDir, label: "display-cold", auth: "off", displayPrewarm: false });
    try {
      samples.push(...await runDisplayCold(server, options));
    } finally {
      await server.stop();
    }
  }

  if (has("service-cold")) samples.push(...await runServiceCold(warmFixture, runDir, options));

  if (has("login-required")) {
    const server = await startFixtureServer({ fixture: warmFixture, runDir, label: "login", auth: "required", displayPrewarm: true });
    try {
      samples.push(...(await runPlaywright(server, warmFixture, runDir, "login-required", options, commands, undefined, "overview")).map(postProcessBrowserSample));
    } finally {
      await server.stop();
    }
  }

  let behavior: { exitCode: number; expected: number; unexpected: number; skipped: number } | null = null;
  if (has("behavior")) {
    const behaviorFixture = await workingFixture(cleanDir, path.join(runDir, "fixture-behavior"));
    const server = await startFixtureServer({ fixture: behaviorFixture, runDir, label: "behavior", auth: "off", displayPrewarm: true });
    try {
      await runPlaywright(server, behaviorFixture, runDir, "behavior", options, commands, "tests/e2e/specs/entry-performance-behavior.spec.ts");
      const record = commands[commands.length - 1]!;
      const reportPath = path.join(runDir, "raw", "playwright-behavior.json");
      const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : null;
      behavior = {
        exitCode: record.exitCode,
        expected: Number(report?.stats?.expected ?? 0),
        unexpected: Number(report?.stats?.unexpected ?? 0),
        skipped: Number(report?.stats?.skipped ?? 0)
      };
    } finally {
      await server.stop();
    }
  }

  const summary = summarizeSamples(samples);
  const budgets = evaluateBudgets(summary);
  const initialAssets = initialAssetBudget(samples, assets);
  for (const [route, info] of Object.entries(initialAssets)) {
    budgets.push({ id: "PERF-08", scenario: "browser-cold", route, metric: "initialJsGzipBytes", stat: "max", limit: 200 * 1024, actual: info.jsGzip, passed: info.jsGzip <= 200 * 1024 });
    budgets.push({ id: "PERF-08", scenario: "browser-cold", route, metric: "initialCssGzipBytes", stat: "max", limit: 50 * 1024, actual: info.cssGzip, passed: info.cssGzip <= 50 * 1024 });
  }
  const sampleFailures = samples.filter((sample) => !sample.ok && !sample.warmup).length;
  const offenders = await scanArtifactsForSecrets(path.join(runDir, "traces"), [readFileSync(warmFixture.paths.loginSecret, "utf8").trim()]);

  const results = {
    runId,
    phase: options.phase,
    mode: options.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceCommit: git(["rev-parse", "HEAD"]),
    dirty: diff.length > 0 || untracked.length > 0,
    dirtyDiffDigest: createHash("sha256").update(diff).update("\0").update(untracked).digest("hex"),
    environment: env,
    iterations: options.iterations,
    warmup: options.warmup,
    scenarios: options.scenarios,
    fixture: {
      seed: cleanManifest.seed,
      anchorIso: cleanManifest.anchorIso,
      contentHash: cleanManifest.contentHash,
      auditInputDigest: cleanManifest.auditInputDigest,
      shape: cleanManifest.shape,
      tableCount: cleanManifest.tableCount,
      columnCount: cleanManifest.columnCount,
      totalManifestBytes: cleanManifest.totalManifestBytes,
      manifestBytes: cleanManifest.manifestBytes,
      fixtureBytes: await fixtureDirBytes(cleanDir)
    },
    build: { assets },
    initialAssets,
    summary,
    budgets,
    behavior,
    sampleFailures,
    traceSecretOffenders: offenders,
    commands,
    artifacts: { raw: path.join(runDir, "raw"), traces: path.join(runDir, "traces"), logs: path.join(runDir, "logs") }
  };
  await writeFile(path.join(runDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "samples.json"), `${JSON.stringify(samples)}\n`, "utf8");
  await writeFile(path.join(runDir, "summary.md"), renderSummary(results), "utf8");
  await rm(path.join(runDir, "fixture"), { recursive: true, force: true });

  console.log(`[perf:entry] results: ${path.join(runDir, "results.json")}`);
  const collectionFailed = sampleFailures > 0 || offenders.length > 0;
  if (options.phase === "baseline") return collectionFailed ? 1 : 0;
  const budgetFailed = budgets.some((budget) => !budget.passed);
  const behaviorFailed = behavior !== null && (behavior.exitCode !== 0 || behavior.unexpected > 0);
  return collectionFailed || budgetFailed || behaviorFailed ? 1 : 0;
}

function fmt(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function renderSummary(results: {
  phase: string;
  runId: string;
  sourceCommit: string;
  dirty: boolean;
  summary: Record<string, Record<string, RouteSummary>>;
  budgets: BudgetResult[];
  behavior: unknown;
}): string {
  const lines = [`# Entry performance ${results.phase} (${results.runId})`, "", `commit ${results.sourceCommit}${results.dirty ? " (dirty)" : ""}`, ""];
  lines.push("| scenario | route | metric | n | P50 | P95 | max | failures |", "|---|---|---|---:|---:|---:|---:|---:|");
  for (const [scenario, byRoute] of Object.entries(results.summary)) {
    for (const [route, summary] of Object.entries(byRoute)) {
      for (const [metric, stats] of Object.entries(summary.metrics)) {
        if (["bytes"].includes(metric)) continue;
        lines.push(`| ${scenario} | ${route} | ${metric} | ${stats.n} | ${fmt(stats.p50, 2)} | ${fmt(stats.p95, 2)} | ${fmt(stats.max, 2)} | ${summary.failures} |`);
      }
      if (Object.keys(summary.metrics).length === 0) lines.push(`| ${scenario} | ${route} | — | 0 | — | — | — | ${summary.failures} |`);
    }
  }
  lines.push("", "| budget | scenario | route | metric | stat | limit | actual | pass |", "|---|---|---|---|---|---:|---:|---|");
  for (const budget of results.budgets) {
    lines.push(`| ${budget.id} | ${budget.scenario} | ${budget.route} | ${budget.metric} | ${budget.stat} | ${budget.limit} | ${fmt(budget.actual, 3)} | ${budget.passed ? "yes" : "NO"}${budget.note ? ` (${budget.note})` : ""} |`);
  }
  lines.push("", `behavior: ${JSON.stringify(results.behavior)}`, "");
  return `${lines.join("\n")}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
