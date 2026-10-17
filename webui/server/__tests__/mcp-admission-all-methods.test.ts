import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T04-1 / Spec §3.3 — one admission gate for every MCP path, verb and method.
// Rejected requests must never reach the upstream, where the gateway would
// attach its internal Token.

const INTERNAL_TOKEN = "internal-upstream-token-synthetic";
const CANARY = "SYNTHETIC_SKILL_CANARY";
const SKILL_URI = "lucy-skill://finance/restricted-sop";

const tokens = {
  legacy: "legacy-direct-allow-token",
  roled: "formal-role-token",
  disabled: "disabled-agent-token",
  badRole: "bad-role-token",
  bothRoles: "role-and-roles-token",
  empty: "empty-identity-token",
  expired: "expired-token",
  revoked: "revoked-token",
} as const;

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function agent(id: string, token: string, extra: string): string {
  return `  - id: ${id}
    name: ${id}
    tokens:
      - hash: "${tokenHash(token)}"
        label: ${id}-token
        created: 2026-10-18
${extra}`;
}

const legacyAllow = `    allow:
      connections: []
      tables: []
      tools:
        - lucy_skill_read
        - wiki_read
`;

const accessYaml = `roles:
  analyst:
    description: formal role
    allow:
      connections: []
      tools:
        - wiki_read
        - lucy_skill_read
users:
${agent("legacy_agent", tokens.legacy, legacyAllow)}${agent("roled_agent", tokens.roled, "    role: analyst\n")}${agent("disabled_agent", tokens.disabled, `    enabled: false\n${legacyAllow}`)}${agent("bad_role_agent", tokens.badRole, "    role: ghost_role\n")}${agent("both_roles_agent", tokens.bothRoles, "    role: analyst\n    roles: [analyst]\n")}${agent("empty_agent", tokens.empty, "    allow: {}\n")}  - id: expired_agent
    name: expired_agent
    tokens:
      - hash: "${tokenHash(tokens.expired)}"
        label: expired-token
        created: 2026-01-01
        expires_at: "2026-01-02"
${legacyAllow}  - id: revoked_agent
    name: revoked_agent
    tokens:
      - hash: "${tokenHash(tokens.revoked)}"
        label: revoked-token
        created: 2026-01-01
${legacyAllow}`;

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_CONTENT_ROOT",
  "LUCY_ACCESS_CONFIG_PATH",
  "LUCY_AUDIT_DB",
  "LUCY_PROXY_UPSTREAM_PORT",
  "LUCY_PROXY_LUCY_SKILLS_PORT",
  "LUCY_PROXY_SKILLS_PASSTHROUGH",
  "LUCY_DEPLOYMENT_MODE",
  "KTX_INTERNAL_TOKEN",
  "LUCY_MCP_ALLOWED_ORIGINS",
  "LUCY_LICENSE_MODE",
  "LUCY_LICENSE_VERIFY_SECRET",
];

type Hit = { url: string; authorization: string | undefined; body: string };

describe("MCP admission gate (T04-1)", () => {
  let projectRoot: string;
  const saved: Record<string, string | undefined> = {};
  let upstreamServer: ReturnType<typeof createServer>;
  let proxyServer: ReturnType<typeof createServer>;
  let proxyPort: number;
  let upstreamPort: number;
  let hits: Hit[];

  async function startProxy(env: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    vi.resetModules();
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    proxyServer = buildProxy().server;
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", () => resolve()));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  }

  beforeEach(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    hits = [];
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-admission-"));
    for (const dir of ["webui/config", ".ktx-ui", "config/skills/finance"]) {
      await mkdir(path.join(projectRoot, dir), { recursive: true });
    }
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
    await writeFile(accessPath, accessYaml);
    await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), "# Base\nFallback");
    await writeFile(
      path.join(projectRoot, "config", "skills", "finance", "restricted.skill.md"),
      `---\nname: restricted-sop\ntitle: Restricted SOP\ndomain: finance\nstatus: published\nroles_allowed: ["analyst"]\ndescription: synthetic\n---\n${CANARY}\n`
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = path.join(projectRoot, "config");
    process.env.LUCY_ACCESS_CONFIG_PATH = accessPath;
    process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
    delete process.env.LUCY_MCP_ALLOWED_ORIGINS;
    delete process.env.LUCY_LICENSE_MODE;
    delete process.env.LUCY_PROXY_SKILLS_PASSTHROUGH;
    delete process.env.LUCY_DEPLOYMENT_MODE;

    upstreamServer = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      hits.push({ url: req.url ?? "", authorization: req.headers.authorization, body });
      let id: string | number = 1;
      try {
        id = (JSON.parse(body) as { id?: string | number }).id ?? 1;
      } catch {}
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools: [], instructions: "upstream" } }));
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
    upstreamPort = (upstreamServer.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);
    process.env.LUCY_PROXY_LUCY_SKILLS_PORT = String(upstreamPort);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => proxyServer?.close(() => resolve()));
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    try {
      const { closeAuditDb } = await import("../proxy/audit.js");
      closeAuditDb();
    } catch {}
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function send(
    pathname: string,
    init: { method?: string; token?: string | null; body?: string; headers?: Record<string, string> } = {}
  ) {
    const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers ?? {}) };
    if (init.token !== null) headers.authorization = `Bearer ${init.token ?? tokens.legacy}`;
    const res = await fetch(`http://127.0.0.1:${proxyPort}${pathname}`, {
      method: init.method ?? "POST",
      headers,
      body: init.method === "GET" || init.method === "DELETE" ? undefined : init.body,
    });
    const text = await res.text();
    let json: Record<string, any> | undefined;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, text, json, headers: res.headers };
  }

  const rpc = (method: string, params: Record<string, unknown> = {}, token?: string, extra: Record<string, unknown> = {}) =>
    send("/mcp", { token, body: JSON.stringify({ jsonrpc: "2.0", id: `id-${method}`, method, params, ...extra }) });

  describe("disabled / role resolution / empty identity", () => {
    beforeEach(async () => {
      await startProxy();
    });

    const METHODS: Array<[string, Record<string, unknown>]> = [
      ["initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }],
      ["ping", {}],
      ["tools/list", {}],
      ["tools/call", { name: "lucy_skill_read", arguments: { uri: SKILL_URI } }],
      ["resources/list", {}],
      ["resources/templates/list", {}],
      ["resources/read", { uri: SKILL_URI }],
      ["prompts/list", {}],
      ["prompts/get", { name: "restricted-sop" }],
    ];

    it.each(METHODS)("disabled Agent: %s is 403 agent_disabled with no canary and no upstream hit", async (method, params) => {
      const res = await rpc(method, params, tokens.disabled);
      expect(res.status).toBe(403);
      expect(res.text).not.toContain(CANARY);
      expect(res.json).toEqual({
        jsonrpc: "2.0",
        id: `id-${method}`,
        error: { code: -32003, message: "Access denied: agent_disabled" },
      });
      expect(hits).toHaveLength(0);
    });

    it("disabled Agent: notifications and GET/DELETE are rejected without forwarding", async () => {
      for (const body of [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: "x" } },
      ]) {
        const res = await send("/mcp", { token: tokens.disabled, body: JSON.stringify(body) });
        expect(res.status).toBe(403);
      }
      for (const method of ["GET", "DELETE"]) {
        const res = await send("/mcp", { method, token: tokens.disabled });
        expect(res.status).toBe(403);
        expect(res.json?.error?.message).toBe("Access denied: agent_disabled");
      }
      expect(hits).toHaveLength(0);
    });

    it("declared role that cannot be resolved is 403 role_resolution_failed on every method", async () => {
      for (const token of [tokens.badRole, tokens.bothRoles]) {
        for (const [method, params] of METHODS) {
          const res = await rpc(method, params, token);
          expect(res.status).toBe(403);
          expect(res.json?.error).toEqual({ code: -32003, message: "Access denied: role_resolution_failed" });
        }
        expect((await send("/mcp", { method: "GET", token })).status).toBe(403);
      }
      expect(hits).toHaveLength(0);
    });

    it("empty identity (no role, no valid direct-allow) cannot impersonate legacy", async () => {
      for (const [method, params] of METHODS) {
        const res = await rpc(method, params, tokens.empty);
        expect(res.status).toBe(403);
      }
      expect(hits).toHaveLength(0);
    });

    it("writes denied audit rows with the denial reason", async () => {
      await rpc("resources/read", { uri: SKILL_URI }, tokens.disabled);
      await rpc("tools/list", {}, tokens.badRole);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const { getAuditDb } = await import("../admin/audit.js");
      const db = await getAuditDb();
      const rows = db
        .prepare("SELECT user_id, tool, outcome, error_detail FROM access_log WHERE outcome = 'denied'")
        .all() as Array<{ user_id: string; tool: string; outcome: string; error_detail: string | null }>;
      expect(rows.some((r) => r.user_id === "disabled_agent" && r.tool === "resources/read" && r.error_detail === "agent_disabled")).toBe(true);
      expect(rows.some((r) => r.user_id === "bad_role_agent" && r.tool === "tools/list" && r.error_detail === "role_resolution_failed:ghost_role")).toBe(true);
    });
  });

  describe("controls: legacy direct-allow and formal role are admitted", () => {
    beforeEach(async () => {
      await startProxy();
    });

    it("legacy direct-allow keeps its data-plane path but context needs a formal role (Spec §4.1)", async () => {
      const res = await rpc("tools/list", {}, tokens.legacy);
      expect(res.status).toBe(200);
      expect(hits.length).toBeGreaterThan(0);
      const read = await rpc("resources/read", { uri: SKILL_URI }, tokens.legacy);
      expect(read.status).toBe(200);
      expect(read.text).toContain("context_role_required");
      expect(read.text).not.toContain(CANARY);
    });

    it("formal role Agent is admitted and reads the Skill its role is authorized for", async () => {
      const res = await rpc("tools/list", {}, tokens.roled);
      expect(res.status).toBe(200);
      const read = await rpc("resources/read", { uri: SKILL_URI }, tokens.roled);
      expect(read.status).toBe(200);
      expect(read.text).toContain(CANARY);
    });

    it("admission reports role facts for T05 (roles vs legacy direct-allow)", async () => {
      const { resolveAdmissionSubject } = await import("../proxy/acl.js");
      expect(await resolveAdmissionSubject("legacy_agent")).toEqual({
        ok: true,
        subject: { roleIds: [], legacyDirectAllow: true },
      });
      expect(await resolveAdmissionSubject("roled_agent")).toEqual({
        ok: true,
        subject: { roleIds: ["analyst"], legacyDirectAllow: false },
      });
    });

    it("forwards with the gateway token only; the client Bearer never reaches upstream", async () => {
      await rpc("tools/list", {}, tokens.legacy);
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.authorization).toBe(`Bearer ${INTERNAL_TOKEN}`);
        expect(hit.authorization).not.toContain(tokens.legacy);
      }
    });

    it("canonicalizes the upstream path (no query / suffix smuggling)", async () => {
      await send("/mcp/?debug=1&x=../admin", {
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) expect(hit.url).toBe("/mcp");
    });
  });

  describe("authentication failures are 401 and never forwarded", () => {
    beforeEach(async () => {
      await startProxy();
    });

    it("rejects missing, wrong, expired and revoked Bearer on every verb", async () => {
      // Seed the audit db so the revoke row can be written.
      await rpc("tools/list", {}, tokens.legacy);
      const { getAuditDb } = await import("../admin/audit.js");
      const db = await getAuditDb();
      db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
        tokenHash(tokens.revoked),
        new Date().toISOString(),
        "test"
      );
      hits.length = 0;

      for (const token of [null, "wrong-token", tokens.expired, tokens.revoked]) {
        const post = await rpc("resources/list", {}, token === null ? (null as unknown as string) : token);
        expect(post.status).toBe(401);
        expect(post.json?.error?.code).toBe(-32001);
        for (const method of ["GET", "DELETE"]) {
          expect((await send("/mcp", { method, token })).status).toBe(401);
        }
      }
      expect(hits).toHaveLength(0);
    });

    it("sessionId is not authentication", async () => {
      const res = await send("/mcp", {
        token: null,
        headers: { "mcp-session-id": "any-session" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(401);
      expect(hits).toHaveLength(0);
    });
  });

  describe("path, verb and envelope allowlist", () => {
    beforeEach(async () => {
      await startProxy();
    });

    it("unknown paths are 404 (with or without a Token) and never forwarded", async () => {
      for (const pathname of ["/", "/admin", "/mcp/other", "/mcp/skills", "/mcp/skills/v1/foo", "/mcpx", "/mcp/../mcp/x"]) {
        for (const token of [undefined, null]) {
          const res = await send(pathname, {
            token,
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          });
          expect(res.status).toBe(404);
        }
      }
      expect(hits).toHaveLength(0);
    });

    it("unsupported HTTP verbs are 405 with Allow", async () => {
      for (const method of ["PUT", "PATCH", "OPTIONS"]) {
        const res = await send("/mcp", { method, body: "{}" });
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toBe("POST, GET, DELETE");
      }
      expect(hits).toHaveLength(0);
    });

    it.each([
      ["batch array", JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "tools/list" }]), 400, -32600],
      ["empty batch", "[]", 400, -32600],
      ["number", "42", 400, -32600],
      ["string", '"tools/list"', 400, -32600],
      ["null", "null", 400, -32600],
      ["invalid JSON", "{not json", 400, -32700],
      ["empty body", "", 400, -32700],
      ["missing jsonrpc", JSON.stringify({ id: 1, method: "tools/list" }), 400, -32600],
      ["missing method (response envelope)", JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), 400, -32600],
      ["object id", JSON.stringify({ jsonrpc: "2.0", id: { a: 1 }, method: "tools/list" }), 400, -32600],
      ["unknown method", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "admin/dumpEverything" }), 404, -32601],
      ["unsupported notification", JSON.stringify({ jsonrpc: "2.0", method: "notifications/roots/list_changed" }), 404, -32601],
    ])("rejects %s without forwarding", async (_name, body, status, code) => {
      const res = await send("/mcp", { body });
      expect(res.status).toBe(status);
      expect(res.json?.error?.code).toBe(code);
      expect(hits).toHaveLength(0);
    });

    it("unauthenticated malformed envelope is still 401, not a shape oracle", async () => {
      const res = await send("/mcp", { token: null, body: "[]" });
      expect(res.status).toBe(401);
      expect(hits).toHaveLength(0);
    });
  });

  describe("Origin", () => {
    beforeEach(async () => {
      await startProxy({ LUCY_MCP_ALLOWED_ORIGINS: "https://trusted.example.com" });
    });

    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    it("denies cross-site and null Origin before authentication, without forwarding", async () => {
      for (const origin of ["https://evil.example.com", "null", "not a url"]) {
        const res = await send("/mcp", { body, headers: { origin } });
        expect(res.status).toBe(403);
        expect(res.json?.error?.message).toBe("Access denied: origin_not_allowed");
        const get = await send("/mcp", { method: "GET", headers: { origin } });
        expect(get.status).toBe(403);
      }
      expect(hits).toHaveLength(0);
    });

    it("allows native clients (no Origin), same-host and configured Origins — still authenticated", async () => {
      expect((await send("/mcp", { body })).status).toBe(200);
      expect((await send("/mcp", { body, headers: { origin: `http://127.0.0.1:${proxyPort}` } })).status).toBe(200);
      expect((await send("/mcp", { body, headers: { origin: "https://trusted.example.com" } })).status).toBe(200);
      const unauth = await send("/mcp", { body, token: null, headers: { origin: "https://trusted.example.com" } });
      expect(unauth.status).toBe(401);
    });
  });

  describe("license", () => {
    beforeEach(async () => {
      await startProxy({ LUCY_LICENSE_MODE: "enforce" });
    });

    it("enforce mode without an active license denies non-tool methods and verbs uniformly", async () => {
      for (const [method, params] of [
        ["initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }],
        ["tools/list", {}],
        ["resources/list", {}],
        ["resources/read", { uri: SKILL_URI }],
        ["prompts/list", {}],
      ] as Array<[string, Record<string, unknown>]>) {
        const res = await rpc(method, params, tokens.legacy);
        expect(res.status).toBe(403);
        expect(res.json?.error?.message).toBe("Access denied: license_missing");
        expect(res.text).not.toContain(CANARY);
      }
      expect((await send("/mcp", { method: "GET" })).status).toBe(403);
      expect(hits).toHaveLength(0);
    });

    it("tools/call keeps its existing in-handler license result", async () => {
      const res = await rpc("tools/call", { name: "wiki_read", arguments: { key: "x" } }, tokens.legacy);
      expect(res.status).toBe(200);
      expect(res.json?.result?.isError).toBe(true);
      expect(JSON.stringify(res.json)).toContain("license_missing");
      expect(hits).toHaveLength(0);
    });
  });

  describe("legacy /mcp/skills passthrough path", () => {
    it("is 404 when the passthrough is not enabled, even for a valid Token", async () => {
      await startProxy();
      const res = await send("/mcp/skills", { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      expect(res.status).toBe(404);
      expect(hits).toHaveLength(0);
    });

    it("when explicitly enabled it shares the same admission (auth, disabled, envelope, path)", async () => {
      await startProxy({ LUCY_PROXY_SKILLS_PASSTHROUGH: "1", LUCY_DEPLOYMENT_MODE: "development" });
      const ok = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect((await send("/mcp/skills", { token: null, body: ok })).status).toBe(401);
      expect((await send("/mcp/skills", { token: tokens.disabled, body: ok })).status).toBe(403);
      expect((await send("/mcp/skills", { body: "[]" })).status).toBe(400);
      expect((await send("/mcp/skills/v1/foo", { body: ok })).status).toBe(404);
      expect(hits).toHaveLength(0);

      expect((await send("/mcp/skills", { body: ok })).status).toBe(200);
      expect(hits).toHaveLength(1);
      expect(hits[0].url).toBe("/mcp");
      expect(hits[0].authorization).toBe(`Bearer ${INTERNAL_TOKEN}`);
    });
  });
});
