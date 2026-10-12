# 使用概况页面访问折线

| 元数据 | 内容 |
|---|---|
| 文档名称 | 使用概况页面访问折线 |
| 文档类型 | Product / UX / API Spec |
| Spec 编号 | 166 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/admin/usage?view=interface` 的「近 N 页面访问」。数据访问三张资产卡、访问账户、活跃菜单和三块排行不加折线 |
| 关联工单 | `webui/docs/plans/wo-202610-19-usage-page-view-series.md` |
| 上游 | Spec 148、Spec 156、Spec 165、Spec 103、指标卡规范 §11 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 界面使用只给页面访问加折线。折线拆开当前的 24 小时或 7 天，各点相加等于卡片数字 |

2026-10-12 批准：使用概况沿用调用监控的原则，全页只有一组时间窗，折线拆开这一窗。六张 KPI 里只有页面访问的各点能加回卡片数字，所以只加这一张。

## 1. 问题

界面使用的「近 N 页面访问」只有窗口合计。`GET /api/admin/ui-usage/overview` 不返回按时间切开的点。

访问账户、活跃菜单和数据访问的三张资产卡也不能照搬。前两张是整窗去重，三张资产卡是「活跃 / 当前配置」加活跃率。按小时或按天拆开之后，各点相加不等于卡片上的数字，线和数字会各说一个范围。

## 2. 目标

1. 界面使用的「近 N 页面访问」在主值右侧画一条折线。折线没有自己的时间切换。
2. 折线与卡片、排行使用页头现有的同一窗口：24 小时或 7 天，默认 7 天。
3. 24 小时切成 24 段，7 天切成 7 段。每段从该窗口的起点量起。各段页面访问相加等于卡片上的 `pageViews`。空档画 0。
4. 未能对应到已知页面的打开计入合计，也计入折线。
5. 访问账户、活跃菜单、三张资产卡和全部排行保持现在的样子，不画折线。

## 3. 非目标

- 不给折线再加月、周、24 小时或刻度切换。
- 不把使用概况的时间窗扩成近 1 小时或近 30 天，也不把小时数写进 URL。
- 不把这页改成 30 秒轮询，不新增刷新按钮。
- 不把调用监控的整点桶用到本页。两边的「7 天」起点不同，本 Spec 不合并。
- 不在访问账户、活跃菜单上画折线。它们是整窗去重，各点相加会大于卡片数字。
- 不在 Agent、Token、授权表三张卡上画折线，也不把调用量、拒绝或耗时画回数据访问视图。
- 不在排行的每一行旁边加折线。
- 不把页面访问为 0 改成「所选范围内无数据」。0 仍显示 0，折线是一条水平线。
- 不引入图表库。可见文案不写「趋势图」「迷你图」或 sparkline，也不复用评测「趋势监控」的大图。
- 不改 `ui_page_views` 的表结构，不改分组、菜单、页面排行的聚合键。
- 不改统计时间。它表示这份快照何时算完，不是第二组时间窗。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 148：界面使用三个指标只有合计 | 页面访问增加折线。访问账户、活跃菜单仍只有合计 |
| Spec 148：`overview` 不返回时间序列 | 增加 `pageViewSeries`。`pageViews` 仍是合计 |
| Spec 156：界面使用指标保持 Spec 148，且不改页面访问口径 | 合计口径不变。折线是这个合计的拆分。另外五张 KPI 仍不加折线 |
| 指标卡规范 §11：只有调用监控六张卡可传序列 | 使用概况的页面访问卡也可以。其他卡片仍不传 |
| Spec 165：折线按上海时区对齐整点，并 30 秒刷新 | 只约束调用监控。使用概况继续用现有的滚动窗口，也不轮询 |

## 5. 时间窗

页头分段控件保持两项，从左到右：「24 小时」「7 天」。默认「7 天」。`data-testid` 仍是 `governance-window-24h`、`governance-window-7d`。小时数仍是页内状态，不进 URL。数据访问和界面使用继续共用这一组。

可见窗口文案保持「近 24 小时」「近 7 天」。卡片标题保持「近 N 页面访问」。

### 5.1 分桶

窗口继续用 `buildMetricWindow`：半开区间 `[now - hours, now)`。查询仍是 `ts >= start AND ts < end`。

| 窗口 | `hours` | 段数 | 每段长度 | `bucket` |
|---|---|---|---|---|
| 24 小时 | 24 | 24 | 1 小时 | `hour` |
| 7 天 | 168 | 7 | 24 小时 | `day` |

第一段的 `start` 等于窗口起点。最后一段的 `end` 等于窗口终点。段与段首尾相接，不重叠，也不留缺口。

这里的「天」是这 7 天窗口里连续的 24 小时，不是上海时区的日历日。调用监控的近 7 天从当天 0 点对齐；本页不跟随那个起点。否则卡片上的 556 会变成另一个窗口的合计。

固定时刻 `2026-10-12T12:30:00.000Z`：

| 窗口 | 起点 | 最后一段起点 | 终点 |
|---|---|---|---|
| 24 小时 | `2026-10-11T12:30:00.000Z` | `2026-10-12T11:30:00.000Z` | `2026-10-12T12:30:00.000Z` |
| 7 天 | `2026-10-05T12:30:00.000Z` | `2026-10-11T12:30:00.000Z` | `2026-10-12T12:30:00.000Z` |

空段的 `pageViews` 为 0，不为 `null`。全部为 0 时画一条水平线。没有断开。

`page_key = unknown` 的打开计入 `pageViews`，也计入所在段。`unmappedViews` 仍单独提示，不单独画线。

## 6. 界面

只改界面使用第一张卡。主值右侧放约 80×28 的折线，规则见指标卡规范 §11。

- 无可见标题、坐标轴、图例和第二颗 ⓘ。
- 描边用当前文字色。
- `role="img"`。无障碍名称：`{卡片标题}，{窗口文案}，按{刻度}`。24 小时的刻度是「小时」，7 天的刻度是「天」。例：`近 7 天页面访问，近 7 天，按天`。
- `data-testid` 为 `usage-sparkline-page-views`。走指标卡的 `seriesTestId`。不得走 `seriesMetric`，那个前缀属于调用监控。

访问账户、活跃菜单不传序列。数据访问的三张卡不传序列。排行不传序列。

加载中仍显示「正在统计界面使用。」，此时没有折线。请求失败仍显示「界面使用暂时无法统计。」，此时没有折线。换窗口会重新请求；新窗口的数字和折线一起出现，不把上一窗的线留在新标题下面。

统计时间保持在时间窗左侧。

## 7. API

`GET /api/admin/ui-usage/overview?hours=24|168`

仍只接受 24 与 168。缺省或其他值按 168，并返回 7 段。`pageViews`、`visitorCount`、`activeMenuCount`、`unmappedViews` 和三块排行的口径不变。

同一次响应增加 `pageViewSeries`：

| 字段 | 含义 |
|---|---|
| `bucket` | `hour` 或 `day` |
| `since` | 窗口起点，等于第一段 `start` |
| `until` | 窗口终点，等于最后一段 `end` |
| `points` | 长度 24 或 7，按时间升序 |

`points[]` 每项只有 `start`、`end`、`pageViews`。不得带原始行、路径、账户或页面名单。

`sum(points.pageViews)` 必须等于 `pageViews`。

数据访问的 `GET /api/admin/governance/overview` 不增加序列。

## 8. 核心流程（伪代码）

```text
function loadInterfaceUsage(hours, now):
  hours := 24 if hours is 24 else 168
  window := buildMetricWindow(hours, now)   # [start, end)
  step := 1 hour if hours is 24 else 24 hours
  count := 24 if hours is 24 else 7
  points := count contiguous slices from window.start to window.end
  rows := ui_page_views where ts >= start and ts < end
          # includes page_key = unknown; do not put rows in the JSON

  for each point:
    pageViews := count(rows in [point.start, point.end))

  assert sum(points.pageViews) = count(rows)
  rankings := Spec 148, unchanged
  return { pageViews, visitorCount, activeMenuCount, unmappedViews,
           pageViewSeries, groups, menus, pages }

function page(hours, view):
  if view is access:
    render three asset cards and three rankings, no line
  if view is interface:
    snapshot := loadInterfaceUsage(hours)
    render page-view line from snapshot.pageViewSeries
    render visitor and menu cards without a line
  changing hours refetches the current view
  no 30-second poll
```

## 9. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | 打开 `/admin/usage?view=interface` | 时间窗仍是 24 小时、7 天，默认 7 天。只有「近 7 天页面访问」右侧有折线。访问账户、活跃菜单没有折线。没有第二组时间切换，可见文案没有「趋势图」 |
| SC-2 | 切到 24 小时，再切回 7 天 | 卡片标题、排行标题和折线一起变。24 小时的 `points` 长度为 24，7 天为 7。无障碍名称分别以「按小时」「按天」结尾 |
| SC-3 | 固定时刻 `2026-10-12T12:30:00.000Z` 的成功响应 | 7 天起点是 `2026-10-05T12:30:00.000Z`，不是上海时区当天 0 点。段首尾相接。`sum(points.pageViews) = pageViews`。空段为 0。`unknown` 计入合计和所在段 |
| SC-4 | 窗口内一次页面打开都没有 | 卡片值为 0，折线是水平线。不显示「所选范围内无数据」 |
| SC-5 | 停在数据访问视图 | 三张资产卡和三块排行没有 `usage-sparkline-page-views`。调用监控链接仍是 `/ops/calls?range=24h` |
| SC-6 | `hours` 缺省或不是 24 | 按 7 天返回 7 段。页面不出现近 1 小时或近 30 天 |
| SC-7 | 第一次还在加载，或请求失败 | 加载文案为「正在统计界面使用。」失败文案为「界面使用暂时无法统计。」两种都没有折线。页面不新增 30 秒轮询 |
| SC-8 | 响应正文 | `pageViewSeries.points` 不含路径、账户和原始行。排行聚合键仍是 Spec 148 |

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Usage Page View Line | （无可见标题） | 趋势图、迷你图、sparkline | 只在「近 N 页面访问」主值右侧。无障碍名称用指标、窗口和刻度 |

沿用：使用概况、界面使用、数据访问、近 N 页面访问、近 N 访问账户、近 N 活跃菜单、分组访问、菜单访问排行、页面访问排行、统计时间、24 小时、7 天。

## 11. Design System Compliance

- 引用 `webui/docs/design-system/12-components-metric-card.md` §11。不新做卡片。
- 时间窗沿用现有两列 `pl-segmented-control`。
- 折线使用当前文字色，不新增色板。

## 12. 实现时必改

- `webui/server/admin/ui-usage.ts`：在现有窗口上生成 `pageViewSeries`
- `webui/src/pages/admin/GovernanceOverview.tsx`：只给页面访问卡传入序列
- `webui/docs/00-product-terminology-standard.md` §4.5（本 Spec 已要求登记）
- `docs/qa/selector-contract.md` 登记 `usage-sparkline-page-views`
