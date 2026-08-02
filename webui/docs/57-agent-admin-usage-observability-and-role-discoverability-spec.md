# Agent Admin Usage Observability and Role Discoverability Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Usage Observability and Role Discoverability Spec |
| 文档类型 | Product / UX / IA / Data Contract / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/admin/agents`、`/admin/agents/:userId`、`/admin/roles`、`/admin/roles/:roleId` |
| 关联工单 | `webui/docs/plans/wo-M55-agent-admin-usage-observability-and-role-discoverability.md` |
| 事实来源 | 2026-08-02 用户反馈、浏览器核查 `http://127.0.0.1:55176/admin/agents`、`GET /api/admin/agents`、`GET /api/admin/roles`、`examples/docker-demo/project-template/webui/config/access.yaml`、`webui/server/admin/agents.ts`、`webui/server/proxy/acl.ts` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/07-mcp-auth-proxy-spec.md`、`webui/docs/08-mcp-audit-question-tracing-spec.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/15-role-admin-spec.md`、`webui/docs/42-page-header-standardization-spec.md` |

## 1. Background

2026-08-02 对 `http://127.0.0.1:55176/admin/agents` 的浏览器核查确认，Agent 实例列表当前能展示 ACL、Token 和审计统计，但信息层级更偏配置清单，不能很好回答管理员的核心问题：“哪些 Agent / Token 最近真的在用，用了多少次，有没有被拒绝，以及权限在哪里设置”。

本轮反馈集中在 5 类问题：

1. `Token 数` 和 `Agent 数` 关系不清楚。当前两者刚好都是 2，容易被误解为一一对应。
2. `7d denied` 文案不清楚，用户不知道含义和数据来源。更重要的是，管理员更需要最近访问的 Agent / Token 数量和调用次数。
3. 列表显示 `role: demo_readonly`，但在 Agent 列表页看不出 role 的设置位置。
4. `P0 demo smoke token; not for production.` 作为内部 smoke note 暴露在列表主信息中过于突兀。
5. `3 个源 · 6 个工具` 中 `6 个工具` 当前展示价值有限。底层确实按 role 限制 MCP 工具，但 demo 环境中 2 个 Agent 绑定同一个 role，列表看起来像固定值。

Browser/API findings:

- `/api/admin/agents` 返回 2 个 Agent：`demo_agent` 与 `zhaoying`。
- 两个 Agent 均绑定 `demo_readonly`，各有 1 个 Token。
- `demo_agent.stats.callsLast7d = 10`、`deniedLast7d = 0`、`lastSeen = 2026-08-01T05:36:55.911Z`。
- `zhaoying.stats.callsLast7d = 0`、`deniedLast7d = 0`，未访问。
- `demo_readonly` 的 role 配置在 `roles.demo_readonly.allow.tools` 中显式列出 6 个 MCP 工具。
- ACL runtime 通过 `allowedToolNames` 过滤 `tools/list`，并通过 `check` 拦截 `tools/call`。

## 2. Goals

1. 让 `/admin/agents` 顶部指标优先回答真实使用情况，而不是只展示静态配置数量。
2. 明确区分“配置 Token”和“活跃 Token”。
3. 将 `7d denied` 改为中文、可解释、可追溯的数据指标。
4. 在列表页让 role 可点击、可发现，并解释 role 决定数据源与 MCP 工具权限。
5. 弱化低价值的工具数量摘要，将工具限制移到 role / 权限详情中解释。
6. 清理 demo note 的产品化表达，避免内部 smoke 文案抢占列表主信息。
7. 保持现有 ACL、audit 和 `access.yaml` 事实源不变，不引入第二套权限模型。

## 3. Non-goals

- 不改变 Lucy MCP Proxy 的鉴权、ACL 判定或 `tools/list` 过滤语义。
- 不改变 `webui/config/access.yaml` schema。
- 不新增 token scope；Token 仍继承 Agent role 的权限边界。
- 不实现多维 BI 报表或长期趋势图。
- 不做移动窄屏专项验证，除非后续工单明确要求。
- 不修改生产数据库或外部 MCP server。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Configured Token | 配置 Token | 已配置 Token | Token 数（无解释） | `access.yaml.users[].tokens` 中的 Token 数 |
| Active Token | 活跃 Token | 近 7 天活跃 Token | 最近访问的 Token 数量（无时间窗） | 近 7 天访问日志中出现过的去重 Token |
| Recent Calls | 近 7 天调用 | 最近调用次数 | 7d calls | 近 7 天 `access_log` 调用次数 |
| Recent Denials | 近 7 天拒绝 | 拒绝次数 | 7d denied | 近 7 天 `access_log` 中 `outcome='denied'` 的次数 |
| Role | 角色 | role id | 权限组（暂不引入） | Agent 引用的权限配置对象 |
| Allowed MCP Tools | 允许的 MCP 工具 | 工具权限 | 工具数（无上下文） | role 中允许暴露和调用的 MCP 工具 |

Protected terms:

- `Agent`
- `Token`
- `MCP`
- `ACL`
- `access.yaml`
- `access_log`
- role id such as `demo_readonly`
- tool names such as `connection_list`、`kx_catalog`、`sl_query`、`sl_read_source`、`wiki_read`、`wiki_search`

包含 `Agent` id、role id、Token hash prefix、MCP tool name、文件路径、URL、数据库对象名的 DOM 节点必须使用 `translate="no"` 和 `notranslate`。

## 5. Current Behavior

### 5.1 Agent List Metrics

Current metrics:

- `Agent 数`：`agents.length`，提示为 `access.yaml 中的实例`。
- `启用数`：`agents.filter(agent.enabled).length`。
- `Token 数`：`agents.reduce(sum + agent.tokens.length)`，提示为 `不含明文 token`。
- `7d denied`：`agents.reduce(sum + agent.stats.deniedLast7d)`，提示为 `来自 Agent stats 汇总`。

Issues:

- `Token 数` 是静态配置数量，不代表实际使用。
- `7d denied` 英文缩写不符合中文运维页面语境。
- 顶部缺少 `近 7 天调用` 和 `活跃 Token`，无法快速判断用户使用情况。

### 5.2 Agent Card Summary

Current card summary:

```text
role: demo_readonly · 1 个 token · 3 个源 · 6 个工具
Resource scope：3 个源 / 1 个 connection
Tool scope：connection_list, kx_catalog, sl_query, sl_read_source, wiki_read, wiki_search
最近访问 1 天前 · 近 7 天 10 次调用 / 0 次拒绝
P0 demo smoke token; not for production.
```

Issues:

- `role: demo_readonly` 不是链接，不能直接跳到设置位置。
- `1 个 token` 未说明是配置 Token 还是活跃 Token。
- `6 个工具` 在 demo 环境中重复出现，信息价值低。
- `Tool scope` 直接占用列表纵向空间，适合详情页而非列表主卡片。
- 内部 smoke note 直接展示，产品化语气不足。

### 5.3 Role Setup Discoverability

Current reachable paths:

- `/admin/agents/:userId` 基本信息中可以选择 role，并有 `管理角色 ->` 链接。
- `/admin/roles` 列出 `demo_readonly`，可编辑。
- `/admin/roles/demo_readonly` 展示 `MCP 工具`、Connections、Table Selectors。

Issue:

- 从 `/admin/agents` 列表页看不到 role 是可管理对象，用户容易认为设置位置缺失。

## 6. Target UX

### 6.1 Top Metrics

Replace the current metric set with:

| Metric | Definition | Hint |
|---|---|---|
| `Agent 数` | `agents.length` | `access.yaml 中的实例` |
| `活跃 Token` | 近 7 天访问日志中去重 `token_hash_prefix` 数 | `近 7 天有访问记录` |
| `近 7 天调用` | 所有 Agent 的 `stats.callsLast7d` 汇总 | `来自访问日志 access_log` |
| `近 7 天拒绝` | 所有 Agent 的 `stats.deniedLast7d` 汇总 | `outcome=denied` |

Secondary placement:

- `启用数` 可以保留在 PageHeader badges：`2 已启用`。
- `配置 Token` 可以保留在 PageHeader badges：`2 配置 Token`。

Rationale:

- 顶部指标应优先表达近期使用，而不是静态配置。
- 拒绝次数仍重要，但不再单独用英文缩写抢占理解成本。

### 6.2 Agent Card

Target card summary:

```text
角色：demo_readonly · 3 个授权源
最近访问 1 天前 · 近 7 天 10 次调用 · 1 个活跃 Token · 0 次拒绝
配置 Token：1 个
```

Role behavior:

- `demo_readonly` 渲染为 link：`/admin/roles/demo_readonly`。
- Link accessible name：`查看角色 demo_readonly`。
- role id DOM 加 `notranslate` / `translate="no"`。

Usage row:

- 如果 `callsLast7d = 0`：`最近访问 未访问 · 近 7 天 0 次调用 · 0 个活跃 Token · 0 次拒绝`。
- 如果 Agent 有配置 Token 但无活跃 Token，不显示为异常，只表达事实。
- 如果 `deniedLast7d > 0`，拒绝数字使用 warning / danger tone，但不改变布局。

Tool summary:

- 列表页默认不展示完整 `Tool scope`。
- 保留一个弱入口：`查看权限`，指向 `/admin/agents/:userId?tab=permissions`。
- 详情页权限预览继续展示 `允许的 MCP 工具` chips。

### 6.3 Role Pages

Role list and detail must clarify that MCP tools are a real runtime boundary:

- Role list card text: `允许的 MCP 工具：6 个`。
- Role detail label: `允许的 MCP 工具（过滤 tools/list，并拦截未授权 tools/call）`。
- Keep tool chips visible on role detail.
- Do not show this long explanation repeatedly on every Agent list card.

### 6.4 Demo Note

For demo templates:

- Replace `P0 demo smoke token; not for production.` with `Demo 烟测账号，请勿用于生产。`
- In Agent list, notes should be visually secondary and may be omitted when they are purely internal.
- In Agent detail, notes remain editable and visible.

This spec does not require changing existing customer configs automatically. It only updates demo template copy and list rendering behavior.

## 7. Data Contract

### 7.1 Current Available Data

`GET /api/admin/agents` already returns enough to compute:

- configured token count per Agent: `agent.tokens.length`.
- active token count per Agent: `agent.tokens.filter(token.last_used within last 7 days).length`.
- calls per Agent: `agent.stats.callsLast7d`.
- denied per Agent: `agent.stats.deniedLast7d`.

### 7.2 Recommended API Enhancement

For correctness and consistency, backend should add derived stats so the frontend does not reimplement time-window logic:

```ts
type AgentStats = {
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;
  activeTokensLast7d: number;
  configuredTokens: number;
  topTables: Array<{ table: string; calls: number }>;
};
```

Aggregate response should optionally include summary:

```ts
type AgentsResponse = {
  agents: Agent[];
  version: string;
  summary?: {
    agentCount: number;
    enabledAgentCount: number;
    configuredTokenCount: number;
    activeTokenCountLast7d: number;
    callsLast7d: number;
    deniedLast7d: number;
  };
};
```

If `summary` is absent, frontend may compute from per-agent fields as a compatibility fallback.

### 7.3 Active Token Definition

`activeTokensLast7d`:

- Source table: `access_log`.
- Key: `token_hash_prefix`.
- Window: `ts >= datetime('now','-7 days')`.
- Scope: per `user_id`.
- Count: `COUNT(DISTINCT token_hash_prefix)` where prefix is not null.

Expired tokens:

- If an expired token has historical usage in the last 7 days, it may count as active historical usage.
- `配置 Token` should count tokens still present in `access.yaml`; expiry-aware `可用 Token` can be added later if needed.

## 8. Implementation Requirements

### 8.1 Frontend

- Update `AgentList.tsx` metrics and card text.
- Add helper functions:
  - `isTokenRecentlyActive(token, now?)`
  - `activeTokenCount(agent, now?)`
  - `summarizeAgents(agents, now?)`
- Add role link in Agent card.
- Add `查看权限` link to Agent permissions tab.
- Remove default list rendering of full `Tool scope`.
- Rename metric labels:
  - `Token 数` -> `配置 Token` only where static count is intended.
  - `7d denied` -> `近 7 天拒绝`.
- Ensure protected terms and identifiers use translation defense.

### 8.2 Backend

- Extend `getStats(userId)` in `webui/server/admin/agents.ts` to compute `activeTokensLast7d`.
- Optionally add `summary` to `GET /api/admin/agents`.
- Preserve existing response fields for compatibility.
- Keep all audit reads read-only.

### 8.3 Demo Config

- Update demo template note in:
  - `examples/docker-demo/project-template/webui/config/access.yaml`
  - `examples/postgres-demo/project-template/webui/config/access.yaml`
  - any customer config example that carries the old smoke note.
- Do not modify secret files or real local user tokens.

### 8.4 Role Pages

- Update Role detail label for MCP tools with runtime effect explanation.
- Keep role list concise; use `允许的 MCP 工具：N 个` rather than just `N 个工具`.

## 9. Acceptance Criteria

1. `/admin/agents` no longer shows `7d denied`.
2. Top metrics include `活跃 Token`、`近 7 天调用`、`近 7 天拒绝`.
3. `近 7 天拒绝` hint mentions `access_log` or `outcome=denied`.
4. Agent card role id is clickable and opens the role detail page.
5. Agent card no longer lists the full MCP tool scope by default.
6. Agent card shows both recent usage and configured token context.
7. Demo note no longer exposes `P0 demo smoke token; not for production.`.
8. Role detail clearly states allowed MCP tools filter `tools/list` and unauthorized `tools/call`.
9. Existing ACL behavior remains unchanged:
   - unauthorized tool call returns denied.
   - `tools/list` only exposes `allowedToolNames`.
10. Frontend tests cover summary metrics, role link, active Token calculation, and removed `7d denied` text.
11. Backend tests cover `activeTokensLast7d` from `access_log`.
12. Terminology lint passes.

## 10. Open Questions

### Q1. Should active Token count include protocol-only calls?

Default: yes. If a Token appears in `access_log`, it proves the client connected. Business-only usage can be added later as a separate metric.

### Q2. Should configured Token exclude expired tokens?

Default: no for M55. Use `配置 Token` to describe tokens still present in `access.yaml`. Add `可用 Token` later only if expiry-aware operations become important.

### Q3. Should denied count stay in top metrics?

Default: yes, but after usage metrics. It is a safety signal, not the primary usage signal.

### Q4. Should tool count disappear entirely from Agent list?

Default: remove full tool list and demote count. Use `查看权限` link. If a count remains, label it `允许的 MCP 工具：6 个` and show only on hover/detail.

## 11. Verification

Required:

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx src/__tests__/admin-roles.test.tsx server/__tests__/admin-agents.test.ts
npm run lint:terminology
```

Browser verification is required only because this spec originates from browser feedback:

- Open `/admin/agents`.
- Confirm top metrics and Agent cards match target UX.
- Open role link from `demo_agent`.
- Confirm `/admin/roles/demo_readonly` explains MCP tool filtering.

Mobile narrow viewport verification is not required.
