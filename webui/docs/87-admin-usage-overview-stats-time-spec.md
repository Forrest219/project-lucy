# Admin Usage Overview Stats Time Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Admin Usage Overview Stats Time Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/usage` 与 `/overview`；已批准改善方案（增加「统计时间」）；`GovernanceOverview.tsx`；`Onboarding.tsx` 新鲜度徽标 |
| 适用范围 | 指导使用概况页顶栏增加统计时间戳，布局对齐系统概览 |
| 输出位置 | `webui/docs/87-admin-usage-overview-stats-time-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 87 |
| 关联工单 | `webui/docs/plans/wo-202608-19-admin-usage-overview-stats-time.md` |
| 关联页面 | `/admin/usage` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-governance.md`（`UX-ADMIN-GOV-021`） |
| 上游 Spec | Spec 86（路由与 KPI）；系统概览新鲜度模式（`/overview`） |
| 状态 | Draft (v1.0) |
| 日期 | 2026-08-05 |
| 范围 | 前端 PageHeader actions 增加「统计时间」徽标；术语登记；Vitest |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：已批准「统计时间」落盘 |

## 1. 背景

`/admin/usage` KPI 与排行来自 `access_log` / 配置聚合，但页头仅有 24h/7d 窗口切换，缺少「当前快照何时拉取」的时点提示。系统概览 `/overview` 已有「上次更新：刚刚」新鲜度徽标。

## 2. 目标

1. 在 PageHeader `actions` 中、**时间窗口切换之前**展示 `统计时间：刚刚 / N 秒前 / N 分钟前 / HH:MM:SS`。
2. 布局对齐 `/overview`：`flex items-center gap-3` 同组同排（徽标在左，控件在右）。
3. 时间取三组 query（overview / agents / tokens）全部成功后的最晚 `dataUpdatedAt`；相对时间规则与系统概览一致。
4. 本轮不加刷新按钮；不做后端 `generatedAt`。

## 3. 非目标

- 不改 KPI / 排行口径与 API path。
- 不引入 WebSocket / 自动轮询刷新数据。
- 不把文案改成「上次更新」（本页用「统计时间」强调滚动窗口快照）。
- 不做浏览器 E2E / 移动窄屏。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`，并在 §4.5 登记：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Stats Snapshot Time | 统计时间 | — | 上次更新（本页主标签） | 三组 query 成功拉取后的快照新鲜度；相对时间规则对齐系统概览 |

## 5. Design System Compliance

- 引用：`20-patterns-page-layout.md`（PageHeader actions）；对齐 overview：`text-xs text-fg-muted whitespace-nowrap`。
- 视觉徽标 `aria-hidden="true"`（避免相对时间 ticker 噪音；本轮不加重 announce）。

## 6. 变更明细

### 6.1 前端 `GovernanceOverview.tsx`

- actions 结构：

```tsx
<div className="flex items-center gap-3" data-testid="governance-stats-time-controls">
  <span data-testid="governance-stats-time" aria-hidden="true">统计时间：{label}</span>
  <div role="tablist" aria-label="时间窗口" className="pl-segmented-control …">…</div>
</div>
```

- `statsUpdatedAtMs = max(overview/agents/tokens dataUpdatedAt)`，仅在三者 `isSuccess` 时生效；否则显示「未知」。
- 相对时间：`<5s` 刚刚 → `<60s` 秒前 → `<15min` 分钟前 → 否则 `HH:MM:SS`；每秒 tick `now`。

### 6.2 测试

- Vitest：徽标文案前缀、`aria-hidden`、位于 tablist 之前。

## 7. 验收标准

- [ ] `/admin/usage` 顶栏可见「统计时间：…」，且在「24 小时 / 7 天」左侧。
- [ ] 数据加载成功后不为「未知」；切换窗口后随新请求成功更新。
- [ ] 术语 lint 通过；相关 Vitest 通过。
