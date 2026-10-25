// v0.25 CON25-01..12 — database-type and access-failure matrix descriptors (Plan §6.4).
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md §7.4
//   * docs/governance/database-support-matrix.md §3  (SINGLE SOURCE OF TRUTH for support status)
//   * webui/src/lib/connectionId.ts                    (SINGLE SOURCE OF TRUTH for the 8 selectable types)
//
// This module is PURE: declarative descriptors only, no I/O, no network, no fixture
// mutation. It never records a run status. Run status lives in the result file
// (scripts/e2e/lib/v025-result.mjs).
//
// Three disciplines are encoded structurally, not by convention:
//
//  1. Support status is QUOTED, never derived. `CON25_SUPPORT_STATUS` mirrors
//     docs/governance/database-support-matrix.md §3 verbatim. A `gated` type without
//     its certification environment is `blocked` — never `passed`.
//  2. An `experimental` / `roadmap` type may only be verified for its DECLARED LIMITS
//     and FAIL-CLOSED behaviour. `con25RealQuerySupportExpressible()` is `false` for
//     those ids, so no caller can express a "real query support passed" verdict for them.
//  3. A missing run is never upgraded into a pass. `con25OutcomeWithoutEnvironment()`
//     returns `not_run` or `blocked` with a structured reason — never `passed`.
//
// The 8 type cases (CON25-01..08) cover exactly the 8 `DATABASE_TYPES` keys, in the
// manifest's order (mysql, postgres, starrocks, doris, sqlserver, oracle, sqlite,
// athena). The order is asserted by scripts/e2e/__tests__/v025-p1.test.mjs against the
// live TypeScript source, so a drift in either direction breaks the test.

import { statusFromDimensions } from "./v025-result.mjs";

/** The 8 selectable UI database types, in the coverage manifest's CON25-01..08 order. */
export const DATABASE_TYPE_ORDER = Object.freeze([
  "mysql",
  "postgres",
  "starrocks",
  "doris",
  "sqlserver",
  "oracle",
  "sqlite",
  "athena"
]);

/** CON25-01..12 — the new increment scenarios from the approved design Spec §7.4. */
export const CON25_EXECUTION_IDS = Object.freeze([
  "CON25-01", "CON25-02", "CON25-03", "CON25-04", "CON25-05", "CON25-06",
  "CON25-07", "CON25-08", "CON25-09", "CON25-10", "CON25-11", "CON25-12"
]);

/**
 * Support status per id, quoted from docs/governance/database-support-matrix.md §3.
 * `n/a` marks the four access-failure / identity scenarios, which are not database types.
 */
export const CON25_SUPPORT_STATUS = Object.freeze({
  "CON25-01": "verified",
  "CON25-02": "verified",
  "CON25-03": "gated",
  "CON25-04": "gated",
  "CON25-05": "experimental",
  "CON25-06": "roadmap",
  "CON25-07": "verified",
  "CON25-08": "experimental",
  "CON25-09": "n/a",
  "CON25-10": "n/a",
  "CON25-11": "n/a",
  "CON25-12": "n/a"
});

/** Statuses that may only be verified for their declared limits, never for real support. */
export const LIMIT_ONLY_STATUSES = Object.freeze(["experimental", "roadmap"]);

/** Statuses that need a certification environment before they can be evaluated at all. */
export const GATED_STATUSES = Object.freeze(["gated"]);

/** The four access-failure / identity scenarios: fail-closed behaviour, not a type. */
export const CON25_FAIL_CLOSED_IDS = Object.freeze(["CON25-10", "CON25-11", "CON25-12"]);
export const CON25_IDENTITY_IDS = Object.freeze(["CON25-09"]);

const ARTIFACTS = Object.freeze(["management-case-result.json", "leak-scan.json"]);

const CASES = Object.freeze([
  {
    executionId: "CON25-01",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "B", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["allow_control", "typed_gold", "upstream_exec_zero"]),
    artifacts: ARTIFACTS,
    title: "MySQL 真实连接、采集与代表性只读查询",
    databaseType: "mysql",
    supportStatus: "verified",
    assertionSteps: Object.freeze([
      "对本轮目标 MySQL 执行真实连通测试，断言上游返回真实连接成功而不是模拟响应",
      "执行真实采集：Schema Manifest 落库，grain／派生列／segment／join／隐藏列都不丢",
      "执行代表性只读查询，结果等于独立手写 SQL 的 oracle；oracle 不得由被测编译器生成",
      "断言上游执行次数与实际查询一致，不存在重复分派；未授权路径上游执行数为 0",
      "断言连接响应、页面与产物中不出现数据库密码明文"
    ]),
    passSemantics: "只有真实连接＋真实采集＋代表性只读查询三者都在本轮目标环境通过才算通过；支持矩阵里的历史 verified 不能代替本轮证据",
    forbiddenPassSemantics: Object.freeze([]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-02",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "B", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["allow_control", "typed_gold", "upstream_exec_zero"]),
    artifacts: ARTIFACTS,
    title: "PostgreSQL 真实连接、采集与代表性只读查询",
    databaseType: "postgres",
    supportStatus: "verified",
    assertionSteps: Object.freeze([
      "对本轮目标 PostgreSQL 执行真实连通测试，断言上游返回真实连接成功",
      "执行真实采集：Schema Manifest 与语义层落库，grain 与派生列完整",
      "执行代表性只读查询，结果等于独立手写 SQL 的 oracle",
      "断言可引用 J-01 的同层事实，但本项结果独立记录，不转记主线的通过",
      "断言上游执行次数一致且未授权路径上游执行数为 0；响应与产物无密码明文"
    ]),
    passSemantics: "只有真实连接＋真实采集＋代表性只读查询在本轮目标环境通过才算通过；引用主线事实不等于本项通过",
    forbiddenPassSemantics: Object.freeze([]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-03",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "B", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["allow_control", "deny"]),
    artifacts: ARTIFACTS,
    title: "StarRocks 认证环境内真实连接与查询",
    databaseType: "starrocks",
    supportStatus: "gated",
    assertionSteps: Object.freeze([
      "按 docs/specs/starrocks-r1-support-plan.md 的认证流程在真实 StarRocks 环境执行连通测试",
      "断言所用镜像包含 max_execution_time 兼容补丁，否则探活与真实取数同路径失败",
      "在认证环境内执行代表性只读查询，结果等于独立手写 SQL 的 oracle",
      "断言本轮 evidence 文件路径与通过日期已登记，缺哪条证据／谁补／何时补写明",
      "断言缺认证环境时本项为 blocked(environment)，支持状态不因此晋级为 verified"
    ]),
    passSemantics: "只在认证环境内真实连接与查询通过才记通过；缺认证环境即 blocked(environment)，gated 不得晋级",
    forbiddenPassSemantics: Object.freeze(["support_status_upgraded", "verified_without_live_evidence"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-04",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "B", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["allow_control", "deny"]),
    artifacts: ARTIFACTS,
    title: "Doris 认证环境内真实连接与查询",
    databaseType: "doris",
    supportStatus: "gated",
    assertionSteps: Object.freeze([
      "按 R1 受控数据服务计划的认证流程在真实 Doris 环境执行连通测试",
      "断言所用镜像包含 max_execution_time 兼容补丁，否则探活失败",
      "断言客户版本决定 default_init_catalog 可用性，外部目录上的表只查不写的差异被如实记录",
      "在认证环境内执行代表性只读查询，结果等于独立手写 SQL 的 oracle",
      "断言每个环境各自举证；缺认证环境时本项为 blocked(environment)，支持状态不晋级"
    ]),
    passSemantics: "只在认证环境内真实连接与查询通过才记通过；缺认证环境即 blocked(environment)，gated 不得晋级",
    forbiddenPassSemantics: Object.freeze(["support_status_upgraded", "verified_without_live_evidence"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-05",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "O", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream", "fault-control"]),
    assert: Object.freeze(["deny", "unavailable_not_open", "no_leak"]),
    artifacts: ARTIFACTS,
    title: "SQL Server 已知限制、失败关闭与支持口径",
    databaseType: "sqlserver",
    supportStatus: "experimental",
    assertionSteps: Object.freeze([
      "断言本项结论只覆盖已知限制与失败关闭，不声称真实查询支持（experimental 不得写「支持」）",
      "在 TDS 连接不可用或驱动报错时断言失败关闭：连接不进入可用状态（unavailable_not_open）",
      "断言失败可诊断：错误原因指向认证或协议，而不是回退到其它方言",
      "断言响应、页面与产物中不含数据库密码明文",
      "断言对外口径与支持矩阵 §3 的 experimental 一致，不出现「支持」字样"
    ]),
    passSemantics: "通过只表示已知限制与失败关闭得到验证，不表示真实数据库查询或产品支持通过",
    forbiddenPassSemantics: Object.freeze(["real_query_support_passed", "product_supported"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-06",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["unavailable_not_open", "no_leak"]),
    artifacts: ARTIFACTS,
    title: "Oracle 未承诺边界与口径",
    databaseType: "oracle",
    supportStatus: "roadmap",
    assertionSteps: Object.freeze([
      "断言 Oracle 仍在未承诺边界内：roadmap candidate，未启动协议兼容 spike",
      "断言新建连接表单与用户手册不把 Oracle 表述为「支持」",
      "断言驱动存在本身不被记作真实连接通过（不得出现真实查询通过结论）",
      "断言响应与页面不含数据库密码，也不承诺尚未实现的写库或联邦能力",
      "断言对外口径与支持矩阵 §3 的 roadmap 一致"
    ]),
    passSemantics: "通过只表示未承诺边界与对外口径得到验证，不表示真实连接或产品支持通过",
    forbiddenPassSemantics: Object.freeze(["real_query_support_passed", "product_supported"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-07",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "B", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["allow_control", "typed_gold", "upstream_exec_zero"]),
    artifacts: ARTIFACTS,
    title: "SQLite 本地文件真实连接与只读查询",
    databaseType: "sqlite",
    supportStatus: "verified",
    assertionSteps: Object.freeze([
      "对真实本地 SQLite 文件执行真实连接（与 storage.state: sqlite 的内部存储同形态）",
      "执行代表性只读查询，结果等于独立手写 SQL 的 oracle",
      "断言该结论只覆盖本地文件场景，不外推为客户生产目标库支持",
      "断言本地文件路径与凭据不进入页面文本、响应或产物明文",
      "断言文件锁语义被如实报告，不被误报为方言不支持"
    ]),
    passSemantics: "通过只表示本地文件型连接与只读查询在本轮通过；不得外推为客户生产目标库支持",
    forbiddenPassSemantics: Object.freeze(["production_database_support_passed"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-08",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "O", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream", "fault-control"]),
    assert: Object.freeze(["deny", "unavailable_not_open", "no_leak"]),
    artifacts: ARTIFACTS,
    title: "Amazon Athena 已知限制、失败关闭与支持口径",
    databaseType: "athena",
    supportStatus: "experimental",
    assertionSteps: Object.freeze([
      "断言本项结论只覆盖已知限制与失败关闭，不声称真实查询支持（experimental 不得写「支持」）",
      "断言 Athena 使用当前环境的 AWS 凭证且不保存数据库密码：响应、页面与配置中无密码字段",
      "在无凭证或凭证无效时断言失败关闭，连接不进入可用状态（unavailable_not_open）",
      "断言失败可诊断：原因指向凭证或网络，不回退到其它方言",
      "断言对外口径与支持矩阵 §3 的 experimental 一致，不出现「支持」字样"
    ]),
    passSemantics: "通过只表示已知限制与失败关闭得到验证，不表示真实数据库查询或产品支持通过",
    forbiddenPassSemantics: Object.freeze(["real_query_support_passed", "product_supported"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-09",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "D", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["exactly_one_wins", "upstream_exec_zero"]),
    artifacts: ARTIFACTS,
    title: "跨连接／Schema 同名表身份不串",
    databaseType: null,
    supportStatus: "n/a",
    assertionSteps: Object.freeze([
      "在两个连接（不同 database 或不同 Schema）建立同名表并分别走真实采集",
      "断言规范源键含连接身份：同名表不合并、不互相覆盖，两个源各自可寻址",
      "断言授权按连接身份生效：同名表不得被一个角色同时全量授予",
      "断言未授权一侧的上游执行数为 0（upstream_exec_zero）",
      "断言同一请求恰好命中授权的一侧（exactly_one_wins），不两侧同时命中也不两侧都不命中"
    ]),
    passSemantics: "通过只表示采集与规范源键的身份不串；同名表的权限拒绝深度归 ACCESS 责任域，不在此重复",
    forbiddenPassSemantics: Object.freeze([]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-10",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream"]),
    assert: Object.freeze(["deny", "no_side_effect", "no_leak"]),
    artifacts: ARTIFACTS,
    title: "错误凭据失败关闭且秘密不泄漏",
    databaseType: null,
    supportStatus: "n/a",
    assertionSteps: Object.freeze([
      "用错误密码发起真实连接，断言连接失败关闭（deny）",
      "断言失败可诊断：错误原因指向认证，而不是网络或方言",
      "断言响应、页面、日志与产物中不出现密码、Token 或连接串明文（no_leak）",
      "断言失败连接无副作用（no_side_effect）：未创建连接、未落库、未触发上游执行",
      "断言该失败不被降级成「该类型不支持」，也不被升级成「已连接」"
    ]),
    passSemantics: "通过只表示错误凭据被失败关闭且秘密不泄漏；不表示该数据库类型受支持",
    forbiddenPassSemantics: Object.freeze(["product_supported"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-11",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "O", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream", "fault-control", "network-profile"]),
    assert: Object.freeze(["deny", "unavailable_not_open"]),
    artifacts: ARTIFACTS,
    title: "网络不可达与中断的超时、重试与恢复",
    databaseType: null,
    supportStatus: "n/a",
    assertionSteps: Object.freeze([
      "用 network-profile 切断到目标库的链路，断言连接失败关闭（deny）",
      "断言超时在声明的边界内返回，不是无限等待；连接不进入可用状态（unavailable_not_open）",
      "断言重试次数与退避符合声明，且重试不产生重复副作用",
      "断言链路恢复后重试成功，恢复过程可核对",
      "断言网络失败不被误报为方言不支持"
    ]),
    passSemantics: "通过只表示超时、重试与恢复符合声明；不表示该数据库类型受支持",
    forbiddenPassSemantics: Object.freeze(["product_supported", "dialect_unsupported_claimed"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  },
  {
    executionId: "CON25-12",
    sourceRequirementId: null,
    sourceSpec: "docs/governance/database-support-matrix.md",
    ownerBranch: "CONN",
    priority: "branch",
    executors: Object.freeze(["P", "O", "V"]),
    requires: Object.freeze(["lucy-http", "ktx-upstream", "fault-control"]),
    assert: Object.freeze(["deny", "unavailable_not_open", "no_leak"]),
    artifacts: ARTIFACTS,
    title: "TLS 配置与证书失败的允许／拒绝路径",
    databaseType: null,
    supportStatus: "n/a",
    assertionSteps: Object.freeze([
      "以声明的 TLS 参数建立连接，断言受信证书下走成功路径",
      "以不受信／过期／主机名不符的证书连接，断言失败关闭（deny）",
      "断言失败原因可诊断，且不泄露私钥、证书正文或密码（no_leak）",
      "断言失败连接不进入可用状态（unavailable_not_open）",
      "断言 TLS 失败不被误报为方言不支持；缺真实 TLS 环境时该维度记 blocked(environment)"
    ]),
    passSemantics: "通过只表示声明的 TLS 能力与拒绝路径得到验证；缺真实 TLS 环境时该维度 blocked(environment)",
    forbiddenPassSemantics: Object.freeze(["product_supported", "dialect_unsupported_claimed"]),
    expectedOutcomeWithoutEnvironment: Object.freeze({ status: "blocked", blockedReason: "environment" })
  }
]);

/**
 * The refusal contracts of the matrix: the ids whose contract IS a refusal.
 * The expectation is quoted from the id's own declared assertion tokens.
 */
const REFUSAL_EXPECTATIONS = Object.freeze({
  "CON25-05": "已知限制与失败关闭：连接不可用时必须不可用而非静默开放，失败可诊断且不泄漏秘密",
  "CON25-06": "未承诺边界：Oracle 不得被表述为受支持，驱动存在不得被记作真实连接通过",
  "CON25-08": "已知限制与失败关闭：无凭证时必须失败关闭并保持不可用状态，不得回退到其它方言",
  "CON25-10": "错误凭据必须失败关闭、无副作用且秘密不泄漏",
  "CON25-11": "网络不可达与中断必须失败关闭、在声明边界内超时，并把网络失败与方言不支持分开",
  "CON25-12": "TLS 配置与证书失败必须走拒绝路径，失败原因可诊断且不泄露私钥或密码"
});

/** All CON25 descriptors, in execution-id order. */
export const CON25_CASES = Object.freeze(CASES.map((item) => Object.freeze({
  ...item,
  // the same evidence-dimension shape the other four descriptor modules use
  dimensions: Object.freeze(buildDimensions(item)),
  // `steps` is the canonical field name; `assertionSteps` is the same array under the
  // name the other descriptor modules use, so every module reads uniformly.
  steps: Object.freeze([...item.assertionSteps]),
  failClosed: Object.freeze(REFUSAL_EXPECTATIONS[item.executionId]
    ? {
        isRefusal: true,
        expectation: Object.freeze([...item.assert]),
        tokens: Object.freeze([...item.assert]),
        reason: REFUSAL_EXPECTATIONS[item.executionId],
        detail: REFUSAL_EXPECTATIONS[item.executionId]
      }
    : {
        isRefusal: false,
        expectation: Object.freeze([]),
        tokens: Object.freeze([]),
        reason: "",
        detail: ""
      })
})));

// NOTE: indexed from the FINAL descriptor array (CON25_CASES), not the raw literals —
// the mapped array is what carries `steps` / `dimensions` / `failClosed`.
const BY_ID = new Map(CON25_CASES.map((c) => [c.executionId, c]));

/** Returns the descriptor for a CON25 execution id, or `null`. */
export function con25CaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** All CON25 execution ids. */
export function con25CaseIds() {
  return CASES.map((c) => c.executionId);
}

/** The 8 database-type ids (CON25-01..08) in manifest order. */
export function con25TypeCaseIds() {
  return CASES.filter((c) => c.databaseType !== null).map((c) => c.executionId);
}

/** The database type behind a CON25 id, or `null` for the failure / identity scenarios. */
export function con25DatabaseType(executionId) {
  return BY_ID.get(executionId)?.databaseType ?? null;
}

/** The quoted support status of a CON25 id. */
export function con25SupportStatus(executionId) {
  return BY_ID.get(executionId)?.supportStatus ?? null;
}

/**
 * Whether a "real query support passed" verdict is expressible for this id.
 *
 * Only the `verified` type cases may carry it. An `experimental` or `roadmap` type
 * may only be verified for its declared limits and fail-closed behaviour, so this
 * returns `false` for them — the caller cannot even construct such a verdict.
 */
export function con25RealQuerySupportExpressible(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return false;
  if (item.databaseType === null) return false;
  return item.supportStatus === "verified";
}

/**
 * The outcome of a CON25 id when the required environment is absent.
 * Never `passed`; `blocked` always carries a structured reason.
 */
export function con25OutcomeWithoutEnvironment(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return { status: "not_run", blockedReason: null };
  return { ...item.expectedOutcomeWithoutEnvironment };
}

/** The evidence dimension names a CON25 id must report before it can be judged. */
export function con25RequiredDimensions(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return [];
  if (item.databaseType === null) return ["fail-closed-contract", "real-failure-path"];
  const dims = ["support-status-lookup", "database-type-mapping", "real-connection", "real-read-only-query"];
  if (item.supportStatus === "gated") dims.push("certification-environment");
  return dims;
}

/**
 * Derives a CON25 item's status from its per-dimension outcomes.
 *
 * `environmentAvailable: false` short-circuits to the structured `blocked` outcome —
 * a `gated` type without its certification environment is `blocked`, never `passed`,
 * and never silently upgraded.
 *
 * A `verdict` naming one of the item's `forbiddenPassSemantics` is rejected outright
 * (`failed`): an `experimental` / `roadmap` item can never carry a "real query
 * support passed" verdict.
 */
export function con25StatusFor(executionId, {
  dimensionStatuses = {},
  environmentAvailable = true,
  verdict = null,
  verifierPassed
} = {}) {
  const item = BY_ID.get(executionId);
  if (!item) return "not_run";
  if (verdict && item.forbiddenPassSemantics.includes(verdict)) return "failed";
  if (!environmentAvailable) return item.expectedOutcomeWithoutEnvironment.status;
  const required = con25RequiredDimensions(executionId);
  const status = statusFromDimensions(dimensionStatuses, { required, verifierPassed });
  if (status !== "passed") return status;
  if (item.supportStatus === "gated" && dimensionStatuses["certification-environment"]?.status !== "passed") {
    return item.expectedOutcomeWithoutEnvironment.status;
  }
  return "passed";
}

/**
 * Judges an OBSERVED access-failure outcome against the fail-closed contract.
 *
 * Pure: it never touches the network. The observation is what a runner recorded:
 *
 *   {
 *     connectionSucceeded: boolean,      // did the connection end up usable?
 *     usable: boolean,                   // is the connection listed as available?
 *     errorClass: "auth" | "network" | "timeout" | "tls" | "unsupported" | "other",
 *     leakedSecrets: string[],           // secret-like substrings found in the response
 *     upstreamExecutions: number,        // upstream queries actually dispatched
 *     matchedSides: number,              // for CON25-09: how many same-name sides matched
 *     unauthorizedUpstreamExecutions: number
 *   }
 *
 * A permissive outcome is REJECTED: a wrong credential that still connected, a
 * network failure reported as "dialect unsupported", a TLS failure that left the
 * connection usable, or a secret that reached the response.
 */
export function con25FailClosedVerdict(executionId, observation = {}) {
  const item = BY_ID.get(executionId);
  if (!item) return { ok: false, reason: `unknown execution id ${executionId}` };
  const leaked = (observation.leakedSecrets ?? []).filter((s) => typeof s === "string" && s.length > 0);
  if (leaked.length > 0) return { ok: false, reason: `secret leaked in response: ${leaked.length} item(s)` };
  if (executionId === "CON25-09") {
    // The identity scenario is NOT a failure scenario: a successful connection is expected.
    // What must hold is that exactly one same-name side is addressed and that the other
    // side never executed upstream.
    if (observation.matchedSides !== 1) {
      return { ok: false, reason: `same-name table identity matched ${observation.matchedSides} side(s), expected exactly one` };
    }
    if ((observation.unauthorizedUpstreamExecutions ?? 0) > 0) {
      return { ok: false, reason: "the unauthorized side executed upstream queries" };
    }
    return { ok: true, reason: "exactly one authorized side matched; the other side never executed upstream" };
  }
  if (observation.usable === true) return { ok: false, reason: "the connection stayed usable after a failure" };
  if (observation.connectionSucceeded === true) return { ok: false, reason: "the connection succeeded although it must fail closed" };
  if (observation.errorClass === "unsupported") {
    return { ok: false, reason: "a connection failure was reported as an unsupported dialect" };
  }
  if ((observation.upstreamExecutions ?? 0) > 0) {
    return { ok: false, reason: `upstream was dispatched ${observation.upstreamExecutions} time(s) after a failed connection` };
  }
  const expectedErrorClass = { "CON25-10": "auth", "CON25-11": "network", "CON25-12": "tls" }[executionId];
  if (expectedErrorClass && observation.errorClass !== expectedErrorClass) {
    return { ok: false, reason: `error class ${observation.errorClass ?? "none"} is not the expected ${expectedErrorClass}` };
  }
  return { ok: true, reason: `failed closed with a diagnosable ${observation.errorClass ?? "error"} reason` };
}

/**
 * The evidence dimensions of a CON25 id: which are computable in this environment and
 * which need a real external system (with the blocked reason they would carry).
 */
function buildDimensions(item) {
  if (item.databaseType === null) {
    return [
      { name: "fail-closed-contract", computableHere: true, requiresRealEnvironment: false, blockedReason: null, note: "失败关闭契约与规范源键身份可离线判定" },
      { name: "real-failure-path", computableHere: false, requiresRealEnvironment: true, blockedReason: "environment", note: "需要真实目标库或受控故障环境才能观察到失败关闭行为" }
    ];
  }
  const dims = [
    { name: "support-status-lookup", computableHere: true, requiresRealEnvironment: false, blockedReason: null, note: "支持状态只读自 docs/governance/database-support-matrix.md §3，不在此升级" },
    { name: "database-type-mapping", computableHere: true, requiresRealEnvironment: false, blockedReason: null, note: "数据库类型映射只读自 webui/src/lib/connectionId.ts 的 DATABASE_TYPES" },
    { name: "real-connection", computableHere: false, requiresRealEnvironment: true, blockedReason: "environment", note: "需要本轮目标数据库实例" },
    { name: "real-read-only-query", computableHere: false, requiresRealEnvironment: true, blockedReason: "environment", note: "需要真实查询与独立 oracle" }
  ];
  if (item.supportStatus === "gated") {
    dims.push({
      name: "certification-environment",
      computableHere: false,
      requiresRealEnvironment: true,
      blockedReason: "environment",
      note: "gated 类型需要各自的认证环境；缺失即 blocked(environment)，支持状态不得晋级"
    });
  }
  return dims;
}

export function con25EvidenceDimensions(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return { locallyComputable: [], needsRealEnvironment: [] };
  const dims = buildDimensions(item);
  return {
    locallyComputable: dims.filter((d) => d.computableHere).map((d) => d.name),
    needsRealEnvironment: dims
      .filter((d) => d.requiresRealEnvironment)
      .map((d) => ({ dimension: d.name, reason: d.blockedReason, note: d.note }))
  };
}
