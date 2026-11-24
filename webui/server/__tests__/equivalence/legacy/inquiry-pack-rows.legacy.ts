/**
 * FROZEN REFERENCE (P1-32 / F-1). The SQL the `export-inquiry-pack` handler shipped with
 * (audit.ts, pre-fix): unbounded `IN (@turnN…)` twice + per-row EXISTS on an un-indexed
 * `access_log_id`. Oracle for `inquiry-pack-rows.equivalence.test.ts`. Do NOT edit.
 */
import type Database from "better-sqlite3";

export function legacyInquiryPackCallRows(
  database: Database.Database,
  filter: { conditions: readonly string[]; params: Record<string, unknown> },
  turnIds: readonly string[]
): Array<Record<string, unknown> & { id: number }> {
  const conditions = [...filter.conditions];
  const params = { ...filter.params };
  if (turnIds.length > 0) {
    const placeholders = turnIds.map((_, index) => `@turn${index}`);
    turnIds.forEach((id, index) => {
      params[`turn${index}`] = id;
    });
    conditions.push(`(
        IFNULL(lucy_turn_id, '') IN (${placeholders.join(", ")})
        OR EXISTS (
          SELECT 1 FROM inferred_turn_access_logs ital
          WHERE ital.access_log_id = access_log.id AND ital.inferred_turn_id IN (${placeholders.join(", ")})
        )
      )`);
  } else {
    conditions.push("1 = 0");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return database.prepare(`SELECT * FROM access_log ${where} ORDER BY ts DESC, id DESC`).all(params) as Array<
    Record<string, unknown> & { id: number }
  >;
}
