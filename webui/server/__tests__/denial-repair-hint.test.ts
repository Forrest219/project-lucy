/**
 * WO-202610-13 T5 / SC-14 — 拒绝名单.
 *
 * `discover_data`, `entity_details`, `dictionary_search`, `lucy_query` and
 * `lucy_read_source` share one allow-list function. The list contains only
 * connections and sources inside the caller's ACL; a name outside it must
 * never appear in the payload.
 */
import { describe, expect, it } from "vitest";
import { classifyFailure, denialAllowList, repairHint } from "../proxy/question-experience.js";

const ACL = {
  connections: ["demo", "reporting"],
  sources: [
    { sourceName: "orders", table: "demo.orders" },
    { sourceName: "revenue", table: "demo.revenue" }
  ]
};

describe("permission denial allow list", () => {
  it("returns exactly the connections and sources inside the ACL", () => {
    const allow = denialAllowList(ACL);
    expect(allow.connections).toEqual(["demo", "reporting"]);
    expect(allow.sources).toEqual(["orders", "revenue"]);
  });

  it("drops anything outside the ACL", () => {
    const allow = denialAllowList(ACL);
    expect(allow.sources).not.toContain("secret_payroll");
    expect(allow.connections).not.toContain("prod_finance");
    expect(JSON.stringify(allow)).not.toContain("secret");
  });

  it("de-duplicates and sorts so the same role always sees one stable list", () => {
    const allow = denialAllowList({
      connections: ["reporting", "demo", "demo"],
      sources: [
        { sourceName: "revenue" },
        { sourceName: "orders" },
        { sourceName: "orders" }
      ]
    });
    expect(allow.connections).toEqual(["demo", "reporting"]);
    expect(allow.sources).toEqual(["orders", "revenue"]);
  });

  it("falls back to the table name when a source carries no sourceName", () => {
    const allow = denialAllowList({ connections: [], sources: [{ table: "demo.orders" }] });
    expect(allow.sources).toEqual(["demo.orders"]);
  });

  it("survives an empty ACL without inventing names", () => {
    const allow = denialAllowList({ connections: [], sources: [] });
    expect(allow.connections).toEqual([]);
    expect(allow.sources).toEqual([]);
  });

  it("keeps the repair hint inside the same list for every denial dimension", () => {
    const allowedSources = new Set(ACL.sources.map((source) => source.sourceName));
    const hint = repairHint(
      {
        failureDimension: "权限拒绝",
        suggestedSources: [...ACL.sources.map((s) => s.sourceName), "secret_payroll"]
      },
      allowedSources
    );
    expect(hint ?? "").not.toContain("secret_payroll");
  });

  it("classifies the denial reasons that must carry the list into 权限拒绝", () => {
    for (const reason of [
      "table_forbidden:secret_payroll",
      "explicit_table_required:secret_payroll",
      "wiki_forbidden",
      "sensitive_metadata_forbidden:kx",
      "raw_query_forbidden",
      "unknown_or_forbidden_connection:prod",
      "tool_unclassified:new_tool"
    ]) {
      expect(classifyFailure({ outcome: "denied", decisionReason: reason })).toBe("权限拒绝");
    }
  });

  it("does not attach the list to usage-and-semantic failures", () => {
    // Repair hints for this dimension point at measures, not ACL names.
    expect(classifyFailure({ outcome: "denied", decisionReason: "explicit_table_required:<empty>" }))
      .toBe("用法与语义");
    expect(classifyFailure({ outcome: "error", decisionReason: "wiki_not_found" }))
      .toBe("用法与语义");
  });
});