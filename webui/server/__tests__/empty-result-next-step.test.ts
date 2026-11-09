/**
 * Spec 20261107 §7 — 空结果下一步指导的纯函数合同（SC-01…SC-08／SC-17／SC-21）。
 */
import { describe, expect, it } from "vitest";
import {
  buildEmptyResultNextStep,
  CHECK_GRAIN_SUGGESTION,
  CHECK_PERIOD_SUGGESTION,
  EMPTY_RESULT_HINT,
  EMPTY_RESULT_SUMMARY,
  NEXT_STEP_TOOLS,
  NO_TOOL_HINT,
  RELAX_FILTER_SUGGESTION,
  SCOPE_SUGGESTION,
  SCOPE_SUMMARY
} from "../proxy/question-experience.js";
import { summarizeFilters } from "../proxy/audit-privacy.js";

describe("buildEmptyResultNextStep", () => {
  it("SC-01 对 lucy_query 的 0 行返回 empty_result 指导", () => {
    // F08：必须显式传可见工具；缺省 visibleTools=[] → hint=NO_TOOL_HINT（见 SC-17）
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      visibleTools: ["lucy_read_source", "lucy_freshness"]
    });
    expect(step).not.toBeNull();
    expect(step?.kind).toBe("empty_result");
    expect(step?.summary).toBe(EMPTY_RESULT_SUMMARY);
    expect(step?.hint).toBe(EMPTY_RESULT_HINT);
    expect(step?.next_tools).toEqual(["lucy_read_source", "lucy_freshness"]);
  });

  it("SC-02 有数据时不带指导", () => {
    expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 3 })).toBeNull();
  });

  it("SC-03 行数未知／非有限／非严格 0 时不判空", () => {
    expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: null })).toBeNull();
    expect(buildEmptyResultNextStep({ toolName: "lucy_query" })).toBeNull();
    expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: -1 })).toBeNull();
    expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: Number.NaN })).toBeNull();
    expect(buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("SC-04 非 lucy_query 工具不带指导", () => {
    expect(buildEmptyResultNextStep({ toolName: "lucy_read_source", rowCount: 0 })).toBeNull();
    expect(buildEmptyResultNextStep({ toolName: "entity_details", rowCount: 0 })).toBeNull();
  });

  it("SC-05 query 只含存在的键，filters 用去值摘要", () => {
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      provenance: { sourceName: "sales_order", connectionId: null, measures: ["revenue"] },
      filtersSummary: {
        kind: "list",
        count: 1,
        items: [{ kind: "structured", field: "company", op: "contains", valueCount: 1 }]
      }
    });
    expect(step?.query).toEqual({
      sourceName: "sales_order",
      measures: ["revenue"],
      filters: {
        kind: "list",
        count: 1,
        items: [{ kind: "structured", field: "company", op: "contains", valueCount: 1 }]
      }
    });
    expect(Object.prototype.hasOwnProperty.call(step?.query ?? {}, "connectionId")).toBe(false);
  });

  it("SC-05 filters 缺省时不出现该键，且不含任何原始值字段", () => {
    const step = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0 });
    expect(Object.prototype.hasOwnProperty.call(step?.query ?? {}, "filters")).toBe(false);
    const withRaw = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      provenance: { filters: [{ field: "company", op: "contains", value: "某某公司" }] }
    });
    // provenance 里的 filters 不被采纳——只有 filtersSummary 生效
    expect(Object.prototype.hasOwnProperty.call(withRaw?.query ?? {}, "filters")).toBe(false);
  });

  it("SC-06 next_tools 只含调用者可见的工具，无通配语义", () => {
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      visibleTools: ["lucy_read_source"]
    });
    expect(step?.next_tools).toEqual(["lucy_read_source"]);
    expect(step?.next_tools).not.toContain("lucy_freshness");
    const none = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0, visibleTools: [] });
    expect(none?.next_tools).toEqual([]);
    expect(none?.suggestions.length).toBeGreaterThan(0); // D10：工具为空不降级建议
  });

  it("SC-07 行权限交集空时分流 kind 且不给泛化建议", () => {
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      scopeIntersectionEmpty: true
    });
    expect(step?.kind).toBe("scope_intersection_empty");
    expect(step?.summary).toBe(SCOPE_SUMMARY);
    expect(step?.suggestions).toContain(SCOPE_SUGGESTION);
    expect(step?.suggestions).not.toContain(RELAX_FILTER_SUGGESTION);
    // N4：不预设成因——不得断言「取值不在授权范围内」
    expect(step?.summary).not.toContain("不在授权范围内");
    expect(step?.suggestions.join(" ")).not.toContain("不在授权范围内");
  });

  it("SC-08 hint 与 summary 不含结论性判断", () => {
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      visibleTools: ["lucy_read_source"]
    });
    for (const text of [step?.summary ?? "", step?.hint ?? ""]) {
      expect(text).not.toContain("数据错误");
      expect(text).not.toContain("数据缺失");
    }
    expect(NEXT_STEP_TOOLS.length).toBe(2);
    expect(CHECK_PERIOD_SUGGESTION.length).toBeGreaterThan(0);
    expect(CHECK_GRAIN_SUGGESTION.length).toBeGreaterThan(0);
  });

  it("SC-17 next_tools 为空时 hint 明说没有可用工具", () => {
    const none = buildEmptyResultNextStep({ toolName: "lucy_query", rowCount: 0, visibleTools: [] });
    expect(none?.next_tools).toEqual([]);
    expect(none?.suggestions.length).toBe(3);
    expect(none?.hint).toBe(NO_TOOL_HINT);
    expect(none?.hint).toContain("没有可用的核对工具");
    const some = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      visibleTools: ["lucy_read_source"]
    });
    expect(some?.hint).toBe(EMPTY_RESULT_HINT);
  });

  it("SC-21 measures/dimensions/orderBy 白名单与真实 schema 对齐", () => {
    const step = buildEmptyResultNextStep({
      toolName: "lucy_query",
      rowCount: 0,
      visibleTools: ["lucy_read_source"],
      provenance: {
        measures: [{ expr: "sum(revenue)", rows: 999, name: "x" }],
        dimensions: [
          { field: "sales_order.month", granularity: "month", extra: true },
          "month" // 字符串维度：真实 schema 不接受 → 整项丢弃
        ],
        orderBy: [{ field: "sales_order.month", direction: "asc", rows: [] }]
      }
    });
    expect(step?.query?.measures).toEqual([{ expr: "sum(revenue)" }]);
    expect(step?.query?.dimensions).toEqual([{ field: "sales_order.month", granularity: "month" }]);
    expect(step?.query?.orderBy).toEqual([{ field: "sales_order.month", direction: "asc" }]);
    const payload = JSON.stringify(step);
    for (const banned of ["\"rows\"", "\"totalRows\"", "\"columns\"", "\"headers\"", "\"extra\""]) {
      expect(payload).not.toContain(banned);
    }
  });

  it("SC-05 去值摘要形状与 summarizeFilters 真实输出一致", () => {
    // N11：纯函数不自己造摘要形状——直接用 audit-privacy 的真实实现喂进去
    const structured = summarizeFilters([{ field: "company", op: "contains", value: "某某公司" }]);
    expect(structured.kind).toBe("list");
    expect(structured.count).toBe(1);
    const expression = summarizeFilters(["company like '%X%'"]);
    expect((expression.items as Record<string, unknown>[])[0]?.kind).toBe("expression");
    expect((expression.items as Record<string, unknown>[])[0]).not.toHaveProperty("field");
    expect((expression.items as Record<string, unknown>[])[0]).not.toHaveProperty("op");
    const single = summarizeFilters({ field: "company", op: "eq", value: "X" });
    expect(single.kind).toBe("single");
  });
});
