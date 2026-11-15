/**
 * P1-32 / F-6 — as-of proof must not depend on how many rows are in scope.
 *
 * Equivalence: on every scope the frozen legacy implementation can handle
 * (below SQLite's bound-variable limit) the production module returns the same
 * proof and the same projection. Scale: above that limit it must still answer
 * (legacy throws "too many SQL variables" — see the pinned legacy assertion).
 */
import { describe, expect, it } from "vitest";
import { projectAttributionAsOfS, proveExactAsOfS } from "../../proxy/audit-as-of-proof";
import * as legacy from "./legacy/audit-as-of-proof.legacy";
import { createAsOfDb, seedAsOfScenario } from "./fixtures";

const sortMissing = <T extends { missingSets: Record<string, string[]> }>(proof: T) => ({
  ...proof,
  missingSets: Object.fromEntries(Object.entries(proof.missingSets).map(([k, v]) => [k, [...v].sort()]))
});

describe("F-6 equivalence with the frozen legacy implementation (scope below the variable limit)", () => {
  for (const n of [0, 1, 37, 600, 2500]) {
    it(`proof and projection are identical for ${n} rows`, () => {
      const db = createAsOfDb();
      const { rows, bound } = seedAsOfScenario(db, n);
      const nowProj = projectAttributionAsOfS(db, rows.map((r) => ({ id: r.id, lucy_turn_id: r.turnId })), bound);
      const oldProj = legacy.projectAttributionAsOfS(db, rows.map((r) => ({ id: r.id, lucy_turn_id: r.turnId })), bound);
      expect(nowProj.rows).toEqual(oldProj.rows);
      expect([...nowProj.replayedMutationIds].sort((a, b) => a - b)).toEqual([...oldProj.replayedMutationIds].sort((a, b) => a - b));
      expect([...nowProj.unreplayableMutationIds].sort((a, b) => a - b)).toEqual([...oldProj.unreplayableMutationIds].sort((a, b) => a - b));
      expect([...nowProj.excludedSourceIds].sort((a, b) => a - b)).toEqual([...oldProj.excludedSourceIds].sort((a, b) => a - b));
      const input = {
        db,
        seqUpperBound: bound,
        rows,
        replayedMutationIds: oldProj.replayedMutationIds,
        excludedSourceIds: oldProj.excludedSourceIds
      };
      expect(sortMissing(proveExactAsOfS(input))).toEqual(sortMissing(legacy.proveExactAsOfS(input)));
    });
  }
});

describe("F-6 scale: scope larger than SQLite's bound-variable limit", () => {
  const N = 40_000; // > 32,766 (better-sqlite3 default SQLITE_MAX_VARIABLE_NUMBER)

  it("pins the defect: the legacy implementation cannot answer at this scope", () => {
    const db = createAsOfDb();
    const { rows, bound } = seedAsOfScenario(db, N);
    expect(() => legacy.proveExactAsOfS({ db, seqUpperBound: bound, rows })).toThrow(/too many SQL variables|Too many parameter/i);
  });

  it("production answers, and the answer equals counts derived straight from SQL", () => {
    const db = createAsOfDb();
    const { rows, bound } = seedAsOfScenario(db, N);
    const proj = projectAttributionAsOfS(db, rows.map((r) => ({ id: r.id, lucy_turn_id: r.turnId })), bound);
    const lateSources = db.prepare("SELECT COUNT(*) n FROM access_log_sources WHERE ledger_seq > ?").get(bound) as { n: number };
    expect(proj.excludedSourceIds.length).toBe(lateSources.n);
    const proof = proveExactAsOfS({ db, seqUpperBound: bound, rows, replayedMutationIds: proj.replayedMutationIds, excludedSourceIds: proj.excludedSourceIds });
    const unpositionedSources = db.prepare("SELECT COUNT(*) n FROM access_log_sources WHERE ledger_seq IS NULL").get() as { n: number };
    expect(proof.missingSets.relations.filter((m) => m.startsWith("unpositioned_source:")).length).toBe(unpositionedSources.n);
    const unpositionedRows = rows.filter((r) => r.ledgerSeq === null).length;
    expect(proof.missingSets.baseFacts.filter((m) => m.startsWith("unpositioned_row:")).length).toBe(unpositionedRows);
  });
}, 60_000);
