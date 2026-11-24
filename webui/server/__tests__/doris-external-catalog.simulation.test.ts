import { describe, expect, it, vi } from "vitest";
import { listLiveSchemas } from "../live-catalog";
import { createSqlLiveTableProvider } from "../live-tables";
import { previewSchemaStructure, readSchemaColumns } from "../schema-structure";
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
  if (sql === "DESC `hive_jd`.`app`.`日活明细`") return result([["统计日期", "date", "YES", "false", null, null]]);
  if (/^DESC `hive_jd`\.`app`\.`[^`]+`$/.test(sql)) return result([["id", "bigint", "NO", "true", null, null]]);
  if (/^DESC `hive`\.`dim`\.`dim_bidding_block_ad_id_2025`$/.test(sql)) {
    return result([["ad_id", "bigint", "YES", "false", null, null], ["block_flag", "int", "YES", "false", null, null]]);
  }
  return result([], false, "unexpected direct SQL");
}

/** Mirrors KTX 0.16.0 `validate_read_only_sql_response`: only SELECT/UNION roots pass. */
function ktx(sql: string): SqlResult {
  if (/^\s*(?:DESC|DESCRIBE)\b/i.test(sql)) return result([], false, "SQL contains read/write operation: Describe");
  if (/\bSHOW\b/i.test(sql)) return result([], false, "SQL contains read/write operation: Show");
  if (/\binformation_schema\b/i.test(sql)) return result([], false, DEFAULT_CLUSTER_ERROR);
  return result([], false, "unexpected KTX SQL");
}

function probeKind(sql: string): string {
  if (sql.startsWith("SHOW COLUMNS FROM ")) return "SHOW COLUMNS";
  return sql.split(" ")[0];
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
    expect(ktx("DESC `hive`.`dim`.`t`").stderr).toContain("read/write operation: Describe");
    expect(ktx("DESCRIBE `hive`.`dim`.`t`").ok).toBe(false);
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

  it("describes one checked external table over the direct channel and preserves Chinese names", async () => {
    const injected = deps();
    const preview = await previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    });
    expect(preview.namesOnly).toBe(false);
    expect(preview.tableCount).toBe(1);
    expect(preview.yaml).toContain("日活明细");
    expect(preview.yaml).toContain("统计日期");
    expect(injected.runCatalogShowImpl.mock.calls.map((call) => String(call[2]))).toEqual([
      "DESC `hive_jd`.`app`.`日活明细`"
    ]);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("reads hive-1 dim.dim_bidding_block_ad_id_2025 without KTX or information_schema", async () => {
    const injected = deps(hive1);
    const preview = await previewSchemaStructure("/fixture", "hive-1", "dim", {
      ...injected,
      tables: ["dim_bidding_block_ad_id_2025"]
    });
    expect(preview.columnCount).toBe(2);
    expect(preview.yaml).toContain("block_flag");
    const sent = injected.runCatalogShowImpl.mock.calls.map((call) => String(call[2]));
    expect(sent).toEqual(["DESC `hive`.`dim`.`dim_bidding_block_ad_id_2025`"]);
    expect(sent.join("\n")).not.toMatch(/information_schema/i);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("falls back to SHOW COLUMNS when DESC is rejected by the server", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async (_root, _id, sql) => {
      if (sql.startsWith("DESC ")) return result([], false, "You have an error in your SQL syntax near DESC");
      if (sql.startsWith("SHOW COLUMNS FROM ")) return result([["统计日期", "date", "YES", "", null, null]]);
      return direct(sql);
    });
    const preview = await previewSchemaStructure("/fixture", "hive-jd", "app", { ...injected, tables: ["日活明细"] });
    expect(preview.yaml).toContain("统计日期");
    expect(injected.runCatalogShowImpl.mock.calls.map((call) => String(call[2]))).toEqual([
      "DESC `hive_jd`.`app`.`日活明细`",
      "SHOW COLUMNS FROM `hive_jd`.`app`.`日活明细`"
    ]);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it("tries the next probe when a probe succeeds but maps to zero columns", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async (_root, _id, sql) => {
      if (sql.startsWith("DESC ")) return result([]);
      if (sql.startsWith("SHOW COLUMNS FROM ")) return result([]);
      if (sql.startsWith("DESCRIBE ")) return result([["统计日期", "date", "YES", "", null, null]]);
      return direct(sql);
    });
    const preview = await previewSchemaStructure("/fixture", "hive-jd", "app", { ...injected, tables: ["日活明细"] });
    expect(preview.yaml).toContain("统计日期");
    expect(injected.runCatalogShowImpl.mock.calls.map((call) => probeKind(String(call[2])))).toEqual([
      "DESC",
      "SHOW COLUMNS",
      "DESCRIBE"
    ]);
  });

  it("fails with the existing sentence after all three direct probes fail", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async () => result([], false, "rejected"));
    await expect(previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    })).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "表「日活明细」没有读到字段。"
    });
    expect(injected.runCatalogShowImpl).toHaveBeenCalledTimes(3);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["Access denied for user 'reader'", "没有权限读取表「日活明细」的字段。"],
    ["Table 'app.日活明细' doesn't exist", "表「日活明细」没有读到字段。"],
    ["Can't connect to MySQL server on 'db.invalid'", "表「日活明细」没有读到字段。"],
    ["读取结果超过一次可读取的上限。", "这次读取超过一次可读取的上限。"]
  ])("stops at the first probe for terminal failure %s", async (stderr, message) => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async () => result([], false, stderr));
    await expect(previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    })).rejects.toMatchObject({ code: "READ_FAILED", message });
    expect(injected.runCatalogShowImpl).toHaveBeenCalledTimes(1);
  });

  it("stops after a probe that used up the deadline", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async () => ({
      ...result([], false, "Catalog connection/query timed out"),
      latencyMs: 120_000
    }));
    await expect(previewSchemaStructure("/fixture", "hive-jd", "app", {
      ...injected,
      tables: ["日活明细"]
    })).rejects.toMatchObject({ message: "读取表「日活明细」的字段超时。" });
    expect(injected.runCatalogShowImpl).toHaveBeenCalledTimes(1);
  });

  it("logs every failed probe with its statement type and no password", async () => {
    const injected = deps();
    injected.runCatalogShowImpl.mockImplementation(async () => result([], false, "rejected"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await previewSchemaStructure("/fixture", "hive-jd", "app", { ...injected, tables: ["日活明细"] }).catch(() => undefined);
    const logged = spy.mock.calls
      .filter((call) => call[0] === "[schema-structure] read failed")
      .map((call) => probeKind((call[1] as { sql: string }).sql));
    spy.mockRestore();
    expect(logged).toEqual(["DESC", "SHOW COLUMNS", "DESCRIBE"]);
  });

  it("serves the structure-diff per-table mode over the same direct channel", async () => {
    const injected = deps();
    const read = await readSchemaColumns("/fixture", "hive-jd", "app", {
      ...injected,
      mode: "per-table",
      tables: ["日活明细", "app_1"]
    });
    if (read.status !== "ok") throw new Error(`unexpected read status ${read.status}`);
    expect(read.columns.map((item) => item.column)).toEqual(["统计日期", "id"]);
    expect(injected.runSqlImpl).not.toHaveBeenCalled();
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
