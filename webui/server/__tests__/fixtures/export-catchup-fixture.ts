import Database from "better-sqlite3";
export function makePackDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_seq INTEGER,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      outcome TEXT,
      decision_reason TEXT,
      duration_ms INTEGER,
      response_row_count INTEGER,
      event_type TEXT,
      transport_sub_type TEXT,
      transport_status TEXT,
      authorization_status TEXT,
      execution_status TEXT,
      usability_status TEXT,
      association_status TEXT,
      original_turn_id TEXT,
      effective_turn_id TEXT,
      attempt_id TEXT,
      parent_attempt_id TEXT,
      instance_id TEXT,
      classification_version TEXT,
      lucy_turn_id TEXT,
      permission_snapshot_hash TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT,
      physical_table TEXT,
      extraction_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      ledger_seq INTEGER
    );
    CREATE TABLE permission_snapshots (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      roles_json TEXT,
      resolved_json TEXT,
      capability_digest TEXT,
      tool_classification_version TEXT
    );
    CREATE TABLE association_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_turn_id TEXT NOT NULL,
      effective_turn_id TEXT,
      original_association_status TEXT,
      effective_association_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      reference_doc TEXT,
      attribution_rule_version TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      instance_id TEXT,
      instance_start_generation INTEGER,
      ts TEXT NOT NULL,
      classification_version TEXT NOT NULL,
      expected_revision TEXT,
      ledger_seq INTEGER,
      UNIQUE(original_turn_id, attribution_rule_version)
    );
    -- F-02：精确 as-of S 的证据（归属改写日志 + 基线）。
    CREATE TABLE access_log_attribution_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER NOT NULL,
      ledger_seq INTEGER,
      kind TEXT NOT NULL
    );
    CREATE TABLE access_log_asof_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO access_log_asof_meta (key, value) VALUES ('attribution_journal_baseline_seq', '1');
    CREATE TABLE audit_maintenance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_seq INTEGER,
      ts TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT,
      algorithm_version TEXT NOT NULL,
      scanned INTEGER NOT NULL,
      matched INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      before_digest TEXT NOT NULL,
      after_digest TEXT NOT NULL
    );
  `);
  // Seed rows: 1 tool_call, 1 protocol handshake, 1 denied.
  db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, classification_version, ledger_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "2026-10-19T12:00:00Z", "u1", "lucy_query", "ok", "allowed", 100, 5,
    "tool_call", "other", "succeeded", "allowed", "succeeded", "usable",
    "confirmed", "turn-1", "turn-1", "audit-trust-2026-10-19-r1.v1", 1
  );
  db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, classification_version, ledger_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "2026-10-19T12:01:00Z", "u2", "tools/list", "ok", "allowed", 5, 0,
    "protocol", "handshake", "succeeded", "allowed", "succeeded", "not_applicable",
    "confirmed", "turn-2", "turn-2", "audit-trust-2026-10-19-r1.v1", 2
  );
  db.prepare("UPDATE access_log SET permission_snapshot_hash = 'hash-1'").run();
  db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, connection_id, schema_name, source_name, physical_table, extraction_method, confidence, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(1, "2026-10-19T12:00:00Z", "u1", "main", "public", "users", "users", "literal", "high", 1);
  db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, connection_id, schema_name, source_name, physical_table, extraction_method, confidence, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(2, "2026-10-19T12:01:00Z", "u2", "main", "public", "users", "users", "literal", "high", 1);
  db.prepare(`INSERT INTO permission_snapshots (id, hash, created_at, roles_json, resolved_json, capability_digest, tool_classification_version) VALUES (1, 'hash-1', '2026-10-19T12:00:00Z', '[]', '{}', 'digest-1', 'ac-p0-cls-1')`).run();
  return db;
}
