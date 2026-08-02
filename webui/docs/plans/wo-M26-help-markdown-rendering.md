# M26 Help Markdown Rendering Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Help Center render `docs/SYSTEM_HANDBOOK.md` as real Markdown, starting with GFM pipe tables on `/help?section=deployment-checklist`.

**Architecture:** Frontend-only enhancement over the existing fixed-source Help API. Keep `GET /api/help/handbook` unchanged, extend the local Markdown renderer with safe table parsing, preserve deep-link scrolling, and add regression tests around Help Center and Markdown preview behavior.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS utility layer. No new runtime dependency for M26 P0.

**Source Spec:** [../30-help-markdown-rendering-spec.md](../30-help-markdown-rendering-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/30-help-markdown-rendering-spec.md`
- `docs/design-system-handbook-help.md`
- `docs/SYSTEM_HANDBOOK.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/24-yaml-delivery-runbook-spec.md`
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/HelpCenter.tsx`
- `webui/src/components/MarkdownPreview.tsx`
- `webui/src/app/app.css`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/server/help.ts`

Inspect these tests:

- `webui/src/__tests__/help-center.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`
- `webui/server/__tests__/help.test.ts`

Non-negotiable boundaries:

- Do not change the Help API route or response envelope.
- Do not add client-controlled path parameters.
- Do not read from `wiki/` for Help content.
- Do not expose Help content through MCP tools.
- Do not render raw HTML from Markdown.
- Do not introduce external network, LLM, or Markdown dependencies in P0.
- Do not edit `.ktx/secrets/**`, `ktx.yaml`, or semantic YAML for this work order.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Capture The Help Table Regression In Tests

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Add a fixture that mirrors the deployment checklist**

Mock `GET /api/help/handbook` with Markdown containing:

```md
## 3.1 部署向导与上线检查 {#deployment-checklist}

| 步骤 | Ready 条件 | 检查方法 | 异常处理 |
|---|---|---|---|
| 1 | `ktx.yaml` 已存在 | 查看项目根目录 | 补齐配置 |
```

Use the existing test helpers and keep the response envelope shape unchanged.

**Step 2: Assert table semantics**

Add assertions that the rendered Help page contains a real table:

```ts
const article = await screen.findByRole("article");
const table = within(article).getByRole("table");

expect(within(table).getByRole("columnheader", { name: "步骤" })).toBeInTheDocument();
expect(within(table).getByRole("columnheader", { name: "Ready 条件" })).toBeInTheDocument();
expect(within(table).getByText("补齐配置")).toBeInTheDocument();
expect(article).not.toHaveTextContent("| 步骤 | Ready 条件 | 检查方法 | 异常处理 |");
```

If the page does not currently expose `role="article"`, target the stable Help content container already used by tests, or add an accessible article wrapper as part of Task 4.

**Step 3: Assert deep link still works**

Set the test location to:

```text
/help?section=deployment-checklist
```

Assert the section heading remains present and that no loading state remains:

```ts
expect(screen.getByRole("heading", { name: /部署向导与上线检查/ })).toBeInTheDocument();
expect(screen.queryByText("系统手册加载中...")).not.toBeInTheDocument();
```

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Expected before implementation: FAIL because table rows render as raw pipe text.

---

## Task 2: Add Markdown Renderer Safety Tests

**Files:**

- Modify: `webui/src/__tests__/wiki.test.tsx` or add a focused renderer test near existing component tests.

**Step 1: Add table rendering coverage**

Render `MarkdownPreview` with:

```md
| 字段 | 说明 |
|---|---|
| `enabled_tables` | 表白名单 |
```

Assert:

```ts
expect(screen.getByRole("table")).toBeInTheDocument();
expect(screen.getByRole("columnheader", { name: "字段" })).toBeInTheDocument();
expect(screen.getByText("表白名单")).toBeInTheDocument();
expect(screen.getByText("enabled_tables")).toHaveAttribute("translate", "no");
```

**Step 2: Add raw HTML escaping coverage**

Render:

```md
<img src=x onerror=alert(1)>
```

Assert no image is created:

```ts
expect(screen.queryByRole("img")).not.toBeInTheDocument();
expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
```

**Step 3: Add dangerous link coverage**

Render:

```md
[bad](javascript:alert(1))
```

Assert no clickable dangerous link exists:

```ts
expect(screen.queryByRole("link", { name: "bad" })).not.toBeInTheDocument();
expect(screen.getByText("bad")).toBeInTheDocument();
```

**Step 4: Run focused renderer test**

Run the relevant command:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/wiki.test.tsx
```

Expected before implementation: FAIL on table rendering if no previous support exists.

---

## Task 3: Implement Controlled GFM Table Parsing

**Files:**

- Modify: `webui/src/components/MarkdownPreview.tsx`
- Optional extract: `webui/src/components/markdown/renderMarkdown.ts`

**Step 1: Extend block model**

Add a table block shape:

```ts
type TableAlignment = "left" | "center" | "right";

type MarkdownBlock =
  | ExistingBlockTypes
  | {
      kind: "table";
      headers: string[];
      alignments: TableAlignment[];
      rows: string[][];
    };
```

If the current component does not use a typed block model, introduce small local helpers rather than a broad refactor.

**Step 2: Add parser helpers**

Implement pure helpers:

- `isTableRow(line: string): boolean`
- `splitTableRow(line: string): string[]`
- `isTableSeparator(cells: string[]): boolean`
- `parseTableAlignment(cell: string): TableAlignment`
- `tryParseTable(lines: string[], startIndex: number): { block; nextIndex } | null`

Required behavior:

- Header row plus separator row is mandatory.
- Separator cells match `:?-{3,}:?`.
- Leading and trailing pipes are trimmed before splitting.
- Tables inside fenced code blocks are ignored because fenced code is parsed first.
- Body rows continue until blank line or non-pipe row.

**Step 3: Insert table detection before paragraphs**

In the main parse loop, check `tryParseTable` after fenced code detection and before paragraph/list fallback. This prevents pipe table lines from being swallowed as plain paragraphs.

**Step 4: Keep implementation narrow**

Do not implement full CommonMark. P0 only needs stable Help Center tables and existing supported syntax.

---

## Task 4: Render Tables Safely And Accessibly

**Files:**

- Modify: `webui/src/components/MarkdownPreview.tsx`

**Step 1: Render table DOM**

Render:

```tsx
<div className="pl-markdown-table-wrap">
  <table className="pl-markdown-table notranslate" translate="no">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>
</div>
```

Use `<th scope="col">` for header cells. Apply alignment with class names or inline style from parser output.

**Step 2: Reuse safe inline rendering**

Each cell should use the same escaped inline renderer as paragraphs, so inline code and safe links still work. Raw HTML must remain escaped.

**Step 3: Add translation defense**

At minimum apply:

```tsx
translate="no"
className="notranslate"
```

to `<code>`, `<pre>`, `<table>`, and cells that contain technical path / URL / config text if the implementation can detect them cheaply. Do not over-engineer NLP detection.

**Step 4: Keep link policy safe**

Ensure `javascript:`, `data:`, and unknown protocols are downgraded to text. Keep `http://`, `https://`, `#...`, `?...`, and `/...` safe.

---

## Task 5: Add Help Markdown Table Styles

**Files:**

- Modify: `webui/src/app/app.css`

Add compact operational table styles:

```css
.pl-markdown-table-wrap {
  width: 100%;
  overflow-x: auto;
  margin: 0.85rem 0 1rem;
}

.pl-markdown-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.pl-markdown-table th,
.pl-markdown-table td {
  border: 1px solid var(--pl-border-subtle);
  padding: 0.5rem 0.625rem;
  vertical-align: top;
}

.pl-markdown-table th {
  background: var(--pl-surface-muted);
  font-weight: 650;
}
```

Use existing CSS variables if names differ. Keep cards at existing radius; do not introduce nested cards or decorative backgrounds.

---

## Task 6: Verify Help API Boundary Did Not Change

**Files:**

- No intended production change.
- Test: `webui/server/__tests__/help.test.ts`

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help
```

Expected: PASS. If the server test fails, fix only regressions caused by this work order. Do not add path parameters or alternative source files.

---

## Task 7: Full Verification

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
npm test -- --run src/__tests__/wiki.test.tsx
npm test -- help
npm run build
```

Optional manual check when dev server is running:

```text
http://127.0.0.1:55176/help?section=deployment-checklist
```

Manual acceptance:

- The deployment checklist renders as a real table.
- The raw pipe table source is not visible as a paragraph.
- The section deep link lands on the expected heading.
- Code/path/URL snippets are not auto-translated by the browser.
- The page does not remain at `系统手册加载中...`.

---

## Task 8: Final Diff And Commit Scope

Review the diff:

```bash
git -C /Users/zhangxingchen/Projects/project-lucy diff -- webui/src/components/MarkdownPreview.tsx webui/src/app/app.css webui/src/__tests__/help-center.test.tsx webui/src/__tests__/wiki.test.tsx webui/server/__tests__/help.test.ts
```

Stage only files directly touched by M26. Expected implementation files:

- `webui/src/components/MarkdownPreview.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/help-center.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`

Expected documentation files if this plan and spec are committed in the same changeset:

- `webui/docs/30-help-markdown-rendering-spec.md`
- `webui/docs/plans/wo-M26-help-markdown-rendering.md`
- `webui/docs/README.md`
- `webui/docs/plans/README.md`

Do not stage unrelated dirty files from other active work.

Suggested commit message:

```text
fix(webui): render help center markdown tables
```

---

## Definition Of Done

- [ ] Help Center renders GFM pipe tables from `docs/SYSTEM_HANDBOOK.md`.
- [ ] `/help?section=deployment-checklist` no longer shows raw pipe table text.
- [ ] Raw HTML remains escaped.
- [ ] Dangerous link protocols are not clickable.
- [ ] Help API fixed-source contract remains unchanged.
- [ ] Terminology and browser translation defense are covered in DOM and tests where practical.
- [ ] `npm test -- help-center` passes.
- [ ] `npm test -- --run src/__tests__/wiki.test.tsx` passes.
- [ ] `npm test -- help` passes.
- [ ] `npm run build` passes.
