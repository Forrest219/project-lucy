/**
 * P1-37 U2 — 失败信息可操作（vitest 契约；UAT 另行在 Docker demo 上执行）。
 * SC-04 未知工具名 · SC-05 必然被拒形状前移 · SC-06 重复被拒与指纹。
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_A = "ux-token-a";
const TOKEN_B = "ux-token-b";
const INTERNAL_TOKEN = "ux-internal-token";

const hash = (token: string) => "sha256:" + createHash("sha256").update(token).digest("hex");

const ACCESS_YAML = `users:
  - id: agent_a
    name: Agent A
    enabled: true
    tokens:
      - hash: "${hash(TOKEN_A)}"
        label: a
        created: 2026-09-22
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
  - id: agent_b
    name: Agent B
    enabled: true
    tokens:
      - hash: "${hash(TOKEN_B)}"
        label: b
        created: 2026-09-22
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_catalog
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
const saved: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "KTX_PROJECT_ROOT", "LUCY_AUDIT_DB", "KTX_INTERNAL_TOKEN", "LUCY_PROXY_UPSTREAM_HOST",
  "LUCY_PROXY_UPSTREAM_PORT", "LUCY_CONTENT_ROOT", "LUCY_REJECTION_FINGERPRINT_KEY"
] as const;
const FINGERPRINT_KEY = "k".repeat(48);

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-ux-resilience-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), SCHEMA_YAML, "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_REJECTION_FINGERPRINT_KEY = FINGERPRINT_KEY;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(projectRoot, { recursive: true, force: true });
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

type Seen = { rpcMethod?: string; toolName?: string };

async function startProxy(seen: Seen[] = []): Promise<{ close: () => Promise<void>; port: number }> {
  const upstream: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const raw = await readBody(req);
    let body: Record<string, unknown> | undefined;
    try { body = JSON.parse(raw) as Record<string, unknown>; } catch { body = undefined; }
    seen.push({ rpcMethod: body?.method as string | undefined, toolName: (body?.params as { name?: string } | undefined)?.name });
    if (body?.method === "initialize") {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "ktx-s1" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0" }, capabilities: { tools: {} } } }));
      return;
    }
    if (body?.method === "notifications/initialized") { res.writeHead(202); res.end(); return; }
    if (body?.method === "tools/list") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [
        { name: "sl_query", description: "internal", inputSchema: { type: "object" } },
        { name: "sl_read_source", description: "internal", inputSchema: { type: "object" } }
      ] } }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0", id: body?.id,
      result: { content: [{ type: "text", text: JSON.stringify({ rows: [{ region: "East", sales: 1 }], truncated: false }) }] }
    }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
  process.env.LUCY_PROXY_UPSTREAM_PORT = String((upstream.address() as AddressInfo).port);
  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy();
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  };
}

async function call(port: number, token: string, id: string, name: string, args?: unknown, session = "sess-1"): Promise<{ text: string; data?: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": session },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } })
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }>; data?: Record<string, unknown> } };
  return { text: body.result?.content?.[0]?.text ?? "", data: body.result?.data };
}

async function listTools(port: number, token: string): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "mcp-session-id": "sess-1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "list", method: "tools/list" })
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string }> } };
  return (body.result?.tools ?? []).map((t) => t.name);
}

async function auditRow(requestId: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM access_log WHERE request_id = ?").get(requestId) as Record<string, unknown> | undefined;
      if (row) return row;
    } catch { /* 表尚未建立 */ } finally { db.close(); }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`audit row not found: ${requestId}`);
}

const VALID_QUERY = {
  connectionId: "mysql-aliyun",
  measures: ["superstore_orders.sales"],
  dimensions: [{ field: "superstore_orders.region" }]
};

describe("SC-05 必然被拒的形状在转发前返回", () => {
  it("缺 measures：Lucy 工具名＋示例，不含 sl_query，不访问上游，审计为 client_schema_failure", async () => {
    const seen: Seen[] = [];
    const proxy = await startProxy(seen);
    try {
      const shapes: Array<[string, unknown]> = [
        ["dims-only", { connectionId: "mysql-aliyun", dimensions: [{ field: "superstore_orders.region" }] }],
        ["source-only", { connectionId: "mysql-aliyun", sourceName: "superstore_orders" }],
        ["measures-empty", { connectionId: "mysql-aliyun", measures: [], dimensions: [{ field: "superstore_orders.region" }] }],
        // Spec 步骤 1：无其他要素的两个形状先被既有 query_shape_required 拦下，文案同样必须带示例（UAT-MCPX-05 实测补洞）
        ["bare-connection", { connectionId: "mysql-aliyun" }],
        ["bare-empty-measures", { connectionId: "mysql-aliyun", measures: [] }]
      ];
      for (const [id, args] of shapes) {
        const out = await call(proxy.port, TOKEN_A, `s05-${id}`, "lucy_query", args);
        expect(out.text).toContain("lucy_query");
        expect(out.text).toContain("measures");
        expect(out.text).toContain("\"measures\":[");
        expect(out.text).not.toContain("sl_query");
        const row = await auditRow(`s05-${id}`);
        expect(row.error_category).toBe("client_schema_failure");
      }
      expect(seen.filter((s) => s.toolName === "sl_query")).toHaveLength(0);
    } finally {
      await proxy.close();
    }
  });

  it("对照：合法形状（measures 字符串／表达式对象）仍转发上游", async () => {
    const seen: Seen[] = [];
    const proxy = await startProxy(seen);
    try {
      const a = await call(proxy.port, TOKEN_A, "s05-ok-1", "lucy_query", VALID_QUERY);
      expect(a.text).not.toContain("Invalid arguments");
      const b = await call(proxy.port, TOKEN_A, "s05-ok-2", "lucy_query", {
        connectionId: "mysql-aliyun",
        measures: [{ expr: "sum(superstore_orders.sales)", name: "sales" }],
        sourceName: "superstore_orders"
      });
      expect(b.text).not.toContain("Invalid arguments");
      expect(seen.filter((s) => s.toolName === "sl_query").length).toBe(2);
    } finally {
      await proxy.close();
    }
  });
});

describe("SC-04 未知工具名", () => {
  it("无入参与带合法数据面入参都进入 tool_unclassified，清单只含本身份可见工具", async () => {
    const proxy = await startProxy();
    try {
      const realA = await listTools(proxy.port, TOKEN_A);
      const realB = await listTools(proxy.port, TOKEN_B);
      const bare = await call(proxy.port, TOKEN_A, "s04-bare", "lucy_frobnicate");
      const withArgs = await call(proxy.port, TOKEN_A, "s04-args", "lucy_frobnicate", VALID_QUERY);
      for (const [id, out] of [["s04-bare", bare], ["s04-args", withArgs]] as const) {
        expect(out.text).toContain("tool_unclassified:lucy_frobnicate");
        expect(out.text).toMatch(/Do not guess tool names/);
        const row = await auditRow(id);
        expect(row.decision_reason).toBe("tool_unclassified:lucy_frobnicate");
      }
      const namesA = (bare.data?.availableTools ?? []) as string[];
      const outB = await call(proxy.port, TOKEN_B, "s04-b", "lucy_frobnicate");
      const namesB = (outB.data?.availableTools ?? []) as string[];
      expect(namesA).toEqual(expect.arrayContaining(["lucy_query", "lucy_catalog"]));
      expect(namesB).not.toContain("lucy_query");
      expect(namesB).toContain("lucy_read_source");
      // 清单＝同一身份真实 tools/list 的名称集合。
      expect(namesA).toEqual([...realA].sort());
      expect(namesB).toEqual([...realB].sort());
      for (const forbidden of ["sl_query", "sl_read_source", "sql_execution", "memory_ingest"]) {
        expect(namesA).not.toContain(forbidden);
        expect(namesB).not.toContain(forbidden);
        expect(bare.text).not.toContain(forbidden);
      }
    } finally {
      await proxy.close();
    }
  });
});

describe("SC-06 重复被拒与指纹", () => {
  it("同身份同会话原样重提：第二次带「请勿原样重试」；键序／别名变化仍视为相同；语义不同或他人不提示", async () => {
    const proxy = await startProxy();
    try {
      const base = { connectionId: "mysql-aliyun", dimensions: [{ field: "superstore_orders.region" }] };
      const first = await call(proxy.port, TOKEN_A, "s06-1", "lucy_query", base);
      expect(first.text).not.toMatch(/rejected/i);
      await auditRow("s06-1");

      const second = await call(proxy.port, TOKEN_A, "s06-2", "lucy_query", base);
      expect(second.text).toMatch(/Do not retry it unchanged/);

      // 键序不同、dimensions 内键序不同 → 同一指纹。
      const reordered = await call(proxy.port, TOKEN_A, "s06-3", "lucy_query", {
        dimensions: [{ field: "superstore_orders.region" }], connectionId: "mysql-aliyun"
      });
      expect(reordered.text).toMatch(/Do not retry it unchanged/);

      // 语义不同的请求（多了 limit）不提示。
      const different = await call(proxy.port, TOKEN_A, "s06-4", "lucy_query", { ...base, limit: 5 });
      expect(different.text).not.toMatch(/Do not retry it unchanged/);

      // 不同身份不互相提示。
      const other = await call(proxy.port, TOKEN_B, "s06-5", "lucy_query", base);
      expect(other.text).not.toMatch(/Do not retry it unchanged/);

      // 不同下游会话作用域不提示。
      const otherSession = await call(proxy.port, TOKEN_A, "s06-6", "lucy_query", base, "sess-2");
      expect(otherSession.text).not.toMatch(/Do not retry it unchanged/);

      // 审计列：版本前缀、与公开 SHA-256(canonical) 不同、同输入同值、不同输入不同值。
      const r1 = String((await auditRow("s06-1")).rejection_fingerprint);
      const r2 = String((await auditRow("s06-2")).rejection_fingerprint);
      const r3 = String((await auditRow("s06-3")).rejection_fingerprint);
      const r4 = String((await auditRow("s06-4")).rejection_fingerprint);
      expect(r1).toMatch(/^rf1:[0-9a-f]{16}$/);
      expect(r2).toBe(r1);
      expect(r3).toBe(r1);
      expect(r4).not.toBe(r1);
      const { canonicalJson } = await import("../proxy/rejection-guard");
      const plain = createHash("sha256").update(canonicalJson(base)).digest("hex").slice(0, 16);
      expect(r1).not.toBe(`rf1:${plain}`);
    } finally {
      await proxy.close();
    }
  });
});
