import { createHash, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getSecurityStore } from "./instance.js";

/**
 * Authentication and account-lifecycle events (Spec §5.2, T08-2).
 *
 * Appended to the durable security ledger (`security_events`). An event carries the
 * attributed actor, the socket peer and a small allowlisted summary — never a password,
 * a hash, a cookie, or the id that was typed into a failed login (only a digest of it).
 * Rate-limited attempts are already recorded by the rate limiter as `rate_limited`.
 *
 * L25-06 extends the summary with the OIDC keys. The key list is CLOSED: an unknown
 * key throws instead of being dropped, because a silently discarded field is a field
 * the audit trail claims to hold but does not.
 */

export type AuthEventKind =
  | "bootstrap_success"
  | "login_success"
  | "login_failure"
  | "logout"
  | "admin_created"
  | "admin_role_changed"
  | "password_rotated"
  | "password_removed"
  | "oidc_binding_added"
  | "oidc_binding_replaced"
  | "oidc_binding_removed"
  | "admin_disabled"
  | "admin_enabled"
  | "admin_deleted";

export type AuthEventSummary = {
  targetId?: string;
  role?: string;
  reason?: string;
  attemptedIdDigest?: string;
  /** Which authentication path produced the event: `local` or `oidc`. */
  method?: "local" | "oidc";
  /** Digest of an OIDC binding; the raw issuer/sub are never stored. */
  bindingDigest?: string;
  /** Whether the account still holds a local password after the change. */
  hasLocalPassword?: string;
  /** Digest of the provider issuer; used to correlate failed logins. */
  issuerDigest?: string;
  /** Digest of the provider subject; only recorded after the token was fully verified. */
  subjectDigest?: string;
};

const SUMMARY_KEYS = [
  "targetId",
  "role",
  "reason",
  "attemptedIdDigest",
  "method",
  "bindingDigest",
  "hasLocalPassword",
  "issuerDigest",
  "subjectDigest"
] as const;

type SummaryKey = (typeof SUMMARY_KEYS)[number];

export function attemptedIdDigest(adminId: string): string {
  return createHash("sha256").update(adminId.trim().toLowerCase().slice(0, 128)).digest("hex").slice(0, 16);
}

/** 32 lowercase hex characters of sha256, as the OIDC summary digests are specified. */
function digest32(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export function issuerDigest(issuer: string): string {
  return digest32(issuer);
}

export function subjectDigest(sub: string): string {
  return digest32(sub);
}

export function bindingDigest(issuer: string, sub: string): string {
  return digest32(`${issuer}\n${sub}`);
}

/**
 * Picks the allowlisted keys and rejects everything else.
 *
 * Throwing on an unknown key is deliberate: the previous behaviour dropped such a
 * key without a trace, which made a missing audit field indistinguishable from an
 * absent one.
 */
function allowlisted(summary: AuthEventSummary | undefined): string {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(summary ?? {})) {
    if (value === undefined) continue;
    if (!(SUMMARY_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unknown auth event summary key: ${key}`);
    }
    if (typeof value !== "string" || !value) continue;
    picked[key as SummaryKey] = value.slice(0, 128);
  }
  return JSON.stringify(picked);
}

/** Returns false when the ledger could not durably record the event. */
export async function recordAuthEvent(input: {
  kind: AuthEventKind;
  request: FastifyRequest;
  actor: string;
  actorType?: "ui_admin" | "anonymous";
  summary?: AuthEventSummary;
}): Promise<boolean> {
  const store = await getSecurityStore();
  if (!store.ok) return false;
  const operationId = `auth-${randomUUID()}`;
  const appended = store.value.appendEvent({
    eventId: `${operationId}:result`,
    operationId,
    phase: "result",
    actor: input.actor,
    actorType: input.actorType ?? "ui_admin",
    networkInfo: input.request.socket?.remoteAddress ?? "",
    verdict: input.kind,
    resultSummary: allowlisted(input.summary)
  });
  return appended.ok;
}
