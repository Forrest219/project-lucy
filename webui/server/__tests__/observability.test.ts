import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousEvalDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-observability-"));
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousEvalDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousEvalDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousEvalDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/observability", () => {
  it("returns generic observability status without token or secret leakage", async () => {
    const { writeLog, writeAccessLogSources } = await import("../proxy/audit");
    const { getEvalDb, resetEvalDb } = await import("../eval/db");
    resetEvalDb();

    await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-only"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 20,
      requestId: "query-ok",
      roleIds: ["analytics_readonly"],
      queryOperation: "select",
      queryPreview: "select 1"
    });
    const deniedLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "secret-token-label",
      tokenHashPrefix: "sha256:deadbeef",
      tool: "lucy_query",
      tables: ["mart.private_snapshot"],
      outcome: "denied",
      durationMs: 50_000,
      requestId: "query-denied",
      roleIds: ["analytics_readonly"],
      decisionReason: "password=hunter2 token=abc123 secret=should-not-leak",
      queryOperation: "select",
      queryPreview: "select * from mart.private_snapshot where password=hunter2 and token=abc123"
    });
    await writeAccessLogSources(deniedLogId, new Date().toISOString(), "workhorse", "lucy_query", [{
      connectionId: "warehouse",
      schemaName: "mart",
      sourceName: "private_snapshot",
      physicalTable: "mart.private_snapshot",
      extractionMethod: "test",
      confidence: "high"
    }]);

    const db = await getEvalDb();
    db.prepare(`
      INSERT INTO eval_run (domain, started_at, finished_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases, pass_count, fail_count)
      VALUES ('business_smoke', ?, ?, 'succeeded', 'test', 'manual', 'http://localhost:7879/mcp', '{}', 4, 3, 1)
    `).run(new Date().toISOString(), new Date().toISOString());

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.data.traffic).toMatchObject({
        status: "ok",
        totalRequests: 3,
        businessCalls: 2,
        okCalls: 1
      });
      expect(res.body.data.error).toMatchObject({
        status: "no_data",
        errorCalls: 0
      });
      expect(res.body.data.denied).toMatchObject({
        status: "warn",
        deniedCalls: 1,
        deniedRate: 0.5
      });
      expect(res.body.data.latency).toMatchObject({
        status: "warn",
        slowCalls: 1,
        p95Ms: 50_000
      });
      expect(res.body.data.eval.latest).toMatchObject({
        domain: "business_smoke",
        totalCases: 4,
        passCount: 3,
        failCount: 1,
        passRate: 0.75
      });
      expect(res.body.data.storage).toMatchObject({
        status: "ok",
        audit: "ok",
        eval: "ok"
      });
      expect(res.body.data.audit).toMatchObject({
        status: "ok",
        usage: {
          tools: [{ tool: "lucy_query", calls: 2, denied: 1, errors: 0 }],
          roles: [{ roleId: "analytics_readonly", calls: 2, denied: 1 }]
        }
      });
      expect(res.body.data.audit.usage.tokens).toBeUndefined();

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("hunter2");
      expect(serialized).not.toContain("abc123");
      expect(serialized).not.toContain("should-not-leak");
      expect(serialized).not.toContain("secret-token-label");
      expect(serialized).not.toContain("sha256:deadbeef");
      expect(serialized).not.toMatch(/tokenHashPrefix|tokenLabel|password|secret/i);
      expect(serialized).toContain("[REDACTED]");
    } finally {
      await app.close();
    }
  });
});
