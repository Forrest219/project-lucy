// B3 measured evidence producers (Spec §6.5, §8.1, §8.3, R8, R10).
//
// Each test forces a real, measurable result through the producer and asserts:
//   - missing data yields `null` (not 0), so the gate collector records BLOCKED;
//   - present data yields a measured value bound to the file(s) it read;
//   - the artifact writer is the actual file the gate collector opens (no double contract);
//   - the ops producer refuses to fabricate cases when no cluster is observed;
//   - the projection producer reads the cursor from the AUDIT database (separate file)
//     and the latest seq from the SECURITY database (real schema, not invented stub).
//   - runK8sAcceptance uses the injected runner, not a global spawnSync, and refuses to
//     return "passed" without an actually-observed deployment evidence.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  measureContextMigrationPending,
  measureOpsCases,
  measureProjectionBacklog,
  writeContextMigrationArtifact,
  writeOpsArtifact,
  writeProjectionArtifact
} from "../../gates/measure-evidence.mjs";

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-measure-"));
  return { dir, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} } };
}

/**
 * Build a real temporary SQLite with the actual security / audit schema (matches
 * webui/server/security/schema.ts and projector.ts PROJECTION_SCHEMA). Tests use this
 * instead of a sqlQuery stub accepting arbitrary SQL — that stub hid the schema
 * mismatch the producer used to ship.
 */
function openRealStore(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE security_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL, phase TEXT NOT NULL, actor TEXT NOT NULL, actor_type TEXT NOT NULL, network_info TEXT NOT NULL DEFAULT '', session_fingerprint TEXT NOT NULL DEFAULT '', trace_id TEXT NOT NULL DEFAULT '', policy_version TEXT NOT NULL DEFAULT '', context_version TEXT NOT NULL DEFAULT '', object_hash TEXT NOT NULL DEFAULT '', verdict TEXT NOT NULL DEFAULT '', result_summary TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
    CREATE TABLE projection_cursors (projector TEXT PRIMARY KEY, last_seq INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  `);
  return db;
}

function openRealAudit(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE security_projection_cursor (projector TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE security_operation_projection (operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, first_seq INTEGER NOT NULL, last_seq INTEGER NOT NULL, actor TEXT NOT NULL, actor_type TEXT NOT NULL, network_info TEXT NOT NULL DEFAULT '', session_fingerprint TEXT NOT NULL DEFAULT '', trace_id TEXT NOT NULL DEFAULT '', policy_version TEXT NOT NULL DEFAULT '', context_version TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT '', tool TEXT NOT NULL DEFAULT '', response_status INTEGER, response_bytes INTEGER, response_sha256 TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', admitted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  `);
  return db;
}

describe("B3 measure-evidence: context-migration producer", () => {
  it("returns pending=null when the journal directory is missing (no zero-fallback)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const result = measureContextMigrationPending({ projectDir: dir });
      assert.equal(result.pending, null, "missing journal dir must yield null, not 0");
      assert.match(result.reason, /journal directory not found/);
      assert.equal(result.scanned, 0);
    } finally { cleanup(); }
  });

  it("counts only entries with state=pending across every journal file", () => {
    const { dir, cleanup } = tempDir();
    try {
      const journal = path.join(dir, ".ktx-ui", "context-acl-migration");
      mkdirSync(journal, { recursive: true });
      writeFileSync(path.join(journal, "2026-10-18.json"), JSON.stringify({
        entries: [
          { id: "a", state: "pending" },
          { id: "b", state: "applied" },
          { id: "c", state: "pending" }
        ]
      }));
      writeFileSync(path.join(journal, "2026-10-19.json"), JSON.stringify({
        entries: [
          { id: "d", state: "pending" },
          { id: "e", state: "failed" }
        ]
      }));
      const result = measureContextMigrationPending({ projectDir: dir });
      assert.equal(result.pending, 3, "3 pending across 2 journals");
      assert.equal(result.scanned, 2);
      assert.match(result.source, /context-acl-migration$/);
    } finally { cleanup(); }
  });

  it("returns pending=0 only when every journal is empty of pending entries (real zero)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const journal = path.join(dir, ".ktx-ui", "context-acl-migration");
      mkdirSync(journal, { recursive: true });
      writeFileSync(path.join(journal, "j1.json"), JSON.stringify({ entries: [{ id: "a", state: "applied" }] }));
      const result = measureContextMigrationPending({ projectDir: dir });
      assert.equal(result.pending, 0);
      assert.equal(result.scanned, 1);
    } finally { cleanup(); }
  });

  it("returns pending=null on a corrupt journal (observation problem, not silently-0)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const journal = path.join(dir, ".ktx-ui", "context-acl-migration");
      mkdirSync(journal, { recursive: true });
      writeFileSync(path.join(journal, "broken.json"), "{not-json");
      const result = measureContextMigrationPending({ projectDir: dir });
      assert.equal(result.pending, null);
      assert.match(result.problem, /corrupt journal/);
    } finally { cleanup(); }
  });

  it("writeContextMigrationArtifact writes the contract the gate collector reads", () => {
    const { dir, cleanup } = tempDir();
    try {
      const outDir = path.join(dir, "results");
      const measurement = { pending: 2, scanned: 1, source: "/x" };
      const { file, body } = writeContextMigrationArtifact({
        outDir, run: { runId: "r1", instanceId: "i1" }, measurement
      });
      assert.equal(body.contract, "lucy-context-migration-v1");
      assert.equal(body.pending, 2);
      assert.equal(body.runId, "r1");
      assert.equal(body.instanceId, "i1");
      const round = JSON.parse(readFileSync(file, "utf8"));
      assert.deepEqual(round, body);
    } finally { cleanup(); }
  });
});

describe("B3 measure-evidence: projection producer (real schema)", () => {
  it("returns backlog=null when no sqlQuery adapter is supplied (production contract)", () => {
    const { dir, cleanup } = tempDir();
    try {
      mkdirSync(path.join(dir, ".ktx-ui"), { recursive: true });
      writeFileSync(path.join(dir, ".ktx-ui", "security.sqlite"), "");
      assert.throws(() => measureProjectionBacklog({ projectDir: dir, sqlQuery: undefined }), /requires a sqlQuery function/);
    } finally { cleanup(); }
  });

  it("returns backlog=null when the security store file is missing", () => {
    const { dir, cleanup } = tempDir();
    try {
      const result = measureProjectionBacklog({ projectDir: dir, sqlQuery: () => ({ rows: [] }) });
      assert.equal(result.backlog, null);
      assert.match(result.reason, /security store not found/);
    } finally { cleanup(); }
  });

  it("returns backlog=null when the audit store file is missing (cursor lives in audit.sqlite)", () => {
    const { dir, cleanup } = tempDir();
    try {
      // security.sqlite exists; audit.sqlite does not. Cursor lives in audit.sqlite, so
      // a missing audit file is a real "cannot measure", not a healthy zero.
      const secPath = path.join(dir, ".ktx-ui", "security.sqlite");
      mkdirSync(path.dirname(secPath), { recursive: true });
      new Database(secPath).close();
      const result = measureProjectionBacklog({ projectDir: dir, sqlQuery: () => ({ rows: [] }) });
      assert.equal(result.backlog, null);
      assert.match(result.reason, /audit store not found/);
      assert.equal(result.sources.audit, path.join(dir, ".ktx-ui", "audit.sqlite"));
    } finally { cleanup(); }
  });

  it("reads cursor from AUDIT.sqlite (security_projection_cursor) and latestSeq from SECURITY.sqlite (security_events)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const secPath = path.join(dir, ".ktx-ui", "security.sqlite");
      const audPath = path.join(dir, ".ktx-ui", "audit.sqlite");
      mkdirSync(path.dirname(secPath), { recursive: true });
      const secDb = openRealStore(secPath);
      secDb.prepare("INSERT INTO security_events (event_id, operation_id, phase, actor, actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("e1", "op-1", "request_admitted", "x", "y", 1);
      secDb.prepare("INSERT INTO security_events (event_id, operation_id, phase, actor, actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("e2", "op-1", "response_delivered", "x", "y", 2);
      secDb.close();
      const audDb = openRealAudit(audPath);
      audDb.prepare("INSERT INTO security_projection_cursor (projector, last_seq, updated_at) VALUES (?, ?, ?)").run("audit.operations", 1, "2026-10-18T00:00:00Z");
      audDb.close();
      // The real schema; the producer queries both files and uses the right column names.
      const sqlQuery = (dbPath, sql, params) => {
        const db = new Database(dbPath, { readonly: true });
        try { return { rows: db.prepare(sql).all(...(params ?? [])) }; } finally { db.close(); }
      };
      const result = measureProjectionBacklog({ projectDir: dir, sqlQuery });
      assert.equal(result.backlog, 1, "latestSeq 2 - cursor 1 = 1 unprojected");
      assert.equal(result.cursor, 1);
      assert.equal(result.latestSeq, 2);
      assert.equal(result.sources.audit, audPath);
      assert.equal(result.sources.security, secPath);
    } finally { cleanup(); }
  });

  it("refuses when cursor > latest (the audit store is corrupted; never Math.max(0) into a healthy zero)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const secPath = path.join(dir, ".ktx-ui", "security.sqlite");
      const audPath = path.join(dir, ".ktx-ui", "audit.sqlite");
      mkdirSync(path.dirname(secPath), { recursive: true });
      const secDb = openRealStore(secPath);
      secDb.prepare("INSERT INTO security_events (event_id, operation_id, phase, actor, actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("e1", "op-1", "request_admitted", "x", "y", 1);
      secDb.close();
      const audDb = openRealAudit(audPath);
      audDb.prepare("INSERT INTO security_projection_cursor (projector, last_seq, updated_at) VALUES (?, ?, ?)").run("audit.operations", 5, "2026-10-18T00:00:00Z");
      audDb.close();
      const sqlQuery = (dbPath, sql, params) => {
        const db = new Database(dbPath, { readonly: true });
        try { return { rows: db.prepare(sql).all(...(params ?? [])) }; } finally { db.close(); }
      };
      const result = measureProjectionBacklog({ projectDir: dir, sqlQuery });
      assert.equal(result.backlog, null);
      assert.equal(result.cursor, null);
      assert.match(result.problem, /cursor \(5\) is ahead of latest \(1\)/);
    } finally { cleanup(); }
  });

  it("returns backlog=null when the audit sqlQuery reports a missing cursor table (real schema)", () => {
    const { dir, cleanup } = tempDir();
    try {
      const secPath = path.join(dir, ".ktx-ui", "security.sqlite");
      const audPath = path.join(dir, ".ktx-ui", "audit.sqlite");
      mkdirSync(path.dirname(secPath), { recursive: true });
      // Build a real audit file WITHOUT the security_projection_cursor table — this is
      // the actual failure mode the old stub hid.
      const audDb = new Database(audPath);
      audDb.exec(`CREATE TABLE unrelated (x INTEGER);`);
      audDb.close();
      new Database(secPath).close();
      const sqlQuery = (dbPath, sql, params) => {
        const db = new Database(dbPath, { readonly: true });
        try { return { rows: db.prepare(sql).all(...(params ?? [])) }; }
        catch (error) { return { error: error.message }; }
        finally { db.close(); }
      };
      const result = measureProjectionBacklog({ projectDir: dir, sqlQuery });
      assert.equal(result.backlog, null);
      assert.match(result.problem, /no such table|security_projection_cursor/);
    } finally { cleanup(); }
  });

  it("returns backlog=null when the cursor is corrupt (negative, fractional, or non-numeric)", () => {
    for (const bad of [-3, 1.5, "abc"]) {
      const { dir, cleanup } = tempDir();
      try {
        const secPath = path.join(dir, ".ktx-ui", "security.sqlite");
        const audPath = path.join(dir, ".ktx-ui", "audit.sqlite");
        mkdirSync(path.dirname(secPath), { recursive: true });
        const secDb = openRealStore(secPath);
        secDb.prepare("INSERT INTO security_events (event_id, operation_id, phase, actor, actor_type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("e1", "op-1", "request_admitted", "x", "y", 1);
        secDb.close();
        const audDb = openRealAudit(audPath);
        audDb.prepare("INSERT INTO security_projection_cursor (projector, last_seq, updated_at) VALUES (?, ?, ?)").run("audit.operations", bad, "2026-10-18T00:00:00Z");
        audDb.close();
        const sqlQuery = (dbPath, sql, params) => {
          const db = new Database(dbPath, { readonly: true });
          try { return { rows: db.prepare(sql).all(...(params ?? [])) }; } finally { db.close(); }
        };
        const result = measureProjectionBacklog({ projectDir: dir, sqlQuery });
        assert.equal(result.backlog, null, `bad value ${JSON.stringify(bad)} must yield backlog=null`);
        assert.equal(result.cursor, null);
        assert.ok(result.problem && /negative|not an integer|not a number/.test(result.problem), `bad value ${JSON.stringify(bad)} problem=${result.problem}`);
      } finally { cleanup(); }
    }
  });

  it("writeProjectionArtifact writes the contract the gate collector reads", () => {
    const { dir, cleanup } = tempDir();
    try {
      const outDir = path.join(dir, "results");
      const measurement = { backlog: 4, cursor: 1, latestSeq: 5, source: "/x", projector: "audit.operations" };
      const { file, body } = writeProjectionArtifact({
        outDir, run: { runId: "r1", instanceId: "i1" }, measurement
      });
      assert.equal(body.contract, "lucy-projection-v1");
      assert.equal(body.backlog, 4);
      assert.equal(body.cursor, 1);
      assert.equal(body.latestSeq, 5);
      assert.equal(body.projector, "audit.operations");
      const round = JSON.parse(readFileSync(file, "utf8"));
      assert.deepEqual(round, body);
    } finally { cleanup(); }
  });
});

describe("B3 measure-evidence: ops producer", () => {
  it("returns blocked for V01 when no namespace/release was observed", () => {
    const cases = measureOpsCases({ run: { runId: "r1", instanceId: "i1" }, candidate: { imageDigest: "sha256:abc" } });
    const v01 = cases.find((c) => c.id === "OPS-01-V01");
    assert.equal(v01.status, "blocked");
    assert.match(v01.detail, /--namespace and --release are required/);
  });

  it("returns blocked for V01 when logicalInstanceId is missing (refuses a missing identity binding)", () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: "", stderr: "" };
    };
    const cases = measureOpsCases({
      run: { runId: "r1" },  // instanceId missing
      candidate: { imageDigest: "sha256:abc" },
      namespace: "lucy-e2e",
      release: "lucy",
      kubectlRunner: runner
    });
    const v01 = cases.find((c) => c.id === "OPS-01-V01");
    assert.equal(v01.status, "blocked");
    assert.match(v01.detail, /logical-instance-id|logicalInstanceId/);
    assert.equal(calls.length, 0, "no runner call when the identity binding is missing");
  });

  it("drives k8s-acceptance through the INJECTED runner (not global spawnSync) with --logical-instance-id", () => {
    const calls = [];
    const runner = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: "", stderr: "" };
    };
    const cases = measureOpsCases({
      run: { runId: "r1", instanceId: "logical-uuid-1" },
      candidate: { imageDigest: "sha256:abc" },
      namespace: "lucy-e2e",
      release: "lucy",
      kubectlRunner: runner
    });
    const v01 = cases.find((c) => c.id === "OPS-01-V01");
    // The runner was called and the script received --logical-instance-id; but because
    // the deployment evidence was NOT observed (the script wrote to /dev/null), the
    // verdict is blocked — NOT passed from exit 0 alone.
    assert.equal(calls.length, 1);
    const flatArgs = calls[0].args.join(" ");
    assert.match(flatArgs, /--logical-instance-id logical-uuid-1/);
    assert.match(flatArgs, /--namespace lucy-e2e/);
    assert.match(flatArgs, /--release lucy/);
    assert.equal(v01.status, "blocked", "exit 0 alone is insufficient — the producer must also see deployment evidence");
    assert.match(v01.detail, /no deployment evidence was captured/);
  });

  it("returns unimplemented (NOT passed) for V02..V07 when the per-variant path is not wired", () => {
    const cases = measureOpsCases({ run: { runId: "r1", instanceId: "i1" }, candidate: { imageDigest: "sha256:abc" } });
    for (const id of ["OPS-01-V02", "OPS-01-V03", "OPS-01-V04", "OPS-01-V05", "OPS-01-V06", "OPS-01-V07"]) {
      const c = cases.find((x) => x.id === id);
      assert.equal(c.status, "unimplemented", `${id} must be unimplemented (not passed) without runOpsXxxCase`);
      assert.match(c.detail, /not wired in measure-evidence|D7 owns/);
    }
  });

  it("calls the injected runOpsXxxCase for V02..V07 (passes through the measured verdict)", () => {
    const verdicts = {
      "OPS-01-V02": { status: "passed", detail: "PVC upgrade kept acceptance green (measured)" },
      "OPS-01-V03": { status: "failed", detail: "revoked-token table differs after upgrade" }
    };
    const cases = measureOpsCases({
      run: { runId: "r1", instanceId: "i1" },
      candidate: { imageDigest: "sha256:abc" },
      namespace: "lucy-e2e",
      release: "lucy",
      kubectlRunner: () => ({ status: 0, stdout: "", stderr: "" }),
      runOpsXxxCase: ({ id }) => verdicts[id] ?? { status: "unimplemented", detail: `no verdict injected for ${id}` }
    });
    const v02 = cases.find((c) => c.id === "OPS-01-V02");
    const v03 = cases.find((c) => c.id === "OPS-01-V03");
    const v07 = cases.find((c) => c.id === "OPS-01-V07");
    assert.equal(v02.status, "passed");
    assert.equal(v03.status, "failed");
    assert.equal(v07.status, "unimplemented", "V07 had no injected verdict, stays unimplemented (NOT passed)");
  });

  it("writeOpsArtifact writes the contract the gate collector reads", () => {
    const { dir, cleanup } = tempDir();
    try {
      const outDir = path.join(dir, "results");
      const { file, body } = writeOpsArtifact({
        outDir, run: { runId: "r1", instanceId: "i1" }, candidate: { imageDigest: "sha256:abc" },
        cases: [{ id: "OPS-01-V01", runner: "gate", status: "passed", detail: "ok", assertions: [] }]
      });
      assert.equal(body.contract, "lucy-ops-v1");
      assert.equal(body.imageDigest, "sha256:abc");
      assert.equal(body.cases[0].id, "OPS-01-V01");
      const round = JSON.parse(readFileSync(file, "utf8"));
      assert.deepEqual(round, body);
    } finally { cleanup(); }
  });
});

describe("B3 measure-evidence: no zero fallback in any path", () => {
  it("context-migration: missing dir => null, corrupt => null, empty => 0 only when actually measured", () => {
    const { dir: emptyDir, cleanup: emptyCleanup } = tempDir();
    try {
      const missing = measureContextMigrationPending({ projectDir: emptyDir });
      assert.equal(missing.pending, null);
    } finally { emptyCleanup(); }

    const { dir: corruptDir, cleanup: corruptCleanup } = tempDir();
    try {
      const journal = path.join(corruptDir, ".ktx-ui", "context-acl-migration");
      mkdirSync(journal, { recursive: true });
      writeFileSync(path.join(journal, "x.json"), "not-json");
      const corrupt = measureContextMigrationPending({ projectDir: corruptDir });
      assert.equal(corrupt.pending, null);
    } finally { corruptCleanup(); }

    const { dir: zeroDir, cleanup: zeroCleanup } = tempDir();
    try {
      const journal = path.join(zeroDir, ".ktx-ui", "context-acl-migration");
      mkdirSync(journal, { recursive: true });
      writeFileSync(path.join(journal, "x.json"), JSON.stringify({ entries: [{ id: "a", state: "applied" }] }));
      const zero = measureContextMigrationPending({ projectDir: zeroDir });
      assert.equal(zero.pending, 0);
    } finally { zeroCleanup(); }
  });
});
