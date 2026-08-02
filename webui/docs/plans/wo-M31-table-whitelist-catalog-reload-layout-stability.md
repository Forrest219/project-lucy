# M31 Table Whitelist Catalog Reload Layout Stability Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize `/connections/whitelist` after `刷新本地目录` by moving transient reload feedback to Toast, anchoring missing Manifest diagnostics in the related Schema group, removing the duplicate Schema Manifest supplement entry from the whitelist page, and cleaning up toolbar and row action affordance.

**Architecture:** This is a frontend-only UX refinement over the existing `TableWhitelist` and shared Catalog reload components. Keep the Catalog reload API and whitelist save semantics unchanged; update component props, page layout, CSS and focused tests so the toolbar remains stable and Schema diagnostics remain persistent.

**Tech Stack:** React, TypeScript, TanStack Query, React Router, Sonner Toast, Vite, Vitest, Testing Library, existing CSS utility layer. No new runtime dependency.

**Source Spec:** [../34-table-whitelist-catalog-reload-layout-stability-spec.md](../34-table-whitelist-catalog-reload-layout-stability-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/docs/28-catalog-reload-result-ops-ux-spec.md`
- `webui/docs/31-connection-manifest-upload-affordance-spec.md`
- `webui/docs/34-table-whitelist-catalog-reload-layout-stability-spec.md`

Inspect these implementation files:

- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/components/catalog/CatalogReloadButton.tsx`
- `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/lib/catalogReload.ts`
- `webui/src/app/app.css`

Inspect these tests:

- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/catalog-reload-components.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/lint-terminology-scan.test.ts`

Non-negotiable boundaries:

- Do not change `刷新本地目录` into physical database scanning.
- Do not run `ktx ingest`.
- Do not edit `ktx.yaml`.
- Do not read, print, parse, or commit `.ktx/secrets/**`.
- Do not change the backend upload target path calculation for Schema Manifest.
- Do not provide a second Schema Manifest upload Drawer from `/connections/whitelist`; the Schema-level upload flow lives in `/connections`.
- Do not add table-level YAML upload to database access or whitelist pages; table-level YAML belongs in semantic layer maintenance as `上传 semantic overlay`.
- Do not remove existing whitelist dry-run, save, or floating save bar behavior.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请实现 `webui/docs/34-table-whitelist-catalog-reload-layout-stability-spec.md`。

交付：

1. `/connections/whitelist` 工具栏拆成左侧检索过滤和右侧批量/运维动作。
2. 工具栏内 `刷新本地目录` 成功后不显示 `完成 ✓ · N 张表`，也不显示 inline reload result panel。
3. 点击 `刷新本地目录` 后用 Toast 提示 `本地目录已刷新`，常驻 warning 留在对应 Schema 分组。
4. 缺失 Manifest 空 Schema 区块改为紧凑诊断，动作包含 `展开详情`、`复制路径`、`去连接概览上传 Manifest`。
5. `查看语义` 改为轻量链接视觉，字段数不显示无语义箭头。
6. 更新相关测试并运行术语 lint。

收尾说明必须列出修改文件、验证命令和结果。

## Task 1: Capture Toolbar Reload Stability In Tests

**Files:**

- Modify: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Mock Toast**

If not already mocked, mock `sonner` so reload success can be asserted:

```ts
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error
  }
}));
```

Reset mocks in `beforeEach`:

```ts
toastMocks.success.mockReset();
toastMocks.error.mockReset();
```

**Step 2: Add failing test for stable reload button**

Extend or add a test around `whitelist-reload-catalog`:

```ts
const reloadButton = await screen.findByTestId("whitelist-reload-catalog");
expect(reloadButton).toHaveTextContent("刷新本地目录");

fireEvent.click(reloadButton);

await waitFor(() => {
  expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/api/catalog/reload"))).toBe(true);
});

await waitFor(() => {
  expect(reloadButton).toHaveTextContent("刷新本地目录");
});

expect(screen.queryByText(/完成 ✓/)).not.toBeInTheDocument();
expect(screen.queryByTestId("catalog-reload-inline")).not.toBeInTheDocument();
expect(
  toastMocks.success.mock.calls.some(([message]) =>
    String(message).includes("本地目录已刷新")
  )
).toBe(true);
```

Expected before implementation: FAIL because `CatalogReloadButton` may render completion copy and inline result content.

**Step 3: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: FAIL for the new reload stability assertions.

## Task 2: Make Toolbar Reload Feedback Toast-Only

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/components/catalog/CatalogReloadButton.tsx` only if existing props are insufficient
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Disable inline result in whitelist toolbar**

In `TableWhitelist.tsx`, update the toolbar `CatalogReloadButton`:

```tsx
<CatalogReloadButton
  connectionId={toolbarReloadConnId}
  schema={toolbarReloadSchema}
  label="刷新本地目录"
  variant="secondary"
  testId="whitelist-reload-catalog"
  showCompletionLabel={false}
  showInlineResult={false}
  onReloadComplete={(run) => {
    const warningPart = run.warnings.length > 0 ? ` · ${run.warnings.length} 个提示` : "";
    toast.success(`本地目录已刷新 · ${run.tables} 张表${warningPart}`);
  }}
  onReloadError={(error) => {
    toast.error(`本地目录刷新失败：${error.message}`);
  }}
/>
```

Use the existing `CatalogReloadButton` callback props if they already work. Do not change `/connections` card-local reload behavior.

**Step 2: Confirm shared button behavior**

If `CatalogReloadButton` currently calls callbacks before hook state settles, keep the callback contract stable and avoid duplicate Toasts. The whitelist page should own the Toast copy for this context.

**Step 3: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS for reload stability and Toast assertions.

## Task 3: Refactor Toolbar Layout

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Add structural zones**

Change the toolbar markup to separate filters and operations:

```tsx
<div className="pl-whitelist-toolbar" role="toolbar" aria-label="表白名单工具栏">
  <div className="pl-whitelist-filter-area">
    ...
  </div>
  <div className="pl-whitelist-ops-area">
    ...
  </div>
</div>
```

Keep labels for search and `Schema 筛选`.

**Step 2: Tighten visible selection copy**

Change:

```text
已勾选 X / Y 张表
```

to:

```text
已选 X/Y 张表
```

Do not render a separate gray completion Badge for current selection.

**Step 3: Rename batch actions**

Change button copy:

- `全选当前结果` -> `全选`
- `反选当前结果` -> `反选`

Use lightweight link or ghost-link styling, not filled buttons.

**Step 4: Style stable layout**

Add CSS that keeps the toolbar compact:

```css
.pl-whitelist-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.pl-whitelist-filter-area,
.pl-whitelist-ops-area {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.pl-whitelist-ops-area {
  margin-left: auto;
}
```

Reuse existing spacing tokens if present.

**Step 5: Update existing tests**

Update existing expectations from `已勾选 X / Y 张表` to `已选 X/Y 张表`, and from `全选当前结果` / `反选当前结果` to `全选` / `反选`.

**Step 6: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

## Task 4: Compact Missing Manifest Diagnostic

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Add failing test for missing Manifest contract**

Update the configured-empty test:

```ts
const empty = await screen.findByTestId("configured-schema-empty-mysql-aliyun-openclaw_db");

expect(empty).toHaveTextContent("缺少 Manifest：openclaw_db");
expect(empty).toHaveTextContent("openclaw_db 已在连接配置中启用，但本地 schema 文件不存在。");
expect(within(empty).getByText("semantic-layer/mysql-aliyun/_schema/openclaw_db.yaml")).toBeInTheDocument();
expect(within(empty).getByRole("button", { name: "展开详情" })).toHaveAttribute("aria-expanded", "false");
expect(within(empty).getByRole("button", { name: "复制路径" })).toBeInTheDocument();
expect(within(empty).getByRole("link", { name: "去连接概览上传 Manifest" })).toHaveAttribute("href", "/connections");
expect(within(empty).queryByRole("button", { name: "上传 Manifest" })).not.toBeInTheDocument();
expect(within(empty).queryByText("上传该 Schema 的 YAML")).not.toBeInTheDocument();
```

Expected before implementation: FAIL because the current empty state uses older copy and upload label.

**Step 2: Replace empty-state copy**

In `configuredSchemasWithoutTables.map`, change the `pl-empty-state` content to a compact diagnostic block:

```tsx
const schemaManifestPath = `semantic-layer/${conn.id}/_schema/${schema}.yaml`;
```

Render:

- Title: `缺少 Manifest：${schema}`
- Description: `${schema} 已在连接配置中启用，但本地 schema 文件不存在。`
- Path code with `translate="no"`, `className="notranslate"`, `dir="ltr"`.

**Step 3: Implement details toggle**

Add small local state keyed by `conn.id + schema` or use native `<details>`.

If using native `<details>`, the summary text may be `展开详情`, but tests should assert the visible summary rather than `aria-expanded`. If using a button, add `aria-expanded` and render a compact explanation:

```text
表白名单只读取本地 YAML 资产。刷新本地目录不会连接数据库，也不会生成新的 Manifest。
```

**Step 4: Add copy path action**

Add a small button:

```tsx
await navigator.clipboard.writeText(schemaManifestPath)
```

On success, Toast: `已复制 Manifest 路径`.

If Clipboard API is unavailable or rejects, Toast error: `复制路径失败`.

**Step 5: Replace upload action with connection overview repair link**

Remove `CatalogAssetUploadButton` from the `/connections/whitelist` missing Manifest diagnostic. Do not open `CatalogAssetUploadDrawer` from this page.

Add a link with copy `去连接概览上传 Manifest` and `href="/connections"`. If the router already supports route state or query params, pass `connectionId` and `schema` so `/connections` can pre-focus the relevant connection or Schema; otherwise keep the visible path and copy button so the user has enough context.

**Step 6: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

## Task 5: Clean Row Affordance And Field Count

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Add tests for row action styling**

For an included row:

```ts
const row = await screen.findByTestId("whitelist-row-dataforai.superstore_orders");
const link = within(row).getByRole("link", { name: "查看语义" });

expect(link).toHaveAttribute("href", "/sources/mysql-aliyun/dataforai/superstore_orders");
expect(link.className).toContain("pl-inline-link");
expect(link.className).not.toContain("pl-btn--ghost");
expect(link.className).not.toContain("pl-btn--primary");
expect(link.className).not.toContain("pl-btn--secondary");
```

For field count:

```ts
expect(within(row).getByText("8 个")).toBeInTheDocument();
expect(within(row).queryByText(/↑/)).not.toBeInTheDocument();
```

**Step 2: Add or reuse inline link class**

In `app.css`, define a compact link class if none exists:

```css
.pl-inline-link {
  color: var(--color-link);
  font-weight: 500;
  text-decoration: none;
}

.pl-inline-link:hover,
.pl-inline-link:focus-visible {
  text-decoration: underline;
}
```

Use existing tokens if the codebase already has link variables.

**Step 3: Apply to `查看语义`**

Replace:

```tsx
className="pl-btn pl-btn--ghost text-xs"
```

with:

```tsx
className="pl-inline-link text-xs"
```

Keep the route unchanged.

**Step 4: Confirm field count rendering**

Ensure the field count cell only renders:

```tsx
{row.columnCount !== undefined ? `${row.columnCount} 个` : "-"}
```

No arrow glyph should be appended by component logic or CSS pseudo content.

**Step 5: Run focused test**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

## Task 6: Terminology And Visual Regression Checks

**Files:**

- Modify as needed based on lint output:
  - `webui/src/pages/connections/TableWhitelist.tsx`
  - `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
  - `webui/src/app/app.css`
  - tests touched above

**Step 1: Run terminology lint**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
```

Expected: PASS. In particular, `/connections/whitelist` must not display `上传该 Schema 的 YAML` and must not render a direct `上传 Manifest` button.

**Step 2: Run related component tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/table-whitelist.test.tsx src/__tests__/catalog-reload-components.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

**Step 3: Optional manual browser check**

If a dev server is already running, inspect:

```text
http://127.0.0.1:55176/connections/whitelist
```

Click `刷新本地目录` and verify:

- Toolbar height stays stable.
- Toast appears with `本地目录已刷新`.
- No inline yellow result card appears in the toolbar.
- `OPENCLAW_DB` section still shows a compact missing Manifest diagnostic.
- Missing Manifest repair routes to `/connections` for Schema Manifest upload.
- `查看语义` looks like a link.

## Acceptance Checklist

- [ ] Toolbar is split into filter and operations areas.
- [ ] Reload success does not render `完成 ✓ · N 张表` in the toolbar.
- [ ] Reload success does not render `CatalogReloadResultPanel` inside the toolbar.
- [ ] Reload success uses Toast copy `本地目录已刷新`.
- [ ] Missing Manifest diagnostic is anchored in the Schema group.
- [ ] Missing Manifest repair action is `去连接概览上传 Manifest`.
- [ ] `上传该 Schema 的 YAML` is absent from `/connections/whitelist`.
- [ ] `/connections/whitelist` does not render a direct Schema Manifest upload button or Drawer.
- [ ] `查看语义` is a link-style row action.
- [ ] Field count cells do not show unexplained arrows.
- [ ] Focused tests pass.
- [ ] Terminology lint passes.
