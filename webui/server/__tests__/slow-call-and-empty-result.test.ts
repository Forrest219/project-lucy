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
  isEmptyResult,
  isSlowCall,
  SLOW_CALL_MIN_DURATION_MS,
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

  it("keeps the question drill-down isSlowCall as a P95-relative metric", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../admin/audit.ts", import.meta.url), "utf8")
    );
    // `isSlowCall` in the turn drill-down stays "above window P95".
    expect(source).toContain("isSlowCall: p95Ms > 0 && row.duration_ms > p95Ms");
  });
});