/**
 * T03c audit-trust 集成测试：
 * - GET /api/admin/audit/association-revisions 在 security store 不可用时 503
 * - GET /api/admin/audit/association-revisions 写入 audit_management security_events
 * - GET /api/admin/audit/:id/effective-association 在 security store 不可用时 503
 * - 解析不到 actor 时 401
 *
 * Strategy: set LUCY_AUDIT_DB to a temp file that mirrors the production
 * schema (access_log + association_revisions), build a real Fastify app that
 * calls `registerAuditRoutes`, and inject real HTTP verbs. The security store
 * failures are exercised by closing the security.sqlite file mid-test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initSecuritySchema } from "../../security/schema";
import Fastify, { type FastifyInstance } from "fastify";

let projectRoot: string;
let auditDbPath: string;
let securityDbPath: string;
let app: FastifyInstance | null = null;

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "audit-trust-t03c-"));
  auditDbPath = join(projectRoot, "audit.sqlite");
  securityDbPath = join(projectRoot, ".ktx-ui", "security.sqlite");

  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_PROJECT_ROOT = projectRoot;

  // Bootstrap audit DB schema (mirror production DDL subset).
  const dbAudit = new Database(auditDbPath);
  dbAudit.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      ts_date TEXT,
      token_hash_prefix TEXT,
      lucy_turn_id TEXT,
      association_status TEXT,
      turn_attribution_mode TEXT
    );
    CREATE TABLE association_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_turn_id TEXT NOT NULL,
      effective_turn_id TEXT,
      original_association_status TEXT,
      effective_association_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      reference_doc TEXT,
      attribution_rule_version TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      instance_id TEXT,
      instance_start_generation INTEGER,
      ts TEXT NOT NULL,
      classification_version TEXT NOT NULL,
      expected_revision TEXT,
      UNIQUE(original_turn_id, attribution_rule_version)
    );
  `);
  dbAudit.close();

  // Bootstrap security DB schema (mirror the production path: <root>/.ktx-ui/security.sqlite).
  mkdirSync(join(projectRoot, ".ktx-ui"), { recursive: true });
  // resolveProjectRoot requires ktx.yaml at the root.
  writeFileSync(join(projectRoot, "ktx.yaml"), "version: 1\n");
  const dbSec = new Database(securityDbPath);
  initSecuritySchema(dbSec);
  dbSec.close();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  // Reset the cached audit DB singleton so the next test picks up its
  // freshly-built path under LUCY_AUDIT_DB.
  try {
    const audit = await import("../../admin/audit");
    if (typeof (audit as any).resetAuditDbForTests === "function") {
      (audit as any).resetAuditDbForTests();
    }
  } catch {
    // best-effort
  }
  delete process.env.LUCY_AUDIT_DB;
  delete process.env.KTX_PROJECT_ROOT;
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

async function buildApp(actor: any = { admin: { id: "admin-1", account_uid: "uid-1", role: "admin" }, authMode: "required", session: null }): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorateRequest("lucyAdmin", null as any);
  fastify.addHook("onRequest", async (request) => {
    if (actor) {
      (request as any).lucyAdmin = actor;
    }
  });
  // Late import so LUCY_AUDIT_DB is read by getAuditDb.
  const { registerAuditRoutes } = await import("../../admin/audit");
  registerAuditRoutes(fastify);
  return fastify;
}

function seedAccessLog(opts: { turnId: string; status: string | null }): number {
  const db = new Database(auditDbPath);
  const info = db
    .prepare(
      `INSERT INTO access_log (ts, user_id, tool, ts_date, token_hash_prefix, lucy_turn_id, association_status, turn_attribution_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "2026-10-19T12:00:00Z",
      "u",
      "t",
      "2026-10-19",
      "h",
      opts.turnId,
      opts.status,
      "explicit"
    );
  db.close();
  return Number(info.lastInsertRowid);
}

function countSecurityAuditManagementRows(): number {
  const db = new Database(securityDbPath);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM security_events WHERE audit_event_kind = 'audit_management'`
    )
    .get() as { n: number };
  db.close();
  return row.n;
}

describe("T03c GET /api/admin/audit/association-revisions meta-audit", () => {
  it("returns 401 when actor is unresolved", async () => {
    app = await buildApp(null);
    const res = await app.inject({ method: "GET", url: "/api/admin/audit/association-revisions" });
    expect(res.statusCode).toBe(401);
  });

  it("writes a security_events audit_management entry on successful read", async () => {
    app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/admin/audit/association-revisions" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; data: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(countSecurityAuditManagementRows()).toBeGreaterThanOrEqual(1);
  });

  it("records actor and originalTurnId filter in the security event summary", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/association-revisions?originalTurnId=turn-Z"
    });
    expect(res.statusCode).toBe(200);
    const db = new Database(securityDbPath);
    const row = db
      .prepare(
        `SELECT actor, actor_type, operation_id, result_summary FROM security_events
         WHERE audit_event_kind = 'audit_management'`
      )
      .get() as { actor: string; actor_type: string; operation_id: string; result_summary: string };
    db.close();
    expect(row.actor).toBe("admin-1");
    expect(row.actor_type).toBe("ui_admin");
    expect(row.operation_id).toMatch(/^audit-list-association-revisions-/);
    expect(row.result_summary).toContain("filter=turn-Z");
  });
});

describe("T03c GET /api/admin/audit/:id/effective-association meta-audit", () => {
  it("returns 401 when actor is unresolved", async () => {
    const id = seedAccessLog({ turnId: "turn-X", status: "session_bound" });
    app = await buildApp(null);
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/audit/${id}/effective-association`
    });
    expect(res.statusCode).toBe(401);
  });

  it("writes a security_events audit_management entry on successful detail read", async () => {
    const id = seedAccessLog({ turnId: "turn-Y", status: "confirmed" });
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/audit/${id}/effective-association`
    });
    expect(res.statusCode).toBe(200);
    expect(countSecurityAuditManagementRows()).toBeGreaterThanOrEqual(1);
    const db = new Database(securityDbPath);
    const row = db
      .prepare(
        `SELECT operation_id, result_summary FROM security_events WHERE audit_event_kind = 'audit_management'`
      )
      .get() as { operation_id: string; result_summary: string };
    db.close();
    expect(row.operation_id).toContain(`audit-effective-association-${id}`);
    expect(row.result_summary).toContain(`access_log_id=${id}`);
  });

  it("returns 404 for unknown access_log id", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/99999/effective-association"
    });
    expect(res.statusCode).toBe(404);
  });
});