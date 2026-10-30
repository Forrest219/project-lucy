/**
 * Daily real-question KPI.
 *
 * Reads access_log and conversation_turns. Does not write either table.
 * Session rows are aggregated in SQL; Shanghai calendar days are assigned
 * here from those aggregates, not from the container timezone.
 */
import { buildMetricWindow, type MetricWindow } from "./metric-window.js";
import {
  accessGradeSql,
  evalProbeConditionSql
} from "../proxy/usage-classification.js";

export const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const REPORTED_SOURCES = ["reported_tool", "reported"] as const;

export type QuestionMetricState = "ok" | "no_data" | "unavailable" | "partial";

export type QuestionMetric = {
  metricId: string;
  state: QuestionMetricState;
  value: number | null;
  asOf: string;
  windowStart: string;
  windowEnd: string;
  unavailableReason?: string;
};

export type DailyQuestionRow = {
  date: string;
  partialDay: boolean;
  realQuestions: number;
  unreportedQuerySessions: number;
  connectOnlySessions: number;
  browseWithoutAskSessions: number;
};

export type QuestionKpiPayload = {
  realQuestions: QuestionMetric;
  unreportedQuerySessions: QuestionMetric;
  connectOnlySessions: QuestionMetric;
  browseWithoutAskSessions: QuestionMetric;
  excludedSessions: QuestionMetric;
  unassignedQueryCalls: QuestionMetric;
  queryCalls: QuestionMetric;
  unlinkedQueryCalls: QuestionMetric;
  queriesPerQuestion: QuestionMetric;
  questionActiveAgents: QuestionMetric;
  dailyQuestions: DailyQuestionRow[] | null;
  skippedBadTimestamp: number;
};

type SqlDb = {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
};

type SessionClass = "unreportedQuery" | "browseWithoutAsk" | "connectOnly" | "excluded";

type SessionAggregate = {
  session_id: string;
  query_rows: number;
  prep_rows: number;
  connect_rows: number;
  total_rows: number;
  first_query_ts: string | null;
  first_prep_ts: string | null;
  first_ts: string | null;
};

type TurnRow = { turn_id: string; created_at: string };

function reportedSourceSql(column: string): string {
  return `${column} IN (${REPORTED_SOURCES.map((source) => `'${source}'`).join(", ")})`;
}

/** ISO timestamps written by Lucy. Anything else is skipped, not counted. */
export function validTimestampSql(column: string): string {
  return `(${column} GLOB '????-??-??T??:??:??*Z' AND datetime(replace(substr(${column}, 1, 19), 'T', ' ')) IS NOT NULL)`;
}

export function shanghaiDate(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function shanghaiDayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000+08:00`);
}

export function intersectingShanghaiDates(windowStartMs: number, windowEndMs: number): string[] {
  if (windowEndMs <= windowStartMs) return [];
  const first = shanghaiDate(new Date(windowStartMs).toISOString());
  const last = shanghaiDate(new Date(windowEndMs - 1).toISOString());
  if (!first || !last) return [];
  const dates: string[] = [];
  for (let cursor = shanghaiDayStartMs(first); cursor <= shanghaiDayStartMs(last); cursor += DAY_MS) {
    const date = shanghaiDate(new Date(cursor).toISOString());
    if (date) dates.push(date);
  }
  return dates;
}

function metric(
  metricId: string,
  state: QuestionMetricState,
  value: number | null,
  win: MetricWindow,
  unavailableReason?: string
): QuestionMetric {
  return {
    metricId,
    state,
    value,
    asOf: win.asOf,
    windowStart: win.startIso,
    windowEnd: win.endIso,
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

function countMetric(metricId: string, value: number, win: MetricWindow): QuestionMetric {
  return metric(metricId, "ok", value, win);
}

export function unavailableQuestionKpi(win: MetricWindow, reason = "audit_db_unavailable"): QuestionKpiPayload {
  const unavailable = (metricId: string) => metric(metricId, "unavailable", null, win, reason);
  return {
    realQuestions: unavailable("real-questions"),
    unreportedQuerySessions: unavailable("unreported-query-sessions"),
    connectOnlySessions: unavailable("connect-only-sessions"),
    browseWithoutAskSessions: unavailable("browse-without-ask-sessions"),
    excludedSessions: unavailable("excluded-sessions"),
    unassignedQueryCalls: unavailable("unassigned-query-calls"),
    queryCalls: unavailable("query-calls"),
    unlinkedQueryCalls: unavailable("unlinked-query-calls"),
    queriesPerQuestion: unavailable("queries-per-question"),
    questionActiveAgents: unavailable("question-active-agents"),
    dailyQuestions: null,
    skippedBadTimestamp: 0
  };
}

function classifySession(row: SessionAggregate, reportedSessions: ReadonlySet<string>): {
  kind: SessionClass | "none";
  date: string | null;
} {
  if (reportedSessions.has(row.session_id)) return { kind: "none", date: null };
  if (row.query_rows > 0) {
    return { kind: "unreportedQuery", date: row.first_query_ts ? shanghaiDate(row.first_query_ts) : null };
  }
  if (row.prep_rows > 0) {
    return { kind: "browseWithoutAsk", date: row.first_prep_ts ? shanghaiDate(row.first_prep_ts) : null };
  }
  if (row.total_rows > 0 && row.connect_rows === row.total_rows) {
    return { kind: "connectOnly", date: row.first_ts ? shanghaiDate(row.first_ts) : null };
  }
  if (row.total_rows > 0) return { kind: "excluded", date: null };
  return { kind: "none", date: null };
}

function countGet(db: SqlDb, sql: string, params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function queryDailyQuestionKpi(db: SqlDb, hours: number, now: Date = new Date()): QuestionKpiPayload {
  const win = buildMetricWindow(hours, now);
  try {
    const grade = accessGradeSql("a").sql;
    const notProbe = `NOT ${evalProbeConditionSql("a").sql}`;
    const validTs = validTimestampSql("a.ts");
    const windowSql = `a.ts >= ? AND a.ts < ? AND ${validTs}`;
    const windowParams = [win.startIso, win.endIso];
    const reportedTurn = `${reportedSourceSql("t.question_source")} AND t.turn_id IS NOT NULL AND trim(t.turn_id) != ''`;
    const queryGrade = `(${grade}) = 'query'`;

    const turns = db.prepare(`
      SELECT turn_id, MIN(created_at) AS created_at
      FROM conversation_turns
      WHERE ${reportedSourceSql("question_source")}
        AND turn_id IS NOT NULL AND trim(turn_id) != ''
        AND created_at >= ? AND created_at < ?
        AND ${validTimestampSql("created_at")}
      GROUP BY turn_id
    `).all(...windowParams) as TurnRow[];

    const reportedSessions = new Set(
      (db.prepare(`
        SELECT DISTINCT session_id
        FROM conversation_turns
        WHERE ${reportedSourceSql("question_source")}
          AND turn_id IS NOT NULL AND trim(turn_id) != ''
          AND session_id IS NOT NULL AND trim(session_id) != ''
      `).all() as Array<{ session_id: string }>).map((row) => row.session_id)
    );

    const sessions = db.prepare(`
      SELECT
        a.lucy_session_id AS session_id,
        SUM(CASE WHEN (${grade}) = 'query' THEN 1 ELSE 0 END) AS query_rows,
        SUM(CASE WHEN (${grade}) IN ('browse', 'prepare') THEN 1 ELSE 0 END) AS prep_rows,
        SUM(CASE WHEN (${grade}) = 'connect' THEN 1 ELSE 0 END) AS connect_rows,
        COUNT(*) AS total_rows,
        MIN(CASE WHEN (${grade}) = 'query' THEN a.ts END) AS first_query_ts,
        MIN(CASE WHEN (${grade}) IN ('browse', 'prepare') THEN a.ts END) AS first_prep_ts,
        MIN(a.ts) AS first_ts
      FROM access_log a
      WHERE ${windowSql}
        AND ${notProbe}
        AND a.lucy_session_id IS NOT NULL AND trim(a.lucy_session_id) != ''
      GROUP BY a.lucy_session_id
    `).all(...windowParams) as SessionAggregate[];

    const queryCalls = countGet(
      db,
      `SELECT COUNT(*) AS n FROM access_log a WHERE ${windowSql} AND ${notProbe} AND ${queryGrade}`,
      windowParams
    );
    const unassignedQueryCalls = countGet(
      db,
      `SELECT COUNT(*) AS n FROM access_log a
       WHERE ${windowSql} AND ${notProbe} AND ${queryGrade}
         AND (a.lucy_session_id IS NULL OR trim(a.lucy_session_id) = '')`,
      windowParams
    );
    const unlinkedQueryCalls = countGet(
      db,
      `SELECT COUNT(*) AS n FROM access_log a
       WHERE ${windowSql} AND ${notProbe} AND ${queryGrade}
         AND NOT EXISTS (
           SELECT 1 FROM conversation_turns t
           WHERE ${reportedTurn}
             AND (t.turn_id = a.lucy_turn_id OR t.turn_id = a.effective_turn_id)
         )`,
      windowParams
    );
    const linkedQueryCalls = countGet(
      db,
      `SELECT COUNT(*) AS n FROM access_log a
       WHERE ${windowSql} AND ${notProbe} AND ${queryGrade}
         AND EXISTS (
           SELECT 1 FROM conversation_turns t
           WHERE ${reportedTurn}
             AND t.created_at >= ? AND t.created_at < ?
             AND ${validTimestampSql("t.created_at")}
             AND (t.turn_id = a.lucy_turn_id OR t.turn_id = a.effective_turn_id)
         )`,
      [...windowParams, ...windowParams]
    );

    const questionUsers = db.prepare(`
      SELECT DISTINCT user_id
      FROM conversation_turns
      WHERE ${reportedSourceSql("question_source")}
        AND turn_id IS NOT NULL AND trim(turn_id) != ''
        AND user_id IS NOT NULL AND trim(user_id) != ''
        AND created_at >= ? AND created_at < ?
        AND ${validTimestampSql("created_at")}
    `).all(...windowParams) as Array<{ user_id: string }>;
    const unreportedUsers = db.prepare(`
      SELECT DISTINCT a.user_id AS user_id
      FROM access_log a
      WHERE ${windowSql} AND ${notProbe} AND ${queryGrade}
        AND a.lucy_session_id IS NOT NULL AND trim(a.lucy_session_id) != ''
        AND a.user_id IS NOT NULL AND trim(a.user_id) != ''
        AND NOT EXISTS (
          SELECT 1 FROM conversation_turns t
          WHERE t.session_id = a.lucy_session_id
            AND ${reportedTurn}
        )
    `).all(...windowParams) as Array<{ user_id: string }>;

    const skippedBadTimestamp = countGet(
      db,
      `SELECT (
         (SELECT COUNT(*) FROM access_log WHERE ts >= ? AND ts < ? AND NOT ${validTimestampSql("ts")})
         +
         (SELECT COUNT(*) FROM conversation_turns WHERE created_at >= ? AND created_at < ? AND NOT ${validTimestampSql("created_at")})
       ) AS n`,
      [...windowParams, ...windowParams]
    );

    const counts = { unreportedQuery: 0, browseWithoutAsk: 0, connectOnly: 0, excluded: 0 };
    const byDate = new Map<string, { unreportedQuery: number; browseWithoutAsk: number; connectOnly: number }>();
    for (const session of sessions) {
      const classified = classifySession(session, reportedSessions);
      if (classified.kind === "none") continue;
      counts[classified.kind] += 1;
      if (classified.kind === "excluded" || !classified.date) continue;
      const bucket = byDate.get(classified.date) ?? { unreportedQuery: 0, browseWithoutAsk: 0, connectOnly: 0 };
      bucket[classified.kind] += 1;
      byDate.set(classified.date, bucket);
    }

    const questionsByDate = new Map<string, number>();
    for (const turn of turns) {
      const date = shanghaiDate(turn.created_at);
      if (!date) continue;
      questionsByDate.set(date, (questionsByDate.get(date) ?? 0) + 1);
    }

    const windowStartMs = Date.parse(win.startIso);
    const windowEndMs = Date.parse(win.endIso);
    const dailyQuestions = intersectingShanghaiDates(windowStartMs, windowEndMs).map((date) => {
      const dayStart = shanghaiDayStartMs(date);
      const dayEnd = dayStart + DAY_MS;
      const sessionsOnDate = byDate.get(date) ?? { unreportedQuery: 0, browseWithoutAsk: 0, connectOnly: 0 };
      return {
        date,
        partialDay: dayStart < windowStartMs || dayEnd > windowEndMs,
        realQuestions: questionsByDate.get(date) ?? 0,
        unreportedQuerySessions: sessionsOnDate.unreportedQuery,
        connectOnlySessions: sessionsOnDate.connectOnly,
        browseWithoutAskSessions: sessionsOnDate.browseWithoutAsk
      };
    });

    const activeAgents = new Set<string>();
    for (const row of questionUsers) activeAgents.add(row.user_id);
    for (const row of unreportedUsers) activeAgents.add(row.user_id);

    const realCount = turns.length;
    const queriesPerQuestion = realCount === 0
      ? metric("queries-per-question", "no_data", null, win)
      : countMetric("queries-per-question", Math.round((linkedQueryCalls / realCount) * 10) / 10, win);

    return {
      realQuestions: countMetric("real-questions", realCount, win),
      unreportedQuerySessions: countMetric("unreported-query-sessions", counts.unreportedQuery, win),
      connectOnlySessions: countMetric("connect-only-sessions", counts.connectOnly, win),
      browseWithoutAskSessions: countMetric("browse-without-ask-sessions", counts.browseWithoutAsk, win),
      excludedSessions: countMetric("excluded-sessions", counts.excluded, win),
      unassignedQueryCalls: countMetric("unassigned-query-calls", unassignedQueryCalls, win),
      queryCalls: countMetric("query-calls", queryCalls, win),
      unlinkedQueryCalls: countMetric("unlinked-query-calls", unlinkedQueryCalls, win),
      queriesPerQuestion,
      questionActiveAgents: countMetric("question-active-agents", activeAgents.size, win),
      dailyQuestions,
      skippedBadTimestamp
    };
  } catch {
    return unavailableQuestionKpi(win);
  }
}
