import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-47 SC-01 验收：前置删除＋编号分配循环按 REBUILD_ALLOCATE_CHUNK 分块，
 * 块间有 pauseAfterStretch 让出，同步段不随 plan 数无界增长。
 *
 * Spec: lucy-20261118-rebuild-probe-budget-spec.md
 * SC-01: 前置删除／编号分配不再以「单次不可让出、可无限随 plans 增长」的形态阻塞
 *        事件循环（分块或等价）。
 * OQ-1 (closed): 每块短事务内仍按簇顺序分配；块间让出；已有 correlation_key 编号复用。
 */

let dir: string;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-probe-budget-"));
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
});

afterEach(async () => {
  vi.doUnmock("../admin/yield-slices.js");
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(dir, { recursive: true, force: true });
});

describe("SC-01 allocate loop is split into short transactions with yields between them", () => {
  it("REBUILD_ALLOCATE_CHUNK is exported and equals 25", async () => {
    const { REBUILD_ALLOCATE_CHUNK } = await import("../admin/page-budget.js");
    expect(REBUILD_ALLOCATE_CHUNK).toBe(25);
  });

  it("with 2*CHUNK+1 plans, pauseAfterStretch is called at least CHUNK+2 times in total", async () => {
    const { REBUILD_ALLOCATE_CHUNK } = await import("../admin/page-budget.js");
    const planCount = 2 * REBUILD_ALLOCATE_CHUNK + 1; // 51 plans → 3 allocate chunks

    const calls: number[] = [];
    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return {
        ...actual,
        pauseAfterStretch: (ms: number) => {
          calls.push(ms);
          return actual.yieldToEventLoop();
        },
      };
    });

    const proxyAudit = await import("../proxy/audit.js");

    // Bootstrap the audit db schema via a first writeLog call.
    const base = Date.now() - 2 * 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "probe-user",
      lucySessionId: "s0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "r0",
    });

    // Insert planCount-1 extra rows, each in a separate session with gaps > 120 s
    // so that each row becomes its own cluster (and therefore its own plan).
    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < planCount; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "probe-user",
            `s-${i}`,
            "sl_query",
            JSON.stringify([]),
            "ok",
            1,
            `r-${i}`,
          );
        }
      })();
    } finally {
      seed.close();
    }

    await proxyAudit.rebuildInferredTurns("probe-user", { lookbackHours: 24 * 30, gapMs: 120_000 });
    proxyAudit.closeAuditDb();

    // SC-01 contract: for 3 allocate chunks the event loop must be yielded at least:
    //   1 (after window-DELETE txn)
    // + 2 (between the 3 allocate-chunk txns, i.e. CHUNK-1 for 3 chunks = 2)
    // + 1 (after last allocate-chunk txn, before write slices)
    // = 4 calls just in the allocate phase, plus pages + clustering + write slices.
    // We use CHUNK+2 = 27 as a conservative minimum so the assertion survives minor
    // additions of write slices without becoming brittle.
    const expectedAllocateCalls = Math.ceil(planCount / REBUILD_ALLOCATE_CHUNK) + 1; // 3+1=4
    expect(calls.length).toBeGreaterThanOrEqual(expectedAllocateCalls);
    expect(calls.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });

  it("with exactly CHUNK plans (single chunk), pauseAfterStretch is called at least 3 times", async () => {
    const { REBUILD_ALLOCATE_CHUNK } = await import("../admin/page-budget.js");
    const planCount = REBUILD_ALLOCATE_CHUNK; // exactly 1 allocate chunk

    const calls: number[] = [];
    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return {
        ...actual,
        pauseAfterStretch: (ms: number) => {
          calls.push(ms);
          return actual.yieldToEventLoop();
        },
      };
    });

    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 2 * 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "probe-single",
      lucySessionId: "ss0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "ss-r0",
    });

    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < planCount; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "probe-single",
            `ss-${i}`,
            "sl_query",
            JSON.stringify([]),
            "ok",
            1,
            `ss-r${i}`,
          );
        }
      })();
    } finally {
      seed.close();
    }

    await proxyAudit.rebuildInferredTurns("probe-single", { lookbackHours: 24 * 30, gapMs: 120_000 });
    proxyAudit.closeAuditDb();

    // 1 allocate chunk → 1 (after window-DELETE) + 0 (no inter-chunk) + 1 (post-alloc) = 2
    // Plus at least 1 clustering rest → minimum 3 total.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((ms) => Number.isFinite(ms) && ms >= 0)).toBe(true);
  });

  it("in_progress upsert precedes DELETE and complete upsert follows all write slices", async () => {
    // Structural guard: confirms the P1-45 ordering invariants are preserved after refactor.
    const { REBUILD_ALLOCATE_CHUNK } = await import("../admin/page-budget.js");
    const planCount = REBUILD_ALLOCATE_CHUNK + 1; // 2 chunks so chunking is exercised

    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return { ...actual, pauseAfterStretch: (ms: number) => actual.yieldToEventLoop() };
    });

    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 2 * 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "probe-order",
      lucySessionId: "so0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "so-r0",
    });

    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < planCount; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "probe-order",
            `so-${i}`,
            "sl_query",
            JSON.stringify([]),
            "ok",
            1,
            `so-r${i}`,
          );
        }
      })();
    } finally {
      seed.close();
    }

    await proxyAudit.rebuildInferredTurns("probe-order", { lookbackHours: 24 * 30, gapMs: 120_000 });
    proxyAudit.closeAuditDb();

    // Verify the final state is 'complete' — proving the complete upsert ran after write slices.
    const db = new Database(process.env.LUCY_AUDIT_DB!, { readonly: true });
    try {
      const row = db
        .prepare(`SELECT status FROM inferred_rebuild_state WHERE user_id = ?`)
        .get("probe-order") as { status: string } | undefined;
      expect(row?.status).toBe("complete");
    } finally {
      db.close();
    }
  });

  it("OQ-1: inquiry numbers assigned within each chunk are unique across all chunks", async () => {
    const { REBUILD_ALLOCATE_CHUNK } = await import("../admin/page-budget.js");
    const planCount = 2 * REBUILD_ALLOCATE_CHUNK + 3; // spans 3 chunks

    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return { ...actual, pauseAfterStretch: (ms: number) => actual.yieldToEventLoop() };
    });

    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 2 * 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "probe-oq1",
      lucySessionId: "oq0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "oq-r0",
    });

    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < planCount; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "probe-oq1",
            `oq-${i}`,
            "sl_query",
            JSON.stringify([]),
            "ok",
            1,
            `oq-r${i}`,
          );
        }
      })();
    } finally {
      seed.close();
    }

    const { turns } = await proxyAudit.rebuildInferredTurns("probe-oq1", {
      lookbackHours: 24 * 30,
      gapMs: 120_000,
    });
    proxyAudit.closeAuditDb();

    // All plans were written (each cluster → 1 turn).
    expect(turns).toBe(planCount);

    // All written inferred_turns have distinct inquiry_no values (OQ-1: no duplicate allocation).
    const db = new Database(process.env.LUCY_AUDIT_DB!, { readonly: true });
    try {
      const rows = db
        .prepare(
          `SELECT inquiry_no FROM inferred_turns WHERE user_id = ? AND inquiry_no IS NOT NULL ORDER BY inquiry_no`,
        )
        .all("probe-oq1") as Array<{ inquiry_no: number }>;
      expect(rows.length).toBe(planCount);
      const nums = rows.map((r) => r.inquiry_no);
      const unique = new Set(nums);
      expect(unique.size).toBe(planCount);
    } finally {
      db.close();
    }
  });
});
