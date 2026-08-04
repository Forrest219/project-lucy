import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  projectRoot: "",
  writeLogMock: vi.fn(() => Promise.resolve()),
  writeAccessLogSourcesMock: vi.fn(() => Promise.resolve()),
  isTokenRevokedMock: vi.fn(() => false),
  // Captures every recordMcpToolsCall invocation for assertions. The proxy
  // would otherwise write to the real `.ktx-ui/audit.sqlite`, which we never
  // want to touch from tests.
  recordMcpToolsCallMock: vi.fn(() => ({ callEventId: 1, policyEventId: 2 }))
}));

vi.mock("../project.js", () => ({
  resolveProjectRoot: vi.fn(() => testState.projectRoot)
}));

vi.mock("../proxy/audit.js", () => ({
  isTokenRevoked: testState.isTokenRevokedMock,
  writeLog: testState.writeLogMock,
  writeAccessLogSources: testState.writeAccessLogSourcesMock
}));

// Replace the kernel helpers so we can assert what the proxy asked for
// without touching any real SQLite file. `getAdminAuditDb` returns a dummy
// handle; `recordMcpToolsCall` records the call.
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

const TOKEN = "proxy-trace-token";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: superstore_agent
    name: Superstore Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: proxy-trace-test
        created: 2026-06-20
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_read_source
        - lucy_read_source
        - lucy_query
        - kx_catalog
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `sources:
  - source: dataforai.superstore_orders
    grain: "1 row per order_id"
    table:
      connection: dataforai
      schema: mysql-aliyun
      table: superstore_orders
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-mcp-trace-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
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

beforeEach(async () => {
  testState.writeLogMock.mockClear();
  testState.writeAccessLogSourcesMock.mockClear();
  testState.isTokenRevokedMock.mockReset();
  testState.isTokenRevokedMock.mockReturnValue(false);
  testState.recordMcpToolsCallMock.mockClear();
  testState.recordMcpToolsCallMock.mockReturnValue({ callEventId: 1, policyEventId: 2 });
  testState.projectRoot = await makeProject();
});

afterEach(async () => {
  await rm(testState.projectRoot, { recursive: true, force: true });
  testState.projectRoot = "";
});

async function withProxy<T>(run: (port: number) => Promise<T>): Promise<T> {
  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, () => resolve()));
  const port = (server.address() as AddressInfo).port;
  let result: T;
  try {
    result = await run(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
  // Let any Promise.then (recordMcpTrace → getAdminAuditDb.then) settle
  // before assertions.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return result;
}

describe("MCP proxy — Trace / Evidence Kernel integration (202608-01)", () => {
  it("writes a denied policy_decision trace event for an unauthorized table read", async () => {
    await withProxy(async (port) => {
      // The agent has access to superstore_orders only. kx_fact_financial_amount
      // is unauthorized — the ACL should fire and the kernel should record
      // a denied policy decision.
      const res = await callTool(port, TOKEN, "trace-deny-1", "sl_read_source", {
        sourceName: "kx_fact_financial_amount"
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result?: { isError?: boolean } };
      expect(body.result?.isError).toBe(true);
    });

    expect(testState.recordMcpToolsCallMock).toHaveBeenCalled();
    const calls = testState.recordMcpToolsCallMock.mock.calls;
    // We expect at least one mcp_tools_call + policy_decision pair for the
    // denied request.
    const deniedCall = calls.find(([, input]) => (input as { status?: string }).status === "denied");
    expect(deniedCall).toBeDefined();
    const input = deniedCall?.[1] as { toolName?: string; policyDecision?: { allowed?: boolean; reason?: string } };
    expect(input.toolName).toBe("sl_read_source");
    expect(input.policyDecision?.allowed).toBe(false);
    expect(typeof input.policyDecision?.reason).toBe("string");
  });

  it("writes a happy-path trace event when a tool is allowed", async () => {
    await withProxy(async (port) => {
      const res = await callTool(port, TOKEN, "trace-ok-1", "kx_catalog", {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result?: { isError?: boolean } };
      expect(body.result?.isError).toBeUndefined();
    });

    expect(testState.recordMcpToolsCallMock).toHaveBeenCalled();
    const calls = testState.recordMcpToolsCallMock.mock.calls;
    const okCall = calls.find(([, input]) => (input as { status?: string }).status === "ok");
    expect(okCall).toBeDefined();
    const input = okCall?.[1] as { toolName?: string; policyDecision?: { allowed?: boolean } };
    expect(input.toolName).toBe("kx_catalog");
    expect(input.policyDecision?.allowed).toBe(true);
  });

  it("does not crash if the audit DB getter rejects", async () => {
    const audit = await import("../admin/audit.js");
    const original = audit.getAuditDb.getMockImplementation();
    vi.mocked(audit.getAuditDb).mockRejectedValueOnce(new Error("trace db unavailable"));

    await withProxy(async (port) => {
      const res = await callTool(port, TOKEN, "trace-fail-1", "kx_catalog", {});
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result?: { isError?: boolean } };
      // MCP response must succeed even if trace writes failed.
      expect(body.result?.isError).toBeUndefined();
    });

    // restore for other tests
    if (original) {
      vi.mocked(audit.getAuditDb).mockImplementation(original);
    } else {
      vi.mocked(audit.getAuditDb).mockResolvedValue({ name: "<test>" } as never);
    }
  });

  it("propagates the requestId into the trace envelope", async () => {
    await withProxy(async (port) => {
      const res = await callTool(port, TOKEN, "trace-reqid-42", "kx_catalog", {});
      expect(res.status).toBe(200);
    });

    const calls = testState.recordMcpToolsCallMock.mock.calls;
    const matched = calls.find(([, input]) => (input as { requestId?: string }).requestId === "trace-reqid-42");
    expect(matched).toBeDefined();
    expect((matched?.[1] as { traceId?: string }).traceId).not.toBe("trace-reqid-42");
  });

  it("uses a platform traceId that stays unique when JSON-RPC request ids collide", async () => {
    await withProxy(async (port) => {
      await callTool(port, TOKEN, "1", "kx_catalog", {});
      await callTool(port, TOKEN, "1", "kx_catalog", {});
    });

    const matchingCalls = testState.recordMcpToolsCallMock.mock.calls
      .map(([, input]) => input as { requestId?: string; traceId?: string; toolName?: string })
      .filter((input) => input.requestId === "1" && input.toolName === "kx_catalog");
    expect(matchingCalls).toHaveLength(2);
    expect(matchingCalls[0].traceId).toMatch(/^trace_/);
    expect(matchingCalls[1].traceId).toMatch(/^trace_/);
    expect(matchingCalls[0].traceId).not.toBe(matchingCalls[1].traceId);
  });

  it("writes trace events for allowed non-catalog tools on the upstream failure path", async () => {
    await withProxy(async (port) => {
      const res = await callTool(port, TOKEN, "trace-read-source-1", "sl_read_source", {
        sourceName: "dataforai.superstore_orders"
      });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toBeDefined();
    });

    const calls = testState.recordMcpToolsCallMock.mock.calls;
    const matched = calls.find(([, input]) => (input as { toolName?: string }).toolName === "sl_read_source");
    expect(matched).toBeDefined();
    const input = matched?.[1] as { requestId?: string; status?: string; traceId?: string; policyDecision?: { allowed?: boolean; source?: string } };
    expect(input.requestId).toBe("trace-read-source-1");
    expect(input.status).toBe("error");
    expect(input.traceId).toMatch(/^trace_/);
    expect(input.policyDecision?.allowed).toBe(true);
  });
});
