# Agent 名册 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v1.4** |
| 日期 / 目标版本 | 2026-10-30；2026-11-01 功能合同收口；同日 v1.4 增量修订 / 不绑定产品版本号 |
| 台账号 | 无。不进入 v0.25 升级台账，不另派 WebUI 流水号 |
| 状态 | **v1.4 增量已落地（2026-11-01）**。第四张卡改为固定语义的「暂时不能查数」；名册页头不再放整宽降级提示。改写 SC-01 与 SC-16／SC-17 已通过本地 vitest（见 §7.3）。v1.3 的 SC-02–SC-15 仍以 [收口记录](../reviews/2026-11-01-agent-roster-closure.md) 为准。设计基线见 [第 3 轮 Codex 审阅](../reviews/2026-10-30-codex-review-agent-roster.md)。**本条收口不表示可上线**——移动窄屏、Docker 重建、客户交付不在本条出口 |
| 决策来源 | 2026-10-30 对 `/admin/agents` 的名册讨论。六项呈现全部接受；列头用 Token；启用行不放标记；仅连接用次级文字。**2026-11-01**：页头「有 Agent 暂时不能查数」整宽提示过突兀；批准用第四张 KPI 常驻异常计数替换「可用 Token」，标题与读法固定、主值永远是数字，不为健康／异常切换卡身份 |
| 需求来源 | 数据平台经理在这一页要看出谁能访问、有没有 Agent 暂时不能查数、这周有没有在查数；凭据可用性改由主表 Token 列与 `/admin/tokens` 承担 |
| 实施主体 | Lucy WebUI。不修改 KTX 源码，不改审计写入，不改 `GET /api/admin/policy-runtime` 契约 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **另起呈现合同。** 用量口径继续以 Spec 155 / 189 为准。本文件只改 `/admin/agents` 展示哪些数，以及对象详情抽屉补哪三行。不改三层分类、恒等式、活跃 Agent 分子。策略降级的机器原因与修复文案继续来自既有 policy-runtime／`PolicyDegradeNotice` 内容，本文件只改名册页的呈现落点 |
| 实施计划 | [`docs/plans/lucy-20261030-agent-roster-plan.md`](../plans/lucy-20261030-agent-roster-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：`/admin/agents` 用四张卡和六列表回答谁能访问、有没有 Agent 暂时不能查数、这周有没有在查数；仅连接可被看见和筛出，且不改变活跃 Agent 的计数。第四张卡固定为「暂时不能查数」异常计数，不用整宽 banner 顶在页头
- 本条出口：SC-01–SC-17 的组件测试、契约测试和术语检查（其中 SC-01 以 v1.4 为准；SC-16、SC-17 为 v1.4 新增；SC-02–SC-15 仍以 v1.3 收口为准）
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
- Temporarily Unable to Query Agents: UI 主术语「暂时不能查数」。名册第四张 KPI 的固定标题。主值是因 EffectivePolicy 无法应用而暂停查数的 Agent 个数；健康时为 `0`，不为健康／异常切换卡标题或卡身份。

Forbidden terms:

- 列头使用「凭据」或「Token 凭据」。侧栏「Token 凭据」仍是 `/admin/tokens` 的页面名。
- 异常主行写「无可用凭据」。
- 把「仅连接」叫成「仅连接会话」，或把它算进近 N 活跃 Agent。
- 启用行上放「启用」胶囊、绿点或灰点。
- 筛选项「闲置」纳入仅连接，或纳入指标不可用的行。空的最近业务使用仍写「未使用」，不改成「闲置」。
- 第四张卡按健康态改成「查数正常／查数异常」等状态文案主值，或健康时拆掉该卡、异常时再插入。
- 名册页头再放整宽「有 Agent 暂时不能查数／所有 Agent 暂时不能查数」提示块顶在指标卡之上（详情页 scoped 提示不在本禁令内）。

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
- [ ] 「暂时不能查数」卡：主值 `> 0` 用 Metric Card 既有 `warning` tone；全局降级用既有 `danger` tone；`0` 时不加 tone，不用 success 绿壳表示健康
- [ ] 「已禁用」使用既有 `pl-status-badge` 与 `pl-status-not_started`
- [ ] 「仅连接」使用次级文字色，不上 warning 色
- [ ] 表格继续用 `pl-data-grid`。宽表滚动容器保持；本页列减少后，不把壳层最小宽度改小

### Exceptions (If Any)

- None

### Follow-up Needed

- None

## 1. 背景

`/admin/agents` 现在是六张卡、十二列表。经理要横滑才能看完一个人。当前演示数据里，业务调用 14 次，协议请求 777 次；四个 Agent 里只有一个这周有业务调用。另一个 Agent 的业务调用是 0、协议请求是 360，最近 MCP 访问是几分钟前，最近业务使用是十天前。协议量和最近 MCP 访问会把「客户端还连着」读成「这周在查数」。

这一页的工作是名册：谁能访问，有没有 Agent 暂时不能查数，这周有没有在查数。凭据可用性留在表内 Token 列与 `/admin/tokens`。协议诊断留在点名之后。

v1.3 收口后，策略降级仍用页头整宽 `PolicyDegradeNotice` 顶在四张卡之上；有多名 Agent 异常时文案过长，把名册概览顶下去，也和「KPI 用数字显性提醒异常」的读法不一致。「可用 Token」汇总已在 `/admin/tokens` 与主表 Token 列重复出现，适合让出第四格。

## 2. 目标

1. 顶部四张卡：Agent 总数、近 7 天活跃 Agent、近 7 天业务调用量、暂时不能查数。
2. 主表六列：显示名/用户 ID、角色、Token、近 7 天业务调用量、最近业务使用、操作。
3. 未启用的 Agent 在显示名旁标「已禁用」。已启用的行不放状态标记。
4. 仅连接可以在时间旁看见，也可以从「近 7 天活跃」筛出来。它不增加活跃 Agent。
5. 协议请求量和最近 MCP 访问改到对象详情抽屉。接口字段保留。
6. 名册页头不再渲染整宽策略降级提示；异常名单与修复说明挂在第四张卡的展开区。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 Spec 189 的协议集合、默认用量、活跃 Agent 分子、调用量恒等式 | 本文件只改名册呈现 |
| 删除 `protocolCallsLast7d`、`lastSeen`、`usedCredentialCountLast7d` 等接口字段 | 抽屉和其它页面还要读 |
| 改 `/admin/tokens`、使用概况、调用监控 | 那些页有自己的合同；可用 Token 汇总留在 Token 页 |
| 改 `GET /api/admin/policy-runtime` 或降级原因码 | 只改名册呈现落点 |
| 强制改掉 `/admin/agents/:userId` 上已有的 scoped `PolicyDegradeNotice` | 详情页仍可对当前 Agent 提示修复；本文件约束名册列表页 |
| 把近 7 天拒绝放回主表或顶部卡 | 拒绝留在抽屉和访问日志 |
| 改列表排序 | 保持接口返回顺序，避免心跳把行顶到最前 |
| 为窄屏新做断点或改壳层最小宽度 | 本仓库默认不做移动窄屏 |
| 新建「闲置」列或「闲置」标记 | 闲置只是筛选档；时间列继续写最近业务使用 |

## 4. 已冻结决策

| ID | 决策 | 冻结 |
|---|---|---|
| D1 | 顶部四张卡，顺序见 §5.1。去掉近 7 天使用过的凭据、近 7 天协议请求量。**v1.4：第四张由「可用 Token」改为「暂时不能查数」** | **已冻结** |
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
| D14 | 「暂时不能查数」卡标题与读法固定；主值永远是数字（或不可用时「—」）。健康时为 `0`，仍占第四格。不为健康／异常切换卡身份。名册页头不再渲染整宽 `PolicyDegradeNotice`；名单与修复说明只出现在该卡展开区 | **已冻结** |

## 5. 页面

页头、刷新、新建 Agent、行内「编辑 / 查看权限 / 查看日志」、搜索、当前状态、角色筛选保持现状。当前状态的选项继续是全部状态、已启用、已禁用。

### 5.1 指标卡

容器是 `pl-metric-grid`，不带 `pl-metric-grid--three`。四张卡的标题固定，不为健康／异常改标题或拆插卡片：

| 顺序 | 标题 | 值 |
|---|---|---|
| 1 | Agent 总数 | 当前配置 Agent 数，含未启用 |
| 2 | 近 7 天活跃 Agent | `usageActiveAgentCountLast7d`。帮助文案继续写明只按业务调用判定 |
| 3 | 近 7 天业务调用量 | `usageCallsLast7d` |
| 4 | 暂时不能查数 | 见 §5.1.1。主值永远是数字；健康为 `0` |

`kpiContracts.ts`：

- `used-credential-count` 的条目保留，帮助文案仍与「近 N 业务活跃 Token」区分。`pages` 去掉 `/admin/agents`。该条目目前只登记了这一页，去掉之后 `pages` 为空。`kpi-contracts.test.ts` 里「每个条目至少有一页」的断言为这一条单独放行，其它条目仍至少有一页。
- `calls-7d` 与 `active-agent-count` 仍登记在本页。
- **v1.4** 新增本页条目（建议 id：`temporarily-unable-to-query-agents`），`label` 为「暂时不能查数」，`pages` 含 `/admin/agents`，`windowed: false`。帮助文案写明：因 EffectivePolicy 无法应用而暂停查数的 Agent 个数；`0` 表示当前无此异常；全局降级时等于本页 Agent 总数。
- 名册顶卡不再展示「可用 Token」汇总；该汇总继续由 `/admin/tokens` 与主表 Token 列承担。若契约里曾把「配置 Token／可用 Token」只挂在本页顶卡，按实现核对后从本页 `pages` 拿掉或改为指向 Token 页，不得让已下线的顶卡继续登记在本页。

页顶「审计写入尚未完成」的提示保留。只因为凭据 prefix 冲突而出现的「近 7 天使用过的凭据无法可靠映射」提示从本页移除。

**名册列表页不再在页头／指标卡之上渲染整宽 `PolicyDegradeNotice`（`data-testid=policy-degrade-banner`）。** 降级呈现落在第四张卡及其展开区。

### 5.1.1 「暂时不能查数」卡

数据来自既有 `GET /api/admin/policy-runtime`（与现 `PolicyDegradeNotice` 同源），不新造接口字段。与本页 `GET /api/admin/agents` 的 Agent 列表一起派生主值。

| 条件 | 主值 | tone | 副文 |
|---|---|---|---|
| `healthy == true`，或可见异常 Agent 数为 0 | `0` | 无 | 可写「当前无此异常」；不得改成「正常」主值 |
| 非全局降级，且有具名异常 Agent | 去重后的异常 Agent 个数（读 `issues[].agentId`；无 `issues` 时读 `degradedAgents`） | `warning` | 可写「需修复角色或配置」 |
| `degradedGlobal == true` | 本页当前配置 Agent 总数（与第一张卡同一分母，含未启用） | `danger` | 可写「全部 Agent」 |
| policy-runtime 请求失败或尚未可读 | 「—」，`state=unavailable` | 无 | 「数据源不可用」或组件既有不可用副文；**不得把失败显示成 `0`** |

展开区（仅主值是大于 0 的数字时提供）：

- 列出与现 `PolicyDegradeNotice` 相同的异常项：Agent 显示名（无则用户 ID）、修复说明、`打开这个 Agent`／`去修改角色` 链接（有 role 时）。
- 保留脚注：「保存成功后，这条提示会消失。」
- 主值为 `0` 或「—」时不渲染展开区内容。
- 展开控件放在第四张卡内或紧贴该卡下方，不得再变成页头整宽 warning 条。
- 全局降级时展开区展示全局修复说明（现 `access_config_unreadable` 文案），不要求再枚举每一个 Agent 行。

计数口径：

- 只统计当前名册响应里仍存在的 Agent id；已从配置删除、但偶发残留在 policy-runtime 里的 id 不计入主值。
- 同一 Agent 多条 issue 只计 1。
- 不把「无可用 Token」、闲置、仅连接算进本卡。

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
policy = GET /api/admin/policy-runtime
windowStart = response.summary 存在 ? response.summary.windowStart : 缺失
windowEnd = response.summary 存在 ? response.summary.windowEnd : 缺失
render 前三张卡 from response.summary
  不渲染 usedCredential、protocolCalls、可用 Token 汇总顶卡
render 第四张卡「暂时不能查数」per §5.1.1(policy, response.agents)
  名册页头不渲染整宽 PolicyDegradeNotice
  if 主值 > 0:
    展开区可列出修复说明与链接
  else:
    不渲染展开区

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

失败分支：`metricsState == "unavailable"` 或 `usageCallsLast7d` 为 `null` 或缺失时，该行 calls 与时间为「—」，`bucket = unknown`，没有仅连接。配置数和可用数仍按 access 配置显示，因为它们不来自审计库。缺 `summary` 时按缺窗口处理，不另造 7 天。policy-runtime 失败时第四张卡主值为「—」，不得写成 `0`。

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
| SC-01 | **v1.4 改写。** 指标卡恰好四张，顺序为 Agent 总数、近 7 天活跃 Agent、近 7 天业务调用量、暂时不能查数。没有可用 Token 顶卡，没有近 7 天使用过的凭据，没有近 7 天协议请求量。网格不带 `pl-metric-grid--three`。名册页在指标卡之上没有 `policy-degrade-banner` |
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
| SC-16 | **v1.4 新增。** 「暂时不能查数」卡标题固定。`healthy` 时主值是数字 `0`，无 warning／danger tone，无展开区。两个具名 Agent 降级且均在本页名册中时，主值是 `2`，tone 为 warning；展开后可见两名 Agent、修复说明，以及打开 Agent／去修改角色链接（有 role 时），并有「保存成功后，这条提示会消失。」。页头没有整宽 `policy-degrade-banner` |
| SC-17 | **v1.4 新增。** `degradedGlobal` 且本页有 5 个配置 Agent 时，主值是 `5`，tone 为 danger；展开区给全局修复说明，不要求枚举五行。policy-runtime 失败时主值是「—」，副文走不可用，不得显示 `0`。`kpiContracts` 为本卡登记本页；帮助文案区分「暂时不能查数」与「可用 Token／无可用 Token」 |

### 7.2 执行结果与逐条落点（2026-11-01）

证据等级：**本地自动化（vitest）＋ 本地工程门禁**。无 CI job 证据，无客户环境证据。完整记录见 [收口记录](../reviews/2026-11-01-agent-roster-closure.md)。

> **本节更正的过期登记**：本 Spec 状态行此前只写「v1.2 已定稿。第 3 轮 Codex 确认可定稿」——那只反映了**设计定稿**。实施 Plan v1.2 记「S1、S2 已按本 Plan 实现，**SC-01–SC-15 已执行并通过**（2026-10-30，记录见 §5）」。**实现与验收在 2026-10-30 就已完成并留痕，是 Spec 状态行没跟上**。本次收口按 Plan §5.1 的对照表**逐条复核**（不直接采信）后关闭。

| 编号 | 结果 | 落点 |
|---|---|---|
| SC-01 | 通过（**v1.3 口径**；v1.4 改写后须重跑，见 §7.3） | `agent-list.test.tsx`「renders stability-and-adoption top metrics（SC-01）」——当时断言第四张为可用 Token |
| SC-02 | 通过 | `agent-list.test.tsx`「renders prioritized table columns for ops value（SC-02）」 |
| SC-03 | 通过 | `agent-list.test.tsx`「SC-03 已启用的行没有状态标记，未启用的行在显示名旁标「已禁用」」 |
| SC-04 | 通过 | `agent-list.test.tsx`「SC-04 Token 格按可用数与配置数写主行与次行」 |
| SC-05 | 通过 | `agent-list.test.tsx`「SC-05 仅连接可以被看见，但不进活跃 Agent 分子」 |
| SC-06 | 通过 | `agent-list.test.tsx`「SC-06 闲置行不带「仅连接」标记」 |
| SC-07 | 通过 | `agent-list.test.tsx`「SC-07 指标不可用的行显示「—」，只有 metricsState=unavailable 写「数据不可用」」 |
| SC-08 | 通过 | `agent-list.test.tsx`「SC-08 近 7 天活跃四档互斥、且不改变行序」 |
| SC-09 | 通过 | `agent-list.test.tsx` 三支——去掉 `windowStart` 时协议量大于 0 仍是仅连接、协议量为 0 不再是；去掉 `windowEnd` 时协议量为 0 不标仅连接；缺整个 `summary` 时协议量大于 0 可标仅连接、协议量为 0 不标 |
| SC-10 | 通过 | `object-detail-drawer.test.tsx` 四支——指标可用时抽屉展示协议请求量与两个时间、业务调用量读 `usageCallsLast7d`；指标可用但时间为空时写「未使用」和「未访问」；指标可用且协议量为 null 或缺失时写「—」不写成 0；指标不可用时五个值都是「—」且正文不出现「未使用」或「未访问」 |
| SC-11 | 通过 | `agent-list.test.tsx`「SC-11 名册不再提示凭据 prefix 冲突」 |
| SC-12 | 通过 | `kpi-contracts.test.ts`「SC-12 名册不再登记「近 N 使用过的凭据」，其它条目仍指向本页」 |
| SC-13 | 通过 | **既有接口测试，未另写服务端测试**——`admin-agents.test.ts`「separates protocol requests from business usage and keeps all-time last access」（`protocolCallsLast7d`、`lastSeen`）、「marks used-credential metrics partial when con…」 |
| SC-14 | 通过 | `agent-list.test.tsx`「SC-14 a-time 在窗口内是仅连接，最近 MCP 访问改成窗口终点后不再是」 |
| SC-15 | 通过 | `agent-list.test.tsx`「SC-15 窗口内的业务时间不构成仅连接，协议量大于 0 仍是」 |

**实测（2026-11-01 复跑）**：`agent-list.test.tsx` / `kpi-contracts.test.ts` / `object-detail-drawer.test.tsx` —— **3 文件 / 82 条全绿**。

**这些用例不是空转**（Plan §5.1「S1 退出条件（反证）」）：

| 拿掉什么 | 应当失败的 SC |
|---|---|
| 删掉时间条款 | SC-07、SC-08、SC-14、SC-15 |
| 把缺失的 `windowStart` 当成没有下界 | SC-09 |
| 把闲置写成「业务调用量为 0」 | SC-05、SC-07、SC-08、SC-09（两支）、SC-14、SC-15 |
| 抽屉去掉「先判指标是否可用」的守卫 | SC-10 不可用分支 |

每个 SC 都挂在**具体判定的失效**上，不是「断言一个常量」的空用例。

### 7.3 v1.4 增量执行结果（2026-11-01）

| 编号 | 结果 | 落点 |
|---|---|---|
| SC-01 | 通过（v1.4 口径） | `agent-list.test.tsx`「renders stability-and-adoption top metrics（SC-01）」 |
| SC-02–SC-15 | 仍以 §7.2 为准 | 本增量不重开 |
| SC-16 | 通过 | `agent-list.test.tsx`「SC-16 暂时不能查数卡在健康时为 0，部分降级时可展开修复说明且无页头 banner」 |
| SC-17 | 通过 | `agent-list.test.tsx`「SC-17 全局降级按 Agent 总数计数；policy-runtime 失败不得写成 0」＋ `kpi-contracts.test.ts` 对本卡的登记断言 |

**实测**：`agent-list.test.tsx` / `kpi-contracts.test.ts` / `policy-degrade-notice.test.tsx` —— **3 文件 / 67 条全绿**。

实现落点：`PolicyDegradeMetric.tsx`、`policyDegradeMetric.ts`、`AgentList.tsx`、`PolicyDegradeBanner.tsx`、`kpiContracts.ts`、术语标准 §4.5。
