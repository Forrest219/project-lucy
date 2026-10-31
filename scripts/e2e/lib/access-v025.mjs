// ROW25 execution descriptors — the access / row-permission responsibility branch.
//
// Authority chain (nothing here invents a requirement):
//   * requirement text  -> docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §9 (V01–V22)
//   * ownership + execution groups -> docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §5.3
//   * approved contract (executors / capabilities / assertion tokens / artifacts)
//       -> scripts/e2e/contracts/v025-coverage.yaml (newScenarios, ownerBranch ACCESS)
//   * run status semantics -> scripts/e2e/lib/v025-result.mjs (statusFromDimensions)
//   * the permission algebra itself -> webui/server/proxy/row-policy.ts and
//     webui/server/proxy/row-policy-preview.ts (asserted, never re-implemented here)
//
// This module is the P0 branch's declarative contract only: no I/O, no fixture
// mutation, no status. V19 / V22 are D-03 integration regressions. The product
// ledger may record D-03 fixed from the two repository tests; this module does
// not read `fixedIn`. expectedStatus stays `not_run`, and the
// customer-maintenance-line dimension stays blocked. A fixed D-03 does not
// record an E2E pass and does not claim the customer Linux uppercase-schema
// scenario.
//
// The per-id `steps` are written against that id's OWN acceptance row in source
// Spec §9. scripts/e2e/__tests__/v025-access.test.mjs fails on copy-paste steps.

import { loadCoverage } from "./v025-coverage.mjs";

export const ROW25_SOURCE_SPEC = "docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md";
export const ROW25_OWNER_BRANCH = "ACCESS";
export const ROW25_GROUP_KEY = "ROW25";
export const ROW25_PRIORITY = "P0";

/**
 * Template requirements. They stay out of C19. The coverage manifest records
 * the same priority so the descriptor and the manifest cannot drift.
 */
export const ROW25_P1_IDS = Object.freeze([
  "ROW25-V01", "ROW25-V02", "ROW25-V03", "ROW25-V04", "ROW25-V05", "ROW25-V06",
  "ROW25-V07", "ROW25-V14", "ROW25-V17"
]);

/**
 * P0 ids that the product-entry regression covers. V15's fault-control
 * requirement stays on this E2E catalog and does not hold L25-14 open.
 * V19 / V22 are not in this set.
 */
export const ROW25_C19_IDS = Object.freeze([
  "ROW25-V08", "ROW25-V09", "ROW25-V10", "ROW25-V11", "ROW25-V12", "ROW25-V13",
  "ROW25-V15", "ROW25-V16", "ROW25-V18", "ROW25-V20", "ROW25-V21"
]);

/** The 22 approved execution ids, in source-Spec order. */
export const ROW25_EXECUTION_IDS = Object.freeze([
  "ROW25-V01", "ROW25-V02", "ROW25-V03", "ROW25-V04", "ROW25-V05", "ROW25-V06",
  "ROW25-V07", "ROW25-V08", "ROW25-V09", "ROW25-V10", "ROW25-V11", "ROW25-V12",
  "ROW25-V13", "ROW25-V14", "ROW25-V15", "ROW25-V16", "ROW25-V17", "ROW25-V18",
  "ROW25-V19", "ROW25-V20", "ROW25-V21", "ROW25-V22"
]);

/** The approved execution groups (Plan §5.3). */
export const ROW25_EXECUTION_GROUPS = Object.freeze({
  "template-linked-compatibility": ["ROW25-V01", "ROW25-V02", "ROW25-V03", "ROW25-V04", "ROW25-V05", "ROW25-V06", "ROW25-V07", "ROW25-V14", "ROW25-V16", "ROW25-V17"],
  "same-source-preview": ["ROW25-V08", "ROW25-V09", "ROW25-V10", "ROW25-V11", "ROW25-V12", "ROW25-V13"],
  "audit-and-fail-closed": ["ROW25-V15", "ROW25-V18", "ROW25-V20", "ROW25-V21"],
  "maintenance-line-regression": ["ROW25-V19", "ROW25-V22"]
});

/** Executor letter -> evidence dimension (case-catalog.yaml §executors). */
export const EXECUTOR_DIMENSIONS = Object.freeze({
  B: "browser",
  P: "protocol",
  D: "database",
  A: "agent",
  O: "fault",
  V: "verifier"
});

/** The shared contract of the 21 non-exception ROW25 ids. V15 adds the fault dimension. */
const ROW_BASE = Object.freeze({
  executors: ["P", "B", "A", "V"],
  requires: ["lucy-http", "ktx-upstream", "mysql", "browser", "agent-client"],
  assert: ["allow_control", "deny", "no_side_effect", "consistency"],
  artifacts: ["management-case-result.json", "security-case-result.json"]
});

/**
 * Per-id scenario data. `refusal` is present exactly when the id's contract is
 * fail-closed: it names the refusal the runtime must produce, so a permissive
 * result is provably wrong (the contract test asserts this).
 */
const SCENARIOS = Object.freeze({
  "ROW25-V01": {
    group: "template-linked-compatibility",
    title: "模板引用一条含 eq 的策略",
    expectation: "编译成功；RowGrant.kind=scoped；digest 与直接写同条件时一致。",
    steps: [
      "在 access.yaml 顶层 row_policy_templates 声明一条含 eq 的模板策略，并让角色引用它。",
      "断言编译成功，展开后的 RowGrant.kind 为 scoped（不是 all，也不是无效）。",
      "把同一条件以内联方式直接写入该角色，断言两种写法产生相同 digest。",
      "断言模板取值为静态字面量，展开结果不引入度量、宏或请求期表达式。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-templates.test.ts"]
  },
  "ROW25-V02": {
    group: "template-linked-compatibility",
    title: "模板引用一条含 in 的策略",
    expectation: "编译成功；RowGrant.kind=scoped；values 顺序不影响 digest。",
    steps: [
      "声明一条含 in 的模板策略并让角色引用它，断言编译成功且 RowGrant.kind=scoped。",
      "把 values 顺序打乱后重新编译，断言 digest 与有序版本完全一致。",
      "断言展开后的谓词保留全部取值，不因顺序变化丢失或重复。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-templates.test.ts"]
  },
  "ROW25-V03": {
    group: "template-linked-compatibility",
    title: "模板 + 内联条件并存",
    expectation: "同一 Role 分支内 AND；展开后 predicates 含两组条件。",
    steps: [
      "让同一角色同时引用模板条件与内联条件，断言两者落在同一个 Role 分支内做 AND 组合。",
      "断言展开后的 predicates 同时含模板组与内联组两组条件，而不是只保留其中一组。",
      "断言组合结果不把两组条件拆成两个 OR 分支（同一 Role 只有一个分支）。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-templates.test.ts"]
  },
  "ROW25-V04": {
    group: "template-linked-compatibility",
    title: "引用不存在的模板",
    expectation: "编译失败，原因码 row_policy_template_unresolved；该表取数拒绝。",
    refusal: { reasonCode: "row_policy_template_unresolved", effect: "该表取数被拒绝，不返回任何行" },
    steps: [
      "让角色引用一个不存在的模板名，断言编译失败并返回原因码 row_policy_template_unresolved。",
      "断言失败关闭：该表取数被拒绝，而不是退化为「全部行」或空约束。",
      "断言失败不留下半成品配置（角色与模板状态不变）。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-templates.test.ts"]
  },
  "ROW25-V05": {
    group: "template-linked-compatibility",
    title: "模板字段在可靠目录的目标表不存在",
    expectation: "row_policy_field_unknown；失败关闭。",
    refusal: { reasonCode: "row_policy_field_unknown", effect: "该表取数被拒绝" },
    steps: [
      "在目录可靠装载的前提下，让模板引用一个目标表上并不存在的字段。",
      "断言归因为 row_policy_field_unknown，而不是清单不可用或目录能力未知。",
      "断言失败关闭：该表取数被拒绝，诊断带连接 / Schema / 表 / 字段四元组。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-catalog-attribution.test.ts"]
  },
  "ROW25-V06": {
    group: "template-linked-compatibility",
    title: "模板引用度量",
    expectation: "row_policy_field_unresolved:measure；失败关闭。",
    refusal: { reasonCode: "row_policy_field_unresolved:measure", effect: "该表取数被拒绝" },
    steps: [
      "让模板引用一个度量（measure）作为行级条件字段。",
      "断言归因为 row_policy_field_unresolved:measure，与普通字段缺失（row_policy_field_unknown）可区分。",
      "断言失败关闭：该表取数被拒绝，不把度量当列名猜测绑定。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-types.test.ts"]
  },
  "ROW25-V07": {
    group: "template-linked-compatibility",
    title: "模板谓词 op 非法",
    expectation: "row_policy_op_forbidden；失败关闭。",
    refusal: { reasonCode: "row_policy_op_forbidden", effect: "该表取数被拒绝" },
    steps: [
      "让模板谓词使用一个不在允许集合内的 op。",
      "断言归因为 row_policy_op_forbidden，而不是笼统的 invalid。",
      "断言失败关闭：该表取数被拒绝，且模板不被静默删除或改写。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-types.test.ts"]
  },
  "ROW25-V08": {
    group: "same-source-preview",
    title: "同一表被两个受限 Role 以不同谓词授权",
    expectation: "预览显示 OR-of-AND 两个分支，不得显示全部行，不拍平成一条 AND。",
    steps: [
      "让两个受限角色对同一张表用不同谓词授权，断言预览结果是两个分支的并集。",
      "断言预览形状保持 OR-of-AND（displayShape=OR-of-AND），不塌成一条 AND 条件。",
      "断言预览不显示「全部行」，也不显示为空约束；两个分支都可在预览里读到。",
      "断言预览使用的并集算法是 webui/server/proxy/row-policy-preview.ts 的既有实现，而不是另起一套。"
    ],
    localCoverage: [
      "webui/server/__tests__/row-policy-preview.test.ts",
      "webui/src/__tests__/row-policy-dnf-preview.test.tsx"
    ]
  },
  "ROW25-V09": {
    group: "same-source-preview",
    title: "两个角色中其一为「全部行」",
    expectation: "并集结果为全部行；预览显示「行权限：全部行」，不得显示为受限。",
    steps: [
      "让同一张表被一个受限角色与一个「全部行」角色授权，断言并集结果为全部行。",
      "断言预览显示「行权限：全部行」，不得显示成受限或显示为受限分支的形状。",
      "断言受限角色的谓词仍在其自身分支内可核对，不因并集为全部行而被丢弃记录。"
    ],
    localCoverage: [
      "webui/server/__tests__/row-policy-preview.test.ts",
      "webui/src/__tests__/row-grant-preview.test.ts"
    ]
  },
  "ROW25-V10": {
    group: "same-source-preview",
    title: "Agent 带个人行限制",
    expectation: "最终行约束 = 并集 ∧ 个人行限制；预览同时给出并集与交集两个结果。",
    steps: [
      "给一个 Agent 加上个人行限制，并让其所属角色对目标表有受限授权。",
      "断言最终行约束等于「角色并集」与「个人行限制」的交集，不是并集本身。",
      "断言预览同时给出并集结果与按 Agent 的交集结果两个字段。",
      "断言运行时注入的 forced_filters 与预览的交集结果一致。"
    ],
    localCoverage: ["webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts"]
  },
  "ROW25-V11": {
    group: "same-source-preview",
    title: "并集 ∧ 个人行限制后 DNF 剪枝为空",
    expectation: "编译失败关闭；预览显示不可满足，不显示空约束。",
    // The source Spec §9 names no reason code for V11; the refusal is stated as a
    // behaviour, so no code is invented here.
    refusal: { reasonCode: null, description: "编译失败关闭，预览显示不可满足", effect: "该表取数被拒绝" },
    steps: [
      "构造角色并集与 Agent 个人行限制交集为空的情形（每个 OR 分支都与个人限制冲突）。",
      "断言编译失败关闭（对应 webui/server/proxy/row-policy.ts 的 isScopeIntersectionEmpty 判定）。",
      "断言预览显示不可满足，而不是显示一个空的行约束或「全部行」。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-preview.test.ts"]
  },
  "ROW25-V12": {
    group: "same-source-preview",
    title: "预览与运行时一致性",
    expectation: "同一候选 digest 下，预览与运行时 forced_filters 等价；draft 未落盘前即可得到该结果。",
    steps: [
      "对同一份候选配置（同一 candidateDigest）分别取预览结果与运行时结果。",
      "断言两者等价：预览给出的行约束与运行时注入的 forced_filters 指向同一集合。",
      "断言在 draft 尚未落盘时就能得到该预览结果（预览走内存候选，不依赖已保存配置）。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-preview.test.ts"]
  },
  "ROW25-V13": {
    group: "same-source-preview",
    title: "保存前预览与基线变化",
    expectation: "使用 draft 覆盖后的内存候选；预览失败零落盘、零 intent；基线或 digest 变化要求重预览。",
    refusal: { reasonCode: null, description: "预览失败时零落盘、零 intent", effect: "配置与审计记录都不改变" },
    steps: [
      "构造一次会失败的预览（如字段无法绑定），断言零落盘、零 intent（配置版本与审计都不变）。",
      "在草稿覆盖后重新预览，断言预览使用的是覆盖后的内存候选而不是已保存的旧配置。",
      "在预览之后改动基线（角色或模板），断言旧预览的 digest 失效并要求重新预览。",
      "断言基线或 digest 变化后直接提交会被拒绝，不沿用旧预览结论。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-preview.test.ts"]
  },
  "ROW25-V14": {
    group: "template-linked-compatibility",
    title: "模板删除与外部异常引用",
    expectation: "正常写入路径下被引用模板删除被拒绝，未引用时可删；仅外部写入造成缺失引用时显示「引用缺失」并失败关闭。",
    refusal: { reasonCode: "row_policy_template_unresolved", effect: "缺失引用时该表取数被拒绝" },
    steps: [
      "在正常写入路径下删除一个仍被角色引用的模板，断言删除被拒绝并说明仍被引用。",
      "删除一个未被引用的模板，断言删除成功。",
      "用外部写入制造一个缺失引用（绕过正常写入路径），断言界面显示「引用缺失」。",
      "断言该缺失引用场景失败关闭：受影响表的取数被拒绝，而不是按「全部行」放行。"
    ],
    localCoverage: ["webui/server/__tests__/p1-row-policy-templates.test.ts"]
  },
  "ROW25-V15": {
    group: "audit-and-fail-closed",
    title: "intent、生效与终结审计故障",
    expectation: "intent 失败零配置写；terminal 失败回滚并重新换入旧策略；无法恢复时受影响读取及后续写入失败关闭；记录 actor 与前后摘要。",
    refusal: { reasonCode: null, description: "审计故障时回滚；无法恢复时受影响读取与后续写入失败关闭", effect: "恢复失败时受影响读取与后续写入失败关闭" },
    steps: [
      "在写 intent 时注入故障，断言零配置写（角色配置内容与版本都不变）。",
      "在写终结审计记录时注入故障，断言回滚并把旧策略重新换入运行时。",
      "构造无法恢复的情形，断言受影响读取与后续写入都失败关闭，不继续用旧值冒充成功。",
      "断言审计记录含 actor 与前后摘要（变更前后的策略摘要），且失败尝试本身被记录。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-audit.test.ts"]
  },
  "ROW25-V16": {
    group: "template-linked-compatibility",
    title: "策略摘要与版本",
    expectation: "角色／模板变更后 policyVersion 变化；运行时换入生效，无需重启。",
    steps: [
      "记录变更前的 policyVersion，修改角色或模板，断言 policyVersion 发生变化。",
      "断言未发生变更时 policyVersion 不变（版本号不随无意义操作漂移）。",
      "断言新策略在运行时换入后即生效，不需要重启进程。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-ac-p1.test.ts"]
  },
  "ROW25-V17": {
    group: "template-linked-compatibility",
    title: "受保护源工具闸门",
    expectation: "引用形态下 lucy_read_source 等未包装通道仍按 row_policy_requires_wrapped_tool 拒绝。",
    refusal: { reasonCode: "row_policy_requires_wrapped_tool", effect: "未包装通道被拒绝" },
    steps: [
      "让受保护源上的行级条件改用模板引用形态（而不是内联形态）。",
      "断言经 lucy_read_source 等未包装通道取数仍被拒绝，原因码 row_policy_requires_wrapped_tool。",
      "断言改用模板不构成绕过：闸门判定与内联形态一致。"
    ],
    localCoverage: ["webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts"]
  },
  "ROW25-V18": {
    group: "audit-and-fail-closed",
    title: "上游强制谓词未证明",
    expectation: "取数仍按 row_policy_upstream_unproven 拒绝；不得因预览或模板而放宽。",
    refusal: { reasonCode: "row_policy_upstream_unproven", effect: "取数被拒绝" },
    steps: [
      "在强制谓词未被上游证明成立的状态下发起取数。",
      "断言取数被拒绝，原因码 row_policy_upstream_unproven。",
      "断言预览成功不改变该判定：预览或模板引用都不得放宽上游未证明的拒绝。"
    ],
    localCoverage: ["webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts"]
  },
  "ROW25-V19": {
    group: "maintenance-line-regression",
    title: "D-03 集成回归：清单文件名为大写（如 BIDM.yaml）",
    expectation: "在大小写敏感文件系统上合法字段可绑定，不再误报 unknown。本描述符保持 not_run，产品台账关闭不把本项记为 passed。",
    conditional: true,
    conditionalOn: "D-03",
    steps: [
      "在大小写敏感文件系统上准备一个 Schema Manifest 文件名为大写（如 BIDM.yaml）的连接。",
      "对目标表绑定一个确实存在的列，断言不再被误判为 row_policy_field_unknown。",
      "断言本项证据登记为 D-03 集成回归，与 v0.25 新功能证据分开存放。",
      "本项 expectedStatus 保持 not_run。D-03 产品台账关闭不把本项 E2E 记为 passed，也不宣称客户 Linux 大写 schema 场景已交付。"
    ],
    localCoverage: [
      "webui/server/__tests__/row-policy-d03-uppercase.test.ts",
      "webui/server/__tests__/row-policy-d03-realfs.test.ts"
    ]
  },
  "ROW25-V20": {
    group: "audit-and-fail-closed",
    title: "清单不可读、缺失、解析失败或目录能力未知",
    expectation: "全部失败关闭；分别归因清单不可用或目录能力未知，并带连接 / Schema / 表 / 字段四元组。",
    refusal: { reasonCode: "row_policy_catalog_unavailable", effect: "受影响表的取数被拒绝" },
    steps: [
      "分别制造清单不可读、清单缺失、清单解析失败三种情形，断言全部失败关闭。",
      "断言不可读 / 缺失 / 解析失败归因为清单不可用（row_policy_catalog_unavailable），不与字段缺失混淆。",
      "断言目录能力未知归因为目录能力未知（row_policy_catalog_capability_unknown），与清单不可用可区分。",
      "断言每条诊断都带连接 / Schema / 表 / 字段四元组。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-catalog-attribution.test.ts"]
  },
  "ROW25-V21": {
    group: "audit-and-fail-closed",
    title: "字段确实不存在",
    expectation: "仅在目录可靠装载时归因「字段不存在」，与 V20 可区分，且四元组完整。",
    refusal: { reasonCode: "row_policy_field_unknown", effect: "受影响表的取数被拒绝" },
    steps: [
      "在目录可靠装载（catalogLoaded 为真）的前提下绑定一个确实不存在的字段。",
      "断言归因为字段不存在（row_policy_field_unknown），而不是清单不可用或目录能力未知。",
      "断言与 V20 的三种归因可区分：同一次运行里两类的诊断互不串味。",
      "断言诊断带完整的连接 / Schema / 表 / 字段四元组。"
    ],
    localCoverage: ["webui/server/__tests__/row-policy-catalog-attribution.test.ts"]
  },
  "ROW25-V22": {
    group: "maintenance-line-regression",
    title: "D-03 集成回归：同一 Role 在大写 schema 表上的行级条件",
    expectation: "管理台预览与运行时注入的 forced_filters 等价。本描述符保持 not_run，产品台账关闭不把本项记为 passed。",
    conditional: true,
    conditionalOn: "D-03",
    steps: [
      "在大小写敏感文件系统上准备大写 schema 的表，并给同一 Role 设置行级条件。",
      "断言管理台预览给出的行约束与运行时注入的 forced_filters 等价。",
      "断言本项证据登记为 D-03 集成回归，与 v0.25 新功能证据分开存放。",
      "本项 expectedStatus 保持 not_run。预览与运行时等价的仓库测试不把本项 E2E 记为 passed，也不宣称客户场景已交付。"
    ],
    localCoverage: [
      "webui/server/__tests__/row-policy-d03-uppercase.test.ts",
      "webui/server/__tests__/row-policy-d03-realfs.test.ts"
    ]
  }
});

/** Contract override for the one ROW25 id whose approved contract differs. */
const CONTRACT_OVERRIDES = Object.freeze({
  "ROW25-V15": {
    requires: ["lucy-http", "ktx-upstream", "mysql", "browser", "agent-client", "fault-control"]
  }
});

/**
 * Fail-closed ids whose refusal must ALSO leave the world untouched — the
 * source Spec states "零落盘、零 intent" for V13 and read-time denial for the
 * rest, so a refusal that still writes is a contract violation.
 */
const NO_SIDE_EFFECT_FAIL_CLOSED = Object.freeze(new Set([
  "ROW25-V04", "ROW25-V05", "ROW25-V06", "ROW25-V07", "ROW25-V11",
  "ROW25-V13", "ROW25-V17", "ROW25-V18", "ROW25-V20", "ROW25-V21"
]));

const ENVIRONMENT_BLOCK = Object.freeze({
  browser: { blockedReason: "environment", proves: "管理台真实页面上的预览、错误定位与拒绝反馈" },
  protocol: { blockedReason: "environment", proves: "真实 API / MCP 请求的允许与拒绝语义、原因码与零副作用" },
  database: { blockedReason: "environment", proves: "真实数据库上的行集合与 forced_filters 注入结果" },
  agent: { blockedReason: "environment", proves: "真实 Agent 客户端经 MCP 取数时的最终行约束" },
  fault: { blockedReason: "environment", proves: "intent / terminal 审计故障注入下的回滚与失败关闭" },
  verifier: { blockedReason: "environment", proves: "配置审计、策略版本与跨端一致性核对" }
});

function contractFor(executionId) {
  const base = ROW_BASE;
  const override = CONTRACT_OVERRIDES[executionId] ?? {};
  return {
    executors: [...(override.executors ?? base.executors)],
    requires: [...(override.requires ?? base.requires)],
    assert: [...(override.assert ?? base.assert)],
    artifacts: [...(override.artifacts ?? base.artifacts)]
  };
}

/** The manifest row for one execution id (the approved contract, single source). */
function manifestEntry(executionId) {
  const entry = loadCoverage().newScenarios.find((s) => s.executionId === executionId);
  if (!entry) throw new Error(`access-v025: ${executionId} is not in the coverage manifest`);
  return entry;
}

/** The evidence-dimension table for one id. */
function evidenceFor(executionId, executors) {
  const dimensions = [
    {
      dimension: "unit",
      state: "available",
      blockedReason: null,
      proves: "该执行项在覆盖清单中的合同（编号、断言词汇、id 专属步骤、失败关闭语义）一致且可执行",
      doesNotProve: "不证明该场景在真实运行中的行为"
    }
  ];
  const seen = new Set();
  for (const executor of executors) {
    const dimension = EXECUTOR_DIMENSIONS[executor];
    if (!dimension || seen.has(dimension)) continue;
    seen.add(dimension);
    const block = ENVIRONMENT_BLOCK[dimension];
    dimensions.push({
      dimension,
      executor,
      state: "blocked",
      blockedReason: block.blockedReason,
      proves: block.proves,
      doesNotProve: "本机无已准备的运行实例，不能以本机结果替代"
    });
  }
  if (executionId === "ROW25-V19" || executionId === "ROW25-V22") {
    dimensions.push({
      dimension: "customer-maintenance-line",
      executor: "V",
      state: "blocked",
      blockedReason: "environment",
      proves: "大小写敏感文件系统上的 D-03 集成回归。本维度保持 blocked，直到真实 E2E 跑过",
      doesNotProve: "D-03 产品台账关闭和仓库测试都不把本项记为 passed，也不构成客户 Linux 大写 schema 场景交付"
    });
  }
  // V15 carries the fault-control capability; the manifest's executor set for
  // this branch does not include the O letter, so the fault dimension is
  // declared from the capability, not from an invented executor.
  if (executionId === "ROW25-V15" && !seen.has("fault")) {
    seen.add("fault");
    dimensions.push({
      dimension: "fault",
      executor: null,
      state: "blocked",
      blockedReason: "environment",
      proves: "intent / terminal 审计故障注入下的回滚与失败关闭",
      doesNotProve: "本机无已准备的运行实例，不能以本机结果替代"
    });
  }
  return dimensions;
}

/** One fully-formed descriptor. */
function buildCase(executionId) {
  const scenario = SCENARIOS[executionId];
  if (!scenario) throw new Error(`access-v025: no scenario for ${executionId}`);
  const contract = contractFor(executionId);
  return Object.freeze({
    executionId,
    sourceRequirementId: `V${executionId.slice(-2)}`,
    sourceSpec: ROW25_SOURCE_SPEC,
    ownerBranch: ROW25_OWNER_BRANCH,
    priority: ROW25_P1_IDS.includes(executionId) ? "P1" : ROW25_PRIORITY,
    executionGroup: scenario.group,
    title: scenario.title,
    expectation: scenario.expectation,
    steps: Object.freeze([...scenario.steps]),
    // fail-closed means: the contract REQUIRES a refusal. A permissive result
    // is a contract violation, not a weaker pass.
    failClosed: Object.hasOwn(scenario, "refusal"),
    refusal: scenario.refusal
      ? Object.freeze({
        ...scenario.refusal,
        requiresNoSideEffect: NO_SIDE_EFFECT_FAIL_CLOSED.has(executionId)
      })
      : null,
    conditional: scenario.conditional === true,
    conditionalOn: scenario.conditionalOn ?? null,
    requiredExecutors: Object.freeze(contract.executors),
    requiredCapabilities: Object.freeze(contract.requires),
    assertionTokens: Object.freeze(contract.assert),
    artifacts: Object.freeze(contract.artifacts),
    evidenceDimensions: Object.freeze(evidenceFor(executionId, contract.executors)),
    localCoverage: Object.freeze([...(scenario.localCoverage ?? [])]),
    // No execution item may be recorded as passed without real run evidence
    // (implementation plan §3.2.3); the status lives in the result file.
    expectedStatus: "not_run"
  });
}

let cached = null;

/** All 22 ROW25 descriptors, in source-Spec order. */
export function accessCases() {
  if (!cached) cached = Object.freeze(ROW25_EXECUTION_IDS.map((id) => buildCase(id)));
  return cached;
}

/** One ROW25 descriptor. */
export function accessCase(executionId) {
  const found = accessCases().find((c) => c.executionId === executionId);
  if (!found) throw new Error(`access-v025: unknown execution id ${executionId}`);
  return found;
}

/** Counts for reports; never implies a run status. */
export function accessSummary() {
  const cases = accessCases();
  return {
    total: cases.length,
    byGroup: Object.fromEntries(
      Object.entries(ROW25_EXECUTION_GROUPS).map(([group, ids]) => [group, ids.length])
    ),
    failClosed: cases.filter((c) => c.failClosed).length,
    conditional: cases.filter((c) => c.conditional).length,
    expectedNotRun: cases.filter((c) => c.expectedStatus === "not_run").length
  };
}

/** Cross-checks the descriptors against the approved coverage manifest. */
export function accessContractProblems() {
  const problems = [];
  for (const c of accessCases()) {
    const m = manifestEntry(c.executionId);
    if (m.priority !== c.priority) problems.push(`${c.executionId} priority ${c.priority} != manifest ${m.priority}`);
    if (m.ownerBranch !== c.ownerBranch) problems.push(`${c.executionId} owner ${c.ownerBranch} != manifest ${m.ownerBranch}`);
    if (m.sourceRequirementId !== c.sourceRequirementId) {
      problems.push(`${c.executionId} sourceRequirementId ${c.sourceRequirementId} != manifest ${m.sourceRequirementId}`);
    }
    if (m.sourceSpec !== c.sourceSpec) problems.push(`${c.executionId} sourceSpec differs from the manifest`);
    if (JSON.stringify(m.executors) !== JSON.stringify(c.requiredExecutors)) {
      problems.push(`${c.executionId} executors ${JSON.stringify(c.requiredExecutors)} != manifest ${JSON.stringify(m.executors)}`);
    }
    if (JSON.stringify(m.requires) !== JSON.stringify(c.requiredCapabilities)) {
      problems.push(`${c.executionId} requires differ from the manifest`);
    }
    if (JSON.stringify(m.assert) !== JSON.stringify(c.assertionTokens)) {
      problems.push(`${c.executionId} assert tokens differ from the manifest`);
    }
    if (JSON.stringify(m.artifacts) !== JSON.stringify(c.artifacts)) {
      problems.push(`${c.executionId} artifacts differ from the manifest`);
    }
  }
  return problems;
}

/**
 * Judges ONE observed outcome against a descriptor's refusal expectation.
 *
 * `observation` is what a run actually saw:
 *   { refused: boolean, sideEffectFree?: boolean, detail?: string }
 *
 * A fail-closed item REQUIRES a refusal; a permissive outcome is a contract
 * violation, not a weaker pass. This is the executable form of "失败即停"
 * (implementation plan §3.2) and it is what the negative test exercises.
 */
export function judgeRefusal(descriptor, observation) {
  const refused = observation?.refused === true;
  if (descriptor.failClosed) {
    if (!refused) {
      return {
        ok: false,
        verdict: "permissive-rejected",
        detail: `${descriptor.executionId} 的合同要求拒绝，宽松结果被拒绝`
      };
    }
    if (descriptor.refusal?.requiresNoSideEffect && observation?.sideEffectFree !== true) {
      return {
        ok: false,
        verdict: "side-effect-rejected",
        detail: `${descriptor.executionId} 的合同要求拒绝且零副作用，观察到副作用`
      };
    }
    return { ok: true, verdict: "refused", detail: observation?.detail ?? "" };
  }
  if (refused) {
    return {
      ok: false,
      verdict: "unexpected-refusal",
      detail: `${descriptor.executionId} 的合同不要求拒绝，观察到意外拒绝`
    };
  }
  return { ok: true, verdict: "accepted", detail: observation?.detail ?? "" };
}
