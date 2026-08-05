# Catalog / Semantic Asset Feedback

本页记录 `/catalog` 与单表语义资产工作台相关 UI/UX 反馈。状态按当前可复核数据更新；需特定数据条件的条目会在 Notes 中说明残余复核项。

## UX-CATALOG-001: 表目录命名不符合语义建模架构

Status: Verified
Route: /catalog
Area: Sidebar navigation, PageHeader
Severity: P1
Reported: 2026-08-02

### Feedback
`表目录` 与数据接入里的 `启用表范围` 心智重叠；该入口实际维护结构化 YAML 模型，应归入 `语义建模 -> 语义资产`，与 `业务 Wiki` 并列。

### Evidence
- User feedback: `/catalog` navigation and page title used `表目录`.

### Expected
导航与页面标题使用 `语义资产`；`业务 Wiki` 继续作为非结构化业务口径沉淀入口。

### Browser Check
1. Open `/catalog`.
2. Verify sidebar group `语义建模` contains `语义资产` and `业务 Wiki`.
3. Verify page H1 is `语义资产`.

### Notes
Fixed in `webui/src/app/App.tsx`, `webui/src/pages/Catalog.tsx`, `webui/src/pages/TableEditor.tsx`, and `webui/docs/00-product-terminology-standard.md`. Verified in browser on 2026-08-02: active sidebar link and H1 both show `语义资产`.

## UX-CATALOG-002: Catalog 筛选器顺序与启用表范围不一致

Status: Verified
Route: /catalog
Area: Filter toolbar
Severity: P2
Reported: 2026-08-02

### Feedback
筛选器顺序和命名应与 `/connections/enabled-tables` 保持一致或借鉴其设计。

### Evidence
- User feedback: `/catalog` used `Connection / Schema / 状态 / 搜索`; `/connections/enabled-tables` uses search-first filtering.

### Expected
筛选器顺序为 `搜索 -> 连接筛选 -> Schema 筛选 -> 语义状态`，命名对齐启用表范围。

### Browser Check
1. Open `/catalog`.
2. Verify the filter toolbar order and labels.
3. Filter by search, connection, Schema, and semantic status to ensure results update.

### Notes
Fixed in `webui/src/pages/Catalog.tsx`. Verified in browser on 2026-08-02: filter order is `搜索 -> 连接筛选 -> Schema 筛选 -> 语义状态`.

## UX-CATALOG-003: Catalog 表格横向滚动条来自列宽设计不合理

Status: Verified
Route: /catalog
Area: Catalog table
Severity: P1
Reported: 2026-08-02

### Feedback
当前列宽足够，但底部仍出现横向滚动条，说明表格列宽和操作列设计不合理。

### Evidence
- Browser check before fix measured table wrapper `clientWidth 1040` and `scrollWidth 1053`.
- Implementation had `min-width: 1040px` and an action column styled as `w-px`.

### Expected
中等桌面宽度下不撑出页面；Connection / Schema 信息通过分组行表达，表格列保持紧凑可读。

### Browser Check
1. Open `/catalog` at a normal desktop viewport.
2. Verify the document has no horizontal scrollbar.
3. Verify the table uses group rows such as `连接：... · Schema：...`.

### Notes
Fixed in `webui/src/pages/Catalog.tsx` and `webui/src/app/app.css`. Verified in browser on 2026-08-02 at 1280x720: document, table wrapper, and table all have no horizontal overflow; group row shows `连接：DEMO-MYSQL · Schema：DATAFORAI（共 3 张表）`.

## UX-CATALOG-004: Row more menu exposes low-value actions

Status: Verified
Route: /catalog
Area: Table row actions
Severity: P2
Reported: 2026-08-02

### Feedback
`复制完整引用` 没有明确应用场景；`业务 Wiki` 作为泛入口不够直白；`查看详情` 产生冗余抽屉链路。

### Evidence
- User feedback: row menu showed `复制完整引用`、`查看详情`、`业务 Wiki`.

### Expected
默认删除 `复制完整引用` 和 `查看详情`。仅当存在 Wiki 引用时显示 `查看关联的 业务 Wiki`。

### Browser Check
1. Open `/catalog`.
2. For rows without Wiki refs, verify only `维护语义 ↗` is visible and no more menu is rendered.
3. For rows with Wiki refs, open more menu and verify it only contains `查看关联的 业务 Wiki`.

### Notes
Fixed in `webui/src/pages/Catalog.tsx`. Browser checked on 2026-08-02: current dataset has no rows with Wiki refs, so rows render no more menu and no `复制完整引用` / `查看详情`. Positive `查看关联的 业务 Wiki` menu remains pending until a row with `wikiRefCount > 0` is available.

## UX-CATALOG-005: 单表页 Header badge 信息冗余

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench header
Severity: P2
Reported: 2026-08-02

### Feedback
单表页右上角的 `demo-mysql`、`dataforai`、`完成度 done` 中，除完成度外均为冗余设计。

2026-08-02 补充反馈：右上角 `完成度 done`、`30 字段`、`4 指标`、`3 分群`、`0 关联` 也属于冗余状态芯片；这些数量和编辑结构重复，不应放在 Header。

### Evidence
- Browser check before fix confirmed header context badges displayed connection, Schema, and completion.
- 2026-08-02 later user feedback refined the IA: current table identity should be anchored near the page header, while Connection / Schema should be context, not detached badge noise.

### Expected
Header 不再把 Connection / Schema 当作右上角 detached badges，也不展示 `完成度 done`、字段数、指标数、分群数、关联数这类低价值 summary chips。当前表名、Connection / Schema context should be presented as a compact current-asset identity near the page header. Counts may appear as local tab badges inside `语义内容`, but not in Header. See `UX-CATALOG-009` and `UX-CATALOG-014`.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify Connection and Schema do not appear as standalone right-side badge noise.
3. Verify current table identity is anchored near the header as specified by `UX-CATALOG-009`.
4. Verify Header does not show `完成度 done`, field count, metric count, segment count, or join count chips.
5. Verify counts, if shown, appear only as local navigation badges under `语义内容`.

### Notes
Originally fixed and browser-verified on 2026-08-02 as completion-only badges. Superseded by M49 IA separation: `webui/src/pages/TableEditor.tsx` now anchors current table identity near H1 and adds semantic summary chips. Verified in browser on 2026-08-02 after Docker rebuild: Connection / Schema no longer appear as standalone right-side badge noise, and current table identity is anchored near H1 as specified by `UX-CATALOG-009`.

2026-08-02 M52 revises the expected state again: semantic summary chips are no longer allowed in Header. Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: Header contains compact identity only (`superstore_orders`, `demo-mysql / dataforai`), has no action buttons or summary chips, and field / metric / segment / join counts appear only as local `语义内容` tabs.

## UX-CATALOG-006: Catalog table and filter visuals diverge from enabled tables

Status: Verified
Route: /catalog
Area: Filter toolbar, Catalog table
Severity: P2
Reported: 2026-08-02

### Feedback
`/catalog` 的表格视觉效果与 `/connections/enabled-tables` 不一致：表格行缺少网格线，搜索框尺寸和小框设计也不一致。

### Evidence
- Browser check before fix measured `/catalog` table with `border-collapse: separate` and data cells without bottom borders.
- Browser check before fix measured `/catalog` search input wider than `/connections/enabled-tables`; enabled tables use the compact `pl-whitelist-search-input` sizing.

### Expected
Catalog 筛选工具栏复用启用表范围的容器、小框和搜索框尺寸；Catalog 表格使用 collapsed table 和单元格底部分隔线，视觉密度与启用表范围保持一致。

### Browser Check
1. Open `/catalog`.
2. Compare with `/connections/enabled-tables`.
3. Verify search input desktop width matches the enabled-tables compact width.
4. Verify table rows show 1px grid lines between rows.

### Notes
Fixed in `webui/src/pages/Catalog.tsx` and `webui/src/app/app.css`. Verified in browser on 2026-08-02 after rebuilding `docker-compose.demo.yml`: `/catalog` and `/connections/enabled-tables` both use a 360x38 search input, 8px input radius, 1px toolbar/input borders, collapsed table layout, 1px data-cell row grid lines, and no horizontal overflow.

## UX-CATALOG-007: Catalog row columns and primary action feel disconnected

Status: Verified
Route: /catalog
Area: Catalog table columns, row actions
Severity: P2
Reported: 2026-08-02

### Feedback
`表名` 和 `语义状态` 横向距离形成视觉断点；`操作` 表头与行内 `打开工作台` 距离过远且没有对齐；`打开工作台` 文案不如 `维护语义` 准确，框形按钮样式也与 `/connections/enabled-tables` 的 `查看语义` 文本链接风格不一致。

### Evidence
- User screenshot: first two visible columns are separated by excessive blank space.
- User feedback: operation header and row action are visually disconnected.
- Enabled tables use `pl-inline-link` for row semantic navigation.

### Expected
Catalog 表格不使用固定百分比列宽；列距按内容自然分布。Catalog 行主操作使用轻量文本链接 `维护语义 ↗`，与启用表范围的 `查看语义 ↗` 风格一致，且与 `操作` 表头左对齐。

### Browser Check
1. Open `/catalog`.
2. Compare table row action style with `/connections/enabled-tables`.
3. Verify `维护语义 ↗` is a lightweight text link, not a framed button.
4. Verify `操作` header and row action align visually.
5. Verify no horizontal overflow is introduced.

### Notes
Fixed in `webui/src/pages/Catalog.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/catalog.test.tsx`. Verified in browser on 2026-08-02 after rebuilding `docker-compose.demo.yml`: Catalog uses `table-layout: auto`, `表名` and `语义状态` have no measured column gap, row action renders as unframed `pl-inline-link` text `维护语义 ↗`, and action/header alignment matches enabled tables with a 12px left inset.

## UX-CATALOG-008: Catalog and enabled table scope grids use divergent implementation

Status: Verified
Route: /catalog, /connections/enabled-tables
Area: Table grid implementation, action column terminology
Severity: P2
Reported: 2026-08-02

### Feedback
`/catalog` 和 `/connections/enabled-tables` 表格网格线肉眼看起来仍有差异；两个页面最后一列表头分别使用 `操作` 和 `动作`，含义相同但命名不一致。

### Evidence
- Browser check before fix measured both pages using 1px row bottom borders, but `/catalog` used `.pl-catalog-table` while `/connections/enabled-tables` used `.pl-data-table`.
- `/catalog` action `td` used `display: flex`; enabled table scope kept the action cell as a normal `table-cell`.
- Enabled table scope header applied uppercase / wider letter spacing, while Catalog did not.
- Column header labels were `操作` in Catalog and `动作` in enabled table scope.

### Expected
Catalog and enabled table scope should share the same base table grid implementation. The action column header should be `操作` on both pages. Table cells should remain normal table cells; any flex alignment should live inside cell content wrappers.

### Browser Check
1. Open `/catalog` and `/connections/enabled-tables`.
2. Verify both tables use the same base grid style and 1px row separators.
3. Verify both final column headers read `操作`.
4. Verify Catalog row action cells remain aligned without the `td` itself becoming flex.

### Notes
2026-08-02 已将两页表格挂到共享 `pl-data-grid` 样式；启用表范围最后一列表头改为 `操作`；Catalog 操作列的 flex 布局下沉到内部容器，`td` 保持标准表格单元格。修复当轮按用户约束仅做代码验证和 code review，浏览器复核在 Docker 重建后补做。
2026-08-02 Docker 重建后浏览器复核通过：`/catalog` 与 `/connections/enabled-tables` table class 均包含 `pl-data-grid`，表格均为 `border-collapse: collapse` / `table-layout: auto`；表头和数据单元格底边线均为 `1px solid rgb(229, 231, 235)`；最后一列表头均为 `操作`；Catalog 操作列 `td` 为 `table-cell`，内部 `.pl-catalog-table-actions-inner` 为 `flex`；两页 action 相对表头左缩进均为 `12px`，无横向溢出。

## UX-CATALOG-009: 单表页当前表身份没有形成左上锚点

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench header, current asset identity
Severity: P1
Reported: 2026-08-02

### Feedback
`当前表 demo-mysql/dataforai/superstore_orders` 的位置偏中间，不像正在编辑对象的左上锚点；用户进入单表工作台后应第一眼知道锁定维护的就是这张表。

### Evidence
- Browser check before M49 measured `当前表` rendered inside the exchange section definition list rather than near H1.
- User feedback: “我们锁定要修改的就是这张表”。

### Expected
单表页 H1 anchors the current table. Connection and Schema context appears directly below or beside H1, with database object text protected by `translate="no"` and `notranslate`. The old mid-page `当前表 demo-mysql/dataforai/superstore_orders` metadata item is removed.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify the first viewport exposes `superstore_orders` as H1 and `demo-mysql / dataforai` near it.
3. Verify table / Connection / Schema object text has browser translation defense.
4. Verify the exchange / maintenance panel no longer contains a `当前表` metadata item.

### Notes
Fixed by M49 in `webui/src/pages/TableEditor.tsx` and covered by `webui/src/__tests__/table-editor.test.tsx` (`anchors the current table with header context and semantic summary chips`). Verified in browser on 2026-08-02 after Docker rebuild: H1 is `superstore_orders`, header context is `demo-mysql / dataforai`, both table and context nodes have `translate="no"` / `notranslate`, and the maintenance panel no longer contains a `当前表` metadata item.

## UX-CATALOG-010: YAML 导入导出入口不应占用主编辑流

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: YAML import/export entry, import status
Severity: P1
Reported: 2026-08-02

### Feedback
`语义资产交换` 作为 Claude Code / Codex 主路径却默认不是打开状态；`导入文件`、`影响文件` 放在中间 / 右侧元信息列，位置奇怪，和导出 / 粘贴 / 导入动作脱节。

2026-08-02 补充反馈：Claude Code / Codex 是维护手段，不应占据首屏过高空间；入口需要可发现，但详细交换流程应降级为紧凑入口或一层可展开内容。

2026-08-02 再次修订：顶部已经有 `导入 YAML`、`导出 YAML`，主内容区再放一个 `导入 / 导出` 分区价值不大；导入详情应进入抽屉，导入来源 / 影响文件应进入右侧审阅反馈，而不是占据主编辑流。

### Evidence
- Browser check before M49 showed the exchange flow with a collapsed `粘贴 YAML` disclosure and a right-side definition list containing `当前表`、`导入文件`、`影响文件`.
- User feedback explicitly called out `导入文件`、`影响文件` placement as detached from the task flow.
- 2026-08-02 browser check after latest fix confirmed the inline `导入 / 导出` section is gone; top `导入 YAML` opens a drawer with `选择 YAML 文件` and `粘贴 YAML`; hidden file input remains `aria-hidden="true"` and `tabIndex="-1"`.

### Expected
YAML import/export is an auxiliary command path, not a main editor section:

- `导入 YAML` and `导出 YAML` are exposed once in the global command surface.
- The main editor does not render a standalone `导入 / 导出` or `YAML exchange` section.
- `导入 YAML` opens a drawer / modal-level task surface for file selection and pasted YAML preview.
- Native file input is hidden from tab order and visual layout.
- Import source and affected file count are shown as review metadata, not as a detached center-page block.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify visible `导入 YAML` count is 1 and visible `导出 YAML` count is 1.
3. Verify the main content has no `导入 / 导出` section.
4. Click `导入 YAML` and verify a drawer opens with `选择 YAML 文件` and `粘贴 YAML`.
5. Verify the native file input is not visible, is `aria-hidden="true"`, and has `tabIndex="-1"`.
6. Generate an import preview and verify `导入来源` / `影响文件` update in `变更审阅`.

### Notes
Fixed by M49 in `webui/src/pages/TableEditor.tsx` and `webui/src/app/app.css`; tests assert the maintenance panel text and that `当前表` is no longer inside the panel. Verified in browser on 2026-08-02 after Docker rebuild: `Claude Code / Codex 辅助维护` is visible on load, `导入文件` and `影响文件` are inside that panel, and paste preview updates `导入文件` from `未导入` to `粘贴 YAML`.

2026-08-02 M52 revises the expected state: auxiliary maintenance remains discoverable but must be compact and secondary. Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: `Claude Code / Codex 辅助维护` is visible on load, occupies a compact secondary block, and `导入文件` / `影响文件` stay within the same left-aligned maintenance context instead of the page center.

2026-08-02 latest revision removes the inline import/export block entirely. Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; verified in browser after Docker rebuild: no inline `导入 / 导出`, top `导入 YAML` opens a drawer, hidden file input is out of focus order, and import metadata lives in `变更审阅`.

## UX-CATALOG-011: 待处理建议候选关联价值有限且抢占主页面

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Candidate join suggestions
Severity: P1
Reported: 2026-08-02

### Feedback
`待处理建议（5）` 的价值不大，可以删除。它的内容看起来像自动生成建议，但机制只是字段名启发式，容易误导用户以为这是强语义推断。

### Evidence
- Browser check before M49 showed `待处理建议（5）` with rows like `rows`, `orders`, `customers`, and note `推断依据: 字段名匹配`.
- Code check confirmed table-page candidates came from `_id` heuristic live suggestions plus `.ktx-ui/join-candidates.json` sidecar merge.

### Expected
The table semantic asset workbench does not show `待处理建议（N）`, candidate join banners, or candidate row actions (`确认写入`、`保留`、`不采用`). Formal join editing remains available under the `语义内容 -> 关联` context or a dedicated join page.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify no `待处理建议` section is visible.
3. Verify no candidate action buttons are visible.
4. Open `语义内容 -> 关联` and verify formal join maintenance remains reachable.

### Notes
Fixed by M49 in `webui/src/pages/TableEditor.tsx`: candidate suggestion rendering and the table-page `/api/joins/candidates` query were removed. Shared join candidate API / sidecar utilities remain for compatibility. Verified in browser on 2026-08-02 after Docker rebuild: `待处理建议`, candidate heading, and candidate row actions are absent; `语义内容 -> 关联` still exposes the formal `打开关联关系` entry.

2026-08-04 部分修正（Spec 73 / `UX-CATALOG-026`）：**首屏仍禁止**「待处理建议」banner（本条核心噪声约束继续有效）。候选关联回到 `关联` tab 内联维护，并强制标注「字段名启发式，非强语义推断」；正式关系与候选操作不再依赖独立 `/joins` 页面。`/joins/:conn/:schema/:table` 仅保留兼容重定向到 `/catalog/...?tab=joins`。

## UX-CATALOG-012: 语义结果和维护手段混在一起

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench IA, semantic content
Severity: P1
Reported: 2026-08-02

### Feedback
无论手工还是 Claude Code / Codex，都是维护手段；维护结果（基础语义、表描述、行粒度等）应该统一呈现，只需要体现一次。`高级：手工维护语义字段` 中的 `完整表名`、`字段数`、`关联数` 等信息冗余。

2026-08-02 补充反馈：`语义内容` 不应再是大折叠块里的局部工作区，字段 / 指标编辑不应被塞进“页面 -> 卡片 -> 局部侧栏 -> 表单”的深层结构；内部对象树形成 Double Sidebar，应移除。

### Evidence
- Browser check before M49 showed `高级：手工维护语义字段` as a separate secondary path.
- The same page repeated table identity / counts in header, object tree, and overview metadata (`完整表名`、`字段数`、`关联数`).

### Expected
The workbench separates semantic result from maintenance method:

- Semantic result area is titled `语义内容`.
- `语义内容` is the primary editor surface, not a top-level collapsible disclosure.
- `基础语义`、`字段`、`指标`、`分群`、`关联` are exposed as tabs or equivalent first-class controls.
- `高级：手工维护语义字段` is not visible.
- Static duplicate metadata such as `完整表名`、`字段数`、`关联数` is not repeated inside the semantic content overview.
- Claude Code / Codex appears only as a maintenance method for the same semantic content.
- The main content does not render a second sidebar such as `返回语义资产` / `同 Schema 表` / `当前表`.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify `语义内容` is visible as the primary editor surface, not as a top-level disclosure.
3. Verify `高级：手工维护语义字段` is absent.
4. Verify overview does not repeat `完整表名`、`字段数`、`关联数`.
5. Verify field / metric / segment / join editing remains reachable from first-class tabs or equivalent controls.
6. Verify no inner sidebar containing `返回语义资产`、`同 Schema 表`、`当前表` appears inside the main editor.

### Notes
Fixed by M49 in `webui/src/pages/TableEditor.tsx` and `webui/src/app/app.css`; tests cover `语义内容` default-open, absence of the old title, and removal of duplicate metadata. Verified in browser on 2026-08-02 after Docker rebuild: `语义内容` is default-open, `高级：手工维护语义字段` is absent, and overview no longer repeats `完整表名`、`字段数`、`关联数`.

2026-08-02 M52 revises the expected state: `语义内容` is no longer a top-level disclosure and the inner object tree is removed in favor of tabs. Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: `语义内容` renders as the primary editor surface with first-class tabs (`基础语义`、`字段`、`指标`、`分群`、`关联`), the old `高级：手工维护语义字段` copy is absent, and no inner sidebar with `返回语义资产` / `同 Schema 表` / `当前表` appears.

## UX-CATALOG-013: 单表页全局命令重复暴露

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench commands
Severity: P1
Reported: 2026-08-02

### Feedback
`导出 YAML` 与 `导入 YAML` 在 Header 和 `Claude Code / Codex 辅助维护` 中重复出现；`校验` 与 `保存` 在 Header 和 `变更状态` Inspector 中重复出现。用户会困惑这些同名按钮是否有区别。

### Evidence
- Browser check before M52 confirmed duplicate visible commands in the same viewport.
- User feedback: “控制台的大忌是同一视口内暴露出多个相同功能的全局触发点。”

### Expected
同一视口内，同一个全局命令只能有一个主触发点：

- `导出 YAML` and `导入 YAML` appear only once in the global command surface.
- `校验` and `保存` appear only in one global command surface, not inside `变更状态`.
- The main content must not reintroduce a second command block that repeats the same global commands as section-level actions.
- Accessible labels may add context, but must not be used to compensate for duplicate visible commands.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify visible `导出 YAML` count is 1.
3. Verify visible `导入 YAML` count is 1.
4. Verify visible `校验` count is 1.
5. Verify visible global save trigger count is 1.
6. Verify `变更状态` does not contain operation buttons.

### Notes
Fixed by M52 in `webui/src/pages/TableEditor.tsx`; tests assert a single command bar and one visible instance of export / import / validate / save commands. Non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: visible command counts are one each for `导出 YAML`、`导入 YAML`、`校验` and `保存`; `变更状态` contains no operation buttons.

2026-08-02 latest revision extends the same rule from duplicate buttons to duplicate command sections: the inline `导入 / 导出` section was removed, while top-level `导入 YAML` / `导出 YAML` remain the single visible command entry points. Browser verification passed after Docker rebuild.

## UX-CATALOG-014: 单表页 Header 身份区信息过载

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench header
Severity: P1
Reported: 2026-08-02

### Feedback
左上角同时展示完整面包屑、表名、Connection / Schema 和页面功能说明，重复表达当前对象和页面能力。Header 应精简，只回答“我在哪里、正在编辑谁”。

### Evidence
- Browser check before M52 showed `语义资产 / demo-mysql / dataforai / superstore_orders`、H1 `superstore_orders`、`demo-mysql / dataforai` and `导出、导入、校验并审阅当前表的 semantic-layer YAML。` in the Header.
- User feedback: “左上角的内容是否可以精简？”

### Expected
Header should be compact:

- H1 shows the current table name.
- Breadcrumb stops before repeating the current table, or otherwise avoids duplicate table identity.
- Connection / Schema context appears at most once near H1.
- Header does not describe page functions such as export / import / validate / review.
- Header does not carry low-value count chips; see `UX-CATALOG-005`.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify H1 is `superstore_orders`.
3. Verify Header does not repeat `superstore_orders` in both breadcrumb and H1.
4. Verify `demo-mysql / dataforai` appears as compact context.
5. Verify `导出、导入、校验并审阅当前表的 semantic-layer YAML。` is absent.

### Notes
Fixed by M52 in `webui/src/pages/TableEditor.tsx` and covered by `table-editor.test.tsx` (`anchors the current table with a compact header and no redundant chips`). Non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: H1 is `superstore_orders`, the breadcrumb no longer repeats the current table, `demo-mysql / dataforai` appears once as compact context, and the page-function sentence is absent.

## UX-CATALOG-015: 生产 UI 出现研发 spec 式说明文案

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench copy
Severity: P2
Reported: 2026-08-02

### Feedback
页面直接展示多句设计理由或实现说明，例如 `主流程：导出 YAML...`、`维护结果会统一写入...`、`长页面编辑时保持...`。企业级 SaaS 应通过布局与交互表达逻辑，而不是把 spec 注释写进生产 UI。

### Evidence
- Browser check before M52 confirmed these explanatory phrases were visible in the first viewport or sticky status area.
- User feedback called these “研发 Spec 说明直接硬编码在 UI 上”。

### Expected
Production UI should describe objects and actions, not implementation rationale:

- Remove paragraph-length design explanations from the table workbench.
- Use short labels, tooltips, help icons, or docs links for optional help.
- Do not add new visible copy that explains why the layout is designed a certain way.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify `主流程：导出 YAML` is absent.
3. Verify `维护结果会统一写入当前表语义内容` is absent.
4. Verify `长页面编辑时保持校验和保存状态可见` is absent.
5. Scan the first viewport and sticky status area for paragraph-length design rationale.

### Notes
Fixed by M52 in `webui/src/pages/TableEditor.tsx`; tests assert the removed phrases are absent. Non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: removed spec-like phrases are absent from the first viewport and sticky status area, including `主流程：导出 YAML`、`维护结果会统一写入当前表语义内容` and `长页面编辑时保持校验和保存状态可见`.

## UX-CATALOG-016: 状态与变更详情拆分导致审阅心智混乱

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench change review
Severity: P1
Reported: 2026-08-02

### Feedback
`变更状态` 同时放状态统计、`校验` / `保存变更`、`变更预览`、`Diff` / `YAML` / `Validate` 和 `高级：查看原始 Diff`，职责混在一起。Sticky Inspector 应是动态结果反馈区，而不是另一个操作面板。

2026-08-02 再次修订：`保存状态` 和 `变更详情` 对用户看起来都是提醒，差异不清；底部 `变更详情` 在长页面里隐藏太深。应合并成右侧常驻 `变更审阅`，状态是辅助摘要，核心是本次变更和 Diff 证据。

### Evidence
- Browser check before M52 showed operation buttons and raw detail controls inside the same `变更状态` area.
- User feedback: “右侧 Inspector 职责不清”。
- 2026-08-02 later browser check confirmed after editing `row_id` Human, `变更审阅` stays visible on long-page scroll and shows both object-level summary and YAML Diff in the right rail.

### Expected
Right-side review uses one coherent model:

- The sticky right rail is titled `变更审阅` or equivalent, not split into competing `保存状态` and bottom-page `变更详情`.
- Status badges may show dirty state, validation state, save pending / error, affected file count, and Unknown YAML Key count.
- The same rail exposes `本次变更` and a default-visible `YAML Diff`; status is summary, Diff is evidence.
- `YAML` and `校验` can remain secondary tabs inside the same review surface.
- The review rail must not contain global operation buttons such as `校验` or `保存`.
- `高级：查看原始 Diff` must not hide the most valuable change evidence.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Verify the right rail is `变更审阅`.
3. Verify there is no separate bottom-page `变更详情` section.
4. Verify `变更审阅` contains status badges, `本次变更`, and tabs for `YAML Diff`、`YAML`、`校验`.
5. Verify `YAML Diff` is selected by default and visible without opening an advanced disclosure.
6. Verify `变更审阅` does not contain global `校验` or `保存` buttons.

### Notes
Fixed by M52 in `webui/src/pages/TableEditor.tsx` and `webui/src/app/app.css`; `变更详情` is now a separate non-sticky panel and `变更状态` no longer renders operation buttons. Non-browser validation passed by request: `npm test -- src/__tests__/table-editor.test.tsx`, `npm test -- src/__tests__/app-shell.test.tsx`, `npm run build`, and code review. Browser verification passed after Docker rebuild.

Verified in browser on 2026-08-02 after Docker rebuild: `变更状态` shows feedback only (`已完成`, Dry-run count, Unknown count), while `变更详情` separately exposes `变更预览` plus `Diff` / `YAML` / `Validate`; `高级：查看原始 Diff` is not inside the sticky status area.

2026-08-02 latest revision supersedes the M52 split model: `保存状态` and `变更详情` are merged into sticky `变更审阅`. Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; verified in browser after Docker rebuild: right rail contains status badges, `本次变更`, default-visible `YAML Diff`, `YAML`, and `校验`; no global operation buttons appear inside the rail.

## UX-CATALOG-017: 长页面字段编辑缺少对象级变更审阅

Status: Verified
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench long-page editing, change review
Severity: P1
Reported: 2026-08-02

### Feedback
用户在字段长列表里修改 `row_id` 的 `人工描述 (Human)` 后，需要下拉很久才能看到旧的 `变更详情`；且 `本次变更` 只显示 `字段描述 修改 1`，不能清晰回答“哪个字段变了、改了什么”。最有价值的 raw Diff 被藏在 `高级：查看原始 Diff` 里。

### Evidence
- User scenario: edit `row_id` Human to `这是一个段测试`.
- Browser check before latest fix confirmed the old `变更详情` was below the field list and import/export section, and summary did not name `row_id`.
- Browser check after latest fix confirmed the right rail summary shows `字段 row_id · 人工描述：空 -> 这是一个段测试`, and default-visible YAML Diff includes the `human: 这是一个段测试` line.

### Expected
Long-page editing must keep change review close to the user:

- Editing any field should update a sticky review surface without requiring the user to scroll to the page bottom.
- `本次变更` must name the changed object when available, such as field / metric / segment name.
- Field description changes must show old value and new value, with empty values rendered explicitly as `空`.
- Raw YAML Diff or equivalent evidence is visible by default in the review surface; it is not hidden behind an advanced disclosure.
- Save / validation status remains available but does not replace object-level change explanation.

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. Switch to the `字段` tab.
3. Locate `row_id` and change `人工描述 (Human)` to `这是一个段测试`.
4. Verify `变更审阅` remains visible without scrolling to the old page-bottom details area.
5. Verify `本次变更` includes `字段 row_id` and shows the old / new Human values.
6. Verify `YAML Diff` is visible by default and includes `human: 这是一个段测试`.
7. Scroll near the bottom of the long page and verify `变更审阅` remains visible.

### Notes
Fixed in `webui/src/pages/TableEditor.tsx`, `webui/src/app/app.css`, and `webui/src/__tests__/table-editor.test.tsx`; tests cover object-level field summary and the sticky review surface. Verified in browser on 2026-08-02 after Docker rebuild: changing `row_id` Human to `这是一个段测试` updates `变更审阅` with `字段 row_id · 人工描述：空 -> 这是一个段测试`, shows default `YAML Diff`, and the review rail remains visible after scrolling to the long-page bottom.

## UX-CATALOG-018: 语义资产分组标题强制大写 Connection / Schema 标识符

Status: Verified
Route: `/catalog`
Area: Semantic asset table group headers
Severity: P2
Reported: 2026-08-03

### Feedback
`/catalog` 的分组标题把 Connection ID 和 Schema 名视觉上转成全大写，例如 `DEMO-MYSQL` / `DATAFORAI`，与表名链接、维护语义 aria-label、URL 和 `/connections` 页面中的源字符串大小写不一致。

### Evidence
- Browser check 2026-08-03 after Docker rebuild: `/catalog` group row shows `连接：demo-mysql · Schema：dataforai（共 3 张表）`; no `DEMO-MYSQL` / `DATAFORAI` uppercase fragments are visible; row links preserve `/catalog/demo-mysql/dataforai/...` and carry `translate="no"` / `notranslate`.
- Cross-page companion: [`UX-CONNECTIONS-022`](connections.md#ux-connections-022-启用表范围分组标题强制大写-connection--schema-标识符).

### Expected
语义资产页所有用户可见的 Connection ID / Schema 名都必须保留仓库源字符串大小写，不得通过 JavaScript 或 CSS 强制 upper / lower / capitalize。分组标题、链接文案、aria-label 和 URL 风格应一致，且数据库对象名节点必须带 `translate="no"` 和 `notranslate`。

### Browser Check
1. Open `/catalog`.
2. Verify the group heading shows `连接：demo-mysql · Schema：dataforai（共 3 张表）`.
3. Verify the page does not visually show `DEMO-MYSQL` or `DATAFORAI`.
4. Verify table links preserve `/catalog/demo-mysql/dataforai/...`.
5. Verify group heading and object links have `translate="no"` and `notranslate`.

### Notes
2026-08-03 M62 source state removes `toUpperCase()` from `Catalog.tsx`. Browser verification passed against the rebuilt Docker for `/catalog`; the remaining focused missing-Manifest casing issue is tracked under `UX-CONNECTIONS-022`. 2026-08-03 二次 Docker `--no-cache` 重建后复核：`UX-CONNECTIONS-022` 升级为 `Verified`，全链路（`/connections` 卡面、`/connections/enabled-tables` 默认 / 缺失 Manifest 诊断 / Schema 下拉、`/catalog` 分组标题）保持仓库源字符串大小写；本条保持 `Verified` 不再变更。

## UX-CATALOG-019: 表名列链接字重过粗与结构列对比产生视觉断层

Status: Verified
Route: /catalog
Area: Catalog table row body
Severity: P2
Reported: 2026-08-03

### Feedback
表名 link 列使用 `font-weight: 500`，与同行的结构列（12px / muted / 400）、更新时间列、Agent 引用列拉开明显视觉层级，让用户感觉表名是"标题"，结构列变成"副文字"，整体表格信息密度失衡。

### Evidence
- 2026-08-03 browser check at `http://127.0.0.1:55176/catalog`：`superstore_orders`、`superstore_people` link 文字明显比 `字段 8 / 关联 1 / 指标 9` 结构列、`3 个` Agent 引用、`2026-07-01 10:30` 更新时间更粗。
- `webui/src/app/app.css:677` 命中 `.pl-catalog-table-name-link { @apply text-sm font-medium ... }`。

### Expected
表名 link 与同行正文（结构、Agent 引用、更新时间）保持同一信息等级，hover / focus 仍可被识别为 link；表头 `font-semibold` 继续作为列名层级保留。

### Browser Check
1. Open `/catalog`.
2. Verify `superstore_orders` / `superstore_people` link 视觉权重与结构列、Agent 引用、更新时间列相同（不再显著更粗）。
3. Verify hover 时仍出现下划线 / focus ring。
4. Verify link 仍含 `translate="no"` 与 `notranslate` 翻译防御。

### Notes
Fixed by M64 in `webui/src/app/app.css`（`.pl-catalog-table-name-link` 改为 `font-normal`）和 `webui/src/__tests__/catalog.test.tsx`（新增 `Catalog table-name visual weight (M64)` describe block，断言 `.pl-catalog-table-name-link` 不再含 `font-medium` / `font-semibold` / `font-bold`，同时验证 `thead th` 仍保留 `font-semibold` 列名层级）。Non-browser 验证通过：`npm test -- src/__tests__/catalog.test.tsx`（16/16）、`npm run lint:terminology`、`npm run build`、`git diff --check`。

Browser verification passed on 2026-08-04 after Docker rebuild at `http://127.0.0.1:55176/catalog`. inspect observed: `superstore_orders` / `superstore_people` / `superstore_returns` links all rendered at identical `rect height=20` and identical column widths (`x=309, width=173`), no horizontal overflow; source `Catalog.tsx:241` keeps `className="pl-catalog-table-name-link notranslate"` + `translate="no"` and `app.css:683` rule reads `@apply text-sm font-normal text-fg-default no-underline hover:underline`（`font-medium` 字面已移除）; table headers still marked as `font-semibold` 列名层级.

## UX-CATALOG-020: Catalog table thead 与 body 对比偏弱，长滚动后失去列名参照

Status: Open
Route: /catalog
Area: Catalog table header / sticky behavior
Severity: P3
Reported: 2026-08-04

### Feedback
Catalog 表格 `<thead>` `<th>` 是 `font-semibold text-fg-muted`，与 body 链接 / 文本主要靠 font-weight 区分。当表格行数变多（如未来 `dataforai` schema 超过 20 张表）向下滚动后，`<thead>` 离开 viewport，用户只能凭记忆对照列名。当前列名密集（表名 / 结构 / Agent 引用 / 语义更新时间 / 操作），列含义不止一个英文 token（如 `字段 30 / 关联 0 / 指标 4`），记忆负担偏高。

### Evidence
- 2026-08-04 browser check at `http://127.0.0.1:55176/catalog`：当前 demo 数据仅 3 张表，body 不滚动；但 M64 把表名链接字重收敛后视觉信号只剩 thead 的 font-semibold + muted color，差异有限。
- `webui/src/pages/Catalog.tsx` 命中 `<thead>` 与 `<th>`，未配置 sticky 行为。
- 与 README 跨页面主题索引中 `font-weight consistency` 主题相关——M64 收敛后需要新视觉锚点补偿 thead 角色。

### Expected
- `<thead>` 在表格区域滚动时保持 sticky top（仅在表格容器自身可滚动时；不是全局 window scroll）。
- `<thead>` 与 body 之间加底边框（`border-b border-fg-muted/30` 或类似），与 M64 收敛后的 font 差异叠加形成 thead 视觉锚点。
- 滚动时 thead 不遮挡操作列 / 第一行的 hover 状态；如有冲突优先 thead 透明度而非取消 sticky。
- 不动表格列定义顺序与字段内容，只补 thead 视觉与 sticky。

### Browser Check
1. Open `/catalog` 并将表格扩展到 ≥20 行（fixture 注入或 zoom）。
2. 向下滚动表格区域超过一屏。
3. Verify `<thead>` 仍可见且列名清晰。
4. Verify thead 与 body 之间有明显视觉分隔（边框或颜色对比）。
5. Verify thead 不遮挡第一行的 hover 反馈。

### Notes
2026-08-04 由 M64 浏览器复核发现并登记，等候选 wave（M66 候选）排期。建议修复文件：`webui/src/pages/Catalog.tsx`（`<thead>` 加 `sticky top-0 z-10 bg-bg-surface`）+ `webui/src/app/app.css`（`.pl-catalog-table thead th { @apply border-b border-fg-muted/30 bg-bg-surface; }`）+ `webui/src/__tests__/catalog.test.tsx`（新增 describe 块断言 thead 含 sticky / 底边框 className）。

## UX-CATALOG-021: 单表页 `校验` 按钮样式弱于 `导入/导出`，用途未在 UI 中说明

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench header actions
Severity: P2
Reported: 2026-08-04

### Feedback
右上角 `导入 YAML`、`导出 YAML`、`校验`、`保存` 四个按钮设计风格不统一：`保存` 最高频用 `primary`（黑底白字）可以认同，但 `校验` 为什么和 `导入`/`导出` 不一致？`校验` 的用途是什么？

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-021.png`
- 代码定位：`webui/src/pages/TableEditor.tsx:1504-1515`。`导入 YAML`、`导出 YAML` 均为 `className="pl-btn pl-btn--secondary"`；`校验` 为 `className="pl-btn pl-btn--ghost"`；`保存` 为 `className="pl-btn pl-btn--primary"`。
- 样式定义：`webui/src/app/app.css:638-640`：`--secondary` 有 `border border-border-default`，`--ghost` **无边框**（`text-fg-default hover:bg-bg-muted`）。因此肉眼上 `校验` 比 `导入`/`导出` 视觉权重更弱、更不像同一个 action group 的并列动作。
- 浏览器复核（2026-08-04）：四个按钮中 `导入 YAML`/`导出 YAML`/`校验` 均为白底文字，但 `校验` 缺少边框，和另外两个并列动作视觉不统一；`保存` 黑底白字最显眼。
- 用途核查：`handleValidateCurrent`（`TableEditor.tsx:1392-1405`）会先对当前表单或已导入 YAML 生成 dry-run 预览，再调用 `POST /api/sources/:conn/:schema/:table/validate` 触发后端 `validate` 校验（语义 YAML 结构/语法/未知 Key 等静态检查），结果写入右侧 `变更审阅 -> 校验` tab 并弹 toast。浏览器点击复核：点击后右侧面板自动切到 `校验` tab，显示 `Validate 未通过` / `Exit Code: 1` 等信息，但**页面上没有任何文案说明"校验"是做什么检查、和"保存"的关系**（例如：保存前是否会自动校验、校验失败是否会阻止保存）。

### Expected
按 `webui/docs/design-system/10-components-button.md` §2/§3 的语义规则：
- `导入 YAML`、`导出 YAML`、`校验` 是同一 action group 内的并列维护动作（都不是"唯一推荐下一步"），三者应统一为 `secondary`（同边框、同尺寸）；`保存` 保留唯一的 `primary`。
- `校验` 按钮需要可发现的用途说明：建议加 `title`/`aria-describedby` tooltip，文案说明"对当前草稿运行语义 YAML 结构与规则校验，不写入文件；保存前会自动执行同等校验"（以实际后端行为为准），避免用户误以为它和"保存"功能重复或无关。
- 如果产品决策认为"校验"使用频率低于"导入/导出"，也应通过尺寸或分组位置表达优先级差异，而不是用不同的边框语义（`ghost` vs `secondary`）表达，避免语义被误读为"不同类动作"。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
2. 用 CDP 读取 `导入 YAML`/`导出 YAML`/`校验` 三个按钮的 computed border，确认三者一致。
3. Hover/focus `校验` 按钮，确认出现说明其用途的 tooltip 或可访问文案。
4. 点击 `校验`，确认右侧 `变更审阅` 面板反馈与文案能让用户理解"这是静态校验，不等于保存"。

### Notes
本条目为核查记录，尚未修复，等待纳入实现排期。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-022: `基础语义` 表描述只回写/展示 Human，未提示存在 AI 建议且未展示 AI 描述内容

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench, overview tab
Severity: P1
Reported: 2026-08-04

### Feedback
`基础语义` 卡片中，表描述看 YAML 文件对应的是 `human`，但没有看到相应的提示，也没有显示 YAML 中 `ai` 部分。需评估是故意设计还是 bug。

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-022-023.png`
- 代码定位：`formFromSource`（`webui/src/pages/TableEditor.tsx:78-89`）表描述初始值固定取 `source.model.descriptions.human ?? ""`；`overview` tab 渲染（`TableEditor.tsx:1581-1595`）只有一个 `<label><span>表描述</span><textarea .../></label>`，没有任何文案说明这是 human 字段，也没有渲染 `source.model.descriptions.ai`。
- 对比：同一文件的字段级 `FieldCard`（`TableEditor.tsx:393-488`）明确按"物理注释 (DB)"/"AI 建议描述"/"人工描述 (Human)" 三段分桶展示，且有"采纳 AI 描述"按钮——这正是截图中 `row_id` 字段卡片的设计。表级表描述完全没有复用这套模式。
- 浏览器复核（2026-08-04）：`表描述` 是一个空白 textarea，无提示文字，也无法看到 AI 建议的表级描述。
- 结论：**不是故意设计，是遗漏**——字段级已经建立"DB / AI / Human 三段式"的清晰心智，表级描述却退化为单一文本框，是同一页面内的模式不一致，会让用户误以为"表描述"框里编辑的就是全部描述来源，也无法感知是否存在可采纳的 AI 建议。

### Expected
表级 `表描述` 复用字段级 `FieldCard` 的三段式描述模式（或其轻量版）：
- 明确标注当前编辑框是"人工描述 (Human)"，说明保存后写入 `descriptions.human`。
- 如果 `source.model.descriptions.ai` 存在，展示只读的"AI 建议描述"区块，并提供"采纳 AI 描述"按钮（复用 `adoptAiDescription` 同类逻辑）。
- 如果 `source.model.descriptions.db`（物理注释）存在，同样展示，保持与字段卡片一致的信息层级。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`，停留在 `基础语义` tab。
2. Verify `表描述` 区域展示三个来源分区：物理注释 (DB) / AI 建议描述 / 人工描述 (Human)，与字段卡片视觉语言一致。
3. 若该表 `descriptions.ai` 有值，verify 出现"采纳 AI 描述"按钮，点击后人工描述文本框被填充为 AI 文本。
4. 若 `descriptions.ai` 为空，verify 显示"无 AI 建议"占位徽章（与字段卡片行为一致）。

### Notes
本条目为核查记录，尚未修复，等待纳入实现排期。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-023: `行粒度` 使用自由文本输入，应从当前表字段中选择

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench, overview tab
Severity: P1
Reported: 2026-08-04

### Feedback
`基础语义` 卡片，行粒度应该是从当前表字段中选择，而非人工输入。

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-022-023.png`
- 代码定位：`webui/src/pages/TableEditor.tsx:1587-1593`：`<input className="pl-input" placeholder="customer_id, signup_date" value={form.grain} .../>`，是纯文本输入框，用逗号分隔多个字段名，靠用户手打字段名。
- `patchFromForm`（`TableEditor.tsx:91-96`）把这个自由文本按逗号 split 后直接写入 `patch.grain` 数组，**没有任何校验这些名字是否真实存在于 `source.model.columns` 中**——用户可能拼错字段名或输入已删除的历史字段名，保存后语义层会静默写入一个无效的 grain。
- 浏览器复核（2026-08-04）：`行粒度` 输入框当前值为 `row_id`（纯文本），placeholder 为 `customer_id, signup_date`，确认是自由文本、非下拉/多选。

### Expected
`行粒度` 改为从当前表字段列表中多选，而不是自由输入：
- UI 形式：多选下拉（combobox + 已选 chips），选项来源为当前表的 `source.model.columns`（可优先把 `pk` 字段排在候选前列）。
- 保留对已保存但字段已被删除的历史 grain 值的兜底展示（例如标红或标注"字段已不存在"），避免静默丢失用户既有配置的可见性。
- 保存时 `patch.grain` 只包含来自真实字段名的值，杜绝手打拼错导致的无效语义。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`，停留在 `基础语义` tab。
2. Verify `行粒度` 不再是纯文本框，而是可从当前表字段列表中选择/取消选择的多选控件。
3. 尝试选择两个字段，verify 保存后 `semantic-layer/.../superstore_orders.yaml` 的 `grain` 数组精确等于所选字段名。
4. 若可行，验证输入框不再允许输入任意不存在于字段列表的文本。

### Notes
本条目为核查记录，尚未修复，等待纳入实现排期。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-024: `字段` 卡片纵向堆叠冗余，长列表滚动负担重，选择 checkbox 意义不明显

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench, columns tab
Severity: P1
Reported: 2026-08-04

### Feedback
`字段` 卡片中，当前每个字段的卡片设计排列过于冗余，导致要下拉很长才看得到，请重新优化布局，参考数据库常见的表格形式，不挑战用户的使用习惯，但又增强了语义扩展能力。比如 `row_id` 前的选择按钮没有看出意义。

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-024.png`
- 代码定位：`FieldCard`（`webui/src/pages/TableEditor.tsx:393-488`）每个字段渲染成一个 `<article>` 卡片，纵向堆叠三个 `pl-description-bucket`（物理注释 / AI 建议描述 / 人工描述），每个 bucket 都占独立整行，人工描述还是一个 `rows={3}` 的 textarea。
- 浏览器复核（2026-08-04）：该表约 30 个字段，`row_id` 单个卡片约占视口高度的 1/3，需要多次大幅滚动才能看完全部字段；卡片左上角的 checkbox 未选中态视觉很小、不显眼。
- checkbox 用途核查：`onSelectedChange`（`TableEditor.tsx:396,406,1680`）配合 `pl-field-batch-toolbar`（`TableEditor.tsx:1634-1665`）实现"全选筛选结果 / 清空选择 / 批量采纳 AI 描述"（`batchAdoptAiForSelectedFields`，`TableEditor.tsx:1294-1321`）——**checkbox 确实有明确用途（批量采纳 AI 描述），但 UI 上没有任何提示告诉用户"勾选是为了批量操作"**，导致用户以第一眼看不出意义。

### Expected
- 布局改为数据库常见的**表格形式**（贴合 `webui/docs/design-system/11-components-data-grid.md`）：一行一个字段，列为 `选择 | 字段名 (+ PK/类型/Not Null 徽章) | 物理注释 (DB) | AI 建议描述 (+ 采纳按钮) | 人工描述 (Human)`；人工描述列可用单行输入 + 点击展开为多行编辑（或行内可展开 disclosure），而不是默认给每个字段留 3 行 textarea 空间。
- 选择列固定窄列（参照数据网格规范 `48~64px`），保留现有"全选筛选结果 / 清空选择 / 批量采纳 AI 描述"批量操作语义，但在筛选/批量工具条上补充简短说明（例如小字"勾选后可批量采纳 AI 描述"），或在 checkbox 的 `aria-label`/tooltip 中说明用途，弥补"没看出意义"的问题。
- 保留现有"语义扩展能力"（AI/Human/DB 三段展示、PK/类型/Not Null 徽章、搜索、筛选模式），只改变呈现密度，不减少信息维度。
- 长列表下建议表头 sticky（类比 `UX-CATALOG-020`），保证滚动中仍能对照列名。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`，切到 `字段` tab。
2. Verify 30 个字段以表格行形式展示，同屏可见字段数量明显多于当前卡片布局（例如同一视口至少可见 8~10 行）。
3. Verify 选择列 checkbox 附近或工具条上有可发现的用途说明。
4. Verify 现有筛选模式、搜索、批量采纳 AI 描述、单字段"采纳 AI 描述"功能均保留可用。
5. Verify 人工描述仍可编辑多行文本（可通过展开/聚焦触发多行态）。

### Notes
本条目为核查记录，尚未修复，等待纳入实现排期。改造建议同时新增 `webui/src/__tests__/table-editor.test.tsx` 断言：字段列表根节点使用表格语义（`role="table"` 或 `<table>` + `pl-data-grid` 基类），选择列 checkbox 具备可发现的用途说明。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-025: `指标`/`分群` 卡片提示文案只讲写入路径，缺少"为什么要维护"的业务价值说明

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench, measures/segments tabs
Severity: P2
Reported: 2026-08-04

### Feedback
`指标` 卡片中，"修改将写入 semantic-layer/<conn>/<table>.yaml 的指标段，与基础表定义分离" 是有业务含义的，但还缺少"为什么需要维护指标、指标对语义有何业务价值"的描述。同理，分群、关联也需要。

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-025-measures.png`, `../assets/catalog/UX-CATALOG-025-segments.png`
- 代码定位：`webui/src/pages/TableEditor.tsx:1603`（指标 tab）：`<p ...>修改将写入 semantic-layer/&lt;conn&gt;/&lt;table&gt;.yaml 的指标段，与基础表定义分离。</p>`；`TableEditor.tsx:1617`（分群 tab）文案结构完全相同，只换了"指标段"为"分群段"。
- 浏览器复核（2026-08-04）：两个 tab 的提示语确认只说明"写入哪个文件的哪个段"，未回答"为什么要在这张表上定义指标/分群""定义后谁会用到、用在什么场景"。
- `关联` tab（`TableEditor.tsx:1690-1711`）提示语是"正式关联关系仍在关联关系页面维护，这里只展示当前表上下文"，同样只讲机制、不讲价值——与 Feedback 第 6 点一并核查（见 `UX-CATALOG-026`）。

### Expected
`指标`/`分群`（以及 `关联` 的说明文案，如果 `UX-CATALOG-026` 决定保留独立入口）在现有"写入路径"说明之外，补充一句业务价值说明，例如（措辞以产品口径最终确认为准）：
- 指标：说明"指标"是可复用的聚合口径（如 GMV、订单量），定义后可被数据问答、BI 报表等下游消费复用，避免每次分析重复手写口径。
- 分群：说明"分群"是可复用的筛选条件（如高价值客户、异常订单），定义后同样可被下游复用，保证跨场景口径一致。
- 文案应遵循 `webui/docs/design-system/00-principles.md` 等既有规范中"避免把实现细节当业务说明"的要求（参考 `UX-CATALOG-015` 的反面教训：不要把研发 spec 说明写成大段文字），用一到两句短句表达价值，而不是段落级设计说明。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`，切到 `指标` tab。
2. Verify 提示文案除写入路径外，包含一句指标业务价值说明。
3. 切到 `分群` tab，verify 同样包含分群业务价值说明。
4. Verify 新增文案通过术语 lint（`npm run lint:terminology`），且不超过 1~2 句短句长度。

### Notes
本条目为核查记录，尚未修复，等待纳入实现排期。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-026: `关联` 维护是独立跳转页面，与当前表编辑上下文割裂

Status: Fixed
Route: /catalog/demo-mysql/dataforai/superstore_orders, /joins/demo-mysql/dataforai/superstore_orders
Area: Table semantic asset workbench, joins tab, JoinEditor page
Severity: P1
Reported: 2026-08-04

### Feedback
`关联` 的配置是独立的页面，建议合并到一起，不要通过"打开关联关系"跳转。

### Evidence
- Screenshot: `../assets/catalog/UX-CATALOG-026.png`
- 代码定位：`webui/src/pages/TableEditor.tsx:1689-1711`（`joins` tab）只读展示 `source.model.joins`（已确认关系），并提供 `<Link to={`/joins/${conn}/${schema}/${table}`}>打开关联关系</Link>`（`TableEditor.tsx:1693-1698`）跳到独立路由。
- 独立页面：`webui/src/pages/JoinEditor.tsx`（路由注册于 `webui/src/app/App.tsx:375`）额外拉取 `/api/joins/candidates`（候选关联，来自字段名启发式 + `.ktx-ui` sidecar），提供"已确认关系"、"候选关系"两个区块，以及"保留为候选/标记为不采用/确认写入语义层"三个操作。
- 浏览器复核（2026-08-04）：点击"打开关联关系"后 URL 从 `/catalog/...` 变为 `/joins/...`，是完全独立的页面（不同 Header、不同面包屑），维护完成后需要用户再手动返回 `/catalog/...` 才能继续编辑其他语义内容，割裂了单表编辑的连续心智。
- 需注意的历史背景：`UX-CATALOG-011`（同一文档 2026-08-02 记录）曾把"候选关联建议"从表页整体移除，理由是"候选关系机制只是字段名启发式，容易误导用户以为是强语义推断"，当时的处理方式正是把候选关联维护整体收进独立的 `/joins` 页面，而不是删除功能。本条反馈与 `UX-CATALOG-011` 的解决方向直接冲突，需要产品侧重新权衡。

### Expected
两种可行方向，需产品决策后二选一（不建议在无决策的情况下直接改代码）：
1. **合并方向（贴合本条反馈）**：把 `JoinEditor` 的"已确认关系"、"候选关系"两个区块内嵌进 `TableEditor` 的 `关联` tab，移除独立路由跳转；候选关系的"启发式/非强语义"性质通过 tab 内的说明文案表达（呼应 `UX-CATALOG-011` 的顾虑），而不是通过物理隔离到另一个页面来回避风险。
2. **保留独立入口但降低割裂感**：如果保留独立页面有其他架构原因（例如候选关联候选池是跨表维度而非单表维度、未来要在多个表之间比较候选关联），则至少在 `JoinEditor` 页面加回"返回表编辑"式的强绑定导航，且明确说明"为什么关联要单独维护"（同 `UX-CATALOG-025` 的业务价值说明要求），并在 `关联` tab 增加候选关系数量提示，而不是让用户点开才发现"当前表还没有正式关联关系"。

无论选择哪个方向，都需要先解决与 `UX-CATALOG-011` 的历史决策冲突，避免来回反复。

### Browser Check
（决策后按选定方向补充；若选合并方向，验证点包括：`关联` tab 内可直接查看候选关系并执行"保留为候选/标记为不采用/确认写入语义层"，且不再跳转到 `/joins/...`。）

### Notes
本条目为核查记录，尚未修复；与 `UX-CATALOG-011` 存在方向性冲突，建议先由产品侧确认候选关联的最终 IA 归属，再排入实现。

2026-08-04 Spec 73 / wo-202608-06 已落地 host 源码修复（`TableEditor.tsx`、`JoinEditor.tsx`、`app.css`、`table-editor.test.tsx`）。非浏览器验证通过：`npm test -- src/__tests__/table-editor.test.tsx`、`npm run lint:terminology`、`npm run build`、`git diff --check`。本轮按用户约束不做浏览器验证，待后续复核升 `Verified`。

## UX-CATALOG-029: 校验失败只显示 Exit Code，不展示 issues 原因

Status: Fixed
Route: `/catalog/:conn/:schema/:table`
Severity: P1
Reported: 2026-08-06

### Feedback
点击 Header「校验」后，右侧「变更审阅 → 校验」仅显示「Validate 状态 / 未通过」与「Exit Code: 1」，Toast 也只说「Validate 未通过」。用户无法知道错在何处。API 实际已返回 `issues`（本例为 `._dataforai.yaml: Semantic-layer source YAML must contain an object`），前端未渲染。

### Expected
1. 校验未通过时展示「校验问题」列表（优先 `issues`，过滤 `Project:` 噪声）。
2. Toast：`校验未通过：{首条实质问题}`。
3. Exit Code / stderr 放入「技术详情」折叠，不得作为默认主信息。
4. 主术语中文化；说明校验对象为已保存语义层（非未保存草稿）。

### Browser Check
1. Open `/catalog/demo-mysql/dataforai/superstore_orders`（或任意表）。
2. Click Header「校验」with a failing validate response（或现场 `._*` 污染环境）。
3. Verify 右侧「校验」Tab 可见具体文件路径/错误句；无默认主行「Exit Code」。
4. Verify Toast 含首条实质问题；徽章为「校验未通过」而非裸「Validate …」。
5. Expand「技术详情」；verify 可见退出码与原始输出。

### Notes
Spec 110 / `wo-202608-43` 已落地（本轮不做浏览器验证，结束后只做 code review，待复核后升 Verified）。跨页面主题：`validation failure disclosure`。现场根因之一为 AppleDouble `._*.yaml`（P1 环境清理 / P2 ktx 忽略为后续非目标）。
