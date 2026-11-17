/** Shared deterministic fixtures for the P1-32/P1-33 equivalence tests. Test-only. */
import Database from "better-sqlite3";

/** Small deterministic PRNG so every run builds the same data. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export function createAsOfDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_seq INTEGER, ts TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'u', tool TEXT NOT NULL DEFAULT 'lucy_query',
      lucy_turn_id TEXT, effective_turn_id TEXT, association_status TEXT
    );
    CREATE TABLE access_log_sources (id INTEGER PRIMARY KEY AUTOINCREMENT, access_log_id INTEGER, ledger_seq INTEGER);
    CREATE INDEX idx_sources_log ON access_log_sources(access_log_id);
    CREATE TABLE association_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, original_turn_id TEXT, ledger_seq INTEGER);
    CREATE TABLE access_log_attribution_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, access_log_id INTEGER NOT NULL, ledger_seq INTEGER, kind TEXT NOT NULL DEFAULT 'k',
      before_turn_id TEXT, before_association_status TEXT
    );
    CREATE INDEX idx_mut_log ON access_log_attribution_mutations(access_log_id);
    CREATE TABLE access_log_asof_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO access_log_asof_meta VALUES ('attribution_journal_baseline_seq', '1');
  `);
  return db;
}

export type AsOfScenario = { rows: Array<{ id: number; ledgerSeq: number | null; turnId: string | null }>; bound: number };

/**
 * `n` calls; ledger positions straddle `bound`; some rows have late/undated sources,
 * mutations on both sides of the bound (with before-images), and revisions per turn.
 */
export function seedAsOfScenario(db: Database.Database, n: number, seed = 7): AsOfScenario {
  const rand = rng(seed);
  const bound = Math.floor(n * 0.8);
  const insRow = db.prepare("INSERT INTO access_log (ledger_seq, ts, lucy_turn_id, effective_turn_id, association_status) VALUES (?, ?, ?, ?, ?)");
  const insSrc = db.prepare("INSERT INTO access_log_sources (access_log_id, ledger_seq) VALUES (?, ?)");
  const insMut = db.prepare("INSERT INTO access_log_attribution_mutations (access_log_id, ledger_seq, before_turn_id, before_association_status) VALUES (?, ?, ?, ?)");
  const insRev = db.prepare("INSERT INTO association_revisions (original_turn_id, ledger_seq) VALUES (?, ?)");
  const rows: AsOfScenario["rows"] = [];
  db.transaction(() => {
    for (let i = 1; i <= n; i += 1) {
      const turn = `turn-${i % Math.max(1, Math.floor(n / 4))}`;
      const seq = rand() < 0.01 ? null : i;
      const info = insRow.run(seq, "2026-11-15T00:00:00Z", turn, turn, "confirmed");
      const id = Number(info.lastInsertRowid);
      rows.push({ id, ledgerSeq: seq, turnId: turn });
      const r = rand();
      insSrc.run(id, r < 0.02 ? null : r < 0.1 ? bound + 1 + Math.floor(rand() * 50) : Math.min(i, bound));
      if (rand() < 0.1) insSrc.run(id, Math.min(i, bound));
      const m = rand();
      if (m < 0.05) {
        insMut.run(id, bound + Math.floor(rand() * 40), `prev-${i}`, "candidate");
        // A row rewritten twice: the OLDEST before-image must win on replay.
        if (rand() < 0.5) insMut.run(id, bound + 40 + Math.floor(rand() * 40), `newer-${i}`, "confirmed");
      }
      else if (m < 0.08) insMut.run(id, Math.floor(rand() * bound), `prev-${i}`, "candidate");
      else if (m < 0.09) insMut.run(id, null, null, null);
    }
    for (let t = 0; t < Math.floor(n / 4); t += 1) {
      if (rand() < 0.1) insRev.run(`turn-${t}`, rand() < 0.5 ? bound + 5 : 3);
    }
  })();
  return { rows, bound };
}

/**
 * Fixed legacy-shaped `access_log` rows (no span / ip / fingerprint data) for the export column guard.
 * Only columns that exist in every audit schema generation are written, so the same fixture runs on the
 * pre-P1-36 code (which produced the golden) and on current code. Includes CSV-hostile text.
 */
export function seedLegacyCallRows(db: Database.Database): number[] {
  const ins = db.prepare(`INSERT INTO access_log
    (ts, user_id, tool, outcome, lucy_session_id, lucy_turn_id, args_summary, tables, error_detail, duration_ms, request_id, decision_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const hostile = ["plain", "has,comma", 'has "quote"', "multi\nline", "=SUM(A1)", "中文，逗号"];
  const ids: number[] = [];
  db.transaction(() => {
    for (let i = 0; i < 6; i += 1) {
      const info = ins.run(
        new Date(Date.UTC(2026, 10, 10, 8, i, 0)).toISOString(), `user-${i % 2}`, i % 3 === 0 ? "lucy_catalog" : "lucy_query",
        i % 4 === 3 ? "error" : "ok", `sess-${i % 2}`, i % 2 ? `turn-${i}` : null,
        JSON.stringify({ q: hostile[i] }), JSON.stringify([`db.schema.t${i % 3}`]), i % 4 === 3 ? hostile[i] : null,
        10 + i, `req-${i}`, "allowed"
      );
      ids.push(Number(info.lastInsertRowid));
    }
    db.prepare("UPDATE access_log SET ledger_seq = id").run();
  })();
  return ids;
}
