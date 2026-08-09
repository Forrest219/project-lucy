import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "sse-early-headers-token";
const INTERNAL_TOKEN = "sse-early-internal-token";

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
  - id: sse_agent
    name: SSE Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: sse-token
        created: 2026-08-09
    allow:
      connections:
        - demo-mysql
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_query
        - lucy_read_source
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousInternalToken: string | undefined;
let previousUpstreamHost: string | undefined;
let previousUpstreamPort: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;

  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-mcp-sse-early-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "demo-mysql", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "demo-mysql", "_schema", "dataforai.yaml"),
    SCHEMA_YAML,
    "utf8"
  );
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
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

describe("lucy_query SSE early headers (Cursor Streamable HTTP)", () => {
  it("flushes text/event-stream headers before upstream body completes (no Content-Length)", async () => {
    let releaseUpstreamBody!: () => void;
    const upstreamBodyGate = new Promise<void>((resolve) => {
      releaseUpstreamBody = resolve;
    });
    let upstreamBodyReleased = false;

    const upstream = createServer(async (req, res) => {
      const raw = await readRequestBody(req);
      const parsed = JSON.parse(raw) as { id?: unknown };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "mcp-session-id": "upstream-session"
      });
      // Headers only (no SSE comment body). Proxy must flush these to the client
      // before the JSON-RPC event is ready — Cursor hangs on lone `:\n\n` chunks.
      res.flushHeaders?.();
      // Hold the SSE event until the client has observed proxy response headers.
      await upstreamBodyGate;
      upstreamBodyReleased = true;
      res.write(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { content: [{ type: "text", text: JSON.stringify({ rows: [["East", 1]] }) }] }
        })}\n\n`
      );
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl");
    resetEffectivePolicyForTests();
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: "sse-early-1",
        method: "tools/call",
        params: {
          name: "lucy_query",
          arguments: {
            connectionId: "demo-mysql",
            measures: ["superstore_orders.total_sales"]
          }
        }
      });

      const { res, body } = await new Promise<{
        res: IncomingMessage;
        body: string;
      }>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            path: "/mcp",
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${TOKEN}`,
              "content-length": Buffer.byteLength(payload)
            }
          },
          (res) => {
            // Headers must arrive while upstream is still holding the body.
            try {
              expect(upstreamBodyReleased).toBe(false);
              expect(String(res.headers["content-type"] ?? "")).toContain("text/event-stream");
              expect(res.headers["content-length"]).toBeUndefined();
              expect(String(res.headers["x-accel-buffering"] ?? "").toLowerCase()).toBe("no");
            } catch (err) {
              reject(err);
              res.resume();
              return;
            }
            releaseUpstreamBody();
            let buf = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              buf += chunk;
            });
            res.on("end", () => resolve({ res, body: buf }));
            res.on("error", reject);
          }
        );
        req.on("error", reject);
        req.end(payload);
      });

      expect(res.statusCode).toBe(200);
      // No lone SSE comment prefix — first body bytes should be the message event.
      expect(body.startsWith(":")).toBe(false);
      expect(body.trimStart().startsWith("event: message")).toBe(true);
      expect(body).toContain("sse-early-1");
      expect(body).toContain("East");
      expect(upstreamBodyReleased).toBe(true);
    } finally {
      releaseUpstreamBody();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("rewrites the JSON-RPC response frame when upstream SSE includes progress notifications", async () => {
    const upstream = createServer(async (req, res) => {
      const raw = await readRequestBody(req);
      const parsed = JSON.parse(raw) as { id?: unknown };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "mcp-session-id": "upstream-session-progress"
      });
      res.write(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: { progressToken: parsed.id, progress: 0.5, message: "Executing" }
        })}\n\n`
      );
      res.write(
        `event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: parsed.id,
          result: { content: [{ type: "text", text: JSON.stringify({ rows: [["East", 2]] }) }] }
        })}\n\n`
      );
      res.end();
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);

    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { resetEffectivePolicyForTests } = await import("../proxy/acl");
    resetEffectivePolicyForTests();
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    const proxyPort = (server.address() as AddressInfo).port;

    try {
      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id: "sse-progress-1",
        method: "tools/call",
        params: {
          name: "lucy_query",
          arguments: {
            connectionId: "demo-mysql",
            measures: ["superstore_orders.total_sales"]
          }
        }
      });

      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: proxyPort,
            path: "/mcp",
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${TOKEN}`,
              "content-length": Buffer.byteLength(payload)
            }
          },
          (res) => {
            let buf = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => {
              buf += chunk;
            });
            res.on("end", () => resolve(buf));
            res.on("error", reject);
          }
        );
        req.on("error", reject);
        req.end(payload);
      });

      expect(body).toContain("event: message");
      expect(body).toContain("sse-progress-1");
      expect(body).toContain("East");
      expect(body).not.toContain("notifications/progress");
      expect(body).toContain("_meta");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await new Promise<void>((resolve, reject) => upstream.close((err) => (err ? reject(err) : resolve())));
    }
  });
});
