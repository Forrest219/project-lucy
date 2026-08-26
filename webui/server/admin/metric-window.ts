/**
 * Spec 128 §7 — Metric Window
 *
 * Centralized time window generator for KPI audit queries.
 * HR-5: All time-windowed queries must use this helper — no inline
 * `datetime('now', '-7 days')` in SQL strings.
 *
 * The window is half-open: [startIso, endIso).
 * SQL usage: WHERE ts >= :startIso AND ts < :endIso
 */

export interface MetricWindow {
  /** ISO 8601, inclusive window start */
  startIso: string;
  /** ISO 8601, exclusive window end (= query time = asOf) */
  endIso: string;
  /** ISO 8601, moment the window was computed */
  asOf: string;
}

/**
 * Build a half-open metric window `[now - hours, now)`.
 *
 * @param hours - Look-back duration in hours (e.g. 168 for 7 days)
 * @param now   - Override query timestamp (defaults to Date.now(); injectable for tests)
 */
export function buildMetricWindow(hours: number, now: Date = new Date()): MetricWindow {
  const endMs = now.getTime();
  const startMs = endMs - hours * 60 * 60 * 1000;
  const startIso = new Date(startMs).toISOString();
  const endIso = now.toISOString();
  return { startIso, endIso, asOf: endIso };
}

/** Canonical 7-day window (168 hours). */
export const WINDOW_7D_HOURS = 168 as const;

/** Build the standard 7-day metric window. */
export function build7dWindow(now?: Date): MetricWindow {
  return buildMetricWindow(WINDOW_7D_HOURS, now);
}
