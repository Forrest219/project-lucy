# Ingest First-Class UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Promote KTX ingest from a hidden follow-up action into a first-class WebUI capability across `/connections`, schema rows, `/connections/whitelist`, and Add Schema diagnostics.

**Architecture:** Add a small Ingest run model and bounded sidecar history in `.ktx-ui`, extend the existing ingest endpoint to accept optional schema intent, and reuse shared React components for triggering ingest and inspecting stdout/stderr. M13 must remain compatible with current KTX behavior where only `ktx ingest <connection>` is guaranteed.

**Tech Stack:** Fastify, TypeScript, Node `fs/promises`, React, TanStack Query, Vitest, Testing Library, existing `apiClient`, existing CSS utilities in `webui/src/app/app.css`.

---

## Context For Minimax

Read these files before coding:

- `webui/docs/16-ingest-first-class-ux-spec.md`
- `webui/docs/10-deployment-connection-ux-refresh.md`
- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/server/ktx.ts`
- `webui/server/index.ts`
- `webui/server/fs-safe.ts`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/app/app.css`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/table-whitelist.test.tsx`
- `webui/src/__tests__/add-schema-drawer.test.tsx`

Non-negotiable boundaries:

- Do not read or expose `.ktx/secrets/**`.
- Do not modify `ktx.yaml` in this work order except through existing whitelist save routes.
- Non-zero KTX exit code must return structured ingest result data to the frontend, not throw away stderr/stdout.
- Do not claim schema-scoped ingest is real unless the backend actually executes a schema-scoped KTX command.
- Keep stdout/stderr bounded and redacted before persisting to `.ktx-ui`.
- Preserve existing API envelope style through `apiClient`.

## Task 1: Backend Ingest Run Model And Sidecar

**Files:**

- Create: `webui/server/ingest-runs.ts`
- Modify: `webui/src/lib/types.ts`
- Test: `webui/server/__tests__/ingest-runs.test.ts`

**Step 1: Add shared types**

In `webui/src/lib/types.ts`, add:

```ts
export type IngestScope = "connection" | "schema";

export type IngestRunStatus = "running" | "success" | "failed";

export type IngestRun = {
  id: string;
  connectionId: string;
  schema?: string;
  requestedScope: IngestScope;
  executedScope: IngestScope;
  schemaScopedSupported: boolean;
  status: IngestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command: string[];
  scannedTableCount?: number;
  scannedSchemas?: string[];
  hint?: string;
};

export type IngestRunsResponse = {
  runs: IngestRun[];
  lastByConnection: Record<string, IngestRun>;
};
```

If importing frontend types into server tests is awkward, duplicate server-side internal types in `ingest-runs.ts` and keep the JSON shape identical.

**Step 2: Write sidecar tests**

Create tests for:

- empty sidecar returns `{ runs: [], lastByConnection: {} }`.
- appending a run writes `.ktx-ui/ingest-runs.json`.
- only the latest 20 runs are kept.
- stdout/stderr are truncated to 16KB.
- obvious secrets are redacted.
- `lastByConnection` picks the newest finished run per connection.

Run:

```bash
cd webui
npm test -- --run server/__tests__/ingest-runs.test.ts
```

Expected: FAIL before implementation.

**Step 3: Implement sidecar helpers**

Implement:

```ts
export async function readIngestRuns(projectRoot: string): Promise<IngestRunsResponse>;
export async function appendIngestRun(projectRoot: string, run: IngestRun): Promise<IngestRunsResponse>;
export function redactIngestLog(text: string): string;
export function ingestFailureHint(connectionId: string, schema: string | undefined, output: string): string;
```

Sidecar path:

```ts
path.join(projectRoot, ".ktx-ui", "ingest-runs.json")
```

Create parent directory when appending.

**Step 4: Run sidecar tests**

```bash
cd webui
npm test -- --run server/__tests__/ingest-runs.test.ts
```

Expected: PASS.

## Task 2: Extend Backend Ingest Endpoint

**Files:**

- Modify: `webui/server/ktx.ts`
- Modify: `webui/server/index.ts`
- Modify: `webui/server/ingest-runs.ts`
- Test: `webui/server/__tests__/api.ingest.test.ts`
- Modify existing if simpler: `webui/server/__tests__/api.add-schema.test.ts`

**Step 1: Write endpoint tests**

Mock `runIngest` or inject the KTX exec layer. Cover:

- `POST /api/connections/demo-mysql/ingest` records a successful connection-scoped run.
- request body `{ schema: "openclaw_db" }` records `requestedScope: "schema"` and `executedScope: "connection"` when schema-scoped support is false.
- non-zero exit code returns `ok: true`, `data.status: "failed"`, `exitCode`, `stderr`, `stdout`, and `hint`.
- `GET /api/connections/ingest-runs` returns the run history.
- logs returned by the API are redacted and bounded.

Run:

```bash
cd webui
npm test -- --run server/__tests__/api.ingest.test.ts
```

Expected: FAIL before implementation.

**Step 2: Update `runIngest` return metadata**

Keep the current command for M13:

```ts
["ingest", connId]
```

Return or derive command metadata:

```ts
command: ["ktx", "ingest", connId]
schemaScopedSupported: false
executedScope: "connection"
```

Do not add fake `--schema` arguments unless KTX support is verified.

**Step 3: Update POST route**

In `webui/server/index.ts`, change the route body shape:

```ts
Body: { schema?: string }
```

Route workflow:

1. Resolve project root.
2. Read `connId`, optional `schema`.
3. Capture `startedAt`.
4. Run `runIngest(projectRoot, connId)`.
5. Capture `finishedAt`, duration, exitCode.
6. Re-read scanned table inventory for the connection to compute `scannedTableCount` and `scannedSchemas`.
7. Build `IngestRun`.
8. Append it to sidecar.
9. Return `{ ok: true, data: run }`.

**Step 4: Add GET route**

Add:

```text
GET /api/connections/ingest-runs
```

Return `readIngestRuns(projectRoot)`.

**Step 5: Run backend ingest tests**

```bash
cd webui
npm test -- --run server/__tests__/api.ingest.test.ts
```

Expected: PASS.

## Task 3: Shared Frontend Ingest Components

**Files:**

- Create: `webui/src/components/IngestActionButton.tsx`
- Create: `webui/src/components/IngestDiagnosticsDrawer.tsx`
- Create: `webui/src/components/IngestLastRunBadge.tsx`
- Create: `webui/src/lib/ingest.ts`
- Modify: `webui/src/lib/queryKeys.ts`
- Test: `webui/src/__tests__/ingest-components.test.tsx`

**Step 1: Add query keys**

Add:

```ts
ingestRuns: ["connections", "ingest-runs"] as const
```

**Step 2: Write component tests**

Cover:

- action button calls `POST /api/connections/:connId/ingest` with optional schema.
- loading text/state appears while pending.
- success invalidates `connections`, `sources`, `connectionTables(connId)`, and `ingestRuns`.
- failed run opens diagnostics drawer with exit code, hint, stderr, stdout.
- unsupported schema-scoped ingest shows explicit copy: `当前将扫描整个连接`.

Run:

```bash
cd webui
npm test -- --run src/__tests__/ingest-components.test.tsx
```

Expected: FAIL before implementation.

**Step 3: Implement `IngestActionButton`**

Props:

```ts
type IngestActionButtonProps = {
  connectionId: string;
  schema?: string;
  label?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  onRunComplete?: (run: IngestRun) => void;
};
```

Use `apiPost<IngestRun>`.

Default labels:

- connection only: `触发 Ingest`
- schema: `重新扫描`

**Step 4: Implement diagnostics drawer**

Render:

- `Ingest 失败`
- connection/schema
- exit code badge
- hint
- command
- stdout/stderr collapsible sections
- buttons: `重试`, `复制日志`, `关闭`

Keep it reusable for Add Schema and whitelist.

**Step 5: Implement last-run badge**

Props:

```ts
type IngestLastRunBadgeProps = {
  run?: IngestRun;
};
```

States:

- no run: `上次 Ingest：未运行`
- success: `上次 Ingest：YYYY-MM-DD HH:mm · 成功 · N 张表`
- failed: `上次 Ingest：YYYY-MM-DD HH:mm · 失败 · 退出码 N`

**Step 6: Run component tests**

```bash
cd webui
npm test -- --run src/__tests__/ingest-components.test.tsx
```

Expected: PASS.

## Task 4: Connection Overview Ingest Entry Points

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Add failing tests**

Extend existing tests to assert:

- each connection card shows `触发 Ingest`.
- clicking it posts to `/api/connections/demo-mysql/ingest`.
- last run status from `GET /api/connections/ingest-runs` is rendered.
- schema `openclaw_db` renders as a chip/row with `重新扫描`.
- clicking schema rescan posts body `{ schema: "openclaw_db" }`.
- if returned run has `executedScope: "connection"` for schema request, UI shows the unsupported capability note.

Run:

```bash
cd webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Fetch ingest runs**

Add query:

```ts
apiGet<IngestRunsResponse>("/api/connections/ingest-runs")
```

Build `lastByConnection`.

**Step 3: Replace comma schemas with schema rows/chips**

Current card shows:

```tsx
<strong>{conn.schemas.join(", ")}</strong>
```

Replace with a compact schema list:

```tsx
{conn.schemas.map((schema) => (
  <div key={schema} className="pl-schema-row">
    <span>{schema}</span>
    <IngestActionButton connectionId={conn.id} schema={schema} label="重新扫描" variant="ghost" size="sm" />
  </div>
))}
```

Add CSS if needed.

**Step 4: Add connection-level action**

Add `IngestActionButton` in the existing card action area.

**Step 5: Render last run badge**

Render `IngestLastRunBadge` near driver/status metadata.

**Step 6: Run tests**

```bash
cd webui
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

## Task 5: Whitelist Page Ingest Decoupling

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Test: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Add failing tests**

Add tests for:

- toolbar always shows `触发 Schema 扫描` when at least one connection exists.
- button is enabled even when there are no draft whitelist changes.
- with schema filter `openclaw_db`, clicking the button posts `{ schema: "openclaw_db" }`.
- floating bar button text is `保存变更`, not `保存并触发扫描`.
- saving whitelist does not call `/ingest` automatically.
- configured empty schema panel contains a `触发 Schema 扫描` action.

Run:

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: FAIL before implementation.

**Step 2: Add constant ingest action**

In the whitelist toolbar, render `IngestActionButton`.

Default scope rules:

- one connection + specific schema filter: pass that schema.
- one connection + `all`: pass no schema.
- multiple connections: open a small chooser dialog before triggering.

M13 may start with single-connection support if tests clearly document it. If multiple connections exist, the button should open a chooser or be disabled with a clear message; do not guess.

**Step 3: Decouple save**

Change button text:

```text
保存并触发扫描
```

to:

```text
保存变更
```

Remove automatic `POST /ingest` from whitelist save flow.

After successful save:

- invalidate `connections`
- show `白名单已保存`
- show inline CTA or rely on toolbar ingest button

**Step 4: Keep scan logs via shared diagnostics**

Remove page-local `scanLogs` if no longer needed, or use it only for manual ingest results. Prefer shared diagnostics drawer.

**Step 5: Add empty schema action**

In configured-but-unscanned schema empty state, add:

```tsx
<IngestActionButton connectionId={conn.id} schema={schema} label="触发 Schema 扫描" />
```

**Step 6: Run whitelist tests**

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: PASS.

## Task 6: Reuse Ingest Diagnostics In Add Schema Drawer

**Files:**

- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Test: `webui/src/__tests__/add-schema-drawer.test.tsx`

**Step 1: Add failing test expectations**

Update existing failure test to assert the shared diagnostics drawer/panel shows:

- exit code
- stderr
- stdout
- hint
- retry action

Run:

```bash
cd webui
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: FAIL until shared component is wired in.

**Step 2: Replace local duplicate log panel**

Use `IngestActionButton` or the same mutation helper used by it.

If the drawer needs inline layout instead of a global slide-over, `IngestDiagnosticsDrawer` can expose a lower-level `IngestResultPanel`.

**Step 3: Ensure query invalidation**

On successful Add Schema ingest, invalidate:

- `connections`
- `sources`
- `connectionTables(connection.id)`
- `ingestRuns`

**Step 4: Run Add Schema tests**

```bash
cd webui
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: PASS.

## Task 7: Styling And Accessibility

**Files:**

- Modify: `webui/src/app/app.css`

**Step 1: Add styles**

Add compact styles for:

- `.pl-schema-row`
- `.pl-ingest-last-run`
- `.pl-ingest-diagnostics`
- `.pl-log-section`

Keep cards at existing radius and avoid nested card styling.

**Step 2: Accessibility checks**

Ensure:

- ingest buttons have clear accessible names.
- schema rescan is keyboard reachable.
- diagnostics drawer uses `role="dialog"` and labelled title.
- logs are inside `<pre>` or equivalent monospaced block.
- failure banners use `role="alert"`.

## Task 8: Final Verification

Run:

```bash
cd webui
npm test -- --run server/__tests__/ingest-runs.test.ts server/__tests__/api.ingest.test.ts
npm test -- --run src/__tests__/ingest-components.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/table-whitelist.test.tsx src/__tests__/add-schema-drawer.test.tsx
npm run build
```

Expected:

- all listed tests pass.
- build passes.
- Vite may warn about chunk size; do not treat the existing warning as a failure.

Manual smoke checklist:

1. Open `/connections`.
2. Confirm `demo-mysql` shows `触发 Ingest`.
3. Confirm schemas render as rows/chips and `openclaw_db` has `重新扫描`.
4. Trigger `openclaw_db` ingest and confirm either success or diagnostics with stderr/stdout.
5. Open `/connections/whitelist`.
6. Confirm `openclaw_db` appears in Schema filter even if no scanned tables exist.
7. Confirm `触发 Schema 扫描` is visible with no whitelist changes.
8. Confirm saving whitelist does not automatically call ingest.

## Suggested Commit

```bash
git add webui/server/ingest-runs.ts webui/server/ktx.ts webui/server/index.ts webui/src/components/IngestActionButton.tsx webui/src/components/IngestDiagnosticsDrawer.tsx webui/src/components/IngestLastRunBadge.tsx webui/src/lib/ingest.ts webui/src/lib/queryKeys.ts webui/src/lib/types.ts webui/src/pages/connections/ConnectionOverview.tsx webui/src/pages/connections/TableWhitelist.tsx webui/src/components/AddSchemaDrawer.tsx webui/src/app/app.css webui/server/__tests__/ingest-runs.test.ts webui/server/__tests__/api.ingest.test.ts webui/src/__tests__/ingest-components.test.tsx webui/src/__tests__/connection-overview.test.tsx webui/src/__tests__/table-whitelist.test.tsx webui/src/__tests__/add-schema-drawer.test.tsx
git commit -m "feat(webui): promote ingest to first-class connection action"
```
