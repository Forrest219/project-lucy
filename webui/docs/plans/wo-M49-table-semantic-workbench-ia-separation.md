# M49 Table Semantic Workbench IA Separation Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M49：表语义资产工作台 IA separation。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/42-page-header-standardization-spec.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/50-table-semantic-workbench-ui-ux-hardening-spec.md`
- `docs/51-table-semantic-workbench-ia-separation-spec.md`
- `src/pages/TableEditor.tsx`
- `src/pages/semantic/join-utils.ts`
- `src/app/app.css`
- `src/__tests__/table-editor.test.tsx`

目标：

重构 `/catalog/:conn/:schema/:table` 表语义资产工作台的信息架构，把“语义结果”和“维护手段”分开。当前表应成为页面左上锚点；`语义内容` 是统一维护结果；Claude Code / Codex YAML 交换是默认可见的维护手段；删除主页面 `待处理建议（N）` 候选关联区域。

## Scope

### Phase 1: Current Asset Header

1. 在 `TableEditor.tsx` 中重组页面 header / summary。
2. H1 保持当前表名，例如 `superstore_orders`。
3. 在 H1 附近展示 Connection / Schema context，例如 `demo-mysql / dataforai`。
4. 在同一区域展示摘要 chips：
   - completion
   - 字段数
   - 指标数
   - 分群数
   - 关联数
5. 删除 exchange 区域里的 `当前表 demo-mysql/dataforai/superstore_orders` metadata item。
6. 确保 Connection / Schema / table DOM 节点使用 `translate="no"` 和 `notranslate`。

### Phase 2: Semantic Content As The Unified Result

1. 将 `高级：手工维护语义字段` 改为 `语义内容`。
2. 删除或改写 “辅助路径：表描述、字段、指标、分群、关联” 这类把 direct edit 降级为辅助路径的说明。
3. 语义内容区默认展开，除非实现中已有明确状态要求必须保持用户偏好。
4. 保留现有编辑 sections：
   - `基础语义`
   - `字段`
   - `指标`
   - `分群`
   - `关联`
5. 从 overview / source tree 重复区移除：
   - `完整表名`
   - `字段数`
   - `关联数`
6. 不破坏字段批量操作、表描述、行粒度、指标、分群、关联编辑能力。

### Phase 3: Claude Code / Codex Maintenance Panel

1. 将 `语义资产交换` 重命名为 `Claude Code / Codex 辅助维护`，或使用等价标题但必须显式出现 `Claude Code / Codex`。
2. 该 panel 默认打开。
3. 重新布局 YAML exchange 状态：
   - `导入文件`
   - `影响文件`
   - Dry-run result summary
4. 这些状态必须和导出 / 粘贴 / 导入动作在同一维护手段上下文中左对齐展示。
5. 避免把 `导入文件`、`影响文件` 放在右侧或中部 detached metadata column。
6. 保留隐藏原生 File Input 和 `导入 YAML` 受控入口。

### Phase 4: Remove Prominent Candidate Suggestions

1. 从 `TableEditor.tsx` 删除 `CandidateJoinDisclosure` 渲染。
2. 删除表工作台中的 `待处理建议（N）` 标题和区域。
3. 删除表工作台中候选关联动作按钮：
   - `确认写入`
   - `保留`
   - `不采用`
4. 如果 `TableEditor.tsx` 不再需要候选数据，删除本页 `useQuery(queryKeys.joinCandidates)` 和 `visibleCandidates` derivation。
5. 保留 `JoinCandidate` types、`tableJoinCandidates`、`suggestedJoins`、`/api/joins/candidates`，除非确认没有任何其他页面或测试使用。
6. 不改 `.ktx-ui/join-candidates.json` 格式。

### Phase 5: Preserve Persistent Change State

1. 保留 M48 sticky `变更状态` inspector。
2. 删除候选建议后，检查主内容和 inspector 的 grid 间距，不留下异常空洞。
3. Sticky inspector 继续显示：
   - Dry-run count
   - Unknown YAML Key count
   - validation state
   - save pending / error
   - `校验`
   - `保存变更`
4. Header actions and sticky actions must keep contextual accessible names where duplicated.

### Phase 6: CSS Polish

1. 更新 `src/app/app.css`，支持新的 header summary、语义内容区和维护手段 panel。
2. 避免新增双层卡片。
3. 保持后台运维控制台密度：信息紧凑、左对齐、可扫描。
4. 不引入一页一色的大面积渐变或营销式 hero。
5. 确保按钮文字不溢出。

## Implementation Notes

### Remove Candidate Suggestions Safely

Start from `TableEditor.tsx`.

Expected removal:

```tsx
<CandidateJoinDisclosure
  candidates={visibleCandidates}
  onConfirm={handleConfirmCandidate}
  onKeep={handleKeepCandidate}
  onReject={handleRejectCandidate}
/>
```

If no remaining code uses these in `TableEditor.tsx`, remove:

- `candidatesQuery`
- `sidecarCandidates`
- `visibleCandidates`
- `handleConfirmCandidate`
- `handleKeepCandidate`
- `handleRejectCandidate`
- imports used only by candidate joins

Do not delete shared candidate utilities unless TypeScript shows they are unused across the project.

### Rename Manual Disclosure

Current M48 structure likely uses:

```tsx
<WorkbenchDisclosure
  id="manual-semantic-disclosure"
  title="高级：手工维护语义字段"
  summary="辅助路径：表描述、字段、指标、分群、关联"
>
```

Target:

```tsx
<WorkbenchDisclosure
  id="semantic-content-disclosure"
  title="语义内容"
  summary="基础语义、表描述、行粒度、字段、指标、分群、关联"
  defaultOpen
>
```

Keep an alias test id only if existing tests need transitional compatibility. Prefer updating tests to the new semantic name.

### Maintenance Panel

Current `语义资产交换` section should become a first-class maintenance-method panel.

Target layout sketch:

```txt
Claude Code / Codex 辅助维护
  导出 YAML
  粘贴 YAML
  导入 YAML
  导入文件: 未导入
  影响文件: 1
```

The panel can still include a controlled disclosure for `粘贴 YAML`, but the parent panel itself must be visible by default.

### Header Summary

Avoid repeating the same numbers in multiple places.

Allowed:

- Header chips show `30 字段`, `4 指标`, `3 分群`, `0 关联`.
- Left object tree may keep section labels and counts if they are navigation affordances.

Not allowed:

- A second overview card listing `完整表名`, `字段数`, `关联数` only as static metadata.

## Tests

Modify `src/__tests__/table-editor.test.tsx`.

Required assertions:

- Page shows `语义内容`.
- Page does not show `高级：手工维护语义字段`.
- `语义内容` disclosure has `aria-expanded="true"` by default if implemented as a disclosure.
- Page shows `Claude Code / Codex 辅助维护` or approved equivalent.
- Maintenance panel is visible by default.
- Page does not show `待处理建议`.
- Page does not show candidate action buttons from the removed candidate banner.
- Exchange metadata no longer contains `当前表`.
- `导入文件` and `影响文件` are rendered inside the maintenance panel.
- Sticky inspector still exposes:
  - `从变更状态校验`
  - `从变更状态保存变更`
- Hidden File Input tests still pass.
- Field batch operation tests still pass.
- Save / validate / import / export tests still pass.

Update or remove old candidate join tests:

- Remove tests that require expanding `待处理建议`.
- If candidate join utilities still have standalone unit tests, keep them out of `TableEditor` behavior tests.

## Validation Commands

Run:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
npm test -- src/__tests__/table-editor.test.tsx
```

If app shell or shared route behavior changes, also run:

```bash
cd webui
npm test -- src/__tests__/app-shell.test.tsx
```

Because this work order is based on browser-observed UX feedback, final implementation should include desktop browser validation at:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Browser validation checklist:

- Current table identity is anchored near the top-left page header.
- `语义内容` is visible and default-open.
- Claude Code / Codex maintenance panel is visible and default-open.
- `导入文件` and `影响文件` are left-aligned inside that panel.
- `待处理建议` is absent.
- Candidate action buttons are absent.
- Sticky `变更状态` remains visible after scrolling into long field content.
- Browser console has no warning or error caused by the refactor.

Do not run mobile / narrow viewport validation unless explicitly requested.

## Done Definition

- [ ] Spec requirements in `docs/51-table-semantic-workbench-ia-separation-spec.md` are implemented.
- [ ] `TableEditor.tsx` no longer renders prominent candidate suggestions.
- [ ] User-facing copy follows terminology standard.
- [ ] Focused tests and required lint pass.
- [ ] Browser validation has been performed if the implementation task explicitly permits browser validation.
- [ ] No semantic-layer YAML, sidecar data, or API migration is introduced.
