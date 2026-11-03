/**
 * L25-16 — 控制面写路径的锁顺序封装（Spec §4.5 / §6.3，R07 / R10 / R11 / R15，F08 / N10）。
 *
 * **锁顺序固定，不得颠倒**：
 *
 * ```
 * 1. withKtxYamlWriteLock(...)      ← ktx.yaml 写的唯一互斥（进程内队列，单进程）
 * 2. withDisplayWriteBarrier(...)   ← 跨阶段可见性屏障（只做计数与代际，不是互斥）
 * 3. withPublishCoordinator(...)    ← 仅语义发布类写；可重入；占用即抛 busy，不排队
 * ```
 *
 * ⚠️ **两种锁的占用语义必须区分（N10）**：
 * - `withKtxYamlWriteLock` 是**进程内 Promise 队列**：占用时**排队等待**（受总超时约束），
 *   超时返回 `ops_ktx_lock_timeout`；
 * - `withPublishCoordinator` 占用时**抛 busy、不排队**：返回稳定原因码
 *   `ops_publish_window_busy`（附占用方信息）。
 *
 * ⚠️ **`withKtxYamlWriteLock` 非重入**（F08）：持锁状态下再次取锁会自等待。
 * 因此最外层一次性取得全部锁，内层服务一律走「已持锁」入口。
 */

import type { DisplayScope } from "../display-generation.js";
import { withDisplayWriteBarrier } from "../display-generation.js";
import { withKtxYamlWriteLock } from "../ktx-yaml-write-lock.js";
import {
  isInsidePublishCoordinator,
  PublishCoordinatorBusyError,
  withPublishCoordinator,
  type PublishEntryKind
} from "../publish-coordinator.js";

/** ktx 写锁的默认等待上限（N10：等待语义受总超时约束）。 */
export const OPS_KTX_LOCK_TIMEOUT_MS = 30_000;

/** 控制面通用的稳定原因码。 */
export const OPS_BUSY_CODE = "ops_publish_window_busy";
export const OPS_LOCK_TIMEOUT_CODE = "ops_ktx_lock_timeout";

export class OpsKtxLockTimeoutError extends Error {
  readonly code = OPS_LOCK_TIMEOUT_CODE;

  constructor(readonly timeoutMs: number) {
    super(`ktx.yaml 写锁等待超时（${timeoutMs}ms）`);
    this.name = "OpsKtxLockTimeoutError";
  }
}

export class OpsPublishWindowBusyError extends Error {
  readonly code = OPS_BUSY_CODE;

  constructor(
    readonly holder: unknown,
    readonly requestedKind: PublishEntryKind
  ) {
    super(
      `发布窗口被占用（${requestedKind}）：请稍后重试或先确认占用方是否已结束。`
    );
    this.name = "OpsPublishWindowBusyError";
  }
}

/**
 * 带超时等待的 ktx 写锁。
 *
 * 超时**不会**中断已经开始的写入：超时只在**排队等待期间**生效——一旦临界区开始执行，
 * 调用方必须等到写完成，否则调用方会以为「没写成」而实际「写成了」。
 */
export async function withKtxYamlWriteLockTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = OPS_KTX_LOCK_TIMEOUT_MS
): Promise<T> {
  let expired = false;
  let started = false;
  const guarded = async (): Promise<T> => {
    if (expired) throw new OpsKtxLockTimeoutError(timeoutMs);
    started = true;
    return fn();
  };
  const queued = withKtxYamlWriteLock(guarded);
  // 队列里的 promise 可能在调用方已被拒绝后才执行；挂一个空 catch 防止未处理拒绝。
  queued.catch(() => undefined);

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      // 临界区已经开始 → 不可中途放弃，等待真实结果。
      if (started) return;
      reject(new OpsKtxLockTimeoutError(timeoutMs));
    }, timeoutMs);
    timer.unref?.();
  });

  try {
    return await Promise.race([queued, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface OpsWriteLockOptions {
  projectRoot: string;
  /** 发布协调窗口的 kind（复用既有合法枚举值，N09）。 */
  kind?: PublishEntryKind;
  /** 显示写屏障的代际范围。 */
  scopes?: readonly DisplayScope[];
  /** 是否取得发布协调窗口。 */
  publishWindow?: boolean;
  /** ktx 写锁等待上限。 */
  timeoutMs?: number;
  /** 发布窗口占用方信息（写进 busy 原因码）。 */
  operationId?: string;
}

/**
 * 控制面写路径的**唯一**锁调用树（Spec §6.3，F08）：
 * `withKtxYamlWriteLock → withDisplayWriteBarrier → withPublishCoordinator → 写`。
 *
 * 协调窗口被占用 → 抛 `OpsPublishWindowBusyError`（**拒绝**，不排队）。
 */
export async function withOpsWriteLocks<T>(
  options: OpsWriteLockOptions,
  fn: () => Promise<T>
): Promise<T> {
  const scopes = options.scopes ?? (["D", "P", "C", "L"] as const);
  const kind = options.kind ?? "batch_import";

  return withKtxYamlWriteLockTimeout(async () => {
    return withDisplayWriteBarrier(scopes, async () => {
      if (!options.publishWindow) return fn();
      if (isInsidePublishCoordinator()) return fn();
      try {
        return await withPublishCoordinator(
          kind,
          fn,
          { projectRoot: options.projectRoot, operationId: options.operationId }
        );
      } catch (err) {
        if (err instanceof PublishCoordinatorBusyError) {
          throw new OpsPublishWindowBusyError(err.holder, err.requestedKind);
        }
        throw err;
      }
    });
  }, options.timeoutMs);
}

/**
 * 把任意异常映射为控制面的稳定原因码。
 * 发布窗口占用 → `ops_publish_window_busy`；ktx 锁超时 → `ops_ktx_lock_timeout`。
 */
export function opsLockFailureCode(err: unknown): string | undefined {
  if (err instanceof OpsPublishWindowBusyError) return OPS_BUSY_CODE;
  if (err instanceof OpsKtxLockTimeoutError) return OPS_LOCK_TIMEOUT_CODE;
  if (err instanceof PublishCoordinatorBusyError) return OPS_BUSY_CODE;
  return undefined;
}
