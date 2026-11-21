# Cases — UAT-SUITE-OPS-STEP

设计值与真实造数方法以 [fixtures.md](fixtures.md) 为准。容器名、连接 ID 与端口以当次 demo 为准。所有日志断言都使用当次 `op_id`；所有故障都要记录恢复结果。

| ID | 标题 | 读者 | 对应 |
|---|---|---|---|
| UAT-OPS-STEP-R0 | 环境门禁 | 两边 | 套件可跑、关闭态 404、审计水位可读 |
| UAT-OPS-STEP-01 | 诊断先进入、并行与生产中止归集 | IT 运维 | SC-01、SC-02、SC-03、SC-07、SC-15 |
| UAT-OPS-STEP-02 | 同步段名在占住之前已写出 | IT 运维 | SC-04 |
| UAT-OPS-STEP-03 | Ops 提交三段与启用表保存五步分别验证 | 两边 | SC-05、SC-07、SC-18 |
| UAT-OPS-STEP-04 | 读字段失败只有原因码且界面可对号 | 两边 | SC-06、SC-10、SC-17 |
| UAT-OPS-STEP-05 | 管理台读模型与真实浏览器状态 | Lucy 运维 | SC-07、SC-11、SC-14、SC-16 |
| UAT-OPS-STEP-06 | 问数无步骤且步骤账不插入调用流水 | 两边 | SC-08、SC-12 |
| UAT-OPS-STEP-07 | 文件、标准输出故障与滚动降级 | 两边 | SC-09、SC-13、SC-14 |
| UAT-OPS-STEP-08 | 挡板关闭后问数主路径仍完成 | 问数方 | SC-08 |

## UAT-OPS-STEP-R0

1. 记录容器名、WebUI／MCP 端口、git 版本、镜像摘要和内容根，不记录口令。在 Linux 容器记录 WebUI 实际 PID、UID/GID 与该 PID 的 fd 1 共享阻塞标志基线。
2. 在挡板关闭时请求全部 `/api/admin/ops-step-uat/*` 声明路由，均为 404；确认管理台可登录、MCP 可做一次只读问数。
3. 按 fixtures 开启挡板，确认挡板需要管理员鉴权。暂停周期诊断，等待全部观察操作和文件队列空闲，再 reset；验证不改变业务配置、数据库、审计账或生产诊断快照。
4. 创建重载、单表和第一轮 51 表夹具，预备第二轮新增第 52 张表的方法；验证真实 `lucy_ops_connection_tables` preview 及启用表页面可用，记录原 `enabledTables`。记录两个准备表结构入口的原页面汇总句与 API 原句。
5. 验证 `access_log` 与 `access_trace_span` 只读水位可查询；建立本套件的审计证据表。
6. 验证标准输出可按起始时间和 `op_id` 过滤，管理读接口可访问，真实前台浏览器为 1920×1080。

期望：以上全部成立才跑 01–08。任一真实夹具或审计水位不可构造则 BLOCKED，不得用 mock 凑绿。

## UAT-OPS-STEP-01

### A. 生产成功路径与顺序

1. 记录日志与审计水位，确认生产诊断空闲。调用 lifecycle=production 的真实诊断挡板，同时托住 read_project 与 read_ktx_yaml 2000 ms，保存 op_id；保留原 5000 ms deadline。
2. 托住开始后 1 秒内读取该时间窗容器标准输出，按本次 `op_id` 过滤。
3. 同时请求存活与就绪探针，分别记录耗时和正文。
4. 附真实进程自动化证据：延迟父进程 enter 确认前读取本体不得开始；stdout 失败仍确认，确认不等文件；各支并行等待。另让 digest 先返回、另一独立支保持未返回，read_reload_state 不得提前 enter；整组成功后才允许进入。
5. 等待自然释放，再读同一 `op_id` 的全部标准输出、文件行和管理读模型。

期望：

- 释放前两支均已有 `enter`，且两支都没有对应 `leave`／`fail`；证明等待没有串行化读取本体。
- read_ktx_yaml 的 enter 在采集结束前已可见，没有使用旧日志；延迟确认自动化证明本体未提前开始，托住时长本身不作为顺序证明。
- 两个探针均在 1 秒内返回，正文没有运维步骤行。
- 释放后每支恰好有一条成功 `leave`，没有重复终态；文件与管理台使用同一操作号。

### B. 生产 deadline 与父子终结竞态

1. 另发 lifecycle=production、holdMs=10000 的操作，记录开始和中止时刻；不能放宽 5000 ms deadline 或改用独立生命周期冒充。
2. 附真实父子进程自动化：按 fixtures 分别构造 IPC 断开、原 AbortSignal、子进程退出、abort 与 close／迟到终态竞态，包含一支已 leave 而另一支已 enter 未终结的情况。
3. 保存已 enter 集合、原终态集合、父进程补写及 child close／permit 释放的实际顺序，并逐操作记录结束审计水位。

期望：生产 10000 ms 托住被原 5000 ms deadline 中止，不等自然成功；真实调度误差单列，不改计时器设计值。仅已 enter 未终结分支各有一条 fail=aborted；已有终态不重复、未进入的 read_reload_state 不补行，迟到终态不制造第二条。单支 leave 时另一支仍在进行中，permit 仍须等 child close 才释放。

## UAT-OPS-STEP-02

1. 记录日志与审计水位，进入 `uat_sync_section` 并占住事件循环 10 秒，保存 `op_id`。
2. 占住期间读取容器标准输出，不要求健康接口有响应；记录健康接口实际结果。
3. 等待自然释放，再查同一操作号。

期望：占住期间本次操作最后一条同步段 `enter` 为 `uat_sync_section`，尚无终态；释放后恰好一条成功 `leave`。健康接口超时或无响应符合预期，不记失败。

## UAT-OPS-STEP-03

### A. Ops MCP `runtime_reload`

1. 记录日志与审计水位。按 fixtures 用真实 `lucy_ops_connection_tables` preview→commit，将 `uat_ops_step_reload` 加入原 `enabledTables`。
2. 从本用例日志游标内找出唯一一个 `runtime_reload` 的 `op_id`，分别在标准输出和管理台取该操作全部行。
3. 附真实进程自动化证据：延迟锁内 readFile／基线复算／YAML 补丁时 write_config enter 已出现，异步未完成前没有终态；双连接每轮 catalog_reload 独立配对，托住第二轮时第一轮 leave 不关闭第二轮进行中步骤。
4. 断言三段顺序后，按 fixtures 用第二次 preview→commit 恢复原 `enabledTables`。

期望：第一次提交依次为 `write_config`、`catalog_reload`、`policy_commit`；前一步成功 `leave` 早于后一步 `enter`，每段最终成功。管理台与标准输出同号，完成后位于已结束。双连接行不含连接 ID，不得据此声称能定位具体连接。恢复后配置与 R0 基线一致。

### B. WebUI 启用表 `enabled_tables_save`

1. 在真实前台浏览器打开启用表页面，按 fixtures 对同一 demo 连接执行一次启用 `uat_ops_step_reload` 的保存；确认实际请求为 `PUT /api/connections/:connId/enabled-tables` 且 `dryRun=false`。
2. 从该请求时间窗找出唯一一个 `enabled_tables_save` 的 `op_id`，对照标准输出、文件和管理台。
3. 附真实进程自动化证据：write_config enter 先于共享 YAML 补丁，保持原锁和 barrier 范围；Catalog／Policy 分别覆盖抛错与正常返回 ack=false，均写 fail 后继续；execution_ack 返回 false 写 fail；execution_reload 抛出时不进入 ack。延迟真实异步返回时不得提前写终态；dry-run 不产步骤行。
4. 通过同一页面恢复原启用表集合。
5. 记录点击保存→反馈可见的即时耗时，与同次 PUT API 耗时分列；记录本操作结束审计水位，不与 Ops 提交共用一行证据。

期望：成功保存依次记录 `write_config`、`catalog_reload`、`policy_commit`、`execution_reload`、`execution_ack`，每一步有配对终态且顺序与真实调用一致。Ops MCP、独立 `/api/admin/mcp-runtime/reload` 和 dry-run 均未冒充本用例；恢复后页面及配置回到 R0 基线。

## UAT-OPS-STEP-04

### A. 单表失败、原句与哨兵

1. 记录日志与审计水位。按 fixtures 分别在连接页准备入口、接入向导第 2 步的真实前台浏览器选中 uat_ops_step_sentinel，删除底层表后读字段；两次之间重建该表并重新列名。
2. 记录导航到错误详情可见的即时时间，并分列对应读字段 API 耗时；保存错误响应 `detail.opsStepId`。
3. 按该操作号读取标准输出、文件副本和管理台；对当次全部步骤行做 JSON 解析、冻结键、512 字节及哨兵检查。

期望：

- API 原句仍为 `表「uat_ops_step_sentinel」没有读到字段。`；两个页面均保留原汇总句 `有 1 张表没有读到字段：表「uat_ops_step_sentinel」没有读到字段。`，既有错误区域另显同号，汇总重建 ApiError 后不能丢号；两种耗时分列。
- `read_columns` 的 `fail` 精确为 `reason_code=missing`，不得接受其他码。
- 三处操作号一致；行内没有 `uat_ops_step_sentinel`，大小写不敏感地没有 `SELECT` 或 `information_schema`。
- 所有行只有 Spec 冻结键，含换行不超过 512 字节。另附真实序列化自动化对 511／512／513 字节和超长构造的结果。

### B. 51 表的混合响应

1. 按 fixtures 选中 51 张表，删除 `_00` 与 `_50` 后执行读字段。
2. 保存实际请求体，确认按编号顺序为 50＋1；首批 HTTP 200 从 data.opsStepId 取号，末批单表 HTTP 400 从 detail.opsStepId 取号，保存两张失败表的界面决定信息。

期望：两个操作号不同；_00、_50 各显示所属请求号，混合响应在客户端汇总后不交叉、不丢失；原失败句结构不变，不要求末批变成 HTTP 200。

### C. 52 表的两个 HTTP 200

按 fixtures 重建删除表、添加 _51，重新列名并升序选中 52 表后再删 _00 与 _50。捕获正常 50＋2 的两个 HTTP 200，分别检查 data.opsStepId 与逐表界面关联；两个操作号不同。两轮分别记录起止审计水位。若出现 deferred，保存实际自适应请求序列，补齐正常两批场景后才判边界通过，不删改既有重试。附真实读取自动化覆盖 rejections／deferred 的返回值失败分类，不得只测抛错。

## UAT-OPS-STEP-05

1. 暂停周期诊断，等当前操作和文件队列空闲再 reset。前台浏览器首次打开 /admin/ops-steps，记录 E1／E2；随后产生已结束同步段，用 lifecycle=isolated 托住诊断 120 秒，保存两号，不改变生产 deadline。
2. 记录导航到非空列表可见的即时时间，与同一次列表 API 耗时分列。对照标准输出验证两个操作号，覆盖 E6。
3. 按 fixtures 分别注入一次管理读延迟和一次管理读错误，用返回的 token 触发，完成 E3／E4；用不存在的操作号筛选并清除，完成 E5。
4. 保持独立诊断托住，再执行至少 1001 次 holdMs=0 同步段，使 history 超过 2000 行；在释放前检查 row_limit 及独立 inFlight 仍可按号找到。若生成速度未赶上 120 秒，重做可明确托住更久的独立观察，不用已结束记录冒充进行中。检查 E8／E9。
5. 未登录请求管理读接口，记录与其他管理接口一致的结果；随后再产生一个真实步骤，确认标准输出未因未登录请求停写。
6. 检查 stdoutWriteFailed、fileWritable、fileWriteReason、三类丢行及截断原因。附真实进程自动化：isolated holdMs=3700000，真实墙钟超过 1 小时且未释放时，已结束历史被 age_limit 裁掉、inFlight 仍在；释放后恰好一个终态。
7. 等上述观察自然结束。另用独立模式托住真实步骤并等 enter 已追加到文件，按 fixtures 强制终止服务进程并恢复；重新打开页面检查历史操作号、标签和未知时长。重启前后都记录日志游标及审计水位。

期望：

- E1–E9 都有前台浏览器证据，证据含路由、1920×1080 视口及 E 编号逐项结果。
- E6 按步骤实例读清进行中、已结束与上次进程未完成；同一操作一支 leave 不关闭其他未终结支，重复步骤不按名字去重；历史标签不混入当前进行中。
- 截断原因、分通道写健康和丢行计数可见；刷新是唯一 primary。
- 重启后文件历史仍可读，上一进程孤立 `enter` 显示“上次进程未完成”，不在当前进行中。该重启只验证 SC-14，不作为故障修复。
- E9 检查步骤时长而非操作累计 elapsed_ms；历史孤立 enter 的时长为未知，不随新进程时间增加。history 截断不淘汰独立 inFlight，也不伪造新的 enter。

## UAT-OPS-STEP-06

1. 暂停测试期后台诊断，等待当前操作、文件队列及既有 audit/status 的 pendingWrites 均空闲；记录 failedWrites 基线、步骤日志游标、文件尾部与问数前 access_log 水位。
2. 用 MCP 对 demo 可见来源做一次成功只读问数，保存唯一 JSON-RPC 请求 ID 及实际调用 trace 关联。
3. 响应后等待 audit/status 的 pendingWrites=0、failedWrites 未增，再取结束水位；查询该时间窗三通道、调用流水及阶段记录，新增正常审计须关联这次 RPC／trace，不能用其他新调用凑数。排空失败则 BLOCKED／FAIL，不提前取空结果判绿。
4. 汇总 R0 审计证据表，分别列诊断、Ops 重载、启用表保存、读字段和同步段；逐个使用开始／结束 access_log.id、父调用关联 span 范围及精确 op_id 全表检索，保存真实 schema 与实际查询，不能用 TEXT span_id 的 MAX 作单调水位。

期望：

- 问数得到结果，原有调用流水按既有合同增加；问数时间窗没有任何新增运维步骤。
- 五种操作各有独立阴性证据，包含 enabled_tables_save；两表检索精确 op_id 均无混入。按真实列检查 access_log.event_type、access_trace_span.stage 和 JSON 属性中的 ops_step_journal 标识，明确 stage=ops_step_journal 不得出现；不存在的列不作为阴性证据。
- 运维操作自身正常产生的审计单独列出；既有同名阶段不单独作为失败依据，不把“有正常审计”误判为 SC-12 失败。

## UAT-OPS-STEP-07

1. 按 fixtures 先核步骤文件已存在及服务实际 UID，记录文件与目录权限；只改目录权限不足以阻止追加。对文件撤销服务 UID 写权限，并限制目录替换路径，以同 UID 实际追加失败确认故障生效后，跑一次真实同步段；随后恢复权限并再次运行。
2. 分别武装一次标准输出 `error` 和 `short`，各跑一次真实同步段；保存写调用次数、操作结果、内存行、文件行和分通道计数。短写后再跑一条真实步骤，确认后续步骤行被抑制并另计丢行，容器日志没有把残行接成有效 JSON。
3. 记录 WebUI 实际 PID，故障前后读取该进程 fd 1 及 duplicate 的共享标志；不能读 docker exec 自身。附真实 Linux 满管道背压下实际写机制的外部监督计时、写调用次数、原操作完成和 IPC 确认证据；解除背压后普通 console 探针及只读 MCP 问数仍正常，日志无新增 EAGAIN。
4. 用真实进程自动化持续执行快速同步段，累计实际写入超过 16 MiB、确认至少两次 8 MiB 轮转，检查文件数量、单文件上限与 JSON 可读性；只验第一次轮转不足以证明第二次不会留下第三份文件。
5. 另用真实文件写者制造部分写入并强制崩溃；重启后确认先隔离残行、historyResidual=true，再产生的新操作行独立 JSON 可读，且不把上一进程残行伪计为当前 fileDroppedCount。
6. 恢复全部权限与写者状态，记录恢复结果。
7. 附真实进程自动化阻塞文件消费者、实际填满 1 MiB 队列的证据，检查队列上限、丢新行数量、queue_full、业务本体和 enter 确认继续；恢复消费者后队列按 FIFO 排空，成功追加恢复 ok。

期望：

- 已以服务 UID 验明追加不可写时，操作完成、stdout 仍有 enter，fileWritable=error、fileWriteReason=io_error，fileDroppedCount 等于未追加行数；恢复并实际追加成功后为 ok。不能只看到 chmod 成功就声称造故障成功。
- 两种标准输出故障下操作均完成，内存和文件行仍可读，`stdoutWriteFailed=true`、`stdoutDroppedCount` 增加；每次故障只有一次写调用，无等待或重试。
- fd 1 及 duplicate 的共享阻塞标志与 R0 基线一致；普通 `console` 探针仍出现，只读问数的既有调用流水仍写入，不得用其他日志的 `EAGAIN` 换取步骤账非阻塞。
- 满管道且未排水时，每次实际写尝试及 enter 确认在 100 ms 内完成，至多一次写调用。预制 error／short、只记录函数调用次数或靠监督超时终止均不能代替此证据。
- stdout 短写后的下一条步骤行被抑制且另计丢行，容器日志不把残行拼成有效 JSON；文件残行则用真实崩溃／隔离用例验证，不能用 stdout 短写冒充文件故障。
- 至少两次轮转后仅有当前文件和一份滚动文件，各不超过 8 MiB；可读完整行均合法。残行隔离后新行独立可读并显示 historyResidual，不得直接预写伪 JSON 代替真实写者。

## UAT-OPS-STEP-08

1. 恢复后台诊断，按 demo 既有方式关闭挡板并确认挡板路由重新为 404。
2. 重复 06 的成功只读问数与原调用流水增加断言。后台诊断已恢复，允许另有独立 diagnostic_collect；保存其操作号单独归因，不复用 06 暂停后台时的整窗零步骤断言。
3. 恢复重载配置并清理全部一次性表，核对业务配置和审计账未被 reset 改动。

期望：问数完成，挡板关闭，夹具和权限均已恢复。这是主路径守卫，失败则整套不得 PASS。
