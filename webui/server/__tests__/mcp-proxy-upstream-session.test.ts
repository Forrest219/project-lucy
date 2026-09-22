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

describe("P1 — the gateway holds the KTX transport session", () => {
  it("supplies the held session for a client that never returns Mcp-Session-Id", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      const body = recordUpstream(seen, req, await readRequestBody(req));
      if (body?.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "ktx-session-1" });
        res.end(okInitializeResult(body.id));
        return;
      }
      if (!req.headers["mcp-session-id"]) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(SESSION_REQUIRED_BODY);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(okToolResult(body?.id));
    });

    try {
      const initRes = await post(proxyPort, initializeBody("p1-init"));
      expect(initRes.status).toBe(200);

      // Catalog is served locally, so it never depended on the session — this is
      // the asymmetry that made the failure look like a database problem.
      const catalogRes = await post(proxyPort, {
        jsonrpc: "2.0",
        id: "p1-catalog",
        method: "tools/call",
        params: { name: "lucy_catalog", arguments: {} }
      });
      expect(catalogRes.status).toBe(200);
      expect((await catalogRes.json() as { result?: { isError?: boolean } }).result?.isError).not.toBe(true);

      // No `mcp-session-id` header, exactly like a scripted client that dropped it.
      const queryRes = await post(proxyPort, lucyQueryBody("p1-query"));
      expect(queryRes.status).toBe(200);
      const queryBody = await queryRes.json() as { error?: unknown; result?: { _meta?: { lucy?: { tool?: string } } } };
      expect(queryBody.error).toBeUndefined();
      expect(queryBody.result?._meta?.lucy?.tool).toBe("lucy_query");

      // The session KTX issued at initialize was replayed on the query.
      const upstreamQuery = seen.find((entry) => entry.toolName === "sl_query");
      expect(upstreamQuery?.sessionId).toBe("ktx-session-1");
      // No extra handshake was needed — one initialize, from the client.
      expect(seen.filter((entry) => entry.rpcMethod === "initialize")).toHaveLength(1);

      const audit = await waitForAuditRow("p1-query");
      expect(audit.outcome).toBe("ok");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("re-handshakes and retries once when the held session is no longer accepted", async () => {
    const seen: UpstreamRequest[] = [];
    let issuedSessions = 0;
    // Only the most recently issued session is accepted, simulating a KTX that
    // dropped the earlier one (restart, eviction, or a different worker).
    let acceptedSession = "";
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      const body = recordUpstream(seen, req, await readRequestBody(req));
      if (body?.method === "initialize") {
        issuedSessions += 1;
        acceptedSession = `ktx-session-${issuedSessions}`;
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": acceptedSession });
        res.end(okInitializeResult(body.id));
        return;
      }
      if (body?.method === "notifications/initialized") {
        res.writeHead(202, { "content-type": "application/json" });
        res.end("");
        return;
      }
      if (req.headers["mcp-session-id"] !== acceptedSession) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(SESSION_REQUIRED_BODY);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(okToolResult(body?.id));
    });

    try {
      await post(proxyPort, initializeBody("p1-recover-init"));
      expect(issuedSessions).toBe(1);

      // Invalidate session 1 upstream without telling the proxy.
      acceptedSession = "ktx-session-stale";

      const queryRes = await post(proxyPort, lucyQueryBody("p1-recover-query"));
      expect(queryRes.status).toBe(200);
      const queryBody = await queryRes.json() as { error?: unknown; result?: { _meta?: { lucy?: { tool?: string } } } };
      expect(queryBody.error).toBeUndefined();
      expect(queryBody.result?._meta?.lucy?.tool).toBe("lucy_query");

      // Two initializes: the client's, then the gateway's recovery handshake.
      const initializes = seen.filter((entry) => entry.rpcMethod === "initialize");
      expect(initializes).toHaveLength(2);
      const handshake = initializes[1];
      const handshakeParams = handshake.body?.params as Record<string, unknown> | undefined;
      // MCP requires all three; a partial initialize draws the same 400.
      expect(handshakeParams?.protocolVersion).toBeDefined();
      expect(handshakeParams?.capabilities).toBeDefined();
      expect((handshakeParams?.clientInfo as { name?: string } | undefined)?.name).toBe("lucy-mcp-proxy");
      expect(seen.some((entry) => entry.rpcMethod === "notifications/initialized")).toBe(true);

      // Exactly one retry: the refused attempt, then the one on the fresh session.
      const queryAttempts = seen.filter((entry) => entry.toolName === "sl_query");
      expect(queryAttempts).toHaveLength(2);
      expect(queryAttempts[0].sessionId).toBe("ktx-session-1");
      expect(queryAttempts[1].sessionId).toBe("ktx-session-2");

      const audit = await waitForAuditRow("p1-recover-query");
      expect(audit.outcome).toBe("ok");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("does not hold or inject a session when the kill switch is off", async () => {
    process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE = "false";
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      const body = recordUpstream(seen, req, await readRequestBody(req));
      if (body?.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "ktx-session-1" });
        res.end(okInitializeResult(body.id));
        return;
      }
      if (!req.headers["mcp-session-id"]) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(SESSION_REQUIRED_BODY);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(okToolResult(body?.id));
    });

    try {
      await post(proxyPort, initializeBody("p1-killswitch-init"));
      const queryRes = await post(proxyPort, lucyQueryBody("p1-killswitch-query"));

      // P0 still applies: the rejection is JSON-RPC, not raw text.
      expect(queryRes.status).toBe(200);
      const body = await queryRes.json() as { error?: { data?: Record<string, unknown> } };
      expect(body.error?.data?.reason).toBe("upstream_session_required");

      // No injected session and no recovery handshake.
      expect(seen.find((entry) => entry.toolName === "sl_query")?.sessionId).toBeUndefined();
      expect(seen.filter((entry) => entry.rpcMethod === "initialize")).toHaveLength(1);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("drops the held session when the client terminates it with DELETE /mcp", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      const body = recordUpstream(seen, req, await readRequestBody(req));
      if (body?.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "ktx-session-1" });
        res.end(okInitializeResult(body.id));
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(204, { "content-type": "application/json" });
        res.end("");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(okToolResult(body?.id));
    });

    try {
      await post(proxyPort, initializeBody("p1-delete-init"));

      const deleteRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${TOKEN}` }
      });
      expect(deleteRes.status).toBe(204);
      // The terminated session is still forwarded so KTX can clean it up.
      expect(seen.find((entry) => entry.method === "DELETE")?.sessionId).toBe("ktx-session-1");

      await post(proxyPort, lucyQueryBody("p1-delete-query"));
      // Nothing cached after the DELETE, so no stale session is replayed.
      expect(seen.find((entry) => entry.toolName === "sl_query")?.sessionId).toBeUndefined();
    } finally {
      await closeAll(upstream, server);
    }
  });
});
