# M54 Table Semantic Workbench Online Editing, Action Bar, and Version History Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M54：表语义工作台在线编辑优先、统一动作区与 YAML 版本记录。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/42-page-header-standardization-spec.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/54-table-semantic-workbench-command-density-refactor-spec.md`
- `docs/56-table-semantic-workbench-online-editing-actionbar-version-history-spec.md`
- `src/pages/TableEditor.tsx`
- `src/app/app.css`
- `src/__tests__/table-editor.test.tsx`

目标：

根据浏览器核查和用户反馈，继续重构 `/catalog/:conn/:schema/:table`：Header 以当前表为唯一主角，副信息明确展示 `连接` / `Schema`；删除 `表语义资产 superstore_orders` 重复命令栏身份；将 `在线编辑` 置为主编辑区；用产品中立的 `导入 / 导出` 替代 `Claude Code / Codex 辅助维护`；统一 `保存`、`校验`、`导入 YAML`、`导出 YAML` 的动作模型；弱化 `变更状态`；增加最近 5 版 YAML 的版本记录、预览和恢复为草稿。

## Scope

### Phase 1: Header Identity And Unified Actions

1. 在 `src/pages/TableEditor.tsx` 中重组单表页 `PageHeader`。
2. H1 只显示当前表名，例如 `superstore_orders`。
3. 移除单表页 Header 中可见的 `语义资产` breadcrumb。
4. Header context 改为显式标签：
   - `连接：demo-mysql`
   - `Schema：dataforai`
5. 保持 table / connection / schema DOM 节点的 `translate="no"` 和 `notranslate`。
6. 删除独立 command bar 左侧的 `表语义资产 superstore_orders`。
7. 将 `保存`、`校验`、`导入 YAML`、`导出 YAML` 归入一个 Header action group 或 sticky action group。
8. 如需 long-page sticky，将同一个 action group sticky 化，不渲染第二套同名按钮。
9. `粘贴 YAML` 和 `版本记录` 放入 `更多` 或同级低频入口。

### Phase 2: Rename And Reorder Main Sections

1. 将主编辑区标题从 `语义内容` 改为 `在线编辑`。
2. 页面视觉顺序调整为：
   1. Header / action group
   2. `在线编辑`
   3. `导入 / 导出`
   4. `变更详情`
   5. lightweight save / validation feedback
3. 保留现有 tabs：
   - `基础语义`
   - `字段 30`
   - `指标 4`
   - `分群 3`
   - `关联 0`
4. 不恢复内部第二侧栏。
5. 不恢复 `高级：手工维护语义字段`。

### Phase 3: Neutral Import / Export Surface

1. 将 `Claude Code / Codex 辅助维护` 改为 `导入 / 导出`。
2. 不使用 `YAML 交换` 作为 UI 文案。
3. 保留能力：
   - `导出 YAML`
   - `导入 YAML`
   - `粘贴 YAML`
   - `生成导入预览`
   - `导入文件`
   - `影响文件`
4. `导入文件` 和 `影响文件` 保持左对齐，和导入 / 导出动作在同一上下文。
5. 原生 File Input 继续隐藏。
6. 移除所有将 Claude Code / Codex 作为生产 UI 主标题或 aria 上下文的文案；如需保留工具示例，放到 tooltip 或 docs，不放主标题。

### Phase 4: Save / Validation Feedback

1. 评估现有 `变更状态` 组件。
2. 推荐将可见标题改为 `保存状态` 或 `校验结果`；若默认无变化，可降级为轻量状态行。
3. 面向用户展示：
   - `已保存`
   - `有未保存修改`
   - `校验通过`
   - `校验失败`
   - `保存失败`
4. 技术计数 `Dry-run`、`Unknown YAML Key` 可保留在高级详情或次级 meta 中，不作为主要标题。
5. 保留影响文件和校验错误的可发现入口。
6. 确保 feedback 不抢占 `在线编辑` 的主视觉层级。

### Phase 5: YAML Version History Data Layer

1. 在后端 / 本地数据层新增 table YAML history helper。
2. 存储位置：

```text
semantic-layer/.lucy-history/
  table-yaml-index.json
  snapshots/
    <tableHash>/
      <versionId>.yaml
```

3. `tableHash` 使用 normalized table key `<conn>/<schema>/<table>` 的 SHA-256 前 16 位。
4. 每张表保留最近 5 版。
5. 成功保存后创建 `operation: "save"` 版本。
6. 成功导入后创建 `operation: "import"` 版本，并尽量记录 `sourceFileName`。
7. 若 YAML content hash 与当前版本相同，不新增重复版本。
8. 超过 5 版时裁剪最旧版本和对应 snapshot 文件。
9. 确保 `.lucy-history` 不进入 Catalog / publish candidate / semantic asset scans。

### Phase 6: Version History API

1. 增加或扩展 API，满足：
   - list versions
   - get version detail
   - restore preview
   - restore as draft
2. 建议 endpoint：
   - `GET /api/catalog/:conn/:schema/:table/versions`
   - `GET /api/catalog/:conn/:schema/:table/versions/:versionId`
   - `POST /api/catalog/:conn/:schema/:table/versions/:versionId/restore/preview`
   - `POST /api/catalog/:conn/:schema/:table/versions/:versionId/restore`
3. Restore endpoint 不直接写入 semantic-layer 文件，只返回可加载进编辑器的 YAML draft。
4. 用户必须再执行 `校验` 和 `保存` 才会持久化恢复结果。
5. 保存恢复结果后创建 `operation: "restore"` 版本，并记录 `restoredFromVersionId`。

### Phase 7: Version History UI

1. 在 TableEditor 增加 `版本记录` 入口，推荐放入 Header actions 的 `更多` 菜单。
2. 打开 `版本记录` drawer / panel。
3. 列表展示最近 5 版：
   - 操作类型
   - 时间
   - short hash
   - source file name, if any
4. 点击版本展示：
   - YAML preview
   - Diff from current draft / saved state
5. `恢复此版本` 先展示恢复预检。
6. 用户确认后，把历史 YAML 加载为 unsaved draft。
7. 恢复后状态提示显示 `有未保存修改`，用户仍需 `校验` / `保存`。
8. Drawer 关闭后焦点回到 `版本记录` 触发按钮。

### Phase 8: CSS Polish

1. 更新 `src/app/app.css`：
   - compact table header meta row
   - Header action group
   - online editing section priority
   - neutral import/export secondary section
   - lightweight save / validation feedback
   - version history drawer / panel
2. 保持企业控制台密度：左对齐、紧凑、可扫描。
3. 不新增 hero、营销卡片、大面积渐变、装饰背景。
4. 确保按钮、meta label、tab badge、版本列表在 1280px desktop 下不溢出。
5. Sticky 元素不得遮挡字段编辑表单。

## Implementation Notes

### Target Visible Copy

Recommended Header:

```txt
superstore_orders
连接：demo-mysql    Schema：dataforai
[保存] [校验] [导入 YAML] [导出 YAML] [...]
```

Recommended main section:

```txt
在线编辑
基础语义 | 字段 30 | 指标 4 | 分群 3 | 关联 0
```

Recommended secondary section:

```txt
导入 / 导出
导入 YAML | 导出 YAML | 粘贴 YAML
导入文件：未导入
影响文件：0
```

Avoid:

```txt
语义资产 superstore_orders demo-mysql / dataforai
表语义资产 superstore_orders
Claude Code / Codex 辅助维护
YAML 交换
```

### Command Ownership

```txt
Header / action group: 保存, 校验, 导入 YAML, 导出 YAML, 更多
在线编辑: semantic fields / measures / segments / joins
导入 / 导出: paste YAML, import preview, source file, affected files
变更详情: Diff / YAML / Validate / raw Diff
保存状态 / 校验结果: lightweight feedback only
版本记录: history list, preview, diff, restore as draft
```

### Version Restore Safety

Do not persist on restore click. Restore loads historical YAML into the editor draft, triggers dirty state, then normal validation / save flow persists it. This avoids accidental destructive overwrite.

## Tests

Modify `src/__tests__/table-editor.test.tsx`.

Required UI assertions:

- Header H1 is `superstore_orders`.
- Header shows `连接：demo-mysql`.
- Header shows `Schema：dataforai`.
- Header does not render visible single-table breadcrumb `语义资产`.
- `表语义资产 superstore_orders` is absent.
- `在线编辑` appears before `导入 / 导出`.
- `语义内容` is not the primary section title.
- `Claude Code / Codex 辅助维护` is absent.
- `YAML 交换` is absent.
- `保存` appears once.
- `校验` appears once.
- `导入 YAML` appears once.
- `导出 YAML` appears once.
- `版本记录` entry is visible.
- Save / validation feedback uses `保存状态` or equivalent user-facing state, not heavy `变更状态` as the primary card.
- Hidden File Input tests still pass.
- Field batch operation tests still pass.

Add API / data-layer tests where the existing test setup supports them:

- Save creates a table YAML version snapshot.
- Import creates a version snapshot.
- Same content hash does not create duplicate versions.
- Retention prunes to 5 versions.
- Version list endpoint returns newest first.
- Version detail endpoint returns raw YAML and Diff.
- Restore preview does not write files.
- Restore as draft does not write files.
- Saving after restore records `operation: "restore"`.
- `.lucy-history` is excluded from Catalog / publish scans.

## Validation Commands

Run:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/table-editor.test.tsx
```

If API or shared server code changes, run the relevant backend/API tests for catalog semantic assets.

If App shell, PageHeader, or routing changes, also run:

```bash
cd webui
npm test -- src/__tests__/app-shell.test.tsx
```

If build-affecting code changes, run:

```bash
cd webui
npm run build
```

Browser validation after Docker rebuild:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Browser checklist:

- H1 is `superstore_orders`.
- Header shows `连接：demo-mysql` and `Schema：dataforai`.
- Header/action layout visually matches other WebUI pages.
- No `表语义资产 superstore_orders`.
- `在线编辑` is above import/export details.
- No `Claude Code / Codex 辅助维护`.
- No `YAML 交换`.
- `保存`、`校验`、`导入 YAML`、`导出 YAML` each appear once.
- Save / validation feedback is lightweight and user-oriented.
- `版本记录` opens, previews YAML, shows Diff, and restore loads unsaved draft.
- Browser console has no new warnings or errors.

Do not run mobile / narrow viewport validation unless explicitly requested.

## Done Definition

- [ ] Spec requirements in `docs/56-table-semantic-workbench-online-editing-actionbar-version-history-spec.md` are implemented.
- [ ] Header identity and context are explicit and non-redundant.
- [ ] Single action model owns save / validate / import / export.
- [ ] `在线编辑` is the primary first section.
- [ ] Import / export section is product-neutral and secondary.
- [ ] Save / validation feedback is user-oriented.
- [ ] Recent 5 YAML versions are stored, listed, previewable, diffable, and restorable as draft.
- [ ] Focused tests and required lint pass.
- [ ] Desktop browser validation passes after Docker rebuild.
