/**
 * P1-75 §2.5.1 (X3/X4) — HTTP carrier of the degraded read.
 *
 * Frozen contract (OQ-3, X3): the semantic fields are state (`grace|stale|pending`), data age in
 * milliseconds (`pending` has none), and the view generation. They travel as response headers
 * `X-Lucy-Display-State`, `X-Lucy-Display-Age-Ms`, `X-Lucy-Display-Generation`,
 * `X-Lucy-Display-Pending-Ms` (pending only), `X-Lucy-Display-Prolonged: 1` (non-error degradation
 * past D_max), plus Server-Timing `degraded;desc=<state>` (see entry-performance-timing.ts).
 * `grace`/`stale` keep the normal body. `pending` answers 200 with NO business data:
 * `{ ok: true, data: null, display: { state: "pending", generation, pendingMs, prolonged? } }`.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { authenticateSession } from "./auth/account-state";
import { DISPLAY_SCOPES, displayGenerations } from "./display-generation";
import {
  createDisplayPending,
  createDisplayRequestBudget,
  DisplaySnapshotBusyError,
  DisplaySnapshotPendingError,
  isDisplayClassAReason,
  type DisplayAuthorize,
  type DisplayPrincipal,
  type DisplayRequestBudget
} from "./display-snapshot";
import { markRequestDegraded, type DisplayDegradeMark } from "./entry-performance-timing";
import { PROBE_QUEUE_FULL, type ProbePurpose } from "./background-probes";

/** Identity and write-out authorization re-check for degraded views (§2.5.1 conditions 2 and 4). */
export function displayReadContext(request: FastifyRequest): { principal: DisplayPrincipal; authorize: DisplayAuthorize } {
  const ctx = request.lucyAdmin;
  const admin = ctx?.admin ?? null;
  const open = ctx?.authMode === "open";
  const principal: DisplayPrincipal = admin
    ? { scope: `admin:${admin.account_uid ?? admin.id}`, permissionVersion: `${admin.role}:${admin.enabled ? 1 : 0}:${ctx?.session?.ep ?? 0}` }
    : { scope: open ? "open:local-admin" : "anonymous", permissionVersion: open ? "open" : "none" };
  const authorize: DisplayAuthorize = async () => {
    if (open) return true;
    if (!admin) return false;
    const state = await authenticateSession(request);
    return state.kind === "ok" && state.admin.id === admin.id && state.admin.role === admin.role && state.admin.enabled;
  };
  return { principal, authorize };
}

/** One request budget carrying the requester identity, so every snapshot read in the request shares it. */
export function displayBudgetFor(request: FastifyRequest): DisplayRequestBudget {
  return Object.assign(createDisplayRequestBudget(), displayReadContext(request));
}

export function displayEnvelope(mark: DisplayDegradeMark): Record<string, unknown> {
  return {
    state: mark.state,
    generation: mark.generation,
    ...(mark.ageMs !== undefined && mark.state !== "pending" ? { ageMs: Math.round(mark.ageMs) } : {}),
    ...(mark.state === "pending" && mark.pendingMs !== undefined ? { pendingMs: Math.round(mark.pendingMs) } : {}),
    ...(mark.prolonged ? { prolonged: true } : {})
  };
}

function sendPending(request: FastifyRequest, reply: FastifyReply, display: DisplayDegradeMark, reason?: string): void {
  markRequestDegraded(request, display);
  if (reason) reply.header("X-Lucy-Busy-Reason", reason);
  reply.status(200).send({ ok: true, data: null, display: displayEnvelope(display) });
}

/**
 * Error-handler hook: A-class display refusals become 200 `pending`. Returns true when it replied.
 * `DISPLAY_RECONCILIATION_FAILED` (C) and `write_pending` (B) keep their 503 path.
 */
export function replyIfDegradedRead(error: unknown, request: FastifyRequest, reply: FastifyReply): boolean {
  if (error instanceof DisplaySnapshotPendingError) {
    sendPending(request, reply, error.display, error.reason);
    return true;
  }
  if (error instanceof DisplaySnapshotBusyError && isDisplayClassAReason(error.reason)) {
    const route = request.routeOptions?.url ?? request.url.split("?")[0] ?? "route";
    sendPending(request, reply, createDisplayPending(route, DISPLAY_SCOPES, error.reason).display, error.reason);
    return true;
  }
  return false;
}

// ─── X4: automatic probes never answer 503 ──────────────────────────────────

type ProbeKindName = "test" | "live-schemas";
const lastProbeResults = new Map<string, { data: unknown; at: number; generation: number }>();
const MAX_REMEMBERED_PROBES = 256;

function probeKey(kind: ProbeKindName, projectRoot: string, connId: string): string {
  return [kind, projectRoot, connId].join("\u0000");
}

/** Remember the latest completed probe result so a refused automatic probe can show it with its age. */
export function rememberProbeResult(kind: ProbeKindName, projectRoot: string, connId: string, data: unknown): void {
  const key = probeKey(kind, projectRoot, connId);
  lastProbeResults.delete(key);
  lastProbeResults.set(key, { data, at: Date.now(), generation: displayGenerations().L });
  if (lastProbeResults.size > MAX_REMEMBERED_PROBES) lastProbeResults.delete(lastProbeResults.keys().next().value as string);
}

export function resetProbeFallbackForTests(): void {
  lastProbeResults.clear();
}

function isProbeQueueRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === PROBE_QUEUE_FULL || code === "PROBE_QUEUE_TIMEOUT";
}

/**
 * `purpose=automatic` and the probe queue refused (full / wait timeout): answer 200 with the latest
 * result of the same configuration generation and its age, or `pending` without data. Returns null
 * for every other failure and for `purpose=manual` (D class keeps its 503 + Retry-After).
 */
export function automaticProbeFallback(
  error: unknown,
  purpose: ProbePurpose,
  kind: ProbeKindName,
  projectRoot: string,
  connId: string,
  request: FastifyRequest
): { ok: true; data: unknown; display: Record<string, unknown> } | null {
  if (purpose !== "automatic" || !isProbeQueueRefusal(error)) return null;
  const generation = displayGenerations().L;
  const last = lastProbeResults.get(probeKey(kind, projectRoot, connId));
  const generationKey = `L${generation}`;
  if (last && last.generation === generation) {
    const mark: DisplayDegradeMark = { state: "stale", ageMs: Math.max(0, Date.now() - last.at), generation: generationKey };
    markRequestDegraded(request, mark);
    return { ok: true, data: last.data, display: displayEnvelope(mark) };
  }
  const mark: DisplayDegradeMark = { state: "pending", generation: generationKey, pendingMs: 0 };
  markRequestDegraded(request, mark);
  return { ok: true, data: null, display: displayEnvelope(mark) };
}
