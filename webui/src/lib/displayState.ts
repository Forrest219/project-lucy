import { useSyncExternalStore } from "react";

/**
 * P1-75 X5 — client side of the degraded display read (frozen carrier, X3):
 * response headers `X-Lucy-Display-State` (grace|stale|pending), `-Age-Ms`, `-Generation`,
 * `-Pending-Ms`, `-Prolonged: 1`; `pending` answers 200 `{ ok: true, data: null, display }`.
 *
 * The internal state words live here only. User-visible copy is owned by
 * DisplayDegradedNotice (terminology standard §4.6.1) and never shows them.
 */
export type DisplayDegradedState = "grace" | "stale" | "pending";

export type DisplayInfo = {
  state: DisplayDegradedState;
  ageMs?: number;
  generation?: string;
  pendingMs?: number;
  /** Non-error degradation past D_max (server decides). */
  prolonged: boolean;
};

const STATES: readonly string[] = ["grace", "stale", "pending"];
const SEVERITY: Record<DisplayDegradedState, number> = { grace: 1, stale: 2, pending: 3 };

/** Self-polling interval while `stale` / `pending` (contract §3: 2–5 s). */
export const DISPLAY_DEGRADED_POLL_MS = 3000;

function finiteNumber(value: unknown): number | undefined {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : undefined;
}

type HeaderSource = { get(name: string): string | null } | undefined | null;

/** Parse the frozen response headers; null = fresh (no or unknown state header). */
export function parseDisplayHeaders(headers: HeaderSource): DisplayInfo | null {
  const state = headers?.get?.("x-lucy-display-state")?.trim().toLowerCase();
  if (!state || !STATES.includes(state)) return null;
  return {
    state: state as DisplayDegradedState,
    ageMs: finiteNumber(headers?.get?.("x-lucy-display-age-ms")),
    generation: headers?.get?.("x-lucy-display-generation") ?? undefined,
    pendingMs: finiteNumber(headers?.get?.("x-lucy-display-pending-ms")),
    prolonged: headers?.get?.("x-lucy-display-prolonged")?.trim() === "1"
  };
}

/** Parse the body envelope `display` (pending carries it; used when headers are stripped). */
export function parseDisplayEnvelope(display: unknown): DisplayInfo | null {
  if (!display || typeof display !== "object") return null;
  const raw = display as Record<string, unknown>;
  const state = typeof raw.state === "string" ? raw.state.toLowerCase() : "";
  if (!STATES.includes(state)) return null;
  return {
    state: state as DisplayDegradedState,
    ageMs: finiteNumber(raw.ageMs),
    generation: typeof raw.generation === "string" ? raw.generation : undefined,
    pendingMs: finiteNumber(raw.pendingMs),
    prolonged: raw.prolonged === true
  };
}

/** Region key = request pathname (query string stripped), e.g. `/api/sources`. */
export function displayKeyFor(path: string): string {
  return path.split("?")[0] ?? path;
}

const store = new Map<string, DisplayInfo>();
const listeners = new Set<() => void>();

function sameInfo(a: DisplayInfo, b: DisplayInfo): boolean {
  return a.state === b.state && a.ageMs === b.ageMs && a.generation === b.generation
    && a.pendingMs === b.pendingMs && a.prolonged === b.prolonged;
}

/** Record the latest state of a region; `null` = fresh (clears the notice). */
export function setDisplayInfo(path: string, info: DisplayInfo | null): void {
  const key = displayKeyFor(path);
  const previous = store.get(key);
  if (!info) {
    if (!previous) return;
    store.delete(key);
  } else {
    if (previous && sameInfo(previous, info)) return;
    store.set(key, info);
  }
  for (const listener of [...listeners]) listener();
}

export function getDisplayInfo(path: string): DisplayInfo | null {
  return store.get(displayKeyFor(path)) ?? null;
}

export function clearDisplayInfo(): void {
  if (store.size === 0) return;
  store.clear();
  for (const listener of [...listeners]) listener();
}

export function subscribeDisplayInfo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Worst state across the given regions (pending > stale > grace); stable reference between changes. */
export function worstDisplayInfo(paths: readonly string[]): DisplayInfo | null {
  let worst: DisplayInfo | null = null;
  for (const path of paths) {
    const info = getDisplayInfo(path);
    if (info && (!worst || SEVERITY[info.state] > SEVERITY[worst.state])) worst = info;
  }
  return worst;
}

export function useDisplayInfo(paths: readonly string[]): DisplayInfo | null {
  return useSyncExternalStore(subscribeDisplayInfo, () => worstDisplayInfo(paths));
}

/** React Query `refetchInterval` helper: poll only while the region is `stale` or `pending`. */
export function displayPollInterval(path: string): () => number | false {
  return () => {
    const state = getDisplayInfo(path)?.state;
    return state === "stale" || state === "pending" ? DISPLAY_DEGRADED_POLL_MS : false;
  };
}
