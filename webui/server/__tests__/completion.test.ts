import { describe, expect, it } from "vitest";
import { computeCompletion } from "../completion";
import type { TableModel } from "../model";

function model(overrides: Partial<TableModel>): TableModel {
  return {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table: "superstore_orders",
    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    descriptions: {},
    columns: [],
    ...overrides
  };
}

describe("computeCompletion", () => {
  it("returns not_started when no table, grain, or field description exists", () => {
    expect(
      computeCompletion(
        model({
          columns: [{ name: "id", type: "number", pk: true, descriptions: {} }]
        })
      )
    ).toBe("not_started");
  });

  it("returns partial when only some descriptive structure exists", () => {
    expect(
      computeCompletion(
        model({
          descriptions: { ai: "Order table" },
          columns: [
            { name: "id", type: "number", pk: true, descriptions: { ai: "Identifier" } },
            { name: "name", type: "string", descriptions: {} }
          ]
        })
      )
    ).toBe("partial");
  });

  it("returns done when table, grain, primary key, core fields, and measures are present", () => {
    expect(
      computeCompletion(
        model({
          descriptions: { human: "Order table" },
          grain: ["id"],
          columns: [
            { name: "id", type: "number", pk: true, descriptions: { ai: "Identifier" } },
            { name: "name", type: "string", descriptions: { human: "Display name" } }
          ],
          measures: [{ name: "order_count", expr: "count(*)" }]
        })
      )
    ).toBe("done");
  });

  it("ignores hidden fields when checking core descriptions", () => {
    expect(
      computeCompletion(
        model({
          descriptions: { ai: "Order table" },
          grain: ["id"],
          columns: [
            { name: "id", type: "number", pk: true, descriptions: { ai: "Identifier" } },
            { name: "internal_note", type: "string", visibility: "hidden", descriptions: {} }
          ],
          measures: [{ name: "order_count", expr: "count(*)" }]
        })
      )
    ).toBe("done");
  });
});
