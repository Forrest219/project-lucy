import type { SecurityStore } from "./security/store.js";
import type {
  WikiAccessBatchItemRecord,
  WikiAccessBatchRecord,
  WikiBatchItemStatus
} from "./security/types.js";

/**
 * Spec 193 §7.5 — the recoverable bulk authorization journal.
 *
 * The journal lives in `.ktx-ui/security.sqlite` (FULL persistence, 0600
 * permissions) together with the idempotency binding. There is NO JSON
 * sidecar: a second fact source for authorization state is forbidden.
 *
 * The journal records only metadata — the Wiki key, the content version, an
 * ACL summary, the status, the actor, the time and a stable error code. It
 * never records the Markdown body, a credential or an absolute host path.
 */

export interface WikiBatchJournalItem {
  operationId: string;
  wikiKey: string;
  expectedVersion: string | null;
  targetHash: string | null;
  aclSummary: string | null;
  direction: string | null;
  status: WikiBatchItemStatus;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: number;
}

export interface WikiBatchJournal {
  record: WikiAccessBatchRecord;
  items: WikiBatchJournalItem[];
}

/** Create the durable journal AND the idempotency binding in one transaction. */
export function createWikiBatchJournal(
  store: SecurityStore,
  input: {
    operationId: string;
    planDigest: string;
    idempotencyKey: string;
    actionJson: string;
    roleChannelVersion: string;
    items: Array<{
      wikiKey: string;
      expectedVersion: string | null;
      targetHash?: string | null;
      aclSummary?: string | null;
      direction?: string | null;
    }>;
  }
): WikiAccessBatchRecord | null {
  const created = store.createWikiAccessBatch(input);
  return created.ok ? created.value : null;
}

/** Read the journal of one operation. */
export function readWikiBatchJournal(
  store: SecurityStore,
  operationId: string
): WikiBatchJournal | null {
  const record = store.getWikiAccessBatch(operationId);
  if (!record.ok || !record.value) return null;
  const items = store.listWikiAccessBatchItems(operationId);
  if (!items.ok) return null;
  return { record: record.value, items: items.value };
}

/** The idempotency binding of an idempotency key. */
export function findWikiBatchByIdempotencyKey(
  store: SecurityStore,
  idempotencyKey: string
): WikiAccessBatchRecord | null {
  const found = store.findWikiAccessBatchByIdempotencyKey(idempotencyKey);
  return found.ok ? found.value : null;
}

/** Persist one per-document result. */
export function updateWikiBatchItem(
  store: SecurityStore,
  input: {
    operationId: string;
    wikiKey: string;
    status: WikiBatchItemStatus;
    targetHash?: string | null;
    aclSummary?: string | null;
    direction?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }
): WikiAccessBatchItemRecord | null {
  const updated = store.updateWikiAccessBatchItemStatus(input);
  return updated.ok ? updated.value : null;
}

/** Persist the terminal batch status. */
export function setWikiBatchStatus(
  store: SecurityStore,
  operationId: string,
  status: WikiAccessBatchRecord["status"]
): WikiAccessBatchRecord | null {
  const updated = store.setWikiAccessBatchStatus(operationId, status);
  return updated.ok ? updated.value : null;
}
