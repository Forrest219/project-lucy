# Admin Usage Overview Activity Rank & Header Polish Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Activity Rank & Header Polish Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/84-admin-usage-overview-activity-rank-and-header-polish-spec.md`（v1.0）；已批准改善方案 1～7 |
| 适用范围 | 指导 Spec 84 实施与验收（本轮不做浏览器验证） |
| 输出位置 | `webui/docs/plans/wo-202608-16-admin-usage-overview-activity-rank-and-header-polish.md` |

**Goal:** 落地 Spec 84：KPI 窗口进标题、三块调用排行 1×3 条形图、Token `calls`、顶栏 segmented、删「管理角色」。

**Architecture:** 前端 `GovernanceOverview.tsx` + `app.css`；后端 `governance-observability.ts` Token 窗口调用计数；术语 `00-product-terminology-standard.md`；台账 `admin-governance.md` + `ui-ux-feedback/README.md`。不改 ACL / URL。

**Tech Stack:** React、TypeScript、Fastify、Vitest、既有 `pl-segmented-control`。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 执行本工单。先读 Spec **84 v1.0**。

必须先阅读：`../docs/DEVELOPMENT.md`、`docs/00-product-terminology-standard.md`、`docs/design-system/10-components-button.md`、`docs/84-…`、本 Plan、`GovernanceOverview.tsx`、`governance-observability.ts`、前后端 `admin-governance-observability` 测试、`docs/ui-ux-feedback/pages/admin-governance.md`。

## Non-Negotiable Boundaries

- 不迁 URL；不改 access.yaml / ACL。
- 时间窗必须用 `pl-segmented-control`，禁止贴边 `pl-btn--primary` 伪 segmented。
- 删除顶栏「管理角色」；侧栏「角色权限」保留。
- Token API 必返回 `calls`；三块按调用次数降序条形图；不做 chart 库。
- 活跃 KPI / 调用量标题必含窗口文案；卡底不再藏「近 N 有调用」类句。
- 废止 Spec 82 本页三表 `pl-data-grid` 契约；测试改断言排行 UI。
- 不做浏览器验证 / 移动窄屏；台账标 Fixed。

## Scope

### Phase 0: Terminology + Ledger + Indexes

1. 更新 `00-product-terminology-standard.md` §4.5（Spec 84 表）。
2. 追加 `UX-ADMIN-GOV-010`～`016` 至 `admin-governance.md`；落地后标 `Fixed`。
3. `docs/ui-ux-feedback/README.md`：页面索引补 Admin Governance 行；最近维护记录追加本轮。
4. `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 84 / wo-202608-16。

### Phase 1: Backend Token calls

- `queryTokenCallCounts(hours)`（按 prefix 聚合 `access_log`）。
- tokens 响应加 `calls`；排序 `calls` DESC → `lastUsed` DESC。
- 更新 `server/__tests__/admin-governance-observability.test.ts`。

### Phase 2: Frontend

- PageHeader：segmented（`--cols-2`）+ 删管理角色。
- MetricCard 标题带 `windowText`；hint 去窗口重复句。
- 三块 1×3 `pl-usage-rank-grid` + 条形 list；统一标题/副文案；Top 10。
- CSS：`pl-segmented-control--cols-2`、`pl-usage-rank-*`。
- 更新 `admin-governance-observability.test.tsx`。

### Phase 3: Gate

```bash
cd webui
npm test -- server/__tests__/admin-governance-observability.test.ts \
  src/__tests__/admin-governance-observability.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

台账 `UX-ADMIN-GOV-010`～`016` → Fixed。结束后只做 code review，不做浏览器验证。

## Out of Scope

URL `/admin/usage`；组件文件重命名；Risk 主屏；chart 库；浏览器 E2E。
