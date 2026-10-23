/**
 * T04b audit-trust 集成测试：
 * - /api/admin/audit/v2/export-metadata 返回 audit-csv-field-metadata/v2 schema
 * - v2 列集合 ⊃ v1 (新列: event_type / transport_sub_type / 4 轴状态 /
 *   association_status / original_turn_id / effective_turn_id / attempt_id /
 *   parent_attempt_id / instance_id / classification_version / digest_value /
 *   digest_version / credential_principal_id / actor_id / actor_type)
 * - v1 端点 schema 保持 v1 (不引入 v2 列)
 * - 错误 kind -> 400
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

let projectRoot: string;
let auditDbPath: string;
let securityDbPath: string;
let app: FastifyInstance | null = null;

beforeEach(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), "audit-trust-t04b-"));
  auditDbPath = join(projectRoot, "audit.sqlite");
  securityDbPath = join(projectRoot, ".ktx-ui", "security.sqlite");

  process.env.LUCY_AUDIT_DB = auditDbPath;
  process.env.KTX_PROJECT_ROOT = projectRoot;

  mkdirSync(join(projectRoot, ".ktx-ui"), { recursive: true });
  writeFileSync(join(projectRoot, "ktx.yaml"), "version: 1\n");

  // Bootstrap audit db with the columns that v2 export expects (additive ensureColumn).
  const db = new Database(auditDbPath);
  db.exec(`CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL, tool TEXT NOT NULL)`);
  db.close();

  // Bootstrap security schema.
  const { initSecuritySchema } = await import("../../security/schema");
  const dbSec = new Database(securityDbPath);
  initSecuritySchema(dbSec);
  dbSec.close();
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  try {
    const audit = await import("../../admin/audit");
    if (typeof (audit as any).resetAuditDbForTests === "function") {
      (audit as any).resetAuditDbForTests();
    }
  } catch {}
  delete process.env.LUCY_AUDIT_DB;
  delete process.env.KTX_PROJECT_ROOT;
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {}
});

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: false });
  fastify.decorateRequest("lucyAdmin", null as any);
  fastify.addHook("onRequest", async (request) => {
    (request as any).lucyAdmin = {
      admin: { id: "admin-1", account_uid: "uid-1", role: "admin" },
      authMode: "required",
      session: null
    };
  });
  const { registerAuditRoutes } = await import("../../admin/audit");
  registerAuditRoutes(fastify);
  return fastify;
}

describe("T04b GET /api/admin/audit/v2/export-metadata", () => {
  it("returns audit-csv-field-metadata/v2 with classification_version field", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/v2/export-metadata?kind=calls"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: string;
      kind: string;
      fields: Array<{ name: string; label: string; format: string; description: string }>;
      classificationVersion: string;
    };
    expect(body.schemaVersion).toBe("audit-csv-field-metadata/v2");
    expect(body.kind).toBe("calls");
    expect(body.classificationVersion).toBe("audit-trust-2026-10-19-r1.v1");
    const fieldNames = body.fields.map((f) => f.name);
    // New v2 columns present
    for (const col of [
      "event_type",
      "transport_sub_type",
      "transport_status",
      "authorization_status",
      "execution_status",
      "usability_status",
      "association_status",
      "original_turn_id",
      "effective_turn_id",
      "attempt_id",
      "parent_attempt_id",
      "instance_id",
      "classification_version",
      "digest_value",
      "digest_version",
      "credential_principal_id",
      "actor_id",
      "actor_type"
    ]) {
      expect(fieldNames).toContain(col);
    }
    // v1 columns preserved
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("ts");
    expect(fieldNames).toContain("tool");
    expect(fieldNames).toContain("outcome");
  });

  it("v1 export-metadata endpoint keeps v1 schemaVersion and does NOT include v2-only columns", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/export-metadata?kind=calls"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      schemaVersion: string;
      fields: Array<{ name: string }>;
    };
    expect(body.schemaVersion).toBe("audit-csv-field-metadata/v1");
    const fieldNames = body.fields.map((f) => f.name);
    // v1 must NOT carry v2-only columns
    expect(fieldNames).not.toContain("event_type");
    expect(fieldNames).not.toContain("association_status");
    expect(fieldNames).not.toContain("instance_id");
    // v1 columns preserved
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("tool");
  });

  it("returns 400 for invalid kind", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/v2/export-metadata?kind=invalid"
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("ERR_INVALID_AUDIT_METADATA_KIND");
  });

  it("kind = turns returns v2 schema for turns (v2 turns not extended yet but endpoint exists)", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/v2/export-metadata?kind=turns"
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { schemaVersion: string; kind: string };
    expect(body.schemaVersion).toBe("audit-csv-field-metadata/v2");
    expect(body.kind).toBe("turns");
  });

  it("v2 field metadata for new columns has label/format/description/trigger", async () => {
    app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/audit/v2/export-metadata?kind=calls"
    });
    const body = res.json() as {
      fields: Array<{ name: string; label: string; format: string; description: string; trigger?: string }>;
    };
    const eventTypeMeta = body.fields.find((f) => f.name === "event_type");
    expect(eventTypeMeta).toBeDefined();
    expect(eventTypeMeta!.label).toContain("事件类型");
    expect(eventTypeMeta!.format).toContain("tool_call");
    expect(eventTypeMeta!.description.length).toBeGreaterThan(20);
  });
});