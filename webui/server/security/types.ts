/**
 * Durable security state — shared contracts (Spec §2, ADR D1/D2).
 *
 * Every store call returns a `SecurityResult`. Storage failures are reported as
 * `SECURITY_STORE_UNAVAILABLE` and must be treated as fail-closed by callers;
 * the store never substitutes empty or in-memory fallback data.
 */

export type SecurityUnavailableReason =
  | "path_unsafe"
  | "permission"
  | "open_failed"
  | "schema_unsupported"
  | "schema_corrupt"
  | "busy"
  | "readonly"
  | "capacity"
  | "closed"
  | "io_error";

export type SecurityFailure =
  | {
      ok: false;
      code: "SECURITY_STORE_UNAVAILABLE";
      reason: SecurityUnavailableReason;
      message: string;
    }
  | {
      ok: false;
      code: "SECURITY_CONFLICT" | "SECURITY_NOT_FOUND";
      reason: string;
      message: string;
    };

export type SecurityResult<T> = { ok: true; value: T } | SecurityFailure;

export type AccountStatus = "enabled" | "disabled" | "tombstoned";

export type AdminAccountState = {
  accountUid: string;
  displayId: string;
  sessionEpoch: number;
  status: AccountStatus;
  credentialFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
  tombstonedAt: number | null;
};

export type AdminSession = {
  jtiHash: string;
  accountUid: string;
  issuedEpoch: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiry: number;
  revokedAt: number | null;
};

export type SessionValidation =
  | { valid: true; session: AdminSession }
  | {
      valid: false;
      reason: "unknown_session" | "revoked" | "expired" | "account_inactive" | "epoch_mismatch";
    };

export type BootstrapState = {
  state: "open" | "consumed";
  consumedAt: number | null;
  consumedByUid: string | null;
};

export type RateBucketDecision = {
  allowed: boolean;
  count: number;
  /** Seconds until the bucket window ends; > 0 only when `allowed` is false. */
  retryAfterSeconds: number;
};

export type SecurityEventPhase =
  | "prepare"
  | "commit"
  | "abort"
  | "decision"
  | "result"
  | "recovery"
  // T07 response-release phases (Spec §5.1). `response_delivered` means the body was
  // handed to the transport; it is not a client acknowledgement.
  | "request_admitted"
  | "response_prepared"
  | "response_delivered"
  | "response_failed"
  | "interrupted";

export type SecurityEventInput = {
  eventId: string;
  operationId: string;
  phase: SecurityEventPhase;
  actor: string;
  actorType: string;
  networkInfo?: string;
  sessionFingerprint?: string;
  traceId?: string;
  policyVersion?: string;
  contextVersion?: string;
  objectHash?: string;
  verdict?: string;
  resultSummary?: string;
  /**
   * Spec 173 v0.3 / 2026-10-19 audit-trust §2.3 — kind of audit-management event.
   * Pre-v2 rows stay NULL. New kinds include `audit_management`, `association_revision`,
   * `client_observation` (T06), `scrub`, `export_prepared`, `export_failed`. The
   * semantic-layer `event_type` column is a different axis (the row's actual
   * subject: tool_call / protocol / etc.).
   */
  auditEventKind?: string;
};

export type SecurityEvent = Omit<Required<SecurityEventInput>, "auditEventKind"> & {
  seq: number;
  createdAt: number;
  /** Spec 173 v0.3 / 2026-10-19 audit-trust §2.3 — NULL for pre-v2 rows. */
  auditEventKind: string | null;
};

/** Whether a pending operation narrows, widens, or does not change effective permissions. */
export type OperationDirection = "narrow" | "widen" | "neutral";

export type OperationState = "pending" | "committed" | "aborted" | "needs_review";

export type PendingOperation = {
  operationId: string;
  kind: string;
  direction: OperationDirection;
  state: OperationState;
  objectHash: string | null;
  summary: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type PrepareOperationInput = {
  operationId: string;
  kind: string;
  direction: OperationDirection;
  actor: string;
  actorType: string;
  objectHash?: string;
  /** Short non-sensitive summary. Never put credentials, tokens or filter values here. */
  summary?: string;
  traceId?: string;
};
