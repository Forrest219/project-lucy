# WebUI Deployment And Connection UX Refresh Design

| Metadata | Value |
|---|---|
| Document | WebUI Deployment And Connection UX Refresh Design |
| Type | Incremental Design |
| Version | v0.2 |
| Date | 2026-07-26 |
| Author | Codex |
| Request | PM review of deployment wizard and database connection overview UX |
| Primary builder | Minimax |
| Status | Ready for Minimax implementation |
| Output | `webui/docs/10-deployment-connection-ux-refresh.md` |

---

## 1. Decision Summary

Agree with the PM direction. This is a product workflow upgrade, not decorative UI polish.

The work should optimize two already implemented WebUI surfaces:

1. `/onboarding` deployment wizard / launch checklist.
2. `/connections` database connection overview, including Add Schema slide-over and Quick Start endpoint copy.

The implementation should not add new backend contracts in the first pass. Existing APIs already provide the required facts:

| Need | Existing source |
|---|---|
| KTX runtime availability | `GET /api/project.ktxAvailable` |
| connections, schema count, enabled tables | `GET /api/project.connections[]` |
| semantic table count and completion | `GET /api/sources.tables[]` |
| changed files / validation readiness | `GET /api/diff` |
| agent/token readiness | `GET /api/admin/agents` |
| add schema preview/write | `POST /api/connections/:connId/schemas` |
| ingest after schema add | `POST /api/connections/:connId/ingest` |

Do not claim live database connectivity unless the page has actually run `POST /api/connections/:connId/test` in the current session or a later backend status endpoint is introduced. Use `Unknown` or `Not tested` for untested state.

## 2. Spec Impact Assessment

| Spec | Assessment | Required update |
|---|---|---|
| `docs/design-webui-ui-refresh.md` | Still valid as the broad workbench UI direction. It already says high-frequency tool pages should avoid repeated long titles. | No rewrite. This incremental spec becomes the concrete implementation slice for `/onboarding` and `/connections`. |
| `docs/design-db-connection.md` | Still valid for database connection API and security boundaries. It does not cover the new PM-level connection-card visual language. | Reference this spec as the UX refresh for connection overview. No API change. |
| `docs/design-schema-onboarding.md` | Mostly aligned. It already designs Add Schema as a three-step drawer. Current implementation uses drawer behavior but modal CSS classes. | Treat this spec as the visual/interaction refinement: true right-side slide-over, clearer step states, less harsh error panel styling. |
| `docs/webui-feature-map.md` | Feature status is accurate, but the current gap list should point to the UX refresh. | Add this spec to the related docs / remaining focus list after implementation planning. |
| `webui/docs/03-api-spec.md` | No endpoint change required. | No update unless implementation later adds persisted connection status. |
| `webui/docs/04-data-model.md` | No model change required. | No update. |
| `docs/webui-impl-status.md` | Current feature state remains "implemented"; this work is an enhancement. | Update only after code lands, changing last reviewed date / tests if desired. |

## 3. UX Principles

1. One page, one primary job.
2. Metrics must describe different concepts, not compete with each other.
3. A green state must be backed by a real condition.
4. Copy actions should sit beside the thing being copied.
5. Drawer flows should preserve page context and show side effects before write.

## 4. Deployment Wizard Refresh

### 4.1 Problems To Fix

Current `webui/src/pages/Onboarding.tsx` repeats the module/page concept through app breadcrumbs, page eyebrow, H1, metric names, and section headers. It also presents:

- `Checklist 5/5` as launch readiness.
- `Semantic Tables 1/3` as "done / scanned".

These are both true, but together they read like a contradiction. Users can reasonably ask whether the system is ready or still incomplete.

### 4.2 Target Information Architecture

Keep a single page header:

```text
上线检查
检查 Lucy 是否已具备作为 MCP 服务平台交付给 Agent 使用的完整条件。
```

Remove the local eyebrow `部署向导` inside the page body. The app shell breadcrumb/navigation already carries module context.

Keep the existing right-side navigation actions, but prefer final delivery action when ready:

| State | Primary action | Secondary actions |
|---|---|---|
| `readyCount === 5` | Copy `.mcp.json` config | Agent settings, database connections |
| `readyCount < 5` | View blocking checklist item | Agent settings, database connections |

### 4.3 Metrics

Replace current metric labels with semantically aligned labels:

| Metric | Value | Hint | Visual |
|---|---|---|---|
| Deployment readiness | `${readyCount}/5` | `Ready` when 5, otherwise `${5 - readyCount} items remaining` | progress bar, green only at 5/5 |
| KTX Runtime | `Available` / `Unavailable` | project root | green/red status badge |
| Semantic coverage | `${doneSources}/${sources.length}` | `${percent}% maintained` | blue/amber progress, not red unless zero scanned |
| MCP access | `${enabledTokenCount}` | `${agents.length} agents · ${tokenCount} tokens` | green only when `mcpReady` |

Important: semantic coverage must not block deployment readiness unless product later decides that 100% semantic completion is a launch gate. The existing readiness definition is "at least one done semantic table", not "all scanned tables done".

### 4.4 Delivery Banner

Add a top banner below the page header and above metrics.

Ready state:

```text
Lucy MCP is ready for Agent delivery
Agent can connect through http://127.0.0.1:7879/mcp.
[Copy .mcp.json config] [View config]
```

Not-ready state:

```text
Finish N checklist items before Agent delivery
Next blocker: <first failing step title>.
[Open blocker]
```

Rules:

- The copy button uses the existing `buildMcpConfig(endpoint)` output.
- `View config` can expand/collapse the existing code snippet; it must not open a blocking modal.
- Clipboard failure must show a toast and leave visible config available.
- Use `127.0.0.1` in displayed endpoint/config for local delivery consistency unless existing runtime logic intentionally derives a different host. Current `defaultMcpEndpoint()` uses browser hostname; keep it if tests account for it.

### 4.5 Checklist Rows

Keep the five existing steps and readiness predicates:

| Step | Predicate |
|---|---|
| Connect database | `connections.length > 0 && project.ktxAvailable === true` |
| Limit table scope | total `enabledTables > 0` |
| Configure semantic layer | `sources.length > 0 && doneSources > 0` |
| Validate and review | `changedFiles.length === 0` |
| Configure Agent MCP | `mcpAccessReason(...) === undefined` |

Change row copy so Step 3 explicitly says partial semantic completion can still be a follow-up:

```text
补齐至少一张核心表的业务语义；其余扫描表可作为后续维护队列继续完善。
```

## 5. Connection Overview Refresh

### 5.1 Problems To Fix

Current `ConnectionOverview.tsx` has five metric cards, but the cards mainly show counts. Their management meaning is implicit, so an admin can see "what number changed" but not "what question this number answers" or "what healthy looks like".

The updated PM decision is to keep five metric cards and add micro-explanations through card-level Tooltip name cards. This supersedes the earlier four-card recommendation in v0.1 of this spec.

The current Add Schema component is functionally a drawer but visually uses centered modal CSS classes.

### 5.2 Five Metric Cards With Metadata

Use exactly five top metrics:

| Metric key | Title | Value | Hint |
|---|---|---|---|
| `connections` | 数据连接 | `connections.length` | `${schemaCount} 个 schema` or `未配置 schema` |
| `enabledTables` | 启用的表 | `enabledTableCount` | `来自 ktx.yaml enabled_tables` |
| `semanticTables` | 语义层对象 | `semanticTableCount` | `已进入 semantic-layer 的表` |
| `semanticSources` | 语义源 | `semanticSourceCount` | `按 connection/schema 聚合` |
| `ktxRuntime` | `KTX Runtime` | `可用` / `不可用` | `v1.x` only if version is actually available; otherwise project root |

If no KTX CLI version is exposed, do not hardcode `v1.2`.

### 5.3 Metric Metadata Constants

Create `webui/src/pages/connections/constants.ts`:

```ts
export interface MetricMeta {
  title: string;
  description: string;
  question: string;
  healthyRule: string;
}

export const METRIC_METADATA: Record<string, MetricMeta> = {
  connections: {
    title: "数据连接",
    description: "打通的物理数据库数量，决定跨库联合查询的基础范围。",
    question: "打通了多少个物理数据源？数据孤岛破除了多少？",
    healthyRule: "至少包含 1 个生产/测试数据库",
  },
  enabledTables: {
    title: "启用的表",
    description: "贯彻最小权限原则，显式授权给 Agent / ChatBI 触达的白名单表。",
    question: "在数仓数千张表中，允许 AI 访问的边界在哪里？",
    healthyRule: "按需授权，严禁无脑全量放行（防数据越权与幻觉）",
  },
  semanticTables: {
    title: "语义层对象",
    description: "已补齐字段描述、业务口径与主外键关系的“机读”资产数量。",
    question: "授权的表里，真正被 AI 看懂、查准的数据有多少？",
    healthyRule: "转化率 (Semantic / Enabled) ≥ 80%",
  },
  semanticSources: {
    title: "语义源",
    description: "按 connection/schema 聚合的主题域概览。",
    question: "资产是否形成了高内聚的主题域（如财务域、销售域）？",
    healthyRule: "资产清晰归域名，避免散兵游勇式摆放",
  },
  ktxRuntime: {
    title: "KTX Runtime",
    description: "底层语义编译与计算引擎的运行状态。",
    question: "语义编译与查询底座是否健康可用？",
    healthyRule: "状态保持可用，服务未挂载时及时预警",
  },
};

export type MetricType = keyof typeof METRIC_METADATA;
```

Keep these constants page-local for now. Do not put them in `webui/src/lib/types.ts`, because this is product copy / UX metadata rather than API data model.

### 5.4 Metric Card Tooltip Component

Create `webui/src/pages/connections/MetricCard.tsx`. The repo already depends on `@radix-ui/react-tooltip`, but does not currently include `lucide-react` or shadcn/ui. Do not add a dependency just for the info icon. Use an accessible text icon button (`ⓘ`) or a tiny CSS-only glyph.

```tsx
import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { METRIC_METADATA, type MetricType } from "./constants";

type MetricCardProps = {
  type: MetricType;
  value: ReactNode;
  subValue?: ReactNode;
};

export function MetricCard({ type, value, subValue }: MetricCardProps) {
  const meta = METRIC_METADATA[type];

  return (
    <div className="pl-metric-card pl-metric-card--with-help" data-testid="connection-metric">
      <div className="pl-metric-card-title">
        <span>{meta.title}</span>
        <Tooltip.Provider delayDuration={200}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className="pl-icon-help"
                aria-label={`${meta.title} 管理含义`}
              >
                ⓘ
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="pl-metric-tooltip" side="top" sideOffset={8}>
                <p className="pl-metric-tooltip-title">{meta.title} · 管理含义</p>
                <div>
                  <span>关注问题：</span>
                  <p>{meta.question}</p>
                </div>
                <div>
                  <span>定义：</span>
                  <p>{meta.description}</p>
                </div>
                <div className="pl-metric-tooltip-rule">
                  <span>健康标准：</span>
                  {meta.healthyRule}
                </div>
                <Tooltip.Arrow className="pl-metric-tooltip-arrow" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
      <strong>{value}</strong>
      {subValue ? <small>{subValue}</small> : null}
    </div>
  );
}
```

CSS additions:

```css
.pl-metric-card--with-help { @apply gap-2; }
.pl-metric-card-title { @apply flex items-center justify-between gap-2 text-xs font-medium text-fg-muted; }
.pl-icon-help { @apply inline-flex size-6 items-center justify-center rounded-sm text-xs text-fg-muted transition-colors; }
.pl-icon-help:hover { @apply bg-bg-muted text-fg-default; }
.pl-icon-help:focus-visible { @apply outline-none ring-2 ring-primary; }
.pl-metric-tooltip { @apply z-50 grid max-w-xs gap-2 rounded-md border border-border-default bg-bg-elevated p-3 text-xs text-fg-default shadow-lg; }
.pl-metric-tooltip-title { @apply border-b border-border-default pb-1 font-semibold; }
.pl-metric-tooltip span { @apply font-medium text-fg-muted; }
.pl-metric-tooltip-rule { @apply rounded-sm bg-bg-muted p-2 text-[11px]; }
.pl-metric-tooltip-rule span { @apply text-success-strong; }
.pl-metric-tooltip-arrow { @apply fill-bg-elevated; }
```

Tests should assert Tooltip content appears after hover/focus on the info button. Testing Library can trigger `fireEvent.pointerOver(...)` or focus the trigger; prefer a test that does not depend on exact portal DOM placement beyond visible text.

### 5.5 Connection Cards

Each connection row/card should show:

| Element | Source | Rule |
|---|---|---|
| engine badge | `conn.engine ?? conn.driver` | render icon-like text badge, not emoji-only |
| connection id | `conn.id` | primary label |
| connectivity status | current page state | `Not tested` by default; `Connected`/`Disconnected` after explicit test |
| driver/wire | `driver`, `wireProtocol` | compact metadata |
| read-only risk | `readOnlyExpected` | show `Read-only expected` or `Write risk` |
| schemas | `conn.schemas` | truncate long list with title/tooltip if needed |
| enabled tables | `conn.enabledTables.length` | link to whitelist |
| actions | existing routes/mutations | Add schema, whitelist, test |

Engine badge mapping:

| Engine / driver | Badge |
|---|---|
| mysql | `MySQL` |
| postgres | `Postgres` |
| doris | `Doris` |
| starrocks | `StarRocks` |
| unknown | `DB` |

Do not use emoji as the only identifier. It is acceptable to add an emoji as decoration, but tests should assert text labels.

### 5.6 Connectivity Status

The PM asks for "real-time connected lamp". The first implementation should reject fake real-time status.

Implement session-local explicit test state:

```ts
type ConnectionTestUiState =
  | { status: "unknown" }
  | { status: "testing" }
  | { status: "connected"; latencyMs?: number }
  | { status: "disconnected"; reason?: string };
```

Use `POST /api/connections/:connId/test` when the user clicks a test action on a connection card. If current `ConnectionTest` page already has helper code, extract a small shared helper only if it avoids duplication without widening scope.

Initial card state must read `Not tested`, not `Connected`.

### 5.7 Add Schema Slide-Over

Keep `AddSchemaDrawer.tsx` as the component and refine it:

- Replace centered `.pl-modal-backdrop` / `.pl-modal-panel` usage with slide-over classes:
  - `.pl-drawer-backdrop`
  - `.pl-drawer-panel`
  - `.pl-drawer-header`
  - `.pl-drawer-body`
  - `.pl-drawer-footer`
- Panel anchors to the right, max width 560px, full viewport height.
- Mobile: full width, still anchored right.
- Keep three steps: input, preview, success.
- Rename the step labels to match side effects:
  1. Input schema
  2. Test and preview
  3. Confirm and ingest
- Error panels should use bordered soft surfaces, not raw red text blocks.
- `CONNECTION_TEST_FAILED` detail should be collapsed by default with a "Show ktx output" button.
- `KTX_YAML_PARSE_ERROR` remains fatal and disables confirm.

No backend change is required.

### 5.8 Quick Start Copy

Add inline copy for the MCP endpoint in Quick Start:

```text
MCP endpoint
http://127.0.0.1:7879/mcp [Copy]
```

Rules:

- Copy only the endpoint string, not the full `.mcp.json`.
- Use a text/icon button with accessible label `复制 MCP endpoint`.
- On success, toast `MCP endpoint 已复制`.
- On failure, toast the error message.

## 6. Implementation Scope

### In Scope

- `webui/src/pages/Onboarding.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/constants.ts`
- `webui/src/pages/connections/MetricCard.tsx`
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/app/app.css`
- Focused tests:
  - `webui/src/__tests__/onboarding.test.tsx`
  - `webui/src/__tests__/connection-overview.test.tsx`
  - `webui/src/__tests__/add-schema-drawer.test.tsx`

### Out Of Scope

- New connection creation.
- Secret management.
- Persisted or polled database health status.
- API changes to `GET /api/connections`.
- Editing `ktx.yaml` beyond existing add-schema / enabled-tables flows.
- Changing MCP proxy behavior.

## 7. Acceptance Criteria

### Deployment Wizard

- Page body contains one visible `上线检查` H1.
- Local `部署向导` eyebrow is removed from page body.
- Metric labels are `Deployment readiness`, `KTX Runtime`, `Semantic coverage`, `MCP access` or the approved Chinese equivalents.
- `5/5` readiness and `1/3` semantic coverage are shown as different concepts.
- Ready banner appears when all five readiness predicates are true.
- Ready banner can copy `.mcp.json` config.
- Not-ready banner shows remaining item count and first blocker.
- Existing five-step navigation remains available.

### Connection Overview

- Top metric grid renders exactly five cards: 数据连接、启用的表、语义层对象、语义源、KTX Runtime.
- Every metric card has an accessible `ⓘ` help trigger.
- Hovering or focusing each help trigger shows a structured Tooltip with "关注问题", "定义", and "健康标准".
- KTX Runtime appears in the metric grid, not as a separate floating row.
- Connection cards show engine badge text, id, driver/wire, read-only status, schemas, enabled table count, and actions.
- Connectivity state starts as `Not tested`.
- Running a connection test transitions through `Testing` to `Connected` or `Disconnected`.
- Quick Start MCP endpoint has a one-click copy button.
- Add Schema opens as a right-side slide-over, not a centered modal.

### Tests And Quality

- Existing unit tests pass.
- New tests cover ready/not-ready onboarding banner.
- New tests cover semantic coverage label and percent.
- New tests cover five-card connection metrics and Tooltip metadata.
- New tests cover endpoint copy.
- New tests cover connection card test success/failure state.
- Add Schema drawer tests still cover input validation, preview, confirm, fatal YAML error, and ingest action.

## 8. Recommended Development Order

1. Update tests for onboarding semantics and delivery banner.
2. Implement onboarding metric helpers and banner.
3. Update connection overview tests for five metrics, Tooltip metadata, and endpoint copy.
4. Implement connection overview metric metadata, `MetricCard`, card layout, and session-local connection test state.
5. Update Add Schema drawer tests for slide-over classes and softer errors.
6. Implement drawer CSS and markup changes.
7. Run targeted Vitest, then full WebUI test/build.

## 9. Self-Test Commands

Run from `webui/`:

```bash
npm test -- --run src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/add-schema-drawer.test.tsx
npm test -- --run
npm run build
```

If visual QA is available:

```bash
npm run dev
```

Then inspect:

- `http://127.0.0.1:5173/onboarding`
- `http://127.0.0.1:5173/connections`

Use desktop and mobile widths. Verify no text overlap, no centered Add Schema modal, and no fake green connected state before testing.
