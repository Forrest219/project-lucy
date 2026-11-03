/**
 * Lucy v0.25 — P0-4 审计只读对账展示：CSV 构造器（E9）。
 *
 * Authority:
 *   - docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md §4.3（CSV 与 API）
 *
 * 约束（Spec §4.3）：
 *   - 至少五类：问询摘要、完整表清单、调用／尝试、Token 对账、差异集合；
 *   - 全部文件携带**同一** `reconciliationContext`（由 Manifest 关联）；
 *   - **保留 null 与空值原因**（空单元格、0、false 与未知不得混用）；
 *   - **防公式注入**；
 *   - **不导出凭据值、秘密或超授权原文**（Token 只用持久 ID 或受保护摘要）。
 *
 * 本模块是**纯函数**：输入数据 → CSV 字符串。数据来源与读取由调用方（路由层）负责。
 */

import { sha256Hex } from "../config-digest.js";
import type { ReconciliationContext } from "./reconciliation-context.js";
import type {
  CallEvidence,
  InquiryReconciliation,
  TableEvidence,
  TokenDifferenceSet,
  TokenReconciliation
} from "./reconciliation.js";

/** CSV 单元格防公式注入：与 `admin/audit.ts` 的 `CSV_FORMULA_RE` 同口径。 */
const CSV_FORMULA_RE = /^[=+\-@\t\r]/;

/**
 * CSV 单元格。
 *
 * - `null` / `undefined` → 空单元格（配合独立的 null_reason 列，不与 0/false 混用）；
 * - 以 `=` `+` `-` `@` 等开头的文本前置单引号，防公式注入；
 * - 含逗号 / 引号 / 换行时按 RFC 4180 加引号转义。
 */
export function reconciliationCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  const guarded = CSV_FORMULA_RE.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export type CsvFile = {
  /** 文件名（不含目录）。 */
  name: string;
  /** CSV 文本（行尾 \n，含表头）。 */
  csv: string;
  /** 数据行数（不含表头）。 */
  rowCount: number;
  /** CSV 内容 sha256。 */
  sha256: string;
};

function buildCsv(name: string, headers: readonly string[], rows: readonly unknown[][]): CsvFile {
  const lines = [headers.map(reconciliationCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(reconciliationCsvCell).join(","));
  }
  const csv = `${lines.join("\n")}\n`;
  return { name, csv, rowCount: rows.length, sha256: sha256Hex(csv) };
}

export type ReconciliationCsvManifest = {
  schemaVersion: "audit-reconciliation-csv-manifest/v1";
  context: ReconciliationContext;
  generatedAt: string;
  files: Array<{ name: string; sha256: string; rowCount: number }>;
  /** 跨文件关联键声明。 */
  relationKeys: {
    inquiryToCall: "turnId → call.unitId";
    inquiryToTable: "turnId → table.callIds[]";
    tokenToDifference: "tokenIdentity → difference.identities[]";
  };
  /** 排除项声明（排除什么、为什么）。 */
  exclusions: Array<{ id: string; detail: string }>;
  /** 同一轮导出的完整性声明。 */
  completeness: {
    watermarkSeq: number;
    snapshotId: string;
    metricUnit: string;
    derivationVersion: string;
    classificationVersion: string;
    /** 本导出是否覆盖全部匹配集合（分页终止时才为 true）。 */
    complete: boolean;
    note: string;
  };
};

// ────────────────────────────────────────────────────────────────────────────
// 五类 CSV
// ────────────────────────────────────────────────────────────────────────────

export type InquirySummaryRow = {
  turnId: string;
  registrationSource: string;
  originalTextAvailable: boolean;
  associationStatus: string;
  candidateTurn: boolean;
  primaryStatus: string;
  primaryStatusNullReason: string | null;
  confirmedCallCount: number;
  candidateCallCount: number;
  attemptCount: number | null;
  attemptCountNullReason: string | null;
  completeTableCount: number;
  unknownTableCallCount: number;
  inquiryDurationMs: number | null;
  inquiryDurationNullReason: string | null;
  budgetStatus: string;
  budgetTerminated: boolean;
  watermarkSeq: number;
  metricUnit: string;
};

/** ① 问询摘要。 */
export function buildInquirySummaryCsv(
  rows: readonly InquirySummaryRow[],
  context: ReconciliationContext
): CsvFile {
  const headers = [
    "turn_id",
    "registration_source",
    "original_text_available",
    "association_status",
    "candidate_turn",
    "primary_status",
    "primary_status_null_reason",
    "confirmed_call_count",
    "candidate_call_count",
    "attempt_count",
    "attempt_count_null_reason",
    "complete_table_count",
    "unknown_table_call_count",
    "inquiry_duration_ms",
    "inquiry_duration_null_reason",
    "budget_status",
    "budget_terminated",
    "watermark_seq",
    "metric_unit",
    "classification_version",
    "derivation_version"
  ];
  return buildCsv(
    "inquiry-summary.csv",
    headers,
    rows.map((row) => [
      row.turnId,
      row.registrationSource,
      row.originalTextAvailable,
      row.associationStatus,
      row.candidateTurn,
      row.primaryStatus,
      row.primaryStatusNullReason,
      row.confirmedCallCount,
      row.candidateCallCount,
      row.attemptCount,
      row.attemptCountNullReason,
      row.completeTableCount,
      row.unknownTableCallCount,
      row.inquiryDurationMs,
      row.inquiryDurationNullReason,
      row.budgetStatus,
      row.budgetTerminated,
      context.watermarkSeq,
      context.metricUnit,
      context.classificationVersion,
      context.derivationVersion
    ])
  );
}

export type TableListRow = {
  turnId: string;
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
  callCount: number;
  callIds: string[];
  sourceStatus: string;
  sourceStatusNullReason: string | null;
};

/** ② 完整表清单：始终保留完整 connectionId / schema / table，不以下拉字符串作关联键。 */
export function buildTableListCsv(
  rows: readonly TableListRow[],
  context: ReconciliationContext
): CsvFile {
  const headers = [
    "turn_id",
    "connection_id",
    "schema_name",
    "table_name",
    "identity_complete",
    "missing_identity_parts",
    "physical_table",
    "extraction_method",
    "confidence",
    "first_observed_at",
    "last_observed_at",
    "call_count",
    "call_ids",
    "source_status",
    "source_status_null_reason",
    "watermark_seq",
    "metric_unit"
  ];
  return buildCsv(
    "complete-table-list.csv",
    headers,
    rows.map((row) => [
      row.turnId,
      row.connectionId,
      row.schema,
      row.table,
      row.identityComplete,
      row.missingIdentityParts.join("|"),
      row.physicalTable,
      row.extractionMethod,
      row.confidence,
      row.firstObservedAt,
      row.lastObservedAt,
      row.callCount,
      row.callIds.join("|"),
      row.sourceStatus,
      row.sourceStatusNullReason,
      context.watermarkSeq,
      context.metricUnit
    ])
  );
}

export type CallAttemptRow = {
  turnId: string;
  unitId: string;
  ts: string;
  tool: string;
  requestId: string;
  attemptId: string | null;
  attemptIdNullReason: string | null;
  parentAttemptId: string | null;
  associationStatus: string;
  legacyOutcome: string | null;
  decisionReason: string | null;
  primaryStatus: string;
  primaryStatusNullReason: string | null;
  authorization: string;
  execution: string;
  delivery: string;
  durationMs: number | null;
  durationNullReason: string | null;
  sourceIdentityCount: number;
};

/** ③ 调用／尝试。 */
export function buildCallAttemptCsv(
  rows: readonly CallAttemptRow[],
  context: ReconciliationContext
): CsvFile {
  const headers = [
    "turn_id",
    "unit_id",
    "ts",
    "tool",
    "request_id",
    "attempt_id",
    "attempt_id_null_reason",
    "parent_attempt_id",
    "association_status",
    "legacy_outcome",
    "decision_reason",
    "primary_status",
    "primary_status_null_reason",
    "authorization_status",
    "execution_status",
    "delivery_status",
    "duration_ms",
    "duration_null_reason",
    "source_identity_count",
    "watermark_seq",
    "metric_unit"
  ];
  return buildCsv(
    "calls-attempts.csv",
    headers,
    rows.map((row) => [
      row.turnId,
      row.unitId,
      row.ts,
      row.tool,
      row.requestId,
      row.attemptId,
      row.attemptIdNullReason,
      row.parentAttemptId,
      row.associationStatus,
      row.legacyOutcome,
      row.decisionReason,
      row.primaryStatus,
      row.primaryStatusNullReason,
      row.authorization,
      row.execution,
      row.delivery,
      row.durationMs,
      row.durationNullReason,
      row.sourceIdentityCount,
      context.watermarkSeq,
      context.metricUnit
    ])
  );
}

export type TokenReconciliationRow = {
  section: "configured" | "active" | "unknown";
  identity: string;
  identityKind: string;
  userId: string | null;
  enabled: boolean | null;
  expired: boolean | null;
  toolCallCount: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  unknownReason: string | null;
  reason: string | null;
  watermarkSeq: number;
  metricUnit: string;
};

/**
 * ④ Token 对账。
 *
 * Token 仅使用**持久 ID 或受保护摘要**（`identity` 已是摘要），不导出凭据值。
 */
export function buildTokenReconciliationCsv(
  reconciliation: TokenReconciliation,
  configuredIdentities: ReadonlyArray<{
    identity: string;
    identityKind: string;
    userId: string;
    enabled: boolean;
    expired: boolean;
    createdAt: string | null;
  }>,
  activeIdentities: ReadonlyArray<{
    identity: string;
    identityKind: string;
    toolCallCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  }>
): CsvFile {
  const context = reconciliation.context;
  const headers = [
    "section",
    "token_identity",
    "identity_kind",
    "user_id",
    "enabled",
    "expired",
    "tool_call_count",
    "first_seen_at",
    "last_seen_at",
    "unknown_reason",
    "reason",
    "watermark_seq",
    "metric_unit"
  ];
  const rows: unknown[][] = [];
  // 配置快照不可观测时，「configured」段必须**显式声明不可观测**——
  // 否则空段会被读成「配置了 0 个 Token」（Spec §2.6）。
  if (!reconciliation.configuredSnapshot.available) {
    rows.push([
      "configured",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      reconciliation.configuredSnapshot.unavailableReason ?? "not_collected",
      context.watermarkSeq,
      context.metricUnit
    ]);
  }
  for (const token of configuredIdentities) {
    rows.push([
      "configured",
      token.identity,
      token.identityKind,
      token.userId,
      token.enabled,
      token.expired,
      null,
      token.createdAt,
      null,
      null,
      null,
      context.watermarkSeq,
      context.metricUnit
    ]);
  }
  for (const active of activeIdentities) {
    rows.push([
      "active",
      active.identity,
      active.identityKind,
      null,
      null,
      null,
      active.toolCallCount,
      active.firstSeenAt,
      active.lastSeenAt,
      null,
      null,
      context.watermarkSeq,
      context.metricUnit
    ]);
  }
  for (const unknown of reconciliation.unknownIdentity.reasons) {
    rows.push([
      "unknown",
      null,
      null,
      null,
      null,
      null,
      unknown.callCount,
      null,
      unknown.lastSeenAt,
      unknown.reason,
      null,
      context.watermarkSeq,
      context.metricUnit
    ]);
  }
  return buildCsv("token-reconciliation.csv", headers, rows);
}

export type DifferenceSetRow = {
  differenceId: string;
  label: string;
  identity: string | null;
  reason: string | null;
  evidenceRef: string | null;
  watermarkSeq: number;
};

/** ⑤ 差异集合（Token 四类差异 + 其他已声明差异）。 */
export function buildDifferenceSetCsv(
  tokenDifferences: readonly TokenDifferenceSet[],
  extraDifferences: ReadonlyArray<{ id: string; detail: string; affectedCallIds: string[] }>,
  context: ReconciliationContext
): CsvFile {
  const headers = [
    "difference_id",
    "label",
    "identity",
    "reason",
    "evidence_ref",
    "detail",
    "affected_call_ids",
    "watermark_seq"
  ];
  const rows: unknown[][] = [];
  for (const difference of tokenDifferences) {
    for (const identity of difference.identities) {
      rows.push([
        difference.id,
        difference.label,
        identity,
        difference.reasons.join("|"),
        null,
        null,
        null,
        context.watermarkSeq
      ]);
    }
    if (difference.identities.length === 0) {
      rows.push([
        difference.id,
        difference.label,
        null,
        null,
        null,
        // count 为 null = 不可观测 → 写空值原因，**不写** "empty"。
        // 写 "empty" 等于宣称「没有差异」，那是拿空配置顶替真实配置。
        difference.count === null ? (difference.nullReason ?? "not_collected")
          : difference.count === 0 ? "empty"
          : null,
        null,
        context.watermarkSeq
      ]);
    }
  }
  for (const difference of extraDifferences) {
    rows.push([
      difference.id,
      difference.id,
      null,
      null,
      null,
      difference.detail,
      difference.affectedCallIds.join("|"),
      context.watermarkSeq
    ]);
  }
  return buildCsv("difference-sets.csv", headers, rows);
}

// ────────────────────────────────────────────────────────────────────────────
// 组装
// ────────────────────────────────────────────────────────────────────────────

export type ReconciliationCsvBundle = {
  files: CsvFile[];
  manifest: ReconciliationCsvManifest;
};

/**
 * 组装五类 CSV + Manifest。
 *
 * 全部文件共享**同一** `reconciliationContext`（由 Manifest 关联），
 * 因此 CSV 与当前 UI / API 使用同一筛选、账本上界 S、计量单位与规则版本。
 */
export function buildReconciliationCsvBundle(input: {
  context: ReconciliationContext;
  inquirySummary: readonly InquirySummaryRow[];
  tableList: readonly TableListRow[];
  calls: readonly CallAttemptRow[];
  tokenReconciliation: TokenReconciliation;
  configuredIdentities: ReadonlyArray<{
    identity: string;
    identityKind: string;
    userId: string;
    enabled: boolean;
    expired: boolean;
    createdAt: string | null;
  }>;
  activeIdentities: ReadonlyArray<{
    identity: string;
    identityKind: string;
    toolCallCount: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  }>;
  extraDifferences?: ReadonlyArray<{ id: string; detail: string; affectedCallIds: string[] }>;
  exclusions?: ReadonlyArray<{ id: string; detail: string }>;
  /** 本次导出是否覆盖全部匹配集合。 */
  complete: boolean;
}): ReconciliationCsvBundle {
  const files: CsvFile[] = [
    buildInquirySummaryCsv(input.inquirySummary, input.context),
    buildTableListCsv(input.tableList, input.context),
    buildCallAttemptCsv(input.calls, input.context),
    buildTokenReconciliationCsv(
      input.tokenReconciliation,
      input.configuredIdentities,
      input.activeIdentities
    ),
    buildDifferenceSetCsv(
      input.tokenReconciliation.differences,
      input.extraDifferences ?? [],
      input.context
    )
  ];

  const manifest: ReconciliationCsvManifest = {
    schemaVersion: "audit-reconciliation-csv-manifest/v1",
    context: input.context,
    generatedAt: input.context.generatedAt,
    files: files.map((file) => ({ name: file.name, sha256: file.sha256, rowCount: file.rowCount })),
    relationKeys: {
      inquiryToCall: "turnId → call.unitId",
      inquiryToTable: "turnId → table.callIds[]",
      tokenToDifference: "tokenIdentity → difference.identities[]"
    },
    exclusions: [...(input.exclusions ?? [])],
    completeness: {
      watermarkSeq: input.context.watermarkSeq,
      snapshotId: input.context.snapshotId,
      metricUnit: input.context.metricUnit,
      derivationVersion: input.context.derivationVersion,
      classificationVersion: input.context.classificationVersion,
      complete: input.complete,
      note: input.complete
        ? "本次导出覆盖该筛选下的全部匹配行"
        : "本次导出为分页结果的一部分，不构成完整集合"
    }
  };

  return { files, manifest };
}

/** 从问询详情结果提取问询摘要行。 */
export function inquirySummaryRowFrom(
  inquiry: InquiryReconciliation
): InquirySummaryRow {
  return {
    turnId: inquiry.inquiry.turnId,
    registrationSource: inquiry.inquiry.registrationSource,
    originalTextAvailable: inquiry.inquiry.originalTextAvailable,
    associationStatus: inquiry.inquiry.associationStatus,
    candidateTurn: inquiry.inquiry.candidateTurn,
    primaryStatus: inquiry.results.primaryStatus,
    primaryStatusNullReason: inquiry.results.primaryStatusNullReason,
    confirmedCallCount: inquiry.calls.confirmedCount,
    candidateCallCount: inquiry.calls.candidateCount,
    attemptCount: inquiry.calls.attemptCount,
    attemptCountNullReason: inquiry.calls.attemptCountNullReason,
    completeTableCount: inquiry.tables.complete.length,
    unknownTableCallCount: inquiry.tables.unknownBucket.callCount,
    inquiryDurationMs: inquiry.durations.inquiryDurationMs,
    inquiryDurationNullReason: inquiry.durations.inquiryDurationNullReason,
    budgetStatus: inquiry.budget.status,
    budgetTerminated: inquiry.budget.exhausted,
    watermarkSeq: inquiry.context.watermarkSeq,
    metricUnit: inquiry.context.metricUnit
  };
}

/** 从问询详情结果提取完整表清单行。 */
export function tableListRowsFrom(inquiry: InquiryReconciliation): TableListRow[] {
  return inquiry.tables.complete.map((table: TableEvidence) => ({
    turnId: inquiry.inquiry.turnId,
    connectionId: table.connectionId,
    schema: table.schema,
    table: table.table,
    identityComplete: table.identityComplete,
    missingIdentityParts: table.missingIdentityParts,
    physicalTable: table.physicalTable,
    extractionMethod: table.extractionMethod,
    confidence: table.confidence,
    firstObservedAt: table.firstObservedAt,
    lastObservedAt: table.lastObservedAt,
    callCount: table.callCount,
    callIds: table.callIds,
    sourceStatus: table.sourceStatus,
    sourceStatusNullReason: table.sourceStatusNullReason
  }));
}

/** 从问询详情结果提取调用／尝试行。 */
export function callAttemptRowsFrom(inquiry: InquiryReconciliation): CallAttemptRow[] {
  return inquiry.calls.items.map((call: CallEvidence) => ({
    turnId: inquiry.inquiry.turnId,
    unitId: call.unitId,
    ts: call.ts,
    tool: call.tool,
    requestId: call.requestId,
    attemptId: call.attemptId,
    attemptIdNullReason: call.attemptIdNullReason,
    parentAttemptId: call.parentAttemptId,
    associationStatus: call.associationStatus,
    legacyOutcome: call.legacyOutcome,
    decisionReason: call.decisionReason,
    primaryStatus: call.primaryStatus,
    primaryStatusNullReason: call.primaryStatusNullReason,
    authorization: call.authorization,
    execution: call.execution,
    delivery: call.delivery,
    durationMs: call.durationMs,
    durationNullReason: call.durationNullReason,
    sourceIdentityCount: call.sourceIdentityCount
  }));
}
