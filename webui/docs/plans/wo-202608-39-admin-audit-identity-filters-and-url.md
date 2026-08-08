# Admin Audit Identity, Filters & URL Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Identity, Filters & URL Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/106-admin-audit-identity-filters-and-url-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 106 |
| 输出位置 | `webui/docs/plans/wo-202608-39-admin-audit-identity-filters-and-url.md` |

**Goal:** 访问日志双 Tab 具备可信 Key、统一序号/Header/筛选，并产品化 URL。

**Architecture:** URL 读兼容写规范；共享筛选驱动 turns/calls API；主表暴露问询 ID / 事件 ID。

**Tech Stack:** React Router searchParams、admin/audit API、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证。
- 不引入路径式 `/admin/audit/calls`。
- 不做问询级 CSV。
- 新写入禁止 `hours=168`；须兼容读取。

## Scope

### Phase 0 — Docs

- Spec 106、本工单。
- `webui/docs/README.md`、`plans/README.md`。
- 术语 §4.7 增补问询 ID / 事件 ID / view / range。

### Phase 1 — API

- `buildAccessLogFilter`：`eventId`。
- turns list：`turnId` LIKE、`tableSearch`、`outcome`（分页前）。

### Phase 2 — Audit UI

- `parseView` / `parseRange`；写入 `view`/`range`；兼容 `tab`/`hours`。
- Header：两 Tab 均导出 CSV。
- 列：序号样式；问询 ID；调用序号+事件 ID+问询 ID；Agent 列头。
- 共享筛选条 + Tab 特有；高级折叠调用侧。

### Phase 3 — Deep links

- `opsDashboard.ts`、`mcp-playground.ts` → `view=calls&range=7d`。
- 更新相关测试断言。

### Phase 4 — Ledger

- `UX-ADMIN-AUDIT-020`～`025` Fixed。
- README 维护记录、主题、治理规则。

### Phase 5 — Gate

```bash
cd webui
npm test -- --run src/__tests__/admin-audit-turns.test.tsx src/__tests__/audit.test.tsx src/__tests__/ops-dashboard.test.ts src/__tests__/onboarding.test.tsx
npm test -- --run server/__tests__/admin-audit.test.ts server/__tests__/mcp-playground-acl-preview.test.ts
npm run lint:terminology
npm run build
```

## Design System Compliance（交付）

- Referenced：`pl-data-grid` / `pl-audit-table` / PageHeader actions
- Follows：列表身份列可见；Header 槽位不随 Tab 增减
- Exceptions：导出在问询 Tab 仍导出调用流水（tooltip 说明）
