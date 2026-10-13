import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyLongTasks,
  evaluateBudgets,
  initialAssetBudget,
  nearestRank,
  parseCli,
  summarizeSamples,
  type RawSample
} from "../entry-performance.mts";
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
    expect(initialAssetBudget([sample], assets).catalog).toEqual({ jsGzip: 300, cssGzip: 80, files: ["/assets/index-a.js", "/assets/index-c.css"] });
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
