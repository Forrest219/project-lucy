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

/** Per-table column row: name, data_type, is_nullable, column_key, column_comment. */
function tableColumn(name: string, dataType = "varchar"): unknown[] {
  return [name, dataType, "YES", "", ""];
}

function mysqlPerTableRunSql(
  handler: (sql: string) => SqlResult | undefined
): typeof import("../ktx").runSql {
  return vi.fn(async (_root: string, _connectionId: string, sql: string) => {
    expect(sql.includes("JOIN")).toBe(false);
    const handled = handler(sql);
    if (handled) return handled;
    return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
  });
}

function preview(runSqlImpl: typeof import("../ktx").runSql) {
  return previewSchemaStructure("/project", "demo", "dataforai", {
    readConnectionsImpl: async () => [mysqlConn],
    runSqlImpl
  });
}

describe("previewSchemaStructure", () => {
  it("lists tables then reads columns one table at a time", async () => {
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({ json: { rows: [tableColumn("id")] } });
      }
      return undefined;
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
      expect.stringContaining("table_name = 'orders'"),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 30_000 })
    );
    expect(runSqlImpl.mock.calls.every((call) => !String(call[2]).includes("JOIN"))).toBe(true);
  });

  it("throws when listing tables fails instead of reporting an empty schema", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({
      ok: false,
      exitCode: 1,
      stderr: "error: option '--max-rows <n>' argument '20000' is invalid.",
      json: null
    }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: "读取表结构失败：无法列出 Schema「dataforai」下的表。",
      detail: expect.objectContaining({
        phase: "mysql-wide-fallback-list-tables",
        schema: "dataforai"
      })
    });
    await expect(preview(runSqlImpl)).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: Record<string, unknown> }).detail;
      return !detail || (!("sql" in detail) && !("stderr" in detail));
    });
    await expect(preview(runSqlImpl)).rejects.toBeInstanceOf(SchemaStructureError);
  });

  it("throws when the table-list result is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：无法列出 Schema「dataforai」下的表。"
    });
  });

  it("counts tables from a successful per-table read", async () => {
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"], ["people"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({
          json: { rows: [tableColumn("id"), tableColumn("amount", "decimal")] }
        });
      }
      if (sql.includes("table_name = 'people'")) {
        return sqlResult({ json: { rows: [tableColumn("name")] } });
      }
      return undefined;
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(result.schema).toBe("dataforai");
    expect(result.yaml).toContain("orders");
    expect(result.yaml).toContain("people");
  });

  it("refuses a single table that fills the row cap", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => tableColumn(`c${index}`));
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({ json: { rows } });
      }
      return undefined;
    });

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "这个 Schema 的字段数超过一次可读取的上限。"
    });
  });

  it("does not attempt a schema-wide columns JOIN for MySQL", async () => {
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"], ["people"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({
          json: { rows: [tableColumn("id"), tableColumn("amount", "decimal")] }
        });
      }
      if (sql.includes("table_name = 'people'")) {
        return sqlResult({ json: { rows: [tableColumn("name")] } });
      }
      return undefined;
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(runSqlImpl.mock.calls.some((call) => String(call[2]).includes("JOIN"))).toBe(false);
  });

  it("names the table when a per-table column read fails quickly", async () => {
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [["orders"], ["people"]] } });
      }
      if (sql.includes("table_name = 'orders'")) {
        return sqlResult({ json: { rows: [tableColumn("id")] } });
      }
      if (sql.includes("table_name = 'people'")) {
        return sqlResult({
          ok: false,
          exitCode: 1,
          stderr: "syntax error",
          latencyMs: 20,
          json: null
        });
      }
      return undefined;
    });

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：无法读取表「people」的字段。"
    });
    expect(runSqlImpl.mock.calls.some((call) => String(call[2]).includes("JOIN"))).toBe(false);
  });

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = mysqlPerTableRunSql((sql) => {
      if (sql.includes("table_name FROM information_schema.tables")) {
        return sqlResult({ json: { rows: [] } });
      }
      return undefined;
    });

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });
});
