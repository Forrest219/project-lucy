/**
 * Shared audit privacy helpers (Spec 137).
 * Natural-language redaction + args_summary shaping for access_log.
 *
 * ─── Lucy v0.25 / L25-09 (B5 / B28 / U11) ─────────────────────────────────
 *
 * - B28：被脱敏的参数**保留存在性**（`[REDACTED]` 标记）而不保留值；
 *   单值序列化后 ≤ 512 UTF-8 字节，且**不切断字符 / JSON**。
 * - B5：`query_preview` 上限由 180 扩展到 **500 个 Unicode 码点**（U11）。
 *   历史行保持 180 原值 + `preview_version` 标记，**不改写历史行**（D7）。
 * - `digest_kind` 区分 `search_text` / `sql` / `result`。
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

/**
 * Lucy v0.25 / L25-09 U11 — `query_preview` 的新上限（Unicode 码点）。
 * 180 是历史实现的旧上限；历史行保持原值，新行按 500 写并标 `preview_version=v2p5-1`。
 */
export const QUERY_PREVIEW_MAX_CODEPOINTS = 500;
/** 历史实现的旧上限，仅用于读路径标注 legacy 版本。 */
export const LEGACY_QUERY_PREVIEW_MAX_CODEPOINTS = 180;

/** B28 — `args_summary` 单值序列化后的 UTF-8 字节上限。 */
export const ARGS_VALUE_MAX_BYTES = 512;
/** B28 — 被脱敏参数的**存在性**标记（不保留值）。 */
export const REDACTED_VALUE_MARKER = "[REDACTED]";

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

/**
 * B28 — 把一个参数值收敛到 ≤ 512 UTF-8 字节的**安全**表示。
 *
 * 规则：
 *   - 序列化后 ≤ 512 字节 → 原样保留。
 *   - 超限 → 换成**保留类型**的摘要 / 省略标记，**不切断字符**、**不截出无效 JSON**。
 *   - 字符串超限 → 省略标记（保留长度信息，便于审计判断「有值但很长」）。
 *   - 结构化值超限 → `{ kind, truncated: true, bytes }`，不切一半的数组 / 对象。
 */
export function boundAuditValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "";
  } catch {
    // 循环引用等不可序列化结构：只记类型，绝不强行序列化。
    return { kind: "unserializable", truncated: true };
  }
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= ARGS_VALUE_MAX_BYTES) return value;
  if (typeof value === "string") {
    return { kind: "omitted", truncated: true, bytes };
  }
  if (Array.isArray(value)) {
    return { kind: "array", truncated: true, bytes, count: value.length };
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return { kind: "object", truncated: true, bytes, keyCount: keys.length };
  }
  return { kind: typeof value, truncated: true, bytes };
}

/**
 * B28 — 工具感知的参数 presence。
 *
 * 被脱敏的 key **不再被丢弃**：保留参数名 + `[REDACTED]` 标记（存在性），
 * 但**不保留值**。`filterSensitiveKeys` 此前直接丢弃敏感 key，导致
 * 「参数缺失」与「参数存在但已脱敏」不可区分（Spec §4.3(c)）。
 *
 * 注意：本函数**不做**长度收敛 —— 收敛必须在 `filters` 结构化摘要**之后**，
 * 否则会把已摘要的结构二次降级。
 */
function filterSensitiveKeys(args: Record<string, unknown>, maxKeys = 8): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(args)) {
    if (kept >= maxKeys) break;
    if (SENSITIVE_ARG_KEY_RE.test(key)) {
      // 保留存在性，不保留值。
      out[key] = REDACTED_VALUE_MARKER;
      kept += 1;
      continue;
    }
    out[key] = value;
    kept += 1;
  }
  return out;
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
 *
 * B28 顺序：`filters` 先做结构化摘要（去值），其余单值再做 512 字节收敛。
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

  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (hasFreeText && FREE_TEXT_ARG_KEYS.has(k)) continue;
    // 已脱敏的 presence 标记是固定短串，不再收敛。
    summary[k] = v === REDACTED_VALUE_MARKER ? v : boundAuditValue(v);
  }
  return summary;
}

export type ScrubArgsSummaryResult = {
  changed: boolean;
  nextJson: string | null;
};

/**
 * B5 / U11 — 按 **Unicode 码点**截断，**不切断字符**。
 *
 * `String.prototype.slice` 按 UTF-16 码元切，会把代理对（emoji 等）切成两半；
 * 这里按码点（`Array.from`）切，边界永远落在完整字符上。
 */
export function truncateByCodePoints(text: string, maxCodePoints: number): string {
  if (maxCodePoints <= 0) return "";
  const points = Array.from(text);
  if (points.length <= maxCodePoints) return text;
  return points.slice(0, maxCodePoints).join("");
}

export type QueryPreviewResult = {
  /** 有界预览（≤ 500 码点）。 */
  preview: string;
  /** 是否被截断。 */
  truncated: boolean;
  /** 原始输入的 UTF-8 字节长度。 */
  originalBytes: number;
  /** 预览版本标记。 */
  previewVersion: string;
};

/**
 * B5 / U11 — 生成 `query_preview`。
 *
 * 先执行既有脱敏，再生成有界预览；记录截断与原始 UTF-8 字节长度。
 * 摘要**不以截断预览冒充完整输入**（摘要另走 `digest_kind`）。
 */
export function buildQueryPreview(
  redactedText: string,
  options?: { maxCodePoints?: number; previewVersion?: string }
): QueryPreviewResult {
  const maxCodePoints = options?.maxCodePoints ?? QUERY_PREVIEW_MAX_CODEPOINTS;
  const preview = truncateByCodePoints(redactedText, maxCodePoints);
  return {
    preview,
    truncated: preview.length < redactedText.length,
    originalBytes: Buffer.byteLength(redactedText, "utf8"),
    previewVersion: options?.previewVersion ?? "v2p5-1"
  };
}

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
