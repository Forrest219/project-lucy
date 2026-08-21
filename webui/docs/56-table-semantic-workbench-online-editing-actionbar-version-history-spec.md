# Table Semantic Workbench Online Editing, Action Bar, and Version History Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Semantic Workbench Online Editing, Action Bar, and Version History Spec |
| 文档类型 | Product / UX / IA / API / Data Contract / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/catalog/:conn/:schema/:table` |
| 关联工单 | `webui/docs/plans/wo-M54-table-semantic-workbench-online-editing-actionbar-version-history.md` |
| 事实来源 | 2026-08-02 用户反馈、浏览器核查、`docs/ui-ux-feedback/pages/catalog.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/42-page-header-standardization-spec.md`、`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`、`webui/docs/54-table-semantic-workbench-command-density-refactor-spec.md`、`docs/DEVELOPMENT.md` |

## 1. Background

M52 已完成第一轮命令减噪：去掉重复按钮、压缩辅助维护、移除生产 UI 中的研发说明文案，并让
`变更状态` 不再承载操作按钮。但 2026-08-02 对
`http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders` 的浏览器复核与后续反馈确认，当前单表语义工作台仍有更高层的信息架构问题：

- Header 仍显示 `语义资产` 面包屑；对于单表页，`superstore_orders` 才是页面主角。
- Header 副信息只显示 `demo-mysql / dataforai`，缺少 `连接`、`Schema` 这样的提示，过于简约。
- Header 下方又出现 `表语义资产 superstore_orders 校验 保存`，重复对象身份。
- 当前分区顺序是 command bar -> `Claude Code / Codex 辅助维护` -> `语义内容` -> `变更详情` / `变更状态`，和用户主任务优先级相反。
- `Claude Code / Codex 辅助维护` 过度绑定个性化产品名，不适合作为生产 UI 主标题。
- `YAML 交换` 这类抽象命名不可取；用户需要显性理解这是 `在线编辑`。
- `导出 YAML`、`导入 YAML` 是常用资产级动作，和 `校验`、`保存` 应统一在同一个动作模型中，而不是被维护方式分区隔离。
- `变更状态` 的用户价值不清晰，`Dry-run` / `Unknown` 等工程状态不足以解释用户该做什么。
- 当前工作台没有 `版本记录`、历史预览或恢复指定 YAML 版本的能力。

本 Spec 是 M52 的后续收敛：将页面重构为“当前表 Header + 统一动作区 + 在线编辑主任务 + 导入导出辅助能力 + 可恢复版本记录”。

## 2. Goals

1. 让 `superstore_orders` 成为唯一主标题，Header 去掉冗余 `语义资产` 标题感。
2. Header 副信息清楚展示 `连接：demo-mysql` 与 `Schema：dataforai`。
3. 删除独立 command bar 的重复身份文案，统一资产级动作入口。
4. 将 `在线编辑` 作为主编辑区标题和页面第一优先级。
5. 使用产品中立、用户可理解的命名替代 `Claude Code / Codex 辅助维护`。
6. 将 `导出 YAML`、`导入 YAML`、`校验`、`保存` 纳入同一 Header / Action Bar 模型。
7. 弱化或重命名 `变更状态`，只在对用户有价值时展示保存 / 校验反馈。
8. 增加最近 5 版 YAML 的版本记录、历史预览、Diff 对比和恢复指定版本能力。

## 3. Non-goals

- 不新增在线 LLM 自动生成语义内容。
- 不把 Claude Code、Codex 或其他具体 AI 产品作为生产 UI 主术语。
- 不改变表语义 overlay 的作者桶、key 顺序保留、未知字段保留策略。
- 不实现无限版本保留、多人协同冲突解决、审批流或发布回滚。
- 不把历史 YAML 快照纳入 Catalog、Agent 检索或发布候选文件。
- 不做移动窄屏专项体验，除非后续工单明确要求。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Online Editing | 在线编辑 | 在线维护 | YAML 交换 | 单表语义内容的主维护区 |
| Import / Export | 导入 / 导出 | 导入 YAML / 导出 YAML | Claude Code / Codex 辅助维护作为区块标题 | 文件级辅助维护动作 |
| Save Status | 保存状态 | 保存结果 | 变更状态作为重卡片标题 | 面向用户的保存 / 校验反馈 |
| Version History | 版本记录 | 历史版本 | 回滚作为主文案 | 某张表 YAML 最近版本记录 |
| Restore Version | 恢复此版本 | 恢复到该版本 | 回滚 YAML | 将历史 YAML 作为草稿恢复 |
| Version Snapshot | 版本快照 | YAML 快照 | 备份文件作为主术语 | 一次保存或导入后的可恢复内容 |

Protected terms:

- `Connection`
- `Schema`
- `YAML`
- `semantic-layer`
- `overlay`
- `Diff`
- `Validate`
- `Dry-run`
- `Unknown YAML Key`
- table / connection / schema names such as `superstore_orders`, `demo-mysql`, `dataforai`

包含数据库对象名、文件路径、URL、YAML、Diff、hash、version id 的 DOM 节点必须使用
`translate="no"` 和 `notranslate`。

Terminology decisions:

- Header 副信息使用中文标签：`连接：demo-mysql`、`Schema：dataforai`。
- 生产 UI 不再以 `Claude Code / Codex` 命名区块；具体工具可出现在帮助文档或 tooltip 示例中。
- 主编辑区标题使用 `在线编辑`。
- `变更状态` 不再作为高优先级重卡片标题；如保留，应改为 `保存状态` 或 `校验结果`，并用用户可理解状态文案。

## 5. Current Browser Findings

Browser validation target:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Observed desktop state:

1. Header text is `语义资产 superstore_orders demo-mysql / dataforai`.
2. H1 is `superstore_orders`, but breadcrumb still renders `语义资产`.
3. Header context is bare `demo-mysql / dataforai`, without `连接` / `Schema` labels.
4. The next command bar renders `表语义资产 superstore_orders 校验 保存`, duplicating Header identity.
5. Visible section order is:
   - command bar
   - `Claude Code / Codex 辅助维护`
   - `语义内容`
   - `变更详情`
   - sticky `变更状态`
6. `导出 YAML` and `导入 YAML` are inside the branded auxiliary maintenance panel, separate from `校验` / `保存`.
7. Workbench has no visible `版本`、`历史`、`恢复`、`回滚`、`快照` entry.
8. Browser console has no warning or error.

Cross-page comparison:

- `/catalog`、`/connections`、`/connections/enabled-tables`、`/wiki` generally use `PageHeader` for H1 / description / primary actions.
- `/catalog/:conn/:schema/:table` diverges by placing an extra command bar below Header with duplicated object identity.

## 6. Target IA

Recommended target structure:

```txt
PageHeader
  H1: superstore_orders
  Meta:
    连接: demo-mysql
    Schema: dataforai
  Actions:
    保存
    校验
    导入 YAML
    导出 YAML
    更多: 粘贴 YAML, 版本记录
  Lightweight status:
    已保存 / 有未保存修改 / 校验通过 / 校验失败 / 保存失败

Main
  在线编辑
    Tabs: 基础语义 · 字段 30 · 指标 4 · 分群 3 · 关联 0

Secondary
  导入 / 导出
    paste YAML
    import file
    affected file summary

Details
  变更详情
    Diff / YAML / Validate
    raw Diff disclosure

History
  版本记录 drawer
    recent 5 YAML snapshots
    preview
    diff
    restore as draft
```

Ordering rule:

1. `在线编辑` is the primary task and must appear before auxiliary import / export details.
2. Import / export is a maintenance capability, not the page's main content.
3. Change details and save / validation feedback are subordinate to editing.

## 7. UX Requirements

### 7.1 Header Identity

Requirements:

- Header H1 MUST be the current table name, e.g. `superstore_orders`.
- Header MUST NOT show `语义资产` as a visible breadcrumb on the single-table page.
- Header MUST show context with labels:
  - `连接：demo-mysql`
  - `Schema：dataforai`
- Header context SHOULD be visually lightweight but explicit; do not use bare `demo-mysql / dataforai`.
- Header MUST keep table, connection, and schema text protected from browser translation.
- Header MUST align with other `PageHeader` pages in spacing, typography, and action placement.

Acceptance:

- `superstore_orders` appears exactly once as the page H1.
- Header text does not start with `语义资产`.
- `连接：demo-mysql` and `Schema：dataforai` are visible.
- Bare `demo-mysql / dataforai` is not the only context expression.

### 7.2 Unified Action Bar

Requirements:

- Remove the standalone `表语义资产 superstore_orders` command status.
- Put asset-level actions in one command model, preferably Header right actions:
  - primary: `保存`
  - secondary: `校验`
  - secondary: `导入 YAML`
  - secondary: `导出 YAML`
  - overflow: `粘贴 YAML`, `版本记录`
- If sticky behavior is needed for long editing, make the same action bar sticky; do not render a second command bar.
- `导入 YAML` and `导出 YAML` are common actions and SHOULD be no more than one click away.
- `粘贴 YAML` is lower frequency and MAY live under `更多` or an expandable import panel.

Acceptance:

- No visible `表语义资产 superstore_orders` text appears below Header.
- Visible counts for `保存`、`校验`、`导入 YAML`、`导出 YAML` are one each in the first viewport.
- Action placement visually matches other pages that expose page-level actions, such as `/wiki` and `/publish/workbench`.

### 7.3 Online Editing First

Requirements:

- Rename the main semantic editor section to `在线编辑`.
- `在线编辑` appears before import / export details.
- The tab set remains:
  - `基础语义`
  - `字段 30`
  - `指标 4`
  - `分群 3`
  - `关联 0`
- Counts may remain as local tab badges only.
- Do not reintroduce `高级：手工维护语义字段`.
- Do not reintroduce an inner sidebar.

Acceptance:

- In visual order, `在线编辑` appears above import / export details.
- `语义内容` is not used as the primary section heading after this refactor.
- Field, metric, segment, and join editing remain reachable from real controls.

### 7.4 Import / Export Section

Requirements:

- Rename `Claude Code / Codex 辅助维护` to a neutral user-facing label:
  - recommended section label: `导入 / 导出`
  - alternative label: `文件导入与导出`
- The section MAY include short subcopy only when necessary, but must not mention implementation rationale.
- Do not use `YAML 交换` as a visible label.
- Do not use `Claude Code / Codex` as a visible section title.
- The panel contains:
  - `导出 YAML`
  - `导入 YAML`
  - `粘贴 YAML`
  - import source / file state
  - affected file summary
  - import preview trigger
- This section is secondary to online editing and should be compact by default.

Acceptance:

- `Claude Code / Codex 辅助维护` is absent from visible UI.
- `YAML 交换` is absent from visible UI.
- `导入 / 导出` or `文件导入与导出` is visible as the secondary section label.
- `导入文件` and `影响文件` remain left-aligned and contextually grouped.

### 7.5 Save / Validation Feedback

Requirements:

- Re-evaluate `变更状态` as a heavy standalone component.
- If retained, rename to `保存状态` or `校验结果`.
- Default no-change state SHOULD be lightweight and not compete with `在线编辑`.
- User-facing feedback should answer:
  - 是否有未保存修改？
  - 当前是否可保存？
  - 校验是否通过？
  - 保存后会影响哪些文件？
  - 失败时应该处理什么？
- Avoid exposing `Dry-run` and `Unknown` as the main user-facing labels without explanation.
- Detailed technical counts may remain in `变更详情` or advanced area.

Acceptance:

- No prominent heavy card titled `变更状态` appears above or competing with `在线编辑`.
- The user can still see saved / unsaved / validating / validation failed / save failed states.
- Validation errors and affected files remain discoverable.

### 7.6 Version History and Restore

Requirements:

- Provide a `版本记录` entry for the current table YAML.
- Retain the most recent 5 YAML snapshots per table.
- Generate a version snapshot after successful save and successful import.
- If content hash is unchanged, do not generate duplicate snapshots.
- Support:
  - list recent versions
  - preview historical YAML
  - compare historical version to current draft / current saved YAML
  - restore a selected historical version into the editor as an unsaved draft
- Restoring a version MUST NOT immediately persist to disk; user must still `校验` and `保存`.
- After restore and save, create a new version with operation `restore`.

Acceptance:

- User can open `版本记录` from the table workbench.
- Version list shows at most 5 versions.
- Each version shows operation type, timestamp, content hash short id, and optional source file name.
- `恢复此版本` changes editor draft and marks page as unsaved.
- Save after restore creates a new version record.

## 8. Data Contract

### 8.1 Storage

Add hidden history storage under `.ktx-ui` (not under `semantic-layer/`, which KTX treats as connection roots):

```text
.ktx-ui/table-yaml-history/
  table-yaml-index.json
  snapshots/
    <tableHash>/
      <versionId>.yaml
```

Legacy `semantic-layer/.lucy-history/` is auto-relocated on validate/reindex and history access.

Rules:

- `tableHash` is SHA-256 first 16 chars of normalized table key `<conn>/<schema>/<table>`.
- `versionId` format SHOULD be `YYYYMMDDTHHmmssSSSZ-<shortHash>`.
- Retention limit is `5` per table.
- Hidden history files MUST NOT appear as publish candidates, Catalog entries, or semantic assets.
- Snapshots store YAML after successful save/import, preserving current serialization output.

### 8.2 Version Index

Suggested shape:

```json
{
  "schemaVersion": 1,
  "tables": {
    "demo-mysql/dataforai/superstore_orders": {
      "key": "demo-mysql/dataforai/superstore_orders",
      "currentVersionId": "20260802T180000000Z-a1b2c3d4",
      "versions": [
        {
          "versionId": "20260802T180000000Z-a1b2c3d4",
          "createdAt": "2026-08-02T18:00:00.000Z",
          "operation": "save",
          "contentHash": "sha256:...",
          "snapshotPath": ".ktx-ui/table-yaml-history/snapshots/9a5e.../20260802T180000000Z-a1b2c3d4.yaml",
          "affectedFiles": ["semantic-layer/demo-mysql/superstore_orders.yaml"]
        }
      ]
    }
  }
}
```

Types:

```ts
type TableYamlVersionOperation = "save" | "import" | "restore";

type TableYamlVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: TableYamlVersionOperation;
  contentHash: string;
  sourceFileName?: string;
  restoredFromVersionId?: string;
  affectedFiles: string[];
};

type TableYamlVersionDetail = TableYamlVersionSummary & {
  rawYaml: string;
  diffFromCurrent: string;
};
```

## 9. API Contract

API shape may be adjusted to match current WebUI API conventions, but the UX contract requires these capabilities.

### 9.1 `GET /api/catalog/:conn/:schema/:table/versions`

Returns recent version summaries.

```json
{
  "ok": true,
  "data": {
    "key": "demo-mysql/dataforai/superstore_orders",
    "retentionLimit": 5,
    "versions": []
  }
}
```

### 9.2 `GET /api/catalog/:conn/:schema/:table/versions/:versionId`

Returns YAML and Diff detail.

```json
{
  "ok": true,
  "data": {
    "versionId": "20260802T180000000Z-a1b2c3d4",
    "rawYaml": "tables:\n",
    "diffFromCurrent": "@@\n"
  }
}
```

### 9.3 `POST /api/catalog/:conn/:schema/:table/versions/:versionId/restore/preview`

Returns restore preview; does not write files.

### 9.4 `POST /api/catalog/:conn/:schema/:table/versions/:versionId/restore`

Returns restored YAML draft payload for the front end; does not persist semantic-layer files until the user saves.

## 10. Accessibility

- Header action buttons must have stable accessible names.
- `版本记录` drawer must trap focus only while open and return focus to the triggering button on close.
- Version list must be keyboard navigable.
- `恢复此版本` requires a confirmation or preview step before mutating editor draft.
- Tabs under `在线编辑` must keep current keyboard behavior and visible focus.
- Hidden File Input must remain hidden from visual UI while preserving accessible import behavior through the custom button.

## 11. Test Requirements

Update `webui/src/__tests__/table-editor.test.tsx` and add API tests where matching backend test harness exists.

Required UI assertions:

- H1 is `superstore_orders`.
- Header shows `连接：demo-mysql` and `Schema：dataforai`.
- Header does not visibly render `语义资产` as single-table breadcrumb.
- `表语义资产 superstore_orders` is absent.
- `在线编辑` is visible before `导入 / 导出`.
- `Claude Code / Codex 辅助维护` is absent.
- `YAML 交换` is absent.
- `导入 / 导出` or `文件导入与导出` is visible.
- `保存`、`校验`、`导入 YAML`、`导出 YAML` appear once each.
- Heavy `变更状态` card is absent or renamed to `保存状态` / `校验结果`.
- `版本记录` entry is visible.
- Opening version history shows recent versions, preview, diff, and restore affordance.
- Restore changes editor draft and marks the page as unsaved, without immediately calling save.

Required backend / API assertions:

- Save creates a version snapshot.
- Import creates a version snapshot with `sourceFileName` when available.
- Unchanged content does not create duplicate version.
- More than 5 versions prunes the oldest snapshot and index entry.
- Restore preview returns Diff without writing files.
- Restore as draft returns YAML payload but does not persist until save.
- History storage is excluded from Catalog and publish candidate scans.

## 12. Validation

Required non-browser validation:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/table-editor.test.tsx
```

If API or shared server code changes, also run the relevant backend/API test suite for catalog semantic assets.

If shared header or routing behavior changes, also run:

```bash
cd webui
npm test -- src/__tests__/app-shell.test.tsx
```

Browser validation is required after Docker rebuild because this spec is based on browser-observed layout issues.

Target:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Browser checklist:

- Header H1 is table name only.
- Header context visibly labels `连接` and `Schema`.
- No standalone `表语义资产 superstore_orders` command status.
- `在线编辑` precedes import / export details.
- `Claude Code / Codex 辅助维护` and `YAML 交换` are absent.
- `保存`、`校验`、`导入 YAML`、`导出 YAML` each appear once.
- Save / validation feedback is lightweight and user-oriented.
- `版本记录` opens, previews history, and restore-as-draft works.
- Browser console has no new warnings or errors.

## 13. Done Definition

- [ ] Header identity and context match this spec.
- [ ] Single-table page aligns with existing `PageHeader` action placement patterns.
- [ ] `在线编辑` is the first and primary work area.
- [ ] Import / export is product-neutral and secondary.
- [ ] Save / validation feedback is user-oriented and no longer a confusing heavy `变更状态` card.
- [ ] Version history stores and displays recent 5 YAML snapshots.
- [ ] Restore loads a historical YAML as unsaved draft and requires save to persist.
- [ ] Focused tests and required lint pass.
- [ ] Desktop browser validation passes after Docker rebuild.
