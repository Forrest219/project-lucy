/**
 * Deterministic call-storyline helpers for access-log rows (Spec lucy-20261104-audit-call-storyline).
 * No LLM; derived only from tool / args / outcome / error / row counts.
 */

export type CallStoryAccessGrade =
  | "connect"
  | "browse"
  | "prepare"
  | "ask"
  | "query"
  | "control"
  | "unclassified";

export type CallStoryInput = {
  tool: string;
  accessGrade?: CallStoryAccessGrade | null;
  tables?: string[] | null;
  argsSummary?: Record<string, unknown> | null;
  outcome?: string | null;
  decisionReason?: string | null;
  errorDetail?: string | null;
  responseRowCount?: number | null;
};

export type CallStoryLine = {
  accessGrade: CallStoryAccessGrade | "unclassified";
  action: string;
  intent: string;
  resultSummary: string;
  stepHint: string;
};

const CONNECT_TOOLS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping",
  "resources/list",
  "prompts/list"
]);

export function isConnectGradeTool(tool: string): boolean {
  return CONNECT_TOOLS.has(tool);
}

export function inferAccessGrade(tool: string): CallStoryAccessGrade {
  if (CONNECT_TOOLS.has(tool)) return "connect";
  if (tool === "lucy_begin_question") return "ask";
  if (tool === "lucy_query") return "query";
  if (
    tool === "lucy_catalog" ||
    tool === "lucy_read_source" ||
    tool === "connection_list" ||
    tool.startsWith("wiki_")
  ) {
    return "browse";
  }
  if (tool.startsWith("lucy_ops") || tool.includes("ops_")) return "control";
  return "unclassified";
}

export function actionLabel(tool: string, grade?: CallStoryAccessGrade | null): string {
  if (CONNECT_TOOLS.has(tool)) return "连接握手";
  if (tool === "lucy_begin_question") return "问询登记";
  if (tool === "lucy_query") return "查数";
  if (tool === "lucy_catalog") return "浏览目录";
  if (tool === "lucy_read_source") return "读取语义源";
  if (tool.startsWith("wiki_")) return "浏览 Wiki";
  if (grade === "browse") return "浏览";
  if (grade === "prepare") return "准备";
  if (grade === "control") return "运维操作";
  return tool || "未分级动作";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        if (typeof record.field === "string") return record.field;
        if (typeof record.name === "string") return record.name;
        if (typeof record.expr === "string") return record.expr;
      }
      return "";
    })
    .filter(Boolean);
}

function shortList(items: string[], max = 4): string {
  if (items.length === 0) return "";
  if (items.length <= max) return items.join("、");
  return `${items.slice(0, max).join("、")} 等 ${items.length} 项`;
}

function leafName(field: string): string {
  const parts = field.split(".");
  return parts[parts.length - 1] || field;
}

export function measureNames(args?: Record<string, unknown> | null): string[] {
  if (!args) return [];
  return asStringArray(args.measures).map(leafName);
}

export function dimensionNames(args?: Record<string, unknown> | null): string[] {
  if (!args) return [];
  return asStringArray(args.dimensions).map(leafName);
}

export function intentFromArgs(
  tool: string,
  argsSummary?: Record<string, unknown> | null,
  tables?: string[] | null
): string {
  const tablePart = tables?.filter(Boolean).join("、") || "";

  if (tool === "lucy_begin_question") {
    const intent =
      (typeof argsSummary?.intentSummary === "string" && argsSummary.intentSummary) ||
      (typeof argsSummary?.question === "string" && argsSummary.question) ||
      "";
    const entities = asStringArray(argsSummary?.entities);
    if (intent.trim()) return truncate(intent.trim(), 120);
    if (entities.length) return `实体：${shortList(entities.map(leafName), 6)}`;
    return "登记本轮问询";
  }

  if (tool === "lucy_query") {
    const source =
      (typeof argsSummary?.source === "string" && argsSummary.source) ||
      tablePart ||
      (typeof argsSummary?.connectionId === "string" ? String(argsSummary.connectionId) : "");
    const dims = dimensionNames(argsSummary);
    const measures = measureNames(argsSummary);
    const bits: string[] = [];
    if (source) bits.push(source);
    if (dims.length) bits.push(`维 ${shortList(dims.map(leafName))}`);
    if (measures.length) bits.push(`指标 ${shortList(measures)}`);
    return bits.length ? bits.join(" · ") : tablePart || "—";
  }

  if (CONNECT_TOOLS.has(tool)) return "MCP 会话握手";
  if (tablePart) return tablePart;
  return "—";
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const SENSITIVE_PAIR = /(password|token|api[_-]?key|secret|private[_-]?key)\s*=\s*[^\s,;]+/gi;

function redactStoryText(text: string): string {
  const firstLine = text.split("\n")[0] ?? text;
  return firstLine.replace(SENSITIVE_PAIR, "$1=[REDACTED]");
}

/** Pull a short human error phrase from redacted error_detail JSON/text. */
export function humanErrorPhrase(errorDetail?: string | null): string | null {
  if (!errorDetail) return null;
  const trimmed = errorDetail.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
          const text = ((item as { text: string }).text || "").trim();
          if (text) return truncate(redactStoryText(text), 160);
        }
      }
    }
    if (parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string") {
      return truncate(redactStoryText(String((parsed as { message: string }).message).trim()), 160);
    }
  } catch {
    // plain text
  }

  const plain = trimmed.replace(/^\[|\]$/g, "").trim();
  return plain ? truncate(redactStoryText(plain), 160) : null;
}

export function resultSummary(input: CallStoryInput): string {
  const outcome = input.outcome ?? "";
  if (outcome === "ok") {
    if (typeof input.responseRowCount === "number") {
      return `成功 · ${input.responseRowCount} 行`;
    }
    return "成功";
  }
  if (outcome === "denied") {
    return input.decisionReason ? `拒绝 · ${input.decisionReason}` : "拒绝";
  }
  if (outcome === "error") {
    const phrase = humanErrorPhrase(input.errorDetail);
    if (phrase) return `失败 · ${phrase}`;
    if (input.decisionReason) return `失败 · ${input.decisionReason}`;
    return "失败";
  }
  return outcome || "—";
}

export function stepHint(prev: CallStoryInput | null | undefined, curr: CallStoryInput): string {
  if (!prev) return "—";
  if (prev.tool !== "lucy_query" || curr.tool !== "lucy_query") return "—";

  const prevTables = (prev.tables ?? []).join("|");
  const currTables = (curr.tables ?? []).join("|");
  if (!prevTables || prevTables !== currTables) return "—";

  const prevMeasures = new Set(measureNames(prev.argsSummary));
  const currMeasures = new Set(measureNames(curr.argsSummary));
  if (prevMeasures.size === 0 && currMeasures.size === 0) return "—";

  const currSubset =
    currMeasures.size > 0 &&
    currMeasures.size < prevMeasures.size &&
    [...currMeasures].every((m) => prevMeasures.has(m));

  if (prev.outcome === "error" && curr.outcome === "ok" && currSubset) return "缩指标重试";
  if (prev.outcome === "error" && curr.outcome === "ok") return "改写后成功";
  if (prev.outcome === "error" && curr.outcome === "error" && sameSet(prevMeasures, currMeasures)) {
    return "再次失败";
  }
  if (currSubset && curr.outcome === "error") return "缩指标重试";
  return "—";
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

export function buildCallStoryLine(
  call: CallStoryInput,
  prevVisible?: CallStoryInput | null
): CallStoryLine {
  const accessGrade = call.accessGrade ?? inferAccessGrade(call.tool);
  return {
    accessGrade,
    action: actionLabel(call.tool, accessGrade),
    intent: intentFromArgs(call.tool, call.argsSummary, call.tables),
    resultSummary: resultSummary(call),
    stepHint: stepHint(prevVisible, call)
  };
}
