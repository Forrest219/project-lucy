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
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { FILTER_TRACE_NAMES } from "../tests/performance/entry-performance-observations";
import { parse as parseYaml } from "yaml";
import type { PerfExpected } from "../tests/performance/entry-performance-predicates.ts";
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
  filterNegativeControl?: boolean;
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
  return { phase, mode, scenarios, iterations, warmup, output, baselineDir, skipBuild: argv.includes("--skip-build"), filterNegativeControl: argv.includes("--filter-negative-control") };
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

type BudgetRule = { id: string; scenario: ScenarioName; routes: string[]; metric: string; stat: "p95" | "max"; limit: number };

const PAGE_ROUTES = ["connections", "catalog", "overview", "agents"];

/** Spec 174 §8 budgets; every rule names its routes (never derived from what was measured). */
export const BUDGET_RULES: BudgetRule[] = [
  { id: "PERF-01", scenario: "route-warm", routes: PAGE_ROUTES, metric: "feedbackMs", stat: "p95", limit: 50 },
  { id: "PERF-02", scenario: "route-warm", routes: PAGE_ROUTES, metric: "primaryReadyMs", stat: "p95", limit: 100 },
  { id: "PERF-03", scenario: "route-query-cold", routes: PAGE_ROUTES, metric: "primaryReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-03", scenario: "probe-load", routes: ["catalog", "overview", "agents"], metric: "primaryReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-04", scenario: "browser-cold", routes: ["connections", "catalog", "overview"], metric: "shellReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-04", scenario: "browser-warm-refresh", routes: ["connections", "catalog", "overview"], metric: "shellReadyMs", stat: "p95", limit: 500 },
  { id: "PERF-05", scenario: "browser-cold", routes: PAGE_ROUTES, metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "browser-warm-refresh", routes: PAGE_ROUTES, metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "login-required", routes: ["overview"], metric: "loginToPrimaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "probe-load", routes: ["connections"], metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-05", scenario: "probe-load-slow", routes: ["connections"], metric: "primaryReadyMs", stat: "p95", limit: 800 },
  { id: "PERF-06", scenario: "api-warm", routes: ["sources"], metric: "httpTotalMs", stat: "p95", limit: 100 },
  { id: "PERF-06", scenario: "api-warm", routes: ["agents"], metric: "httpTotalMs", stat: "p95", limit: 200 },
  { id: "PERF-07", scenario: "display-cold", routes: ["sources"], metric: "buildMs", stat: "p95", limit: 500 },
  { id: "PERF-09", scenario: "browser-cold", routes: PAGE_ROUTES, metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "browser-warm-refresh", routes: PAGE_ROUTES, metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "route-warm", routes: [...PAGE_ROUTES, "catalog-filter"], metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "route-query-cold", routes: PAGE_ROUTES, metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "probe-load", routes: PAGE_ROUTES, metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-09", scenario: "probe-load-slow", routes: ["connections"], metric: "cls", stat: "max", limit: 0.05 },
  { id: "PERF-10", scenario: "browser-cold", routes: PAGE_ROUTES, metric: "businessLongTasks", stat: "max", limit: 0 },
  { id: "PERF-10", scenario: "route-warm", routes: [...PAGE_ROUTES, "catalog-filter"], metric: "businessLongTasks", stat: "max", limit: 0 }
];

/**
 * Evaluates the rules for the requested scenarios. A rule cell passes only with
 * ≥minSamples finite values (warm-up excluded), zero failed samples and the
 * original threshold met; missing cells are reported as failing, never skipped.
 */
export function evaluateBudgets(
  summary: Record<string, Record<string, RouteSummary>>,
  options: { scenarios?: readonly string[]; minSamples?: number } = {}
): BudgetResult[] {
  const minSamples = options.minSamples ?? 1;
  const results: BudgetResult[] = [];
  for (const rule of BUDGET_RULES) {
    if (options.scenarios && !options.scenarios.includes(rule.scenario)) continue;
    for (const route of rule.routes) {
      const base = { id: rule.id, scenario: rule.scenario, route, metric: rule.metric, stat: rule.stat, limit: rule.limit };
      const routeSummary = summary[rule.scenario]?.[route];
      if (!routeSummary) {
        results.push({ ...base, actual: null, passed: false, note: "no samples" });
        continue;
      }
      const metric = routeSummary.metrics[rule.metric];
      const actual = metric ? metric[rule.stat] : null;
      const notes: string[] = [];
      if (routeSummary.failures > 0) notes.push(`${routeSummary.failures} failed samples`);
      if (!metric || metric.n < minSamples) notes.push(`n=${metric?.n ?? 0} < ${minSamples}`);
      if (routeSummary.measured !== (metric?.n ?? 0) + routeSummary.failures) notes.push("non-finite metric values");
      const passed = actual !== null && actual <= rule.limit && notes.length === 0;
      results.push({ ...base, actual, passed, ...(notes.length ? { note: notes.join("; ") } : {}) });
    }
  }
  return results;
}

/**
 * Spec 174 §8.1 contract cells: scenario × route × metrics that a formal run must
 * contain. `afterOnly` metrics measure an optimisation the baseline does not have
 * (display snapshot ready time), so they are required in the after phase only.
 */
export const EXPECTED_CELLS: Array<{ scenario: ScenarioName; routes: string[]; metrics: string[]; afterOnly?: string[] }> = [
  { scenario: "api-warm", routes: ["sources", "agents"], metrics: ["httpTotalMs"] },
  { scenario: "display-cold", routes: ["sources", "agents"], metrics: ["buildMs", "httpTotalMs", "displayBuilds"] },
  { scenario: "service-cold", routes: ["sources"], metrics: ["processToSocketMs", "firstSourcesHttpMs"], afterOnly: ["displayReadyMs"] },
  { scenario: "browser-cold", routes: PAGE_ROUTES, metrics: ["shellReadyMs", "primaryReadyMs", "cls", "businessLongTasks"] },
  { scenario: "browser-warm-refresh", routes: PAGE_ROUTES, metrics: ["shellReadyMs", "primaryReadyMs", "cls"] },
  { scenario: "route-warm", routes: PAGE_ROUTES, metrics: ["feedbackMs", "primaryReadyMs", "cls", "businessLongTasks"] },
  { scenario: "route-warm", routes: ["catalog-filter"], metrics: ["filterMs", "cls", "businessLongTasks"] },
  { scenario: "route-query-cold", routes: PAGE_ROUTES, metrics: ["feedbackMs", "primaryReadyMs", "cls"] },
  { scenario: "login-required", routes: ["overview"], metrics: ["passwordSubmitMs", "loginToPrimaryReadyMs", "cls"] },
  { scenario: "probe-load", routes: PAGE_ROUTES, metrics: ["primaryReadyMs", "cls", "healthIntents", "liveIntents", "probeTasksStarted"] },
  { scenario: "probe-load-slow", routes: ["connections"], metrics: ["primaryReadyMs", "cls", "slowProbeDoneMs", "healthIntents", "liveIntents"] }
];

export const FORMAL_MIN_SAMPLES = 30;
export const FORMAL_MIN_WARMUP = 5;
export const MIN_BEHAVIOR_TESTS = 10;

export type BehaviorResult = { exitCode: number; expected: number; unexpected: number; skipped: number; flaky: number } | null;
export type AssetCheck = Record<string, { jsGzip: number; cssGzip: number; samples: number; problems: string[] }>;

export type Acceptance = {
  formal: boolean;
  status: "pass" | "fail" | "incomplete" | "partial";
  reasons: string[];
};

export function isFormalRun(options: Pick<CliOptions, "phase" | "scenarios" | "iterations" | "warmup">): boolean {
  return options.phase === "after"
    && ALL_SCENARIOS.every((scenario) => options.scenarios.includes(scenario))
    && options.iterations >= FORMAL_MIN_SAMPLES
    && options.warmup >= FORMAL_MIN_WARMUP;
}

/** Collection completeness against the enumerated contract (independent of the measured summary). */
export function collectionProblems(
  summary: Record<string, Record<string, RouteSummary>>,
  assets: AssetCheck,
  minSamples: number,
  scenarios: readonly string[] = ALL_SCENARIOS,
  phase: CliOptions["phase"] = "after"
): string[] {
  const problems: string[] = [];
  for (const cell of EXPECTED_CELLS) {
    if (!scenarios.includes(cell.scenario)) continue;
    for (const route of cell.routes) {
      const routeSummary = summary[cell.scenario]?.[route];
      if (!routeSummary) {
        problems.push(`${cell.scenario}/${route}: missing`);
        continue;
      }
      if (routeSummary.failures > 0) problems.push(`${cell.scenario}/${route}: ${routeSummary.failures} failed samples`);
      if (routeSummary.measured < minSamples) problems.push(`${cell.scenario}/${route}: measured ${routeSummary.measured} < ${minSamples}`);
      for (const metric of [...cell.metrics, ...(phase === "after" ? cell.afterOnly ?? [] : [])]) {
        const n = routeSummary.metrics[metric]?.n ?? 0;
        if (n < minSamples || n !== routeSummary.measured - routeSummary.failures) problems.push(`${cell.scenario}/${route}.${metric}: n=${n} (measured ${routeSummary.measured})`);
      }
    }
  }
  if (scenarios.includes("browser-cold")) {
    for (const route of PAGE_ROUTES) {
      const info = assets[route];
      if (!info) problems.push(`PERF-08 ${route}: no JS/CSS resource evidence`);
      else {
        if (info.samples < minSamples) problems.push(`PERF-08 ${route}: ${info.samples} samples with resources < ${minSamples}`);
        problems.push(...info.problems.map((problem) => `PERF-08 ${route}: ${problem}`));
      }
    }
  }
  return problems;
}

export function evaluateAcceptance(input: {
  options: Pick<CliOptions, "phase" | "scenarios" | "iterations" | "warmup">;
  summary: Record<string, Record<string, RouteSummary>>;
  budgets: BudgetResult[];
  assets: AssetCheck;
  behavior: BehaviorResult;
  sampleFailures: number;
  secretOffenders: number;
  filterTraceProblems?: string[] | null;
}): Acceptance {
  const formal = isFormalRun(input.options);
  const minSamples = formal ? FORMAL_MIN_SAMPLES : 1;
  const reasons = collectionProblems(input.summary, input.assets, minSamples, input.options.scenarios, input.options.phase);
  if (input.sampleFailures > 0) reasons.push(`${input.sampleFailures} failed samples`);
  if (input.secretOffenders > 0) reasons.push(`${input.secretOffenders} trace artifacts contain secrets`);
  if (input.options.scenarios.includes("route-warm") && input.options.iterations >= 2) {
    if (input.filterTraceProblems == null) reasons.push("filter trace validation missing");
    else reasons.push(...input.filterTraceProblems);
  }
  const incomplete = reasons.length > 0;
  if (input.options.phase === "after") {
    if (input.budgets.length === 0) reasons.push("no budget evaluated");
    for (const budget of input.budgets) {
      if (!budget.passed) reasons.push(`${budget.id} ${budget.scenario}/${budget.route} ${budget.metric}: ${budget.actual ?? "—"} > ${budget.limit}${budget.note ? ` (${budget.note})` : ""}`);
    }
    if (input.options.scenarios.includes("behavior")) {
      const behavior = input.behavior;
      if (!behavior) reasons.push("behavior not executed");
      else {
        if (behavior.exitCode !== 0) reasons.push(`behavior exit ${behavior.exitCode}`);
        if (behavior.unexpected > 0) reasons.push(`behavior unexpected ${behavior.unexpected}`);
        if (behavior.skipped > 0) reasons.push(`behavior skipped ${behavior.skipped}`);
        if (behavior.flaky > 0) reasons.push(`behavior flaky ${behavior.flaky}`);
        if (behavior.expected < MIN_BEHAVIOR_TESTS) reasons.push(`behavior expected ${behavior.expected} < ${MIN_BEHAVIOR_TESTS}`);
      }
    } else if (formal) {
      reasons.push("behavior not requested");
    }
  }
  const status: Acceptance["status"] = incomplete ? "incomplete" : reasons.length > 0 ? "fail" : formal ? "pass" : "partial";
  return { formal, status, reasons };
}

/** Exit code: baseline only fails on incomplete collection; after exits 0 only for a complete pass (formal) or a clean partial smoke. */
export function exitCodeFor(phase: CliOptions["phase"], acceptance: Acceptance): number {
  if (acceptance.status === "incomplete") return 1;
  if (phase === "baseline") return 0;
  return acceptance.status === "pass" || acceptance.status === "partial" ? 0 : 1;
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

/** A navigation trace cannot substitute for a filter trace: require keyboard and paint events. */
export async function validateFilterTraces(traceDir: string): Promise<string[]> {
  const problems: string[] = [];
  for (const name of FILTER_TRACE_NAMES) {
    const file = `${name}.json`;
    try {
      const trace = JSON.parse(await readFile(path.join(traceDir, file), "utf8"));
      const events = trace?.traceEvents;
      if (!Array.isArray(events) || events.length === 0) {
        problems.push(`${file}: no trace events`);
        continue;
      }
      if (!events.some((event) => event?.name === "EventDispatch" && event?.args?.data?.type === "keydown")) {
        problems.push(`${file}: no keyboard event evidence`);
      }
      if (!events.some((event) => event?.name === "Paint")) problems.push(`${file}: no paint evidence`);
    } catch {
      problems.push(`${file}: missing or invalid JSON`);
    }
  }
  return problems;
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
    LUCY_DEPLOYMENT_MODE: "development",
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

/** probe-load-slow: this connection's health test takes 3 s. */
const SLOW_PROBE_INDEX = 2;

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
  const control = await startControlBridge(server);
  const env: NodeJS.ProcessEnv = {
    ...sanitizedEnv(),
    PERF_RUNNER: "entry-performance",
    PERF_BASE_URL: server.baseUrl,
    PERF_SCENARIO: scenario,
    PERF_FILTER_EARLY_LONG_TASK: options.filterNegativeControl ? "1" : "0",
    PERF_ITERATIONS: String(options.iterations),
    PERF_WARMUP: String(options.warmup),
    PERF_RESULTS_FILE: resultsFile,
    PERF_TRACE_DIR: path.join(runDir, "traces"),
    PERF_ROUTES: routes,
    PERF_PLAYWRIGHT_JSON: path.join(runDir, "raw", `playwright-${scenario}.json`),
    PERF_LOGIN_SECRET_FILE: fixture.paths.loginSecret,
    PERF_FIXTURE_DIR: path.dirname(fixture.paths.projectRoot),
    PERF_CONTROL_URL: control.url,
    PERF_CONTROL_TOKEN: control.token,
    PERF_SLOW_CONNECTION: scenario === "probe-load-slow" ? fixture.connectionIds[SLOW_PROBE_INDEX]! : "",
    PERF_EXPECTED: JSON.stringify(await readFixtureExpectations(fixture))
  };
  const args = ["playwright", "test", "-c", "tests/performance/entry-performance.config.ts", specFile];
  const exitCode = await runCommand("npx", args, { cwd: WEBUI_DIR, env, logPath }).finally(() => control.close());
  commands.push({ command: `PERF_SCENARIO=${scenario} npx ${args.join(" ")}`, exitCode, logPath });
  if (!existsSync(resultsFile)) return [];
  const lines = (await readFile(resultsFile, "utf8")).split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as RawSample);
}

/**
 * Fixture-only control bridge (runner process, loopback, per-run token): lets
 * the Playwright worker ask the fixture server over its IPC pipe to clear the
 * live-schemas success cache. The Lucy server itself exposes no reset endpoint.
 */
async function startControlBridge(server: ServerHandle): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  const token = randomBytes(16).toString("hex");
  const bridge = http.createServer((req, res) => {
    const op = req.url === "/reset-live-cache" ? "reset-live-cache" : null;
    if (req.method !== "POST" || !op || req.headers["x-perf-token"] !== token) {
      res.writeHead(404).end();
      return;
    }
    server.request(op)
      .then((reply) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(reply)))
      .catch((error) => res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: false, error: String(error) })));
  });
  const port = await new Promise<number>((resolve) => bridge.listen(0, "127.0.0.1", () => resolve((bridge.address() as net.AddressInfo).port)));
  return { url: `http://127.0.0.1:${port}`, token, close: () => new Promise((resolve) => bridge.close(() => resolve())) };
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

export type InitialAssets = Record<string, { jsGzip: number; cssGzip: number; jsFiles: string[]; cssFiles: string[]; samples: number; problems: string[] }>;

/**
 * PERF-08: gzip bytes of the JS/CSS a cold route requested before primary-ready.
 * JS and CSS maxima are taken independently over every sample. A sample without
 * resource evidence, or a requested /assets JS/CSS file unknown to the dist
 * listing, is a problem (incomplete evidence), never silently skipped.
 */
export function initialAssetBudget(samples: RawSample[], assets: AssetInfo[]): InitialAssets {
  const byPath = new Map(assets.map((asset) => [asset.path, asset]));
  const out: InitialAssets = {};
  for (const sample of samples) {
    if (sample.scenario !== "browser-cold" || sample.warmup || !sample.ok) continue;
    const current = (out[sample.route] ??= { jsGzip: 0, cssGzip: 0, jsFiles: [], cssFiles: [], samples: 0, problems: [] });
    const resources = sample.metrics.resources as Array<{ path: string }> | undefined;
    if (!Array.isArray(resources)) {
      current.problems.push(`iteration ${sample.iteration}: resources missing`);
      continue;
    }
    const files = [...new Set(resources.map((resource) => resource.path))].filter((file) => /\.(js|css)$/.test(file)).sort();
    const unknown = files.filter((file) => !byPath.has(file));
    if (unknown.length > 0) current.problems.push(`iteration ${sample.iteration}: unknown dist resource ${unknown.join(", ")}`);
    const js = files.filter((file) => file.endsWith(".js"));
    const css = files.filter((file) => file.endsWith(".css"));
    if (js.length === 0) current.problems.push(`iteration ${sample.iteration}: no JS resource`);
    if (css.length === 0) current.problems.push(`iteration ${sample.iteration}: no CSS resource`);
    const jsGzip = js.reduce((sum, file) => sum + (byPath.get(file)?.gzipBytes ?? 0), 0);
    const cssGzip = css.reduce((sum, file) => sum + (byPath.get(file)?.gzipBytes ?? 0), 0);
    current.samples += 1;
    if (jsGzip >= current.jsGzip) {
      current.jsGzip = jsGzip;
      current.jsFiles = js;
    }
    if (cssGzip >= current.cssGzip) {
      current.cssGzip = cssGzip;
      current.cssFiles = css;
    }
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
    // Re-verify the snapshot where it lives now (the run dir may have been copied).
    const recomputed = await computeFixtureContentHash(path.join(baselineClean, "project"));
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

type FixtureTable = { conn: string; schema: string; name: string; columns: string[]; enabled: boolean };

/** Catalog search semantics (Spec 174 §2: unchanged): path + column names, case-insensitive. */
export function catalogSearchMatches(table: FixtureTable, term: string): boolean {
  return `${table.conn}/${table.schema}/${table.name} ${table.columns.join(" ")}`.toLowerCase().includes(term.trim().toLowerCase());
}

/**
 * Spec 174 R6 — primary-ready / filter expectations computed from the fixture
 * files (ktx.yaml, Manifests, fixture manifest), never from the API under test.
 */
export function expectationsFromFixture(input: {
  connections: Array<{ id: string; schemas: string[]; enabledTables: string[] }>;
  tables: FixtureTable[];
  agentIds: string[];
}): PerfExpected {
  const enabled = input.tables.filter((table) => table.enabled);
  const configuredSchemas = input.connections.flatMap((conn) => conn.schemas.map((schema) => `${conn.id}/${schema}`));
  const manifestSchemas = new Set(input.tables.map((table) => `${table.conn}/${table.schema}`));
  const missingManifest = configuredSchemas.filter((schema) => !manifestSchemas.has(schema)).length;
  const paths = input.tables.map((table) => `${table.conn}/${table.schema}/${table.name}`.toLowerCase());
  const columnTerm = [...new Set(enabled.flatMap((table) => table.columns))]
    .filter((column) => !paths.some((p) => p.includes(column.toLowerCase())))
    .map((column) => ({ column, hits: enabled.filter((table) => catalogSearchMatches(table, column)).length }))
    .filter((item) => item.hits >= 2 && item.hits < enabled.length)
    .sort((a, b) => a.column.localeCompare(b.column))[0]?.column;
  const terms = ["sales", ...(columnTerm ? [columnTerm] : [])];
  return {
    connections: input.connections.length,
    tables: input.tables.length,
    enabledTables: enabled.length,
    agents: input.agentIds.length,
    connectionIds: input.connections.map((conn) => conn.id),
    agentIds: input.agentIds,
    enabledTableNames: enabled.map((table) => table.name).sort(),
    connectionMetricValues: [String(input.connections.length), String(missingManifest), String(input.tables.length), String(input.tables.length - enabled.length)],
    schemaCount: configuredSchemas.length,
    catalogConnections: new Set(input.tables.map((table) => table.conn)).size,
    filterCases: terms.map((term) => ({ term, names: enabled.filter((table) => catalogSearchMatches(table, term)).map((table) => table.name).sort() }))
  };
}

export async function readFixtureExpectations(fixture: FixtureManifest): Promise<PerfExpected> {
  const ktx = parseYaml(await readFile(path.join(fixture.paths.projectRoot, "ktx.yaml"), "utf8")) as { connections?: Record<string, { schemas?: string[]; enabled_tables?: string[] }> };
  const connections = Object.entries(ktx.connections ?? {}).map(([id, conn]) => ({ id, schemas: conn.schemas ?? [], enabledTables: conn.enabled_tables ?? [] }));
  const enabledBy = new Map(connections.map((conn) => [conn.id, new Set(conn.enabledTables)]));
  const tables: FixtureTable[] = [];
  const semanticLayer = path.join(fixture.paths.contentRoot, "semantic-layer");
  for (const conn of (await readdir(semanticLayer)).sort()) {
    const schemaDir = path.join(semanticLayer, conn, "_schema");
    if (!existsSync(schemaDir)) continue;
    for (const file of (await readdir(schemaDir)).filter((name) => name.endsWith(".yaml")).sort()) {
      const schema = file.replace(/\.yaml$/, "");
      const doc = parseYaml(await readFile(path.join(schemaDir, file), "utf8")) as { tables?: Record<string, { table?: string; columns?: Array<{ name?: string }> }> };
      for (const [name, table] of Object.entries(doc.tables ?? {})) {
        tables.push({
          conn,
          schema,
          name,
          columns: (table.columns ?? []).map((column) => String(column.name ?? "")).filter(Boolean),
          enabled: enabledBy.get(conn)?.has(String(table.table ?? "")) ?? false
        });
      }
    }
  }
  const expected = expectationsFromFixture({ connections, tables, agentIds: fixture.agents.map((agent) => agent.id) });
  if (expected.tables !== fixture.tableCount || expected.enabledTables !== fixture.enabledTableCount) {
    throw new Error(`fixture expectations (${expected.tables}/${expected.enabledTables}) disagree with the fixture manifest`);
  }
  return expected;
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
        await setStubConfig(warmFixture, ["* 50 ok", `${warmFixture.connectionIds[SLOW_PROBE_INDEX]} 3000 ok test`]);
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

  let behavior: BehaviorResult = null;
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
        skipped: Number(report?.stats?.skipped ?? 0),
        flaky: Number(report?.stats?.flaky ?? 0)
      };
    } finally {
      await server.stop();
    }
  }

  const summary = summarizeSamples(samples);
  const formal = isFormalRun(options);
  const budgets = evaluateBudgets(summary, { scenarios: options.scenarios, minSamples: formal ? FORMAL_MIN_SAMPLES : 1 });
  const initialAssets = initialAssetBudget(samples, assets);
  if (has("browser-cold")) {
    for (const route of PAGE_ROUTES) {
      const info = initialAssets[route];
      const complete = Boolean(info) && info!.problems.length === 0 && info!.samples >= (formal ? FORMAL_MIN_SAMPLES : 1);
      const note = info ? (info.problems.length ? `${info.problems.length} evidence problems` : undefined) : "no samples";
      budgets.push({ id: "PERF-08", scenario: "browser-cold", route, metric: "initialJsGzipBytes", stat: "max", limit: 200 * 1024, actual: info?.jsGzip ?? null, passed: complete && info!.jsGzip <= 200 * 1024, ...(note ? { note } : {}) });
      budgets.push({ id: "PERF-08", scenario: "browser-cold", route, metric: "initialCssGzipBytes", stat: "max", limit: 50 * 1024, actual: info?.cssGzip ?? null, passed: complete && info!.cssGzip <= 50 * 1024, ...(note ? { note } : {}) });
    }
  }
  const sampleFailures = samples.filter((sample) => !sample.ok && !sample.warmup).length;
  const offenders = await scanArtifactsForSecrets(path.join(runDir, "traces"), [readFileSync(warmFixture.paths.loginSecret, "utf8").trim()]);
  const filterTraceProblems = options.scenarios.includes("route-warm") && options.iterations >= 2
    ? await validateFilterTraces(path.join(runDir, "traces")) : [];
  const acceptance = evaluateAcceptance({ options, summary, budgets, assets: initialAssets, behavior, sampleFailures, secretOffenders: offenders.length, filterTraceProblems });

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
    filterNegativeControl: options.filterNegativeControl === true,
    filterTraceProblems,
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
    acceptance,
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
  console.log(`[perf:entry] acceptance: mode=${acceptance.formal ? "formal" : "partial"} status=${acceptance.status}${acceptance.reasons.length ? `\n  - ${acceptance.reasons.join("\n  - ")}` : ""}`);
  return exitCodeFor(options.phase, acceptance);
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
  acceptance: Acceptance;
}): string {
  const lines = [
    `# Entry performance ${results.phase} (${results.runId})`,
    "",
    `commit ${results.sourceCommit}${results.dirty ? " (dirty)" : ""}`,
    "",
    `acceptance: ${results.acceptance.formal ? "formal" : "partial (smoke — not a Spec pass)"} · ${results.acceptance.status}`,
    ...results.acceptance.reasons.map((reason) => `- ${reason}`),
    ""
  ];
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
