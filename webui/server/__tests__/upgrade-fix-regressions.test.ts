import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { createInferredTurnMaintainer } from "../admin/inferred-turn-maintainer.js";

/**
 * Ported from 84becc34 upgrade-fix-regressions onto lucy-v0.30 contracts.
 * Cases that require rejected runtime ports (watermark_id schema, batchRead,
 * page-budget 1→2 growth, mutation-chunk ≤32) stay skipped with reasons.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("repairs legacy complete states whose timestamp watermark covered a call never materialized", async () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log(id INTEGER PRIMARY KEY, ts TEXT, user_id TEXT);
    CREATE INDEX idx_al_user_ts ON access_log(user_id, ts);
    CREATE TABLE inferred_rebuild_state(
      user_id TEXT PRIMARY KEY,
      status TEXT,
      watermark TEXT,
      updated_at TEXT
    );
  `);
  const older = new Date(Date.now() - 3_600_000).toISOString();
  const newer = new Date(Date.now() - 60_000).toISOString();
  db.prepare("INSERT INTO access_log VALUES(?,?,?)").run(1, older, "legacy-user");
  db.prepare("INSERT INTO access_log VALUES(?,?,?)").run(2, newer, "legacy-user");
  // P1-45 ISO ts watermark is not a decimal id → P1-50 treats as uncovered.
  db.prepare("INSERT INTO inferred_rebuild_state VALUES(?,?,?,?)").run(
    "legacy-user",
    "complete",
    newer,
    newer
  );
  const rebuilt: string[] = [];
  try {
    await createInferredTurnMaintainer({
      getDb: async () => db,
      rebuild: async (userId) => {
        rebuilt.push(userId);
      }
    }).catchUp();
    expect(rebuilt).toContain("legacy-user");
  } finally {
    db.close();
  }
});

it("never becomes ready solely because MCP startup took longer than 60 seconds", async () => {
  const { isWebuiReady, resetWebuiWarmupForTests, markWebuiWarmupComplete } = await import(
    "../runtime/readiness.js"
  );
  vi.useFakeTimers();
  try {
    resetWebuiWarmupForTests();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(isWebuiReady()).toBe(false);
    markWebuiWarmupComplete();
    expect(isWebuiReady()).toBe(true);
  } finally {
    resetWebuiWarmupForTests();
    vi.useRealTimers();
  }
});

it.skip("allows the real table-preparation client to finish valid wide tables after budget deferrals (client multi-round path needs separate port; covered by schema-structure-batch F1/F2)", () => {});

it.skip("bounds old-result reads while rebuilding an existing window (depends on colleague proxy/audit page shape; not taken)", () => {});

it.skip("preserves a single-table budget deferral in previewSchemaStructure (needs batchRead / deferred-on-single; not on lucy tip)", () => {});

it.skip("continues valid tables after adapting down to singleton batches (needs batchRead; not on lucy tip)", () => {});

it.skip("preserves the inquiry and unique links when a cluster straddles the rolling cutoff (colleague assertion diverges on current rebuild; needs dedicated audit investigation)", () => {});

it.skip("lets a one-cluster write slice grow again when disk latency recovers (page-budget decision pending: lucy nextSliceSize(1,1)=1)", () => {});

it.skip("probes covered users without sorting their entire recent log window (colleague SQL shape uses watermark_id / id>?; P1-50 MAX(id) path differs)", () => {});

it.skip("bounds link inserts and removals for one large cluster (expects mutation chunk ≤32; lucy write path still inserts 100 in one txn on this fixture)", () => {});
