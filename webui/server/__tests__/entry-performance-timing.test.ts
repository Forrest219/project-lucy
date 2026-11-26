import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  addTiming,
  countEntryPerf,
  createRequestTiming,
  degradeHeaders,
  formatServerTiming,
  markDisplayCache,
  markDisplayDegraded,
  markRequestDegraded,
  readEntryPerfCounters,
  registerEntryPerformanceTiming,
  resetEntryPerfCounters,
  timeAsync,
  withRequestTiming
} from "../entry-performance-timing";

describe("Spec 174 entry-performance timing", () => {
  it("formats only fixed metric names with durations and cache descriptor", () => {
    const timing = createRequestTiming(0);
    addTiming("manifest", 12.34, timing);
    addTiming("permissions", 3, timing);
    addTiming("nope" as never, 5, timing);
    markDisplayCache("hit", timing);
    const header = formatServerTiming(timing, 20);
    expect(header).toBe("manifest;dur=12.3, permissions;dur=3.0, total;dur=20.0, cache;desc=hit, builds;desc=0");
    expect(header).not.toContain("nope");
  });

  it("exposes a degraded grace read without changing the cache descriptor", () => {
    const timing = createRequestTiming(0);
    markDisplayCache("hit", timing);
    markDisplayDegraded("grace", timing);
    expect(formatServerTiming(timing, 5)).toBe("total;dur=5.0, cache;desc=hit, degraded;desc=grace, builds;desc=0");
  });

  it("P1-75 exposes stale and pending as Server-Timing degraded descriptors", () => {
    const stale = createRequestTiming(0);
    markDisplayDegraded({ state: "stale", ageMs: 200_000, generation: "D1.P2" }, stale);
    expect(formatServerTiming(stale, 5)).toContain("degraded;desc=stale");
    const pending = createRequestTiming(0);
    markDisplayDegraded({ state: "pending", generation: "D1.P2", pendingMs: 1200 }, pending);
    expect(formatServerTiming(pending, 5)).toContain("degraded;desc=pending");
  });

  it("P1-75 the worst degraded state of a request wins (pending > stale > grace) and the age keeps the maximum", () => {
    const timing = createRequestTiming(0);
    markDisplayDegraded({ state: "grace", ageMs: 10, generation: "P1" }, timing);
    markDisplayDegraded({ state: "stale", ageMs: 500, generation: "P1" }, timing);
    markDisplayDegraded({ state: "stale", ageMs: 900, generation: "P1" }, timing);
    markDisplayDegraded({ state: "grace", ageMs: 5, generation: "P1" }, timing);
    expect(timing.degradeMark).toMatchObject({ state: "stale", ageMs: 900 });
    markDisplayDegraded({ state: "pending", generation: "P1", pendingMs: 3 }, timing);
    expect(timing.degradeMark?.state).toBe("pending");
    expect(timing.degraded).toBe("pending");
  });

  it("P1-75 frozen header contract: state, age (not for pending), generation, pending time, prolonged", () => {
    expect(degradeHeaders({ state: "grace", ageMs: 4200.4, generation: "D3.P5" })).toEqual({
      "X-Lucy-Display-State": "grace",
      "X-Lucy-Display-Age-Ms": "4200",
      "X-Lucy-Display-Generation": "D3.P5"
    });
    expect(degradeHeaders({ state: "stale", ageMs: 190_000, generation: "D3.P5", prolonged: true })).toEqual({
      "X-Lucy-Display-State": "stale",
      "X-Lucy-Display-Age-Ms": "190000",
      "X-Lucy-Display-Generation": "D3.P5",
      "X-Lucy-Display-Prolonged": "1"
    });
    const pending = degradeHeaders({ state: "pending", generation: "D3.P5", pendingMs: 700, ageMs: 99 });
    expect(pending).toEqual({
      "X-Lucy-Display-State": "pending",
      "X-Lucy-Display-Generation": "D3.P5",
      "X-Lucy-Display-Pending-Ms": "700"
    });
    expect(pending).not.toHaveProperty("X-Lucy-Display-Age-Ms");
  });

  it("P1-75 emits the degraded headers on API responses, and none on a fresh read", async () => {
    const app = Fastify();
    registerEntryPerformanceTiming(app);
    app.get("/api/fresh", async (request) => withRequestTiming(request, async () => ({ ok: true })));
    app.get("/api/stale", async (request) => withRequestTiming(request, async () => {
      markDisplayDegraded({ state: "stale", ageMs: 150_000, generation: "D1" });
      return { ok: true };
    }));
    app.get("/api/outside", async (request) => {
      markRequestDegraded(request, { state: "pending", generation: "L2", pendingMs: 0 });
      return { ok: true };
    });
    const fresh = await app.inject({ method: "GET", url: "/api/fresh" });
    expect(fresh.headers["x-lucy-display-state"]).toBeUndefined();
    expect(String(fresh.headers["server-timing"])).not.toContain("degraded");
    const stale = await app.inject({ method: "GET", url: "/api/stale" });
    expect(stale.headers["x-lucy-display-state"]).toBe("stale");
    expect(stale.headers["x-lucy-display-age-ms"]).toBe("150000");
    expect(stale.headers["x-lucy-display-generation"]).toBe("D1");
    expect(String(stale.headers["server-timing"])).toContain("degraded;desc=stale");
    const outside = await app.inject({ method: "GET", url: "/api/outside" });
    expect(outside.headers["x-lucy-display-state"]).toBe("pending");
    expect(outside.headers["x-lucy-display-age-ms"]).toBeUndefined();
    await app.close();
  });

  it("counts structural reads and resets", () => {
    resetEntryPerfCounters();
    countEntryPerf("manifestParses", 3);
    countEntryPerf("sourceMapBuilds");
    expect(readEntryPerfCounters()).toMatchObject({ manifestParses: 3, sourceMapBuilds: 1 });
    resetEntryPerfCounters();
    expect(readEntryPerfCounters().manifestParses).toBe(0);
  });

  it("emits Server-Timing on API responses without object names or SQL", async () => {
    const app = Fastify();
    registerEntryPerformanceTiming(app);
    app.get("/api/thing/:name", async (request) => withRequestTiming(request, async () => {
      await timeAsync("manifest", async () => "secret_table_name");
      return { ok: true, data: { name: (request.params as { name: string }).name } };
    }));
    const response = await app.inject({ method: "GET", url: "/api/thing/secret_table_name?sql=select" });
    const header = String(response.headers["server-timing"]);
    expect(header).toMatch(/^manifest;dur=\d+\.\d, total;dur=\d+\.\d, builds;desc=0$/);
    expect(header).not.toMatch(/secret|select/);
    await app.close();
  });
});
