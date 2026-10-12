# 调用监控窗内折线

| 元数据 | 内容 |
|---|---|
| 文档名称 | 调用监控窗内折线 |
| 文档类型 | Product / UX / API Spec |
| Spec 编号 | 165 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/ops/calls` 的时间窗、六张 KPI 折线、自动刷新与刷新；访问日志补「近 30 天」以便下钻；使用概况交接文案 |
| 关联工单 | `webui/docs/plans/wo-202610-18-call-monitor-window-series.md` |
| 上游 | Spec 143 v1.1、Spec 156、Spec 103、Spec 106、Spec 128、Spec 141 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 全页只有一组时间窗。折线拆开同一窗口。四个窗口都 30 秒刷新整份快照。刷新失败留下上一份成功数据 |

2026-10-12 批准：调用监控可以在每张 KPI 旁看窗口内的起伏，但不得再为折线单设月 / 周 / 24 小时切换。右上角已有时间窗，第二组切换会让数字和折线各说一个范围。

## 1. 问题

`/ops/calls` 的六张 KPI 只有窗口合计。`GET /api/ops/call-monitor` 不返回按时间切开的点。顶栏只有「近 24 小时 / 近 1 小时」。

若折线再带一组「月 / 周 / 24 小时」，页面上会同时存在两个时间问题：合计是这一窗，折线是另一窗。

## 2. 目标

1. 顶栏时间窗扩成四个，且是全页唯一的时间切换：近 1 小时、近 24 小时、近 7 天、近 30 天。
2. 六张 KPI、折线、工具排行、最近失败与拒绝使用同一个窗口。折线是这个窗口的拆分，没有自己的切换。
3. 调用量与慢于多数请求的空档画 0。成功、错误、拒绝和多数请求耗时在该段没有调用时断开。多数请求耗时在该段调用少于 20 次时也断开。
4. 自动刷新与刷新都重载这一整份快照。四个窗口都是 30 秒。换窗口不改变勾选，并立刻请求新窗口。
5. 已有成功快照时，刷新失败保留上一份数字和折线，并说明本次失败。页头不恢复统计时间，也不恢复 SLO 总状态。

## 3. 非目标

- 不在折线上再放月、周、24 小时或刻度切换。
- 不把折线做成可点击下钻。下钻仍走工具排行和失败行。
- 不把使用概况当前选中的 7 天写进调用监控链接。链接仍打开 `/ops/calls?range=24h`。
- 不在调用监控增加活跃率、Agent、Token 或表。
- 不改 SLO 阈值，不把越线从卡片高亮改回页头总状态。
- 不引入图表库。不把本页折线称作趋势图，也不复用评测「趋势监控」的大图。
- 不改访问日志既有「近 1 小时 / 近 24 小时 / 近 7 天」的滚动起点。只为下钻补「近 30 天」，避免 `30d` 被读成 7 天。
- 不把 30 秒轮询改成按窗口变慢或变快。
- 不新增 SSE / WebSocket。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 143：时间窗只有 `24h` 与 `1h` | 时间窗为 `1h`、`24h`、`7d`、`30d`。默认仍是 `24h` |
| Spec 143 v1.1：页头无统计时间、无 SLO 总状态 | 保持。本 Spec 不把它们加回去 |
| Spec 143：刷新失败时页面进入不可用 | 已有成功快照时保留该快照，见 §8 |
| Spec 156：调用监控不增加 7 天窗口；交接文案写「调用监控的窗口是近 1 小时或近 24 小时」；SC-7 禁止 7 天切换 | 调用监控可以有近 7 天和近 30 天。交接文案去掉这句。使用概况自己的 7 天仍不得写进该链接 |
| Spec 106：访问日志 `range=1h\|24h\|7d` | 增加 `range=30d`。未知或 `hours=720` 不得落回 7 天 |
| 指标卡规范：卡内只有标题、主值、副文 | 调用监控的六张卡可在主值右侧放一条折线。其他页面不放 |

## 5. 时间窗

控件仍是页头里的一个 `tablist`，`aria-label` 为「时间窗口」。从左到右：

| 可见文案 | URL `range` | 默认 |
|---|---|---|
| 近 1 小时 | `1h` | |
| 近 24 小时 | `24h` | 是 |
| 近 7 天 | `7d` | |
| 近 30 天 | `30d` | |

`data-testid`：`call-monitor-range-1h`、`call-monitor-range-24h`、`call-monitor-range-7d`、`call-monitor-range-30d`。

未知 `range` 回到 `24h`。兼容读 `hours=1` → `1h`、`hours=24` → `24h`。`hours=168` 不选中近 7 天，回到 `24h`。只有显式 `range=7d` 或 `range=30d` 才进入这两个窗口。切换写入 URL，`replace` 当前历史记录，并删掉遗留的 `hours`。

「近 N 调用量」的 N 跟随当前窗口。工具排行标题仍是「工具调用排行 · {窗口文案}」。

### 5.1 分桶

时区固定为 `Asia/Shanghai`，与访问日志本地时间一致，不随浏览器时区改变。桶对齐到整点，30 秒刷新只改当前这一桶的值，不把整条线平移。

| `range` | 刻度 | 点数 | 起点 |
|---|---|---|---|
| `1h` | 5 分钟 | 12 | 当前 5 分钟起点再往前 11 段 |
| `24h` | 1 小时 | 24 | 当前小时起点再往前 23 小时 |
| `7d` | 1 天 | 7 | 今天 0 点再往前 6 天 |
| `30d` | 1 天 | 30 | 今天 0 点再往前 29 天 |

最后一桶收到现在为止，是未结束的一段。合计与折线共用这个起点，调用量合计等于各桶调用量之和。窗口因此按整点对齐，不是「此刻正好往前 24 小时」；差在不到一个刻度以内。

## 6. 序列口径

计入集合与 Spec 143 相同：`access_log` 中的业务 MCP 工具调用，排除协议工具。不返回 Eval / Hermes 字段。

每一桶：

| 字段 | 空桶 | 有调用 |
|---|---|---|
| 调用量 | 0 | 该桶次数 |
| 慢于多数请求 | 0 | `durationMs` 严格大于 `slowMs` 的次数。`slowMs` 仍默认 30000 |
| 成功率、错误率、拒绝率 | 不画（`null`） | 该桶分子 / 该桶调用量。调用量为 1 也画 |
| 多数请求耗时 | 不画 | 该桶调用量达到 20 才计算 P95；少于 20 为 `null` |

窗口上的成功率、错误率和拒绝率用整窗分子和分母，不用各桶比率的平均。窗口上的多数请求耗时是整窗 P95，不受 20 次限制；20 次只决定这一桶的折线点画不画。慢于多数请求的合计等于各桶之和。

服务端按桶聚合。响应里的 `series` 长度必须等于点数，按时间升序，缺桶补上，不得省略空桶。不得把窗口内原始行放进响应。`access_log(ts)` 需要可用的索引，避免 `WHERE ts >= ?` 每次全表扫描。

P95 的 ⓘ 增加一句：时段内调用少于 20 次时，折线在该段断开。主值和副文不写这句。

## 7. 折线

只出现在调用监控这六张 KPI 上，放在主值右侧。其他页面的 `MetricCard` 不渲染折线。

| 卡片 | 折线取值 | test id |
|---|---|---|
| 近 N 调用量 | 调用量，含 0 | `call-monitor-sparkline-volume` |
| 成功率 | 成功率，`null` 处断开 | `call-monitor-sparkline-success` |
| 错误率 | 错误率，`null` 处断开 | `call-monitor-sparkline-error` |
| 拒绝率 | 拒绝率，`null` 处断开 | `call-monitor-sparkline-denied` |
| 多数请求耗时 | `p95Ms`，`null` 处断开 | `call-monitor-sparkline-p95` |
| 慢于多数请求 | 慢调用次数，含 0 | `call-monitor-sparkline-slow` |

视觉见 `webui/docs/design-system/12-components-metric-card.md` §11。折线没有可见标题、坐标轴、圆点图例或自己的 ⓘ。无障碍名称是「{指标}，{窗口文案}，按{刻度}」，刻度为「5 分钟」「小时」或「天」。名称里不出现「趋势图」。

卡片 `state` 不是 `ok` 时不画折线。第一次请求尚未返回时，状态不是 `no_data`，不显示「所选范围内无数据」。整窗调用量为 0 时，六张卡都是 `no_data`，不画折线。

越线仍只改变对应卡片的 tone。折线不单独变红。

## 8. 自动刷新与刷新

两个控件都重载当前窗口的整份快照：六张 KPI、六条折线、工具排行、最近失败与拒绝。

| 行为 | 规则 |
|---|---|
| 自动刷新 | 默认勾选。间隔 30 秒，四个窗口相同。标签页在后台时不请求。勾选只留在这次打开的页面里，不写入服务端 |
| 换窗口 | 不改勾选。立刻请求新窗口 |
| 刷新按钮 | 自动刷新关掉时仍可用。请求进行中不可点 |
| 第一次加载失败 | 文案「调用监控加载失败：{原因}」。卡片为不可用，不画折线 |
| 已有成功快照时再次失败 | 文案「本次刷新失败：{原因}」。数字、折线、排行和失败列表保持上一份。卡片不得改成不可用或暂无数据 |
| 失败后再成功 | 错误行消失，整份快照一起换成新的 |

`data-testid` 仍是 `call-monitor-error`、`call-monitor-auto-refresh`、`call-monitor-refresh`。

## 9. 下钻

工具排行和失败行仍进 `/admin/audit?view=calls`，并带上当前 `range` 与原有的工具或结果过滤。

| 调用监控 `range` | 访问日志 |
|---|---|
| `1h`、`24h`、`7d` | 沿用现有预设。起点仍是访问日志今天的滚动规则，可与调用监控的整点桶差一个刻度 |
| `30d` | 新预设，可见文案「近 30 天」。起点与 §5.1 的近 30 天相同 |

访问日志读到 `range=30d` 或 `hours=720` 时必须打开近 30 天，不得落到近 7 天。直接打开访问日志时，原有三个预设的行为不变。

## 10. API

`GET /api/ops/call-monitor?range=1h|24h|7d|30d&slowMs=`

`series` 与原有 `traffic`、`latency`、`slo`、`topTools`、`recentFailures` 同一次返回。`window` 增加：

| 字段 | 含义 |
|---|---|
| `range` | `1h`、`24h`、`7d` 或 `30d` |
| `timeZone` | `Asia/Shanghai` |
| `bucket` | `5m`、`hour` 或 `day` |
| `bucketCount` | 12、24、7 或 30 |
| `since` | 第一桶起点，ISO-8601 |
| `until` | 本次计算的现在，ISO-8601 |
| `slowMs` | 慢调用阈值 |

`series[]` 每项：

| 字段 | 含义 |
|---|---|
| `start` | 该桶起点 |
| `businessCalls` | 调用量 |
| `okCalls` / `errorCalls` / `deniedCalls` | 分子 |
| `successRate` / `errorRate` / `deniedRate` | 比率或 `null` |
| `p95Ms` | 该桶 P95 或 `null` |
| `slowCalls` | 慢调用次数 |

`topTools` 仍 ≤ 10，`recentFailures` 仍 ≤ 20。不得包含 Token 明文、结果行、Eval 或 Hermes。

## 11. 核心流程（伪代码）

```text
function loadCallMonitor(range, slowMs, now):
  range := normalize(range)          # unknown, or hours=168 → 24h
  grain, count := bucketSpec(range) # §5.1
  end := floor(now, grain, Asia/Shanghai)
  start := end shifted back by (count - 1) grains
  buckets := count contiguous buckets from start
  rows := business MCP calls with ts >= start and ts <= now
           # exclude PROTOCOL_TOOLS; do not load rows into the JSON response

  for each bucket:
    calls := rows in [bucket.start, next start)
    rates := null if calls = 0 else outcome counts / calls
    p95 := null if calls < 20 else percentile(durationMs, 0.95)
    slow := count(durationMs > slowMs)
    emit { calls, rates, p95, slow }

  traffic := totals of those rows
  assert traffic.businessCalls = sum(bucket.businessCalls)
  assert latency.slowCalls = sum(bucket.slowCalls)
  latency.p95Ms := percentile(all durationMs in the window, 0.95)
                   # window P95 ignores the per-bucket minimum of 20
  slo := Spec 143 thresholds against the window totals
  return one snapshot { traffic, latency, slo, series, topTools, recentFailures }

function page(range):
  autoRefresh stays as the user left it when range changes
  snapshot := loadCallMonitor(range)
  render four tabs, six cards, six lines, ranking, failures
  every 30s, if autoRefresh and the tab is visible:
    try snapshot := loadCallMonitor(range)
    on failure, if a previous snapshot exists:
      keep it
      show 本次刷新失败
    on failure, if none exists:
      show 调用监控加载失败
      cards := unavailable
```

## 12. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | 打开 `/ops/calls` | 时间窗从左到右为近 1 小时、近 24 小时、近 7 天、近 30 天。默认近 24 小时。没有第二组时间切换，页头没有统计时间和 SLO 总状态 |
| SC-2 | 切换到近 7 天或近 30 天 | URL 为 `range=7d` 或 `range=30d`。六张 KPI、折线、工具排行、最近失败都改为该窗口。`hours=168` 不选中近 7 天 |
| SC-3 | 任一窗口的成功响应 | `series` 长度等于 12、24、7 或 30，时间升序且连续。调用量合计等于各桶之和。空桶调用量为 0，比率和 P95 为 `null` |
| SC-4 | 某小时有 19 次调用，另一小时有 20 次 | 19 次的 `p95Ms` 为 `null`，20 次的为该小时 P95。整窗 P95 仍按全部调用计算 |
| SC-5 | 卡片 `state=ok` | 六张卡主值右侧各有一条折线。调用量和慢于多数请求画出 0。比率为 `null` 或 P95 为 `null` 的位置断开。无可见标题「趋势图」 |
| SC-6 | 整窗没有业务调用 | 六张卡为暂无数据，不画折线 |
| SC-7 | 自动刷新开着，依次切四个窗口 | 勾选保持。每次切换都立刻请求对应 `range`。可见标签页内的间隔仍是 30 秒 |
| SC-8 | 已有成功快照，下一次请求失败 | 错误文案为「本次刷新失败」。数字和折线仍是上一份。卡片不是不可用 |
| SC-9 | 第一次打开就失败 | 文案为「调用监控加载失败」。卡片不可用，无折线 |
| SC-10 | 从近 30 天的工具排行下钻 | `/admin/audit?view=calls&range=30d`，并可带上工具名。访问日志显示近 30 天，不显示近 7 天 |
| SC-11 | 使用概况停在 7 天 | `usage-call-monitor-link` 仍是 `/ops/calls?range=24h`。可见文案不再写「调用监控的窗口是近 1 小时或近 24 小时」 |
| SC-12 | 调用监控页面文本 | 不含「活跃率」。协议工具不计入。响应无 Eval / Hermes 字段 |

## 13. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Call Monitor Window | 近 1 小时 / 近 24 小时 / 近 7 天 / 近 30 天 | 月、周、24H、近 1 月 | 全页唯一时间切换 |
| Call Monitor In-window Line | （无可见标题） | 趋势图、迷你图、sparkline | 无障碍名称用指标、窗口和刻度。不得与「趋势监控」混称 |

沿用：调用监控、近 N 调用量、成功率、错误率、拒绝率、多数请求耗时、慢于多数请求、工具调用排行、最近失败与拒绝、自动刷新、刷新、访问日志、调用流水。

页头继续不使用「统计时间」，也不使用「正常 / 需关注 / 暂无数据」作为 SLO 总状态。

Protected terms：`MCP`、`P95`、tool name、`requestId`、`traceId`。

## 14. Design System Compliance

- 引用 `webui/docs/design-system/12-components-metric-card.md` §11。折线是指标卡的可选尾部，不新做一套卡片。
- 时间窗沿用 `pl-segmented-control`，扩成四列。
- 越线沿用既有 warning tone。折线使用当前文字色，不新增色板。
- 刷新失败沿用 `pl-error`。

## 15. 实现时必改

- `webui/server/proxy/audit.ts`、`webui/server/ops/call-monitor.ts`
- `webui/src/pages/ops/CallMonitor.tsx`、`webui/src/components/MetricCard.tsx`
- `webui/src/pages/admin/Audit.tsx` 的 `range=30d`
- `webui/src/pages/admin/GovernanceOverview.tsx` 的交接文案
- `webui/docs/00-product-terminology-standard.md` §4.6（本 Spec 已要求登记）
- `docs/qa/selector-contract.md` 登记新的 test id
