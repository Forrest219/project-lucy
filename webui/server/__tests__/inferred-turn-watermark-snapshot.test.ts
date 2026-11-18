import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * The rebuild watermark is the snapshot that was actually read.
 * A call inserted while the rebuild is yielding must stay uncovered until a later pass.
 * Same-timestamp and older-timestamp rows are uncovered when their id is above that snapshot.
 */

async function isolateAuditDb(): Promise<{ root: string; auditDb: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-watermark-"));
  const auditDb = path.join(root, "audit.sqlite");
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDb;
  return { root, auditDb };
}

afterEach(async () => {
  const { closeAuditDb } = await import("../proxy/audit.js");
  closeAuditDb();
  const root = process.env.KTX_PROJECT_ROOT;
  delete process.env.LUCY_AUDIT_DB;
  delete process.env.KTX_PROJECT_ROOT;
  delete process.env.LUCY_CONTENT_ROOT;
  if (root) await rm(root, { recursive: true, force: true });
});

async function logCall(userId: string, requestId: string, ts: string): Promise<void> {
  const { writeLog } = await import("../proxy/audit.js");
  await writeLog({
    ts,
    userId,
    tool: "lucy_query",
    outcome: "ok",
    durationMs: 1,
    requestId
  });
}

describe("inferred rebuild watermark", () => {
  it("does not treat a call inserted during rebuild as already covered", async () => {
    const { auditDb } = await isolateAuditDb();
    const { rebuildInferredTurns, closeAuditDb } = await import("../proxy/audit.js");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");
    await logCall("race-user", "initial", new Date(Date.now() - 3_600_000).toISOString());
    const pending = rebuildInferredTurns("race-user");
    await new Promise<void>((resolve, reject) => {
      setImmediate(() => {
        logCall("race-user", "during-rebuild", new Date(Date.now() - 60_000).toISOString()).then(() => resolve(), reject);
      });
    });
    await pending;
    closeAuditDb();

    const db = new Database(auditDb);
    try {
      const state = db.prepare(`SELECT watermark_id AS id FROM inferred_rebuild_state WHERE user_id = ?`).get("race-user") as { id: number };
      const linked = db.prepare(`SELECT COALESCE(MAX(access_log_id), 0) AS id FROM inferred_turn_access_logs`).get() as { id: number };
      expect(state.id).toBe(linked.id);

      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => db,
        rebuild: async (userId) => {
          rebuilt.push(userId);
          await rebuildInferredTurns(userId);
        }
      });
      await maintainer.catchUp();
      const links = db.prepare(`SELECT COUNT(*) AS n FROM inferred_turn_access_logs`).get() as { n: number };
      const rows = db.prepare(`SELECT COUNT(*) AS n FROM access_log`).get() as { n: number };
      expect(rows.n).toBe(2);
      expect(links.n).toBe(2);
      if (linked.id < 2) expect(rebuilt).toContain("race-user");
    } finally {
      db.close();
      closeAuditDb();
    }
  });

  it("rebuilds a same-timestamp call and a delayed older-timestamp call, and skips a user with no new id", async () => {
    await isolateAuditDb();
    const { rebuildInferredTurns } = await import("../proxy/audit.js");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");
    const sameTs = new Date(Date.now() - 3_600_000).toISOString();
    const olderTs = new Date(Date.now() - 7_200_000).toISOString();
    const newerTs = new Date(Date.now() - 30 * 60_000).toISOString();
    await logCall("same-ts", "first", sameTs);
    await logCall("quiet", "only", sameTs);
    await logCall("delayed", "first", newerTs);
    await rebuildInferredTurns("same-ts");
    await rebuildInferredTurns("quiet");
    await rebuildInferredTurns("delayed");
    await logCall("same-ts", "second-same-ts", sameTs);
    await logCall("delayed", "backdated", olderTs);

    const db = new Database(process.env.LUCY_AUDIT_DB!);
    try {
      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => db,
        rebuild: async (userId) => { rebuilt.push(userId); }
      });
      await maintainer.catchUp();
      expect(rebuilt).toContain("same-ts");
      expect(rebuilt).toContain("delayed");
      expect(rebuilt).not.toContain("quiet");
    } finally {
      db.close();
    }
  });
});
