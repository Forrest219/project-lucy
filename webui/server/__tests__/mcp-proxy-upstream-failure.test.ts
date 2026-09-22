import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// KTX rejects session traffic that arrives before `initialize` with a plain-text
// 400. These tests cover both halves of that failure:
//
//   P0 — the rejection is surfaced as JSON-RPC and audited as an error instead of
//        being forwarded verbatim and recorded as `outcome=ok`.
//   P1 — the gateway holds the KTX session, so a client that does not retain
//        `Mcp-Session-Id` still reaches KTX-bound tools.

const TOKEN = "upstream-session-token";
const INTERNAL_TOKEN = "upstream-session-internal-token";
const SESSION_REQUIRED_BODY = "MCP initialize request is required before session traffic.";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: session_agent
    name: Session Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: session-token
        created: 2026-09-22
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - sl_read_source
        - sl_query
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

type UpstreamRequest = {
  method: string;
  rpcMethod?: string;
  toolName?: string;
  sessionId?: string;
  body: Record<string, unknown> | undefined;
};

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

let projectRoot: string;
let auditDbPath: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_AUDIT_DB",
  "KTX_INTERNAL_TOKEN",
  "LUCY_PROXY_UPSTREAM_HOST",
  "LUCY_PROXY_UPSTREAM_PORT",
  "LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE"
] as const;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-upstream-session-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
}

async function waitForAuditRow(requestId: string, timeoutMs = 2000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
      if (row) return row;
    } catch {
      // table may not exist until the first write lands
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`audit row not found for request_id=${requestId}`);
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await makeProject();
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  delete process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(projectRoot, { recursive: true, force: true });
});

/** Spin up a mock KTX upstream + a Lucy proxy on a fresh pair of ports. */
async function startProxy(
  upstreamHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
): Promise<{ upstream: Server; server: Server; proxyPort: number }> {
  const upstream = createServer(upstreamHandler);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return { upstream, server, proxyPort: (server.address() as AddressInfo).port };
}

async function closeAll(upstream: Server, server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
}

/** Records every upstream hit so tests can assert on injected session headers. */
function recordUpstream(seen: UpstreamRequest[], req: IncomingMessage, raw: string): Record<string, unknown> | undefined {
  let body: Record<string, unknown> | undefined;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  seen.push({
    method: req.method ?? "",
    rpcMethod: body?.method as string | undefined,
    toolName: (body?.params as { name?: string } | undefined)?.name,
    sessionId: req.headers["mcp-session-id"] as string | undefined,
    body
  });
  return body;
}

function post(proxyPort: number, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body)
  });
}

function initializeBody(id: string): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "scripted-client", version: "0.1" }
    }
  };
}

function lucyQueryBody(id: string): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "lucy_query",
      arguments: {
        connectionId: "mysql-aliyun",
        measures: ["superstore_orders.sales"],
        dimensions: [{ field: "superstore_orders.region" }]
      }
    }
  };
}

function okToolResult(id: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ region: "East", sales: 1 }], truncated: false }) }] }
  });
}

function okInitializeResult(id: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "ktx", version: "0.12.0" },
      capabilities: { tools: {} }
    }
  });
}

describe("P0 — upstream transport failures are surfaced as JSON-RPC and audited as errors", () => {
  it("converts KTX's plain-text session rejection into a JSON-RPC error and audits outcome=error", async () => {
    // Refuses everything, so even the gateway's recovery handshake cannot succeed.
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(SESSION_REQUIRED_BODY);
    });

    try {
      const res = await post(proxyPort, lucyQueryBody("p0-session-required"));

      // The client must never see KTX's 400 text/plain verbatim.
      expect(res.status).toBe(200);
      expect(String(res.headers.get("content-type"))).toContain("application/json");
      const body = await res.json() as { error?: { message?: string; data?: Record<string, unknown> } };
      expect(body.error?.message).toBe("KTX upstream rejected the request");
      expect(body.error?.data?.reason).toBe("upstream_session_required");
      expect(body.error?.data?.upstreamStatus).toBe(400);
      // Raw upstream text stays in the audit trail, not in the client response.
      expect(JSON.stringify(body)).not.toContain(SESSION_REQUIRED_BODY);

      const audit = await waitForAuditRow("p0-session-required");
      expect(audit.outcome).toBe("error");
      expect(audit.decision_reason).toBe("upstream_session_required");
      expect(String(audit.error_detail)).toContain("upstream_status=400");
      expect(String(audit.error_detail)).toContain("initialize request is required");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("classifies other non-JSON-RPC upstream failures as upstream_protocol_error", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("upstream exploded");
    });

    try {
      const res = await post(proxyPort, lucyQueryBody("p0-protocol-error"));
      expect(res.status).toBe(200);
      const body = await res.json() as { error?: { data?: Record<string, unknown> } };
      expect(body.error?.data?.reason).toBe("upstream_protocol_error");
      expect(body.error?.data?.upstreamStatus).toBe(502);
      expect(JSON.stringify(body)).not.toContain("upstream exploded");

      const audit = await waitForAuditRow("p0-protocol-error");
      expect(audit.outcome).toBe("error");
      expect(audit.decision_reason).toBe("upstream_protocol_error");
    } finally {
      await closeAll(upstream, server);
    }
  });
});
