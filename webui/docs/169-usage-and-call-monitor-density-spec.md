# 使用概况与调用监控密度

| 元数据 | 内容 |
|---|---|
| 文档名称 | 使用概况与调用监控密度 |
| 文档类型 | Product / UX Spec |
| Spec 编号 | 169 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/admin/usage` 的视图页签、排行卡片高度和排行条颜色；`/ops/calls` 的调用量副文、失败时间、自动刷新文案 |
| 关联工单 | `webui/docs/plans/wo-202610-21-usage-and-call-monitor-density.md` |
| 上游 | Spec 135、Spec 156、Spec 165、Spec 166、按钮规范 §6 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 短排行不再被拉高；用量条改为中性灰；调用量去掉重复窗口副文；当天失败只显示时刻；自动刷新写明 30 秒；数据访问 / 界面使用改为内容页签 |

2026-10-12 批准六条，不搬 CC Switch 的柱状图、指标切换和日历。

## 1. 问题

使用概况的三列排行被网格拉成一样高。Agent 只有两行时，卡片下半截是空的；菜单和页面列则在卡片里滚动。排行条用品牌橙色，和调用监控里越线数字的橙色是同一类信号。

调用监控的「近 24 小时调用量」下面又写了一行「近 24 小时」，第一排卡片比第二排高。最近失败在同一天仍重复完整日期。自动刷新勾选框不写间隔。

使用概况的「数据访问 / 界面使用」和页头的「24 小时 / 7 天」都是分段按钮，换整页内容和换时间窗看起来一样。

## 2. 目标

1. 使用概况两处排行网格顶部对齐。短列跟着内容变高，长列仍在排行区内滚动。三块排行同时可见。
2. 使用概况的数量条和轨道改为中性灰，与调用监控工具排行同一色义。橙色只留给出了问题的指标数字。
3. 调用监控的调用量卡在有数据时不再渲染窗口副文。六张卡在有数据时都没有这句重复副文。
4. 最近失败的时间：本地日历日是今天时，可见文字只有 `HH:mm:ss`；否则保持 `YYYY-MM-DD HH:mm:ss`。悬停和无障碍名称始终是完整本地时间。
5. 自动刷新的可见文案改为「每 30 秒刷新」。间隔仍是 30 秒，仍是勾选框。
6. 「数据访问 / 界面使用」使用已有内容页签。时间窗仍是页头分段控件，两个视图继续共用。

## 3. 非目标

- 不合并 `/ops/calls` 与 `/admin/usage`，不改路由，不把界面使用拆成独立页。
- 不引入图表库，不加柱状图，不把折线称作趋势图，不加第二组时间或指标切换。
- 不把六张监控卡收进「更多指标」，不把调用量、拒绝或耗时画回数据访问。
- 不把使用概况选中的 7 天写进调用监控链接。链接仍是 `/ops/calls?range=24h`。
- 不恢复调用监控页头的「统计时间」或 SLO 总状态。
- 不把 30 秒改成可选间隔，不新增刷新间隔菜单。
- 不改排行条的高度、圆角和百分比口径。只改颜色。
- 不改资产卡、页面访问折线和调用监控折线。
- 不改「打开调用监控」那一行说明的文案和位置。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 156：数据访问与界面使用的切换保持 | 仍是同一页的两个视图，`?view=interface` 不变。控件改为内容页签 |
| Spec 135：排行区少则变矮、到 10 行则滚动 | 外层网格不再把短卡片拉到和长卡片一样高。区内滚动规则不变 |
| Spec 84：排行条用品牌色 | 数量条改为中性灰。品牌色不再表示调用多少 |
| Spec 165：六张 KPI 与 30 秒刷新 | 调用量卡去掉重复窗口副文。刷新文案写明 30 秒。间隔、折线和四个时间窗不变 |
| 按钮规范：筛选、Tab、时间窗用 segmented | 时间窗仍用 segmented。换整页内容的视图用已有 `pl-admin-tabbar` |

## 5. 使用概况

### 5.1 视图页签

`data-testid="governance-usage-view"` 的容器改为 `pl-admin-tabbar`，`role="tablist"`，`aria-label` 仍是「使用视图」。

两个按钮仍是 `governance-view-access`、`governance-view-interface`，文案仍是「数据访问」「界面使用」。`role="tab"`，`aria-selected` 表示当前视图。选中项使用 `pl-admin-tab pl-admin-tab--active`，未选中项使用 `pl-admin-tab`。不得使用 `pl-btn--primary`、`pl-segmented-control` 或 `pl-admin-tab-panel`。`pl-admin-tab-panel` 有 400px 最小高度，会把短内容再撑高。

页头时间窗保持 `pl-segmented-control pl-segmented-control--cols-2`，文案仍是「24 小时」「7 天」，默认 7 天，小时数仍不进 URL。

### 5.2 排行高度

`.pl-usage-rank-grid` 增加 `items-start`。数据访问和界面使用两处网格都用这个类。

`.pl-usage-rank-body` 的最小高度、最大高度和内部滚动保持 Spec 135。短列的卡片高度等于标题加排行区内容，不再等于旁边最长的一列。

### 5.3 排行颜色

`.pl-usage-rank-bar` 改为 `bg-fg-muted/40`。`.pl-usage-rank-track` 改为 `bg-bg-muted`。不再使用 `bg-brand` 或 `bg-brand-soft`。条的高度和圆角不变。

调用监控工具排行的灰色条不改。越线卡片的 warning 色不改。

## 6. 调用监控

### 6.1 调用量副文

有数据时，`call-monitor-kpi-volume` 不渲染 `<small>`。标题仍含当前窗口，例如「近 24 小时调用量」。成功率、错误率、拒绝率、多数请求耗时、慢于多数请求本来就没有这句窗口副文。

`no_data` 时仍显示「所选范围内无数据」。这个状态说明不是窗口副文。

### 6.2 失败时间

## 核心流程（伪代码）

```text
formatFailureTime(iso, now):
  date = parse(iso)
  if date is invalid:
    return visible = iso, full = iso
  full = local YYYY-MM-DD HH:mm:ss
  clock = local HH:mm:ss
  if date and now are the same local calendar day:
    visible = clock
  else:
    visible = full
  return visible, full
```

失败行链接的可见文字是 `visible`。`title` 与可访问名称是 `full`。下钻 URL 不变。别的日子的可见文字仍是完整本地时间。

### 6.3 自动刷新

勾选框的可见文案为「每 30 秒刷新」。`data-testid` 仍是 `call-monitor-auto-refresh`。勾选仍每 30 秒重载当前窗口的整份快照。不提供 5 秒、10 秒或 60 秒选项。关闭勾选仍停止轮询。手动「刷新」按钮保持。

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

沿用：使用概况、数据访问、界面使用、调用监控、近 N 调用量、每 30 秒刷新、打开调用监控。不新增「趋势图」。

## 8. Design System Compliance

- 按钮规范 §6：时间窗继续用 segmented；内容视图用已有 `pl-admin-tabbar`，选中态是下划线，不用 primary。
- 指标卡：只删除调用量卡的重复副文，不改卡片样式、折线或 warning tone。
- 排行：沿用 `pl-usage-rank-*`，只改网格对齐和条的颜色令牌。

## 9. 验收

| ID | 步骤 | 期望 |
|---|---|---|
| SC-1 | 打开 `/admin/usage` | 「数据访问」是内容页签且选中。「24 小时 / 7 天」仍是分段控件，默认 7 天。视图页签没有 segmented 类，也没有 primary |
| SC-2 | 看数据访问三块排行 | 网格带顶部对齐。排行条类不再使用品牌色，轨道为中性底 |
| SC-3 | 切到界面使用 | 页签选中「界面使用」。时间窗不重置。三块排行同样顶部对齐 |
| SC-4 | 打开 `/ops/calls?range=24h` 且窗口内有调用 | 调用量卡没有 `<small>`。标题仍含「近 24 小时调用量」。勾选框文案为「每 30 秒刷新」，且为勾选 |
| SC-5 | 失败时间的本地日不是今天 | 可见文字含日期。`title` 为完整本地时间 |
| SC-6 | 失败时间的本地日是今天 | 可见文字只有 `HH:mm:ss`。`title` 仍是完整本地时间 |
| SC-7 | 页面可见文案 | 不出现「趋势图」。调用监控链接仍是 `/ops/calls?range=24h`。页头没有「统计时间」 |
