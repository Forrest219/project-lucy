import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spec §4.2 / §4.4 — every channel (initialize, resources, prompts, tools, wiki search/read)
 * applies the SAME decision and answers a denial in the SAME shape. Synthetic fixtures only.
 */

const TOKENS = {
  finance: "parity-finance-token",
  discoverOnly: "parity-discover-token",
  other: "parity-other-token",
  legacy: "parity-legacy-token"
} as const;
const INTERNAL_TOKEN = "internal-parity-token";
const CANARY = "PARITY_BODY_CANARY";
const SKILL_URI = "lucy-skill://finance/parity-sop";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const agent = (id: string, token: string, extra: string) => `  - id: ${id}
    name: ${id}
    enabled: true
    tokens:
      - hash: "${tokenHash(token)}"
        label: ${id}-token
        created: 2026-10-18
${extra}`;

const ACCESS_YAML = `roles:
  finance_role:
    description: full context channels
    allow:
      tools: [lucy_skill_search, lucy_skill_read, wiki_search, wiki_read]
  finance_discover:
    description: discover channels only
    allow:
      tools: [lucy_skill_search, wiki_search]
  ops_role:
    description: unrelated role with all channels
    allow:
      tools: [lucy_skill_search, lucy_skill_read, wiki_search, wiki_read]
users:
${agent("finance_agent", TOKENS.finance, "    role: finance_role\n")}${agent("discover_agent", TOKENS.discoverOnly, "    role: finance_discover\n")}${agent("other_agent", TOKENS.other, "    role: ops_role\n")}${agent("legacy_agent", TOKENS.legacy, "    allow:\n      connections: []\n      tables: []\n      tools: [lucy_skill_search, lucy_skill_read, wiki_search, wiki_read]\n")}`;

const ENV_KEYS = ["KTX_PROJECT_ROOT", "LUCY_CONTENT_ROOT", "LUCY_PROXY_UPSTREAM_PORT", "KTX_INTERNAL_TOKEN", "LUCY_DEPLOYMENT_MODE"];

describe("context channel parity (Spec §4.2/§4.4)", () => {
  let projectRoot: string;
  const saved: Record<string, string | undefined> = {};
  let upstream: ReturnType<typeof createServer>;
  let proxy: ReturnType<typeof createServer>;
  let proxyPort: number;

  beforeEach(async () => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-parity-"));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(projectRoot, "skills", "finance"), { recursive: true });
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML);
    await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), "# Base instructions");
    await writeFile(
      path.join(projectRoot, "skills", "finance", "parity-sop.skill.md"),
      `---\nname: parity-sop\ntitle: Parity SOP\ndomain: finance\nstatus: published\nroles_allowed: [finance_role, finance_discover]\ndescription: synthetic parity skill\n---\n${CANARY}\n`
    );
    await writeFile(
      path.join(projectRoot, "wiki", "global", "parity.md"),
      `---\nallowed_roles: [finance_role, finance_discover]\n---\n# Parity Wiki\n\n${CANARY}\n`
    );

    upstream = createServer(async (req, res) => {
      const body = JSON.parse((await readRequestBody(req)) || "{}") as { id?: string | number; method?: string };
      res.writeHead(200, { "content-type": "application/json" });
      if (body.method === "initialize") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "mock", version: "1" }, instructions: "upstream" } }));
        return;
      }
      if (body.method === "tools/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: ["wiki_search", "wiki_read"].map((name) => ({ name, inputSchema: { type: "object" } })) }
        }));
        return;
      }
      // wiki_search upstream: returns the page
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ hits: [{ key: "parity", path: "wiki/global/parity.md", title: "Parity Wiki", snippet: "s" }] }) }] }
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", () => resolve()));
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    vi.resetModules();
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    proxy = buildProxy().server;
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", () => resolve()));
    proxyPort = (proxy.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `id-${method}`, method, params })
    });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as Record<string, any> };
  }

  const call = (token: string, name: string, args: Record<string, unknown>) => rpc(token, "tools/call", { name, arguments: args });
  const initialize = (token: string) =>
    rpc(token, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } });

  it("an authorized role sees and reads the objects on every channel", async () => {
    const t = TOKENS.finance;
    expect((await initialize(t)).json.result.instructions).toContain("parity-sop");
    expect((await rpc(t, "resources/list")).json.result.resources.map((r: any) => r.uri)).toContain(SKILL_URI);
    expect((await rpc(t, "prompts/list")).json.result.prompts.map((p: any) => p.name)).toContain("parity-sop");
    expect((await call(t, "lucy_skill_search", { query: "parity" })).text).toContain("parity-sop");
    expect((await call(t, "wiki_search", { query: "parity" })).text).toContain("Parity Wiki");

    expect((await rpc(t, "resources/read", { uri: SKILL_URI })).text).toContain(CANARY);
    expect((await rpc(t, "prompts/get", { name: "parity-sop" })).text).toContain(CANARY);
    expect((await call(t, "lucy_skill_read", { skill_name: "parity-sop" })).text).toContain(CANARY);
    expect((await call(t, "wiki_read", { key: "global/parity.md" })).text).toContain(CANARY);
  });

  it("an unrelated role gets no listing, no hit, and the same denial as an unknown object everywhere", async () => {
    const t = TOKENS.other;
    expect((await initialize(t)).text).not.toContain("parity-sop");
    expect((await rpc(t, "resources/list")).json.result.resources).toEqual([]);
    expect((await rpc(t, "prompts/list")).json.result.prompts).toEqual([]);
    expect(JSON.parse((await call(t, "lucy_skill_search", { query: "parity" })).json.result.content[0].text).count).toBe(0);
    expect((await call(t, "wiki_search", { query: "parity" })).text).not.toContain("Parity Wiki");

    const pairs: Array<[Promise<{ text: string }>, Promise<{ text: string }>]> = [
      [rpc(t, "resources/read", { uri: SKILL_URI }), rpc(t, "resources/read", { uri: "lucy-skill://finance/nope" })],
      [rpc(t, "prompts/get", { name: "parity-sop" }), rpc(t, "prompts/get", { name: "nope" })],
      [call(t, "lucy_skill_read", { skill_name: "parity-sop" }), call(t, "lucy_skill_read", { skill_name: "nope" })],
      [call(t, "wiki_read", { key: "global/parity.md" }), call(t, "wiki_read", { key: "global/nope.md" })]
    ];
    for (const [denied, unknown] of pairs) {
      const [d, u] = [await denied, await unknown];
      expect(d.text).not.toContain(CANARY);
      expect(d.text).toContain("context_not_available");
      expect(JSON.parse(d.text)).toEqual(JSON.parse(u.text));
    }
  });

  it("a discover-only role lists and finds the objects but cannot read bodies", async () => {
    const t = TOKENS.discoverOnly;
    expect((await rpc(t, "resources/list")).json.result.resources.map((r: any) => r.uri)).toContain(SKILL_URI);
    expect((await call(t, "lucy_skill_search", { query: "parity" })).text).toContain("parity-sop");
    expect((await call(t, "wiki_search", { query: "parity" })).text).toContain("Parity Wiki");
    for (const res of [
      await rpc(t, "resources/read", { uri: SKILL_URI }),
      await rpc(t, "prompts/get", { name: "parity-sop" }),
      await call(t, "lucy_skill_read", { skill_name: "parity-sop" }),
      await call(t, "wiki_read", { key: "global/parity.md" })
    ]) {
      expect(res.text).not.toContain(CANARY);
    }
    // wiki_read / lucy_skill_read are not even listed for this role
    const tools = (await rpc(t, "tools/list")).json.result.tools.map((tool: any) => tool.name);
    expect(tools).toEqual(expect.arrayContaining(["wiki_search", "lucy_skill_search"]));
    expect(tools).not.toContain("wiki_read");
    expect(tools).not.toContain("lucy_skill_read");
  });

  it("a legacy direct-allow agent is told context_role_required on every context channel", async () => {
    const t = TOKENS.legacy;
    expect((await initialize(t)).text).not.toContain("parity-sop");
    expect((await rpc(t, "resources/list")).json.result.resources).toEqual([]);
    for (const res of [
      await rpc(t, "resources/read", { uri: SKILL_URI }),
      await rpc(t, "prompts/get", { name: "parity-sop" }),
      await call(t, "lucy_skill_read", { skill_name: "parity-sop" }),
      await call(t, "wiki_read", { key: "global/parity.md" }),
      await call(t, "wiki_search", { query: "parity" })
    ]) {
      expect(res.text).toContain("context_role_required");
      expect(res.text).not.toContain(CANARY);
    }
  });
});
