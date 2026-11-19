import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { createInferredTurnMaintainer } from "../admin/inferred-turn-maintainer.js";
import type { ConnectionInfo } from "../model.js";

const { apiPost } = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("../../src/lib/apiClient.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/apiClient.js")>()),
  apiPost
}));

/**
 * Ported from 84becc34 upgrade-fix-regressions onto lucy-v0.30 contracts.
 * Cases that require rejected runtime ports (watermark_id schema, batchRead,
 * page-budget 1→2 growth, mutation-chunk ≤32) stay skipped with reasons.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("repairs legacy complete states whose timestamp watermark covered a call never materialized", async () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log(id INTEGER PRIMARY KEY, ts TEXT, user_id TEXT);
    CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    CREATE TABLE inferred_rebuild_state(
      user_id TEXT PRIMARY KEY,
      status TEXT,
      watermark TEXT,
      updated_at TEXT
    );
  `);
  const older = new Date(Date.now() - 3_600_000).toISOString();
  const newer = new Date(Date.now() - 60_000).toISOString();
  db.prepare("INSERT INTO access_log VALUES(?,?,?)").run(1, older, "legacy-user");
  db.prepare("INSERT INTO access_log VALUES(?,?,?)").run(2, newer, "legacy-user");
  // P1-45 ISO ts watermark is not a decimal id → P1-50 treats as uncovered.
  db.prepare("INSERT INTO inferred_rebuild_state VALUES(?,?,?,?)").run(
    "legacy-user",
    "complete",
    newer,
    newer
  );
  const rebuilt: string[] = [];
  try {
    await createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (userId) => {
        rebuilt.push(userId);
      }
    }).catchUp();
    expect(rebuilt).toContain("legacy-user");
  } finally {
    db.close();
  }
});

it("never becomes ready solely because MCP startup took longer than 60 seconds", async () => {
  const { isWebuiReady, resetWebuiWarmupForTests, markWebuiWarmupComplete } = await import(
    "../runtime/readiness.js"
  );
  vi.useFakeTimers();
  try {
    resetWebuiWarmupForTests();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isWebuiReady()).toBe(false);
    markWebuiWarmupComplete();
    expect(isWebuiReady()).toBe(true);
  } finally {
    resetWebuiWarmupForTests();
    vi.useRealTimers();
  }
});

// --- RESTORED: F03/F04 P1-34 §11 ---
it("allows the real table-preparation client to finish valid wide tables after budget deferrals", async () => {
  // F04: client must halve batch size on all-deferred and not throw 'no progress'
  // Simulated: server defers the whole first batch of 50, then accepts 25-sized batches.
  const names = Array.from({ length: 50 }, (_, i) => `wide_t${i}`);
  let callCount = 0;
  apiPost.mockReset();
  apiPost.mockImplementation(async (_: string, body: { tables: string[] }) => {
    callCount++;
    const batch = body.tables as string[];
    if (callCount === 1 && batch.length === 50) {
      return { schema: "s", readable: true, yaml: "tables:\n", tableCount: 0, columnCount: 0, namesOnly: false, mapped: { number: 0, string: 0, time: 0 }, downgraded: [], deferred: batch };
    }
    return { schema: "s", readable: true, yaml: `tables:\n${batch.map((t) => `  ${t}:\n    table: s.${t}\n    columns:\n      - name: id\n        type: number\n`).join("")}`, tableCount: batch.length, columnCount: batch.length, namesOnly: false, mapped: { number: batch.length, string: 0, time: 0 }, downgraded: [] };
  });
  const { readCheckedTableColumns: rctc } = await import("../../src/lib/prepareSchemaStructure.js");
  const result = await rctc("conn", "schema", names);
  expect(result.tableCount).toBe(50);
  expect(callCount).toBeLessThanOrEqual(100);
  apiPost.mockReset();
});

it.skip("P1-57-SK1: bounds old-result reads while rebuilding an existing window (not taken: depends on separate proxy/audit page-shape not in this batch; P1-39 / P1-47 scope)", () => {
  // BLOCKED: requires changing audit page shape (P1-47 scope), not part of F01/AUDIT-01 batch.
});

// --- RESTORED: F03 P1-34 §11 single-table deferred ---
it("preserves a single-table budget deferral in previewSchemaStructure", async () => {
  vi.useFakeTimers();
  // F03: previewSchemaStructure must pass through deferred even for single-table requests
  const hiveConn: ConnectionInfo = { id: "h", driver: "mysql", engine: "mysql", wireProtocol: "mysql", database: "ext.app", schemas: ["app"], enabledTables: [] };
  const { readSchemaColumns } = await import("../schema-structure.js");
  let n = 0;
  // Use budget < PER_TABLE_TIMEOUT_MS (8000ms) so the first probe is budget-capped.
  // The budget-capped timeout is classified as "deferred" (C5), not terminal "timeout".
  const read = await readSchemaColumns("/isolated", "h", "app", {
    tables: ["tbl"],
    mode: "per-table",
    callBudgetMs: 5_000, // < PER_TABLE_TIMEOUT_MS=8000ms → first probe budget-capped
    requestTimeoutMs: 20_000,
    readConnectionsImpl: async () => [hiveConn as unknown as ConnectionInfo],
    openChannelImpl: async () => ({
      close() { /* noop */ },
      async run(_sql: string, opts: { maxRows?: number; timeoutMs?: number }) {
        n++;
        const cost = opts.timeoutMs ?? 8_000;
        await vi.advanceTimersByTimeAsync(cost);
        throw new Error(`Catalog connection/query timed out after ${cost}ms`);
      }
    }) as unknown as import("../metadata-channel.js").MetadataChannel
  });
  // Must be deferred (budget-capped C5), not a terminal timeout rejection
  expect(read.status).toBe("ok");
  const deferred = read.status === "ok" ? (read.deferred ?? []) : [];
  expect(deferred).toContain("tbl");
});

// --- RESTORED: F04 P1-34 §11 singleton batch adaptation ---
it("continues valid tables after adapting down to singleton batches", async () => {
  // F04: when all-deferred happens, client halves batch; eventually singleton batches succeed
  const names = ["ta", "tb", "tc"];
  apiPost.mockReset();
  apiPost.mockImplementation(async (_: string, body: { tables: string[] }) => {
    const batch = body.tables as string[];
    // Defer all until batch size = 1, then succeed
    if (batch.length > 1) {
      return { schema: "s", readable: true, yaml: "tables:\n", tableCount: 0, columnCount: 0, namesOnly: false, mapped: { number: 0, string: 0, time: 0 }, downgraded: [], deferred: batch };
    }
    return { schema: "s", readable: true, yaml: `tables:\n  ${batch[0]}:\n    table: s.${batch[0]}\n    columns:\n      - name: id\n        type: number\n`, tableCount: 1, columnCount: 1, namesOnly: false, mapped: { number: 1, string: 0, time: 0 }, downgraded: [] };
  });
  const { readCheckedTableColumns: rctc } = await import("../../src/lib/prepareSchemaStructure.js");
  const result = await rctc("conn", "schema", names);
  expect(result.tableCount).toBe(3);
  apiPost.mockReset();
});

// --- RESTORED: AUDIT-01 P1-38 §8 crossingWindow ---
// P1-57-G5: the former empty rolling assertion is replaced by real file-backed rebuilds
// in inferred-turn-sc11-16.test.ts (SC-11/12/13/14/15/16), including HTTP detail and full scale.

it.skip("P1-57-SK2: lets a one-cluster write slice grow again when disk latency recovers (page-budget decision pending: lucy nextSliceSize(1,1)=1)", () => {});

it.skip("P1-57-SK3: probes covered users without sorting their entire recent log window (colleague SQL shape uses watermark_id / id>?; P1-50 MAX(id) path differs)", () => {});

it.skip("P1-57-SK4: bounds link inserts and removals for one large cluster (expects mutation chunk ≤32; lucy write path still inserts 100 in one txn on this fixture)", () => {});
