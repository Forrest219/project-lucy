import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { resolveProjectRoot } from "../project.js";

let db: Database.Database | null = null;
const ACCESS_LOG_COLUMNS = [
  ["role_ids", "TEXT"],
  ["permission_snapshot_hash", "TEXT"],
  ["effective_tables_count", "INTEGER"],
  ["decision_reason", "TEXT"]
] as const;

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export async function getAuditDb(): Promise<Database.Database> {
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
  return db;
}

interface QueryRow {
  id: number;
  ts: string;
  user_id: string;
  client: string | null;
  tool: string;
  tables: string | null;
  args_summary: string | null;
  outcome: string;
  error_detail: string | null;
  duration_ms: number;
  request_id: string;
  role_ids: string | null;
  permission_snapshot_hash: string | null;
  effective_tables_count: number | null;
  decision_reason: string | null;
}

export function registerAuditRoutes(app: FastifyInstance) {
  // GET /api/admin/audit
  app.get<{
    Querystring: {
      user?: string;
      tool?: string;
      outcome?: string;
      since?: string;
      until?: string;
      tableSearch?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/audit", async (request) => {
    const q = request.query;
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;

    const database = await getAuditDb();

    const conditions: string[] = [];
    const params: Record<string, string | null> = {
      user: q.user ?? null,
      tool: q.tool ?? null,
      outcome: q.outcome ?? null,
      since: q.since ?? null,
      until: q.until ?? null,
      tableSearch: q.tableSearch ? `%${q.tableSearch}%` : null
    };

    if (params.user) conditions.push("user_id = @user");
    if (params.tool) conditions.push("tool = @tool");
    if (params.outcome) conditions.push("outcome = @outcome");
    if (params.since) conditions.push("ts >= @since");
    if (params.until) conditions.push("ts <= @until");
    if (params.tableSearch) conditions.push("tables LIKE @tableSearch");

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = database.prepare(`SELECT COUNT(*) AS cnt FROM access_log ${where}`).get(params) as { cnt: number };
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as QueryRow[];

    const entries = rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      userId: row.user_id,
      client: row.client ?? undefined,
      tool: row.tool,
      tables: row.tables ? (JSON.parse(row.tables) as string[]) : undefined,
      argsSummary: row.args_summary ? (JSON.parse(row.args_summary) as Record<string, unknown>) : undefined,
      outcome: row.outcome as "ok" | "error" | "denied",
      errorDetail: row.error_detail ?? undefined,
      durationMs: row.duration_ms,
      requestId: row.request_id,
      roleIds: row.role_ids ? (JSON.parse(row.role_ids) as string[]) : undefined,
      permissionSnapshotHash: row.permission_snapshot_hash ?? undefined,
      effectiveTablesCount: row.effective_tables_count ?? undefined,
      decisionReason: row.decision_reason ?? undefined
    }));

    return { ok: true, data: { total: totalRow.cnt, entries } };
  });

  // GET /api/admin/audit/export
  app.get<{
    Querystring: {
      user?: string;
      tool?: string;
      outcome?: string;
      since?: string;
      until?: string;
      tableSearch?: string;
    };
  }>("/api/admin/audit/export", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();

    const conditions: string[] = [];
    const params: Record<string, string | null> = {
      user: q.user ?? null,
      tool: q.tool ?? null,
      outcome: q.outcome ?? null,
      since: q.since ?? null,
      until: q.until ?? null,
      tableSearch: q.tableSearch ? `%${q.tableSearch}%` : null
    };

    if (params.user) conditions.push("user_id = @user");
    if (params.tool) conditions.push("tool = @tool");
    if (params.outcome) conditions.push("outcome = @outcome");
    if (params.since) conditions.push("ts >= @since");
    if (params.until) conditions.push("ts <= @until");
    if (params.tableSearch) conditions.push("tables LIKE @tableSearch");

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC`)
      .all(params) as QueryRow[];

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const headers = ["id", "ts", "user_id", "client", "tool", "tables", "outcome", "error_detail", "duration_ms", "request_id"];
    const csvLines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.id,
          `"${row.ts}"`,
          `"${row.user_id}"`,
          row.client ? `"${row.client}"` : "",
          `"${row.tool}"`,
          row.tables ? `"${row.tables.replace(/"/g, '""')}"` : "",
          `"${row.outcome}"`,
          row.error_detail ? `"${row.error_detail.replace(/"/g, '""')}"` : "",
          row.duration_ms,
          `"${row.request_id}"`
        ].join(",")
      )
    ];

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="audit-${dateStr}.csv"`);
    return reply.send(csvLines.join("\n"));
  });
}
