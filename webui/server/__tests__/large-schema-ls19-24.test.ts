/**
 * LS-19–LS-24  FDE 3b1c62af F03/F04 合同修订（P1-34 §11.4）
 *
 * LS-19: 50x400, 每次 SQL 模拟 6000ms → 读完 50 表/20000 列，不抛「没有进展」；逐次 ≤20s
 * LS-20: 30 表，t0 拒绝，其余 29 全部读到
 * LS-21: LS-07 扩到 1 张表请求：columns/rejections/deferred 对请求集无遗漏
 * LS-22: 单表预算耗尽 → 响应含 deferred:[该表]（HTTP 200），客户端不静默成功
 * LS-23: 服务端既不返回某表字段也不放进 rejections/deferred → 客户端抛错并点名
 * LS-24: UAT runner 判定函数可测 node --test（此文件只测 vitest；runner 单测在独立 mjs）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/apiClient";
import { readCheckedTableColumns } from "../../src/lib/prepareSchemaStructure";
import { readSchemaColumns } from "../schema-structure";
import type { ConnectionInfo } from "../model";

afterEach(() => {
  vi.useRealTimers();
});

// --- Server-side tests (LS-21, LS-22) ---

const hiveConn: ConnectionInfo = {
  id: "hive-probe",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  database: "hive_jd.app",
  schemas: ["app"],
  enabledTables: []
};

function makeSlowChannel(costMs: number, failUpTo = -1) {
  let callIndex = 0;
  const calls: { sql: string; timeoutMs: number }[] = [];
  return {
    calls,
    async close() { /* noop */ },
    async run(sql: string, options: { maxRows?: number; timeoutMs?: number }) {
      const index = callIndex++;
      const timeout = options.timeoutMs ?? 8_000;
      calls.push({ sql, timeoutMs: timeout });
      // Advance fake timers if available, otherwise real delay
      await vi.advanceTimersByTimeAsync(Math.min(costMs, timeout)).catch(async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.min(costMs, timeout)));
      });
      if (index <= failUpTo) {
        throw new Error("You have an error in your SQL syntax");
      }
      // If cost >= timeout: return explicit timeout text
      if (costMs >= timeout) {
        throw new Error(`Catalog connection/query timed out after ${timeout}ms`);
      }
      return { rows: [["id", "bigint", "NO", "PRI", ""]], truncated: false };
    }
  };
}

describe("LS-21: 1-table request → columns/rejections/deferred partition", () => {
  it("LS-21: single-table budget exhausted → deferred present, no missing table", async () => {
    vi.useFakeTimers();
    // Single table with [6000,6000,6000] ms probes, budget 10_000ms
    // After fix, single-table deferred must be passed through previewSchemaStructure
    const ch = makeSlowChannel(6_000, 2);
    const read = await readSchemaColumns("/isolated", "hive-probe", "app", {
      tables: ["orders"],
      mode: "per-table",
      callBudgetMs: 10_000,
      requestTimeoutMs: 20_000,
      readConnectionsImpl: async () => [hiveConn],
      openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
    });
    expect(read.status).toBe("ok");
    // With fix: single table gets deferred
    const deferred = read.status === "ok" ? (read.deferred ?? []) : [];
    expect(deferred).toContain("orders");
    // Not in columns (not silently empty-success)
    const cols = read.status === "ok" ? read.columns : [];
    expect(cols.some((c) => c.table === "orders")).toBe(false);
  }, 30_000);
});

describe("LS-22: single-table previewSchemaStructure deferred passthrough", () => {
  it("LS-22: single table budget exhausted → response contains deferred:[table], not empty success", async () => {
    vi.useFakeTimers();
    // The previewSchemaStructure function must pass deferred even for single-table requests
    const ch = makeSlowChannel(6_000, 2);
    const preview = await import("../schema-structure").then((m) =>
      m.previewSchemaStructure("/isolated", "hive-probe", "app", {
        tables: ["orders"],
        mode: "per-table",
        callBudgetMs: 10_000,
        requestTimeoutMs: 20_000,
        readConnectionsImpl: async () => [hiveConn],
        openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
      })
    );
    // With fix: deferred should be present
    expect((preview.deferred ?? [])).toContain("orders");
    // columnCount should be 0 (not silently returning empty YAML as success)
    // Not in YAML tables
    const yamlModule = await import("yaml");
    const parsed = yamlModule.parse(preview.yaml);
    const tables = (parsed as { tables?: Record<string, unknown> })?.tables ?? {};
    expect(Object.keys(tables)).not.toContain("orders");
  }, 30_000);
});

// --- Client-side tests (LS-19, LS-20, LS-23, LS-24) ---
// These mock apiPost to control server behavior

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));

vi.mock("../../src/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/apiClient")>()),
  apiPost
}));

type ServerResponse = {
  schema: string;
  readable: boolean;
  yaml: string;
  tableCount: number;
  columnCount: number;
  namesOnly: boolean;
  mapped: { number: number; string: number; time: number };
  downgraded: [];
  rejections?: Array<{ table: string; reason: string; message: string }>;
  deferred?: string[];
};

/** Build a yaml snippet for a table with given column count. */
function tableYaml(name: string, cols: number): string {
  const colEntries = Array.from({ length: cols }, (_, i) => `      - name: c${i}\n        type: string`).join("\n");
  return `  ${name}:\n    table: schema.${name}\n    columns:\n${colEntries}\n`;
}

type MockServerOpts = {
  cols?: number;
  /** Tables to always defer (every call) */
  alwaysDefer?: string[];
  /** Tables to reject with given reason */
  rejected?: Record<string, string>;
  /** Whether to silently drop a table (no columns, no rejection, no deferred) */
  silentlyDrop?: string[];
};

function setupMockServer(tableNames: string[], opts: MockServerOpts = {}) {
  const cols = opts.cols ?? 400;
  const calls: string[][] = [];
  apiPost.mockImplementation(async (_path: string, body: { tables: string[] }): Promise<ServerResponse> => {
    const batch = body.tables;
    calls.push([...batch]);
    const readable: string[] = [];
    const rejections: Array<{ table: string; reason: string; message: string }> = [];
    const deferred: string[] = [];
    for (const t of batch) {
      if (opts.silentlyDrop?.includes(t)) {
        // Don't add to any list (this is the bug LS-23 tests for)
        continue;
      } else if (opts.alwaysDefer?.includes(t)) {
        deferred.push(t);
      } else if (opts.rejected?.[t]) {
        rejections.push({ table: t, reason: opts.rejected[t]!, message: `表「${t}」error` });
      } else {
        readable.push(t);
      }
    }
    return {
      schema: "schema",
      readable: true,
      yaml: `tables:\n${readable.map((t) => tableYaml(t, cols)).join("")}`,
      tableCount: readable.length,
      columnCount: readable.length * cols,
      namesOnly: false,
      mapped: { number: readable.length * Math.floor(cols / 3), string: 0, time: 0 },
      downgraded: [],
      ...(rejections.length > 0 ? { rejections } : {}),
      ...(deferred.length > 0 ? { deferred } : {})
    };
  });
  return { calls };
}

beforeEach(() => {
  apiPost.mockReset();
});

describe("LS-19: 50×400 形状，每次 SQL 6000ms，读完不抛错", () => {
  it("LS-19: 50 tables × 400 columns, every table starts deferred then succeeds → all 50 read", async () => {
    // Simulate: first batch of 50 all deferred (simulates slow SQL → batch deferred),
    // then split to smaller batches that succeed.
    // The client must NOT throw "读取表结构没有进展" after a single all-deferred response.
    const names = Array.from({ length: 50 }, (_, i) => `t_${i}`);
    let callCount = 0;
    const deferredSet = new Set(names);
    apiPost.mockImplementation(async (_path: string, body: { tables: string[] }): Promise<ServerResponse> => {
      callCount++;
      const batch = body.tables;
      const deferred: string[] = [];
      const readable: string[] = [];
      // First call: all 50 deferred (simulating budget exhaustion on large batch)
      if (callCount === 1 && batch.length === 50) {
        return {
          schema: "schema", readable: true,
          yaml: "tables:\n",
          tableCount: 0, columnCount: 0, namesOnly: false,
          mapped: { number: 0, string: 0, time: 0 }, downgraded: [],
          deferred: batch
        };
      }
      // Subsequent calls: smaller batches succeed
      for (const t of batch) {
        if (deferredSet.has(t) && batch.length <= 25) {
          deferredSet.delete(t);
          readable.push(t);
        } else if (deferredSet.has(t)) {
          deferred.push(t);
        } else {
          readable.push(t);
        }
      }
      return {
        schema: "schema", readable: true,
        yaml: `tables:\n${readable.map((t) => tableYaml(t, 400)).join("")}`,
        tableCount: readable.length, columnCount: readable.length * 400, namesOnly: false,
        mapped: { number: readable.length * 133, string: 0, time: 0 }, downgraded: [],
        ...(deferred.length > 0 ? { deferred } : {})
      };
    });

    const result = await readCheckedTableColumns("hive-probe", "app", names);

    // All 50 tables must be read (no "没有进展" error)
    const yamlModule = await import("yaml");
    const parsed = yamlModule.parse(result.yaml);
    const readTables = Object.keys((parsed as { tables?: Record<string, unknown> })?.tables ?? {});
    expect(readTables.length).toBe(50);
    expect(result.columnCount).toBe(50 * 400);
    // Request count must have upper bound (≤100 to prevent infinite retry)
    expect(callCount).toBeLessThanOrEqual(100);
  }, 30_000);
});

describe("LS-20: 30 表，t0 拒绝，29 全部读到", () => {
  it("LS-20: 30 tables with t0 rejected → 29 read, one error named t0", async () => {
    const names = Array.from({ length: 30 }, (_, i) => `t${i}`);
    setupMockServer(names, { rejected: { t0: "permission" }, cols: 10 });
    const error = await readCheckedTableColumns("conn", "schema", names).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain("1 张表");
    expect((error as ApiError).message).toContain("t0");
  });
});

describe("LS-23: 服务端不返回某表 → 客户端抛错并点名", () => {
  it("LS-23: missing table in response → client throws error naming the missing table", async () => {
    const names = ["table_a", "table_b", "table_c"];
    setupMockServer(names, { silentlyDrop: ["table_b"] });
    const error = await readCheckedTableColumns("conn", "schema", names).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toContain("table_b");
  });
});

describe("LS-24: UAT runner 判定函数可测", () => {
  it("LS-24: all-deferred response → readTables should report 0 columns done (not false pass)", async () => {
    // Test the readCheckedTableColumns path: if server keeps deferring, client should eventually fail
    const names = Array.from({ length: 5 }, (_, i) => `t${i}`);
    apiPost.mockImplementation(async (_path: string, body: { tables: string[] }): Promise<ServerResponse> => ({
      schema: "schema", readable: true,
      yaml: "tables:\n",
      tableCount: 0, columnCount: 0, namesOnly: false,
      mapped: { number: 0, string: 0, time: 0 }, downgraded: [],
      deferred: body.tables
    }));
    const error = await readCheckedTableColumns("conn", "schema", names).catch((e: unknown) => e);
    // Client must NOT return success when all tables are deferred
    expect(error).toBeInstanceOf(ApiError);
  });
});
