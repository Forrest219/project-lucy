# 访问日志上下文条呈现 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v1.0 |
| 日期 | 2026-10-30 |
| 功能编号 | 不另派 L25 编号。这是访问日志页的呈现修正，不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 功能台账。功能编号待 PM 指派 |
| 状态 | **v1.0 功能合同已收口（2026-10-31）**。SC-01–SC-08 由组件测试与页面集成测试关闭。本条收口不表示可上线。审阅见 [2026-10-31-audit-context-bar-and-sqlserver-identity-closure.md](../reviews/2026-10-31-audit-context-bar-and-sqlserver-identity-closure.md) |
| 决策来源 | 2026-10-30 用户授权：按仓库 spec / plan 规范落地访问日志顶部元信息条的呈现优化，供审阅 |
| 需求来源 | `/admin/audit` 顶部出现「窗口2026-10-23T02:00:00.000Z → …Asia/Shanghai」一类粘连文案 |
| 实施主体 | Lucy WebUI（`webui/src`）。不修改 KTX、不改审计 API、不改投影延迟的计算 |
| 与既有 Spec 的关系 | 不改 [`lucy-20261019-audit-trust-and-admin-investigation-spec.md`](lucy-20261019-audit-trust-and-admin-investigation-spec.md) §5 的字段合同：固定起止时间、时区、统计时间、刷新/暂停状态、审计同步延迟仍然都在顶部。本文只规定这些字段如何排版和如何把机器时间写成业务时区 |

## 闭口层级

- 层级：功能合同
- 本条承诺：访问日志顶部上下文条按业务时区分列显示窗口、时区、统计时间、审计同步延迟和刷新状态；统计时间只出现一次；暂停是次要按钮。
- 本条出口：SC-01–SC-08。组件测试与访问日志页集成测试打假标签分离、可见时间、日界、无法解析、延迟警告、统计时间只出现一次、暂停按钮和口径说明位置。
- 不在本条出口：审计查询、投影延迟算法、暂停后冻结筛选、使用概况页的统计时间、运行中的页面走查、镜像、部署与客户环境。
- 上线关系：本条收口不表示可上线

## 1. 现象

2026-10-30 在 `http://127.0.0.1:55176/admin/audit` 取证：

- `AuditTopMetaBar` 使用 `pl-audit-top-meta-*` 类名，样式表中没有对应规则。条本身是 `display: block`，标签是 16px、与正文同色、右边距为 0。
- 可见文案因此粘连，例如 `窗口2026-10-30T01:00:00.000Z → 2026-10-30T02:51:55.687ZAsia/Shanghai`。
- 时间以 UTC 的 ISO 8601（后缀 `Z`）直接输出，旁边的时区却是 `Asia/Shanghai`。同一页表格用本地时间，例如 `2026/10/30 10:11:37`，与元信息条相差 8 小时。
- 「统计时间」出现两次：元信息条是原始 ISO，时间范围控件旁是「统计时间：刚刚」。
- 「暂停刷新」使用无边框的 ghost 按钮，读起来像下一行说明。

## 2. 范围

### 2.1 本期包括

- `/admin/audit` 顶部上下文条的排版、时区格式化和「统计时间」去重。
- 「暂停刷新 / 恢复刷新」改为有边框的次要按钮，仍放在同一条的尾部。
- 口径说明句与「字段说明」「查看审计口径」改为紧随正文，不再两端对齐。

### 2.2 本期不包括

- 审计查询、投影延迟算法、暂停后冻结筛选与序列上界。这些行为保持现状。
- 使用概况页的「统计时间」（仍在时间窗口切换左侧）。
- 新的全局组件或新的颜色 token。
- 移动窄屏验证。

## 3. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 可见时间 | 按传入的 IANA 时区格式化为 `YYYY-MM-DD HH:mm:ss`。同一时区日历日时，结束时间省略日期。原始 ISO 留在 `title` 与 `data-iso*`，不出现在可见正文 |
| D2 | 无法解析 | 时间字符串无法解析时原样显示。时区名无效时，按运行时本地时区格式化，不抛错 |
| D3 | 统计时间 | 全页只出现一次，位于上下文条。可见文沿用相对时间（刚刚 / N 秒前 / N 分钟前 / `HH:mm:ss`）。精确本地时间与 ISO 放在 `title` |
| D4 | 审计同步延迟 | 标签保留。数值仍为 `N ms` / `N.N s` / `N.N min`。大于 5 秒时数值使用警告色，并保留 `data-overdue="true"` |
| D5 | 刷新 | 状态文案仍为「实时」或「已暂停（原因）」。暂停按钮使用 `pl-btn pl-btn--secondary pl-btn--sm` |
| D6 | 时区 | 单独一项，标签为「时区」，值是 IANA 名，DOM 保持 `translate="no"` 与 `notranslate` |

## 4. 核心流程（伪代码）

```text
formatInstant(iso, zone):
  date = parse(iso)
  if date is invalid: return iso
  tz = zone if zone is a valid IANA name else runtime local zone
  return YYYY-MM-DD HH:mm:ss in tz

formatWindow(start, end, zone):
  a = formatInstant(start, zone)
  b = formatInstant(end, zone)
  if either parse failed: return "{start} → {end}"
  if calendar date(a) == calendar date(b) in that zone:
    return "{date} {startTime} → {endTime}"
  return "{a} → {b}"

renderContextBar:
  show 窗口 = formatWindow(fixedStart, fixedEnd, zone)
  show 时区 = zone
  show 统计时间 = relativeLabel if provided else formatInstant(statsAt, zone)
  show 审计同步延迟 = formatLag(syncLagMs)
  mark warning when syncLagMs > 5000
  show 刷新 = 实时 or 已暂停（原因）
  place pause/resume button in the trailing slot
```

`formatLag` 沿用现有分支：小于 1000 为毫秒，小于 60000 为秒（一位小数），否则为分钟（一位小数）。

## 5. 验收

| 编号 | 断言 |
|---|---|
| SC-01 | 五个标签「窗口」「时区」「统计时间」「审计同步延迟」「刷新」各自独立于数值节点 |
| SC-02 | 合法 ISO 的可见窗口不含 `T` 与 `Z`；`title` 与 `data-iso-start` / `data-iso-end` 保留原始 ISO |
| SC-03 | 相同时区日历日省略结束日期；跨日两端都带日期。`Asia/Shanghai` 与 UTC 的日界按该时区计算 |
| SC-04 | 无法解析的时间原样显示，同步延迟格式不变 |
| SC-05 | 延迟 ≤ 5000 不挂警告类；大于 5000 挂 `pl-status-warning` 且 `data-overdue="true"` |
| SC-06 | 访问日志页「统计时间」只出现一次，可见文为相对时间 |
| SC-07 | 暂停按钮为 `pl-btn--secondary`；点击后刷新状态变为 `paused` |
| SC-08 | 「字段说明」与「查看审计口径」仍在口径说明区域内 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

沿用「窗口」「时区」「统计时间」「审计同步延迟」「刷新」「问询记录」「调用流水」。不把同步延迟改写成「已同步」或「最新」。IANA 时区名保持 `translate="no"` 与 `notranslate`。§4.7 中访问日志的「统计时间」位置说明改为上下文条内只出现一次。

## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows
- [x] 视觉层级与交互语义一致：上下文事实用次要色标签，暂停动作用次要按钮
- [x] 选中态未误用 `primary` / `danger`（时间范围仍走 segmented）
- [x] PageHeader 可见动作不变
- [x] 颜色使用语义 token（`text-fg-muted`、`text-warning-strong`、`border-border-default`、`bg-bg-surface`），无新增硬编码色值
- [x] 间距沿用管理页筛选条的圆角、边框和内边距
- [x] 文案沿用既有术语
- [x] 暂停按钮保持可键盘访问，`aria-pressed` 不变

### Exceptions (If Any)
- None

### Follow-up Needed
- None
