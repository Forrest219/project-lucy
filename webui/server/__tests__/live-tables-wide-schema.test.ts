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
  it("lists names with one tables query and does not join columns", async () => {
    const seen: string[] = [];
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      seen.push(sql);
      return sqlResult([
        ["gdt_daily_report", "BASE TABLE", "广点通"],
        ["ocean_report", "BASE TABLE", ""]
      ]);
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
      { table: "gdt_daily_report", tableType: "BASE TABLE", columnCount: 0, tableComment: "广点通" },
      { table: "ocean_report", tableType: "BASE TABLE", columnCount: 0 }
    ]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("information_schema.tables");
    expect(seen[0]).toContain("'jipaas_poc'");
    expect(seen[0]).not.toContain("LEFT JOIN");
    expect(seen[0]).not.toContain("COUNT(*)");
  });
});
