const WARMUP_MS = 60_000;
let bootAt = Date.now();
let ready = false;

/** Called once the HTTP listener is up. */
export function markWebuiWarmupComplete(): void {
  ready = true;
}

export function resetWebuiWarmupForTests(): void {
  ready = false;
  bootAt = Date.now();
}

/** Ready after startup marks it, or after the 60s warmup budget. */
export function isWebuiReady(now = Date.now()): boolean {
  return ready || now - bootAt >= WARMUP_MS;
}
