import { describe, expect, it, vi } from "vitest";
import type { SqlResult } from "../ktx";
import { createSqlLiveTableProvider } from "../live-tables";
import type { ConnectionInfo } from "../model";

const wide: ConnectionInfo = {
  id: "marketingapi",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  database: "jipaas_poc",
  schemas: ["jipaas_poc"],
  enabledTables: []
};

function sqlResult(rows: unknown[][], overrides: Partial<SqlResult> = {}): SqlResult {
  return {
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    latencyMs: 4,
    command: "ktx sql",
    args: [],
    json: { rows },
    ...overrides
  };
}

describe("wide MySQL table scan", () => {
  it("lists tables after the all-column join uses up its deadline", async () => {
    const seen: string[] = [];
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      seen.push(sql);
      if (sql.includes("LEFT JOIN")) {
        return sqlResult([], {
          ok: false,
          exitCode: 1,
          stderr: "Query execution was interrupted, maximum statement execution time exceeded",
          latencyMs: 30_000,
          json: null
        });
      }
      if (sql.includes("COALESCE(table_comment")) {
        return sqlResult([
          ["gdt_daily_report", "BASE TABLE", "广点通"],
          ["ocean_report", "BASE TABLE", ""]
        ]);
      }
      if (sql.includes("COUNT(*)") && sql.includes("gdt_daily_report")) {
        return sqlResult([
          ["gdt_daily_report", 180],
          ["ocean_report", 40]
        ]);
      }
      return sqlResult([], { ok: false, exitCode: 1, stderr: `unexpected ${sql}`, json: null });
    });

    const result = await createSqlLiveTableProvider({
      readConnectionsImpl: async () => [wide],
      runSqlImpl
    }).listTables({
      projectRoot: "/project",
      connectionId: "marketingapi",
      schema: "jipaas_poc",
      generation: 0
    });

    expect(result.status).toBe("ok");
    expect(result.tables).toEqual([
      { table: "gdt_daily_report", tableType: "BASE TABLE", columnCount: 180, tableComment: "广点通" },
      { table: "ocean_report", tableType: "BASE TABLE", columnCount: 40 }
    ]);
    expect(seen[0]).toContain("LEFT JOIN");
    expect(seen.some((sql) => sql.includes("information_schema.tables") && !sql.includes("LEFT JOIN"))).toBe(true);
    expect(seen.some((sql) => sql.includes("table_name IN"))).toBe(true);
  });

  it("keeps the table when a column-count batch still times out", async () => {
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      if (sql.includes("LEFT JOIN")) {
        return sqlResult([], {
          ok: false,
          exitCode: 1,
          stderr: "",
          latencyMs: 30_000,
          json: null
        });
      }
      if (sql.includes("COALESCE(table_comment")) {
        return sqlResult([["wide_report", "BASE TABLE", ""]]);
      }
      return sqlResult([], {
        ok: false,
        exitCode: 1,
        stderr: "maximum statement execution time exceeded",
        latencyMs: 30_000,
        json: null
      });
    });

    const result = await createSqlLiveTableProvider({
      readConnectionsImpl: async () => [wide],
      runSqlImpl
    }).listTables({
      projectRoot: "/project",
      connectionId: "marketingapi",
      schema: "jipaas_poc",
      generation: 0
    });

    expect(result.status).toBe("ok");
    expect(result.tables).toEqual([
      { table: "wide_report", tableType: "BASE TABLE", columnCount: 0 }
    ]);
  });
});
