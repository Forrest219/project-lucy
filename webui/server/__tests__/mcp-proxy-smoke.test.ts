import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "proxy-smoke-token";
const RESTRICTED_TOKEN = "proxy-smoke-restricted-token";
const INTERNAL_TOKEN = "internal-smoke-token";

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
  - id: smoke_agent
    name: Smoke Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: smoke-token
        created: 2026-06-20
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - kx_catalog
        - lucy_begin_question
        - sl_read_source
  - id: restricted_agent
    name: Restricted Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(RESTRICTED_TOKEN)}"
        label: restricted-token
        created: 2026-06-20
    allow:
      tables:
        - dataforai.superstore_orders
      tools:
        - sl_read_source
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  kx_fact_financial_amount:
    table: dataforai.kx_fact_financial_amount
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-proxy-smoke-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
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

// Non-throwing on timeout: callers also use this to confirm the *absence* of rows
// (e.g. kx_catalog must never produce access_log_sources rows).
async function waitForAuditSources(accessLogId: number, timeoutMs = 300): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT * FROM access_log_sources WHERE access_log_id = ?").all(accessLogId) as Array<Record<string, unknown>>;
      if (rows.length > 0) return rows;
    } finally {
      db.close();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return [];
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
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
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
  await rm(projectRoot, { recursive: true, force: true });
});

describe("MCP proxy smoke", () => {
  it("forwards an allowed tool call to KTX upstream and writes an audit row", async () => {
    const upstreamSeen: Array<{ authorization?: string; accept?: string; body: string }> = [];
    const upstream = createServer(async (req, res) => {
      upstreamSeen.push({
        authorization: req.headers.authorization,
        accept: req.headers.accept,
        body: await readRequestBody(req)
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "proxy-smoke-allowed",
        result: { content: [{ type: "text", text: "ok" }] }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "proxy-smoke-allowed",
          method: "tools/call",
          params: {
            name: "sl_read_source",
            arguments: { sourceName: "superstore_orders" }
          }
        })
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: "proxy-smoke-allowed",
        result: { content: [{ text: "ok" }] }
      });
      expect(upstreamSeen).toHaveLength(1);
      expect(upstreamSeen[0]?.authorization).toBe(`Bearer ${INTERNAL_TOKEN}`);
      expect(upstreamSeen[0]?.accept).toBe("application/json, text/event-stream");
      expect(JSON.parse(upstreamSeen[0]?.body ?? "{}")).toMatchObject({
        method: "tools/call",
        params: { name: "sl_read_source" }
      });

      const audit = await waitForAuditRow("proxy-smoke-allowed");
      expect(audit.user_id).toBe("smoke_agent");
      expect(audit.token_label).toBe("smoke-token");
      expect(audit.token_hash_prefix).toBe(tokenHash(TOKEN).slice(0, 19));
      expect(audit.tool).toBe("sl_read_source");
      expect(audit.outcome).toBe("ok");
      expect(audit.decision_reason).toBe("allowed");
      expect(audit.permission_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(String(audit.tables))).toEqual(["dataforai.superstore_orders"]);
      const auditDb = new Database(auditDbPath, { readonly: true });
      try {
        const snapshot = auditDb.prepare("SELECT * FROM permission_snapshots WHERE hash = ?").get(audit.permission_snapshot_hash) as Record<string, unknown> | undefined;
        expect(snapshot).toBeTruthy();
      } finally {
        auditDb.close();
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("writes structured access_log_sources for a successful sl_read_source call", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "proxy-smoke-sources",
        result: { content: [{ type: "text", text: "ok" }] }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "proxy-smoke-sources",
          method: "tools/call",
          params: {
            name: "sl_read_source",
            arguments: { sourceName: "superstore_orders" }
          }
        })
      });
      expect(res.status).toBe(200);

      const audit = await waitForAuditRow("proxy-smoke-sources");
      const sources = await waitForAuditSources(Number(audit.id));
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        access_log_id: audit.id,
        user_id: "smoke_agent",
        tool: "sl_read_source",
        connection_id: "mysql-aliyun",
        schema_name: "dataforai",
        source_name: "superstore_orders",
        physical_table: "dataforai.superstore_orders",
        extraction_method: "args_source_name",
        confidence: "high"
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("injects kx_catalog into tools/list and serves it from the proxy", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      upstreamSeen.push(await readRequestBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-list",
        result: {
          tools: [
            { name: "sl_read_source", inputSchema: { type: "object" } },
            { name: "sql_execution", inputSchema: { type: "object" } },
            { name: "future_table_export", inputSchema: { type: "object" } }
          ]
        }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list", method: "tools/list" })
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { result: { tools: Array<{ name: string }> } };
      expect(listBody.result.tools.map((tool) => tool.name)).toContain("kx_catalog");
      expect(listBody.result.tools.map((tool) => tool.name)).toEqual(["sl_read_source", "kx_catalog", "lucy_begin_question"]);

      const catalogRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "catalog",
          method: "tools/call",
          params: { name: "kx_catalog", arguments: {} }
        })
      });
      expect(catalogRes.status).toBe(200);
      const catalogBody = await catalogRes.json() as { result: { content: Array<{ text: string }> } };
      const catalogText = catalogBody.result.content[0]?.text ?? "";
      expect(catalogText).toContain("superstore_orders");
      expect(catalogText).not.toContain("kx_fact_financial_amount");
      expect(upstreamSeen).toHaveLength(1);

      const catalogAudit = await waitForAuditRow("catalog");
      const catalogSources = await waitForAuditSources(Number(catalogAudit.id));
      expect(catalogSources).toHaveLength(0);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("injects lucy_begin_question, handles it locally, and auto-attaches its turnId to the next business call", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      upstreamSeen.push(body);
      const parsed = JSON.parse(body) as { id: string; method: string };
      res.writeHead(200, { "content-type": "application/json" });
      if (parsed.method === "tools/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { tools: [{ name: "sl_read_source", inputSchema: { type: "object" } }] }
        }));
        return;
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: { content: [{ type: "text", text: "ok" }] }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list-begin", method: "tools/list" })
      });
      const listBody = await listRes.json() as { result: { tools: Array<{ name: string }> } };
      expect(listBody.result.tools.map((tool) => tool.name)).toContain("lucy_begin_question");

      const beginRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "begin-q-1",
          method: "tools/call",
          params: {
            name: "lucy_begin_question",
            arguments: {
              intentSummary: "查询客户邮箱相关的订单",
              question: "contact me at alice@example.com about superstore orders"
            }
          }
        })
      });
      expect(beginRes.status).toBe(200);
      const beginBody = await beginRes.json() as { result: { content: Array<{ text: string }> } };
      const { turnId } = JSON.parse(beginBody.result.content[0]?.text ?? "{}") as { turnId: string };
      expect(typeof turnId).toBe("string");
      expect(upstreamSeen).toHaveLength(1); // only the prior tools/list reached upstream; lucy_begin_question is local-only

      const beginAudit = await waitForAuditRow("begin-q-1");
      expect(beginAudit.tool).toBe("lucy_begin_question");
      expect(beginAudit.lucy_turn_id).toBe(turnId);

      const ctDb = new Database(auditDbPath, { readonly: true });
      try {
        const turnRow = ctDb.prepare("SELECT question_summary, question_preview, question_source FROM conversation_turns WHERE turn_id = ?").get(turnId) as Record<string, unknown>;
        expect(turnRow.question_summary).toBe("查询客户邮箱相关的订单");
        expect(turnRow.question_preview).not.toContain("alice@example.com");
        expect(turnRow.question_preview).toContain("[REDACTED]");
        expect(turnRow.question_source).toBe("reported_tool");
      } finally {
        ctDb.close();
      }

      const followUpRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "after-begin-1",
          method: "tools/call",
          params: { name: "sl_read_source", arguments: { sourceName: "superstore_orders" } }
        })
      });
      expect(followUpRes.status).toBe(200);
      expect(upstreamSeen).toHaveLength(2); // tools/list + the follow-up call

      const followUpAudit = await waitForAuditRow("after-begin-1");
      expect(followUpAudit.lucy_turn_id).toBe(turnId);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("does not inject lucy_begin_question or kx_catalog for an agent whose role doesn't list them", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-list-restricted",
        result: { tools: [{ name: "sl_read_source", inputSchema: { type: "object" } }] }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${RESTRICTED_TOKEN}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list-restricted", method: "tools/list" })
      });
      const listBody = await listRes.json() as { result: { tools: Array<{ name: string }> } };
      const names = listBody.result.tools.map((tool) => tool.name);
      expect(names).toEqual(["sl_read_source"]);
      expect(names).not.toContain("lucy_begin_question");
      expect(names).not.toContain("kx_catalog");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("records query intent, response size, and correlation headers", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "query-audit",
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              headers: ["customer_name", "total_sales"],
              rows: [["Alice", "120.00"], ["Bob", "80.00"]],
              totalRows: 2,
              truncated: true
            })
          }]
        }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const rawQuery = "select customer_name, sum(sales) from dataforai.superstore_orders where password='secret' and sales > 100 group by customer_name";
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`,
          "x-lucy-session-id": "tg-session-1",
          "x-lucy-turn-id": "turn-42",
          "x-lucy-platform": "telegram"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "query-audit",
          method: "tools/call",
          params: {
            name: "sl_read_source",
            arguments: {
              sourceName: "superstore_orders",
              query: rawQuery
            }
          }
        })
      });

      expect(res.status).toBe(200);
      await res.text();
      const audit = await waitForAuditRow("query-audit");
      expect(audit.lucy_session_id).toBe("tg-session-1");
      expect(audit.lucy_turn_id).toBe("turn-42");
      expect(audit.lucy_platform).toBe("telegram");
      expect(audit.query_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(audit.query_length).toBe(rawQuery.length);
      expect(audit.query_operation).toBe("select");
      expect(String(audit.query_preview)).toContain("dataforai.superstore_orders");
      expect(String(audit.query_preview)).not.toContain("secret");
      expect(String(audit.query_preview)).not.toContain("100");
      expect(audit.response_bytes).toBeGreaterThan(0);
      expect(audit.response_row_count).toBe(2);
      expect(audit.response_column_count).toBe(2);
      expect(audit.response_truncated).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("fails closed when tools/list cannot be parsed or filtered", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-list-fail-closed",
        result: {
          tools: [
            { name: "sl_read_source", inputSchema: { type: "object" } },
            { name: "sql_execution", inputSchema: { type: "object" } },
            { name: "future_table_export", inputSchema: { type: "object" } }
          ]
        }
      }));
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list-fail-closed", method: "tools/list" })
      });
      expect(listRes.status).toBe(200);
      expect(listRes.headers.get("content-type")).toContain("application/json");
      const listBody = await listRes.json() as { error?: { message?: string; data?: { reason?: string } } };
      expect(listBody.error?.message).toBe("tools/list filtering failed");
      expect(listBody.error?.data?.reason).toContain("tools_list_filter_failed");

      const audit = await waitForAuditRow("tools-list-fail-closed");
      expect(audit.outcome).toBe("ok");
      expect(audit.decision_reason).toBe("tools_list_filter_failed");
      expect(String(audit.error_detail)).toContain("tools_list_filter_failed");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });
});
