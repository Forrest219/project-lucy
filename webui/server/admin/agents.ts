import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { stringify, parse } from "yaml";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { auditedWriteFile } from "./config-audit-write.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import { expandTemplate, ROLE_TEMPLATES } from "./role-templates.js";
import {
  expandSelectorSourceNames,
  normalizePermissionModelVersion,
  previewAgentPermissionsForAdmin,
  previewRolePermissionsForAdmin,
  resolveEffectivePermissionsForAdmin,
  type EffectivePermissions
} from "../proxy/acl.js";
import {
  constraintsSourceKey,
  lookupFinalRows,
  parseAgentConstraintsShape
} from "../proxy/agent-constraints.js";
import type { AccessConfig } from "../proxy/identity.js";
import type { RowGrant, ResolvedRowPolicyPredicate } from "../proxy/row-policy.js";
import {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  type AccessGovernanceApprover,
  type AccessGovernanceGateDecision,
  type AccessGovernanceOverrideRequest
} from "../access-governance-gate.js";
import { invalidateAccessConfigCache } from "../proxy/identity.js";
import { actorIdFromRequest } from "../auth/guard.js";

/** Persist template Roles as generation 2 (Spec 98 §7) when Agent Admin materializes them. */
async function materializeTemplateRoleForWrite(roleId: string, role: YamlRole): Promise<
  { ok: true; role: YamlRole } | { ok: false; reason: string }
> {
  const before = normalizePermissionModelVersion(role);
  if (!before.ok) return { ok: false, reason: "role.permission_model_version must be 1 or 2" };
  const selectors = role.allow?.tableSelectors;
  const nextSelectors: NonNullable<YamlRole["allow"]>["tableSelectors"] = [];
  if (selectors) {
    for (const selector of selectors) {
      if (selector.row_access === "scoped") {
        return { ok: false, reason: "table selector row_access 'scoped' is not supported in AC-P0" };
      }
      if ("prefix" in selector && selector.prefix !== undefined) {
        const names = await expandSelectorSourceNames(selector);
        if (names.length === 0) {
          return { ok: false, reason: `table selector prefix '${selector.prefix}' expands to 0 source` };
        }
        nextSelectors.push({ connection: selector.connection, schema: selector.schema, names, row_access: "all" });
        continue;
      }
      nextSelectors.push({ ...selector, row_access: "all" });
    }
  }
  const migrated: YamlRole = {
    ...role,
    permission_model_version: 2,
    allow: role.allow ? { ...role.allow, tableSelectors: selectors ? nextSelectors : role.allow.tableSelectors } : role.allow
  };
  const resolved = await previewRolePermissionsForAdmin(roleId, { role: migrated });
  if (!resolved.ok) return { ok: false, reason: resolved.reason };
  return { ok: true, role: migrated };
}

const ACCESS_YAML_REL = "webui/config/access.yaml";
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
  device_name?: string | null;
}

export interface YamlUser {
  id: string;
  name: string;
  note?: string;
  enabled?: boolean;
  role?: string;
  roles?: string[];
  tokens: YamlToken[];
  allow?: {
    tables: string[];
    tools: string[];
    connections?: string[];
  };
  /** Spec 100 Agent Constraints; validated at EffectivePolicy compile. */
  constraints?: unknown;
}

export interface YamlRole {
  description?: string;
  permission_model_version?: 1 | 2;
  allow?: {
    connections?: string[];
    tableSelectors?: Array<
      | { connection?: string; schema: string; names: string[]; row_access?: "all" | "scoped" }
      | { connection?: string; schema: string; prefix: string; row_access?: "all" | "scoped" }
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

async function writeAccessYaml(
  projectRoot: string,
  config: YamlAccessConfig,
  audit?: {
    enabled: boolean;
    changeType: string;
    targetId?: string;
    oldSummary?: unknown;
    newSummary?: unknown;
    diff?: string;
    requestId?: string;
    source?: string;
  }
): Promise<{ auditId?: number; policyVersion: string; runtimeAck: boolean }> {
  const accessPath = path.join(projectRoot, ACCESS_YAML_REL);
  let previousRaw: string | undefined;
  try {
    previousRaw = await readFile(accessPath, "utf-8");
  } catch {
    previousRaw = undefined;
  }

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
  const {
    commitEffectivePolicy,
    computeAccessConfigDigest,
    evaluateRuntimeAck
  } = await import("../proxy/acl.js");
  const expectedDigest = computeAccessConfigDigest(parse(content) as Parameters<typeof computeAccessConfigDigest>[0]);

  const writeResult = await auditedWriteFile(projectRoot, ACCESS_YAML_REL, content, audit ? {
    enabled: true,
    changeType: audit.changeType,
    assetKind: "governance",
    actorType: "ui_admin",
    source: audit.source ?? "admin_agents_api",
    targetId: audit.targetId,
    oldSummary: audit.oldSummary,
    newSummary: audit.newSummary,
    diff: audit.diff,
    requestId: audit.requestId
  } : undefined);

  let status = await commitEffectivePolicy();
  let runtimeAck = evaluateRuntimeAck(status, expectedDigest);

  if (!runtimeAck && previousRaw !== undefined) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(accessPath, previousRaw, "utf8");
    status = await commitEffectivePolicy();
    runtimeAck = false;
  }

  return {
    ...writeResult,
    policyVersion: status.policyVersion,
    runtimeAck
  };
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

interface AgentConfigTimeline {
  createdAt?: string;
  configUpdatedAt?: string;
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

type TokenUsageSnapshot = {
  lastUsed: string;
  lastTool: string;
  lastOutcome: string;
  lastIp?: string | null;
  lastUserAgent?: string | null;
  lastClient?: string | null;
  lastClientVersion?: string | null;
  lastDeviceNameSeen?: string | null;
  distinctIps7d?: number;
};

async function getLastUsedMap(
  userIds: string[]
): Promise<Map<string, Map<string, TokenUsageSnapshot>>> {
  // Returns: userId -> (token hash prefix -> last usage snapshot)
  const result = new Map<string, Map<string, TokenUsageSnapshot>>();
  if (userIds.length === 0) return result;
  try {
    const db = await getAuditDb();
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, ts, tool, outcome, client_ip, user_agent, client, client_version, device_name
         FROM (
           SELECT
             user_id,
             token_hash_prefix,
             ts,
             tool,
             outcome,
             client_ip,
             user_agent,
             client,
             client_version,
             device_name,
             ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC) AS rn
           FROM access_log
           WHERE user_id IN (${placeholders}) AND token_hash_prefix IS NOT NULL
         )
         WHERE rn = 1`
      )
      .all(...userIds) as Array<{
      user_id: string;
      token_hash_prefix: string;
      ts: string;
      tool: string;
      outcome: string;
      client_ip: string | null;
      user_agent: string | null;
      client: string | null;
      client_version: string | null;
      device_name: string | null;
    }>;

    for (const row of rows) {
      if (!result.has(row.user_id)) result.set(row.user_id, new Map());
      const byToken = result.get(row.user_id);
      if (!byToken || byToken.has(row.token_hash_prefix)) continue;
      byToken.set(row.token_hash_prefix, {
        lastUsed: row.ts,
        lastTool: row.tool,
        lastOutcome: row.outcome,
        lastIp: row.client_ip,
        lastUserAgent: row.user_agent,
        lastClient: row.client,
        lastClientVersion: row.client_version,
        lastDeviceNameSeen: row.device_name
      });
    }

    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const ipRows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, COUNT(DISTINCT client_ip) AS distinct_ips
         FROM access_log
         WHERE user_id IN (${placeholders})
           AND token_hash_prefix IS NOT NULL
           AND client_ip IS NOT NULL
           AND ts >= ?
         GROUP BY user_id, token_hash_prefix`
      )
      .all(...userIds, since7d) as Array<{
      user_id: string;
      token_hash_prefix: string;
      distinct_ips: number;
    }>;
    for (const row of ipRows) {
      const byToken = result.get(row.user_id);
      const snap = byToken?.get(row.token_hash_prefix);
      if (snap) snap.distinctIps7d = row.distinct_ips;
    }
  } catch {
    return result;
  }
  return result;
}

function userToAgent(
  user: YamlUser,
  stats?: Awaited<ReturnType<typeof getStats>>,
  tokenUsage?: Map<string, TokenUsageSnapshot>,
  timeline?: AgentConfigTimeline
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
      device_name: t.device_name ?? null,
      last_used: tokenUsage?.get(t.hash.slice(0, 19))?.lastUsed,
      last_tool: tokenUsage?.get(t.hash.slice(0, 19))?.lastTool,
      last_outcome: tokenUsage?.get(t.hash.slice(0, 19))?.lastOutcome,
      last_ip: tokenUsage?.get(t.hash.slice(0, 19))?.lastIp ?? null,
      last_user_agent: tokenUsage?.get(t.hash.slice(0, 19))?.lastUserAgent ?? null,
      last_client: tokenUsage?.get(t.hash.slice(0, 19))?.lastClient ?? null,
      last_client_version: tokenUsage?.get(t.hash.slice(0, 19))?.lastClientVersion ?? null,
      last_device_name_seen: tokenUsage?.get(t.hash.slice(0, 19))?.lastDeviceNameSeen ?? null,
      distinct_ips_7d: tokenUsage?.get(t.hash.slice(0, 19))?.distinctIps7d
    })),
    allow: user.allow ? {
      tables: user.allow?.tables ?? [],
      tools: user.allow?.tools ?? [],
      connections: user.allow?.connections ?? []
    } : undefined,
    // Spec 100 — expose Agent Constraints for Admin editor (Role path forbids this field).
    ...(user.constraints !== undefined ? { constraints: user.constraints } : {}),
    createdAt: timeline?.createdAt,
    configUpdatedAt: timeline?.configUpdatedAt,
    stats
  };
}

async function getAgentConfigTimelineMap(userIds: string[]): Promise<Map<string, AgentConfigTimeline>> {
  const result = new Map<string, AgentConfigTimeline>();
  if (userIds.length === 0) return result;
  try {
    const db = await getAuditDb();
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT
           target_id,
           MIN(CASE WHEN change_type = 'agent_create' THEN ts END) AS created_at,
           MAX(CASE
               WHEN change_type IN ('agent_create', 'agent_patch', 'token_create', 'token_revoke')
               THEN ts
               ELSE NULL
             END) AS config_updated_at
         FROM config_change_log
         WHERE target_id IN (${placeholders})
         GROUP BY target_id`
      )
      .all(...userIds) as Array<{
      target_id: string | null;
      created_at: string | null;
      config_updated_at: string | null;
    }>;
    for (const row of rows) {
      if (!row.target_id) continue;
      result.set(row.target_id, {
        createdAt: row.created_at ?? undefined,
        configUpdatedAt: row.config_updated_at ?? undefined
      });
    }
  } catch {
    return result;
  }
  return result;
}

function rowGrantToPreview(grant: RowGrant | undefined):
  | "all"
  | { kind: "scoped"; digest: string; predicates?: ResolvedRowPolicyPredicate[] } {
  if (!grant || grant.kind === "all") return "all";
  return {
    kind: "scoped",
    digest: grant.digest,
    predicates: grant.predicates
  };
}

function constraintsSummaryForSource(
  preds: ResolvedRowPolicyPredicate[] | undefined
): string | undefined {
  if (!preds || preds.length === 0) return undefined;
  return preds
    .slice(0, 3)
    .map((pred) => {
      if (pred.op === "eq") return `${pred.field}=${String(pred.value ?? "")}`;
      return `${pred.field} in [${(pred.values ?? []).map((item) => String(item)).join(",")}]`;
    })
    .join(" AND ") + (preds.length > 3 ? " …" : "");
}

function effectivePermissionsToPreview(permissions: EffectivePermissions) {
  return {
    roleIds: permissions.roleIds,
    snapshotHash: permissions.snapshotHash,
    sourceMapVersion: permissions.sourceMapVersion,
    tools: permissions.tools,
    connections: permissions.connections,
    sources: permissions.sources,
    legacyAllow: permissions.legacyAllow,
    capabilityDigest: permissions.capabilityDigest,
    capabilities: permissions.capabilities.map((capability) => {
      const finalRows = lookupFinalRows(
        permissions.finalRowsBySource,
        capability.connectionId,
        capability.sourceName,
        capability.rowGrant
      );
      const constraintKey = constraintsSourceKey(capability.connectionId, capability.sourceName);
      const constraintPreds = permissions.agentConstraintsBySource?.[constraintKey];
      return {
        tool: capability.tool,
        connectionId: capability.connectionId,
        schema: capability.schema,
        sourceName: capability.sourceName,
        physicalTable: capability.physicalTable,
        sourceKey: `${capability.connectionId}|${capability.schema}|${capability.sourceName}|${capability.physicalTable}`,
        // Spec 99 §8 — EffectiveRowGrant (Role OR); never fake "all" when scoped
        rowGrant: rowGrantToPreview(capability.rowGrant),
        // Spec 100 / Spec 14 §0.0a — FinalRows after Constraints AND
        finalRows: rowGrantToPreview(finalRows),
        protected: finalRows.kind === "scoped",
        constraintsSummary: constraintsSummaryForSource(constraintPreds)
      };
    })
  };
}

const CONSTRAINT_FAIL_CODES = new Set([
  "constraints_invalid_shape",
  "constraints_source_not_in_capability",
  "constraints_forbidden_on_role",
  "final_rows_limit_exceeded",
  "final_rows_unsatisfiable",
  "row_policy_field_unresolved",
  "row_policy_op_forbidden"
]);

function constraintsCompileError(reason: string): { code: string; message: string } {
  const code = CONSTRAINT_FAIL_CODES.has(reason)
    || reason.startsWith("row_policy_")
    || reason.startsWith("constraints_")
    || reason.startsWith("final_rows_")
    ? reason.split(":")[0] ?? reason
    : "CONSTRAINTS_COMPILE_FAILED";
  return { code, message: reason };
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

function defaultActor(request?: FastifyRequest): AccessGovernanceApprover {
  // Prefer the logged-in WebUI admin id; fall back to deployment-local
  // `local-admin` in open mode (per `webui/docs/64-tiered-publish-gate-spec.md` §7).
  return {
    actorKind: "admin",
    actorId: request ? actorIdFromRequest(request) : "local-admin",
    identityProvider: "webui-local"
  };
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
  activeAgentCountLast7d: number;
  configuredTokenCount: number;
  activeTokenCountLast7d: number;
  callsLast7d: number;
  deniedLast7d: number;
} {
  let enabledAgentCount = 0;
  let activeAgentCountLast7d = 0;
  let configuredTokenCount = 0;
  let activeTokenCountLast7d = 0;
  let callsLast7d = 0;
  let deniedLast7d = 0;
  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    if ((agent.stats?.callsLast7d ?? 0) > 0) activeAgentCountLast7d += 1;
    configuredTokenCount += agent.tokens.length;
    activeTokenCountLast7d += agent.stats?.activeTokensLast7d ?? 0;
    callsLast7d += agent.stats?.callsLast7d ?? 0;
    deniedLast7d += agent.stats?.deniedLast7d ?? 0;
  }
  return {
    agentCount: agents.length,
    enabledAgentCount,
    activeAgentCountLast7d,
    configuredTokenCount,
    activeTokenCountLast7d,
    callsLast7d,
    deniedLast7d
  };
}

async function userToAgentWithPermissions(
  user: YamlUser,
  stats?: Awaited<ReturnType<typeof getStats>>,
  tokenUsage?: Map<string, TokenUsageSnapshot>,
  timeline?: AgentConfigTimeline
) {
  const agent = userToAgent(user, stats, tokenUsage, timeline);
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
    const userIds = config.users.map((user) => user.id);
    const [tokenUsage, timelineMap] = await Promise.all([
      getLastUsedMap(userIds),
      getAgentConfigTimelineMap(userIds)
    ]);
    const agents = await Promise.all(
      config.users.map(async (user) => {
        const stats = await getStats(user.id, user.tokens.length);
        return userToAgentWithPermissions(user, stats, tokenUsage.get(user.id), timelineMap.get(user.id));
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
    let rolesForWrite = config.roles;
    if (resolvedRole.source === "template") {
      const materialized = await materializeTemplateRoleForWrite(resolvedRole.id, resolvedRole.role);
      if (!materialized.ok) {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_ROLE", message: `Role '${resolvedRole.id}' is invalid: ${materialized.reason}` }
        });
      }
      rolesForWrite = {
        ...(config.roles ?? {}),
        [resolvedRole.id]: materialized.role
      };
    }
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: rolesForWrite,
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
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
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

    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "agent_create",
      targetId: newUser.id,
      oldSummary: { userIds: config.users.map((user) => user.id) },
      newSummary: { userIds: newConfig.users.map((user) => user.id), role: newUser.role },
      diff,
      requestId: request.id
    });
    return {
      ok: true,
      data: {
        written: true,
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck,
        gate,
        agent: await userToAgentWithPermissions(newUser)
      }
    };
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
    const [tokenUsage, timelineMap] = await Promise.all([
      getLastUsedMap([user.id]),
      getAgentConfigTimelineMap([user.id])
    ]);
    return {
      ok: true,
      data: { agent: await userToAgentWithPermissions(user, stats, tokenUsage.get(user.id), timelineMap.get(user.id)), version }
    };
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
      patch: {
        name?: string;
        note?: string;
        enabled?: boolean;
        role?: string;
        allow?: unknown;
        tokens?: unknown;
        id?: unknown;
        /** Spec 100 — set Agent Constraints; `null` clears the key. */
        constraints?: unknown;
      };
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
        const materialized = await materializeTemplateRoleForWrite(resolvedRole.id, resolvedRole.role);
        if (!materialized.ok) {
          return reply.status(400).send({
            ok: false,
            error: { code: "INVALID_ROLE", message: `Role '${resolvedRole.id}' is invalid: ${materialized.reason}` }
          });
        }
        config.roles = {
          ...(config.roles ?? {}),
          [resolvedRole.id]: materialized.role
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

    const patchHasConstraints = bodyHasOwn(patch, "constraints");
    if (patchHasConstraints) {
      if (patch.constraints === null) {
        delete updatedUser.constraints;
      } else {
        const shape = parseAgentConstraintsShape(patch.constraints);
        if (!shape.ok) {
          const err = constraintsCompileError(shape.reason);
          return reply.status(400).send({ ok: false, error: err });
        }
        updatedUser.constraints = patch.constraints;
      }
    }

    const newUsers = [...config.users];
    newUsers[userIndex] = updatedUser;
    const newConfig: YamlAccessConfig = { ...config, users: newUsers };
    const proposedYaml = stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    // Spec 100 §10 — illegal / unsatisfiable / over-limit constraints must fail before write.
    let proposedEffectivePermissions: ReturnType<typeof effectivePermissionsToPreview> | undefined;
    if (patchHasConstraints || updatedUser.constraints !== undefined) {
      // Omit `constraints` when cleared — passing `constraints: undefined` still
      // keeps the key and compile treats it as invalid shape.
      const compiled = await previewAgentPermissionsForAdmin(
        {
          id: updatedUser.id,
          name: updatedUser.name,
          enabled: updatedUser.enabled,
          role: updatedUser.role,
          roles: updatedUser.roles,
          tokens: updatedUser.tokens,
          allow: updatedUser.allow,
          ...(updatedUser.constraints !== undefined ? { constraints: updatedUser.constraints } : {})
        },
        { roleOverrides: newConfig.roles as AccessConfig["roles"] }
      );
      if (!compiled.ok) {
        const err = constraintsCompileError(compiled.reason);
        return reply.status(400).send({ ok: false, error: err });
      }
      proposedEffectivePermissions = effectivePermissionsToPreview(compiled.permissions);
    }

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
      return {
        ok: true,
        data: {
          diff,
          proposedYaml,
          gate,
          ...(proposedEffectivePermissions ? { effectivePermissions: proposedEffectivePermissions } : {})
        }
      };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
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

    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "agent_patch",
      targetId: updatedUser.id,
      oldSummary: {
        enabled: existingUser.enabled !== false,
        role: existingUser.role,
        hasLegacyAllow: Boolean(existingUser.allow),
        hasConstraints: existingUser.constraints !== undefined
      },
      newSummary: {
        enabled: updatedUser.enabled !== false,
        role: updatedUser.role,
        hasLegacyAllow: Boolean(updatedUser.allow),
        hasConstraints: updatedUser.constraints !== undefined
      },
      diff,
      requestId: request.id
    });
    return {
      ok: true,
      data: {
        written: true,
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck,
        gate,
        agent: await userToAgentWithPermissions(updatedUser),
        ...(proposedEffectivePermissions ? { effectivePermissions: proposedEffectivePermissions } : {})
      }
    };
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
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
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

    // Revoke all tokens in sqlite — must succeed before yaml is updated
    const db = await getAuditDb();
    const revokedAt = new Date().toISOString();
    for (const token of user.tokens) {
      db.prepare("INSERT OR REPLACE INTO revoked_tokens (token_hash, revoked_at, reason) VALUES (?, ?, ?)").run(
        token.hash, revokedAt, "agent_deleted"
      );
    }

    const newConfig: YamlAccessConfig = { ...config, users: config.users.filter((u) => u.id !== request.params.userId) };
    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "agent_delete",
      targetId: user.id,
      oldSummary: { userIds: config.users.map((item) => item.id), tokenCount: user.tokens.length },
      newSummary: { userIds: newConfig.users.map((item) => item.id) },
      requestId: request.id
    });
    invalidateAccessConfigCache();
    return { ok: true, data: { written: true, gate } };
  });
}
