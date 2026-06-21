import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";

export interface AccessLogEntry {
  ts: string;
  userId: string;
  tokenLabel?: string;
  tokenHashPrefix?: string;
  lucySessionId?: string;
  lucyTurnId?: string;
  lucyPlatform?: string;
  client?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  queryHash?: string;
  queryLength?: number;
  queryOperation?: string;
  queryPreview?: string;
  outcome: "ok" | "error" | "denied";
  errorDetail?: string;
  durationMs: number;
  requestId: string | number;
  responseBytes?: number;
  responseRowCount?: number;
  responseColumnCount?: number;
  responseTruncated?: boolean;
  roleIds?: string[];
  permissionSnapshotHash?: string;
  effectiveTablesCount?: number;
  decisionReason?: string;
  permissionSnapshot?: {
    hash: string;
    rolesJson: unknown;
    resolvedJson: unknown;
  };
}

let db: Database.Database | null = null;
const ACCESS_LOG_COLUMNS = [
  ["role_ids", "TEXT"],
  ["permission_snapshot_hash", "TEXT"],
  ["effective_tables_count", "INTEGER"],
  ["decision_reason", "TEXT"],
  ["token_label", "TEXT"],
  ["token_hash_prefix", "TEXT"],
  ["lucy_session_id", "TEXT"],
  ["lucy_turn_id", "TEXT"],
  ["lucy_platform", "TEXT"],
  ["query_hash", "TEXT"],
  ["query_length", "INTEGER"],
  ["query_operation", "TEXT"],
  ["query_preview", "TEXT"],
  ["response_bytes", "INTEGER"],
  ["response_row_count", "INTEGER"],
  ["response_column_count", "INTEGER"],
  ["response_truncated", "INTEGER"]
] as const;

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function getDb(): Promise<Database.Database> {
  if (db) return db;
  const projectRoot = await resolveProjectRoot();
  const dir = path.join(projectRoot, ".ktx-ui");
  mkdirSync(dir, { recursive: true });
  const dbPath = process.env.LUCY_AUDIT_DB ?? path.join(dir, "audit.sqlite");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS access_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ts           TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      token_label  TEXT,
      token_hash_prefix TEXT,
      lucy_session_id TEXT,
      lucy_turn_id TEXT,
      lucy_platform TEXT,
      client       TEXT,
      tool         TEXT    NOT NULL,
      tables       TEXT,
      args_summary TEXT,
      query_hash   TEXT,
      query_length INTEGER,
      query_operation TEXT,
      query_preview TEXT,
      outcome      TEXT    NOT NULL,
      error_detail TEXT,
      duration_ms  INTEGER NOT NULL,
      response_bytes INTEGER,
      response_row_count INTEGER,
      response_column_count INTEGER,
      response_truncated INTEGER,
      request_id   TEXT    NOT NULL,
      role_ids     TEXT,
      permission_snapshot_hash TEXT,
      effective_tables_count INTEGER,
      decision_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_tool_ts ON access_log(tool, ts);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL,
      reason     TEXT
    );
    CREATE TABLE IF NOT EXISTS permission_snapshots (
      hash          TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL,
      roles_json    TEXT NOT NULL,
      resolved_json TEXT NOT NULL
    );
  `);
  for (const [column, definition] of ACCESS_LOG_COLUMNS) {
    ensureColumn(db, "access_log", column, definition);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
    CREATE INDEX IF NOT EXISTS idx_al_session_ts ON access_log(lucy_session_id, ts);
  `);
  return db;
}

let insertStmt: Database.Statement | null = null;
let snapshotStmt: Database.Statement | null = null;

export function isTokenRevoked(tokenHash: string): Promise<boolean> {
  return getDb().then((database) => {
    const row = database.prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ?").get(tokenHash);
    return row !== undefined;
  });
}

function truncateErrorDetail(value: string): string {
  if (value.length <= 500) return value;
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 16);
  const marker = ` <truncated sha256:${digest}>`;
  return `${value.slice(0, 500 - marker.length)}${marker}`;
}

export async function writeLog(entry: AccessLogEntry): Promise<void> {
  const database = await getDb();
  if (entry.permissionSnapshot) {
    if (!snapshotStmt) {
      snapshotStmt = database.prepare(`
        INSERT OR IGNORE INTO permission_snapshots
          (hash, created_at, roles_json, resolved_json)
        VALUES
          (@hash, @createdAt, @rolesJson, @resolvedJson)
      `);
    }
    snapshotStmt.run({
      hash: entry.permissionSnapshot.hash,
      createdAt: entry.ts,
      rolesJson: JSON.stringify(entry.permissionSnapshot.rolesJson),
      resolvedJson: JSON.stringify(entry.permissionSnapshot.resolvedJson)
    });
  }
  if (!insertStmt) {
    insertStmt = database.prepare(`
      INSERT INTO access_log
        (ts, user_id, token_label, token_hash_prefix, lucy_session_id, lucy_turn_id, lucy_platform, client, tool, tables, args_summary, query_hash, query_length, query_operation, query_preview, outcome, error_detail, duration_ms, response_bytes, response_row_count, response_column_count, response_truncated, request_id, role_ids, permission_snapshot_hash, effective_tables_count, decision_reason)
      VALUES
        (@ts, @userId, @tokenLabel, @tokenHashPrefix, @lucySessionId, @lucyTurnId, @lucyPlatform, @client, @tool, @tables, @argsSummary, @queryHash, @queryLength, @queryOperation, @queryPreview, @outcome, @errorDetail, @durationMs, @responseBytes, @responseRowCount, @responseColumnCount, @responseTruncated, @requestId, @roleIds, @permissionSnapshotHash, @effectiveTablesCount, @decisionReason)
    `);
  }
  insertStmt.run({
    ts: entry.ts,
    userId: entry.userId,
    tokenLabel: entry.tokenLabel ?? null,
    tokenHashPrefix: entry.tokenHashPrefix ?? null,
    lucySessionId: entry.lucySessionId ?? null,
    lucyTurnId: entry.lucyTurnId ?? null,
    lucyPlatform: entry.lucyPlatform ?? null,
    client: entry.client ?? null,
    tool: entry.tool,
    tables: entry.tables ? JSON.stringify(entry.tables) : null,
    argsSummary: entry.argsSummary ? JSON.stringify(entry.argsSummary) : null,
    queryHash: entry.queryHash ?? null,
    queryLength: entry.queryLength ?? null,
    queryOperation: entry.queryOperation ?? null,
    queryPreview: entry.queryPreview ?? null,
    outcome: entry.outcome,
    errorDetail: entry.errorDetail ? truncateErrorDetail(entry.errorDetail) : null,
    durationMs: entry.durationMs,
    responseBytes: entry.responseBytes ?? null,
    responseRowCount: entry.responseRowCount ?? null,
    responseColumnCount: entry.responseColumnCount ?? null,
    responseTruncated: entry.responseTruncated === undefined ? null : (entry.responseTruncated ? 1 : 0),
    requestId: String(entry.requestId),
    roleIds: entry.roleIds ? JSON.stringify(entry.roleIds) : null,
    permissionSnapshotHash: entry.permissionSnapshotHash ?? entry.permissionSnapshot?.hash ?? null,
    effectiveTablesCount: entry.effectiveTablesCount ?? null,
    decisionReason: entry.decisionReason ?? null,
  });
}
