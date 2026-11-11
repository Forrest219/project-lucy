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

function columnQuery(rows: unknown[][], fail = false) {
  return vi.fn(async (_root: string, _connectionId: string, sql: string) => {
    if (!sql.includes("FROM information_schema.columns") || !sql.includes("table_schema = 'dataforai'")) {
      return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
    }
    if (fail) return sqlResult({ ok: false, exitCode: 1, stderr: "column read failed", json: null });
    return sqlResult({ json: { rows } });
  });
}

describe("previewSchemaStructure", () => {
  it("reads a plain MySQL schema with one columns query", async () => {
    const runSqlImpl = columnQuery([
      ["orders", "id", "varchar", "YES", "", "订单"]
    ]);

    await preview(runSqlImpl);

    expect(runSqlImpl).toHaveBeenCalledTimes(1);
    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.stringContaining("FROM information_schema.columns"),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 30_000 })
    );
    expect(String(runSqlImpl.mock.calls[0][2])).toContain("JOIN");
    expect(String(runSqlImpl.mock.calls[0][2])).not.toContain("table_name = '");
  });

  it("hides driver text when the column query fails", async () => {
    const runSqlImpl = columnQuery([], true);

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: "读取表结构失败：无法一次读取 Schema「dataforai」的字段。",
      detail: expect.objectContaining({
        phase: "schema-wide-columns",
        schema: "dataforai"
      })
    });
    await expect(preview(runSqlImpl)).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: Record<string, unknown> }).detail;
      const message = error instanceof Error ? error.message : "";
      return !message.includes("column read failed")
        && (!detail || (!("sql" in detail) && !("stderr" in detail)));
    });
    expect(runSqlImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the column query is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：无法一次读取 Schema「dataforai」的字段。"
    });
  });

  it("counts tables from a successful read", async () => {
    const runSqlImpl = columnQuery([
      ["orders", "id", "varchar", "YES", "", ""],
      ["orders", "amount", "decimal", "YES", "", ""],
      ["people", "name", "varchar", "YES", "", ""]
    ]);

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.schema).toBe("dataforai");
    expect(result.yaml).toContain("orders");
    expect(result.yaml).toContain("people");
  });

  it("fails closed when the column page reaches 10000 rows", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ["orders", `c${index}`, "varchar", "YES", "", ""]);
    const runSqlImpl = columnQuery(rows);

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "这个 Schema 的字段数超过一次可读取的上限。"
    });
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = columnQuery([]);

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });
});
