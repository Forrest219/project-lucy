import { describe, expect, it } from "vitest";
import {
  extractQueryTables,
  looksLikeSql,
  redactQuestionText,
  scrubArgsSummaryJson,
  summarizeArgsForAudit
} from "../proxy/audit-privacy";

describe("audit-privacy Spec 137", () => {
  it("redactQuestionText masks email and mobile", () => {
    const text = "联系 alice@example.com 或 13800138000";
    const out = redactQuestionText(text);
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("13800138000");
    expect(out).toContain("[REDACTED]");
  });

  it("summarizeArgsForAudit never keeps raw question", () => {
    const summary = summarizeArgsForAudit("lucy_begin_question", {
      question: "请查利润，邮箱 bob@corp.com",
      intentSummary: "利润分析 token=secret123",
      connectionId: "kc"
    });
    expect(summary).not.toHaveProperty("question");
    expect(summary).not.toHaveProperty("questionPreview");
    expect(summary).not.toHaveProperty("intentSummary");
    expect(summary.connectionId).toBe("kc");
  });

  it("summarizeArgsForAudit keeps filter shape without business values", () => {
    const summary = summarizeArgsForAudit("lucy_query", {
      connectionId: "warehouse",
      filters: [
        { field: "orders.customer", op: "eq", value: "Sensitive Customer" },
        { field: "orders.region", op: "in", values: ["North", "South"] }
      ]
    });
    expect(summary.filters).toEqual({
      kind: "list",
      count: 2,
      items: [
        { kind: "structured", field: "orders.customer", op: "eq", valueCount: 1 },
        { kind: "structured", field: "orders.region", op: "in", valueCount: 2 }
      ]
    });
    expect(JSON.stringify(summary)).not.toContain("Sensitive Customer");
    expect(JSON.stringify(summary)).not.toContain("North");
    expect(JSON.stringify(summary)).not.toContain("South");

    const malformed = summarizeArgsForAudit("lucy_query", {
      filters: '[{"field":"orders.customer","value":"Secret Name"}'
    });
    expect(JSON.stringify(malformed)).not.toContain("Secret Name");

    const invalidStructured = summarizeArgsForAudit("lucy_query", {
      filters: [{ field: "Sensitive Customer", op: "eq; Secret Name", value: "North" }]
    });
    expect(invalidStructured.filters).toEqual({
      kind: "list",
      count: 1,
      items: [{ kind: "structured", valueCount: 1 }]
    });
    expect(JSON.stringify(invalidStructured)).not.toContain("Sensitive Customer");
    expect(JSON.stringify(invalidStructured)).not.toContain("Secret Name");
  });

  it("looksLikeSql rejects NL table list and accepts SELECT", () => {
    expect(looksLikeSql("show me the table list please")).toBe(false);
    expect(looksLikeSql("please select revenue from the table list")).toBe(false);
    expect(looksLikeSql("SELECT id FROM orders")).toBe(true);
    expect(extractQueryTables("show me the table list please")).toEqual([]);
    expect(extractQueryTables("SELECT id FROM orders JOIN users u ON u.id = orders.uid")).toEqual([
      "orders",
      "users"
    ]);
  });

  it("scrubArgsSummaryJson removes every natural-language copy", () => {
    const raw = JSON.stringify({
      question: "完整原文 alice@example.com",
      questionPreview: "预览",
      intentSummary: "摘要",
      connectionId: "warehouse"
    });
    const result = scrubArgsSummaryJson(raw);
    expect(result.changed).toBe(true);
    const parsed = JSON.parse(result.nextJson!) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("question");
    expect(parsed).not.toHaveProperty("questionPreview");
    expect(parsed).not.toHaveProperty("intentSummary");
    expect(parsed.connectionId).toBe("warehouse");
  });
});
