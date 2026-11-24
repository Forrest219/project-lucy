import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import Database from "better-sqlite3";
import { afterEach, beforeEach, expect, it } from "vitest";
import { closeAuditDb, loadBudgetState, saveBudgetState, type PersistedBudgetState } from "../proxy/audit.js";

const require = createRequire(import.meta.url);
const previousDb = process.env.LUCY_AUDIT_DB;
let root: string;
let databasePath: string;
let control: Database.Database;
let worker: Worker | undefined;
const state: PersistedBudgetState = {
  startedAt: 1000, originStartedAt: 1000, calls: 1, attempts: 1,
  continuations: 0, peakConcurrency: 1, currentConcurrency: 0
};

beforeEach(async () => {
  closeAuditDb();
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-budget-sqlite-"));
  databasePath = path.join(root, "audit.sqlite");
  process.env.LUCY_AUDIT_DB = databasePath;
  await loadBudgetState("warm-schema");
  control = new Database(databasePath);
  control.exec("CREATE TABLE contention_control (id INTEGER)");
});

afterEach(async () => {
  await worker?.terminate();
  worker = undefined;
  control.close();
  closeAuditDb();
  if (previousDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousDb;
  await rm(root, { recursive: true, force: true });
});

it("waits for a real concurrent WAL writer before checking the idempotency key", async () => {
  worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.modulePath);
    const db = new Database(workerData.databasePath);
    db.exec('BEGIN IMMEDIATE');
    parentPort.postMessage('locked');
    setTimeout(() => {
      db.exec('INSERT INTO contention_control VALUES (1); COMMIT');
      db.close();
      parentPort.close();
    }, 150);
  `, { eval: true, workerData: { databasePath, modulePath: require.resolve("better-sqlite3") } });
  await new Promise<void>((resolve, reject) => {
    worker!.once("message", () => resolve());
    worker!.once("error", reject);
  });
  const saved = await saveBudgetState("contended", state, "request-1");
  expect(saved.row.calls).toBe(1);
  expect(saved.appliedKeys).toEqual(["request-1"]);
  expect(control.prepare("SELECT COUNT(*) AS n FROM contention_control").get()).toEqual({ n: 1 });
  const replay = await saveBudgetState("contended", { ...state, calls: 9 }, "request-1");
  expect(replay.row.calls).toBe(1);
});

it("rolls back a real storage failure without committing the idempotency key", async () => {
  control.exec(`CREATE TRIGGER reject_budget BEFORE INSERT ON question_budget_state
    WHEN NEW.scope_key = 'failed' BEGIN SELECT RAISE(FAIL, 'storage unavailable'); END`);
  await expect(saveBudgetState("failed", state, "request-2")).rejects.toThrow("storage unavailable");
  expect(await loadBudgetState("failed")).toBeNull();
  expect(control.prepare("SELECT COUNT(*) AS n FROM question_budget_idempotency WHERE scope_key = 'failed'").get()).toEqual({ n: 0 });
  control.exec("DROP TRIGGER reject_budget");
  expect((await saveBudgetState("failed", state, "request-2")).row.calls).toBe(1);
});
