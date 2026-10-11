/**
 * WO-202610-13 T7 / SC-17 — 失败维度.
 *
 * The sampling is locked as automated assertions, not eyeballed logs.
 * `COUNT(*)`, `wiki_not_found` and `explicit_table_required:<empty>` are
 * 用法与语义; `AS field` is 过滤条件下推; a timeout is 引擎超时与并发;
 * `table_forbidden`, `wiki_forbidden` and a named
 * `explicit_table_required` are 权限拒绝. `budget_stop` enters no dimension.
 */
import { describe, expect, it } from "vitest";
import { classifyFailure } from "../proxy/question-experience.js";

type Case = { name: string; input: Parameters<typeof classifyFailure>[0]; expected: string };

const KSC_STRUCT = "STRUCT('month' AS field, '=' AS op, '2026-09' AS val)";
const MJ_TRUNCATED = "errCode = 2, detailMessage = ...RUCT(";

const SAMPLING: Case[] = [
  // 用法与语义 — a bare COUNT(*) is a usage mistake, not a platform fault.
  {
    name: "COUNT(*) reported as upstream_error",
    input: { outcome: "error", decisionReason: "upstream_error", errorDetail: "SQL syntax error near COUNT(*) at line 1" },
    expected: "用法与语义"
  },
  {
    name: "COUNT(*) with no decision reason",
    input: { outcome: "error", errorDetail: "Invalid use of group function COUNT(*)" },
    expected: "用法与语义"
  },
  {
    name: "wiki_not_found (model guessed a file name)",
    input: { outcome: "error", decisionReason: "wiki_not_found", errorDetail: "公司合并.md" },
    expected: "用法与语义"
  },
  {
    name: "explicit_table_required with an empty table",
    input: { outcome: "denied", decisionReason: "explicit_table_required:<empty>" },
    expected: "用法与语义"
  },
  // 过滤条件下推
  {
    name: "KSC MySQL STRUCT filter",
    input: { outcome: "error", decisionReason: "upstream_error", errorDetail: KSC_STRUCT },
    expected: "过滤条件下推"
  },
  {
    name: "MJ Doris truncated ...RUCT( fragment",
    input: { outcome: "error", decisionReason: "upstream_error", errorDetail: MJ_TRUNCATED },
    expected: "过滤条件下推"
  },
  {
    name: "compiler_reason filter_pushdown with truncated engine text",
    input: { outcome: "error", decisionReason: "filter_pushdown", errorDetail: MJ_TRUNCATED },
    expected: "过滤条件下推"
  },
  // 引擎超时与并发
  {
    name: "explicit timeout reason",
    input: { outcome: "error", decisionReason: "timeout" },
    expected: "引擎超时与并发"
  },
  {
    name: "concurrency limit",
    input: { outcome: "error", decisionReason: "query_concurrency_exceeded" },
    expected: "引擎超时与并发"
  },
  {
    name: "Timeout inside the error detail",
    input: { outcome: "error", decisionReason: "upstream_error", errorDetail: "Query execution was Timeout" },
    expected: "引擎超时与并发"
  },
  // 权限拒绝
  {
    name: "table_forbidden",
    input: { outcome: "denied", decisionReason: "table_forbidden:secret_payroll" },
    expected: "权限拒绝"
  },
  {
    name: "wiki_forbidden",
    input: { outcome: "denied", decisionReason: "wiki_forbidden" },
    expected: "权限拒绝"
  },
  {
    name: "explicit_table_required naming a table",
    input: { outcome: "denied", decisionReason: "explicit_table_required:secret_payroll" },
    expected: "权限拒绝"
  },
  // budget_stop belongs to no dimension
  {
    name: "question budget stop",
    input: { outcome: "budget_stop", decisionReason: "question_budget_exhausted" },
    expected: ""
  },
  {
    name: "a successful call has no dimension",
    input: { outcome: "ok" },
    expected: ""
  }
];

describe("failure dimension sampling (SC-17)", () => {
  it.each(SAMPLING)("classifies $name as $expected", ({ input, expected }) => {
    expect(classifyFailure(input)).toBe(expected);
  });

  it("never lets wiki_not_found leak into 权限拒绝", () => {
    expect(classifyFailure({ outcome: "denied", decisionReason: "wiki_not_found" }))
      .not.toBe("权限拒绝");
    expect(classifyFailure({ outcome: "error", decisionReason: "wiki_not_found" }))
      .toBe("用法与语义");
  });

  it("separates the empty and named explicit_table_required cases", () => {
    expect(classifyFailure({ outcome: "denied", decisionReason: "explicit_table_required:<empty>" }))
      .toBe("用法与语义");
    expect(classifyFailure({ outcome: "denied", decisionReason: "explicit_table_required:orders" }))
      .toBe("权限拒绝");
  });

  it("keeps budget_stop out of every dimension", () => {
    for (const outcome of ["budget_stop", "ok", "error", "denied"]) {
      const dimension = classifyFailure({ outcome, decisionReason: "question_budget_exhausted" });
      if (outcome === "budget_stop") expect(dimension).toBe("");
    }
  });

  it("treats an unconfigured connection as 用法与语义 even under upstream_error", () => {
    // Spec 162 §7.3: only unknown_or_forbidden_connection:* is 权限拒绝.
    expect(classifyFailure({
      outcome: "error",
      decisionReason: "upstream_error",
      errorDetail: 'Connection "sql_server" is not configured in ktx.yaml'
    })).toBe("用法与语义");
    expect(classifyFailure({
      outcome: "denied",
      decisionReason: "unknown_or_forbidden_connection:sql_server"
    })).toBe("权限拒绝");
  });
});