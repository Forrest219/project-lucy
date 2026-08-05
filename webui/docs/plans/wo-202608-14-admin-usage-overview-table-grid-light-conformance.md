# Admin Usage Overview Table Grid Light Conformance Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Table Grid Light Conformance Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/82-admin-usage-overview-table-grid-light-conformance-spec.md`（v1.0）；定位评估结论；`11-components-data-grid.md` |
| 适用范围 | 落地 Spec 82：使用概况三表轻量 `pl-data-grid` 收敛与台账更新 |
| 输出位置 | `webui/docs/plans/wo-202608-14-admin-usage-overview-table-grid-light-conformance.md` |

**Goal:** 将 `/admin/governance` 三张表从手写 Tailwind 表格基线收敛到 `pl-data-grid` 轻量遵从；不搬 connections 工作台全套列模板。

**Architecture:** 前端 `GovernanceOverview.tsx` + `app.css` 最小语义类；测试断言 class 契约；更新 UI/UX 台账。

**Tech Stack:** React、CSS（`@apply`）、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿 |

---

## Codex Prompt

在 `/Users/zhangxingchen/Projects/project-lucy/webui` 执行本工单。先读 Spec **82 v1.0**。

必须先阅读：`../docs/DEVELOPMENT.md`、`docs/design-system/11-components-data-grid.md`、`docs/82-admin-usage-overview-table-grid-light-conformance-spec.md`、`src/pages/admin/GovernanceOverview.tsx`、`src/app/app.css`、`src/__tests__/admin-governance-observability.test.tsx`。

## Non-Negotiable Boundaries

- 不改 Spec 78 KPI/API/窗口口径。
- 不引入 `pl-schema-asset-table` colgroup / Manifest 操作链。
- 三表必须含 `pl-data-grid`；禁止继续用手写 `min-w-full divide-y … text-sm` 基线。
- 不做浏览器验证 / 移动窄屏。
- 台账新增 `UX-ADMIN-GOV-009` 并在实现后标 `Fixed`。

## Scope

### Phase 1: CSS tokens

在 `src/app/app.css` 增加 `.pl-usage-overview-table` / `-num` / `-name-link` / 表内 `.pl-row-action-link`（见 Spec §6.3）。

### Phase 2: GovernanceOverview tables

三表改为 Spec §6.1 结构；数量列、对象链、审计链按 §6.2–6.3。

### Phase 3: Tests + ledger

- `admin-governance-observability.test.tsx`：断言三表 `pl-data-grid`；无旧基线 class。
- `docs/ui-ux-feedback/pages/admin-governance.md`：追加 `UX-ADMIN-GOV-009`，落地后 `Fixed`。
- `docs/ui-ux-feedback/README.md`：页面索引已有则只补维护记录；`webui/docs/README.md` 可补 Spec 82 索引行。

### Phase 4: Gate

```bash
cd webui
npm test -- src/__tests__/admin-governance-observability.test.tsx
npm run lint:terminology
npm run build
```

## Out of Scope

其他 admin 表；浏览器 E2E；Spec 78 行为回改。
