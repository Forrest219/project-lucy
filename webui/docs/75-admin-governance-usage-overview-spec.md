# Admin Governance Usage Overview Spec

| 元数据 | 内容 |
|---|---|
| Document name | Admin Governance Usage Overview Spec |
| Document type | Product / API / UX Spec |
| Version | v0.3 |
| Written date | 2026-08-04 |
| Related blueprint | `docs/lucy-202608-reliable-delivery-upgrade-spec.md` |
| Related execution control | `docs/lucy-202608-upgrade-execution-control.md` |
| Related page | `/admin/governance` |
| Related plan | `docs/plans/wo-202608-GOV-02a-admin-governance-usage-overview-dashboard.md` |
| Fact source | `http://127.0.0.1:55176/admin/governance`（历史核查）、`webui/server/admin/governance-observability.ts`、`webui/src/pages/admin/GovernanceOverview.tsx`、`webui/server/admin/audit.ts`（`access_log`/`access_log_sources` schema）、`webui/server/admin/agents.ts`（`access.yaml` 解析） |
| Related standard | `webui/docs/00-product-terminology-standard.md` |

## 1. Background

目前 `/admin/governance` 首屏仍围绕风险对象巡检（Agent 风险排行、Role 边界、拒绝原因、Token 巡检）展示，运营侧第一反应点是“今天在用什么、用得有多频、在查哪些表”。

本批先做 **usage-first**，把主屏恢复为“可运维监控”，把风险和合规模块的默认展示从主屏下沉。该方向与现有事实源一致：必须来自 `access_log`、`access_log_sources`、`access.yaml`，不引入手工模拟值。

## 2. Goals

1. 将 `/admin/governance` 首屏定义为“使用概况”视图。
2. 首屏固定展示 8 项 KPI（见 5 节）并支持 24h / 7d 切换。
3. 模块重映射为使用导向：
   - `Agent 风险排行` -> `Agent 使用排行`
   - `Role 边界` -> 角色入口，不再展示边界评分
   - `拒绝原因` -> 不在主屏显示，保留审计深挖入口
   - `Token 巡检` -> `Token 使用摘要`（列表展示：Token label、Agent、最近访问，不做 KPI 重复汇总）
4. 新增“最受访问表（Top 10）”，回答“哪些表最受欢迎”。
5. 回传字段全部可由已有数据库与 YAML 计算，且支持前端联动。
6. 与 `/overview`、`/admin/agents`、`/admin/roles` 的整体布局风格一致，采用统一基础容器与面板体系（`pl-page-stack`、`pl-metric-grid`、`pl-panel`）。

## 3. What We Do Not Change

- 不做 Risk Review 流程重建、合规修复、角色边界告警闭环。
- 不改 `access.yaml` schema 与风控策略。
- 不新增长期趋势图（只做 24h/7d 窗口聚合）。
- 不在主屏展示 token 明文、SQL 原文或原始问题文本。
- 不重建 `69-admin-governance-observability-spec.md` 中的 `roles` / `denials` 风险能力：保留其接口供跳转审计与下阶段风险深挖。

## 4. Terminology Compliance

该功能遵循 `webui/docs/00-product-terminology-standard.md`。

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| usage snapshot | 使用概况 | 风控看板 | `/admin/governance` 聚合指标区 |
| recent calls | 调用量 | 最近调用 | `hours` 窗口内 `access_log` 调用数 |
| average response latency | 平均响应时长 | 平均延迟 | 同窗口 `duration_ms` 均值 |
| active Agent | 活跃 Agent | 活跃实例 | 近 7 天有至少 1 次调用 |
| active Token | 活跃 Token | 活跃密钥 | 近 7 天出现至少 1 次 token hash |
| top used tables | 最受访问表 | 热门对象 | 近窗口按调用计数排序 |

`Agent`、`Token`、`MCP`、`access_log`、`access_log_sources`、`token_hash_prefix`、`duration_ms` 的 DOM 节点需要 `translate="no"` 与 `notranslate`。

## 5. Core KPI（8 项）

1. Agent 总数
2. 最近活跃 Agent 数（近 7 天）
3. Agent 活跃率 = 最近活跃 Agent / Agent 总数
4. 配置 Token 数
5. 近 7 天活跃 Token 数
6. Token 活跃率 = 近 7 天活跃 Token / 配置 Token
7. 调用量（24h/7d）
8. 平均响应时长（24h/7d）

口径说明：

- `Agent 总数` = `access.yaml` 中 `users.length`
- `最近活跃 Agent` = `COUNT(DISTINCT user_id)`，过滤 `ts >= now - 7 days`
- `配置 Token 数` = `SUM(length(user.tokens))`
- `近 7 天活跃 Token 数` = `COUNT(DISTINCT token_hash_prefix)`，过滤 `ts >= now - 7 days` 且 `token_hash_prefix IS NOT NULL`
- `调用量` / `平均响应时长` = 在 `hours` 窗口内分别对 `access_log` 做 `COUNT(*)` 与 `ROUND(AVG(duration_ms), 1)`

## 6. Data Sources

- `webui/config/access.yaml`：Agent 与 Token 配置。
- `access_log`（SQLite）：`ts`、`user_id`、`token_hash_prefix`、`duration_ms`、`tables`。
- `access_log_sources`（SQLite）：`physical_table`。
- `/api/admin/governance/*`：后端聚合返回，前端仅消费聚合字段。

### 6.0 聚合口径与计算边界

- `activeAgentCount` 与 `activeTokenCount` 口径固定近 7 天，不随 `hours` 切换变更。
- `calls` 与 `avgLatencyMs` 按 `overview/agents` 查询 `hours`（24/168）实时计算。
- `cards.p95LatencyMs` 与 `agents[].p95LatencyMs` 必须为真实 P95（全窗口调用），禁止用 avg 顶替。
- 使用概况主路径（`usageOverview`、`popularTables`、agents 使用字段、denials 聚合、overview cards）使用 SQL 聚合；禁止“先 `LIMIT 5000` 再在 Node 中二次汇总”。
- **已知截断：** 仅 `/api/admin/governance/roles` 仍可能通过有界审计行（`COMPAT_AUDIT_ROW_LIMIT=5000`）补充 `usageCount`；响应含 `compatTruncation.auditRowsLimit`。Token 匹配兼容 `sha256:` 有/无两种 prefix 形态。

### 6.1 最受访问表来源与回退

- 主路径：`access_log_sources.physical_table`。
- 回退路径：仅当主路径下无可用数据时（或无 `physical_table`）才回退到 `access_log.tables`（JSON 数组）聚合；两条路径互斥不合并。
- `popularTables` 与 `calls`、`lastSeen` 始终按近 7 天聚合，和 `hours` 无关。
- 目标：Top 10（按 `calls desc`）。
- 最近访问：每个表取最近 `ts`。

## 7. API Surface（本批）

### 7.1 Overview API（新增 usage 字段）

`GET /api/admin/governance/overview?hours=<24|168>`

- `hours=168`：近 7d（默认）。
- `hours=24`：近 24h。
- `popularTables` 固定按近 7 天聚合，与 `hours` 解耦。

响应示例：

```json
{
  "ok": true,
  "data": {
    "windowHours": 168,
    "usageOverview": {
      "agentCount": 0,
      "activeAgentCount": 0,
      "agentActiveRate": 0,
      "configuredTokenCount": 0,
      "activeTokenCount": 0,
      "tokenActiveRate": 0,
      "calls": 0,
      "avgLatencyMs": 0
    },
    "popularTables": [
      {
        "table": "mysql.dataforai.kx_fact_financial_amount",
        "calls": 0,
        "lastSeen": "2026-08-04T00:00:00.000Z"
      }
    ]
  }
}
```

### 7.2 Agents API（补充字段）

`GET /api/admin/governance/agents?hours=<24|168>`

响应中的 agent 行至少包含：

- `id`、`name`、`enabled`
- `calls`、`avgLatencyMs`（按 `hours`）
- `lastSeen`
- `activeTokenCount`（固定近 7 天 distinct token）
- `configuredTokenCount`
- `roleId`
- `agentHref`：`/admin/agents/:id`
- `auditHref`：`/admin/audit?user=:id`

### 7.3 Tokens API（补充字段）

`GET /api/admin/governance/tokens?hours=<24|168>`

响应中的 token 行至少包含：

- `agentId`
- `label`
- `tokenHashPrefix`
- `lastUsed`
- `activeInLast7d`
- `configured`

### 7.4 角色与拒绝接口

`GET /api/admin/governance/roles`、`GET /api/admin/governance/denials` 保持兼容与可调试，但本批不放到 `/admin/governance` 主屏。

## 8. Dashboard Mapping

| 当前区块 | 本批展示形式 |
|---|---|
| Agent 风险排行 | Agent 使用排行 |
| Role 边界 | 仅保留主流程入口（跳转 `/admin/roles`） |
| 拒绝原因 | 不展示主屏卡片；保留 `/admin/audit` 深挖 |
| Token 巡检 | Token 使用摘要（token label / Agent / 最近访问） |
| 新增 | 最受访问表（Top 10） |

## 9. UI UX

### 9.1 `/admin/governance` 结构

- 页面顶部保留 `24h` / `7d` 窗口切换。
- 顶部指标卡仅展示 8 项使用 KPI。
- 主表重命名为 `Agent 使用排行`，表头包含：`Agent`、`最近访问`、`近窗口调用`、`平均响应时长`、`活跃 Token`、`配置 Token`、`审计`。
- 增加 `最受访问表（Top 10）` 卡片：列 `表名`、`调用次数`、`最近访问`。
- 增加 `Token 使用摘要` 列表：列 `Token`（label）、`Agent`、`最近访问`、`最近活跃`，默认按 `最近访问` 降序。该列表为使用追踪，不重复展示 KPI 指标。
- 角色边界与拒绝原因不在主屏以列表块出现；仅保留侧边栏入口与 /admin/roles 跳转动作。

### 9.2 页面风格对齐（新增）

- 页面根容器使用 `pl-page-stack`，并移除独立自定义容器类导致的内边距重叠（当前已有 `pl-workspace-body` 的全局内边距）。
- 指标网格使用 `pl-metric-grid`（8 KPI 固定 4 列 x 2 行），不使用 `pl-metric-grid--three`。
- 主要列表/卡片区块统一放入 `pl-panel`，标题区使用 `pl-section-heading` 与 `pl-panel-title`。
- 表格（`Agent 使用排行`、`最受访问表`）应作为面板内容的一部分，保持与其他管理页视觉秩序一致。

### 9.3 空态

- 无调用数据时，活跃指标返回 0，比例返回 `0%`。
- 最受访问表为空时文案：`暂无表访问数据（近 7 天）`。

## 10. Acceptance Criteria

- `/admin/governance` 默认展示 4 块：使用概况、Agent 使用排行、Token 使用摘要、最受访问表（`popularTables`）。
- 8 项 KPI 均可追溯到 `access_log` 或 `access.yaml`。
- `调用量`/`平均响应时长` 与窗口切换一致联动。
- `activeAgentCount` 与 `activeTokenCount` 使用近 7 天口径。
- 不出现 `Role 边界` 与 `拒绝原因` 的主屏列表。
- `popularTables` 按 `calls` 排序返回 Top 10；主路径用 `physical_table`，回退到 `access_log.tables`。
- `overview` 以 `usageOverview` 为主渲染来源；若存在 `cards` 需视为兼容字段，不驱动主 UI。
- API 响应不包含 token 明文。
- `/admin/governance` 页面结构使用 `pl-page-stack` + `pl-metric-grid` + `pl-panel`（与 `/overview` 一致），并有 `pl-section-heading`/`pl-panel-title` 使用约束。
