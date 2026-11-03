/**
 * 审计可信度（20261019 规格 §5「管理员第一现场」）的**前端展示口径**。
 *
 * 唯一真源分工：
 *   - **值域与归一化**：后端 `webui/server/proxy/audit-derivation.ts` /
 *     `turn-correlation.ts` / `audit-null-reasons.ts`。本文件只消费，不重新定义。
 *   - **中文标签与配色**：本文件。前端各处必须从这里取，不得就地硬编码，
 *     否则同一个桶会在两个页面显示成两种说法。
 *
 * 三条**独立**判断轴（20261019 §5）：
 *   「执行成功不自动使关联或证据覆盖显示绿色已完成。」
 * 因此：
 *   - 执行轴读 `execution_status`；
 *   - 关联轴读 `effective_association_status`；
 *   - 覆盖轴读受控客户端上报事实。
 *   **任何一轴都不得推导另一轴**，也不得由旧 `outcome` 推定。
 */

import type {
  AuditAssociationStatus,
  AuditAuthorizationStatus,
  AuditExecutionStatus,
  AuditNullReason,
  AuditPrimaryStatus
} from "./types";
import type {
  AssociationAxis,
  CoverageAxis,
  ExecutionAxis,
  ReadonlySqlRowsetStatus
} from "../components/audit-trust";

/** 八桶主状态标签（顺序 = 后端 `PRIMARY_STATUSES` 的展示顺序）。 */
export const PRIMARY_STATUS_ORDER: readonly AuditPrimaryStatus[] = [
  "succeeded",
  "failed",
  "denied",
  "budget_stopped",
  "cancelled",
  "timeout",
  "indeterminate",
  "unknown"
];

export const PRIMARY_STATUS_LABELS: Record<AuditPrimaryStatus, string> = {
  succeeded: "执行成功",
  failed: "执行失败",
  denied: "已拒绝",
  budget_stopped: "预算终止",
  cancelled: "已取消",
  timeout: "超时",
  indeterminate: "结果未定",
  unknown: "未知"
};

/**
 * 八桶配色。用语义色板，**不新增视觉模式**（Design System §01-foundations-color）。
 * 注意：`succeeded` 只表示执行轴，**不代表**关联或覆盖也是绿色 —— 三轴各自成徽章。
 */
export const PRIMARY_STATUS_PALETTE: Record<AuditPrimaryStatus, string> = {
  succeeded: "pl-status-done",
  failed: "pl-status-validation_failed",
  denied: "pl-status-partial",
  budget_stopped: "pl-status-partial",
  cancelled: "pl-status-neutral",
  timeout: "pl-status-partial",
  indeterminate: "pl-status-neutral",
  unknown: "pl-status-neutral"
};

/**
 * 旧三桶 outcome 标签。**只作 legacy 直方图**，不作为执行状态展示
 * （B27：旧 outcome 不提供任何闭合凭据）。
 */
export const LEGACY_OUTCOME_LABELS: Record<string, string> = {
  ok: "旧：成功",
  error: "旧：错误",
  denied: "旧：拒绝"
};

export function isAuditPrimaryStatus(value: unknown): value is AuditPrimaryStatus {
  return typeof value === "string" && (PRIMARY_STATUS_ORDER as readonly string[]).includes(value);
}

/** 主状态 → 展示标签；非法值一律显示「未知」，不显示原始字面量。 */
export function primaryStatusLabel(value: unknown): string {
  return isAuditPrimaryStatus(value) ? PRIMARY_STATUS_LABELS[value] : PRIMARY_STATUS_LABELS.unknown;
}

export function primaryStatusPalette(value: unknown): string {
  return isAuditPrimaryStatus(value) ? PRIMARY_STATUS_PALETTE[value] : PRIMARY_STATUS_PALETTE.unknown;
}

// ─── 三轴映射 ───────────────────────────────────────────────────────────────

/**
 * 执行轴。
 *
 * 直接读后端归一化后的 `execution_status`；缺失时**从主状态映射**（主状态本身
 * 就是执行轴 + 授权轴 + 冲突判定的派生结果，映射是保守的：未知 → 未知）。
 */
export function executionAxisFrom(entry: {
  executionStatus?: AuditExecutionStatus | string | null;
  primaryStatus?: AuditPrimaryStatus | string | null;
}): ExecutionAxis {
  const explicit = entry.executionStatus;
  if (
    explicit === "succeeded"
    || explicit === "failed"
    || explicit === "not_executed"
    || explicit === "interrupted"
    || explicit === "unknown"
  ) {
    return explicit;
  }
  switch (entry.primaryStatus) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "denied":
    case "budget_stopped":
    case "cancelled":
      return "not_executed";
    case "timeout":
      return "interrupted";
    default:
      return "unknown";
  }
}

/** 关联轴：后端已归一化为五态；非法值 → `legacy_unverified`（无证据 ≠ 无归属）。 */
export function associationAxisFrom(status: unknown): AssociationAxis {
  if (
    status === "confirmed"
    || status === "candidate"
    || status === "unassigned"
    || status === "conflict"
    || status === "legacy_unverified"
  ) {
    return status;
  }
  return "legacy_unverified";
}

/**
 * 覆盖轴：受控客户端是否就本次调用上报过 observation 事件。
 *
 * - 有客户端上报证据 → `observed`（可显示「客户端已采集」）。
 * - 无证据 → `unknown`（显示「后续动作不可见」）。
 *
 * **禁止**显示「未外发」（20261019 §5 / Plan §4 T05）。也**不得**因为
 * 「客户端看起来是某家族」就写「身份已验证」——User-Agent 不是身份凭据。
 */
export function coverageAxisFrom(entry: {
  clientEventId?: string | null;
  ingressEventId?: string | null;
}): CoverageAxis {
  return entry.clientEventId || entry.ingressEventId ? "observed" : "unknown";
}

/** 授权轴是否成立「允许」；未评估 / 未知都**不是**允许。 */
export function authorizationAllowed(status: unknown): status is AuditAuthorizationStatus {
  return status === "allowed";
}

// ─── SQL 结果规模（ReadonlySqlRowset）───────────────────────────────────────

/**
 * 由「是否采到值 + 空值原因」推导 `ReadonlySqlRowset` 的状态。
 *
 * 关键纪律（20261019 §4.4 / U2）：**未知不得写成 0**。
 * - 没有值 + 原因合法 → 用原因（`not_collected` / `redacted` / …）。
 * - 没有值 + 原因缺失或非法 → `unknown`（**不得**推定为 `not_collected`）。
 * - 有值 → `not_applicable`（该维度不适用缺值原因）。
 */
export function sqlRowsetStatusFrom(
  present: boolean,
  nullReason?: AuditNullReason | string | null
): ReadonlySqlRowsetStatus {
  if (present) return "not_applicable";
  if (
    nullReason === "not_applicable"
    || nullReason === "not_collected"
    || nullReason === "redacted"
    || nullReason === "parse_failed"
    || nullReason === "unknown"
    || nullReason === "not_supported"
  ) {
    return nullReason;
  }
  return "unknown";
}
