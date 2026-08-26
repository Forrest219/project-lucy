# WebUI Connection Whitelist And Test UX Refresh Design

| Metadata | Value |
|---|---|
| Document | WebUI Connection Whitelist And Test UX Refresh Design |
| Type | Incremental Design |
| Version | v0.1 |
| Date | 2026-07-26 |
| Author | Codex |
| Request | SaaS-grade closure for `/connections/whitelist` and `/connections/test` |
| Primary builder | Minimax |
| Status | Ready for Minimax implementation |
| Output | `webui/docs/11-connection-whitelist-test-ux-refresh.md` |

---

## 1. Decision Summary

This is the follow-up closure for the database access module after the deployment and connection overview refresh.

The implementation should upgrade two already implemented WebUI pages:

1. `/connections/whitelist`: table whitelist management for `ktx.yaml` `enabled_tables`.
2. `/connections/test`: connection test diagnostics for credentials, network, and driver setup.

The first implementation pass should stay frontend-first and reuse existing contracts where possible:

| Need | Existing source |
|---|---|
| connections, schemas, enabled tables, driver metadata | `GET /api/connections` |
| scanned table list by connection | `GET /api/connections/:connId/tables` |
| semantic source summaries, column counts, table descriptions, completion | `GET /api/sources` |
| dry-run YAML preview for `enabled_tables` | `PUT /api/connections/:connId/enabled-tables` with `dryRun: true` |
| persist `enabled_tables` | `PUT /api/connections/:connId/enabled-tables` with `dryRun: false` |
| trigger schema scan after whitelist save | `POST /api/connections/:connId/ingest` |
| run connection test | `POST /api/connections/:connId/test` |

Do not invent database health state. `/connections/test` should show "not tested" until the user runs a test in the current page session. `/connections/whitelist` should derive table semantic status from `enabledTables` plus `GET /api/sources`, not from raw connection metadata alone.

## 2. Spec Impact Assessment

| Spec | Assessment | Required update |
|---|---|---|
| `webui/docs/10-deployment-connection-ux-refresh.md` | Still valid for `/onboarding` and `/connections`. This spec extends the same database access workflow into the two child pages. | No rewrite. Treat this as M8 continuation. |
| `webui/docs/03-api-spec.md` | Current endpoints are sufficient for the frontend-first pass. | Update only if implementation adds richer table metadata to `/api/connections/:connId/tables` or structured diagnostics to connection test. |
| `webui/docs/04-data-model.md` | Existing `ConnectionInfo`, `SourceSummary`, and `ConnectionTestResult` cover the minimum product experience. | No required update for the first pass. |
| `docs/design-db-connection.md` | Still the database-connection source of truth. | Reference this spec for final WebUI interaction shape. |
| `docs/webui-feature-map.md` | Should list this as the completion pass for connection whitelist/test. | Update after the implementation plan is accepted or code lands. |

## 3. UX Principles

1. Admin pages should answer "what changed, what will be written, what happens next".
2. Whitelist state must be table-oriented, searchable, and reversible before write.
3. Console output belongs in diagnostics, not the primary success surface.
4. Green states must be backed by a real user-triggered test or persisted configuration.
5. Actions that write `ktx.yaml` should expose a dry-run preview before persistence.

## 4. `/connections/whitelist` Refresh

### 4.1 Problems To Fix

Current `TableWhitelist.tsx` is functional but reads like an internal utility:

- It renders a plain checkbox list for the active connection only.
- It lacks search, schema filtering, select-all and invert-selection tools.
- It does not show field count, table description, or semantic completion state.
- Save feedback is split between inline diff preview and separate scan action, so the user has to infer the full workflow.

### 4.2 Target Information Architecture

Use this page header:

```text
数据库接入 / 表白名单
表白名单
配置各连接进入语义层的表范围，并审阅保存前变更。
```

Primary layout:

1. Top toolbar: search, schema filter, selection summary.
2. Grouped table cards by connection and schema.
3. Sticky floating action bar when local selection differs from persisted `enabledTables`.
4. Dry-run YAML preview drawer.
5. Save-and-scan primary action.

### 4.3 Data Model For The Page

Build a normalized view model from existing API responses:

```ts
type WhitelistTableRow = {
  connectionId: string;
  schema: string;
  table: string;
  qualifiedName: string;
  enabledPersisted: boolean;
  enabledDraft: boolean;
  columnCount?: number;
  hasTableDesc?: boolean;
  completion?: CompletionStatus;
};
```

Mapping rules:

- `GET /api/connections/:connId/tables` returns `schema.table` strings for scanned physical tables.
- `GET /api/sources` provides semantic metadata keyed by `conn + schema + table`.
- `ConnectionInfo.enabledTables` is the persisted whitelist state.
- `enabledDraft` is local UI state. It starts equal to `enabledPersisted`.
- The page should support all configured connections. Fetch table lists for all connections with `useQueries`, or keep one active connection selector if the implementation wants a smaller first step. Preferred SaaS target: grouped all-connections view.

Optional backend enhancement:

- If performance becomes a problem, introduce `GET /api/connections/tables` returning all connection table inventories with semantic metadata already joined. This is not required for M8.

### 4.4 Toolbar

Toolbar requirements:

| Control | Behavior |
|---|---|
| Search input | Real-time filter by table name and available description text. Placeholder: `搜索表名/描述...` |
| Schema filter | Values: `全部 Schema`, then sorted unique schema names across visible connections. |
| Selection summary | `已勾选 X / Y 张表`; `Y` follows the current filter. |
| Select all visible | Check all rows matching current search/schema filters. |
| Invert visible | Toggle all rows matching current search/schema filters. |

Search should match:

- `schema.table`
- `table`
- semantic table description when `SourceSummary.hasTableDesc` can be turned into visible text in a later API enhancement

Because `SourceSummary` currently exposes only `hasTableDesc`, not the full description, M8 should search table names first and reserve description search as an enhancement unless a source detail fetch is added intentionally.

### 4.5 Grouped Data Table

Group display by `Connection: <id> · Schema: <schema>`.

Columns:

| Column | Source |
|---|---|
| checkbox | `enabledDraft` |
| 表名 (Table) | row `table` or `schema.table` when schema context is hidden |
| 字段数 | `SourceSummary.columnCount` when available; otherwise `-` |
| 状态 Badge | derived status below |
| 动作 | contextual action |

Status badges:

| Badge | Condition | Copy |
|---|---|---|
| Green | `enabledPersisted && SourceSummary.completion === "done"` | `已纳入` |
| Amber | `enabledDraft !== enabledPersisted` | `待同步` |
| Blue | `enabledPersisted && completion !== "done"` | `已启用，待补语义` |
| Gray | otherwise | `未启用` |

Action behavior:

| State | Action |
|---|---|
| enabled persisted | `查看语义`, link to the source detail page if route exists |
| enabled draft only | `待保存` disabled or secondary |
| disabled | `加入白名单`, toggles the checkbox |

### 4.6 Floating Action Bar

Show the floating bar only when the draft differs from persisted state.

Copy:

```text
变更未保存（新增 N 张表 / 移除 M 张表）
```

Actions:

| Button | Behavior |
|---|---|
| `重置` | Restore draft from persisted `enabledTables`, clear preview and scan log. |
| `预览 YAML` | Open a drawer and call dry-run `PUT /api/connections/:connId/enabled-tables`. |
| `保存并触发扫描` | Persist enabled tables, then call `POST /api/connections/:connId/ingest` for changed connections. |

Multi-connection rule:

- Current backend writes one connection at a time.
- If draft changes span multiple connections, save sequentially per changed connection and show per-connection progress.
- If implementation keeps one active connection selector in M8, document this as an explicit temporary scope and keep the UI copy singular.

### 4.7 Dry-Run YAML Drawer

The preview should be a right-side drawer, not a large inline block.

Content:

- Summary: `enabled_tables: oldCount -> newCount`
- Changed table chips grouped into `新增` and `移除`
- `DiffViewer` rendering `preview.diff`
- Optional raw proposed YAML collapse if `preview.proposedYaml` is useful for debugging

Rules:

- Preview must be generated from the current draft state.
- Preview errors must show a compact alert inside the drawer.
- Closing the drawer must not discard draft changes.

### 4.8 Save And Scan

Primary save action should perform a full workflow:

1. Persist changed `enabled_tables`.
2. Invalidate `connections` and `connectionTables` queries.
3. Trigger `ingest` for each successfully saved changed connection.
4. Show success/failure toast and retain a collapsible scan log.

If save succeeds but scan fails:

- Keep the saved whitelist state.
- Show `白名单已保存，扫描失败` with the raw ingest output available in a collapsed log.

## 5. `/connections/test` Refresh

### 5.1 Problems To Fix

Current `ConnectionTest.tsx` renders a result block that still feels like a developer console:

- Success/failure is visually represented by colored raw text panels.
- Driver/protocol/read-only metadata is not surfaced as structured facts.
- Raw `ktx connection test` output appears in the primary surface.

### 5.2 Target Information Architecture

Use this page header:

```text
数据库接入 / 连通测试
连通测试
测试数据库连通性，验证凭据、网络与驱动配置是否正确。
```

Primary layout:

1. Control bar: connection selector and `重新测试连接`.
2. Structured diagnostic panel.
3. Status banner.
4. Latency badge.
5. Three-cell metadata panel.
6. Collapsible raw diagnostics log.

### 5.3 Control Bar

Controls:

| Control | Behavior |
|---|---|
| Connection select | Values from `GET /api/connections`; changing it clears the current test result. |
| `重新测试连接` | Calls `POST /api/connections/:connId/test`; disabled while pending or no connection exists. |

If no connection exists, show a compact empty state with a link to `/connections`.

### 5.4 Structured Diagnostic Panel

States:

| State | Condition | Banner copy |
|---|---|---|
| Not tested | `result === null && !pending` | `尚未测试` |
| Testing | mutation pending | `正在测试连接...` |
| Passed | `result.status === "ok"` | `连接成功 (Connection Passed)` |
| Failed | `result.status === "error"` or API error | `连接失败 (Connection Failed)` |

Latency badge:

| Latency | Badge |
|---|---|
| `< 200 ms` | Green, `正常` |
| `200-1000 ms` | Amber, `偏慢` |
| `> 1000 ms` | Orange/red, `需关注` |
| missing | Gray, `未返回` |

Metadata panel:

| Cell | Source | Display |
|---|---|---|
| 数据库驱动 | `connection.driver` or `connection.engine` | e.g. `MySQL` |
| 传输协议 | `connection.wireProtocol` | `MySQL Wire`, `Postgres Wire`, `Native`, `Unknown` |
| 访问模式 | `connection.readOnlyExpected` | `Read-Only (受控访问)` or `未声明` |

Do not infer read-only from a successful connection test. Use only `readOnlyExpected` metadata.

### 5.5 Collapsible Logs

Default collapsed.

Header:

```text
原始诊断日志 (ktx connection test stdout/stderr)
```

Content:

- Show `stdout` and `stderr` in separate labeled blocks when available.
- If only `detail` or `reason` exists, show that in a single block.
- Redact nothing client-side except never adding secrets; backend already must not return credentials.
- Preserve whitespace with `pre` and cap max height.

## 6. Accessibility And Interaction Requirements

- All icon-only buttons need `aria-label`.
- Search input needs a visible or `aria-label` label.
- Floating action bar must be reachable by keyboard and should not cover focused table rows.
- Drawer close button must be keyboard accessible.
- Collapsible logs must expose `aria-expanded`.
- Status banners should use text plus color, never color only.

## 7. Test Strategy

Add focused Vitest + Testing Library coverage:

| Area | Test |
|---|---|
| whitelist toolbar | filters by table name and schema |
| whitelist selection | select all visible and invert visible update draft counts |
| whitelist statuses | renders `已纳入`, `待同步`, `已启用，待补语义`, `未启用` correctly |
| YAML preview | calls dry-run endpoint and opens drawer with diff summary |
| save-and-scan | persists enabled tables and then calls ingest |
| connection test states | not-tested, pending, success, failure |
| latency badge | green/amber/red labels at thresholds |
| metadata panel | renders driver, wire protocol, read-only expectation |
| logs | default collapsed and expands stdout/stderr |

Run at minimum:

```bash
cd webui
npm test -- --run src/__tests__/table-whitelist.test.tsx src/__tests__/connection-test.test.tsx
npm test -- --run src/__tests__/app-shell.test.tsx src/__tests__/connection-overview.test.tsx
```

## 8. Acceptance Criteria

- `/connections/whitelist` no longer renders a plain bare checkbox list as the primary experience.
- Users can filter by schema and search table names.
- Users can see selected/total counts, field counts when available, and semantic status badges.
- Any draft whitelist change reveals a floating action bar with reset, YAML preview, and save-and-scan actions.
- Dry-run preview happens before write and uses the existing backend dry-run response.
- `/connections/test` presents connection results as a SaaS diagnostic panel, with raw logs collapsed by default.
- Untested connections are not shown as successful.
- All new UI states are covered by tests.

## 9. Explicit Non-Goals

- No direct edits to `.ktx/secrets`.
- No automatic background connection test on page load.
- No production database writes.
- No new persisted connection-health history.
- No fake table descriptions when the API does not provide description text.
