import { createHash } from "node:crypto";
import { recordLedgerAppend } from "../proxy/audit-write-health.js";
import { getSecurityStore } from "./instance.js";
import type { SecurityStore } from "./store.js";
import type { SecurityEvent, SecurityEventInput, SecurityResult } from "./types.js";

/**
 * T07 / Spec §5.1 — durable response-release ledger.
 *
 * One MCP operation writes, in order, to `security_events` (security.sqlite,
 * WAL + synchronous=FULL):
 *   request_admitted → response_prepared → response_delivered | response_failed
 * `response_prepared` means "recorded and cleared to send"; it never claims the
 * client received anything. A process that dies in between leaves an operation
 * without a terminal event, which `recoverInterruptedOperations` closes as
 * `interrupted` at the next boot — it never invents `response_delivered`.
 *
 * Event payloads carry only method / tool name / status / size / digest. No
 * arguments, filter values, credentials or response content.
 */

export const RESPONSE_TERMINAL_PHASES = ["response_delivered", "response_failed", "interrupted"] as const;

export type ReleaseOperationContext = {
  operationId: string;
  actor: string;
  actorType: string;
  /** Socket peer only; forwarded headers never reach the ledger. */
  networkInfo?: string;
  sessionFingerprint?: string;
  policyVersion?: string;
  contextVersion?: string;
  traceId?: string;
  /** JSON-RPC method, or the HTTP verb for non-RPC requests. */
  method: string;
  tool?: string;
};

export type PreparedResponseSummary = {
  status: number;
  bytes: number;
  sha256: string;
};

export type LedgerStoreProvider = () => Promise<SecurityResult<SecurityStore>>;

export function digestBody(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function describe(ctx: ReleaseOperationContext): Record<string, unknown> {
  return { method: ctx.method, ...(ctx.tool ? { tool: ctx.tool } : {}) };
}

type Pending = {
  input: SecurityEventInput;
  resolve: (result: SecurityResult<SecurityEvent>) => void;
};

export class ReleaseLedger {
  private queue: Pending[] = [];
  private flushScheduled = false;
  private cachedStore: SecurityStore | null = null;

  constructor(private readonly getStore: LedgerStoreProvider = getSecurityStore) {}

  /**
   * Group commit (Spec §5.1 optimization, durability unchanged): appends issued
   * in the same event-loop turn share one transaction and one fsync. Each caller
   * is resolved only after its event is committed.
   */
  private append(
    ctx: ReleaseOperationContext,
    phase: SecurityEvent["phase"],
    verdict: string,
    summary: Record<string, unknown>
  ): Promise<SecurityResult<SecurityEvent>> {
    const input: SecurityEventInput = {
      eventId: `${ctx.operationId}:${phase}`,
      operationId: ctx.operationId,
      phase,
      actor: ctx.actor,
      actorType: ctx.actorType,
      networkInfo: ctx.networkInfo,
      sessionFingerprint: ctx.sessionFingerprint,
      traceId: ctx.traceId,
      policyVersion: ctx.policyVersion,
      contextVersion: ctx.contextVersion,
      verdict,
      resultSummary: JSON.stringify(summary)
    };
    return new Promise((resolve) => {
      this.queue.push({ input, resolve });
      if (this.flushScheduled) return;
      this.flushScheduled = true;
      setImmediate(() => void this.flush());
    });
  }

  private async resolveStore(): Promise<SecurityResult<SecurityStore>> {
    if (this.cachedStore) return { ok: true, value: this.cachedStore };
    const store = await this.getStore();
    if (store.ok) this.cachedStore = store.value;
    return store;
  }

  private async flush(): Promise<void> {
    const batch = this.queue.splice(0);
    this.flushScheduled = false;
    if (batch.length === 0) return;
    const store = await this.resolveStore();
    if (!store.ok) {
      recordLedgerAppend(false);
      for (const item of batch) item.resolve(store);
      return;
    }
    let committed = store.value.appendEventsBatch(batch.map((item) => item.input));
    if (!committed.ok && committed.code === "SECURITY_STORE_UNAVAILABLE" && committed.reason === "closed") {
      // The shared handle was closed (restart / reopen): drop the cache and retry once on a fresh one.
      this.cachedStore = null;
      const fresh = await this.resolveStore();
      if (fresh.ok) committed = fresh.value.appendEventsBatch(batch.map((item) => item.input));
    }
    if (committed.ok) {
      recordLedgerAppend(true);
      batch.forEach((item, index) => item.resolve({ ok: true, value: committed.value[index]! }));
      return;
    }
    // One bad event must not fail its neighbours: settle each on its own.
    const single = this.cachedStore ?? store.value;
    for (const item of batch) {
      const result = single.appendEvent(item.input);
      recordLedgerAppend(result.ok);
      item.resolve(result);
    }
  }

  /** Must succeed before any upstream work starts. */
  admit(ctx: ReleaseOperationContext): Promise<SecurityResult<SecurityEvent>> {
    return this.append(ctx, "request_admitted", "admitted", describe(ctx));
  }

  /** Must succeed before the first byte of content is sent. */
  prepare(ctx: ReleaseOperationContext, response: PreparedResponseSummary): Promise<SecurityResult<SecurityEvent>> {
    return this.append(ctx, "response_prepared", response.status >= 400 ? "error" : "ok", {
      ...describe(ctx),
      status: response.status,
      bytes: response.bytes,
      sha256: response.sha256
    });
  }

  delivered(ctx: ReleaseOperationContext): Promise<SecurityResult<SecurityEvent>> {
    return this.append(ctx, "response_delivered", "delivered", describe(ctx));
  }

  /** `reason` is a fixed token (e.g. `response_too_large`), never free text from a payload. */
  failed(ctx: ReleaseOperationContext, reason: string): Promise<SecurityResult<SecurityEvent>> {
    return this.append(ctx, "response_failed", reason, { ...describe(ctx), reason });
  }
}

export type InterruptedRecoveryReport = {
  /** Operations closed as `interrupted` by this run. */
  interrupted: string[];
  /** Subset whose `response_prepared` was durable: content may or may not have reached the client. */
  preparedUnconfirmed: string[];
};

const RECOVERY_ACTOR = { actor: "recovery", actorType: "system" } as const;

/**
 * Close operations a previous process left open. Call once at boot, before the
 * proxy listens — a live in-flight operation would otherwise be misclassified.
 * Idempotent: an already-closed operation is skipped.
 */
export async function recoverInterruptedOperations(
  store: SecurityStore
): Promise<SecurityResult<InterruptedRecoveryReport>> {
  const report: InterruptedRecoveryReport = { interrupted: [], preparedUnconfirmed: [] };
  for (;;) {
    const open = store.listUnterminatedOperations("request_admitted", RESPONSE_TERMINAL_PHASES, 500);
    if (!open.ok) return open;
    if (open.value.length === 0) return { ok: true, value: report };
    for (const admitted of open.value) {
      const trail = store.listEventsByOperation(admitted.operationId);
      if (!trail.ok) return trail;
      const prepared = trail.value.some((event) => event.phase === "response_prepared");
      const appended = store.appendEvent({
        eventId: `${admitted.operationId}:interrupted`,
        operationId: admitted.operationId,
        phase: "interrupted",
        actor: RECOVERY_ACTOR.actor,
        actorType: RECOVERY_ACTOR.actorType,
        verdict: prepared ? "prepared_unconfirmed" : "before_prepare",
        resultSummary: JSON.stringify({ reason: "process_restart", prepared })
      });
      // A duplicate event id means a concurrent recovery already closed it; any other failure aborts.
      if (!appended.ok && appended.reason !== "duplicate_event") return appended;
      report.interrupted.push(admitted.operationId);
      if (prepared) report.preparedUnconfirmed.push(admitted.operationId);
    }
  }
}
