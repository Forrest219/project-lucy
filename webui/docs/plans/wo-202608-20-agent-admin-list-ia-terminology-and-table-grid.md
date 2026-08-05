# Agent Admin List IA, Terminology and Table Grid Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin List IA, Terminology and Table Grid Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/88-agent-admin-list-ia-terminology-and-table-grid-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 88 与 UI/UX 台账 `UX-ADMIN-AGENTS-022`～`026` |
| 输出位置 | `webui/docs/plans/wo-202608-20-agent-admin-list-ia-terminology-and-table-grid.md` |

**Goal:** `/admin/agents` 命名改「Agent」、删 Header badges、KPI 对齐 usage、列表改 `pl-data-grid` 表并去掉行内复制 MCP。

**Architecture:** `AgentList.tsx` 重构 + `app.css` 语义类 + 导航/面包屑/返回链 + 测试与台账。

**Tech Stack:** React、CSS（`@apply`）、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

---

## Non-Negotiable Boundaries

- 不改 `/api/admin/agents`。
- 列表页不得保留行内或页级「复制 MCP 配置」。
- 表格必须含 `pl-data-grid`；禁止继续用整行 `AgentCard` 布局。
- 不做浏览器验证。

## Scope

### Phase 1: CSS

`app.css` 增加 `.pl-agent-list-table`（对齐 Spec 82 轻量密度）。

### Phase 2: AgentList

- PageHeader / KPI / 表格 / 删 project mcp query 与诊断条。
- 保留 `buildSafeMcpConfig` 等导出供单元测试。

### Phase 3: 全站文案

`navigation.ts`、`breadcrumbs.ts`、`AgentDetail`、`NewToken`、`Onboarding` drawer、`help.ts`。

### Phase 4: 术语与 IA 文档

`00-product-terminology-standard.md` §4.5、`06-navigation-ia.md`、`webui/docs/README.md`。

### Phase 5: Tests + ledger

- `agent-list.test.tsx`、`navigation.test.ts`、`app-shell.test.tsx`、`onboarding.test.tsx`（Drawer 链文案）。
- `admin-agents.md`：`UX-ADMIN-AGENTS-022`～`026` → `Fixed`。
- `docs/ui-ux-feedback/README.md` 维护记录。

### Phase 6: Gate

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/navigation.test.ts src/__tests__/app-shell.test.tsx
npm run lint:terminology
npm run build
```
