# Agent 名册 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v1.2** |
| 日期 / 目标版本 | 2026-10-30 / 不绑定产品版本号 |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 状态 | **v1.2 已定稿**。第 3 轮 Codex 确认可定稿，阻塞 0，高 0。见 [`docs/reviews/2026-10-30-codex-review-agent-roster.md`](../reviews/2026-10-30-codex-review-agent-roster.md) |
| 决策来源 | 2026-10-30 对 `/admin/agents` 的名册讨论。六项呈现全部接受；列头用 Token；启用行不放标记；仅连接用次级文字 |
| 需求来源 | 数据平台经理在这一页要看出谁能访问、凭据还能不能用、这周有没有在查数 |
| 实施主体 | Lucy WebUI。不修改 KTX 源码，不改审计写入 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **另起呈现合同。** 用量口径继续以 Spec 155 / 189 为准。本文件只改 `/admin/agents` 展示哪些数，以及对象详情抽屉补哪三行。不改三层分类、恒等式、活跃 Agent 分子 |
| 实施计划 | [`docs/plans/lucy-20261030-agent-roster-plan.md`](../plans/lucy-20261030-agent-roster-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：`/admin/agents` 用四张卡和六列表回答谁能访问、凭据还能不能用、这周有没有在查数；仅连接可被看见和筛出，且不改变活跃 Agent 的计数
- 本条出口：SC-01–SC-15 的组件测试、契约测试和术语检查
- 不在本条出口：整库旅程、跨模块故障演练、证据等级、移动窄屏、Docker 重建
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Connect-only Agent: UI 主术语「仅连接」。近 7 天业务调用量为 0，且近 7 天协议请求量大于 0，或最近 MCP 访问落在本页窗口内而最近业务使用早于该窗口或为空。不计入近 N 活跃 Agent。
- Idle Agent: UI 主术语「闲置」。只作筛选档。近 7 天没有业务调用，且不是仅连接。指标不可用的行不属于闲置。
- No Available Token: UI 主术语「无可用 Token」。可用 Token 为 0 且配置 Token 大于 0。
- Agent Roster Token Column: 列头「Token」。主行「可用 n」或「无可用 Token」，次行「配置 n」。
- Agent Disabled Mark: UI 主术语「已禁用」。只出现在未启用 Agent 的显示名旁。

Forbidden terms:

- 列头使用「凭据」或「Token 凭据」。侧栏「Token 凭据」仍是 `/admin/tokens` 的页面名。
- 异常主行写「无可用凭据」。
- 把「仅连接」叫成「仅连接会话」，或把它算进近 N 活跃 Agent。
- 启用行上放「启用」胶囊、绿点或灰点。
- 筛选项「闲置」纳入仅连接，或纳入指标不可用的行。空的最近业务使用仍写「未使用」，不改成「闲置」。

术语标准 §4.5 已登记上表。实现不得另起译名。`Agent`、`Token`、`MCP`、用户 ID、角色 id 在 DOM 上使用 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/12-components-metric-card.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

### What This Change Follows

- [ ] 四张卡使用共享 Metric Card，容器用默认 `pl-metric-grid`，去掉 `pl-metric-grid--three`
- [ ] xl 断点一行四张；更窄宽度沿用该组件既有的两列，不新写断点
- [ ] 「无可用 Token」使用既有 `text-warning-strong`，不新增色值，不做新胶囊
- [ ] 「已禁用」使用既有 `pl-status-badge` 与 `pl-status-not_started`
- [ ] 「仅连接」使用次级文字色，不上 warning 色
- [ ] 表格继续用 `pl-data-grid`。宽表滚动容器保持；本页列减少后，不把壳层最小宽度改小

### Exceptions (If Any)

- None

### Follow-up Needed

- None

## 1. 背景

`/admin/agents` 现在是六张卡、十二列表。经理要横滑才能看完一个人。当前演示数据里，业务调用 14 次，协议请求 777 次；四个 Agent 里只有一个这周有业务调用。另一个 Agent 的业务调用是 0、协议请求是 360，最近 MCP 访问是几分钟前，最近业务使用是十天前。协议量和最近 MCP 访问会把「客户端还连着」读成「这周在查数」。

这一页的工作是名册：谁能访问，凭据还能不能用，这周有没有在查数。协议诊断留在点名之后。

## 2. 目标

1. 顶部四张卡：Agent 总数、近 7 天活跃 Agent、近 7 天业务调用量、可用 Token。
2. 主表六列：显示名/用户 ID、角色、Token、近 7 天业务调用量、最近业务使用、操作。
3. 未启用的 Agent 在显示名旁标「已禁用」。已启用的行不放状态标记。
4. 仅连接可以在时间旁看见，也可以从「近 7 天活跃」筛出来。它不增加活跃 Agent。
5. 协议请求量和最近 MCP 访问改到对象详情抽屉。接口字段保留。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 Spec 189 的协议集合、默认用量、活跃 Agent 分子、调用量恒等式 | 本文件只改名册呈现 |
| 删除 `protocolCallsLast7d`、`lastSeen`、`usedCredentialCountLast7d` 等接口字段 | 抽屉和其它页面还要读 |
| 改 `/admin/tokens`、`/admin/agents/:userId`、使用概况、调用监控 | 那些页有自己的合同 |
| 把近 7 天拒绝放回主表或顶部卡 | 拒绝留在抽屉和访问日志 |
| 改列表排序 | 保持接口返回顺序，避免心跳把行顶到最前 |
| 为窄屏新做断点或改壳层最小宽度 | 本仓库默认不做移动窄屏 |
| 新建「闲置」列或「闲置」标记 | 闲置只是筛选档；时间列继续写最近业务使用 |

## 4. 已冻结决策

| ID | 决策 | 冻结 |
|---|---|---|
| D1 | 顶部四张卡，顺序见 §5.1。去掉近 7 天使用过的凭据、近 7 天协议请求量 | **已冻结** |
| D2 | 主表六列，顺序见 §5.2。不保留序号，不保留独立的当前状态列 | **已冻结** |
| D3 | 列头是 Token。可用为 0 且配置大于 0 时主行写「无可用 Token」 | **已冻结** |
| D4 | 已启用不放胶囊、圆点或「启用」。未启用只标「已禁用」 | **已冻结** |
| D5 | 仅连接的判定见 §6。它不计入近 7 天活跃 Agent | **已冻结** |
| D6 | 「仅连接」是次级文字，跟在最近业务使用后面。不上 warning 色 | **已冻结** |
| D7 | 筛选四档：全部、有业务调用、仅连接、闲置。指标不可用的行只留在全部 | **已冻结** |
| D8 | 排序保持接口返回顺序 | **已冻结** |
| D9 | 抽屉补近 7 天协议请求量、最近业务使用、最近 MCP 访问。主表不放后两者里的协议侧 | **已冻结** |
| D10 | 名册去掉「近 7 天使用过的凭据」卡、列，以及只为该数服务的 prefix 冲突提示 | **已冻结** |
| D11 | 指标不可用时，业务调用量和最近业务使用显示「—」，不标仅连接，不归入闲置 | **已冻结** |
| D12 | 窗口边界用本响应的 `summary.windowStart` / `summary.windowEnd`，半开区间。缺 summary、缺任一端，时间条款都不成立；协议请求量大于 0 仍可标仅连接 | **已冻结** |
| D13 | 抽屉先看指标是否可用。不可用时协议请求量和两个时间都是「—」。可用且时间为空时，最近业务使用写「未使用」，最近 MCP 访问写「未访问」 | **已冻结** |

## 5. 页面

页头、刷新、新建 Agent、行内「编辑 / 查看权限 / 查看日志」、搜索、当前状态、角色筛选保持现状。当前状态的选项继续是全部状态、已启用、已禁用。

### 5.1 指标卡

容器是 `pl-metric-grid`，不带 `pl-metric-grid--three`。四张卡的标题、帮助文案和数据来源保持现在这四张的口径：

| 顺序 | 标题 | 值 |
|---|---|---|
| 1 | Agent 总数 | 当前配置 Agent 数，含未启用 |
| 2 | 近 7 天活跃 Agent | `usageActiveAgentCountLast7d`。帮助文案继续写明只按业务调用判定 |
| 3 | 近 7 天业务调用量 | `usageCallsLast7d` |
| 4 | 可用 Token | `availableTokenCount`。副文继续写配置 Token 数 |

`kpiContracts.ts` 里 `used-credential-count` 的条目保留，帮助文案仍与「近 N 业务活跃 Token」区分。`pages` 去掉 `/admin/agents`。该条目目前只登记了这一页，去掉之后 `pages` 为空。`kpi-contracts.test.ts` 里「每个条目至少有一页」的断言为这一条单独放行，其它条目仍至少有一页。`calls-7d` 与 `active-agent-count` 仍登记在本页。

页顶「审计写入尚未完成」的提示保留。只因为凭据 prefix 冲突而出现的「近 7 天使用过的凭据无法可靠映射」提示从本页移除。

### 5.2 主表

| 顺序 | 列 | 单元格 |
|---|---|---|
| 1 | 显示名/用户 ID | 现有双行。未启用时，显示名旁加「已禁用」。指标不可用时不把「数据不可用」写成禁用 |
| 2 | 角色 | 保持 |
| 3 | Token | 见 §5.3 |
| 4 | 近 7 天业务调用量 | `usageCallsLast7d`。§6 的 unknown 显示「—」。`metricsState == "unavailable"` 时，「—」下保留「数据不可用」。字段缺失但 metricsState 为 ok 时，只显示「—」 |
| 5 | 最近业务使用 | `lastBusinessSeen`。空值写「未使用」。符合 §6 时在后面加「 · 仅连接」 |
| 6 | 操作 | 编辑，以及更多菜单里的查看权限、查看日志 |

主表不再出现：序号、当前状态、配置 Token、可用 Token、近 7 天使用过的凭据、近 7 天协议请求量、最近 MCP 访问。

### 5.3 Token 格

配置数是当前 `tokens.length`。可用数沿用现有 `availableTokens`；缺该字段时，已启用用配置数，未启用用 0。这一格不读访问日志。

| 条件 | 主行 | 次行 | 颜色 |
|---|---|---|---|
| 可用为 0 且配置大于 0 | 无可用 Token | 配置 n | 主行 `text-warning-strong` |
| 其它 | 可用 n | 配置 n | 与普通数字相同 |

未启用且仍有配置时，两件事同时出现：「已禁用」和「无可用 Token」。

### 5.4 筛选

「近 7 天活跃」的选项改为：全部、有业务调用、仅连接、闲置。

| 选项 | 纳入 |
|---|---|
| 全部 | 每一行，含指标不可用 |
| 有业务调用 | §6 的 `business` |
| 仅连接 | §6 的 `connect_only` |
| 闲置 | §6 的 `idle` |

四档不改变行的先后。指标不可用的行不进入后三档。

### 5.5 对象详情抽屉

在现有「近 7 天业务调用量」和「近 7 天拒绝」之外，增加三行。先判断 `metricsState`，再判断字段是不是空。

| 标签 | 指标不可用 | 指标可用 |
|---|---|---|
| 近 7 天业务调用量 | 「—」。不把 `null` 或缺失写成 0 | `usageCallsLast7d`。不读 `callsLast7d` |
| 近 7 天拒绝 | 「—」 | 现有 `deniedLast7d` |
| 近 7 天协议请求量 | 「—」 | `protocolCallsLast7d`。`null` 或缺失时为「—」，不写成 0 |
| 最近业务使用 | 「—」 | `lastBusinessSeen`。空值写「未使用」 |
| 最近 MCP 访问 | 「—」 | `lastSeen`。空值写「未访问」 |

指标不可用包括 `metricsState == "unavailable"`。这时即使 `usageCallsLast7d` 为 0，或两个时间字段缺失，也显示「—」，不显示「未使用」或「未访问」。

抽屉不重复「仅连接」标记。访问日志链接保留。

## 6. 仅连接

分类只在名册页面派生，不新增接口字段，不回写审计。时间比较使用本响应 `summary.windowStart` 与 `summary.windowEnd` 的半开区间 `[windowStart, windowEnd)`。`summary` 缺失，或两端缺一，都是缺窗口。

`usageCallsLast7d` 为 `null` 或字段缺失，都是 `calls == null`。比较使用语言里的 `==`，因此缺失和 `null` 走同一支。

```text
calls = stats.usageCallsLast7d
protocol = stats.protocolCallsLast7d ?? 0
windowKnown = summary 存在，且 windowStart、windowEnd 都存在

if stats.metricsState == "unavailable" or calls == null:
  bucket = unknown
  mark = 无
  业务调用量与最近业务使用显示「—」
else if calls > 0:
  bucket = business
  mark = 无
else:
  mcpInWindow = windowKnown 且 windowStart <= lastSeen < windowEnd
  businessOutside = lastBusinessSeen 为空
    或 (windowKnown 且 lastBusinessSeen < windowStart)
  if protocol > 0 or (mcpInWindow 且 businessOutside):
    bucket = connect_only
    mark = 「 · 仅连接」
  else:
    bucket = idle
    mark = 无
```

`calls > 0` 的人即使最近 MCP 访问更新，也不标仅连接。`protocol > 0` 时，即使 `lastBusinessSeen` 落在窗口内，仍是仅连接。`protocol == 0` 且 `lastBusinessSeen >= windowStart` 时，时间条款不成立。缺窗口时，`mcpInWindow` 为假；`protocol > 0` 仍可标仅连接。近 7 天活跃 Agent 的分子仍是 `calls > 0` 的当前配置 Agent，不读取 `bucket`。`metricsState == "unavailable"` 时，即使 `usageCallsLast7d` 为 0，也是 unknown，不是闲置。

## 核心流程（伪代码）

```text
response = GET /api/admin/agents
windowStart = response.summary 存在 ? response.summary.windowStart : 缺失
windowEnd = response.summary 存在 ? response.summary.windowEnd : 缺失
render 四张卡 from response.summary
  不渲染 usedCredential、protocolCalls

for agent in response.agents，保持数组顺序:
  bucket, mark = §6(agent, windowStart, windowEnd)
  render 六列
  if filter == 全部 or filter 对应该 bucket:
    显示该行
  # unknown 不对应任一具名筛选，只在 filter == 全部 时显示

点击显示名:
  抽屉读取同一条 agent
  if metricsState == "unavailable":
    业务调用量、拒绝、协议请求量、最近业务使用、最近 MCP 访问都显示「—」
  else:
    按 §5.5 的「指标可用」列显示
```

失败分支：`metricsState == "unavailable"` 或 `usageCallsLast7d` 为 `null` 或缺失时，该行 calls 与时间为「—」，`bucket = unknown`，没有仅连接。配置数和可用数仍按 access 配置显示，因为它们不来自审计库。缺 `summary` 时按缺窗口处理，不另造 7 天。

## 7. 验收标准

### 7.1 共用活动夹具

窗口固定为 `windowStart = 2026-10-23T00:00:00.000Z`，`windowEnd = 2026-10-30T00:00:00.000Z`。响应里的 Agent 顺序就是下表顺序。除另列的 Token 用例外，这些行都是已启用，且 `availableTokens` 与配置数都不触发「无可用 Token」。

| id | metricsState | usageCallsLast7d | protocolCallsLast7d | lastSeen | lastBusinessSeen | 分类 |
|---|---|---|---|---|---|---|
| a-business | ok | 4 | 1 | 2026-10-26T00:00:00.000Z | 2026-10-26T00:00:00.000Z | business |
| a-protocol | ok | 0 | 3 | 2026-10-26T00:00:00.000Z | 2026-10-01T00:00:00.000Z | connect_only |
| a-time | ok | 0 | 0 | 2026-10-23T00:00:00.000Z | 缺失 | connect_only |
| a-idle | ok | 0 | 0 | 2026-10-01T00:00:00.000Z | 2026-10-01T00:00:00.000Z | idle |
| a-edge-end | ok | 0 | 0 | 2026-10-30T00:00:00.000Z | 2026-10-01T00:00:00.000Z | idle |
| a-inside-business-time | ok | 0 | 0 | 2026-10-26T00:00:00.000Z | 2026-10-23T00:00:00.000Z | idle |
| a-protocol-inside | ok | 0 | 2 | 2026-10-26T00:00:00.000Z | 2026-10-23T00:00:00.000Z | connect_only |
| a-unknown | unavailable | 0 | 9 | 2026-10-26T00:00:00.000Z | 缺失 | unknown |
| a-missing-usage | ok | 字段缺失 | 5 | 2026-10-26T00:00:00.000Z | 缺失 | unknown |

`a-time` 的 `lastSeen` 等于窗口起点，属于窗口内。`a-edge-end` 的 `lastSeen` 等于窗口终点，不属于窗口内。`a-inside-business-time` 的业务时间等于窗口起点，所以不是「早于窗口」。`a-unknown` 的业务调用量是 0，仍不得进闲置。`a-missing-usage` 的协议量大于 0，仍不得标仅连接。

| ID | 检查 |
|---|---|
| SC-01 | 指标卡恰好四张，顺序为 Agent 总数、近 7 天活跃 Agent、近 7 天业务调用量、可用 Token。没有近 7 天使用过的凭据，没有近 7 天协议请求量。网格不带 `pl-metric-grid--three` |
| SC-02 | 表头恰好为显示名/用户 ID、角色、Token、近 7 天业务调用量、最近业务使用、操作。没有序号、当前状态、配置 Token、可用 Token、近 7 天使用过的凭据、近 7 天协议请求量、最近 MCP 访问 |
| SC-03 | 已启用的行没有「启用」文案，也没有状态圆点。未启用的行在显示名旁有「已禁用」，且使用 `pl-status-not_started` |
| SC-04 | 可用 0、配置 3 时主行是「无可用 Token」并带 `text-warning-strong`，次行是「配置 3」。可用 2、配置 2 时主行是「可用 2」，次行是「配置 2」，主行不带 warning 色。`availableTokens` 缺失、已启用、配置 2 时主行是「可用 2」，不带 warning。`availableTokens` 缺失、未启用、配置 2 时同时有「已禁用」和「无可用 Token」。配置 0 时主行是「可用 0」，次行是「配置 0」，不带 warning |
| SC-05 | 在 §7.1 夹具上，`a-protocol` 有次级文字「仅连接」。`a-business` 没有「仅连接」。活跃 Agent 卡只数 `usageCallsLast7d > 0` 的行，不因 `a-protocol`、`a-time`、`a-protocol-inside` 增加 |
| SC-06 | 在 §7.1 夹具上，`a-idle`、`a-edge-end`、`a-inside-business-time` 没有「仅连接」 |
| SC-07 | 在 §7.1 夹具上，`a-unknown` 与 `a-missing-usage` 的业务调用量和最近业务使用为「—」，没有「仅连接」。只有 `a-unknown` 有「数据不可用」。两行出现在「全部」，不出现在有业务调用、仅连接、闲置 |
| SC-08 | 「近 7 天活跃」的选项是全部、有业务调用、仅连接、闲置。用 §7.1 同一次响应断言行 id：全部为表中九行且顺序不变；有业务调用只有 `a-business`；仅连接依次为 `a-protocol`、`a-time`、`a-protocol-inside`；闲置依次为 `a-idle`、`a-edge-end`、`a-inside-business-time`。后三档互不相交 |
| SC-09 | 去掉 `windowStart`、保留 `windowEnd`，协议量大于 0 且业务调用为 0 时仍标仅连接。同一缺口下用 `a-time`：协议量为 0，`lastSeen` 等于 `2026-10-23T00:00:00.000Z`，最近业务使用缺失，没有「仅连接」，进入闲置。去掉 `windowEnd`、保留 `windowStart`，协议量为 0 且 `lastSeen` 等于该起点、业务时间早于窗口时不标仅连接。`summary` 整体缺失时同样：协议量大于 0 可标仅连接，协议量为 0 不标 |
| SC-10 | 指标可用、两个时间都有值、`callsLast7d` 为 99、`usageCallsLast7d` 为 4、协议量为 3 时，抽屉业务调用量是 4，协议量是 3，并有两个时间、近 7 天拒绝。指标可用且两个时间缺失、协议量为 0 时，最近业务使用是「未使用」，最近 MCP 访问是「未访问」。指标不可用时，业务调用量、拒绝、协议请求量、最近业务使用、最近 MCP 访问都是「—」，抽屉正文没有「未使用」或「未访问」 |
| SC-11 | 本页没有「近 7 天使用过的凭据无法可靠映射」这段提示 |
| SC-12 | `used-credential-count` 仍在契约中，`pages` 不含 `/admin/agents`，且该条目允许 `pages` 为空。其它契约条目仍至少有一页。`calls-7d` 与活跃 Agent 仍指向本页。帮助文案仍写明使用过的凭据是全量访问，与业务活跃 Token 不是同一个数。用户可见文案与术语标准 §4.5 的新行一致 |
| SC-13 | `GET /api/admin/agents` 仍返回 `protocolCallsLast7d`、`lastSeen`、`usedCredentialCountLast7d`。本文件不删除这些字段 |
| SC-14 | 在 §7.1 夹具上，`a-time` 有「仅连接」。把它的 `lastSeen` 改成窗口终点、其它字段不变，则不再有「仅连接」，并进入闲置 |
| SC-15 | 在 §7.1 夹具上，`a-inside-business-time` 进入闲置。`a-protocol-inside` 有「仅连接」，并进入仅连接，不进入闲置 |
