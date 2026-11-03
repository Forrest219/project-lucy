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
export const WINDOW_14D_HOURS = 336 as const;
export const WINDOW_30D_HOURS = 720 as const;

export type AgentStatsRange = "7d" | "14d" | "30d";

const AGENT_STATS_RANGE_HOURS: Record<AgentStatsRange, number> = {
  "7d": WINDOW_7D_HOURS,
  "14d": WINDOW_14D_HOURS,
  "30d": WINDOW_30D_HOURS
};

/** API default stays 7d so callers without `range` keep the historical window. */
export function parseAgentStatsRange(raw: unknown): AgentStatsRange {
  if (raw === "7d" || raw === "14d" || raw === "30d") return raw;
  if (raw === "90d") return "30d";
  return "7d";
}

export function buildAgentStatsWindow(range: AgentStatsRange, now?: Date): MetricWindow {
  return buildMetricWindow(AGENT_STATS_RANGE_HOURS[range], now);
}

/** Build the standard 7-day metric window. */
export function build7dWindow(now?: Date): MetricWindow {
  return buildMetricWindow(WINDOW_7D_HOURS, now);
}
