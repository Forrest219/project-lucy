import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseProbePurpose,
  ProbeAbortedError,
  ProbeQueueFullError,
  ProbeScheduler,
  PROBE_CONCURRENCY,
  PROBE_MAX_QUEUED
} from "../background-probes";

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Spec 174 T5 — probe scheduler (SC-09/10/20)", () => {
  it("never runs more than 2 commands and starts queued work as permits free up", async () => {
    const scheduler = new ProbeScheduler();
    let active = 0;
    let peak = 0;
    const gates = Array.from({ length: 7 }, () => deferred());
    const results = gates.map((gate, index) => scheduler.submit({
      key: `c${index}:test`,
      generation: 0,
      purpose: "automatic",
      run: async () => {
        active += 1;
        peak = Math.max(peak, active);
        try {
          return await gate.promise;
        } finally {
          active -= 1;
        }
      }
    }));
    await tick();
    expect(scheduler.stats().running).toBe(PROBE_CONCURRENCY);
    for (const [index, gate] of gates.entries()) {
      gate.resolve(`ok-${index}`);
      await tick();
    }
    const settled = await Promise.all(results);
    expect(settled.map((item) => item.value)).toEqual(gates.map((_, index) => `ok-${index}`));
    expect(peak).toBeLessThanOrEqual(PROBE_CONCURRENCY);
    expect(scheduler.stats().peakRunning).toBe(2);
    expect(settled[6]!.timing.queueMs).toBeGreaterThanOrEqual(0);
  });

  it("merges identical keys, keeps test and live-schemas separate", async () => {
    const scheduler = new ProbeScheduler();
    const run = vi.fn(async () => "shared");
    const live = vi.fn(async () => "live");
    const [a, b, c] = await Promise.all([
      scheduler.submit({ key: "c1:test", generation: 0, purpose: "automatic", run }),
      scheduler.submit({ key: "c1:test", generation: 0, purpose: "manual", run }),
      scheduler.submit({ key: "c1:live-schemas", generation: 0, purpose: "automatic", run: live })
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(live).toHaveBeenCalledTimes(1);
    expect(a.value).toBe("shared");
    expect(b.timing.shared).toBe(true);
    expect(c.value).toBe("live");
  });

  it("bounds the queue at 64 distinct keys with a retryable 503", async () => {
    const scheduler = new ProbeScheduler();
    const blocker = deferred();
    const running = [0, 1].map((index) => scheduler.submit({ key: `run${index}`, generation: 0, purpose: "automatic", run: () => blocker.promise }));
    const queued = Array.from({ length: PROBE_MAX_QUEUED }, (_, index) => scheduler.submit({ key: `q${index}`, generation: 0, purpose: "automatic", run: async () => "q" }));
    await tick();
    await expect(scheduler.submit({ key: "overflow", generation: 0, purpose: "manual", run: async () => "x" })).rejects.toMatchObject({ code: "PROBE_QUEUE_FULL", statusCode: 503, retryAfterSeconds: 1, message: "连通探测请求较多，请稍后重试。" });
    blocker.resolve("done");
    await Promise.all([...running, ...queued]);
  });

  it("serves manual first but runs an automatic task after 3 manual starts", async () => {
    const scheduler = new ProbeScheduler({ concurrency: 1 });
    const order: string[] = [];
    const blocker = deferred();
    const first = scheduler.submit({ key: "busy", generation: 0, purpose: "automatic", run: () => blocker.promise });
    const jobs = [
      ...["a1", "a2"].map((key) => scheduler.submit({ key, generation: 0, purpose: "automatic", run: async () => void order.push(key) })),
      ...["m1", "m2", "m3", "m4"].map((key) => scheduler.submit({ key, generation: 0, purpose: "manual", run: async () => void order.push(key) }))
    ];
    blocker.resolve("x");
    await Promise.all([first, ...jobs]);
    expect(order).toEqual(["m1", "m2", "m3", "a1", "m4", "a2"]);
  });

  it("expires queued work after the deadline and settles every subscriber", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new ProbeScheduler({ concurrency: 1, queueTimeoutMs: 60_000 });
      const blocker = deferred();
      const running = scheduler.submit({ key: "busy", generation: 0, purpose: "automatic", run: () => blocker.promise });
      const waiting = scheduler.submit({ key: "late", generation: 0, purpose: "automatic", run: async () => "late" });
      const waiting2 = scheduler.submit({ key: "late", generation: 0, purpose: "manual", run: async () => "late" });
      vi.advanceTimersByTime(60_001);
      await expect(waiting).rejects.toBeInstanceOf(ProbeQueueFullError);
      await expect(waiting2).rejects.toBeInstanceOf(ProbeQueueFullError);
      blocker.resolve("ok");
      await expect(running).resolves.toMatchObject({ value: "ok" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelling one subscriber neither fails others nor releases the permit early", async () => {
    const scheduler = new ProbeScheduler({ concurrency: 1 });
    const gate = deferred();
    const controller = new AbortController();
    const cancelled = scheduler.submit({ key: "c1:test", generation: 0, purpose: "automatic", run: () => gate.promise, signal: controller.signal });
    const kept = scheduler.submit({ key: "c1:test", generation: 0, purpose: "automatic", run: () => gate.promise });
    const next = vi.fn(async () => "next");
    const queuedNext = scheduler.submit({ key: "c2:test", generation: 0, purpose: "automatic", run: next });
    await tick();
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(ProbeAbortedError);
    await tick();
    expect(next).not.toHaveBeenCalled();
    gate.resolve("ok");
    await expect(kept).resolves.toMatchObject({ value: "ok" });
    await expect(queuedNext).resolves.toMatchObject({ value: "next" });

    const unstarted = new AbortController();
    const blocker = deferred();
    const busy = scheduler.submit({ key: "busy", generation: 0, purpose: "automatic", run: () => blocker.promise });
    const dropped = vi.fn(async () => "never");
    const leaving = scheduler.submit({ key: "c3:test", generation: 0, purpose: "automatic", run: dropped, signal: unstarted.signal });
    unstarted.abort();
    await expect(leaving).rejects.toBeInstanceOf(ProbeAbortedError);
    blocker.resolve("done");
    await busy;
    await tick();
    expect(dropped).not.toHaveBeenCalled();
    expect(scheduler.stats().queued).toBe(0);
  });

  it("holds the permit until a timed-out command actually settles", async () => {
    const scheduler = new ProbeScheduler({ concurrency: 1 });
    const child = deferred();
    const hung = scheduler.submit({ key: "slow", generation: 0, purpose: "automatic", run: () => child.promise });
    const waiting = vi.fn(async () => "w");
    const queued = scheduler.submit({ key: "next", generation: 0, purpose: "automatic", run: waiting });
    await tick();
    expect(waiting).not.toHaveBeenCalled();
    child.reject(new Error("timeout after 30s, child exited"));
    await expect(hung).rejects.toThrow(/timeout/);
    await expect(queued).resolves.toMatchObject({ value: "w" });
  });

  it("never delivers old-generation results and cancels unstarted stale work", async () => {
    let generation = 0;
    const scheduler = new ProbeScheduler({ concurrency: 1, currentGeneration: () => generation });
    const gate = deferred();
    const running = scheduler.submit({ key: "g0:c1", generation: 0, purpose: "automatic", run: () => gate.promise });
    const stale = vi.fn(async () => "stale");
    const queuedStale = scheduler.submit({ key: "g0:c2", generation: 0, purpose: "automatic", run: stale });
    await tick();
    generation = 1;
    scheduler.invalidateGeneration();
    await expect(queuedStale).rejects.toBeInstanceOf(ProbeQueueFullError);
    gate.resolve("old-config");
    await expect(running).rejects.toBeInstanceOf(ProbeQueueFullError);
    expect(stale).not.toHaveBeenCalled();
    await expect(scheduler.submit({ key: "g1:c1", generation: 1, purpose: "automatic", run: async () => "new" })).resolves.toMatchObject({ value: "new" });
  });

  it("validates the optional purpose without widening defaults", () => {
    expect(parseProbePurpose(undefined)).toBe("manual");
    expect(parseProbePurpose("automatic")).toBe("automatic");
    expect(parseProbePurpose("bulk")).toBeNull();
  });
});

describe("Spec 174 T5 — probe routes (SC-10)", () => {
  let projectRoot: string | undefined;
  const saved = { root: process.env.KTX_PROJECT_ROOT, content: process.env.LUCY_CONTENT_ROOT };

  afterEach(async () => {
    if (saved.root === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = saved.root;
    if (saved.content === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = saved.content;
    if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  });

  it("rejects an invalid purpose and keeps latencyMs as command time", async () => {
    vi.resetModules();
    vi.doMock("../ktx", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../ktx")>()),
      testConnection: vi.fn(async () => ({ status: "ok", latencyMs: 7, command: "ktx connection test c1", args: [], exitCode: 0, stdout: "", stderr: "" }))
    }));
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-probe-route-"));
    await mkdir(path.join(projectRoot, "semantic-layer"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections:\n  c1:\n    driver: mysql\n", "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const bad = await request(app.server).post("/api/connections/c1/test").send({ purpose: "bulk" });
      expect(bad.status).toBe(400);
      const ok = await request(app.server).post("/api/connections/c1/test").send({ purpose: "automatic" });
      expect(ok.status).toBe(200);
      expect(ok.body.data.latencyMs).toBe(7);
      expect(String(ok.headers["server-timing"])).toMatch(/queue;dur=/);
      const legacy = await request(app.server).post("/api/connections/c1/test").send({});
      expect(legacy.status).toBe(200);
    } finally {
      await app.close();
      vi.doUnmock("../ktx");
    }
  });
});
