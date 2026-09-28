# PageHeader Context Dedup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove duplicated PageHeader context from six confirmed pages while preserving each page's authoritative body content and controls.

**Architecture:** Keep the shared `PageHeader` contract unchanged and simplify only its call sites. Pages with fully duplicated context remove the `badges` prop; Run detail retains only its runtime status badge. Existing body summaries, controls, validation gates, APIs, routes, and data contracts remain unchanged.

**Tech Stack:** React, TypeScript, TanStack Query, React Router, Vitest, Testing Library.

---

### Task 1: Lock the page-header contracts with tests

**Files:**
- Modify: `webui/src/__tests__/agent-detail.test.tsx`
- Modify: `webui/src/__tests__/monitor.test.tsx`
- Modify: `webui/src/__tests__/eval-cases.test.tsx`
- Modify: `webui/src/__tests__/review.test.tsx`
- Create: `webui/src/__tests__/eval-detail-page-header.test.tsx`

1. Add assertions that Agent detail, Eval monitor, Case list, Case editor, and Publish workbench do not render `page-header-badges`.
2. Add Run detail coverage proving the header retains only the run status while domain and pass rate remain in the body summary.
3. Replace Publish workbench header-badge assertions with assertions against its validation banner, pipeline, and publish gate.
4. Run the focused suite and confirm the new assertions fail before implementation.

### Task 2: Remove duplicated call-site badges

**Files:**
- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/src/pages/eval/Monitor.tsx`
- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/CaseEditor.tsx`
- Modify: `webui/src/pages/eval/RunDetail.tsx`
- Modify: `webui/src/pages/publish/PublishWorkbench.tsx`

1. Remove the full `badges` prop from Agent detail, Eval monitor, Case list, Case editor, and Publish workbench.
2. Reduce Run detail badges to its status badge only.
3. Do not change body summaries, filters, forms, gates, APIs, routes, or the shared `PageHeader` component.
4. Run the focused suite and confirm it passes.

### Task 3: Record the governing UX decision

**Files:**
- Create: `webui/docs/159-page-header-context-dedup-spec.md`
- Modify: `webui/docs/README.md`

1. Record the six-page before/after contract, terminology compliance, design-system compliance, and acceptance criteria.
2. Explicitly supersede the `/eval/monitor` and `/publish/workbench` PageHeader badge non-goals in Spec 91 §3.
3. Register Spec 159 in the WebUI documentation index.

### Task 4: Final verification

1. Run the focused Vitest suite.
2. Run `npm run lint:terminology` and `npm run lint:ia-boundary`.
3. Run `npm run build`.
4. Confirm only the planned files changed and existing user work remains untouched.
