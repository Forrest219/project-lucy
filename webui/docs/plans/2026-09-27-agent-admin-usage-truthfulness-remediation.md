# Agent Admin Usage Truthfulness Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** 让 `/admin/agents` 的最近访问、业务活跃、调用量、凭据使用和数据新鲜度准确反映用户真实使用行为。

**Architecture:** 保留 `access_log` 的全部 MCP 协议与业务流水，集中复用协议请求分类；Agent API 在同一 7 天窗口内一次聚合业务/协议/凭据指标，并以显式状态传播不可用或部分可信。前端仅用业务调用判定活跃，展示双时间语义、Token 生命周期和审计完整性。

**Tech Stack:** TypeScript、Fastify、SQLite、React、TanStack Query、Vitest、Testing Library。

---

### Task 1: 固化指标与术语契约

**Files:**
- Create: `webui/docs/155-agent-admin-usage-truthfulness-remediation-spec.md`
- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/docs/128-enterprise-kpi-contract-spec.md`

1. 定义协议请求、业务调用、最近 MCP 访问、最近业务使用。
2. 定义配置 Token、可用 Token、近 7 天使用过的凭据与 prefix 碰撞降级。
3. 定义 `ok / partial / unavailable`、统计时间和进程内审计写入完整性。

### Task 2: 集中调用分类与后端聚合

**Files:**
- Create: `webui/server/proxy/mcp-request-classification.ts`
- Create: `webui/server/proxy/audit-write-health.ts`
- Modify: `webui/server/proxy/audit.ts`
- Modify: `webui/server/proxy/mcp-proxy.ts`
- Modify: `webui/server/admin/audit.ts`
- Modify: `webui/server/admin/agents.ts`
- Test: `webui/server/__tests__/admin-agents.test.ts`

1. 先补协议/业务、历史 lastSeen、不可用、Token 生命周期与 prefix 碰撞测试。
2. 将协议方法集合收敛到共享模块。
3. 使用单一窗口批量聚合 Agent 指标。
4. 记录进程内审计写入 pending / failed / success 健康度。
5. 保留旧字段兼容，新增语义明确字段。

### Task 3: 前端可信呈现与刷新

**Files:**
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Test: `webui/src/__tests__/agent-list.test.tsx`

1. 不把 null/partial/unavailable 渲染为 0。
2. 活跃筛选只使用业务调用；不可用行不归类为“不活跃”。
3. 增加可用 Token、协议请求、最近业务使用和最近 MCP 访问列。
4. 默认 30 秒自动刷新，提供手动刷新和统计时间。
5. 展示审计完整性与凭据统计歧义提示。

### Task 4: 验证

1. 运行 Agent API、调用监控、访问日志和 Agent 页测试。
2. 运行 TypeScript / 构建校验。
3. 启动或复用本地服务，发起协议握手与业务调用，验证两类计数分离。
4. 用真实浏览器检查刷新、提示、表格和不可用态。
5. 审查 diff，确认兼容字段和文档同步。
