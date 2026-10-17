import type { FastifyRequest } from "fastify";
import type { ConfigAuditActorType } from "../admin/audit.js";
import type { WebuiAdminRole } from "../auth/admins-store.js";
import { hashSessionJti } from "./store.js";

/**
 * Trusted request actor (Spec §5.2, T08-1).
 *
 * The actor is derived only from the verified request context that the auth hook
 * attached (`request.lucyAdmin`) and from the socket peer. It never reads
 * `body.actor`, User-Agent, device name or forwarded headers, so a client cannot
 * choose who an audit row is attributed to.
 *
 * Three kinds exist, and nothing else may be recorded as an admin:
 * - an authenticated admin (required mode),
 * - the explicit deployment-local `local-admin` (open / development mode only),
 * - the `system` actor for work that has no request (background tasks, tools).
 * A request that is neither authenticated nor in open mode has no actor: callers get
 * `ActorUnresolvedError` instead of a silent `local-admin`.
 */

export const OPEN_MODE_ACTOR_ID = "local-admin";
export const SYSTEM_ACTOR_ID = "system";

export type TrustedActor = Readonly<{
  actorId: string;
  actorType: ConfigAuditActorType;
  accountUid: string | null;
  role: WebuiAdminRole | null;
  authMode: "open" | "required" | "bootstrap" | "system";
  /** Truncated hash of the session id; never the cookie or the raw session id. */
  sessionId: string | null;
  requestId: string | null;
  /** Socket peer only. Forwarded headers are display evidence and are not read here. */
  actorIp: string | null;
}>;

export class ActorUnresolvedError extends Error {
  readonly code = "ACTOR_UNRESOLVED";
  readonly statusCode = 401;
  constructor() {
    super("无法确认当前请求的管理员身份，请重新登录");
    this.name = "ActorUnresolvedError";
  }
}

export function systemActor(label: string = SYSTEM_ACTOR_ID): TrustedActor {
  return {
    actorId: label,
    actorType: "system",
    accountUid: null,
    role: null,
    authMode: "system",
    sessionId: null,
    requestId: null,
    actorIp: null
  };
}

function socketPeer(request: FastifyRequest): string | null {
  return request.socket?.remoteAddress ?? null;
}

export function trustedActorFromRequest(request: FastifyRequest): TrustedActor {
  const ctx = request.lucyAdmin;
  const requestId = request.id ? String(request.id) : null;
  const actorIp = socketPeer(request);

  if (ctx?.admin) {
    return {
      actorId: ctx.admin.id,
      actorType: "ui_admin",
      accountUid: ctx.admin.account_uid ?? null,
      role: ctx.admin.role,
      authMode: ctx.authMode === "bootstrap" ? "bootstrap" : "required",
      sessionId: ctx.session ? hashSessionJti(ctx.session.jti).slice(0, 16) : null,
      requestId,
      actorIp
    };
  }
  if (ctx?.authMode === "open") {
    return {
      actorId: OPEN_MODE_ACTOR_ID,
      actorType: "ui_admin",
      accountUid: null,
      role: "owner",
      authMode: "open",
      sessionId: null,
      requestId,
      actorIp
    };
  }
  throw new ActorUnresolvedError();
}

/** The audit-row fields every config write takes from an actor. */
export function auditActorFields(actor: TrustedActor | undefined): {
  actor: string;
  actorType: ConfigAuditActorType;
  actorIp?: string;
  requestId?: string;
  sessionId?: string | null;
} {
  const resolved = actor ?? systemActor();
  return {
    actor: resolved.actorId,
    actorType: resolved.actorType,
    ...(resolved.actorIp ? { actorIp: resolved.actorIp } : {}),
    ...(resolved.requestId ? { requestId: resolved.requestId } : {}),
    sessionId: resolved.sessionId
  };
}
