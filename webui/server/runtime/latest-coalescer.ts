/**
 * P1-82 / P1-81 — trailing-edge coalescing for idempotent file scans.
 *
 * Root cause (f5e4b14d, 2026-11-24): every concurrent `lucy_catalog` / `lucy_query`
 * ran its own full stat scan of ~1,400 semantic files. Twenty callers meant ~28,000
 * `stat` calls queued on the 4-thread libuv pool, and cancelled callers did not take
 * their queued work with them. Display reconciliation then waited behind that backlog.
 *
 * Contract: a caller always receives the result of a run that STARTED AFTER the call
 * was made, so a file write that completed before the call is never missed (no stale
 * window). Callers that arrive while a run is in flight share ONE follow-up run, so N
 * concurrent callers cost at most two runs instead of N.
 */
type Slot<T> = { running: Promise<T> | null; next: Promise<T> | null };

export function createLatestCoalescer<K, T>(run: (key: K) => Promise<T>, keyOf: (key: K) => string = (key) => String(key)) {
  const slots = new Map<string, Slot<T>>();

  function start(slot: Slot<T>, id: string, key: K): Promise<T> {
    const started = Promise.resolve().then(() => run(key));
    slot.running = started;
    const done = () => {
      if (slot.running === started) slot.running = null;
      if (slot.running === null && slot.next === null) slots.delete(id);
    };
    started.then(done, done);
    return started;
  }

  return function coalesced(key: K): Promise<T> {
    const id = keyOf(key);
    let slot = slots.get(id);
    if (!slot) {
      slot = { running: null, next: null };
      slots.set(id, slot);
    }
    const running = slot.running;
    if (!running) return start(slot, id, key);
    if (slot.next) return slot.next;
    const owner = slot;
    const settle = (): Promise<T> => {
      owner.next = null;
      return start(owner, id, key);
    };
    const follow = running.then(settle, settle);
    owner.next = follow;
    return follow;
  };
}
