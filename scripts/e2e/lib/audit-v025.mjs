// AUD25-A01..A12 executable case descriptors (Plan W2-OBSERVE / Track C).
//
// Authority: docs/specs/lucy-20261020-v2p5-audit-increment-spec.md §13.2
//   ("验收场景详表（全部未执行）").  Every descriptor below carries the
//   verbatim scenario title and judgement rule of ITS OWN source row, plus
//   id-specific assertion steps derived from that row's columns.  The frozen
//   scenario ids (SEC-19-*) are NOT copied: the source Spec §13.3 only
//   registers the correspondence, it does not replace the requirement.
//
// This module also hosts the shared OBSERVE-branch vocabulary (verdict /
// expectation semantics and the two judges).  The reconciliation and
// multi-turn-log descriptor modules import those primitives from here so
// the three modules cannot drift apart.
//
// Hard rules encoded here (never to be weakened by an implementation):
//   * A descriptor NEVER asserts a runtime result.  It declares which
//     evidence dimension proves the requirement and, when that dimension
//     needs a real environment, the `blocked` reason.
//   * The audit ledger, the barrier machine and the export pack are NOT
//     re-implemented here.  The descriptors only state the contract that
//     those components must satisfy through their public surfaces.
//   * `statusFromDimensions()` (scripts/e2e/lib/v025-result.mjs) decides the
//     final status; a single executed layer is never a pass.

import { loadCoverage } from "./v025-coverage.mjs";

export const AUDIT_SOURCE_SPEC = "docs/specs/lucy-20261020-v2p5-audit-increment-spec.md";
export const AUDIT_SOURCE_TABLE = "§13.2";

/** AUD25 requirement ids, in source order. */
export const AUD25_IDS = Object.freeze([
  "A01", "A02", "A03", "A04", "A05", "A06",
  "A07", "A08", "A09", "A10", "A11", "A12"
]);

/**
 * The eight primary-status buckets of the frozen derivation table
 * (Audit Spec §4.3(a), derivationVersion=v2p5-1).  This is an ASSERTION
 * vocabulary, not a second classifier: no production path reads it.
 */
export const AUDIT_PRIMARY_STATUS_BUCKETS = Object.freeze([
  "succeeded", "failed", "denied", "budget_stopped",
  "cancelled", "timeout", "indeterminate", "unknown"
]);

// ── shared OBSERVE vocabulary ───────────────────────────────────────────────

/** What a single observation of one assertion step can report. */
export const OBSERVE_VERDICTS = Object.freeze([
  "refused", "advanced", "preserved", "unknown", "failed"
]);

/** What an assertion step demands of that observation. */
export const OBSERVE_EXPECTATIONS = Object.freeze([
  "refuse", "not_advance", "preserve", "observe"
]);

/** Acceptable verdicts per expectation. */
export const OBSERVE_EXPECTED_VERDICTS = Object.freeze({
  refuse: ["refused"],
  not_advance: ["refused", "preserved"],
  preserve: ["preserved"],
  observe: ["refused", "advanced", "preserved", "unknown"]
});

/**
 * Judges the descriptor's assertion steps against runtime observations.
 *
 * `observations` maps a stepId to one of OBSERVE_VERDICTS.  A permissive
 * result (e.g. "advanced" where the step demands a refusal) is REJECTED —
 * this is the fail-closed property, not a convenience.
 *
 * Returns `{ ok, failures }`; `failures` is empty when every step holds.
 */
export function judgeSteps(descriptor, observations = {}, steps = descriptor.assertionSteps ?? []) {
  const failures = [];
  for (const step of steps) {
    const verdict = observations[step.stepId];
    const acceptable = OBSERVE_EXPECTED_VERDICTS[step.expectation] ?? [];
    if (!verdict) {
      failures.push(`${descriptor.executionId}/${step.stepId}: no observation`);
      continue;
    }
    if (!OBSERVE_VERDICTS.includes(verdict)) {
      failures.push(`${descriptor.executionId}/${step.stepId}: unknown verdict "${verdict}"`);
      continue;
    }
    if (!acceptable.includes(verdict)) {
      failures.push(
        `${descriptor.executionId}/${step.stepId}: expected ${step.expectation} (${acceptable.join("|")}) but observed "${verdict}"`
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Judges ONLY the fail-closed steps (expectation `refuse` / `not_advance`).
 * Used by the negative test: a permissive verdict on such a step must fail.
 */
export function judgeFailClosed(descriptor, observations = {}) {
  const closed = (descriptor.assertionSteps ?? []).filter(
    (s) => s.expectation === "refuse" || s.expectation === "not_advance"
  );
  return judgeSteps(descriptor, observations, closed);
}

/**
 * Judges the "a crash or replay never silently re-executes business" rule.
 *
 * `observation` carries the upstream execution counters around the fault:
 * `{ upstreamCallsBefore, upstreamCallsAfter }`.  Any increase is a defect
 * for a descriptor whose `noBusinessReexecution` flag is set.
 */
export function judgeNoBusinessReexecution(descriptor, observation = {}) {
  const failures = [];
  if (!descriptor.noBusinessReexecution) return { ok: true, failures };
  const before = observation.upstreamCallsBefore;
  const after = observation.upstreamCallsAfter;
  if (typeof before !== "number" || typeof after !== "number") {
    failures.push(`${descriptor.executionId}: upstream execution counters missing`);
    return { ok: false, failures };
  }
  if (after > before) {
    failures.push(
      `${descriptor.executionId}: business was re-executed after the fault (upstream calls ${before} -> ${after})`
    );
  }
  return { ok: failures.length === 0, failures };
}

/** True when the descriptor demands a hard refusal at least once. */
export function hasRefusalStep(descriptor) {
  return (descriptor.assertionSteps ?? []).some((s) => s.expectation === "refuse");
}

/** True when the descriptor demands that a state does NOT advance. */
export function hasNoAdvanceStep(descriptor) {
  return (descriptor.assertionSteps ?? []).some((s) => s.expectation === "not_advance");
}

// ── descriptor assembly ─────────────────────────────────────────────────────

const coverage = loadCoverage();
const manifestById = new Map(coverage.newScenarios.map((s) => [s.executionId, s]));

/** The approved manifest entry for an execution id (never a local copy). */
export function manifestEntry(executionId) {
  const entry = manifestById.get(executionId);
  if (!entry) throw new Error(`no approved coverage manifest entry for ${executionId}`);
  return entry;
}

function makeDescriptor({
  executionId,
  sourceRequirementId,
  sourceSpec,
  sourceTable,
  sourceScenario,
  sourceJudgement,
  sourceColumns,
  assertionSteps,
  dimensions,
  blockedReason,
  noBusinessReexecution = false,
  references = []
}) {
  const entry = manifestEntry(executionId);
  return Object.freeze({
    executionId,
    sourceRequirementId,
    sourceSpec,
    sourceTable,
    ownerBranch: entry.ownerBranch,
    priority: entry.priority,
    requiredExecutors: Object.freeze([...entry.executors]),
    requiredCapabilities: Object.freeze([...entry.requires]),
    assertionTokens: Object.freeze([...entry.assert]),
    expectedArtifacts: Object.freeze([...entry.artifacts]),
    source: Object.freeze({
      scenario: sourceScenario,
      judgement: sourceJudgement,
      columns: Object.freeze([...sourceColumns])
    }),
    assertionSteps: Object.freeze(assertionSteps.map((s) => Object.freeze({ ...s }))),
    dimensions: Object.freeze(dimensions.map((d) => Object.freeze({ ...d }))),
    blockedReason,
    noBusinessReexecution,
    failClosed: hasRefusalStep({ assertionSteps }),
    noAdvance: hasNoAdvanceStep({ assertionSteps }),
    references: Object.freeze([...references])
  });
}

/** The source Spec §13.2 column names a step may be derived from. */
export const AUDIT_SOURCE_COLUMNS = Object.freeze([
  "输入 / 前置条件", "故障点", "预期事件集合与状态/关系", "证据位置", "判定规则"
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

// ── AUD25-A01..A12 ──────────────────────────────────────────────────────────

const auditCases = [
  makeDescriptor({
    executionId: "AUD25-A01",
    sourceRequirementId: "A01",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "持久前缀与崩溃恢复",
    sourceJudgement: "已持久事件不消失；无 admitted 不分派；仅 received 的请求在 received_at+24h 也须结算；重启不延长截止时间；无持久 received 的独立到达项须出现在 missing_ids，不能用 received／拒绝并集吞掉",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    noBusinessReexecution: true,
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("ledger_prefix_survives_crash", "在 received 成功后/admitted 前强杀后读取账本原前缀", "fault"),
      runtime("no_dispatch_without_admitted", "admitted 后/分派前强杀后核对上游观测无分派", "fault"),
      runtime("recovery_marker_idempotent", "重复重启后恢复标记不重复追加"),
      runtime("deadline_not_extended_on_restart", "重启不延长 received_at+24h 截止时间"),
      runtime("unclosed_received_settled_after_24h", "仅 received 的请求在 received_at+24h 仍须结算")
    ],
    assertionSteps: [
      { stepId: "A01-1", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "账本原前缀", statement: "received 成功后/admitted 前强杀：已提交的 received 事件前缀仍在，故障点之后的事件不得被补造。" },
      { stepId: "A01-2", dimension: "audit_event", derivedFrom: "判定规则", expectation: "not_advance", evidence: "账本原前缀、上游观测", statement: "admitted 后/分派前强杀：admitted 事件保留且上游无对应分派（无 admitted 不分派）。" },
      { stepId: "A01-3", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "账本原前缀", statement: "执行后/prepared 前强杀：已提交前缀存在，执行事实不被改写。" },
      { stepId: "A01-4", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "账本原前缀", statement: "prepared 后/发送前强杀：prepared 凭据存在，交付观察停在 prepared/sent，不写 acknowledged。" },
      { stepId: "A01-5", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "恢复修订", statement: "启动从账本派生未闭合操作并追加恢复标记；重复重启幂等，不重复追加恢复标记。" },
      { stepId: "A01-6", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "上游观测", statement: "崩溃后不自动重执行业务：上游执行次数不因重启增加。" },
      { stepId: "A01-7", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "账本原前缀", statement: "仅 received 的请求在 received_at+24h 也须结算；重启不延长截止时间。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A02",
    sourceRequirementId: "A02",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "各持久化屏障不可用",
    sourceJudgement: "禁止“无凭据或未执行”二选一；逐屏障断言；U3 仅阻断无缓冲；received 失败无三头，后续失败引用同一 received ID；A02-R 另含合法独立到达但拒绝表无行子例，不缩分母；A02-C 不确认接收；A02-T 不要求撤回已发送内容；任何闭包失败不得伪发成功凭据",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    noBusinessReexecution: true,
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("received_barrier_commit_fails", "注入 received 提交失败（只读/满/提交超时）", "fault"),
      runtime("admitted_barrier_commit_fails", "注入 admitted 提交失败", "fault"),
      runtime("prepared_barrier_commit_fails", "注入 response_prepared 提交失败", "fault"),
      runtime("audit_credential_headers_refused", "received 失败时响应不回传三项审计凭据头")
    ],
    assertionSteps: [
      { stepId: "A02-1", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "账本、入口观测、上游日志", statement: "received 提交失败：无持久接收确认且无上游分派（失败关闭，不得放行）。" },
      { stepId: "A02-2", dimension: "audit_event", derivedFrom: "判定规则", expectation: "refuse", evidence: "入口观测", statement: "received 失败时不回传三项审计凭据头。" },
      { stepId: "A02-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "账本、上游日志", statement: "admitted 提交失败：可有 received，但无上游分派。" },
      { stepId: "A02-4", dimension: "audit_event", derivedFrom: "判定规则", expectation: "preserve", evidence: "入口观测、账本", statement: "admitted 前失败且 received 已提交时，凭据头指向该 received ID，不指向不存在的 admitted。" },
      { stepId: "A02-5", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "发送观测、上游日志", statement: "prepared 提交失败：上游可能已执行但不释放内容，保留此前前缀并产生独立告警。" },
      { stepId: "A02-6", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "账本", statement: "禁止“无凭据或未执行”二选一：三个屏障逐屏障断言；U3 已冻结，仅阻断不降级放行。" },
      { stepId: "A02-7", dimension: "artifact_scan", derivedFrom: "判定规则", expectation: "not_advance", evidence: "账本", statement: "无缓冲测试项：不得靠内存缓冲冒充已持久化。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A03",
    sourceRequirementId: "A03",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "事件重投与业务重试",
    sourceJudgement: "同一调用多条生命周期/客户端事件不误合并、不重复计工具数；A03-ACK 不重复 observation／ACK、不重执行业务，重启与同 ID 重投均幂等补闭包",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    noBusinessReexecution: true,
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("ledger_replay_same_event_id", "同 event_id 账本重放", "fault"),
      runtime("observation_replay_same_client_event_id", "同 clientEventId 观测重投"),
      runtime("new_request_retry_attempt_lineage", "新请求实际重试的 attempt 谱系")
    ],
    assertionSteps: [
      { stepId: "A03-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "账本、投影", statement: "同 event_id 账本重放：幂等，工具调用数不增加。" },
      { stepId: "A03-2", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "客户端观测", statement: "同 clientEventId 异内容重投：保留冲突，不覆盖原观测。" },
      { stepId: "A03-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "observe", evidence: "账本", statement: "新请求实际重试：生成新 attempt，retry_of 指向原入口 event_id，parent_attempt_id 指向原 attempt_id。" },
      { stepId: "A03-4", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "账本、投影", statement: "同一调用的多条生命周期/客户端事件不误合并，工具调用数不重复计。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A04",
    sourceRequirementId: "A04",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "执行与交付断点",
    sourceJudgement: "不虚构 Lucy 已知成功、不自动重放；dogfood 有效 result_received 可升级 acknowledged；未接通/缺回执保留 prepared/sent 事实，客户端接收观察为 unknown；72h 仍不写 unacknowledged",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    noBusinessReexecution: true,
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("send_lost_after_persisted_success", "Lucy 已持久执行成功但发送丢失", "fault"),
      runtime("upstream_done_response_lost", "上游执行而回包未达 Lucy", "fault"),
      runtime("delivery_ack_upgrade_path", "dogfood result_received 升级 acknowledged 的路径")
    ],
    assertionSteps: [
      { stepId: "A04-1", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "账本", statement: "断点 a：execution=succeeded、delivery=unknown（或实际发送观测），不得改写为执行失败。" },
      { stepId: "A04-2", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "账本、上游凭据", statement: "断点 b：execution=unknown、primary=indeterminate，凭据核验后追加结果，不虚构 Lucy 已知成功。" },
      { stepId: "A04-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "客户端接收观测", statement: "无客户端接收证据不写 acknowledged；未接通/缺回执保留 prepared/sent 事实，客户端接收观察为 unknown。" },
      { stepId: "A04-4", dimension: "consistency", derivedFrom: "判定规则", expectation: "observe", evidence: "账本", statement: "只有 dogfood 有效 result_received 才可升级 acknowledged；72h 仍不写 unacknowledged。" },
      { stepId: "A04-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "上游凭据", statement: "不自动重放：断点恢复后上游执行次数不增加。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A05",
    sourceRequirementId: "A05",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "协议/执行/错误独立",
    sourceJudgement: "HTTP 200 不增加执行成功；无源错误不编权限拒绝；budget_stopped 不覆盖已发生授权裁决，也不反推 not_evaluated",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("http_200_with_tool_is_error", "HTTP 成功但工具 isError"),
      runtime("jsonrpc_invalid_params", "JSON-RPC -32602"),
      runtime("explicit_table_required_empty_and_table", "explicit_table_required:<empty> 与 <table>"),
      runtime("upstream_error_layering", "上游错误的四轴分层")
    ],
    assertionSteps: [
      { stepId: "A05-1", dimension: "audit_event", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "原始响应、调用流水", statement: "HTTP 200 但工具 isError：保留原始码与规范化原因，execution 不因 200 增加成功。" },
      { stepId: "A05-2", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "汇总", statement: "JSON-RPC -32602 归入参/用法语义，不得编成权限拒绝。" },
      { stepId: "A05-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "汇总", statement: "explicit_table_required:<empty> 归用法语义；只有带真实授权裁决的 <table> 才归权限。" },
      { stepId: "A05-4", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "observe", evidence: "调用流水、汇总", statement: "transport、authorization、execution、usability 四轴分别判定，互不折叠。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A06",
    sourceRequirementId: "A06",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "八桶与预算连续性",
    sourceJudgement: "每单位恰一个桶；闭合失败/成功先于取消/超时；互斥闭合或时序不可核验则 unknown+conflict；预算读写失败不得伪造耗尽凭据；历史旧 outcome 单列 31=23+3+4+1，不当新派生结果",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("eight_buckets_mutually_exclusive_closed", "构造八桶并核对合计闭合"),
      runtime("completion_cancel_timeout_race", "完成/取消/超时竞争"),
      runtime("budget_exhaustion_and_resume", "预算耗尽、重连、缺 begin 与续跑")
    ],
    assertionSteps: [
      { stepId: "A06-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "observe", evidence: "同截止明细、汇总", statement: "八桶均可达且互斥；每单位恰一个桶，合计等于集合总数。" },
      { stepId: "A06-2", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "同截止明细", statement: "仅有取消请求不算 confirmed cancelled。" },
      { stepId: "A06-3", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "同截止明细", statement: "闭合失败/成功凭据先于取消/超时裁决。" },
      { stepId: "A06-4", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "同截止明细", statement: "同一尝试互斥闭合或无法核验时序时为 unknown+conflict，不选边。" },
      { stepId: "A06-5", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "同截止明细、预算事件", statement: "budget_stopped 独立成桶，不折叠为 denied 或 interrupted。" },
      { stepId: "A06-6", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "预算事件", statement: "预算四维（业务调用数/尝试次数/墙钟/并发占用）不因重连或缺 begin 重置，续跑关系保留。" },
      { stepId: "A06-7", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "汇总", statement: "历史旧 outcome 单列 31=23+3+4+1，不得当作新派生结果。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A07",
    sourceRequirementId: "A07",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "多层 ID 与复用",
    sourceJudgement: "历史 2380/2454 等关系保留；HTTP/SSE 回传均引用已提交 received，旧客户端未协商时不插 meta 扩展帧；无证据能力不虚报",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("rpc_id_reuse_not_merged", "同会话复用 RPC ID 0–3"),
      runtime("same_sql_two_requests_not_merged", "同 SQL 的两个独立请求"),
      runtime("client_call_multi_observation_attempt", "一 client_call 多观测/多尝试"),
      runtime("upstream_id_capability_not_claimed", "上游不支持 ID 时的能力声明")
    ],
    assertionSteps: [
      { stepId: "A07-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "身份关系清单", statement: "同会话复用 RPC ID 0–3：独立执行不合并。" },
      { stepId: "A07-2", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "账本、投影", statement: "同 SQL 的两个独立请求不合并为一次调用。" },
      { stepId: "A07-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "observe", evidence: "身份关系清单、账本", statement: "一 client_call 多观测/多尝试：每个观测各有 clientEventId，parent_attempt_id 类型正确。" },
      { stepId: "A07-4", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "身份关系清单", statement: "内部 operationId 不写入 upstream_operation_id；上游不支持 ID 时不虚报该能力。" },
      { stepId: "A07-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "账本", statement: "HTTP/SSE 回传均引用已提交 received；旧客户端未协商时不插入 meta 扩展帧；历史 2380/2454 等关系保留。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A08",
    sourceRequirementId: "A08",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "重连与归属修订",
    sourceJudgement: "无时间回绑、无并发串链；effective_* 可按 S 精确重建，不能以当前有效值或 seq 过滤替代",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("concurrent_inquiries_not_crossed", "两问询并发", "fault"),
      runtime("reconnect_resend_late_begin", "断线重连/重发与迟到 begin", "fault"),
      runtime("continuation_valid_and_invalid", "合法/不合法跨会话续接")
    ],
    assertionSteps: [
      { stepId: "A08-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "归属修订链", statement: "重连/重发本身不增加 attempt；只有实际新执行才有新 attempt。" },
      { stepId: "A08-2", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "归属修订链", statement: "迟到 begin 不产生时间回绑。" },
      { stepId: "A08-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "归属修订链、续接凭据", statement: "两问询并发不串链；有效续接才延续显式问询，候选标低置信。" },
      { stepId: "A08-4", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "归属修订链", statement: "不合法跨会话续接保持冲突/未归属；原归属保留为追加修订而非覆盖。" },
      { stepId: "A08-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "observe", evidence: "预算链", statement: "effective_* 字段可按账本上界 S 重建。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A09",
    sourceRequirementId: "A09",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "参数/结果冲突与未知",
    sourceJudgement: "2455 保留冲突；500/501 Unicode码点、512/513 UTF-8字节及 emoji/中文边界不破字符/JSON，摘要不取截断预览；错父事件/错attempt/错摘要/heartbeat 不得升级 ACK；T2 前后与迟到修订分别断言，不补执行事实",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("missing_param_empty_value_distinguished", "缺参、空值、有界截断"),
      runtime("result_field_mutation_diff", "结果错误码、行列、精度/类型、截断或摘要变异"),
      runtime("unicode_and_utf8_boundaries", "500/501 Unicode 码点与 512/513 UTF-8 字节边界")
    ],
    assertionSteps: [
      { stepId: "A09-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "原参数/响应的受控证据", statement: "缺参、空值、未知分别可区分；脱敏与解析失败保留 redacted/parse_failed，不与空值混用。" },
      { stepId: "A09-2", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "摘要", statement: "摘要按相同版本与完整输入边界比较，不取截断预览。" },
      { stepId: "A09-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "导出", statement: "结果差异显式呈现；不靠相同 SQL/hash 强配，2455 保留冲突。" },
      { stepId: "A09-4", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "原参数/响应的受控证据", statement: "500/501 Unicode 码点、512/513 UTF-8 字节及 emoji/中文边界不破字符与 JSON。" },
      { stepId: "A09-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "导出", statement: "错父事件/错 attempt/错摘要/heartbeat 不得升级 ACK；T2 前后与迟到修订分别断言，不补执行事实。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A10",
    sourceRequirementId: "A10",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "账本领先与导出一致性",
    sourceJudgement: "从投影取 S 或只凭 ledger_seq 列存在放行的错误实现必须被检出；T3 从捕获 S 起算60s且不重置，超时无正式包；as-of 任一项不可证明则 scopeComplete=false、正式导出失败；同 S/筛选/规则/单位/profile 结果一致",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("ledger_ahead_of_projection", "故意暂停投影使 ledger>S_projection", "fault"),
      runtime("concurrent_write_during_export", "导出期间并发写入/归属修订", "fault"),
      runtime("paged_export_no_duplicate_no_gap", "多页导出的分页完整性")
    ],
    assertionSteps: [
      { stepId: "A10-1", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "账本 S", statement: "S 取账本已提交上界；从投影取 S 的错误实现必须被检出。" },
      { stepId: "A10-2", dimension: "artifact_scan", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "Manifest", statement: "未追平账本时正式导出失败，不产出正式包。" },
      { stepId: "A10-3", dimension: "consistency", derivedFrom: "判定规则", expectation: "not_advance", evidence: "Manifest", statement: "T3 从捕获 S 起算 60s，等待重试不重置；超时无正式包。" },
      { stepId: "A10-4", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "快照/页 ID 集合", statement: "追平后冻结快照，所有视图 as-of S；>S 的新事件不混入。" },
      { stepId: "A10-5", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "页 ID 集合", statement: "多页导出分页不重不漏（页 ID 集合无重复、无缺失）。" },
      { stepId: "A10-6", dimension: "consistency", derivedFrom: "判定规则", expectation: "observe", evidence: "Manifest", statement: "同 S/筛选/规则/单位/profile 下 API、UI、CSV 结果一致；诊断 partial 单列。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A11",
    sourceRequirementId: "A11",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "文件完整性与版本链",
    sourceJudgement: "不把本地 hash 验证当不可抵赖来源证明；来源三字段有值或明确原因，无审批不编审批引用",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "environment",
    dimensions: [
      CONTRACT_DIMENSION,
      runtime("isolated_copy_file_removed", "隔离副本删文件", "fault"),
      runtime("isolated_copy_file_modified", "隔离副本改文件", "fault"),
      runtime("reference_relinked_and_reexported", "改关联引用、补包/重导出", "fault")
    ],
    assertionSteps: [
      { stepId: "A11-1", dimension: "artifact_scan", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "两层清单与校验报告", statement: "隔离副本删除文件：完整性检查报失败并定位到该文件。" },
      { stepId: "A11-2", dimension: "artifact_scan", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "校验报告", statement: "隔离副本修改文件内容：内容校验报失败并定位。" },
      { stepId: "A11-3", dimension: "artifact_scan", derivedFrom: "预期事件集合与状态/关系", expectation: "refuse", evidence: "校验报告", statement: "改关联引用：关联检查独立报失败，与完整性失败分别报告。" },
      { stepId: "A11-4", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "版本关系", statement: "补包/重导出：新 exportId 关联旧版；旧包字节与清单不改。" },
      { stepId: "A11-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "observe", evidence: "两层清单", statement: "来源三字段有值或明确原因；无审批不编审批引用；本地 hash 验证不被当作不可抵赖来源证明。" }
    ]
  }),

  makeDescriptor({
    executionId: "AUD25-A12",
    sourceRequirementId: "A12",
    sourceSpec: AUDIT_SOURCE_SPEC,
    sourceTable: AUDIT_SOURCE_TABLE,
    sourceScenario: "历史回放与提示能力样本",
    sourceJudgement: "2455/Claude 差额不强配；Manifest 65=58通过+3缺失+4不一致只作归档事实，不自动归咎 Lucy；旧180预览保持原样，新500预览按v2p5-1另测；缺独立入口数据项仍 unknown，received∪auth_failure_log 不得替代独立到达集合",
    sourceColumns: AUDIT_SOURCE_COLUMNS,
    blockedReason: "delivery",
    dimensions: [
      CONTRACT_DIMENSION,
      { name: "frozen_historical_csv_and_pack_replay", layer: "history", computableHere: false, blockedReason: "delivery", note: "只读历史 CSV/包（177/192/175）不在本仓库，须以只读样本提供" },
      { name: "isolated_repair_hint_capability_sample", layer: "runtime", computableHere: false, blockedReason: "environment", note: "隔离 repairHint 能力样本：合法/同名不可调用/不存在或不可见目标" },
      { name: "legacy_outcome_and_attribution_baselines", layer: "history", computableHere: false, blockedReason: "delivery", note: "旧 outcome 110/23/43/1、归属 137/36/2、19 握手分组等冻结基线" }
    ],
    assertionSteps: [
      { stepId: "A12-1", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "静态回放报告", statement: "只读历史回放核对 177/192/175；旧 outcome 110/23/43/1（探测已含）；归属 137/36/2。" },
      { stepId: "A12-2", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "preserve", evidence: "静态回放报告", statement: "19 握手分组 + 7 业务分组（5 未上报）；Session B 50 工具；ID/关系/冲突一致。" },
      { stepId: "A12-3", dimension: "consistency", derivedFrom: "预期事件集合与状态/关系", expectation: "not_advance", evidence: "独立提示校验报告", statement: "repairHint 不生成虚构 row_count(source)：合法目标可调用、同名不可调用、不存在/不可见目标各自成立。" },
      { stepId: "A12-4", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "静态回放报告", statement: "2455/Claude 差额不强配；Manifest 65=58通过+3缺失+4不一致只作归档事实，不自动归咎 Lucy。" },
      { stepId: "A12-5", dimension: "consistency", derivedFrom: "判定规则", expectation: "preserve", evidence: "静态回放报告", statement: "旧 180 预览保持原样；新 500 预览按 v2p5-1 另测；缺独立入口数据项仍 unknown。" },
      { stepId: "A12-6", dimension: "artifact_scan", derivedFrom: "证据位置", expectation: "observe", evidence: "静态回放报告与独立提示校验报告", statement: "静态回放报告与独立提示校验报告分开，不得合并成一份冒充运行时可靠性。" }
    ]
  })
];

/** The 12 AUD25 descriptors, in source order. */
export const AUDIT_V025_CASES = Object.freeze(auditCases);

/**
 * Ids whose primary judgement requires a HARD refusal (an explicit failure
 * instead of a permissive outcome).  Asserted by the contract test so a
 * descriptor cannot quietly downgrade a fail-closed requirement.
 */
export const AUDIT_REFUSAL_IDS = Object.freeze(["A02", "A10", "A11"]);

/**
 * Ids whose primary judgement requires that a state does NOT advance
 * (no duplicate call, no escalation, no fabricated capability).
 */
export const AUDIT_NO_ADVANCE_IDS = Object.freeze([
  "A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A12"
]);

/**
 * Ids whose acceptance depends on the frozen historical samples or on
 * customer amd64 delivery evidence; they cannot close without them.
 */
export const AUDIT_DELIVERY_BLOCKED_IDS = Object.freeze(["A12"]);
