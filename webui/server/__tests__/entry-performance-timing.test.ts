import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  addTiming,
  countEntryPerf,
  createRequestTiming,
  formatServerTiming,
  markDisplayCache,
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
