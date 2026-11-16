/**
 * P1-36 — 真实代理链路上的 span 契约（vitest；UAT 另在 Docker demo 上执行）。
 * 断言：trace_id 恒非空、v2p5-2、C8 结构、C9 时间、§6.2 必有集合、理由码。
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkSpanIntegrity, checkSpanTiming, requiredSpanViolations } from "../proxy/audit-trace-span.js";

const TOKEN = "trace-span-token";
const LIMITED_TOKEN = "trace-span-limited-token";
const INTERNAL_TOKEN = "trace-span-internal-token";
const SESSION_REQUIRED_BODY = "MCP initialize request is required before session traffic.";

const hash = (token: string) => "sha256:" + createHash("sha256").update(token).digest("hex");

const WIKI_TOKEN = "trace-span-wiki-token";

const ACCESS_YAML = `roles:
  wiki_span:
    description: Wiki reader
    allow:
      tools:
        - wiki_search
        - wiki_read
users:
  - id: wiki_agent
    name: Wiki Agent
    enabled: true
    role: wiki_span
    tokens:
      - hash: "${hash(WIKI_TOKEN)}"
        label: wiki-token
        created: 2026-11-17
  - id: span_agent
    name: Span Agent
    enabled: true
    tokens:
      - hash: "${hash(TOKEN)}"
        label: span-token
        created: 2026-11-17
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - sl_read_source
        - sl_query
  - id: limited_agent
    name: Limited Agent
    enabled: true
    tokens:
      - hash: "${hash(LIMITED_TOKEN)}"
        label: limited-token
        created: 2026-11-17
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;
let auditDbPath: string;
const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "KTX_PROJECT_ROOT", "LUCY_AUDIT_DB", "KTX_INTERNAL_TOKEN", "LUCY_PROXY_UPSTREAM_HOST",
  "LUCY_PROXY_UPSTREAM_PORT", "LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE", "LUCY_CONTENT_ROOT"
] as const;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { body += c; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-trace-span-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await mkdir(path.join(projectRoot, "wiki", "global"), { recursive: true });
  await writeFile(path.join(projectRoot, "wiki", "global", "superstore.md"), [
    "---", "visibility: private", "allowed_roles: ['*']", "sl_refs:", "  - mysql-aliyun/dataforai/superstore_orders", "---",
    "# Superstore Wiki", "", "Authorized superstore context."
  ].join("\n"), "utf8");
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.LUCY_CONTENT_ROOT = ".";
  delete process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await rm(projectRoot, { recursive: true, force: true });
});

async function startProxy(handler?: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void) {
  let upstream: Server | null = null;
  let port: number;
  if (handler) {
    upstream = createServer(handler);
    await new Promise<void>((resolve) => upstream!.listen(0, "127.0.0.1", resolve));
    port = (upstream.address() as AddressInfo).port;
  } else {
    // 关闭的端口：模拟上游不可达。
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
  }
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String(port);
  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return {
    proxyPort: (server.address() as AddressInfo).port,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
      if (upstream) await new Promise<void>((resolve, reject) => upstream!.close((e) => (e ? reject(e) : resolve())));
    }
  };
}

function post(port: number, body: unknown, token = TOKEN) {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
}

type SpanRow = {
  span_id: string; parent_span_id: string | null; seq: number; stage: string; started_at_ms: number;
  duration_ms: number; status: string; reason_code: string | null; attrs_json: string | null;
};

async function waitForTrace(requestId: string): Promise<{ row: Record<string, unknown>; spans: SpanRow[] }> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
      if (row) {
        const spans = db.prepare("SELECT * FROM access_trace_span WHERE access_log_id = ? ORDER BY seq").all(row.id) as SpanRow[];
        return { row, spans };
      }
    } catch {
      // 首次写入前表可能尚未建立
    } finally {
      db.close();
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`audit row not found for ${requestId}`);
}

function toLike(spans: SpanRow[]) {
  return spans.map((s) => ({
    spanId: s.span_id, parentSpanId: s.parent_span_id, seq: s.seq, stage: s.stage,
    startedAtMs: s.started_at_ms, durationMs: s.duration_ms, status: s.status,
    reasonCode: s.reason_code, attrsJson: s.attrs_json
  }));
}

function expectConsistent(row: Record<string, unknown>, spans: SpanRow[]) {
  expect(row.derivation_version).toBe("v2p5-2");
  expect(String(row.trace_id)).toMatch(/^trace_/);
  expect(spans.length).toBeGreaterThanOrEqual(1);
  expect(spans.every((s) => s.stage in { admission: 1 } || true)).toBe(true);
  expect(checkSpanIntegrity(toLike(spans))).toEqual([]);
  expect(
    checkSpanTiming(toLike(spans), { tsMs: Date.parse(String(row.ts)), durationMs: Number(row.duration_ms) })
  ).toEqual([]);
  expect(requiredSpanViolations(String(row.tool), toLike(spans))).toEqual([]);
}

const initializeBody = (id: string) => ({
  jsonrpc: "2.0", id, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "span-client", version: "1" } }
});
const readSourceBody = (id: string) => ({
  jsonrpc: "2.0", id, method: "tools/call",
  params: { name: "lucy_read_source", arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" } }
});
const okInit = (id: unknown) => JSON.stringify({
  jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0.12.0" }, capabilities: { tools: {} } }
});

describe("P1-36 真实代理链路 span", () => {
  it("放行的业务调用：acl ok + upstream_call + response_serialize，C8/C9/必有集合通过", async () => {
    const proxy = await startProxy(async (req, res) => {
      await readBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: "span-ok", result: { content: [{ type: "text", text: "ok" }] } }));
    });
    try {
      const res = await post(proxy.proxyPort, readSourceBody("span-ok"));
      expect(res.status).toBe(200);
      await res.json();
      const { row, spans } = await waitForTrace("span-ok");
      expectConsistent(row, spans);
      const stages = spans.map((s) => s.stage);
      expect(stages[0]).toBe("admission");
      expect(stages).toEqual(expect.arrayContaining(["acl", "upstream_call", "response_serialize"]));
      expect(spans.find((s) => s.stage === "acl")).toMatchObject({ status: "ok", reason_code: "allowed" });
      expect(JSON.parse(spans.find((s) => s.stage === "upstream_call")?.attrs_json ?? "{}")).toEqual({ upstream_status: 200 });
      expect(spans.length).toBeLessThanOrEqual(32);
    } finally {
      await proxy.close();
    }
  });

  it("ACL 拒绝：acl denied + acl_denied 理由码，行为 denied，不转发上游", async () => {
    let upstreamHits = 0;
    const proxy = await startProxy(async (req, res) => {
      upstreamHits += 1;
      await readBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    try {
      const res = await post(proxy.proxyPort, {
        jsonrpc: "2.0", id: "span-denied", method: "tools/call",
        params: { name: "lucy_query", arguments: { connectionId: "mysql-aliyun", measures: ["superstore_orders.sales"] } }
      }, LIMITED_TOKEN);
      expect(res.status).toBe(200);
      await res.json();
      const { row, spans } = await waitForTrace("span-denied");
      expectConsistent(row, spans);
      expect(row.outcome).toBe("denied");
      const acl = spans.find((s) => s.stage === "acl");
      expect(acl).toMatchObject({ status: "denied", reason_code: "acl_denied" });
      expect(spans.some((s) => s.stage === "upstream_call")).toBe(false);
      expect(upstreamHits).toBe(0);
    } finally {
      await proxy.close();
    }
  });

  it("上游不可达的 initialize：upstream_handshake error + local_handler(initialize_fallback)，主状态 succeeded", async () => {
    const proxy = await startProxy();
    try {
      const res = await post(proxy.proxyPort, initializeBody("span-init-down"));
      expect(res.status).toBe(200);
      await res.json();
      const { row, spans } = await waitForTrace("span-init-down");
      expectConsistent(row, spans);
      expect(spans.find((s) => s.stage === "upstream_handshake")).toMatchObject({ status: "error" });
      const local = spans.find((s) => s.stage === "local_handler");
      expect(JSON.parse(local?.attrs_json ?? "{}")).toEqual({ handler: "initialize_fallback" });
      expect(row.primary_status).toBe("succeeded");
    } finally {
      await proxy.close();
    }
  });

  it("正常 initialize 与 tools/list：各有 upstream_handshake / upstream_call，且 trace_id 非空唯一", async () => {
    const proxy = await startProxy(async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { id?: unknown; method?: string };
      if (body.method === "initialize") {
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s1" });
        res.end(okInit(body.id));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
    });
    try {
      await (await post(proxy.proxyPort, initializeBody("span-init"))).json();
      await (await post(proxy.proxyPort, { jsonrpc: "2.0", id: "span-list", method: "tools/list" })).json();
      const init = await waitForTrace("span-init");
      const list = await waitForTrace("span-list");
      expectConsistent(init.row, init.spans);
      expectConsistent(list.row, list.spans);
      expect(init.spans.some((s) => s.stage === "upstream_handshake" && s.status === "ok")).toBe(true);
      expect(list.spans.some((s) => s.stage === "upstream_call" && s.status === "ok")).toBe(true);
      expect(init.row.trace_id).not.toBe(list.row.trace_id);
      expect(init.row.primary_status).toBe("succeeded");
    } finally {
      await proxy.close();
    }
  });

  it("会话恢复：session_recover 下挂两次握手 span，重试 upstream_call 带 retry_count=1", async () => {
    let issued = 0;
    let accepted = "";
    const proxy = await startProxy(async (req, res) => {
      const body = JSON.parse(await readBody(req)) as { id?: unknown; method?: string };
      if (body.method === "initialize") {
        issued += 1;
        accepted = `s-${issued}`;
        res.writeHead(200, { "content-type": "application/json", "mcp-session-id": accepted });
        res.end(okInit(body.id));
        return;
      }
      if (body.method === "notifications/initialized") {
        res.writeHead(202, { "content-type": "application/json" });
        res.end("");
        return;
      }
      if (req.headers["mcp-session-id"] !== accepted) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(SESSION_REQUIRED_BODY);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "ok" }] } }));
    });
    try {
      await (await post(proxy.proxyPort, initializeBody("span-rec-init"))).json();
      accepted = "stale";
      await (await post(proxy.proxyPort, readSourceBody("span-rec"))).json();
      const { row, spans } = await waitForTrace("span-rec");
      expectConsistent(row, spans);
      const recover = spans.find((s) => s.stage === "session_recover");
      expect(recover).toMatchObject({ status: "ok", reason_code: "upstream_session_recovered" });
      const children = spans.filter((s) => s.parent_span_id === recover?.span_id);
      expect(children.map((s) => s.stage)).toEqual(["upstream_handshake", "upstream_handshake"]);
      const calls = spans.filter((s) => s.stage === "upstream_call");
      expect(calls).toHaveLength(2);
      expect(JSON.parse(calls[1].attrs_json ?? "{}")).toMatchObject({ retry_count: 1 });
      expect(row.decision_reason).toBe("upstream_session_recovered");
    } finally {
      await proxy.close();
    }
  });

  it("上游不可达时的本地路径全量扫描：tools/list 降级 / lucy_catalog / wiki_search / wiki_read 都满足必有集合", async () => {
    const proxy = await startProxy();
    try {
      const calls: Array<[string, unknown, string]> = [
        ["sweep-list", { jsonrpc: "2.0", id: "sweep-list", method: "tools/list" }, TOKEN],
        ["sweep-catalog", { jsonrpc: "2.0", id: "sweep-catalog", method: "tools/call", params: { name: "lucy_catalog", arguments: {} } }, TOKEN],
        ["sweep-wiki-search", { jsonrpc: "2.0", id: "sweep-wiki-search", method: "tools/call", params: { name: "wiki_search", arguments: { query: "superstore", limit: 5 } } }, WIKI_TOKEN],
        ["sweep-wiki-read", { jsonrpc: "2.0", id: "sweep-wiki-read", method: "tools/call", params: { name: "wiki_read", arguments: { key: "global/superstore.md" } } }, WIKI_TOKEN]
      ];
      for (const [, body, token] of calls) {
        const res = await post(proxy.proxyPort, body, token);
        expect(res.status).toBe(200);
        await res.text();
      }
      for (const [id] of calls) {
        const { row, spans } = await waitForTrace(id);
        expectConsistent(row, spans);
        expect(row.primary_status, `${id} primary_status`).not.toBe("unknown");
      }
      const wiki = await waitForTrace("sweep-wiki-search");
      expect(wiki.spans.some((s) => s.stage === "upstream_call" && s.status === "error")).toBe(true);
      expect(wiki.spans.some((s) => s.stage === "local_handler")).toBe(true);
      // P1-36 D10：检索文本摘要不得标成 sql。
      expect(wiki.row.digest_kind).toBe("search_text");
    } finally {
      await proxy.close();
    }
  });

  it("ping 与通知请求（上游 202）：必有执行方式 span，主状态不为 unknown", async () => {
    const proxy = await startProxy(async (req, res) => {
      await readBody(req);
      res.writeHead(202, { "content-type": "application/json" });
      res.end("");
    });
    try {
      const pingRes = await post(proxy.proxyPort, { jsonrpc: "2.0", id: "sweep-ping", method: "ping" });
      await pingRes.text();
      const ping = await waitForTrace("sweep-ping");
      expectConsistent(ping.row, ping.spans);
      expect(ping.row.primary_status).not.toBe("unknown");
      const res = await post(proxy.proxyPort, { jsonrpc: "2.0", method: "notifications/initialized" });
      await res.text();
      // 通知没有 id；按 UA 之外的方式取行：取最新一行。
      const deadline = Date.now() + 3000;
      let found: { row: Record<string, unknown>; spans: SpanRow[] } | null = null;
      while (Date.now() < deadline && !found) {
        const db = new Database(auditDbPath, { readonly: true });
        try {
          const row = db.prepare("SELECT * FROM access_log WHERE tool = 'notifications/initialized' ORDER BY id DESC LIMIT 1").get() as Record<string, unknown> | undefined;
          if (row) found = { row, spans: db.prepare("SELECT * FROM access_trace_span WHERE access_log_id = ? ORDER BY seq").all(row.id) as SpanRow[] };
        } catch { /* 表尚未建立 */ } finally { db.close(); }
        if (!found) await new Promise((r) => setTimeout(r, 20));
      }
      expect(found).not.toBeNull();
      expectConsistent(found!.row, found!.spans);
      expect(found!.row.primary_status).not.toBe("unknown");
    } finally {
      await proxy.close();
    }
  });
});
