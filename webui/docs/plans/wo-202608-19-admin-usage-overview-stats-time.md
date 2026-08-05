# WO-202608-19 — Admin Usage Overview Stats Time

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202608-19 Admin Usage Overview Stats Time |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 基于材料 | `webui/docs/87-admin-usage-overview-stats-time-spec.md`（v1.0） |
| 适用范围 | 执行 Spec 87 |
| 输出位置 | `webui/docs/plans/wo-202608-19-admin-usage-overview-stats-time.md` |

**Goal:** 落地 Spec 87：使用概况顶栏「统计时间」徽标（在 24h/7d 之前），布局对齐系统概览。

**Architecture:** 仅前端 `GovernanceOverview.tsx`；用 react-query `dataUpdatedAt`；不改 API。

**Tech Stack:** React + TanStack Query + Vitest。

---

### Task 1: 前端徽标

必须先阅读：`../docs/DEVELOPMENT.md`、`docs/00-product-terminology-standard.md`、`docs/87-…`、本 Plan、`GovernanceOverview.tsx`、`Onboarding.tsx`（新鲜度规则）、`admin-governance-observability.test.tsx`。

- [ ] PageHeader actions：`统计时间` 在左、segmented 在右，`flex items-center gap-3`。
- [ ] 三组 query 成功后取 max `dataUpdatedAt`；相对时间规则对齐 overview。
- [ ] `aria-hidden="true"` on badge。

### Task 2: 术语 / 台账

- [ ] §4.5 登记 Stats Snapshot Time / 统计时间。
- [ ] `UX-ADMIN-GOV-021` → Fixed；README 变更日志一行。
- [ ] `webui/docs/README.md` 索引 Spec 87。

### Task 3: 验证

```bash
npm test -- src/__tests__/admin-governance-observability.test.tsx
npm run lint:terminology
```

本轮不做浏览器验证。

### Non-Goals

刷新按钮；后端 `generatedAt`；文案改「上次更新」；E2E。
