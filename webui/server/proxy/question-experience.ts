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
