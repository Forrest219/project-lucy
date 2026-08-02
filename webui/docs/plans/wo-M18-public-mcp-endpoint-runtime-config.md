# M18 Public MCP Endpoint Runtime Config Work Order

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Lucy's advertised MCP endpoint a single deployment/runtime configuration consumed by all WebUI MCP config surfaces.

**Architecture:** Add a backend runtime resolver for `LUCY_PUBLIC_MCP_URL`, expose the resolved endpoint through `GET /api/project`, and refactor frontend MCP config generation to use one shared helper and one API field. Preserve local development through an explicit fallback state while preventing customer deployments from silently copying guessed `localhost`, `127.0.0.1`, or browser-derived endpoints.

**Tech Stack:** Fastify, TypeScript, Node `URL`, React 19, TanStack Query, React Router, Vitest, Testing Library, existing `apiClient`, existing CSS in `webui/src/app/app.css`.

**Source Spec:** [../22-public-mcp-endpoint-runtime-config-spec.md](../22-public-mcp-endpoint-runtime-config-spec.md)

---

## Context For Developer

Read these documents before coding:

- `webui/docs/22-public-mcp-endpoint-runtime-config-spec.md`
- `webui/docs/07-mcp-auth-proxy-spec.md`
- `webui/docs/14-agent-admin-enterprise-delivery-spec.md`
- `webui/docs/19-system-overview-runtime-monitoring-spec.md`
- `docs/agent-integration-guide.md`
- `docs/deployment-docker.md`
- `docs/customer-deployment-guide.md`
- `docs/DEVELOPMENT.md`

Read these backend files:

- `webui/server/index.ts`
- `webui/server/project.ts`
- `webui/server/model.ts`
- `webui/server/__tests__/project.test.ts`

Read these frontend files:

- `webui/src/lib/types.ts`
- `webui/src/lib/queryKeys.ts`
- `webui/src/pages/Onboarding.tsx`
- `webui/src/pages/connections/ConnectionOverview.tsx`
- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/NewToken.tsx`

Read these frontend tests:

- `webui/src/__tests__/onboarding.test.tsx`
- `webui/src/__tests__/connection-overview.test.tsx`
- `webui/src/__tests__/agent-list.test.tsx`
- `webui/src/__tests__/new-token.test.tsx`

Non-negotiable boundaries:

- Do not infer public MCP endpoint from `window.location`, WebUI host, `Host`, or `X-Forwarded-*`.
- Do not introduce K8s-specific assumptions; `LUCY_PUBLIC_MCP_URL` is deployment-method agnostic.
- Do not change Lucy MCP Proxy bind behavior or upstream forwarding.
- Do not introduce DNS, TLS, Ingress, Nginx, OAuth, or public reachability checks.
- Do not expose or log token plaintext beyond the existing Token first-show behavior.
- Do not use fallback as if it were configured; surface fallback state in UI copy.
- Keep API envelope style: success `{ ok: true, data }`; failure `{ ok: false, error }`.
- Treat existing dirty worktree changes as user-owned unless they are directly part of this work order.

---

## Task 1: Backend Runtime Resolver

**Files:**

- Create: `webui/server/runtime-config.ts`
- Test: `webui/server/__tests__/runtime-config.test.ts`

**Step 1: Write failing tests for configured endpoint**

Create `webui/server/__tests__/runtime-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveMcpEndpoint } from "../runtime-config";

describe("resolveMcpEndpoint", () => {
  it("uses LUCY_PUBLIC_MCP_URL when it is a valid public endpoint", () => {
    expect(resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp" })).toEqual({
      url: "https://lucy.example.com/mcp",
      status: "configured",
      source: "env",
      configured: true,
      diagnostics: []
    });
  });
});
```

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/runtime-config.test.ts
```

Expected: FAIL because `runtime-config.ts` does not exist.

**Step 2: Implement configured endpoint resolver**

Create `webui/server/runtime-config.ts`:

```ts
export type McpEndpointStatus = "configured" | "fallback" | "invalid";

export type McpEndpointInfo = {
  url: string | null;
  status: McpEndpointStatus;
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: Array<{
    code:
      | "MISSING_PUBLIC_MCP_URL"
      | "INVALID_PUBLIC_MCP_URL"
      | "UNSUPPORTED_PUBLIC_MCP_PROTOCOL"
      | "MCP_PATH_RECOMMENDED";
    message: string;
  }>;
};

export const LOCAL_MCP_ENDPOINT = "http://127.0.0.1:7879/mcp";

export function resolveMcpEndpoint(env: Pick<NodeJS.ProcessEnv, "LUCY_PUBLIC_MCP_URL"> = process.env): McpEndpointInfo {
  const raw = env.LUCY_PUBLIC_MCP_URL?.trim();
  if (!raw) {
    return {
      url: LOCAL_MCP_ENDPOINT,
      status: "fallback",
      source: "fallback",
      configured: false,
      diagnostics: [
        {
          code: "MISSING_PUBLIC_MCP_URL",
          message: "LUCY_PUBLIC_MCP_URL is not configured; using local development MCP endpoint."
        }
      ]
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return {
      url: null,
      status: "invalid",
      source: "env",
      configured: false,
      diagnostics: [
        {
          code: "INVALID_PUBLIC_MCP_URL",
          message: "LUCY_PUBLIC_MCP_URL must be a valid absolute URL."
        }
      ]
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      url: null,
      status: "invalid",
      source: "env",
      configured: false,
      diagnostics: [
        {
          code: "UNSUPPORTED_PUBLIC_MCP_PROTOCOL",
          message: "LUCY_PUBLIC_MCP_URL must use http or https."
        }
      ]
    };
  }

  const diagnostics: McpEndpointInfo["diagnostics"] = [];
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith("/mcp")) {
    diagnostics.push({
      code: "MCP_PATH_RECOMMENDED",
      message: "Lucy MCP endpoints should normally end with /mcp."
    });
  }

  return {
    url: parsed.toString(),
    status: "configured",
    source: "env",
    configured: true,
    diagnostics
  };
}
```

**Step 3: Add fallback and invalid tests**

Add tests:

```ts
it("falls back to the local development endpoint when env is missing", () => {
  expect(resolveMcpEndpoint({}).status).toBe("fallback");
  expect(resolveMcpEndpoint({}).url).toBe("http://127.0.0.1:7879/mcp");
});

it("returns invalid state for malformed env values", () => {
  expect(resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "not-a-url" })).toMatchObject({
    url: null,
    status: "invalid",
    source: "env",
    configured: false
  });
});

it("rejects unsupported URL protocols", () => {
  expect(resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "ftp://lucy.example.com/mcp" }).status).toBe("invalid");
});

it("keeps configured status but emits a diagnostic when path is not /mcp", () => {
  const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/agent" });
  expect(result.status).toBe("configured");
  expect(result.diagnostics.map((item) => item.code)).toContain("MCP_PATH_RECOMMENDED");
});

it("accepts /mcp with a trailing slash without rewriting the configured URL", () => {
  const result = resolveMcpEndpoint({ LUCY_PUBLIC_MCP_URL: "https://lucy.example.com/mcp/" });
  expect(result.status).toBe("configured");
  expect(result.url).toBe("https://lucy.example.com/mcp/");
  expect(result.diagnostics.map((item) => item.code)).not.toContain("MCP_PATH_RECOMMENDED");
});
```

**Step 4: Run resolver tests**

Run:

```bash
npm test -- --run server/__tests__/runtime-config.test.ts
```

Expected: PASS.

---

## Task 2: Expose MCP Endpoint Through Project API

**Files:**

- Modify: `webui/server/model.ts`
- Modify: `webui/server/project.ts`
- Modify: `webui/src/lib/types.ts`
- Test: `webui/server/__tests__/project.test.ts`

**Step 1: Write failing project model/API tests**

In `webui/server/__tests__/project.test.ts`, add or update an assertion on `readProject(...)`:

```ts
expect(project.mcpEndpoint).toMatchObject({
  url: "http://127.0.0.1:7879/mcp",
  status: "fallback",
  source: "fallback",
  configured: false
});
```

Add an env-specific test if the existing test helper can safely pass env or stub `process.env`:

```ts
process.env.LUCY_PUBLIC_MCP_URL = "https://lucy.example.com/mcp";
const project = await readProject(root);
expect(project.mcpEndpoint.url).toBe("https://lucy.example.com/mcp");
```

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/project.test.ts
```

Expected: FAIL because `ProjectInfo` has no `mcpEndpoint`.

**Step 2: Add shared model type**

In `webui/server/model.ts`, add:

```ts
export type McpEndpointInfo = {
  url: string | null;
  status: "configured" | "fallback" | "invalid";
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: Array<{
    code:
      | "MISSING_PUBLIC_MCP_URL"
      | "INVALID_PUBLIC_MCP_URL"
      | "UNSUPPORTED_PUBLIC_MCP_PROTOCOL"
      | "MCP_PATH_RECOMMENDED";
    message: string;
  }>;
};
```

Then extend `ProjectInfo`:

```ts
export type ProjectInfo = {
  root: string;
  connections: ConnectionInfo[];
  ktxAvailable: boolean;
  mcpEndpoint: McpEndpointInfo;
};
```

Mirror the same type additions in `webui/src/lib/types.ts`.

**Step 3: Populate project response**

In `webui/server/project.ts`, import the resolver:

```ts
import { resolveMcpEndpoint } from "./runtime-config";
```

Add the field in `readProject(...)`:

```ts
return {
  root: projectRoot,
  connections,
  ktxAvailable: true,
  mcpEndpoint: resolveMcpEndpoint()
};
```

**Step 4: Run backend tests**

Run:

```bash
npm test -- --run server/__tests__/runtime-config.test.ts server/__tests__/project.test.ts
```

Expected: PASS.

---

## Task 3: Frontend Shared MCP Config Helpers

**Files:**

- Create: `webui/src/lib/mcpEndpoint.ts`
- Test: `webui/src/__tests__/mcp-endpoint.test.ts`

**Step 1: Write failing helper tests**

Create `webui/src/__tests__/mcp-endpoint.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCodexMcpToml, buildMcpConfig } from "../lib/mcpEndpoint";

describe("MCP endpoint helpers", () => {
  it("builds the canonical MCP JSON config", () => {
    const parsed = JSON.parse(buildMcpConfig("https://lucy.example.com/mcp"));
    expect(parsed.mcpServers.lucy).toEqual({
      type: "http",
      url: "https://lucy.example.com/mcp",
      headers: {
        Authorization: "Bearer <LUCY_AGENT_TOKEN>"
      }
    });
  });

  it("builds the Codex TOML snippet", () => {
    expect(buildCodexMcpToml("https://lucy.example.com/mcp", "<LUCY_AGENT_TOKEN>")).toContain(
      'url = "https://lucy.example.com/mcp"'
    );
  });
});
```

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/mcp-endpoint.test.ts
```

Expected: FAIL because the helper file does not exist.

**Step 2: Implement helper**

Create `webui/src/lib/mcpEndpoint.ts`:

```ts
export function buildMcpConfig(endpoint: string, tokenPlaceholder = "<LUCY_AGENT_TOKEN>"): string {
  return JSON.stringify(
    {
      mcpServers: {
        lucy: {
          type: "http",
          url: endpoint,
          headers: {
            Authorization: `Bearer ${tokenPlaceholder}`
          }
        }
      }
    },
    null,
    2
  );
}

export function buildCodexMcpToml(endpoint: string, tokenPlaceholder = "<LUCY_AGENT_TOKEN>"): string {
  return [
    "# In ~/.codex/config.toml",
    "[mcp_servers.lucy]",
    `url = "${endpoint}"`,
    'type = "http"',
    `headers = { Authorization = "Bearer ${tokenPlaceholder}" }`
  ].join("\n");
}
```

**Step 3: Run helper tests**

Run:

```bash
npm test -- src/__tests__/mcp-endpoint.test.ts
```

Expected: PASS.

---

## Task 4: Refactor Onboarding And Connections

**Files:**

- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Test: `webui/src/__tests__/onboarding.test.tsx`
- Test: `webui/src/__tests__/connection-overview.test.tsx`

**Step 1: Update test fixtures**

In each test mock for `GET /api/project`, add:

```ts
mcpEndpoint: {
  url: "https://lucy.example.com/mcp",
  status: "configured",
  source: "env",
  configured: true,
  diagnostics: []
}
```

**Step 2: Write failing assertions**

In `webui/src/__tests__/onboarding.test.tsx`, assert:

```ts
expect(screen.getByText("https://lucy.example.com/mcp")).toBeInTheDocument();
expect(screen.queryByText("http://localhost:7879/mcp")).not.toBeInTheDocument();
expect(screen.queryByText("http://127.0.0.1:7879/mcp")).not.toBeInTheDocument();
```

In `webui/src/__tests__/connection-overview.test.tsx`, update copy assertion:

```ts
expect(writeText).toHaveBeenCalledWith("https://lucy.example.com/mcp");
```

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx
```

Expected: FAIL because the components still use local constants/browser-derived endpoint.

**Step 3: Refactor Onboarding**

In `webui/src/pages/Onboarding.tsx`:

- Remove local `buildMcpConfig`.
- Remove `defaultMcpEndpoint`.
- Import `buildMcpConfig` from `../lib/mcpEndpoint`.
- Set:

```ts
const endpointInfo = projectQuery.data?.mcpEndpoint;
const endpoint = endpointInfo?.url ?? null;
const mcpConfig = useMemo(() => (endpoint ? buildMcpConfig(endpoint) : ""), [endpoint]);
```

- Only render/copy config when `endpoint` is non-null.
- If `endpointInfo?.status === "fallback"`, render fallback notice.
- If `endpointInfo?.status === "invalid"`, render invalid diagnostic and disable copy.

**Step 4: Refactor ConnectionOverview**

In `webui/src/pages/connections/ConnectionOverview.tsx`:

- Remove `const MCP_ENDPOINT = "http://127.0.0.1:7879/mcp";`.
- Use `projectQuery.data?.mcpEndpoint.url`.
- If url is null, render diagnostics instead of copy button.
- Copy the API-provided URL.

**Step 5: Run page tests**

Run:

```bash
npm test -- src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx
```

Expected: PASS.

---

## Task 5: Refactor Agent Admin And Token Snippets

**Files:**

- Modify: `webui/src/pages/admin/AgentList.tsx`
- Modify: `webui/src/pages/admin/NewToken.tsx`
- Test: `webui/src/__tests__/agent-list.test.tsx`
- Test: `webui/src/__tests__/new-token.test.tsx`

**Step 1: Update tests to provide project endpoint**

Where the tests mock API calls, add `GET /api/project` response with:

```ts
mcpEndpoint: {
  url: "https://lucy.example.com/mcp",
  status: "configured",
  source: "env",
  configured: true,
  diagnostics: []
}
```

**Step 2: Write failing AgentList assertion**

In `webui/src/__tests__/agent-list.test.tsx`, update the copied config assertion:

```ts
expect(parsed.mcpServers.lucy.url).toBe("https://lucy.example.com/mcp");
```

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/agent-list.test.tsx
```

Expected: FAIL because `SAFE_MCP_URL` is still hard-coded.

**Step 3: Refactor AgentList**

In `webui/src/pages/admin/AgentList.tsx`:

- Remove `SAFE_MCP_URL`.
- Import and query `/api/project` using existing `apiGet<ProjectInfo>` and `queryKeys.project`.
- Change `buildSafeMcpConfig` signature:

```ts
export function buildSafeMcpConfig(endpoint: string): string
```

- Delegate to `buildMcpConfig(endpoint, "${LUCY_AGENT_TOKEN}")`.
- Disable or warn copy when `project.mcpEndpoint.url` is null.

**Step 4: Write failing NewToken assertions**

In `webui/src/__tests__/new-token.test.tsx`, assert generated Hermes/Claude/Generic snippets and Codex TOML contain:

```text
https://lucy.example.com/mcp
```

and do not contain:

```text
http://localhost:7879/mcp
```

Run:

```bash
npm test -- src/__tests__/new-token.test.tsx
```

Expected: FAIL because `MCP_URL` is still hard-coded.

**Step 5: Refactor NewToken**

In `webui/src/pages/admin/NewToken.tsx`:

- Remove `MCP_URL`.
- Import `buildMcpConfig` and `buildCodexMcpToml`.
- Query `/api/project`.
- Change `buildClientSnippets(token, endpoint)` to accept endpoint explicitly.
- Use generated token as the token placeholder/value:

```ts
buildMcpConfig(endpoint, token)
buildCodexMcpToml(endpoint, token)
```

- If endpoint is null, show the runtime diagnostic and do not show ready-to-copy snippets.

**Step 6: Run admin tests**

Run:

```bash
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/new-token.test.tsx
```

Expected: PASS.

---

## Task 6: Documentation And API Spec Updates

**Files:**

- Modify: `webui/docs/03-api-spec.md`
- Modify: `docs/deployment-docker.md`
- Modify: `docs/agent-integration-guide.md`
- Modify: `docs/customer-deployment-guide.md`
- Modify: `docs/project-overview.md`

**Step 1: Update WebUI API spec**

In `webui/docs/03-api-spec.md`, extend the `GET /api/project` response with `mcpEndpoint` and document `configured`, `fallback`, and `invalid` states.

**Step 2: Update deployment docs**

In `docs/deployment-docker.md`, add `LUCY_PUBLIC_MCP_URL` to runtime environment documentation:

```text
LUCY_PUBLIC_MCP_URL | unset | Public MCP endpoint shown in WebUI and generated Agent configs
```

Clarify that `LUCY_PROXY_HOST` / `LUCY_PROXY_PORT` are listen settings, while `LUCY_PUBLIC_MCP_URL` is the advertised endpoint.

**Step 3: Update agent integration docs**

In `docs/agent-integration-guide.md`, replace `http://<host>:7879/mcp` as the primary customer instruction with:

```text
Use the MCP endpoint shown by Lucy WebUI. Deployment owners provide it through LUCY_PUBLIC_MCP_URL.
```

Keep local demo endpoints as examples only.

**Step 4: Update customer deployment docs**

In `docs/customer-deployment-guide.md`, add deployment-method agnostic guidance:

- Docker Compose sets env under `services.lucy.environment`.
- K8s/Helm sets env or values.
- systemd/bare metal exports env before service start.
- In all cases the product field is the same: `LUCY_PUBLIC_MCP_URL`.

**Step 5: Update project overview**

In `docs/project-overview.md`, update the MCP endpoint copy capability note so it says the endpoint is runtime-configured rather than inferred by page code.

**Step 6: Run doc-adjacent checks if available**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
npm test -- --run scripts/lint-spec.test.mjs
```

If this test target does not exist, note it in the implementation summary and proceed with the normal WebUI test/build gates.

---

## Task 7: Final Verification

**Files:**

- No new files unless earlier tasks require minor test fixture cleanup.

**Step 1: Search for stale endpoint constants**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy
rg -n "localhost:7879|127\\.0\\.0\\.1:7879|window\\.location\\.hostname|MCP_ENDPOINT|MCP_URL|SAFE_MCP_URL" webui/src webui/server
```

Expected:

- No page-level hard-coded MCP endpoint constants remain.
- Test fixtures may contain endpoint examples only when asserting fallback or configured behavior.

**Step 2: Run targeted tests**

Run:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run server/__tests__/runtime-config.test.ts server/__tests__/project.test.ts
npm test -- src/__tests__/mcp-endpoint.test.ts src/__tests__/onboarding.test.tsx src/__tests__/connection-overview.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/new-token.test.tsx
```

Expected: PASS.

**Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

**Step 4: Run full tests if time allows**

Run:

```bash
npm test
```

Expected: PASS.

**Step 5: Manual smoke**

Run WebUI locally with configured endpoint:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
LUCY_PUBLIC_MCP_URL=https://lucy.example.com/mcp npm run dev
```

Open:

```text
http://127.0.0.1:5174/onboarding
http://127.0.0.1:5174/connections
http://127.0.0.1:5174/admin/agents
```

Expected:

- All surfaces show `https://lucy.example.com/mcp`.
- Copied MCP config uses `https://lucy.example.com/mcp`.
- No surface shows browser-derived `http://127.0.0.1:7879/mcp` while env is configured.

Run WebUI without configured endpoint:

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run dev
```

Expected:

- Local fallback is visible.
- Fallback warning is visible in onboarding/admin config surfaces.

---

## Commit Plan

Use small commits if implementing manually:

```bash
git add webui/server/runtime-config.ts webui/server/__tests__/runtime-config.test.ts
git commit -m "feat(webui): resolve public MCP endpoint"

git add webui/server/model.ts webui/server/project.ts webui/src/lib/types.ts webui/server/__tests__/project.test.ts
git commit -m "feat(webui): expose MCP endpoint runtime config"

git add webui/src/lib/mcpEndpoint.ts webui/src/__tests__/mcp-endpoint.test.ts
git commit -m "feat(webui): share MCP config builders"

git add webui/src/pages/Onboarding.tsx webui/src/pages/connections/ConnectionOverview.tsx webui/src/__tests__/onboarding.test.tsx webui/src/__tests__/connection-overview.test.tsx
git commit -m "fix(webui): use configured MCP endpoint in runtime pages"

git add webui/src/pages/admin/AgentList.tsx webui/src/pages/admin/NewToken.tsx webui/src/__tests__/agent-list.test.tsx webui/src/__tests__/new-token.test.tsx
git commit -m "fix(webui): use configured MCP endpoint in agent snippets"

git add webui/docs/03-api-spec.md docs/deployment-docker.md docs/agent-integration-guide.md docs/customer-deployment-guide.md docs/project-overview.md
git commit -m "docs: document public MCP endpoint configuration"
```
