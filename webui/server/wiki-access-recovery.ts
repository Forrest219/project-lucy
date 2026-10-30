import { getSecurityStore } from "./security/instance.js";
import { resolveProjectRoot } from "./project.js";
import type { WikiAccessOperationRecord } from "./security/types.js";
import { invalidateWikiAccessHoldCache } from "./wiki-access-holds.js";
import { readWikiBytes } from "./wiki-access-operation.js";
import { wikiContentHash } from "./wiki-hash.js";

/**
 * Spec 193 §8.2 — the startup reconstruction of the widening hold.
 *
 * A crash between "the durable operation exists" and "the security operation
 * was committed" leaves a hold. The startup pass reconciles the evidence:
 *
 * - the file still holds the OLD bytes → the operation is aborted and the
 *   hold is released; the write never happened,
 * - the file holds the TARGET bytes and the direction is narrow / neutral →
 *   the operation is committed (the system is not wider than intended),
 * - the file holds the TARGET bytes and the direction is a WIDENING → the
 *   operation becomes `needs_review` and the hold STAYS. Recovery never
 *   ratifies a widening on its own,
 * - the evidence cannot be read or does not match → `needs_review`, the hold
 *   stays.
 *
 * The pass never replays a write and never continues a bulk execution loop.
 */
export interface WikiAccessRecoveryReport {
  committed: string[];
  aborted: string[];
  needsReview: string[];
  unresolved: string[];
  /** True when at least one key stays held. */
  holdWidening: boolean;
}

export async function recoverWikiAccessOperations(): Promise<WikiAccessRecoveryReport> {
  const report: WikiAccessRecoveryReport = {
    committed: [],
    aborted: [],
    needsReview: [],
    unresolved: [],
    holdWidening: false
  };

  const store = await getSecurityStore();
  if (!store.ok) {
    // Fail closed: an unreadable projection means every key stays denied.
    report.holdWidening = true;
    return report;
  }
  const pending = store.value.listWikiAccessOperations("pending");
  if (!pending.ok) {
    report.holdWidening = true;
    return report;
  }
  const review = store.value.listWikiAccessOperations("needs_review");
  if (review.ok) {
    for (const record of review.value) {
      report.needsReview.push(record.operationId);
      report.holdWidening = true;
    }
  }

  for (const record of pending.value) {
    await reconcileOne(record, report);
  }

  invalidateWikiAccessHoldCache();
  return report;
}

async function reconcileOne(
  record: WikiAccessOperationRecord,
  report: WikiAccessRecoveryReport
): Promise<void> {
  const store = await getSecurityStore();
  if (!store.ok) {
    report.unresolved.push(record.operationId);
    report.holdWidening = true;
    return;
  }

  let currentHash: string | null = null;
  try {
    const projectRoot = await resolveProjectRoot();
    const current = await readWikiBytes(projectRoot, record.wikiKey);
    currentHash = current === null ? null : wikiContentHash(current);
  } catch {
    currentHash = null;
  }

  if (currentHash !== null && record.oldHash && currentHash === record.oldHash) {
    const aborted = store.value.abortWikiAccessOperation(
      record.operationId,
      "recovered: the previous bytes are still stored"
    );
    if (aborted.ok) {
      report.aborted.push(record.operationId);
      return;
    }
  }

  if (currentHash !== null && record.targetHash && currentHash === record.targetHash) {
    if (record.direction === "widen") {
      // The bytes are wider than before and the security operation was never
      // committed: the key stays held for an operator.
      const needsReview = store.value.markWikiAccessOperationNeedsReview(
        record.operationId,
        "recovered: a widening reached the disk without a committed security operation"
      );
      if (needsReview.ok) {
        store.value.markPendingWikiBatchItemsNeedsReview(
          record.wikiKey,
          "recovered: a widening reached the disk without a committed security operation"
        );
        report.needsReview.push(record.operationId);
        report.holdWidening = true;
        return;
      }
    } else {
      const committed = store.value.commitWikiAccessOperation(record.operationId, "recovery", "system");
      if (committed.ok) {
        report.committed.push(record.operationId);
        return;
      }
    }
  }

  // The evidence is unknown: stay denied until an operator resolves it.
  const needsReview = store.value.markWikiAccessOperationNeedsReview(
    record.operationId,
    "recovered: the stored bytes do not match the operation evidence"
  );
  if (needsReview.ok) {
    report.needsReview.push(record.operationId);
  } else {
    report.unresolved.push(record.operationId);
  }
  report.holdWidening = true;
}
