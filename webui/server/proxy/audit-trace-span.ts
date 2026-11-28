/**
 * P1-36 trace span ledger — 纯函数核心（Spec lucy-20261116-trace-span-ledger-spec v1.0）。
 *
 * 本模块不依赖 SQLite、HTTP 或 mcp-proxy：只定义阶段枚举、理由码注册表 v1、
 * `attrs_json` 白名单、单请求 span 记录器（32 行上限与 truncated 合并）以及
 * C8 / C9 的纯函数检查，供写路径、对账与 vitest 共用。
 */

import { randomUUID } from "node:crypto";
import { redactAuditText } from "../security/redaction.js";
import {
  ACL_DENIAL_REASONS,
  CONTINUATION_DECLARATION_REJECTIONS,
  SCHEMA_FAILURE_REASONS,
  VALIDATION_REASONS,
  classifyErrorCategory
} from "./audit-classification.js";

export const SPAN_DERIVATION_VERSION = "v2p5-2";
export const MAX_SPANS_PER_TRACE = 32;
export const MAX_ATTRS_BYTES = 1024;
export const MAX_REASON_PARAM_BYTES = 128;

export const TRACE_STAGES = [
  "admission",
  "ledger_received",
  "role_resolve",
  "envelope",
  "session_guard",
  "arg_validate",
  "acl",
  "caliber",
  "source_gate",
  "budget",
  "catalog_resolve",
  "skills_load",
  "instructions_build",
  "upstream_handshake",
  "upstream_call",
  "session_recover",
  "local_handler",
  "response_serialize"
] as const;
export type TraceStage = (typeof TRACE_STAGES)[number];

export const SPAN_STATUSES = ["ok", "denied", "error", "skipped", "truncated"] as const;
export type SpanStatus = (typeof SPAN_STATUSES)[number];

/** 串行阶段：同一父 span 下区间不得重叠（C9d）。`catalog_resolve` / `skills_load` 可并行。 */
export const SERIAL_STAGES: ReadonlySet<TraceStage> = new Set<TraceStage>([
  "ledger_received", "role_resolve", "envelope",
  "session_guard", "arg_validate", "acl", "caliber", "source_gate", "budget",
  "upstream_handshake", "upstream_call", "session_recover",
  "response_serialize"
]);

export const REASON_CODES = [
  "allowed",
  "budget_stopped",
  "continuation_rejected",
  "cancelled",
  "timeout",
  "acl_denied",
  "gate_denied",
  "validation_failed",
  "arg_invalid",
  "audit_unavailable",
  "execution_unavailable",
  "upstream_error",
  "session_lost",
  "session_shortcircuit",
  "upstream_session_recovered",
  "internal_error",
  "unclassified"
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const LOCAL_HANDLERS = [
  "wiki_search", "wiki_read", "catalog", "initialize_fallback", "wiki_fallback", "notification_ack", "ping"
] as const;
export type LocalHandler = (typeof LOCAL_HANDLERS)[number];

export const ATTR_WHITELIST: Readonly<Record<TraceStage, readonly string[]>> = {
  admission: [],
  ledger_received: [],
  role_resolve: [],
  envelope: [],
  session_guard: ["failure_count", "shortcircuit"],
  arg_validate: [],
  acl: ["decision", "policy_version"],
  caliber: [],
  source_gate: ["candidate_count", "pinned", "tier"],
  budget: [],
  catalog_resolve: [],
  skills_load: ["skill_count", "cache_hit", "scan_read", "markdown_parse", "acl_filter", "directories", "reads", "parses", "checks", "joins", "batches"],
  // P1-75 2.2: decision = full or basic; fallback_reason = deadline, capacity_full, build_failed, stale_proof or protocol_fallback;
  instructions_build: [
    "cache_hit", "role_count", "bytes", "decision", "fallback_reason",
    "begin_visibility", "tool_visibility", "skill_verify",
    "skill_verify_checks", "skill_verify_joins", "skill_verify_batches", "skill_verify_io",
    "binding_proof_checks", "binding_proof_joins", "binding_proof_batches"
  ],
  upstream_handshake: ["upstream_status", "retry_count"],
  upstream_call: ["upstream_status", "retry_count"],
  session_recover: ["recovered", "reason"],
  local_handler: ["handler", "permission_ms", "enrich_ms", "examples_ms", "serialize_ms",
    "enrich_fingerprint_ms", "enrich_cache_hit", "enrich_build_ms", "enrich_parse_ms", "enrich_parses", "enrich_assemble_ms"],
  response_serialize: []
};
/** 对所有阶段都允许的键（truncated 合并时使用）。 */
const GLOBAL_ATTR_KEYS = ["dropped"] as const;

export type SpanAttrs = Record<string, string | number | boolean>;

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (utf8Bytes(text) <= maxBytes) return text;
  let out = text;
  while (out.length > 0 && utf8Bytes(out) > maxBytes) out = out.slice(0, -1);
  return out;
}

/** 只保留白名单键与原子值；超 1024 UTF-8 字节则从尾部丢键。空集合返回 null。 */
export function sanitizeSpanAttrs(stage: TraceStage, attrs: Record<string, unknown> | undefined): string | null {
  if (!attrs) return null;
  const allowed = new Set<string>([...ATTR_WHITELIST[stage], ...GLOBAL_ATTR_KEYS]);
  const kept: SpanAttrs = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string") kept[key] = truncateUtf8(value, 64);
    else if (typeof value === "number" && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === "boolean") kept[key] = value;
  }
  const keys = Object.keys(kept);
  while (keys.length > 0 && utf8Bytes(JSON.stringify(kept)) > MAX_ATTRS_BYTES) {
    delete kept[keys.pop() as string];
  }
  return keys.length === 0 ? null : JSON.stringify(kept);
}

// ─── 理由码映射（§5.4，全函数）──────────────────────────────────────────────

export type ReasonMappingInput = {
  decisionReason?: string | null;
  outcome?: string | null;
  errorDetail?: string | null;
};
export type ReasonMapping = { code: ReasonCode; param: string | null; errorCategory: string | null };

const BUDGET_REASONS = new Set([
  "question_budget_exhausted", "question_budget_concurrency_exceeded", "question_budget_unavailable"
]);
/** `acl.ts` 实际返回的、`audit-classification` 集合尚未列出的授权拒绝原因（按代码既有口径归 acl_denied）。 */
const ACL_EXTRA_REASONS = new Set([
  "tool_forbidden", "tool_forbidden_global", "agent_unresolved", "policy_degraded_deny",
  "context_role_required", "field_exposure_unavailable", "constraints_source_not_in_capability",
  "row_policy_requires_wrapped_tool", "row_policy_upstream_unproven", "access_config_unreadable"
]);
const ACL_EXTRA_PREFIXES = ["ops_not_granted:", "role_resolution_failed", "source_map_compile_failed:", "row_policy_"];
const GATE_REASONS = new Set(["source_ambiguity_gate", "caliber_binding_unresolved", "caliber_binding_violation"]);
const AUDIT_UNAVAILABLE_REASONS = new Set(["audit_unavailable", "security_store_unavailable"]);
const EXECUTION_UNAVAILABLE_REASONS = new Set([
  "execution_runtime_unavailable", "execution_config_stale", "execution_canary_blocked",
  "config_missing", "policy_missing_connection", "execution_interrupted"
]);
const UPSTREAM_ERROR_REASONS = new Set(["upstream_error", "hive_query_failed"]);
const INTERNAL_ERROR_REASONS = new Set([
  "answer_verifiability_assemble_failed", "conversation_turn_write_failed"
]);

export function redactReasonParam(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  return truncateUtf8(redactAuditText(raw), MAX_REASON_PARAM_BYTES);
}

function matchReasonCode(reason: string, outcome: string, errorDetail: string): ReasonCode | null {
  if (reason === "upstream_session_recovered") return "upstream_session_recovered";
  // REQ-0122／F3：capacity 层并发拒绝（outcome=denied）也用
  // question_budget_concurrency_exceeded 命名；budget_stopped 语义只属于
  // 预算终止（outcome=budget_stop），denied 行须落到下方 timeout 桶。
  if (outcome === "budget_stop" || (BUDGET_REASONS.has(reason) && outcome !== "denied")) return "budget_stopped";
  if (CONTINUATION_DECLARATION_REJECTIONS.has(reason)) return "continuation_rejected";
  if (reason === "cancelled" || reason === "execution_cancelled") return "cancelled";
  if (reason === "timeout" || reason === "query_concurrency_exceeded" || errorDetail.includes("Timeout")) return "timeout";
  const namedTableRequired = reason.startsWith("explicit_table_required:") && reason !== "explicit_table_required:<empty>";
  if (
    ACL_DENIAL_REASONS.has(reason) ||
    ACL_EXTRA_REASONS.has(reason) ||
    ACL_EXTRA_PREFIXES.some((prefix) => reason.startsWith(prefix)) ||
    reason.startsWith("sensitive_metadata_forbidden") ||
    reason.startsWith("table_forbidden:") ||
    reason.startsWith("unknown_or_forbidden_connection:") ||
    reason.startsWith("tool_unclassified:") ||
    reason.startsWith("wiki_forbidden") ||
    namedTableRequired
  ) return "acl_denied";
  if (GATE_REASONS.has(reason)) return "gate_denied";
  if (VALIDATION_REASONS.has(reason) || reason === "explicit_table_required:<empty>") return "validation_failed";
  if (SCHEMA_FAILURE_REASONS.has(reason) || reason.startsWith("invalid_arguments:")) return "arg_invalid";
  if (AUDIT_UNAVAILABLE_REASONS.has(reason)) return "audit_unavailable";
  if (EXECUTION_UNAVAILABLE_REASONS.has(reason)) return "execution_unavailable";
  if (UPSTREAM_ERROR_REASONS.has(reason)) return "upstream_error";
  if (reason === "session_lost") return "session_lost";
  if (reason === "session_shortcircuit") return "session_shortcircuit";
  if (INTERNAL_ERROR_REASONS.has(reason)) return "internal_error";
  return null;
}

const CATEGORY_BY_CODE: Partial<Record<ReasonCode, string | null>> = {
  allowed: null,
  upstream_session_recovered: null,
  budget_stopped: "budget_stopped",
  continuation_rejected: "validation_failed",
  cancelled: "cancelled",
  timeout: "timeout",
  acl_denied: "policy_denied",
  gate_denied: "validation_failed",
  validation_failed: "validation_failed",
  arg_invalid: "client_schema_failure",
  audit_unavailable: "upstream_failed",
  execution_unavailable: "upstream_failed",
  upstream_error: "upstream_failed",
  session_lost: "upstream_failed",
  session_shortcircuit: "upstream_failed",
  internal_error: "upstream_failed"
};

/** 全函数：任意 `decision_reason` 都有确定的 `reason_code`（匹配不到 → `unclassified`）。 */
export function mapReasonCode(input: ReasonMappingInput): ReasonMapping {
  const reason = input.decisionReason ?? "";
  const outcome = input.outcome ?? "";
  const detail = input.errorDetail ?? "";
  const param = redactReasonParam(input.decisionReason);

  const matched = matchReasonCode(reason, outcome, detail);
  if (matched) {
    const category = matched in CATEGORY_BY_CODE
      ? CATEGORY_BY_CODE[matched] ?? null
      : null;
    return { code: matched, param, errorCategory: category };
  }
  const successReason = reason === "" || reason === "allowed" || reason === "budget_continuation_declared";
  if (outcome === "ok" || (successReason && outcome !== "error" && outcome !== "denied")) {
    return { code: "allowed", param, errorCategory: null };
  }
  if (outcome === "error") return { code: "upstream_error", param, errorCategory: "upstream_failed" };
  return {
    code: "unclassified",
    param,
    errorCategory: classifyErrorCategory({ outcome, decisionReason: reason, errorDetail: detail }).category
  };
}

// ─── 单请求 span 记录器 ────────────────────────────────────────────────────

export type SpanResult = {
  status?: SpanStatus;
  reasonCode?: ReasonCode | null;
  reasonParam?: string | null;
  errorCategory?: string | null;
  attrs?: Record<string, unknown>;
};

export type TraceSpanRow = {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  seq: number;
  stage: TraceStage;
  startedAtMs: number;
  durationMs: number;
  status: SpanStatus;
  reasonCode: ReasonCode | null;
  reasonParam: string | null;
  errorCategory: string | null;
  attrsJson: string | null;
  derivationVersion: typeof SPAN_DERIVATION_VERSION;
};

type OpenSpan = {
  spanId: string;
  stage: TraceStage;
  parentSpanId: string | null;
  startMono: number;
  endMono: number | null;
  result: SpanResult;
};

export type FinalizedTrace = {
  traceId: string;
  /** 根 span 与行 `duration_ms` 的同一读数。 */
  durationMs: number;
  wallStartMs: number;
  /** wall0 + durationMs（v2p5-2 行的 `ts` 取值，C9c）。 */
  wallEndMs: number;
  spans: TraceSpanRow[];
};

export type SpanHandle = {
  readonly spanId: string;
  readonly stage: TraceStage;
  end(result?: SpanResult): void;
};

export type TraceRecorderOptions = {
  traceId: string;
  /** 单调时钟（毫秒，可小数）；默认 `performance.now()`。 */
  monoNow?: () => number;
  /** 墙钟（毫秒）；默认 `Date.now()`；仅在构造时读取一次。 */
  wallNow?: () => number;
};

export class TraceRecorder {
  readonly traceId: string;
  private readonly monoNow: () => number;
  private readonly mono0: number;
  private readonly wall0: number;
  private readonly spans: OpenSpan[] = [];
  private readonly root: OpenSpan;
  private result: FinalizedTrace | null = null;

  constructor(options: TraceRecorderOptions) {
    this.traceId = options.traceId;
    this.monoNow = options.monoNow ?? (() => performance.now());
    this.mono0 = this.monoNow();
    this.wall0 = (options.wallNow ?? Date.now)();
    this.root = {
      spanId: `span_${randomUUID()}`, stage: "admission", parentSpanId: null,
      startMono: this.mono0, endMono: null, result: {}
    };
    this.spans.push(this.root);
  }

  get rootSpanId(): string {
    return this.root.spanId;
  }

  start(stage: TraceStage, parent?: SpanHandle): SpanHandle {
    const span: OpenSpan = {
      spanId: `span_${randomUUID()}`, stage,
      parentSpanId: parent?.spanId ?? this.root.spanId,
      startMono: this.monoNow(), endMono: null, result: {}
    };
    if (!this.result) this.spans.push(span);
    return {
      spanId: span.spanId,
      stage,
      end: (result) => {
        if (span.endMono !== null) return;
        span.endMono = this.monoNow();
        span.result = result ?? {};
      }
    };
  }

  /** 事后登记一个已测得区间的 span（单调读数）。 */
  record(stage: TraceStage, startMono: number, endMono: number, result?: SpanResult, parent?: SpanHandle): void {
    if (this.result) return;
    this.spans.push({
      spanId: `span_${randomUUID()}`, stage,
      parentSpanId: parent?.spanId ?? this.root.spanId,
      startMono, endMono, result: result ?? {}
    });
  }

  /** 一个没有独立计时的裁决点：记为当前时刻的零时长 span。 */
  mark(stage: TraceStage, result?: SpanResult, parent?: SpanHandle): void {
    const now = this.monoNow();
    this.record(stage, now, now, result, parent);
  }

  now(): number {
    return this.monoNow();
  }

  hasStage(stage: TraceStage, status?: SpanStatus): boolean {
    return this.spans.some((s) => s !== this.root && s.stage === stage && (!status || (s.result.status ?? "ok") === status));
  }

  /** 已登记（尚未 finish）的最后一个属于 `stages` 的非根 span 的当前状态。 */
  lastStatusOf(stages: readonly TraceStage[]): SpanStatus | null {
    for (let i = this.spans.length - 1; i >= 0; i -= 1) {
      const span = this.spans[i];
      if (span !== this.root && stages.includes(span.stage)) return span.result.status ?? (span.endMono === null ? "error" : "ok");
    }
    return null;
  }

  /** 把最后一个属于 `stages` 的已结束 span 的结果并入 `patch`（用于「调用成功但结果是上游错误」）。 */
  patchLast(stages: readonly TraceStage[], patch: SpanResult): void {
    if (this.result) return;
    for (let i = this.spans.length - 1; i >= 0; i -= 1) {
      const span = this.spans[i];
      if (span !== this.root && stages.includes(span.stage) && span.endMono !== null) {
        span.result = { ...span.result, ...patch, attrs: { ...span.result.attrs, ...patch.attrs } };
        return;
      }
    }
  }

  /** 关闭根 span 并生成最终行；幂等（第二次返回同一结果）。 */
  finish(rootResult?: SpanResult): FinalizedTrace {
    if (this.result) return this.result;
    const endMono = this.monoNow();
    const duration = Math.max(0, Math.round(endMono - this.mono0));
    this.root.endMono = endMono;
    this.root.result = rootResult ?? {};

    const rows: TraceSpanRow[] = this.spans.map((span, index) => {
      const isRoot = span === this.root;
      const startOffset = isRoot ? 0 : clamp(Math.round(span.startMono - this.mono0), 0, duration);
      const endOffset = isRoot
        ? duration
        : clamp(Math.round((span.endMono ?? endMono) - this.mono0), startOffset, duration);
      const unfinished = span.endMono === null && !isRoot;
      const result = span.result;
      const status: SpanStatus = result.status ?? (unfinished ? "error" : "ok");
      return {
        spanId: span.spanId,
        traceId: this.traceId,
        parentSpanId: span.parentSpanId,
        seq: index + 1,
        stage: span.stage,
        startedAtMs: this.wall0 + startOffset,
        durationMs: endOffset - startOffset,
        status,
        reasonCode: result.reasonCode ?? null,
        reasonParam: result.reasonParam ?? null,
        errorCategory: result.errorCategory ?? null,
        attrsJson: sanitizeSpanAttrs(span.stage, result.attrs),
        derivationVersion: SPAN_DERIVATION_VERSION
      };
    });

    this.result = {
      traceId: this.traceId,
      durationMs: duration,
      wallStartMs: this.wall0,
      wallEndMs: this.wall0 + duration,
      spans: capSpans(rows)
    };
    return this.result;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 超过 32 行：保留前 31 条，其余合并为第 32 条 `truncated`，`attrs.dropped = 总数 − 31`。 */
export function capSpans(rows: TraceSpanRow[]): TraceSpanRow[] {
  if (rows.length <= MAX_SPANS_PER_TRACE) return rows;
  const kept = rows.slice(0, MAX_SPANS_PER_TRACE - 1);
  const dropped = rows.slice(MAX_SPANS_PER_TRACE - 1);
  const root = kept[0];
  const first = dropped[0];
  const startedAtMs = Math.min(...dropped.map((r) => r.startedAtMs));
  const endMs = Math.max(...dropped.map((r) => r.startedAtMs + r.durationMs));
  return [
    ...kept,
    {
      spanId: `span_${randomUUID()}`,
      traceId: first.traceId,
      parentSpanId: root.spanId,
      seq: MAX_SPANS_PER_TRACE,
      stage: first.stage,
      startedAtMs,
      durationMs: Math.max(0, endMs - startedAtMs),
      status: "truncated",
      reasonCode: null,
      reasonParam: null,
      errorCategory: null,
      attrsJson: JSON.stringify({ dropped: rows.length - (MAX_SPANS_PER_TRACE - 1) }),
      derivationVersion: SPAN_DERIVATION_VERSION
    }
  ];
}

// ─── C8 / C9 纯函数检查（对账与 vitest 共用）──────────────────────────────

export type SpanLike = {
  spanId: string;
  parentSpanId: string | null;
  seq: number;
  stage: string;
  startedAtMs: number;
  durationMs: number;
  status: string;
  reasonCode: string | null;
  attrsJson: string | null;
};

/** C8 结构完整性（不含「必有 span 集合」，那由请求类决定）。返回违规描述，空数组＝通过。 */
export function checkSpanIntegrity(spans: readonly SpanLike[]): string[] {
  const problems: string[] = [];
  if (spans.length === 0) return ["no_spans"];
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const roots = spans.filter((s) => s.parentSpanId === null);
  if (roots.length !== 1) problems.push(`root_count=${roots.length}`);
  const stages = new Set<string>(TRACE_STAGES);
  const statuses = new Set<string>(SPAN_STATUSES);
  const reasons = new Set<string>(REASON_CODES);
  const sorted = [...spans].sort((a, b) => a.seq - b.seq);
  sorted.forEach((span, index) => {
    if (span.seq !== index + 1) problems.push(`seq_gap@${span.spanId}`);
    if (!stages.has(span.stage)) problems.push(`stage_unknown:${span.stage}`);
    if (!statuses.has(span.status)) problems.push(`status_unknown:${span.status}`);
    if (span.reasonCode !== null && !reasons.has(span.reasonCode)) problems.push(`reason_unknown:${span.reasonCode}`);
    if (span.durationMs < 0) problems.push(`duration_negative@${span.spanId}`);
    if (span.stage in ATTR_WHITELIST && span.attrsJson) {
      if (utf8Bytes(span.attrsJson) > MAX_ATTRS_BYTES) problems.push(`attrs_too_large@${span.spanId}`);
      try {
        const keys = Object.keys(JSON.parse(span.attrsJson) as Record<string, unknown>);
        const allowed = new Set<string>([...ATTR_WHITELIST[span.stage as TraceStage], ...GLOBAL_ATTR_KEYS]);
        for (const key of keys) if (!allowed.has(key)) problems.push(`attr_key_not_allowed:${span.stage}.${key}`);
      } catch {
        problems.push(`attrs_invalid_json@${span.spanId}`);
      }
    }
    if (span.parentSpanId !== null) {
      const parent = byId.get(span.parentSpanId);
      if (!parent) problems.push(`parent_missing@${span.spanId}`);
      else if (parent.seq >= span.seq) problems.push(`parent_seq_not_before_child@${span.spanId}`);
    }
  });
  for (const span of spans) {
    const seen = new Set<string>();
    let cursor: SpanLike | undefined = span;
    while (cursor && cursor.parentSpanId !== null) {
      if (seen.has(cursor.spanId)) { problems.push(`cycle@${span.spanId}`); break; }
      seen.add(cursor.spanId);
      cursor = byId.get(cursor.parentSpanId);
    }
    if (cursor && cursor.parentSpanId === null && roots.length === 1 && cursor !== roots[0]) {
      problems.push(`unreachable_root@${span.spanId}`);
    }
  }
  return problems;
}

export const SPAN_TIMING_TOLERANCE_MS = 1;

/** C9a / C9b / C9c / C9d。`rowTsMs` 为 `access_log.ts` 毫秒值，`rowDurationMs` 为行 `duration_ms`。 */
export function checkSpanTiming(
  spans: readonly SpanLike[],
  row: { tsMs: number; durationMs: number },
  tolerance = SPAN_TIMING_TOLERANCE_MS
): string[] {
  const problems: string[] = [];
  const root = spans.find((s) => s.parentSpanId === null);
  if (!root) return ["no_root"];
  const rootEnd = root.startedAtMs + root.durationMs;
  for (const span of spans) {
    if (span === root) continue;
    if (span.startedAtMs < root.startedAtMs - tolerance || span.startedAtMs + span.durationMs > rootEnd + tolerance) {
      problems.push(`C9a:${span.spanId}`);
    }
  }
  if (Math.abs(root.durationMs - row.durationMs) > tolerance) problems.push("C9b");
  if (Math.abs(rootEnd - row.tsMs) > tolerance || Math.abs(root.startedAtMs - (row.tsMs - row.durationMs)) > tolerance) {
    problems.push("C9c");
  }
  const byParent = new Map<string, SpanLike[]>();
  for (const span of spans) {
    if (span.parentSpanId === null || !(SERIAL_STAGES as ReadonlySet<string>).has(span.stage)) continue;
    const list = byParent.get(span.parentSpanId) ?? [];
    list.push(span);
    byParent.set(span.parentSpanId, list);
  }
  for (const siblings of byParent.values()) {
    const ordered = [...siblings].sort((a, b) => a.startedAtMs - b.startedAtMs || a.seq - b.seq);
    for (let i = 1; i < ordered.length; i += 1) {
      const prev = ordered[i - 1];
      if (ordered[i].startedAtMs < prev.startedAtMs + prev.durationMs - tolerance) {
        problems.push(`C9d:${prev.spanId}/${ordered[i].spanId}`);
      }
    }
  }
  return problems;
}

// ─── 请求结束时补齐裁决类 span、合成执行证据、必有集合检查（§6.2）──────────

const EXEC_STAGES: readonly TraceStage[] = ["upstream_call", "upstream_handshake", "local_handler"];

const LOCAL_HANDLER_BY_TOOL: Readonly<Record<string, LocalHandler>> = {
  wiki_search: "wiki_search",
  wiki_read: "wiki_read",
  lucy_catalog: "catalog",
  ping: "ping"
};

export type TraceCompletionFacts = {
  /** `access_log.tool`：协议请求为 JSON-RPC method，业务调用为工具名。 */
  tool: string;
  outcome?: string | null;
  decisionReason?: string | null;
  errorDetail?: string | null;
  policyVersion?: number | string | null;
  /** 该请求是否为 `tools/call`（决定 `acl` 与响应最小集合）。 */
  isToolCall: boolean;
};

const PROTOCOL_CLASSES = new Set(["initialize", "tools/list", "ping"]);
export function isProtocolEvidenceClass(tool: string): boolean {
  return PROTOCOL_CLASSES.has(tool) || tool.startsWith("notifications/") || tool === "wiki_search" || tool === "wiki_read";
}

function denialStageFor(code: ReasonCode, reason: string): TraceStage | null {
  switch (code) {
    case "acl_denied": return "acl";
    case "gate_denied": return reason.startsWith("caliber") ? "caliber" : "source_gate";
    case "validation_failed":
    case "arg_invalid": return "arg_validate";
    case "budget_stopped":
    case "continuation_rejected": return "budget";
    default: return null;
  }
}

/**
 * 在根 span 关闭前补齐：被拒阶段的 denied span（未被实测登记时记零时长裁决点）、
 * `acl` ok、执行方式 span；上游调用成功但最终结果为错误时，把执行 span 升为 error。
 * 返回合成出的执行证据（仅协议 / wiki 类且调用方未自带证据时使用）。
 */
export function completeTrace(
  recorder: TraceRecorder,
  facts: TraceCompletionFacts
): {
  evidence: { verifiedSuccess?: boolean; verifiedFailure?: boolean; authorizationAllowed?: boolean } | undefined;
  root: SpanResult;
} {
  const mapped = mapReasonCode(facts);
  const reason = facts.decisionReason ?? "";
  const denied = facts.outcome === "denied" || facts.outcome === "budget_stop" || denialStageFor(mapped.code, reason) !== null;
  const detail = {
    reasonCode: mapped.code,
    reasonParam: mapped.param,
    errorCategory: mapped.errorCategory
  };

  if (denied) {
    const stage = denialStageFor(mapped.code, reason) ?? "acl";
    if (!recorder.hasStage(stage, "denied")) recorder.mark(stage, { status: "denied", ...detail });
    return { evidence: undefined, root: { status: "denied", ...detail } };
  }

  if (facts.isToolCall && !recorder.hasStage("acl")) {
    recorder.mark("acl", {
      status: "ok",
      reasonCode: "allowed",
      attrs: { decision: "allow", ...(facts.policyVersion != null ? { policy_version: facts.policyVersion as string | number } : {}) }
    });
  }

  const failed = facts.outcome === "error";
  const hasExec = EXEC_STAGES.some((stage) => recorder.hasStage(stage));
  if (!hasExec) {
    const handler = facts.tool.startsWith("notifications/") ? "notification_ack" : LOCAL_HANDLER_BY_TOOL[facts.tool];
    recorder.mark("local_handler", {
      status: failed ? "error" : "ok",
      ...(failed ? detail : {}),
      ...(handler ? { attrs: { handler } } : {})
    });
  } else if (failed && recorder.lastStatusOf(EXEC_STAGES) === "ok") {
    recorder.patchLast(EXEC_STAGES, { status: "error", ...detail });
  }

  const evidence = isProtocolEvidenceClass(facts.tool)
    ? failed
      ? { verifiedFailure: true, authorizationAllowed: true }
      : { verifiedSuccess: true, authorizationAllowed: true }
    : undefined;
  return { evidence, root: failed ? { status: "error", ...detail } : { status: "ok", reasonCode: mapped.code } };
}

/** §6.2 必有 span 集合。返回违规描述；空数组＝齐全。被拒请求只要求存在 denied span。 */
export function requiredSpanViolations(
  tool: string,
  spans: ReadonlyArray<{ stage: string; status: string; attrsJson?: string | null }>
): string[] {
  const problems: string[] = [];
  const has = (stage: string, status?: string) => spans.some((s) => s.stage === stage && (!status || s.status === status));
  const hasAny = (stages: readonly string[]) => spans.some((s) => stages.includes(s.stage));
  const denied = spans.some((s) => s.status === "denied");
  if (denied) return problems;
  if (tool === "initialize") {
    if (!has("upstream_handshake")) problems.push("initialize:missing_upstream_handshake");
  } else if (tool === "tools/list") {
    if (!has("upstream_call")) problems.push("tools/list:missing_upstream_call");
  } else if (tool.startsWith("notifications/") || tool === "ping") {
    if (!hasAny(["local_handler", "upstream_call"])) problems.push(`${tool}:missing_exec_span`);
  } else {
    if (!hasAny(EXEC_STAGES)) problems.push(`${tool}:missing_exec_span`);
    if (!has("acl")) problems.push(`${tool}:missing_acl`);
    if (!has("response_serialize")) problems.push(`${tool}:missing_response_serialize`);
  }
  const fallback = spans.some((s) => {
    if (s.stage !== "local_handler" || !s.attrsJson) return false;
    try { return (JSON.parse(s.attrsJson) as { handler?: string }).handler === "wiki_fallback"; } catch { return false; }
  });
  if (fallback && !spans.some((s) => s.stage === "upstream_call" && s.status === "error")) {
    problems.push(`${tool}:wiki_fallback_without_upstream_error`);
  }
  return problems;
}
