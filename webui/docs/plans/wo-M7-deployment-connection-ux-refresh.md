# WebUI Deployment And Connection UX Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the WebUI deployment wizard and connection overview so Minimax can deliver the PM-approved readiness, copy, connection-card, and Add Schema slide-over experience with focused tests.

**Architecture:** This is a frontend-first refinement over existing WebUI contracts. Reuse `GET /api/project`, `GET /api/sources`, `GET /api/diff`, `GET /api/admin/agents`, `POST /api/connections/:connId/test`, and the existing Add Schema endpoints; do not add backend fields or fake live connection status.

**Tech Stack:** React, TypeScript, TanStack Query, Radix Tooltip (`@radix-ui/react-tooltip`), Vitest, Testing Library, Tailwind utility classes through `webui/src/app/app.css`, existing `apiClient`.

---

## Context For Minimax

Read these files before coding:

- `webui/docs/10-deployment-connection-ux-refresh.md`
- `docs/design-webui-ui-refresh.md`
- `docs/design-db-connection.md`
- `docs/design-schema-onboarding.md`
- `webui/src/pages/Onboarding.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/connections/constants.ts` (create)
- `webui/src/pages/connections/MetricCard.tsx` (create)
- `webui/src/components/AddSchemaDrawer.tsx`
- `webui/src/app/app.css`
- `webui/src/__tests__/onboarding.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/add-schema-drawer.test.tsx`

Non-negotiable boundary: an untested connection must render `Not tested`, not `Connected`.

## Task 1: Onboarding Readiness Semantics And Banner Tests

**Files:**
- Modify: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Add test for ready delivery banner**

Extend the existing happy-path test to assert:

```ts
expect(await screen.findByRole("heading", { name: "上线检查" })).toBeInTheDocument();
expect(screen.getByText("Deployment readiness")).toBeInTheDocument();
expect(screen.getByText("Semantic coverage")).toBeInTheDocument();
expect(screen.getByText("Lucy MCP is ready for Agent delivery")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /Copy .*mcp\.json config|复制 .*mcp\.json 配置/i })).toBeInTheDocument();
expect(screen.queryByText("Semantic Tables")).not.toBeInTheDocument();
expect(screen.queryByText("Checklist")).not.toBeInTheDocument();
```

**Step 2: Add test for not-ready blocker banner**

Render with no agents and assert:

```ts
expect(await screen.findByText(/还差|Finish/)).toBeInTheDocument();
expect(screen.getByText("尚未创建 Agent")).toBeInTheDocument();
```

**Step 3: Run test to verify it fails**

Run from `webui/`:

```bash
npm test -- --run src/__tests__/onboarding.test.tsx
```

Expected: fails because labels/banner do not exist yet.

## Task 2: Implement Onboarding Refresh

**Files:**
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Add small helpers**

In `Onboarding.tsx`, add helpers near `defaultMcpEndpoint()`:

```ts
function percent(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

function firstBlockingStep(steps: Array<{ title: string; ready: boolean; reason?: string }>) {
  return steps.find((step) => !step.ready);
}
```

**Step 2: Convert readiness predicates into an array**

After predicate calculation, add:

```ts
const checklistSteps = [
  { title: "接入数据库", ready: connectionReady, to: "/connections" },
  { title: "限定表范围", ready: tableScopeReady, to: "/connections/whitelist" },
  { title: "配置语义层", ready: semanticReady, to: "/" },
  { title: "校验并审阅变更", ready: validationReady, to: "/review" },
  { title: "配置 Agent MCP", ready: mcpReady, reason: mcpNotReadyReason, to: "/admin/agents" }
];
const readyCount = checklistSteps.filter((step) => step.ready).length;
const blocker = firstBlockingStep(checklistSteps);
const semanticPercent = percent(doneSources, sources.length);
```

Remove the old `readyCount` calculation to avoid duplicate facts.

**Step 3: Replace page heading**

Remove the local `pl-eyebrow` text `部署向导`. Keep one H1:

```tsx
<h1 className="text-xl font-semibold">上线检查</h1>
```

**Step 4: Add delivery banner**

Add a banner between heading and metric grid:

```tsx
<section className={readyCount === 5 ? "pl-delivery-banner pl-delivery-banner--ready" : "pl-delivery-banner"}>
  {readyCount === 5 ? (
    <>
      <div>
        <strong>Lucy MCP is ready for Agent delivery</strong>
        <span>Agent can connect through {endpoint}.</span>
      </div>
      <button type="button" className="pl-btn pl-btn--primary" onClick={copyConfig}>
        {copied ? "已复制 .mcp.json" : "复制 .mcp.json 配置"}
      </button>
    </>
  ) : (
    <>
      <div>
        <strong>还差 {5 - readyCount} 项即可交付</strong>
        <span>下一项：{blocker?.reason ?? blocker?.title ?? "继续检查配置"}</span>
      </div>
      {blocker ? <Link className="pl-btn pl-btn--secondary" to={blocker.to}>打开阻塞项</Link> : null}
    </>
  )}
</section>
```

**Step 5: Replace metric cards**

Use four cards:

```tsx
<div className="pl-metric-card">
  <span>Deployment readiness</span>
  <strong>{readyCount}/5</strong>
  <small>{readyCount === 5 ? "Ready" : `${5 - readyCount} items remaining`}</small>
  <div className="pl-progress"><i style={{ width: `${(readyCount / 5) * 100}%` }} /></div>
</div>
```

Add matching cards for `KTX Runtime`, `Semantic coverage`, and `MCP access`.

**Step 6: Update semantic step copy**

Change Step 3 description to:

```text
补齐至少一张核心表的业务语义；其余扫描表可作为后续维护队列继续完善。
```

**Step 7: Add CSS**

In `app.css`, add:

```css
.pl-delivery-banner { @apply flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-default bg-bg-surface p-4; }
.pl-delivery-banner > div { @apply grid gap-1; }
.pl-delivery-banner strong { @apply text-sm font-semibold; }
.pl-delivery-banner span { @apply text-sm text-fg-muted; }
.pl-delivery-banner--ready { @apply border-success-strong bg-success-soft; }
.pl-progress { @apply mt-2 h-1.5 overflow-hidden rounded-pill bg-bg-muted; }
.pl-progress i { @apply block h-full rounded-pill bg-primary; }
```

**Step 8: Run test**

```bash
npm test -- --run src/__tests__/onboarding.test.tsx
```

Expected: pass.

**Step 9: Commit**

```bash
git add webui/src/pages/Onboarding.tsx webui/src/app/app.css webui/src/__tests__/onboarding.test.tsx
git commit -m "feat(webui): clarify onboarding readiness delivery"
```

## Task 3: Connection Overview Metric Metadata Tests

**Files:**
- Modify: `webui/src/__tests__/connection-overview.test.tsx`
- Create: `webui/src/pages/connections/constants.ts`
- Create: `webui/src/pages/connections/MetricCard.tsx`

**Step 1: Update metric assertions**

Preferred implementation: add `data-testid="connection-metric"` to each metric card, then test:

```ts
expect(screen.getAllByTestId("connection-metric")).toHaveLength(5);
expect(screen.getByText("数据连接")).toBeInTheDocument();
expect(screen.getByText("启用的表")).toBeInTheDocument();
expect(screen.getByText("语义层对象")).toBeInTheDocument();
expect(screen.getByText("语义源")).toBeInTheDocument();
expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
```

**Step 2: Add metric Tooltip assertions**

For the `数据连接` card, hover or focus its help trigger and assert:

```ts
fireEvent.focus(screen.getByRole("button", { name: "数据连接 管理含义" }));
expect(await screen.findByText("数据连接 · 管理含义")).toBeInTheDocument();
expect(screen.getByText("关注问题：")).toBeInTheDocument();
expect(screen.getByText("打通了多少个物理数据源？数据孤岛破除了多少？")).toBeInTheDocument();
expect(screen.getByText("定义：")).toBeInTheDocument();
expect(screen.getByText("打通的物理数据库数量，决定跨库联合查询的基础范围。")).toBeInTheDocument();
expect(screen.getByText("健康标准：")).toBeInTheDocument();
expect(screen.getByText("至少包含 1 个生产/测试数据库")).toBeInTheDocument();
```

Add one compact loop to ensure every metric has a help trigger:

```ts
for (const label of ["数据连接", "启用的表", "语义层对象", "语义源", "KTX Runtime"]) {
  expect(screen.getByRole("button", { name: `${label} 管理含义` })).toBeInTheDocument();
}
```

**Step 3: Add endpoint copy test**

Stub clipboard:

```ts
const writeText = vi.fn(async () => undefined);
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
```

Click:

```ts
fireEvent.click(screen.getByRole("button", { name: "复制 MCP endpoint" }));
expect(writeText).toHaveBeenCalledWith("http://127.0.0.1:7879/mcp");
```

**Step 4: Add connection status tests**

Initial state:

```ts
expect(await screen.findByText("Not tested")).toBeInTheDocument();
expect(screen.queryByText("Connected")).not.toBeInTheDocument();
```

Success mock for `POST /api/connections/mysql-aliyun/test`:

```ts
return new Response(JSON.stringify({ ok: true, data: { exitCode: 0, stdout: "ok", stderr: "" } }));
```

Click the card test button and expect `Connected`.

Failure mock:

```ts
return new Response(JSON.stringify({ ok: true, data: { exitCode: 1, stdout: "", stderr: "denied" } }));
```

Click the card test button and expect `Disconnected`.

**Step 5: Run test to verify it fails**

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: fails because the implementation does not yet have metric metadata constants, Tooltip help triggers, endpoint copy, or card-level test state.

## Task 4: Implement Connection Overview Refresh

**Files:**
- Create: `webui/src/pages/connections/constants.ts`
- Create: `webui/src/pages/connections/MetricCard.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Add metric metadata constants**

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

Do not put this copy in `webui/src/lib/types.ts`; it is page-level UX metadata, not an API type.

**Step 2: Add MetricCard component**

Create `webui/src/pages/connections/MetricCard.tsx` using Radix Tooltip. The repo has `@radix-ui/react-tooltip` but not `lucide-react`, so use a text `ⓘ` trigger:

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
              <button type="button" className="pl-icon-help" aria-label={`${meta.title} 管理含义`}>
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

**Step 3: Import mutation, toast, and MetricCard**

Add:

```ts
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { MetricCard } from "./MetricCard";
import type { IngestResult } from "../../lib/types";
```

Adjust existing imports rather than duplicating them.

**Step 4: Add endpoint and status state**

Near component state:

```ts
const endpoint = "http://127.0.0.1:7879/mcp";
const [testStates, setTestStates] = useState<Record<string, "unknown" | "testing" | "connected" | "disconnected">>({});
```

**Step 5: Add test mutation**

```ts
const testMutation = useMutation({
  mutationFn: (connId: string) =>
    apiPost<IngestResult>(`/api/connections/${encodeURIComponent(connId)}/test`, {}),
  onMutate: (connId) => {
    setTestStates((prev) => ({ ...prev, [connId]: "testing" }));
  },
  onSuccess: (data, connId) => {
    setTestStates((prev) => ({ ...prev, [connId]: data.exitCode === 0 ? "connected" : "disconnected" }));
  },
  onError: (_error, connId) => {
    setTestStates((prev) => ({ ...prev, [connId]: "disconnected" }));
  }
});
```

**Step 6: Add copy endpoint helper**

```ts
async function copyEndpoint() {
  try {
    await navigator.clipboard.writeText(endpoint);
    toast.success("MCP endpoint 已复制");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "复制失败");
  }
}
```

**Step 7: Render exactly five metadata-backed metrics**

Remove the local `KpiTile` helper or leave it unused only temporarily while refactoring. Render metrics through `MetricCard`:

```tsx
<div className="pl-metric-grid">
  <MetricCard
    type="connections"
    value={connections.length}
    subValue={schemaCount > 0 ? `${schemaCount} 个 schema` : "未配置 schema"}
  />
  <MetricCard
    type="enabledTables"
    value={enabledTableCount}
    subValue="来自 ktx.yaml enabled_tables"
  />
  <MetricCard
    type="semanticTables"
    value={semanticTableCount}
    subValue="已进入 semantic-layer 的表"
  />
  <MetricCard
    type="semanticSources"
    value={semanticSourceCount}
    subValue="按 connection/schema 聚合"
  />
  <MetricCard
    type="ktxRuntime"
    value={projectQuery.data?.ktxAvailable ? "可用" : "不可用"}
    subValue={projectQuery.data?.root ?? "项目根目录未知"}
  />
</div>
```

**Step 8: Replace connection row content**

For each connection:

```tsx
const state = testStates[conn.id] ?? "unknown";
const statusLabel =
  state === "unknown" ? "Not tested" :
  state === "testing" ? "Testing" :
  state === "connected" ? "Connected" :
  "Disconnected";
```

Render engine badge text and status:

```tsx
<span className="pl-engine-badge">{engineLabel(conn.engine ?? conn.driver)}</span>
<strong>{conn.id}</strong>
<span className={`pl-connection-status pl-connection-status--${state}`}>{statusLabel}</span>
```

Add action:

```tsx
<button type="button" className="pl-btn pl-btn--secondary" onClick={() => testMutation.mutate(conn.id)}>
  测试连接
</button>
```

Add a small helper:

```ts
function engineLabel(engine?: string) {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "MySQL";
  if (normalized === "postgres" || normalized === "postgresql") return "Postgres";
  if (normalized === "doris") return "Doris";
  if (normalized === "starrocks") return "StarRocks";
  return "DB";
}
```

**Step 9: Add Quick Start copy button**

Inside the MCP endpoint snippet:

```tsx
<div className="pl-copy-line">
  <code>{endpoint}</code>
  <button type="button" className="pl-btn pl-btn--ghost" aria-label="复制 MCP endpoint" onClick={copyEndpoint}>复制</button>
</div>
```

**Step 10: Add CSS**

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
.pl-engine-badge { @apply inline-flex w-fit items-center rounded-sm border border-border-default bg-bg-muted px-2 py-0.5 text-xs font-medium text-fg-default; }
.pl-connection-status { @apply inline-flex w-fit items-center rounded-pill px-2 py-0.5 text-xs font-medium; }
.pl-connection-status--unknown { @apply bg-bg-muted text-fg-muted; }
.pl-connection-status--testing { @apply bg-warning-soft text-warning-strong; }
.pl-connection-status--connected { @apply bg-success-soft text-success-strong; }
.pl-connection-status--disconnected { @apply bg-danger-soft text-danger-strong; }
.pl-copy-line { @apply flex items-center justify-between gap-2; }
.pl-copy-line code { @apply min-w-0 flex-1 break-all; }
```

**Step 11: Run test**

```bash
npm test -- --run src/__tests__/connection-overview.test.tsx
```

Expected: pass.

**Step 12: Commit**

```bash
git add webui/src/pages/connections/constants.ts webui/src/pages/connections/MetricCard.tsx webui/src/pages/connections/ConnectionOverview.tsx webui/src/app/app.css webui/src/__tests__/connection-overview.test.tsx
git commit -m "feat(webui): refine connection overview delivery controls"
```

## Task 5: Add Schema Slide-Over Tests

**Files:**
- Modify: `webui/src/__tests__/add-schema-drawer.test.tsx`

**Step 1: Assert slide-over classes**

```ts
expect(screen.getByTestId("add-schema-drawer")).toHaveClass("pl-drawer-panel");
```

**Step 2: Assert side-effect step labels**

Use English or approved Chinese labels:

```ts
expect(screen.getByText("1. Input schema")).toBeInTheDocument();
expect(screen.getByText("2. Test and preview")).toBeInTheDocument();
expect(screen.getByText("3. Confirm and ingest")).toBeInTheDocument();
```

**Step 3: Assert connection-test error has collapsible output**

Mock `CONNECTION_TEST_FAILED`, click preview, then expect:

```ts
expect(await screen.findByRole("button", { name: /Show ktx output|查看 ktx 输出/ })).toBeInTheDocument();
```

**Step 4: Run test to verify it fails**

```bash
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: fails because current drawer uses modal classes and raw error output.

## Task 6: Implement Add Schema Slide-Over Refinement

**Files:**
- Modify: `webui/src/components/AddSchemaDrawer.tsx`
- Modify: `webui/src/app/app.css`

**Step 1: Replace wrapper classes**

Change:

```tsx
<div className="pl-modal-backdrop" ...>
  <div className="pl-modal-panel" data-testid="add-schema-drawer">
```

To:

```tsx
<div className="pl-drawer-backdrop" ...>
  <div className="pl-drawer-panel" data-testid="add-schema-drawer">
```

**Step 2: Update step labels**

Use:

```ts
["Input schema", "Test and preview", "Confirm and ingest"]
```

or approved Chinese labels:

```ts
["输入 Schema", "测试并预览", "确认并 ingest"]
```

**Step 3: Soften error panel**

Inside `ErrorPanel`, add:

```ts
const [expanded, setExpanded] = useState(false);
```

For `CONNECTION_TEST_FAILED`, render a bordered soft panel and collapse JSON details behind a button.

**Step 4: Add drawer CSS**

```css
.pl-drawer-backdrop { @apply fixed inset-0 z-50 flex justify-end bg-fg-default/40; }
.pl-drawer-panel { @apply h-full w-full max-w-xl overflow-auto bg-bg-surface p-6 shadow-lg; }
.pl-drawer-error { @apply rounded-md border border-danger-strong bg-danger-soft p-3 text-xs text-danger-strong; }
.pl-drawer-error pre { @apply mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-surface p-2 text-fg-default; }
```

Keep existing `.pl-modal-*` classes for other admin modals.

**Step 5: Run test**

```bash
npm test -- --run src/__tests__/add-schema-drawer.test.tsx
```

Expected: pass.

**Step 6: Commit**

```bash
git add webui/src/components/AddSchemaDrawer.tsx webui/src/app/app.css webui/src/__tests__/add-schema-drawer.test.tsx
git commit -m "feat(webui): present add schema as slide-over"
```

## Task 7: Full Verification

**Files:**
- No code changes expected.

**Step 1: Run targeted tests**

```bash
npm test -- --run src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/add-schema-drawer.test.tsx
```

Expected: all pass.

**Step 2: Run full WebUI tests**

```bash
npm test -- --run
```

Expected: all pass.

**Step 3: Run build**

```bash
npm run build
```

Expected: TypeScript and Vite build pass.

**Step 4: Manual smoke**

```bash
npm run dev
```

Open:

- `http://127.0.0.1:5173/onboarding`
- `http://127.0.0.1:5173/connections`

Verify:

- one visible onboarding H1 in the page body.
- no contradiction between deployment readiness and semantic coverage.
- ready/not-ready banner copy is visible.
- connection page has five metrics.
- each connection metric has an `ⓘ` help trigger with management meaning.
- untested connections say `Not tested`.
- Add Schema opens from the right.
- endpoint copy and `.mcp.json` copy show toast feedback.
- mobile width has no text overlap.

**Step 5: Final commit**

Only if Task 2/4/6 commits were not made separately:

```bash
git add webui/src/pages/Onboarding.tsx webui/src/pages/connections/constants.ts webui/src/pages/connections/MetricCard.tsx webui/src/pages/connections/ConnectionOverview.tsx webui/src/components/AddSchemaDrawer.tsx webui/src/app/app.css webui/src/__tests__/onboarding.test.tsx webui/src/__tests__/connection-overview.test.tsx webui/src/__tests__/add-schema-drawer.test.tsx
git commit -m "feat(webui): refresh deployment and connection ux"
```

## Reviewer Checklist

- No backend API added for fake connection status.
- No secret or password rendering.
- No writes to `ktx.yaml` except existing Add Schema / enabled-tables flows.
- No new centered modal for Add Schema.
- No metric card says `Semantic Tables 1/3` without explaining completion percentage.
- No connection overview metric is missing `METRIC_METADATA` and an accessible help trigger.
- No green connected state before explicit test.
- Tests cover both ready and not-ready user paths.
