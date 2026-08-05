# Publish History Feedback

本页记录 `/publish/history`（发布记录）相关 UI/UX 反馈。后续浏览器核查应按条目 ID 定向执行 `Browser Check`。

## UX-PUBLISH-HISTORY-001: 表格缺少序号列

Status: Fixed
Route: `/publish/history`
Area: History table columns
Severity: P3
Reported: 2026-08-05

### Feedback
发布记录表没有序号，口头对齐与快速定位困难。

### Evidence
- 浏览器：表头为「发布时间 / 触发方式 / 操作人 / Reindex 状态 / 动作/快照」，无「#」或「序号」。
- 代码：`PublishHistory.tsx` thead 无序号列。

### Expected
倒序列表下展示序号，最新记录为 `1`。

### Browser Check
1. Open `/publish/history` with ≥2 records.
2. Verify first data row shows `#` = `1` for the newest record.

### Notes
Spec 85 / `wo-202608-17` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-002: 「动作/快照」列名与价值不清

Status: Fixed
Route: `/publish/history`
Area: History table column title / actions
Severity: P2
Reported: 2026-08-05

### Feedback
列标题「动作/快照」无法让用户感受到价值；列内只有模糊动作链。

### Evidence
- 浏览器：操作列标题为「动作/快照」。
- 代码：`<th>动作/快照</th>`。

### Expected
列名改为「操作」；行内仅保留与本条相关的 Diff / 错误动作。

### Browser Check
1. Open `/publish/history`.
2. Verify column header is「操作」, not「动作/快照」.
3. Verify row actions do not claim to download a historical snapshot.

### Notes
Spec 85 / `wo-202608-17` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-003: 「下载当前快照」失败且语义不清

Status: Fixed
Route: `/publish/history`
Area: Export action
Severity: P1
Reported: 2026-08-05

### Feedback
点击「下载当前快照」报错；用户不清楚下载的是什么。行内按钮易被误解为「该批次快照」。

### Evidence
- 浏览器：`POST /api/semantic-assets/export` → 500，Toast「导出失败：require is not defined」。
- 代码：`semantic-asset-export.ts` `makeScalar` 使用 `require("yaml")`；行内与 Header 均挂 `SemanticAssetExportButton`，label「下载当前快照」。

### Expected
- 修复 ESM export，Header 可成功打包。
- Header 文案「导出当前语义资产包 (.zip)」。
- 行内移除导出按钮（v0.1 仅导出当前工作区，非历史批次）。

### Browser Check
1. Click Header「导出当前语义资产包 (.zip)」.
2. Expect success summary + download link（非 require 错误）.
3. Confirm no per-row export button labeled as snapshot of that release.

### Notes
Spec 85 / `wo-202608-17` 已落地（本轮不做浏览器验证，待复核后升 Verified）。根因修复在 `makeScalar` → `yaml` ESM `Scalar`。

## UX-PUBLISH-HISTORY-004: 缺少连接 / 变更规模等业务信息

Status: Fixed
Route: `/publish/history`
Area: History table information architecture
Severity: P2
Reported: 2026-08-05

### Feedback
发布历史更应关注连接、变更源、语义/文件数量等业务信息，而不是只看运维触发与 Reindex 状态。

### Evidence
- 浏览器：两行均为「WebUI 强制重建索引」，无连接/规模列。
- API：`connectionIds` / `files` / `changedSources` 存在但 UI 未渲染；现网手动 Reindex 记录这些字段为空。

### Expected
增加「变更范围」「规模」列；手动 Reindex 无变更时显示「全库索引重建（无资产变更）」。

### Browser Check
1. Open `/publish/history` with a publish record that has `changedSources` / `files`.
2. Verify connection / source summary and file·source counts appear.
3. For manual reindex with empty change set, verify empty-state copy.

### Notes
Spec 85 / `wo-202608-17` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-005: 表格未接入 pl-data-grid 基线

Status: Fixed
Route: `/publish/history`
Area: Data grid visual contract
Severity: P2
Reported: 2026-08-05

### Feedback
表格使用未定义的 `pl-table` / `pl-table-th` / `pl-table-td`，14px 大表、无共享 hover/边框/密度；状态误用 `pl-validation-banner`。

### Evidence
- 浏览器 CDP：table class `pl-table w-full text-sm`；th 14px/700；td 14px/400；`pl-table*` CSS 规则数为 0。
- 代码：`PublishHistory.tsx`；`reindexBadgeClass` → `pl-validation-banner`。

### Expected
`pl-data-grid` + `pl-publish-history-table`；紧凑 status badge；弱 12px 行内链。

### Browser Check
1. Inspect table classList contains `pl-data-grid`.
2. Verify header/body denser than legacy 14px table; status is compact badge not banner.

### Notes
Spec 85 / `wo-202608-17` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-006: PageHeader 冗余「共 N 条记录」badge

Status: Fixed
Route: `/publish/history`
Area: PageHeader badges
Severity: P1
Reported: 2026-08-05

### Feedback
右上角「共 N 条记录」与表格行数重复，属于低价值统计 chip。

### Expected
删除 PageHeader count badge；计数由表格行与空态表达。

### Browser Check
1. Open `/publish/history` with ≥1 record.
2. Verify no「共 N 条记录」in PageHeader badges area.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-007: H1 与侧栏「发布记录」不一致

Status: Fixed
Route: `/publish/history`
Area: PageHeader title
Severity: P2
Reported: 2026-08-05

### Feedback
侧栏为「发布记录」，页面 H1 为「发布历史与审计」，进入后标题突变。

### Expected
H1 与 `navigation.ts` 一致为「发布记录」。

### Browser Check
1. Open `/publish/history`.
2. Verify H1 is「发布记录」, not「发布历史与审计」.

### Notes
Spec 91 / `wo-202608-24` 已落地（本轮不做浏览器验证，待复核后升 Verified）。

## UX-PUBLISH-HISTORY-008: 表头 `#` 且无筛选/分页

Status: Fixed
Route: `/publish/history`
Area: History table / filter / pagination
Severity: P2
Reported: 2026-08-06

### Feedback
表头仍为 `#`（应对齐配置审计「序号」）；无时间/触发/状态筛选与分页，记录增多后无法定位。

### Evidence
- 浏览器：`/publish/history` 无 filterbar、无分页；首列 `#`。
- 对照：`/admin/config-audit` 有「序号」、筛选栏、`1–20 / 共 N 条`。

### Expected
首列「序号」；筛选栏（时间窗口、触发方式、Reindex 状态、操作人）；固定 20 行分页。

### Browser Check
1. Open `/publish/history` with ≥21 records.
2. Verify column header「序号」；filterbar 可见；分页切换后序号连续。

### Notes
Spec 113 / `wo-202608-46` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-PUBLISH-HISTORY-009: Header 导出语义资产包与历史页职责错位

Status: Fixed
Route: `/publish/history`
Area: PageHeader export
Severity: P1
Reported: 2026-08-06

### Feedback
「导出当前语义资产包 (.zip)」像工具面板、两步打包再下载；与「查看历史」无关。用户需要的是明细表导出，不是 ZIP。

### Evidence
- 浏览器：Header ZIP 按钮；点击后展开摘要卡 + 「下载 (N 字节)」。
- 对照：配置审计 Header「导出 CSV」一键下载。

### Expected
Header「导出 CSV」一键下载当前筛选明细；移除 ZIP / `SemanticAssetExportButton`（ZIP 仅留发布工作台）。

### Browser Check
1. Open `/publish/history`.
2. Verify Header link「导出 CSV」；无 ZIP 文案/摘要卡。
3. Download CSV headers match table business labels.

### Notes
Spec 113 / `wo-202608-46` 已落地（本轮不做浏览器验证，结束后只做 code review）。

## UX-PUBLISH-HISTORY-010: 发布记录页缺明细导出 API/契约

Status: Fixed
Route: `/publish/history`
Area: API / export contract
Severity: P2
Reported: 2026-08-06

### Feedback
列表 API 无 `total`/筛选分页；无与主表对齐的 CSV 导出端点。

### Evidence
- 代码：`GET /api/semantic-assets/releases` 仅 `{ records }`；无 `export.csv`。

### Expected
`releases` 支持筛选 + `limit`/`offset` + `total`；`GET .../releases/export.csv` 与主表列一致，文件名精确到秒。

### Browser Check
1. Apply trigger filter; export CSV contains only matching rows.
2. Filename matches `publish-history-YYYYMMDD-HHmmss.csv`.

### Notes
Spec 113 / `wo-202608-46` 已落地（本轮不做浏览器验证，结束后只做 code review）。
