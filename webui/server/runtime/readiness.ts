let ready = false;

/** Called only after both the HTTP listener and the MCP listener are bound. */
export function markWebuiWarmupComplete(): void {
  ready = true;
}

export function resetWebuiWarmupForTests(): void {
  ready = false;
}

/** Elapsed startup time cannot establish that the MCP listener is available. */
export function isWebuiReady(): boolean {
  return ready;
}
