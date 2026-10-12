# WO-202610-21 使用概况与调用监控密度

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-21 |
| 标题 | 使用概况排行收高、用量条改灰，调用监控去掉重复副文并写明刷新间隔 |
| 状态 | 已实现。SC-1 至 SC-7 的自动化断言通过 |
| 来源 | 2026-10-12 对照 CC Switch 用量页后批准的六条。不搬柱状图、指标切换和日历 |
| 来源 Spec | `webui/docs/169-usage-and-call-monitor-density-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | `/admin/usage` 的页签、排行高度和排行颜色；`/ops/calls` 的调用量副文、失败时间和自动刷新文案 |

## 目标

按 Spec 169 做六处密度调整。三块排行仍同时可见。30 秒刷新、四个时间窗、折线和调用监控链接保持。

## 任务

- [x] **T1 使用概况。** 视图容器改为 `pl-admin-tabbar`，不用 `pl-admin-tab-panel`。时间窗保持分段控件。`.pl-usage-rank-grid` 增加 `items-start`。排行条改为 `bg-fg-muted/40`，轨道改为 `bg-bg-muted`。两处排行网格都生效。对应 SC-1、SC-2、SC-3。

- [x] **T2 调用监控。** 有数据时调用量卡不渲染窗口副文。失败时间按本地日历日决定可见文字，`title` 始终是完整本地时间。勾选框文案改为「每 30 秒刷新」。间隔、test id 和手动刷新不变。对应 SC-4、SC-5、SC-6。

- [x] **T3 测试与索引。** 更新 `admin-governance-observability.test.tsx` 与 `call-monitor.test.tsx`，覆盖 SC-1 至 SC-7。按钮规范登记内容页签与时间窗的分工。Spec 156 指向本 Spec。完成后把 Spec 169 与本工单标为已实现，并写入 `webui/docs/README.md`。

## 实现顺序

1. T1 先改使用概况，避免排行色和页签分两次改同一页。
2. T2 改调用监控的三处文案和格式。
3. T3 收口。

## 验收口径

Spec 169 §9 的 SC-1 至 SC-7。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 src/__tests__/admin-governance-observability.test.tsx src/__tests__/call-monitor.test.tsx
```

## 回滚

视图页签改回分段控件。排行网格去掉 `items-start`，条和轨道改回品牌色。调用量卡恢复窗口副文。失败时间恢复始终显示完整本地时间。勾选框改回「自动刷新」。

## 风险与边界

| 风险 | 处理 |
|---|---|
| `pl-admin-tab-panel` 的 400px 最小高度把短页再撑高 | T1 只用页签条，不用这个 panel 类 |
| 顶部对齐后长列不再被裁、短列却被拉高 | T1 只改网格对齐。区内 `max-height: 22rem` 滚动保持 |
| 中性灰和越线橙色混用 | T1 只改使用概况数量条。warning tone 不改 |
| 今天的时刻丢掉日期，链接对不上日志 | T2 的 `title` 和无障碍名称保留完整本地时间 |
| 文案改成可选间隔 | T2 只改可见文案。`refetchInterval` 仍是 30 秒 |
