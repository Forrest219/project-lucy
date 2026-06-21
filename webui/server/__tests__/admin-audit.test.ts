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
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-admin-audit-"));
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

describe("GET /api/admin/audit", () => {
  it("hides protocol calls by default, keeps CIO summary counts, and exports redacted rich CSV", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: "2026-06-21T09:00:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      client: "hermes",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "0".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "tools_list_filtered"
    });
    await writeLog({
      ts: "2026-06-21T09:01:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      client: "=hermes",
      tool: "sl_query",
      tables: ["dataforai.kx_fact_financial_amount"],
      argsSummary: {
        question: "=1+1",
        note: "password=hunter2",
        token: "super-secret",
        nested: { private_key: "private123" }
      },
      outcome: "ok",
      durationMs: 42,
      requestId: "business-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "1".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "allowed"
    });
    await writeLog({
      ts: "2026-06-21T09:02:00.000Z",
      userId: "workhorse",
      tokenLabel: "kx-readonly",
      tokenHashPrefix: "sha256:111122223333",
      client: "hermes",
      tool: "sql_execution",
      argsSummary: { sql: "select 1" },
      outcome: "denied",
      errorDetail: "password=leaked",
      durationMs: 2,
      requestId: "denied-1",
      roleIds: ["kx_readonly"],
      permissionSnapshotHash: "1".repeat(64),
      effectiveTablesCount: 7,
      decisionReason: "tool_denied"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server).get("/api/admin/audit?limit=10").expect(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.entries.map((entry: { tool: string }) => entry.tool)).not.toContain("tools/list");
      expect(res.body.data.summary).toMatchObject({
        protocolCalls: 1,
        businessCalls: 2,
        deniedCalls: 1,
        dataBearingCalls: 1
      });
      const business = res.body.data.entries.find((entry: { requestId: string }) => entry.requestId === "business-1");
      expect(business).toMatchObject({
        tokenLabel: "kx-readonly",
        tokenHashPrefix: "sha256:111122223333",
        roleIds: ["kx_readonly"],
        effectiveTablesCount: 7,
        decisionReason: "allowed",
        argsSummary: {
          question: "=1+1",
          note: "password=[REDACTED]",
          token: "[REDACTED]",
          nested: { private_key: "[REDACTED]" }
        }
      });

      const withProtocol = await request(app.server).get("/api/admin/audit?includeProtocol=true&limit=10").expect(200);
      expect(withProtocol.body.data.total).toBe(3);
      expect(withProtocol.body.data.entries.map((entry: { tool: string }) => entry.tool)).toContain("tools/list");

      const csvRes = await request(app.server).get("/api/admin/audit/export").expect(200);
      const csv = csvRes.text;
      expect(csv).toContain("token_label");
      expect(csv).toContain("token_hash_prefix");
      expect(csv).toContain("permission_snapshot_hash");
      expect(csv).toContain("decision_reason");
      expect(csv).toContain("[REDACTED]");
      expect(csv).toContain("'=hermes");
      expect(csv).not.toContain("tools/list");
      expect(csv).not.toContain("super-secret");
      expect(csv).not.toContain("private123");
      expect(csv).not.toContain("hunter2");
      expect(csv).not.toContain("leaked");
    } finally {
      await app.close();
    }
  });
});
