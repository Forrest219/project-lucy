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

function nameQuery(rows: unknown[][], fail = false) {
  return vi.fn(async (_root: string, _connectionId: string, sql: string) => {
    if (!sql.includes("FROM information_schema.tables") || !sql.includes("table_schema = 'dataforai'")) {
      return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
    }
    if (fail) return sqlResult({ ok: false, exitCode: 1, stderr: "name read failed", json: null });
    return sqlResult({ json: { rows } });
  });
}

describe("previewSchemaStructure", () => {
  it("lists plain MySQL table names without reading columns", async () => {
    const runSqlImpl = nameQuery([["orders"], ["people"]]);

    const result = await preview(runSqlImpl);

    expect(result.namesOnly).toBe(true);
    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(0);
    expect(result.yaml).toContain("orders");
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
    const sql = String(runSqlImpl.mock.calls[0][2]);
    expect(sql).toContain("FROM information_schema.tables");
    expect(sql).not.toContain("JOIN");
    expect(sql).not.toContain("table_name = '");
    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.any(String),
      expect.objectContaining({ maxRows: 10_000, timeoutMs: 120_000 })
    );
  });

  it("reads one checked table's columns", async () => {
    const runSqlImpl = vi.fn(async (_root: string, _connectionId: string, sql: string) => {
      if (!sql.includes("LOWER(table_name) = 'orders'")) {
        return sqlResult({ ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
      }
      return sqlResult({ json: { rows: [["id", "varchar", "YES", "", "订单"]] } });
    });

    const result = await previewSchemaStructure("/project", "demo", "dataforai", {
      readConnectionsImpl: async () => [mysqlConn],
      runSqlImpl,
      tables: ["orders"]
    });

    expect(result.namesOnly).toBe(false);
    expect(result.tableCount).toBe(1);
    expect(result.columnCount).toBe(1);
    expect(result.yaml).toContain("orders");
    expect(runSqlImpl).toHaveBeenCalledWith(
      "/project",
      "demo",
      expect.stringContaining("LOWER(table_name) = 'orders'"),
      expect.objectContaining({ maxRows: 2_000, timeoutMs: 120_000 })
    );
  });

  it("hides driver text when the name query fails", async () => {
    const runSqlImpl = nameQuery([], true);

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: "读取表结构失败：无法列出 Schema「dataforai」下的表。",
      detail: expect.objectContaining({
        phase: "catalog-list-tables",
        schema: "dataforai"
      })
    });
    await expect(preview(runSqlImpl)).rejects.toSatisfy((error: unknown) => {
      const detail = (error as { detail?: Record<string, unknown> }).detail;
      const message = error instanceof Error ? error.message : "";
      return !message.includes("name read failed")
        && (!detail || (!("sql" in detail) && !("stderr" in detail)));
    });
    expect(runSqlImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the name query is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：无法列出 Schema「dataforai」下的表。"
    });
  });

  it("fails closed when one table returns 2000 column rows", async () => {
    const rows = Array.from({ length: 2_000 }, (_, index) => [`c${index}`, "varchar", "YES", "", ""]);
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows } }));

    await expect(previewSchemaStructure("/project", "demo", "dataforai", {
      readConnectionsImpl: async () => [mysqlConn],
      runSqlImpl,
      tables: ["orders"]
    })).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "这次读取超过一次可读取的上限。"
    });
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = nameQuery([]);

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
    expect(result.namesOnly).toBe(false);
    expect(runSqlImpl).toHaveBeenCalledTimes(1);
  });
});
