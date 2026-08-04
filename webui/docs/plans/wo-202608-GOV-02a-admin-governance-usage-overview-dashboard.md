# 202608-GOV-02a Admin Governance Usage Overview Dashboard Work Order

## Scope Guardrail

本工单为 `/admin/governance` 首屏 usage-first 第一期交付，仅覆盖：

1. 用量指标与窗口聚合。
2. 模块映射到使用导向（非风险优先）。
3. 新增“最受访问表”展示。
4. 与现有 `/admin/audit` 的审计入口不改造。
5. `/admin/governance` 页面版式对齐 `/overview`、`/admin/agents`、`/admin/roles` 的 `pl-page-stack` + `pl-panel` 风格。
6. 采用方案 A：`Token 使用摘要` 保留为主屏列表块；不再走「配置/活跃/活跃率」三 KPI 模式。

不改造 Risk Review、角色治理自动化、合规修复流程与 Release 相关产物。

## Minimax Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 `wo-202608-GOV-02a`。

必须先阅读：

- `docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/75-admin-governance-usage-overview-spec.md`
- `src/pages/admin/GovernanceOverview.tsx`
- `server/admin/governance-observability.ts`
- `server/__tests__/admin-governance-observability.test.ts`
- `src/__tests__/admin-governance-observability.test.tsx`

## Scope

### A. API Contract（使用导向）

#### A1. `GET /api/admin/governance/overview`

返回新增字段（`data` 下）：

- `usageOverview`：8 项 KPI（Agent 总数、活跃 Agent、Agent 活跃率、配置 Token、近7天活跃 Token、Token 活跃率、调用量、平均响应时长）。
- `popularTables`：Top 10 表热度列表。

口径要求：

- `calls` 与 `avgLatencyMs` 使用查询参数 `hours`（24/168）。
- `activeAgentCount`、`activeTokenCount` 使用固定 7 天口径。
- `popularTables` 固定近 7 天聚合；优先按 `access_log_sources.physical_table` 聚合；仅在主路径无可用 `physical_table` 时，回退到 `access_log.tables` JSON 聚合。
- `popularTables` 结果按 `calls desc`。

- `overview` 以 `usageOverview` 为主渲染；如后向兼容保留 `cards` 字段则忽略不驱动 UI（仅保留测试兼容/兼容观测）。

#### A2. `GET /api/admin/governance/agents`

返回字段要求（补齐）：

- `calls`、`avgLatencyMs`（`hours` 窗口）
- `lastSeen`
- `activeTokenCount`（固定近 7 天）
- `configuredTokenCount`
- `agentHref`、`auditHref`

#### A3. `GET /api/admin/governance/tokens`

返回字段要求（补齐）：

- `activeInLast7d`（布尔）
- `configured`（是否在 `access.yaml` 中配置）
- `lastUsed`（最近访问时间）
- `tokenHashPrefix`

#### A4. `roles` 与 `denials`

- 接口保持兼容与权限校验不变。
- 仍可用于深挖，但本工单不在 `/admin/governance` 主屏直接渲染。

### B. UI 模块改造（首屏）

#### B1. Agent 模块

- `Agent 风险排行` 改名为 `Agent 使用排行`。
- 表头固定为：`Agent`、`最近访问`、`近窗口调用`、`平均响应时长`、`活跃 Token`、`配置 Token`、`审计`。
- 默认排序：`近窗口调用 desc`，次级 `最近访问 desc`（同量时优先展示新活动 Agent）。
- 链接：`agentHref` 到 Agent 明细；`auditHref` 到审计。

#### B2. Role 与拒绝模块

- `Role 边界`：不作为主屏列表显示。
- `拒绝原因`：不显示卡片或列表。
- 保留“审计页”入口，导向 `/admin/audit`。

#### B3. Token 模块

- `Token 巡检` 改为 `Token 使用摘要`。
- 列表字段：`Token`（`label`）、`Agent`、`最近访问`、`最近活跃`（优先级标记）。
- 默认按 `最近访问 desc` 展示前 N（建议 10~20）条。
- 不重复展示「配置 Token / 活跃 Token / 活跃率」 KPI。

#### B4. 最受访问表

- 新增 `最受访问表（Top 10）` 面板（默认展示）。
- 列：`表名`、`调用次数`、`最近访问`。
- 回答“哪些表最受欢迎”：仅需展示前 10 名，不做风险语义。

#### B5. 窗口切换

- 顶部保留 `24h / 7d`。
- 切换后联动刷新：
  - `调用量`
  - `平均响应时长`
  - `Agent 使用排行` 的调用与响应列。

#### B6. 页面结构风格对齐

- 根容器改为 `pl-page-stack`（避免与 `pl-workspace-body` 的通用 `p-8` 叠加错位）。
- 核心指标使用 `pl-metric-grid`（8 项固定 4 列 x 2 行）。
- `Agent 使用排行` 与 `最受访问表` 均放在 `pl-panel` 内，标题使用 `pl-section-heading` + `pl-panel-title`。
- 表格仍保留滚动容器并在面板内渲染，统一视觉密度与阴影/边框语义。

### C. 测试计划

#### C1. Backend test

文件：`server/__tests__/admin-governance-observability.test.ts`

- 验证 `overview.usageOverview` 包含 8 项 KPI 字段。
- 验证 `popularTables`：
  - 当 `access_log_sources` 有 `physical_table` 时优先使用该口径。
  - 空值/无此口径时 fallback 到 `access_log.tables`。
  - 返回 top 10 且按 `calls desc`。
  - 仅验证口径之一，不与 `access_log.tables` 合并。
- 验证 `agents` 包含 `avgLatencyMs / activeTokenCount / configuredTokenCount / lastSeen`，其中 `activeTokenCount` 固定近 7 天。
- 验证 `agents`/`overview`/`tokens` 的聚合字段通过 SQL 聚合（`COUNT`、`COUNT(DISTINCT)`、`AVG`）计算，无“LIMIT 5000 + 内存聚合”路径。
- 验证 `overview` / `agents` / `tokens` 不返回 token 明文。
- 保留既有错误 envelope 与安全断言（不得包含敏感原始参数）。

#### C2. Frontend test

文件：`src/__tests__/admin-governance-observability.test.tsx`

- 正向：
  - 页面展示 8 项使用 KPI 中的关键指标文案。
  - 页面展示 `Agent 使用排行`。
  - 页面展示 `Token 使用摘要`。
  - 页面展示 `最受访问表（Top 10）`。
- 负向：
  - 不展示 `Role 边界`。
  - 不展示 `拒绝原因`。
  - 不展示 `配置 Token / 活跃 Token / 活跃率` 的 Token 模块 KPI 卡片（已由顶部 KPI 承载）。
- 交互：
  - 切换窗口后验证 API 调用和主要字段联动。
  - 验证布局结构：`pl-page-stack`、`pl-metric-grid`、`pl-panel` 存在；`pl-metric-grid--three` 不应使用。

## 验收

- 首屏默认呈现 4 块：使用概况、Agent 使用排行、Token 使用摘要、最受访问表。
- 8 项核心 KPI 与后端口径一致，单位清晰。
- `activeAgentCount` / `activeTokenCount` 按近 7 天。
- `popularTables` 结果来源真实且可回填到前端。
- 角色边界与拒绝原因不出现在 `/admin/governance` 主屏。
- `popularTables` 与 `activeTokenCount`/`activeAgentCount` 的窗口口径与文档定义一致（`popularTables` 固定 7 天，`calls`/`avgLatencyMs` 跟随切换）。
- `roles`、`denials` 入口（/audit）仍可用于下一阶段风险深挖。
- `/admin/governance` 根结构、指标区、面板区与其他管理页一致（`pl-page-stack`、`pl-metric-grid`、`pl-panel` 与 `pl-section-heading`）。

## Verification

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- server/__tests__/admin-governance-observability.test.ts src/__tests__/admin-governance-observability.test.tsx
npm run lint:terminology
```

## Out of Scope

- Risk Review Candidate 与合规修复流程。
- Role 边界告警的自动判定与治理闭环。
- 拒绝原因趋势建模。
- Release Readiness Evidence Package。
- Safe Log-to-Security-Eval。
