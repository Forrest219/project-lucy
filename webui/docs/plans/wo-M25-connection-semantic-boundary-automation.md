# M25 Connection And Semantic Layer Boundary Automation Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the database connection vs semantic-layer maintenance boundary explicit and enforceable through terminology, UI copy, API asset kind, upload validation, lint automation, and Review checklist prompts.

**Architecture:** Keep the existing static Catalog Loading architecture. This work adds guardrails around the current controlled Schema Manifest upload and semantic asset publishing flows: explicit asset kind, route-aware validation, IA boundary lint, and small UI copy updates. It does not add physical database scanning or WebUI-created database connections.

**Tech Stack:** React 19, React Router, TanStack Query, Fastify, Vitest, Testing Library, Node ESM lint scripts, existing `yaml` parser, existing `apiClient`, existing `fs-safe` / catalog asset upload modules.

**Source Spec:** [../29-connection-semantic-boundary-automation-spec.md](../29-connection-semantic-boundary-automation-spec.md)

---

## Context For Developer

Read these documents before coding:

- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/04-data-model.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/23-semantic-asset-publish-export-spec.md`
- `webui/docs/24-yaml-delivery-runbook-spec.md`
- `webui/docs/25-connection-module-terminology-ia-refresh-spec.md`
- `webui/docs/29-connection-semantic-boundary-automation-spec.md`

Read these implementation files:

- `webui/package.json`
- `package.json`
- `webui/scripts/lint-terminology.mjs`
- `webui/src/lib/types.ts`
- `webui/src/lib/catalog-assets.ts`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/Catalog.tsx`
- `webui/src/pages/TableEditor.tsx`
- `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- `webui/src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- `webui/src/components/semantic-assets/SemanticAssetValidationPanel.tsx`
- `webui/server/catalog-assets.ts`
- `webui/server/semantic-assets.ts`
- `webui/server/index.ts`

Read these tests:

- `webui/src/__tests__/lint-terminology-scan.test.ts`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/catalog-reload-components.test.tsx`
- `webui/server/__tests__/api.catalog-assets.test.ts`
- `webui/server/__tests__/api.semantic-assets.publish.test.ts`

Non-negotiable boundaries:

- Do not execute `ktx ingest`.
- Do not scan physical databases.
- Do not read or write `.ktx/secrets/**`.
- Do not allow client-supplied arbitrary target paths.
- Do not turn 数据库接入 into a semantic modeling editor.
- Do not turn 语义层维护 into a connection onboarding surface.
- Keep `Schema`, `Manifest`, `Catalog`, `YAML`, `Join`, `Metric`, `Measure`, `Segment` terminology aligned with `webui/docs/00-product-terminology-standard.md`.
- Treat existing dirty worktree changes as user-owned unless directly required by this work order.

---

## Task 1: Document The Responsibility Boundary

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/docs/README.md`
- Modify: `webui/docs/plans/README.md`

**Step 1: Add the responsibility matrix to the terminology standard**

In `webui/docs/00-product-terminology-standard.md`, under module terminology section, add a short subsection:

```md
### 数据库接入 / 语义层维护 / 语义资产交付边界

数据库接入负责让 Connection、Schema、表白名单和 Schema Manifest 进入 Lucy，并保持本地 Catalog 可读。
语义层维护负责维护已进入 Lucy 的表的业务语义，包括字段说明、grain、指标、分群和 Join。
语义资产交付负责资产包级导入、导出、Validate Gate 与发布。
```

Add the matrix from `webui/docs/29-connection-semantic-boundary-automation-spec.md §3`.

**Step 2: Add explicit upload terminology**

Add these rows or notes to the terminology table:

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Schema Manifest Upload | 上传 Schema Manifest | 数据库接入中的受控 manifest 上传动作 |
| Semantic Overlay Upload | 上传 semantic overlay | 语义层维护中的 overlay 上传动作 |
| Asset Kind | asset kind / 资产类型 | 上传 API 与 Validate Gate 中区分资产类型 |

Also add a rule:

```md
按钮、Drawer 标题、Toast 主动作不得裸用“上传 YAML”。必须写明“上传 Schema Manifest”、“上传 semantic overlay”或“上传资产包”。
```

**Step 3: Ensure indexes include M25**

Confirm `webui/docs/README.md` includes:

```md
| [29-connection-semantic-boundary-automation-spec.md](29-connection-semantic-boundary-automation-spec.md) | 数据库接入与语义层维护边界自动化：职责矩阵、asset kind、上传结构校验、IA boundary lint 与 Review checklist | 产品 / 前端 / 后端 / 运维 |
```

Confirm `webui/docs/plans/README.md` includes:

```md
| [wo-M25-connection-semantic-boundary-automation.md](wo-M25-connection-semantic-boundary-automation.md) | M25 | 数据库接入与语义层维护边界自动化：asset kind、上传校验、IA lint 与 Review checklist |
```

**Step 4: Run doc lint**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm run lint:spec
```

Expected: PASS. If the spec linter requires a different index shape, update the indexes without changing the product decision.

---

## Task 2: Add IA Boundary Lint

**Files:**

- Create: `webui/scripts/lint-ia-boundary.mjs`
- Modify: `webui/package.json`
- Modify: `package.json`
- Test: `webui/src/__tests__/lint-ia-boundary.test.ts`

**Step 1: Write failing tests for the scanner**

Create `webui/src/__tests__/lint-ia-boundary.test.ts` with fixture files under a temp directory. Cover:

- Connection page fixture with `<button>上传 YAML</button>` fails.
- Connection page fixture with `<button>上传 Manifest</button>` passes.
- Connection page fixture with `<button>新增指标</button>` fails.
- TableEditor fixture with `<button>添加 Schema</button>` fails.
- Documentation fixture with `上传 YAML 资产：Schema Manifest 或 semantic overlay` passes.

**Step 2: Run the focused test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/lint-ia-boundary.test.ts
```

Expected: FAIL because the script does not exist yet.

**Step 3: Implement `lint-ia-boundary.mjs`**

Implement a Node ESM script that:

- Scans `webui/src/pages/connections`, `webui/src/components/catalog`, `webui/src/pages/Catalog.tsx`, `webui/src/pages/TableEditor.tsx`, `webui/docs`, and `webui/docs/plans`.
- Reports file path, line number, rule id, and matched text.
- Exits with code `1` on violations.
- Exports pure helpers for tests, for example `scanText(filePath, text)`.

Minimum rule ids:

```js
CONNECTION_BARE_UPLOAD_YAML
CONNECTION_SEMANTIC_MODELING_ACTION
SEMANTIC_LAYER_CONNECTION_ACTION
RELOAD_INGEST_CONFUSION
DOC_UPLOAD_YAML_UNTYPED
```

**Step 4: Add scripts**

Update `webui/package.json`:

```json
"lint:ia-boundary": "node scripts/lint-ia-boundary.mjs",
"pretest": "npm run lint:terminology && npm run lint:ia-boundary"
```

Update root `package.json`:

```json
"lint:ia-boundary": "node webui/scripts/lint-ia-boundary.mjs"
```

**Step 5: Run lint**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:ia-boundary
```

Expected: FAIL if existing UI still has untyped `上传 YAML`; proceed to Task 3 to fix.

---

## Task 3: Clarify UI Copy And Route Ownership

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetUploadButton.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- Modify: `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- Modify: `webui/src/pages/TableEditor.tsx` only if lint finds misplaced connection actions
- Test: `webui/src/__tests__/connection-overview.test.tsx`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`
- Test: `webui/src/__tests__/add-schema-drawer.test.tsx`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Add failing frontend assertions**

Assert the connection module uses typed upload labels:

```ts
expect(screen.getByTestId("upload-yaml-demo-mysql-openclaw_db")).toHaveTextContent("上传 Manifest");
expect(screen.queryByRole("button", { name: "上传 YAML" })).not.toBeInTheDocument();
```

Assert the Drawer explains the boundary:

```ts
expect(screen.getByText("不会编辑指标、Join 或业务语义", { exact: false })).toBeInTheDocument();
expect(screen.getByText("Schema Manifest", { exact: false })).toBeInTheDocument();
```

**Step 2: Run focused frontend tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-asset-upload.test.tsx
```

Expected: FAIL for any remaining untyped upload copy.

**Step 3: Update labels**

Use these replacements:

| Current | Replace With |
|---|---|
| Connection row upload | `上传 Manifest` |
| Connection footer upload | `上传 Schema Manifest` |
| Whitelist empty state upload | `上传该 Schema 的 YAML` or `上传 Manifest` |
| Add Schema success next step | `上传 Schema Manifest` |
| Catalog upload Drawer title | `上传 <connection> 的 Schema Manifest` |

Add Drawer boundary copy:

```text
此操作只写入 semantic-layer/<connection>/_schema/<schema>.yaml，不会编辑指标、Join 或业务语义。
```

Wrap `Schema Manifest`, paths, filenames, and database object names with `notranslate` and `translate="no"`.

**Step 4: Run focused tests and lint**

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-asset-upload.test.tsx
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: PASS.

---

## Task 4: Add Canonical Asset Kind To Catalog Upload API

**Files:**

- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/catalog-assets.ts`
- Modify: `webui/server/catalog-assets.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/api.catalog-assets.test.ts`
- Test: `webui/src/__tests__/catalog-asset-upload.test.tsx`

**Step 1: Add failing API tests**

In `webui/server/__tests__/api.catalog-assets.test.ts`, add tests for:

- New request with `assetKind: "schema_manifest"` succeeds.
- Legacy request with `assetType: "schemaManifest"` still succeeds.
- Response includes canonical `assetKind: "schema_manifest"`.
- Unsupported `assetKind` returns `ASSET_KIND_UNSUPPORTED`.
- Missing kind returns `ASSET_KIND_REQUIRED` unless legacy `assetType` maps cleanly.

**Step 2: Run API tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: FAIL because current types only expose `assetType: "schemaManifest"`.

**Step 3: Update shared types**

In `webui/src/lib/types.ts` and `webui/server/catalog-assets.ts`, introduce:

```ts
export type CatalogAssetKind = "schema_manifest";
export type LegacyCatalogAssetType = "schemaManifest";
```

For M25, only `schema_manifest` is implemented in the catalog upload API. `semantic_overlay` and `asset_package` remain documented for semantic asset publishing and future overlay-specific entry points.

**Step 4: Add request normalization**

In `webui/server/catalog-assets.ts`, add a helper:

```ts
function normalizeCatalogAssetKind(input: {
  assetKind?: unknown;
  assetType?: unknown;
}): CatalogAssetKind | CatalogAssetError
```

Mapping:

| Input | Output |
|---|---|
| `assetKind: "schema_manifest"` | `"schema_manifest"` |
| `assetType: "schemaManifest"` | `"schema_manifest"` |
| `assetKind: "semantic_overlay"` | `ASSET_KIND_ROUTE_MISMATCH` for catalog upload route |
| unknown string | `ASSET_KIND_UNSUPPORTED` |
| missing | `ASSET_KIND_REQUIRED` |

**Step 5: Update frontend requests**

Make `CatalogAssetUploadDrawer` send:

```ts
assetKind: "schema_manifest"
```

Do not send only legacy `assetType` from new frontend code.

**Step 6: Run tests**

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts src/__tests__/catalog-asset-upload.test.tsx
```

Expected: PASS.

---

## Task 5: Add Manifest Vs Overlay Structure Guardrails

**Files:**

- Modify: `webui/server/catalog-assets.ts`
- Test: `webui/server/__tests__/api.catalog-assets.test.ts`

**Step 1: Add failing tests for wrong YAML kind**

Add tests:

```ts
it("rejects semantic overlay YAML in the Schema Manifest upload route", async () => {
  const overlayYaml = `
name: superstore_orders
grain:
  - order_id
measures:
  - name: total_sales
    expr: sum(sales)
`;
  // POST /api/catalog/assets/validate with assetKind schema_manifest
  // Expected error code: OVERLAY_FIELD_IN_MANIFEST or SCHEMA_MANIFEST_EXPECTED
});
```

Add manifest-like YAML to overlay route only if an overlay route exists. If no overlay route exists, document the case in comments and cover only the catalog upload route.

**Step 2: Run API tests**

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: FAIL if current validator only checks generic YAML.

**Step 3: Implement manifest guardrails**

In the Schema Manifest validation path:

- Parse YAML as a document.
- Require top-level `tables`.
- Reject top-level `grain`, `measures`, `segments`.
- Reject top-level `name` without `tables` as likely overlay.
- Preserve existing warnings for overwrite, empty manifest, table count, and parse errors.

**Step 4: Return structured errors**

Add error codes from the source spec:

```ts
"ASSET_KIND_REQUIRED"
"ASSET_KIND_UNSUPPORTED"
"ASSET_KIND_ROUTE_MISMATCH"
"SCHEMA_MANIFEST_EXPECTED"
"OVERLAY_FIELD_IN_MANIFEST"
```

Map user-visible messages in `CatalogAssetValidationPanel`.

**Step 5: Run API tests**

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts
```

Expected: PASS.

---

## Task 6: Add Review Checklist Prompts

**Files:**

- Modify: `webui/src/pages/Review.tsx` or the current Review page file if renamed
- Modify: existing Review helpers if changed-file classification already exists
- Test: existing Review page test, or create `webui/src/__tests__/review-boundary-checklist.test.tsx`

**Step 1: Locate Review implementation**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
rg -n "Review|changed files|changedFiles|git diff|审阅" webui/src webui/server
```

Use the existing changed-file model; do not create a second git diff parser if one already exists.

**Step 2: Add failing tests**

Given changed files:

```ts
[
  "webui/src/pages/connections/ConnectionOverview.tsx",
  "webui/server/catalog-assets.ts",
  "webui/src/pages/TableEditor.tsx"
]
```

Expect checklist prompts:

- `检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。`
- `检查 asset kind、路径约束、结构校验和 sidecar raw content 禁止。`
- `检查语义层维护是否只处理业务语义和 overlay。`

**Step 3: Implement changed-file prompt mapping**

Add a small pure function:

```ts
export function boundaryChecklistForChangedFiles(files: string[]): string[]
```

Map prefixes according to source spec §7.3.

**Step 4: Render checklist**

Render as a compact Review panel. Keep it informational; do not block review submission in M25.

**Step 5: Run focused tests**

```bash
npm test -- --run src/__tests__/review-boundary-checklist.test.tsx
```

Expected: PASS.

---

## Task 7: Final Regression

**Files:**

- No new files unless previous tasks require test fixture updates.

**Step 1: Run lint gates**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: PASS.

**Step 2: Run focused suites**

```bash
npm test -- --run src/__tests__/lint-ia-boundary.test.ts src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-asset-upload.test.tsx server/__tests__/api.catalog-assets.test.ts
```

Expected: PASS.

**Step 3: Run full test suite**

```bash
npm test
```

Expected: PASS.

**Step 4: Run build**

```bash
npm run build
```

Expected: PASS.

**Step 5: Inspect diff**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git diff -- webui/docs webui/scripts webui/src webui/server package.json webui/package.json
```

Expected:

- No secret contents.
- No arbitrary path upload capability.
- No naked `上传 YAML` button or Drawer title.
- `assetKind` is canonical in new requests and responses.
- Legacy `assetType: "schemaManifest"` remains compatible.

---

## Acceptance Checklist

- [ ] Responsibility matrix is in `webui/docs/00-product-terminology-standard.md`.
- [ ] `webui/docs/29-connection-semantic-boundary-automation-spec.md` is indexed.
- [ ] `webui/docs/plans/wo-M25-connection-semantic-boundary-automation.md` is indexed.
- [ ] `npm run lint:ia-boundary` exists and passes.
- [ ] `npm test` runs `lint:terminology` and `lint:ia-boundary` in `pretest`.
- [ ] Connection UI uses `上传 Manifest` / `上传 Schema Manifest`, not bare `上传 YAML`.
- [ ] Catalog upload API accepts `assetKind: "schema_manifest"`.
- [ ] Legacy `assetType: "schemaManifest"` still works.
- [ ] Overlay-like YAML is rejected by Schema Manifest upload validation.
- [ ] Review checklist prompts appear for changed connection, catalog asset, semantic layer, and semantic asset files.
- [ ] Full test suite and build pass.
