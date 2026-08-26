import { describe, expect, it } from "vitest";
import {
  buildMetricWindow,
  build7dWindow,
  WINDOW_7D_HOURS,
  type MetricWindow
} from "../admin/metric-window";

describe("buildMetricWindow", () => {
  it("returns startIso, endIso, asOf as ISO strings", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const win = buildMetricWindow(168, now);
    expect(win.startIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(win.endIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(win.asOf).toBe(win.endIso);
  });

  it("window is half-open [start, end) — end equals query time", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const win = buildMetricWindow(168, now);
    expect(win.endIso).toBe(now.toISOString());
  });

  it("7d window: start is exactly 168 hours before end", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    const win = buildMetricWindow(168, now);
    const startMs = new Date(win.startIso).getTime();
    const endMs = new Date(win.endIso).getTime();
    const diffHours = (endMs - startMs) / (60 * 60 * 1000);
    expect(diffHours).toBe(168);
  });

  it("start < end always", () => {
    const now = new Date();
    for (const hours of [1, 24, 168, 720]) {
      const win = buildMetricWindow(hours, now);
      expect(new Date(win.startIso).getTime()).toBeLessThan(new Date(win.endIso).getTime());
    }
  });

  it("24h window: start is 24 hours before end", () => {
    const now = new Date("2026-01-15T08:30:00.000Z");
    const win = buildMetricWindow(24, now);
    const diffHours = (new Date(win.endIso).getTime() - new Date(win.startIso).getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(24);
  });

  it("WINDOW_7D_HOURS is 168", () => {
    expect(WINDOW_7D_HOURS).toBe(168);
  });
});

describe("build7dWindow", () => {
  it("is equivalent to buildMetricWindow(168, now)", () => {
    const now = new Date("2026-08-26T10:00:00.000Z");
    const w7d = build7dWindow(now);
    const wManual = buildMetricWindow(168, now);
    expect(w7d.startIso).toBe(wManual.startIso);
    expect(w7d.endIso).toBe(wManual.endIso);
    expect(w7d.asOf).toBe(wManual.asOf);
  });
});

describe("Spec 128 §7 — cross-page window equivalence", () => {
  it("two calls to build7dWindow at the same instant produce identical windows", () => {
    const now = new Date("2026-08-26T15:00:00.000Z");
    const winA = build7dWindow(now);
    const winB = build7dWindow(now);
    // When agents.ts and governance-observability.ts both call build7dWindow
    // at the same deterministic now, they produce the same [start, end) bounds.
    expect(winA.startIso).toBe(winB.startIso);
    expect(winA.endIso).toBe(winB.endIso);
  });

  it("MetricWindow shape has all required fields", () => {
    const win: MetricWindow = build7dWindow(new Date());
    expect(typeof win.startIso).toBe("string");
    expect(typeof win.endIso).toBe("string");
    expect(typeof win.asOf).toBe("string");
  });
});
