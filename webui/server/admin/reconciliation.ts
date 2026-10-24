/**
 * Lucy v0.25 — P0-4 审计只读对账展示：问询详情（E4）与 Token 对账（E6）。
 *
 * Authority:
 *   - docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md §2 / §3.2 / §3.3 / §3.4
 *   - docs/specs/lucy-20261020-v2p5-audit-increment-spec.md §4.3、§8（S05）、§12.3
 *
 * 设计边界（重要）：
 *
 * 1. **不自建第二套口径。** 八桶「汇总主状态」、authorization / execution / delivery
 *    三视图与 S05「auditCoverage」六项检查的**权威生产者是 P0-1**（L25-09 S01/S05）。
 *    本模块只定义**依赖注入端口**（`PrimaryStatusPort` / `AuditCoveragePort`）并提供
 *    默认的「未接入」行为：未接入时相关字段一律 `unknown` + `null_reason=not_supported`，
 *    绝不臆造状态。见 §「端口（E1 接线点）」。
 *
 * 2. **不补造数据。** `access_log` 中 `attempt_id` / `event_type` /
 *    `credential_principal_id` / `association_status` 等列在生产上可能为 NULL 或
 *    整列缺失（L25-09 实施计划 N10：列已存在但 `writeLog` 未写入）。本模块对 NULL
 *    与缺列一律如实标注空值原因，不以 0 / false / 空数组冒充。
 *
 * 3. **集合闭合。** 每个纳入集合的对象有且仅有一个主状态；八桶合计等于集合总数。
 *    闭合校验在本模块内完成（派生在 P0-1 端口内完成）。
 *
 * 4. **只读。** 本模块不写审计事实源、不改 ACL / 预算 / 数据面、不新增预算或配额语义。
 */

import type Database from "better-sqlite3";
import { MCP_PROTOCOL_METHODS } from "../proxy/mcp-request-classification.js";
import { isQuestionDataTool } from "../proxy/question-experience.js";
import type { AssociationStatus } from "../proxy/turn-correlation.js";
import {
  AUDIT_COVERAGE_CHECKS,
  COVERAGE_CHECK_TITLES
} from "../proxy/audit-reconcile.js";
import {
  RECONCILIATION_BUDGET_RULE_VERSION,
  type AuditCoverage,
  type MetricUnit,
  type NullReason,
  type ReconciliationContext
} from "./reconciliation-context.js";

/** Spec §2.1 —— 八桶汇总主状态。 */
export type PrimaryStatusBucket =
  | "succeeded"
  | "failed"
  | "denied"
  | "budget_stopped"
  | "cancelled"
  | "timeout"
  | "indeterminate"
  | "unknown";

export const PRIMARY_STATUS_BUCKETS: readonly PrimaryStatusBucket[] = [
  "succeeded",
  "failed",
  "denied",
  "budget_stopped",
  "cancelled",
  "timeout",
  "indeterminate",
  "unknown"
];

/** L25-09 §4.3(b) —— 三视图取值。 */
export type AuthorizationStatus = "allowed" | "denied" | "not_evaluated" | "unknown";
export type ExecutionStatus = "succeeded" | "failed" | "not_executed" | "interrupted" | "unknown";
export type DeliveryStatus = "prepared" | "sent" | "acknowledged" | "unknown";

// ────────────────────────────────────────────────────────────────────────────
// 端口（E1 接线点）—— 由父会话在 P0-1 落地后注入
// ────────────────────────────────────────────────────────────────────────────

export type ReconciliationFacts = {
  primaryStatus: PrimaryStatusBucket;
  conflict: boolean;
  authorization: AuthorizationStatus;
  execution: ExecutionStatus;
  delivery: DeliveryStatus;
  /** 原始事件引用（审计事件 ID / access_log id 等）。 */
  evidenceRefs: string[];
  /** 分轴空值原因（未接入或无法核验时给出）。 */
  nullReasons: {
    primaryStatus?: NullReason;
    authorization?: NullReason;
    execution?: NullReason;
    delivery?: NullReason;
  };
};

export type ReconciliationUnit = {
  /** 计量单元标识（tool_call 单位下为 access_log id）。 */
  unitId: string;
  unitKind: MetricUnit;
  ts: string;
  tool: string;
  requestId: string;
  turnId: string | null;
  attemptId: string | null;
  parentAttemptId: string | null;
  associationStatus: AssociationStatus;
  /** 旧 `outcome` —— **只作历史字段**，不替代主状态（Spec §2.1）。 */
  legacyOutcome: string | null;
  decisionReason: string | null;
  errorDetail: string | null;
  responseRowCount: number | null;
  durationMs: number | null;
  turnWallClockMs: number | null;
  /**
   * The L25-09-derived columns of the underlying audit row.
   *
   * The reconciliation view does NOT derive the primary status itself: it
   * reads the value L25-09 S01 already wrote on the row, so the view and the
   * audit list can never disagree about a call's bucket. A NULL column stays
   * NULL here and is reported as `unknown` with a null reason.
   */
  primaryStatusColumn?: string | null;
  authorizationViewColumn?: string | null;
  executionViewColumn?: string | null;
  deliveryStatusColumn?: string | null;
};

export type PrimaryStatusPort = {
  connected: boolean;
  derive(unit: ReconciliationUnit, context: ReconciliationContext): ReconciliationFacts;
};

export type AuditCoveragePort = {
  connected: boolean;
  summarizeCoverage(
    context: ReconciliationContext,
    scope: { units: readonly ReconciliationUnit[] }
  ): AuditCoverage;
};

/** 未接入时的默认事实：全部 `unknown` + `not_supported`。 */
function unconnectedFacts(): ReconciliationFacts {
  return {
    primaryStatus: "unknown",
    conflict: false,
    authorization: "unknown",
    execution: "unknown",
    delivery: "unknown",
    evidenceRefs: [],
    nullReasons: {
      primaryStatus: "not_supported",
      authorization: "not_supported",
      execution: "not_supported",
      delivery: "not_supported"
    }
  };
}

export const UNCONNECTED_PRIMARY_STATUS_PORT: PrimaryStatusPort = {
  connected: false,
  derive: () => unconnectedFacts()
};

/** 未接入时的默认 coverage：六项检查全部 `unknown`，分母为 null（不填 0）。 */
export const UNCONNECTED_AUDIT_COVERAGE_PORT: AuditCoveragePort = {
  connected: false,
  summarizeCoverage: (context) => ({
    version: "not_connected",
    seqUpperBound: context.watermarkSeq,
    checks: AUDIT_COVERAGE_CHECKS.map((id) => ({
      id,
      title: COVERAGE_CHECK_TITLES[id],
      status: "unknown" as const,
      numerator: 0,
      denominator: 0,
      unit: "protocol_request" as const,
      evidenceSource: "none",
      seqUpperBound: context.watermarkSeq,
      diffIds: [],
      reason: "coverage_source_not_connected",
      exclusions: []
    })),
    allConclusive: false,
    combined: "unknown" as const
  })
};

export type ReconciliationPorts = {
  primaryStatus: PrimaryStatusPort;
  auditCoverage: AuditCoveragePort;
};

let ports: ReconciliationPorts = {
  primaryStatus: UNCONNECTED_PRIMARY_STATUS_PORT,
  auditCoverage: UNCONNECTED_AUDIT_COVERAGE_PORT
};

/**
 * 注入 P0-1 的派生端口（父会话接线点，E1）。
 * 传入 `null` 表示回到「未接入」默认行为。
 */
export function configureReconciliationPorts(next: {
  primaryStatus?: PrimaryStatusPort | null;
  auditCoverage?: AuditCoveragePort | null;
}): void {
  ports = {
    primaryStatus: next.primaryStatus ?? UNCONNECTED_PRIMARY_STATUS_PORT,
    auditCoverage: next.auditCoverage ?? UNCONNECTED_AUDIT_COVERAGE_PORT
  };
}

export function getReconciliationPorts(): ReconciliationPorts {
  return ports;
}

export function resetReconciliationPortsForTests(): void {
  ports = {
    primaryStatus: UNCONNECTED_PRIMARY_STATUS_PORT,
    auditCoverage: UNCONNECTED_AUDIT_COVERAGE_PORT
  };
}

/**
 * E1 接线适配器 —— 把 P0-1 的 `derivePrimaryStatus` 接到本模块的端口上。
 *
 * ⚠️ **事实映射由调用方提供**（`factsOf`）。P0-1 的派生函数只接受**可核验事实**
 * （`budgetStopped` / `authorizationDenied` / `verifiedSuccess` …），
 * 而 `access_log` 行不携带这些凭据；把行映射成事实是 P0-1 的口径职责，
 * 本模块**不代做**（否则就是第二套口径）。
 *
 * 父会话接线方式：
 * ```ts
 * configureReconciliationPorts({
 *   primaryStatus: createPrimaryStatusPort((unit, ctx) =>
 *     derivePrimaryStatus(p0_1FactsFromAccessLogRow(unit))
 *   )
 * });
 * ```
 */
export function createPrimaryStatusPort(
  derive: (unit: ReconciliationUnit, context: ReconciliationContext) => ReconciliationFacts
): PrimaryStatusPort {
  return { connected: true, derive };
}

// ────────────────────────────────────────────────────────────────────────────
// 数据库读取（只读；列或表缺失、值为 NULL 一律如实标注）
// ────────────────────────────────────────────────────────────────────────────

const PROTOCOL_TOOL_SET = new Set<string>(MCP_PROTOCOL_METHODS);

export function isProtocolTool(tool: string | null | undefined): boolean {
  return typeof tool === "string" && PROTOCOL_TOOL_SET.has(tool);
}

/** 探测表是否存在（缺表按「不可观测」处理，不抛错、不伪造）。 */
export function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

/** 探测表列是否可用（列存在 ≠ 有值；值为 NULL 另行标注）。 */
export function probeColumns(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  } catch {
    return new Set();
  }
}

type AccessLogRow = {
  id: number;
  ts: string;
  user_id: string;
  tool: string;
  request_id: string;
  outcome: string | null;
  decision_reason: string | null;
  error_detail: string | null;
  duration_ms: number | null;
  response_row_count: number | null;
  lucy_turn_id: string | null;
  lucy_session_id: string | null;
  lucy_platform: string | null;
  token_hash_prefix: string | null;
  attempt_id: string | null;
  parent_attempt_id: string | null;
  association_status: string | null;
  effective_turn_id: string | null;
  original_turn_id: string | null;
  event_type: string | null;
  credential_principal_id: string | null;
  turn_wall_clock_ms: number | null;
  /** L25-09 S01 derived columns (schema V3). NULL on rows written before the migration. */
  primary_status: string | null;
  authorization_view: string | null;
  execution_view: string | null;
  delivery_status: string | null;
};

const ACCESS_LOG_SELECT_COLUMNS = [
  "id",
  "ts",
  "user_id",
  "tool",
  "request_id",
  "outcome",
  "decision_reason",
  "error_detail",
  "duration_ms",
  "response_row_count",
  "lucy_turn_id",
  "lucy_session_id",
  "lucy_platform",
  "token_hash_prefix",
  "attempt_id",
  "parent_attempt_id",
  "association_status",
  "effective_turn_id",
  "original_turn_id",
  "event_type",
  "credential_principal_id",
  "turn_wall_clock_ms",
  "primary_status",
  "authorization_view",
  "execution_view",
  "delivery_status"
] as const;

export type AccessLogSelection = {
  columns: Set<string>;
  rows: AccessLogRow[];
};

export function selectAccessLogRows(
  db: Database.Database,
  options: { where: string; params: readonly unknown[]; rowBound: number }
): AccessLogSelection {
  const columns = probeColumns(db, "access_log");
  if (!columns.has("id")) return { columns, rows: [] };
  const projection = ACCESS_LOG_SELECT_COLUMNS.map((column) =>
    columns.has(column) ? column : `NULL AS ${column}`
  ).join(", ");
  const sql = `SELECT ${projection} FROM access_log WHERE (${options.where}) AND id <= ? ORDER BY ts ASC, id ASC`;
  const rows = db.prepare(sql).all(...options.params, options.rowBound) as AccessLogRow[];
  return { columns, rows };
}

function associationOf(row: AccessLogRow): AssociationStatus {
  const value = row.association_status;
  if (
    value === "confirmed" ||
    value === "candidate" ||
    value === "unassigned" ||
    value === "conflict" ||
    value === "legacy_unverified"
  ) {
    return value;
  }
  // NULL 或未知值：不冒充 confirmed，按「归属待核验」处理。
  return "legacy_unverified";
}

export function toReconciliationUnit(row: AccessLogRow): ReconciliationUnit {
  return {
    unitId: String(row.id),
    unitKind: isProtocolTool(row.tool) ? "protocol_request" : "tool_call",
    ts: row.ts,
    tool: row.tool,
    requestId: row.request_id,
    turnId: row.effective_turn_id ?? row.lucy_turn_id ?? null,
    attemptId: row.attempt_id ?? null,
    parentAttemptId: row.parent_attempt_id ?? null,
    associationStatus: associationOf(row),
    legacyOutcome: row.outcome ?? null,
    decisionReason: row.decision_reason ?? null,
    errorDetail: row.error_detail ?? null,
    responseRowCount: row.response_row_count ?? null,
    durationMs: row.duration_ms ?? null,
    turnWallClockMs: row.turn_wall_clock_ms ?? null,
    // The L25-09-derived columns are carried through so the view can report
    // the SAME bucket the audit list reports for this row.
    primaryStatusColumn: row.primary_status ?? null,
    authorizationViewColumn: row.authorization_view ?? null,
    executionViewColumn: row.execution_view ?? null,
    deliveryStatusColumn: row.delivery_status ?? null
  };
}

// ────────────────────────────────────────────────────────────────────────────
// E4 —— 问询详情 InquiryReconciliation
// ────────────────────────────────────────────────────────────────────────────

export type TableEvidence = {
  /** 完整身份去重键：连接 / Schema / 表三元组（缺项时降级为可核验的最少组合）。 */
  identityKey: string;
  connectionId: string | null;
  schema: string | null;
  table: string | null;
  identityComplete: boolean;
  missingIdentityParts: string[];
  physicalTable: string | null;
  extractionMethod: string | null;
  confidence: string | null;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  callIds: string[];
  callCount: number;
  /** 来源状态（Spec §3.2）。 */
  sourceStatus: "resolved" | "identity_incomplete" | "unknown";
  sourceStatusNullReason: NullReason | null;
};

export type CallEvidence = {
  unitId: string;
  ts: string;
  tool: string;
  requestId: string;
  attemptId: string | null;
  attemptIdNullReason: NullReason | null;
  parentAttemptId: string | null;
  associationStatus: AssociationStatus;
  legacyOutcome: string | null;
  decisionReason: string | null;
  primaryStatus: PrimaryStatusBucket;
  primaryStatusNullReason: NullReason | null;
  authorization: AuthorizationStatus;
  execution: ExecutionStatus;
  delivery: DeliveryStatus;
  conflict: boolean;
  evidenceRefs: string[];
  sourceIdentityCount: number;
  /** 调用耗时；不可观测时为 null + 原因（不填 0）。 */
  durationMs: number | null;
  durationNullReason: NullReason | null;
};

export type InquiryReconciliation = {
  context: ReconciliationContext;
  inquiry: {
    turnId: string;
    /** 登记来源：用户原始问询 / 系统推断 / 未登记。 */
    registrationSource: "reported" | "inferred" | "unregistered";
    registrationSourceNullReason: NullReason | null;
    /** 原文可用性（不返回超授权原文本身）。 */
    originalTextAvailable: boolean;
    originalTextNullReason: NullReason | null;
    sessionId: string | null;
    displayGroupId: string | null;
    displayGroupKind: "inferred_group" | "none" | null;
    associationStatus: AssociationStatus;
    associationStatusNullReason: NullReason | null;
    /** 候选 turn 必须显式标识。 */
    candidateTurn: boolean;
  };
  calls: {
    unit: MetricUnit;
    total: number;
    confirmedCount: number;
    candidateCount: number;
    unassignedCount: number;
    conflictCount: number;
    legacyUnverifiedCount: number;
    /** 尝试数（独立 attemptId）；列缺或全 NULL 时为 null + 原因。 */
    attemptCount: number | null;
    attemptCountNullReason: NullReason | null;
    items: CallEvidence[];
  };
  tables: {
    /** 完整身份去重集合；同名不同连接 / Schema 不合并。 */
    complete: TableEvidence[];
    /** 缺表身份的调用进入独立未知桶（不按名称相似度合并）。 */
    unknownBucket: {
      callIds: string[];
      callCount: number;
      reason: NullReason;
      detail: string;
    };
  };
  turns: {
    registeredInquiryTurns: number;
    registeredInquiryTurnsNullReason: NullReason | null;
    observableClientTurns: number | null;
    observableClientTurnsNullReason: NullReason | null;
    unprovableTurnsReason: string;
    /** 明确声明：工具调用数不是用户轮次。 */
    toolCallCountIsNotUserTurns: true;
  };
  durations: {
    inquiryDurationMs: number | null;
    inquiryDurationNullReason: NullReason | null;
    callObservationSpanMs: number | null;
    callObservationSpanNullReason: NullReason | null;
    cumulativeToolDurationMs: number | null;
    cumulativeToolDurationNullReason: NullReason | null;
    maxCallDurationMs: number | null;
    maxCallDurationNullReason: NullReason | null;
  };
  budget: {
    ruleVersion: string;
    dataToolCallCount: number;
    wallClockMs: number | null;
    wallClockNullReason: NullReason | null;
    /** 只有真实 `budget_stopped` 凭据才为 true。 */
    exhausted: boolean;
    status: "budget_stopped" | "not_exhausted" | "unknown";
    statusNullReason: NullReason | null;
    terminationEventRefs: string[];
    /** 可继续语义：仅在有问询预算终止凭据时可判定。 */
    continuable: boolean | null;
    continuableNullReason: NullReason | null;
  };
  results: {
    primaryStatus: PrimaryStatusBucket;
    primaryStatusNullReason: NullReason | null;
    factsSource: "p0_1_derivation_port" | "not_connected";
    conflict: boolean;
    authorization: AuthorizationStatus;
    execution: ExecutionStatus;
    delivery: DeliveryStatus;
    deliveryNullReason: NullReason | null;
    /** 客户端后续动作可见性：无客户端证据时为 not_observable。 */
    clientFollowUpVisibility: "observable" | "not_observable";
    bucketCounts: Record<PrimaryStatusBucket, number>;
    bucketTotal: number;
    closureVerified: boolean;
    evidenceRefs: string[];
  };
  auditCoverage: AuditCoverage;
  differences: Array<{ id: string; detail: string; affectedCallIds: string[] }>;
  exclusions: Array<{ id: string; detail: string }>;
};

function emptyBucketCounts(): Record<PrimaryStatusBucket, number> {
  const counts = {} as Record<PrimaryStatusBucket, number>;
  for (const bucket of PRIMARY_STATUS_BUCKETS) counts[bucket] = 0;
  return counts;
}

function isoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 问询详情查询条件：登记 turn、修订后 turn、原始 turn、推断分组关联行。 */
function inquiryWhere(
  db: Database.Database,
  turnId: string,
  columns: Set<string>
): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (columns.has("lucy_turn_id")) {
    clauses.push("IFNULL(lucy_turn_id, '') = ?");
    params.push(turnId);
  }
  if (columns.has("effective_turn_id")) {
    clauses.push("IFNULL(effective_turn_id, '') = ?");
    params.push(turnId);
  }
  if (columns.has("original_turn_id")) {
    clauses.push("IFNULL(original_turn_id, '') = ?");
    params.push(turnId);
  }
  if (tableExists(db, "inferred_turn_access_logs")) {
    clauses.push(
      "id IN (SELECT access_log_id FROM inferred_turn_access_logs WHERE inferred_turn_id = ?)"
    );
    params.push(turnId);
  }
  if (clauses.length === 0) {
    // 没有可用于定位问询的列：返回空集（不猜、不跨表扫描）。
    return { where: "1 = 0", params: [] };
  }
  return { where: `(${clauses.join(" OR ")})`, params };
}

export type BuildInquiryReconciliationInput = {
  db: Database.Database;
  context: ReconciliationContext;
  turnId: string;
  /** 覆盖默认端口（测试或父会话显式注入）。 */
  ports?: ReconciliationPorts;
};

export function buildInquiryReconciliation(
  input: BuildInquiryReconciliationInput
): InquiryReconciliation {
  const activePorts = input.ports ?? ports;
  const { db, context } = input;
  const turnId = input.turnId;

  const columns = probeColumns(db, "access_log");
  const where = inquiryWhere(db, turnId, columns);
  const { rows } = selectAccessLogRows(db, {
    where: where.where,
    params: where.params,
    rowBound: context.rowBoundAccessLogId
  });
  const units = rows.map(toReconciliationUnit);

  const toolUnits = units.filter((unit) => unit.unitKind === "tool_call");
  const protocolUnits = units.filter((unit) => unit.unitKind === "protocol_request");

  // ── 调用与尝试 ────────────────────────────────────────────────────────────
  const sourceRows = readSourceRowsForCalls(db, rows.map((row) => row.id));
  const sourcesByCall = new Map<number, SourceRow[]>();
  for (const source of sourceRows) {
    const list = sourcesByCall.get(source.access_log_id);
    if (list) list.push(source);
    else sourcesByCall.set(source.access_log_id, [source]);
  }

  const callItems: CallEvidence[] = [];
  const bucketCounts = emptyBucketCounts();
  let conflict = false;
  const evidenceRefs: string[] = [];

  for (const unit of units) {
    const facts = activePorts.primaryStatus.derive(unit, context);
    // 集合闭合只按**声明的计量单位**（tool_call）统计；协议请求是另一个单位，
    // 不得混入工具调用桶（Spec §2.2：分别计数，不按生命周期账本行重复累计）。
    if (unit.unitKind === "tool_call") bucketCounts[facts.primaryStatus] += 1;
    if (facts.conflict) conflict = true;
    evidenceRefs.push(...facts.evidenceRefs);
    callItems.push({
      unitId: unit.unitId,
      ts: unit.ts,
      tool: unit.tool,
      requestId: unit.requestId,
      attemptId: unit.attemptId,
      attemptIdNullReason: unit.attemptId !== null ? null : "not_collected",
      parentAttemptId: unit.parentAttemptId,
      associationStatus: unit.associationStatus,
      legacyOutcome: unit.legacyOutcome,
      decisionReason: unit.decisionReason,
      primaryStatus: facts.primaryStatus,
      primaryStatusNullReason: facts.nullReasons.primaryStatus ?? null,
      authorization: facts.authorization,
      execution: facts.execution,
      delivery: facts.delivery,
      conflict: facts.conflict,
      evidenceRefs: facts.evidenceRefs,
      sourceIdentityCount: (sourcesByCall.get(Number(unit.unitId)) ?? []).length,
      durationMs: unit.durationMs,
      durationNullReason: unit.durationMs === null ? "not_collected" : null
    });
  }

  const distinctAttempts = new Set<string>(
    units.map((unit) => unit.attemptId).filter((value): value is string => Boolean(value))
  );
  const attemptsObservable = columns.has("attempt_id") && distinctAttempts.size > 0;

  // ── 完整表清单 ────────────────────────────────────────────────────────────
  const tableMap = new Map<string, TableEvidence>();
  const callsWithoutSource: string[] = [];
  for (const row of rows) {
    const sources = sourcesByCall.get(row.id) ?? [];
    if (sources.length === 0) {
      callsWithoutSource.push(String(row.id));
      continue;
    }
    for (const source of sources) {
      const missingParts: string[] = [];
      if (!source.connection_id) missingParts.push("connectionId");
      if (!source.schema_name) missingParts.push("schema");
      if (!source.source_name) missingParts.push("table");
      const identityComplete = missingParts.length === 0;
      const identityKey = identityComplete
        ? JSON.stringify([source.connection_id, source.schema_name, source.source_name])
        : JSON.stringify([
            source.connection_id ?? null,
            source.schema_name ?? null,
            source.source_name ?? null,
            source.physical_table ?? null
          ]);
      const observedAt = source.ts ?? row.ts;
      const existing = tableMap.get(identityKey);
      if (existing) {
        existing.callCount += 1;
        if (!existing.callIds.includes(String(row.id))) existing.callIds.push(String(row.id));
        const observed = isoMs(observedAt);
        const first = isoMs(existing.firstObservedAt);
        const last = isoMs(existing.lastObservedAt);
        if (observed !== null && (first === null || observed < first)) {
          existing.firstObservedAt = observedAt;
        }
        if (observed !== null && (last === null || observed > last)) {
          existing.lastObservedAt = observedAt;
        }
        continue;
      }
      tableMap.set(identityKey, {
        identityKey,
        connectionId: source.connection_id ?? null,
        schema: source.schema_name ?? null,
        table: source.source_name ?? null,
        identityComplete,
        missingIdentityParts: missingParts,
        physicalTable: source.physical_table ?? null,
        extractionMethod: source.extraction_method ?? null,
        confidence: source.confidence ?? null,
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        callIds: [String(row.id)],
        callCount: 1,
        sourceStatus: identityComplete ? "resolved" : "identity_incomplete",
        sourceStatusNullReason: identityComplete ? null : "not_collected"
      });
    }
  }

  const completeTables = [...tableMap.values()].filter((entry) => entry.identityComplete);
  const incompleteTables = [...tableMap.values()].filter((entry) => !entry.identityComplete);

  // ── 问询身份 ──────────────────────────────────────────────────────────────
  const turnRow = readConversationTurn(db, turnId);
  const inferredGroup = readInferredTurn(db, turnId);
  const registrationSource: InquiryReconciliation["inquiry"]["registrationSource"] = turnRow
    ? turnRow.question_source === "inferred"
      ? "inferred"
      : "reported"
    : inferredGroup
      ? "inferred"
      : "unregistered";

  const confirmedCount = toolUnits.filter((unit) => unit.associationStatus === "confirmed").length;
  const candidateCount = toolUnits.filter((unit) => unit.associationStatus === "candidate").length;

  // ── 轮次 ──────────────────────────────────────────────────────────────────
  const registeredInquiryTurns = turnRow ? 1 : 0;

  // ── 耗时 ──────────────────────────────────────────────────────────────────
  const callTimes = units
    .map((unit) => isoMs(unit.ts))
    .filter((value): value is number => value !== null);
  const callObservationSpanMs =
    callTimes.length > 0 ? Math.max(...callTimes) - Math.min(...callTimes) : null;
  const durations = units
    .map((unit) => unit.durationMs)
    .filter((value): value is number => typeof value === "number");
  const turnStart = isoMs(turnRow?.created_at ?? null);
  const turnEnd = callTimes.length > 0 ? Math.max(...callTimes) : null;
  const inquiryDurationMs =
    turnStart !== null && turnEnd !== null ? Math.max(0, turnEnd - turnStart) : null;

  // ── 预算 ──────────────────────────────────────────────────────────────────
  const dataToolCallCount = toolUnits.filter((unit) => isQuestionDataTool(unit.tool)).length;
  const budgetTerminationUnits = units.filter(
    (unit) =>
      unit.legacyOutcome === "budget_stop" ||
      unit.decisionReason === "question_budget_exhausted"
  );
  const exhausted = budgetTerminationUnits.length > 0;
  const wallClockValues = units
    .map((unit) => unit.turnWallClockMs)
    .filter((value): value is number => typeof value === "number");
  const wallClockMs = wallClockValues.length > 0 ? Math.max(...wallClockValues) : null;

  // 「问询预算已用尽」只在 primaryStatus=budget_stopped 且有预算终止凭据时显示。
  const budgetStatusFromBuckets = bucketCounts.budget_stopped > 0;
  const budgetStatus: InquiryReconciliation["budget"]["status"] =
    exhausted && budgetStatusFromBuckets
      ? "budget_stopped"
      : exhausted
        ? "unknown"
        : budgetStatusFromBuckets
          ? "budget_stopped"
          : "not_exhausted";

  // ── 结果与证据（问询级主状态由端口对问询单元派生） ────────────────────────
  const inquiryUnit: ReconciliationUnit = {
    unitId: turnId,
    unitKind: "inquiry",
    ts: turnRow?.created_at ?? units[0]?.ts ?? new Date(0).toISOString(),
    tool: units[0]?.tool ?? "",
    requestId: units[0]?.requestId ?? "",
    turnId,
    attemptId: null,
    parentAttemptId: null,
    associationStatus:
      confirmedCount > 0 ? "confirmed" : candidateCount > 0 ? "candidate" : "unassigned",
    legacyOutcome: units[0]?.legacyOutcome ?? null,
    decisionReason: units[0]?.decisionReason ?? null,
    errorDetail: units[0]?.errorDetail ?? null,
    responseRowCount: null,
    durationMs: inquiryDurationMs,
    turnWallClockMs: wallClockMs
  };
  const inquiryFacts = activePorts.primaryStatus.derive(inquiryUnit, context);

  const bucketTotal = Object.values(bucketCounts).reduce((sum, value) => sum + value, 0);
  const closureVerified = bucketTotal === toolUnits.length;

  const auditCoverage = activePorts.auditCoverage.summarizeCoverage(context, { units });

  const differences: InquiryReconciliation["differences"] = [];
  const exclusions: InquiryReconciliation["exclusions"] = [];

  if (callsWithoutSource.length > 0) {
    differences.push({
      id: "calls_without_source_identity",
      detail: `${callsWithoutSource.length} 条调用没有可核验的来源引用，表身份未知（不猜表、不填空数组冒充无访问）`,
      affectedCallIds: callsWithoutSource
    });
  }
  if (incompleteTables.length > 0) {
    differences.push({
      id: "source_identity_incomplete",
      detail: `${incompleteTables.length} 条来源引用缺少完整连接／Schema／表身份，单列不合并`,
      affectedCallIds: incompleteTables.flatMap((entry) => entry.callIds)
    });
  }
  if (!attemptsObservable) {
    differences.push({
      id: "attempt_identity_not_collected",
      detail: "attempt_id 未写入或全为 NULL：尝试数不可观测（不填 0），调用数不等于尝试数",
      affectedCallIds: []
    });
  }
  if (protocolUnits.length > 0) {
    exclusions.push({
      id: "protocol_events_excluded_from_business_denominator",
      detail: `${protocolUnits.length} 条协议事件不进入业务问询分母`
    });
  }
  if (candidateCount > 0) {
    differences.push({
      id: "candidate_association_not_upgraded",
      detail: `${candidateCount} 条调用为候选关联，未升级为已确认关联`,
      affectedCallIds: toolUnits
        .filter((unit) => unit.associationStatus === "candidate")
        .map((unit) => unit.unitId)
    });
  }

  return {
    context,
    inquiry: {
      turnId,
      registrationSource,
      registrationSourceNullReason: turnRow || inferredGroup ? null : "not_collected",
      originalTextAvailable: Boolean(turnRow?.question_preview),
      originalTextNullReason: turnRow
        ? turnRow.question_preview
          ? null
          : "not_collected"
        : "not_collected",
      sessionId: turnRow?.session_id ?? null,
      displayGroupId: inferredGroup?.inferred_turn_id ?? null,
      displayGroupKind: inferredGroup ? "inferred_group" : "none",
      associationStatus:
        confirmedCount > 0 ? "confirmed" : candidateCount > 0 ? "candidate" : "unassigned",
      associationStatusNullReason:
        confirmedCount > 0 || candidateCount > 0 ? null : "not_collected",
      candidateTurn: registrationSource !== "reported"
    },
    calls: {
      unit: "tool_call",
      total: toolUnits.length,
      confirmedCount,
      candidateCount,
      unassignedCount: toolUnits.filter((unit) => unit.associationStatus === "unassigned").length,
      conflictCount: toolUnits.filter((unit) => unit.associationStatus === "conflict").length,
      legacyUnverifiedCount: toolUnits.filter(
        (unit) => unit.associationStatus === "legacy_unverified"
      ).length,
      attemptCount: attemptsObservable ? distinctAttempts.size : null,
      attemptCountNullReason: attemptsObservable ? null : "not_collected",
      items: callItems
    },
    tables: {
      complete: completeTables,
      unknownBucket: {
        callIds: callsWithoutSource,
        callCount: callsWithoutSource.length,
        reason: "not_collected",
        detail: "调用存在但没有可核验来源引用；来源未知，不从 SQL 文本无条件猜测"
      }
    },
    turns: {
      registeredInquiryTurns,
      registeredInquiryTurnsNullReason: turnRow ? null : "not_collected",
      observableClientTurns: null,
      observableClientTurnsNullReason: "not_collected",
      unprovableTurnsReason: "client_turn_observation_not_recorded",
      toolCallCountIsNotUserTurns: true
    },
    durations: {
      inquiryDurationMs,
      inquiryDurationNullReason: inquiryDurationMs === null ? "not_collected" : null,
      callObservationSpanMs,
      callObservationSpanNullReason: callObservationSpanMs === null ? "not_collected" : null,
      cumulativeToolDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : null,
      cumulativeToolDurationNullReason: durations.length > 0 ? null : "not_collected",
      maxCallDurationMs: durations.length > 0 ? Math.max(...durations) : null,
      maxCallDurationNullReason: durations.length > 0 ? null : "not_collected"
    },
    budget: {
      ruleVersion: RECONCILIATION_BUDGET_RULE_VERSION,
      dataToolCallCount,
      wallClockMs,
      wallClockNullReason: wallClockMs === null ? "not_collected" : null,
      exhausted,
      status: budgetStatus,
      statusNullReason:
        budgetStatus === "unknown" ? "unknown" : exhausted || budgetStatusFromBuckets ? null : "not_applicable",
      terminationEventRefs: budgetTerminationUnits.map((unit) => unit.requestId),
      continuable: exhausted ? true : null,
      continuableNullReason: exhausted ? null : "not_applicable"
    },
    results: {
      primaryStatus: inquiryFacts.primaryStatus,
      primaryStatusNullReason: inquiryFacts.nullReasons.primaryStatus ?? null,
      factsSource: activePorts.primaryStatus.connected ? "p0_1_derivation_port" : "not_connected",
      conflict: inquiryFacts.conflict || conflict,
      authorization: inquiryFacts.authorization,
      execution: inquiryFacts.execution,
      delivery: inquiryFacts.delivery,
      deliveryNullReason: inquiryFacts.nullReasons.delivery ?? null,
      clientFollowUpVisibility: "not_observable",
      bucketCounts,
      bucketTotal,
      closureVerified,
      evidenceRefs: [...new Set(evidenceRefs)]
    },
    auditCoverage,
    differences,
    exclusions
  };
}

type SourceRow = {
  access_log_id: number;
  ts: string | null;
  connection_id: string | null;
  schema_name: string | null;
  source_name: string | null;
  physical_table: string | null;
  extraction_method: string | null;
  confidence: string | null;
};

function readSourceRowsForCalls(db: Database.Database, callIds: number[]): SourceRow[] {
  if (callIds.length === 0) return [];
  if (!tableExists(db, "access_log_sources")) return [];
  const info = probeColumns(db, "access_log_sources");
  if (!info.has("access_log_id")) return [];
  const wanted = [
    "access_log_id",
    "ts",
    "connection_id",
    "schema_name",
    "source_name",
    "physical_table",
    "extraction_method",
    "confidence"
  ];
  const projection = wanted.map((column) =>
    info.has(column) ? column : `NULL AS ${column}`
  ).join(", ");
  const placeholders = callIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT ${projection} FROM access_log_sources WHERE access_log_id IN (${placeholders}) ORDER BY id ASC`
    )
    .all(...callIds) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    access_log_id: Number(row.access_log_id),
    ts: (row.ts as string | null) ?? null,
    connection_id: (row.connection_id as string | null) ?? null,
    schema_name: (row.schema_name as string | null) ?? null,
    source_name: (row.source_name as string | null) ?? null,
    physical_table: (row.physical_table as string | null) ?? null,
    extraction_method: (row.extraction_method as string | null) ?? null,
    confidence: (row.confidence as string | null) ?? null
  }));
}

type ConversationTurnRow = {
  turn_id: string;
  session_id: string | null;
  question_preview: string | null;
  question_source: string | null;
  created_at: string | null;
};

function readConversationTurn(db: Database.Database, turnId: string): ConversationTurnRow | null {
  if (!tableExists(db, "conversation_turns")) return null;
  const info = probeColumns(db, "conversation_turns");
  if (!info.has("turn_id")) return null;
  const projection = ["turn_id", "session_id", "question_preview", "question_source", "created_at"]
    .map((column) => (info.has(column) ? column : `NULL AS ${column}`))
    .join(", ");
  const row = db
    .prepare(`SELECT ${projection} FROM conversation_turns WHERE turn_id = ?`)
    .get(turnId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    turn_id: String(row.turn_id),
    session_id: (row.session_id as string | null) ?? null,
    question_preview: (row.question_preview as string | null) ?? null,
    question_source: (row.question_source as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null
  };
}

type InferredTurnRow = {
  inferred_turn_id: string;
  started_at: string | null;
  ended_at: string | null;
  call_count: number | null;
  business_call_count: number | null;
};

function readInferredTurn(db: Database.Database, turnId: string): InferredTurnRow | null {
  if (!tableExists(db, "inferred_turns")) return null;
  const info = probeColumns(db, "inferred_turns");
  if (!info.has("inferred_turn_id")) return null;
  const projection = [
    "inferred_turn_id",
    "started_at",
    "ended_at",
    "call_count",
    "business_call_count"
  ]
    .map((column) => (info.has(column) ? column : `NULL AS ${column}`))
    .join(", ");
  const row = db
    .prepare(`SELECT ${projection} FROM inferred_turns WHERE inferred_turn_id = ?`)
    .get(turnId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    inferred_turn_id: String(row.inferred_turn_id),
    started_at: (row.started_at as string | null) ?? null,
    ended_at: (row.ended_at as string | null) ?? null,
    call_count: (row.call_count as number | null) ?? null,
    business_call_count: (row.business_call_count as number | null) ?? null
  };
}

// ────────────────────────────────────────────────────────────────────────────
// E6 —— Token 对账（能力模块：输入结构 + 差异分类算法）
// ────────────────────────────────────────────────────────────────────────────

export type TokenIdentityKind = "hash_prefix" | "credential_principal_id";

export type ConfiguredTokenIdentity = {
  /** 受保护摘要 / 持久 ID（**不含凭据值**）。 */
  identity: string;
  identityKind: TokenIdentityKind;
  userId: string;
  label: string | null;
  /** 所属 Agent / 用户是否启用。 */
  enabled: boolean;
  expired: boolean;
  createdAt: string | null;
};

export type ConfiguredTokenSnapshot = {
  /** 配置快照时点。 */
  capturedAt: string;
  /** 配置版本摘要（可空）。 */
  configVersion: string | null;
  tokens: ConfiguredTokenIdentity[];
  /** 身份前缀是否可能歧义（同一摘要对应多个配置 Token）。 */
  identityAmbiguity: boolean;
  /**
   * Whether the configuration could be read at all.
   *
   * `false` means the configuration was NOT observable. The token list is then
   * empty because nothing could be read — NOT because zero tokens are
   * configured. A reader must not be able to confuse the two, so every
   * consumer has to check this flag before reporting a configured count.
   */
  available: boolean;
  /** Why the configuration was not observable. */
  unavailableReason?: string;
};

export type ActiveTokenObservation = {
  identity: string;
  identityKind: TokenIdentityKind;
  toolCallCount: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

export type UnknownIdentityObservation = {
  reason: "missing_persistent_identity" | "unverifiable_historical_mapping";
  callCount: number;
  distinctRequestIds: number;
  lastSeenAt: string | null;
};

export type TokenReconciliationInput = {
  context: ReconciliationContext;
  configured: ConfiguredTokenSnapshot;
  /** 窗口内「至少一个独立工具调用」的去重身份观察。 */
  active: ActiveTokenObservation[];
  /** 调用存在但缺持久 Token 身份 / 历史映射无法核验。 */
  unknownIdentity: UnknownIdentityObservation[];
  /** 窗口内被单独计数的协议事件数（不偷换分母）。 */
  protocolEventCount: number;
};

export type TokenDifferenceSet = {
  id:
    | "configured_not_active"
    | "active_not_in_current_config"
    | "disabled_or_deleted"
    | "identity_unverified";
  label: string;
  /**
   * 该差异集合的规模。
   *
   * `null` = **不可观测**（不是 0）。配置快照读不到时，三个依赖配置的差异
   * 集合（已配置未活跃 / 活跃但当前配置不可见 / 已停用／删除）无法成立——
   * 把它们写成 0 或空集合等于宣称「没有差异」，那是拿空配置顶替真实配置。
   */
  count: number | null;
  /** `count` 为 null 时的空值原因（六值枚举）；可观测时为 null。 */
  nullReason: NullReason | null;
  identities: string[];
  reasons: string[];
  evidenceRefs: string[];
};

export type TokenReconciliation = {
  context: ReconciliationContext;
  configuredSnapshot: {
    capturedAt: string;
    configVersion: string | null;
    /**
     * 配置快照是否**可观测**。
     *
     * `false` = 读不到配置（文件缺失／读失败／解析失败）。此时下面的计数是
     * `null`（**不可观测**），**不是 0**——0 会把「读不到」说成「没有配置
     * Token」（Spec §2.4／§2.6：空值、0 与未知不得混用）。
     */
    available: boolean;
    /** 不可观测的具体原因（可观测时为 null）。 */
    unavailableReason: string | null;
    total: number | null;
    enabled: number | null;
    disabled: number | null;
    expired: number | null;
    identityAmbiguity: boolean;
  };
  activeWindow: {
    from: string;
    to: string;
    timezone: string;
    metricUnit: "tool_call";
    eventScope: "tool_call_only";
    protocolEventsExcluded: number;
    identityCount: number;
    toolCallCount: number;
  };
  unknownIdentity: {
    count: number;
    reasons: Array<{
      reason: UnknownIdentityObservation["reason"];
      callCount: number;
      distinctRequestIds: number;
      lastSeenAt: string | null;
    }>;
  };
  differences: TokenDifferenceSet[];
  /**
   * 「活跃数大于配置数」**不自动等于数据异常**：
   * 只有身份、窗口与快照口径一致且仍存在额外／冲突集合时才标记对账失败。
   */
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
    ratioNullReason: NullReason | null;
  };
};

/**
 * E6 —— Token 对账计算。
 *
 * 纯函数：输入配置快照 + 窗口内活跃身份观察 + 未知身份观察，输出四类差异集合。
 * 数据来源（access.yaml 快照、access_log 聚合）由父会话接线传入。
 *
 * ★ 配置不可观测时的口径（Spec §2.4／§2.6）：
 *   `configured.available === false` 表示**读不到配置**，不是「配置了 0 个
 *   Token」。此时：
 *   - 三个依赖配置的差异集合（已配置未活跃 / 活跃但当前配置不可见 /
 *     已停用／删除）**不可观测** → `count = null` + `nullReason`，
 *     **不得**用空配置算出「0 差异」；
 *   - `configuredSnapshot` 的计数为 `null`；
 *   - 比率的分母为 `null`、比率本身为 `null`（不显示 0% / 100%）；
 *   - **不得**判定对账失败——差异不可观测不等于存在差异。
 */
export function reconcileTokens(input: TokenReconciliationInput): TokenReconciliation {
  const { context, configured, active, unknownIdentity, protocolEventCount } = input;

  /** 配置快照是否可观测（读不到 = 不可观测，不等于 0）。 */
  const configAvailable = configured.available;
  /** 依赖配置的差异集合不可观测时的空值原因。 */
  const configNullReason: NullReason = "not_collected";

  const configuredIdentities = new Set(configured.tokens.map((token) => token.identity));
  const activeIdentities = new Set(active.map((observation) => observation.identity));

  const configuredNotActive = configAvailable
    ? configured.tokens
        .filter((token) => !activeIdentities.has(token.identity))
        .map((token) => token.identity)
    : [];

  const activeNotInCurrentConfig = configAvailable
    ? active
        .filter((observation) => !configuredIdentities.has(observation.identity))
        .map((observation) => observation.identity)
    : [];

  const disabledOrDeleted = configAvailable
    ? configured.tokens
        .filter((token) => !token.enabled || token.expired)
        .map((token) => token.identity)
    : [];

  // 「身份未核验」= 无法建立持久 Token 身份的调用（缺身份 / 历史映射不可核验）。
  // 「活跃但当前配置不可见」是另一档：身份可见但不在当前配置快照中。两者不合并。
  const identityUnverified = new Set<string>(
    unknownIdentity.map((observation) => `${observation.reason}:${observation.distinctRequestIds}`)
  );

  const differences: TokenDifferenceSet[] = [
    {
      id: "configured_not_active",
      label: "已配置未活跃",
      count: configAvailable ? configuredNotActive.length : null,
      nullReason: configAvailable ? null : configNullReason,
      identities: configuredNotActive,
      reasons: configuredNotActive.length > 0 ? ["no_tool_call_in_window"] : [],
      evidenceRefs: []
    },
    {
      id: "active_not_in_current_config",
      label: "活跃但当前配置不可见",
      count: configAvailable ? activeNotInCurrentConfig.length : null,
      nullReason: configAvailable ? null : configNullReason,
      identities: activeNotInCurrentConfig,
      reasons:
        activeNotInCurrentConfig.length > 0 ? ["not_in_current_configuration_snapshot"] : [],
      evidenceRefs: []
    },
    {
      id: "disabled_or_deleted",
      label: "已停用／删除",
      count: configAvailable ? disabledOrDeleted.length : null,
      nullReason: configAvailable ? null : configNullReason,
      identities: disabledOrDeleted,
      reasons: configured.tokens
        .filter((token) => !token.enabled || token.expired)
        .map((token) => (!token.enabled ? "agent_disabled" : "expired")),
      evidenceRefs: []
    },
    {
      id: "identity_unverified",
      label: "身份未核验",
      count: identityUnverified.size,
      // 该集合来自审计事实（窗口内调用），不依赖配置快照 → 始终可观测。
      nullReason: null,
      identities: [...identityUnverified],
      reasons: unknownIdentity.map((observation) => observation.reason),
      evidenceRefs: []
    }
  ];

  // 配置不可观测时无法比较「活跃数 vs 配置数」→ 不得报「活跃大于配置」。
  const activeGreaterThanConfigured = configAvailable
    ? activeIdentities.size > configuredIdentities.size
    : false;
  const unexplainedExtra = activeNotInCurrentConfig.filter(
    (identity) => !disabledOrDeleted.includes(identity)
  );
  const identityBasisAligned = !configured.identityAmbiguity;
  // 配置不可观测时**不得**判定对账失败：差异不可观测 ≠ 存在差异。
  const flagged =
    configAvailable &&
    identityBasisAligned &&
    unexplainedExtra.length > 0 &&
    unknownIdentity.length === 0;

  // 分母 = 配置 Token 数。配置不可观测 → 分母为 null（不是 0）。
  const denominator: number | null = configAvailable ? configuredIdentities.size : null;
  const numerator = activeIdentities.size;
  const ratioNullReason: NullReason | null = !configAvailable
    ? configNullReason
    : denominator === 0
      ? "not_applicable"
      : null;

  return {
    context,
    configuredSnapshot: {
      capturedAt: configured.capturedAt,
      configVersion: configured.configVersion,
      available: configAvailable,
      unavailableReason: configAvailable ? null : (configured.unavailableReason ?? null),
      total: configAvailable ? configured.tokens.length : null,
      enabled: configAvailable
        ? configured.tokens.filter((token) => token.enabled && !token.expired).length
        : null,
      disabled: configAvailable ? configured.tokens.filter((token) => !token.enabled).length : null,
      expired: configAvailable ? configured.tokens.filter((token) => token.expired).length : null,
      identityAmbiguity: configured.identityAmbiguity
    },
    activeWindow: {
      from: context.timeRange.from,
      to: context.timeRange.to,
      timezone: context.timeRange.timezone,
      metricUnit: "tool_call",
      eventScope: "tool_call_only",
      protocolEventsExcluded: protocolEventCount,
      identityCount: activeIdentities.size,
      toolCallCount: active.reduce((sum, observation) => sum + observation.toolCallCount, 0)
    },
    unknownIdentity: {
      count: unknownIdentity.reduce((sum, observation) => sum + observation.callCount, 0),
      reasons: unknownIdentity.map((observation) => ({
        reason: observation.reason,
        callCount: observation.callCount,
        distinctRequestIds: observation.distinctRequestIds,
        lastSeenAt: observation.lastSeenAt
      }))
    },
    differences,
    anomaly: {
      flagged,
      reason: flagged
        ? "extra_identity_set_after_aligned_identity_basis"
        : !configAvailable
          ? "configuration_not_observable"
          : activeGreaterThanConfigured
            ? "active_greater_than_configured_is_not_by_itself_anomaly"
            : "no_unexplained_difference",
      activeGreaterThanConfigured
    },
    completeness: {
      numerator,
      denominator,
      // 分母不可观测或为 0 → 比率不可给（不显示 0% / 100% 的确定结论）。
      ratio:
        denominator === null || denominator === 0
          ? null
          : Math.round((numerator / denominator) * 1000) / 10,
      ratioNullReason
    }
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 游标分页（E10：游标分页并声明是否完整）
// ────────────────────────────────────────────────────────────────────────────

const CURSOR_SEPARATOR = "::";

export function encodeReconciliationCursor(key: string): string {
  return Buffer.from(`${CURSOR_SEPARATOR}${key}`, "utf8").toString("base64url");
}

export function decodeReconciliationCursor(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const separator = decoded.indexOf(CURSOR_SEPARATOR);
    if (separator < 0) return null;
    return decoded.slice(separator + CURSOR_SEPARATOR.length);
  } catch {
    return null;
  }
}

export type PageResult<T> = {
  items: T[];
  nextCursor: string | null;
  /** 本页是否为全部匹配集合（不把当前页完整冒充全部匹配完整）。 */
  complete: boolean;
  totalMatched: number;
  returned: number;
};

/**
 * 稳定键分页：按 `keyOf` 升序在已排序集合上做 keyset 切片。
 *
 * `cursor` 是**编码后的游标**（由 `encodeReconciliationCursor` 产生）；本函数内部解码，
 * 避免调用方把编码游标误当成已解码的 key。
 */
export function paginateByKey<T>(input: {
  items: readonly T[];
  keyOf: (item: T) => string;
  cursor: string | null;
  limit: number;
}): PageResult<T> {
  const sorted = [...input.items].sort((a, b) => {
    const left = input.keyOf(a);
    const right = input.keyOf(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const totalMatched = sorted.length;
  const cursorKey = decodeReconciliationCursor(input.cursor);
  const startIndex = cursorKey
    ? sorted.findIndex((item) => input.keyOf(item) > cursorKey)
    : 0;
  if (startIndex < 0) {
    return { items: [], nextCursor: null, complete: true, totalMatched, returned: 0 };
  }
  const page = sorted.slice(startIndex, startIndex + input.limit);
  const hasMore = startIndex + page.length < totalMatched;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeReconciliationCursor(input.keyOf(last)) : null,
    complete: !hasMore,
    totalMatched,
    returned: page.length
  };
}
