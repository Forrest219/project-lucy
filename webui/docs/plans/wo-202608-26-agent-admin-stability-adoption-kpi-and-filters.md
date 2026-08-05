# Agent Admin Stability and Adoption KPI Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Stability and Adoption KPI Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/93-agent-admin-stability-adoption-kpi-and-filters-spec.md` |
| 适用范围 | `/admin/agents` 指标、表格、筛选器与 API summary 扩展 |
| 输出位置 | `webui/docs/plans/wo-202608-26-agent-admin-stability-adoption-kpi-and-filters.md` |

**Goal:** 将 Agent 列表从拒绝导向切换到稳定性与使用率导向，并补齐关键时间字段与多维筛选。

**Architecture:** 后端 `agents` 聚合补充 timeline + activeAgentCount；前端 `AgentList` 重排 KPI/表头/筛选器；测试与台账同步。

**Tech Stack:** Fastify、React、TanStack Query、Vitest。

## Non-Negotiable Boundaries

- 不改 Agent CRUD 主流程与权限校验逻辑。
- 不删除后端 denied 统计字段，仅不在列表主视图展示。
- 不做浏览器验证，结束后只做 code review + 自动化测试。

## Scope

### Phase 1: 后端口径与字段补齐

- `webui/server/admin/agents.ts`
  - summary 增加 `activeAgentCountLast7d`。
  - 增加 per-agent timeline 查询：`createdAt`、`configUpdatedAt`。
  - 在 `/api/admin/agents` 与 `/api/admin/agents/:id` 返回上述字段。

### Phase 2: 前端 KPI / 表格 / 筛选器改造

- `webui/src/pages/admin/AgentList.tsx`
  - KPI 切换为 4 卡（总数、调用量、活跃 Agent、活跃 Token）。
  - 表头改为 Spec 93 顺序，移除「近 7 天拒绝」列。
  - 新增多维筛选：角色、近 7 天活跃、配置 Token 分层。
  - 增加时间格式化展示 `创建日期` 与 `配置最后变更时间`。

### Phase 3: 类型与测试

- `webui/src/lib/types.ts` 增加 `Agent.createdAt/configUpdatedAt`、`summary.activeAgentCountLast7d`。
- `webui/src/__tests__/agent-list.test.tsx` 更新 KPI/表头断言并新增筛选用例。

### Phase 4: 台账与索引更新

- 新增 `docs/ui-ux-feedback/pages/admin-agents.md` 条目 `UX-ADMIN-AGENTS-031`～`033`（状态 `Fixed`）。
- `docs/ui-ux-feedback/README.md` 增加本轮维护记录，并更新 cross-cutting 主题。
- `webui/docs/README.md` 与 `webui/docs/plans/README.md` 登记 Spec 93 / `wo-202608-26`。

### Phase 5: 验证与收尾

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx
npm run lint:terminology
npm run build
```

完成后仅输出 code review 与测试结果，不做浏览器验证。
