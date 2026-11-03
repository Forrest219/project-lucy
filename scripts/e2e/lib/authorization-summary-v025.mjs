// v0.25 ASV25-01..14 — access authorization summary.
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §8 (ASV-01..14)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.1
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// Pure module: declarative descriptors only. No I/O, no network, no fixture mutation, and
// never a run status — status lives in the result file (scripts/e2e/lib/v025-result.mjs).
//
// Descriptor shape (identical to hive-v025.mjs / connection-matrix-v025.mjs /
// row-policy-templates-v025.mjs): executionId, sourceRequirementId, sourceSpec,
// ownerBranch, priority, executors, requires, assert, artifacts, title, steps,
// assertionSteps (the same array), dimensions, failClosed, passSemantics,
// forbiddenPassSemantics.
//
// The summary is a READ-ONLY view of an authorization fact. Five of its ids are refusal
// contracts: they are executable through `authorizationSummaryRefusalVerdict()`, which
// rejects a permissive outcome (a zero value masquerading as a result, an unknown
// denominator filled with 0, a deep link that auto-executed a query, a new write entry,
// a secret on the page).

const SOURCE_SPEC = "docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md";

const EXECUTORS = Object.freeze(["P", "B", "V"]);
const REQUIRES = Object.freeze(["lucy-http", "ktx-upstream", "postgres", "browser"]);
const ASSERT = Object.freeze(["consistency", "deny", "no_leak"]);
const ARTIFACTS = Object.freeze(["management-case-result.json", "leak-scan.json"]);

const BROWSER_LAYER = Object.freeze({
  name: "browser-e2e",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "真实浏览器动作需要已准备的运行实例（prepared run instance）"
});
const RUN_INSTANCE_LAYER = Object.freeze({
  name: "prepared-run-instance",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "真实 MCP / 运行时同源编译需要已准备的运行实例"
});

function localLayer(name, note) {
  return { name, computableHere: true, requiresRealEnvironment: false, blockedReason: null, note };
}

function noRefusal() {
  return Object.freeze({
    isRefusal: false,
    expectation: Object.freeze([]),
    tokens: Object.freeze([]),
    reason: "",
    detail: ""
  });
}

function refusal(tokens, reason, detail = "") {
  return Object.freeze({
    isRefusal: true,
    expectation: Object.freeze([...tokens]),
    tokens: Object.freeze([...tokens]),
    reason,
    detail
  });
}

/** Builds one ASV descriptor. */
function asv(sourceRequirementId, title, steps, dimensions, failClosed) {
  return Object.freeze({
    executionId: `ASV25-${sourceRequirementId.slice("ASV-".length)}`,
    sourceRequirementId,
    sourceSpec: SOURCE_SPEC,
    ownerBranch: "ACCESS",
    priority: "P1",
    executors: EXECUTORS,
    requires: REQUIRES,
    assert: ASSERT,
    artifacts: ARTIFACTS,
    title,
    steps: Object.freeze(steps),
    assertionSteps: Object.freeze(steps),
    dimensions: Object.freeze(dimensions),
    failClosed: Object.freeze(failClosed),
    passSemantics: "编译同源 contract＋Agent／Role 浏览器视图＋深链＋秘密保护齐备才算通过；与 RTV／ACM 同快照对账",
    forbiddenPassSemantics: Object.freeze([])
  });
}

/** ASV25-01..14 — 授权摘要 (access authorization summary). */
export const ASV25_CASES = Object.freeze([
  asv("ASV-01", "单 Role、单连接、多表", [
    "一句话摘要、资源卡片与 capability 集合三者一致",
    "表数按规范源键去重，同一张表不重复计数"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖去重计数"),
    localLayer("server-contract", "P1 服务端测试已覆盖摘要／卡片／capability 一致"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  asv("ASV-02", "多 Role 重复授权同表", [
    "多 Role 重复授权同一张表时表数不重复",
    "全部角色来源都可见",
    "OR 语义不被改成 AND"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖角色来源去重"),
    localLayer("server-contract", "P1 服务端测试已覆盖 OR 语义"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  asv("ASV-03", "多工具覆盖同表", [
    "表数不因工具数量增加而放大",
    "每个「工具×表×行」边界仍然可单独查询"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖工具数不放大表数"),
    localLayer("server-contract", "P1 服务端测试已覆盖工具×表×行边界可查"),
    BROWSER_LAYER
  ], noRefusal()),
  asv("ASV-04", "启用表目录完整／不完整", [
    "分母只在可证明完整时才展示",
    "未知不填 0",
    "不保留上一次的陈旧数字"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖分母可证明性"),
    localLayer("server-contract", "P1 服务端测试已覆盖未知不填 0"),
    BROWSER_LAYER
  ], refusal(["consistency"], "分母只在可证明时展示；未知不填 0；不保留陈旧数字",
    "启用表目录不完整时不得展示分母，不得用 0 冒充未知，也不得保留上一次的陈旧数字")),
  asv("ASV-05", "Agent 行策略与个人行限制", [
    "摘要里的最终行约束与运行时的同一编译结果一致",
    "OR-of-AND 结构被保留，不被压平成一条条件"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖最终行约束同源"),
    localLayer("server-contract", "P1 服务端测试已覆盖 OR-of-AND 保留"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  asv("ASV-06", "Role 与 Agent 对照", [
    "Role 摘要不含 Agent 的个人行限制",
    "通用 Role 预览不冒充 Agent 的 FinalRows"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖 Role 与 Agent 的边界差异"),
    localLayer("server-contract", "P1 服务端测试已覆盖 Role 预览不冒充 FinalRows"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  asv("ASV-07", "模板与内联行策略", [
    "摘要来自展开后的编译产物",
    "模板名只作溯源信息，不改变摘要语义"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖模板展开后摘要"),
    localLayer("server-contract", "P1 服务端测试已覆盖模板名仅作溯源"),
    BROWSER_LAYER
  ], noRefusal()),
  asv("ASV-08", "配置三类问题与角色失败", [
    "`unavailable` 与 `partial` 判定正确",
    "失败的集合在界面上可见",
    "没有任何零值冒充可用结果"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖三态降级判定"),
    localLayer("server-contract", "P1 服务端测试已覆盖失败集合可见"),
    BROWSER_LAYER
  ], refusal(["deny"], "`unavailable`／`partial` 判定正确；失败集合可见；无零值冒充",
    "配置问题与角色失败必须落到 unavailable／partial，失败集合必须可见，任何零值都不得冒充可用结果")),
  asv("ASV-09", "新建／编辑 dry-run", [
    "候选摘要明确标注「未生效」",
    "草稿或基线变化使旧预览失效",
    "dry-run 不落盘"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖候选摘要未生效标记"),
    localLayer("server-contract", "P1 服务端测试已覆盖旧预览失效与不落盘"),
    BROWSER_LAYER
  ], noRefusal()),
  asv("ASV-10", "调试台深链", [
    "深链预填 `agentId`／`mode`／`tool`／`args` 正确",
    "深链只触发既有 ACL 预览，不自动执行查询",
    "自动执行被断言为未发生"
  ], [
    localLayer("unit", "P1 组件测试已覆盖深链预填"),
    localLayer("component", "P1 组件测试已覆盖深链不自动执行"),
    BROWSER_LAYER
  ], refusal(["deny"], "深链只触发既有 ACL 预览，不自动执行查询",
    "调试台深链不得自动执行查询：只允许触发既有 ACL 预览")),
  asv("ASV-11", "与 L25-08／R3 对账", [
    "同一快照下表集合与行边界与对账方一致",
    "路径数、调用数、表数分别表达，互不替代"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖三种计数分别表达"),
    localLayer("cross-module-contract", "P1 跨模块契约测试已覆盖同快照表集合一致")
  ], noRefusal()),
  asv("ASV-12", "legacy、空能力与系统禁止工具", [
    "legacy 配置被明确标识",
    "空能力与调用失败可区分",
    "AbsoluteDeny 的工具不变成可授予"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖 legacy 标识"),
    localLayer("server-contract", "P1 服务端测试已覆盖空能力与失败可分"),
    BROWSER_LAYER
  ], refusal(["deny"], "AbsoluteDeny 不变成可授予；空能力与失败可分；legacy 明确标识",
    "系统禁止工具必须保持 AbsoluteDeny：不得变成可授予，空能力不得与失败混为一谈")),
  asv("ASV-13", "只读与秘密保护", [
    "没有新增写入口",
    "响应与页面不含 Token 明文、数据库密码或超授权内容"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖无新写入口"),
    localLayer("leak-scan", "泄漏扫描由既有 leak-scan 流程覆盖"),
    BROWSER_LAYER
  ], refusal(["no_leak"], "响应和页面不含 Token 明文、数据库密码或超授权内容",
    "授权摘要不得暴露 Token 明文、数据库密码或超授权内容，也不得新增写入口")),
  asv("ASV-14", "术语与可达性", [
    "术语 lint 通过，不引入新用户可见术语",
    "完整标识的翻译防御到位",
    "键盘与文本降级符合规范",
    "既有页面行为无回归"
  ], [
    localLayer("lint", "npm run lint:terminology 覆盖术语"),
    localLayer("component", "P1 组件测试已覆盖翻译防御与键盘降级"),
    localLayer("accessibility", "可达性由既有可访问性检查覆盖"),
    localLayer("regression", "既有页面行为无回归由既有回归套件覆盖"),
    BROWSER_LAYER
  ], noRefusal())
]);

const BY_ID = new Map(ASV25_CASES.map((c) => [c.executionId, c]));

/** Returns the descriptor for an ASV execution id, or `null`. */
export function authorizationSummaryCaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** All ASV execution ids. */
export function authorizationSummaryCaseIds() {
  return ASV25_CASES.map((c) => c.executionId);
}

/** The refusal contracts of this group, keyed by execution id. */
const REFUSAL_RULES = Object.freeze({
  "ASV25-04": (o) => {
    if (o.denominatorUnknown === true && o.denominatorShown === true) {
      return "a denominator was shown although the enabled-table catalog is unknown";
    }
    if (o.unknownFilledWithZero === true) return "an unknown denominator was filled with 0";
    if (o.staleNumberKept === true) return "a stale denominator from the previous render was kept";
    return null;
  },
  "ASV25-08": (o) => {
    const state = String(o.state ?? "");
    if (state !== "unavailable" && state !== "partial") return `the state is "${state}", expected unavailable or partial`;
    if (o.failuresVisible !== true) return "the failed set is not visible";
    if (o.showedZeroValue === true) return "a zero value was displayed instead of a failure";
    return null;
  },
  "ASV25-10": (o) => {
    if (o.prefilledOk !== true) return "the deep link did not prefill agentId／mode／tool／args correctly";
    if (o.autoExecuted === true) return "the deep link auto-executed a query instead of only previewing";
    return null;
  },
  "ASV25-12": (o) => {
    if (o.legacyIdentified !== true) return "a legacy configuration was not identified";
    if (o.emptyDistinguishableFromFailure !== true) return "an empty capability set cannot be told from a failure";
    if (o.absoluteDenyGrantable === true) return "an AbsoluteDeny tool became grantable";
    return null;
  },
  "ASV25-13": (o) => {
    if ((o.newWriteEntries ?? -1) !== 0) return `the summary exposes ${o.newWriteEntries} new write entry(ies)`;
    const leaked = (o.leakedSecrets ?? []).filter((s) => typeof s === "string" && s.length > 0);
    if (leaked.length > 0) return `${leaked.length} secret(s) reached the response or the page`;
    if (o.overAuthorizedContent === true) return "over-authorized content was rendered";
    return null;
  }
});

/**
 * Judges an OBSERVED outcome against an authorization-summary refusal contract.
 * A permissive outcome is rejected.
 */
export function authorizationSummaryRefusalVerdict(executionId, observation = {}) {
  const rule = REFUSAL_RULES[executionId];
  if (!rule) return { ok: true, reason: "not a refusal contract; nothing to refuse" };
  const problem = rule(observation);
  return problem ? { ok: false, reason: problem } : { ok: true, reason: "the refusal contract holds" };
}

/** The refusal-contract execution ids of this group. */
export function authorizationSummaryRefusalIds() {
  return Object.keys(REFUSAL_RULES).sort();
}
