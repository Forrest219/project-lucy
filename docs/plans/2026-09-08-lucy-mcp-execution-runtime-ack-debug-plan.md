# Lucy MCP Execution Runtime Ack Debug Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add execution-layer runtime acknowledgement and debug surfaces so Lucy can detect when WebUI config and the MCP / KTX execution runtime disagree.

**Architecture:** Keep `ktx.yaml`, `access.yaml`, static Catalog reload, and Policy Runtime as existing facts of record. Add a narrow execution-runtime status/canary service, expose explicit ack fields, and classify stale KTX connection errors without storing secrets or running broad data queries.

**Review correction (2026-09-08):** `ktx connection test` starts a fresh CLI process and rereads current disk config, so it cannot acknowledge the resident KTX MCP execution runtime. Positive `executionRuntimeAck` requires runtime-native introspection or a successful `lucy_query` observation tied to the current `ktx.yaml` digest. Reachable-but-unproven state is `unknown` / `blocked`, never `pass`.

**Tech Stack:** TypeScript, Fastify, React, Vitest, Supertest, existing Lucy WebUI server modules, existing `.ktx-ui/audit.sqlite` audit path.

---

## Task 1: Backend Runtime Status Service

**Files:**

- Create: `webui/server/admin/mcp-runtime.ts`
- Modify: `webui/server/index.ts`
- Test: `webui/server/__tests__/mcp-runtime-status.test.ts`

**Step 1: Write failing tests**

Add tests for:

- `GET /api/admin/mcp-runtime/status` returns config connection ids from `ktx.yaml`.
- It includes Policy Runtime status from `getPolicyRuntimeStatus()`.
- It returns `execution.status="unknown"` when execution introspection is not available.
- It returns `execution.status="unavailable"` when the KTX MCP upstream cannot be reached within the short probe timeout.
- It redacts secrets and never returns password values.

Run:

```bash
cd webui && npm test -- --run server/__tests__/mcp-runtime-status.test.ts
```

Expected: fail because the route does not exist.

**Step 2: Implement route registration**

Create `registerMcpRuntimeRoutes(app)` in `webui/server/admin/mcp-runtime.ts`.

Implementation outline:

```ts
app.get("/api/admin/mcp-runtime/status", async () => {
  const projectRoot = await resolveProjectRoot();
  const project = await readProject(projectRoot);
  const policy = getPolicyRuntimeStatus();
  const catalog = await readCatalogReloadHistory(projectRoot).catch(() => undefined);

  return {
    ok: true,
    data: {
      endpoint: project.mcpEndpoint,
      config: {
        projectRoot,
        ktxYamlDigest: await digestFile(path.join(projectRoot, "ktx.yaml")),
        connectionIds: project.connections.map((conn) => conn.id).sort()
      },
      catalog: summarizeCatalog(catalog),
      policy: {
        ...policy,
        healthy: isPolicyRuntimeHealthy(policy)
      },
      execution: await summarizeExecutionRuntime({
        ktxYamlDigest,
        connectionIds: project.connections.map((conn) => conn.id)
      })
    }
  };
});
```

Use existing helpers where available; keep new helpers local until reused.

**Step 3: Register route**

Import and register the route in `webui/server/index.ts` near other admin routes.

**Step 4: Run test**

```bash
cd webui && npm test -- --run server/__tests__/mcp-runtime-status.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add webui/server/admin/mcp-runtime.ts webui/server/index.ts webui/server/__tests__/mcp-runtime-status.test.ts
git commit -m "feat: add MCP runtime status endpoint"
```

## Task 2: Execution Canary API

**Files:**

- Modify: `webui/server/admin/mcp-runtime.ts`
- Test: `webui/server/__tests__/mcp-runtime-canary.test.ts`

**Step 1: Write failing tests**

Cover:

- Missing `connectionId` returns 400.
- Connection absent from disk config returns `status="fail"`.
- Connection present, upstream reachable, and no connection-level runtime proof returns `status="blocked"` and `executionRuntimeAck=false`.
- A successful standalone `ktx connection test` is never used as positive execution acknowledgement.
- A recent successful `lucy_query` observation for the same connection and current `ktx.yaml` digest returns `executionRuntimeAck=true`.
- Upstream unavailable returns `status="fail"` with `decisionReason="execution_runtime_unavailable"`.

Run:

```bash
cd webui && npm test -- --run server/__tests__/mcp-runtime-canary.test.ts
```

Expected: fail because route does not exist.

**Step 2: Add route**

Add:

```text
POST /api/admin/mcp-runtime/canary
```

Default `mode` should be `connection`. Probe the configured KTX MCP upstream with the server-side internal token and a short timeout. This probe proves availability only. Do not call `testConnection()` to derive execution acknowledgement. Do not require or persist a plaintext Agent Token.

**Step 3: Add response shape**

Return:

```ts
{
  connectionId,
  status: "pass" | "fail" | "blocked",
  checks: [
    { name: "config", status, detail },
    { name: "execution_query" | "execution_tools_list" | "config", status, detail }
  ],
  executionRuntimeAck,
  decisionReason
}
```

Until KTX exposes runtime config introspection, the route may return `blocked` after a successful `execution_tools_list` availability check. It may return `pass` only when a current-digest successful `lucy_query` observation exists.

**Step 4: Run tests**

```bash
cd webui && npm test -- --run server/__tests__/mcp-runtime-canary.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add webui/server/admin/mcp-runtime.ts webui/server/__tests__/mcp-runtime-canary.test.ts
git commit -m "feat: add MCP runtime canary"
```

## Task 3: Stale Execution Error Classification

**Files:**

- Modify: `webui/server/proxy/mcp-proxy.ts`
- Test: `webui/server/__tests__/mcp-proxy-execution-stale.test.ts`

**Step 1: Write failing test**

Simulate a buffered `lucy_query` upstream response with body text:

```text
Connection "zijin" is not configured in ktx.yaml.
```

Set disk config to include `connections.zijin`.

Expected audit row:

```ts
decisionReason === "execution_config_stale"
outcome === "error"
```

Run:

```bash
cd webui && npm test -- --run server/__tests__/mcp-proxy-execution-stale.test.ts
```

Expected: fail; current reason is generic `upstream_error`.

**Step 2: Implement classifier**

Add a helper in `mcp-proxy.ts` (and a small shared observation store if needed):

```ts
function classifyUpstreamToolError(body: unknown, args: Record<string, unknown>): string {
  const connectionId = typeof args.connectionId === "string" ? args.connectionId : "";
  if (!connectionId) return "upstream_error";
  if (containsConnectionMissingError(body, connectionId) && diskConfigHasConnection(connectionId)) {
    return "execution_config_stale";
  }
  return "upstream_error";
}
```

Keep disk config reads bounded and best-effort. If checking disk fails, preserve `upstream_error`.

Escape the connection id before regex matching, accept existing argument aliases (`connectionId`, `connection_id`, `connection`), and inspect JSON/SSE tool-result text without logging result rows. On successful `lucy_query`, record positive evidence with the current `ktx.yaml` digest; do not treat `lucy_read_source` success as query-runtime acknowledgement.

**Step 3: Use reason in audit metadata**

In buffered `lucy_query` / `lucy_read_source` response handling, replace generic `upstream_error` with the classifier output.

**Step 4: Run tests**

```bash
cd webui && npm test -- --run server/__tests__/mcp-proxy-execution-stale.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add webui/server/proxy/mcp-proxy.ts webui/server/__tests__/mcp-proxy-execution-stale.test.ts
git commit -m "feat: classify stale MCP execution config"
```

## Task 4: Explicit Ack Fields On Write Responses

**Files:**

- Modify: `webui/server/index.ts`
- Modify: `webui/server/admin/access-config.ts`
- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/src/lib/types.ts`
- Test: existing API tests plus targeted updates:
  - `webui/server/__tests__/api.save.test.ts`
  - `webui/server/__tests__/admin-agents.test.ts`
  - `webui/server/__tests__/policy-compile.test.ts`

**Step 1: Write failing assertions**

For enabled tables and access config writes, assert response contains:

```ts
policyRuntimeAck: true
catalogRuntimeAck?: boolean
executionRuntimeAck?: boolean
runtimeAck: true
```

`runtimeAck` remains for backwards compatibility.

**Step 2: Implement response mapping**

Keep existing behavior stable:

```ts
runtimeAck = policyRuntimeAck
```

Set `executionRuntimeAck` to `undefined` when a route does not run the new canary. When it does run, preserve `false + execution_canary_blocked` rather than converting an unproven state into success.

**Step 3: Wire canary only for connection/table writes**

For `POST /api/connections` and `PUT /api/connections/:connId/enabled-tables`, run the connection-mode canary after disk write and Policy Runtime commit. A newly changed digest normally yields `blocked` until runtime-native introspection or a successful current-digest query supplies proof.

**Step 4: Run tests**

```bash
cd webui && npm test -- --run server/__tests__/api.save.test.ts server/__tests__/admin-agents.test.ts server/__tests__/policy-compile.test.ts
```

Expected: pass.

**Step 5: Commit**

```bash
git add webui/server/index.ts webui/server/admin/access-config.ts webui/server/admin/agents.ts webui/src/lib/types.ts webui/server/__tests__/api.save.test.ts webui/server/__tests__/admin-agents.test.ts webui/server/__tests__/policy-compile.test.ts
git commit -m "feat: expose explicit runtime ack fields"
```

## Task 5: Admin UI Debug Surfaces

**Files:**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/admin/McpPlayground.tsx`
- Modify: `webui/src/lib/types.ts`
- Test:
  - `webui/src/__tests__/connection-overview.test.tsx`
  - `webui/src/__tests__/mcp-playground.test.tsx`

**Step 1: Write failing UI tests**

Assert stale execution state renders:

```text
配置已写入，但 MCP 执行层尚未确认加载。请重启或 reload MCP 执行进程后重新检测。
```

Assert technical terms are protected with `notranslate` / `translate="no"` where rendered in DOM.

**Step 2: Add status chips**

Add separate chips for:

- Config
- Catalog
- Policy Runtime
- MCP Execution

Keep layout compact; do not add a new landing page or decorative panel.

**Step 3: Add action**

Add `重新检测执行层`, calling `POST /api/admin/mcp-runtime/canary`.

**Step 4: Run tests**

```bash
cd webui && npm test -- --run src/__tests__/connection-overview.test.tsx src/__tests__/mcp-playground.test.tsx
```

Expected: pass.

**Step 5: Commit**

```bash
git add webui/src/pages/connections/ConnectionOverview.tsx webui/src/pages/admin/McpPlayground.tsx webui/src/lib/types.ts webui/src/__tests__/connection-overview.test.tsx webui/src/__tests__/mcp-playground.test.tsx
git commit -m "feat: surface MCP execution runtime diagnostics"
```

## Task 6: Docs And Regression Evidence

**Files:**

- Modify: `docs/specs/lucy-mcp-execution-runtime-ack-debug-spec.md`
- Modify: `webui/docs/03-api-spec.md`
- Modify: `inbox/2026-09-08-finbp-nbcb-funds-mcp-runtime-runbook.md`
- Optional Modify: `docs/governance/project-overview.md` if this spec should be listed in the project index.

**Step 1: Update docs from implementation**

Adjust API response examples to match actual field names.

**Step 2: Run terminology/spec checks**

```bash
npm run lint:terminology
npm run lint:spec
```

Expected: pass or produce only unrelated existing warnings. Fix new warnings.

**Step 3: Run focused test suite**

```bash
cd webui && npm test -- --run server/__tests__/mcp-runtime-status.test.ts server/__tests__/mcp-runtime-canary.test.ts server/__tests__/mcp-proxy-execution-stale.test.ts
```

Expected: pass.

**Step 4: Final commit**

```bash
git add docs/specs/lucy-mcp-execution-runtime-ack-debug-spec.md inbox/2026-09-08-finbp-nbcb-funds-mcp-runtime-runbook.md docs/governance/project-overview.md
git commit -m "docs: document MCP execution runtime debug upgrade"
```

## Rollout Checklist

- Stage with a fixture where disk config contains `zijin` but mock KTX upstream reports it missing.
- Verify audit reason is `execution_config_stale`.
- Verify admin UI shows restart/reload remediation.
- Verify existing Agent / Role / Token write paths still return `runtimeAck`.
- Verify no test snapshots include plaintext Token or secret content.

## Execution Choice

Plan complete and saved to `docs/plans/2026-09-08-lucy-mcp-execution-runtime-ack-debug-plan.md`.

Recommended execution path: implement Task 1 through Task 3 first, because they provide backend diagnosis and audit value without broad UI changes. Then land explicit ack fields and UI chips in a second pass.
