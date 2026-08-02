# M39 System Overview Enterprise Ops Polish Work Order

**Goal:** Polish the existing M36 system overview into an enterprise-grade Data Agent Ops Control Plane landing page: canonical `/overview`, guarded 5+1 sidebar, quieter service health, governed action-required queue, metric-first snapshots, global refresh context, and Drawer-based MCP config.

**Architecture:** Frontend-only refinement using existing React Router routes, PageHeader, TanStack Query, `opsDashboard.ts` pure view model helpers, existing Drawer CSS patterns, Sonner Toast, and current API endpoints. No backend API changes for MVP.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Vitest, Testing Library, existing `app.css` token system.

**Source Spec:** [../41-system-overview-enterprise-ops-polish-spec.md](../41-system-overview-enterprise-ops-polish-spec.md)

> M38 is intentionally skipped here because spec 40 reserves M38 for `docs/vision.md` and `docs/webui-module-guide.md` positioning narrative cleanup. M39 is the next implementation work order for the system overview polish.

---

## Context For Developer

Read these documents before editing:

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `webui/docs/00-product-terminology-standard.md`
- `webui/docs/19-system-overview-runtime-monitoring-spec.md`
- `webui/docs/22-public-mcp-endpoint-runtime-config-spec.md`
- `webui/docs/37-sidebar-navigation-ia-consolidation-spec.md`
- `webui/docs/39-data-agent-ops-platform-global-ux-spec.md`
- `webui/docs/41-system-overview-enterprise-ops-polish-spec.md`

Inspect these implementation files:

- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- `webui/src/components/PageHeader.tsx`
- `webui/src/components/ObjectDetailDrawer.tsx`
- `webui/src/pages/Onboarding.tsx`
- `webui/src/lib/opsDashboard.ts`
- `webui/src/lib/mcpEndpoint.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/lib/types.ts`

Inspect and extend these tests:

- `webui/src/__tests__/app-shell.test.tsx`
- `webui/src/__tests__/onboarding.test.tsx`
- `webui/src/__tests__/ops-dashboard.test.ts`
- `webui/src/__tests__/lint-terminology-scan.test.ts`
- `webui/src/__tests__/lint-ia-boundary.test.ts`

Non-negotiable boundaries:

- Do not change `ktx.yaml`, `webui/config/access.yaml`, `.ktx/secrets/**`, or `webui/config/data-qa-instructions.md`.
- Do not remove `/onboarding`; keep it as a compatibility redirect.
- Do not change `/` away from `表目录`.
- Do not introduce new dependencies.
- Do not render historical token plaintext in MCP config.
- Do not use `Critical / Warning / Ready / Info` as user-visible severity labels.
- Do not translate `Schema`, `Manifest`, `Catalog`, `MCP`, `KTX`, `Agent`, `Endpoint`, or `Eval Run`.
- Add `translate="no"` and `notranslate` to DOM nodes that render professional English terms, identifiers, file paths, URLs, environment variables, token ids, session ids, or turn ids.
- Keep the current 5+1 IA; only move the system overview canonical link from `/onboarding` to `/overview`.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Codex Direct Prompt

你在 `/Users/forrest/Projects/project-lucy` 工作。请按 `webui/docs/41-system-overview-enterprise-ops-polish-spec.md` 实施 M39。

交付：

1. 新增 `/overview` 作为系统概览 canonical route；`/onboarding` 兼容重定向到 `/overview`；`/` 继续渲染表目录。
2. 更新侧边栏置顶系统概览入口指向 `/overview`，并增加测试守护 Footer 不重复渲染主导航。
3. 将 PageHeader 标题改为 `系统概览`，补充环境、上次更新、自动刷新开关、刷新 loading 和 Toast。
4. 将 Ready 状态 Banner 降级为紧凑状态条；异常 / Critical 才允许高声量 Alert。
5. 将待处理事项严重度改为中文，补充影响范围、负责人、更新时间、证据来源与统一 `前往处理 ↗` 链接。
6. 将质量快照和访问风险改为 metric-first 卡片，语义覆盖展示进度条。
7. 将 MCP config JSON 从主屏收纳到右侧 Drawer；主屏保留 `复制 MCP 配置` 和 `查看配置`。
8. 更新术语、IA、页面测试，并通过 lint、typecheck、test、build。

收尾说明必须列出修改文件清单、验证命令与结果。

---

## Task 1: Route And Sidebar Hardening

**Files:**

- Modify: `webui/src/app/App.tsx`
- Test: `webui/src/__tests__/app-shell.test.tsx`

**Step 1: Write failing tests**

Add assertions:

- `/overview` renders the Onboarding page and marks `系统概览` active.
- `/onboarding` redirects to `/overview` and renders the Onboarding page.
- `/` still renders Catalog and marks `表目录` active.
- The `系统概览` sidebar link has `href="/overview"`.
- Footer contains only the help link and version text; it does not contain any `pl-nav-section`.
- Navigation group headings appear exactly once each.

**Step 2: Implement route compatibility**

In `App.tsx`:

- Change `topLevelEntry.to` from `/onboarding` to `/overview`.
- Change active predicate to `path === "/overview"`.
- Add `<Route path="/overview" element={<Onboarding />} />`.
- Replace `/onboarding` element with `<Navigate to="/overview" replace />`.

Do not change `/`.

**Step 3: Run focused test**

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm test -- --run src/__tests__/app-shell.test.tsx
```

Expected: PASS.

---

## Task 2: Action Queue View Model Governance

**Files:**

- Modify: `webui/src/lib/opsDashboard.ts`
- Test: `webui/src/__tests__/ops-dashboard.test.ts`

**Step 1: Extend types**

Add fields to `ActionRequiredItem`:

- `severityLabel: "高风险" | "待处理" | "提醒" | "就绪"`
- `impact: string`
- `owner: string`
- `evidence: string`
- `updatedAtLabel?: string`

Keep `severity` as the internal sort key.

**Step 2: Update labels and severity**

Required behavior:

- Semantic gap with large gap can be `critical`; smaller gap can be `warning`.
- Eval gap is `info`, not warning.
- ACL deny label becomes `近 7 天存在 ACL 拒绝`.
- UI-facing severity labels are Chinese.

**Step 3: Add deterministic governance metadata**

Use MVP mappings:

- semantic gap: impact `问答召回率`, owner `数据治理组`
- Catalog pending: impact `资产同步`, owner `架构组`
- pending publish: impact `发布一致性`, owner `语义发布负责人`
- eval gap: impact `质量基线`, owner `QA 团队`
- ACL deny: impact `访问安全`, owner `访问治理组`

If no event timestamp exists, the page will pass in the dashboard update time.

**Step 4: Run focused test**

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm test -- --run src/__tests__/ops-dashboard.test.ts
```

Expected: PASS.

---

## Task 3: Header Context And Refresh Controls

**Files:**

- Modify: `webui/src/pages/Onboarding.tsx`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing tests**

Assert:

- Page heading is `系统概览`, not `运维驾驶舱`.
- Header badges include `环境: Local` or `环境: Configured`.
- Header shows `上次更新:`.
- `自动刷新` toggle exists and defaults off.
- Clicking `刷新状态` calls refetch endpoints and updates the timestamp.

**Step 2: Implement global context**

In `Onboarding.tsx`:

- Track `lastUpdatedAt` when core queries settle successfully.
- Derive environment from endpoint: localhost / 127.0.0.1 -> `Local`; configured non-local endpoint -> `Configured`; invalid -> `未配置`.
- Add an auto-refresh checkbox / switch. When enabled, refetch every 60 seconds; pause when `document.hidden`.
- Change button label to `刷新中...` while any core query is fetching.
- On manual refresh success, `toast.success("系统概览已刷新")`; on failure, `toast.error("系统概览刷新失败")`.

**Step 3: Run focused test**

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm test -- --run src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 4: State Tone, Metric-First Cards, And MCP Drawer

**Files:**

- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/onboarding.test.tsx`

**Step 1: Write failing tests**

Assert:

- Ready service health does not use `pl-delivery-banner--ready`.
- User-visible severity labels are `高风险 / 待处理 / 提醒`, with no `Critical / Warning / Ready / Info`.
- Each action item displays impact, owner, update time, and evidence.
- Quality snapshot renders semantic coverage as a standalone percent plus progress bar.
- Main page does not render the raw JSON code snippet by default.
- `查看配置` opens a Drawer titled `MCP 配置`.
- Drawer code block includes `translate="no"` and `notranslate`.

**Step 2: Refactor service health and action list**

- Replace the large ready banner with a compact status strip.
- Keep Critical / invalid endpoint as high-emphasis Alert.
- Render action item metadata in a condensed row layout.
- Use a single `前往处理 ↗` link style.

**Step 3: Refactor snapshot cards**

- Make `6%` or equivalent percent the semantic coverage primary value.
- Add accessible progress bar: `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and a text label.
- Remove nested card styling where possible.

**Step 4: Add MCP config Drawer**

Implement a local drawer or reusable Drawer shell using existing `pl-drawer-*` CSS classes:

- Button: `查看配置`
- Drawer title: `MCP 配置`
- Contains endpoint diagnostics, JSON config, `复制 MCP 配置`, and `查看 Agent 实例 ↗`
- Code block, URL, `.mcp.json`, and `LUCY_PUBLIC_MCP_URL` use translation defense.

**Step 5: Run focused test**

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm test -- --run src/__tests__/onboarding.test.tsx
```

Expected: PASS.

---

## Task 5: Terminology And IA Regression Guards

**Files:**

- Modify if needed: `webui/src/__tests__/lint-terminology-scan.test.ts`
- Modify if needed: `webui/src/__tests__/lint-ia-boundary.test.ts`
- Modify if needed: `webui/docs/00-product-terminology-standard.md`

**Step 1: Verify no new term is needed**

Spec 41 introduces no new canonical terms. It only applies terms already registered in `00-product-terminology-standard.md`.

**Step 2: Add forbidden UI guard if missing**

Ensure the lint tests catch new user-visible regressions:

- `Critical`
- `Warning`
- `Ready`
- `ACL deny`
- `Run` when used as standalone UI action/status instead of `Eval Run`

Do not ban these inside source code comments, tests explaining old behavior, or documented forbidden-term tables unless the lint already supports contextual allowances.

**Step 3: Run lint-focused tests**

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: PASS.

---

## Task 6: Full Verification

Run:

```bash
cd /Users/forrest/Projects/project-lucy/webui
npx tsc --noEmit
npm test
npm run build
```

Then optionally run a browser smoke test against the dev server:

```bash
cd /Users/forrest/Projects/project-lucy/webui
npm run dev
```

Manual smoke checklist:

- Open `http://localhost:5174/overview`.
- Confirm `/onboarding` redirects to `/overview`.
- Confirm first screen answers: current service state, top risks, next action.
- Confirm ready state is visually quiet.
- Confirm action items include severity, impact, owner, update time, evidence, and link.
- Confirm MCP config opens in Drawer and copies successfully.
- Confirm sidebar Footer does not repeat nav groups.

---

## Completion Criteria

- [ ] `/overview` canonical route exists.
- [ ] `/onboarding` compatibility redirect works.
- [ ] PageHeader title is `系统概览`.
- [ ] Header includes environment, update time, auto-refresh, refresh loading, and Toast feedback.
- [ ] Ready status no longer uses a large green banner.
- [ ] Action items use Chinese severity labels and governance metadata.
- [ ] Snapshot cards are metric-first and accessible.
- [ ] MCP config JSON is hidden by default and available in Drawer.
- [ ] Sidebar and Footer duplication is guarded by tests.
- [ ] `npm run lint:terminology` passes.
- [ ] `npm run lint:ia-boundary` passes.
- [ ] `npx tsc --noEmit` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
