# Static Catalog Loading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace WebUI-triggered `ktx ingest` subprocesses with a zero-LLM static Catalog reload pipeline based only on `ktx.yaml` and `semantic-layer/**/*.yaml`.

**Architecture:** Add a static `POST /api/catalog/reload` backend endpoint that re-reads local YAML assets and records bounded reload history in `.ktx-ui`. Safely downgrade `/api/connections/:connId/ingest` to a deprecated alias that never shells out. Refactor connection overview, whitelist, and Add Schema UI from Ingest semantics to Reload Catalog semantics.

**Tech Stack:** Fastify, TypeScript, YAML, Node `fs/promises`, React, TanStack Query, Vitest, Testing Library, existing `apiClient`, existing `fs-safe`, existing CSS in `webui/src/app/app.css`.

---

## Context For Minimax / Developer

Read these documents before coding:

- `webui/docs/17-static-catalog-loading-spec.md`
- `webui/docs/16-ingest-first-class-ux-spec.md`
- `webui/docs/10-deployment-connection-ux-refresh.md`
- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/docs/03-api-spec.md`
- `docs/DEVELOPMENT.md`

Read these implementation files:

- `webui/server/index.ts`
- `webui/server/ktx.ts`
- `webui/server/ingest-runs.ts`
- `webui/server/fs-safe.ts`
- `webui/server/project.ts`
- `webui/server/semantic-layer.ts`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/ingest.ts`
- `webui/src/components/ingest/IngestActionButton.tsx`
- `webui/src/components/ingest/IngestDiagnosticsDrawer.tsx`
- `webui/src/components/ingest/IngestLastRunBadge.tsx`
- `webui/src/components/ingest/IngestResultPanel.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/app/app.css`

Read these tests:

- `webui/server/__tests__/api.ingest.test.ts`
- `webui/server/__tests__/ingest-runs.test.ts`
- `webui/server/__tests__/api.add-schema.test.ts`
- `webui/src/__tests__/ingest-components.test.tsx`
- `webui/src/__tests__/add-schema-drawer.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`

Non-negotiable boundaries:

- Do not read, write, or expose `.ktx/secrets/**`.
- Do not call `execFile("ktx", ["ingest", ...])` from any WebUI endpoint.
- Do not introduce LLM, embedding, enrichment, network, or third-party API dependency into Catalog reload.
- Do not modify `ktx.yaml` except through existing `enabled_tables` and add-schema write routes.
- Do not invent physical database metadata. If no local manifest exists, show a warning, not fake tables.
- Keep old `/api/connections/:connId/ingest` route compatible but deprecated and no-op/alias.
- Preserve API envelope style: success `{ ok: true, data }`; failure `{ ok: false, error }`.
- Keep tests deterministic and local-file based.

## Task 1: Backend Static Catalog Reload API

**Files:**

- Create: `webui/server/catalog-reload.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/server/__tests__/api.catalog-reload.test.ts`
- Test: `webui/server/__tests__/api.ingest.test.ts`

**Step 1: Write failing tests for `POST /api/catalog/reload`**

Create `webui/server/__tests__/api.catalog-reload.test.ts`.

Use the same safe pattern from `api.add-schema.test.ts` / `api.ingest.test.ts`:

```ts
vi.resetModules();
process.env.KTX_PROJECT_ROOT = projectRoot;
process.env.LUCY_AUDIT_DB = auditDbPath;
const { buildServer } = await import("../index");
const app = buildServer();
await app.ready();
```

Test fixtures:

```yaml
connections:
  demo-mysql:
    schemas:
      - dataforai
      - openclaw_db
    enabled_tables:
      - dataforai.superstore_orders
      - dataforai.superstore_people
      - openclaw_db.missing_table
```

Create one manifest:

```text
semantic-layer/demo-mysql/_schema/dataforai.yaml
```

with:

```yaml
tables:
  superstore_orders:
    table: dataforai.superstore_orders
  superstore_people:
    table: dataforai.superstore_people
```

Assertions:

- `POST /api/catalog/reload` returns `ok: true`.
- `data.source === "static-yaml"`.
- `data.connections === 1`.
- `data.configuredSchemas === 2`.
- `data.manifestSchemas === 1`.
- `data.tables === 2`.
- `data.enabledTables === 3`.
- `warnings` contains `SCHEMA_MANIFEST_MISSING` for `openclaw_db`.
- `warnings` contains `ENABLED_TABLE_NOT_SCANNED` for `openclaw_db.missing_table`.

Run:

```bash
cd webui
npm test -- --run server/__tests__/api.catalog-reload.test.ts
```

Expected: FAIL before implementation.

**Step 2: Add shared response types**

In `webui/src/lib/types.ts`, add:

```ts
export type CatalogReloadStatus = "success" | "failed";

export type CatalogReloadWarning = {
  code:
    | "SCHEMA_MANIFEST_MISSING"
    | "SCHEMA_MANIFEST_EMPTY"
    | "ENABLED_TABLE_NOT_SCANNED"
    | "MANIFEST_PARSE_FAILED";
  connectionId: string;
  schema?: string;
  table?: string;
  filePath?: string;
  message: string;
};

export type CatalogReloadRun = {
  id: string;
  status: CatalogReloadStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestedConnectionId?: string;
  requestedSchema?: string;
  connections: number;
  configuredSchemas: number;
  manifestSchemas: number;
  tables: number;
  enabledTables: number;
  warnings: CatalogReloadWarning[];
  source: "static-yaml";
  deprecatedIngestAlias?: boolean;
};

export type CatalogReloadsResponse = {
  runs: CatalogReloadRun[];
  last: CatalogReloadRun | null;
  lastByConnection: Record<string, CatalogReloadRun>;
};
```

In `webui/src/lib/queryKeys.ts`, add:

```ts
catalogReloads: ["catalog", "reloads"] as const
```

Do not remove old `ingestRuns` keys until all frontend code no longer imports them.

**Step 3: Implement `catalog-reload.ts`**

Implement helpers:

```ts
export async function reloadCatalog(
  projectRoot: string,
  input?: { connectionId?: string; schema?: string; deprecatedIngestAlias?: boolean }
): Promise<CatalogReloadRun>;

export async function readCatalogReloads(projectRoot: string): Promise<CatalogReloadsResponse>;

export async function appendCatalogReload(
  projectRoot: string,
  run: CatalogReloadRun
): Promise<CatalogReloadsResponse>;
```

Rules:

- Read `ktx.yaml` via existing project helpers where possible.
- Read manifests from `semantic-layer/<conn>/_schema/*.yaml`.
- Do not call `runIngest`.
- Do not import `server/ktx.ts` here.
- Persist history to `.ktx-ui/catalog-reloads.json`.
- Keep latest 20 runs.
- Generate ids as `rel_YYYYMMDD_HHMMSS_mmm`.
- If one manifest YAML parse fails, return `status: "success"` with `MANIFEST_PARSE_FAILED` warning unless the whole reload cannot read project config.

**Step 4: Wire routes in `server/index.ts`**

Add:

```text
POST /api/catalog/reload
GET /api/catalog/reloads
```

Route behavior:

- `POST` accepts `{ connectionId?: string; schema?: string }`.
- `GET` returns history.
- Both use `resolveProjectRoot()`.

**Step 5: Safely downgrade `/api/connections/:connId/ingest`**

Modify old route:

```ts
app.post("/api/connections/:connId/ingest", async (request) => {
  const projectRoot = await resolveProjectRoot();
  const reload = await reloadCatalog(projectRoot, {
    connectionId: request.params.connId,
    schema: request.body?.schema,
    deprecatedIngestAlias: true
  });
  return {
    ok: true,
    data: {
      deprecated: true,
      replacement: "/api/catalog/reload",
      message: "WebUI no longer executes ktx ingest. Static catalog reload completed.",
      reload
    }
  };
});
```

Do not remove `runIngest` from `server/ktx.ts` in this task; just make sure WebUI routes stop calling it. Keeping the wrapper may be useful for legacy tests or future CLI-only tools.

**Step 6: Update ingest API tests**

In `webui/server/__tests__/api.ingest.test.ts`, update expectations:

- `POST /api/connections/demo-mysql/ingest` returns `deprecated: true`.
- response includes `replacement: "/api/catalog/reload"`.
- response includes `reload.source === "static-yaml"`.
- spy/mock `runIngest` and assert it was not called.
- remove old assertions for CLI `exitCode`, `stdout`, `stderr`, and `command`.

Run:

```bash
cd webui
npm test -- --run server/__tests__/api.catalog-reload.test.ts server/__tests__/api.ingest.test.ts
```

Expected: PASS.

## Task 2: Add Static Reload Frontend Hook And Components

**Files:**

- Create: `webui/src/lib/catalogReload.ts`
- Create: `webui/src/components/catalog/CatalogReloadButton.tsx`
- Create: `webui/src/components/catalog/CatalogReloadResultPanel.tsx`
- Create: `webui/src/components/catalog/CatalogReloadLastRunBadge.tsx`
- Create: `webui/src/components/catalog/index.ts`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/catalog-reload-components.test.tsx`

**Step 1: Write failing component tests**

Create tests for:

- `CatalogReloadButton` posts to `/api/catalog/reload`.
- button passes optional `{ connectionId, schema }`.
- on success it invalidates:
  - `project`
  - `connections`
  - `sources`
  - `connectionTables(connectionId)` when connectionId exists
  - `catalogReloads`
- warning result renders a non-blocking panel.
- label defaults to `重新加载本地资产` when no custom label is supplied.

Run:

```bash
cd webui
npm test -- --run src/__tests__/catalog-reload-components.test.tsx
```

Expected: FAIL.

**Step 2: Implement `useCatalogReload`**

In `webui/src/lib/catalogReload.ts`:

```ts
export function useCatalogReload(options?: {
  connectionId?: string;
  schema?: string;
}): {
  lastRun: CatalogReloadRun | null;
  isPending: boolean;
  clearLastRun: () => void;
  reload: () => Promise<CatalogReloadRun | undefined>;
};
```

Use `apiPost<CatalogReloadRun>("/api/catalog/reload", body)`.

**Step 3: Implement components**

`CatalogReloadButton` props:

```ts
type CatalogReloadButtonProps = {
  connectionId?: string;
  schema?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  testId?: string;
  onReloadComplete?: (run: CatalogReloadRun) => void;
};
```

`CatalogReloadResultPanel` renders:

- success summary.
- warning list.
- requested connection/schema.
- counts.

`CatalogReloadLastRunBadge` renders:

- `上次 Reload：未运行`
- `上次 Reload：YYYY-MM-DD HH:mm · 成功 · N 张表`
- `上次 Reload：YYYY-MM-DD HH:mm · W 个提示`

**Step 4: Keep ingest components temporarily**

Do not delete ingest components until pages are migrated. After all pages use catalog components, remove unused exports and tests in Task 5.

**Step 5: Run component tests**

```bash
cd webui
npm test -- --run src/__tests__/catalog-reload-components.test.tsx
```

Expected: PASS.

## Task 3: Refactor AddSchemaDrawer

**Files:**

- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Test: `webui/src/__tests__/add-schema-drawer.test.tsx`

**Step 1: Write failing tests**

Update Add Schema tests:

- Step labels include `3. 确认并完成`, not `3. 确认并 ingest`.
- After schema save, drawer does not render `现在 ingest`.
- After schema save, drawer renders static loading explanation:
  - `WebUI 将从本地 semantic-layer YAML 读取表清单`
  - `刷新本地表目录`
- Clicking `刷新本地表目录` posts to `/api/catalog/reload` with `{ connectionId, schema }`.
- No call is made to `/api/connections/:connId/ingest`.

Run:

```bash
cd webui
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: FAIL.

**Step 2: Remove CLI ingest flow**

In `AddSchemaDrawer.tsx`:

- Remove `useIngestRun`.
- Remove `IngestResultPanel`.
- Remove `runIngestNow`.
- Update `STEP_LABELS`.
- Replace success step actions with:
  - `完成`
  - `刷新本地表目录`

Use `CatalogReloadButton`:

```tsx
<CatalogReloadButton
  connectionId={connection.id}
  schema={trimmed}
  label="刷新本地表目录"
  variant="secondary"
  testId="add-schema-reload-catalog"
/>
```

**Step 3: Query invalidation**

After schema write still invalidate:

- `project`
- `connections`
- `sources`
- `connectionTables(connection.id)`
- `catalogReloads`

Do not invalidate `ingestRuns` unless legacy code still renders it.

**Step 4: Run tests**

```bash
cd webui
npm test -- --run src/__tests__/add-schema-drawer.test.tsx src/__tests__/catalog-reload-components.test.tsx
```

Expected: PASS.

## Task 4: Refactor `/connections` Overview

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Write failing tests**

Update tests to assert:

- page no longer renders `触发 Ingest`.
- page renders `重新加载本地资产`.
- clicking connection-level reload calls `/api/catalog/reload` with `{ connectionId: "demo-mysql" }`.
- schema rows no longer render `重新扫描`.
- schema row for missing manifest shows local-manifest warning copy if test fixture supports it.
- last run badge uses reload terminology, not ingest terminology.

Run:

```bash
cd webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: FAIL.

**Step 2: Replace queries**

Replace:

```ts
apiGet<IngestRunsResponse>("/api/connections/ingest-runs")
```

with:

```ts
apiGet<CatalogReloadsResponse>("/api/catalog/reloads")
```

Use `queryKeys.catalogReloads`.

**Step 3: Replace buttons and badges**

Replace ingest components with catalog components:

- `IngestActionButton` -> `CatalogReloadButton`
- `IngestLastRunBadge` -> `CatalogReloadLastRunBadge`

Remove unsupported schema-scoped ingest copy.

**Step 4: Schema rows**

Render schemas as local state:

```text
<schema>
本地 YAML 资产
```

M14 may keep the first pass simple:

- show schema name.
- show whether schema has tables by checking enabled tables or table inventory if already available.

Do not promise physical database scanning.

**Step 5: Run tests**

```bash
cd webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

## Task 5: Refactor `/connections/whitelist`

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Write failing tests**

Update tests:

- toolbar shows `刷新本地表目录`, not `触发 Schema 扫描`.
- toolbar reload posts to `/api/catalog/reload`.
- with schema filter `openclaw_db`, body includes `{ connectionId, schema: "openclaw_db" }` or global reload if the implementation chooses global; document expected behavior in test name.
- save button remains `保存变更`.
- saving whitelist does not call `/ingest` or `/api/catalog/reload` automatically.
- configured empty schema copy says local manifest is missing and is non-blocking.
- empty schema action says `刷新本地表目录`.

Run:

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: FAIL.

**Step 2: Replace toolbar action**

Replace `IngestActionButton` with `CatalogReloadButton`.

Recommended behavior:

```tsx
<CatalogReloadButton
  connectionId={toolbarReloadConnId}
  schema={toolbarReloadSchema}
  label="刷新本地表目录"
  variant="secondary"
  testId="whitelist-reload-catalog"
/>
```

**Step 3: Replace empty schema action and copy**

Copy:

```text
openclaw_db 已在连接配置中启用，但本地 semantic-layer 尚未提供表清单。
请将 manifest 文件放入 semantic-layer/demo-mysql/_schema/openclaw_db.yaml，或在具备 KTX/数据库权限的离线环境中生成后提交。
```

Action:

```text
[刷新本地表目录]
```

**Step 4: Remove dead scan code**

Remove any dead placeholder like:

```tsx
{false && null /* ... */}
```

Remove unused ingest imports and types.

**Step 5: Run tests**

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx src/__tests__/catalog-reload-components.test.tsx
```

Expected: PASS.

## Task 6: Remove Or Deprecate M13 Ingest Frontend Surface

**Files:**

- Modify or delete: `webui/src/lib/ingest.ts`
- Modify or delete: `webui/src/components/ingest/*`
- Modify: `webui/src/__tests__/ingest-components.test.tsx`
- Modify: `webui/src/lib/types.ts`

**Step 1: Search all usages**

Run:

```bash
cd webui
rg -n "IngestActionButton|IngestDiagnosticsDrawer|IngestLastRunBadge|IngestResultPanel|useIngestRun|ingestRuns|/ingest|触发 Ingest|现在 ingest|重新扫描|Schema 扫描" src server
```

Expected:

- no UI page should import ingest components.
- old API tests may still reference `/ingest` only for deprecated alias behavior.

**Step 2: Decide deletion vs compatibility**

Preferred:

- Delete `src/lib/ingest.ts`.
- Delete `src/components/ingest/*`.
- Delete or rewrite `src/__tests__/ingest-components.test.tsx` as catalog reload component tests.

If deletion creates too much churn, keep deprecated exports but add comments:

```ts
// Deprecated by M14. Do not use in WebUI surfaces.
```

**Step 3: Type cleanup**

Remove frontend `IngestRun` types only if no server/frontend file imports them. Server-side compatibility route can use local types or catalog reload types.

**Step 4: Run targeted tests**

```bash
cd webui
npm test -- --run src/__tests__/catalog-reload-components.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/add-schema-drawer.test.tsx
```

Expected: PASS.

## Task 7: Final Test And Build Verification

**Files:**

- No code files unless failures require fixes.

**Step 1: Run M14 backend tests**

```bash
cd webui
npm test -- --run server/__tests__/api.catalog-reload.test.ts server/__tests__/api.ingest.test.ts server/__tests__/api.add-schema.test.ts
```

Expected: PASS.

**Step 2: Run M14 frontend tests**

```bash
cd webui
npm test -- --run src/__tests__/catalog-reload-components.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

**Step 3: Run broader test suite**

```bash
cd webui
npm test -- --run
```

Expected:

- PASS except any explicitly known pre-existing unrelated eval drift flake.
- If the eval drift flake remains, record the exact failing file and assertion in the handoff.

**Step 4: Build**

```bash
cd webui
npm run build
```

Expected:

- build passes.
- Existing chunk size warning is acceptable.

## Reviewer Checklist

- [ ] No WebUI route calls `runIngest` or `execFile("ktx", ["ingest", ...])`.
- [ ] `POST /api/catalog/reload` reads only local files.
- [ ] `/api/connections/:connId/ingest` returns deprecated alias response and does not shell out.
- [ ] UI copy uses `Reload Catalog` / `刷新本地表目录` / `重新加载本地资产`, not `Ingest`.
- [ ] Add Schema success step no longer shows `现在 ingest`.
- [ ] Whitelist save does not call `/ingest` or `/api/catalog/reload`.
- [ ] Empty configured schema state is non-blocking and explains missing local manifest.
- [ ] Reload warnings distinguish configured schema, manifest schema, enabled table, and parse failure cases.
- [ ] Tests cover no-LLM static reload path.
- [ ] `.ktx/secrets/**` remains untouched.

## Suggested Commit

```bash
git add webui/server/catalog-reload.ts webui/server/index.ts webui/src/lib/types.ts webui/src/lib/queryKeys.ts webui/src/lib/catalogReload.ts webui/src/components/catalog webui/src/components/AddSchemaDrawer.tsx webui/src/pages/connections/ConnectionOverview.tsx webui/src/pages/connections/TableWhitelist.tsx webui/src/app/app.css webui/server/__tests__/api.catalog-reload.test.ts webui/server/__tests__/api.ingest.test.ts webui/src/__tests__/catalog-reload-components.test.tsx webui/src/__tests__/add-schema-drawer.test.tsx webui/src/__tests__/connection-overview.test.tsx webui/src/__tests__/table-whitelist.test.tsx
git commit -m "feat(webui): use static catalog reload for database assets"
```
