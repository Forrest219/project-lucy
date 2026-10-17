import type { FastifyInstance } from "fastify";
import {
  countEnabledOwners,
  enabledAdmins,
  findAdmin,
  loadAdminsConfig,
  normalizeWebuiAdminRole,
  publicAdminView,
  resolveAuthMode,
  saveAdminsConfig,
  ADMIN_ID_RE,
  type AdminsConfig,
  type WebuiAdminRecord,
  type WebuiAdminRole
} from "./admins-store.js";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password.js";
import { runBootstrap } from "./bootstrap.js";
import {
  clearBootstrapFailures,
  clearLoginFailures,
  gateBootstrapAttempt,
  gateLoginAttempt,
  replyAuthGate
} from "./rate-limit.js";
import {
  clearSessionCookie,
  createAdminSession,
  setSessionCookie
} from "./session.js";
import { actorIdFromRequest, requireOwner } from "./guard.js";

// Verified against when the account is unknown/disabled so both paths cost one scrypt (no existence oracle).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("lucy-unknown-account-placeholder"));

const AUTH_CONFIG_UNAVAILABLE = {
  ok: false,
  error: { code: "AUTH_CONFIG_UNAVAILABLE", message: "管理员配置不可用，请联系部署人员修复后重试" }
} as const;

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/api/auth/status", async (request) => {
    const mode = await resolveAuthMode();
    const me = request.lucyAdmin?.admin
      ? publicAdminView(request.lucyAdmin.admin)
      : null;
    return {
      ok: true,
      data: {
        mode,
        me,
        authEnabled: mode !== "open"
      }
    };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const mode = await resolveAuthMode();
    if (mode === "open") {
      return {
        ok: true,
        data: {
          mode,
          me: {
            id: "local-admin",
            displayName: "本机管理员",
            role: "owner" as const,
            enabled: true,
            createdAt: null
          }
        }
      };
    }
    if (!request.lucyAdmin?.admin) {
      return reply.status(401).send({
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "需要登录" }
      });
    }
    return {
      ok: true,
      data: { mode, me: publicAdminView(request.lucyAdmin.admin) }
    };
  });

  app.post<{
    Body: { adminId?: string; password?: string };
  }>("/api/auth/login", async (request, reply) => {
    const mode = await resolveAuthMode();
    if (mode === "open") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_REQUIRED", message: "当前为开放模式，无需登录" }
      });
    }
    if (mode === "bootstrap") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_BOOTSTRAP_REQUIRED", message: "请先创建首个所有者管理员" }
      });
    }
    if (mode === "unavailable") return reply.status(503).send(AUTH_CONFIG_UNAVAILABLE);

    const adminId = request.body?.adminId?.trim() ?? "";
    const password = request.body?.password ?? "";
    if (!adminId || !password) {
      return reply.status(400).send({
        ok: false,
        error: { code: "BAD_REQUEST", message: "需要管理员 id 与密码" }
      });
    }

    const gate = await gateLoginAttempt(request, adminId);
    if (!gate.ok) return replyAuthGate(reply, gate);

    const config = await loadAdminsConfig({ fresh: true });
    const found = findAdmin(config, adminId);
    const admin = found?.enabled ? found : undefined;
    const verified = await verifyPassword(password, admin ? admin.password_hash : await getDummyHash());
    if (!admin || !verified) {
      // Unknown, disabled and wrong-password are one indistinguishable 401 (Spec §3.1 item 6).
      return reply.status(401).send({
        ok: false,
        error: { code: "AUTH_INVALID", message: "管理员 id 或密码不正确" }
      });
    }
    await clearLoginFailures(request, adminId);

    const session = await createAdminSession(admin.id);
    setSessionCookie(reply, session.token, session.exp);
    return { ok: true, data: { me: publicAdminView(admin) } };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true, data: { loggedOut: true } };
  });

  app.post<{
    Body: {
      adminId?: string;
      displayName?: string;
      password?: string;
    };
  }>("/api/auth/bootstrap", async (request, reply) => {
    const mode = await resolveAuthMode();
    if (mode === "required") {
      return reply.status(409).send({
        ok: false,
        error: { code: "ADMINS_ALREADY_CONFIGURED", message: "管理员已配置，请直接登录" }
      });
    }
    if (mode === "unavailable") return reply.status(503).send(AUTH_CONFIG_UNAVAILABLE);

    const gate = await gateBootstrapAttempt(request);
    if (!gate.ok) return replyAuthGate(reply, gate);

    const adminId = request.body?.adminId?.trim() ?? "";
    const outcome = await runBootstrap({
      adminId,
      displayName: request.body?.displayName?.trim() || adminId,
      password: request.body?.password ?? "",
      tokenHeader: request.headers["x-lucy-bootstrap-token"],
      requestId: request.id
    });
    if (!outcome.ok) {
      return reply.status(outcome.status).send({
        ok: false,
        error: { code: outcome.code, message: outcome.message }
      });
    }

    await clearBootstrapFailures(request);
    const session = await createAdminSession(adminId);
    setSessionCookie(reply, session.token, session.exp);
    return { ok: true, data: { me: publicAdminView(outcome.record) } };
  });
}

export function registerAdminAccountRoutes(app: FastifyInstance): void {
  app.get("/api/admin/admins", async (request, reply) => {
    const mode = await resolveAuthMode();
    if (mode === "open") {
      return {
        ok: true,
        data: {
          mode,
          admins: [
            {
              id: "local-admin",
              displayName: "本机管理员",
              role: "owner",
              enabled: true,
              createdAt: null
            }
          ]
        }
      };
    }
    if (!request.lucyAdmin?.admin) {
      return reply.status(401).send({
        ok: false,
        error: { code: "AUTH_REQUIRED", message: "需要登录" }
      });
    }
    const config = await loadAdminsConfig({ fresh: true });
    return {
      ok: true,
      data: {
        mode,
        admins: config.admins.map(publicAdminView)
      }
    };
  });

  app.post<{
    Body: {
      adminId?: string;
      displayName?: string;
      password?: string;
      role?: WebuiAdminRole | "admin";
    };
  }>("/api/admin/admins", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!requireOwner(request, reply)) return;

    const adminId = request.body?.adminId?.trim() ?? "";
    const displayName = request.body?.displayName?.trim() || adminId;
    const password = request.body?.password ?? "";
    // Default new accounts to operator (运维); owner must be explicit.
    const role: WebuiAdminRole =
      request.body?.role === "owner" ? "owner" : "operator";

    if (!ADMIN_ID_RE.test(adminId)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "ADMIN_ID_INVALID",
          message: "管理员 id 需为 2–32 位小写字母开头的字母数字/_/-"
        }
      });
    }
    try {
      assertPasswordPolicy(password);
    } catch (error) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "PASSWORD_TOO_SHORT",
          message: error instanceof Error ? error.message : "密码不符合要求"
        }
      });
    }

    const config = await loadAdminsConfig({ fresh: true });
    if (findAdmin(config, adminId)) {
      return reply.status(409).send({
        ok: false,
        error: { code: "ADMIN_ID_TAKEN", message: `管理员 '${adminId}' 已存在` }
      });
    }

    const password_hash = await hashPassword(password);
    const record: WebuiAdminRecord = {
      id: adminId,
      display_name: displayName,
      password_hash,
      role,
      enabled: true,
      created_at: new Date().toISOString()
    };
    const next: AdminsConfig = { ...config, admins: [...config.admins, record] };
    await saveAdminsConfig(next, {
      changeType: "admin_create",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { count: config.admins.length },
      newSummary: { count: next.admins.length, id: adminId, role },
      requestId: request.id
    });

    return { ok: true, data: { admin: publicAdminView(record) } };
  });

  app.patch<{
    Params: { adminId: string };
    Body: {
      displayName?: string;
      password?: string;
      role?: WebuiAdminRole | "admin";
      enabled?: boolean;
    };
  }>("/api/admin/admins/:adminId", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!requireOwner(request, reply)) return;

    const { adminId } = request.params;
    const config = await loadAdminsConfig({ fresh: true });
    const index = config.admins.findIndex((a) => a.id === adminId);
    if (index < 0) {
      return reply.status(404).send({
        ok: false,
        error: { code: "ADMIN_NOT_FOUND", message: `管理员 '${adminId}' 不存在` }
      });
    }

    const current = config.admins[index];
    const nextRecord: WebuiAdminRecord = { ...current };

    if (typeof request.body?.displayName === "string" && request.body.displayName.trim()) {
      nextRecord.display_name = request.body.displayName.trim();
    }
    if (request.body?.role === "owner" || request.body?.role === "operator" || request.body?.role === "admin") {
      nextRecord.role = normalizeWebuiAdminRole(request.body.role);
    }
    if (typeof request.body?.enabled === "boolean") {
      nextRecord.enabled = request.body.enabled;
    }
    if (typeof request.body?.password === "string" && request.body.password.length > 0) {
      try {
        assertPasswordPolicy(request.body.password);
      } catch (error) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "PASSWORD_TOO_SHORT",
            message: error instanceof Error ? error.message : "密码不符合要求"
          }
        });
      }
      nextRecord.password_hash = await hashPassword(request.body.password);
    }

    const nextAdmins = [...config.admins];
    nextAdmins[index] = nextRecord;
    const nextConfig: AdminsConfig = { ...config, admins: nextAdmins };

    if (countEnabledOwners(nextConfig) < 1) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LAST_OWNER_REQUIRED", message: "至少保留一名启用中的所有者" }
      });
    }

    await saveAdminsConfig(nextConfig, {
      changeType: "admin_patch",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: {
        id: current.id,
        role: current.role,
        enabled: current.enabled,
        displayName: current.display_name
      },
      newSummary: {
        id: nextRecord.id,
        role: nextRecord.role,
        enabled: nextRecord.enabled,
        displayName: nextRecord.display_name,
        passwordRotated: Boolean(request.body?.password)
      },
      requestId: request.id
    });

    return { ok: true, data: { admin: publicAdminView(nextRecord) } };
  });

  app.delete<{
    Params: { adminId: string };
  }>("/api/admin/admins/:adminId", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!requireOwner(request, reply)) return;

    const { adminId } = request.params;
    const config = await loadAdminsConfig({ fresh: true });
    const target = findAdmin(config, adminId);
    if (!target) {
      return reply.status(404).send({
        ok: false,
        error: { code: "ADMIN_NOT_FOUND", message: `管理员 '${adminId}' 不存在` }
      });
    }

    const nextConfig: AdminsConfig = {
      ...config,
      admins: config.admins.filter((a) => a.id !== adminId)
    };
    if (countEnabledOwners(nextConfig) < 1) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LAST_OWNER_REQUIRED", message: "至少保留一名启用中的所有者" }
      });
    }

    await saveAdminsConfig(nextConfig, {
      changeType: "admin_delete",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { id: target.id, role: target.role },
      newSummary: { count: nextConfig.admins.length },
      requestId: request.id
    });

    return { ok: true, data: { deleted: adminId } };
  });
}
