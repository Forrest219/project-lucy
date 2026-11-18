import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P1-50 / FDE R01: rebuild freezes ceilingId = MAX(id) for the read snapshot,
 * but historically wrote MAX(ts) as the completion watermark. A row inserted
 * during rebuild with id > ceiling and ts ≤ watermarkTs had no inferred link
 * yet covered() returned true — so it was never rebuilt.
 */

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-rebuild-wm-race-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("P1-50 rebuild watermark race (FDE R01)", () => {
  it("row inserted during rebuild with same/earlier ts stays uncovered without a link", async () => {
    const { writeLog, rebuildInferredTurns, INFERRED_REBUILD_CLUSTER_SLICE } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const clusters = INFERRED_REBUILD_CLUSTER_SLICE + 1;
    for (let i = 0; i < clusters; i += 1) {
      await writeLog({
        ts: new Date(base + i * 1000).toISOString(),
        userId: "wm-race-user",
        lucySessionId: `wm-race-session-${i}`,
        tool: "sl_query",
        tables: ["dataforai.superstore_orders"],
        outcome: "ok",
        durationMs: 1,
        requestId: `wm-race-${i}`
      });
    }

    let lateId = 0;
    const watch = () => {
      const db = new Database(auditDbPath);
      try {
        if (lateId === 0) {
          // Same/earlier ts than some rows already in the window, but higher id.
          const inserted = db.prepare(
            `INSERT INTO access_log (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            new Date(base + 500).toISOString(),
            "wm-race-user",
            "wm-race-session-late",
            "sl_query",
            JSON.stringify(["dataforai.superstore_orders"]),
            "ok",
            1,
            "wm-race-late"
          );
          lateId = Number(inserted.lastInsertRowid);
        }
      } finally {
        db.close();
      }
      if (lateId === 0) setImmediate(watch);
    };
    setImmediate(watch);

    const result = await rebuildInferredTurns("wm-race-user", { lookbackHours: 24, gapMs: 120_000 });
    expect(result.turns).toBe(clusters);
    expect(lateId).toBeGreaterThan(0);

    const db = new Database(auditDbPath);
    try {
      const lateLinked = db.prepare(
        `SELECT COUNT(*) AS cnt FROM inferred_turn_access_logs WHERE access_log_id = ?`
      ).get(lateId) as { cnt: number };
      expect(lateLinked.cnt).toBe(0);

      const state = db.prepare(
        `SELECT status, watermark FROM inferred_rebuild_state WHERE user_id = ?`
      ).get("wm-race-user") as { status: string; watermark: string };
      expect(state.status).toBe("complete");
      // Watermark must be the frozen id ceiling, not an ISO timestamp.
      expect(state.watermark).toMatch(/^\d+$/);
      expect(Number(state.watermark)).toBeLessThan(lateId);

      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => db,
        rebuild: async (u) => { rebuilt.push(u); },
        now: () => Date.now()
      });
      await maintainer.catchUp();
      // Must not be covered without a link — maintainer schedules another rebuild.
      expect(rebuilt).toContain("wm-race-user");
    } finally {
      db.close();
    }
  });
});
