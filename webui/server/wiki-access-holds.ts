import { getSecurityStore } from "./security/instance.js";
import { onSecurityStateChange } from "./security/state-changes.js";

/**
 * Spec 193 §8.2 / §9.4 — the per-key widening hold projection.
 *
 * The projection answers one fail-closed question: "is this Wiki key held by
 * an unresolved widening?" A key that is held is denied to Agent search AND
 * read — not only to the Role that was being widened.
 *
 * The projection is cached in-process for a very short window and invalidated
 * explicitly whenever a Wiki access operation changes state, so a widening
 * that is prepared is refused on the very next request.
 *
 * A store that cannot be read is reported as `available: false`: the caller
 * denies. It is never reported as "not held".
 */

export interface WikiAccessHoldProjection {
  /** `false` when the projection could not be read — the caller must deny. */
  available: boolean;
  /** The Wiki keys that currently carry an unresolved widening. */
  keys: ReadonlySet<string>;
  /** The pending operation per held key. */
  operations: ReadonlyMap<string, { operation_id: string; state: "pending" | "needs_review" }>;
}

const HOLD_CACHE_TTL_MS = 250;

let cache: { at: number; store: unknown; value: WikiAccessHoldProjection } | null = null;

/** Drop the cached projection (after any hold state change). */
export function invalidateWikiAccessHoldCache(): void {
  cache = null;
}

// ANY durable security state change drops the cached projection. The hold
// must never be stale: a widening that is prepared has to be refused on the
// very next Agent request, not 250 ms later.
onSecurityStateChange(() => {
  cache = null;
});

export async function readWikiAccessHolds(): Promise<WikiAccessHoldProjection> {
  const now = Date.now();
  const store = await getSecurityStore();
  // The cache is bound to the store instance: a reopened store re-reads.
  if (cache && cache.store === (store.ok ? store.value : null) && now - cache.at < HOLD_CACHE_TTL_MS) {
    return cache.value;
  }

  if (!store.ok) {
    const unavailable: WikiAccessHoldProjection = {
      available: false,
      keys: new Set(),
      operations: new Map()
    };
    cache = { at: now, store: null, value: unavailable };
    return unavailable;
  }
  const held = store.value.listWikiAccessHolds();
  if (!held.ok) {
    const unavailable: WikiAccessHoldProjection = {
      available: false,
      keys: new Set(),
      operations: new Map()
    };
    cache = { at: now, store: store.value, value: unavailable };
    return unavailable;
  }
  const keys = new Set<string>();
  const operations = new Map<string, { operation_id: string; state: "pending" | "needs_review" }>();
  for (const record of held.value) {
    keys.add(record.wikiKey);
    operations.set(record.wikiKey, {
      operation_id: record.operationId,
      state: record.state === "needs_review" ? "needs_review" : "pending"
    });
  }
  const value: WikiAccessHoldProjection = { available: true, keys, operations };
  cache = { at: now, store: store.value, value };
  return value;
}

/** Is this key held by an unresolved widening? */
export async function isWikiKeyHeld(key: string): Promise<boolean> {
  const projection = await readWikiAccessHolds();
  if (!projection.available) return true;
  return projection.keys.has(key);
}

/** The pending-change projection for the management UI. */
export async function readWikiAccessPendingChange(
  key: string
): Promise<{ operation_id: string; state: "pending" | "needs_review" } | undefined> {
  const projection = await readWikiAccessHolds();
  if (!projection.available) return undefined;
  return projection.operations.get(key);
}

/** The pending-change projection of EVERY held key. */
export async function readAllWikiAccessPendingChanges(): Promise<
  Map<string, { operation_id: string; state: "pending" | "needs_review" }>
> {
  const projection = await readWikiAccessHolds();
  if (!projection.available) return new Map();
  return new Map(projection.operations);
}
