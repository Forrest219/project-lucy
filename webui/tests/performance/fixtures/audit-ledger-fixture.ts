import type Database from "better-sqlite3";
import { openSecurityStore } from "../../../server/security/store.ts";
import { isTokenRevoked } from "../../../server/proxy/audit.ts";

/** Synthetic canonical-ledger size used to make scale rows "provable" (P1-31 sweep; not an incident measurement). */
export const AUDIT_LEDGER = { events: 2_000 } as const;

/**
 * Turns an already-seeded scale audit database into one that passes the exact as-of-S proof.
 *
 * Production writes `ledger_seq` (the committed canonical-ledger upper bound) on every audit row.
 * `seedAuditScale` leaves it NULL, so formal reconciliation / v2 export routes answer 409
 * and can't be timed. This appends real events to the real security store under `projectRoot`,
 * then spreads `ledger_seq` over the rows (monotone in row id) and pins the attribution-journal
 * baseline to 0. Only fixture data is written; no runtime code path is changed.
 */
export async function seedAuditLedgerProof(database: Database.Database, projectRoot: string): Promise<{ seqUpperBound: number }> {
  // The proxy-side opener owns the `ledger_seq` / as-of migrations; any read of it runs them (as the first proxy write does in production).
  await isTokenRevoked("sweep-fixture");
  const opened = openSecurityStore(projectRoot);
  if (!opened.ok) throw new Error(`security store unavailable: ${opened.message}`);
  const store = opened.value;
  try {
    const stamp = Date.now();
    const appended = store.appendEventsBatch(
      Array.from({ length: AUDIT_LEDGER.events }, (_, index) => ({
        eventId: `sweep-ledger-${stamp}-${index}`,
        operationId: `sweep-op-${stamp}-${index}`,
        phase: "prepare" as const,
        actor: "sweep-fixture",
        actorType: "ui_admin"
      }))
    );
    if (!appended.ok) throw new Error(`ledger append failed: ${appended.message}`);
    const max = store.maxEventSeq();
    if (!max.ok) throw new Error(`ledger max seq failed: ${max.message}`);
    const bound = max.value;
    const maxId = (database.prepare("SELECT MAX(id) AS m FROM access_log").get() as { m: number | null }).m ?? 0;
    if (maxId > 0) {
      database
        .prepare("UPDATE access_log SET ledger_seq = 1 + CAST((id - 1) * ? / ? AS INTEGER)")
        .run(bound - 1, maxId);
      database
        .prepare(
          "UPDATE access_log_sources SET ledger_seq = (SELECT l.ledger_seq FROM access_log l WHERE l.id = access_log_sources.access_log_id)"
        )
        .run();
    }
    database
      .prepare("INSERT OR REPLACE INTO access_log_asof_meta (key, value) VALUES ('attribution_journal_baseline_seq', '0')")
      .run();
    return { seqUpperBound: bound };
  } finally {
    store.close();
  }
}
