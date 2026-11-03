/**
 * T04c audit-trust 集成测试：
 * - v2 export 端点 mode=complete / mode=diagnostic
 * - diagnostic 需 confirm_diagnostic=true 否则 400
 * - complete 模式在 projection_lag / store 不可用 / backup 失败 / combinedComplete=false 时拒绝
 * - fixed ledger upper seq S 锚定
 * - v2 CSV 含 4 轴 + association_status 等新列
 * - diagnostic 模式容忍上述失败并记录 diagnostic_incomplete
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { performExportV2, type ExportMode } from "../../admin/audit-export-v2";

function makeFixtureDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_seq INTEGER,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      outcome TEXT,
      decision_reason TEXT,
      duration_ms INTEGER,
      response_row_count INTEGER,
      event_type TEXT,
      transport_sub_type TEXT,
      transport_status TEXT,
      authorization_status TEXT,
      execution_status TEXT,
      usability_status TEXT,
      association_status TEXT,
      original_turn_id TEXT,
      effective_turn_id TEXT,
      attempt_id TEXT,
      parent_attempt_id TEXT,
      instance_id TEXT,
      classification_version TEXT,
      permission_snapshot_hash TEXT
    );
    CREATE TABLE access_log_sources (id INTEGER PRIMARY KEY, access_log_id INTEGER, ledger_seq INTEGER);
    CREATE TABLE permission_snapshots (id INTEGER PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE association_revisions (id INTEGER PRIMARY KEY, original_turn_id TEXT, ledger_seq INTEGER);
    CREATE TABLE audit_maintenance_log (id INTEGER PRIMARY KEY);
    -- F-02：精确 as-of S 的证据（归属改写日志 + 基线）。
    CREATE TABLE access_log_attribution_mutations (
      id INTEGER PRIMARY KEY, access_log_id INTEGER, ledger_seq INTEGER, kind TEXT
    );
    CREATE TABLE access_log_asof_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO access_log_asof_meta (key, value) VALUES ('attribution_journal_baseline_seq', '1');
  `);
  // Seed 3 access_log rows + 3 source rows + 2 permission snapshots.
  const insert = db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, classification_version, ledger_seq,
            permission_snapshot_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("2026-10-19T12:00:00Z", "u1", "lucy_query", "ok", "allowed", 100, 5,
    "tool_call", "other", "succeeded", "allowed", "succeeded", "usable",
    "confirmed", "turn-1", "turn-1", "audit-trust-2026-10-19-r1.v1", 1, "hash-1");
  insert.run("2026-10-19T12:01:00Z", "u2", "tools/list", "ok", "allowed", 5, 0,
    "protocol", "handshake", "succeeded", "allowed", "succeeded", "not_applicable",
    null, null, null, "audit-trust-2026-10-19-r1.v1", 2, "hash-1");
  insert.run("2026-10-19T12:02:00Z", "u3", "lucy_query", "denied", "permission_denied", 10, 0,
    "tool_call", "other", "failed", "denied", "not_executed", "metadata_missing",
    "conflict", "turn-2", "turn-2", "audit-trust-2026-10-19-r1.v1", 3, "hash-1");
  // Sources (1 per access_log row to keep ok=true)
  for (let i = 1; i <= 3; i++) {
    db.prepare(`INSERT INTO access_log_sources (access_log_id, ledger_seq) VALUES (?, 1)`).run(i);
  }
  db.prepare(`INSERT INTO permission_snapshots (hash) VALUES ('hash-1')`).run();
  db.prepare(`INSERT INTO permission_snapshots (hash) VALUES ('hash-2')`).run();
  return db;
}

const baseOptions = {
  mode: "complete" as ExportMode,
  fixedFilter: {},
  fixedZone: "UTC",
  auditStoreAvailable: true,
  securityStoreAvailable: true,
  classificationVersion: "audit-trust-2026-10-19-r1.v1",
  digestVersion: "audit-trust-2026-10-19-r1.v1",
  // B19 / E-2: `S` 由调用方从 canonical ledger 的已提交上界传入
  // （security/store.ts 的 maxEventSeq()），**不**取投影自身的序号。
  ledgerUpperSeq: 3
};

describe("T04c performExportV2 complete mode", () => {
  it("returns CSV with v2 columns and a v2 manifest when complete", async () => {
    const db = makeFixtureDb();
    const r = await performExportV2({ ...baseOptions, snapshotDb: db });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("complete");
    expect(r.upperSeq).toBe(3);
    expect(r.rowCount).toBe(3);
    expect(r.combinedComplete).toBe(true);
    expect(r.scopeComplete).toBe(true);
    expect(r.fileHashOk).toBe(true);
    expect(r.relationCheckOk).toBe(true);
    expect(r.manifest.schemaVersion).toBe("audit-export-manifest/v2");
    expect(r.manifest.classificationVersion).toBe("audit-trust-2026-10-19-r1.v1");
    expect(r.manifest.digestVersion).toBe("audit-trust-2026-10-19-r1.v1");
    expect(r.manifest.associationQuality.confirmed).toBe(1);
    expect(r.manifest.associationQuality.conflict).toBe(1);
    expect(r.manifest.associationQuality.unassigned).toBe(1);
    expect(r.manifest.dataScope.ok).toBe(true);
    expect(r.manifest.clientCoverage.observed).toBe(false);
    expect(r.manifest.clientCoverage.unknownReason).toBe("no_controlled_client");
    // CSV header
    expect(r.csv.split("\n")[0]).toContain("event_type");
    expect(r.csv.split("\n")[0]).toContain("association_status");
    expect(r.csv.split("\n")[0]).toContain("authorization_status");
    expect(r.csv.split("\n")[0]).toContain("execution_status");
    expect(r.csv.split("\n")[0]).toContain("usability_status");
    expect(r.csv.split("\n")[0]).toContain("instance_id");
    expect(r.csv.split("\n")[0]).toContain("classification_version");
  });

  it("D-22 自动提供导出身份、评估时点与完整筛选声明", async () => {
    const db = makeFixtureDb();
    const now = Date.parse("2026-10-25T08:00:00.000Z");
    const r = await performExportV2({
      ...baseOptions,
      snapshotDb: db,
      fixedFilter: { from: "2026-10-19T00:00:00Z", until: "2026-10-20T00:00:00Z", userId: "u1" },
      now: () => now
    });
    expect(r.manifest.exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.manifest.exportedAt).toBe("2026-10-25T08:00:00.000Z");
    expect(r.manifest.cutoffAt).toBe(r.manifest.exportedAt);
    expect(r.manifest.filter).toEqual({
      from: "2026-10-19T00:00:00Z",
      until: "2026-10-20T00:00:00Z",
      userId: "u1"
    });
  });

  it("rejects complete mode when projection_lag > 0", async () => {
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, projectionLag: 5 })
    ).rejects.toThrow(/projection_lag_exceeded/);
  });

  it("rejects complete mode when audit store unavailable", async () => {
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, auditStoreAvailable: false })
    ).rejects.toThrow(/audit_store_unavailable/);
  });

  it("rejects complete mode when security store unavailable", async () => {
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, securityStoreAvailable: false })
    ).rejects.toThrow(/security_store_unavailable/);
  });

  it("rejects complete mode when backup failed", async () => {
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, backupOk: false })
    ).rejects.toThrow(/backup_failed/);
  });

  it("rejects complete mode when relation_check fails (no permission snapshots)", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        outcome TEXT,
        decision_reason TEXT,
        duration_ms INTEGER,
        response_row_count INTEGER,
        event_type TEXT,
        transport_sub_type TEXT,
        transport_status TEXT,
        authorization_status TEXT,
        execution_status TEXT,
        usability_status TEXT,
        association_status TEXT,
        original_turn_id TEXT,
        effective_turn_id TEXT,
        attempt_id TEXT,
        parent_attempt_id TEXT,
        instance_id TEXT,
        classification_version TEXT
      );
      CREATE TABLE access_log_sources (id INTEGER PRIMARY KEY, access_log_id INTEGER);
      CREATE TABLE permission_snapshots (id INTEGER PRIMARY KEY);
      CREATE TABLE association_revisions (id INTEGER PRIMARY KEY);
      CREATE TABLE audit_maintenance_log (id INTEGER PRIMARY KEY);
    `);
    db.prepare(`INSERT INTO access_log (ts, user_id, tool, classification_version) VALUES (?, ?, ?, ?)`).run(
      "t",
      "u",
      "lucy_query",
      "audit-trust-2026-10-19-r1.v1"
    );
    db.prepare(`INSERT INTO access_log_sources (access_log_id) VALUES (1)`).run();
    // No permission snapshot → scope_complete = false → combined_complete = false → reject.
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db })
    ).rejects.toThrow(/integrity_or_relation_failed/);
  });

  it("uses the caller-provided ledger upper seq S (never the projection's own seq)", async () => {
    // B19 / E-2: `S` 只能来自 canonical ledger 的已提交上界。
    // 传 99（远大于投影的 MAX(id)=3）时，S 必须是 99，且只导出 id <= 99 的行。
    const db = makeFixtureDb();
    const r = await performExportV2({ ...baseOptions, snapshotDb: db, ledgerUpperSeq: 99 });
    expect(r.upperSeq).toBe(99);
    expect(r.manifest.ledgerUpperSeq).toBe(99);
    expect(r.rowCount).toBe(3);
  });

  it("fails closed when the ledger upper seq is not supplied", async () => {
    // 不得用投影自身的序号顶替 S。
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, ledgerUpperSeq: undefined })
    ).rejects.toThrow(/ledger_upper_seq_required/);
  });

  it("diagnostic_requires_confirm: throws when mode=diagnostic without confirm", async () => {
    const db = makeFixtureDb();
    await expect(
      performExportV2({ ...baseOptions, snapshotDb: db, mode: "diagnostic" })
    ).rejects.toThrow(/diagnostic_requires_confirm/);
  });
});

describe("T04c performExportV2 diagnostic mode", () => {
  it("tolerates projection_lag > 0 when confirm_diagnostic=true", async () => {
    const db = makeFixtureDb();
    const r = await performExportV2({
      ...baseOptions,
      snapshotDb: db,
      mode: "diagnostic",
      confirmDiagnostic: true,
      projectionLag: 5
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("diagnostic");
    expect(r.diagnosticIncomplete).toContain("projection_lag");
  });

  it("tolerates unavailable stores when confirm_diagnostic=true", async () => {
    const db = makeFixtureDb();
    const r = await performExportV2({
      ...baseOptions,
      snapshotDb: db,
      mode: "diagnostic",
      confirmDiagnostic: true,
      auditStoreAvailable: false,
      securityStoreAvailable: false
    });
    expect(r.diagnosticIncomplete).toContain("audit_store_unavailable");
    expect(r.diagnosticIncomplete).toContain("security_store_unavailable");
  });

  it("tolerates backup failure when confirm_diagnostic=true", async () => {
    const db = makeFixtureDb();
    const r = await performExportV2({
      ...baseOptions,
      snapshotDb: db,
      mode: "diagnostic",
      confirmDiagnostic: true,
      backupOk: false
    });
    expect(r.diagnosticIncomplete).toContain("backup_failed");
  });

  it("reports legalEmptyWindow=true when audit_maintenance_log is empty", async () => {
    const db = makeFixtureDb();
    const r = await performExportV2({
      ...baseOptions,
      snapshotDb: db,
      mode: "diagnostic",
      confirmDiagnostic: true
    });
    expect(r.manifest.legalEmptyWindow).toBe(true);
  });
});