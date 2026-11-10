import { describe, expect, it, vi } from "vitest";
import type { SqlResult } from "../ktx";
import type { ConnectionInfo } from "../model";
import { previewSchemaStructure, SchemaStructureError } from "../schema-structure";

const mysqlConn: ConnectionInfo = {
  id: "demo",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  schemas: ["dataforai"],
  enabledTables: []
};

function sqlResult(overrides: Partial<SqlResult> = {}): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    latencyMs: 1,
    command: "ktx sql",
    args: [],
    json: { rows: [] },
    ...overrides
  };
}

function preview(runSqlImpl: typeof import("../ktx").runSql) {
  return previewSchemaStructure("/project", "demo", "dataforai", {
    readConnectionsImpl: async () => [mysqlConn],
    runSqlImpl
  });
}

function mysqlTables(tables: Record<string, unknown[][] | null>) {
  return vi.fn(async (_root: string, _connectionId: string, sql: string) => {
    if (sql.includes("table_name FROM information_schema.tables")) {
      return sqlResult({ json: { rows: Object.keys(tables).map((name) => [name]) } });
    }
    const match = sql.match(/table_name = '([^']+)'/);
    if (!match) return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
    const rows = tables[match[1]];
    if (!rows) return sqlResult({ ok: false, exitCode: 1, stderr: "table failed", latencyMs: 20, json: null });
    return sqlResult({ json: { rows } });
  });
}

describe("previewSchemaStructure", () => {
  it("reads table names first, then one table at a time, with at most 10000 rows", async () => {
    const runSqlImpl = mysqlTables({
      orders: [["id", "varchar", "YES", "", ""]]
    });

    await preview(runSqlImpl);

    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.stringContaining("table_name FROM information_schema.tables"),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 30_000 })
    );
    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.stringContaining("information_schema.columns"),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 30_000 })
    );
    expect(runSqlImpl.mock.calls.some((call) => String(call[2]).includes("JOIN"))).toBe(false);
  });

  it("throws when the table list fails instead of reporting an empty schema", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      ok: false,
      exitCode: 1,
      stderr: "error: option '--max-rows <n>' argument '20000' is invalid.",
      json: null
    }));

    await expect(preview(runSqlImpl)).rejects.toEqual(expect.objectContaining({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: "读取表结构失败：error: option '--max-rows <n>' argument '20000' is invalid."
    }));
    await expect(preview(runSqlImpl)).rejects.toBeInstanceOf(SchemaStructureError);
  });

  it("throws when the table list is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败。"
    });
  });

  it("counts tables from a successful read", async () => {
    const runSqlImpl = mysqlTables({
      orders: [["id", "varchar", "YES", "", ""], ["amount", "decimal", "YES", "", ""]],
      people: [["name", "varchar", "YES", "", ""]]
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.schema).toBe("dataforai");
  });

  it("skips a table that fills the row cap and fails when nothing remains", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => [`c${index}`, "varchar", "YES", "", ""]);
    const runSqlImpl = mysqlTables({ orders: rows });

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败。"
    });
  });

  it("reads every table without waiting for a schema-wide timeout", async () => {
    const runSqlImpl = mysqlTables({
      orders: [["id", "varchar", "YES", "", ""], ["amount", "decimal", "YES", "", ""]],
      people: [["name", "varchar", "YES", "", ""]]
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.yaml).toContain("orders");
    expect(result.yaml).toContain("people");
    expect(runSqlImpl.mock.calls.some((call) => String(call[2]).includes("JOIN"))).toBe(false);
  });

  it("keeps tables that were read when one table fails quickly", async () => {
    const runSqlImpl = mysqlTables({
      orders: null,
      people: [["name", "varchar", "YES", "", ""]]
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(1);
    expect(result.yaml).toContain("people");
    expect(result.yaml).not.toContain("orders");
  });

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [] } }));

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
  });
});
