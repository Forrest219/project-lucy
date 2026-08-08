# Admin Audit / Access Log Feedback

本页记录 `/admin/audit`（访问日志）相关 UI/UX 反馈。

## UX-ADMIN-AUDIT-001: 页面停留在 flat 调用流水，缺少 Agent 问询叙事

Status: Fixed
Route: `/admin/audit`
Area: Information architecture
Severity: P1
Reported: 2026-08-05

### Feedback
访问日志对构建可信任 data agent MCP 至关重要，但首屏仅为工具调用流水，无法按「每个 Agent、每次问询」理解访问行为。

### Expected
默认「问询记录」Tab，接入 `GET /api/admin/audit/turns`；L2 Drawer 展示每次问询的工具与表。

### Browser Check
1. Open `/admin/audit`.
2. Confirm default tab is「问询记录」with turn rows, not flat log only.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-AUDIT-002: Header「0 条记录」badge 冗余

Status: Fixed
Route: `/admin/audit`
Area: PageHeader badges
Severity: P3
Reported: 2026-08-05

### Feedback
右上角 `{total} 条记录` 与表格分页摘要重复，空数据时无引导价值。

### Expected
删除 PageHeader badges；分页区保留「共 N 条」。

### Browser Check
1. Confirm no count badge in PageHeader aside area on calls tab.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-003: 导出 CSV 与角色页主操作样式不一致

Status: Fixed
Route: `/admin/audit?tab=calls`
Area: PageHeader actions
Severity: P2
Reported: 2026-08-05

### Feedback
「导出 CSV」使用 secondary，与 `/admin/roles`「新建 Role」primary 不一致。

### Expected
调用流水 Tab 导出按钮 `pl-btn--primary text-sm`。

### Browser Check
1. Switch to「调用流水」tab.
2. Confirm export control uses primary button class.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-004: 数据热力 Tab 半成品且与使用概况重复

Status: Fixed
Route: `/admin/audit?tab=heatmap`
Area: Tab IA
Severity: P2
Reported: 2026-08-05

### Feedback
heatmap Tab 含英文 Top Tables、筛选栏无效、与 `/admin/usage` 表排行重复；可暂删。

### Expected
移除 heatmap Tab；`/admin/audit-sources` redirect 到 `/admin/audit`。

### Browser Check
1. Confirm no「数据热力」tab.
2. Open `/admin/audit-sources` → lands on `/admin/audit`.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-005: 四个 KPI 卡（业务调用/协议调用/拒绝/触达数据）对用户无价值

Status: Fixed
Route: `/admin/audit?tab=calls`
Area: Metric grid
Severity: P2
Reported: 2026-08-05

### Feedback
KPI 语义面向开发者，与表格/filter 重复，且与筛选口径可能不一致。

### Expected
删除四个 KPI 卡；聚合指标留在使用概况。

### Browser Check
1. On calls tab, confirm no four metric cards above table.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-006: 时间列应拆分起止并体现问询时长

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Turn list columns
Severity: P2
Reported: 2026-08-05

### Feedback
合并起止时间不利于排序与交叉核对；需展示问询墙钟跨度与累计执行耗时。

### Expected
分列「开始时间」「结束时间」「问询时长」；副信息含累计耗时（执行时间之和）。

### Browser Check
1. On turns tab, confirm separate start/end columns and span duration column.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-007: 与使用概况「多数请求耗时」无法交叉验证

Status: Fixed
Route: `/admin/audit`, `/admin/usage`
Area: Latency cross-reference
Severity: P1
Reported: 2026-08-05

### Feedback
使用概况 P95 与访问日志单次 `durationMs` 应同窗口、同算法，便于解释慢调用。

### Expected
24h/7d 窗口对齐；页内 P95 参照线；L1/L2 慢调用 badge「慢于多数请求」。

### Browser Check
1. Set `/admin/usage` and `/admin/audit` to same window.
2. Compare P95 value with audit reference line.
3. Confirm slow calls badge when duration exceeds P95.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-008: 推断问询缺少来源标注

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Turn summary copy
Severity: P2
Reported: 2026-08-05

### Feedback
inferred turn 摘要不得表述为用户原文（Spec 08 §9.2）。

### Expected
「已上报问询 / 推断问询」badge；推断行 tooltip 说明不等同于用户原文。

### Browser Check
1. Confirm source badges on turn rows and drawer header.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-009: 筛选栏过密且 L1 含无关字段

Status: Fixed
Route: `/admin/audit`
Area: Filter bar
Severity: P2
Reported: 2026-08-05

### Feedback
Session ID / Turn ID / 平台等应下沉到调用流水 Tab；问询 Tab 仅需 Agent、窗口、来源、搜索。

### Expected
问询 Tab 简化筛选；高级字段保留在调用流水 Tab。

### Browser Check
1. Turns tab: Agent + window + source + search only.
2. Calls tab: full filter bar.

### Notes
Spec 89 / `wo-202608-22` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-010: 台账未登记访问日志页

Status: Fixed
Route: `/admin/audit`
Area: UI/UX ledger index
Severity: P3
Reported: 2026-08-05

### Feedback
长期台账缺少 `/admin/audit` 页面索引。

### Expected
`docs/ui-ux-feedback/README.md` 页面索引增加 Admin Audit 行。

### Browser Check
N/A（文档索引）。

### Notes
Spec 89 / `wo-202608-22` 台账机制更新一并 Fixed。

## UX-ADMIN-AUDIT-011: 筛选框提示 Agent ID 不合理

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Filter bar
Severity: P2
Reported: 2026-08-05

### Feedback
筛选 placeholder 为 `Agent ID`，用户只记得名称；表格也以名称为主。

### Expected
placeholder 改为 `Agent 名称或 ID`，支持名称或 id 模糊筛选。

### Browser Check
1. Open `/admin/audit` turns tab.
2. Confirm filter placeholder is「Agent 名称或 ID」.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-AUDIT-012: Agent 列缺少 ID 次级展示

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Turn list Agent column
Severity: P2
Reported: 2026-08-05

### Feedback
表格 Agent 列仅显示 id，应同时展示名称与 id（括号次级）。

### Expected
`{name} ({id})`；无独立名称时回退 id。

### Browser Check
1. Confirm Agent column shows name and parenthesized id when agents API has distinct name.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-013: 列表页 P95 参照句冗余

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Latency reference microcopy
Severity: P3
Reported: 2026-08-05

### Feedback
「使用概况 · 近 7 天：多数请求耗时…」与 `/admin/usage` 重复，列表信息密度低。

### Expected
删除列表页整句参照文案；慢调用 badge 保留。

### Browser Check
1. Confirm no `audit-latency-reference` block on turns tab.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-014: 来源筛选术语难理解

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Source filter
Severity: P2
Reported: 2026-08-05

### Feedback
`全部来源 / 推断` 缺少业务语义；`推断问询` 含义不直观。

### Expected
筛选项：`全部 / 用户原始问询 / 系统推断问询`；`title` tooltip 解释推断来源。

### Browser Check
1. Open source filter options and confirm business labels.
2. Hover/select shows tooltip about inferred summary.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-015: 列表列名偏实现视角

Status: Fixed
Route: `/admin/audit?tab=turns`
Area: Turn list columns
Severity: P2
Reported: 2026-08-05

### Feedback
`调用数`、`工具 / 表` 应改为业务可读列名；列表应聚焦数据表而非工具。

### Expected
`工具调用数`、`涉及数据表`（仅 physical table）。

### Browser Check
1. Confirm updated column headers and table-only cell content.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-016: 明细缺序号与数据库连接

Status: Fixed
Route: `/admin/audit?turnId=…`
Area: Turn drawer call table
Severity: P2
Reported: 2026-08-05

### Feedback
Drawer 调用明细难以定位行与连接；缺序号、数据库连接字段。

### Expected
调用明细表含 `序号`、`数据库连接`；API 返回 `accessLogs[].connectionId`。

### Browser Check
1. Open turn drawer.
2. Confirm index column and connection id per row.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。

## UX-ADMIN-AUDIT-017: Drawer 布局混乱、关闭按钮错位

Status: Fixed
Route: `/admin/audit?turnId=…`
Area: Turn drawer chrome
Severity: P2
Reported: 2026-08-05

### Feedback
详情抽屉分区弱；`关闭` 与标题区脱节。

### Expected
`pl-trace-detail-header--toolbar` 同行布局；`pl-card` 分区（摘要 / 调用明细 / 触达表汇总）。

### Browser Check
1. Open turn drawer.
2. Confirm close button aligns with title row; sections visually separated.

### Notes
Spec 94 / `wo-202608-27` 已落地（本轮不做浏览器验证）。


## UX-ADMIN-AUDIT-018: 裁决原因仅机器码、缺少修复深链

Status: Fixed
Route: /admin/audit?tab=calls
Area: 调用流水裁决原因列 / Drawer
Severity: P1
Reported: 2026-08-05

### Feedback
调用流水与 Drawer 展示原始 `decision_reason` 码（如 `tool_forbidden`），缺少中文主文案；denied 行无法一跳到 MCP 调试台或 Role 修复面。

### Expected
- 主行中文裁决原因 + 次行机器码（`notranslate`）。
- denied 行提供「在调试台复现」等 remediation 深链（Spec 99）。

### Browser Check
1. Open calls tab with denied rows.
2. Verify Chinese primary label and code secondary line.
3. Follow remediation link to `/admin/mcp-playground` with context (after Spec 99 UI exists).

### Notes
- Spec: `webui/docs/99-mcp-playground-acl-decision-visibility-spec.md`
- Plan: `webui/docs/plans/wo-202608-32-mcp-playground-acl-decision-visibility.md`
- Fix（2026-08-05）: `DecisionReasonCell` 双行展示 + 「在调试台复现」深链。本轮不做浏览器验证，状态保持 `Fixed`。

## UX-ADMIN-AUDIT-019: 无法区分 MCP 调试台受控试调与 Agent 接入调用

Status: Fixed
Route: /admin/audit?tab=calls
Area: 调用流水调用来源筛选
Severity: P2
Reported: 2026-08-05

### Feedback
受控试调会真实打本机 Proxy 并写入访问日志，但与 Agent 客户端调用混在一起，无法筛选或一眼识别。

### Expected
- 受控试调带 `lucy_platform=mcp-playground`。
- 调用流水提供「调用来源」：全部 / MCP 调试台受控试调 / Agent 接入调用。
- 受控试调行展示「受控试调」badge；筛选 playground 时自动含协议调用。

### Browser Check
1. Run live-smoke from MCP 调试台.
2. Open `/admin/audit?tab=calls&callSource=playground` and confirm the row appears with badge.
3. Switch to `callSource=agent` and confirm playground row is excluded.

### Notes
- Spec 99 v1.2 §7.3；术语表 §4.7 Call origin filter / §4.8 Call origin.
- Fix（2026-08-05）: live-smoke `x-lucy-platform` + `callSource` API/UI。本轮不做浏览器验证，状态保持 `Fixed`。

## UX-ADMIN-AUDIT-020: 双 Tab Header 导出槽位不一致

Status: Fixed
Route: /admin/audit
Area: PageHeader actions
Severity: P2
Reported: 2026-08-06

### Feedback
问询记录与调用流水右上角布局不同：仅调用流水显示「导出 CSV」，切 Tab 时 Header 跳动。

### Expected
两 Tab Header 槽位同构：统计时间 + 时间窗 + 导出 CSV（导出调用流水，tooltip 说明）。

### Browser Check
1. Open turns and calls tabs.
2. Confirm both show primary「导出 CSV」in the same Header slot.

### Notes
Spec 106 / `wo-202608-39`（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-AUDIT-021: 问询「序号」列过窄换行

Status: Fixed
Route: /admin/audit（问询记录）
Area: Turn list 序号 column
Severity: P2
Reported: 2026-08-06

### Feedback
`w-12` 导致表头「序号」拆成两行，三位数不足。

### Expected
`whitespace-nowrap` + 宽度至少容纳 `999`（如 `w-14`）。

### Browser Check
1. Confirm 序号 header is single line; column fits 999.

### Notes
Spec 106 / `wo-202608-39`。

## UX-ADMIN-AUDIT-022: 调用流水缺首列序号

Status: Fixed
Route: /admin/audit?view=calls
Area: Call log columns
Severity: P2
Reported: 2026-08-06

### Feedback
调用流水表无序号列，与问询记录不一致。

### Expected
首列「序号」（分页行号）。

### Browser Check
1. Calls table first column is 序号.

### Notes
Spec 106 / `wo-202608-39`。

## UX-ADMIN-AUDIT-023: 主表缺少可关联 Key / ID

Status: Fixed
Route: /admin/audit
Area: Identity columns
Severity: P1
Reported: 2026-08-06

### Feedback
问询/调用主表无问询 ID、事件 ID，无法可信关联取证。

### Expected
问询表：问询 ID；调用表：事件 ID + 问询 ID；可复制；问询 ID 可打开 Drawer。

### Browser Check
1. Confirm identity columns visible and copyable.
2. Click 问询 ID on a call row opens turn drawer when present.

### Notes
Spec 106 / `wo-202608-39`。

## UX-ADMIN-AUDIT-024: 筛选器不齐备且双 Tab 不对齐

Status: Fixed
Route: /admin/audit
Area: Filter bar
Severity: P1
Reported: 2026-08-06

### Feedback
问询缺日期/状态/Key；调用偏实现字段；与用户体验排查相关的筛选不足。

### Expected
共享：日期区间、Agent、表名、状态、Key；问询特有来源/摘要；调用特有调用来源/工具 + 高级折叠。

### Browser Check
1. Both tabs show shared filters.
2. Key search and outcome work.

### Notes
Spec 106 / `wo-202608-39`。

## UX-ADMIN-AUDIT-025: URL 暴露 hours=168 等实现语义

Status: Fixed
Route: /admin/audit
Area: URL semantics
Severity: P2
Reported: 2026-08-06

### Feedback
`?hours=168&tab=calls` 草率，含临时数字 168。

### Expected
写入 `view` + `range=24h|7d`；兼容读旧 `tab`/`hours`；深链生产者更新。

### Browser Check
1. Switching 7 天 writes `range=7d` not `hours=168`.
2. Legacy `?hours=168&tab=calls` still loads calls + 7d window.

### Notes
Spec 106 / `wo-202608-39`；Registry 见 Spec 100 修订注。

## UX-ADMIN-AUDIT-026: 筛选栏时间组无可见名称且 since 非整点

Status: Fixed
Route: `/admin/audit`
Area: Shared filter bar / time range
Severity: P3
Reported: 2026-08-07

### Feedback
共享筛选栏起止 `datetime-local` 无可见「时间」标签；由统计窗推导的 `since` 带分钟/秒，与发布记录「整点」机构不一致。默认仍为近 7 天（Spec 89），本轮不改为 24h，也不加快捷窗。

### Evidence
- 代码：`Audit.tsx` 起止仅 `aria-label`；`sinceIsoFromHours` 用 `setHours` 不归零分钟。
- 对照：Spec 113 v1.1；批准方案 B1。

### Expected
1. 起止组前可见「时间」。
2. 默认/切换统计窗后的 `since` 为整点。
3. 顶栏默认 `range=7d` 与统计窗分段不变。

### Browser Check
1. Open `/admin/audit`；verify「时间」在起止前；开始时间为整点。
2. Switch Header 24 小时 / 7 天；since 仍为整点；默认仍为 7 天。

### Notes
Spec 122 / `wo-202608-56` 已落地（本轮不做浏览器验证，结束后只做 code review）。主题：`list-history time-filter parity`。
