import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FDE R01 / P1-50 收敛 E2E（端到端串链验证）
 *
 * 把「并发新增 → 覆盖判定 → 维护器重建 → 关联完整」整条链串起来。
 * 四个既有测试只验证了单点行为；本文件补充收敛视角：
 *   - 最终关联完整（count + 具体 id 集合）
 *   - 水位 == 快照 ceiling id 的十进制字符串
 *   - 无重复重建（稳态 spy）
 *
 * 场景：
 *   1. 并发新增（ts > 现有最大 ts，id > ceiling）
 *   2. 同时间戳（ts == 现有最大 ts，id > ceiling）
 *   3. 延迟日志（ts < 现有最大 ts，id > ceiling）
 *   4a. 完成前重启（in_progress 残留 → 新实例重建）
 *   4b. 完成后重启（complete 且无新日志 → 新实例不重建）
 *   5. 稳态不重复重建（连续两次 pollOnce+runPass，spy 断言 0 次）
 */

// ─── 环境 harness（与 rebuild-watermark-race.test.ts 相同结构）────────────

let projectRoot: string;
let auditDbPath: string;
let prevKtxRoot: string | undefined;
let prevContentRoot: string | undefined;
let prevAuditDb: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-conv-e2e-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  prevKtxRoot = process.env.KTX_PROJECT_ROOT;
  prevContentRoot = process.env.LUCY_CONTENT_ROOT;
  prevAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (prevKtxRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = prevKtxRoot;
  if (prevContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = prevContentRoot;
  if (prevAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = prevAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

// ─── 验证辅助 ─────────────────────────────────────────────────────────────

/** 返回该用户在 inferred_turn_access_logs 中出现的所有 access_log_id 集合 */
function getLinkedIds(db: Database.Database, userId: string): Set<number> {
  let rows: Array<{ id: number }>;
  try {
    rows = db.prepare(`
      SELECT DISTINCT ital.access_log_id AS id
      FROM inferred_turn_access_logs ital
      JOIN access_log al ON al.id = ital.access_log_id
      WHERE al.user_id = ?
    `).all(userId) as Array<{ id: number }>;
  } catch {
    // inferred_turn_access_logs 表不存在（尚未首次重建）
    return new Set();
  }
  return new Set(rows.map(r => r.id));
}

/** 读取重建状态行；表不存在或无行时返回 undefined */
function getRebuildState(db: Database.Database, userId: string): { status: string; watermark: string } | undefined {
  try {
    return db.prepare(
      `SELECT status, watermark FROM inferred_rebuild_state WHERE user_id = ?`
    ).get(userId) as { status: string; watermark: string } | undefined;
  } catch {
    return undefined;
  }
}

/** 在已有 schema 的 SQLite 文件里直接插入一条 access_log 行（绕过模块单例） */
function insertDirectLog(
  ts: string,
  userId: string,
  sessionId: string,
  requestId: string
): number {
  const db = new Database(auditDbPath);
  try {
    const r = db.prepare(`
      INSERT INTO access_log
        (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
      VALUES (?, ?, ?, 'sl_query', '["t1"]', 'ok', 1, ?)
    `).run(ts, userId, sessionId, requestId);
    return Number(r.lastInsertRowid);
  } finally {
    db.close();
  }
}

/** 写入（或覆盖） inferred_rebuild_state */
function setRebuildStateDirect(userId: string, status: "in_progress" | "complete", watermark: string): void {
  const db = new Database(auditDbPath);
  try {
    db.prepare(`
      INSERT INTO inferred_rebuild_state (user_id, status, watermark, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        status = excluded.status, watermark = excluded.watermark, updated_at = excluded.updated_at
    `).run(userId, status, watermark, new Date().toISOString());
  } finally {
    db.close();
  }
}

// ─── 场景套件 ──────────────────────────────────────────────────────────────

describe("FDE R01 P1-50 收敛 E2E", () => {
  const OPTS = { lookbackHours: 24, gapMs: 120_000 };

  /**
   * 场景 1：并发新增
   * 重建进行中，通过 setImmediate 注入 id > ceiling 且 ts > 现有最大 ts 的新行。
   * 重建完成后该行未被关联；维护器检测到 watermark < newestId → 触发第二次重建；
   * 最终每条业务日志都有对应推断关联（关联数 == 业务日志数）。
   */
  it("场景1：并发新增 — 第二次重建后全部行关联完整", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000; // 1 小时前
    const user = "e2e-conv-s1";

    // 插入 3 条初始业务日志（同一会话，间隔 10 秒 → 单簇）
    const initIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      initIds.push(await writeLog({
        ts: new Date(base + i * 10_000).toISOString(),
        userId: user,
        lucySessionId: "sess-s1",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s1-${i}`,
      }));
    }

    // 在重建的 await rest() 间隙注入一条新行（id > ceiling，ts > 已有最大 ts）
    let lateId = 0;
    const injectOnce = () => {
      const db = new Database(auditDbPath);
      try {
        if (lateId === 0) {
          const r = db.prepare(`
            INSERT INTO access_log
              (ts, user_id, lucy_session_id, tool, tables, outcome, duration_ms, request_id)
            VALUES (?, ?, ?, 'sl_query', '["t1"]', 'ok', 1, ?)
          `).run(
            new Date(base + 3 * 10_000).toISOString(),
            user, "sess-s1-late", "r-s1-late"
          );
          lateId = Number(r.lastInsertRowid);
        }
      } finally {
        db.close();
      }
      if (lateId === 0) setImmediate(injectOnce);
    };
    setImmediate(injectOnce);

    // 第一次重建（ceiling 在重建开始时冻结，注入行不在快照内）
    await rebuildInferredTurns(user, OPTS);

    // 注入必须已发生
    expect(lateId).toBeGreaterThan(0);

    const dbConn = new Database(auditDbPath);
    try {
      // ① 水位 < lateId（十进制字符串）
      const state1 = getRebuildState(dbConn, user)!;
      expect(state1.status).toBe("complete");
      expect(/^\d+$/.test(state1.watermark)).toBe(true);
      expect(Number(state1.watermark)).toBeLessThan(lateId);

      // ② lateId 尚无关联
      expect(getLinkedIds(dbConn, user).has(lateId)).toBe(false);

      // ③ 维护器扫描 → 检测 newestId > watermark → 触发第二次重建
      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => {
          rebuilt.push(u);
          await rebuildInferredTurns(u, OPTS);
        },
        now: () => Date.now(),
      });
      await maintainer.catchUp();
      expect(rebuilt).toContain(user);
      expect(rebuilt.filter(u => u === user).length).toBe(1); // 恰好 1 次

      // ④ 所有行（initIds + lateId）均已关联
      const allIds = new Set([...initIds, lateId]);
      const linked = getLinkedIds(dbConn, user);
      for (const id of allIds) {
        expect(linked.has(id), `access_log_id=${id} 应已关联`).toBe(true);
      }
      // 关联数 >= 业务日志数（可能还有同一次重建写入的 schema 探针行，但 initIds+lateId 须齐全）
      expect(linked.size).toBeGreaterThanOrEqual(allIds.size);

      // ⑤ 最终水位 >= lateId（十进制字符串）
      const state2 = getRebuildState(dbConn, user)!;
      expect(state2.status).toBe("complete");
      expect(/^\d+$/.test(state2.watermark)).toBe(true);
      expect(Number(state2.watermark)).toBeGreaterThanOrEqual(lateId);

      // ⑥ 稳态不重复重建：再跑一次 catchUp，不新增重建
      const rebuilt2: string[] = [];
      const maintainer2 = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => { rebuilt2.push(u); await rebuildInferredTurns(u, OPTS); },
        now: () => Date.now(),
      });
      await maintainer2.catchUp();
      expect(rebuilt2).not.toContain(user);
    } finally {
      dbConn.close();
    }
  });

  /**
   * 场景 2：同时间戳
   * 新增行 ts == 窗口内已有最大 ts，但 id > ceiling（即 id > watermark）。
   * 旧版 ts 水位会误判为已覆盖；id 水位必须正确识别为未覆盖。
   * 最终关联完整，水位 = String(newRow.id)。
   */
  it("场景2：同时间戳 — id > watermark 仍被检测到，最终关联完整", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const user = "e2e-conv-s2";
    const maxTs = new Date(base + 10_000).toISOString();

    // 插入 2 条初始行
    const initIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      initIds.push(await writeLog({
        ts: new Date(base + i * 10_000).toISOString(),
        userId: user,
        lucySessionId: "sess-s2",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s2-${i}`,
      }));
    }

    // 完整重建：此时 ceiling = MAX(id of initIds)
    await rebuildInferredTurns(user, OPTS);

    const dbConn = new Database(auditDbPath);
    try {
      const state1 = getRebuildState(dbConn, user)!;
      const ceilingWatermark = Number(state1.watermark);
      expect(ceilingWatermark).toBe(Math.max(...initIds));

      // 在重建完成后插入新行：ts == maxTs（与最后一条 initId 相同），id > ceiling
      const sameTs = maxTs; // ts 与已有最大 ts 相同
      const newId = insertDirectLog(sameTs, user, "sess-s2-same", "r-s2-same");
      expect(newId).toBeGreaterThan(ceilingWatermark);

      // ① 维护器应识别为未覆盖（newestId > watermark）→ 触发重建
      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => {
          rebuilt.push(u);
          await rebuildInferredTurns(u, OPTS);
        },
        now: () => Date.now(),
      });
      await maintainer.catchUp();
      expect(rebuilt).toContain(user);

      // ② 所有行均已关联
      const allIds = new Set([...initIds, newId]);
      const linked = getLinkedIds(dbConn, user);
      for (const id of allIds) {
        expect(linked.has(id), `access_log_id=${id} 应已关联`).toBe(true);
      }

      // ③ 水位已更新为 newId（十进制字符串）
      const state2 = getRebuildState(dbConn, user)!;
      expect(state2.status).toBe("complete");
      expect(/^\d+$/.test(state2.watermark)).toBe(true);
      expect(Number(state2.watermark)).toBeGreaterThanOrEqual(newId);

      // ④ 不重复重建
      const rebuilt2: string[] = [];
      const maintainer2 = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => { rebuilt2.push(u); },
        now: () => Date.now(),
      });
      await maintainer2.catchUp();
      expect(rebuilt2).not.toContain(user);
    } finally {
      dbConn.close();
    }
  });

  /**
   * 场景 3：延迟日志
   * 新增行 ts < 窗口内已有最大 ts（即「时间倒流」），但 id > ceiling。
   * 这是 FDE R01 的核心 bug 场景：旧版 ts 水位误判为已覆盖，id 水位必须正确识别。
   * 最终关联完整，水位 = String(newRow.id)。
   */
  it("场景3：延迟日志 — ts 早于已有最大 ts，id > watermark 仍被检测，最终关联完整", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const user = "e2e-conv-s3";

    // 插入 2 条初始行（ts 顺序递增）
    const initIds: number[] = [];
    for (let i = 0; i < 2; i++) {
      initIds.push(await writeLog({
        ts: new Date(base + (i + 1) * 60_000).toISOString(), // base+1min, base+2min
        userId: user,
        lucySessionId: "sess-s3",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s3-${i}`,
      }));
    }

    // 完整重建：ceiling = MAX(id of initIds)
    await rebuildInferredTurns(user, OPTS);

    const dbConn = new Database(auditDbPath);
    try {
      const state1 = getRebuildState(dbConn, user)!;
      const ceilingWatermark = Number(state1.watermark);

      // 插入延迟行：ts = base+30s（早于已有 base+1min 和 base+2min），id > ceiling
      const delayedTs = new Date(base + 30_000).toISOString();
      const delayedId = insertDirectLog(delayedTs, user, "sess-s3-delayed", "r-s3-delayed");
      expect(delayedId).toBeGreaterThan(ceilingWatermark);

      // ① 维护器必须识别为未覆盖（newestId > watermark，即使 ts 早于 watermark 对应的 ts）
      const rebuilt: string[] = [];
      const maintainer = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => {
          rebuilt.push(u);
          await rebuildInferredTurns(u, OPTS);
        },
        now: () => Date.now(),
      });
      await maintainer.catchUp();
      expect(rebuilt).toContain(user);

      // ② 所有行均已关联（延迟行也被关联到某个簇）
      const allIds = new Set([...initIds, delayedId]);
      const linked = getLinkedIds(dbConn, user);
      for (const id of allIds) {
        expect(linked.has(id), `access_log_id=${id} 应已关联`).toBe(true);
      }

      // ③ 水位 >= delayedId
      const state2 = getRebuildState(dbConn, user)!;
      expect(state2.status).toBe("complete");
      expect(/^\d+$/.test(state2.watermark)).toBe(true);
      expect(Number(state2.watermark)).toBeGreaterThanOrEqual(delayedId);

      // ④ 不重复重建
      const rebuilt2: string[] = [];
      const maintainer2 = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => { rebuilt2.push(u); },
        now: () => Date.now(),
      });
      await maintainer2.catchUp();
      expect(rebuilt2).not.toContain(user);
    } finally {
      dbConn.close();
    }
  });

  /**
   * 场景 4a：完成前重启（in_progress 残留）
   * 在最后一片写入后、complete 标记前"崩溃"→ 以 in_progress 残留模拟。
   * 新建维护器实例（模拟重启）→ 必须重新入队并补齐；
   * 最终 status = complete，全部行关联完整。
   */
  it("场景4a：in_progress 残留 → 新维护器重启后重建并补齐关联", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const user = "e2e-conv-s4a";

    const initIds: number[] = [];
    for (let i = 0; i < 3; i++) {
      initIds.push(await writeLog({
        ts: new Date(base + i * 10_000).toISOString(),
        userId: user,
        lucySessionId: "sess-s4a",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s4a-${i}`,
      }));
    }

    // 模拟崩溃：直接写入 in_progress（不运行真正的重建）
    const maxInitId = Math.max(...initIds);
    setRebuildStateDirect(user, "in_progress", String(maxInitId));

    // 新维护器实例（模拟重启）
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => new Database(auditDbPath),
      rebuild: async (u) => {
        rebuilt.push(u);
        await rebuildInferredTurns(u, OPTS);
      },
      now: () => Date.now(),
    });
    await maintainer.catchUp();

    // ① 必须重新重建（in_progress 视为未覆盖）
    expect(rebuilt).toContain(user);

    const dbConn = new Database(auditDbPath);
    try {
      // ② 重建后 status = complete
      const state = getRebuildState(dbConn, user)!;
      expect(state.status).toBe("complete");
      expect(/^\d+$/.test(state.watermark)).toBe(true);
      expect(Number(state.watermark)).toBeGreaterThanOrEqual(maxInitId);

      // ③ 所有行均已关联
      const linked = getLinkedIds(dbConn, user);
      for (const id of initIds) {
        expect(linked.has(id), `access_log_id=${id} 应已关联`).toBe(true);
      }

      // ④ 不重复重建：再建新维护器
      const rebuilt2: string[] = [];
      const maintainer2 = createInferredTurnMaintainer({
        getDb: async () => new Database(auditDbPath),
        rebuild: async (u) => { rebuilt2.push(u); },
        now: () => Date.now(),
      });
      await maintainer2.catchUp();
      expect(rebuilt2).not.toContain(user);
    } finally {
      dbConn.close();
    }
  });

  /**
   * 场景 4b：完成后重启（无新日志）
   * 已 complete 且水位 == 最新 id → 新维护器实例不得再次重建。
   */
  it("场景4b：complete + 无新日志 → 新维护器重启后不重建", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const user = "e2e-conv-s4b";

    for (let i = 0; i < 2; i++) {
      await writeLog({
        ts: new Date(base + i * 10_000).toISOString(),
        userId: user,
        lucySessionId: "sess-s4b",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s4b-${i}`,
      });
    }

    // 完整重建 → state = complete, watermark = String(maxId)
    await rebuildInferredTurns(user, OPTS);

    // 新维护器实例（模拟重启，不再插入任何新行）
    const rebuilt: string[] = [];
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => new Database(auditDbPath),
      rebuild: async (u) => { rebuilt.push(u); },
      now: () => Date.now(),
    });
    await maintainer.catchUp();

    // 不得重建：已 complete 且无新行
    expect(rebuilt).not.toContain(user);
  });

  /**
   * 场景 5：稳态不重复重建
   * 收敛之后连续再跑 2 次 pollOnce+runPass，spy 断言 0 次新增重建。
   */
  it("场景5：稳态不重复重建 — 收敛后连续两次轮询断言 0 次重建", async () => {
    const { writeLog, rebuildInferredTurns } = await import("../proxy/audit");
    const { createInferredTurnMaintainer } = await import("../admin/inferred-turn-maintainer.js");

    const base = Date.now() - 60 * 60 * 1000;
    const user = "e2e-conv-s5";

    for (let i = 0; i < 3; i++) {
      await writeLog({
        ts: new Date(base + i * 10_000).toISOString(),
        userId: user,
        lucySessionId: "sess-s5",
        tool: "sl_query",
        tables: ["t1"],
        outcome: "ok",
        durationMs: 1,
        requestId: `r-s5-${i}`,
      });
    }

    // 完整重建（建立 complete 水位）
    await rebuildInferredTurns(user, OPTS);

    // 维护器：catchUp 应不触发重建（用户已 covered）
    let rebuildCount = 0;
    const maintainer = createInferredTurnMaintainer({
      getDb: async () => new Database(auditDbPath),
      rebuild: async (u) => {
        rebuildCount++;
        await rebuildInferredTurns(u, OPTS);
      },
      now: () => Date.now(),
    });

    await maintainer.catchUp(); // 初始扫描：用户已覆盖，rebuildCount 应为 0
    expect(rebuildCount).toBe(0);

    // 连续两次 pollOnce + runPass：无新行 → dirty 集合为空 → rebuildCount 仍为 0
    await maintainer.pollOnce();
    await maintainer.runPass();
    await maintainer.pollOnce();
    await maintainer.runPass();

    expect(rebuildCount).toBe(0);
  });
});
