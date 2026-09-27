# Lucy Setup Assistant P0–P2 Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Lucy Setup Assistant resume from authoritative connection state, enforce every required guard, report truthful service readiness, meet modal/form accessibility requirements, and reduce avoidable setup friction.

**Architecture:** Keep Lucy's supported single-instance topology and existing APIs. Derive a typed setup snapshot from `GET /api/project`, `GET /api/sources`, connection probes, and `GET /api/admin/mcp-runtime/status`; local draft state may advance optional steps but may never override an unmet required guard. Each step remains independently writable through the current API, while the UI invalidates and rebuilds its snapshot after writes.

**Tech Stack:** React 18, TypeScript, TanStack Query, Vitest, Testing Library, Tailwind/CSS utilities, Fastify APIs already present in Lucy.

---

## Design decision

Three approaches were considered:

1. **Authoritative client-side snapshot over existing APIs — selected.** Reuses the already-loaded project, Catalog, runtime, and probe contracts; fixes the current defect without adding another server persistence surface.
2. **New `/api/setup-status` aggregate endpoint.** Would centralize the model, but duplicates stable API data and expands backend scope without a current multi-client requirement.
3. **Local draft as the primary resume source.** Lowest implementation cost, but it is exactly the stale-state failure mode found in the audit and cannot be trusted after console-side edits.

The selected approach treats backend assets as authoritative for Steps 1–3 and readiness. A local draft can only remember optional progress (Steps 4–6) after all required guards remain satisfied.

### Task 1: Specify and test the setup snapshot and readiness model

**Files:**
- Modify: `webui/docs/130-onboarding-setup-assistant-spec.md`
- Modify: `webui/src/lib/setupAssistant.ts`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`

**Steps:**
1. Add failing pure-function tests for resume hydration, required-guard precedence, and readiness blockers.
2. Run `cd webui && npx vitest run src/__tests__/setup-assistant.test.tsx --maxWorkers=1` and confirm the new tests fail.
3. Add typed helpers that derive `schema`, `enabledTables`, required step, optional resume step, and readiness issues from `ConnectionInfo`, `SourcesResponse`, probe state, and `McpRuntimeStatus`.
4. Update Spec 130 to v1.1 with `## 核心流程（伪代码）`, failure branches, accessibility acceptance criteria, and canonical terminology.
5. Re-run the focused test and confirm the pure-function tests pass.

### Task 2: Rehydrate existing connections and protect the enabled-table write

**Files:**
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/components/onboarding/SetupAssistantModal.tsx`
- Modify: `webui/src/components/onboarding/Step2UploadManifest.tsx`
- Modify: `webui/src/components/onboarding/Step3SelectTables.tsx`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`

**Steps:**
1. Add a regression test whose `/api/sources` payload uses the real `tables` contract and whose existing connection has one Schema, a Manifest, and three enabled tables.
2. Assert that reopening at Step 3 shows the real Schema and enabled tables instead of zero.
3. Pass the selected `ConnectionInfo` and current `SourcesResponse` into the modal; rebuild local state whenever a connection is opened.
4. Change Step 3 to use `SourcesResponse.tables` and the shared query key, initialize once from persisted enabled tables (or default to all only for a new empty scope), and disable save when no candidates or no selection exist.
5. Replace the clickable card-with-nested-button pattern with one keyboard-operable `aria-pressed` control.
6. Invalidate project/source queries after successful writes and re-run the focused tests.

### Task 3: Enforce connection verification and sanitize probe errors

**Files:**
- Modify: `webui/src/components/onboarding/Step1ConnectDb.tsx`
- Modify: `webui/src/lib/setupAssistant.ts`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`

**Steps:**
1. Add tests proving that a failed or stale probe keeps the create/continue action disabled.
2. Associate every label and inline error with its input; add `required`, `aria-invalid`, `aria-describedby`, and password-toggle naming.
3. Record the exact probed field fingerprint and require a successful matching probe before connection creation.
4. Map DNS/network failures to actionable summaries and place raw output in a collapsed `技术详情` disclosure.
5. Announce probe progress/results with `role=status`/`role=alert` and `aria-live`.
6. Re-run the focused tests.

### Task 4: Make the modal accessible and protect unsaved work

**Files:**
- Modify: `webui/src/components/onboarding/SetupAssistantModal.tsx`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`

**Steps:**
1. Add tests for dialog naming, initial focus, Escape close, focus trapping, focus restoration, and dirty-close confirmation.
2. Add `aria-labelledby`/`aria-describedby`, an accessible close label, and an explicitly focusable title.
3. Capture the opener, move focus into the dialog on open, trap Tab/Shift+Tab, handle Escape, lock background scrolling, and restore focus on close.
4. Track unsaved input through bubbled change events; show an in-dialog discard confirmation instead of silently closing.
5. Reset dirty state after a successful step transition.
6. Re-run the focused tests.

### Task 5: Correct optional-step semantics and service readiness

**Files:**
- Modify: `webui/src/components/onboarding/Step4SemanticOverlay.tsx`
- Modify: `webui/src/components/onboarding/Step5BusinessWiki.tsx`
- Modify: `webui/src/components/onboarding/Step6ConnectAgent.tsx`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`

**Steps:**
1. Add tests that Step 4 cannot claim defaults are ready with zero enabled tables and that custom mode requires a target table plus YAML.
2. Give Step 4 segmented controls `aria-pressed`; distinguish `采用默认语义并继续`, `保存并继续`, and `跳过并继续`.
3. Make Step 5's save action require content and keep one explicit skip action.
4. Query project, source, probe, and MCP runtime state in Step 6; render a blocker list when the service is not ready and never claim AI Q&A readiness when execution is stale/error/unavailable.
5. Default Token issuance to an enabled non-admin Agent when available, show inherited Role scope and expiry, require acknowledgment for broad/admin-like scope, and use a seven-day default.
6. Re-run the focused tests.

### Task 6: Align terminology and reduce connection-card noise

**Files:**
- Modify: `webui/src/lib/setupAssistant.ts`
- Modify: `webui/src/components/onboarding/Step2UploadManifest.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/app/app.css`
- Modify: `webui/src/__tests__/setup-assistant.test.tsx`
- Modify: `docs/qa/selector-contract.md` only if selectors change

**Steps:**
1. Replace `挂载数据资产清单` and bare `清单` with canonical `上传 Schema Manifest` language.
2. Shorten step labels and expose textual completed/current/upcoming status rather than color alone.
3. Keep one connection-card setup progress region instead of duplicating the badge and banner.
4. Keep the primary row actions visible and move download/re-upload/remove actions into an accessible `更多` disclosure without changing their test IDs.
5. Add/adjust focused assertions for the canonical copy and action hierarchy.
6. Run `cd webui && npm run lint:terminology` and the focused tests.

### Task 7: Full verification and browser acceptance

**Files:**
- No production files expected unless verification finds a defect.

**Steps:**
1. Run `cd webui && npm run lint:terminology`.
2. Run `cd webui && npm run lint:ia-boundary`.
3. Run `cd webui && npx vitest run src/__tests__/setup-assistant.test.tsx src/__tests__/connection-overview.test.tsx --maxWorkers=1`.
4. Run `cd webui && npm test`.
5. Run `cd webui && npm run build`.
6. At a 1440×1000 desktop viewport, verify resume hydration, zero-table guard, failed-probe gate, focus trap/restoration, dirty-close confirmation, truthful Step 6 blockers, terminology, and action hierarchy.
7. Capture and inspect screenshots for the overview, Step 1 failure, Step 3 hydrated/blocked state, and Step 6 readiness state.
8. Review `git diff --check`, `git status --short`, and the final diff; preserve unrelated untracked files.
