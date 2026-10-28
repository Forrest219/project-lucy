/**
 * P0-4（L25-02/L25-03）只读对账视图的**前端类型与口径**。
 *
 * 值域的唯一真源在后端：
 *   - `webui/server/admin/reconciliation.ts`（TokenReconciliation / 差异集合）
 *   - `webui/server/admin/reconciliation-context.ts`（ReconciliationContext）
 *   - `webui/server/proxy/audit-null-reasons.ts`（六值空值原因）
 * 本文件只做**消费**与展示口径，不重新定义任何值域。
 *
 * 关键纪律（Spec §2.4 / §2.6 / §4.4）：
 *   - `count === null` = **不可观测**，不是 0；
 *   - 空值、0 与未知**不得混用**；
 *   - 「活跃数 > 配置数」**不自动等于数据异常** —— 只有身份、窗口与快照
 *     口径一致且仍存在额外／冲突集合时才标记对账失败。
 */

export type ReconciliationDifferenceId =
  | "configured_not_active"
  | "active_not_in_current_config"
  | "disabled_or_deleted"
  | "identity_unverified";

export type ReconciliationDifferenceSet = {
  id: ReconciliationDifferenceId;
  label: string;
  /** null = 不可观测（不是 0）。 */
  count: number | null;
  /** count 为 null 时的六值空值原因；可观测时为 null。 */
  nullReason: string | null;
  identities: string[];
  reasons: string[];
  evidenceRefs: string[];
};

export type ReconciliationConfiguredSnapshot = {
  capturedAt: string;
  configVersion: string | null;
  /** false = 读不到配置；此时下面的计数都是 null（不可观测），不是 0。 */
  available: boolean;
  unavailableReason: string | null;
  total: number | null;
  enabled: number | null;
  disabled: number | null;
  expired: number | null;
  identityAmbiguity: boolean;
};

export type ReconciliationActiveWindow = {
  from: string;
  to: string;
  timezone: string;
  metricUnit: string;
  eventScope: string;
  protocolEventsExcluded: number;
  identityCount: number;
  toolCallCount: number;
};

export type ReconciliationTokenReconciliation = {
  configuredSnapshot: ReconciliationConfiguredSnapshot;
  activeWindow: ReconciliationActiveWindow;
  unknownIdentity: {
    count: number;
    reasons: Array<{
      reason: string;
      callCount: number;
      distinctRequestIds: number;
      lastSeenAt: string | null;
    }>;
  };
  differences: ReconciliationDifferenceSet[];
  anomaly: {
    flagged: boolean;
    reason: string;
    activeGreaterThanConfigured: boolean;
  };
  completeness: {
    /** 比率同时给出 N／D；D=0 或不可观测不得显示 0% / 100%。 */
    numerator: number | null;
    denominator: number | null;
    ratio: number | null;
    ratioNullReason: string | null;
  };
};

export type ReconciliationUsageRow = {
  unitId: string;
  ts: string;
  tool: string;
  turnId: string | null;
  tokenIdentity: string | null;
  tokenIdentityKind: "hash_prefix" | "credential_principal_id" | null;
  protocol: boolean;
};

export type ReconciliationAsOfProof = {
  ok: boolean;
  actualBound?: unknown;
  missingSets?: Record<string, unknown>;
  reason?: string | null;
};

export type ReconciliationUsageResponse = {
  reconciliationContext: {
    instanceId: string;
    watermarkSeq: number;
    snapshotId: string;
    generatedAt: string;
    metricUnit: string;
    classificationVersion: string;
    derivationVersion: string;
    attributionRuleVersion: string;
    budgetRuleVersion: string;
  };
  projectionCoverage: unknown;
  asOfProof: ReconciliationAsOfProof;
  diagnosticIncomplete: unknown;
  tokenReconciliation: ReconciliationTokenReconciliation;
  /** 完整使用明细（分页游标）。 */
  calls: {
    items: ReconciliationUsageRow[];
    nextCursor: string | null;
    complete: boolean;
    totalMatched: number;
    returned: number;
  };
};

export type ReconciliationExportResponse = {
  reconciliationContext: ReconciliationUsageResponse["reconciliationContext"];
  asOfProof: ReconciliationAsOfProof;
  diagnosticIncomplete: unknown;
  tokenReconciliation: ReconciliationTokenReconciliation;
  files: Array<{ name: string; rowCount: number; sha256: string; csv: string }>;
  manifest: unknown;
};

/** 四类差异集合的展示顺序与中文标签（口径与后端 id 一一对应）。 */
export const RECONCILIATION_DIFFERENCE_ORDER: readonly ReconciliationDifferenceId[] = [
  "configured_not_active",
  "active_not_in_current_config",
  "disabled_or_deleted",
  "identity_unverified"
];

export const RECONCILIATION_DIFFERENCE_LABELS: Record<ReconciliationDifferenceId, string> = {
  configured_not_active: "已配置未活跃",
  active_not_in_current_config: "活跃但当前配置不可见",
  disabled_or_deleted: "已停用或已删除",
  identity_unverified: "身份未核验"
};

/** 不可观测的规模显示「不可观测」+ 原因，**不得**显示 0。 */
export function formatReconciliationCount(
  count: number | null,
  nullReason?: string | null
): { text: string; observable: boolean } {
  if (count !== null) return { text: String(count), observable: true };
  const reason = nullReason ?? "unknown";
  const reasonText =
    reason === "not_collected"
      ? "未采集"
      : reason === "not_applicable"
        ? "不适用"
        : reason === "redacted"
          ? "已脱敏"
          : reason === "parse_failed"
            ? "解析失败"
            : reason === "not_supported"
              ? "不支持"
              : "未知";
  return { text: `不可观测（${reasonText}）`, observable: false };
}

/** 比率：分母不可观测或为 0 时**不得**显示 0% / 100%。 */
export function formatReconciliationRatio(
  ratio: number | null,
  denominator: number | null,
  nullReason?: string | null
): string {
  if (ratio === null || denominator === null || denominator === 0) {
    const reasonText = nullReason === "not_collected" ? "未采集" : "不可观测";
    return `${reasonText}`;
  }
  return `${(ratio * 100).toFixed(1)}%`;
}
