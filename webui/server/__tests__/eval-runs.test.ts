import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { getEvalDb, resetEvalDb, type EvalRunRow } from "../eval/db";

// We test db.ts directly to avoid spawning real processes

let projectRoot: string;
let dbPath: string;

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-eval-runs-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  const evalDir = path.join(projectRoot, ".ktx-ui", "eval");
  await mkdir(evalDir, { recursive: true });
  dbPath = path.join(evalDir, "test-runs.sqlite");
  resetEvalDb();
  process.env.LUCY_EVAL_DB = dbPath;
  process.env.KTX_PROJECT_ROOT = projectRoot;
});

afterEach(async () => {
  resetEvalDb();
  delete process.env.LUCY_EVAL_DB;
  delete process.env.KTX_PROJECT_ROOT;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("eval-runs: db initialization", () => {
  it("creates tables on first access", async () => {
    const db = await getEvalDb(dbPath);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("eval_run");
    expect(names).toContain("eval_run_case");
  });

  it("is idempotent (CREATE IF NOT EXISTS)", async () => {
    const db1 = await getEvalDb(dbPath);
    db1.prepare("INSERT INTO eval_run (domain,started_at,status,triggered_by,trigger,ktx_mcp_url,case_selection) VALUES (?,?,?,?,?,?,?)")
      .run("superstore", new Date().toISOString(), "succeeded", "test", "manual", "http://localhost:7878/mcp", "{}");
    // Re-init should not destroy data
    const db2 = new Database(dbPath);
    db2.pragma("foreign_keys = ON");
    db2.exec(`
      CREATE TABLE IF NOT EXISTS eval_run (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        trigger TEXT NOT NULL,
        trigger_reason TEXT,
        ktx_mcp_url TEXT NOT NULL,
        case_selection TEXT NOT NULL,
        total_cases INTEGER NOT NULL DEFAULT 0,
        pass_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        runner_pid INTEGER,
        log_path TEXT,
        json_path TEXT
      );
    `);
    const rows = db2.prepare("SELECT * FROM eval_run").all();
    expect(rows).toHaveLength(1);
    db2.close();
  });
});

describe("eval-runs: status transitions", () => {
  it("inserts run with queued/running status and updates to succeeded", async () => {
    const db = await getEvalDb(dbPath);

    const startedAt = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases)
      VALUES (?, ?, 'running', 'test', 'manual', 'http://localhost', '{}', 0)
    `).run("superstore", startedAt);

    const runId = ins.lastInsertRowid as number;
    expect(runId).toBeGreaterThan(0);

    // Check running status
    const row = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow;
    expect(row.status).toBe("running");

    // Update to succeeded
    db.prepare("UPDATE eval_run SET status='succeeded', pass_count=5, fail_count=0, total_cases=5 WHERE id=?").run(runId);
    const updated = db.prepare("SELECT * FROM eval_run WHERE id = ?").get(runId) as EvalRunRow;
    expect(updated.status).toBe("succeeded");
    expect(updated.pass_count).toBe(5);
  });

  it("insert run_case and cascade delete", async () => {
    const db = await getEvalDb(dbPath);

    const ins = db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection)
      VALUES ('superstore', ?, 'succeeded', 'test', 'manual', 'http://localhost', '{}')
    `).run(new Date().toISOString());

    const runId = ins.lastInsertRowid as number;

    db.prepare(`
      INSERT INTO eval_run_case (run_id, case_id, status) VALUES (?, 'case-001', 'PASS')
    `).run(runId);
    db.prepare(`
      INSERT INTO eval_run_case (run_id, case_id, status) VALUES (?, 'case-002', 'FAIL')
    `).run(runId);

    const before = db.prepare("SELECT * FROM eval_run_case WHERE run_id=?").all(runId);
    expect(before).toHaveLength(2);

    db.prepare("DELETE FROM eval_run WHERE id=?").run(runId);
    const after = db.prepare("SELECT * FROM eval_run_case WHERE run_id=?").all(runId);
    expect(after).toHaveLength(0);
  });
});

describe("eval-runs: concurrent run detection", () => {
  it("detects running status", async () => {
    const db = await getEvalDb(dbPath);

    db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection)
      VALUES ('superstore', ?, 'running', 'webui', 'manual', 'http://localhost', '{}')
    `).run(new Date().toISOString());

    const running = db.prepare("SELECT id FROM eval_run WHERE status='running' OR status='queued'").get() as { id: number } | undefined;
    expect(running).toBeTruthy();
    // If a run is detected, the new trigger should return 409
    // This simulates the check in runner.ts spawnEvalRun
    expect(running?.id).toBeGreaterThan(0);
  });

  it("no conflict when all runs are done", async () => {
    const db = await getEvalDb(dbPath);

    db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection)
      VALUES ('superstore', ?, 'succeeded', 'webui', 'manual', 'http://localhost', '{}')
    `).run(new Date().toISOString());

    const running = db.prepare("SELECT id FROM eval_run WHERE status='running' OR status='queued'").get() as { id: number } | undefined;
    expect(running).toBeUndefined();
  });
});

describe("eval-runs: trend queries", () => {
  it("aggregates pass rate by date", async () => {
    const db = await getEvalDb(dbPath);

    const ins1 = db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases, pass_count, fail_count)
      VALUES ('superstore', '2026-06-15T10:00:00Z', 'succeeded', 'test', 'manual', 'http://localhost', '{}', 10, 9, 1)
    `).run();
    const ins2 = db.prepare(`
      INSERT INTO eval_run (domain, started_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases, pass_count, fail_count)
      VALUES ('superstore', '2026-06-16T10:00:00Z', 'succeeded', 'test', 'manual', 'http://localhost', '{}', 10, 10, 0)
    `).run();

    const rows = db.prepare(`
      SELECT DATE(started_at) AS date, SUM(pass_count) AS pass_count, SUM(fail_count) AS fail_count, COUNT(*) AS runs
      FROM eval_run
      WHERE domain = 'superstore' AND status = 'succeeded'
      GROUP BY DATE(started_at)
      ORDER BY date ASC
    `).all() as Array<{ date: string; pass_count: number; fail_count: number; runs: number }>;

    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe("2026-06-15");
    expect(rows[0].pass_count).toBe(9);
    expect(rows[1].pass_count).toBe(10);
  });
});
