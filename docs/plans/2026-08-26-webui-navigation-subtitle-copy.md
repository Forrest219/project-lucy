# WebUI Navigation Subtitle Copy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply the approved enterprise-grade menu subtitle copy across Lucy WebUI and verify every affected route in a desktop browser.

**Architecture:** Keep the existing 6+1 navigation IA and route structure. Update PageHeader descriptions in place, align command-palette navigation descriptions with the same page responsibilities, register the new “安全评测候选” term, and update documentation/tests that assert the affected copy. Preserve all unrelated worktree changes.

**Tech Stack:** React, TypeScript, Vitest, Vite, Codex in-app browser.

---

### Task 1: Update terminology and IA contracts

**Files:**
- Modify: `webui/docs/00-product-terminology-standard.md`
- Modify: `webui/docs/06-navigation-ia.md`

**Steps:**
1. Register “安全评测候选” as the UI primary term and mark bare “安全候选” as ambiguous.
2. Update the navigation IA table and breadcrumbs to use the approved secondary-menu name.
3. Keep all existing 6+1 IA changes in the dirty worktree intact.

**Verification:** `rg` shows one canonical secondary-menu name and no active navigation contract using the deprecated label.

### Task 2: Apply approved PageHeader descriptions

**Files:**
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/connections/TableWhitelist.tsx`
- Modify: `webui/src/pages/Catalog.tsx`
- Modify: `webui/src/pages/WikiEditor.tsx`
- Modify: `webui/src/pages/publish/PublishWorkbench.tsx`
- Modify: `webui/src/pages/publish/PublishHistory.tsx`
- Modify: `webui/src/pages/eval/CaseList.tsx`
- Modify: `webui/src/pages/eval/RunList.tsx`
- Modify: `webui/src/pages/eval/Monitor.tsx`
- Modify: `webui/src/pages/eval/SecurityCandidates.tsx`
- Modify: `webui/src/pages/admin/GovernanceOverview.tsx`
- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/RoleList.tsx`
- Modify: `webui/src/pages/admin/Audit.tsx`
- Modify: `webui/src/pages/admin/McpPlayground.tsx`
- Modify: `webui/src/pages/admin/ConfigAudit.tsx`
- Modify: `webui/src/pages/admin/BrandingSettings.tsx`
- Modify: `webui/src/pages/admin/AdminAccounts.tsx`

**Steps:**
1. Replace each PageHeader description with the approved sentence.
2. Rename the security-candidate page title to “安全评测候选”.
3. Preserve browser-translation protection around professional English terms.

**Verification:** Source search finds all 19 approved descriptions and no superseded PageHeader copy.

### Task 3: Align navigation search copy, inventory, and tests

**Files:**
- Modify: `webui/src/app/navigation.ts`
- Modify: `webui/src/__tests__/navigation.test.ts`
- Modify: affected focused UI tests
- Modify: `docs/SYSTEM_HANDBOOK.md`
- Modify: `inbox/20260826-1150-webui-nav-menu-inventory.md`

**Steps:**
1. Align command-palette descriptions with the approved page responsibilities, including correcting “启用表范围” so it does not imply ACL authorization.
2. Update navigation and focused page-copy assertions.
3. Refresh the inventory and handbook rows that act as current user-facing references.

**Verification:** Focused Vitest suites pass and `rg` finds no current-source use of the superseded menu label or subtitle sentences.

### Task 4: Run automated verification

**Commands:**
- `cd webui && npm run lint:terminology`
- `cd webui && npm run lint:ia-boundary`
- `cd webui && npm test -- --runInBand` if supported; otherwise `cd webui && npm test`
- `cd webui && npm run build`

**Expected:** All lint, unit tests, type checks performed by the build, and production build pass.

### Task 5: Verify every affected route in a desktop browser

**Steps:**
1. Start or reuse the local WebUI development server.
2. Visit all 19 routes in the approved inventory.
3. For every route, verify the visible H1 and PageHeader description.
4. Verify the sidebar shows “安全评测候选” and the command palette uses the aligned descriptions.
5. Capture representative screenshots after all checks pass.

**Expected:** All routes render the approved copy without clipping, stale text, console-visible navigation failure, or unintended mobile/narrow layout testing.
