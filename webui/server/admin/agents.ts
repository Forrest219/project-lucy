import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance } from "fastify";
import { safeWrite } from "../fs-safe.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb, recordConfigChange } from "./audit.js";
import { previewRolePermissionsForAdmin, resolveEffectivePermissionsForAdmin, type EffectivePermissions } from "../proxy/acl.js";
import { expandTemplate, ROLE_TEMPLATES } from "./role-templates.js";
import {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  type AccessGovernanceApprover,
  type AccessGovernanceGateDecision,
  type AccessGovernanceOverrideRequest
} from "../access-governance-gate.js";

const ACCESS_YAML_REL = "webui/config/access.yaml";
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
}

export interface YamlUser {
  id: string;
  name: string;
  note?: string;
  enabled?: boolean;
  role?: string;
  tokens: YamlToken[];
  allow?: {
    tables: string[];
    tools: string[];
    connections?: string[];
  };
}

export interface YamlRole {
  description?: string;
  allow?: {
    connections?: string[];
    tableSelectors?: Array<
      | { connection?: string; schema: string; names: string[] }
      | { connection?: string; schema: string; prefix: string }
    >;
    tools?: string[];
  };
}

export interface YamlAccessConfig {
  roles?: Record<string, YamlRole>;
  users: YamlUser[];
  defaults?: {
    deny_tools?: string[];
    known_tools?: string[];
    table_touching_tools?: string[];
    sensitive_metadata_tools?: string[];
    sensitive_table_prefixes?: string[];
  };
}

async function readAccessYaml(projectRoot: string): Promise<{ config: YamlAccessConfig; raw: string; version: string }> {
  const filePath = path.join(projectRoot, ACCESS_YAML_REL);
  const raw = await readFile(filePath, "utf-8");
  const s = await stat(filePath);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const version = `${s.mtimeMs.toFixed(0)}-${hash}`;
  const config = parse(raw) as YamlAccessConfig;
  if (!config.users) config.users = [];
  return { config, raw, version };
}

async function writeAccessYaml(projectRoot: string, config: YamlAccessConfig): Promise<void> {
  // Strip derived last_used before writing
  const toWrite: YamlAccessConfig = {
    ...config,
    users: config.users.map((u) => ({
      ...u,
      tokens: u.tokens.map(({ ...t }) => {
        // last_used is never in yaml
        return t;
      })
    }))
  };
  const content = stringify(toWrite, { lineWidth: 0 });
  await safeWrite(projectRoot, ACCESS_YAML_REL, content);
}

function computeVersion(raw: string, mtimeMs: number): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${mtimeMs.toFixed(0)}-${hash}`;
}

export interface AgentStatsSummary {
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;
  /** Number of distinct `token_hash_prefix` values that appear in
   * `access_log` for this user inside the last 7 days. Excludes rows
   * where `token_hash_prefix` is null (uncorrelated protocol traffic). */
  activeTokensLast7d: number;
  /** Number of token rows still present in `access.yaml` (configured
   * regardless of expiry). */
  configuredTokens: number;
  topTables: Array<{ table: string; calls: number }>;
}

async function getStats(userId: string, configuredTokenCount: number): Promise<AgentStatsSummary> {
  try {
    const db = await getAuditDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS calls7, SUM(CASE WHEN outcome='denied' THEN 1 ELSE 0 END) AS denied7, MAX(ts) AS last_seen
         FROM access_log WHERE user_id = ? AND ts >= datetime('now','-7 days')`
      )
      .get(userId) as { calls7: number; denied7: number; last_seen: string | null } | undefined;

    // `token_hash_prefix` IS NOT NULL keeps uncorrelated protocol traffic
    // (e.g. tools/list without a token) out of the active-token denominator.
    // `idx_al_user_token_ts` covers (user_id, token_hash_prefix, ts).
    const activeTokensRow = db
      .prepare(
        `SELECT COUNT(DISTINCT token_hash_prefix) AS active_tokens
         FROM access_log
         WHERE user_id = ? AND token_hash_prefix IS NOT NULL
           AND ts >= datetime('now','-7 days')`
      )
      .get(userId) as { active_tokens: number | null } | undefined;

    const topRows = db
      .prepare(
        `SELECT tables, COUNT(*) AS cnt FROM access_log
         WHERE user_id = ? AND ts >= datetime('now','-7 days') AND tables IS NOT NULL
         GROUP BY tables ORDER BY cnt DESC LIMIT 10`
      )
      .all(userId) as Array<{ tables: string; cnt: number }>;

    // Parse table JSON arrays and aggregate
    const tableCounts = new Map<string, number>();
    for (const r of topRows) {
      try {
        const parsed = JSON.parse(r.tables) as string[];
        for (const t of parsed) {
          tableCounts.set(t, (tableCounts.get(t) ?? 0) + r.cnt);
        }
      } catch {
        // skip
      }
    }
    const topTables = [...tableCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([table, calls]) => ({ table, calls }));

    return {
      callsLast7d: row?.calls7 ?? 0,
      deniedLast7d: row?.denied7 ?? 0,
      lastSeen: row?.last_seen ?? undefined,
      activeTokensLast7d: activeTokensRow?.active_tokens ?? 0,
      configuredTokens: configuredTokenCount,
      topTables
    };
  } catch {
    return { callsLast7d: 0, deniedLast7d: 0, activeTokensLast7d: 0, configuredTokens: configuredTokenCount, topTables: [] };
  }
}

async function getLastUsedMap(
  userIds: string[]
): Promise<Map<string, Map<string, { lastUsed: string; lastTool: string; lastOutcome: string }>>> {
  // Returns: userId -> (token hash prefix -> last usage snapshot)
  const result = new Map<string, Map<string, { lastUsed: string; lastTool: string; lastOutcome: string }>>();
  if (userIds.length === 0) return result;
  try {
    const db = await getAuditDb();
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, ts, tool, outcome
         FROM (
           SELECT
             user_id,
             token_hash_prefix,
             ts,
             tool,
             outcome,
             ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC) AS rn
           FROM access_log
           WHERE user_id IN (${placeholders}) AND token_hash_prefix IS NOT NULL
         )
         WHERE rn = 1`
      )
      .all(...userIds) as Array<{ user_id: string; token_hash_prefix: string; ts: string; tool: string; outcome: string }>;

    for (const row of rows) {
      if (!result.has(row.user_id)) result.set(row.user_id, new Map());
      const byToken = result.get(row.user_id);
      if (!byToken || byToken.has(row.token_hash_prefix)) continue;
      byToken.set(row.token_hash_prefix, {
        lastUsed: row.ts,
        lastTool: row.tool,
        lastOutcome: row.outcome
      });
    }
  } catch {
    return result;
  }
  return result;
}

function userToAgent(
  user: YamlUser,
  stats?: Awaited<ReturnType<typeof getStats>>,
  tokenUsage?: Map<string, { lastUsed: string; lastTool: string; lastOutcome: string }>
) {
  return {
    id: user.id,
    name: user.name,
    note: user.note,
    enabled: user.enabled !== false,
    role: user.role,
    tokens: user.tokens.map((t) => ({
      hash: t.hash,
      label: t.label,
      created: t.created,
      expires_at: t.expires_at ?? null,
      last_used: tokenUsage?.get(t.hash.slice(0, 19))?.lastUsed,
      last_tool: tokenUsage?.get(t.hash.slice(0, 19))?.lastTool,
      last_outcome: tokenUsage?.get(t.hash.slice(0, 19))?.lastOutcome
    })),
    allow: user.allow ? {
      tables: user.allow?.tables ?? [],
      tools: user.allow?.tools ?? [],
      connections: user.allow?.connections ?? []
    } : undefined,
    stats
  };
}

function effectivePermissionsToPreview(permissions: EffectivePermissions) {
  return {
    roleIds: permissions.roleIds,
    snapshotHash: permissions.snapshotHash,
    sourceMapVersion: permissions.sourceMapVersion,
    tools: permissions.tools,
    connections: permissions.connections,
    sources: permissions.sources,
    legacyAllow: permissions.legacyAllow
  };
}

/**
 * Resolved source names for a given Agent record, used to feed the
 * Access Governance Gate. Returns `[]` when the role can't be resolved
 * (the caller treats this as "no permission expansion" — the durable
 * write path will fail anyway with `INVALID_ROLE` upstream).
 *
 * For *candidate* users that don't yet exist in `access.yaml` (Agent
 * create / patch with a new template role), callers can pass role overrides
 * from the proposed YAML so Gate classification sees the same Role body that
 * the durable write will persist.
 */
async function resolveAgentSources(
  user: { id: string; role?: string; allow?: unknown },
  roleOverrides: Record<string, YamlRole> | undefined
): Promise<{
  sources: string[];
  snapshotHash: string | null;
}> {
  // Legacy `allow` fallback: don't go through the resolver.
  if (user.allow && !user.role) {
    const allow = user.allow as { tables?: string[] };
    const sources = Array.isArray(allow.tables) ? allow.tables : [];
    return { sources, snapshotHash: null };
  }
  if (!user.role) {
    return { sources: [], snapshotHash: null };
  }
  const previewRole = roleOverrides?.[user.role];
  const preview = await previewRolePermissionsForAdmin(user.role, previewRole ? { role: previewRole } : {});
  if (!preview.ok) return { sources: [], snapshotHash: null };
  return {
    sources: preview.permissions.sources.map((source) => source.table),
    snapshotHash: preview.permissions.snapshotHash
  };
}

interface BuildAgentGateInputArgs {
  targetKind: "agent" | "token";
  targetId?: string | null;
  oldUser: { id: string; role?: string; allow?: unknown };
  newUser: { id: string; role?: string; allow?: unknown };
  oldRoleOverrides?: Record<string, YamlRole>;
  newRoleOverrides?: Record<string, YamlRole>;
  /** Optional recent call count for high-traffic classification. */
  callsLast7d?: number;
  /** Tools added by the change (used for raw-query path P0 rule). */
  addedTools?: string[];
}

async function buildAgentGateInput(args: BuildAgentGateInputArgs) {
  const [before, after] = await Promise.all([
    resolveAgentSources(args.oldUser, args.oldRoleOverrides),
    resolveAgentSources(args.newUser, args.newRoleOverrides)
  ]);
  return {
    targetKind: args.targetKind,
    targetId: args.targetId ?? null,
    oldValue: args.oldUser,
    newValue: args.newUser,
    oldSources: before.sources,
    newSources: after.sources,
    oldSnapshotHash: before.snapshotHash,
    newSnapshotHash: after.snapshotHash,
    addedTools: args.addedTools ?? [],
    highTrafficCalls7d: args.callsLast7d ?? 0
  };
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
    // Hot store failure must never break MCP / admin traffic, but it must be
    // visible because a governance write without evidence is an audit gap.
    console.error("[lucy-admin] failed to write access governance gate trace", {
      targetKind: decision.targetKind,
      targetId: decision.targetId ?? null,
      traceId: decision.traceId,
      decision: decision.decision,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function defaultActor(): AccessGovernanceApprover {
  // local-admin is the deployment-local identity, never an enterprise
  // personal identity (per `webui/docs/64-tiered-publish-gate-spec.md` §7).
  return { actorKind: "admin", actorId: "local-admin" };
}

/**
 * Build a denormalized summary of agent counts and recent usage so the
 * front-end can render aggregate metrics without re-aggregating per row.
 * `activeTokenCountLast7d` deliberately uses the per-agent max:
 * if one token in YAML is shared across two user rows (legacy state) we
 * still surface the truthful total of distinct recently-active tokens,
 * computed per `user_id` (count-DISTINCT scoped to the agent row).
 * `activeTokenCountLast7d` is summed per agent because each agent row
 * represents a distinct user_id boundary, and the access_log active-token
 * query is already `WHERE user_id = ?` scoped.
 */
function buildAgentsSummary(
  agents: Array<Awaited<ReturnType<typeof userToAgentWithPermissions>>>
): {
  agentCount: number;
  enabledAgentCount: number;
  configuredTokenCount: number;
  activeTokenCountLast7d: number;
  callsLast7d: number;
  deniedLast7d: number;
} {
  let enabledAgentCount = 0;
  let configuredTokenCount = 0;
  let activeTokenCountLast7d = 0;
  let callsLast7d = 0;
  let deniedLast7d = 0;
  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    configuredTokenCount += agent.tokens.length;
    activeTokenCountLast7d += agent.stats?.activeTokensLast7d ?? 0;
    callsLast7d += agent.stats?.callsLast7d ?? 0;
    deniedLast7d += agent.stats?.deniedLast7d ?? 0;
  }
  return {
    agentCount: agents.length,
    enabledAgentCount,
    configuredTokenCount,
    activeTokenCountLast7d,
    callsLast7d,
    deniedLast7d
  };
}

async function userToAgentWithPermissions(
  user: YamlUser,
  stats?: Awaited<ReturnType<typeof getStats>>,
  tokenUsage?: Map<string, { lastUsed: string; lastTool: string; lastOutcome: string }>
) {
  const agent = userToAgent(user, stats, tokenUsage);
  const resolved = await resolveEffectivePermissionsForAdmin(user.id);
  return {
    ...agent,
    effectivePermissions: resolved.ok ? effectivePermissionsToPreview(resolved.permissions) : undefined,
    permissionWarnings: resolved.ok ? [] : [resolved.reason]
  };
}

function bodyHasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function hasWildcardAllow(user: YamlUser): boolean {
  return Boolean(user.allow?.tables?.includes("*") || user.allow?.tools?.includes("*"));
}

function assertRoleExists(config: YamlAccessConfig, role: string | undefined): role is string {
  return Boolean(role && config.roles?.[role]?.allow);
}

function roleForInput(config: YamlAccessConfig, role: string | undefined): { id: string; role: YamlRole; source: "yaml" | "template" } | undefined {
  if (!role) return undefined;
  const yamlRole = config.roles?.[role];
  if (yamlRole?.allow) return { id: role, role: yamlRole, source: "yaml" };
  const templateRole = expandTemplate(role);
  if (templateRole?.allow) return { id: role, role: templateRole, source: "template" };
  return undefined;
}

async function validateRoleForWrite(roleId: string, role: YamlRole): Promise<string | undefined> {
  const resolved = await previewRolePermissionsForAdmin(roleId, { role });
  return resolved.ok ? undefined : resolved.reason;
}

function makeDiff(oldYaml: string, newYaml: string): string {
  const oldLines = oldYaml.split("\n");
  const newLines = newYaml.split("\n");
  const lines: string[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];
    if (o === undefined) {
      lines.push(`+${n}`);
    } else if (n === undefined) {
      lines.push(`-${o}`);
    } else if (o !== n) {
      lines.push(`-${o}`);
      lines.push(`+${n}`);
    } else {
      lines.push(` ${o}`);
    }
  }
  return lines.join("\n");
}

export function registerAgentRoutes(app: FastifyInstance) {
  // GET /api/admin/agents
  app.get("/api/admin/agents", async () => {
    const projectRoot = await resolveProjectRoot();
    const { config, version } = await readAccessYaml(projectRoot);
    const tokenUsage = await getLastUsedMap(config.users.map((user) => user.id));
    const agents = await Promise.all(
      config.users.map(async (user) => {
        const stats = await getStats(user.id, user.tokens.length);
        return userToAgentWithPermissions(user, stats, tokenUsage.get(user.id));
      })
    );
    const summary = buildAgentsSummary(agents);
    return { ok: true, data: { agents, version, summary } };
  });

  // GET /api/admin/roles — moved to ./roles.ts (M12)

  // POST /api/admin/agents
  app.post<{
    Body: {
      dryRun?: boolean;
      override?: AccessGovernanceOverrideRequest;
      agent: { id: string; name: string; note?: string; role?: string; allow?: unknown }
    };
  }>("/api/admin/agents", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const agentInput = request.body?.agent;
    if (!agentInput || !agentInput.id || !agentInput.name) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "agent.id and agent.name are required" } });
    }
    if (!AGENT_ID_RE.test(agentInput.id)) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "agent.id must match ^[A-Za-z0-9_-]{1,32}$" } });
    }
    if (bodyHasOwn(agentInput, "allow")) {
      return reply.status(400).send({ ok: false, error: { code: "LEGACY_ALLOW_READONLY", message: "agent.allow is deprecated and read-only; choose a role" } });
    }
    const projectRoot = await resolveProjectRoot();
    const { config, raw } = await readAccessYaml(projectRoot);
    const resolvedRole = roleForInput(config, agentInput.role);
    if (!resolvedRole) {
      return reply.status(400).send({ ok: false, error: { code: agentInput.role ? "INVALID_ROLE" : "ROLE_REQUIRED", message: "agent.role is required and must reference an existing role" } });
    }
    const invalidReason = await validateRoleForWrite(resolvedRole.id, resolvedRole.role);
    if (invalidReason) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: `Role '${resolvedRole.id}' is invalid: ${invalidReason}` } });
    }

    if (config.users.some((u) => u.id === agentInput.id)) {
      return reply.status(409).send({ ok: false, error: { code: "AGENT_ID_TAKEN", message: `Agent id '${agentInput.id}' already exists` } });
    }

    const newUser: YamlUser = {
      id: agentInput.id,
      name: agentInput.name,
      note: agentInput.note,
      enabled: true,
      tokens: [],
      role: resolvedRole.id
    };
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: resolvedRole.source === "template"
        ? {
            ...(config.roles ?? {}),
            [resolvedRole.id]: resolvedRole.role
          }
        : config.roles,
      users: [...config.users, newUser]
    };
    const proposedYaml = stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    // Access Governance Gate — Tiered Access Governance Gate (P1 / 64).
    const gateInput = await buildAgentGateInput({
      targetKind: "agent",
      targetId: newUser.id,
      oldUser: { id: newUser.id, role: undefined, allow: undefined },
      newUser,
      newRoleOverrides: newConfig.roles
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, gate } };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this Agent create",
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

    await recordConfigChange({
      filePath: ACCESS_YAML_REL,
      changeType: "agent_create",
      targetId: newUser.id,
      oldSummary: { userIds: config.users.map((user) => user.id) },
      newSummary: { userIds: newConfig.users.map((user) => user.id), role: newUser.role },
      diff
    });
    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true, gate, agent: await userToAgentWithPermissions(newUser) } };
  });

  // GET /api/admin/agents/:userId
  app.get<{ Params: { userId: string } }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config, version } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }
    const stats = await getStats(user.id, user.tokens.length);
    const tokenUsage = await getLastUsedMap([user.id]);
    return { ok: true, data: { agent: await userToAgentWithPermissions(user, stats, tokenUsage.get(user.id)), version } };
  });

  // GET /api/admin/agents/:userId/effective-permissions
  app.get<{ Params: { userId: string } }>("/api/admin/agents/:userId/effective-permissions", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config } = await readAccessYaml(projectRoot);
    if (!config.users.some((user) => user.id === request.params.userId)) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }
    const resolved = await resolveEffectivePermissionsForAdmin(request.params.userId);
    if (!resolved.ok) {
      return reply.status(400).send({ ok: false, error: { code: "ROLE_RESOLUTION_FAILED", message: resolved.reason } });
    }
    return { ok: true, data: effectivePermissionsToPreview(resolved.permissions) };
  });

  // PATCH /api/admin/agents/:userId
  app.patch<{
    Params: { userId: string };
    Body: {
      dryRun?: boolean;
      version?: string;
      override?: AccessGovernanceOverrideRequest;
      patch: { name?: string; note?: string; enabled?: boolean; role?: string; allow?: unknown; tokens?: unknown; id?: unknown };
    };
  }>("/api/admin/agents/:userId", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const s = await stat(filePath);
    const currentVersion = computeVersion(raw, s.mtimeMs);

    if (request.body?.version && request.body.version !== currentVersion) {
      return reply.status(409).send({ ok: false, error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" } });
    }

    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];
    const existingRoles = config.roles;
    const userIndex = config.users.findIndex((u) => u.id === request.params.userId);
    if (userIndex === -1) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }

    const patch = request.body?.patch ?? {};
    for (const forbidden of ["allow", "tokens", "id"]) {
      if (bodyHasOwn(patch, forbidden)) {
        return reply.status(400).send({ ok: false, error: { code: forbidden === "allow" ? "LEGACY_ALLOW_READONLY" : "BAD_REQUEST", message: `patch.${forbidden} is not editable` } });
      }
    }
    const existingUser = config.users[userIndex];
    if (patch.role !== undefined) {
      const resolvedRole = roleForInput(config, patch.role);
      if (!resolvedRole) {
        return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: `Role '${patch.role}' does not exist or is invalid` } });
      }
      const invalidReason = await validateRoleForWrite(resolvedRole.id, resolvedRole.role);
      if (invalidReason) {
        return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: `Role '${resolvedRole.id}' is invalid: ${invalidReason}` } });
      }
      if (resolvedRole.source === "template") {
        config.roles = {
          ...(config.roles ?? {}),
          [resolvedRole.id]: resolvedRole.role
        };
      }
    }
    if (patch.role !== undefined && !assertRoleExists(config, patch.role)) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: `Role '${patch.role}' does not exist or is invalid` } });
    }
    const nextRole = patch.role !== undefined ? patch.role : existingUser.role;
    const enabling = patch.enabled === true && existingUser.enabled === false;
    if (enabling && !nextRole && hasWildcardAllow(existingUser)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LEGACY_WILDCARD_AGENT_REQUIRES_ROLE", message: "Assign a role before re-enabling a legacy wildcard agent" }
      });
    }
    const updatedUser: YamlUser = {
      ...existingUser,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {})
    };
    if (updatedUser.role) delete updatedUser.allow;
    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const proposedYaml = stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    // Access Governance Gate — Tiered Access Governance Gate (P1 / 64).
    const stats = await getStats(existingUser.id, existingUser.tokens.length);
    const gateInput = await buildAgentGateInput({
      targetKind: "agent",
      targetId: updatedUser.id,
      oldUser: existingUser,
      newUser: updatedUser,
      oldRoleOverrides: existingRoles,
      newRoleOverrides: newConfig.roles,
      callsLast7d: stats.callsLast7d
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, gate } };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this Agent patch",
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

    await recordConfigChange({
      filePath: ACCESS_YAML_REL,
      changeType: "agent_patch",
      targetId: updatedUser.id,
      oldSummary: { enabled: existingUser.enabled !== false, role: existingUser.role, hasLegacyAllow: Boolean(existingUser.allow) },
      newSummary: { enabled: updatedUser.enabled !== false, role: updatedUser.role, hasLegacyAllow: Boolean(updatedUser.allow) },
      diff
    });
    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true, gate, agent: await userToAgentWithPermissions(updatedUser) } };
  });

  // DELETE /api/admin/agents/:userId
  app.delete<{
    Params: { userId: string };
    Body?: { override?: AccessGovernanceOverrideRequest };
  }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }

    // Access Governance Gate — Agent deletion. Removing a high-traffic Agent
    // or a Role-binding is a P2 cleanup that should be evidence-recorded.
    const stats = await getStats(user.id, user.tokens.length);
    const gateInput = await buildAgentGateInput({
      targetKind: "agent",
      targetId: user.id,
      oldUser: user,
      newUser: { id: user.id, role: undefined, allow: undefined },
      callsLast7d: stats.callsLast7d
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor());
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this Agent delete",
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

    // Revoke all tokens in sqlite — must succeed before yaml is updated
    const db = await getAuditDb();
    const revokedAt = new Date().toISOString();
    for (const token of user.tokens) {
      db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
        token.hash, revokedAt, "agent_deleted"
      );
    }

    const newConfig: YamlAccessConfig = { ...config, users: config.users.filter((u) => u.id !== request.params.userId) };
    await recordConfigChange({
      filePath: ACCESS_YAML_REL,
      changeType: "agent_delete",
      targetId: user.id,
      oldSummary: { userIds: config.users.map((item) => item.id), tokenCount: user.tokens.length },
      newSummary: { userIds: newConfig.users.map((item) => item.id) }
    });
    await writeAccessYaml(projectRoot, newConfig);
    return { ok: true, data: { written: true, gate } };
  });
}
