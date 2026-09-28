# Spec 160 P1 Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close every P1 raised by the Spec 160 v0.3 acceptance review, add interaction-level regression coverage, and re-run the delivery gates.

**Architecture:** Keep the endpoint decision as a server-enforced soft gate, but make every `ktx.yaml` write share one in-process queue. Reuse paths must bypass the live-catalog cache and all supported database types must have an explicit catalog query. The shared conflict panel owns retry presentation while each caller owns the actual read/add action.

**Tech Stack:** TypeScript, React, TanStack Query, Fastify, Vitest, Testing Library, YAML CST writes.

---

### Task 1: Make the endpoint decision contract internally consistent

**Files:**
- Modify: `webui/server/connection-endpoint-gate.ts`
- Modify: `webui/server/__tests__/connection-endpoint-gate.test.ts`
- Modify: `webui/docs/160-same-endpoint-add-schema-spec.md`

**Steps:**
1. Add failing tests for zero/multiple Schema values on same-server/different-database conflicts and multiple endpoint matches.
2. Run the endpoint-gate test and confirm the new cases fail.
3. Validate the conflict Schema before either endpoint-conflict branch can return or accept an acknowledgement.
4. Align the normative pseudocode and acceptance wording with that precedence.
5. Re-run the endpoint-gate test and confirm it passes.

### Task 2: Serialize all `ktx.yaml` writes in one process

**Files:**
- Modify: `webui/server/ktx-yaml-write-lock.ts`
- Modify: `webui/server/project.ts`
- Modify: `webui/server/__tests__/connection-endpoint-gate.test.ts`
- Modify: `webui/docs/160-same-endpoint-add-schema-spec.md`

**Steps:**
1. Add a failing concurrency test proving create plus add-Schema preserves both changes.
2. Move the shared queue boundary into formal `writeKtxYaml` writes, with an internal lock-held option for the create transaction.
3. Keep create's gate re-read, secret write, and YAML commit in the same queue entry.
4. Re-run project and endpoint-gate tests.

### Task 3: Make live Schema verification fresh and complete

**Files:**
- Modify: `webui/server/live-catalog.ts`
- Modify: `webui/server/model.ts`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/server/project.ts`
- Modify: `webui/server/__tests__/live-catalog.test.ts`
- Modify: `webui/src/components/CreateConnectionDrawer.tsx`
- Modify: `webui/src/components/onboarding/Step1ConnectDb.tsx`
- Modify: `webui/docs/160-same-endpoint-add-schema-spec.md`

**Steps:**
1. Add tests for SQL Server and Oracle catalog SQL and protocol resolution.
2. Extend the live-catalog protocol contract and system-Schema filtering.
3. Add `?refresh=1` to both Spec 160 reuse calls.
4. Update the Spec to state that the soft-gate reuse check always bypasses cache.
5. Run live-catalog tests.

### Task 4: Repair and test the shared conflict interaction

**Files:**
- Modify: `webui/src/components/connections/EndpointConflictPanel.tsx`
- Modify: `webui/src/components/CreateConnectionDrawer.tsx`
- Modify: `webui/src/components/onboarding/Step1ConnectDb.tsx`
- Modify: `webui/src/__tests__/create-connection-drawer.test.tsx`
- Create: `webui/src/__tests__/step1-connect-db-endpoint-gate.test.tsx`

**Steps:**
1. Correct the shared type import and browser-translation attributes.
2. Add a retry action shown only after live-catalog failure.
3. Test Drawer reuse success, missing-Schema separate creation, retry after failure, and multiple-match selection.
4. Test the onboarding reuse path advances with the existing connection ID.
5. Run the focused component tests and terminology lint.

### Task 5: Re-accept the completed change

**Files:**
- Review: all Spec 160 changed files

**Steps:**
1. Run `git diff --check`.
2. Run terminology and IA boundary lints.
3. Run focused server and component tests.
4. Run the full Vitest suite and production build.
5. Compare implementation and evidence against all Spec 160 acceptance items and report any residual non-blocking risks.
