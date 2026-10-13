import { describe, expect, it } from "vitest";
import { decisionReasonLabel } from "../lib/decisionReasonLabels";

describe("decisionReasonLabel", () => {
  it.each([
    ["completeness_denominator_required", "完整度度量缺少分母"],
    ["aggregate_of_aggregate", "不能对聚合结果再聚合"],
    ["ambiguous_field", "字段名在多个表中出现"],
    ["source_not_found", "找不到对应的数据来源"],
    ["count_without_source", "计数缺少数据来源"]
  ])("maps %s to a Chinese reason phrase", (code, label) => {
    expect(decisionReasonLabel(code)).toBe(label);
  });

  it("keeps the unknown-code fallback", () => {
    expect(decisionReasonLabel("weird_code")).toBe("未识别裁决原因");
    expect(decisionReasonLabel(null)).toBe("未识别裁决原因");
  });
});
