import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";

export interface AccessLogEntry {
  ts: string;
  userId: string;
  client?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  outcome: "ok" | "error" | "denied";
  errorDetail?: string;
  durationMs: number;
  requestId: string | number;
}

let db: Database.Database | null = null;

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
      client       TEXT,
      tool         TEXT    NOT NULL,
      tables       TEXT,
      args_summary TEXT,
      outcome      TEXT    NOT NULL,
      error_detail TEXT,
      duration_ms  INTEGER NOT NULL,
      request_id   TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_tool_ts ON access_log(tool, ts);
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token_hash TEXT PRIMARY KEY,
      revoked_at TEXT NOT NULL,
      reason     TEXT
    );
  `);
  return db;
}

let insertStmt: Database.Statement | null = null;

export function isTokenRevoked(tokenHash: string): Promise<boolean> {
  return getDb().then((database) => {
    const row = database.prepare("SELECT 1 FROM revoked_tokens WHERE token_hash = ?").get(tokenHash);
    return row !== undefined;
  });
}

export async function writeLog(entry: AccessLogEntry): Promise<void> {
  const database = await getDb();
  if (!insertStmt) {
    insertStmt = database.prepare(`
      INSERT INTO access_log
        (ts, user_id, client, tool, tables, args_summary, outcome, error_detail, duration_ms, request_id)
      VALUES
        (@ts, @userId, @client, @tool, @tables, @argsSummary, @outcome, @errorDetail, @durationMs, @requestId)
    `);
  }
  insertStmt.run({
    ts: entry.ts,
    userId: entry.userId,
    client: entry.client ?? null,
    tool: entry.tool,
    tables: entry.tables ? JSON.stringify(entry.tables) : null,
    argsSummary: entry.argsSummary ? JSON.stringify(entry.argsSummary) : null,
    outcome: entry.outcome,
    errorDetail: entry.errorDetail ? entry.errorDetail.slice(0, 500) : null,
    durationMs: entry.durationMs,
    requestId: String(entry.requestId),
  });
}
