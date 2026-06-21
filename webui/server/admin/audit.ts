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
  ["decision_reason", "TEXT"],
  ["token_label", "TEXT"],
  ["token_hash_prefix", "TEXT"]
] as const;
const PROTOCOL_TOOLS = ["tools/list", "initialize", "notifications/initialized"] as const;
const PROTOCOL_TOOL_LIST = PROTOCOL_TOOLS.map((tool) => `'${tool}'`).join(", ");
const SENSITIVE_KEY_RE = /(?:password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)/i;
const SENSITIVE_PAIR_RE = /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)\b\s*[:=]\s*([^,\s;]+)/gi;
const CSV_FORMULA_RE = /^[=+\-@]/;

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const raw = String(value);
  const escaped = (CSV_FORMULA_RE.test(raw) ? `'${raw}` : raw).replace(/"/g, '""');
  return `"${escaped}"`;
}

function redactText(value: string): string {
  return value.replace(SENSITIVE_PAIR_RE, "$1=[REDACTED]");
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redactSensitive(nested)
      ])
    );
  }
  if (typeof value === "string") return redactText(value);
  return value;
}

function redactJsonString(value: string | null): string | null {
  if (!value) return null;
  try {
    return JSON.stringify(redactSensitive(JSON.parse(value)));
  } catch {
    return redactText(value);
  }
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
      token_label  TEXT,
      token_hash_prefix TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
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
    CREATE TABLE IF NOT EXISTS config_change_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      session_id TEXT,
      file_path TEXT NOT NULL,
      change_type TEXT NOT NULL,
      target_id TEXT,
      old_summary TEXT,
      new_summary TEXT,
      diff TEXT,
      request_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ccl_ts ON config_change_log(ts);
    CREATE INDEX IF NOT EXISTS idx_ccl_file_ts ON config_change_log(file_path, ts);
  `);
  for (const [column, definition] of ACCESS_LOG_COLUMNS) {
    ensureColumn(db, "access_log", column, definition);
  }
  return db;
}

export async function recordConfigChange(input: {
  filePath: string;
  changeType: string;
  targetId?: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
  requestId?: string;
  sessionId?: string | null;
}): Promise<number | undefined> {
  const database = await getAuditDb();
  const result = database.prepare(`
    INSERT INTO config_change_log
      (ts, actor, session_id, file_path, change_type, target_id, old_summary, new_summary, diff, request_id)
    VALUES
      (@ts, @actor, @session_id, @file_path, @change_type, @target_id, @old_summary, @new_summary, @diff, @request_id)
  `).run({
    ts: new Date().toISOString(),
    actor: "local-admin",
    session_id: input.sessionId ?? null,
    file_path: input.filePath,
    change_type: input.changeType,
    target_id: input.targetId ?? null,
    old_summary: input.oldSummary === undefined ? null : JSON.stringify(input.oldSummary),
    new_summary: input.newSummary === undefined ? null : JSON.stringify(input.newSummary),
    diff: input.diff ?? null,
    request_id: input.requestId ?? null
  });
  return typeof result.lastInsertRowid === "number" ? result.lastInsertRowid : Number(result.lastInsertRowid);
}

interface QueryRow {
  id: number;
  ts: string;
  user_id: string;
  token_label: string | null;
  token_hash_prefix: string | null;
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
      includeProtocol?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/audit", async (request) => {
    const q = request.query;
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;

    const database = await getAuditDb();

    const baseConditions: string[] = [];
    const params: Record<string, string | null> = {
      user: q.user ?? null,
      tool: q.tool ?? null,
      outcome: q.outcome ?? null,
      since: q.since ?? null,
      until: q.until ?? null,
      tableSearch: q.tableSearch ? `%${q.tableSearch}%` : null
    };

    if (params.user) baseConditions.push("user_id = @user");
    if (params.tool) baseConditions.push("tool = @tool");
    if (params.outcome) baseConditions.push("outcome = @outcome");
    if (params.since) baseConditions.push("ts >= @since");
    if (params.until) baseConditions.push("ts <= @until");
    if (params.tableSearch) baseConditions.push("tables LIKE @tableSearch");

    const includeProtocol = q.includeProtocol === "true";
    const conditions = [...baseConditions];
    if (!includeProtocol) conditions.push(`tool NOT IN (${PROTOCOL_TOOL_LIST})`);
    const baseWhere = baseConditions.length > 0 ? `WHERE ${baseConditions.join(" AND ")}` : "";
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const totalRow = database.prepare(`SELECT COUNT(*) AS cnt FROM access_log ${where}`).get(params) as { cnt: number };
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC LIMIT ${limit} OFFSET ${offset}`)
      .all(params) as QueryRow[];
    const summaryRow = database.prepare(`
      SELECT
        SUM(CASE WHEN tool IN (${PROTOCOL_TOOL_LIST}) THEN 1 ELSE 0 END) AS protocol_calls,
        SUM(CASE WHEN tool NOT IN (${PROTOCOL_TOOL_LIST}) THEN 1 ELSE 0 END) AS business_calls,
        SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied_calls,
        SUM(CASE WHEN tool NOT IN (${PROTOCOL_TOOL_LIST}) AND tables IS NOT NULL THEN 1 ELSE 0 END) AS data_bearing_calls
      FROM access_log ${baseWhere}
    `).get(params) as { protocol_calls: number | null; business_calls: number | null; denied_calls: number | null; data_bearing_calls: number | null };

    const entries = rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      userId: row.user_id,
      tokenLabel: row.token_label ?? undefined,
      tokenHashPrefix: row.token_hash_prefix ?? undefined,
      client: row.client ?? undefined,
      tool: row.tool,
      tables: row.tables ? (JSON.parse(row.tables) as string[]) : undefined,
      argsSummary: row.args_summary ? (redactSensitive(JSON.parse(row.args_summary)) as Record<string, unknown>) : undefined,
      outcome: row.outcome as "ok" | "error" | "denied",
      errorDetail: row.error_detail ? redactJsonString(row.error_detail) ?? undefined : undefined,
      durationMs: row.duration_ms,
      requestId: row.request_id,
      roleIds: row.role_ids ? (JSON.parse(row.role_ids) as string[]) : undefined,
      permissionSnapshotHash: row.permission_snapshot_hash ?? undefined,
      effectiveTablesCount: row.effective_tables_count ?? undefined,
      decisionReason: row.decision_reason ?? undefined
    }));

    return {
      ok: true,
      data: {
        total: totalRow.cnt,
        entries,
        summary: {
          protocolCalls: summaryRow.protocol_calls ?? 0,
          businessCalls: summaryRow.business_calls ?? 0,
          deniedCalls: summaryRow.denied_calls ?? 0,
          dataBearingCalls: summaryRow.data_bearing_calls ?? 0
        }
      }
    };
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
      includeProtocol?: string;
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
    if (q.includeProtocol !== "true") conditions.push(`tool NOT IN (${PROTOCOL_TOOL_LIST})`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC`)
      .all(params) as QueryRow[];

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const headers = [
      "id",
      "ts",
      "user_id",
      "token_label",
      "token_hash_prefix",
      "client",
      "tool",
      "tables",
      "args_summary",
      "outcome",
      "error_detail",
      "duration_ms",
      "request_id",
      "role_ids",
      "permission_snapshot_hash",
      "effective_tables_count",
      "decision_reason"
    ];
    const csvLines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.id,
          csvCell(row.ts),
          csvCell(row.user_id),
          csvCell(row.token_label),
          csvCell(row.token_hash_prefix),
          csvCell(row.client),
          csvCell(row.tool),
          csvCell(row.tables),
          csvCell(redactJsonString(row.args_summary)),
          csvCell(row.outcome),
          csvCell(redactJsonString(row.error_detail)),
          row.duration_ms,
          csvCell(row.request_id),
          csvCell(row.role_ids),
          csvCell(row.permission_snapshot_hash),
          row.effective_tables_count ?? "",
          csvCell(row.decision_reason)
        ].join(",")
      )
    ];

    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="audit-${dateStr}.csv"`);
    return reply.send(csvLines.join("\n"));
  });
}
