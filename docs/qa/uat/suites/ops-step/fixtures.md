# Fixtures — UAT-SUITE-OPS-STEP

设计值，首跑前不是已测能力。容器名、连接 ID、端口和凭据路径以当次 demo 为准；不记录口令。

## 1. 环境与设计值

| 项 | 值 |
|---|---|
| 环境 | 本机 demo Docker。WebUI 与 MCP 端口用当次映射，默认宿主 55176 与 57881 |
| 浏览器 | 真实前台，1920×1080 |
| 挡板 | `LUCY_OPS_STEP_UAT=1` 时注册；未设置或为其他值时所有挡板路由 404 |
| 托住时长 | 10 秒；释放由挡板自动完成，不依赖重启 |
| 探针上限 | 托住期间存活与就绪均在 1 秒内返回 |
| 行长 | 紧凑 JSON 加末尾换行，总计不超过 512 UTF-8 字节 |
| 历史 | 管理台最多 2000 行或最近 1 小时，先到者为准 |
| 文件副本 | `${LUCY_CONTENT_ROOT}/.lucy/ops-steps.jsonl`；8 MiB；当前文件加 `ops-steps.jsonl.1`，共两份 |
| 口令／SQL 哨兵 | `uat_ops_step_sentinel`；作为真实表名输入，不是真实口令 |
| 问数 | demo 可见范围内的一次成功只读问数，不写客户库 |

## 2. 挡板接口

以下接口均需既有管理员鉴权，且只在挡板开启时存在。响应不得包含预制步骤行；`op_id` 必须来自真实写者。

| 接口 | 请求 | 用途 |
|---|---|---|
| `POST /api/admin/ops-step-uat/reset` | `{}` | 只清空步骤账内存与文件，不改业务配置、审计账或数据库 |
| `POST /api/admin/ops-step-uat/diagnostic` | `{ "steps": ["read_project", "read_ktx_yaml"], "holdMs": 10000 }` | 触发一次真实后台诊断，在指定支托住；202 返回本次 `op_id` |
| `POST /api/admin/ops-step-uat/sync-section` | `{ "holdMs": 10000 }` | 进入真实 `uat_sync_section` 包装器；202 返回 `op_id`；`holdMs=0` 用于快速产生真实步骤 |
| `POST /api/admin/ops-step-uat/background` | `{ "enabled": false }` | 只暂停／恢复测试期后台诊断，避免问数时间窗被无关步骤污染 |
| `POST /api/admin/ops-step-uat/stdout-failure` | `{ "mode": "error" }` 或 `{ "mode": "short" }` | 只对下一次标准输出写注入一次错误或短写；随后自动恢复 |
| `POST /api/admin/ops-step-uat/read-failure` | `{ "mode": "delay", "delayMs": 2000 }` 或 `{ "mode": "error" }` | 只对下一次管理列表读注入延迟或错误；用于 E3／E4 |

每次跑次先调用关闭态负向检查，再开启挡板。01–08 结束后关闭挡板并恢复后台诊断。

## 3. 真实重载夹具

1. 在 demo 数据库创建一次性表 `uat_ops_step_reload`，不含业务数据。
2. 通过 Lucy MCP Proxy 调用真实 `lucy_ops_connection_tables`，使用工具当次 `tools/list` 返回的 schema 做 preview→commit，不手写绕过工具合同的请求。
3. 选择一个 demo 连接，preview 读取当前 `enabledTables`；首次 commit 只把 `uat_ops_step_reload` 加入该集合，使用新的幂等键。此提交是 SC-05 唯一被测 `runtime_reload`。
4. 取证后再次 preview→commit，恢复精确的原 `enabledTables`，使用另一个幂等键。恢复操作不计入第一次操作的顺序断言。
5. 不得调用 `/api/admin/mcp-runtime/reload` 代替本夹具，不得用无效果、未进入 `executeGroup` 的 preview 或空提交冒充三段执行。

## 4. 准备表结构夹具

### 4.1 单表失败与哨兵

1. 在 demo 数据库创建 `uat_ops_step_sentinel`，让真实准备表结构列表读到它。
2. 前台浏览器选中该表后，再从 demo 数据库删除该表，保留页面中的真实过期选择，再执行读字段。
3. 原句应为 `表「uat_ops_step_sentinel」没有读到字段。`；错误响应从 `detail.opsStepId` 取操作号。
4. 哨兵已经真实进入表名和生成的匹配／字段 SQL。对当次全部步骤行检索哨兵，并额外检索 `SELECT`、`information_schema`，三者均不得出现。

### 4.2 跨请求批量失败

1. 创建 `uat_ops_step_batch_00` 至 `uat_ops_step_batch_50`，共 51 张空表，使真实客户端按既有 50 表边界发出两次请求。
2. 浏览器选中 51 张表后，删除 `_00` 与 `_50`，再执行读字段。
3. 两次 HTTP 200 部分失败响应各自从 `data.opsStepId` 取号；两个操作号必须不同，`_00` 与 `_50` 分别关联其所属请求的操作号。
4. 证据记录请求序号、操作号和对应表，不记录 SQL 正文。

所有一次性表均在跑次末尾用 `DROP TABLE IF EXISTS` 清理，只允许在 demo 数据库执行。

## 5. 管理台状态造数

| 元素 | 真实造数方法 | 通过观察点 |
|---|---|---|
| E1 首访 | reset 后首次打开 `/admin/ops-steps` | 页头与主任务可识别 |
| E2 空 | reset 后、任何新操作前刷新 | 区内说明尚无步骤 |
| E3 加载 | 先有至少一行，再注入一次 2000 ms 管理读延迟并刷新 | 已有行保留，加载状态可见；分别计时 |
| E4 错误 | 注入一次管理读错误并刷新，然后再次刷新 | 区内错误可解释，重试后恢复 |
| E5 0 条 | 筛选 `ops_00000000000000000000000000000000`，再清除 | 无命中原因和清除路径可见 |
| E6 成功 | 同时保留一个托住中的诊断操作和一个 `holdMs=0` 的已结束同步段 | 进行中与已结束分区及操作号正确 |
| E7 部分 | 保持上述进行中操作，再执行至少 1001 次 `holdMs=0` 同步段，产生超过 2000 行；另在 07 复核文件丢行 | 截断原因可见，进行中仍可找到；文件丢行按通道显示 |
| E8 主动作 | 检查页头及筛选区 | 刷新是唯一 primary |
| E9 决定信息 | 对当前与已结束行逐项读字段 | 操作号、步骤名、停留时长、结果、原因码可见 |

## 6. 持久化、滚动与故障

- **重启历史**：托住一个真实步骤并确认 `enter` 后终止 demo 容器，再按既有启动方式恢复。重启只用于 SC-14；旧操作号必须显示“上次进程未完成”，不得进入当前进行中。
- **8 MiB 滚动**：真实进程自动化连续执行 `holdMs=0` 的已登记同步段，直至实际写入超过 8 MiB；不得直接预写伪 JSON。断言只有当前文件和一份滚动文件，且当前可读行均为合法 JSON。
- **文件不可写**：记录步骤目录原权限，用 `docker exec --user root` 将目录改为只读；完成断言后恢复原权限，再跑一次真实步骤确认 `fileWritable=ok`。若容器不支持该故障构造，记 BLOCKED，不得用 mock 判绿。
- **标准输出故障**：分别武装一次 `error` 和 `short`，各跑一次真实同步段。记录操作完成、内存与文件行、标准输出丢行计数及写调用次数；写调用次数必须为一次，证明没有重试。

## 7. 日志与审计水位

- 每个用例开始前记录 `docker logs` 游标或起始时间；所有断言先按 `op_id` 过滤，再判断阶段。
- 01–05 开始前分别记录 `access_log` 最大 ID 与 `access_trace_span` 最大行号／ID。06 汇总检查这些区间：不得出现当次运维 `op_id`，不得出现 `producer`／`event_type`／`span_kind=ops_step_journal` 的行。
- `lucy_ops_connection_tables` 和成功问数自身产生的正常调用流水允许存在；既有正常审计若使用 `catalog_reload` 等同名阶段，不得仅凭名称判失败，须用操作号和生产者标识区分。
- SC-12 的证据必须同时列出“正常审计仍在”和“步骤账未混入”两类结果。
- 审计查询只读，可使用现有查询接口或容器内 SQLite 只读连接；不得修改审计库。

凭据不写入本文件。管理台登录用 demo 既有管理员，MCP 使用 demo 既有只读 Token；运维提交使用已有 `lucy_ops_connection_tables` 权限的 demo 身份。
