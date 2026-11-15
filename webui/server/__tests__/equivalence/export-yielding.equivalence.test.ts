/**
 * P1-32 / P1-33 (F-1, F-4) — large exports are built in slices that yield to the event loop.
 * Equivalence: the sliced result is identical to the one-shot result (rows, CSV text), for slice
 * boundaries that fall mid-row-set, on rows with hostile CSV content. Behaviour: a macrotask
 * scheduled before the build runs BEFORE the build finishes (the one-shot version cannot).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rng } from "./fixtures";
import { EXPORT_SLICE_ROWS, mapSlicesYielding } from "../../admin/yield-slices";

let dir: string;
let prev: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-export-yield-"));
  prev = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
});
afterEach(async () => {
  if (prev === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = prev;
  (await import("../../admin/audit")).resetAuditDbForTests();
  await rm(dir, { recursive: true, force: true });
});

async function seedRows(count: number) {
  const { getAuditDb } = await import("../../admin/audit");
  const db = await getAuditDb();
  const rand = rng(77);
  const ins = db.prepare(`INSERT INTO access_log (ts, user_id, tool, outcome, lucy_session_id, lucy_turn_id, args_summary, tables, error_detail, duration_ms, request_id, decision_reason)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const link = db.prepare("INSERT OR IGNORE INTO inferred_turn_access_logs VALUES (?, ?)");
  const hostile = ['plain', 'has,comma', 'has "quote"', 'multi\nline', "=SUM(A1)", "中文，逗号", ""];
  db.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      const info = ins.run(
        new Date(Date.UTC(2026, 10, 15, 0, 0, 0) + Math.floor(rand() * 86_400_000)).toISOString(),
        `user-${i % 5}`, i % 4 === 0 ? "lucy_catalog" : "lucy_query", i % 11 === 0 ? "error" : "ok",
        `sess-${i % 30}`, rand() < 0.4 ? `turn-${i % 50}` : null,
        JSON.stringify({ q: hostile[i % hostile.length], token: "secret-should-be-redacted" }),
        JSON.stringify(["db.schema.t" + (i % 9)]), i % 11 === 0 ? hostile[i % hostile.length] : null, 5 + (i % 7), `req-${i}`, "allowed"
      );
      if (rand() < 0.5) link.run(`inf_${i % 40}`, Number(info.lastInsertRowid));
    }
  })();
  return db;
}

describe("sliced export equals one-shot export", () => {
  for (const count of [0, 1, EXPORT_SLICE_ROWS - 1, EXPORT_SLICE_ROWS, EXPORT_SLICE_ROWS + 1, 2 * EXPORT_SLICE_ROWS + 37]) {
    it(`${count} rows: presented rows and CSV text are identical`, async () => {
      const audit = await import("../../admin/audit");
      const db = await seedRows(count);
      const raw = db.prepare("SELECT * FROM access_log ORDER BY ts DESC, id DESC").all() as Parameters<typeof audit.presentCallRows>[1];
      const oneShot = audit.presentCallRows(db, raw);
      const sliced = await audit.presentCallRowsYielding(db, raw);
      expect(sliced).toEqual(oneShot);
      expect(await audit.renderAccessLogCsvYielding(sliced)).toBe(audit.renderAccessLogCsv(oneShot));
    });
  }
});

describe("sliced turn CSV equals one-shot turn CSV", () => {
  const entry = (i: number) => ({
    id: `turn-${i}`, correlationKey: i % 3 ? `turn-${i}` : undefined, source: i % 2 ? "reported" : "inferred", userId: `u${i % 4}`,
    startedAt: new Date(Date.UTC(2026, 10, 15, 0, 0, i % 3600)).toISOString(), endedAt: new Date(Date.UTC(2026, 10, 15, 1, 0, i % 3600)).toISOString(),
    questionPreview: i % 5 === 0 ? 'say "hi", please\nnow' : undefined, linkedCallCount: i % 7, businessCallCount: i % 3,
    tools: ["lucy_query", "lucy_catalog"].slice(0, i % 3), sources: [{ physicalTable: `db.s.t${i % 4}` }],
    outcomeSummary: i % 2 ? { ok: 1, denied: 0, error: i % 4, budgetStop: 0 } : undefined
  });
  for (const count of [0, 1, EXPORT_SLICE_ROWS, EXPORT_SLICE_ROWS + 1, 2 * EXPORT_SLICE_ROWS + 5]) {
    it(`${count} entries`, async () => {
      const audit = await import("../../admin/audit");
      const entries = Array.from({ length: count }, (_, i) => entry(i)) as unknown as Parameters<typeof audit.renderTurnCsv>[0];
      expect(await audit.renderTurnCsvYielding(entries)).toBe(audit.renderTurnCsv(entries));
    });
  }
});

describe("the event loop is not starved", () => {
  it("a macrotask queued before a multi-slice build runs before the build completes", async () => {
    const audit = await import("../../admin/audit");
    const db = await seedRows(3 * EXPORT_SLICE_ROWS);
    const raw = db.prepare("SELECT * FROM access_log").all() as Parameters<typeof audit.presentCallRows>[1];
    let finished = false;
    let ranBeforeFinish = false;
    setImmediate(() => { ranBeforeFinish = !finished; });
    await audit.renderAccessLogCsvYielding(await audit.presentCallRowsYielding(db, raw));
    finished = true;
    expect(ranBeforeFinish).toBe(true);
  });

  it("mapSlicesYielding yields between slices only, preserves order, never calls fn on empty input", async () => {
    const calls: number[][] = [];
    const out = await mapSlicesYielding([1, 2, 3, 4, 5], (slice) => { calls.push(slice); return slice.map((n) => n * 2); }, 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(calls).toEqual([[1, 2], [3, 4], [5]]);
    calls.length = 0;
    expect(await mapSlicesYielding([], (slice) => { calls.push(slice as number[]); return slice; })).toEqual([]);
    expect(calls).toEqual([]);
  });
});
