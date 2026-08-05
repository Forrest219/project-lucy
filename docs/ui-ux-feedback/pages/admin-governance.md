# Admin Governance / Usage Overview Feedback

本页记录 `/admin/usage`（使用概况；旧 `/admin/governance` redirect）相关 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

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

## UX-ADMIN-GOV-010: 活跃 KPI 统计期间藏在卡底

Status: Fixed
Route: `/admin/governance`
Area: KPI MetricCard titles
Severity: P2
Reported: 2026-08-05

### Feedback
「近 7 天有调用 / 有使用 / 有访问 / MCP 调用」躲在卡底小字，标题只有「活跃 Agent」等，窗口不显性。

### Evidence
- 浏览器：活跃 Agent 标题无窗口；hint「近 7 天有调用」。
- 代码：`MetricCard` label 固定「活跃 Agent」，hint=`{windowText}有调用`。

### Expected
活跃 Agent / Token / 表与调用量的**标题**含「近 24 小时」或「近 7 天」；卡底不再重复藏窗口句。

### Browser Check
1. Open `/admin/governance` with 7 天 selected.
2. Confirm active KPI titles include「近 7 天」.
3. Switch to 24 小时； titles include「近 24 小时」.

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-011: 三块排行纵向堆叠，桌面应 1×3

Status: Fixed
Route: `/admin/governance`
Area: Agent / Token / 表排行布局
Severity: P2
Reported: 2026-08-05

### Feedback
三块全宽纵向堆叠，桌面宽度足够，应 1×3。

### Evidence
- 浏览器：三 `pl-panel` 纵向排列。

### Expected
桌面三列等宽排行区（`pl-usage-rank-grid`）。

### Browser Check
1. Open `/admin/governance` at ≥1280px width.
2. Confirm Agent / Token / 表排行同排三列。

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-012: 排行命名不统一且描述实现向

Status: Fixed
Route: `/admin/governance`
Area: 排行区标题与副文案
Severity: P2
Reported: 2026-08-05

### Feedback
「使用排行 / 使用摘要 / 最受访问表」不一致；副文案含「近窗口」「不重复展示顶部 KPI」「仅统计已结构化…」。

### Evidence
- 浏览器与 `GovernanceOverview.tsx` 标题/notice 文案。

### Expected
统一「{对象}调用排行 · 近 N」；副文案为用户价值句，并与 24h/7d 联动。

### Browser Check
1. Confirm three headings match「Agent/Token/表调用排行 · 近 …」.
2. Switch window； heading window text updates.
3. Confirm no「近窗口」「不重复展示顶部 KPI」in page body.

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-013: 排行应条形图只体现调用次数

Status: Fixed
Route: `/admin/governance`
Area: 排行可视化
Severity: P2
Reported: 2026-08-05

### Feedback
多列表格字段冗余；应降序条形图，只关心次数；详情交给其他页。

### Evidence
- Agent 表含最近访问、平均响应、Token 数、审计；Token 按最近访问排序。

### Expected
水平条 + 名称 + 次数；Token 按窗口 `calls` 降序；无审计/最近访问等列。

### Browser Check
1. Confirm no `governance-agent-table` data grid for rankings.
2. Confirm bar rows show name and call count only.
3. Confirm Token order follows call volume when multiple tokens have calls.

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。Spec 82 本页三表网格契约被本条目替代。

## UX-ADMIN-GOV-014: 时间窗按钮贴边挤压且误用 primary

Status: Fixed
Route: `/admin/governance`
Area: PageHeader 时间窗
Severity: P2
Reported: 2026-08-05

### Feedback
「24 小时」「7 天」贴边拼接；选中用 `pl-btn--primary`，不符合按钮规范与既有 segmented 模式。

### Evidence
- 截图：两按钮无 gap、共享中缝；选中黑底。
- 代码：`inline-flex overflow-hidden` + `pl-btn--primary/secondary`。
- 对照：`/eval/monitor` 使用 `pl-segmented-control`。

### Expected
使用 `pl-segmented-control`（两档 `cols-2`）；选中 `--active`，不用 primary 主按钮语义。

### Browser Check
1. Confirm time window control has class `pl-segmented-control`.
2. Confirm selected item uses segmented active style, not a lone primary CTA look jammed flush.

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-015: 顶栏「管理角色」冗余

Status: Fixed
Route: `/admin/governance`
Area: PageHeader actions
Severity: P3
Reported: 2026-08-05

### Feedback
顶栏「管理角色」与侧栏「角色权限」重复。

### Evidence
- PageHeader actions 含 Link to `/admin/roles`。

### Expected
删除顶栏「管理角色」；侧栏入口保留。

### Browser Check
1. Open `/admin/governance`.
2. Confirm PageHeader has no「管理角色」control.
3. Confirm sidebar still has「角色权限」.

### Notes
Spec 84 / `wo-202608-16` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-016: 页面索引未登记 Admin Governance 台账页

Status: Fixed
Route: `/admin/governance`
Area: UI/UX ledger index
Severity: P3
Reported: 2026-08-05

### Feedback
`docs/ui-ux-feedback/README.md` 页面索引缺少 Admin Governance / 使用概况行，长期台账机制不完整。

### Evidence
- README「页面索引」表无 `pages/admin-governance.md`。

### Expected
页面索引登记 Admin Governance → `pages/admin-governance.md`。

### Browser Check
N/A（文档索引）。Verify README table includes the row.

### Notes
随 Spec 84 / `wo-202608-16` 台账机制更新一并 Fixed。

## UX-ADMIN-GOV-017: URL 仍为 `/admin/governance`

Status: Fixed
Route: `/admin/usage`
Area: Route / navigation path
Severity: P1
Reported: 2026-08-05

### Feedback
用户可见已是「使用概况」，但 URL 后缀仍是 `governance`，强烈要求修正。

### Evidence
- 浏览器地址栏 `/admin/governance`。
- `navigation.ts` / `App.tsx` 路由仍为该 path。

### Expected
主路由 `/admin/usage`；`/admin/governance` replace redirect 到新 path。

### Browser Check
1. Open `/admin/usage` → 使用概况。
2. Open `/admin/governance` → URL 变为 `/admin/usage`.
3. Sidebar「使用概况」在 `/admin/usage` 高亮。

### Notes
Spec 86 / `wo-202608-18` 已落地（本轮不做浏览器验证，待复核后升 Verified）。API 仍 `/api/admin/governance/*`。

## UX-ADMIN-GOV-018: 调用排行 1 行时高度蜷缩

Status: Fixed
Route: `/admin/usage`
Area: Agent / Token / 表调用排行
Severity: P2
Reported: 2026-08-05

### Feedback
排行条形图效果好，但仅 1 行时高度蜷缩；需兼顾 1 行与多行（极端如 50 行）的均衡。

### Evidence
- 1×3 排行已落地；每列 1 条时内容区极矮、大片留白。

### Expected
按 Top 10 槽位定 `min-height`/`max-height`；空态居中；溢出滚动。

### Browser Check
1. With 1 ranking row, confirm rank body height ≈ 10-slot panel (not a thin strip).
2. With empty rank, confirm empty state fills same body height.
3. With 10 rows, confirm content fits without collapsing siblings unevenly.

### Notes
Spec 86 / `wo-202608-18` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-019: 「配置表」与连接页不一致且缺业务含义

Status: Fixed
Route: `/admin/usage`
Area: KPI MetricCard
Severity: P2
Reported: 2026-08-05

### Feedback
「配置表」不像业务用语，且易与连接页「启用表范围 / 已启用表数」混淆。

### Evidence
- 使用概况：配置表 / 角色已授权（ACL）。
- 连接概览：启用表范围、已启用表数、维护启用表范围（`enabled_tables`）。

### Expected
主标签改为「授权表」；hint 标明角色权限授权口径；禁止与启用表混用。

### Browser Check
1. Confirm KPI title「授权表」, not「配置表」.
2. Confirm hint mentions 角色权限 / 授权.
3. Confirm no「启用表」as this card's primary label.

### Notes
Spec 86 / `wo-202608-18` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-GOV-020: 「响应上限（P95）」表意不清

Status: Fixed
Route: `/admin/usage`
Area: KPI MetricCard
Severity: P2
Reported: 2026-08-05

### Feedback
「响应上限（P95）」需猜测；业务人员不易理解。

### Evidence
- 主标签「响应上限（P95）」；hint「95% 的访问低于此值」。

### Expected
主标签「多数请求耗时」；hint「95% 的请求在此时间内完成」；P95 不作主标签。

### Browser Check
1. Confirm metric title「多数请求耗时」.
2. Confirm hint communicates percentile latency in plain language.
3. Confirm empty window still shows「—」/「当前窗口无调用」.

### Notes
Spec 86 / `wo-202608-18` 已落地（本轮不做浏览器验证，待复核后升 Verified）。
