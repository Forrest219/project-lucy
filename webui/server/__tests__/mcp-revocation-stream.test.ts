import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T04-3 / Spec §3.3 — revocation send barrier. A narrowing operation persists
// first, then cancels in-flight requests and streams, clears caches, and only
// then reports success; every content send point re-checks the authorization
// version. Bytes already on the wire cannot be recalled (verified end-to-end in T12).
//
// T07 (Spec §5.1): sensitive SSE is no longer passed through chunk by chunk; the proxy
// buffers it (bounded) and releases it only after a durable `response_prepared`. An
// in-flight stream is therefore a request still being buffered: a narrowing cancels it,
// closes its upstream stream and answers 403 — no stream byte ever reached the client.

const ALICE_TOKEN = "revocation-alice-token";
const BOB_TOKEN = "revocation-bob-token";
const INTERNAL_TOKEN = "revocation-internal-token";
const CANARY = "REVOCATION_CANARY_MUST_NOT_REACH_CLIENT";

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
        - lucy_query
`;

function accessYaml(aliceEnabled: boolean): string {
  return `users:
  - id: alice
    name: Alice
    enabled: ${aliceEnabled}
    tokens:
      - hash: "${tokenHash(ALICE_TOKEN)}"
        label: alice-main
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
}

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_CONTENT_ROOT",
  "LUCY_ACCESS_CONFIG_PATH",
  "LUCY_AUDIT_DB",
  "KTX_INTERNAL_TOKEN",
  "LUCY_PROXY_UPSTREAM_HOST",
  "LUCY_PROXY_UPSTREAM_PORT",
  "LUCY_PROXY_LUCY_SKILLS_PORT",
  "LUCY_PROXY_SKILLS_PASSTHROUGH",
  "LUCY_DEPLOYMENT_MODE",
  "LUCY_CHART_DEPLOYMENT_MODE",
  "LUCY_WEBUI_COOKIE_SECURE"
] as const;

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

describe("MCP revocation send barrier (T04-3)", () => {
  let projectRoot: string;
  const saved: Record<string, string | undefined> = {};
  let upstream: Server | undefined;
  let proxy: Server | undefined;
  let proxyPort = 0;
  /** Streams the upstream stand-in currently holds open, by GET request count. */
  let streamClosedUpstream = 0;
  let streamOpened = 0;
  let toolsListHeld: ServerResponse | undefined;
  let toolsListClosedUpstream = false;

  async function startProxy(): Promise<void> {
    upstream = createServer(async (req, res) => {
      if (req.method === "GET") {
        streamOpened += 1;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
        const timer = setInterval(() => res.write("data: tick\n\n"), 15);
        res.on("close", () => {
          clearInterval(timer);
          streamClosedUpstream += 1;
        });
        return;
      }
      const raw = await readRequestBody(req);
      const body = JSON.parse(raw || "{}") as { id?: string | number; method?: string };
      if (body.method === "tools/list") {
        toolsListHeld = res;
        res.on("close", () => { toolsListClosedUpstream = true; });
        return; // held until the test releases it
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result: { tools: [] } }));
    });
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
    process.env.LUCY_PROXY_LUCY_SKILLS_PORT = process.env.LUCY_PROXY_UPSTREAM_PORT;
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const built = buildProxy();
    proxy = built.server;
    await new Promise<void>((resolve) => proxy!.listen(0, built.host, resolve));
    proxyPort = (proxy.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    vi.resetModules();
    streamClosedUpstream = 0;
    streamOpened = 0;
    toolsListHeld = undefined;
    toolsListClosedUpstream = false;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-revocation-"));
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    await writeFile(accessPath, accessYaml(true), "utf8");
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_ACCESS_CONFIG_PATH = accessPath;
    process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
    delete process.env.LUCY_PROXY_SKILLS_PASSTHROUGH;
    delete process.env.LUCY_DEPLOYMENT_MODE;
    delete process.env.LUCY_CHART_DEPLOYMENT_MODE;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    toolsListHeld?.destroy();
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise<void>((resolve) => proxy!.close(() => resolve()));
    }
    if (upstream) {
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
    }
    proxy = undefined;
    upstream = undefined;
    await rm(projectRoot, { recursive: true, force: true });
  });

  type OpenedStream = {
    /** Settles when the proxy answers (or the connection drops). */
    response: Promise<{ status: number; text: string }>;
    settled: () => boolean;
    abort: () => void;
  };

  /** Opens `GET /mcp` and does not wait for headers: the proxy buffers the stream (T07). */
  function openStream(token: string): OpenedStream {
    const controller = new AbortController();
    let done = false;
    const response = fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "text/event-stream" },
      signal: controller.signal
    })
      .then(async (res) => ({ status: res.status, text: await res.text() }))
      .catch(() => ({ status: 0, text: "" }))
      .finally(() => {
        done = true;
      });
    return { response, settled: () => done, abort: () => controller.abort() };
  }

  describe("narrowingScopeBetween", () => {
    it("is null for no-ops and pure additions, so widening never cancels anyone", async () => {
      const { narrowingScopeBetween } = await import("../proxy/authorization-barrier.js");
      const base = { users: [{ id: "alice", enabled: true, role: "analyst", tokens: [{ hash: "sha256:" + "a".repeat(64), label: "t1" }] }], roles: { analyst: { allow: { tools: ["lucy_query"] } } } };
      expect(narrowingScopeBetween(base, base)).toBeNull();
      const added = {
        users: [...base.users, { id: "carol", enabled: true, tokens: [{ hash: "sha256:" + "c".repeat(64), label: "c1" }] }],
        roles: { ...base.roles, extra: { allow: { tools: [] } } }
      };
      expect(narrowingScopeBetween(base, added)).toBeNull();
      const extraToken = { ...base, users: [{ ...base.users[0], tokens: [...base.users[0].tokens, { hash: "sha256:" + "d".repeat(64), label: "t2" }] }] };
      expect(narrowingScopeBetween(base, extraToken)).toBeNull();
    });

    it("names the Agent for disable, delete and permission edits, and the Token for token removal", async () => {
      const { narrowingScopeBetween } = await import("../proxy/authorization-barrier.js");
      const tokenA = "sha256:" + "a".repeat(64);
      const tokenB = "sha256:" + "b".repeat(64);
      const base = {
        users: [
          { id: "alice", enabled: true, role: "analyst", tokens: [{ hash: tokenA, label: "t1" }, { hash: tokenB, label: "t2" }] },
          { id: "bob", enabled: true, tokens: [] }
        ]
      };
      const disabled = { users: [{ ...base.users[0], enabled: false }, base.users[1]] };
      expect(narrowingScopeBetween(base, disabled)).toEqual({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });

      const deleted = { users: [base.users[1]] };
      expect(narrowingScopeBetween(base, deleted)).toEqual({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });

      const roleChanged = { users: [{ ...base.users[0], role: "viewer" }, base.users[1]] };
      expect(narrowingScopeBetween(base, roleChanged)).toEqual({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });

      const tokenRemoved = { users: [{ ...base.users[0], tokens: [base.users[0].tokens[0]] }, base.users[1]] };
      expect(narrowingScopeBetween(base, tokenRemoved)).toEqual({ kind: "subjects", agentIds: [], tokenHashes: [tokenB.slice(0, 19)] });
    });

    it("treats any edited or removed Role, or changed defaults, as affecting everyone", async () => {
      const { narrowingScopeBetween } = await import("../proxy/authorization-barrier.js");
      const base = { users: [{ id: "alice", tokens: [] }], roles: { analyst: { allow: { tools: ["lucy_query", "lucy_catalog"] } } } };
      expect(narrowingScopeBetween(base, { ...base, roles: { analyst: { allow: { tools: ["lucy_query"] } } } })).toEqual({ kind: "all" });
      expect(narrowingScopeBetween(base, { ...base, roles: {} })).toEqual({ kind: "all" });
      expect(narrowingScopeBetween({ ...base, defaults: { deny_tools: [] } }, { ...base, defaults: { deny_tools: ["lucy_query"] } })).toEqual({ kind: "all" });
    });
  });

  describe("send gate", () => {
    it("re-checks the authorization version at every content send point", async () => {
      const barrier = await import("../proxy/authorization-barrier.js");
      const sent: string[] = [];
      let ended = false;
      let destroyed = false;
      const fakeRes = {
        headersSent: false,
        writableEnded: false,
        get destroyed() { return destroyed; },
        writeHead(status: number) { this.headersSent = true; sent.push(`head:${status}`); return this; },
        write(chunk: string) { sent.push(`write:${chunk}`); return true; },
        end(chunk?: string) { if (chunk) sent.push(`end:${chunk}`); ended = true; this.writableEnded = true; return this; },
        destroy() { destroyed = true; return this; },
        once() { return this; },
        on() { return this; }
      };
      const startSeq = barrier.currentAuthorizationSequence();
      const handle = barrier.beginGuardedRequest({ userId: "alice", tokenHashPrefix: tokenHash(ALICE_TOKEN).slice(0, 19) }, fakeRes as unknown as ServerResponse, startSeq);

      fakeRes.writeHead(200);
      fakeRes.write("allowed-chunk");
      expect(sent).toEqual(["head:200", "write:allowed-chunk"]);

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });
      expect(handle.isCurrent()).toBe(false);
      expect(destroyed).toBe(true); // headers were already sent: the stream is cut

      fakeRes.write(CANARY);
      fakeRes.end(CANARY);
      expect(sent.join("|")).not.toContain(CANARY);
      expect(ended).toBe(false);
    });

    it("answers a request admitted before a narrowing with an access-denied error, never content", async () => {
      const barrier = await import("../proxy/authorization-barrier.js");
      const sent: string[] = [];
      const fakeRes = {
        headersSent: false,
        writableEnded: false,
        destroyed: false,
        writeHead(status: number) { this.headersSent = true; sent.push(`head:${status}`); return this; },
        write(chunk: string) { sent.push(`write:${chunk}`); return true; },
        end(chunk?: string) { if (chunk) sent.push(`end:${chunk}`); this.writableEnded = true; return this; },
        destroy() { this.destroyed = true; return this; },
        once() { return this; },
        on() { return this; }
      };
      // The request began (sequence captured) before the narrowing was committed.
      const startSeq = barrier.currentAuthorizationSequence();
      await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });
      const handle = barrier.beginGuardedRequest({ userId: "alice", tokenHashPrefix: "sha256:whatever12345" }, fakeRes as unknown as ServerResponse, startSeq);
      expect(handle.isCurrent()).toBe(false);

      fakeRes.writeHead(200);
      fakeRes.end(CANARY);
      const wire = sent.join("|");
      expect(wire).toContain("head:403");
      expect(wire).toContain("authorization_revoked");
      expect(wire).not.toContain(CANARY);
    });

    it("leaves other Agents and Tokens untouched by a scoped narrowing", async () => {
      const barrier = await import("../proxy/authorization-barrier.js");
      const makeRes = () => ({
        headersSent: false, writableEnded: false, destroyed: false,
        writeHead() { this.headersSent = true; return this; }, write() { return true; },
        end() { this.writableEnded = true; return this; }, destroy() { this.destroyed = true; return this; },
        once() { return this; }, on() { return this; }
      });
      const seq = barrier.currentAuthorizationSequence();
      const bob = barrier.beginGuardedRequest({ userId: "bob", tokenHashPrefix: "sha256:bobbobbobbobbob" }, makeRes() as unknown as ServerResponse, seq);
      const aliceOtherToken = barrier.beginGuardedRequest({ userId: "alice", tokenHashPrefix: "sha256:aliceotherrrrrrr" }, makeRes() as unknown as ServerResponse, seq);
      const aliceRevoked = barrier.beginGuardedRequest({ userId: "alice", tokenHashPrefix: "sha256:alicerevokedxxxx" }, makeRes() as unknown as ServerResponse, seq);

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: [], tokenHashes: ["sha256:alicerevokedxxxx"] });
      expect(bob.isCurrent()).toBe(true);
      expect(aliceOtherToken.isCurrent()).toBe(true);
      expect(aliceRevoked.isCurrent()).toBe(false);

      await barrier.narrowAuthorization({ kind: "all" });
      expect(bob.isCurrent()).toBe(false);
      expect(aliceOtherToken.isCurrent()).toBe(false);
    });
  });

  describe("in-flight streams and requests over HTTP", () => {
    it("cuts the SSE stream of a narrowed Agent before the narrowing is acknowledged, and keeps other Agents' streams", async () => {
      await startProxy();
      const barrier = await import("../proxy/authorization-barrier.js");
      const alice = openStream(ALICE_TOKEN);
      const bob = openStream(BOB_TOKEN);
      await waitFor(() => streamOpened === 2, "both streams open upstream");

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });

      // Acknowledged ⇒ Alice's in-flight stream is already gone, Bob's is not.
      expect(barrier.inflightRequestCount({ agentId: "alice" })).toBe(0);
      expect(barrier.inflightRequestCount({ agentId: "bob" })).toBe(1);
      await waitFor(() => streamClosedUpstream === 1, "upstream stream of Alice closed");

      const cut = await alice.response;
      expect(cut.status).toBe(403);
      expect(cut.text).toContain("authorization_revoked");
      expect(cut.text).not.toContain("data:"); // no stream byte reached the client

      await sleep(80);
      expect(bob.settled()).toBe(false);
      expect(streamClosedUpstream).toBe(1);
      bob.abort();
    });

    it("cancels an in-flight upstream call and never delivers the late upstream content", async () => {
      await startProxy();
      const barrier = await import("../proxy/authorization-barrier.js");
      const pending = fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ALICE_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" })
      });
      await waitFor(() => toolsListHeld !== undefined, "upstream received tools/list");

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });

      const response = await pending;
      const text = await response.text();
      expect(response.status).toBe(403);
      expect(text).toContain("authorization_revoked");
      expect(text).not.toContain(CANARY);
      await waitFor(() => toolsListClosedUpstream, "upstream request aborted");
      // A late reply from the upstream has nowhere to go.
      if (!toolsListHeld!.destroyed) {
        try { toolsListHeld!.end(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [{ name: CANARY }] } })); } catch { /* socket gone */ }
      }
      expect(barrier.inflightRequestCount({ agentId: "alice" })).toBe(0);
    });

    it("clears the narrowed Agent's upstream sessions and the access-config cache, and keeps others", async () => {
      const barrier = await import("../proxy/authorization-barrier.js");
      const store = await import("../proxy/upstream-session.js");
      const alice = { agentId: "alice", tokenHash: "sha256:aaaaaaaaaaaaaaaa" };
      const aliceSecond = { agentId: "alice", tokenHash: "sha256:bbbbbbbbbbbbbbbb" };
      const bob = { agentId: "bob", tokenHash: "sha256:cccccccccccccccc" };
      store.setUpstreamSession(alice, "s-alice");
      store.setUpstreamSession(aliceSecond, "s-alice-2");
      store.setUpstreamSession(bob, "s-bob");

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] });
      expect(store.ownsUpstreamSession(alice, "s-alice")).toBe(false);
      expect(store.getUpstreamSession(alice)).toBeUndefined();
      expect(store.ownsUpstreamSession(aliceSecond, "s-alice-2")).toBe(false);
      expect(store.ownsUpstreamSession(bob, "s-bob")).toBe(true);

      await barrier.narrowAuthorization({ kind: "subjects", agentIds: [], tokenHashes: [bob.tokenHash] });
      expect(store.ownsUpstreamSession(bob, "s-bob")).toBe(false);
    });

    it("runs every barrier step before it resolves, and still reports a step that failed", async () => {
      const barrier = await import("../proxy/authorization-barrier.js");
      const store = await import("../proxy/upstream-session.js");
      const alice = { agentId: "alice", tokenHash: "sha256:aaaaaaaaaaaaaaaa" };
      store.setUpstreamSession(alice, "s-alice");
      const failing = vi.spyOn(store, "clearUpstreamSessionsMatching").mockImplementation(() => { throw new Error("cache_clear_failed"); });
      await expect(barrier.narrowAuthorization({ kind: "subjects", agentIds: ["alice"], tokenHashes: [] })).rejects.toThrow(/cache_clear_failed/);
      failing.mockRestore();
      // The new version was still committed: nothing admitted earlier is current any more.
      const seq = barrier.currentAuthorizationSequence();
      expect(seq).toBeGreaterThan(0);
    });
  });

  describe("admin narrowing wiring", () => {
    it("disabling an Agent through the access.yaml writer cuts its stream and spares others", async () => {
      await startProxy();
      const { readAccessYaml, writeAccessYaml } = await import("../admin/access-config.js");
      const alice = openStream(ALICE_TOKEN);
      const bob = openStream(BOB_TOKEN);
      await waitFor(() => streamOpened === 2, "both streams open upstream");

      const { config } = await readAccessYaml(projectRoot);
      config.users = config.users.map((user) => (user.id === "alice" ? { ...user, enabled: false } : user));
      const result = await writeAccessYaml(projectRoot, config, {
        enabled: true,
        changeType: "agent_patch",
        targetId: "alice",
        source: "t04-3-test"
      });
      expect(result.runtimeAck).toBe(true);
      expect(await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8")).toContain("enabled: false");

      const barrier = await import("../proxy/authorization-barrier.js");
      expect(barrier.inflightRequestCount({ agentId: "alice" })).toBe(0);
      await waitFor(() => streamClosedUpstream === 1, "Alice stream closed upstream");
      expect(barrier.inflightRequestCount({ agentId: "bob" })).toBe(1);
      expect((await alice.response).status).toBe(403);
      expect(bob.settled()).toBe(false);
      bob.abort();

      const denied = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "GET",
        headers: { authorization: `Bearer ${ALICE_TOKEN}` }
      });
      expect(denied.status).toBe(403);
    });

    it("revoking a Token through the admin route cuts that Token's stream before answering 200", async () => {
      await startProxy();
      const { registerTokenRoutes } = await import("../admin/tokens.js");
      const app = Fastify();
      registerTokenRoutes(app);
      await app.ready();
      try {
        const alice = openStream(ALICE_TOKEN);
        const bob = openStream(BOB_TOKEN);
        await waitFor(() => streamOpened === 2, "both streams open upstream");

        const response = await app.inject({ method: "DELETE", url: "/api/admin/agents/alice/tokens/alice-main" });
        expect(response.statusCode).toBe(200);

        const barrier = await import("../proxy/authorization-barrier.js");
        expect(barrier.inflightRequestCount({ agentId: "alice" })).toBe(0);
        expect(barrier.inflightRequestCount({ agentId: "bob" })).toBe(1);
        await waitFor(() => streamClosedUpstream === 1, "Alice stream closed upstream");
        expect((await alice.response).status).toBe(403);
        expect(bob.settled()).toBe(false);
        bob.abort();

        const replay = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
          method: "GET",
          headers: { authorization: `Bearer ${ALICE_TOKEN}` }
        });
        expect(replay.status).toBe(401);
      } finally {
        await app.close();
      }
    });

    it("a widening write (adding an Agent) does not cancel anyone", async () => {
      await startProxy();
      const { readAccessYaml, writeAccessYaml } = await import("../admin/access-config.js");
      const alice = openStream(ALICE_TOKEN);
      await waitFor(() => streamOpened === 1, "stream open upstream");
      const { config } = await readAccessYaml(projectRoot);
      config.users = [...config.users, { id: "carol", name: "Carol", enabled: true, tokens: [] }];
      await writeAccessYaml(projectRoot, config, { enabled: true, changeType: "agent_create", targetId: "carol", source: "t04-3-test" });
      const barrier = await import("../proxy/authorization-barrier.js");
      expect(barrier.inflightRequestCount({ agentId: "alice" })).toBe(1);
      expect(streamClosedUpstream).toBe(0);
      expect(alice.settled()).toBe(false);
      alice.abort();
    });
  });

  describe("customer-mode /mcp/skills passthrough", () => {
    it("fails startup preflight when the legacy passthrough is enabled in customer mode (the default)", async () => {
      process.env.LUCY_PROXY_SKILLS_PASSTHROUGH = "1";
      const { assertStartupPolicy } = await import("../auth/deployment-mode.js");
      expect(() => assertStartupPolicy()).toThrow(/LUCY_PROXY_SKILLS_PASSTHROUGH/);
      process.env.LUCY_DEPLOYMENT_MODE = "customer";
      expect(() => assertStartupPolicy()).toThrow(/LUCY_PROXY_SKILLS_PASSTHROUGH/);
    });

    it("refuses to build the proxy in customer mode with the passthrough enabled", async () => {
      process.env.LUCY_PROXY_SKILLS_PASSTHROUGH = "true";
      const { buildProxy } = await import("../proxy/mcp-proxy.js");
      expect(() => buildProxy()).toThrow(/LUCY_PROXY_SKILLS_PASSTHROUGH/);
    });

    it("keeps the passthrough closed (404) in customer mode when not enabled", async () => {
      await startProxy();
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp/skills`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${BOB_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      });
      expect(res.status).toBe(404);
    });

    it("still allows the passthrough as an explicit development-only override", async () => {
      process.env.LUCY_DEPLOYMENT_MODE = "development";
      process.env.LUCY_PROXY_SKILLS_PASSTHROUGH = "1";
      process.env.LUCY_WEBUI_COOKIE_SECURE = "0";
      const { assertStartupPolicy } = await import("../auth/deployment-mode.js");
      expect(() => assertStartupPolicy()).not.toThrow();
      await startProxy();
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp/skills`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${BOB_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
      });
      expect(res.status).toBe(200);
    });
  });
});
