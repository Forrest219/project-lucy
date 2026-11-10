import { describe, expect, it, vi } from "vitest";
import { listLiveSchemas } from "../live-catalog";
import { createSqlLiveTableProvider } from "../live-tables";
import { previewSchemaStructure } from "../schema-structure";
import type { SqlResult } from "../ktx";
import type { ConnectionInfo } from "../model";

/**
 * Isolated stand-in for SelectDB at 172.16.19.21. Unqualified information_schema
 * fails the way the external catalog does; catalog-qualified SHOW statements
 * return hive_jd.app without opening a network connection.
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
  if (/\binformation_schema\b/i.test(text)) {
    return sqlResult([], false, DEFAULT_CLUSTER_ERROR);
  }
  if (text === "SHOW DATABASES FROM `hive_jd`") {
    return sqlResult([["app"], ["information_schema"]]);
  }
  if (text === "SHOW DATABASES FROM `hive`") {
    return sqlResult([["dw"], ["dm"], ["ods"]]);
  }
  if (text === "SHOW TABLES FROM `hive`.`dw`") {
    return sqlResult([["dw_sns_user"], ["dw_other"]]);
  }
  if (text === "SHOW TABLES FROM `hive`.`dm`") {
    return sqlResult([["dm_one"]]);
  }
  if (text === "SHOW TABLES FROM `hive`.`ods`") {
    return sqlResult([["ods_one"]]);
  }
  if (text === "SHOW TABLES FROM `hive_jd`.`app`") {
    return sqlResult([
      ["app_user_tail_dau_i_d_i_d"],
      ["app_user_tail_retain_i_d_i_d"],
      ["日活明细"]
    ]);
  }
  if (text === "SHOW FULL COLUMNS FROM `hive_jd`.`app`.`日活明细`") {
    return sqlResult([["统计日期", "date", null, "YES", "", null, "", "", "业务日期"]]);
  }
  if (text === "SHOW FULL COLUMNS FROM `hive_jd`.`app`.`app_user_tail_dau_i_d_i_d`") {
    return sqlResult([["stat_date", "date", null, "YES", "", null, "", "", "统计日期"]]);
  }
  if (text === "SHOW FULL COLUMNS FROM `hive_jd`.`app`.`app_user_tail_retain_i_d_i_d`") {
    return sqlResult([["retain_cnt", "bigint", null, "YES", "", null, "", "", "留存人数"]]);
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
      "SHOW DATABASES FROM `hive_jd`",
      "SHOW TABLES FROM `hive_jd`.`app`"
    ]);
    expect(seen.join("\n")).not.toMatch(/information_schema/i);
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

    expect(seen.some((sql) => /information_schema/i.test(sql))).toBe(false);
    expect(preview.tableCount).toBe(3);
    expect(preview.yaml).toContain("app_user_tail_dau_i_d_i_d");
    expect(preview.yaml).toContain("app_user_tail_retain_i_d_i_d");
    expect(preview.yaml).toContain("日活明细");
    expect(preview.yaml).toContain("统计日期");
    expect(preview.readable).toBe(true);
  });

  it("lists hive_jd.app tables with SHOW TABLES and never touches information_schema", async () => {
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

    expect(seen).toEqual(["SHOW TABLES FROM `hive_jd`.`app`"]);
    expect(seen.join("\n")).not.toMatch(/information_schema/i);
    expect(result.status).toBe("ok");
    expect(result.tables.map((item) => item.table)).toEqual([
      "app_user_tail_dau_i_d_i_d",
      "app_user_tail_retain_i_d_i_d",
      "日活明细"
    ]);
  });

  /**
   * Field reproduction for customer SelectDB: SHOW TABLES works, but
   * SHOW FULL COLUMNS is rejected. Fall back to DESCRIBE so prepare-structure
   * still returns tables (and can write a local manifest).
   */
  it("falls back to DESCRIBE when SelectDB rejects SHOW FULL COLUMNS", async () => {
    const seen: string[] = [];
    const runSqlImpl = async (_root: string, _id: string, sql: string) => {
      seen.push(sql);
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "SHOW TABLES FROM `hive_jd`.`app`") {
        return sqlResult([
          ["app_user_tail_dau_i_d_i_d"],
          ["日活明细"]
        ]);
      }
      if (text.startsWith("SHOW FULL COLUMNS FROM `hive_jd`.`app`.")) {
        return sqlResult([], false, "errCode = 2, detailMessage =\nUnsupported command: SHOW FULL COLUMNS");
      }
      if (text.startsWith("SHOW COLUMNS FROM `hive_jd`.`app`.")) {
        return sqlResult([], false, "errCode = 2, detailMessage =\nUnsupported command: SHOW COLUMNS");
      }
      if (text === "DESCRIBE `hive_jd`.`app`.`日活明细`") {
        return sqlResult([["统计日期", "date", "YES", "", null, ""]]);
      }
      if (text === "DESCRIBE `hive_jd`.`app`.`app_user_tail_dau_i_d_i_d`") {
        return sqlResult([["stat_date", "date", "YES", "", null, ""]]);
      }
      if (/\binformation_schema\b/i.test(text)) {
        return sqlResult([], false, DEFAULT_CLUSTER_ERROR);
      }
      return sqlResult([], false, `unexpected sql: ${text}`);
    };

    const preview = await previewSchemaStructure("/isolated", "hive-jd", "app", {
      readConnectionsImpl: async () => [hiveJd],
      runSqlImpl
    });

    expect(preview.readable).toBe(true);
    expect(preview.tableCount).toBe(2);
    expect(preview.yaml).toContain("日活明细");
    expect(preview.yaml).toContain("app_user_tail_dau_i_d_i_d");
    expect(preview.yaml).toContain("统计日期");
    expect(seen[0]).toBe("SHOW TABLES FROM `hive_jd`.`app`");
    expect(seen.some((sql) => sql.startsWith("SHOW FULL COLUMNS FROM `hive_jd`.`app`."))).toBe(true);
    expect(seen.some((sql) => sql.startsWith("DESCRIBE `hive_jd`.`app`."))).toBe(true);
    expect(seen.join("\n")).not.toMatch(/information_schema/i);
  });

  it("keeps catalog tables when every column probe is rejected", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runSqlImpl = async (_root: string, _id: string, sql: string) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "SHOW TABLES FROM `hive_jd`.`app`") {
        return sqlResult([["日活明细"]]);
      }
      if (
        text.startsWith("SHOW FULL COLUMNS FROM `hive_jd`.`app`.") ||
        text.startsWith("SHOW COLUMNS FROM `hive_jd`.`app`.") ||
        text.startsWith("DESCRIBE `hive_jd`.`app`.")
      ) {
        return sqlResult([], false, "errCode = 2, detailMessage =\nUnsupported command");
      }
      return sqlResult([], false, `unexpected sql: ${text}`);
    };

    try {
      const preview = await previewSchemaStructure("/isolated", "hive-jd", "app", {
        readConnectionsImpl: async () => [hiveJd],
        runSqlImpl
      });

      expect(preview.readable).toBe(true);
      expect(preview.tableCount).toBe(1);
      expect(preview.columnCount).toBe(0);
      expect(preview.yaml).toContain("日活明细");
      expect(warn).toHaveBeenCalledWith(
        "[schema-structure] catalog column probes exhausted; keeping table without columns",
        expect.objectContaining({
          connectionId: "hive-jd",
          schema: "app",
          table: "日活明细",
          rejected: expect.arrayContaining([
            expect.objectContaining({ stderr: expect.stringContaining("Unsupported command") })
          ])
        })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("logs driver stderr when catalog SHOW TABLES itself fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const runSqlImpl = async (_root: string, _id: string, sql: string) => {
      const text = sql.replace(/\s+/g, " ").trim();
      if (text === "SHOW TABLES FROM `hive_jd`.`app`") {
        return sqlResult([], false, "errCode = 2, detailMessage =\nUnknown catalog 'hive_jd'");
      }
      return sqlResult([], false, `unexpected sql: ${text}`);
    };

    try {
      await expect(
        previewSchemaStructure("/isolated", "hive-jd", "app", {
          readConnectionsImpl: async () => [hiveJd],
          runSqlImpl
        })
      ).rejects.toMatchObject({
        message: expect.stringMatching(/^读取表结构失败：无法列出 Schema「app」下的表。数据库返回：.*Unknown catalog 'hive_jd'/)
      });

      expect(error).toHaveBeenCalledWith(
        "[schema-structure] read failed",
        expect.objectContaining({
          connectionId: "hive-jd",
          schema: "app",
          phase: "catalog-list-tables",
          stderr: expect.stringContaining("Unknown catalog 'hive_jd'")
        })
      );
    } finally {
      error.mockRestore();
    }
  });
});
