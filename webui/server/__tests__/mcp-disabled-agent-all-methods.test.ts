import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// T0A-3 / V-02 minimal fix: a disabled Agent's valid Token must be rejected on
// every MCP method before any content (Skill canary) is produced or forwarded.

const TOKEN = "disabled-agent-test-token";
const CANARY = "SYNTHETIC_SKILL_CANARY";
const SKILL_URI = "lucy-skill://finance/restricted-sop";

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

const accessYaml = (enabled: boolean) => `users:
  - id: isolated_agent
    name: Isolated Agent
    enabled: ${enabled}
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: disabled-test-token
        created: 2026-10-18
    allow:
      connections: []
      tables: []
      tools:
        - lucy_skill_read
        - lucy_skill_search
        - wiki_read
`;

const METHODS: Array<[string, Record<string, unknown>]> = [
  ["initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } }],
  ["tools/list", {}],
  ["tools/call", { name: "lucy_skill_read", arguments: { uri: SKILL_URI } }],
  ["resources/list", {}],
  ["resources/read", { uri: SKILL_URI }],
  ["prompts/list", {}],
  ["prompts/get", { name: "restricted-sop" }],
];

describe("MCP disabled Agent is rejected on all methods (T0A-3 / V-02)", () => {
  let projectRoot: string;
  const saved: Record<string, string | undefined> = {};
  let upstreamServer: ReturnType<typeof createServer>;
  let proxyServer: ReturnType<typeof createServer>;
  let proxyPort: number;
  let upstreamHits: number;
  let accessPath: string;

  beforeEach(async () => {
    for (const key of ["KTX_PROJECT_ROOT", "LUCY_CONTENT_ROOT", "LUCY_ACCESS_CONFIG_PATH", "LUCY_AUDIT_DB", "LUCY_PROXY_UPSTREAM_PORT"]) {
      saved[key] = process.env[key];
    }
    upstreamHits = 0;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-disabled-agent-"));
    for (const dir of ["webui/config", ".ktx-ui", "config/skills/finance"]) {
      await mkdir(path.join(projectRoot, dir), { recursive: true });
    }
    accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n");
    await writeFile(accessPath, accessYaml(false));
    await writeFile(
      path.join(projectRoot, "webui", "config", "data-qa-instructions.md"),
      "# Base Data QA Instructions\nFallback instructions"
    );
    await writeFile(
      path.join(projectRoot, "config", "skills", "finance", "restricted.skill.md"),
      `---\nname: restricted-sop\ntitle: Restricted SOP\ndomain: finance\nstatus: published\nroles_allowed: ["*"]\ndescription: synthetic\n---\n${CANARY}\n`
    );
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = path.join(projectRoot, "config");
    process.env.LUCY_ACCESS_CONFIG_PATH = accessPath;
    process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");

    upstreamServer = createServer(async (req, res) => {
      upstreamHits += 1;
      const bodyStr = await readRequestBody(req);
      let parsed: { id?: string | number } = {};
      try {
        parsed = JSON.parse(bodyStr);
      } catch {}
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? 1, result: { tools: [], instructions: "upstream" } }));
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstreamServer.address() as AddressInfo).port);

    vi.resetModules();
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    proxyServer = buildProxy().server;
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", () => resolve()));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    try {
      const { closeAuditDb } = await import("../proxy/audit.js");
      closeAuditDb();
    } catch {}
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  async function rpc(method: string, params: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `id-${method}`, method, params }),
    });
    return { status: res.status, text: await res.text() };
  }

  it.each(METHODS)("rejects %s with agent_disabled and no canary", async (method, params) => {
    const res = await rpc(method, params);
    expect(res.status).toBe(403);
    expect(res.text).not.toContain(CANARY);
    expect(res.text).not.toContain("restricted-sop");
    expect(JSON.parse(res.text)).toEqual({
      jsonrpc: "2.0",
      id: `id-${method}`,
      error: { code: -32003, message: "Access denied: agent_disabled" },
    });
    expect(upstreamHits).toBe(0);
  });

  it("rejects GET and DELETE /mcp without forwarding upstream", async () => {
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method,
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      expect(res.status).toBe(403);
      expect(JSON.parse(await res.text())).toEqual({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32003, message: "Access denied: agent_disabled" },
      });
    }
    expect(upstreamHits).toBe(0);
  });

  it("writes a denied audit row for the rejected request", async () => {
    await rpc("resources/read", { uri: SKILL_URI });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const { getAuditDb } = await import("../admin/audit.js");
    const db = await getAuditDb();
    const rows = db
      .prepare("SELECT tool, outcome, error_detail FROM access_log WHERE user_id = ?")
      .all("isolated_agent") as Array<{ tool: string; outcome: string; error_detail: string | null }>;
    expect(rows.some((row) => row.tool === "resources/read" && row.outcome === "denied" && row.error_detail === "agent_disabled")).toBe(true);
  });

  it("control: enabled Agent still reads the Skill via resources/read", async () => {
    await writeFile(accessPath, accessYaml(true));
    const { invalidateAccessConfigCache } = await import("../proxy/identity.js");
    const { commitEffectivePolicy } = await import("../proxy/acl.js");
    invalidateAccessConfigCache();
    await commitEffectivePolicy();
    const res = await rpc("resources/read", { uri: SKILL_URI });
    expect(res.status).toBe(200);
    expect(res.text).toContain(CANARY);
  });
});
