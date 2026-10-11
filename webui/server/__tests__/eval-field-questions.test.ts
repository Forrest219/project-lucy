import { describe, expect, it } from "vitest";
import { extractFieldQuestionGroups, type FieldPack } from "../eval/field-questions";
import { clientFamily } from "../eval/monitor";

function pack(overrides: Partial<FieldPack> = {}): FieldPack {
  return {
    domain: "sales",
    completeness: { complete: true },
    calls: [
      {
        tool: "lucy_query",
        outcome: "error",
        decisionReason: "measure_unbound",
        sourceMapVersion: "map-a",
        measures: ["spend"],
        dimensions: ["platform"],
        filterFields: ["stat_date"],
        roleIds: ["analyst"],
        seenOn: "2026-10-10"
      },
      {
        tool: "lucy_query",
        outcome: "error",
        decisionReason: "measure_unbound",
        sourceMapVersion: "map-a",
        measures: ["spend"],
        dimensions: ["platform"],
        filterFields: ["stat_date"],
        roleIds: ["analyst"],
        seenOn: "2026-10-11"
      }
    ],
    ...overrides
  };
}

describe("field questions", () => {
  it("refuses an incomplete pack and does not group the calls", () => {
    const extracted = extractFieldQuestionGroups(pack({ completeness: { complete: false } }));
    expect(extracted.refused).toBeTruthy();
    expect(extracted.groups).toEqual([]);
  });

  it("drops permission denials and successful calls", () => {
    const extracted = extractFieldQuestionGroups(pack({
      calls: [
        {
          tool: "lucy_query",
          outcome: "denied",
          decisionReason: "table_forbidden:orders",
          sourceMapVersion: "map-a",
          measures: ["spend"],
          seenOn: "2026-10-10"
        },
        {
          tool: "lucy_query",
          outcome: "ok",
          sourceMapVersion: "map-a",
          measures: ["spend"],
          seenOn: "2026-10-10"
        }
      ]
    }));
    expect(extracted.groups).toEqual([]);
  });

  it("groups the same shape twice and splits a long inferred turn by shape", () => {
    const grouped = extractFieldQuestionGroups(pack());
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]?.count).toBe(2);

    const calls = ["spend", "revenue"].flatMap((measure) => [1, 2].map((day) => ({
      tool: "lucy_query",
      outcome: "error",
      decisionReason: "measure_unbound",
      sourceMapVersion: "map-a",
      measures: [measure],
      inferredTurnId: "burst",
      inferredTurnCallCount: 80,
      seenOn: `2026-10-${String(day).padStart(2, "0")}`
    })));
    const split = extractFieldQuestionGroups(pack({ calls }));
    expect(split.groups).toHaveLength(2);
  });

  it("classifies the whole client name, with curl and undici as other", () => {
    expect(clientFamily("python-requests/2.32")).toBe("脚本客户端");
    expect(clientFamily("Codex/1.0")).toBe("对话客户端");
    expect(clientFamily("curl/8.0")).toBe("其他");
    expect(clientFamily("undici")).toBe("其他");
  });
});
