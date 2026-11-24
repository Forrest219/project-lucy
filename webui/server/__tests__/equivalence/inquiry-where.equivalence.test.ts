/**
 * P1-33 / F-7 — inquiry-scoped call selection used by reconciliation (one query per inquiry in
 * `reconciliation/export`). Equivalence with the frozen legacy predicate; and the new predicate
 * must be index-backed (legacy scans `access_log` once per inquiry: 61 × full scan per export).
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { inquiryWhere, probeColumns } from "../../admin/reconciliation";
import { legacyInquiryWhere } from "./legacy/inquiry-where.legacy";
import { rng } from "./fixtures";

function seed(calls: number, withLinkTable = true, withTurnColumns = true) {
  const rand = rng(5);
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, lucy_turn_id TEXT${withTurnColumns ? ", effective_turn_id TEXT, original_turn_id TEXT" : ""});
    CREATE INDEX idx_al_lucy_turn_id ON access_log(lucy_turn_id);
    ${withTurnColumns ? "CREATE INDEX idx_al_effective_turn_id ON access_log(effective_turn_id); CREATE INDEX idx_al_original_turn_id ON access_log(original_turn_id);" : ""}
    ${withLinkTable ? "CREATE TABLE inferred_turn_access_logs (inferred_turn_id TEXT NOT NULL, access_log_id INTEGER NOT NULL, PRIMARY KEY(inferred_turn_id, access_log_id)); CREATE INDEX idx_ital_access_log ON inferred_turn_access_logs(access_log_id);" : ""}`);
  const pick = (r: number, n: number) => (r < 0.3 ? null : r < 0.35 ? "" : `t${Math.floor(rand() * n)}`);
  const ins = db.prepare(withTurnColumns ? "INSERT INTO access_log (ts, lucy_turn_id, effective_turn_id, original_turn_id) VALUES (?,?,?,?)" : "INSERT INTO access_log (ts, lucy_turn_id) VALUES (?,?)");
  const link = withLinkTable ? db.prepare("INSERT OR IGNORE INTO inferred_turn_access_logs VALUES (?,?)") : null;
  db.transaction(() => {
    for (let i = 0; i < calls; i += 1) {
      const n = Math.max(2, Math.floor(calls / 20));
      const info = withTurnColumns
        ? ins.run(`2026-11-15T00:00:${String(i % 60).padStart(2, "0")}Z`, pick(rand(), n), pick(rand(), n), pick(rand(), n))
        : ins.run(`2026-11-15T00:00:${String(i % 60).padStart(2, "0")}Z`, pick(rand(), n));
      if (link && rand() < 0.3) link.run(`t${Math.floor(rand() * n)}`, Number(info.lastInsertRowid));
    }
  })();
  return db;
}

const idsFor = (db: Database.Database, w: { where: string; params: unknown[] }) =>
  (db.prepare(`SELECT id FROM access_log WHERE (${w.where}) ORDER BY ts ASC, id ASC`).all(...w.params) as Array<{ id: number }>).map((r) => r.id);

describe("F-7 inquiry predicate equivalence", () => {
  for (const [label, link, cols] of [["full schema", true, true], ["no link table", false, true], ["no effective/original columns", true, false]] as const) {
    it(`${label}: every inquiry id selects the same calls as the legacy predicate`, () => {
      const db = seed(1500, link, cols);
      const columns = probeColumns(db, "access_log");
      for (const turnId of ["t0", "t1", "t7", "t19", "t60", "t999", "nope", "", " "]) {
        expect(idsFor(db, inquiryWhere(db, turnId, columns)), `turn "${turnId}"`).toEqual(idsFor(db, legacyInquiryWhere(db, turnId, columns)));
      }
    });
  }

  it("empty-string inquiry id still matches NULL columns (legacy IFNULL semantics)", () => {
    const db = seed(400);
    const columns = probeColumns(db, "access_log");
    const now = idsFor(db, inquiryWhere(db, "", columns));
    expect(now.length).toBeGreaterThan(0);
    expect(now).toEqual(idsFor(db, legacyInquiryWhere(db, "", columns)));
  });

  it("no usable column and no link table → empty scope, same as legacy", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY, ts TEXT)");
    expect(inquiryWhere(db, "t1", probeColumns(db, "access_log"))).toEqual(legacyInquiryWhere(db, "t1", probeColumns(db, "access_log")));
  });

  it("the predicate is index-backed (no full scan of access_log)", () => {
    const db = seed(2000);
    const w = inquiryWhere(db, "t3", probeColumns(db, "access_log"));
    const detail = (db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM access_log WHERE (${w.where}) ORDER BY ts ASC, id ASC`).all(...w.params) as Array<{ detail: string }>).map((r) => r.detail).join(" | ");
    expect(detail).not.toMatch(/SCAN access_log(?! USING)/);
    expect(detail).toMatch(/SEARCH access_log USING (COVERING )?INDEX/);
  });
});
