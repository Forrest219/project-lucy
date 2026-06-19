import { describe, expect, it } from "vitest";
import { RunnerPrecheckFailedError, mapSummaryCaseToRunCase, preflightClaude } from "../eval/runner";
import type { EvalCase } from "../eval/cases";

describe("eval runner summary mapping", () => {
  it("maps runner summary fields into run_case detail columns", () => {
    const evalCase: EvalCase = {
      id: "superstore-discount-001",
      case_type: "single_turn",
      domain: "superstore",
      result_assertions: [
        { value_type: "scalar", compare_mode: "approx", data: { weighted_discount: 0.1398 } }
      ]
    };

    const row = mapSummaryCaseToRunCase(
      42,
      {
        id: "superstore-discount-001",
        pass: false,
        failures: ["result mismatch: weighted_discount expected 0.1398 got 0.14"],
        sql: "SELECT SUM(discount * sales) / SUM(sales) FROM superstore_orders",
        result: { weighted_discount: 0.14 },
        finalText: "weighted_discount is 0.14"
      },
      evalCase
    );

    expect(row).toMatchObject({
      run_id: 42,
      case_id: "superstore-discount-001",
      status: "FAIL",
      drift: "data_drift",
      sql: "SELECT SUM(discount * sales) / SUM(sales) FROM superstore_orders",
      error_message: "result mismatch: weighted_discount expected 0.1398 got 0.14",
      final_text: "weighted_discount is 0.14"
    });
    expect(JSON.parse(row.expected_raw ?? "null")).toEqual(evalCase.result_assertions);
    expect(JSON.parse(row.actual_raw ?? "null")).toEqual({ weighted_discount: 0.14 });
    expect(JSON.parse(row.result_raw ?? "null")).toEqual({ weighted_discount: 0.14 });
    expect(JSON.parse(row.failed_assertions ?? "[]")).toEqual([
      "result mismatch: weighted_discount expected 0.1398 got 0.14"
    ]);
  });

  it("classifies SQL failures as logic regressions", () => {
    const row = mapSummaryCaseToRunCase(1, {
      id: "case-sql",
      pass: false,
      failures: ["required sql pattern missing: SUM(profit)"]
    });

    expect(row.drift).toBe("logic_regression");
  });

  it("passes claude preflight only when auth status exits successfully", async () => {
    await expect(preflightClaude("/tmp/project", async (cmd, args, cwd) => {
      expect(cmd).toBe("claude");
      expect(args).toEqual(["auth", "status"]);
      expect(cwd).toBe("/tmp/project");
      return { code: 0, stdout: "ok", stderr: "" };
    })).resolves.toBeUndefined();

    await expect(preflightClaude("/tmp/project", async () => ({
      code: 1,
      stdout: "",
      stderr: "not logged in"
    }))).rejects.toBeInstanceOf(RunnerPrecheckFailedError);
  });
});
