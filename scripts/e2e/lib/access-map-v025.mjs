// v0.25 ACM25-SC-01..SC-14 — access relation sankey (访问关系图).
//
// Authority:
//   * webui/docs/187-access-relation-sankey-spec.md §10 (SC-01..SC-14)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.2
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// Pure module: declarative descriptors only. No I/O, no network, no fixture mutation, and
// never a run status — status lives in the result file (scripts/e2e/lib/v025-result.mjs).
//
// Descriptor shape (identical to hive-v025.mjs / connection-matrix-v025.mjs /
// row-policy-templates-v025.mjs / authorization-summary-v025.mjs): executionId,
// sourceRequirementId, sourceSpec, ownerBranch, priority, executors, requires, assert,
// artifacts, title, steps, assertionSteps (the same array), dimensions, failClosed,
// passSemantics, forbiddenPassSemantics.
//
// The relation graph is an OBSERVATION surface, not the runtime arbiter (Plan §6.2). Its
// refusal contracts are therefore about not over-claiming: an unknown snapshot must never
// be upgraded to a confirmed over-reach, a degraded state must never render as an empty
// graph, and the two trust tiers must never borrow each other's wording. Those are
// executable through `accessMapRefusalVerdict()`.

const SOURCE_SPEC = "webui/docs/187-access-relation-sankey-spec.md";

const EXECUTORS = Object.freeze(["P", "B", "V"]);
const REQUIRES = Object.freeze(["lucy-http", "ktx-upstream", "postgres", "browser"]);
const ASSERT = Object.freeze(["consistency", "exactly_one_wins"]);
const ARTIFACTS = Object.freeze(["management-case-result.json"]);

const BROWSER_LAYER = Object.freeze({
  name: "browser-e2e",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "真实页面动作与深链需要已准备的运行实例（prepared run instance）"
});
const REGRESSION_LAYER = Object.freeze({
  name: "regression",
  computableHere: true,
  requiresRealEnvironment: false,
  blockedReason: null,
  note: "既有测试全量由 cd webui && npm test 覆盖"
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

/** Builds one ACM descriptor. */
function acm(sourceRequirementId, title, steps, dimensions, failClosed) {
  return Object.freeze({
    executionId: `ACM25-${sourceRequirementId}`,
    sourceRequirementId,
    sourceSpec: SOURCE_SPEC,
    ownerBranch: "OBSERVE",
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
    passSemantics: "单元守恒／计数＋组件交互＋真实事件＋浏览器深链与等价表格齐备才算通过；关系图不替代 ACCESS 的裁决测试",
    forbiddenPassSemantics: Object.freeze([])
  });
}

/** ACM25-SC-01..SC-14 — 访问关系图 (access relation sankey). */
export const ACM25_CASES = Object.freeze([
  acm("SC-01", "四层主干渲染与节点副行", [
    "四层主干渲染完整，缺层不留空洞",
    "节点副行同时含去重 Agent 数与路径数",
    "两个数字来源不同，不互相替代"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖四层主干与节点计数"),
    localLayer("component", "P1 组件测试已覆盖节点副行的两个数字"),
    BROWSER_LAYER
  ], noRefusal()),
  acm("SC-02", "流带宽度守恒自检", [
    "对随机权限配置遍历所有非凭证节点",
    "每个节点的入流 `grantPaths` 等于出流 `grantPaths`（误差 0）",
    "守恒从公开响应独立重算，不使用实现自带的判定函数"
  ], [
    localLayer("unit", "P1 守恒自检已覆盖误差 0"),
    localLayer("conservation", "P1 守恒测试从公开响应独立重算")
  ], noRefusal()),
  acm("SC-03", "授权有／访问无的休眠边", [
    "构造「授权有、访问无」的 fixture",
    "该边的 `state` 等于 `dormant`",
    "该边的内核宽度为 0"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖休眠边状态"),
    localLayer("component", "P1 组件测试已覆盖休眠边内核宽度")
  ], noRefusal()),
  acm("SC-04", "Token 只过滤访问层", [
    "点击 Token 后访问层的内核宽度发生变化",
    "授权骨架的边数与 `grantPaths` 不变",
    "顶部出现提示条"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖授权骨架不变"),
    localLayer("component", "P1 组件测试已覆盖访问层变化与提示条")
  ], noRefusal()),
  acm("SC-05", "候选关联记录的默认口径", [
    "注入 `association_status = 'candidate'` 的记录",
    "默认口径下候选记录不计入内核",
    "切到含候选口径后候选记录计入"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖候选口径切换")
  ], noRefusal()),
  acm("SC-06", "从 Agent 详情页深链进入关系图", [
    "从 Agent 详情页点击深链进入独立页",
    "独立页 URL 含 `agent=<id>`",
    "图已聚焦到该 Agent"
  ], [
    localLayer("component", "P1 组件测试已覆盖聚焦行为"),
    BROWSER_LAYER
  ], noRefusal()),
  acm("SC-07", "三种降级态的提示", [
    "分别构造 `access_unreadable`／`access_invalid`／`access_config_path_mismatch`",
    "每种降级态渲染对应的降级提示",
    "降级态不是一张空图"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖三种降级态")
  ], refusal(["consistency"], "每种降级态渲染对应的降级提示，而不是空图",
    "降级必须显式呈现：不得用一张空图冒充读不到／无效／路径不匹配")),
  acm("SC-08", "大图折叠", [
    "注入 200 节点的配置",
    "`meta.folded.nodes` 大于 0",
    "图上有可见的折叠徽标"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖折叠元数据")
  ], noRefusal()),
  acm("SC-09", "表格视图与可访问性", [
    "表格视图可以切换",
    "节点列表可 Tab 聚焦",
    "图区有 `aria-label` 摘要"
  ], [
    localLayer("component", "P1 组件测试已覆盖表格视图与 aria-label"),
    localLayer("accessibility", "可达性由既有可访问性检查覆盖"),
    BROWSER_LAYER
  ], noRefusal()),
  acm("SC-10", "越权文案的两档区分", [
    "需复核档的 UI 文案不含「越权」二字",
    "确凿越权档文案含「调用当时授权亦不覆盖」",
    "两档文案不互相串用"
  ], [
    localLayer("copy-assertion", "P1 文案断言已覆盖两档措辞")
  ], refusal(["consistency"], "需复核档不含「越权」；确凿越权档含「调用当时授权亦不覆盖」",
    "两档措辞不得互相串用：第一档一律不含「越权」二字，第二档必须带规定文案")),
  acm("SC-11", "术语标准覆盖新增词", [
    "`npm run lint:terminology` 通过",
    "术语标准 §4.8「访问权限升级」已含附录 A 的 6 个新词"
  ], [
    localLayer("lint", "npm run lint:terminology 覆盖术语")
  ], noRefusal()),
  acm("SC-12", "既有测试全量与快照无变化", [
    "`cd webui && npm test` 全绿",
    "既有 Agent 页、角色页与审计页的快照无变化"
  ], [
    REGRESSION_LAYER
  ], noRefusal()),
  acm("SC-13", "快照覆盖率分档", [
    "覆盖 matched／missing／invalid 三种快照",
    "覆盖率的分子与分母正确",
    "unknown 不升级为确凿越权"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖三种快照分档"),
    localLayer("copy-assertion", "P1 文案断言已覆盖 unknown 的措辞")
  ], refusal(["consistency"], "unknown 不升级为确凿越权；覆盖率分子分母正确",
    "缺失或无效的快照只能保留「需复核」，不得升级为确凿越权；覆盖率分子分母必须正确")),
  acm("SC-14", "跨模块计数对账", [
    "同一快照下摘要的表集合等于授权路径表集合的并集",
    "多角色、重复访问时四种计数不混用"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖四种计数不混用"),
    localLayer("cross-module-contract", "P1 跨模块契约测试已覆盖同快照表集合并集")
  ], noRefusal())
]);

const BY_ID = new Map(ACM25_CASES.map((c) => [c.executionId, c]));

/** Returns the descriptor for an ACM execution id, or `null`. */
export function accessMapCaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** All ACM execution ids. */
export function accessMapCaseIds() {
  return ACM25_CASES.map((c) => c.executionId);
}

/** The refusal contracts of this group, keyed by execution id. */
const REFUSAL_RULES = Object.freeze({
  "ACM25-SC-07": (o) => {
    const states = [...new Set(o.degradedStates ?? [])];
    if (states.length < 3) return `only ${states.length} degraded state(s) handled, expected 3`;
    if (o.renderedEmptyGraph === true) return "a degraded state rendered as an empty graph";
    return null;
  },
  "ACM25-SC-10": (o) => {
    const needsReview = String(o.needsReviewCopy ?? "");
    const confirmed = String(o.confirmedCopy ?? "");
    if (needsReview.includes("越权")) return "the 需复核 tier borrows the 越权 wording";
    if (confirmed.length > 0 && !confirmed.includes("调用当时授权亦不覆盖")) {
      return "the 确凿越权 tier lost its declared wording";
    }
    return null;
  },
  "ACM25-SC-13": (o) => {
    if (o.unknownUpgradedToConfirmed === true) return "an unknown snapshot was upgraded to a confirmed over-reach";
    if (o.coverageNumerator !== o.coverageDenominator && o.coverageUnknownFilledWithZero === true) {
      return "the coverage ratio filled an unknown with 0";
    }
    if (o.coverageNumerator === undefined || o.coverageDenominator === undefined) {
      return "the coverage numerator／denominator was not reported";
    }
    return null;
  }
});

/**
 * Judges an OBSERVED outcome against an access-map refusal contract.
 * A permissive outcome (an over-claimed verdict) is rejected.
 */
export function accessMapRefusalVerdict(executionId, observation = {}) {
  const rule = REFUSAL_RULES[executionId];
  if (!rule) return { ok: true, reason: "not a refusal contract; nothing to refuse" };
  const problem = rule(observation);
  return problem ? { ok: false, reason: problem } : { ok: true, reason: "the refusal contract holds" };
}

/** The refusal-contract execution ids of this group. */
export function accessMapRefusalIds() {
  return Object.keys(REFUSAL_RULES).sort();
}
