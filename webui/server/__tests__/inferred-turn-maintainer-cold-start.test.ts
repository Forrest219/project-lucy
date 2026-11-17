import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-39 冷启动审计库整表扫描消除（Spec lucy-20261117-cold-start-audit-scan-spec.md）。
 * 这些测试是热缓存下能跑的**结构守卫**：执行计划、等价、让出、覆盖判定、分页预算。
 * 慢盘冷缓存下是否真的过，只认测试台 UAT-SUITE-COLD-START-SLOW-DISK。
 */

const NOW = Date.parse("2026-11-17T12:00:00.000Z");
const LOOKBACK_MS = 24 * 30 * 3_600_000;
const CUTOFF = new Date(NOW - LOOKBACK_MS).toISOString();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const MIN = 60_000;
const DAY = 86_400_000;

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL, tool TEXT, pad TEXT);
    CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX idx_al_ts ON access_log(ts);
    CREATE TABLE inferred_turns (inferred_turn_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX idx_it_user_time ON inferred_turns(user_id, started_at, ended_at);
  `);
  return db;
}

function insertLogs(db: Database.Database, rows: Array<[string, string]>): void {
  const stmt = db.prepare(`INSERT INTO access_log (ts, user_id, tool, pad) VALUES (?, ?, 'lucy_query', 'x')`);
  db.transaction(() => { for (const [ts, user] of rows) stmt.run(ts, user); })();
}

function insertTurn(db: Database.Database, id: string, user: string, startedAt: string, updatedAt: string): void {
  db.prepare(`INSERT INTO inferred_turns (inferred_turn_id, user_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, user, startedAt, startedAt, updatedAt);
}

async function loadMaintainer() {
  return await import("../admin/inferred-turn-maintainer.js");
}

describe("SC-01 plan guard: startup scan and poll never scan access_log", () => {
  it("every statement prepared by catchUp and pollOnce avoids SCAN on access_log and inferred_turns", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, Array.from({ length: 5000 }, (_, i) => [iso(-(i % 20) * DAY - MIN), `user-${i % 67}`] as [string, string]));
    insertTurn(db, "t1", "user-1", iso(-DAY), iso(-DAY));
    const prepared: string[] = [];
    const spied = new Proxy(db, {
      get(target, prop) {
        if (prop === "prepare") return (sql: string) => { prepared.push(sql); return target.prepare(sql); };
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
    });
    const maintainer = createInferredTurnMaintainer({ getDb: async () => spied as unknown as Database.Database, rebuild: async () => {}, now: () => NOW });
    await maintainer.catchUp();
    insertLogs(db, [[iso(1000), "user-3"]]);
    await maintainer.pollOnce();

    const unique = [...new Set(prepared)].filter((sql) => /access_log|inferred_turns/.test(sql));
    expect(unique.length).toBeGreaterThan(0);
    for (const sql of unique) {
      const placeholders = (sql.match(/\?/g) ?? []).length;
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array(placeholders).fill("1")) as Array<{ detail: string }>;
      const text = plan.map((row) => row.detail).join(" | ");
      expect(text, `SQL: ${sql}`).not.toMatch(/SCAN (access_log|inferred_turns)/);
    }
    db.close();
  });
});

describe("SC-02 startup scan equals the old DISTINCT set when nothing is covered", () => {
  it("includes ts == cutoff, excludes users with only old rows, spans several yields", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    const rows: Array<[string, string]> = [];
    for (let i = 0; i < 100; i += 1) rows.push([iso(-DAY), `u-in-${String(i).padStart(3, "0")}`]);
    for (let i = 0; i < 40; i += 1) rows.push([iso(-40 * DAY), `u-old-${String(i).padStart(3, "0")}`]);
    rows.push([CUTOFF, "u-edge"], [new Date(Date.parse(CUTOFF) - 1).toISOString(), "u-before"]);
    rows.push([iso(-45 * DAY), "u-mixed"], [iso(-2 * DAY), "u-mixed"]);
    insertLogs(db, rows);
    const expected = (db.prepare(`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`).all(CUTOFF) as Array<{ user_id: string }>).map((r) => r.user_id).sort();
    expect(expected.length).toBe(102);
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilt.push(u); }, now: () => NOW });
    await maintainer.catchUp();
    expect([...rebuilt].sort()).toEqual(expected);
    expect(rebuilt).not.toContain("u-before");
    expect(rebuilt).toContain("u-edge");
    db.close();
  });
});

describe("SC-14 users already covered by a recent rebuild are not rebuilt on restart", () => {
  it("rebuilds only users with rows newer than their last rebuild (minus the safety margin)", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, [
      [iso(-2 * 60 * MIN), "A-covered"],
      [iso(-10 * MIN), "B-new-row"],
      [iso(-35 * MIN), "C-after-rebuild"],
      [iso(-40 * MIN), "D-inside-margin"],
      [iso(-3 * DAY), "E-never-built"]
    ]);
    insertTurn(db, "a-old", "A-covered", iso(-5 * DAY), iso(-3 * DAY));
    insertTurn(db, "a-new", "A-covered", iso(-2 * 60 * MIN), iso(-30 * MIN));
    insertTurn(db, "b", "B-new-row", iso(-4 * 60 * MIN), iso(-30 * MIN));
    insertTurn(db, "c", "C-after-rebuild", iso(-4 * 60 * MIN), iso(-36 * MIN));
    insertTurn(db, "d", "D-inside-margin", iso(-4 * 60 * MIN), iso(-30 * MIN));
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilt.push(u); }, now: () => NOW });
    await maintainer.catchUp();
    expect([...rebuilt].sort()).toEqual(["B-new-row", "C-after-rebuild", "D-inside-margin", "E-never-built"]);
    expect(rebuilt).not.toContain("A-covered");
    db.close();
  });

  it("treats everyone as uncovered when the inferred_turns table is missing", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE access_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL); CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);`);
    const insert = db.prepare(`INSERT INTO access_log (ts, user_id) VALUES (?, ?)`);
    insert.run(iso(-DAY), "x");
    insert.run(iso(-DAY), "y");
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilt.push(u); }, now: () => NOW });
    await maintainer.catchUp();
    expect([...rebuilt].sort()).toEqual(["x", "y"]);
    db.close();
  });
});

describe("SC-03 poll reads by id watermark in pages", () => {
  it("touches every user across three pages exactly once and does not re-read old rows", async () => {
    const { createInferredTurnMaintainer, INFERRED_POLL_PAGE } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, [[iso(-DAY), "seed-user"]]);
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({ getDb: async () => db, rebuild: async (u) => { rebuilt.push(u); }, now: () => NOW });
    await maintainer.catchUp();
    rebuilt.length = 0;

    const total = INFERRED_POLL_PAGE * 2 + 500;
    insertLogs(db, Array.from({ length: total }, (_, i) => [iso(1000 + i), `p-${i}`] as [string, string]));
    await maintainer.pollOnce();
    await maintainer.runPass();
    expect(rebuilt.length).toBe(total);
    expect(new Set(rebuilt).size).toBe(total);

    rebuilt.length = 0;
    await maintainer.pollOnce();
    await maintainer.runPass();
    expect(rebuilt).toEqual([]);
    db.close();
  });
});

describe("SC-04 startup scan yields to the event loop", () => {
  it("a macrotask queued before catchUp runs before the first rebuild when there are more than 64 users", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, Array.from({ length: 130 }, (_, i) => [iso(-DAY), `y-${String(i).padStart(3, "0")}`] as [string, string]));
    let macrotaskRan = false;
    setImmediate(() => { macrotaskRan = true; });
    let ranBeforeFirstRebuild: boolean | null = null;
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async () => { if (ranBeforeFirstRebuild === null) ranBeforeFirstRebuild = macrotaskRan; },
      now: () => NOW
    });
    await maintainer.catchUp();
    expect(ranBeforeFirstRebuild).toBe(true);
    db.close();
  });
});

describe("SC-16 the first scan waits until the server is listening", () => {
  it("touches neither the database nor rebuild before the gate opens", async () => {
    const { createInferredTurnMaintainer } = await loadMaintainer();
    const db = makeDb();
    insertLogs(db, [[iso(-DAY), "late-user"]]);
    let getDbCalls = 0;
    const rebuilt: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => { getDbCalls += 1; return db; },
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => NOW,
      pollMs: 5
    });
    await maintainer.start({ after: gate });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getDbCalls).toBe(0);
    expect(rebuilt).toEqual([]);
    open();
    await vi.waitFor(() => expect(rebuilt).toEqual(["late-user"]));
    maintainer.stop();
    db.close();
  });
});

describe("SC-13 rebuild page size follows a time budget", () => {
  it("shrinks after a slow page, grows at most 1.5x after a fast one, and stays within 25..400", async () => {
    const { nextRebuildPageSize, REBUILD_PAGE_MIN, REBUILD_PAGE_MAX, REBUILD_PAGE_INITIAL } = await import("../admin/page-budget.js");
    expect(REBUILD_PAGE_MIN).toBe(25);
    expect(REBUILD_PAGE_MAX).toBe(400);
    expect(REBUILD_PAGE_INITIAL).toBeLessThanOrEqual(100);
    expect(nextRebuildPageSize(400, 3000)).toBe(25);
    expect(nextRebuildPageSize(400, 5900)).toBe(25);
    expect(nextRebuildPageSize(60, 3000)).toBe(25);
    expect(nextRebuildPageSize(50, 2)).toBe(75);
    expect(nextRebuildPageSize(300, 2)).toBe(400);
    expect(nextRebuildPageSize(400, 100)).toBe(400);
    expect(nextRebuildPageSize(400, 200)).toBe(200);
    expect(nextRebuildPageSize(100, 0)).toBe(150);
  });
});

describe("SC-17 duty cycle: a long stretch is followed by an idle window", () => {
  it("pauses roughly as long as the stretch (capped), skips the timer for short stretches, never hangs under fake timers", async () => {
    const { pauseAfterStretch, PAUSE_CAP_MS } = await import("../admin/yield-slices.js");
    expect(PAUSE_CAP_MS).toBe(250);
    const measure = async (stretchMs: number) => {
      const t = performance.now();
      await pauseAfterStretch(stretchMs);
      return performance.now() - t;
    };
    expect(await measure(120)).toBeGreaterThanOrEqual(100);
    expect(await measure(5000)).toBeLessThan(400);
    expect(await measure(5)).toBeLessThan(40);
    vi.useFakeTimers();
    try {
      await pauseAfterStretch(300);
    } finally {
      vi.useRealTimers();
    }
  });

  it("write slices shrink after a slow slice and stay within 2..25", async () => {
    const { nextSliceSize } = await import("../admin/page-budget.js");
    expect(nextSliceSize(25, 800, 2, 25)).toBe(3);
    expect(nextSliceSize(25, 5000, 2, 25)).toBe(2);
    expect(nextSliceSize(6, 20, 2, 25)).toBe(9);
    expect(nextSliceSize(20, 20, 2, 25)).toBe(25);
  });
});

describe("SC-17 the rebuild really rests after its synchronous stretches", () => {
  let dir: string;
  let previousAuditDb: string | undefined;
  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(path.join(os.tmpdir(), "lucy-rest-"));
    previousAuditDb = process.env.LUCY_AUDIT_DB;
    process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
  });
  afterEach(async () => {
    vi.doUnmock("../admin/yield-slices.js");
    if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = previousAuditDb;
    await rm(dir, { recursive: true, force: true });
  });

  it("calls pauseAfterStretch between pages, after clustering and between write slices", async () => {
    const calls: number[] = [];
    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return { ...actual, pauseAfterStretch: (ms: number) => { calls.push(ms); return actual.yieldToEventLoop(); } };
    });
    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(), userId: "rest-user", lucySessionId: "rest-s", tool: "sl_query",
      tables: ["dataforai.superstore_orders"], outcome: "ok", durationMs: 1, requestId: "rest-0"
    });
    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        // Gaps over 120 s split the rows into many clusters, so the write loop runs several slices.
        for (let i = 1; i < 400; i += 1) {
          insert.run(new Date(base + i * 130_000).toISOString(), "rest-user", `rest-s-${i}`, "sl_query", JSON.stringify(["dataforai.superstore_orders"]), "ok", 1, `rest-${i}`);
        }
      })();
    } finally {
      seed.close();
    }
    await proxyAudit.rebuildInferredTurns("rest-user", { lookbackHours: 24 * 30, gapMs: 120_000 });
    proxyAudit.closeAuditDb();
    // 400 rows: at least pages (50, 75, ...), the clustering rest, the assign rest and several write slices.
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(calls.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });
});

describe("SC-05 audit databases are ready before listen", () => {
  let dir: string;
  let previousAuditDb: string | undefined;
  let previousRoot: string | undefined;
  beforeEach(async () => {
    vi.resetModules();
    dir = await mkdtemp(path.join(os.tmpdir(), "lucy-warm-"));
    previousAuditDb = process.env.LUCY_AUDIT_DB;
    previousRoot = process.env.KTX_PROJECT_ROOT;
    process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
    process.env.KTX_PROJECT_ROOT = dir;
  });
  afterEach(async () => {
    if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = previousAuditDb;
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT; else process.env.KTX_PROJECT_ROOT = previousRoot;
    await rm(dir, { recursive: true, force: true });
  });

  it("after warm-up the first real work changes no schema, and the schema-ready line carries both timings", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { warmAuditDatabases } = await import("../admin/audit-warmup.js");
    const result = await warmAuditDatabases();
    expect(result.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.foreignKeyCheckMs).toBeGreaterThanOrEqual(0);
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => /\[lucy-audit\] schema ready in \d+ms \(foreign_key_check \d+ms\)/.test(l));
    expect(line).toBeTruthy();

    const schemaVersion = (): number => {
      const probe = new Database(process.env.LUCY_AUDIT_DB!, { readonly: true });
      try {
        return Number(probe.pragma("schema_version", { simple: true }));
      } finally {
        probe.close();
      }
    };
    const before = schemaVersion();
    const { getAuditDb } = await import("../admin/audit.js");
    const proxyAudit = await import("../proxy/audit.js");
    await getAuditDb();
    await proxyAudit.rebuildInferredTurns("nobody");
    expect(schemaVersion()).toBe(before);
    proxyAudit.closeAuditDb();
    info.mockRestore();
  });
});
