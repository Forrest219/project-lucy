/**
 * A tiny, dependency-free registry for "the durable security state changed".
 *
 * The Wiki widening hold is derived from the security store. A cached
 * projection of it must never outlive a state change, so every mutation of
 * the security state notifies this registry and the readers drop their cache.
 *
 * The module has NO imports on purpose: the security store and the hold
 * projection both depend on it, and it must not depend on either.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to security state changes. Returns an unsubscribe function. */
export function onSecurityStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Announce that the durable security state changed. */
export function notifySecurityStateChange(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // A broken reader must never break the writer.
    }
  }
}
