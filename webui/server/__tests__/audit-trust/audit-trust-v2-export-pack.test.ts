/**
 * T04d audit-trust 集成测试：
 * - buildExportPackV2 返回 zip + manifest v2
 * - zip 含 calls-v2.csv + access_log_sources.csv + permission_snapshots.csv
 *   + manifest.json
 * - 当存在 protocol 行时, zip 含 linked_handshake_rows.jsonl
 * - file_hash_ok 反映文件哈希链一致性
 * - complete 模式 + relation_check 失败 -> throws
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { buildExportPackV2 } from "../../admin/audit-export-v2";

function makePackDb(): Database.Database {
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
      lucy_turn_id TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT,
      physical_table TEXT,
      extraction_method TEXT NOT NULL,
      confidence TEXT NOT NULL
    );
    CREATE TABLE permission_snapshots (
      id INTEGER PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      roles_json TEXT,
      resolved_json TEXT,
      capability_digest TEXT,
      tool_classification_version TEXT
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
    CREATE TABLE audit_maintenance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_seq INTEGER,
      ts TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      reason TEXT NOT NULL,
      request_id TEXT,
      algorithm_version TEXT NOT NULL,
      scanned INTEGER NOT NULL,
      matched INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      before_digest TEXT NOT NULL,
      after_digest TEXT NOT NULL
    );
  `);
  // Seed rows: 1 tool_call, 1 protocol handshake, 1 denied.
  db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, classification_version, ledger_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "2026-10-19T12:00:00Z", "u1", "lucy_query", "ok", "allowed", 100, 5,
    "tool_call", "other", "succeeded", "allowed", "succeeded", "usable",
    "confirmed", "turn-1", "turn-1", "audit-trust-2026-10-19-r1.v1", 1
  );
  db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, classification_version, ledger_seq)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "2026-10-19T12:01:00Z", "u2", "tools/list", "ok", "allowed", 5, 0,
    "protocol", "handshake", "succeeded", "allowed", "succeeded", "not_applicable",
    "confirmed", "turn-2", "turn-2", "audit-trust-2026-10-19-r1.v1", 2
  );
  db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, connection_id, schema_name, source_name, physical_table, extraction_method, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(1, "2026-10-19T12:00:00Z", "u1", "main", "public", "users", "users", "literal", "high");
  db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, connection_id, schema_name, source_name, physical_table, extraction_method, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(2, "2026-10-19T12:01:00Z", "u2", "main", "public", "users", "users", "literal", "high");
  db.prepare(`INSERT INTO permission_snapshots (id, hash, created_at, roles_json, resolved_json, capability_digest, tool_classification_version) VALUES (1, 'hash-1', '2026-10-19T12:00:00Z', '[]', '{}', 'digest-1', 'ac-p0-cls-1')`).run();
  return db;
}

const baseOptions = {
  mode: "complete" as const,
  fixedFilter: {},
  fixedZone: "UTC",
  auditStoreAvailable: true,
  securityStoreAvailable: true,
  classificationVersion: "audit-trust-2026-10-19-r1.v1",
  digestVersion: "audit-trust-2026-10-19-r1.v1",
  // B19 / E-2: `S` 由调用方从 canonical ledger 的已提交上界传入。
  ledgerUpperSeq: 3
};

describe("T04d buildExportPackV2", () => {
  it("returns a non-empty zip buffer", async () => {
    const db = makePackDb();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db });
    expect(result.zip).toBeInstanceOf(Buffer);
    expect(result.zip.length).toBeGreaterThan(0);
  });

  it("manifest is audit-export-manifest/v2 with combinedComplete=true", async () => {
    const db = makePackDb();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db });
    expect(result.manifest.schemaVersion).toBe("audit-export-manifest/v2");
    expect(result.manifest.combinedComplete).toBe(true);
    expect(result.manifest.scopeComplete).toBe(true);
    expect(result.manifest.integrityVerification.relationCheckOk).toBe(true);
    expect(result.manifest.integrityVerification.fileHashOk).toBe(true);
  });

  it("manifest.files lists every included file with sha256 + rowCount", async () => {
    const db = makePackDb();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db });
    const names = result.files.map((f) => f.name);
    expect(names).toContain("calls-v2.csv");
    expect(names).toContain("access_log_sources.csv");
    expect(names).toContain("permission_snapshots.csv");
    // linked_handshake_rows.jsonl included because we have a protocol row.
    expect(names).toContain("linked_handshake_rows.jsonl");
    for (const f of result.files) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.rowCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("integrityVerification.fileHashOk = true when all sha256 hashes are 64 hex chars", async () => {
    const db = makePackDb();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db });
    expect(result.manifest.integrityVerification.fileHashOk).toBe(true);
    expect(result.manifest.integrityVerification.relationCheckOk).toBe(true);
  });

  it("ledgerUpperSeq comes from the caller, never from the projection's own seq", async () => {
    // B19 / E-2: `S` 只能来自 canonical ledger 的已提交上界（maxEventSeq()）。
    const db = makePackDb();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db, ledgerUpperSeq: 77 });
    expect(result.manifest.ledgerUpperSeq).toBe(77);
  });

  it("rejects complete mode when permission_snapshots empty (relation_check fails)", async () => {
    const db = makePackDb();
    db.prepare(`DELETE FROM permission_snapshots WHERE id = 1`).run();
    await expect(buildExportPackV2({ ...baseOptions, snapshotDb: db })).rejects.toThrow(
      /integrity_or_relation_failed/
    );
  });

  it("tolerates missing linked_handshake_rows when no protocol rows", async () => {
    const db = makePackDb();
    db.prepare(`DELETE FROM access_log WHERE event_type = 'protocol'`).run();
    const result = await buildExportPackV2({ ...baseOptions, snapshotDb: db });
    const names = result.files.map((f) => f.name);
    expect(names).not.toContain("linked_handshake_rows.jsonl");
  });

  it("diagnostic mode with confirm_diagnostic=true returns a zip even when relation_check fails", async () => {
    const db = makePackDb();
    db.prepare(`DELETE FROM permission_snapshots WHERE id = 1`).run();
    const result = await buildExportPackV2({
      ...baseOptions,
      snapshotDb: db,
      mode: "diagnostic",
      confirmDiagnostic: true
    });
    expect(result.zip).toBeInstanceOf(Buffer);
    expect(result.manifest.combinedComplete).toBe(false);
    // Diagnostic does not throw on relation_check failure
  });
});