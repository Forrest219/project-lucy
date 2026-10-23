/**
 * Spec 174 §8 / WO T0 — request timing and structural counters.
 *
 * Server-Timing only carries fixed metric names, durations and hit/miss
 * descriptors. It never includes object names, SQL, permissions or tokens.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";

export const SERVER_TIMING_NAMES = [
  "manifest",
  "overlay",
  "access",
  "permissions",
  "stats",
  "serialize",
  "queue",
  "total"
] as const;
export type ServerTimingName = (typeof SERVER_TIMING_NAMES)[number];
export type DisplayCacheState = "hit" | "miss";

const ALLOWED_NAMES = new Set<string>(SERVER_TIMING_NAMES);

export type RequestTiming = {
  startedAt: number;
  durations: Map<ServerTimingName, number>;
  cache?: DisplayCacheState;
  builds: number;
};

export type EntryPerfCounters = {
  manifestParses: number;
  overlayReads: number;
  sourceMapBuilds: number;
  accessReads: number;
  enabledTableReads: number;
  displayBuilds: number;
  displayHits: number;
  displayMisses: number;
};

function emptyCounters(): EntryPerfCounters {
  return {
    manifestParses: 0,
    overlayReads: 0,
    sourceMapBuilds: 0,
    accessReads: 0,
    enabledTableReads: 0,
    displayBuilds: 0,
    displayHits: 0,
    displayMisses: 0
  };
}

let counters: EntryPerfCounters = emptyCounters();
const storage = new AsyncLocalStorage<RequestTiming>();
const requestTimings = new WeakMap<FastifyRequest, RequestTiming>();

export function countEntryPerf(name: keyof EntryPerfCounters, delta = 1): void {
  counters[name] += delta;
}

export function readEntryPerfCounters(): EntryPerfCounters {
  return { ...counters };
}

export function resetEntryPerfCounters(): void {
  counters = emptyCounters();
}

export function createRequestTiming(now = performance.now()): RequestTiming {
  return { startedAt: now, durations: new Map(), builds: 0 };
}

export function currentRequestTiming(): RequestTiming | undefined {
  return storage.getStore();
}

export function addTiming(name: ServerTimingName, ms: number, timing = currentRequestTiming()): void {
  if (!timing || !ALLOWED_NAMES.has(name) || !Number.isFinite(ms)) return;
  timing.durations.set(name, (timing.durations.get(name) ?? 0) + Math.max(0, ms));
}

export async function timeAsync<T>(name: ServerTimingName, fn: () => Promise<T>): Promise<T> {
  const timing = currentRequestTiming();
  if (!timing) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    addTiming(name, performance.now() - start, timing);
  }
}

export function markDisplayCache(state: DisplayCacheState, timing = currentRequestTiming()): void {
  if (timing) timing.cache = state;
}

export function markDisplayBuild(timing = currentRequestTiming()): void {
  if (timing) timing.builds += 1;
}

/** Fixed-name Server-Timing header value. */
export function formatServerTiming(timing: RequestTiming, now = performance.now()): string {
  const parts: string[] = [];
  for (const name of SERVER_TIMING_NAMES) {
    if (name === "total") continue;
    const value = timing.durations.get(name);
    if (value !== undefined) parts.push(`${name};dur=${value.toFixed(1)}`);
  }
  parts.push(`total;dur=${(now - timing.startedAt).toFixed(1)}`);
  if (timing.cache) parts.push(`cache;desc=${timing.cache}`);
  parts.push(`builds;desc=${timing.builds}`);
  return parts.join(", ");
}

/** Run a handler with a request-scoped timing context (Server-Timing emitted in onSend). */
export function withRequestTiming<T>(request: FastifyRequest, fn: () => Promise<T>): Promise<T> {
  const timing = requestTimings.get(request) ?? createRequestTiming();
  requestTimings.set(request, timing);
  return storage.run(timing, fn);
}

export function registerEntryPerformanceTiming(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    requestTimings.set(request, createRequestTiming());
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const timing = requestTimings.get(request);
    if (timing && request.url.startsWith("/api/")) {
      reply.header("Server-Timing", formatServerTiming(timing));
    }
    return payload;
  });
}
