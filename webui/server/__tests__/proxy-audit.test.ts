import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
  let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-proxy-audit-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
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
        CREATE TABLE conversation_turns (
          turn_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          token_hash_prefix TEXT,
          platform TEXT,
          client TEXT,
          question_hash TEXT,
          question_preview TEXT,
          question_summary TEXT,
          question_source TEXT NOT NULL,
          redaction_version TEXT,
          created_at TEXT NOT NULL
        );
      `);
    } finally {
      legacyDb.close();
    }

    const { writeConversationTurn, writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "legacy-test",
      tokenLabel: "legacy-token",
      tokenHashPrefix: "sha256:legacy",
      lucySessionId: "session-legacy",
      turnAttributionMode: "unassigned",
      turnAttributionConfidence: "none",
      turnAttributionReason: "turn_attribution_rejected",
      tool: "sl_query",
      outcome: "ok",
      durationMs: 1,
      responseBytes: 12,
      requestId: "legacy-migration"
    });
    await writeConversationTurn({
      turnId: "legacy-turn-migration",
      sessionId: "legacy-session-migration",
      userId: "legacy-test",
      questionSource: "reported_tool"
    });

    const migratedDb = new Database(auditDbPath, { readonly: true });
    try {
      const columns = migratedDb.prepare("PRAGMA table_info(access_log)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toContain("lucy_session_id");
      expect(columns.map((column) => column.name)).toContain("response_bytes");
      expect(columns.map((column) => column.name)).toContain("trace_id");
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "turn_attribution_mode",
        "turn_attribution_confidence",
        "turn_attribution_reason",
        "skill_uri",
        "skill_version",
        "skill_file_version",
        "skill_action",
        "skill_roles_allowed",
        "matched_role_id"
      ]));
      const turnColumns = migratedDb.prepare("PRAGMA table_info(conversation_turns)").all() as Array<{ name: string }>;
      expect(turnColumns.map((column) => column.name)).toContain("session_id");
      const row = migratedDb.prepare(`
        SELECT lucy_session_id, response_bytes, trace_id,
               turn_attribution_mode, turn_attribution_confidence, turn_attribution_reason
        FROM access_log WHERE request_id = ?
      `).get("legacy-migration") as {
        lucy_session_id: string;
        response_bytes: number;
        trace_id: string | null;
        turn_attribution_mode: string;
        turn_attribution_confidence: string;
        turn_attribution_reason: string;
      };
      expect(row.lucy_session_id).toBe("session-legacy");
      expect(row.response_bytes).toBe(12);
      expect(row.trace_id).toBeNull();
      expect(row.turn_attribution_mode).toBe("unassigned");
      expect(row.turn_attribution_confidence).toBe("none");
      expect(row.turn_attribution_reason).toBe("turn_attribution_rejected");
      const turn = migratedDb.prepare("SELECT session_id FROM conversation_turns WHERE turn_id = ?").get("legacy-turn-migration") as { session_id: string };
      expect(turn.session_id).toBe("legacy-session-migration");
    } finally {
      migratedDb.close();
    }
  });

  it("persists Skill authorization evidence", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "skill-audit-test",
      tool: "resources/read",
      outcome: "ok",
      durationMs: 2,
      requestId: "skill-audit-1",
      skillUri: "lucy-skill://finance/dupont",
      skillVersion: "1.2.0",
      skillFileVersion: "abc123",
      skillAction: "read",
      skillRolesAllowed: ["finance_reader"],
      matchedRoleId: "finance_reader",
      decisionReason: "allowed"
    });

    const database = new Database(auditDbPath, { readonly: true });
    try {
      const row = database.prepare(`
        SELECT skill_uri, skill_version, skill_file_version, skill_action,
               skill_roles_allowed, matched_role_id, decision_reason
        FROM access_log WHERE request_id = ?
      `).get("skill-audit-1") as Record<string, string>;
      expect(row).toMatchObject({
        skill_uri: "lucy-skill://finance/dupont",
        skill_version: "1.2.0",
        skill_file_version: "abc123",
        skill_action: "read",
        matched_role_id: "finance_reader",
        decision_reason: "allowed"
      });
      expect(JSON.parse(row.skill_roles_allowed)).toEqual(["finance_reader"]);
    } finally {
      database.close();
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

  it("persists traceId separately from requestId", async () => {
    const { writeLog } = await import("../proxy/audit");

    await writeLog({
      ts: new Date().toISOString(),
      userId: "trace-link-test",
      tool: "sl_query",
      outcome: "ok",
      durationMs: 1,
      requestId: "json-rpc-1",
      traceId: "trace_platform_unique_1"
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT request_id, trace_id FROM access_log WHERE request_id = ?").get("json-rpc-1") as { request_id: string; trace_id: string };
      expect(row.request_id).toBe("json-rpc-1");
      expect(row.trace_id).toBe("trace_platform_unique_1");
    } finally {
      db.close();
    }
  });

  it("persists client_ip, user_agent, client_version, and device_name", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "device-ctx",
      tool: "sl_query",
      outcome: "ok",
      durationMs: 2,
      requestId: "device-ctx-1",
      client: "cursor",
      clientVersion: "1.2.3",
      clientIp: "203.0.113.10",
      userAgent: "Cursor/1.2.3",
      deviceName: "xingchen-mbp"
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const columns = db.prepare("PRAGMA table_info(access_log)").all() as Array<{ name: string }>;
      const names = columns.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(["client_ip", "user_agent", "client_version", "device_name"]));
      const row = db
        .prepare(
          "SELECT client, client_version, client_ip, user_agent, device_name FROM access_log WHERE request_id = ?"
        )
        .get("device-ctx-1") as {
        client: string;
        client_version: string;
        client_ip: string;
        user_agent: string;
        device_name: string;
      };
      expect(row.client).toBe("cursor");
      expect(row.client_version).toBe("1.2.3");
      expect(row.client_ip).toBe("203.0.113.10");
      expect(row.user_agent).toBe("Cursor/1.2.3");
      expect(row.device_name).toBe("xingchen-mbp");
    } finally {
      db.close();
    }
  });

  it("writes auth_failure_log rows", async () => {
    const { writeAuthFailureLog } = await import("../proxy/audit");
    await writeAuthFailureLog({
      ts: new Date().toISOString(),
      reason: "token_expired",
      clientIp: "198.51.100.7",
      userAgent: "Hermes/0.1",
      tokenHashPrefix: "sha256:deadbeef",
      userId: "zhangsan",
      tokenLabel: "old-laptop"
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db
        .prepare("SELECT reason, client_ip, user_id, token_label FROM auth_failure_log ORDER BY id DESC LIMIT 1")
        .get() as { reason: string; client_ip: string; user_id: string; token_label: string };
      expect(row.reason).toBe("token_expired");
      expect(row.client_ip).toBe("198.51.100.7");
      expect(row.user_id).toBe("zhangsan");
      expect(row.token_label).toBe("old-laptop");
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

    const dbBeforeRerun = new Database(auditDbPath, { readonly: true });
    let idsBeforeRerun: string[];
    try {
      idsBeforeRerun = (dbBeforeRerun.prepare("SELECT inferred_turn_id FROM inferred_turns WHERE user_id = ? ORDER BY inferred_turn_id ASC").all("cluster-user") as Array<{ inferred_turn_id: string }>).map((r) => r.inferred_turn_id);
    } finally {
      dbBeforeRerun.close();
    }

    // Rebuilding again over unchanged input must not duplicate rows AND must regenerate the
    // exact same inferred_turn_id set (rebuild is a pure function of the underlying access_log
    // rows: deterministic ORDER BY + no randomness in id generation).
    const rebuiltAgain = await rebuildInferredTurns("cluster-user", { lookbackHours: 24, gapMs: 120_000, includeCatalogOnly: true });
    expect(rebuiltAgain.turns).toBe(3);
    const dbAfter = new Database(auditDbPath, { readonly: true });
    try {
      const count = dbAfter.prepare("SELECT COUNT(*) AS cnt FROM inferred_turns WHERE user_id = ?").get("cluster-user") as { cnt: number };
      expect(count.cnt).toBe(3);
      const idsAfterRerun = (dbAfter.prepare("SELECT inferred_turn_id FROM inferred_turns WHERE user_id = ? ORDER BY inferred_turn_id ASC").all("cluster-user") as Array<{ inferred_turn_id: string }>).map((r) => r.inferred_turn_id);
      expect(idsAfterRerun).toEqual(idsBeforeRerun);
    } finally {
      dbAfter.close();
    }
  });

  it("rebuildInferredTurns keeps touched sources and uses a fixed summary when no question was reported", async () => {
    const { writeLog, writeAccessLogSources, rebuildInferredTurns } = await import("../proxy/audit");
    const base = Date.now() - 30 * 60 * 1000;
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    const logId = await writeLog({
      ts: at(0), userId: "source-content-user", tool: "sl_read_source",
      tables: ["dataforai.kx_fact_financial_amount"], outcome: "ok", durationMs: 1, requestId: "source-content-1"
    });
    await writeAccessLogSources(logId, at(0), "source-content-user", "sl_read_source", [{
      connectionId: "mysql-aliyun",
      schemaName: "dataforai",
      sourceName: "kx_fact_financial_amount",
      physicalTable: "dataforai.kx_fact_financial_amount",
      extractionMethod: "args_source_name",
      confidence: "high"
    }]);

    const result = await rebuildInferredTurns("source-content-user", { lookbackHours: 24 });
    expect(result.turns).toBe(1);

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare("SELECT source_summary, question_summary FROM inferred_turns WHERE user_id = ?").get("source-content-user") as { source_summary: string; question_summary: string | null };
      const sources = JSON.parse(row.source_summary) as Array<{ sourceName?: string }>;
      expect(sources).toEqual(expect.arrayContaining([expect.objectContaining({ sourceName: "kx_fact_financial_amount" })]));
      expect(row.question_summary).toBe("未上报问询原文");
      expect(row.question_summary).not.toContain("kx_fact_financial_amount");
    } finally {
      db.close();
    }
  });

  it("rebuildInferredTurns splits clusters when policy_version or permission_snapshot_hash changes", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const base = Date.now() - 60 * 60 * 1000;
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();

    await writeLog({
      ts: at(0),
      userId: "policy-split-user",
      tool: "lucy_query",
      tables: ["dataforai.superstore_orders"],
      outcome: "ok",
      durationMs: 1,
      requestId: "ps-1",
      policyVersion: "pol-a",
      permissionSnapshotHash: "snap-a"
    });
    // Within gap, but policy version changed → new cluster.
    await writeLog({
      ts: at(30_000),
      userId: "policy-split-user",
      tool: "lucy_query",
      tables: ["dataforai.superstore_orders"],
      outcome: "ok",
      durationMs: 1,
      requestId: "ps-2",
      policyVersion: "pol-b",
      permissionSnapshotHash: "snap-a"
    });
    // Within gap, same policy, snapshot changed → new cluster.
    await writeLog({
      ts: at(60_000),
      userId: "policy-split-user",
      tool: "lucy_query",
      tables: ["dataforai.superstore_people"],
      outcome: "ok",
      durationMs: 1,
      requestId: "ps-3",
      policyVersion: "pol-b",
      permissionSnapshotHash: "snap-b"
    });

    const result = await rebuildInferredTurns("policy-split-user", { lookbackHours: 24, gapMs: 120_000 });
    expect(result.turns).toBe(3);

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const turns = db
        .prepare("SELECT call_count FROM inferred_turns WHERE user_id = ? ORDER BY started_at ASC")
        .all("policy-split-user") as Array<{ call_count: number }>;
      expect(turns.map((row) => row.call_count)).toEqual([1, 1, 1]);
    } finally {
      db.close();
    }
  });

  it("splits two sessions inside the gap into two stable inferred turns", async () => {
    const { writeLog, rebuildInferredTurns, inferredTurnId } = await import("../proxy/audit");
    const base = Date.now() - 10 * 60 * 1000;
    const at = (offsetMs: number) => new Date(base + offsetMs).toISOString();
    const cursorId = await writeLog({
      ts: at(0),
      userId: "session-split-user",
      tool: "lucy_catalog",
      outcome: "ok",
      durationMs: 1,
      requestId: "split-cursor",
      lucySessionId: "266fc826",
      client: "cursor-vscode"
    });
    const workId = await writeLog({
      ts: at(30_000),
      userId: "session-split-user",
      tool: "lucy_query",
      tables: ["dataforai.superstore_orders"],
      outcome: "ok",
      durationMs: 1,
      requestId: "split-work",
      lucySessionId: "5f67cf3d",
      client: "lucy"
    });
    await writeLog({
      ts: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(),
      userId: "session-split-user",
      tool: "lucy_query",
      tables: ["dataforai.superstore_orders"],
      outcome: "ok",
      durationMs: 1,
      requestId: "split-old",
      lucySessionId: "old-session",
      client: "cursor-vscode"
    });

    const narrow = await rebuildInferredTurns("session-split-user", { lookbackHours: 1, gapMs: 120_000 });
    expect(narrow.turns).toBe(2);
    const wide = await rebuildInferredTurns("session-split-user", { lookbackHours: 24 * 30, gapMs: 120_000 });
    expect(wide.turns).toBe(3);

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const ids = (db.prepare("SELECT inferred_turn_id FROM inferred_turns WHERE user_id = ?").all("session-split-user") as Array<{ inferred_turn_id: string }>)
        .map((row) => row.inferred_turn_id);
      expect(ids).toEqual(expect.arrayContaining([
        inferredTurnId("session-split-user", cursorId),
        inferredTurnId("session-split-user", workId)
      ]));
      expect(ids).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("[v0.3] does NOT backbind same-session calls before begin; only handshake is attached", async () => {
    const { writeLog, bindPriorSessionCalls } = await import("../proxy/audit");
    const beginMs = Date.now() - 30_000;
    const beginAt = new Date(beginMs).toISOString();
    const catalogId = await writeLog({
      ts: new Date(beginMs - 10_000).toISOString(),
      userId: "bind-window-user",
      tool: "lucy_catalog",
      outcome: "ok",
      durationMs: 1,
      requestId: "bind-window-catalog",
      lucySessionId: "sess-window",
      tokenHashPrefix: "sha256:aabbccddeeff",
      turnAttributionMode: "unassigned"
    });
    const initializeId = await writeLog({
      ts: new Date(beginMs - 12_000).toISOString(),
      userId: "bind-window-user",
      tool: "initialize",
      outcome: "ok",
      durationMs: 1,
      requestId: "bind-window-init",
      lucySessionId: "sess-window",
      tokenHashPrefix: "sha256:aabbccddeeff",
      turnAttributionMode: "unassigned"
    });
    await bindPriorSessionCalls({
      turnId: "lucy_window",
      userId: "bind-window-user",
      tokenHashPrefix: "sha256:aabbccddeeff",
      sessionId: "sess-window",
      at: beginAt
    });
    const db = new Database(auditDbPath, { readonly: true });
    try {
      // Catalog 10s before begin: NOT backbound (v0.3 撤销 120 秒回绑)
      const catalog = db.prepare("SELECT lucy_turn_id, turn_attribution_mode, turn_attribution_confidence FROM access_log WHERE id = ?").get(catalogId) as {
        lucy_turn_id: string | null;
        turn_attribution_mode: string | null;
        turn_attribution_confidence: string | null;
      };
      expect(catalog.lucy_turn_id).toBeFalsy();
      expect(catalog.turn_attribution_mode).not.toBe("session_bound");
      // Handshake attached (initialize) but mode remains session_bound + low (v0.3 降级)
      const init = db.prepare("SELECT lucy_turn_id, turn_attribution_mode, turn_attribution_confidence FROM access_log WHERE id = ?").get(initializeId) as {
        lucy_turn_id: string | null;
        turn_attribution_mode: string | null;
        turn_attribution_confidence: string | null;
      };
      expect(init.lucy_turn_id).toBe("lucy_window");
      expect(init.turn_attribution_mode).toBe("session_bound");
      expect(init.turn_attribution_confidence).toBe("low");
    } finally {
      db.close();
    }
  });

  it("does not open a second inferred turn for calls already on a reported question", async () => {
    const { writeLog, writeConversationTurn, rebuildInferredTurns } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    await writeConversationTurn({
      turnId: "lucy_reported_only",
      userId: "reported-only-user",
      sessionId: "sess-reported",
      client: "cursor-vscode",
      questionSummary: "lucy mcp 有哪些上市公司的财务数据？",
      questionSource: "reported_tool"
    });
    await writeLog({
      ts: at(0),
      userId: "reported-only-user",
      tool: "initialize",
      outcome: "ok",
      durationMs: 1,
      requestId: "reported-init",
      lucySessionId: "sess-reported",
      client: "cursor-vscode",
      lucyTurnId: "lucy_reported_only",
      turnAttributionMode: "session_bound"
    });
    await writeLog({
      ts: at(10_000),
      userId: "reported-only-user",
      tool: "lucy_catalog",
      outcome: "ok",
      durationMs: 1,
      requestId: "reported-catalog",
      lucySessionId: "sess-reported",
      client: "cursor-vscode",
      lucyTurnId: "lucy_reported_only",
      turnAttributionMode: "session_bound"
    });
    await writeLog({
      ts: at(10_250),
      userId: "reported-only-user",
      tool: "lucy_read_source",
      tables: ["invest.fact_company"],
      outcome: "ok",
      durationMs: 1,
      requestId: "reported-read",
      lucySessionId: "sess-reported",
      client: "cursor-vscode",
      lucyTurnId: "lucy_reported_only",
      turnAttributionMode: "session_bound"
    });
    const result = await rebuildInferredTurns("reported-only-user", { lookbackHours: 24, gapMs: 120_000 });
    expect(result.turns).toBe(0);
  });

  it("skips a discover-only cluster and keeps a handshake session as one visit", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    await writeLog({
      ts: at(0),
      userId: "probe-user",
      tool: "server/discover",
      outcome: "error",
      errorDetail: "upstream_status=400",
      durationMs: 7,
      requestId: "probe-1",
      client: "claude-code"
    });
    await writeLog({
      ts: at(12),
      userId: "probe-user",
      tool: "server/discover",
      outcome: "error",
      errorDetail: "upstream_status=400",
      durationMs: 17,
      requestId: "probe-2",
      client: "claude-code"
    });
    await writeLog({
      ts: at(1_000),
      userId: "probe-user",
      tool: "initialize",
      outcome: "ok",
      durationMs: 1,
      requestId: "probe-init",
      lucySessionId: "sess-handshake",
      client: "claude-code"
    });
    await writeLog({
      ts: at(1_010),
      userId: "probe-user",
      tool: "notifications/initialized",
      outcome: "ok",
      durationMs: 1,
      requestId: "probe-ready",
      lucySessionId: "sess-handshake",
      client: "claude-code"
    });
    await writeLog({
      ts: at(1_020),
      userId: "probe-user",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 1,
      requestId: "probe-list",
      lucySessionId: "sess-handshake",
      client: "claude-code"
    });
    await writeLog({
      ts: at(1_030),
      userId: "probe-user",
      tool: "server/discover",
      outcome: "error",
      durationMs: 1,
      requestId: "probe-in-session",
      lucySessionId: "sess-handshake",
      client: "claude-code"
    });
    const result = await rebuildInferredTurns("probe-user", { lookbackHours: 24, gapMs: 120_000 });
    expect(result.turns).toBe(1);
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const turns = db.prepare("SELECT question_summary FROM inferred_turns WHERE user_id = ?").all("probe-user") as Array<{ question_summary: string }>;
      expect(turns.map((row) => row.question_summary)).toEqual(["会话建立：claude-code"]);
    } finally {
      db.close();
    }
  });
});
