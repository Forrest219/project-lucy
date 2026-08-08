# List History Time Filter Parity Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | List History Time Filter Parity Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-07 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/122-list-history-time-filter-parity-spec.md`（v1.0） |
| 适用范围 | 落地 Spec 122 |
| 输出位置 | `webui/docs/plans/wo-202608-56-list-history-time-filter-parity.md` |

**Goal:** 配置审计时间筛选与发布记录同构；访问日志筛选栏补「时间」标签与整点 `since`（保留默认 7 天）。

**Architecture:** 对齐 `PublishHistory` 的 window 默认写入与整点 helper；不抽共享模块（两处体量小，避免无需求抽象）。

**Tech Stack:** React Router searchParams、Vitest。

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented |

---

## Non-Negotiable Boundaries

- 不做浏览器验证。
- 不改访问日志默认 `range=7d` / 顶栏统计窗。
- 不改 `/admin/usage`、`/eval/monitor`、表单日期字段。

## Scope

### Phase 0 — Docs

- Spec 122、本工单、台账 `UX-ADMIN-CONFIG-AUDIT-009` / `UX-ADMIN-AUDIT-026`。
- 修订 Spec 96 §5.4 交叉引用；索引 README。

### Phase 1 — ConfigAudit

- 可见「时间」；`24h` 选项；默认 `window=24h` + 整点 since；preset helper 整点。

### Phase 2 — Audit

- 共享筛选栏「时间」标签；`sinceIsoFromHours` 整点。

### Phase 3 — Tests

- `admin-config-audit.test.tsx`、`admin-audit-turns.test.tsx`；`lint:terminology`。

## Acceptance Criteria

- Spec 122 §8 全部满足；台账 Fixed；本轮不做浏览器验证。
