/** Self-contained so the exact same observation reader can run in Chromium and unit tests. */
export function observationsInWindow(
  perf: {
    shifts: Array<{ t: number; v: number; sources: string[] }>;
    longTasks: Array<{ start: number; duration: number; name: string; container: string | null }>;
  },
  start: number,
  end: number
) {
  const shifts = perf.shifts.filter((s) => s.t >= start && s.t <= end);
  const longTasks = perf.longTasks.filter((t) => t.start + t.duration >= start && t.start <= end);
  const shiftSources = shifts.map((s) => `${s.t.toFixed(0)}:${s.v.toFixed(4)}:${s.sources.join("|")}`);
  return { cls: shifts.reduce((sum, s) => sum + s.v, 0), shiftCount: shifts.length, longTasks, shiftSources };
}

export const FILTER_TRACE_NAMES = ["catalog-filter-path", "catalog-filter-column"] as const;
