# WebUI Business Wiki UX Refactor Design

| Metadata | Value |
|---|---|
| Document | WebUI Business Wiki UX Refactor Design |
| Type | Incremental Design |
| Version | v0.1 |
| Date | 2026-07-27 |
| Author | Codex |
| Request | Upgrade Business Wiki editing into a SaaS-grade data governance workflow |
| Primary builder | MiniMax |
| Status | Ready for MiniMax implementation |
| Output | `webui/docs/13-business-wiki-ux-refactor.md` |

---

## 1. Decision Summary

Approve the refactor direction.

The current Business Wiki module is functionally open: left Wiki path list, center frontmatter plus Markdown editor, right dry-run diff and proposed Markdown. However, it still behaves like a file editor. The next increment should make it behave like a governed business knowledge surface anchored to semantic-layer objects.

Two clarifications apply:

1. The single table editor already links to `/wiki?sl_ref=<conn/schema/table>` from `TableEditor.tsx`; the broken part is the Wiki page's incomplete handling of that parameter.
2. `sl_refs` should use the canonical existing format `conn/schema/table`, for example `mysql-aliyun/dataforai/superstore_orders`. UI labels may display `schema.table`, but persisted values must remain three-part refs to avoid ambiguity across connections.

This should be a frontend-first refresh. Reuse existing contracts:

| Need | Existing source |
|---|---|
| Wiki page list and `slRefs` | `GET /api/wiki` |
| Wiki page detail | `GET /api/wiki/:key` |
| Wiki dry-run diff and proposed Markdown | `PUT /api/wiki/:key` with `dryRun: true` |
| Wiki save | `PUT /api/wiki/:key` with `dryRun: false` |
| Semantic table candidates for `sl_refs` | `GET /api/sources` |
| Table editor deep link | `/sources/:conn/:schema/:table` |

Do not add backend contracts in this pass unless implementation proves existing data is insufficient.

## 2. Product Goal

The Business Wiki must support a complete semantic-object knowledge loop:

```text
Catalog / Table Editor
  -> click Business Wiki with ?sl_ref=conn/schema/table
  -> Wiki auto-opens the related document or creates a prefilled draft
  -> user edits frontmatter and Markdown in a dense editor
  -> user previews rendered Markdown or Git diff
  -> user can jump back from sl_refs to the table editor
```

The experience should feel like a commercial SaaS data governance product: object-aware, compact, predictable, and safe.

## 3. Current Problems

### 3.1 Catalog / Table Editor Linkage Is Incomplete

`TableEditor.tsx` already emits `/wiki?sl_ref=conn/schema/table`, but `WikiEditor.tsx` only uses the value as a default frontmatter seed. It does not:

- Search existing Wiki pages whose `slRefs` contain that table.
- Auto-select and highlight the matched page.
- Create a clearly scoped draft when no match exists.
- Keep URL state aligned with the selected Wiki page.

Catalog has a generic Business Wiki entry, but table rows do not expose a direct table-to-Wiki path.

### 3.2 Frontmatter Consumes Too Much Vertical Space

`FrontmatterForm.tsx` currently renders five single-column fields: summary, tags, sl_refs, refs, and usage_mode. On common laptop and desktop viewports this pushes the Markdown editor below the first screen, even though Markdown body editing is the primary job.

### 3.3 `sl_refs` Are Plain Text

Users must type refs manually. This creates three issues:

- Easy typo surface for values such as `mysql-aliyun/dataforai/superstore_orders`.
- No autocomplete from the semantic catalog.
- No reverse navigation to the related table editor.

### 3.4 Right Preview Is Too Engineering-Centric

The right column currently stacks "变更预览" and "拟写入 Markdown". This is useful for implementation debugging, but the default reviewer need is to see rendered business documentation first and Git diff second.

### 3.5 Missing Explicit New Document Entry

New Wiki creation currently depends on typing a new path into the page-path input. That is technically adequate, but not discoverable enough for a SaaS workbench.

## 4. Target Information Architecture

| Route | Role | Required behavior |
|---|---|---|
| `/wiki` | Wiki editor default | Open first page if available; otherwise start `global/new-note.md` draft. |
| `/wiki?key=<wikiKey>` | Direct Wiki page | Open that page and highlight it in the left list. |
| `/wiki?sl_ref=<conn/schema/table>` | Semantic-object Wiki handoff | Match existing page by `slRefs`, or create a prefilled draft. |
| `/wiki?key=<wikiKey>&sl_ref=<conn/schema/table>` | Matched object page | Open `key`, keep object context for highlighting and frontmatter suggestions. |

## 5. Object Handoff Behavior

### 5.1 From Table Editor

In `TableEditor.tsx`, keep the existing route shape:

```text
/wiki?sl_ref=<encodeURIComponent(`${conn}/${schema}/${table}`)>
```

Change the button label from `创建 Wiki` to `业务 Wiki`.

### 5.2 From Catalog

In `Catalog.tsx`, each table row should expose a direct `Wiki` or `业务 Wiki` action with the same `sl_ref` URL.

Interaction rules:

- The existing row/table navigation to `/sources/:conn/:schema/:table` must remain available.
- If the full row is a link, prevent nested anchor bugs by restructuring the row into a non-anchor container with separate action links, or by moving the Wiki action outside the row link target.
- The table-level Wiki action should not change filters or catalog scroll state.

### 5.3 Wiki Auto-Match Algorithm

When `WikiEditor` receives `sl_ref`:

1. Fetch `GET /api/wiki`.
2. Normalize the incoming `sl_ref` by trimming whitespace and removing duplicate slashes. Do not convert `schema.table` to canonical form unless source catalog lookup can prove the connection.
3. Find the first page where `page.slRefs` contains the exact canonical ref.
4. If matched:
   - Set `key` to `page.key`.
   - Highlight that page in the left list.
   - Update URL to include both `key` and `sl_ref`.
   - Load page detail from `GET /api/wiki/:key`.
5. If not matched:
   - Generate draft key `global/<table>.md`, where `<table>` is the third segment of the canonical ref.
   - Initialize `frontmatter.sl_refs` with the canonical ref.
   - Leave `content` empty or use a minimal heading only if the product owner requests a template later.
   - Do not write the file until the user clicks Save.

Implementation safety:

- Track whether the user has local unsaved edits. Refetches must not overwrite edited frontmatter/content.
- If the generated draft key collides with an existing key that does not reference `sl_ref`, do not silently overwrite the existing page. Prefer `global/<table>-wiki.md` or prompt via inline non-blocking warning. The first implementation may choose `global/<table>-wiki.md` deterministically.
- URL updates should use React Router search params and avoid full reloads.

## 6. Compact Frontmatter Panel

### 6.1 Default Layout

Replace the current vertical stack with a compact grid:

| Field | Priority | Default visibility | Control |
|---|---|---|---|
| `sl_refs` | P0 | visible | chips plus autocomplete input |
| `tags` | P0 | visible | chips plus comma/enter input |
| `summary` | P0 | visible | compact textarea, 2 rows |
| `refs` | P1 | collapsed under "更多元信息" | line-based textarea |
| `usage_mode` | P1 | collapsed under "更多元信息" | text input or select if values become standardized |

Desktop layout:

- Use two columns for `sl_refs` and `tags`.
- Place `summary` below as full width.
- Keep default panel height around 180-220px at 1440x900.

Mobile layout:

- Collapse to a single column.
- Keep chips wrapping inside their container.
- Avoid horizontal overflow for long refs.

### 6.2 `sl_refs` Chip Behavior

Each `sl_ref` chip should show:

- Primary label: `schema.table` when source lookup succeeds.
- Secondary or tooltip: full `conn/schema/table`.
- Remove action.
- Link action to `/sources/:conn/:schema/:table` when the ref has exactly three segments.

State handling:

| State | Visual | Behavior |
|---|---|---|
| Known source | normal chip | Link enabled. |
| Unknown source | warning chip | Link disabled or hidden; value can still be saved. |
| Duplicate input | no new chip | Toast or inline quiet message. |
| Invalid shape | warning chip | Preserve value; do not corrupt existing docs. |

### 6.3 Source Autocomplete

Use `GET /api/sources` and `SourcesResponse.tables` as the candidate list.

Candidate canonical value:

```text
${conn}/${schema}/${table}
```

Search should match:

- `table`
- `schema.table`
- `conn/schema/table`
- column names if cheap and already present in `SourceSummary.columnNames`

The autocomplete should be keyboard usable:

- Arrow keys navigate candidates.
- Enter selects.
- Escape closes.
- Backspace on empty input can remove the last chip if implementation already has that pattern; otherwise omit.

## 7. Right Inspector

Replace the stacked right column with a tabbed inspector.

### 7.1 Tabs

| Tab | Default | Content |
|---|---|---|
| `渲染预览` | yes | Render current Markdown body as rich preview. |
| `Diff` | no | Render dry-run diff against disk. |
| `Raw` | optional | Render proposed Markdown including frontmatter. |

The first implementation should include `渲染预览` and `Diff`. `Raw` is useful if easy because it preserves the current "拟写入 Markdown" debugging surface, but it should not consume default vertical space.

### 7.2 Markdown Rendering

Minimum supported rendering:

- H1-H3 headings
- paragraphs
- unordered and ordered lists
- bold and italic
- inline code
- fenced code blocks
- blockquotes
- links

Dependency preference:

1. If adding dependencies is acceptable, use `react-markdown` plus `remark-gfm`.
2. If avoiding dependencies, implement a small local renderer only for the minimum supported subset and escape raw HTML.

Do not render user Markdown with unsafe `dangerouslySetInnerHTML` unless it is sanitized.

### 7.3 Diff Behavior

Keep using the existing dry-run call:

```text
PUT /api/wiki/:key
{
  "dryRun": true,
  "frontmatter": { ... },
  "content": "..."
}
```

Show:

- Empty diff state: "暂无可预览的变更"
- Loading state for debounce preview
- Error state from preview failure
- Diff with additions/removals via existing `DiffViewer`

## 8. Explicit New Document Entry

Add a visible `新建 Wiki` button in the left sidebar.

Behavior:

- Creates a local draft with default key `global/new-note.md`.
- If that key already exists, use `global/new-note-2.md`, `global/new-note-3.md`, etc.
- Clears frontmatter and content unless the current URL has `sl_ref`, in which case preserve `frontmatter.sl_refs = [sl_ref]`.
- Updates URL to `?key=<draftKey>` or `?key=<draftKey>&sl_ref=<sl_ref>`.
- Does not write until Save.

The existing page-path input may remain for power users, but it should not be the primary new-document affordance.

## 9. Visual Requirements

Use existing WebUI primitives and restrained SaaS styling:

- Reuse `pl-panel`, `pl-section-heading`, `pl-btn`, `pl-input`, `pl-textarea`, `pl-file-button`, `pl-notice`, and `pl-error`.
- Add specific classes for Wiki chips, compact frontmatter grid, inspector tabs, and Markdown preview.
- Keep cards at the current app radius. Do not introduce decorative hero sections or marketing-style panels.
- Preserve dense, workbench-like information layout.
- Long refs and paths must truncate or wrap within stable containers.
- On 1440x900, the Markdown editor should be visible without scrolling past the frontmatter panel.

## 10. Accessibility

- Sidebar document buttons must have clear active state.
- Tab controls should use `button` elements with `aria-selected` or an existing tab primitive if available.
- Chip remove buttons need accessible labels such as `移除关联语义对象 mysql-aliyun/dataforai/superstore_orders`.
- Link buttons to table editors need accessible labels such as `打开 superstore_orders 表语义编辑器`.
- Autocomplete should be keyboard navigable or gracefully degrade to a datalist/input pattern.

## 11. Testing Requirements

Add or update frontend tests for:

1. `/wiki?sl_ref=mysql-aliyun/dataforai/superstore_orders` matches an existing Wiki page by `slRefs`.
2. Unmatched `sl_ref` creates a local draft key and prefilled `frontmatter.sl_refs`.
3. New `业务 Wiki` entry from Catalog produces the correct route.
4. `sl_refs` chips render known sources, support deletion, and link to `/sources/:conn/:schema/:table`.
5. Unknown `sl_ref` remains saveable and is visually marked.
6. Frontmatter collapsed fields preserve existing `refs` and `usage_mode`.
7. Inspector tab switching works for rendered preview and diff.
8. Rendered preview displays headings, lists, inline code, and code blocks.
9. Save still sends `dryRun:false` with the edited frontmatter and content.

Run:

```bash
cd webui
npm test
npm run build
```

## 12. Acceptance Criteria

- From the single table editor, clicking `业务 Wiki` opens the Wiki editor with the correct table context.
- If a Wiki page already references the table, it is selected and highlighted automatically.
- If no Wiki page references the table, the editor opens a non-persisted draft under `global/<table>.md` with `sl_refs` prefilled.
- Catalog exposes a table-level Wiki entry for each table.
- Frontmatter is compact enough that the Markdown editor is visible in the first desktop viewport.
- `sl_refs` can be selected from semantic table candidates, rendered as chips, removed, and used to jump back to table editors.
- Right inspector defaults to rich Markdown preview and can switch to Git diff.
- Existing dry-run preview and save flows continue to work.
- No backend API contract changes are introduced unless explicitly documented.

## 13. Out Of Scope

- Backend full-text Wiki search changes.
- Wiki ACL model changes.
- New Wiki templates beyond the generated file key and `sl_refs` seed.
- KTX runtime prompt or `webui/config/data-qa-instructions.md` changes.
- Semantic-layer YAML write behavior changes.

