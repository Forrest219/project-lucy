import { describe, expect, it, vi } from "vitest";
import { listLiveSchemas } from "../live-catalog";
import { createSqlLiveTableProvider } from "../live-tables";
import { previewSchemaStructure } from "../schema-structure";
import type { SqlResult } from "../ktx";
import type { ConnectionInfo } from "../model";

const DEFAULT_CLUSTER_ERROR = "Unknown database 'default_cluster:information_schema'";
const hiveJd: ConnectionInfo = {
  id: "hive-jd",
  driver: "mysql",
  wireProtocol: "mysql",
  database: "hive_jd.app",
  schemas: ["app"],
  enabledTables: []
};
const hive1: ConnectionInfo = { ...hiveJd, id: "hive-1", database: "hive.dw", schemas: ["dw"] };

function result(rows: unknown[][], ok = true, stderr = ""): SqlResult {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stdout: "",
    stderr,
    latencyMs: 3,
    command: "fixture",
    args: [],
    json: ok ? { headers: [], rows } : null
  };
}

const appNames = [
  "app_user_tail_dau_i_d_i_d",
  "app_user_tail_retain_i_d_i_d",
  "日活明细",
  ...Array.from({ length: 166 }, (_, index) => `app_${index}`)
];

function direct(sql: string): SqlResult {
  if (sql === "SHOW DATABASES FROM `hive_jd`") return result([["app"], ["information_schema"]]);
  if (sql === "SHOW DATABASES FROM `hive`") return result([["dim"], ["dw"], ["sys"]]);
  if (sql === "SHOW TABLES FROM `hive`.`dim`") return result(Array.from({ length: 44 }, (_, index) => [`dim_${index}`]));
  if (sql === "SHOW TABLES FROM `hive`.`dw`") return result(Array.from({ length: 129 }, (_, index) => [`dw_${index}`]));
  if (sql === "SHOW TABLES FROM `hive_jd`.`app`") return result(appNames.map((name) => [name]));
  return result([], false, "unexpected direct SQL");
}

function ktx(sql: string): SqlResult {
  if (/\bSHOW\b/i.test(sql)) return result([], false, "SQL contains read/write operation: Show");
  if (/\binformation_schema\b/i.test(sql)) return result([], false, DEFAULT_CLUSTER_ERROR);
  if (sql === "DESC `hive_jd`.`app`.`日活明细`") return result([["统计日期", "date", "YES", ""]]);
  if (/^DESC `hive_jd`\.`app`\.`[^`]+`$/.test(sql)) return result([["id", "bigint", "NO", "PRI"]]);
  return result([], false, "unexpected KTX SQL");
}

function deps(connection = hiveJd) {
  const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => ktx(sql));
  const runCatalogShowImpl = vi.fn(async (_root: string, _id: string, sql: string) => direct(sql));
  return { readConnectionsImpl: async () => [connection], runSqlImpl, runCatalogShowImpl };
}

describe("isolated SelectDB external catalog", () => {
  it("rejects qualified information_schema and KTX SHOW like the customer runtime", () => {
    expect(ktx("SELECT schema_name FROM `hive`.`information_schema`.`schemata`").stderr).toContain(DEFAULT_CLUSTER_ERROR);
    expect(ktx("SELECT table_name FROM `hive_jd`.`information_schema`.`tables`").ok).toBe(false);
    expect(ktx("SHOW DATABASES FROM `hive`").ok).toBe(false);
  });

  it("returns app with 169 tables without sending metadata to KTX", async () => {
    const injected = deps();
    const actual = await listLiveSchemas("/fixture", "hive-jd", { refresh: true }, injected);
    expect(actual.status).toBe("ok");
    expect(actual.schemas).toEqual([{ schema: "app", tableCount: 169 }]);
    expect(injected.runCatalogShowImpl.mock.calls.map((call) => call[2])).toEqual([
      "SHOW DATABASES FROM `hive_jd`",
      "SHOW TABLES FROM `hive_jd`.`app`"
    ]);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("keeps the hive and hive_jd catalogs distinct and returns dim=44, dw=129", async () => {
    const actual = await listLiveSchemas("/fixture", "hive-1", { refresh: true }, deps(hive1));
    expect(actual.status).toBe("ok");
    expect(actual.schemas).toEqual([
      { schema: "dim", tableCount: 44 },
      { schema: "dw", tableCount: 129 }
    ]);
  });

  it("fails the whole schema list when one SHOW TABLES fails", async () => {
    const injected = deps(hive1);
    injected.runCatalogShowImpl.mockImplementation(async (_root, _id, sql) => {
      if (sql === "SHOW TABLES FROM `hive`.`dw`") return result([], false, "Access denied for database dw");
      return direct(sql);
    });
    const actual = await listLiveSchemas("/fixture", "hive-1", { refresh: true }, injected);
    expect(actual.status).toBe("error");
    expect(actual.schemas).toEqual([]);
    expect(actual.reason).toContain("Access denied");
  });

  it("lists external table names without describing columns", async () => {
    const injected = deps();
    const preview = await previewSchemaStructure("/fixture", "hive-jd", "app", injected);
    expect(preview.namesOnly).toBe(true);
    expect(preview.tableCount).toBe(169);
    expect(preview.columnCount).toBe(0);
    expect(preview.yaml).toContain("日活明细");
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("describes one checked external table through KTX and preserves Chinese names", async () => {
    const injected = deps();
    const preview = await previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    });
    expect(preview.namesOnly).toBe(false);
    expect(preview.tableCount).toBe(1);
    expect(preview.yaml).toContain("日活明细");
    expect(preview.yaml).toContain("统计日期");
    expect(injected.runSqlImpl.mock.calls.map((call) => String(call[2]))).toEqual([
      "DESC `hive_jd`.`app`.`日活明细`"
    ]);
  });

  it("fails when the checked external DESC fails", async () => {
    const injected = deps();
    injected.runSqlImpl.mockImplementation(async () => result([], false, "rejected"));
    await expect(previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    })).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：rejected"
    });
  });

  it("lists external names with zero column counts without issuing any DESC", async () => {
    const injected = deps();
    const actual = await createSqlLiveTableProvider(injected).listTables({
      projectRoot: "/fixture",
      connectionId: "hive-jd",
      schema: "app",
      generation: 0
    });
    expect(actual.status).toBe("ok");
    expect(actual.tables.map((item) => item.table)).toEqual(appNames);
    expect(actual.tables.every((item) => item.columnCount === 0)).toBe(true);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("accepts a SHOW TABLES result above 10000 names", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockResolvedValue(
      result(Array.from({ length: 10_001 }, (_, index) => [`t${index}`]))
    );
    const actual = await createSqlLiveTableProvider(injected).listTables({
      projectRoot: "/fixture",
      connectionId: "hive-jd",
      schema: "app",
      generation: 0
    });
    expect(actual.status).toBe("ok");
    expect(actual.tables).toHaveLength(10_001);
  });
});
