// v0.25 HIV25-V01..V17 — Hive direct connection descriptors (Plan §6.3).
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §7 (V01–V17 acceptance matrix)
//   * docs/specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md §7.3
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.3
//
// Pure module: declarative descriptors only. No I/O, no network, no fixture mutation,
// and never a run status — status lives in the result file (scripts/e2e/lib/v025-result.mjs).
//
// ★ THE ONE STRUCTURAL RULE THIS MODULE ENFORCES ★
// The compile side and the real-HS2 execution side are SEPARATE evidence dimensions.
//
//   HIV25-V01 / V02 / V06 are compile-only: the Hive compiler, the source-closure
//   builder and the fail-closed guards can be exercised without any HS2.
//
//   HIV25-V03 / V04 / V05 have BOTH sides. The compile side (independent Hive AST,
//   source closure, column lineage) is computable offline; the HS2 side (EXPLAIN plus
//   a real execution compared against an independent oracle) needs a real cluster.
//
//   A compile-side pass can therefore never be reported as "HS2 execution passed":
//   `hiveStatusFor()` derives the item status from EVERY declared dimension, and
//   `statusFromDimensions()` returns `not_run` when a required dimension did not run.
//   The Hive suite name is a suite, not a seventh responsibility branch — the owner
//   branch of all 17 ids is CONN.

import { statusFromDimensions } from "./v025-result.mjs";

/** HIV25-V01..V17, in execution-id order. */
export const HIV25_EXECUTION_IDS = Object.freeze([
  "HIV25-V01", "HIV25-V02", "HIV25-V03", "HIV25-V04", "HIV25-V05", "HIV25-V06",
  "HIV25-V07", "HIV25-V08", "HIV25-V09", "HIV25-V10", "HIV25-V11", "HIV25-V12",
  "HIV25-V13", "HIV25-V14", "HIV25-V15", "HIV25-V16", "HIV25-V17"
]);

/** The ids whose compile-side evidence is complete without a real HS2 cluster. */
export const HIV25_COMPILE_ONLY_IDS = Object.freeze(["HIV25-V01", "HIV25-V02", "HIV25-V06"]);

/** The ids that carry BOTH a compile-side and a real-HS2 dimension. */
export const HIV25_SPLIT_IDS = Object.freeze(["HIV25-V03", "HIV25-V04", "HIV25-V05"]);

/** The ids that need a real HS2 / JDBC environment for their execution dimension. */
export const HIV25_REAL_HS2_IDS = Object.freeze([
  "HIV25-V03", "HIV25-V04", "HIV25-V05", "HIV25-V07", "HIV25-V08", "HIV25-V09",
  "HIV25-V10", "HIV25-V11", "HIV25-V12", "HIV25-V13", "HIV25-V14", "HIV25-V15"
]);

/** The ids that need a customer certification / delivery environment. */
export const HIV25_DELIVERY_IDS = Object.freeze(["HIV25-V16", "HIV25-V17"]);

const ARTIFACTS = Object.freeze(["management-case-result.json", "security-case-result.json"]);
const EXECUTORS = Object.freeze(["P", "B", "D", "A", "O", "V"]);
const REQUIRES = Object.freeze([
  "lucy-http", "ktx-upstream", "postgres", "browser", "agent-client", "fault-control", "k8s-amd64"
]);
const ASSERTS = Object.freeze(["allow_control", "deny", "no_leak"]);

const COMPILE_DIMENSION = Object.freeze({
  name: "compile-side",
  computableHere: true,
  requiresRealEnvironment: false,
  blockedReason: null,
  note: "Hive 编译器与来源闭包构建器可在本地离线执行；不产生 JDBC 分派"
});
const PROTOCOL_DIMENSION = Object.freeze({
  name: "protocol-runtime",
  computableHere: true,
  requiresRealEnvironment: false,
  blockedReason: null,
  note: "Lucy HTTP 协议层返回结构化结果；由 P1 已有的服务端测试覆盖，不需要真实 HS2"
});
const HS2_DIMENSION = Object.freeze({
  name: "real-hs2",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "需要真实 HiveServer2 集群与独立 oracle；缺环境即 blocked(environment)"
});
const DELIVERY_DIMENSION = Object.freeze({
  name: "delivery",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "delivery",
  note: "需要客户认证／离线 amd64 交付组合；缺环境即 blocked(delivery)"
});
const HS2_ENVIRONMENT_DIMENSION = Object.freeze({
  name: "real-hs2",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "需要真实 HiveServer2 集群；缺环境即 blocked(environment)"
});

/**
 * The refusal contracts of the Hive group: the ids whose contract IS a refusal.
 */
const REFUSAL_EXPECTATIONS = Object.freeze({
  "HIV25-V06": "非法输入、编译异常、超时与超大输出必须在编译侧失败关闭：不分派 JDBC、不回退 Postgres、不返回未校验 SQL",
  "HIV25-V09": "explain 不得执行；内部入口不得绕过同一 ACL、预算与审计",
  "HIV25-V11": "越权、隐藏列、未启用表与伪造强制字段必须在 ExecuteStatement 之前被拒绝，并以空结果代替拒绝即为失败",
  "HIV25-V13": "多语句、写入与 JDBC 参数注入必须在 driver 执行之前被拒绝；只读账号不构成唯一证明",
  "HIV25-V15": "接收或准入账本失败时不准入、不分派；响应准备失败不释放资源，execution 与 delivery 必须分离"
});

function hiveCase(executionId, sourceRequirementId, title, assertionSteps, dimensions, passSemantics) {
  const expectation = REFUSAL_EXPECTATIONS[executionId];
  return Object.freeze({
    executionId,
    sourceRequirementId,
    sourceSpec: "docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md",
    ownerBranch: "CONN",
    priority: "P1",
    executors: EXECUTORS,
    requires: REQUIRES,
    assert: ASSERTS,
    artifacts: ARTIFACTS,
    title,
    // `steps` is the canonical field name; `assertionSteps` is the same array under the
    // name the other descriptor modules use, so every module reads uniformly.
    steps: Object.freeze([...assertionSteps]),
    assertionSteps: Object.freeze(assertionSteps),
    dimensions: Object.freeze(dimensions),
    failClosed: Object.freeze(expectation
      ? {
          isRefusal: true,
          expectation: Object.freeze([...ASSERTS]),
          tokens: Object.freeze([...ASSERTS]),
          reason: expectation,
          detail: expectation
        }
      : {
          isRefusal: false,
          expectation: Object.freeze([]),
          tokens: Object.freeze([]),
          reason: "",
          detail: ""
        }),
    passSemantics,
    forbiddenPassSemantics: Object.freeze(["hs2_execution_passed_without_cluster", "hive_end_to_end_support_claimed"])
  });
}

const CASES = Object.freeze([
  hiveCase(
    "HIV25-V01",
    "V01",
    "固定 runtime 的 semantic-validate／query",
    [
      "对固定 runtime 输入调用 semantic-validate，断言返回结构化的 SQL 与 plan",
      "断言在没有任何数据库配置与凭据时该调用仍返回结构化结果，而不是因缺配置失败",
      "断言输入拒绝（非法输入）与进程失败（编译异常）返回可区分的结果类别",
      "断言该路径不产生 JDBC 分派，也不回退到 Postgres"
    ],
    [COMPILE_DIMENSION, PROTOCOL_DIMENSION],
    "编译侧通过只证明 semantic-validate 的结构化返回与失败分类；不表示真实执行或端到端支持"
  ),
  hiveCase(
    "HIV25-V02",
    "V02",
    "Manifest＋overlay 完整来源",
    [
      "以含 grain、派生列、segment、join、隐藏列的 Manifest＋overlay 编译",
      "断言展开后的来源闭包完整：五类来源都不丢",
      "断言重复引用、孤立引用、未知引用分别失败关闭，并给出可区分的原因",
      "断言编译过程不产生 JDBC 分派"
    ],
    [COMPILE_DIMENSION, PROTOCOL_DIMENSION],
    "编译侧通过只证明来源闭包完整与失败分类；不表示真实执行或端到端支持"
  ),
  hiveCase(
    "HIV25-V03",
    "V03",
    "聚合、NULL、过滤、排序、limit",
    [
      "编译侧：用独立的 Hive AST 编译聚合、NULL、过滤、排序与 limit，断言不依赖 HS2",
      "编译侧：断言产物是 Hive 方言，不回落 Postgres 语法",
      "执行侧：在真实 HS2 上执行 EXPLAIN，断言 EXPLAIN 成功",
      "执行侧：在真实 HS2 上真实执行，结果等于独立 oracle（固定数据 sum=30.50、COUNT(*)=3、COUNT(amount)=2）",
      "执行侧：断言参考 HS2 EXPLAIN 与真实执行三者结果一致"
    ],
    [COMPILE_DIMENSION, HS2_DIMENSION],
    "编译侧与执行侧分证：编译侧通过只更新编译证据；HS2 执行侧未执行时本项不是通过"
  ),
  hiveCase(
    "HIV25-V04",
    "V04",
    "时间分组、时区、标识符",
    [
      "编译侧：断言日／月／周／季度／年五种分组编译正确，跨年周不漂移",
      "编译侧：断言标识符转义后的编译产物可被独立解析",
      "执行侧：在真实 HS2 上执行 EXPLAIN，断言 EXPLAIN 通过",
      "执行侧：真实执行结果与独立 oracle 一致",
      "执行侧：断言编译成功但 EXPLAIN 失败判 fail，不降级为通过"
    ],
    [COMPILE_DIMENSION, HS2_DIMENSION],
    "编译侧与执行侧分证：编译侧通过只更新编译证据；EXPLAIN 失败即 fail，不得被编译通过掩盖"
  ),
  hiveCase(
    "HIV25-V05",
    "V05",
    "JOIN、fan-out、CTE、sql source",
    [
      "编译侧：断言来源闭包与列血缘正确，聚合不因 fan-out 膨胀",
      "编译侧：断言不支持的形态被明确拒绝，而不是静默改写",
      "执行侧：在真实 HS2 上执行 EXPLAIN 并真实执行，结果等于独立 oracle",
      "执行侧：断言一对多表与 CTE 的结果与独立手写 SQL 一致"
    ],
    [COMPILE_DIMENSION, HS2_DIMENSION],
    "编译侧与执行侧分证：编译侧通过只更新编译证据；HS2 执行侧未执行时本项不是通过"
  ),
  hiveCase(
    "HIV25-V06",
    "V06",
    "非法输入、编译异常、超时、超大输出",
    [
      "断言非法输入在编译侧被拒绝，不产生 JDBC 分派",
      "断言编译异常返回可诊断的失败类别，不返回未校验 SQL",
      "断言超时与超大输出在编译侧被拦截并给出明确原因",
      "断言任何失败路径都不回退到 Postgres，也不把失败伪装成空结果"
    ],
    [COMPILE_DIMENSION, PROTOCOL_DIMENSION],
    "编译侧通过只证明失败关闭与不回退；不表示真实执行或端到端支持"
  ),
  hiveCase(
    "HIV25-V07",
    "V07",
    "新建→测试→采集→发布→发现",
    [
      "在真实环境新建 Hive 连接并走 UI 连通测试",
      "执行真实采集，断言连接、表与 generation 在页面、API、MCP 三处一致",
      "断言 KTX 配置中没有 Hive 污染：既有连接与既有表不被改写",
      "断言发布后可被发现，且发现结果与 generation 对齐"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明本轮新建到发现的链路一致；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V08",
    "V08",
    "带 Token 的 Proxy 语义查询",
    [
      "用带 Token 的 MCP 请求发起语义查询，断言固定数据的结果正确",
      "断言最终 SQL、物理表、快照与 JDBC 执行可以相互关联",
      "断言 Token 明文不出现在响应与产物中",
      "断言未授权的上游执行数为 0"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明 Proxy 路径的正确性与可关联性；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V09",
    "V09",
    "明细、读取、explain、模板／内部调用",
    [
      "断言明细、读取、explain、模板与内部调用走同一路由与同一 ACL",
      "断言 explain 不执行：上游执行数为 0",
      "断言内部入口不绕过预算与审计，调用同样留下审计记录",
      "断言未授权路径的上游执行数为 0"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明路由、ACL 与预算审计一致；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V10",
    "V10",
    "跨 database 同名表与配置变更",
    [
      "断言跨 database 的同名表不串库，两个源各自可寻址",
      "断言配置变更后新 generation 生效、旧连接池失效",
      "断言删除后请求被拒绝，且原连接不受影响",
      "断言未授权一侧的上游执行数为 0"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明身份不串与 generation 切换正确；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V11",
    "V11",
    "越权、隐藏列、未启用表、伪造强制字段",
    [
      "断言越权请求在 ExecuteStatement 之前被拒绝，并记录拒绝原因",
      "断言隐藏列不可见、未启用表不可访问",
      "断言伪造强制字段不生效",
      "断言拒绝不以空结果代替，且拒绝路径的上游执行数为 0"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明拒绝发生在执行之前；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V12",
    "V12",
    "租户、角色组合、个人限制、转义、聚合 JOIN",
    [
      "断言结果与 FinalRows 以及独立 oracle 三者一致",
      "断言租户、角色组合与个人行限制的叠加语义正确",
      "断言转义与聚合 JOIN 的结果不被字符串包含式判定误判",
      "断言策略有效不只靠 SQL 包含字符串判定"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明行边界与结果一致；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V13",
    "V13",
    "多语句、写入与 JDBC 参数注入",
    [
      "断言多语句与写入在 driver 执行之前被拒绝",
      "断言固定元数据操作仍然可用",
      "断言 JDBC 参数注入被拦截，不进入 driver",
      "断言只读账号不构成唯一证明：拒绝发生在 driver 调用之前"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明拒绝点在 driver 之前；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V14",
    "V14",
    "慢查询、断开、超时、取消失败、worker 崩溃",
    [
      "断言 operation 的终态可核对",
      "断言未知状态记为 unknown，而不是猜测为成功或失败",
      "断言取消失败与 worker 崩溃后没有盲重试与资源泄漏",
      "断言失败路径的上游执行数与实际尝试一致"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明终态可核对与无盲重试；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V15",
    "V15",
    "接收／准入／响应准备账本失败",
    [
      "断言接收失败时不准入，不产生任何分派",
      "断言准入失败时不释放响应资源",
      "断言 execution 与 delivery 分开记录，不把两者混为一个终态",
      "断言账本失败路径的上游执行数为 0"
    ],
    [HS2_ENVIRONMENT_DIMENSION],
    "通过只证明账本失败时的分派与释放语义；缺真实 HS2 环境即 blocked(environment)"
  ),
  hiveCase(
    "HIV25-V16",
    "V16",
    "客户认证／HTTP／TLS／离线与 amd64",
    [
      "断言离线安装与运行不联网拉依赖",
      "断言秘密在认证、HTTP 与 TLS 三条路径上都不泄漏",
      "断言目标组合（认证、HTTP、TLS、离线 amd64）逐项按真实结果记录：通过、失败或 blocked 如实写明",
      "断言任一组合缺环境时记 blocked，不写成通过"
    ],
    [DELIVERY_DIMENSION],
    "通过只证明声明的认证／TLS／离线 amd64 组合；缺环境即 blocked(delivery)，不表示客户形态支持"
  ),
  hiveCase(
    "HIV25-V17",
    "V17",
    "升级、备份恢复与既有数据库回归",
    [
      "断言升级后无 Hive→KTX 污染：既有连接的表范围不被改写",
      "断言原角色、Token 与历史审计不被改写",
      "断言备份恢复后原路径仍可用",
      "断言恢复过程中的失败被如实记录，不写成通过"
    ],
    [DELIVERY_DIMENSION],
    "通过只证明升级与恢复的连续性；缺交付环境即 blocked(delivery)，不表示客户交付通过"
  )
]);

/** All Hive descriptors, in execution-id order. */
export const HIV25_CASES = Object.freeze(CASES);

const BY_ID = new Map(CASES.map((c) => [c.executionId, c]));

/** Returns the descriptor for a Hive execution id, or `null`. */
export function hiveCaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** All Hive execution ids. */
export function hiveCaseIds() {
  return CASES.map((c) => c.executionId);
}

/**
 * The dimension split of a Hive id: which side is compile-side, which needs a real HS2.
 * `compileSide: true` never implies `realHs2: true` — the two are independent.
 */
export function hiveDimensionSplit(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return { compileSide: false, realHs2: false, delivery: false };
  return {
    compileSide: item.dimensions.some((d) => d.name === "compile-side"),
    realHs2: item.dimensions.some((d) => d.name === "real-hs2"),
    delivery: item.dimensions.some((d) => d.name === "delivery")
  };
}

/**
 * Whether a compile-side pass could ever be reported as an HS2 execution pass.
 * Always `false` — that is the point of the split.
 */
export function hiveCompilePassCanSatisfyHs2(executionId) {
  return false;
}

/**
 * Derives a Hive item's status from its per-dimension outcomes.
 *
 * Because every declared dimension is required, a compile-side-only outcome is
 * `not_run` for V03–V05 — it can never be reported as an HS2 execution pass.
 */
export function hiveStatusFor(executionId, { dimensionStatuses = {}, verifierPassed } = {}) {
  const item = BY_ID.get(executionId);
  if (!item) return "not_run";
  const required = item.dimensions.map((d) => d.name);
  return statusFromDimensions(dimensionStatuses, { required, verifierPassed });
}

/**
 * The blocked reason a Hive id carries when its required environment is missing.
 * `environment` for the real-HS2 dimensions, `delivery` for the certification /
 * upgrade dimensions, `null` for the compile-only ids.
 */
export function hiveExpectedBlockedReason(executionId) {
  const item = BY_ID.get(executionId);
  if (!item) return null;
  const missing = item.dimensions.filter((d) => d.requiresRealEnvironment);
  if (missing.length === 0) return null;
  return missing[0].blockedReason;
}
