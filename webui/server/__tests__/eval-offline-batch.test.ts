import { computeSuiteHash, parseEvalResultImport } from "../eval/suite-schema";
import { afterEach, describe, expect, it } from "vitest";
import type { EvalSuite, EvalSuiteCase } from "../../src/lib/types";
import {
  BatchRejectedError,
  bindWindow,
  resolveTimeZone,
  runOfflineBatch,
  summarizeOfflineResult,
  type QueryExecutor,
  type SemanticQuerySuccess
} from "../eval/offline-batch";

function suite(cases: EvalSuiteCase[]): EvalSuite {
  return {
    lucy_eval_schema_version: 2,
    kind: "lucy_eval_suite",
    suite_id: "sales_v2",
    domain: "sales",
    title: "销售",
    cases
  };
}

function item(overrides: Partial<EvalSuiteCase> = {}): EvalSuiteCase {
  return {
    id: "spend-by-platform",
    case_type: "single_turn",
    question: "各平台花费",
    expected_source: "semantic_layer",
    review_status: "active",
    as_of_binding: { kind: "yesterday" },
    executable: {
      required_measures: ["spend"],
      grain: ["platform"],
      required_columns: ["platform", "spend"],
      required_filters: [{ field: "stat_date", bind: "as_of_window" }]
    },
    ...overrides
  };
}

function okTable(overrides: Partial<SemanticQuerySuccess> = {}): SemanticQuerySuccess {
  return {
    ok: true,
    columns: ["platform", "spend"],
    grain: ["platform"],
    measures: ["spend"],
    filters: [{ field: "stat_date", value: "2026-10-10..2026-10-10" }],
    rows: [{ platform: "ios", spend: 10 }],
    sql: "select platform, spend",
    ...overrides
  };
}

const executor = (table: SemanticQuerySuccess | { ok: false; reason: string }): QueryExecutor => async () => table;

describe("offline batch", () => {
  afterEach(() => {
    delete process.env.LUCY_TIMEZONE;
  });

  it("produces an importable hash when a parsed/downloaded suite has no suite_hash", async () => {
    const input = suite([item()]);
    const result = await runOfflineBatch({ suite: input, asOf: "2026-10-11", roleId: "analyst", boundRoleIds: ["analyst"], executor: executor(okTable()) });
    expect(result.suite_hash).toBe(computeSuiteHash(input));
    expect(parseEvalResultImport(JSON.stringify(result)).ok).toBe(true);
  });

  it("rejects a batch when the role is missing or unbound", async () => {
    await expect(runOfflineBatch({
      suite: suite([item()]),
      asOf: "2026-10-11",
      roleId: "",
      boundRoleIds: ["analyst"],
      executor: executor(okTable())
    })).rejects.toBeInstanceOf(BatchRejectedError);
    await expect(runOfflineBatch({
      suite: suite([item()]),
      asOf: "2026-10-11",
      roleId: "other",
      boundRoleIds: ["analyst"],
      executor: executor(okTable())
    })).rejects.toBeInstanceOf(BatchRejectedError);
  });

  it("uses the deployment timezone when the batch omits one", () => {
    expect(resolveTimeZone()).toBe("UTC");
    process.env.LUCY_TIMEZONE = "Asia/Shanghai";
    expect(resolveTimeZone()).toBe("Asia/Shanghai");
    expect(resolveTimeZone("Pacific/Auckland")).toBe("Pacific/Auckland");
    const utc = bindWindow({ kind: "yesterday" }, "2026-10-11", "UTC");
    const auckland = bindWindow({ kind: "yesterday" }, "2026-10-11", "Pacific/Auckland");
    expect(utc).toEqual({ start: "2026-10-10", end: "2026-10-10" });
    expect(auckland?.start).not.toBe(utc?.start);
  });

  it("skips needs_review and leaves it out of the pass rate", async () => {
    const result = await runOfflineBatch({
      suite: suite([item({ review_status: "needs_review" })]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: executor(okTable())
    });
    expect(result.results[0]?.status).toBe("SKIPPED");
    expect(summarizeOfflineResult(result).totalCases).toBe(0);
    expect(result.complete).toBe(true);
  });

  it("marks a missing business measure, column, coarser grain, or filter as answered wrong", async () => {
    const cases: Array<[string, SemanticQuerySuccess]> = [
      ["missing_business_measure", okTable({ measures: ["row_count"], columns: ["platform", "row_count"] })],
      ["missing_column", okTable({ columns: ["spend"] })],
      ["grain_coarser", okTable({ grain: [] })],
      ["filter_mismatch", okTable({ filters: [] })]
    ];
    for (const [reason, table] of cases) {
      const result = await runOfflineBatch({
        suite: suite([item()]),
        asOf: "2026-10-11",
        roleId: "analyst",
        boundRoleIds: ["analyst"],
        executor: executor(table)
      });
      expect(result.results[0]?.outcome).toBe("answered_wrong");
      expect(result.results[0]?.reason).toBe(reason);
    }
  });

  it("keeps a forbidden statement as answered ok and records the policy column", async () => {
    const result = await runOfflineBatch({
      suite: suite([item({
        sql_assertions: [{ type: "forbidden_ast", value: "select *", reason: "禁止通配" }]
      })]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: executor(okTable({ sql: "select *" }))
    });
    expect(result.results[0]?.outcome).toBe("answered_ok");
    expect(result.results[0]?.policy_status).toBe("noncompliant");
  });

  it("records reconciliation failure as answered wrong and a compile failure as not answered", async () => {
    const mismatch = await runOfflineBatch({
      suite: suite([item({
        executable: {
          required_measures: ["spend"],
          grain: ["platform"],
          required_columns: ["platform", "spend"],
          required_filters: [],
          reconciliation: [{
            id: "sum-equals",
            left: { measures: ["spend"], grain: ["platform"] },
            right: { measures: ["spend"], grain: [] },
            relation: "sum_equals"
          }]
        }
      })]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: async (request) => okTable({
        rows: [{ spend: request.grain.length > 0 ? 10 : 4 }],
        filters: []
      })
    });
    expect(mismatch.results[0]?.reason).toBe("reconciliation_mismatch");

    const unanswered = await runOfflineBatch({
      suite: suite([item()]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: executor({ ok: false, reason: "measure_unbound" })
    });
    expect(unanswered.results[0]?.outcome).toBe("not_answered");
    expect(unanswered.complete).toBe(true);
    const summary = summarizeOfflineResult(unanswered);
    expect(summary.totalCases).toBe(0);
    expect(summary.notAnsweredCount).toBe(1);
  });

  it("continues after one interrupted case and marks a missing runnable case incomplete", async () => {
    const interrupted = await runOfflineBatch({
      suite: suite([item(), item({ id: "other-spend" })]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: async (request) => {
        if (request.measures.includes("spend") && request.grain.includes("platform")) throw new Error("down");
        return okTable();
      }
    });
    expect(interrupted.results.some((row) => row.reason === "execution_interrupted")).toBe(true);
    expect(interrupted.complete).toBe(true);

    const incomplete = await runOfflineBatch({
      suite: suite([item({ executable: undefined })]),
      asOf: "2026-10-11",
      roleId: "analyst",
      boundRoleIds: ["analyst"],
      executor: executor(okTable())
    });
    expect(incomplete.complete).toBe(false);
    expect(incomplete.runner.model).toBe("");
    expect(incomplete.runner.kind).toBe("lucy_offline_batch");
  });
});
