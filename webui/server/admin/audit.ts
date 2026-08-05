import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  CONFIG_AUDIT_CSV_HEADERS,
  actorLabel,
  assetKindLabel,
  changeTypeLabel,
  formatConfigAuditExportFilenameStamp,
  formatConfigAuditTs,
  sourceLabel,
  targetLabel
} from "../../src/lib/configAuditLabels.js";
import { resolveProjectRoot } from "../project.js";
import { rebuildInferredTurns, purgeExpiredConversationTurns } from "../proxy/audit.js";
import { MCP_PLAYGROUND_PLATFORM } from "./mcp-playground.js";
import {
  ensureTraceEvidenceSchema,
  listTraceEvents,
  prepareTraceDatabase,
  type ListTraceEventsFilter,
  type LucySpanStatus,
  type LucySpanType,
  type TraceEventRow,
  type EvidenceEventRow
} from "../trace/evidence.js";

// Per-user lazy-rebuild debounce: GET /turns can be polled frequently (UI refresh, multiple
// users in one window); skip re-running the full delete+reinsert rebuild if we just did it.
const lastRebuildAt = new Map<string, number>();
const REBUILD_DEBOUNCE_MS = Number(process.env.LUCY_TURN_INFER_REBUILD_DEBOUNCE_MS ?? 30_000);

async function rebuildInferredTurnsDebounced(userId: string, options?: { lookbackHours?: number }): Promise<void> {
  // Key on the resolved window size too: a recent rebuild over a narrower window doesn't cover
  // a wider one, so a different lookbackHours must not be skipped by the debounce.
  const key = `${userId}:${options?.lookbackHours ?? "default"}`;
  const now = Date.now();
  const last = lastRebuildAt.get(key);
  if (last !== undefined && now - last < REBUILD_DEBOUNCE_MS) return;
  lastRebuildAt.set(key, now);
  await rebuildInferredTurns(userId, options);
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
const PROTOCOL_TOOLS = ["tools/list", "initialize", "notifications/initialized"] as const;
const PROTOCOL_TOOL_LIST = PROTOCOL_TOOLS.map((tool) => `'${tool}'`).join(", ");

type AccessLogFilterQuery = {
  user?: string;
  tool?: string;
  outcome?: string;
  since?: string;
  until?: string;
  tableSearch?: string;
  sessionId?: string;
  turnId?: string;
  /** Spec 106: fuzzy match on access_log.id (CAST AS TEXT). */
  eventId?: string;
  /** Spec 106: shared key box — matches event id OR lucy_turn_id. */
  key?: string;
  platform?: string;
  callSource?: string;
  includeProtocol?: string;
};

function buildAccessLogFilter(q: AccessLogFilterQuery): {
  conditions: string[];
  baseConditions: string[];
  params: Record<string, string | null>;
  includeProtocol: boolean;
} {
  const params: Record<string, string | null> = {
    user: q.user ?? null,
    tool: q.tool ?? null,
    outcome: q.outcome ?? null,
    since: q.since ?? null,
    until: q.until ?? null,
    tableSearch: q.tableSearch ? `%${q.tableSearch}%` : null,
    sessionId: q.sessionId ?? null,
    turnId: q.turnId ? `%${q.turnId}%` : null,
    eventId: q.eventId ? `%${q.eventId}%` : null,
    key: q.key ? `%${q.key}%` : null,
    platform: q.platform ?? null,
    playgroundPlatform: MCP_PLAYGROUND_PLATFORM
  };

  const baseConditions: string[] = [];
  if (params.user) baseConditions.push("user_id = @user");
  if (params.tool) baseConditions.push("tool = @tool");
  if (params.outcome) baseConditions.push("outcome = @outcome");
  if (params.since) baseConditions.push("ts >= @since");
  if (params.until) baseConditions.push("ts <= @until");
  if (params.tableSearch) baseConditions.push("tables LIKE @tableSearch");
  if (params.sessionId) baseConditions.push("lucy_session_id = @sessionId");
  if (params.key) {
    baseConditions.push("(CAST(id AS TEXT) LIKE @key OR IFNULL(lucy_turn_id, '') LIKE @key)");
  } else {
    if (params.turnId) baseConditions.push("lucy_turn_id LIKE @turnId");
    if (params.eventId) baseConditions.push("CAST(id AS TEXT) LIKE @eventId");
  }

  const callSource = q.callSource?.trim() ?? "";
  if (callSource === "playground") {
    params.platform = MCP_PLAYGROUND_PLATFORM;
    baseConditions.push("lucy_platform = @platform");
  } else if (callSource === "agent") {
    baseConditions.push("(lucy_platform IS NULL OR lucy_platform != @playgroundPlatform)");
    if (params.platform) baseConditions.push("lucy_platform = @platform");
  } else if (params.platform) {
    baseConditions.push("lucy_platform = @platform");
  }

  const includeProtocol = q.includeProtocol === "true" || callSource === "playground";
  const conditions = [...baseConditions];
  if (!includeProtocol) conditions.push(`tool NOT IN (${PROTOCOL_TOOL_LIST})`);

  return { conditions, baseConditions, params, includeProtocol };
}

// lucy_begin_question is the report call that *starts* a reported turn, not a linked business call.
const NON_LINKED_CALL_TOOL_LIST = [...PROTOCOL_TOOLS, "lucy_begin_question"].map((tool) => `'${tool}'`).join(", ");
const SENSITIVE_KEY_RE = /(?:password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)/i;
const SENSITIVE_PAIR_RE = /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)\b\s*[:=]\s*([^,\s;]+)/gi;
const CSV_FORMULA_RE = /^[=+\-@]/;
const CONFIG_AUDIT_DIFF_MAX_BYTES = 256 * 1024;

export type ConfigAuditAssetKind = "governance" | "semantic" | "wiki" | "eval" | "publish";
export type ConfigAuditActorType = "ui_admin" | "batch_job" | "system";
export type ConfigAuditWriteStatus = "pending" | "committed" | "failed";

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
  ensureColumn(db, "config_change_log", "asset_kind", "TEXT NOT NULL DEFAULT 'governance'");
  ensureColumn(db, "config_change_log", "operation", "TEXT");
  ensureColumn(db, "config_change_log", "actor_type", "TEXT NOT NULL DEFAULT 'ui_admin'");
  ensureColumn(db, "config_change_log", "source", "TEXT");
  ensureColumn(db, "config_change_log", "idempotency_key", "TEXT");
  ensureColumn(db, "config_change_log", "write_status", "TEXT NOT NULL DEFAULT 'committed'");
  ensureColumn(db, "config_change_log", "error_reason", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ccl_asset_kind_ts ON config_change_log(asset_kind, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_idempotency ON config_change_log(idempotency_key);
  `);
  // 202608-01 Trace / Evidence Kernel — append-only event store for MCP trace,
  // policy decisions, and reviewer evidence refs. Schema is idempotent so
  // first-touch and existing databases both end up with the same shape.
  ensureTraceEvidenceSchema(db);
  return db;
}

export function resetAuditDbForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export async function recordConfigChange(input: {
  filePath: string;
  changeType: string;
  actor?: string;
  actorType?: ConfigAuditActorType;
  source?: string;
  assetKind?: ConfigAuditAssetKind;
  operation?: string;
  writeStatus?: ConfigAuditWriteStatus;
  errorReason?: string;
  idempotencyKey?: string;
  targetId?: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
  requestId?: string;
  sessionId?: string | null;
}): Promise<number | undefined> {
  const database = await getAuditDb();
  const oldSummaryJson = input.oldSummary === undefined ? null : JSON.stringify(input.oldSummary);
  const newSummaryJson = input.newSummary === undefined ? null : JSON.stringify(input.newSummary);
  const safeDiff = input.diff
    ? Buffer.byteLength(input.diff, "utf8") > CONFIG_AUDIT_DIFF_MAX_BYTES
      ? `${input.diff.slice(0, CONFIG_AUDIT_DIFF_MAX_BYTES)}\n...[TRUNCATED]`
      : input.diff
    : null;
  const stableIdempotencyKey = input.idempotencyKey ?? createHash("sha256").update(
    JSON.stringify({
      requestId: input.requestId ?? null,
      filePath: input.filePath,
      changeType: input.changeType,
      targetId: input.targetId ?? null,
      actor: input.actor ?? "local-admin",
      actorType: input.actorType ?? "ui_admin",
      source: input.source ?? null,
      assetKind: input.assetKind ?? "governance",
      operation: input.operation ?? null,
      writeStatus: input.writeStatus ?? "committed",
      sessionId: input.sessionId ?? null,
      oldSummary: oldSummaryJson,
      newSummary: newSummaryJson,
      diff: safeDiff
    })
  ).digest("hex");

  const result = database.prepare(`
    INSERT INTO config_change_log
      (ts, actor, actor_type, source, session_id, file_path, change_type, asset_kind, operation, target_id, old_summary, new_summary, diff, request_id, idempotency_key, write_status, error_reason)
    VALUES
      (@ts, @actor, @actor_type, @source, @session_id, @file_path, @change_type, @asset_kind, @operation, @target_id, @old_summary, @new_summary, @diff, @request_id, @idempotency_key, @write_status, @error_reason)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run({
    ts: new Date().toISOString(),
    actor: input.actor ?? "local-admin",
    actor_type: input.actorType ?? "ui_admin",
    source: input.source ?? null,
    session_id: input.sessionId ?? null,
    file_path: input.filePath,
    change_type: input.changeType,
    asset_kind: input.assetKind ?? "governance",
    operation: input.operation ?? null,
    target_id: input.targetId ?? null,
    old_summary: oldSummaryJson,
    new_summary: newSummaryJson,
    diff: safeDiff,
    request_id: input.requestId ?? null,
    idempotency_key: stableIdempotencyKey,
    write_status: input.writeStatus ?? "committed",
    error_reason: input.errorReason ?? null
  });
  if (typeof result.lastInsertRowid === "number" && result.lastInsertRowid > 0) return result.lastInsertRowid;
  const existing = database.prepare(
    "SELECT id FROM config_change_log WHERE idempotency_key = ? LIMIT 1"
  ).get(stableIdempotencyKey) as { id: number } | undefined;
  return existing?.id;
}

export async function updateConfigChangeStatus(input: {
  id: number;
  writeStatus: ConfigAuditWriteStatus;
  errorReason?: string;
  diff?: string | null;
  oldSummary?: unknown;
  newSummary?: unknown;
}): Promise<void> {
  const database = await getAuditDb();
  const safeDiff = input.diff
    ? Buffer.byteLength(input.diff, "utf8") > CONFIG_AUDIT_DIFF_MAX_BYTES
      ? `${input.diff.slice(0, CONFIG_AUDIT_DIFF_MAX_BYTES)}\n...[TRUNCATED]`
      : input.diff
    : input.diff ?? null;
  database.prepare(`
    UPDATE config_change_log
    SET write_status = @write_status,
        error_reason = @error_reason,
        diff = COALESCE(@diff, diff),
        old_summary = COALESCE(@old_summary, old_summary),
        new_summary = COALESCE(@new_summary, new_summary)
    WHERE id = @id
  `).run({
    id: input.id,
    write_status: input.writeStatus,
    error_reason: input.errorReason ?? null,
    diff: safeDiff,
    old_summary: input.oldSummary === undefined ? null : JSON.stringify(input.oldSummary),
    new_summary: input.newSummary === undefined ? null : JSON.stringify(input.newSummary)
  });
}

interface QueryRow {
  id: number;
  ts: string;
  user_id: string;
  token_label: string | null;
  token_hash_prefix: string | null;
  lucy_session_id: string | null;
  lucy_turn_id: string | null;
  lucy_platform: string | null;
  client: string | null;
  tool: string;
  tables: string | null;
  args_summary: string | null;
  query_hash: string | null;
  query_length: number | null;
  query_operation: string | null;
  query_preview: string | null;
  outcome: string;
  error_detail: string | null;
  duration_ms: number;
  response_bytes: number | null;
  response_row_count: number | null;
  response_column_count: number | null;
  response_truncated: number | null;
  request_id: string;
  trace_id: string | null;
  role_ids: string | null;
  permission_snapshot_hash: string | null;
  effective_tables_count: number | null;
  decision_reason: string | null;
}

interface TurnOutcomeSummary {
  ok: number;
  denied: number;
  error: number;
}

interface TurnEntry {
  id: string;
  source: "inferred" | "reported";
  userId: string;
  startedAt: string;
  endedAt: string;
  businessCallCount: number;
  questionSummary?: string;
  questionPreview?: string;
  confidence: string;
  tools: string[];
  sources: Array<{ connectionId?: string; schema?: string; sourceName?: string; physicalTable: string }>;
  turnSpanMs?: number;
  totalCallDurationMs?: number;
  maxCallDurationMs?: number;
  slowCallCount?: number;
  outcomeSummary?: TurnOutcomeSummary;
}

function sinceIsoFromHours(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function parseWindowHours(raw: string | undefined): 24 | 168 {
  return raw === "24" ? 24 : 168;
}

/** True p95 over all window rows — same algorithm as governance-observability. */
function queryP95LatencyMs(database: Database.Database, hours: number): number {
  const since = sinceIsoFromHours(hours);
  const countRow = database.prepare(`SELECT COUNT(*) AS count FROM access_log WHERE ts >= ?`).get(since) as { count: number };
  const count = countRow?.count ?? 0;
  if (count <= 0) return 0;
  const offset = Math.min(count - 1, Math.ceil(count * 0.95) - 1);
  const row = database
    .prepare(`SELECT duration_ms FROM access_log WHERE ts >= ? ORDER BY duration_ms ASC LIMIT 1 OFFSET ?`)
    .get(since, offset) as { duration_ms: number } | undefined;
  return row?.duration_ms ?? 0;
}

function turnSpanMs(startedAt: string, endedAt: string): number {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime());
}

function loadAccessLogMetrics(
  database: Database.Database,
  accessLogIds: number[],
  p95Ms: number
): {
  totalCallDurationMs: number;
  maxCallDurationMs: number;
  slowCallCount: number;
  outcomeSummary: TurnOutcomeSummary;
} {
  const empty = { totalCallDurationMs: 0, maxCallDurationMs: 0, slowCallCount: 0, outcomeSummary: { ok: 0, denied: 0, error: 0 } };
  if (accessLogIds.length === 0) return empty;
  const placeholders = accessLogIds.map(() => "?").join(",");
  const rows = database
    .prepare(`SELECT outcome, duration_ms FROM access_log WHERE id IN (${placeholders})`)
    .all(...accessLogIds) as Array<{ outcome: string; duration_ms: number }>;
  let totalCallDurationMs = 0;
  let maxCallDurationMs = 0;
  let slowCallCount = 0;
  const outcomeSummary: TurnOutcomeSummary = { ok: 0, denied: 0, error: 0 };
  for (const row of rows) {
    totalCallDurationMs += row.duration_ms;
    maxCallDurationMs = Math.max(maxCallDurationMs, row.duration_ms);
    if (p95Ms > 0 && row.duration_ms > p95Ms) slowCallCount += 1;
    if (row.outcome === "ok") outcomeSummary.ok += 1;
    else if (row.outcome === "denied") outcomeSummary.denied += 1;
    else if (row.outcome === "error") outcomeSummary.error += 1;
  }
  return { totalCallDurationMs, maxCallDurationMs, slowCallCount, outcomeSummary };
}

function listTurnAccessLogIds(database: Database.Database, entry: TurnEntry): number[] {
  if (entry.source === "inferred") {
    const links = database
      .prepare(`SELECT access_log_id FROM inferred_turn_access_logs WHERE inferred_turn_id = ?`)
      .all(entry.id) as Array<{ access_log_id: number }>;
    return links.map((link) => link.access_log_id);
  }
  const rows = database
    .prepare(`SELECT id FROM access_log WHERE lucy_turn_id = ? AND tool NOT IN (${NON_LINKED_CALL_TOOL_LIST}) ORDER BY ts ASC`)
    .all(entry.id) as Array<{ id: number }>;
  return rows.map((row) => row.id);
}

function enrichTurnEntry(database: Database.Database, entry: TurnEntry, p95Ms: number): TurnEntry {
  const accessLogIds = listTurnAccessLogIds(database, entry);
  const metrics = loadAccessLogMetrics(database, accessLogIds, p95Ms);
  return {
    ...entry,
    turnSpanMs: turnSpanMs(entry.startedAt, entry.endedAt),
    ...metrics
  };
}

function countSlowCallsForFilter(
  database: Database.Database,
  since: string | null,
  p95Ms: number,
  user: string | null
): number {
  if (p95Ms <= 0) return 0;
  const conditions = ["ts >= ?", "duration_ms > ?"];
  const params: Array<string | number> = [since ?? sinceIsoFromHours(168), p95Ms];
  if (user) {
    conditions.push("user_id = ?");
    params.push(user);
  }
  const row = database
    .prepare(`SELECT COUNT(*) AS cnt FROM access_log WHERE ${conditions.join(" AND ")}`)
    .get(...params) as { cnt: number };
  return row?.cnt ?? 0;
}

export function registerAuditRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      targetId?: string;
      filePath?: string;
      assetKind?: string;
      changeType?: string;
      source?: string;
      since?: string;
      until?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/config-audit", async (request) => {
    const q = request.query;
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;
    const database = await getAuditDb();
    const conditions: string[] = [];
    const params: Record<string, string | null> = {
      targetId: q.targetId ?? null,
      filePath: q.filePath ? `%${q.filePath}%` : null,
      assetKind: q.assetKind ?? null,
      changeType: q.changeType ?? null,
      source: q.source ?? null,
      since: q.since ?? null,
      until: q.until ?? null
    };
    if (params.targetId) conditions.push("target_id = @targetId");
    if (params.filePath) conditions.push("file_path LIKE @filePath");
    if (params.assetKind) conditions.push("asset_kind = @assetKind");
    if (params.changeType) conditions.push("change_type = @changeType");
    if (params.source) conditions.push("source = @source");
    if (params.since) conditions.push("ts >= @since");
    if (params.until) conditions.push("ts <= @until");
    conditions.push("write_status = 'committed'");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const total = database.prepare(`SELECT COUNT(*) AS cnt FROM config_change_log ${where}`).get(params) as { cnt: number };
    const rows = database.prepare(`
      SELECT id, ts, actor, actor_type, source, session_id, file_path, change_type, asset_kind, operation, target_id, old_summary, new_summary, diff, request_id, write_status
      FROM config_change_log ${where}
      ORDER BY ts DESC
      LIMIT ${limit} OFFSET ${offset}
    `).all(params) as Array<{
      id: number;
      ts: string;
      actor: string;
      actor_type: string;
      source: string | null;
      session_id: string | null;
      file_path: string;
      change_type: string;
      asset_kind: ConfigAuditAssetKind;
      operation: string | null;
      target_id: string | null;
      old_summary: string | null;
      new_summary: string | null;
      diff: string | null;
      request_id: string | null;
      write_status: ConfigAuditWriteStatus;
    }>;

    return {
      ok: true,
      data: {
        total: total.cnt,
        actorMode: "single_local_admin",
        actorNotice: "当前为单管理员模式，actor=local-admin 仅表示本机管理入口，不具备多人问责语义。",
        entries: rows.map((row) => ({
          id: row.id,
          ts: row.ts,
          actor: row.actor,
          actorType: row.actor_type as ConfigAuditActorType,
          source: row.source ?? undefined,
          sessionId: row.session_id ?? undefined,
          filePath: row.file_path,
          changeType: row.change_type,
          assetKind: row.asset_kind,
          operation: row.operation ?? undefined,
          targetId: row.target_id ?? undefined,
          oldSummary: row.old_summary ? JSON.parse(row.old_summary) : undefined,
          newSummary: row.new_summary ? JSON.parse(row.new_summary) : undefined,
          diff: row.diff ?? undefined,
          requestId: row.request_id ?? undefined,
          writeStatus: row.write_status
        }))
      }
    };
  });

  app.get<{
    Querystring: {
      targetId?: string;
      filePath?: string;
      assetKind?: string;
      changeType?: string;
      source?: string;
      since?: string;
      until?: string;
    };
  }>("/api/admin/config-audit/export.csv", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();
    const conditions: string[] = [];
    const params: Record<string, string | null> = {
      targetId: q.targetId ?? null,
      filePath: q.filePath ? `%${q.filePath}%` : null,
      assetKind: q.assetKind ?? null,
      changeType: q.changeType ?? null,
      source: q.source ?? null,
      since: q.since ?? null,
      until: q.until ?? null
    };
    if (params.targetId) conditions.push("target_id = @targetId");
    if (params.filePath) conditions.push("file_path LIKE @filePath");
    if (params.assetKind) conditions.push("asset_kind = @assetKind");
    if (params.changeType) conditions.push("change_type = @changeType");
    if (params.source) conditions.push("source = @source");
    if (params.since) conditions.push("ts >= @since");
    if (params.until) conditions.push("ts <= @until");
    conditions.push("write_status = 'committed'");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database.prepare(`
      SELECT ts, actor, source, file_path, change_type, asset_kind, target_id
      FROM config_change_log ${where}
      ORDER BY ts DESC
    `).all(params) as Array<{
      ts: string;
      actor: string;
      source: string | null;
      file_path: string;
      change_type: string;
      asset_kind: ConfigAuditAssetKind;
      target_id: string | null;
    }>;

    const dateStr = formatConfigAuditExportFilenameStamp();
    const csvLines = [
      CONFIG_AUDIT_CSV_HEADERS.join(","),
      ...rows.map((row) =>
        [
          csvCell(formatConfigAuditTs(row.ts)),
          csvCell(actorLabel(row.actor)),
          csvCell(sourceLabel(row.source)),
          csvCell(assetKindLabel(row.asset_kind)),
          csvCell(changeTypeLabel(row.change_type)),
          csvCell(targetLabel(row.target_id)),
          csvCell(row.file_path)
        ].join(",")
      )
    ];

    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="config-audit-${dateStr}.csv"`);
    return reply.send(`\uFEFF${csvLines.join("\n")}`);
  });

  app.get("/api/admin/audit/sources", async () => {
    const database = await getAuditDb();
    const rows = database.prepare(`
      SELECT tables, outcome
      FROM access_log
      WHERE tool NOT IN (${PROTOCOL_TOOL_LIST}) AND tables IS NOT NULL
    `).all() as Array<{ tables: string | null; outcome: string }>;
    const connections = new Map<string, number>();
    const schemas = new Map<string, number>();
    const tables = new Map<string, { table: string; calls: number; denied: number }>();

    for (const row of rows) {
      if (!row.tables) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.tables);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) {
        if (typeof item !== "string" || !item) continue;
        const parts = item.split(".");
        const schema = parts.length >= 2 ? parts[0] : "unknown";
        const table = parts.length >= 2 ? parts.slice(1).join(".") : item;
        connections.set("audit-derived", (connections.get("audit-derived") ?? 0) + 1);
        schemas.set(schema, (schemas.get(schema) ?? 0) + 1);
        const existing = tables.get(item) ?? { table: item, calls: 0, denied: 0 };
        existing.calls += 1;
        if (row.outcome === "denied") existing.denied += 1;
        tables.set(item, existing);
      }
    }

    const byCount = <T extends { calls: number }>(items: T[]) => items.sort((a, b) => b.calls - a.calls);
    return {
      ok: true,
      data: {
        connections: [...connections.entries()].map(([connection, calls]) => ({ connection, calls })),
        schemas: [...schemas.entries()].map(([schema, calls]) => ({ schema, calls })).sort((a, b) => b.calls - a.calls),
        topTables: byCount([...tables.values()]).slice(0, 50),
        deniedTables: [...tables.values()].filter((item) => item.denied > 0).sort((a, b) => b.denied - a.denied).slice(0, 50)
      }
    };
  });

  // GET /api/admin/audit/:id/sources — per-log-row source detail (distinct from the
  // aggregate GET /api/admin/audit/sources above, which summarizes across all rows).
  app.get<{ Params: { id: string } }>("/api/admin/audit/:id/sources", async (request, reply) => {
    const accessLogId = Number(request.params.id);
    if (!Number.isInteger(accessLogId) || accessLogId <= 0) {
      reply.code(400);
      return { ok: false, error: "invalid id" };
    }
    const database = await getAuditDb();
    const rows = database.prepare(`
      SELECT id, access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
             physical_table, extraction_method, confidence, created_at
      FROM access_log_sources
      WHERE access_log_id = ?
      ORDER BY id ASC
    `).all(accessLogId) as Array<{
      id: number;
      access_log_id: number;
      ts: string;
      user_id: string;
      tool: string;
      connection_id: string | null;
      schema_name: string | null;
      source_name: string | null;
      physical_table: string;
      extraction_method: string;
      confidence: string;
      created_at: string;
    }>;

    return {
      ok: true,
      data: {
        accessLogId,
        sources: rows.map((row) => ({
          id: row.id,
          ts: row.ts,
          userId: row.user_id,
          tool: row.tool,
          connectionId: row.connection_id,
          schemaName: row.schema_name,
          sourceName: row.source_name,
          physicalTable: row.physical_table,
          extractionMethod: row.extraction_method,
          confidence: row.confidence,
          createdAt: row.created_at
        }))
      }
    };
  });

  // GET /api/admin/audit
  app.get<{
    Querystring: AccessLogFilterQuery & {
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/audit", async (request) => {
    const q = request.query;
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;

    const database = await getAuditDb();
    const { conditions, baseConditions, params } = buildAccessLogFilter(q);
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
      lucySessionId: row.lucy_session_id ?? undefined,
      lucyTurnId: row.lucy_turn_id ?? undefined,
      lucyPlatform: row.lucy_platform ?? undefined,
      client: row.client ?? undefined,
      tool: row.tool,
      tables: row.tables ? (JSON.parse(row.tables) as string[]) : undefined,
      argsSummary: row.args_summary ? (redactSensitive(JSON.parse(row.args_summary)) as Record<string, unknown>) : undefined,
      queryHash: row.query_hash ?? undefined,
      queryLength: row.query_length ?? undefined,
      queryOperation: row.query_operation ?? undefined,
      queryPreview: row.query_preview ?? undefined,
      outcome: row.outcome as "ok" | "error" | "denied",
      errorDetail: row.error_detail ? redactJsonString(row.error_detail) ?? undefined : undefined,
      durationMs: row.duration_ms,
      responseBytes: row.response_bytes ?? undefined,
      responseRowCount: row.response_row_count ?? undefined,
      responseColumnCount: row.response_column_count ?? undefined,
      responseTruncated: row.response_truncated === null ? undefined : row.response_truncated === 1,
      requestId: row.request_id,
      traceId: row.trace_id ?? undefined,
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
    Querystring: AccessLogFilterQuery;
  }>("/api/admin/audit/export", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();
    const { conditions, params } = buildAccessLogFilter(q);

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
      "lucy_session_id",
      "lucy_turn_id",
      "lucy_platform",
      "client",
      "tool",
      "tables",
      "args_summary",
      "query_hash",
      "query_length",
      "query_operation",
      "query_preview",
      "outcome",
      "error_detail",
      "duration_ms",
      "response_bytes",
      "response_row_count",
      "response_column_count",
      "response_truncated",
      "request_id",
      "trace_id",
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
          csvCell(row.lucy_session_id),
          csvCell(row.lucy_turn_id),
          csvCell(row.lucy_platform),
          csvCell(row.client),
          csvCell(row.tool),
          csvCell(row.tables),
          csvCell(redactJsonString(row.args_summary)),
          csvCell(row.query_hash),
          row.query_length ?? "",
          csvCell(row.query_operation),
          csvCell(row.query_preview),
          csvCell(row.outcome),
          csvCell(redactJsonString(row.error_detail)),
          row.duration_ms,
          row.response_bytes ?? "",
          row.response_row_count ?? "",
          row.response_column_count ?? "",
          row.response_truncated === null ? "" : row.response_truncated,
          csvCell(row.request_id),
          csvCell(row.trace_id),
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

  // GET /api/admin/audit/turns — unified "question cluster" view: inferred (Phase 2)
  // + reported (Phase 3), per spec 08 §9.1.
  app.get<{
    Querystring: {
      user?: string;
      since?: string;
      until?: string;
      source?: string;
      turnId?: string;
      tableSearch?: string;
      outcome?: string;
      q?: string;
      lookbackHours?: string;
      hours?: string;
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/audit/turns", async (request) => {
    const q = request.query;
    const source = q.source === "inferred" || q.source === "reported" ? q.source : "all";
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;
    const windowHours = parseWindowHours(q.hours);
    const lookbackHours = q.lookbackHours ? parseInt(q.lookbackHours, 10) : windowHours;
    const turnIdNeedle = (q.turnId ?? "").trim().toLowerCase();
    const tableNeedle = (q.tableSearch ?? "").trim().toLowerCase();
    const summaryNeedle = (q.q ?? "").trim().toLowerCase();
    const outcomeFilter = q.outcome === "ok" || q.outcome === "error" || q.outcome === "denied" ? q.outcome : "";

    const database = await getAuditDb();
    const p95Ms = queryP95LatencyMs(database, windowHours);
    const sinceDefault = sinceIsoFromHours(windowHours);

    if (source !== "reported") {
      const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
      const targetUsers = q.user
        ? [q.user]
        : (database.prepare(`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`).all(cutoff) as Array<{ user_id: string }>).map((row) => row.user_id);
      for (const userId of targetUsers) {
        await rebuildInferredTurnsDebounced(userId, lookbackHours ? { lookbackHours } : undefined);
      }
    }

    const entries: TurnEntry[] = [];

    if (source === "inferred" || source === "all") {
      const conditions: string[] = [];
      const params: Record<string, string | null> = {
        user: q.user ?? null,
        since: q.since ?? sinceDefault,
        until: q.until ?? null
      };
      if (params.user) conditions.push("user_id = @user");
      if (params.since) conditions.push("started_at >= @since");
      if (params.until) conditions.push("started_at <= @until");
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = database.prepare(`SELECT * FROM inferred_turns ${where} ORDER BY started_at DESC`).all(params) as Array<{
        inferred_turn_id: string;
        user_id: string;
        started_at: string;
        ended_at: string;
        business_call_count: number;
        tool_summary: string;
        source_summary: string;
        question_summary: string | null;
        confidence: string;
      }>;
      for (const row of rows) {
        entries.push(
          enrichTurnEntry(database, {
            id: row.inferred_turn_id,
            source: "inferred",
            userId: row.user_id,
            startedAt: row.started_at,
            endedAt: row.ended_at,
            businessCallCount: row.business_call_count,
            questionSummary: row.question_summary ?? undefined,
            confidence: row.confidence,
            tools: JSON.parse(row.tool_summary) as string[],
            sources: JSON.parse(row.source_summary) as TurnEntry["sources"]
          }, p95Ms)
        );
      }
    }

    if (source === "reported" || source === "all") {
      const conditions: string[] = [];
      const params: Record<string, string | null> = {
        user: q.user ?? null,
        since: q.since ?? sinceDefault,
        until: q.until ?? null
      };
      if (params.user) conditions.push("user_id = @user");
      if (params.since) conditions.push("created_at >= @since");
      if (params.until) conditions.push("created_at <= @until");
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const rows = database.prepare(`SELECT * FROM conversation_turns ${where} ORDER BY created_at DESC`).all(params) as Array<{
        turn_id: string;
        user_id: string;
        created_at: string;
        question_summary: string | null;
        question_preview: string | null;
      }>;
      for (const row of rows) {
        const linked = database.prepare(`
          SELECT id, ts, tool FROM access_log WHERE lucy_turn_id = ? AND tool NOT IN (${NON_LINKED_CALL_TOOL_LIST}) ORDER BY ts ASC
        `).all(row.turn_id) as Array<{ id: number; ts: string; tool: string }>;
        const accessLogIds = linked.map((l) => l.id);
        const sourceRows = accessLogIds.length > 0
          ? database.prepare(`
              SELECT DISTINCT connection_id, schema_name, source_name, physical_table
              FROM access_log_sources WHERE access_log_id IN (${accessLogIds.map(() => "?").join(",")})
            `).all(...accessLogIds) as Array<{ connection_id: string | null; schema_name: string | null; source_name: string | null; physical_table: string }>
          : [];
        entries.push(
          enrichTurnEntry(database, {
            id: row.turn_id,
            source: "reported",
            userId: row.user_id,
            startedAt: row.created_at,
            endedAt: linked.length > 0 ? linked[linked.length - 1].ts : row.created_at,
            businessCallCount: linked.length,
            questionSummary: row.question_summary ?? undefined,
            questionPreview: row.question_preview ?? undefined,
            confidence: "high",
            tools: [...new Set(linked.map((l) => l.tool))],
            sources: sourceRows.map((s) => ({
              connectionId: s.connection_id ?? undefined,
              schema: s.schema_name ?? undefined,
              sourceName: s.source_name ?? undefined,
              physicalTable: s.physical_table
            }))
          }, p95Ms)
        );
      }
    }

    entries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));

    const filtered = entries.filter((entry) => {
      if (turnIdNeedle && !entry.id.toLowerCase().includes(turnIdNeedle)) return false;
      if (tableNeedle) {
        const hay = entry.sources.map((s) => s.physicalTable).join(" ").toLowerCase();
        if (!hay.includes(tableNeedle)) return false;
      }
      if (summaryNeedle) {
        const hay = [entry.questionSummary, entry.questionPreview, entry.userId, entry.sources.map((s) => s.physicalTable).join(" ")]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(summaryNeedle)) return false;
      }
      if (outcomeFilter === "ok") {
        const denied = entry.outcomeSummary?.denied ?? 0;
        const errors = entry.outcomeSummary?.error ?? 0;
        if (denied > 0 || errors > 0) return false;
      } else if (outcomeFilter === "denied") {
        if ((entry.outcomeSummary?.denied ?? 0) <= 0) return false;
      } else if (outcomeFilter === "error") {
        if ((entry.outcomeSummary?.error ?? 0) <= 0) return false;
      }
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice(offset, offset + limit);
    const slowCallsInFilter = countSlowCallsForFilter(database, q.since ?? sinceDefault, p95Ms, q.user ?? null);
    const totalCallsRow = database
      .prepare(`SELECT COUNT(*) AS cnt FROM access_log WHERE ts >= ?`)
      .get(sinceDefault) as { cnt: number };

    return {
      ok: true,
      data: {
        total,
        entries: paged,
        referenceLatency: {
          windowHours,
          p95Ms,
          totalCallsInWindow: totalCallsRow?.cnt ?? 0,
          slowCallsInFilter
        }
      }
    };
  });

  // GET /api/admin/audit/turns/:turnId — single turn detail (inferred or reported).
  app.get<{ Params: { turnId: string }; Querystring: { hours?: string } }>("/api/admin/audit/turns/:turnId", async (request, reply) => {
    const { turnId } = request.params;
    const windowHours = parseWindowHours(request.query.hours);
    const database = await getAuditDb();
    const p95Ms = queryP95LatencyMs(database, windowHours);

    const mapAccessLogRow = (
      row: {
        id: number;
        ts: string;
        tool: string;
        outcome: string;
        decision_reason: string | null;
        duration_ms: number;
        trace_id: string | null;
        tables: string | null;
      },
      connectionByLogId: Map<number, string>
    ) => ({
      id: row.id,
      ts: row.ts,
      tool: row.tool,
      outcome: row.outcome,
      decisionReason: row.decision_reason ?? undefined,
      durationMs: row.duration_ms,
      isSlowCall: p95Ms > 0 && row.duration_ms > p95Ms,
      traceId: row.trace_id ?? undefined,
      tables: row.tables ? (JSON.parse(row.tables) as string[]) : undefined,
      connectionId: connectionByLogId.get(row.id)
    });

    const connectionByLogId = (ids: number[]): Map<number, string> => {
      const map = new Map<number, string>();
      if (ids.length === 0) return map;
      const rows = database.prepare(`
        SELECT access_log_id, connection_id FROM access_log_sources
        WHERE access_log_id IN (${ids.map(() => "?").join(",")}) AND connection_id IS NOT NULL
        GROUP BY access_log_id
      `).all(...ids) as Array<{ access_log_id: number; connection_id: string }>;
      for (const row of rows) {
        if (!map.has(row.access_log_id)) map.set(row.access_log_id, row.connection_id);
      }
      return map;
    };

    if (turnId.startsWith("inf_")) {
      const row = database.prepare(`SELECT * FROM inferred_turns WHERE inferred_turn_id = ?`).get(turnId) as Record<string, unknown> | undefined;
      if (!row) {
        reply.code(404);
        return { ok: false, error: "not found" };
      }
      const links = database.prepare(`SELECT access_log_id FROM inferred_turn_access_logs WHERE inferred_turn_id = ?`).all(turnId) as Array<{ access_log_id: number }>;
      const accessLogIds = links.map((l) => l.access_log_id);
      const accessLogs = accessLogIds.length > 0
        ? database.prepare(`
            SELECT id, ts, tool, outcome, decision_reason, duration_ms, trace_id, tables
            FROM access_log WHERE id IN (${accessLogIds.map(() => "?").join(",")}) ORDER BY ts ASC
          `).all(...accessLogIds) as Array<{
            id: number;
            ts: string;
            tool: string;
            outcome: string;
            decision_reason: string | null;
            duration_ms: number;
            trace_id: string | null;
            tables: string | null;
          }>
        : [];
      const connMap = connectionByLogId(accessLogIds);
      return {
        ok: true,
        data: {
          id: row.inferred_turn_id,
          source: "inferred",
          userId: row.user_id,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          callCount: row.call_count,
          businessCallCount: row.business_call_count,
          confidence: row.confidence,
          tools: JSON.parse(row.tool_summary as string),
          sources: JSON.parse(row.source_summary as string),
          questionSummary: row.question_summary,
          evidence: JSON.parse(row.evidence_json as string),
          accessLogs: accessLogs.map((logRow) => mapAccessLogRow(logRow, connMap)),
          referenceLatency: { windowHours, p95Ms }
        }
      };
    }

    const row = database.prepare(`SELECT * FROM conversation_turns WHERE turn_id = ?`).get(turnId) as Record<string, unknown> | undefined;
    if (!row) {
      reply.code(404);
      return { ok: false, error: "not found" };
    }
    const accessLogs = database.prepare(`
      SELECT id, ts, tool, outcome, decision_reason, duration_ms, trace_id, tables FROM access_log
      WHERE lucy_turn_id = ? AND tool NOT IN (${NON_LINKED_CALL_TOOL_LIST})
      ORDER BY ts ASC
    `).all(turnId) as Array<{
      id: number;
      ts: string;
      tool: string;
      outcome: string;
      decision_reason: string | null;
      duration_ms: number;
      trace_id: string | null;
      tables: string | null;
    }>;
    const accessLogIds = accessLogs.map((l) => l.id);
    const sources = accessLogIds.length > 0
      ? database.prepare(`SELECT DISTINCT connection_id, schema_name, source_name, physical_table FROM access_log_sources WHERE access_log_id IN (${accessLogIds.map(() => "?").join(",")})`).all(...accessLogIds)
      : [];
    const connMap = connectionByLogId(accessLogIds);
    return {
      ok: true,
      data: {
        id: row.turn_id,
        source: "reported",
        userId: row.user_id,
        questionSummary: row.question_summary,
        questionPreview: row.question_preview,
        questionSource: row.question_source,
        createdAt: row.created_at,
        accessLogs: accessLogs.map((logRow) => mapAccessLogRow(logRow, connMap)),
        sources,
        referenceLatency: { windowHours, p95Ms }
      }
    };
  });

  // POST /api/admin/audit/conversation-turns/purge — manual retention trigger (spec §8.4).
  app.post<{ Body: { retentionDays?: number; dryRun?: boolean } }>("/api/admin/audit/conversation-turns/purge", async (request) => {
    const body = request.body ?? {};
    const result = await purgeExpiredConversationTurns({ retentionDays: body.retentionDays, dryRun: body.dryRun });
    return { ok: true, data: result };
  });

  // ─── 202608-01 Trace / Evidence Kernel — read-only admin API ────────────
  // The kernel is append-only; this surface is intentionally minimal so it
  // doesn't accidentally become a write path. It only exposes ordered spans
  // and evidence refs for a single trace / turn, with sensitive fields
  // already redacted by `sanitizeMetadata` at write time.
  app.get<{
    Querystring: { traceId?: string; turnId?: string; spanType?: string; status?: string; limit?: string };
  }>("/api/admin/trace/events", async (request, reply) => {
    const q = request.query;
    if (!q.traceId && !q.turnId) {
      reply.code(400);
      return { ok: false, error: "traceId or turnId is required" };
    }
    const filter: ListTraceEventsFilter = {};
    if (q.traceId) filter.traceId = q.traceId;
    if (q.turnId) filter.turnId = q.turnId;
    if (q.spanType) filter.spanType = q.spanType as LucySpanType;
    if (q.status) filter.status = q.status as LucySpanStatus;
    if (q.limit) {
      const parsed = Number.parseInt(q.limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) filter.limit = parsed;
    }
    const database = await getAuditDb();
    const { events, evidence } = listTraceEvents(database, filter);
    return {
      ok: true,
      data: {
        events: events.map(serializeTraceEvent),
        evidence: evidence.map(serializeEvidenceEvent)
      }
    };
  });
}

function serializeTraceEvent(row: TraceEventRow) {
  return {
    id: row.id,
    traceId: row.traceId,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId ?? undefined,
    spanType: row.spanType,
    actorKind: row.actorKind,
    actorId: row.actorId ?? undefined,
    status: row.status,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? undefined,
    sessionId: row.sessionId ?? undefined,
    turnId: row.turnId ?? undefined,
    requestId: row.requestId ?? undefined,
    policyDecision: row.policyDecision ?? undefined,
    artifactHashes: row.artifactHashes,
    metadata: row.metadata,
    createdAt: row.createdAt
  };
}

function serializeEvidenceEvent(row: EvidenceEventRow) {
  return {
    id: row.id,
    traceEventId: row.traceEventId ?? undefined,
    traceId: row.traceId,
    evidenceKind: row.evidenceKind,
    evidenceRef: row.evidenceRef,
    evidenceVersion: row.evidenceVersion ?? undefined,
    evidenceHash: row.evidenceHash ?? undefined,
    relation: row.relation,
    reviewer: row.reviewer ?? undefined,
    metadata: row.metadata,
    createdAt: row.createdAt
  };
}
