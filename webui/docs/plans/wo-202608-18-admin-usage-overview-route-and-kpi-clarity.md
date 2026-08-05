# Admin Usage Overview Route & KPI Clarity Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Route & KPI Clarity Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/86-admin-usage-overview-route-and-kpi-clarity-spec.md`（v1.0） |
| 适用范围 | 指导 Spec 86 实施与验收（本轮不做浏览器验证） |
| 输出位置 | `webui/docs/plans/wo-202608-18-admin-usage-overview-route-and-kpi-clarity.md` |

**Goal:** 落地 Spec 86：`/admin/usage` + redirect、排行 Top-10 槽位高度、授权表、多数请求耗时。

**Architecture:** 前端路由/导航 + `GovernanceOverview.tsx` + `app.css`；术语与 IA；台账。API path 不变。

**Tech Stack:** React Router、Vitest。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 执行本工单。先读 Spec **86 v1.0**。

必读：`../docs/DEVELOPMENT.md`、`docs/00-product-terminology-standard.md`、`docs/06-navigation-ia.md`、`docs/86-…`、本 Plan、`App.tsx`、`navigation.ts`、`GovernanceOverview.tsx`、相关测试、`docs/ui-ux-feedback/pages/admin-governance.md`。

## Non-Negotiable Boundaries

- 主路由 `/admin/usage`；旧 `/admin/governance` 必须 redirect。
- 不改 `/api/admin/governance/*`。
- 「授权表」≠「启用表」；禁止本页主标签「配置表」。
- P95 主标签改为「多数请求耗时」；禁止主标签「响应上限（P95）」。
- 排行 body 固定 Top-10 槽位高度。
- 不做浏览器验证；台账 Fixed。

## Scope

### Phase 0: Docs / ledger / indexes

术语 §4.5；IA；Spec/Plan README；台账 017～020；ui-ux-feedback README 索引 route 更新。

### Phase 1: Route

`navigation.ts`、`App.tsx` redirect、`navigation.test.ts` 等。

### Phase 2: UI

KPI 文案；`pl-usage-rank-body` CSS；前端测试断言。

### Phase 3: Gate

```bash
cd webui
npm test -- src/__tests__/admin-governance-observability.test.tsx \
  src/__tests__/navigation.test.ts
npm run lint:terminology
npm run build
git diff --check
```

## Out of Scope

API path 重命名；启用表口径混入；浏览器 E2E。
