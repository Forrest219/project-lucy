import type Database from "better-sqlite3";
import type { SecurityStore } from "./store.js";
import type { SecurityEvent, SecurityResult } from "./types.js";

/**
 * T07 / Spec §5.2 — idempotent projector from the security ledger into the
 * audit database.
 *
 * - The ledger (`security_events`) is canonical; `audit.sqlite` is a rebuildable
 *   projection. A projection failure never loses ledger events.
 * - The projection cursor lives in the *target* database and moves in the same
 *   transaction as the rows it covers, so a crash can neither skip nor double-apply
 *   an event. The ledger's `projection_cursors` is only a mirror, reconciled by
 *   `recoverProjectionCursor` from what the target proves.
 * - One row per operation (merged from its events), keyed by `operation_id`:
 *   pause / resume / full replay produces the same rows and counts.
 * - While events are not yet projected the status reports `complete=false` with
 *   the lag; callers must not present a lagging projection as complete.
 */

export const AUDIT_PROJECTOR_NAME = "audit.operations";
const DEFAULT_BATCH = 500;
const SLICE_EVENTS = 120;

const PROJECTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS security_projection_cursor (
  projector  TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS security_operation_projection (
  operation_id        TEXT PRIMARY KEY,
  kind                TEXT NOT NULL,
  state               TEXT NOT NULL,
  first_seq           INTEGER NOT NULL,
  last_seq            INTEGER NOT NULL,
  actor               TEXT NOT NULL,
  actor_type          TEXT NOT NULL,
  network_info        TEXT NOT NULL DEFAULT '',
  session_fingerprint TEXT NOT NULL DEFAULT '',
  trace_id            TEXT NOT NULL DEFAULT '',
  policy_version      TEXT NOT NULL DEFAULT '',
  context_version     TEXT NOT NULL DEFAULT '',
  method              TEXT NOT NULL DEFAULT '',
  tool                TEXT NOT NULL DEFAULT '',
  response_status     INTEGER,
  response_bytes      INTEGER,
  response_sha256     TEXT NOT NULL DEFAULT '',
  detail              TEXT NOT NULL DEFAULT '',
  admitted_at         INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sop_state ON security_operation_projection(state);
CREATE INDEX IF NOT EXISTS idx_sop_actor ON security_operation_projection(actor, admitted_at);
`;

const prepared = new WeakSet<Database.Database>();

export function ensureProjectionSchema(target: Database.Database): void {
  if (prepared.has(target)) return;
  target.exec(PROJECTION_SCHEMA);
  prepared.add(target);
}

type ProjectedState =
  | "admitted"
  | "prepared"
  | "delivered"
  | "failed"
  | "interrupted"
  | "pending"
  | "committed"
  | "aborted"
  | "needs_review"
  | "recorded";

/** Later events win; equal rank keeps the newer seq. */
const STATE_RANK: Record<ProjectedState, number> = {
  admitted: 1,
  pending: 1,
  recorded: 1,
  prepared: 2,
  delivered: 3,
  failed: 3,
  interrupted: 3,
  committed: 3,
  aborted: 3,
  needs_review: 2
};

function stateOf(event: SecurityEvent): ProjectedState {
  switch (event.phase) {
    case "request_admitted":
      return "admitted";
    case "response_prepared":
      return "prepared";
    case "response_delivered":
      return "delivered";
    case "response_failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "prepare":
      return "pending";
    case "commit":
      return "committed";
    case "abort":
      return "aborted";
    case "recovery":
      return event.verdict === "needs_review" ? "needs_review" : "recorded";
    default:
      return "recorded";
  }
}

function kindOf(event: SecurityEvent): string {
  return event.phase.startsWith("response_") || event.phase === "request_admitted" || event.phase === "interrupted"
    ? "mcp_response"
    : "config_operation";
}

type ProjectionRow = {
  operation_id: string;
  kind: string;
  state: ProjectedState;
  first_seq: number;
  last_seq: number;
  actor: string;
  actor_type: string;
  network_info: string;
  session_fingerprint: string;
  trace_id: string;
  policy_version: string;
  context_version: string;
  method: string;
  tool: string;
  response_status: number | null;
  response_bytes: number | null;
  response_sha256: string;
  detail: string;
  admitted_at: number;
  updated_at: number;
};

function parseSummary(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fold one event into an operation row (pure). Returns `existing` untouched when
 * the event is already reflected (`seq <= last_seq`), so replays are no-ops.
 */
function mergeEvent(existing: ProjectionRow | undefined, event: SecurityEvent): ProjectionRow {
  if (existing && event.seq <= existing.last_seq) return existing;
  const summary = parseSummary(event.resultSummary);
  const next = stateOf(event);
  const keepState = existing && STATE_RANK[existing.state] > STATE_RANK[next];
  const pick = <T>(fresh: T, old: T | undefined, empty: T): T => (fresh !== empty ? fresh : old ?? empty);
  return {
    operation_id: event.operationId,
    kind: kindOf(event),
    state: keepState ? existing.state : next,
    first_seq: existing ? Math.min(existing.first_seq, event.seq) : event.seq,
    last_seq: event.seq,
    actor: event.actor,
    actor_type: event.actorType,
    network_info: pick(event.networkInfo, existing?.network_info, ""),
    session_fingerprint: pick(event.sessionFingerprint, existing?.session_fingerprint, ""),
    trace_id: pick(event.traceId, existing?.trace_id, ""),
    policy_version: pick(event.policyVersion, existing?.policy_version, ""),
    context_version: pick(event.contextVersion, existing?.context_version, ""),
    method: pick(stringField(summary.method), existing?.method, ""),
    tool: pick(stringField(summary.tool), existing?.tool, ""),
    response_status: numberField(summary.status) ?? existing?.response_status ?? null,
    response_bytes: numberField(summary.bytes) ?? existing?.response_bytes ?? null,
    response_sha256: pick(stringField(summary.sha256), existing?.response_sha256, ""),
    detail: (event.phase === "interrupted" ? event.verdict : stringField(summary.reason)) || existing?.detail || "",
    admitted_at: existing?.admitted_at ?? event.createdAt,
    updated_at: event.createdAt
  };
}

type Statements = {
  select: Database.Statement;
  insert: Database.Statement;
  update: Database.Statement;
  cursor: Database.Statement;
};
const statementCache = new WeakMap<Database.Database, Statements>();

function statements(target: Database.Database): Statements {
  let cached = statementCache.get(target);
  if (!cached) {
    cached = {
      select: target.prepare("SELECT * FROM security_operation_projection WHERE operation_id = ?"),
      insert: target.prepare(
        `INSERT INTO security_operation_projection
           (operation_id, kind, state, first_seq, last_seq, actor, actor_type, network_info, session_fingerprint,
            trace_id, policy_version, context_version, method, tool, response_status, response_bytes,
            response_sha256, detail, admitted_at, updated_at)
         VALUES (@operation_id, @kind, @state, @first_seq, @last_seq, @actor, @actor_type, @network_info,
                 @session_fingerprint, @trace_id, @policy_version, @context_version, @method, @tool,
                 @response_status, @response_bytes, @response_sha256, @detail, @admitted_at, @updated_at)`
      ),
      update: target.prepare(
        `UPDATE security_operation_projection SET
           state = @state, first_seq = @first_seq, last_seq = @last_seq, network_info = @network_info,
           session_fingerprint = @session_fingerprint, trace_id = @trace_id, policy_version = @policy_version,
           context_version = @context_version, method = @method, tool = @tool, response_status = @response_status,
           response_bytes = @response_bytes, response_sha256 = @response_sha256, detail = @detail,
           updated_at = @updated_at
         WHERE operation_id = @operation_id`
      ),
      cursor: target.prepare(
        `INSERT INTO security_projection_cursor (projector, last_seq, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(projector) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at`
      )
    };
    statementCache.set(target, cached);
  }
  return cached;
}

/** One write per operation per batch, however many of its events the batch holds. */
function applyBatch(target: Database.Database, events: readonly SecurityEvent[]): void {
  const sql = statements(target);
  const byOperation = new Map<string, SecurityEvent[]>();
  for (const event of events) {
    const group = byOperation.get(event.operationId);
    if (group) group.push(event);
    else byOperation.set(event.operationId, [event]);
  }
  for (const [operationId, group] of byOperation) {
    const existing = sql.select.get(operationId) as ProjectionRow | undefined;
    let row = existing;
    for (const event of group) row = mergeEvent(row, event);
    if (row === existing) continue;
    if (existing) sql.update.run(row);
    else sql.insert.run(row);
  }
}

export function readTargetCursor(target: Database.Database): number {
  ensureProjectionSchema(target);
  const row = target
    .prepare("SELECT last_seq FROM security_projection_cursor WHERE projector = ?")
    .get(AUDIT_PROJECTOR_NAME) as { last_seq: number } | undefined;
  return row?.last_seq ?? 0;
}

export type ProjectionStatus = {
  /** False while any ledger event is not yet reflected in the audit database. */
  complete: boolean;
  cursor: number;
  latestSeq: number;
  lag: number;
  /** Age of the oldest unprojected event; 0 when complete. */
  delayMs: number;
  /** Fixed token describing why the status is not complete, when known. */
  reason?: "projection_lag" | "projection_failed" | "security_store_unavailable";
};

export type ProjectionRun = {
  projected: number;
  status: ProjectionStatus;
};

function unavailableStatus(): ProjectionStatus {
  return { complete: false, cursor: 0, latestSeq: 0, lag: 0, delayMs: 0, reason: "security_store_unavailable" };
}

export function projectionStatus(
  store: SecurityStore,
  target: Database.Database,
  now: () => number = Date.now
): ProjectionStatus {
  const latest = store.maxEventSeq();
  if (!latest.ok) return unavailableStatus();
  const cursor = readTargetCursor(target);
  const lag = Math.max(0, latest.value - cursor);
  if (lag === 0) return { complete: true, cursor, latestSeq: latest.value, lag: 0, delayMs: 0 };
  const oldest = store.listEventsAfter(cursor, 1);
  const delayMs = oldest.ok && oldest.value[0] ? Math.max(0, now() - oldest.value[0].createdAt) : 0;
  return { complete: false, cursor, latestSeq: latest.value, lag, delayMs, reason: "projection_lag" };
}

/**
 * Project every pending ledger event, batch by batch. A batch is one target
 * transaction (rows + cursor); on failure it is rolled back, the cursor stays,
 * and the run reports `projection_failed` — events are never skipped.
 */
export function runProjection(
  store: SecurityStore,
  target: Database.Database,
  options: {
    batchSize?: number;
    /** Stop after this many batches (the scheduler uses 1 to yield between slices). */
    maxBatches?: number;
    /** Advance the ledger's mirror cursor when events were projected (default true). */
    mirror?: boolean;
    now?: () => number;
  } = {}
): ProjectionRun {
  ensureProjectionSchema(target);
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  let projected = 0;
  let lastProjected = 0;
  for (let batches = 0; batches < maxBatches; batches += 1) {
    const cursor = readTargetCursor(target);
    const events = store.listEventsAfter(cursor, batchSize);
    if (!events.ok) return { projected, status: unavailableStatus() };
    if (events.value.length === 0) break;
    const last = events.value[events.value.length - 1]!.seq;
    try {
      target.transaction(() => {
        applyBatch(target, events.value);
        statements(target).cursor.run(AUDIT_PROJECTOR_NAME, last, new Date((options.now ?? Date.now)()).toISOString());
      })();
    } catch {
      return { projected, status: { ...projectionStatus(store, target, options.now), complete: false, reason: "projection_failed" } };
    }
    projected += events.value.length;
    lastProjected = last;
  }
  // Mirror only; the target cursor is authoritative and recoverProjectionCursor re-syncs it.
  if (lastProjected > 0 && options.mirror !== false) store.advanceProjectionCursor(AUDIT_PROJECTOR_NAME, lastProjected);
  return { projected, status: projectionStatus(store, target, options.now) };
}

export type ProjectionSchedulerDeps = {
  getStore: () => Promise<SecurityResult<SecurityStore>>;
  getTarget: () => Promise<Database.Database>;
  onStatus?: (status: ProjectionStatus) => void;
  /** Backstop poll so a missed trigger or earlier failure is retried. */
  intervalMs?: number;
  /** Coalesces bursts of triggers into one run. */
  debounceMs?: number;
};

export type ProjectionScheduler = {
  /** Request a run soon; many calls in a window run once. */
  trigger(): void;
  start(): void;
  stop(): void;
  /** Run now; resolves when the (possibly already running) projection pass finishes. */
  runNow(): Promise<void>;
};

/**
 * Keeps the audit projection current without sitting on the response path.
 * Passes never overlap; a trigger that arrives during a pass schedules one more.
 */
export function createProjectionScheduler(deps: ProjectionSchedulerDeps): ProjectionScheduler {
  const intervalMs = deps.intervalMs ?? 5_000;
  const debounceMs = deps.debounceMs ?? 200;
  let running: Promise<void> | null = null;
  let rerun = false;
  let debounce: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;

  const pass = async (): Promise<void> => {
    try {
      const store = await deps.getStore();
      if (!store.ok) {
        deps.onStatus?.(unavailableStatus());
        return;
      }
      const target = await deps.getTarget();
      // Small slices with a yield between them keep the pass from stalling request handling.
      let run: ProjectionRun;
      let total = 0;
      do {
        run = runProjection(store.value, target, { batchSize: SLICE_EVENTS, maxBatches: 1, mirror: false });
        total += run.projected;
        if (run.projected === SLICE_EVENTS) await new Promise<void>((resolve) => setImmediate(resolve));
      } while (run.projected === SLICE_EVENTS);
      if (total > 0) store.value.advanceProjectionCursor(AUDIT_PROJECTOR_NAME, readTargetCursor(target));
      deps.onStatus?.(run.status);
    } catch (error) {
      console.error("[lucy-audit] projection pass failed", error instanceof Error ? error.message : "unknown");
    }
  };

  const runNow = (): Promise<void> => {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        await pass();
      } while (rerun);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    trigger() {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = undefined;
        void runNow();
      }, debounceMs);
      debounce.unref();
    },
    start() {
      if (poll) return;
      poll = setInterval(() => void runNow(), intervalMs);
      poll.unref();
      void runNow();
    },
    stop() {
      if (debounce) clearTimeout(debounce);
      if (poll) clearInterval(poll);
      debounce = undefined;
      poll = undefined;
    },
    runNow
  };
}
