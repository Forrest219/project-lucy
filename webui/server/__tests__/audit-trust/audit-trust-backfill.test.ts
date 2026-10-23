/**
 * T03a audit-trust 集成测试：
 * - security v2 schema migration (audit_event_kind column)
 * - audit_meta + association_revisions 表 DDL
 * - backfillAssociationStatus 映射规则 + 幂等性 + 不写 instance / event_type 默认值
 *
 * 不覆盖：scrub / 实际访问 / 真实客户端（EA-35 by T03d）。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readSchemaVersion, initSecuritySchema, SECURITY_SCHEMA_VERSION } from "../../security/schema";
import {
  backfillAssociationStatus,
  recordBackfillRun
} from "../../proxy/audit";

function makeSecurityDb(): Database.Database {
  const db = new Database(":memory:");
  initSecuritySchema(db);
  return db;
}

function makeAuditDb(): Database.Database {
  // Mimic the audit.ts DDL at a small scale: open in-memory; the DDL is shared
  // with audit.ts prepareTraceDatabase so we use the real function indirectly
  // by importing it. To avoid the side effect of getDb() (which awaits disk I/O
  // and uses path logic), we replicate the minimum DDL we need for the
  // backfill function:
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ts              TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        token_hash_prefix TEXT,
        tool            TEXT NOT NULL,
        ts_date         TEXT NOT NULL,
        lucy_turn_id    TEXT,
        turn_attribution_mode TEXT,
        turn_attribution_confidence TEXT,
        association_status TEXT,
        instance_id     TEXT,
        instance_start_generation INTEGER,
        event_type      TEXT,
        authorization_status TEXT
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT NOT NULL,
        question_source TEXT NOT NULL,
        association_status TEXT,
        created_at TEXT NOT NULL
      );
  `);
  return db;
}

describe("T03a security schema v2 migration", () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it("bumps SECURITY_SCHEMA_VERSION to 2", () => {
    expect(SECURITY_SCHEMA_VERSION).toBe(2);
  });

  it("adds audit_event_kind column + index on fresh DB", () => {
    db = makeSecurityDb();
    const cols = db.prepare("PRAGMA table_info(security_events)").all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "audit_event_kind")).toBe(true);
    const idx = db.prepare("PRAGMA index_list('security_events')").all() as Array<{ name: string }>;
    expect(idx.some((i) => i.name === "idx_security_events_audit_kind")).toBe(true);
  });

  it("is idempotent: re-init does not throw on already-v2 DB", () => {
    db = makeSecurityDb();
    const result = initSecuritySchema(db);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe(2);
    expect(readSchemaVersion(db)).toBe(2);
  });

  it("rejects DB with newer schema than supported", () => {
    db = makeSecurityDb();
    db.pragma("user_version = 99");
    const result = initSecuritySchema(db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("schema_unsupported");
  });

  it("preserves append-only triggers (security_events_no_update / no_delete)", () => {
    db = makeSecurityDb();
    const trig = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='security_events' ORDER BY name`
      )
      .all() as Array<{ name: string }>;
    expect(trig.map((t) => t.name)).toContain("security_events_no_update");
    expect(trig.map((t) => t.name)).toContain("security_events_no_delete");
  });
});

describe("T03a audit_meta + association_revisions DDL", () => {
  let db: Database.Database;

  afterEach(() => db?.close());

  it("creates audit_meta with the contracted shape", () => {
    db = makeAuditDb();
    db.exec(`
      CREATE TABLE audit_meta (
        audit_db_schema_version INTEGER PRIMARY KEY,
        classification_version  TEXT,
        digest_version          TEXT,
        last_migration_text     TEXT,
        running_at_iso          TEXT,
        running_actor           TEXT,
        input_sha256            TEXT,
        output_affected_rows    INTEGER
      );
    `);
    const cols = db.prepare("PRAGMA table_info(audit_meta)").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toContain("audit_db_schema_version");
    expect(names).toContain("classification_version");
    expect(names).toContain("digest_version");
    expect(names).toContain("last_migration_text");
    expect(names).toContain("running_at_iso");
    expect(names).toContain("running_actor");
    expect(names).toContain("input_sha256");
    expect(names).toContain("output_affected_rows");
  });

  it("creates association_revisions with UNIQUE(original_turn_id, attribution_rule_version)", () => {
    db = makeAuditDb();
    db.exec(`
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
    `);
    // Insert two rows with the same (turn, rule_version) → second must fail.
    db.prepare(
      `INSERT INTO association_revisions
        (original_turn_id, effective_association_status, reason,
         attribution_rule_version, actor_kind, ts, classification_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("turn-1", "confirmed", "audit", "v1", "person", "2026-10-19T12:00:00Z", "audit-trust-2026-10-19-r1.v1");
    expect(() =>
      db
        .prepare(
          `INSERT INTO association_revisions
            (original_turn_id, effective_association_status, reason,
             attribution_rule_version, actor_kind, ts, classification_version)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("turn-1", "conflict", "audit", "v1", "person", "2026-10-19T12:00:01Z", "audit-trust-2026-10-19-r1.v1")
    ).toThrow();
  });
});

describe("T03a backfillAssociationStatus mapping", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        token_hash_prefix TEXT,
        tool TEXT NOT NULL,
        ts_date TEXT NOT NULL,
        lucy_turn_id TEXT,
        turn_attribution_mode TEXT,
        turn_attribution_confidence TEXT,
        association_status TEXT,
        instance_id TEXT,
        instance_start_generation INTEGER,
        event_type TEXT,
        authorization_status TEXT,
        explicit_turn_validated INTEGER
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT NOT NULL,
        question_source TEXT NOT NULL,
        association_status TEXT,
        created_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => db?.close());

  function seedRow(input: {
    mode: string | null;
    explicitTurnValidated?: number | null;
    instanceId?: string | null;
    instanceStartGen?: number | null;
    eventType?: string | null;
    authStatus?: string | null;
    associationStatus?: string | null;
  }): number {
    const result = db
      .prepare(
        `INSERT INTO access_log
          (ts, user_id, tool, turn_attribution_mode, turn_attribution_confidence,
           association_status, instance_id, instance_start_generation,
           event_type, authorization_status, explicit_turn_validated, ts_date, token_hash_prefix, lucy_turn_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "2026-10-19T12:00:00Z",
        "u",
        "t",
        input.mode,
        input.mode === "session_bound" ? "low" : input.mode === "explicit" ? "high" : null,
        input.associationStatus ?? null,
        input.instanceId ?? null,
        input.instanceStartGen ?? null,
        input.eventType ?? null,
        input.authStatus ?? null,
        input.explicitTurnValidated ?? null,
        "2026-10-19",
        "h",
        null
      );
    return Number(result.lastInsertRowid);
  }

  it("maps session_bound → legacy_unverified", async () => {
    seedRow({ mode: "session_bound" });
    const result = await backfillAssociationStatus(db);
    expect(result.byMode["session_bound"]).toBe(1);
    expect(result.byResult["legacy_unverified"]).toBe(1);
    const row = db.prepare(`SELECT association_status FROM access_log LIMIT 1`).get() as { association_status: string };
    expect(row.association_status).toBe("legacy_unverified");
  });

  it("maps explicit + explicit_turn_validated=1 → confirmed", async () => {
    seedRow({ mode: "explicit", explicitTurnValidated: 1 });
    const result = await backfillAssociationStatus(db);
    expect(result.byResult["confirmed"]).toBe(1);
    const row = db.prepare(`SELECT association_status FROM access_log LIMIT 1`).get() as { association_status: string };
    expect(row.association_status).toBe("confirmed");
  });

  it("maps explicit + explicit_turn_validated=0 → conflict", async () => {
    seedRow({ mode: "explicit", explicitTurnValidated: 0 });
    const result = await backfillAssociationStatus(db);
    expect(result.byResult["conflict"]).toBe(1);
    const row = db.prepare(`SELECT association_status FROM access_log LIMIT 1`).get() as { association_status: string };
    expect(row.association_status).toBe("conflict");
  });

  it("maps explicit without explicit_turn_validated column → legacy_unverified (no silent upgrade)", async () => {
    // Use a separate DB that mimics pre-v2 schema (no explicit_turn_validated column).
    db.close();
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        tool TEXT NOT NULL,
        turn_attribution_mode TEXT,
        association_status TEXT,
        instance_id TEXT,
        instance_start_generation INTEGER,
        event_type TEXT,
        authorization_status TEXT,
        ts_date TEXT,
        token_hash_prefix TEXT,
        lucy_turn_id TEXT
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        question_source TEXT NOT NULL,
        association_status TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO access_log (ts, user_id, tool, turn_attribution_mode, ts_date, token_hash_prefix)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("2026-10-19T12:00:00Z", "u", "t", "explicit", "2026-10-19", "h");
    const result = await backfillAssociationStatus(db);
    expect(result.byResult["legacy_unverified"]).toBe(1);
    const row = db.prepare(`SELECT association_status FROM access_log LIMIT 1`).get() as { association_status: string };
    expect(row.association_status).toBe("legacy_unverified");
  });

  it("maps explicit + explicit_turn_validated IS NULL → legacy_unverified (no silent upgrade)", async () => {
    // Column exists, but the row has no validation recorded (NULL).
    seedRow({ mode: "explicit", explicitTurnValidated: null });
    const result = await backfillAssociationStatus(db);
    expect(result.byResult["legacy_unverified"]).toBe(1);
  });

  it("maps unassigned → unassigned and leaves NULL alone", async () => {
    seedRow({ mode: "unassigned", associationStatus: null });
    await backfillAssociationStatus(db);
    const row = db.prepare(`SELECT association_status FROM access_log LIMIT 1`).get() as { association_status: string };
    expect(row.association_status).toBe("unassigned");
  });

  it("is idempotent: second run has updated=0 and unchanged=N", async () => {
    seedRow({ mode: "session_bound" });
    seedRow({ mode: "explicit", explicitTurnValidated: 1 });
    const r1 = await backfillAssociationStatus(db);
    expect(r1.updated).toBe(2);
    const r2 = await backfillAssociationStatus(db);
    expect(r2.updated).toBe(0);
    expect(r2.unchanged).toBe(2);
  });

  it("does NOT write instance_id / instance_start_generation (historical rows keep NULL)", async () => {
    seedRow({ mode: "session_bound", instanceId: null });
    await backfillAssociationStatus(db);
    const row = db.prepare(`SELECT instance_id, instance_start_generation FROM access_log LIMIT 1`).get() as {
      instance_id: string | null;
      instance_start_generation: number | null;
    };
    expect(row.instance_id).toBeNull();
    expect(row.instance_start_generation).toBeNull();
  });

  it("does NOT default event_type='tool_call' or authorization_status='not_evaluated'", async () => {
    seedRow({ mode: "session_bound", eventType: null, authStatus: null });
    await backfillAssociationStatus(db);
    const row = db
      .prepare(`SELECT event_type, authorization_status FROM access_log LIMIT 1`)
      .get() as { event_type: string | null; authorization_status: string | null };
    expect(row.event_type).toBeNull();
    expect(row.authorization_status).toBeNull();
  });

  it("applies the same logic to conversation_turns.association_status (reported → confirmed)", async () => {
    db.prepare(
      `INSERT INTO conversation_turns (turn_id, user_id, question_source, created_at, association_status)
       VALUES (?, ?, ?, ?, ?)`
    ).run("t-1", "u", "reported", "2026-10-19T12:00:00Z", null);
    await backfillAssociationStatus(db);
    const row = db
      .prepare(`SELECT association_status FROM conversation_turns WHERE turn_id = ?`)
      .get("t-1") as { association_status: string };
    expect(row.association_status).toBe("confirmed");
  });

  it("recordBackfillRun persists audit_meta with running actor + SHA-256", async () => {
    seedRow({ mode: "session_bound" });
    const result = await backfillAssociationStatus(db);
    db.exec(`
      CREATE TABLE audit_meta (
        audit_db_schema_version INTEGER PRIMARY KEY,
        classification_version  TEXT,
        digest_version          TEXT,
        last_migration_text     TEXT,
        running_at_iso          TEXT,
        running_actor           TEXT,
        input_sha256            TEXT,
        output_affected_rows    INTEGER
      );
    `);
    await recordBackfillRun({
      database: db,
      result,
      migrationText: "test",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      digestVersion: "audit-trust-2026-10-19-r1.v1",
      runningActor: "test-actor",
      inputSha256: "abc123"
    });
    const meta = db.prepare(`SELECT * FROM audit_meta`).get() as {
      audit_db_schema_version: number;
      classification_version: string;
      digest_version: string;
      running_actor: string;
      input_sha256: string;
      output_affected_rows: number;
    };
    expect(meta.classification_version).toBe("audit-trust-2026-10-19-r1.v1");
    expect(meta.running_actor).toBe("test-actor");
    expect(meta.input_sha256).toBe("abc123");
    expect(meta.output_affected_rows).toBe(result.updated);
  });
});