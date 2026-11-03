import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import {
  manifestTableNames,
  mergeManifestTables,
  newTablesFromGenerated
} from "../lib/prepareSchemaStructure";

const existing = `schema: dataforai
tables:
  orders:
    table: dataforai.orders
    columns:
      - name: id
        type: number
        descriptions:
          human: 订单号
`;

const generated = `tables:
  orders:
    table: dataforai.orders
    columns:
      - name: id
        type: string
  people:
    table: dataforai.people
    columns:
      - name: name
        type: string
  extra:
    table: dataforai.extra
    columns:
      - name: note
        type: string
`;

describe("mergeManifestTables", () => {
  it("keeps existing table YAML and only appends selected new tables", () => {
    expect(manifestTableNames(existing)).toEqual(["orders"]);
    expect(newTablesFromGenerated(existing, generated)).toEqual(["extra", "people"]);
    const merged = mergeManifestTables(existing, generated, ["people"]);
    expect(manifestTableNames(merged)).toEqual(["orders", "people"]);
    expect(merged).toContain("human: 订单号");
    expect(merged).toContain("people:");
    expect(merged).not.toContain("extra:");
    const tables = (parseYaml(merged) as { tables: Record<string, { columns: Array<{ type?: string }> }> }).tables;
    expect(tables.orders.columns[0]?.type).toBe("number");
  });
});
