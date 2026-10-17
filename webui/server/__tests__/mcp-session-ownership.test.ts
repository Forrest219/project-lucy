import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T04-2 / Spec §3.3 — upstream transport sessions are bound to
// (Agent id, Token hash, downstreamSessionId). Holding someone else's
// `Mcp-Session-Id` must never reach their KTX session, and a client that sends
// no header must still be able to reconnect through its own Token's session.

const ALICE_TOKEN = "ownership-alice-token";
const ALICE_SECOND_TOKEN = "ownership-alice-second-token";
const BOB_TOKEN = "ownership-bob-token";
const INTERNAL_TOKEN = "ownership-internal-token";
const SESSION_REQUIRED_BODY = "MCP initialize request is required before session traffic.";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ALLOW = `    allow:
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
`;

const ACCESS_YAML = `users:
  - id: alice
    name: Alice
    enabled: true
    tokens:
      - hash: "${tokenHash(ALICE_TOKEN)}"
        label: alice-main
        created: 2026-09-22
      - hash: "${tokenHash(ALICE_SECOND_TOKEN)}"
        label: alice-second
        created: 2026-09-22
${ALLOW}  - id: bob
    name: Bob
    enabled: true
    tokens:
      - hash: "${tokenHash(BOB_TOKEN)}"
        label: bob-main
        created: 2026-09-22
${ALLOW}defaults:
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
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_AUDIT_DB",
  "KTX_INTERNAL_TOKEN",
  "LUCY_PROXY_UPSTREAM_HOST",
  "LUCY_PROXY_UPSTREAM_PORT",
  "LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE",
  "LUCY_CONTENT_ROOT"
] as const;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-session-ownership-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(projectRoot, { recursive: true, force: true });
});

/** A KTX stand-in that issues `ktx-session-N` and refuses unestablished sessions. */
function ktxStandIn(seen: UpstreamRequest[]) {
  const established = new Set<string>();
  let issued = 0;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(await readRequestBody(req) || "{}") as Record<string, unknown>;
    } catch {
      body = {};
    }
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    seen.push({
      method: req.method ?? "",
      rpcMethod: body.method as string | undefined,
      toolName: (body.params as { name?: string } | undefined)?.name,
      sessionId
    });
    if (body.method === "initialize") {
      issued += 1;
      const id = `ktx-session-${issued}`;
      established.add(id);
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": id });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0.12.0" }, capabilities: { tools: {} } }
      }));
      return;
    }
    if (!sessionId || !established.has(sessionId)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(SESSION_REQUIRED_BODY);
      return;
    }
    if (req.method === "DELETE") {
      established.delete(sessionId);
      res.writeHead(204);
      res.end();
      return;
    }
    if (body.method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ region: "East", sales: 1 }], truncated: false }) }] }
    }));
  };
}

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

function post(proxyPort: number, token: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body)
  });
}

function initializeBody(id: string): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "scripted-client", version: "0.1" } }
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

async function initialize(proxyPort: number, token: string, id: string): Promise<string> {
  const res = await post(proxyPort, token, initializeBody(id));
  expect(res.status).toBe(200);
  const sessionId = res.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId as string;
}

function upstreamQueries(seen: UpstreamRequest[]): UpstreamRequest[] {
  return seen.filter((entry) => entry.toolName === "sl_query");
}

describe("upstream session store — (Agent, Token, downstreamSessionId) ownership", () => {
  it("never returns a session issued to another Agent or another Token of the same Agent", async () => {
    const store = await import("../proxy/upstream-session");
    const aliceMain = { agentId: "alice", tokenHash: "sha256:aaaa" };
    const aliceSecond = { agentId: "alice", tokenHash: "sha256:bbbb" };
    const bob = { agentId: "bob", tokenHash: "sha256:cccc" };

    store.setUpstreamSession(aliceMain, "s-alice");

    expect(store.ownsUpstreamSession(aliceMain, "s-alice")).toBe(true);
    expect(store.ownsUpstreamSession(aliceSecond, "s-alice")).toBe(false);
    expect(store.ownsUpstreamSession(bob, "s-alice")).toBe(false);

    // A foreign id resolves to the caller's own default — here, nothing.
    expect(store.getUpstreamSession(bob, "s-alice")).toBeUndefined();
    expect(store.getUpstreamSession(aliceSecond)).toBeUndefined();
    expect(store.getUpstreamSession(aliceMain)).toBe("s-alice");
  });

  it("clearing with a foreign id leaves the owner's session intact", async () => {
    const store = await import("../proxy/upstream-session");
    const alice = { agentId: "alice", tokenHash: "sha256:aaaa" };
    const bob = { agentId: "bob", tokenHash: "sha256:cccc" };
    store.setUpstreamSession(alice, "s-alice");

    store.clearUpstreamSession(bob, "s-alice");
    expect(store.ownsUpstreamSession(alice, "s-alice")).toBe(true);

    store.clearUpstreamSession(alice, "s-alice");
    expect(store.ownsUpstreamSession(alice, "s-alice")).toBe(false);
    expect(store.getUpstreamSession(alice)).toBeUndefined();
  });

  it("keeps ids that merely look alike across the key separator distinct", async () => {
    const store = await import("../proxy/upstream-session");
    store.setUpstreamSession({ agentId: "a:b", tokenHash: "c" }, "s1");
    expect(store.ownsUpstreamSession({ agentId: "a", tokenHash: "b:c" }, "s1")).toBe(false);
  });
});

describe("MCP session ownership through the proxy", () => {
  it("does not forward another Agent's Mcp-Session-Id; the caller's own session is used", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const aliceSession = await initialize(proxyPort, ALICE_TOKEN, "own-alice-init");
      const bobSession = await initialize(proxyPort, BOB_TOKEN, "own-bob-init");
      expect(aliceSession).not.toBe(bobSession);

      const res = await post(proxyPort, BOB_TOKEN, lucyQueryBody("own-bob-query"), { "mcp-session-id": aliceSession });
      expect(res.status).toBe(200);
      expect((await res.json() as { error?: unknown }).error).toBeUndefined();

      const forwarded = upstreamQueries(seen);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0].sessionId).toBe(bobSession);
      expect(seen.some((entry) => entry.sessionId === aliceSession && entry.toolName === "sl_query")).toBe(false);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("never replays another Agent's session even when the caller has none of its own", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const aliceSession = await initialize(proxyPort, ALICE_TOKEN, "none-alice-init");

      const res = await post(proxyPort, BOB_TOKEN, lucyQueryBody("none-bob-query"), { "mcp-session-id": aliceSession });
      expect(res.status).toBe(200);
      // Bob is served through a session the gateway established for Bob...
      expect((await res.json() as { error?: unknown }).error).toBeUndefined();
      const forwarded = upstreamQueries(seen);
      expect(forwarded.every((entry) => entry.sessionId !== aliceSession)).toBe(true);
      // ...so a handshake ran, and it is not Alice's.
      expect(seen.filter((entry) => entry.rpcMethod === "initialize")).toHaveLength(2);
      expect(forwarded.at(-1)?.sessionId).toBe("ktx-session-2");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("does not share a session between two Tokens of the same Agent", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const mainSession = await initialize(proxyPort, ALICE_TOKEN, "tok-main-init");

      const res = await post(proxyPort, ALICE_SECOND_TOKEN, lucyQueryBody("tok-second-query"), { "mcp-session-id": mainSession });
      expect((await res.json() as { error?: unknown }).error).toBeUndefined();
      expect(upstreamQueries(seen).every((entry) => entry.sessionId !== mainSession)).toBe(true);

      // The first Token's own session is untouched.
      const mainRes = await post(proxyPort, ALICE_TOKEN, lucyQueryBody("tok-main-query"), { "mcp-session-id": mainSession });
      expect((await mainRes.json() as { error?: unknown }).error).toBeUndefined();
      expect(upstreamQueries(seen).at(-1)?.sessionId).toBe(mainSession);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("lets a client that dropped the header reconnect through its own Token's session only", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const aliceSession = await initialize(proxyPort, ALICE_TOKEN, "recon-alice-init");
      const bobSession = await initialize(proxyPort, BOB_TOKEN, "recon-bob-init");

      const aliceRes = await post(proxyPort, ALICE_TOKEN, lucyQueryBody("recon-alice-query"));
      expect((await aliceRes.json() as { error?: unknown }).error).toBeUndefined();
      const bobRes = await post(proxyPort, BOB_TOKEN, lucyQueryBody("recon-bob-query"));
      expect((await bobRes.json() as { error?: unknown }).error).toBeUndefined();

      const forwarded = upstreamQueries(seen);
      expect(forwarded.map((entry) => entry.sessionId)).toEqual([aliceSession, bobSession]);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("does not let a foreign DELETE terminate the owner's session", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const aliceSession = await initialize(proxyPort, ALICE_TOKEN, "del-alice-init");
      const bobSession = await initialize(proxyPort, BOB_TOKEN, "del-bob-init");

      const deleteRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${BOB_TOKEN}`, "mcp-session-id": aliceSession }
      });
      expect(deleteRes.status).toBe(204);
      const deletes = seen.filter((entry) => entry.method === "DELETE");
      expect(deletes).toHaveLength(1);
      expect(deletes[0].sessionId).toBe(bobSession);

      const aliceRes = await post(proxyPort, ALICE_TOKEN, lucyQueryBody("del-alice-query"), { "mcp-session-id": aliceSession });
      expect((await aliceRes.json() as { error?: unknown }).error).toBeUndefined();
      expect(upstreamQueries(seen).at(-1)?.sessionId).toBe(aliceSession);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("drops a foreign Mcp-Session-Id from initialize instead of forwarding it", async () => {
    const seen: UpstreamRequest[] = [];
    const { upstream, server, proxyPort } = await startProxy(ktxStandIn(seen));
    try {
      const aliceSession = await initialize(proxyPort, ALICE_TOKEN, "init-alice-init");

      const res = await post(proxyPort, BOB_TOKEN, initializeBody("init-bob-init"), { "mcp-session-id": aliceSession });
      expect(res.status).toBe(200);
      expect(res.headers.get("mcp-session-id")).not.toBe(aliceSession);
      const initializes = seen.filter((entry) => entry.rpcMethod === "initialize");
      expect(initializes).toHaveLength(2);
      expect(initializes[1].sessionId).toBeUndefined();
    } finally {
      await closeAll(upstream, server);
    }
  });
});
