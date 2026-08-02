# M48 Table Semantic Workbench UI/UX Hardening Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M48：表语义资产工作台 UI/UX hardening。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/42-page-header-standardization-spec.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/50-table-semantic-workbench-ui-ux-hardening-spec.md`
- `src/app/App.tsx`
- `src/pages/TableEditor.tsx`
- `src/pages/Catalog.tsx`
- `src/components/RowMoreMenu.tsx`
- `src/app/app.css`
- `src/__tests__/table-editor.test.tsx`
- `src/__tests__/catalog.test.tsx`

目标：

修复 `/catalog/:conn/:schema/:table` 表语义资产工作台的键盘焦点、候选关联按钮语义、原生 file input 暴露、长页面状态可见性、折叠控件语义和字段批量编辑效率，并顺手打磨 `/catalog` 目录页术语与空态。

## Scope

### Phase 1: Accessibility Fixes

1. 修复 `TableEditor.tsx` 的键盘焦点陷阱。
2. 确认 `handleSaveShortcut` 只处理 `Cmd+S` / `Ctrl+S`，不得阻断普通 `Tab`。
3. 为字段搜索、人工描述 textarea、候选关联动作、检查器 tab、折叠按钮补充清晰 label / focus state。
4. 隐藏原生 `<input type="file">` 的用户可见入口，避免暴露 `Choose File`。
5. 保留 `导入 YAML` 受控入口和 `table-editor-import-input` 测试能力。

### Phase 2: Candidate Joins And Disclosure Semantics

1. 将 `CandidateJoinDisclosure` 从原生 `details/summary` 或 ambiguous generic click 迁移为受控 disclosure。
2. Trigger 使用 `button`，补齐 `aria-expanded`、`aria-controls`、稳定 panel id。
3. 候选关联行内按钮 visible label 可简化，但 accessible name 必须包含目标关系上下文。
4. 更新 `table-editor.test.tsx` 中对 `待处理建议` 和候选关联按钮的断言。

### Phase 3: Persistent Change State

1. 抽出或重组 `InspectorPanel`，让 `变更状态` / `变更检查器` 在长页面编辑时保持可见。
2. Desktop 下优先使用 right-side sticky inspector；中等宽度下允许 bottom sticky action/status bar。
3. 常驻区域至少显示 completion、Dry-run count、Unknown YAML Key count、validate state、save pending/error。
4. 常驻区域提供 `校验` 和 `保存变更`，并避免与 Header 产生无上下文重复 accessible names。
5. 更新 CSS，保证 sticky 区域不覆盖字段卡片和表单。

### Phase 4: Field Batch Operations

1. 为字段编辑区增加筛选模式：
   - `全部字段`
   - `缺少人工描述`
   - `有 AI 建议`
   - `PK / Not Null`
2. 增加可见字段多选、全选筛选结果、清空选择。
3. 增加默认安全的 `批量采纳 AI 描述`：只填充空白 Human 描述，不覆盖已有 Human 描述。
4. 如需要覆盖已有 Human 描述，必须作为独立显式动作或二次确认，不在本阶段默认实现。
5. 批量操作只更新本地 form state 和 Dry-run 预览，不自动保存。

### Phase 5: Catalog Polish

1. 保持 `/catalog` PageHeader title 为 `语义资产`。
2. 检查 `/catalog` 描述文案，保护 `semantic-layer YAML` 等专业术语。
3. 确认筛选顺序为 `搜索 -> Connection -> Schema -> 语义状态`。
4. 结果数量随筛选更新，样式低噪声。
5. no-match empty state 给出恢复路径。
6. 行内主操作保持 `打开工作台`。
7. 不重新引入 `{schema}.{table}` 重复展示。

## Implementation Notes

### Keyboard And Save Shortcut

在 `src/pages/TableEditor.tsx` 中检查 `handleSaveShortcut`。

Expected behavior:

```ts
function handleSaveShortcut(event: React.KeyboardEvent) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
    return;
  }
  event.preventDefault();
  // refresh dry-run preview and switch to Diff
}
```

不要在 form 或 wrapper 上处理普通 `Tab`。如果 textarea 当前为了插入 tab 字符拦截了 `Tab`，本工单要删除该行为，或改成显式快捷键。

### Native File Input

`TableEditor.tsx` 当前存在：

```tsx
<input
  ref={importInputRef}
  type="file"
  className="sr-only"
  accept=".yaml,.yml,text/yaml,text/plain"
  onChange={handleImportFile}
  data-testid="table-editor-import-input"
/>
```

更新为实现细节：

```tsx
<input
  ref={importInputRef}
  type="file"
  tabIndex={-1}
  aria-hidden="true"
  className="sr-only"
  accept=".yaml,.yml,text/yaml,text/plain"
  onChange={handleImportFile}
  data-testid="table-editor-import-input"
/>
```

测试仍可通过 `data-testid` 找到 input，但用户可达控件只有 `导入 YAML`。

### Candidate Join Buttons

在 `CandidateJoinBanner` 中为每个 candidate 构造 context：

```ts
const joinTarget = candidate.join.to;
```

按钮示例：

```tsx
<button aria-label={`确认写入 ${joinTarget} 关联`}>确认写入</button>
<button aria-label={`保留 ${joinTarget} 为候选关联`}>保留</button>
<button aria-label={`标记 ${joinTarget} 关联不采用`}>不采用</button>
```

如果保留现有 visible label，也必须补 `aria-label`。

### Controlled Disclosure

优先在 `TableEditor.tsx` 内新增小型本地组件，避免过早抽全局组件：

```tsx
function WorkbenchDisclosure(props: {
  id: string;
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // useState(defaultOpen)
  // button aria-expanded aria-controls
  // div id hidden={!open}
}
```

替换：

- `candidate-joins-disclosure`
- `manual-semantic-disclosure`
- `raw-diff-disclosure`

保留既有 `data-testid`，减少测试迁移成本。

### Persistent Inspector

当前 `InspectorPanel` 位于 form 下方，用户滚动到字段区时容易离开视野。

建议结构：

```txt
pl-table-editor-main
  form.pl-table-editor-form
    semantic asset exchange
    candidate joins
    manual editor
  aside.pl-inspector.pl-inspector--sticky
```

CSS sketch:

```css
.pl-table-editor-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 380px);
  gap: var(--space-4);
  align-items: start;
}

.pl-inspector--sticky {
  position: sticky;
  top: var(--page-sticky-offset, 16px);
}
```

If the existing layout already has equivalent wrappers, reuse them instead of adding a new outer card.

### Field Batch Operations

Add local state in `TableEditor.tsx`:

```ts
type FieldFilterMode = "all" | "missingHuman" | "hasAi" | "pkOrRequired";
const [fieldFilterMode, setFieldFilterMode] = useState<FieldFilterMode>("all");
const [selectedFieldNames, setSelectedFieldNames] = useState<Set<string>>(() => new Set());
```

Implementation rules:

- Never mutate the `Set` in place; create a new `Set`.
- Derive `filteredColumns` from search + filter mode.
- Select-all applies to current `filteredColumns`.
- Batch adopt only fills descriptions where current `description` is empty.
- After batch adopt, update form once, not one field at a time.

### Catalog Polish

Use `Catalog.tsx` and `catalog.test.tsx`.

Do not rename canonical route or sidebar target. This task only polishes copy, empty states, result count and translation defense.

## Tests

### Table Editor Tests

Modify: `src/__tests__/table-editor.test.tsx`

Required assertions:

- `screen.queryByRole("button", { name: /Choose File/i })` is `null`.
- `screen.getByRole("button", { name: "导入 YAML" })` exists.
- `screen.getByTestId("table-editor-import-input")` has `aria-hidden="true"` and `tabIndex=-1`.
- `待处理建议` trigger is a button with `aria-expanded`.
- After expanding candidates:
  - `getByRole("button", { name: "确认写入 orders 关联" })` is unique.
  - no global duplicate accessible names for candidate actions.
- Batch adopt fills empty Human descriptions but does not overwrite existing Human descriptions.
- Sticky change state / inspector is present when manual editor is open.

### Catalog Tests

Modify: `src/__tests__/catalog.test.tsx`

Required assertions:

- Page title remains `语义资产`.
- Result count updates after search / filters.
- No-match empty state appears and suggests clearing filters or refreshing local Catalog.
- `semantic-layer YAML`, `Connection`, `Schema`, object refs use `notranslate` where rendered.
- Primary row action says `打开工作台`.

### Optional App Shell Test

Modify only if needed: `src/__tests__/app-shell.test.tsx`

- Sidebar semantic asset navigation still points to `/catalog`.

## Validation

Run from `webui/`:

```bash
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/table-editor.test.tsx src/__tests__/catalog.test.tsx
```

If app shell navigation changes:

```bash
npm test -- src/__tests__/app-shell.test.tsx
```

Browser validation is required for this work because the source issue is UI/UX and keyboard behavior:

1. Start the local WebUI.
2. Open `/catalog/demo-mysql/dataforai/superstore_orders`.
3. Expand `高级：手工维护语义字段`.
4. Switch to `字段`.
5. Confirm `Tab` can leave `搜索字段`.
6. Confirm `Tab` can leave a Human description textarea.
7. Scroll through fields and confirm `变更状态` / inspector remains visible.
8. Expand `待处理建议` and confirm contextual relation buttons.
9. Confirm no visible / accessible `Choose File` entry.
10. Check console logs for no new error/warn.

Do not run mobile viewport validation unless explicitly requested.

## Acceptance Checklist

- [ ] Keyboard focus can enter and leave all primary editor controls.
- [ ] Candidate join buttons include target context in accessible names.
- [ ] Native file input is hidden from user-facing accessibility tree.
- [ ] Long-page editing keeps change state and save/validate actions visible.
- [ ] Main workflow, pending suggestions, manual editing and raw inspector have clear hierarchy.
- [ ] Disclosure triggers are real buttons with `aria-expanded` and `aria-controls`.
- [ ] Field editor supports safe batch operations.
- [ ] `/catalog` copy, empty state and result count are polished.
- [ ] Terminology and translation defense pass.
- [ ] Table editor and catalog tests pass.
- [ ] Desktop browser validation confirms the original issues are fixed.
