import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  ALL_SCENARIOS,
  catalogSearchMatches,
  classifyLongTasks,
  evaluateAcceptance,
  evaluateBudgets,
  EXPECTED_CELLS,
  exitCodeFor,
  expectationsFromFixture,
  initialAssetBudget,
  nearestRank,
  parseCli,
  summarizeSamples,
  validateFilterTraces,
  type BehaviorResult,
  type RawSample
} from "../entry-performance.mts";
import { agentsReady, catalogFilterDone, catalogReady, connectionsReady, type PerfExpected } from "../../tests/performance/entry-performance-predicates";
import { FILTER_TRACE_NAMES, observationsInWindow } from "../../tests/performance/entry-performance-observations";
import {
  assertSafeFixtureOutput,
  createRng,
  FIXTURE_OWNER_MARKER,
  generatePerformanceFixture,
  planAuditEvents,
  removeOwnedRunDir
} from "../entry-performance-fixture.mts";

const checkoutRoot = path.resolve(__dirname, "..", "..", "..");

describe("Spec 174 entry-performance statistics", () => {
  it("uses nearest-rank P95 = sorted[ceil(0.95n)-1]", () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(nearestRank(values, 0.95)).toBe(29);
    expect(nearestRank(values, 0.5)).toBe(15);
    expect(nearestRank([5], 0.95)).toBe(5);
    expect(nearestRank([], 0.95)).toBeNull();
    expect(nearestRank([3, 1, 2], 0.95)).toBe(3);
  });

  it("keeps failed samples, excludes warm-up and fails the budget", () => {
    const samples: RawSample[] = [
      { scenario: "api-warm", route: "sources", iteration: 0, warmup: true, ok: true, metrics: { httpTotalMs: 999 } },
      ...Array.from({ length: 30 }, (_, i) => ({ scenario: "api-warm", route: "sources", iteration: i + 1, warmup: false, ok: true, metrics: { httpTotalMs: 10 + i } })),
      { scenario: "api-warm", route: "sources", iteration: 31, warmup: false, ok: false, error: "boom", metrics: {} }
    ];
    const summary = summarizeSamples(samples);
    expect(summary["api-warm"]!.sources!.measured).toBe(31);
    expect(summary["api-warm"]!.sources!.failures).toBe(1);
    expect(summary["api-warm"]!.sources!.metrics.httpTotalMs!.max).toBe(39);
    const budget = evaluateBudgets(summary).find((item) => item.id === "PERF-06" && item.route === "sources")!;
    expect(budget.actual).toBeLessThanOrEqual(100);
    expect(budget.passed).toBe(false);
    expect(budget.note).toMatch(/1 failed/);
  });

  it("reports missing routes as failing budgets instead of silently passing", () => {
    const summary = summarizeSamples([{ scenario: "route-warm", route: "catalog", iteration: 0, warmup: false, ok: true, metrics: { feedbackMs: 5, primaryReadyMs: 20 } }]);
    const missing = evaluateBudgets(summary).filter((item) => item.id === "PERF-01" && item.route === "agents");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.passed).toBe(false);
  });

  it("classifies main-frame long tasks as business tasks", () => {
    expect(classifyLongTasks([
      { duration: 49, container: "window" },
      { duration: 60, container: "window" },
      { duration: 70, container: null },
      { duration: 90, container: "iframe" }
    ])).toEqual({ business: 2, other: 1 });
  });

  it("sums gzip bytes of resources actually loaded before primary-ready", () => {
    const assets = [
      { path: "/assets/index-a.js", bytes: 1000, gzipBytes: 300 },
      { path: "/assets/route-b.js", bytes: 500, gzipBytes: 100 },
      { path: "/assets/index-c.css", bytes: 400, gzipBytes: 80 }
    ];
    const sample: RawSample = {
      scenario: "browser-cold", route: "catalog", iteration: 5, warmup: false, ok: true,
      metrics: { resources: [{ path: "/assets/index-a.js" }, { path: "/assets/index-c.css" }, { path: "/assets/index-a.js" }] }
    };
    expect(initialAssetBudget([sample], assets).catalog).toEqual({ jsGzip: 300, cssGzip: 80, jsFiles: ["/assets/index-a.js"], cssFiles: ["/assets/index-c.css"], samples: 1, problems: [] });
  });

  it("requires --baseline-dir for after and rejects dev mode", () => {
    expect(() => parseCli(["--phase", "after", "--output", "x"])).toThrow(/baseline-dir/);
    expect(() => parseCli(["--phase", "baseline", "--mode", "dev", "--output", "x"])).toThrow(/production/);
    expect(parseCli(["--phase", "baseline", "--output", "x", "--scenario", "all"]).scenarios).toContain("display-cold");
  });
});

describe("Spec 174 entry-performance fixture", () => {
  it("guards output paths and refuses unowned deletes", async () => {
    expect(() => assertSafeFixtureOutput(path.join(checkoutRoot, "config", "x"), checkoutRoot)).toThrow(/entry-perf-guard/);
    expect(() => assertSafeFixtureOutput(path.join(checkoutRoot, "webui", "config", "x"), checkoutRoot)).toThrow(/entry-perf-guard/);
    expect(() => assertSafeFixtureOutput("/etc/lucy-perf", checkoutRoot)).toThrow(/entry-perf-guard/);
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lucy-perf-guard-"));
    const unowned = path.join(tmp, "unowned");
    await mkdir(unowned, { recursive: true });
    await writeFile(path.join(unowned, "keep.txt"), "keep");
    await expect(removeOwnedRunDir(unowned, checkoutRoot)).rejects.toThrow(/owner/);
    expect(existsSync(path.join(unowned, "keep.txt"))).toBe(true);
  });

  it("is deterministic for the same seed/anchor and matches the Spec §8 shape", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "lucy-perf-fixture-"));
    const anchorIso = "2026-10-10T00:00:00.000Z";
    const a = await generatePerformanceFixture({ outDir: path.join(tmp, "a"), anchorIso, withAudit: false, withAdmins: false, checkoutRoot });
    const b = await generatePerformanceFixture({ outDir: path.join(tmp, "b"), anchorIso, withAudit: false, withAdmins: false, checkoutRoot });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.auditInputDigest).toBe(b.auditInputDigest);
    expect(a.connectionIds).toHaveLength(7);
    expect(Object.keys(a.manifestBytes)).toHaveLength(8);
    expect(a.tableCount).toBe(60);
    expect(a.columnCount).toBe(1786);
    expect(a.enabledTableCount).toBe(45);
    expect(a.agents).toHaveLength(13);
    expect(a.agents.filter((agent) => agent.enabled)).toHaveLength(12);
    expect(a.overlayCount).toBeGreaterThan(0);
    expect(existsSync(path.join(tmp, "a", FIXTURE_OWNER_MARKER))).toBe(true);
    const ktxYaml = readFileSync(path.join(a.paths.projectRoot, "ktx.yaml"), "utf8");
    expect(ktxYaml).not.toMatch(/aliyun|10\.69\./);
    const access = readFileSync(a.paths.accessPath, "utf8");
    expect(access).toContain("source_scope: catalog_bound");
    expect(access).toMatch(/roles:\n\s+- sales_analyst\n\s+- catalog_pair/);
    await expect(generatePerformanceFixture({ outDir: path.join(tmp, "a"), anchorIso, withAudit: false, checkoutRoot })).rejects.toThrow(/not empty/);
  });

  it("places audit events inside the 7-day window around the anchor", () => {
    const rng = createRng(1);
    expect(rng()).not.toBe(rng());
    const anchorIso = "2026-10-10T00:00:00.000Z";
    const tables = [{ conn: "c", schema: "s", name: "t", columns: [] }];
    const events = planAuditEvents(161, anchorIso, ["u1", "u2"], tables);
    expect(events).toHaveLength(400);
    const anchor = Date.parse(anchorIso);
    for (const event of events) expect(Math.abs(Date.parse(event.ts) - anchor)).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(new Set(events.map((event) => event.outcome))).toEqual(new Set(["ok", "denied", "error"]));
    expect(events.some((event) => event.tool === "initialize" || event.tool === "tools/list")).toBe(true);
  });
});

// ─── Spec 174 R6 — formal acceptance rejects missing evidence ─────────────────

const ASSETS = [
  { path: "/assets/index-a.js", bytes: 1000, gzipBytes: 1000 },
  { path: "/assets/route-b.js", bytes: 500, gzipBytes: 500 },
  { path: "/assets/index-c.css", bytes: 400, gzipBytes: 400 },
  { path: "/assets/route-d.css", bytes: 300, gzipBytes: 300 }
];
const FORMAL = { phase: "after" as const, scenarios: [...ALL_SCENARIOS], iterations: 30, warmup: 5 };
const BEHAVIOR_OK: BehaviorResult = { exitCode: 0, expected: 10, unexpected: 0, skipped: 0, flaky: 0 };

/** A complete formal sample set: every contract cell × 5 warm-up + 30 passing samples. */
function completeSamples(): RawSample[] {
  const samples: RawSample[] = [];
  for (const cell of EXPECTED_CELLS) {
    for (const route of cell.routes) {
      for (let i = 0; i < 35; i += 1) {
        const metrics: Record<string, unknown> = Object.fromEntries([...cell.metrics, ...(cell.afterOnly ?? [])].map((metric) => [metric, metric === "cls" || metric === "businessLongTasks" ? 0 : 7]));
        if (cell.scenario === "browser-cold") metrics.resources = [{ path: "/assets/index-a.js" }, { path: "/assets/index-c.css" }];
        samples.push({ scenario: cell.scenario, route, iteration: i, warmup: i < 5, ok: true, metrics });
      }
    }
  }
  return samples;
}

function judge(samples: RawSample[], overrides: { behavior?: BehaviorResult; options?: Partial<typeof FORMAL>; budgets?: ReturnType<typeof evaluateBudgets>; filterTraceProblems?: string[] | null } = {}) {
  const options = { ...FORMAL, ...overrides.options };
  const summary = summarizeSamples(samples);
  const budgets = overrides.budgets ?? evaluateBudgets(summary, { scenarios: options.scenarios, minSamples: options.iterations >= 30 ? 30 : 1 });
  const assets = initialAssetBudget(samples, ASSETS);
  const acceptance = evaluateAcceptance({
    options,
    summary,
    budgets,
    assets,
    behavior: overrides.behavior === undefined ? BEHAVIOR_OK : overrides.behavior,
    sampleFailures: samples.filter((sample) => !sample.ok && !sample.warmup).length,
    secretOffenders: 0,
    filterTraceProblems: overrides.filterTraceProblems === undefined ? [] : overrides.filterTraceProblems
  });
  return { acceptance, exit: exitCodeFor(options.phase, acceptance) };
}

describe("Spec 174 R6 — formal acceptance gate (SC-14/19, PERF-01–10 evidence)", () => {
  it("detects an early-key long task even when the last-key window and final render are fast", () => {
    const observed = { shifts: [], longTasks: [{ start: 100, duration: 80, name: "self", container: "window" }] };
    expect(classifyLongTasks(observationsInWindow(observed, 500 - 200, 530).longTasks).business).toBe(0);
    const business = classifyLongTasks(observationsInWindow(observed, 95, 530).longTasks).business;
    expect(business).toBe(1);
    const samples = completeSamples().map((sample) => sample.scenario === "route-warm" && sample.route === "catalog-filter" && sample.iteration === 5
      ? { ...sample, metrics: { ...sample.metrics, businessLongTasks: business } } : sample);
    const verdict = judge(samples);
    expect(verdict.acceptance.status).toBe("fail");
    expect(verdict.acceptance.reasons.some((reason) => reason.includes("PERF-10 route-warm/catalog-filter"))).toBe(true);
    expect(verdict.exit).toBe(1);
  });

  it("requires actual filter keyboard/paint traces, rejecting missing, malformed and navigation-only artifacts", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-filter-traces-"));
    try {
      expect(await validateFilterTraces(dir)).toHaveLength(2);
      const write = (name: string, events: unknown[]) => writeFile(path.join(dir, `${name}.json`), JSON.stringify({ traceEvents: events }));
      for (const name of FILTER_TRACE_NAMES) await write(name, [{ name: "EventDispatch", args: { data: { type: "click" } } }, { name: "Paint" }]);
      expect(await validateFilterTraces(dir)).toEqual(FILTER_TRACE_NAMES.map((name) => `${name}.json: no keyboard event evidence`));
      await writeFile(path.join(dir, `${FILTER_TRACE_NAMES[0]}.json`), "{");
      expect((await validateFilterTraces(dir))[0]).toContain("invalid JSON");
      await write(FILTER_TRACE_NAMES[0], []);
      expect((await validateFilterTraces(dir))[0]).toContain("no trace events");
      for (const name of FILTER_TRACE_NAMES) await write(name, [{ name: "EventDispatch", args: { data: { type: "keydown" } } }, { name: "Paint" }]);
      expect(await validateFilterTraces(dir)).toEqual([]);
      await write(FILTER_TRACE_NAMES[1], [{ name: "EventDispatch", args: { data: { type: "keydown" } } }]);
      expect(await validateFilterTraces(dir)).toEqual([`${FILTER_TRACE_NAMES[1]}.json: no paint evidence`]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cannot pass formal acceptance without validating filter traces", () => {
    expect(judge(completeSamples(), { filterTraceProblems: null }).exit).toBe(1);
    expect(judge(completeSamples(), { filterTraceProblems: ["catalog-filter-path.json: missing"] }).acceptance.status).toBe("incomplete");
  });

  it("passes a complete formal run", () => {
    const { acceptance, exit } = judge(completeSamples());
    expect(acceptance).toEqual({ formal: true, status: "pass", reasons: [] });
    expect(exit).toBe(0);
  });

  it("rejects an empty summary", () => {
    const { acceptance, exit } = judge([]);
    expect(acceptance.status).toBe("incomplete");
    expect(acceptance.reasons).toContain("api-warm/sources: missing");
    expect(exit).toBe(1);
  });

  it("rejects a missing route", () => {
    const { acceptance, exit } = judge(completeSamples().filter((sample) => !(sample.scenario === "browser-cold" && sample.route === "agents")));
    expect(acceptance.status).toBe("incomplete");
    expect(acceptance.reasons).toContain("browser-cold/agents: missing");
    expect(exit).toBe(1);
  });

  it("rejects a single-sample cell and does not count warm-up toward n", () => {
    const samples = completeSamples().filter((sample) => !(sample.scenario === "api-warm" && sample.route === "sources" && !sample.warmup && sample.iteration > 5));
    const { acceptance, exit } = judge(samples);
    expect(acceptance.reasons).toContain("api-warm/sources: measured 1 < 30");
    expect(exit).toBe(1);
    const warmupOnly = completeSamples().filter((sample) => !(sample.scenario === "api-warm" && sample.route === "agents" && sample.iteration === 34));
    expect(judge(warmupOnly).acceptance.reasons).toContain("api-warm/agents: measured 29 < 30");
  });

  it("rejects all-null metrics", () => {
    const samples = completeSamples().map((sample) => (sample.scenario === "route-warm" && sample.route === "overview" ? { ...sample, metrics: { feedbackMs: null, primaryReadyMs: null, cls: null, businessLongTasks: null } } : sample));
    const { acceptance, exit } = judge(samples);
    expect(acceptance.status).toBe("incomplete");
    expect(acceptance.reasons.some((reason) => reason.startsWith("route-warm/overview.primaryReadyMs: n=0"))).toBe(true);
    expect(exit).toBe(1);
  });

  it("keeps failed samples (never filtered) and rejects the run", () => {
    const samples = completeSamples();
    samples.push({ scenario: "browser-cold", route: "catalog", iteration: 35, warmup: false, ok: false, error: "primary-ready predicate not met", metrics: {} });
    const { acceptance, exit } = judge(samples);
    expect(acceptance.reasons).toContain("browser-cold/catalog: 1 failed samples");
    expect(exit).toBe(1);
  });

  it("rejects missing JS/CSS resource evidence and unknown dist resources", () => {
    const missing = completeSamples().map((sample) => (sample.scenario === "browser-cold" && sample.route === "overview" && sample.iteration === 9 ? { ...sample, metrics: { ...sample.metrics, resources: undefined } } : sample));
    expect(judge(missing).acceptance.reasons).toContain("PERF-08 overview: iteration 9: resources missing");
    const unknown = completeSamples().map((sample) => (sample.scenario === "browser-cold" && sample.route === "catalog" && sample.iteration === 12 ? { ...sample, metrics: { ...sample.metrics, resources: [{ path: "/assets/index-a.js" }, { path: "/assets/index-c.css" }, { path: "/assets/lazy-zzz.js" }] } } : sample));
    const judged = judge(unknown);
    expect(judged.acceptance.reasons).toContain("PERF-08 catalog: iteration 12: unknown dist resource /assets/lazy-zzz.js");
    expect(judged.exit).toBe(1);
  });

  it("rejects a run without behavior, with skipped behavior, or with too few behavior tests", () => {
    expect(judge(completeSamples(), { behavior: null }).acceptance.reasons).toContain("behavior not executed");
    expect(judge(completeSamples(), { behavior: { ...BEHAVIOR_OK!, skipped: 1 } }).acceptance.reasons).toContain("behavior skipped 1");
    expect(judge(completeSamples(), { behavior: { ...BEHAVIOR_OK!, expected: 3 } }).exit).toBe(1);
    expect(judge(completeSamples(), { options: { scenarios: ALL_SCENARIOS.filter((name) => name !== "behavior") } }).acceptance.formal).toBe(false);
  });

  it("an empty budget result can never pass", () => {
    const { acceptance, exit } = judge(completeSamples(), { budgets: [] });
    expect(acceptance.reasons).toContain("no budget evaluated");
    expect(acceptance.status).toBe("fail");
    expect(exit).toBe(1);
  });

  it("fails one over-budget cell with the original threshold", () => {
    const samples = completeSamples().map((sample) => (sample.scenario === "api-warm" && sample.route === "agents" && sample.iteration === 20 ? { ...sample, metrics: { httpTotalMs: 950 } } : sample));
    const samplesHigh = samples.map((sample) => (sample.scenario === "api-warm" && sample.route === "agents" && sample.iteration === 21 ? { ...sample, metrics: { httpTotalMs: 950 } } : sample));
    const { acceptance, exit } = judge(samplesHigh);
    expect(acceptance.status).toBe("fail");
    expect(acceptance.reasons.some((reason) => reason.startsWith("PERF-06 api-warm/agents httpTotalMs: 950 > 200"))).toBe(true);
    expect(exit).toBe(1);
  });

  it("smoke runs are partial (not a Spec pass) and baseline only fails on incomplete collection", () => {
    const smoke = completeSamples().filter((sample) => sample.iteration === 6);
    const partial = judge(smoke, { options: { iterations: 1, warmup: 0 } });
    expect(partial.acceptance.formal).toBe(false);
    expect(partial.acceptance.status).toBe("partial");
    expect(partial.exit).toBe(0);
    const slowBaseline = completeSamples().map((sample) => (sample.scenario === "api-warm" ? { ...sample, metrics: { httpTotalMs: 5000 } } : sample));
    expect(judge(slowBaseline, { options: { phase: "baseline" } }).exit).toBe(0);
    expect(judge([], { options: { phase: "baseline" } }).exit).toBe(1);
  });

  it("after-only metrics (display snapshot ready) are required in after, not in baseline", () => {
    const withoutDisplayReady = completeSamples().map((sample) => {
      if (sample.scenario !== "service-cold") return sample;
      const { displayReadyMs: _omit, ...metrics } = sample.metrics;
      return { ...sample, metrics };
    });
    expect(judge(withoutDisplayReady, { options: { phase: "baseline" } }).exit).toBe(0);
    const after = judge(withoutDisplayReady);
    expect(after.acceptance.reasons).toContain("service-cold/sources.displayReadyMs: n=0 (measured 30)");
    expect(after.exit).toBe(1);
  });

  it("PERF-08 takes the JS and CSS maxima independently over all samples", () => {
    const samples: RawSample[] = [
      { scenario: "browser-cold", route: "catalog", iteration: 5, warmup: false, ok: true, metrics: { resources: [{ path: "/assets/index-a.js" }, { path: "/assets/route-b.js" }, { path: "/assets/index-c.css" }] } },
      { scenario: "browser-cold", route: "catalog", iteration: 6, warmup: false, ok: true, metrics: { resources: [{ path: "/assets/index-a.js" }, { path: "/assets/index-c.css" }, { path: "/assets/route-d.css" }] } }
    ];
    const result = initialAssetBudget(samples, ASSETS).catalog!;
    expect(result.jsGzip).toBe(1500);
    expect(result.cssGzip).toBe(700);
  });
});

// ─── Spec 174 R6 — real DOM / data / action predicates ────────────────────────

const EXPECTED: PerfExpected = expectationsFromFixture({
  connections: [
    { id: "c1", schemas: ["sales", "ops"], enabledTables: ["sales.orders", "sales.refunds"] },
    { id: "c2", schemas: ["mart"], enabledTables: ["mart.kpi"] }
  ],
  tables: [
    { conn: "c1", schema: "sales", name: "orders", columns: ["id", "amount", "region_code"], enabled: true },
    { conn: "c1", schema: "sales", name: "refunds", columns: ["id", "region_code"], enabled: true },
    { conn: "c1", schema: "sales", name: "archive", columns: ["id"], enabled: false },
    { conn: "c2", schema: "mart", name: "kpi", columns: ["id", "amount"], enabled: true }
  ],
  agentIds: ["a1", "a2"]
});

function dom(body: string): Document {
  return new JSDOM(`<!doctype html><body>${body}</body>`).window.document;
}

function catalogDom(term: string, rows: string[], count = rows.length, treeCount = count): Document {
  return dom(`
    <input class="pl-whitelist-search-input" value="${term}">
    <button data-testid="catalog-tree-root">全部连接 ${treeCount} 张表</button>
    <button data-testid="catalog-tree-connection-0"></button><button data-testid="catalog-tree-connection-1"></button>
    <span data-testid="catalog-result-count">${count} 条结果</span>
    <table>${rows.map((name) => `<tr data-testid="catalog-row-${name}"></tr>`).join("")}</table>`);
}

describe("Spec 174 R6 — primary-ready and filter completion predicates", () => {
  it("computes expectations from fixture files, including a column-name-only search term", () => {
    expect(EXPECTED.connectionMetricValues).toEqual(["2", "1", "4", "1"]);
    expect(EXPECTED.schemaCount).toBe(3);
    const columnCase = EXPECTED.filterCases.find((item) => item.term !== "sales")!;
    expect(columnCase.term).toBe("amount");
    expect(columnCase.names).toEqual(["kpi", "orders"]);
    expect(catalogSearchMatches({ conn: "c2", schema: "mart", name: "kpi", columns: ["amount"], enabled: true }, "AMOUNT")).toBe(true);
  });

  it("catalog filter completion requires the expected rows, count and tree count for the typed term", () => {
    const amount = EXPECTED.filterCases.find((item) => item.term === "amount")!;
    expect(catalogFilterDone(catalogDom("amount", amount.names), EXPECTED, "amount")).toBe(true);
    // Negative control: filtering disabled — the unfiltered rows stay on screen.
    expect(catalogFilterDone(catalogDom("amount", EXPECTED.enabledTableNames), EXPECTED, "amount")).toBe(false);
    // Negative control: delayed update — the count node exists but still shows the old count.
    expect(catalogFilterDone(catalogDom("amount", amount.names, EXPECTED.enabledTableNames.length), EXPECTED, "amount")).toBe(false);
    expect(catalogFilterDone(catalogDom("amount", amount.names, amount.names.length, 3), EXPECTED, "amount")).toBe(false);
    // Negative control: the input does not hold the typed term yet.
    expect(catalogFilterDone(catalogDom("amo", amount.names), EXPECTED, "amount")).toBe(false);
  });

  it("catalog primary-ready requires the scope tree, the exact enabled row set and counts", () => {
    expect(catalogReady(catalogDom("", EXPECTED.enabledTableNames), EXPECTED)).toBe(true);
    expect(catalogReady(catalogDom("", ["orders", "refunds", "archive"]), EXPECTED)).toBe(false);
    expect(catalogReady(dom('<input class="pl-whitelist-search-input" value=""><span data-testid="catalog-result-count">3 条结果</span>'), EXPECTED)).toBe(false);
  });

  it("connections primary-ready requires every Manifest / enabled-scope statistic, not just the cards", () => {
    const page = (values: string[], status = "已存在") => dom(`
      <div data-testid="connection-card-c1"></div><div data-testid="connection-card-c2"></div>
      ${values.map((value) => `<strong data-testid="connection-metric-value">${value}</strong>`).join("")}
      ${["c1-sales", "c1-ops", "c2-mart"].map((id) => `<span data-testid="schema-asset-status-${id}">${status}</span><span data-testid="schema-enabled-count-${id}"></span>`).join("")}
      <button data-testid="create-connection-btn">新建连接</button>`);
    expect(connectionsReady(page(EXPECTED.connectionMetricValues), EXPECTED)).toBe(true);
    expect(connectionsReady(page(["2", "—", "4", "—"]), EXPECTED)).toBe(false);
    expect(connectionsReady(page(EXPECTED.connectionMetricValues, "—"), EXPECTED)).toBe(false);
  });

  it("agents primary-ready requires the rows, statistics and enabled filters", () => {
    const page = (total: string, disabled = "") => dom(`
      <input placeholder="搜索显示名或用户 ID">
      <select aria-label="当前状态" ${disabled}></select><select aria-label="角色"></select><select aria-label="近 7 天活跃"></select>
      <span data-testid="agent-list-result-count">2 条结果</span><strong data-testid="metric-agent-count-value">${total}</strong>
      <table><tr data-testid="agent-row-a1"><td data-testid="agent-row-index-a1"></td></tr><tr data-testid="agent-row-a2"></tr></table>`);
    expect(agentsReady(page("2"), EXPECTED)).toBe(true);
    expect(agentsReady(page("—"), EXPECTED)).toBe(false);
    expect(agentsReady(page("2", "disabled"), EXPECTED)).toBe(false);
  });
});
