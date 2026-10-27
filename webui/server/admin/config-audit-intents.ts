/**
 * Lucy v0.25 — the unterminated access-configuration intents.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §14.3.1
 * ("恢复标记仅把 `ENOENT` 且不存在未终结行策略 intent 视为无待恢复状态").
 *
 * Contract:
 * - A durable intent is persisted BEFORE the configuration is written. While the
 *   write is in flight the intent is legitimately `pending` — that is not an
 *   unresolved recovery. The intents of THIS process are therefore registered
 *   as in flight and excluded from the count.
 * - At STARTUP the in-flight registry is empty, so every `pending` intent is
 *   from a previous process: the on-disk state is not provable and the gate
 *   closes conservatively.
 * - The counter lives in its OWN module on purpose: the configuration-audit
 *   module is replaced wholesale in several test suites, and a counter that
 *   disappears with the mock would turn every write into a false recovery.
 */
import { getAuditDb } from "./audit.js";

/** The access-configuration file whose intents gate the recovery. */
export const ACCESS_CONFIG_AUDIT_FILE_PATH = "webui/config/access.yaml";

/**
 * The intent ids of the writes this process currently has in flight.
 *
 * They are registered the moment the intent is persisted and released when the
 * terminal record is written (or when the write is known to have ended).
 */
const inFlightIntentIds = new Set<number>();

export function registerInFlightAccessConfigIntent(intentId: number | undefined): void {
  if (intentId === undefined) return;
  inFlightIntentIds.add(intentId);
}

export function releaseInFlightAccessConfigIntent(intentId: number | undefined): void {
  if (intentId === undefined) return;
  inFlightIntentIds.delete(intentId);
}

/** Test helper: forget every in-flight intent. */
export function resetInFlightAccessConfigIntentsForTests(): void {
  inFlightIntentIds.clear();
}

/**
 * Count the access-configuration intents that were persisted but never
 * terminated, EXCLUDING the ones this process currently has in flight.
 *
 * Returns `undefined` when the count could not be established — the state is
 * then not provable and the caller must close the gate.
 */
export async function countUnterminatedAccessConfigIntents(): Promise<number | undefined> {
  try {
    const database = await getAuditDb();
    const row = database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM config_change_log
         WHERE write_status = 'pending'
           AND file_path = ?`
      )
      .get(ACCESS_CONFIG_AUDIT_FILE_PATH) as { count?: number } | undefined;
    const pending = Number(row?.count ?? 0);
    let inFlight = 0;
    for (const id of inFlightIntentIds) {
      const hit = database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM config_change_log
           WHERE id = ? AND write_status = 'pending' AND file_path = ?`
        )
        .get(id, ACCESS_CONFIG_AUDIT_FILE_PATH) as { count?: number } | undefined;
      if (Number(hit?.count ?? 0) > 0) inFlight += 1;
    }
    return Math.max(0, pending - inFlight);
  } catch {
    return undefined;
  }
}
