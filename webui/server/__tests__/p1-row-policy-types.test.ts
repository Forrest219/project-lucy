import { describe, expect, it } from "vitest";
import {
  ROW_POLICY_TEMPLATE_NAME_PATTERN,
  expandRowPolicy,
  scanTemplateReferences
} from "../admin/row-policy-types.js";

const template = {
  name: "by_region",
  description: "按大区限定行",
  predicates: [{ field: "region_code", op: "eq" as const, value: "CN-EAST" }]
};

describe("P1 row policy template vocabulary", () => {
  it("expands a template reference into the compiler's predicate list", () => {
    const result = expandRowPolicy({
      templateName: "by_region",
      template,
      inlinePredicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Display order is fixed: template predicates first, inline after.
    expect(result.expanded.predicates.map((p) => p.field)).toEqual(["region_code", "status"]);
    expect(result.expanded.templateName).toBe("by_region");
    expect(result.expanded.templatePredicateCount).toBe(1);
    expect(result.expanded.inlinePredicateCount).toBe(1);
  });

  it("fails closed on a missing template reference instead of degrading to no restriction", () => {
    // No template referenced at all → a plain inline selector is legal.
    const inlineOnly = expandRowPolicy({ inlinePredicates: [{ field: "status", op: "eq", value: "SETTLED" }] });
    expect(inlineOnly.ok).toBe(true);

    // A template IS referenced but the definition is gone → unresolved, fail closed.
    const unresolved = expandRowPolicy({
      templateName: "by_region",
      template: null,
      inlinePredicates: [{ field: "status", op: "eq", value: "SETTLED" }]
    });
    expect(unresolved.ok).toBe(false);
    if (unresolved.ok) return;
    expect(unresolved.issues[0].code).toBe("row_policy_template_unresolved");
    expect(unresolved.issues[0].templateName).toBe("by_region");
  });

  it("refuses an empty predicate set", () => {
    const result = expandRowPolicy({
      templateName: "empty",
      template: { name: "empty", predicates: [] },
      inlinePredicates: []
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toContain("row_policy_predicates_required");
  });

  it("finds every selector referencing a template", () => {
    const references = scanTemplateReferences(
      [
        { roleId: "finance_reader", schema: "finance", sourceNames: ["orders"], templateName: "by_region" },
        { roleId: "ops_reader", schema: "ops", templateName: "other" },
        { roleId: "finance_reader", schema: "finance", sourceNames: ["items"], templateName: "by_region" }
      ],
      "by_region"
    );
    expect(references).toHaveLength(2);
    expect(references.map((ref) => ref.roleId)).toEqual(["finance_reader", "finance_reader"]);
  });

  it("accepts only names usable as YAML keys and identifiers", () => {
    expect(ROW_POLICY_TEMPLATE_NAME_PATTERN.test("by_region")).toBe(true);
    expect(ROW_POLICY_TEMPLATE_NAME_PATTERN.test("by-region")).toBe(true);
    expect(ROW_POLICY_TEMPLATE_NAME_PATTERN.test("1by_region")).toBe(false);
    expect(ROW_POLICY_TEMPLATE_NAME_PATTERN.test("by region")).toBe(false);
  });
});
