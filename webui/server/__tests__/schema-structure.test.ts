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

function column(table: string, name: string): unknown[] {
  return [table, name, "varchar", "YES", "", ""];
}

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

describe("previewSchemaStructure", () => {
  it("asks ktx for at most 10000 rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [column("orders", "id")] } }));

    await preview(runSqlImpl);

    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.stringContaining("information_schema.columns"),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 30_000 })
    );
  });

  it("throws when the CLI fails instead of reporting an empty schema", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      ok: false,
      exitCode: 1,
      stderr: "error: option '--max-rows <n>' argument '20000' is invalid.",
      json: null
    }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: expect.stringMatching(
        /^读取表结构失败：无法一次读取 Schema「dataforai」的字段。数据库返回：.*--max-rows/
      )
    });
    await expect(preview(runSqlImpl)).rejects.toBeInstanceOf(SchemaStructureError);
  });

  it("throws when the CLI result is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: expect.stringMatching(/^读取表结构失败：无法一次读取 Schema「dataforai」的字段。/)
    });
  });

  it("counts tables from a successful read", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      json: {
        rows: [
          column("orders", "id"),
          column("orders", "amount"),
          column("people", "name")
        ]
      }
    }));

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.schema).toBe("dataforai");
  });

  it("refuses a result that fills the row cap", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => column("orders", `c${index}`));
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows } }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "这个 Schema 的字段数超过一次可读取的上限。"
    });
  });

  it("reads columns one table at a time after the schema-wide scan times out", async () => {
    const runSqlImpl = vi.fn(async (_root: string, _connectionId: string, sql: string) => {
      if (sql.includes("JOIN")) {
        return sqlResult({
          ok: false,
          exitCode: 1,
          stderr: "Query execution was interrupted, maximum statement execution time exceeded",
          latencyMs: 30_000,
          json: null
        });
      }
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"], ["people"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({
          json: { rows: [["id", "varchar", "YES", "", ""], ["amount", "decimal", "YES", "", ""]] }
        });
      }
      if (sql.includes("table_name = 'people'")) {
        return sqlResult({ json: { rows: [["name", "varchar", "YES", "", ""]] } });
      }
      return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.yaml).toContain("orders");
    expect(result.yaml).toContain("people");
    expect(runSqlImpl.mock.calls.some((call) => String(call[2]).includes("table_name = 'orders'"))).toBe(true);
  });

  it("does not split a fast column-scan failure into per-table reads", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      ok: false,
      exitCode: 1,
      stderr: "syntax error",
      latencyMs: 20,
      json: null
    }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [] } }));

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
  });
});
