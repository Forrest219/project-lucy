import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "proxy-smoke-token";
const KX_TOKEN = "proxy-smoke-kx-token";
const POC_TOKEN = "proxy-smoke-poc-token";
const RESTRICTED_TOKEN = "proxy-smoke-restricted-token";
const EXACT_TOKEN = "proxy-smoke-exact-r1-token";
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
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - kx_catalog
        - connection_list
        - lucy_begin_question
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - sl_read_source
        - sl_query
        - wiki_search
        - wiki_read
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
  - id: kx_agent
    name: KX Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(KX_TOKEN)}"
        label: kx-token
        created: 2026-07-06
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.kx_fact_financial_amount
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - wiki_search
        - wiki_read
  - id: poc_agent
    name: POC Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(POC_TOKEN)}"
        label: poc-token
        created: 2026-07-06
    allow:
      connections:
        - poc-mysql-aliyun
      tables:
        - data_agent_poc.poc_ceo_metric_snapshot
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - wiki_search
        - wiki_read
  - id: exact_r1_agent
    name: Exact R1 Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(EXACT_TOKEN)}"
        label: exact-r1-token
        created: 2026-07-02
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  kx_fact_financial_amount:
    table: dataforai.kx_fact_financial_amount
  superstore_orders:
    table: dataforai.superstore_orders
`;

const POC_SCHEMA_YAML = `tables:
  poc_ceo_metric_snapshot:
    table: data_agent_poc.poc_ceo_metric_snapshot
`;

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;
let previousUpstreamTimeout: string | undefined;
let previousQueryMaxInflight: string | undefined;

async function makeProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-proxy-smoke-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(root, "wiki", "global"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(root, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "semantic-layer", "poc-mysql-aliyun", "_schema", "data_agent_poc.yaml"), POC_SCHEMA_YAML, "utf8");
  await writeFile(path.join(root, "wiki", "global", "superstore.md"), [
    "---",
    "visibility: private",
    "sl_refs:",
    "  - mysql-aliyun/dataforai/superstore_orders",
    "---",
    "# Superstore Wiki",
    "",
    "Authorized superstore context."
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "wiki", "global", "kx-secret.md"), [
    "---",
    "visibility: private",
    "sl_refs:",
    "  - mysql-aliyun/dataforai/kx_fact_financial_amount",
    "---",
    "# KX Secret Wiki",
    "",
    "Unauthorized KX context."
  ].join("\n"), "utf8");
  await writeFile(path.join(root, "wiki", "global", "poc.md"), [
    "---",
    "visibility: private",
    "sl_refs:",
    "  - poc-mysql-aliyun/data_agent_poc/poc_ceo_metric_snapshot",
    "---",
    "# POC Wiki",
    "",
    "Authorized POC context."
  ].join("\n"), "utf8");
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
  previousUpstreamTimeout = process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS;
  previousQueryMaxInflight = process.env.LUCY_QUERY_MAX_INFLIGHT;
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
  if (previousUpstreamTimeout === undefined) delete process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS;
  else process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS = previousUpstreamTimeout;
  if (previousQueryMaxInflight === undefined) delete process.env.LUCY_QUERY_MAX_INFLIGHT;
  else process.env.LUCY_QUERY_MAX_INFLIGHT = previousQueryMaxInflight;
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
            arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
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
            arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
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
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({
        result: {
          tools: [
            { name: "sl_read_source", inputSchema: { type: "object" } },
            { name: "connection_list", inputSchema: { type: "object" }, outputSchema: { type: "object", required: ["items"] } },
            { name: "sql_execution", inputSchema: { type: "object" } },
            { name: "future_table_export", inputSchema: { type: "object" } }
          ]
        }
      })}\n\n`);
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
      expect(listRes.headers.get("content-type") ?? "").toContain("application/json");
      const listBody = await listRes.json() as { jsonrpc: string; id: string; result: { tools: Array<{ name: string; inputSchema?: Record<string, unknown> }> } };
      expect(listBody.jsonrpc).toBe("2.0");
      expect(listBody.id).toBe("tools-list");
      expect(listBody.result.tools.map((tool) => tool.name)).toContain("lucy_catalog");
      expect(listBody.result.tools.map((tool) => tool.name)).toContain("kx_catalog");
      expect(listBody.result.tools.find((tool) => tool.name === "connection_list")).not.toHaveProperty("outputSchema");
      expect(listBody.result.tools.map((tool) => tool.name)).toEqual([
        "sl_read_source",
        "connection_list",
        "lucy_catalog",
        "lucy_read_source",
        "lucy_query",
        "lucy_explain_query",
        "lucy_freshness",
        "kx_catalog",
        "wiki_search",
        "wiki_read",
        "lucy_begin_question"
      ]);
      const lucyQuerySchema = listBody.result.tools.find((tool) => tool.name === "lucy_query")?.inputSchema as { properties?: Record<string, { items?: { type?: string } }> } | undefined;
      expect(lucyQuerySchema?.properties?.dimensions?.items?.type).toBe("object");
      expect(lucyQuerySchema?.properties?.order_by?.items?.type).toBe("object");

      const lucyCatalogRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-catalog",
          method: "tools/call",
          params: { name: "lucy_catalog", arguments: {} }
        })
      });
      expect(lucyCatalogRes.status).toBe(200);
      const lucyCatalogBody = await lucyCatalogRes.json() as { result: { content: Array<{ text: string }> } };
      const lucyCatalogText = lucyCatalogBody.result.content[0]?.text ?? "";
      expect(lucyCatalogText).toContain("superstore_orders");
      expect(lucyCatalogText).not.toContain("kx_fact_financial_amount");

      const connectionListRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "connection-list",
          method: "tools/call",
          params: { name: "connection_list", arguments: {} }
        })
      });
      expect(connectionListRes.status).toBe(200);
      const connectionListBody = await connectionListRes.json() as { result: { content: Array<{ text: string }> } };
      expect(connectionListBody.result.content[0]?.text ?? "").toContain("mysql-aliyun");

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

  it("exposes exactly the six Lucy R1 tools for an exact R1 release token", async () => {
    const upstream = createServer(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(`event: message\ndata: ${JSON.stringify({
        result: {
          tools: [
            { name: "sl_query", inputSchema: { type: "object" } },
            { name: "sl_read_source", inputSchema: { type: "object" } },
            { name: "wiki_search", inputSchema: { type: "object" } },
            { name: "wiki_read", inputSchema: { type: "object" } },
            { name: "kx_catalog", inputSchema: { type: "object" } },
            { name: "sql_execution", inputSchema: { type: "object" } },
            { name: "future_table_export", inputSchema: { type: "object" } }
          ]
        }
      })}\n\n`);
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
          authorization: `Bearer ${EXACT_TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list-exact-r1", method: "tools/list" })
      });
      expect(listRes.status).toBe(200);
      expect(listRes.headers.get("content-type") ?? "").toContain("application/json");
      const listBody = await listRes.json() as { result: { tools: Array<{ name: string }> } };
      const names = listBody.result.tools.map((tool) => tool.name);
      expect(names).toEqual([
        "lucy_catalog",
        "lucy_read_source",
        "lucy_query",
        "lucy_explain_query",
        "lucy_freshness",
        "lucy_begin_question"
      ]);
      expect(names).not.toEqual(expect.arrayContaining([
        "sl_query",
        "sl_read_source",
        "wiki_search",
        "wiki_read",
        "kx_catalog",
        "sql_execution",
        "future_table_export"
      ]));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("rewrites lucy_read_source and lucy_query to upstream semantic tools while auditing Lucy tools", async () => {
    const upstreamSeen: Array<{ body: Record<string, unknown> }> = [];
    const upstream = createServer(async (req, res) => {
      const body = JSON.parse(await readRequestBody(req)) as Record<string, unknown>;
      upstreamSeen.push({ body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ ok: true }], truncated: false }) }] }
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
      const readRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-read-source",
          method: "tools/call",
          params: {
            name: "lucy_read_source",
            arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
          }
        })
      });
      expect(readRes.status).toBe(200);
      const readBody = await readRes.json() as { result: { _meta?: { lucy?: Record<string, unknown> } } };
      expect(readBody.result._meta?.lucy).toMatchObject({
        contract: "lucy-r1-controlled-data-service",
        tool: "lucy_read_source",
        upstreamTool: "sl_read_source"
      });

      const queryRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-query",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["superstore_orders.sales"],
              dimensions: [{ field: "superstore_orders.region" }],
              filters: [
                { field: "superstore_orders.sales", op: "gt", value: 100 },
                { field: "superstore_orders.region", op: "matches", value: "East" }
              ],
              segments: ["superstore_orders.active_rows"],
              orderBy: [{ field: "superstore_orders.sales", direction: "desc" }],
              limit: 5000
            }
          }
        })
      });
      expect(queryRes.status).toBe(200);
      const queryBody = await queryRes.json() as { result: { _meta?: { lucy?: { guardrails?: { effectiveLimit?: number }, result?: { rowCount?: number | null, columnCount?: number | null, truncated?: boolean | null }, provenance?: { connectionId?: string | null; sourceName?: string | null; filters?: unknown; segments?: unknown; orderBy?: unknown; freshness?: { status?: string; tool?: string } }, sources?: Array<{ sourceName?: string }> } } } };
      expect(queryBody.result._meta?.lucy?.guardrails?.effectiveLimit).toBe(1000);
      expect(queryBody.result._meta?.lucy?.sources?.[0]?.sourceName).toBe("superstore_orders");
      expect(queryBody.result._meta?.lucy?.result).toMatchObject({
        rowCount: 1,
        columnCount: null,
        truncated: false
      });
      expect(queryBody.result._meta?.lucy?.provenance).toMatchObject({
        connectionId: "mysql-aliyun",
        sourceName: "superstore_orders",
        filters: [
          { field: "superstore_orders.sales", op: "gt", value: 100 },
          { field: "superstore_orders.region", op: "matches", value: "East" }
        ],
        segments: ["superstore_orders.active_rows"],
        orderBy: [{ field: "superstore_orders.sales", direction: "desc" }],
        freshness: { status: "not_checked", tool: "lucy_freshness" }
      });

      expect(upstreamSeen.map((item) => ((item.body.params as Record<string, unknown>).name))).toEqual([
        "sl_read_source",
        "sl_query"
      ]);
      const forwardedQueryArgs = (upstreamSeen[1]?.body.params as Record<string, unknown>).arguments as Record<string, unknown>;
      expect(forwardedQueryArgs.limit).toBe(1000);
      expect(forwardedQueryArgs.filters).toEqual([
        "superstore_orders.sales > 100",
        "superstore_orders.region LIKE '%East%'"
      ]);

      const readAudit = await waitForAuditRow("lucy-read-source");
      expect(readAudit.tool).toBe("lucy_read_source");
      expect(JSON.parse(String(readAudit.tables))).toEqual(["dataforai.superstore_orders"]);
      const queryAudit = await waitForAuditRow("lucy-query");
      expect(queryAudit.tool).toBe("lucy_query");
      expect(JSON.parse(String(queryAudit.tables))).toEqual(["dataforai.superstore_orders"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("normalizes upstream SSE lucy_query/lucy_read_source responses to application/json", async () => {
    const upstream = createServer(async (req, res) => {
      const body = JSON.parse(await readRequestBody(req)) as { id: string };
      const payload = {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ headers: ["dau"], rows: [["2902"]], totalRows: 1 }) }],
          structuredContent: { headers: ["dau"], rows: [["2902"]], totalRows: 1 }
        }
      };
      const sseBody = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
      // KTX commonly returns a finite SSE frame with Content-Length; proxy must
      // not re-emit that shape to Streamable HTTP clients after buffering.
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-length": Buffer.byteLength(sseBody)
      });
      res.end(sseBody);
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
      for (const [id, name, args] of [
        ["sse-lucy-query", "lucy_query", {
          connectionId: "mysql-aliyun",
          measures: ["superstore_orders.sales"],
          limit: 5
        }],
        ["sse-lucy-read", "lucy_read_source", {
          connectionId: "mysql-aliyun",
          sourceName: "superstore_orders"
        }]
      ] as const) {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id,
            method: "tools/call",
            params: { name, arguments: args }
          })
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type") ?? "").toContain("application/json");
        expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
        expect(res.headers.get("cache-control") ?? "").toContain("no-store");
        const text = await res.text();
        expect(text.startsWith("event:")).toBe(false);
        const parsed = JSON.parse(text) as {
          id: string;
          result: {
            content: Array<{ text: string }>;
            structuredContent?: { rows?: unknown[] };
            _meta?: { lucy?: { tool?: string } };
          };
        };
        expect(parsed.id).toBe(id);
        expect(parsed.result.content[0]?.text ?? "").toContain("2902");
        expect(parsed.result.structuredContent?.rows?.[0]).toEqual(["2902"]);
        expect(parsed.result._meta?.lucy?.tool).toBe(name);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("picks the JSON-RPC response frame when upstream SSE includes progress notifications", async () => {
    const upstream = createServer(async (req, res) => {
      const parsed = JSON.parse(await readRequestBody(req)) as { id?: unknown };
      const progress = {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: parsed.id, progress: 0.5, message: "Executing" }
      };
      const result = {
        jsonrpc: "2.0",
        id: parsed.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ headers: ["region"], rows: [["East", 2]] }) }],
          structuredContent: { headers: ["region"], rows: [["East", 2]] }
        }
      };
      const sseBody =
        `event: message\ndata: ${JSON.stringify(progress)}\n\n` +
        `event: message\ndata: ${JSON.stringify(result)}\n\n`;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "content-length": Buffer.byteLength(sseBody)
      });
      res.end(sseBody);
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sse-progress-1",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["superstore_orders.sales"],
              limit: 5
            }
          }
        })
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("application/json");
      const text = await res.text();
      expect(text.startsWith("event:")).toBe(false);
      expect(text).not.toContain("notifications/progress");
      const parsed = JSON.parse(text) as {
        id: string;
        result: {
          content: Array<{ text: string }>;
          structuredContent?: { rows?: unknown[] };
          _meta?: { lucy?: { tool?: string } };
        };
      };
      expect(parsed.id).toBe("sse-progress-1");
      expect(parsed.result.content[0]?.text ?? "").toContain("East");
      expect(parsed.result.structuredContent?.rows?.[0]).toEqual(["East", 2]);
      expect(parsed.result._meta?.lucy?.tool).toBe("lucy_query");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("normalizes legacy tools/call finite SSE (progress + result) to application/json", async () => {
    const upstream = createServer(async (req, res) => {
      const parsed = JSON.parse(await readRequestBody(req)) as { id?: unknown };
      const progress = {
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: { progressToken: parsed.id, progress: 0.2, message: "Planning" }
      };
      const result = {
        jsonrpc: "2.0",
        id: parsed.id,
        result: {
          content: [{ type: "text", text: JSON.stringify({ rows: [["West", 9]] }) }]
        }
      };
      const sseBody =
        `event: message\ndata: ${JSON.stringify(progress)}\n\n` +
        `event: message\ndata: ${JSON.stringify(result)}\n\n`;
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "keep-alive",
        "content-length": Buffer.byteLength(sseBody)
      });
      res.end(sseBody);
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "sse-legacy-sl-query",
          method: "tools/call",
          params: {
            name: "sl_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: [{ $text: "superstore_orders.sales" }]
            }
          }
        })
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain("application/json");
      expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
      const text = await res.text();
      expect(text.startsWith("event:")).toBe(false);
      expect(text).not.toContain("notifications/progress");
      const parsed = JSON.parse(text) as {
        id: string;
        result: { content: Array<{ text: string }> };
      };
      expect(parsed.id).toBe("sse-legacy-sl-query");
      expect(parsed.result.content[0]?.text ?? "").toContain("West");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("normalizes agent transport measure wrappers before validating and forwarding Lucy queries", async () => {
    const upstreamSeen: Array<Record<string, unknown>> = [];
    const upstream = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      upstreamSeen.push(JSON.parse(body) as Record<string, unknown>);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: "normalized-query",
        result: {
          content: [{ type: "text", text: JSON.stringify({ rows: [{ sales: 100 }] }) }]
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
      const calls = [
        {
          id: "lucy-query-text-measure",
          tool: "lucy_query",
          measures: [{ $text: "superstore_orders.sales" }]
        },
        {
          id: "lucy-query-name-measure",
          tool: "lucy_query",
          measures: [{ name: "superstore_orders.sales" }]
        }
      ];

      for (const call of calls) {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            method: "tools/call",
            params: {
              name: call.tool,
              arguments: {
                connectionId: "mysql-aliyun",
                measures: call.measures,
                dimensions: [{ field: "superstore_orders.region" }],
                limit: 10
              }
            }
          })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { result?: unknown; error?: unknown };
        expect(body.error).toBeUndefined();
      }

      expect(upstreamSeen).toHaveLength(2);
      for (const seen of upstreamSeen) {
        const params = seen.params as Record<string, unknown>;
        const args = params.arguments as Record<string, unknown>;
        expect(args.measures).toEqual(["superstore_orders.sales"]);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("fails closed on malformed Lucy R1 tool arguments before forwarding or local execution", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      upstreamSeen.push(await readRequestBody(req));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "unexpected", result: { content: [] } }));
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
      const malformedCalls = [
        {
          id: "lucy-query-invalid-args",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", limit: 10 },
          reason: "invalid_arguments:lucy_query:query_shape_required"
        },
        {
          id: "lucy-query-invalid-dimensions-string",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], dimensions: [""], limit: 10 },
          reason: "invalid_arguments:lucy_query:dimensions_items_must_be_objects"
        },
        {
          id: "lucy-query-invalid-dimensions-field",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], dimensions: [{}], limit: 10 },
          reason: "invalid_arguments:lucy_query:dimensions_field_required"
        },
        {
          id: "lucy-query-invalid-order-by-string",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], order_by: [""], limit: 10 },
          reason: "invalid_arguments:lucy_query:order_by_items_must_be_objects"
        },
        {
          id: "lucy-query-invalid-orderBy-string",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], orderBy: [""], limit: 10 },
          reason: "invalid_arguments:lucy_query:order_by_items_must_be_objects"
        },
        {
          id: "lucy-query-invalid-filter-op",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], filters: [{ field: "superstore_orders.region", op: "similar_to", value: "East" }], limit: 10 },
          reason: "invalid_arguments:lucy_query:filters_op_unsupported"
        },
        {
          id: "lucy-query-invalid-filter-field",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], filters: [{ field: "superstore_orders.region;DROP", op: "=", value: "East" }], limit: 10 },
          reason: "invalid_arguments:lucy_query:filters_field_unsafe"
        },
        {
          id: "lucy-query-invalid-filter-empty-in",
          tool: "lucy_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], filters: [{ field: "superstore_orders.region", op: "in", values: [] }], limit: 10 },
          reason: "invalid_arguments:lucy_query:filters_values_required"
        },
        {
          id: "lucy-explain-invalid-args",
          tool: "lucy_explain_query",
          args: { connectionId: "mysql-aliyun", limit: 10 },
          reason: "invalid_arguments:lucy_explain_query:query_shape_required"
        },
        {
          id: "lucy-explain-invalid-dimensions-string",
          tool: "lucy_explain_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], dimensions: [""], limit: 10 },
          reason: "invalid_arguments:lucy_explain_query:dimensions_items_must_be_objects"
        },
        {
          id: "lucy-explain-invalid-order-by-string",
          tool: "lucy_explain_query",
          args: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"], order_by: [""], limit: 10 },
          reason: "invalid_arguments:lucy_explain_query:order_by_items_must_be_objects"
        },
        {
          id: "lucy-read-source-invalid-args",
          tool: "lucy_read_source",
          args: { connectionId: "mysql-aliyun" },
          reason: "invalid_arguments:lucy_read_source:source_required"
        },
        {
          id: "lucy-freshness-invalid-args",
          tool: "lucy_freshness",
          args: { connectionId: "mysql-aliyun" },
          reason: "invalid_arguments:lucy_freshness:source_required"
        }
      ];

      for (const call of malformedCalls) {
        const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${TOKEN}`
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: call.id,
            method: "tools/call",
            params: {
              name: call.tool,
              arguments: call.args
            }
          })
        });
        expect(res.status).toBe(200);
        const body = await res.json() as { result: { isError?: boolean; content?: Array<{ text?: string }> } };
        expect(body.result.isError).toBe(true);
        expect(body.result.content?.[0]?.text ?? "").toContain(call.reason);
      }

      expect(upstreamSeen).toHaveLength(0);

      for (const call of malformedCalls) {
        const audit = await waitForAuditRow(call.id);
        expect(audit.tool).toBe(call.tool);
        expect(audit.outcome).toBe("error");
        expect(audit.decision_reason).toBe(call.reason);
      }
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("rejects concurrent lucy_query calls beyond the per-token guardrail", async () => {
    process.env.LUCY_QUERY_MAX_INFLIGHT = "1";
    const upstreamSeen: Array<{ body: Record<string, unknown> }> = [];
    let releaseFirst: (() => void) | undefined;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const upstream = createServer(async (req, res) => {
      const body = JSON.parse(await readRequestBody(req)) as Record<string, unknown>;
      upstreamSeen.push({ body });
      await firstCanFinish;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ ok: true }], truncated: false }) }] }
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

    const queryBody = (id: string) => JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "lucy_query",
        arguments: {
          connectionId: "mysql-aliyun",
          measures: ["superstore_orders.sales"],
          dimensions: [{ field: "superstore_orders.region" }],
          limit: 10
        }
      }
    });
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`
    };

    try {
      const first = fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers,
        body: queryBody("lucy-query-concurrent-first")
      });
      const deadline = Date.now() + 1000;
      while (upstreamSeen.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(upstreamSeen).toHaveLength(1);

      const deniedRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers,
        body: queryBody("lucy-query-concurrent-denied")
      });
      expect(deniedRes.status).toBe(200);
      const deniedBody = await deniedRes.json() as { result: { isError?: boolean; content?: Array<{ text: string }> } };
      expect(deniedBody.result.isError).toBe(true);
      expect(deniedBody.result.content?.[0]?.text).toContain("query_concurrency_exceeded");
      expect(upstreamSeen).toHaveLength(1);

      const deniedAudit = await waitForAuditRow("lucy-query-concurrent-denied");
      expect(deniedAudit.tool).toBe("lucy_query");
      expect(deniedAudit.outcome).toBe("denied");
      expect(deniedAudit.decision_reason).toBe("query_concurrency_exceeded");
      expect(String(deniedAudit.error_detail)).toContain("query_concurrency_exceeded");

      releaseFirst?.();
      const firstRes = await first;
      expect(firstRes.status).toBe(200);
      const firstBody = await firstRes.json() as { result: { _meta?: { lucy?: { guardrails?: { maxConcurrentQueries?: number } } } } };
      expect(firstBody.result._meta?.lucy?.guardrails?.maxConcurrentQueries).toBe(1);
    } finally {
      releaseFirst?.();
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("serves lucy_explain_query and lucy_freshness locally", async () => {
    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const explainRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-explain",
          method: "tools/call",
          params: {
            name: "lucy_explain_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["superstore_orders.sales"],
              limit: 5000
            }
          }
        })
      });
      const explainBody = await explainRes.json() as { result: { content: Array<{ text: string }> } };
      const explain = JSON.parse(explainBody.result.content[0]?.text ?? "{}");
      expect(explain.allowed).toBe(true);
      expect(explain.upstreamTool).toBe("sl_query");
      expect(explain.guardrails.effectiveLimit).toBe(1000);
      expect(explain.requestedSources[0].sourceName).toBe("superstore_orders");

      const freshnessRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "lucy-freshness",
          method: "tools/call",
          params: {
            name: "lucy_freshness",
            arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }
          }
        })
      });
      const freshnessBody = await freshnessRes.json() as { result: { content: Array<{ text: string }> } };
      const freshness = JSON.parse(freshnessBody.result.content[0]?.text ?? "{}");
      expect(freshness.sourceName).toBe("superstore_orders");
      expect(freshness.freshness.mode).toBe("metadata_only");

      const explainAudit = await waitForAuditRow("lucy-explain");
      expect(explainAudit.tool).toBe("lucy_explain_query");
      const freshnessAudit = await waitForAuditRow("lucy-freshness");
      expect(freshnessAudit.tool).toBe("lucy_freshness");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("falls back to local initialize and local tools/list when upstream is unavailable", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => closed.close((err) => err ? reject(err) : resolve()));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const initRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-fallback",
          method: "initialize",
          params: { clientInfo: { name: "smoke" } }
        })
      });
      expect(initRes.status).toBe(200);
      const initBody = await initRes.json() as { result: { serverInfo: { version: string }; instructions: string } };
      expect(initBody.result.serverInfo.version).toBe("local-fallback");
      expect(initBody.result.instructions).toContain("Visible Scope");

      const listRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools-list-fallback", method: "tools/list" })
      });
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json() as { result: { tools: Array<{ name: string }> } };
      expect(listBody.result.tools.map((tool) => tool.name)).toEqual([
        "connection_list",
        "lucy_catalog",
        "lucy_read_source",
        "lucy_query",
        "lucy_explain_query",
        "lucy_freshness",
        "kx_catalog",
        "wiki_search",
        "wiki_read",
        "lucy_begin_question"
      ]);

      const audit = await waitForAuditRow("tools-list-fallback");
      expect(audit.decision_reason).toBe("local_tools_list_fallback");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("serves wiki_search locally with canonical readable keys when upstream is unavailable", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) => closed.close((err) => err ? reject(err) : resolve()));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const searchRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-search-local",
          method: "tools/call",
          params: { name: "wiki_search", arguments: { query: "superstore", limit: 5 } }
        })
      });
      expect(searchRes.status).toBe(200);
      const searchBody = await searchRes.json() as { result: { content: Array<{ text: string }> } };
      const searchPayload = JSON.parse(searchBody.result.content[0]?.text ?? "{}") as { results: Array<{ key: string }> };
      expect(searchPayload.results.map((item) => item.key)).toEqual(["global/superstore.md"]);

      const readRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${TOKEN}`
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-local-key",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global/superstore.md" } }
        })
      });
      expect(readRes.status).toBe(200);
      const readBody = await readRes.json() as { result: { content: Array<{ text: string }> } };
      expect(readBody.result.content[0]?.text ?? "").toContain("Authorized superstore context");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
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
          params: { name: "sl_read_source", arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" } }
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

  it("serves authorized wiki_read locally and filters unauthorized wiki_search results", async () => {
    const upstreamSeen: string[] = [];
    const upstream = createServer(async (req, res) => {
      const body = await readRequestBody(req);
      upstreamSeen.push(body);
      const parsed = JSON.parse(body) as { id: string; method: string };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: parsed.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({
              hits: [
                { key: "superstore", path: "wiki/global/superstore.md", title: "Superstore Wiki", snippet: "Authorized superstore context" },
                { key: "kx-secret", path: "wiki/global/kx-secret.md", title: "KX Secret Wiki", snippet: "Unauthorized KX context" },
                { key: "poc", path: "wiki/global/poc.md", title: "POC Wiki", snippet: "Unauthorized POC context" }
              ]
            })
          }],
          structuredContent: {
            hits: [
              { key: "superstore", path: "wiki/global/superstore.md", title: "Superstore Wiki", snippet: "Authorized superstore context" },
              { key: "kx-secret", path: "wiki/global/kx-secret.md", title: "KX Secret Wiki", snippet: "Unauthorized KX context" },
              { key: "poc", path: "wiki/global/poc.md", title: "POC Wiki", snippet: "Unauthorized POC context" }
            ]
          }
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
      const readAllowed = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-allowed",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global/superstore" } }
        })
      });
      expect(readAllowed.status).toBe(200);
      const readAllowedBody = await readAllowed.json() as { result: { content: Array<{ text: string }> } };
      expect(readAllowedBody.result.content[0]?.text ?? "").toContain("Authorized superstore context");

      const readDenied = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-denied",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global-kx-secret" } }
        })
      });
      expect(readDenied.status).toBe(200);
      const readDeniedBody = await readDenied.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(readDeniedBody.result.isError).toBe(true);
      expect(readDeniedBody.result.content[0]?.text ?? "").toBe("Access denied: wiki_forbidden");
      expect(readDeniedBody.result.content[0]?.text ?? "").not.toContain("KX Secret Wiki");

      const search = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-search-filtered",
          method: "tools/call",
          params: { name: "wiki_search", arguments: { query: "revenue" } }
        })
      });
      expect(search.status).toBe(200);
      const searchBody = await search.json() as { result: { content: Array<{ text: string }> } };
      const searchText = searchBody.result.content[0]?.text ?? "";
      expect(searchText).toContain("global/superstore.md");
      expect(searchText).not.toContain("KX Secret Wiki");
      expect(searchText).not.toContain("Unauthorized KX context");
      expect(searchText).not.toContain("POC Wiki");

      const kxSearch = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KX_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-search-kx-filtered",
          method: "tools/call",
          params: { name: "wiki_search", arguments: { query: "context" } }
        })
      });
      expect(kxSearch.status).toBe(200);
      const kxSearchBody = await kxSearch.json() as { result: { content: Array<{ text: string }> } };
      const kxSearchText = kxSearchBody.result.content[0]?.text ?? "";
      expect(kxSearchText).toContain("KX Secret Wiki");
      expect(kxSearchText).not.toContain("Superstore Wiki");
      expect(kxSearchText).not.toContain("POC Wiki");

      const kxReadAllowed = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KX_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-kx-allowed",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global/kx-secret" } }
        })
      });
      expect(kxReadAllowed.status).toBe(200);
      const kxReadAllowedBody = await kxReadAllowed.json() as { result: { content: Array<{ text: string }> } };
      expect(kxReadAllowedBody.result.content[0]?.text ?? "").toContain("Unauthorized KX context");

      const kxReadDenied = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KX_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-kx-deny-poc",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global/poc" } }
        })
      });
      expect(kxReadDenied.status).toBe(200);
      const kxReadDeniedBody = await kxReadDenied.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(kxReadDeniedBody.result.isError).toBe(true);
      expect(kxReadDeniedBody.result.content[0]?.text ?? "").not.toContain("POC Wiki");

      const pocSearch = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${POC_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-search-poc-filtered",
          method: "tools/call",
          params: { name: "wiki_search", arguments: { query: "context" } }
        })
      });
      expect(pocSearch.status).toBe(200);
      const pocSearchBody = await pocSearch.json() as { result: { content: Array<{ text: string }> } };
      const pocSearchText = pocSearchBody.result.content[0]?.text ?? "";
      expect(pocSearchText).toContain("POC Wiki");
      expect(pocSearchText).not.toContain("KX Secret Wiki");
      expect(pocSearchText).not.toContain("Superstore Wiki");

      const pocReadDenied = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${POC_TOKEN}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "wiki-read-poc-deny-kx",
          method: "tools/call",
          params: { name: "wiki_read", arguments: { key: "global/kx-secret" } }
        })
      });
      expect(pocReadDenied.status).toBe(200);
      const pocReadDeniedBody = await pocReadDenied.json() as { result: { isError: boolean; content: Array<{ text: string }> } };
      expect(pocReadDeniedBody.result.isError).toBe(true);
      expect(pocReadDeniedBody.result.content[0]?.text ?? "").not.toContain("KX Secret Wiki");

      expect(upstreamSeen).toHaveLength(3);
      const deniedAudit = await waitForAuditRow("wiki-read-denied");
      expect(deniedAudit.outcome).toBe("denied");
      expect(deniedAudit.decision_reason).toBe("wiki_forbidden");
      const kxDeniedAudit = await waitForAuditRow("wiki-read-kx-deny-poc");
      expect(kxDeniedAudit.outcome).toBe("denied");
      expect(kxDeniedAudit.decision_reason).toBe("wiki_forbidden");
      const pocDeniedAudit = await waitForAuditRow("wiki-read-poc-deny-kx");
      expect(pocDeniedAudit.outcome).toBe("denied");
      expect(pocDeniedAudit.decision_reason).toBe("wiki_forbidden");
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
              connectionId: "mysql-aliyun",
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

  it("classifies upstream semantic query timeouts as source_timeout audit events", async () => {
    const upstream = createServer(async (req, _res) => {
      await readRequestBody(req);
      // Intentionally leave the response open so the proxy timeout path fires.
    });

    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(upstreamPort);
    process.env.LUCY_PROXY_UPSTREAM_TIMEOUT_MS = "20";

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
          id: "lucy-query-timeout",
          method: "tools/call",
          params: {
            name: "lucy_query",
            arguments: {
              connectionId: "mysql-aliyun",
              measures: ["superstore_orders.sales"],
              dimensions: [{ field: "superstore_orders.region" }],
              limit: 10
            }
          }
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { error?: { data?: { reason?: string } } };
      expect(body.error?.data?.reason).toBe("source_timeout");

      const audit = await waitForAuditRow("lucy-query-timeout");
      expect(audit.tool).toBe("lucy_query");
      expect(audit.outcome).toBe("error");
      expect(audit.decision_reason).toBe("source_timeout");
      expect(String(audit.error_detail)).toContain("source_timeout");
      const sources = await waitForAuditSources(Number(audit.id));
      expect(sources[0]).toMatchObject({
        connection_id: "mysql-aliyun",
        schema_name: "dataforai",
        source_name: "superstore_orders",
        physical_table: "dataforai.superstore_orders"
      });
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
