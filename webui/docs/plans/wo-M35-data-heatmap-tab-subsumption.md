# M35 Data Heatmap Tab Subsumption Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Demote `/admin/audit-sources` (Data Heatmap) from a top-level sidebar item into a `?tab=heatmap` tab inside `/admin/audit` (Access Log), keeping the existing API, server implementation, and smoke tests untouched.

**Architecture:** Frontend-only change. `Audit.tsx` grows a URL-driven tab switcher; the `HeatRow` rendering moves into the `heatmap` branch; `AuditSources.tsx` becomes a 2-line `<Navigate replace />` shim; `App.tsx` removes the sidebar entry. No backend or API change.

**Tech Stack:** React, TypeScript, React Router (`useSearchParams`, `<Navigate>`), TanStack Query, existing PageHeader, Vitest, Testing Library, existing `app.css`.

**Source Spec:** [../38-data-heatmap-tab-subsumption-spec.md](../38-data-heatmap-tab-subsumption-spec.md)

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/06-navigation-ia.md`
- `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`
- `webui/docs/38-data-heatmap-tab-subsumption-spec.md`

Inspect these implementation files:

- `webui/src/pages/admin/Audit.tsx` (log tab content; will absorb heatmap)
- `webui/src/pages/admin/AuditSources.tsx` (will become a 2-line Navigate shim)
- `webui/src/app/App.tsx` (navGroups, Routes)
- `webui/src/lib/types.ts:467` (AuditSourcesResponse)
- `webui/src/lib/breadcrumbs.ts:85` (audit-sources branch — will become a dead branch)
- `webui/src/components/PageHeader.tsx` (breadcrumbs contract)

Inspect these tests:

- `webui/src/__tests__/app-shell.test.tsx` (sidebar assertions)
- `webui/src/__tests__/admin-audit.test.tsx` (Audit log tab)
- `webui/src/__tests__/admin-audit-sources.test.tsx` (will be renamed)
- `webui/server/__tests__/mcp-proxy-smoke.test.ts` (4 waitForAuditSites — DO NOT TOUCH)
- `webui/server/__tests__/admin-audit.test.ts` (server audit — DO NOT TOUCH)

Non-negotiable boundaries:

- Do not modify any file under `webui/server/**`.
- Do not delete `GET /api/admin/audit/sources`; do not change server `admin/audit.ts`.
- Do not modify `mcp-proxy-smoke.test.ts` or any server test.
- Do not delete `AuditSources.tsx`; it stays as a Navigate shim.
- Do not delete `/admin/audit-sources` route; it must remain reachable via redirect.
- Do not introduce a new CSS class. Reuse existing `pl-btn`, `pl-btn--ghost`, `pl-page-stack`, `pl-card`, `pl-metric-grid`, `pl-metric-card`, `pl-notice`.
- Do not introduce a new runtime dependency.
- Do not modify `access.yaml`, `ktx.yaml`, MCP proxy, or `data-qa-instructions.md`.
- Treat existing dirty worktree changes as user-owned unless directly part of this work order.

---

## Codex Direct Prompt

你在 `/Users/zhangxingchen/Projects/project-lucy` 工作。请按本工单实现 `webui/docs/38-data-heatmap-tab-subsumption-spec.md`。

交付：

1. `/admin/audit` 增加 Tab 切换：`?tab=log`（默认，明细）和 `?tab=heatmap`（数据热力）。
2. 数据热力的 4 指标卡 + Top Tables + Denied Tables 段从 `AuditSources.tsx` 迁移到 `Audit.tsx` 的 heatmap 分支。
3. `AuditSources.tsx` 重写为 `<Navigate to="/admin/audit?tab=heatmap" replace />`。
4. 侧边栏"访问治理"从 5 项减为 4 项，移除"数据热力"二级项。
5. `app-shell.test.tsx` 删除"数据热力"断言；`admin-audit-sources.test.tsx` 重命名为 `admin-audit-heatmap-tab.test.tsx` 并迁移断言。
6. `00-product-terminology-standard.md` §3 `Data Heatmap` 行说明列更新；§4.5 访问治理分组登记从 5 项改为 4 项。
7. `06-navigation-ia.md` 访问治理分组表更新为 4 项，访问日志描述追加"内含 log / heatmap 两个 Tab"。
8. `user-guide.html` 访问治理分组截图与目录同步替换。

收尾说明必须列出修改文件、验证命令与结果。

---

## Task 1: Sidebar Removes Data Heatmap Entry

**Files:**

- Modify: `webui/src/app/App.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Write failing tests**

In `app-shell.test.tsx`:

```ts
// 访问治理 should only have 4 items now
const gov = ["Agent 实例", "角色权限", "访问日志", "配置审计"];
for (const g of gov) {
  expect(screen.getByRole("link", { name: g })).toBeInTheDocument();
}

// 数据热力 must no longer be a top-level link
expect(screen.queryByRole("link", { name: "数据热力" })).not.toBeInTheDocument();

// /admin/audit link must stay active under ?tab=heatmap
window.history.pushState({}, "", "/admin/audit?tab=heatmap");
// rerender or test through the sidebar by re-mounting
expect(screen.getByRole("link", { name: "访问日志" })).toHaveAttribute("aria-current", "page");
```

Also delete the legacy `["/admin/audit-sources", "AuditSources", "数据热力"]` array entry if it appears in the test fixture.

**Step 2: Run tests to verify failure**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: FAIL.

**Step 3: Edit `navGroups` in `App.tsx`**

```ts
{
  title: "访问治理",
  items: [
    { label: "Agent 实例", to: "/admin/agents", active: (path) => path.startsWith("/admin/agents") },
    { label: "角色权限", to: "/admin/roles", active: (path) => path.startsWith("/admin/roles") },
    { label: "访问日志", to: "/admin/audit", active: (path) => path === "/admin/audit" || path.startsWith("/admin/audit?") },
    { label: "配置审计", to: "/admin/config-audit", active: (path) => path === "/admin/config-audit" }
  ]
}
```

Keep the `import { AuditSources } from "../pages/admin/AuditSources"` line at the top; the file is still used as a route component.

**Step 4: Run tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS.

---

## Task 2: Audit Page Tab Switcher

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`

**Step 1: Add tab state and Tab link markup**

At the top of the `Audit` function, after `searchParams` is declared:

```ts
const tabParam = searchParams.get("tab");
const tab: "log" | "heatmap" = tabParam === "heatmap" ? "heatmap" : "log";
```

Between the `</PageHeader>` closing and the existing filterbar `<div className="pl-admin-filterbar">`, insert:

```tsx
<div className="flex items-center gap-2" role="tablist" aria-label="访问日志视图">
  <Link
    to="/admin/audit"
    role="tab"
    aria-selected={tab === "log"}
    className="pl-btn pl-btn--ghost text-sm"
  >
    明细
  </Link>
  <Link
    to="/admin/audit?tab=heatmap"
    role="tab"
    aria-selected={tab === "heatmap"}
    className="pl-btn pl-btn--ghost text-sm"
  >
    数据热力
  </Link>
</div>
```

**Step 2: Wrap the existing log-tab content in a `tab === "log"` branch**

Wrap the existing `<div className="pl-admin-filterbar">` ... `</>` (the last `</>` closes the conditional render inside `!isLoading && !error`) inside:

```tsx
{tab === "log" && (
  <>
    {/* existing filterbar + metric grid + table + pagination */}
  </>
)}
```

**Step 3: Make breadcrumbs dynamic on PageHeader**

```tsx
<PageHeader
  title="访问日志"
  breadcrumbs={tab === "heatmap" ? ["访问治理", "访问日志", "数据热力"] : ["访问治理", "访问日志"]}
  description="查看 MCP Proxy 记录的工具调用，可按用户、工具、状态过滤。"
  badges={...}
  actions={...}
/>
```

**Step 4: Add `aria-selected` styling in `app.css`**

Only if `pl-btn--active` does not exist:

```css
[role="tab"][aria-selected="true"] {
  font-weight: 600;
  color: var(--pl-fg, currentColor);
}
```

Use a CSS variable name that already exists in `app.css`. Do not invent a new design token.

**Step 5: Run existing admin-audit tests to verify no regression**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/admin-audit.test.tsx
```

Expected: PASS (existing assertions must still hold; the only addition is the Tab switcher above the existing log content).

---

## Task 3: Heatmap Content Migration Into Audit Page

**Files:**

- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify (read-only then delete): `webui/src/pages/admin/AuditSources.tsx`

**Step 1: Lift `HeatRow` into `Audit.tsx`**

Copy the `HeatRow` component (lines 7-19 of `AuditSources.tsx`) into `Audit.tsx` as a private function. Place it just below imports, before the `Audit` component.

**Step 2: Add the heatmap render branch**

Inside the `!isLoading && !error` block of `Audit`, **after** the log branch (or as a sibling), add:

```tsx
{tab === "heatmap" && <HeatmapView />}
```

Define `HeatmapView` as a private function inside `Audit.tsx`:

```tsx
function HeatmapView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", "heatmap"],
    queryFn: () => apiGet<AuditSourcesResponse>("/api/admin/audit/sources")
  });
  const maxCalls = Math.max(1, ...(data?.topTables ?? []).map((item) => item.calls));

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error) return <div className="pl-notice">加载失败：{(error as Error).message}</div>;

  return (
    <>
      <div className="pl-metric-grid">
        <div className="pl-metric-card"><span>连接</span><strong>{data?.connections.length ?? 0}</strong><small>审计派生</small></div>
        <div className="pl-metric-card"><span className="notranslate" translate="no">Schema</span><strong>{data?.schemas.length ?? 0}</strong><small>有访问记录</small></div>
        <div className="pl-metric-card"><span>表</span><strong>{data?.topTables.length ?? 0}</strong><small>Top 50</small></div>
        <div className="pl-metric-card"><span>拒绝表</span><strong>{data?.deniedTables.length ?? 0}</strong><small>有 denied</small></div>
      </div>
      <section className="pl-card grid gap-3">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold mb-0">Top Tables</p>
          <span className="text-xs text-fg-muted">calls / denied</span>
        </div>
        {(data?.topTables ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">暂无表级访问记录。</p>
        ) : (
          data?.topTables.map((item) => (
            <HeatRow key={item.table} label={item.table} calls={item.calls} denied={item.denied} max={maxCalls} />
          ))
        )}
      </section>
      <section className="pl-card grid gap-3">
        <p className="text-base font-semibold mb-0">Denied Tables</p>
        {(data?.deniedTables ?? []).length === 0 ? (
          <p className="text-sm text-fg-muted">暂无表级拒绝记录。</p>
        ) : (
          data?.deniedTables.map((item) => (
            <HeatRow key={item.table} label={item.table} calls={item.calls} denied={item.denied} max={maxCalls} />
          ))
        )}
      </section>
    </>
  );
}
```

**Step 3: Make sure the import of `AuditSourcesResponse` exists in `Audit.tsx`**

```ts
import type { AuditResponse, AuditLogEntry, AuditSourcesResponse } from "../../lib/types";
```

`Audit` already imports `AuditResponse` and `AuditLogEntry`; just add `AuditSourcesResponse`.

**Step 4: Verify the heatmap branch is reachable via URL**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
# Manual smoke: open http://127.0.0.1:5173/admin/audit?tab=heatmap
# Expect: 4 metric cards + Top Tables + Denied Tables render.
```

(Cannot be automated without browser tooling. Manual step is required.)

---

## Task 4: AuditSources Shim And Test Rename

**Files:**

- Modify: `webui/src/pages/admin/AuditSources.tsx`
- Delete (git rename): `webui/src/__tests__/admin-audit-sources.test.tsx`
- Create: `webui/src/__tests__/admin-audit-heatmap-tab.test.tsx`

**Step 1: Replace `AuditSources.tsx` content with a Navigate shim**

```ts
import { Navigate } from "react-router-dom";

export function AuditSources() {
  return <Navigate to="/admin/audit?tab=heatmap" replace />;
}
```

**Step 2: Git-rename the test file**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
git mv webui/src/__tests__/admin-audit-sources.test.tsx webui/src/__tests__/admin-audit-heatmap-tab.test.tsx
```

**Step 3: Rewrite the renamed test to drive the Audit page in `?tab=heatmap`**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Audit } from "../pages/admin/Audit";

function renderHeatmapTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/audit?tab=heatmap"]}>
        <Routes>
          <Route path="/admin/audit" element={<Audit />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Admin / Audit heatmap tab (M35)", () => {
  it("renders the heatmap tab content under ?tab=heatmap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/admin/audit/sources")) {
          return new Response(
            JSON.stringify({
              ok: true,
              data: {
                connections: ["demo-mysql"],
                schemas: ["dataforai"],
                topTables: [
                  { table: "demo-mysql.dataforai.customers", calls: 12, denied: 1 },
                  { table: "demo-mysql.dataforai.orders", calls: 7, denied: 0 }
                ],
                deniedTables: [{ table: "demo-mysql.dataforai.pii", calls: 3, denied: 3 }]
              }
            })
          );
        }
        // Default empty for log tab fetch (should not happen here)
        return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0, summary: {} } }));
      })
    );

    renderHeatmapTab();

    expect(await screen.findByRole("heading", { name: "访问日志" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "数据热力" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "明细" })).toHaveAttribute("aria-selected", "false");

    await waitFor(() => {
      expect(screen.getByText("Top Tables")).toBeInTheDocument();
      expect(screen.getByText("Denied Tables")).toBeInTheDocument();
    });
  });
});
```

**Step 4: Add a tab-switch test in `admin-audit.test.tsx`**

Append to `admin-audit.test.tsx`:

```ts
describe("Admin / Audit tab switching (M35)", () => {
  it("defaults to log tab and toggles to heatmap", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/admin/audit/sources")) {
        return new Response(JSON.stringify({ ok: true, data: { connections: [], schemas: [], topTables: [], deniedTables: [] } }));
      }
      return new Response(JSON.stringify({ ok: true, data: { entries: [], total: 0, summary: { businessCalls: 0, protocolCalls: 0, deniedCalls: 0, dataBearingCalls: 0 } } }));
    }));

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/admin/audit"]}>
          <Routes>
            <Route path="/admin/audit" element={<Audit />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(screen.getByRole("tab", { name: "明细" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "数据热力" })).toHaveAttribute("aria-selected", "false");

    await userEvent.click(screen.getByRole("tab", { name: "数据热力" }));
    expect(await screen.findByRole("tab", { name: "数据热力" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Top Tables")).toBeInTheDocument();
  });
});
```

(Adjust the test wrapper if `admin-audit.test.tsx` already defines its own render helper; reuse the existing one.)

**Step 5: Run the affected tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-heatmap-tab.test.tsx
```

Expected: PASS.

**Step 6: Run the full test suite to verify no regression in server / smoke tests**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run
```

Expected: PASS (in particular `mcp-proxy-smoke.test.ts` and `server/__tests__/admin-audit.test.ts` are untouched and must remain green).

---

## Task 5: Redirect Shim Test

**Files:**

- Modify (or create): `webui/src/__tests__/audit-sources-redirect.test.tsx` (new)

**Step 1: Write failing test for the shim**

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuditSources } from "../pages/admin/AuditSources";
import { screen } from "@testing-library/dom";

describe("AuditSources shim (M35)", () => {
  it("redirects to /admin/audit?tab=heatmap", () => {
    render(
      <MemoryRouter initialEntries={["/admin/audit-sources"]}>
        <Routes>
          <Route path="/admin/audit" element={<div>REDIRECTED</div>} />
          <Route path="/admin/audit-sources" element={<AuditSources />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText("REDIRECTED")).toBeInTheDocument();
  });
});
```

**Step 2: Run test**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/audit-sources-redirect.test.tsx
```

Expected: PASS (assuming Task 4 Step 1 already landed). If it fails, double-check that `AuditSources` returns `<Navigate replace />` and that no other test re-uses the old rendering.

---

## Task 6: Terminology And IA Doc Sync

**Files:**

- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/docs/06-navigation-ia.md`
- Modify: `webui/docs/user-guide.html`
- Modify: `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md` (add changelog note)
- Modify: `webui/docs/plans/wo-M34-sidebar-navigation-ia-consolidation.md` (add changelog note)

**Step 1: Update `00-product-terminology-standard.md` §3 `Data Heatmap` row**

Change the "说明" column to:

> 从访问审计派生的表级访问与拒绝分布；UI 收敛为访问日志内的 heatmap Tab（`/admin/audit?tab=heatmap`），原独立路由 `/admin/audit-sources` 保留为兼容重定向。

**Step 2: Update `00-product-terminology-standard.md` §4.5 访问治理分组**

If a `Sidebar Group` row exists in §4.5, update the "访问治理" line from 5 items to 4 items, and add an inline note:

> 访问日志页内含 `log` / `heatmap` 两个 Tab（`?tab=` 切换）；原"数据热力"独立二级项已归并。

If the row does not exist, do not invent it in this PR; this is a follow-up enhancement.

**Step 3: Update `06-navigation-ia.md` "访问治理" 分组表**

Replace the row `数据热力` with the new entry; update `访问日志` description to:

> | 访问治理 | 访问日志 | `/admin/audit` | 查看 MCP Proxy 记录的工具调用，内含 log / heatmap 两个 Tab |

**Step 4: Add changelog to spec 37 / plan M34**

In `37-sidebar-navigation-ia-consolidation-spec.md` after the title block, add:

```md
> **v0.2 (2026-08-01)**: Data Heatmap 已下沉为 `/admin/audit?tab=heatmap` 内的 Tab，由 `38-data-heatmap-tab-subsumption-spec.md` 跟踪。访问治理分组从 5 项收敛为 4 项。本 spec 后续以"5+1 侧边栏、4 项治理"为基准。
```

Same v0.2 note in plan M34.

**Step 5: Update `user-guide.html`**

Replace the 访问治理分组截图（5 项 → 4 项）；删除"数据热力"独立段落；新增"访问日志 Tab 切换"小节，描述 `?tab=heatmap` 用法。

**Step 6: Verify**

```bash
cd /Users/zhangxingchen/Projects/project-lucy
grep -n "数据热力" webui/docs/06-navigation-ia.md
grep -n "Data Heatmap" webui/docs/00-product-terminology-standard.md
grep -n "v0.2" webui/docs/37-sidebar-navigation-ia-consolidation-spec.md
```

Expected:
- `06-navigation-ia.md` no longer contains `数据热力` as a sidebar entry line; only inside prose where it explains the subsumption.
- `00-product-terminology-standard.md` shows updated Data Heatmap 说明.
- spec 37 shows v0.2 changelog.

---

## Task 7: Final Regression And Commit Strategy

**Files:**

- All files touched in Tasks 1-6.

**Step 1: Run focused test suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-heatmap-tab.test.tsx \
  src/__tests__/audit-sources-redirect.test.tsx
```

Expected: PASS.

**Step 2: Run full test suite**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run
```

Expected: PASS.

**Step 3: Type check and build**

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npx tsc --noEmit
npm run build
```

Expected: PASS. Vite chunk-size warnings are acceptable if unchanged and unrelated.

**Step 4: Manual QA**

- Open `/admin/audit` → default to log tab, see filterbar + 4 指标卡 + 明细表.
- Click `数据热力` → URL changes to `?tab=heatmap`, breadcrumb becomes `访问治理 / 访问日志 / 数据热力`, see 4 指标卡 + Top Tables + Denied Tables.
- Click `明细` → URL back to `/admin/audit`, log content visible.
- Direct visit `/admin/audit-sources` → URL becomes `/admin/audit?tab=heatmap`.
- Sidebar shows only 4 items under `访问治理`.
- Browser back button after redirect does not loop.

**Step 5: Commit**

```bash
git add webui/src/app/App.tsx webui/src/pages/admin/Audit.tsx webui/src/pages/admin/AuditSources.tsx webui/src/__tests__/app-shell.test.tsx
git commit -m "refactor(webui): subsume data heatmap into /admin/audit tab"

git add webui/src/__tests__/admin-audit-heatmap-tab.test.tsx webui/src/__tests__/admin-audit.test.tsx webui/src/__tests__/audit-sources-redirect.test.tsx
git rm webui/src/__tests__/admin-audit-sources.test.tsx
git commit -m "test(webui): rename heatmap test to admin-audit-heatmap-tab"

git add webui/docs/00-product-terminology-standard.md webui/docs/06-navigation-ia.md webui/docs/37-sidebar-navigation-ia-consolidation-spec.md webui/docs/plans/wo-M34-sidebar-navigation-ia-consolidation.md webui/docs/user-guide.html
git commit -m "docs(lucy): register data heatmap tab subsumption in terminology + IA"
```

If landing together:

```bash
git add webui/src webui/docs
git commit -m "refactor(webui): subsume data heatmap into /admin/audit?tab=heatmap"
```

---

## Reviewer Checklist

- [ ] Sidebar has 4 items under `访问治理`; no `数据热力` link.
- [ ] `/admin/audit` defaults to log tab; clicking `数据热力` shows heatmap.
- [ ] Breadcrumb on heatmap tab is `访问治理 / 访问日志 / 数据热力`.
- [ ] `/admin/audit-sources` redirects to `/admin/audit?tab=heatmap` with `replace`.
- [ ] `AuditSources.tsx` is a 2-line `<Navigate replace />` shim.
- [ ] `admin-audit-sources.test.tsx` is renamed to `admin-audit-heatmap-tab.test.tsx` and asserts heatmap tab content.
- [ ] `app-shell.test.tsx` no longer asserts `数据热力` as a sidebar link.
- [ ] No file under `webui/server/**` was modified.
- [ ] `mcp-proxy-smoke.test.ts` and `server/__tests__/admin-audit.test.ts` remain green and untouched.
- [ ] `00-product-terminology-standard.md` `Data Heatmap` row 说明 is updated.
- [ ] `06-navigation-ia.md` 访问治理分组表 updated to 4 items.
- [ ] spec 37 / plan M34 carry v0.2 changelog.
- [ ] `user-guide.html` 访问治理分组截图 / 目录 updated.
- [ ] No new CSS class, no new runtime dependency, no new route deletion.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` pass.
