import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTION_BUDGET_MAX_BUSY_MS, QUESTION_BUDGET_MAX_CALLS } from "../proxy/question-experience";

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
  let previousContentRoot: string | undefined;
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
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousInternalToken = process.env.KTX_INTERNAL_TOKEN;
  previousUpstreamHost = process.env.LUCY_PROXY_UPSTREAM_HOST;
  previousUpstreamPort = process.env.LUCY_PROXY_UPSTREAM_PORT;
  previousEnableInstructions = process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_INTERNAL_TOKEN = INTERNAL_TOKEN;
  // Default to enabled; individual tests override as needed.
  delete process.env.LUCY_ENABLE_INSTRUCTIONS_INJECTION;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
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
      // Spec lucy-20261111 SC-T4：有可见 catalog 的 role-aware 路径也必须是 60／300，不得残留旧 12／120s／8 分钟。
      expect(body.result.instructions).toContain(`${QUESTION_BUDGET_MAX_CALLS} data-tool calls`);
      expect(body.result.instructions).toContain(`${QUESTION_BUDGET_MAX_BUSY_MS / 1000} seconds of settled data-processing time`);
      expect(body.result.instructions).not.toContain("at most 12 business tool calls");
      expect(body.result.instructions).not.toContain("within 120 seconds");
      expect(body.result.instructions).not.toContain("within 8 minutes");
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

    const bindingsDir = path.join(projectRoot, "caliber-bindings");
    await mkdir(bindingsDir, { recursive: true });
    await writeFile(path.join(bindingsDir, "orders_count.yaml"), `bindingId: orders_count
title: Order count
status: published
triggers: [Order count]
connectionId: mysql-aliyun
source: superstore_orders
caliber:
  measures: [superstore_orders.order_count]
  dimensions: []
  segments: []
  filterFields: []
  requireMeasures: [superstore_orders.order_count]
`, "utf8");
    const registry = await import("../proxy/caliber-binding-registry.js");
    const candidate = await registry.loadCaliberBindingCandidate();
    if (!candidate.ok) throw new Error(`Binding fixture could not compile: ${candidate.reason}`);
    expect(await registry.commitCaliberBindingRegistry(candidate, {
      releaseId: "instructions-begin-fixture",
      attemptId: "instructions-begin-fixture"
    })).toMatchObject({ ok: true });
    expect(await registry.classifyCaliberParticipation()).toBe("active");

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
      expect(body.result.instructions).toContain("Skipping begin does not bypass");
      expect(body.result.instructions).toContain("Prefer the user's original wording in `question`");
    } finally {
      await closeAll(upstream, server);
    }
  });

  // Spec lucy-20261111 / 高密度分析用户：触顶后唯一的缓冲是 1 次续查，模型须在 initialize 就知道。
  async function initializeInstructionsWithTools(extraTools: string[], id: string): Promise<string> {
    const yaml = ACCESS_YAML.replace(
      "        - sl_read_source\n",
      `        - sl_read_source\n${extraTools.map((tool) => `        - ${tool}\n`).join("")}`
    );
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), yaml, "utf8");
    const { upstream, server, proxyPort } = await startProxy(async (req, res) => {
      await readRequestBody(req);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0.12.0" }, capabilities: { tools: {} }, instructions: "" }
      }));
    });
    try {
      const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: initializeRequest(id)
      });
      expect(res.status).toBe(200);
      return ((await res.json()) as { result: { instructions: string } }).result.instructions;
    } finally {
      await closeAll(upstream, server);
    }
  }

  it("tells the model how to continue after question_budget_exhausted when lucy_continue_question is visible", async () => {
    const instructions = await initializeInstructionsWithTools(["lucy_continue_question"], "init-continue-visible");
    expect(instructions).toContain("question_budget_exhausted");
    expect(instructions).toContain("`continuable` is true");
    expect(instructions).toContain("call `lucy_continue_question`");
    expect(instructions).toContain("`continueToken`");
    // P1-74 / D2：inactive 续查档数默认至多 5 档（不再是一次）
    expect(instructions).toContain("up to 5 times");
    expect(instructions).toContain("`continuable` is false");
  });

  it("still says to stop and deliver partial results, without naming lucy_continue_question, when it is not visible", async () => {
    // P1-74 / D7：计费问数身份（含 lucy_query）在预算开启时默认可达 continue。
    // 「不可见」分支在预算关闭（LUCY_QUESTION_BUDGET=off）时仍须成立。
    const previousBudget = process.env.LUCY_QUESTION_BUDGET;
    process.env.LUCY_QUESTION_BUDGET = "off";
    try {
      const instructions = await initializeInstructionsWithTools([], "init-continue-hidden");
      expect(instructions).toContain("question_budget_exhausted");
      expect(instructions).toContain("deliver the verified partial results");
      expect(instructions).not.toContain("lucy_continue_question");
      expect(instructions).not.toContain("continueToken");
    } finally {
      if (previousBudget === undefined) delete process.env.LUCY_QUESTION_BUDGET;
      else process.env.LUCY_QUESTION_BUDGET = previousBudget;
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

// ─── P1-75 §2.2：握手指引决策（1 秒截止／容量 20／基础指引降级）─────────────

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function pollUntil(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("pollUntil timed out");
    await sleep(10);
  }
}

function okUpstream(id: string) {
  return async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
    await readRequestBody(req);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0.12.0" }, capabilities: { tools: {} } }
    }));
  };
}

function postInitialize(port: number, id: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: initializeRequest(id),
    signal
  });
}

async function instructionsOf(res: Response): Promise<string> {
  expect(res.status).toBe(200);
  return ((await res.json()) as { result: { instructions: string } }).result.instructions;
}

const SOURCE_LINE = "mysql-aliyun.dataforai.superstore_orders";

describe("P1-75 §2.2 握手指引：描述增强移出应答路径", () => {
  it("握手不跑描述增强；独立 lucy_catalog 仍返回描述与 grain", async () => {
    await writeFile(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"), [
      "tables:",
      "  superstore_orders:",
      "    table: dataforai.superstore_orders",
      "    descriptions:",
      "      db: 订单明细 ODS 描述标记"
    ].join("\n") + "\n", "utf8");
    await writeFile(
      path.join(projectRoot, "semantic-layer", "mysql-aliyun", "superstore_orders.yaml"),
      "name: superstore_orders\ntable: dataforai.superstore_orders\ngrain:\n  - order_id_grain_marker\n",
      "utf8"
    );
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-desc"));
    try {
      const descriptions = await import("../proxy/source-descriptions");
      descriptions.resetDescriptionIndexCacheForTests();

      const instructions = await instructionsOf(await postInitialize(proxyPort, "p175-desc"));
      expect(instructions).toContain(SOURCE_LINE);
      expect(instructions).not.toContain("订单明细 ODS 描述标记");
      const afterHandshake = descriptions.descriptionIndexCacheStats();
      expect(afterHandshake.hits + afterHandshake.misses + afterHandshake.uncacheable).toBe(0);

      const catalogRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "mcp-session-id": "s-desc" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "p175-catalog", method: "tools/call", params: { name: "lucy_catalog", arguments: {} } })
      });
      const catalogText = await catalogRes.text();
      expect(catalogText).toContain("订单明细 ODS 描述标记");
      expect(catalogText).toContain("order_id_grain_marker");
      const afterCatalog = descriptions.descriptionIndexCacheStats();
      expect(afterCatalog.hits + afterCatalog.misses + afterCatalog.uncacheable).toBeGreaterThan(0);
      await waitForAuditRow("p175-catalog");
      const db = new Database(auditDbPath, { readonly: true });
      try {
        const spans = db.prepare(`
          SELECT span.stage, span.seq, span.attrs_json AS attrs
          FROM access_trace_span span JOIN access_log log ON span.access_log_id = log.id
          WHERE log.request_id = ? ORDER BY span.seq
        `).all("p175-catalog") as { stage: string; seq: number; attrs: string | null }[];
        const handlers = spans.filter((span) => span.stage === "local_handler");
        expect(handlers).toHaveLength(1);
        expect(JSON.parse(handlers[0].attrs ?? "{}")).toMatchObject({ handler: "catalog" });
        expect(handlers[0].seq).toBeLessThan(spans.find((span) => span.stage === "response_serialize")?.seq ?? -1);
      } finally {
        db.close();
      }
    } finally {
      await closeAll(upstream, server);
    }
  });
});

describe("P1-75 §2.2 握手指引：截止、容量、取消与撤权", () => {
  it("到点只发一次基础指引（共用核心规则、无角色名单、迟到工作不发布）；工作真实终结才释放容量", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-deadline"));
    try {
      const mcp = await import("../proxy/mcp-proxy");
      mcp.instructionsDecisionTestHooks.deadlineMs = 200;
      let releaseWork!: () => void;
      const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
      mcp.instructionsDecisionTestHooks.beforeBuild = () => workGate; // 忽略取消：模拟取消不了的底层读取

      const startedAt = Date.now();
      const basic = await instructionsOf(await postInitialize(proxyPort, "p175-deadline"));
      expect(Date.now() - startedAt).toBeLessThan(1500);
      expect(basic).toContain("Tool Discovery");
      expect(basic).toContain("answerability dependency matrix");
      expect(basic).toContain(`${QUESTION_BUDGET_MAX_CALLS} data-tool calls`);
      expect(basic).not.toContain(SOURCE_LINE);
      expect(basic).not.toContain("## Visible Scope");
      expect(basic).not.toContain("## Governed Domain Skills");
      expect(basic).not.toContain("lucy_begin_question");

      // 响应已发出，但工作未真实终结：容量仍被占用。
      expect(mcp.instructionsWorkActiveCount()).toBe(1);
      releaseWork();
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);

      const audit = await waitForAuditRow("p175-deadline");
      expect(audit.outcome).toBe("ok");
      expect(audit.error_detail).toBe("instructions_basic:deadline");

      // 迟到工作没有发布任何东西：下一次握手重新构建并得到完整指引。
      mcp.instructionsDecisionTestHooks.beforeBuild = undefined;
      mcp.instructionsDecisionTestHooks.deadlineMs = undefined;
      const full = await instructionsOf(await postInitialize(proxyPort, "p175-deadline-2"));
      expect(full).toContain(SOURCE_LINE);
      // 同源核心规则：基础指引的每条核心规则行都原样出现在完整指引里。
      const basicLines = basic.split("\n");
      const coreLines = basicLines
        .slice(0, basicLines.indexOf("## Tool Discovery"))
        .filter((line) => line.trim() !== "" && !line.includes("the catalog tool listed in `tools/list`") && !line.startsWith("# "));
      expect(coreLines.length).toBeGreaterThan(20);
      for (const line of coreLines) expect(full).toContain(line);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("策略／口径读取卡死：到点与容量满的基础指引仍在截止点附近返回（预装载，不等读取）", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-hang"));
    const mcp = await import("../proxy/mcp-proxy");
    let policyReadCalls = 0;
    let releaseReads: () => void = () => undefined;
    try {
      mcp.instructionsDecisionTestHooks.deadlineMs = 200;
      mcp.instructionsDecisionTestHooks.capacity = 1;
      // 测试期间不返回、且忽略取消：模拟 shouldHideBeginQuestion / allowedToolNames 的慢读取（结束时放行，避免泄漏许可）。
      const hang = new Promise<void>((resolve) => { releaseReads = resolve; });
      mcp.instructionsDecisionTestHooks.policyReads = () => {
        policyReadCalls += 1;
        return hang;
      };

      // 到点路径：完整构建卡在策略读取，1s 决策线（此处 200ms）后基础指引立即返回。
      const startedAt = Date.now();
      const deadlineBasic = await instructionsOf(await postInitialize(proxyPort, "p175-hang-deadline"));
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeLessThan(1000);
      expect(deadlineBasic).toBe(mcp.buildBasicInstructions());
      expect((await waitForAuditRow("p175-hang-deadline")).error_detail).toBe("instructions_basic:deadline");
      const callsAfterDeadline = policyReadCalls;
      expect(callsAfterDeadline).toBeGreaterThan(0); // 完整路径确实触达了卡死的读取

      // 容量满路径（上一条卡死工作仍占用唯一许可）：立即基础指引，且不再触发任何策略读取。
      expect(mcp.instructionsWorkActiveCount()).toBe(1);
      const capStartedAt = Date.now();
      const capacityBasic = await instructionsOf(await postInitialize(proxyPort, "p175-hang-cap"));
      expect(Date.now() - capStartedAt).toBeLessThan(800);
      expect(capacityBasic).toBe(mcp.buildBasicInstructions());
      expect((await waitForAuditRow("p175-hang-cap")).error_detail).toBe("instructions_basic:capacity_full");
      expect(policyReadCalls).toBe(callsAfterDeadline);
    } finally {
      releaseReads();
      mcp.instructionsDecisionTestHooks.policyReads = undefined;
      mcp.instructionsDecisionTestHooks.capacity = undefined;
      mcp.instructionsDecisionTestHooks.deadlineMs = undefined;
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);
      await closeAll(upstream, server);
    }
  });

  it("容量已满：不排队，直接基础指引；占用工作结束后恢复完整指引", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-cap"));
    try {
      const mcp = await import("../proxy/mcp-proxy");
      expect(mcp.INSTRUCTIONS_WORK_MAX_CONCURRENT).toBe(20);
      expect(mcp.INSTRUCTIONS_DYNAMIC_DEADLINE_MS).toBe(1000);
      mcp.instructionsDecisionTestHooks.capacity = 2;
      let releaseWork!: () => void;
      const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
      mcp.instructionsDecisionTestHooks.beforeBuild = () => workGate;

      const heldA = postInitialize(proxyPort, "p175-cap-a");
      const heldB = postInitialize(proxyPort, "p175-cap-b");
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 2);

      const startedAt = Date.now();
      const overflow = await instructionsOf(await postInitialize(proxyPort, "p175-cap-c"));
      expect(Date.now() - startedAt).toBeLessThan(800);
      expect(overflow).toContain("Tool Discovery");
      expect(overflow).not.toContain(SOURCE_LINE);
      expect(mcp.instructionsWorkActiveCount()).toBe(2);
      expect((await waitForAuditRow("p175-cap-c")).error_detail).toBe("instructions_basic:capacity_full");

      releaseWork();
      for (const held of [heldA, heldB]) expect(await instructionsOf(await held)).toContain(SOURCE_LINE);
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);
      mcp.instructionsDecisionTestHooks.beforeBuild = undefined;
      expect(await instructionsOf(await postInitialize(proxyPort, "p175-cap-d"))).toContain(SOURCE_LINE);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("客户端断开：取消可取消工作、不写响应，容量到工作真实终结才释放", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-disc"));
    try {
      const mcp = await import("../proxy/mcp-proxy");
      let activeAtAbort = -1;
      let abortSeen = false;
      mcp.instructionsDecisionTestHooks.beforeBuild = async (signal) => {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
          abortSeen = true;
          activeAtAbort = mcp.instructionsWorkActiveCount();
          resolve();
        }, { once: true }));
        await sleep(120); // 取消后底层仍在收尾
      };
      const client = new AbortController();
      const pending = postInitialize(proxyPort, "p175-disc", client.signal).catch((err: unknown) => err);
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 1);
      client.abort();
      await pending;

      await pollUntil(() => abortSeen);
      expect(activeAtAbort).toBe(1);
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);

      const audit = await waitForAuditRow("p175-disc");
      expect(audit.outcome).toBe("error");
      expect(audit.error_detail).toBe("client_disconnected");
      expect(Number(audit.response_bytes)).toBe(0);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("构建期间被撤权：不发任何指引（沿用屏障的 403 authorization_revoked），后续合法握手不受影响", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-revoke"));
    try {
      const mcp = await import("../proxy/mcp-proxy");
      const barrier = await import("../proxy/authorization-barrier");
      mcp.instructionsDecisionTestHooks.beforeBuild = async () => {
        await barrier.narrowAuthorization({ kind: "subjects", agentIds: ["instructions_agent"], tokenHashes: [] });
      };
      const res = await postInitialize(proxyPort, "p175-revoke");
      const text = await res.text();
      expect(res.status).toBe(403);
      expect(text).toContain("authorization_revoked");
      expect(text).not.toContain("Lucy Data QA Runtime Instructions");
      expect(text).not.toContain(SOURCE_LINE);
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);

      mcp.instructionsDecisionTestHooks.beforeBuild = undefined;
      expect(await instructionsOf(await postInitialize(proxyPort, "p175-revoke-2"))).toContain(SOURCE_LINE);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("构建期间授权代次变化：完整指引不通过核验，改发基础指引（不含旧名单）", async () => {
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-stale"));
    try {
      const mcp = await import("../proxy/mcp-proxy");
      const acl = await import("../proxy/acl");
      mcp.instructionsDecisionTestHooks.afterBuild = async () => {
        await writeFile(
          path.join(projectRoot, "webui", "config", "access.yaml"),
          ACCESS_YAML.replace("        - dataforai.superstore_orders\n", "        - dataforai.superstore_orders\n        - dataforai.superstore_returns\n"),
          "utf8"
        );
        await acl.commitEffectivePolicy();
      };
      const instructions = await instructionsOf(await postInitialize(proxyPort, "p175-stale"));
      expect(instructions).toContain("Tool Discovery");
      expect(instructions).not.toContain(SOURCE_LINE);
      expect((await waitForAuditRow("p175-stale")).error_detail).toBe("instructions_basic:stale_proof");
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("Skill 对象撤权发生在构建后时丢弃旧指引，下一次握手仍返回合法目录", async () => {
    const accessPath = path.join(projectRoot, "webui", "config", "access.yaml");
    const access = `users:
  - id: instructions_agent
    enabled: true
    roles: [analyst]
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: test
        created: 2026-06-23
roles:
  analyst:
    permission_model_version: 2
    allow:
      connections: [mysql-aliyun]
      source_scope: catalog_bound
      tools: [lucy_catalog, lucy_query, lucy_skill_search]
`;
    await writeFile(accessPath, access);
    await writeFile(path.join(projectRoot, "ktx.yaml"), `connections:
  mysql-aliyun:
    driver: mysql
    database: dataforai
    enabled_tables: [dataforai.superstore_orders]
`);
    const skillsDir = path.join(projectRoot, "skills", "operations");
    await mkdir(skillsDir, { recursive: true });
    const file = path.join(skillsDir, "scoped.md");
    const skill = (role: string) => `---\nname: scoped\nstatus: published\nroles_allowed: [${role}]\n---\nprivate body\n`;
    await writeFile(file, skill("analyst"));
    const uri = "lucy-skill://operations/scoped";
    const { upstream, server, proxyPort } = await startProxy(okUpstream("p175-skill-proof"));
    const mcp = await import("../proxy/mcp-proxy");
    try {
      const warm = await instructionsOf(await postInitialize(proxyPort, "p175-skill-proof-warm"));
      expect(warm).toContain(uri);
      expect(warm).not.toContain("private body");
      mcp.instructionsDecisionTestHooks.afterBuild = async () => { await writeFile(file, skill("other")); };
      const during = await instructionsOf(await postInitialize(proxyPort, "p175-skill-proof-changed"));
      expect(during).toContain("Tool Discovery");
      expect(during).not.toContain(uri);
      expect((await waitForAuditRow("p175-skill-proof-changed")).error_detail).toBe("instructions_basic:stale_proof");
      mcp.instructionsDecisionTestHooks.afterBuild = undefined;
      const next = await instructionsOf(await postInitialize(proxyPort, "p175-skill-proof-next"));
      expect(next).toContain(SOURCE_LINE);
      expect(next).not.toContain(uri);
      await writeFile(file, skill("analyst"));
      expect(await instructionsOf(await postInitialize(proxyPort, "p175-skill-proof-restored"))).toContain(uri);
      await writeFile(accessPath, access.replace(", lucy_skill_search", ""));
      const acl = await import("../proxy/acl");
      await acl.commitEffectivePolicy();
      const narrowed = await instructionsOf(await postInitialize(proxyPort, "p175-skill-proof-role"));
      expect(narrowed).toContain(SOURCE_LINE);
      expect(narrowed).not.toContain(uri);
    } finally {
      mcp.instructionsDecisionTestHooks.afterBuild = undefined;
      await closeAll(upstream, server);
    }
  });

  it("本地协议回退（上游握手不可用）走同一决策：只发基础指引", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const deadPort = (dead.address() as AddressInfo).port;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(deadPort);
    const { buildProxy } = await import("../proxy/mcp-proxy");
    const { server, host } = buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await postInitialize(port, "p175-local");
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions: string; serverInfo: { version: string } } };
      expect(body.result.serverInfo.version).toBe("local-fallback");
      expect(body.result.instructions).toContain("Tool Discovery");
      expect(body.result.instructions).toContain("answerability dependency matrix");
      expect(body.result.instructions).not.toContain(SOURCE_LINE);
      expect(String((await waitForAuditRow("p175-local")).error_detail)).toContain("upstream_unavailable");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("基础指引无身份时保守：不点名 begin，保留 continue 逃生；md 事实源含工具发现方法", async () => {
    const mcp = await import("../proxy/mcp-proxy");
    const basic = mcp.buildBasicInstructions();
    expect(typeof basic).toBe("string"); // 预装载：同步取值，非 Promise
    expect(mcp.buildBasicInstructions()).toBe(basic); // 进程内同一份驻留文本
    expect(basic).not.toContain("lucy_begin_question");
    expect(basic).toContain("lucy_continue_question");
    expect(basic).toContain("## Tool Discovery");
    const { readFile } = await import("node:fs/promises");
    const md = await readFile(new URL("../../config/data-qa-instructions.md", import.meta.url), "utf8");
    expect(md).toContain("## 工具发现");
    expect(md).toContain("lucy_skill_search");
    expect(md).toContain("question_budget_exhausted");
    expect(md).toContain("tools/list");
  });
});

// ─── P1-77 B1：C1–C4／C6 同源注入（SC-08）──────────────────────────────────────
//
// 对每个指引分支（完整动态、全空目录回退、动态截止、容量满、构建失败、本地协议回退）
// 断言**实际 initialize 响应**含 C1–C4／C6，且握手内无 Wiki／Skill 正文读取。

const CONTEXT_MARKERS = ["[C1a]", "[C1b]", "[C1c]", "[C2]", "[C3]", "[C4]", "[C6]"] as const;

/** 代码侧（完整＋基础指引）的英文关键片段。 */
const CONTEXT_PHRASES_EN = [
  "## Business Context Adoption",
  "Governed definitions first",
  "never take the first hit",
  "No channel, no downgrade",
  "perform zero write operations",
  "not found / not permitted / read failed / definition conflict",
  "Main path protection",
  "at most one lookup and one body read"
];

/** md 事实源（全空目录回退直接发 md）的中文关键片段。 */
const CONTEXT_PHRASES_ZH = [
  "## 业务上下文默认采用",
  "已治理口径优先",
  "不得直接取首个命中",
  "无通道不降级",
  "全程零写操作",
  "未命中／无权限／读取失败／口径冲突",
  "主路径保护",
  "最多一次查找、一次正文读取"
];

const skillBodyReads = { byUri: 0, byName: 0, listed: 0 };

async function installRealInstructionsMd(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const md = await readFile(new URL("../../config/data-qa-instructions.md", import.meta.url), "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "data-qa-instructions.md"), md, "utf8");
}

/** 与 startProxy 相同，但记录上游收到的 JSON-RPC 方法，并对 Skill 正文读取计数。 */
async function startB1Proxy(): Promise<{
  upstream: Server;
  server: Server;
  proxyPort: number;
  upstreamMethods: string[];
}> {
  skillBodyReads.byUri = 0;
  skillBodyReads.byName = 0;
  skillBodyReads.listed = 0;
  vi.doMock("../skills/loader.js", async () => {
    const actual = await vi.importActual<typeof import("../skills/loader.js")>("../skills/loader.js");
    return {
      ...actual,
      getSkillByUri: (...args: Parameters<typeof actual.getSkillByUri>) => { skillBodyReads.byUri += 1; return actual.getSkillByUri(...args); },
      getSkillByName: (...args: Parameters<typeof actual.getSkillByName>) => { skillBodyReads.byName += 1; return actual.getSkillByName(...args); }
    };
  });
  vi.doMock("../skills/discovery.js", async () => {
    const actual = await vi.importActual<typeof import("../skills/discovery.js")>("../skills/discovery.js");
    return {
      ...actual,
      readSkillDiscovery: (...args: Parameters<typeof actual.readSkillDiscovery>) => {
        skillBodyReads.listed += 1;
        return actual.readSkillDiscovery(...args);
      }
    };
  });
  const upstreamMethods: string[] = [];
  const started = await startProxy(async (req, res) => {
    const body = await readRequestBody(req);
    try { upstreamMethods.push(String((JSON.parse(body) as { method?: string }).method)); } catch { upstreamMethods.push("(unparsed)"); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: "b1",
      result: { protocolVersion: "2024-11-05", serverInfo: { name: "ktx", version: "0.12.0" }, capabilities: { tools: {} } }
    }));
  });
  return { ...started, upstreamMethods };
}

function expectContextAdoptionEn(text: string, contextRules: readonly string[]): void {
  for (const marker of CONTEXT_MARKERS) expect(text).toContain(marker);
  for (const phrase of CONTEXT_PHRASES_EN) expect(text).toContain(phrase);
  // 同源：整段规则原样出现（不是各自改写）。
  expect(text).toContain(contextRules.join("\n"));
}

function expectContextAdoptionZh(text: string): void {
  for (const marker of CONTEXT_MARKERS) expect(text).toContain(marker);
  for (const phrase of CONTEXT_PHRASES_ZH) expect(text).toContain(phrase);
}

/** 握手内不得有 Wiki／Skill 检索或正文读取：上游只见 initialize；审计只有 initialize；Skill 正文读取为 0。 */
async function expectNoHandshakeContextReads(
  requestId: string,
  upstreamMethods: readonly string[]
): Promise<void> {
  expect(upstreamMethods.every((method) => method === "initialize")).toBe(true);
  expect(skillBodyReads.byUri + skillBodyReads.byName).toBe(0);
  const row = await waitForAuditRow(requestId);
  expect(row.tool).toBe("initialize");
  const db = new Database(auditDbPath, { readonly: true });
  try {
    const wikiOrSkill = db.prepare(
      "SELECT COUNT(*) AS n FROM access_log WHERE tool LIKE 'wiki_%' OR tool LIKE 'lucy_skill_%'"
    ).get() as { n: number };
    expect(wikiOrSkill.n).toBe(0);
  } finally {
    db.close();
  }
}

/** 脱敏快照：只落指引文本，不含令牌。设置 LUCY_B1_SNAPSHOT_DIR 时写出。 */
async function saveB1Snapshot(name: string, text: string): Promise<void> {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(INTERNAL_TOKEN);
  const dir = process.env.LUCY_B1_SNAPSHOT_DIR;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${name}.txt`), `${text}\n`, "utf8");
}

describe("P1-77 B1 / SC-08：C1–C4／C6 同源注入到各指引分支", () => {
  beforeEach(async () => {
    await installRealInstructionsMd();
  });
  afterEach(() => {
    vi.doUnmock("../skills/loader.js");
    vi.doUnmock("../skills/discovery.js");
  });

  it("完整动态指引：含 C1–C4／C6、保留角色化名单与问询上报/预算逃生，无握手检索", async () => {
    const { upstream, server, proxyPort, upstreamMethods } = await startB1Proxy();
    try {
      const mcp = await import("../proxy/mcp-proxy");
      const text = await instructionsOf(await postInitialize(proxyPort, "b1-full"));
      expect(text).toContain("## Visible Scope");
      expect(text).toContain(SOURCE_LINE);
      expectContextAdoptionEn(text, mcp.CONTEXT_ADOPTION_RULE_LINES);
      // 保留既有：预算逃生、ASK_FIRST、可核对块。
      expect(text).toContain("question_budget_exhausted");
      expect(text).toContain("source_ambiguity_gate");
      expect(text).toContain("answer_verifiability");
      expect(skillBodyReads.listed).toBeGreaterThan(0); // 既有角色化 Skill 名单只列目录
      await expectNoHandshakeContextReads("b1-full", upstreamMethods);
      await saveB1Snapshot("full-dynamic", text);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("全空目录回退：发 md 事实源，含 C1–C4／C6，无握手检索", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      ACCESS_YAML.replace("dataforai.superstore_orders", "dataforai.no_such_table"),
      "utf8"
    );
    const { upstream, server, proxyPort, upstreamMethods } = await startB1Proxy();
    try {
      const text = await instructionsOf(await postInitialize(proxyPort, "b1-empty"));
      expect(text).toContain("Lucy 数据问答基础指导");
      expect(text).not.toContain("## Visible Scope");
      expect(text).not.toContain(SOURCE_LINE);
      expectContextAdoptionZh(text);
      await expectNoHandshakeContextReads("b1-empty", upstreamMethods);
      await saveB1Snapshot("basic-empty-catalog-md-fallback", text);
    } finally {
      await closeAll(upstream, server);
    }
  });

  it("动态截止：基础指引含 C1–C4／C6，且与完整指引同源", async () => {
    const { upstream, server, proxyPort, upstreamMethods } = await startB1Proxy();
    const mcp = await import("../proxy/mcp-proxy");
    try {
      mcp.instructionsDecisionTestHooks.deadlineMs = 200;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      mcp.instructionsDecisionTestHooks.beforeBuild = () => gate;
      const text = await instructionsOf(await postInitialize(proxyPort, "b1-deadline"));
      expect(text).toBe(mcp.buildBasicInstructions());
      expect(text).toContain("## Tool Discovery");
      expect(text).not.toContain(SOURCE_LINE);
      expect(text).not.toContain("## Governed Domain Skills");
      expectContextAdoptionEn(text, mcp.CONTEXT_ADOPTION_RULE_LINES);
      expect((await waitForAuditRow("b1-deadline")).error_detail).toBe("instructions_basic:deadline");
      release();
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);
      await expectNoHandshakeContextReads("b1-deadline", upstreamMethods);
      await saveB1Snapshot("basic-deadline", text);
    } finally {
      mcp.instructionsDecisionTestHooks.beforeBuild = undefined;
      mcp.instructionsDecisionTestHooks.deadlineMs = undefined;
      await closeAll(upstream, server);
    }
  });

  it("容量满：基础指引含 C1–C4／C6；合法主路径（lucy_catalog）仍成交，隐藏工具不泄露", async () => {
    const { upstream, server, proxyPort, upstreamMethods } = await startB1Proxy();
    const mcp = await import("../proxy/mcp-proxy");
    try {
      mcp.instructionsDecisionTestHooks.capacity = 0;
      const text = await instructionsOf(await postInitialize(proxyPort, "b1-cap"));
      expect(text).toBe(mcp.buildBasicInstructions());
      expect(text).not.toContain(SOURCE_LINE);
      expectContextAdoptionEn(text, mcp.CONTEXT_ADOPTION_RULE_LINES);
      expect((await waitForAuditRow("b1-cap")).error_detail).toBe("instructions_basic:capacity_full");
      // 访问策略未授权 wiki／Skill 工具：基础指引只讲方法，不带任何角色化名单。
      expect(text).not.toContain("Governed Domain Skills");
      expect(text).not.toContain("lucy-skill://");

      // 合法用户的既有主路径继续可用（C4）：降级握手之后 lucy_catalog 照常返回。
      const catalogRes = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "mcp-session-id": "b1-cap-session" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "b1-cap-catalog", method: "tools/call", params: { name: "lucy_catalog", arguments: {} } })
      });
      expect(catalogRes.status).toBe(200);
      expect(await catalogRes.text()).toContain("superstore_orders");

      await saveB1Snapshot("basic-capacity-full", text);
      // 握手本身：上游只见 initialize（catalog 调用是后续独立请求，不计入握手）。
      expect(upstreamMethods[0]).toBe("initialize");
      expect(skillBodyReads.byUri + skillBodyReads.byName).toBe(0);
    } finally {
      mcp.instructionsDecisionTestHooks.capacity = undefined;
      await closeAll(upstream, server);
    }
  });

  it("构建失败：基础指引含 C1–C4／C6，无握手检索", async () => {
    const { upstream, server, proxyPort, upstreamMethods } = await startB1Proxy();
    const mcp = await import("../proxy/mcp-proxy");
    try {
      mcp.instructionsDecisionTestHooks.beforeBuild = async () => { throw new Error("b1-build-failure"); };
      const text = await instructionsOf(await postInitialize(proxyPort, "b1-fail"));
      expect(text).toBe(mcp.buildBasicInstructions());
      expect(text).not.toContain(SOURCE_LINE);
      expectContextAdoptionEn(text, mcp.CONTEXT_ADOPTION_RULE_LINES);
      expect((await waitForAuditRow("b1-fail")).error_detail).toBe("instructions_basic:build_failed");
      await pollUntil(() => mcp.instructionsWorkActiveCount() === 0);
      await expectNoHandshakeContextReads("b1-fail", upstreamMethods);
      await saveB1Snapshot("basic-build-failed", text);
    } finally {
      mcp.instructionsDecisionTestHooks.beforeBuild = undefined;
      await closeAll(upstream, server);
    }
  });

  it("本地协议回退（上游握手不可用）：基础指引含 C1–C4／C6，无握手检索", async () => {
    skillBodyReads.byUri = 0;
    skillBodyReads.byName = 0;
    vi.doMock("../skills/loader.js", async () => {
      const actual = await vi.importActual<typeof import("../skills/loader.js")>("../skills/loader.js");
      return {
        ...actual,
        getSkillByUri: (...args: Parameters<typeof actual.getSkillByUri>) => { skillBodyReads.byUri += 1; return actual.getSkillByUri(...args); },
        getSkillByName: (...args: Parameters<typeof actual.getSkillByName>) => { skillBodyReads.byName += 1; return actual.getSkillByName(...args); }
      };
    });
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const deadPort = (dead.address() as AddressInfo).port;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    process.env.LUCY_PROXY_UPSTREAM_HOST = "127.0.0.1";
    process.env.LUCY_PROXY_UPSTREAM_PORT = String(deadPort);
    const mcp = await import("../proxy/mcp-proxy");
    const { server, host } = mcp.buildProxy();
    await new Promise<void>((resolve) => server.listen(0, host, resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const res = await postInitialize(port, "b1-local");
      expect(res.status).toBe(200);
      const body = await res.json() as { result: { instructions: string; serverInfo: { version: string } } };
      expect(body.result.serverInfo.version).toBe("local-fallback");
      const text = body.result.instructions;
      expect(text).toBe(mcp.buildBasicInstructions());
      expect(text).not.toContain(SOURCE_LINE);
      expectContextAdoptionEn(text, mcp.CONTEXT_ADOPTION_RULE_LINES);
      expect(String((await waitForAuditRow("b1-local")).error_detail)).toContain("upstream_unavailable");
      await expectNoHandshakeContextReads("b1-local", ["initialize"]);
      await saveB1Snapshot("basic-local-protocol-fallback", text);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("md 事实源与代码镜像使用同一组 C 标记；规则文本不含握手内读取指令", async () => {
    const mcp = await import("../proxy/mcp-proxy");
    const { readFile } = await import("node:fs/promises");
    const md = await readFile(new URL("../../config/data-qa-instructions.md", import.meta.url), "utf8");
    const code = mcp.CONTEXT_ADOPTION_RULE_LINES.join("\n");
    for (const marker of CONTEXT_MARKERS) {
      expect(md).toContain(marker);
      expect(code).toContain(marker);
    }
    // C5：不得出现把 Wiki／Skill 读取绑进握手的措辞。
    expect(code).not.toMatch(/at initialize|during initialize|during the handshake/i);
  });
});
