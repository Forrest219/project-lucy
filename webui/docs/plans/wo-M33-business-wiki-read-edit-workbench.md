# M33 Business Wiki Read/Edit Workbench Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `/wiki` from a Markdown file editor into a SaaS-grade Business Wiki workbench with default reading, focused editing, save preflight, tree navigation and semantic-object links.

**Architecture:** Keep the existing Wiki API contract and Markdown storage model. Refactor the frontend into read/edit subviews, introduce a Save Preflight flow over the existing dry-run API, and progressively enhance navigation and semantic links without adding YAML upload or backend write paths.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, existing MarkdownPreview, DiffViewer, Vitest, Testing Library, existing CSS utility layer. No new runtime dependency unless separately approved.

**Source Spec:** [../36-business-wiki-read-edit-workbench-spec.md](../36-business-wiki-read-edit-workbench-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/03-api-spec.md`
- `webui/docs/13-business-wiki-ux-refactor.md`
- `webui/docs/36-business-wiki-read-edit-workbench-spec.md`

Inspect these implementation files:

- `webui/src/pages/WikiEditor.tsx`
- `webui/src/components/FrontmatterForm.tsx`
- `webui/src/components/WikiInspector.tsx`
- `webui/src/components/MarkdownPreview.tsx`
- `webui/src/components/SlRefPicker.tsx`
- `webui/src/components/TagInput.tsx`
- `webui/src/lib/slRef.ts`
- `webui/src/app/app.css`

Inspect these tests:

- `webui/src/__tests__/wiki.test.tsx`
- `webui/src/__tests__/app-shell.test.tsx`
- Catalog or table-detail tests that cover `业务 Wiki` links, if present.

Non-negotiable boundaries:

- Do not add YAML upload to `/wiki`.
- Do not change the backend Wiki API unless a later spec explicitly requires it.
- Do not write outside `wiki/**/*.md`.
- Do not edit `webui/config/data-qa-instructions.md` or runtime prompt files.
- Do not remove existing `?sl_ref` auto-match and seeded-draft behavior.
- Do not render Markdown via unsafe HTML.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请实现 `webui/docs/36-business-wiki-read-edit-workbench-spec.md`。

交付：

1. `/wiki` 默认进入阅读态，展示干净的业务文档页面、Meta Header、关联语义对象 Badge 和右侧 TOC。
2. 点击 `编辑` 后进入编辑态，编辑区聚焦 Markdown，元信息收纳为顶部文档信息区。
3. 日常预览只显示渲染效果；Diff / Raw 移入 `保存预检`。
4. 空草稿展示 Markdown 模板选项和 Wiki / YAML 边界说明。
5. 左侧文档导航升级为可搜索目录树，优先显示文档标题。
6. 已知 `sl_ref` 可跳转表详情；表目录或表详情反向展示相关业务 Wiki 链接。
7. 更新测试并运行聚焦测试、术语 lint、build。

收尾说明必须列出修改文件、验证命令和结果。

## Task 1: Capture Read Mode Default Behavior

**Files:**

- Modify: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add a failing test for Read Mode**

Add a test rendering `/wiki?key=global%2Fsuperstore-analysis-playbook.md`.

Assert:

- Page shows `编辑` button.
- Page renders Markdown through preview text, for example `Detailed notes here.`
- Markdown textarea is absent.
- Persistent tabs `Diff` and `Raw` are absent in the normal read view.

Expected before implementation: FAIL because current page renders editor textarea and inspector tabs immediately.

**Step 2: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: FAIL for the new Read Mode assertions.

## Task 2: Introduce Read/Edit Mode State

**Files:**

- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add mode state**

In `WikiEditor`, add local UI mode:

```ts
type WikiUiMode = "read" | "edit";
const [uiMode, setUiMode] = useState<WikiUiMode>("read");
```

Reset to `read` when the resolved `key` changes, unless preserving an explicit edit flow is intentionally implemented.

**Step 2: Update header actions**

Read Mode:

- Primary action: `编辑`
- Secondary action: `新建 Wiki`

Edit Mode:

- Primary action: `保存预检`
- Secondary action: `返回阅读`

Do not make `新建 Wiki` only available in the left sidebar.

**Step 3: Hide editor in Read Mode**

In Read Mode, render a read-only document surface instead of `FrontmatterForm` + textarea + inspector tabs.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS for default Read Mode tests after implementation.

## Task 3: Build `WikiReadView`

**Files:**

- Create: `webui/src/components/WikiReadView.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add tests for article rendering**

Cover:

- Title comes from first Markdown `#` heading when present.
- Summary appears in Meta Header.
- Tags render as chips.
- `sl_refs` render as semantic object badges.
- Known `sl_ref` badge links to `/sources/:conn/:schema/:table`.

**Step 2: Implement title extraction**

Add local helper, either in component or `webui/src/lib/wiki.ts`:

```ts
function wikiTitleFromContent(content: string, key: string): string {
  const heading = content.split("\n").find((line) => line.startsWith("# "));
  return heading ? heading.replace(/^#\s+/, "").trim() : key.split("/").at(-1)?.replace(/\.md$/, "") ?? key;
}
```

**Step 3: Implement TOC extraction**

Generate TOC from `##` and `###` headings. Keep this client-side and deterministic.

**Step 4: Render empty draft guidance**

For empty draft content, show:

```text
Wiki 维护 Markdown 业务说明。Schema Manifest 请在连接概览上传；semantic overlay 请在表目录或表详情维护。
```

Also render template buttons or cards:

- `表使用说明`
- `指标口径`
- `分析 Playbook`
- `FAQ / 注意事项`

The template buttons may fill the Markdown buffer and switch to Edit Mode.

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS.

## Task 4: Build Focused Edit Mode

**Files:**

- Create: `webui/src/components/WikiEditView.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/components/FrontmatterForm.tsx` if needed
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add tests for Edit Mode**

Assert:

- Clicking `编辑` shows Markdown textarea.
- `文档信息` exists as compact header / collapsible panel.
- Rendered preview is available.
- Persistent `Diff` and `Raw` tabs are absent in Edit Mode.

**Step 2: Refactor editor surface**

Create `WikiEditView` props:

```ts
type WikiEditViewProps = {
  frontmatter: WikiFrontmatter;
  content: string;
  onFrontmatterChange: (next: WikiFrontmatter) => void;
  onContentChange: (next: string) => void;
};
```

Use `FrontmatterForm` inside a compact `文档信息` area. Keep advanced metadata collapsed.

**Step 3: Render source + preview**

Use a two-pane desktop layout:

- Left: textarea Markdown source.
- Right: `MarkdownPreview`.

On mobile, stack them.

**Step 4: Preserve unsaved state**

If the user clicks `返回阅读` with unsaved edits, either keep the buffer visible in Read Mode preview or show a confirm prompt. Pick the simplest consistent path and cover with a test.

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS.

## Task 5: Move Diff / Raw Into Save Preflight

**Files:**

- Create: `webui/src/components/WikiSavePreflight.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/components/WikiInspector.tsx` only if it remains useful elsewhere
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add failing save preflight test**

Assert:

- Clicking `保存预检` opens dialog/drawer named `保存预检`.
- Dialog shows `wiki/global/superstore-analysis-playbook.md`.
- Dialog shows validation findings and `DiffViewer` output.
- `Raw` is collapsed or secondary, not a persistent page tab.
- Confirming `保存` sends `dryRun:false`.

**Step 2: Implement preflight open state**

Use existing dry-run `preview` data. If preview is stale, run dry-run before opening or show loading state inside preflight.

**Step 3: Implement validations**

Minimum client-side warnings:

- Empty body.
- Empty summary.
- No `sl_refs`.
- Unknown `sl_refs`.
- Key does not end with `.md`.

**Step 4: Wire final save**

Move the current save mutation trigger behind the preflight confirm action.

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS.

## Task 6: Upgrade Sidebar To Searchable Tree View

**Files:**

- Create: `webui/src/components/WikiTree.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/wiki.test.tsx`

**Step 1: Add tree tests**

Extend mock pages to include multiple directories:

- `global/superstore-analysis-playbook.md`
- `poc/active-analysis.md`
- `kx/financial-analysis-playbook.md`

Assert:

- Directory labels `global` / `poc` / `kx` appear.
- Primary item label prefers document title or summary, not only raw path.
- Raw path appears as secondary muted text.
- Search matches title, tag and `sl_ref`.

**Step 2: Build tree helper**

Group by path segments before basename. Keep all logic client-side.

**Step 3: Implement `WikiTree`**

Props:

```ts
type WikiTreeProps = {
  pages: WikiSummary[];
  activeKey: string;
  search: string;
  onSearchChange: (next: string) => void;
  onSelect: (key: string) => void;
};
```

Use accessible buttons; `role="tree"` is optional if hierarchy semantics are not fully implemented.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS.

## Task 7: Add Reverse Wiki Links To Table Surfaces

**Files:**

- Modify likely candidates:
  - `webui/src/pages/Catalog.tsx` if present
  - `webui/src/pages/TableEditor.tsx` or current table detail page
  - `webui/src/pages/WikiEditor.tsx`
  - `webui/src/lib/slRef.ts` if helper extraction is useful
- Test:
  - `webui/src/__tests__/wiki.test.tsx`
  - table catalog / table detail tests that own those pages

**Step 1: Locate current table catalog / table detail components**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
rg -n "业务 Wiki|wiki\\?sl_ref|wikiRefCount|/sources/" webui/src
```

**Step 2: Add tests**

For a table with related Wiki:

- Catalog or detail displays `业务 Wiki`.
- Link goes to `/wiki?key=<wikiKey>&sl_ref=<conn/schema/table>` when known.
- If only `wikiRefCount` exists but the exact key is unavailable, link to `/wiki?sl_ref=<conn/schema/table>`.

**Step 3: Implement minimal reverse link**

Prefer deterministic link to `/wiki?sl_ref=<encodedRef>` unless the exact wiki key is already available in the current API response.

**Step 4: Run affected tests**

Run focused tests for Wiki and the touched table surface.

Expected: PASS.

## Task 8: Terminology, Responsiveness And Final Verification

**Files:**

- Modify as needed based on lint / tests:
  - `webui/src/pages/WikiEditor.tsx`
  - `webui/src/components/WikiReadView.tsx`
  - `webui/src/components/WikiEditView.tsx`
  - `webui/src/components/WikiTree.tsx`
  - `webui/src/components/WikiSavePreflight.tsx`
  - `webui/src/app/app.css`
  - affected tests

**Step 1: Run terminology lint**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
```

Expected: PASS. In particular, `Wiki`、`Markdown`、`Diff`、`Raw`、literal paths and `sl_ref` nodes need translation defense where applicable.

**Step 2: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected: PASS.

**Step 3: Run build**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

Expected: PASS.

**Step 4: Optional manual browser check**

If a dev server is running, inspect:

```text
http://127.0.0.1:55176/wiki
http://127.0.0.1:55176/wiki?key=global%2Fsuperstore-analysis-playbook.md
http://127.0.0.1:55176/wiki?sl_ref=mysql-aliyun%2Fdataforai%2Fsuperstore_orders
```

Verify:

- Default is Read Mode.
- `编辑` switches to Edit Mode.
- Save Preflight owns Diff.
- Tree View uses titles.
- Linked semantic objects jump to table detail.

## Acceptance Checklist

P0:

- [ ] `/wiki` defaults to Read Mode.
- [ ] Existing wiki pages render as clean business documents.
- [ ] Empty drafts show template choices and Wiki / YAML boundary guidance.
- [ ] `编辑` enters Edit Mode.
- [ ] Edit Mode gives primary space to Markdown source and rendered preview.
- [ ] Meta fields are compact and no longer one of three equal cards.
- [ ] Persistent daily Diff / Raw tabs are removed.
- [ ] Save Preflight shows validation + target path + diff and confirms write.
- [ ] Existing `?sl_ref` matching and seeded drafts still work.

P1:

- [ ] Left navigation is a searchable Tree View.
- [ ] Document title is primary; raw path is secondary.
- [ ] Known semantic object badges link to table detail.
- [ ] Unknown semantic object badges show warning state.
- [ ] Table catalog or table detail exposes related `业务 Wiki` links.

Verification:

- [ ] Focused Wiki tests pass.
- [ ] Affected table surface tests pass.
- [ ] `npm run lint:terminology` passes.
- [ ] `npm run build` passes.

## Non-Goals

- No YAML upload in `/wiki`.
- No backend API contract change unless separately specified.
- No rich-text editor dependency.
- No version history implementation in M33.
- No AI-generated Wiki draft in M33.
