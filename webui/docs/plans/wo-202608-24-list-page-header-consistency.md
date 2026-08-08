# List Page Header Consistency Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | List Page Header Consistency Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/91-list-page-header-consistency-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 91 与 UI/UX 台账跨页 Header 条目（含 `/help` 检查纳入） |
| 输出位置 | `webui/docs/plans/wo-202608-24-list-page-header-consistency.md` |

**Goal:** 删除列表页 PageHeader 纯计数 badges，对齐标题/容器/按钮体系，补表编辑返回入口。

**Architecture:** 各页面 `PageHeader` 调用点微调 + 评测模块根容器统一 + 测试与台账。

**Tech Stack:** React、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

---

## Non-Negotiable Boundaries

- 不改 API。
- 不删 `/publish/workbench` 工作流 badges。
- 不做浏览器验证。

## Scope

### Phase 1: PageHeader 纯计数删除与标题

- `PublishHistory.tsx`：title → 发布记录；删 badges。
- `ConfigAudit.tsx`：删 badges；导出改 secondary。
- `RunList.tsx`：删 badges。
- `CaseList.tsx`：删 case 数 badge，保留 Run 摘要。

### Phase 2: 容器与按钮体系

- `RunList` / `CaseList` / `RunDetail` / `CaseEditor` / `NewToken` / `SecurityCandidates` → `pl-page-stack`。
- `SecurityCandidates`：删 breadcrumbs；主按钮 `pl-btn--primary`。

### Phase 3: 表编辑 backAction

- `TableEditor.tsx`：`Link` + `backAction`。

### Phase 4: 文档与台账

- `webui/docs/README.md` 登记 Spec 91。
- `webui/docs/plans/README.md` 登记本工单。
- `docs/ui-ux-feedback/README.md`：页面索引 + 维护记录 + 跨页面主题 `list-page header count badge`。
- `publish-history.md`、`eval.md`（新建）、`admin-config-audit.md`（新建）、`catalog.md` 条目 → `Fixed`。
- `help.md`（新建）：登记 `/help` 检查结论与后续一致性跟踪项。

### Phase 5: Tests + Gate

```bash
cd webui
npm test -- src/__tests__/publish-history.test.tsx src/__tests__/admin-config-audit.test.tsx src/__tests__/eval-cases.test.tsx src/__tests__/security-eval-candidates.test.tsx src/__tests__/table-editor.test.tsx
npm run lint:terminology
npm run build
```
