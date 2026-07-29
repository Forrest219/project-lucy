# WebUI Business Wiki UX Refactor Implementation Plan

> 先读 [README.md 总纲](README.md)。本工单是 M10 体验升级，范围集中在业务 Wiki `/wiki` 与它和 Catalog/TableEditor 的联动。

**Goal:** Upgrade Business Wiki from a file-oriented Markdown editor into an object-aware governance workbench with semantic table handoff, compact frontmatter, `sl_refs` autocomplete/chips, explicit new-document entry, and a right inspector with rendered Markdown preview plus diff.

**Architecture:** Frontend-first refinement over existing WebUI APIs. Reuse `GET /api/wiki`, `GET /api/wiki/:key`, `PUT /api/wiki/:key`, `GET /api/sources`, and existing routes. Keep Wiki markdown/frontmatter persistence unchanged.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Vitest, Testing Library, existing `apiClient`, existing CSS in `webui/src/app/app.css`.

---

## codex / MiniMax 直投 prompt

```text
工作目录：/Users/forrest/Projects/project-lucy/webui。先读 docs/codex/README.md、docs/13-business-wiki-ux-refactor.md、docs/03-api-spec.md 中 wiki 与 sources 相关章节、src/pages/WikiEditor.tsx、src/components/FrontmatterForm.tsx、src/components/DiffViewer.tsx、src/pages/Catalog.tsx、src/pages/TableEditor.tsx、src/lib/types.ts、src/lib/queryKeys.ts、src/app/app.css、src/__tests__/app-shell.test.tsx。

任务：M10 业务 Wiki UX refactor。实现从 Catalog / TableEditor 点击“业务 Wiki”携带 sl_ref 后，Wiki 自动匹配已有文档或创建预填 sl_refs 的本地草稿；新增显式“新建 Wiki”入口；把 Frontmatter 改为紧凑 grid；把 sl_refs 做成基于 GET /api/sources 的 chip + autocomplete + 表编辑器反向跳转；右侧 inspector 改为“渲染预览 / Diff”tab，默认渲染 Markdown。

关键约束：不新增后端契约；不修改 Wiki 存储格式；sl_refs 持久值保持 conn/schema/table；不要让 query refetch 覆盖用户未保存编辑；不要使用未消毒的 dangerouslySetInnerHTML 渲染 Markdown；不改 webui/config/data-qa-instructions.md、CLAUDE.md、AGENTS.md 或 semantic-layer YAML。

完成后跑 npm test -- --run src/__tests__/app-shell.test.tsx，并尽量跑 npm test 和 npm run build。贴结果，按 DoD 收尾，停下交回。
```

## Context For MiniMax

Read these files before coding:

- `webui/docs/13-business-wiki-ux-refactor.md`
- `webui/docs/codex/README.md`
- `webui/docs/03-api-spec.md`
- `webui/src/pages/WikiEditor.tsx`
- `webui/src/components/FrontmatterForm.tsx`
- `webui/src/components/DiffViewer.tsx`
- `webui/src/pages/Catalog.tsx`
- `webui/src/pages/TableEditor.tsx`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/apiClient.ts`
- `webui/src/app/app.css`
- `webui/src/__tests__/app-shell.test.tsx`

Non-negotiable boundaries:

- Do not change backend contracts unless absolutely necessary and documented.
- Do not alter Wiki markdown/frontmatter serialization rules.
- Do not write to `wiki/` until the user clicks Save.
- Do not modify `semantic-layer/**`.
- Do not touch `.ktx/secrets/**`.
- Do not copy runtime data-agent instructions into development docs or source code.
- Persist `sl_refs` as canonical `conn/schema/table` values.

## Task 1: Expand Wiki Tests First

**Files:**

- Modify: `webui/src/__tests__/app-shell.test.tsx` or add a focused Wiki test file if the suite already has one.

Add fixtures for:

```ts
const wikiPages = [
  {
    key: "global/superstore-analysis-playbook.md",
    summary: "Superstore guide",
    tags: ["analysis"],
    slRefs: ["mysql-aliyun/dataforai/superstore_orders"]
  }
];

const sources = [
  {
    conn: "mysql-aliyun",
    schema: "dataforai",
    table: "superstore_orders",
    filePath: "semantic-layer/mysql-aliyun/superstore_orders.yaml",
    columnCount: 3,
    columnNames: ["row_id", "order_id", "order_date"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 1,
    joinCount: 0,
    wikiRefCount: 1,
    completion: "done",
    mtime: "2026-07-27T00:00:00.000Z"
  }
];
```

Cover:

- `/wiki?sl_ref=mysql-aliyun/dataforai/superstore_orders` auto-selects `global/superstore-analysis-playbook.md`.
- An unmatched `sl_ref` opens a local draft `global/<table>.md` and preloads `frontmatter.sl_refs`.
- The Catalog table-level Wiki action links to `/wiki?sl_ref=<conn/schema/table>`.
- `sl_refs` chip removal updates frontmatter and the dry-run payload.
- `sl_refs` known chip links to `/sources/mysql-aliyun/dataforai/superstore_orders`.
- Inspector tabs switch between rendered preview and diff.
- Rendered preview displays at least heading, list, inline code, and code block text.

Run the focused test before implementation and confirm it fails for the missing behavior.

## Task 2: Implement Object Handoff In `WikiEditor`

**Files:**

- Modify: `webui/src/pages/WikiEditor.tsx`

Implementation requirements:

1. Parse `key` and `sl_ref` from search params.
2. Fetch `GET /api/wiki`.
3. When `sl_ref` is present and `key` is absent:
   - Find the first `pages[]` item whose `slRefs` contains the canonical ref.
   - If found, select that page and update search params to include `key` and `sl_ref`.
   - If not found, generate a draft key from the table segment.
4. A generated draft must:
   - Use `global/<table>.md` when available.
   - Avoid colliding with existing page keys by using a deterministic suffix.
   - Set `frontmatter.sl_refs` to `[sl_ref]`.
   - Not issue a save request.
5. Existing direct `?key=` behavior must continue to work.
6. Guard against refetch overwrites after local edits. A simple dirty flag is acceptable.

Suggested helper functions:

```ts
function normalizeSlRef(value: string | null): string | null
function tableNameFromSlRef(ref: string): string
function draftKeyForSlRef(ref: string, existingKeys: string[]): string
function findWikiBySlRef(pages: WikiSummary[], ref: string): WikiSummary | undefined
```

## Task 3: Add Catalog Table-Level Wiki Action

**Files:**

- Modify: `webui/src/pages/Catalog.tsx`

Requirements:

- Each table row exposes a Wiki action linking to `/wiki?sl_ref=${conn}/${schema}/${table}`.
- Existing table editor navigation remains available.
- Avoid nested anchors. If necessary, convert the row from a single `Link` to a structured row with separate links/buttons.
- Keep current filters and counts intact.

## Task 4: Rename Table Editor Action

**Files:**

- Modify: `webui/src/pages/TableEditor.tsx`

Requirements:

- Keep the existing route target.
- Change visible label from `创建 Wiki` to `业务 Wiki`.
- Optional: add a title/aria label explaining it opens or creates related business documentation.

## Task 5: Refactor Frontmatter Form

**Files:**

- Modify: `webui/src/components/FrontmatterForm.tsx`
- Optional add: `webui/src/components/SlRefPicker.tsx`
- Optional add: `webui/src/components/TagInput.tsx`

Requirements:

- Use compact grid layout:
  - `sl_refs` and `tags` side by side on desktop.
  - `summary` full width.
  - `refs` and `usage_mode` under collapsible "更多元信息".
- Query `GET /api/sources` for `sl_refs` suggestions.
- Render `sl_refs` as chips.
- Allow adding, removing, and preserving unknown refs.
- Link known refs to `/sources/:conn/:schema/:table`.
- Keep existing `WikiFrontmatter` type shape unchanged.

Candidate display:

```text
dataforai.superstore_orders
mysql-aliyun/dataforai/superstore_orders
```

Persisted value:

```text
mysql-aliyun/dataforai/superstore_orders
```

## Task 6: Add Explicit New Wiki Button

**Files:**

- Modify: `webui/src/pages/WikiEditor.tsx`

Requirements:

- Add `新建 Wiki` button in the left sidebar near the page path/list.
- Create a local draft only.
- Default key: `global/new-note.md`.
- If key exists, use `global/new-note-2.md`, then increment.
- If current URL has `sl_ref`, seed `frontmatter.sl_refs` with it.
- Clear content and non-seeded metadata.
- Update search params.

## Task 7: Build Right Inspector Tabs

**Files:**

- Modify: `webui/src/pages/WikiEditor.tsx`
- Optional add: `webui/src/components/WikiInspector.tsx`
- Optional add: `webui/src/components/MarkdownPreview.tsx`

Requirements:

- Replace stacked right panels with tabs:
  - `渲染预览`
  - `Diff`
  - Optional `Raw`
- Default to `渲染预览`.
- Keep using `DiffViewer` for diff.
- Preserve proposed Markdown display under optional `Raw` if implemented.
- Render Markdown safely.

Markdown implementation options:

- Preferred if dependency addition is accepted: `react-markdown` and `remark-gfm`.
- Otherwise implement a small escaped renderer for headings, paragraphs, lists, inline code, fenced code blocks, blockquotes, and links.

Do not use unsafe raw HTML rendering.

## Task 8: Styling

**Files:**

- Modify: `webui/src/app/app.css`

Add focused classes for:

- Compact frontmatter grid.
- Wiki chips.
- `sl_ref` known and unknown states.
- Autocomplete dropdown.
- Wiki inspector tabs.
- Markdown preview typography.
- Stable sidebar/new-document controls.

Constraints:

- Reuse current color tokens and button/input primitives.
- Keep the UI dense and workbench-like.
- Avoid decorative hero treatment, marketing cards, and large vertical padding.
- Long refs, long page keys, and long table names must not overflow their containers.

## Task 9: Verification

Run:

```bash
cd webui
npm test -- --run src/__tests__/app-shell.test.tsx
npm test
npm run build
```

If full `npm test` is too slow or blocked by unrelated existing failures, report:

- The focused test result.
- The full-suite failure summary.
- Why the failure is unrelated or what remains to fix.

## Done Definition

- `/wiki?sl_ref=<conn/schema/table>` opens a matching Wiki if one exists.
- Unmatched `sl_ref` opens a non-persisted prefilled draft.
- Catalog and TableEditor both provide object-aware Wiki entry points.
- Frontmatter is compact and preserves all existing fields.
- `sl_refs` chips support autocomplete, removal, unknown values, and table-editor links.
- Right inspector defaults to rendered Markdown and can switch to diff.
- Save and dry-run preview continue to use the existing Wiki API.
- Focused tests pass.
- `npm run build` passes or any blocker is documented.

