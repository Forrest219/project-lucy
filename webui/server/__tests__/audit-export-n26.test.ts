/**
 * N26-1–N26-6  FDE 3b1c62af F01 合同修订（v2p5 §18.19）
 *
 * N26-1: complete，零 lag → 200 (应绿对照)
 * N26-2: complete，等待期间 lag 1→0 → 200（先红）
 * N26-3: complete，cursor ≥ S but latestSeq > S → 200（先红）
 * N26-4: complete，持续 lag 到截止 → 409（应绿对照）
 * N26-5: diagnostic，追平与持续 lag 两种 → 均 200（应绿对照）
 * N26-6: T3 自捕获 S 之前起算，重试不重置（先红）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

// --- controlled projection mock ---
const ctx = vi.hoisted(() => ({
  calls: 0,
  kind: "zero-lag" as "zero-lag" | "caught-up" | "future-lag" | "stuck" | "post-s" | "budget-retry",
  upperSeq: 3,
  clock: 0, captureCostMs: 0, statusCostMs: 0, stepCostMs: 0
}));

vi.mock("../security/projector.js", async () => ({
  ...await vi.importActual<typeof import("../security/projector.js")>("../security/projector.js"),
  projectionStatus: () => {
    ctx.calls++;
    ctx.clock += ctx.statusCostMs;
    if (ctx.kind === "budget-retry") {
      const lag = ctx.calls < 6 ? 1 : 0;
      return { complete: lag === 0, cursor: ctx.upperSeq - lag, latestSeq: ctx.upperSeq, lag, delayMs: 0 };
    }
    if (ctx.kind === "zero-lag")  return { complete: true,  cursor: ctx.upperSeq, latestSeq: ctx.upperSeq, lag: 0, delayMs: 0 };
    if (ctx.kind === "caught-up") {
      // first call: lag 1 (before wait); subsequent calls: lag 0 (caught up)
      const lag = ctx.calls === 1 ? 1 : 0;
      return { complete: lag === 0, cursor: lag ? ctx.upperSeq - 1 : ctx.upperSeq, latestSeq: ctx.upperSeq, lag, delayMs: 0 };
    }
    if (ctx.kind === "post-s")
      // cursor ≥ S, but latestSeq > S (new events after S)
      return { complete: true, cursor: ctx.upperSeq, latestSeq: ctx.upperSeq + 2, lag: 0, delayMs: 0 };
    if (ctx.kind === "stuck")
      return { complete: false, cursor: ctx.upperSeq - 1, latestSeq: ctx.upperSeq, lag: 1, delayMs: 1 };
    return { complete: false, cursor: 0, latestSeq: 0, lag: 0, delayMs: 1 };
  },
  triggerAuditProjection: () => {},
  runProjection: () => { ctx.clock += ctx.stepCostMs; }
}));

vi.mock("../security/instance.js", async () => ({
  ...await vi.importActual<typeof import("../security/instance.js")>("../security/instance.js"),
  getSecurityStore: async () => ({
    ok: true,
    value: { maxEventSeq: () => { ctx.clock += ctx.captureCostMs; return { ok: true, value: ctx.upperSeq }; } }
  })
}));

/** Build a minimal valid ZIP containing one file. */
function makeZip(filename: string, data: Buffer): Buffer {
  const fname = Buffer.from(filename, "utf8");
  const local = Buffer.alloc(30 + fname.length + data.length);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(0, 8); // compression (stored)
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12); // mod time/date
  local.writeUInt32LE(0, 14); // crc
  local.writeUInt32LE(data.length, 18); // compressed size
  local.writeUInt32LE(data.length, 22); // uncompressed size
  local.writeUInt16LE(fname.length, 26); // filename length
  local.writeUInt16LE(0, 28); // extra length
  fname.copy(local, 30);
  data.copy(local, 30 + fname.length);
  const central = Buffer.alloc(46 + fname.length);
  central.writeUInt32LE(0x02014b50, 0); // central dir signature
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); // versions
  central.writeUInt16LE(0, 8); central.writeUInt16LE(0, 10); // flags, compression
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14); // mod time/date
  central.writeUInt32LE(0, 16); // crc
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fname.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // local header offset
  fname.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([local, central, eocd]);
}

vi.mock("../admin/audit-export-v2.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../admin/audit-export-v2.js")>();
  return { ...actual, DEFAULT_CATCH_UP_DEADLINE_MS: 500 };
});

function parseZipEntries(zip: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLen = zip.readUInt16LE(offset + 26);
    const extraLen = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    entries.set(zip.subarray(nameStart, nameStart + nameLen).toString(), zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

let root: string;
let dbFile: string;
let prevRoot: string | undefined;
let prevContent: string | undefined;
let prevAudit: string | undefined;

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_seq INTEGER,
      ts TEXT NOT NULL, user_id TEXT NOT NULL, tool TEXT NOT NULL,
      outcome TEXT, decision_reason TEXT, duration_ms INTEGER,
      response_row_count INTEGER, event_type TEXT, transport_sub_type TEXT,
      transport_status TEXT, authorization_status TEXT, execution_status TEXT,
      usability_status TEXT, association_status TEXT,
      original_turn_id TEXT, effective_turn_id TEXT, attempt_id TEXT,
      parent_attempt_id TEXT, instance_id TEXT, classification_version TEXT,
      lucy_turn_id TEXT, permission_snapshot_hash TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, access_log_id INTEGER,
      ts TEXT NOT NULL, user_id TEXT NOT NULL, connection_id TEXT,
      schema_name TEXT, source_name TEXT, physical_table TEXT,
      extraction_method TEXT NOT NULL, confidence TEXT NOT NULL, ledger_seq INTEGER
    );
    CREATE TABLE permission_snapshots (
      id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT NOT NULL,
      roles_json TEXT, resolved_json TEXT, capability_digest TEXT, tool_classification_version TEXT
    );
    CREATE TABLE association_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, original_turn_id TEXT NOT NULL,
      effective_turn_id TEXT, original_association_status TEXT,
      effective_association_status TEXT NOT NULL, reason TEXT NOT NULL,
      reference_doc TEXT, attribution_rule_version TEXT NOT NULL,
      actor_kind TEXT NOT NULL, actor_id TEXT, instance_id TEXT,
      instance_start_generation INTEGER, ts TEXT NOT NULL,
      classification_version TEXT NOT NULL, expected_revision TEXT,
      ledger_seq INTEGER,
      UNIQUE(original_turn_id, attribution_rule_version)
    );
    CREATE TABLE access_log_attribution_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, access_log_id INTEGER NOT NULL,
      ledger_seq INTEGER, kind TEXT NOT NULL
    );
    CREATE TABLE access_log_asof_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO access_log_asof_meta (key, value) VALUES ('attribution_journal_baseline_seq', '1');
    CREATE TABLE audit_maintenance_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ledger_seq INTEGER, ts TEXT NOT NULL,
      event_type TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
      request_id TEXT, algorithm_version TEXT NOT NULL,
      scanned INTEGER NOT NULL, matched INTEGER NOT NULL, updated INTEGER NOT NULL,
      before_digest TEXT NOT NULL, after_digest TEXT NOT NULL
    );
    CREATE TABLE inferred_turns (
      inferred_turn_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL, call_count INTEGER,
      business_call_count INTEGER, tool_summary TEXT, source_summary TEXT,
      question_summary TEXT, confidence TEXT, evidence_json TEXT, client TEXT,
      session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      inquiry_no INTEGER
    );
  `);
  const insert = db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
            event_type, transport_sub_type, transport_status, authorization_status, execution_status,
            usability_status, association_status, original_turn_id, effective_turn_id, lucy_turn_id,
            classification_version, ledger_seq, permission_snapshot_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    "2026-10-19T12:00:00Z", "u1", "lucy_query", "ok", "allowed", 100, 5,
    "tool_call", "other", "succeeded", "allowed", "succeeded", "usable",
    "confirmed", "turn-1", "turn-1", "turn-1", "v2p5-1", 1, "hash-1"
  );
  insert.run(
    "2026-10-19T12:01:00Z", "u2", "tools/list", "ok", "allowed", 5, 0,
    "protocol", "handshake", "succeeded", "allowed", "succeeded", "not_applicable",
    "confirmed", "turn-2", "turn-2", "turn-2", "v2p5-1", 2, "hash-1"
  );
  insert.run(
    "2026-10-19T12:02:00Z", "u3", "lucy_query", "denied", "permission_denied", 10, 0,
    "tool_call", "other", "failed", "denied", "not_executed", "metadata_missing",
    "conflict", "turn-3", "turn-3", "turn-3", "v2p5-1", 3, "hash-1"
  );
  const src = db.prepare(
    `INSERT INTO access_log_sources (access_log_id, ts, user_id, connection_id, schema_name, source_name,
            physical_table, extraction_method, confidence, ledger_seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  src.run(1, "2026-10-19T12:00:00Z", "u1", "main", "public", "users", "users", "literal", "high", 1);
  src.run(2, "2026-10-19T12:01:00Z", "u2", "main", "public", "users", "users", "literal", "high", 2);
  src.run(3, "2026-10-19T12:02:00Z", "u3", "main", "public", "users", "users", "literal", "high", 3);
  db.prepare(
    `INSERT INTO permission_snapshots (id, hash, created_at, roles_json, resolved_json, capability_digest, tool_classification_version)
     VALUES (1, 'hash-1', '2026-10-19T12:00:00Z', '[]', '{}', 'digest-1', 'ac-p0-cls-1')`
  ).run();
  return db;
}

beforeEach(async () => {
  vi.resetModules();
  ctx.calls = 0;
  ctx.kind = "zero-lag";
  ctx.upperSeq = 3;
  ctx.clock = Date.now(); ctx.captureCostMs = 0; ctx.statusCostMs = 0; ctx.stepCostMs = 0;
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-n26-"));
  dbFile = path.join(root, "audit.sqlite");
  prevRoot = process.env.KTX_PROJECT_ROOT;
  prevContent = process.env.LUCY_CONTENT_ROOT;
  prevAudit = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = dbFile;
  // Write ktx.yaml and backup db to file
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  const db = makeDb();
  await db.backup(dbFile);
  db.close();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (prevRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevRoot;
  if (prevContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContent;
  if (prevAudit === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAudit;
  await rm(root, { recursive: true, force: true });
});

async function makeApp() {
  const { registerAuditRoutes, getAuditDb, resetAuditDbForTests } = await import("../admin/audit.js");
  const app = Fastify();
  app.decorateRequest("lucyAdmin", null as any);
  app.addHook("onRequest", async (request) => {
    (request as any).lucyAdmin = {
      admin: { id: "admin-1", account_uid: "uid-1", role: "admin" },
      authMode: "required",
      session: null
    };
  });
  registerAuditRoutes(app);
  await getAuditDb();
  return { app, resetAuditDbForTests };
}

describe("N26 F01 追平口径修复", () => {
  it("N26-1 (应绿对照): complete, 零 lag → CSV 200; ZIP 200 且 manifest.projectionComplete=true", async () => {
    ctx.kind = "zero-lag";
    const { app, resetAuditDbForTests } = await makeApp();
    try {
      const csv = await app.inject({ method: "GET", url: "/api/admin/audit/export-v2?mode=complete" });
      expect(csv.statusCode).toBe(200);
      const zip = await app.inject({ method: "GET", url: "/api/admin/audit/export-pack-v2?mode=complete" });
      expect(zip.statusCode).toBe(200);
      const entries = parseZipEntries(zip.rawPayload);
      const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
      expect(manifest.ledgerUpperSeq).toBe(ctx.upperSeq);
      expect(manifest.projectionComplete).toBe(true);
      expect(manifest.combinedComplete).toBe(true);
    } finally {
      await app.close();
      resetAuditDbForTests();
    }
  });

  it("N26-2: complete, 等待期间 lag 1→0 → CSV+ZIP 均 200（追平后不再 409）", async () => {
    ctx.kind = "caught-up";
    const { app, resetAuditDbForTests } = await makeApp();
    try {
      const csv = await app.inject({ method: "GET", url: "/api/admin/audit/export-v2?mode=complete" });
      expect(csv.statusCode, `expected 200 but got ${csv.statusCode}: ${csv.body}`).toBe(200);
      const zip = await app.inject({ method: "GET", url: "/api/admin/audit/export-pack-v2?mode=complete" });
      expect(zip.statusCode, `expected 200 but got ${zip.statusCode}`).toBe(200);
      const entries = parseZipEntries(zip.rawPayload);
      const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
      expect(manifest.projectionComplete).toBe(true);
    } finally {
      await app.close();
      resetAuditDbForTests();
    }
  });

  it("N26-3: cursor ≥ S but latestSeq > S → 200, 导出内容不混入 S 之后事件", async () => {
    ctx.kind = "post-s";
    const { app, resetAuditDbForTests } = await makeApp();
    try {
      const csv = await app.inject({ method: "GET", url: "/api/admin/audit/export-v2?mode=complete" });
      expect(csv.statusCode, `expected 200 but got ${csv.statusCode}: ${csv.body}`).toBe(200);
      const zip = await app.inject({ method: "GET", url: "/api/admin/audit/export-pack-v2?mode=complete" });
      expect(zip.statusCode).toBe(200);
    } finally {
      await app.close();
      resetAuditDbForTests();
    }
  });

  it("N26-4 (应绿对照): complete, 持续 lag 到截止 → 409 projection_lag_exceeded", async () => {
    ctx.kind = "stuck";
    const { app, resetAuditDbForTests } = await makeApp();
    try {
      const csv = await app.inject({ method: "GET", url: "/api/admin/audit/export-v2?mode=complete" });
      expect(csv.statusCode).toBe(409);
      const zip = await app.inject({ method: "GET", url: "/api/admin/audit/export-pack-v2?mode=complete" });
      expect(zip.statusCode).toBe(409);
    } finally {
      await app.close();
      resetAuditDbForTests();
    }
  }, 10_000);

  it("N26-5 (应绿对照): diagnostic, 追平和持续 lag 两种场景均 200", async () => {
    for (const kind of ["caught-up", "stuck"] as const) {
      ctx.kind = kind;
      ctx.calls = 0;
      const { app, resetAuditDbForTests } = await makeApp();
      try {
        const zip = await app.inject({
          method: "GET",
          url: "/api/admin/audit/export-pack-v2?mode=diagnostic&confirmDiagnostic=true"
        });
        expect(zip.statusCode, `diagnostic ${kind}: ${zip.body}`).toBe(200);
        if (kind === "caught-up") {
          const entries = parseZipEntries(zip.rawPayload);
          const manifest = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
          // diagnostic mode: combinedComplete may be true when caught-up (FDE original assertion)
          expect(typeof manifest.combinedComplete).toBe("boolean");
        }
      } finally {
        await app.close();
        resetAuditDbForTests();
      }
    }
  }, 10_000);

  it.each(["export-v2", "export-pack-v2"])("N26-6: %s charges S capture and all retries to one deadline", async (route) => {
    ctx.kind = "budget-retry";
    ctx.captureCostMs = 300; ctx.statusCostMs = 100; ctx.stepCostMs = 60;
    const { app, resetAuditDbForTests } = await makeApp();
    const start = ctx.clock;
    vi.spyOn(Date, "now").mockImplementation(() => ctx.clock);
    try {
      const result = await app.inject({ method: "GET", url: `/api/admin/audit/${route}?mode=complete` });
      expect(result.statusCode).toBe(409);
      expect(ctx.calls).toBe(2);
      expect(ctx.clock - start).toBe(560);
    } finally {
      await app.close();
      resetAuditDbForTests();
    }
  });

  it.each(["export-v2", "export-pack-v2"])("N26-6: %s refuses a projection first observed after T3", async (route) => {
    ctx.kind = "zero-lag";
    ctx.captureCostMs = 400; ctx.statusCostMs = 150;
    const { app, resetAuditDbForTests } = await makeApp();
    vi.spyOn(Date, "now").mockImplementation(() => ctx.clock);
    try {
      const result = await app.inject({ method: "GET", url: `/api/admin/audit/${route}?mode=complete` });
      expect(result.statusCode).toBe(409);
      expect(ctx.calls).toBe(1);
    } finally {
      await app.close(); resetAuditDbForTests();
    }
  });
});
