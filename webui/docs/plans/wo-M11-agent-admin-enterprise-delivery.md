# Agent Admin Enterprise Delivery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade Lucy WebUI Agent Admin into an enterprise-ready delivery workflow for creating, handing off, editing, auditing, and rotating governed Agent access.

**Architecture:** Reuse the existing role-first Admin API and Lucy MCP Proxy permission preview. Keep `access.yaml` writes behind dryRun diff confirmation, keep token plaintext one-time only, and implement the UX polish mostly in `AgentList.tsx`, `AgentDetail.tsx`, `NewToken.tsx`, shared helpers, and focused tests.

**Tech Stack:** React, TypeScript, React Router, TanStack Query, Vitest, Testing Library, Fastify Admin API.

---

## Task 1: Agent List Copy Config And Last Seen

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Test: `webui/src/__tests__/agent-list.test.tsx` or extend an existing admin list test if present

**Step 1: Write failing tests**

Cover:

- Agent with no `stats.lastSeen` renders `未访问`.
- Agent with `stats.lastSeen` renders a relative time string and keeps a full timestamp in `title`.
- Clicking `复制 MCP 配置` writes `.mcp.json` JSON to clipboard.
- Copied JSON contains `Authorization: Bearer ${LUCY_AGENT_TOKEN}` and does not contain any token hash or plaintext.
- Clicking `查看日志` navigates to `/admin/audit?user=zhangsan`.

Run:

```bash
cd webui
npm test -- agent-list
```

Expected: FAIL because the test or behavior does not exist yet.

**Step 2: Implement minimal UI helpers**

Add local helpers in `AgentList.tsx` unless duplication appears:

- `formatLastSeen(lastSeen?: string): { label: string; title?: string }`
- `buildSafeMcpConfig(agentId: string): string`
- `copyAgentMcpConfig(agent: Agent): Promise<void>`

Use the current local endpoint default:

```text
http://localhost:7879/mcp
```

Use token placeholder:

```text
${LUCY_AGENT_TOKEN}
```

**Step 3: Add the card action**

Add `复制 MCP 配置` to the Agent card action group. Keep `编辑` and `查看日志`.

**Step 4: Run tests**

```bash
cd webui
npm test -- agent-list
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentList.tsx webui/src/__tests__/agent-list.test.tsx
git commit -m "feat(webui): add agent list config handoff"
```

## Task 2: New Agent Role Permission Card

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/lib/types.ts` only if role fields need type adjustment
- Test: `webui/src/__tests__/agent-list.test.tsx`

**Step 1: Write failing tests**

Cover:

- Selecting a role displays source count, connections, tools, source type, and warnings.
- Invalid roles are visibly disabled or marked invalid and cannot be submitted.
- Primary form action no longer says only `预览变更`.
- The create flow still calls `POST /api/admin/agents` first with `dryRun:true`.

Run:

```bash
cd webui
npm test -- agent-list
```

Expected: FAIL.

**Step 2: Implement the role summary card**

Inside `NewAgentModal`, derive:

- `selectedRole = roles.find((item) => item.id === role)`
- `selectedRole.sourceCount`
- `selectedRole.connections`
- `selectedRole.tools`
- `selectedRole.source`
- `selectedRole.warnings`

Render a compact non-nested card below the role select.

**Step 3: Rename action labels**

Use:

- Form step primary: `下一步：预览配置`
- Diff step primary: `确认创建`

Do not change the API contract.

**Step 4: Run tests**

```bash
cd webui
npm test -- agent-list
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentList.tsx webui/src/lib/types.ts webui/src/__tests__/agent-list.test.tsx
git commit -m "feat(webui): explain role permissions when creating agents"
```

## Task 3: Token One-Time Delivery Tabs

**Files:**

- Modify: `webui/src/pages/admin/NewToken.tsx`
- Test: `webui/src/__tests__/new-token.test.tsx`

**Step 1: Write failing tests**

Cover:

- Generated token page shows plaintext token once.
- Tabs or segmented controls exist for Hermes, Claude Code, Codex, and Generic MCP.
- Copy config writes a snippet containing `Bearer <generatedToken>`.
- Closing returns to `/admin/agents/:userId`.

Run:

```bash
cd webui
npm test -- new-token
```

Expected: FAIL.

**Step 2: Extract config snippet builder**

In `NewToken.tsx`, add a local `buildClientSnippets(token: string)` helper returning labeled snippets. Keep all snippets generated from in-memory `generatedToken.token`.

**Step 3: Implement tabs and copy actions**

Use existing button styles. Make copy buttons accessible and show toast or copied state.

**Step 4: Run tests**

```bash
cd webui
npm test -- new-token
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/NewToken.tsx webui/src/__tests__/new-token.test.tsx
git commit -m "feat(webui): add one-time token client configs"
```

## Task 4: Agent Detail Sticky Save Bar

**Files:**

- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Modify: `webui/src/app/app.css`
- Test: `webui/src/__tests__/agent-detail.test.tsx`

**Step 1: Write failing tests**

Cover:

- No save bar before edits.
- Editing name/note/enabled/role shows sticky save bar.
- `放弃修改` clears dirty state and restores current values.
- `预览并保存` calls PATCH with `dryRun:true` and switches to Diff tab.
- Saving from Diff tab calls PATCH with `dryRun:false`.

Run:

```bash
cd webui
npm test -- agent-detail
```

Expected: FAIL for sticky bar labels and behavior.

**Step 2: Implement sticky save bar**

Replace the current non-sticky bottom action area with a sticky bar. Keep existing dirty state variables and mutation flow.

CSS requirement:

- `position: sticky`
- `bottom: 0`
- visible border/background
- page bottom padding so content is not hidden

**Step 3: Run tests**

```bash
cd webui
npm test -- agent-detail
```

Expected: PASS.

**Step 4: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentDetail.tsx webui/src/app/app.css webui/src/__tests__/agent-detail.test.tsx
git commit -m "feat(webui): add sticky save flow for agent edits"
```

## Task 5: Effective Permissions Tree

**Files:**

- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Test: `webui/src/__tests__/agent-detail.test.tsx`

**Step 1: Write failing tests**

Cover:

- Sources are grouped by connection then schema.
- Tools are visible as allowed tool badges or list items.
- `legacyAllow` renders a migration warning.
- Permission warnings render as readable text.

Run:

```bash
cd webui
npm test -- agent-detail
```

Expected: FAIL.

**Step 2: Implement grouping helper**

Add a local helper:

```ts
function groupSourcesByConnectionAndSchema(sources: EffectivePermissionsPreview["sources"]) {
  // Return a render-friendly nested array or Map.
}
```

Keep the helper pure and covered through UI tests.

**Step 3: Render the tree**

Render connection -> schema -> source rows. Keep stable keys based on connection, schema, sourceName, and table.

**Step 4: Run tests**

```bash
cd webui
npm test -- agent-detail
```

Expected: PASS.

**Step 5: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentDetail.tsx webui/src/__tests__/agent-detail.test.tsx
git commit -m "feat(webui): render agent effective permissions tree"
```

## Task 6: Token Tab Active Token Operations

**Files:**

- Modify: `webui/src/pages/admin/AgentDetail.tsx`
- Test: `webui/src/__tests__/agent-detail.test.tsx`
- Optional server test if behavior changes: `webui/server/__tests__/admin-tokens.test.ts`

**Step 1: Write failing tests**

Cover:

- Token tab displays label, created, expires_at, last_used, last_tool, last_outcome, and hash prefix.
- `生成新 Token` links to `/admin/agents/:userId/tokens/new`.
- `撤销` calls DELETE and refreshes the agent query.

Run:

```bash
cd webui
npm test -- agent-detail
```

Expected: FAIL for any missing token display fields.

**Step 2: Tighten token list rendering**

Keep the current active-token model. Do not add revoked history in this task.

**Step 3: Run tests**

```bash
cd webui
npm test -- agent-detail
```

Expected: PASS.

**Step 4: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentDetail.tsx webui/src/__tests__/agent-detail.test.tsx
git commit -m "feat(webui): improve agent token operations"
```

## Task 7: Integration Verification

**Files:**

- Modify only files touched by previous tasks if failures require fixes.

**Step 1: Run focused suite**

```bash
cd webui
npm test -- agent-list agent-detail new-token admin-agents admin-tokens
```

Expected: PASS.

**Step 2: Run build**

```bash
cd webui
npm run build
```

Expected: PASS.

**Step 3: Manual smoke**

Start the WebUI dev server and verify:

- `/admin/agents` list renders.
- Copy MCP config produces safe placeholder config.
- Create Agent shows role permission card and diff.
- Generate Token shows one-time delivery snippets.
- Edit Agent shows sticky save bar and diff.

**Step 4: Commit checkpoint**

```bash
git add webui/src/pages/admin/AgentList.tsx webui/src/pages/admin/AgentDetail.tsx webui/src/pages/admin/NewToken.tsx webui/src/app/app.css webui/src/__tests__/agent-list.test.tsx webui/src/__tests__/agent-detail.test.tsx webui/src/__tests__/new-token.test.tsx
git commit -m "test(webui): verify agent admin enterprise delivery"
```

## Execution Handoff

Plan complete and saved to `webui/docs/codex/wo-M11-agent-admin-enterprise-delivery.md`.

Recommended execution option: Subagent-driven in this session or a dedicated minimax builder session, one task at a time with review between commits.
