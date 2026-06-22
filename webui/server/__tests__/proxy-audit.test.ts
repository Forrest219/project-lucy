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

  it("writeLog returns the inserted row id, usable as a foreign key for writeAccessLogSources", async () => {
    const { writeLog, writeAccessLogSources } = await import("../proxy/audit");

    const accessLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "sources-test",
      tool: "sl_read_source",
      outcome: "ok",
      durationMs: 1,
      requestId: "sources-fk-test"
    });
    expect(Number.isInteger(accessLogId)).toBe(true);
    expect(accessLogId).toBeGreaterThan(0);

    await writeAccessLogSources(accessLogId, new Date().toISOString(), "sources-test", "sl_read_source", [{
      connectionId: "mysql-aliyun",
      schemaName: "dataforai",
      sourceName: "superstore_orders",
      physicalTable: "dataforai.superstore_orders",
      extractionMethod: "args_source_name",
      confidence: "high"
    }]);

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const rows = db.prepare("SELECT * FROM access_log_sources WHERE access_log_id = ?").all(accessLogId) as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        access_log_id: accessLogId,
        user_id: "sources-test",
        tool: "sl_read_source",
        connection_id: "mysql-aliyun",
        schema_name: "dataforai",
        source_name: "superstore_orders",
        physical_table: "dataforai.superstore_orders",
        extraction_method: "args_source_name",
        confidence: "high"
      });
    } finally {
      db.close();
    }
  });

  it("creates the access_log_sources table and indexes idempotently", async () => {
    const { writeLog } = await import("../proxy/audit");
    // getDb() runs its CREATE TABLE IF NOT EXISTS migration on every call; writing twice
    // exercises that path without error.
    await writeLog({ ts: new Date().toISOString(), userId: "idempotent-1", tool: "sl_query", outcome: "ok", durationMs: 1, requestId: "idempotent-1" });
    await writeLog({ ts: new Date().toISOString(), userId: "idempotent-2", tool: "sl_query", outcome: "ok", durationMs: 1, requestId: "idempotent-2" });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'access_log_sources'").all();
      expect(tables).toHaveLength(1);
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'access_log_sources'").all() as Array<{ name: string }>;
      expect(indexes.map((idx) => idx.name)).toEqual(expect.arrayContaining(["idx_als_log", "idx_als_user_ts", "idx_als_source", "idx_als_table"]));
    } finally {
      db.close();
    }
  });

  it("writeConversationTurn writes a row, and purgeExpiredConversationTurns only clears expired sensitive fields", async () => {
    const { writeConversationTurn, purgeExpiredConversationTurns } = await import("../proxy/audit");

    await writeConversationTurn({
      turnId: "lucy_fresh_1",
      userId: "workhorse",
      tokenHashPrefix: "sha256:abc",
      questionHash: "hash-fresh",
      questionPreview: "fresh preview",
      questionSummary: "fresh summary",
      questionSource: "reported_tool"
    });

    // Backdate a second row directly (writeConversationTurn always stamps "now").
    const oldDb = new Database(auditDbPath);
    try {
      const oldCreatedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      oldDb.prepare(`
        INSERT INTO conversation_turns (turn_id, user_id, question_hash, question_preview, question_summary, question_source, created_at)
        VALUES ('lucy_old_1', 'workhorse', 'hash-old', 'old preview', 'old summary', 'reported_tool', ?)
      `).run(oldCreatedAt);
    } finally {
      oldDb.close();
    }

    const dryRun = await purgeExpiredConversationTurns({ retentionDays: 30, dryRun: true });
    expect(dryRun).toEqual({ scanned: 1, purged: 0 });

    const afterDryRun = new Database(auditDbPath, { readonly: true });
    try {
      const row = afterDryRun.prepare("SELECT question_preview FROM conversation_turns WHERE turn_id = 'lucy_old_1'").get() as { question_preview: string };
      expect(row.question_preview).toBe("old preview");
    } finally {
      afterDryRun.close();
    }

    const real = await purgeExpiredConversationTurns({ retentionDays: 30 });
    expect(real).toEqual({ scanned: 1, purged: 1 });

    const afterPurge = new Database(auditDbPath, { readonly: true });
    try {
      const oldRow = afterPurge.prepare("SELECT question_preview, question_summary, question_hash FROM conversation_turns WHERE turn_id = 'lucy_old_1'").get() as Record<string, unknown>;
      expect(oldRow).toEqual({ question_preview: null, question_summary: null, question_hash: null });
      const freshRow = afterPurge.prepare("SELECT question_preview FROM conversation_turns WHERE turn_id = 'lucy_fresh_1'").get() as { question_preview: string };
      expect(freshRow.question_preview).toBe("fresh preview");
    } finally {
      afterPurge.close();
    }
  });

  it("rebuildInferredTurns clusters business calls by gap and skips isolated kx_catalog preflight calls", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const base = Date.now() - 60 * 60 * 1000; // 1 hour ago, well within default 24h lookback
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    // Cluster 1: two calls 60s apart (within 120s gap), both data-bearing.
    await writeLog({ ts: at(0), userId: "cluster-user", tool: "sl_read_source", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "c1-1" });
    await writeLog({ ts: at(60_000), userId: "cluster-user", tool: "sl_query", tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "c1-2" });

    // Cluster 2: a lone call 5 minutes after cluster 1's last call (> 120s gap).
    await writeLog({ ts: at(360_000), userId: "cluster-user", tool: "sl_query", tables: ["dataforai.superstore_returns"], outcome: "ok", durationMs: 1, requestId: "c2-1" });

    // Isolated kx_catalog call, far from anything else -> preflight_only, not written by default.
    await writeLog({ ts: at(900_000), userId: "cluster-user", tool: "kx_catalog", outcome: "ok", durationMs: 1, requestId: "catalog-only" });

    const result = await rebuildInferredTurns("cluster-user", { lookbackHours: 24, gapMs: 120_000 });
    expect(result.turns).toBe(2);

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const turns = db.prepare("SELECT * FROM inferred_turns WHERE user_id = ? ORDER BY started_at ASC").all("cluster-user") as Array<{
        call_count: number;
        business_call_count: number;
        confidence: string;
      }>;
      expect(turns).toHaveLength(2);
      expect(turns[0]).toMatchObject({ call_count: 2, business_call_count: 2, confidence: "medium" });
      expect(turns[1]).toMatchObject({ call_count: 1, business_call_count: 1, confidence: "medium" });

      const links = db.prepare("SELECT COUNT(*) AS cnt FROM inferred_turn_access_logs").get() as { cnt: number };
      expect(links.cnt).toBe(3); // 2 + 1, the isolated kx_catalog call is excluded entirely
    } finally {
      db.close();
    }

    // includeCatalogOnly=true should additionally surface the isolated catalog call as a low-confidence turn.
    const withCatalog = await rebuildInferredTurns("cluster-user", { lookbackHours: 24, gapMs: 120_000, includeCatalogOnly: true });
    expect(withCatalog.turns).toBe(3);

    // Rebuilding again must not duplicate rows for the same window (full-window delete+reinsert).
    const rebuiltAgain = await rebuildInferredTurns("cluster-user", { lookbackHours: 24, gapMs: 120_000, includeCatalogOnly: true });
    expect(rebuiltAgain.turns).toBe(3);
    const dbAfter = new Database(auditDbPath, { readonly: true });
    try {
      const count = dbAfter.prepare("SELECT COUNT(*) AS cnt FROM inferred_turns WHERE user_id = ?").get("cluster-user") as { cnt: number };
      expect(count.cnt).toBe(3);
    } finally {
      dbAfter.close();
    }
  });
});
