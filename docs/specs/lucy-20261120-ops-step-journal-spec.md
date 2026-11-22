# 运维步骤账 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.0 |
| 日期 / 目标版本 | 2026-11-20 / 0.30.0 |
| 功能编号 / 优先级 | P1-68／REQ-030-089；P1（运行观察；建议）；不入核心分母 |
| 台账号 | 无 |
| 阶段 | S4 |
| 状态 | v1.0。终稿已确权；开发授权已获得；实现与独立代码评审完成；本机 demo Docker 平滑升级后 UAT-SUITE-OPS-STEP R0／01–08 全真 PASS（gitSha=88b2e9ea；跑次 [2026-11-22-cursor-ops-step](../qa/uat/suites/ops-step/runs/2026-11-22-cursor-ops-step.md)）；测试台 PASS WITH GAP（重度 Linux 管道 100ms／UID 追加拒绝／16MiB 双轮转、age_limit 1h 墙钟、51／52 表矩阵、双连接 catalog 配对仍为设计值 GAP）；不入核心分母；≠ 功能合同完全收口；≠ 可上线。 |
| 授权边界 | 2026-11-20 委托人要求按仓库规范起草、优化并定稿 Spec、Plan 与 UAT。本条只含需求规格。不含运行代码、不含测试执行、不含镜像或客户现场变更。 |
| 需求 / 总账 | [REQ-030-089](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) · [P1-68](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) |
| 计划 / 测试台 | [Plan](../plans/lucy-20261120-ops-step-journal-plan.md) · [UAT-SUITE-OPS-STEP](../qa/uat/suites/ops-step/suite.md) · [INDEX](../qa/uat/INDEX.md) |
| 读者 | Lucy 运维（供应方运维、交付实施）与 IT 运维（客户侧 IT）。治理方的调用流水、问数方的拒绝文案不进这本账。 |
| 证据 | 仓外截图目录「存档-历史报错截图」（2026-11-13 至 2026-11-20）。可核代码锚点：探针只读内存快照、诊断子进程只回传 `stage=reading` 且标准输出被丢弃、事件循环直方图不落盘也不写函数名、调用流水阶段记录在响应之后写入。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：冻结范围内的运维操作，在进入每一个命名步骤时先在当前进程读模型登记一条 `enter`，并对标准输出做一次有界、非阻塞的完整行写尝试；写成功时，进程不能服务后 IT 运维仍能在容器标准输出看到该行，进程还能服务时 Lucy 运维能用同一操作号读到它。写步骤失败不失败原操作，并按通道计丢行。
- 本条出口：SC-01–SC-18。
- 不在本条出口：不修复探针卡死、事件循环占满、读字段失败或表级歧义拦截；不改调用流水、阶段记录、审计导出；不改独立 `/api/admin/mcp-runtime/reload` 及未列入 §3.1 的配置保存链路；不承诺定位未登记生产代码造成的事件循环占用；不把供应商文档和现网差异、目录里两个 Hive 连接并存收进本条；不把步骤账送到客户日志平台；不自动从堆栈猜函数名；不承诺多实例、多副本共享一本账。
- 上线关系：本条收口不表示可上线。

主路径：问数成功路径不写运维步骤。存活与就绪探针继续只读内存，不等待正在进行的步骤或日志写入。步骤账写失败时，原操作继续；管理台分别显示标准输出、文件副本和格式化丢行。

## 1. 要解决的现场问题

2026-11-20 的就绪检查材料里，容器日志只能证明请求已经进来、两小时没有一次完成，不能指出停在读项目、读 `ktx.yaml`、读重载记录还是读执行层状态。2026-11-13 准备表结构的界面把多种失败收成同一句，阶段和原因码只留在容器日志，和界面上的失败没有操作号可对。保存启用表与 Ops MCP 提交都能写配置并触发生效链，但两条代码路径不同，必须分别登记和验收。

这些已列入 §3.1 的问题都要 Lucy 运维或 IT 运维在事后指出停在哪一步。准备表结构还必须在不改原失败句的前提下，把界面失败与同一个操作号对上。调用流水回答的是谁调用了哪个工具、裁决是什么，不回答这些问题。

2026-11-17 与 2026-11-13 的事件循环材料只作为背景：既有健康接口能给出延迟，却不能给出未登记代码的名称。本条只用 `uat_sync_section` 证明“进入已登记同步段后即使事件循环被占住，先有 enter”的机制；不把那两批材料归因到读字段，也不承诺未登记生产函数已经被覆盖。

## 2. 决策

| 编号 | 决策 | 约束 |
|---|---|---|
| D1 | 单独的运维步骤账 | 不写入 `access_log`，不写入 `access_trace_span`，不写入审计库。避免和审计写入争用，也避免把问数内容带进运维日志。 |
| D2 | 当前进程先登记，再尝试写标准输出 | `enter` 先进入当前进程内存读模型，再做标准输出写尝试，随后才执行步骤本体。文件副本进入同一先进先出写队列，不阻塞步骤本体。只有离开或失败才补该步骤的第二行。 |
| D3 | 两个读者、同一条 | 标准输出给 IT 运维，不要求登录。管理台给 Lucy 运维，沿用管理台登录。两边的操作号相同。 |
| D4 | 标准输出是有界、非阻塞的一次完整写尝试 | 对整行最多调用一次写，不睡眠、不重试、不等待背压消退。完整写入后才算标准输出成功；错误或非完整写都计 `stdoutDroppedCount`，原操作继续。非完整写后，当前进程不再向标准输出写后续步骤行，后续每行只计一次丢行，防止残行拼接；普通日志不受该抑制控制，重启后才恢复步骤行写尝试。不得对 fd 1 或其 duplicate 设置 `O_NONBLOCK`，不得改变共享 open file description 的阻塞标志；Linux 上只允许用 `/proc/self/fd/1` 重新打开管道取得独立描述符，`/dev/fd` 语义为 dup 的平台不得改标志，改走进程自身 stdout。若找不到满足该约束的独立写机制，停止实施并重审本决策，不得牺牲其他日志。 |
| D5 | 文件是重启后的副本 | 父进程单写者按先进先出顺序追加到 `${LUCY_CONTENT_ROOT}/.lucy/ops-steps.jsonl`。单文件 8 MiB，当前文件加一份滚动文件，共两份。队列连同正在写的一行最多占 1 MiB；满时丢弃新入队行，不等待、不重试，每条只计一次 `fileDroppedCount`。启动写者在历史读取前检查非空当前文件的末字节；若不是换行，先把含残行的当前文件轮转为 `.1`，再创建新当前文件，禁止直接接写。残行保留在历史中并标记 `historyResidual=true`，不伪计为当前进程文件丢行。每次追加前按磁盘校准当前文件大小；当前文件被外部删除或轮转后必须重建后继续写，不得让一次瞬时轮转失败永久停摆。恢复失败则 `fileWritable=error`，不得继续接写。文件错误与队列满均不回滚标准输出、不失败原操作。 |
| D6 | 探针路径不碰步骤账 | 存活、就绪、健康三个探针不写步骤、不读步骤文件、不等待诊断采集或文件队列。诊断采集在既有的请求外路径上给自己的子步骤打点。 |
| D7 | 保持既有并行与依赖顺序 | 诊断采集里现有 `Promise.all` 的独立读取保持并行；只有整个既有 `Promise.all` 成功返回后才进入 `read_reload_state`，并传入该批读取的 digest。不得仅等 digest 就提前执行。每一支先发送 `enter`，等待父进程确认内存登记和标准输出写尝试已完成，再执行读取；各独立支并行等待自己的确认，不等待文件落盘。没有终态的已进入分支仍未完成；文件队列只串行化写行，不串行化读取本体。 |
| D8 | 首版生产代码不预留虚构同步段名 | 只有挡板 `uat_sync_section` 用于验证同步段机制，不从堆栈推断函数。既有事件循环延迟指标保持原样，不新增阈值触发行；未登记生产代码造成的事件循环占用不在本条出口。 |
| D9 | 行格式与字段冻结 | 一行一个紧凑 JSON 对象，键、顺序和取值只按 §3.2。没有问句、SQL、驱动原文、连接 ID、表名、路径、口令、令牌。原因只用 §3.3 的原因码。 |
| D10 | 管理台只读 | 新页面只刷新和筛选。不做重试业务操作、不做导出、不做自动轮询。 |
| D11 | 测试挡板默认关闭 | `LUCY_OPS_STEP_UAT` 未设置或不等于 `1` 时，挡板路由不注册、返回 404。开启后才能托住已登记步骤、注入一次性写失败或读失败、暂停后台诊断及重置步骤账；不得用挡板替代真实业务操作。 |
| D12 | 准备表结构失败带操作号 | 错误响应 `detail.opsStepId` 与本次 `schema_structure_read` 的 `op_id` 相同。界面原失败句不变，在既有错误详情中另显操作号；批量失败保留各次请求的操作号。 |
| D13 | 父进程是唯一写者并确认 enter | 诊断子进程只通过 IPC 发送结构化步骤事件，不直接写标准输出或步骤文件。父进程生成并传入 `op_id`，统一更新内存、写标准输出、排队写文件及计数。父进程对 `enter` 回复匹配 `op_id+step` 的确认；即使标准输出写失败也必须确认，让真实读取继续。IPC 断开沿用既有诊断 abort／deadline 归集，不新增另一套超时。 |
| D14 | 重启前的孤立 enter 不是当前进行中 | 启动时先执行 D5 残行隔离，再把既有当前及滚动文件尾部作为历史；当前进行中只从本进程内存推导。历史里只有 `enter` 的步骤显示为“上次进程未完成”，归入已结束观察区，不改写历史行、不伪造 `fail`。 |

生产诊断继续使用既有 `DiagnosticSnapshotService` 的 5000 ms 外层 deadline，不因本功能放宽。挡板的生产诊断成功场景托住 2000 ms；托住 10000 ms 的生产诊断应被原 deadline 中止，验 `fail=aborted`，不得期待自然成功。仅为管理台长时间观察，挡板可显式选择独立生命周期：仍调用真实父子采集器和写者，但由挡板持有 AbortController、使用 `holdMs+10000 ms` 的测试清理时限，不发布生产诊断快照、不修改生产 deadline；该证据不得冒充生产诊断存活时限。

## 3. 记录合同

### 3.1 操作与步骤

| 操作 | 步骤 | 何时写 enter |
|---|---|---|
| `diagnostic_collect` | `read_project`、`read_ktx_yaml`、`read_catalog_reloads`、`read_reload_state`、`probe_execution` | 该支收到父进程 `enter` 确认后开始读取；独立支保持并行，`read_reload_state` 仅在既有整组 `Promise.all` 成功后开始，使用其 digest |
| `runtime_reload` | `write_config`、`catalog_reload`、`policy_commit` | 仅指一次 `lucy_ops_connection_tables` preview→commit 的提交执行链；`write_config` 在取得既有写锁后、锁内 `readFile` 前 enter，覆盖基线复算、YAML 补丁和原子写；锁等待不在步骤内。前一步成功 `leave` 后才进入下一步，失败则不进入后续步骤 |
| `enabled_tables_save` | `write_config`、`catalog_reload`、`policy_commit`、`execution_reload`、`execution_ack` | 仅指 `PUT /api/connections/:connId/enabled-tables` 且 `dryRun=false`；`write_config` 在判定非 dry-run 后、`patchConnectionEnabledTablesYaml` 前 enter，覆盖补丁、锁等待和原子写。Catalog／Policy 失败写 `fail` 后仍继续既有后续步骤；`execution_reload` 抛出时不进入 `execution_ack` |
| `schema_structure_read` | `list_tables`、`read_columns` | 一次 `POST /api/connections/:connId/schema-structure` 为一个操作；每段读取开始前写，重复读取按每次实际进入记录 |
| `sync_section` | `uat_sync_section` | 仅测试挡板使用；独立操作，用于证明同步段在占住事件循环前已写 enter |

独立 `/api/admin/mcp-runtime/reload`、未列出的配置保存路径和未登记生产代码不打运维步骤。新增操作或步骤名先改本表，再改实现和用例。

`runtime_reload` 多连接提交会按连接重复 `catalog_reload` 的 enter／leave；行内没有连接 ID，只能定位到步骤名，不能定位是哪条连接。单连接真实 UAT 证明顺序，双连接真实进程自动化证明每次循环都有配对行；不得把单连接证据扩张为“能定位具体连接”。

启用表路由的现值顺序见 `webui/server/index.ts`：补丁在 dry-run 返回分支之前计算，锁在补丁之后取得。实现须在共享补丁计算前按 `dryRun` 条件决定是否写 `enter`；dry-run 不写账。不得把 enter 放到后面的 `auditedWriteFile` 前而漏掉补丁，也不得为打点改变既有写锁、生效链和业务返回语义。更早的配置读取、目录读取与入参校验不在本步骤内。

### 3.1.1 终态判据与重复步骤

- 所有异步本体必须 `await` 后再写终态，不能把 Promise 已创建当成成功。原异常原样传播到原 catch；返回值分类只决定步骤行，不新增业务异常、不改变 HTTP 状态或既有继续／中断路径。
- `runtime_reload` 沿用 `executeGroup` 的异常边界：异常记 `fail` 并由原流程中断；正常返回记 `leave`。不新增 Catalog／Policy 生效门禁。
- `enabled_tables_save` 的 `catalog_reload` 按既有 `catalogRuntimeAck` 判据分类，`policy_commit` 按既有 `policyRuntimeAck` 判据分类，`execution_ack` 按返回的 `executionRuntimeAck` 分类。即使函数正常返回，ack 为 false 也记 `fail`；已有结构化分类按 §3.3 映射，无可映射分类时为 `unreadable`，不得把驱动错误原文带入行。Catalog／Policy 的返回值失败和原异常失败均继续后续步骤；`execution_reload` 保持原抛错中断行为。
- `schema_structure_read` 不只检查 throw。读取返回 `status=error`／`too_large`、`rejections` 或未读完的 `deferred` 均须归类：优先采用请求表顺序中的第一条 rejection，只有 deferred 时为 `timeout`，其余按 §3.3。混合原因仅表示该次步骤的首个失败原因，不声称能定位某张表；原批量 HTTP 200、单表 HTTP 错误和客户端重试行为保持不变。
- 对现有 catch 已把类型归并为人话的分支，在原类型／分类产生处传给步骤观察器；不得靠中文失败句或 SQL／驱动原文反推分类。观察器不改变原业务返回结构和控制流。
- 配对以同一 `op_id+step` 的实际进入次序进行；同名步骤按现有串行循环重复时，每次 enter 只匹配其后的第一个终态，不能按名字全局去重。读模型在进程内保留出现次序，不新增冻结日志键。首版不支持同一操作中同名步骤重叠执行；新增这种执行方式前须重审配对合同。
- 管理台分区的对象是步骤实例。同一操作可以同时有已结束步骤和进行中步骤；不得因任一兄弟分支已有终态就把仍未终结的步骤移出进行中，也不得把“有一条 leave”解释为整次操作成功。

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
- 标准输出发生非完整写时，该次计丢行，并按 D4 抑制当前进程后续步骤行写尝试；容器日志读取不得把残行与后续文本拼成一条有效步骤。文件历史读取跳过未以换行结束的残行；文件写者必须先按 D5 隔离残行，再写新行。

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

- 当前步骤状态与历史行分开维护。当前进程已进入且未终结的步骤实例保留在 `inFlight`，不因历史条数或年龄被淘汰；规模随既有业务并发，不为写账新增业务准入门禁。`enter` 在步骤本体前可见。
- 启动时读取既有当前文件及滚动文件的尾部作为历史。历史孤立 `enter` 显示“上次进程未完成”，不进入当前进行中。
- `history` 合并当前历史行与启动时文件尾部，先按完整可读文件尾部配对，再裁展示窗口：最多保留最近 2000 行或最近 1 小时，先到者为准，裁剪以步骤实例为单位整体保留，不拆开同一实例的 `enter` 与终态。`inFlight` 单独返回，不占此限额、不复制成新日志行；跨越 1 小时仍须可见。任一上限裁掉已存在历史行时 `historyTruncated=true`，原因取 `row_limit`／`age_limit`，可同时存在。只有文件尾部本身缺少起始行时才标“起始记录已截断”，不得伪造进入时间。
- 文件队列尚未落盘的当前行仍从内存可见，文件副本滞后不覆盖或重复当前行。
- 写健康分别返回：`stdoutWriteFailed`、`stdoutDroppedCount`、`fileWritable`（`ok`／`error`／`unknown`）、`fileDroppedCount`、`formatDroppedCount`、`historyResidual`。计数按当前进程累计，重启后归零；历史截断不计丢行。`historyResidual` 只披露启动时隔离了上一进程残行，不伪造当前进程丢行计数。
- 文件失败另给 `fileWriteReason`：`io_error`／`queue_full`／`""`。队列满或追加失败时为 `error`；之后真实追加成功可恢复为 `ok`。这是写通道原因，不扩充步骤行的 `reason_code`。队列满不重排已接收行，不把未入队行留在另一个无界缓冲中。
- 页面按通道显示丢行计数和写失败原因码，不显示驱动原文、文件路径或口令。
- 进行中的停留时长从本次步骤进入起按单调时钟计算，不直接使用从操作起算的 `elapsed_ms`；已结束步骤显示其配对时长。历史孤立 enter 的实际结束时间未知，停留时长显示“未知（上次进程未完成）”，不得随当前进程时间继续累计。

### 3.5 界面关联

`schema_structure_read` 的错误响应在既有 `detail` 中增加 `opsStepId`，不改错误码和原失败句；批量部分失败但仍返回 HTTP 200 时，在 `data.opsStepId` 返回本次请求操作号。准备表结构在既有错误详情中显示操作号；批量读取按请求边界保留操作号，并映射到该请求返回的对应表，不得跨请求混用。操作号不是问句、SQL 或审计关联键，不写入 `access_log` 或 `access_trace_span`。

必须分别保留 API 原句与客户端汇总原句。现值客户端 `readCheckedTableColumns` 会捕获单表 `READ_FAILED` 并汇总：单表 API 原句为 `表「x」没有读到字段。`，现有两个准备入口的页面汇总为 `有 1 张表没有读到字段：表「x」没有读到字段。`。不能为了满足错误的 UI 基线改动该句。关联信息须穿过客户端重建 `ApiError` 的 catch／汇总路径，并在 `SchemaStructurePrep.tsx` 与 `onboarding/Step2UploadManifest.tsx` 的现有错误区域展示，不得只改传输类型却在 `setError(err.message)` 时丢号。

51 张表的正常批次为 50＋1：首批部分失败从 HTTP 200 `data.opsStepId` 取号，末批单表失败从 HTTP 错误 `detail.opsStepId` 取号。52 张表的正常批次为 50＋2，可另验两次 HTTP 200。出现 deferred 时现有自适应逻辑可能增加请求数；不能把“所有情况恰好两次”写成产品承诺。

客户端聚合合同：每次请求保留 `{请求表集合, opsStepId}`，将该次响应的 rejection 或单表错误映射为 `{table, opsStepId}`。最终重建的客户端 `ApiError.detail.opsStepRefs` 保存全部失败表的这些映射，按原失败表顺序去重；既有 `error.data.partial` 保持原样。两个准备入口从该结构显示逐表操作号。deferred 重试按实际后续请求更新该表的最终失败操作号，不把首批号复制给后续请求，也不伪造服务端未返回的号。

## 4. 验收

| 编号 | 可打假检查 |
|---|---|
| SC-01 | 托住 `read_ktx_yaml` 期间，当次操作号的标准输出已有该步骤 `enter`，没有对应 `leave` 或 `fail`；释放后恰好补一条终态行 |
| SC-02 | 该 `enter` 在采集结束前已出现在容器日志，不需等进程退出；用当次操作号排除旧日志假阳性 |
| SC-03 | 上述托住持续时，就绪与存活探针均在 1 秒内返回，响应不包含步骤账正文 |
| SC-04 | 进入 `uat_sync_section` 并占住事件循环后，当次操作号最后一条同步段 `enter` 是 `uat_sync_section`，释放后补终态；健康接口此时期望可以不应答 |
| SC-05 | 单连接 `lucy_ops_connection_tables` 提交按 `write_config`、`catalog_reload`、`policy_commit` 顺序各有 `enter`，前一步成功 `leave` 早于后一步 `enter`；真实进程自动化证明 `write_config` 先于锁内 `readFile`／基线复算／YAML 补丁，并证明双连接每次 `catalog_reload` 循环都有配对行；不得声称能定位具体连接 |
| SC-06 | 读字段失败的步骤行带 §3.3 的精确原因码，行内没有 SQL；准备表结构原失败句不变 |
| SC-07 | 管理台与标准输出同号，按步骤实例配对和分区；一支已 leave、另一支仍 enter 时，后者保持进行中；重复 catalog_reload 的前一轮终态不能关闭后一轮 enter |
| SC-08 | 暂停测试期后台诊断后，一次成功问数完成且时间窗内没有任何运维步骤；该问数原有调用流水仍按既有合同写入 |
| SC-09 | 用服务实际 UID 验明步骤文件真实追加失败时，被观察操作仍完成，标准输出仍有 enter，fileWritable=error 且 fileDroppedCount 按未追加行数精确增加；恢复后真实追加成功才恢复 ok；阻塞文件消费者并填满 1 MiB 队列时按 queue_full 丢新行，队列不增长、不拖住本体或 IPC 确认 |
| SC-10 | 所有产出步骤行均为 §3.2 的合法 JSON，只有冻结键且含换行不超过 512 字节；含哨兵的真实输入不产生哨兵或 SQL 泄漏；超长构造只计格式化丢行 |
| SC-11 | 管理台页面在 1920×1080 前台浏览器打开；导航到列表可见的时间与接口耗时分列记录，E1–E9 各有真实浏览器证据 |
| SC-12 | 分别检查 diagnostic_collect、runtime_reload、enabled_tables_save、schema_structure_read、sync_section：当次 op_id 未混入 access_log／access_trace_span；按真实 schema 检查 access_log.event_type、access_trace_span.stage 及 JSON 属性中的 ops_step_journal 标识，不把不存在列视为阴性证据；各操作起止水位前通过既有 audit/status 确认 pendingWrites=0、failedWrites 未增，正常同名阶段不单独判失败，成功问数按当次 RPC／trace 关联新增流水 |
| SC-13 | 分别注入标准输出写错误和短写，原操作完成、分通道计数正确且内存和文件仍可读；短写后的下一条步骤行不得接写，须抑制并另计一次丢行，容器日志不把残行拼成有效步骤；另在 Linux 真实管道填满且不排水时调用实际写机制，外部监督进程证明每次写尝试及 enter 确认在 100 ms 内完成、至多一次写调用，无等待或重试；服务进程 fd 1 及 duplicate 标志不变，解除背压后普通 console 与既有日志无新增 EAGAIN、问数流水仍写入 |
| SC-14 | 重启后文件历史仍可读，上一进程孤立 enter 显示上次进程未完成且不进入当前进行中；真实文件部分写入后崩溃，重启先隔离残行并置 historyResidual，再写入的新操作行必须独立可读且不伪计当前文件丢行；真实写者累计写入超过 16 MiB、经历至少两次 8 MiB 轮转后，只保留当前文件和一份滚动文件，两文件各不超过 8 MiB |
| SC-15 | 生产诊断两支托住 2000 ms 时 enter 先出现，保持并行；延迟父进程确认前读取本体不得开始，写失败也确认且不等文件；read_reload_state 不早于整组 Promise.all 成功。另验原 5000 ms deadline、IPC 断开、abort／退出竞态：只对已 enter 未终结分支恰好补一次 fail=aborted，不补未进入支、不接受迟到第二终态 |
| SC-16 | 未登录结果符合既有管理鉴权；三类丢行及写健康可见；历史超过 2000 行或真实墙钟 1 小时返回截断原因，独立 inFlight 在两种裁剪后仍可见；E9 的上次进程未完成时长为未知 |
| SC-17 | 两个既有准备入口均在错误区域显示当次操作号，API 与客户端原句分别保持；51 表 50＋1 的 HTTP 200 data 与 HTTP 错误 detail、52 表 50＋2 的两次 HTTP 200 data 均正确关联，不跨请求混用 |
| SC-18 | 真实前台页面执行 PUT /api/connections/:connId/enabled-tables 且 dryRun=false，五步与真实调用一致；自动化覆盖 Catalog／Policy 返回 ack=false 及抛错后继续、execution_ack 返回 false、execution_reload 抛错后不进入 ack；false 不冒充 leave=ok；写配置先于补丁，异步完成前无终态，dry-run 不写账 |

SC-03 的 1 秒、SC-10 的 512 字节、SC-13 的 100 ms、§3.4 的 2000 行／1 小时、D5 的 1 MiB 队列、8 MiB 文件和两份文件都是设计值，首跑前不得改成「已测能力」。生产诊断 5000 ms deadline 是既有代码事实，不是本功能新增设计值。

## 核心流程（伪代码）

```text
writeStep(op, opId, step, phase, reason):
  memory.apply(op, opId, step, phase, ts, elapsed, result, reason)  # enter 先于 body
  try: line = compactJson(fixedKeysInOrder) + newline
  catch: formatDroppedCount += 1; return
  if utf8Bytes(line) > 512 or invalid:
    formatDroppedCount += 1
    return
  if stdoutLineBoundaryBroken:
    stdoutDroppedCount += 1                                        # 短写后抑制后续步骤行
  else:
    try:
      written = writeOnceNonblocking(stdoutFd, line)                # 不等待、不重试
      if written != utf8Bytes(line):
        stdoutDroppedCount += 1
        stdoutWriteFailed = true
        stdoutLineBoundaryBroken = true
    catch:
      stdoutDroppedCount += 1
      stdoutWriteFailed = true                                     # 无字节写出时可继续后续尝试
  if not parentFileQueue.tryEnqueue(line, maxBytesIncludingInFlight=1 MiB):
    fileDroppedCount += 1
    fileWritable = error; fileWriteReason = queue_full
  # 唯一写者 FIFO；内部逐条 await append/rotate；每条追加失败只计一次，不回抛

startupWriterBeforeHistoryRead():
  if currentFile is nonempty and lastByte != newline:
    rotate currentFile to .1 before any new append
    historyResidual = true
    create new currentFile
  # 隔离失败则 fileWritable=error，禁止接写；成功后才加载两文件历史

async runStep(op, opId, step, body, classifyReturn=normalReturnIsOk):
  writeStep(op, opId, step, enter, empty)
  try:
    value = await body()
  catch error:
    writeStep(op, opId, step, fail, reasonCode(error))
    rethrow error                                                  # 保留原业务结果
  outcome = classifyReturn(value)                                  # 只用既有结构化结果
  writeStep(op, opId, step, outcome.phase, outcome.reason)
  return value                                                    # 返回值 fail 不新增业务异常

diagnosticCollect():
  opId = parent.generateOpId()
  child.send({ opId, observations, ktxRuntime, cachedLayout })
  runBranch(step, readBranch):
    emitIpc(op, opId, step, enter)
    parent.writeStep(enter) then replyAck(opId, step)  # 不等文件落盘；写失败也确认
    child waits matching enterAck before readBranch()
    await readBranch()
    emitIpc(op, opId, step, leave | fail) -> parent.writeStep
  values = await existing Promise.all with registered branches wrapped by runBranch
  await runBranch(read_reload_state, () => readReloadState(root, values.digest))
  on IPC disconnect | abort | child close:
    parent atomically terminalizes only entered and unresolved branches as fail=aborted
    ignore any duplicate or late terminal event for an already terminal branch
  # 生产 owner 的既有 5000 ms deadline 与 permit 等待 child close 的语义保持不变

runtimeReloadConnectionTablesCommit():
  # 既有写锁取得后、readFile／基线复算／YAML 补丁之前进入 write_config
  await existing withOpsWriteLocks(..., async () =>:
    await runStep(runtime_reload, id, write_config, readBaselinePatchAndWriteConfig)
    for connection in existing unique connection loop:
      await runStep(runtime_reload, id, catalog_reload, () => reloadCatalog(connection))
    await runStep(runtime_reload, id, policy_commit, commitPolicy)
  )

enabledTablesSave():
  keep existing reads, validation and dryRun calculation
  if not dryRun: writeToken = enter(write_config)                   # 共享补丁之前
  try:
    proposedYaml, diff = existing patch and diff calculation
    if dryRun: return existing preview response                    # 没有 writeToken
    digestBefore = await existing digest snapshot
    return await existing withKtxYamlWriteLock + withDisplayWriteBarrier(async () =>:
      await existing auditedWriteFile(proposedYaml)
      terminalOnce(writeToken, leave)
      try: catalog = await runStep(..., catalog_reload, reloadCatalog, catalogAckOutcome)
      catch error: existing Catalog catch(error)                   # 原异常继续
      try: policy = await runStep(..., policy_commit, commitPolicy, policyAckOutcome)
      catch error: existing Policy catch(error)                    # ack=false 也继续
      await runStep(..., execution_reload, settleExecutionRuntime) # 原异常跳出，不进入 ack
      ack = await runStep(..., execution_ack, executionAckForConnection, executionAckOutcome)
      return existing response with original ack values
    )
  catch error:
    if writeToken is unresolved: terminalOnce(writeToken, fail, reasonCode(error))
    rethrow error                                                 # 后续失败不重复结束 write_config

probe(livez | readyz | health):
  return memory snapshot
  # no writeStep, no file read, no queue wait

adminRead(session):
  require admin session
  return history(currentProcessHistory + previousBootFileTail, 2000 rows, 1 hour)
       + inFlightFromCurrentProcessOnlyWithoutHistoryEviction + historyTruncation
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

- 路由：/admin/ops-steps
- 基准页：/admin/tokens
- 一件事：用操作号看出当前停在哪一个运维步骤。
- 状态：首访：打开即可识别运维步骤列表；空：还没有步骤时写明原因；加载：刷新进行中且不挡住已有行；错误：读取失败时在区内写明原因并可再刷新；0 条：筛选无命中可清除筛选；成功：按步骤实例分区，同一操作的不同步骤可分处进行中与已结束；部分：有丢行、历史被截断或历史残行隔离时仍显示独立进行中步骤和原因
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
- E6｜/admin/ops-steps｜成功｜列表｜进行中、已结束与上次进程未完成都能读到操作号、步骤名和正确状态标签
- E7｜/admin/ops-steps｜部分｜列表｜丢行、截断或历史残行隔离有原因，进行中步骤仍在
- E8｜/admin/ops-steps｜主动作｜页头｜刷新是唯一 primary
- E9｜/admin/ops-steps｜决定信息｜列表｜操作号、步骤名、停留时长、结果、原因码可见；历史孤立 enter 显示上次进程未完成且时长未知

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

2026-11-20 v0.1-draft 对抗复审：启用表保存作为独立五步操作纳入；撤回无代码依据的生产同步段名；IPC enter 增加父进程确认；禁止修改共享 stdout 阻塞标志；明确 write_config 起点、多连接证据边界和 E6 历史标签；验收扩为 SC-01–SC-18。状态不变，终稿未确权，开发未授权。

2026-11-20 v0.1-draft 只读评审后，经委托人追加授权修订文档：对齐生产诊断 5 秒 deadline 与隔离观察夹具；冻结异步和返回值终态判据、重复步骤配对及独立进行中保留；修正 51／52 表响应形态和 UI 汇总原句；增加真实 stdout 背压、文件追加失败、队列上限与审计区间证据。出口仍为 SC-01–SC-18，未执行 UAT，终稿未确权，开发未授权。

2026-11-20 v1.0：委托人明示“授权你修正，并定稿”。补充文件残行启动隔离与 historyResidual、stdout 短写后的后续步骤行抑制及计数、SC-12 对 access_trace_span.stage=ops_step_journal 的精确禁令；Spec／Plan 终稿确权。未执行 UAT，开发未授权，≠ 功能收口，≠ 可上线。

2026-11-20 v1.0（实施轮）：委托人授权拆分多 Agent 完成落地与 code review、暂不重建 Docker。共享写账内核、诊断父子接入、两条保存链、读字段操作号关联、管理读接口与只读页面已在工作树落地；两轮独立代码评审发现的缺陷已修复（stdout 覆盖风险、轮转失败停摆、裁剪拆实例、读模型重复行、非表级错误丢号、Catalog 读失败误记 leave、后台暂停不等空闲、isolated 与生产并发、页面自推状态、读故障未绑定）。类型检查与本条定向回归通过；未执行 Docker 重建、真实前台浏览器与 UAT，SC-01–SC-18 尚未取证，测试台仍 NOT RUN，≠ 功能收口，≠ 可上线。

2026-11-22 v1.0（UAT 跑次）：委托人批准 commit→平滑 demo:upgrade→UAT-SUITE-OPS-STEP R0／01–08 全真。R0／01–08 PASS（`gitSha=88b2e9ea`）；测试台 PASS WITH GAP；重度 Linux 管道／UID／16MiB、age_limit 1h、51／52 表、双连接 catalog 仍为设计值 GAP；≠ 功能合同完全收口；≠ 可上线；不 push／不发布。
