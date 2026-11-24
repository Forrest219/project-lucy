/**
 * P1-33 / F-3 — `queryDailyQuestionKpi` (behind `/api/admin/governance/overview`). The four
 * "query call" counts used to be four scans of the same window; output must remain byte-identical
 * to the golden produced by the pre-fix implementation on a dataset covering every branch
 * (reported / unreported / unassigned sessions, linked via lucy_turn_id or effective_turn_id,
 * eval probes, protocol events, malformed timestamps, rows outside the window).
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
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-kpi-"));
  prev = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
});
afterEach(async () => {
  if (prev === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = prev;
  (await import("../../admin/audit")).resetAuditDbForTests();
  await rm(dir, { recursive: true, force: true });
});

async function seedAndQuery(hours: number) {
  const { getAuditDb } = await import("../../admin/audit");
  const { queryDailyQuestionKpi } = await import("../../admin/daily-question-kpi");
  const db = await getAuditDb();
  const now = new Date("2026-11-15T12:00:00Z");
  const rand = rng(33);
  const iso = (agoMs: number) => new Date(now.getTime() - agoMs).toISOString();
  const insTurn = db.prepare("INSERT INTO conversation_turns (turn_id, session_id, user_id, question_source, created_at) VALUES (?,?,?,?,?)");
  const insCall = db.prepare("INSERT INTO access_log (ts, user_id, tool, outcome, lucy_session_id, lucy_turn_id, effective_turn_id, eval_mark, args_summary, duration_ms, request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const tools = ["lucy_query", "lucy_query", "lucy_query", "lucy_catalog", "lucy_read_source", "initialize", "tools/list", "lucy_begin_question"];
  db.transaction(() => {
    for (let t = 0; t < 300; t += 1) {
      const source = rand() < 0.8 ? "reported" : rand() < 0.5 ? "reported_tool" : "inferred";
      insTurn.run(`turn-${t}`, rand() < 0.9 ? `sess-${t % 120}` : null, `user-${t % 9}`, source, rand() < 0.03 ? "garbage-ts" : iso(rand() * 6 * 24 * 3600_000));
    }
    for (let i = 0; i < 5000; i += 1) {
      const probe = rand() < 0.04;
      const ts = rand() < 0.02 ? "bad-timestamp" : iso(rand() * 9 * 24 * 3600_000);
      const sess = rand() < 0.15 ? null : rand() < 0.03 ? "  " : `sess-${Math.floor(rand() * 160)}`;
      const lucyTurn = rand() < 0.35 ? `turn-${Math.floor(rand() * 340)}` : null;
      const effTurn = rand() < 0.15 ? `turn-${Math.floor(rand() * 340)}` : null;
      insCall.run(ts, `user-${i % 9}`, tools[i % tools.length], "ok", sess, lucyTurn, effTurn, probe ? 1 : 0, probe ? JSON.stringify({ connection: "lucy-probe-demo" }) : null, 5, `req-${i}`);
    }
    // Sessions made of only one grade, and timestamps that sort inside the window but are not ISO.
    for (let k = 0; k < 25; k += 1) {
      insCall.run(iso(rand() * 5 * 24 * 3600_000), "user-1", "initialize", "ok", `sess-connect-${k}`, null, null, 0, null, 1, `rc-${k}`);
      insCall.run(iso(rand() * 5 * 24 * 3600_000), "user-2", "lucy_catalog", "ok", `sess-browse-${k}`, null, null, 0, null, 1, `rb-${k}`);
      insCall.run("2026-11-14Z-not-iso", "user-3", "lucy_query", "ok", `sess-bad-${k}`, null, null, 0, null, 1, `rx-${k}`);
    }
    insTurn.run("turn-badts", "sess-x", "user-4", "reported", "2026-11-14Z-not-iso");
  })();
  return queryDailyQuestionKpi(db, hours, now);
}

describe("F-3 daily question KPI equivalence", () => {
  for (const hours of [24, 168, 720]) {
    it(`${hours}h window equals the pre-fix golden`, async () => {
      const result = await seedAndQuery(hours);
      expect(result.realQuestions.state, "must not fall into the unavailable fallback").toBe("ok");
      expectMatchesGolden(`daily-question-kpi-${hours}h`, result);
    });
  }
});
