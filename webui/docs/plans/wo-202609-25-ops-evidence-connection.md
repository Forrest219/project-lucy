# WO-202609-25 — 运维问数连接

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-25 运维问数连接 |
| 文档类型 | Work Order |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-24 |
| 撰写人 | Cursor Agent |
| 委托人 | xingchen |
| 基于材料 | Spec 149 |
| 适用范围 | 审计库只读视图、`lucy-ops` 连接确保、语义层模板、`lucy_ops_reader`、删除保护与单测 |
| 输出位置 | `webui/docs/plans/wo-202609-25-ops-evidence-connection.md` |

---

## Goal

交付 Spec 149：管理员用绑定 `lucy_ops_reader` 的 Agent，通过只读连接 `lucy-ops` 追问调用记录。回答「这周谁在某张表上被拒绝、生成 SQL 是什么」和「某个工具的失败是不是集中在一个 Agent」。

本工单不改访问日志、使用概况、调用监控页面，不把连接写入 `setup.database_connection_ids`。

## Code paths

| 区域 | 文件 | 改动 |
|---|---|---|
| 视图 | `webui/server/proxy/audit.ts` | `ops_calls`、`ops_call_tables` |
| 连接确保 | 新建专用模块，由 WebUI 启动调用 | 只插入缺失的 `connections.lucy-ops` |
| 语义模板 | `webui/config/ops-evidence/semantic-layer/lucy-ops/` | 仓库内模板；缺失时复制到项目 |
| 角色模板 | `webui/server/admin/role-templates.ts` | `lucy_ops_reader` |
| 删除 | `webui/server/project.ts` 的 `removeConnection`；`webui/server/index.ts` 路由 | `OPS_EVIDENCE_CONNECTION_PROTECTED` |
| 连接概览 | `webui/src/pages/connections/ConnectionOverview.tsx` | 主称「运维问数连接」；删除入口不可用 |
| 警示 | Role 详情 / Agent 绑定（Spec 131 同一处） | 「运维问数角色可查看生成 SQL」 |
| 测试 | `webui/server/__tests__/`、连接概览测试 | 临时审计库 |

禁止复用 `createConnection`。该函数会把 ID 追加进 `setup.database_connection_ids`。

## 任务

### T0 — 冻结物理名

对临时 SQLite 执行 Spec 149 §8 的两条 `CREATE VIEW`，再跑 KTX 对该文件的目录列出（`ktx connection test` / catalog list，以当前 CLI 为准）。

记录视图在目录中的物理名。只允许两种结果：

- `main.ops_calls` 与 `main.ops_call_tables`
- `ops_calls` 与 `ops_call_tables`

把结果写进 Spec 149 §5.2 的「冻结」一句，并让后续 `enabled_tables`、Manifest `table:`、Role `schema` 使用同一套字符串。视图 SELECT 列表不随探测结果改变。

未冻结前不提交连接确保的最终断言。

### T1 — 审计库视图

在 `prepareTraceDatabase` 之后、现有迁移完成之后，幂等创建两张视图。SQL 以 Spec 149 §8 为准。

SELECT 列表必须与 §5.2 允许集一致。测试解析视图 SQL，断言不含 `token_hash`、`token_hash_prefix`、`client_ip`、`user_agent`、`device_name`、`permission_snapshot_hash`、`args_summary`。

自排除：插入一行 `access_log` 及其 `access_log_sources`（`connection_id=lucy-ops`），再 `SELECT denied` 相关行，该行不出现。协议工具行也不出现。

测试库用 `LUCY_AUDIT_DB` 指向临时文件。禁止打开真实 `.ktx-ui/audit.sqlite`。

### T2 — 专用连接确保

新函数 `ensureOpsEvidenceConnection`：

1. `connections.lucy-ops` 缺失：写入 Spec 149 §7 的块。`database` 为当前审计库绝对路径。`readonly: true`。`enabled_tables` 使用 T0 冻结值。
2. 不修改 `setup.database_connection_ids`。
3. 不修改其他连接。
4. 已存在且 driver、路径、`readonly` 一致：不改文件。
5. 已存在但不一致：不覆盖，返回警告「运维问数连接配置不一致，未改写」。

WebUI 启动时调用：先 T1 视图，再本函数，再 T3 语义复制。

单测用临时项目根，断言 YAML 往返后 `database_connection_ids` 仍不含 `lucy-ops`。

### T3 — 语义层模板

按 Spec 149 §5.4 提交：

- `webui/config/ops-evidence/semantic-layer/lucy-ops/_schema/main.yaml`（schema 文件名随 T0 冻结结果）
- `ops_calls.yaml`
- `ops_call_tables.yaml`

指标：`call_count`、`denied_count`、`error_count`、`total_duration_ms`。`call_day` 使用 SQLite `date(ts)`。

确保逻辑：目标文件缺失则复制；已存在则跳过。单测覆盖这两种分支。

描述写在 source 上。不改 `webui/config/data-qa-instructions.md`，不新增 `wiki/global` 文档。

### T4 — 角色模板

在 `ROLE_TEMPLATES` 增加 `lucy_ops_reader`，YAML 形状见 Spec 149 §6。`schema` 随 T0。

断言：

- `GET /api/admin/roles?includeTemplates=true` 含该 id，`source=template`。
- 模板无 `source_scope`。
- `lucy_admin` 模板的 `connections` 仍为空或不含 `lucy-ops`。
- 编译后的能力只含 `ops_calls` 与 `ops_call_tables`。
- 未授权 Agent 查询该连接被拒绝（沿用现有 proxy ACL 测试夹具）。

Role 详情与 Agent 绑定展示「运维问数角色可查看生成 SQL」。文案不得含「所有者」「登录管理员」「超管」。

不在 demo `access.yaml` 预置 Agent 或 Token。

### T5 — 删除保护与连接卡片

`removeConnection('lucy-ops')` 在 dryRun 与写入时抛出可映射为 HTTP 400 的错误：

- `code`: `OPS_EVIDENCE_CONNECTION_PROTECTED`
- `message`: `运维问数连接不能删除`

不写 `config_change_log`，不删审计库，不删 `semantic-layer/lucy-ops`。

`ConnectionOverview`：`id === lucy-ops` 时卡片标题为「运维问数连接」，连接 ID 节点 `translate="no"`。删除入口对该卡片不可用。

### T6 — 测试矩阵

| ID | 场景 | 期望 |
|---|---|---|
| T6-1 | 未授权 Role | 目录无 `lucy-ops`；查询拒绝（SC-01） |
| T6-2 | `lucy_ops_reader` 对临时库中的拒绝行与错误行 | 能按表取出 Agent + `generated_sql`；能按工具聚合错误（SC-02、SC-03） |
| T6-3 | 视图含一条 `connection_id=lucy-ops` 的拒绝 | 聚合不计该行（SC-04） |
| T6-4 | 确保连接 | `readonly: true` 且 `database_connection_ids` 不含 `lucy-ops`（SC-05） |
| T6-5 | 视图 SQL | 禁止列不在 SELECT 列表（SC-06） |
| T6-6 | 删除 `lucy-ops` | 400 + `OPS_EVIDENCE_CONNECTION_PROTECTED`；文件仍在（SC-07） |
| T6-7 | 错误路径的既有 `lucy-ops` | 不覆盖，有警告（SC-08） |
| T6-8 | 语义文件已存在 | 字节不变（SC-09） |
| T6-9 | `lucy_admin` 模板 | 不含 `lucy-ops`（SC-10） |
| T6-10 | 确保前后的 `access.yaml` | 无新 user / token（SC-11） |

`cd webui && npm run lint:terminology` 覆盖新增文案。

## Rollback

- 去掉启动调用后，已写入的 `connections.lucy-ops` 保留但不再被确保逻辑修回；删除保护一并移除后，该连接可按 Spec 127 从 `ktx.yaml` 卸载，仍不得删除审计库文件。
- 视图可 `DROP VIEW`，不 `DROP` 基表。
- 删除 `lucy_ops_reader` 模板。已落成正式 Role 的客户配置在模板删除后仍可编译，直到运维自行移除该 Role。

## Out of scope

- `.ktx/db.sqlite`、评测库、问询原文、鉴权失败、配置审计。
- 调用监控 / 访问日志 / 使用概况改版。
- 全局 data-qa instructions 与全局 Wiki。
- 自动签发运维 Token。
