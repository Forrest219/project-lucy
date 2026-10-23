import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http, { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T07-1 / T07-2 — Spec §5.1 release barrier.
 * Canary text must never reach the client unless request_admitted and
 * response_prepared are durable; streams are buffered with explicit limits.
 */

const TOKEN = "release-barrier-token";
const INTERNAL_TOKEN = "release-barrier-internal";
const CANARY = "CANARY-7f3a-must-not-leak";

function tokenHash(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

const ACCESS_YAML = `users:
  - id: barrier_agent
    name: Barrier Agent
    enabled: true
    tokens:
      - hash: "${tokenHash(TOKEN)}"
        label: barrier-token
        created: 2026-10-18
    allow:
      connections:
        - mysql-aliyun
      tables:
        - dataforai.superstore_orders
      tools:
        - lucy_read_source
        - lucy_catalog
defaults:
  deny_tools: []
`;

const SCHEMA_YAML = `tables:
  superstore_orders:
    table: dataforai.superstore_orders
`;

let projectRoot: string;
let securityDbPath: string;
const saved: Record<string, string | undefined> = {};
const openServers: Server[] = [];

function setEnv(key: string, value: string): void {
  if (!(key in saved)) saved[key] = process.env[key];
  process.env[key] = value;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function securityRows(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
  const db = new Database(securityDbPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

const phasesOf = () => securityRows("SELECT phase FROM security_events ORDER BY seq").map((row) => String(row.phase));

async function until<T>(probe: () => T | undefined | false, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function listen(server: Server, host = "127.0.0.1"): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  openServers.push(server);
  return (server.address() as AddressInfo).port;
}

type Upstream = { port: number; calls: string[]; admittedAtCall: boolean[]; server: Server };

async function startUpstream(handler: (body: string, res: http.ServerResponse) => void): Promise<Upstream> {
  const calls: string[] = [];
  const admittedAtCall: boolean[] = [];
  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    calls.push(body);
    // Invariant under test: the ledger already holds request_admitted when upstream work starts.
    admittedAtCall.push(phasesOf().includes("request_admitted"));
    handler(body, res);
  });
  const port = await listen(server);
  setEnv("LUCY_PROXY_UPSTREAM_HOST", "127.0.0.1");
  setEnv("LUCY_PROXY_UPSTREAM_PORT", String(port));
  return { port, calls, admittedAtCall, server };
}

const canaryJson = (id: unknown) =>
  JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: CANARY }] } });

function answerJson(body: string, res: http.ServerResponse): void {
  const parsed = JSON.parse(body || "{}") as { id?: unknown };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(canaryJson(parsed.id));
}

async function startProxy(options: Record<string, unknown> = {}): Promise<number> {
  const { buildProxy } = await import("../proxy/mcp-proxy");
  const { server, host } = buildProxy(options);
  return listen(server, host);
}

type Probe = { status: number; body: string; headers: http.IncomingHttpHeaders };

function post(port: number, rpc: Record<string, unknown>): Promise<Probe> {
  return request(port, "POST", JSON.stringify(rpc));
}

function request(port: number, method: string, payload?: string): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method,
        headers: {
          authorization: `Bearer ${TOKEN}`,
          accept: "application/json, text/event-stream",
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const readSource = (id: string) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name: "lucy_read_source", arguments: { connectionId: "mysql-aliyun", sourceName: "superstore_orders" } }
});

/** Makes the next INSERT of a phase fail while the schema stays valid ("schema ok, real INSERT fails"). */
function failInsertsOf(phase: string): void {
  const db = new Database(securityDbPath);
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS test_fail_${phase} BEFORE INSERT ON security_events
      WHEN NEW.phase = '${phase}'
      BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;
    `);
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-audit-barrier-"));
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), ACCESS_YAML, "utf8");
  await writeFile(
    path.join(projectRoot, "semantic-layer", "mysql-aliyun", "_schema", "dataforai.yaml"),
    SCHEMA_YAML,
    "utf8"
  );
  setEnv("KTX_PROJECT_ROOT", projectRoot);
  setEnv("LUCY_CONTENT_ROOT", ".");
  setEnv("LUCY_AUDIT_DB", path.join(projectRoot, "audit.sqlite"));
  setEnv("KTX_INTERNAL_TOKEN", INTERNAL_TOKEN);
  securityDbPath = path.join(projectRoot, ".ktx-ui", "security.sqlite");
  // Open (and create) the security store the proxy will use.
  const { getSecurityStore } = await import("../security/instance");
  const store = await getSecurityStore();
  if (!store.ok) throw new Error(store.message);
});

afterEach(async () => {
  const { closeSecurityStore } = await import("../security/instance");
  while (openServers.length) {
    const server = openServers.pop()!;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  closeSecurityStore();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
  await rm(projectRoot, { recursive: true, force: true });
});

describe("T07-1 — non-streaming JSON: admitted → prepared → send", () => {
  it("writes request_admitted before upstream work and response_prepared before the first byte", async () => {
    const upstream = await startUpstream(answerJson);
    const port = await startProxy();

    let preparedWhenFirstByteArrived = false;
    const probe = await new Promise<Probe>((resolve, reject) => {
      const payload = JSON.stringify(readSource("t07-1-order"));
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            accept: "application/json",
            "content-length": Buffer.byteLength(payload)
          }
        },
        (res) => {
          preparedWhenFirstByteArrived = phasesOf().includes("response_prepared");
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        }
      );
      req.on("error", reject);
      req.end(payload);
    });

    expect(probe.status).toBe(200);
    expect(probe.body).toContain(CANARY);
    expect(upstream.admittedAtCall).toEqual([true]);
    expect(preparedWhenFirstByteArrived).toBe(true);

    await until(() => phasesOf().includes("response_delivered"));
    expect(phasesOf()).toEqual(["request_admitted", "response_prepared", "response_delivered"]);

    const events = securityRows("SELECT * FROM security_events ORDER BY seq");
    const prepared = events.find((event) => event.phase === "response_prepared")!;
    const summary = JSON.parse(String(prepared.result_summary)) as Record<string, unknown>;
    expect(summary).toMatchObject({
      method: "tools/call",
      tool: "lucy_read_source",
      status: 200,
      bytes: Buffer.byteLength(probe.body),
      sha256: createHash("sha256").update(probe.body).digest("hex")
    });
    // Operator identity comes from the verified Token, not the request.
    expect(events.every((event) => event.actor === "barrier_agent" && event.actor_type === "agent")).toBe(true);
    expect(new Set(events.map((event) => event.operation_id)).size).toBe(1);
    expect(JSON.stringify(events)).not.toContain(CANARY);
  });

  it.each([
    ["tools/call", readSource("t07-1-fail-tool")],
    ["ping", { jsonrpc: "2.0", id: "t07-1-fail-ping", method: "ping" }],
    ["resources/list", { jsonrpc: "2.0", id: "t07-1-fail-res", method: "resources/list" }],
    ["prompts/list", { jsonrpc: "2.0", id: "t07-1-fail-prompts", method: "prompts/list" }]
  ])("returns 503 AUDIT_UNAVAILABLE and no canary when response_prepared cannot be written (%s)", async (_label, rpc) => {
    await startUpstream(answerJson);
    const port = await startProxy();
    failInsertsOf("response_prepared");

    const probe = await post(port, rpc);

    expect(probe.status).toBe(503);
    expect(JSON.parse(probe.body)).toMatchObject({ error: { data: { code: "AUDIT_UNAVAILABLE" } } });
    expect(probe.body).not.toContain(CANARY);
    expect(probe.headers["cache-control"]).toBe("no-store");
    // A failed prepare is closed as failed — never as delivered.
    await until(() => phasesOf().includes("response_failed"));
    expect(phasesOf()).not.toContain("response_prepared");
    expect(phasesOf()).not.toContain("response_delivered");
  });

  it("returns 503 without running the handler when request_admitted cannot be written", async () => {
    const upstream = await startUpstream(answerJson);
    const port = await startProxy();
    failInsertsOf("request_admitted");

    const probe = await post(port, readSource("t07-1-no-admit"));

    expect(probe.status).toBe(503);
    expect(JSON.parse(probe.body)).toMatchObject({ error: { data: { code: "AUDIT_UNAVAILABLE" } } });
    expect(probe.body).not.toContain(CANARY);
    expect(upstream.calls).toHaveLength(0);
    expect(phasesOf()).toEqual([]);
  });

  it("returns 503 when the security store itself is unavailable (no fallback to unaudited success)", async () => {
    const upstream = await startUpstream(answerJson);
    const { ReleaseLedger } = await import("../security/ledger");
    const ledger = new ReleaseLedger(async () => ({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "readonly",
      message: "disk is read-only"
    }));
    const port = await startProxy({ ledger });

    const probe = await post(port, readSource("t07-1-store-down"));

    expect(probe.status).toBe(503);
    expect(probe.body).not.toContain(CANARY);
    expect(probe.body).not.toContain("disk is read-only");
    expect(upstream.calls).toHaveLength(0);

    const { readAuditWriteHealth } = await import("../proxy/audit-write-health");
    expect(readAuditWriteHealth().ledger.state).toBe("unavailable");
  });

  it("does not release content for a request revoked while upstream work is in flight", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await startUpstream((body, res) => {
      void held.then(() => answerJson(body, res));
    });
    const port = await startProxy();

    const pending = post(port, readSource("t07-1-revoked"));
    await until(() => phasesOf().includes("request_admitted"));
    const { narrowAuthorization } = await import("../proxy/authorization-barrier");
    await narrowAuthorization({ kind: "all" });
    release();
    const probe = await pending;

    expect(probe.status).toBe(403);
    expect(probe.body).not.toContain(CANARY);
    await until(() => phasesOf().includes("response_failed"));
    expect(phasesOf()).not.toContain("response_prepared");
  });

  it("records a failed terminal event, not delivered, when the client disconnects before the response", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await startUpstream((body, res) => {
      void held.then(() => answerJson(body, res));
    });
    const port = await startProxy();

    const payload = JSON.stringify(readSource("t07-1-abort"));
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/mcp",
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    });
    req.on("error", () => undefined);
    req.end(payload);
    await until(() => phasesOf().includes("request_admitted"));
    req.destroy();
    await until(() => phasesOf().includes("response_failed"));
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(phasesOf()).not.toContain("response_delivered");
    expect(securityRows("SELECT verdict FROM security_events WHERE phase = 'response_failed'")[0]?.verdict).toBe(
      "client_closed"
    );
  });
});

describe("T07-2 — SSE: bounded buffer, explicit failure, crash recovery", () => {
  const sseChunk = (text: string) => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", result: { text } })}\n\n`;

  it("delivers a streamed SSE response only after it is fully buffered and prepared", async () => {
    let finishStream!: () => void;
    const gate = new Promise<void>((resolve) => (finishStream = resolve));
    await startUpstream((_body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseChunk(CANARY));
      void gate.then(() => {
        res.write(sseChunk("tail"));
        res.end();
      });
    });
    const port = await startProxy();

    let firstByteAt = 0;
    const pending = new Promise<Probe>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "GET",
          headers: { authorization: `Bearer ${TOKEN}`, accept: "text/event-stream" }
        },
        (res) => {
          firstByteAt = Date.now();
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
        }
      );
      req.on("error", reject);
      req.end();
    });

    await until(() => phasesOf().includes("request_admitted"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(firstByteAt).toBe(0); // nothing leaked while the stream is still open
    expect(phasesOf()).not.toContain("response_prepared");

    finishStream();
    const probe = await pending;
    expect(probe.status).toBe(200);
    expect(String(probe.headers["content-type"])).toContain("text/event-stream");
    expect(probe.body).toContain(CANARY);
    expect(probe.body).toContain("tail");
    await until(() => phasesOf().includes("response_delivered"));
    expect(phasesOf()).toEqual(["request_admitted", "response_prepared", "response_delivered"]);
  });

  it("accepts a body of exactly the limit and rejects one byte more with RESPONSE_TOO_LARGE", async () => {
    const limit = 600;
    const exact = "x".repeat(limit);
    let mode: "exact" | "over" = "exact";
    await startUpstream((_body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(mode === "exact" ? exact : exact + CANARY);
      res.end();
    });
    const port = await startProxy({ responseCommit: { maxBufferBytes: limit, wallClockMs: 5000 } });

    const ok = await request(port, "GET");
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(limit);

    mode = "over";
    const tooLarge = await request(port, "GET");
    expect(tooLarge.status).toBe(502);
    expect(JSON.parse(tooLarge.body)).toMatchObject({ error: { data: { code: "RESPONSE_TOO_LARGE" } } });
    expect(tooLarge.body).not.toContain(CANARY);
    expect(tooLarge.body).not.toContain("xxxx");

    await until(() => phasesOf().filter((phase) => phase === "response_failed").length === 1);
    expect(securityRows("SELECT verdict FROM security_events WHERE phase = 'response_failed'")[0]?.verdict).toBe(
      "response_too_large"
    );
    // The oversize operation never reached response_prepared.
    expect(phasesOf().filter((phase) => phase === "response_prepared")).toHaveLength(1);
  });

  it("fails explicitly with RESPONSE_TIMEOUT and discards partial content when the stream never ends", async () => {
    await startUpstream((_body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sseChunk(CANARY)); // never ended
    });
    const port = await startProxy({ responseCommit: { maxBufferBytes: 1024 * 1024, wallClockMs: 120 } });

    const probe = await request(port, "GET");

    expect(probe.status).toBe(504);
    expect(JSON.parse(probe.body)).toMatchObject({ error: { data: { code: "RESPONSE_TIMEOUT" } } });
    expect(probe.body).not.toContain(CANARY);
    await until(() => phasesOf().includes("response_failed"));
    expect(phasesOf()).not.toContain("response_prepared");
  });

  it("only tightens the buffer limit from the environment, never loosens it", async () => {
    const { resolveResponseCommitConfig, DEFAULT_RESPONSE_BUFFER_MAX_BYTES } = await import("../security/response-commit");
    expect(resolveResponseCommitConfig({}).maxBufferBytes).toBe(8 * 1024 * 1024);
    expect(DEFAULT_RESPONSE_BUFFER_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(resolveResponseCommitConfig({ LUCY_RESPONSE_BUFFER_MAX_BYTES: "1024" }).maxBufferBytes).toBe(1024);
    expect(resolveResponseCommitConfig({ LUCY_RESPONSE_BUFFER_MAX_BYTES: String(64 * 1024 * 1024) }).maxBufferBytes).toBe(
      8 * 1024 * 1024
    );
    expect(resolveResponseCommitConfig({ LUCY_RESPONSE_BUFFER_MAX_BYTES: "junk" }).maxBufferBytes).toBe(8 * 1024 * 1024);
  });

  it("marks operations left open by a crash as interrupted and never invents delivered", async () => {
    const { getSecurityStore } = await import("../security/instance");
    const { recoverInterruptedOperations } = await import("../security/ledger");
    const store = await getSecurityStore();
    if (!store.ok) throw new Error(store.message);
    const append = (operationId: string, phase: "request_admitted" | "response_prepared" | "response_delivered") => {
      const result = store.value.appendEvent({
        eventId: `${operationId}:${phase}`,
        operationId,
        phase,
        actor: "barrier_agent",
        actorType: "agent"
      });
      if (!result.ok) throw new Error(result.message);
    };
    append("op-before-prepare", "request_admitted"); // crash before prepare
    append("op-prepared", "request_admitted");
    append("op-prepared", "response_prepared"); // crash after prepare, before/while sending
    append("op-done", "request_admitted");
    append("op-done", "response_prepared");
    append("op-done", "response_delivered");

    const first = await recoverInterruptedOperations(store.value);
    expect(first).toMatchObject({
      ok: true,
      value: { interrupted: ["op-before-prepare", "op-prepared"], preparedUnconfirmed: ["op-prepared"] }
    });
    const verdicts = Object.fromEntries(
      securityRows("SELECT operation_id, verdict FROM security_events WHERE phase = 'interrupted'").map((row) => [
        String(row.operation_id),
        String(row.verdict)
      ])
    );
    expect(verdicts).toEqual({ "op-before-prepare": "before_prepare", "op-prepared": "prepared_unconfirmed" });
    expect(
      securityRows("SELECT operation_id FROM security_events WHERE phase = 'response_delivered'").map((row) => row.operation_id)
    ).toEqual(["op-done"]);

    // Idempotent: a second boot finds nothing open.
    expect(await recoverInterruptedOperations(store.value)).toMatchObject({ ok: true, value: { interrupted: [] } });
  });
});
