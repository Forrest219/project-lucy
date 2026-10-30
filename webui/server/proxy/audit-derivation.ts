/**
 * Lucy v0.25 / L25-09 S01(a)(b) — 汇总主状态派生层 + 三视图.
 *
 * 权威来源：Spec `docs/specs/lucy-20261020-v2p5-audit-increment-spec.md`
 * §4.3(a)（U10 冻结的九行有序派生表）、§4.3(b)（authorization / execution /
 * delivery 三视图）、§12.3（伪代码）。
 *
 * 硬规则（逐条来自 Spec，不得放宽）：
 *   1. 每个计量单元有且仅有一个主状态；八桶互斥且闭合。
 *   2. 先核验矛盾：事实相互矛盾且无法按凭据消解 → `unknown` + conflict 标签。
 *   3. 闭合凭据（失败 / 成功）先于取消 / 超时。
 *   4. 预算终止不是授权拒绝；预算桶**不得**覆盖已发生的授权裁决，也**不得**
 *      反推 `not_evaluated`（§4.3(b) / §18.10 F-03）。
 *   5. `execution=succeeded` 不因送达缺失而改变；HTTP 200 不推定执行成功。
 *   6. 旧 `outcome=ok` 不提供任何闭合凭据 → 历史行落 `unknown`。
 *   7. 派生只使用 **as-of S** 的可核验证据。
 *
 * `derivationVersion = v2p5-1`（U10 冻结值）。改动本函数即改动事实分类规则，
 * 必须同步升版本并在导出 Manifest 中披露。
 */

import type { NullReason } from "./audit-null-reasons.js";

/** 派生规则版本（U10）。 */
export const DERIVATION_VERSION = "v2p5-1";

/** 汇总主状态八桶（Spec §4.3(a)）。顺序即展示顺序，闭合断言按此比对。 */
export const PRIMARY_STATUSES = [
  "succeeded",
  "failed",
  "denied",
  "budget_stopped",
  "cancelled",
  "timeout",
  "indeterminate",
  "unknown"
] as const;

export type PrimaryStatus = (typeof PRIMARY_STATUSES)[number];

const PRIMARY_STATUS_SET: ReadonlySet<string> = new Set(PRIMARY_STATUSES);

export function isPrimaryStatus(value: unknown): value is PrimaryStatus {
  return typeof value === "string" && PRIMARY_STATUS_SET.has(value);
}

/** 空桶（用于汇总起点）。 */
export function emptyPrimaryStatusCounts(): Record<PrimaryStatus, number> {
  const out = {} as Record<PrimaryStatus, number>;
  for (const status of PRIMARY_STATUSES) out[status] = 0;
  return out;
}

// ─── 三视图（Spec §4.3(b)）────────────────────────────────────────────────────

export type AuthorizationView = "allowed" | "denied" | "not_evaluated" | "unknown";
export type ExecutionView = "succeeded" | "failed" | "not_executed" | "interrupted" | "unknown";

/** 授权视图值域（读路径归一化的唯一依据）。 */
export const AUTHORIZATION_VIEWS = ["allowed", "denied", "not_evaluated", "unknown"] as const;

/** 执行视图值域（读路径归一化的唯一依据）。 */
export const EXECUTION_VIEWS = ["succeeded", "failed", "not_executed", "interrupted", "unknown"] as const;

const AUTHORIZATION_VIEW_SET: ReadonlySet<string> = new Set(AUTHORIZATION_VIEWS);
const EXECUTION_VIEW_SET: ReadonlySet<string> = new Set(EXECUTION_VIEWS);

export function isAuthorizationView(value: unknown): value is AuthorizationView {
  return typeof value === "string" && AUTHORIZATION_VIEW_SET.has(value);
}

export function isExecutionView(value: unknown): value is ExecutionView {
  return typeof value === "string" && EXECUTION_VIEW_SET.has(value);
}

/** 本期**写入**的送达状态（Spec §4.3(b) / U1）。 */
export const DELIVERY_STATUSES = ["prepared", "sent", "acknowledged", "unknown"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * 送达状态**值域**。`unacknowledged` 只保留值域、本期不写入；
 * 不得据「无 ACK」推导 `unacknowledged`（U1：无 ACK 超时）。
 */
export const DELIVERY_STATUS_DOMAIN = [
  "prepared",
  "sent",
  "acknowledged",
  "unknown",
  "unacknowledged"
] as const;
export type DeliveryStatusDomain = (typeof DELIVERY_STATUS_DOMAIN)[number];

const DELIVERY_WRITTEN_SET: ReadonlySet<string> = new Set(DELIVERY_STATUSES);

export function isWrittenDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && DELIVERY_WRITTEN_SET.has(value);
}

// ─── 派生事实（Facts）────────────────────────────────────────────────────────

/**
 * 派生所需的**可核验事实**。每项都对应一条账本凭据，缺失即不成立。
 * 禁止用旧 `outcome` 直接推定任何一项成立。
 */
export type DerivationFacts = {
  /**
   * 事实相互矛盾且无法按凭据消解（互斥闭合凭据、无法证明时序或同一尝试的
   * 竞争凭据）。命中即 `unknown` + conflict。
   */
  unresolvedContradiction?: boolean;
  /** 冲突标签（可多条）。 */
  conflictTags?: string[];

  /** 预算引擎明确终止本次尝试。 */
  budgetStopped?: boolean;
  /** 明确授权拒绝（真实裁决，不是从入参错误倒推）。 */
  authorizationDenied?: boolean;
  /**
   * 明确授权通过（真实裁决凭据）。
   *
   * 与 `budgetStopped` **相互独立**：预算终止不得覆盖已经发生的授权裁决
   * （Spec §4.3(b) / §18.10 F-03）。本项表示「授权已裁决通过」，与本次尝试
   * 是否被执行无关。
   */
  authorizationAllowed?: boolean;
  /**
   * 确未评估授权（可证明：请求在授权裁决之前即被终止）。
   *
   * 「证据不足」不属本项 —— 那种情况必须落 `unknown`，不得用本项把
   * `unknown` 洗成 `not_evaluated`。
   */
  authorizationNotEvaluated?: boolean;
  /** 本次尝试未实际执行。 */
  notExecuted?: boolean;

  /** 有可核验的执行失败或入参 / 语义校验失败凭据。 */
  verifiedFailure?: boolean;
  /** 有可核验的执行成功凭据。 */
  verifiedSuccess?: boolean;
  /** 有**已确认**的执行取消凭据（取消请求本身不足）。 */
  verifiedCancellation?: boolean;
  /** 有执行超时凭据。 */
  executionTimeout?: boolean;

  /** 有持久前缀（账本已提交 received / admitted / prepared）。 */
  durablePrefix?: boolean;
  /** 处理中断且结果未定。 */
  interruptedWithoutResult?: boolean;

  /** 三视图的直接判定值（可选；提供时优先于推导）。 */
  authorizationView?: AuthorizationView;
  executionView?: ExecutionView;
  deliveryStatus?: DeliveryStatus;

  /** 原始错误码 / 原始 outcome / 规范化原因及其证据引用，分别保留。 */
  rawCode?: string | null;
  legacyOutcome?: string | null;
  normalizedReason?: string | null;
  /** 证据引用（原始事件 ID / 账本 seq 等）。 */
  evidenceRefs?: string[];
};

/** 派生结果。 */
export type PrimaryStatusDerivation = {
  primaryStatus: PrimaryStatus;
  /** 是否带 conflict 标签（`unknown` + conflict 是唯一带标签的组合）。 */
  conflict: boolean;
  conflictTags: string[];
  /** 命中的派生规则序号（1..9），便于逐行追溯。 */
  rule: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** 派生规则版本。 */
  derivationVersion: string;
  /** 三视图（与主状态相互独立，不因主状态改变而改写）。 */
  authorization: AuthorizationView;
  execution: ExecutionView;
  delivery: DeliveryStatus;
  /** 证据引用（原样透传）。 */
  evidenceRefs: string[];
};

/**
 * U10 冻结的九行有序派生表。
 *
 * 先核验事实及竞争凭据，再按表顺序命中首项；失败 / 成功的闭合凭据先于
 * 取消 / 超时。取消请求、观察超时与执行完成可以发生在不同阶段，不因信号并存
 * 就称事实矛盾；但互斥闭合凭据、无法证明时序 / 同一尝试的竞争凭据须保留
 * `unknown` + conflict，不能猜顺序。
 */
export function derivePrimaryStatus(facts: DerivationFacts): PrimaryStatusDerivation {
  const conflictTags = [...(facts.conflictTags ?? [])];

  // 规则 1 — 事实相互矛盾且无法按凭据消解。最高优先，不以排序掩盖矛盾。
  const contradiction = facts.unresolvedContradiction === true;
  const authorization = facts.authorizationView ?? deriveAuthorizationView(facts);
  const execution = facts.executionView ?? deriveExecutionView(facts);
  const delivery = facts.deliveryStatus ?? "unknown";

  let primaryStatus: PrimaryStatus;
  let rule: PrimaryStatusDerivation["rule"];

  if (contradiction) {
    primaryStatus = "unknown";
    rule = 1;
    if (conflictTags.length === 0) conflictTags.push("unresolved_contradiction");
  } else if (facts.budgetStopped === true && facts.notExecuted === true) {
    // 规则 2 — 预算引擎明确终止本次尝试，未实际执行。
    primaryStatus = "budget_stopped";
    rule = 2;
  } else if (facts.authorizationDenied === true && facts.notExecuted === true) {
    // 规则 3 — 明确授权拒绝，未实际执行。
    primaryStatus = "denied";
    rule = 3;
  } else if (facts.verifiedFailure === true) {
    // 规则 4 — 有可核验执行失败或入参 / 语义校验失败凭据。
    primaryStatus = "failed";
    rule = 4;
  } else if (facts.verifiedSuccess === true) {
    // 规则 5 — 有可核验执行成功凭据。送达独立，不因 ACK 缺失改执行结果。
    primaryStatus = "succeeded";
    rule = 5;
  } else if (facts.verifiedCancellation === true) {
    // 规则 6 — 有执行取消凭据，且无优先闭合结果。
    primaryStatus = "cancelled";
    rule = 6;
  } else if (facts.executionTimeout === true) {
    // 规则 7 — 有执行超时凭据，且无优先闭合结果 / 已确认取消。
    primaryStatus = "timeout";
    rule = 7;
  } else if (facts.durablePrefix === true && facts.interruptedWithoutResult === true) {
    // 规则 8 — 有持久前缀、处理中断且结果未定。
    primaryStatus = "indeterminate";
    rule = 8;
  } else {
    // 规则 9 — 其余证据不足或历史事实未经核验。旧 outcome=ok 不推定成功。
    primaryStatus = "unknown";
    rule = 9;
  }

  return {
    primaryStatus,
    conflict: primaryStatus === "unknown" && conflictTags.length > 0,
    conflictTags,
    rule,
    derivationVersion: DERIVATION_VERSION,
    authorization,
    execution,
    delivery,
    evidenceRefs: [...(facts.evidenceRefs ?? [])]
  };
}

/**
 * authorization 视图：只在 Lucy 裁决时刻判定。
 *
 * 硬规则（Spec §4.3(b) / §18.10 F-03）：
 *   1. **预算终止不产生授权结论**。预算桶既不得被记为授权拒绝，也不得反推
 *      `not_evaluated`；确未评估必须有可证事实（`authorizationNotEvaluated`）。
 *   2. **预算不得覆盖已发生的授权裁决**。已裁决通过 → `allowed`；已裁决拒绝 →
 *      `denied`，与本次尝试是否被执行无关。
 *   3. 证据不足 → `unknown`。不得用 `not_evaluated` 掩盖「不知道」。
 */
export function deriveAuthorizationView(facts: DerivationFacts): AuthorizationView {
  if (facts.authorizationDenied === true) return "denied";
  if (facts.authorizationAllowed === true) return "allowed";
  if (facts.authorizationNotEvaluated === true) return "not_evaluated";
  // 执行发生 ⇒ 授权已通过：调用不可能在授权拒绝之后被执行。
  if (facts.verifiedSuccess === true) return "allowed";
  return "unknown";
}

/**
 * execution 视图：上游或本地执行结果。
 * HTTP 200 不推定执行成功；预算终止不是 `interrupted`（`interrupted` 只表示
 * 有持久前缀、处理中断且结果未定）。
 *
 * `notExecuted` **先于** `verifiedFailure` 判定：生成前失败（入参 / 语义校验
 * 失败）已有失败凭据，但并未实际执行 → `execution=not_executed`
 * （Spec §4.3(a) 第 4 行约束列）。
 */
export function deriveExecutionView(facts: DerivationFacts): ExecutionView {
  if (facts.verifiedSuccess === true) return "succeeded";
  if (facts.notExecuted === true) return "not_executed";
  if (facts.verifiedFailure === true) return "failed";
  if (facts.durablePrefix === true && facts.interruptedWithoutResult === true) return "interrupted";
  return "unknown";
}

// ─── 汇总与闭合断言（Spec §4.3(a) / §12.3）──────────────────────────────────

export type PrimaryStatusSummary = {
  /** 八桶计数。 */
  counts: Record<PrimaryStatus, number>;
  /** 纳入集合总数（各桶之和必须等于它）。 */
  total: number;
  /** 闭合断言结果。 */
  closed: boolean;
  /** 闭合失败原因（`closed=false` 时非空）。 */
  closureErrors: string[];
  derivationVersion: string;
};

/**
 * 八桶汇总 + 闭合断言。
 *
 * 断言：`union(statusBuckets) == ids(units)` 且 `bucketsAreDisjoint()`。
 * 每个单元只进一个桶；合计必须等于集合总数。
 */
export function summarizePrimaryStatuses(
  units: ReadonlyArray<{ primaryStatus: PrimaryStatus }>
): PrimaryStatusSummary {
  const counts = emptyPrimaryStatusCounts();
  const seen = new Set<PrimaryStatus>();
  const closureErrors: string[] = [];

  for (const unit of units) {
    if (!isPrimaryStatus(unit.primaryStatus)) {
      closureErrors.push(`invalid_primary_status:${String(unit.primaryStatus)}`);
      continue;
    }
    if (seen.has(unit.primaryStatus)) {
      // 桶是互斥的计数维度，重复出现同一状态不是错误；此集合只做桶内计数。
      void 0;
    }
    seen.add(unit.primaryStatus);
    counts[unit.primaryStatus] += 1;
  }

  const total = PRIMARY_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  if (total !== units.length) {
    closureErrors.push(`bucket_sum_${total}_ne_set_size_${units.length}`);
  }

  return {
    counts,
    total,
    closed: closureErrors.length === 0,
    closureErrors,
    derivationVersion: DERIVATION_VERSION
  };
}

/**
 * 空值原因与主状态并存的记录包装。
 * 派生层不产出空值原因；调用方用本函数把「值 + 原因 + 证据来源」绑定在一起。
 */
export function withNullReason<T>(
  value: T | null | undefined,
  reason: NullReason,
  evidenceSource: string
): { value: T | null; reason: NullReason; evidenceSource: string } {
  return {
    value: value === undefined ? null : value,
    reason,
    evidenceSource
  };
}
