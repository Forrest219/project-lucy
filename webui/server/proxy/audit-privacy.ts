/**
 * Shared audit privacy helpers (Spec 137).
 * Natural-language redaction + args_summary shaping for access_log.
 */

const SENSITIVE_ARG_KEY_RE =
  /(?:sql|query|password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)/i;

const QUESTION_SENSITIVE_PAIR_RE =
  /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|credential)\b\s*[:=]\s*([^,\s;]+)/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const CN_ID_CARD_RE = /\b\d{17}[\dXx]\b/g;
const CN_MOBILE_RE = /\b1[3-9]\d{9}\b/g;

const QUERY_TABLE_RE =
  /\b(?:from|join|into|update|table)\s+[`"]?([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){0,2})[`"]?/gi;

const FREE_TEXT_ARG_KEYS = new Set(["question", "questionPreview", "intentSummary"]);

export function questionPreviewMaxChars(): number {
  return Number(process.env.LUCY_QUESTION_PREVIEW_MAX_CHARS ?? 500);
}

export function storeQuestionPreviewEnabled(): boolean {
  return process.env.LUCY_STORE_QUESTION_PREVIEW !== "false";
}

/** Free-text redaction for lucy_begin_question (Spec 08 §10 / Spec 137). */
export function redactQuestionText(text: string): string {
  return text
    .replace(QUESTION_SENSITIVE_PAIR_RE, "$1=[REDACTED]")
    .replace(EMAIL_RE, "[REDACTED]")
    .replace(CN_ID_CARD_RE, "[REDACTED]")
    .replace(CN_MOBILE_RE, "[REDACTED]");
}

export function looksLikeSql(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^(with|select|describe|explain)\b/i.test(t)) return true;
  // Avoid English "show me the table list" matching as SQL SHOW.
  if (/^show\s+(tables|columns|databases|create|indexes?|status|variables)\b/i.test(t)) return true;
  return false;
}

export function extractQueryTables(query: string): string[] {
  if (!looksLikeSql(query)) return [];
  const tables = new Set<string>();
  for (const match of query.matchAll(QUERY_TABLE_RE)) {
    if (match[1]) tables.add(match[1]);
  }
  return [...tables];
}

function filterSensitiveKeys(args: Record<string, unknown>, maxKeys = 8): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args)
      .filter(([k]) => !SENSITIVE_ARG_KEY_RE.test(k))
      .slice(0, maxKeys)
  );
}

function auditSafeField(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 160) return undefined;
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)
    ? value
    : undefined;
}

function auditSafeOperator(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 24) return undefined;
  return /^[A-Za-z_]+$/.test(value) ? value : undefined;
}

function summarizeFilterItem(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    return { kind: "expression", length: value.length };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: typeof value };
  }
  const record = value as Record<string, unknown>;
  const valueCount = Array.isArray(record.values)
    ? record.values.length
    : Object.prototype.hasOwnProperty.call(record, "value")
      ? 1
      : 0;
  const field = auditSafeField(record.field);
  const op = auditSafeOperator(record.op);
  return {
    kind: "structured",
    ...(field ? { field } : {}),
    ...(op ? { op } : {}),
    valueCount
  };
}

function summarizeFilters(value: unknown): Record<string, unknown> {
  const items = Array.isArray(value) ? value : [value];
  return {
    kind: Array.isArray(value) ? "list" : "single",
    count: items.length,
    items: items.slice(0, 8).map(summarizeFilterItem)
  };
}

/**
 * Shape tool args for access_log.args_summary.
 * Never persists natural-language question text in access_log. Reported
 * question text belongs only in conversation_turns, where retention applies.
 */
export function summarizeArgsForAudit(
  tool: string | undefined,
  args: Record<string, unknown>
): Record<string, unknown> {
  const base = filterSensitiveKeys(args);
  if (Object.prototype.hasOwnProperty.call(base, "filters")) {
    base.filters = summarizeFilters(base.filters);
  }
  const hasFreeText =
    tool === "lucy_begin_question" ||
    Object.keys(base).some((k) => FREE_TEXT_ARG_KEYS.has(k)) ||
    typeof args.question === "string" ||
    typeof args.intentSummary === "string";

  if (!hasFreeText) return base;

  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (FREE_TEXT_ARG_KEYS.has(k)) continue;
    summary[k] = v;
  }
  return summary;
}

export type ScrubArgsSummaryResult = {
  changed: boolean;
  nextJson: string | null;
};

/** Rewrite stored args_summary JSON; remove every natural-language copy. */
export function scrubArgsSummaryJson(jsonText: string | null | undefined): ScrubArgsSummaryResult {
  if (!jsonText) return { changed: false, nextJson: jsonText ?? null };
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { changed: false, nextJson: jsonText };
    }
    obj = { ...(parsed as Record<string, unknown>) };
  } catch {
    return { changed: false, nextJson: jsonText };
  }

  let changed = false;
  for (const key of FREE_TEXT_ARG_KEYS) {
    if (key in obj) {
      delete obj[key];
      changed = true;
    }
  }

  return { changed, nextJson: changed ? JSON.stringify(obj) : jsonText };
}
