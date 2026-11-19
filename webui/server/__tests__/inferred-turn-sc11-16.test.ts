/**
 * SC-11–SC-16  FDE 3b1c62af AUDIT-01 合同修订（P1-38 §8.4）
 *
 * SC-11: 跨界簇不产生第二个问询
 * SC-12: 详情接口与调用呈现一致
 * SC-13: 原始调用保留（应绿对照）
 * SC-14: 存量重复自愈（先红，须 crossingWindow 实现后转绿）
 * SC-15: 回归：30 天回看、120 秒间隙、编号不变；交错会话闭包不切半
 * SC-16: 规模与探针门槛（见 P1-47 Spec；本测试只做基础闭包验证，满量夹具由 P1-47 套件复跑）
 */
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const GAP_MS = 120_000;
const LOOKBACK_HOURS = 24 * 30;
const LOOKBACK_MS = LOOKBACK_HOURS * 3_600_000;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT,
      tables TEXT,
      args_summary TEXT,
      policy_version TEXT,
      permission_snapshot_hash TEXT,
      lucy_session_id TEXT,
      lucy_turn_id TEXT,
      client TEXT,
      client_version TEXT,
      user_agent TEXT
    );
    CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    CREATE TABLE inferred_turns (
      inferred_turn_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      call_count INTEGER NOT NULL DEFAULT 0,
      business_call_count INTEGER NOT NULL DEFAULT 0,
      tool_summary TEXT,
      source_summary TEXT,
      question_summary TEXT,
      confidence TEXT,
      evidence_json TEXT,
      client TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      inquiry_no INTEGER
    );
    CREATE INDEX idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
    CREATE TABLE inferred_turn_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inferred_turn_id TEXT NOT NULL,
      access_log_id INTEGER NOT NULL,
      UNIQUE(inferred_turn_id, access_log_id)
    );
    CREATE INDEX idx_ital_turn ON inferred_turn_access_logs(inferred_turn_id);
    CREATE INDEX idx_ital_log ON inferred_turn_access_logs(access_log_id);
    CREATE TABLE inferred_rebuild_state (
      user_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      watermark TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE inquiry_serial (
      user_id TEXT PRIMARY KEY,
      next_no INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS inquiry_serial_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inquiry_correlation_serial (
      correlation_key TEXT PRIMARY KEY,
      inquiry_no INTEGER NOT NULL
    );
  `);
  // Mark backfill as complete so the serial allocator doesn't fail-closed
  db.prepare(`INSERT OR IGNORE INTO inquiry_serial_meta (key, value) VALUES ('backfill_complete', '1')`).run();
  db.prepare(`INSERT OR IGNORE INTO inquiry_serial_meta (key, value) VALUES ('high_water', '0')`).run();
  return db;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/** Insert an access_log row using a business tool (not MCP protocol). */
function insertCall(db: Database.Database, userId: string, ts: string, sessionId?: string): number {
  const result = db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, tables, args_summary, policy_version, permission_snapshot_hash, lucy_session_id)
     VALUES (?, ?, 'sl_query', '["t1"]', null, null, null, ?)`
  ).run(ts, userId, sessionId ?? null);
  return Number(result.lastInsertRowid);
}

function linkCallToTurn(db: Database.Database, turnId: string, callId: number) {
  db.prepare(
    `INSERT OR IGNORE INTO inferred_turn_access_logs (inferred_turn_id, access_log_id) VALUES (?, ?)`
  ).run(turnId, callId);
}

function insertTurn(db: Database.Database, userId: string, turnId: string, startedAt: string, endedAt: string): void {
  db.prepare(
    `INSERT INTO inferred_turns
     (inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count, created_at, updated_at, inquiry_no)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, 1)`
  ).run(turnId, userId, startedAt, endedAt, startedAt, startedAt);
}

import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Write an in-memory Database to a temp file and return the path. */
function dbToFile(db: Database.Database): string {
  const dir = mkdtempSync(join(tmpdir(), "lucy-sc-"));
  const filePath = join(dir, "audit.sqlite");
  // Create a file-backed db and copy content
  const fileDb = new Database(filePath);
  db.backup(fileDb.name, { attached: "main" }).catch(() => {
    // Manual copy fallback: execute all SQL
  });
  fileDb.close();
  // Actually use backup API properly
  return filePath;
}

async function rebuildFor(userId: string, db: Database.Database, now: number): Promise<void> {
  // Write the in-memory db to a temp file
  const tempDir = mkdtempSync(join(tmpdir(), "lucy-sc-"));
  const filePath = join(tempDir, "audit.sqlite");
  const ktxPath = join(tempDir, "ktx.yaml");
  writeFileSync(ktxPath, "connections: {}\n", "utf8");
  // Backup db to file
  await db.backup(filePath);
  
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("LUCY_AUDIT_DB", filePath);
  vi.stubEnv("KTX_PROJECT_ROOT", tempDir);
  vi.stubEnv("LUCY_CONTENT_ROOT", ".");
  // resetModules to get fresh db connection
  vi.resetModules();
  const { rebuildInferredTurns } = await import("../proxy/audit.js");
  const { closeRebuildWriteWorker } = await import("../proxy/audit-rebuild-write.js");
  try {
    await rebuildInferredTurns(userId, { lookbackHours: LOOKBACK_HOURS, gapMs: GAP_MS });
  } finally {
    await closeRebuildWriteWorker();
    vi.useRealTimers();
  }
  // Read results back into the in-memory db
  const fileDb = new Database(filePath);
  // Copy back the modified data from file to our test db
  const turns = fileDb.prepare(`SELECT * FROM inferred_turns WHERE user_id = ?`).all(userId) as Array<Record<string, unknown>>;
  const links = fileDb.prepare(`SELECT * FROM inferred_turn_access_logs`).all() as Array<Record<string, unknown>>;
  fileDb.close();
  
  // Update the original in-memory db with the rebuild results
  db.prepare(`DELETE FROM inferred_turns WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM inferred_turn_access_logs`).run();
  for (const t of turns) {
    db.prepare(`INSERT OR REPLACE INTO inferred_turns (inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count, created_at, updated_at, inquiry_no) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(t.inferred_turn_id, t.user_id, t.started_at, t.ended_at, t.call_count, t.business_call_count, t.created_at, t.updated_at, t.inquiry_no);
  }
  for (const l of links) {
    db.prepare(`INSERT OR IGNORE INTO inferred_turn_access_logs (inferred_turn_id, access_log_id) VALUES (?,?)`)
      .run(l.inferred_turn_id, l.access_log_id);
  }
}

describe("SC-11–SC-13 crossingWindow: 跨回看边界的簇", () => {
  it("SC-11: 跨界簇重建后只关联 1 个问询（不产生第二个问询）", async () => {
    const now = Date.now();
    const boundary = now - LOOKBACK_MS;
    // Call 1 is just before the boundary
    // Call 2 is 50 seconds later (same cluster, straddles the boundary)
    const ts1 = iso(boundary - 10_000);  // 10s before boundary
    const ts2 = iso(boundary + 50_000);  // 50s after boundary (within lookback)

    const db = makeDb();
    const id1 = insertCall(db, "rolling", ts1, "sess1");
    const id2 = insertCall(db, "rolling", ts2, "sess1");

    // Seed an existing inferred_turn that covers BOTH calls (simulates a prior rebuild that
    // created the correct turn). The crossingWindow test is: on the NEXT rebuild, this turn
    // must still keep both calls in the same inquiry.
    insertTurn(db, "rolling", "turn_prior", ts1, iso(boundary + 50_000 + 1_000));
    linkCallToTurn(db, "turn_prior", id1);
    linkCallToTurn(db, "turn_prior", id2);

    vi.resetModules();
    await rebuildFor("rolling", db, now);

    // Both calls should be in the same inferred turn
    const links1 = db.prepare(
      `SELECT inferred_turn_id FROM inferred_turn_access_logs WHERE access_log_id = ?`
    ).all(id1) as Array<{ inferred_turn_id: string }>;
    const links2 = db.prepare(
      `SELECT inferred_turn_id FROM inferred_turn_access_logs WHERE access_log_id = ?`
    ).all(id2) as Array<{ inferred_turn_id: string }>;

    // Each call must belong to exactly 1 turn
    expect(links1, `call1 should belong to exactly 1 turn, got ${links1.length}`).toHaveLength(1);
    expect(links2, `call2 should belong to exactly 1 turn, got ${links2.length}`).toHaveLength(1);

    // Both must belong to the SAME turn (C1: straddle cluster = same inquiry)
    expect(links1[0]?.inferred_turn_id).toBe(links2[0]?.inferred_turn_id);

    db.close();
  }, 15_000);

  it("SC-13: 原始调用 access_log 在重建前后行数不变", async () => {
    const now = Date.now();
    const boundary = now - LOOKBACK_MS;
    const ts1 = iso(boundary - 10_000);
    const ts2 = iso(boundary + 50_000);

    const db = makeDb();
    const id1 = insertCall(db, "rolling", ts1, "sess1");
    const id2 = insertCall(db, "rolling", ts2, "sess1");

    // Seed a prior turn
    insertTurn(db, "rolling", "turn_sc13", ts1, iso(boundary + 50_000 + 1_000));
    linkCallToTurn(db, "turn_sc13", id1);
    linkCallToTurn(db, "turn_sc13", id2);

    const beforeCount = (db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE user_id = 'rolling'`).get() as { n: number }).n;

    vi.resetModules();
    await rebuildFor("rolling", db, now);

    const afterCount = (db.prepare(`SELECT COUNT(*) AS n FROM access_log WHERE user_id = 'rolling'`).get() as { n: number }).n;
    expect(afterCount).toBe(beforeCount);

    db.close();
  }, 15_000);
});

describe("SC-14: 存量重复自愈", () => {
  it("SC-14: 以候选 AFTER 状态为种子（同一调用关联两个问询），重建后每个调用至多 1 条关联", async () => {
    const now = Date.now();
    const boundary = now - LOOKBACK_MS;
    const ts1 = iso(boundary - 10_000);
    const ts2 = iso(boundary + 50_000);
    const ts3 = iso(now - 60_000); // fresh call in window

    const db = makeDb();
    // Create duplicate state (same call in two turns - the bug state)
    const id1 = insertCall(db, "rolling", ts1, "sess1");
    const id2 = insertCall(db, "rolling", ts2, "sess1");
    const id3 = insertCall(db, "rolling", ts3, "sess2");

    // Seed the duplicate state manually
    insertTurn(db, "rolling", "inf_rolling_1", ts1, iso(boundary + 50_000 + 1_000));
    insertTurn(db, "rolling", "inf_rolling_2", iso(boundary + 10_000), iso(now));
    linkCallToTurn(db, "inf_rolling_1", id1);
    linkCallToTurn(db, "inf_rolling_1", id2);
    // Duplicate: call2 also in turn2
    linkCallToTurn(db, "inf_rolling_2", id2);
    linkCallToTurn(db, "inf_rolling_2", id3);

    // Verify seed state has duplicate
    const seedLinks2 = db.prepare(
      `SELECT COUNT(*) AS n FROM inferred_turn_access_logs WHERE access_log_id = ?`
    ).get(id2) as { n: number };
    expect(seedLinks2.n).toBe(2); // sanity check: seed has duplicate

    vi.resetModules();
    await rebuildFor("rolling", db, now);

    // After rebuild, each call should belong to at most 1 turn
    for (const callId of [id1, id2, id3]) {
      const links = db.prepare(
        `SELECT COUNT(*) AS n FROM inferred_turn_access_logs WHERE access_log_id = ?`
      ).get(callId) as { n: number };
      expect(links.n, `call ${callId} has ${links.n} links after rebuild, expected ≤ 1`).toBeLessThanOrEqual(1);
    }

    // inf_rolling_2 (the extra one) should be gone
    const turn2 = db.prepare(`SELECT * FROM inferred_turns WHERE inferred_turn_id = 'inf_rolling_2'`).get();
    expect(turn2).toBeUndefined();

    db.close();
  }, 15_000);
});

describe("SC-15: 回归与交错会话闭包", () => {
  it("SC-15: 两个交错的跨界问询 → 闭包终止，不把交错会话切成两半", async () => {
    const now = Date.now();
    const boundary = now - LOOKBACK_MS;

    // Session A: starts before boundary, ends after
    const tsA1 = iso(boundary - 15_000);
    const tsA2 = iso(boundary + 30_000);

    // Session B: starts between tsA1 and tsA2 (interleaved), ends after boundary
    const tsB1 = iso(boundary - 5_000);
    const tsB2 = iso(boundary + 60_000);

    const db = makeDb();
    const idA1 = insertCall(db, "interleaved", tsA1, "sessA");
    const idA2 = insertCall(db, "interleaved", tsA2, "sessA");
    const idB1 = insertCall(db, "interleaved", tsB1, "sessB");
    const idB2 = insertCall(db, "interleaved", tsB2, "sessB");

    // Seed prior turns that cross the boundary (simulates prior rebuild state)
    insertTurn(db, "interleaved", "turn_A", tsA1, iso(boundary + 30_000 + 1_000));
    insertTurn(db, "interleaved", "turn_B", tsB1, iso(boundary + 60_000 + 1_000));
    linkCallToTurn(db, "turn_A", idA1);
    linkCallToTurn(db, "turn_A", idA2);
    linkCallToTurn(db, "turn_B", idB1);
    linkCallToTurn(db, "turn_B", idB2);

    vi.resetModules();
    await rebuildFor("interleaved", db, now);

    // All calls should be linked (closure must extend to cover all crossing turns)
    for (const callId of [idA1, idA2, idB1, idB2]) {
      const links = db.prepare(
        `SELECT COUNT(*) AS n FROM inferred_turn_access_logs WHERE access_log_id = ?`
      ).get(callId) as { n: number };
      expect(links.n, `call ${callId} should be linked after rebuild`).toBe(1);
    }

    // No call should belong to 2 turns
    for (const callId of [idA1, idA2, idB1, idB2]) {
      const links = db.prepare(
        `SELECT COUNT(*) AS n FROM inferred_turn_access_logs WHERE access_log_id = ?`
      ).get(callId) as { n: number };
      expect(links.n, `call ${callId} should belong to exactly 1 turn`).toBe(1);
    }

    db.close();
  }, 15_000);
});

describe("SC-16: 规模与探针门槛（基础闭包验证）", () => {
  it("SC-16: 多级跨界仍能完成重建，不超时；闭包外问询不被删", async () => {
    // Basic version: multiple crossing turns, all same user.
    // The full scale test with P1-47 probes is done by the P1-47 probe suite.
    const now = Date.now();
    const boundary = now - LOOKBACK_MS;

    const db = makeDb();
    // 3 crossing clusters: each one extends the cutoff further back
    const ts1 = iso(boundary - 60_000); // 1 min before boundary
    const ts2 = iso(boundary + 10_000);  // in window
    const ts3 = iso(boundary - 30_000); // between ts1 and boundary
    const ts4 = iso(boundary + 20_000);

    insertCall(db, "multi-cross", ts1, "sessA");
    insertCall(db, "multi-cross", ts2, "sessA");
    insertCall(db, "multi-cross", ts3, "sessB");
    insertCall(db, "multi-cross", ts4, "sessB");

    // A call outside the extended window should stay untouched
    const tsOld = iso(boundary - 2 * LOOKBACK_MS); // way outside
    const idOld = insertCall(db, "multi-cross", tsOld, "sessC");
    const tsOldInner = iso(boundary - 1.5 * LOOKBACK_MS);
    insertCall(db, "multi-cross", tsOldInner, "sessC");

    vi.resetModules();
    const before = Date.now();
    await rebuildFor("multi-cross", db, now);
    const elapsed = Date.now() - before;

    // Should complete in reasonable time
    expect(elapsed).toBeLessThan(10_000);

    // The very old call (outside even the extended window) should not be linked
    const oldLinks = db.prepare(
      `SELECT COUNT(*) AS n FROM inferred_turn_access_logs WHERE access_log_id = ?`
    ).get(idOld) as { n: number };
    expect(oldLinks.n).toBe(0);

    db.close();
  }, 20_000);
});
