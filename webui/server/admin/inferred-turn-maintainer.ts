import type Database from "better-sqlite3";
import { INFERRED_TURN_REBUILD_LOOKBACK_HOURS } from "../proxy/audit.js";

export type InferredRebuildStatus = {
  complete: boolean;
  pendingUsers: number;
  lastCompletedAt: string | null;
};

type MaintainerDeps = {
  getDb: () => Promise<Database.Database>;
  rebuild: (userId: string) => Promise<unknown>;
  pollMs?: number;
  lookbackHours?: number;
  now?: () => number;
};

export type InferredTurnMaintainer = {
  start(options?: { awaitInitial?: boolean }): Promise<void>;
  stop(): void;
  markDirty(userId: string): void;
  status(): InferredRebuildStatus;
  /** Full 30-day scan, then one pass. Tests and startup use this. */
  catchUp(): Promise<void>;
  /** One watermark poll. Does not itself rebuild. */
  pollOnce(): Promise<void>;
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
  const retryAt = new Map<string, number>();
  const failures = new Map<string, number>();
  let watermarkTs: string | null = null;
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

  const rememberWatermark = (ts: string | null, id: number) => {
    if (!ts) return;
    if (watermarkTs === null || ts > watermarkTs || (ts === watermarkTs && id > watermarkId)) {
      watermarkTs = ts;
      watermarkId = id;
    }
  };

  const scanFull = async (): Promise<void> => {
    const database = await deps.getDb();
    const cutoff = new Date(now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const users = database
      .prepare(`SELECT DISTINCT user_id FROM access_log WHERE ts >= ?`)
      .all(cutoff) as Array<{ user_id: string }>;
    for (const row of users) dirty.add(row.user_id);
    const mark = database.prepare(`SELECT ts, id FROM access_log ORDER BY ts DESC, id DESC LIMIT 1`).get() as
      | { ts: string; id: number }
      | undefined;
    rememberWatermark(mark?.ts ?? null, mark?.id ?? 0);
  };

  const passOnce = async (): Promise<void> => {
    const userIds = [...dirty].sort();
    for (const userId of userIds) {
      const due = retryAt.get(userId) ?? 0;
      if (due > now()) continue;
      try {
        await deps.rebuild(userId);
        dirty.delete(userId);
        retryAt.delete(userId);
        failures.delete(userId);
        lastCompletedAt = new Date(now()).toISOString();
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

  const pollOnce = async (): Promise<void> => {
    if (watermarkTs === null) {
      await scanFull();
      return;
    }
    const database = await deps.getDb();
    const users = database
      .prepare(
        `SELECT DISTINCT user_id FROM access_log WHERE ts > ? OR (ts = ? AND id > ?)`
      )
      .all(watermarkTs, watermarkTs, watermarkId) as Array<{ user_id: string }>;
    for (const row of users) dirty.add(row.user_id);
    const mark = database.prepare(`SELECT ts, id FROM access_log ORDER BY ts DESC, id DESC LIMIT 1`).get() as
      | { ts: string; id: number }
      | undefined;
    rememberWatermark(mark?.ts ?? null, mark?.id ?? 0);
  };

  return {
    async start(options?: { awaitInitial?: boolean }) {
      if (timer) return;
      const initial = scanFull().then(() => runPass());
      if (options?.awaitInitial) await initial;
      else void initial;
      timer = setInterval(() => {
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
      dirty.add(userId);
      void runPass();
    },
    status,
    async catchUp() {
      await scanFull();
      await runPass();
    },
    pollOnce,
    runPass
  };
}

let active: InferredTurnMaintainer | null = null;

export function bindInferredTurnMaintainer(maintainer: InferredTurnMaintainer | null): void {
  active = maintainer;
}

export function inferredRebuildStatus(): InferredRebuildStatus {
  return active?.status() ?? { complete: true, pendingUsers: 0, lastCompletedAt: null };
}

export function markInferredUserDirty(userId: string): void {
  active?.markDirty(userId);
}

export function stopInferredTurnMaintainer(): void {
  active?.stop();
  active = null;
}
