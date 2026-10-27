import type Database from "better-sqlite3";

/** Bump together with a new entry in {@link MIGRATIONS}. */
export const SECURITY_SCHEMA_VERSION = 4;

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

/**
 * SCHEMA_V4 — Spec 193 §8.2 / §7.5 (business Wiki access management).
 *
 * `wiki_access_operations` is the per-key projection of the durable security
 * operation. It answers one question with a fail-closed result: "is this Wiki
 * key currently held by an unresolved widening?" A row in state `pending` or
 * `needs_review` with `direction = 'widen'` is a hold.
 *
 * The row is written in the SAME transaction as the `pending_operations` row
 * (prepare + activate the hold) and released in the SAME transaction as the
 * commit, so there is no crash window between a durable commit and a hold
 * release.
 *
 * Only the key, the content hashes, the direction and the state are stored.
 * No Markdown body, no credential and no absolute host path is ever written
 * here.
 *
 * `wiki_access_batches` / `wiki_access_batch_items` are the recoverable bulk
 * authorization journal and the idempotency binding. They live in the same
 * FULL-persisted, 0600 database on purpose: a JSON sidecar would be a second
 * fact source for authorization state.
 */
const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS wiki_access_operations (
  operation_id TEXT PRIMARY KEY REFERENCES pending_operations(operation_id),
  wiki_key     TEXT NOT NULL,
  old_hash     TEXT,
  target_hash  TEXT,
  direction    TEXT NOT NULL CHECK (direction IN ('narrow','widen','neutral')),
  state        TEXT NOT NULL CHECK (state IN ('pending','committed','aborted','needs_review')),
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wiki_access_operations_key ON wiki_access_operations(wiki_key);
CREATE INDEX IF NOT EXISTS idx_wiki_access_operations_state ON wiki_access_operations(state);

CREATE TABLE IF NOT EXISTS wiki_access_batches (
  operation_id        TEXT PRIMARY KEY,
  plan_digest         TEXT NOT NULL,
  idempotency_key     TEXT,
  action_json         TEXT NOT NULL,
  role_channel_version TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_access_batches_idempotency
  ON wiki_access_batches(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS wiki_access_batch_items (
  operation_id  TEXT NOT NULL REFERENCES wiki_access_batches(operation_id),
  wiki_key      TEXT NOT NULL,
  expected_version TEXT,
  target_hash   TEXT,
  acl_summary   TEXT,
  direction     TEXT,
  status        TEXT NOT NULL CHECK (status IN
    ('pending','applied','noop','conflict','failed','not_run','needs_review')),
  error_code    TEXT,
  error_message TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (operation_id, wiki_key)
);
CREATE INDEX IF NOT EXISTS idx_wiki_access_batch_items_status
  ON wiki_access_batch_items(operation_id, status);
`;

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: SCHEMA_V2 },
  { version: 3, sql: SCHEMA_V3 },
  { version: 4, sql: SCHEMA_V4 }
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
