/** FROZEN REFERENCE (P1-33 / F-7): `inquiryWhere` as shipped in reconciliation.ts (IFNULL(col,'') = ? on three columns — not index-usable). Do NOT edit. */
import type Database from "better-sqlite3";

function tableExists(db: Database.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

export function legacyInquiryWhere(
  db: Database.Database,
  turnId: string,
  columns: Set<string>
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (columns.has("lucy_turn_id")) {
    clauses.push("IFNULL(lucy_turn_id, '') = ?");
    params.push(turnId);
  }
  if (columns.has("effective_turn_id")) {
    clauses.push("IFNULL(effective_turn_id, '') = ?");
    params.push(turnId);
  }
  if (columns.has("original_turn_id")) {
    clauses.push("IFNULL(original_turn_id, '') = ?");
    params.push(turnId);
  }
  if (tableExists(db, "inferred_turn_access_logs")) {
    clauses.push(
      "id IN (SELECT access_log_id FROM inferred_turn_access_logs WHERE inferred_turn_id = ?)"
    );
    params.push(turnId);
  }
  if (clauses.length === 0) {
    return { where: "1 = 0", params: [] };
  }
  return { where: `(${clauses.join(" OR ")})`, params };
}
