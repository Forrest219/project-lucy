# MCP Auth Proxy — 访问日志与多用户权限 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | MCP Auth Proxy — 访问日志与多用户权限 Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-18 |
| 撰写人 | Claude (Opus 架构设计) |
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

## 3. Non-Goals

- 不实现行级权限（列级、条件过滤）
- 不实现 OIDC / OAuth，只用静态 Bearer token
- `sql_execution` 工具默认禁用，不做 SQL AST 表名解析（后期可扩展）
- 不实现 Web UI 管理界面（Phase 3 可选）

## 4. 架构设计

### 4.1 整体拓扑

```
张三 Hermes  --Bearer tk_zhangsan-->  ┐
                                       ├─ Lucy MCP Proxy (:7879) ──> KTX MCP (:7878)
李四 Cursor  --Bearer tk_lisi------->  ┘  识别 / 检查 / 转发 / 日志    内部 token

                                              │
                                     .ktx-ui/audit.sqlite
                                     (access_log, revoked_tokens)
```

- 客户端 `.mcp.json` 指向 `:7879`，每用户配置各自的 Bearer token
- 代理是 KTX 的唯一上游客户端，用内部独立 token（`KTX_INTERNAL_TOKEN` 环境变量）
- KTX 继续监听 `:7878`，对外部用户无感知

### 4.2 请求生命周期

```
POST /mcp (client)
  → 读 Authorization header → 401 if 缺失
  → sha256(token) 查内存 tokenIndex → 401 if 未识别 / 已撤销
  → 读 mcp-session-id header，首次创建 session 缓存（用于记录 clientInfo）
  → 缓冲读取请求 body（单个 JSON-RPC 对象）
  → if method == "initialize": 缓存 params.clientInfo 到 session
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
- **响应必须原样 pipe**，不 buffer 完整响应，避免破坏 SSE/chunked 语义

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
    tokens:
      - hash: sha256:<hex>
        label: cursor-mac
        created: 2026-06-18
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

## 6. 表名提取逻辑

代理从工具参数里提取物理表名用于 ACL 检查和日志。

| 工具 | 表名来源 | 提取方式 |
|---|---|---|
| `sl_query` | `arguments.measures[]` / `arguments.dimensions[].field` | 取 `.` 前的 sourceName，查内存 Map → 物理表名 |
| `sl_read_source` | `arguments.sourceName` + `arguments.connectionId` | 同上查 Map |
| `entity_details` | `arguments.entities[].table` | 直接读字段 |
| `discover_data` / `dictionary_search` | 无具体表 | 仅做 tool 级权限检查 |
| `wiki_search` / `wiki_read` | 与表无关 | 仅做 tool 级权限检查 |
| `connection_list` | 无 | 无需检查 |

**sourceName → 物理表名映射**：启动时扫描 `semantic-layer/**/*.yaml`，读取每个 source 的 `name`（sourceName）及其所属 connection + schema，构建内存 Map：

```typescript
// Map<sourceName, "schema.table">
// e.g. "superstore_orders" -> "dataforai.superstore_orders"
```

按文件 mtime 每 60 秒刷新一次（变化不频繁，不需要 fs.watch）。

## 7. 新增 / 改动文件

### 新增

```
webui/
├── config/
│   └── access.yaml              # 用户/权限配置（人工维护）
└── server/
    └── proxy/
        ├── mcp-proxy.ts         # Fastify app，核心拦截 + 转发
        ├── identity.ts          # Bearer token → userId / label
        ├── acl.ts               # 权限判定 + 表名提取
        └── audit.ts             # better-sqlite3 日志写入
```

### 改动

| 文件 | 改动内容 |
|---|---|
| `webui/server/index.ts` | 导入并启动 proxy app（端口 7879） |
| `.mcp.json` | `url` 改为 `http://localhost:7879/mcp`；加 `headers.Authorization` |
| `webui/package.json` | 新增依赖：`better-sqlite3`、`@types/better-sqlite3` |

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

### Phase 3：可运维（可选，半天）
11. `webui/server/index.ts` 加 `GET /api/audit` 接口（分页、按 user/tool 过滤）
12. yaml hot reload（fs.watch + 删 token 写 revoked_tokens）

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| MCP session 握手破坏 | 代理透传 `mcp-session-id`；响应流原样 pipe，不 buffer；先跑集成测试验证初始化握手 |
| 响应 sniff 解析失败 | sniff 只做 best-effort（旁路），失败时 outcome 记 'unknown'，不阻断响应流 |
| access.yaml 格式错误 | 启动时做 schema 校验（zod），错误则拒绝启动 |
| token 明文泄漏 | 只存 sha256 hash；日志里不记录原始 token；`.mcp.json` 加入 `.gitignore` |
| better-sqlite3 同步写阻塞 | 本机、低 QPS 场景同步写可接受；后期可换 WAL 模式减少锁 |
