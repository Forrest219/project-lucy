import { monitorEventLoopDelay } from "node:perf_hooks";

const WINDOW_MS = 60_000;
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let closed = { p99Ms: 0, maxMs: 0 };
let windowStarted = Date.now();

function nanosToMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round((value / 1e6) * 1000) / 1000;
}

function rotate(now = Date.now()): void {
  if (now - windowStarted < WINDOW_MS) return;
  closed = {
    p99Ms: nanosToMs(histogram.percentile(99)),
    maxMs: nanosToMs(histogram.max)
  };
  histogram.reset();
  windowStarted = now;
}

/** In-memory event-loop delay. Nothing is written to disk. */
export function eventLoopDelaySnapshot(): { p99Ms: number; maxMs: number; windowSeconds: number } {
  rotate();
  return {
    p99Ms: Math.max(closed.p99Ms, nanosToMs(histogram.percentile(99))),
    maxMs: Math.max(closed.maxMs, nanosToMs(histogram.max)),
    windowSeconds: 60
  };
}
