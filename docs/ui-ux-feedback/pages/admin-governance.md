# Admin Governance / Usage Overview Feedback

本页记录 `/admin/governance`（使用概况）相关 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-ADMIN-GOV-001: 页面名称「治理概览」与内容不匹配

Status: Fixed
Route: `/admin/governance`
Area: Page title, sidebar nav label
Severity: P2
Reported: 2026-08-05

### Feedback
本页名称「治理概览」和路径后缀 `governance` 已不匹配本页内容（使用向 KPI、排行与热门表）。

### Evidence
- 浏览器：标题与侧栏均为「治理概览」；副标题为「查看 Agent / Token 使用与调用概况」。
- 代码：`GovernanceOverview.tsx` title、`navigation.ts` label `治理概览`。

### Expected
用户可见主标题与侧栏改为「使用概况」。路由可继续 `/admin/governance`。

### Browser Check
1. Open `/admin/governance`.
2. Verify `h1` and sidebar current item read「使用概况」, not「治理概览」.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-002: 顶栏窗口 badge 与「访问日志」冗余

Status: Fixed
Route: `/admin/governance`
Area: PageHeader badges / actions
Severity: P3
Reported: 2026-08-05

### Feedback
右上角「N 小时窗口」与「访问日志」冗余，可删除。

### Evidence
- 存在 `governance-window-badge`（如「24 小时窗口」）且与 24h/7d 切换重复。
- 顶栏「访问日志」与侧栏「访问日志」重复。

### Expected
删除窗口 badge 与顶栏「访问日志」；保留窗口切换。

### Browser Check
1. Open `/admin/governance`.
2. Confirm no status badge text matching `小时窗口`.
3. Confirm PageHeader actions do not include a second「访问日志」link (sidebar entry may remain).

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-003: 24h/7d 窗口未全局生效

Status: Fixed
Route: `/admin/governance`
Area: KPI window binding, popular tables, list active columns
Severity: P1
Reported: 2026-08-05

### Feedback
右上角 24 小时、7 天按钮应全局有效；除 Agent 总数、配置 Token 外，其他 KPI 数值与提示词都需匹配调整。

### Evidence
- 切到 24h：调用量 `10→0`、平均时长联动；活跃 Agent/Token 仍显示「近 7 天」且数值不变。
- 后端 `ACTIVE_WINDOW_HOURS = 168`；`popularTables` 固定 7 天。

### Expected
配置存量（Agent 总数、配置 Token、配置表）不随窗口变；活跃类、调用量、P95、热门表、列表活跃列随 `hours`，文案同步「近 24 小时 / 近 7 天」。

### Browser Check
1. Set window to 7 days; note active Agent/Token/table and popular tables copy.
2. Switch to 24 hours.
3. Verify active metrics and popular-tables notice switch to 24-hour wording and values can differ.
4. Verify Agent 总数 / 配置 Token (/ 配置表) unchanged.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-004: 「最近活跃」标签不够具体

Status: Fixed
Route: `/admin/governance`
Area: Active Agent / Token metric labels
Severity: P2
Reported: 2026-08-05

### Feedback
「最近活跃 / 总 Agent」中的「最近活跃」不够具体，要和 7 天、24H 对齐。

### Evidence
- 主标签「最近活跃 Agent」；hint 硬编码「近 7 天有调用」。

### Expected
主标签用「活跃 Agent」；hint/副行明确「近 24 小时有调用」或「近 7 天有调用」。

### Browser Check
1. Toggle 24h / 7d.
2. Confirm no vague「最近活跃」as primary label without window context in hint.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-005: KPI hint 技术细节过多

Status: Fixed
Route: `/admin/governance`
Area: Metric card hints / popular tables notice
Severity: P2
Reported: 2026-08-05

### Feedback
「access_log 去重 prefix」「AVG(duration_ms)」等描述太技术，不够用户友好。

### Evidence
- 活跃 Token hint：`access_log 去重 prefix`。
- 平均响应时长 hint：`7 天 AVG(duration_ms)`。
- 热门表 notice 暴露 `access_log_sources`。

### Expected
改为业务口径（如「近 N 有使用」「95% 的访问低于此值」「按调用次数排序」），不在主文案暴露实现字段名。

### Browser Check
1. Scan all metric hints and section notices.
2. Confirm no user-visible `access_log`、`AVG(duration_ms)`、`去重 prefix`、`access_log_sources`.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-006: 缺少配置表 / 活跃表 KPI

Status: Fixed
Route: `/admin/governance`
Area: Metric grid row 2
Severity: P2
Reported: 2026-08-05

### Feedback
希望在 8 个 KPI 中增加访问表统计：总配置的表、活跃的表，作为第二排指标。

### Evidence
- 现有 8 卡无表存量；仅底部「最受访问表（Top 10）」列表。

### Expected
第二排含「配置表」「活跃表」（角色授权去重 / 窗口内访问去重）。

### Browser Check
1. Verify metric cards include「配置表」and「活跃表」.
2. Confirm they are not confused with 启用表范围 copy.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-007: 活跃数与活跃率应合并

Status: Fixed
Route: `/admin/governance`
Area: Metric grid row 1
Severity: P2
Reported: 2026-08-05

### Feedback
可将「最近活跃 Agent」与「Agent 活跃率」、「近 7 天活跃 Token」与「Token 活跃率」整合，作为第一排指标。

### Evidence
- 现为四张独立卡：活跃 Agent、Agent 活跃率、活跃 Token、Token 活跃率。

### Expected
第一排：Agent 总数、活跃 Agent（含活跃率副行）、配置 Token、活跃 Token（含活跃率副行）。

### Browser Check
1. Confirm no standalone「Agent 活跃率」/「Token 活跃率」cards.
2. Confirm rate text appears inside active Agent/Token cards.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-008: 应用 P95 替代平均响应时长

Status: Fixed
Route: `/admin/governance`
Area: Latency KPI
Severity: P2
Reported: 2026-08-05

### Feedback
第二排「平均响应时长」不如「95% 的访问低于 xx ms」有意义。

### Evidence
- UI 展示 `avgLatencyMs`；API `cards.p95LatencyMs` 已计算未用于主 KPI。

### Expected
顶栏第 8 卡为「响应上限（P95）」/「95% 的访问低于此值」；真实 P95，禁止 avg 顶替。

### Browser Check
1. Confirm primary latency card is P95 wording, not「平均响应时长」.
2. Confirm hint communicates 95th percentile user meaning.

### Notes
Spec 78 / `wo-202608-10` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-009: 使用概况表格未遵从共享 Data Grid 基线

Status: Fixed
Route: `/admin/governance`
Area: Agent 使用排行 / Token 使用摘要 / 最受访问表
Severity: P2
Reported: 2026-08-05

### Feedback
本页三张表与 `/connections` 及 Data Grid 规范不一致：手写 `min-w-full divide-y text-sm` 基线，表头/正文约 14px，缺 `pl-data-grid`。

### Evidence
- 浏览器 + 源码：三表 class 为 `min-w-full divide-y divide-border-default text-sm`；computed th/td ≈ 14px/700 与 14px/400。
- `/connections` Schema 资产表：`pl-data-grid pl-data-table pl-schema-asset-table`，约 12px 密度。
- 定位评估：本页为 dashboard 使用概况，需轻量遵从共享网格基线，不必搬 connections 工作台全套列模板。

### Expected
三表使用 `pl-data-grid` + `pl-usage-overview-table`；12px 正文密度；数量列 `tabular-nums` 次级层级；「查看日志」弱强调 `pl-row-action-link`；不引入 schema-asset colgroup。

### Browser Check
1. Open `/admin/governance`.
2. Confirm Agent / Token / 热门表三张 `table` 均含 class `pl-data-grid`.
3. Confirm no table still uses `min-w-full divide-y … text-sm` as the baseline.
4. Confirm「查看日志」使用行内弱链样式（非过亮页级主按钮强调）。

### Notes
Spec 82 / `wo-202608-14` 已落地（本轮不做浏览器验证，待复核后升 Verified）。
