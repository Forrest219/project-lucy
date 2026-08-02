# M23 Connection Overview Operations UX Cleanup Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the database connection overview safer and faster for operations users by separating operation levels, locking row-scoped Manifest uploads, standardizing Schema terminology, improving YAML editing, and making connection-test logs actionable.

**Architecture:** This is a focused WebUI and API-contract cleanup over existing database access surfaces. Keep `ktx.yaml`, semantic-layer YAML, Catalog reload, Add Schema and connection-test behaviors on their current backends; adjust the presentation, contracts and tests so Connection-level, Schema-level and row-level operations are explicit.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS utility layer, existing Express-like WebUI server, KTX CLI wrapper. No new runtime dependency unless explicitly approved during implementation.

**Source Spec:** [../27-connection-overview-ops-ux-cleanup-spec.md](../27-connection-overview-ops-ux-cleanup-spec.md)

---

## Context For Developer

Read these documents before editing:

- `webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/26-database-connection-operations-runbook-spec.md`
- `docs/DEVELOPMENT.md`

Inspect these implementation files:

- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/components/connections/ConnectionTestDrawer.tsx`
- `webui/src/components/connections/ConnectionTestResultPanel.tsx`
- `webui/src/lib/schemas.ts`
- `webui/src/lib/types.ts`
- `webui/server/ktx.ts`
- `webui/server/index.ts`
- `webui/src/app/app.css`

Inspect these tests:

- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/add-schema-drawer.test.tsx`
- `webui/src/__tests__/connection-test.test.tsx`
- `webui/server/__tests__/ktx.test.ts`
- `webui/src/__tests__/lint-terminology-scan.test.ts`

Non-negotiable boundaries:

- Do not build a WebUI form for new physical database connections.
- Do not read, print, parse, or commit `.ktx/secrets/**`.
- Do not edit `CLAUDE.md` or `webui/config/data-qa-instructions.md`.
- Do not change Catalog Reload into physical database scanning.
- Do not remove upload validation, overwrite confirmation or path computation.
- Do not silently reformat user YAML before upload.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Task 1: Lock Row-Scoped Upload Manifest UX

**Files:**

- Modify: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Write failing tests for row-scoped upload**

In `webui/src/__tests__/catalog-asset-upload.test.tsx`, add a test that renders:

```tsx
<CatalogAssetUploadDrawer
  open
  onClose={vi.fn()}
  connectionId="demo-mysql"
  schema="openclaw_db"
  schemaOptions={["dataforai", "openclaw_db"]}
/>
```

Assert:

```ts
expect(screen.getByRole("dialog", { name: "上传 YAML 资产" })).toBeInTheDocument();
expect(screen.getByRole("heading", { name: /上传 openclaw_db 的 Schema Manifest/ })).toBeInTheDocument();
expect(screen.getByTestId("catalog-asset-upload-target-schema")).toHaveTextContent("openclaw_db");
expect(screen.queryByTestId("catalog-asset-upload-schema")).not.toBeInTheDocument();
expect(screen.getByTestId("catalog-asset-upload-filename")).toHaveValue("openclaw_db.yaml");
```

In `webui/src/__tests__/connection-overview.test.tsx`, extend the missing Manifest row-action test:

```ts
fireEvent.click(await screen.findByTestId("upload-yaml-demo-mysql-openclaw_db"));
expect(await screen.findByRole("heading", { name: /上传 openclaw_db 的 Schema Manifest/ })).toBeInTheDocument();
expect(screen.queryByTestId("catalog-asset-upload-schema")).not.toBeInTheDocument();
```

Expected before implementation: FAIL if the title still only names the connection.

**Step 2: Update Drawer title logic**

In `CatalogAssetUploadDrawer.tsx`, derive a title:

```ts
const title = schemaLocked
  ? `上传 ${schema} 的 Schema Manifest`
  : `上传 ${connectionId} 的 Schema Manifest`;
```

Use the title in the `<h2>`. Preserve the current read-only target Schema row when locked.

**Step 3: Ensure button labels match terminology**

Confirm `CatalogAssetUploadButton` defaults:

- No schema: `上传 YAML`
- With schema: `上传该 Schema 的 YAML`
- Row override from `ConnectionOverview.tsx`: `上传 Manifest`

Do not introduce `上传清单`.

**Step 4: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 2: Standardize Add Schema Terminology And Helpers

**Files:**

- Modify: `webui/src/lib/schemas.ts`
- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Test: `webui/src/__tests__/add-schema-drawer.test.tsx`
- Test: `webui/src/__tests__/lint-terminology-scan.test.ts` if needed

**Step 1: Write failing tests for stable Label**

In `webui/src/__tests__/add-schema-drawer.test.tsx`, replace expectations that look for `Schema 或 database 名`.

Add MySQL coverage:

```ts
expect(screen.getByText("Schema 名称")).toBeInTheDocument();
expect(screen.queryByText(/Schema 或 database 名/)).not.toBeInTheDocument();
expect(screen.getByText(/MySQL 中通常对应 database 名/)).toBeInTheDocument();
```

Add Postgres coverage using a connection fixture with `engine: "postgres"` or `driver: "postgres"`:

```ts
expect(screen.getByText("Schema 名称")).toBeInTheDocument();
expect(screen.getByText(/PostgreSQL 中请填写 schema，不是 database/)).toBeInTheDocument();
```

Expected before implementation: FAIL because current `schemaFieldLabel("mysql")` returns `Schema 或 database`.

**Step 2: Split Label from helper text**

In `webui/src/lib/schemas.ts`, replace `schemaFieldLabel` behavior with:

```ts
export function schemaFieldLabel(): string {
  return "Schema 名称";
}

export function schemaFieldHelper(engine?: string, driver?: string): string {
  const normalized = (engine ?? driver ?? "").toLowerCase();
  if (normalized === "mysql") return "MySQL 中通常对应 database 名。";
  if (normalized === "doris" || normalized === "starrocks") {
    return "Doris / StarRocks 使用 MySQL wire protocol 时，通常填写 database 名。";
  }
  if (normalized === "postgres" || normalized === "postgresql") {
    return "PostgreSQL 中请填写 schema，不是 database。";
  }
  return "填写要纳入该连接治理的 Schema。";
}
```

If the existing `ConnectionInfo` shape has both `engine` and `driver`, pass both from `AddSchemaDrawer`.

**Step 3: Render helper text in Add Schema Drawer**

In `AddSchemaDrawer.tsx`, keep the input label as `Schema 名称` and render helper text below the input:

```tsx
<p className="text-xs text-fg-muted">{fieldHelper}</p>
```

Wrap only professional English terms with `notranslate` / `translate="no"` where feasible. Do not over-wrap a full Chinese sentence if only `Schema`, `database`, `PostgreSQL` or `Doris / StarRocks` needs protection.

**Step 4: Run focused tests and terminology lint**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
npm run lint:terminology
```

Expected: PASS.

---

## Task 3: Separate Connection, Schema And Row Actions In ConnectionOverview

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Write failing layout tests**

In `connection-overview.test.tsx`, add or update tests so a connection card exposes:

```ts
const card = await screen.findByTestId("connection-card-mysql-aliyun");
const headerActions = within(card).getByTestId("connection-card-header-actions-mysql-aliyun");
expect(within(headerActions).getByRole("button", { name: "测试连接" })).toBeInTheDocument();
expect(within(headerActions).getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();

const footerActions = within(card).getByTestId("connection-card-schema-actions-mysql-aliyun");
expect(within(footerActions).getByRole("button", { name: /\+ 添加 Schema/ })).toBeInTheDocument();
expect(within(footerActions).getByRole("button", { name: "上传 YAML" })).toBeInTheDocument();
expect(within(footerActions).queryByRole("button", { name: "测试连接" })).not.toBeInTheDocument();
expect(within(footerActions).queryByRole("button", { name: "刷新本地目录" })).not.toBeInTheDocument();
```

Add table header coverage:

```ts
expect(within(card).getByRole("columnheader", { name: "操作" })).toBeInTheDocument();
```

Expected before implementation: FAIL because the footer currently contains all four actions and the last column may be labeled `上下文动作`.

**Step 2: Move connection-level buttons to header actions**

In `ConnectionOverview.tsx`, add a header action container near the connection title / badges:

```tsx
<div
  className="pl-connection-card-header-actions"
  data-testid={`connection-card-header-actions-${conn.id}`}
>
  <button>测试连接</button>
  <CatalogReloadButton ... />
</div>
```

Reuse existing click behavior for `测试连接`, including shared mutation / drawer state.

**Step 3: Keep Schema / asset actions in the footer**

Rename or add the footer action container:

```tsx
<div
  className="pl-connection-card-schema-actions"
  data-testid={`connection-card-schema-actions-${conn.id}`}
>
  <button>+ 添加 Schema</button>
  <CatalogAssetUploadButton label="上传 YAML" ... />
</div>
```

Preserve the Catalog status line.

**Step 4: Rename table action header**

Update the Schema table last column label to `操作`. Keep row actions:

- `维护白名单` when Manifest exists.
- `上传 Manifest` when Manifest is missing.

**Step 5: Adjust CSS**

In `app.css`, add or update classes so header actions wrap cleanly:

```css
.pl-connection-card-header-actions { ... }
.pl-connection-card-schema-actions { ... }
```

Keep 8px or smaller radius rules unless an existing token already sets radius.

**Step 6: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 4: Improve Upload YAML Editor Space And Keyboard Behavior

**Files:**

- Modify: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Write failing editor tests**

In `catalog-asset-upload.test.tsx`, add tests:

```ts
const textarea = await screen.findByTestId("catalog-asset-upload-textarea");
expect(textarea).toHaveClass("pl-upload-source-textarea");
```

Add Tab behavior coverage:

```ts
fireEvent.change(textarea, { target: { value: "tables:\n" } });
textarea.setSelectionRange(8, 8);
fireEvent.keyDown(textarea, { key: "Tab" });
expect(textarea).toHaveValue("tables:\n  ");
```

Expected before implementation: FAIL if Tab moves focus instead of inserting spaces.

**Step 2: Compact repeated guidance**

In `CatalogAssetUploadDrawer.tsx`, keep one concise top notice:

```text
目标路径由系统计算；会校验连接、Schema、YAML 结构、文件大小与目标路径。提交前会自动校验，写入成功后会自动刷新本地目录。
```

Keep the file dropzone interactive, but avoid adding another large text-only hint box.

**Step 3: Add Tab insertion handler**

Implement a small handler for the textarea:

```ts
function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Tab" || event.shiftKey) return;
  event.preventDefault();
  const target = event.currentTarget;
  const start = target.selectionStart;
  const end = target.selectionEnd;
  const next = `${content.slice(0, start)}  ${content.slice(end)}`;
  setContent(next);
  window.requestAnimationFrame(() => {
    target.selectionStart = target.selectionEnd = start + 2;
  });
}
```

Use the handler on the textarea. Keep Shift+Tab available for focus escape.

**Step 4: Increase editor usable space**

In `app.css`, update `.pl-upload-source-textarea`:

```css
.pl-upload-source-textarea {
  @apply min-h-72 resize-y font-mono text-xs leading-relaxed;
}
```

If responsive constraints require smaller mobile height, use media queries or utility classes.

**Step 5: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 5: Make Connection Test Diagnostics Copyable And Complete

**Files:**

- Modify: `webui/server/ktx.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/components/connections/ConnectionTestResultPanel.tsx`
- Modify: `webui/src/components/connections/ConnectionTestDrawer.tsx` if props need copy status
- Modify: `webui/src/app/app.css`
- Test: `webui/server/__tests__/ktx.test.ts`
- Test: `webui/src/__tests__/connection-test.test.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx` if fixture types require updates

**Step 1: Write failing backend contract tests**

In `webui/server/__tests__/ktx.test.ts`, extend `testConnection` success and failure tests:

```ts
expect(result.command).toBe("ktx connection test demo-mysql");
expect(result.args).toEqual(["connection", "test", "demo-mysql"]);
expect(result.exitCode).toBe(0);
expect(result.stdout).toBe("Status: ok\n");
expect(result.stderr).toBe("");
```

For failure:

```ts
expect(result.status).toBe("error");
expect(result.exitCode).toBe(1);
expect(result.stdout).toBe("");
expect(result.stderr).toBe("Access denied");
expect(result.command).toBe("ktx connection test demo-mysql");
```

Expected before implementation: FAIL because `command`, `args` and `exitCode` are not returned.

**Step 2: Update backend type and implementation**

In `server/ktx.ts`, extend `ConnectionTestResult`:

```ts
command: string;
args: string[];
exitCode: number | null;
stdout: string;
stderr: string;
```

Build `args` once:

```ts
const args = ["connection", "test", connId];
const command = `ktx ${args.join(" ")}`;
```

On success return `exitCode: 0`. On failure return `exitCode` from `error.code` when numeric, otherwise `1`. For `ENOENT`, keep rejecting with `KtxCliError`.

**Step 3: Update frontend types**

In `src/lib/types.ts`, mirror the new fields. Keep `detail?` and `reason?`.

**Step 4: Write failing frontend diagnostics tests**

In `connection-test.test.tsx`, add coverage:

```ts
expect(screen.getByTestId("connection-test-command")).toHaveTextContent("ktx connection test demo-mysql");
expect(screen.getByRole("button", { name: "复制命令" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "复制 Log" })).toBeInTheDocument();
expect(screen.getByTestId("connection-test-exit-code")).toHaveTextContent("0");
```

Add empty log coverage:

```ts
expect(screen.getByTestId("connection-test-log-empty")).toHaveTextContent("ktx 未返回原始日志输出");
```

Mock clipboard:

```ts
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
});
```

Assert copy command writes the command and copy log writes labeled stdout / stderr text.

**Step 5: Implement log toolbar and copy actions**

In `ConnectionTestResultPanel.tsx`:

- Always derive a safe command fallback: `result.command ?? \`ktx connection test ${connection.id}\``.
- Render command metadata above the log frame.
- Render `复制命令` and `复制 Log` buttons.
- Use `navigator.clipboard.writeText`.
- Show toast or inline text after copy success if the project already uses `sonner` in similar components; otherwise keep a local `aria-live` status.
- Keep stdout / stderr labels in the log text.

Suggested log copy text:

```text
$ ktx connection test demo-mysql

[stdout]
...

[stderr]
...
```

**Step 6: Adjust log frame styling**

In `app.css`, update `.pl-raw-log-frame` toward a terminal-style surface while preserving contrast:

```css
.pl-raw-log-frame {
  @apply h-72 overflow-auto rounded-md border border-border-strong bg-slate-950 p-3 font-mono text-xs text-slate-100;
}
```

If the project avoids slate-heavy palettes in app surfaces, use existing semantic tokens while preserving high contrast.

**Step 7: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/ktx.test.ts src/__tests__/connection-test.test.tsx src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 6: Final Regression, Terminology And Build Verification

**Files:**

- Modify tests as needed only for legitimate new UI contract changes.
- Do not touch unrelated files.

**Step 1: Run terminology lint**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
```

Expected: PASS. Fix any banned terms listed in `webui/docs/00-product-terminology-standard.md`, including legacy upload, Manifest and Schema wording, or missing translation-defense issues introduced by this work.

**Step 2: Run focused UI/API suite**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/catalog-asset-upload.test.tsx \
  src/__tests__/add-schema-drawer.test.tsx \
  src/__tests__/connection-test.test.tsx \
  server/__tests__/ktx.test.ts
```

Expected: PASS.

**Step 3: Run full tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test
```

Expected: PASS. If unrelated pre-existing failures appear, capture exact failures and explain why they are unrelated.

**Step 4: Run build**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run build
```

Expected: PASS.

**Step 5: Manual smoke checklist**

Start the dev server if needed:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run dev
```

Open `/connections` and verify:

- Connection card top actions contain `测试连接` and `刷新本地目录`.
- Schema table last column is `操作`.
- Missing Manifest row opens locked upload Drawer for that Schema.
- Global `上传 YAML` opens a Drawer with Schema selector enabled.
- Add Schema Drawer uses `Schema 名称` and database-specific helper text.
- YAML editor is larger, monospace, resizable and supports Tab indentation.
- Connection test Drawer shows command, log frame, copy command and copy log controls.

**Step 6: Final response**

Report:

- Files changed.
- Tests run and their result.
- Any intentional scope deferrals, for example line numbers or full-screen YAML editor if not implemented.
- Any residual risk around KTX stdout/stderr redaction.
