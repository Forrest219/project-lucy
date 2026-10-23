export type AuditWriteHealthSnapshot = {
  state: "ok" | "partial";
  scope: "current_process";
  observedSince: string;
  pendingWrites: number;
  failedWrites: number;
  successfulWrites: number;
  lastSuccessfulWriteAt?: string;
  lastFailureAt?: string;
  /**
   * T07: the canonical ledger (security.sqlite) is the core health signal. It is
   * reported separately and is never softened by `projection` lag, which only
   * affects how complete the audit views are.
   */
  ledger: LedgerHealth;
  projection: ProjectionHealth;
};

export type LedgerHealth = {
  state: "ok" | "unavailable";
  failedAppends: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
};

export type ProjectionHealth = {
  complete: boolean | null;
  lag: number;
  delayMs: number;
  reason?: string;
  checkedAt?: string;
};

const observedSince = new Date().toISOString();
let pendingWrites = 0;
let failedWrites = 0;
let successfulWrites = 0;
let lastSuccessfulWriteAt: string | undefined;
let lastFailureAt: string | undefined;
let ledgerFailedAppends = 0;
let ledgerLastFailureAt: string | undefined;
let ledgerLastSuccessAt: string | undefined;
let ledgerUnavailable = false;
let projection: ProjectionHealth = { complete: null, lag: 0, delayMs: 0 };

/** Result of the latest canonical ledger append; any failure marks the ledger unavailable until the next success. */
export function recordLedgerAppend(ok: boolean): void {
  const now = new Date().toISOString();
  if (ok) {
    ledgerUnavailable = false;
    ledgerLastSuccessAt = now;
    return;
  }
  ledgerUnavailable = true;
  ledgerFailedAppends += 1;
  ledgerLastFailureAt = now;
}

export function recordProjectionStatus(status: { complete: boolean; lag: number; delayMs: number; reason?: string }): void {
  projection = { ...status, checkedAt: new Date().toISOString() };
}

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
    lastFailureAt,
    ledger: {
      state: ledgerUnavailable ? "unavailable" : "ok",
      failedAppends: ledgerFailedAppends,
      lastFailureAt: ledgerLastFailureAt,
      lastSuccessAt: ledgerLastSuccessAt
    },
    projection: { ...projection }
  };
}

/** Test-only reset kept explicit so production callers cannot hide failures. */
export function resetAuditWriteHealthForTests(): void {
  pendingWrites = 0;
  failedWrites = 0;
  successfulWrites = 0;
  lastSuccessfulWriteAt = undefined;
  lastFailureAt = undefined;
  ledgerFailedAppends = 0;
  ledgerLastFailureAt = undefined;
  ledgerLastSuccessAt = undefined;
  ledgerUnavailable = false;
  projection = { complete: null, lag: 0, delayMs: 0 };
}
