import { describe, expect, it } from "vitest";
import { callMonitorWindow, parseCallMonitorRange } from "../lib/callMonitorWindow";

describe("callMonitorWindow", () => {
  const now = new Date("2026-10-12T12:30:00.000Z");

  it("aligns buckets to Asia/Shanghai and keeps the approved point counts", () => {
    const hour = callMonitorWindow("1h", now);
    expect(hour.bucketCount).toBe(12);
    expect(hour.buckets).toHaveLength(12);
    expect(hour.since).toBe("2026-10-12T11:35:00.000Z");
    expect(hour.buckets[11]?.start).toBe("2026-10-12T12:30:00.000Z");

    const day = callMonitorWindow("24h", now);
    expect(day.bucket).toBe("hour");
    expect(day.buckets).toHaveLength(24);
    expect(day.since).toBe("2026-10-11T13:00:00.000Z");
    expect(day.buckets[23]?.start).toBe("2026-10-12T12:00:00.000Z");

    const week = callMonitorWindow("7d", now);
    expect(week.bucket).toBe("day");
    expect(week.buckets).toHaveLength(7);
    expect(week.since).toBe("2026-10-05T16:00:00.000Z");

    const month = callMonitorWindow("30d", now);
    expect(month.buckets).toHaveLength(30);
    expect(month.since).toBe("2026-09-12T16:00:00.000Z");
    expect(month.timeZone).toBe("Asia/Shanghai");
  });

  it("does not treat a 168 hour query as the 7 day window", () => {
    expect(parseCallMonitorRange(undefined, "168")).toBe("24h");
    expect(parseCallMonitorRange(undefined, "1")).toBe("1h");
    expect(parseCallMonitorRange("30d")).toBe("30d");
    expect(parseCallMonitorRange("nope")).toBe("24h");
  });
});
