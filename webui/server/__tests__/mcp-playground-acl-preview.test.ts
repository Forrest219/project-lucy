import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index";
import { decisionReasonDetail, decisionReasonLabel } from "../admin/decision-reason-labels.js";

// Mock audit db so tests don't need a real sqlite (same shape as admin-agents.test.ts).
vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  registerAuditRoutes: vi.fn()
}));

const ACCESS_YAML = `roles:
  analyst:
    description: Analyst role
    allow:
      connections:
        - mysql-aliyun
      tableSelectors:
        - connection: mysql-aliyun
          schema: dataforai
          names:
            - superstore_orders
      tools:
        - sl_query
users:
  - id: zhangsan
    name: 张三
    enabled: true
    role: analyst
    tokens:
      - hash: "sha256:aaaa"
        label: hermes-laptop
        created: 2026-06-18
  - id: lisi
    name: 李四
    enabled: false
    tokens: []
    allow:
      tables: ["*"]
      tools: ["*"]
defaults:
  deny_tools:
    - sql_execution
`;

let projectRoot: string;
let prevRoot: string | undefined;
let prevPublicMcpUrl: string | undefined;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-playground-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
    "utf8"
  );
  return root;
}

beforeEach(async () => {
  projectRoot = await makeProject();
  prevRoot = process.env.KTX_PROJECT_ROOT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  prevPublicMcpUrl = process.env.LUCY_PUBLIC_MCP_URL;
  delete process.env.LUCY_PUBLIC_MCP_URL;
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevPublicMcpUrl === undefined) delete process.env.LUCY_PUBLIC_MCP_URL;
  else process.env.LUCY_PUBLIC_MCP_URL = prevPublicMcpUrl;
  await rm(projectRoot, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("decision-reason-labels", () => {
  it("maps known codes to Chinese labels", () => {
    expect(decisionReasonLabel("allowed")).toBe("允许执行");
    expect(decisionReasonLabel("tool_forbidden")).toBe("Role 未授权该工具");
    expect(decisionReasonLabel("table_forbidden:dataforai.orders")).toBe("表不在生效权限范围内");
    expect(decisionReasonDetail("table_forbidden:dataforai.orders")).toContain("dataforai.orders");
  });

  it("falls back for unknown codes", () => {
    expect(decisionReasonLabel("weird_code")).toBe("未识别裁决原因");
  });
});

describe("POST /api/admin/mcp-playground/acl-preview", () => {
  it("rejects a request missing agentId", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ tool: "sl_query" })
      .expect(400);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("rejects a request missing tool", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "zhangsan" })
      .expect(400);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("returns 404 for an unknown agent", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "does-not-exist", tool: "sl_query" })
      .expect(404);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("returns allowed:true with a Chinese label for an authorized call", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "zhangsan", tool: "sl_query", arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" } })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.allowed).toBe(true);
    expect(res.body.data.decisionReason).toBe("allowed");
    expect(res.body.data.decisionReasonLabel).toBe("允许执行");
    expect(res.body.data.roleIds).toEqual(["analyst"]);
    expect(res.body.data.remediation.primary.href).toBe("/admin/roles/analyst?tab=permissions");
    await app.close();
  });

  it("denies a tool not granted to the role, with a readable label", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "zhangsan", tool: "lucy_query", arguments: {} })
      .expect(200);
    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.decisionReason).toBe("tool_forbidden");
    expect(res.body.data.decisionReasonLabel).toBe("Role 未授权该工具");
    await app.close();
  });

  it("denies an out-of-scope table with a table_forbidden reason", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "zhangsan", tool: "sl_query", arguments: { connectionId: "mysql-aliyun", sourceName: "other_table" } })
      .expect(200);
    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.decisionReason).toMatch(/^table_forbidden:/);
    expect(res.body.data.decisionReasonLabel).toBe("表不在生效权限范围内");
    await app.close();
  });

  it("surfaces agent_disabled for a disabled Agent", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "lisi", tool: "sl_query", arguments: {} })
      .expect(200);
    expect(res.body.data.allowed).toBe(false);
    expect(res.body.data.decisionReason).toBe("agent_disabled");
    expect(res.body.data.decisionReasonLabel).toBe("Agent 已禁用");
    await app.close();
  });

  it("never contains a raw KTX/query forward — dry run stays local ACL only", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildServer();
    await app.ready();
    await request(app.server)
      .post("/api/admin/mcp-playground/acl-preview")
      .send({ agentId: "zhangsan", tool: "sl_query", arguments: { sourceName: "superstore_orders" } })
      .expect(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /api/admin/mcp-playground/live-smoke", () => {
  it("rejects any method other than tools/list", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "zhangsan", method: "lucy_query", bearerToken: "secret-token" })
      .expect(400);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("rejects a request missing bearerToken", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "zhangsan", method: "tools/list" })
      .expect(400);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("returns 404 for an unknown agent", async () => {
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "does-not-exist", method: "tools/list", bearerToken: "secret-token" })
      .expect(404);
    expect(res.body.ok).toBe(false);
    await app.close();
  });

  it("rejects a non-loopback configured MCP endpoint (no arbitrary URL calls)", async () => {
    process.env.LUCY_PUBLIC_MCP_URL = "https://public.example.com/mcp";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "zhangsan", method: "tools/list", bearerToken: "secret-token" })
      .expect(400);
    expect(res.body.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("calls the local MCP endpoint with the bearer token and never echoes it back", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", result: { tools: [{ name: "sl_query" }] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "zhangsan", method: "tools/list", bearerToken: "super-secret-token" })
      .expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.httpStatus).toBe(200);
    expect(res.body.data.decisionReasonLabel).toBe("允许执行");
    expect(JSON.stringify(res.body)).not.toContain("super-secret-token");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(calledUrl).hostname).toBe("127.0.0.1");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer super-secret-token");
    await app.close();
  });

  it("surfaces token_revoked when the upstream MCP endpoint returns 401", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .post("/api/admin/mcp-playground/live-smoke")
      .send({ agentId: "zhangsan", method: "tools/list", bearerToken: "bad-token" })
      .expect(200);
    expect(res.body.data.httpStatus).toBe(401);
    expect(res.body.data.decisionReason).toBe("token_revoked");
    await app.close();
  });
});
