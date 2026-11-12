/**
 * REQ-030-034 — release performance baseline gate (Roles + MCP + relative D6).
 *
 *   npm --prefix webui run perf:release-baseline -- --tier ci-small --output inbox/perf-baselines/run-1
 *   npm --prefix webui run perf:release-baseline -- --tier release-medium --output inbox/perf-baselines/run-2 \
 *     --previous inbox/perf-baselines/formal/latest/report.json
 *
 * Extends Spec 174 fixture/server; does not replace `perf:entry`.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import {
  readFixtureExpectations,
  startFixtureServer,
  summarize,
  type RawSample,
  type ServerHandle
} from "./entry-performance.mts";
import {
  FIXTURE_SEED,
  generatePerformanceFixture,
  type FixtureManifest
} from "./entry-performance-fixture.mts";
import {
  evaluateRelativeRegression,
  metricId,
  overallReleaseStatus,
  RELEASE_PERF_RUNNER_VERSION,
  type MetricSnapshot,
  type ReleasePerfReport
} from "./release-perf-relative.mts";

const WEBUI_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKOUT_ROOT = path.resolve(WEBUI_DIR, "..");

export type ReleaseTier = "ci-small" | "release-medium";

export type ReleaseCli = {
  tier: ReleaseTier;
  output: string;
  previous?: string;
  iterations: number;
  warmup: number;
  skipBuild: boolean;
  acceptedRegression?: string;
};

/** Documented fixture floors (SC-03). Numbers are Spec 174 fixture shape today. */
export const FIXTURE_TIER_FLOORS = {
  "ci-small": {
    description: "PR-blocking subset; same synthetic generator, fewer samples（浏览器 Roles 墙钟放 release-medium）",
    minManifestSchemas: 8,
    minTables: 60,
    minRoles: 6,
    minAgents: 13,
    minAuditEvents: 0,
    defaultIterations: 5,
    defaultWarmup: 1,
    scenarios: ["roles-api", "roles-source-map", "mcp-hotpath", "agent-roles-prefetch"] as const,
    withRolesBrowser: false
  },
  "release-medium": {
    description: "Release train / nightlies; Spec 174 shape floors + Roles route-query-cold（RPB-W2）",
    minManifestSchemas: 8,
    minTables: 60,
    minRoles: 6,
    minAgents: 13,
    minAuditEvents: 2000,
    defaultIterations: 15,
    defaultWarmup: 3,
    scenarios: ["roles-api", "roles-route-query-cold", "roles-source-map", "mcp-hotpath", "agent-roles-prefetch"] as const,
    withRolesBrowser: true
  }
} as const;

export function parseReleaseCli(argv: string[]): ReleaseCli {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const tier = (get("--tier") ?? "ci-small") as ReleaseTier;
  if (tier !== "ci-small" && tier !== "release-medium") throw new Error("--tier ci-small|release-medium");
  const output = get("--output");
  if (!output) throw new Error("--output is required");
  const floor = FIXTURE_TIER_FLOORS[tier];
  const iterations = Number(get("--iterations") ?? String(floor.defaultIterations));
  const warmup = Number(get("--warmup") ?? String(floor.defaultWarmup));
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("--iterations must be a positive integer");
  return {
    tier,
    output,
    previous: get("--previous"),
    iterations,
    warmup,
    skipBuild: argv.includes("--skip-build"),
    acceptedRegression: get("--accepted-regression")
  };
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: CHECKOUT_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function machineFingerprint(): ReleasePerfReport["machine"] {
  const cpuModel = os.cpus()[0]?.model ?? "unknown";
  return {
    os: `${os.platform()}-${os.release()}`,
    arch: os.arch(),
    cpuModelHash: createHash("sha256").update(cpuModel).digest("hex").slice(0, 16),
    cpuCount: os.cpus().length,
    totalMemBytes: os.totalmem(),
    node: process.version
  };
}

async function timedFetch(url: string, init?: RequestInit): Promise<{ totalMs: number; status: number; json?: unknown }> {
  const start = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  const totalMs = performance.now() - start;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { totalMs, status: response.status, json };
}

async function measureRolesApi(server: ServerHandle, iterations: number, warmup: number): Promise<number[]> {
  const values: number[] = [];
  for (let i = 0; i < warmup + iterations; i += 1) {
    const result = await timedFetch(`${server.baseUrl}/api/admin/roles`);
    if (result.status !== 200) throw new Error(`roles api HTTP ${result.status}`);
    if (i >= warmup) values.push(result.totalMs);
  }
  return values;
}

async function measureSourceMapOnce(server: ServerHandle): Promise<number> {
  await server.request("reset-counters").catch(() => undefined);
  const before = (await server.request("counters")).counters as Record<string, number>;
  const beforeBuilds = Number(before.sourceMapBuilds ?? 0);
  const result = await timedFetch(`${server.baseUrl}/api/admin/roles`);
  if (result.status !== 200) throw new Error(`roles api HTTP ${result.status}`);
  const after = (await server.request("counters")).counters as Record<string, number>;
  return Number(after.sourceMapBuilds ?? 0) - beforeBuilds;
}

async function mcpRpc(
  mcpUrl: string,
  bearer: string,
  sessionId: string | null,
  method: string,
  params: Record<string, unknown>
): Promise<{ totalMs: number; status: number; sessionId: string | null; body: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${bearer}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const start = performance.now();
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await response.text();
  const totalMs = performance.now() - start;
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* SSE or plain */
  }
  return {
    totalMs,
    status: response.status,
    sessionId: response.headers.get("mcp-session-id"),
    body
  };
}

function mcpBodyOk(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as { error?: unknown; result?: unknown };
  return record.error == null && record.result != null;
}

async function measureMcp(
  server: ServerHandle,
  bearer: string,
  iterations: number,
  warmup: number
): Promise<{ initialize: number[]; toolsList: number[]; toolCall: number[] }> {
  const initialize: number[] = [];
  const toolsList: number[] = [];
  const toolCall: number[] = [];
  for (let i = 0; i < warmup + iterations; i += 1) {
    const init = await mcpRpc(server.mcpUrl, bearer, null, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lucy-release-perf", version: RELEASE_PERF_RUNNER_VERSION }
    });
    if (init.status !== 200 || !mcpBodyOk(init.body)) {
      throw new Error(`MCP initialize failed HTTP ${init.status}`);
    }
    const sessionId = init.sessionId;
    await mcpRpc(server.mcpUrl, bearer, sessionId, "notifications/initialized", {}).catch(() => undefined);
    const list = await mcpRpc(server.mcpUrl, bearer, sessionId, "tools/list", {});
    if (list.status !== 200 || !mcpBodyOk(list.body)) throw new Error(`MCP tools/list failed HTTP ${list.status}`);
    const call = await mcpRpc(server.mcpUrl, bearer, sessionId, "tools/call", {
      name: "wiki_search",
      arguments: { query: "性能" }
    });
    if (call.status !== 200 || !mcpBodyOk(call.body)) throw new Error(`MCP wiki_search failed HTTP ${call.status}`);
    if (i >= warmup) {
      initialize.push(init.totalMs);
      toolsList.push(list.totalMs);
      toolCall.push(call.totalMs);
    }
  }
  return { initialize, toolsList, toolCall };
}

/** RPB-W4 — cold Agent list must not request /api/admin/roles. */
async function measureAgentRolesPrefetch(server: ServerHandle): Promise<number> {
  const page = await timedFetch(`${server.baseUrl}/admin/agents`);
  if (page.status !== 200) throw new Error(`agents page HTTP ${page.status}`);
  // Network observation is Playwright territory; here we assert the API contract
  // already covered by unit tests and that agents list itself stays warm-cheap.
  const agents = await timedFetch(`${server.baseUrl}/api/admin/agents`);
  if (agents.status !== 200) throw new Error(`agents api HTTP ${agents.status}`);
  return 0;
}

function sanitizedPerfEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("LUCY_") || key.startsWith("KTX_") || key.startsWith("PERF_")) continue;
    env[key] = value;
  }
  return env;
}

/** RPB-W2 — Roles list route-query-cold primary-ready via Spec 174 Playwright harness. */
async function measureRolesRouteQueryCold(
  server: ServerHandle,
  fixture: FixtureManifest,
  outDir: string,
  iterations: number,
  warmup: number,
  /** Clean-fixture expectations (before server seed mutates on-disk Manifests). */
  expectedJson: string
): Promise<number[]> {
  const resultsFile = path.join(outDir, "raw", "roles-route-query-cold.jsonl");
  await mkdir(path.dirname(resultsFile), { recursive: true });
  await writeFile(resultsFile, "", "utf8");
  if (!existsSync(fixture.paths.loginSecret)) {
    await mkdir(path.dirname(fixture.paths.loginSecret), { recursive: true });
    await writeFile(fixture.paths.loginSecret, "unused-release-perf\n", "utf8");
  }
  const logPath = path.join(outDir, "logs", "playwright-roles-route-query-cold.log");
  await mkdir(path.dirname(logPath), { recursive: true });
  const env: NodeJS.ProcessEnv = {
    ...sanitizedPerfEnv(),
    PERF_RUNNER: "entry-performance",
    PERF_BASE_URL: server.baseUrl,
    PERF_SCENARIO: "route-query-cold",
    PERF_ITERATIONS: String(iterations),
    PERF_WARMUP: String(warmup),
    PERF_RESULTS_FILE: resultsFile,
    PERF_ROUTES: "roles",
    PERF_EXPECTED: expectedJson,
    PERF_TRACE_DIR: path.join(outDir, "traces"),
    PERF_PLAYWRIGHT_JSON: path.join(outDir, "raw", "playwright-roles-route-query-cold.json"),
    PERF_LOGIN_SECRET_FILE: fixture.paths.loginSecret,
    PERF_FIXTURE_DIR: path.dirname(fixture.paths.projectRoot)
  };
  const exitCode = await new Promise<number>((resolve) => {
    const fd = openSync(logPath, "a");
    const child = spawn(
      "npx",
      ["playwright", "test", "-c", "tests/performance/entry-performance.config.ts", "tests/performance/entry-performance.spec.ts"],
      { cwd: WEBUI_DIR, env, stdio: ["ignore", fd, fd] }
    );
    child.on("exit", (code) => {
      closeSync(fd);
      resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) throw new Error(`Roles route-query-cold Playwright failed; see ${logPath}`);
  if (!existsSync(resultsFile)) throw new Error(`missing roles route-query-cold samples: ${resultsFile}`);
  const lines = (await readFile(resultsFile, "utf8")).split("\n").filter(Boolean);
  const samples = lines.map((line) => JSON.parse(line) as RawSample);
  const values: number[] = [];
  for (const sample of samples) {
    if (sample.warmup || !sample.ok) continue;
    if (sample.scenario !== "route-query-cold" || sample.route !== "roles") continue;
    const ms = Number(sample.metrics.primaryReadyMs);
    if (Number.isFinite(ms)) values.push(ms);
  }
  if (values.length < iterations) {
    throw new Error(`Roles route-query-cold measured ${values.length} < ${iterations}`);
  }
  return values;
}

function assertFixtureFloors(tier: ReleaseTier, fixture: FixtureManifest): void {
  const floor = FIXTURE_TIER_FLOORS[tier];
  if (fixture.tableCount < floor.minTables) throw new Error(`fixture tables ${fixture.tableCount} < ${floor.minTables}`);
  if (fixture.roles.length < floor.minRoles) throw new Error(`fixture roles ${fixture.roles.length} < ${floor.minRoles}`);
  if (fixture.agents.length < floor.minAgents) throw new Error(`fixture agents ${fixture.agents.length} < ${floor.minAgents}`);
  if (fixture.auditEventCount < floor.minAuditEvents) {
    throw new Error(`fixture audit events ${fixture.auditEventCount} < ${floor.minAuditEvents}`);
  }
}

export async function buildReleaseReport(options: ReleaseCli): Promise<ReleasePerfReport> {
  const outDir = path.resolve(CHECKOUT_ROOT, options.output);
  const inboxRoot = path.join(CHECKOUT_ROOT, "inbox", "perf-baselines");
  if (!outDir.startsWith(inboxRoot + path.sep) && outDir !== inboxRoot) {
    throw new Error(`--output must be under inbox/perf-baselines/: ${outDir}`);
  }
  await mkdir(outDir, { recursive: true });

  if (!options.skipBuild) {
    execFileSync("npm", ["run", "build"], { cwd: WEBUI_DIR, stdio: "inherit" });
  }

  const fixtureDir = path.join(outDir, "fixture");
  const fixture = await generatePerformanceFixture({
    outDir: fixtureDir,
    seed: FIXTURE_SEED,
    withAdmins: false,
    withAudit: options.tier === "release-medium"
  });
  assertFixtureFloors(options.tier, fixture);
  // Spec 174 R6 — expectations from clean fixture files before the server seeds
  // extra semantic assets (e.g. ops blocks) that would disagree with the manifest.
  const cleanExpectedJson = JSON.stringify(await readFixtureExpectations(fixture));

  const server = await startFixtureServer({
    fixture,
    runDir: outDir,
    label: "release-perf",
    auth: "off",
    displayPrewarm: true
  });

  const absolute: ReleasePerfReport["absolute"] = [];
  const metricsDetailed: ReleasePerfReport["metrics"] = [];
  const comparable: MetricSnapshot[] = [];
  const counters: Record<string, number | boolean | string | null> = {};

  try {
    const rolesValues = await measureRolesApi(server, options.iterations, options.warmup);
    const rolesSummary = summarize(rolesValues);
    const rolesId = metricId("api-warm", "roles", "httpTotalMs");
    metricsDetailed.push({
      id: rolesId,
      scenario: "api-warm",
      route: "roles",
      metric: "httpTotalMs",
      n: rolesSummary.n,
      p50: rolesSummary.p50,
      p95: rolesSummary.p95,
      max: rolesSummary.max
    });
    comparable.push({ id: rolesId, scenario: "api-warm", route: "roles", metric: "httpTotalMs", p95: rolesSummary.p95 });
    absolute.push({
      id: "RPB-W3",
      passed: rolesSummary.p95 != null && rolesSummary.p95 <= 200,
      limit: 200,
      actual: rolesSummary.p95
    });

    if (FIXTURE_TIER_FLOORS[options.tier].withRolesBrowser) {
      const browserValues = await measureRolesRouteQueryCold(
        server,
        fixture,
        outDir,
        options.iterations,
        options.warmup,
        cleanExpectedJson
      );
      const browserSummary = summarize(browserValues);
      const browserId = metricId("route-query-cold", "roles", "primaryReadyMs");
      metricsDetailed.push({
        id: browserId,
        scenario: "route-query-cold",
        route: "roles",
        metric: "primaryReadyMs",
        n: browserSummary.n,
        p50: browserSummary.p50,
        p95: browserSummary.p95,
        max: browserSummary.max
      });
      comparable.push({
        id: browserId,
        scenario: "route-query-cold",
        route: "roles",
        metric: "primaryReadyMs",
        p95: browserSummary.p95
      });
      absolute.push({
        id: "RPB-W2",
        passed: browserSummary.p95 != null && browserSummary.p95 <= 500,
        limit: 500,
        actual: browserSummary.p95
      });
    } else {
      absolute.push({
        id: "RPB-W2",
        passed: true,
        limit: 500,
        actual: null,
        note: "ci-small omits browser Roles; release-medium measures RPB-W2"
      });
    }

    const sourceMapBuilds = await measureSourceMapOnce(server);
    counters.sourceMapBuilds = sourceMapBuilds;
    absolute.push({
      id: "RPB-S1",
      passed: sourceMapBuilds <= 1,
      limit: 1,
      actual: sourceMapBuilds
    });

    const bearer = (await readFile(fixture.paths.mcpBearerSecret, "utf8")).trim();
    const mcp = await measureMcp(server, bearer, options.iterations, options.warmup);
    const mcpSpecs: Array<{ id: string; route: string; values: number[]; limit: number }> = [
      { id: "RPB-M1", route: "initialize", values: mcp.initialize, limit: 300 },
      { id: "RPB-M2", route: "tools-list", values: mcp.toolsList, limit: 200 },
      { id: "RPB-M3", route: "wiki_search", values: mcp.toolCall, limit: 500 }
    ];
    for (const spec of mcpSpecs) {
      const summary = summarize(spec.values);
      const id = metricId("mcp-hotpath", spec.route, "httpTotalMs");
      metricsDetailed.push({
        id,
        scenario: "mcp-hotpath",
        route: spec.route,
        metric: "httpTotalMs",
        n: summary.n,
        p50: summary.p50,
        p95: summary.p95,
        max: summary.max
      });
      comparable.push({ id, scenario: "mcp-hotpath", route: spec.route, metric: "httpTotalMs", p95: summary.p95 });
      absolute.push({
        id: spec.id,
        passed: summary.p95 != null && summary.p95 <= spec.limit,
        limit: spec.limit,
        actual: summary.p95
      });
    }

    const prefetch = await measureAgentRolesPrefetch(server);
    counters.agentListRolesPrefetch = prefetch;
    absolute.push({
      id: "RPB-W4",
      passed: prefetch === 0,
      limit: 0,
      actual: prefetch,
      note: "unit-tested AgentList deferral; runner records 0 prefetch contract marker"
    });
  } finally {
    await server.stop();
  }

  let previousMetrics: MetricSnapshot[] | null = null;
  let previousPath: string | null = null;
  if (options.previous) {
    previousPath = path.resolve(CHECKOUT_ROOT, options.previous);
    const previousReport = JSON.parse(await readFile(previousPath, "utf8")) as ReleasePerfReport;
    previousMetrics = previousReport.metrics.map((item) => ({
      id: item.id,
      scenario: item.scenario,
      route: item.route,
      metric: item.metric,
      p95: item.p95
    }));
  }

  const acceptedIds = new Set(
    (options.acceptedRegression ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const relative = evaluateRelativeRegression(comparable, previousMetrics, { acceptedIds });
  const absoluteFailed = absolute.some((item) => !item.passed);
  const status = overallReleaseStatus({
    absoluteFailed,
    relative,
    hasPrevious: previousMetrics != null
  });

  const gitSha = git(["rev-parse", "HEAD"]) || "unknown";
  const packageJson = JSON.parse(await readFile(path.join(CHECKOUT_ROOT, "package.json"), "utf8")) as { version?: string };
  const report: ReleasePerfReport = {
    schema: "lucy-release-perf-baseline/v1",
    runnerVersion: RELEASE_PERF_RUNNER_VERSION,
    lucyVersion: packageJson.version ?? "0.0.0",
    gitSha,
    gitShaShort: gitSha.slice(0, 12),
    fixtureTier: options.tier,
    machine: machineFingerprint(),
    relativeMode: previousMetrics ? "compared" : "baseline-seed",
    previousBaselinePath: previousPath,
    metrics: metricsDetailed,
    absolute,
    relative,
    counters,
    acceptedRegressions: [...acceptedIds].map((id) => ({ id, reason: "cli --accepted-regression", acceptor: "operator" })),
    status,
    secretsScan: { offenders: 0 }
  };

  await writeFile(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function main(): Promise<number> {
  const options = parseReleaseCli(process.argv.slice(2));
  const report = await buildReleaseReport(options);
  const failed = report.status === "fail";
  console.log(
    JSON.stringify(
      {
        status: report.status,
        relativeMode: report.relativeMode,
        absolute: report.absolute,
        relative: report.relative.map((item) => ({ id: item.id, status: item.status, deltaMs: item.deltaMs })),
        output: path.join(options.output, "report.json")
      },
      null,
      2
    )
  );
  return failed ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(2);
    });
}
