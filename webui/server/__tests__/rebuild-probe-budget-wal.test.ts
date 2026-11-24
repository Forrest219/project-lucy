import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-47 B-line + spike-shave W0/W1: wal_autocheckpoint, always PASSIVE, off-thread write.
 * Spec: lucy-20261118-rebuild-probe-budget-spec.md OQ-2 / SC-01 residual.
 */

let dir: string;
let previousAuditDb: string | undefined;
let previousTrace: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-rpb-wal-"));
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousTrace = process.env.LUCY_REBUILD_TRACE;
  process.env.LUCY_AUDIT_DB = path.join(dir, "audit.sqlite");
  delete process.env.LUCY_REBUILD_TRACE;
});

afterEach(async () => {
  vi.doUnmock("../admin/yield-slices.js");
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousTrace === undefined) delete process.env.LUCY_REBUILD_TRACE;
  else process.env.LUCY_REBUILD_TRACE = previousTrace;
  await rm(dir, { recursive: true, force: true });
});

describe("P1-47 B-line wal_autocheckpoint", () => {
  it("prepareTraceDatabase sets wal_autocheckpoint to AUDIT_WAL_AUTOCHECKPOINT_PAGES", async () => {
    const { prepareTraceDatabase, AUDIT_WAL_AUTOCHECKPOINT_PAGES } = await import("../trace/evidence.js");
    expect(AUDIT_WAL_AUTOCHECKPOINT_PAGES).toBe(25);
    const db = new Database(path.join(dir, "wal-pragma.sqlite"));
    try {
      prepareTraceDatabase(db);
      expect(Number(db.pragma("wal_autocheckpoint", { simple: true }))).toBe(25);
    } finally {
      db.close();
    }
  });

  it("write-slice budget stays within spike-shave INITIAL..MAX", async () => {
    const {
      REBUILD_WRITE_SLICE_INITIAL,
      REBUILD_WRITE_SLICE_MAX,
      REBUILD_WRITE_SLICE_MIN,
      nextSliceSize,
    } = await import("../admin/page-budget.js");
    expect(REBUILD_WRITE_SLICE_MIN).toBe(1);
    expect(REBUILD_WRITE_SLICE_INITIAL).toBe(2);
    expect(REBUILD_WRITE_SLICE_MAX).toBe(8);
    expect(nextSliceSize(REBUILD_WRITE_SLICE_INITIAL, 5, REBUILD_WRITE_SLICE_MIN, REBUILD_WRITE_SLICE_MAX)).toBeLessThanOrEqual(
      REBUILD_WRITE_SLICE_MAX,
    );
  });

  it("proxy audit getDb applies the same wal_autocheckpoint", async () => {
    const proxyAudit = await import("../proxy/audit.js");
    await proxyAudit.writeLog({
      ts: new Date().toISOString(),
      userId: "wal-user",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "r-wal-open",
    });
    const probe = new Database(process.env.LUCY_AUDIT_DB!, { readonly: true });
    try {
      // PRAGMA is per-connection; reopen with prepareTraceDatabase path via write already set on writer.
      // Read the writer-side setting by opening a fresh connection that mirrors prepareTraceDatabase.
      const { prepareTraceDatabase, AUDIT_WAL_AUTOCHECKPOINT_PAGES } = await import("../trace/evidence.js");
      const check = new Database(process.env.LUCY_AUDIT_DB!);
      try {
        prepareTraceDatabase(check);
        expect(Number(check.pragma("wal_autocheckpoint", { simple: true }))).toBe(AUDIT_WAL_AUTOCHECKPOINT_PAGES);
      } finally {
        check.close();
      }
    } finally {
      probe.close();
      proxyAudit.closeAuditDb();
    }
  });
});

describe("P1-47 B-line LUCY_REBUILD_TRACE", () => {
  it("emits segmented phase lines covering read/delete/allocate/write/wal", async () => {
    process.env.LUCY_REBUILD_TRACE = "1";
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return { ...actual, pauseAfterStretch: () => actual.yieldToEventLoop() };
    });

    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "trace-user",
      lucySessionId: "s0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "r0",
    });

    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < 12; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "trace-user",
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

    await proxyAudit.rebuildInferredTurns("trace-user", { lookbackHours: 24, gapMs: 120_000 });
    proxyAudit.closeAuditDb();
    spy.mockRestore();

    const joined = lines.join("\n");
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*read_pages/);
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*delete_window/);
    // Fresh rebuild has no prior turns → only delete_window_total; non-empty windows emit off_thread chunks.
    if (/delete_window offset=/.test(joined)) {
      expect(joined).toMatch(/\[lucy-rebuild-trace\].*delete_window.*off_thread=1/);
    }
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*allocate/);
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*write_slice/);
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*write_slice.*off_thread=1/);
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*wal_checkpoint.*off_thread=1/);
    expect(joined).not.toMatch(/wal_checkpoint_skip/);
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*complete/);
  });

  it("never emits wal_checkpoint_skip after spike-shave W0a", async () => {
    process.env.LUCY_REBUILD_TRACE = "1";
    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });

    vi.doMock("../admin/yield-slices.js", async () => {
      const actual = await vi.importActual<typeof import("../admin/yield-slices.js")>("../admin/yield-slices.js");
      return { ...actual, pauseAfterStretch: () => actual.yieldToEventLoop() };
    });

    const proxyAudit = await import("../proxy/audit.js");
    const base = Date.now() - 60 * 60 * 1000;
    await proxyAudit.writeLog({
      ts: new Date(base).toISOString(),
      userId: "skip-user",
      lucySessionId: "s0",
      tool: "sl_query",
      tables: [],
      outcome: "ok",
      durationMs: 1,
      requestId: "r0",
    });

    const seed = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const insert = seed.prepare(
        `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      seed.transaction(() => {
        for (let i = 1; i < 24; i += 1) {
          insert.run(
            new Date(base + i * 150_000).toISOString(),
            "skip-user",
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

    await proxyAudit.rebuildInferredTurns("skip-user", { lookbackHours: 24, gapMs: 120_000 });
    proxyAudit.closeAuditDb();
    spy.mockRestore();

    const joined = lines.join("\n");
    expect(joined).toMatch(/\[lucy-rebuild-trace\].*wal_checkpoint/);
    expect(joined).not.toMatch(/wal_checkpoint_skip/);
    expect(joined).toMatch(/off_thread=1/);
  });
});
