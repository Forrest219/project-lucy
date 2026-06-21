import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "proxy-smoke-token";
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
      expect(listBody.result.tools.map((tool) => tool.name)).toEqual(["sl_read_source", "kx_catalog"]);

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
