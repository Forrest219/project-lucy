# 运维问数连接 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 运维问数连接 Spec (Ops Evidence Connection Spec) |
| 文档类型 | Product / Data / ACL Spec |
| Spec 编号 | 149 |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-24 |
| 委托人 | xingchen |
| 状态 | Draft / Ready for Review |
| 输出位置 | `webui/docs/149-ops-evidence-connection-spec.md` |
| 关联 WO | `webui/docs/plans/wo-202609-25-ops-evidence-connection.md` |
| 上游 Spec / 事实源 | Spec 07（审计热库与 ACL）、Spec 125（生成 SQL）、Spec 127（删除连接不触碰物理库）、Spec 131（`lucy_admin` 与 `catalog_bound`）、Spec 143（调用监控口径与 `PROTOCOL_TOOLS`） |
| 关联术语 | `webui/docs/00-product-terminology-standard.md` §4.7 |
| 冲突裁决 | 与 Spec 131 冲突时，`lucy_admin` 仍不得自动获得本连接；与 Spec 62 冲突时，仍不得新建第二套审计库 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Ops Evidence Connection | 运维问数连接 | 连接 ID `lucy-ops` | 管理员连接、默认业务连接、审计库连接（作卡片主称） | 指向审计热库只读视图的系统连接 |
| Ops Evidence Role | 运维问数角色 | `lucy_ops_reader` | Lucy 运维数据面角色、WebUI 所有者、登录管理员 | 只授权本连接两张视图的 MCP Role 模板；与 `lucy_admin` 正交 |

Protected DOM：`lucy-ops`、`lucy_ops_reader`、`ops_calls`、`ops_call_tables`、`generated_sql`、`request_id`、Agent id、tool name、physical table。

既有术语沿用，不另造译名：**调用流水**、**生成 SQL**、**裁决原因**、**涉及数据表**、**Agent**、**只读**、**连接 ID**、**参考模板**。

---

## 1. 背景与问题

访问日志可以按工具、结果、表名筛出单条调用流水，并导出生成 SQL。调用监控回答近 24 小时 / 近 1 小时的吞吐、错误率、拒绝率和 Top 工具。

固定筛选项覆盖不了开放聚合，例如：

1. 这周谁在某张表上被拒绝，生成 SQL 是什么。
2. 某个工具的失败是不是集中在一个 Agent。

本 Spec 用审计热库上的稳定只读视图，加一条系统连接，让已授权的运维 Agent 用现有 `lucy_query` 追问。不新开 SQL 执行口，不新做页面，不把审计库变成客户业务连接。

## 2. Goals

1. 启动后幂等存在连接 `lucy-ops`：`driver: sqlite`、`readonly: true`，数据库文件为当前审计热库。
2. 热库内两张视图 `ops_calls`、`ops_call_tables` 回答上述两类问题，且列允许集不含 Token 哈希、客户端 IP、User-Agent、设备名、权限快照、`args_summary`、问询原文。
3. 视图排除协议工具，并排除对本连接自身的追问，避免拒绝次数和失败次数被运维问数抬高。
4. 只有绑定参考模板 `lucy_ops_reader` 的 Agent 能在目录中看到并查询该连接。
5. 不写入 `setup.database_connection_ids`，不自动创建 Agent 或 Token，不并入 `lucy_admin`。
6. 删除连接 API 拒绝 `lucy-ops`，审计库文件保持不动。

## 3. Non-goals

- 不暴露 `.ktx/db.sqlite` 与 `.ktx-ui/eval/runs.sqlite`。
- 不新建第二套审计库，不把视图迁到独立文件。
- 不开放 `sql_execution` 或任何绕过语义层的原始 SQL 工具。
- 不把问询原文、鉴权失败表、配置审计表放进视图。
- 不改 `/admin/audit`、`/admin/usage`、`/ops/calls` 的页面与口径。
- 不把口径写进 `webui/config/data-qa-instructions.md`，不把说明放进全局 Wiki。
- 不做多实例日志聚合、对象存储归档、告警通道。
- 不自动把 `lucy-ops` 加入任何已有业务 Role 或 `lucy_admin`。

## 4. 产品形状

```text
audit.sqlite
  ops_calls / ops_call_tables
       │
       ▼
ktx.yaml connections.lucy-ops（readonly，不进 database_connection_ids）
       │
       ▼
semantic-layer/lucy-ops
       ▲
lucy_ops_reader ── 运维 Agent Token（人工绑定，启动时不创建）
```

| 对象 | 标识 | 谁能看见 |
|---|---|---|
| 运维问数连接 | `lucy-ops` | 已登录 WebUI 运维，在连接概览看到卡片 |
| 运维问数角色 | `lucy_ops_reader` | 参考模板；正式 Role 由运维从模板创建并绑定 Agent |
| 问数入口 | 现有 `lucy_query` | 仅该 Role 的 Agent |

连接概览卡片主称 **运维问数连接**。连接 ID `lucy-ops` 用 `translate="no"`。引擎仍显示 SQLite。

## 5. 数据契约

### 5.1 事实源

- 文件：`LUCY_AUDIT_DB`，缺省 `<projectRoot>/.ktx-ui/audit.sqlite`。
- 写入方仍是现有 `webui/server/proxy/audit.ts`。视图在 `prepareTraceDatabase` 已设置 WAL 与 `busy_timeout` 之后创建。
- 基表：`access_log`、`access_log_sources`。
- 协议工具与 Spec 143 / `PROTOCOL_TOOLS` 相同：`tools/list`、`initialize`、`notifications/initialized`。

### 5.2 视图

Schema 假定为 SQLite `main`。物理名在工单第一步探测后冻结；探测若证明 KTX 目录不带 schema 前缀，则 `enabled_tables`、Manifest `table:` 与 Role `schema` 一起改成探测结果，视图列不变。

在冻结前，规范默认：

| 视图 | 粒度 | `enabled_tables` 默认值 |
|---|---|---|
| `ops_calls` | 一次业务 MCP 调用 | `main.ops_calls` |
| `ops_call_tables` | 一次调用 × 一张物理表 | `main.ops_call_tables` |

`ops_calls` 列允许集：

| 列 | 来源 | 问数用途 |
|---|---|---|
| `event_id` | `access_log.id` | 与访问日志事件 ID 对照 |
| `ts` | `access_log.ts` | 时间 |
| `agent_id` | `access_log.user_id` | Agent |
| `token_label` | `access_log.token_label` | 同一 Agent 下的 Token 标签；不含哈希 |
| `tool` | `access_log.tool` | 工具 |
| `outcome` | `access_log.outcome` | `ok` / `error` / `denied` |
| `duration_ms` | `access_log.duration_ms` | 单次工具调用耗时 |
| `decision_reason` | `access_log.decision_reason` | 裁决原因码 |
| `error_detail` | `access_log.error_detail` | 已截断的失败说明 |
| `generated_sql` | `access_log.generated_sql` | 生成 SQL |
| `tables_json` | `access_log.tables` | 涉及表 JSON |
| `request_id` | `access_log.request_id` | 与调用流水对照 |

`ops_call_tables` 在上述列上增加 `connection_id`、`schema_name`、`source_name`、`physical_table`（来自 `access_log_sources`），去掉 `tables_json`。

禁止出现在任一视图 SELECT 列表中的列：`token_hash`、`token_hash_prefix`、`client_ip`、`user_agent`、`device_name`、`permission_snapshot_hash`、`args_summary`、`query_preview`、`roles_json`、`resolved_json`，以及 `conversation_turns`、`auth_failure_log`、`config_change_log`、`revoked_tokens`、`permission_snapshots` 的任何列。

### 5.3 行排除

两张视图都排除：

1. `tool` 属于 `PROTOCOL_TOOLS`。
2. `access_log_sources.connection_id = 'lucy-ops'`。
3. `physical_table` 为 `main.ops_calls`、`main.ops_call_tables`、`ops_calls`、`ops_call_tables` 之一。

`ops_calls` 用 `NOT EXISTS` 套用第 2、3 条，避免一次追问因多行 source 被拆成多行。`ops_call_tables` 在 JOIN 后直接过滤。

生成 SQL 只因本 Role 可见而保留。业务 Agent 的 `allow.connections` 不含 `lucy-ops` 时，目录与 `lucy_query` 都到不了这些列。

### 5.4 语义层

模板目录：`webui/config/ops-evidence/semantic-layer/lucy-ops/`。

项目内目标：`<projectRoot>/semantic-layer/lucy-ops/`。文件已存在则不覆盖。

两份 source：

| source | 物理对象 | 指标 | 维度 |
|---|---|---|---|
| `ops_calls` | 冻结后的 `ops_calls` 物理名 | `call_count`、`denied_count`、`error_count`、`total_duration_ms` | `agent_id`、`token_label`、`tool`、`outcome`、`call_day`（`date(ts)`）、`generated_sql`、`decision_reason`、`request_id` |
| `ops_call_tables` | 冻结后的 `ops_call_tables` 物理名 | 同上 | 上表维度加 `physical_table`、`connection_id`、`schema_name`、`source_name` |

指标表达式：

- `call_count` = `count(*)`
- `denied_count` = `sum(case when outcome = 'denied' then 1 else 0 end)`
- `error_count` = `sum(case when outcome = 'error' then 1 else 0 end)`
- `total_duration_ms` = `sum(duration_ms)`

时间表达式使用 SQLite `date(ts)`，不使用 MySQL `YEAR()`。

source 描述用中文写明：统计已排除对本连接的追问；生成 SQL 是高基数属性，用于「被拒绝时的 SQL」这类过滤后明细，不作为默认分组。描述不写入全局 data-qa instructions，不写入 `wiki/global`。

## 6. 权限

参考模板 id：`lucy_ops_reader`。注册在 `webui/server/admin/role-templates.ts`，出现在 `GET /api/admin/roles?includeTemplates=true`。

```yaml
lucy_ops_reader:
  description: 运维问数（非 WebUI 登录账户）：只读查询调用流水与按表调用事实。
  permission_model_version: 2
  allow:
    connections:
      - lucy-ops
    tableSelectors:
      - connection: lucy-ops
        schema: main
        names:
          - ops_calls
          - ops_call_tables
        row_access: all
    tools:
      - lucy_catalog
      - lucy_query
      - lucy_read_source
      - lucy_explain_query
      - lucy_begin_question
      - connection_list
```

约束：

- 禁止 `source_scope: catalog_bound`。审计库日后新增内部表不得经本 Role 自动进入能力集。
- 禁止并入 `lucy_admin` 的 `allow.connections` 或工具模板。
- 启动确保逻辑不创建、不修改 `access.yaml` 的 users / tokens。
- 业务 Role 未声明 `lucy-ops` 时，沿用 Spec 07 / Spec 98：`connection_list`、`lucy_catalog` 过滤该连接，`lucy_query` 拒绝。
- `schema` 若被探测结果改写，模板与正式 Role 示例同步改写。`names` 保持 source 名 `ops_calls`、`ops_call_tables`。

从模板创建正式 Role、以及把 Agent 绑到该 Role 时，沿用 Spec 131 的高权限警示模式，文案为「运维问数角色可查看生成 SQL」，不得写成 WebUI 所有者或登录管理员。

## 7. 连接配置

确保写入的块（`database` 为审计库绝对路径）：

```yaml
connections:
  lucy-ops:
    driver: sqlite
    readonly: true
    database: /abs/path/.ktx-ui/audit.sqlite
    schemas:
      - main
    enabled_tables:
      - main.ops_calls
      - main.ops_call_tables
```

禁止调用 `createConnection`（`webui/server/project.ts`）。该函数会把新 ID 追加到 `setup.database_connection_ids`。本连接使用专用补丁：只在 `connections.lucy-ops` 缺失时插入，不改其他连接，不改 `database_connection_ids`。

不一致定义：已存在的 `lucy-ops` 其 `driver` 不是 `sqlite`，或 `database` 不是当前审计库绝对路径，或 `readonly` 不是 `true`。此时不覆盖，打一条启动警告，内容含连接 ID 与「运维问数连接配置不一致，未改写」。

## 8. 核心流程（伪代码）

```text
ensureOpsEvidence():
  db = openAuditDatabase()          # 已 WAL + busy_timeout
  createOrReplaceView("ops_calls", OPS_CALLS_SQL)
  createOrReplaceView("ops_call_tables", OPS_CALL_TABLES_SQL)
  assert select-list excludes forbidden columns

  yaml = read ktx.yaml
  if yaml.connections["lucy-ops"] is absent:
    insert OPS_CONNECTION_BLOCK
    do not touch setup.database_connection_ids
    do not touch other connections
  else if block mismatches driver or database path or readonly:
    log warning
    leave yaml unchanged
  else:
    leave yaml unchanged

  for each template file under webui/config/ops-evidence/semantic-layer/lucy-ops/:
    dest = projectRoot/semantic-layer/lucy-ops/<file>
    if dest is absent:
      copy template
    else:
      leave dest unchanged

  do not write access.yaml users or tokens

removeConnection(connId):
  if connId == "lucy-ops":
    fail 400 OPS_EVIDENCE_CONNECTION_PROTECTED
    message = "运维问数连接不能删除"
    do not delete audit.sqlite
    do not delete semantic-layer/lucy-ops
  else:
    existing Spec 127 path
```

视图 SQL（探测前的规范文本；物理排除列表含带前缀与不带前缀两种写法，避免探测完成前漏行）：

```sql
CREATE VIEW ops_calls AS
SELECT
  id AS event_id,
  ts,
  user_id AS agent_id,
  token_label,
  tool,
  outcome,
  duration_ms,
  decision_reason,
  error_detail,
  generated_sql,
  tables AS tables_json,
  request_id
FROM access_log
WHERE tool NOT IN ('tools/list', 'initialize', 'notifications/initialized')
  AND NOT EXISTS (
    SELECT 1 FROM access_log_sources AS s
    WHERE s.access_log_id = access_log.id
      AND (
        s.connection_id = 'lucy-ops'
        OR s.physical_table IN (
          'main.ops_calls', 'main.ops_call_tables',
          'ops_calls', 'ops_call_tables'
        )
      )
  );

CREATE VIEW ops_call_tables AS
SELECT
  access_log.id AS event_id,
  access_log.ts,
  access_log.user_id AS agent_id,
  access_log.token_label,
  access_log.tool,
  access_log.outcome,
  access_log.duration_ms,
  access_log.decision_reason,
  access_log.error_detail,
  access_log.generated_sql,
  access_log.request_id,
  s.connection_id,
  s.schema_name,
  s.source_name,
  s.physical_table
FROM access_log
JOIN access_log_sources AS s ON s.access_log_id = access_log.id
WHERE access_log.tool NOT IN ('tools/list', 'initialize', 'notifications/initialized')
  AND COALESCE(s.connection_id, '') <> 'lucy-ops'
  AND s.physical_table NOT IN (
    'main.ops_calls', 'main.ops_call_tables',
    'ops_calls', 'ops_call_tables'
  );
```

实现使用 `CREATE VIEW IF NOT EXISTS` 做首次创建；视图 SQL 变更时用版本注释或 `DROP VIEW` 后重建，仍不得改基表数据。测试使用临时审计库，禁止打开仓库或运行中的 `.ktx-ui/audit.sqlite`。

删除接口：`POST /api/connections/lucy-ops/remove` 在 dryRun 与确认写入时都返回 HTTP 400，`code = OPS_EVIDENCE_CONNECTION_PROTECTED`，`message = 运维问数连接不能删除`。不写 `config_change_log`。

## 9. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-01 | 业务 Role 的 `allow.connections` 不含 `lucy-ops` | `connection_list` / `lucy_catalog` 无该连接；`lucy_query` 访问 `ops_calls` 被拒绝 |
| SC-02 | Agent 绑定 `lucy_ops_reader` | 能按物理表汇总近 7 天 `outcome=denied` 的 Agent，并取到 `generated_sql` |
| SC-03 | 同上 | 能按工具汇总 `outcome=error` 的 Agent，看出失败是否集中 |
| SC-04 | 连续两次查询近 7 天 `denied_count` | 第二次结果不包含第一次对本连接的追问 |
| SC-05 | 确保逻辑跑完 | `ktx.yaml` 中 `lucy-ops.readonly=true`，且 `setup.database_connection_ids` 不含 `lucy-ops` |
| SC-06 | 检查两张视图的 SELECT 列表 | 不含 Token 哈希、`client_ip`、`user_agent`、`device_name`、权限快照、`args_summary` |
| SC-07 | `POST /api/connections/lucy-ops/remove` | HTTP 400，`OPS_EVIDENCE_CONNECTION_PROTECTED`；审计库文件仍在；语义 YAML 仍在 |
| SC-08 | 已有 `lucy-ops` 但 `database` 指向别的文件 | 启动不覆盖，有警告；原块保留 |
| SC-09 | 项目里已有同名语义 YAML | 确保逻辑不覆盖 |
| SC-10 | `lucy_admin` 模板与未手工加入 `lucy-ops` 的正式 Role | `allow.connections` 仍不含 `lucy-ops` |
| SC-11 | 启动前后 | 不新增 Agent、不新增 Token |

## 10. 实现落点

| 区域 | 文件 | 改动 |
|---|---|---|
| 视图 | `webui/server/proxy/audit.ts` | 幂等创建两张视图 |
| 连接确保 | `webui/server/project.ts` 旁的专用函数 | 插入 `lucy-ops`，不调用 `createConnection` |
| 启动 | WebUI 进程启动路径 | 调用 `ensureOpsEvidence` |
| 语义模板 | `webui/config/ops-evidence/semantic-layer/lucy-ops/` | 随仓库提交；缺失时复制 |
| 角色模板 | `webui/server/admin/role-templates.ts` | `lucy_ops_reader` |
| 删除保护 | `removeConnection` 与 `POST /api/connections/:connId/remove` | 拒绝 `lucy-ops` |
| 连接概览 | `webui/src/pages/connections/ConnectionOverview.tsx` | `lucy-ops` 卡片主称「运维问数连接」；隐藏或禁用删除 |
| 高权限警示 | Role 详情 / Agent 绑定 | 运维问数角色可查看生成 SQL |
| 测试 | `webui/server/__tests__/` | 临时库；覆盖 SC-01 至 SC-11 中可单测的分支 |

UI 只改连接卡片称谓与删除入口。不新增导航、不新增页面。

## 11. 风险

KTX SQLite 目录的物理名可能是 `ops_calls` 而不是 `main.ops_calls`。工单第一步探测冻结字符串之前，不把默认值写死进客户 `enabled_tables` 的最终断言。视图列契约不依赖该字符串。

审计库由 WebUI 写入、由 KTX 只读打开。连接块必须 `readonly: true`。视图创建发生在本进程已持有的连接上，不另开读写连接去改基表。
