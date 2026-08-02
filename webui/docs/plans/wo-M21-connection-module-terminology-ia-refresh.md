# M21 Connection Module Terminology And IA Refresh Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix database connection module terminology, remove machine-translation artifacts, consolidate connection-centric workflows, and clean up upload / reload UX so the module meets enterprise SaaS delivery quality.

**Architecture:** Keep M14/M17 static Catalog architecture unchanged. This work is a frontend/product IA refresh: centralize terminology, move connection-specific testing into connection context, remove system-level package export from `/connections`, and simplify reload result presentation. Backend work should be limited to existing API reuse unless tests reveal missing data needed by the new drawer.

**Tech Stack:** React 19, React Router, TanStack Query, Fastify existing APIs, Vitest, Testing Library, existing `apiClient`, existing catalog upload/reload components, existing CSS in `webui/src/app/app.css`.

**Source Spec:** [../25-connection-module-terminology-ia-refresh-spec.md](../25-connection-module-terminology-ia-refresh-spec.md)

---

## Context For Minimax / Developer

Read these documents before coding:

- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/22-public-mcp-endpoint-runtime-config-spec.md`
- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/docs/03-api-spec.md`
- `docs/DEVELOPMENT.md`

Read these frontend files:

- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/connections/ConnectionTest.tsx`
- `webui/src/pages/connections/constants.ts`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- `webui/src/components/catalog/CatalogReloadButton.tsx`
- `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/types.ts`

Read these tests:

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/connection-test.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/catalog-reload-components.test.tsx`

Relevant backend files if drawer/test wiring needs confirmation:

- `webui/server/index.ts`
- `webui/server/catalog-reload.ts`
- `webui/server/catalog-assets.ts`
- `webui/server/model.ts`

Non-negotiable boundaries:

- Do not execute `ktx ingest`.
- Do not access physical databases except through the existing connection test API.
- Do not introduce LLM / embedding / enrichment dependencies.
- Do not remove `/connections/test`; keep it as a compatible route unless a later migration explicitly deletes it.
- Follow `webui/docs/00-product-terminology-standard.md` for every user-visible term.
- Do not translate `Schema` as `架构` or `模式`.
- Do not translate `Manifest` as `舱单` or `清单` in user-visible status tags.
- Do not expose `.ktx/secrets/**`.
- Do not allow client-supplied filesystem paths.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Task 1: Terminology Guardrails And Audit Tests

**Files:**

- Modify: `webui/src/pages/connections/constants.ts`
- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/pages/connections/ConnectionTest.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`
- Test: `webui/src/__tests__/connection-test.test.tsx`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Add failing terminology tests**

Add assertions that rendered connection module pages do not contain forbidden strings:

```ts
const forbiddenTerms = [
  "财政部舱单",
  "上传报价包",
  "替代测试",
  "添加架构",
  "目标架构",
  "目标模式",
  "模式清单"
];

for (const term of forbiddenTerms) {
  expect(screen.queryByText(term, { exact: false })).not.toBeInTheDocument();
}
```

Cover at least:

- `/connections` render.
- `/connections/whitelist` render.
- `/connections/test` render.
- `CatalogAssetUploadDrawer` render.
- Sidebar navigation labels in `AppShell`.

**Step 2: Run tests to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: FAIL while the current UI still contains mistranslated strings.

**Step 3: Replace terminology in UI code**

Use these replacements:

| Current | Replace With |
|---|---|
| `财政部舱单` | `缺失 Manifest` |
| `上传报价包` | `上传资产包` if package-level, `上传 YAML` if schema manifest-level |
| `替代测试` | `连通测试` |
| `添加架构` | `添加 Schema` |
| `目标架构` / `目标模式` | `目标 Schema` |
| `模式筛选` | `Schema 筛选` |
| `全部架构` | `全部 Schema` |
| `模式清单` | `Manifest` |

Prefer keeping `Schema` and `Manifest` in English inside short labels.

**Step 4: Run tests to verify pass**

```bash
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 2: Fix Upload YAML Drawer Copy And Layout

**Files:**

- Modify: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Write failing tests for legal placeholder and close layout**

In `catalog-asset-upload.test.tsx`, assert:

- Drawer title uses `Schema Manifest`, not `模式清单`.
- Target label is `目标 Schema`.
- Textarea placeholder contains legal YAML:

```yaml
tables:
  customers:
    table: openclaw_db.customers
```

- Placeholder does not contain `表:` or `客户:`.
- Close button accessible name is `关闭` and rendered as one button.
- Selected filename is rendered exactly:

```ts
expect(screen.getByText("openclaw_db.yaml")).toBeInTheDocument();
expect(screen.queryByText("openclaw_db已.yaml")).not.toBeInTheDocument();
```

**Step 2: Run tests to verify failure**

```bash
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
```

Expected: FAIL.

**Step 3: Update Drawer copy**

Recommended visible copy:

```text
上传 demo-mysql 的 Schema Manifest
目标路径由系统计算；会校验连接、Schema、YAML 结构、文件大小与目标路径。写入成功后会自动刷新本地目录。
目标 Schema：openclaw_db
或直接粘贴 YAML 源码
```

Textarea placeholder:

```yaml
tables:
  customers:
    table: openclaw_db.customers
    columns:
      - name: customer_id
      - name: customer_name
```

**Step 4: Fix filename rendering**

Render file name in a non-translated span:

```tsx
<span translate="no" dir="ltr">{selectedFile.name}</span>
```

Do not concatenate validation status into the filename string.

**Step 5: Fix close and footer CSS**

Use a stable close button class:

```css
.pl-drawer-close {
  @apply inline-flex h-8 w-8 items-center justify-center whitespace-nowrap rounded-sm;
}
```

Footer:

```css
.pl-drawer-footer {
  @apply flex flex-wrap items-center justify-end gap-3 border-t border-border-default px-6 py-4;
}
```

Use existing class names if already present; do not invent a second drawer system if the project has one.

**Step 6: Run tests**

```bash
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 3: Connection Overview Action Hierarchy And Package Export Removal

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`
- Possibly modify: package export component/page if one exists, e.g. `webui/src/components/semantic-assets/*` or `webui/src/pages/Review.tsx`

**Step 1: Write failing tests**

Add assertions:

```ts
expect(screen.queryByRole("button", { name: /上传报价包/ })).not.toBeInTheDocument();
expect(screen.queryByText("下载当前全量资产包")).not.toBeInTheDocument();
```

For the connection card:

```ts
expect(screen.getByRole("button", { name: "添加 Schema" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传 YAML" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "测试连接" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
```

For schema row:

```ts
expect(screen.getByTestId("schema-asset-status-demo-mysql-openclaw_db")).toHaveTextContent("缺失 Manifest");
expect(screen.getByTestId("upload-yaml-demo-mysql-openclaw_db")).toHaveTextContent("上传 Manifest");
```

**Step 2: Run tests to verify failure**

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: FAIL until the export card and bad labels are removed.

**Step 3: Remove package export from `/connections`**

If export UI currently lives inside `ConnectionOverview.tsx`, remove it from that page.

If a reusable export button exists, move its import and render to a more appropriate location:

- `Review.tsx`
- future `SemanticAssetDelivery` page
- existing semantic asset publish/export page if M19 code exists

Do not create a new top-level route unless the current app already has one planned and tested.

**Step 4: Reduce button competition**

Keep schema row context actions:

- `维护白名单`
- `上传 Manifest`

Keep card footer connection actions:

- `添加 Schema`
- `上传 YAML`
- `测试连接`
- `刷新本地目录`

Do not include `上传资产包` in the connection card footer.

**Step 5: Run tests**

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 4: Connection Test Drawer And Compatibility Page

**Files:**

- Create or modify: `webui/src/components/connections/ConnectionTestDrawer.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/connections/ConnectionTest.tsx`
- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`
- Test: `webui/src/__tests__/connection-test.test.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Write failing tests for nav and drawer**

App shell:

```ts
expect(screen.getByRole("link", { name: "连通测试" })).toBeInTheDocument();
expect(screen.queryByRole("link", { name: "替代测试" })).not.toBeInTheDocument();
```

Connection overview:

```ts
fireEvent.click(await screen.findByTestId("test-connection-demo-mysql"));
expect(await screen.findByRole("dialog", { name: /连通测试/ })).toBeInTheDocument();
```

Connection test page:

```ts
expect(await screen.findByRole("heading", { name: "连通测试" })).toBeInTheDocument();
expect(screen.queryByText("替代测试")).not.toBeInTheDocument();
```

**Step 2: Run tests to verify failure**

```bash
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/connection-test.test.tsx
```

Expected: FAIL.

**Step 3: Implement shared `ConnectionTestDrawer`**

Props:

```ts
type ConnectionTestDrawerProps = {
  connection: ConnectionInfo;
  open: boolean;
  onClose: () => void;
};
```

Behavior:

- Runs `POST /api/connections/:connId/test`.
- Shows:
  - status banner
  - latency
  - driver / wire protocol / read-only expected
  - collapsible stdout / stderr logs
- Reuses current `ConnectionTest` parsing/rendering helpers where possible.

**Step 4: Wire overview button**

In `ConnectionOverview.tsx`, `测试连接` should open the drawer instead of only mutating inline status, or it may both update card state and open drawer.

**Step 5: Keep `/connections/test` compatible**

`ConnectionTest.tsx` should:

- Use title `连通测试`.
- Prefer the same result panel component as the drawer.
- Optionally show guidance: `也可以在连接概览中对单个连接执行测试。`

Do not delete the route.

**Step 6: Run tests**

```bash
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/connection-test.test.tsx
```

Expected: PASS.

---

## Task 5: Simplify Catalog Reload Result Panel

**Files:**

- Modify: `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- Modify: `webui/src/components/catalog/CatalogReloadButton.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/catalog-reload-components.test.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Write failing tests for concise summary**

Expected summary:

```ts
expect(screen.getByTestId("catalog-reload-result")).toHaveTextContent(
  "本地 Catalog 已重新加载"
);
expect(screen.getByTestId("catalog-reload-result")).toHaveTextContent("1 个提示");
```

The main summary should not include:

```ts
expect(screen.queryByText(/耗时 8 ms/)).not.toBeInTheDocument();
expect(screen.queryByText(/1 \\/ 2 schemas/)).not.toBeInTheDocument();
```

Warning should be readable:

```ts
expect(screen.getByText("缺失 Manifest · openclaw_db")).toBeInTheDocument();
```

**Step 2: Run tests to verify failure**

```bash
npm test -- --run src/__tests__/catalog-reload-components.test.tsx
```

Expected: FAIL.

**Step 3: Refactor result panel**

Render:

```text
本地 Catalog 已重新加载 · 1 个提示
[详情]
```

Inside details:

- Scope.
- Duration.
- Tables.
- Enabled tables.
- Schema ratio.

Warnings:

- Map `SCHEMA_MANIFEST_MISSING` to `缺失 Manifest`.
- Keep raw warning code in `title` or details, not main user-facing label.

**Step 4: Update CSS**

Avoid nested orange border on orange border:

- Outer result panel: neutral or subtle warning border.
- Warning item: light background without heavy border, or one clear border only.

**Step 5: Run tests**

```bash
npm test -- --run src/__tests__/catalog-reload-components.test.tsx src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 6: Whitelist Page Terminology Cleanup

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Write failing tests**

Assert:

```ts
expect(screen.getByText("Schema 筛选")).toBeInTheDocument();
expect(screen.getByRole("option", { name: "全部 Schema" })).toBeInTheDocument();
expect(screen.queryByText("全部架构")).not.toBeInTheDocument();
expect(screen.queryByText("模式筛选")).not.toBeInTheDocument();
```

For empty schema:

```ts
expect(screen.getByText(/缺失 Manifest|尚未提供 Manifest/)).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传该 Schema 的 YAML" })).toBeInTheDocument();
```

**Step 2: Run failing tests**

```bash
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: FAIL if current terminology is inconsistent.

**Step 3: Replace copy**

Use:

- `Schema 筛选`
- `全部 Schema`
- `连接：DEMO-MYSQL · Schema：DATAFORAI`
- `openclaw_db 已在连接配置中启用，但本地语义层尚未提供 Manifest。`

**Step 4: Run tests**

```bash
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

---

## Task 7: Final Regression And Commit Strategy

**Files:**

- All files touched in Tasks 1-6.

**Step 1: Run targeted database接入 suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-test.test.tsx \
  src/__tests__/catalog-asset-upload.test.tsx \
  src/__tests__/catalog-reload-components.test.tsx
```

Expected: PASS.

**Step 2: Run full test suite**

```bash
npm test -- --run
```

Expected: PASS.

**Step 3: Run build**

```bash
npm run build
```

Expected: PASS. Vite chunk-size warnings are acceptable if unchanged and unrelated.

**Step 4: Manual QA checklist**

Open WebUI and verify:

- `/connections` has no `财政部舱单`, no `上传报价包`, no `添加架构`.
- `/connections` has no full-width package export card below connection cards.
- Missing manifest row says `缺失 Manifest`.
- Clicking `上传 Manifest` opens Drawer with legal YAML placeholder.
- Drawer close button is not vertically wrapped.
- Selected file name displays exactly.
- Clicking `测试连接` on a connection opens test Drawer / Modal.
- `/connections/test` still loads and says `连通测试`.
- Reload result summary is concise and details are collapsible.

**Step 5: Commit**

Prefer small commits if implementation is split:

```bash
git add webui/src webui/docs/25-connection-module-terminology-ia-refresh-spec.md webui/docs/plans/wo-M21-connection-module-terminology-ia-refresh.md
git commit -m "fix(webui): normalize connection module terminology"
```

If all tasks land together:

```bash
git commit -m "fix(webui): refresh connection module terminology and IA"
```

## Reviewer Checklist

- [ ] No forbidden machine-translation strings remain in database接入 UI.
- [ ] `Schema` and `Manifest` terminology is consistent.
- [ ] Upload Drawer placeholder is valid YAML.
- [ ] Upload Drawer filename display is exact and non-translated.
- [ ] `/connections` no longer hosts system-level package export UI.
- [ ] `测试连接` is available from connection context.
- [ ] `/connections/test` remains compatible and uses `连通测试`.
- [ ] Catalog reload result is concise and not visually double-nested.
- [ ] Tests and build pass.
