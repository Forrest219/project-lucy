# Wiki Workbench Secondary Feedback Fixes Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Workbench Secondary Feedback Fixes Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/74-wiki-workbench-secondary-feedback-fixes-spec.md`；用户对 7 条反馈的逐条拍板 |
| 适用范围 | 指导 `/wiki` 目录树层级视觉、内容模型、新建文档文案、正文标题去重、移动到目录弹窗精简、版本记录表格化与懒加载的实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-07-wiki-workbench-secondary-feedback-fixes.md` |

**Goal:** 落地 Spec 74 的 7 条修复：目录树层级引导线、目录树默认隐藏文档行、新建文档弹窗跳转新建目录、正文标题去重、移动到目录弹窗去重与移除 Diff、版本记录表格化与历史预览懒加载。

**Architecture:** 前端为主的行为与展示修复。不改后端 API 契约、不改 `wiki/` 存储模型；触及 `WikiTree`、`WikiNewDocumentDialog`、`WikiNewDirectoryDialog`（仅复用）、`WikiReadView`、`MarkdownPreview`、`WikiMoveDocumentDialog`、`WikiVersionHistoryDialog`、`WikiEditor`（状态与联动）、`app.css`、`wiki.test.tsx`。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行本工单，按 Phase 顺序实施并逐步验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/74-wiki-workbench-secondary-feedback-fixes-spec.md`
- `src/components/WikiTree.tsx`
- `src/components/WikiNewDocumentDialog.tsx`
- `src/components/WikiNewDirectoryDialog.tsx`
- `src/components/WikiReadView.tsx`
- `src/components/MarkdownPreview.tsx`
- `src/components/WikiMoveDocumentDialog.tsx`
- `src/components/WikiVersionHistoryDialog.tsx`
- `src/pages/WikiEditor.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`

## Non-Negotiable Boundaries

- 不新增后端 API，不改变 `wiki/` 物理存储、Markdown key、版本记录写入语义或 `fs-safe.ts` 安全边界。
- 不改变移动 / 恢复 / 删除目录的后端校验逻辑，只改前端展示与交互。
- 不引入 triangle / chevron glyph 作为目录层级视觉符号。
- 不做 `UX-WIKI-017`（展开/收起 affordance）、`UX-WIKI-018`（首页目录数口径）范围内的改动。
- 路径、文件名、目录 key、`versionId`/`contentHash`、表名等技术标识继续保留 `notranslate` / `translate="no"`。
- 本轮约束：完成后只做 code review，**不做浏览器验证**；验收以 Vitest + `lint:terminology` + `build` 为准。

## Scope

### Phase 1: Baseline Source Review

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "pl-wiki-tree-pages|pl-wiki-tree-page-button|renderPage|renderDirectory" src/components/WikiTree.tsx
rg -n "选择已有目录，或输入新的子目录路径" src/components/WikiNewDocumentDialog.tsx
rg -n "hideLeadingHeading|parseBlocks|renderBlocks" src/components/MarkdownPreview.tsx
rg -n "目标目录|wiki-move-diff|DiffViewer" src/components/WikiMoveDocumentDialog.tsx
rg -n "pl-wiki-version-item|selectedVersionId|useEffect" src/components/WikiVersionHistoryDialog.tsx src/pages/WikiEditor.tsx
```

预期：定位到 Spec 74 §5-9 描述的每一处现状代码。如果某处命中已经不存在（说明被其它工单先修了），先确认再决定是否跳过对应 Phase。

### Phase 2: WikiTree — Hierarchy Guide Lines (反馈 1)

修改 `src/app/app.css`：

1. 为 `.pl-wiki-tree-pages`（嵌套子列表，承载子目录 + 命中文档行）新增左侧引导线：例如
   ```css
   .pl-wiki-tree-pages {
     @apply border-l border-border-default/60 ml-2 pl-1;
   }
   ```
2. 顶层 `.pl-wiki-tree-list` 不加此规则。
3. 不使用 triangle / chevron glyph。

修改 `src/__tests__/wiki.test.tsx`：

1. 新增一个断言，读取 `src/app/app.css` 源文本（参考文件内已有的 `readFileSync("src/app/app.css", "utf8")` 用法），确认 `.pl-wiki-tree-pages` 规则包含 `border-l` 相关 class。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

### Phase 3: WikiTree — Directories Only By Default (反馈 2)

修改 `src/components/WikiTree.tsx`：

1. 在 `renderDirectory` 中，把：
   ```tsx
   {node.children.map((child) => renderDirectory(child, level + 1))}
   {node.pages.map((page) => renderPage(page, level + 1))}
   ```
   改为：只有当 `search.trim()` 非空时才渲染 `node.pages`：
   ```tsx
   {node.children.map((child) => renderDirectory(child, level + 1))}
   {search.trim() ? node.pages.map((page) => renderPage(page, level + 1)) : null}
   ```
2. 确认 `filterDirectoryTree` 在搜索命中时仍然把匹配的 `pages` 挂在对应目录节点上（现有逻辑已经如此，不需要改 `lib/wiki.ts`）。
3. 目录节点本身的展开/收起、创建子目录、创建文档、删除目录行为不变。

修改 `src/__tests__/wiki.test.tsx`（需要覆盖以下已存在的测试点，逐一核实并调整）：

1. `"groups pages by directory and shows document title without visible raw path"`（约第 1450 行）：
   - 先断言默认状态下 `within(tree).queryByRole("button", { name: /Superstore guide/ })` 为 `null`（不在 DOM 中）。
   - 再对 `wiki-tree-search` 输入 `"Superstore"`，断言文档行出现，标题文本仍为 `Superstore guide`。
2. `"prompts before navigating away from a dirty document"`（约第 938 行，使用 `tree.getByRole("button", { name: /Financial playbook/ })` 两次）：
   - 在两次点击前，先对 `wiki-tree-search` 输入匹配 `Financial playbook` 的搜索词，确保该行出现后再点击。
3. `"renders nested directories and keeps ancestor folders during search"`（约第 1472 行起）：
   - 该测试本身依赖搜索状态，多数断言可保持不变；确认末尾恢复默认视图（清空搜索）后的断言符合"默认只显示目录"的新预期（如原本断言某文档行在清空搜索后仍可见，需要改为断言不可见，或改为改用搜索词校验）。
4. `"search matches title, tag, and sl_ref"`（约第 1718 行）：
   - `// Reset search` 之后，`expect(within(tree).getByRole("button", { name: /POC active/ })).toBeInTheDocument();` 需要改为 `queryByRole(...)` + `not.toBeInTheDocument()`，因为清空搜索后默认视图不再展示文档行。
5. 全文搜索 `getByRole\("button", \{ name: /` 和 `wiki-tree-page` 相关断言，确认每一处点击/断言都发生在"已输入匹配搜索词"或"通过 URL key / WikiLibraryHome 进入"的路径下，而不是依赖默认树里能直接点到文档行。
6. 目录节点相关断言（如 `/ops\s*2\s*篇/`、`/playbooks\s*1\s*篇/` 等 `N 篇` 计数按钮）不受影响，保持原样。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected：全部通过；如有测试因为默认视图变化而红，按上面的调整思路逐条修正，不要放宽断言掩盖行为回归。

### Phase 4: WikiNewDocumentDialog — Jump To New Directory (反馈 3)

修改 `src/components/WikiNewDocumentDialog.tsx`：

1. 新增 prop：`onOpenNewDirectory?: (currentDirectory: string) => void`。
2. 在 `Dialog.Description` 下方新增一段轻量提示 + 按钮，例如：
   ```tsx
   <p className="pl-wiki-new-document-directory-hint">
     需要新建一个空目录？
     <button
       className="pl-inline-link"
       data-testid="wiki-new-document-open-directory"
       onClick={() => onOpenNewDirectory?.(directory)}
       type="button"
     >
       新建目录
     </button>
   </p>
   ```
3. 只有 `onOpenNewDirectory` 存在时才渲染该提示（保持向后兼容，不强制所有调用方都要传）。

修改 `src/pages/WikiEditor.tsx`：

1. 给 `<WikiNewDocumentDialog ... />` 增加：
   ```tsx
   onOpenNewDirectory={(currentDirectory) => {
     setNewDocumentOpen(false);
     setNewDocumentError(null);
     openNewDirectoryDialog(currentDirectory);
   }}
   ```
2. 确认 `openNewDirectoryDialog` 接受的 `parentDirectory` 参数类型和 `WikiNewDocumentDialog` 内部 `directory` state 的字符串格式一致（均为已 normalize 前的原始输入即可，`openNewDirectoryDialog` 内部会走 `normalizeDirectoryInput`）。

修改 `src/app/app.css`：

1. 新增 `.pl-wiki-new-document-directory-hint` 的紧凑样式（`text-xs text-fg-muted` 量级），复用已有的 `.pl-inline-link`。

修改 `src/__tests__/wiki.test.tsx`：

1. 新增测试：打开 `新建文档` 弹窗，点击 `wiki-new-document-open-directory`，断言 `wiki-new-document-dialog` 关闭、`wiki-new-directory-dialog`（或等价 testid，先在 `WikiNewDirectoryDialog.tsx` 确认真实 testid）打开，且其父级目录输入值等于点击前 `wiki-new-directory-input` 的值。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

### Phase 5: MarkdownPreview + WikiReadView — De-duplicate Leading Heading (反馈 4)

修改 `src/components/MarkdownPreview.tsx`：

1. `Props` 新增可选字段：`hideLeadingHeading?: string`。
2. 在 `MarkdownPreview` 函数体内：解析出 `blocks = parseBlocks(markdown)` 后，如果 `hideLeadingHeading` 有值、`blocks[0]?.kind === "heading"`、`blocks[0].level === 1`，且 `blocks[0].text.trim() === hideLeadingHeading.trim()`，则 `blocks = blocks.slice(1)` 再传给 `renderBlocks`。
3. 保持其余解析/渲染逻辑不变；不对 `hideLeadingHeading` 做大小写或模糊匹配。

修改 `src/components/WikiReadView.tsx`：

1. 调用处改为：
   ```tsx
   <MarkdownPreview hideLeadingHeading={title} markdown={content} />
   ```
2. 确认 `WikiVersionHistoryDialog.tsx`、Help Center 等其它 `MarkdownPreview` 调用点**不传** `hideLeadingHeading`（保持原有完整渲染行为）。

修改 `src/__tests__/wiki.test.tsx`：

1. 找到"renders Markdown preview content via MarkdownPreview"一类测试（约第 768 行），确认其 fixture 的 `frontmatter.summary` 与正文首个 `# ` 标题文本不同（当前已经是 `"Superstore guide"` vs `"Heading One"`，不受影响，不需要改）。
2. 新增一个专门测试：构造一个页面，其 `frontmatter.summary`（或首个 `# ` 标题）与正文第一行 `# ...` 完全一致，渲染 `WikiReadView`（通过 `renderWiki` + 对应 URL key），断言 `wiki-read-body` 内 `querySelectorAll("h1")` 长度为 0（因为唯一的 H1 已被去重），同时 `wiki-read-title` 仍然显示该标题文本。
3. 补充一个反例断言：正文首个标题与页面标题不同时（现有 `global/superstore-analysis-playbook.md` fixture 即是此例），`wiki-read-body` 内仍应保留该 H1（`querySelector("h1")` 存在，文本为 `Heading One` / fixture 对应文本）。
4. 确认 `WikiVersionHistoryDialog` 相关测试（约第 1405-1427 行）不受影响：历史预览的 `rawMarkdown` fixture（`# ${page.summary}\n\n历史版本内容`）应继续完整渲染其 H1，因为该调用路径不传 `hideLeadingHeading`。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

### Phase 6: WikiMoveDocumentDialog — De-duplicate Label + Remove Diff (反馈 5、6)

修改 `src/components/WikiMoveDocumentDialog.tsx`：

1. 目标目录去重：
   - 保留 `<h3 className="pl-wiki-preflight-section-title">目标目录</h3>`。
   - 将
     ```tsx
     <label className="pl-wiki-upload-directory">
       <span>目标目录</span>
       <input ... />
       <datalist ... />
     </label>
     ```
     改为去掉可见的 `<span>目标目录</span>`，给 `<input>` 增加 `aria-label="目标目录"`；`<datalist>` 保持原位（可以留在 `<label>` 内或紧跟其后，视 JSX 结构调整，保证渲染无误）。
2. 移除文档内容 / Diff：
   - 删除整段：
     ```tsx
     <section className="pl-wiki-preflight-section" data-testid="wiki-move-diff">
       <h3 className="pl-wiki-preflight-section-title">文档内容</h3>
       {isLoading ? (
         <p className="pl-notice">正在加载目标路径预览...</p>
       ) : (
         <DiffViewer diff={preview?.diff ?? ""} />
       )}
     </section>
     ```
   - 移除文件顶部 `import { DiffViewer } from "./DiffViewer";`（如果移除后该文件不再使用 `DiffViewer`）。
   - `isLoading` prop 继续用于 `确认移动` 按钮的 `disabled` 逻辑，不要因为删除了这段 UI 就顺手删掉 prop（除非确认该 prop 完全不再被任何地方使用）。

修改 `src/__tests__/wiki.test.tsx`：

1. 找到 `"moves the current document into another directory (UX-WIKI-011)"`（约第 1638 行），补充断言：
   - `within(dialog).queryAllByText("目标目录").length` 等于 `1`（section 标题唯一，input 不再有可见文本）。
   - `within(dialog).queryByTestId("wiki-move-diff")` 为 `null`；`dialog` 内不再包含 `文档内容` 文本。
2. 确认没有其它测试依赖 `wiki-move-diff` 或 Diff 内容渲染（前面 Baseline Review 已确认无命中，这里只需保持无回归）。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

### Phase 7: WikiVersionHistoryDialog — Table + Lazy Preview (反馈 7)

修改 `src/components/WikiVersionHistoryDialog.tsx`：

1. 把 `历史版本` section 内的渲染从 `versions.map((version) => <article ...>...)` 改为一个 `<table className="pl-wiki-version-table" data-testid="wiki-version-table">`：
   - `<thead>`：`<tr><th>时间</th><th>操作类型</th><th>版本</th><th>操作</th></tr>`。
   - `<tbody>`：每个 `version` 一个 `<tr data-testid={\`wiki-version-item-${version.versionId}\`} className={clsx("pl-wiki-version-row", selectedVersionId === version.versionId && "pl-wiki-version-row--active")}>`：
     - `<td>`：`<time dateTime={version.createdAt}>{formatVersionTime(version.createdAt)}</time>`。
     - `<td>`：`OPERATION_LABELS[version.operation]`，如有 `sourceFileName` / `restoredFromVersionId`，作为该单元格内的次级 `<span className="pl-wiki-version-row-note">` 文本（保留原有来源/恢复来源文案）。
     - `<td>`：`<code className="notranslate" translate="no">{version.versionId}</code>`。
     - `<td>`：`查看` 按钮（`data-testid={\`wiki-version-view-${version.versionId}\`}`）+ `恢复此版本` 按钮（`data-testid={\`wiki-version-restore-${version.versionId}\`}`），行为不变。
   - 空状态 / 加载态段落（`暂无历史版本...` / `正在加载版本记录...`）保持在 `<table>` 外或替换 `<tbody>` 内容，视实现取整洁的方式，保留原文案。
2. `历史预览` section（右侧）逻辑本身不需要改（已经是"有 `selectedVersion` 才渲染，否则显示占位文案"），只需确保触发它的数据源（`selectedVersionId`）不再被自动填充（见 Phase 7.2）。

修改 `src/pages/WikiEditor.tsx`：

1. 删除以下自动选中逻辑：
   ```tsx
   useEffect(() => {
     if (!versionHistoryOpen || selectedVersionId || !versionsQuery.data?.versions.length) {
       return;
     }
     setSelectedVersionId(versionsQuery.data.versions[0].versionId);
   }, [selectedVersionId, versionHistoryOpen, versionsQuery.data]);
   ```
2. 确认 `openVersionHistory` 里已有的 `setSelectedVersionId(null)` 保留不变（弹窗打开时清空选中状态）。
3. 确认删除该 `useEffect` 后没有留下未使用的 import（例如如果 `useEffect` 仅此一处使用，不要整体删掉 `useEffect` import，因为文件内其它地方也大量使用它；只删这一个 effect 块）。

修改 `src/app/app.css`：

1. 新增/调整 `.pl-wiki-version-table`、`.pl-wiki-version-row`、`.pl-wiki-version-row--active`、`.pl-wiki-version-row-note` 等样式，替代或补充原 `.pl-wiki-version-item*` 规则（如果 `.pl-wiki-version-item*` 不再被使用，可以移除；如果还被其它地方引用，先确认再决定是否保留）。

修改 `src/__tests__/wiki.test.tsx`：

1. 找到 `"opens version history, previews a historical Markdown version and restores it"`（约第 1405 行）：
   - 打开 `版本记录` 弹窗后，**先**断言 `screen.queryByTestId("wiki-version-markdown-preview")` 和 `screen.queryByTestId("wiki-version-diff")` 均为 `null`（懒加载，默认不渲染）。
   - 断言右侧显示占位文案"选择一个历史版本查看 Markdown 预览和 Diff。"
   - 再点击 `wiki-version-view-v-upload-replace`，保留原有后续断言（Markdown 预览、Diff、恢复此版本、恢复预检）。
2. 新增断言：`wiki-version-list` 内存在 `<table>`（`container.querySelector("table")` 或 `within(dialog).getByRole("table")`），且表头文本包含"时间""操作类型""版本""操作"。
3. 确认 `wiki-version-item-${id}` 等既有 `data-testid` 断言（如果有）在结构改成 `tr` 后仍能正常 `getByTestId` 命中（Testing Library 不关心标签名，只要 `data-testid` 还在就能查到）。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

### Phase 8: Full Verification

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

Expected：全部 PASS。`npm run build` 允许保留当前已知 Vite chunk size warning。

如果仓库内还有其它引用了本次改动组件的测试文件（例如 catalog 侧通过 `sl_ref` 跳转到 Wiki 的集成测试），额外跑一次：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/catalog.test.tsx
```

确认没有意外回归。

### Phase 9: Ledger Update

修改 `docs/ui-ux-feedback/pages/wiki.md`：

1. 新增 `UX-WIKI-019` ~ `UX-WIKI-025`，一一对应 Spec 74 §5-9 的 7 条修复（1→019，2→020，3→021，4→022，5→023，6→024，7→025）。
2. 每条包含 Feedback / Evidence（引用本次浏览器核查的截图路径与 DOM 证据）/ Expected / Browser Check（照抄 Spec 里对应的验收描述，即使本轮不执行，也要为后续排期的浏览器复核留档）/ Notes（记录本工单修复的文件列表）。
3. 状态标记为 `Fixed`（因为本轮明确不做浏览器验证，不能标 `Verified`；等后续有人跑通浏览器复核后再升级）。

## Acceptance Criteria

- `WikiTree` 默认状态下不渲染任何具体 Markdown 文档行，只渲染目录 + `N 篇` 计数；搜索状态下文档行可正常出现和消失。
- 嵌套目录列表存在层级引导线样式（`app.css` 断言可验证）。
- `新建文档` 弹窗提供跳转到 `新建目录` 的入口，携带当前目标目录作为默认父级。
- 打开任意 Markdown 文档时，`wiki-read-body` 内不再重复渲染与页面标题相同的首个 H1；标题与正文首个标题不同的场景不受影响；`WikiVersionHistoryDialog` 历史预览等其它 `MarkdownPreview` 调用点不受影响。
- `WikiMoveDocumentDialog` 内"目标目录"文案只出现一次，且不再渲染"文档内容"/ Diff 区域。
- `WikiVersionHistoryDialog` 左侧改为语义表格，右侧"历史预览"默认不加载任何内容，只有点击"查看"后才渲染。
- `npm run lint:terminology`、`npm test -- src/__tests__/wiki.test.tsx`、`npm run build`、`git diff --check` 全部通过。
- 台账 `docs/ui-ux-feedback/pages/wiki.md` 新增 `UX-WIKI-019` ~ `UX-WIKI-025`，状态为 `Fixed`。

## Code Review Checklist

- [ ] `WikiTree` 搜索为空时不渲染任何 `pl-wiki-tree-page`；搜索命中时正确渲染并可点击进入文档。
- [ ] 目录层级引导线样式只作用于嵌套列表，不影响顶层目录列表和其它使用 `pl-wiki-tree-*` 的地方。
- [ ] `新建文档` → `新建目录` 跳转正确关闭前一个弹窗、打开后一个弹窗，且没有产生"两个弹窗同时打开"的状态。
- [ ] `MarkdownPreview` 的 `hideLeadingHeading` 只在 `WikiReadView` 一处传入，其它调用点未受影响。
- [ ] `WikiMoveDocumentDialog` 不再 import 未使用的 `DiffViewer`（若彻底不再使用）；`preview.diff` 后端字段未被删除（仅前端不渲染）。
- [ ] `WikiVersionHistoryDialog` 表格化后，`data-testid` 契约（`wiki-version-item-*`、`wiki-version-view-*`、`wiki-version-restore-*`）保持不变，未破坏既有调用方或潜在的 E2E 依赖。
- [ ] 移除"自动选中第一个版本"的 `useEffect` 后，`WikiEditor.tsx` 内没有残留未使用的状态或死代码。
- [ ] 所有新增/调整的可见文案符合 `webui/docs/00-product-terminology-standard.md`，路径 / key / versionId 等技术标识保留 `notranslate` / `translate="no"`。
- [ ] 改动范围与 Spec 74 一致，没有夹带无关重构或格式化。
- [ ] 不涉及后端 API、路由或 `fs-safe.ts` 安全边界的改动。
