# 访问分级与日真实问询 KPI Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v1.0** |
| 日期 / 目标版本 | 2026-10-30 / 不绑定产品版本号。功能编号待 PM 指派，不占用 WebUI 流水号，也不占用 `L25-*` |
| 功能编号 / 优先级 | **待 PM 指派** / **P0**（分级与日真实问询）、P1（会话伴随指标与按日表） |
| 状态 | **已落地 v1.0**（2026-10-30）。S1–S3 已实现。SC-01–SC-24、SC-26 由自动化测试覆盖；SC-25 沿用既有审计问询测试，本轮未改问询重建。未做浏览器验证，未做 Docker 重建 |
| 决策来源 | 2026-10-30 客户反馈：希望统计每天真实问询数量，而不是把连接、浏览和查数混成一个用量。同日批准另起 Spec，不升版改写 Spec 189 / 172 / 173 / 162 的已实施口径 |
| 需求来源 | 运维要回答「今天有多少人真正问了问题」。使用概况上的业务调用量是工具调用次数；审计问询列表同时包含已上报问询、未上报原文和会话访问 |
| 实施主体 | Lucy（用量分类读取层 + 使用概况 API 与数据访问视图）。不修改 KTX 源码 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级跨模块口径落 `docs/specs/` |
| 与既有 Spec 的关系 | **另起。** 消费 Spec 189 的用量三层、Spec 162 的「缺 begin 仍可查数」、Spec 172 / 173 的问询种类与归因。不改这四份的恒等式、归因枚举和回绑禁令。Spec 189、Spec 156 只加「尚未实现」的交叉引用 |
| 实施计划 | [`docs/plans/2026-10-30-lucy-access-grade-and-daily-question-kpi-plan.md`](../plans/2026-10-30-lucy-access-grade-and-daily-question-kpi-plan.md) |

> 本文件 v1.0 已落地到源码。访问分级在读取时派生。日真实问询按已落库的原文问询计数。SC-01–SC-24 与 SC-26 有自动化测试。未做 Docker 重建，已运行的旧容器不会自己带上这组指标。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Access Grade: UI 不单列该技术名。读取时给每条调用一个互斥等级：连接、浏览、准备、问询动作、查数、运维操作、未分级。
- Real Question Count: UI 主术语「近 N 真实问询」。窗口内已落库、带来源原文的问询，按问询 ID 去重。
- Unreported Query Session: UI 主术语「近 N 未上报查数会话」。窗口内有查数、且该会话从未落下原文问询。
- Connect-only Session: UI 主术语「近 N 仅连接会话」。窗口内该会话的调用全部是连接级。
- Browse-without-ask Session: UI 主术语「近 N 浏览未问会话」。到了浏览或准备，没有问询动作，也没有查数。
- Daily Question Table: UI 主术语「按日问询」。按 Asia/Shanghai 日历日列出上述四个数。
- Queries per Question: UI 主术语「每问询查数」。挂到本窗口原文问询上的查数次数，除以近 N 真实问询。
- Unassigned Query Call: UI 主术语「未归属查数」。没有会话 ID 的查数次数，不折算成会话。
- Unlinked Query Call: UI 主术语「未挂接查数」。没有挂到任何原文问询上的查数次数。
- Question Active Agent: UI 主术语「近 N 问询活跃 Agent」。窗口内至少有 1 条原文问询，或 1 个未上报查数会话。不替换 Spec 189 的「近 N 活跃 Agent」。

Forbidden terms:

- 用「近 N 业务调用量」「近 N 调用量」作「近 N 真实问询」的标题或帮助文案。
- 把未上报查数会话、仅连接会话、浏览未问会话加进真实问询。
- 「真实问询覆盖率」「丢日志率」。原文登记占比沿用术语标准已有定义。
- 把会话访问或「未上报问询原文」显示成真实问询。

术语标准 §4.5 已登记上表。实现阶段不得另起译名。`Agent`、`Token`、`MCP`、问询 ID、会话 ID、工具名和日期值在 DOM 上使用 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/12-components-metric-card.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

### What This Change Follows

- [ ] 四张新指标使用共享 Metric Card：标题行、ⓘ、主值、副文
- [ ] 数据访问视图仍用现有 `pl-metric-grid`；四张问询卡单独成组，不放进 Agent / Token / 授权表那一排
- [ ] 按日问询用现有表格，不新增 sparkline，也不给 Spec 156 的三张资产卡加折线
- [ ] 时间窗继续用使用概况已有的 24 小时 / 7 天分段控件
- [ ] 颜色使用既有语义 token；不新增硬编码色值
- [ ] 界面使用视图不渲染这四张卡和按日表
- [ ] 帮助文案与术语标准一致；空 ⓘ 不允许出现

### Exceptions (If Any)

- None

### Follow-up Needed

- None

---

## 1. 背景

客户要的是每天有多少真实提问。当前日志能分开三件事，但没有这个数：

| 已有口径 | 事实源 | 它回答的问题 |
|---|---|---|
| 用量三层 | `webui/server/proxy/usage-classification.ts`，Spec 189 | 这一行是协议、评测探针，还是默认用量业务调用 |
| 工具授权类 | `webui/server/proxy/acl.ts` 的 `classifyTool` | 这一工具能不能调 |
| 问询种类 | `conversation_turns` 与 Spec 172 / 173 | 这一条是原文问询、推断问询，还是会话访问 |

使用概况的「近 N 业务调用量」计默认用量里的每一次工具调用。一次提问里的目录、读表、查数会分成多行。只有握手的会话在问询记录里是「会话访问」，摘要以「会话建立：」开头，它不是提问。

原文问询的落库值是 `question_source = reported_tool`（`webui/server/proxy/mcp-proxy.ts` 写入 `lucy_begin_question` 成功之后）。历史行和部分测试使用 `reported`。归属回填注释写的是 `reported`，与现行写入值不一致。本 Spec 的分子同时接受这两个值，不在本期修改那处回填。

## 2. 目标

1. 每条访问日志在读取时得到一个互斥访问等级。等级与 Spec 189 的用量类正交，不改写历史行。
2. 使用概况数据访问视图给出「近 N 真实问询」。单位是问询，按问询 ID 去重。
3. 仅连接、浏览未问、未上报查数会话各自计数，不加入真实问询。
4. 按日问询表用 Asia/Shanghai 日历日。各日相加等于同一窗口的卡片合计。
5. Spec 189 的调用量恒等式、「近 N 活跃 Agent」和「近 N 业务调用量」数值保持不变。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 Spec 189 的协议集合、评测探针规则、三层恒等式 | 调用量与问询数是两种单位 |
| 改「近 N 活跃 Agent」的分子 | 另立「近 N 问询活跃 Agent」，避免未验收的 Spec 189 与新 KPI 绑成一次数值迁移 |
| 改 Spec 162 的问询预算、`DATA_TOOLS`、或缺 `lucy_begin_question` 仍可查数 | 查数集合与预算集合不是同一个名单 |
| 改 Spec 172 / 173 的归因、回绑禁令、会话访问重建 | 本 Spec 只读 `conversation_turns` 与 `access_log` |
| 把推断问询或会话访问算进真实问询 | 没有原文就不是本 KPI 的分子 |
| 新增统计表、定时汇总或回写 `access_log` | 与 Spec 189 一样，读取时派生 |
| 改 `/ops/calls` 的六张调用健康卡 | 调用监控继续回答报错、拒绝和变慢 |
| 改审计问询列表的来源筛选和会话访问展示 | 取证页保持原样 |
| 预登记尚未存在的 `lucy_continue_question` | 该工具落地时由该变更显式指定等级；落地前未知名走「未分级」 |
| 把服务器本地时区当作业务日 | 日历日固定为 UTC+8 |

## 4. 已冻结决策

| ID | 决策 | 取舍 | 冻结 |
|---|---|---|---|
| D1 | 访问等级在读取时按工具名派生，与用量类正交 | 不新增列、不回填 | **已冻结** |
| D2 | 真实问询只数 `question_source ∈ {reported_tool, reported}` 的已落库问询，按 `turn_id` 去重 | 失败的 begin 不计数；推断问询不计数 | **已冻结** |
| D3 | 未上报查数、仅连接、浏览未问不加入真实问询 | 四个数分卡 | **已冻结** |
| D4 | 会话类互斥，优先级见 §6.2 | 一个会话在一个窗口里只进一个会话类 | **已冻结** |
| D5 | 不替换 Spec 189 的活跃 Agent 与业务调用量 | 问询活跃 Agent 是新字段 | **已冻结** |
| D6 | 评测探针不进入任一新 KPI | 沿用 Spec 189 / 162 的探针判定 | **已冻结** |
| D7 | 空会话 ID 的查数记为未归属查数，不合成会话 | 避免一行变成一个会话 | **已冻结** |
| D8 | 卡片合计用 `buildMetricWindow` 的滚动窗口；按日表用 Asia/Shanghai | 与使用概况的 24 小时 / 7 天控件相同 | **已冻结** |
| D9 | 未知名工具的等级是「未分级」，不默认成查数或问询 | 新工具必须显式归级 | **已冻结** |

## 5. 访问等级

等级函数与 `classifyUsage` 放在同一模块 `webui/server/proxy/usage-classification.ts`。工具名名单以常量导出，SQL 与 TypeScript 使用同一份名单。比较区分大小写，与 Spec 189 的 `startsWith` 语义一致。

### 5.1 名单

连接级不另列工具名。`isMcpProtocolMethod(tool)` 为真就是连接，包括握手、探测和 `server/` 前缀。

| 等级 | 工具 |
|---|---|
| 浏览 | `connection_list`、`lucy_catalog`、`kx_catalog`、`dictionary_search`、`discover_data`、`lucy_skill_search` |
| 准备 | `wiki_search`、`wiki_read`、`lucy_skill_read`、`lucy_read_source`、`lucy_freshness`、`entity_details`、`sl_validate`、`resources/read`、`prompts/get` |
| 问询动作 | `lucy_begin_question` |
| 查数 | `lucy_query`、`lucy_explain_query`、`lucy_certified_route`、`lucy_report_template` |
| 运维操作 | `CONTROL_PLANE_TOOL_NAMES` 的现行成员：`lucy_ops_connection_tables`、`lucy_ops_source_import`。以后该常量增加成员时，等级跟随常量，不在页面复制一份名单 |
| 未分级 | 以上都不是，且不是协议方法 |

`question-experience.ts` 的 `DATA_TOOLS` 含 `wiki_search`、`wiki_read`、`lucy_read_source`、`lucy_freshness`。那些工具在本 Spec 里是准备，不是查数。预算是否消耗与访问等级无关。

### 5.2 与用量类的关系

先算 Spec 189 的用量类，再算访问等级。评测探针仍然按其工具名得到等级，但 §6 的全部新 KPI 在聚合前丢掉评测探针行。协议行的用量类仍是 `protocol`，访问等级是连接。默认用量里的浏览、准备、问询动作、查数、运维操作和未分级都继续计入 Spec 189 的默认用量，除非该行同时是评测探针。

因此：

```text
calls = rawBusiness + protocol
rawBusiness = defaultUsage + evalProbe
```

保持 Spec 189 的写法。访问等级不参与这两条恒等式。

## 6. 指标

时间窗是半开区间 `[window.startIso, window.endIso)`，由 `webui/server/admin/metric-window.ts` 的 `buildMetricWindow` 生成。使用概况只允许现有的 24 与 168 小时。不得在 SQL 里另写 `datetime('now', '-7 days')`。

人口与使用概况数据访问视图相同：日志里出现的身份都计入，不先收成「当前配置 Agent」。问询活跃 Agent 也用这个人口。它和 `/admin/agents` 上「只含当前配置 Agent」的活跃数可以不同。

### 6.1 近 N 真实问询

分子是 `conversation_turns` 中同时满足以下条件的行，按 `turn_id` 去重：

- `question_source` 是 `reported_tool` 或 `reported`
- `created_at >= window.startIso` 且 `created_at < window.endIso`
- `turn_id` 非空

`lucy_begin_question` 因缺少 `intentSummary` 或落库失败而没有问询行时，不计数。同一 `turn_id` 只计一次。同一会话里两次成功的 begin 计两次。

查询成功且条数为 0 时，状态是 `ok`，值是 0。查询失败时状态是 `unavailable`，值是 `null`，界面显示「—」。

### 6.2 会话类

只使用非空 `lucy_session_id`。评测探针行先排除。一个会话至多落入一个类：

```text
reportedSession = 存在 conversation_turns
  其 session_id 等于该会话
  且 question_source ∈ {reported_tool, reported}
  不限 created_at 是否在窗口内

若 reportedSession：
  该会话不进入仅连接、浏览未问、未上报查数
否则若窗口内有查数级且非评测探针的行：
  类 = 未上报查数会话
  归属日 = 这些查数行里最早一条的上海日历日
否则若窗口内有浏览或准备级的行：
  类 = 浏览未问会话
  归属日 = 这些行里最早一条的上海日历日
否则若窗口内至少有一行，且每一行都是连接级：
  类 = 仅连接会话
  归属日 = 最早一条连接行的上海日历日
否则：
  类 = 无
  计入排除会话数（运维操作、未分级，或与连接混在一起但没有浏览、准备、查数）
```

窗口外已有原文问询的会话，今天又来查数，不算未上报查数。该原文问询只有 `created_at` 落在窗口内才进入真实问询。

空 `lucy_session_id` 的查数级、非评测探针行计入未归属查数，单位是调用，不增加未上报查数会话。

### 6.3 查数伴随数

| 字段 | 定义 |
|---|---|
| 查数次数 | 窗口内查数级且非评测探针的调用行数 |
| 未挂接查数 | 其中 `lucy_turn_id` 与 `effective_turn_id` 都对不上任何原文问询 `turn_id`（不限该问询是否在本窗口创建） |
| 每问询查数 | 窗口内查数级、非评测探针、且 `lucy_turn_id` 或 `effective_turn_id` 属于本窗口原文问询的行数，除以近 N 真实问询。分母为 0 时状态 `no_data`，值为 `null` |
| 问询活跃 Agent | 窗口内原文问询的去重 `user_id`，并上未上报查数会话在窗口内查数行上的去重 `user_id`。空 `user_id` 不计入 |

未挂接查数大于 0 时，真实问询卡的副文写出该次数。它不加入主值。

### 6.4 按日问询

上海日是把事件时间加上 8 小时后的 UTC 日历日，格式 `YYYY-MM-DD`。不使用 SQLite `localtime`，也不使用容器时区。

对窗口内每个与 `[window.start, window.end)` 相交的上海日生成一行：

- 真实问询：`created_at` 落在「该上海日 ∩ 窗口」内的原文问询数
- 三个会话类：按 §6.2 归到该日的会话数
- `partialDay`：该上海日的 `[当日 00:00, 次日 00:00)`（UTC+8）没有被窗口完全盖住时为真

四个列在全部行上的合计分别等于四张卡的窗口合计。边缘日是窗口的一部分，不是那一自然日的全天合计。界面在 `partialDay` 为真时显示「未覆盖全天」。

### 6.5 页面与 API

只扩展 `GET /api/admin/governance/overview`。不新增路由。响应在现有字段之外增加：

| 字段 | 含义 |
|---|---|
| `realQuestions` | §6.1，含 Spec 128 的 `state` / `value` |
| `unreportedQuerySessions` | §6.2 |
| `connectOnlySessions` | §6.2 |
| `browseWithoutAskSessions` | §6.2 |
| `excludedSessions` | §6.2 的排除会话数 |
| `unassignedQueryCalls` | §6.2 |
| `queryCalls` | §6.3 查数次数 |
| `unlinkedQueryCalls` | §6.3 |
| `queriesPerQuestion` | §6.3 |
| `questionActiveAgents` | §6.3 |
| `dailyQuestions` | §6.4 的行数组 |

`activeAgentCount`、`usage.calls` 及 Spec 189 已有字段的计算路径不读取这些新字段。

`/admin/usage` 数据访问视图在三张资产卡下方显示四张 Metric Card，顺序为：近 N 真实问询、近 N 未上报查数会话、近 N 仅连接会话、近 N 浏览未问会话。其下是「按日问询」表。真实问询卡副文包含问询活跃 Agent；分母大于 0 时再包含每问询查数；未挂接查数大于 0 时写出该次数。未上报查数会话卡在未归属查数大于 0 时写出该次数。

`?view=interface` 不请求、不展示这组数据。调用监控、Agent 列表、审计问询记录不新增这些卡。

`webui/src/lib/kpiContracts.ts` 登记新指标的标题和帮助文案。帮助文案写明单位是问询或会话，并写明不含协议连接与评测探针。

## 7. 核心流程（伪代码）

```text
REPORTED_SOURCES = {reported_tool, reported}
SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function accessGrade(tool):
  if isMcpProtocolMethod(tool): return connect
  if tool in BROWSE: return browse
  if tool in PREPARE: return prepare
  if tool == lucy_begin_question: return ask
  if tool in QUERY: return query
  if tool in CONTROL_PLANE_TOOL_NAMES: return control
  return unclassified

function shanghaiDate(ts):
  return UTC calendar date of (parse(ts) + SHANGHAI_OFFSET_MS)

function isEvalProbe(row):
  return classifyUsage(row) == eval_probe

function realQuestions(window, turns):
  seen = empty set
  for turn in turns:
    if turn.question_source not in REPORTED_SOURCES: continue
    if turn.turn_id is empty: continue
    if turn.created_at < window.start or turn.created_at >= window.end: continue
    seen.add(turn.turn_id)
  return seen

function sessionClass(sessionRows, hasReportedTurnAnyTime):
  rows = sessionRows where not isEvalProbe(row)
  if hasReportedTurnAnyTime: return none
  queries = rows where accessGrade(row.tool) == query
  if queries is not empty:
    return unreportedQuery at shanghaiDate(min ts of queries)
  prep = rows where accessGrade(row.tool) in {browse, prepare}
  if prep is not empty:
    return browseWithoutAsk at shanghaiDate(min ts of prep)
  if rows is not empty and every row has accessGrade == connect:
    return connectOnly at shanghaiDate(min ts of rows)
  if rows is not empty:
    return excluded
  return none

function queriesPerQuestion(window, rows, reportedTurnIdsInWindow):
  if reportedTurnIdsInWindow.size == 0: return no_data
  linked = 0
  for row in rows:
    if row.ts < window.start or row.ts >= window.end: continue
    if isEvalProbe(row): continue
    if accessGrade(row.tool) != query: continue
    if row.lucy_turn_id in reportedTurnIdsInWindow
       or row.effective_turn_id in reportedTurnIdsInWindow:
      linked += 1
  return ok(linked / reportedTurnIdsInWindow.size)

function dailyTable(window, questions, sessions):
  dates = every Shanghai date whose [00:00, +24h) intersects window
  for date in dates:
    slice = intersection(date bounds, window)
    partialDay = slice != full Shanghai day
    emit date, partialDay,
      questions whose created_at in slice,
      sessions of each class whose assigned date == date
  assert sum(question column) == questions.size
  assert sum(each session column) == that session class size
```

失败分支：

- 审计库不可读：四个主指标和按日表都是 `unavailable`，值为 `null`，不返回 0。
- `created_at` 或 `ts` 无法解析：该行不进入分子，并计入响应中的 `skippedBadTimestamp`。该计数大于 0 时四个主指标仍给出已解析行的值，状态保持 `ok`；帮助文案不把结果说成完整对账。
- 同一 `turn_id` 出现多行：去重后计 1。
- 工具名为空且不是协议方法：等级为未分级。

## 8. 验收

每条都写明初态、输入、判定时点和期望。时间用可控时钟，不依赖当场的自然日。

| ID | 初态 | 输入 | 观测时点 | 期望 |
|---|---|---|---|---|
| SC-01 | 空审计库 | 一行 `initialize` | 分级函数返回后 | 等级为连接；`classifyUsage` 仍为 `protocol` |
| SC-02 | 空审计库 | 一行 `lucy_catalog`，无评测标记 | 分级与用量类都算出后 | 等级为浏览；用量类为 `default_usage`；真实问询为 0 |
| SC-03 | 空审计库 | `wiki_read`、`lucy_read_source`、`resources/read` 各一行 | 分级后 | 三行都是准备，都不是查数 |
| SC-04 | 空库 | 成功写入一条 `reported_tool` 问询，并有一行 `lucy_begin_question` | 窗口覆盖 `created_at` 的查询返回后 | 真实问询为 1；问询动作行本身不另计一次 |
| SC-05 | 空库 | `lucy_begin_question` 因空 `intentSummary` 失败，无 `conversation_turns` 行 | 查询返回后 | 真实问询为 0 |
| SC-06 | 已有一条 `reported_tool` | 同一 `turn_id` 再出现一行问询记录 | 去重后 | 真实问询仍为 1 |
| SC-07 | 空库 | 一行非探针 `lucy_query`，无原文问询 | 查询返回后 | 查数次数为 1；真实问询为 0；该非空会话计入未上报查数会话 |
| SC-08 | 空库 | 一行满足 Spec 189 探针规则的 `lucy_query` | 查询返回后 | 查数次数、未上报查数会话、真实问询都是 0 |
| SC-09 | 空库 | 同一会话只有 `initialize`、`notifications/initialized`、`tools/list` | 查询返回后 | 仅连接会话为 1；其余三张主卡为 0 |
| SC-10 | 空库 | 同一会话只有 `lucy_catalog` | 查询返回后 | 浏览未问会话为 1；仅连接为 0 |
| SC-11 | 空库 | 同一会话有 `lucy_query`，没有任何原文问询 | 查询返回后 | 未上报查数会话为 1；真实问询为 0 |
| SC-12 | 该 `session_id` 在窗口开始前已有 `reported_tool` | 窗口内同一会话再有 `lucy_query` | 查询返回后 | 未上报查数会话为 0；真实问询为 0（原文问询不在窗口内）；查数次数为 1 |
| SC-13 | 空库 | 同一会话两次成功 begin，两个 `turn_id`，来源都是 `reported_tool` | 查询返回后 | 真实问询为 2 |
| SC-14 | 空库 | `lucy_query` 的 `lucy_session_id` 为空 | 查询返回后 | 未归属查数为 1；未上报查数会话为 0 |
| SC-15 | 空库 | 同一会话有 `initialize` 和 `lucy_ops_source_import` | 查询返回后 | 四张主卡都是 0；排除会话数为 1 |
| SC-16 | 空库 | 工具名 `not_a_lucy_tool` | 分级后 | 等级为未分级；四个主指标不增加 |
| SC-17 | 含协议、默认用量和探针的混合夹具 | 计算 Spec 189 恒等式，并再算本 Spec 指标 | 两次聚合都返回后 | `calls = rawBusiness + protocol` 且 `rawBusiness = defaultUsage + evalProbe` 仍成立；`usageCalls` 与只跑 Spec 189 时相同 |
| SC-18 | 已知 UTC 时间的三条原文问询，跨过上海日界 | 窗口盖住这三条 | 按日表返回后 | 按日真实问询相加等于卡片；跨出窗口的边缘日 `partialDay` 为真 |
| SC-19 | 容器时区设为 UTC | 一条 `created_at` 为 `2026-10-29T16:30:00.000Z` 的原文问询 | 按日表返回后 | 落在上海日 `2026-10-30`，不落在 `2026-10-29` |
| SC-20 | 只有握手和一条原文问询的夹具 | 读取 overview | 响应返回后 | `activeAgentCount` 仍按 Spec 189 的默认用量计算；`realQuestions` 单独给出 |
| SC-21 | 审计库打开失败 | 请求 overview | 错误被捕获后 | 四个主指标 `state=unavailable` 且 `value=null` |
| SC-22 | 空库 | 请求一个覆盖现在的窗口 | 查询成功后 | 真实问询 `state=ok` 且 `value=0` |
| SC-23 | 空库 | 请求每问询查数 | 查询成功后 | `state=no_data` 且 `value=null` |
| SC-24 | 使用概况已渲染 | 打开数据访问，再打开 `?view=interface` | 两次渲染后 | 数据访问有四张新卡和按日表；界面使用没有；调用量、ACL 拒绝、多数请求耗时三张卡仍然不在数据访问视图 |
| SC-25 | 已有一条会话访问 | 打开审计问询记录 | 列表返回后 | 会话访问仍在；本 Spec 不删除、不改写成真实问询 |
| SC-26 | 同一批工具名 | TypeScript 等级函数与 SQL 条件各跑一次 | 两次结果对齐后 | 每个名单内工具的等级一致；`server/discover` 为连接；空工具名为未分级 |

## 9. 修订声明落点

源码落地后，Spec 189 的三层恒等式仍不改，Spec 156 的三张资产卡仍保留，问询卡在其下方。业务调用量不改名为真实问询。未重建的旧容器看不到这组新指标。
