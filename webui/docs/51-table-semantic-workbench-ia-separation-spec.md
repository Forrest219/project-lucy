# 表语义资产工作台 IA Separation Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | Product / UX / IA Spec |
| 状态 | Approved for planning |
| 撰写日期 | 2026-08-02 |
| 触发来源 | `/catalog/demo-mysql/dataforai/superstore_orders` 浏览器核查与用户批准反馈 |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/42-page-header-standardization-spec.md`、`webui/docs/48-catalog-and-table-semantic-workbench-productization-spec.md`、`webui/docs/50-table-semantic-workbench-ui-ux-hardening-spec.md`、`docs/DEVELOPMENT.md` |
| 主要页面 | `/catalog/:conn/:schema/:table` |
| 主要文件 | `webui/src/pages/TableEditor.tsx`、`webui/src/pages/semantic/join-utils.ts`、`webui/src/app/app.css`、`webui/src/__tests__/table-editor.test.tsx` |

## 1. Background

M48 已修复表语义资产工作台的键盘焦点、候选关联按钮上下文、原生 File Input 暴露、状态常驻、真折叠控件和字段批量操作。

2026-08-02 在浏览器中复核 `http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders` 后，用户提出下一轮信息架构反馈：

- `语义资产交换` 是 Claude Code / Codex 主路径之一，但默认折叠。
- 当前表 `demo-mysql/dataforai/superstore_orders` 被放在右侧元信息列，不像正在编辑对象的左上锚点。
- `导入文件`、`影响文件` 与当前表一起放在右侧，视觉上像报表指标，不像维护流程状态。
- `待处理建议（5）` 来自 `_id` 字段名启发式推断，价值有限，可以删除。
- `高级：手工维护语义字段` 中重复出现 `完整表名`、`字段数`、`关联数` 等信息。

用户批准的核心产品原则是：

> 无论手工还是 Claude Code / Codex，都是维护的手段；其维护结果（基础语义、表描述、行粒度、字段、指标、分群、关联）应该统一呈现，只出现一次。维护的语义结果和维护手段要分开。

本 Spec 是 M48 后续 IA separation，不改变 semantic-layer YAML 分层、保存 API、validate gate 或发布流程。

## 2. Goals

1. 将单表页的信息架构重构为“当前语义资产 / 语义内容 / 维护手段 / 变更状态”四个职责清晰的区域。
2. 让当前表成为页面左上方的明确编辑对象，不再藏在中部或右侧元信息列。
3. 默认展开 Claude Code / Codex 辅助维护入口，让导出、粘贴、导入、Dry-run 状态成为可见主路径。
4. 删除表工作台中的 `待处理建议（N）` 区域，不再把 `_id` 字段名启发式候选关联作为主页面待办。
5. 将 `高级：手工维护语义字段` 改为中性的 `语义内容`，表达它是维护结果，而不是一种高级手工路径。
6. 去除语义内容区内的重复摘要信息，例如 `完整表名`、`字段数`、`关联数`。
7. 保留 M48 已完成的键盘可访问性、状态常驻、字段批量操作和隐藏 File Input 约束。

## 3. Non-goals

- 不删除 `/api/joins/candidates` API。
- 不删除 `.ktx-ui/join-candidates.json` sidecar 数据结构。
- 不重构独立 `JoinEditor` 页面，除非实现时发现编译或测试依赖必须同步调整。
- 不新增在线 LLM 生成语义能力。
- 不改变 `semantic-layer/<conn>/<table>.yaml` overlay 写入规则。
- 不改变 Catalog canonical route。
- 不实现移动窄屏专项体验，除非后续计划明确要求。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `语义内容`：单表语义资产中被维护的业务语义结果集合，包括基础语义、表描述、行粒度、字段、指标、分群、关联。UI 主术语使用 `语义内容`。
- `维护手段`：对同一份语义内容进行编辑、导出、导入、粘贴、校验的操作方式。UI 文案不强制展示该术语，可使用更具体的 `Claude Code / Codex 辅助维护`。

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

- 单表页可继续使用 `表语义资产工作台` 作为页面说明，但主编辑区标题必须表达结果对象，例如 `语义内容`。
- 不再使用 `高级：手工维护语义字段` 作为主区域标题。
- `Claude Code / Codex 辅助维护` 是维护手段，不是语义结果分组。
- `待处理建议` 不再出现在表工作台主页面。
- `Join` UI 主术语继续为 `关联`，不得写作“加入”。

## 5. Current Browser Findings

Browser validation target:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Observed issues:

1. `语义资产交换` disclosure default state is collapsed.
2. `当前表` is rendered in a right-side definition list at approximately the middle of the exchange section.
3. `导入文件` and `影响文件` are also rendered in the same definition list, causing state metadata to appear detached from the action flow.
4. `待处理建议（5）` expands to candidates generated from `_id` heuristic matching and sidecar candidates. The UI copy says the candidates come from `_id` heuristics and `字段名匹配`.
5. Manual editing area repeats table identity and counts:
   - `完整表名 dataforai.superstore_orders`
   - `字段数 30`
   - `关联数 0`

## 6. Target IA

The page MUST separate semantic result from maintenance methods.

Recommended structure:

```txt
PageHeader
  H1: superstore_orders
  Context: demo-mysql / dataforai
  Summary chips: done · 30 字段 · 4 指标 · 3 分群 · 0 关联
  Primary actions: 导出 YAML · 导入 YAML · 校验 · 保存

Main grid
  Left content column
    语义内容
      基础语义
      表描述
      行粒度
      字段
      指标
      分群
      关联

    Claude Code / Codex 辅助维护
      导出 YAML
      粘贴 YAML
      导入 YAML
      导入文件状态
      影响文件
      Dry-run result

  Right sticky column
    变更状态
      校验
      保存变更
      Diff / YAML / Validate
```

This structure can be implemented with existing components and CSS; it does not require a new design system.

## 7. UX Requirements

### 7.1 当前语义资产锚点

The page MUST make the current table the first visible working object.

Requirements:

- H1 remains the table name, e.g. `superstore_orders`.
- Connection and Schema context appears directly below or beside the H1:
  - `demo-mysql`
  - `dataforai`
- Summary chips appear near H1:
  - completion
  - field count
  - measure count
  - segment count
  - join count
- The old definition-list placement for `当前表` MUST be removed from the exchange section.

Acceptance:

- The first viewport exposes `superstore_orders` and `demo-mysql / dataforai` as the object being edited.
- `当前表 demo-mysql/dataforai/superstore_orders` no longer appears as a mid-page metadata item.
- Database object names are protected with `translate="no"` and `notranslate`.

### 7.2 语义内容作为统一结果

The semantic editing area MUST be result-oriented.

Requirements:

- Rename `高级：手工维护语义字段` to `语义内容`.
- Remove wording that frames direct editing as an advanced or secondary path.
- The semantic content area SHOULD be open by default, unless the page later introduces a route or persisted preference to deep-link into maintenance methods.
- Sections under semantic content continue to map to the existing editor sections:
  - `基础语义`
  - `字段`
  - `指标`
  - `分群`
  - `关联`
- Remove duplicate metadata from the semantic content overview:
  - `完整表名`
  - `字段数`
  - `关联数`

Acceptance:

- `高级：手工维护语义字段` is not visible on the page.
- `语义内容` is visible and explains the maintained result, not the editing method.
- Full table name and count summaries appear once near the page header or navigation, not again inside the overview panel.

### 7.3 Claude Code / Codex 辅助维护默认可见

The YAML exchange workflow MUST be discoverable without opening a collapsed disclosure.

Requirements:

- Rename `语义资产交换` to `Claude Code / Codex 辅助维护`, or keep `语义资产交换` as a smaller label only if the panel title clearly mentions Claude Code / Codex.
- The panel MUST be open by default.
- `粘贴 YAML` SHOULD be visible or one click away inside the already-open panel.
- `导入文件` and `影响文件` MUST live inside this maintenance-method panel, left-aligned with the relevant actions.
- Do not show `导入文件` and `影响文件` in a centered or detached metadata column.

Acceptance:

- On page load, the user can see the Claude Code / Codex workflow without expanding a collapsed disclosure.
- `导入文件` and `影响文件` read as status of the import / Dry-run process.
- The layout does not imply that the maintenance method owns the semantic result.

### 7.4 删除待处理建议

The table workbench MUST remove the prominent candidate join area.

Requirements:

- Remove `待处理建议（N）` from `/catalog/:conn/:schema/:table`.
- Remove `CandidateJoinDisclosure` rendering from the table workbench.
- Remove candidate join banner actions from the table workbench:
  - `确认写入`
  - `保留`
  - `不采用`
- The table page SHOULD stop fetching `/api/joins/candidates` if no remaining visible UI uses it.
- `tableJoinCandidates` and `/api/joins/candidates` MAY remain for compatibility with other pages.

Acceptance:

- Browser and tests do not find `待处理建议`.
- Browser and tests do not find candidate join action buttons on the table workbench.
- Existing semantic `关联` editor remains available under `语义内容`.
- Removing the prominent candidate area does not break save, validate, import, export, or field editing.

### 7.5 变更状态保持常驻

M48 persistent inspector remains required.

Requirements:

- Keep `变更状态` sticky behavior.
- Continue showing:
  - validation state
  - Dry-run count
  - Unknown YAML Key count
  - save pending / error state
  - `校验`
  - `保存变更`
- The inspector should summarize changes across both maintenance paths.

Acceptance:

- Scrolling long field lists does not hide save / validate state.
- Removing candidate suggestions does not leave empty space above the inspector.

### 7.6 Existing M48 Regressions Must Stay Fixed

The implementation MUST preserve:

- No ordinary `Tab` interception.
- Hidden native File Input.
- Controlled disclosures with `aria-expanded`.
- Contextual primary action labels where duplicated visible labels remain.
- Field batch operations.
- Catalog route and `/catalog` behavior.

## 8. Data And API Impact

No API contract changes are required.

Implementation guidance:

- If `TableEditor.tsx` no longer renders candidate joins, it should remove the `useQuery` call for `queryKeys.joinCandidates` from this page to avoid unnecessary network work.
- Keep `JoinCandidatesResponse`, `JoinCandidate`, `tableJoinCandidates`, and `suggestedJoins` if other pages or tests still use them.
- Do not delete `.ktx-ui/join-candidates.json`.
- Do not migrate or rewrite semantic-layer YAML.

## 9. Accessibility Requirements

- All remaining collapsible regions MUST keep `button`, `aria-expanded`, `aria-controls`, stable panel `id`, and visible focus ring.
- The new `语义内容` heading MUST be reachable by keyboard and screen reader landmarks.
- Summary chips near the page header must not replace text-only status; ensure status names are visible text.
- Repeated actions must have unique accessible names where they remain repeated.
- Removing candidate suggestions must not create orphaned `aria-controls` targets or empty regions.

## 10. Test Requirements

### Unit / Component Tests

Update `webui/src/__tests__/table-editor.test.tsx`:

- Assert `语义内容` is visible.
- Assert `高级：手工维护语义字段` is absent.
- Assert `Claude Code / Codex 辅助维护` or approved equivalent panel is open by default.
- Assert `待处理建议` is absent.
- Assert candidate join buttons are absent from table workbench.
- Assert `当前表` no longer appears in the exchange metadata list.
- Assert `导入文件` and `影响文件` appear inside the maintenance-method panel.
- Preserve existing tests for:
  - hidden File Input
  - `Cmd+S` / `Ctrl+S`
  - Tab non-interception
  - sticky inspector
  - field batch operations
  - save / validate / import / export behavior

### Static Lint

Run:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
```

### Focused Test Command

Run:

```bash
cd webui
npm test -- src/__tests__/table-editor.test.tsx
```

If shared components or app shell navigation are touched, also run:

```bash
cd webui
npm test -- src/__tests__/app-shell.test.tsx
```

### Browser Validation

Because this spec is based on browser-observed UX feedback, final implementation SHOULD include browser validation against:

```txt
http://127.0.0.1:55176/catalog/demo-mysql/dataforai/superstore_orders
```

Browser validation must confirm:

- `语义内容` is visible.
- Claude Code / Codex maintenance panel is open by default.
- Current table identity is anchored near the header.
- `导入文件` and `影响文件` are left-aligned inside the maintenance panel.
- `待处理建议` is not visible.
- Candidate join buttons are not visible.
- Sticky `变更状态` still works after scrolling.

Do not run mobile / narrow viewport validation unless explicitly requested.

## 11. Rollout And Compatibility

- This is a local WebUI IA change and can ship as a normal frontend update.
- Existing candidate join API and sidecar data remain available for future use.
- If users still need candidate join review, it should be handled in a dedicated `关联` editing context, not as a prominent table workbench area.
- No data migration is required.

## 12. Open Questions

None for M49 implementation.

Future consideration:

- Whether to remove or redesign the standalone `JoinEditor` route after observing actual usage.
- Whether Claude Code / Codex exchange state should remember the last open/closed preference per table.
