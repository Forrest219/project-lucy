import type Database from "better-sqlite3";
import { INFERRED_TURN_REBUILD_LOOKBACK_HOURS } from "../proxy/audit.js";
import { yieldToEventLoop } from "./yield-slices.js";

/** P1-39: 轮询每页读取的新行数；每页之间让出事件循环。 */
export const INFERRED_POLL_PAGE = 2000;
/** P1-39: 启动补算每探测这么多用户让出一次事件循环。 */
export const INFERRED_SCAN_YIELD_USERS = 64;
/**
 * P1-39: 最近一次重建的 updated_at 减去该余量后，仍不早于窗口内最新一行 ts，才算「已覆盖」。
 * 余量吸收 ts 取自写入前、updated_at 取自重建时的时钟差与进程内水位尚未补算的小窗。
 */
export const INFERRED_COVERAGE_MARGIN_MS = 15 * 60_000;

export type InferredRebuildStatus = {
  complete: boolean;
  pendingUsers: number;
  lastCompletedAt: string | null;
  /** P1-47 暂停开关：后台补算已被运维关闭，问询分组不再随新调用更新（此时 complete 恒为 false）。 */
  paused?: boolean;
};

/**
 * P1-47 暂停开关：`LUCY_INFERRED_MAINTAINER=off` 时不创建后台补算维护器。
 * 默认开启，行为不变。关闭只影响审计页问询分组／编号对新调用的更新，不影响问数主路径。
 */
export function isInferredMaintainerPaused(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LUCY_INFERRED_MAINTAINER ?? "").trim().toLowerCase() === "off";
}

type MaintainerDeps = {
  getDb: () => Promise<Database.Database>;
  rebuild: (userId: string) => Promise<unknown>;
  pollMs?: number;
  lookbackHours?: number;
  now?: () => number;
};

export type InferredTurnMaintainer = {
  /**
   * `after`：首轮扫描与轮询等它完成才开始（生产里是「服务已开始监听」）。
   * 启动补算与 onReady 里其余钩子争同一块盘，冷盘上会把钩子拖过 10 秒超时。
   */
  start(options?: { awaitInitial?: boolean; after?: Promise<unknown> }): Promise<void>;
  stop(): void;
  markDirty(userId: string): void;
  status(): InferredRebuildStatus;
  /** Full 30-day scan, then one pass. Tests and startup use this. */
  catchUp(): Promise<void>;
  /** One watermark poll. Does not itself rebuild. */
  pollOnce(): Promise<void>;
  /** Poll the watermark now and start a pass for users with newer calls. Unchanged users are not touched. */
  refreshStale(): Promise<void>;
  runPass(): Promise<void>;
};

/**
 * Background inferred-turn maintenance. Passes never overlap. A trigger during
 * a pass schedules one more pass. A failed user stays dirty and does not stop
 * the others.
 */
export function createInferredTurnMaintainer(deps: MaintainerDeps): InferredTurnMaintainer {
  const pollMs = deps.pollMs ?? 10_000;
  const lookbackHours = deps.lookbackHours ?? INFERRED_TURN_REBUILD_LOOKBACK_HOURS;
  const now = deps.now ?? Date.now;
  const dirty = new Set<string>();
  const epoch = new Map<string, number>();
  const retryAt = new Map<string, number>();
  const failures = new Map<string, number>();
  let scanned = false;
  let watermarkId = 0;
  let lastCompletedAt: string | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;
  let timer: NodeJS.Timeout | undefined;

  const status = (): InferredRebuildStatus => ({
    complete: dirty.size === 0 && running === null,
    pendingUsers: dirty.size,
    lastCompletedAt
  });

  const touch = (userId: string) => {
    dirty.add(userId);
    epoch.set(userId, (epoch.get(userId) ?? 0) + 1);
  };

  const noteMaxId = (id: number) => {
    if (id > watermarkId) watermarkId = id;
  };

  /**
   * P1-39: 不再整条扫描 access_log。按用户逐个做 idx_al_user_ts 的 SEARCH 探测，
   * 只把「窗口内有比上次重建更新的行」的用户标脏；覆盖判定见 INFERRED_COVERAGE_MARGIN_MS。
   * 水位在探测开始前读取：探测期间新写入的行 id 更大，由首次轮询补上。
   */
  const scanFullOnce = async (): Promise<void> => {
    await yieldToEventLoop();
    const database = await deps.getDb();
    const cutoff = new Date(now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const mark = database.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM access_log`).get() as { id: number };
    const nextUser = database.prepare(`SELECT user_id FROM access_log WHERE user_id > ? ORDER BY user_id LIMIT 1`);
    const newestRow = database.prepare(`SELECT ts FROM access_log WHERE user_id = ? AND ts >= ? ORDER BY ts DESC LIMIT 1`);
    // P1-45: covered() 使用 inferred_rebuild_state 而非 inferred_turns.updated_at，
    // 避免中断后残缺写入被判为已覆盖，同时收口 SC-04（15 分钟余量空转全量重建）。
    let rebuildState: Database.Statement | null = null;
    try {
      rebuildState = database.prepare(
        `SELECT status, watermark FROM inferred_rebuild_state WHERE user_id = ?`
      );
    } catch {
      rebuildState = null;
    }
    const covered = (userId: string, newestTs: string): boolean => {
      // 若表不存在（旧库尚未迁移），保守地视为未覆盖，触发重建。
      if (!rebuildState) return false;
      const state = rebuildState.get(userId) as { status: string; watermark: string | null } | undefined;
      // 缺行或 in_progress（包含中断场景）均视为未覆盖。
      if (!state || state.status !== "complete") return false;
      // SC-04: 以水位（重建开始时的最新日志 ts）为准；watermark >= newestTs 时已覆盖。
      // ISO 字符串可直接按字典序比较；watermark 为 '' 时对任意非空 newestTs 均返回 false。
      return (state.watermark ?? "") >= newestTs;
    };
    let cursor = "";
    let probed = 0;
    for (;;) {
      const next = nextUser.get(cursor) as { user_id: string } | undefined;
      if (!next) break;
      cursor = next.user_id;
      const newest = newestRow.get(cursor, cutoff) as { ts: string } | undefined;
      if (newest && !covered(cursor, newest.ts)) touch(cursor);
      probed += 1;
      if (probed % INFERRED_SCAN_YIELD_USERS === 0) await yieldToEventLoop();
    }
    noteMaxId(mark.id);
    scanned = true;
  };

  /** 轮询与首轮扫描可能重叠（扫描现在会让出）；共用同一次进行中的扫描。 */
  let scanning: Promise<void> | null = null;
  const scanFull = (): Promise<void> => {
    scanning ??= scanFullOnce().finally(() => {
      scanning = null;
    });
    return scanning;
  };

  const passOnce = async (): Promise<void> => {
    const userIds = [...dirty].sort();
    for (const userId of userIds) {
      const due = retryAt.get(userId) ?? 0;
      if (due > now()) continue;
      const token = epoch.get(userId) ?? 0;
      try {
        await deps.rebuild(userId);
        if ((epoch.get(userId) ?? 0) === token) {
          dirty.delete(userId);
          epoch.delete(userId);
          retryAt.delete(userId);
          failures.delete(userId);
          lastCompletedAt = new Date(now()).toISOString();
        }
      } catch {
        const attempt = (failures.get(userId) ?? 0) + 1;
        failures.set(userId, attempt);
        retryAt.set(userId, now() + Math.min(60_000, 500 * 2 ** attempt));
      }
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
        // Vitest fake timers swallow setImmediate and would stall server ready.
        if (process.env.VITEST === "true") queueMicrotask(resolve);
      });
    }
  };

  const runPass = (): Promise<void> => {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        await passOnce();
      } while (rerun);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  /**
   * P1-39: 按 id 水位分页读取新行（无 DISTINCT，按 id 顺序读 rowid 范围），在代码里去重。
   * 每页之后推进水位并让出事件循环；同一次轮询里每个用户只 touch 一次。
   */
  const pollOnce = async (): Promise<void> => {
    if (!scanned) {
      await scanFull();
      return;
    }
    const database = await deps.getDb();
    const page = database.prepare(`SELECT id, user_id FROM access_log WHERE id > ? ORDER BY id LIMIT ?`);
    const seen = new Set<string>();
    for (;;) {
      const rows = page.all(watermarkId, INFERRED_POLL_PAGE) as Array<{ id: number; user_id: string }>;
      for (const row of rows) {
        if (seen.has(row.user_id)) continue;
        seen.add(row.user_id);
        touch(row.user_id);
      }
      if (rows.length > 0) noteMaxId(rows[rows.length - 1].id);
      if (rows.length < INFERRED_POLL_PAGE) break;
      await yieldToEventLoop();
    }
  };

  return {
    async start(options?: { awaitInitial?: boolean; after?: Promise<unknown> }) {
      if (timer) return;
      let gateOpen = options?.after === undefined;
      const initial = (options?.after ?? Promise.resolve())
        .then(() => {
          gateOpen = true;
          return scanFull();
        })
        .then(() => runPass());
      if (options?.awaitInitial) await initial;
      else {
        initial.catch((error) => {
          console.error("[inferred-turns] initial catch-up failed; the poll retries the scan:", error);
        });
      }
      timer = setInterval(() => {
        if (!gateOpen) return;
        void pollOnce().then(() => runPass());
      }, pollMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    markDirty(userId: string) {
      if (!userId) return;
      touch(userId);
      void runPass();
    },
    status,
    async catchUp() {
      await scanFull();
      await runPass();
    },
    pollOnce,
    async refreshStale() {
      await pollOnce();
      void runPass();
    },
    runPass
  };
}

let active: InferredTurnMaintainer | null = null;

export function bindInferredTurnMaintainer(maintainer: InferredTurnMaintainer | null): void {
  active = maintainer;
}

export function inferredRebuildStatus(): InferredRebuildStatus {
  if (active) return active.status();
  // 暂停时没有维护器：不能报「补算完成」，如实标记 paused。
  if (isInferredMaintainerPaused()) return { complete: false, pendingUsers: 0, lastCompletedAt: null, paused: true };
  return { complete: true, pendingUsers: 0, lastCompletedAt: null };
}

/**
 * Read-time freshness for callers that want recent calls reflected (access map).
 * Rebuilds only users with calls newer than the maintainer's watermark; marking every
 * reader-visible user dirty forced a full delete+reinsert rebuild per user per request
 * (P1-33 / F-2).
 */
export async function refreshInferredStaleUsers(): Promise<void> {
  await active?.refreshStale();
}

export function stopInferredTurnMaintainer(): void {
  active?.stop();
  active = null;
}
