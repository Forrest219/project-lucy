import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

/**
 * P1-45 重建中断后自动恢复（Spec lucy-20261118-inferred-turn-rebuild-recovery-spec.md）。
 * SC-01: covered() 在 in_progress 时为 false。
 * SC-02: 中断（in_progress 残留）→ 重启后该用户进入 dirty 并被调度重建。
 * SC-03: 完整成功后，无新增 access_log 时，不因 15 分钟余量触发全量重建（SC-04）。
 * SC-05: 有新增调用时，该用户进入增量重建。
 */

const NOW = Date.parse("2026-11-18T10:00:00.000Z");
const LOOKBACK_MS = 24 * 30 * 3_600_000;
const CUTOFF = new Date(NOW - LOOKBACK_MS).toISOString();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT,
      pad TEXT
    );
    CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX idx_al_ts ON access_log(ts);
    CREATE TABLE inferred_turns (
      inferred_turn_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
    CREATE TABLE inferred_rebuild_state (
      user_id    TEXT PRIMARY KEY,
      status     TEXT NOT NULL,
      watermark  TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function insertLogs(db: Database.Database, rows: Array<[string, string]>): void {
  const stmt = db.prepare(`INSERT INTO access_log (ts, user_id, tool, pad) VALUES (?, ?, 'lucy_query', 'x')`);
  db.transaction(() => { for (const [ts, user] of rows) stmt.run(ts, user); })();
}

function setRebuildState(db: Database.Database, userId: string, status: "in_progress" | "complete", watermark: string): void {
  db.prepare(`
    INSERT INTO inferred_rebuild_state (user_id, status, watermark, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, watermark = excluded.watermark, updated_at = excluded.updated_at
  `).run(userId, status, watermark, new Date(NOW).toISOString());
}

async function loadMaintainer() {
  return await import("../admin/inferred-turn-maintainer.js");
}

describe("SC-01 covered() returns false while in_progress", () => {
  it("user with in_progress rebuild state is not covered even when inferred_turns exist", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    const newestTs = iso(-2 * MIN);
    insertLogs(db, [[newestTs, "alice"]]);

    // Simulate a partial rebuild: in_progress with watermark matching the log
    setRebuildState(db, "alice", "in_progress", newestTs);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });
    await maintainer.catchUp();

    // alice must be rebuilt because status is in_progress
    expect(rebuilt).toContain("alice");
    db.close();
  });
});

describe("SC-02 interruption (in_progress residual) → restart schedules rebuild", () => {
  it("user with in_progress state from a prior crashed rebuild is re-scheduled on restart", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    const logTs = iso(-30 * MIN);
    insertLogs(db, [[logTs, "bob"]]);

    // Simulate a crash: in_progress was written, complete was never written
    setRebuildState(db, "bob", "in_progress", logTs);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    expect(rebuilt).toContain("bob");
    db.close();
  });

  it("user with in_progress and partial inferred_turns is treated as not covered", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    const logTs = iso(-30 * MIN);
    insertLogs(db, [[logTs, "charlie"]]);

    // Partial rebuild wrote one inferred_turn but never completed
    db.prepare(`
      INSERT INTO inferred_turns (inferred_turn_id, user_id, started_at, ended_at, updated_at)
      VALUES ('t-charlie', 'charlie', ?, ?, ?)
    `).run(logTs, logTs, iso(-10 * MIN));
    setRebuildState(db, "charlie", "in_progress", logTs);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    // Must rebuild even though inferred_turns has a recent updated_at
    expect(rebuilt).toContain("charlie");
    db.close();
  });
});

describe("SC-04 complete + no new access_log → not dirty from margin alone", () => {
  it("user with complete rebuild and no new logs is not re-scheduled on restart", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();

    // The newest log is at logTs; rebuild completed with watermark = logTs
    const logTs = iso(-30 * MIN);
    insertLogs(db, [[logTs, "dave"]]);
    setRebuildState(db, "dave", "complete", logTs);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    // dave must NOT be rebuilt: watermark == newestTs → covered
    expect(rebuilt).not.toContain("dave");
    db.close();
  });

  it("15-minute-margin alone must not trigger rebuild when status is complete", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();

    // Log is 1 minute old; under the old 15-min margin logic this would have been dirty
    const logTs = iso(-MIN);
    insertLogs(db, [[logTs, "eve"]]);
    // complete with watermark == logTs (the most recent log at rebuild time)
    setRebuildState(db, "eve", "complete", logTs);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    // eve must NOT be rebuilt under new watermark logic
    expect(rebuilt).not.toContain("eve");
    db.close();
  });

  it("user with complete and older watermark but new logs is re-scheduled", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();

    // Rebuild happened 2 hours ago with watermark = -2h; new log arrived at -1h
    const rebuildWatermark = iso(-2 * 60 * MIN);
    const newLogTs = iso(-60 * MIN);
    insertLogs(db, [[rebuildWatermark, "frank"], [newLogTs, "frank"]]);
    setRebuildState(db, "frank", "complete", rebuildWatermark);

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    // frank must be rebuilt because newLogTs > watermark
    expect(rebuilt).toContain("frank");
    db.close();
  });
});

describe("SC-02/SC-03 missing rebuild state → treated as not covered (safe fallback)", () => {
  it("user with no entry in inferred_rebuild_state is marked dirty on startup", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, [[iso(-DAY), "grace"]]);
    // No inferred_rebuild_state row for grace

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    expect(rebuilt).toContain("grace");
    db.close();
  });

  it("when inferred_rebuild_state table is absent, everyone is treated as uncovered", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    // Database without inferred_rebuild_state table (old-schema simulation)
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL);
      CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    `);
    db.prepare(`INSERT INTO access_log (ts, user_id) VALUES (?, ?)`).run(iso(-DAY), "henry");

    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW
    });

    await maintainer.catchUp();
    expect(rebuilt).toContain("henry");
    db.close();
  });
});
