# M30 Help Center Layout Polish Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/help` feel like a mature enterprise Help Center by fixing deep-link positioning, header metadata, TOC density, first-screen noise, and reading width.

**Architecture:** Frontend-only layout refinement over the existing fixed-source Help API and M26 Markdown renderer. Keep `GET /api/help/handbook` unchanged; adjust `HelpCenter.tsx` and CSS to improve information hierarchy while preserving local-only rendering and Markdown security boundaries.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS utility layer. No new runtime dependency.

**Source Spec:** [../33-help-center-layout-polish-spec.md](../33-help-center-layout-polish-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/33-help-center-layout-polish-spec.md`
- `webui/docs/30-help-markdown-rendering-spec.md`
- `docs/design-system-handbook-help.md`
- `docs/SYSTEM_HANDBOOK.md`
- `webui/docs/00-product-terminology-standard.md`
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/HelpCenter.tsx`
- `webui/src/components/MarkdownPreview.tsx`
- `webui/src/components/HelpButton.tsx`
- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`

Inspect these tests:

- `webui/src/__tests__/help-center.test.tsx`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`

Non-negotiable boundaries:

- Do not change the Help API route or response envelope.
- Do not add client-controlled path parameters.
- Do not read from `wiki/` for Help content.
- Do not expose Help content through MCP tools.
- Do not render raw HTML from Markdown.
- Do not introduce external network, LLM, or Markdown dependencies.
- Do not edit `.ktx/secrets/**`, `ktx.yaml`, or semantic YAML for this work order.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Capture The Layout Regression In Tests

**Files:**

- Modify: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Add a realistic Help fixture**

Ensure the mocked handbook includes:

```md
# Project Lucy 系统使用与运维手册

| 项 | 内容 |
|---|---|
| 文档类型 | System Handbook |
| 事实来源 | `webui/server/`, `webui/src/` |

## 1. 系统概述与架构拓扑

### 3.2 数据库接入

#### Agent 可见性与 ACL 同步

新增连接后必须同步 `webui/config/access.yaml` 的 role。
```

The TOC must include `database-connection-acl-sync`.

**Step 2: Test metadata chips are separated**

Assert Header source path and updated time are separate elements:

```ts
const header = screen.getByRole("banner", { name: /系统手册/ });
expect(within(header).getByText("来源")).toBeInTheDocument();
expect(within(header).getByText("docs/SYSTEM_HANDBOOK.md")).toHaveAttribute("translate", "no");
expect(within(header).getByText(/更新时间/)).toBeInTheDocument();
expect(header).not.toHaveTextContent("docs/SYSTEM_HANDBOOK.md2026");
```

If `banner` is not suitable because the app already has one global banner, use a stable `data-testid="help-header"` on the Help header.

**Step 3: Test deep-link current section**

Render:

```text
/help?section=database-connection-acl-sync
```

Assert:

```ts
const activeLink = screen.getByRole("link", { name: "Agent 可见性与 ACL 同步" });
expect(activeLink).toHaveAttribute("aria-current", "location");
expect(document.getElementById("database-connection-acl-sync")).toBeInTheDocument();
```

Mock `scrollIntoView` and assert it is called for the target section.

**Step 4: Test metadata table does not dominate content**

Add a test that the visible article does not render the initial handbook metadata table as a normal markdown table before the first actual section.

Recommended assertion:

```ts
const article = await screen.findByRole("article");
expect(within(article).queryByText("文档类型")).not.toBeInTheDocument();
expect(within(article).getByRole("heading", { name: /系统概述与架构拓扑/ })).toBeInTheDocument();
```

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Expected before implementation: FAIL on at least header metadata or metadata table assertions.

---

## Task 2: Refactor Help Header Metadata

**Files:**

- Modify: `webui/src/pages/HelpCenter.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Add a stable Help header test id**

Render the Help header as:

```tsx
<header className="pl-page-header" data-testid="help-header">
```

Do not change the page title text.

**Step 2: Wrap metadata in `.pl-page-header-badges`**

Replace bare spans:

```tsx
<div className="pl-page-header-cell pl-page-header-cell--badges">
  <span>{handbook.sourcePath}</span>
  <span>{formatUpdatedAt(handbook.updatedAt)}</span>
</div>
```

with labeled chips:

```tsx
<div className="pl-page-header-cell pl-page-header-cell--badges">
  <div className="pl-page-header-badges" aria-label="系统手册元数据">
    <span>
      来源 <code className="notranslate" translate="no">{handbook.sourcePath}</code>
    </span>
    <span>更新时间 {formatUpdatedAt(handbook.updatedAt)}</span>
  </div>
</div>
```

Keep `返回工作台` in the actions cell.

**Step 3: Make metadata chips wrap**

In `app.css`, ensure `.pl-page-header-cell--badges` can wrap and does not force header overflow:

```css
.pl-page-header-cell--badges {
  min-width: 0;
}

.pl-page-header-badges {
  max-width: 100%;
}

.pl-page-header-badges code {
  overflow-wrap: anywhere;
}
```

Use existing utility classes if preferred.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Expected: Header metadata assertions PASS.

---

## Task 3: Hide The Initial Handbook Metadata Table In Help Rendering

**Files:**

- Modify: `webui/src/pages/HelpCenter.tsx`
- Test: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Add a pure helper**

Add a local helper near `splitIntoSections`:

```ts
function stripLeadingHandbookMetadata(markdown: string): string {
  // Remove the document title plus the first pipe table when it appears before the first H2.
}
```

Required behavior:

- Remove only the leading H1 and immediately following metadata pipe table.
- Do not remove regular content tables inside sections.
- Do not mutate `handbook.markdown`; only transform the markdown passed to rendering.

**Step 2: Apply before `splitIntoSections`**

In the `sections` memo:

```ts
const renderMarkdown = stripLeadingHandbookMetadata(handbookQuery.data.markdown);
return splitIntoSections(renderMarkdown, handbookQuery.data.toc);
```

**Step 3: Keep TOC intact**

Do not remove items from `handbook.toc`. The TOC is still generated by the backend and should remain authoritative.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Expected: metadata table assertion PASS, M26 table rendering test still PASS.

---

## Task 4: Make Deep Link Scrolling Reliable

**Files:**

- Modify: `webui/src/pages/HelpCenter.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/help-center.test.tsx`

**Step 1: Stabilize scroll timing**

Update the effect:

```tsx
useEffect(() => {
  if (!activeSection || sections.length === 0) return;
  const frame = window.requestAnimationFrame(() => {
    document.getElementById(activeSection)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
  return () => window.cancelAnimationFrame(frame);
}, [activeSection, sections.length]);
```

If test environment lacks `requestAnimationFrame`, mock it in the test.

**Step 2: Increase scroll margin**

In `app.css`:

```css
.pl-help-section {
  scroll-margin-top: 96px;
}
```

Use an existing token / utility if available. The target heading should not hide under app chrome.

**Step 3: Test missing section behavior**

Add a test:

```ts
renderHelp("/help?section=does-not-exist");
expect(await screen.findByRole("heading", { name: "系统手册" })).toBeInTheDocument();
expect(scrollIntoView).not.toHaveBeenCalled();
```

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Expected: deep-link tests PASS.

---

## Task 5: Tune Help Layout Width And TOC Density

**Files:**

- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/help-center.test.tsx` if class assertions are useful

**Step 1: Set page and body reading constraints**

Recommended CSS:

```css
.pl-help-page {
  max-width: 1500px;
}

.pl-help-layout {
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
}

.pl-help-content {
  max-width: 1120px;
}
```

Avoid centering the whole app shell in a way that breaks other pages.

**Step 2: Make TOC less noisy**

Recommended CSS:

```css
.pl-help-toc-link {
  line-height: 1.35;
}

.pl-help-toc-link[aria-current="location"] {
  position: relative;
}

.pl-help-toc-link[aria-current="location"]::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 999px;
  background: var(--token-color-primary);
}
```

If `--token-color-primary` differs, use the existing primary/accent token.

**Step 3: Preserve mobile layout**

At `max-width: 900px`, keep single-column layout and static TOC.

**Step 4: Run focused test and manual screenshot**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
```

Manual browser check:

```text
http://127.0.0.1:55176/help?section=database-connection-acl-sync
http://127.0.0.1:55176/help?section=deployment-checklist
```

Expected:

- Header metadata no longer sticks together.
- Deep link lands on requested section.
- TOC current item is clearly visible.
- First screen starts with useful content, not a large metadata table.
- Tables remain readable and horizontally scroll if needed.

---

## Task 6: Verify Global Help Entry Still Works

**Files:**

- Test: `webui/src/__tests__/app-shell.test.tsx`

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- app-shell
```

Expected: PASS. The global `? 系统手册` entry still navigates to `/help`.

---

## Task 7: Full Verification

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- help-center
npm test -- app-shell
npm test -- --run src/__tests__/wiki.test.tsx
npm run build
```

If shared layout CSS changes more than Help-specific selectors, also run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run
```

Build may emit existing chunk-size warnings; that is acceptable if there are no errors.

---

## Task 8: Final Diff And Commit Scope

Review:

```bash
git -C /Users/zhangxingchen/Projects/project-lucy diff -- webui/src/pages/HelpCenter.tsx webui/src/app/app.css webui/src/__tests__/help-center.test.tsx webui/src/__tests__/app-shell.test.tsx webui/src/__tests__/wiki.test.tsx
```

Expected implementation files:

- `webui/src/pages/HelpCenter.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/help-center.test.tsx`

Possible verification-only files:

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/wiki.test.tsx`

Expected documentation files if this spec and plan are included:

- `webui/docs/33-help-center-layout-polish-spec.md`
- `webui/docs/plans/wo-M30-help-center-layout-polish.md`
- `webui/docs/README.md`
- `webui/docs/plans/README.md`

Do not stage unrelated dirty files from other active work.

Suggested commit message:

```text
fix(webui): polish help center layout
```

---

## Definition Of Done

- [ ] `/help?section=database-connection-acl-sync` scrolls to the matching section.
- [ ] Header source path and updated time render as separate metadata chips.
- [ ] Initial handbook metadata table no longer dominates the Help body first screen.
- [ ] TOC current item is visibly clear and retains `aria-current="location"`.
- [ ] Help content has a controlled reading width.
- [ ] Markdown tables and code blocks do not cause page-level horizontal overflow.
- [ ] Help API fixed-source contract remains unchanged.
- [ ] `npm test -- help-center` passes.
- [ ] `npm test -- app-shell` passes.
- [ ] `npm test -- --run src/__tests__/wiki.test.tsx` passes.
- [ ] `npm run build` passes.
