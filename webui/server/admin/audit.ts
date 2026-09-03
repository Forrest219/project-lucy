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
import { rebuildInferredTurns, purgeExpiredConversationTurns, scrubAccessLogArgsSummaries } from "../proxy/audit.js";
import { buildStoredZip, sha256Hex } from "../proxy/zip-store.js";
import { MCP_PLAYGROUND_PLATFORM } from "./mcp-playground.js";
import { resolveLucyVersion } from "../lucy-version.js";
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
import { readQueryArtifact } from "../audit/query-artifact-store.js";

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
  ["turn_attribution_mode", "TEXT"],
  ["turn_attribution_confidence", "TEXT"],
  ["turn_attribution_reason", "TEXT"],
  ["lucy_platform", "TEXT"],
  ["query_hash", "TEXT"],
  ["query_length", "INTEGER"],
  ["query_operation", "TEXT"],
  ["query_preview", "TEXT"],
  ["query_artifact_ref", "TEXT"],
  ["generated_sql", "TEXT"],
  ["response_bytes", "INTEGER"],
  ["response_row_count", "INTEGER"],
  ["response_column_count", "INTEGER"],
  ["response_truncated", "INTEGER"],
  ["trace_id", "TEXT"],
  ["client_ip", "TEXT"],
  ["user_agent", "TEXT"],
  ["client_version", "TEXT"],
  ["device_name", "TEXT"],
  ["policy_version", "TEXT"],
  ["capability_digest", "TEXT"]
] as const;
const PERMISSION_SNAPSHOT_COLUMNS = [
  ["capability_digest", "TEXT"],
  ["tool_classification_version", "TEXT"]
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
  clientIp?: string;
  deviceName?: string;
};

function auditExportMaxRows(): number {
  const configured = Number(process.env.LUCY_AUDIT_EXPORT_MAX_ROWS ?? 10_000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 10_000;
}

function auditExportMaxBytes(): number {
  const configured = Number(process.env.LUCY_AUDIT_EXPORT_MAX_BYTES ?? 64 * 1024 * 1024);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 64 * 1024 * 1024;
}

function chunksOf<T>(items: T[], size = 400): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

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
    playgroundPlatform: MCP_PLAYGROUND_PLATFORM,
    clientIp: q.clientIp ? `%${q.clientIp}%` : null,
    deviceName: q.deviceName ? `%${q.deviceName}%` : null
  };

  const baseConditions: string[] = [];
  if (params.user) baseConditions.push("user_id = @user");
  if (params.tool) baseConditions.push("tool = @tool");
  if (params.outcome) baseConditions.push("outcome = @outcome");
  if (params.since) baseConditions.push("ts >= @since");
  if (params.until) baseConditions.push("ts <= @until");
  if (params.tableSearch) baseConditions.push("tables LIKE @tableSearch");
  if (params.sessionId) baseConditions.push("lucy_session_id = @sessionId");
  if (params.clientIp) baseConditions.push("IFNULL(client_ip, '') LIKE @clientIp");
  if (params.deviceName) baseConditions.push("IFNULL(device_name, '') LIKE @deviceName");
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
const AUDIT_EXPORT_TIMEZONE = "Asia/Shanghai";
let auditExportSequence = 0;

export type ConfigAuditAssetKind = "governance" | "semantic" | "wiki" | "eval" | "publish";
export type ConfigAuditActorType = "ui_admin" | "batch_job" | "system";
export type ConfigAuditWriteStatus = "pending" | "committed" | "failed";

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function formatAuditLocalTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AUDIT_EXPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function auditExportFilename(kind: string, ext: "csv" | "json", now = new Date()): string {
  auditExportSequence = (auditExportSequence % 999_999) + 1;
  const seq = String(auditExportSequence).padStart(6, "0");
  return `audit-${kind}-${formatConfigAuditExportFilenameStamp(now)}-${seq}.${ext}`;
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
  const envDbPath = process.env.LUCY_AUDIT_DB;
  let dbPath: string;
  if (envDbPath && envDbPath.trim().length > 0) {
    // Tests and alternate audit stores can point at an explicit sqlite file
    // without requiring a resolvable ktx.yaml project root.
    dbPath = path.resolve(envDbPath);
    mkdirSync(path.dirname(dbPath), { recursive: true });
  } else {
    const projectRoot = await resolveProjectRoot();
    const dir = path.join(projectRoot, ".ktx-ui");
    mkdirSync(dir, { recursive: true });
    dbPath = path.join(dir, "audit.sqlite");
  }
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
      resolved_json TEXT NOT NULL,
      capability_digest TEXT,
      tool_classification_version TEXT
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
    CREATE TABLE IF NOT EXISTS auth_failure_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                 TEXT    NOT NULL,
      reason             TEXT    NOT NULL,
      client_ip          TEXT,
      user_agent         TEXT,
      token_hash_prefix  TEXT,
      user_id            TEXT,
      token_label        TEXT,
      request_id         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_afl_ts ON auth_failure_log(ts);
    CREATE INDEX IF NOT EXISTS idx_afl_reason_ts ON auth_failure_log(reason, ts);
    CREATE TABLE IF NOT EXISTS audit_maintenance_log (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                 TEXT    NOT NULL,
      event_type         TEXT    NOT NULL,
      actor              TEXT    NOT NULL,
      reason             TEXT    NOT NULL,
      request_id         TEXT,
      algorithm_version  TEXT    NOT NULL,
      scanned            INTEGER NOT NULL,
      matched            INTEGER NOT NULL,
      updated            INTEGER NOT NULL,
      before_digest      TEXT    NOT NULL,
      after_digest       TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_aml_ts ON audit_maintenance_log(ts);
  `);
  for (const [column, definition] of ACCESS_LOG_COLUMNS) {
    ensureColumn(db, "access_log", column, definition);
  }
  for (const [column, definition] of PERMISSION_SNAPSHOT_COLUMNS) {
    ensureColumn(db, "permission_snapshots", column, definition);
  }
  ensureColumn(db, "conversation_turns", "session_id", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
    CREATE INDEX IF NOT EXISTS idx_al_session_ts ON access_log(lucy_session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_client_ip_ts ON access_log(client_ip, ts);
  `);
  ensureColumn(db, "config_change_log", "asset_kind", "TEXT NOT NULL DEFAULT 'governance'");
  ensureColumn(db, "config_change_log", "operation", "TEXT");
  ensureColumn(db, "config_change_log", "actor_type", "TEXT NOT NULL DEFAULT 'ui_admin'");
  ensureColumn(db, "config_change_log", "source", "TEXT");
  ensureColumn(db, "config_change_log", "idempotency_key", "TEXT");
  ensureColumn(db, "config_change_log", "write_status", "TEXT NOT NULL DEFAULT 'committed'");
  ensureColumn(db, "config_change_log", "error_reason", "TEXT");
  ensureColumn(db, "config_change_log", "actor_ip", "TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ccl_asset_kind_ts ON config_change_log(asset_kind, ts);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_idempotency ON config_change_log(idempotency_key);
  `);
  // 202608-01 Trace / Evidence Kernel — append-only event store for MCP trace,
  // policy decisions, and reviewer evidence refs. Schema is idempotent so
  // first-touch and existing databases both end up with the same shape.
  ensureTraceEvidenceSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS query_artifact_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      actor TEXT NOT NULL,
      artifact_ref TEXT NOT NULL,
      request_id TEXT,
      query_hash TEXT,
      access_log_id INTEGER,
      outcome TEXT NOT NULL,
      error_detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_qaal_ts ON query_artifact_access_log(ts);
    CREATE INDEX IF NOT EXISTS idx_qaal_ref ON query_artifact_access_log(artifact_ref, ts);
  `);
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
  actorIp?: string;
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
      actorIp: input.actorIp ?? null,
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
      (ts, actor, actor_type, actor_ip, source, session_id, file_path, change_type, asset_kind, operation, target_id, old_summary, new_summary, diff, request_id, idempotency_key, write_status, error_reason)
    VALUES
      (@ts, @actor, @actor_type, @actor_ip, @source, @session_id, @file_path, @change_type, @asset_kind, @operation, @target_id, @old_summary, @new_summary, @diff, @request_id, @idempotency_key, @write_status, @error_reason)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run({
    ts: new Date().toISOString(),
    actor: input.actor ?? "local-admin",
    actor_type: input.actorType ?? "ui_admin",
    actor_ip: input.actorIp ?? null,
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
  turn_attribution_mode: string | null;
  turn_attribution_confidence: string | null;
  turn_attribution_reason: string | null;
  lucy_platform: string | null;
  client: string | null;
  client_version: string | null;
  client_ip: string | null;
  user_agent: string | null;
  device_name: string | null;
  tool: string;
  tables: string | null;
  args_summary: string | null;
  query_hash: string | null;
  query_length: number | null;
  query_operation: string | null;
  query_preview: string | null;
  query_artifact_ref: string | null;
  generated_sql: string | null;
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
  policy_version: string | null;
  capability_digest: string | null;
}

const ACCESS_LOG_CSV_HEADERS = [
  "id",
  "ts",
  "ts_local",
  "user_id",
  "token_label",
  "token_hash_prefix",
  "lucy_session_id",
  "lucy_turn_id",
  "turn_attribution_mode",
  "turn_attribution_confidence",
  "turn_attribution_reason",
  "lucy_platform",
  "client",
  "client_version",
  "client_ip",
  "user_agent",
  "device_name",
  "tool",
  "tables",
  "args_summary",
  "query_hash",
  "query_length",
  "query_operation",
  "query_preview",
  "generated_sql",
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
  "decision_reason",
  "policy_version",
  "capability_digest"
] as const;

type CsvFieldMetadata = {
  name: string;
  label: string;
  format: string;
  description: string;
  trigger: string;
};

const ACCESS_LOG_FIELD_METADATA: Record<(typeof ACCESS_LOG_CSV_HEADERS)[number], Omit<CsvFieldMetadata, "name">> = {
  id: {
    label: "事件 ID",
    format: "integer",
    description: "调用流水事件的自增 ID。",
    trigger: "每条 access_log 行均输出。"
  },
  ts: {
    label: "UTC 时间",
    format: "ISO 8601 UTC",
    description: "访问事件写入时的原始 UTC 时间，用于机器对账和跨时区复核。",
    trigger: "每条 access_log 行均输出。"
  },
  ts_local: {
    label: "本地时间",
    format: "YYYY-MM-DD HH:mm:ss",
    description: "按 Asia/Shanghai 转换后的访问事件时间，便于人工阅读和 Excel 解析。",
    trigger: "每条 access_log 行均输出。"
  },
  user_id: {
    label: "Agent",
    format: "string",
    description: "触发调用的 Agent 用户 ID。",
    trigger: "每条 access_log 行均输出。"
  },
  token_label: {
    label: "Token 标签",
    format: "string|null",
    description: "发起调用的 Token 标签。",
    trigger: "请求鉴权成功且 Token 配置含 label 时输出。"
  },
  token_hash_prefix: {
    label: "Token 哈希前缀",
    format: "string|null",
    description: "Token 哈希的安全前缀，用于定位凭证但不暴露明文。",
    trigger: "请求携带 Bearer Token 且鉴权链路可识别时输出。"
  },
  lucy_session_id: {
    label: "会话 ID",
    format: "string|null",
    description: "客户端上报或服务端归因的 Lucy 会话 ID。",
    trigger: "客户端上报会话或服务端从上下文推断到会话时输出。"
  },
  lucy_turn_id: {
    label: "问询 ID",
    format: "string|null",
    description: "关联问询记录的 ID，用于从调用流水回溯到一次用户问询。",
    trigger: "客户端上报问询或服务端完成问询归因时输出。"
  },
  turn_attribution_mode: {
    label: "问询归因方式",
    format: "string|null",
    description: "说明调用流水如何关联到问询 ID。",
    trigger: "服务端写入或修复问询归因时输出。"
  },
  turn_attribution_confidence: {
    label: "问询归因可信度",
    format: "high|medium|low|null",
    description: "问询归因结果的可信度。",
    trigger: "服务端写入或修复问询归因时输出。"
  },
  turn_attribution_reason: {
    label: "问询归因原因",
    format: "string|null",
    description: "问询归因方式的补充原因。",
    trigger: "归因逻辑需要记录解释时输出。"
  },
  lucy_platform: {
    label: "调用平台",
    format: "string|null",
    description: "客户端平台或 MCP 调试台标记。",
    trigger: "客户端上报平台或调用来自 MCP 调试台时输出。"
  },
  client: {
    label: "客户端",
    format: "string|null",
    description: "发起调用的客户端名称。",
    trigger: "客户端上报 client 时输出。"
  },
  client_version: {
    label: "客户端版本",
    format: "string|null",
    description: "发起调用的客户端版本。",
    trigger: "客户端上报版本时输出。"
  },
  client_ip: {
    label: "客户端 IP",
    format: "string|null",
    description: "服务端看到的客户端 IP。",
    trigger: "HTTP 请求可解析客户端地址时输出。"
  },
  user_agent: {
    label: "User-Agent",
    format: "string|null",
    description: "HTTP User-Agent 原文。",
    trigger: "请求携带 User-Agent 时输出。"
  },
  device_name: {
    label: "设备名",
    format: "string|null",
    description: "客户端上报的设备名。",
    trigger: "客户端上报设备名时输出。"
  },
  tool: {
    label: "工具",
    format: "string",
    description: "本次访问调用的 MCP 工具名或协议工具名。",
    trigger: "每条 access_log 行均输出。"
  },
  tables: {
    label: "数据表",
    format: "JSON string|null",
    description: "本次调用触达或声明的物理表列表。",
    trigger: "调用触达数据表或参数中可识别表名时输出。"
  },
  args_summary: {
    label: "参数摘要",
    format: "JSON string|null",
    description: "脱敏后的调用参数摘要。",
    trigger: "调用参数存在且可安全摘要时输出。"
  },
  query_hash: {
    label: "查询哈希",
    format: "sha256|null",
    description: "查询文本或问题文本的哈希。",
    trigger: "调用含查询类参数时输出。"
  },
  query_length: {
    label: "查询长度",
    format: "integer|null",
    description: "查询文本或问题文本长度。",
    trigger: "调用含查询类参数时输出。"
  },
  query_operation: {
    label: "查询操作",
    format: "select|unknown|null",
    description: "查询操作类型摘要。",
    trigger: "查询类工具可识别操作类型时输出。"
  },
  query_preview: {
    label: "查询预览",
    format: "string|null",
    description: "脱敏后的查询预览，不作为完整 SQL 证据。",
    trigger: "查询类工具可生成安全预览时输出。"
  },
  generated_sql: {
    label: "生成 SQL",
    format: "string|null",
    description: "lucy_query 经语义层编译后的 SQL。",
    trigger: "lucy_query 成功编译出 SQL 时输出。"
  },
  outcome: {
    label: "结果",
    format: "ok|denied|error",
    description: "本次工具调用的执行结果。",
    trigger: "每条 access_log 行均输出。"
  },
  error_detail: {
    label: "错误详情",
    format: "JSON string|string|null",
    description: "脱敏后的错误详情。",
    trigger: "调用失败或被拒且存在错误上下文时输出。"
  },
  duration_ms: {
    label: "耗时",
    format: "integer milliseconds",
    description: "本次调用服务端记录的耗时。",
    trigger: "每条 access_log 行均输出。"
  },
  response_bytes: {
    label: "响应字节数",
    format: "integer|null",
    description: "响应体大小。",
    trigger: "调用返回响应且服务端可统计大小时输出。"
  },
  response_row_count: {
    label: "响应行数",
    format: "integer|null",
    description: "数据查询响应行数。",
    trigger: "数据查询工具返回结构化行结果时输出。"
  },
  response_column_count: {
    label: "响应列数",
    format: "integer|null",
    description: "数据查询响应列数。",
    trigger: "数据查询工具返回结构化列结果时输出。"
  },
  response_truncated: {
    label: "响应是否截断",
    format: "0|1|null",
    description: "响应是否被服务端截断。",
    trigger: "响应截断状态可判定时输出。"
  },
  request_id: {
    label: "请求 ID",
    format: "string",
    description: "服务端请求 ID，用于日志串联。",
    trigger: "每条 access_log 行均输出。"
  },
  trace_id: {
    label: "Trace ID",
    format: "string|null",
    description: "跨组件追踪 ID。",
    trigger: "请求上下文存在 trace_id 时输出。"
  },
  role_ids: {
    label: "Role",
    format: "JSON string|null",
    description: "本次调用生效的 Role ID 列表。",
    trigger: "鉴权成功并完成 Role 解析时输出。"
  },
  permission_snapshot_hash: {
    label: "权限快照哈希",
    format: "sha256|null",
    description: "本次调用使用的权限快照哈希。",
    trigger: "权限裁决保存快照时输出。"
  },
  effective_tables_count: {
    label: "生效表数",
    format: "integer|null",
    description: "本次权限边界中生效的数据表数量。",
    trigger: "权限裁决可计算表范围时输出。"
  },
  decision_reason: {
    label: "裁决原因",
    format: "string|null",
    description: "访问允许、拒绝或过滤的机器原因码。",
    trigger: "权限裁决链路产出原因码时输出。"
  },
  policy_version: {
    label: "策略版本",
    format: "string|null",
    description: "参与本次裁决的策略版本。",
    trigger: "权限策略编译结果可提供版本时输出。"
  },
  capability_digest: {
    label: "能力摘要",
    format: "sha256|null",
    description: "Agent 可用能力边界的摘要。",
    trigger: "权限策略编译结果可提供能力摘要时输出。"
  }
};

function renderAccessLogCsv(rows: QueryRow[]): string {
  const lines = [
    ACCESS_LOG_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        row.id,
        csvCell(row.ts),
        csvCell(formatAuditLocalTimestamp(row.ts)),
        csvCell(row.user_id),
        csvCell(row.token_label),
        csvCell(row.token_hash_prefix),
        csvCell(row.lucy_session_id),
        csvCell(row.lucy_turn_id),
        csvCell(row.turn_attribution_mode),
        csvCell(row.turn_attribution_confidence),
        csvCell(row.turn_attribution_reason),
        csvCell(row.lucy_platform),
        csvCell(row.client),
        csvCell(row.client_version),
        csvCell(row.client_ip),
        csvCell(row.user_agent),
        csvCell(row.device_name),
        csvCell(row.tool),
        csvCell(row.tables),
        csvCell(redactJsonString(row.args_summary)),
        csvCell(row.query_hash),
        row.query_length ?? "",
        csvCell(row.query_operation),
        csvCell(row.query_preview),
        csvCell(row.generated_sql),
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
        csvCell(row.decision_reason),
        csvCell(row.policy_version),
        csvCell(row.capability_digest)
      ].join(",")
    )
  ];
  return lines.join("\n");
}

function filterSnapshotForManifest(
  q: AccessLogFilterQuery & { includeProtocol?: string },
  includeProtocol: boolean
): Record<string, unknown> {
  return {
    user: q.user ?? null,
    tool: q.tool ?? null,
    outcome: q.outcome ?? null,
    since: q.since ?? null,
    until: q.until ?? null,
    tableSearch: q.tableSearch ?? null,
    sessionId: q.sessionId ?? null,
    turnId: q.turnId ?? null,
    eventId: q.eventId ?? null,
    key: q.key ?? null,
    platform: q.platform ?? null,
    callSource: q.callSource ?? null,
    clientIp: q.clientIp ?? null,
    deviceName: q.deviceName ?? null,
    includeProtocol
  };
}

function packFilenameStamp(now = new Date()): string {
  const iso = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const hex = createHash("sha256").update(`${iso}:${Math.random()}`).digest("hex").slice(0, 8);
  return `audit-pack-${iso}-${hex}.zip`;
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

type TurnFilterQuery = {
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
  bom?: string;
};

type TurnListResult = {
  total: number;
  entries: TurnEntry[];
  summary: {
    reportedCount: number;
    inferredCount: number;
    reportedShare: number;
  };
  referenceLatency: {
    windowHours: 24 | 168;
    p95Ms: number;
    totalCallsInWindow: number;
    slowCallsInFilter: number;
  };
};

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

async function listAuditTurnEntries(
  database: Database.Database,
  q: TurnFilterQuery,
  options: { limit?: number; offset?: number; paginate: boolean }
): Promise<TurnListResult> {
  const source = q.source === "inferred" || q.source === "reported" ? q.source : "all";
  const windowHours = parseWindowHours(q.hours);
  const lookbackHours = q.lookbackHours ? parseInt(q.lookbackHours, 10) : windowHours;
  const turnIdNeedle = (q.turnId ?? "").trim().toLowerCase();
  const tableNeedle = (q.tableSearch ?? "").trim().toLowerCase();
  const summaryNeedle = (q.q ?? "").trim().toLowerCase();
  const outcomeFilter = q.outcome === "ok" || q.outcome === "error" || q.outcome === "denied" ? q.outcome : "";
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
  const reportedCount = filtered.filter((entry) => entry.source === "reported").length;
  const inferredCount = filtered.filter((entry) => entry.source === "inferred").length;
  const reportedShare = total > 0 ? reportedCount / total : 0;
  const slowCallsInFilter = countSlowCallsForFilter(database, q.since ?? sinceDefault, p95Ms, q.user ?? null);
  const totalCallsRow = database
    .prepare(`SELECT COUNT(*) AS cnt FROM access_log WHERE ts >= ?`)
    .get(sinceDefault) as { cnt: number };
  const offset = options.offset ?? 0;
  const limit = options.limit ?? filtered.length;
  const paged = options.paginate ? filtered.slice(offset, offset + limit) : filtered;

  return {
    total,
    entries: paged,
    summary: {
      reportedCount,
      inferredCount,
      reportedShare
    },
    referenceLatency: {
      windowHours,
      p95Ms,
      totalCallsInWindow: totalCallsRow?.cnt ?? 0,
      slowCallsInFilter
    }
  };
}

const TURN_CSV_HEADERS = [
  "问询 ID",
  "来源",
  "Agent",
  "开始时间",
  "开始时间 UTC",
  "结束时间",
  "结束时间 UTC",
  "问询时长",
  "问询摘要",
  "工具调用数",
  "涉及工具",
  "涉及数据表",
  "总调用耗时",
  "最大调用耗时",
  "慢调用数",
  "成功次数",
  "拒绝次数",
  "错误次数"
] as const;

const TURN_FIELD_METADATA: Record<(typeof TURN_CSV_HEADERS)[number], Omit<CsvFieldMetadata, "name">> = {
  "问询 ID": {
    label: "问询 ID",
    format: "string",
    description: "一次用户问询的唯一 ID，可用于关联调用流水。",
    trigger: "用户原始问询或系统推断问询均输出。"
  },
  "来源": {
    label: "来源",
    format: "用户原始问询|系统推断问询",
    description: "问询记录来自客户端上报还是系统推断。",
    trigger: "reported 问询输出用户原始问询；inferred 问询输出系统推断问询。"
  },
  "Agent": {
    label: "Agent",
    format: "string",
    description: "触发该问询的 Agent 用户 ID。",
    trigger: "每条问询记录均输出。"
  },
  "开始时间": {
    label: "开始时间",
    format: "YYYY-MM-DD HH:mm:ss",
    description: "按 Asia/Shanghai 转换后的问询开始时间，便于人工阅读和 Excel 解析。",
    trigger: "每条问询记录均输出。"
  },
  "开始时间 UTC": {
    label: "开始时间 UTC",
    format: "ISO 8601 UTC",
    description: "问询开始时间的 UTC 原始值，用于机器对账和跨时区复核。",
    trigger: "每条问询记录均输出。"
  },
  "结束时间": {
    label: "结束时间",
    format: "YYYY-MM-DD HH:mm:ss",
    description: "按 Asia/Shanghai 转换后的问询结束时间，便于人工阅读和 Excel 解析。",
    trigger: "每条问询记录均输出。"
  },
  "结束时间 UTC": {
    label: "结束时间 UTC",
    format: "ISO 8601 UTC",
    description: "问询结束时间的 UTC 原始值，用于机器对账和跨时区复核。",
    trigger: "每条问询记录均输出。"
  },
  "问询时长": {
    label: "问询时长",
    format: "integer milliseconds",
    description: "从开始时间到结束时间的 wall-clock 时长。",
    trigger: "每条问询记录均输出。"
  },
  "问询摘要": {
    label: "问询摘要",
    format: "string|null",
    description: "用户问询预览或系统推断摘要。",
    trigger: "客户端上报问题预览或系统可推断摘要时输出。"
  },
  "工具调用数": {
    label: "工具调用数",
    format: "integer",
    description: "该问询关联的业务工具调用数量。",
    trigger: "每条问询记录均输出。"
  },
  "涉及工具": {
    label: "涉及工具",
    format: "comma-separated string",
    description: "该问询关联的工具调用名称。",
    trigger: "问询存在关联业务调用时输出。"
  },
  "涉及数据表": {
    label: "涉及数据表",
    format: "comma-separated string",
    description: "该问询关联调用触达的数据表。",
    trigger: "关联调用可识别物理表时输出。"
  },
  "总调用耗时": {
    label: "总调用耗时",
    format: "integer milliseconds",
    description: "该问询内所有关联调用的耗时总和。",
    trigger: "每条问询记录均输出。"
  },
  "最大调用耗时": {
    label: "最大调用耗时",
    format: "integer milliseconds",
    description: "该问询内最慢单次调用耗时。",
    trigger: "每条问询记录均输出。"
  },
  "慢调用数": {
    label: "慢调用数",
    format: "integer",
    description: "该问询内慢于参考 P95 的调用数量。",
    trigger: "存在 P95 参考值时统计输出。"
  },
  "成功次数": {
    label: "成功次数",
    format: "integer",
    description: "该问询内 outcome=ok 的调用数量。",
    trigger: "每条问询记录均输出。"
  },
  "拒绝次数": {
    label: "拒绝次数",
    format: "integer",
    description: "该问询内 outcome=denied 的调用数量。",
    trigger: "每条问询记录均输出。"
  },
  "错误次数": {
    label: "错误次数",
    format: "integer",
    description: "该问询内 outcome=error 的调用数量。",
    trigger: "每条问询记录均输出。"
  }
};

function turnSourceLabel(source: TurnEntry["source"]): string {
  return source === "reported" ? "用户原始问询" : "系统推断问询";
}

function renderTurnCsv(rows: TurnEntry[]): string {
  const lines = [
    TURN_CSV_HEADERS.join(","),
    ...rows.map((row) =>
      [
        csvCell(row.id),
        csvCell(turnSourceLabel(row.source)),
        csvCell(row.userId),
        csvCell(formatAuditLocalTimestamp(row.startedAt)),
        csvCell(row.startedAt),
        csvCell(formatAuditLocalTimestamp(row.endedAt)),
        csvCell(row.endedAt),
        row.turnSpanMs ?? "",
        csvCell(row.questionPreview ?? row.questionSummary ?? ""),
        row.businessCallCount,
        csvCell(row.tools.join(", ")),
        csvCell(row.sources.map((source) => source.physicalTable).join(", ")),
        row.totalCallDurationMs ?? "",
        row.maxCallDurationMs ?? "",
        row.slowCallCount ?? "",
        row.outcomeSummary?.ok ?? 0,
        row.outcomeSummary?.denied ?? 0,
        row.outcomeSummary?.error ?? 0
      ].join(",")
    )
  ];
  return lines.join("\n");
}

function csvFieldMetadataFields<T extends readonly string[]>(
  headers: T,
  metadata: Record<T[number], Omit<CsvFieldMetadata, "name">>
): CsvFieldMetadata[] {
  return headers.map((name) => ({ name, ...metadata[name] }));
}

function buildAuditCsvFieldMetadata(kind: "calls" | "turns", generatedAt = new Date()) {
  if (kind === "calls") {
    return {
      schemaVersion: "audit-csv-field-metadata/v1",
      kind,
      title: "调用流水 CSV 字段说明",
      timezone: AUDIT_EXPORT_TIMEZONE,
      filenamePattern: "audit-calls-YYYYMMDD-HHmmss-000001.csv",
      generatedAt: generatedAt.toISOString(),
      fields: csvFieldMetadataFields(ACCESS_LOG_CSV_HEADERS, ACCESS_LOG_FIELD_METADATA)
    };
  }
  return {
    schemaVersion: "audit-csv-field-metadata/v1",
    kind,
    title: "问询记录 CSV 字段说明",
    timezone: AUDIT_EXPORT_TIMEZONE,
    filenamePattern: "audit-turns-YYYYMMDD-HHmmss-000001.csv",
    generatedAt: generatedAt.toISOString(),
    fields: csvFieldMetadataFields(TURN_CSV_HEADERS, TURN_FIELD_METADATA)
  };
}

export function registerAuditRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: {
      requestId?: string;
      ref?: string;
    };
  }>("/api/admin/audit/query-artifacts", async (request, reply) => {
    const requestId = request.query.requestId?.trim();
    const refParam = request.query.ref?.trim();
    if (!requestId && !refParam) {
      reply.code(400);
      return { ok: false, error: { code: "ERR_INVALID_QUERY", message: "requestId or ref is required" } };
    }

    const database = await getAuditDb();
    let artifactRef = refParam ?? "";
    let accessLogId: number | null = null;
    let queryHash: string | null = null;
    let tool: string | null = null;

    if (requestId) {
      const row = database
        .prepare(
          `SELECT id, query_artifact_ref, query_hash, tool
           FROM access_log
           WHERE request_id = ?
           ORDER BY id DESC
           LIMIT 1`
        )
        .get(requestId) as
        | {
            id: number;
            query_artifact_ref: string | null;
            query_hash: string | null;
            tool: string;
          }
        | undefined;
      if (!row?.query_artifact_ref) {
        reply.code(404);
        return {
          ok: false,
          error: { code: "ERR_QUERY_ARTIFACT_NOT_FOUND", message: "no query artifact for requestId" }
        };
      }
      artifactRef = row.query_artifact_ref;
      accessLogId = row.id;
      queryHash = row.query_hash;
      tool = row.tool;
    }

    const actor = "local-admin";
    const ts = new Date().toISOString();
    const insertAccess = database.prepare(`
      INSERT INTO query_artifact_access_log
        (ts, actor, artifact_ref, request_id, query_hash, access_log_id, outcome, error_detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const loaded = await readQueryArtifact(artifactRef);
      if (!loaded) {
        insertAccess.run(ts, actor, artifactRef, requestId ?? null, queryHash, accessLogId, "not_found", null);
        reply.code(404);
        return {
          ok: false,
          error: { code: "ERR_QUERY_ARTIFACT_NOT_FOUND", message: "query artifact file missing" }
        };
      }
      insertAccess.run(
        ts,
        actor,
        artifactRef,
        loaded.record.requestId,
        loaded.record.queryHash,
        accessLogId,
        "ok",
        null
      );
      return {
        ok: true,
        data: {
          ref: loaded.record.ref,
          kind: loaded.record.kind,
          tool: loaded.record.tool ?? tool,
          requestId: loaded.record.requestId,
          traceId: loaded.record.traceId,
          queryHash: loaded.record.queryHash,
          createdAt: loaded.record.createdAt,
          plaintext: loaded.plaintext,
          accessLogId
        }
      };
    } catch (error) {
      const code = (error as { code?: string }).code;
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      const message = error instanceof Error ? error.message : String(error);
      insertAccess.run(ts, actor, artifactRef, requestId ?? null, queryHash, accessLogId, "error", message.slice(0, 300));
      reply.code(statusCode);
      return {
        ok: false,
        error: {
          code: code ?? "ERR_QUERY_ARTIFACT_READ",
          message
        }
      };
    }
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
      turnAttributionMode: row.turn_attribution_mode ?? undefined,
      turnAttributionConfidence: row.turn_attribution_confidence ?? undefined,
      turnAttributionReason: row.turn_attribution_reason ?? undefined,
      lucyPlatform: row.lucy_platform ?? undefined,
      client: row.client ?? undefined,
      clientVersion: row.client_version ?? undefined,
      clientIp: row.client_ip ?? undefined,
      userAgent: row.user_agent ?? undefined,
      deviceName: row.device_name ?? undefined,
      tool: row.tool,
      tables: row.tables ? (JSON.parse(row.tables) as string[]) : undefined,
      argsSummary: row.args_summary ? (redactSensitive(JSON.parse(row.args_summary)) as Record<string, unknown>) : undefined,
      queryHash: row.query_hash ?? undefined,
      queryLength: row.query_length ?? undefined,
      queryOperation: row.query_operation ?? undefined,
      queryPreview: row.query_preview ?? undefined,
      queryArtifactRef: row.query_artifact_ref ?? undefined,
      generatedSql: row.generated_sql ?? undefined,
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
      decisionReason: row.decision_reason ?? undefined,
      policyVersion: row.policy_version ?? undefined,
      capabilityDigest: row.capability_digest ?? undefined
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

  // GET /api/admin/audit/export-metadata — CSV 字段说明 (Spec 141)
  app.get<{
    Querystring: { kind?: string };
  }>("/api/admin/audit/export-metadata", async (request, reply) => {
    const kind = request.query.kind ?? "calls";
    if (kind !== "calls" && kind !== "turns") {
      reply.code(400);
      reply.header("Cache-Control", "private, no-store");
      return {
        ok: false,
        error: {
          code: "ERR_INVALID_AUDIT_METADATA_KIND",
          message: "字段说明类型仅支持 calls 或 turns"
        }
      };
    }
    const body = buildAuditCsvFieldMetadata(kind);
    reply.header("Content-Type", "application/json; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${auditExportFilename(`${kind}-fields`, "json")}"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(body);
  });

  // GET /api/admin/audit/export — 调用流水 CSV (Spec 137 / 141)
  app.get<{
    Querystring: AccessLogFilterQuery & { bom?: string };
  }>("/api/admin/audit/export", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();
    const { conditions, params } = buildAccessLogFilter(q);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC`)
      .all(params) as QueryRow[];

    const body = renderAccessLogCsv(rows);
    const withBom = q.bom === "1" || q.bom === "true" ? `\uFEFF${body}` : body;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${auditExportFilename("calls", "csv")}"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(withBom);
  });

  // GET /api/admin/audit/export-pack — 审计证据包 zip (Spec 137)
  app.get<{
    Querystring: AccessLogFilterQuery;
  }>("/api/admin/audit/export-pack", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();
    const { conditions, params, includeProtocol } = buildAccessLogFilter(q);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const maxRows = auditExportMaxRows();
    const rows = database
      .prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC LIMIT @exportLimit`)
      .all({ ...params, exportLimit: maxRows + 1 }) as QueryRow[];
    if (rows.length > maxRows) {
      reply.code(413);
      reply.header("Cache-Control", "private, no-store");
      return {
        ok: false,
        error: {
          code: "ERR_AUDIT_EXPORT_TOO_LARGE",
          message: `导出范围超过 ${maxRows} 行上限，请缩小筛选范围`
        }
      };
    }

    const accessCsv = `\uFEFF${renderAccessLogCsv(rows)}`;
    const accessBuf = Buffer.from(accessCsv, "utf8");

    const ids = rows.map((r) => r.id);
    let sourcesCsv = "id,access_log_id,ts,user_id,tool,connection_id,schema_name,source_name,physical_table,extraction_method,confidence\n";
    let sourcesCount = 0;
    const sourceRows: Array<Record<string, unknown>> = [];
    if (ids.length > 0) {
      for (const idChunk of chunksOf(ids)) {
        const placeholders = idChunk.map(() => "?").join(",");
        sourceRows.push(...database
          .prepare(
          `SELECT id, access_log_id, ts, user_id, tool, connection_id, schema_name, source_name, physical_table, extraction_method, confidence
           FROM access_log_sources WHERE access_log_id IN (${placeholders}) ORDER BY access_log_id, id`
          )
          .all(...idChunk) as Array<Record<string, unknown>>);
      }
      sourcesCount = sourceRows.length;
      for (const s of sourceRows) {
        sourcesCsv +=
          [
            s.id,
            s.access_log_id,
            csvCell(String(s.ts ?? "")),
            csvCell(String(s.user_id ?? "")),
            csvCell(String(s.tool ?? "")),
            csvCell(s.connection_id == null ? "" : String(s.connection_id)),
            csvCell(s.schema_name == null ? "" : String(s.schema_name)),
            csvCell(s.source_name == null ? "" : String(s.source_name)),
            csvCell(String(s.physical_table ?? "")),
            csvCell(String(s.extraction_method ?? "")),
            csvCell(String(s.confidence ?? ""))
          ].join(",") + "\n";
      }
    }
    const sourcesBuf = Buffer.from(`\uFEFF${sourcesCsv}`, "utf8");

    const hashes = [
      ...new Set(rows.map((r) => r.permission_snapshot_hash).filter((h): h is string => Boolean(h)))
    ];
    let snapshotsJsonl = "";
    let snapshotsCount = 0;
    const snapRows: Array<Record<string, unknown>> = [];
    if (hashes.length > 0) {
      for (const hashChunk of chunksOf(hashes)) {
        const placeholders = hashChunk.map(() => "?").join(",");
        snapRows.push(...database
          .prepare(
          `SELECT hash, created_at, roles_json, resolved_json, capability_digest, tool_classification_version
           FROM permission_snapshots WHERE hash IN (${placeholders})`
          )
          .all(...hashChunk) as Array<Record<string, unknown>>);
      }
      snapshotsCount = snapRows.length;
      for (const snap of snapRows) {
        snapshotsJsonl += `${JSON.stringify(snap)}\n`;
      }
    }
    const snapshotsBuf = Buffer.from(snapshotsJsonl, "utf8");

    const since = q.since ?? null;
    const until = q.until ?? null;
    const authParams: string[] = [];
    const authConds: string[] = [];
    if (since) {
      authConds.push("ts >= ?");
      authParams.push(since);
    }
    if (until) {
      authConds.push("ts <= ?");
      authParams.push(until);
    }
    if (q.user) {
      authConds.push("user_id = ?");
      authParams.push(q.user);
    }
    if (q.clientIp) {
      authConds.push("IFNULL(client_ip, '') LIKE ?");
      authParams.push(`%${q.clientIp}%`);
    }
    const authWhere = authConds.length > 0 ? `WHERE ${authConds.join(" AND ")}` : "";
    const authRows = database
      .prepare(
        `SELECT id, ts, reason, client_ip, user_agent, token_hash_prefix, user_id, token_label, request_id
         FROM auth_failure_log ${authWhere} ORDER BY ts DESC`
      )
      .all(...authParams) as Array<Record<string, unknown>>;
    let authCsv =
      "id,ts,reason,client_ip,user_agent,token_hash_prefix,user_id,token_label,request_id\n";
    for (const a of authRows) {
      authCsv +=
        [
          a.id,
          csvCell(String(a.ts ?? "")),
          csvCell(String(a.reason ?? "")),
          csvCell(a.client_ip == null ? "" : String(a.client_ip)),
          csvCell(a.user_agent == null ? "" : String(a.user_agent)),
          csvCell(a.token_hash_prefix == null ? "" : String(a.token_hash_prefix)),
          csvCell(a.user_id == null ? "" : String(a.user_id)),
          csvCell(a.token_label == null ? "" : String(a.token_label)),
          csvCell(a.request_id == null ? "" : String(a.request_id))
        ].join(",") + "\n";
    }
    const authBuf = Buffer.from(`\uFEFF${authCsv}`, "utf8");

    const maintenanceConds: string[] = [];
    const maintenanceParams: string[] = [];
    if (since) {
      maintenanceConds.push("ts >= ?");
      maintenanceParams.push(since);
    }
    if (until) {
      maintenanceConds.push("ts <= ?");
      maintenanceParams.push(until);
    }
    const maintenanceWhere = maintenanceConds.length > 0 ? `WHERE ${maintenanceConds.join(" AND ")}` : "";
    const maintenanceRows = database
      .prepare(
        `SELECT id, ts, event_type, actor, reason, request_id, algorithm_version,
                scanned, matched, updated, before_digest, after_digest
         FROM audit_maintenance_log ${maintenanceWhere} ORDER BY ts DESC`
      )
      .all(...maintenanceParams) as Array<Record<string, unknown>>;
    const maintenanceBuf = Buffer.from(
      maintenanceRows.map((row) => JSON.stringify(row)).join("\n") + (maintenanceRows.length > 0 ? "\n" : ""),
      "utf8"
    );

    const sourceAccessLogIds = new Set(sourceRows.map((row) => Number(row.access_log_id)));
    const missingSourceAccessLogIds = rows
      .filter((row) => row.tool === "lucy_query" && row.outcome === "ok" && !sourceAccessLogIds.has(row.id))
      .map((row) => row.id);
    const foundSnapshotHashes = new Set(snapRows.map((row) => String(row.hash)));
    const missingPermissionSnapshotHashes = hashes.filter((hash) => !foundSnapshotHashes.has(hash));
    const rowsWithoutPermissionSnapshot = rows.filter((row) => !row.permission_snapshot_hash).length;

    const filesMeta = [
      { name: "access_log.csv", rowCount: rows.length, data: accessBuf, filterScope: "normalized_access_log_filter" },
      { name: "access_log_sources.csv", rowCount: sourcesCount, data: sourcesBuf, filterScope: "selected_access_log_ids" },
      { name: "permission_snapshots.jsonl", rowCount: snapshotsCount, data: snapshotsBuf, filterScope: "selected_permission_snapshot_hashes" },
      { name: "auth_failure_log.csv", rowCount: authRows.length, data: authBuf, filterScope: "time_user_client_ip" },
      { name: "audit_maintenance_log.jsonl", rowCount: maintenanceRows.length, data: maintenanceBuf, filterScope: "time_window" }
    ];
    const totalUncompressedBytes = filesMeta.reduce((sum, file) => sum + file.data.byteLength, 0);
    const maxBytes = auditExportMaxBytes();
    if (totalUncompressedBytes > maxBytes) {
      reply.code(413);
      reply.header("Cache-Control", "private, no-store");
      return {
        ok: false,
        error: {
          code: "ERR_AUDIT_EXPORT_TOO_LARGE",
          message: `导出内容超过 ${maxBytes} 字节上限，请缩小筛选范围`
        }
      };
    }
    const manifest = {
      schemaVersion: "audit-export-manifest/v1",
      generatedAt: new Date().toISOString(),
      timezone: "UTC",
      appVersion: resolveLucyVersion(),
      filter: filterSnapshotForManifest(q, includeProtocol),
      includeProtocol,
      limits: { maxRows, maxBytes, exportedUncompressedBytes: totalUncompressedBytes },
      completeness: {
        rowsWithoutPermissionSnapshot,
        missingPermissionSnapshotHashes,
        missingSourceAccessLogIds,
        complete:
          rowsWithoutPermissionSnapshot === 0 &&
          missingPermissionSnapshotHashes.length === 0 &&
          missingSourceAccessLogIds.length === 0
      },
      files: filesMeta.map((f) => ({
        name: f.name,
        rowCount: f.rowCount,
        filterScope: f.filterScope,
        sha256: sha256Hex(f.data)
      }))
    };
    const manifestBuf = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const zip = buildStoredZip([
      ...filesMeta.map((f) => ({ name: f.name, data: f.data })),
      { name: "manifest.json", data: manifestBuf }
    ]);

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="${packFilenameStamp()}"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(zip);
  });

  // POST /api/admin/audit/args-summary/scrub — Spec 137
  app.post<{ Body: { dryRun?: boolean; reason?: string } }>("/api/admin/audit/args-summary/scrub", async (request, reply) => {
    const body = request.body ?? {};
    const dryRun = body.dryRun !== false;
    if (!dryRun && !body.reason?.trim()) {
      reply.code(400);
      return { ok: false, error: { code: "ERR_SCRUB_REASON_REQUIRED", message: "执行历史清理时必须填写原因" } };
    }
    const result = await scrubAccessLogArgsSummaries({
      dryRun,
      actor: "local-admin",
      reason: body.reason,
      requestId: String(request.id)
    });
    return { ok: true, data: { ...result, dryRun } };
  });

  // GET /api/admin/audit/turns — unified "question cluster" view: inferred (Phase 2)
  // + reported (Phase 3), per spec 08 §9.1.
  app.get<{
    Querystring: TurnFilterQuery & {
      limit?: string;
      offset?: string;
    };
  }>("/api/admin/audit/turns", async (request) => {
    const q = request.query;
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 500);
    const offset = parseInt(q.offset ?? "0", 10) || 0;

    const database = await getAuditDb();
    const result = await listAuditTurnEntries(database, q, { limit, offset, paginate: true });

    return {
      ok: true,
      data: result
    };
  });

  // GET /api/admin/audit/turns/export — 问询记录 CSV (Spec 140 / 141)
  app.get<{
    Querystring: TurnFilterQuery;
  }>("/api/admin/audit/turns/export", async (request, reply) => {
    const q = request.query;
    const database = await getAuditDb();
    const result = await listAuditTurnEntries(database, q, { paginate: false });
    const body = renderTurnCsv(result.entries);
    const withBom = q.bom === "1" || q.bom === "true" ? `\uFEFF${body}` : body;
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${auditExportFilename("turns", "csv")}"`);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(withBom);
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
