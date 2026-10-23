/**
 * WO-202610-13 T4 / SC-15 — 内建度量.
 *
 * `count(*)` without a source points at `row_count(source)`. Wrapping an
 * already aggregated published measure in `sum` never produces `sum(sum())`.
 * A completeness measure with no declared denominator is refused.
 */
import { describe, expect, it } from "vitest";
import {
  compileBuiltinMeasure,
  ROW_COUNT_MEASURE_HINT,
} from "../proxy/question-experience.js";

describe("built-in measure guardrails", () => {
  it("points count(*) without a source at row_count(source)", () => {
    for (const measure of ["count(*)", "COUNT( * )", "count(1)", "COUNT(1)", "count *"]) {
      const decision = compileBuiltinMeasure({ measure });
      expect(decision.action).toBe("repair");
      if (decision.action !== "repair") return;
      expect(decision.reason).toBe("count_without_source");
      expect(decision.repair).toBe(ROW_COUNT_MEASURE_HINT);
      expect(decision.repair).toContain("row_count");
      expect(decision.repair).toContain("source");
    }
  });

  it("compiles count(*) once a source is declared", () => {
    const decision = compileBuiltinMeasure({ measure: "count(*)", source: "demo.orders" });
    expect(decision.action).toBe("compile");
  });

  it("never generates sum(sum()) over an already aggregated measure", () => {
    const decision = compileBuiltinMeasure({
      measure: "sum(demo.orders.monthly_revenue)",
      source: "demo.orders",
      aggregatedMeasures: ["monthly_revenue"]
    });
    expect(decision.action).toBe("repair");
    if (decision.action !== "repair") return;
    expect(decision.reason).toBe("aggregate_of_aggregate");
    expect(decision.repair).toContain("monthly_revenue");
    // The repair points at the published measure, never at a nested sum.
    expect(decision.repair).not.toContain("sum(sum");
  });

  it("matches the aggregated measure with or without its source prefix", () => {
    const prefixed = compileBuiltinMeasure({
      measure: "sum(monthly_revenue)",
      source: "demo.orders",
      aggregatedMeasures: ["demo.orders.monthly_revenue"]
    });
    expect(prefixed.action).toBe("repair");

    const bare = compileBuiltinMeasure({
      measure: "sum(demo.orders.monthly_revenue)",
      source: "demo.orders",
      aggregatedMeasures: ["monthly_revenue"]
    });
    expect(bare.action).toBe("repair");
  });

  it("refuses a literal sum(sum()) even when the inner name is not registered", () => {
    const decision = compileBuiltinMeasure({ measure: "sum(sum(amount))", source: "demo.orders" });
    expect(decision.action).toBe("repair");
    if (decision.action !== "repair") return;
    expect(decision.reason).toBe("aggregate_of_aggregate");
    expect(decision.repair).not.toContain("sum(sum");
  });

  it("compiles sum() over a measure that is not already aggregated", () => {
    const decision = compileBuiltinMeasure({
      measure: "sum(demo.orders.amount)",
      source: "demo.orders",
      aggregatedMeasures: ["monthly_revenue"]
    });
    expect(decision.action).toBe("compile");
    if (decision.action !== "compile") return;
    expect(decision.measure).toBe("sum(demo.orders.amount)");
  });

  it("refuses to compile a completeness measure with no declared denominator", () => {
    const decision = compileBuiltinMeasure({ measure: "completeness_ratio", source: "demo.orders" });
    expect(decision.action).toBe("reject");
    if (decision.action !== "reject") return;
    expect(decision.reason).toBe("completeness_denominator_required");
    expect(decision.message).toContain("分母");
  });

  it("compiles a completeness measure once numerator and denominator grain are declared", () => {
    const decision = compileBuiltinMeasure({
      measure: "completeness_ratio",
      source: "demo.orders",
      completenessDenominator: "demo.orders.expected_rows"
    });
    expect(decision.action).toBe("compile");
  });

  it("routes an empty measure to the same row_count repair", () => {
    const decision = compileBuiltinMeasure({ measure: "   " });
    expect(decision.action).toBe("repair");
    if (decision.action !== "repair") return;
    expect(decision.repair).toBe(ROW_COUNT_MEASURE_HINT);
  });
});