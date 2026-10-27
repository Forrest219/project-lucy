/**
 * audit-trust-2026-10-19-r1 / T04a — shared audit event classification.
 *
 * Single source of truth for the four-axis status (transport / authorization /
 * execution / usability) plus event_type + transport_sub_type. API, UI, CSV,
 * and v2 manifest all read from this function (contract §2.3 / §4.1).
 *
 * Pre-existing 4-axis failure dimensions from `webui/server/proxy/question-experience.ts`
 * remain intact — we add new dimensions, never replace them.
 *
 * ─── Lucy v0.25 / L25-09 (B18 / B4 / B14) ─────────────────────────────────
 *
 * E-1: `classifyAccessLogEvent` 只在测试中被调用，生产写 / 读路径都不用它。
 * 本文件因此新增 **v2p5-1** 分类函数 `classifyAuditEvent`，并由
 *   - 生产写路径（`proxy/audit.ts` → `writeLog`）
 *   - 生产读路径（`admin/audit.ts` 列表 / 汇总 / CSV / v2 导出）
 * **共用同一函数**（Spec §4.3(a)「API、UI、CSV、证据包调用同一版本分类函数」）。
 *
 * 关键差异（v2p5-1 vs v1.1）：
 *   - `budget_stop` **不再**映射为 `execution=interrupted`。预算终止是
 *     `execution=not_executed` + `primary_status=budget_stopped`，不是权限拒绝，
 *     也不是「中断」（Spec §4.3(a) 第 2 行）。
 *   - `outcome=ok` **不推定**执行成功。只有写路径给出可核验执行凭据时才
 *     `primary_status=succeeded`；历史行无凭据 → `unknown`（Spec §4.3(a) 第 9 行）。
 *   - 协议成功 ≠ 执行成功：`event_type=protocol` 的 ok 行不产生执行成功凭据。
 *
 * 旧的 `classifyAccessLogEvent` / `CLASSIFICATION_VERSION` 保留（v1.1 契约，
 * 历史行与旧报表继续可读），**不重解释历史数据**。
 */

import {
  derivePrimaryStatus,
  DERIVATION_VERSION,
  type DeliveryStatus,
  type ExecutionView,
  type PrimaryStatus
} from "./audit-derivation.js";
import { normalizeNullReason, type NullReason } from "./audit-null-reasons.js";

export const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";
export const DIGEST_VERSION = "audit-trust-2026-10-19-r1.v1";

/** Lucy v0.25 / L25-09 — v2p5-1 分类版本（U8 并行披露，旧枚举不变）。 */
export const CLASSIFICATION_VERSION_V2P5 = "v2p5-1";
/** 摘要 / 预览版本（U11）。 */
export const PREVIEW_VERSION_V2P5 = "v2p5-1";
export const DIGEST_VERSION_V2P5 = "v2p5-1";

export type EventType = "tool_call" | "protocol" | "client_observation" | "audit_management";
export type TransportSubType = "handshake" | "probe" | "unknown_method" | "other";
export type TransportStatus = "succeeded" | "failed" | "unknown";
export type AuthorizationStatus = "allowed" | "denied" | "not_evaluated" | "unknown";
export type ExecutionStatus = "succeeded" | "failed" | "not_executed" | "interrupted" | "unknown";
export type UsabilityStatus = "usable" | "empty" | "partial" | "metadata_missing" | "not_applicable" | "unknown";

export type ClassifiedEvent = {
  classificationVersion: string;
  eventType: EventType;
  transportSubType: TransportSubType;
  transportStatus: TransportStatus;
  authorizationStatus: AuthorizationStatus;
  executionStatus: ExecutionStatus;
  usabilityStatus: UsabilityStatus;
};

/**
 * Spec 162 四维失败维度（值域不变；U8）。
 * `cancelled` 走 U8：维度留空 + `null_reason=not_applicable`。
 */
export type FailureDimensionValue = "" | "引擎超时与并发" | "过滤条件下推" | "用法与语义" | "权限拒绝";

/** Lucy v0.25 / L25-09 S07 — 统一错误七分类（v0.25 权威）。 */
export type ErrorCategory =
  | "client_schema_failure"
  | "validation_failed"
  | "policy_denied"
  | "upstream_failed"
  | "cancelled"
  | "timeout"
  | "budget_stopped";

export const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "client_schema_failure",
  "validation_failed",
  "policy_denied",
  "upstream_failed",
  "cancelled",
  "timeout",
  "budget_stopped"
];

/** 摘要类型（U11）。 */
export type DigestKind = "search_text" | "sql" | "result";

import {
  MCP_PROBE_METHOD_SET,
  MCP_HANDSHAKE_METHOD_SET,
  isMcpProtocolMethod
} from "./usage-classification.js";

// Spec 189 §4.2 — the handshake and probe sets are maintained explicitly in
// the shared classification module. Deriving them from array indexes (the
// previous behaviour) would silently mislabel `ping` / `prompts/list` as
// handshake the moment the protocol list grew.
const HANDSHAKE_METHODS = MCP_HANDSHAKE_METHOD_SET;
const PROBE_METHODS = MCP_PROBE_METHOD_SET;

/**
 * Classify one access_log-style event into the four-axis status. Outcome
 * strings mirror the legacy `outcome ∈ {ok, error, denied, budget_stop}` set
 * (kept for v1 back-compat).
 */
export function classifyAccessLogEvent(input: {
  tool: string | null;
  outcome?: string | null;
  decisionReason?: string | null;
  failureDimension?: string | null;
  responseRowCount?: number | null;
  responseBytes?: number | null;
  // Optional new-field hints (T04 contract §2.3): when set, override the
  // inferred value so audit write-back matches what the proxy computed.
  eventTypeHint?: EventType | null;
  authorizationStatusHint?: AuthorizationStatus | null;
}): ClassifiedEvent {
  const tool = input.tool ?? "";
  const outcome = input.outcome ?? null;
  const reason = input.decisionReason ?? null;
  const dim = input.failureDimension ?? null;

  // event_type: tool_call vs protocol. The sub-type always infers from the
  // tool name; only the broad event_type accepts an explicit hint (e.g. a
  // future write-back may pre-classify audit_management rows).
  let eventType: EventType = input.eventTypeHint ?? "tool_call";
  let transportSubType: TransportSubType = "other";
  if (HANDSHAKE_METHODS.has(tool)) {
    transportSubType = "handshake";
    if (!input.eventTypeHint) eventType = "protocol";
  } else if (PROBE_METHODS.has(tool)) {
    transportSubType = "probe";
    if (!input.eventTypeHint) eventType = "protocol";
  } else if (tool === "server/discover" || (tool && tool.startsWith("server/"))) {
    transportSubType = "unknown_method";
    if (!input.eventTypeHint) eventType = "protocol";
  }

  // transport_status: succeeded when outcome=ok; failed when outcome=error/denied;
  // unknown otherwise. Does NOT prove the user received the response — that is
  // a separate axis per contract §2.3.
  let transportStatus: TransportStatus = "unknown";
  if (outcome === "ok" || outcome === "succeeded") transportStatus = "succeeded";
  else if (outcome === "error" || outcome === "denied" || outcome === "budget_stop") transportStatus = "failed";

  // authorization_status: explicit hint wins; otherwise based on outcome/decision_reason.
  let authorizationStatus: AuthorizationStatus = input.authorizationStatusHint ?? "not_evaluated";
  if (!input.authorizationStatusHint) {
    if (outcome === "denied" || reason === "permission_denied" || dim === "权限拒绝") authorizationStatus = "denied";
    else if (outcome === "ok" || outcome === "succeeded") authorizationStatus = "allowed";
    else authorizationStatus = "not_evaluated";
  }

  // execution_status: succeeded only when the server actually executed (outcome=ok
  // AND authorization=allowed AND not interrupted). Otherwise categorized by outcome.
  let executionStatus: ExecutionStatus = "unknown";
  if (outcome === "ok" || outcome === "succeeded") executionStatus = "succeeded";
  else if (outcome === "denied") executionStatus = "not_executed";
  else if (outcome === "budget_stop" || reason === "interrupted") executionStatus = "interrupted";
  else if (outcome === "error") executionStatus = "failed";

  // usability_status: derived from response row count when known. Field ambiguity
  // (scan_missing / scan_failed) is NOT mapped to authorizationStatus=denied;
  // that would over-claim a permission attack (G0-03 caveat).
  let usabilityStatus: UsabilityStatus = "unknown";
  if (reason === "scan_missing" || reason === "scan_failed" || reason === "field_ambiguous") {
    usabilityStatus = "metadata_missing";
  } else if (input.responseRowCount === 0) {
    usabilityStatus = "empty";
  } else if (input.responseRowCount === null || input.responseRowCount === undefined) {
    usabilityStatus = "not_applicable";
  } else if (input.responseRowCount > 0) {
    usabilityStatus = "usable";
  }

  return {
    classificationVersion: CLASSIFICATION_VERSION,
    eventType,
    transportSubType,
    transportStatus,
    authorizationStatus,
    executionStatus,
    usabilityStatus
  };
}

/**
 * Same classification as classifyAccessLogEvent, but for a whole batch — the
 * function is deterministic, so this is just a thin array map; included for
 * reader ergonomics when populating CSV rows from a query.
 */
export function classifyAccessLogBatch<T extends Parameters<typeof classifyAccessLogEvent>[0]>(
  rows: readonly T[]
): ClassifiedEvent[] {
  return rows.map((row) => classifyAccessLogEvent(row));
}

// ─── Lucy v0.25 / L25-09 — v2p5-1 分类（生产写 / 读路径共用）──────────────

/** 写路径提供的可核验执行凭据。缺失即该事实不成立。 */
export type ExecutionEvidence = {
  /** 有可核验执行成功凭据（真实执行 + 可核验结果）。 */
  verifiedSuccess?: boolean;
  /** 有可核验执行失败或入参 / 语义校验失败凭据。 */
  verifiedFailure?: boolean;
  /** 有已确认的执行取消凭据（取消请求本身不足）。 */
  verifiedCancellation?: boolean;
  /** 有执行超时凭据。 */
  executionTimeout?: boolean;
  /** 有持久前缀。 */
  durablePrefix?: boolean;
  /** 处理中断且结果未定。 */
  interruptedWithoutResult?: boolean;
  /** 事实相互矛盾且无法按凭据消解。 */
  unresolvedContradiction?: boolean;
  /** 冲突标签。 */
  conflictTags?: string[];
  /** 明确授权拒绝（真实裁决）。 */
  authorizationDenied?: boolean;
  /**
   * 明确授权通过（真实裁决）。
   *
   * 与 `budgetStopped` 独立：预算终止不得覆盖已经发生的授权裁决
   * （Spec §4.3(b) / §18.10 F-03）。
   */
  authorizationAllowed?: boolean;
  /**
   * 确未评估授权（可证明：请求在授权裁决之前即被终止）。
   * 证据不足不属于本项 —— 那种情况落 `unknown`。
   */
  authorizationNotEvaluated?: boolean;
  /** 本次尝试未实际执行。 */
  notExecuted?: boolean;
  /** 送达状态（本期只写 prepared / sent / acknowledged / unknown）。 */
  deliveryStatus?: DeliveryStatus;
  /** 证据引用。 */
  evidenceRefs?: string[];
};

/** S01(e) reported / observed / inferred 三族分离。 */
export type EvidenceFamilies = {
  /** 客户端声明。 */
  reported: {
    client: string | null;
    clientVersion: string | null;
    role: string | null;
  };
  /** 实际协议 / 报文 / 裁决观测。 */
  observed: {
    protocol: string | null;
    userAgent: string | null;
    roleIds: string[];
    /** 角色附当次生效的权限快照引用。 */
    permissionSnapshotHash: string | null;
  };
  /** 按协议特征推断的客户端类型（与 observed 分开）。 */
  inferred: {
    client: string | null;
    inferenceMethod: string | null;
    confidence: "high" | "low" | "none";
    ruleVersion: string | null;
  };
};

export type ClassifiedAuditEventV2 = {
  classificationVersion: string;
  derivationVersion: string;
  eventType: EventType;
  transportSubType: TransportSubType;
  transportStatus: TransportStatus;
  authorizationStatus: AuthorizationStatus;
  executionStatus: ExecutionStatus;
  usabilityStatus: UsabilityStatus;
  /** 汇总主状态八桶。 */
  primaryStatus: PrimaryStatus;
  /** 送达状态。 */
  deliveryStatus: DeliveryStatus;
  /** 冲突标签（`unknown` + conflict 时非空）。 */
  conflictTags: string[];
  /** 旧 outcome 原样保留。 */
  legacyOutcome: string | null;
  /** 统一错误七分类（无错误时 null + null_reason）。 */
  errorCategory: ErrorCategory | null;
  /** 162 四维失败维度（值域不变）。 */
  failureDimension: FailureDimensionValue;
  /** 缺值原因。 */
  nullReason: NullReason;
};

export type ClassifyAuditEventInput = {
  tool: string | null;
  outcome?: string | null;
  decisionReason?: string | null;
  failureDimension?: string | null;
  responseRowCount?: number | null;
  responseBytes?: number | null;
  errorDetail?: string | null;
  eventTypeHint?: EventType | null;
  authorizationStatusHint?: AuthorizationStatus | null;
  /** 写路径提供的可核验凭据（读路径重算时缺失 → unknown）。 */
  evidence?: ExecutionEvidence;
};

/**
 * v2p5-1 分类：**生产写路径与读路径共用的唯一分类函数**。
 *
 * 与 v1.1 `classifyAccessLogEvent` 的关键差异见本文件头部说明。
 */
export function classifyAuditEvent(input: ClassifyAuditEventInput): ClassifiedAuditEventV2 {
  const legacy = classifyAccessLogEvent({
    tool: input.tool,
    outcome: input.outcome,
    decisionReason: input.decisionReason,
    failureDimension: input.failureDimension,
    responseRowCount: input.responseRowCount,
    responseBytes: input.responseBytes,
    eventTypeHint: input.eventTypeHint,
    authorizationStatusHint: input.authorizationStatusHint
  });

  const outcome = input.outcome ?? null;
  const evidence = input.evidence ?? {};
  const budgetStopped = outcome === "budget_stop" || input.decisionReason === "question_budget_exhausted";

  // 预算终止 → not_executed（**不是** interrupted，也不是权限拒绝）。
  const notExecuted =
    evidence.notExecuted ??
    (outcome === "denied" || outcome === "budget_stop" || legacy.executionStatus === "not_executed");

  const authorizationDenied =
    evidence.authorizationDenied ?? (legacy.authorizationStatus === "denied");

  // ─── F-03：授权事实保真 ──────────────────────────────────────────────────
  //
  // legacy 的 outcome 启发式在「非 ok 非 denied」时一律给 `not_evaluated`。
  // 那只是**没有证据**，不是「确未评估」；直接采用会让预算终止等场景被反推成
  // `not_evaluated`，正是 Spec §4.3(b) / §18.10 F-03 禁止的行为。
  //
  // 此处只接受两类来源：
  //   1. 调用方给出的显式裁决凭据（`evidence` / `authorizationStatusHint`）；
  //   2. legacy 只在 outcome 明确为 ok/succeeded（即授权未拒绝）时才给出 allowed。
  // 其余一律 `unknown`（派生层另有「执行成功 ⇒ 授权已通过」的推理）。
  const authorizationAllowed =
    evidence.authorizationAllowed ??
    (input.authorizationStatusHint === "allowed" || legacy.authorizationStatus === "allowed");
  const authorizationNotEvaluated =
    evidence.authorizationNotEvaluated ?? (input.authorizationStatusHint === "not_evaluated");

  const derivation = derivePrimaryStatus({
    unresolvedContradiction: evidence.unresolvedContradiction,
    conflictTags: evidence.conflictTags,
    budgetStopped,
    authorizationDenied,
    authorizationAllowed,
    authorizationNotEvaluated,
    notExecuted,
    verifiedSuccess: evidence.verifiedSuccess,
    verifiedFailure: evidence.verifiedFailure,
    verifiedCancellation: evidence.verifiedCancellation,
    executionTimeout: evidence.executionTimeout,
    durablePrefix: evidence.durablePrefix,
    interruptedWithoutResult: evidence.interruptedWithoutResult,
    deliveryStatus: evidence.deliveryStatus,
    legacyOutcome: outcome,
    evidenceRefs: evidence.evidenceRefs
  });

  // execution 视图由派生层给出（budget_stop → not_executed）。
  const executionStatus: ExecutionStatus = derivation.execution;
  const authorizationStatus: AuthorizationStatus = derivation.authorization;

  const error = classifyErrorCategory({
    outcome,
    decisionReason: input.decisionReason,
    errorDetail: input.errorDetail,
    failureDimension: input.failureDimension
  });

  return {
    classificationVersion: CLASSIFICATION_VERSION_V2P5,
    derivationVersion: DERIVATION_VERSION,
    eventType: legacy.eventType,
    transportSubType: legacy.transportSubType,
    transportStatus: legacy.transportStatus,
    authorizationStatus,
    executionStatus,
    usabilityStatus: legacy.usabilityStatus,
    primaryStatus: derivation.primaryStatus,
    deliveryStatus: derivation.delivery,
    conflictTags: derivation.conflictTags,
    legacyOutcome: outcome,
    errorCategory: error.category,
    failureDimension: error.failureDimension,
    nullReason: error.nullReason
  };
}

// ─── B14 统一错误七分类 → Spec 162 四维映射（同一分类函数产出）─────────────

const ACL_DENIAL_REASONS = new Set([
  "sensitive_metadata_forbidden",
  "wiki_forbidden",
  "raw_query_forbidden",
  "agent_disabled"
]);

const VALIDATION_REASONS = new Set([
  "count_without_source",
  "ambiguous_field",
  "aggregate_of_aggregate",
  "wiki_not_found",
  "completeness_denominator_required"
]);

const SCHEMA_FAILURE_REASONS = new Set([
  "invalid_arguments",
  "invalidArguments",
  "schema_validation_failed",
  "missing_required_argument"
]);

export type ClassifiedError = {
  /** 七分类（v0.25 权威）。 */
  category: ErrorCategory | null;
  /** 162 四维失败维度（值域不变；cancelled 留空）。 */
  failureDimension: FailureDimensionValue;
  /** 缺值原因（cancelled → not_applicable）。 */
  nullReason: NullReason;
};

export type ClassifyErrorInput = {
  outcome?: string | null;
  decisionReason?: string | null;
  errorDetail?: string | null;
  failureDimension?: string | null;
};

/**
 * 统一错误七分类 → Spec 162 四维映射。
 *
 * 映射表见 Spec §10.2：
 *   client_schema_failure → 用法与语义
 *   validation_failed     → 用法与语义
 *   policy_denied         → 权限拒绝（须有真实授权裁决）
 *   upstream_failed       → 引擎超时与并发 / 用法与语义（按 162 既有规则归并）
 *   cancelled             → 维度留空 + null_reason=not_applicable
 *   timeout               → 引擎超时与并发
 *   budget_stopped        → 无维度（主状态有桶）
 *
 * `explicit_table_required:<empty>` 仍归 **用法与语义**（validation_failed）；
 * 只有 `explicit_table_required:<table>` 才是权限拒绝。
 */
export function classifyErrorCategory(input: ClassifyErrorInput): ClassifiedError {
  const outcome = input.outcome ?? "";
  const reason = input.decisionReason ?? "";
  const detail = input.errorDetail ?? "";

  // budget_stop：主状态有 bucket_stopped 桶，162 四维保持无维度。
  if (outcome === "budget_stop" || reason === "question_budget_exhausted") {
    return { category: "budget_stopped", failureDimension: "", nullReason: "not_applicable" };
  }

  // cancelled：U8 —— 维度留空 + null_reason=not_applicable。
  if (reason === "cancelled" || reason === "execution_cancelled") {
    return { category: "cancelled", failureDimension: "", nullReason: "not_applicable" };
  }

  // timeout：引擎超时与并发。
  if (reason === "timeout" || reason === "query_concurrency_exceeded" || detail.includes("Timeout")) {
    return { category: "timeout", failureDimension: "引擎超时与并发", nullReason: "not_applicable" };
  }

  // policy_denied：必须有真实授权裁决。
  const namedTableRequired = reason.startsWith("explicit_table_required:") && reason !== "explicit_table_required:<empty>";
  const aclDenied =
    ACL_DENIAL_REASONS.has(reason) ||
    reason.startsWith("sensitive_metadata_forbidden") ||
    reason.startsWith("table_forbidden:") ||
    reason.startsWith("unknown_or_forbidden_connection:") ||
    reason.startsWith("tool_unclassified:") ||
    reason.startsWith("wiki_forbidden");
  if (aclDenied || namedTableRequired) {
    return { category: "policy_denied", failureDimension: "权限拒绝", nullReason: "not_applicable" };
  }

  // client_schema_failure：入参校验失败（-32602 形状）。
  if (SCHEMA_FAILURE_REASONS.has(reason) || reason === "invalid_arguments") {
    return { category: "client_schema_failure", failureDimension: "用法与语义", nullReason: "not_applicable" };
  }

  // validation_failed：语义校验失败（含 explicit_table_required:<empty>）。
  if (VALIDATION_REASONS.has(reason) || reason === "explicit_table_required:<empty>") {
    return { category: "validation_failed", failureDimension: "用法与语义", nullReason: "not_applicable" };
  }

  // 过滤条件下推是 162 既有维度；先于 upstream_failed 归并。
  if (input.failureDimension === "过滤条件下推") {
    return { category: "upstream_failed", failureDimension: "过滤条件下推", nullReason: "not_applicable" };
  }

  // upstream_failed：按 162 既有规则归并到四维之一。
  if (input.failureDimension === "引擎超时与并发") {
    return { category: "upstream_failed", failureDimension: "引擎超时与并发", nullReason: "not_applicable" };
  }
  if (outcome === "error") {
    return { category: "upstream_failed", failureDimension: "用法与语义", nullReason: "not_applicable" };
  }
  if (outcome === "denied") {
    return { category: "policy_denied", failureDimension: "权限拒绝", nullReason: "not_applicable" };
  }

  return { category: null, failureDimension: "", nullReason: "not_applicable" };
}

// ─── B4 reported / observed / inferred 三族分离 ────────────────────────────

export type EvidenceFamilyInput = {
  reportedClient?: string | null;
  reportedClientVersion?: string | null;
  reportedRole?: string | null;
  observedProtocol?: string | null;
  observedUserAgent?: string | null;
  observedRoleIds?: readonly string[] | null;
  permissionSnapshotHash?: string | null;
  inferredClient?: string | null;
  inferenceMethod?: string | null;
  inferenceConfidence?: "high" | "low" | "none" | null;
  inferenceRuleVersion?: string | null;
};

/**
 * 构造三族分离的证据结构。
 *
 * - reported 是**客户端声明**，不覆盖服务端生效事实。
 * - observed 是**实际观测**；角色附 `permission_snapshot_hash`。
 * - inferred 是**推断**，与 observed 分开，不作为确认事实或强行配对依据。
 */
export function buildEvidenceFamilies(input: EvidenceFamilyInput): EvidenceFamilies {
  return {
    reported: {
      client: input.reportedClient ?? null,
      clientVersion: input.reportedClientVersion ?? null,
      role: input.reportedRole ?? null
    },
    observed: {
      protocol: input.observedProtocol ?? null,
      userAgent: input.observedUserAgent ?? null,
      roleIds: [...(input.observedRoleIds ?? [])],
      permissionSnapshotHash: input.permissionSnapshotHash ?? null
    },
    inferred: {
      client: input.inferredClient ?? null,
      inferenceMethod: input.inferenceMethod ?? null,
      confidence: input.inferenceConfidence ?? "none",
      ruleVersion: input.inferenceRuleVersion ?? null
    }
  };
}

/** 缺值原因归一化（供分类结果复用）。 */
export { normalizeNullReason };