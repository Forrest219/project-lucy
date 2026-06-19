# Module 1: Agent 权限管控 — 详细设计

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI Agent 权限管控模块设计 |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Claude Thinker |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/webui/config/access.yaml v1.0, project-lucy/webui/docs/07-mcp-auth-proxy-spec.md v1.0, project-lucy/docs/user-guide/product-intro.html v1.0 |
| 适用范围 | Builder / Reviewer / Minimax M3 直接进入实现 |
| 输出位置 | project-lucy/docs/design-agent-permissions.md |

---

## 1. 设计原则与范围

### 1.1 解决的问题

当前 `webui/config/access.yaml` 是唯一权限事实源，管理员要新增一个 Agent 需要：
1. 终端生成随机 token（hex），手算 `sha256`；
2. 手编辑 `access.yaml`，复制粘贴 YAML 结构容易出错；
3. 把明文 token 通过别的渠道交给 Agent 使用者（容易泄密）；
4. 等待 30s yaml 缓存 TTL 或重启代理；
5. 没有撤销 UI，撤销要手工往 `revoked_tokens` 表 INSERT 或删 yaml 段。

本设计在 WebUI 内提供 Agent 实例 / Token / 权限策略的可视化管控，**事实源仍然是 `access.yaml`** + SQLite，UI 是 yaml/sqlite 的安全编辑器。

### 1.2 不做什么（与 spec 07 一致）

- 不实现 OIDC / OAuth / SSO（v1.0 排除）。
- 不实现列级 / 行级数据脱敏（v1.0 排除）。
- 不实现多租户（v1.0 排除）。
- 不替代 KTX 数据源密码管理：连接密码仍在 `.ktx/secrets/`，WebUI 不读不写。
- 不引入新的鉴权层给 WebUI 自己：WebUI 仍绑定 `127.0.0.1`，单用户本地工具假设不变（ADR-05）。
- 不做 Token rotation 自动化（v1.0 仅手动创建/撤销）。

### 1.3 设计假设

- [假设：管理员 = 当前在本机运行 webui 的人]，WebUI 不区分管理员与数据工程师身份。这与现有 ADR-05 "无登录"一致。
- [假设：Agent 实例 = `access.yaml.users[]` 里的一项]，与现有 spec 07 一一对应。一个"用户"可挂多个 token（如 hermes-laptop + cursor-mac）。
- [假设：Token 明文只在创建一次性返回，之后只保留 sha256]。与 spec 07 §11 风险缓解一致。
- [推断：进入 WebUI 写 access.yaml 后，热加载机制（30s TTL）保持不变]，无需重启代理。依据：access.yaml 注释 "修改后 30 秒内自动生效（缓存 TTL）"。
- [推断：MCP Proxy 已经在 7879 跑]，本模块不动 proxy 行为，只动 yaml/sqlite 管理面。

---

## 2. 页面结构

### 2.1 路由表

新增 4 个路由（挂在现有 `App.tsx` Routes 下）：

| 路由 | 页面 | 默认目录归属 |
|---|---|---|
| `/admin/agents` | Agent 实例列表（替代 Catalog 作为 admin 默认页） | 左侧导航新分组「访问治理」 |
| `/admin/agents/:userId` | Agent 实例详情（含工具/表 ACL 编辑、token 列表） | 同上 |
| `/admin/agents/:userId/tokens/new` | 创建新 token（一次性显示明文） | 同上 |
| `/admin/audit` | 访问日志查询 | 同上 |

左侧导航在现有「语义层维护 / 业务文档 / 审阅与校验」之后新增分组：

```
访问治理
- Agent 实例     →  /admin/agents
- 访问日志       →  /admin/audit
```

### 2.2 页面 1：Agent 实例列表 `/admin/agents`

**线框（文字描述）：**

```
┌─ Header ─────────────────────────────────────────────────┐
│ 访问治理 / Agent 实例                          [新建 Agent] │
│ 配置每个 Agent 实例能用哪些 MCP 工具和访问哪些表。            │
├──────────────────────────────────────────────────────────┤
│ [搜索框: 按用户 id / 名称]   [状态: 全部 ▾]                │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 张三 (zhangsan)                          ●启用       │ │
│ │ 1 个 token · 1 张表 · 8 个工具                        │ │
│ │ 最近访问 2026-06-19 14:23 · 共 247 次调用             │ │
│ │                                  [编辑]  [查看日志]   │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 李四 (lisi)                              ●启用       │ │
│ │ 1 个 token · *(全部表) · *(全部工具)                  │ │
│ │ ...                                                    │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

**核心 UI 元素：**

- 顶部：标题 + 「新建 Agent」CTA；过滤器（搜索 + 启用状态）。
- 卡片网格：每个 Agent 一张卡，显示：
  - 用户 id / 显示名 / 启用状态徽章
  - 摘要：token 数 / 授权表数（或 `*`）/ 授权工具数（或 `*`）
  - 最近访问时间和总调用次数（来自 `audit.sqlite.access_log`）
  - 行内操作：编辑、查看日志（跳到 `/admin/audit?user=<id>`）
- 空态：当 access.yaml 没有任何 user 时，显示引导文案 + 「新建第一个 Agent」按钮。

### 2.3 页面 2：Agent 实例详情 `/admin/agents/:userId`

**线框：**

```
┌─ Header ─────────────────────────────────────────────────┐
│ ‹ 返回列表    张三 (zhangsan)        [禁用] [删除]         │
│ 面包屑：访问治理 / Agent 实例 / 张三                       │
├─ 标签页 ─────────────────────────────────────────────────┤
│ [基本信息]  [Token]  [工具权限]  [表权限]  [变更预览]      │
├──────────────────────────────────────────────────────────┤
│ [基本信息]                                                │
│   用户 id (不可改)  : zhangsan                            │
│   显示名 (input)    : 张三                                │
│   备注 (textarea)   : ...                                 │
│   启用 (toggle)     : ●                                   │
├──────────────────────────────────────────────────────────┤
│ [Token] (列表)                                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ hermes-laptop      创建 2026-06-18 · sha256:b552…   │ │
│  │ 最近使用 2026-06-19 14:23                            │ │
│  │                            [复制 hash]  [撤销]       │ │
│  └─────────────────────────────────────────────────────┘ │
│  [+ 新建 Token]                                           │
├──────────────────────────────────────────────────────────┤
│ [工具权限]                                                │
│  ☐ 通配 (*) — 允许所有未在全局 deny 的工具                 │
│  或选择具体工具（多选 checkbox 网格）：                    │
│   ☑ sl_query        ☑ sl_read_source   ☑ wiki_search    │
│   ☑ wiki_read       ☑ entity_details    ☑ dictionary…   │
│   ☐ memory_ingest (全局禁用，无法选)                      │
├──────────────────────────────────────────────────────────┤
│ [表权限]                                                  │
│  ☐ 通配 (*) — 允许 ktx.yaml 中所有 enabled_tables         │
│  或多选表（来自 GET /api/sources）：                       │
│   ☑ dataforai.superstore_orders                          │
│   ☐ dataforai.superstore_returns                         │
│   ☐ dataforai.superstore_people                          │
├──────────────────────────────────────────────────────────┤
│ [变更预览]                                                │
│  与磁盘 access.yaml 的 unified diff（复用 DiffViewer）    │
│  [取消] [保存]                                            │
└──────────────────────────────────────────────────────────┘
```

**核心 UI 元素：**

- Tab 切换以避免单页过长。
- 「保存」按钮先弹 diff 模态确认（沿用现有 dryRun 习惯）。
- 工具选择网格从 `GET /api/mcp/tools` 拉（新增端点，见 §4），全局 deny 的工具置灰显示「全局禁用」。
- 表选择从现有 `GET /api/sources` 拉，按 schema 折叠。

### 2.4 页面 3：创建 Token `/admin/agents/:userId/tokens/new`

**线框：**

```
┌──────────────────────────────────────────────────────────┐
│ 为 张三 (zhangsan) 创建新 Token                           │
│ 一旦关闭本页面，将无法再看到 token 明文。请立即复制保存。  │
├──────────────────────────────────────────────────────────┤
│ Token 标签 *      : [hermes-laptop_______________]        │
│ 备注              : [...]                                 │
│ 过期时间 (可选)   : [日期选择器，留空 = 永不过期]          │
│                                                          │
│                                  [取消]  [生成 Token]    │
└──────────────────────────────────────────────────────────┘

【生成成功后，同一页面切换为】

┌──────────────────────────────────────────────────────────┐
│ ✓ Token 已生成，仅显示一次：                              │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ tk_4f7a9c…(64 字符 hex)                  [复制]      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  这是给 Agent 客户端 (Hermes / Cursor / Claude Code)      │
│  的 Authorization Bearer Token。请按以下方式配置：        │
│                                                          │
│  .mcp.json:                                              │
│  {                                                       │
│    "mcpServers": {                                       │
│      "lucy": {                                           │
│        "url": "http://localhost:7879/mcp",               │
│        "headers": { "Authorization": "Bearer <token>" }  │
│      }                                                   │
│    }                                                     │
│  }                                                       │
│                                                          │
│                              [我已保存，关闭]             │
└──────────────────────────────────────────────────────────┘
```

**关键交互**：明文 token 只在 `POST /api/admin/agents/:userId/tokens` 响应里返回一次，后端落盘只存 sha256；用户关闭页面后，列表里再点 token 只能看到 `sha256:b552…`。

### 2.5 页面 4：访问日志 `/admin/audit`

**线框：**

```
┌──────────────────────────────────────────────────────────┐
│ 访问治理 / 访问日志                                       │
│ 查看 MCP Proxy 记录的所有工具调用，可按用户、工具、状态过滤。│
├─ 过滤器 ─────────────────────────────────────────────────┤
│ 用户 [全部 ▾]  工具 [全部 ▾]  状态 [全部 ▾]               │
│ 时间 [最近 24h ▾]  搜索表名 [______]   [导出 CSV]         │
├──────────────────────────────────────────────────────────┤
│ 时间                用户   工具       表                 │
│ ────────────────── ────── ────────── ────────────────── │
│ 2026-06-19 14:23   张三   sl_query   dataforai.super…   │
│                    ok · 247ms · req_id:42               │
│                    [展开查看 args / SQL / 错误]          │
│ 2026-06-19 14:20   张三   sl_query   dataforai.super…   │
│                    denied · table_forbidden             │
├──────────────────────────────────────────────────────────┤
│ 1-20 / 共 5,847 条           [‹ 上一页] [下一页 ›]        │
└──────────────────────────────────────────────────────────┘
```

每行可点开看：完整 args JSON、`error_detail`、`duration_ms`。

---

## 3. 数据模型（TypeScript / YAML / SQL）

### 3.1 access.yaml schema（在 spec 07 §5.1 基础上扩展）

```yaml
users:
  - id: zhangsan                     # ← 不可改主键，[A-Za-z0-9_-]{1,32}
    name: 张三                        # 显示名
    note: ""                         # 新增：备注
    enabled: true                    # 新增：启用开关；false 时代理直接 401
    tokens:
      - hash: "sha256:b552dcab..."   # 64 hex
        label: hermes-laptop         # 必填，唯一在同一 user 内
        created: 2026-06-18          # ISO date
        expires_at: null             # 新增：可选 ISO date 或 null
        last_used: "2026-06-19T14:23:00Z"  # 新增，由 audit 表派生
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_query
        - sl_read_source

defaults:
  deny_tools:
    - sql_execution
    - memory_ingest
    - memory_ingest_status
```

新增字段：`enabled` / `note` / `tokens[].expires_at` / `tokens[].last_used`。
**`last_used` 是只读派生字段**：保存时被剥离，加载时由 audit 表 `MAX(ts)` 算回填。

### 3.2 前端共享类型 `webui/src/lib/types.ts` 增量

```ts
export type Agent = {
  id: string;                        // = yaml.users[].id
  name: string;
  note?: string;
  enabled: boolean;
  tokens: TokenSummary[];
  allow: {
    tables: string[] | ["*"];        // "*" 即通配
    tools: string[] | ["*"];
  };
  stats?: AgentStats;                // 由 audit 派生
};

export type TokenSummary = {
  hash: string;                      // "sha256:<hex>"
  label: string;
  created: string;                   // ISO date
  expires_at?: string | null;
  last_used?: string | null;         // ISO datetime, 派生
  revoked?: boolean;                 // 来自 revoked_tokens 表
  revoked_at?: string;
  revoke_reason?: string;
};

export type AgentStats = {
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;                 // ISO datetime
  topTables: Array<{ table: string; calls: number }>;
};

export type AgentPatch = {
  name?: string;
  note?: string;
  enabled?: boolean;
  allow?: {
    tables?: string[] | ["*"];
    tools?: string[] | ["*"];
  };
};

export type CreateAgentBody = {
  id: string;
  name: string;
  note?: string;
  allow: { tables: string[] | ["*"]; tools: string[] | ["*"] };
};

export type CreateTokenBody = {
  label: string;
  expires_at?: string | null;
};

export type CreateTokenResponse = {
  token: string;                     // ← 明文，仅此响应返回一次
  hash: string;                      // 写入 yaml 的内容
  label: string;
  created: string;
  expires_at?: string | null;
};

export type AuditLogEntry = {
  id: number;
  ts: string;
  userId: string;
  client?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  outcome: "ok" | "error" | "denied";
  errorDetail?: string;
  durationMs: number;
  requestId: string | number;
};

export type AuditQuery = {
  user?: string;
  tool?: string;
  outcome?: "ok" | "error" | "denied";
  since?: string;                    // ISO datetime
  until?: string;
  tableSearch?: string;              // 子串
  limit?: number;                    // 默认 50
  offset?: number;                   // 默认 0
};

export type AuditResponse = {
  total: number;
  entries: AuditLogEntry[];
};

export type McpToolInfo = {
  name: string;
  description?: string;
  globalDenied: boolean;             // = defaults.deny_tools 命中
};
```

### 3.3 SQLite schema 增量

沿用 spec 07 §5.2 的 `access_log` / `revoked_tokens`，新增视图便于 stats 查询：

```sql
-- 不新增表；仅在后端 audit.ts 内提供查询函数
-- SELECT user_id, COUNT(*) FROM access_log WHERE ts >= datetime('now','-7 days') GROUP BY user_id;
-- SELECT user_id, MAX(ts) AS last_seen FROM access_log GROUP BY user_id;
```

### 3.4 文件落盘策略

| 数据 | 落盘位置 | 写入路径 |
|---|---|---|
| Agent 元数据、ACL | `webui/config/access.yaml` | `fs-safe` 新增白名单根 `webui/config` |
| Token sha256 hash | 同上，`users[].tokens[]` | 同上 |
| Token 明文 | **从不落盘** | 仅 HTTP 响应一次 |
| revoked token 记录 | `.ktx-ui/audit.sqlite.revoked_tokens` | better-sqlite3 |
| 访问日志 | `.ktx-ui/audit.sqlite.access_log` | 同上 |

`fs-safe.ts` 当前白名单是 `['semantic-layer', 'wiki', '.ktx-ui']`。需要把 `webui/config` 加入：

```ts
const ALLOW = ['semantic-layer', 'wiki', '.ktx-ui', 'webui/config'];
```

**注意**：webui 当前 cwd 是 `project-lucy` 根，`webui/config/access.yaml` 是相对项目根的路径。Builder 需要在 `fs-safe.ts` 单测中补充这条新白名单的覆盖。

---

## 4. API 契约

### 4.1 通用约定

- 沿用现有 envelope `{ ok: true, data }` / `{ ok: false, error }`（ADR-09）。
- 所有写类端点支持 `?dryRun=true` 返回 diff/proposedYaml，默认 `true`，与 `/api/sources` 一致。
- 错误码新增：`AGENT_NOT_FOUND` `AGENT_ID_TAKEN` `TOKEN_NOT_FOUND` `TOKEN_LABEL_TAKEN` `INVALID_ACL`。

### 4.2 端点清单

```text
GET    /api/admin/agents                       # 列表 + 统计
POST   /api/admin/agents                       # 新建
GET    /api/admin/agents/:userId               # 详情
PATCH  /api/admin/agents/:userId               # 部分更新（name/note/enabled/allow）
DELETE /api/admin/agents/:userId               # 删除

POST   /api/admin/agents/:userId/tokens                 # 生成新 token（返回明文一次）
DELETE /api/admin/agents/:userId/tokens/:label          # 撤销

GET    /api/admin/audit                        # 访问日志查询
GET    /api/admin/audit/export                 # CSV 导出
GET    /api/admin/mcp-tools                    # 当前 MCP server 暴露的工具清单
```

### 4.3 端点细节

**`GET /api/admin/agents`**

Query: 无。
Response:
```jsonc
{ "ok": true, "data": {
  "agents": [
    {
      "id": "zhangsan",
      "name": "张三",
      "note": "",
      "enabled": true,
      "tokens": [{
        "hash": "sha256:b552...",
        "label": "hermes-laptop",
        "created": "2026-06-18",
        "expires_at": null,
        "last_used": "2026-06-19T14:23:00Z"
      }],
      "allow": { "tables": ["dataforai.superstore_orders"], "tools": ["sl_query", "..."] },
      "stats": {
        "callsLast7d": 247,
        "deniedLast7d": 3,
        "lastSeen": "2026-06-19T14:23:00Z",
        "topTables": [{ "table": "dataforai.superstore_orders", "calls": 240 }]
      }
    }
  ]
}}
```

**`POST /api/admin/agents`**

Body:
```jsonc
{
  "dryRun": false,
  "agent": {
    "id": "wangwu",
    "name": "王五",
    "note": "市场部分析助理",
    "allow": { "tables": ["dataforai.superstore_orders"], "tools": ["sl_query", "wiki_search"] }
  }
}
```
- `id` 唯一，正则 `^[A-Za-z0-9_-]{1,32}$`，重复返回 `409 AGENT_ID_TAKEN`。
- `dryRun:true` 返回 `{ diff, proposedYaml }`；`false` 写回 access.yaml。
- 创建后 `tokens` 为空数组；调用方必须再走 `POST .../tokens` 才能拿到明文。

Response (`dryRun:false`):
```jsonc
{ "ok": true, "data": { "written": true, "agent": { ... } } }
```

**`PATCH /api/admin/agents/:userId`**

Body:
```jsonc
{ "dryRun": false, "patch": { "enabled": false, "allow": { "tools": ["*"] } } }
```
- 只允许 `name` / `note` / `enabled` / `allow` 更新。
- `id` 和 `tokens` 不可通过此端点改（tokens 用专属端点）。
- 改完触发 `access.yaml` 30s TTL 自然刷新；可选 query `?reload=true` 主动通知代理刷新（POST `:7879/_admin/reload`，仅本机）。

**`DELETE /api/admin/agents/:userId`**

- 软删：同时把该用户所有 token hash 写入 `revoked_tokens` 表（reason: `agent_deleted`），再从 yaml 删除该 user。
- Response: `{ ok: true, data: { written: true } }`。

**`POST /api/admin/agents/:userId/tokens`**

Body:
```jsonc
{ "label": "hermes-laptop", "expires_at": null }
```
后端流程：
1. 校验 label 在该 user 内不重复；
2. `crypto.randomBytes(32).toString('hex')` 生成 64 字符明文；
3. `sha256(token)` 算 hash；
4. 写入 yaml（经 `fs-safe`）；
5. 响应里同时返回明文和 hash。

Response:
```jsonc
{ "ok": true, "data": {
  "token": "4f7a9c...64hex",
  "hash": "sha256:b552...",
  "label": "hermes-laptop",
  "created": "2026-06-19",
  "expires_at": null
}}
```

**`DELETE /api/admin/agents/:userId/tokens/:label`**

- 从 yaml `users[].tokens[]` 删该 label；
- 同步把 hash 写入 `revoked_tokens` 表（reason: `manual_revoke`）；
- proxy 下次请求会立刻拒绝（TTL 内仍可能放行 ≤30s，可在响应里说明）。

Response: `{ ok: true, data: { written: true, revokedAt: "2026-06-19T15:00:00Z" } }`

**`GET /api/admin/audit`**

Query 参数对应 `AuditQuery`。

Response:
```jsonc
{ "ok": true, "data": {
  "total": 5847,
  "entries": [{
    "id": 1029,
    "ts": "2026-06-19T14:23:00.000Z",
    "userId": "zhangsan",
    "client": "hermes",
    "tool": "sl_query",
    "tables": ["dataforai.superstore_orders"],
    "argsSummary": { "measures": ["weighted_discount"] },
    "outcome": "ok",
    "durationMs": 247,
    "requestId": 42
  }]
}}
```

SQL（参考实现）：
```sql
SELECT * FROM access_log
WHERE (:user IS NULL OR user_id = :user)
  AND (:tool IS NULL OR tool = :tool)
  AND (:outcome IS NULL OR outcome = :outcome)
  AND (:since IS NULL OR ts >= :since)
  AND (:until IS NULL OR ts <= :until)
  AND (:tableSearch IS NULL OR tables LIKE '%' || :tableSearch || '%')
ORDER BY ts DESC LIMIT :limit OFFSET :offset;
```

**`GET /api/admin/audit/export`**

同 query，但响应是 `text/csv` 流。Header: `Content-Disposition: attachment; filename="audit-YYYYMMDD.csv"`。

**`GET /api/admin/mcp-tools`**

Response:
```jsonc
{ "ok": true, "data": {
  "tools": [
    { "name": "sl_query", "description": "Query semantic layer", "globalDenied": false },
    { "name": "sql_execution", "description": "Raw SQL", "globalDenied": true }
  ]
}}
```
实现：从代理启动时缓存的 KTX `tools/list` 调用结果读取，叠加 `defaults.deny_tools`。
[假设：MCP Proxy 启动时已调用 KTX `tools/list` 并缓存。] 如未缓存，需要在 proxy 内新增一次启动期 fetch。

---

## 5. 关键交互流程

### 5.1 创建 Agent → 配置权限 → 生成 Token 完整链路

```
管理员                WebUI 前端           Fastify API           fs-safe         access.yaml      audit.sqlite
  │                      │                    │                     │                  │                │
  │ 点「新建 Agent」     │                    │                     │                  │                │
  │ 填表 id/name/allow   │                    │                     │                  │                │
  │ 点「预览」           │                    │                     │                  │                │
  │                      │ POST /api/admin/agents?dryRun=true       │                  │                │
  │                      │─────────────────────▶                    │                  │                │
  │                      │                    │ 加载 yaml,         │                  │                │
  │                      │                    │ 校验 id 唯一,       │                  │                │
  │                      │                    │ 生成 proposedYaml   │                  │                │
  │                      │                    │ 调 diff.previewDiff │                  │                │
  │                      │                    │                     │                  │                │
  │                      │ ◀── { diff, proposedYaml } ─────         │                  │                │
  │ 看 diff,点「保存」   │                    │                     │                  │                │
  │                      │ POST /api/admin/agents?dryRun=false      │                  │                │
  │                      │─────────────────────▶                    │                  │                │
  │                      │                    │ safeWrite ────────▶ │ 写 webui/config/access.yaml      │
  │                      │                    │                     │                  │                │
  │                      │ ◀── { written: true, agent } ────────────                  │                │
  │                      │ 跳转 /admin/agents/wangwu                │                  │                │
  │                      │                                          │                  │                │
  │ 点「新建 Token」     │ navigate /admin/agents/wangwu/tokens/new │                  │                │
  │ 填 label             │                                          │                  │                │
  │                      │ POST /api/admin/agents/wangwu/tokens     │                  │                │
  │                      │─────────────────────▶                    │                  │                │
  │                      │                    │ randomBytes(32)     │                  │                │
  │                      │                    │ sha256(token)       │                  │                │
  │                      │                    │ safeWrite tokens[] ▶                    │                │
  │                      │                    │                     │ users[].tokens += │                │
  │                      │ ◀── { token, hash, label, created }       (明文仅此一次返回) │                │
  │ 复制 token,关闭页面  │                    │                     │                  │                │
  │ ────────────────────────────────────────────────────────────────────────────────────                │
  │ 拿 token 配 .mcp.json,启动 Claude Code                          │                  │                │
  │ Agent 发起请求 → :7879/mcp Bearer <token>                       │                  │                │
  │                                                                  │                  │                │
  │                  proxy: identity.identifyRequest                  │                  │                │
  │                       sha256 比对 access.yaml.users[].tokens[].hash                  │                │
  │                       acl.check(userId, tool, args)                                  │                │
  │                       转发到 :7878                                                   │                │
  │                       audit.writeLog ───────────────────────────────────────────────▶ access_log    │
```

### 5.2 撤销 Token 流程

```
管理员 → 点 token 卡片「撤销」 → 弹确认（红色危险动作） → 确认
      → DELETE /api/admin/agents/zhangsan/tokens/hermes-laptop
      → 后端：
          1. fs-safe 写 access.yaml，移除 tokens[label=hermes-laptop]
          2. better-sqlite3 INSERT INTO revoked_tokens (token_hash, revoked_at, reason='manual_revoke')
          3. （可选）通知 proxy 立即刷新缓存
      → 响应 { written: true, revokedAt }
      → 前端 toast "已撤销。代理可能在 30 秒内仍接受该 token。"
```

### 5.3 编辑 ACL 时的并发安全

[假设：单管理员单本机]，不做行级锁；但 `PATCH /api/admin/agents/:userId` 后端必须：
1. 读取 access.yaml 当前 mtime + sha256 算"版本号"；
2. 客户端在 GET 详情时收到 `version`，PATCH 时回传；
3. 服务端比对，若不一致返回 `409 BAD_REQUEST` "yaml 已被其他来源修改，请刷新"。

防止脚本/编辑器并行改 yaml 时丢失数据。

### 5.4 page-1 列表的 stats 怎么算

后端 `GET /api/admin/agents` 一次性算所有 user 的 stats：

```sql
SELECT user_id,
       COUNT(*) AS calls7,
       SUM(CASE WHEN outcome='denied' THEN 1 ELSE 0 END) AS denied7,
       MAX(ts) AS last_seen
FROM access_log
WHERE ts >= datetime('now', '-7 days')
GROUP BY user_id;
```

Top tables 单独一条 query（每 user 限 3 行）。
**性能注意**：spec 07 §5.2 已建 `idx_al_user_ts`，7 天 + 单本机预期 < 10ms。

---

## 6. 与现有 access.yaml / MCP Auth Proxy 的关系

### 6.1 事实源不变

- 写入路径仍是 `webui/config/access.yaml`（人可读、git 可 diff）。
- 代理仍 30s TTL 重读 yaml；本设计**不引入额外缓存层**。
- 撤销仍走 `revoked_tokens` 表，proxy 仍按 spec 07 §4.2 的流程做 hash 命中检查。

### 6.2 改动 / 新增（最小集）

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `webui/server/index.ts` | 改 | 注册 4 个 admin 路由模块 |
| `webui/server/admin/agents.ts` | 新 | yaml 读写、agent CRUD |
| `webui/server/admin/tokens.ts` | 新 | token 生成/撤销，调用 `crypto` |
| `webui/server/admin/audit.ts` | 新 | 查询 audit.sqlite（与 proxy 用同一文件） |
| `webui/server/admin/mcp-tools.ts` | 新 | 工具清单 |
| `webui/server/fs-safe.ts` | 改 | 新白名单 `webui/config` |
| `webui/server/proxy/identity.ts` | 改（最小） | 暴露 `reloadAccessConfig()` 给 `?reload=true` |
| `webui/src/lib/types.ts` | 改 | 增 §3.2 类型 |
| `webui/src/lib/apiClient.ts` | 沿用 | 复用现有 `apiGet/apiPut/apiPost`；新增 `apiPatch/apiDelete` 工具方法 |
| `webui/src/pages/admin/AgentList.tsx` | 新 | |
| `webui/src/pages/admin/AgentDetail.tsx` | 新 | |
| `webui/src/pages/admin/NewToken.tsx` | 新 | |
| `webui/src/pages/admin/Audit.tsx` | 新 | |
| `webui/src/app/App.tsx` | 改 | 路由 + 左侧导航分组 |
| `webui/config/access.yaml` | 兼容 | 新字段 `enabled` / `note` / `expires_at` 全部 optional，旧文件不破 |

### 6.3 兼容性

- 启动时如 `enabled` 缺失，视为 `true`（保持现行行为）。
- 旧 `tokens[].hash` 已有 sha256，无需迁移。
- `last_used` 是派生字段，不写入 yaml；UI 加载时 join 一次 sqlite。

### 6.4 安全约束

- WebUI 仍只绑 `127.0.0.1`，admin 路由不引入额外鉴权（依赖本机假设）。
- 明文 token 仅在 `POST .../tokens` 的 HTTP 响应里返回一次，绝不写入任何日志（前端 RTL 测试需验证 console / network log 不含明文）。
- `GET /api/admin/audit` 不返回 token、不返回密码。
- 删除 Agent 时，关联 token hash 必须写入 `revoked_tokens`，避免 yaml TTL 未刷新导致 30s 内仍可用。
- 所有 fs-safe 防护（路径白名单、`..` 穿越）继续生效。

---

## 7. 测试策略

| 层 | 重点用例 |
|---|---|
| `admin/agents.ts` 单测 | yaml round-trip 不破坏注释；新建/改名/删除；id 重复；ACL 通配 `*` 兼容 |
| `admin/tokens.ts` 单测 | randomBytes 长度 = 32B；明文不落盘；同 user 重 label 拒绝；撤销同时写 revoked_tokens |
| `admin/audit.ts` 单测 | 分页 / 过滤 / 大量数据下索引命中（解释 explain query plan） |
| fs-safe 安全回归 | 新白名单 `webui/config` 仍拒 `..` 穿越；不允许写 `webui/config/../secret` |
| API supertest | envelope 形态；token 创建响应只出现一次明文；DELETE Agent 同步触发 revoked_tokens |
| RTL 前端 | NewToken 关闭后 token 不可恢复；ACL 通配/明细切换 yaml 形态正确 |
| E2E 手动 | 新建 Agent → 生成 token → 配 .mcp.json → 拿 token 跑 sl_query → 在 Audit 页看到记录 |

---

## 8. 验收标准

完成后可在本机验证：

1. **新建 Agent 链路**：在 `/admin/agents` 点新建，填 `wangwu/王五/[sl_query]/[dataforai.superstore_orders]`，保存后 `git diff webui/config/access.yaml` 能看到新增段。
2. **Token 生成**：进 `/admin/agents/wangwu`，生成 token，浏览器明文一次性显示；`grep "sha256:" webui/config/access.yaml` 能看到对应 hash；浏览器关闭后页面里看不到明文。
3. **权限拦截**：用 wangwu 的 token 访问 `dataforai.superstore_returns` → 收到 JSON-RPC error；`/admin/audit?user=wangwu&outcome=denied` 显示该条 denied 记录。
4. **撤销**：DELETE token → 30s 后再用旧 token 必然 401；`SELECT * FROM revoked_tokens` 有该 hash。
5. **审计查询**：`/admin/audit` 默认 24h 视图能拉到 ≥ 当前 session 的所有调用，CSV 导出能下载。
6. **安全回归**：尝试 `PUT /api/admin/agents` 修改一个穿越路径（如 `../secrets`）→ 403 FORBIDDEN_PATH。
7. **回归原能力**：现有 Catalog / TableEditor / Wiki / Review 全部页面 + 测试集仍绿（`npm test` `npx tsc --noEmit` `npm run build`）。

---

## 9. 未确认假设

| 编号 | 假设 | 影响 | 建议确认方 |
|---|---|---|---|
| A1 | MCP Proxy 启动时已调用 KTX `tools/list` 并缓存工具元数据 | `GET /api/admin/mcp-tools` 否则要新加 fetch | 看 proxy 现网行为 |
| A2 | "管理员" 与 "数据工程师" 共用同一本机 WebUI session，不引入身份切换 | 若管理员独立则需做权限隔离 | 产品确认 |
| A3 | 单管理员本地写 yaml，并发改动概率极低 | 决定是否要 ETag 乐观锁 | 工程评估 |
| A4 | access.yaml 30s TTL 是产品可接受的撤销延迟 | 是 → 不做主动 reload；否 → 加 `?reload=true` 路径 | 安全/产品确认 |
| A5 | `webui/config/` 作为新白名单根可被 fs-safe 接受（无符号链接逃逸风险） | 决定 fs-safe 单测范围 | 工程实现时验证 |
| A6 | Token 过期（expires_at）是 v1 必选还是 v2 再做 | 决定 NewToken 页面是否要日期选择器 | 产品确认（设计已带 optional 字段，可推迟） |

如未在开发前确认，按 A1=已缓存、A2=共用、A3=用 yaml mtime + sha256 弱乐观锁、A4=可接受、A5=可接受、A6=v1 字段保留但 UI 隐藏 实现。
