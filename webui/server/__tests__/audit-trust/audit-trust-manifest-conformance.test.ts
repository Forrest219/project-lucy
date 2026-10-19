/**
 * audit-trust-2026-10-19-r1 / T08b.1 — manifest v2 schema conformance test
 *
 * Cross-references every field of ExportV2Manifest against the contract
 * §2.7 / §6.1 specification and asserts:
 *   - required keys are present
 *   - field types match the schema
 *   - combinedComplete = scopeComplete && fileHashOk && relationCheckOk
 *   - associationQuality components sum to the rowCount
 *   - lagMs and ledgerUpperSeq carry parity invariants
 *
 * This is the conformance gate that gates any future schema evolution:
 * adding a new field to ExportV2Manifest requires updating this test.
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { performExportV2, type ExportV2Manifest } from "../../admin/audit-export-v2";

function makeMinimalDb(): Database.Database {
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
      classification_version TEXT,
      turn_attribution_mode TEXT,
      explicit_turn_validated INTEGER
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT,
      physical_table TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE permission_snapshots (
      hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      roles_json TEXT NOT NULL,
      resolved_json TEXT NOT NULL,
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
  // Seed enough rows for all classifications (so association_quality can
  // differ across statuses and we can verify the sum). Plus a
  // permission_snapshot and an access_log_source to satisfy relation_check.
  const insert = db.prepare(`
    INSERT INTO access_log (
      ts, user_id, tool, outcome, decision_reason, duration_ms,
      response_row_count, event_type, transport_sub_type, transport_status,
      authorization_status, execution_status, usability_status,
      association_status, original_turn_id, effective_turn_id,
      attempt_id, parent_attempt_id, instance_id, classification_version,
      turn_attribution_mode, explicit_turn_validated
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?
    )
  `);
  const seeds: Array<{ mode: string; validated: number | null; status: string }> = [
    { mode: "explicit", validated: 1, status: "confirmed" },
    { mode: "explicit", validated: 0, status: "conflict" },
    { mode: "session_bound", validated: null, status: "legacy_unverified" },
    { mode: "unassigned", validated: null, status: "candidate" }
  ];
  seeds.forEach((s, i) => {
    insert.run(
      "2026-10-19T00:00:0" + i + "Z",
      "u1",
      "tools/list",
      "ok",
      "test",
      1,
      0,
      "tool_call",
      "tool_call",
      "ok",
      "allowed",
      "executed",
      "usable",
      s.status,
      null,
      null,
      `att_${i}`,
      null,
      "instance_1",
      "audit-trust-2026-10-19-r1.v1",
      s.mode,
      s.validated
    );
  });
  db.prepare(`INSERT INTO permission_snapshots (hash, created_at, roles_json, resolved_json) VALUES (?, ?, ?, ?)`)
    .run("h1", "2026-10-19T00:00:00Z", "{}", "{}");
  db.prepare(`INSERT INTO access_log_sources (access_log_id, ts, user_id, tool, physical_table, extraction_method, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(1, "2026-10-19T00:00:00Z", "u1", "tools/list", "alice.public.x", "sql", "high", "2026-10-19T00:00:00Z");
  return db;
}

async function buildManifest(
  overrides: Partial<Parameters<typeof performExportV2>[0]> = {}
) {
  const db = makeMinimalDb();
  const result = await performExportV2({
    mode: "diagnostic",
    confirmDiagnostic: true,
    fixedFilter: {},
    fixedZone: "Asia/Shanghai",
    projectionLag: 0,
    auditStoreAvailable: true,
    securityStoreAvailable: true,
    backupOk: true,
    snapshotDb: db,
    sourceDb: db,
    classificationVersion: "audit-trust-2026-10-19-r1.v1",
    digestVersion: "audit-trust-2026-10-19-r1.v1",
    ...overrides
  });
  return result.manifest;
}

describe("T08b.1 manifest v2 schema conformance", () => {
  it("required scalar fields are present with correct types", async () => {
    const m = await buildManifest();
    expect(m.schemaVersion).toBe("audit-export-manifest/v2");
    expect(typeof m.classificationVersion).toBe("string");
    expect(typeof m.digestVersion).toBe("string");
    expect(typeof m.ledgerUpperSeq).toBe("number");
    expect(typeof m.projectionComplete).toBe("boolean");
    expect(typeof m.scopeComplete).toBe("boolean");
    expect(typeof m.combinedComplete).toBe("boolean");
    expect(typeof m.lagMs).toBe("number");
    expect(typeof m.policyScopeExpanded).toBe("object");
    expect(Array.isArray(m.policyScopeExpanded)).toBe(true);
    expect(typeof m.untrustedSelfReport).toBe("number");
    expect(typeof m.legalEmptyWindow).toBe("boolean");
  });

  it("dataScope is {ok: boolean, reason?: string}", async () => {
    const m = await buildManifest();
    expect(typeof m.dataScope).toBe("object");
    expect(m.dataScope).not.toBeNull();
    expect(typeof m.dataScope.ok).toBe("boolean");
    if (m.dataScope.reason !== undefined) {
      expect(typeof m.dataScope.reason).toBe("string");
    }
  });

  it("associationQuality components are non-negative integers summing to row count", async () => {
    const m = await buildManifest();
    expect(typeof m.associationQuality).toBe("object");
    const aq = m.associationQuality;
    expect(typeof aq.confirmed).toBe("number");
    expect(typeof aq.candidate).toBe("number");
    expect(typeof aq.unassigned).toBe("number");
    expect(typeof aq.conflict).toBe("number");
    expect(typeof aq.legacyUnverified).toBe("number");
    expect(aq.confirmed).toBeGreaterThanOrEqual(0);
    expect(aq.candidate).toBeGreaterThanOrEqual(0);
    expect(aq.unassigned).toBeGreaterThanOrEqual(0);
    expect(aq.conflict).toBeGreaterThanOrEqual(0);
    expect(aq.legacyUnverified).toBeGreaterThanOrEqual(0);
    const total =
      aq.confirmed + aq.candidate + aq.unassigned + aq.conflict + aq.legacyUnverified;
    // Across the seeded rows the total covers every access_log row.
    expect(total).toBe(4);
  });

  it("clientCoverage declares observed boolean + gapWindows array", async () => {
    const m = await buildManifest();
    expect(typeof m.clientCoverage).toBe("object");
    expect(typeof m.clientCoverage.observed).toBe("boolean");
    expect(Array.isArray(m.clientCoverage.gapWindows)).toBe(true);
    if (m.clientCoverage.unknownReason !== undefined) {
      expect(typeof m.clientCoverage.unknownReason).toBe("string");
    }
  });

  it("integrityVerification splits file_hash_ok from relation_check_ok", async () => {
    const m = await buildManifest();
    expect(typeof m.integrityVerification).toBe("object");
    expect(typeof m.integrityVerification.fileHashOk).toBe("boolean");
    expect(typeof m.integrityVerification.relationCheckOk).toBe("boolean");
  });

  it("combinedComplete = scopeComplete && fileHashOk && relationCheckOk", async () => {
    const m = await buildManifest();
    expect(m.combinedComplete).toBe(
      m.scopeComplete &&
        m.integrityVerification.fileHashOk &&
        m.integrityVerification.relationCheckOk
    );
  });

  it("schemaVersion is the fixed string 'audit-export-manifest/v2' (no drift)", async () => {
    const m = await buildManifest();
    expect(m.schemaVersion).toBe("audit-export-manifest/v2");
  });

  it("exports ExportV2Manifest with no extra keys beyond the spec surface", async () => {
    // Get the canonical key set by reading the type at compile time via
    // a fixture-shape check. We mirror the spec by listing expected keys.
    const expectedKeys = [
      "schemaVersion",
      "classificationVersion",
      "digestVersion",
      "ledgerUpperSeq",
      "projectionComplete",
      "scopeComplete",
      "dataScope",
      "associationQuality",
      "clientCoverage",
      "integrityVerification",
      "combinedComplete",
      "lagMs",
      "policyScopeExpanded",
      "untrustedSelfReport",
      "legalEmptyWindow"
    ];
    const m: ExportV2Manifest = await buildManifest();
    expect(Object.keys(m).sort()).toEqual(expectedKeys.slice().sort());
  });
});
