// ARV25-V01..V12 executable case descriptors (Plan W2-OBSERVE / Track C).
//
// Authority: docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md §7
//   ("验收矩阵。V01–V12 全部未执行。").  Each descriptor carries the verbatim
//   scenario and "必须断言" text of its OWN row plus id-specific assertion
//   steps derived from that row.
//
// READ-ONLY BOUNDARY (Plan §2, concurrent-agent isolation):
//   The reconciliation read model itself lives in files another agent owns
//   (webui/server/admin/reconciliation.ts, reconciliation-ports.ts,
//   audit-reconciliation-routes.ts).  This module therefore NEVER imports or
//   asserts on those internals.  It only declares, per requirement id,
//   which PUBLIC surface (the three /api/admin/audit/reconciliation/* routes,
//   the audit page and the CSV export) must carry which fact, and which
//   evidence dimension proves it.
//
// The shared OBSERVE vocabulary (verdicts, expectations, the two judges)
// comes from scripts/e2e/lib/audit-v025.mjs so the three OBSERVE modules
// cannot drift apart.

import { manifestEntry } from "./audit-v025.mjs";

export const RECONCILIATION_SOURCE_SPEC = "docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md";
export const RECONCILIATION_SOURCE_TABLE = "§7";

/** ARV25 requirement ids, in source order. */
export const ARV25_IDS = Object.freeze([
  "V01", "V02", "V03", "V04", "V05", "V06",
  "V07", "V08", "V09", "V10", "V11", "V12"
]);

/** The source Spec §7 columns a step may be derived from. */
export const RECONCILIATION_SOURCE_COLUMNS = Object.freeze(["场景", "必须断言"]);

/** The public read surfaces a reconciliation requirement is proved on. */
export const RECONCILIATION_PUBLIC_SURFACES = Object.freeze([
  "GET /api/admin/audit/reconciliation/inquiries/:turnId",
  "GET /api/admin/audit/reconciliation/usage",
  "GET /api/admin/audit/reconciliation/export",
  "admin audit page (read-only)",
  "reconciliation CSV export"
]);

const CONTRACT_DIMENSION = Object.freeze({
  name: "descriptor_manifest_spec_agreement",
  layer: "contract",
  computableHere: true,
  blockedReason: null,
  note: "描述符 ↔ 覆盖清单 ↔ 源 Spec 的一致性；本机可判定"
});

function runtime(name, note, layer = "runtime") {
  return { name, layer, computableHere: false, blockedReason: "environment", note };
}

function makeDescriptor({
  executionId,
  sourceRequirementId,
  sourceScenario,
  sourceJudgement,
  assertionSteps,
  dimensions,
  blockedReason,
  references = []
}) {
  const entry = manifestEntry(executionId);
  return Object.freeze({
    executionId,
    sourceRequirementId,
    sourceSpec: RECONCILIATION_SOURCE_SPEC,
    sourceTable: RECONCILIATION_SOURCE_TABLE,
    ownerBranch: entry.ownerBranch,
    priority: entry.priority,
    requiredExecutors: Object.freeze([...entry.executors]),
    requiredCapabilities: Object.freeze([...entry.requires]),
    assertionTokens: Object.freeze([...entry.assert]),
    expectedArtifacts: Object.freeze([...entry.artifacts]),
    publicSurfaces: RECONCILIATION_PUBLIC_SURFACES,
    source: Object.freeze({
      scenario: sourceScenario,
      judgement: sourceJudgement,
      columns: Object.freeze([...RECONCILIATION_SOURCE_COLUMNS])
    }),
    assertionSteps: Object.freeze(assertionSteps.map((s) => Object.freeze({ ...s }))),
    dimensions: Object.freeze(dimensions.map((d) => Object.freeze({ ...d }))),
    blockedReason,
    noBusinessReexecution: false,
    failClosed: assertionSteps.some((s) => s.expectation === "refuse"),
    noAdvance: assertionSteps.some((s) => s.expectation === "not_advance"),
    references: Object.freeze([...references])
  });
}

const reconciliationCases = [
  makeDescriptor({
    executionId: "ARV25-V01",
    sourceRequirementId: "V01",
    sourceScenario: "一笔问询涉及 13 张以上表且含长名称",
    sourceJudgement: "详情可见全部完整表身份，数量与去重集合一致，无「等 N 个」信息断点",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("inquiry_with_13_plus_tables", "构造一笔含 13 张以上表且含长名称的问询"),
      runtime("full_table_identity_list", "详情与 API/CSV 的完整表身份集合")
    ],
    assertionSteps: [
      { stepId: "V01-1", dimension: "audit_event", derivedFrom: "必须断言", expectation: "observe", evidence: "问询详情", statement: "详情列出全部 13 张以上表的完整 connectionId/schema/table。" },
      { stepId: "V01-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "问询详情", statement: "表数量与去重集合一致；长表名不被截断，无「等 N 个」信息断点。" },
      { stepId: "V01-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "问询详情 / API / CSV", statement: "同筛选同 S 下，详情与 API/CSV 看到的是同一张表身份集合。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V02",
    sourceRequirementId: "V02",
    sourceScenario: "同名表位于两个连接／Schema",
    sourceJudgement: "不合并；详情、排行、API、CSV 均保留完整身份",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("same_name_two_connections", "同名表位于两个连接／Schema")
    ],
    assertionSteps: [
      { stepId: "V02-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "问询详情", statement: "两个连接／Schema 的同名表各自独立列出，不合并。" },
      { stepId: "V02-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "详情 / 排行 / API / CSV", statement: "详情、排行、API、CSV 四个面都保留完整身份，不以显示字符串作关联键。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V03",
    sourceRequirementId: "V03",
    sourceScenario: "调用无表身份或只有不可核验 SQL 文本",
    sourceJudgement: "显示未知与原因，不猜表、不填空数组冒充无访问",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("call_without_table_identity", "调用无表身份"),
      runtime("unverifiable_sql_text_only", "只有不可核验 SQL 文本")
    ],
    assertionSteps: [
      { stepId: "V03-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "问询详情", statement: "无表身份的调用进入独立未知桶并显示原因。" },
      { stepId: "V03-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "问询详情", statement: "只有不可核验 SQL 文本时不猜表；确需解析时保留解析版本、置信状态与原始事件引用。" },
      { stepId: "V03-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "问询详情", statement: "不填空数组冒充「无访问」。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V04",
    sourceRequirementId: "V04",
    sourceScenario: "真实预算终止、普通超时、权限拒绝、部分可继续结果",
    sourceJudgement: "只有预算终止显示已用尽；其余主状态与预算语义正确",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("real_budget_exhaustion_case", "真实预算终止"),
      runtime("timeout_denial_continuable_cases", "普通超时、权限拒绝与部分可继续结果")
    ],
    assertionSteps: [
      { stepId: "V04-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "问询详情", statement: "只有主状态为 budget_stopped 的那一条显示「问询预算已用尽」。" },
      { stepId: "V04-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "问询详情", statement: "普通超时显示 timeout、权限拒绝显示 denied；两者都不显示预算用尽。" },
      { stepId: "V04-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "问询详情", statement: "部分可继续结果保持可继续语义，不等于权限拒绝，也不冒充预算终止。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V05",
    sourceRequirementId: "V05",
    sourceScenario: "并发调用、缺起止、多次重试",
    sourceJudgement: "历时、累计耗时、调用数与尝试数分别正确；未知不填 0",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("concurrent_calls_elapsed_span", "并发调用下的历时与累计耗时"),
      runtime("missing_timestamps_unknown_not_zero", "缺起止的调用"),
      runtime("retries_attempt_count", "多次重试")
    ],
    assertionSteps: [
      { stepId: "V05-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "问询详情", statement: "问询历时与累计工具耗时分别给出；并发时累计可大于历时，二者不互相冒充。" },
      { stepId: "V05-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "问询详情", statement: "调用数与尝试数分别计数；一次调用的多次尝试不折叠成多次调用。" },
      { stepId: "V05-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "问询详情", statement: "缺起止时耗时为 null 并带空值原因，不填 0。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V06",
    sourceRequirementId: "V06",
    sourceScenario: "已确认、候选、冲突、仅握手混合集合",
    sourceJudgement: "分母与计数分别正确，候选不升级，握手不进业务问询分母",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("mixed_attribution_set", "已确认、候选、冲突与仅握手混合的调用集合")
    ],
    assertionSteps: [
      { stepId: "V06-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "使用概况", statement: "confirmed / candidate / conflict / 仅握手分别计数，分母与计数各自正确。" },
      { stepId: "V06-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "使用概况", statement: "候选关联不升级为已确认关联。" },
      { stepId: "V06-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "使用概况", statement: "仅握手访问不进入业务问询分母。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V07",
    sourceRequirementId: "V07",
    sourceScenario: "配置 5 个 Token，窗口内 3 个活跃",
    sourceJudgement: "两数及已配置未活跃集合与 Token 页、调用流水一致",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("five_configured_three_active_tokens", "配置 5 个 Token、窗口内 3 个活跃")
    ],
    assertionSteps: [
      { stepId: "V07-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "使用概况", statement: "配置 Token 数=5 与窗口内活跃 Token 数=3 分别给出，不互相替代。" },
      { stepId: "V07-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "使用概况 / Token 页", statement: "已配置未活跃集合（2 个）与 Token 页一致。" },
      { stepId: "V07-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "使用概况 / 调用流水", statement: "窗口内活跃身份集合与调用流水一致；协议事件另列，不偷换分母。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V08",
    sourceRequirementId: "V08",
    sourceScenario: "活跃数大于当前配置数，含停用／删除和未知历史身份",
    sourceJudgement: "按差异原因解释，不统一报数据异常，不强行配平",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("active_exceeds_configured_with_reasons", "活跃数大于配置数，含停用／删除与未知历史身份")
    ],
    assertionSteps: [
      { stepId: "V08-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "使用概况", statement: "差异按原因分类解释（窗口内停用／删除、配置快照时点不同、历史身份未核验）。" },
      { stepId: "V08-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "使用概况", statement: "不统一报「数据异常」。" },
      { stepId: "V08-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "使用概况", statement: "不强行配平：未知身份不并入配置数或活跃确定数，单列未知身份数量与原因。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V09",
    sourceRequirementId: "V09",
    sourceScenario: "API／UI／CSV 同筛选与 S",
    sourceJudgement: "八桶互斥且合计闭合，表清单、Token 集合、规则版本与差异 ID 一致；精确 as-of 未证明时正式完整读取与导出阻断，诊断结果显式不完整",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("api_ui_csv_same_snapshot", "同筛选与同账本上界 S 的 API／UI／CSV 三面")
    ],
    assertionSteps: [
      { stepId: "V09-1", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "使用概况 / CSV", statement: "三面的八桶互斥且合计等于集合总数；比率同时给出 N／D，D 不可观测时不显示 0% 或 100%。" },
      { stepId: "V09-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "使用概况 / CSV", statement: "表清单、Token 集合、规则版本与差异 ID 在三面一致。" },
      { stepId: "V09-3", dimension: "consistency", derivedFrom: "场景", expectation: "preserve", evidence: "使用概况", statement: "三面使用同一筛选与同一账本上界 S，不静默换用较新数据。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V10",
    sourceRequirementId: "V10",
    sourceScenario: "新事件在导出期间到达、投影未追平、分页及 S 后事实修订",
    sourceJudgement: "当前上下文不混入 >S；捕获 S 后改变基础执行／交付事实、覆盖归属有效值或迟到 ACK，同 S 重读仍不漂移；未追平或 as-of 未证明时正式模式失败；分页不丢重",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("new_event_during_export", "导出期间到达的新事件", "fault"),
      runtime("projection_not_covered_formal_mode", "投影未追平"),
      runtime("paged_export_integrity", "分页导出")
    ],
    assertionSteps: [
      { stepId: "V10-1", dimension: "deny", derivedFrom: "必须断言", expectation: "refuse", evidence: "导出响应", statement: "投影未追平时正式模式导出失败，不产出正式包。" },
      { stepId: "V10-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "导出内容", statement: "导出期间到达的新事件（>S）不混入当前上下文。" },
      { stepId: "V10-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "分页集合", statement: "分页不丢不重：页 ID 集合无重复、无缺失。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V11",
    sourceRequirementId: "V11",
    sourceScenario: "无权限、撤权、敏感表名、Token 与 CSV 注入",
    sourceJudgement: "拒绝或脱敏符合既有策略；meta-audit 完整；无凭据值泄露",
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("no_permission_and_revoked_role", "无权限与撤权读取"),
      runtime("sensitive_table_name_redaction", "敏感表名脱敏"),
      runtime("token_and_csv_injection", "Token 与 CSV 注入")
    ],
    assertionSteps: [
      { stepId: "V11-1", dimension: "deny", derivedFrom: "必须断言", expectation: "refuse", evidence: "读取响应", statement: "无权限与撤权后的对账读取被拒绝（RECONCILIATION_READ_REFUSED 语义）。" },
      { stepId: "V11-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "preserve", evidence: "读取响应 / CSV", statement: "敏感表名脱敏符合既有策略；Token 与 CSV 注入被中和，不改写相邻单元格或字段。" },
      { stepId: "V11-3", dimension: "audit_event", derivedFrom: "必须断言", expectation: "observe", evidence: "meta-audit 记录", statement: "每次对账读取都留下完整 meta-audit 记录（含拒绝路径）。" },
      { stepId: "V11-4", dimension: "no_leak", derivedFrom: "必须断言", expectation: "observe", evidence: "读取响应 / CSV", statement: "响应与 CSV 中无凭据值泄露。" }
    ]
  }),

  makeDescriptor({
    executionId: "ARV25-V12",
    sourceRequirementId: "V12",
    sourceScenario: "候选 linux/amd64 单副本 K8s 证据",
    sourceJudgement: "同一候选镜像完成只读问询与 Token 对账旅程，证据包可复查；缺环境不记 passed",
    blockedReason: "delivery",
    dimensions: [
      CONTRACT_DIMENSION,
      { name: "customer_amd64_single_replica_candidate", layer: "delivery", computableHere: false, blockedReason: "delivery", note: "候选 linux/amd64 单副本 K8s 实例；缺环境时不得记 passed" },
      { name: "reviewable_reconciliation_evidence_pack", layer: "delivery", computableHere: false, blockedReason: "delivery", note: "同一候选镜像的只读问询与 Token 对账旅程证据包" }
    ],
    assertionSteps: [
      { stepId: "V12-1", dimension: "audit_event", derivedFrom: "必须断言", expectation: "observe", evidence: "候选实例证据", statement: "同一候选镜像完成只读问询与 Token 对账旅程。" },
      { stepId: "V12-2", dimension: "consistency", derivedFrom: "必须断言", expectation: "observe", evidence: "证据包", statement: "证据包可复查：账本上界 S、筛选、规则版本与三面输出互相可核对。" },
      { stepId: "V12-3", dimension: "consistency", derivedFrom: "必须断言", expectation: "not_advance", evidence: "结果记录", statement: "缺环境不记 passed：未取得候选 amd64 单副本证据时状态只能是 blocked(not_run 之外) 且带 blockedReason=delivery。" }
    ]
  })
];

/** The 12 ARV25 descriptors, in source order. */
export const RECONCILIATION_V025_CASES = Object.freeze(reconciliationCases);

/** ARV25 ids that require customer amd64 delivery evidence to close. */
export const RECONCILIATION_DELIVERY_BLOCKED_IDS = Object.freeze(["V12"]);

/** ARV25 ids whose judgement requires a hard refusal. */
export const RECONCILIATION_REFUSAL_IDS = Object.freeze(["V10", "V11"]);

/** ARV25 ids whose judgement requires that a state does NOT advance. */
export const RECONCILIATION_NO_ADVANCE_IDS = Object.freeze([
  "V03", "V04", "V05", "V06", "V08", "V10", "V12"
]);
