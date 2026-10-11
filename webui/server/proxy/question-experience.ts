/**
 * Spec 162 — question budget, failure dimensions, filter-pushdown guard,
 * published version metadata, and usage actor grouping.
 * KTX is not modified. These functions fail closed inside the Lucy proxy.
 */

export const QUESTION_BUDGET_MAX_CALLS = 20;
export const QUESTION_BUDGET_MAX_WALL_MS = 120_000;

const DATA_TOOLS = new Set([
  "lucy_query",
  "lucy_read_source",
  "lucy_freshness",
  "lucy_explain_query",
  "wiki_search",
  "wiki_read",
]);

const ACL_REASONS = new Set([
  "sensitive_metadata_forbidden",
  "wiki_forbidden",
  "raw_query_forbidden",
  "agent_disabled",
]);

/** Spec 162 §7.6 — protocol methods never enter the default usage KPI. */
const PROTOCOL_TOOL_SET = new Set([
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "ping",
  "server/discover",
  "initialize",
  "notifications/initialized",
  "notifications/cancelled"
]);

export type FailureDimension = "" | "引擎超时与并发" | "过滤条件下推" | "用法与语义" | "权限拒绝";
export type UsageGroup = "使用人" | "Agent" | "自动化调用";
export type ActorKind = "person" | "automation";

export type PublishedVersion = {
  version: string;
  businessDate: string;
  valueKind: "实际" | "预测";
};

export type BudgetStop = {
  action: "stop";
  reason: "question_budget_exhausted";
  partial: true;
  continueToken: string;
  continuable: true;
};

type BudgetState = {
  startedAt: number;
  calls: number;
  continuations: number;
};

export function questionBudgetEnabled(): boolean {
  return process.env.LUCY_QUESTION_BUDGET !== "off";
}

export function filterPushdownGuardEnabled(): boolean {
  return process.env.LUCY_FILTER_PUSHDOWN_GUARD !== "off";
}

export function isQuestionDataTool(tool: string | undefined): boolean {
  return Boolean(tool && DATA_TOOLS.has(tool));
}

export class QuestionBudget {
  private readonly turns = new Map<string, BudgetState>();

  consume(turnId: string | undefined, now: number, continueToken?: string): { action: "allow" } | BudgetStop {
    if (!turnId) return { action: "allow" };
    let state = this.turns.get(turnId);
    if (!state) {
      state = { startedAt: now, calls: 0, continuations: 0 };
      this.turns.set(turnId, state);
    }
    const exhausted = state.calls >= QUESTION_BUDGET_MAX_CALLS || now - state.startedAt >= QUESTION_BUDGET_MAX_WALL_MS;
    if (exhausted && continueToken === turnId && state.continuations < 1) {
      state.calls = 0;
      state.startedAt = now;
      state.continuations += 1;
    }
    const stillExhausted = state.calls >= QUESTION_BUDGET_MAX_CALLS || now - state.startedAt >= QUESTION_BUDGET_MAX_WALL_MS;
    if (stillExhausted) {
      return {
        action: "stop",
        reason: "question_budget_exhausted",
        partial: true,
        continueToken: turnId,
        continuable: true,
      };
    }
    state.calls += 1;
    return { action: "allow" };
  }
}

export const questionBudget = new QuestionBudget();

/** "AS field" together with "AS op" or "STRUCT(", plus the truncated `...RUCT(` engine fragment. */
export function isFilterPushdownText(text: string): boolean {
  if (/\.\.\.RUCT\s*\(/i.test(text)) return true;
  const hasAsField = /\bAS\s+field\b/i.test(text);
  const hasAsOp = /\bAS\s+op\b/i.test(text);
  const hasStruct = /STRUCT\s*\(/i.test(text);
  return hasAsField && (hasAsOp || hasStruct);
}

export function classifyFailure(input: {
  outcome?: string;
  decisionReason?: string;
  errorDetail?: string;
}): FailureDimension {
  const reason = input.decisionReason ?? "";
  const text = input.errorDetail ?? "";
  if (input.outcome === "budget_stop" || reason === "question_budget_exhausted") return "";
  if (reason === "wiki_not_found" || reason === "explicit_table_required:<empty>") return "用法与语义";
  if (reason.startsWith("explicit_table_required:") && reason !== "explicit_table_required:<empty>") return "权限拒绝";
  if (
    ACL_REASONS.has(reason)
    // acl.ts emits `sensitive_metadata_forbidden:kx`; the dimension is the
    // same permission denial regardless of the suffix.
    || reason.startsWith("sensitive_metadata_forbidden")
    || reason.startsWith("table_forbidden:")
    || reason.startsWith("unknown_or_forbidden_connection:")
    || reason.startsWith("tool_unclassified:")
    || reason.startsWith("wiki_forbidden")
  ) {
    return "权限拒绝";
  }
  if (reason === "timeout" || reason === "query_concurrency_exceeded" || text.includes("Timeout")) {
    return "引擎超时与并发";
  }
  if (isFilterPushdownText(text) || reason === "filter_pushdown") return "过滤条件下推";
  if (input.outcome && input.outcome !== "ok") return "用法与语义";
  return "";
}

const FILTER_HINT = "这次过滤条件无法下推。请改成等值、包含或枚举条件后再查。";
const MEASURE_HINT = "请改用当前角色已授权的 source-qualified 指标名。";

export function repairHint(
  input: { failureDimension: string; suggestedSources?: string[] },
  allowedSources: ReadonlySet<string>,
): string | null {
  const suggested = input.suggestedSources ?? [];
  const safe = suggested.filter((name) => name.length > 0 && allowedSources.has(name));
  const leaked = suggested.filter((name) => name.length > 0 && !allowedSources.has(name));
  if (input.failureDimension === "过滤条件下推") {
    const text = safe.length > 0 ? `${FILTER_HINT}可用来源：${safe.join("、")}。` : FILTER_HINT;
    return leaked.some((name) => text.includes(name)) ? FILTER_HINT : text;
  }
  if (input.failureDimension === "用法与语义" || input.failureDimension === "权限拒绝") {
    if (safe.length === 0) return input.failureDimension === "权限拒绝" ? null : MEASURE_HINT;
    const text = `请改用当前角色已授权的来源：${safe.join("、")}。`;
    return leaked.some((name) => text.includes(name)) ? MEASURE_HINT : text;
  }
  return null;
}

const publications = new Map<string, PublishedVersion>();

export function registerPublishedVersion(sourceName: string, publication: PublishedVersion | null): void {
  if (!publication?.version) {
    publications.delete(sourceName);
    return;
  }
  publications.set(sourceName, publication);
}

export function lookupPublishedVersion(sourceName: string | undefined): PublishedVersion | null {
  if (!sourceName) return null;
  return publications.get(sourceName) ?? null;
}

export function publishedSourceName(args: Record<string, unknown>, fallback?: string): string | undefined {
  for (const key of ["sourceName", "source_name", "source", "table"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const measures = args.measures;
  if (Array.isArray(measures)) {
    const qualified = measures.find((item) => typeof item === "string" && item.includes("."));
    if (typeof qualified === "string") return qualified.slice(0, qualified.lastIndexOf("."));
  }
  return fallback;
}

export function resolveAppliedVersion(
  args: { version?: string },
  publication: PublishedVersion | null | undefined,
): PublishedVersion | null {
  if (!publication?.version || !publication.businessDate || !publication.valueKind) return null;
  if (typeof args.version === "string" && args.version.trim()) return null;
  return {
    version: publication.version,
    businessDate: publication.businessDate,
    valueKind: publication.valueKind,
  };
}

export function actorFromToken(token: {
  label?: string;
  actor_id?: string | null;
  actor_kind?: string | null;
}): { actorId?: string; actorKind?: ActorKind } {
  const actorId = typeof token.actor_id === "string" ? token.actor_id.trim() : "";
  const actorKind = token.actor_kind === "person" || token.actor_kind === "automation" ? token.actor_kind : undefined;
  if (!actorId || !actorKind) return {};
  return { actorId, actorKind };
}

/**
 * Spec 162 / WO-13 T6 — 评测标记. Optional explicit Token field `eval_mark`.
 * Absent or `false` means unmarked. Never inferred from User-Agent,
 * `token_label`, connection name, or `actor_kind`.
 */
export function evalMarkFromToken(token: { eval_mark?: unknown } | null | undefined): boolean {
  return token?.eval_mark === true;
}

const PROBE_NAME_MARKERS = ["probe-", "rds-test", "demo-mysql"] as const;

/** Probe-looking by name only. SC-16 requires `eval_mark` on top of this. */
export function hasProbeName(value: string | null | undefined): boolean {
  if (!value) return false;
  const lowered = value.toLowerCase();
  return PROBE_NAME_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * Spec 162 §7.6 — a probe call leaves the default usage view only when BOTH
 * hold: the args or connection name looks like a probe, and the Token carries
 * an explicit `eval_mark`. Name-only matches stay in the default view.
 */
export function isEvalProbeCall(input: {
  evalMark?: boolean | null;
  connectionName?: string | null;
  args?: Record<string, unknown> | null;
}): boolean {
  if (!input.evalMark) return false;
  if (hasProbeName(input.connectionName)) return true;
  const args = input.args;
  if (!args || typeof args !== "object") return false;
  for (const [key, value] of Object.entries(args)) {
    if (!/connection|source|table|database|schema/i.test(key)) continue;
    if (typeof value === "string" && hasProbeName(value)) return true;
  }
  return false;
}

/** Spec 162 §7.6 — raw rows are never dropped; only the default view splits. */
export function defaultUsageExcluded(row: { tool?: string | null; evalMark?: boolean | null; connectionName?: string | null; args?: Record<string, unknown> | null }): boolean {
  if (row.tool && PROTOCOL_TOOL_SET.has(row.tool)) return true;
  return isEvalProbeCall({
    evalMark: row.evalMark,
    connectionName: row.connectionName,
    args: row.args
  });
}

/**
 * Spec 162 §7.3 — the single allow-list function shared by every permission
 * denial payload. Names outside the caller's ACL must never appear (SC-14).
 */
export function denialAllowList(
  permissions: { connections?: readonly string[]; sources?: ReadonlyArray<{ sourceName?: string; table?: string }> },
): { connections: string[]; sources: string[] } {
  const connections = [...new Set((permissions.connections ?? []).filter(Boolean))].sort();
  const sources = [...new Set(
    (permissions.sources ?? [])
      .map((source) => source.sourceName || source.table || "")
      .filter(Boolean)
  )].sort();
  return { connections, sources };
}

export const TRUNCATION_REPAIR_HINT = "结果已截断，改为聚合后再取明细。";

/**
 * Spec 162 §7.5 / SC-10 — `lucy_query` success rows always carry
 * `response_truncated` as 0 or 1. Hitting the row cap forces 1 and adds the
 * aggregate repair hint. `lucy_freshness` / `lucy_explain_query` keep their
 * own existing 0.
 */
export function resolveResponseTruncated(input: {
  upstreamTruncated?: boolean;
  rowCount?: number | null;
  rowCap?: number | null;
}): { responseTruncated: 0 | 1; repair?: string } {
  const hitRowCap = typeof input.rowCount === "number"
    && typeof input.rowCap === "number"
    && input.rowCap > 0
    && input.rowCount >= input.rowCap;
  if (input.upstreamTruncated === true || hitRowCap) {
    return { responseTruncated: 1, repair: TRUNCATION_REPAIR_HINT };
  }
  return { responseTruncated: 0 };
}

/** Spec 162 §7.8 / T4 — `count(*)` or `count(1)` with no source. */
export const ROW_COUNT_MEASURE_HINT = "row_count(source)";

const COUNT_WITHOUT_SOURCE = /^(?:count\s*\(\s*(?:\*|1)\s*\)|count\s+\*)$/i;
const AGGREGATE_WRAPPER = /^(sum|avg|min|max|count)\s*\(\s*(.+?)\s*\)$/i;

export type BuiltinMeasureDecision =
  | { action: "compile"; measure: string }
  | { action: "repair"; reason: string; repair: string }
  | { action: "reject"; reason: string; message: string };

/**
 * Spec 162 §7.8 / SC-15 — built-in measure guardrails.
 * - `count(*)` / `count(1)` without a source → repair hint to `row_count(source)`.
 * - `sum()` over an already aggregated published measure → never `sum(sum())`.
 * - completeness without a declared denominator → refuse to compile.
 */
export function compileBuiltinMeasure(input: {
  measure: string;
  source?: string | null;
  aggregatedMeasures?: readonly string[];
  completenessDenominator?: string | null;
}): BuiltinMeasureDecision {
  const raw = input.measure.trim();
  if (!raw) return { action: "repair", reason: "measure_missing", repair: ROW_COUNT_MEASURE_HINT };

  const source = typeof input.source === "string" && input.source.trim() ? input.source.trim() : null;
  const aggregated = new Set(
    (input.aggregatedMeasures ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const unqualified = source && raw.toLowerCase().startsWith(`${source.toLowerCase()}.`)
    ? raw.slice(source.length + 1)
    : raw;

  if (/completeness|完整度/i.test(unqualified)) {
    const denominator = input.completenessDenominator?.trim();
    if (!denominator) {
      return {
        action: "reject",
        reason: "completeness_denominator_required",
        message: "完整度度量必须声明分子与分母 grain，缺少分母时拒绝编译。"
      };
    }
    return { action: "compile", measure: raw };
  }

  if (!source && COUNT_WITHOUT_SOURCE.test(raw)) {
    return { action: "repair", reason: "count_without_source", repair: ROW_COUNT_MEASURE_HINT };
  }

  const wrapper = AGGREGATE_WRAPPER.exec(raw);
  if (wrapper) {
    const inner = wrapper[2].trim();
    const sourcePrefix = source ? `${source.toLowerCase()}.` : "";
    // Compare the inner name in every shape it can legitimately arrive in:
    // as written, stripped of the source prefix, and re-qualified.
    const candidates = new Set([inner.toLowerCase()]);
    if (sourcePrefix && inner.toLowerCase().startsWith(sourcePrefix)) {
      candidates.add(inner.toLowerCase().slice(sourcePrefix.length));
    }
    if (source) candidates.add(`${sourcePrefix}${inner.toLowerCase()}`);
    const wrapsAggregate = [...candidates].some((candidate) => aggregated.has(candidate));
    if (wrapsAggregate) {
      return {
        action: "repair",
        reason: "aggregate_of_aggregate",
        repair: `请直接使用已发布的度量名 ${inner}，不要对它再套 ${wrapper[1].toLowerCase()}。`
      };
    }
  }

  return { action: "compile", measure: raw };
}

export function usageGroup(row: {
  actorId?: string | null;
  actorKind?: string | null;
  userId: string;
  client?: string | null;
}): UsageGroup {
  if (row.actorKind === "automation" && row.actorId) return "自动化调用";
  if (row.actorKind === "person" && row.actorId) return "使用人";
  return "Agent";
}
