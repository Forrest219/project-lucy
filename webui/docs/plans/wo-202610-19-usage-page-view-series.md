# WO-202610-19 使用概况页面访问折线

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-19 |
| 标题 | 使用概况只在页面访问上画出当前窗口的折线 |
| 状态 | 已实现。SC-1 至 SC-8 的自动化断言通过 |
| 来源 | 2026-10-12 对 `/admin/usage` 的审阅。同意沿用调用监控的原则，但只给能加回卡片数字的页面访问加折线 |
| 来源 Spec | `webui/docs/166-usage-page-view-series-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | 界面使用的页面访问 API 与卡片。不改时间窗选项，不给另外五张 KPI 加折线，不新增轮询 |

## 目标

按 Spec 166，界面使用的「近 N 页面访问」用页头当前的 24 小时或 7 天画出折线。各点相加等于卡片数字。访问账户、活跃菜单、三张资产卡和排行保持原样。

## 任务

- [x] **T1 序列。** `queryUiUsageOverview` 用现有 `buildMetricWindow` 生成 `pageViewSeries`。24 小时为 24 段，每段 1 小时；7 天为 7 段，每段 24 小时。第一段起点等于窗口起点，最后一段终点等于窗口终点。`unknown` 计入段内次数。`sum(points.pageViews) = pageViews`。空段为 0。响应不带原始行、路径和账户。缺省或非 24 的 `hours` 仍按 168，返回 7 段。不得改用调用监控的上海时区整点窗口。对应 SC-3、SC-6、SC-8。

- [x] **T2 页面访问卡。** 只在 `metric-interface-page-views` 传入序列、无障碍名称和 `seriesTestId="usage-sparkline-page-views"`。使用 `seriesTestId`，不用 `seriesMetric`。访问账户、活跃菜单、三张资产卡和排行不传序列。值为 0 时仍画水平线，不改成暂无数据。加载和失败沿用现有两句文案，不画折线。不增加 30 秒轮询，不改统计时间和两档时间窗。对应 SC-1、SC-2、SC-4、SC-5、SC-7。

- [x] **T3 测试、契约与索引。** 改写 `server/__tests__/admin-ui-usage.test.ts` 与 `src/__tests__/admin-governance-observability.test.tsx`，覆盖 SC-1 至 SC-8。新 test id 写入 `docs/qa/selector-contract.md`。实现完成后把 Spec 166 与本工单标为已实现，并确认 `webui/docs/README.md` 的状态句一致。

## 实现顺序

1. T1 先定 `pageViewSeries`，避免页面用另一套起点把合计和折线加错。
2. T2 只把序列接到页面访问卡。
3. T3 收口。

## 验收口径

Spec 166 §9 的 SC-1 至 SC-8。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 src/__tests__/admin-governance-observability.test.tsx server/__tests__/admin-ui-usage.test.ts
```

## 回滚

去掉 `pageViewSeries` 和页面访问卡上的折线。24 小时 / 7 天、三张资产卡、访问账户、活跃菜单和排行保持原样。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 折线改用调用监控的 0 点对齐，合计不再等于卡片 | T1 强制与 `buildMetricWindow` 同一起点，并断言两者相等 |
| 7 天被切成 8 个日历日 | T1 固定 7 段，每段 24 小时 |
| 访问账户或资产卡也被接上折线 | T2 只允许页面访问卡传入序列。测试确认另外五张卡没有折线 |
| `seriesMetric` 把 test id 写成调用监控前缀 | T2 使用 `seriesTestId` |
| 为了画线把本页改成 30 秒轮询 | T2 不增加轮询。换窗口仍走现有请求 |
