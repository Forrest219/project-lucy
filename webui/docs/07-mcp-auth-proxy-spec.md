# MCP Auth Proxy — 访问日志与多用户权限 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Auth Proxy — 访问日志与多用户权限 Spec |
| 文档类型 | Spec |
| 版本 | v1.5（SSE 缓冲改写：多帧时必须选 JSON-RPC response 帧；通用 tools/call 有限 SSE 归一化为 JSON） |
| 撰写日期 | 2026-06-18；v1.2 修订 2026-06-21；v1.3 修订 2026-06-23；v1.4 修订 2026-08-11；v1.5 修订 2026-08-20 |
| 撰写人 | Claude (Opus 架构设计)；v1.5 Cursor Agent |
| 委托人 | 张星晨 |
| 基于材料 | project-lucy 代码库、KTX 上游源码（/Users/zhangxingchen/Projects/ktx）、Opus 架构分析 |
| 适用范围 | project-lucy webui/server/ 新增 MCP Auth Proxy，不修改 KTX 上游 |
| 输出位置 | /Users/zhangxingchen/Projects/project-lucy/webui/docs/07-mcp-auth-proxy-spec.md |

---

## 1. 问题陈述

project-lucy 以 KTX HTTP MCP server（`localhost:7878/mcp`）暴露数据问答工具。当前状态：

- 所有客户端（张三的 Hermes、李四的 Cursor）共享同一个全局 Bearer token
- `userId` 在 KTX 源码中硬编码为 `'local'`，无多用户感知
- 没有访问记录，无法追溯谁查了什么表
- 无法做表级权限隔离（张三能看的表 ≠ 李四能看的表）

## 2. 目标与验收标准

| 目标 | 验收标准 |
|---|---|
| 访问可观测 | 任意工具调用 5 秒内写入 SQLite，含用户、工具、表名、耗时、结果 |
| 用户身份识别 | 张三、李四各用独立 Bearer token，代理正确映射到 userId |
| 表级权限控制 | 张三访问未授权表，代理返回 JSON-RPC 错误并写 `denied` 日志；不透传到 KTX |
| KTX 零改动 | KTX 上游仓库不需要任何修改 |
| MCP 协议兼容 | Streamable HTTP / SSE session 正常工作，不破坏初始化握手 |
| 客户端最小配置 | Codex app / Hermes / Claude Code 只配置 MCP URL + Bearer token，不配置 connection、表清单或 tool include |
| Token 角色化 | `kx_readonly` 这类权限模板可复用；新增同类 Agent 不需要复制逐表 ACL |

## 3. Non-Goals

- 不实现行级权限（列级、条件过滤）
- 不实现 OIDC / OAuth，只用静态 Bearer token
- `sql_execution` 工具默认禁用，不做 SQL AST 表名解析（后期可扩展）
- 不实现 Web UI 管理界面（Phase 3 可选）
- 不把 skill 当作安全边界。skill 只指导模型怎么用工具；最终授权必须由 Lucy MCP Proxy 裁决
- v1.2 不实现 token scope。后续若引入，只允许在 role 基础上做交集收窄，不能增加权限
- v1.3 新增的 `initialize.result.instructions` 注入（见 §4.4）是"指导"职责的扩展，不具备安全边界效力——它只决定模型看到什么提示文字，不决定模型能调用什么工具或看到什么数据。真正的权限边界始终是 `acl.check()` 和 `tools/list` 改写；instructions 文本写错或缺失最多导致模型少一些路由提示，不会导致越权

## 4. 架构设计

### 4.1 整体拓扑

```
张三 Hermes              --Bearer <token>-->      ┐
Workhorse                --Bearer <token>-->      ├─ Lucy MCP Proxy (:7879) ──> KTX MCP (:7878)
本地 Claude Code 开发会话 --Bearer <token>-->      ┘  识别 / 检查 / 转发 / 日志    内部 token

                                              │
                                     .ktx-ui/audit.sqlite
                                     (access_log, revoked_tokens)
```

- 客户端 `.mcp.json` 指向 `:7879`，每用户配置各自的 Bearer token
- 代理是 KTX 的唯一上游客户端，用内部独立 token（`KTX_INTERNAL_TOKEN` 环境变量）
- KTX 继续监听 `:7878`，对外部用户无感知
- v1.3 起，"本地 Claude Code 开发会话"也是一个普通客户端，不再走仓库 `CLAUDE.md` 兜底的数据问答指导——它和张三 Hermes、Workhorse 一样，通过 `.mcp.json` 配 `lucy` server + 自己的 token 连 `:7879`，指导文字来自 §4.4 的 `initialize` instructions 注入，不是仓库文件

### 4.2 请求生命周期

```
POST /mcp (client)
  → 读 Authorization header → 401 if 缺失
  → sha256(token) 查内存 tokenIndex → 401 if 未识别 / 已撤销
  → 读 mcp-session-id header，首次创建 session 缓存（用于记录 clientInfo）
  → 缓冲读取请求 body（单个 JSON-RPC 对象）
  → if method == "initialize": 缓存 params.clientInfo 到 session
  → if method == "tools/list":
      按 effective permissions 改写下行工具列表；必要时注入 kx_catalog
  → if method == "tools/call":
      tool = params.name
      acl.check(userId, tool, params.arguments)
        → 如被拒: 写 denied 日志, 返回 JSON-RPC error, 结束
  → 注入内部 Bearer token, 转发 body 到 KTX :7878
  → 透传 mcp-session-id 和响应 headers
  → pipe 响应流回 client，同时旁路 sniff 首个 chunk 判断 isError
  → 写 access_log（userId, tool, tables, outcome, durationMs）
```

### 4.3 MCP Session 透传

- `mcp-session-id` header **双向透传**，代理不生成新 session ID
- 一个 client session → 一个 upstream session（不复用连接）
- 请求 body 可缓冲（每次工具调用是单个 JSON 对象，通常 < 10KB）
- 默认非改写路径中，**非** `tools/call` 仍原样 pipe，避免破坏真正的流式 SSE/chunked 语义
- 下列路径会**有限缓冲并改写**响应，改写成功后统一以 `application/json` 返回（即使上游是 `text/event-stream`），且不继承上游的 SSE/`x-accel-buffering` 等帧头（保留 `mcp-session-id`）：
  - `initialize` instructions 注入（失败 fail-open 透传原响应）
  - `tools/list`（权限过滤 / 工具注入）
  - `tools/call` 的 `lucy_query` / `lucy_read_source`（结果 `_meta` enrichment）
  - `tools/call` 的 `wiki_search`（结果 ACL 过滤）
  - **其余** `tools/call`（含 legacy `sl_*`）：上游若为有限 SSE，同样归一化为 JSON（v1.5）
- 凡属上列缓冲改写，SSE 多帧解码规则见 **§6.1.0**（禁止取首条 `data:`）
- 原因：KTX 常对 MCP 响应返回**带 `Content-Length` 的单帧 SSE** + `Connection: keep-alive`。部分 Streamable HTTP 客户端（实测 **Cursor / Claude Code**；OpenClaw 等较宽松客户端往往不易复现）会把该响应当作未结束的事件流一直等待，最终报 `MCP error -32001: Request timed out`，而上游实际已在亚秒级完成。proxy 既然已经整包缓冲，就应归一化为 JSON。
- `tools/list` 是协议发现面，proxy 对该响应做有限缓冲改写：过滤无权工具，注入 proxy 自服务工具（如 `kx_catalog`），并重写 `content-length` / `transfer-encoding`

### 4.4 Initialize Instructions 注入（v1.3）

**设计意图**：本仓库曾经把"数据问答指导文字"（查询优先级、表路由、指标口径、reviewer 触发条件、provenance footer）放在根目录 `CLAUDE.md` 里——这是 Claude Code 专有的自动加载约定，外部客户端（Codex、Cursor、其他 Claude Code 用户的 Hermes/Workhorse）从不读这个仓库的 `CLAUDE.md`，导致同一份指导只有"本地仓库内的 Claude Code 开发会话"能看到，其他走 proxy 的客户端完全没有。v1.3 把这份指导迁移到 MCP 协议原生支持的 `InitializeResult.instructions` 字段，由 Lucy MCP Proxy 在 `initialize` 响应里统一注入，使所有走 `:7879` 的客户端（含本地 Claude Code 开发会话，见 §4.1）拿到同一份指导。

**内容来源**：`webui/config/data-qa-instructions.md`。这是事实源，模块加载时一次性读取并缓存到进程内存（不做 hot-reload，改完文件需要重启 proxy 才生效——MVP 范围内可接受，因为指导文字不是高频变更项）。

**MVP 不做权限差异化**：所有通过鉴权的 token 拿到同一份 instructions 文本，不按 role 拆分。差异化（比如不同 role 看到不同的表路由小节）留作后续迭代，不在 v1.3 范围内。

**覆盖策略**：KTX 上游 `initialize` 响应目前不填 `result.instructions`（字段为空或缺失）。proxy 无条件覆盖该字段为本地文本——这是"无中生有覆盖"，不是合并。若未来 KTX 上游也开始填充该字段，约定为整体替换、不做内容拼接（避免两份指导互相矛盾或重复）。

**失败语义（与 `tools/list` 刻意不同）**：`tools/list` 改写失败时 fail-closed，返回 JSON-RPC error（§6.1，因为它涉及权限边界，过滤失败可能导致越权暴露工具）。`initialize` 的 instructions 注入失败（文件未加载到、JSON 解析失败、content-type 不识别等）必须 fail-open——退化为原样透传上游响应，不能阻断 MCP session 建立。原因：instructions 只是指导文案，不是权限裁决；一旦在这里 fail-closed，注入功能任何一个小 bug 都会导致所有客户端连不上 proxy，影响范围远大于"少了一段指导文字"。失败时 proxy 仍写 audit（`tool=initialize`，`outcome=ok`，`decision_reason=instructions_injection_failed`，`error_detail` 记录失败原因），供事后排查，但不影响客户端侧的请求结果。

**Kill switch**：环境变量 `LUCY_ENABLE_INSTRUCTIONS_INJECTION`（默认 `!== "false"` 即启用）。关闭时 `initialize` 走原有透传分支，行为等价于 v1.3 上线前。

## 5. 数据结构

### 5.1 用户权限配置 `webui/config/access.yaml`

```yaml
users:
  - id: zhangsan
    name: 张三
    tokens:
      - hash: sha256:<hex>        # 明文 token 不落盘，只存 hash
        label: hermes-laptop
        created: 2026-06-18
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
        - sl_read_source
        - wiki_search
        - wiki_read
        - entity_details
        - dictionary_search
        - discover_data
        - connection_list

  - id: lisi
    name: 李四
    enabled: false
    note: High-privilege sample agent; create token only when needed.
    tokens: []
    allow:
      tables: ["*"]               # 通配 = 全部已配置表
      tools: ["*"]

defaults:
  deny_tools:
    - sql_execution               # 原生 SQL 写口，默认对所有用户禁用
    - memory_ingest
    - memory_ingest_status
```

- `tools: ["*"]` 表示放行全部工具（除 `defaults.deny_tools`）
- `tables: ["*"]` 表示放行全部已在 `ktx.yaml` 中 `enabled_tables` 声明的表
- yaml 变更后需重启，或通过 `fs.watch` hot reload（见 §7）

### 5.1.1 v1.2 Role 权限模型

v1.2 的目标用户体验是：同事拿到一个 `kx_readonly` token 后，只在 Codex app / Hermes / Claude Code 中配置 MCP URL 和 Bearer token；客户端不需要知道 `mysql-aliyun`、`dataforai.kx_*` 或工具白名单。

```yaml
roles:
  kx_readonly:
    description: KX 财务数据只读问答
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - kx_dim_company
            - kx_dim_financial_item
            - kx_fact_financial_amount
            - kx_vw_balance_sheet_detail
            - kx_vw_cash_flow_statement_detail
            - kx_vw_income_statement_detail
      tools:
        - kx_catalog
        - sl_query
        - sl_read_source
        - entity_details

users:
  - id: workhorse
    name: workhorse
    enabled: true
    role: kx_readonly
    tokens:
      - hash: sha256:<hex>
        label: codex-app
        created: 2026-06-21

defaults:
  deny_tools:
    - sql_execution
    - memory_ingest
    - memory_ingest_status
```

**有效权限合成规则（必须单向、可解释）：**

```text
effective_permissions(token)
  = resolve(user.role)
  - defaults.deny_tools
```

- `roles` 是长期主模型；`users[].role` 指向一个全局 role。
- `defaults.deny_tools` 是绝对否定；role 不能突破全局禁用工具。
- `users[].allow` 仅作为 v1.0 兼容层保留，标记 deprecated；新建 Agent 不再生成 `users[].allow`。迁移期内，如果同一 user 同时有 `role` 和 `allow`，proxy 必须在 reload 阶段告警，并按 `role` 优先生效。
- `role.allow.tools` 必须显式列工具名；`["*"]` 仅允许出现在历史 `users[].allow` 兼容配置中。
- 如果 role 授权任何表访问工具或 `tableSelectors`，则 `role.allow.connections` 必填且不能为空；缺失视为 `role_resolution_failed:<role>`。纯 wiki / 非数据工具 role 可以省略 `connections`。
- v1.2 不实现 `tokens[].scopes`；如未来实现，只能引用已有 role 作为交集收窄，不能增加工具、连接或表权限。
- 未识别 role、空 role、selector 解析失败、tool 不存在或 selector 匹配 0 个 source 时，配置 reload 必须 fail-closed；不得静默降级为全放行、空权限或历史 `users[].allow`。

KX role 示例中的工具归属：

| Tool | 来源 | 说明 |
|---|---|---|
| `sl_query` | KTX upstream | 语义层查询 |
| `sl_read_source` | KTX upstream | 读取语义层 source |
| `entity_details` | KTX upstream | 读取实体详情；若上游未暴露该工具，role 校验失败 |
| `kx_catalog` | Lucy proxy | proxy 注入并直接服务的能力发现工具 |

### 5.1.2 Role 生命周期

- role 是全局命名权限模板；`users[].role` 只能引用已存在 role。
- role 改名不支持原地 rename；必须新增新 role、迁移引用、再删除旧 role。
- 删除仍被 user 引用的 role 是配置错误；reload fail-closed。
- 修改 role 的 tools / connections / tableSelectors 后，新的 effective permissions 在下一次配置 reload 生效。30 秒 TTL 内的已缓存请求仍按旧 role 裁决；WebUI 写入 role / user 变更时应默认触发主动 reload。
- 每次 reload 后，proxy 重新解析 role，并为每个 role 生成 permission snapshot hash。
- role 解析失败时，proxy 必须拒绝使用该配置版本并继续使用上一份已验证配置；若启动期无上一份有效配置，则拒绝启动。

### 5.1.3 `tableSelectors` 语义

`tableSelectors` 表达授权意图，proxy 通过 semantic-layer source map 解析为具体 `(connection, schema, sourceName, table)` 集合。role reload 必须先刷新 source map，或至少记录用于解析的 source map version / mtime；admin preview 必须展示该版本，避免 preview 与运行时用不同 catalog。

| Selector | 语义 | 适用场景 |
|---|---|---|
| `{ connection, schema, prefix }` | 指定 connection/schema 下，source/table 名以 prefix 开头 | 多 connection 环境首选 |
| `{ schema, prefix }` | 任一授权 connection 下，schema 内 prefix 匹配 | 单 connection 或角色已限定 connection |
| `{ connection, schema, names }` | 精确列举 source/table 名 | 小范围精确白名单 |
| `{ schema, names }` | 任一授权 connection 下，schema 内精确列举 | 兼容单 connection |

规则：

- 多个 selector 之间是 union。
- `prefix` 大小写敏感；不支持 glob、regex 或负向匹配。
- selector 只匹配 semantic-layer 已注册 source；物理库里存在但未纳入 semantic-layer 的表不授权。
- selector 解析结果必须可预览，并在 reload / admin UI 中展示给管理员。
- selector 匹配 0 个 source 是错误：preview API 返回 `400 INVALID_ROLE`，配置保存 / reload fail-closed。
- KX 财务只读 role 必须使用 `names` 明示授权 source，不能用 `prefix: kx_` 作为默认策略。
- `prefix` 是开放式授权，新增匹配 source 会自动纳入角色；仅适合开发、探索或低敏数据域。生产敏感数据 role 使用 prefix 时，admin preview 必须显示开放式授权 warning，并要求人工确认。

### 5.1.4 客户端配置合同

普通使用者只接收以下信息：

```json
{
  "mcpServers": {
    "lucy": {
      "url": "http://localhost:7879/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

客户端不得要求配置：

- `connectionId`
- 表名或 table prefix
- tool include / exclude
- 内部 role 名称

`kx_catalog` 负责在运行时返回该 token 可用的数据域、允许的查询入口和示例参数。它是能力发现工具，不是权限来源；所有工具调用仍必须走 proxy ACL。

### 5.2 SQLite Schema（`.ktx-ui/audit.sqlite`）

```sql
CREATE TABLE access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT    NOT NULL,   -- ISO8601 UTC, e.g. "2026-06-18T00:30:00.000Z"
  user_id       TEXT    NOT NULL,   -- 'zhangsan'
  client        TEXT,               -- 'hermes' | 'cursor'（从 initialize 握手的 clientInfo.name 抓）
  tool          TEXT    NOT NULL,   -- 'sl_query'
  tables        TEXT,               -- JSON array: ["dataforai.superstore_orders"]
  args_summary  TEXT,               -- 精简入参 JSON（白名单字段，不含完整 rows）
  outcome       TEXT    NOT NULL,   -- 'ok' | 'error' | 'denied'
  error_detail  TEXT,               -- 失败原因，截断到 500 字符
  duration_ms   INTEGER NOT NULL,
  request_id    TEXT    NOT NULL    -- JSON-RPC id
);

CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
CREATE INDEX idx_al_tool_ts ON access_log(tool, ts);

CREATE TABLE revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  revoked_at TEXT NOT NULL,
  reason     TEXT
);
```

v1.2 扩展字段（可新增列或放入 JSON metadata，具体实现二选一）：

```sql
-- 建议字段；SQLite 迁移可用 ALTER TABLE 逐步追加
role_ids                         TEXT,  -- JSON array，如 ["kx_readonly"]
permission_snapshot_hash          TEXT,  -- effective permissions 快照 hash
effective_tables_count            INTEGER,
decision_reason                   TEXT   -- tool_forbidden / table_forbidden / unknown_connection 等
```

同时新增权限快照表；`access_log.permission_snapshot_hash` 必须能关联到当时的完整 effective permissions。

```sql
CREATE TABLE permission_snapshots (
  hash        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  roles_json  TEXT NOT NULL,  -- 参与合成的 role 定义
  resolved_json TEXT NOT NULL -- tools/connections/sources/tableSelectors 解析结果
);
```

写入顺序：

1. 计算 effective permissions 与 snapshot hash。
2. `INSERT OR IGNORE permission_snapshots(hash, ...)`。
3. 写 `access_log.permission_snapshot_hash`。

审计日志必须足以解释「当时为什么允许或拒绝」。当 role 或 selector 未来变化时，仍应通过 `permission_snapshots.resolved_json` 复盘。

保留策略：`permission_snapshots` 按 hash 去重；清理时只能删除不再被近 90 天 `access_log.permission_snapshot_hash` 引用的快照。

## 6. 表名提取逻辑

代理从工具参数里提取物理表名用于 ACL 检查和日志。

| 工具 | 表名来源 | 提取方式 |
|---|---|---|
| `sl_query` | `arguments.measures[]` / `arguments.dimensions[].field` | 取 `.` 前的 sourceName，查内存 Map → 物理表名 |
| `sl_read_source` | `arguments.sourceName` + `arguments.connectionId` | 同上查 Map |
| `entity_details` | `arguments.sourceName` / `arguments.entities[].table` / `schema+name` / `type|kind + name|id` / `qualifiedName` | 规范化后查 source map |
| `discover_data` / `dictionary_search` | 无具体表 | 仅做 tool 级权限检查 |
| `wiki_search` / `wiki_read` | 与表无关 | 仅做 tool 级权限检查 |
| `connection_list` | 无 | 无需检查 |

v1.2 增加连接裁决：

- 对表访问工具，若 effective permissions 含 `connections`，请求必须显式携带允许的 connection。
- 缺失 connection、未知 connection、非授权 connection 均拒绝并 audit。
- `schema` 只用于表归属，不等同于 connection；不得把 `{ schema: dataforai }` 误判为 connection。
- `sl_query` 如果没有可解析 source/table 引用，且用户不是 `tables: ["*"]` 兼容通配，必须拒绝为 `explicit_table_required:<empty>`。
- 一次请求引用多表时，任一表或 connection 未授权则整体拒绝；`decision_reason` 记录第一个违规对象，并在 `args_summary` 或 metadata 中保留违规总数。

**sourceName → 物理表名映射**：启动时扫描 `semantic-layer/**/*.yaml`，读取每个 source 的 `name`（sourceName）及其所属 connection + schema，构建内存 Map：

```typescript
// Map<sourceName, "schema.table">
// e.g. "superstore_orders" -> "dataforai.superstore_orders"
```

按文件 mtime 每 60 秒刷新一次（变化不频繁，不需要 fs.watch）。

### 6.1 `tools/list` 与 `tools/call` 双重授权

- `tools/list`：proxy 改写下行工具列表，只返回 token 有权看到的工具。若 effective permissions 允许 `kx_catalog`，proxy 可注入该自服务工具。
- `tools/call`：proxy 对每次调用再次校验工具、connection、source/table；不能依赖客户端只调用 list 中出现过的工具。
- `kx_catalog`：由 proxy 直接服务，返回内容按 effective permissions 过滤。没有任何数据权限的 token 不应看到或调用 `kx_catalog`。
- 拒绝必须 fail-closed，并写 `access_log.outcome='denied'`。

`tools/list` 改写策略：

- proxy 只对 `tools/list` 的有限响应做缓冲改写；非 `tools/list` 且非上列 `tools/call` 缓冲路径仍保持流式透传。
- 对 `application/json` 响应：完整读取 JSON-RPC 响应体，过滤 `result.tools`，保留其他字段。
- 对 SSE 响应：完整读取本次 `tools/list` 的 SSE 帧，按 **§6.1.0** 选取 JSON-RPC **response** 帧后过滤 `result.tools`，再以 `application/json` 返回（不再重发 SSE 单帧），避免 Streamable HTTP 客户端把有限 SSE 当成长连接。
- 若上游返回多帧流式 `tools/list`、无法完整解析、body 超过 `MAX_TOOLS_LIST_REWRITE_BYTES = 4 MiB` 或 JSON-RPC 不是单个 response，proxy 必须 fail-closed 返回 JSON-RPC error，不得透传未过滤工具列表。
- 若上游 tools/list 支持分页 / cursor，proxy 过滤当前页并原样保留 pagination 字段；不得合并跨页工具。
- `initialize.capabilities` 不做权限过滤；权限发现以 `tools/list` 的实际响应为准。
- v1.2 不实现主动 `listChanged` 推送；role 变更后，新 `tools/list` 请求在配置 reload 后反映新权限。

### 6.1.0 缓冲改写 SSE：必须选 JSON-RPC response 帧（v1.5）

**背景**：Cursor / Claude Code 等 Streamable HTTP 客户端在 `tools/call` 时会带 `progressToken`。KTX 上游可能先推多条 `notifications/progress`（SSE `data:` 帧，JSON-RPC **notification**，有 `method`/`params`、无 `id`/`result`），最后才推带请求 `id` 的 `result`/`error` **response** 帧。OpenClaw 等客户端若不发 `progressToken` 或容忍有限 SSE，往往不易复现。

**事故形态**：Proxy 若对缓冲 body 使用「第一条 `data:`」解码，会把 progress 通知当成最终工具结果改写发回。客户端一直等匹配 `id` 的 JSON-RPC response → 表现为 `MCP error -32001: Request timed out`。服务端审计仍可能是 `outcome=ok`（上游查询已成功），curl/不带 progressToken 的客户端往往只有单帧 result，不易复现。

**强制规则**：

1. 缓冲改写路径解码 SSE 时，必须收集全部 `data:` 帧，再选取带 `id` 且含 `result` 或 `error` 的 JSON-RPC **response** 帧。
2. 若请求带 `id`，优先匹配同 `id` 的 response；否则取最后一个 response 帧。
3. **禁止**用首条 `data:` 作为改写输入；**禁止**把 `method: notifications/progress`（或其它 notification）当作 `tools/call` / `tools/list` / `initialize` 的最终响应。
4. 改写成功后以 `application/json` 返回（见 §4.3），不重发有限 SSE。Progress 透传与客户端超时续命是独立议题，不在本条范围内。
5. 实现锚点：`decodeSseJsonRpcResponse`（`webui/server/proxy/mcp-proxy.ts`）。回归：`webui/server/__tests__/mcp-proxy-smoke.test.ts`（progress→result 用例）。

### 6.1.1 `decision_reason` 枚举

| Code | 语义 |
|---|---|
| `allowed` | 允许执行 |
| `tool_forbidden` | role 未授权该工具 |
| `tool_forbidden_global` | 命中 `defaults.deny_tools` |
| `table_forbidden:<table>` | 表不在 effective permissions 中 |
| `table_forbidden:<table>; total=<n>` | 多表请求中至少一个表未授权，记录首个违规和违规总数 |
| `unknown_or_forbidden_connection:<id>` | connection 缺失、未知或未授权；缺失用 `<missing>` |
| `explicit_table_required:<empty>` | 非通配用户调用表访问工具但没有明确表引用 |
| `role_not_found:<role>` | user 引用不存在 role |
| `role_resolution_failed:<role>` | role selector / tool / connection 解析失败 |
| `user_disabled` | user disabled |
| `token_revoked` | token 已撤销 |
| `token_expired` | token 已过期 |
| `tools_list_rewrite_failed` | `tools/list` 改写失败，拒绝透传 |

### 6.2 `kx_catalog` 返回合同

`kx_catalog` 面向 agent 能力发现，返回可执行所需信息。返回的 `connectionId` / `schema` / `sourceName` / `table` 是模型可读的机器字段，不在 token 交付页展示；Agent 最终回答不应主动向普通用户复述这些内部 id，除非用户明确要求调试或配置细节。

```json
{
  "dataDomains": [
    {
      "id": "kx_financial",
      "label": "KX 财务数据",
      "connections": ["mysql-aliyun"],
      "sources": [
        {
          "connectionId": "mysql-aliyun",
          "schema": "dataforai",
          "sourceName": "kx_fact_financial_amount",
          "table": "dataforai.kx_fact_financial_amount"
        }
      ],
      "examples": [
        {
          "tool": "sl_query",
          "arguments": {
            "connectionId": "mysql-aliyun",
            "measures": [{ "$text": "kx_fact_financial_amount.amount" }]
          }
        }
      ]
    }
  ]
}
```

管理员 UI 可以展示完整 connection/source/table；普通 token 交付页不展示这些内部字段，只交付 URL 和 token。

## 7. 新增 / 改动文件

### 新增

```
webui/
├── config/
│   ├── access.yaml                  # 用户/权限配置（人工维护）
│   └── data-qa-instructions.md      # v1.3 新增：initialize instructions 注入内容来源（Claude 维护，见 §4.4）
└── server/
    └── proxy/
        ├── mcp-proxy.ts         # Fastify app，核心拦截 + 转发；v1.3 新增 writeInitializeResponse()
        ├── identity.ts          # Bearer token → userId / label
        ├── acl.ts               # 权限判定 + 表名提取
        └── audit.ts             # better-sqlite3 日志写入
```

### 改动

| 文件 | 改动内容 |
|---|---|
| `webui/server/index.ts` | 导入并启动 proxy app（端口 7879） |
| `.mcp.json` | `url` 改为 `http://localhost:7879/mcp`；加 `headers.Authorization`；v1.3：key 名改为 `lucy`，本地仓库切到走 proxy（见 §10） |
| `webui/package.json` | 新增依赖：`better-sqlite3`、`@types/better-sqlite3` |
| `webui/server/proxy/mcp-proxy.ts`（v1.3） | 新增 `loadDataQaInstructions()`、`instructionsInjectionEnabled()`、`writeInitializeResponse()`；`handlePost()` 新增 `initialize` 分支（见 §4.4） |

### 不改动

- KTX 上游任何文件（`/Users/zhangxingchen/Projects/ktx/**`）
- `ktx.yaml`、`semantic-layer/`、`skills/`

## 8. 关键接口定义（TypeScript）

```typescript
// identity.ts
interface Identity {
  userId: string;
  tokenLabel: string;
  client?: string;  // 从 session 缓存的 clientInfo.name
}
function identifyRequest(authHeader: string | undefined): Identity | null

// acl.ts
interface AclDecision {
  allowed: boolean;
  reason?: string;  // 'tool_forbidden' | 'table_forbidden:<table>' | 'tool_default_deny'
}
function check(identity: Identity, toolName: string, args: unknown): AclDecision
function extractTables(toolName: string, args: unknown): string[]  // 物理表名列表

// audit.ts
interface AccessLogEntry {
  ts: string;
  userId: string;
  client?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  outcome: 'ok' | 'error' | 'denied';
  errorDetail?: string;
  durationMs: number;
  requestId: string | number;
}
function writeLog(entry: AccessLogEntry): void
```

## 9. 环境变量

| 变量名 | 说明 | 示例 |
|---|---|---|
| `KTX_INTERNAL_TOKEN` | 代理转发到 KTX 时使用的内部 Bearer token | 随机生成的 hex |
| `LUCY_PROXY_PORT` | 代理监听端口，默认 7879 | `7879` |
| `LUCY_AUDIT_DB` | SQLite 文件路径，默认 `.ktx-ui/audit.sqlite` | 可自定义 |
| `LUCY_ENABLE_INSTRUCTIONS_INJECTION` | v1.3 新增：`initialize` instructions 注入开关，`!== "false"` 即启用，默认开启 | `false`（关闭时退化为 v1.3 上线前的透传行为） |

## 10. 实施阶段

### Phase 1：可观测（1–2 天）
目标：有日志，没权限拦截

1. 新增 `webui/config/access.yaml`（只配用户和 token，ACL 暂时全放行）
2. 实现 `identity.ts`（暂时明文 token 比对，无 hash）
3. 实现 `audit.ts` + SQLite 建表
4. 实现 `mcp-proxy.ts` 转发骨架 + sniff 旁路写日志
5. `webui/server/index.ts` 启动 proxy
6. `.mcp.json` 切到 `:7879`

**验证**：张三和李四各发 5 个 sl_query，`SELECT * FROM access_log` 能看到正确 user_id、tool、duration_ms。

### Phase 2：可治理（2–3 天）
目标：ACL 生效，权限拒绝有日志

7. token hash（sha256），引入 `revoked_tokens` 表
8. 实现 `acl.ts`：tool 级 + table 级检查
9. 实现 sourceName → 物理表名缓存
10. 代理在 `tools/call` 前插入 ACL check

**验证**：张三访问 `dataforai.superstore_returns` → 收到 JSON-RPC error；`access_log` 有 `outcome='denied'`，`error_detail='table_forbidden:dataforai.superstore_returns'`。李四访问三张表全部正常。

### Phase 2.5：角色化 token 与客户端最小配置（v1.2）

目标：同事使用 Codex app / Hermes / Claude Code 时只需要 MCP URL + token。

1. 在 `access.yaml` 增加 `roles` schema 与 `users[].role`。
2. 实现 role resolver 与 effective permissions preview。
3. 实现 `tableSelectors` 解析；selector 解析失败时 reload fail-closed。
4. `tools/list` 按 effective permissions 过滤，并注入 proxy 自服务工具 `kx_catalog`。
5. `kx_catalog` 由 proxy 直接服务，返回 token 可用的数据域和示例参数。
6. 保留 `users[].allow` 兼容读取，但新建 Agent 不再生成；若与 `role` 并存则告警并按 `role` 生效。
7. audit 增加 role / permission snapshot / decision reason。

**验证**：

- 新建 `kx_readonly` role 和 token 后，Codex app 只配 URL/token，`tools/list` 只能看到允许工具。
- `kx_catalog` 返回 `mysql-aliyun` 与 `dataforai.kx_*` 已注册 semantic-layer source。
- `sl_query` 缺 connection、`connectionId=warehouse`、非 `kx_` 表、无明确表引用均被拒绝并 audit。
- 当前 `workhorse` 的逐表配置可迁移为 `role: kx_readonly`，行为等价或更严格。

### Phase 3：可运维（可选，半天）
11. `webui/server/index.ts` 加 `GET /api/audit` 接口（分页、按 user/tool 过滤）
12. yaml hot reload（fs.watch + 删 token 写 revoked_tokens）

### Phase 4：Initialize Instructions 注入与本地切换（v1.3，2026-06-23）

目标：把仓库 `CLAUDE.md` 里的数据问答指导迁移到 §4.4 描述的 proxy instructions 注入，并让本地仓库内的 Claude Code 开发会话也切到走 proxy。

> 说明：「`.mcp.json` 切到 `:7879`」这件事，Phase 1 步骤 6 当时就写过预期，但实际只切了 proxy 的监听端口/转发骨架，根目录 `.mcp.json` 一直没有真的改成指向 `:7879` 并带认证头——本阶段是把这条欠了很久的待办补完，不是新增需求。

13. 新增 `webui/config/data-qa-instructions.md`（内容来源，详见 §4.4），把原 `CLAUDE.md` 的查询优先级、表路由、指标口径、reviewer 触发条件、provenance footer 原样迁移过去。
14. `mcp-proxy.ts` 新增 `writeInitializeResponse()`，在 `handlePost()` 里给 `initialize` 方法新增独立分支，结构参照 `tools/list` 的 `writeToolsListResponse()`，但失败语义相反（fail-open，见 §4.4）。
15. `access.yaml` 新增 `local_dev_full_access` role（覆盖 `ktx.yaml` 全部 `enabled_tables`）+ `forrest_local` 用户，保证本地开发切换后数据访问范围不收紧。
16. 根目录 `.mcp.json`：`mcpServers` key 名从 `ktx` 改为 `lucy`，`url` 改为 `http://localhost:7879/mcp`，`headers.Authorization` 用 `"Bearer ${LUCY_LOCAL_TOKEN}"` 环境变量插值（不写明文 token）。token 明文存放在 `.ktx/secrets/lucy-local-token`（已在 `.gitignore`）。
17. 本机环境变量 `LUCY_LOCAL_TOKEN` 配置在用户级 shell 启动文件（如 `~/.zshrc`，不属于本仓库），从 `.ktx/secrets/lucy-local-token` 读取后导出，确保每个新开的 Claude Code 会话都能用。

**实测结论（供后续同类配置参考）**：

- Claude Code 对 HTTP transport `.mcp.json` 里 `headers.Authorization` 字段的 `${VAR}` 环境变量插值**确认生效**（用 `claude -p --mcp-config <file> --strict-mcp-config` 非交互模式实测，`kx_catalog` 调用成功返回数据域列表）。社区曾有的"插值不生效"顾虑在本机此版本上未复现。
- 之前一度怀疑的"KTX upstream SSE 握手 gap 导致 initialize 永远 400"**不成立**——用包含 `protocolVersion`/`capabilities`/`clientInfo` 全部必填字段的完整 initialize 请求直接测试 `:7878` 和 `:7879`，两者均返回 200。此前的 400 是测试请求本身缺字段（MCP SDK 的 zod schema 在缺字段时直接拒绝），与 SSE 握手无关，KTX 上游没有需要修复的兼容性问题。
- 本机日常通过 `claude` 命令启动的会话，实际由 `~/.zshrc` 里的 `claude()` shell 函数强制 `cd` 到 `~/Workspace` 再启动，因此真正生效的是 `~/Workspace/.mcp.json`（不在本仓库内），而不是 `project-lucy/.mcp.json`——这是本机 shell 配置的固有行为，不是本工单引入的问题。为了让"本地仓库内开发会话切到走 proxy"对日常工作流真正生效，额外把 `lucy` server 条目合并进 `~/Workspace/.mcp.json`（与已有的 `tableau` server 并列）。`project-lucy/.mcp.json` 本身仍按上述第 16 条切换、保持作为仓库内交付物的正确性，供任何显式 `--mcp-config` 指向该文件的场景使用。

**验证**：本地用 `claude -p --model claude-haiku-4-5-20251001 ... "调用 lucy 的 kx_catalog"`（默认配置，不带任何覆盖参数）验证，返回 `connections: ["mysql-aliyun"]`，确认本地开发会话默认即可走 proxy 拿到全量数据访问能力和 §4.4 的 instructions 指导。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| MCP session 握手破坏 | 代理透传 `mcp-session-id`；响应流原样 pipe，不 buffer；先跑集成测试验证初始化握手 |
| 响应 sniff 解析失败 | sniff 只做 best-effort（旁路），失败时 outcome 记 'unknown'，不阻断响应流 |
| access.yaml 格式错误 | 启动时做 schema 校验（zod），错误则拒绝启动 |
| token 明文泄漏 | 只存 sha256 hash；日志里不记录原始 token；`.mcp.json` 加入 `.gitignore` |
| better-sqlite3 同步写阻塞 | 本机、低 QPS 场景同步写可接受；后期可换 WAL 模式减少锁 |
| role / selector 配错导致越权 | reload fail-closed；selector 预览；audit 记录 permission snapshot hash |
| prefix selector 自动纳入未来敏感表 | 只匹配 semantic-layer 已注册 source；管理员上线前审查 selector 预览；敏感表不得注册到通用 `kx_` 前缀角色 |
| tools/list 改写破坏响应头 | 改写后删除原 `content-length` / `transfer-encoding`，按新 body 重算 |
