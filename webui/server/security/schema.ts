import type Database from "better-sqlite3";

/** Bump together with a new entry in {@link MIGRATIONS}. */
export const SECURITY_SCHEMA_VERSION = 3;

export const SECURITY_DB_FILE = "security.sqlite";

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_account_state (
  account_uid            TEXT PRIMARY KEY,
  display_id             TEXT NOT NULL,
  session_epoch          INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL CHECK (status IN ('enabled','disabled','tombstoned')),
  credential_fingerprint TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  tombstoned_at          INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  jti_hash        TEXT PRIMARY KEY,
  account_uid     TEXT NOT NULL REFERENCES admin_account_state(account_uid),
  issued_epoch    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  absolute_expiry INTEGER NOT NULL,
  revoked_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_account ON admin_sessions(account_uid);

CREATE TABLE IF NOT EXISTS bootstrap_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  state           TEXT NOT NULL CHECK (state IN ('open','consumed')),
  consumed_at     INTEGER,
  consumed_by_uid TEXT
);
INSERT OR IGNORE INTO bootstrap_state (id, state) VALUES (1, 'open');

CREATE TABLE IF NOT EXISTS auth_rate_buckets (
  bucket_key   TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_buckets_expires ON auth_rate_buckets(expires_at);

CREATE TABLE IF NOT EXISTS role_id_tombstones (
  role_id       TEXT PRIMARY KEY,
  tombstoned_at INTEGER NOT NULL,
  reason        TEXT
);

CREATE TABLE IF NOT EXISTS security_events (
  seq                 INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id            TEXT NOT NULL UNIQUE,
  operation_id        TEXT NOT NULL,
  phase               TEXT NOT NULL,
  actor               TEXT NOT NULL,
  actor_type          TEXT NOT NULL,
  network_info        TEXT NOT NULL DEFAULT '',
  session_fingerprint TEXT NOT NULL DEFAULT '',
  trace_id            TEXT NOT NULL DEFAULT '',
  policy_version      TEXT NOT NULL DEFAULT '',
  context_version     TEXT NOT NULL DEFAULT '',
  object_hash         TEXT NOT NULL DEFAULT '',
  verdict             TEXT NOT NULL DEFAULT '',
  result_summary      TEXT NOT NULL DEFAULT '',
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_events_operation ON security_events(operation_id);

CREATE TRIGGER IF NOT EXISTS security_events_no_update
BEFORE UPDATE ON security_events
BEGIN SELECT RAISE(ABORT, 'security_events is append-only'); END;

CREATE TRIGGER IF NOT EXISTS security_events_no_delete
BEFORE DELETE ON security_events
BEGIN SELECT RAISE(ABORT, 'security_events is append-only'); END;

CREATE TABLE IF NOT EXISTS projection_cursors (
  projector  TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_operations (
  operation_id TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('narrow','widen','neutral')),
  state        TEXT NOT NULL CHECK (state IN ('pending','committed','aborted','needs_review')),
  object_hash  TEXT,
  summary      TEXT,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_operations_state ON pending_operations(state);
`;

/**
 * SCHEMA_V2 — Spec 173 v0.3 / 2026-10-19 audit-trust / `audit-trust-2026-10-19-r1` §2.3 / §3.2.
 *
 * Adds the `audit_event_kind` column to `security_events` and a supporting index.
 * The column is additive (NULL default) so v1 readers ignore it. T03 begins writing
 * `audit_management` and `association_revision` event kinds through this column;
 * pre-existing rows remain NULL.
 *
 * Why a column, not a separate table: the canonical ledger already records
 * `security_events` immutably; introducing a parallel `audit_management_log`
 * would create a competing fact source forbidden by the 20261018 enterprise
 * security Spec §5. The single ledger is the truth source.
 */
const SCHEMA_V2 = `
ALTER TABLE security_events ADD COLUMN audit_event_kind TEXT;
CREATE INDEX IF NOT EXISTS idx_security_events_audit_kind ON security_events(audit_event_kind);
`;

/**
 * SCHEMA_V3 — Lucy v0.25 / L25-09 S02 §5.3（入口登记）.
 *
 * Adds the `endpoint_id` column to `security_events` and a supporting index.
 *
 * The column is additive (NULL default) so v1/v2 readers ignore it. Pre-v3 rows
 * stay NULL — historical events are **not** reinterpreted.
 *
 * The `received` phase itself is a *value* of the existing `phase` column (TEXT),
 * so no DDL is required for it; `SecurityEventPhase` in `types.ts` gains the
 * `received` member and the store accepts it like any other phase.
 */
const SCHEMA_V3 = `
ALTER TABLE security_events ADD COLUMN endpoint_id TEXT;
CREATE INDEX IF NOT EXISTS idx_security_events_endpoint ON security_events(endpoint_id);
`;

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
  { version: 3, sql: SCHEMA_V3 }
];

export type SchemaInitResult =
  | { ok: true; version: number }
  | { ok: false; reason: "schema_unsupported" | "schema_corrupt"; message: string };

export function readSchemaVersion(db: Database.Database): number {
  return db.pragma("user_version", { simple: true }) as number;
}

/**
 * Idempotent: applies only the migrations above the stored `user_version`.
 * A database from a newer build is refused rather than downgraded.
 */
export function initSecuritySchema(db: Database.Database): SchemaInitResult {
  const current = readSchemaVersion(db);
  if (current > SECURITY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "schema_unsupported",
      message: `security store schema v${current} is newer than supported v${SECURITY_SCHEMA_VERSION}`
    };
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(
        String(migration.version)
      );
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  const finalVersion = readSchemaVersion(db);
  if (finalVersion !== SECURITY_SCHEMA_VERSION) {
    return { ok: false, reason: "schema_corrupt", message: `security store schema version ${finalVersion} is inconsistent` };
  }
  return { ok: true, version: finalVersion };
}
