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
