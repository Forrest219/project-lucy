/**
 * P1-33 / F-5 — `/api/admin/ui-usage/overview`. Output on a fixed dataset must equal the golden
 * produced by the pre-fix implementation (rankings, totals, series, unmapped views).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectMatchesGolden } from "./golden";
import { rng } from "./fixtures";

let dir: string;
let prev: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-ui-usage-"));
  prev = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
});
afterEach(async () => {
  if (prev === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = prev;
  (await import("../../admin/audit")).resetAuditDbForTests();
  await rm(dir, { recursive: true, force: true });
});

describe("F-5 ui-usage overview equivalence", () => {
  for (const hours of [24, 168] as const) {
    it(`${hours}h window matches the pre-fix golden`, async () => {
      const { queryUiUsageOverview, UI_USAGE_PAGES, UI_PAGE_VIEW_UNKNOWN } = await import("../../admin/ui-usage");
      const { getAuditDb } = await import("../../admin/audit");
      const now = new Date("2026-11-15T12:00:00Z");
      await queryUiUsageOverview(hours, now); // creates the table
      const db = await getAuditDb();
      const rand = rng(21);
      const ins = db.prepare("INSERT INTO ui_page_views (ts, admin_id, page_key, menu_id, group_id) VALUES (?,?,?,?,?)");
      db.transaction(() => {
        for (let i = 0; i < 6000; i += 1) {
          const page = UI_USAGE_PAGES[Math.floor(rand() * UI_USAGE_PAGES.length)];
          const unknown = rand() < 0.05;
          const ts = new Date(now.getTime() - Math.floor(rand() * 9 * 24 * 3600_000) + (rand() < 0.01 ? 3600_000 * 5 : 0)).toISOString(); // some outside / future of the window
          ins.run(ts, `admin-${Math.floor(rand() * 9)}`, unknown ? UI_PAGE_VIEW_UNKNOWN : page.pageKey, unknown ? null : page.menuId, unknown ? null : page.groupId);
        }
      })();
      expectMatchesGolden(`ui-usage-overview-${hours}h`, await queryUiUsageOverview(hours, now));
    });
  }

  it("the window aggregates are served from a covering index (no table row reads)", async () => {
    const { queryUiUsageOverview } = await import("../../admin/ui-usage");
    const { getAuditDb } = await import("../../admin/audit");
    await queryUiUsageOverview(168);
    const db = await getAuditDb();
    for (const sql of [
      "SELECT page_key AS id, COUNT(*) AS visits FROM ui_page_views WHERE ts >= ? AND ts < ? AND page_key IS NOT NULL AND page_key != ? GROUP BY page_key",
      "SELECT menu_id AS id, COUNT(*) AS visits FROM ui_page_views WHERE ts >= ? AND ts < ? AND menu_id IS NOT NULL AND page_key != ? GROUP BY menu_id",
      "SELECT COUNT(*), COUNT(DISTINCT admin_id), COUNT(DISTINCT menu_id) FROM ui_page_views WHERE ts >= ? AND ts < ?"
    ]) {
      const detail = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(sql.includes("!= ?") ? ["a", "b", "c"] : ["a", "b"])) as Array<{ detail: string }>).map((r) => r.detail).join(" | ");
      expect(detail).toMatch(/USING COVERING INDEX/);
    }
  });
});
