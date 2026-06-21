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
  it("migrates legacy access_log tables before adding new indexes", async () => {
    const legacyDb = new Database(auditDbPath);
    try {
      legacyDb.exec(`
        CREATE TABLE access_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ts TEXT NOT NULL,
          user_id TEXT NOT NULL,
          client TEXT,
          tool TEXT NOT NULL,
          tables TEXT,
          args_summary TEXT,
          outcome TEXT NOT NULL,
          error_detail TEXT,
          duration_ms INTEGER NOT NULL,
          request_id TEXT NOT NULL
        );
      `);
    } finally {
      legacyDb.close();
    }

    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "legacy-test",
      tokenLabel: "legacy-token",
      tokenHashPrefix: "sha256:legacy",
      lucySessionId: "session-legacy",
      tool: "sl_query",
      outcome: "ok",
      durationMs: 1,
      responseBytes: 12,
      requestId: "legacy-migration"
    });

    const migratedDb = new Database(auditDbPath, { readonly: true });
    try {
      const columns = migratedDb.prepare("PRAGMA table_info(access_log)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("lucy_session_id");
      expect(columns.map((column) => column.name)).toContain("response_bytes");
      const row = migratedDb.prepare("SELECT lucy_session_id, response_bytes FROM access_log WHERE request_id = ?").get("legacy-migration") as { lucy_session_id: string; response_bytes: number };
      expect(row.lucy_session_id).toBe("session-legacy");
      expect(row.response_bytes).toBe(12);
    } finally {
      migratedDb.close();
    }
  });

  it("marks truncated long error details with a hash", async () => {
    const { writeLog } = await import("../proxy/audit");
    const longDetail = "x".repeat(800);

    await writeLog({
      ts: new Date().toISOString(),
      userId: "audit-test",
      tokenLabel: "hermes-laptop",
      tokenHashPrefix: "sha256:abc123def",
      tool: "sl_query",
      outcome: "denied",
      errorDetail: longDetail,
      durationMs: 1,
      requestId: "audit-long-error"
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT error_detail, token_label, token_hash_prefix FROM access_log WHERE request_id = ?").get("audit-long-error") as { error_detail: string; token_label: string; token_hash_prefix: string };
      expect(row.error_detail.length).toBeLessThanOrEqual(500);
      expect(row.error_detail).toContain("<truncated sha256:");
      expect(row.token_label).toBe("hermes-laptop");
      expect(row.token_hash_prefix).toBe("sha256:abc123def");
    } finally {
      db.close();
    }
  });
});
