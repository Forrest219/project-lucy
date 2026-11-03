/**
 * Spec 128 §7 — Metric Window
 * Spec 20261101 §4.1 — Calendar-day window (含今日，半开).
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
  /** ISO 8601, exclusive window end (= query time = asOf for rolling hours) */
  endIso: string;
  /** ISO 8601, moment the window was computed */
  asOf: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Default calendar timezone for governance windows (D24). */
export const GOVERNANCE_CALENDAR_TZ = "Asia/Shanghai" as const;

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

/**
 * Start of the calendar day containing `asOf` in `tz` (returned as UTC Date).
 *
 * Asia/Shanghai uses fixed UTC+8 (no DST). Other IANA zones use Intl parts.
 */
export function startOfCalendarDay(asOf: Date, tz: string = GOVERNANCE_CALENDAR_TZ): Date {
  if (tz === "Asia/Shanghai" || tz === "Etc/GMT-8") {
    const offsetMs = 8 * 60 * 60 * 1000;
    const local = new Date(asOf.getTime() + offsetMs);
    const y = local.getUTCFullYear();
    const m = local.getUTCMonth();
    const d = local.getUTCDate();
    return new Date(Date.UTC(y, m, d) - offsetMs);
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(asOf).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  ) as Record<string, string>;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // Probe noon UTC on that civil date, then walk back/forward to local midnight.
  let probe = Date.UTC(y, m - 1, d, 12, 0, 0);
  const localHour = (ms: number): number => {
    const hourPart = fmt.formatToParts(new Date(ms)).find((part) => part.type === "hour");
    return Number(hourPart?.value ?? "0");
  };
  const localDay = (ms: number): string => {
    const p = Object.fromEntries(
      fmt.formatToParts(new Date(ms)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    ) as Record<string, string>;
    return `${p.year}-${p.month}-${p.day}`;
  };
  const targetDay = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // Move to hour 0 of the same civil day.
  let guard = 0;
  while (localDay(probe) === targetDay && localHour(probe) > 0 && guard < 48) {
    probe -= 60 * 60 * 1000;
    guard += 1;
  }
  while (localDay(probe) < targetDay && guard < 96) {
    probe += 60 * 60 * 1000;
    guard += 1;
  }
  // Fine-tune to second 0.
  const minutePart = (ms: number) => {
    const p = fmt.formatToParts(new Date(ms)).find((part) => part.type === "minute");
    return Number(p?.value ?? "0");
  };
  const secondPart = (ms: number) => {
    const p = fmt.formatToParts(new Date(ms)).find((part) => part.type === "second");
    return Number(p?.value ?? "0");
  };
  probe -= minutePart(probe) * 60_000 + secondPart(probe) * 1000;
  probe -= new Date(probe).getUTCMilliseconds();
  return new Date(probe);
}

/**
 * Spec §4.1 calendar-day window (含今日)：
 * - endExclusive = startOfCalendarDay(asOf, tz) + 1 day
 * - startInclusive = endExclusive - N days
 *
 * SC-24: asOf=2026-11-01T12:00:00+08:00, N=30 →
 * [2026-10-03T00:00:00+08:00, 2026-11-02T00:00:00+08:00)
 */
export function buildCalendarDayWindow(
  n: number,
  tz: string = GOVERNANCE_CALENDAR_TZ,
  asOf: Date = new Date()
): MetricWindow {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`buildCalendarDayWindow: n must be a positive integer, got ${n}`);
  }
  const dayStart = startOfCalendarDay(asOf, tz);
  const endExclusive = new Date(dayStart.getTime() + DAY_MS);
  const startInclusive = new Date(endExclusive.getTime() - n * DAY_MS);
  return {
    startIso: startInclusive.toISOString(),
    endIso: endExclusive.toISOString(),
    asOf: asOf.toISOString()
  };
}

/** YYYY-MM-DD of the calendar day containing `instant` in `tz`. */
export function calendarDayKey(instant: Date | string, tz: string = GOVERNANCE_CALENDAR_TZ): string {
  const asOf = typeof instant === "string" ? new Date(instant) : instant;
  if (!Number.isFinite(asOf.getTime())) {
    throw new Error(`calendarDayKey: invalid instant ${String(instant)}`);
  }
  const dayStart = startOfCalendarDay(asOf, tz);
  // Reconstruct civil date in tz from the UTC instant of local midnight.
  if (tz === "Asia/Shanghai" || tz === "Etc/GMT-8") {
    const local = new Date(dayStart.getTime() + 8 * 60 * 60 * 1000);
    const y = local.getUTCFullYear();
    const m = String(local.getUTCMonth() + 1).padStart(2, "0");
    const d = String(local.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  // en-CA yields YYYY-MM-DD.
  return fmt.format(asOf);
}

/**
 * D19 denom_days：`[startIso, endIso)` 相交的日历日数（时区 `tz`）。
 * 半开窗长度 &lt; 1 日且不跨日 → 可能为 1；`end &lt;= start` → 0。
 */
export function countIntersectingCalendarDays(
  startIso: string,
  endIso: string,
  tz: string = GOVERNANCE_CALENDAR_TZ
): number {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let cursor = startOfCalendarDay(new Date(startMs), tz);
  let count = 0;
  let guard = 0;
  while (cursor.getTime() < endMs && guard < 100_000) {
    const next = new Date(cursor.getTime() + DAY_MS);
    // Interval [cursor, next) intersects [startMs, endMs).
    if (cursor.getTime() < endMs && next.getTime() > startMs) count += 1;
    cursor = next;
    guard += 1;
  }
  return count;
}
