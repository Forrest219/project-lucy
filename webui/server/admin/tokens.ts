import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditedWriteFile } from "./config-audit-write.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import type { YamlAccessConfig } from "./agents.js";
import { getLastUsedMap } from "./agents.js";
import {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  type AccessGovernanceApprover,
  type AccessGovernanceGateDecision,
  type AccessGovernanceOverrideRequest
} from "../access-governance-gate.js";
import { invalidateAccessConfigCache, isTokenExpired, normalizeExpiresAtInput } from "../proxy/identity.js";
import { actorIdFromRequest } from "../auth/guard.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function defaultActor(request?: FastifyRequest): AccessGovernanceApprover {
  return {
    actorKind: "admin",
    actorId: request ? actorIdFromRequest(request) : "local-admin",
    identityProvider: "webui-local"
  };
}

function actorIpFromRequest(request: FastifyRequest): string | undefined {
  const trust = (process.env.LUCY_TRUST_PROXY ?? "").trim().toLowerCase();
  const trustProxy = trust === "1" || trust === "true" || trust === "yes";
  if (trustProxy) {
    const xff = request.headers["x-forwarded-for"];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    const first = raw?.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip || undefined;
}

async function writeGateTrace(
  decision: AccessGovernanceGateDecision,
  override: { ok: boolean } | undefined,
  overrideRequest: AccessGovernanceOverrideRequest | undefined,
  actor: AccessGovernanceApprover
): Promise<void> {
  try {
    const db = await getAuditDb();
    recordAccessGovernanceGateEvent({
      database: db,
      decision,
      overrideEvaluation: override ? { ok: override.ok } : undefined,
      overrideRequest,
      actor
    });
  } catch (error) {
    // Hot store failure is non-fatal, but the missing Trace / Evidence chain
    // must be visible to operators.
    console.error("[lucy-admin] failed to write access governance gate trace", {
      targetKind: decision.targetKind,
      targetId: decision.targetId ?? null,
      traceId: decision.traceId,
      decision: decision.decision,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * Read the recent access_log call count for an Agent. Used to escalate
 * Token creation to P1 review when the Agent is high-traffic. Returns 0
 * when the audit db is unavailable (e.g. unit tests with a mocked
 * `getAuditDb`); the gate then classifies the Token as P0/P2 only based on
 * its own inputs.
 */
async function agentCallsLast7d(userId: string): Promise<number> {
  try {
    const db = await getAuditDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM access_log
         WHERE user_id = ? AND ts >= datetime('now','-7 days')`
      )
      .get(userId) as { cnt: number | null } | undefined;
    return row?.cnt ?? 0;
  } catch {
    return 0;
  }
}

export function registerTokenRoutes(app: FastifyInstance) {
  // GET /api/admin/tokens
  app.get<{
    Querystring: {
      userId?: string;
      search?: string;
      status?: "all" | "available" | "expired" | "agent_disabled";
    };
  }>("/api/admin/tokens", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    let config: YamlAccessConfig = { users: [] };
    try {
      const raw = await readFile(filePath, "utf-8");
      config = parse(raw) as YamlAccessConfig;
      if (!config.users) config.users = [];
    } catch {
      config = { users: [] };
    }

    const users = config.users || [];
    const userIds = users.map((u) => u.id);
    const lastUsedMap = await getLastUsedMap(userIds);

    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    type TokenInventoryItem = {
      hashPrefix: string;
      label: string;
      created: string;
      expires_at: string | null;
      device_name: string | null;
      agent: {
        id: string;
        name: string;
        enabled: boolean;
        roles: string[];
      };
      last_used?: string;
      last_tool?: string;
      last_outcome?: string;
      last_ip?: string | null;
      last_user_agent?: string | null;
      last_client?: string | null;
      last_client_version?: string | null;
      last_device_name_seen?: string | null;
      distinct_ips_7d?: number;
      status: "available" | "expired" | "agent_disabled";
    };

    const allTokens: TokenInventoryItem[] = [];

    for (const user of users) {
      const userUsage = lastUsedMap.get(user.id);
      const isAgentEnabled = user.enabled !== false;
      const roles = user.roles && Array.isArray(user.roles) ? user.roles : user.role ? [user.role] : [];

      for (const t of user.tokens || []) {
        const hashPrefix = t.hash ? t.hash.slice(0, 19) : "";
        const usage = hashPrefix ? userUsage?.get(hashPrefix) : undefined;
        const expired = isTokenExpired(t.expires_at, now);

        let status: "available" | "expired" | "agent_disabled" = "available";
        if (!isAgentEnabled) {
          status = "agent_disabled";
        } else if (expired) {
          status = "expired";
        }

        allTokens.push({
          hashPrefix,
          label: t.label,
          created: t.created,
          expires_at: t.expires_at ?? null,
          device_name: t.device_name ?? null,
          agent: {
            id: user.id,
            name: user.name || user.id,
            enabled: isAgentEnabled,
            roles
          },
          last_used: usage?.lastUsed,
          last_tool: usage?.lastTool,
          last_outcome: usage?.lastOutcome,
          last_ip: usage?.lastIp ?? null,
          last_user_agent: usage?.lastUserAgent ?? null,
          last_client: usage?.lastClient ?? null,
          last_client_version: usage?.lastClientVersion ?? null,
          last_device_name_seen: usage?.lastDeviceNameSeen ?? null,
          distinct_ips_7d: usage?.distinctIps7d,
          status
        });
      }
    }

    const totalTokens = allTokens.length;
    const availableTokens = allTokens.filter((t) => t.status === "available").length;
    const activeLast7dTokens = allTokens.filter((t) => {
      if (!t.last_used) return false;
      const ts = Date.parse(t.last_used);
      return !Number.isNaN(ts) && now - ts <= sevenDaysMs;
    }).length;
    const expiringSoonTokens = allTokens.filter((t) => {
      if (t.status !== "available" || !t.expires_at) return false;
      const ts = Date.parse(t.expires_at);
      return !Number.isNaN(ts) && ts > now && ts - now <= thirtyDaysMs;
    }).length;
    const expiredTokens = allTokens.filter((t) => t.status === "expired").length;

    let filtered = allTokens;
    const { userId, search, status } = request.query || {};

    if (userId) {
      filtered = filtered.filter((t) => t.agent.id === userId);
    }
    if (status && status !== "all") {
      filtered = filtered.filter((t) => t.status === status);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          (t.device_name && t.device_name.toLowerCase().includes(q)) ||
          t.agent.id.toLowerCase().includes(q) ||
          t.agent.name.toLowerCase().includes(q) ||
          t.agent.roles.some((r) => r.toLowerCase().includes(q)) ||
          (t.last_device_name_seen && t.last_device_name_seen.toLowerCase().includes(q)) ||
          (t.last_client && t.last_client.toLowerCase().includes(q))
      );
    }

    return {
      ok: true,
      data: {
        tokens: filtered,
        stats: {
          totalTokens,
          availableTokens,
          activeLast7dTokens,
          expiringSoonTokens,
          expiredTokens
        }
      }
    };
  });

  // POST /api/admin/agents/:userId/tokens
  app.post<{
    Params: { userId: string };
    Body: {
      dryRun?: boolean;
      label: string;
      device_name?: string | null;
      expires_at?: string | null;
      override?: AccessGovernanceOverrideRequest;
    };
  }>("/api/admin/agents/:userId/tokens", async (request, reply) => {
    const { userId } = request.params;
    const { label } = request.body ?? {};
    const deviceNameRaw = request.body?.device_name;
    const dryRun = request.body?.dryRun === true;
    let expires_at: string | null = null;
    try {
      expires_at = normalizeExpiresAtInput(request.body?.expires_at);
    } catch (error) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "EXPIRES_AT_INVALID",
          message: error instanceof Error ? error.message : "expires_at invalid"
        }
      });
    }

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "label is required" } });
    }

    const deviceName =
      typeof deviceNameRaw === "string" && deviceNameRaw.trim().length > 0
        ? deviceNameRaw.trim().slice(0, 128)
        : null;

    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];

    const userIndex = config.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${userId}' not found` } });
    }

    const user = config.users[userIndex];
    if (user.tokens.some((t) => t.label === label)) {
      return reply.status(409).send({ ok: false, error: { code: "TOKEN_LABEL_TAKEN", message: `Token label '${label}' already exists for this agent` } });
    }

    // Access Governance Gate — Token create escalates to P1 when the
    // owning Agent is high-traffic. We feed the gate an empty `newValue`
    // so the rules that look at sources / roles stay neutral; the high-
    // traffic P1 trigger is the only signal we expect here.
    const callsLast7d = await agentCallsLast7d(userId);
    const gate = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: `${userId}:${label}`,
      newValue: { userId, label, hashPrefix: null },
      highTrafficCalls7d: callsLast7d
    });

    if (dryRun) {
      return {
        ok: true,
        data: {
          dryRun: true,
          gate,
          proposed: {
            userId,
            label,
            device_name: deviceName,
            expires_at: expires_at ?? null
          }
        }
      };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this token create",
          detail: { gate }
        }
      });
    }

    if (gate.decision === "override_required") {
      const override = evaluateGovernanceOverride(request.body?.override, gate);
      if (!override.ok) {
        await writeGateTrace(gate, override, request.body?.override, defaultActor(request));
        return reply.status(409).send({
          ok: false,
          error: {
            code: "GOVERNANCE_GATE_OVERRIDE_REQUIRED",
            message: `Override required: ${override.reason ?? "missing override fields"}`,
            detail: { gate, override }
          }
        });
      }
      await writeGateTrace(gate, override, request.body?.override, defaultActor(request));
    } else {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
    }

    // Generate token — plaintext never written anywhere except the HTTP response
    const plainToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(plainToken);
    const created = new Date().toISOString().slice(0, 10);

    const newToken = {
      hash: tokenHash,
      label,
      created,
      ...(deviceName ? { device_name: deviceName } : {}),
      ...(expires_at !== undefined ? { expires_at: expires_at ?? null } : {})
    };

    const updatedUser = { ...user, tokens: [...user.tokens, newToken] };
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const content = stringify(newConfig, { lineWidth: 0 });
    await auditedWriteFile(projectRoot, ACCESS_YAML_REL, content, {
      enabled: true,
      changeType: "token_create",
      assetKind: "governance",
      actorType: "ui_admin",
      actorIp: actorIpFromRequest(request),
      source: "admin_tokens_api",
      targetId: userId,
      oldSummary: { tokenCount: user.tokens.length },
      newSummary: {
        tokenCount: updatedUser.tokens.length,
        label,
        device_name: deviceName,
        hashPrefix: tokenHash.slice(0, 19),
        expires_at: expires_at ?? null
      },
      requestId: request.id
    });
    invalidateAccessConfigCache();

    return {
      ok: true,
      data: {
        token: plainToken,
        hash: tokenHash,
        label,
        device_name: deviceName,
        created,
        expires_at: expires_at ?? null,
        gate
      }
    };
  });

  // DELETE /api/admin/agents/:userId/tokens/:label
  app.delete<{
    Params: { userId: string; label: string };
    Body?: { override?: AccessGovernanceOverrideRequest };
  }>("/api/admin/agents/:userId/tokens/:label", async (request, reply) => {
    const { userId, label } = request.params;
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];

    const userIndex = config.users.findIndex((u) => u.id === userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${userId}' not found` } });
    }

    const user = config.users[userIndex];
    const token = user.tokens.find((t) => t.label === label);
    if (!token) {
      return reply.status(404).send({ ok: false, error: { code: "TOKEN_NOT_FOUND", message: `Token '${label}' not found` } });
    }

    // Access Governance Gate — Token revoke is a P2 cleanup. We still
    // classify so the trace / evidence chain captures the decision.
    const gate = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: `${userId}:${label}`
    });

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this token revoke",
          detail: { gate }
        }
      });
    }

    if (gate.decision === "override_required") {
      const override = evaluateGovernanceOverride(request.body?.override, gate);
      if (!override.ok) {
        await writeGateTrace(gate, override, request.body?.override, defaultActor(request));
        return reply.status(409).send({
          ok: false,
          error: {
            code: "GOVERNANCE_GATE_OVERRIDE_REQUIRED",
            message: `Override required: ${override.reason ?? "missing override fields"}`,
            detail: { gate, override }
          }
        });
      }
      await writeGateTrace(gate, override, request.body?.override, defaultActor(request));
    } else {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
    }

    const revokedAt = new Date().toISOString();

    // Write revoked_tokens to sqlite — must succeed before yaml is updated
    const db = await getAuditDb();
    db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
      token.hash, revokedAt, "manual_revoke"
    );

    const updatedUser = { ...user, tokens: user.tokens.filter((t) => t.label !== label) };
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const content = stringify(newConfig, { lineWidth: 0 });
    await auditedWriteFile(projectRoot, ACCESS_YAML_REL, content, {
      enabled: true,
      changeType: "token_revoke",
      assetKind: "governance",
      actorType: "ui_admin",
      actorIp: actorIpFromRequest(request),
      source: "admin_tokens_api",
      targetId: userId,
      oldSummary: { tokenCount: user.tokens.length, label, hashPrefix: token.hash.slice(0, 19) },
      newSummary: { tokenCount: updatedUser.tokens.length, label },
      requestId: request.id
    });
    invalidateAccessConfigCache();

    return { ok: true, data: { written: true, revokedAt, gate } };
  });
}
