# M52 Table Semantic Workbench Command Density Refactor Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M52：表语义资产工作台命令减噪与结果优先重构。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/42-page-header-standardization-spec.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/50-table-semantic-workbench-ui-ux-hardening-spec.md`
- `docs/51-table-semantic-workbench-ia-separation-spec.md`
- `docs/54-table-semantic-workbench-command-density-refactor-spec.md`
- `src/pages/TableEditor.tsx`
- `src/app/app.css`
- `src/__tests__/table-editor.test.tsx`

目标：

根据浏览器核查和用户补充反馈，重构 `/catalog/:conn/:schema/:table` 表语义资产工作台：Header 只保留身份与关键状态，删除重复按钮和冗余 chips；语义内容成为主编辑区；Claude Code / Codex 辅助维护降级为紧凑维护手段；`变更状态` Inspector 纯反馈化；生产 UI 删除研发 spec 式说明文案。

## Scope

### Phase 1: Header Simplification

1. 在 `src/pages/TableEditor.tsx` 中重组单表页 Header。
2. Header H1 保持当前表名，例如 `superstore_orders`。
3. Breadcrumb 停在父级上下文，推荐 `语义资产 / demo-mysql / dataforai`，避免和 H1 重复当前表名。
4. 删除 Header 功能说明：
   - `导出、导入、校验并审阅当前表的 semantic-layer YAML。`
5. 删除 Header 右侧冗余 chips：
   - `完成度 done`
   - `30 字段`
   - `4 指标`
   - `3 分群`
   - `0 关联`
6. 如需 Header 状态，只保留一个关键状态，例如 `有未保存变更`、`校验通过`、`保存失败`。
7. 确保 Connection / Schema / table DOM 节点继续使用 `translate="no"` 和 `notranslate`。

### Phase 2: Single Command Surface

1. 移除 Header 中的 `导出 YAML`、`导入 YAML`、`校验`、`保存` 操作按钮。
2. 保留一个全局 sticky command bar，承载：
   - `校验`
   - `保存`
3. 将 `导出 YAML`、`导入 YAML` 只保留在 `Claude Code / Codex 辅助维护` 中。
4. 从 `变更状态` Inspector 中移除 `校验`、`保存变更` 操作按钮。
5. 如果实现上需要 responsive reposition，移动同一组命令控件，不要渲染第二套同名按钮。

### Phase 3: Semantic Content As Primary Editor

1. 将 `语义内容` 从大折叠卡片改为主页面编辑区。
2. 移除语义内容内部的垂直对象树 / 局部侧栏：
   - `返回语义资产`
   - `同 Schema 表`
   - `当前表`
3. 将 `基础语义`、`字段`、`指标`、`分群`、`关联` 改为顶部 tabs 或 segmented controls。
4. Counts 可以作为 tab badge 出现：
   - `字段 30`
   - `指标 4`
   - `分群 3`
   - `关联 0`
5. Counts 不得再出现在 Header。
6. 保留字段批量操作、表描述、行粒度、指标、分群、关联编辑能力。

### Phase 4: Compact Auxiliary Maintenance

1. 将 `Claude Code / Codex 辅助维护` 改为紧凑入口。
2. 入口必须在页面加载后可发现，但详细 YAML 交换流程不得占据首屏大块高度。
3. 详细区可以使用 drawer、popover、或受控 disclosure。
4. `导出 YAML`、`导入 YAML`、`粘贴 YAML`、`导入文件`、`影响文件`、Dry-run 状态必须留在该辅助维护上下文内。
5. `导入文件` 和 `影响文件` 左对齐，不再作为居中或 detached metadata。
6. 保留隐藏原生 File Input 实现，不重新暴露 `Choose File`。

### Phase 5: Remove Spec-Like Production Copy

1. 删除以下可见文案：
   - `主流程：导出 YAML，交给 Claude Code / Codex 完善，再导入当前表 YAML 进行 dry-run 校验。`
   - `维护结果会统一写入当前表语义内容；Claude Code / Codex 和页面编辑只是不同维护方式。`
   - `长页面编辑时保持校验和保存状态可见。`
2. 必要帮助信息改为短 label、tooltip、或帮助图标。
3. 不新增段落级研发说明文案。

### Phase 6: Pure Feedback Inspector And Change Details

1. 重组 `变更状态` Inspector，使其只显示反馈：
   - dirty state
   - validation state
   - Dry-run file count
   - Unknown YAML Key count
   - save pending / error
   - affected file count
2. 将 `变更预览` 移到独立 `变更详情` drawer、panel 或非 sticky 区域。
3. 将 `Diff` / `YAML` / `Validate` tabs 和 raw Diff 从 sticky Inspector 中移出。
4. `高级：查看原始 Diff` 不得出现在 `变更状态` sticky card 内。
5. 保证用户仍能打开 Diff / YAML / Validate 明细。

### Phase 7: CSS Polish

1. 更新 `src/app/app.css` 支持 compact Header、sticky command bar、main editor tabs、compact auxiliary maintenance、pure status Inspector。
2. 保持企业控制台密度：左对齐、紧凑、可扫描。
3. 不新增双层卡片、营销式 hero、大面积渐变、装饰性背景。
4. 确保按钮文字和 tab badge 不溢出。
5. 确保 sticky 区域不遮挡字段编辑表单。

## Implementation Notes

### Command Ownership

Target ownership:

```txt
Header: identity only
Sticky command bar: 校验 / 保存
Auxiliary maintenance: 导出 YAML / 导入 YAML / 粘贴 YAML
Inspector: status feedback only
Change details: Diff / YAML / Validate / raw Diff
```

Do not keep duplicate visible commands and rely on `aria-label` to disambiguate. Accessible names should improve clarity, not compensate for visual duplication.

### Header Sketch

Recommended visible structure:

```txt
语义资产 / demo-mysql / dataforai
superstore_orders
demo-mysql / dataforai
有未保存变更
```

If the breadcrumb and context line feel repetitive in implementation, prefer:

```txt
语义资产 / demo-mysql / dataforai
superstore_orders
```

Do not render:

```txt
导出、导入、校验并审阅当前表的 semantic-layer YAML。
完成度 done
30 字段
4 指标
3 分群
0 关联
```

### Semantic Tabs

Use existing editor state where possible. The target can be implemented as:

```tsx
type SemanticTab = "base" | "fields" | "measures" | "segments" | "joins";
```

Tabs must be real controls:

- role `tablist` / `tab` is preferred if the component behaves like tabs.
- Otherwise use buttons in a segmented control with `aria-pressed`.
- Keyboard focus ring must be visible.

### Auxiliary Maintenance

The M49 requirement "Claude Code / Codex 辅助维护默认可见" is revised by M52:

- The entry point remains visible.
- The detailed workflow is compact by default.
- Export/import/paste remain one click away.
- The auxiliary panel must not own the first viewport.

### Change Details

If moving Diff / YAML / Validate into a drawer is too large for this work order, a non-sticky panel below the main editor is acceptable. The key requirement is separation from `变更状态`.

## Tests

Modify `src/__tests__/table-editor.test.tsx`.

Required assertions:

- Header shows the current table H1.
- Header does not show `导出、导入、校验并审阅当前表的 semantic-layer YAML。`
- Header does not show `完成度 done`.
- Header does not show header-level `30 字段` / `4 指标` / `3 分群` / `0 关联` chips.
- `导出 YAML` appears exactly once in visible UI.
- `导入 YAML` appears exactly once in visible UI.
- `校验` appears exactly once in visible UI.
- `保存` / `保存变更` global save trigger appears exactly once in visible UI.
- `变更状态` does not contain `校验` or `保存变更` buttons.
- `变更状态` still shows Dry-run count and Unknown YAML Key count.
- `变更详情` or equivalent detail region exposes Diff / YAML / Validate.
- `主流程：导出 YAML` is absent.
- `维护结果会统一写入当前表语义内容` is absent.
- `长页面编辑时保持校验和保存状态可见` is absent.
- Inner object tree labels `返回语义资产` and `同 Schema 表` are absent from the main editor.
- `待处理建议` remains absent.
- Hidden File Input tests still pass.
- Field batch operation tests still pass.

## Validation Commands

Run:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/table-editor.test.tsx
```

If app shell or shared header behavior changes, also run:

```bash
cd webui
npm test -- src/__tests__/app-shell.test.tsx
```

Because this work order is based on browser-observed UX feedback, final implementation should include desktop browser validation at:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Browser validation checklist:

- Header is compact and does not repeat current table identity.
- Header does not show redundant count chips.
- Header does not show the old page function explanation.
- No duplicate global commands are visible in the same viewport.
- Semantic editing is the primary first-screen content.
- Auxiliary maintenance is discoverable but compact.
- No Double Sidebar remains inside the main editor.
- `变更状态` is pure feedback.
- Diff / YAML / Validate remain reachable through `变更详情` or equivalent.
- Browser console has no warning or error caused by the refactor.

Do not run mobile / narrow viewport validation unless explicitly requested.

## Done Definition

- [ ] Spec requirements in `docs/54-table-semantic-workbench-command-density-refactor-spec.md` are implemented.
- [ ] `TableEditor.tsx` no longer renders duplicate global commands.
- [ ] Header only contains object identity and critical state.
- [ ] Semantic content is the primary editor surface.
- [ ] Auxiliary maintenance is compact and secondary.
- [ ] Inspector is pure feedback.
- [ ] User-facing copy follows terminology standard.
- [ ] Focused tests and required lint pass.
- [ ] Desktop browser validation has been performed if the implementation task explicitly permits browser validation.
- [ ] No semantic-layer YAML, sidecar data, or API migration is introduced.
