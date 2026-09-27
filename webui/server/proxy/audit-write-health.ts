export type AuditWriteHealthSnapshot = {
  state: "ok" | "partial";
  scope: "current_process";
  observedSince: string;
  pendingWrites: number;
  failedWrites: number;
  successfulWrites: number;
  lastSuccessfulWriteAt?: string;
  lastFailureAt?: string;
};

const observedSince = new Date().toISOString();
let pendingWrites = 0;
let failedWrites = 0;
let successfulWrites = 0;
let lastSuccessfulWriteAt: string | undefined;
let lastFailureAt: string | undefined;

export function beginAuditWrite(): void {
  pendingWrites += 1;
}

export function completeAuditWrite(): void {
  pendingWrites = Math.max(0, pendingWrites - 1);
  successfulWrites += 1;
  lastSuccessfulWriteAt = new Date().toISOString();
}

export function failAuditWrite(): void {
  pendingWrites = Math.max(0, pendingWrites - 1);
  failedWrites += 1;
  lastFailureAt = new Date().toISOString();
}

export function readAuditWriteHealth(): AuditWriteHealthSnapshot {
  return {
    state: pendingWrites > 0 || failedWrites > 0 ? "partial" : "ok",
    scope: "current_process",
    observedSince,
    pendingWrites,
    failedWrites,
    successfulWrites,
    lastSuccessfulWriteAt,
    lastFailureAt
  };
}

/** Test-only reset kept explicit so production callers cannot hide failures. */
export function resetAuditWriteHealthForTests(): void {
  pendingWrites = 0;
  failedWrites = 0;
  successfulWrites = 0;
  lastSuccessfulWriteAt = undefined;
  lastFailureAt = undefined;
}
