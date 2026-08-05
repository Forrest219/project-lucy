# Admin Config Audit Feedback

本页记录 `/admin/config-audit` 配置审计相关 UI/UX 反馈。

## UX-ADMIN-CONFIG-AUDIT-001: PageHeader 冗余条数 badge 与导出样式

Status: Fixed
Route: `/admin/config-audit`
Area: PageHeader badges / export action
Severity: P1
Reported: 2026-08-05

### Feedback
右上角 `N 条记录` 与表格上方分页 `x–y / 共 N 条` 三重重复；导出 CSV 用 ghost 与同模块发布记录 secondary 导出不一致。

### Expected
删除 PageHeader count badge；「导出 CSV」改 `pl-btn--secondary`。

### Browser Check
1. Open `/admin/config-audit`.
2. Verify no record count badge in header; export link is secondary style.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-ADMIN-CONFIG-AUDIT-002: 分页固定每页 20 行

Status: Fixed
Route: `/admin/config-audit`
Area: Pagination
Severity: P1
Reported: 2026-08-05

### Feedback
22 条时显示 `1–22 / 共 22 条`，`PAGE_SIZE=50` 导致分页控件无效；用户希望固定每页 20 行以控制首屏长度。

### Expected
`PAGE_SIZE=20`；22 条时首屏 `1–20 / 共 22 条`，总页数 2。

### Browser Check
1. Open `/admin/config-audit` with >20 records.
2. Verify first page shows at most 20 rows and pagination advances.

### Notes
Spec 96 / `wo-202608-29` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-CONFIG-AUDIT-003: 表格未遵从 pl-data-grid 且字号不一致

Status: Fixed
Route: `/admin/config-audit`
Area: Table density / design system
Severity: P1
Reported: 2026-08-05

### Feedback
表格仅用 `pl-audit-table`，列级混用 `text-xs` / `text-sm`，与 Agent 列表、发布记录的 `pl-data-grid` 轻量规范不一致。

### Expected
接入 `pl-data-grid pl-data-table pl-config-audit-table`；正文统一 12px 密度。

### Browser Check
1. Open `/admin/config-audit`.
2. Verify table has `pl-data-grid` and consistent body typography.

### Notes
Spec 96 / `wo-202608-29` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-CONFIG-AUDIT-004: 字段业务中文化与操作者可读性

Status: Fixed
Route: `/admin/config-audit`
Area: Column headers / enum labels
Severity: P1
Reported: 2026-08-05

### Feedback
表头 `Actor`、单元格 `local-admin` / `agent_patch` / `governance` 等原始值对业务不友好；筛选 placeholder 中英混杂（`Agent / target`、`来源 source`）。

### Expected
表头用「操作者 / 来源 / 资产域 / 变更类型 / 目标 / 文件路径」；操作者展示「本机管理员」；枚举映射中文 label；筛选 placeholder 纯中文并对齐表头。

### Browser Check
1. Open `/admin/config-audit`.
2. Verify no `Actor` header; operator cell shows 本机管理员; filters use Chinese placeholders.

### Notes
Spec 96 / `wo-202608-29` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-CONFIG-AUDIT-005: 单管理员 actorNotice 冗余

Status: Fixed
Route: `/admin/config-audit`
Area: Notice banner / PageHeader description
Severity: P2
Reported: 2026-08-05

### Feedback
`pl-notice` 展示「当前为单管理员模式，actor=local-admin…」与 PageHeader 描述重复。

### Expected
删除 notice；description 改为「查看治理配置与语义资产的写入历史。」

### Browser Check
1. Open `/admin/config-audit`.
2. Verify no actorNotice banner; description has no actor=local-admin lecture.

### Notes
Spec 96 / `wo-202608-29` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-CONFIG-AUDIT-006: 筛选与表头对齐 + 时间筛选

Status: Fixed
Route: `/admin/config-audit`
Area: Filters / time range API
Severity: P1
Reported: 2026-08-05

### Feedback
筛选仅有目标/文件/资产域/来源，缺时间与变更类型；与表头不完全对齐；API 无 `since`/`until`。

### Expected
筛选顺序对齐表头；支持时间范围与变更类型；快捷窗口近 7/30 天；变更类型随资产域动态过滤；导出携带相同参数。

### Browser Check
1. Open `/admin/config-audit`.
2. Set since/until or quick window; verify list and CSV respect the range.
3. Select asset kind and verify change-type options narrow.

### Notes
Spec 96 / `wo-202608-29` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-ADMIN-CONFIG-AUDIT-007: PageHeader 冗余「访问日志」

Status: Fixed
Route: `/admin/config-audit`
Area: PageHeader actions
Severity: P1
Reported: 2026-08-05

### Feedback
右上角「导出 CSV」旁有「访问日志」跳转；侧栏「访问治理」已有同入口，页头重复且干扰主动作。

### Expected
PageHeader actions 仅保留「导出 CSV」；访问日志只走侧栏。

### Browser Check
1. Open `/admin/config-audit`.
2. Verify header has exactly one action link named「导出 CSV」；no「访问日志」in header.

### Notes
Spec 97 / `wo-202608-30` 已落地（本轮不做浏览器验证，结束后只做 code review）。主题：`header sibling nav redundancy`。

## UX-ADMIN-CONFIG-AUDIT-008: 导出 CSV 与主表不一致 + 文件名缺秒

Status: Fixed
Route: `/admin/config-audit`
Area: CSV export
Severity: P1
Reported: 2026-08-05

### Feedback
导出为 16 列英文原始字段（`local-admin` / `agent_patch` 等），与主表 7 列中文业务文案不一致；文件名 `config-audit-YYYYMMDD.csv` 缺时分秒。

### Expected
CSV 列头/单元格与主表一致（时间、操作者、来源、资产域、变更类型、目标、文件路径 + 同一套 label）；文件名 `config-audit-YYYYMMDD-HHmmss.csv`。

### Browser Check
1. Open `/admin/config-audit?targetId=demo_agent`.
2. Export CSV；verify 7 Chinese headers and localized cells match the table.
3. Verify downloaded filename includes `YYYYMMDD-HHmmss`.

### Notes
Spec 97 / `wo-202608-30` 已落地（本轮不做浏览器验证，结束后只做 code review）。主题：`export-table field parity`、`export filename second precision`。
