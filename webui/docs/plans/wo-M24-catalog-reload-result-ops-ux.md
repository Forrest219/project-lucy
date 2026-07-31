# M24 Catalog Reload Result Operations UX Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `刷新本地目录` feedback on `/connections` read like a compact DataOps status and diagnostic workflow inside the current Connection Card.

**Architecture:** This is a frontend-first UX refinement over the existing local Catalog reload flow. Keep the backend reload semantics unchanged; reshape the Connection Card so reload summary, Schema asset table and warning diagnostics share one context and can be tested as a stable UI contract.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS utility layer, existing Catalog reload API and KTX wrapper. No new runtime dependency.

**Source Spec:** [../28-catalog-reload-result-ops-ux-spec.md](../28-catalog-reload-result-ops-ux-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/28-catalog-reload-result-ops-ux-spec.md`
- `webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/00-product-terminology-standard.md`
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/components/catalog/CatalogReloadButton.tsx` if present
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/lib/types.ts`
- `webui/src/app/app.css`

Inspect these tests:

- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/lint-terminology-scan.test.ts`

Non-negotiable boundaries:

- Do not change `刷新本地目录` into physical database scanning.
- Do not run `ktx ingest`.
- Do not read, print, parse, or commit `.ktx/secrets/**`.
- Do not edit `ktx.yaml` for this work order.
- Do not remove row-scoped `上传 Manifest` locking from M23.
- Do not turn warning details into a global toast-only experience; the result must stay in the card.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Capture Current Reload Result Contract In Tests

**Files:**

- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Add failing test for non-floating reload status**

Add a test that renders a connection with a successful reload result and one missing Manifest warning. Assert the card contains a status bar:

```ts
const card = await screen.findByTestId("connection-card-demo-mysql");
const status = within(card).getByTestId("catalog-reload-status-demo-mysql");

expect(status).toHaveTextContent("本地目录已刷新");
expect(status).toHaveTextContent("已完成");
expect(status).toHaveTextContent("3 张表");
expect(status).toHaveTextContent("1 个提示");
expect(within(status).queryByRole("button", { name: /完成/ })).not.toBeInTheDocument();
```

Expected before implementation: FAIL if `完成 ✓ · 3 张表` is still rendered as a button or floating control.

**Step 2: Add failing test for reading order**

In the same test, assert the Schema asset list appears before the inline warning panel:

```ts
const table = within(card).getByTestId("schema-asset-table-demo-mysql");
const warning = within(card).getByTestId("catalog-reload-warning-demo-mysql-openclaw_db");

expect(table.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Assert visible copy:

```ts
expect(within(card).getByText("关联 Schema 资产列表")).toBeInTheDocument();
expect(within(card).getByRole("columnheader", { name: "Manifest 状态" })).toBeInTheDocument();
expect(within(card).getByText("缺失 Manifest")).toBeInTheDocument();
expect(warning).toHaveTextContent("缺少 Manifest：openclaw_db");
expect(warning).toHaveTextContent("semantic-layer/demo-mysql/_schema/openclaw_db.yaml");
```

Expected before implementation: FAIL if warning is rendered in a detached side panel or above the table.

**Step 3: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: FAIL for the new assertions.

---

## Task 2: Implement Card-Local Reload Status Bar

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Replace floating completion control**

In `ConnectionOverview.tsx`, locate the rendering path that creates the current `完成 ✓ · 3 张表` element after `刷新本地目录`.

Replace it with a non-interactive status bar inside the card content:

```tsx
<div
  className="pl-catalog-reload-status"
  data-testid={`catalog-reload-status-${conn.id}`}
  role="status"
>
  <span>本地目录已刷新 · {lastReloadTime}</span>
  <span className="pl-status-badge pl-status-badge-success">已完成</span>
  <span className="pl-status-badge">{tableCount} 张表</span>
  {warningCount > 0 ? (
    <span className="pl-status-badge pl-status-badge-warning">
      {warningCount} 个提示
    </span>
  ) : null}
</div>
```

Use existing badge classes if the project already has equivalents. Do not introduce a clickable element for `已完成`.

**Step 2: Add loading and failure variants**

Ensure the same status area handles:

- `正在刷新本地目录...`
- `本地目录已刷新 · HH:mm`
- `本地目录刷新失败 · HH:mm`

The reload button itself should be disabled while loading.

**Step 3: Style the status bar**

In `app.css`, add or reuse compact styling:

```css
.pl-catalog-reload-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
```

Keep the status bar aligned to the card content edge. Do not use absolute positioning or large side-panel spacing.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS for status-bar assertions, remaining warning-order tests may still fail.

---

## Task 3: Keep Schema Asset Table Above Warning Diagnostics

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Normalize table section heading and test id**

Wrap the existing Schema rows in a section:

```tsx
<section className="pl-schema-asset-section">
  <h3>关联 Schema 资产列表</h3>
  <table data-testid={`schema-asset-table-${conn.id}`}>
    ...
  </table>
</section>
```

Use existing heading size tokens. This is a compact operational section, not a hero heading.

**Step 2: Confirm table column contract**

Ensure columns are:

- `Schema`
- `Manifest 状态`
- `本地表数`
- `操作`

Do not use `上下文动作` in this table for this work order.

**Step 3: Ensure missing Manifest row is actionable**

For `openclaw_db` or any configured Schema with missing manifest:

```tsx
<span className="pl-status-badge pl-status-badge-warning">缺失 Manifest</span>
<span>0 张表</span>
<CatalogAssetUploadButton label="上传 Manifest" schema={schemaName} ... />
```

The row action must keep the Drawer locked to the row Schema.

**Step 4: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS for table contract assertions.

---

## Task 4: Implement Inline Missing Manifest Diagnostic Panel

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Add failing test for expandable details**

Extend the warning test:

```ts
const warning = within(card).getByTestId("catalog-reload-warning-demo-mysql-openclaw_db");
const detailsButton = within(warning).getByRole("button", { name: "展开详情" });

expect(detailsButton).toHaveAttribute("aria-expanded", "false");
fireEvent.click(detailsButton);
expect(detailsButton).toHaveAttribute("aria-expanded", "true");
expect(warning).toHaveTextContent("missing_manifest");
```

Expected before implementation: FAIL if details are plain centered text or always visible.

**Step 2: Render compact warning panel below the table**

Render one panel per relevant warning or a grouped panel if the backend returns multiple missing manifest warnings. For MVP, support the current single warning shape:

```tsx
<section
  className="pl-catalog-reload-warning"
  data-testid={`catalog-reload-warning-${conn.id}-${schemaName}`}
  role="status"
>
  <strong>缺少 Manifest：{schemaName}</strong>
  <p>{schemaName} 已在连接配置中启用，但本地 schema 文件不存在。</p>
  <p>
    路径：
    <code translate="no" className="notranslate">{manifestPath}</code>
  </p>
  ...
</section>
```

Use `role="alert"` only for true reload failures.

**Step 3: Implement details toggle**

Add local state keyed by connection and schema:

```tsx
const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
```

Button:

```tsx
<button
  type="button"
  aria-expanded={expanded}
  onClick={() => toggleWarning(key)}
>
  {expanded ? "收起详情" : "展开详情"}
</button>
```

Expanded detail can include:

- warning code, for example `missing_manifest`
- expected manifest path
- `刷新本地目录` only reads local YAML and does not connect to the database

**Step 4: Add remediation actions**

Add actions in the panel footer:

- `上传 Manifest` if the current row-scoped upload button is not already visually adjacent on narrow layouts.
- `打开目录` if the app already has a supported local-folder action.
- Otherwise use `复制路径`.
- `重新检查` calls the same connection reload handler.

Do not add a disabled-looking action that has no behavior. If `打开目录` cannot be implemented safely in the browser environment, implement `复制路径` and document the fallback in code comments or tests.

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 5: Terminology And Translation Defense

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Test: `webui/src/__tests__/lint-terminology-scan.test.ts`

**Step 1: Protect professional terms and paths**

Ensure rendered nodes for these values have `translate="no"` and `notranslate`:

- `Schema`
- `Manifest`
- connection id, for example `demo-mysql`
- Schema name, for example `openclaw_db`
- path, for example `semantic-layer/demo-mysql/_schema/openclaw_db.yaml`

**Step 2: Remove banned wording**

Search within changed UI strings and tests for wording that violates the product terminology standard:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm run lint:terminology
```

Expected: no banned user-facing strings introduced by this work.

**Step 3: Run terminology lint**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
```

Expected: PASS.

---

## Task 6: Visual QA And Regression Verification

**Files:**

- Modify tests only if they reflect legitimate contract updates.
- Do not touch unrelated implementation files.

**Step 1: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

**Step 2: Run full WebUI verification**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test
npm run build
```

Expected: PASS. If unrelated pre-existing failures appear, record exact failures and keep this work order scoped.

**Step 3: Manual smoke on `/connections`**

Start the dev server if needed:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run dev
```

Open `/connections` and verify:

- Clicking `刷新本地目录` updates a card-local status bar.
- No floating `完成 ✓ · 3 张表` control appears.
- `关联 Schema 资产列表` appears above warning diagnostics.
- `openclaw_db` row shows `缺失 Manifest` and `0 张表`.
- Inline panel shows `缺少 Manifest：openclaw_db` and the expected path.
- `展开详情` toggles details and exposes `aria-expanded`.
- Row action `上传 Manifest` opens the locked upload Drawer for `openclaw_db`.
- Layout has no large unexplained blank area at desktop width and no text overlap on mobile width.

**Step 4: Final response**

Report:

- Files changed.
- Focused and full verification results.
- Whether `打开目录` was implemented directly or safely degraded to `复制路径`.
- Any residual risk, especially if backend warning payloads are not yet structured by warning code.
