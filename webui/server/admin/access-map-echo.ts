/**
 * Access-map ↔ audit-log echo filters (Spec lucy-20261102-access-map-audit-echo).
 *
 * Strict URL allowlists live here so access-map does **not** reuse audit's
 * parseInquiryKindFilter / parseAccessGradeFilter — those fall back to defaults
 * on illegal values. Classification itself reuses inquiryKindOfTurn /
 * inquiryKindMatches / accessGrade — no second enum of kinds or grades.
 */
import {
  inquiryKindMatches,
  inquiryKindOfTurn,
  type InquiryKindFilter
} from "./audit-inquiry-kind.js";
import {
  INFERRED_TURN_REBUILD_LOOKBACK_HOURS,
  rebuildInferredTurns
} from "../proxy/audit.js";
import { accessGrade } from "../proxy/usage-classification.js";

export type AccessMapInquiryKind = InquiryKindFilter;

/** Spec §5.3 accessGrade URL values (same vocabulary as audit; illegal → 400). */
export type AccessMapAccessGradeFilter =
  | "exclude_connect"
  | "all"
  | "connect"
  | "browse"
  | "prepare"
  | "ask"
  | "query"
  | "control"
  | "unclassified";

export const ACCESS_MAP_DEFAULT_INQUIRY_KIND: InquiryKindFilter = "management";
export const ACCESS_MAP_DEFAULT_ACCESS_GRADE: AccessMapAccessGradeFilter = "exclude_connect";

const INQUIRY_KIND_URL_VALUES = new Set<string>([
  "management",
  "real",
  "unreported_query",
  "session_visit",
  "all"
]);

const ACCESS_GRADE_URL_VALUES = new Set<string>([
  "exclude_connect",
  "all",
  "connect",
  "browse",
  "prepare",
  "ask",
  "query",
  "control",
  "unclassified"
]);

export function isInquiryKindFilterParam(raw: string): raw is InquiryKindFilter {
  return INQUIRY_KIND_URL_VALUES.has(raw);
}

export function isAccessGradeFilterParam(raw: string): raw is AccessMapAccessGradeFilter {
  return ACCESS_GRADE_URL_VALUES.has(raw);
}

/** Same grade-filter semantics as audit.ts (exclude_connect / exact / all). */
export function passesAccessGrade(tool: string | null | undefined, filter: string): boolean {
  if (filter === "all") return true;
  const grade = accessGrade(tool);
  if (filter === "exclude_connect") return grade !== "connect";
  return grade === filter;
}

export type EchoTurn = {
  source: "reported" | "inferred";
  questionSource?: string | null;
  questionSummary?: string | null;
};

export type EchoCandidateRow = {
  id: string;
  tool: string | null;
  outcome: string;
  lucyTurnId: string | null;
  userId: string;
};

export type EchoFilter = {
  window: { startIso: string; endIso: string };
  /** Spec 20261105：硬锁已确认关联。 */
  trust: "confirmed";
  inquiryKind: InquiryKindFilter;
  accessGrade: string;
  tokenLabel: string | null;
};

export type BandED = {
  B: Set<string>;
  E: Set<string>;
  D: Set<string>;
};

// A structural duck type on purpose: the production code must not depend on
// better-sqlite3's generic types. The methods are declared in METHOD syntax on
// purpose — method parameters are compared bivariantly, so a better-sqlite3
// `Statement` (whose `all`/`get` carry their own bind-parameter generics) is
// still assignable here. A property-style signature would reject the real
// `Database` and push the cast onto every caller.
type EchoDb = {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
};

export type EchoRebuildFn = (input: { db: EchoDb; userIds: string[] }) => Promise<void>;

/** Production rebuild: same prep as audit inquiry list (per-user inferred turns). */
export async function defaultEnsureInquiryRebuild(input: {
  db: EchoDb;
  userIds: string[];
}): Promise<void> {
  void input.db;
  for (const userId of input.userIds) {
    await rebuildInferredTurns(userId, { lookbackHours: INFERRED_TURN_REBUILD_LOOKBACK_HOURS });
  }
}

/**
 * D6 resolveTurn: non-empty lucy_turn_id → conversation_turns;
 * else inferred_turn_access_logs → inferred_turns. No other correlation.
 */
export function resolveTurn(
  row: { id: string; lucyTurnId: string | null },
  db: EchoDb
): EchoTurn | null {
  const explicit = typeof row.lucyTurnId === "string" ? row.lucyTurnId.trim() : "";
  if (explicit) {
    const turn = db
      .prepare(
        `SELECT question_source, question_summary
         FROM conversation_turns WHERE turn_id = ?`
      )
      .get(explicit) as
      | { question_source: string | null; question_summary: string | null }
      | undefined;
    if (!turn) return null;
    return {
      source: "reported",
      questionSource: turn.question_source,
      questionSummary: turn.question_summary
    };
  }

  const numericId = Number(row.id);
  if (!Number.isFinite(numericId)) return null;
  const link = db
    .prepare(
      `SELECT inferred_turn_id FROM inferred_turn_access_logs
       WHERE access_log_id = ? LIMIT 1`
    )
    .get(numericId) as { inferred_turn_id: string } | undefined;
  if (!link?.inferred_turn_id) return null;

  const inferred = db
    .prepare(
      `SELECT question_summary FROM inferred_turns WHERE inferred_turn_id = ?`
    )
    .get(link.inferred_turn_id) as { question_summary: string | null } | undefined;
  if (!inferred) return null;
  return {
    source: "inferred",
    questionSummary: inferred.question_summary
  };
}

function collectWindowUserIds(db: EchoDb, startIso: string): string[] {
  const cutoff = new Date(
    Date.now() - INFERRED_TURN_REBUILD_LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();
  const since = startIso < cutoff ? startIso : cutoff;
  const rows = db
    .prepare(`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`)
    .all(since) as Array<{ user_id: string }>;
  return rows
    .map((row) => row.user_id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

/**
 * Load candidate access_log rows that already have ≥1 access_log_sources row,
 * half-open window, trust, and optional token — before inquiryKind / accessGrade.
 */
export function loadCandidateRowsWithSources(f: EchoFilter, db: EchoDb): EchoCandidateRow[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT al.id AS call_id, al.user_id, al.tool, al.outcome, al.lucy_turn_id
       FROM access_log al
       JOIN access_log_sources als ON als.access_log_id = al.id
       WHERE al.ts >= ? AND al.ts < ?
         AND al.association_status = 'confirmed'
         AND (? IS NULL OR al.token_label = ?)`
    )
    .all(f.window.startIso, f.window.endIso, f.tokenLabel, f.tokenLabel) as Array<
    Record<string, unknown>
  >;

  return rows.map((row) => ({
    id: String(row.call_id ?? ""),
    userId: String(row.user_id ?? ""),
    tool: typeof row.tool === "string" ? row.tool : null,
    outcome: String(row.outcome ?? ""),
    lucyTurnId:
      typeof row.lucy_turn_id === "string" && row.lucy_turn_id.trim()
        ? row.lucy_turn_id.trim()
        : null
  }));
}

export type BuildBandEDResult =
  | { ok: true; band: BandED }
  | { ok: false; reason: string };

/**
 * Spec §6 buildBandED: B / E / D after D6 association + inquiryKind + accessGrade.
 * Path build consumes E only; deniedCalls = |D|; meta.echo.enteringAllowCallCount = |E|.
 */
export async function buildBandED(
  f: EchoFilter,
  db: EchoDb,
  options?: { ensureInquiryRebuild?: EchoRebuildFn }
): Promise<BuildBandEDResult> {
  const ensure = options?.ensureInquiryRebuild ?? defaultEnsureInquiryRebuild;
  try {
    const userIds = collectWindowUserIds(db, f.window.startIso);
    await ensure({ db, userIds });
  } catch {
    return { ok: false, reason: "问询关联重建失败，访问层不可用" };
  }

  const B = new Set<string>();
  const E = new Set<string>();
  const D = new Set<string>();

  for (const row of loadCandidateRowsWithSources(f, db)) {
    if (!row.id) continue;
    if (!passesAccessGrade(row.tool, f.accessGrade)) continue;
    if (f.inquiryKind !== "all") {
      const turn = resolveTurn({ id: row.id, lucyTurnId: row.lucyTurnId }, db);
      if (turn == null) continue;
      if (!inquiryKindMatches(inquiryKindOfTurn(turn), f.inquiryKind)) continue;
    }
    B.add(row.id);
    if (row.outcome === "allow") E.add(row.id);
    else D.add(row.id);
  }

  return { ok: true, band: { B, E, D } };
}
