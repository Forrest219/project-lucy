# M16 System Overview Runtime Monitoring Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reposition `/onboarding` from a one-time deployment guide into a post-launch system overview and runtime monitoring dashboard.

**Architecture:** Keep the existing `/onboarding` route to avoid breaking bookmarks and tests, but change the information architecture, copy, and component structure to express ongoing runtime status. Reuse existing React Query data sources from `Onboarding.tsx`; this is a front-end refactor with no API or data model changes.

**Tech Stack:** React 19, React Router, TanStack Query, Tailwind v4 component classes in `webui/src/app/app.css`, Vitest + Testing Library.

**Source Spec:** [../19-system-overview-runtime-monitoring-spec.md](../19-system-overview-runtime-monitoring-spec.md)

---

## Constraints

- Do not change backend APIs.
- Keep the route path `/onboarding`.
- Remove wizard/tutorial elements: readiness `5/5`, numeric step boxes, redundant Header navigation links, and Step 1-4 right-side navigation buttons.
- Keep three metric cards visually consistent with `rgba(243, 244, 246, 0.4)` shallow-gray card backgrounds.
- Use TDD: write or update the relevant tests before each implementation step.

---

## Task 1: Rename Shell Navigation And Page Header

**Files:**
- Modify: `webui/src/app/App.tsx`
- Modify: `webui/src/pages/Onboarding.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing shell navigation test**

Update `webui/src/__tests__/app-shell.test.tsx`:

```tsx
["/onboarding", "Onboarding", "系统概览"],
```

Add assertions that the sidebar contains `运行状态` and no longer contains `部署向导`.

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/app-shell.test.tsx
```

Expected: FAIL because the nav still says `部署向导 / 上线检查`.

**Step 2: Implement shell copy change**

In `webui/src/app/App.tsx`, change the first `navGroups` entry to:

```tsx
{
  title: "运行状态",
  items: [{ label: "系统概览", to: "/onboarding", active: (path) => path === "/onboarding" }]
}
```

**Step 3: Write failing header test**

Update `webui/src/__tests__/onboarding.test.tsx`:

```tsx
expect(await screen.findByRole("heading", { name: "系统概览" })).toBeInTheDocument();
expect(screen.getByText("运行状态")).toBeInTheDocument();
expect(screen.queryByRole("link", { name: "数据库接入" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "配置 Agent" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "刷新状态" })).toBeInTheDocument();
```

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: FAIL because the page still renders deployment-guide copy and header action links.

**Step 4: Implement header refactor**

In `webui/src/pages/Onboarding.tsx`, change `PageHeader`:

```tsx
title="系统概览"
breadcrumbs={["运行状态", "系统概览"]}
description="查看 Lucy MCP、KTX runtime、语义资产与 Agent 接入的当前健康状态。"
```

Update `badges` to include active token count:

```tsx
<>
  <span>KTX {projectQuery.data.ktxAvailable ? "可用" : "不可用"}</span>
  <span>{doneSources}/{sources.length} 语义完成</span>
  <span>{enabledTokenCount} 活跃 Token</span>
</>
```

Replace the two header links with:

```tsx
<button
  type="button"
  className="pl-btn pl-btn--secondary"
  onClick={() => {
    void Promise.all([
      projectQuery.refetch(),
      sourcesQuery.refetch(),
      diffQuery.refetch(),
      agentsQuery.refetch()
    ]);
  }}
>
  刷新状态
</button>
```

**Step 5: Run tests**

Run:

```bash
npm test -- src/__tests__/app-shell.test.tsx src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 2: Replace Four-Card Readiness Metrics With Three Runtime Metrics

**Files:**
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing metric test**

In `webui/src/__tests__/onboarding.test.tsx`, assert:

```tsx
expect(screen.queryByText("Deployment readiness")).not.toBeInTheDocument();
expect(screen.getByText("KTX Runtime")).toBeInTheDocument();
expect(screen.getByText("语义资产覆盖度")).toBeInTheDocument();
expect(screen.getByText("Agent 接入与安全")).toBeInTheDocument();
expect(document.querySelectorAll(".pl-metric-grid > .pl-metric-card")).toHaveLength(3);
```

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: FAIL because the readiness metric still exists and there are four cards.

**Step 2: Implement metric JSX**

In `webui/src/pages/Onboarding.tsx`, remove the `Deployment readiness` card.

Render the remaining cards as:

```tsx
<div className="pl-metric-grid pl-metric-grid--three">
  <div className="pl-metric-card">
    <span>KTX Runtime</span>
    <strong className={projectQuery.data?.ktxAvailable ? "pl-metric-value--success" : "pl-metric-value--danger"}>
      {projectQuery.data?.ktxAvailable ? "Ready" : "Unavailable"}
    </strong>
    <small>{projectQuery.data?.root ?? "项目根未知"}</small>
  </div>
  <div className="pl-metric-card">
    <span>语义资产覆盖度</span>
    <strong>{doneSources}/{sources.length}</strong>
    <small>{semanticPercent}% 已维护</small>
  </div>
  <div className="pl-metric-card">
    <span>Agent 接入与安全</span>
    <strong>{enabledAgents.length}</strong>
    <small>{agents.length} agents · {tokenCount} tokens · {enabledTokenCount} usable</small>
  </div>
</div>
```

**Step 3: Implement optional three-card layout class**

In `webui/src/app/app.css`, add:

```css
.pl-metric-grid--three { @apply xl:grid-cols-3; }
```

Keep the normal metric card background unchanged.

**Step 4: Run tests**

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 3: Convert Numbered Steps Into Runtime Diagnostics

**Files:**
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing diagnostic test**

In `webui/src/__tests__/onboarding.test.tsx`, assert:

```tsx
expect(screen.getByText("实时状态与诊断")).toBeInTheDocument();
expect(screen.getByText("数据源连接")).toBeInTheDocument();
expect(screen.getByText("语义层状态")).toBeInTheDocument();
expect(screen.getByText("变更审阅")).toBeInTheDocument();
expect(screen.getByText("Agent 接入点")).toBeInTheDocument();
expect(document.querySelector(".pl-onboarding-step-index")).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "查看连接" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "表白名单" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "维护语义" })).not.toBeInTheDocument();
expect(screen.queryByRole("link", { name: "审阅校验" })).not.toBeInTheDocument();
```

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: FAIL because numbered onboarding steps still render.

**Step 2: Replace `OnboardingStep` component**

In `webui/src/pages/Onboarding.tsx`, replace `OnboardingStep` with:

```tsx
function HealthDiagnosticItem({
  title,
  description,
  tone,
  meta,
  children
}: {
  title: string;
  description: string;
  tone: "ready" | "warning" | "info" | "danger";
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="pl-health-item" data-tone={tone}>
      <div className="pl-health-item-status" aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="pl-panel-title mb-0">{title}</h2>
          {meta}
        </div>
        <p className="pl-notice mt-1">{description}</p>
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
    </section>
  );
}
```

**Step 3: Render diagnostics**

Replace the `pl-onboarding-list` body with:

```tsx
<section className="pl-panel">
  <div className="pl-section-heading">
    <div>
      <h2 className="pl-panel-title mb-1">实时状态与诊断</h2>
      <p className="pl-notice">持续观察运行中的数据源、语义资产、审阅风险和 Agent 接入状态。</p>
    </div>
  </div>
  <div className="pl-health-list">
    ...
  </div>
</section>
```

Use four `HealthDiagnosticItem` instances:

- `数据源连接`: ready when `connectionReady`; include connection count, connection ids, schema count, KTX availability.
- `语义层状态`: warning when `sources.length - doneSources > 0`; include done count, pending count, enabled table count.
- `变更审阅`: ready when `validationReady`; warning otherwise; include changed file count.
- `Agent 接入点`: ready when `mcpReady`; warning otherwise; include endpoint, agent count, usable token count, JSON config, and actions.

**Step 4: Add diagnostic styles**

In `webui/src/app/app.css`, add:

```css
.pl-health-list { @apply grid gap-3; }
.pl-health-item { @apply grid grid-cols-[10px_minmax(0,1fr)] items-start gap-4 rounded-md border border-border-default bg-bg-surface p-5; }
.pl-health-item-status { @apply mt-1 size-2.5 rounded-pill bg-fg-muted; }
.pl-health-item[data-tone="ready"] .pl-health-item-status { @apply bg-success; }
.pl-health-item[data-tone="warning"] .pl-health-item-status { @apply bg-warning; }
.pl-health-item[data-tone="danger"] .pl-health-item-status { @apply bg-danger; }
.pl-health-item[data-tone="info"] .pl-health-item-status { @apply bg-accent; }
```

Do not remove old `.pl-onboarding-*` styles in this task unless they become unused and TypeScript/tests prove no page relies on them.

**Step 5: Run tests**

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 4: Keep Agent MCP Config As The Main Operational Detail

**Files:**
- Modify: `webui/src/pages/Onboarding.tsx`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing Agent diagnostic test**

In `webui/src/__tests__/onboarding.test.tsx`, assert that the Agent diagnostic item contains:

```tsx
const agentItem = screen.getByText("Agent 接入点").closest("section");
expect(agentItem).toBeInTheDocument();
expect(within(agentItem as HTMLElement).getByText("MCP config")).toBeInTheDocument();
expect(within(agentItem as HTMLElement).getByRole("button", { name: "复制 MCP 配置" })).toBeInTheDocument();
expect(within(agentItem as HTMLElement).getByRole("link", { name: "新建 Token" })).toHaveAttribute(
  "href",
  "/admin/agents/analyst/tokens/new"
);
expect(within(agentItem as HTMLElement).getByRole("link", { name: "Agent 实例" })).toHaveAttribute(
  "href",
  "/admin/agents"
);
```

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: FAIL until the Agent diagnostic content is fully moved into the new structure.

**Step 2: Move existing MCP config preview**

Inside the `Agent 接入点` diagnostic item, keep:

```tsx
<div className="pl-code-snippet">
  <span>MCP config</span>
  <code>{mcpConfig}</code>
</div>
```

Keep the same copy handler:

```tsx
<button type="button" className="pl-btn pl-btn--secondary" onClick={copyConfig}>
  {copied ? "已复制" : "复制 MCP 配置"}
</button>
```

Keep token routing:

```tsx
<Link className="pl-btn pl-btn--ghost" to={agents[0] ? `/admin/agents/${agents[0].id}/tokens/new` : "/admin/agents"}>
  新建 Token
</Link>
```

Keep the Agent detail entry:

```tsx
<Link className="pl-btn pl-btn--ghost" to="/admin/agents">
  Agent 实例
</Link>
```

**Step 3: Run tests**

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 5: Final Verification

**Files:**
- Verify: `webui/src/pages/Onboarding.tsx`
- Verify: `webui/src/app/App.tsx`
- Verify: `webui/src/app/app.css`
- Verify: `webui/src/__tests__/onboarding.test.tsx`
- Verify: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Run focused tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/onboarding.test.tsx src/__tests__/app-shell.test.tsx
```

Expected: PASS.

**Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. A Vite chunk size warning is acceptable if unchanged from baseline.

**Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

**Step 4: Optional browser check**

Open:

```text
http://localhost:55176/onboarding
```

Expected visual result:

- Header reads `系统概览`.
- No top-right database/agent shortcut links.
- Core metrics are three consistent shallow-gray cards.
- Diagnostics are unnumbered peer health rows.
- Agent MCP JSON preview remains easy to copy.
