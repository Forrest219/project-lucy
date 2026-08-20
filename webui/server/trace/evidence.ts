/**
 * Trace / Evidence Kernel — 202608-01 P0 MVP
 *
 * Append-only event store for `trace_events` and `evidence_events` tables.
 * Backed by the same `.ktx-ui/audit.sqlite` used by `webui/server/admin/audit.ts`
 * (no second audit database).
 *
 * Hard rules:
 *  - Events are append-only. There is no UPDATE path; corrections use new
 *    `superseded` / `reviewer_override` evidence rows.
 *  - Hot store data boundary:
 *      Allowed: Trace Envelope, Evidence Ref, Policy Decision, Artifact Hashes,
 *               Reviewer / Override signatures, redacted metadata,
 *               SQL AST hash / normalized summary / redacted structural metadata.
 *      Forbidden: 物理结果集明细, 原始 SQL AST, 未脱敏 Token / secret,
 *                 完整原始问题, 数据库凭据, 客户行级样本, SQL AST 原文.
 *  - New SQLite files MUST set `PRAGMA auto_vacuum = INCREMENTAL` before table
 *    creation. Existing files that do not match only WARN, never auto-`VACUUM`.
 *  - All connections set `busyTimeout: 5000` so concurrent writers wait briefly
 *    instead of surfacing SQLITE_BUSY to callers.
 *  - Test code MUST use `:memory:` or a unique temp file; this module never
 *    resolves a real `.ktx-ui/audit.sqlite` on its own — it accepts an
 *    explicit `database` handle from the caller so tests stay isolated.
 */
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export type LucySpanType =
  | "reindex"
  | "mcp_initialize"
  | "mcp_tools_list"
  | "mcp_tools_call"
  | "policy_decision"
  | "ktx_retrieval"
  | "sql_plan"
  | "sql_execute"
  | "eval_run"
  | "publish_gate"
  | "copilot_candidate";

export type LucySpanStatus = "ok" | "error" | "denied" | "running";
export type LucyActorKind = "agent" | "admin" | "system" | "reviewer";

export type EvidenceRelation =
  | "observed"
  | "used"
  | "denied_by"
  | "superseded"
  | "reviewer_override"
  | "promoted";

export interface PolicyDecisionMetadata {
  allowed: boolean;
  reason?: string;
  toolName?: string;
  permissionSnapshotHash?: string;
  matchedRule?: string;
  source?: "access_policy" | "rate_limit" | "tool_exposure" | "wiki_acl" | "other";
}

export interface WriteTraceEventInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  spanType: LucySpanType;
  actorKind: LucyActorKind;
  actorId?: string | null;
  status: LucySpanStatus;
  startedAt: string;
  endedAt?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  requestId?: string | null;
  policyDecision?: PolicyDecisionMetadata | null;
  artifactHashes?: string[];
  metadata?: Record<string, unknown>;
}

export interface WriteEvidenceRefInput {
  traceEventId?: number | null;
  traceId: string;
  evidenceKind: string;
  evidenceRef: string;
  evidenceVersion?: string | null;
  evidenceHash?: string | null;
  relation: EvidenceRelation;
  reviewer?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export interface TraceEventRow {
  id: number;
  traceId: string;
  sessionId: string | null;
  turnId: string | null;
  spanId: string;
  parentSpanId: string | null;
  spanType: LucySpanType;
  actorKind: LucyActorKind;
  actorId: string | null;
  status: LucySpanStatus;
  startedAt: string;
  endedAt: string | null;
  requestId: string | null;
  policyDecision: PolicyDecisionMetadata | null;
  artifactHashes: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface EvidenceEventRow {
  id: number;
  traceEventId: number | null;
  traceId: string;
  evidenceKind: string;
  evidenceRef: string;
  evidenceVersion: string | null;
  evidenceHash: string | null;
  relation: EvidenceRelation;
  reviewer: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ListTraceEventsFilter {
  traceId?: string;
  turnId?: string;
  spanType?: LucySpanType;
  status?: LucySpanStatus;
  limit?: number;
}

// Retention defaults are referenced from `docs/lucy-202608-reliable-delivery-upgrade-spec.md`
// and `webui/docs/62-trace-evidence-kernel-spec.md`. We expose them so the verifier
// can assert them at runtime without hard-coding magic numbers.
export const TRACE_RETENTION_DAYS = 365;
export const TRACE_MAX_ROWS = 500_000;
export const TRACE_MAX_BYTES = 1_073_741_824; // 1 GiB

const MAX_METADATA_KEYS = 64;
const MAX_METADATA_STRING_CHARS = 4_096;
const MAX_ARTIFACT_HASHES = 32;
const SENSITIVE_KEY_RE = /(?:password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)/i;
const SENSITIVE_VALUE_RE = /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key|cert)\b\s*[:=]\s*(?:Bearer\s+)?([^,\s;]+)/gi;
const BEARER_VALUE_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const HIGH_ENTROPY_SECRET_RE = /\b(?:sk|pk|ak|rk|pat|ghp|gho|glpat|xox[baprs]?|eyJ)[A-Za-z0-9._~+/=-]{16,}\b/g;
const BLACKLIST_EVIDENCE_KEYS = new Set([
  "raw_sql_ast",
  "raw_query",
  "raw_token",
  "raw_result_row",
  "full_question_payload",
  "database_credential"
]);
const BLACKLIST_EVIDENCE_KINDS = new Set([
  "raw_sql_ast",
  "raw_token",
  "raw_result_row",
  "full_question_payload"
]);

let warnedNonIncrementalVacuum = false;

/**
 * Prepare a database connection for use as the trace / evidence hot store.
 *
 * MUST be called immediately after opening a new `better-sqlite3` connection,
 * BEFORE the first `CREATE TABLE`. Sets `journal_mode = WAL`, `busy_timeout = 5000`,
 * and `auto_vacuum = INCREMENTAL` on fresh databases. For existing databases
 * where the auto_vacuum mode does not match, this emits a one-time warning
 * instead of triggering a long full VACUUM on a live production file.
 */
export function prepareTraceDatabase(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  configureIncrementalVacuum(database);
}

/**
 * Ensure `trace_events` and `evidence_events` exist on the given database.
 * Idempotent: safe to run on every connection. The caller owns the connection
 * (and therefore the `busyTimeout` / WAL settings).
 */
export function ensureTraceEvidenceSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS trace_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      session_id TEXT,
      turn_id TEXT,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      span_type TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      request_id TEXT,
      policy_decision_json TEXT,
      artifact_hashes_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_trace_events_trace ON trace_events(trace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_trace_events_turn ON trace_events(turn_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_trace_events_type_status ON trace_events(span_type, status, created_at);

    CREATE TABLE IF NOT EXISTS evidence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_event_id INTEGER,
      trace_id TEXT NOT NULL,
      evidence_kind TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      evidence_version TEXT,
      evidence_hash TEXT,
      relation TEXT NOT NULL,
      reviewer_json TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(trace_event_id) REFERENCES trace_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_events_trace ON evidence_events(trace_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_evidence_events_relation ON evidence_events(relation, created_at);
  `);
}

/**
 * Configure `auto_vacuum = INCREMENTAL` only when the database file is empty
 * (newly created) so that we don't trigger a long-running full VACUUM on a
 * real `.ktx-ui/audit.sqlite`. Existing non-matching files get a single
 * warning that we never re-emit.
 *
 * IMPORTANT: SQLite only honours `auto_vacuum` changes that happen before any
 * table is created. We rely on callers using `prepareTraceDatabase()` first.
 * For databases that already have tables, we warn and skip the change.
 */
function configureIncrementalVacuum(database: Database.Database): void {
  const current = (database.pragma("auto_vacuum", { simple: true }) as unknown) as number | string;
  // SQLite returns 0 (NONE), 1 (FULL), 2 (INCREMENTAL). Stringify to normalise.
  const normalized = typeof current === "string" ? current.toLowerCase() : String(current);
  if (normalized === "2" || normalized === "incremental") return;

  // Distinguish "no tables yet" (safe to set) from "tables exist" (warn only).
  const tables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>;
  if (tables.length === 0) {
    // SQLite only persists the new auto_vacuum setting into the file header
    // after a VACUUM. On an empty brand-new DB this is instant (no pages to
    // rewrite) and safe. We still gate on `tables.length === 0` so we never
    // run a full VACUUM on a production-sized audit.sqlite.
    database.pragma("auto_vacuum = INCREMENTAL");
    database.exec(`VACUUM`);
    return;
  }

  if (!warnedNonIncrementalVacuum) {
    warnedNonIncrementalVacuum = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[trace-evidence] existing audit.sqlite is not in auto_vacuum=INCREMENTAL mode; " +
        "skipping full VACUUM. New databases will set INCREMENTAL automatically."
    );
  }
}

/**
 * Append a single trace event. Returns the inserted row id.
 *
 * The call is intentionally synchronous — better-sqlite3 is sync, and the trace
 * kernel is on the MCP request hot path. Errors are NOT thrown; callers that
 * need to react to write failures should pass a try/catch or rely on the
 * accompanying self-validation script which counts failures.
 */
export function writeTraceEvent(
  database: Database.Database,
  input: WriteTraceEventInput
): number {
  ensureTraceEvidenceSchema(database);
  const now = new Date().toISOString();
  const sanitizedMetadata = sanitizeMetadata(input.metadata);
  const artifactHashes = sanitizeArtifactHashes(input.artifactHashes ?? []);
  const policyDecision = sanitizePolicyDecision(input.policyDecision ?? null);
  const result = database
    .prepare(
      `INSERT INTO trace_events
        (trace_id, session_id, turn_id, span_id, parent_span_id, span_type,
         actor_kind, actor_id, status, started_at, ended_at, request_id,
         policy_decision_json, artifact_hashes_json, metadata_json, created_at)
       VALUES
        (@trace_id, @session_id, @turn_id, @span_id, @parent_span_id, @span_type,
         @actor_kind, @actor_id, @status, @started_at, @ended_at, @request_id,
         @policy_decision_json, @artifact_hashes_json, @metadata_json, @created_at)`
    )
    .run({
      trace_id: input.traceId,
      session_id: input.sessionId ?? null,
      turn_id: input.turnId ?? null,
      span_id: input.spanId,
      parent_span_id: input.parentSpanId ?? null,
      span_type: input.spanType,
      actor_kind: input.actorKind,
      actor_id: input.actorId ?? null,
      status: input.status,
      started_at: input.startedAt,
      ended_at: input.endedAt ?? null,
      request_id: input.requestId ?? null,
      policy_decision_json: policyDecision === null ? null : JSON.stringify(policyDecision),
      artifact_hashes_json: JSON.stringify(artifactHashes),
      metadata_json: JSON.stringify(sanitizedMetadata),
      created_at: now
    });
  return typeof result.lastInsertRowid === "number"
    ? result.lastInsertRowid
    : Number(result.lastInsertRowid);
}

/**
 * Append one or more evidence rows tied to a trace event (or to a traceId alone
 * for events that don't need a parent span). Returns the inserted row ids in
 * the same order as the input.
 */
export function writeEvidenceEvents(
  database: Database.Database,
  refs: WriteEvidenceRefInput[]
): number[] {
  ensureTraceEvidenceSchema(database);
  if (refs.length === 0) return [];
  const insert = database.prepare(
    `INSERT INTO evidence_events
      (trace_event_id, trace_id, evidence_kind, evidence_ref, evidence_version,
       evidence_hash, relation, reviewer_json, metadata_json, created_at)
     VALUES
      (@trace_event_id, @trace_id, @evidence_kind, @evidence_ref, @evidence_version,
       @evidence_hash, @relation, @reviewer_json, @metadata_json, @created_at)`
  );
  const now = new Date().toISOString();
  const tx = database.transaction((entries: WriteEvidenceRefInput[]) => {
    const ids: number[] = [];
    for (const entry of entries) {
      if (!isEvidenceRefAllowed(entry)) {
        throw new Error(
          `[trace-evidence] refused blacklisted evidence kind=${entry.evidenceKind} ref=${entry.evidenceRef}`
        );
      }
      const result = insert.run({
        trace_event_id: entry.traceEventId ?? null,
        trace_id: entry.traceId,
        evidence_kind: entry.evidenceKind,
        evidence_ref: entry.evidenceRef,
        evidence_version: entry.evidenceVersion ?? null,
        evidence_hash: entry.evidenceHash ?? null,
        relation: entry.relation,
        reviewer_json: entry.reviewer ? JSON.stringify(sanitizeMetadata(entry.reviewer)) : null,
        metadata_json: JSON.stringify(sanitizeMetadata(entry.metadata ?? {})),
        created_at: now
      });
      ids.push(
        typeof result.lastInsertRowid === "number"
          ? result.lastInsertRowid
          : Number(result.lastInsertRowid)
      );
    }
    return ids;
  });
  return tx(refs);
}

export function listTraceEvents(
  database: Database.Database,
  filter: ListTraceEventsFilter = {}
): { events: TraceEventRow[]; evidence: EvidenceEventRow[] } {
  ensureTraceEvidenceSchema(database);
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.traceId) {
    conditions.push("trace_id = @traceId");
    params.traceId = filter.traceId;
  }
  if (filter.turnId) {
    conditions.push("turn_id = @turnId");
    params.turnId = filter.turnId;
  }
  if (filter.spanType) {
    conditions.push("span_type = @spanType");
    params.spanType = filter.spanType;
  }
  if (filter.status) {
    conditions.push("status = @status");
    params.status = filter.status;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const eventRows = database
    .prepare(
      `SELECT id, trace_id, session_id, turn_id, span_id, parent_span_id, span_type,
              actor_kind, actor_id, status, started_at, ended_at, request_id,
              policy_decision_json, artifact_hashes_json, metadata_json, created_at
       FROM trace_events ${where}
       ORDER BY created_at ASC
       LIMIT ${limit}`
    )
    .all(params) as Array<{
      id: number;
      trace_id: string;
      session_id: string | null;
      turn_id: string | null;
      span_id: string;
      parent_span_id: string | null;
      span_type: string;
      actor_kind: string;
      actor_id: string | null;
      status: string;
      started_at: string;
      ended_at: string | null;
      request_id: string | null;
      policy_decision_json: string | null;
      artifact_hashes_json: string;
      metadata_json: string;
      created_at: string;
    }>;
  const events: TraceEventRow[] = eventRows.map((row) => ({
    id: row.id,
    traceId: row.trace_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    spanType: row.span_type as LucySpanType,
    actorKind: row.actor_kind as LucyActorKind,
    actorId: row.actor_id,
    status: row.status as LucySpanStatus,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    requestId: row.request_id,
    policyDecision: row.policy_decision_json
      ? (JSON.parse(row.policy_decision_json) as PolicyDecisionMetadata)
      : null,
    artifactHashes: safeJsonArray(row.artifact_hashes_json),
    metadata: safeJsonObject(row.metadata_json),
    createdAt: row.created_at
  }));

  const traceIds = Array.from(new Set(events.map((event) => event.traceId)));
  let evidence: EvidenceEventRow[] = [];
  if (traceIds.length > 0) {
    const placeholders = traceIds.map((_, index) => `@trace${index}`).join(",");
    const evidenceParams: Record<string, unknown> = {};
    traceIds.forEach((id, index) => {
      evidenceParams[`trace${index}`] = id;
    });
    const evidenceRows = database
      .prepare(
        `SELECT id, trace_event_id, trace_id, evidence_kind, evidence_ref, evidence_version,
                evidence_hash, relation, reviewer_json, metadata_json, created_at
         FROM evidence_events
         WHERE trace_id IN (${placeholders})
         ORDER BY created_at ASC
         LIMIT ${Math.min(limit * 4, 2000)}`
      )
      .all(evidenceParams) as Array<{
        id: number;
        trace_event_id: number | null;
        trace_id: string;
        evidence_kind: string;
        evidence_ref: string;
        evidence_version: string | null;
        evidence_hash: string | null;
        relation: string;
        reviewer_json: string | null;
        metadata_json: string;
        created_at: string;
      }>;
    evidence = evidenceRows.map((row) => ({
      id: row.id,
      traceEventId: row.trace_event_id,
      traceId: row.trace_id,
      evidenceKind: row.evidence_kind,
      evidenceRef: row.evidence_ref,
      evidenceVersion: row.evidence_version,
      evidenceHash: row.evidence_hash,
      relation: row.relation as EvidenceRelation,
      reviewer: row.reviewer_json ? safeJsonObject(row.reviewer_json) : null,
      metadata: safeJsonObject(row.metadata_json),
      createdAt: row.created_at
    }));
  }

  return { events, evidence };
}

/**
 * Stable hash for opaque artifact references. We use SHA-256 hex truncated to
 * 32 chars so it's easy to log without dominating a CSV cell.
 */
export function hashArtifact(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function sanitizeMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input) return {};
  const entries = Object.entries(input).slice(0, MAX_METADATA_KEYS);
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (SENSITIVE_KEY_RE.test(key)) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    const redacted = value
      .replace(SENSITIVE_VALUE_RE, "$1=[REDACTED]")
      .replace(BEARER_VALUE_RE, "Bearer [REDACTED]")
      .replace(HIGH_ENTROPY_SECRET_RE, "[REDACTED]");
    return redacted.length > MAX_METADATA_STRING_CHARS
      ? `${redacted.slice(0, MAX_METADATA_STRING_CHARS)}…[truncated]`
      : redacted;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 32).map(sanitizeValue);
  }
  if (value && typeof value === "object") {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeArtifactHashes(hashes: string[]): string[] {
  return hashes
    .filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{8,128}$/i.test(hash))
    .slice(0, MAX_ARTIFACT_HASHES);
}

function sanitizePolicyDecision(input: PolicyDecisionMetadata | null): PolicyDecisionMetadata | null {
  if (!input) return null;
  return {
    allowed: Boolean(input.allowed),
    reason: typeof input.reason === "string" ? input.reason.slice(0, 256) : undefined,
    toolName: typeof input.toolName === "string" ? input.toolName.slice(0, 128) : undefined,
    permissionSnapshotHash:
      typeof input.permissionSnapshotHash === "string" ? input.permissionSnapshotHash.slice(0, 128) : undefined,
    matchedRule: typeof input.matchedRule === "string" ? input.matchedRule.slice(0, 128) : undefined,
    source: input.source
  };
}

function isEvidenceRefAllowed(ref: WriteEvidenceRefInput): boolean {
  const normalizedKind = ref.evidenceKind.toLowerCase();
  if (BLACKLIST_EVIDENCE_KINDS.has(normalizedKind)) return false;
  if (ref.evidenceKind && BLACKLIST_EVIDENCE_KEYS.has(ref.evidenceKind)) return false;
  if (ref.evidenceRef && typeof ref.evidenceRef === "string") {
    const lower = ref.evidenceRef.toLowerCase();
    if (
      lower.includes("raw_sql_ast=") ||
      lower.includes("raw_token=") ||
      lower.includes("raw_result_row=") ||
      lower.includes("full_question_payload=")
    ) {
      return false;
    }
  }
  return true;
}

function safeJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Convenience: build a `mcp_tools_call` + optional `policy_decision` trace pair
 * for a single MCP request. The MCP proxy hot path uses this so it doesn't
 * have to know the full kernel contract.
 */
export interface RecordMcpToolsCallInput {
  traceId: string;
  spanId: string;
  sessionId?: string | null;
  turnId?: string | null;
  requestId?: string | null;
  actorId: string;
  toolName: string;
  startedAt: string;
  endedAt: string;
  status: LucySpanStatus;
  policyDecision?: PolicyDecisionMetadata | null;
  metadata?: Record<string, unknown>;
  /** Bounded result-size summary. Written as `result_snapshot_hash` only when row or column count is known. */
  resultSnapshot?: {
    rowCount?: number | null;
    columnCount?: number | null;
    responseBytes?: number | null;
    truncated?: boolean | null;
  } | null;
  /** Structured source refs already available for the call (from access_log_sources extraction). */
  sourceRefs?: Array<{
    connectionId?: string | null;
    schema?: string | null;
    sourceName?: string | null;
    physicalTable: string;
    confidence?: string | null;
  }> | null;
}

export function recordMcpToolsCall(
  database: Database.Database,
  input: RecordMcpToolsCallInput
): { callEventId: number; policyEventId: number | null } {
  const callEventId = writeTraceEvent(database, {
    traceId: input.traceId,
    spanId: input.spanId,
    spanType: "mcp_tools_call",
    actorKind: "agent",
    actorId: input.actorId,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    sessionId: input.sessionId ?? null,
    turnId: input.turnId ?? null,
    requestId: input.requestId ?? null,
    metadata: {
      ...(input.metadata ?? {}),
      tool_name: input.toolName
    }
  });

  let policyEventId: number | null = null;
  if (input.policyDecision) {
    policyEventId = writeTraceEvent(database, {
      traceId: input.traceId,
      spanId: `${input.spanId}:policy`,
      parentSpanId: input.spanId,
      spanType: "policy_decision",
      actorKind: "system",
      actorId: null,
      status: input.policyDecision.allowed ? "ok" : "denied",
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      sessionId: input.sessionId ?? null,
      turnId: input.turnId ?? null,
      requestId: input.requestId ?? null,
      policyDecision: input.policyDecision,
      artifactHashes: input.policyDecision.permissionSnapshotHash
        ? [input.policyDecision.permissionSnapshotHash]
        : []
    });
    writeEvidenceEvents(database, [
      {
        traceEventId: policyEventId,
        traceId: input.traceId,
        evidenceKind: input.policyDecision.source ?? "access_policy",
        evidenceRef: input.toolName,
        evidenceHash: input.policyDecision.permissionSnapshotHash ?? null,
        relation: input.policyDecision.allowed ? "used" : "denied_by",
        metadata: {
          reason: input.policyDecision.reason ?? null,
          matchedRule: input.policyDecision.matchedRule ?? null
        }
      }
    ]);
  }

  const extraEvidence: WriteEvidenceRefInput[] = [];

  const rowCount = input.resultSnapshot?.rowCount;
  const columnCount = input.resultSnapshot?.columnCount;
  if (
    (typeof rowCount === "number" && Number.isFinite(rowCount)) ||
    (typeof columnCount === "number" && Number.isFinite(columnCount))
  ) {
    const summary = {
      rowCount: typeof rowCount === "number" && Number.isFinite(rowCount) ? rowCount : null,
      columnCount: typeof columnCount === "number" && Number.isFinite(columnCount) ? columnCount : null,
      responseBytes:
        typeof input.resultSnapshot?.responseBytes === "number" && Number.isFinite(input.resultSnapshot.responseBytes)
          ? input.resultSnapshot.responseBytes
          : null,
      truncated: input.resultSnapshot?.truncated === true
    };
    const snapshotHash = hashArtifact(JSON.stringify(summary));
    extraEvidence.push({
      traceEventId: callEventId,
      traceId: input.traceId,
      evidenceKind: "result_snapshot_hash",
      evidenceRef: `rows=${summary.rowCount ?? "?"};cols=${summary.columnCount ?? "?"}`,
      evidenceHash: snapshotHash,
      relation: "observed",
      metadata: summary
    });
  }

  if (input.sourceRefs && input.sourceRefs.length > 0) {
    const seen = new Set<string>();
    for (const ref of input.sourceRefs) {
      const physicalTable = typeof ref.physicalTable === "string" ? ref.physicalTable.trim() : "";
      if (!physicalTable) continue;
      const sourceName = typeof ref.sourceName === "string" && ref.sourceName.trim() ? ref.sourceName.trim() : null;
      const connectionId =
        typeof ref.connectionId === "string" && ref.connectionId.trim() ? ref.connectionId.trim() : null;
      const schema = typeof ref.schema === "string" && ref.schema.trim() ? ref.schema.trim() : null;
      const evidenceRef = sourceName
        ? [connectionId, schema, sourceName].filter(Boolean).join("/") || sourceName
        : physicalTable;
      const dedupeKey = `${evidenceRef}|${physicalTable}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      extraEvidence.push({
        traceEventId: callEventId,
        traceId: input.traceId,
        evidenceKind: "semantic_yaml_node",
        evidenceRef,
        evidenceHash: hashArtifact(
          JSON.stringify({
            connectionId,
            schema,
            sourceName,
            physicalTable
          })
        ),
        relation: input.policyDecision?.allowed === false ? "denied_by" : "used",
        metadata: {
          physicalTable,
          connectionId,
          schema,
          sourceName,
          confidence: ref.confidence ?? null
        }
      });
    }
  }

  if (extraEvidence.length > 0) {
    writeEvidenceEvents(database, extraEvidence);
  }

  return { callEventId, policyEventId };
}

export interface PurgeTraceEvidenceOptions {
  now?: Date;
  retentionDays?: number;
  maxRows?: number;
  maxBytes?: number;
  /** Extra trace IDs that must not be purged (e.g. active release packages). */
  protectedTraceIds?: Iterable<string>;
  incrementalVacuumPages?: number;
}

export interface PurgeTraceEvidenceResult {
  deletedTraceEvents: number;
  deletedEvidenceEvents: number;
  protectedTraceCount: number;
  candidateTraceCount: number;
  vacuumPages: number;
  reason: "noop" | "retention_days" | "max_rows" | "max_bytes" | "mixed";
}

/**
 * Purge oldest Trace / Evidence rows when retention caps are exceeded.
 * Preserves traces that still carry `reviewer_override` or `promoted` evidence,
 * plus any explicitly protected trace IDs. Never deletes those protected traces.
 * After deletes, may run `PRAGMA incremental_vacuum(N)`.
 */
export function purgeTraceEvidence(
  database: Database.Database,
  options: PurgeTraceEvidenceOptions = {}
): PurgeTraceEvidenceResult {
  ensureTraceEvidenceSchema(database);
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? TRACE_RETENTION_DAYS;
  const maxRows = options.maxRows ?? TRACE_MAX_ROWS;
  const maxBytes = options.maxBytes ?? TRACE_MAX_BYTES;
  const vacuumPages = Math.max(0, options.incrementalVacuumPages ?? 64);

  const protectedSet = new Set<string>();
  for (const id of options.protectedTraceIds ?? []) {
    if (id) protectedSet.add(id);
  }
  const protectedFromEvidence = database
    .prepare(
      `SELECT DISTINCT trace_id AS traceId
       FROM evidence_events
       WHERE relation IN ('reviewer_override', 'promoted')`
    )
    .all() as Array<{ traceId: string }>;
  for (const row of protectedFromEvidence) {
    if (row.traceId) protectedSet.add(row.traceId);
  }

  const totalRows = Number(
    (
      database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM trace_events) +
             (SELECT COUNT(*) FROM evidence_events) AS cnt`
        )
        .get() as { cnt: number }
    )?.cnt ?? 0
  );

  let fileBytes = 0;
  try {
    const pageCount = Number(database.pragma("page_count", { simple: true }) ?? 0);
    const pageSize = Number(database.pragma("page_size", { simple: true }) ?? 0);
    fileBytes = pageCount * pageSize;
  } catch {
    fileBytes = 0;
  }

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const overRows = totalRows > maxRows;
  const overBytes = fileBytes > maxBytes;
  const agedIds = new Set(
    (
      database
        .prepare(
          `SELECT DISTINCT trace_id AS traceId
           FROM trace_events
           WHERE created_at < ?`
        )
        .all(cutoff) as Array<{ traceId: string }>
    )
      .map((row) => row.traceId)
      .filter((id) => id && !protectedSet.has(id))
  );

  const oldestOrder = database
    .prepare(
      `SELECT trace_id AS traceId, MIN(created_at) AS firstSeen
       FROM trace_events
       GROUP BY trace_id
       ORDER BY firstSeen ASC`
    )
    .all() as Array<{ traceId: string }>;

  const toDelete: string[] = [];
  let remainingRows = totalRows;
  for (const row of oldestOrder) {
    if (!row.traceId || protectedSet.has(row.traceId)) continue;
    const isAged = agedIds.has(row.traceId);
    const needCapacity = remainingRows > maxRows || fileBytes > maxBytes;
    if (!isAged && !needCapacity) continue;

    const counts = database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM trace_events WHERE trace_id = ?) +
           (SELECT COUNT(*) FROM evidence_events WHERE trace_id = ?) AS cnt`
      )
      .get(row.traceId, row.traceId) as { cnt: number };
    toDelete.push(row.traceId);
    remainingRows -= Number(counts?.cnt ?? 0);
  }

  if (toDelete.length === 0) {
    return {
      deletedTraceEvents: 0,
      deletedEvidenceEvents: 0,
      protectedTraceCount: protectedSet.size,
      candidateTraceCount: 0,
      vacuumPages: 0,
      reason: "noop"
    };
  }

  const deleteEvidence = database.prepare(`DELETE FROM evidence_events WHERE trace_id = ?`);
  const deleteTraces = database.prepare(`DELETE FROM trace_events WHERE trace_id = ?`);
  let deletedEvidenceEvents = 0;
  let deletedTraceEvents = 0;
  const tx = database.transaction((ids: string[]) => {
    for (const id of ids) {
      deletedEvidenceEvents += deleteEvidence.run(id).changes;
      deletedTraceEvents += deleteTraces.run(id).changes;
    }
  });
  tx(toDelete);

  let ranVacuum = 0;
  if (vacuumPages > 0 && (deletedEvidenceEvents > 0 || deletedTraceEvents > 0)) {
    try {
      database.pragma(`incremental_vacuum(${vacuumPages})`);
      ranVacuum = vacuumPages;
    } catch {
      ranVacuum = 0;
    }
  }

  const reason: PurgeTraceEvidenceResult["reason"] =
    overRows || overBytes
      ? overRows && overBytes
        ? "mixed"
        : overRows
          ? "max_rows"
          : "max_bytes"
      : agedIds.size > 0
        ? "retention_days"
        : "mixed";

  return {
    deletedTraceEvents,
    deletedEvidenceEvents,
    protectedTraceCount: protectedSet.size,
    candidateTraceCount: toDelete.length,
    vacuumPages: ranVacuum,
    reason
  };
}
