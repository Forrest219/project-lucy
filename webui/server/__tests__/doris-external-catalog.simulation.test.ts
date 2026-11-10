import { describe, expect, it } from "vitest";
import { catalogSchemataSql, catalogTablesSql } from "../catalog-database";
import { listLiveSchemas } from "../live-catalog";
import { createSqlLiveTableProvider } from "../live-tables";
import { previewSchemaStructure } from "../schema-structure";
import type { SqlResult } from "../ktx";
import type { ConnectionInfo } from "../model";

/**
 * Isolated stand-in for the customer SelectDB. KTX 0.16.0 rejects SHOW.
 * Unqualified information_schema is a missing default-cluster database.
 * Catalog-qualified information_schema and DESC return hive_jd.app.
 */
const DEFAULT_CLUSTER_ERROR =
  "errCode = 2, detailMessage =\nUnknown database 'default_cluster:information_schema'";

const hiveJd: ConnectionInfo = {
  id: "hive-jd",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  host: "172.16.19.21",
  port: "9030",
  database: "hive_jd.app",
  schemas: ["app"],
  enabledTables: []
};

const hive1: ConnectionInfo = {
  id: "hive-1",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  host: "172.16.19.21",
  port: "9030",
  database: "hive.dw",
  schemas: ["dw"],
  enabledTables: []
};

function sqlResult(rows: unknown[][], ok = true, stderr = ""): SqlResult {
  return {
    ok,
    exitCode: ok ? 0 : 1,
    stdout: "",
    stderr,
    latencyMs: 3,
    command: "ktx sql",
    args: [],
    json: ok ? { headers: [], rows } : null
  };
}

function simulateIsolatedDoris(sql: string): SqlResult {
  const text = sql.replace(/\s+/g, " ").trim();
  if (/\bSHOW\b/i.test(text)) {
    return sqlResult([], false, "SQL contains read/write operation: Show");
  }
  if (/\binformation_schema\b/i.test(text) && !/`(?:hive_jd|hive)`\.`information_schema`/i.test(text)) {
    return sqlResult([], false, DEFAULT_CLUSTER_ERROR);
  }
  if (text === catalogSchemataSql("hive_jd")) {
    return sqlResult([["app"], ["information_schema"]]);
  }
  if (text === catalogSchemataSql("hive")) {
    return sqlResult([["dw"], ["dm"], ["ods"]]);
  }
  if (text === catalogTablesSql("hive", "dw")) {
    return sqlResult([["dw_sns_user"], ["dw_other"]]);
  }
  if (text === catalogTablesSql("hive", "dm")) {
    return sqlResult([["dm_one"]]);
  }
  if (text === catalogTablesSql("hive", "ods")) {
    return sqlResult([["ods_one"]]);
  }
  if (text === catalogTablesSql("hive_jd", "app")) {
    return sqlResult([
      ["app_user_tail_dau_i_d_i_d"],
      ["app_user_tail_retain_i_d_i_d"],
      ["日活明细"]
    ]);
  }
  if (text === "DESC `hive_jd`.`app`.`日活明细`") {
    return sqlResult([["统计日期", "date", "YES", ""]]);
  }
  if (text === "DESC `hive_jd`.`app`.`app_user_tail_dau_i_d_i_d`") {
    return sqlResult([["stat_date", "date", "YES", ""]]);
  }
  if (text === "DESC `hive_jd`.`app`.`app_user_tail_retain_i_d_i_d`") {
    return sqlResult([["retain_cnt", "bigint", "YES", ""]]);
  }
  return sqlResult([], false, `unexpected sql: ${text}`);
}

describe("isolated Doris external catalog", () => {
  it("lists hive_jd databases without querying unqualified information_schema", async () => {
    const seen: string[] = [];
    const result = await listLiveSchemas("/isolated", "hive-jd", { refresh: true }, {
      readConnectionsImpl: async () => [hiveJd, hive1],
      runSqlImpl: async (_root, _id, sql) => {
        seen.push(sql);
        return simulateIsolatedDoris(sql);
      }
    });

    expect(seen).toEqual([
      catalogSchemataSql("hive_jd"),
      catalogTablesSql("hive_jd", "app")
    ]);
    expect(seen.join("\n")).not.toMatch(/\bSHOW\b/);
    expect(seen.join("\n")).not.toMatch(/FROM information_schema/i);
    expect(result.status).toBe("ok");
    expect(result.schemas).toEqual([{ schema: "app", tableCount: 3 }]);
    expect(result.reason ?? "").not.toContain("default_cluster");
  });

  it("does not report schema app on the hive catalog connection", async () => {
    const result = await listLiveSchemas("/isolated", "hive-1", { refresh: true }, {
      readConnectionsImpl: async () => [hiveJd, hive1],
      runSqlImpl: async (_root, _id, sql) => simulateIsolatedDoris(sql)
    });

    expect(result.status).toBe("ok");
    expect(result.schemas).toEqual([
      { schema: "dw", tableCount: 2 },
      { schema: "dm", tableCount: 1 },
      { schema: "ods", tableCount: 1 }
    ]);
    expect(result.schemas.some((item) => item.schema === "app")).toBe(false);
  });

  it("reads the two target tables from hive_jd.app through the simulator", async () => {
    const seen: string[] = [];
    const preview = await previewSchemaStructure("/isolated", "hive-jd", "app", {
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl: async (_root, _id, sql) => {
        seen.push(sql);
        return simulateIsolatedDoris(sql);
      }
    });

    expect(seen.join("\n")).not.toMatch(/\bSHOW\b/);
    expect(seen.some((sql) => sql.startsWith("DESC "))).toBe(true);
    expect(preview.tableCount).toBe(3);
    expect(preview.yaml).toContain("app_user_tail_dau_i_d_i_d");
    expect(preview.yaml).toContain("app_user_tail_retain_i_d_i_d");
    expect(preview.yaml).toContain("日活明细");
    expect(preview.yaml).toContain("统计日期");
    expect(preview.readable).toBe(true);
  });

  it("keeps tables already read when one hive table cannot return columns", async () => {
    const preview = await previewSchemaStructure("/isolated", "hive-jd", "app", {
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl: async (_root, _id, sql) => {
        if (sql.includes("日活明细")) return sqlResult([], false, "rejected");
        return simulateIsolatedDoris(sql);
      }
    });

    expect(preview.tableCount).toBe(2);
    expect(preview.yaml).not.toContain("日活明细");
    expect(preview.yaml).toContain("app_user_tail_dau_i_d_i_d");
  });

  it("still fails when every hive table returns no columns", async () => {
    await expect(previewSchemaStructure("/isolated", "hive-jd", "app", {
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl: async (_root, _id, sql) => {
        if (sql === catalogTablesSql("hive_jd", "app")) return simulateIsolatedDoris(sql);
        return sqlResult([], false, "rejected");
      }
    })).rejects.toMatchObject({
      code: "READ_FAILED",
      message: "读取表结构失败：rejected"
    });
  });

  it("reads more than 200 hive tables", async () => {
    const names = Array.from({ length: 201 }, (_, index) => `t${index}`);
    const preview = await previewSchemaStructure("/isolated", "hive-jd", "app", {
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl: async (_root, _id, sql) => {
        if (sql === catalogTablesSql("hive_jd", "app")) return sqlResult(names.map((name) => [name]));
        const match = sql.match(/^DESC `hive_jd`\.`app`\.`(t\d+)`$/);
        if (match) return sqlResult([["id", "bigint", null, "YES", "", null, "", "", ""]]);
        return sqlResult([], false, `unexpected ${sql}`);
      }
    });

    expect(preview.tableCount).toBe(201);
    expect(preview.columnCount).toBe(201);
  });

  it("lists hive_jd.app tables from the catalog information_schema and never emits SHOW", async () => {
    const seen: string[] = [];
    const provider = createSqlLiveTableProvider({
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl: async (_root, _id, sql) => {
        seen.push(sql);
        return simulateIsolatedDoris(sql);
      }
    });
    const result = await provider.listTables({
      projectRoot: "/isolated",
      connectionId: "hive-jd",
      schema: "app",
      generation: 0
    });

    expect(seen).toEqual([catalogTablesSql("hive_jd", "app")]);
    expect(seen.join("\n")).not.toMatch(/\bSHOW\b/);
    expect(seen.join("\n")).toMatch(/`hive_jd`\.`information_schema`/);
    expect(result.status).toBe("ok");
    expect(result.tables.map((item) => item.table)).toEqual([
      "app_user_tail_dau_i_d_i_d",
      "app_user_tail_retain_i_d_i_d",
      "日活明细"
    ]);
  });
});
