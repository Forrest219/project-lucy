// v0.25 RTP25-01..10 + RTV25-01..08 — row policy templates and per-table reverse lookup.
//
// Authority:
//   * docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md §8
//       (RTP-01..RTP-10 templates, RTV-01..RTV-08 reverse lookup)
//   * docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §6.1
//   * scripts/e2e/contracts/v025-coverage.yaml (the coverage manifest — the contract)
//
// Pure module: declarative descriptors only. No I/O, no network, no fixture mutation, and
// never a run status — status lives in the result file (scripts/e2e/lib/v025-result.mjs).
//
// Descriptor shape (identical to hive-v025.mjs / connection-matrix-v025.mjs):
//
//   executionId, sourceRequirementId, sourceSpec, ownerBranch, priority,
//   executors, requires, assert, artifacts, title,
//   steps            — id-specific assertion steps (canonical field)
//   assertionSteps   — the SAME array under the name the other two modules use
//   dimensions       — which evidence layers are computable here vs which need an
//                      environment (each with the blocked reason it would carry)
//   failClosed       — the refusal expectation for the ids whose contract IS a refusal
//   passSemantics / forbiddenPassSemantics
//
// The refusal contracts are executable: `rowPolicyRefusalVerdict()` judges an OBSERVED
// outcome against the descriptor, so a permissive outcome (the refusal did not happen, a
// zero value masqueraded as a result, something was written anyway) is REJECTED.

const GROUP = Object.freeze({
  key: "RTP25",
  file: "docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md",
  ownerBranch: "ACCESS"
});

const RTP_EXECUTORS = Object.freeze(["P", "B", "A", "V"]);
const RTP_REQUIRES = Object.freeze(["lucy-http", "ktx-upstream", "postgres", "browser", "agent-client"]);
const RTP_ASSERT = Object.freeze(["allow_control", "deny", "consistency"]);
const RTP_ARTIFACTS = Object.freeze(["management-case-result.json", "security-case-result.json"]);

const RTV_EXECUTORS = Object.freeze(["P", "B", "V"]);
const RTV_REQUIRES = Object.freeze(["lucy-http", "ktx-upstream", "postgres", "browser"]);
const RTV_ASSERT = Object.freeze(["consistency", "deny"]);
const RTV_ARTIFACTS = Object.freeze(["management-case-result.json"]);

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
  note: "真实 MCP / 运行时确认需要已准备的运行实例"
});
const FAULT_LAYER = Object.freeze({
  name: "fault-injection",
  computableHere: false,
  requiresRealEnvironment: true,
  blockedReason: "environment",
  note: "恢复失败与回滚故障需要受控故障注入环境"
});

/** A layer that P1's existing unit / component / server suites already close here. */
function localLayer(name, note) {
  return { name, computableHere: true, requiresRealEnvironment: false, blockedReason: null, note };
}

/** Builds one RTP descriptor. */
function rtp(sourceRequirementId, title, steps, dimensions, failClosed) {
  return Object.freeze({
    executionId: `${GROUP.key}-${sourceRequirementId.slice("RTP-".length)}`,
    sourceRequirementId,
    sourceSpec: GROUP.file,
    ownerBranch: GROUP.ownerBranch,
    priority: "P1",
    executors: RTP_EXECUTORS,
    requires: RTP_REQUIRES,
    assert: RTP_ASSERT,
    artifacts: RTP_ARTIFACTS,
    title,
    steps: Object.freeze(steps),
    assertionSteps: Object.freeze(steps),
    dimensions: Object.freeze(dimensions),
    failClosed: Object.freeze(failClosed),
    passSemantics: "编译／兼容 contract 与浏览器 dry-run／保存／真实 MCP 三层齐备才算通过；任一层缺失都不是通过",
    forbiddenPassSemantics: Object.freeze([])
  });
}

/** Builds one RTV descriptor. */
function rtv(sourceRequirementId, title, steps, dimensions, failClosed) {
  return Object.freeze({
    executionId: `RTV25-${sourceRequirementId.slice("RTV-".length)}`,
    sourceRequirementId,
    sourceSpec: GROUP.file,
    ownerBranch: GROUP.ownerBranch,
    priority: "P1",
    executors: RTV_EXECUTORS,
    requires: RTV_REQUIRES,
    assert: RTV_ASSERT,
    artifacts: RTV_ARTIFACTS,
    title,
    steps: Object.freeze(steps),
    assertionSteps: Object.freeze(steps),
    dimensions: Object.freeze(dimensions),
    failClosed: Object.freeze(failClosed),
    passSemantics: "同源快照 contract＋浏览器只读视图＋与摘要／关系图对账齐备才算通过；反查是只读的，不产生新写入口",
    forbiddenPassSemantics: Object.freeze([])
  });
}

/** A refusal contract that is not one of the ids' own fail-closed rows. */
function noRefusal() {
  return Object.freeze({
    isRefusal: false,
    expectation: Object.freeze([]),
    tokens: Object.freeze([]),
    reason: "",
    detail: ""
  });
}

/** A refusal contract: the operation must be refused, diagnosably and without side effects. */
function refusal(tokens, reason, detail = "") {
  return Object.freeze({
    isRefusal: true,
    expectation: Object.freeze([...tokens]),
    tokens: Object.freeze([...tokens]),
    reason,
    detail
  });
}

/** RTP25-01..10 — 行策略模板 (row policy templates). */
export const RTP25_CASES = Object.freeze([
  rtp("RTP-01", "`eq`/`in` 模板与等价内联条件", [
    "展开 `eq`／`in` 模板后，编译产物与等价内联条件写法的编译产物逐字一致",
    "两者的语义摘要一致，不因写法不同而分叉",
    "`in` 的值顺序打乱后摘要不变（集合语义，不是列表语义）"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖模板展开与摘要等价"),
    localLayer("server-contract", "P1 服务端测试已覆盖编译产物逐字比较"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  rtp("RTP-02", "模板 + 内联、多 Role、Agent 限制", [
    "同一个选择器内部的多条件按 AND 合成",
    "多个 Role 之间按 OR 合成",
    "Agent 个人限制与 Role 限制按 AND 合成",
    "合成后的 DNF 结构被保留，不被扁平化丢失"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖 AND／OR／AND 的组合语义"),
    localLayer("server-contract", "P1 服务端测试已覆盖 DNF 结构保留"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  rtp("RTP-03", "缺失引用、非法 op、空谓词、度量或字段不存在", [
    "缺失引用、非法 op、空谓词、度量不存在、字段不存在五类输入全部失败关闭",
    "每类失败的拒绝原因与目录状态可区分，不是一个笼统的错误",
    "失败关闭时零写入：模板与引用都不落盘"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖五类非法输入的失败关闭"),
    localLayer("server-contract", "P1 服务端测试已覆盖原因可区分与零写入"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], refusal(["deny"], "五类非法输入全部失败关闭，原因可区分且零写入",
    "缺失引用、非法 op、空谓词、度量或字段不存在必须失败关闭；原因与目录状态可区分；不得落盘")),
  rtp("RTP-04", "删除／改名有引用与无引用模板", [
    "删除有引用的模板被拒绝，且零写入",
    "改名有引用的模板被拒绝，且零写入",
    "无引用的模板可以经 dry-run 后保存",
    "指向外部缺失引用的模板失败关闭，不被静默接受"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖引用面判定"),
    localLayer("server-contract", "P1 服务端测试已覆盖零写入与 dry-run 保存"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], refusal(["deny"], "有引用的模板删除／改名被拒绝且零写入；无引用模板可经 dry-run 保存",
    "有引用的模板不得被删除或改名，且必须零写入；外部缺失引用失败关闭")),
  rtp("RTP-05", "模板或引用变化", [
    "模板或其引用变化后 `policyVersion` 随之变化",
    "运行时确认立即生效，不需要重启进程",
    "受保护工具的闸门在变更前后保持不变"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖 policyVersion 变化"),
    localLayer("server-contract", "P1 服务端测试已覆盖受保护工具闸门不变"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  rtp("RTP-06", "基线／候选摘要变化", [
    "基线或候选摘要变化后，旧的 dry-run 预览不可提交",
    "重新 dry-run 得到新预览后才允许保存",
    "旧预览的提交请求被拒绝而不是被忽略"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖摘要失效判定"),
    localLayer("server-contract", "P1 服务端测试已覆盖旧预览提交被拒"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], refusal(["deny"], "基线／候选摘要变化后旧预览不可提交",
    "旧预览必须不可提交；只有重新 dry-run 之后才允许保存")),
  rtp("RTP-07", "intent、写入、生效、terminal 与回滚故障", [
    "intent、写入、生效、terminal 与回滚的顺序满足 P1-D3",
    "恢复失败时受影响读取被阻断",
    "恢复失败时后续写入被阻断"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖顺序契约"),
    localLayer("server-contract", "P1 服务端测试已覆盖终态与回滚顺序"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER,
    FAULT_LAYER
  ], refusal(["deny"], "恢复失败时受影响读取与后续写入被阻断",
    "回滚失败必须阻断受影响读取与后续写入，而不是留下半生效状态")),
  rtp("RTP-08", "模板下拉与目录异常", [
    "不可绑定的项在模板下拉里可见且处于禁用态",
    "禁用原因在选择当下就已披露",
    "原因不是等到保存时才出现"
  ], [
    localLayer("unit", "P1 组件测试已覆盖不可绑定项的禁用态"),
    localLayer("component", "P1 组件测试已覆盖选择当下即披露原因"),
    BROWSER_LAYER
  ], noRefusal()),
  rtp("RTP-09", "配置审计", [
    "模板的增、删、改与引用／解引用事件都写入审计",
    "事件含 actor、operationId、前后摘要与影响面",
    "事件不含任何秘密（Token、数据库密码、连接串）"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖审计事件字段"),
    localLayer("audit-event", "P1 服务端测试已覆盖审计事件不含秘密"),
    BROWSER_LAYER
  ], noRefusal()),
  rtp("RTP-10", "既有配置兼容", [
    "不含模板的既有配置行为不变",
    "v1 配置、legacy 配置与非法组合仍按现行规则拒绝",
    "兼容路径不因为模板功能的引入而放宽既有拒绝"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖无模板配置行为不变"),
    localLayer("regression", "既有配置兼容由既有回归套件覆盖")
  ], refusal(["deny"], "v1、legacy 与非法组合仍按现行规则拒绝",
    "模板功能不得放宽既有拒绝：v1、legacy 与非法组合仍必须被拒"))
]);

/** RTV25-01..08 — 按表反查 (per-table reverse lookup). */
export const RTV25_CASES = Object.freeze([
  rtv("RTV-01", "单表多 Role、多 Agent", [
    "单表上的角色贡献齐全",
    "有效行授予与逐 Agent 的最终行约束齐全",
    "三者同源：不是三份各自解释权限的副本"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖角色贡献与最终行约束"),
    localLayer("server-contract", "P1 服务端测试已覆盖同源性"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  rtv("RTV-02", "两受限 Role 与一个 `all` Role 反例", [
    "两个受限 Role 的反例不显示全部行",
    "`all` Role 只在真实的 `all` 分支存在时才显示全部行",
    "受限与 `all` 两种形态在界面上可区分"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖受限与 all 的反例"),
    localLayer("server-contract", "P1 服务端测试已覆盖 all 分支的真实性判定"),
    BROWSER_LAYER,
    RUN_INSTANCE_LAYER
  ], noRefusal()),
  rtv("RTV-03", "无授权、不可满足、编译失败、空筛选", [
    "无授权、不可满足、编译失败、空筛选四种状态互相可区分",
    "没有空表冒充无限制",
    "没有新增空集授权值"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖四态判定"),
    localLayer("server-contract", "P1 服务端测试已覆盖空表与空集授权值"),
    BROWSER_LAYER
  ], refusal(["deny"], "四种状态可区分；无空表冒充无限制；无新空集授权值",
    "无授权、不可满足、编译失败与空筛选必须可区分；不得用空表冒充无限制，也不得新增空集授权值")),
  rtv("RTV-04", "筛选、完整身份与深链", [
    "同名但不同连接／Schema 的表不合并",
    "筛选条件可分享（URL 可复现同一视图）",
    "只读深链指向正确的表与连接"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖规范源键去重"),
    localLayer("server-contract", "P1 服务端测试已覆盖深链身份"),
    BROWSER_LAYER
  ], noRefusal()),
  rtv("RTV-05", "部分 Agent／Role 失败", [
    "`partial` 状态明示失败的 Agent／Role 集合",
    "全部失败时状态为 `unavailable`",
    "两种情况都不显示零授权"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖 partial／unavailable 判定"),
    localLayer("server-contract", "P1 服务端测试已覆盖失败集合可见"),
    BROWSER_LAYER
  ], refusal(["deny"], "`partial` 明示失败集合；全部失败为 `unavailable`；不显示零授权",
    "部分失败必须明示失败集合；全部失败必须是 unavailable；任何情况下都不得显示零授权")),
  rtv("RTV-06", "与 L25-01／L25-08 对账", [
    "同一快照下，反查的表集合与授权摘要／关系图的表集合一致",
    "授权路径数与去重表数分别表达，不混用同一个数字"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖计数不混用"),
    localLayer("cross-module-contract", "P1 跨模块契约测试已覆盖同快照表集合一致")
  ], noRefusal()),
  rtv("RTV-07", "只读与可达性", [
    "页面没有任何写 API 入口",
    "键盘可达、表格语义、焦点顺序与翻译防御满足设计规范"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖反查视图无写入口"),
    localLayer("component", "P1 组件测试已覆盖键盘与翻译防御"),
    localLayer("accessibility", "可达性由既有可访问性检查覆盖"),
    BROWSER_LAYER
  ], refusal(["deny"], "反查页面没有写 API 入口",
    "按表反查是只读视图：不得暴露任何写入口")),
  rtv("RTV-08", "快照切换", [
    "同一次响应里不混用不同代的配置、目录或策略",
    "刷新后明确给出更新后的快照身份"
  ], [
    localLayer("unit", "P1 服务端测试已覆盖快照代际隔离"),
    localLayer("server-contract", "P1 服务端测试已覆盖快照身份刷新"),
    BROWSER_LAYER
  ], noRefusal())
]);

/** All row-policy descriptors (RTP + RTV), in execution-id order. */
export const ROW_POLICY_CASES = Object.freeze([...RTP25_CASES, ...RTV25_CASES]);

/**
 * The MODULE-level descriptor array for this file: RTP25-01..10 + RTV25-01..08 (18 ids).
 *
 * The cross-track gate (scripts/e2e/__tests__/v025-cross-track.test.mjs) resolves ONE
 * accessor per module — the first of `RTP25_CASES` / `RTV25_CASES` / `rowPolicyTemplateCases`
 * that exists and yields ids. `RTP25_CASES` and `RTV25_CASES` are the PER-GROUP views
 * (10 and 8 ids); `rowPolicyTemplateCases` is the module's complete set (18 ids) and is
 * the accessor the gate must point at for this module — or the gate must add a second
 * source entry `{ module: "row-policy-templates-v025.mjs", accessors: ["RTV25_CASES"] }`.
 */
export const rowPolicyTemplateCases = ROW_POLICY_CASES;

const BY_ID = new Map(ROW_POLICY_CASES.map((c) => [c.executionId, c]));

/** Returns the descriptor for a row-policy execution id, or `null`. */
export function rowPolicyCaseFor(executionId) {
  return BY_ID.get(executionId) ?? null;
}

/** All row-policy execution ids. */
export function rowPolicyCaseIds() {
  return ROW_POLICY_CASES.map((c) => c.executionId);
}

/**
 * The refusal contracts of this group, keyed by execution id.
 * Each rule judges an OBSERVED outcome; a permissive outcome must be rejected.
 */
const REFUSAL_RULES = Object.freeze({
  "RTP25-03": (o) => {
    if (o.refused !== true) return "the illegal input was not refused";
    if (o.persisted === true) return "the refused input was written anyway";
    const classes = [...new Set(o.reasonClasses ?? [])];
    if (classes.length < 5) return `only ${classes.length} distinguishable failure class(es), expected 5`;
    if (!String(o.reason ?? "").trim()) return "no diagnosable reason was reported";
    return null;
  },
  "RTP25-04": (o) => {
    if (o.referencedRefused !== true) return "a referenced template was deleted or renamed instead of refused";
    if (o.persisted === true) return "the refused delete／rename wrote anyway";
    if (o.unreferencedSaved !== true) return "an unreferenced template could not be saved through dry-run";
    return null;
  },
  "RTP25-06": (o) => {
    if (o.stalePreviewSubmittable === true) return "a stale preview was still submittable";
    if (o.resavedAfterDryRun !== true) return "saving was not re-enabled by a fresh dry-run";
    return null;
  },
  "RTP25-07": (o) => {
    if (o.readBlockedOnRecoveryFailure !== true) return "reads were not blocked after a failed recovery";
    if (o.writeBlockedOnRecoveryFailure !== true) return "later writes were not blocked after a failed recovery";
    return null;
  },
  "RTP25-10": (o) => {
    if (o.v1Rejected !== true || o.legacyRejected !== true || o.illegalCombinationRejected !== true) {
      return "an existing configuration that must be rejected was accepted";
    }
    if (o.legacyBehaviourChanged === true) return "a configuration without templates changed behaviour";
    return null;
  },
  "RTV25-03": (o) => {
    const states = [...new Set(o.states ?? [])];
    if (states.length < 4) return `only ${states.length} distinguishable state(s), expected 4`;
    if (o.emptyTableAsUnrestricted === true) return "an empty table was presented as an unrestricted grant";
    if (o.emptyGrantValueCreated === true) return "a new empty grant value was created";
    return null;
  },
  "RTV25-05": (o) => {
    const state = String(o.state ?? "");
    if (state !== "partial" && state !== "unavailable") return `the state is "${state}", expected partial or unavailable`;
    if (o.failedSetVisible !== true) return "the failed Agent／Role set is not visible";
    if (o.showedZeroAuthorization === true) return "zero authorization was displayed instead of a failure";
    return null;
  },
  "RTV25-07": (o) => {
    if ((o.writeApis ?? -1) !== 0) return `the view exposes ${o.writeApis} write API(s)`;
    return null;
  }
});

/**
 * Judges an OBSERVED outcome against a row-policy refusal contract.
 *
 * Returns `{ ok: true }` when the refusal contract holds, `{ ok: false, reason }` when a
 * permissive outcome slipped through. A non-refusal id has nothing to refuse.
 */
export function rowPolicyRefusalVerdict(executionId, observation = {}) {
  const rule = REFUSAL_RULES[executionId];
  if (!rule) return { ok: true, reason: "not a refusal contract; nothing to refuse" };
  const problem = rule(observation);
  return problem ? { ok: false, reason: problem } : { ok: true, reason: "the refusal contract holds" };
}

/** The refusal-contract execution ids of this group. */
export function rowPolicyRefusalIds() {
  return Object.keys(REFUSAL_RULES).sort();
}
