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
 */

export type AuthEventKind =
  | "bootstrap_success"
  | "login_success"
  | "login_failure"
  | "logout"
  | "admin_created"
  | "admin_role_changed"
  | "password_rotated"
  | "admin_disabled"
  | "admin_enabled"
  | "admin_deleted";

export type AuthEventSummary = {
  targetId?: string;
  role?: string;
  reason?: string;
  attemptedIdDigest?: string;
};

const SUMMARY_KEYS = ["targetId", "role", "reason", "attemptedIdDigest"] as const;

export function attemptedIdDigest(adminId: string): string {
  return createHash("sha256").update(adminId.trim().toLowerCase().slice(0, 128)).digest("hex").slice(0, 16);
}

function allowlisted(summary: AuthEventSummary | undefined): string {
  const picked: Record<string, string> = {};
  for (const key of SUMMARY_KEYS) {
    const value = summary?.[key];
    if (typeof value === "string" && value) picked[key] = value.slice(0, 128);
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
