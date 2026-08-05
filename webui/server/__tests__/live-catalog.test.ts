import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLiveCatalogCache,
  listLiveSchemas,
  LiveCatalogConnectionNotFoundError,
  LIVE_CATALOG_TTL_MS
} from "../live-catalog";
import type { ConnectionInfo } from "../model";
import type { SqlResult } from "../ktx";
import { KtxCliError } from "../ktx";

const mysqlConn: ConnectionInfo = {
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders"]
};

function okSql(rows: Array<[string, number]>): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: JSON.stringify({
      connectionId: "mysql-aliyun",
      headers: ["schema_name", "table_count"],
      rows
    }),
    stderr: "",
    latencyMs: 12,
    command: "ktx sql ...",
    args: [],
    json: {
      connectionId: "mysql-aliyun",
      headers: ["schema_name", "table_count"],
      rows
    }
  };
}

afterEach(() => {
  clearLiveCatalogCache();
});

describe("listLiveSchemas", () => {
  it("aggregates mysql schemas and filters system schemas", async () => {
    const runSqlImpl = vi.fn(async () =>
      okSql([
        ["information_schema", 100],
        ["dataforai", 28],
        ["openclaw_db", 9],
        ["mysql", 50]
      ])
    );

    const result = await listLiveSchemas(
      "/project",
      "mysql-aliyun",
      {},
      {
        readConnectionsImpl: async () => [mysqlConn],
        runSqlImpl,
        now: () => 1_000_000
      }
    );

    expect(result.status).toBe("ok");
    expect(result.cached).toBe(false);
    expect(result.schemas).toEqual([
      { schema: "dataforai", tableCount: 28 },
      { schema: "openclaw_db", tableCount: 9 }
    ]);
    expect(runSqlImpl).toHaveBeenCalledOnce();
    const sql = String(runSqlImpl.mock.calls[0]?.[2] ?? "");
    expect(sql).toContain("information_schema.tables");
    expect(sql).toContain("BASE TABLE");
  });

  it("returns cached payload within TTL and refresh bypasses cache", async () => {
    let now = 1_000_000;
    const runSqlImpl = vi.fn(async () => okSql([["dataforai", 3]]));
    const deps = {
      readConnectionsImpl: async () => [mysqlConn],
      runSqlImpl,
      now: () => now,
      ttlMs: LIVE_CATALOG_TTL_MS
    };

    const first = await listLiveSchemas("/project", "mysql-aliyun", {}, deps);
    expect(first.cached).toBe(false);
    expect(runSqlImpl).toHaveBeenCalledTimes(1);

    now += 60_000;
    const second = await listLiveSchemas("/project", "mysql-aliyun", {}, deps);
    expect(second.cached).toBe(true);
    expect(second.schemas).toEqual(first.schemas);
    expect(runSqlImpl).toHaveBeenCalledTimes(1);

    const refreshed = await listLiveSchemas("/project", "mysql-aliyun", { refresh: true }, deps);
    expect(refreshed.cached).toBe(false);
    expect(runSqlImpl).toHaveBeenCalledTimes(2);
  });

  it("returns status error when ktx sql fails without throwing", async () => {
    const result = await listLiveSchemas(
      "/project",
      "mysql-aliyun",
      {},
      {
        readConnectionsImpl: async () => [mysqlConn],
        runSqlImpl: async () => ({
          ok: false,
          exitCode: 1,
          stdout: "",
          stderr: "Access denied for user",
          latencyMs: 5,
          command: "ktx sql",
          args: [],
          json: null
        })
      }
    );
    expect(result.status).toBe("error");
    expect(result.schemas).toEqual([]);
    expect(result.reason).toContain("Access denied");
  });

  it("returns status error when ktx CLI is missing", async () => {
    const result = await listLiveSchemas(
      "/project",
      "mysql-aliyun",
      {},
      {
        readConnectionsImpl: async () => [mysqlConn],
        runSqlImpl: async () => {
          throw new KtxCliError("ktx CLI was not found in PATH");
        }
      }
    );
    expect(result.status).toBe("error");
    expect(result.reason).toContain("ktx CLI was not found");
  });

  it("throws CONNECTION_NOT_FOUND for unknown connection", async () => {
    await expect(
      listLiveSchemas(
        "/project",
        "missing",
        {},
        {
          readConnectionsImpl: async () => [mysqlConn],
          runSqlImpl: async () => okSql([])
        }
      )
    ).rejects.toBeInstanceOf(LiveCatalogConnectionNotFoundError);
  });

  it("uses postgres catalog SQL when wireProtocol is postgres", async () => {
    const runSqlImpl = vi.fn(async () =>
      okSql([
        ["public", 4],
        ["pg_catalog", 99]
      ])
    );
    const result = await listLiveSchemas(
      "/project",
      "demo-postgres",
      {},
      {
        readConnectionsImpl: async () => [
          {
            id: "demo-postgres",
            driver: "postgres",
            wireProtocol: "postgres",
            schemas: ["public"],
            enabledTables: []
          }
        ],
        runSqlImpl
      }
    );
    expect(result.status).toBe("ok");
    expect(result.schemas).toEqual([{ schema: "public", tableCount: 4 }]);
    expect(String(runSqlImpl.mock.calls[0]?.[2] ?? "")).toContain("pg_catalog.pg_class");
  });

  it("returns status error when ktx sql JSON cannot be parsed", async () => {
    const result = await listLiveSchemas(
      "/project",
      "mysql-aliyun",
      {},
      {
        readConnectionsImpl: async () => [mysqlConn],
        runSqlImpl: async () => ({
          ok: true,
          exitCode: 0,
          stdout: "not-json",
          stderr: "",
          latencyMs: 3,
          command: "ktx sql",
          args: [],
          json: null
        })
      }
    );
    expect(result.status).toBe("error");
    expect(result.schemas).toEqual([]);
    expect(result.reason).toMatch(/无法解析/);
  });

  it("returns status error for unknown wire protocol", async () => {
    const result = await listLiveSchemas(
      "/project",
      "weird-conn",
      {},
      {
        readConnectionsImpl: async () => [
          {
            id: "weird-conn",
            driver: "odbc",
            wireProtocol: "unknown",
            schemas: [],
            enabledTables: []
          }
        ],
        runSqlImpl: async () => okSql([])
      }
    );
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/wire protocol/);
  });
});
