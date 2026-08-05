# Agent Admin Naming, Filters and Save Flow Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Naming, Filters and Save Flow Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/95-agent-admin-naming-filters-and-save-flow-spec.md` |
| 适用范围 | Agent 列表命名、筛选器、详情保存流程 |
| 输出位置 | `webui/docs/plans/wo-202608-28-agent-admin-naming-filters-and-save-flow.md` |

**Goal:** 统一 Agent 显示名/用户 ID 术语；筛选器加 label 并删 Token 分层；低风险保存一步化。

## Scope

### Phase 1: AgentList

- 表头、搜索、筛选条（catalog 式 label）。
- 移除 `filterTokenBand`。
- 结果计数 `agent-list-result-count`。

### Phase 2: AgentDetail

- H1 仅显示名。
- `directSaveMutation`（低风险）；`confirmSave` Modal（角色变更）。
- 浮条：`保存` + `查看变更 diff`。

### Phase 3: 术语与台账

- `00-product-terminology-standard.md` §4.5 补充显示名/用户 ID。
- `UX-ADMIN-AGENTS-034`～`036` → `Fixed`。
- README 索引登记 Spec 95 / wo-202608-28。

### Phase 4: Gate

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx
npm run lint:terminology
npm run build
```
