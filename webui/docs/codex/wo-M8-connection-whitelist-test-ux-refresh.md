# WebUI Connection Whitelist And Test UX Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade `/connections/whitelist` and `/connections/test` into a complete SaaS-grade database access closure: searchable table whitelist with dry-run/save-and-scan workflow, and structured connection diagnostics with collapsed raw logs.

**Architecture:** Frontend-first refinement over existing WebUI contracts. Reuse `GET /api/connections`, `GET /api/connections/:connId/tables`, `GET /api/sources`, `PUT /api/connections/:connId/enabled-tables`, `POST /api/connections/:connId/ingest`, and `POST /api/connections/:connId/test`. Do not add backend fields unless a task explicitly marks them optional.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, Testing Library, existing `apiClient`, existing page CSS in `webui/src/app/app.css`.

---

## Context For Minimax

Read these files before coding:

- `webui/docs/11-connection-whitelist-test-ux-refresh.md`
- `webui/docs/10-deployment-connection-ux-refresh.md`
- `webui/docs/03-api-spec.md`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/pages/connections/ConnectionTest.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/components/DiffViewer.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`

Non-negotiable boundaries:

- Do not read or render `.ktx/secrets/**`.
- Do not show a connection as passed until `POST /api/connections/:connId/test` succeeds in the current page session.
- Do not fake table descriptions. If only `hasTableDesc` is available, show presence/completion, not invented text.
- Preserve the existing API envelope handling through `apiClient`.

## Task 1: Add Whitelist Page Tests

**Files:**

- Create or modify: `webui/src/__tests__/table-whitelist.test.tsx`

**Step 1: Build test harness**

Mock these endpoints:

- `GET /api/connections`
- `GET /api/connections/mysql-aliyun/tables`
- `GET /api/sources`
- `PUT /api/connections/mysql-aliyun/enabled-tables`
- `POST /api/connections/mysql-aliyun/ingest`

Use a fixture with:

```ts
connections: [{
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"]
}]
```

Tables:

```ts
[
  "dataforai.superstore_orders",
  "dataforai.superstore_people",
  "dataforai.superstore_returns"
]
```

Sources:

- `superstore_orders`: `columnCount: 8`, `completion: "done"`, `hasTableDesc: true`
- `superstore_people`: `columnCount: 2`, `completion: "partial"`, `hasTableDesc: false`
- `superstore_returns`: `columnCount: 3`, `completion: "not_started"`, `hasTableDesc: false`

**Step 2: Test toolbar and grouped table**

Assert:

```ts
expect(await screen.findByRole("heading", { name: "表白名单" })).toBeInTheDocument();
expect(screen.getByPlaceholderText("搜索表名/描述...")).toBeInTheDocument();
expect(screen.getByRole("combobox", { name: "Schema 筛选" })).toBeInTheDocument();
expect(screen.getByText("已勾选 2 / 3 张表")).toBeInTheDocument();
expect(screen.getByText("Connection: mysql-aliyun · Schema: dataforai")).toBeInTheDocument();
expect(screen.getByText("superstore_orders")).toBeInTheDocument();
expect(screen.getByText("8 个")).toBeInTheDocument();
expect(screen.getByText("已纳入")).toBeInTheDocument();
expect(screen.getByText("已启用，待补语义")).toBeInTheDocument();
expect(screen.getByText("未启用")).toBeInTheDocument();
```

**Step 3: Test search filtering**

Type `returns` into the search box and assert only `superstore_returns` remains visible. The selected count should become `已勾选 0 / 1 张表`.

**Step 4: Test visible selection tools**

Click `全选当前结果`, then assert:

```ts
expect(screen.getByText("已勾选 1 / 1 张表")).toBeInTheDocument();
expect(screen.getByText(/变更未保存/)).toBeInTheDocument();
expect(screen.getByText(/新增 1 张表/)).toBeInTheDocument();
```

Click `反选当前结果` and verify the visible row toggles back.

**Step 5: Test YAML preview drawer**

After adding `superstore_returns`, click `预览 YAML`.

Mock dry-run response:

```ts
{
  diff: "--- ktx.yaml\n+++ ktx.yaml\n@@\n+      - dataforai.superstore_returns\n",
  proposedYaml: "connections:\n  mysql-aliyun:\n    enabled_tables:\n      - dataforai.superstore_returns\n",
  oldEnabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people"],
  newEnabledTables: ["dataforai.superstore_orders", "dataforai.superstore_people", "dataforai.superstore_returns"]
}
```

Assert the drawer opens and shows:

- `enabled_tables: 2 -> 3`
- `dataforai.superstore_returns`
- a diff viewer

**Step 6: Test save-and-scan**

Click `保存并触发扫描`.

Assert:

```ts
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/connections/mysql-aliyun/enabled-tables"), expect.objectContaining({ method: "PUT" }));
expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/connections/mysql-aliyun/ingest"), expect.objectContaining({ method: "POST" }));
expect(await screen.findByText(/扫描完成|白名单已保存/)).toBeInTheDocument();
```

**Step 7: Run test and confirm it fails before implementation**

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx
```

Expected: fails because the upgraded UI does not exist yet.

## Task 2: Implement Whitelist View Model And Toolbar

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/lib/queryKeys.ts` if missing useful keys

**Step 1: Fetch required data**

Keep `GET /api/connections`. Add `GET /api/sources`.

For M8 preferred target, fetch `GET /api/connections/:connId/tables` for every connection with `useQueries`. If the implementation needs to stay single-connection for the first patch, keep the existing active connection selector but still add search/schema filtering and document the remaining multi-connection follow-up in comments/tests.

**Step 2: Build semantic lookup**

Create a map:

```ts
const semanticByQualifiedName = new Map(
  sources.map((s) => [`${s.conn}.${s.schema}.${s.table}`, s])
);
```

For table rows returned as `schema.table`, lookup with:

```ts
semanticByQualifiedName.get(`${connectionId}.${schema}.${table}`)
```

**Step 3: Track draft state per connection**

Use:

```ts
const [draftByConnection, setDraftByConnection] = useState<Record<string, string[]>>({});
```

Draft source:

```ts
const draft = draftByConnection[conn.id] ?? conn.enabledTables;
```

**Step 4: Add toolbar state**

Add:

```ts
const [search, setSearch] = useState("");
const [schemaFilter, setSchemaFilter] = useState("all");
```

Compute visible rows from search and schema. Match table and `schema.table`.

**Step 5: Add visible selection actions**

Implement:

- `selectAllVisible()`
- `invertVisible()`
- `resetDraft()`

Keep row order deterministic.

## Task 3: Implement Whitelist Data Table, Badges, And Floating Bar

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Replace bare checkbox list**

Render grouped sections:

```tsx
<section className="pl-table-group">
  <div className="pl-table-group-heading">Connection: mysql-aliyun · Schema: dataforai</div>
  <table className="pl-data-table">...</table>
</section>
```

Columns:

- checkbox
- `表名 (Table)`
- `字段数`
- `状态`
- `动作`

**Step 2: Add status helper**

```ts
function whitelistStatus(row: WhitelistTableRow) {
  if (row.enabledDraft !== row.enabledPersisted) return "pending";
  if (row.enabledPersisted && row.completion === "done") return "included";
  if (row.enabledPersisted) return "semantic_pending";
  return "disabled";
}
```

Map to labels:

- `included`: `已纳入`
- `pending`: `待同步`
- `semantic_pending`: `已启用，待补语义`
- `disabled`: `未启用`

**Step 3: Add row actions**

- `查看语义`: link to the source/table detail route when enabled and available.
- `加入白名单`: button toggles row on.
- `待保存`: disabled label/button for draft-only rows.

**Step 4: Add floating action bar**

Show only when any draft differs from persisted enabled tables.

Buttons:

- `重置`
- `预览 YAML`
- `保存并触发扫描`

Include copy:

```text
变更未保存（新增 N 张表 / 移除 M 张表）
```

**Step 5: Add CSS**

Add compact CSS utilities in `app.css` for:

- `.pl-whitelist-toolbar`
- `.pl-table-group`
- `.pl-data-table`
- `.pl-status-badge--included`
- `.pl-status-badge--pending`
- `.pl-status-badge--semantic-pending`
- `.pl-status-badge--disabled`
- `.pl-floating-action-bar`

Keep cards at `rounded-md` or less.

## Task 4: Implement YAML Preview Drawer And Save-And-Scan

**Files:**

- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Preview per changed connection**

Current backend previews one connection at a time. For M8:

- If only one connection changed, call dry-run for that connection.
- If multiple connections changed, either show a list of per-connection previews in the drawer or restrict M8 UI to one active connection. Preferred target is per-connection previews.

**Step 2: Drawer UI**

Use a right-side drawer:

```tsx
<aside className="pl-drawer" aria-label="YAML 预览">
  ...
</aside>
```

Show:

- `enabled_tables: old -> new`
- added/removed chips
- `DiffViewer`
- close button

**Step 3: Save-and-scan workflow**

Sequentially for each changed connection:

1. `PUT /api/connections/:connId/enabled-tables` with `dryRun: false`.
2. If write succeeds, `POST /api/connections/:connId/ingest`.
3. Store scan output in a collapsed log panel.

On partial failure, keep successful writes and show which connection failed.

**Step 4: Query invalidation**

Invalidate:

- `queryKeys.connections`
- `queryKeys.connectionTables(connId)`
- sources query key

## Task 5: Add Connection Test Page Tests

**Files:**

- Create or modify: `webui/src/__tests__/connection-test.test.tsx`

**Step 1: Build test harness**

Mock:

- `GET /api/connections`
- `POST /api/connections/mysql-aliyun/test`

Use fixture:

```ts
{
  id: "mysql-aliyun",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  readOnlyExpected: true,
  schemas: ["dataforai"],
  enabledTables: ["dataforai.superstore_orders"]
}
```

**Step 2: Test initial state**

Assert:

```ts
expect(await screen.findByRole("heading", { name: "连通测试" })).toBeInTheDocument();
expect(screen.getByRole("combobox", { name: "选择连接" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "重新测试连接" })).toBeInTheDocument();
expect(screen.getByText("尚未测试")).toBeInTheDocument();
expect(screen.queryByText("连接成功 (Connection Passed)")).not.toBeInTheDocument();
```

**Step 3: Test success state**

Mock response:

```ts
{
  status: "ok",
  latencyMs: 504,
  detail: "Status: ok\nDriver: mysql",
  stdout: "Status: ok\nDriver: mysql",
  stderr: ""
}
```

Click `重新测试连接`, then assert:

- `连接成功 (Connection Passed)`
- `响应延时: 504 ms`
- latency badge `偏慢`
- `数据库驱动` / `MySQL`
- `传输协议` / `MySQL Wire`
- `访问模式` / `Read-Only (受控访问)`
- raw logs are collapsed by default

**Step 4: Test log expansion**

Click `原始诊断日志 (ktx connection test stdout/stderr)` and assert `Status: ok` appears in a `pre`.

**Step 5: Test failure state**

Mock response:

```ts
{
  status: "error",
  latencyMs: 1200,
  reason: "Access denied",
  stdout: "",
  stderr: "Access denied"
}
```

Assert:

- `连接失败 (Connection Failed)`
- latency badge `需关注`
- collapsed raw log can expose `Access denied`

**Step 6: Run test and confirm it fails before implementation**

```bash
cd webui
npm test -- --run src/__tests__/connection-test.test.tsx
```

Expected: fails because the upgraded diagnostic panel does not exist yet.

## Task 6: Implement Connection Test Diagnostic Panel

**Files:**

- Modify: `webui/src/pages/connections/ConnectionTest.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Use shared ConnectionTestResult type**

Replace the local `TestResult` type with `ConnectionTestResult` from `webui/src/lib/types.ts`.

**Step 2: Add helpers**

```ts
function latencyTone(latencyMs?: number) {
  if (latencyMs === undefined) return { label: "未返回", tone: "muted" };
  if (latencyMs < 200) return { label: "正常", tone: "success" };
  if (latencyMs <= 1000) return { label: "偏慢", tone: "warning" };
  return { label: "需关注", tone: "danger" };
}

function protocolLabel(protocol?: string) {
  if (protocol === "mysql") return "MySQL Wire";
  if (protocol === "postgres") return "Postgres Wire";
  if (protocol === "native") return "Native";
  return "Unknown";
}
```

**Step 3: Update control bar**

Use label `重新测试连接`. Keep connection change clearing `result`.

**Step 4: Render diagnostic states**

Render one panel regardless of result:

- Not tested: `尚未测试`
- Testing: `正在测试连接...`
- Success: `连接成功 (Connection Passed)`
- Failure: `连接失败 (Connection Failed)`

Show latency row when testing completed.

**Step 5: Render metadata grid**

Use active connection metadata:

- Driver: uppercase friendly display for `driver` or `engine`
- Wire Protocol: helper mapping
- Access Mode: `Read-Only (受控访问)` when `readOnlyExpected === true`; otherwise `未声明`

**Step 6: Add collapsible logs**

Default closed.

Button:

```tsx
<button aria-expanded={logsExpanded}>原始诊断日志 (ktx connection test stdout/stderr)</button>
```

When expanded, render stdout/stderr/detail/reason in `pre` blocks.

**Step 7: Add CSS**

Add compact CSS for:

- `.pl-diagnostic-panel`
- `.pl-diagnostic-banner`
- `.pl-diagnostic-banner--success`
- `.pl-diagnostic-banner--danger`
- `.pl-latency-badge`
- `.pl-diagnostic-grid`
- `.pl-collapsible-log`

## Task 7: Full Verification

Run:

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx
npm test
```

If browser verification is available, start the app:

```bash
cd webui
npm run dev
```

Manually inspect:

- `http://127.0.0.1:5173/connections/whitelist`
- `http://127.0.0.1:5173/connections/test`

Check:

- no overlapping table/floating bar content on desktop and mobile widths
- drawer opens from the right and can close
- raw logs are collapsed by default
- disabled/no-connection states do not look broken

## Task 8: Commit

Stage only files touched for M8:

```bash
git add \
  webui/src/pages/connections/TableWhitelist.tsx \
  webui/src/pages/connections/ConnectionTest.tsx \
  webui/src/app/app.css \
  webui/src/lib/queryKeys.ts \
  webui/src/__tests__/table-whitelist.test.tsx \
  webui/src/__tests__/connection-test.test.tsx
```

Commit:

```bash
git commit -m "feat(webui): upgrade connection whitelist and diagnostics"
```

## Acceptance Checklist

- [ ] Whitelist page has search, schema filtering, visible selection tools, grouped table display, and status badges.
- [ ] Whitelist page shows a floating action bar only when draft state differs from persisted state.
- [ ] Dry-run YAML preview opens in a drawer and uses existing dry-run endpoint.
- [ ] Save action persists whitelist and triggers ingest.
- [ ] Connection test page has control bar, status banner, latency badge, metadata grid, and collapsed raw logs.
- [ ] Not-tested state is explicit and not green.
- [ ] Tests cover success, failure, draft, preview, save, and log expansion states.
- [ ] `npm test` passes.

