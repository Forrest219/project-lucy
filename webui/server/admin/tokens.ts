import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance } from "fastify";
import { auditedWriteFile } from "./config-audit-write.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import type { YamlAccessConfig } from "./agents.js";
import {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  type AccessGovernanceApprover,
  type AccessGovernanceGateDecision,
  type AccessGovernanceOverrideRequest
} from "../access-governance-gate.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";

function hashToken(token: string): string {
  return "sha256:" + createHash("sha256").update(token).digest("hex");
}

function defaultActor(): AccessGovernanceApprover {
  return { actorKind: "admin", actorId: "local-admin" };
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
  // POST /api/admin/agents/:userId/tokens
  app.post<{
    Params: { userId: string };
    Body: { dryRun?: boolean; label: string; expires_at?: string | null; override?: AccessGovernanceOverrideRequest };
  }>("/api/admin/agents/:userId/tokens", async (request, reply) => {
    const { userId } = request.params;
    const { label, expires_at } = request.body ?? {};
    const dryRun = request.body?.dryRun === true;

    if (!label || typeof label !== "string" || label.trim().length === 0) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "label is required" } });
    }

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
            expires_at: expires_at ?? null
          }
        }
      };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
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
        await writeGateTrace(gate, override, request.body?.override, defaultActor());
        return reply.status(409).send({
          ok: false,
          error: {
            code: "GOVERNANCE_GATE_OVERRIDE_REQUIRED",
            message: `Override required: ${override.reason ?? "missing override fields"}`,
            detail: { gate, override }
          }
        });
      }
      await writeGateTrace(gate, override, request.body?.override, defaultActor());
    } else {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
    }

    // Generate token — plaintext never written anywhere except the HTTP response
    const plainToken = randomBytes(32).toString("hex");
    const tokenHash = hashToken(plainToken);
    const created = new Date().toISOString().slice(0, 10);

    const newToken = {
      hash: tokenHash,
      label,
      created,
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
      source: "admin_tokens_api",
      targetId: userId,
      oldSummary: { tokenCount: user.tokens.length },
      newSummary: { tokenCount: updatedUser.tokens.length, label, hashPrefix: tokenHash.slice(0, 19), expires_at: expires_at ?? null },
      requestId: request.id
    });

    return {
      ok: true,
      data: {
        token: plainToken,
        hash: tokenHash,
        label,
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
      await writeGateTrace(gate, undefined, undefined, defaultActor());
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
        await writeGateTrace(gate, override, request.body?.override, defaultActor());
        return reply.status(409).send({
          ok: false,
          error: {
            code: "GOVERNANCE_GATE_OVERRIDE_REQUIRED",
            message: `Override required: ${override.reason ?? "missing override fields"}`,
            detail: { gate, override }
          }
        });
      }
      await writeGateTrace(gate, override, request.body?.override, defaultActor());
    } else {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
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
      source: "admin_tokens_api",
      targetId: userId,
      oldSummary: { tokenCount: user.tokens.length, label, hashPrefix: token.hash.slice(0, 19) },
      newSummary: { tokenCount: updatedUser.tokens.length, label },
      requestId: request.id
    });

    return { ok: true, data: { written: true, revokedAt, gate } };
  });
}
