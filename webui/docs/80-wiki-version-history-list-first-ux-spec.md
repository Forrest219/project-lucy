# Wiki Version History List-First UX Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Version History List-First UX Spec |
| 文档类型 | Spec |
| 版本 | v1.2 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/wiki?key=global%2Fxxx22%2Fdemo-superstore.md`「版本记录」弹窗；用户 5 点反馈；参考 Tableau「修订历史记录」截图；`WikiVersionHistoryDialog.tsx`、`WikiEditor.tsx`、`app.css`；`webui/docs/55-business-wiki-version-history-restore-spec.md`、`webui/docs/74-wiki-workbench-secondary-feedback-fixes-spec.md`；落地后审阅补充（current 契约 / 未知 operation / 边界用例） |
| 适用范围 | 指导 `/wiki`「版本记录」弹窗：列表优先布局、业务化列与操作文案、当前版本操作收敛、历史预览外置为全宽详情的实现与验收 |
| 输出位置 | `webui/docs/80-wiki-version-history-list-first-ux-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 80 |
| 关联工单 | `webui/docs/plans/wo-202608-12-wiki-version-history-list-first-ux.md` |
| 关联页面 | `/wiki`（已选中 Markdown 文档 → 版本记录） |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（新增 `UX-WIKI-031` ~ `UX-WIKI-035`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 修订 Spec 55 §8.2–8.3 与 Spec 74 §9 的**前端展示与交互**；不改版本 API / 快照存储 / 恢复预检契约 |

## 1. 背景

用户对「版本记录」弹窗给出 5 点反馈；浏览器核查（弹窗 1180px、左侧列表约 437px、右侧预览约 681px；操作列约 142px 导致「查看 / 恢复此版本」纵向堆叠；最新行仍可恢复且 Diff 为「暂无可预览的变更」）确认属实：

1. 「历史版本」是核心，但时间 / 操作类型 / 版本 / 操作列拥挤；列名与 `versionId` 哈希缺少业务含义。
2. 「操作类型」值过于技术（如「编辑保存」）。
3. 「操作」列「查看」「恢复此版本」被挤成上下布局，应左右平级。
4. 最新快照（当前正文对应版本）是否应出现、是否仍提供查看 / 恢复。
5. 「历史预览」侧栏默认占位且区域过小；建议默认取消，点「查看」后再看全文与 Diff。

Spec 74 / UX-WIKI-025 已完成表格化与懒加载，但左右分栏仍把列表压窄。本 Spec 收敛为**列表优先 + 详情外置**。

## 2. 目标

1. 「版本记录」弹窗默认只展示全宽「历史版本」表，不再常驻右侧「历史预览」。
2. 表列改为业务可读：`版本`（修订序号 + 当前标记）、`变更说明`、`时间`、`操作`；不在主表暴露原始 `versionId`。
3. 变更说明使用业务文案（见 §5），替代「编辑保存」等技术标签。
4. 「查看」「恢复此版本」在操作列左右平级（`flex-nowrap`），不被挤成上下堆叠。
5. 列表第一行（最新快照）标记为「当前」：不提供「恢复此版本」；不提供「查看」（用户已在阅读当前正文）。
6. 非当前行点「查看」进入同弹窗内的全宽详情态：Markdown 预览 + 与当前版本 Diff；提供「返回版本列表」。

## 3. 非目标

- 不新增 / 不改后端版本 API、快照保留策略、`fs-safe` 边界或恢复预检契约。
- 不引入独立 URL deep-link（如 `?version=`）；本轮用同弹窗列表 / 详情切换。URL 外置可作为后续候选项。
- 不改 Table YAML「版本记录」面板（Spec 56）。
- 不做移动窄屏专项；不做浏览器验证——本轮约束要求收尾只做 code review，验收以 Vitest + `lint:terminology` + `build` 为准。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` and Spec 55 terminology.

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Wiki Version History | 版本记录 | 历史版本 | 历史记录泛化 | 不变 |
| Version Snapshot | 版本快照 | Markdown 快照 | 备份文件作为主术语 | 不变 |
| Revision Label | 修订 N | 修订 N（当前） | 裸 `versionId` 作为主列 | 列表主展示用倒序业务序号 |
| Change Summary | 变更说明 | — | 操作类型（主列表列名） | 列表列名；值见 §5 |
| Restore Version | 恢复此版本 | 恢复到该版本 | 回滚 | 不变 |
| Restore Preflight | 恢复预检 | — | — | 不变 |
| Version Detail | 版本详情 | 历史预览（详情态标题可保留） | 侧栏常驻空预览 | 点「查看」后的全宽态 |

文案要求：

- 主列表列名：`版本`、`变更说明`、`时间`、`操作`。
- 继续使用 `版本记录`、`历史版本`、`恢复此版本`、`恢复预检`。
- `Markdown`、路径、`versionId`、`contentHash` 仅在详情 / 预检等技术上下文出现，并保留 `notranslate` / `translate="no"`。
- 不把「恢复」写成「回滚」。

## 5. 变更说明文案映射

| `operation` | 旧 UI 文案 | 新 UI 文案 |
|---|---|---|
| `create` | 创建 | 新建文档 |
| `edit_save` | 编辑保存 | 在线编辑 |
| `upload_create` | 上传新文档 | 上传新建 |
| `upload_replace` | 上传覆盖 | 上传覆盖 |
| `restore` | 恢复 | 恢复历史版本 |
| `move` | 移动 | 移动到目录 |
| `rename` | 重命名 | 重命名 |
| `delete` | 删除 | 删除 |

有 `sourceFileName` / `restoredFromVersionId` 时，仍可在变更说明单元格内用次要一行展示「来源文件 / 恢复来源」；恢复来源可继续用 `versionId` code（带翻译防御），不升为主列。

**后续加固（非本轮 DoD）**：若后端扩展 `operation` 枚举或读路径出现未登记值，UI 必须有兜底文案（建议「未知变更」），不得渲染空白；实现时与 `OPERATION_LABELS` / 类型联合同步扩展。当前服务端 `safeVersionOperation` 与前端联合类型已拒非法值，现网无触发路径。

## 6. 列表布局与当前版本

### 6.1 布局

- 移除 `.pl-wiki-version-layout` 双栏 grid；弹窗内容区默认只有全宽表格。
- 弹窗宽度可维持现有 `min(1180px, 94vw)` 或略收，但不得再把列表压到半宽。
- `.pl-wiki-version-row-actions` 必须 `flex-nowrap`，保证「查看」「恢复此版本」左右排列。

### 6.2 版本列与「当前」契约

- **API 契约**：`GET /api/wiki/:key/versions` 的 `versions` 必须保持**最新在前**的倒序（实现参考 `listWikiVersions` 对 index 条目 `.reverse()`）。本 Spec 前端以该顺序为事实源。
- **当前快照判定**：前端将 `versions[0]`（列表第一行）视为当前正文对应快照，标记 `修订 {N}（当前）`，并按 §6.3 收敛操作。`N = versions.length - index`（最新 = 最大序号）。
- 若服务端将来改变返回顺序，必须同步修改前端判定，或新增显式字段（如 `currentVersionId`）并改为按字段判定；**禁止**在顺序未声明的情况下继续假设「第一行 = 当前」。
- 主列不渲染原始 `versionId`。

### 6.3 当前行操作

- 当前行（`versions[0]`）：操作列留空（版本列「修订 N（当前）」已表达身份；不渲染冗余「当前」hint）。
- 非当前行：提供「查看」「恢复此版本」；「恢复此版本」仍走既有恢复预检。
- 列表仅 1 条时：该行即为当前，不出现任何查看 / 恢复按钮。
- **表格基线（Spec 83）**：历史版本表必须使用 `pl-data-grid`；操作按钮放在 `td` 内层 flex 容器，不得在 `<td>` 上设 `display:flex`。

## 7. 版本详情态（替代常驻侧栏）

点击非当前行「查看」后：

1. 请求既有 `GET .../versions/:versionId`（父组件既有 query 不变）。
2. 弹窗切换为详情态：标题区可显示「版本详情」或保留「版本记录」并加「返回版本列表」。
3. 全宽展示：变更说明、时间、可选技术 id/hash（弱化）、Markdown 预览、与当前版本 Diff。
4. 「返回版本列表」清空 `selectedVersionId`，回到列表态且不自动再选中；详情错误不得泄漏到列表态错误条。
5. 关闭弹窗时同样清空选中态（既有行为保留）。
6. 详情接口失败：顶栏展示错误；正文不得长期停留在「正在加载」；可返回列表。

详情态不再与列表并排；用户一次只看到列表或详情之一。

## 8. 对既有 Spec 的修订关系

- **修订** Spec 55 §8.2–8.3：列表字段与预览呈现改为本 Spec §6–§7；API / 恢复预检 / 保留策略不变（含 versions 倒序契约，见 §6.2）。
- **修订** Spec 74 §9（UX-WIKI-025）：表格化与懒加载保留；「右侧历史预览」改为「点查看后进入全宽详情」，不再要求左右分栏。

## 9. 验收标准

### 9.1 自动化（本轮 DoD）

- Vitest：打开版本记录 → 表头为 `版本` / `变更说明` / `时间` / `操作`；无常驻「选择一个历史版本查看…」侧栏占位。
- 最新行含「当前」，无 `wiki-version-restore-*` / `wiki-version-view-*`（对应该 versionId）。
- 非当前行「查看」后出现 Markdown 预览与 Diff；可返回列表；「恢复此版本」仍打开恢复预检。
- 变更说明断言含业务文案（如「上传覆盖」「新建文档」），不含「编辑保存」作为主标签（若 fixture 含 `edit_save` 则断言「在线编辑」）。
- `npm run lint:terminology`、`npm run build` 通过。

### 9.2 浏览器（本轮不做）

本轮明确不做浏览器验证；条目状态止于 `Fixed`。后续复核清单见台账 `UX-WIKI-031`～`035` 的 Browser Check。复核通过后宜补 `docs/ui-ux-feedback/assets/wiki/UX-WIKI-031-035-after.png`（或等价 After 成片）。

### 9.3 后续验收（非本轮 DoD）

- 仅 1 个版本：该行标记当前，无查看 / 恢复按钮。
- 版本列表为空：展示既有空态文案，无表体操作列。
- 版本详情接口失败：错误可见、非永久加载文案、可返回列表且列表不再显示详情错误。
- 未知 / 扩展 `operation`：变更说明兜底为「未知变更」（或等价），并扩展类型与映射。

## 10. Design System Compliance

- 引用：Dialog / Table / Button（ghost + secondary）既有 Wiki preflight 模式。
- 遵循：列表优先、动作左右平级、技术 id 不进主列；详情用全宽而非窄侧栏塞 Diff。

## 11. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-08-05 | 初版：列表优先、业务化列、当前行收敛、全宽详情 |
| v1.1 | 2026-08-05 | 审阅补充：`versions[0]` 当前契约、未知 operation 兜底与边界用例写入 §9.3；After 截图挂浏览器复核 |
| v1.2 | 2026-08-05 | Spec 83：当前行操作列留空；表格基线改为 `pl-data-grid`（见 §6.3） |