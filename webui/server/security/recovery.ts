import type { SecurityStore } from "./store";
import type { PendingOperation, SecurityFailure, SecurityResult } from "./types";

/**
 * What the caller can prove about the external side effect (config/file write)
 * of a prepared operation after a crash.
 */
export type RecoveryEvidence = "applied" | "not_applied" | "unknown";

export type OperationInspector = (operation: PendingOperation) => RecoveryEvidence | Promise<RecoveryEvidence>;

export type RecoveryReport = {
  /** Effect proven present and not wider than before → committed during recovery. */
  committed: string[];
  /** Effect proven absent → aborted. Never reported as success. */
  aborted: string[];
  /** Widening effect present without commit → held for operator review (not success). */
  needsReview: string[];
  /** Evidence unavailable → left `pending`; still not success. */
  unresolved: string[];
  /** True when any widening operation is unresolved or in review; callers should stay in the stricter state. */
  holdWidening: boolean;
};

const RECOVERY_ACTOR = "recovery";

/**
 * Resolve operations left `pending` by a crash (D2: security store is written first).
 *
 * Rules:
 * - `not_applied` → abort, whatever the direction.
 * - `applied` + narrow/neutral → roll forward (commit); the system is no wider than intended.
 * - `applied` + widen → `needs_review`; recovery never ratifies a wider permission on its own.
 * - `unknown` or inspector failure → stays `pending`; a pending operation is never treated as success.
 */
export async function recoverPendingOperations(
  store: SecurityStore,
  inspect: OperationInspector
): Promise<SecurityResult<RecoveryReport>> {
  const pending = store.listOperations("pending");
  if (!pending.ok) return pending;
  const review = store.listOperations("needs_review");
  if (!review.ok) return review;

  const report: RecoveryReport = { committed: [], aborted: [], needsReview: [], unresolved: [], holdWidening: false };
  for (const held of review.value) report.needsReview.push(held.operationId);
  if (review.value.some((op) => op.direction === "widen")) report.holdWidening = true;

  for (const operation of pending.value) {
    const outcome = await resolveOne(store, operation, inspect);
    if (!outcome.ok) return outcome;
    report[outcome.value].push(operation.operationId);
    if (outcome.value !== "committed" && outcome.value !== "aborted" && operation.direction === "widen") {
      report.holdWidening = true;
    }
  }
  return { ok: true, value: report };
}

type Bucket = "committed" | "aborted" | "needsReview" | "unresolved";

async function resolveOne(
  store: SecurityStore,
  operation: PendingOperation,
  inspect: OperationInspector
): Promise<SecurityResult<Bucket>> {
  let evidence: RecoveryEvidence;
  try {
    evidence = await inspect(operation);
  } catch {
    evidence = "unknown";
  }
  if (evidence === "not_applied") {
    return mapResult(store.abortOperation(operation.operationId, "recovered: effect not applied", RECOVERY_ACTOR), "aborted");
  }
  if (evidence === "applied") {
    if (operation.direction === "widen") {
      return mapResult(
        store.markOperationNeedsReview(operation.operationId, "recovered: widening effect present without commit"),
        "needsReview"
      );
    }
    return mapResult(store.commitOperation(operation.operationId, RECOVERY_ACTOR), "committed");
  }
  return { ok: true, value: "unresolved" };
}

function mapResult(result: SecurityResult<unknown>, bucket: Bucket): SecurityResult<Bucket> {
  return result.ok ? { ok: true, value: bucket } : (result as SecurityFailure);
}

export type ProjectionRecovery = {
  cursor: number;
  latestSeq: number;
  /** Events durable in the security store but not yet confirmed as projected. */
  lag: number;
  /** Mirrors the audit `complete` flag: false while lag > 0. */
  complete: boolean;
};

/**
 * Reconcile the projection cursor after a crash between "projected" and "cursor committed".
 * `highestProjectedSeq` is what the (idempotent) projector can prove it already wrote.
 * The cursor only moves forward, never past durable events, and never past what was proven.
 */
export async function recoverProjectionCursor(
  store: SecurityStore,
  projector: string,
  highestProjectedSeq: () => number | Promise<number>
): Promise<SecurityResult<ProjectionRecovery>> {
  const cursor = store.getProjectionCursor(projector);
  if (!cursor.ok) return cursor;
  const latest = store.maxEventSeq();
  if (!latest.ok) return latest;

  let proven = 0;
  try {
    proven = await highestProjectedSeq();
  } catch {
    proven = 0;
  }
  const target = Math.min(Math.max(proven, 0), latest.value);
  let current = cursor.value;
  if (target > current) {
    const advanced = store.advanceProjectionCursor(projector, target);
    if (!advanced.ok) return advanced;
    current = advanced.value;
  }
  const lag = latest.value - current;
  return { ok: true, value: { cursor: current, latestSeq: latest.value, lag, complete: lag === 0 } };
}
