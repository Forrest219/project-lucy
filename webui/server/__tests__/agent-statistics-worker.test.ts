import { mkdtemp, rm, rename, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuditDb, resetAuditDbForTests } from "../admin/audit.js";
import { closeAgentStatisticsWorkers, readAgentStatisticsInWorker } from "../admin/agent-statistics-display.js";
import * as queries from "../admin/agent-statistics-queries.js";
import { buildAgentStatsWindow } from "../admin/metric-window.js";

let root: string;
let oldDb: string | undefined;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "racs-readonly-worker-"));
  oldDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(root, "audit.sqlite");
  resetAuditDbForTests();
  const db = await getAuditDb();
  db.pragma("journal_mode=WAL");
});
afterEach(async () => {
  await closeAgentStatisticsWorkers();
  resetAuditDbForTests();
  if (oldDb === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = oldDb;
  await rm(root, { recursive: true, force: true });
});
function input() {
  return { projectRoot: root, dbPath: path.join(root, "audit.sqlite"), key: "fixture-generation",
    users: [{ id: "reader", name: "Reader", enabled: true, tokens: [{ hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", label: "t", created: "2026-01-01" }] }], range: "7d" as const, refresh: false };
}
async function seed(ts = new Date(Date.now() - 1000).toISOString()) {
  const db = await getAuditDb();
  db.prepare(`INSERT INTO access_log(ts,user_id,tool,outcome,duration_ms,request_id,policy_version,token_hash_prefix,client_ip)
    VALUES (?, 'reader','lucy_query','ok',1,'racs-worker-test','racs','sha256:aaaaaaaaaaaa','198.51.100.1')`).run(ts);
  return db;
}
describe("P1-58 bounded read-only worker observations", () => {
  it("reopens the actual source after an unavailable path is restored", async () => {
    await seed();
    expect((await readAgentStatisticsInWorker(input())).stats[0]?.[1].callsLast7d).toBe(1);
    const file = path.join(root, "audit.sqlite"), saved = file + ".saved";
    await rename(file, saved); await mkdir(file);
    try { await expect(readAgentStatisticsInWorker({ ...input(), refresh: true })).rejects.toThrow(); }
    finally { await rm(file, { recursive: true }); await rename(saved, file); }
    const recovered = await readAgentStatisticsInWorker({ ...input(), refresh: true });
    expect(recovered.stats[0]?.[1].callsLast7d).toBe(1);
    expect(recovered.globalActiveTokenCount).toBe(1);
  }, 15000);
  it("adds D7 covering indexes to an existing database and reopening is idempotent", async () => {
    const db = await seed();
    db.exec("DROP INDEX idx_al_agent_window_cover; DROP INDEX idx_al_ts_token");
    resetAuditDbForTests();
    const upgraded = await getAuditDb();
    expect(upgraded.prepare("SELECT COUNT(*) n FROM access_log").get()).toEqual({ n: 1 });
    expect((upgraded.pragma("index_info(idx_al_agent_window_cover)") as Array<{name:string}>).map((row: {name:string}) => row.name))
      .toEqual(["user_id", "ts", "token_hash_prefix", "tool", "outcome", "eval_mark", "args_summary", "tables", "client_ip"]);
    expect((upgraded.pragma("index_info(idx_al_ts_token)") as Array<{name:string}>).map((row: {name:string}) => row.name))
      .toEqual(["ts", "token_hash_prefix"]);
    resetAuditDbForTests();
    const reopened = await getAuditDb();
    expect(reopened.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('idx_al_agent_window_cover','idx_al_ts_token')").get()).toEqual({ n: 2 });
    expect(reopened.prepare("SELECT COUNT(*) n FROM access_log").get()).toEqual({ n: 1 });
  });
  it("matches the independent legacy read paths including future IPs, empty subjects and unknown global prefixes", async () => {
    const db = await seed();
    const anchor = Date.now();
    await seed(new Date(anchor - 15 * 86400000).toISOString());
    await seed(new Date(anchor + 86400000).toISOString());
    db.prepare(`INSERT INTO access_log(ts,user_id,tool,outcome,duration_ms,request_id,policy_version,token_hash_prefix)
      VALUES (?,'unknown','server/probe','ok',1,'unknown-prefix','racs','unknown-prefix')`).run(new Date(anchor - 1000).toISOString());
    const users = [...input().users, { id: "empty", name: "Empty", enabled: true, tokens: [] }];
    for (const range of ["7d", "14d", "30d"] as const) {
      const window = buildAgentStatsWindow(range, new Date(anchor));
      const snapshot = queries.captureAgentAuditReadSnapshot(db);
      const read = await readAgentStatisticsInWorker({ ...input(), users, range, refresh: true });
      const batch = { ...read, stats: new Map(read.stats), tokenUsage: new Map(read.tokenUsage.map(([id, tokens]) => [id, new Map(tokens)])) };
      expect(batch.stats).toEqual(queries.queryAgentStatsFromDb(db, users, read.window, snapshot));
      expect(batch.globalActiveTokenCount).toBe(queries.queryGlobalActiveTokenCount(db, read.window, snapshot));
      expect(batch.tokenUsage).toEqual(queries.queryLastUsedMapFromDb(db, users.map(user => user.id), snapshot, users, Date.parse(read.asOf)));
      expect(batch.stats.get("empty")?.callsLast7d).toBe(0);
      expect(batch.globalActiveTokenCount).toBe(2);
    }
    // No in-window row for this subject, while the all-history/latest IP still exists.
    db.prepare("DELETE FROM access_log WHERE ts < ?").run(new Date(anchor).toISOString());
    const window = buildAgentStatsWindow("30d", new Date(anchor));
    const snapshot = queries.captureAgentAuditReadSnapshot(db);
    const futureRead = await readAgentStatisticsInWorker({ ...input(), users, range: "30d", refresh: true });
    const futureOnly = { stats: new Map(futureRead.stats), tokenUsage: new Map(futureRead.tokenUsage.map(([id, tokens]) => [id, new Map(tokens)])) };
    expect(futureOnly.stats.get("reader")?.callsLast7d).toBe(0);
    expect(futureOnly.tokenUsage.get("reader")?.values().next().value?.distinctIps7d).toBe(1);
  });
  it("returns a correct 5–10 second read with its original asOf and does not cache it", async () => {
    const db = await seed();
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.pragma("journal_mode=DELETE");
    const sqlite = createRequire(import.meta.url).resolve("better-sqlite3");
    const child = spawn(process.execPath, ["-e", `const Database=require(${JSON.stringify(sqlite)});
      const db=new Database(${JSON.stringify(path.join(root, "audit.sqlite"))});
      db.exec('BEGIN EXCLUSIVE');process.stdout.write('locked\\n');
      setTimeout(()=>{db.exec('ROLLBACK');db.close();},5400);`], { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once("data", () => resolve()); child.once("error", reject);
        child.once("exit", (code) => { if (code) reject(new Error("lock process failed")); });
      });
      const started = Date.now();
      const result = await readAgentStatisticsInWorker(input());
      const finished = Date.now();
      expect(finished - started).toBeGreaterThan(5000);
      expect(finished - started).toBeLessThan(10000);
      expect(result.stats[0]?.[1].callsLast7d).toBe(1);
      expect(Date.parse(result.asOf)).toBeLessThanOrEqual(started + 20);
      const next = await readAgentStatisticsInWorker(input());
      expect(Date.parse(next.asOf)).toBeGreaterThan(Date.parse(result.asOf));
      expect(next.stats[0]?.[1].callsLast7d).toBe(1);
    } finally { child.kill(); }
  }, 20000);
  it("preserves the original timestamp on a completed-cache hit and force refresh reads actual changes", async () => {
    const db = await seed();
    const first = await readAgentStatisticsInWorker(input());
    expect(first.stats[0]?.[1].callsLast7d).toBe(1);
    const cached = await readAgentStatisticsInWorker(input());
    expect(cached.asOf).toBe(first.asOf);
    db.prepare("UPDATE access_log SET outcome='denied'").run();
    const fresh = await readAgentStatisticsInWorker({ ...input(), refresh: true });
    expect(fresh.stats[0]?.[1].deniedLast7d).toBe(1);
    expect(Date.parse(fresh.asOf)).toBeGreaterThanOrEqual(Date.parse(first.asOf));
  }, 15000);

  it("detects UPDATE and DELETE with an unchanged MAX(id), and never re-stamps stale aggregates", async () => {
    const db = await seed();
    const first = await readAgentStatisticsInWorker(input());
    db.prepare("UPDATE access_log SET outcome='denied'").run();
    await pause(5100);
    const updated = await readAgentStatisticsInWorker(input());
    expect(updated.stats[0]?.[1].deniedLast7d).toBe(1);
    expect(Date.parse(updated.asOf)).toBeGreaterThan(Date.parse(first.asOf));
    db.prepare("DELETE FROM access_log").run();
    const removed = await readAgentStatisticsInWorker({ ...input(), refresh: true });
    expect(removed.stats[0]?.[1].callsLast7d).toBe(0);
  }, 20000);

  it("expires rows that cross the moving window boundary even without any database write", async () => {
    await seed(new Date(Date.now() - 7 * 86400000 + 3500).toISOString());
    const first = await readAgentStatisticsInWorker(input());
    expect(first.stats[0]?.[1].callsLast7d).toBe(1);
    await pause(5100);
    const shifted = await readAgentStatisticsInWorker(input());
    expect(shifted.stats[0]?.[1].callsLast7d).toBe(0);
    expect(Date.parse(shifted.window.startIso)).toBeGreaterThan(Date.parse(first.window.startIso));
  }, 20000);

  it("also advances the seven-day token IP boundary when the requested statistics window is thirty days", async () => {
    await seed(new Date(Date.now() - 7 * 86400000 + 3500).toISOString());
    const request = { ...input(), range: "30d" as const };
    const first = await readAgentStatisticsInWorker(request);
    expect(first.tokenUsage[0]?.[1][0]?.[1].distinctIps7d).toBe(1);
    await pause(5100);
    const shifted = await readAgentStatisticsInWorker(request);
    expect(shifted.stats[0]?.[1].callsLast7d).toBe(1);
    expect(shifted.tokenUsage[0]?.[1][0]?.[1].lastUsed).toBe(first.tokenUsage[0]?.[1][0]?.[1].lastUsed);
    expect(shifted.tokenUsage[0]?.[1][0]?.[1].distinctIps7d).toBeUndefined();
  }, 20000);
});
