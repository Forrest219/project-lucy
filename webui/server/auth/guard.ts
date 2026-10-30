import type { FastifyReply, FastifyRequest } from "fastify";
import {
  enabledAdmins,
  loadAdminsConfig,
  resolveAuthMode,
  type AuthMode,
  type WebuiAdminRecord
} from "./admins-store.js";
import { authenticateSession } from "./account-state.js";
import type { SessionClaims } from "./session.js";
import { trustedActorFromRequest } from "../security/request-actor.js";

export type RequestAdminContext = {
  session: SessionClaims | null;
  admin: WebuiAdminRecord | null;
  /** True when a session cookie was presented but the durable session state could not be consulted. */
  stateUnavailable: boolean;
  /** Set by `requireWebuiAuthHook`; lets the trusted actor tell open mode from an unauthenticated request. */
  authMode?: AuthMode;
};

export const AUTH_STATE_UNAVAILABLE = {
  ok: false,
  error: { code: "AUTH_STATE_UNAVAILABLE", message: "认证状态暂不可用，请稍后重试或联系部署人员" }
} as const;

declare module "fastify" {
  interface FastifyRequest {
    lucyAdmin?: RequestAdminContext;
  }
}

/**
 * API paths that stay reachable without a WebUI admin session.
 * Help handbook/search must stay public so login failures can still open
 * recovery docs (pair with `isPublicUiPath` → `/help` on the SPA).
 */
export function isPublicApi(method: string, url: string): boolean {
  const pathOnly = url.split("?")[0] ?? url;
  if (!pathOnly.startsWith("/api/")) return true;
  const m = method.toUpperCase();
  if (m === "GET" && pathOnly === "/api/health") return true;
  if (m === "GET" && pathOnly === "/api/auth/status") return true;
  if (m === "POST" && pathOnly === "/api/auth/login") return true;
  if (m === "POST" && pathOnly === "/api/auth/bootstrap") return true;
  if (m === "POST" && pathOnly === "/api/auth/logout") return true;
  // L25-06 OIDC: the provider redirects the browser here, so both entries stay public.
  if (m === "POST" && pathOnly === "/api/auth/oidc/start") return true;
  if (m === "GET" && pathOnly === "/api/auth/oidc/callback") return true;
  if (m === "GET" && pathOnly.startsWith("/api/help")) return true;
  // Spec 126: login + shell brand mark need branding before auth.
  if (m === "GET" && pathOnly === "/api/branding") return true;
  if (m === "GET" && pathOnly === "/api/branding/logo") return true;
  return false;
}

export async function attachAdminContext(request: FastifyRequest): Promise<RequestAdminContext> {
  const state = await authenticateSession(request);
  const ctx: RequestAdminContext =
    state.kind === "ok"
      ? { session: state.claims, admin: state.admin, stateUnavailable: false }
      : { session: null, admin: null, stateUnavailable: state.kind === "unavailable" };
  request.lucyAdmin = ctx;
  return ctx;
}

/** Spec §3.2: authentication and admin responses must never be stored by browsers or intermediaries. */
function isSensitiveApi(method: string, url: string): boolean {
  const pathOnly = url.split("?")[0] ?? url;
  return pathOnly.startsWith("/api/auth/") || (pathOnly.startsWith("/api/") && !isPublicApi(method, url));
}

export async function requireWebuiAuthHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (isSensitiveApi(request.method, request.url)) reply.header("Cache-Control", "no-store");
  const ctx = await attachAdminContext(request);
  const mode = await resolveAuthMode();
  ctx.authMode = mode;
  if (mode === "open") return;
  if (isPublicApi(request.method, request.url)) return;

  if (mode === "unavailable") {
    return reply.status(503).send({
      ok: false,
      error: {
        code: "AUTH_CONFIG_UNAVAILABLE",
        message: "管理员配置不可用，请联系部署人员修复后重试"
      }
    });
  }

  if (ctx.stateUnavailable) return reply.status(503).send(AUTH_STATE_UNAVAILABLE);

  if (mode === "bootstrap") {
    if (!ctx.admin) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "AUTH_BOOTSTRAP_REQUIRED",
          message: "需要先创建首个所有者管理员"
        }
      });
    }
    return;
  }

  if (!ctx.admin) {
    return reply.status(401).send({
      ok: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "需要登录"
      }
    });
  }
}

/** Authenticated admin id, or the explicit open-mode `local-admin`; throws instead of guessing (T08-1). */
export function actorIdFromRequest(request: FastifyRequest): string {
  return trustedActorFromRequest(request).actorId;
}

/**
 * Owner-only gate.
 *
 * The denial is AWAITED, not fired and forgotten. A `void reply.send(...)` plus a
 * handler that returns `undefined` makes Fastify send a SECOND response after the
 * first one: `reply.sent` is only true once the response has ENDED, so the
 * framework's own send races the first one and `writeHead` throws
 * `ERR_HTTP_HEADERS_SENT` from the onSend hook chain — an uncaught exception that
 * kills the whole server process. A non-owner calling `POST /api/admin/admins`
 * could therefore take the instance down with one request.
 *
 * `await reply.send(...)` waits for the response to end (Fastify's reply is
 * thenable), so the handler returns only after the denial is on the wire and the
 * framework correctly skips its own send.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  ownerMessage = "仅所有者可管理管理员账户"
): Promise<boolean> {
  const admin = request.lucyAdmin?.admin;
  if (!admin) {
    await reply.status(401).send({
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "需要登录" }
    });
    return false;
  }
  if (admin.role !== "owner") {
    await reply.status(403).send({
      ok: false,
      error: { code: "OWNER_REQUIRED", message: ownerMessage }
    });
    return false;
  }
  return true;
}

/**
 * L25-16 / G13 — 委托与 Token 面的 owner 门禁。
 *
 * 与 `requireOwner` 的唯一差别：**open 模式**（`LUCY_WEBUI_AUTH=off`）下实例只有一个
 * 隐式管理者 `local-admin`，根本不存在 operator / owner 之分，因此门禁视为已满足。
 * `required` 模式下必须是已登录且 `role === "owner"` 的管理员。
 *
 * 适用范围（Spec §3.2.2 规则 8）：设置 / 修改 / 撤销 `delegated_from`；为已有 owner
 * 委托的 Agent 签发 Token；授予含 owner-only 工具的角色；修改影响控制面可达范围的
 * Agent `role` / `roles` / `allow.ops`。
 */
export async function requireOwnerForOps(
  request: FastifyRequest,
  reply: FastifyReply,
  ownerMessage = "仅所有者可管理委托与控制面授权"
): Promise<boolean> {
  const ctx = request.lucyAdmin;
  // open 模式：唯一的管理者就是实例所有者本人，不存在越权面。
  if (ctx?.authMode === "open") return true;
  if (!ctx?.admin) {
    await reply.status(401).send({
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "需要登录" }
    });
    return false;
  }
  if (ctx.admin.role !== "owner") {
    await reply.status(403).send({
      ok: false,
      error: { code: "OWNER_REQUIRED", message: ownerMessage }
    });
    return false;
  }
  return true;
}

export async function listEnabledAdminSummaries() {
  const config = await loadAdminsConfig();
  return enabledAdmins(config).map((a) => ({
    id: a.id,
    displayName: a.display_name,
    role: a.role
  }));
}
