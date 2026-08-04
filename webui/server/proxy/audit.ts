import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import { prepareTraceDatabase } from "../trace/evidence.js";
import { resolveSourceRefsForTables } from "./acl.js";

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
  traceId?: string;
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

export interface AccessLogSourceRecord {
  connectionId?: string;
  schemaName?: string;
  sourceName?: string;
  physicalTable: string;
  extractionMethod: string;
  confidence: "high" | "medium" | "low";
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
  ["response_truncated", "INTEGER"],
  ["trace_id", "TEXT"]
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
  prepareTraceDatabase(db);
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
      trace_id     TEXT,
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
    CREATE TABLE IF NOT EXISTS access_log_sources (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id     INTEGER NOT NULL,
      ts                TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      tool              TEXT NOT NULL,
      connection_id     TEXT,
      schema_name       TEXT,
      source_name       TEXT,
      physical_table    TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      confidence        TEXT NOT NULL,
      created_at        TEXT NOT NULL,
      FOREIGN KEY(access_log_id) REFERENCES access_log(id)
    );
    CREATE INDEX IF NOT EXISTS idx_als_log ON access_log_sources(access_log_id);
    CREATE INDEX IF NOT EXISTS idx_als_user_ts ON access_log_sources(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_als_source ON access_log_sources(connection_id, schema_name, source_name);
    CREATE INDEX IF NOT EXISTS idx_als_table ON access_log_sources(physical_table);
    CREATE TABLE IF NOT EXISTS conversation_turns (
      turn_id               TEXT PRIMARY KEY,
      session_id            TEXT,
      user_id               TEXT NOT NULL,
      token_hash_prefix     TEXT,
      platform              TEXT,
      client                TEXT,
      question_hash         TEXT,
      question_preview      TEXT,
      question_summary      TEXT,
      question_source       TEXT NOT NULL,
      redaction_version     TEXT,
      created_at            TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ct_user_created ON conversation_turns(user_id, created_at);
    CREATE TABLE IF NOT EXISTS inferred_turns (
      inferred_turn_id     TEXT PRIMARY KEY,
      user_id              TEXT NOT NULL,
      started_at           TEXT NOT NULL,
      ended_at             TEXT NOT NULL,
      call_count           INTEGER NOT NULL,
      business_call_count  INTEGER NOT NULL,
      tool_summary         TEXT NOT NULL,
      source_summary       TEXT NOT NULL,
      question_summary     TEXT,
      confidence           TEXT NOT NULL,
      evidence_json        TEXT NOT NULL,
      created_at           TEXT NOT NULL,
      updated_at           TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inferred_turn_access_logs (
      inferred_turn_id TEXT NOT NULL,
      access_log_id    INTEGER NOT NULL,
      PRIMARY KEY(inferred_turn_id, access_log_id)
    );
    CREATE INDEX IF NOT EXISTS idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
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

export async function writeLog(entry: AccessLogEntry): Promise<number> {
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
        (ts, user_id, token_label, token_hash_prefix, lucy_session_id, lucy_turn_id, lucy_platform, client, tool, tables, args_summary, query_hash, query_length, query_operation, query_preview, outcome, error_detail, duration_ms, response_bytes, response_row_count, response_column_count, response_truncated, request_id, trace_id, role_ids, permission_snapshot_hash, effective_tables_count, decision_reason)
      VALUES
        (@ts, @userId, @tokenLabel, @tokenHashPrefix, @lucySessionId, @lucyTurnId, @lucyPlatform, @client, @tool, @tables, @argsSummary, @queryHash, @queryLength, @queryOperation, @queryPreview, @outcome, @errorDetail, @durationMs, @responseBytes, @responseRowCount, @responseColumnCount, @responseTruncated, @requestId, @traceId, @roleIds, @permissionSnapshotHash, @effectiveTablesCount, @decisionReason)
    `);
  }
  const result = insertStmt.run({
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
    traceId: entry.traceId ?? null,
    roleIds: entry.roleIds ? JSON.stringify(entry.roleIds) : null,
    permissionSnapshotHash: entry.permissionSnapshotHash ?? entry.permissionSnapshot?.hash ?? null,
    effectiveTablesCount: entry.effectiveTablesCount ?? null,
    decisionReason: entry.decisionReason ?? null,
  });
  return Number(result.lastInsertRowid);
}

let sourceInsertStmt: Database.Statement | null = null;

export async function writeAccessLogSources(
  accessLogId: number,
  ts: string,
  userId: string,
  tool: string,
  sources: AccessLogSourceRecord[]
): Promise<void> {
  if (sources.length === 0) return;
  const database = await getDb();
  if (!sourceInsertStmt) {
    sourceInsertStmt = database.prepare(`
      INSERT INTO access_log_sources
        (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name, physical_table, extraction_method, confidence, created_at)
      VALUES
        (@accessLogId, @ts, @userId, @tool, @connectionId, @schemaName, @sourceName, @physicalTable, @extractionMethod, @confidence, @createdAt)
    `);
  }
  const createdAt = new Date().toISOString();
  for (const source of sources) {
    sourceInsertStmt.run({
      accessLogId,
      ts,
      userId,
      tool,
      connectionId: source.connectionId ?? null,
      schemaName: source.schemaName ?? null,
      sourceName: source.sourceName ?? null,
      physicalTable: source.physicalTable,
      extractionMethod: source.extractionMethod,
      confidence: source.confidence,
      createdAt
    });
  }
}

export async function backfillAccessLogSourcesFromTables(
  options: { sinceDays?: number; dryRun?: boolean } = {}
): Promise<{ scanned: number; inserted: number }> {
  const sinceDays = options.sinceDays ?? 7;
  const dryRun = options.dryRun ?? false;
  const database = await getDb();
  const cutoff = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`
    SELECT al.id, al.ts, al.user_id, al.tool, al.tables
    FROM access_log al
    WHERE al.ts >= ?
      AND al.tables IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM access_log_sources als WHERE als.access_log_id = al.id)
  `).all(cutoff) as Array<{ id: number; ts: string; user_id: string; tool: string; tables: string }>;

  let inserted = 0;
  for (const row of rows) {
    let tables: string[];
    try {
      tables = JSON.parse(row.tables) as string[];
    } catch {
      continue;
    }
    if (!Array.isArray(tables) || tables.length === 0) continue;
    const refs = await resolveSourceRefsForTables(tables, {
      extractionMethod: "source_map_reverse",
      confidence: "medium"
    });
    if (refs.length === 0) continue;
    if (!dryRun) {
      await writeAccessLogSources(row.id, row.ts, row.user_id, row.tool, refs.map((ref) => ({
        connectionId: ref.connectionId,
        schemaName: ref.schema,
        sourceName: ref.sourceName,
        physicalTable: ref.physicalTable,
        extractionMethod: ref.extractionMethod,
        confidence: ref.confidence
      })));
    }
    inserted += refs.length;
  }

  return { scanned: rows.length, inserted };
}

export interface R1AuditObservability {
  window: {
    since: string;
    hours: number;
    slowMs: number;
  };
  traffic: {
    totalRequests: number;
    businessCalls: number;
    okCalls: number;
    errorCalls: number;
    deniedCalls: number;
    successRate: number;
    errorRate: number;
    deniedRate: number;
  };
  latency: {
    p50Ms: number | null;
    p95Ms: number | null;
    slowCalls: number;
    slowQueries: Array<{
      ts: string;
      userId: string;
      tool: string;
      durationMs: number;
      queryOperation?: string;
      queryPreview?: string;
      decisionReason?: string;
      requestId: string;
    }>;
  };
  denials: Array<{ reason: string; count: number }>;
  sourceErrors: Array<{
    source: string;
    connectionId?: string;
    schemaName?: string;
    sourceName?: string;
    physicalTable: string;
    outcome: "error" | "denied";
    count: number;
  }>;
  usage: {
    tools: Array<{ tool: string; calls: number; denied: number; errors: number }>;
    roles: Array<{ roleId: string; calls: number; denied: number }>;
    tokens: Array<{ tokenLabel: string; tokenHashPrefix?: string; calls: number; denied: number }>;
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function parseRoleIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function readR1AuditObservability(options: { hours?: number; slowMs?: number } = {}): Promise<R1AuditObservability> {
  const hours = Math.min(Math.max(Math.floor(options.hours ?? 24), 1), 24 * 90);
  const slowMs = Math.max(Math.floor(options.slowMs ?? Number(process.env.LUCY_R1_SLOW_QUERY_MS ?? 30_000)), 1);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const database = await getDb();

  const rows = database.prepare(`
    SELECT ts, user_id, token_label, token_hash_prefix, tool, outcome, duration_ms, request_id,
           role_ids, decision_reason, query_operation, query_preview, tables
    FROM access_log
    WHERE ts >= ?
    ORDER BY ts DESC, id DESC
  `).all(since) as Array<{
    ts: string;
    user_id: string;
    token_label: string | null;
    token_hash_prefix: string | null;
    tool: string;
    outcome: "ok" | "error" | "denied";
    duration_ms: number;
    request_id: string;
    role_ids: string | null;
    decision_reason: string | null;
    query_operation: string | null;
    query_preview: string | null;
    tables: string | null;
  }>;

  const protocolTools = new Set<string>(PROTOCOL_TOOLS);
  const businessRows = rows.filter((row) => !protocolTools.has(row.tool));
  const okCalls = businessRows.filter((row) => row.outcome === "ok").length;
  const errorCalls = businessRows.filter((row) => row.outcome === "error").length;
  const deniedCalls = businessRows.filter((row) => row.outcome === "denied").length;
  const durations = businessRows.map((row) => row.duration_ms).filter((value) => Number.isFinite(value));

  const denials = new Map<string, number>();
  const tools = new Map<string, { tool: string; calls: number; denied: number; errors: number }>();
  const roles = new Map<string, { roleId: string; calls: number; denied: number }>();
  const tokens = new Map<string, { tokenLabel: string; tokenHashPrefix?: string; calls: number; denied: number }>();

  for (const row of businessRows) {
    if (row.outcome === "denied") {
      const reason = row.decision_reason ?? "unknown";
      denials.set(reason, (denials.get(reason) ?? 0) + 1);
    }

    const tool = tools.get(row.tool) ?? { tool: row.tool, calls: 0, denied: 0, errors: 0 };
    tool.calls += 1;
    if (row.outcome === "denied") tool.denied += 1;
    if (row.outcome === "error") tool.errors += 1;
    tools.set(row.tool, tool);

    for (const roleId of parseRoleIds(row.role_ids)) {
      const role = roles.get(roleId) ?? { roleId, calls: 0, denied: 0 };
      role.calls += 1;
      if (row.outcome === "denied") role.denied += 1;
      roles.set(roleId, role);
    }

    const tokenLabel = row.token_label ?? "unknown";
    const tokenKey = `${tokenLabel}:${row.token_hash_prefix ?? ""}`;
    const token = tokens.get(tokenKey) ?? { tokenLabel, tokenHashPrefix: row.token_hash_prefix ?? undefined, calls: 0, denied: 0 };
    token.calls += 1;
    if (row.outcome === "denied") token.denied += 1;
    tokens.set(tokenKey, token);
  }

  const slowQueries = businessRows
    .filter((row) => row.duration_ms >= slowMs)
    .slice(0, 20)
    .map((row) => ({
      ts: row.ts,
      userId: row.user_id,
      tool: row.tool,
      durationMs: row.duration_ms,
      queryOperation: row.query_operation ?? undefined,
      queryPreview: row.query_preview ?? undefined,
      decisionReason: row.decision_reason ?? undefined,
      requestId: row.request_id
    }));

  const sourceErrorRows = database.prepare(`
    SELECT
      COALESCE(als.connection_id, '') AS connection_id,
      COALESCE(als.schema_name, '') AS schema_name,
      COALESCE(als.source_name, '') AS source_name,
      als.physical_table,
      al.outcome,
      COUNT(*) AS count
    FROM access_log al
    JOIN access_log_sources als ON als.access_log_id = al.id
    WHERE al.ts >= ? AND al.outcome IN ('error', 'denied')
    GROUP BY als.connection_id, als.schema_name, als.source_name, als.physical_table, al.outcome
    ORDER BY count DESC
    LIMIT 20
  `).all(since) as Array<{
    connection_id: string;
    schema_name: string;
    source_name: string;
    physical_table: string;
    outcome: "error" | "denied";
    count: number;
  }>;

  return {
    window: { since, hours, slowMs },
    traffic: {
      totalRequests: rows.length,
      businessCalls: businessRows.length,
      okCalls,
      errorCalls,
      deniedCalls,
      successRate: rate(okCalls, businessRows.length),
      errorRate: rate(errorCalls, businessRows.length),
      deniedRate: rate(deniedCalls, businessRows.length)
    },
    latency: {
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      slowCalls: slowQueries.length,
      slowQueries
    },
    denials: [...denials.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    sourceErrors: sourceErrorRows.map((row) => ({
      source: [row.connection_id, row.schema_name, row.source_name].filter(Boolean).join(".") || row.physical_table,
      connectionId: row.connection_id || undefined,
      schemaName: row.schema_name || undefined,
      sourceName: row.source_name || undefined,
      physicalTable: row.physical_table,
      outcome: row.outcome,
      count: row.count
    })),
    usage: {
      tools: [...tools.values()].sort((a, b) => b.calls - a.calls).slice(0, 30),
      roles: [...roles.values()].sort((a, b) => b.calls - a.calls).slice(0, 30),
      tokens: [...tokens.values()].sort((a, b) => b.calls - a.calls).slice(0, 30)
    }
  };
}

export async function searchAccessLogs(options: {
  hours?: number;
  trace?: string;
  source?: string;
  role?: string;
  outcome?: string;
  limit?: number;
} = {}): Promise<Array<{
  ts: string;
  userId: string;
  tool: string;
  outcome: string;
  durationMs: number;
  requestId: string;
  lucyTurnId?: string;
  lucySessionId?: string;
  roleIds?: string[];
  tables?: string[];
  queryOperation?: string;
  queryPreview?: string;
  decisionReason?: string;
}>> {
  const hours = Math.min(Math.max(Math.floor(options.hours ?? 24), 1), 24 * 90);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const database = await getDb();
  const clauses = ["al.ts >= ?"];
  const params: unknown[] = [since];

  if (options.trace) {
    clauses.push("(al.lucy_turn_id = ? OR al.request_id = ? OR al.lucy_session_id = ?)");
    params.push(options.trace, options.trace, options.trace);
  }
  if (options.outcome) {
    clauses.push("al.outcome = ?");
    params.push(options.outcome);
  }
  if (options.role) {
    clauses.push("al.role_ids LIKE ?");
    params.push(`%${options.role}%`);
  }
  if (options.source) {
    clauses.push(`(
      al.tables LIKE ?
      OR EXISTS (
        SELECT 1 FROM access_log_sources als
        WHERE als.access_log_id = al.id
          AND (als.source_name LIKE ? OR als.physical_table LIKE ?)
      )
    )`);
    params.push(`%${options.source}%`, `%${options.source}%`, `%${options.source}%`);
  }
  params.push(limit);

  const rows = database.prepare(`
    SELECT al.ts, al.user_id, al.tool, al.outcome, al.duration_ms, al.request_id,
           al.lucy_turn_id, al.lucy_session_id, al.role_ids, al.tables,
           al.query_operation, al.query_preview, al.decision_reason
    FROM access_log al
    WHERE ${clauses.join(" AND ")}
    ORDER BY al.ts DESC, al.id DESC
    LIMIT ?
  `).all(...params) as Array<{
    ts: string;
    user_id: string;
    tool: string;
    outcome: string;
    duration_ms: number;
    request_id: string;
    lucy_turn_id: string | null;
    lucy_session_id: string | null;
    role_ids: string | null;
    tables: string | null;
    query_operation: string | null;
    query_preview: string | null;
    decision_reason: string | null;
  }>;

  return rows.map((row) => ({
    ts: row.ts,
    userId: row.user_id,
    tool: row.tool,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    requestId: row.request_id,
    lucyTurnId: row.lucy_turn_id ?? undefined,
    lucySessionId: row.lucy_session_id ?? undefined,
    roleIds: parseRoleIds(row.role_ids),
    tables: parseJsonArray(row.tables),
    queryOperation: row.query_operation ?? undefined,
    queryPreview: row.query_preview ?? undefined,
    decisionReason: row.decision_reason ?? undefined
  }));
}

// ─── Phase 3: conversation_turns (optional reported questions) ──────────────

const PROTOCOL_TOOLS = ["tools/list", "initialize", "notifications/initialized"] as const;

export interface ConversationTurnRecord {
  turnId: string;
  sessionId?: string;
  userId: string;
  tokenHashPrefix?: string;
  platform?: string;
  client?: string;
  questionHash?: string;
  questionPreview?: string;
  questionSummary?: string;
  questionSource: string;
  redactionVersion?: string;
}

let conversationTurnInsertStmt: Database.Statement | null = null;

export async function writeConversationTurn(record: ConversationTurnRecord): Promise<void> {
  const database = await getDb();
  if (!conversationTurnInsertStmt) {
    conversationTurnInsertStmt = database.prepare(`
      INSERT INTO conversation_turns
        (turn_id, session_id, user_id, token_hash_prefix, platform, client, question_hash, question_preview, question_summary, question_source, redaction_version, created_at)
      VALUES
        (@turnId, @sessionId, @userId, @tokenHashPrefix, @platform, @client, @questionHash, @questionPreview, @questionSummary, @questionSource, @redactionVersion, @createdAt)
    `);
  }
  conversationTurnInsertStmt.run({
    turnId: record.turnId,
    sessionId: record.sessionId ?? null,
    userId: record.userId,
    tokenHashPrefix: record.tokenHashPrefix ?? null,
    platform: record.platform ?? null,
    client: record.client ?? null,
    questionHash: record.questionHash ?? null,
    questionPreview: record.questionPreview ?? null,
    questionSummary: record.questionSummary ?? null,
    questionSource: record.questionSource,
    redactionVersion: record.redactionVersion ?? null,
    createdAt: new Date().toISOString()
  });
}

export async function purgeExpiredConversationTurns(
  options: { retentionDays?: number; dryRun?: boolean } = {}
): Promise<{ scanned: number; purged: number }> {
  const retentionDays = options.retentionDays ?? Number(process.env.LUCY_QUESTION_PREVIEW_RETENTION_DAYS ?? 30);
  const dryRun = options.dryRun ?? false;
  const database = await getDb();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = database.prepare(`
    SELECT turn_id FROM conversation_turns
    WHERE created_at < ? AND (question_preview IS NOT NULL OR question_summary IS NOT NULL OR question_hash IS NOT NULL)
  `).all(cutoff) as Array<{ turn_id: string }>;

  if (!dryRun && rows.length > 0) {
    const purgeStmt = database.prepare(`
      UPDATE conversation_turns SET question_preview = NULL, question_summary = NULL, question_hash = NULL
      WHERE turn_id = ?
    `);
    const purgeAll = database.transaction((turnIds: string[]) => {
      for (const turnId of turnIds) purgeStmt.run(turnId);
    });
    purgeAll(rows.map((row) => row.turn_id));
  }

  return { scanned: rows.length, purged: dryRun ? 0 : rows.length };
}

// ─── Phase 2: inferred_turns (lazy-rebuilt call clustering) ──────────────────

interface SourceSummaryEntry {
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable: string;
}

const INFERRED_SUMMARY_ARG_KEYS = ["statement_type", "amount_type", "company_name", "report_period"] as const;

function buildInferredQuestionSummary(sourceSummary: SourceSummaryEntry[], argsSummaries: Array<Record<string, unknown>>): string {
  const names = [...new Set(sourceSummary.map((s) => s.sourceName ?? s.physicalTable))];
  const details: string[] = [];
  for (const args of argsSummaries) {
    for (const key of INFERRED_SUMMARY_ARG_KEYS) {
      const value = args[key];
      if (typeof value === "string" && value && !details.includes(`${key}=${value}`)) {
        details.push(`${key}=${value}`);
      }
    }
  }
  if (names.length === 0) return "推断：未识别到具体数据源的调用簇";
  const sourceText = `推断：触达 ${names.join("、")}`;
  return details.length > 0 ? `${sourceText}（${details.join("，")}）` : sourceText;
}

export async function rebuildInferredTurns(
  userId: string,
  options: { lookbackHours?: number; gapMs?: number; includeCatalogOnly?: boolean } = {}
): Promise<{ turns: number }> {
  const lookbackHours = options.lookbackHours ?? Number(process.env.LUCY_TURN_INFER_LOOKBACK_HOURS ?? 24);
  const gapMs = options.gapMs ?? Number(process.env.LUCY_TURN_INFER_GAP_MS ?? 120_000);
  const includeCatalogOnly = options.includeCatalogOnly ?? (process.env.LUCY_TURN_INFER_INCLUDE_CATALOG_ONLY === "true");
  const database = await getDb();
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const protocolList = PROTOCOL_TOOLS.map((tool) => `'${tool}'`).join(", ");

  const rows = database.prepare(`
    SELECT id, ts, tool, tables, args_summary
    FROM access_log
    WHERE user_id = ? AND ts >= ? AND tool NOT IN (${protocolList})
    ORDER BY ts ASC, id ASC
  `).all(userId, cutoff) as Array<{ id: number; ts: string; tool: string; tables: string | null; args_summary: string | null }>;

  type ClusterRow = (typeof rows)[number];
  const clusters: ClusterRow[][] = [];
  let current: ClusterRow[] = [];
  let lastTs = 0;
  for (const row of rows) {
    const t = new Date(row.ts).getTime();
    if (current.length > 0 && t - lastTs > gapMs) {
      clusters.push(current);
      current = [];
    }
    current.push(row);
    lastTs = t;
  }
  if (current.length > 0) clusters.push(current);

  const deleteAccessLogsStmt = database.prepare(`
    DELETE FROM inferred_turn_access_logs
    WHERE inferred_turn_id IN (SELECT inferred_turn_id FROM inferred_turns WHERE user_id = ? AND started_at >= ?)
  `);
  const deleteTurnsStmt = database.prepare(`DELETE FROM inferred_turns WHERE user_id = ? AND started_at >= ?`);
  const insertTurnStmt = database.prepare(`
    INSERT INTO inferred_turns
      (inferred_turn_id, user_id, started_at, ended_at, call_count, business_call_count, tool_summary, source_summary, question_summary, confidence, evidence_json, created_at, updated_at)
    VALUES
      (@id, @userId, @startedAt, @endedAt, @callCount, @businessCallCount, @toolSummary, @sourceSummary, @questionSummary, @confidence, @evidenceJson, @createdAt, @updatedAt)
  `);
  const insertLinkStmt = database.prepare(`INSERT INTO inferred_turn_access_logs (inferred_turn_id, access_log_id) VALUES (?, ?)`);
  const sourceQueryCache = new Map<string, Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }>>();

  function sourcesFor(accessLogIds: number[]): Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }> {
    if (accessLogIds.length === 0) return [];
    const key = accessLogIds.join(",");
    const cached = sourceQueryCache.get(key);
    if (cached) return cached;
    const result = database.prepare(`
      SELECT DISTINCT connection_id, schema_name, source_name, physical_table
      FROM access_log_sources
      WHERE access_log_id IN (${accessLogIds.map(() => "?").join(",")})
    `).all(...accessLogIds) as Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }>;
    sourceQueryCache.set(key, result);
    return result;
  }

  const rebuild = database.transaction((): number => {
    deleteAccessLogsStmt.run(userId, cutoff);
    deleteTurnsStmt.run(userId, cutoff);

    let written = 0;
    let seq = 0;
    for (const cluster of clusters) {
      const isCatalogOnly = cluster.every((row) => row.tool === "kx_catalog");
      if (isCatalogOnly && !includeCatalogOnly) continue; // preflight_only — spec §7.1, not a formal question

      seq += 1;
      const accessLogIds = cluster.map((row) => row.id);
      const businessRows = cluster.filter((row) => row.tables !== null);
      const dataBearing = businessRows.length > 0;
      const toolSummary = [...new Set(cluster.map((row) => row.tool))];
      const sourceRows = sourcesFor(accessLogIds);
      const sourceSummary: SourceSummaryEntry[] = sourceRows.map((row) => ({
        connectionId: row.connection_id ?? undefined,
        schema: row.schema_name ?? undefined,
        sourceName: row.source_name ?? undefined,
        physicalTable: row.physical_table
      }));
      const argsSummaries = cluster
        .map((row) => row.args_summary)
        .filter((value): value is string => Boolean(value))
        .map((value) => {
          try {
            return JSON.parse(value) as Record<string, unknown>;
          } catch {
            return {};
          }
        });

      const confidence: "medium" | "low" = dataBearing ? "medium" : "low";
      const questionSummary = buildInferredQuestionSummary(sourceSummary, argsSummaries);
      const now = new Date().toISOString();
      const startedAt = cluster[0].ts;
      const endedAt = cluster[cluster.length - 1].ts;
      const inferredTurnId = `inf_${startedAt.replace(/[^0-9]/g, "")}_${userId}_${String(seq).padStart(2, "0")}`;

      insertTurnStmt.run({
        id: inferredTurnId,
        userId,
        startedAt,
        endedAt,
        callCount: cluster.length,
        businessCallCount: businessRows.length,
        toolSummary: JSON.stringify(toolSummary),
        sourceSummary: JSON.stringify(sourceSummary),
        questionSummary,
        confidence,
        evidenceJson: JSON.stringify({ accessLogIds, toolSummary, sourceSummary, callCount: cluster.length, businessCallCount: businessRows.length }),
        createdAt: now,
        updatedAt: now
      });
      for (const accessLogId of accessLogIds) {
        insertLinkStmt.run(inferredTurnId, accessLogId);
      }
      written += 1;
    }
    return written;
  });

  const turns = rebuild();
  return { turns };
}
