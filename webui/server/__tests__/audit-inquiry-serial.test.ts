import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocateInquiryNo,
  backfillInquirySerials,
  ensureInquirySerialSchema,
  lookupInquiryNo,
  resolveTurnCorrelationKey
} from "../admin/audit-inquiry-serial";

let dir: string;
let dbPath: string;

function openDb(): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_turns (
      turn_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      question_source TEXT NOT NULL,
      question_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inferred_turns (
      inferred_turn_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      call_count INTEGER NOT NULL,
      business_call_count INTEGER NOT NULL,
      tool_summary TEXT NOT NULL,
      source_summary TEXT NOT NULL,
      question_summary TEXT,
      confidence TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  ensureInquirySerialSchema(db);
  return db;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "lucy-inquiry-serial-"));
  dbPath = path.join(dir, "audit.sqlite");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("allocateInquiryNo", () => {
  it("returns the same number for a correlation key and does not reuse it after rollback", () => {
    const db = openDb();
    try {
      expect(allocateInquiryNo(db, "lucy_a")).toBe(1);
      expect(allocateInquiryNo(db, "lucy_a")).toBe(1);
      expect(allocateInquiryNo(db, "lucy_b")).toBe(2);

      expect(() => {
        db.transaction(() => {
          allocateInquiryNo(db, "lucy_rollback");
          throw new Error("insert failed");
        })();
      }).toThrow(/insert failed/);

      expect(lookupInquiryNo(db, "lucy_rollback")).toBeNull();
      expect(allocateInquiryNo(db, "lucy_c")).toBe(3);
    } finally {
      db.close();
    }
  });

  it("keeps the high water after the turn rows are deleted and the file is reopened", () => {
    const db = openDb();
    allocateInquiryNo(db, "lucy_a");
    allocateInquiryNo(db, "lucy_b");
    db.prepare(`
      INSERT INTO conversation_turns (turn_id, user_id, question_source, created_at, inquiry_no)
      VALUES ('lucy_b', 'agent-b', 'reported_tool', '2026-11-02T10:00:00.000Z', 2)
    `).run();
    db.prepare(`DELETE FROM conversation_turns`).run();
    db.prepare(`DELETE FROM inferred_turns`).run();
    db.close();

    const reopened = new Database(dbPath);
    try {
      ensureInquirySerialSchema(reopened);
      expect(lookupInquiryNo(reopened, "lucy_b")).toBe(2);
      expect(allocateInquiryNo(reopened, "lucy_c")).toBe(3);
    } finally {
      reopened.close();
    }
  });
});

describe("backfillInquirySerials", () => {
  it("numbers merged rows by time then full correlation key, not by source", () => {
    const db = openDb();
    try {
      db.prepare(`
        INSERT INTO conversation_turns (turn_id, user_id, question_source, created_at)
        VALUES ('lucy_b', 'agent-b', 'reported_tool', '2026-11-02T10:00:00.000Z'),
               ('lucy_a', 'agent-a', 'reported', '2026-11-02T09:00:00.000Z')
      `).run();
      db.prepare(`
        INSERT INTO inferred_turns (
          inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count,
          tool_summary, source_summary, question_summary, confidence, evidence_json, created_at, updated_at
        ) VALUES (
          'inf_a', 'agent-a', '2026-11-02T09:00:00.000Z', '2026-11-02T09:00:00.000Z',
          1, 0, '[]', '[]', '未上报问询原文', 'low', '{}',
          '2026-11-02T09:00:00.000Z', '2026-11-02T09:00:00.000Z'
        )
      `).run();

      backfillInquirySerials(db);

      expect(lookupInquiryNo(db, "inf_a")).toBe(1);
      expect(lookupInquiryNo(db, "lucy_a")).toBe(2);
      expect(lookupInquiryNo(db, "lucy_b")).toBe(3);
      const stored = db.prepare(`
        SELECT turn_id AS correlation_key, inquiry_no FROM conversation_turns
        UNION ALL
        SELECT inferred_turn_id AS correlation_key, inquiry_no FROM inferred_turns
        ORDER BY inquiry_no ASC
      `).all() as Array<{ correlation_key: string; inquiry_no: number }>;
      expect(stored.map((row) => row.correlation_key)).toEqual(["inf_a", "lucy_a", "lucy_b"]);

      backfillInquirySerials(db);
      expect(lookupInquiryNo(db, "inf_a")).toBe(1);
      expect(allocateInquiryNo(db, "lucy_c")).toBe(4);
      expect(resolveTurnCorrelationKey(db, "1")).toBe("inf_a");
      expect(resolveTurnCorrelationKey(db, "lucy_b")).toBe("lucy_b");
      expect(resolveTurnCorrelationKey(db, "missing")).toBeNull();
    } finally {
      db.close();
    }
  });

  it("fails closed when numbers exist without a completion marker and does not renumber", () => {
    const db = openDb();
    try {
      db.prepare(`
        INSERT INTO conversation_turns (turn_id, user_id, question_source, created_at, inquiry_no)
        VALUES ('lucy_partial', 'agent', 'reported_tool', '2026-11-02T09:00:00.000Z', 4)
      `).run();
      db.prepare(`
        INSERT INTO inferred_turns (
          inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count,
          tool_summary, source_summary, confidence, evidence_json, created_at, updated_at
        ) VALUES (
          'inf_other', 'agent', '2026-11-02T08:00:00.000Z', '2026-11-02T08:00:00.000Z',
          1, 0, '[]', '[]', 'low', '{}', '2026-11-02T08:00:00.000Z', '2026-11-02T08:00:00.000Z'
        )
      `).run();

      expect(() => backfillInquirySerials(db)).toThrow(/fail closed|backfill_complete/i);
      const partial = db.prepare(`SELECT inquiry_no FROM conversation_turns WHERE turn_id = 'lucy_partial'`).get() as { inquiry_no: number };
      expect(partial.inquiry_no).toBe(4);
      const other = db.prepare(`SELECT inquiry_no FROM inferred_turns WHERE inferred_turn_id = 'inf_other'`).get() as { inquiry_no: number | null };
      expect(other.inquiry_no ?? null).toBeNull();
      const marker = db.prepare(`SELECT value FROM inquiry_serial_meta WHERE key = 'backfill_complete'`).get();
      expect(marker).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
