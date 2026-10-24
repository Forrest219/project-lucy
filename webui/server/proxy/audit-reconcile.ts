/**
 * Lucy v0.25 / L25-09 S05(b)(c) + S06 — 对账、指标与完整性.
 *
 * 权威来源：Spec §8.2（计量单位字典 + 六项 auditCoverage 检查 + 差异分类）、
 * §12.3（summarize / reconcile 伪代码）、§12.5（as-of S 导出视图）。
 *
 * 硬规则：
 *   1. 协议请求 / 工具调用 / 执行尝试 / 已登记问询 / 展示分组分别计数，
 *      生命周期账本行不是同一单位。
 *   2. 每个指标记录 metric_id / version / 单位 / 截止位置 S / 筛选 / N / D /
 *      排除及不可观测原因；分母为 0 不显示 100%。
 *   3. 无法建立独立预期集合时记 `unknown`，**禁止**用同侧投影自证入口无漏记。
 *   4. `unknown` 不合成为 `pass`。
 *   5. as-of S 视图 = 基础行（ledger_seq <= S）+ 折叠 ledger_seq <= S 的修订事件。
 *      只按 seq 过滤即宣称修订视图一致是**不允许**的。
 */

import {
  PRIMARY_STATUSES,
  emptyPrimaryStatusCounts,
  isPrimaryStatus,
  summarizePrimaryStatuses,
  type PrimaryStatus
} from "./audit-derivation.js";

/**
 * B27 — 读路径的行 → 主状态映射（**唯一**实现）。
 *
 * API / CSV / v2 导出三处**同源同函数**（Spec §4.3(a) 末段）。
 *
 * 规则：
 *   - `primary_status` 是合法桶 → 直接用。
 *   - `primary_status` 为 NULL / 非法 → **历史行**，落 `unknown`。
 *     旧 `outcome=ok` **不**推定 `succeeded`（Spec §4.3(a) 第 9 行）。
 *     旧 outcome 的直方图**单列**在 `legacyOutcomeCounts`，不作为新执行状态。
 */
export function readPrimaryStatus(row: {
  primary_status?: string | null;
  outcome?: string | null;
}): PrimaryStatus {
  if (isPrimaryStatus(row.primary_status)) return row.primary_status;
  return "unknown";
}

/**
 * B27 — 八桶计数（读路径统一入口）。
 *
 * 返回八桶计数 + 旧 outcome 直方图 + 闭合断言。
 */
export function countPrimaryStatuses(
  rows: ReadonlyArray<{ primary_status?: string | null; outcome?: string | null }>
): {
  counts: Record<PrimaryStatus, number>;
  legacyOutcomeCounts: Record<string, number>;
  total: number;
  closed: boolean;
} {
  const members: UnitMember[] = rows.map((row) => ({
    unitId: String((row as { id?: unknown }).id ?? ""),
    primaryStatus: readPrimaryStatus(row),
    legacyOutcome: row.outcome ?? null
  }));
  const summary = summarizePrimaryStatuses(members);
  const legacyOutcomeCounts: Record<string, number> = {};
  for (const member of members) {
    const key = member.legacyOutcome ?? "null";
    legacyOutcomeCounts[key] = (legacyOutcomeCounts[key] ?? 0) + 1;
  }
  return {
    counts: summary.counts,
    legacyOutcomeCounts,
    total: summary.total,
    closed: summary.closed
  };
}

// ─── 计量单位字典（Spec §8.2(a)）────────────────────────────────────────────

export const METRIC_UNITS = [
  "protocol_request",
  "tool_call",
  "execution_attempt",
  "registered_inquiry",
  "display_group"
] as const;

export type MetricUnit = (typeof METRIC_UNITS)[number];

export type UnitDefinition = {
  metricId: string;
  unit: MetricUnit;
  version: string;
  /** 集合定义（人类可读，导出与报告共用）。 */
  definition: string;
  /** 边界声明（哪些不算入本集合）。 */
  boundary: string;
  /** 不可观测 / 无法建立独立预期集合时的原因码。 */
  unobservableReasons: string[];
};

export const UNIT_DEFINITIONS: Record<MetricUnit, UnitDefinition> = {
  protocol_request: {
    metricId: "protocol_request/v2p5-1",
    unit: "protocol_request",
    version: "v2p5-1",
    definition: "Lucy 登记入口所处理的独立请求，含握手与探测；按请求身份计，不按生命周期行计。",
    boundary: "不含仅在客户端本地失败、从未到达 Lucy 边界的请求。",
    unobservableReasons: ["no_independent_ingress_counter"]
  },
  tool_call: {
    metricId: "tool_call/v2p5-1",
    unit: "tool_call",
    version: "v2p5-1",
    definition: "event_type=tool_call 的独立调用；含元数据、begin、拒绝、错误与预算终止。",
    boundary: "server/discover 等 protocol 探测不计入本集合。",
    unobservableReasons: []
  },
  execution_attempt: {
    metricId: "execution_attempt/v2p5-1",
    unit: "execution_attempt",
    version: "v2p5-1",
    definition: "独立 attempt_id；一次调用可有多次尝试。",
    boundary: "不得凭 request_id、SQL 或投影行数补造历史 attempt。",
    unobservableReasons: ["historical_attempt_not_backfilled"]
  },
  registered_inquiry: {
    metricId: "registered_inquiry/v2p5-1",
    unit: "registered_inquiry",
    version: "v2p5-1",
    definition: "按有效显式 turnId 去重的登记问询。",
    boundary: "不由调用事件数或推断分组数推定真实问询数；原文未上报单独标识。",
    unobservableReasons: ["question_text_not_reported"]
  },
  display_group: {
    metricId: "display_group/v2p5-1",
    unit: "display_group",
    version: "v2p5-1",
    definition: "按已声明聚类规则生成的业务候选分组及仅握手分组。",
    boundary: "推断业务分组单列，不能冒充真实问询分母；仅握手分组默认不进业务问询列表。",
    unobservableReasons: ["grouping_is_inferred"]
  }
};

// ─── 汇总（Spec §12.3 summarize）────────────────────────────────────────────

export type ReconcileFilter = {
  /** 账本截止位置 S（as-of）。 */
  seqUpperBound: number;
  userId?: string;
  tool?: string;
  eventType?: string;
  since?: string;
  until?: string;
};

export type UnitMember = {
  /** 计量单元 ID（协议请求 ID / attempt_id / turn_id / 分组 ID …）。 */
  unitId: string;
  primaryStatus: PrimaryStatus;
  /** 该单元的原始 outcome（历史直方图单列，不作为新执行状态）。 */
  legacyOutcome?: string | null;
};

export type MetricSummary = {
  metricId: string;
  version: string;
  unit: MetricUnit;
  definition: string;
  boundary: string;
  /** 截止位置 S。 */
  seqUpperBound: number;
  filter: ReconcileFilter;
  /** 纳入集合总数 D。 */
  denominator: number;
  /** 分子 N（按主状态桶分列）。 */
  counts: Record<PrimaryStatus, number>;
  /** 旧 outcome 直方图，单列，不作为新执行状态的证据。 */
  legacyOutcomeCounts: Record<string, number>;
  /** 闭合断言。 */
  closed: boolean;
  closureErrors: string[];
  /** 排除项声明。 */
  exclusions: string[];
  /** 不可观测原因。 */
  unobservableReasons: string[];
};

/**
 * `summarize(unit, filter, S, ...)` — 单一来源的汇总函数。
 *
 * API / UI / CSV / 证据包调用同一版本分类函数（Spec §4.3(a) 末段），
 * 因此本函数是唯一实现；读路径的 API、CSV 与 v2 导出都从它取值。
 */
export function summarize(
  unit: MetricUnit,
  filter: ReconcileFilter,
  members: ReadonlyArray<UnitMember>
): MetricSummary {
  const definition = UNIT_DEFINITIONS[unit];
  const summary = summarizePrimaryStatuses(members.map((m) => ({ primaryStatus: m.primaryStatus })));

  const legacyOutcomeCounts: Record<string, number> = {};
  for (const member of members) {
    const key = member.legacyOutcome ?? "null";
    legacyOutcomeCounts[key] = (legacyOutcomeCounts[key] ?? 0) + 1;
  }

  const closureErrors = [...summary.closureErrors];
  if (members.length > 0 && summary.total !== members.length) {
    closureErrors.push(`summary_total_${summary.total}_ne_units_${members.length}`);
  }

  return {
    metricId: definition.metricId,
    version: definition.version,
    unit,
    definition: definition.definition,
    boundary: definition.boundary,
    seqUpperBound: filter.seqUpperBound,
    filter,
    denominator: members.length,
    counts: summary.counts,
    legacyOutcomeCounts,
    closed: closureErrors.length === 0,
    closureErrors,
    exclusions: [],
    unobservableReasons: [...definition.unobservableReasons]
  };
}

/** 八桶全为 0 时的空汇总（分母 0 不显示 100%）。 */
export function emptySummary(unit: MetricUnit, filter: ReconcileFilter): MetricSummary {
  return summarize(unit, filter, []);
}

// ─── auditCoverage 六项独立检查（Spec §8.2(b)）─────────────────────────────

export const AUDIT_COVERAGE_CHECKS = [
  "ingress_receive_coverage",
  "processing_terminal_coverage",
  "projection_catchup",
  "association_dependency",
  "cross_endpoint_match",
  "export_coverage"
] as const;

export type AuditCoverageCheckId = (typeof AUDIT_COVERAGE_CHECKS)[number];

export type CoverageStatus = "pass" | "fail" | "unknown" | "not_applicable";

export type CoverageCheck = {
  id: AuditCoverageCheckId;
  /** 中文标题（用户可见文案，遵守术语标准）。 */
  title: string;
  status: CoverageStatus;
  /** 分子 N。 */
  numerator: number;
  /** 分母 D。 */
  denominator: number;
  /** 单位。 */
  unit: MetricUnit;
  /** 证据来源（独立于账本投影的来源名）。 */
  evidenceSource: string;
  /** 截止位置 S。 */
  seqUpperBound: number;
  /** 差异 ID 集合。 */
  diffIds: string[];
  /** 理由（status != pass 时必填）。 */
  reason: string | null;
  /** 排除项声明。 */
  exclusions: string[];
};

export type AuditCoverageReport = {
  version: string;
  seqUpperBound: number;
  checks: CoverageCheck[];
  /** 六项是否全部有结论。unknown 不合成为 pass。 */
  allConclusive: boolean;
  /** 综合结论（仅当全部 pass 时为 pass）。 */
  combined: CoverageStatus;
};

export const COVERAGE_CHECK_TITLES: Record<AuditCoverageCheckId, string> = {
  ingress_receive_coverage: "入口接收覆盖",
  processing_terminal_coverage: "处理终态覆盖",
  projection_catchup: "投影追平",
  association_dependency: "关联依赖齐全",
  cross_endpoint_match: "跨端匹配",
  export_coverage: "导出覆盖"
};

export type CoverageInput = {
  id: AuditCoverageCheckId;
  status: CoverageStatus;
  numerator: number;
  denominator: number;
  unit: MetricUnit;
  evidenceSource: string;
  diffIds?: string[];
  reason?: string | null;
  exclusions?: string[];
};

export type AuditCoverageInput = {
  seqUpperBound: number;
  checks: ReadonlyArray<CoverageInput>;
};

/**
 * 六项检查**各自独立**判定。
 *
 * `pass` 的条件：D > 0、N = D、差异集合为空、无未披露缺口。
 * 仍在处理、indeterminate、证据缺失**不能**被充作已完成。
 * 无法建立独立预期集合时记 `unknown`（不得用同侧投影自证入口无漏记）。
 */
export function evaluateAuditCoverage(input: AuditCoverageInput): AuditCoverageReport {
  const byId = new Map(input.checks.map((check) => [check.id, check]));
  const checks: CoverageCheck[] = [];

  for (const id of AUDIT_COVERAGE_CHECKS) {
    const check = byId.get(id);
    if (!check) {
      checks.push({
        id,
        title: COVERAGE_CHECK_TITLES[id],
        status: "unknown",
        numerator: 0,
        denominator: 0,
        unit: "protocol_request",
        evidenceSource: "none",
        seqUpperBound: input.seqUpperBound,
        diffIds: [],
        reason: "check_not_provided",
        exclusions: []
      });
      continue;
    }

    const diffIds = [...(check.diffIds ?? [])];
    const exclusions = [...(check.exclusions ?? [])];
    let status: CoverageStatus = check.status;
    let reason = check.reason ?? null;

    if (status === "pass") {
      if (check.denominator <= 0) {
        status = "unknown";
        reason = "denominator_zero";
      } else if (check.numerator !== check.denominator) {
        status = "fail";
        reason = reason ?? "numerator_ne_denominator";
      } else if (diffIds.length > 0) {
        status = "fail";
        reason = reason ?? "diff_set_not_empty";
      }
    } else if (status === "fail" && !reason) {
      reason = "coverage_gap";
    } else if (status === "unknown" && !reason) {
      reason = "independent_evidence_unavailable";
    }

    checks.push({
      id,
      title: COVERAGE_CHECK_TITLES[id],
      status,
      numerator: check.numerator,
      denominator: check.denominator,
      unit: check.unit,
      evidenceSource: check.evidenceSource,
      seqUpperBound: input.seqUpperBound,
      diffIds,
      reason,
      exclusions
    });
  }

  const allConclusive = checks.every((check) => check.status !== "unknown");
  const combined: CoverageStatus = checks.every((check) => check.status === "pass")
    ? "pass"
    : checks.some((check) => check.status === "fail")
      ? "fail"
      : "unknown";

  return {
    version: "v2p5-1",
    seqUpperBound: input.seqUpperBound,
    checks,
    allConclusive,
    combined
  };
}

// ─── 差异七分类（Spec §8.2(c)）──────────────────────────────────────────────

export const RECONCILE_DIFF_CLASSES = [
  "not_sent_locally",
  "not_observed_at_ingress",
  "missing_terminal_state",
  "parameter_conflict",
  "result_conflict",
  "filtered_out",
  "pending_verification"
] as const;

export type ReconcileDiffClass = (typeof RECONCILE_DIFF_CLASSES)[number];

export type ReconcileDiff = {
  id: string;
  class: ReconcileDiffClass;
  /** 未匹配 ID。 */
  unmatchedId: string;
  /** 证据引用。 */
  evidence?: string;
};

export type ReconcileResult = {
  matchedIds: string[];
  missingIds: string[];
  extraIds: string[];
  conflictIds: string[];
  /** 不可观测 ID（缺适配器 / 无上游 ID 等），单列披露，不缩分母。 */
  unobservableIds: string[];
  diffs: ReconcileDiff[];
};

export type ReconcileInput = {
  expectedIds: string[];
  observedIds: string[];
  conflictIds?: string[];
  unobservableIds?: string[];
};

/**
 * 对账差异分类。**从不**强行配对未匹配项（Spec §12.3）。
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const expected = new Set(input.expectedIds);
  const observed = new Set(input.observedIds);
  const conflicts = new Set(input.conflictIds ?? []);
  const unobservable = new Set(input.unobservableIds ?? []);

  const matchedIds: string[] = [];
  const missingIds: string[] = [];
  const extraIds: string[] = [];

  for (const id of expected) {
    if (observed.has(id)) matchedIds.push(id);
    else if (unobservable.has(id)) continue;
    else missingIds.push(id);
  }
  for (const id of observed) {
    if (!expected.has(id)) extraIds.push(id);
  }

  const diffs: ReconcileDiff[] = [];
  for (const id of missingIds) {
    diffs.push({
      id: `missing:${id}`,
      class: conflicts.has(id) ? "parameter_conflict" : "missing_terminal_state",
      unmatchedId: id
    });
  }
  for (const id of extraIds) {
    diffs.push({ id: `extra:${id}`, class: "not_observed_at_ingress", unmatchedId: id });
  }
  for (const id of conflicts) {
    if (!diffs.some((diff) => diff.unmatchedId === id)) {
      diffs.push({ id: `conflict:${id}`, class: "result_conflict", unmatchedId: id });
    }
  }

  return {
    matchedIds,
    missingIds,
    extraIds,
    conflictIds: [...conflicts],
    unobservableIds: [...unobservable],
    diffs
  };
}

// ─── as-of S 视图（Spec §12.5 末段 / B25）──────────────────────────────────

export type AsOfRow = {
  id: string;
  /** 该行在 canonical ledger 的提交序号。 */
  ledgerSeq: number;
  /** 行上的可修订字段。 */
  fields: Record<string, unknown>;
};

export type AsOfRevision = {
  id: string;
  /** 修订事件自身的提交序号。 */
  ledgerSeq: number;
  /** 修订目标行 ID。 */
  targetRowId: string;
  /** 要覆盖的字段。 */
  fields: Record<string, unknown>;
  /** 修订原因（保留可追溯）。 */
  reason?: string;
};

export type AsOfSView<TFields extends Record<string, unknown>> = {
  seqUpperBound: number;
  /** as-of S 的行视图（已折叠修订）。 */
  rows: Array<{ id: string; ledgerSeq: number; fields: TFields }>;
  /** 实际折叠的修订 ID。 */
  appliedRevisionIds: string[];
  /** 因 seq > S 未折叠的修订（说明 as-of 视图与最新视图的差异来源）。 */
  deferredRevisionIds: string[];
  /** 因 seq > S 未纳入的行。 */
  deferredRowIds: string[];
  /** 闭合断言：行数 = 基础行数（<= S）。 */
  closed: boolean;
  closureErrors: string[];
};

/**
 * `deriveAsOfSView(snapshot, S)`。
 *
 * 基础行 = `ledger_seq <= S`；修订事件 = `ledger_seq <= S`，按 ledger_seq 升序
 * 折叠进目标行。**禁止**「只按 seq 过滤就宣称修订视图一致」——本函数同时
 * 报告被推迟的修订 ID，使调用方能披露 as-of 视图与最新视图的差异来源。
 */
export function deriveAsOfSView<TFields extends Record<string, unknown>>(
  snapshot: {
    rows: ReadonlyArray<AsOfRow>;
    revisions: ReadonlyArray<AsOfRevision>;
  },
  seqUpperBound: number
): AsOfSView<TFields> {
  const closureErrors: string[] = [];

  const includedRows = snapshot.rows.filter((row) => row.ledgerSeq <= seqUpperBound);
  const deferredRowIds = snapshot.rows
    .filter((row) => row.ledgerSeq > seqUpperBound)
    .map((row) => row.id);

  const includedRevisions = snapshot.revisions
    .filter((revision) => revision.ledgerSeq <= seqUpperBound)
    .sort((a, b) => a.ledgerSeq - b.ledgerSeq || a.id.localeCompare(b.id));
  const deferredRevisionIds = snapshot.revisions
    .filter((revision) => revision.ledgerSeq > seqUpperBound)
    .map((revision) => revision.id);

  const folded = new Map<string, { id: string; ledgerSeq: number; fields: Record<string, unknown> }>();
  for (const row of includedRows) {
    folded.set(row.id, { id: row.id, ledgerSeq: row.ledgerSeq, fields: { ...row.fields } });
  }

  const appliedRevisionIds: string[] = [];
  for (const revision of includedRevisions) {
    const target = folded.get(revision.targetRowId);
    if (!target) {
      // 修订目标行不在 as-of S 内：修订不得凭空创造行。
      closureErrors.push(`revision_target_not_in_view:${revision.id}`);
      continue;
    }
    target.fields = { ...target.fields, ...revision.fields };
    appliedRevisionIds.push(revision.id);
  }

  const rows = [...folded.values()].map((row) => ({
    id: row.id,
    ledgerSeq: row.ledgerSeq,
    fields: row.fields as TFields
  }));

  if (rows.length !== includedRows.length) {
    closureErrors.push(`row_count_${rows.length}_ne_base_${includedRows.length}`);
  }

  return {
    seqUpperBound,
    rows,
    appliedRevisionIds,
    deferredRevisionIds,
    deferredRowIds,
    closed: closureErrors.length === 0,
    closureErrors
  };
}

/** 供汇总使用的空桶常量（避免调用方重复构造）。 */
export { emptyPrimaryStatusCounts, PRIMARY_STATUSES };

// ─── B25：账本提交序号解析器 ─────────────────────────────────────────────────
//
// `access_log.ledger_seq` / `association_revisions.ledger_seq` 记录该行写入时
// canonical ledger 的**已提交上界**（`MAX(seq)`）。
//
// 口径说明：
//   - 该口径是**保守上界**：行只在其 ledger_seq 之后才可能被后续账本事件改变，
//     因此 as-of S 视图纳入 `ledger_seq <= S` 的行是安全的。
//   - 它**不是**「该行所依赖的全部账本事件序号」：access_log 行在
//     `response_prepared` 提交**之前**写入，因此行的 `delivery_status` 反映
//     写入时刻的观测。精确的 as-of 视图仍需账本历史（Spec N18）。
//
// 解析器放在本模块而不是 `proxy/audit.ts`：后者在若干测试里被整模块 mock，
// 解析器必须能被生产装配点独立注入。

export type LedgerSeqResolver = () => Promise<number | null>;
let ledgerSeqResolver: LedgerSeqResolver | null = null;

/** 注入账本序号解析器（生产在 `buildProxy` 装配；测试可注入）。 */
export function setLedgerSeqResolver(resolver: LedgerSeqResolver | null): void {
  ledgerSeqResolver = resolver;
}

/** 取当前账本已提交上界；不可得时返回 null（不抛错，不阻断审计写入）。 */
export async function resolveLedgerSeq(): Promise<number | null> {
  if (!ledgerSeqResolver) return null;
  try {
    return await ledgerSeqResolver();
  } catch {
    return null;
  }
}
