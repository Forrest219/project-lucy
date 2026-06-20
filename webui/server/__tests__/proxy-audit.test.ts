import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-proxy-audit-"));
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

describe("proxy audit log", () => {
  it("marks truncated long error details with a hash", async () => {
    const { writeLog } = await import("../proxy/audit");
    const longDetail = "x".repeat(800);

    await writeLog({
      ts: new Date().toISOString(),
      userId: "audit-test",
      tool: "sl_query",
      outcome: "denied",
      errorDetail: longDetail,
      durationMs: 1,
      requestId: "audit-long-error"
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT error_detail FROM access_log WHERE request_id = ?").get("audit-long-error") as { error_detail: string };
      expect(row.error_detail.length).toBeLessThanOrEqual(500);
      expect(row.error_detail).toContain("<truncated sha256:");
    } finally {
      db.close();
    }
  });
});
