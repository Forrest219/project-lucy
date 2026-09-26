import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "proxy-skills-test-token";
const INTERNAL_TOKEN = "internal-skills-test-token";

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

const ACCESS_YAML = `users:
  - id: skills_test_agent
    name: Skills Test Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: skills-test-token
        created: 2026-08-29
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_skill_search
        - lucy_skill_read
        - wiki_search
        - wiki_read
`;

const KTX_YAML = `connections:
  mysql-aliyun:
    type: mysql
    database: dataforai
    enabled_tables:
      - dataforai.superstore_orders
`;

describe("MCP Proxy Governed Skills Protocol (Spec 131)", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;
  let upstreamPort: number;
  let proxyPort: number;
  let upstreamServer: ReturnType<typeof createServer>;
  let proxyServer: ReturnType<typeof createServer>;

  beforeEach(async () => {
    previousRoot = process.env.KTX_PROJECT_ROOT;
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-skills-test-"));
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;

    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
    await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
    await mkdir(path.join(projectRoot, "evals", "superstore"), { recursive: true });
    await mkdir(path.join(projectRoot, "skills", "domains", "superstore"), { recursive: true });

    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML);
    await writeFile(path.join(projectRoot, "ktx.yaml"), KTX_YAML);
    await writeFile(
      path.join(projectRoot, "webui", "config", "data-qa-instructions.md"),
      "# Base Data QA Instructions\nFallback instructions"
    );

    // Create a mock skill file in skills/
    const skillContent = `---
name: mock-profit-skill
title: Mock Superstore Profit SOP
version: 1.0.0
domain: superstore
status: published
roles_allowed: ["*"]
prerequisites:
  sources: ["mysql-aliyun.superstore_orders"]
triggers:
  - "利润分析"
  - "亏损排查"
eval_cases:
  - "evals/superstore/test.yaml"
description: Mock profit breakdown analysis
---
# Mock Profit Analysis SOP
Step 1: Check region
Step 2: Check category
`;
    await writeFile(
      path.join(projectRoot, "skills", "domains", "superstore", "mock-profit-skill.skill.md"),
      skillContent
    );

    // Draft skill: must not be agent-visible through any channel (Spec 144)
    const draftSkillContent = `---
name: mock-draft-skill
title: Mock Draft SOP
domain: superstore
status: draft
roles_allowed: ["*"]
triggers:
  - "草稿"
description: Mock draft SOP
---
# Mock Draft SOP
not for agents
`;
    await writeFile(
      path.join(projectRoot, "skills", "domains", "superstore", "mock-draft-skill.skill.md"),
      draftSkillContent
    );

    // Upstream KTX mock server
    upstreamServer = createServer(async (req, res) => {
      const bodyStr = await readRequestBody(req);
      let parsed: { id?: string | number; method?: string } = {};
      try {
        parsed = JSON.parse(bodyStr);
      } catch {}

      if (parsed.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id ?? 1,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "mock-ktx", version: "1.0.0" },
              instructions: "upstream instructions",
            },
          })
        );
        return;
      }

      if (parsed.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: parsed.id ?? 2,
            result: {
              tools: [
                { name: "lucy_catalog", description: "catalog" },
                { name: "wiki_search", description: "wiki search" },
              ],
            },
          })
        );
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id ?? 99, result: {} }));
    });

    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", () => resolve()));
    upstreamPort = (upstreamServer.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    vi.resetModules();
    const { buildProxy } = await import("../proxy/mcp-proxy.js");
    const built = buildProxy();
    proxyServer = built.server;
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", () => resolve()));
    proxyPort = (proxyServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("injects governed skills in initialize instructions", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { result?: { instructions?: string } };
    expect(json.result?.instructions).toContain("Governed Domain Skills (SOPs)");
    expect(json.result?.instructions).toContain("mock-profit-skill");
  });

  it("handles resources/list and returns accessible skill URIs", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "res-list-1",
        method: "resources/list",
        params: {},
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { resources?: Array<{ uri: string; name: string; mimeType: string }> };
    };
    expect(json.result?.resources).toBeDefined();
    expect(json.result?.resources?.length).toBeGreaterThanOrEqual(1);
    const mockRes = json.result?.resources?.find((r) => r.name === "mock-profit-skill");
    expect(mockRes).toBeDefined();
    expect(mockRes?.uri).toBe("lucy-skill://superstore/mock-profit-skill");
  });

  it("handles resources/read and returns skill markdown content", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "res-read-1",
        method: "resources/read",
        params: {
          uri: "lucy-skill://superstore/mock-profit-skill",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { contents?: Array<{ uri: string; text: string }> };
    };
    expect(json.result?.contents).toBeDefined();
    expect(json.result?.contents?.[0]?.text).toContain("Mock Profit Analysis SOP");
  });

  it("handles prompts/list and prompts/get", async () => {
    // prompts/list
    const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "prompt-list-1",
        method: "prompts/list",
      }),
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      result?: { prompts?: Array<{ name: string; description: string }> };
    };
    expect(listJson.result?.prompts?.some((p) => p.name === "mock-profit-skill")).toBe(true);

    // prompts/get
    const getRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "prompt-get-1",
        method: "prompts/get",
        params: {
          name: "mock-profit-skill",
        },
      }),
    });
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      result?: { messages?: Array<{ content?: { text?: string } }> };
    };
    expect(getJson.result?.messages?.[0]?.content?.text).toContain("Active Governed Skill: Mock Superstore Profit SOP");
  });

  it("handles tools/call for lucy_skill_search and lucy_skill_read", async () => {
    // lucy_skill_search
    const searchRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tool-search-1",
        method: "tools/call",
        params: {
          name: "lucy_skill_search",
          arguments: {
            query: "利润",
          },
        },
      }),
    });
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    const searchResult = JSON.parse(searchJson.result?.content?.[0]?.text ?? "{}");
    expect(searchResult.count).toBeGreaterThanOrEqual(1);
    expect(searchResult.skills[0].name).toBe("mock-profit-skill");

    // lucy_skill_read
    const readRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "tool-read-1",
        method: "tools/call",
        params: {
          name: "lucy_skill_read",
          arguments: {
            skill_name: "mock-profit-skill",
          },
        },
      }),
    });
    expect(readRes.status).toBe(200);
    const readJson = (await readRes.json()) as {
      result?: { content?: Array<{ text: string }> };
    };
    expect(readJson.result?.content?.[0]?.text).toContain("Mock Profit Analysis SOP");
  });

  it("uses search for discovery and read for body access", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML.replace("        - lucy_skill_read\n", "")
    );
    const { invalidateAccessConfigCache } = await import("../proxy/identity.js");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl.js");
    invalidateAccessConfigCache();
    resetEffectivePolicyForTests();

    const post = (body: unknown) => fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const list = await post({ jsonrpc: "2.0", id: "split-list", method: "resources/list", params: {} });
    const listJson = await list.json() as { result?: { resources?: Array<{ name: string }> } };
    expect(listJson.result?.resources?.some((resource) => resource.name === "mock-profit-skill")).toBe(true);

    const read = await post({
      jsonrpc: "2.0",
      id: "split-read",
      method: "resources/read",
      params: { uri: "lucy-skill://superstore/mock-profit-skill" }
    });
    const readJson = await read.json() as { error?: { code: number; message: string } };
    expect(readJson.error?.code).toBe(-32003);
    expect(readJson.error?.message).toContain("skill_channel_forbidden:read");
  });

  it("hides draft skills from all agent channels (Spec 144)", { timeout: 20000 }, async () => {    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

    // initialize instructions must not catalog drafts
    const initRes = await post({
      jsonrpc: "2.0",
      id: "init-draft",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    });
    const initJson = (await initRes.json()) as { result?: { instructions?: string } };
    expect(initJson.result?.instructions).toContain("mock-profit-skill");
    expect(initJson.result?.instructions ?? "").not.toContain("mock-draft-skill");

    // resources/list must not include drafts
    const listRes = await post({ jsonrpc: "2.0", id: "list-draft", method: "resources/list", params: {} });
    const listJson = (await listRes.json()) as { result?: { resources?: Array<{ name: string }> } };
    expect(listJson.result?.resources?.some((r) => r.name === "mock-draft-skill") ?? false).toBe(false);

    // resources/read of a draft is denied with -32003 / skill_not_published
    const readRes = await post({
      jsonrpc: "2.0",
      id: "read-draft",
      method: "resources/read",
      params: { uri: "lucy-skill://superstore/mock-draft-skill" },
    });
    const draftReadJson = (await readRes.json()) as { error?: { code: number; message: string } };
    expect(draftReadJson.error?.code).toBe(-32003);
    expect(draftReadJson.error?.message).toContain("skill_not_published");

    // lucy_skill_read of a draft is denied
    const toolRes = await post({
      jsonrpc: "2.0",
      id: "tool-draft",
      method: "tools/call",
      params: { name: "lucy_skill_read", arguments: { skill_name: "mock-draft-skill" } },
    });
    const toolJson = (await toolRes.json()) as {
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    };
    expect(toolJson.result?.isError).toBe(true);
    expect(toolJson.result?.content?.[0]?.text).toContain("skill_not_published");

    // lucy_skill_search must not match drafts
    const searchRes = await post({
      jsonrpc: "2.0",
      id: "search-draft",
      method: "tools/call",
      params: { name: "lucy_skill_search", arguments: { query: "Mock" } },
    });
    const searchJson = (await searchRes.json()) as { result?: { content?: Array<{ text: string }> } };
    const searchResult = JSON.parse(searchJson.result?.content?.[0]?.text ?? "{}") as {
      skills?: Array<{ name: string }>;
    };
    expect(searchResult.skills?.some((s) => s.name === "mock-draft-skill") ?? false).toBe(false);

    // prompts/list must not include drafts
    const promptsRes = await post({ jsonrpc: "2.0", id: "prompts-draft", method: "prompts/list" });
    const promptsJson = (await promptsRes.json()) as { result?: { prompts?: Array<{ name: string }> } };
    expect(promptsJson.result?.prompts?.some((p) => p.name === "mock-draft-skill") ?? false).toBe(false);

    // SC-144-06: allow and deny both land in the access log with stable reasons.
    // The audit DB may be redirected via LUCY_AUDIT_DB in the test environment.
    const dbPath = process.env.LUCY_AUDIT_DB ?? path.join(projectRoot, ".ktx-ui", "audit.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const { existsSync } = await import("node:fs");
    type AuditRow = { tool: string; outcome: string; error_detail: string | null; decision_reason: string | null };
    let rows: AuditRow[] = [];
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (existsSync(dbPath)) {
        const db = new Database(dbPath, { readonly: true });
        rows = db.prepare("SELECT tool, outcome, error_detail, decision_reason FROM access_log").all() as AuditRow[];
        db.close();
      }
      const hasAllow = rows.some((r) => r.outcome === "ok" && r.decision_reason === "allowed");
      const hasDeny = rows.some(
        (r) => r.outcome === "denied" && (r.error_detail ?? "").includes("skill_not_published")
      );
      if (hasAllow && hasDeny) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(rows.some((r) => r.outcome === "ok" && r.decision_reason === "allowed")).toBe(true);
    expect(
      rows.some((r) => r.outcome === "denied" && (r.error_detail ?? "").includes("skill_not_published"))
    ).toBe(true);
  });
});
