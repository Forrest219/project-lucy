import {
  getProcessLifecyclePhase,
  markProcessServing,
  resetProcessDrainForTests
} from "./process-drain.js";

let ready = false;

/** Called only after both the HTTP listener and the MCP listener are bound. */
export function markWebuiWarmupComplete(): void {
  ready = true;
  markProcessServing();
}

export function resetWebuiWarmupForTests(): void {
  ready = false;
  resetProcessDrainForTests();
}

/**
 * Elapsed startup time cannot establish that the MCP listener is available.
 * DRAINING/STOPPING/STOPPED also keep readiness false (P1-63).
 */
export function isWebuiReady(): boolean {
  return ready && getProcessLifecyclePhase() === "SERVING";
}
