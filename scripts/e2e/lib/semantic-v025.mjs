// SEM25 execution descriptors — the semantic-asset / batch-maintenance responsibility branch.
//
// Authority chain (nothing here invents a requirement):
//   * requirement text  -> docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §10 (V01–V22)
//   * ownership + execution groups -> docs/plans/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-plan.md §5.2
//   * approved contract (executors / capabilities / assertion tokens / artifacts)
//       -> scripts/e2e/contracts/v025-coverage.yaml (newScenarios, ownerBranch SEM)
//   * run status semantics -> scripts/e2e/lib/v025-result.mjs (statusFromDimensions)
//
// This module is the P0 branch's declarative contract only. It contains NO I/O, NO
// fixture mutation and NO status: an execution item's status lives in the result
// file, never here (Spec §8.2). Nothing in this module may be read as "passed".
//
// The per-id `steps` are written against that id's OWN acceptance row in the
// source Spec §10 — a descriptor that says "same as V01" for 22 ids is a defect,
// and scripts/e2e/__tests__/v025-semantic.test.mjs fails on copy-paste steps.
//
// The contract fields (executors / capabilities / assertion tokens / artifacts)
// are declared here explicitly and re-checked against the coverage manifest by
// the contract test, so a change on either side of that pair is caught loudly
// instead of silently drifting.

import { loadCoverage } from "./v025-coverage.mjs";

export const SEM25_SOURCE_SPEC = "docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md";
export const SEM25_OWNER_BRANCH = "SEM";
export const SEM25_GROUP_KEY = "SEM25";
export const SEM25_PRIORITY = "P0";

/** The 22 approved execution ids, in source-Spec order. */
export const SEM25_EXECUTION_IDS = Object.freeze([
  "SEM25-V01", "SEM25-V02", "SEM25-V03", "SEM25-V04", "SEM25-V05", "SEM25-V06",
  "SEM25-V07", "SEM25-V08", "SEM25-V09", "SEM25-V10", "SEM25-V11", "SEM25-V12",
  "SEM25-V13", "SEM25-V14", "SEM25-V15", "SEM25-V16", "SEM25-V17", "SEM25-V18",
  "SEM25-V19", "SEM25-V20", "SEM25-V21", "SEM25-V22"
]);

/** The approved execution groups (Plan §5.2). */
export const SEM25_EXECUTION_GROUPS = Object.freeze({
  "identity-and-selection": ["SEM25-V01", "SEM25-V02", "SEM25-V03", "SEM25-V04"],
  "package-and-capacity": ["SEM25-V05", "SEM25-V06", "SEM25-V07", "SEM25-V08", "SEM25-V09", "SEM25-V10", "SEM25-V11"],
  "concurrency-and-recovery": ["SEM25-V12", "SEM25-V13", "SEM25-V14", "SEM25-V15", "SEM25-V16"],
  "permissions-and-deployment": ["SEM25-V17", "SEM25-V18", "SEM25-V19", "SEM25-V20", "SEM25-V21", "SEM25-V22"]
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

/**
 * The shared contract of the 20 non-exception SEM25 ids, copied from the
 * approved coverage manifest (v025-coverage.yaml, newScenarios, ownerBranch SEM).
 * V03 adds the real-Agent dimension and V22 adds the customer amd64 dimension.
 */
const SEM_BASE = Object.freeze({
  executors: ["B", "P", "D", "O", "V"],
  requires: ["lucy-http", "ktx-upstream", "postgres", "browser", "fault-control"],
  assert: ["allow_control", "no_side_effect", "exactly_one_wins", "consistency"],
  artifacts: ["management-case-result.json", "leak-scan.json"]
});

/**
 * Per-id scenario data. `title` / `expectation` restate that id's own row in
 * source Spec §10; `steps` are the concrete assertion steps for THAT row.
 * `localCoverage` names the repository test layers that already prove a part of
 * the id's contract — it never stands in for the id's own evidence.
 */
const SCENARIOS = Object.freeze({
  "SEM25-V01": {
    group: "identity-and-selection",
    title: "同名表分布在两个连接、两个 Schema，overlay 文件名无 Schema",
    expectation: "下载 / 校验 / 导入均按完整表身份精确匹配；同名歧义必须阻断，不得按文件名归并。",
    steps: [
      "构造两个连接各含一张同名表，且每个连接下再各有两个 Schema；维护包的 overlay 文件名只带表名，不带 Schema。",
      "导出该批语义资产，断言每个 entry 携带完整表身份 {connectionId, schema, table}，同名表得到互不相同的 entryId。",
      "对该包执行批量校验，断言每个 entry 的校验目标与导出时记录的目标逐字相同，不出现跨连接或跨 Schema 命中。",
      "把同一维护包导回，断言落盘目标的 digest 与导出时记录的原目标 digest 一致。",
      "在同一 Schema 下制造两条候选同名表造成歧义，断言整批阻断并给出歧义原因，绝不静默选中其中一条。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-identity.test.ts"]
  },
  "SEM25-V02": {
    group: "identity-and-selection",
    title: "筛选结果跨多页，选择全部；切换筛选清空选择；未启用表维护后仍未启用",
    expectation: "选择范围是完整筛选结果而不是当前页；筛选变化清空选择；维护一张未启用表不会把它带进启用范围。",
    steps: [
      "在 Catalog 打开跨多页的筛选结果，勾选「选择全部筛选结果」，断言服务端解析出的选择范围等于完整筛选结果而非当前页。",
      "断言选择计数按完整筛选结果显示「已选择 N 张表」，且 N 与当前页可见行数不同（证明解析的是全量而非本页）。",
      "改变筛选条件，断言选择被清空并给出提示，不得保留上一个筛选下的选择。",
      "对一张未启用的表执行维护（导出 overlay / 校验 / 导入），断言该表仍不在启用表范围内。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-scope.test.ts"]
  },
  "SEM25-V03": {
    group: "identity-and-selection",
    title: "30 表下载→修改→导入→工作台确认→生效；未选文件 hash 不变；真实 Agent 经 Lucy Proxy 生效",
    expectation: "30 表完整旅程成立，未选文件前后 hash 相同；真实合成 Agent 只能经 Lucy Proxy 检索到新增语义，不允许直连 KTX 冒充 Lucy 生效。",
    steps: [
      "在受控内容根准备 30 张表的语义资产，下载维护包并只修改其中一张 overlay。",
      "导入后断言未选文件的 before/after hash 完全相同（其余 29 张不变），并记录被改文件的 before/after digest。",
      "在工作台确认发布计划，断言发布结果可回读到新增语义，且 release 记录的目标 digest 与候选 digest 一致。",
      "用获授权的合成 Agent 经 Lucy MCP Proxy 检索并读取新增语义，断言命中新增条目（Agent 维度证据）。",
      "断言取证链路只经 Lucy Proxy：调用证据中不出现直连 KTX 的读取路径，否则本维度不成立。",
      "Agent 级证据依赖 Wave 0b 交付环境；未解锁前本项保持条件项，本机结果不得替代该维度。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-scope.test.ts"]
  },
  "SEM25-V04": {
    group: "identity-and-selection",
    title: "单文件承载多表、跨 Schema / 连接关联、缺失依赖",
    expectation: "实际影响范围必须完整列出；依赖只读，不得被暗中扩写成可写目标；缺失依赖整批阻断。",
    steps: [
      "构造单个 overlay 文件同时声明多张表，并在其中声明跨 Schema 与跨连接的关联。",
      "解析依赖闭包，断言受影响对象清单完整，既含直接目标也含被关联影响的对象。",
      "断言依赖项在候选中以只读角色出现，不被列为可写目标，也不出现在写入集合里。",
      "移除一个必需依赖后重跑，断言整批阻断并明确指出缺失的依赖，不出现部分接受。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-identity.test.ts"]
  },
  "SEM25-V05": {
    group: "package-and-capacity",
    title: "包中一个 YAML / 引用 / 类型错误，其余 29 正确",
    expectation: "整批提交被阻断；正式目录、运行镜像与索引 hash 全部不变。",
    refusal: { reasonCode: null, description: "整批提交被阻断", effect: "正式目录、运行镜像与索引 hash 全部不变" },
    steps: [
      "构造 30 表维护包，注入一个 YAML 语法错误，其余 29 表保持正确。",
      "断言逐表 verdict 中该表为 failed、其余为 passed，且计数守恒 selected = passed + failed + not_run + stale。",
      "断言提交被整批阻断，正式目录 digest 与阻断前完全一致（零正式写入）。",
      "断言运行镜像与全局索引的 hash 同样不变，不存在部分生效。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-checks.test.ts"]
  },
  "SEM25-V06": {
    group: "package-and-capacity",
    title: "原包不修改及无 overlay 的模板不修改导回",
    expectation: "no_change：不发布、不索引；修改后新 hash 可合法预检。",
    steps: [
      "导出维护包后原样导回（不做任何修改），断言返回 no_change，不产生 release、不发布、不写索引。",
      "断言 no_change 前后正式目录与索引 digest 一致。",
      "对没有 overlay 的模板执行同样导回，断言判定仍是 no_change 而不是失败。",
      "修改其中一个 overlay 后重新预检，断言新 hash 可被合法预检，不再判定 no_change。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-package.test.ts"]
  },
  "SEM25-V07": {
    group: "package-and-capacity",
    title: "修改只读 Manifest、包 entry 改绑、其他实例包、过期导出基线、未知目标",
    expectation: "逐项阻断；启用范围与 ACL 保持不变。",
    refusal: { reasonCode: null, description: "逐项阻断", effect: "启用范围与 ACL 保持不变" },
    steps: [
      "修改维护包中的只读 Manifest，断言导入被阻断并给出「只读角色不可写」的原因码。",
      "把某个 entry 改绑到另一张表，断言原导出 digest 校验失败而阻断，不落到改绑后的目标。",
      "导入来自其他实例的维护包，断言因实例标识不符而阻断。",
      "使用超过 7 天基线有效期的导出包，断言基线过期被阻断，不采信客户端自报的基线。",
      "指向一个未知目标，断言同样阻断；复核启用表范围与 ACL 在五项阻断后完全未变。"
    ],
    localCoverage: [
      "webui/server/__tests__/semantic-batch-package.test.ts",
      "webui/server/__tests__/semantic-batch-scope.test.ts"
    ]
  },
  "SEM25-V08": {
    group: "package-and-capacity",
    title: "预览后另一会话、单表保存、Manifest 上传、CLI / Git 改目标或依赖（含 absent→存在）",
    expectation: "返回 409 / stale，必须重预览；不得沿用旧的覆盖确认。",
    refusal: { reasonCode: null, description: "返回 409 / stale", effect: "旧覆盖确认不再生效，必须重预览" },
    steps: [
      "完成一次导入预览后，由另一会话保存同一张单表。",
      "用旧预览发起确认提交，断言返回 409 / stale，而不是沿用先前的覆盖确认。",
      "重复该场景，改由 Manifest 上传、CLI 与 Git 改动目标或依赖，断言每条路径都得到同样的 409 / stale。",
      "覆盖 absent→存在 的目标变化场景，断言同样按 stale 阻断。",
      "断言重新预览得到新的 planDigest 后才能提交成功。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-scope.test.ts"]
  },
  "SEM25-V09": {
    group: "package-and-capacity",
    title: "ZIP 穿越、绝对路径、软 / 硬链接、重复归一化路径、重复身份、未知 entry、解压炸弹、嵌套包",
    expectation: "无越界写、无部分接受。",
    refusal: { reasonCode: null, description: "解包被拒绝", effect: "无越界写、无部分接受" },
    steps: [
      "分别构造含 `..` 穿越、绝对路径、软链接、硬链接、重复归一化路径、重复身份、未知 entry、嵌套包与解压炸弹的维护包。",
      "逐个断言解包被拒绝，并逐个断言没有任何文件写到内容根之外（越界写断言）。",
      "断言这些包都不会被部分接受：要么整包拒绝，要么整包接受，不出现半写入的中间态。",
      "断言拒绝信息不返回宿主绝对路径，也不回显包内凭据类文件。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-package.test.ts"]
  },
  "SEM25-V10": {
    group: "package-and-capacity",
    title: "200 YAML、512 KiB 单文件、16 MiB 内容、metadata / ZIP / HTTP 边界及各 +1",
    expectation: "边界值可接受、+1 被拒；导出成功的维护包满足导入限制且无截断。",
    steps: [
      "分别构造恰好 200 个 YAML entry、单个 YAML 恰好 512 KiB、解压内容恰好 16 MiB 的维护包，断言三者均可被接受。",
      "对每条限额再加 1，断言被明确拒绝并指出被超过的那条限额。",
      "对 metadata、ZIP 与 HTTP 三条边界各测边界值与 +1，断言拒绝口径与上面一致。",
      "把导出成功产生的维护包重新导入，断言导出结果满足导入限制，且逐 entry 的内容 hash 与导出前一致（无截断）。"
    ],
    localCoverage: [
      "webui/server/__tests__/semantic-batch-identity.test.ts",
      "webui/server/__tests__/semantic-batch-package.test.ts"
    ]
  },
  "SEM25-V11": {
    group: "package-and-capacity",
    title: "独立批量校验含 passed / failed / not_run / stale；实库执行 not_applicable 不进入提交 verdict",
    expectation: "只有必需检查因取消／超时未调度才记 not_run；并行／超时／取消后计数守恒，正式文件与索引不变。",
    refusal: { reasonCode: null, description: "校验本身不写正式文件、不改索引", effect: "正式文件与索引 hash 不变" },
    steps: [
      "跑一次独立批量校验，断言逐表 verdict 覆盖 passed / failed / not_run / stale 四种取值。",
      "在未要求实库执行时，断言实库维度记为独立的 not_applicable，不进入提交 verdict。",
      "断言只有必需检查因取消或超时未调度时才记 not_run，其余未执行情形不误记为 not_run。",
      "分别在并行、超时、取消三种情形下断言计数守恒 selected = passed + failed + not_run + stale。",
      "断言校验本身不写正式文件、不改索引，两者 hash 在校验前后一致。"
    ],
    localCoverage: [
      "webui/server/__tests__/semantic-batch-checks.test.ts",
      "webui/server/__tests__/semantic-batch-tasks.test.ts"
    ]
  },
  "SEM25-V12": {
    group: "concurrency-and-recovery",
    title: "30 表导入时已有其他待同步磁盘变更",
    expectation: "完整计划可见且统一校验；计划变更后旧确认失效，不得声称局部生效。",
    refusal: { reasonCode: null, description: "计划变更后旧确认失效", effect: "不得声称局部生效" },
    steps: [
      "在导入 30 表的同时制造其他待同步的磁盘变更，断言工作台展示的完整计划同时包含导入候选与既有磁盘变更。",
      "断言完整计划经过统一校验后才允许确认，不允许只校验导入部分就放行。",
      "在确认之前变更计划内容，断言旧确认失效（stale），必须重新预览。",
      "断言系统不会声称「局部生效」：要么整体生效，要么整体不生效。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-scope.test.ts"]
  },
  "SEM25-V13": {
    group: "concurrency-and-recovery",
    title: "重复点击、HTTP 重试、客户端断开重连",
    expectation: "同幂等键同 releaseId、只写一次只索引一次；不同计划复用键必须冲突。",
    steps: [
      "用同一幂等键重复提交同一计划（模拟重复点击与 HTTP 重试），断言两次返回同一个 releaseId。",
      "断言磁盘只写一次、索引只重建一次（写入与索引计数均为 1）。",
      "客户端断开后重连并用同一幂等键重放，断言仍返回同一 releaseId，不产生第二个 release。",
      "用同一幂等键提交一个不同的计划，断言返回冲突而不是复用原 release。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-idempotency-audit.test.ts"]
  },
  "SEM25-V14": {
    group: "concurrency-and-recovery",
    title: "第 N 次 rename、镜像同步、审计持久化失败",
    expectation: "已写／已恢复集合可核对；恢复失败阻断后续发布及受影响读取。",
    refusal: { reasonCode: null, description: "恢复失败时阻断后续发布与受影响读取", effect: "受影响资产的读取失败关闭" },
    steps: [
      "在第 N 次 rename 处注入失败，断言恢复日志能列出本批次已写集合与已恢复集合并逐项可核对。",
      "在镜像同步处注入失败，断言同样给出可核对的已写／已恢复集合。",
      "在审计持久化处注入失败，断言恢复动作执行且不留下半个 release 记录。",
      "断言恢复失败时 release 标记 recoveryRequired，后续发布与受影响资产的读取一律失败关闭，不继续读旧值冒充成功。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-recovery.test.ts"]
  },
  "SEM25-V15": {
    group: "concurrency-and-recovery",
    title: "在 journal / rename / index / 终结记录各边界 kill 并重启",
    expectation: "不猜 published、不误删恢复材料、不覆盖外部新内容。",
    refusal: { reasonCode: null, description: "不猜 published", effect: "重启后不把未终结批次标为已生效" },
    steps: [
      "分别在写 journal、执行 rename、写索引、写终结记录这四个边界强杀进程并重启。",
      "断言重启后不把未终结的批次猜成 published，activation 保持 unconfirmed / unknown。",
      "断言恢复材料（journal 与临时文件）不被误删，仍可用于人工核验。",
      "断言恢复过程不覆盖外部写入的新内容，外部新内容的 hash 保持不变。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-recovery.test.ts"]
  },
  "SEM25-V16": {
    group: "concurrency-and-recovery",
    title: "reindex 失败后文件仍保存、界面不报已生效",
    expectation: "重试不重复 promote，范围变更要求重新确认，失败的 attempt 被保留。",
    refusal: { reasonCode: null, description: "索引失败时不报已生效", effect: "activation 保持 unconfirmed" },
    steps: [
      "让索引（reindex）失败，断言正式文件已保存但 release 的 activationStatus 保持 unconfirmed，界面不显示已生效。",
      "断言重试索引不重复 promote，也不产生第二个 release。",
      "断言发布范围发生变化时必须重新确认，不能沿用旧确认提交。",
      "断言失败的 attempt 被保留（可在 release / 审计记录中查到），不被清除。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-idempotency-audit.test.ts"]
  },
  "SEM25-V17": {
    group: "permissions-and-deployment",
    title: "未登录、失效会话、Agent Token、其他操作者的 ID，以及轮询 / 下载 / 提交期间撤权",
    expectation: "一律拒绝，且不泄露内容。",
    refusal: { reasonCode: null, description: "未授权调用一律拒绝", effect: "不泄露内容且零副作用" },
    steps: [
      "分别以未登录、已失效会话、Agent Token、他人操作者 ID 调用批量接口，断言一律被拒（401 / 403）。",
      "断言被拒响应不泄露维护包内容、表清单、目标身份或任何包内片段。",
      "在轮询、下载、提交三个阶段进行中撤权，断言后续请求同样被拒绝且不返回内容。",
      "断言整批拒绝后正式文件与索引不变（零副作用）。"
    ],
    localCoverage: [
      "webui/server/__tests__/acl-capability.test.ts",
      "webui/server/__tests__/mcp-proxy-acl.test.ts"
    ]
  },
  "SEM25-V18": {
    group: "permissions-and-deployment",
    title: "合法性通过但描述不全、实库未查询",
    expectation: "合法性 verdict、完整度事实、执行证据三类结论分开；实库未要求记独立 not_applicable 而非提交 not_run，不阻断正常发布；JSON / CSV 与逐表报告相符，CSV 转义，无原始凭据。",
    steps: [
      "构造合法但描述不全的语义资产，断言合法性 verdict 为 passed，而完整度事实被单独记为不完整。",
      "在未要求实库执行时断言实库维度记为独立 not_applicable，而不是提交级 not_run，且不阻断正常发布。",
      "断言 JSON 报告、CSV 报告与逐表报告三者内容相符（同一批次、同一计数、同一逐表结论）。",
      "断言 CSV 对公式注入字符做转义，且任何报告都不含原始凭据。"
    ],
    localCoverage: [
      "webui/server/__tests__/semantic-batch-checks.test.ts",
      "webui/server/__tests__/semantic-batch-tasks.test.ts"
    ]
  },
  "SEM25-V19": {
    group: "permissions-and-deployment",
    title: "内容根为默认、定制路径、旧布局",
    expectation: "均只读写解析出的事实源及受控镜像，无硬编码仓库路径。",
    steps: [
      "分别以默认内容根、定制内容根与旧布局目录启动，断言解析出的事实源路径与预期一致。",
      "断言读写只发生在解析出的事实源与受控镜像目录内，没有任何写入落到硬编码的仓库路径。",
      "断言旧布局下同一资产不被写两次（不因布局探测产生重复写入）。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-batch-scope.test.ts"]
  },
  "SEM25-V20": {
    group: "permissions-and-deployment",
    title: "发布工作台保留校验 / 整批同步，无上传导出按钮；Catalog 多选、导入预览、错误定位、返回后任务结果可达",
    expectation: "工作台动作边界与 Catalog 交互按 Spec §3.1 / §3.2 固定，任务结果在返回后仍可达。",
    steps: [
      "断言发布工作台只提供「校验」与「整批同步」两类动作，没有上传或导出按钮。",
      "断言 Catalog 支持多选并显示「已选择 N 张表」，筛选变化时清空选择。",
      "断言导入预览能把错误定位到具体表，而不是只给一条笼统失败。",
      "断言从任务详情返回后任务结果仍可达，不被清空或丢失。"
    ],
    localCoverage: [
      "webui/src/__tests__/semantic-asset-publish.test.tsx",
      "webui/src/__tests__/semantic-asset-export.test.tsx"
    ]
  },
  "SEM25-V21": {
    group: "permissions-and-deployment",
    title: "真实打包 KTX 合并 / 校验合成 Manifest + overlay",
    expectation: "CLI / 单表 / 批量三条路径结论一致；不支持方言明确失败或未验证。",
    steps: [
      "用真实打包的 KTX 合并并校验合成的 Manifest + overlay，断言编译结论可复现且不依赖 mock。",
      "对同一份资产分别走 CLI、单表保存、批量导入三条路径，断言三者结论一致（同一 verdict）。",
      "对不支持的方言，断言明确失败或标记未验证，不得静默当作通过。"
    ],
    localCoverage: ["webui/server/__tests__/semantic-layer.roundtrip.test.ts"]
  },
  "SEM25-V22": {
    group: "permissions-and-deployment",
    title: "候选客户 amd64 镜像按现有单副本 Helm 交付合同跑合成往返和中断恢复",
    expectation: "本机 Compose 结果不得冒充客户验收；两者的证据分开登记。",
    steps: [
      "在候选客户 amd64 镜像上按现有单副本 Helm 交付合同部署，跑合成往返（导出 → 修改 → 导入 → 生效）。",
      "在同一镜像上跑中断恢复（强杀 → 重启 → 核验），断言恢复结论与本机一致。",
      "断言证据登记时区分「本机 Compose」与「客户验收」，两者不合并、不互相冒充。",
      "客户 amd64 证据依赖交付环境；未取得前本项保持条件项，本机结果不得替代该维度。"
    ],
    localCoverage: []
  }
});

/** Contract override for the two SEM25 ids whose approved contract differs. */
const CONTRACT_OVERRIDES = Object.freeze({
  "SEM25-V03": {
    executors: ["B", "P", "D", "O", "A", "V"],
    requires: ["lucy-http", "ktx-upstream", "postgres", "browser", "fault-control", "agent-client"],
    assert: ["allow_control", "no_side_effect", "exactly_one_wins", "consistency", "typed_gold"]
  },
  "SEM25-V22": {
    requires: ["lucy-http", "ktx-upstream", "postgres", "browser", "fault-control", "k8s-amd64"]
  }
});

/**
 * Fail-closed ids whose refusal must ALSO leave the world untouched — the
 * source Spec states an unchanged hash / unchanged ACL / zero side effect for
 * exactly these rows.
 */
const NO_SIDE_EFFECT_FAIL_CLOSED = Object.freeze(new Set([
  "SEM25-V05", "SEM25-V07", "SEM25-V09", "SEM25-V11", "SEM25-V17"
]));

/**
 * Dimensions that need a real environment this repository checkout cannot
 * provide. `delivery` is reserved for dimensions that depend on an unlocked
 * Wave 0b / customer delivery environment, never for "we did not run it".
 */
const ENVIRONMENT_BLOCK = Object.freeze({
  browser: { blockedReason: "environment", proves: "真实页面动作下的选择范围、导入预览、发布确认与生效状态" },
  protocol: { blockedReason: "environment", proves: "真实 HTTP / API 的请求与拒绝语义、错误码与零副作用" },
  database: { blockedReason: "environment", proves: "真实数据库上的语义落盘、镜像同步与索引结果" },
  agent: { blockedReason: "delivery", proves: "真实 Agent 客户端经 Lucy Proxy 检索 / 读取新增语义" },
  fault: { blockedReason: "environment", proves: "强杀、注入失败、恢复与重试的真实行为" },
  verifier: { blockedReason: "environment", proves: "产物 hash、清单闭合、泄漏扫描与跨端一致性" }
});

function contractFor(executionId) {
  const base = SEM_BASE;
  const override = CONTRACT_OVERRIDES[executionId] ?? {};
  return {
    executors: override.executors ?? [...base.executors],
    requires: override.requires ?? [...base.requires],
    assert: override.assert ?? [...base.assert],
    artifacts: [...base.artifacts]
  };
}

/** The manifest row for one execution id (the approved contract, single source). */
function manifestEntry(executionId) {
  const entry = loadCoverage().newScenarios.find((s) => s.executionId === executionId);
  if (!entry) throw new Error(`semantic-v025: ${executionId} is not in the coverage manifest`);
  return entry;
}

/**
 * Builds the evidence-dimension table for one id: the `unit` layer is
 * computable here (it proves the contract shape, not the scenario behaviour),
 * every executor-driven dimension needs a real run environment.
 */
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
  if (executionId === "SEM25-V22") {
    dimensions.push({
      dimension: "customer",
      executor: "V",
      state: "blocked",
      blockedReason: "delivery",
      proves: "候选客户 amd64 镜像按单副本 Helm 交付合同的往返与中断恢复",
      doesNotProve: "本机 arm64 Compose 结果不等于客户验收"
    });
  }
  if (executionId === "SEM25-V03") {
    dimensions.push({
      dimension: "agent",
      executor: "A",
      state: "blocked",
      blockedReason: "delivery",
      proves: "获授权的合成 Agent 经 Lucy Proxy 检索新增语义",
      doesNotProve: "Wave 0b 交付环境未解锁，本机结果不得替代"
    });
  }
  return dimensions;
}

/** One fully-formed descriptor. */
function buildCase(executionId) {
  const scenario = SCENARIOS[executionId];
  if (!scenario) throw new Error(`semantic-v025: no scenario for ${executionId}`);
  const contract = contractFor(executionId);
  return Object.freeze({
    executionId,
    sourceRequirementId: `V${executionId.slice(-2)}`,
    sourceSpec: SEM25_SOURCE_SPEC,
    ownerBranch: SEM25_OWNER_BRANCH,
    priority: SEM25_PRIORITY,
    executionGroup: scenario.group,
    title: scenario.title,
    expectation: scenario.expectation,
    steps: Object.freeze([...scenario.steps]),
    // fail-closed means: the contract REQUIRES a refusal / block. A permissive
    // result is a contract violation, not a weaker pass.
    failClosed: Object.hasOwn(scenario, "refusal"),
    refusal: scenario.refusal
      ? Object.freeze({
        ...scenario.refusal,
        requiresNoSideEffect: NO_SIDE_EFFECT_FAIL_CLOSED.has(executionId)
      })
      : null,
    conditional: false,
    conditionalOn: null,
    requiredExecutors: Object.freeze(contract.executors),
    requiredCapabilities: Object.freeze(contract.requires),
    assertionTokens: Object.freeze(contract.assert),
    artifacts: Object.freeze(contract.artifacts),
    evidenceDimensions: Object.freeze(evidenceFor(executionId, contract.executors)),
    localCoverage: Object.freeze([...scenario.localCoverage]),
    // No execution item may be recorded as passed without real run evidence
    // (implementation plan §3.2.3); the status lives in the result file.
    expectedStatus: "not_run"
  });
}

let cached = null;

/** All 22 SEM25 descriptors, in source-Spec order. */
export function semanticCases() {
  if (!cached) cached = Object.freeze(SEM25_EXECUTION_IDS.map((id) => buildCase(id)));
  return cached;
}

/** One SEM25 descriptor. */
export function semanticCase(executionId) {
  const found = semanticCases().find((c) => c.executionId === executionId);
  if (!found) throw new Error(`semantic-v025: unknown execution id ${executionId}`);
  return found;
}

/** Counts for reports; never implies a run status. */
export function semanticSummary() {
  const cases = semanticCases();
  return {
    total: cases.length,
    byGroup: Object.fromEntries(
      Object.entries(SEM25_EXECUTION_GROUPS).map(([group, ids]) => [group, ids.length])
    ),
    failClosed: cases.filter((c) => c.failClosed).length,
    conditional: cases.filter((c) => c.conditional).length,
    expectedNotRun: cases.filter((c) => c.expectedStatus === "not_run").length
  };
}

/** Cross-checks the descriptors against the approved coverage manifest. */
export function semanticContractProblems() {
  const problems = [];
  for (const c of semanticCases()) {
    const m = manifestEntry(c.executionId);
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
