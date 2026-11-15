/**
 * Cooperative slicing for large synchronous builds (export CSV, row presentation).
 * better-sqlite3 and string building run on the event loop; one 115k-row export held it for
 * 0.5–1.7 s and starved `/api/livez` (P1-32 / P1-33). Work is done in fixed slices with a
 * macrotask yield between them, so health probes and other requests interleave. The result is
 * identical to the one-shot computation.
 */
export const EXPORT_SLICE_ROWS = 250;

/**
 * A real macrotask yield. `MessageChannel` is used instead of `setImmediate`/`setTimeout` because
 * Vitest fake timers replace those two and a fake would leave this promise pending forever.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(0);
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
