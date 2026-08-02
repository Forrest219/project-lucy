# 表语义资产工作台命令减噪与结果优先重构 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Product / UX / IA / Accessibility Spec |
| 状态 | Approved for planning |
| 撰写日期 | 2026-08-02 |
| 触发来源 | `/catalog/demo-mysql/dataforai/superstore_orders` 浏览器核查与用户补充反馈 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/42-page-header-standardization-spec.md`、`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`、`webui/docs/50-table-semantic-workbench-ui-ux-hardening-spec.md`、`webui/docs/51-table-semantic-workbench-ia-separation-spec.md`、`docs/DEVELOPMENT.md` |
| 主要页面 | `/catalog/:conn/:schema/:table` |
| 主要文件 | `webui/src/pages/TableEditor.tsx`、`webui/src/app/app.css`、`webui/src/__tests__/table-editor.test.tsx` |

## 1. Background

M48 和 M49 已将表语义资产工作台推进到可编辑、可导入导出、可校验、可保存，并完成了第一轮“语义结果”和“维护手段”分离。

2026-08-02 对 `http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders` 做浏览器核查后，用户继续指出当前维护语义界面仍存在控制台级 UI/UX 问题：

- `导出 YAML`、`导入 YAML` 在页面 header 和 `Claude Code / Codex 辅助维护` 区重复出现。
- `校验`、`保存` 在页面 header 和 `变更状态` Inspector 中重复出现。
- `Claude Code / Codex 辅助维护` 是维护手段，却占据首屏过高空间。
- 核心的字段、指标、分群、关联编辑被包在 `语义内容` 容器和局部侧栏中，形成过深层级。
- 页面直接展示了多句研发 spec 式说明文案。
- 全局 Lucy 侧栏之外，语义内容内部又出现垂直对象树，形成 Double Sidebar。
- `变更状态` 同时承载状态、操作、变更预览和 raw Diff，职责不清。
- Header 左侧重复展示面包屑、表名、Connection / Schema 和页面功能说明。
- Header 右侧 `完成度 done`、`30 字段`、`4 指标`、`3 分群`、`0 关联` 形成状态芯片噪声。

本 Spec 是 M49 的后续收敛版：不再把“辅助维护默认大展开”作为首屏目标，而是要求维护手段可发现、可进入，但不得挤占语义结果编辑主任务。

## 2. Goals

1. 将 Header 收敛为对象身份区，只回答“在哪里、正在编辑谁、是否有关键状态”。
2. 保证同一视口内每个全局命令只有一个主触发点。
3. 将 `语义内容` 升级为页面主编辑区，而不是卡片内折叠块。
4. 将 `Claude Code / Codex 辅助维护` 降级为维护手段入口，入口清楚但不抢占首屏。
5. 删除生产 UI 中的研发 spec 式说明文案。
6. 移除语义内容内部的第二侧栏，避免 Double Sidebar。
7. 将 `变更状态` Inspector 改为纯反馈区；变更详情和 raw Diff 进入独立详情面板。
8. 保留 M48/M49 已完成的键盘可访问性、隐藏 File Input、字段批量操作、删除待处理建议等约束。

## 3. Non-goals

- 不改变 `semantic-layer/<conn>/<table>.yaml` overlay 写入规则。
- 不改变导出、导入、dry-run、validate、save API contract。
- 不新增在线 LLM 生成语义能力。
- 不恢复 `待处理建议（N）` 候选关联区。
- 不新增移动窄屏专项体验，除非后续计划明确要求。
- 不引入新的设计系统或组件库。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

Protected terms:

- `Connection`
- `Schema`
- `Catalog`
- `YAML`
- `semantic-layer`
- `overlay`
- `Claude Code`
- `Codex`
- `Diff`
- `Validate`
- `Dry-run`
- `Unknown YAML Key`

包含上述术语、数据库对象名、文件路径、URL、YAML 内容的 DOM 节点必须使用 `translate="no"` 和 `notranslate`。

Terminology decisions:

- 单表页的对象身份主标题是表名，例如 `superstore_orders`。
- `Claude Code / Codex 辅助维护` 是维护手段，不是语义结果分组。
- `语义内容` 是维护结果，不得再被描述成“高级”或“手工维护”的辅助路径。
- `变更状态` 是反馈区，不是操作区。
- Header 不展示 `完成度 done` 这类内部状态文案；如需状态，使用面向用户的 `有未保存变更`、`校验通过`、`保存失败` 等。

## 5. Current Browser Findings

Browser validation target:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Observed at desktop viewport:

1. Header 左侧包含完整面包屑、H1、Connection / Schema 和功能说明：
   - `语义资产 / demo-mysql / dataforai / superstore_orders`
   - `superstore_orders`
   - `demo-mysql / dataforai`
   - `导出、导入、校验并审阅当前表的 semantic-layer YAML。`
2. Header 右侧显示 `完成度 done`、`30 字段`、`4 指标`、`3 分群`、`0 关联`，这些数量又会在语义内容导航或分区中出现。
3. `导出 YAML`、`导入 YAML` 同时存在于 Header 和辅助维护区。
4. `校验`、`保存` 同时存在于 Header 和 `变更状态` 区。
5. `Claude Code / Codex 辅助维护` 首屏占用过高，并包含说明文案、按钮、粘贴入口、导入文件和影响文件状态。
6. `语义内容` 内部出现 `返回语义资产`、`同 Schema 表`、`当前表`、`基础语义`、`字段`、`指标`、`分群`、`关联` 垂直对象树，与全局左侧导航冲突。
7. `变更状态` 同时包含状态说明、`校验`、`保存变更`、`Diff`、`YAML`、`Validate`、`变更预览`、`高级：查看原始 Diff`。
8. Browser console 未发现新的 error / warning。

## 6. Target IA

Target structure:

```txt
PageHeader
  Breadcrumb: 语义资产 / demo-mysql / dataforai
  H1: superstore_orders
  Context: demo-mysql / dataforai
  Critical state only: 有未保存变更 / 校验通过 / 保存失败

Sticky Command Bar
  校验
  保存

Main Editor
  Tabs: 基础语义 · 字段 30 · 指标 4 · 分群 3 · 关联 0
  Active tab content

Auxiliary Maintenance
  Compact entry: Claude Code / Codex 辅助维护
  Drawer or compact disclosure:
    导出 YAML
    导入 YAML
    粘贴 YAML
    导入文件
    影响文件
    Dry-run result

Change Status
  Pure feedback:
    dirty state
    validation state
    Dry-run file count
    Unknown YAML Key count
    save pending/error

Change Details
  Drawer or panel:
    变更预览
    Diff
    YAML
    Validate
    raw Diff
```

The implementation MAY place the command bar at top or bottom depending on existing layout, but global commands MUST NOT appear in multiple places in the same viewport.

## 7. UX Requirements

### 7.1 Header 只承载身份与关键状态

Requirements:

- Header H1 MUST show the current table name, e.g. `superstore_orders`.
- Breadcrumb SHOULD stop before the current table, e.g. `语义资产 / demo-mysql / dataforai`, to avoid repeating the table name twice.
- Header context MAY show `demo-mysql / dataforai` once near the H1.
- Header MUST remove the page function explanation:
  - `导出、导入、校验并审阅当前表的 semantic-layer YAML。`
- Header MUST remove low-value summary chips:
  - `完成度 done`
  - `30 字段`
  - `4 指标`
  - `3 分群`
  - `0 关联`
- If dirty / validation / save status is needed in Header, use one compact critical state label only.

Acceptance:

- `superstore_orders` appears as the table H1.
- The header does not repeat `superstore_orders` in both breadcrumb and H1.
- `导出、导入、校验并审阅当前表的 semantic-layer YAML。` is not visible.
- `完成度 done` is not visible.
- Header does not expose `字段 / 指标 / 分群 / 关联` count chips.

### 7.2 每个全局命令只有一个主触发点

Requirements:

- `导出 YAML` MUST appear only in the `Claude Code / Codex 辅助维护` command surface.
- `导入 YAML` MUST appear only in the `Claude Code / Codex 辅助维护` command surface.
- `校验` and `保存` MUST appear only in the sticky command bar or only in the Header; recommended placement is a sticky command bar outside Inspector.
- `变更状态` Inspector MUST NOT contain operation buttons.
- If responsive layout moves a command surface, it must move the same DOM/control surface rather than render duplicate controls with the same visible label.

Acceptance:

- In the first viewport, visible `导出 YAML` count is `1`.
- In the first viewport, visible `导入 YAML` count is `1`.
- In the first viewport, visible `校验` count is `1`.
- In the first viewport, visible `保存` / `保存变更` global save trigger count is `1`.
- User-visible controls do not require aria label disambiguation to compensate for duplicate visible commands.

### 7.3 语义内容成为主编辑区

Requirements:

- `语义内容` MUST be the main page body, not a secondary card inside a card.
- `语义内容` SHOULD NOT be a collapsible disclosure at the top level.
- Replace the internal vertical object tree with horizontal tabs or a compact segmented control:
  - `基础语义`
  - `字段 30`
  - `指标 4`
  - `分群 3`
  - `关联 0`
- Counts MAY appear as tab badges because they support local navigation, but they MUST NOT duplicate in Header.
- `同 Schema 表` navigation SHOULD move to breadcrumb, a compact switcher, or the Catalog return path.
- The main editor should be visible within the first viewport without requiring users to pass through the auxiliary maintenance block.

Acceptance:

- There is no inner left sidebar containing `返回语义资产 / 同 Schema 表 / 当前表`.
- The global Lucy sidebar is the only sidebar in the normal desktop view.
- Field and metric editing are reachable from top-level tabs or equivalent controls.
- `语义内容` is visually the primary work area.

### 7.4 辅助维护入口清楚但不抢首屏

Requirements:

- `Claude Code / Codex 辅助维护` remains discoverable on page load.
- The detailed YAML exchange workflow SHOULD be a compact disclosure or drawer, not a large first-screen panel.
- The visible collapsed/compact state MAY show a one-line summary:
  - `辅助维护`
  - `导出 / 导入 / 粘贴 YAML`
  - latest Dry-run state
- `导入文件` and `影响文件` belong inside the auxiliary maintenance surface, left-aligned with YAML actions.
- The auxiliary surface MUST NOT include explanatory paragraphs that describe implementation intent.

Acceptance:

- The first viewport gives more vertical space to semantic editing than to auxiliary maintenance.
- `导入文件` and `影响文件` are not centered detached metadata.
- The page still supports export, import, paste and Dry-run preview.

### 7.5 删除研发 spec 式 UI 文案

Requirements:

- Remove visible explanatory copy:
  - `主流程：导出 YAML，交给 Claude Code / Codex 完善，再导入当前表 YAML 进行 dry-run 校验。`
  - `维护结果会统一写入当前表语义内容；Claude Code / Codex 和页面编辑只是不同维护方式。`
  - `长页面编辑时保持校验和保存状态可见。`
- Replace necessary help with concise labels, tooltips, or help icons.
- UI copy must describe objects and actions, not justify design decisions.

Acceptance:

- The three phrases above are not visible in browser or Testing Library assertions.
- No new paragraph-length implementation rationale is added to the production UI.

### 7.6 Inspector 纯反馈化

Requirements:

- `变更状态` MUST show only status feedback:
  - dirty state
  - validation state
  - Dry-run count
  - Unknown YAML Key count
  - save pending / error
  - latest affected file count
- Move `变更预览` to a separate `变更详情` drawer, panel, or tabbed detail region.
- Move raw `Diff` / `YAML` / `Validate` details out of the sticky Inspector.
- Inspector MUST NOT include `校验` or `保存变更` unless it is the only command surface on the page.

Acceptance:

- `变更状态` does not render operation buttons.
- `高级：查看原始 Diff` is not inside the sticky status card.
- Users can still open a detailed Diff / YAML / Validate view.

### 7.7 Accessibility Requirements

The implementation MUST preserve:

- Keyboard access to all command surfaces.
- Visible focus ring on tabs, disclosure triggers, drawer triggers, and command buttons.
- Hidden native File Input constraints from M48:
  - `aria-hidden="true"`
  - `tabIndex={-1}`
  - no user-visible `Choose File` button.
- `Cmd+S` / `Ctrl+S` behavior from M48.
- `translate="no"` and `notranslate` for database object names, file paths, URLs and protected English terms.

## 8. Testing Requirements

Update `webui/src/__tests__/table-editor.test.tsx`.

Required assertions:

- Header shows the current table H1.
- Header does not show the page function explanation.
- Header does not show `完成度 done`.
- Header does not show duplicated count chips.
- The main editor exposes `基础语义` / `字段` / `指标` / `分群` / `关联` as top-level navigation controls.
- The inner object tree / local sidebar is absent.
- `导出 YAML` appears exactly once.
- `导入 YAML` appears exactly once.
- `校验` appears exactly once.
- `保存` or `保存变更` appears exactly once as the global save command.
- `变更状态` does not contain operation buttons.
- The removed explanatory phrases are absent.
- `待处理建议` remains absent.
- Hidden File Input tests continue to pass.
- Field batch operation tests continue to pass.

## 9. Browser Validation Checklist

Run desktop browser validation at:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Checklist:

- Header is compact and left anchored.
- Header only answers where the user is and which table is being edited.
- No duplicate global commands are visible in the same viewport.
- `Claude Code / Codex 辅助维护` is discoverable but does not dominate the first viewport.
- Semantic editing area is the primary first-screen content.
- No inner sidebar appears inside the main content.
- `变更状态` is pure feedback.
- `变更详情` / raw Diff remains accessible outside the sticky status area.
- Browser console has no warning or error caused by the refactor.

Do not run mobile / narrow viewport validation unless explicitly requested.

## 10. Done Definition

- [ ] Header identity and status density meet this Spec.
- [ ] Command duplication is removed.
- [ ] Semantic content is the primary editor surface.
- [ ] Auxiliary maintenance is compact and secondary.
- [ ] Production UI does not include implementation-rationale paragraphs.
- [ ] Inspector is pure feedback.
- [ ] Tests and terminology lint pass.
- [ ] Desktop browser validation passes for the target URL.
