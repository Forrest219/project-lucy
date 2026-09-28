# 运行状态与使用概况分工 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 运行状态与使用概况分工 Spec |
| 文档类型 | Spec |
| 版本 | v1.3 |
| 撰写日期 | 2026-09-28 |
| 撰写人 | Auto |
| 委托人 | xingchen |
| 基于材料 | v1.0 已批准方向，以及 2026-09-28 三轮审阅：历史 `group_id` 不随目录迁移、资产卡被 P95 连坐、定位与界面使用冲突、界面使用仍请求数据访问接口、验收只查 test id，以及分组映射的聚合效率 / 空分组边界、资产卡 `unavailable` 与 `partial` 的优先级、一级根页面面包屑规范和 Token 排行分母说明。上游 Spec 42 / 78 / 84 / 86 / 128 / 135 / 143 / 148 |
| 适用范围 | `/admin/usage` 的导航归属、数据访问 KPI 与资产卡状态；界面使用分组排行的查询归类。`/ops/calls` 的指标边界保持不变 |
| 输出位置 | `webui/docs/156-runtime-status-usage-boundary-spec.md` |
| Spec 编号 | 156 |
| 状态 | Accepted（v1.3，2026-09-28） |
| 关联 IA | `webui/docs/06-navigation-ia.md` |
| 关联术语 | `webui/docs/00-product-terminology-standard.md` §4.5 / §4.6 |

## 1. 背景

`/ops/calls` 调用监控与 `/admin/usage` 使用概况都展示调用量和请求耗时。调用监控回答「工具调用现在是否报错、被拒绝、变慢」。使用概况的数据访问视图回答「哪些 Agent、Token、授权表在被用」。两页并排时，使用者在「运行状态」里找不到 24 小时 / 7 天活跃率，又在「访问治理」里看到一套和调用监控重叠的运行体征。

已批准的改法：

1. 侧栏把 **使用概况** 从 **访问治理** 移到 **运行状态**。路由保持 `/admin/usage`。界面使用仍是该页的第二个视图，本 Spec 不拆页。
2. 两页不合并。重叠的三张指标卡从数据访问视图拿掉，改成跳到调用监控。
3. 调用监控不增加 Agent / Token / 表活跃率，也不增加 7 天窗口。
4. 分组访问排行按**当前页面目录**归类，不沿用写入时的 `group_id`。
5. 三张资产卡各自根据自己的活跃计数决定状态。`calls`、`denied`、`p95LatencyMs` 留在 API 中，不决定资产卡状态。

## 2. Goals

1. **运行状态** 含三页，顺序固定：系统概览、调用监控、使用概况。
2. 使用概况的逻辑归属路径为 `运行状态 / 使用概况`；遵循 Spec 42，一级根页面不渲染面包屑，H1 仍为 **使用概况**。页头说明随视图切换。
3. 数据访问视图只保留资产与活跃：Agent、Token、授权表三张复合卡，以及 Agent / Token / 表三块调用排行。
4. 数据访问视图删除「近 N 调用量」「近 N ACL 拒绝次数」「多数请求耗时」，并以一行说明链到调用监控。
5. 调用监控的路由、窗口、KPI、30 秒轮询、SLO 红标和访问日志下钻保持 Spec 143。
6. 「界面使用」指标与菜单 / 页面排行保持 Spec 148。分组排行改为按当前 `pageKey → groupId` 归类。
7. `?view=interface` 不发起数据访问的三个请求。数据访问视图不发起界面使用请求。

## 3. Non-goals

- 不合并两个页面，不改 `/ops/calls` 与 `/admin/usage` 的 URL。
- 不把 `/admin/governance` → `/admin/usage` 的 redirect 去掉。
- 不把 Agent、Token 凭据、角色权限、访问日志、MCP 调试台、配置审计移出访问治理。
- 不把界面使用拆成独立路由。若以后要做「系统使用分析」，另立 Spec。
- 不删除使用概况 API 的 `calls`、`denied`、`p95LatencyMs`、`metricsState`。`metricsState` 保持现有并集语义，供兼容；资产卡不得再读它。
- 不改 `ui_page_views` 表结构，不对历史行做 `UPDATE`。新写入仍保存当时目录中的 `group_id`，但分组排行不得读取该列。
- 不改调用监控 API、SLO 阈值、自动刷新。
- 不把使用概况的 7 天窗口写进调用监控，也不把调用监控的 1 小时窗口写进使用概况。
- 不把使用概况改成 30 秒轮询。
- 不改 Agent 管理页上的调用量 KPI（那是另一页的 `metric-calls` 与 Agent 自己的 `stats.metricsState`）。
- 不改界面使用的页面访问、访问账户、活跃菜单口径，也不改菜单排行、页面排行的聚合键（仍是 `menu_id`、`page_key`）。

## 4. 定位与路径

| 页面 / 视图 | 分组 | 路由 | 窗口 | 回答 |
|---|---|---|---|---|
| 系统概览 | 运行状态 | `/overview` | — | 连接、语义和待办够不够交付 |
| 调用监控 | 运行状态 | `/ops/calls` | `range=24h`（默认）或 `1h` | 工具调用有没有报错、被拒绝、变慢 |
| 使用概况 · 数据访问 | 运行状态 | `/admin/usage` | `hours=24` 或 `168`（默认 168，仍为页内状态） | 哪些 Agent、Token、授权表在被用，活跃率多少 |
| 使用概况 · 界面使用 | 运行状态（同一页，不另开路由） | `/admin/usage?view=interface` | 与数据访问共用 24 小时 / 7 天 | WebUI 页面打开、访问账户、菜单与分组使用 |
| Agent 及以下治理页 | 访问治理 | `/admin/agents` 等 | — | 配置身份、权限，以及某一次调用的取证 |

说明文案：

| 位置 | 文案 |
|---|---|
| 侧栏与命令面板 | `查看 Agent、Token、数据表的活跃率，以及 WebUI 页面访问情况。` |
| 数据访问视图页头 | `查看 Agent、Token 和数据表近 24 小时或近 7 天的活跃率与调用排行。` |
| 界面使用视图页头 | `查看 WebUI 近 24 小时或近 7 天的页面访问、访问账户与菜单使用。` |
| 调用监控 | 保持 `准实时查看 MCP 工具调用量、成败与请求时效。` |

导航项 `id` 保持 `admin-governance`。界面使用目录里该页的 `menuId` 保持 `admin-governance`，写入用的 `groupId` 改为 `runtime-status`。菜单排行因此仍能对上历史打开记录。分组排行不读历史 `group_id`，见 §6.1。

## 5. KPI 归属

### 5.1 调用监控（不改）

| UI 主术语 | 口径 | 窗口 |
|---|---|---|
| 近 N 调用量 | 业务 MCP 工具调用次数，不含协议工具 | 近 1 小时 / 近 24 小时 |
| 成功率 | `ok / businessCalls` | 同上 |
| 错误率 | `error / businessCalls` | 同上；超阈红标 |
| 拒绝率 | `denied / businessCalls` | 同上；超阈红标 |
| 多数请求耗时 | 窗内 `durationMs` 的 P95 | 同上；超阈红标 |
| 慢于多数请求 | `durationMs` 大于慢调用阈值的次数 | 同上 |
| 工具调用排行 · 近 N | 按工具计数 Top 10，附错误数与拒绝数 | 同上 |
| 最近失败与拒绝 | 最近最多 20 条 `error` 或 `denied` | 同上；下钻 `/admin/audit?view=calls` |

### 5.2 使用概况 · 数据访问（改展示与卡片状态）

保留：

| UI 主术语 | 口径 | 窗口 |
|---|---|---|
| Agent 资产与活跃 | 近窗活跃 Agent / 已配置 Agent；副行 Agent 活跃率 | 24 小时 / 7 天 |
| Token 凭证与活跃 | 近窗使用过的凭据 / 已配置 Token；副行 Token 活跃率；超配或前缀冲突时保持现有 partial | 同上 |
| 授权表与活跃 | 近窗活跃授权表 / 已解析授权表；副行活跃率；前缀授权保持 partial | 同上 |
| Agent 调用排行 · 近 N | 按 Agent 调用次数 | 同上 |
| Token 调用排行 · 近 N | 仅含当前配置 Token，按 Token 调用次数；百分比按当前排行行合计，未配置或历史凭证不进入排行 | 同上 |
| 表调用排行 · 近 N | 按表访问次数 | 同上 |

从数据访问视图删除，不再渲染对应 DOM，也不得以其他 test id 重新出现这些主标签：

| 现有 test id | 现有主标签 | 之后去哪看 |
|---|---|---|
| `metric-calls` | 近 N 调用量 | 调用监控「近 N 调用量」 |
| `metric-acl-denied` | 近 N ACL 拒绝次数 | 调用监控「拒绝率」与「最近失败与拒绝」；单次取证仍走访问日志 |
| `metric-p95-latency` | 多数请求耗时 | 调用监控「多数请求耗时」 |

删除整块 `governance-usage-metrics-primary`（aria-label「运行体征」）。资产三卡所在的 `governance-usage-metrics-secondary` 成为数据访问视图唯一指标区。

数据访问视图在指标区上方放一行说明，test id `usage-call-monitor-link`：

> 调用是否报错、被拒绝或变慢，到调用监控查看。调用监控的窗口是近 1 小时或近 24 小时。

链接文案 **打开调用监控**，目标固定为 `/ops/calls?range=24h`。使用概况停在 7 天时也不把 `168` 写进该 URL：调用监控没有 7 天窗，最近的健康窗口是近 24 小时。

资产卡状态见 §6.2。活跃数为 0 时仍展示 `活跃 0 / 配置数`，不得因为 `calls === 0` 或 `p95LatencyMs === null` 改成不可用或暂无数据。

### 5.3 使用概况 · 界面使用（不改指标，改分组归类）

页面访问、访问账户、活跃菜单，以及菜单 / 页面访问排行保持 Spec 148。`?view=interface` 与默认数据访问的切换保持。

分组访问排行的展示项仍是当前 `UI_USAGE_GROUPS`。每个分组的次数改为：窗口内各 `page_key` 的访问次数，按**查询时**目录中的 `groupId` 求和。存储列 `group_id` 不参与这次求和。

## 6. 核心流程（伪代码）

### 6.1 分组排行按当前目录归类

写入不变：`recordUiPageView` 仍把当时目录里的 `group_id` 插入 `ui_page_views`。查询分组排行时丢弃该列；先在 SQLite 按 `page_key` 聚合，再将有界的页面计数按查询时目录汇总到分组。禁止为重新分类而把窗口内原始访问行全部读入内存。

```ts
function queryGroupRanking(
  pageVisits: Map<string, number>, // SELECT page_key, COUNT(*) ... GROUP BY page_key
  catalog: UiPageDefinition[]
): RankRow[] {
  const currentPageByKey = new Map(catalog.map((page) => [page.pageKey, page]))
  const visitsByGroup = new Map<string, number>()
  for (const [pageKey, visits] of pageVisits) {
    if (pageKey === UI_PAGE_VIEW_UNKNOWN) continue
    const groupId = currentPageByKey.get(pageKey)?.groupId
    // 目录已删除的页面，以及 Help 等 groupId=null 的页面，不进入任何分组。
    if (!groupId) continue
    visitsByGroup.set(groupId, (visitsByGroup.get(groupId) ?? 0) + visits)
  }
  return rankByVisits(UI_USAGE_GROUPS, visitsByGroup)
}
```

因此：`page_key='admin-usage'` 且 `group_id='governance'` 的历史行，在目录把该页的 `groupId` 改为 `runtime-status` 之后，计入「运行状态」，不计入「访问治理」。目录中已不存在的 `page_key` 不进入任何当前分组；`groupId === null` 的当前页面也不进入分组排行。菜单排行继续 `GROUP BY menu_id`，页面排行继续 `GROUP BY page_key`。

不执行 `UPDATE ui_page_views SET group_id = 'runtime-status'`。

### 6.2 资产卡状态与健康指标分离

`GET /api/admin/governance/overview` 继续返回 `calls`、`denied`、`p95LatencyMs`、`metricsState`。`metricsState` 仍是现有并集：调用统计不可用、任一活跃计数为 null，或 P95 为 null 时为 `unavailable`。该字段不再驱动三张资产卡。

```ts
type CardState = "ok" | "partial" | "unavailable"

function agentCardState(usage): CardState {
  if (!usage || usage.activeAgentCount === null) return "unavailable"
  if (usage.agentActiveRatePartial) return "partial"
  return "ok"   // activeAgentCount === 0 仍展示「活跃 0 / 配置数」
}

function tokenCardState(usage): CardState {
  if (!usage || usage.activeTokenCount === null) return "unavailable"
  if (usage.tokenActiveRatePartial || usage.tokenPrefixAmbiguous) return "partial"
  return "ok"
}

function tableCardState(usage): CardState {
  if (!usage || usage.activeTableCount === null) return "unavailable"
  if (usage.tableRatePartial || usage.hasOpenEndedTableScope) return "partial"
  return "ok"   // 禁止再用 calls === 0 得到 no_data
}
```

状态优先级固定为 `unavailable > partial > ok`：活跃计数未返回时，不得因 Token 前缀冲突、前缀 / 通配符授权或其他 partial 标志而将数据源不可用降格为「数据不完整」。

排行列表各自使用已成功返回的 Agent、Token、`popularTables` 结果。`metricsState === "unavailable"` 不得把这些排行隐藏成整页失败。某张卡为 `unavailable` 时，只影响该卡；另外两张卡仍按自己的计数渲染。

交接链接不依赖上述查询。数据访问视图在请求失败时仍渲染该链接。

### 6.3 页面渲染与按视图发请求

```ts
const RUNTIME_STATUS = ["系统概览", "调用监控", "使用概况"] as const
const ACCESS_GOVERNANCE = ["Agent", "Token 凭据", "角色权限", "访问日志", "MCP 调试台", "配置审计"] as const

function placeUsageNav(groups): NavGroups {
  const runtime = groups.find(id == "runtime-status")
  const governance = groups.find(id == "governance")
  const usage = governance.remove(id == "admin-governance")
  usage.to = "/admin/usage"
  usage.label = "使用概况"
  usage.description = "查看 Agent、Token、数据表的活跃率，以及 WebUI 页面访问情况。"
  runtime.items = [overview, callMonitor, usage]
  governance.items = ACCESS_GOVERNANCE 对应现有项，保持原相对顺序
  return groups
}

function usagePageCatalogEntry(): UiPageDefinition {
  return {
    pageKey: "admin-usage",
    label: "使用概况",
    menuId: "admin-governance",
    groupId: "runtime-status"
  }
}

type UsageHours = 24 | 168
type UsageView = "access" | "interface"

function loadUsage(view: UsageView, hours: UsageHours): void {
  // 切换视图后，非当前视图的请求不得处于启用状态。
  enableOverviewQuery(view === "access", hours)     // /api/admin/governance/overview
  enableAgentsQuery(view === "access", hours)       // /api/admin/governance/agents
  enableTokensQuery(view === "access", hours)       // /api/admin/governance/tokens
  enableInterfaceQuery(view === "interface", hours) // /api/admin/ui-usage/overview
}

function renderUsage(view: UsageView, hours: UsageHours): void {
  renderHeader({
    title: "使用概况",
    description: view === "interface"
      ? "查看 WebUI 近 24 小时或近 7 天的页面访问、访问账户与菜单使用。"
      : "查看 Agent、Token 和数据表近 24 小时或近 7 天的活跃率与调用排行。"
  })
  renderWindowToggle(hours)             // 默认 168；仍是组件状态，不新增 URL
  renderViewToggle(view)

  if (view === "interface") {
    renderInterfaceUsage(hours)         // 指标同 Spec 148；分组次数来自 §6.1
    return
  }

  renderCallMonitorHandoff({
    text: "调用是否报错、被拒绝或变慢，到调用监控查看。调用监控的窗口是近 1 小时或近 24 小时。",
    href: "/ops/calls?range=24h"        // 与 hours 无关；禁止 range=168
  })
  renderAssetCards([
    agentCard(agentCardState),
    tokenCard(tokenCardState),
    tableCard(tableCardState)
  ])
  renderRankings([agentRank, tokenRank, tableRank])
}

function renderCallMonitor(): void {
  // Spec 143 全量保持：1h|24h、六张 KPI、工具排行、最近失败、30s 轮询、SLO
  // 禁止渲染 Agent 活跃率、Token 活跃率、授权表活跃率、7 天窗口
}
```

## 7. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

实现同一变更内更新术语标准，不新造页面名：

| Canonical Term | UI 主术语 | 修订 |
|---|---|---|
| Usage Overview Page | 使用概况 | 路由仍为 `/admin/usage`，逻辑归属路径为 `运行状态 / 使用概况`。遵循 Spec 42，一级根页面只显示 H1，不渲染面包屑。页头说明随数据访问 / 界面使用切换。禁止把 H1 改成「调用监控」或「运行体征」 |
| Runtime Status Group | 运行状态 | 成员改为系统概览 + 调用监控 + 使用概况。禁止再写「含系统概览 + 调用监控」且不含使用概况 |
| Call Monitoring Page | 调用监控 | 不改。禁止在本页使用「活跃率」作主标签 |
| Usage Health Handoff | 打开调用监控 | 数据访问视图上的唯一健康指标出口。禁止在该视图恢复「近 N 调用量」「近 N ACL 拒绝次数」「多数请求耗时」 |
| Interface Usage View | 界面使用 | 仍是使用概况上的视图，不另开路由。禁止在本 Spec 中把它写成独立的「系统使用分析」页 |

沿用且不得改译：Agent 资产与活跃、Token 凭证与活跃、授权表与活跃、Agent / Token / 表调用排行、数据访问、页面访问、访问账户、活跃菜单、成功率、错误率、拒绝率、多数请求耗时、慢于多数请求。Token 调用排行必须说明仅含当前配置 Token，且百分比按当前排行行合计。

Protected terms：`Agent`、`Token`、`MCP`、`P95`、`ACL`。数据访问视图不再展示 `ACL`。

## 8. Design System Compliance

- 引用既有 PageHeader、MetricCard、segmented control、排行条。不新增卡片样式或颜色。
- 交接说明使用现有正文链接（`pl-link`），不做成第四张指标卡，也不重复展示调用量数字。
- 删除「运行体征」这一组后，资产三卡仍用现有 `pl-metric-grid--three`。
- 页头说明随视图变化，仍放在现有 PageHeader `description`，不新增第二标题。
- 遵循 Spec 42：使用概况是一级根页面，由侧栏与 H1 提供上下文，不传 `breadcrumbs`。

## 9. 验收

| ID | 断言 | 验证 |
|---|---|---|
| SC-1 | 侧栏「运行状态」顺序为系统概览、调用监控、使用概况；「访问治理」首项为 Agent，且不含使用概况。命令面板说明同时提到 Agent / Token / 数据表活跃率与 WebUI 页面访问 | `webui/src/__tests__/navigation.test.ts`：`findGroupIdForPathname("/admin/usage")` 为 `runtime-status` |
| SC-2 | `/admin/usage` H1 为使用概况；作为一级根页面不渲染面包屑，其逻辑归属路径为 `运行状态 / 使用概况`。数据访问页头含「活跃率与调用排行」；`?view=interface` 页头含「页面访问、访问账户与菜单使用」。`/admin/governance` 仍 replace 到 `/admin/usage` | 组件测试渲染 `GovernanceOverview`，断言 H1 与无面包屑 |
| SC-3 | 数据访问视图看不见主标签「多数请求耗时」「ACL 拒绝次数」「近 7 天调用量」或「近 24 小时调用量」，也不存在 aria-label「运行体征」。同时不存在 `metric-calls`、`metric-acl-denied`、`metric-p95-latency`、`governance-usage-metrics-primary` | `webui/src/__tests__/admin-governance-observability.test.tsx`。可见文案断言为主，test id 为辅 |
| SC-4 | 仍展示 Agent / Token / 授权表三张资产卡及三块排行。24 小时切换后活跃数跟随窗口，配置存量不跟随。活跃数为 0 时展示 `活跃 0 / 配置数`，不因调用量为 0 变成暂无数据 | 沿用该测试文件的窗口切换用例 |
| SC-5 | `usage-call-monitor-link` 指向 `/ops/calls?range=24h`。7 天窗口下 href 仍是 `range=24h`，文案说明调用监控不含 7 天 | 组件测试断言 `href` 与可见文案 |
| SC-6 | `?view=interface` 仍展示页面访问、访问账户、活跃菜单与三块排行。该视图下 overview、agents、tokens 三个 query 的 `enabled` 为 false，不请求 `/api/admin/governance/overview`、`/agents`、`/tokens`。数据访问视图不请求 `/api/admin/ui-usage/overview` | 组件测试用请求 mock 断言调用次数；覆盖直接打开 `?view=interface` 与从数据访问切过去两种入口 |
| SC-7 | 调用监控仍只有 Spec 143 的六张 KPI、工具排行、最近失败；页面文本不含「活跃率」，无 7 天切换 | `webui/src/__tests__/call-monitor.test.tsx` |
| SC-8 | 使用概况 API 仍返回 `calls`、`denied`、`p95LatencyMs`、`metricsState`。P95 查询失败使 `p95LatencyMs === null` 且 `metricsState === "unavailable"` 时，只要三类活跃计数非 null，响应里的计数字段仍是原数值 | `webui/server/__tests__/admin-governance-observability.test.ts` 保留原契约，并加这条响应断言 |
| SC-9 | 手册侧栏表把使用概况放在运行状态；说明覆盖资产活跃与 WebUI 页面访问。系统概览 FAQ 里「ACL 拒绝到使用概况查看」改为到调用监控或访问日志 | `docs/SYSTEM_HANDBOOK.md` 与 `webui/src/__tests__/help-center.test.tsx` |
| SC-10 | 术语检查通过 | `cd webui && npm run lint:terminology` |
| SC-11 | 插入 `page_key='admin-usage'`、`group_id='governance'` 的历史行后，分组排行把这些访问计入「运行状态」，访问治理的次数不包含它们。同一行的菜单排行仍计入「使用概况」。另插入当前目录中 `groupId === null` 的页面访问后，不增加任何分组次数 | `webui/server/__tests__/admin-ui-usage.test.ts` |
| SC-12 | 组件收到 `p95LatencyMs: null`、`metricsState: "unavailable"`，且 `activeAgentCount`、`activeTokenCount`、`activeTableCount` 均为成功数值时，三张资产卡展示这些数字。任一活跃计数单独为 null 时，只有对应卡不可用，另外两张卡仍展示；特别覆盖 `activeTokenCount === null` 且 Token partial 标志为 true、`activeTableCount === null` 且表 partial 标志为 true 的组合，两者均必须呈现 `unavailable` 而非 `partial` | `admin-governance-observability.test.tsx` |
| SC-13 | Token 排行标题沿用「Token 调用排行 · 近 N」，并明确说明只含当前配置 Token、百分比按本排行合计、未配置或历史凭证不进入排行 | `admin-governance-observability.test.tsx` 可见文案断言 |

手工抽查（实现 PR 不默认加浏览器 E2E）：打开 `/admin/usage`，确认三张资产卡和排行仍在、三张运行体征卡不在、链接进入 `/ops/calls?range=24h`；切到界面使用后再看网络请求只有界面使用接口；再打开调用监控，确认工具排行与失败短列表仍在。

## 10. 实现时必改

- `webui/src/app/navigation.ts`
- `webui/src/pages/admin/GovernanceOverview.tsx`：删除三张健康卡、页头随视图切换、按视图 `enabled`、资产卡按 §6.2 取状态
- `webui/server/admin/ui-usage.ts`：`PAGE.usage.groupId` 改为 `runtime-status`；`queryUiUsageOverview` 的分组排行改为 §6.1，复用按 `page_key` 聚合的计数而非读取窗口内原始行，并跳过空 `groupId`
- `webui/server/__tests__/admin-ui-usage.test.ts`（SC-11）
- `webui/docs/06-navigation-ia.md` 分组表、面包屑表与使用概况说明
- `webui/docs/00-product-terminology-standard.md` §4.5 页眉位置、§4.6 Runtime Status Group 成员
- `docs/SYSTEM_HANDBOOK.md` 侧栏表，以及「近 7 天 ACL 拒绝不在首页」那句的去向
- 导航测试、使用概况组件测试、帮助中心摘录测试
- 本文件在 `webui/docs/README.md` 索引中的状态改为 Accepted

不改 `webui/server/ops/call-monitor.ts` 与 `webui/src/pages/ops/CallMonitor.tsx` 的指标逻辑。调用监控文件只允许为 SC-7 补测试，或在发现文案漂移时保持 Spec 143 原文。

`governance-observability.ts` 的 `metricsUnavailable` 并集可以保留，以保证 SC-8 的旧契约。资产卡状态的解耦在前端按 §6.2 完成；若实现时修改该并集，必须先证明 Agent 管理页与现有服务端测试没有读取使用概况的 `metricsState`。
