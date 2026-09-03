import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// The injection feature rewrites upstream `initialize` responses by replacing
// `result.instructions` with the contents of
// `webui/config/data-qa-instructions.md`. Tests need a real file at that path
// under a fake project root, plus an access.yaml that grants the smoke agent
// token a valid identity.

const TOKEN = "proxy-instructions-token";
const INTERNAL_TOKEN = "internal-instructions-token";

// The instructions text must contain a stable phrase the tests can grep for.
// This mirrors the real data-qa-instructions.md shape (Markdown with code blocks).
const INSTRUCTIONS_FIXTURE = `# Lucy Test Instructions

查询 superstore_orders 数据时，请先调用 kx_catalog 工具确认可见的数据域。

\`\`\`
KEY_PHRASE_FOR_TESTS: instructions_injection_marker_xyz
\`\`\`
`;

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: instructions_agent
    name: Instructions Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: instructions-token
        created: 2026-06-23
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - kx_catalog
        - sl_read_source
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

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
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousEnableInstructions: string | undefined;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-proxy-instructions-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "webui", "config", "data-qa-instructions.md"), INSTRUCTIONS_FIXTURE, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  return root;
}

async function waitForAuditRow(requestId: string, timeoutMs = 1000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
      if (row) return row;
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
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousEnableInstructions = process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  // Default to enabled; individual tests override as needed.
  delete process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousInternalToken === undefined) delete process.env.KTX_INTERNAL_TOKEN;
  else process.env.KTX_INTERNAL_TOKEN = previousInternalToken;
  if (previousUpstreamHost === undefined) delete process.env.LUCY_PROXY_UPSTREAM_HOST;
  else process.env.LUCY_PROXY_UPSTREAM_HOST = previousUpstreamHost;
  if (previousUpstreamPort === undefined) delete process.env.LUCY_PROXY_UPSTREAM_PORT;
  else process.env.LUCY_PROXY_UPSTREAM_PORT = previousUpstreamPort;
  if (previousEnableInstructions === undefined) delete process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;
  else process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION = previousEnableInstructions;
  await rm(projectRoot, { recursive: true, force: true });
});

/** Spin up a mock KTX upstream + a Lucy proxy on a fresh pair of ports. */
async function startProxy(
  upstreamHandler: (req: IncomingMessage, res: import("node:http").ServerResponse) => Promise<void> | void
): Promise<{ upstream: Server; server: Server; proxyPort: number }> {
  const upstream = createServer(upstreamHandler);
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamPort = (upstream.address() as AddressInfo).port;
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const proxyPort = (server.address() as AddressInfo).port;
  return { upstream, server, proxyPort };
}

async function closeAll(upstream: Server, server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
}

function initializeRequest(id: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { clientInfo: { name: "test-client", version: "2.3.4" } }
  });
}

describe("MCP proxy initialize instructions injection", () => {
  it("overrides an empty upstream result.instructions with the proxy's data-QA text", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-empty",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ktx", version: "0.12.0" },
          capabilities: { tools: {} },
          instructions: ""
        }
      }));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-empty")
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions: string; serverInfo: { name: string } } };
      expect(body.result.serverInfo.name).toBe("ktx");
      expect(body.result.instructions).toContain("Lucy Data QA Runtime Instructions");
      expect(body.result.instructions).toContain("lucy_catalog");
      expect(body.result.instructions).toContain("lucy_query");
      expect(body.result.instructions).toContain("lucy_read_source");
      expect(body.result.instructions).toContain("Visible Scope below is captured at MCP initialize");
      expect(body.result.instructions).not.toContain("call `sl_query` or `sl_read_source`");
      expect(body.result.instructions).toContain("mysql-aliyun.dataforai.superstore_orders");
      expect(body.result.instructions).toContain("source-qualified semantic keys");
      expect(body.result.instructions).toContain("Use `{expr,name}` objects only for ad hoc aggregate expressions");
      expect(body.result.instructions).toContain("answerability dependency matrix");
      expect(body.result.instructions).toContain("Never substitute forecast");
      expect(body.result.instructions).toContain("labeled hybrid");
      expect(body.result.instructions).toContain("realized unit price");
      expect(body.result.instructions).toContain("at most 12 business tool calls");
      expect(body.result.instructions).toContain("Partial evidence still requires a final response");
      expect(body.result.instructions).not.toContain("lucy_begin_question");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("injects optional lucy_begin_question soft nudge only when the tool is visible", async () => {
    const withBeginYaml = `users:
  - id: instructions_agent
    name: Instructions Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: instructions-token
        created: 2026-06-23
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_begin_question
        - kx_catalog
        - sl_read_source
defaults:
  deny_tools: []
`;
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), withBeginYaml, "utf8");

    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-begin-nudge",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ktx", version: "0.12.0" },
          capabilities: { tools: {} },
          instructions: ""
        }
      }));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-begin-nudge")
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions: string } };
      expect(body.result.instructions).toContain("lucy_begin_question");
      expect(body.result.instructions).toContain("Skipping this call never blocks catalog or query tools");
      expect(body.result.instructions).toContain("Prefer the user's original wording in `question`");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("injects instructions when upstream result has no instructions field at all", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-missing",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ktx", version: "0.12.0" },
          capabilities: { tools: {} }
        }
      }));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-missing")
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions: string } };
      expect(body.result.instructions).toContain("Lucy Data QA Runtime Instructions");
      expect(body.result.instructions).toContain("superstore_orders");
      expect(body.result.instructions).toContain("lucy_query");
      expect(body.result.instructions).not.toContain("For `sl_query`");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("falls back to pass-through (200 + original body) when upstream body is malformed JSON, NOT -32003", async () => {
    // This is the core fail-open guarantee. tools/list returns -32003 on filter
    // failure; initialize MUST NOT — pass the original bytes through so the
    // client can still complete the MCP handshake.
    const malformedBody = "this is not json {{ broken";
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(malformedBody);
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-malformed")
      });
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe(malformedBody);
      expect(text).not.toContain("tools/list filtering failed");
      expect(text).not.toContain('"code":-32003');
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("rewrites SSE-wrapped initialize responses and restores JSON-RPC envelope", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      const payload = {
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ktx", version: "0.12.0" },
          capabilities: { tools: {} }
        }
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-sse")
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("application/json");
      expect(res.headers.get("cache-control") ?? "").toContain("no-store");
      const payload = await res.json() as { jsonrpc: string; id: string; result: { instructions: string } };
      expect(payload.jsonrpc).toBe("2.0");
      expect(payload.id).toBe("init-sse");
      expect(payload.result.instructions).toContain("Lucy Data QA Runtime Instructions");
      expect(payload.result.instructions).toContain("superstore_orders");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("writes an audit row with tool=initialize and decision_reason=allowed on success", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-audit-ok",
        result: { serverInfo: { name: "ktx" }, capabilities: { tools: {} } }
      }));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-audit-ok")
      });
      expect(res.status).toBe(200);

      const audit = await waitForAuditRow("init-audit-ok");
      expect(audit.user_id).toBe("instructions_agent");
      expect(audit.tool).toBe("initialize");
      expect(audit.outcome).toBe("ok");
      expect(audit.decision_reason).toBe("allowed");
      expect(audit.error_detail).toBeNull();
      expect(String(audit.permission_snapshot_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(audit.response_bytes)).toBeGreaterThan(0);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("binds response mcp-session-id to initialize clientInfo for later calls", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      const body = JSON.parse(await readRequestBody(req)) as { id: string; method: string };
      if (body.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "upstream-session-137" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { serverInfo: { name: "ktx" }, capabilities: { tools: {} } }
        }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
    });

    try {
      const init = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-session-bind")
      });
      expect(init.status).toBe(200);
      expect(init.headers.get("mcp-session-id")).toBe("upstream-session-137");
      await init.text();

      const list = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "mcp-session-id": "upstream-session-137"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "list-after-init", method: "tools/list" })
      });
      expect(list.status).toBe(200);
      await list.text();

      const initAudit = await waitForAuditRow("init-session-bind");
      expect(initAudit.lucy_session_id).toBe("upstream-session-137");
      expect(initAudit.client).toBe("test-client");
      expect(initAudit.client_version).toBe("2.3.4");
      const listAudit = await waitForAuditRow("list-after-init");
      expect(listAudit.lucy_session_id).toBe("upstream-session-137");
      expect(listAudit.client).toBe("test-client");
      expect(listAudit.client_version).toBe("2.3.4");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("records error_detail=instructions_injection_failed:<reason> on JSON parse failure, but outcome stays ok", async () => {
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("not-json-at-all");
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-audit-fail")
      });
      expect(res.status).toBe(200);

      const audit = await waitForAuditRow("init-audit-fail");
      expect(audit.tool).toBe("initialize");
      // Fail-open: the request succeeded for the client, so outcome is ok;
      // the rewriter's internal failure is captured in error_detail.
      expect(audit.outcome).toBe("ok");
      expect(audit.decision_reason).toBe("instructions_injection_failed");
      expect(String(audit.error_detail)).toMatch(/^instructions_injection_failed:/);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("passes through unchanged when LUCY_ENABLE_INSTRUCTIONS_INJECTION=false (kill switch)", async () => {
    process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION = "false";

    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "init-killswitch",
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "ktx", version: "0.12.0" },
          capabilities: { tools: {} }
          // no instructions field
        }
      }));
    });

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest("init-killswitch")
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions?: string; serverInfo: { name: string } } };
      // Proxy should NOT have injected — upstream's result shape is preserved.
      expect(body.result.instructions).toBeUndefined();
      expect(body.result.serverInfo.name).toBe("ktx");

      // Audit row should still exist (pass-through branch records audit), with
      // decision_reason=allowed and no error_detail.
      const audit = await waitForAuditRow("init-killswitch");
      expect(audit.tool).toBe("initialize");
      expect(audit.outcome).toBe("ok");
      expect(audit.decision_reason).toBe("allowed");
      expect(audit.error_detail).toBeNull();
    } finally {
      await closeAll(upstream, server);
    }
  });
});
