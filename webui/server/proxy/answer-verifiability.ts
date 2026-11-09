/**
 * P0-4 / REQ-030-022 — 答复可核对块（answer_verifiability）。
 *
 * 权威合同：docs/specs/lucy-20261107-answer-verifiability-spec.md v0.4-draft
 * （D1–D10、§5 schema、§5.6 全链路保真、§6 失败分支）。
 *
 * 本模块为纯函数主阵地：构造块、口径归一、请求 pin 证据校验、无损投影。
 * 不改 ACL；不接 P0-B／lucy_freshness 探测；首期 cutoff 一律 not_checked。
 */

import { createHash } from "node:crypto";
import {
  bindingScopeKey,
  readBindingSession,
  type BindingSessionRecord,
  type BoundCaliber
} from "./caliber-binding-session.js";
import type { CanonicalSourceKey, SourceRef } from "./acl.js";

export const ANSWER_VERIFIABILITY_KEY = "answer_verifiability" as const;
export const ANSWER_VERIFIABILITY_SCHEMA_VERSION = "1" as const;
export const CUTOFF_NOTE_NOT_CHECKED = "数据截止期未校验" as const;

export const REASON_SOURCE_UNRESOLVED = "answer_verifiability_source_unresolved" as const;
export const REASON_ASSEMBLE_FAILED = "answer_verifiability_assemble_failed" as const;
export const REASON_CALIBER_EVIDENCE_MISSING = "answer_verifiability_caliber_evidence_missing" as const;

const STRUCTURED_CONTENT_PLACEHOLDER = "__LUCY_AV_STRUCTURED_CONTENT_RAW__";

// ─── Public types ────────────────────────────────────────────────────────────

export type SourceIdentity = {
  connectionId: string;
  schema: string | null;
  sourceName: string;
  table: string;
  display: string;
};

export type OrderBySummary = {
  field: string;
  direction?: "asc" | "desc";
};

export type UserFilterSummary =
  | {
      form: "structured";
      field: string;
      op: string;
      valueRedacted: true;
      valueLength?: number;
    }
  | {
      form: "string";
      fieldRefs: string[];
      opsNormalized: string[];
      valueRedacted: true;
      valueLength?: number;
    };

export type SystemConstraintSummary = {
  kind: "row_policy" | "injected_predicate" | "other";
  summary: string;
  omitted: boolean;
};

export type OmissionsMap = {
  filters_truncated?: boolean;
  measures_truncated?: boolean;
  maxItems?: number;
  [k: string]: boolean | number | string | undefined;
};

export type CaliberBindingRef =
  | { status: "none" }
  | {
      status: "activated_snapshot";
      bindingId: string;
      sessionGeneration: number;
      registryGeneration: number;
      digest: string;
    };

export type CaliberSummary = {
  measures: string[];
  dimensions: string[];
  segments: string[];
  orderBy: OrderBySummary[];
  userFilters: UserFilterSummary[];
  systemConstraints: SystemConstraintSummary[];
  caliberBinding: CaliberBindingRef;
  omissions: OmissionsMap;
};

export type CutoffDisclosure = {
  status: "not_checked";
  note: typeof CUTOFF_NOTE_NOT_CHECKED;
};

export type AnswerVerifiabilityBlock = {
  schema_version: typeof ANSWER_VERIFIABILITY_SCHEMA_VERSION;
  sources: SourceIdentity[];
  caliber: CaliberSummary;
  cutoff: CutoffDisclosure;
  carriers?: {
    structuredContent?: "projected" | "omitted_not_object";
  };
};

/** 门禁当拍随请求携带的不可变证据（§5.2.1）。 */
export type RequestPinnedCaliberEvidence =
  | { status: "none" }
  /** begun_bound 但字段残缺：仅请求内标记，禁止伪装 none 放行。 */
  | { status: "evidence_missing" }
  | {
      status: "activated_snapshot";
      bindingId: string;
      sessionGeneration: number;
      registryGeneration: number;
      digest: string;
      /** 仅请求内携带；公开块不落 caliberSnapshot 全文。 */
      caliberSnapshot: BoundCaliber;
      boundKey: CanonicalSourceKey;
    };

export type BuildAnswerVerifiabilityInput = {
  sources: SourceIdentity[];
  argsBeforeRewrite: Record<string, unknown>;
  systemConstraints: SystemConstraintSummary[];
  requestPinnedCaliber: RequestPinnedCaliberEvidence;
  /** 测试注入；生产路径禁止用其冒充 checked。 */
  cutoffOverrideForbidden?: never;
};

export type BuildOk = { ok: true; block: AnswerVerifiabilityBlock };
export type BuildFail = {
  ok: false;
  reason: typeof REASON_SOURCE_UNRESOLVED | typeof REASON_ASSEMBLE_FAILED | typeof REASON_CALIBER_EVIDENCE_MISSING;
  detail?: string;
};

export type ProjectOk = {
  ok: true;
  finalWire: string;
  block: AnswerVerifiabilityBlock;
};
export type ProjectFail = {
  ok: false;
  reason: typeof REASON_ASSEMBLE_FAILED;
  detail?: string;
};

// ─── Source identity ─────────────────────────────────────────────────────────

export function toSourceIdentity(ref: SourceRef): SourceIdentity | null {
  const connectionId = typeof ref.connectionId === "string" ? ref.connectionId.trim() : "";
  const sourceName = typeof ref.sourceName === "string" ? ref.sourceName.trim() : "";
  const table = typeof ref.physicalTable === "string" ? ref.physicalTable.trim() : "";
  if (!connectionId || !sourceName || !table) return null;
  const schema =
    typeof ref.schema === "string" && ref.schema.trim().length > 0 ? ref.schema.trim() : null;
  const display = schema
    ? `${connectionId}.${schema}.${sourceName}`
    : `${connectionId}.${sourceName}`;
  return { connectionId, schema, sourceName, table, display };
}

export function resolveAuthoritativeSourceIdentities(
  sourceRefs: SourceRef[]
): { ok: true; items: SourceIdentity[] } | { ok: false; reason: typeof REASON_SOURCE_UNRESOLVED } {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    return { ok: false, reason: REASON_SOURCE_UNRESOLVED };
  }
  const items: SourceIdentity[] = [];
  for (const ref of sourceRefs) {
    const identity = toSourceIdentity(ref);
    if (!identity) return { ok: false, reason: REASON_SOURCE_UNRESOLVED };
    items.push(identity);
  }
  return { ok: true, items };
}

// ─── Caliber pin evidence（§5.2.1）──────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 稳定规范序列化：对象键字典序；禁止依赖 JS Number 表示高精度量。 */
export function canonicalJsonForDigest(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortKeysDeep(value[key]);
  }
  return out;
}

export function digestPinnedCaliberSnapshot(input: {
  bindingId: string;
  boundKey: CanonicalSourceKey;
  caliberSnapshot: BoundCaliber;
}): string {
  const payload = {
    bindingId: input.bindingId,
    boundKey: {
      connectionId: input.boundKey.connectionId,
      schema: input.boundKey.schema ?? null,
      sourceName: input.boundKey.sourceName,
      physicalTable: input.boundKey.physicalTable
    },
    caliberSnapshot: {
      measures: [...input.caliberSnapshot.measures],
      dimensions: [...input.caliberSnapshot.dimensions],
      segments: [...input.caliberSnapshot.segments],
      filterFields: [...input.caliberSnapshot.filterFields],
      requireMeasures: [...input.caliberSnapshot.requireMeasures]
    }
  };
  return createHash("sha256").update(canonicalJsonForDigest(payload), "utf8").digest("hex");
}

export function buildPinnedCaliberEvidenceFromRecord(
  record: BindingSessionRecord | null,
  state: string
): RequestPinnedCaliberEvidence {
  // 非 begun_bound → 明确 none；begun_bound 残缺不得降成 none（§5.2.1／M5）。
  if (state !== "begun_bound") return { status: "none" };
  if (!record) return { status: "evidence_missing" };
  const bindingId = typeof record.bindingId === "string" ? record.bindingId.trim() : "";
  const sessionGeneration = record.generation;
  const registryGeneration = record.registryGeneration;
  const snapshot = record.caliberSnapshot;
  const boundKey = record.boundKey;
  if (
    !bindingId
    || typeof sessionGeneration !== "number"
    || !Number.isFinite(sessionGeneration)
    || typeof registryGeneration !== "number"
    || !Number.isFinite(registryGeneration)
    || !snapshot
    || !boundKey
  ) {
    return { status: "evidence_missing" };
  }
  const digest = digestPinnedCaliberSnapshot({
    bindingId,
    boundKey,
    caliberSnapshot: snapshot
  });
  return {
    status: "activated_snapshot",
    bindingId,
    sessionGeneration,
    registryGeneration,
    digest,
    caliberSnapshot: {
      measures: [...snapshot.measures],
      dimensions: [...snapshot.dimensions],
      segments: [...snapshot.segments],
      filterFields: [...snapshot.filterFields],
      requireMeasures: [...snapshot.requireMeasures]
    },
    boundKey: {
      connectionId: boundKey.connectionId,
      schema: boundKey.schema,
      sourceName: boundKey.sourceName,
      physicalTable: boundKey.physicalTable
    }
  };
}

/**
 * 门禁 allow 当拍捕获；随请求携带。禁止响应阶段再调本函数填公开引用。
 */
export async function captureRequestPinnedCaliberEvidence(input: {
  identityKey: string;
  sessionId: string | null | undefined;
}): Promise<RequestPinnedCaliberEvidence> {
  const scopeKey = bindingScopeKey(input.identityKey, input.sessionId);
  const session = await readBindingSession(scopeKey);
  return buildPinnedCaliberEvidenceFromRecord(session.record, session.state);
}

export function validateRequestPinnedCaliber(
  evidence: RequestPinnedCaliberEvidence | null | undefined
): { ok: true; evidence: RequestPinnedCaliberEvidence } | { ok: false; reason: typeof REASON_CALIBER_EVIDENCE_MISSING } {
  if (!evidence || typeof evidence !== "object") {
    return { ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING };
  }
  if (evidence.status === "none") return { ok: true, evidence };
  // begun_bound 残缺标记 → B-ASSEMBLE（不得当 none 放行）。
  if (evidence.status === "evidence_missing") {
    return { ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING };
  }
  if (evidence.status !== "activated_snapshot") {
    return { ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING };
  }
  const {
    bindingId,
    sessionGeneration,
    registryGeneration,
    digest,
    caliberSnapshot,
    boundKey
  } = evidence;
  if (
    typeof bindingId !== "string"
    || bindingId.trim().length === 0
    || typeof sessionGeneration !== "number"
    || !Number.isFinite(sessionGeneration)
    || typeof registryGeneration !== "number"
    || !Number.isFinite(registryGeneration)
    || typeof digest !== "string"
    || !/^[0-9a-f]{64}$/.test(digest)
    || !caliberSnapshot
    || !boundKey
  ) {
    return { ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING };
  }
  const expected = digestPinnedCaliberSnapshot({
    bindingId,
    boundKey,
    caliberSnapshot
  });
  if (expected !== digest) {
    return { ok: false, reason: REASON_CALIBER_EVIDENCE_MISSING };
  }
  return { ok: true, evidence };
}

export function caliberBindingRefFromPinned(
  evidence: RequestPinnedCaliberEvidence
): CaliberBindingRef {
  if (evidence.status !== "activated_snapshot") return { status: "none" };
  return {
    status: "activated_snapshot",
    bindingId: evidence.bindingId,
    sessionGeneration: evidence.sessionGeneration,
    registryGeneration: evidence.registryGeneration,
    digest: evidence.digest
  };
}

// ─── Caliber summary ─────────────────────────────────────────────────────────

const MAX_FILTER_ITEMS = 32;
const MAX_LIST_ITEMS = 64;

function trimNonEmptyStrings(values: unknown, omissions: OmissionsMap, omitKey: string): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const item of values) {
    if (out.length >= MAX_LIST_ITEMS) {
      omissions[omitKey] = true;
      omissions.maxItems = MAX_LIST_ITEMS;
      break;
    }
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed) out.push(trimmed);
      continue;
    }
    if (isPlainObject(item)) {
      const field = typeof item.field === "string" ? item.field.trim() : "";
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const expr = typeof item.expr === "string" ? item.expr.trim() : "";
      const picked = field || name || expr;
      if (picked) out.push(picked);
    }
  }
  return out;
}

function summarizeOrderBy(value: unknown): OrderBySummary[] {
  const raw = value === undefined
    ? []
    : Array.isArray(value)
      ? value
      : [value];
  const out: OrderBySummary[] = [];
  for (const item of raw) {
    if (out.length >= MAX_LIST_ITEMS) break;
    if (!isPlainObject(item)) continue;
    const field = typeof item.field === "string" ? item.field.trim() : "";
    if (!field) continue;
    const direction = item.direction === "asc" || item.direction === "desc" ? item.direction : undefined;
    out.push(direction ? { field, direction } : { field });
  }
  return out;
}

const STRING_OP_PATTERN =
  /(>=|<=|!=|<>|==|=|>|<|\blike\b|\bilike\b|\bin\b|\bbetween\b|\bcontains\b|\brlike\b|\bnot\s+in\b|\bis\s+null\b|\bis\s+not\s+null\b)/gi;

const FIELD_REF_PATTERN = /[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+/g;

export function summarizeUserFilterItem(value: unknown): UserFilterSummary | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const opsNormalized = [...trimmed.matchAll(STRING_OP_PATTERN)].map((m) =>
      m[0].replace(/\s+/g, " ").toLowerCase()
    );
    const fieldRefs = [...trimmed.matchAll(FIELD_REF_PATTERN)].map((m) => m[0]);
    return {
      form: "string",
      fieldRefs,
      opsNormalized,
      valueRedacted: true,
      valueLength: trimmed.length
    };
  }
  if (!isPlainObject(value)) return null;
  const field = typeof value.field === "string" ? value.field.trim() : "";
  const op = typeof value.op === "string" ? value.op.trim() : "";
  if (!field || !op) return null;
  let valueLength: number | undefined;
  if (typeof value.value === "string") valueLength = value.value.length;
  else if (Array.isArray(value.values)) valueLength = value.values.length;
  else if (value.value !== undefined && value.value !== null) {
    valueLength = String(value.value).length;
  }
  return {
    form: "structured",
    field,
    op,
    valueRedacted: true,
    ...(valueLength !== undefined ? { valueLength } : {})
  };
}

export function summarizeUserFilters(
  filters: unknown,
  omissions: OmissionsMap
): UserFilterSummary[] {
  if (filters === undefined || filters === null) return [];
  const items = Array.isArray(filters) ? filters : [filters];
  const out: UserFilterSummary[] = [];
  for (const item of items) {
    if (out.length >= MAX_FILTER_ITEMS) {
      omissions.filters_truncated = true;
      omissions.maxItems = MAX_FILTER_ITEMS;
      break;
    }
    const summary = summarizeUserFilterItem(item);
    if (summary) out.push(summary);
  }
  return out;
}

export function summarizeCaliber(input: {
  argsBeforeRewrite: Record<string, unknown>;
  systemConstraints: SystemConstraintSummary[];
  requestPinnedCaliber: RequestPinnedCaliberEvidence;
}): CaliberSummary {
  const omissions: OmissionsMap = {};
  const args = input.argsBeforeRewrite;
  const measures = trimNonEmptyStrings(args.measures, omissions, "measures_truncated");
  const dimensions = trimNonEmptyStrings(args.dimensions, omissions, "measures_truncated");
  const segments = trimNonEmptyStrings(args.segments, omissions, "measures_truncated");
  const orderBy = summarizeOrderBy(
    args.order_by !== undefined ? args.order_by : args.orderBy
  );
  const userFilters = summarizeUserFilters(args.filters, omissions);
  return {
    measures,
    dimensions,
    segments,
    orderBy,
    userFilters,
    systemConstraints: Array.isArray(input.systemConstraints) ? [...input.systemConstraints] : [],
    caliberBinding: caliberBindingRefFromPinned(input.requestPinnedCaliber),
    omissions
  };
}

export function buildDefaultCutoff(): CutoffDisclosure {
  return { status: "not_checked", note: CUTOFF_NOTE_NOT_CHECKED };
}

/**
 * 一次构造公开可核对块。调用方须已通过来源解析与 pin 证据校验。
 */
export function buildAnswerVerifiability(
  input: BuildAnswerVerifiabilityInput
): BuildOk | BuildFail {
  const pinned = validateRequestPinnedCaliber(input.requestPinnedCaliber);
  if (!pinned.ok) return { ok: false, reason: pinned.reason };
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    return { ok: false, reason: REASON_SOURCE_UNRESOLVED };
  }
  for (const source of input.sources) {
    if (
      !source
      || typeof source.connectionId !== "string"
      || !source.connectionId.trim()
      || typeof source.sourceName !== "string"
      || !source.sourceName.trim()
      || typeof source.table !== "string"
      || !source.table.trim()
    ) {
      return { ok: false, reason: REASON_SOURCE_UNRESOLVED };
    }
  }
  const caliber = summarizeCaliber({
    argsBeforeRewrite: input.argsBeforeRewrite,
    systemConstraints: input.systemConstraints,
    requestPinnedCaliber: pinned.evidence
  });
  return {
    ok: true,
    block: {
      schema_version: ANSWER_VERIFIABILITY_SCHEMA_VERSION,
      sources: input.sources.map((s) => ({ ...s })),
      caliber,
      cutoff: buildDefaultCutoff()
    }
  };
}

// ─── System constraints helper ───────────────────────────────────────────────

export function systemConstraintsFromForcedFilters(
  forcedFilters: unknown
): SystemConstraintSummary[] {
  if (forcedFilters === undefined || forcedFilters === null) return [];
  const items = Array.isArray(forcedFilters) ? forcedFilters : [forcedFilters];
  if (items.length === 0) return [];
  return [
    {
      kind: "row_policy",
      summary: `行权限注入 ${items.length} 条强制过滤（值已省略）`,
      omitted: true
    }
  ];
}

// ─── Lossless JSON object key injection ──────────────────────────────────────

/**
 * 在 JSON object 文本顶层插入键，保留既有数字字面量原文（不做 parse→stringify）。
 */
export function injectJsonObjectKeyPreservingLiterals(
  objectText: string,
  key: string,
  value: unknown
): { ok: true; text: string } | { ok: false; detail: string } {
  const trimmed = objectText.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { ok: false, detail: "content_text_not_json_object" };
  }
  if (objectHasTopLevelKey(trimmed, key)) {
    return { ok: false, detail: `key_conflict:${key}` };
  }
  let valueJson: string;
  try {
    valueJson = JSON.stringify(value);
  } catch (err) {
    return { ok: false, detail: `value_stringify_failed:${err instanceof Error ? err.message : String(err)}` };
  }
  const inner = trimmed.slice(1, -1).trim();
  const insertion = inner.length === 0
    ? `"${key}":${valueJson}`
    : `"${key}":${valueJson},${inner}`;
  return { ok: true, text: `{${insertion}}` };
}

function objectHasTopLevelKey(objectText: string, key: string): boolean {
  // 轻量扫描顶层键；失败时保守视为冲突由 JSON.parse 复核。
  try {
    const parsed = JSON.parse(objectText) as unknown;
    if (!isPlainObject(parsed)) return true;
    return Object.prototype.hasOwnProperty.call(parsed, key);
  } catch {
    return true;
  }
}

// ─── Wire fidelity ───────────────────────────────────────────────────────────

/** 提取 JSON 文本中的数字字面量（不含字符串内）。 */
export function extractNumberLiteralsFromJsonText(text: string): string[] {
  const literals: string[] = [];
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i += 1;
      while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i += 1;
      if (i < text.length && text[i] === ".") {
        i += 1;
        while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i += 1;
      }
      if (i < text.length && (text[i] === "e" || text[i] === "E")) {
        i += 1;
        if (i < text.length && (text[i] === "+" || text[i] === "-")) i += 1;
        while (i < text.length && text[i]! >= "0" && text[i]! <= "9") i += 1;
      }
      // 避免把 object key 的其它 token 误吞；要求数字前为分隔符。
      const prev = start === 0 ? "" : text[start - 1]!;
      if (start === 0 || /[\s:\[,{]/.test(prev)) {
        literals.push(text.slice(start, i));
      }
      continue;
    }
    i += 1;
  }
  return literals;
}

/**
 * 分别校验 text 载荷与 structuredContent 业务数字字面量（禁止 Number deepEqual 假绿）。
 */
export function wireFidelityCheck(input: {
  originalWire: string;
  finalWire: string;
  originalTextPayload?: string | null;
  finalTextPayload?: string | null;
  originalStructuredRaw?: string | null;
  finalStructuredRaw?: string | null;
}): { ok: true } | { ok: false; detail: string } {
  if (input.originalTextPayload != null && input.finalTextPayload != null) {
    const originalLiterals = extractNumberLiteralsFromJsonText(stripTopLevelKey(input.originalTextPayload, ANSWER_VERIFIABILITY_KEY));
    const finalWithoutAv = stripTopLevelKey(input.finalTextPayload, ANSWER_VERIFIABILITY_KEY);
    const finalLiterals = extractNumberLiteralsFromJsonText(finalWithoutAv);
    if (!sameLiteralMultiset(originalLiterals, finalLiterals)) {
      return { ok: false, detail: "text_number_literal_mismatch" };
    }
  }
  if (input.originalStructuredRaw != null && input.finalStructuredRaw != null) {
    const originalLiterals = extractNumberLiteralsFromJsonText(
      stripTopLevelKey(input.originalStructuredRaw, ANSWER_VERIFIABILITY_KEY)
    );
    const finalLiterals = extractNumberLiteralsFromJsonText(
      stripTopLevelKey(input.finalStructuredRaw, ANSWER_VERIFIABILITY_KEY)
    );
    if (!sameLiteralMultiset(originalLiterals, finalLiterals)) {
      return { ok: false, detail: "structured_number_literal_mismatch" };
    }
  }
  return { ok: true };
}

function sameLiteralMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const lit of a) counts.set(lit, (counts.get(lit) ?? 0) + 1);
  for (const lit of b) {
    const next = (counts.get(lit) ?? 0) - 1;
    if (next < 0) return false;
    counts.set(lit, next);
  }
  return true;
}

function stripTopLevelKey(objectText: string, key: string): string {
  try {
    const parsed = JSON.parse(objectText) as unknown;
    if (!isPlainObject(parsed) || !Object.prototype.hasOwnProperty.call(parsed, key)) {
      return objectText;
    }
    // 仅用于字面量对照：从原文删除该键的最短切片；失败则回落原文。
    const pattern = new RegExp(
      `,\\s*"${key}"\\s*:\\s*|\\s*"${key}"\\s*:\\s*`
    );
    if (!pattern.test(objectText)) return objectText;
  } catch {
    return objectText;
  }
  // 用「去掉键后的对象再取数字」会 Number 化；对照时改为：从 final 去掉 AV 键的
  // 注入前缀形式（我们的注入总是把新键放在最前）。
  const trimmed = objectText.trim();
  const prefix = `{"${key}":`;
  if (!trimmed.startsWith(prefix)) return objectText;
  // 找到 value 结束位置（括号匹配）。
  let i = prefix.length;
  const valueStart = i;
  const end = skipJsonValue(trimmed, valueStart);
  if (end < 0) return objectText;
  let rest = trimmed.slice(end).trimStart();
  if (rest.startsWith(",")) rest = rest.slice(1);
  return `{${rest}`;
}

function skipJsonValue(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i]!)) i += 1;
  if (i >= text.length) return -1;
  const ch = text[i]!;
  if (ch === "\"") {
    i += 1;
    let escape = false;
    while (i < text.length) {
      const c = text[i]!;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === "\"") {
        return i + 1;
      }
      i += 1;
    }
    return -1;
  }
  if (ch === "{" || ch === "[") {
    const open = ch;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;
    while (i < text.length) {
      const c = text[i]!;
      if (inString) {
        if (escape) escape = false;
        else if (c === "\\") escape = true;
        else if (c === "\"") inString = false;
        i += 1;
        continue;
      }
      if (c === "\"") {
        inString = true;
        i += 1;
        continue;
      }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    return -1;
  }
  // number / literal
  while (i < text.length && !/[\s,\}\]]/.test(text[i]!)) i += 1;
  return i;
}

// ─── Projection ──────────────────────────────────────────────────────────────

export type ProjectBlockInput = {
  /** 上游／分流原始 JSON-RPC envelope 字节（字符串）。 */
  originalWire: string;
  block: AnswerVerifiabilityBlock;
  /** Spec 162 `_meta.lucy` 字段（不含 answer_verifiability）。 */
  lucyMeta: Record<string, unknown>;
  requestId: string | number;
};

/**
 * 三载体投影 + 全链路保真（§5.3／§5.6）。成功路径禁止静默无块。
 */
export function projectBlockLossless(input: ProjectBlockInput): ProjectOk | ProjectFail {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(input.originalWire) as Record<string, unknown>;
  } catch (err) {
    return {
      ok: false,
      reason: REASON_ASSEMBLE_FAILED,
      detail: `outer_parse_failed:${err instanceof Error ? err.message : String(err)}`
    };
  }
  if (!isPlainObject(parsed) || parsed.error) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "not_result_envelope" };
  }
  const result = parsed.result;
  if (!isPlainObject(result)) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "missing_result" };
  }
  if (result.isError === true) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "is_error_result" };
  }

  const content = result.content;
  if (!Array.isArray(content) || content.length === 0 || !isPlainObject(content[0])) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "missing_content_text" };
  }
  const textEntry = content[0] as Record<string, unknown>;
  if (typeof textEntry.text !== "string") {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "content_text_not_string" };
  }
  const originalText = textEntry.text;

  const structured = result.structuredContent;
  const structuredIsObject = isPlainObject(structured);
  let block: AnswerVerifiabilityBlock = {
    ...input.block,
    sources: input.block.sources.map((s) => ({ ...s })),
    caliber: { ...input.block.caliber },
    cutoff: { ...input.block.cutoff }
  };
  if (!structuredIsObject) {
    block = {
      ...block,
      carriers: { structuredContent: "omitted_not_object" }
    };
  } else {
    if (Object.prototype.hasOwnProperty.call(structured, ANSWER_VERIFIABILITY_KEY)) {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "structured_key_conflict" };
    }
    block = {
      ...block,
      carriers: { structuredContent: "projected" }
    };
  }

  const textInject = injectJsonObjectKeyPreservingLiterals(
    originalText,
    ANSWER_VERIFIABILITY_KEY,
    block
  );
  if (!textInject.ok) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: textInject.detail };
  }

  const existingMeta = isPlainObject(result._meta) ? result._meta : {};
  if (
    isPlainObject(existingMeta.lucy)
    && Object.prototype.hasOwnProperty.call(existingMeta.lucy, ANSWER_VERIFIABILITY_KEY)
  ) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "meta_key_conflict" };
  }

  // 保护 Spec 162：合并既有 lucy 键，只新增 answer_verifiability。
  const mergedLucy: Record<string, unknown> = {
    ...input.lucyMeta,
    answer_verifiability: block
  };

  let structuredRawOriginal: string | null = null;
  let structuredRawFinal: string | null = null;
  let structuredForOutput: unknown = structured;

  if (structuredIsObject) {
    // D9／§5.6：必须从 originalWire 按原始 token 抽取；禁止 JSON.stringify(parsed)
    // 回落（会把 >MAX_SAFE_INTEGER／超长小数 Number 化后写回）。
    structuredRawOriginal = extractTopLevelMemberRaw(input.originalWire, [
      "result",
      "structuredContent"
    ]);
    if (structuredRawOriginal == null) {
      return {
        ok: false,
        reason: REASON_ASSEMBLE_FAILED,
        detail: "structured_raw_extract_failed"
      };
    }
    const scInject = injectJsonObjectKeyPreservingLiterals(
      structuredRawOriginal,
      ANSWER_VERIFIABILITY_KEY,
      block
    );
    if (!scInject.ok) {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: scInject.detail };
    }
    structuredRawFinal = scInject.text;
    structuredForOutput = STRUCTURED_CONTENT_PLACEHOLDER;
  }

  const outEnvelope: Record<string, unknown> = {
    ...parsed,
    jsonrpc: typeof parsed.jsonrpc === "string" ? parsed.jsonrpc : "2.0",
    id: parsed.id ?? input.requestId,
    result: {
      ...result,
      content: [{ ...textEntry, text: textInject.text }],
      ...(structuredIsObject ? { structuredContent: structuredForOutput } : {}),
      _meta: {
        ...existingMeta,
        lucy: mergedLucy
      }
    }
  };

  let finalWire = JSON.stringify(outEnvelope);
  if (structuredIsObject && structuredRawFinal) {
    const placeholderToken = JSON.stringify(STRUCTURED_CONTENT_PLACEHOLDER);
    if (!finalWire.includes(placeholderToken)) {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "structured_placeholder_missing" };
    }
    finalWire = finalWire.replace(placeholderToken, structuredRawFinal);
  }

  const fidelity = wireFidelityCheck({
    originalWire: input.originalWire,
    finalWire,
    originalTextPayload: originalText,
    finalTextPayload: textInject.text,
    originalStructuredRaw: structuredRawOriginal,
    finalStructuredRaw: structuredRawFinal
  });
  if (!fidelity.ok) {
    return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: fidelity.detail };
  }

  // 三载体一致性（SC-06b）：text 与 meta 深等；structured 对象时三处深等。
  try {
    const finalParsed = JSON.parse(finalWire) as Record<string, unknown>;
    const finalResult = finalParsed.result as Record<string, unknown>;
    const finalText = (finalResult.content as Array<Record<string, unknown>>)[0]?.text;
    if (typeof finalText !== "string") {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "final_text_missing" };
    }
    const textObj = JSON.parse(finalText) as Record<string, unknown>;
    const textBlock = textObj[ANSWER_VERIFIABILITY_KEY];
    const metaBlock = (finalResult._meta as Record<string, unknown>)?.lucy as Record<string, unknown> | undefined;
    if (!metaBlock || !deepEqualJson(textBlock, metaBlock[ANSWER_VERIFIABILITY_KEY])) {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "carrier_text_meta_mismatch" };
    }
    if (structuredIsObject) {
      const scObj = finalResult.structuredContent as Record<string, unknown>;
      if (!deepEqualJson(textBlock, scObj[ANSWER_VERIFIABILITY_KEY])) {
        return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "carrier_structured_mismatch" };
      }
    }
    // Spec 162 保护：既有键仍在
    for (const key of ["contract", "tool", "provenance"] as const) {
      if (input.lucyMeta[key] !== undefined && metaBlock[key] === undefined) {
        return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: `spec162_missing:${key}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: REASON_ASSEMBLE_FAILED,
      detail: `final_validate_failed:${err instanceof Error ? err.message : String(err)}`
    };
  }

  return { ok: true, finalWire, block };
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 从 JSON 文本中按路径提取成员值的**原始子串**（保留数字字面量）。
 * 用于 structuredContent／text 保真；失败返回 null（调用方须 B-ASSEMBLE，不得 Number 化回落）。
 *
 * 路径每一段都是对象键。进入下一层前会把 text 收窄到上一层值的原文。
 */
export function extractTopLevelMemberRaw(wire: string, path: string[]): string | null {
  if (path.length === 0) return null;
  let text = wire;
  for (let depth = 0; depth < path.length; depth += 1) {
    const member = findObjectMemberValueRange(text, path[depth]!);
    if (!member) return null;
    if (depth === path.length - 1) {
      return text.slice(member.valueStart, member.valueEnd);
    }
    // 进入下一层：仅保留该成员值原文，再在其中找下一键
    text = text.slice(member.valueStart, member.valueEnd);
  }
  return null;
}

/**
 * 在一个 JSON object 文本（可含前导空白）中定位 `key` 对应值的 [start, end) 原文范围。
 * 仅匹配当前对象层（depth===1）的键，忽略嵌套对象／数组／字符串内同名片段。
 */
function findObjectMemberValueRange(
  objectText: string,
  key: string
): { valueStart: number; valueEnd: number } | null {
  let i = 0;
  while (i < objectText.length && /\s/.test(objectText[i]!)) i += 1;
  if (objectText[i] !== "{") return null;
  i += 1; // 进入对象；此后 depth===1 表示当前对象顶层

  const keyPattern = `"${key}"`;
  let depth = 1;
  let inString = false;
  let escape = false;

  while (i < objectText.length) {
    const ch = objectText[i]!;
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      i += 1;
      continue;
    }
    if (ch === "\"") {
      if (depth === 1 && objectText.startsWith(keyPattern, i)) {
        let j = i + keyPattern.length;
        while (j < objectText.length && /\s/.test(objectText[j]!)) j += 1;
        if (objectText[j] === ":") {
          let valueStart = j + 1;
          while (valueStart < objectText.length && /\s/.test(objectText[valueStart]!)) {
            valueStart += 1;
          }
          const valueEnd = skipJsonValue(objectText, valueStart);
          if (valueEnd < 0) return null;
          return { valueStart, valueEnd };
        }
      }
      inString = true;
      i += 1;
      continue;
    }
    if (ch === "{" || ch === "[") {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return null; // 本对象扫完未命中
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * 从缓冲 SSE body 提取与 requestId 匹配的 JSON-RPC 响应原始 data 行载荷。
 */
export function extractSseJsonRpcResponseRaw(
  body: string,
  requestId?: string | number
): string | undefined {
  const frames: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    frames.push(line.slice("data: ".length));
  }
  const matched: string[] = [];
  for (const frame of frames) {
    try {
      const msg = JSON.parse(frame) as Record<string, unknown>;
      if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
      if (!("id" in msg) || (!("result" in msg) && !("error" in msg))) continue;
      if (requestId !== undefined && msg.id !== requestId) continue;
      matched.push(frame);
    } catch {
      // skip
    }
  }
  if (matched.length > 0) return matched[matched.length - 1];
  return frames.length > 0 ? frames[frames.length - 1] : undefined;
}

export function deepCopyJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 从已由 Spec 162／018 富化的信封提取须在 AV 错误信封中保留的字段。
 * P0-5 共存：AV fail-closed 不得抹掉已写入的 next_step／next_step_skipped_reason。
 */
export function extractLucy018PreserveFields(enriched: unknown): {
  next_step?: unknown;
  next_step_skipped_reason?: string;
} | undefined {
  if (!isPlainObject(enriched) || !isPlainObject(enriched.result)) return undefined;
  const meta = isPlainObject(enriched.result._meta) ? enriched.result._meta : undefined;
  if (!meta) return undefined;
  const lucy = isPlainObject(meta.lucy) ? meta.lucy : undefined;
  if (!lucy) return undefined;
  const out: { next_step?: unknown; next_step_skipped_reason?: string } = {};
  if (Object.prototype.hasOwnProperty.call(lucy, "next_step")) {
    out.next_step = lucy.next_step;
  }
  if (typeof lucy.next_step_skipped_reason === "string") {
    out.next_step_skipped_reason = lucy.next_step_skipped_reason;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 装配失败 → MCP tools/call error result（B-ASSEMBLE／B-RESOLVE）。
 * 可选保留 P0-5 已写入的 `_meta.lucy.next_step`／`next_step_skipped_reason`。
 */
export function buildAnswerVerifiabilityErrorEnvelope(input: {
  requestId: string | number;
  reason: string;
  detail?: string;
  lucy018?: {
    next_step?: unknown;
    next_step_skipped_reason?: string;
  };
}): string {
  const payload: Record<string, unknown> = {
    reason: input.reason,
    ...(input.detail ? { assemble_error: input.detail } : {})
  };
  const lucy018 = input.lucy018;
  const lucyMeta: Record<string, unknown> = {};
  if (lucy018 && Object.prototype.hasOwnProperty.call(lucy018, "next_step")) {
    lucyMeta.next_step = lucy018.next_step;
  }
  if (lucy018 && typeof lucy018.next_step_skipped_reason === "string") {
    lucyMeta.next_step_skipped_reason = lucy018.next_step_skipped_reason;
  }
  const result: Record<string, unknown> = {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
  if (Object.keys(lucyMeta).length > 0) {
    result._meta = { lucy: lucyMeta };
  }
  return JSON.stringify({
    jsonrpc: "2.0",
    id: input.requestId,
    result
  });
}

/** Instructions 条款（动态数组与 fallback md 共用语义）。 */
export const ANSWER_VERIFIABILITY_INSTRUCTION_LINES = [
  "- When a successful `lucy_query` tool result includes `answer_verifiability`, you MUST surface its source identity, caliber highlights, and data-cutoff disclosure in the user-visible answer (cite or restate the block).",
  "- Do not hide, omit, or strip `answer_verifiability`. Treat cutoff.status `not_checked` as honest disclosure that the business data cutoff was not verified—never invent a checked cutoff.",
  "- Having the block in the tool result does not by itself mean the host UI rendered it; you still must include the verifiability points in your reply to the user."
] as const;

/**
 * 在已由 Spec 162／018（next_step）富化的信封之上，按**原始 wire**投影可核对块。
 * 保留 P0-5 注入的 `next_step`（若存在），不回滚 upstreamHttpStatus 判定结果。
 */
export function applyAnswerVerifiabilityToLucyQuery(input: {
  originalEnvelopeWire: string;
  enrichedEnvelope: unknown;
  requestId: string | number;
  sourceRefs: SourceRef[];
  argsBeforeRewrite: Record<string, unknown>;
  requestPinnedCaliber: RequestPinnedCaliberEvidence;
  systemConstraints?: SystemConstraintSummary[];
}): ProjectOk | BuildFail | ProjectFail {
  const pinned = validateRequestPinnedCaliber(input.requestPinnedCaliber);
  if (!pinned.ok) return { ok: false, reason: pinned.reason };

  const sources = resolveAuthoritativeSourceIdentities(input.sourceRefs);
  if (!sources.ok) return { ok: false, reason: sources.reason };

  const built = buildAnswerVerifiability({
    sources: sources.items,
    argsBeforeRewrite: input.argsBeforeRewrite,
    systemConstraints: input.systemConstraints ?? [],
    requestPinnedCaliber: pinned.evidence
  });
  if (!built.ok) return built;

  const enriched = input.enrichedEnvelope;
  let lucyMeta: Record<string, unknown> = {};
  let nextStep: unknown;
  if (isPlainObject(enriched) && isPlainObject(enriched.result)) {
    const meta = isPlainObject(enriched.result._meta) ? enriched.result._meta : {};
    const lucy = isPlainObject(meta.lucy) ? meta.lucy : {};
    const { answer_verifiability: _ignored, ...rest } = lucy;
    lucyMeta = rest;
    nextStep = lucy.next_step;
  }

  const projected = projectBlockLossless({
    originalWire: input.originalEnvelopeWire,
    block: built.block,
    lucyMeta,
    requestId: input.requestId
  });
  if (!projected.ok) return projected;

  if (nextStep === undefined) return projected;

  // 018 共存：把已判定的 next_step 再无损写入三载体（若尚未存在）。
  try {
    const parsed = JSON.parse(projected.finalWire) as Record<string, unknown>;
    const result = parsed.result as Record<string, unknown>;
    const content0 = Array.isArray(result.content) ? result.content[0] as Record<string, unknown> : null;
    if (!content0 || typeof content0.text !== "string") {
      return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "next_step_merge_missing_text" };
    }
    let text = content0.text;
    const textObj = JSON.parse(text) as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(textObj, "next_step")) {
      const injected = injectJsonObjectKeyPreservingLiterals(text, "next_step", nextStep);
      if (!injected.ok) {
        return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: injected.detail };
      }
      text = injected.text;
      content0.text = text;
    }
    // D9：structuredContent 一律从 projected.finalWire 抽原文再写回；
    // 禁止 JSON.stringify(parsed.structuredContent)（会 Number 损坏）。
    let structuredRawForWrite: string | null = null;
    if (isPlainObject(result.structuredContent)) {
      const raw = extractTopLevelMemberRaw(projected.finalWire, [
        "result",
        "structuredContent"
      ]);
      if (raw == null) {
        return {
          ok: false,
          reason: REASON_ASSEMBLE_FAILED,
          detail: "structured_raw_extract_failed"
        };
      }
      if (!Object.prototype.hasOwnProperty.call(result.structuredContent, "next_step")) {
        const scInject = injectJsonObjectKeyPreservingLiterals(raw, "next_step", nextStep);
        if (!scInject.ok) {
          return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: scInject.detail };
        }
        structuredRawForWrite = scInject.text;
      } else {
        structuredRawForWrite = raw;
      }
      result.structuredContent = STRUCTURED_CONTENT_PLACEHOLDER;
    }

    const meta = isPlainObject(result._meta) ? result._meta : {};
    const lucy = isPlainObject(meta.lucy) ? meta.lucy : {};
    if (!Object.prototype.hasOwnProperty.call(lucy, "next_step")) {
      lucy.next_step = nextStep;
    }
    result._meta = { ...meta, lucy };
    result.content = [content0];
    let wire = JSON.stringify({ ...parsed, result });
    if (structuredRawForWrite != null) {
      const placeholderToken = JSON.stringify(STRUCTURED_CONTENT_PLACEHOLDER);
      if (!wire.includes(placeholderToken)) {
        return { ok: false, reason: REASON_ASSEMBLE_FAILED, detail: "structured_placeholder_missing" };
      }
      wire = wire.replace(placeholderToken, structuredRawForWrite);
    }
    return { ok: true, finalWire: wire, block: projected.block };
  } catch (err) {
    return {
      ok: false,
      reason: REASON_ASSEMBLE_FAILED,
      detail: `next_step_merge_failed:${err instanceof Error ? err.message : String(err)}`
    };
  }
}
