import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  projectRoot: "",
  writeLogMock: vi.fn(() => Promise.resolve()),
  writeAccessLogSourcesMock: vi.fn(() => Promise.resolve()),
  isTokenRevokedMock: vi.fn(() => false),
  recordMcpToolsCallMock: vi.fn(() => ({ callEventId: 1, policyEventId: 2 }))
}));

vi.mock("../project.js", () => ({
  resolveProjectRoot: vi.fn(() => testState.projectRoot)
}));

vi.mock("../proxy/audit.js", () => ({
  isTokenRevoked: testState.isTokenRevokedMock,
  writeLog: testState.writeLogMock,
  writeAccessLogSources: testState.writeAccessLogSourcesMock,
  writeAuthFailureLog: vi.fn(() => Promise.resolve())
}));

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => Promise.resolve({ name: "<test>" }))
}));

vi.mock("../trace/evidence.js", async () => {
  const actual = await vi.importActual<typeof import("../trace/evidence.js")>("../trace/evidence.js");
  return {
    ...actual,
    recordMcpToolsCall: testState.recordMcpToolsCallMock
  };
});

const TOKEN = "proxy-acl-token";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: superstore_agent
    name: Superstore Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: proxy-test
        created: 2026-06-20
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
        - lucy_query
        - dictionary_search
        - discover_data
        - sql_execution
        - sql_dialect_notes
  - id: disabled_agent
    name: Disabled Agent
    enabled: false
    tokens:
      - hash: "${tokenHash("disabled-token")}"
        label: disabled-token
        created: 2026-06-20
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
        - sql_execution
  - id: wildcard_agent
    name: Wildcard Agent
    tokens:
      - hash: "${tokenHash("wildcard-token")}"
        label: wildcard-token
        created: 2026-06-20
    allow:
      tables: ["*"]
      tools: ["*"]
defaults:
  deny_tools:
    - sql_execution
    - sql_dialect_notes
`;

const SCHEMA_YAML = `tables:
  kx_fact_financial_amount:
    table: dataforai.kx_fact_financial_amount
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-proxy-acl-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
}

beforeEach(async () => {
  testState.writeLogMock.mockClear();
  testState.writeAccessLogSourcesMock.mockClear();
  testState.isTokenRevokedMock.mockReset();
  testState.isTokenRevokedMock.mockReturnValue(false);
  testState.recordMcpToolsCallMock.mockClear();
  testState.recordMcpToolsCallMock.mockReturnValue({ callEventId: 1, policyEventId: 2 });
  projectRoot = await makeProject();
  testState.projectRoot = projectRoot;
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
  testState.projectRoot = "";
});

describe("MCP proxy ACL enforcement", () => {
  async function withProxy(run: (port: number) => Promise<void>) {
    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();

    await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
    const port = (server.address() as AddressInfo).port;

    try {
      await run(port);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }

  async function callTool(port: number, token: string, id: string, name: string, args: unknown) {
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args }
      })
    });
  }

  async function expectDenied(port: number, input: {
    token?: string;
    id: string;
    name: string;
    args: unknown;
    reason: string;
    userId?: string;
    argsSummary?: Record<string, unknown>;
  }) {
    const res = await callTool(port, input.token ?? TOKEN, input.id, input.name, input.args);
    expect(res.status).toBe(200);
    const body = await res.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0]?.text).toContain(`Access denied: ${input.reason}`);
    expect(testState.writeLogMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: input.userId ?? "superstore_agent",
      tool: input.name,
      ...(input.argsSummary ? { argsSummary: input.argsSummary } : {}),
      outcome: "denied",
      errorDetail: input.reason,
      requestId: input.id
    }));
  }

  it("uses localhost as the default proxy bind host", async () => {
    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { host } = buildProxy();
    expect(host).toBe("127.0.0.1");
  });

  it("denies unauthorized KX table access before forwarding and writes audit", async () => {
    await withProxy(async (port) => {
      await expectDenied(port, {
        id: "proxy-deny-kx-1",
        name: "lucy_read_source",
        args: { connectionId: "mysql-aliyun", sourceName: "kx_fact_financial_amount" },
        reason: "explicit_table_required:dataforai.kx_fact_financial_amount"
      });
    });
  });

  it("denies raw query/sql, metadata tools, disabled agents, global deny, and unknown tools through the proxy", async () => {
    await withProxy(async (port) => {
      await expectDenied(port, {
        id: "proxy-deny-raw-query",
        name: "lucy_query",
        args: { connectionId: "mysql-aliyun", query: "select * from dataforai.superstore_orders limit 1" },
        reason: "raw_query_forbidden"
      });

      await expectDenied(port, {
        id: "proxy-deny-metadata",
        name: "dictionary_search",
        args: { query: "financial", password: "redacted", token: "redacted", visible: "kept" },
        reason: "sensitive_metadata_forbidden:kx",
        argsSummary: { visible: "kept" }
      });

      await expectDenied(port, {
        id: "proxy-deny-disabled",
        token: "disabled-token",
        name: "sql_execution",
        args: {},
        reason: "agent_disabled",
        userId: "disabled_agent"
      });

      await expectDenied(port, {
        id: "proxy-deny-global-tool",
        name: "sql_execution",
        args: {},
        reason: "tool_absolute_deny:sql_execution"
      });

      await expectDenied(port, {
        id: "proxy-deny-global-dialect-tool",
        name: "sql_dialect_notes",
        args: { connectionId: "mysql-aliyun" },
        reason: "tool_absolute_deny:sql_dialect_notes"
      });

      await expectDenied(port, {
        id: "proxy-deny-unknown-tool",
        token: "wildcard-token",
        name: "future_table_export",
        args: {},
        reason: "tool_unclassified:future_table_export",
        userId: "wildcard_agent"
      });
    });
  });

  it("returns 401 for revoked tokens", async () => {
    testState.isTokenRevokedMock.mockReturnValue(true);

    await withProxy(async (port) => {
      const res = await callTool(port, TOKEN, "proxy-revoked-token", "lucy_read_source", {
        connectionId: "mysql-aliyun",
        sourceName: "superstore_orders"
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { message: "Unauthorized" } });
      expect(testState.writeLogMock).not.toHaveBeenCalled();
    });
  });

  it("rejects oversized request bodies", async () => {
    await withProxy(async (port) => {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: "x".repeat(1_048_577)
      });

      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ error: "Proxy error" });
    });
  });

  it("does not expose raw upstream error details in MCP upstream failure responses", async () => {
    const previousPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
    process.env.LUCY_PROXY_UPSTREAM_PORT = "1";
    vi.resetModules();

    try {
      await withProxy(async (port) => {
        const res = await callTool(port, TOKEN, "proxy-upstream-error", "lucy_read_source", {
          connectionId: "mysql-aliyun",
          sourceName: "superstore_orders"
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { error?: { message?: string; data?: { reason?: string } } };
        expect(body).toMatchObject({
          jsonrpc: "2.0",
          id: "proxy-upstream-error",
          error: {
            message: "KTX upstream unavailable",
            data: { reason: "upstream_unavailable" }
          }
        });
        expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1:1/);
      });
    } finally {
      if (previousPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
      else process.env.LUCY_PROXY_UPSTREAM_PORT = previousPort;
      vi.resetModules();
    }
  });
});
