import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousContentRoot: string | undefined;
let previousRebuildOnRead: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-relief-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousRebuildOnRead = process.env.LUCY_TURN_REBUILD_ON_READ;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  delete process.env.LUCY_TURN_REBUILD_ON_READ;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousRebuildOnRead === undefined) delete process.env.LUCY_TURN_REBUILD_ON_READ;
  else process.env.LUCY_TURN_REBUILD_ON_READ = previousRebuildOnRead;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("SC-01 read path does not rebuild inferred turns", () => {
  it("GET /api/admin/audit/turns does not call rebuildInferredTurns", async () => {
    const proxyAudit = await import("../proxy/audit.js");
    const spy = vi.spyOn(proxyAudit, "rebuildInferredTurns");
    await proxyAudit.writeLog({
      ts: new Date().toISOString(),
      userId: "agent-a",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 12,
      requestId: "req-1",
      tables: ["orders"]
    });
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    spy.mockClear();
    const response = await request(app.server).get("/api/admin/audit/turns?hours=168&source=all");
    expect(response.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
    expect(response.body.data.inferredRebuild).toMatchObject({
      complete: expect.any(Boolean),
      pendingUsers: expect.any(Number)
    });
    await app.close();
  }, 20_000);
});

describe("SC-02 access-map read does not rebuild", () => {
  it("defaultEnsureInquiryRebuild does not call rebuildInferredTurns", async () => {
    const proxyAudit = await import("../proxy/audit.js");
    const spy = vi.spyOn(proxyAudit, "rebuildInferredTurns");
    const echo = await import("../admin/access-map-echo.js");
    await echo.defaultEnsureInquiryRebuild({
      db: { prepare: () => ({ all: () => [], get: () => undefined }) },
      userIds: ["agent-a"]
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("SC-03 inferred turn maintainer", () => {
  it("rebuilds only users with new calls, and a failure does not block the others", async () => {
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE access_log (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, user_id TEXT NOT NULL)`);
    const insert = db.prepare(`INSERT INTO access_log (ts, user_id) VALUES (?, ?)`);
    const t0 = new Date().toISOString();
    insert.run(t0, "good");
    insert.run(t0, "bad");
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (userId) => {
        if (userId === "bad") throw new Error("boom");
        rebuilt.push(userId);
      }
    });
    await maintainer.catchUp();
    expect(rebuilt).toEqual(["good"]);
    expect(maintainer.status().complete).toBe(false);
    expect(maintainer.status().pendingUsers).toBe(1);

    rebuilt.length = 0;
    insert.run(new Date(Date.now() + 1000).toISOString(), "next");
    await maintainer.pollOnce();
    await maintainer.runPass();
    expect(rebuilt).toEqual(["next"]);
    expect(maintainer.status().pendingUsers).toBe(1);
    db.close();
  });
});

describe("SC-08 rollback switch", () => {
  it("rebuilds on read when LUCY_TURN_REBUILD_ON_READ=1", async () => {
    const proxyAudit = await import("../proxy/audit.js");
    const spy = vi.spyOn(proxyAudit, "rebuildInferredTurns");
    await proxyAudit.writeLog({
      ts: new Date().toISOString(),
      userId: "agent-rollback",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 8,
      requestId: "req-rollback",
      tables: ["orders"]
    });
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    spy.mockClear();
    process.env.LUCY_TURN_REBUILD_ON_READ = "1";
    const response = await request(app.server).get("/api/admin/audit/turns?hours=168&source=inferred");
    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    await app.close();
  });
});

describe("SC-16 admin indexes", () => {
  it("creates access_log(ts) and access_log(lucy_turn_id)", async () => {
    const { getAuditDb } = await import("../admin/audit.js");
    const database = await getAuditDb();
    const names = new Set(
      (database.prepare(`PRAGMA index_list(access_log)`).all() as Array<{ name: string }>).map((row) => row.name)
    );
    expect(names.has("idx_al_ts")).toBe(true);
    expect(names.has("idx_al_lucy_turn_id")).toBe(true);
  });
});

describe("SC-06 enrich query count", () => {
  async function readsFor(rows: number): Promise<number> {
    vi.resetModules();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-relief-count-"));
    await writeFile(path.join(dir, "ktx.yaml"), "connections: {}\n", "utf8");
    process.env.KTX_PROJECT_ROOT = dir;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
    const { getAuditDb } = await import("../admin/audit.js");
    const database = await getAuditDb();
    const insert = database.prepare(
      `INSERT INTO access_log (ts, user_id, tool, outcome, duration_ms, request_id) VALUES (?, 'scale-user', 'lucy_query', 'ok', 5, ?)`
    );
    const now = new Date().toISOString();
    const tx = database.transaction((count: number) => {
      for (let i = 0; i < count; i += 1) insert.run(now, `scale-${count}-${i}`);
    });
    tx(rows);
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    let calls = 0;
    const original = database.prepare.bind(database);
    database.prepare = ((sql: string) => {
      calls += 1;
      const stmt = original(sql);
      const all = stmt.all.bind(stmt);
      stmt.all = ((...args: unknown[]) => {
        calls += 1;
        return all(...args);
      }) as typeof stmt.all;
      return stmt;
    }) as typeof database.prepare;
    const response = await request(app.server).get("/api/admin/audit/turns?hours=168&source=all");
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBeGreaterThan(0);
    await app.close();
    await rm(dir, { recursive: true, force: true });
    return calls;
  }

  it("does not grow with the number of inquiries", async () => {
    const small = await readsFor(50);
    const large = await readsFor(5_000);
    expect(small).toBeGreaterThan(0);
    expect(large).toBe(small);
  }, 30_000);
});

describe("SC-07 projection read path", () => {
  it("does not call runProjection and does trigger the scheduler", async () => {
    const projector = await import("../security/projector.js");
    const run = vi.spyOn(projector, "runProjection");
    const trigger = vi.fn();
    projector.registerProjectionTrigger(trigger);
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    run.mockClear();
    trigger.mockClear();
    const response = await request(app.server).get("/api/admin/audit/turns?hours=24");
    expect(response.status).toBe(200);
    expect(run).not.toHaveBeenCalled();
    expect(trigger).toHaveBeenCalled();
    projector.registerProjectionTrigger(null);
    await app.close();
  });
});

describe("SC-10 livez", () => {
  it("returns 200 without sqlite or a ktx process", async () => {
    const prepare = vi.spyOn(Database.prototype, "prepare");
    const { buildServer } = await import("../index.js");
    const { ktxRuntimeSpawnCount, resetKtxRuntimeSpawnCountForTests } = await import("../ktx-runtime.js");
    const { isPublicApi } = await import("../auth/guard.js");
    resetKtxRuntimeSpawnCountForTests();
    const app = buildServer();
    await app.ready();
    prepare.mockClear();
    const before = ktxRuntimeSpawnCount();
    const response = await app.inject({ method: "GET", url: "/api/livez" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(isPublicApi("GET", "/api/livez")).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(ktxRuntimeSpawnCount()).toBe(before);
    await app.close();
  });
});

describe("SC-11 readyz and SC-12 health cache", () => {
  it("is 503 until warmup, then 200 even when ktx is degraded, and does not spawn ktx", async () => {
    const { buildServer } = await import("../index.js");
    const { markWebuiWarmupComplete, resetWebuiWarmupForTests } = await import("../runtime/readiness.js");
    const { setKtxRuntimeStatusForTests, ktxRuntimeSpawnCount, resetKtxRuntimeSpawnCountForTests } = await import("../ktx-runtime.js");
    resetWebuiWarmupForTests();
    resetKtxRuntimeSpawnCountForTests();
    const app = buildServer();
    await app.ready();
    const before = ktxRuntimeSpawnCount();
    const cold = await app.inject({ method: "GET", url: "/api/readyz" });
    expect(cold.statusCode).toBe(503);
    expect(cold.json().reason).toBe("warming_up");
    markWebuiWarmupComplete();
    setKtxRuntimeStatusForTests({ ready: false, status: "missing", detail: "down" });
    const warm = await app.inject({ method: "GET", url: "/api/readyz" });
    expect(warm.statusCode).toBe(200);
    expect(warm.json().ok).toBe(true);
    expect(warm.json().data.ktxRuntime.ready).toBe(false);
    expect(ktxRuntimeSpawnCount()).toBe(before);
    await app.close();
  });

  it("spawns ktx at most once across 20 health reads", async () => {
    const { resetKtxRuntimeCacheForTests, resetKtxRuntimeSpawnCountForTests, ktxRuntimeSpawnCount } = await import("../ktx-runtime.js");
    resetKtxRuntimeCacheForTests();
    resetKtxRuntimeSpawnCountForTests();
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const before = ktxRuntimeSpawnCount();
    for (let i = 0; i < 20; i += 1) {
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.eventLoop).toMatchObject({ windowSeconds: 60 });
    }
    expect(ktxRuntimeSpawnCount() - before).toBeLessThanOrEqual(1);
    await app.close();
  });
});

describe("SC-09 /api/diff scans once", () => {
  it("scans the content tree once and keeps each file diff", async () => {
    const wiki = path.join(projectRoot, "wiki");
    await mkdir(wiki, { recursive: true });
    for (let i = 0; i < 17; i += 1) {
      await writeFile(path.join(wiki, `note-${i}.md`), `# note ${i}\n`, "utf8");
    }
    const state = await import("../publish-workbench-state.js");
    const scan = vi.spyOn(state, "scanPublishContent");
    const impact = await import("../publish-impact.js");
    let inflight = 0;
    let maxInflight = 0;
    const actual = impact.readPublishEvidence;
    vi.spyOn(impact, "readPublishEvidence").mockImplementation(async (...args) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await actual(...args);
      } finally {
        inflight -= 1;
      }
    });
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    scan.mockClear();
    const response = await request(app.server).get("/api/diff");
    expect(response.status).toBe(200);
    expect(response.body.data.files.length).toBeGreaterThanOrEqual(17);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(maxInflight).toBeLessThanOrEqual(4);
    expect(maxInflight).toBeGreaterThan(1);
    await app.close();
  }, 20_000);
});
