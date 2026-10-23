import { computeSuiteHash } from "./suite-schema.js";
import type { EvalExecutable, EvalResultImport, EvalSuite, EvalSuiteCase } from "../../src/lib/types.js";

export const ROW_COUNT_MEASURES = new Set(["physical_rows", "row_count", "row_cnt", "records", "行数"]);
export const INFERRED_TURN_SPLIT_THRESHOLD = 50;

export type DateWindow = { start: string; end: string };

export type SemanticQueryRequest = {
  roleId: string;
  measures: string[];
  grain: string[];
  filters: Array<{ field: string; value?: string }>;
  window: DateWindow | null;
};

export type SemanticQuerySuccess = {
  ok: true;
  columns: string[];
  grain: string[];
  filters: Array<{ field: string; value?: string }>;
  measures: string[];
  sql?: string;
  rows: Array<Record<string, unknown>>;
};

export type SemanticQueryFailure = {
  ok: false;
  reason: string;
};

export type QueryExecutor = (request: SemanticQueryRequest) => Promise<SemanticQuerySuccess | SemanticQueryFailure>;

export type BatchCaseResult = {
  case_id: string;
  status: "PASS" | "FAIL" | "SKIPPED" | "ERROR";
  outcome?: "answered_ok" | "answered_wrong" | "not_answered";
  reason?: string;
  policy_status?: "compliant" | "noncompliant" | "unchecked";
  window?: DateWindow | null;
  sql?: string;
  failures?: string[];
  error_message?: string;
};

export class BatchRejectedError extends Error {
  code = "EVAL_BATCH_REJECTED";
}

export function resolveTimeZone(explicit?: string): string {
  return explicit?.trim() || process.env.LUCY_TIMEZONE?.trim() || "UTC";
}

export function bindWindow(
  binding: NonNullable<EvalSuiteCase["as_of_binding"]>,
  asOf: string,
  timeZone: string
): DateWindow | null {
  if (binding.kind === "business_period") {
    const period = binding.period ?? "";
    return period ? { start: period, end: period } : null;
  }
  const cursor = calendarDate(asOf, timeZone);
  if (binding.kind === "yesterday") {
    const day = addDays(cursor, -1);
    const text = formatDate(day);
    return { start: text, end: text };
  }
  const start = formatDate(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1)));
  return { start, end: formatDate(cursor) };
}

function calendarDate(asOf: string, timeZone: string): Date {
  const probe = new Date(`${asOf}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(probe);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function statusFor(outcome: BatchCaseResult["outcome"]): BatchCaseResult["status"] {
  if (outcome === "answered_ok") return "PASS";
  if (outcome === "answered_wrong") return "FAIL";
  return "ERROR";
}

function onlyRowCounts(measures: string[], required: string[]): boolean {
  if (required.length === 0) return false;
  const present = new Set(measures);
  const hasRequired = required.every((measure) => present.has(measure));
  if (hasRequired) return false;
  return measures.length > 0 && measures.every((measure) => ROW_COUNT_MEASURES.has(measure));
}

function checkStructure(
  table: SemanticQuerySuccess,
  executable: EvalExecutable,
  window: DateWindow | null
): { reason: string } | null {
  const required = executable.required_measures ?? [];
  const compiled = table.measures ?? [];
  if (required.length > 0 && (compiled.length === 0 || !required.every((measure) => compiled.includes(measure)) || onlyRowCounts(compiled, required))) {
    return { reason: "missing_business_measure" };
  }
  const columns = new Set(table.columns);
  const missing = (executable.required_columns ?? []).filter((column) => !columns.has(column));
  if (missing.length > 0) return { reason: "missing_column" };
  const grain = new Set(table.grain);
  const coarser = (executable.grain ?? []).some((field) => !grain.has(field));
  if (coarser) return { reason: "grain_coarser" };
  for (const filter of executable.required_filters ?? []) {
    const found = table.filters.find((item) => item.field === filter.field);
    if (!found) return { reason: "filter_mismatch" };
    if (filter.bind === "as_of_window" && window && found.value && found.value !== `${window.start}..${window.end}` && found.value !== window.end) {
      return { reason: "filter_mismatch" };
    }
    if (filter.bind === "case_value" && filter.value && found.value && found.value !== filter.value) {
      return { reason: "filter_mismatch" };
    }
  }
  return null;
}

function policyStatus(sql: string | undefined, assertions: EvalSuiteCase["sql_assertions"]): "compliant" | "noncompliant" | "unchecked" {
  const forbidden = (assertions ?? []).filter((item) => item.type === "forbidden_ast" || item.type === ("forbidden_tool" as typeof item.type));
  if (forbidden.length === 0) return "unchecked";
  if (!sql) return "unchecked";
  return forbidden.some((item) => sql.includes(item.value)) ? "noncompliant" : "compliant";
}

async function sumMeasure(executor: QueryExecutor, roleId: string, measures: string[], grain: string[], window: DateWindow | null): Promise<SemanticQuerySuccess | SemanticQueryFailure> {
  return executor({ roleId, measures, grain, filters: [], window });
}

export async function runOfflineBatch(input: {
  suite: EvalSuite;
  asOf: string;
  timeZone?: string;
  roleId: string;
  boundRoleIds: string[];
  executor: QueryExecutor;
}): Promise<EvalResultImport> {
  if (!input.roleId || !input.boundRoleIds.includes(input.roleId)) {
    throw new BatchRejectedError("未指定角色，或角色未绑定到该 domain");
  }
  const timeZone = resolveTimeZone(input.timeZone);
  const results: BatchCaseResult[] = [];
  let missingRunnable = false;
  for (const item of input.suite.cases) {
    if (item.review_status === "needs_review") {
      results.push({ case_id: item.id, status: "SKIPPED", failures: ["待复核"] });
      continue;
    }
    if (!item.executable || !item.as_of_binding) {
      missingRunnable = true;
      continue;
    }
    try {
      results.push(await runOne(item, input.asOf, timeZone, input.roleId, input.executor));
    } catch {
      results.push({
        case_id: item.id,
        status: "ERROR",
        outcome: "not_answered",
        reason: "execution_interrupted",
        error_message: "执行中断"
      });
    }
  }
  const runnableIds = input.suite.cases.filter((item) => item.review_status !== "needs_review").map((item) => item.id);
  const present = new Set(results.map((item) => item.case_id));
  if (runnableIds.some((id) => !present.has(id))) missingRunnable = true;
  return {
    lucy_eval_result_version: 2,
    complete: !missingRunnable,
    role_id: input.roleId,
    as_of: input.asOf,
    suite_id: input.suite.suite_id,
    suite_hash: input.suite.suite_hash ?? computeSuiteHash(input.suite),
    domain: input.suite.domain,
    runner: { kind: "lucy_offline_batch", version: "2", model: "" },
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    results
  };
}

async function runOne(
  item: EvalSuiteCase,
  asOf: string,
  timeZone: string,
  roleId: string,
  executor: QueryExecutor
): Promise<BatchCaseResult> {
  const executable = item.executable!;
  const window = bindWindow(item.as_of_binding!, asOf, timeZone);
  const filters = (executable.required_filters ?? []).map((filter) => ({
    field: filter.field,
    value: filter.bind === "as_of_window" && window ? `${window.start}..${window.end}` : filter.value
  }));
  let query: SemanticQuerySuccess | SemanticQueryFailure;
  try {
    query = await executor({
      roleId,
      measures: executable.required_measures,
      grain: executable.grain,
      filters,
      window
    });
  } catch {
    return {
      case_id: item.id,
      status: "ERROR",
      outcome: "not_answered",
      reason: "execution_interrupted",
      window,
      error_message: "执行中断"
    };
  }
  if (!query.ok) {
    return {
      case_id: item.id,
      status: "ERROR",
      outcome: "not_answered",
      reason: query.reason,
      window,
      error_message: query.reason
    };
  }
  const structure = checkStructure(query, executable, window);
  if (structure) {
    return {
      case_id: item.id,
      status: "FAIL",
      outcome: "answered_wrong",
      reason: structure.reason,
      window,
      sql: query.sql,
      failures: [structure.reason]
    };
  }
  for (const check of executable.reconciliation ?? []) {
    const left = await sumMeasure(executor, roleId, check.left.measures, check.left.grain, window);
    const right = await sumMeasure(executor, roleId, check.right.measures, check.right.grain, window);
    if (!left.ok) {
      return { case_id: item.id, status: "ERROR", outcome: "not_answered", reason: left.reason, window, error_message: left.reason };
    }
    if (!right.ok) {
      return { case_id: item.id, status: "ERROR", outcome: "not_answered", reason: right.reason, window, error_message: right.reason };
    }
    const tolerance = check.tolerance_abs ?? 0.01;
    const leftSum = sumRows(left.rows, check.left.measures[0]);
    const rightSum = sumRows(right.rows, check.right.measures[0]);
    if (Math.abs(leftSum - rightSum) > tolerance) {
      return {
        case_id: item.id,
        status: "FAIL",
        outcome: "answered_wrong",
        reason: "reconciliation_mismatch",
        window,
        sql: query.sql,
        failures: ["reconciliation_mismatch"]
      };
    }
  }
  const policy = policyStatus(query.sql, item.sql_assertions);
  return {
    case_id: item.id,
    status: statusFor("answered_ok"),
    outcome: "answered_ok",
    reason: undefined,
    policy_status: policy,
    window,
    sql: query.sql,
    failures: []
  };
}

function sumRows(rows: Array<Record<string, unknown>>, measure: string | undefined): number {
  if (!measure) return 0;
  return rows.reduce((sum, row) => sum + (typeof row[measure] === "number" ? row[measure] : 0), 0);
}

export function summarizeOfflineResult(result: EvalResultImport): {
  totalCases: number;
  passCount: number;
  failCount: number;
  notAnsweredCount: number;
} {
  const rows = result.results.filter((row) => row.outcome === "answered_ok" || row.outcome === "answered_wrong");
  return {
    totalCases: rows.length,
    passCount: result.results.filter((row) => row.outcome === "answered_ok").length,
    failCount: result.results.filter((row) => row.outcome === "answered_wrong").length,
    notAnsweredCount: result.results.filter((row) => row.outcome === "not_answered").length
  };
}

