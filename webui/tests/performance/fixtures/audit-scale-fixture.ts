import type Database from "better-sqlite3";

/** Fixed customer-scale shape from the 2026-11-13 incident. */
export const AUDIT_SCALE = {
  seed: 20261113,
  days: 30,
  rows: 115_000,
  users: 67,
  tables: 183,
  reportedEvery: 500
} as const;

function zipfCounts(users: number, total: number): number[] {
  const weights = Array.from({ length: users }, (_, index) => 1 / (index + 1));
  const sum = weights.reduce((left, right) => left + right, 0);
  const counts = weights.map((weight) => Math.floor((total * weight) / sum));
  counts[0] += total - counts.reduce((left, right) => left + right, 0);
  return counts;
}

/**
 * Writes a deterministic access-log fixture into an already-migrated audit database.
 * Bursts of four calls sit inside the 2-minute inferred-turn gap.
 * Each user's bursts are spread across the 30-day window and end at "now".
 */
export function seedAuditScale(database: Database.Database, startedAt = Date.now() - AUDIT_SCALE.days * 24 * 60 * 60 * 1000): void {
  const counts = zipfCounts(AUDIT_SCALE.users, AUDIT_SCALE.rows);
  const insertLog = database.prepare(`
    INSERT INTO access_log (ts, user_id, tool, outcome, duration_ms, request_id, lucy_session_id, lucy_turn_id, tables)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSource = database.prepare(`
    INSERT INTO access_log_sources (
      access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
      physical_table, extraction_method, confidence, created_at
    ) VALUES (?, ?, ?, ?, 'scale', 'public', ?, ?, 'args', 'high', ?)
  `);
  const insertTurn = database.prepare(`
    INSERT INTO conversation_turns (turn_id, session_id, user_id, question_source, question_summary, created_at)
    VALUES (?, ?, ?, 'reported', ?, ?)
  `);
  const write = database.transaction(() => {
    let sequence = 0;
    counts.forEach((count, userIndex) => {
      const userId = `scale-user-${String(userIndex).padStart(2, "0")}`;
      const burstGap = Math.max(120_000, Math.floor((AUDIT_SCALE.days * 24 * 60 * 60 * 1000) / Math.max(1, Math.ceil(count / 4))));
      for (let call = 0; call < count; call += 1) {
        const burst = Math.floor(call / 4);
        const ts = new Date(startedAt + burst * burstGap + (call % 4) * 15_000).toISOString();
        const tool = call % 20 === 0 ? "kx_catalog" : call % 5 === 0 ? "lucy_explain" : "lucy_query";
        const outcome = call % 50 === 0 ? "error" : call % 25 === 0 ? "denied" : "ok";
        const reported = sequence % AUDIT_SCALE.reportedEvery === 0;
        const turnId = reported ? `reported-${sequence}` : null;
        const table = `fact_${sequence % AUDIT_SCALE.tables}`;
        const log = insertLog.run(
          ts,
          userId,
          tool,
          outcome,
          5 + (sequence % 40),
          `scale-${sequence}`,
          `sess-${userId}-${burst}`,
          turnId,
          JSON.stringify([table])
        );
        if (sequence % 5 === 0) {
          insertSource.run(log.lastInsertRowid, ts, userId, tool, table, table, ts);
        }
        if (turnId) insertTurn.run(turnId, `sess-${userId}-${burst}`, userId, `问询 ${sequence}`, ts);
        sequence += 1;
      }
    });
  });
  write();
}
