import { randomUUID } from "node:crypto";

export type AuditHealthTransition = {
  eventType: "audit_ledger_unavailable" | "audit_ledger_recovered";
  /** One incident id spans the outage and its recovery. */
  incidentId: string;
  observedAt: string;
};

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

/**
 * L25-05 / F-13 — the stability window.
 *
 * The ledger reports the result of EVERY append, and a batch can mix successes
 * with failures. Reading each flip as an incident would turn one transient
 * failure into an incident/recovery pair (and repeated flips into a mail
 * storm), so an incident is only declared after a stable failure, and a
 * recovery only after a stable success.
 */
const LEDGER_FAILURE_STREAK = 3;
const LEDGER_FAILURE_WINDOW_MS = 60_000;
const LEDGER_SUCCESS_STREAK = 3;
const LEDGER_SUCCESS_WINDOW_MS = 60_000;

let ledgerFailureStreak = 0;
let ledgerSuccessStreak = 0;
let ledgerFailureSince: number | null = null;
let ledgerSuccessSince: number | null = null;
/** The incident currently in progress, or null when the ledger is healthy. */
let ledgerIncidentId: string | null = null;

type AuditHealthTransitionListener = (transition: AuditHealthTransition) => void;
const transitionListeners = new Set<AuditHealthTransitionListener>();

/**
 * Subscribe to ledger incidents and recoveries. Listeners MUST NOT perform I/O:
 * the ledger path never waits for a file, a database, or an SMTP server
 * (Spec §4.1).
 */
export function onAuditHealthTransition(listener: AuditHealthTransitionListener): () => void {
  transitionListeners.add(listener);
  return () => {
    transitionListeners.delete(listener);
  };
}

function emitTransition(transition: AuditHealthTransition): void {
  for (const listener of transitionListeners) {
    try {
      listener(transition);
    } catch {
      // A listener must never break the ledger path.
    }
  }
}

function evaluateLedgerFailure(now: number): void {
  ledgerFailureStreak += 1;
  ledgerSuccessStreak = 0;
  ledgerSuccessSince = null;
  if (ledgerFailureSince === null) ledgerFailureSince = now;
  if (ledgerIncidentId !== null) return; // the incident is already running
  const stable =
    ledgerFailureStreak >= LEDGER_FAILURE_STREAK || now - ledgerFailureSince >= LEDGER_FAILURE_WINDOW_MS;
  if (!stable) return;
  const incidentId = randomUUID();
  ledgerIncidentId = incidentId;
  emitTransition({
    eventType: "audit_ledger_unavailable",
    incidentId,
    observedAt: new Date(now).toISOString()
  });
}

function evaluateLedgerRecovery(now: number): void {
  ledgerSuccessStreak += 1;
  ledgerFailureStreak = 0;
  ledgerFailureSince = null;
  if (ledgerSuccessSince === null) ledgerSuccessSince = now;
  if (ledgerIncidentId === null) return; // no incident ⇒ no recovery event
  const stable =
    ledgerSuccessStreak >= LEDGER_SUCCESS_STREAK || now - ledgerSuccessSince >= LEDGER_SUCCESS_WINDOW_MS;
  if (!stable) return;
  const incidentId = ledgerIncidentId;
  ledgerIncidentId = null;
  emitTransition({
    eventType: "audit_ledger_recovered",
    incidentId,
    observedAt: new Date(now).toISOString()
  });
}

/** Result of the latest canonical ledger append; any failure marks the ledger unavailable until the next success. */
export function recordLedgerAppend(ok: boolean): void {
  const now = Date.now();
  if (ok) {
    ledgerUnavailable = false;
    ledgerLastSuccessAt = new Date(now).toISOString();
    evaluateLedgerRecovery(now);
    return;
  }
  ledgerUnavailable = true;
  ledgerFailedAppends += 1;
  ledgerLastFailureAt = new Date(now).toISOString();
  evaluateLedgerFailure(now);
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
  ledgerFailureStreak = 0;
  ledgerSuccessStreak = 0;
  ledgerFailureSince = null;
  ledgerSuccessSince = null;
  ledgerIncidentId = null;
  transitionListeners.clear();
  projection = { complete: null, lag: 0, delayMs: 0 };
}
