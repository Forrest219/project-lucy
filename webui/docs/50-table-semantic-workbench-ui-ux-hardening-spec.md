# 表语义资产工作台 UI/UX Hardening Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Product / UX / Accessibility Spec |
| 状态 | Approved for planning |
| 撰写日期 | 2026-08-02 |
| 触发来源 | `/catalog/demo-mysql/dataforai/superstore_orders` 浏览器巡检与用户批准优化清单 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/42-page-header-standardization-spec.md`、`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`、`docs/DEVELOPMENT.md` |
| 主要页面 | `/catalog`、`/catalog/:conn/:schema/:table` |
| 主要文件 | `webui/src/pages/TableEditor.tsx`、`webui/src/pages/Catalog.tsx`、`webui/src/app/app.css`、`webui/src/__tests__/table-editor.test.tsx`、`webui/src/__tests__/catalog.test.tsx` |

## 1. Background

`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md` 已将语义资产目录 canonical 化到 `/catalog`，并把单表页收敛为导出、导入、校验、保存的表语义资产工作台。

2026-08-02 对 `http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders` 做浏览器模拟使用后，发现工作台功能完整，但仍有第二轮 UI/UX hardening 空间：

- 长页面编辑时，用户容易失去保存、校验、Dry-run 和 changed files 状态。
- 候选关联、手工维护、高级检查器等折叠区视觉上能点，但需要更明确的交互语义和可访问状态。
- 候选关联行内动作重复出现同名按钮，缺少目标上下文。
- 原生 file input 仍暴露为 `Choose File`，与 `导入 YAML` 主入口并存。
- 字段列表足够完整，但批量处理效率不足。
- `/catalog` 与表语义资产工作台仍存在术语和信息层级细节可打磨处。

本 Spec 是 M46 的后续 hardening，不改变 semantic-layer YAML 分层、保存 API、validate gate 或发布流程。

## 2. Goals

1. 修复键盘焦点陷阱，保证工作台主要控件可通过键盘进入、离开、操作。
2. 为候选关联按钮补充目标上下文，提升读屏、测试和误操作防护。
3. 隐藏原生 file input 的独立入口，只保留受控 `导入 YAML` 触发路径。
4. 在长页面编辑时提供状态常驻能力，让保存、校验、Dry-run、changed files、Unknown YAML Key 等关键信息保持可见。
5. 重构工作台信息层级，让主流程、待处理建议、高级维护和检查器职责清楚。
6. 将折叠控件真控件化，补齐 `button` / `aria-expanded` / `aria-controls` / 焦点样式。
7. 提供字段长列表批量编辑效率能力。
8. 统一术语，并打磨 `/catalog` 目录页的细节文案、层级和可扫描性。

## 3. Non-goals

- 不新增在线 LLM 生成语义能力。
- 不改变 `semantic-layer/<conn>/<table>.yaml` overlay 写入规则。
- 不改变 `Schema Manifest` 上传边界；单表页只处理 semantic overlay。
- 不实现移动窄屏专项体验，除非后续计划明确要求。
- 不把浏览器端确认写入关联改成发布审批流。
- 不引入新的设计系统或组件库。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `批量操作 (Batch Operations)`：字段长列表中对多条字段描述执行选择、采纳、清空或筛选动作的效率工具。UI 主术语使用 `批量操作`，括号内英文只允许在说明或测试命名中出现。
- `状态常驻`：长页面中让当前变更状态和主操作持续可见的布局模式。UI 文案优先描述用户可见对象，例如 `变更状态`、`保存变更`、`校验`，不把 `状态常驻` 作为按钮名。

Protected terms:

- `Connection`
- `Schema`
- `Catalog`
- `YAML`
- `semantic-layer`
- `overlay`
- `Diff`
- `Validate`
- `Dry-run`
- `Unknown YAML Key`

包含上述术语、数据库对象名、文件路径、URL、YAML 内容的 DOM 节点必须使用 `translate="no"` 和 `notranslate`。

Terminology decisions:

- `/catalog` 页面 UI 主标题继续使用 `语义资产`，不得回退为旧标题或历史别名。
- 单表页继续称为 `表语义资产工作台` 或在局部简称 `工作台`。
- 面向业务用户的聚合对象使用 `指标`；模型内部兼容名可显示 `Measures`，但同一区域必须给出中文主语义。
- `Join` UI 主术语为 `关联`，不得写作“加入”。

## 5. UX Requirements

### 5.1 修复键盘焦点陷阱

The page MUST:

- 允许用户从任一输入框按 `Tab` 移动到下一个可聚焦控件。
- 允许用户从任一输入框按 `Shift+Tab` 返回前一个可聚焦控件。
- 不在 `onKeyDown` 中拦截普通 `Tab`。
- 仅在 `Cmd+S` / `Ctrl+S` 命中时触发 Dry-run 预览，不影响输入、textarea、button、summary、tablist 的默认键盘行为。
- 为 `details` 替换后的折叠按钮、检查器 tab、候选关联动作、批量操作控件提供可见 focus ring。

Acceptance:

- 在字段搜索框中按 `Tab` 后，焦点能进入第一条可见字段卡片的操作按钮或人工描述 textarea。
- 在人工描述 textarea 中按 `Tab` 后，焦点能离开该 textarea；如需支持输入制表符，必须改成显式快捷键而不是默认拦截。
- `Cmd+S` / `Ctrl+S` 仍只刷新 Dry-run 预览并切到 `Diff`，不直接落盘。

### 5.2 候选关联按钮补充上下文

Candidate join row actions MUST expose the target table or relation in their accessible names.

Visible labels MAY stay compact:

- `确认写入`
- `保留`
- `不采用`

Accessible names MUST include context:

- `确认写入 orders 关联`
- `保留 customers 为候选关联`
- `标记 products 关联不采用`

The row SHOULD also expose a compact relation summary:

```txt
orders · 多对一
superstore_orders.order_id = orders.order_id
```

Acceptance:

- `getByRole("button", { name: "确认写入 orders 关联" })` 能唯一命中。
- 同一页面不再存在 5 个同 accessible name 的 `确认写入语义层` 按钮。
- 行内按钮仍不触发保存落盘；只有用户明确点击 `保存` 才写入正式 YAML。

### 5.3 隐藏原生 File Input 入口

The native file input MUST be implementation detail only.

Requirements:

- 原生 `<input type="file">` 不得在 accessibility tree 中以 `Choose File` 出现。
- `导入 YAML` 是唯一面向用户的文件选择入口。
- 原生 input 应设置 `tabIndex={-1}`，并使用 `aria-hidden="true"` 或等价隐藏策略。
- 受控入口需明确目标：`导入 semantic overlay YAML` 或上下文内的 `导入 YAML`。

Acceptance:

- 测试中 `screen.queryByRole("button", { name: /Choose File/i })` 返回 `null`。
- `table-editor-import-input` 仍可被代码触发并完成文件读取。
- `导入 YAML` 按钮可键盘聚焦并触发 file picker。

### 5.4 长页面编辑与状态常驻

The workbench MUST keep change state and primary actions visible while users edit long lists.

Recommended layout:

- Desktop / normal width: right-side sticky `变更状态` inspector.
- If width is insufficient: bottom sticky action bar.
- The current implementation MAY keep one inspector component and switch placement by CSS.

Persistent state MUST include:

- Completion status.
- Dry-run file count.
- Unknown YAML Key count.
- Validation status.
- Save pending/error status.
- Primary actions: `校验`、`保存变更`; `导出 YAML` / `导入 YAML` may remain in header if there is not enough space.

Acceptance:

- While scrolled inside `字段` section, the user can see whether there is a Dry-run preview and can trigger `校验` / `保存变更` without returning to page top.
- Sticky inspector does not cover form controls or table content.
- Header actions and sticky actions do not create duplicate accessible names without context.

### 5.5 信息层级重构

The table workbench MUST present four clear levels:

1. **身份与主动作**：表名、Connection、Schema、completion、导出、导入、校验、保存。
2. **语义资产交换**：粘贴 / 导入 YAML、导入文件、影响文件、Dry-run 结果。
3. **待处理与轻量编辑**：候选关联、字段描述、指标、分群、关联。
4. **高级检查器**：Diff、YAML、Validate raw detail。

Requirements:

- `待处理建议` 不应抢占首屏过多空间；展开后保留在当前上下文。
- `高级：手工维护语义字段` 的文案应说明它是辅助路径，不是主流程。
- `变更检查器` 的默认视图优先是摘要；raw Diff、raw YAML 和 Validate 细节保留但降低层级。

### 5.6 折叠控件真控件化

All collapsible regions MUST use an explicit controlled disclosure component instead of relying on ambiguous clickable generic containers.

Requirements:

- Trigger is a `button`.
- Trigger has `aria-expanded`.
- Trigger has `aria-controls`.
- Panel has stable `id`.
- Chevron or equivalent icon indicates collapsed/expanded state.
- `Enter` and `Space` toggle the panel.
- Focus ring is visible on the trigger.

Affected regions:

- `待处理建议`
- `高级：手工维护语义字段`
- `高级：查看原始 Diff`
- Catalog reload warning detail disclosures if touched in the same work.

Acceptance:

- Testing Library can assert collapsed/expanded state through `aria-expanded`.
- Browser visible UI shows a clear affordance before click.

### 5.7 长列表批量编辑效率

The field editor MUST add batch operations for common repeated work.

Minimum batch features:

- Multi-select visible fields.
- Select all filtered fields.
- Clear selection.
- Batch adopt AI descriptions into Human descriptions for selected fields.
- Filter by:
  - 全部字段
  - 缺少人工描述
  - 有 AI 建议
  - PK / Not Null

Safeguards:

- Batch adopt affects only selected / filtered fields, never hidden fields unless the action says `全部筛选结果`.
- Batch operation updates local form state and Dry-run preview; it does not save automatically.
- Before overwriting existing Human descriptions, the UI must distinguish `填充空白` from `覆盖已有` or require explicit confirmation.

Acceptance:

- Selecting `缺少人工描述` + `全选筛选结果` + `批量采纳 AI 描述` populates only matching field descriptions.
- Existing Human descriptions are not overwritten by the default batch action.
- The changed field count appears in the persistent change state or the batch toolbar.

### 5.8 `/catalog` 目录页细节打磨

Catalog page MUST remain the canonical semantic asset entry.

Requirements:

- Page title remains `语义资产`.
- Description should not overload users with implementation terms; keep `semantic-layer YAML` protected where shown.
- Filter order remains `搜索`、`Connection`、`Schema`、`语义状态`.
- Result count should be low-noise and update with filters.
- Table row primary action should be clear: `打开工作台`.
- Object names, `Connection`, `Schema`, paths and URLs use translation defense.
- Empty state should distinguish:
  - no data loaded,
  - no filter match,
  - Catalog reload needed.

Acceptance:

- `/catalog` has no PageHeader action noise unrelated to finding and opening semantic assets.
- Filtering to no match shows a recovery-oriented empty state.
- Table columns do not reintroduce duplicated `{schema}.{table}` display.

## 6. Accessibility Requirements

- All icon-only buttons must have accessible names.
- Repeated buttons must include row or object context in accessible name.
- Each form control must have a programmatic label, not only placeholder text.
- Focus order must follow visual order.
- Sticky regions must not trap focus.
- Status updates from import, dry-run, validate and save should use `role="status"` or `aria-live="polite"` where appropriate.
- Error states should use `role="alert"` only for blocking failures.

## 7. Test Requirements

Unit / component tests:

- `webui/src/__tests__/table-editor.test.tsx`
  - no `Choose File` accessible entry;
  - contextual candidate join button names;
  - controlled disclosure `aria-expanded`;
  - batch operations default non-overwrite behavior;
  - sticky / persistent change state renders while manual editor is open;
  - `Tab` is not blocked by table editor keydown handler where testable.
- `webui/src/__tests__/catalog.test.tsx`
  - `/catalog` copy, result count and empty states;
  - no duplicated table path in primary name cell;
  - terminology and translation defense for `Connection` / `Schema` / object names.
- `webui/src/__tests__/app-shell.test.tsx`
  - navigation still points to `/catalog`.

Lint / static tests:

- `npm run lint:terminology`
- `npm run lint:ia-boundary`

Browser validation:

Per `docs/DEVELOPMENT.md`, browser validation is required for this work because the source issue was browser-observed UI/UX behavior and keyboard navigation. Desktop viewport validation is sufficient unless a later plan explicitly asks for mobile.

Minimum browser checks:

- Open `/catalog/demo-mysql/dataforai/superstore_orders`.
- Confirm `Tab` can leave field search and manual description textarea.
- Confirm sticky change state remains visible while scrolled into fields.
- Confirm no visible or accessible `Choose File` entry.
- Confirm candidate relation actions expose target context.
- Confirm no console error/warn from these flows.

## 8. Rollout And Risk

Implementation should be staged:

1. Accessibility and file input fixes first because they are low visual risk and high value.
2. Candidate join button context and disclosure component migration next.
3. Sticky state layout after component semantics are stable.
4. Batch operations after field editor tests are in place.
5. Catalog polish last, to avoid mixing list IA changes with table editor risk.

Main risks:

- Sticky inspector may overlap content at medium widths; mitigate with CSS constraints and browser validation.
- Batch operations may accidentally overwrite Human descriptions; mitigate with default fill-empty behavior and tests.
- Changing `details` to controlled disclosure can break existing tests; migrate tests alongside component changes.

## 9. Acceptance Checklist

- [ ] Keyboard focus can enter and leave all primary editor controls.
- [ ] Candidate join action buttons have unique contextual accessible names.
- [ ] Native file input is hidden from user-facing accessibility tree.
- [ ] Long-page editing keeps change state and save/validate actions visible.
- [ ] Workbench hierarchy distinguishes main YAML exchange, pending suggestions, manual editing and raw inspector.
- [ ] Collapsible regions use controlled disclosure semantics.
- [ ] Field list supports safe batch operations.
- [ ] `/catalog` terminology, empty states and row scanning are polished.
- [ ] `npm run lint:terminology` passes.
- [ ] Relevant table editor and catalog tests pass.
- [ ] Desktop browser validation confirms the original UI/UX issues are resolved.
