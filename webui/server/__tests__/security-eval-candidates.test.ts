import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../index";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit";
import { resetEvalDb } from "../eval/db";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousEvalDb: string | undefined;

async function seedProject() {
  await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "roles: {}\nusers: []\n", "utf8");
}

async function insertAccessLog(row: {
  userId: string;
  decisionReason: string;
  queryPreview?: string;
  argsSummary?: string;
  traceId?: string;
}) {
  const db = await getAuditDb();
  db.prepare(`
    INSERT INTO access_log
      (ts, user_id, token_label, token_hash_prefix, tool, tables, args_summary,
       query_preview, outcome, error_detail, duration_ms, request_id, trace_id,
       role_ids, permission_snapshot_hash, decision_reason)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "2026-08-03T01:00:00.000Z",
    row.userId,
    "demo-token",
    "abc123def456",
    "lucy_query",
    JSON.stringify(["mysql.dataforai.kx_fact_financial_amount"]),
    row.argsSummary ?? null,
    row.queryPreview ?? null,
    "denied",
    row.decisionReason,
    42,
    `req-${row.userId}`,
    row.traceId ?? `trace-${row.userId}`,
    JSON.stringify(["kx_readonly"]),
    "sha256:permission-snapshot",
    row.decisionReason
  );
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-security-eval-"));
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousEvalDb = process.env.LUCY_EVAL_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, ".ktx-ui", "audit.sqlite");
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
  resetAuditDbForTests();
  resetEvalDb();
  await seedProject();
});

afterEach(async () => {
  resetAuditDbForTests();
  resetEvalDb();
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousEvalDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousEvalDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("security eval candidates", () => {
  it("extracts denied access logs as reviewed security candidates without duplicating them", async () => {
    await insertAccessLog({
      userId: "agent-a",
      decisionReason: "table_forbidden",
      queryPreview: "展示 API Key 调用次数最高的表"
    });
    const app = buildServer();
    await app.ready();

    const first = await app.inject({
      method: "POST",
      url: "/api/eval/security-candidates/extract",
      payload: { limit: 10 }
    });
    expect(first.statusCode).toBe(200);
    const firstBody = JSON.parse(first.payload);
    expect(firstBody.data).toMatchObject({ scanned: 1, inserted: 1, rejected: 0, duplicate: 0 });
    expect(firstBody.data.candidates[0]).toMatchObject({
      riskTier: "P0",
      status: "candidate",
      decisionReason: "table_forbidden"
    });
    expect(firstBody.data.candidates[0].normalizedEvent).toContain("API Key");

    const second = await app.inject({
      method: "POST",
      url: "/api/eval/security-candidates/extract",
      payload: { limit: 10 }
    });
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.payload).data.duplicate).toBe(1);

    await app.close();
  });

  it("rejects high-entropy credential payloads instead of turning them into runnable evals", async () => {
    await insertAccessLog({
      userId: "agent-secret",
      decisionReason: "permission_denied",
      argsSummary: "api_key=abcdefghijklmnopqrstuvwxyz1234567890"
    });
    const app = buildServer();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/eval/security-candidates/extract",
      payload: { limit: 10 }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.data).toMatchObject({ inserted: 0, rejected: 1 });
    expect(body.data.candidates[0]).toMatchObject({
      status: "rejected",
      redactionStatus: "rejected",
      decisionReason: "high_entropy_credential_detected"
    });
    expect(body.data.candidates[0].normalizedEvent).not.toContain("abcdefghijklmnopqrstuvwxyz1234567890");

    await app.close();
  });

  it("requires reviewer evidence before generating a formal eval diff", async () => {
    await insertAccessLog({
      userId: "agent-review",
      decisionReason: "table_forbidden",
      queryPreview: "跨部门查看 salary 明细"
    });
    const app = buildServer();
    await app.ready();

    const extract = await app.inject({
      method: "POST",
      url: "/api/eval/security-candidates/extract",
      payload: { limit: 10 }
    });
    expect(extract.statusCode).toBe(200);
    const candidateId = JSON.parse(extract.payload).data.candidates[0].id;

    const blocked = await app.inject({
      method: "POST",
      url: `/api/eval/security-candidates/${candidateId}/promote/preview`,
      payload: {}
    });
    expect(blocked.statusCode).toBe(409);

    const review = await app.inject({
      method: "POST",
      url: `/api/eval/security-candidates/${candidateId}/review`,
      payload: {
        reviewer: { actorKind: "admin", actorId: "local-admin" },
        permissionBoundaryConfirmed: true,
        expectedDenialConfirmed: true,
        businessContextConfirmed: true
      }
    });
    expect(review.statusCode).toBe(200);

    const preview = await app.inject({
      method: "POST",
      url: `/api/eval/security-candidates/${candidateId}/promote/preview`,
      payload: {}
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = JSON.parse(preview.payload);
    expect(previewBody.data.relPath).toBe("evals/security/eval/security-eval-cases.yaml");
    expect(previewBody.data.diff).toContain("security_");

    await expect(readFile(path.join(projectRoot, "evals", "security", "eval", "security-eval-cases.yaml"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });

    await app.close();
  });
});
