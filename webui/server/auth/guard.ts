import type { FastifyReply, FastifyRequest } from "fastify";
import {
  enabledAdmins,
  findAdmin,
  loadAdminsConfig,
  resolveAuthMode,
  type WebuiAdminRecord
} from "./admins-store.js";
import { readAdminSession, type AdminSession } from "./session.js";

export type RequestAdminContext = {
  session: AdminSession | null;
  admin: WebuiAdminRecord | null;
};

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
  if (m === "GET" && pathOnly.startsWith("/api/help")) return true;
  return false;
}

export async function attachAdminContext(request: FastifyRequest): Promise<RequestAdminContext> {
  const session = await readAdminSession(request);
  let admin: WebuiAdminRecord | null = null;
  if (session) {
    const config = await loadAdminsConfig();
    const found = findAdmin(config, session.adminId);
    if (found && found.enabled) admin = found;
  }
  const ctx: RequestAdminContext = {
    session: admin ? session : null,
    admin
  };
  request.lucyAdmin = ctx;
  return ctx;
}

export async function requireWebuiAuthHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const ctx = await attachAdminContext(request);
  const mode = await resolveAuthMode();
  if (mode === "open") return;
  if (isPublicApi(request.method, request.url)) return;

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

export function actorIdFromRequest(request: FastifyRequest): string {
  return request.lucyAdmin?.admin?.id ?? "local-admin";
}

export function requireOwner(request: FastifyRequest, reply: FastifyReply): boolean {
  const admin = request.lucyAdmin?.admin;
  if (!admin) {
    void reply.status(401).send({
      ok: false,
      error: { code: "AUTH_REQUIRED", message: "需要登录" }
    });
    return false;
  }
  if (admin.role !== "owner") {
    void reply.status(403).send({
      ok: false,
      error: { code: "OWNER_REQUIRED", message: "仅所有者可管理管理员账户" }
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
