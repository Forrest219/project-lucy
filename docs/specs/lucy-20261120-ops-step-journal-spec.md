# 运维步骤账 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v0.1-draft |
| 日期 / 目标版本 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-68／REQ-030-089；P1（运行观察；建议）；不入核心分母 |
| 台账号 | 无 |
| 状态 | v0.1-draft。委托人2026-11-20授权登记与 Spec／Plan／UAT 设计；终稿未确权；开发未授权；测试台 NOT RUN；不入核心分母；≠ 功能收口；≠ 可上线。 |
| 授权边界 | 2026-11-20 委托人要求按仓库规范起草并优化 Spec、Plan 与 UAT。本条只含需求规格。不含运行代码、不含测试执行、不含镜像或客户现场变更。 |
| 需求 / 总账 | [REQ-030-089](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) · [P1-68](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 测试台 | [Plan](../plans/lucy-20261120-ops-step-journal-plan.md) · [UAT-SUITE-OPS-STEP](../qa/uat/suites/ops-step/suite.md) · [INDEX](../qa/uat/INDEX.md) |
| 读者 | Lucy 运维（供应方运维、交付实施）与 IT 运维（客户侧 IT）。治理方的调用流水、问数方的拒绝文案不进这本账。 |
| 证据 | 仓外截图目录「存档-历史报错截图」（2026-11-13 至 2026-11-20）。可核代码锚点：探针只读内存快照、诊断子进程只回传 `stage=reading` 且标准输出被丢弃、事件循环直方图不落盘也不写函数名、调用流水阶段记录在响应之后写入。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：冻结范围内的运维操作，在进入每一个命名步骤时先在当前进程读模型登记一条 `enter`，并对标准输出做一次有界、非阻塞的完整行写尝试；写成功时，进程不能服务后 IT 运维仍能在容器标准输出看到该行，进程还能服务时 Lucy 运维能用同一操作号读到它。写步骤失败不失败原操作，并按通道计丢行。
- 本条出口：SC-01–SC-17。
- 不在本条出口：不修复探针卡死、事件循环占满、读字段失败或表级歧义拦截；不改调用流水、阶段记录、审计导出；不改独立 `/api/admin/mcp-runtime/reload` 及其他配置保存链路；不把供应商文档和现网差异、目录里两个 Hive 连接并存收进本条；不把步骤账送到客户日志平台；不自动从堆栈猜函数名；不承诺多实例、多副本共享一本账。
- 上线关系：本条收口不表示可上线。

主路径：问数成功路径不写运维步骤。存活与就绪探针继续只读内存，不等待正在进行的步骤或日志写入。步骤账写失败时，原操作继续；管理台分别显示标准输出、文件副本和格式化丢行。

## 1. 要解决的现场问题

2026-11-20 的就绪检查材料里，容器日志只能证明请求已经进来、两小时没有一次完成，不能指出停在读项目、读 `ktx.yaml`、读重载记录还是读执行层状态。2026-11-17 与 2026-11-13 的材料里，健康接口给出事件循环延迟，没有给出当时进入的同步段名称。2026-11-13 准备表结构的界面把多种失败收成同一句，阶段和原因码只留在容器日志，和界面上的失败没有操作号可对。

这些问题都要 Lucy 运维或 IT 运维在事后指出停在哪一步。准备表结构还必须在不改原失败句的前提下，把界面失败与同一个操作号对上。调用流水回答的是谁调用了哪个工具、裁决是什么，不回答这些问题。

## 2. 决策

| 编号 | 决策 | 约束 |
|---|---|---|
| D1 | 单独的运维步骤账 | 不写入 `access_log`，不写入 `access_trace_span`，不写入审计库。避免和审计写入争用，也避免把问数内容带进运维日志。 |
| D2 | 当前进程先登记，再尝试写标准输出 | `enter` 先进入当前进程内存读模型，再做标准输出写尝试，随后才执行步骤本体。文件副本进入同一先进先出写队列，不阻塞步骤本体。只有离开或失败才补该步骤的第二行。 |
| D3 | 两个读者、同一条 | 标准输出给 IT 运维，不要求登录。管理台给 Lucy 运维，沿用管理台登录。两边的操作号相同。 |
| D4 | 标准输出是有界、非阻塞的一次完整写尝试 | 使用非阻塞标准输出描述符，对整行最多调用一次写，不睡眠、不重试、不等待背压消退。完整写入后才算标准输出成功；错误或非完整写都计 `stdoutDroppedCount`，原操作继续。不得为了重试而占住事件循环。 |
| D5 | 文件是重启后的副本 | 父进程单写者按先进先出顺序追加到 `${LUCY_CONTENT_ROOT}/.lucy/ops-steps.jsonl`。单文件 8 MiB，当前文件加一份滚动文件，共两份。文件写失败不回滚标准输出，也不失败原操作；每条未成功追加的行计一次 `fileDroppedCount`。 |
| D6 | 探针路径不碰步骤账 | 存活、就绪、健康三个探针不写步骤、不读步骤文件、不等待诊断采集或文件队列。诊断采集在既有的请求外路径上给自己的子步骤打点。 |
| D7 | 并行子步骤允许重叠 | 诊断采集里互相独立的读取保持并行。每一支在自己的读取前写 `enter`。没有 `leave`／`fail` 的那一支就是还没返回的一支；文件队列只串行化写行，不串行化读取本体。 |
| D8 | 同步段只记已登记的名字 | 同步段在进入前写 `enter`，不从堆栈推断函数。既有事件循环延迟指标保持原样，本条不新增“越过阈值再写一行”的第二套触发逻辑。 |
| D9 | 行格式与字段冻结 | 一行一个紧凑 JSON 对象，键、顺序和取值只按 §3.2。没有问句、SQL、驱动原文、表名、路径、口令、令牌。原因只用 §3.3 的原因码。 |
| D10 | 管理台只读 | 新页面只刷新和筛选。不做重试业务操作、不做导出、不做自动轮询。 |
| D11 | 测试挡板默认关闭 | `LUCY_OPS_STEP_UAT` 未设置或不等于 `1` 时，挡板路由不注册、返回 404。开启后才能托住已登记步骤、注入一次性写失败或读失败、暂停后台诊断及重置步骤账；不得用挡板替代真实业务操作。 |
| D12 | 准备表结构失败带操作号 | 错误响应 `detail.opsStepId` 与本次 `schema_structure_read` 的 `op_id` 相同。界面原失败句不变，在既有错误详情中另显操作号；批量失败保留各次请求的操作号。 |
| D13 | 父进程是唯一写者 | 诊断子进程只通过 IPC 发送结构化步骤事件，不直接写标准输出或步骤文件。父进程生成并传入 `op_id`，统一更新内存、写标准输出、排队写文件及计数。 |
| D14 | 重启前的孤立 enter 不是当前进行中 | 启动时把既有文件尾部作为历史；当前进行中只从本进程内存推导。历史里只有 `enter` 的步骤显示为“上次进程未完成”，归入已结束观察区，不改写历史行、不伪造 `fail`。 |

## 3. 记录合同

### 3.1 操作与步骤

| 操作 | 步骤 | 何时写 enter |
|---|---|---|
| `diagnostic_collect` | `read_project`、`read_ktx_yaml`、`read_catalog_reloads`、`read_reload_state`、`probe_execution` | 该支读取开始前；五支允许重叠 |
| `runtime_reload` | `write_config`、`catalog_reload`、`policy_commit` | 仅指一次 `lucy_ops_connection_tables` preview→commit 的提交执行链；前一步成功 `leave` 后才进入下一步，失败则不进入后续步骤 |
| `schema_structure_read` | `list_tables`、`read_columns` | 一次 `POST /api/connections/:connId/schema-structure` 为一个操作；每段读取开始前写，重复读取按每次实际进入记录 |
| 宿主操作不变 | `sync_yaml_parse`、`sync_row_parse`、`sync_policy_compile` | 只在这些已登记同步段进入前写；沿用宿主 `op` 与 `op_id`，允许与宿主步骤嵌套 |
| `sync_section` | `uat_sync_section` | 仅测试挡板使用；独立操作，用于证明同步段在占住事件循环前已写 enter |

独立 `/api/admin/mcp-runtime/reload`、其他配置保存路径和未列出的代码不打运维步骤。新增操作、步骤或同步段名先改本表，再改实现和用例。

### 3.2 行

一行一个 UTF-8 紧凑 JSON 对象，不添加空白。键及顺序固定为：`ts`、`op`、`op_id`、`step`、`phase`、`elapsed_ms`、`result`、`reason_code`。

- `ts` 为 ISO 8601 UTC 时间。
- `op`、`step` 只取 §3.1 的 ASCII 登记名。
- `op_id` 为 `ops_` 加 32 位小写十六进制随机标识，一次操作全程不变；嵌套同步段沿用宿主操作号。
- `phase` 取 `enter`、`leave`、`fail`；分别对应 `result=running`、`ok`、`error`。
- `elapsed_ms` 为大于等于 0 的整数，从该操作第一个 `enter` 起算。
- `reason_code` 在 `enter` 与成功 `leave` 时为 `""`；`fail` 时取 §3.3。
- 单行上限 512 字节，**包含末尾换行**。标准输出与文件写的内容完全相同。
- 字段均有界且由服务端生成，不得靠截断修复超长行。序列化后超过上限或无法形成合法 JSON 时，不写标准输出和文件，计一次 `formatDroppedCount`；内存仍保留当前步骤状态，原操作继续。
- 标准输出发生非完整写时，该次计丢行；历史读取跳过未以换行结束的残行，不把残行与下一行拼成一条有效步骤。

示例（展示时不含代码块换行以外的额外空白）：

```json
{"ts":"2026-11-20T08:00:00.000Z","op":"diagnostic_collect","op_id":"ops_0123456789abcdef0123456789abcdef","step":"read_ktx_yaml","phase":"enter","elapsed_ms":12,"result":"running","reason_code":""}
```

### 3.3 原因码

`timeout`、`io_error`、`aborted`、`missing`、`unreadable`、`too_large`、`permission`、`ambiguous`。

| 现有分类或错误 | 步骤行原因码 |
|---|---|
| `missing`、`ambiguous`、`permission`、`timeout`、`unreadable` | 同名保留 |
| `too_large`、`too_wide` | `too_large` |
| 最终失败的 `deferred`、读取预算耗尽 | `timeout` |
| 显式 `AbortSignal`、进程终止归集 | `aborted` |
| 文件或操作系统 I/O 错误 | `io_error` |
| 其他未识别读失败 | `unreadable`；不得复制原始错误文本 |

读字段失败只把内部分类映射到上表，不改变既有准备表结构失败句。步骤账自己的写入错误只进入 §3.4 的写健康与丢行计数，不伪装成业务步骤 `fail`。

### 3.4 管理台读模型

接口为 `GET /api/admin/ops-steps`，沿用已登录管理员鉴权；未登录结果与其他管理接口相同。标准输出不因未登录而停写。

- 当前进程的全部步骤行保存在有界内存读模型中，`enter` 在步骤本体前可见；进行中只由当前进程内只有 `enter` 的步骤推导。
- 启动时读取既有当前文件及滚动文件的尾部作为历史。历史孤立 `enter` 显示“上次进程未完成”，不进入当前进行中。
- 当前内存与历史文件合并后，最多返回最近 2000 行或最近 1 小时，先到者为准。任一上限裁掉已存在行时 `historyTruncated=true`，并标明截断原因；不得假装历史完整。
- 文件队列尚未落盘的当前行仍从内存可见，文件副本滞后不覆盖或重复当前行。
- 写健康分别返回：`stdoutWriteFailed`、`stdoutDroppedCount`、`fileWritable`（`ok`／`error`／`unknown`）、`fileDroppedCount`、`formatDroppedCount`。计数按当前进程累计，重启后归零；历史截断不计丢行。
- 页面按通道显示丢行计数和写失败原因码，不显示驱动原文、文件路径或口令。

### 3.5 界面关联

`schema_structure_read` 的错误响应在既有 `detail` 中增加 `opsStepId`，不改错误码和原失败句；批量部分失败但仍返回 HTTP 200 时，在 `data.opsStepId` 返回本次请求操作号。准备表结构在既有错误详情中显示操作号；批量读取按请求边界保留操作号，并映射到该请求返回的对应表，不得跨请求混用。操作号不是问句、SQL 或审计关联键，不写入 `access_log` 或 `access_trace_span`。

## 4. 验收

| 编号 | 可打假检查 |
|---|---|
| SC-01 | 托住 `read_ktx_yaml` 期间，当次操作号的标准输出已有该步骤 `enter`，没有对应 `leave` 或 `fail`；释放后恰好补一条终态行 |
| SC-02 | 该 `enter` 在采集结束前已出现在容器日志，不需等进程退出；用当次操作号排除旧日志假阳性 |
| SC-03 | 上述托住持续时，就绪与存活探针均在 1 秒内返回，响应不包含步骤账正文 |
| SC-04 | 进入 `uat_sync_section` 并占住事件循环后，当次操作号最后一条同步段 `enter` 是 `uat_sync_section`，释放后补终态；健康接口此时期望可以不应答 |
| SC-05 | 一次 `lucy_ops_connection_tables` 提交按 `write_config`、`catalog_reload`、`policy_commit` 顺序各有 `enter`，且前一步成功 `leave` 早于后一步 `enter`；独立执行层重载入口不冒充本用例 |
| SC-06 | 读字段失败的步骤行带 §3.3 的精确原因码，行内没有 SQL；准备表结构原失败句不变 |
| SC-07 | 管理台与标准输出的操作号相同；只有 `enter` 的当前操作位于进行中，已有 `leave`／`fail` 的位于已结束 |
| SC-08 | 暂停测试期后台诊断后，一次成功问数完成且时间窗内没有任何运维步骤；该问数原有调用流水仍按既有合同写入 |
| SC-09 | 步骤文件不可写时，被观察操作仍完成，标准输出仍有 `enter`，`fileWritable=error` 且 `fileDroppedCount` 增加；恢复后状态可再变为 `ok` |
| SC-10 | 所有产出步骤行均为 §3.2 的合法 JSON，只有冻结键且含换行不超过 512 字节；含哨兵的真实输入不产生哨兵或 SQL 泄漏；超长构造只计格式化丢行 |
| SC-11 | 管理台页面在 1920×1080 前台浏览器打开；导航到列表可见的时间与接口耗时分列记录，E1–E9 各有真实浏览器证据 |
| SC-12 | 诊断采集、重载、读字段、同步段的 `op_id` 均不出现在 `access_log` 或 `access_trace_span`，两表不存在 `producer`／`event_type`／`span_kind=ops_step_journal` 的行；既有正常审计即使使用同名阶段也不被误判 |
| SC-13 | 分别注入一次标准输出写错误和非完整写时，原操作仍完成，`stdoutWriteFailed=true`、`stdoutDroppedCount` 增加，文件副本和内存读模型仍可读；无等待或重试 |
| SC-14 | 重启后文件历史仍可读，上一进程孤立 `enter` 显示“上次进程未完成”且不进入当前进行中；超过 8 MiB 时只保留当前文件和一份滚动文件 |
| SC-15 | 同一次诊断同时托住 `read_project` 与 `read_ktx_yaml`，两支 `enter` 都在释放前出现，等待期间两支均无终态；文件队列不把读取本体串行化 |
| SC-16 | 未登录管理读接口得到既有未登录结果；管理台分别显示三类丢行和写健康；超过 2000 行或 1 小时时返回截断原因，1 小时边界由真实进程自动化覆盖 |
| SC-17 | 准备表结构错误详情中的操作号与当次标准输出、文件副本及管理台相同；原失败句不变，批量失败不把不同请求操作号混用 |

SC-03 的 1 秒、SC-10 的 512 字节、§3.4 的 2000 行／1 小时、D5 的 8 MiB 和两份文件都是设计值，首跑前不得改成「已测能力」。

## 核心流程（伪代码）

```text
writeStep(op, opId, step, phase, reason):
  memory.apply(op, opId, step, phase, ts, elapsed, result, reason)  # enter 先于 body
  line = compactJson(fixedKeysInOrder) + newline
  if utf8Bytes(line) > 512 or invalid:
    formatDroppedCount += 1
    return
  try:
    written = writeOnceNonblocking(stdoutFd, line)                  # 不等待、不重试
    if written != utf8Bytes(line):
      stdoutDroppedCount += 1
      stdoutWriteFailed = true
  catch:
    stdoutDroppedCount += 1
    stdoutWriteFailed = true
  parentFileQueue.enqueue(line)                                    # 唯一写者，FIFO
  # 队列内部逐条 await append/rotate；每条失败只计 fileDroppedCount，不回抛

runStep(op, opId, step, body):
  writeStep(op, opId, step, enter, empty)
  try:
    body()
    writeStep(op, opId, step, leave, empty)
  catch error:
    writeStep(op, opId, step, fail, reasonCode(error))
    rethrow error                                                  # 保留原业务结果

diagnosticCollect():
  opId = parent.generateOpId()
  child.send({ opId, observations, ktxRuntime, cachedLayout })
  parallel child branches:
    emitIpc(op, opId, step, enter) -> parent.writeStep
    readBranch()
    emitIpc(op, opId, step, leave | fail) -> parent.writeStep
  if child aborted or exits with unresolved branches:
    parent.writeStep(each unresolved branch, fail, aborted)

runtimeReloadConnectionTablesCommit():
  runStep(runtime_reload, id, write_config, writeConfig)
  runStep(runtime_reload, id, catalog_reload, reloadCatalog)
  runStep(runtime_reload, id, policy_commit, commitPolicy)

probe(livez | readyz | health):
  return memory snapshot
  # no writeStep, no file read, no queue wait

adminRead(session):
  require admin session
  return currentProcessMemory + previousBootFileTail
       + inFlightFromCurrentProcessOnly + historyTruncation
       + stdoutHealth + fileHealth + formatDroppedCount
```

页面登记落在 `webui/src/app/App.tsx`、既有管理导航及 `webui/docs/06-navigation-ia.md`。挡板只在 `LUCY_OPS_STEP_UAT=1` 时注册。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 问数成功或被拒，与运维日志无关 | 成功问数仍完成，且不为该调用写运维步骤 | ＝ | SC-08、SC-13 | — |
| P2 治理方 | 准备表结构失败有原句，但不能与容器步骤按操作号对账；权限授权路径不变 | 原失败句不变，错误详情可按操作号对账；权限授权路径不变 | P2·语义口径面 ↑／P2·权限授权面 ＝ | 语义口径面：SC-06、SC-17；权限授权面：SC-12 及未改授权路径 | — |
| P3 运维方 | 运行观察面只能看到请求进出和事件循环延迟；交付运维面的升级步骤不变 | 运行观察面能按操作号指出停在哪个步骤，写账故障有分通道计数；交付运维面的升级步骤不变 | P3·运行观察面 ↑／P3·交付运维面 ＝ | 运行观察面：SC-01、SC-02、SC-07、SC-13；交付运维面：未改部署升级路径 | — |
| P4 管理层 | 不直接看容器日志或探针步骤 | 概览与口径页不变 | ＝ | 未触碰概览与口径；SC-08 保证问数主路径仍可用 | — |

P2、P3 各保留逐子面判定。没有 `↓`，不触发负向补偿或产品级退回。本条不把问数主路径改成不可用：SC-03、SC-08 与 SC-13 同时成立才可收口。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 运维步骤、运维步骤账：已写入术语标准 §4.7。页面标题用「运维步骤」。禁止把本账叫做阶段记录、调用流水或审计账。
- 操作号、步骤名在页面上按专业标识处理，DOM 加翻译防御。
- 「上次进程未完成」只表示历史文件里孤立 `enter` 的读模型状态，不改写历史行，不冒充新业务失败。
- 原因码只出现在运维步骤行和管理台决定信息里，不改准备表结构的既有句子。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- 只读列表。页头一个刷新，作为唯一 primary。筛选清除是次要动作。
- 进行中与已结束分区。空、错误、0 条、截断都写在各自区域内。
- 沿用数据网格、页头和按钮，不新增视觉模式。
- 准备表结构沿用既有错误详情区域，只增加操作号，不新增错误弹窗。

### Exceptions (If Any)

- 无。

### Follow-up Needed

- 开发授权之后，按元素清单做前台浏览器验证。本草案的交互评审是设计核对，不是浏览器证据。

## 交互合同

- 路由：新路由：/admin/ops-steps
- 基准页：/admin/tokens
- 一件事：用操作号看出当前停在哪一个运维步骤。
- 状态：首访：打开即可识别运维步骤列表；空：还没有步骤时写明原因；加载：刷新进行中且不挡住已有行；错误：读取失败时在区内写明原因并可再刷新；0 条：筛选无命中可清除筛选；成功：进行中与已结束按时间可读；部分：有丢行或历史被截断时仍显示进行中步骤和原因
- 主动作：刷新是唯一 primary；不做多个同组 primary。
- 决定信息：操作号、操作名、步骤名、进入时间、已停留时长、结果、原因码、分通道丢行计数。
- 术语：本条新增「运维步骤」「运维步骤账」，已写入术语标准。
- 台账：无新台账
- 状态维度：进行中、已结束与上次进程未完成标明，同一状态维度不得互相否定。

## 元素清单

- E1｜/admin/ops-steps｜首访｜页头与列表｜打开后能识别运维步骤主任务
- E2｜/admin/ops-steps｜空｜列表｜还没有步骤时区内写明原因
- E3｜/admin/ops-steps｜加载｜列表｜刷新进行中，已有行仍留在区内
- E4｜/admin/ops-steps｜错误｜列表｜读取失败有原因，并可再次刷新
- E5｜/admin/ops-steps｜0 条｜筛选区｜无命中可清除筛选
- E6｜/admin/ops-steps｜成功｜列表｜进行中与已结束都能读到操作号和步骤名
- E7｜/admin/ops-steps｜部分｜列表｜丢行或截断有原因，进行中步骤仍在
- E8｜/admin/ops-steps｜主动作｜页头｜刷新是唯一 primary
- E9｜/admin/ops-steps｜决定信息｜列表｜操作号、步骤名、停留时长、结果、原因码可见

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 修订记录

2026-11-20 v0.1-draft：入池。只登记规格、计划与测试台剧本。终稿未确权。开发未授权。

2026-11-20 v0.1-draft 评审优化：闭合非阻塞标准输出、父进程单写者、重载边界、JSON 行格式、重启读模型、界面操作号关联及分通道写健康；验收扩为 SC-01–SC-17；UAT 补反假阳性断言。状态不变，终稿未确权，开发未授权。
