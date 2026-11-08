/**
 * P0-1 问题类型口径绑定 —— 匹配、门禁与拒绝文案。
 *
 * 权威合同：docs/specs/lucy-20261107-question-type-caliber-binding-spec.md v0.9
 * （D3–D12、§4.1 O1、§4.2 O2、§6 伪代码、SC-01–SC-30）。
 *
 * 三块职责：
 * 1. **激活**（O2 触发匹配）—— `lucy_begin_question` 的准备阶段；
 * 2. **门禁**（D6／D7／D12）—— `lucy_query`／`lucy_explain_query` 的**注入前**闸；
 * 3. **拒绝文案**（D10／SC-13）—— 中文主称＋按当前 ACL 裁剪的回显。
 *
 * 与 ACL／行权限正交：闸序＝**ACL → 口径 → 行权限注入**。口径绑定**不得**授予
 * 越权表，也**不得**把语义裁判塞进 ACL。
 */

import {
  DATA_PLANE_TOOLS,
  canonicalSourceKeyDisplay,
  canonicalSourceKeyEquals,
  collectCanonicalSourceKeys,
  effectivePermissions,
  type CanonicalSourceKey
} from "./acl.js";
import type { Identity } from "./identity.js";
import {
  normalizeCaliberFieldKey,
  normalizeCaliberFieldKeyForSource,
  normalizeCaliberText
} from "./caliber-binding-text.js";
import {
  caliberBindingRegistryStatus,
  currentCaliberBindingRegistry,
  recoverCaliberBindingRegistry,
  type CaliberBindingAsset,
  type CaliberBindingRegistry
} from "./caliber-binding-registry.js";
import {
  bindingScopeKey,
  readBindingSession,
  type BindingSessionState,
  type BoundCaliber
} from "./caliber-binding-session.js";

export { bindingScopeKey, deepCopyCaliber } from "./caliber-binding-session.js";
export {
  withCaliberBindingRegistryExclusion,
  withCaliberBindingScopeLock
} from "./caliber-binding-lock.js";
export { normalizeCaliberText, validateCaliberTrigger } from "./caliber-binding-text.js";

// ─── 拒绝码与中文主称 ────────────────────────────────────────────────────────

export const CALIBER_BINDING_VIOLATION = "caliber_binding_violation" as const;
export const CALIBER_BINDING_UNRESOLVED = "caliber_binding_unresolved" as const;
export const CALIBER_BINDING_AMBIGUOUS = "caliber_binding_ambiguous" as const;
export const CALIBER_INVALID_OR_INVISIBLE_BINDING = "invalid_or_invisible_binding" as const;

export type CaliberBindingDenialCode =
  | typeof CALIBER_BINDING_VIOLATION
  | typeof CALIBER_BINDING_UNRESOLVED
  | typeof CALIBER_BINDING_AMBIGUOUS
  | typeof CALIBER_INVALID_OR_INVISIBLE_BINDING;

/** 中文主称（SC-13：拒绝文案用中文主称）。 */
const DENIAL_LABEL: Record<CaliberBindingDenialCode, string> = {
  [CALIBER_BINDING_VIOLATION]: "偏离固定口径",
  [CALIBER_BINDING_UNRESOLVED]: "口径绑定无法解析",
  [CALIBER_BINDING_AMBIGUOUS]: "口径绑定不唯一",
  [CALIBER_INVALID_OR_INVISIBLE_BINDING]: "口径绑定不可见或不存在"
};

export type CaliberViolationDimension =
  | "source"
  | "unresolvable_reference"
  | "extra_parameter"
  | "measures"
  | "dimensions"
  | "segments"
  | "filters"
  | "require_measures";

export interface CaliberBindingDenial {
  code: CaliberBindingDenialCode;
  /** 中文主称。 */
  label: string;
  /** 面向 Agent 的结构化载荷；**已按当前 ACL 裁剪**（D10）。 */
  payload: {
    reason: string;
    failureDimension: string;
    /** 违规维度（仅 violation）。 */
    dimension?: CaliberViolationDimension;
    /** 命中绑定 id（仅在调用者对该源可见时回显）。 */
    bindingId?: string;
    /** 歧义候选的绑定 id 列表（只含可见候选）。 */
    candidateBindingIds?: string[];
    /** 允许集（仅在调用者对该源可见时回显）。 */
    allowed?: string[];
    /** 触发该拒绝的请求键（仅 violation 的 extra_parameter）。 */
    offendingKey?: string;
  };
  /** 面向用户的完整文案。 */
  text: string;
}

function denial(
  code: CaliberBindingDenialCode,
  detail: string,
  extra: Partial<CaliberBindingDenial["payload"]> = {}
): CaliberBindingDenial {
  const payload: CaliberBindingDenial["payload"] = {
    reason: code,
    failureDimension: "口径绑定",
    ...extra
  };
  return {
    code,
    label: DENIAL_LABEL[code],
    payload,
    text: `Access denied: ${code}（${DENIAL_LABEL[code]}）${detail ? `：${detail}` : ""}`
  };
}

// ─── D12 —— 额外参数 fail-closed ─────────────────────────────────────────────

/**
 * D12 —— 明确列出的旁路键族。出现即 violation，**不做**逐字段映射。
 */
export const CALIBER_FORBIDDEN_EXTRA_KEYS: readonly string[] = [
  "where",
  "having",
  "groupBy",
  "group_by",
  "joins",
  "join",
  "sort",
  "sorts"
];

/**
 * D7 ② —— 请求侧**来源别名**键集。
 *
 * 与 ACL 对 `lucy_query`／`lucy_explain_query` 的采集键集**同源**：`acl.ts`
 * 的 `extractTables` 读 `sourceName`｜`source_name`｜`source`｜`table`，代理
 * 自身的入参校验（`mcp-proxy.ts` `validateLucyToolArgs`）用的是同一组别名。
 *
 * 这些键**不是**旁路键：D7② 要求把它们纳入请求侧源键采集，再与 `boundKey`
 * 比较（见 `resolveRequestedSourceAlias`）。
 *
 * `tableName`／`table_name` 是同族的 camel／snake 变体。ACL 自身**不读**它们，
 * 但既然进了 D12 允许集，就必须由本条**显式校验**——否则它们会成为无人检查的
 * 顶层键，也就是新的旁路口子。
 */
export const CALIBER_SOURCE_ALIAS_KEYS: readonly string[] = [
  "sourceName",
  "source_name",
  "source",
  "table",
  "tableName",
  "table_name"
];

/**
 * D12 —— 工具契约主路径已列、且本条显式校验的键。
 *
 * 其余任何顶层键（连同 D12 禁键）一律 violation（首期 fail-closed）。
 */
export const CALIBER_ALLOWED_REQUEST_KEYS: readonly string[] = [
  "connectionId",
  "connection_id",
  "connection",
  "database",
  ...CALIBER_SOURCE_ALIAS_KEYS,
  "measures",
  "dimensions",
  "filters",
  "segments",
  "order_by",
  "orderBy",
  "limit"
];

/** 返回第一个不允许出现的顶层键；没有则 null。 */
export function findForbiddenExtraKey(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (CALIBER_FORBIDDEN_EXTRA_KEYS.includes(key)) return key;
    if (!CALIBER_ALLOWED_REQUEST_KEYS.includes(key)) return key;
  }
  return null;
}

// ─── D7 ② —— 请求侧来源别名 ──────────────────────────────────────────────────

/** 请求里出现的来源别名键。 */
export interface RequestedSourceAlias {
  /** 请求里的顶层键名（`sourceName`／`table` 等）。 */
  key: string;
  /** 别名取值；`malformed` 为 true 时为空串。 */
  value: string;
  /** 取值不是非空字符串 —— 视为不可解析引用（fail-closed）。 */
  malformed: boolean;
}

/**
 * D7 ② —— 采集请求里的来源别名键及其取值。
 *
 * 只看**顶层**键（与 D12 的判定面一致）；`measures`／`filters` 里的字段引用
 * 不走这里（那些由 D7⑤ 的允许集比较负责）。
 */
export function collectRequestedSourceAliases(args: Record<string, unknown>): RequestedSourceAlias[] {
  const found: RequestedSourceAlias[] = [];
  for (const key of CALIBER_SOURCE_ALIAS_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) {
      found.push({ key, value, malformed: false });
    } else {
      found.push({ key, value: "", malformed: true });
    }
  }
  return found;
}

/** 连接别名键（与 ACL `firstString` 的候选顺序一致）。 */
const CALIBER_CONNECTION_KEYS: readonly string[] = [
  "connectionId",
  "connection_id",
  "connection",
  "database"
];

/**
 * D7 ② —— 用 **ACL 同一条解析路径** 解析请求侧的来源别名取值。
 *
 * 走 `collectCanonicalSourceKeys`（复用 ACL 的 `extractTables` ＋ **同一份**已
 * 提交 sourceMap），不在本模块另写前缀拼接。合成入参只带连接键与该别名取值，
 * 因此解析结果就是「这个别名指向哪个规范源键」——与 D7② 的采集口径同源。
 */
async function resolveRequestedSourceAlias(
  toolName: string,
  args: Record<string, unknown>,
  value: string
): Promise<{ ok: true; key: CanonicalSourceKey } | { ok: false }> {
  const synthetic: Record<string, unknown> = {};
  for (const key of CALIBER_CONNECTION_KEYS) {
    const raw = args[key];
    if (typeof raw === "string" && raw.trim()) synthetic[key] = raw;
  }
  synthetic.sourceName = value;
  const collected = await collectCanonicalSourceKeys(toolName, synthetic);
  if (collected.unresolved.length > 0) return { ok: false };
  if (collected.keys.length !== 1) return { ok: false };
  return { ok: true, key: collected.keys[0]! };
}

// ─── 请求侧口径字段提取 ──────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * D7 ④ —— measure 必须是字符串。`{expr,name}` 形式的聚合表达式一律 violation
 * （口径绑定不允许 Agent 自行加工度量）。
 */
export function requestedMeasureKeys(
  args: Record<string, unknown>,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const normalize = (value: string) => boundKey
    ? normalizeCaliberFieldKeyForSource(value, boundKey)
    : normalizeCaliberFieldKey(value);
  const raw = args.measures;
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "measures_not_array" };
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim().length === 0) return { ok: false, reason: "measure_empty" };
      keys.push(normalize(item));
      continue;
    }
    const record = asRecord(item);
    if (!record) return { ok: false, reason: "measure_not_string" };
    if (typeof record.expr === "string" && record.expr.trim().length > 0) {
      // `{expr,name}` 度量 —— 自行加工的口径，violation。
      return { ok: false, reason: "measure_expr_not_allowed" };
    }
    if (typeof record.name === "string" && record.name.trim().length > 0) {
      keys.push(normalize(record.name));
      continue;
    }
    return { ok: false, reason: "measure_not_string" };
  }
  return { ok: true, keys };
}

/** `dimensions[].field`。 */
export function requestedDimensionKeys(
  args: Record<string, unknown>,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const normalize = (value: string) => boundKey
    ? normalizeCaliberFieldKeyForSource(value, boundKey)
    : normalizeCaliberFieldKey(value);
  const raw = args.dimensions;
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "dimensions_not_array" };
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim().length === 0) return { ok: false, reason: "dimension_empty" };
      keys.push(normalize(item));
      continue;
    }
    const record = asRecord(item);
    const field = record && typeof record.field === "string" ? record.field : null;
    if (!field || field.trim().length === 0) return { ok: false, reason: "dimension_field_missing" };
    keys.push(normalize(field));
  }
  return { ok: true, keys };
}

/** `segments[]`。 */
export function requestedSegmentKeys(
  args: Record<string, unknown>,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const normalize = (value: string) => boundKey
    ? normalizeCaliberFieldKeyForSource(value, boundKey)
    : normalizeCaliberFieldKey(value);
  const raw = args.segments;
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "segments_not_array" };
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return { ok: false, reason: "segment_not_string" };
    }
    keys.push(normalize(item));
  }
  return { ok: true, keys };
}

/** `order_by[]`／`orderBy[]` 的 `field`。 */
export function requestedOrderByKeys(
  args: Record<string, unknown>,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const normalize = (value: string) => boundKey
    ? normalizeCaliberFieldKeyForSource(value, boundKey)
    : normalizeCaliberFieldKey(value);
  const raw = args.order_by ?? args.orderBy;
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  if (!Array.isArray(raw)) return { ok: false, reason: "order_by_not_array" };
  const keys: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim().length === 0) return { ok: false, reason: "order_by_empty" };
      keys.push(normalize(item));
      continue;
    }
    const record = asRecord(item);
    const field = record && typeof record.field === "string" ? record.field : null;
    if (!field || field.trim().length === 0) return { ok: false, reason: "order_by_field_missing" };
    keys.push(normalize(field));
  }
  return { ok: true, keys };
}

/**
 * 字符串 filter 的字段提取。
 *
 * 只接受「左操作数是限定字段键」的形式（`source.field`、`source.field = 'x'`）。
 * 其余（计算表达式、无法定位字段的文本）→ **不可解析** → violation（D7 ④）。
 */
export function parseFilterStringField(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^([A-Za-z_][\w]*\.[A-Za-z_][\w]*)\s*(=|<>|!=|>=|<=|>|<|\bnot\s+in\b|\bin\b|\blike\b)?/i);
  if (!match) return null;
  const rest = trimmed.slice(match[0].length).trim();
  if (rest.length > 0 && !match[2]) return null;
  return match[1];
}

/**
 * D7 ⑥ —— `filters` 的字段集合（**只**取 Agent 原始入参；行权限注入在闸之后，
 * 因此行权限谓词不参与本检查）。
 */
export function requestedFilterFields(
  args: Record<string, unknown>,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const raw = args.filters;
  if (raw === undefined || raw === null) return { ok: true, keys: [] };
  return collectFilterFields(raw, boundKey);
}

function collectFilterFields(
  value: unknown,
  boundKey?: CanonicalSourceKey
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  const normalize = (key: string) => boundKey
    ? normalizeCaliberFieldKeyForSource(key, boundKey)
    : normalizeCaliberFieldKey(key);
  if (typeof value === "string") {
    const field = parseFilterStringField(value);
    if (!field) return { ok: false, reason: "filter_unparseable" };
    return { ok: true, keys: [normalize(field)] };
  }
  if (Array.isArray(value)) {
    const keys: string[] = [];
    for (const item of value) {
      const nested = collectFilterFields(item);
      if (!nested.ok) return nested;
      keys.push(...nested.keys);
    }
    return { ok: true, keys };
  }
  const record = asRecord(value);
  if (!record) return { ok: false, reason: "filter_unparseable" };
  const field = typeof record.field === "string" ? record.field : null;
  if (!field || field.trim().length === 0) return { ok: false, reason: "filter_field_missing" };
  return { ok: true, keys: [normalize(field)] };
}

// ─── 可见性 ──────────────────────────────────────────────────────────────────

/**
 * 当前 ACL 下调用者可见的数据面源键集合。
 *
 * 可见性按**当前** ACL 判定（D10）：不可见的绑定不得回显 source／允许集。
 */
export async function visibleCanonicalKeys(identity: Identity): Promise<Set<string>> {
  const resolved = await effectivePermissions(identity);
  const keys = new Set<string>();
  if (!resolved.ok) return keys;
  for (const capability of resolved.permissions.capabilities) {
    if (!DATA_PLANE_TOOLS.includes(capability.tool as (typeof DATA_PLANE_TOOLS)[number])) continue;
    keys.add(canonicalSourceKeyDisplay({
      connectionId: capability.connectionId,
      schema: capability.schema,
      sourceName: capability.sourceName,
      physicalTable: capability.physicalTable
    }));
  }
  return keys;
}

function isVisible(visible: Set<string>, key: CanonicalSourceKey): boolean {
  return visible.has(canonicalSourceKeyDisplay(key));
}

// ─── O2 —— 触发匹配 ──────────────────────────────────────────────────────────

/**
 * O2 §4.2③ —— **分别**匹配两个字段，禁止先拼接再匹配。
 *
 * `N(intentSummary).includes(t) OR N(question ?? "").includes(t)`
 */
export function bindingMatchesText(
  binding: CaliberBindingAsset,
  intentSummary: string,
  question?: string
): boolean {
  const normalizedIntent = normalizeCaliberText(intentSummary ?? "");
  const normalizedQuestion = normalizeCaliberText(question ?? "");
  return binding.normalizedTriggers.some(
    (trigger) => normalizedIntent.includes(trigger) || normalizedQuestion.includes(trigger)
  );
}

// ─── 激活（begin 准备阶段） ──────────────────────────────────────────────────

export interface CaliberBindingActivation {
  kind: "chosen" | "none";
  binding: CaliberBindingAsset | null;
  /** begin 准备阶段记录的注册表代次（O1 §4.1⑤）。 */
  registryGeneration: number;
}

export type ActivationOutcome =
  | { ok: true; activation: CaliberBindingActivation }
  | { ok: false; denial: CaliberBindingDenial };

/**
 * O2 §4.2⑤／D4 —— 命中计数。
 *
 * 仅扫描 published 且通过加载校验的绑定的 `triggers`（**不**扫 title／bindingId／
 * 描述）。先命中 → 再按当前 ACL 排除不可见 → 按 `bindingId` 去重后计数。
 */
export function matchTriggerCandidates(
  bindings: Iterable<CaliberBindingAsset>,
  intentSummary: string,
  question: string | undefined,
  visible: Set<string>
): CaliberBindingAsset[] {
  const matched: CaliberBindingAsset[] = [];
  const seen = new Set<string>();
  for (const binding of bindings) {
    if (binding.status !== "published") continue;
    if (!bindingMatchesText(binding, intentSummary, question)) continue;
    if (!isVisible(visible, binding.boundKey)) continue;
    if (seen.has(binding.bindingId)) continue;
    seen.add(binding.bindingId);
    matched.push(binding);
  }
  return matched;
}

/**
 * 注册表就绪检查。
 *
 * 正常部署在监听端口前已做过启动恢复（`index.ts`）；独立启动 Proxy 的形态下
 * 这里补一次恢复。恢复不可用（凭据缺失／只有 prepared／内容漂移／有候选但
 * 无提交证据）→ 注册表不可用 → 新 begin 一律 `caliber_binding_unresolved`
 * （O1 §4.1③：不得转换为「空注册表放行」）。
 */
async function ensureRegistryReady(): Promise<CaliberBindingRegistry | null> {
  const current = currentCaliberBindingRegistry();
  if (current) return current;
  const recovered = await recoverCaliberBindingRegistry();
  if (!recovered.usable) return null;
  return currentCaliberBindingRegistry();
}

/**
 * D4 —— 激活判定。
 *
 * ① 显式 `caliberBindingId` 优先；② 否则触发匹配，**恰好一条**才激活。
 * ≥2 条 → `caliber_binding_ambiguous`（只回可见候选；不按最长词／词频／顺序择一）。
 */
export async function prepareCaliberBindingActivation(input: {
  identity: Identity;
  intentSummary: string;
  question?: string;
  explicitBindingId?: string;
}): Promise<ActivationOutcome> {
  const registry = await ensureRegistryReady();
  if (!registry) {
    return {
      ok: false,
      denial: denial(CALIBER_BINDING_UNRESOLVED, "绑定注册表不可用")
    };
  }
  // 同步未决／凭据只有 prepared／内容漂移 → 注册表**不可用**。此时新 begin 必须
  // 返回 `caliber_binding_unresolved`，**不得**用旧注册表给新旅程匹配
  // （O1 §4.1③）。
  const status = caliberBindingRegistryStatus();
  if (!status.usable) {
    return {
      ok: false,
      denial: denial(CALIBER_BINDING_UNRESOLVED, "绑定注册表不可用")
    };
  }
  const visible = await visibleCanonicalKeys(input.identity);
  const explicitId = input.explicitBindingId?.trim();

  if (explicitId) {
    // 显式 id 优先；**不回退**触发匹配。
    const binding = registry.bindings.get(explicitId);
    if (!binding || !isVisible(visible, binding.boundKey)) {
      return {
        ok: false,
        denial: denial(CALIBER_INVALID_OR_INVISIBLE_BINDING, "指定的绑定不存在或当前身份不可见")
      };
    }
    return {
      ok: true,
      activation: { kind: "chosen", binding, registryGeneration: registry.generation }
    };
  }

  const hits = matchTriggerCandidates(
    registry.bindings.values(),
    input.intentSummary,
    input.question,
    visible
  );
  if (hits.length >= 2) {
    return {
      ok: false,
      denial: denial(CALIBER_BINDING_AMBIGUOUS, "命中多条绑定，需显式指定", {
        candidateBindingIds: hits.map((hit) => hit.bindingId)
      })
    };
  }
  if (hits.length === 1) {
    return {
      ok: true,
      activation: { kind: "chosen", binding: hits[0]!, registryGeneration: registry.generation }
    };
  }
  // 真零命中 → `begun_no_hit`；本条不改变任何查数行为。
  return {
    ok: true,
    activation: { kind: "none", binding: null, registryGeneration: registry.generation }
  };
}

// ─── 门禁（query／explain 注入前） ──────────────────────────────────────────

export type CaliberGateOutcome =
  | { kind: "allow" }
  | { kind: "deny"; denial: CaliberBindingDenial };

function subsetOf(requested: string[], allowed: string[]): boolean {
  const allowedSet = new Set(allowed.map(normalizeCaliberFieldKey));
  return requested.every((key) => allowedSet.has(key));
}

function supersetOf(requested: string[], required: string[]): boolean {
  const requestedSet = new Set(requested);
  return required.map(normalizeCaliberFieldKey).every((key) => requestedSet.has(key));
}

/**
 * D6／D7／D12 —— `lucy_query`／`lucy_explain_query` 的注入前闸。
 *
 * 闸序（Spec §6）：ACL（已在上游完成）→ 口径集合（基于**注入前**原始 Agent 入参
 * ＋快照）→ 行权限注入／既有 guardrails。
 *
 * 偏离 → `caliber_binding_violation`，**不转发上游**。
 */
export async function checkCaliberBindingGate(input: {
  identity: Identity;
  identityKey: string;
  sessionId: string | null | undefined;
  toolName: "lucy_query" | "lucy_explain_query";
  args: Record<string, unknown>;
}): Promise<CaliberGateOutcome> {
  const scopeKey = bindingScopeKey(input.identityKey, input.sessionId);
  const session = await readBindingSession(scopeKey);
  const state: BindingSessionState = session.state;

  if (state === "never_begun" || state === "begun_no_hit") {
    return { kind: "allow" };
  }
  if (state === "lost_or_conflict") {
    // 禁止当 null 放行。
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_UNRESOLVED, "本次问询的口径绑定状态不可信")
    };
  }

  const record = session.record;
  const boundKey = record?.boundKey ?? null;
  const caliber: BoundCaliber | null = record?.caliberSnapshot ?? null;
  if (!boundKey || !caliber) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_UNRESOLVED, "本次问询的口径绑定快照缺失")
    };
  }

  // ① 当前可见性（撤销授权后立即生效，且不泄密）。
  const visible = await visibleCanonicalKeys(input.identity);
  if (!isVisible(visible, boundKey)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_UNRESOLVED, "本次问询绑定的来源当前不可见")
    };
  }

  // ② D12 —— 额外参数一律 violation。
  const forbiddenKey = findForbiddenExtraKey(input.args);
  if (forbiddenKey) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "查询参数包含固定口径之外的键", {
        dimension: "extra_parameter",
        bindingId: record?.bindingId ?? undefined,
        offendingKey: forbiddenKey
      })
    };
  }

  // ③ D7 ② —— 请求侧来源别名（`sourceName`｜`source`｜`table` 同族）必须解析为
  //    `boundKey`。这些键在 D12 允许集里，但**不允许**成为无人检查的顶层键：
  //    解析不到 → 不可解析引用；解析到别的源 → 来源偏离。
  const aliases = collectRequestedSourceAliases(input.args);
  for (const alias of aliases) {
    if (alias.malformed) {
      return {
        kind: "deny",
        denial: denial(CALIBER_BINDING_VIOLATION, "查询的来源别名无法解析", {
          dimension: "unresolvable_reference",
          bindingId: record?.bindingId ?? undefined
        })
      };
    }
    const resolved = await resolveRequestedSourceAlias(input.toolName, input.args, alias.value);
    if (!resolved.ok || !canonicalSourceKeyEquals(resolved.key, boundKey)) {
      return {
        kind: "deny",
        denial: denial(CALIBER_BINDING_VIOLATION, "查询的来源与固定口径不一致", {
          dimension: "source",
          bindingId: record?.bindingId ?? undefined
        })
      };
    }
  }

  // ④ 请求侧规范源键必须**恰好等于** `{boundKey}`。
  const collected = await collectCanonicalSourceKeys(input.toolName, input.args);
  if (collected.unresolved.length > 0) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "查询引用了无法解析的来源", {
        dimension: "unresolvable_reference",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }
  if (
    collected.keys.length !== 1
    || !canonicalSourceKeyEquals(collected.keys[0]!, boundKey)
  ) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "查询的来源与固定口径不一致", {
        dimension: "source",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }

  // ⑤ 口径集合对照**快照**（禁止热读资产）。
  const measures = requestedMeasureKeys(input.args, boundKey);
  if (!measures.ok) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "度量形态不被固定口径允许", {
        dimension: "measures",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }
  const dimensions = requestedDimensionKeys(input.args, boundKey);
  if (!dimensions.ok) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "维度形态不被固定口径允许", {
        dimension: "dimensions",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }
  const segments = requestedSegmentKeys(input.args, boundKey);
  if (!segments.ok) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "分面形态不被固定口径允许", {
        dimension: "segments",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }
  const filters = requestedFilterFields(input.args, boundKey);
  if (!filters.ok) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "筛选条件无法解析为固定口径内的字段", {
        dimension: "filters",
        bindingId: record?.bindingId ?? undefined
      })
    };
  }

  const allowedMeasures = caliber.measures.map(normalizeCaliberFieldKey);
  const allowedDimensions = caliber.dimensions.map(normalizeCaliberFieldKey);
  const allowedSegments = caliber.segments.map(normalizeCaliberFieldKey);
  const allowedFilterFields = caliber.filterFields.map(normalizeCaliberFieldKey);

  if (!subsetOf(measures.keys, allowedMeasures)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "度量超出固定口径允许集合", {
        dimension: "measures",
        bindingId: record?.bindingId ?? undefined,
        allowed: allowedMeasures
      })
    };
  }
  if (!subsetOf(dimensions.keys, allowedDimensions)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "维度超出固定口径允许集合", {
        dimension: "dimensions",
        bindingId: record?.bindingId ?? undefined,
        allowed: allowedDimensions
      })
    };
  }
  if (!subsetOf(segments.keys, allowedSegments)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "分面超出固定口径允许集合", {
        dimension: "segments",
        bindingId: record?.bindingId ?? undefined,
        allowed: allowedSegments
      })
    };
  }
  if (!subsetOf(filters.keys, allowedFilterFields)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "筛选字段超出固定口径允许集合", {
        dimension: "filters",
        bindingId: record?.bindingId ?? undefined,
        allowed: allowedFilterFields
      })
    };
  }
  if (caliber.requireMeasures.length > 0 && !supersetOf(measures.keys, caliber.requireMeasures)) {
    return {
      kind: "deny",
      denial: denial(CALIBER_BINDING_VIOLATION, "缺少固定口径要求的度量", {
        dimension: "require_measures",
        bindingId: record?.bindingId ?? undefined,
        allowed: caliber.requireMeasures.map(normalizeCaliberFieldKey)
      })
    };
  }

  return { kind: "allow" };
}
