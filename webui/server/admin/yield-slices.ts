/**
 * Cooperative slicing for large synchronous builds (export CSV, row presentation).
 * better-sqlite3 and string building run on the event loop; one 115k-row export held it for
 * 0.5–1.7 s and starved `/api/livez` (P1-32 / P1-33). Work is done in fixed slices with a
 * macrotask yield between them, so health probes and other requests interleave. The result is
 * identical to the one-shot computation.
 */
export const EXPORT_SLICE_ROWS = 250;

/** Vitest fake timers wrap `setTimeout` with a `clock`. Those timers never fire `setImmediate`. */
function timersAreFake(): boolean {
  return (setTimeout as { clock?: unknown }).clock != null;
}

/**
 * A macrotask yield. Resolving inside the `MessageChannel` callback continues the caller as a
 * microtask, so a `setImmediate` queued earlier still waits until the next synchronous stretch
 * finishes. Production schedules one more `setImmediate` and lets those queued macrotasks run
 * first. Vitest fake timers swallow `setImmediate`, so the fake-timer path resolves in the
 * callback and the promise cannot stay pending.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      if (timersAreFake()) {
        resolve();
        return;
      }
      setImmediate(resolve);
    };
    port2.postMessage(0);
  });
}

/** 占空比让出的上限。再长的同步段也只让出这么久，补算整体不会被拖到无法收敛。 */
export const PAUSE_CAP_MS = 250;
/** 短于该值的同步段不值得起定时器，只做一次宏任务让出。 */
const PAUSE_MIN_STRETCH_MS = 20;

/**
 * P1-39: 占空比让出。一次宏任务让出只给排队的回调一个回合，需要好几跳才能答完的请求
 * （readyz 要读文件、问依赖）会被后台补算的每个同步段各拖一次。较长的同步段之后
 * 空出与之相当的时间（上限 PAUSE_CAP_MS），多跳请求就能在这段空窗里答完。
 * Vitest 假定时器下退化为一次宏任务让出，不会挂起。
 */
export function pauseAfterStretch(stretchMs: number): Promise<void> {
  if (stretchMs < PAUSE_MIN_STRETCH_MS || timersAreFake()) return yieldToEventLoop();
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.min(stretchMs, PAUSE_CAP_MS));
  });
}

/** `fn` is applied per slice (it must be row-independent); outputs are concatenated in order. */
export async function mapSlicesYielding<T, R>(
  items: readonly T[],
  fn: (slice: T[]) => R[],
  size: number = EXPORT_SLICE_ROWS
): Promise<R[]> {
  const out: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    if (start > 0) await yieldToEventLoop();
    for (const row of fn(items.slice(start, start + size))) out.push(row);
  }
  return out;
}
