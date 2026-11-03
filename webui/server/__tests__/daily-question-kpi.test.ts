/**
 * Window aggregation for the daily real-question KPI.
 * The clock is injected. Shanghai dates do not follow the process timezone.
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { queryDailyQuestionKpi } from "../admin/daily-question-kpi.js";

const NOW = new Date("2026-10-30T04:00:00.000Z");
const HOURS = 24;

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY,
      ts TEXT,
      user_id TEXT,
      tool TEXT,
      lucy_session_id TEXT,
      lucy_turn_id TEXT,
      effective_turn_id TEXT,
      eval_mark INTEGER,
      args_summary TEXT
    );
    CREATE TABLE conversation_turns (
      turn_id TEXT,
      session_id TEXT,
      user_id TEXT,
      question_source TEXT,
      created_at TEXT
    );
  `);
  return db;
}

function log(
  db: Database.Database,
  row: {
    ts: string;
    tool: string;
    session?: string | null;
    user?: string;
    turn?: string | null;
    effectiveTurn?: string | null;
    evalMark?: number;
    args?: string | null;
  }
): void {
  db.prepare(`
    INSERT INTO access_log
      (ts, user_id, tool, lucy_session_id, lucy_turn_id, effective_turn_id, eval_mark, args_summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.ts,
    row.user ?? "analyst",
    row.tool,
    row.session ?? null,
    row.turn ?? null,
    row.effectiveTurn ?? null,
    row.evalMark ?? 0,
    row.args ?? null
  );
}

function turn(
  db: Database.Database,
  row: { id: string; at: string; session?: string | null; source?: string; user?: string }
): void {
  db.prepare(`
    INSERT INTO conversation_turns (turn_id, session_id, user_id, question_source, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.id, row.session ?? null, row.user ?? "analyst", row.source ?? "reported_tool", row.at);
}

function kpi(db: Database.Database, now = NOW) {
  return queryDailyQuestionKpi(db, HOURS, now);
}

describe("daily question KPI", () => {
  it("SC-04 a persisted reported_tool turn counts once", () => {
    const db = openDb();
    turn(db, { id: "t1", at: "2026-10-30T01:00:00.000Z", session: "s1" });
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_begin_question", session: "s1", turn: "t1" });
    const result = kpi(db);
    expect(result.realQuestions).toMatchObject({ state: "ok", value: 1 });
    db.close();
  });

  it("SC-05 a failed begin without a turn row does not count", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_begin_question", session: "s1" });
    expect(kpi(db).realQuestions.value).toBe(0);
    db.close();
  });

  it("SC-06 the same turn id counts once", () => {
    const db = openDb();
    turn(db, { id: "t1", at: "2026-10-30T01:00:00.000Z", session: "s1" });
    turn(db, { id: "t1", at: "2026-10-30T01:00:01.000Z", session: "s1" });
    expect(kpi(db).realQuestions.value).toBe(1);
    db.close();
  });

  it("SC-07 a query without a reported turn is an unreported session, not a real question", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_query", session: "s1" });
    const result = kpi(db);
    expect(result.realQuestions.value).toBe(0);
    expect(result.queryCalls.value).toBe(1);
    expect(result.unreportedQuerySessions.value).toBe(1);
    db.close();
  });

  it("SC-08 an eval probe query is excluded from every new KPI", () => {
    const db = openDb();
    log(db, {
      ts: "2026-10-30T01:00:00.000Z",
      tool: "lucy_query",
      session: "s1",
      evalMark: 1,
      args: JSON.stringify({ connection: "probe-demo" })
    });
    const result = kpi(db);
    expect(result.queryCalls.value).toBe(0);
    expect(result.unreportedQuerySessions.value).toBe(0);
    expect(result.realQuestions.value).toBe(0);
    db.close();
  });

  it("SC-09 a handshake-only session is connect-only", () => {
    const db = openDb();
    for (const tool of ["initialize", "notifications/initialized", "tools/list"]) {
      log(db, { ts: "2026-10-30T01:00:00.000Z", tool, session: "s1" });
    }
    const result = kpi(db);
    expect(result.connectOnlySessions.value).toBe(1);
    expect(result.unreportedQuerySessions.value).toBe(0);
    expect(result.browseWithoutAskSessions.value).toBe(0);
    expect(result.realQuestions.value).toBe(0);
    db.close();
  });

  it("SC-10 a catalog-only session is browse-without-ask", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_catalog", session: "s1" });
    const result = kpi(db);
    expect(result.browseWithoutAskSessions.value).toBe(1);
    expect(result.connectOnlySessions.value).toBe(0);
    db.close();
  });

  it("SC-11 a query session with no reported turn is unreported", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_query", session: "s-query" });
    const result = kpi(db);
    expect(result.unreportedQuerySessions.value).toBe(1);
    expect(result.realQuestions.value).toBe(0);
    db.close();
  });

  it("SC-12 a reported turn from before the window keeps later queries from becoming unreported", () => {
    const db = openDb();
    turn(db, { id: "old", at: "2026-10-28T00:00:00.000Z", session: "s1" });
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_query", session: "s1", turn: "old" });
    const result = kpi(db);
    expect(result.unreportedQuerySessions.value).toBe(0);
    expect(result.realQuestions.value).toBe(0);
    expect(result.queryCalls.value).toBe(1);
    db.close();
  });

  it("SC-13 two reported turns in one session count as two questions", () => {
    const db = openDb();
    turn(db, { id: "t1", at: "2026-10-30T01:00:00.000Z", session: "s1" });
    turn(db, { id: "t2", at: "2026-10-30T02:00:00.000Z", session: "s1" });
    expect(kpi(db).realQuestions.value).toBe(2);
    db.close();
  });

  it("SC-14 a query with no session id is unassigned, not an unreported session", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_query", session: null });
    const result = kpi(db);
    expect(result.unassignedQueryCalls.value).toBe(1);
    expect(result.unreportedQuerySessions.value).toBe(0);
    expect(result.queryCalls.value).toBe(1);
    db.close();
  });

  it("SC-15 connect plus a control-plane tool is an excluded session", () => {
    const db = openDb();
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "initialize", session: "s1" });
    log(db, { ts: "2026-10-30T01:00:01.000Z", tool: "lucy_ops_source_import", session: "s1" });
    const result = kpi(db);
    expect(result.connectOnlySessions.value).toBe(0);
    expect(result.browseWithoutAskSessions.value).toBe(0);
    expect(result.unreportedQuerySessions.value).toBe(0);
    expect(result.realQuestions.value).toBe(0);
    expect(result.excludedSessions.value).toBe(1);
    db.close();
  });

  it("SC-18 and SC-19 daily buckets use Asia/Shanghai and sum to the card", () => {
    const db = openDb();
    turn(db, { id: "a", at: "2026-10-29T05:00:00.000Z", session: "sa" });
    turn(db, { id: "b", at: "2026-10-29T16:30:00.000Z", session: "sb" });
    turn(db, { id: "c", at: "2026-10-30T02:00:00.000Z", session: "sc" });
    const result = kpi(db);
    expect(result.realQuestions.value).toBe(3);
    const sum = result.dailyQuestions!.reduce((total, row) => total + row.realQuestions, 0);
    expect(sum).toBe(3);
    const late = result.dailyQuestions!.find((row) => row.date === "2026-10-30");
    const early = result.dailyQuestions!.find((row) => row.date === "2026-10-29");
    expect(early?.realQuestions).toBe(1);
    expect(late?.realQuestions).toBe(2);
    expect(early?.partialDay).toBe(true);
    expect(late?.partialDay).toBe(true);
    db.close();
  });

  it("SC-21 a database that cannot be queried returns unavailable nulls", () => {
    const db = new Database(":memory:");
    const result = kpi(db);
    expect(result.realQuestions).toMatchObject({ state: "unavailable", value: null });
    expect(result.unreportedQuerySessions.value).toBeNull();
    expect(result.connectOnlySessions.value).toBeNull();
    expect(result.browseWithoutAskSessions.value).toBeNull();
    expect(result.dailyQuestions).toBeNull();
    db.close();
  });

  it("SC-22 and SC-23 an empty window is zero questions and a missing ratio", () => {
    const db = openDb();
    const result = kpi(db);
    expect(result.realQuestions).toMatchObject({ state: "ok", value: 0 });
    expect(result.queriesPerQuestion).toMatchObject({ state: "no_data", value: null });
    expect(result.dailyQuestions).not.toBeNull();
    db.close();
  });

  it("counts a historical reported source and ignores inferred turns", () => {
    const db = openDb();
    turn(db, { id: "legacy", at: "2026-10-30T01:00:00.000Z", source: "reported" });
    turn(db, { id: "guess", at: "2026-10-30T01:00:00.000Z", source: "inferred" });
    expect(kpi(db).realQuestions.value).toBe(1);
    db.close();
  });

  it("daily session columns also sum to their cards", () => {
    const db = openDb();
    log(db, { ts: "2026-10-29T05:00:00.000Z", tool: "initialize", session: "c1" });
    log(db, { ts: "2026-10-30T01:00:00.000Z", tool: "lucy_catalog", session: "b1" });
    log(db, { ts: "2026-10-30T02:00:00.000Z", tool: "lucy_query", session: "q1", user: "ada" });
    const result = kpi(db);
    const rows = result.dailyQuestions!;
    expect(rows.reduce((n, row) => n + row.connectOnlySessions, 0)).toBe(result.connectOnlySessions.value);
    expect(rows.reduce((n, row) => n + row.browseWithoutAskSessions, 0)).toBe(result.browseWithoutAskSessions.value);
    expect(rows.reduce((n, row) => n + row.unreportedQuerySessions, 0)).toBe(result.unreportedQuerySessions.value);
    expect(result.questionActiveAgents.value).toBe(1);
    db.close();
  });
});
