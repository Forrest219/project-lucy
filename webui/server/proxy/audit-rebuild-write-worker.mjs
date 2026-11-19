/**
 * P1-47 W1: run inferred-turn write_slice + wal_checkpoint(PASSIVE) off the
 * Fastify request event loop. Opens a dedicated better-sqlite3 connection.
 */
import { parentPort } from "node:worker_threads";
import Database from "better-sqlite3";

/** @type {import("better-sqlite3").Database | null} */
let db = null;
/** @type {string | null} */
let openPath = null;
/** @type {import("better-sqlite3").Statement | null} */
let insertTurn = null;
/** @type {import("better-sqlite3").Statement | null} */
let insertLink = null;
/** @type {import("better-sqlite3").Statement | null} */
let deleteLinks = null;
/** @type {import("better-sqlite3").Statement | null} */
let deleteTurn = null;

function openDb(dbPath) {
  if (db && openPath === dbPath) return;
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("wal_autocheckpoint = 25");
  insertTurn = db.prepare(`
    INSERT INTO inferred_turns
      (inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count, tool_summary, source_summary, question_summary, confidence, evidence_json, client, session_id, created_at, updated_at, inquiry_no)
    VALUES
      (@id, @userId, @startedAt, @endedAt, @callCount, @businessCallCount, @toolSummary, @sourceSummary, @questionSummary, @confidence, @evidenceJson, @client, @sessionId, @createdAt, @updatedAt, @inquiryNo)
  `);
  insertLink = db.prepare(
    `INSERT INTO inferred_turn_access_logs (inferred_turn_id, access_log_id) VALUES (?, ?)`
  );
  deleteLinks = db.prepare(`DELETE FROM inferred_turn_access_logs WHERE inferred_turn_id = ?`);
  deleteTurn = db.prepare(`DELETE FROM inferred_turns WHERE inferred_turn_id = ?`);
  openPath = dbPath;
}

function closeDb() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* ignore */
  }
  db = null;
  openPath = null;
  insertTurn = null;
  insertLink = null;
  deleteLinks = null;
  deleteTurn = null;
}

parentPort.on("message", (msg) => {
  const id = msg?.id;
  try {
    if (msg?.type === "delete_window") {
      openDb(msg.dbPath);
      const turnIds = Array.isArray(msg.turnIds) ? msg.turnIds : [];
      const started = performance.now();
      db.transaction(() => {
        for (const turnId of turnIds) {
          deleteLinks.run(turnId);
          deleteTurn.run(turnId);
        }
      })();
      parentPort.postMessage({
        id,
        ok: true,
        written: turnIds.length,
        writeMs: performance.now() - started,
        checkpointMs: 0,
        busy: 0,
        log: -1,
        checkpointed: -1
      });
      return;
    }
    if (msg?.type === "write_slice") {
      openDb(msg.dbPath);
      const turns = Array.isArray(msg.turns) ? msg.turns : [];
      const writeStarted = performance.now();
      let written = 0;
      db.transaction(() => {
        for (const turn of turns) {
          insertTurn.run({
            id: turn.id,
            inquiryNo: turn.inquiryNo,
            userId: turn.userId,
            startedAt: turn.startedAt,
            endedAt: turn.endedAt,
            callCount: turn.callCount,
            businessCallCount: turn.businessCallCount,
            toolSummary: turn.toolSummary,
            sourceSummary: turn.sourceSummary,
            questionSummary: turn.questionSummary,
            confidence: turn.confidence,
            evidenceJson: turn.evidenceJson,
            client: turn.client,
            sessionId: turn.sessionId,
            createdAt: turn.createdAt,
            updatedAt: turn.updatedAt
          });
          for (const accessLogId of turn.accessLogIds ?? []) {
            insertLink.run(turn.id, accessLogId);
          }
          written += 1;
        }
      })();
      const writeMs = performance.now() - writeStarted;
      const ckptStarted = performance.now();
      const ckpt = db.pragma("wal_checkpoint(PASSIVE)");
      const checkpointMs = performance.now() - ckptStarted;
      const row = Array.isArray(ckpt) ? ckpt[0] : ckpt;
      parentPort.postMessage({
        id,
        ok: true,
        written,
        writeMs,
        checkpointMs,
        busy: row?.busy ?? 0,
        log: row?.log ?? -1,
        checkpointed: row?.checkpointed ?? -1
      });
      return;
    }
    if (msg?.type === "close") {
      closeDb();
      parentPort.postMessage({ id, ok: true });
      return;
    }
    parentPort.postMessage({ id, ok: false, error: `unknown message type: ${msg?.type}` });
  } catch (error) {
    parentPort.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    });
  }
});
