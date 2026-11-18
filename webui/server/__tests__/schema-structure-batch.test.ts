import { afterEach, describe, expect, it, vi } from "vitest";
import { MetadataChannelUnavailable, type MetadataChannel } from "../metadata-channel";
import type { ConnectionInfo } from "../model";
import type { SqlResult } from "../ktx";
import { previewSchemaStructure, readSchemaColumns, SchemaStructureError } from "../schema-structure";
import { MAX_TABLES_PER_CALL, parseRequestedTables } from "../schema-structure-batch";

const mysqlConn: ConnectionInfo = {
  id: "demo",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  schemas: ["dw"],
  enabledTables: []
};
const hiveConn: ConnectionInfo = { ...mysqlConn, id: "hive-1", database: "hive.dw" };

afterEach(() => {
  delete process.env.LUCY_SCHEMA_READ_LEGACY;
});

function literals(sql: string, marker: string): string[] {
  const list = sql.slice(sql.indexOf(marker) + marker.length);
  return [...list.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1].replace(/''/g, "'"));
}

/** A MySQL information_schema that holds `tables` (name → column count). */
function mysqlChannel(tables: Record<string, number>, clock?: { now: number; costMs: number }) {
  const statements: string[] = [];
  const channel: MetadataChannel = {
    async run(sql, options) {
      statements.push(sql);
      if (clock) clock.now += clock.costMs;
      if (sql.includes("FROM information_schema.tables") && !sql.includes("LOWER(table_name) IN")) {
        const rows = Object.keys(tables).sort().map((name) => [name]);
        return { rows: rows.slice(0, options.maxRows), truncated: rows.length >= options.maxRows };
      }
      if (sql.includes("FROM information_schema.tables")) {
        const wanted = new Set(literals(sql, "IN (").map((name) => name.toLowerCase()));
        const rows = Object.keys(tables).filter((name) => wanted.has(name.toLowerCase())).map((name) => [name]);
        return { rows, truncated: rows.length >= options.maxRows };
      }
      const wanted = new Set(literals(sql, "table_name IN ("));
      const rows: unknown[][] = [];
      for (const name of Object.keys(tables).sort()) {
        if (!wanted.has(name)) continue;
        for (let index = 0; index < tables[name]; index += 1) {
          rows.push([name, `c${index}`, "int", "YES", index === 0 ? "PRI" : "", ""]);
        }
      }
      return { rows: rows.slice(0, options.maxRows), truncated: rows.length >= options.maxRows };
    },
    close: vi.fn()
  };
  return { channel, statements };
}

function manyTables(count: number, columns = 10): Record<string, number> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`t_${index}`, columns]));
}

function legacySqlResult(): SqlResult {
  return { ok: true, exitCode: 0, stdout: "", stderr: "", latencyMs: 1, command: "ktx sql", args: [], json: { rows: [] } };
}

async function readBatch(
  tables: string[],
  channel: MetadataChannel,
  extra: Record<string, unknown> = {},
  connection = mysqlConn
) {
  const openChannelImpl = vi.fn(async () => channel);
  const read = await readSchemaColumns("/project", connection.id, "dw", {
    readConnectionsImpl: async () => [connection],
    mode: "per-table",
    tables,
    openChannelImpl,
    ...extra
  });
  return { read, openChannelImpl };
}

describe("batch column read, plain MySQL", () => {
  it("LS-01 reads 40 tables with one table match and one column query, without ktx sql", async () => {
    const { channel, statements } = mysqlChannel(manyTables(60));
    const runSqlImpl = vi.fn(async () => legacySqlResult());
    const names = Array.from({ length: 40 }, (_, index) => `t_${index}`);
    const { read, openChannelImpl } = await readBatch(names, channel, { runSqlImpl });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.columns).toHaveLength(400);
    expect(read.tables).toEqual(names);
    expect(statements).toHaveLength(2);
    expect(statements.filter((sql) => sql.includes("FROM information_schema.columns"))).toHaveLength(1);
    expect(runSqlImpl).not.toHaveBeenCalled();
    expect(openChannelImpl).toHaveBeenCalledOnce();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("LS-02 keeps the case and ambiguity rules", async () => {
    const { channel } = mysqlChannel({ Bar: 2, bar: 3, Orders: 4 });
    const { read } = await readBatch(["Bar", "orders", "ghost"], channel);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.rejections).toEqual([
      { table: "Bar", reason: "ambiguous" },
      { table: "ghost", reason: "missing" }
    ]);
    expect(read.tables).toEqual(["orders"]);
    expect(read.columns.every((column) => column.table === "orders")).toBe(true);
    expect(read.columns).toHaveLength(4);
  });

  it("LS-03 halves a truncated query and never drops rows", async () => {
    const { channel, statements } = mysqlChannel(manyTables(8, 30));
    const names = Array.from({ length: 8 }, (_, index) => `t_${index}`);
    const { read } = await readBatch(names, channel, { columnRowLimit: 100 });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.columns).toHaveLength(240);
    expect(read.rejections ?? []).toEqual([]);
    expect(statements.filter((sql) => sql.includes("FROM information_schema.columns")).length).toBeGreaterThan(1);
  });

  it("LS-03 reports a single table that fills the limit as too_wide", async () => {
    const { channel } = mysqlChannel({ wide: 100, narrow: 3 });
    const { read } = await readBatch(["wide", "narrow"], channel, { columnRowLimit: 100 });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.rejections).toEqual([{ table: "wide", reason: "too_wide" }]);
    expect(read.tables).toEqual(["narrow"]);
  });

  it("LS-07 defers the remaining chunks once the budget is spent, but only after one chunk has been read", async () => {
    const clock = { now: 0, costMs: 4_000 };
    const { channel } = mysqlChannel(manyTables(8, 30), clock);
    const names = Array.from({ length: 8 }, (_, index) => `t_${index}`);
    const { read } = await readBatch(names, channel, { columnRowLimit: 100, now: () => clock.now, callBudgetMs: 10_000 });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    // First columns statement always runs; after it returns, later chunks defer once over budget.
    // Deep truncation splits must not keep burning past the call budget (see LS-17).
    expect(clock.now).toBeLessThanOrEqual(10_000 + 4_000);
    const covered = [...(read.tables ?? []), ...(read.rejections ?? []).map((item) => item.table), ...(read.deferred ?? [])];
    expect([...covered].sort()).toEqual([...names].sort());
    expect((read.deferred ?? []).length).toBeGreaterThan(0);
  });

  it("LS-17 does not burn a depth-3 MySQL split tree past the call budget", async () => {
    const clock = { now: 0, costMs: 6_000 };
    const columnTimeouts: number[] = [];
    const tables = manyTables(8, 30);
    const { channel, statements } = mysqlChannel(tables, clock);
    const wrapped: MetadataChannel = {
      async run(sql, options) {
        if (sql.includes("FROM information_schema.columns")) {
          columnTimeouts.push(options.timeoutMs ?? -1);
        }
        return channel.run(sql, options);
      },
      close: channel.close
    };
    const names = Array.from({ length: 8 }, (_, index) => `t_${index}`);
    const { read } = await readBatch(names, wrapped, {
      columnRowLimit: 100,
      now: () => clock.now,
      callBudgetMs: 10_000
    });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    const columnStatements = statements.filter((sql) => sql.includes("FROM information_schema.columns"));
    // Hole was tables + three columns leaves ≈ 24s under a 10s budget while descending a truncate tree.
    expect(columnStatements.length).toBeLessThan(3);
    expect(clock.now).toBeLessThanOrEqual(10_000 + 6_000);
    const covered = [...(read.tables ?? []), ...(read.rejections ?? []).map((item) => item.table), ...(read.deferred ?? [])];
    expect([...covered].sort()).toEqual([...names].sort());
    expect((read.deferred ?? []).length).toBeGreaterThan(0);
  });

  it("LS-18 passes remaining call budget as each MySQL columns timeoutMs", async () => {
    const clock = { now: 0, costMs: 3_000 };
    const columnTimeouts: number[] = [];
    const { channel } = mysqlChannel(manyTables(4, 10), clock);
    const wrapped: MetadataChannel = {
      async run(sql, options) {
        if (sql.includes("FROM information_schema.columns")) {
          columnTimeouts.push(options.timeoutMs ?? -1);
        }
        return channel.run(sql, options);
      },
      close: channel.close
    };
    await readBatch(["t_0", "t_1", "t_2", "t_3"], wrapped, {
      now: () => clock.now,
      callBudgetMs: 10_000
    });
    expect(columnTimeouts.length).toBeGreaterThan(0);
    for (const timeoutMs of columnTimeouts) {
      expect(timeoutMs).toBeGreaterThan(0);
      expect(timeoutMs).toBeLessThanOrEqual(8_000);
      expect(timeoutMs).toBeLessThanOrEqual(10_000);
    }
    // After the name-resolve cost, remaining budget must shrink the statement timeout.
    expect(columnTimeouts[0]).toBeLessThanOrEqual(10_000 - 3_000);
  });

  it("LS-06 reads 9999 columns and rejects 10000 with the table and the number", async () => {
    const ok = await readBatch(["w"], mysqlChannel({ w: 9_999 }).channel);
    expect(ok.read.status === "ok" && ok.read.columns.length).toBe(9_999);
    const wide = await readBatch(["w"], mysqlChannel({ w: 10_000 }).channel);
    expect(wide.read.status === "ok" && wide.read.rejections).toEqual([{ table: "w", reason: "too_wide" }]);
  });
});

describe("batch column read, external catalog", () => {
  function catalogChannel(clock?: { now: number; costMs: number }) {
    const statements: string[] = [];
    const channel: MetadataChannel = {
      async run(sql) {
        statements.push(sql);
        if (clock) clock.now += clock.costMs;
        return { rows: [["id", "bigint", "NO", "true", null, null]], truncated: false };
      },
      close: vi.fn()
    };
    return { channel, statements };
  }

  it("LS-04 reads five tables over one channel", async () => {
    const { channel, statements } = catalogChannel();
    const names = ["a", "b", "c", "d", "e"];
    const { read, openChannelImpl } = await readBatch(names, channel, {}, hiveConn);
    expect(read.status === "ok" && read.tables).toEqual(names);
    expect(openChannelImpl).toHaveBeenCalledOnce();
    expect(statements).toEqual(names.map((name) => `DESC \`hive\`.\`dw\`.\`${name}\``));
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("LS-07 stops starting tables once the call budget is spent and defers the rest in order", async () => {
    const clock = { now: 0, costMs: 4_000 };
    const { channel } = catalogChannel(clock);
    const names = ["a", "b", "c", "d", "e", "f"];
    const { read } = await readBatch(names, channel, { now: () => clock.now, callBudgetMs: 10_000 }, hiveConn);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.tables).toEqual(["a", "b", "c"]);
    expect(read.deferred).toEqual(["d", "e", "f"]);
    const covered = [...(read.tables ?? []), ...(read.rejections ?? []).map((item) => item.table), ...(read.deferred ?? [])];
    expect(covered).toEqual(names);
  });

  it("always reads the first table even when the budget is already spent", async () => {
    const clock = { now: 0, costMs: 50_000 };
    const { channel } = catalogChannel(clock);
    const { read } = await readBatch(["a", "b"], channel, { now: () => clock.now, callBudgetMs: 10_000 }, hiveConn);
    expect(read.status === "ok" && read.tables).toEqual(["a"]);
    expect(read.status === "ok" && read.deferred).toEqual(["b"]);
  });

  it("LS-16 classifies catalog timed-out stderr as timeout and stops after one probe", async () => {
    const clock = { now: 0 };
    const statements: string[] = [];
    const probeTimeouts: number[] = [];
    const channel: MetadataChannel = {
      async run(sql, options) {
        statements.push(sql);
        probeTimeouts.push(options.timeoutMs ?? -1);
        clock.now += 8_000;
        throw new Error("Catalog connection/query timed out");
      },
      close: vi.fn()
    };
    const { read } = await readBatch(["slow"], channel, { now: () => clock.now, callBudgetMs: 10_000 }, hiveConn);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/^DESC /);
    expect(read.rejections).toEqual([{ table: "slow", reason: "timeout" }]);
    expect(clock.now).toBeLessThanOrEqual(10_000);
    expect(probeTimeouts[0]).toBeLessThanOrEqual(8_000);
  });

  it("LS-16 keeps DESC→SHOW→DESCRIBE for non-timeout unreadable refusals", async () => {
    const statements: string[] = [];
    const channel: MetadataChannel = {
      async run(sql) {
        statements.push(sql);
        throw new Error("You have an error in your SQL syntax near DESC");
      },
      close: vi.fn()
    };
    const { read } = await readBatch(["t"], channel, { callBudgetMs: 10_000 }, hiveConn);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(statements).toEqual([
      "DESC `hive`.`dw`.`t`",
      "SHOW COLUMNS FROM `hive`.`dw`.`t`",
      "DESCRIBE `hive`.`dw`.`t`"
    ]);
    expect(read.rejections).toEqual([{ table: "t", reason: "unreadable" }]);
  });
});

describe("fallback to the legacy per-table read", () => {
  it("LS-14 falls back when the direct channel is unavailable", async () => {
    const runSqlImpl = vi.fn(async () => legacySqlResult());
    const read = await readSchemaColumns("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      mode: "per-table",
      tables: ["t_1"],
      runSqlImpl,
      openChannelImpl: async () => {
        throw new MetadataChannelUnavailable();
      }
    });
    expect(read.status).toBe("ok");
    expect(runSqlImpl).toHaveBeenCalled();
  });

  it("LS-14 LUCY_SCHEMA_READ_LEGACY=1 never opens the channel", async () => {
    process.env.LUCY_SCHEMA_READ_LEGACY = "1";
    const runSqlImpl = vi.fn(async () => legacySqlResult());
    const openChannelImpl = vi.fn(async () => mysqlChannel({}).channel);
    await readSchemaColumns("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      mode: "per-table",
      tables: ["t_1"],
      runSqlImpl,
      openChannelImpl
    });
    expect(openChannelImpl).not.toHaveBeenCalled();
    expect(runSqlImpl).toHaveBeenCalled();
  });
});

describe("request contract", () => {
  it("LS-09 accepts 1..50 tables and rejects 51 before any source access", () => {
    expect(parseRequestedTables(undefined)).toEqual({ ok: true, tables: undefined });
    expect(parseRequestedTables(["a"])).toEqual({ ok: true, tables: ["a"] });
    expect(parseRequestedTables([" a ", "b", "a"])).toEqual({ ok: true, tables: ["a", "b"] });
    const fifty = Array.from({ length: MAX_TABLES_PER_CALL }, (_, index) => `t${index}`);
    expect(parseRequestedTables(fifty)).toEqual({ ok: true, tables: fifty });
    const tooMany = parseRequestedTables([...fifty, "extra"]);
    expect(tooMany.ok).toBe(false);
    expect(tooMany.ok === false && tooMany.message).toContain("50");
  });

  it.each([[[]], ["a"], [[1]], [[""]], [{}]])("rejects a malformed tables value %j", (value) => {
    expect(parseRequestedTables(value).ok).toBe(false);
  });
});

describe("previewSchemaStructure batch response", () => {
  const preview = (tables: string[], channel: MetadataChannel, extra: Record<string, unknown> = {}) =>
    previewSchemaStructure("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      tables,
      openChannelImpl: async () => channel,
      ...extra
    });

  it("returns the readable tables, the rejections with messages, and the deferred tables", async () => {
    const { channel } = mysqlChannel({ a: 2, b: 3 });
    const result = await preview(["a", "ghost", "b"], channel);
    expect(result.tableCount).toBe(2);
    expect(result.columnCount).toBe(5);
    expect(result.yaml).toContain("a:");
    expect(result.rejections).toEqual([{ table: "ghost", reason: "missing", message: "表「ghost」没有读到字段。" }]);
    expect(result.deferred).toBeUndefined();
  });

  it("names the table and the number for a table that is too wide", async () => {
    const { channel } = mysqlChannel({ wide: 100, narrow: 2 });
    const result = await preview(["wide", "narrow"], channel, { columnRowLimit: 100 });
    expect(result.rejections?.[0]).toMatchObject({ table: "wide", reason: "too_wide" });
    expect(result.rejections?.[0].message).toContain("「wide」");
    expect(result.rejections?.[0].message).toContain("100");
  });

  it("LS-08 keeps the one-table failure as a thrown READ_FAILED with the original sentence", async () => {
    const { channel } = mysqlChannel({ a: 2 });
    const failure = await preview(["ghost"], channel).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SchemaStructureError);
    expect((failure as SchemaStructureError).message).toBe("表「ghost」没有读到字段。");
    expect((failure as SchemaStructureError).statusCode).toBe(400);
  });

  it("LS-08 keeps the one-table success shape without batch fields", async () => {
    const { channel } = mysqlChannel({ a: 2 });
    const result = await preview(["a"], channel);
    expect(result).toMatchObject({ schema: "dw", tableCount: 1, columnCount: 2, namesOnly: false });
    expect(result.rejections).toBeUndefined();
    expect(result.deferred).toBeUndefined();
  });

  it("the legacy fallback honours the call budget too", async () => {
    const clock = { now: 0 };
    const runSqlImpl = vi.fn(async (_root: string, _id: string, sql: string) => {
      clock.now += 3_000;
      const rows = sql.includes("FROM information_schema.tables") ? [["a"]] : [["id", "int", "NO", "PRI", ""]];
      return { ...legacySqlResult(), json: { rows } };
    });
    const read = await readSchemaColumns("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      mode: "per-table",
      tables: ["a", "b", "c"],
      runSqlImpl,
      callBudgetMs: 10_000,
      now: () => clock.now
    });
    expect(read.status === "ok" && read.deferred).toEqual(["c"]);
  });
});

describe("table name list, plain MySQL", () => {
  it("lists 12000 tables over the direct channel, past the ktx sql 10000-row page", async () => {
    const { channel, statements } = mysqlChannel(manyTables(12_000, 1));
    const runSqlImpl = vi.fn(async () => legacySqlResult());
    const read = await readSchemaColumns("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      openChannelImpl: async () => channel,
      runSqlImpl
    });
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.tables).toHaveLength(12_000);
    expect(statements).toHaveLength(1);
    expect(runSqlImpl).not.toHaveBeenCalled();
    expect(channel.close).toHaveBeenCalledOnce();
  });

  it("reports a failed name list with the phase sentence and no driver text", async () => {
    const channel: MetadataChannel = {
      run: async () => {
        throw new Error("Access denied for user secret-driver-text");
      },
      close: vi.fn()
    };
    const failure = await previewSchemaStructure("/project", "demo", "dw", {
      readConnectionsImpl: async () => [mysqlConn],
      openChannelImpl: async () => channel
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SchemaStructureError);
    expect((failure as SchemaStructureError).message).toBe("读取表结构失败：无法列出 Schema「dw」下的表。");
    expect(JSON.stringify(failure)).not.toContain("secret-driver-text");
    expect(channel.close).toHaveBeenCalledOnce();
  });
});
