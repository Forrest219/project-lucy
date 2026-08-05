# Admin Audit Turn Drilldown Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Audit Turn Drilldown Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/89-admin-audit-turn-drilldown-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 89 与 UI/UX 台账 `UX-ADMIN-AUDIT-001`～`010` |
| 输出位置 | `webui/docs/plans/wo-202608-22-admin-audit-turn-drilldown.md` |

**Goal:** `/admin/audit` 改为问询记录 + 调用流水双 Tab，起止时间拆分，与 `/admin/usage` P95 交叉验证。

**Architecture:** 扩展 `admin/audit.ts` turns API → 重构 `Audit.tsx` → 测试与台账。

**Tech Stack:** React、Fastify、better-sqlite3、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

---

## Non-Negotiable Boundaries

- 不做浏览器验证；结束后只做 code review。
- 删除 heatmap Tab UI（API `/api/admin/audit/sources` 保留）。
- 术语遵守 Spec 89 §4。

## Scope

### Phase 1: Backend

- `audit.ts`：`queryP95LatencyMs`、`enrichTurnMetrics`、`hours` on turns list/detail。
- `types.ts`：Turn 相关类型。

### Phase 2: Frontend `Audit.tsx`

- Tab：`turns` | `calls`；删 heatmap / KPI / badge。
- Turns 表 + Drawer；Calls 表 + primary 导出。
- 24h/7d segmented + P95 参照线。

### Phase 3: Redirect & tests

- `AuditSources.tsx` → `/admin/audit`。
- 重命名/替换 heatmap 测试为 turns 测试。
- 更新 `audit.test.tsx`。

### Phase 4: Docs & ledger

- `00-product-terminology-standard.md`、`06-navigation-ia.md`、`webui/docs/README.md`。
- `docs/ui-ux-feedback/pages/admin-audit.md` + README 索引。

### Phase 5: Gate

```bash
cd webui
npm test -- src/__tests__/admin-audit-turns.test.tsx src/__tests__/admin-audit.test.tsx src/__tests__/audit.test.tsx src/__tests__/audit-sources-redirect.test.tsx
npm run lint:terminology
npm run build
```
