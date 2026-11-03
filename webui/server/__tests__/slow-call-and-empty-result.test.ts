/**
 * WO-202610-14 T1 / SC-20 — 慢调用、零行、取消.
 *
 * A slow mark means `lucy_query` taking at least 5 seconds, or a question's
 * wall clock reaching 120 seconds. A 1.6s successful query is not slow, and
 * other tools are not marked by this definition at all. A successful call with
 * zero rows records `result_empty=1`.
 */
import { describe, expect, it } from "vitest";
import {
  budgetIdentityKey,
  isEmptyResult,
  isSlowCall,
  questionBudget,
  SLOW_CALL_MIN_DURATION_MS,
  SLOW_DEFINITION_EFFECTIVE_AT,
  SLOW_TURN_WALL_CLOCK_MS,
  slowCallThresholdMs,
  slowTurnWallClockMs,
} from "../proxy/question-experience.js";

describe("slow call and empty result (SC-20)", () => {
  it("does not mark a 1.6 second successful query slow", () => {
    expect(isSlowCall({ tool: "lucy_query", durationMs: 1_600 }).slow).toBe(false);
    expect(isSlowCall({ tool: "lucy_query", durationMs: 1_599 }).slow).toBe(false);
  });

  it("marks lucy_query slow from five seconds", () => {
    expect(SLOW_CALL_MIN_DURATION_MS).toBe(5_000);
    expect(isSlowCall({ tool: "lucy_query", durationMs: 4_999 }).slow).toBe(false);
    const verdict = isSlowCall({ tool: "lucy_query", durationMs: 5_000 });
    expect(verdict.slow).toBe(true);
    expect(verdict.basis).toBe("call_duration");
    expect(isSlowCall({ tool: "lucy_query", durationMs: 7_600 }).basis).toBe("call_duration");
  });

  it("does not mark other tools slow even past five seconds", () => {
    // Non-goal made explicit: wiki_read / discover_data have no slow mark
    // under this definition.
    for (const tool of ["wiki_read", "discover_data", "dictionary_search", "lucy_read_source"]) {
      const verdict = isSlowCall({ tool, durationMs: 60_000 });
      expect(verdict.slow).toBe(false);
      expect(verdict.basis).toBeNull();
    }
  });

  it("marks a question slow from a 120 second wall clock", () => {
    expect(SLOW_TURN_WALL_CLOCK_MS).toBe(120_000);
    expect(isSlowCall({ tool: "wiki_read", durationMs: 40, turnWallClockMs: 119_999 }).slow).toBe(false);
    const verdict = isSlowCall({ tool: "wiki_read", durationMs: 40, turnWallClockMs: 120_000 });
    expect(verdict.slow).toBe(true);
    expect(verdict.basis).toBe("turn_wall_clock");
  });

  it("ignores a wall clock on a call with no question attached", () => {
    expect(isSlowCall({ tool: "lucy_query", durationMs: 30, turnWallClockMs: null }).slow).toBe(false);
    expect(isSlowCall({ tool: "lucy_query", durationMs: 30 }).slow).toBe(false);
  });

  it("records result_empty only for a successful zero-row call", () => {
    expect(isEmptyResult({ outcome: "ok", responseRowCount: 0 })).toBe(true);
    expect(isEmptyResult({ outcome: "ok", responseRowCount: 3 })).toBe(false);
    expect(isEmptyResult({ outcome: "error", responseRowCount: 0 })).toBe(false);
    expect(isEmptyResult({ outcome: "denied", responseRowCount: 0 })).toBe(false);
    // An unknown row count is not evidence of an empty result.
    expect(isEmptyResult({ outcome: "ok", responseRowCount: null })).toBe(false);
  });

  it("reads its thresholds from configuration and defaults sensibly", () => {
    const previousCall = process.env.LUCY_SLOW_CALL_MIN_MS;
    const previousTurn = process.env.LUCY_SLOW_TURN_WALL_CLOCK_MS;
    delete process.env.LUCY_SLOW_CALL_MIN_MS;
    delete process.env.LUCY_SLOW_TURN_WALL_CLOCK_MS;
    expect(slowCallThresholdMs()).toBe(5_000);
    expect(slowTurnWallClockMs()).toBe(120_000);

    process.env.LUCY_SLOW_CALL_MIN_MS = "2000";
    expect(slowCallThresholdMs()).toBe(2_000);
    expect(isSlowCall({ tool: "lucy_query", durationMs: 2_500 }).slow).toBe(true);

    if (previousCall === undefined) delete process.env.LUCY_SLOW_CALL_MIN_MS;
    else process.env.LUCY_SLOW_CALL_MIN_MS = previousCall;
    if (previousTurn === undefined) delete process.env.LUCY_SLOW_TURN_WALL_CLOCK_MS;
    else process.env.LUCY_SLOW_TURN_WALL_CLOCK_MS = previousTurn;
  });

  it("keeps Spec 143's call-monitor threshold untouched", async () => {
    // The call monitor is a separate metric with its own 30s default.
    // SC-20 replaces the usage signal only.
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../ops/call-monitor.ts", import.meta.url), "utf8")
    );
    expect(source).toContain("LUCY_OBSERVABILITY_SLOW_MS");
    expect(source).toContain("30_000");
  });

  it("writes the question wall clock onto the access log", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const auditDbPath = path.join(os.tmpdir(), `lucy-slow-wall-${process.pid}-${Math.random().toString(36).slice(2)}.sqlite`);
    const previousAuditDb = process.env.LUCY_AUDIT_DB;
    process.env.LUCY_AUDIT_DB = auditDbPath;
    questionBudget.resetForTests();
    const started = Date.now() - 120_000;
    // Spec 162 修订 / Plan S2：慢问询标记读**稳定作用域**的 originStartedAt，
    // 不再按 `turn:<id>` 键读取（`ensureTurn` 在 stable 模式下不再建桶）。
    await questionBudget.beginQuestion({
      identityKey: budgetIdentityKey("analyst", "sha256:slow-test"),
      sessionId: "sess-wall",
      turnId: "turn-wall",
      now: started
    });
    expect(questionBudget.wallClockMs("turn-wall", started + 120_000)).toBe(120_000);
    // A continuation must not erase the original question start.
    questionBudget.consume("turn-wall", started + 120_000, "turn-wall");
    expect(questionBudget.wallClockMs("turn-wall", started + 120_000)).toBeGreaterThanOrEqual(120_000);

    const { writeLog, readR1AuditObservability, closeAuditDb } = await import("../proxy/audit.js");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "analyst",
      tool: "wiki_read",
      outcome: "ok",
      durationMs: 40,
      requestId: "wall-1",
      lucyTurnId: "turn-wall"
    });
    const view = await readR1AuditObservability({ hours: 24 });
    const slow = view.latency.slowQueries.find((query) => query.requestId === "wall-1");
    expect(slow?.tool).toBe("wiki_read");
    expect(slow?.slowBasis).toBe("turn_wall_clock");
    expect(view.latency.slowDefinition.effectiveAt).toBe(SLOW_DEFINITION_EFFECTIVE_AT);
    closeAuditDb();
    questionBudget.resetForTests();
    if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
    else process.env.LUCY_AUDIT_DB = previousAuditDb;
    await rm(auditDbPath, { force: true });
  });

  it("opens the question clock from the proxy before the call is forwarded", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../proxy/mcp-proxy.ts", import.meta.url), "utf8")
    );
    expect(source).toContain("questionBudget.ensureTurn");
    const guardAt = source.indexOf("applyLucyCallGuard");
    const forwardAt = source.indexOf("lucyQueryUpstreamArgs");
    expect(guardAt).toBeGreaterThan(0);
    expect(forwardAt).toBeGreaterThan(guardAt);
  });

  it("keeps the question drill-down isSlowCall as a P95-relative metric", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../admin/audit.ts", import.meta.url), "utf8")
    );
    // `isSlowCall` in the turn drill-down stays "above window P95".
    expect(source).toContain("isSlowCall: p95Ms > 0 && row.duration_ms > p95Ms");
  });
});