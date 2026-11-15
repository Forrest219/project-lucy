/**
 * Call rows belonging to a set of inquiries (inquiry-pack export).
 *
 * A call belongs to an inquiry when its `lucy_turn_id` is one of the inquiry ids,
 * or it is linked to one through `inferred_turn_access_logs`. The id set grows with
 * the export window (thousands of inquiries), so it is loaded into a TEMP table and
 * joined once, instead of being expanded into two `IN (@turn0…@turnN)` lists with a
 * per-row `EXISTS` (P1-32 / F-1: ~114 s on 115k calls; set-based 0.3 s).
 */
import type Database from "better-sqlite3";

type QueryRow = Record<string, unknown> & { id: number };

const TEMP_TABLE = "inquiry_pack_turn_ids";

export function selectInquiryPackCallRows(
  database: Database.Database,
  filter: { conditions: readonly string[]; params: Record<string, unknown> },
  turnIds: readonly string[]
): QueryRow[] {
  if (turnIds.length === 0) return [];
  // `lucy_turn_id IN (…)` can use the column index; the legacy `IFNULL(lucy_turn_id,'')` could not.
  // The two differ only for an inquiry id of '' (NULL then counts as ''), kept as an explicit branch.
  const matchesReportedTurn = turnIds.includes("")
    ? `IFNULL(lucy_turn_id, '') IN (SELECT id FROM temp.${TEMP_TABLE})`
    : `lucy_turn_id IN (SELECT id FROM temp.${TEMP_TABLE})`;
  const conditions = [
    ...filter.conditions,
    `(
      ${matchesReportedTurn}
      OR id IN (
        SELECT ital.access_log_id FROM inferred_turn_access_logs ital
        JOIN temp.${TEMP_TABLE} t ON t.id = ital.inferred_turn_id
      )
    )`
  ];
  database.exec(`CREATE TEMP TABLE IF NOT EXISTS ${TEMP_TABLE} (id TEXT PRIMARY KEY) WITHOUT ROWID; DELETE FROM temp.${TEMP_TABLE};`);
  try {
    const insert = database.prepare(`INSERT OR IGNORE INTO temp.${TEMP_TABLE} (id) VALUES (?)`);
    database.transaction(() => {
      for (const id of turnIds) insert.run(id);
    })();
    return database
      .prepare(`SELECT * FROM access_log WHERE ${conditions.join(" AND ")} ORDER BY ts DESC, id DESC`)
      .all(filter.params) as QueryRow[];
  } finally {
    database.exec(`DELETE FROM temp.${TEMP_TABLE}`);
  }
}
