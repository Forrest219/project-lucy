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
  | "interrupted"
  // Lucy v0.25 / L25-09 S02: the ingress barrier. `received` is the FIRST
  // durable ledger event for a request — written once the request has been
  // received at the Lucy boundary, before validation / authorization / budget
  // evaluation and before any upstream dispatch. Its event_id is the
  // `ingress_event_id` returned to the client (Spec §6.3 / U12).
  | "received";

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
   *
   * `null` is accepted on purpose: a stored event read back from SQLite carries
   * `string | null`, and re-appending such an event (ledger replay, projection
   * seeding) must type-check. The writer normalises both `undefined` and `null`
   * to SQL NULL.
   */
  auditEventKind?: string | null;
  /**
   * Lucy v0.25 / L25-09 S02 §5.3 — logical ingress endpoint.
   * `mcp-http` / `admin-http` / `agent-audit-ingest`. The listening port is a
   * registration attribute, not the endpoint identity; MCP (57881) and admin
   * (55176) coexist legitimately.
   */
  endpointId?: string | null;
};

export type SecurityEvent = Omit<Required<Omit<SecurityEventInput, "auditEventKind" | "endpointId">>, "auditEventKind" | "endpointId"> & {
  seq: number;
  createdAt: number;
  /** Spec 173 v0.3 / 2026-10-19 audit-trust §2.3 — NULL for pre-v2 rows. */
  auditEventKind: string | null;
  /** Lucy v0.25 / L25-09 S02 §5.3 — NULL for pre-v3 rows. */
  endpointId: string | null;
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

/**
 * Spec 193 §8.2 — the per-key projection of a durable Wiki access operation.
 *
 * A row in state `pending` or `needs_review` with direction `widen` is a
 * HOLD: the Wiki key is denied to Agent search and read, and every other
 * write on that key is refused.
 */
export type WikiAccessOperationRecord = {
  operationId: string;
  wikiKey: string;
  oldHash: string | null;
  targetHash: string | null;
  direction: OperationDirection;
  state: OperationState;
  createdAt: number;
  resolvedAt: number | null;
};

export type PrepareWikiAccessOperationInput = {
  operationId: string;
  wikiKey: string;
  direction: OperationDirection;
  actor: string;
  actorType: string;
  oldHash?: string;
  targetHash?: string;
  /** Short non-sensitive summary; never the Markdown body. */
  summary?: string;
  traceId?: string;
};

/** Spec 193 §7.4 — the durable per-document status of a bulk authorization run. */
export type WikiBatchItemStatus =
  | "pending"
  | "applied"
  | "noop"
  | "conflict"
  | "failed"
  | "not_run"
  | "needs_review";

export type WikiAccessBatchRecord = {
  operationId: string;
  planDigest: string;
  idempotencyKey: string | null;
  actionJson: string;
  roleChannelVersion: string;
  status: "pending" | "completed" | "failed";
  createdAt: number;
  updatedAt: number;
};

export type WikiAccessBatchItemRecord = {
  operationId: string;
  wikiKey: string;
  expectedVersion: string | null;
  targetHash: string | null;
  aclSummary: string | null;
  direction: string | null;
  status: WikiBatchItemStatus;
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: number;
};
