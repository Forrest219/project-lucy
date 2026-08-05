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
