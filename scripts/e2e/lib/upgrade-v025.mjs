// v0.25 LIFECYCLE branch descriptors (Plan W4, Track E).
//
// Owns two approved execution sets, both in the LIFECYCLE domain and both
// explicitly **non-gate** (they must never enter the frozen required
// denominator):
//   * UPG25-01..16 — real in-place upgrade on the original volume;
//   * RVC25-01..13 — candidate verification by restoring a consistent backup
//     into two isolated empty-volume environments.
//
// Two rules dominate this module and are enforced mechanically by its tests:
//   1. **UPG and RVC are not substitutable.** A successful restore into a new
//      empty volume does NOT prove an in-place upgrade on the original
//      volume, and neither may be cited as the other's evidence.
//   2. **A non-gate item never becomes a gate.** These ids are recorded and
//      reported, but they are not part of the release required denominator.
//
// Nothing here records a pass. Without a real old version, a real backup and
// an isolated amd64 Kubernetes environment, every execution item is `blocked`
// with a structured reason — never `passed`, never silently skipped.

import { statusFromDimensions } from "./v025-result.mjs";

/** Capability -> why it is missing, used to classify a blocked reason. */
const CAPABILITY_REASONS = Object.freeze({
  "k8s-amd64": "environment",
  "ci-runner": "delivery",
  "agent-client": "capability",
  "fault-control": "capability",
  "ktx-upstream": "capability",
  "lucy-http": "capability",
  "postgres": "environment"
});

/** The LIFECYCLE branch runs on real customer-shaped material. */
const LIFECYCLE_REQUIRES = Object.freeze([
  "lucy-http", "ktx-upstream", "k8s-amd64", "ci-runner", "fault-control", "agent-client"
]);
const UPGRADE_EXECUTORS = Object.freeze(["O", "P", "A", "V"]);
const CANDIDATE_EXECUTORS = Object.freeze(["O", "P", "B", "V"]);
const LIFECYCLE_ASSERT = Object.freeze(["consistency", "deny", "no_leak"]);
const LIFECYCLE_ARTIFACTS = Object.freeze(["gate-result.json", "leak-scan.json"]);

/**
 * The 16 in-place upgrade items. `steps` are derived id by id from
 * docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md §6.
 */
export const UPGRADE_CASES = Object.freeze([
  {
    id: "UPG25-01", requirement: "UPG-01", title: "固定身份与预检",
    steps: [
      "两端（旧版与候选）身份可复现：版本、制品摘要、卷与 namespace 均被记录",
      "缺 Secret、错误卷、资源漂移与不兼容四类前置问题各自给出可区分的明确报告",
      "预检阶段零迁移：预检失败后旧环境未被写入任何变更"
    ],
    executorLevel: "profile 与预检负例可在本地验证；真实两端身份需真实旧版制品"
  },
  {
    id: "UPG25-02", requirement: "UPG-02", title: "备份可恢复",
    steps: [
      "备份在独立实例上可恢复，恢复后可登录",
      "恢复后确定性查询结果等于独立答案，而非仅非空",
      "恢复后历史审计与安全行为与备份前一致"
    ],
    executorLevel: "备份格式与清单校验可在本地验证；真实恢复需真实备份物料"
  },
  {
    id: "UPG25-03", requirement: "UPG-03", title: "真实原地升级",
    steps: [
      "运行镜像确实切换为候选 digest，而非仅重启旧版",
      "升级继续使用原卷，原数据与原 Secret 引用不被重建",
      "模板不覆盖客户资产：客户自带资产在升级后保持原样"
    ],
    executorLevel: "仅能在真实旧版 + 候选 + 原卷环境执行；本地不可验证"
  },
  {
    id: "UPG25-04", requirement: "UPG-04", title: "有效业务连续",
    steps: [
      "升级前有效的 Token 经公共 MCP 升级后仍可查询",
      "查询结果等于独立答案（typed 口径一致，不只是非空）",
      "工具与内容可见性与升级前一致，未因升级而扩大或缩小"
    ],
    executorLevel: "需真实升级 run 的公共 MCP 与真实 Agent 客户端"
  },
  {
    id: "UPG25-05", requirement: "UPG-05", title: "安全状态连续",
    steps: [
      "已吊销、已过期、已停用的 Token 升级后仍被拒绝",
      "越权访问仍被拒绝",
      "拒绝以预期的认证／授权语义返回，不得以 500 代替"
    ],
    executorLevel: "需真实升级 run；负例形状可在本地合同层验证"
  },
  {
    id: "UPG25-06", requirement: "UPG-06", title: "权限与内容迁移",
    steps: [
      "Role 与 ACL 按声明合同保留或迁移",
      "跨域探针在升级后仍不可访问",
      "内容资产可见性符合迁移后的预期口径"
    ],
    executorLevel: "需真实升级 run；探针形状可在本地合同层验证"
  },
  {
    id: "UPG25-07", requirement: "UPG-07", title: "审计连续",
    steps: [
      "旧审计记录按 ID 与关键字段仍可查",
      "新调用在升级后正常追加，旧记录不被截断",
      "审计所有者经管理 API 成功读取"
    ],
    executorLevel: "需真实升级 run；事件模型断言可在本地合同层验证"
  },
  {
    id: "UPG25-08", requirement: "UPG-08", title: "管理员迁移",
    steps: [
      "原管理员账号按合同登录成功",
      "旧 Cookie 按版本契约失效",
      "管理员职责在升级后保持不变"
    ],
    executorLevel: "需真实升级 run；会话契约断言可在本地合同层验证"
  },
  {
    id: "UPG25-09", requirement: "UPG-09", title: "无管理员旧环境",
    steps: [
      "无管理员的旧环境进入受控引导流程",
      "无引导密钥或错误引导密钥被拒绝且无副作用",
      "正确认领不可重复，第二次认领被拒"
    ],
    executorLevel: "需真实升级 run；引导负例可在本地合同层验证"
  },
  {
    id: "UPG25-10", requirement: "UPG-10", title: "无部署许可",
    steps: [
      "无 license.yaml 时仍可运行合法业务",
      "Bearer 鉴权不受遗留环境变量影响",
      "ACL 判定不受遗留环境变量影响"
    ],
    executorLevel: "需真实升级 run；环境变量隔离断言可在本地合同层验证"
  },
  {
    id: "UPG25-11", requirement: "UPG-11", title: "切换前失败",
    steps: [
      "镜像不可用或启动失败时按合同恢复旧版",
      "恢复后配置与卷均未重置",
      "失败证据被保留，不被后续成功覆盖"
    ],
    executorLevel: "拒绝路径与预检零迁移可在本地执行器层验证；真实回滚需真实环境"
  },
  {
    id: "UPG25-12", requirement: "UPG-12", title: "切换后业务失败",
    steps: [
      "候选已写入数据后按声明路径恢复业务",
      "恢复后重新校验安全状态",
      "初始失败证据不被恢复流程覆盖"
    ],
    executorLevel: "需真实升级 run；恢复路径声明可在本地合同层验证"
  },
  {
    id: "UPG25-13", requirement: "UPG-13", title: "旧快照安全恢复",
    steps: [
      "已吊销的 Token 与已失效的会话在恢复后仍不可用",
      "缺最新安全状态时进入维护模式，而不是放行"
    ],
    executorLevel: "需真实快照与真实恢复环境"
  },
  {
    id: "UPG25-14", requirement: "UPG-14", title: "中断与重试",
    steps: [
      "声明检查点之后可恢复或幂等重试",
      "重试不产生重复身份",
      "重试不产生半写配置，也不误开放访问"
    ],
    executorLevel: "幂等与检查点语义可在本地合同层验证；真实中断需真实环境"
  },
  {
    id: "UPG25-15", requirement: "UPG-15", title: "运维与重启",
    steps: [
      "升级后内容路径、可写性、连接测试与 reindex 均正常",
      "重启后业务保持",
      "重启后吊销状态保持"
    ],
    executorLevel: "需真实升级 run 与重启"
  },
  {
    id: "UPG25-16", requirement: "UPG-16", title: "中断时间",
    steps: [
      "外部探针记录旧版最后一次成功的时间点",
      "记录不可用区间的起止",
      "记录新版首次业务成功时间点",
      "记录恢复耗时，且与不可用区间口径一致"
    ],
    executorLevel: "中断时间计算可在本地用探针事件流验证；真实事件需真实升级"
  }
]);

/**
 * The 13 candidate-verification items. `steps` are derived id by id from
 * docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md §6.
 */
export const CANDIDATE_CASES = Object.freeze([
  {
    id: "RVC25-01", requirement: "RVC-01", title: "备份一致性",
    steps: [
      "备份的 SHA256 与清单通过校验",
      "含安全库时备份为 quiesced",
      "不含安全库且无法证明 quiesced 时结论为 BLOCKED，不得降级为通过"
    ],
    executorLevel: "清单与摘要校验可在本地验证；quiesced 证明需真实备份物料"
  },
  {
    id: "RVC25-02", requirement: "RVC-02", title: "隔离与归属",
    steps: [
      "namespace、PVC 与 Service 相互独立",
      "候选环境对客户网络不可达",
      "所有资源归属于本次运行，清理时不会误删他人资源"
    ],
    executorLevel: "命名与归属规则可在本地合同层验证；真实隔离需 amd64 K8s"
  },
  {
    id: "RVC25-03", requirement: "RVC-03", title: "空卷起步",
    steps: [
      "覆盖前目标卷的文件数为 0",
      "未启用 seed-only 模式",
      "任一不满足即 FAILED，不得降级为警告"
    ],
    executorLevel: "空卷断言可在本地卷夹具验证"
  },
  {
    id: "RVC25-04", requirement: "RVC-04", title: "整卷覆盖完整",
    steps: [
      "覆盖后的文件清单与备份一致",
      "配置、秘密引用与 .ktx-ui/ 关键路径符合候选版本清单"
    ],
    executorLevel: "清单比对可在本地验证；真实卷覆盖需真实备份"
  },
  {
    id: "RVC25-05", requirement: "RVC-05", title: "结构无混合态",
    steps: [
      "基线逐项符合候选预期",
      "结构变更确实生效",
      "失败不得降级为警告"
    ],
    executorLevel: "需真实候选环境"
  },
  {
    id: "RVC25-06", requirement: "RVC-06", title: "业务查询一致",
    steps: [
      "有效凭据经公共 MCP 查询",
      "结果与独立答案一致，而非只断言非空"
    ],
    executorLevel: "需真实恢复环境与公共 MCP"
  },
  {
    id: "RVC25-07", requirement: "RVC-07", title: "授权允许路径",
    steps: [
      "授权范围内的调用按预期允许",
      "工具与内容可见性一致"
    ],
    executorLevel: "需真实恢复环境"
  },
  {
    id: "RVC25-08", requirement: "RVC-08", title: "授权拒绝路径",
    steps: [
      "越权探针返回预期的认证或授权拒绝",
      "不得以 500 代替拒绝"
    ],
    executorLevel: "拒绝形状可在本地合同层验证"
  },
  {
    id: "RVC25-09", requirement: "RVC-09", title: "审计连续",
    steps: [
      "历史 ID 与关键字段可读",
      "新调用被追加",
      "行数不下降仅作辅助证据，不单独成立"
    ],
    executorLevel: "需真实恢复环境"
  },
  {
    id: "RVC25-10", requirement: "RVC-10", title: "会话与最新安全状态",
    steps: [
      "轮换后旧会话失效、新登录可用",
      "已核对的最新吊销状态确实生效",
      "不声称证明原地升级不会回滚（该结论只属 UPG 域）"
    ],
    executorLevel: "需真实恢复环境"
  },
  {
    id: "RVC25-11", requirement: "RVC-11", title: "跨域探针",
    steps: [
      "跨域对象不可访问",
      "未授权对象不可访问"
    ],
    executorLevel: "需真实恢复环境"
  },
  {
    id: "RVC25-12", requirement: "RVC-12", title: "独立重放",
    steps: [
      "同一备份在两个新空卷环境各重放一次",
      "两次结论一致",
      "无重复身份、无半写配置"
    ],
    executorLevel: "需真实备份与两个隔离环境"
  },
  {
    id: "RVC25-13", requirement: "RVC-13", title: "清理完整",
    steps: [
      "卷、namespace、Secret 与临时副本均被销毁",
      "残留与清理失败如实记录，不得写成完整通过"
    ],
    executorLevel: "清理清单与归属规则可在本地合同层验证"
  }
]);

/** All LIFECYCLE descriptors, upgrade first then candidate verification. */
export const LIFECYCLE_CASES = Object.freeze([
  ...UPGRADE_CASES.map((c) => ({
    ...c,
    kind: "in-place-upgrade",
    ownerBranch: "LIFECYCLE",
    requiredExecutors: UPGRADE_EXECUTORS,
    requires: LIFECYCLE_REQUIRES,
    assert: LIFECYCLE_ASSERT,
    artifacts: LIFECYCLE_ARTIFACTS,
    // in-place upgrade continues the original volume — it can never be proven
    // by restoring into a fresh one
    evidenceScope: "original-volume"
  })),
  ...CANDIDATE_CASES.map((c) => ({
    ...c,
    kind: "candidate-verification",
    ownerBranch: "LIFECYCLE",
    requiredExecutors: CANDIDATE_EXECUTORS,
    requires: LIFECYCLE_REQUIRES,
    assert: LIFECYCLE_ASSERT,
    artifacts: LIFECYCLE_ARTIFACTS,
    // candidate verification restores a backup into empty volumes — it can
    // never be cited as proof of an in-place upgrade
    evidenceScope: "empty-volume-restore"
  }))
]);

const BY_ID = new Map(LIFECYCLE_CASES.map((c) => [c.id, c]));

export function lifecycleCaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** Every LIFECYCLE execution id is non-gate: it never enters the required denominator. */
export function isNonGate(executionId) {
  return BY_ID.has(executionId);
}

/**
 * Evaluates one LIFECYCLE execution item.
 *
 * A missing capability yields `blocked` with a structured reason — never a
 * pass and never a silent skip. Otherwise the status comes from the executed
 * evidence dimensions, using the same rule as every other branch: a single
 * passing layer is not a pass.
 */
export function evaluateLifecycleCase(executionId, { capabilities = [], dimensions = {}, verifierPassed } = {}) {
  const c = lifecycleCaseFor(executionId);
  if (!c) return { executionId, status: "not_run", blockedReason: null, reason: "unknown execution id" };
  const have = new Set(capabilities);
  const missing = c.requires.filter((cap) => !have.has(cap));
  if (missing.length > 0) {
    const reasons = missing.map((cap) => CAPABILITY_REASONS[cap] ?? "capability");
    // delivery beats environment beats capability: the most upstream blocker wins
    const blockedReason = reasons.includes("delivery") ? "delivery" : reasons.includes("environment") ? "environment" : "capability";
    return {
      executionId,
      status: "blocked",
      blockedReason,
      missingCapabilities: missing,
      reason: `missing capabilities: ${missing.join(", ")}`
    };
  }
  const status = statusFromDimensions(dimensions, { required: c.requiredExecutors, verifierPassed });
  return { executionId, status, blockedReason: null, missingCapabilities: [] };
}

/**
 * The UPG/RVC non-substitutability rule, as an executable check.
 * Returns a list of problems; empty means the two evidence sets stayed apart.
 */
export function assertSeparateEvidence({ upgradeEvidenceIds = [], candidateEvidenceIds = [] } = {}) {
  const problems = [];
  const overlap = upgradeEvidenceIds.filter((id) => candidateEvidenceIds.includes(id));
  if (overlap.length > 0) {
    problems.push(`evidence cited for both in-place upgrade and candidate verification: ${overlap.join(", ")}`);
  }
  for (const id of upgradeEvidenceIds) {
    if (id.startsWith("RVC25-")) problems.push(`in-place upgrade cites candidate-verification evidence ${id}`);
  }
  for (const id of candidateEvidenceIds) {
    if (id.startsWith("UPG25-")) problems.push(`candidate verification cites in-place-upgrade evidence ${id}`);
  }
  return problems;
}

/**
 * Computes the interruption window from an external probe event stream
 * (UPG25-16). `events` are { at, kind } where kind is one of
 * "old-success" | "unavailable" | "new-success".
 */
export function interruptionWindow(events) {
  const ordered = [...(events ?? [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const lastOld = [...ordered].reverse().find((e) => e.kind === "old-success");
  const firstNew = ordered.find((e) => e.kind === "new-success");
  const unavailable = ordered.filter((e) => e.kind === "unavailable");
  if (!lastOld || !firstNew) return { complete: false, reason: "probe stream lacks old-success or new-success" };
  const unavailableStart = unavailable.length ? Date.parse(unavailable[0].at) : null;
  const unavailableEnd = unavailable.length ? Date.parse(unavailable[unavailable.length - 1].at) : null;
  return {
    complete: true,
    lastOldSuccessAt: lastOld.at,
    firstNewSuccessAt: firstNew.at,
    unavailableStartAt: unavailableStart === null ? null : new Date(unavailableStart).toISOString(),
    unavailableEndAt: unavailableEnd === null ? null : new Date(unavailableEnd).toISOString(),
    unavailableMs: unavailableStart === null || unavailableEnd === null ? null : unavailableEnd - unavailableStart,
    recoveryMs: Date.parse(firstNew.at) - Date.parse(lastOld.at)
  };
}
