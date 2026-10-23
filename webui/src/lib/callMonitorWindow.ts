/** Spec 165: one clock-aligned window for call-monitor totals and sparklines. */

export const CALL_MONITOR_TIME_ZONE = "Asia/Shanghai" as const;
export const CALL_MONITOR_P95_MIN_SAMPLES = 20;

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export type CallMonitorRange = "1h" | "24h" | "7d" | "30d";
export type CallMonitorBucket = "5m" | "hour" | "day";

export type CallMonitorWindow = {
  range: CallMonitorRange;
  timeZone: typeof CALL_MONITOR_TIME_ZONE;
  bucket: CallMonitorBucket;
  bucketCount: number;
  since: string;
  until: string;
  buckets: Array<{ start: string; end: string }>;
};

const RANGE_SPEC: Record<CallMonitorRange, { bucket: CallMonitorBucket; bucketCount: number }> = {
  "1h": { bucket: "5m", bucketCount: 12 },
  "24h": { bucket: "hour", bucketCount: 24 },
  "7d": { bucket: "day", bucketCount: 7 },
  "30d": { bucket: "day", bucketCount: 30 }
};

export function parseCallMonitorRange(range: string | undefined, hours?: string): CallMonitorRange {
  if (range === "1h" || range === "24h" || range === "7d" || range === "30d") return range;
  if (hours === "1") return "1h";
  if (hours === "24") return "24h";
  return "24h";
}

function grainMs(bucket: CallMonitorBucket): number {
  if (bucket === "5m") return 5 * 60 * 1000;
  if (bucket === "hour") return 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

/** Floor an instant to the Shanghai clock boundary for the grain. */
export function shanghaiBucketStart(now: Date, bucket: CallMonitorBucket): number {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();
  const flooredUtc = bucket === "5m"
    ? Date.UTC(year, month, day, hour, Math.floor(minute / 5) * 5, 0, 0)
    : bucket === "hour"
      ? Date.UTC(year, month, day, hour, 0, 0, 0)
      : Date.UTC(year, month, day, 0, 0, 0, 0);
  return flooredUtc - SHANGHAI_OFFSET_MS;
}

export function callMonitorWindow(range: CallMonitorRange, now = new Date()): CallMonitorWindow {
  const spec = RANGE_SPEC[range];
  const step = grainMs(spec.bucket);
  const openStart = shanghaiBucketStart(now, spec.bucket);
  const first = openStart - (spec.bucketCount - 1) * step;
  const untilMs = now.getTime();
  const buckets = Array.from({ length: spec.bucketCount }, (_, index) => {
    const startMs = first + index * step;
    const endMs = index === spec.bucketCount - 1 ? untilMs : startMs + step;
    return {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString()
    };
  });
  return {
    range,
    timeZone: CALL_MONITOR_TIME_ZONE,
    bucket: spec.bucket,
    bucketCount: spec.bucketCount,
    since: buckets[0]?.start ?? now.toISOString(),
    until: now.toISOString(),
    buckets
  };
}

export function callMonitorBucketIndex(ts: string, window: CallMonitorWindow): number {
  const time = Date.parse(ts);
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  if (!Number.isFinite(time) || time < since || time > until) return -1;
  const step = grainMs(window.bucket);
  const origin = Date.parse(window.buckets[0]?.start ?? window.since);
  let index = Math.floor((time - origin) / step);
  if (index === window.bucketCount && time <= until) index = window.bucketCount - 1;
  if (index < 0 || index >= window.bucketCount) return -1;
  return index;
}
