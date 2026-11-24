# Fixtures — UAT-SUITE-OPS-STEP

设计值，首跑前不是已测能力。容器名、连接 ID、端口和凭据路径以当次 demo 为准；不记录口令。

## 1. 环境与设计值

| 项 | 值 |
|---|---|
| 环境 | 本机 demo Docker。WebUI 与 MCP 端口用当次映射，默认宿主 55176 与 57881 |
| 浏览器 | 真实前台，1920×1080 |
| 挡板 | `LUCY_OPS_STEP_UAT=1` 时注册；未设置或为其他值时所有挡板路由 404 |
| 托住时长 | 生产诊断成功场景 2000 ms；生产中止场景 10000 ms，须被既有 5000 ms deadline 中止；同步段 10000 ms；管理观察用显式独立生命周期，不依赖重启释放 |
| 探针上限 | 托住期间存活与就绪均在 1 秒内返回 |
| 行长 | 紧凑 JSON 加末尾换行，总计不超过 512 UTF-8 字节 |
| 历史 | history 最多 2000 行或最近 1 小时；独立 inFlight 不被这两个历史窗口淘汰 |
| 文件副本 | `${LUCY_CONTENT_ROOT}/.lucy/ops-steps.jsonl`；8 MiB；当前文件加 `ops-steps.jsonl.1`，共两份 |
| 文件队列 | 包括正在写的一行共 1 MiB；满时丢新行，按行精确计数 |
| stdout 背压 | 真实 Linux 管道填满、不排水；实际写尝试和 enter 确认各在 100 ms 内完成；由独立监督进程计时 |
| 口令／SQL 哨兵 | `uat_ops_step_sentinel`；作为真实表名输入，不是真实口令 |
| 问数 | demo 可见范围内的一次成功只读问数，不写客户库 |

## 2. 挡板接口

以下接口均需既有管理员鉴权，且只在挡板开启时存在。响应不得包含预制步骤行；`op_id` 必须来自真实写者。

| 接口 | 请求 | 用途 |
|---|---|---|
| `POST /api/admin/ops-step-uat/reset` | `{}` | 只清空步骤账内存与文件，不改业务配置、审计账或数据库 |
| `POST /api/admin/ops-step-uat/diagnostic` | `{ "steps": ["read_project", "read_ktx_yaml"], "holdMs": 2000, "lifecycle": "production" }` | 从既有生产 snapshot service 触发真实采集；空闲才接受并 202 返回 op_id，忙时返回 409，不返回别次操作号。`lifecycle=isolated` 要求后台诊断已暂停且无在途采集，否则 409 |
| `POST /api/admin/ops-step-uat/sync-section` | `{ "holdMs": 10000 }` | 进入真实 `uat_sync_section` 包装器；202 返回 `op_id`；`holdMs=0` 用于快速产生真实步骤 |
| `POST /api/admin/ops-step-uat/background` | `{ "enabled": false }` | 暂停测试期后台诊断；暂停时等待在途采集结束才返回 200，避免问数时间窗被无关步骤污染 |
| `POST /api/admin/ops-step-uat/stdout-failure` | `{ "mode": "error" }` 或 `{ "mode": "short" }` | 只对下一次标准输出写注入一次错误或短写；error 后可继续，short 后按合同抑制后续步骤行并逐条计丢行 |
| `POST /api/admin/ops-step-uat/read-failure` | `{ "mode": "delay", "delayMs": 2000 }` 或 `{ "mode": "error" }` | 为下一次管理列表读注入延迟或错误，返回一次性 `token`；只有带该 token 的读请求才命中，用于 E3／E4 |
| `POST /api/admin/ops-step-uat/console-probe` | `{}` | 只通过既有 `console.info` 写一条普通探针文本，不写运维步骤；用于发现共享 stdout 被污染 |

每次跑次先调用关闭态负向检查，再开启挡板。01–08 结束后关闭挡板并恢复后台诊断。reset 前先暂停周期诊断并等待当前采集、独立观察采集与文件队列空闲；只清步骤内存／文件，不改变业务配置、数据库、审计或生产诊断快照。

诊断模式均通过同一 `/diagnostic` 接口、真实 `collectDiagnosticIo` 父子进程和实际写者：

- `lifecycle=production`：缺省模式；仍由既有 snapshot service 的 5000 ms deadline 管理，调用前确认空闲。2000 ms 用于成功观察；10000 ms 用于验证真实 deadline 中止，不得改超时期待 leave。
- `lifecycle=isolated`：只在挡板开启时允许，用于管理台 120 秒观察及真实 1 小时保留边界。启动前必须已暂停后台诊断且无在途采集，否则返回 409；挡板持有独立 AbortController 和 `holdMs+10000 ms` 清理时限，不发布生产快照、不改变生产调度及 deadline；holdMs 最大 3700000。该模式只证明写者／读模型，不证明生产诊断可活过 5 秒。
- 独立模式的 1 小时场景使用 `holdMs=3700000`，在真实墙钟超过 3600000 ms、尚未释放时取证，随后等待自动释放及实际读取结束；清理失败须记 BLOCKED／FAIL，不用重启伪装修复。

IPC 顺序由真实父子进程自动化补证：人为延迟父进程 `enter` 确认，记录子进程读取本体开始标记，确认前不得开始；父进程即使标准输出写失败也要确认，且确认不得等待文件队列。不得只用 10 秒托住推断该顺序。

IPC 故障矩阵必须包含：一个分支已 leave、另一个等待确认或读取中时，分别断开 IPC、触发原 AbortSignal、终止子进程，以及 abort 与 close／迟到终态竞态。按当次 op_id 列出已 enter 集合和原终态集合；仅差集各补一条 fail=aborted，已终结分支不重复、未 enter 的 read_reload_state 不凭空补行。另用 digest 已返回而另一 Promise.all 分支仍未返回的证据证明 reload_state 没有提前开始。

## 3. 真实保存与重载夹具

1. 在 demo 数据库创建一次性表 `uat_ops_step_reload`，不含业务数据。
2. 通过 Lucy MCP Proxy 调用真实 `lucy_ops_connection_tables`，使用工具当次 `tools/list` 返回的 schema 做 preview→commit，不手写绕过工具合同的请求。
3. 选择一个 demo 连接，preview 读取当前 `enabledTables`；首次 commit 只把 `uat_ops_step_reload` 加入该集合，使用新的幂等键。此提交是 SC-05 唯一被测 `runtime_reload`。
4. 取证后再次 preview→commit，恢复精确的原 `enabledTables`，使用另一个幂等键。恢复操作不计入第一次操作的顺序断言。
5. 不得调用 `/api/admin/mcp-runtime/reload` 代替本夹具，不得用无效果、未进入 `executeGroup` 的 preview 或空提交冒充三段执行。
6. 单连接真实 UAT 只证明三段顺序。另用真实进程自动化构造两个 demo 连接的同组提交，断言每轮 `catalog_reload` 都有独立 enter／leave；行内无连接 ID，只能证明配对，不能证明定位到某条连接。
7. **启用表保存**：在真实前台浏览器对同一连接启用 `uat_ops_step_reload` 并保存，捕获实际请求必须为 `PUT /api/connections/:connId/enabled-tables`、`dryRun=false`。按时间窗取得唯一 `enabled_tables_save op_id`，验证五步后通过同一页面恢复原集合。
8. 启用表的真实进程自动化分别注入 Catalog、Policy 和 execution reload 失败：前两者写 `fail` 后继续既有后续步骤，后者抛出时不得进入 `execution_ack`。不得把 Ops MCP 的三段行当作本路由证据。
9. Catalog／Policy 分别覆盖原调用抛错与正常返回 ack=false；execution_ack 覆盖正常返回 executionRuntimeAck=false 及内部捕获异常后的 false。终态应为 fail，但原业务响应及继续路径不变。延迟真实异步写入／重载，确认返回前只有 enter；dry-run 请求不得产生步骤行。
   正常返回的失败须由真实原调用产生，例如缺少测试 Schema Manifest 导致 Catalog ack=false、真实策略编译问题、真实 canary 不通过；保存结构化返回值与既有响应对照，恢复相应夹具。不得手工改响应里的 ack 布尔值或预制步骤行代替。
10. 在双连接第二轮 catalog_reload 尚未返回时检查管理台，第一轮 leave 不能关闭第二轮 enter。启用表页面记录点击保存→反馈可见的时间，与同次 PUT API 耗时分列。

## 4. 准备表结构夹具

### 4.1 单表失败与哨兵

1. 在 demo 数据库创建 `uat_ops_step_sentinel`，让真实准备表结构列表读到它。
2. 前台浏览器选中该表后，再从 demo 数据库删除该表，保留页面中的真实过期选择，再执行读字段。
3. API 原句为 `表「uat_ops_step_sentinel」没有读到字段。`，HTTP 错误响应从 `detail.opsStepId` 取号；真实页面保持客户端汇总原句 `有 1 张表没有读到字段：表「uat_ops_step_sentinel」没有读到字段。`，错误区域另显同号。分别在连接页准备入口与接入向导第 2 步取证。
4. 哨兵已经真实进入表名和生成的匹配／字段 SQL。对当次全部步骤行检索哨兵，并额外检索 `SELECT`、`information_schema`，三者均不得出现。

### 4.2 跨请求批量失败

1. 第一轮创建 `uat_ops_step_batch_00` 至 `uat_ops_step_batch_50`，共 51 张空表，按编号升序选中；正常无 deferred 时按 50＋1 发两次请求，须保存实际请求体证明边界。
2. 浏览器选中 51 张表后，删除 `_00` 与 `_50`，再执行读字段。
3. 第一批 HTTP 200 部分失败从 `data.opsStepId` 取号；第二批只有 `_50`，按既有单表错误 HTTP 400 从 `detail.opsStepId` 取号。两个操作号不同，界面 `_00`、`_50` 各关联本请求，禁止把第二批改成 HTTP 200 凑绿。
4. 第二轮先重建已删除表，并新增 `_51`，重新让页面读到 52 张表、升序选中后再删 `_00` 与 `_50`。正常按 50＋2 发两次 HTTP 200 部分失败响应，分别从 data.opsStepId 取号；界面逐表不串号。
5. 两轮分别记录请求表集合、HTTP 状态、操作号取值路径和对应失败表，不记录 SQL 正文。若出现 deferred，须记录实际自适应请求序列；先补齐正常两批夹具再判边界通过，不关闭既有重试。

所有一次性表均在跑次末尾用 `DROP TABLE IF EXISTS` 清理，只允许在 demo 数据库执行。

## 5. 管理台状态造数

| 元素 | 真实造数方法 | 通过观察点 |
|---|---|---|
| E1 首访 | reset 后首次打开 `/admin/ops-steps` | 页头与主任务可识别 |
| E2 空 | reset 后、任何新操作前刷新 | 区内说明尚无步骤 |
| E3 加载 | 先有至少一行，再注入一次 2000 ms 管理读延迟并用返回的 token 刷新 | 已有行保留，加载状态可见；分别计时 |
| E4 错误 | 注入一次管理读错误并用返回的 token 刷新，然后再次刷新 | 区内错误可解释，重试后恢复 |
| E5 0 条 | 筛选 `ops_00000000000000000000000000000000`，再清除 | 无命中原因和清除路径可见 |
| E6 成功 | 同时保留独立生命周期托住中的诊断步骤和一个 holdMs=0 已结束同步段；诊断另造一支已 leave、另一支未终结；重启后再读历史孤立 enter | 按步骤实例分区；兄弟支 leave 不关闭进行中支；历史标签正确 |
| E7 部分 | 保持上述进行中操作，再执行至少 1001 次 `holdMs=0` 同步段，产生超过 2000 行；另在 07 复核文件丢行和残行隔离 | 截断、丢行及 historyResidual 原因可见，进行中仍可找到 |
| E8 主动作 | 检查页头及筛选区 | 刷新是唯一 primary |
| E9 决定信息 | 对当前、已结束及历史孤立 enter 逐项读字段 | 操作号、步骤名、步骤停留时长、结果、原因码可见；历史为上次进程未完成且时长未知，不随当前进程计时 |

## 6. 持久化、滚动与故障

- **重启历史**：使用 lifecycle=isolated 托住真实步骤，等文件队列确认该 enter 已追加，再强制终止 demo 服务进程并恢复；不得用会先运行 abort 归集的正常 SIGTERM 制造假孤立 enter。只用于 SC-14；旧操作号显示上次进程未完成、时长未知，不进入当前进行中、不补 fail；同时验证正常中止写出的 aborted 不被误标孤立。
- **文件残行恢复**：用真实文件写者制造一次部分写入并强制崩溃，保留未以换行结尾的当前文件。重启时必须先把它轮转为 `.1`、置 `historyResidual=true`，再创建新当前文件；随后真实操作产生的新行必须独立合法可读。残行属于上一进程历史缺口，不伪计当前 fileDroppedCount；隔离失败则禁止接写并记 BLOCKED／FAIL。不得用 stdout 短写冒充本文件用例。
- **8 MiB 滚动**：真实进程自动化连续执行 holdMs=0 的已登记同步段，累计实际写入超过 16 MiB、至少触发两次 8 MiB 轮转；不得直接预写伪 JSON。两次轮转后仅有当前文件和一份滚动文件，各不超过 8 MiB，可读完整行均为合法 JSON。
- **文件不可写**：先排空文件队列并记录实际服务 PID、UID/GID、文件及目录的属主／权限。只 chmod 目录不算追加失败：既存文件仍可能可写，已打开描述符也可能继续写。由 root 对实际文件撤销服务 UID 写权限并验证写者每次重新打开；若写者保留已打开句柄，须在隔离真实进程中先设置不可写文件再启动实际写者，或构造真实只读挂载。必须看到实际追加调用的 EACCES／EROFS 等失败并确认文件未增长，再断言计数。恢复原权限／挂载后以服务 UID 真实追加成功，确认 fileWritable=ok；无法构造则 BLOCKED，不用 mock 判绿。
- **标准输出故障**：分别武装一次 `error` 和 `short`，各跑一次真实同步段。记录操作完成、内存与文件行、标准输出丢行计数及写调用次数；写调用次数必须为一次，证明没有重试。短写后再产生一条真实步骤，后续步骤行必须被抑制并另计丢行，容器日志不得把残行与后续文本拼成有效 JSON；普通日志不受该抑制控制。
- **真实 stdout 背压**：在 Linux 独立真实进程中加载实际步骤写者，以真实管道承接 stdout，独立监督进程填满管道并暂停排水，再触发真实步骤及父子 enter 确认。用独立可读控制通道和单调时钟测量，每次实际写尝试及 enter 确认均在 100 ms 内完成、至多一次写调用；内存继续登记，stdoutDroppedCount 精确增加，文件仍可追加。不是在调用写机制前直接返回预制错误。恢复排水后普通 console 和既有日志仍可写；不能把监督进程的超时杀死判成原操作完成。
- **共享 stdout 对照**：R0、普通运行和故障后读取 `/proc/<WebUI服务PID>/fdinfo/1`，自动化在同一被测进程检查 duplicate；不得读取 docker exec 命令自身的 `/proc/self` 冒充服务标志。标志不变，普通 console 探针出现，日志无新增 EAGAIN；只读 MCP 问数的调用流水正常增加。满管道期间不要求原本阻塞的普通日志也满足 100 ms，先解除背压再做普通日志对照。
- **文件消费者阻塞**：真实进程自动化暂停实际文件队列消费者，持续经真实步骤写者产生超过 1 MiB 的待写行，观察含正在写行的队列占用不越界；新行逐条计 fileDroppedCount、fileWriteReason=queue_full，本体及 IPC 确认继续，恢复消费者后 FIFO 无重复、实际成功追加恢复 ok。不得用缩小容量代替。
- **1 小时边界**：使用 isolated 模式保持一支真实步骤未终结，并产生一条真实已结束历史；记录墙钟起止及步骤进入时刻，实际跨越 1 小时且在释放前检查 history 的 age_limit 与该 inFlight 仍在。再等自然释放并验证恰好一个终态。可与其他用例并行等待；不得使用假时钟、修改行时间戳或缩短窗口冒充。

## 7. 日志与审计水位

- 每个用例开始前记录 `docker logs` 游标或起始时间；所有断言先按 `op_id` 过滤，再判断阶段。
- 审计记录在响应之后异步收尾（mcp-proxy.ts 的 recordAudit）。起止水位前均通过既有 GET /api/admin/audit/status 确认 writeHealth.pendingWrites=0，保存 failedWrites 起止值且不增长，再做混入检查；不修改健康计数。未排空或写失败时不得用暂时空结果判绿，记 BLOCKED／FAIL。成功问数须保存唯一 JSON-RPC 请求 ID，并以真实 rpc_request_id／trace_id 对应新增流水及 span，不用全局行数增长代替。
- 先只读核实真实 schema：access_log.id 为递增水位；access_trace_span.span_id 为 TEXT，不得取 MAX(span_id) 当时间水位。每个操作分别记录开始与结束 access_log.id，按 (start, end] 取父调用，再用 access_log_id 取对应 span；另对完整审计两表检索精确当次 op_id，防止误挂旧父调用。记录实际查询和全部被检索文本／JSON 列，不能只查某个关联键。
- 审计证据表分别列 diagnostic_collect、runtime_reload、enabled_tables_save、schema_structure_read、sync_section，各含 op_id、日志游标、开始／结束水位、正常审计和混入检查。重建 demo 进程后仍重新取水位，不能沿用重置前的上下文。
- 按实际 schema 检查 access_log.event_type、真实存在的 access_trace_span.stage 及 attrs_json 等 JSON 属性内 producer／span_kind；不存在的列标“不适用，未作为阴性证据”，不得直接查询不存在列或空结果凑绿。明确 ops_step_journal 标识与当次 op_id 均不得混入，特别断言 stage != ops_step_journal；其他正常同名 stage 本身不构成混入证据。
- `lucy_ops_connection_tables` 和成功问数自身产生的正常调用流水允许存在；既有正常审计若使用 `catalog_reload` 等同名阶段，不得仅凭名称判失败，须用操作号和生产者标识区分。
- SC-12 的证据必须同时列出“正常审计仍在”和“步骤账未混入”两类结果。
- 审计查询只读，可使用现有查询接口或容器内 SQLite 只读连接；不得修改审计库。

凭据不写入本文件。管理台登录用 demo 既有管理员，MCP 使用 demo 既有只读 Token；运维提交使用已有 `lucy_ops_connection_tables` 权限的 demo 身份。
