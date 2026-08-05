# Admin Audit Clarity and Drawer UX Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Clarity and Drawer UX Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/94-admin-audit-clarity-and-drawer-ux-spec.md` |
| 适用范围 | 落地 Spec 94 与台账 `UX-ADMIN-AUDIT-011`～`017` |
| 输出位置 | `webui/docs/plans/wo-202608-27-admin-audit-clarity-and-drawer-ux.md` |

**Goal:** 提升 `/admin/audit` 问询记录可读性，优化 Drawer 分区与定位字段。

**Architecture:** 扩展 turn detail API `connectionId` → 重构 `Audit.tsx` 列表/筛选/Drawer → CSS 头部工具栏 → 测试与台账。

**Tech Stack:** React、Fastify、better-sqlite3、Vitest。

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后只做 code review。
- 不改动 Spec 89 已删除的 heatmap / KPI / count badge 行为。
- 术语遵守 Spec 94 §4。

## Scope

### Phase 1: Backend

- `webui/server/admin/audit.ts`：`mapAccessLogRow` / turn detail 为每条 `accessLogs` 附加 `connectionId`。
- `webui/src/lib/types.ts`：`AuditTurnCallLog.connectionId?`。

### Phase 2: Frontend

- `webui/src/pages/admin/Audit.tsx`
  - 拉取 `/api/admin/agents` 构建 id→name 映射。
  - 筛选/列名/列表序号/删 P95 参照句。
  - Drawer 卡片分区、表头与关闭按钮布局。
- `webui/src/app/app.css`：`pl-trace-detail-header--toolbar`。

### Phase 3: Tests & docs

- `webui/src/__tests__/admin-audit-turns.test.tsx` 更新断言。
- `webui/server/__tests__/admin-audit.test.ts`（turn detail connectionId，如有需要）。
- `webui/docs/00-product-terminology-standard.md` §4.7 补充。
- `webui/docs/README.md`、`webui/docs/plans/README.md` 登记 Spec 94 / wo-202608-27。
- `docs/ui-ux-feedback/pages/admin-audit.md` + `docs/ui-ux-feedback/README.md`。

### Phase 4: Gate

```bash
cd webui
npm test -- src/__tests__/admin-audit-turns.test.tsx server/__tests__/admin-audit.test.ts
npm run lint:terminology
npm run build
```

完成后仅输出 code review，不做浏览器验证。
