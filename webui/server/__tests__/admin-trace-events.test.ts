import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-trace-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

async function seedTraceEvents(): Promise<{ callTraceId: string; turnId: string }> {
  // Direct-write through better-sqlite3 so we don't have to spin up the
  // MCP proxy. The schema is created by the route handler via
  // getAuditDb → ensureTraceEvidenceSchema.
  const audit = await import("../admin/audit.js");
  const evidence = await import("../trace/evidence.js");
  const db = await audit.getAuditDb();
  evidence.ensureTraceEvidenceSchema(db);
  const callTraceId = "trace-admin-seed-1";
  const turnId = "turn-admin-seed-1";
  evidence.recordMcpToolsCall(db, {
    traceId: callTraceId,
    spanId: "span-call",
    actorId: "agent-1",
    toolName: "lucy_query",
    startedAt: "2026-08-03T00:00:00.000Z",
    endedAt: "2026-08-03T00:00:01.000Z",
    status: "denied",
    sessionId: "session-1",
    turnId,
    requestId: "req-1",
    policyDecision: {
      allowed: false,
      reason: "tool_not_allowed",
      toolName: "lucy_query",
      source: "access_policy",
      permissionSnapshotHash: "abcdef1234567890"
    }
  });
  evidence.recordMcpToolsCall(db, {
    traceId: "trace-admin-seed-2",
    spanId: "span-call-ok",
    actorId: "agent-1",
    toolName: "kx_catalog",
    startedAt: "2026-08-03T00:01:00.000Z",
    endedAt: "2026-08-03T00:01:01.000Z",
    status: "ok",
    turnId: "turn-admin-seed-2",
    requestId: "req-2",
    policyDecision: {
      allowed: true,
      toolName: "kx_catalog",
      source: "access_policy"
    }
  });
  return { callTraceId, turnId };
}

describe("GET /api/admin/trace/events", () => {
  it("prepares the production audit DB connection for trace writes", async () => {
    const audit = await import("../admin/audit.js");
    const db = await audit.getAuditDb();
    const busy = db.pragma("busy_timeout", { simple: true }) as number;
    const journal = String(db.pragma("journal_mode", { simple: true })).toLowerCase();
    const autoVacuum = String(db.pragma("auto_vacuum", { simple: true })).toLowerCase();
    expect(busy).toBe(5000);
    expect(journal).toBe("wal");
    expect(autoVacuum === "2" || autoVacuum === "incremental").toBe(true);
  });

  it("returns mcp_tools_call + policy_decision events for a known traceId", async () => {
    const { callTraceId } = await seedTraceEvents();
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get(`/api/admin/trace/events?traceId=${callTraceId}`)
      .expect(200);
    const body = res.body as { ok: boolean; data: { events: Array<{ spanType: string; status: string }>; evidence: Array<{ relation: string }> } };
    expect(body.ok).toBe(true);
    const spanTypes = body.data.events.map((event) => event.spanType).sort();
    expect(spanTypes).toEqual(["mcp_tools_call", "policy_decision"]);
    const denied = body.data.events.find((event) => event.status === "denied");
    expect(denied).toBeDefined();
    expect(body.data.evidence.some((ref) => ref.relation === "denied_by")).toBe(true);
    await app.close();
  });

  it("filters by turnId and returns events from multiple traces under the same turn", async () => {
    const { turnId } = await seedTraceEvents();
    // Seed an extra event under the same turnId.
    const audit = await import("../admin/audit.js");
    const evidence = await import("../trace/evidence.js");
    const db = await audit.getAuditDb();
    evidence.writeTraceEvent(db, {
      traceId: "trace-admin-seed-3",
      spanId: "span-extra",
      spanType: "policy_decision",
      actorKind: "system",
      actorId: null,
      status: "denied",
      startedAt: "2026-08-03T00:02:00.000Z",
      turnId
    });

    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get(`/api/admin/trace/events?turnId=${turnId}`)
      .expect(200);
    const body = res.body as { ok: boolean; data: { events: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.events.length).toBeGreaterThanOrEqual(3);
    await app.close();
  });

  it("requires traceId or turnId", async () => {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server).get("/api/admin/trace/events").expect(400);
    expect((res.body as { ok: boolean; error: string }).error).toMatch(/traceId or turnId/);
    await app.close();
  });

  it("returns an empty list when no events match", async () => {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/admin/trace/events?traceId=does-not-exist")
      .expect(200);
    const body = res.body as { ok: boolean; data: { events: unknown[]; evidence: unknown[] } };
    expect(body.ok).toBe(true);
    expect(body.data.events).toEqual([]);
    expect(body.data.evidence).toEqual([]);
    await app.close();
  });

  it("redacts sensitive metadata at write time so the API never leaks tokens or raw args", async () => {
    const audit = await import("../admin/audit.js");
    const evidence = await import("../trace/evidence.js");
    const db = await audit.getAuditDb();
    evidence.writeTraceEvent(db, {
      traceId: "trace-redact",
      spanId: "span-redact",
      spanType: "sql_plan",
      actorKind: "system",
      actorId: null,
      status: "ok",
      startedAt: "2026-08-03T00:00:00.000Z",
      metadata: {
        password: "hunter2",
        nested: { api_key: "k-123", safe: "kept" }
      }
    });

    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await request(app.server)
      .get("/api/admin/trace/events?traceId=trace-redact")
      .expect(200);
    const body = res.body as { ok: boolean; data: { events: Array<{ metadata: Record<string, unknown> }> } };
    const event = body.data.events[0];
    expect(event.metadata.password).toBe("[REDACTED]");
    const nested = event.metadata.nested as Record<string, unknown>;
    expect(nested.api_key).toBe("[REDACTED]");
    expect(nested.safe).toBe("kept");
    await app.close();
  });
});

// `Database` is imported only so the trace kernel can be opened at test
// setup time. We keep the binding to ensure better-sqlite3 stays available
// for `vi.resetModules()` to re-resolve cleanly across tests.
void Database;
