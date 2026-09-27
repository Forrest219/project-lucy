# KTX Upstream Session Fix Merge and Test Implementation Plan

**Goal:** Merge `origin/cursor/fix-ktx-upstream-session-handling-c7fd` into local `main` without regressing the newer MCP execution-status, row-policy, skill, or audit behavior, then prove the customer-reported Session failure is closed.

**Architecture:** Keep the branch's gateway-owned KTX transport Session design: cache the upstream Session by Lucy `userId`, supply it only when a client omitted `Mcp-Session-Id`, and perform one complete recovery handshake plus one retry after KTX rejects Session traffic. Preserve current `main` behavior added after the branch diverged, especially `execution_stale` classification and successful-query runtime acknowledgement. Convert non-JSON-RPC upstream transport failures into safe JSON-RPC errors and record the real failure in audit logs.

**Tech Stack:** TypeScript, Node.js HTTP server, MCP Streamable HTTP, Vitest, better-sqlite3, Docker Compose.

---

## Scope and merge facts

- Source branch: `origin/cursor/fix-ktx-upstream-session-handling-c7fd` at `37188d17802e1e60f012160cddc748962fdc25d1` after the 2026-09-27 fetch.
- Target: local `main`; do not push `main` unless separately requested.
- Source commits retained through a non-fast-forward merge:
  - `5c342eb` — normalize and audit upstream transport failures.
  - `43dd169` — hold and recover the KTX transport Session in Lucy Proxy.
  - `37188d1` — expose measurable and actionable Session diagnostics.
- Current local-only/untracked paths `docs/access-control/adr-row-policy-next-iteration.md` and `var/` are unrelated and must not be staged, modified, or removed.
- Read-only `git merge-tree` predicts three textual conflict blocks, all in `webui/server/proxy/mcp-proxy.ts`. The spec and three added files merge without textual conflicts.
- No browser or mobile test is required: this is an MCP transport change with no UI behavior.

## Acceptance criteria

1. A client may run `initialize`, omit `Mcp-Session-Id` on later calls, and still use `lucy_catalog`, `lucy_read_source`, and `lucy_query` successfully.
2. Lucy never overwrites a client-supplied Session on the first attempt.
3. A rejected or stale Session triggers one complete `initialize` plus `notifications/initialized`, followed by exactly one business-request retry.
4. A persistent KTX Session refusal becomes HTTP 200 plus a JSON-RPC error with reason `upstream_session_required`; raw upstream text is excluded from the client response and retained only in audit detail.
5. Other non-JSON upstream failures become `upstream_protocol_error`.
6. `DELETE /mcp` and local initialize fallback evict the held upstream Session.
7. `LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE=false` restores pass-through-only behavior.
8. Session recovery changes audit reason from `allowed` to `upstream_session_recovered`, but never overwrites a real reason such as `execution_stale`, row-policy denial, tool error, or result-enrichment failure.
9. Existing MCP proxy, instructions injection, row-policy, skill ACL, execution-status, SSE normalization, and full WebUI tests remain green.

### Task 1: Establish a clean baseline

**Files:**
- Inspect only: repository status and the five merge-target files.

**Step 1: Verify refs and worktree scope**

Run:

```bash
git status --short --branch
git rev-parse main origin/cursor/fix-ktx-upstream-session-handling-c7fd
```

Expected: branch is `main`; only the previously identified unrelated untracked paths are present; source ref is `37188d1...`.

**Step 2: Run the pre-merge focused baseline**

Run:

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-proxy-smoke.test.ts \
  server/__tests__/mcp-proxy-instructions.test.ts \
  server/__tests__/mcp-proxy-execution-stale.test.ts \
  server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts \
  server/__tests__/mcp-proxy-skills.test.ts
```

Expected: all selected current-main tests pass. If the baseline fails, stop before merging and report the pre-existing failure.

### Task 2: Merge the remote fix branch

**Files:**
- Modify: `webui/docs/07-mcp-auth-proxy-spec.md`
- Modify: `webui/server/proxy/mcp-proxy.ts`
- Create: `webui/server/proxy/upstream-session.ts`
- Create: `webui/server/__tests__/mcp-proxy-upstream-failure.test.ts`
- Create: `webui/server/__tests__/mcp-proxy-upstream-session.test.ts`

**Step 1: Start a non-fast-forward merge without committing**

Run:

```bash
git merge --no-ff --no-commit origin/cursor/fix-ktx-upstream-session-handling-c7fd
```

Expected: `webui/server/proxy/mcp-proxy.ts` conflicts; the other four branch files merge or add cleanly.

**Step 2: Resolve the additive helper conflict**

In `webui/server/proxy/mcp-proxy.ts`, retain both groups:

- Current-main helpers `toolConnectionId(...)`, `recordSuccessfulQueryObservation(...)`, and their runtime acknowledgement behavior.
- Branch helpers `classifyUpstreamFailure(...)`, `isSessionRequiredFailure(...)`, `sessionRequiredHint(...)`, and related upstream failure types/constants.

Place them as independent functions; do not choose one side over the other.

**Step 3: Resolve both decision-reason conflicts**

Preserve the current-main calculation:

```ts
const decisionReason = outcome === "ok"
  ? (metaFailed ? "lucy_result_meta_failed" : "allowed")
  : await classifyUpstreamToolError(originalBody, toolArgs);
```

For both the audit row and trace event, use:

```ts
withUpstreamSessionNote(decisionReason, session)
```

This is required because `withUpstreamSessionNote` only replaces the literal `allowed`; it must preserve `execution_stale`, `upstream_error`, and other real outcomes.

**Step 4: Check the resolved diff before committing**

Run:

```bash
git diff --check
git diff --name-status --cached
git diff --cached -- webui/server/proxy/mcp-proxy.ts webui/server/proxy/upstream-session.ts
```

Expected: no conflict markers or whitespace errors; only the five branch files are staged. The unrelated untracked paths remain untouched.

### Task 3: Run Session-specific regression tests

**Files:**
- Test: `webui/server/__tests__/mcp-proxy-upstream-failure.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-upstream-session.test.ts`

**Step 1: Run the new transport-failure suite**

Run:

```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/mcp-proxy-upstream-failure.test.ts
```

Expected: all cases pass, including plain-text Session rejection → JSON-RPC, sanitized client error, and `outcome=error` audit assertions.

**Step 2: Run the new upstream-Session suite**

Run:

```bash
cd webui
npx vitest run --maxWorkers=1 server/__tests__/mcp-proxy-upstream-session.test.ts
```

Expected: all cases pass, including omitted client Session, one-time recovery, kill switch, DELETE eviction, diagnostic hints, and local/upstream tool availability parity.

**Step 3: Confirm merge-conflict semantics**

Run:

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-proxy-upstream-session.test.ts \
  server/__tests__/mcp-proxy-execution-stale.test.ts
```

Expected: recovery remains observable while a genuine `execution_stale` result keeps its real decision reason.

### Task 4: Run the impacted MCP regression set

**Files:**
- Test: `webui/server/__tests__/mcp-proxy-smoke.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-instructions.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-sse-early-headers.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-skills.test.ts`
- Test: `webui/server/__tests__/mcp-proxy-trace.test.ts`

**Step 1: Run impacted tests together**

Run:

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-proxy-smoke.test.ts \
  server/__tests__/mcp-proxy-instructions.test.ts \
  server/__tests__/mcp-proxy-sse-early-headers.test.ts \
  server/__tests__/mcp-proxy-row-policy-by01-by18.test.ts \
  server/__tests__/mcp-proxy-skills.test.ts \
  server/__tests__/mcp-proxy-trace.test.ts \
  server/__tests__/mcp-proxy-execution-stale.test.ts \
  server/__tests__/mcp-proxy-upstream-failure.test.ts \
  server/__tests__/mcp-proxy-upstream-session.test.ts
```

Expected: all impacted suites pass with no hanging SSE requests or audit assertion regressions.

### Task 5: Run repository gates

**Files:**
- Verify only: all `webui` source and tests.

**Step 1: Run terminology and IA lint**

Run:

```bash
cd webui
npm run lint:terminology
npm run lint:ia-boundary
```

Expected: both commands pass.

**Step 2: Run the full WebUI test suite**

Run:

```bash
cd webui
npm test
```

Expected: pretest lint and the complete Vitest suite pass.

**Step 3: Build the WebUI/server package**

Run:

```bash
cd webui
npm run build
```

Expected: production build completes without TypeScript or bundling errors.

### Task 6: Commit and report

**Files:**
- Commit only the merge result and this plan; exclude unrelated untracked paths.

**Step 1: Review final scope**

Run:

```bash
git status --short
git diff --check --cached
```

Expected: the five merged implementation/spec/test files and this plan are the only staged changes; unrelated untracked paths remain untracked.

**Step 2: Create the merge commit**

Run:

```bash
git commit
```

Use the merge message generated by Git, retaining the source branch identity.

**Step 3: Verify commit ancestry and repository state**

Run:

```bash
git merge-base --is-ancestor 37188d1 HEAD
git log -1 --oneline --decorate
git status --short --branch
```

Expected: the ancestry command exits 0; `HEAD` is the merge commit on local `main`; unrelated untracked paths are still present and untouched.

**Step 4: Delivery report**

Report:

- Merge commit SHA and the three included source commits.
- Exact conflict resolutions applied.
- Focused, impacted, full-suite, lint, and build results with pass counts.
- Any test not run and the reason.
- Explicitly state that `main` was not pushed unless a later user request authorizes the push.

## Optional deployment UAT after merge

This is not required to create the source merge commit. Before releasing a customer image, rebuild Lucy and run one authenticated MCP Session test against the new container:

1. Send `initialize` and retain the response for evidence.
2. Deliberately omit `Mcp-Session-Id` from subsequent `lucy_catalog`, `lucy_read_source`, and `lucy_query` calls.
3. Confirm all three return successful JSON-RPC results.
4. Restart or invalidate the KTX Session and repeat one query.
5. Confirm one recovery handshake, one retry, and audit reason `upstream_session_recovered`.
6. Force a persistent upstream refusal and confirm the client receives sanitized JSON-RPC reason `upstream_session_required`, while the audit row records `outcome=error`.

Use a test token supplied through the normal runtime secret mechanism; do not read, print, or commit `.ktx/secrets/` contents.
