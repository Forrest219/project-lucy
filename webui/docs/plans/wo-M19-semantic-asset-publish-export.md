# M19 Semantic Asset Publish And Export Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Lucy WebUI YAML operations into a self-service semantic asset lifecycle: analysts can upload manifest and overlay YAML, preview diff, publish through a hard validate gate, trigger KTX reindex only after a successful promote, and export a sanitized asset package without secrets.

**Architecture:** Extend M17 controlled upload into a staged publish pipeline. The backend classifies uploaded YAML, computes target paths, builds a staging project, runs `ktx sl validate` before touching the formal PVC, atomically promotes files only after validation passes, records release metadata as `reindexing`, returns immediately with `releaseId`, runs `ktx admin reindex` asynchronously, and exposes a white-listed sanitized export endpoint.

**Tech Stack:** Fastify, TypeScript, Node `fs/promises`, `crypto`, `child_process.execFile` for KTX only, YAML parser already used by the server, pure JS `diff` / jsdiff for unified diff, zip library chosen from existing dependencies if available or a small audited dependency if not, React 19, TanStack Query, React Router, Vitest, Testing Library, existing `apiClient`, existing `fs-safe`, existing CSS in `webui/src/app/app.css`.

**Source Spec:** [../23-semantic-asset-publish-export-spec.md](../23-semantic-asset-publish-export-spec.md)

---

## Context For Developer

Read these documents before coding:

- `webui/docs/23-semantic-asset-publish-export-spec.md`
- `webui/docs/21-connection-catalog-upload-ux-spec.md`
- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/12-semantic-layer-maintenance-ux-refresh.md`
- `webui/docs/03-api-spec.md`
- `docs/DEVELOPMENT.md`
- `docs/customer-deployment-guide.md`

Read these backend files:

- `webui/server/index.ts`
- `webui/server/catalog-assets.ts`
- `webui/server/catalog-reload.ts`
- `webui/server/semantic-layer.ts`
- `webui/server/overlay.ts`
- `webui/server/ktx.ts`
- `webui/server/diff.ts`
- `webui/server/fs-safe.ts`
- `webui/server/project.ts`
- `webui/server/admin/audit.ts`

Read these frontend files:

- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/catalog-assets.ts`
- `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`
- `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/TableEditor.tsx`
- `webui/src/pages/Review.tsx`
- `webui/src/app/App.tsx`
- `webui/src/app/app.css`

Read these tests:

- `webui/server/__tests__/api.catalog-assets.test.ts`
- `webui/server/__tests__/api.catalog-reload.test.ts`
- `webui/server/__tests__/semantic-layer.roundtrip.test.ts`
- `webui/server/__tests__/api.save.test.ts`
- `webui/src/__tests__/catalog-asset-upload.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-editor.test.tsx`
- `webui/src/__tests__/review.test.tsx`

Non-negotiable boundaries:

- Do not write uploaded content directly into formal `semantic-layer/` before staging validation passes.
- Do not run `ktx admin reindex` when YAML parse or `ktx sl validate` fails.
- Do not make `POST /api/semantic-assets/publish` wait synchronously for reindex completion; return `releaseId` after promote and poll release status.
- Do not let the client provide final filesystem paths.
- Do not read, write, expose, export, or inspect `.ktx/secrets/**` content.
- Do not follow symlinks during publish or export.
- Do not export `.env`, private keys, `.git/**`, `raw-sources/**`, `node_modules/**`, `.ktx-ui/audit.sqlite`, token plaintext, or secret-bearing files.
- Do not export raw `host`, `port`, `username`, or `password` from `ktx.yaml`; replace each with `<REDACTED>`.
- Do not store uploaded YAML content in release sidecars.
- Do not call `ktx ingest` or any physical database scan from this workflow.
- Do not use system `diff` CLI; Dry-Run diff must use pure JS.
- Do not implement rollback in M19; `POST /api/semantic-assets/releases/:id/rollback` is explicitly out of scope.
- M19 MVP only supports Lucy Backend single-replica / RWO PVC write topology. Multi-Pod or RWX PVC deployments must provide platform-level single-writer routing or an external lock before enabling publish.
- Preserve API envelope style: success `{ ok: true, data }`; failure `{ ok: false, error }`.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Task 1: Backend Semantic Asset Types And Classifier

**Files:**

- Create: `webui/server/semantic-assets.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/server/__tests__/api.semantic-assets.test.ts`

**Step 1: Write failing tests for validate endpoint**

Create tests for `POST /api/semantic-assets/validate` with a fixture project:

```yaml
connections:
  customer-db:
    driver: mysql
    schemas:
      - chatbi
    enabled_tables:
      - chatbi.ai_metric_international_country_daily
      - chatbi.ai_metric_international_active_user_30d
```

Submit two files:

- `chatbi.yaml` with top-level `tables:`.
- `international_country_metrics.yaml` with top-level `name`, `table`, `grain`, `measures`.

Expected:

- `ok: true`.
- `data.valid === true`.
- manifest target is `semantic-layer/customer-db/_schema/chatbi.yaml`.
- overlay target is `semantic-layer/customer-db/international_country_metrics.yaml`.
- `changedSources` includes `international_country_metrics`.
- No formal file is written.

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/api.semantic-assets.test.ts
```

Expected: FAIL before implementation.

**Step 2: Add public types**

In `webui/src/lib/types.ts`, add:

```ts
export type SemanticAssetKind = "schemaManifest" | "semanticSource" | "wiki" | "eval";

export type SemanticAssetFilePreview = {
  originalFilename: string;
  kind: SemanticAssetKind;
  targetPath: string;
  exists: boolean;
  sizeBytes: number;
  sha256: string;
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable?: string;
};

export type SemanticAssetIssue = {
  code: string;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
};
```

Add request/response types from the source spec for validate, publish, releases, and export.

**Step 3: Implement classifier**

Implement helpers in `semantic-assets.ts`:

- `classifyYamlAsset(projectRoot, input, defaults)`.
- `validateSemanticAssets(projectRoot, request)`.
- Safe segment validation with `^[A-Za-z_][A-Za-z0-9_-]*$` for connection/source-like ids.
- Manifest detection by top-level `tables`.
- Semantic source detection by top-level `name` and `table`.
- Server-computed target paths only.

Rules:

- Filename is never a path.
- Reject absolute paths, `../`, symlinks, unsafe names, and unknown YAML shapes.
- For semantic source overlays, allow source name to differ from physical table.
- Require `table` to be `<schema>.<table>` and schema to exist under the selected connection.

**Step 4: Wire validate route**

Add:

```text
POST /api/semantic-assets/validate
```

Route returns `{ ok: true, data }` even when `data.valid === false`.

**Step 5: Add negative tests**

Cover:

- Unknown connection.
- Schema not configured.
- Unsafe source name.
- Overlay missing `table`.
- Unknown YAML shape.
- Existing target yields overwrite warning.
- Malformed YAML returns line/column when parser exposes it.

---

## Task 2: Staging Project And Validate Gate

**Files:**

- Modify: `webui/server/semantic-assets.ts`
- Modify: `webui/server/ktx.ts`
- Test: `webui/server/__tests__/semantic-assets.validate-gate.test.ts`

**Step 1: Add staging builder tests**

Test that publish validation builds a staging project under:

```text
.ktx-ui/staging/semantic-publish/<validationId>/
```

Expected:

- staging has `ktx.yaml`.
- staging has a semantic-layer tree with proposed files.
- staging does not contain `.ktx/secrets/**`.
- formal `semantic-layer/` files are unchanged before promote.

**Step 2: Add validate-source exec helper**

Extend or wrap `validateSource` so the caller can pass an alternate project root:

```ts
validateSource(projectRoot, conn, schema, sourceName)
```

No shell. Continue to use `execFile("ktx", ["sl", "validate", sourceName, "--connection-id", conn], { cwd: projectRoot })`.

**Step 3: Implement gate**

Implement:

```ts
runSemanticAssetValidateGate(projectRoot, validationSnapshot)
```

Rules:

- Run changed source validation serially.
- Stop on first failed validation.
- Return structured issue rows.
- Do not write formal files.
- Do not reindex.

**Step 4: Implement staging cleanup**

Implement cleanup helpers:

- `cleanupSemanticPublishStaging(projectRoot, validationId)`.
- `cleanupExpiredSemanticPublishStaging(projectRoot, maxAgeMs = 60 * 60 * 1000)`.

Rules:

- Publish success, blocked, or failed must delete its staging directory in `finally`.
- Server startup or first validate/publish in a process must opportunistically delete staging directories older than 1 hour.
- Cleanup must never traverse outside `.ktx-ui/staging/semantic-publish`.
- Cleanup failure records a warning but must not make validate look successful when validation failed.

**Step 5: Test blocked gate and cleanup**

Mock `execFile` or inject an exec implementation that returns non-zero for one source.

Assert:

- publish response is blocked.
- formal file hash is unchanged.
- reindex is not called.
- release record status is `blocked`.
- staging directory for that validation is removed.
- stale staging directories older than 1 hour are removed by opportunistic cleanup.

---

## Task 3: Atomic Promote, Async Reindex, Publish API, And Release History

**Files:**

- Modify: `webui/server/semantic-assets.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/api.semantic-assets.publish.test.ts`

**Step 1: Add publish API tests**

Test `POST /api/semantic-assets/publish` after a successful validate request.

Expected:

- validate gate is rerun.
- formal target files are written only after gate passes.
- overwritten files require `confirmOverwrite: true`.
- publish response returns immediately after promote with `accepted: true` and `release.status === "reindexing"`.
- `ktx admin reindex` is started asynchronously after promote.
- `reloadCatalog` is called after the reindex attempt finishes.
- `GET /api/semantic-assets/releases/:id/status` eventually returns `published` or `reindex_failed`.
- release sidecar is written to `.ktx-ui/semantic-asset-releases.json`.

**Step 2: Implement release sidecar**

Implement:

- `readSemanticAssetReleases(projectRoot)`.
- `readSemanticAssetRelease(projectRoot, releaseId)`.
- `appendSemanticAssetRelease(projectRoot, record)`.
- `updateSemanticAssetRelease(projectRoot, releaseId, patch)`.
- `GET /api/semantic-assets/releases`.
- `GET /api/semantic-assets/releases/:id/status`.

Keep latest 100 records. Do not store YAML content.

**Step 3: Implement publish lock**

MVP lock:

```text
.ktx-ui/semantic-publish.lock
```

Rules:

- Reject concurrent publish with `409 PUBLISH_IN_PROGRESS`.
- Always release lock in `finally`.
- Do not use the lock for read-only validate or export.
- This lock is only a single-process / single-Pod MVP guard. Do not document it as safe for NFS, RWX PVC, or multi-Pod concurrency.

**Step 4: Implement atomic promote**

Rules:

- Recompute safe target paths from validation snapshot.
- Refuse symlink target or symlink parent chain.
- Write temp file in target directory, then rename.
- If any promote step fails, do not run reindex.

**Step 5: Implement async reindex helper**

Add:

```ts
reindexProject(projectRoot, options?: { force?: boolean })
```

Use `execFile("ktx", ["admin", "reindex"], { cwd: projectRoot })`.

MVP uses incremental reindex. Add `--force` only when the API explicitly requests it.

Rules:

- Start reindex after publish response is ready to return.
- Update release status from `reindexing` to `published` or `reindex_failed`.
- Redact sensitive stdout/stderr fragments before writing release sidecar.
- Tests must prove a slow mocked reindex does not block publish response.

---

## Task 4: Sanitized Export API

**Files:**

- Create: `webui/server/semantic-asset-export.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/src/lib/types.ts`
- Test: `webui/server/__tests__/api.semantic-asset-export.test.ts`

**Step 1: Write failing export tests**

Fixture includes:

```text
ktx.yaml
semantic-layer/customer-db/_schema/chatbi.yaml
semantic-layer/customer-db/source.yaml
wiki/global/context.md
evals/chatbi/eval/chatbi-eval-cases.yaml
.ktx/secrets/mysql-password
.env
private.key
webui/config/access.yaml
.ktx-ui/audit.sqlite
```

Call:

```text
POST /api/semantic-assets/export
```

Expected:

- zip contains semantic-layer YAML.
- zip contains wiki and eval files when requested.
- zip contains sanitized `ktx.yaml` only.
- zip does not contain secrets, `.env`, private key, audit sqlite, raw access config, `.git`, or raw-sources.
- symlinked files are rejected or excluded.
- sanitized `ktx.yaml` replaces `host`, `port`, `username`, and `password` with `<REDACTED>`.

**Step 2: Implement white-listed collector**

Rules:

- Start from allow list, never from project root recursive walk.
- Use `lstat`, not `stat`, to detect symlinks.
- Only include expected extensions.
- Record excluded files with reason.
- Enforce max file count and total size.

**Step 3: Implement sanitized `ktx.yaml`**

Sanitized output should preserve:

- connection id.
- driver / engine / wire protocol.
- schemas.
- enabled tables.
- password source kind, not secret value.

It must not include:

- raw host values.
- raw port values.
- raw usernames.
- password values.
- token values.

Always replace `host`, `port`, `username`, and `password` with `<REDACTED>`, even if they appear harmless in local demo config.

**Step 4: Implement response and download**

Store generated zip under:

```text
.ktx-ui/exports/<export-id>.zip
```

Add a short-lived download route:

```text
GET /api/semantic-assets/exports/:exportId/download
```

Return `application/zip`.

---

## Task 5: Frontend Publish Drawer

**Files:**

- Create: `webui/src/lib/semantic-assets.ts`
- Create: `webui/src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- Create: `webui/src/components/semantic-assets/SemanticAssetValidationPanel.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/Review.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/semantic-asset-publish.test.tsx`

**Step 1: Add API client wrappers**

Add wrappers for:

- validate.
- publish.
- releases.
- release status.
- export.

**Step 2: Build drawer states**

States:

- Idle.
- Parsed / Dry-Run.
- Ready To Publish.
- Publishing.
- Reindexing.
- Published.
- Blocked.

Use existing button, drawer, panel, diff, and YAML preview styles where possible.

**Step 3: Wire entry points**

Add:

- `/connections` connection card action: `上传语义包`.
- `/review` action: `发布并 reindex` when semantic-layer changes exist.

Keep M17 `上传 YAML` manifest-only action until the new drawer fully supersedes it.

**Step 4: UX tests**

Cover:

- Multi-file upload displays manifest and overlay targets.
- Publish button is disabled when validation has errors.
- Publish success response moves UI into Reindexing instead of final Published.
- Reindexing polls release status by `releaseId`.
- Blocked publish shows validate issue and does not show success copy.
- Published state shows release id and download action.

---

## Task 6: Frontend Sanitized Export

**Files:**

- Modify: `webui/src/components/semantic-assets/SemanticAssetPublishDrawer.tsx`
- Create: `webui/src/components/semantic-assets/SemanticAssetExportButton.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/Review.tsx`
- Test: `webui/src/__tests__/semantic-asset-export.test.tsx`

**Step 1: Add export button**

Button copy:

```text
下载当前全量资产包 (.zip)
```

**Step 2: Show safety summary**

After export response, show:

- included files count.
- excluded files count.
- `Secrets 已强制排除`.
- sanitized `ktx.yaml` status.

**Step 3: Download behavior**

Use backend `downloadUrl`. Do not construct file paths on the client.

**Step 4: UX tests**

Cover:

- export button calls API.
- summary displays excluded secret paths by category, not secret values.
- download link uses backend URL.

---

## Task 7: Verification

Run targeted tests:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/api.semantic-assets.test.ts
npm test -- --run server/__tests__/semantic-assets.validate-gate.test.ts
npm test -- --run server/__tests__/api.semantic-assets.publish.test.ts
npm test -- --run server/__tests__/api.semantic-asset-export.test.ts
npm test -- --run src/__tests__/semantic-asset-publish.test.tsx
npm test -- --run src/__tests__/semantic-asset-export.test.tsx
```

Run existing affected tests:

```bash
npm test -- --run server/__tests__/api.catalog-assets.test.ts server/__tests__/api.catalog-reload.test.ts server/__tests__/api.save.test.ts
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-editor.test.tsx src/__tests__/review.test.tsx
```

Run build:

```bash
npm run build
```

Manual acceptance:

- Upload one schema manifest and two semantic overlay files.
- Confirm Dry-Run target paths and diff.
- Force a bad measure expr and verify publish blocks before formal write.
- Fix the expr and publish.
- Confirm publish returns `reindexing` before reindex completes.
- Confirm status polling reaches `published` or `reindex_failed`.
- Export full asset package and inspect zip contents for hard-blocked secret exclusions.
- Confirm staging directories are removed after success and failure, and stale directories older than 1 hour are cleaned.
- Confirm generated diff does not depend on a system `diff` binary.

Expected final report:

- Files changed.
- Tests run.
- Whether real `ktx sl validate` and `ktx admin reindex` were run or mocked.
- Confirmation that M19 was tested only for single-replica / RWO-style local write assumptions unless an external lock was provided.
