# M17 Connection Catalog Upload UX Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn database connection Catalog maintenance into a self-service WebUI workflow: simplify `/connections` IA, clarify Add Schema guidance, rename ambiguous reload actions, and let analysts upload validated local schema manifest YAML without relying on ops to copy files.

**Architecture:** Preserve M14's zero-CLI static Catalog architecture. Add a controlled YAML asset upload API that validates and writes only `semantic-layer/<connection>/_schema/<schema>.yaml`, records bounded audit sidecar metadata, then calls the existing static `POST /api/catalog/reload`. Refactor the frontend around explicit actions: add schema, upload YAML, test connection, and refresh local directory.

**Tech Stack:** Fastify, TypeScript, Node `fs/promises`, `crypto`, YAML parser already used by the server, React 19, TanStack Query, React Router, Vitest, Testing Library, existing `apiClient`, existing `fs-safe`, existing CSS in `webui/src/app/app.css`.

**Source Spec:** [../21-connection-catalog-upload-ux-spec.md](../21-connection-catalog-upload-ux-spec.md)

---

## Context For Minimax / Developer

Read these documents before coding:

- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/docs/03-api-spec.md`
- `docs/DEVELOPMENT.md`

Read these backend files:

- `webui/server/index.ts`
- `webui/server/catalog-reload.ts`
- `webui/server/fs-safe.ts`
- `webui/server/project.ts`
- `webui/server/semantic-layer.ts`
- `webui/server/__tests__/api.catalog-reload.test.ts`
- `webui/server/__tests__/api.add-schema.test.ts`

Read these frontend files:

- `webui/src/lib/api.ts`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/catalog-reload.ts`
- `webui/src/components/catalog/CatalogReloadButton.tsx`
- `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/connections/ConnectionTest.tsx`
- `webui/src/pages/connections/constants.ts`
- `webui/src/app/app.css`

Read these frontend tests:

- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/add-schema-drawer.test.tsx`
- `webui/src/__tests__/connection-test.test.tsx`

Non-negotiable boundaries:

- Do not execute `ktx ingest` or any physical database scan from WebUI.
- Do not add LLM, embedding, enrichment, or third-party network dependency.
- Do not read, write, expose, or test against `.ktx/secrets/**`.
- Do not allow client-supplied filesystem paths.
- Do not write outside `semantic-layer/<connection>/_schema/<schema>.yaml`.
- Defend against symlink escapes with `realpath` + `path.relative`; do not rely on plain `startsWith`.
- Do not overwrite `ktx.yaml` through the upload API.
- Do not upload zip files, directories, or overlay YAML in M17.
- Do not introduce Monaco just for M17. Use a `Textarea` for pasted YAML unless a shared editor dependency already exists.
- Do not store uploaded YAML content in sidecar history.
- Preserve API envelope style: success `{ ok: true, data }`; failure `{ ok: false, error }`.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Task 1: Backend Types And Upload Validation API

**Files:**

- Create: `webui/server/catalog-assets.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/server/__tests__/api.catalog-assets.test.ts`

**Step 1: Write failing tests for validate endpoint**

Create `webui/server/__tests__/api.catalog-assets.test.ts` using the `buildFreshServer()` / `vi.resetModules()` pattern from `api.add-schema.test.ts`.

Test fixture:

```yaml
connections:
  demo-mysql:
    driver: mysql
    schemas:
      - dataforai
      - openclaw_db
    enabled_tables:
      - dataforai.superstore_orders
```

Test `POST /api/catalog/assets/validate` with:

```json
{
  "connectionId": "demo-mysql",
  "schema": "openclaw_db",
  "assetType": "schemaManifest",
  "filename": "openclaw_db.yaml",
  "content": "tables:\n  customers:\n    table: openclaw_db.customers\n"
}
```

Expected:

- `ok: true`.
- `data.valid === true`.
- `data.targetPath === "semantic-layer/demo-mysql/_schema/openclaw_db.yaml"`.
- `data.tables === 1`.
- `data.tableNames` contains `customers`.
- `data.exists === false`.
- No file is written.

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: FAIL because the route does not exist.

**Step 2: Add shared frontend/backend response types**

In `webui/src/lib/types.ts`, add:

```ts
export type CatalogAssetType = "schemaManifest";

export type CatalogAssetWarning = {
  code:
    | "EMPTY_MANIFEST"
    | "TARGET_EXISTS"
    | "TABLE_SCHEMA_MISMATCH"
    | "UNKNOWN_MANIFEST_SHAPE";
  message: string;
  table?: string;
};

export type CatalogAssetError = {
  code:
    | "UNKNOWN_CONNECTION"
    | "SCHEMA_NOT_CONFIGURED"
    | "INVALID_ASSET_TYPE"
    | "INVALID_FILENAME"
    | "FILE_TOO_LARGE"
    | "YAML_PARSE_FAILED"
    | "INVALID_MANIFEST"
    | "PATH_NOT_ALLOWED";
  message: string;
};

export type CatalogAssetValidateRequest = {
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  filename: string;
  content: string;
};

export type CatalogAssetValidateResponse = {
  valid: boolean;
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  targetPath: string;
  exists: boolean;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  tableNames: string[];
  warnings: CatalogAssetWarning[];
  errors: CatalogAssetError[];
};
```

In `webui/src/lib/queryKeys.ts`, add:

```ts
catalogAssetUploads: ["catalog", "asset-uploads"] as const
```

**Step 3: Implement `catalog-assets.ts` validation helpers**

Create `webui/server/catalog-assets.ts`.

Implement:

```ts
export async function validateCatalogAsset(
  projectRoot: string,
  request: CatalogAssetValidateRequest
): Promise<CatalogAssetValidateResponse>;
```

Implementation rules:

- Resolve target path internally:

  ```ts
  semantic-layer/${connectionId}/_schema/${schema}.yaml
  ```

- Never trust `filename` for path decisions.
- Accept only `.yaml` and `.yml` filenames.
- Reject content over 512 KB.
- Read `ktx.yaml` and verify `connectionId` and configured `schema`.
- Parse YAML with the existing server YAML parser.
- Support manifest shape:

  ```yaml
  tables:
    table_name:
      table: schema.table_name
  ```

- Return `valid: false` with structured `errors` instead of throwing for user-correctable validation failures.
- Use `fs-safe` plus explicit path containment checks:
  - Compute the project-relative target internally.
  - Resolve the candidate with `path.resolve(projectRoot, targetPath)`.
  - Resolve real roots with `fs.realpath(projectRoot)` and `fs.realpath(path.join(projectRoot, "semantic-layer"))`.
  - Resolve the target parent directory with `fs.realpath`.
  - Use `path.relative(realSemanticLayerRoot, realTargetParent)` and reject paths that start with `..` or are absolute.
  - Do not use bare `startsWith` as the only containment check.
  - If any existing target file is a symlink, return `PATH_NOT_ALLOWED`.
  - If MVP cannot safely reason about symlinked directories in the target chain, reject them with `PATH_NOT_ALLOWED`.

**Step 4: Wire validate route**

In `webui/server/index.ts`, add:

```text
POST /api/catalog/assets/validate
```

Route behavior:

- Parse JSON body.
- Call `validateCatalogAsset(projectRoot, body)`.
- Return `{ ok: true, data }` even when `data.valid === false`.
- Return `{ ok: false, error }` only for unexpected server failures.

**Step 5: Add negative validation tests**

Add tests for:

- Unknown connection -> `valid: false`, `UNKNOWN_CONNECTION`.
- Schema not configured -> `SCHEMA_NOT_CONFIGURED`.
- Invalid filename extension -> `INVALID_FILENAME`.
- Oversized file -> `FILE_TOO_LARGE`.
- YAML parse error -> `YAML_PARSE_FAILED`.
- Existing target file -> `valid: true`, `exists: true`, warning `TARGET_EXISTS`.
- Symlinked target parent or symlinked existing target file -> `valid: false`, `PATH_NOT_ALLOWED`.

Run:

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: PASS.

---

## Task 2: Backend Upload, Audit History, And Reload

**Files:**

- Modify: `webui/server/catalog-assets.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/api.catalog-assets.test.ts`
- Test: `webui/server/__tests__/api.catalog-reload.test.ts`

**Step 1: Write failing upload tests**

In `api.catalog-assets.test.ts`, add tests for `POST /api/catalog/assets/upload`.

Happy path request:

```json
{
  "connectionId": "demo-mysql",
  "schema": "openclaw_db",
  "assetType": "schemaManifest",
  "filename": "openclaw_db.yaml",
  "content": "tables:\n  customers:\n    table: openclaw_db.customers\n"
}
```

Expected:

- `ok: true`.
- `data.uploaded === true`.
- File exists at `semantic-layer/demo-mysql/_schema/openclaw_db.yaml`.
- `data.record.targetPath` is project-relative.
- `data.record.tables === 1`.
- `data.record.sha256` is present.
- `data.reload.source === "static-yaml"`.
- `data.reload.requestedConnectionId === "demo-mysql"`.
- `data.reload.requestedSchema === "openclaw_db"`.

Run:

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: FAIL before implementation.

**Step 2: Add upload response and history types**

In `webui/src/lib/types.ts`, add:

```ts
export type CatalogAssetUploadRequest = CatalogAssetValidateRequest & {
  confirmOverwrite?: boolean;
};

export type CatalogAssetUploadRecord = {
  id: string;
  createdAt: string;
  connectionId: string;
  schema: string;
  assetType: CatalogAssetType;
  targetPath: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  overwritten: boolean;
  warnings: CatalogAssetWarning[];
  reloadRunId?: string;
};

export type CatalogAssetUploadResponse = {
  uploaded: true;
  record: CatalogAssetUploadRecord;
  validation: CatalogAssetValidateResponse;
  reload: CatalogReloadRun;
};

export type CatalogAssetUploadsResponse = {
  records: CatalogAssetUploadRecord[];
  lastBySchema: Record<string, CatalogAssetUploadRecord>;
};
```

**Step 3: Implement upload helper**

In `catalog-assets.ts`, implement:

```ts
export async function uploadCatalogAsset(
  projectRoot: string,
  request: CatalogAssetUploadRequest
): Promise<CatalogAssetUploadResponse>;

export async function readCatalogAssetUploads(
  projectRoot: string
): Promise<CatalogAssetUploadsResponse>;
```

Rules:

- Reuse `validateCatalogAsset`.
- If validation invalid, throw/return a 400 route response with validation details.
- If target exists and `confirmOverwrite !== true`, route returns 409.
- Create parent directory if missing.
- Write to temp file in the target directory, then rename to target.
- Append audit record to `.ktx-ui/catalog-asset-uploads.json`.
- Keep latest 50 records.
- Do not store YAML content.
- Call existing `reloadCatalog(projectRoot, { connectionId, schema })`.

**Step 4: Wire upload and history routes**

In `server/index.ts`, add:

```text
POST /api/catalog/assets/upload
GET /api/catalog/assets/uploads
```

409 response shape for overwrite guard:

```json
{
  "ok": false,
  "error": "目标 YAML 已存在，请确认覆盖后重试。",
  "data": {
    "validation": { "...": "..." }
  }
}
```

Keep the route shape aligned with existing API error conventions if `data` on error is not supported elsewhere.

**Step 5: Add overwrite and history tests**

Cover:

- Existing target without `confirmOverwrite` returns 409 and does not modify file.
- Existing target with `confirmOverwrite: true` overwrites and records `overwritten: true`.
- `GET /api/catalog/assets/uploads` returns latest record and `lastBySchema["demo-mysql.openclaw_db"]`.
- History caps at 50 records.
- Upload never calls `ktx` helpers. Mock `../ktx` so any import/call throws, mirroring M14 tests.
- Upload refuses to write through a symlinked target parent or symlinked existing target file, even when `confirmOverwrite: true`.

Run:

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts server/__tests__/api.catalog-reload.test.ts
```

Expected: PASS.

---

## Task 3: Frontend Upload API, Hook, And Shared Components

**Files:**

- Create: `webui/src/lib/catalog-assets.ts`
- Create: `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- Create: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Create: `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Write failing component tests**

Create `webui/src/__tests__/catalog-asset-upload.test.tsx`.

Use MSW-style fetch handlers already used by the project tests.

Test states:

- Button opens drawer.
- Selecting a `.yaml` file triggers validate.
- Pasting YAML into the source textarea triggers validate without selecting a file.
- Validation success shows target path and parsed table count.
- Existing target shows overwrite warning and requires confirmation.
- Upload success shows reload summary.
- Upload success shows `前往配置表白名单 ->` as the primary action and `完成并关闭` as the secondary action.
- Clicking `前往配置表白名单 ->` navigates to `/connections/whitelist?schema=openclaw_db`.
- Validation failure shows structured errors and disables upload.

Run:

```bash
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Add frontend API helpers**

Create `webui/src/lib/catalog-assets.ts`:

```ts
export async function validateCatalogAsset(
  input: CatalogAssetValidateRequest
): Promise<CatalogAssetValidateResponse>;

export async function uploadCatalogAsset(
  input: CatalogAssetUploadRequest
): Promise<CatalogAssetUploadResponse>;

export async function fetchCatalogAssetUploads(): Promise<CatalogAssetUploadsResponse>;
```

Use existing `apiClient` conventions.

**Step 3: Implement upload drawer**

`CatalogAssetUploadDrawer` props:

```ts
type CatalogAssetUploadDrawerProps = {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  schema?: string;
  schemaOptions?: string[];
  onUploaded?: (result: CatalogAssetUploadResponse) => void;
};
```

Behavior:

- If `schema` is provided, lock the schema selector.
- If no `schema`, show a schema select.
- Support two input modes:
  - File input / dropzone accepts `.yaml,.yml`.
  - YAML source `Textarea` for direct paste.
- Read file content with `File.text()`.
- Validate on file selection, textarea content change, or schema change.
- If a file is selected after textarea input, replace the textarea content with the file text and keep one canonical `content` value.
- Do not introduce Monaco in M17 unless a shared editor component is already present in the project.
- Show validation panel.
- Disable upload when invalid.
- Require checkbox `确认覆盖现有 YAML` when `exists === true`.
- On upload success, invalidate:
  - `queryKeys.catalogReloads`
  - `queryKeys.catalogAssetUploads`
  - connection overview queries
  - whitelist table queries
- Render footer actions after upload:
  - Primary: `前往配置表白名单 ->`, linking to `/connections/whitelist?schema=${schema}`.
  - Secondary: `完成并关闭`, closing the drawer.

**Step 4: Implement button wrapper**

`CatalogAssetUploadButton` props:

```ts
type CatalogAssetUploadButtonProps = {
  connectionId: string;
  schema?: string;
  schemaOptions?: string[];
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "default" | "sm";
  testId?: string;
};
```

Default label:

- With schema: `上传该 Schema 的 YAML`
- Without schema: `上传 YAML`

**Step 5: Add CSS**

Add component classes in `webui/src/app/app.css`:

- `.pl-upload-dropzone`
- `.pl-upload-file-summary`
- `.pl-upload-source-textarea`
- `.pl-upload-validation`
- `.pl-upload-validation--success`
- `.pl-upload-validation--warning`
- `.pl-upload-validation--danger`
- `.pl-upload-target-path`

Do not use decorative large cards or nested cards.

**Step 6: Run component tests**

Run:

```bash
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 4: `/connections/*` Header Governance And `/connections` IA Refactor

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/pages/connections/ConnectionTest.tsx`
- Modify: `webui/src/pages/connections/constants.ts`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/connection-overview.test.tsx`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`
- Test: `webui/src/__tests__/connection-test.test.tsx`

**Step 1: Write failing IA tests**

Update `connection-overview.test.tsx`:

```tsx
expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "连通测试" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "打开表目录" })).not.toBeInTheDocument();
expect(screen.queryByText("1 个连接")).not.toBeInTheDocument();
expect(screen.queryByText("KTX 可用")).not.toBeInTheDocument();
expect(screen.queryByText("连接配置来自当前项目，不在 WebUI 中直接编辑凭据。")).not.toBeInTheDocument();
expect(screen.getByText("配置来源：ktx.yaml。凭据不在 WebUI 中编辑。")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传 YAML" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "重新加载资产" })).not.toBeInTheDocument();
```

Update `table-whitelist.test.tsx` and `connection-test.test.tsx` to assert their PageHeader does not render right-side cross-page links or nonessential badges:

```tsx
expect(screen.queryByRole("link", { name: "连接概览" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "连通测试" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "打开表目录" })).not.toBeInTheDocument();
```

Run:

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Apply database接入 Header governance**

In all `/connections/*` page components, remove PageHeader right-side cross-page navigation links for:

- `表白名单`
- `连通测试`
- `打开表目录`
- `连接概览`

Also remove nonessential Header badges that duplicate page metrics, such as connection count and KTX availability, unless they are the only available environment path indicator. Keep at most a compact project root badge such as `/data/lucy`.

Do not remove sidebar navigation.

**Step 3: Simplify connection card**

Refactor connection card layout to:

```text
Header row:
  demo-mysql | MySQL | Read-only expected | Not tested

Meta row:
  配置来源：ktx.yaml。凭据不在 WebUI 中编辑。
  上次刷新：...

Schema table:
  Schema | 本地 YAML | 表数 | 下一步

Actions:
  [添加 Schema] [上传 YAML] [测试连接] [刷新本地目录]
```

Use compact grid/table styling. Avoid large empty two-column blocks.

**Step 4: Rename reload copy**

Replace user-facing `重新加载资产` / `重新加载本地资产` in `/connections` with:

```text
刷新本地目录
```

Add accessible title/help text:

```text
重新读取 ktx.yaml 和 semantic-layer YAML，不会连接数据库，也不会执行 ingest。
```

**Step 5: Add upload action**

Mount `CatalogAssetUploadButton` in each connection card:

```tsx
<CatalogAssetUploadButton
  connectionId={conn.id}
  schemaOptions={conn.schemas}
  label="上传 YAML"
/>
```

If any schema has missing manifest, visually prioritize upload as the primary action.

**Step 6: Run tests**

Run:

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 5: `/connections/whitelist` Upload Entry And Reload Copy

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Write failing whitelist tests**

Update `table-whitelist.test.tsx`:

```tsx
expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "刷新本地表目录" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传该 Schema 的 YAML" })).toBeInTheDocument();
```

For query param preselection, render the page at `/connections/whitelist?schema=openclaw_db` and assert:

```tsx
expect(screen.getByLabelText("Schema 筛选")).toHaveValue("openclaw_db");
expect(screen.getByText(/SCHEMA: OPENCLAW_DB/i)).toBeInTheDocument();
```

For save behavior:

```tsx
expect(screen.getByText(/已保存白名单变更/)).toBeInTheDocument();
expect(screen.getByText(/若你同时更新了 YAML 文件，请刷新本地目录/)).toBeInTheDocument();
```

Run:

```bash
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Rename toolbar reload button**

In `TableWhitelist.tsx`, change reload button label to:

```text
刷新本地目录
```

Ensure no duplicate same-label button appears inside the same visual group unless it is schema-specific and clearly contextual.

**Step 3: Support `schema` query param preselection**

In `TableWhitelist.tsx`, read `schema` from `useSearchParams()`.

Rules:

- If the query schema exists in available schema options, initialize `schemaFilter` to that value.
- If the query schema is missing or unknown, fall back to `all`.
- Do not overwrite a user's later manual schema selection while they stay on the page.
- Keep the select accessible with label `Schema 筛选`.

**Step 4: Add empty schema upload CTA**

In configured-schema-empty state, add:

```tsx
<CatalogAssetUploadButton
  connectionId={conn.id}
  schema={schema}
  label="上传该 Schema 的 YAML"
  variant="secondary"
  size="sm"
/>
```

Keep YAML path details as supporting text, not the primary action.

**Step 5: Update save success copy**

After saving enabled tables, show:

```text
已保存白名单变更。若你同时更新了 YAML 文件，请刷新本地目录。
```

Do not call catalog reload automatically from save.

**Step 6: Run tests**

Run:

```bash
npm test -- --run src/__tests__/table-whitelist.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 6: `AddSchemaDrawer` Guidance And Upload Next Step

**Files:**

- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Test: `webui/src/__tests__/add-schema-drawer.test.tsx`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Write failing Add Schema guidance tests**

Update `add-schema-drawer.test.tsx`:

```tsx
expect(screen.getByText(/添加 schema 会写入 ktx.yaml，不会扫描物理数据库/)).toBeInTheDocument();
expect(screen.getByText(/连接测试会使用当前项目已有凭据验证访问权限/)).toBeInTheDocument();
expect(screen.queryByText(/不会触碰凭据/)).not.toBeInTheDocument();
```

After successful schema save:

```tsx
expect(screen.getByText(/openclaw_db 已添加到 demo-mysql/)).toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传 YAML" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "刷新本地目录" })).toBeInTheDocument();
expect(screen.queryByRole("button", { name: /ingest/i })).not.toBeInTheDocument();
```

If the upload drawer is completed from Add Schema, assert its primary success action links to:

```text
/connections/whitelist?schema=openclaw_db
```

Run:

```bash
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Rewrite drawer intro copy**

Replace ambiguous copy with:

```text
添加 schema 会写入 ktx.yaml，不会扫描物理数据库。
连接测试会使用当前项目已有凭据验证访问权限。
```

Keep the step labels concise:

```text
1. 输入 Schema
2. 测试连接
3. 确认并完成
```

**Step 3: Update success step actions**

After successful add schema:

- Show `CatalogAssetUploadButton` locked to the new schema.
- Show `CatalogReloadButton` with label `刷新本地目录`.
- Keep `完成` as the final close action.

Do not automatically upload, reload, or scan.

**Step 4: Run tests**

Run:

```bash
npm test -- --run src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 7: Final Copy Sweep, Integration Tests, And Build

**Files:**

- Modify as needed:
  - `webui/src/pages/connections/ConnectionOverview.tsx`
  - `webui/src/pages/connections/TableWhitelist.tsx`
  - `webui/src/components/AddSchemaDrawer.tsx`
  - `webui/src/components/catalog/*.tsx`
  - `webui/src/app/app.css`
- Test:
  - `webui/server/__tests__/api.catalog-assets.test.ts`
  - `webui/server/__tests__/api.catalog-reload.test.ts`
  - `webui/src/__tests__/catalog-asset-upload.test.tsx`
  - `webui/src/__tests__/connection-overview.test.tsx`
  - `webui/src/__tests__/table-whitelist.test.tsx`
  - `webui/src/__tests__/add-schema-drawer.test.tsx`

**Step 1: Search for forbidden or confusing copy**

Run:

```bash
rg -n "重新加载资产|重新加载本地资产|触发 Ingest|ingest|不会触碰凭据|扫描物理数据库|Monaco" webui/src webui/server
```

Expected:

- No user-facing `触发 Ingest`.
- No user-facing `重新加载资产`.
- No `不会触碰凭据` in Add Schema flow.
- `扫描物理数据库` only appears in explanatory negative copy such as `不会扫描物理数据库`.
- No new Monaco import/dependency for M17 unless a shared editor already existed before this work.

**Step 2: Run targeted backend tests**

Run:

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts server/__tests__/api.catalog-reload.test.ts
```

Expected: PASS.

**Step 3: Run targeted frontend tests**

Run:

```bash
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx src/__tests__/add-schema-drawer.test.tsx
```

Expected: PASS.

**Step 4: Run full tests**

Run:

```bash
npm test -- --run
```

Expected:

- PASS, except any explicitly documented pre-existing unrelated drift. If an unrelated known failure persists, record exact test name and reason in the final report.

**Step 5: Build**

Run:

```bash
npm run build
```

Expected: PASS. Vite chunk-size warnings are acceptable if unchanged and unrelated.

**Step 6: Reviewer checklist**

Before requesting review, verify:

- `/connections`、`/connections/whitelist`、`/connections/test` Header no longer duplicate sidebar navigation or cross-page links.
- Database接入 Headers keep only title, one-line description, and minimal environment path badge.
- Connection card shows compact, scannable connection and schema state.
- `刷新本地目录` clearly says it only rereads local YAML.
- Analyst can upload YAML from `/connections`.
- Analyst can upload YAML from whitelist empty schema state.
- Analyst can upload YAML after Add Schema success.
- Upload drawer supports both file/dropzone input and YAML textarea paste.
- Upload success primary action navigates to `/connections/whitelist?schema=<schema>`.
- Whitelist page honors `schema` query param by preselecting the Schema filter.
- Upload validates before writing.
- Upload cannot write outside allowed manifest path.
- Upload rejects symlinked target parent directories and symlinked existing target files.
- Overwrite requires explicit confirmation.
- Upload writes file atomically and records sidecar history.
- Upload triggers static Catalog reload.
- No WebUI path executes `ktx ingest`.

**Step 7: Commit**

Only after tests and build pass, stage files touched by this work order:

```bash
git add \
  webui/server/catalog-assets.ts \
  webui/server/index.ts \
  webui/server/__tests__/api.catalog-assets.test.ts \
  webui/src/lib/types.ts \
  webui/src/lib/queryKeys.ts \
  webui/src/lib/catalog-assets.ts \
  webui/src/components/catalog/CatalogAssetUploadButton.tsx \
  webui/src/components/catalog/CatalogAssetUploadDrawer.tsx \
  webui/src/components/catalog/CatalogAssetValidationPanel.tsx \
  webui/src/components/AddSchemaDrawer.tsx \
  webui/src/pages/connections/ConnectionOverview.tsx \
  webui/src/pages/connections/TableWhitelist.tsx \
  webui/src/pages/connections/ConnectionTest.tsx \
  webui/src/pages/connections/constants.ts \
  webui/src/app/app.css \
  webui/src/__tests__/catalog-asset-upload.test.tsx \
  webui/src/__tests__/connection-overview.test.tsx \
  webui/src/__tests__/table-whitelist.test.tsx \
  webui/src/__tests__/connection-test.test.tsx \
  webui/src/__tests__/add-schema-drawer.test.tsx
git commit -m "feat(webui): add controlled catalog yaml upload"
```

Do not stage unrelated dirty files.
