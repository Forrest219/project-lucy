import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initSecuritySchema, SECURITY_DB_FILE } from "./schema";
import type {
  AccountStatus,
  AdminAccountState,
  AdminSession,
  BootstrapState,
  OperationState,
  PendingOperation,
  PrepareOperationInput,
  RateBucketDecision,
  SecurityEvent,
  SecurityEventInput,
  SecurityFailure,
  SecurityResult,
  SecurityUnavailableReason,
  SessionValidation
} from "./types";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_BUSY_TIMEOUT_MS = 2000;

export type OpenSecurityStoreOptions = {
  now?: () => number;
  busyTimeoutMs?: number;
};

type Row = Record<string, unknown>;

/** Thrown inside a transaction to roll back and surface a structured failure. */
class Abort extends Error {
  constructor(readonly failure: SecurityFailure) {
    super(failure.message);
  }
}

function unavailable(reason: SecurityUnavailableReason, message: string): SecurityFailure {
  return { ok: false, code: "SECURITY_STORE_UNAVAILABLE", reason, message };
}

function abort(code: "SECURITY_CONFLICT" | "SECURITY_NOT_FOUND", reason: string, message: string): never {
  throw new Abort({ ok: false, code, reason, message });
}

function classify(error: unknown): SecurityFailure {
  if (error instanceof Abort) return error.failure;
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = error instanceof Error ? error.message : "security store error";
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) return unavailable("busy", message);
  if (code.startsWith("SQLITE_READONLY")) return unavailable("readonly", message);
  if (code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_NOTADB") return unavailable("schema_corrupt", message);
  if (code === "EACCES" || code === "EPERM") return unavailable("permission", message);
  return unavailable("io_error", message);
}

export function hashSessionJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

function accountFromRow(row: Row): AdminAccountState {
  return {
    accountUid: row.account_uid as string,
    displayId: row.display_id as string,
    sessionEpoch: row.session_epoch as number,
    status: row.status as AccountStatus,
    credentialFingerprint: (row.credential_fingerprint as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    tombstonedAt: (row.tombstoned_at as number | null) ?? null
  };
}

function sessionFromRow(row: Row): AdminSession {
  return {
    jtiHash: row.jti_hash as string,
    accountUid: row.account_uid as string,
    issuedEpoch: row.issued_epoch as number,
    createdAt: row.created_at as number,
    lastSeenAt: row.last_seen_at as number,
    absoluteExpiry: row.absolute_expiry as number,
    revokedAt: (row.revoked_at as number | null) ?? null
  };
}

function operationFromRow(row: Row): PendingOperation {
  return {
    operationId: row.operation_id as string,
    kind: row.kind as string,
    direction: row.direction as PendingOperation["direction"],
    state: row.state as OperationState,
    objectHash: (row.object_hash as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    createdAt: row.created_at as number,
    resolvedAt: (row.resolved_at as number | null) ?? null
  };
}

function eventFromRow(row: Row): SecurityEvent {
  return {
    seq: row.seq as number,
    eventId: row.event_id as string,
    operationId: row.operation_id as string,
    phase: row.phase as SecurityEvent["phase"],
    actor: row.actor as string,
    actorType: row.actor_type as string,
    networkInfo: row.network_info as string,
    sessionFingerprint: row.session_fingerprint as string,
    traceId: row.trace_id as string,
    policyVersion: row.policy_version as string,
    contextVersion: row.context_version as string,
    objectHash: row.object_hash as string,
    verdict: row.verdict as string,
    resultSummary: row.result_summary as string,
    auditEventKind: (row.audit_event_kind as string | null) ?? null,
    createdAt: row.created_at as number
  };
}

const OPERATION_TRANSITIONS: Record<OperationState, readonly OperationState[]> = {
  pending: ["committed", "aborted", "needs_review"],
  needs_review: ["committed", "aborted"],
  committed: [],
  aborted: []
};

function securityPaths(projectRoot: string) {
  const dir = path.join(projectRoot, ".ktx-ui");
  const db = path.join(dir, SECURITY_DB_FILE);
  return { dir, db, sidecars: [`${db}-wal`, `${db}-shm`] };
}

function tightenPermissions(paths: ReturnType<typeof securityPaths>): void {
  chmodSync(paths.dir, DIR_MODE);
  for (const file of [paths.db, ...paths.sidecars]) {
    if (existsSync(file)) chmodSync(file, FILE_MODE);
  }
}

function assertNotSymlink(target: string, label: string): void {
  let stat;
  try {
    stat = lstatSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Abort(unavailable("path_unsafe", `${label} must not be a symlink`));
}

function prepareDirectory(dir: string): void {
  assertNotSymlink(dir, ".ktx-ui");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  } else if (!lstatSync(dir).isDirectory()) {
    throw new Abort(unavailable("path_unsafe", ".ktx-ui is not a directory"));
  }
}

function removeIfCreated(paths: ReturnType<typeof securityPaths>): void {
  for (const file of [paths.db, ...paths.sidecars]) rmSync(file, { force: true });
}

/**
 * Open (creating if needed) `<projectRoot>/.ktx-ui/security.sqlite`.
 *
 * Fail-closed: any failure yields a structured `SECURITY_STORE_UNAVAILABLE`.
 * No in-memory or empty replacement database is ever created, and a pre-existing
 * unreadable/corrupt database file is left untouched for operators.
 */
export function openSecurityStore(
  projectRoot: string,
  options: OpenSecurityStoreOptions = {}
): SecurityResult<SecurityStore> {
  const paths = securityPaths(projectRoot);
  const busyTimeoutMs = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  let createdFile = false;
  let db: Database.Database | undefined;
  try {
    prepareDirectory(paths.dir);
    assertNotSymlink(paths.db, SECURITY_DB_FILE);
    if (!existsSync(paths.db)) {
      closeSync(openSync(paths.db, "a", FILE_MODE));
      createdFile = true;
    }
    tightenPermissions(paths);
    db = new Database(paths.db, { fileMustExist: true, timeout: busyTimeoutMs });
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.pragma("foreign_keys = ON");
    if ((db.pragma("synchronous", { simple: true }) as number) !== 2) {
      throw new Abort(unavailable("io_error", "synchronous=FULL could not be enforced"));
    }
    if (String(db.pragma("journal_mode", { simple: true })).toLowerCase() !== "wal") {
      throw new Abort(unavailable("io_error", "WAL journal mode could not be enabled"));
    }
    const init = initSecuritySchema(db);
    if (!init.ok) throw new Abort(unavailable(init.reason, init.message));
    tightenPermissions(paths);
    return { ok: true, value: new SecurityStore(db, paths, options.now ?? Date.now) };
  } catch (error) {
    try {
      db?.close();
    } catch {
      // already unusable
    }
    if (createdFile) removeIfCreated(paths);
    return classify(error);
  }
}

export class SecurityStore {
  constructor(
    private readonly db: Database.Database,
    private readonly paths: ReturnType<typeof securityPaths>,
    private readonly now: () => number
  ) {}

  get databasePath(): string {
    return this.paths.db;
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  private read<T>(fn: (db: Database.Database) => T): SecurityResult<T> {
    if (!this.db.open) return unavailable("closed", "security store is closed");
    try {
      return { ok: true, value: fn(this.db) };
    } catch (error) {
      return classify(error);
    }
  }

  private write<T>(fn: (db: Database.Database) => T): SecurityResult<T> {
    if (!this.db.open) return unavailable("closed", "security store is closed");
    try {
      const value = this.db.transaction(() => fn(this.db)).immediate();
      return { ok: true, value };
    } catch (error) {
      return classify(error);
    }
  }

  // ---- accounts -----------------------------------------------------------

  upsertAccount(input: {
    accountUid: string;
    displayId: string;
    credentialFingerprint?: string;
  }): SecurityResult<AdminAccountState> {
    return this.write((db) => {
      const now = this.now();
      const existing = db.prepare("SELECT * FROM admin_account_state WHERE account_uid = ?").get(input.accountUid) as
        | Row
        | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO admin_account_state
             (account_uid, display_id, session_epoch, status, credential_fingerprint, created_at, updated_at)
           VALUES (?, ?, 0, 'enabled', ?, ?, ?)`
        ).run(input.accountUid, input.displayId, input.credentialFingerprint ?? null, now, now);
      } else {
        if (existing.status === "tombstoned") {
          abort("SECURITY_CONFLICT", "account_tombstoned", "account UID is tombstoned and cannot be reused");
        }
        db.prepare(
          `UPDATE admin_account_state
              SET display_id = ?, credential_fingerprint = COALESCE(?, credential_fingerprint), updated_at = ?
            WHERE account_uid = ?`
        ).run(input.displayId, input.credentialFingerprint ?? null, now, input.accountUid);
      }
      return accountFromRow(
        db.prepare("SELECT * FROM admin_account_state WHERE account_uid = ?").get(input.accountUid) as Row
      );
    });
  }

  getAccount(accountUid: string): SecurityResult<AdminAccountState | null> {
    return this.read((db) => {
      const row = db.prepare("SELECT * FROM admin_account_state WHERE account_uid = ?").get(accountUid) as
        | Row
        | undefined;
      return row ? accountFromRow(row) : null;
    });
  }

  /** Narrowing (disable) bumps the epoch and revokes sessions; enabling never widens old sessions. */
  setAccountStatus(accountUid: string, status: "enabled" | "disabled"): SecurityResult<AdminAccountState> {
    return this.write((db) => {
      const row = this.requireAccount(db, accountUid);
      if (row.status === "tombstoned") {
        abort("SECURITY_CONFLICT", "account_tombstoned", "tombstoned account cannot change status");
      }
      if (status === "disabled" && row.status !== "disabled") this.narrowAccount(db, accountUid);
      db.prepare("UPDATE admin_account_state SET status = ?, updated_at = ? WHERE account_uid = ?").run(
        status,
        this.now(),
        accountUid
      );
      return accountFromRow(this.requireAccount(db, accountUid));
    });
  }

  /** Invalidate every session of the account (e.g. password change). Returns the new epoch. */
  bumpSessionEpoch(accountUid: string): SecurityResult<number> {
    return this.write((db) => {
      this.requireAccount(db, accountUid);
      return this.narrowAccount(db, accountUid);
    });
  }

  tombstoneAccount(accountUid: string): SecurityResult<AdminAccountState> {
    return this.write((db) => {
      this.requireAccount(db, accountUid);
      this.narrowAccount(db, accountUid);
      const now = this.now();
      db.prepare(
        "UPDATE admin_account_state SET status = 'tombstoned', tombstoned_at = ?, updated_at = ? WHERE account_uid = ?"
      ).run(now, now, accountUid);
      return accountFromRow(this.requireAccount(db, accountUid));
    });
  }

  private requireAccount(db: Database.Database, accountUid: string): Row {
    const row = db.prepare("SELECT * FROM admin_account_state WHERE account_uid = ?").get(accountUid) as
      | Row
      | undefined;
    if (!row) abort("SECURITY_NOT_FOUND", "account_not_found", "account not found");
    return row;
  }

  private narrowAccount(db: Database.Database, accountUid: string): number {
    const now = this.now();
    db.prepare("UPDATE admin_account_state SET session_epoch = session_epoch + 1, updated_at = ? WHERE account_uid = ?").run(
      now,
      accountUid
    );
    db.prepare("UPDATE admin_sessions SET revoked_at = ? WHERE account_uid = ? AND revoked_at IS NULL").run(
      now,
      accountUid
    );
    return (
      db.prepare("SELECT session_epoch FROM admin_account_state WHERE account_uid = ?").get(accountUid) as Row
    ).session_epoch as number;
  }

  // ---- sessions -----------------------------------------------------------

  createSession(input: { jtiHash: string; accountUid: string; absoluteExpiry: number }): SecurityResult<AdminSession> {
    return this.write((db) => {
      const account = this.requireAccount(db, input.accountUid);
      if (account.status !== "enabled") {
        abort("SECURITY_CONFLICT", "account_inactive", "account is not enabled");
      }
      const now = this.now();
      try {
        db.prepare(
          `INSERT INTO admin_sessions
             (jti_hash, account_uid, issued_epoch, created_at, last_seen_at, absolute_expiry)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(input.jtiHash, input.accountUid, account.session_epoch, now, now, input.absoluteExpiry);
      } catch (error) {
        if (String((error as { code?: unknown }).code).startsWith("SQLITE_CONSTRAINT")) {
          abort("SECURITY_CONFLICT", "duplicate_session", "session id already exists");
        }
        throw error;
      }
      return sessionFromRow(db.prepare("SELECT * FROM admin_sessions WHERE jti_hash = ?").get(input.jtiHash) as Row);
    });
  }

  validateSession(jtiHash: string): SecurityResult<SessionValidation> {
    return this.read((db) => {
      const row = db.prepare("SELECT * FROM admin_sessions WHERE jti_hash = ?").get(jtiHash) as Row | undefined;
      if (!row) return { valid: false, reason: "unknown_session" } as const;
      const session = sessionFromRow(row);
      if (session.revokedAt !== null) return { valid: false, reason: "revoked" } as const;
      if (session.absoluteExpiry <= this.now()) return { valid: false, reason: "expired" } as const;
      const account = db.prepare("SELECT * FROM admin_account_state WHERE account_uid = ?").get(session.accountUid) as
        | Row
        | undefined;
      if (!account || account.status !== "enabled") return { valid: false, reason: "account_inactive" } as const;
      if (account.session_epoch !== session.issuedEpoch) return { valid: false, reason: "epoch_mismatch" } as const;
      return { valid: true, session } as const;
    });
  }

  touchSession(jtiHash: string): SecurityResult<void> {
    return this.write((db) => {
      db.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE jti_hash = ? AND revoked_at IS NULL").run(
        this.now(),
        jtiHash
      );
    });
  }

  revokeSession(jtiHash: string): SecurityResult<boolean> {
    return this.write(
      (db) =>
        db
          .prepare("UPDATE admin_sessions SET revoked_at = ? WHERE jti_hash = ? AND revoked_at IS NULL")
          .run(this.now(), jtiHash).changes > 0
    );
  }

  // ---- bootstrap ----------------------------------------------------------

  getBootstrapState(): SecurityResult<BootstrapState> {
    return this.read((db) => {
      const row = db.prepare("SELECT * FROM bootstrap_state WHERE id = 1").get() as Row;
      return {
        state: row.state as BootstrapState["state"],
        consumedAt: (row.consumed_at as number | null) ?? null,
        consumedByUid: (row.consumed_by_uid as string | null) ?? null
      };
    });
  }

  /** Atomic one-way open → consumed. A second call conflicts and never reports success. */
  consumeBootstrap(accountUid: string): SecurityResult<BootstrapState> {
    return this.write((db) => {
      const changed = db
        .prepare("UPDATE bootstrap_state SET state = 'consumed', consumed_at = ?, consumed_by_uid = ? WHERE id = 1 AND state = 'open'")
        .run(this.now(), accountUid).changes;
      if (changed !== 1) abort("SECURITY_CONFLICT", "bootstrap_consumed", "bootstrap already consumed");
      const row = db.prepare("SELECT * FROM bootstrap_state WHERE id = 1").get() as Row;
      return {
        state: row.state as BootstrapState["state"],
        consumedAt: row.consumed_at as number,
        consumedByUid: row.consumed_by_uid as string
      };
    });
  }

  // ---- rate buckets -------------------------------------------------------

  /** Count one attempt. Expired buckets are pruned; new keys beyond `maxBuckets` fail closed. */
  hitRateBucket(input: {
    key: string;
    limit: number;
    windowMs: number;
    maxBuckets?: number;
  }): SecurityResult<RateBucketDecision> {
    return this.write((db) => {
      const now = this.now();
      db.prepare("DELETE FROM auth_rate_buckets WHERE expires_at <= ?").run(now);
      const row = db.prepare("SELECT * FROM auth_rate_buckets WHERE bucket_key = ?").get(input.key) as Row | undefined;
      if (!row) {
        const maxBuckets = input.maxBuckets ?? 10_000;
        const total = (db.prepare("SELECT COUNT(*) AS n FROM auth_rate_buckets").get() as Row).n as number;
        if (total >= maxBuckets) {
          throw new Abort(unavailable("capacity", "rate bucket capacity reached"));
        }
        db.prepare("INSERT INTO auth_rate_buckets (bucket_key, window_start, count, expires_at) VALUES (?, ?, 1, ?)").run(
          input.key,
          now,
          now + input.windowMs
        );
        return { allowed: 1 <= input.limit, count: 1, retryAfterSeconds: 0 };
      }
      const count = (row.count as number) + 1;
      db.prepare("UPDATE auth_rate_buckets SET count = ? WHERE bucket_key = ?").run(count, input.key);
      const allowed = count <= input.limit;
      const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil(((row.expires_at as number) - now) / 1000));
      return { allowed, count, retryAfterSeconds };
    });
  }

  clearRateBucket(key: string): SecurityResult<void> {
    return this.write((db) => {
      db.prepare("DELETE FROM auth_rate_buckets WHERE bucket_key = ?").run(key);
    });
  }

  // ---- role tombstones ----------------------------------------------------

  tombstoneRoleId(roleId: string, reason?: string): SecurityResult<void> {
    return this.write((db) => {
      db.prepare("INSERT OR IGNORE INTO role_id_tombstones (role_id, tombstoned_at, reason) VALUES (?, ?, ?)").run(
        roleId,
        this.now(),
        reason ?? null
      );
    });
  }

  isRoleIdTombstoned(roleId: string): SecurityResult<boolean> {
    return this.read(
      (db) => db.prepare("SELECT 1 FROM role_id_tombstones WHERE role_id = ?").get(roleId) !== undefined
    );
  }

  // ---- security events (append-only) -------------------------------------

  appendEvent(input: SecurityEventInput): SecurityResult<SecurityEvent> {
    return this.write((db) => this.insertEvent(db, input));
  }

  /**
   * Group commit: all events land in one write transaction (one fsync), all or
   * nothing. Callers that need per-event outcomes fall back to `appendEvent`.
   */
  appendEventsBatch(inputs: readonly SecurityEventInput[]): SecurityResult<SecurityEvent[]> {
    return this.write((db) => inputs.map((input) => this.insertEvent(db, input)));
  }

  private insertEventStmt: Database.Statement | null = null;

  private insertEvent(db: Database.Database, input: SecurityEventInput): SecurityEvent {
    const stmt =
      this.insertEventStmt ??
      (this.insertEventStmt = db.prepare(
        `INSERT INTO security_events
           (event_id, operation_id, phase, actor, actor_type, network_info, session_fingerprint, trace_id,
            policy_version, context_version, object_hash, verdict, result_summary, audit_event_kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ));
    const event: Omit<SecurityEvent, "seq"> = {
      eventId: input.eventId,
      operationId: input.operationId,
      phase: input.phase,
      actor: input.actor,
      actorType: input.actorType,
      networkInfo: input.networkInfo ?? "",
      sessionFingerprint: input.sessionFingerprint ?? "",
      traceId: input.traceId ?? "",
      policyVersion: input.policyVersion ?? "",
      contextVersion: input.contextVersion ?? "",
      objectHash: input.objectHash ?? "",
      verdict: input.verdict ?? "",
      resultSummary: input.resultSummary ?? "",
      auditEventKind: input.auditEventKind ?? null,
      createdAt: this.now()
    };
    try {
      const info = stmt.run(
        event.eventId,
        event.operationId,
        event.phase,
        event.actor,
        event.actorType,
        event.networkInfo,
        event.sessionFingerprint,
        event.traceId,
        event.policyVersion,
        event.contextVersion,
        event.objectHash,
        event.verdict,
        event.resultSummary,
        event.auditEventKind,
        event.createdAt
      );
      return { seq: Number(info.lastInsertRowid), ...event };
    } catch (error) {
      if (String((error as { code?: unknown }).code).startsWith("SQLITE_CONSTRAINT")) {
        abort("SECURITY_CONFLICT", "duplicate_event", "event id already recorded");
      }
      throw error;
    }
  }

  listEventsAfter(seq: number, limit = 500): SecurityResult<SecurityEvent[]> {
    return this.read((db) =>
      (db.prepare("SELECT * FROM security_events WHERE seq > ? ORDER BY seq ASC LIMIT ?").all(seq, limit) as Row[]).map(
        eventFromRow
      )
    );
  }

  listEventsByOperation(operationId: string): SecurityResult<SecurityEvent[]> {
    return this.read((db) =>
      (db.prepare("SELECT * FROM security_events WHERE operation_id = ? ORDER BY seq ASC").all(operationId) as Row[]).map(
        eventFromRow
      )
    );
  }

  /**
   * Events of `startPhase` whose operation has no event in `terminalPhases`.
   * Used at boot to find operations a previous process never closed.
   */
  listUnterminatedOperations(
    startPhase: SecurityEvent["phase"],
    terminalPhases: readonly SecurityEvent["phase"][],
    limit = 1000
  ): SecurityResult<SecurityEvent[]> {
    const marks = terminalPhases.map(() => "?").join(", ");
    return this.read((db) =>
      (
        db
          .prepare(
            `SELECT a.* FROM security_events a
              WHERE a.phase = ?
                AND NOT EXISTS (
                  SELECT 1 FROM security_events b
                   WHERE b.operation_id = a.operation_id AND b.phase IN (${marks})
                )
              ORDER BY a.seq ASC LIMIT ?`
          )
          .all(startPhase, ...terminalPhases, limit) as Row[]
      ).map(eventFromRow)
    );
  }

  maxEventSeq(): SecurityResult<number> {
    return this.read((db) => ((db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM security_events").get() as Row).m as number));
  }

  // ---- projection cursors -------------------------------------------------

  getProjectionCursor(projector: string): SecurityResult<number> {
    return this.read((db) => {
      const row = db.prepare("SELECT last_seq FROM projection_cursors WHERE projector = ?").get(projector) as
        | Row
        | undefined;
      return (row?.last_seq as number | undefined) ?? 0;
    });
  }

  /** Cursor only moves forward and never beyond the latest durable event. */
  advanceProjectionCursor(projector: string, seq: number): SecurityResult<number> {
    return this.write((db) => {
      const max = (db.prepare("SELECT COALESCE(MAX(seq), 0) AS m FROM security_events").get() as Row).m as number;
      if (seq > max) abort("SECURITY_CONFLICT", "cursor_beyond_events", "cursor cannot pass the latest security event");
      const row = db.prepare("SELECT last_seq FROM projection_cursors WHERE projector = ?").get(projector) as
        | Row
        | undefined;
      const current = (row?.last_seq as number | undefined) ?? 0;
      if (seq <= current) return current;
      db.prepare(
        `INSERT INTO projection_cursors (projector, last_seq, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(projector) DO UPDATE SET last_seq = excluded.last_seq, updated_at = excluded.updated_at`
      ).run(projector, seq, this.now());
      return seq;
    });
  }

  // ---- pending operations (prepare → commit | abort) ---------------------

  /** Records intent durably before any config/file side effect. A pending operation is never a success. */
  prepareOperation(input: PrepareOperationInput): SecurityResult<PendingOperation> {
    return this.write((db) => {
      const exists = db.prepare("SELECT 1 FROM pending_operations WHERE operation_id = ?").get(input.operationId);
      if (exists) abort("SECURITY_CONFLICT", "operation_exists", "operation id already prepared");
      db.prepare(
        `INSERT INTO pending_operations
           (operation_id, kind, direction, state, object_hash, summary, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`
      ).run(input.operationId, input.kind, input.direction, input.objectHash ?? null, input.summary ?? null, this.now());
      this.insertEvent(db, {
        eventId: `${input.operationId}:prepare`,
        operationId: input.operationId,
        phase: "prepare",
        actor: input.actor,
        actorType: input.actorType,
        traceId: input.traceId,
        objectHash: input.objectHash,
        verdict: input.direction,
        resultSummary: input.kind
      });
      return operationFromRow(
        db.prepare("SELECT * FROM pending_operations WHERE operation_id = ?").get(input.operationId) as Row
      );
    });
  }

  commitOperation(operationId: string, actor = "system", actorType = "system"): SecurityResult<PendingOperation> {
    return this.transitionOperation(operationId, "committed", "commit", actor, actorType);
  }

  abortOperation(
    operationId: string,
    reason: string,
    actor = "system",
    actorType = "system"
  ): SecurityResult<PendingOperation> {
    return this.transitionOperation(operationId, "aborted", "abort", actor, actorType, reason);
  }

  /** Used by recovery when the effect cannot be proven safe; stays non-success until an operator decides. */
  markOperationNeedsReview(operationId: string, reason: string): SecurityResult<PendingOperation> {
    return this.transitionOperation(operationId, "needs_review", "recovery", "system", "system", reason);
  }

  private transitionOperation(
    operationId: string,
    next: OperationState,
    phase: "commit" | "abort" | "recovery",
    actor: string,
    actorType: string,
    summary = ""
  ): SecurityResult<PendingOperation> {
    return this.write((db) => {
      const row = db.prepare("SELECT * FROM pending_operations WHERE operation_id = ?").get(operationId) as
        | Row
        | undefined;
      if (!row) abort("SECURITY_NOT_FOUND", "operation_not_found", "operation not found");
      const current = row.state as OperationState;
      if (!OPERATION_TRANSITIONS[current].includes(next)) {
        abort("SECURITY_CONFLICT", "invalid_transition", `operation ${current} cannot become ${next}`);
      }
      db.prepare("UPDATE pending_operations SET state = ?, resolved_at = ? WHERE operation_id = ?").run(
        next,
        next === "needs_review" ? null : this.now(),
        operationId
      );
      this.insertEvent(db, {
        eventId: `${operationId}:${phase}:${next}`,
        operationId,
        phase,
        actor,
        actorType,
        objectHash: (row.object_hash as string | null) ?? undefined,
        verdict: next,
        resultSummary: summary
      });
      return operationFromRow(db.prepare("SELECT * FROM pending_operations WHERE operation_id = ?").get(operationId) as Row);
    });
  }

  getOperation(operationId: string): SecurityResult<PendingOperation | null> {
    return this.read((db) => {
      const row = db.prepare("SELECT * FROM pending_operations WHERE operation_id = ?").get(operationId) as
        | Row
        | undefined;
      return row ? operationFromRow(row) : null;
    });
  }

  listOperations(state: OperationState): SecurityResult<PendingOperation[]> {
    return this.read((db) =>
      (db.prepare("SELECT * FROM pending_operations WHERE state = ? ORDER BY created_at ASC, operation_id ASC").all(state) as Row[]).map(
        operationFromRow
      )
    );
  }
}
