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

    await expect(preview(runSqlImpl)).rejects.toEqual(expect.objectContaining({
      name: "SchemaStructureError",
      code: "READ_FAILED",
      message: "读取表结构失败。"
    }));
    await expect(preview(runSqlImpl)).rejects.toBeInstanceOf(SchemaStructureError);
  });

  it("throws when the CLI result is not JSON rows", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ ok: true, json: null }));

    await expect(preview(runSqlImpl)).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败。"
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

  it("returns tableCount 0 when the schema has no base tables", async () => {
    const runSqlImpl = vi.fn(async () => sqlResult({ json: { rows: [] } }));

    const result = await preview(runSqlImpl);

    expect(result.tableCount).toBe(0);
    expect(result.columnCount).toBe(0);
  });
});
