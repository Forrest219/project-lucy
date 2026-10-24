/**
 * Lucy v0.25 — P0-4 审计只读对账展示：统一对账上下文（Spec §3.1 / §5）。
 *
 * Authority:
 *   - docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md §2 / §3.1 / §5
 *   - docs/specs/lucy-20261020-v2p5-audit-increment-spec.md §8（S05）、§12.5（账本上界）
 *
 * 本模块只做三件事：
 *   1. 冻结 `reconciliationContext`（同一次查询的明细、汇总、CSV 共用同一份）；
 *   2. 提供 `watermarkSeq` 的**唯一正确来源**——canonical ledger 的已提交上界
 *      （`security/store.ts` `maxEventSeq()`），**绝不取投影自身序号**
 *      （`admin/audit-export-v2.ts:196` 的 `SELECT IFNULL(MAX(id),0) FROM access_log`
 *      是已知错误实现，见实施计划 N13）；
 *   3. 提供投影追平闸门（E3）：`waitUntilProjectionCovers(S, deadline=60s)`。
 *
 * 只读边界：本模块不写审计事实源、不改 ACL／预算／数据面、不新增预算或配额语义。
 */

import type Database from "better-sqlite3";
import { runProjection, projectionStatus, type ProjectionStatus } from "../security/projector.js";
import type { SecurityStore } from "../security/store.js";
import { sha256Hex, stableJson } from "../config-digest.js";
import type { NullReason } from "../proxy/audit-null-reasons.js";
import type { AuditCoverageReport, MetricUnit as S05MetricUnit } from "../proxy/audit-reconcile.js";

/**
 * 空值原因（Spec §2.6 / 术语标准 §4.7.2）。
 *
 * 六值枚举的唯一真源是 P0-1 的 `server/proxy/audit-null-reasons.ts`（U2 冻结）；
 * 本模块**只做 re-export**，不维护第二份枚举。
 */
export type { NullReason };
export { NULL_REASON_VALUES as RECONCILIATION_NULL_REASONS } from "../proxy/audit-null-reasons.js";

/** Spec §3.1 —— 对账上下文版本号。 */
export const RECONCILIATION_SCHEMA_VERSION = "audit-reconciliation-view/v1";
/** Spec §2.1 —— 事实分类规则版本（L25-09 S01/S05 冻结值）。 */
export const RECONCILIATION_CLASSIFICATION_VERSION = "v2p5-1";
/** Spec §2.1 —— 主状态派生规则版本（L25-09 §4.3 冻结值）。 */
export const RECONCILIATION_DERIVATION_VERSION = "v2p5-1";
/**
 * 本视图对「已登记／候选／未归属」关联的解释契约版本。
 * 注意：这**不是**写入时使用的归属规则版本——后者按行保留在
 * `access_log.attribution_rule_version` 列，本视图不改写、不重新归因。
 */
export const RECONCILIATION_ATTRIBUTION_RULE_VERSION = "audit-reconciliation-attribution/v1";
/** 问询预算规则版本：Spec 162（20 次数据工具 / 120 秒墙钟）语义，只读引用。 */
export const RECONCILIATION_BUDGET_RULE_VERSION = "spec-162-question-budget/v1";
/** 与既有审计导出保持同一时区口径。 */
export const RECONCILIATION_TIMEZONE = "Asia/Shanghai";
/** 默认窗口（小时），与 `admin/metric-window.ts` 的 7 天窗口一致。 */
export const RECONCILIATION_DEFAULT_WINDOW_HOURS = 168;
/** E3：投影追平时限（毫秒）。与 L25-09 U6 / §12.5 的 T3=60s 一致。 */
export const RECONCILIATION_PROJECTION_DEADLINE_MS = 60_000;
/** 追平轮询间隔（毫秒）。 */
export const RECONCILIATION_PROJECTION_POLL_MS = 250;

/**
 * 六值空值原因（Spec §2.6 / 术语标准 §4.7.2）。
 *
 * ⚠️ P0-1 正在建立共享枚举 `webui/server/proxy/audit-null-reasons.ts`。
 * 该文件落地后，父会话应把本定义替换为对共享枚举的 import（值域完全相同），
 * 避免出现两份同值枚举。本文件是 P0-1 落地前的临时本地定义。
 */
export type MetricUnit =
  | "tool_call"
  | "attempt"
  | "inquiry"
  | "protocol_request"
  | "display_group";

export const RECONCILIATION_METRIC_UNITS: readonly MetricUnit[] = [
  "tool_call",
  "attempt",
  "inquiry",
  "protocol_request",
  "display_group"
];

/**
 * 显示名 → S05 口径单位名的唯一映射。
 *
 * P0-4 Spec §3.1 的 `metricUnit` 枚举用 `attempt` / `inquiry`，
 * 而 L25-09 S05（`proxy/audit-reconcile.ts` `METRIC_UNITS`）用
 * `execution_attempt` / `registered_inquiry`。两者是同一计量单位、不同拼写；
 * 本表是**唯一**转换点，避免出现第二套单位词汇。
 * （已列入「需要回写 Spec 的偏差清单」供父会话处置。）
 */
export const S05_UNIT_BY_DISPLAY_UNIT: Record<MetricUnit, S05MetricUnit> = {
  tool_call: "tool_call",
  attempt: "execution_attempt",
  inquiry: "registered_inquiry",
  protocol_request: "protocol_request",
  display_group: "display_group"
};

/** Spec §3.1 —— 服务端规范化后的完整筛选。 */
export type ReconciliationFilter = {
  user: string | null;
  tokenHashPrefix: string | null;
  tool: string | null;
  outcome: string | null;
  sessionId: string | null;
  turnId: string | null;
  platform: string | null;
  since: string | null;
  until: string | null;
  /** 协议事件是否纳入（默认否：业务问询分母不含握手）。 */
  includeProtocol: boolean;
};

export type ReconciliationFilterInput = {
  user?: string | undefined;
  tokenHashPrefix?: string | undefined;
  tool?: string | undefined;
  outcome?: string | undefined;
  sessionId?: string | undefined;
  turnId?: string | undefined;
  platform?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  includeProtocol?: string | undefined;
};

function trimmedOrNull(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 规范化筛选：缺失值一律显式为 `null`，不静默丢弃字段。 */
export function normalizeReconciliationFilter(
  input: ReconciliationFilterInput = {}
): ReconciliationFilter {
  return {
    user: trimmedOrNull(input.user),
    tokenHashPrefix: trimmedOrNull(input.tokenHashPrefix),
    tool: trimmedOrNull(input.tool),
    outcome: trimmedOrNull(input.outcome),
    sessionId: trimmedOrNull(input.sessionId),
    turnId: trimmedOrNull(input.turnId),
    platform: trimmedOrNull(input.platform),
    since: trimmedOrNull(input.since),
    until: trimmedOrNull(input.until),
    includeProtocol: input.includeProtocol === "true" || input.includeProtocol === "1"
  };
}

/** Spec §3.1 —— 统一时间窗。 */
export type ReconciliationTimeRange = {
  from: string;
  to: string;
  timezone: string;
};

/**
 * 构造统一时间窗。`since`/`until` 缺省时回落到默认窗口（以 `now` 为右端）。
 * 区间语义：左闭右开 `[from, to)`（与 `admin/metric-window.ts` 一致）。
 */
export function buildReconciliationTimeRange(
  filter: ReconciliationFilter,
  now: number = Date.now(),
  defaultWindowHours: number = RECONCILIATION_DEFAULT_WINDOW_HOURS
): ReconciliationTimeRange {
  const to = filter.until ?? new Date(now).toISOString();
  const from =
    filter.since ?? new Date(now - defaultWindowHours * 60 * 60 * 1000).toISOString();
  return { from, to, timezone: RECONCILIATION_TIMEZONE };
}

/** 20261019 §6 四子域之一 + 旧 complete 语义（Spec §3.1 保留旧 complete 与四子域）。 */
export type CompletenessSubDomain = {
  ok: boolean;
  reason: string | null;
};

export type AssociationQualityCounts = {
  confirmed: number;
  candidate: number;
  unassigned: number;
  conflict: number;
  legacy_unverified: number;
};

export type Completeness = {
  /** 旧 complete 语义保持原定义（不由本页近似替换）。 */
  complete: boolean;
  /** 旧 combined_complete 语义保持原定义。 */
  combined_complete: boolean;
  dataScope: CompletenessSubDomain;
  associationQuality: AssociationQualityCounts;
  clientCoverage: {
    observed: boolean;
    gapWindows: Array<{ from: string; to: string }>;
    unknownReason: string | null;
  };
  integrityVerification: {
    fileHashOk: boolean;
    relationCheckOk: boolean;
  };
  /** 诊断性不完整原因（正式模式下非空即表示不可作为完整结论）。 */
  reasons: string[];
};

/**
 * L25-09 §8.2(b) 六项 auditCoverage 检查——**由 S05 summarize 提供，本页不重算**。
 *
 * 直接复用 P0-1 的 `AuditCoverageReport`（`proxy/audit-reconcile.ts`），
 * 不在本模块另立一套 coverage 词汇。
 */
export type AuditCoverage = AuditCoverageReport;

/** Spec §3.1 —— 统一对账上下文。 */
export type ReconciliationContext = {
  schemaVersion: typeof RECONCILIATION_SCHEMA_VERSION;
  instanceId: string;
  filter: ReconciliationFilter;
  timeRange: ReconciliationTimeRange;
  /** 账本已提交上界 S（来自 canonical ledger，绝不取投影自身序号）。 */
  watermarkSeq: number;
  /** 冻结快照标识。 */
  snapshotId: string;
  metricUnit: MetricUnit;
  /**
   * S05 口径单位名 —— P0-1 `summarize(unit, filter, S, ...)` 的入参。
   * 由 `metricUnit` 经唯一映射表得出，避免调用方各自拼写。
   */
  s05MetricUnit: S05MetricUnit;
  classificationVersion: string;
  derivationVersion: string;
  attributionRuleVersion: string;
  budgetRuleVersion: string;
  generatedAt: string;
  completeness: Completeness;
  auditCoverage: AuditCoverage;
  /**
   * 投影行上界（`access_log.id` 的最大值）。
   *
   * ⚠️ `access_log` 行**不携带账本 seq**，因此「行级 as-of S 截断」在当前数据模型下
   * 无法实现（L25-09 实施计划 N18 / 缺陷 E-9：投影只保留最新状态）。本字段是
   * 投影内的行集合上界，**不得**当作 `watermarkSeq` 使用；它只用于让同一轮分页
   * 与导出读到同一批行（刷新时新行 id 更大，自然被排除）。
   */
  rowBoundAccessLogId: number;
};

export type CreateReconciliationContextInput = {
  instanceId: string;
  filter: ReconciliationFilter;
  timeRange: ReconciliationTimeRange;
  watermarkSeq: number;
  snapshotId: string;
  rowBoundAccessLogId: number;
  metricUnit: MetricUnit;
  completeness: Completeness;
  auditCoverage: AuditCoverage;
  classificationVersion?: string;
  derivationVersion?: string;
  attributionRuleVersion?: string;
  budgetRuleVersion?: string;
  generatedAt?: string;
};

/**
 * 冻结对账上下文。冻结后的对象不可变（`Object.freeze`），
 * 保证同一次查询的明细、汇总、CSV 使用同一份筛选／S／快照／规则版本。
 */
export function createReconciliationContext(
  input: CreateReconciliationContextInput
): ReconciliationContext {
  const context: ReconciliationContext = {
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    instanceId: input.instanceId,
    filter: Object.freeze({ ...input.filter }),
    timeRange: Object.freeze({ ...input.timeRange }),
    watermarkSeq: input.watermarkSeq,
    snapshotId: input.snapshotId,
    metricUnit: input.metricUnit,
    s05MetricUnit: S05_UNIT_BY_DISPLAY_UNIT[input.metricUnit],
    classificationVersion: input.classificationVersion ?? RECONCILIATION_CLASSIFICATION_VERSION,
    derivationVersion: input.derivationVersion ?? RECONCILIATION_DERIVATION_VERSION,
    attributionRuleVersion:
      input.attributionRuleVersion ?? RECONCILIATION_ATTRIBUTION_RULE_VERSION,
    budgetRuleVersion: input.budgetRuleVersion ?? RECONCILIATION_BUDGET_RULE_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    completeness: Object.freeze({ ...input.completeness }),
    auditCoverage: Object.freeze({ ...input.auditCoverage }),
    rowBoundAccessLogId: input.rowBoundAccessLogId
  };
  return Object.freeze(context);
}

/**
 * 取账本已提交上界 S。
 *
 * 唯一正确来源是 canonical ledger（`security/store.ts` `maxEventSeq()`）。
 * 账本不可用时**失败关闭**：返回结构化失败，调用方不得用投影自身序号兜底。
 */
export function captureLedgerWatermarkSeq(
  store: SecurityStore
): { ok: true; watermarkSeq: number } | { ok: false; reason: string; message: string } {
  const max = store.maxEventSeq();
  if (!max.ok) {
    return {
      ok: false,
      reason: "security_store_unavailable",
      message: max.message || "security ledger unavailable"
    };
  }
  return { ok: true, watermarkSeq: max.value };
}

/**
 * 计算快照标识。
 *
 * 快照标识 = 账本上界 S + 规范化筛选摘要 + 投影行上界 + 命中行数的稳定摘要。
 * 它标识「这一轮读的是哪一批行」，**不是**防篡改签名（术语标准禁止此类宣称）。
 */
export function computeReconciliationSnapshotId(input: {
  watermarkSeq: number;
  filter: ReconciliationFilter;
  rowBoundAccessLogId: number;
  matchedRowCount: number;
  configVersion?: string | null;
}): string {
  return sha256Hex(
    stableJson({
      schemaVersion: RECONCILIATION_SCHEMA_VERSION,
      watermarkSeq: input.watermarkSeq,
      filter: input.filter,
      rowBoundAccessLogId: input.rowBoundAccessLogId,
      matchedRowCount: input.matchedRowCount,
      configVersion: input.configVersion ?? null
    })
  );
}

/**
 * 在冻结的一致读快照内执行读取。
 *
 * better-sqlite3 的事务是同步的：整个读取过程在一个读事务内完成，
 * 因此明细、汇总、CSV 看到的是同一批行（后续写入不会混入本轮）。
 */
export function withFrozenAuditSnapshot<T>(db: Database.Database, fn: () => T): T {
  if (db.inTransaction) return fn();
  const wrapped = db.transaction(fn) as () => T;
  return wrapped();
}

export type ProjectionCoverageReason =
  | "covered"
  | "deadline_exceeded"
  | "store_unavailable"
  | "projection_failed";

export type ProjectionCoverageResult = {
  covered: boolean;
  reason: ProjectionCoverageReason;
  watermarkSeq: number;
  cursor: number;
  latestSeq: number;
  lag: number;
  waitedMs: number;
  status: ProjectionStatus;
};

/**
 * E3 —— 等待投影追平到账本上界 S。
 *
 * 语义（Spec §5 / §12.5）：
 *   - 追平时限自捕获 S 起算，默认 60s，等待与重试不重置时限；
 *   - 追平失败**不得**静默改用较新数据：调用方据此让正式模式失败，
 *     或显式标为诊断性不完整；
 *   - 投影落后时 `cursor < S` 即判定未覆盖（`projectionStatus().complete` 只反映
 *     「是否已追到当前最新 seq」，不是「是否覆盖了本轮捕获的 S」）。
 */
export async function waitUntilProjectionCovers(input: {
  store: SecurityStore;
  target: Database.Database;
  watermarkSeq: number;
  deadlineMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onAttempt?: (status: ProjectionStatus) => void;
}): Promise<ProjectionCoverageResult> {
  const now = input.now ?? (() => Date.now());
  const deadlineMs = input.deadlineMs ?? RECONCILIATION_PROJECTION_DEADLINE_MS;
  const pollIntervalMs = input.pollIntervalMs ?? RECONCILIATION_PROJECTION_POLL_MS;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const startedAt = now();
  const deadlineAt = startedAt + deadlineMs;

  let lastStatus: ProjectionStatus = projectionStatus(input.store, input.target, now);

  for (;;) {
    if (lastStatus.reason === "security_store_unavailable") {
      return {
        covered: false,
        reason: "store_unavailable",
        watermarkSeq: input.watermarkSeq,
        cursor: lastStatus.cursor,
        latestSeq: lastStatus.latestSeq,
        lag: lastStatus.lag,
        waitedMs: now() - startedAt,
        status: lastStatus
      };
    }

    // 追平：把账本事件投影进审计库（与 `admin/audit.ts` 读路径同一模式）。
    if (lastStatus.cursor < input.watermarkSeq) {
      try {
        runProjection(input.store, input.target);
      } catch {
        lastStatus = {
          ...lastStatus,
          complete: false,
          reason: "projection_failed"
        };
        return {
          covered: false,
          reason: "projection_failed",
          watermarkSeq: input.watermarkSeq,
          cursor: lastStatus.cursor,
          latestSeq: lastStatus.latestSeq,
          lag: lastStatus.lag,
          waitedMs: now() - startedAt,
          status: lastStatus
        };
      }
      lastStatus = projectionStatus(input.store, input.target, now);
    }

    input.onAttempt?.(lastStatus);

    if (lastStatus.cursor >= input.watermarkSeq) {
      return {
        covered: true,
        reason: "covered",
        watermarkSeq: input.watermarkSeq,
        cursor: lastStatus.cursor,
        latestSeq: lastStatus.latestSeq,
        lag: lastStatus.lag,
        waitedMs: now() - startedAt,
        status: lastStatus
      };
    }

    if (now() >= deadlineAt) {
      return {
        covered: false,
        reason: "deadline_exceeded",
        watermarkSeq: input.watermarkSeq,
        cursor: lastStatus.cursor,
        latestSeq: lastStatus.latestSeq,
        lag: lastStatus.lag,
        waitedMs: now() - startedAt,
        status: lastStatus
      };
    }

    await sleep(pollIntervalMs);
  }
}
