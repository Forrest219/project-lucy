import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  countEnabledOwners,
  countEnabledOwnersWithLocalPassword,
  enabledAdmins,
  findAdmin,
  loadAdminsConfig,
  normalizeWebuiAdminRole,
  ownerAdminView,
  publicAdminView,
  resolveAuthMode,
  saveAdminsConfig,
  ADMIN_ID_RE,
  type AdminsConfig,
  type OidcBinding,
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
import { clearSessionCookie, setSessionCookie } from "./session.js";
import { actorIdFromRequest, AUTH_STATE_UNAVAILABLE, requireOwner } from "./guard.js";
import {
  attemptedIdDigest,
  bindingDigest,
  recordAuthEvent,
  type AuthEventKind,
  type AuthEventSummary
} from "../security/auth-events.js";
import {
  enableAccount,
  ensureAccountUid,
  issueSession,
  narrowAccount,
  revokeRequestSession
} from "./account-state.js";
import { getStartupOidcRuntimeView } from "./oidc-runtime.js";

// Verified against when the account is unknown/disabled so both paths cost one scrypt (no existence oracle).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("lucy-unknown-account-placeholder"));

const AUTH_INVALID = {
  ok: false,
  error: { code: "AUTH_INVALID", message: "管理员 id 或密码不正确" }
} as const;

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
    // Derived from the startup cache; the unauthenticated path never reads a file.
    const runtime = await getStartupOidcRuntimeView();
    const methods = mode === "required" && runtime.enabled ? ["local", "oidc"] : ["local"];
    return {
      ok: true,
      data: {
        mode,
        me,
        authEnabled: mode !== "open",
        methods
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
    const verified = await verifyPassword(password, admin?.password_hash || (await getDummyHash()));
    if (!admin?.password_hash || !verified) {
      // Unknown, disabled and wrong-password are one indistinguishable 401 (Spec §3.1 item 6).
      await recordAuthEvent({
        kind: "login_failure",
        request,
        actor: "anonymous",
        actorType: "anonymous",
        summary: {
          method: "local",
          reason: "invalid_credentials",
          attemptedIdDigest: attemptedIdDigest(adminId)
        }
      });
      return reply.status(401).send(AUTH_INVALID);
    }
    await clearLoginFailures(request, adminId);

    // Legacy accounts get their immutable uid on first login (controlled, audited migration).
    let account: WebuiAdminRecord | null;
    try {
      account = await ensureAccountUid(admin.id);
    } catch {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }
    if (!account) return reply.status(401).send(AUTH_INVALID);
    const session = await issueSession(account);
    if (!session.ok) {
      return session.status === 401
        ? reply.status(401).send(AUTH_INVALID)
        : reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }
    // The session is only handed out once its login is durably on the ledger.
    if (!(await recordAuthEvent({ kind: "login_success", request, actor: account.id, summary: { method: "local" } }))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }
    setSessionCookie(reply, session.token, session.exp);
    return { ok: true, data: { me: publicAdminView(account) } };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    // Durable revocation first; the cookie is only cleared once it holds (Spec §3.2).
    const revoked = await revokeRequestSession(request);
    if (revoked === "unavailable") {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }
    if (revoked === "revoked") {
      // Revocation is already durable; the event is best effort and must not keep a session alive.
      await recordAuthEvent({ kind: "logout", request, actor: request.lucyAdmin?.admin?.id ?? "anonymous" });
    }
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
    const session = await issueSession(outcome.record);
    if (!session.ok) return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    if (!(await recordAuthEvent({ kind: "bootstrap_success", request, actor: outcome.record.id, summary: { role: "owner" } }))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }
    setSessionCookie(reply, session.token, session.exp);
    return { ok: true, data: { me: publicAdminView(outcome.record) } };
  });
}

type AccountEvent = {
  kind: AuthEventKind;
  targetId: string;
  role?: string;
  summary?: Omit<AuthEventSummary, "targetId" | "role">;
};

/** Account changes are recorded after the config write; a ledger failure is reported, not hidden. */
async function recordAccountEvents(request: FastifyRequest, events: AccountEvent[]): Promise<boolean> {
  const actor = actorIdFromRequest(request);
  for (const event of events) {
    const summary = {
      targetId: event.targetId,
      ...(event.role ? { role: event.role } : {}),
      ...(event.summary ?? {})
    };
    if (!(await recordAuthEvent({ kind: event.kind, request, actor, summary }))) return false;
  }
  return true;
}

/**
 * Validates an OIDC identity binding (L25-06 §5.3).
 *
 * The issuer must equal the configured issuer byte for byte — no trailing-slash,
 * case or URL normalization. A binding for another provider would never match a
 * login, so it is refused at write time rather than at callback time.
 */
async function checkOidcBinding(
  input: { issuer?: string; sub?: string; email?: string } | undefined
): Promise<
  | { ok: true; binding: OidcBinding }
  | { ok: false; status: number; code: string; message: string }
> {
  const issuer = (input?.issuer ?? "").trim();
  const sub = (input?.sub ?? "").trim();
  const email = (input?.email ?? "").trim();
  if (!issuer || !sub || !email.includes("@") || email.startsWith("@") || email.endsWith("@")) {
    return {
      ok: false,
      status: 400,
      code: "BAD_REQUEST",
      message: "身份绑定需要 issuer、sub 与有效的 email"
    };
  }
  const runtime = await getStartupOidcRuntimeView();
  if (!runtime.enabled || !runtime.profile) {
    return {
      ok: false,
      status: 503,
      code: "OIDC_NOT_AVAILABLE",
      message: "单点登录当前不可用，无法维护身份绑定"
    };
  }
  if (issuer !== runtime.profile.issuer) {
    return {
      ok: false,
      status: 400,
      code: "OIDC_ISSUER_MISMATCH",
      message: "身份绑定与当前单点登录配置不一致"
    };
  }
  return { ok: true, binding: { issuer, sub, email } };
}

/** A `(issuer, sub)` or `(issuer, email)` pair may belong to one account only. */
function bindingConflicts(config: AdminsConfig, binding: OidcBinding, exceptAdminId?: string): boolean {
  for (const admin of config.admins) {
    if (exceptAdminId && admin.id === exceptAdminId) continue;
    for (const existing of admin.oidc_bindings ?? []) {
      if (existing.issuer !== binding.issuer) continue;
      if (existing.sub === binding.sub) return true;
      if (existing.email.toLowerCase() === binding.email.toLowerCase()) return true;
    }
  }
  return false;
}

/**
 * The recovery floor of L25-06 D05: at least one enabled owner must keep a local
 * password, so Lucy never depends on the identity provider alone.
 */
function recoveryOwnerFloorBroken(config: AdminsConfig): boolean {
  return countEnabledOwnersWithLocalPassword(config) < 1;
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
    // Owners see the login methods and the identity bindings; operators do not.
    const isOwner = request.lucyAdmin?.admin?.role === "owner";
    return {
      ok: true,
      data: {
        mode,
        admins: config.admins.map((admin) => (isOwner ? ownerAdminView(admin) : publicAdminView(admin)))
      }
    };
  });

  app.post<{
    Body: {
      adminId?: string;
      displayName?: string;
      password?: string;
      role?: WebuiAdminRole | "admin";
      oidcBinding?: { issuer?: string; sub?: string; email?: string };
    };
  }>("/api/admin/admins", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!(await requireOwner(request, reply))) return;

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

    // A binding is optional; an account without one must carry a local password.
    const hasBindingInput = request.body?.oidcBinding !== undefined && request.body?.oidcBinding !== null;
    let binding: OidcBinding | undefined;
    if (hasBindingInput) {
      const checked = await checkOidcBinding(request.body?.oidcBinding);
      if (!checked.ok) {
        return reply.status(checked.status).send({
          ok: false,
          error: { code: checked.code, message: checked.message }
        });
      }
      binding = checked.binding;
    }

    if (!binding || password.length > 0) {
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
    }

    const config = await loadAdminsConfig({ fresh: true });
    if (findAdmin(config, adminId)) {
      return reply.status(409).send({
        ok: false,
        error: { code: "ADMIN_ID_TAKEN", message: `管理员 '${adminId}' 已存在` }
      });
    }
    if (binding && bindingConflicts(config, binding)) {
      return reply.status(409).send({
        ok: false,
        error: { code: "OIDC_BINDING_CONFLICT", message: "该身份已绑定其他登录账户" }
      });
    }

    const password_hash = password.length > 0 ? await hashPassword(password) : undefined;
    const record: WebuiAdminRecord = {
      id: adminId,
      account_uid: randomUUID(),
      display_name: displayName,
      ...(password_hash ? { password_hash } : {}),
      role,
      enabled: true,
      created_at: new Date().toISOString(),
      ...(binding ? { oidc_bindings: [binding] } : {})
    };
    const next: AdminsConfig = { ...config, admins: [...config.admins, record] };
    if (recoveryOwnerFloorBroken(next)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "LOCAL_OWNER_REQUIRED",
          message: "至少保留一名可使用本地密码登录的启用中所有者"
        }
      });
    }
    await saveAdminsConfig(next, {
      changeType: "admin_create",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { count: config.admins.length },
      newSummary: { count: next.admins.length, id: adminId, role },
      requestId: request.id
    });
    const events: AccountEvent[] = [{ kind: "admin_created", targetId: adminId, role }];
    if (binding) {
      events.push({
        kind: "oidc_binding_added",
        targetId: adminId,
        summary: {
          bindingDigest: bindingDigest(binding.issuer, binding.sub),
          hasLocalPassword: String(Boolean(password_hash))
        }
      });
    }
    if (!(await recordAccountEvents(request, events))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    return { ok: true, data: { admin: ownerAdminView(record) } };
  });

  app.patch<{
    Params: { adminId: string };
    Body: {
      displayName?: string;
      password?: string;
      role?: WebuiAdminRole | "admin";
      enabled?: boolean;
      removeLocalPassword?: boolean;
    };
  }>("/api/admin/admins/:adminId", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!(await requireOwner(request, reply))) return;

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

    // Removing the local password is an explicit, separate operation (L25-06 §5.3):
    // it is only allowed while an OIDC binding still provides a way in.
    const removingLocalPassword = request.body?.removeLocalPassword === true;
    if (removingLocalPassword) {
      if (request.body?.password) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "BAD_REQUEST",
            message: "移除本地密码与设置新密码不能同时提交"
          }
        });
      }
      if (!current.oidc_bindings?.length) {
        return reply.status(400).send({
          ok: false,
          error: {
            code: "AUTH_CREDENTIAL_REQUIRED",
            message: "登录账户至少需要一种可用登录方式"
          }
        });
      }
      nextRecord.password_hash = undefined;
    }

    // A row that never logged in has no uid yet; give it one in this same write.
    if (!nextRecord.account_uid) nextRecord.account_uid = randomUUID();

    const nextAdmins = [...config.admins];
    nextAdmins[index] = nextRecord;
    const nextConfig: AdminsConfig = { ...config, admins: nextAdmins };

    if (countEnabledOwners(nextConfig) < 1) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LAST_OWNER_REQUIRED", message: "至少保留一名启用中的所有者" }
      });
    }
    // L25-06 D05: at least one enabled owner must keep a local password.
    if (recoveryOwnerFloorBroken(nextConfig)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "LOCAL_OWNER_REQUIRED",
          message: "至少保留一名可使用本地密码登录的启用中所有者"
        }
      });
    }

    // Spec §3.2: narrow first (epoch/disable), then write the configuration.
    const narrowing =
      current.enabled && nextRecord.enabled === false
        ? "disable"
        : nextRecord.role !== current.role || nextRecord.password_hash !== current.password_hash
          ? "revoke_sessions"
          : null;
    if (narrowing && !(await narrowAccount(current, narrowing))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
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
        passwordRotated: Boolean(request.body?.password) && !removingLocalPassword,
        passwordRemoved: removingLocalPassword
      },
      requestId: request.id
    });

    // Enabling is widening, so it follows the config write; it never revives old sessions.
    if (request.body?.enabled === true && !(await enableAccount(nextRecord))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    const events: AccountEvent[] = [];
    // A removal is NOT a rotation: the two events stay distinguishable in the ledger.
    if (removingLocalPassword) {
      events.push({ kind: "password_removed", targetId: adminId, summary: { hasLocalPassword: "false" } });
    } else if (nextRecord.password_hash !== current.password_hash) {
      events.push({ kind: "password_rotated", targetId: adminId, summary: { hasLocalPassword: "true" } });
    }
    if (nextRecord.role !== current.role) events.push({ kind: "admin_role_changed", targetId: adminId, role: nextRecord.role });
    if (current.enabled && !nextRecord.enabled) events.push({ kind: "admin_disabled", targetId: adminId });
    if (!current.enabled && nextRecord.enabled) events.push({ kind: "admin_enabled", targetId: adminId });
    if (!(await recordAccountEvents(request, events))) return reply.status(503).send(AUTH_STATE_UNAVAILABLE);

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
    if (!(await requireOwner(request, reply))) return;

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

    // L25-06 D05: at least one enabled owner must keep a local password.
    if (recoveryOwnerFloorBroken(nextConfig)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "LOCAL_OWNER_REQUIRED",
          message: "至少保留一名可使用本地密码登录的启用中所有者"
        }
      });
    }

    // Spec §3.2: tombstone (epoch bump, uid never reused) before the configuration write.
    if (!(await narrowAccount(target, "tombstone"))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    await saveAdminsConfig(nextConfig, {
      changeType: "admin_delete",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { id: target.id, role: target.role },
      newSummary: { count: nextConfig.admins.length },
      requestId: request.id
    });
    if (!(await recordAccountEvents(request, [{ kind: "admin_deleted", targetId: adminId }]))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    return { ok: true, data: { deleted: adminId } };
  });

  /**
   * Add or replace the identity binding of one account (L25-06 §5.3).
   *
   * Adding a binding opens a login path; replacing one narrows it. A replacement
   * therefore revokes the existing sessions BEFORE the configuration write, and a
   * failed write never restores them.
   */
  app.put<{
    Params: { adminId: string };
    Body: { issuer?: string; sub?: string; email?: string };
  }>("/api/admin/admins/:adminId/oidc-binding", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!(await requireOwner(request, reply))) return;

    const { adminId } = request.params;
    const config = await loadAdminsConfig({ fresh: true });
    const index = config.admins.findIndex((a) => a.id === adminId);
    if (index < 0) {
      return reply.status(404).send({
        ok: false,
        error: { code: "ADMIN_NOT_FOUND", message: `管理员 '${adminId}' 不存在` }
      });
    }

    const checked = await checkOidcBinding(request.body);
    if (!checked.ok) {
      return reply.status(checked.status).send({
        ok: false,
        error: { code: checked.code, message: checked.message }
      });
    }
    const binding = checked.binding;

    if (bindingConflicts(config, binding, adminId)) {
      return reply.status(409).send({
        ok: false,
        error: { code: "OIDC_BINDING_CONFLICT", message: "该身份已绑定其他登录账户" }
      });
    }

    const current = config.admins[index];
    const replacing = Boolean(current.oidc_bindings?.some((b) => b.issuer === binding.issuer));
    const nextBindings = [
      ...(current.oidc_bindings ?? []).filter((b) => b.issuer !== binding.issuer),
      binding
    ];
    const nextRecord: WebuiAdminRecord = { ...current, oidc_bindings: nextBindings };
    const nextAdmins = [...config.admins];
    nextAdmins[index] = nextRecord;
    const nextConfig: AdminsConfig = { ...config, admins: nextAdmins };

    if (recoveryOwnerFloorBroken(nextConfig)) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "LOCAL_OWNER_REQUIRED",
          message: "至少保留一名可使用本地密码登录的启用中所有者"
        }
      });
    }

    // Narrowing: revoke first, write second.
    if (replacing && !(await narrowAccount(current, "revoke_sessions"))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    await saveAdminsConfig(nextConfig, {
      changeType: "admin_oidc_binding",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { id: current.id, bindings: (current.oidc_bindings ?? []).length },
      newSummary: { id: nextRecord.id, bindings: nextBindings.length },
      requestId: request.id
    });

    const events: AccountEvent[] = [
      {
        kind: replacing ? "oidc_binding_replaced" : "oidc_binding_added",
        targetId: adminId,
        summary: {
          bindingDigest: bindingDigest(binding.issuer, binding.sub),
          hasLocalPassword: String(Boolean(nextRecord.password_hash))
        }
      }
    ];
    if (!(await recordAccountEvents(request, events))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    return { ok: true, data: { admin: ownerAdminView(nextRecord) } };
  });

  /** Remove the identity binding of one account (L25-06 §5.3). */
  app.delete<{
    Params: { adminId: string };
    Querystring: { issuer?: string };
  }>("/api/admin/admins/:adminId/oidc-binding", async (request, reply) => {
    if ((await resolveAuthMode()) !== "required") {
      return reply.status(400).send({
        ok: false,
        error: { code: "AUTH_NOT_CONFIGURED", message: "请先完成管理员引导" }
      });
    }
    if (!(await requireOwner(request, reply))) return;

    const { adminId } = request.params;
    const config = await loadAdminsConfig({ fresh: true });
    const index = config.admins.findIndex((a) => a.id === adminId);
    if (index < 0) {
      return reply.status(404).send({
        ok: false,
        error: { code: "ADMIN_NOT_FOUND", message: `管理员 '${adminId}' 不存在` }
      });
    }

    const issuer = (request.query.issuer ?? "").trim();
    const runtime = await getStartupOidcRuntimeView();
    if (!runtime.enabled || !runtime.profile) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "OIDC_NOT_AVAILABLE",
          message: "单点登录当前不可用，无法维护身份绑定"
        }
      });
    }
    if (!issuer || issuer !== runtime.profile.issuer) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "OIDC_ISSUER_MISMATCH",
          message: "身份绑定与当前单点登录配置不一致"
        }
      });
    }

    const current = config.admins[index];
    const removed = (current.oidc_bindings ?? []).filter((b) => b.issuer === issuer);
    if (!removed.length) {
      return reply.status(404).send({
        ok: false,
        error: {
          code: "OIDC_BINDING_NOT_FOUND",
          message: "该登录账户没有当前身份源的绑定"
        }
      });
    }
    const remaining = (current.oidc_bindings ?? []).filter((b) => b.issuer !== issuer);
    if (!remaining.length && !current.password_hash) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "AUTH_CREDENTIAL_REQUIRED",
          message: "登录账户至少需要一种可用登录方式"
        }
      });
    }

    const nextRecord: WebuiAdminRecord = {
      ...current,
      ...(remaining.length ? { oidc_bindings: remaining } : { oidc_bindings: undefined })
    };
    const nextAdmins = [...config.admins];
    nextAdmins[index] = nextRecord;
    const nextConfig: AdminsConfig = { ...config, admins: nextAdmins };

    // Narrowing: revoke first, write second.
    if (!(await narrowAccount(current, "revoke_sessions"))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    await saveAdminsConfig(nextConfig, {
      changeType: "admin_oidc_binding",
      actor: actorIdFromRequest(request),
      targetId: adminId,
      oldSummary: { id: current.id, bindings: (current.oidc_bindings ?? []).length },
      newSummary: { id: nextRecord.id, bindings: remaining.length },
      requestId: request.id
    });

    const events: AccountEvent[] = [
      {
        kind: "oidc_binding_removed",
        targetId: adminId,
        summary: {
          bindingDigest: bindingDigest(removed[0].issuer, removed[0].sub),
          hasLocalPassword: String(Boolean(nextRecord.password_hash))
        }
      }
    ];
    if (!(await recordAccountEvents(request, events))) {
      return reply.status(503).send(AUTH_STATE_UNAVAILABLE);
    }

    return { ok: true, data: { admin: ownerAdminView(nextRecord) } };
  });
}
