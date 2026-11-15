/**
 * P1-32 / F-1 — `export-inquiry-pack` call selection.
 * Equivalence: same rows, same order as the frozen legacy SQL, for any filter and any id set
 * the legacy SQL can run. Scale: stays near-linear where the legacy SQL is rows × ids.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { selectInquiryPackCallRows } from "../../admin/audit-inquiry-pack-rows";
import { legacyInquiryPackCallRows } from "./legacy/inquiry-pack-rows.legacy";
import { rng } from "./fixtures";

type Seeded = { db: Database.Database; turnIds: string[] };

function seed(callCount: number, inquiryCount: number, seedValue = 11): Seeded {
  const rand = rng(seedValue);
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL, tool TEXT NOT NULL, lucy_turn_id TEXT);
    CREATE TABLE inferred_turn_access_logs (inferred_turn_id TEXT NOT NULL, access_log_id INTEGER NOT NULL, PRIMARY KEY (inferred_turn_id, access_log_id));
  `);
  const turnIds: string[] = [];
  for (let t = 0; t < inquiryCount; t += 1) turnIds.push(t % 3 === 0 ? `turn-${t}` : `inf_${t}`);
  const insLog = db.prepare("INSERT INTO access_log (ts, user_id, tool, lucy_turn_id) VALUES (?, ?, ?, ?)");
  const insLink = db.prepare("INSERT OR IGNORE INTO inferred_turn_access_logs VALUES (?, ?)");
  db.transaction(() => {
    for (let i = 0; i < callCount; i += 1) {
      const r = rand();
      // Timestamps are NOT monotonic in `id` (stride permutation) and repeat in groups, so both
      // `ts DESC` and the `id DESC` tie-break are observable in the result order.
      const tick = Math.floor(((i * 7919) % callCount) / 3);
      // 1/3 reported (lucy_turn_id), 1/3 inferred (link), 1/6 both, rest unlinked / NULL / ''.
      const reported = r < 0.4 ? `turn-${Math.floor(rand() * inquiryCount)}` : r < 0.45 ? "" : null;
      const info = insLog.run(`2026-11-15T${String(Math.floor(tick / 3600) % 24).padStart(2, "0")}:${String(Math.floor(tick / 60) % 60).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}Z`, `u${i % 7}`, i % 5 === 0 ? "lucy_query" : "lucy_catalog", reported);
      if (rand() < 0.5) insLink.run(`inf_${Math.floor(rand() * inquiryCount)}`, Number(info.lastInsertRowid));
    }
  })();
  return { db, turnIds };
}

const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id);

describe("F-1 equivalence with the frozen legacy SQL", () => {
  const filters: Array<[string, { conditions: string[]; params: Record<string, unknown> }]> = [
    ["no extra filter", { conditions: [], params: {} }],
    ["user filter", { conditions: ["user_id = @user"], params: { user: "u3" } }],
    ["time + tool filter", { conditions: ["ts >= @since", "ts < @until", "tool = @tool"], params: { since: "2026-11-15T00:10:00Z", until: "2026-11-15T00:40:00Z", tool: "lucy_query" } }]
  ];
  for (const [label, filter] of filters) {
    for (const [calls, inquiries] of [[0, 0], [50, 0], [50, 1], [800, 40], [4000, 300]] as const) {
      it(`${label}: ${calls} calls / ${inquiries} inquiries return the same rows in the same order`, () => {
        const { db, turnIds } = seed(calls, inquiries);
        const legacy = legacyInquiryPackCallRows(db, filter, turnIds);
        const now = selectInquiryPackCallRows(db, filter, turnIds);
        expect(ids(now)).toEqual(ids(legacy));
        expect(now).toEqual(legacy);
      });
    }
  }

  it("an empty-string inquiry id matches NULL lucy_turn_id exactly as the legacy IFNULL does", () => {
    const { db } = seed(300, 20);
    const legacy = legacyInquiryPackCallRows(db, { conditions: [], params: {} }, ["", "turn-3"]);
    const now = selectInquiryPackCallRows(db, { conditions: [], params: {} }, ["", "turn-3"]);
    expect(ids(now)).toEqual(ids(legacy));
    expect(ids(now).length).toBeGreaterThan(0);
  });

  it("duplicate inquiry ids do not duplicate rows", () => {
    const { db, turnIds } = seed(500, 30);
    const doubled = [...turnIds, ...turnIds];
    expect(ids(selectInquiryPackCallRows(db, { conditions: [], params: {} }, doubled)))
      .toEqual(ids(legacyInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds)));
  });

  it("leaves no state behind: repeated calls with different id sets are independent", () => {
    const { db, turnIds } = seed(600, 60);
    const a = selectInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds.slice(0, 10));
    const b = selectInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds.slice(10, 20));
    const a2 = selectInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds.slice(0, 10));
    expect(ids(a2)).toEqual(ids(a));
    expect(ids(b)).toEqual(ids(legacyInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds.slice(10, 20))));
  });
});

describe("F-1 scale", () => {
  it("beyond the bound-variable limit (40,000 inquiry ids) the legacy SQL cannot run; production answers", () => {
    const { db } = seed(2000, 50);
    const many = Array.from({ length: 40_000 }, (_, i) => `ghost-${i}`).concat(["turn-3"]);
    expect(() => legacyInquiryPackCallRows(db, { conditions: [], params: {} }, many)).toThrow(/too many SQL variables|Too many/i);
    const now = selectInquiryPackCallRows(db, { conditions: [], params: {} }, many);
    expect(ids(now)).toEqual(ids(legacyInquiryPackCallRows(db, { conditions: [], params: {} }, ["turn-3"])));
  });

  it("stays fast at customer shape (20,000 inquiries over 120,000 calls) — legacy is rows × ids", () => {
    const { db, turnIds } = seed(120_000, 20_000);
    const t0 = performance.now();
    const rows = selectInquiryPackCallRows(db, { conditions: [], params: {} }, turnIds);
    const ms = performance.now() - t0;
    expect(rows.length).toBeGreaterThan(40_000);
    expect(ms).toBeLessThan(3000); // set-based ≈ 0.3–1 s; legacy shape is minutes (114 s measured at 6.7k ids)
  }, 120_000);
});
