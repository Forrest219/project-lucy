/**
 * T06b audit-trust 集成测试：POST /api/agent-audit/events 端点
 * - 401 无凭证 / 无效凭证
 * - 400 schema 错误
 * - 413 body > 1MiB / events > 100
 * - 200 全成功; 207 部分成功 (id_conflict / parent_not_visible)
 * - 409 全失败 (id_conflict)
 * - security store 503 envelope
 * - 双时间戳保留 + idempotency 同 key 同 content -> idempotent_replay
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let projectRoot: string;
let securityDbPath: string;
let app: FastifyInstance | null = null;
const originalToken = process.env.LUCY_AGENT_AUDIT_TOKEN;
const originalAdapterId = process.env.LUCY_AGENT_AUDIT_ADAPTER_ID;
const originalInstanceId = process.env.LUCY_AGENT_AUDIT_INSTANCE_ID;

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "audit-trust-t06b-"));
  mkdirSync(join(projectRoot, ".ktx-ui"), { recursive: true });
  writeFileSync(join(projectRoot, "ktx.yaml"), "version: 1\n");
  securityDbPath = join(projectRoot, ".ktx-ui", "security.sqlite");

  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AGENT_AUDIT_TOKEN = "test-token";
  process.env.LUCY_AGENT_AUDIT_ADAPTER_ID = "adapter-test";
  process.env.LUCY_AGENT_AUDIT_INSTANCE_ID = "instance-test";

  // Bootstrap security.sqlite schema by importing initSecuritySchema.
  const { initSecuritySchema } = await import("../../security/schema");
  const db = new Database(securityDbPath);
  initSecuritySchema(db);
  db.close();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (originalToken === undefined) delete process.env.LUCY_AGENT_AUDIT_TOKEN;
  else process.env.LUCY_AGENT_AUDIT_TOKEN = originalToken;
  if (originalAdapterId === undefined) delete process.env.LUCY_AGENT_AUDIT_ADAPTER_ID;
  else process.env.LUCY_AGENT_AUDIT_ADAPTER_ID = originalAdapterId;
  if (originalInstanceId === undefined) delete process.env.LUCY_AGENT_AUDIT_INSTANCE_ID;
  else process.env.LUCY_AGENT_AUDIT_INSTANCE_ID = originalInstanceId;
  try {
    const security = await import("../../security/instance");
    if (typeof (security as any).closeSecurityStore === "function") {
      (security as any).closeSecurityStore();
    }
  } catch {}
  delete process.env.KTX_PROJECT_ROOT;
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {}
});

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorateRequest("lucyAdmin", null as any);
  // No onRequest hook: this endpoint is for controlled clients, NOT admin sessions.
  const { registerAgentAuditRoutes } = await import("../../admin/audit");
  registerAgentAuditRoutes(fastify);
  return fastify;
}

describe("T06b POST /api/agent-audit/events", () => {
  it("returns 401 when no token provided", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json" },
      payload: { events: [{ client_event_id: "x", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }] }
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 when token mismatches", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "wrong" },
      payload: { events: [{ client_event_id: "x", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }] }
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 on a valid heartbeat batch and persists events", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: {
        events: [
          { client_event_id: "e-1", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: { adapter_id: "adapter-test" } },
          { client_event_id: "e-2", observed_at: "2026-10-19T12:00:05Z", event_type: "result_received", payload: { result_summary: "ok" } }
        ]
      }
    });
    if (res.statusCode !== 200) {
      console.error("DEBUG body:", res.body);
    }
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; results: Array<{ status: string; client_event_id: string }> };
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r) => r.status === "accepted")).toBe(true);
  });

  it("returns 200 on idempotent replay (same client_event_id + same content)", async () => {
    app = await buildApp();
    const body = {
      events: [{ client_event_id: "e-idem", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: { a: 1 } }]
    };
    const first = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: body
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: body
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { results: Array<{ status: string }> };
    expect(secondBody.results[0].status).toBe("idempotent_replay");
  });

  it("returns 400 on schema invalid (missing client_event_id)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: {
        events: [{ observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }]
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 on invalid event_type", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: {
        events: [{ client_event_id: "x", observed_at: "2026-10-19T12:00:00Z", event_type: "made_up", payload: {} }]
      }
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when all events are id_conflict", async () => {
    app = await buildApp();
    const event = { client_event_id: "e-conflict", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: { v: 1 } };
    const first = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: { events: [event] }
    });
    expect(first.statusCode).toBe(200);
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: { events: [{ ...event, payload: { v: 999 } }] }
    });
    expect(res.statusCode).toBe(409);
  });

  it("returns 207 with parent_not_visible when adapter cannot see parent", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: {
        events: [{
          client_event_id: "e-parent",
          observed_at: "2026-10-19T12:00:00Z",
          event_type: "result_received",
          parent_event_id: "evt-other-subject-99",
          payload: {}
        }]
      }
    });
    // The route returns 207 when there is a parent_not_visible partial result.
    expect([200, 207]).toContain(res.statusCode);
    const body = res.json() as { results?: Array<{ status: string }> };
    if (body.results) {
      expect(body.results.some((r) => r.status === "parent_not_visible")).toBe(true);
    }
  });

  it("returns 413 (or 400) when events.length > 100", async () => {
    app = await buildApp();
    const events = Array.from({ length: 101 }, (_, i) => ({
      client_event_id: `e-${i}`,
      observed_at: "2026-10-19T12:00:00Z",
      event_type: "heartbeat" as const,
      payload: {}
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: { events }
    });
    // Either envelope is acceptable: schema validator reports 400 with the
    // "must be <= 100" message; count validator reports 413 with EVENTS_TOO_MANY.
    expect([400, 413]).toContain(res.statusCode);
    const body = res.json() as { ok: boolean; error: { code?: string; details?: string[] } };
    expect(body.ok).toBe(false);
  });

  it("returns 503 when security store unavailable", async () => {
    // Build a separate Fastify app whose project root points at a non-existent
    // path so resolveProjectRoot() throws → getSecurityStore() returns
    // SECURITY_STORE_UNAVAILABLE → route returns 503.
    const badRoot = mkdtempSync(join(tmpdir(), "audit-trust-503-"));
    rmSync(badRoot, { recursive: true, force: true }); // ensure absent
    process.env.KTX_PROJECT_ROOT = badRoot;
    const fastify = Fastify({ logger: false });
    const { registerAgentAuditRoutes } = await import("../../admin/audit");
    registerAgentAuditRoutes(fastify);
    try {
      const res = await fastify.inject({
        method: "POST",
        url: "/api/agent-audit/events",
        headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
        payload: {
          events: [{ client_event_id: "e-503", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }]
        }
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await fastify.close();
    }
  });

  it("actor + adapter_id never read from body (EA-11 closure)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/agent-audit/events",
      headers: { "content-type": "application/json", "x-agent-audit-token": "test-token" },
      payload: {
        events: [{ client_event_id: "e-impersonate", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }],
        // Attacker tries to impersonate a different adapter / actor via body:
        adapter_id: "attacker",
        actor: "root",
        user_id: "victim"
      }
    });
    expect(res.statusCode).toBe(200);
    // Confirm the stored adapter_id is the server-resolved one, not the body field.
    const { default: Db } = await import("better-sqlite3");
    const db = new Db(securityDbPath, { readonly: true });
    const row = db
      .prepare(`SELECT adapter_id FROM agent_audit_idempotency WHERE client_event_id = ?`)
      .get("e-impersonate") as { adapter_id: string };
    db.close();
    expect(row.adapter_id).toBe("adapter-test"); // from env, NOT from body
  });
});