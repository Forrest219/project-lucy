/**
 * P1-81 — proof that the KTX upstream is *working*, not just reachable.
 *
 * The 1.5 s execution probe times out when KTX is saturated by legitimate load (every query queues),
 * which is indistinguishable from a deadlocked daemon by probe alone. A completed `tools/call` answer
 * from KTX within the last window proves it is processing work, so a saturated-but-alive KTX is never
 * a STUCK signal. A deadlocked daemon answers nothing, so the proof ages out.
 */
let lastToolCallResponseAt = 0;

export function markUpstreamToolCallResponded(now: number = Date.now()): void {
  lastToolCallResponseAt = now;
}

export function upstreamRespondedWithin(windowMs: number, now: number = Date.now()): boolean {
  return lastToolCallResponseAt > 0 && now - lastToolCallResponseAt <= windowMs;
}

export function resetUpstreamLivenessForTests(): void {
  lastToolCallResponseAt = 0;
}
