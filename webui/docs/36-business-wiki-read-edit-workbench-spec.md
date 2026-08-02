# Business Wiki Read/Edit Workbench Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Read/Edit Workbench Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M33-business-wiki-read-edit-workbench.md` |
| 事实源 | 截图审阅：`/wiki?key=global%2Fnew-note.md`；代码审阅：`webui/src/pages/WikiEditor.tsx`、`webui/src/components/FrontmatterForm.tsx`、`webui/src/components/WikiInspector.tsx`、`webui/src/components/SlRefPicker.tsx`、`webui/src/app/app.css` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`, `webui/docs/03-api-spec.md`, `webui/docs/06-navigation-ia.md`, `webui/docs/13-business-wiki-ux-refactor.md`, `webui/docs/29-connection-semantic-boundary-automation-spec.md`, `docs/DEVELOPMENT.md` |

## 1. 背景

当前 `/wiki` 页面已经具备 Wiki 列表、`sl_ref` 自动匹配、frontmatter 编辑、Markdown 编辑、Dry-run diff 和保存能力。但截图中的首屏暴露出一个高优先级产品问题：用户进入“业务文档”模块后，看到的是三块割裂的编辑器界面，而不是一篇可阅读、可运维、可关联语义资产的业务文档。

典型困惑：

1. 页面默认打开 `global/new-note.md` 空草稿，像在改代码文件。
2. 左侧列表显示裸路径，用户不知道文档标题、用途、覆盖了哪些语义对象。
3. 中间的“页面元信息”和正文编辑占据同等权重，创作空间被压缩。
4. 右侧默认展示 Diff / Raw 等开发概念，业务用户不理解其日常价值。
5. 页面没有明确说明 Wiki 维护的是 Markdown 业务说明，不接受 Schema Manifest 或 semantic overlay YAML。

本规格将 `/wiki` 从“Markdown 文件编辑器”升级为“业务 Wiki 工作台”：默认阅读、按需编辑、语义资产双向锚定、运维状态可见。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 读写分离 | 默认进入 Read Mode；点击 `编辑` 后才进入 Edit Mode |
| P0 | 沉浸式编辑 | Edit Mode 将 80% 以上主工作区给 Markdown 编辑器；元信息收纳到顶部 Meta Header 或折叠面板 |
| P0 | 降维开发概念 | 常规预览只保留渲染效果；Diff / Raw 移到保存预检或次级历史入口 |
| P0 | 边界说明 | 页面明确维护 `.md` / Markdown 业务 Wiki；YAML 资产走对应模块 |
| P1 | 文档目录树 | 左侧从裸路径列表升级为 Tree View，优先展示文档标题 |
| P1 | 资产联动 | 文档头部展示关联语义对象 Badge；点击可跳转表目录 / 表详情 |
| P1 | 反向挂载 | 表目录 / 表详情展示相关业务 Wiki 链接 |
| P2 | 智能化与治理 | 模板库、从 YAML 生成草稿、覆盖率 Dashboard、版本历史与审阅 |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 降低理解成本 | 用户进入业务文档模块后，第一眼看到的是可阅读文档，而不是源码编辑器 |
| 提升 Markdown 运维效率 | 写作时有清晰模板、预览和保存预检，避免误把 Diff 当正文 |
| 强化语义层关系 | Wiki 与 `Connection / Schema / Table` 双向可达 |
| 保持 SaaS 工作台密度 | 界面克制、信息密度高、适合反复运维 |
| 保持现有安全边界 | 继续只读写 `wiki/**/*.md`，不引入 YAML 写入或上传 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不新增 Wiki 后端 API | 现有 `GET /api/wiki`、`GET /api/wiki/:key`、`PUT /api/wiki/:key` 足够支撑 P0 / P1 |
| 不引入富文本编辑器 | 本轮保留 Markdown 源码编辑，避免编辑器依赖和安全面扩大 |
| 不把 YAML 上传并入 Wiki | Schema Manifest 与 semantic overlay 已有明确模块边界 |
| 不做完整版本历史系统 | P0 只把 Diff 从日常区移到保存预检；历史版本属于 P2 |
| 不改变 KTX runtime prompt | Wiki 内容如何被 Agent 使用不在本轮修改 `webui/config/data-qa-instructions.md` |

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Read Mode | 阅读态 | 业务 Wiki 默认查看状态 |
| Edit Mode | 编辑态 | 点击 `编辑` 后进入的 Markdown 编辑状态 |
| Meta Header | 文档信息 | 文档标题、摘要、标签、关联语义对象等元信息区域 |
| Tree View | 目录树 | 左侧按目录层级展示 Wiki 文档 |
| Save Preflight | 保存预检 | 保存前展示校验、Diff 和目标文件信息 |
| Bi-directional Links | 双向关联 | Wiki 与表目录 / 表详情互相跳转 |

Required UI terms:

| 概念 | UI 主术语 | 禁止文案 |
|---|---|---|
| Business Wiki | 业务 Wiki / Wiki 文档 | 维基文档作为主导航混用 |
| Markdown Document | Markdown 文档 | YAML 文档 |
| Read Mode | 阅读态 | 预览态作为页面主状态 |
| Edit Mode | 编辑态 | 代码模式 |
| Semantic Object | 关联语义对象 | 关联架构、关联模式 |
| Save Preflight | 保存预检 | 提交代码、Git 提交 |
| Render Preview | 渲染预览 | 常规预览中显示 Raw / Diff |

Browser translation defense is mandatory for:

- `Wiki`、`Markdown`、`Diff`、`Raw`、`Schema`、`Manifest`、`Catalog`、`YAML`。
- Wiki key，例如 `global/new-note.md`。
- `sl_ref`、`mysql-aliyun/dataforai/superstore_orders`。
- 文件路径，例如 `wiki/global/superstore-analysis-playbook.md`。

## 5. P0 Scope: 读写分离与沉浸式编辑

### 5.1 Read Mode

用户打开 `/wiki` 或点击左侧文档时，默认进入阅读态。

Required layout:

```text
PageHeader
└─ Business Wiki Workbench
   ├─ Left: Wiki Tree / Search
   ├─ Main: Read Article
   │  ├─ Title
   │  ├─ Meta Header: summary, tags, linked semantic objects
   │  ├─ Rendered Markdown body
   │  └─ Empty guidance if draft / empty doc
   └─ Right: Article TOC / Health / Related Objects
```

Read Mode requirements:

| Area | Contract |
|---|---|
| Header primary action | `编辑` |
| Secondary actions | `新建 Wiki`、`复制链接`、可选 `更多` |
| Article title | Prefer first Markdown `#` heading; fallback to frontmatter title if later introduced; fallback to basename without `.md` |
| Meta Header | Shows summary, tags, `sl_refs` badges, saved/draft status |
| Body | Uses existing `MarkdownPreview`; no textarea in default view |
| TOC | Generated from `##` / `###` headings; hidden or empty-state if no headings |
| Empty draft | Shows template choices and explanation, not a blank editor |

### 5.2 Edit Mode

点击 `编辑` 后进入编辑态。编辑态可以通过 URL state、local state 或 query param 表达，但刷新页面时必须可恢复到当前 key。

Required layout:

```text
Edit Toolbar
├─ 返回阅读
├─ 保存
├─ 保存预检
└─ 状态：未保存 / 已保存 / 预检失败

Meta Header 或折叠“文档信息”

Main Editing Surface
├─ Markdown source editor
└─ Render preview panel 或 Preview tab
```

Edit Mode requirements:

| Area | Contract |
|---|---|
| Markdown editor | Occupies at least 80% of main vertical working area on 1440x900 desktop |
| Meta fields | `关联语义对象`、`标签`、`摘要` displayed as compact top panel; advanced fields collapsed by default |
| Preview | Day-to-day preview is rendered Markdown only |
| Diff / Raw | Not shown as persistent right panel; moved to Save Preflight dialog or secondary `更多` menu |
| Unsaved changes | Switching docs or returning to read mode warns or preserves draft |
| Keyboard | `Cmd/Ctrl + S` should trigger save preflight or save behavior defined in implementation; it must not silently only refresh diff without clear copy |

### 5.3 Save Preflight

Saving should be treated as an operation, not a permanent diff viewer.

Required content:

| Section | Content |
|---|---|
| Target | `wiki/<key>` |
| Validation | Missing title, empty body, unknown `sl_refs`, empty summary, broken Markdown table if detectable |
| Diff | Existing `DiffViewer` output |
| Raw | Optional collapsed section showing proposed Markdown |
| Actions | `取消`、`继续编辑`、`保存` |

The preflight may be a Drawer or Modal. It should not become a fourth permanent card in the normal workspace.

### 5.4 YAML Boundary Education

When users create a new Wiki or land on empty draft, show a concise boundary hint:

```text
Wiki 维护 Markdown 业务说明。Schema Manifest 请在连接概览上传；semantic overlay 请在表目录或表详情维护。
```

Do not add YAML upload controls to `/wiki`.

## 6. P1 Scope: 资产联动与导航增强

### 6.1 Tree View

Left navigation must move from flat file buttons to a document tree.

Required behavior:

| Capability | Contract |
|---|---|
| Tree grouping | Split Wiki keys by `/`, e.g. `global/`, `kx/`, `poc/` |
| Display title | Prefer Markdown first heading; fallback to `frontmatter.summary`; fallback to basename |
| File path | Still available as secondary muted text or tooltip |
| Search | Top search supports title, path, tags, `sl_refs`, summary |
| Counts | Directory node may show document count |
| Active state | Current page clearly highlighted |

### 6.2 Semantic Object Badges

Read and Edit modes both show linked semantic objects as badges.

Required behavior:

| Badge state | Behavior |
|---|---|
| Known `sl_ref` | Shows `schema.table` or `connection.schema.table`; click jumps to `/sources/:conn/:schema/:table` |
| Unknown `sl_ref` | Shows warning style and copy `未知语义对象` |
| Multiple refs | Wrap cleanly without changing header height unpredictably |

### 6.3 Reverse Wiki Mounting

Table catalog and table detail must expose related Wiki links.

Required locations:

| Page | Requirement |
|---|---|
| 表目录 | Row action or compact badge `业务 Wiki` when a Wiki references that table |
| 表详情 | Metadata / inspector area lists related Wiki documents |
| Wiki | Linked object badge jumps back to table detail |

This completes the bidirectional loop:

```text
表目录 / 表详情 -> 业务 Wiki -> 关联语义对象 -> 表详情
```

## 7. P2 Roadmap

P2 is not required for the first implementation, but should guide future design:

1. Markdown template library for `表使用说明`、`指标口径`、`分析 Playbook`、`FAQ / 注意事项`。
2. Generate Wiki draft from Schema Manifest + semantic overlay, using YAML as source material but writing `.md` only.
3. Wiki coverage dashboard: missing docs, stale docs, unknown refs, high-value tables without Wiki.
4. Version history and Review integration.
5. Agent visibility preview: show how `wiki_search` / `wiki_read` would surface the document.
6. Bulk Markdown import with frontmatter validation.

## 8. Component Requirements

### 8.1 `WikiEditor`

Expected responsibilities:

- Own current key, page mode and read/edit state.
- Continue resolving `?key` and `?sl_ref`.
- Render Read Mode by default.
- Render Edit Mode after `编辑`.
- Preserve existing dry-run and save behavior through a Save Preflight flow.
- Prevent accidental loss of unsaved edits.

### 8.2 `WikiReadView`

New component recommended.

Responsibilities:

- Render title, summary, tags, linked semantic object badges.
- Render Markdown body with `MarkdownPreview`.
- Generate and display TOC.
- Show clear empty-state template options for blank drafts.

### 8.3 `WikiEditView`

New component recommended.

Responsibilities:

- Render compact Meta Header / collapsible `文档信息`.
- Render Markdown source editor and rendered preview.
- Keep Diff / Raw out of daily editing surface.

### 8.4 `WikiTree`

New component recommended.

Responsibilities:

- Build tree from Wiki keys.
- Search title, summary, tags and refs.
- Preserve active page state.
- Avoid exposing only raw paths as the primary label.

### 8.5 `WikiSavePreflight`

New component recommended.

Responsibilities:

- Present validation findings.
- Show target path and diff.
- Confirm final save.

## 9. Accessibility And Responsiveness

| Area | Requirement |
|---|---|
| Mode switch | `编辑` and `返回阅读` are buttons with clear accessible names |
| Tree View | Use `tree` / `treeitem` semantics or accessible buttons with hierarchy labels |
| TOC | Anchor links have readable labels and stable focus behavior |
| Save Preflight | Modal / Drawer traps focus and announces errors |
| Mobile | Read Mode stacks as Tree -> Article -> Meta/TOC; Edit Mode avoids three-column layout |
| Long paths | Wiki keys and `sl_refs` wrap or truncate inside stable containers |
| Translation defense | Professional terms and literal paths protected per terminology standard |

## 10. Testing Requirements

Update `webui/src/__tests__/wiki.test.tsx` to cover:

1. `/wiki?key=<existing>` opens in Read Mode by default and does not show the Markdown textarea.
2. Read Mode renders title, summary, tags, linked semantic object badges and rendered Markdown.
3. Clicking `编辑` enters Edit Mode and shows Markdown source editor.
4. Edit Mode shows compact `文档信息` and rendered preview, but not persistent Diff / Raw tabs.
5. Save opens Save Preflight with target path and diff.
6. Confirming Save sends `dryRun:false` to `PUT /api/wiki/:key`.
7. `?sl_ref=<conn/schema/table>` still matches existing Wiki pages or creates a seeded draft.
8. Tree View displays document title as primary label and path as secondary text.
9. Search matches title, tags and `sl_refs`.
10. Known semantic object badges link to `/sources/:conn/:schema/:table`.
11. Unknown `sl_ref` displays warning state but remains saveable.
12. Empty draft shows Markdown template options and YAML boundary hint.

Update related tests as needed:

- `webui/src/__tests__/app-shell.test.tsx` if navigation labels or route defaults change.
- `webui/src/__tests__/catalog.test.tsx` or table-detail tests if reverse Wiki mounting touches Catalog / table editor.
- `webui/src/__tests__/lint-terminology-scan.test.ts` only if new UI copy requires terminology fixture updates.

Run:

```bash
cd webui
npm test -- --run src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
```

Before final delivery, run full `npm test` unless the change remains isolated and explicitly accepted as focused-only.

## 11. Acceptance Criteria

P0 acceptance:

1. `/wiki` and `/wiki?key=...` default to Read Mode.
2. Read Mode looks like a clean business document page, not a code editor.
3. Edit Mode is available only after clicking `编辑`.
4. The Markdown editor is the dominant editing surface; meta fields no longer consume equal visual weight.
5. Diff / Raw are not persistent daily preview tabs.
6. Save Preflight shows validation and diff before write.
7. Empty draft explains Wiki vs YAML boundaries and offers Markdown templates.

P1 acceptance:

1. Left navigation is a searchable Tree View.
2. Document title is the primary list label; raw path is secondary.
3. Wiki pages show linked semantic object badges.
4. Known badges jump to table detail.
5. Table catalog or table detail shows related Wiki links.

Quality gates:

1. Existing Wiki `sl_ref` handoff behavior remains intact.
2. Existing Markdown rendering remains safe: raw HTML escaped, dangerous links disabled.
3. `npm run lint:terminology` passes.
4. Focused Wiki tests pass.
5. `npm run build` passes.

## 12. Risks And Boundaries

| Risk | Mitigation |
|---|---|
| Read/Edit split adds state complexity | Keep URL key as source of truth; use local mode state or `?mode=edit` only for UI mode |
| Users miss Diff if hidden | Surface Diff in Save Preflight and optional secondary menu |
| Tree titles require reading page details | Use list summaries first; progressively enhance title from loaded page or add title extraction later |
| `sl_ref` relation becomes stale | Unknown badge warning and validation warning |
| Scope creep into docs AI generation | Keep P2 generation as roadmap, not P0/P1 requirement |
