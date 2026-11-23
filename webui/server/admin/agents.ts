import { canonicalTokenPrefix, hasTokenPrefixCollision, hasUserTokenPrefixCollision, availableTokenCount,
  queryGlobalActiveTokenCount, captureAgentAuditReadSnapshot, snapshotIdCeilingSql, unavailableStats,
  queryAgentStatsFromDb, queryLastUsedMapFromDb, type AgentAuditReadSnapshot, type AgentStatsSummary, type TokenUsageSnapshot } from "./agent-statistics-queries.js";
export type { AgentStatsSummary, TokenUsageSnapshot } from "./agent-statistics-queries.js";
import { readAgentStatisticsInWorker, closeAgentStatisticsWorkers, warmAgentStatisticsWorkers, type AgentStatisticsRead } from "./agent-statistics-display.js";
import { prepareRolesAgentMutation, rolesAgentResponseAfterPublish, runRolesAgentMutationRequest, runRolesAgentPublishWindow, readRolesAgentCompileInputsDigest, recheckRolesAgentWriteAccess, replayRecordedRolesAgentWrite, rolesAgentRequestDigest } from "./access-roles-agent-concurrent-edit.js";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { stringifySafe } from "../yaml-safe";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accessWriteResponseBody,
  assertAgentObjectBaseline,
  assertPreviewTokenMatches,
  attachRacsReceiptToNewSummary,
  buildRolesAgentRacsReceipt,
  computeAgentBaseObjectVersion,
  computeRoleAgentPreviewBinding,
  evaluateRolesAgentRacsIdempotencyClaim,
  mapConcurrentEditError,
  mapRacsIdempotencyRejectToHttp,
  mergeConfigWithAgent,
  resolveAccessWriteVersionMode,
  resolveCompileInputsDigest,
  resolveRolesAgentRacsOperation,
  respondRacsIdempotencyReplay,
  runInAccessPublishWindow,
  serializeBaseObjectVersion,
  writeAccessConfigFileWithAuditClosure,
  type AccessConfigWriteResult,
  type YamlRole
} from "./access-config.js";
import { resolveProjectRoot } from "../project.js";
import { previewDiff } from "../diff.js";
import { getAuditDb, type ConfigAuditActorType } from "./audit.js";
import {
  build7dWindow,
  buildAgentStatsWindow,
  parseAgentStatsRange,
  type AgentStatsRange,
  type MetricWindow
} from "./metric-window.js";
import { expandTemplate } from "./role-templates.js";
import {
  previewAgentPermissionsForAdmin,
  previewRolePermissionsForAdmin,
  resolveEffectivePermissionsForAdmin,
  resolveRoleIds,
  runtimeConsistencyForInputs,
  type DisplayPolicyInputs,
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
import { narrowAuthorization, narrowingScopeForWrite } from "../proxy/authorization-barrier.js";
import { actorIdFromRequest, requireOwnerForOps } from "../auth/guard.js";
import { auditActorFields, trustedActorFromRequest } from "../security/request-actor.js";
import { isTokenExpired } from "../proxy/identity.js";
import { protocolConditionSql, defaultUsageConditionSql, evalProbeConditionSql } from "../proxy/usage-classification.js";

/**
 * Spec 189 §4.2 — the single protocol classification condition. It replaces
 * the local `tool NOT IN (...)` list so every surface agrees on which rows
 * are protocol events, including the `server/*` prefix rule that a literal
 * list cannot express.
 */
const PROTOCOL_CONDITION = protocolConditionSql().sql;
/**
 * Spec 189 §4.1 — the Default Usage layer: not a protocol event AND not a
 * default-view-excluded eval probe. This is what `usageCallsLast7d` counts.
 */
const DEFAULT_USAGE_CONDITION = defaultUsageConditionSql().sql;
/** Spec 189 §4.3 — the default-view-excluded eval probes (reconciliation aid). */
const EVAL_PROBE_CONDITION = evalProbeConditionSql().sql;
import { readAuditWriteHealth, type AuditWriteHealthSnapshot } from "../proxy/audit-write-health.js";
import { countEntryPerf, markDisplayCache, timeAsync, withRequestTiming } from "../entry-performance-timing.js";
import { readAccessSnapshot, resolvePermissionBatch, type PermissionBatch } from "./permission-display.js";
import { generationKey, hasPendingDisplayWrite } from "../display-generation.js";
import {
  AGENT_PERMISSION_SCOPES,
  createDisplayRequestBudget,
  DisplaySnapshotBusyError,
  getDisplaySnapshot,
  evictDisplaySnapshotSlot,
  registerDisplayPrewarmer,
  type DisplayRequestBudget
} from "../display-snapshot.js";
import { withDisplayWriteBarrier } from "../display-generation.js";

/** Spec 129: Agent write paths must not materialize reference templates into access.yaml. */

const ACCESS_YAML_REL = "webui/config/access.yaml";
const REFERENCE_TEMPLATE_NOT_ASSIGNABLE = "REFERENCE_TEMPLATE_NOT_ASSIGNABLE";

function rejectTemplateRole(roleId: string) {
  return {
    ok: false as const,
    error: {
      code: REFERENCE_TEMPLATE_NOT_ASSIGNABLE,
      message: `Reference template '${roleId}' must be copied to a formal Role before assignment.`
    }
  };
}
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

const AGENT_CREATE_EXPECTED = {
  type: "object",
  required: ["agent"],
  properties: {
    agent: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string" },
        name: { type: "string" }
      }
    }
  }
} as const;

const AGENT_CREATE_EXAMPLE = {
  agent: { id: "analyst_bot", name: "分析助手" }
} as const;

/**
 * Test seam for SC-10 fixture B and SC-16.
 * `afterCapture` runs inside the write coordination window after the snapshot
 * is bound. `beforeResponse` runs after that window is released and before
 * the HTTP body is returned. Production leaves both null.
 */
export const agentCommitTestHooks: {
  afterCapture: (() => Promise<void>) | null;
  beforeResponse: (() => Promise<void>) | null;
} = {
  afterCapture: null,
  beforeResponse: null
};

type AgentProjection = Awaited<ReturnType<typeof userToAgentWithPermissions>>;
type AgentAccessWriteResult = AccessConfigWriteResult & {
  after?: { agent: AgentProjection; version: string };
};

export interface YamlToken {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
  device_name?: string | null;
  /** Spec lucy-20261102-token-display-hint — fixed plaintext truncation for UI核对. */
  token_hint?: string | null;
  actor_id?: string | null;
  actor_kind?: "person" | "automation" | null;
}

export interface YamlUser {
  /** Server-generated lifetime marker; never accepted from an Agent patch. */
  object_generation?: string;
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
  /**
   * L25-16 — 委托人（`admins.yaml` 中的管理员 id，Spec §3.2.2 规则 6）。
   * 只用于 owner-only 操作的委托校验与审计归因，不放大 `allow.ops` 的域与连接范围。
   */
  delegated_from?: string;
  /** Spec 100 Agent Constraints; validated at EffectivePolicy compile. */
  constraints?: unknown;
}

/**
 * Role shape of `access.yaml`.
 *
 * There is ONE definition of the Role body: `access-config.ts` owns it (it owns
 * the persistence), and this module re-exports it. The two copies used to
 * drift — this one predated the row-policy template (`row_policy.template`),
 * so it still declared `row_policy.predicates` as a required `unknown[]`, while
 * the persisted format allows a template reference and no inline predicates.
 * A template-expanded Role was therefore not assignable to the canonical Role,
 * which broke every caller that mixes a YAML Role with a template Role.
 */
export type { YamlRole };

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

// ─── L25-16 委托与控制面可达范围（G13 / Spec §3.2.2 规则 8） ─────────────────

/**
 * 该角色集合是否触及**控制面可达范围**（即某个角色带非空 `allow.ops`）。
 *
 * 授予控制面能力是提权通道的入口，因此必须 owner-only（G13）。
 */
export function rolesTouchControlPlane(
  roles: Record<string, YamlRole> | undefined,
  roleIds: readonly string[]
): boolean {
  if (!roles) return false;
  return roleIds.some((roleId) => (roles[roleId]?.allow?.ops?.length ?? 0) > 0);
}

/**
 * 校验 `delegated_from`：必须指向 `admins.yaml` 中**存在且启用**的管理员。
 *
 * fail-closed：`admins.yaml` 不可读 ⇒ 拒绝写入（委托是提权通道，不能在无法证明
 * 委托人的情况下放行）。委托人是否必须是 owner 由**使用时刻**的
 * `resolveDelegatingPrincipal` 判定，这里只保证「委托存在且指向真实管理员」。
 */
export async function validateDelegatedFrom(
  delegatedFrom: unknown
): Promise<{ ok: true; value: string | undefined } | { ok: false; reason: string }> {
  if (delegatedFrom === undefined || delegatedFrom === null) {
    return { ok: true, value: undefined };
  }
  if (typeof delegatedFrom !== "string" || !delegatedFrom.trim()) {
    return { ok: false, reason: "delegated_from must be a non-empty admin id" };
  }
  const value = delegatedFrom.trim();
  const { findAdmin, loadAdminsConfig } = await import("../auth/admins-store.js");
  let principal;
  try {
    principal = findAdmin(await loadAdminsConfig(), value);
  } catch {
    return { ok: false, reason: "delegated_from cannot be verified (admins config unreadable)" };
  }
  if (!principal) return { ok: false, reason: `delegated_from '${value}' is not a known admin id` };
  if (principal.enabled === false) {
    return { ok: false, reason: `delegated_from '${value}' refers to a disabled admin` };
  }
  return { ok: true, value };
}

async function readAccessYaml(projectRoot: string): Promise<{ config: YamlAccessConfig; raw: string; version: string }> {
  const filePath = path.join(projectRoot, ACCESS_YAML_REL);
  const raw = await readFile(filePath, "utf-8");
  countEntryPerf("accessReads");
  const s = await stat(filePath);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  const version = `${s.mtimeMs.toFixed(0)}-${hash}`;
  const config = parse(raw) as YamlAccessConfig;
  if (!config.users) config.users = [];
  return { config, raw, version };
}

/**
 * Spec 174 §3.2 — the display barrier covers persist → policy commit/ack →
 * optional direct rollback, so no intermediate access version is published.
 */
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
    actor?: string;
    actorType?: ConfigAuditActorType;
    actorIp?: string;
    sessionId?: string | null;
    expectedVersion?: string;
    idempotencyKey?: string;
  },
  committedAgent?: YamlUser
): Promise<AgentAccessWriteResult> {
  return withDisplayWriteBarrier(["P"], () => writeAccessYamlInBarrier(projectRoot, config, audit, committedAgent));
}

async function writeAccessYamlInBarrier(
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
    actor?: string;
    actorType?: ConfigAuditActorType;
    actorIp?: string;
    sessionId?: string | null;
    expectedVersion?: string;
    idempotencyKey?: string;
  },
  committedAgent?: YamlUser
): Promise<AgentAccessWriteResult> {
  // Strip derived last_used before writing
  const toWrite: YamlAccessConfig = {
    ...config,
    users: config.users.map((u) => ({
      ...u,
      tokens: u.tokens.map(({ ...t }) => t)
    }))
  };
  const content = stringifySafe(toWrite, { lineWidth: 0 });
  // Bound inside the publish window, before it is released. Do not re-read
  // the file after the window to pair a newer version with this agent.
  let capturedAfter: AgentAccessWriteResult["after"];
  // Lucy v0.25 — Agent writes share the one access.yaml durable-audit closure with the
  // Role / row-policy writer (durable intent → atomic write → commit → durable terminal).
  const result = await writeAccessConfigFileWithAuditClosure(projectRoot, ACCESS_YAML_REL, content, audit, {
    source: audit?.source ?? "admin_agents_api",
    kind: "agent_save",
    expectedVersion: audit?.expectedVersion,
    onCommitted: async (previousRaw) => {
      // T04-3 / Spec §3.3 — narrower authority is persisted and committed above;
      // cancel in-flight work and clear caches before this write reports success.
      const narrowed = narrowingScopeForWrite(previousRaw, toWrite);
      if (narrowed) await narrowAuthorization(narrowed);
      if (!committedAgent) return;
      const filePath = path.join(projectRoot, ACCESS_YAML_REL);
      const raw = await readFile(filePath, "utf-8");
      const info = await stat(filePath);
      const version = computeVersion(raw, info.mtimeMs);
      invalidateAccessConfigCache();
      let agent: AgentProjection;
      try {
        agent = await userToAgentWithPermissions(committedAgent);
      } catch {
        agent = {
          ...userToAgent(committedAgent),
          effectivePermissions: undefined,
          permissionWarnings: ["after_projection_fallback"]
        };
      }
      capturedAfter = { agent, version };
      if (agentCommitTestHooks.afterCapture) await agentCommitTestHooks.afterCapture();
    }
  });
  return {
    ...result,
    after: result.status === "committed" ? capturedAfter : undefined
  };
}

async function finishConfirmedAgentWrite(
  reply: FastifyReply,
  writeResult: AgentAccessWriteResult,
  extra: Record<string, unknown>
) {
  return rolesAgentResponseAfterPublish(async (reply) => {
  if (writeResult.status === "committed" && writeResult.after) {
    const hook = agentCommitTestHooks.beforeResponse;
    if (hook) {
      agentCommitTestHooks.beforeResponse = null;
      await hook();
    }
    return {
      ok: true as const,
      data: {
        written: true,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        runtimeAck: writeResult.runtimeAck,
        after: writeResult.after,
        agent: writeResult.after.agent,
        ...extra
      }
    };
  }
  if (writeResult.status === "committed") {
    return reply.status(500).send({
      ok: false,
      error: { code: "INTERNAL", message: "Agent 写入已提交，但未能绑定访问配置并发版本" }
    });
  }
  const failure = accessWriteResponseBody(writeResult, extra);
  return reply.status(failure.statusCode).send(failure.body);
  });
}

function computeVersion(raw: string, mtimeMs: number): string {
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `${mtimeMs.toFixed(0)}-${hash}`;
}

interface AgentConfigTimeline {
  createdAt?: string;
  configUpdatedAt?: string;
}

async function getGlobalActiveTokenCount(win: MetricWindow, snapshot?: AgentAuditReadSnapshot): Promise<number | null> {
  try { return queryGlobalActiveTokenCount(await getAuditDb(), win, snapshot); } catch { return null; }
}

async function getStatsMap(users: YamlUser[], win: MetricWindow = build7dWindow(), sharedSnapshot?: AgentAuditReadSnapshot): Promise<Map<string, AgentStatsSummary>> {
  try { return queryAgentStatsFromDb(await getAuditDb(), users, win, sharedSnapshot); }
  catch { return new Map(users.map((user) => [user.id, unavailableStats(user, win)])); }
}

async function getStats(user: YamlUser, win: MetricWindow = build7dWindow()): Promise<AgentStatsSummary> {
  return (await getStatsMap([user], win)).get(user.id) ?? unavailableStats(user, win);
}

/** Shared SQL core for the read-only display worker and local equivalence tests. */
export const agentStatisticsQueries = {
  getStatsMap,
  queryAgentStatsFromDb,
  queryGlobalActiveTokenCount,
  queryLastUsedMapFromDb,
  availableTokenCount,
  captureAgentAuditReadSnapshot
} as const;
export const agentStatsTestExports = agentStatisticsQueries;

/**
 * Spec 189 §5.3 / §6 — the **last business use** time per token.
 *
 * `getLastUsedMap` answers "when was this token last seen on the wire"
 * (最近 MCP 访问, protocol traffic included). Business activity needs a
 * different source: the latest **Default Usage Call** of that token. It is a
 * sibling map, never a reinterpretation of `last_used`.
 */
export async function getLastBusinessUseMap(
  userIds: string[]
): Promise<Map<string, Map<string, string>>> {
  // Returns: userId -> (token hash prefix -> last default usage call ts)
  const result = new Map<string, Map<string, string>>();
  if (userIds.length === 0) return result;
  try {
    const db = await getAuditDb();
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, ts
         FROM (
           SELECT
             user_id,
             token_hash_prefix,
             ts,
             ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC) AS rn
           FROM access_log
           WHERE user_id IN (${placeholders}) AND token_hash_prefix IS NOT NULL
             AND ${DEFAULT_USAGE_CONDITION}
         )
         WHERE rn = 1`
      )
      .all(...userIds) as Array<{ user_id: string; token_hash_prefix: string; ts: string }>;
    for (const row of rows) {
      const byPrefix = result.get(row.user_id) ?? new Map<string, string>();
      byPrefix.set(row.token_hash_prefix, row.ts);
      result.set(row.user_id, byPrefix);
    }
  } catch {
    // empty map
  }
  return result;
}

export async function getLastUsedMap(userIds: string[], snapshot?: AgentAuditReadSnapshot, users?: YamlUser[], asOfMs = Date.now()): Promise<Map<string, Map<string, TokenUsageSnapshot>>> {
  try { return queryLastUsedMapFromDb(await getAuditDb(), userIds, snapshot, users, asOfMs); }
  catch { return new Map(); }
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
    ...agentRoleFields(user),
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
               WHEN change_type IN ('agent_create', 'agent_patch', 'token_create', 'token_renew', 'token_revoke')
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
  user: { id: string; role?: string; roles?: string[]; allow?: unknown; enabled?: boolean; constraints?: unknown },
  roleOverrides: Record<string, YamlRole> | undefined
): Promise<{
  sources: string[];
  snapshotHash: string | null;
}> {
  const resolved = resolveRoleIds(user);
  const roleIds = resolved.ok ? resolved.roleIds : [];
  // Legacy `allow` fallback: don't go through the resolver.
  if (user.allow && roleIds.length === 0) {
    const allow = user.allow as { tables?: string[] };
    const sources = Array.isArray(allow.tables) ? allow.tables : [];
    return { sources, snapshotHash: null };
  }
  if (roleIds.length === 0) {
    return { sources: [], snapshotHash: null };
  }
  const preview = await previewAgentPermissionsForAdmin(
    {
      id: user.id,
      enabled: user.enabled !== false,
      tokens: [],
      roles: roleIds,
      ...(user.allow ? { allow: user.allow as AccessConfig["users"][number]["allow"] } : {}),
      ...(user.constraints !== undefined ? { constraints: user.constraints } : {})
    },
    { roleOverrides }
  );
  if (!preview.ok) return { sources: [], snapshotHash: null };
  return {
    sources: preview.permissions.sources.map((source) => source.table),
    snapshotHash: preview.permissions.snapshotHash
  };
}

interface BuildAgentGateInputArgs {
  targetKind: "agent" | "token";
  targetId?: string | null;
  oldUser: { id: string; role?: string; roles?: string[]; allow?: unknown; enabled?: boolean; constraints?: unknown };
  newUser: { id: string; role?: string; roles?: string[]; allow?: unknown; enabled?: boolean; constraints?: unknown };
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
/**
 * Build a denormalized summary of agent counts and recent usage.
 *
 * Spec 128 HR-1: when any agent's stats.metricsState=unavailable, the
 * aggregated windowed metrics (callsLast7d, activeAgentCountLast7d,
 * activeTokenCountLast7d, deniedLast7d) are set to null and
 * metricsState is marked "unavailable". Config-class metrics
 * (agentCount, enabledAgentCount, configuredTokenCount) are always present.
 */
function buildAgentsSummary(
  agents: Array<ReturnType<typeof userToAgent>>,
  /** Spec 128 Task 7: global DISTINCT active token count from audit DB. */
  globalActiveTokenCount: number | null,
  tokenPrefixCollision: boolean,
  auditWriteHealth: AuditWriteHealthSnapshot,
  range: AgentStatsRange = "7d"
): {
  agentCount: number;
  enabledAgentCount: number;
  activeAgentCountLast7d: number | null;
  businessActiveAgentCountLast7d: number | null;
  configuredTokenCount: number;
  availableTokenCount: number;
  activeTokenCountLast7d: number | null;
  usedCredentialCountLast7d: number | null;
  usedCredentialState: "ok" | "partial" | "unavailable";
  usedCredentialReason?: "token_prefix_collision" | "audit_unavailable";
  callsLast7d: number | null;
  businessCallsLast7d: number | null;
  protocolCallsLast7d: number | null;
  /**
   * Spec 189 §5.2 — Default Usage Calls across the current configured Agents.
   */
  usageCallsLast7d: number | null;
  /**
   * Spec 189 §5.2 — eval probes excluded from the default usage view.
   */
  evalProbeCallsLast7d: number | null;
  /**
   * Spec 189 §5.2 — current configured Agents with at least one default usage
   * business call. Computed server-side; the frontend `summarizeAgents` is only
   * a compatibility path for legacy responses without a summary.
   */
  usageActiveAgentCountLast7d: number | null;
  deniedLast7d: number | null;
  metricsState: "ok" | "unavailable";
  auditCompleteness: Omit<AuditWriteHealthSnapshot, "state"> & {
    state: "ok" | "partial" | "unavailable";
  };
  windowStart?: string;
  windowEnd?: string;
  range?: AgentStatsRange;
} {
  let enabledAgentCount = 0;
  let activeAgentCountLast7d = 0;
  let configuredTokenCount = 0;
  let availableTokenCount = 0;
  let callsLast7d = 0;
  let businessCallsLast7d = 0;
  let protocolCallsLast7d = 0;
  let usageCallsLast7d = 0;
  let evalProbeCallsLast7d = 0;
  let usageActiveAgentCountLast7d = 0;
  let deniedLast7d = 0;
  let anyUnavailable = globalActiveTokenCount === null;
  let windowStart: string | undefined;
  let windowEnd: string | undefined;

  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    configuredTokenCount += agent.tokens.length;
    availableTokenCount += agent.stats?.availableTokens ?? 0;
    const stats = agent.stats;
    if (!stats || stats.metricsState === "unavailable") {
      anyUnavailable = true;
      continue;
    }
    if ((stats.businessCallsLast7d ?? 0) > 0) activeAgentCountLast7d += 1;
    // Spec 189 §5.2 — business activity is driven by the Default Usage layer.
    if ((stats.usageCallsLast7d ?? 0) > 0) usageActiveAgentCountLast7d += 1;
    callsLast7d += stats.callsLast7d ?? 0;
    businessCallsLast7d += stats.businessCallsLast7d ?? 0;
    protocolCallsLast7d += stats.protocolCallsLast7d ?? 0;
    usageCallsLast7d += stats.usageCallsLast7d ?? 0;
    evalProbeCallsLast7d += stats.evalProbeCallsLast7d ?? 0;
    deniedLast7d += stats.deniedLast7d ?? 0;
    // All agents share the same window; take the first populated one
    if (!windowStart && stats.windowStart) windowStart = stats.windowStart;
    if (!windowEnd && stats.windowEnd) windowEnd = stats.windowEnd;
  }

  if (anyUnavailable) {
    return {
      agentCount: agents.length,
      enabledAgentCount,
      activeAgentCountLast7d: null,
      businessActiveAgentCountLast7d: null,
      configuredTokenCount,
      availableTokenCount,
      activeTokenCountLast7d: null,
      usedCredentialCountLast7d: null,
      usedCredentialState: "unavailable",
      usedCredentialReason: "audit_unavailable",
      callsLast7d: null,
      businessCallsLast7d: null,
      protocolCallsLast7d: null,
      usageCallsLast7d: null,
      evalProbeCallsLast7d: null,
      usageActiveAgentCountLast7d: null,
      deniedLast7d: null,
      metricsState: "unavailable",
      auditCompleteness: { ...auditWriteHealth, state: "unavailable" },
      windowStart,
      windowEnd,
      range
    };
  }

  return {
    agentCount: agents.length,
    enabledAgentCount,
    activeAgentCountLast7d,
    businessActiveAgentCountLast7d: activeAgentCountLast7d,
    configuredTokenCount,
    availableTokenCount,
    // Spec 128 Task 7: use global DISTINCT, not sum of per-agent counts.
    activeTokenCountLast7d: globalActiveTokenCount,
    usedCredentialCountLast7d: tokenPrefixCollision ? null : globalActiveTokenCount,
    usedCredentialState: tokenPrefixCollision ? "partial" : "ok",
    usedCredentialReason: tokenPrefixCollision ? "token_prefix_collision" : undefined,
    callsLast7d,
    businessCallsLast7d,
    protocolCallsLast7d,
    usageCallsLast7d,
    evalProbeCallsLast7d,
    usageActiveAgentCountLast7d,
    deniedLast7d,
    metricsState: "ok",
    auditCompleteness: auditWriteHealth,
    windowStart,
    windowEnd,
    range
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

type AgentPermissionPreview = {
  effectivePermissions?: ReturnType<typeof effectivePermissionsToPreview>;
  permissionWarnings: string[];
};

type AgentPermissionSection = {
  previews: Record<string, AgentPermissionPreview>;
  permissionsState: "ok" | "partial" | "unavailable";
  /** Compile inputs retained until the final response, after dynamic statistics finish. */
  policyInputs: DisplayPolicyInputs | null;
  snapshotVersion: string;
};

type CachedAgentPermissionSection = Omit<AgentPermissionSection, "snapshotVersion">;

function permissionPreviewFromBatch(batch: PermissionBatch, userId: string): AgentPermissionPreview {
  const resolved = batch.results.get(userId);
  if (!resolved) return { permissionWarnings: [batch.problem ?? "permissions_unavailable"] };
  return {
    effectivePermissions: resolved.ok ? effectivePermissionsToPreview(resolved.permissions) : undefined,
    permissionWarnings: resolved.ok ? [] : [resolved.reason]
  };
}

/**
 * Spec 174 §3.1/§3.2 and Spec 195 §4 — permission previews for the list from
 * one access snapshot, cached as a display snapshot keyed by that snapshot's
 * version. Dynamic audit statistics are never part of this cache.
 *
 * The permission display depends on P (access, Manifest, permission
 * overrides) and C (connections, enabled tables). An ordinary semantic
 * overlay only feeds D, so it must not invalidate the Agent list.
 */
type AgentPermissionSummary = {
  state: "ok" | "unavailable";
  sourceCount: number | null; connectionCount: number | null; toolCount: number | null;
  capabilityCount: number | null; snapshotHash: string | null; sourceMapVersion: string | null;
};
type AgentPermissionSidecar = {
  schemaVersion: 1;
  summaries: Record<string, { permissionSummary: AgentPermissionSummary; permissionWarnings: string[] }>;
  permissionsState: AgentPermissionSection["permissionsState"];
  policyInputs: DisplayPolicyInputs | null;
};
const projectionCounters = { builds: 0, fullParses: 0, sidecarParses: 0 };
export const agentRosterProjectionDiagnostics = {
  read: () => ({ ...projectionCounters }),
  reset: () => { projectionCounters.builds = 0; projectionCounters.fullParses = 0; projectionCounters.sidecarParses = 0; }
};
function permissionSummaryFromBatch(batch: PermissionBatch, userId: string): AgentPermissionSidecar["summaries"][string] {
  const resolved = batch.results.get(userId);
  if (!resolved?.ok) return {
    permissionSummary: { state: "unavailable", sourceCount: null, connectionCount: null, toolCount: null,
      capabilityCount: null, snapshotHash: null, sourceMapVersion: null },
    permissionWarnings: [resolved && !resolved.ok ? resolved.reason : batch.problem ?? "permissions_unavailable"]
  };
  const p = resolved.permissions;
  return { permissionSummary: { state: "ok", sourceCount: p.sources.length, connectionCount: p.connections.length,
    toolCount: p.tools.length, capabilityCount: p.capabilities.length, snapshotHash: p.snapshotHash, sourceMapVersion: p.sourceMapVersion },
    permissionWarnings: [] };
}
async function readAgentPermissionSlot(projectRoot: string, users: YamlUser[], raw: string, version: string, budget?: DisplayRequestBudget) {
  return getDisplaySnapshot("agent-permissions", AGENT_PERMISSION_SCOPES, async () => {
    const accessSnapshot = await readAccessSnapshot(projectRoot, raw, version);
    const userIds = users.map((user) => user.id);
    const batch = await resolvePermissionBatch(accessSnapshot, userIds);
    const section: CachedAgentPermissionSection = {
      previews: Object.fromEntries(userIds.map((id) => [id, permissionPreviewFromBatch(batch, id)])),
      permissionsState: agentPermissionsState(users, batch), policyInputs: batch.policyInputs
    };
    const sidecar: AgentPermissionSidecar = {
      schemaVersion: 1, summaries: Object.fromEntries(userIds.map((id) => [id, permissionSummaryFromBatch(batch, id)])),
      permissionsState: section.permissionsState, policyInputs: section.policyInputs
    };
    projectionCounters.builds += 1;
    return { payload: JSON.stringify(section), sidecar: JSON.stringify(sidecar) };
  }, { extraKey: version, budget });
}
async function agentPermissionSection(projectRoot: string, users: YamlUser[], raw: string, version: string, budget?: DisplayRequestBudget): Promise<AgentPermissionSection> {
  const slot = await readAgentPermissionSlot(projectRoot, users, raw, version, budget);
  projectionCounters.fullParses += 1;
  return { ...JSON.parse(slot.payload) as CachedAgentPermissionSection, snapshotVersion: slot.version };
}
async function agentPermissionSummarySection(projectRoot: string, users: YamlUser[], raw: string, version: string, budget?: DisplayRequestBudget) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const slot = await readAgentPermissionSlot(projectRoot, users, raw, version, budget);
    try {
      projectionCounters.sidecarParses += 1;
      const small = JSON.parse(slot.sidecar ?? "null") as AgentPermissionSidecar | null;
      if (small?.schemaVersion !== 1 || !small.summaries || Array.isArray(small.summaries)
        || Object.keys(small).some(k=>!["schemaVersion","summaries","permissionsState","policyInputs"].includes(k))
        || Object.keys(small.summaries).length !== users.length || !["ok", "partial", "unavailable"].includes(small.permissionsState)
        || !Object.hasOwn(small, "policyInputs")
        || (small.policyInputs !== null && ["accessConfigDigest","sourceMapVersion","enabledTablesDigest","toolClassificationVersion"].some(k=>typeof (small.policyInputs as unknown as Record<string,unknown>)?.[k]!=="string"))
        || users.some((u) => {
          const row=small.summaries[u.id],p=row?.permissionSummary;
          if(!p || Object.keys(row).some(k=>!["permissionSummary","permissionWarnings"].includes(k))
            || Object.keys(p).some(k=>!["state","sourceCount","connectionCount","toolCount","capabilityCount","snapshotHash","sourceMapVersion"].includes(k))
            || !Array.isArray(row.permissionWarnings) || row.permissionWarnings.some(w=>typeof w!=="string")) return true;
          const counts=[p.sourceCount,p.connectionCount,p.toolCount,p.capabilityCount];
          return p.state==="ok" ? counts.some(n=>!Number.isSafeInteger(n)||Number(n)<0) || typeof p.snapshotHash!=="string" || typeof p.sourceMapVersion!=="string"
            : p.state!=="unavailable" || [...counts,p.snapshotHash,p.sourceMapVersion].some(v=>v!==null);
        })) throw new Error("invalid projection");
      return { ...small, snapshotVersion: slot.version };
    } catch {
      if (attempt === 1) break;
      evictDisplaySnapshotSlot("agent-permissions", slot.incarnation);
    }
  }
  throw new DisplaySnapshotBusyError("reconcile_failed");
}

registerDisplayPrewarmer("agent-permissions", async () => {
  await warmAgentStatisticsWorkers();
  const projectRoot = await resolveProjectRoot();
  const { config, raw, version } = await readAccessYaml(projectRoot);
  await agentPermissionSection(projectRoot, config.users, raw, version);
});

/** Spec 174 §3.1 — list view: permissions from the shared read-only batch. */
function userToAgentWithBatchPermissions(
  user: YamlUser,
  preview: AgentPermissionPreview | undefined,
  stats?: Awaited<ReturnType<typeof getStats>>,
  tokenUsage?: Map<string, TokenUsageSnapshot>,
  timeline?: AgentConfigTimeline
) {
  const agent = userToAgent(user, stats, tokenUsage, timeline);
  return {
    ...agent,
    effectivePermissions: preview?.effectivePermissions,
    permissionWarnings: preview?.permissionWarnings ?? ["permissions_unavailable"]
  };
}

/** Spec 174 §3.3 — ok / partial / unavailable over enabled Agents (disabled denies are not failures). */
function agentPermissionsState(users: YamlUser[], batch: PermissionBatch): "ok" | "partial" | "unavailable" {
  if (!batch.context) return "unavailable";
  const enabled = users.filter((user) => user.enabled !== false);
  if (enabled.length === 0) return "ok";
  const failed = enabled.filter((user) => !batch.results.get(user.id)?.ok).length;
  return failed === 0 ? "ok" : failed === enabled.length ? "unavailable" : "partial";
}

function bodyHasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function hasWildcardAllow(user: YamlUser): boolean {
  return Boolean(user.allow?.tables?.includes("*") || user.allow?.tools?.includes("*"));
}

function catalogRoleIds(config: YamlAccessConfig): string[] {
  return Object.entries(config.roles ?? {})
    .filter(([, role]) => role?.allow !== undefined)
    .map(([id]) => id);
}

function orderRoleIdsByCatalog(ids: string[], catalogIds: string[]): string[] {
  const wanted = new Set(ids);
  const ordered = catalogIds.filter((id) => wanted.has(id));
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

type RoleSetInput =
  | { touched: false }
  | { touched: true; ids: string[] }
  | { touched: true; error: { code: string; message: string } };

function parseRoleSetInput(body: object): RoleSetInput {
  const hasRole = bodyHasOwn(body, "role");
  const hasRoles = bodyHasOwn(body, "roles");
  if (!hasRole && !hasRoles) return { touched: false };
  if (hasRole && hasRoles) {
    return { touched: true, error: { code: "ROLE_AND_ROLES", message: "Send roles or role, not both" } };
  }
  if (hasRoles) {
    const raw = (body as { roles?: unknown }).roles;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) {
      return { touched: true, error: { code: "BAD_REQUEST", message: "roles must be an array of role ids" } };
    }
    return { touched: true, ids: [...new Set(raw.map((id) => id.trim()).filter(Boolean))] };
  }
  const rawRole = (body as { role?: unknown }).role;
  if (typeof rawRole !== "string" || !rawRole.trim()) {
    return { touched: true, error: { code: "BAD_REQUEST", message: "role must be a role id" } };
  }
  return { touched: true, ids: [rawRole.trim()] };
}

async function validateRoleSetForWrite(
  config: YamlAccessConfig,
  ids: string[]
): Promise<{ ok: true; ids: string[] } | { ok: false; status: number; error: { code: string; message: string } }> {
  for (const id of ids) {
    const resolvedRole = roleForInput(config, id);
    if (!resolvedRole) {
      return { ok: false, status: 400, error: { code: "INVALID_ROLE", message: `Role '${id}' does not exist or is invalid` } };
    }
    if (resolvedRole.source === "template") {
      return { ok: false, status: 400, error: rejectTemplateRole(resolvedRole.id).error };
    }
    const invalidReason = await validateRoleForWrite(resolvedRole.id, resolvedRole.role);
    if (invalidReason) {
      return {
        ok: false,
        status: 400,
        error: { code: "INVALID_ROLE", message: `Role '${resolvedRole.id}' is invalid: ${invalidReason}` }
      };
    }
  }
  return { ok: true, ids: orderRoleIdsByCatalog(ids, catalogRoleIds(config)) };
}

function applyRoleSet(user: YamlUser, ids: string[]) {
  delete user.role;
  if (ids.length === 0) {
    delete user.roles;
    return;
  }
  user.roles = ids;
  delete user.allow;
}

function agentRoleFields(user: YamlUser) {
  const resolved = resolveRoleIds(user);
  if (!resolved.ok) {
    const declaredRoles = Array.isArray(user.roles)
      ? user.roles.filter((role): role is string => typeof role === "string" && role.trim().length > 0).map((role) => role.trim())
      : [];
    return {
      roles: [] as string[],
      roleResolutionError: resolved.reason,
      ...(typeof user.role === "string" && user.role.trim() ? { declaredRole: user.role.trim() } : {}),
      ...(declaredRoles.length > 0 ? { declaredRoles } : {})
    };
  }
  return {
    roles: resolved.roleIds,
    ...(resolved.roleIds.length === 1 ? { role: resolved.roleIds[0] } : {})
  };
}

function summaryRole(user: YamlUser): string | undefined {
  const resolved = resolveRoleIds(user);
  if (!resolved.ok || resolved.roleIds.length !== 1) return undefined;
  return resolved.roleIds[0];
}

async function previewWrittenAgent(user: YamlUser, roleOverrides: YamlAccessConfig["roles"]) {
  return previewAgentPermissionsForAdmin(
    {
      id: user.id,
      name: user.name,
      enabled: true,
      tokens: user.tokens,
      ...(user.roles ? { roles: user.roles } : {}),
      ...(user.role ? { role: user.role } : {}),
      ...(user.allow ? { allow: user.allow } : {}),
      ...(user.constraints !== undefined ? { constraints: user.constraints } : {})
    },
    { roleOverrides }
  );
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

function redactAccessYamlSecrets(text: string): string {
  return text
    .replace(/^([ \t]*hash:[ \t]*)(["']?)([^"'\n#]+)\2(.*)$/gm, "$1$2[REDACTED]$2$4")
    .replace(/sha256:[a-fA-F0-9]+/g, "[REDACTED]");
}

function agentWritePreview(raw: string, newConfig: YamlAccessConfig): { diff: string; proposedYaml: string } {
  const proposedYamlRaw = stringifySafe(newConfig, { lineWidth: 0 });
  const safeOld = redactAccessYamlSecrets(raw);
  const safeNew = redactAccessYamlSecrets(proposedYamlRaw);
  return {
    diff: previewDiff(safeOld, safeNew, ACCESS_YAML_REL),
    proposedYaml: safeNew
  };
}

/** P1-58 D5 — completed statistics responses may be reused for up to 5s after completion. */
const AGENT_STATISTICS_DISPLAY_CACHE_MS = 5000;
const AGENT_USAGE_CLASSIFIER_KEY = "default-usage-classifier-v1";

type AgentStatisticsDisplayBody = {
  version: string;
  range: AgentStatsRange;
  agents: Array<{ id: string; stats: AgentStatsSummary }>;
  summary: ReturnType<typeof buildAgentsSummary>;
  meta: {
    statisticsAsOf: string;
    generatedAt: string;
    snapshotVersion: string;
    configVersion: string;
    cache: "hit" | "miss" | "bypass";
  };
};

type AgentStatisticsCacheSlot = {
  key: string;
  completedAt: number;
  asOf: string;
  data: AgentStatisticsDisplayBody;
};

let agentStatisticsDisplayCache: AgentStatisticsCacheSlot | null = null;
const agentStatisticsDisplayInflight = new Map<string, Promise<AgentStatisticsCacheSlot>>();

let statisticsReader = readAgentStatisticsInWorker;
async function readDisplayStatistics(projectRoot: string, config: YamlAccessConfig, version: string, snapshotVersion: string, range: AgentStatsRange, refresh: boolean): Promise<AgentStatisticsRead> {
  const asOf = new Date().toISOString();
  try {
    return await statisticsReader({ projectRoot, dbPath: process.env.LUCY_AUDIT_DB ?? path.join(projectRoot, ".ktx-ui/audit.sqlite"),
      key: `${version}|${snapshotVersion}|${generationKey(["P", "C"])}`, users: config.users, range, refresh });
  } catch {
    // Preserve the legacy full-list failure contract. Configuration remains
    // usable, and audit-derived fields are unavailable, never fabricated zero.
    const window = buildAgentStatsWindow(range, new Date(asOf));
    return { asOf, window, snapshot: { ceilingId: 0 }, globalActiveTokenCount: null,
      stats: config.users.map((user) => [user.id, unavailableStats(user, window)]), tokenUsage: [] };
  }
}

export const agentStatisticsDisplayTestState = {
  setReader(reader?: typeof readAgentStatisticsInWorker) { statisticsReader = reader ?? readAgentStatisticsInWorker; },
  reset(): void {
    agentStatisticsDisplayCache = null;
    agentStatisticsDisplayInflight.clear();
  }
};

function agentStatisticsDisplayKey(input: {
  projectRoot: string;
  principalId: string;
  range: AgentStatsRange;
  configVersion: string;
  snapshotVersion: string;
}): string {
  return [
    input.projectRoot,
    input.principalId,
    input.range,
    input.configVersion,
    input.snapshotVersion,
    AGENT_USAGE_CLASSIFIER_KEY
  ].join("|");
}

function agentListSnapshotVersion(permissionSection: Pick<AgentPermissionSection, "policyInputs" | "snapshotVersion">): string {
  const runtimeConsistency = runtimeConsistencyForInputs(permissionSection.policyInputs);
  return createHash("sha256").update(`${permissionSection.snapshotVersion}:${runtimeConsistency}`).digest("hex").slice(0, 16);
}

async function buildAgentRoster(projectRoot: string, budget?: DisplayRequestBudget) {
  const { config, raw, version } = await timeAsync("access", () => readAccessYaml(projectRoot));
  const userIds = config.users.map((user) => user.id);
  const permissionSection = await timeAsync("permissions", () => agentPermissionSection(projectRoot, config.users, raw, version, budget));
  const timelineMap = await timeAsync("permissions", () => getAgentConfigTimelineMap(userIds));
  const agents = config.users.map((user) =>
    userToAgentWithBatchPermissions(
      user,
      permissionSection.previews[user.id],
      undefined,
      undefined,
      timelineMap.get(user.id)
    )
  );
  const snapshotVersion = agentListSnapshotVersion(permissionSection);
  return {
    ok: true as const,
    data: {
      agents,
      version,
      meta: {
        snapshotVersion,
        generatedAt: new Date().toISOString(),
        permissionsState: permissionSection.permissionsState,
        runtimeConsistency: runtimeConsistencyForInputs(permissionSection.policyInputs)
      }
    }
  };
}

async function buildAgentRosterSummary(projectRoot: string, budget?: DisplayRequestBudget) {
  const { config, raw, version } = await timeAsync("access", () => readAccessYaml(projectRoot));
  const section = await timeAsync("permissions", () => agentPermissionSummarySection(projectRoot, config.users, raw, version, budget));
  const timelines = await getAgentConfigTimelineMap(config.users.map((u) => u.id));
  const now = Date.now();
  const agents = config.users.map((user) => ({
    id: user.id, name: user.name, note: user.note, enabled: user.enabled !== false,
    ...agentRoleFields(user), createdAt: timelines.get(user.id)?.createdAt, configUpdatedAt: timelines.get(user.id)?.configUpdatedAt,
    legacyWildcard: Boolean(user.allow?.tables?.includes("*") || user.allow?.tools?.includes("*")),
    credentialSummary: { state: "ok" as const, configured: user.tokens.length, available: availableTokenCount(user, now), evaluatedAt: new Date(now).toISOString() },
    permissionSummary: section.summaries[user.id].permissionSummary,
    permissionWarnings: section.summaries[user.id].permissionWarnings
  }));
  return { ok: true as const, data: { agents, version, meta: { projection: "summary" as const, projectionVersion: 1,
    snapshotVersion: agentListSnapshotVersion(section), generatedAt: new Date(now).toISOString(),
    permissionsState: section.permissionsState, runtimeConsistency: runtimeConsistencyForInputs(section.policyInputs) } } };
}

async function readAgentStatisticsDisplay(
  projectRoot: string,
  range: AgentStatsRange,
  principalId: string,
  forceRefresh: boolean,
  budget?: DisplayRequestBudget
) {
  const { config, raw, version } = await timeAsync("access", () => readAccessYaml(projectRoot));
  const permissionSection = await timeAsync("permissions", () => agentPermissionSummarySection(projectRoot, config.users, raw, version, budget));
  const snapshotVersion = agentListSnapshotVersion(permissionSection);
  const key = agentStatisticsDisplayKey({
    projectRoot,
    principalId,
    range,
    configVersion: version,
    snapshotVersion
  });

  if (forceRefresh && agentStatisticsDisplayCache?.key === key) agentStatisticsDisplayCache = null;
  if (!forceRefresh && agentStatisticsDisplayCache?.key === key) {
    const age = Date.now() - Date.parse(agentStatisticsDisplayCache.asOf);
    if (age < AGENT_STATISTICS_DISPLAY_CACHE_MS) {
      markDisplayCache("hit");
      return {
        ok: true as const,
        data: {
          ...agentStatisticsDisplayCache.data,
          meta: {
            ...agentStatisticsDisplayCache.data.meta,
            cache: "hit" as const,
            statisticsAsOf: agentStatisticsDisplayCache.asOf
          }
        }
      };
    }
  }

  const inflightKey = forceRefresh ? `${key}|force` : key;
  let inflight = agentStatisticsDisplayInflight.get(inflightKey);
  if (!inflight) {
    const buildStartedAt = Date.now();
    const buildGeneration = generationKey(["P", "C"]);
    inflight = (async (): Promise<AgentStatisticsCacheSlot> => {
      try {
        const result = await timeAsync("stats", () => readDisplayStatistics(projectRoot, config, version, snapshotVersion, range, forceRefresh));
        const asOf = result.asOf;
        const window = result.window;
        const statsMap = new Map(result.stats);
        const globalActiveTokenCount = result.globalActiveTokenCount;
        const agentsForSummary = config.users.map((user) =>
          userToAgent(user, statsMap.get(user.id) ?? unavailableStats(user, window))
        );
        const summary = buildAgentsSummary(
          agentsForSummary,
          globalActiveTokenCount,
          hasTokenPrefixCollision(config.users),
          readAuditWriteHealth(),
          range
        );
        const agents = config.users.map((user) => ({
          id: user.id,
          stats: statsMap.get(user.id) ?? unavailableStats(user, window)
        }));
        const data: AgentStatisticsDisplayBody = {
          version,
          range,
          agents,
          summary,
          meta: {
            statisticsAsOf: asOf,
            generatedAt: new Date().toISOString(),
            snapshotVersion,
            configVersion: version,
            cache: forceRefresh ? "bypass" : "miss"
          }
        };
        const completedAt = Date.now();
        const slot: AgentStatisticsCacheSlot = { key, completedAt, asOf, data };
        if (!forceRefresh && completedAt - Date.parse(asOf) < AGENT_STATISTICS_DISPLAY_CACHE_MS
          && generationKey(["P", "C"]) === buildGeneration && !hasPendingDisplayWrite(["P", "C"])
          && summary.metricsState !== "unavailable") {
          agentStatisticsDisplayCache = slot;
          markDisplayCache("miss");
        }
        return slot;
      } finally {
        agentStatisticsDisplayInflight.delete(inflightKey);
      }
    })();
    agentStatisticsDisplayInflight.set(inflightKey, inflight);
  }

  const slot = await inflight;
  return {
    ok: true as const,
    data: {
      ...slot.data,
      meta: {
        ...slot.data.meta,
        statisticsAsOf: slot.asOf
      }
    }
  };
}

export function registerAgentRoutes(app: FastifyInstance) {
  app.addHook("onClose", async () => { await closeAgentStatisticsWorkers(); });
  // GET /api/admin/agents
  app.get<{ Querystring: { range?: string; view?: string; projection?: unknown } }>("/api/admin/agents", async (request, reply) => withRequestTiming(request, async () => {
    const projectRoot = await resolveProjectRoot();
    if (Object.keys(request.query).some(k=>k.startsWith("projection[")) ||
      (request.query.projection !== undefined && (request.query.projection !== "summary" || request.query.view !== "roster"))) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "请选择有效的 Agent 名册读取方式。" } });
    }
    if (request.query.view === "roster") {
      const budget = createDisplayRequestBudget();
      for (;;) {
        const accessGeneration = generationKey(["P", "C"]);
        const listing = request.query.projection === "summary"
          ? await buildAgentRosterSummary(projectRoot, budget) : await buildAgentRoster(projectRoot, budget);
        if (generationKey(["P", "C"]) === accessGeneration && !hasPendingDisplayWrite(["P", "C"])) return listing;
        if (budget.attemptsLeft <= 0) break;
      }
      throw new DisplaySnapshotBusyError("generation_changed");
    }
    const range = parseAgentStatsRange(request.query.range);
    // Spec 174 §3.1 — users / version / permissions come from one access snapshot;
    // if access changes while dynamic stats are read, rebuild the whole batch.
    // Spec 195 §6 — the route and the snapshot layer share ONE request budget:
    // at most three attempts for the whole request, and one recovery wait.
    const budget = createDisplayRequestBudget();
    for (;;) {
      // Spec 195 §4 — the permission display depends on P and C; a change to C
      // during the statistics read must reject the old permission result too.
      const accessGeneration = generationKey(["P", "C"]);
      const listing = await buildAgentList(projectRoot, range, budget);
      if (generationKey(["P", "C"]) === accessGeneration && !hasPendingDisplayWrite(["P", "C"])) return listing;
      if (budget.attemptsLeft <= 0) break;
    }
    throw new DisplaySnapshotBusyError("generation_changed");
  }));

  async function buildAgentList(projectRoot: string, range: AgentStatsRange = "7d", budget?: DisplayRequestBudget) {
    const { config, raw, version } = await timeAsync("access", () => readAccessYaml(projectRoot));
    const userIds = config.users.map((user) => user.id);
    const permissionSection = await timeAsync("permissions", () => agentPermissionSection(projectRoot, config.users, raw, version, budget));
    const result = await timeAsync("stats", () => readDisplayStatistics(projectRoot, config, version, agentListSnapshotVersion(permissionSection), range, false));
    const statsMap = new Map(result.stats);
    const window = result.window;
    const globalActiveTokenCount = result.globalActiveTokenCount;
    const tokenUsage = new Map(result.tokenUsage.map(([id, tokens]) => [id, new Map(tokens)]));
    const timelineMap = await timeAsync("stats", () => getAgentConfigTimelineMap(userIds));
    const agents = config.users.map((user) =>
      userToAgentWithBatchPermissions(
        user,
        permissionSection.previews[user.id],
        statsMap.get(user.id) ?? unavailableStats(user, window),
        tokenUsage.get(user.id),
        timelineMap.get(user.id)
      )
    );
    const summary = buildAgentsSummary(
      agents,
      globalActiveTokenCount,
      hasTokenPrefixCollision(config.users),
      readAuditWriteHealth(),
      range
    );
    // Runtime-only changes need not bump a file generation. Compute this after
    // every asynchronous read, immediately before assembling the response.
    const snapshotVersion = agentListSnapshotVersion(permissionSection);
    const runtimeConsistency = runtimeConsistencyForInputs(permissionSection.policyInputs);
    return {
      ok: true,
      data: {
        agents,
        version,
        summary,
        meta: {
          snapshotVersion,
          generatedAt: new Date().toISOString(),
          statisticsAsOf: result.asOf,
          permissionsState: permissionSection.permissionsState,
          runtimeConsistency
        }
      }
    };
  }

  // GET /api/admin/roles — moved to ./roles.ts (M12)

  // POST /api/admin/agents
  app.post<{
    Body: {
      dryRun?: boolean;
      baseObjectVersion?: string; previewToken?: string; operationId?: string;
      override?: AccessGovernanceOverrideRequest;
      agent: {
        id: string;
        name: string;
        note?: string;
        role?: string;
        roles?: string[];
        allow?: unknown;
        /** L25-16 — 委托人（`admins.yaml` 中的管理员 id）。 */
        delegated_from?: string;
      }
    };
  }>("/api/admin/agents", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const executeRequest = async (reply: FastifyReply) => {
    const agentInput = request.body?.agent;
    if (!agentInput || !agentInput.id || !agentInput.name) {
      return reply.status(400).send({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "agent.id and agent.name are required",
          detail: { expected: AGENT_CREATE_EXPECTED, example: AGENT_CREATE_EXAMPLE }
        }
      });
    }
    if (!AGENT_ID_RE.test(agentInput.id)) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "agent.id must match ^[A-Za-z0-9_-]{1,32}$" } });
    }
    if (bodyHasOwn(agentInput, "allow")) {
      return reply.status(400).send({ ok: false, error: { code: "LEGACY_ALLOW_READONLY", message: "agent.allow is deprecated and read-only; choose a role" } });
    }
    if (!dryRun && request.body?.baseObjectVersion && await replayRecordedRolesAgentWrite(request, reply,
      resolveAccessWriteVersionMode(request.body), "agent", agentInput.id,
      { ...request.body, patch: { action: "create", value: agentInput, copySourceId: null } })) return;
    const { config, raw } = await readAccessYaml(projectRoot);
    const parsedRoles = parseRoleSetInput(agentInput);
    if (!parsedRoles.touched) {
      return reply.status(400).send({ ok: false, error: { code: "ROLE_REQUIRED", message: "agent.roles is required and must reference an existing role" } });
    }
    if ("error" in parsedRoles) {
      return reply.status(400).send({ ok: false, error: parsedRoles.error });
    }
    if (parsedRoles.ids.length === 0) {
      return reply.status(400).send({ ok: false, error: { code: "ROLE_REQUIRED", message: "agent.roles is required and must reference an existing role" } });
    }
    const validatedRoles = await validateRoleSetForWrite(config, parsedRoles.ids);
    if (!validatedRoles.ok) {
      return reply.status(validatedRoles.status).send({ ok: false, error: validatedRoles.error });
    }

    if (config.users.some((u) => u.id === agentInput.id)) {
      return reply.status(409).send({ ok: false, error: { code: "AGENT_ID_TAKEN", message: `Agent id '${agentInput.id}' already exists` } });
    }

    // L25-16 / G13 — 建立委托、或授予触及控制面可达范围的角色 ⇒ 必须 owner。
    const delegatedFrom = await validateDelegatedFrom(agentInput.delegated_from);
    if (!delegatedFrom.ok) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_DELEGATED_FROM", message: delegatedFrom.reason } });
    }
    if (delegatedFrom.value || rolesTouchControlPlane(config.roles, validatedRoles.ids)) {
      if (!(await requireOwnerForOps(request, reply, "仅所有者可为 Agent 建立委托或授予控制面能力"))) return;
    }

    const newUser: YamlUser = {
      object_generation: randomUUID(),
      id: agentInput.id,
      name: agentInput.name,
      note: agentInput.note,
      enabled: true,
      tokens: [],
      roles: validatedRoles.ids,
      ...(delegatedFrom.value ? { delegated_from: delegatedFrom.value } : {})
    };
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: config.roles,
      users: [...config.users, newUser]
    };
    const { diff, proposedYaml } = agentWritePreview(raw, newConfig);
    const createdPreview = await previewWrittenAgent(newUser, newConfig.roles);
    if (!createdPreview.ok) {
      return reply.status(400).send({ ok: false, error: { code: "ROLE_RESOLUTION_FAILED", message: createdPreview.reason } });
    }
    const createdEffectivePermissions = effectivePermissionsToPreview(createdPreview.permissions);

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
      const protocol = await prepareRolesAgentMutation({ request, reply, kind: "agent", objectId: newUser.id, action: "create", dryRun: true,
        config, candidate: newConfig, gate, fields: request.body ?? {}, value: agentInput });
      return { ok: true, data: { diff, proposedYaml, gate, effectivePermissions: createdEffectivePermissions, ...protocol?.preview } };
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

    return runRolesAgentPublishWindow("agent_save", projectRoot, reply, async (reply) => {
      if (!(await recheckRolesAgentWriteAccess(request, reply, projectRoot))) return;
      const fresh = await readAccessYaml(projectRoot);
      if (fresh.config.users.some((user) => user.id === newUser.id)) return reply.status(409).send({ ok: false, error: { code: "AGENT_ID_TAKEN", message: "Agent 已存在，请使用新的 ID。" } });
      const freshRoles = await validateRoleSetForWrite(fresh.config, parsedRoles.ids);
      if (!freshRoles.ok) return reply.status(freshRoles.status).send({ ok: false, error: freshRoles.error });
      if ((newUser.delegated_from || rolesTouchControlPlane(fresh.config.roles, freshRoles.ids)) && !(await requireOwnerForOps(request, reply))) return;
      const candidate = mergeConfigWithAgent(fresh.config, newUser);
      const freshGate = evaluateAccessGovernanceGate(await buildAgentGateInput({ targetKind: "agent", targetId: newUser.id,
        oldUser: { id: newUser.id }, newUser, newRoleOverrides: fresh.config.roles }));
      const protocol = await prepareRolesAgentMutation({ request, reply, kind: "agent", objectId: newUser.id, action: "create", dryRun: false,
        config: fresh.config, candidate, gate: freshGate, fields: request.body ?? {}, value: agentInput });
      if (!protocol) return;
      const writeResult = await writeAccessYaml(projectRoot, candidate, {
      enabled: true,
      idempotencyKey: protocol.audit.idempotencyKey,
      changeType: "agent_create",
      targetId: newUser.id,
      oldSummary: { userIds: config.users.map((user) => user.id) },
      newSummary: {
        ...(protocol.audit.racsReceipt ? { racsReceipt: protocol.audit.racsReceipt } : {}), userIds: newConfig.users.map((user) => user.id), role: summaryRole(newUser), roles: newUser.roles },
      diff,
      ...auditActorFields(trustedActorFromRequest(request))
    }, newUser);
    return finishConfirmedAgentWrite(reply, writeResult, { gate });
    });
    };
    return runRolesAgentMutationRequest("agent_save", projectRoot, request, reply, dryRun, executeRequest);
  });

  // GET /api/admin/agents/statistics — must register before /:userId (P1-58 SC-07).
  app.get<{ Querystring: { range?: string; refresh?: string } }>("/api/admin/agents/statistics", async (request) =>
    withRequestTiming(request, async () => {
      const projectRoot = await resolveProjectRoot();
      const range = parseAgentStatsRange(request.query.range);
      const forceRefresh = request.query.refresh === "true";
      const actor = trustedActorFromRequest(request);
      const principalId = `${actor.accountUid ?? actor.actorId}:${actor.role}`;
      const budget = createDisplayRequestBudget();
      for (;;) {
        const accessGeneration = generationKey(["P", "C"]);
        const listing = await readAgentStatisticsDisplay(projectRoot, range, principalId, forceRefresh, budget);
        if (generationKey(["P", "C"]) === accessGeneration && !hasPendingDisplayWrite(["P", "C"])) return listing;
        if (budget.attemptsLeft <= 0) break;
      }
      throw new DisplaySnapshotBusyError("generation_changed");
    })
  );

  // GET /api/admin/agents/:userId
  app.get<{ Params: { userId: string }; Querystring: { range?: string } }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config, version } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }
    const stats = await getStats(user, buildAgentStatsWindow(parseAgentStatsRange(request.query.range)));
    const [tokenUsage, timelineMap] = await Promise.all([
      getLastUsedMap([user.id], undefined, [user]),
      getAgentConfigTimelineMap([user.id])
    ]);
    return {
      ok: true,
      data: {
        agent: await userToAgentWithPermissions(user, stats, tokenUsage.get(user.id), timelineMap.get(user.id)),
        version,
        baseObjectVersion: serializeBaseObjectVersion(computeAgentBaseObjectVersion(user.id, user))
      }
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
      baseObjectVersion?: string;
      previewToken?: string;
      operationId?: string;
      compileInputsDigest?: string;
      override?: AccessGovernanceOverrideRequest;
      patch: {
        name?: string;
        note?: string;
        enabled?: boolean;
        role?: string;
        roles?: string[];
        allow?: unknown;
        tokens?: unknown;
        id?: unknown;
        /** Spec 100 — set Agent Constraints; `null` clears the key. */
        constraints?: unknown;
        /** L25-16 — set / change / revoke the delegation principal. `null` revokes. */
        delegated_from?: string | null;
      };
    };
  }>("/api/admin/agents/:userId", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const executeRequest = async (reply: FastifyReply) => {
    let versionMode;
    try {
      versionMode = resolveAccessWriteVersionMode(request.body ?? {});
    } catch (error) {
      const mapped = mapConcurrentEditError(error);
      if (mapped) {
        return reply.status(mapped.status).send({ ok: false, error: { code: mapped.code, message: mapped.message, ...(mapped.detail ? { detail: mapped.detail } : {}) } });
      }
      throw error;
    }
    if (!dryRun && await replayRecordedRolesAgentWrite(request, reply, versionMode, "agent", request.params.userId, request.body ?? {})) return;
    const filePath = path.join(projectRoot, ACCESS_YAML_REL);
    const raw = await readFile(filePath, "utf-8");
    const s = await stat(filePath);
    const currentVersion = computeVersion(raw, s.mtimeMs);

    if (versionMode.mode === "legacy" && request.body?.version && request.body.version !== currentVersion) {
      return reply.status(409).send({ ok: false, error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" } });
    }

    const config = parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];
    const existingRoles = config.roles;
    const userIndex = config.users.findIndex((u) => u.id === request.params.userId);
    if (userIndex === -1) {
      if (versionMode.mode === "object") return reply.status(409).send({ ok: false, error: { code: "OBJECT_TARGET_CHANGED", message: "目标 Agent 已删除或变化，请保留草稿并读取最新状态。" } });
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }
    if (versionMode.mode === "object") {
      try {
        assertAgentObjectBaseline(config, request.params.userId, versionMode.baseObjectVersion);
      } catch (error) {
        const mapped = mapConcurrentEditError(error);
        if (mapped) {
          return reply.status(mapped.status).send({
            ok: false,
            error: { code: mapped.code, message: mapped.message, ...(mapped.detail ? { detail: mapped.detail } : {}) }
          });
        }
        throw error;
      }
    }

    const patch = request.body?.patch ?? {};
    for (const forbidden of ["allow", "tokens", "id"]) {
      if (bodyHasOwn(patch, forbidden)) {
        return reply.status(400).send({ ok: false, error: { code: forbidden === "allow" ? "LEGACY_ALLOW_READONLY" : "BAD_REQUEST", message: `patch.${forbidden} is not editable` } });
      }
    }
    const existingUser = config.users[userIndex];
    const parsedRoles = parseRoleSetInput(patch);
    if (parsedRoles.touched && "error" in parsedRoles) {
      return reply.status(400).send({ ok: false, error: parsedRoles.error });
    }
    // One call, one narrowing: the two `resolveRoleIds(existingUser)` calls in
    // the ternary are two different expressions, so the compiler cannot carry
    // the `ok` check of the first one over to the second.
    const resolvedExistingRoles = resolveRoleIds(existingUser);
    let nextRoleIds = resolvedExistingRoles.ok ? resolvedExistingRoles.roleIds : [];
    if (parsedRoles.touched && !("error" in parsedRoles)) {
      if (parsedRoles.ids.length === 0 && !existingUser.allow) {
        return reply.status(400).send({ ok: false, error: { code: "ROLE_REQUIRED", message: "At least one role is required" } });
      }
      if (parsedRoles.ids.length > 0) {
        const validatedRoles = await validateRoleSetForWrite(config, parsedRoles.ids);
        if (!validatedRoles.ok) {
          return reply.status(validatedRoles.status).send({ ok: false, error: validatedRoles.error });
        }
        nextRoleIds = validatedRoles.ids;
      } else {
        nextRoleIds = [];
      }
    }
    const enabling = patch.enabled === true && existingUser.enabled === false;
    if (enabling && nextRoleIds.length === 0 && hasWildcardAllow(existingUser)) {
      return reply.status(400).send({
        ok: false,
        error: { code: "LEGACY_WILDCARD_AGENT_REQUIRES_ROLE", message: "Assign a role before re-enabling a legacy wildcard agent" }
      });
    }

    // L25-16 / G13 — 委托与控制面可达范围的管理面门禁。
    //   ① 设置 / 修改 / 撤销 `delegated_from` ⇒ owner；
    //   ② 变更 Agent 的 `role` / `roles` 且触及控制面可达范围 ⇒ owner；
    //   ③ 已有委托的 Agent 变更角色集 ⇒ owner（否则 operator 可借委托链取得 owner 能力）。
    const delegatedPatchTouched = bodyHasOwn(patch, "delegated_from");
    if (delegatedPatchTouched) {
      if (!(await requireOwnerForOps(request, reply, "仅所有者可设置、修改或撤销委托（delegated_from）"))) return;
    }
    if (parsedRoles.touched) {
      const resolvedExisting = resolveRoleIds(existingUser);
      const existingRoleIds = resolvedExisting.ok ? resolvedExisting.roleIds : [];
      const touchesControlPlane =
        rolesTouchControlPlane(existingRoles, existingRoleIds)
        || rolesTouchControlPlane(config.roles, nextRoleIds);
      if (touchesControlPlane || Boolean(existingUser.delegated_from)) {
        if (!(await requireOwnerForOps(request, reply, "仅所有者可变更影响控制面可达范围的角色"))) return;
      }
    }
    let nextDelegatedFrom = existingUser.delegated_from;
    if (delegatedPatchTouched) {
      const validated = await validateDelegatedFrom(patch.delegated_from === null ? undefined : patch.delegated_from);
      if (!validated.ok) {
        return reply.status(400).send({ ok: false, error: { code: "INVALID_DELEGATED_FROM", message: validated.reason } });
      }
      nextDelegatedFrom = validated.value;
    }

    const updatedUser: YamlUser = {
      ...existingUser,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {})
    };
    if (delegatedPatchTouched) {
      if (nextDelegatedFrom) updatedUser.delegated_from = nextDelegatedFrom;
      else delete updatedUser.delegated_from;
    }
    if (parsedRoles.touched && !("error" in parsedRoles)) applyRoleSet(updatedUser, nextRoleIds);

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
    const { diff, proposedYaml } = agentWritePreview(raw, newConfig);

    // Spec 100 §10 — illegal / unsatisfiable / over-limit constraints must fail before write.
    // Spec 168 — role-set changes return the same server-composed preview.
    const roleSetTouched = parsedRoles.touched;
    let proposedEffectivePermissions: ReturnType<typeof effectivePermissionsToPreview> | undefined;
    if (roleSetTouched || patchHasConstraints || updatedUser.constraints !== undefined) {
      const compiled = await previewWrittenAgent(updatedUser, newConfig.roles);
      if (!compiled.ok) {
        if (patchHasConstraints || updatedUser.constraints !== undefined) {
          const err = constraintsCompileError(compiled.reason);
          return reply.status(400).send({ ok: false, error: err });
        }
        return reply.status(400).send({ ok: false, error: { code: "ROLE_RESOLUTION_FAILED", message: compiled.reason } });
      }
      proposedEffectivePermissions = effectivePermissionsToPreview(compiled.permissions);
    }

    // Access Governance Gate — Tiered Access Governance Gate (P1 / 64).
    const stats = await getStats(existingUser);
    const gateInput = await buildAgentGateInput({
      targetKind: "agent",
      targetId: updatedUser.id,
      oldUser: existingUser,
      newUser: updatedUser,
      oldRoleOverrides: existingRoles,
      newRoleOverrides: newConfig.roles,
      // Spec 189 §6 — the Access Governance Gate input stays **Raw Business**
      // Tool Call. It must not become the Default Usage layer (real eval
      // business calls must keep their governance protection) and must not
      // become the raw `callsLast7d` (pure protocol traffic must not inflate
      // the high-traffic count).
      callsLast7d: stats.businessCallsLast7d ?? 0
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    const compileInputsDigest = versionMode.mode === "object"
      ? await readRolesAgentCompileInputsDigest("agent", request.params.userId, newConfig, { user: existingUser }) : "";

    const racsPreview =
      versionMode.mode === "object"
        ? computeRoleAgentPreviewBinding({
            kind: "agent",
            objectId: updatedUser.id,
            baseObjectVersion: versionMode.baseObjectVersion,
            config: newConfig,
            patch: request.body?.patch ?? {},
            compileInputsDigest,
            actor: trustedActorFromRequest(request),
            gate
          })
        : undefined;

    if (dryRun) {
      return {
        ok: true,
        data: {
          diff,
          proposedYaml,
          version: currentVersion,
          gate,
          ...(proposedEffectivePermissions ? { effectivePermissions: proposedEffectivePermissions } : {}),
          ...(versionMode.mode === "object"
            ? {
                baseObjectVersion: serializeBaseObjectVersion(versionMode.baseObjectVersion),
                previewToken: racsPreview!.previewToken,
                compileInputsDigest
              }
            : {})
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

    const commitAgentPatch = async (reply: FastifyReply) => {
      if (!(await recheckRolesAgentWriteAccess(request, reply, projectRoot))) return;
      let configToWrite = newConfig;
      let freshExisting = existingUser;
      let freshDiff = diff;
      let expectedVersion: string | undefined = currentVersion;
      let publishPreviewEffectDigest: string | undefined;
      if (versionMode.mode === "object") {
        const fresh = await readAccessYaml(projectRoot);
        const freshConfig = fresh.config;
        try {
          assertAgentObjectBaseline(freshConfig, request.params.userId, versionMode.baseObjectVersion);
        } catch (error) {
          const mapped = mapConcurrentEditError(error);
          if (mapped) {
            return reply.status(mapped.status).send({
              ok: false,
              error: { code: mapped.code, message: mapped.message, ...(mapped.detail ? { detail: mapped.detail } : {}) }
            });
          }
          throw error;
        }
        freshExisting = freshConfig.users.find((u) => u.id === request.params.userId) ?? existingUser;
        configToWrite = mergeConfigWithAgent(freshConfig, updatedUser);
        const freshStats = await getStats(freshExisting);
        const freshGate = evaluateAccessGovernanceGate(await buildAgentGateInput({
          targetKind: "agent", targetId: updatedUser.id, oldUser: freshExisting, newUser: updatedUser,
          oldRoleOverrides: freshConfig.roles, newRoleOverrides: configToWrite.roles,
          callsLast7d: freshStats.businessCallsLast7d ?? 0
        }));
        if (freshGate.decision === "block" || (freshGate.decision === "override_required" && !evaluateGovernanceOverride(request.body?.override, freshGate).ok)) {
          return reply.status(409).send({ ok: false, error: { code: "GOVERNANCE_GATE_BLOCKED", message: "当前权限影响已变化，请重新预览并确认。", detail: { gate: freshGate } } });
        }
        const freshPreviousRoles = resolveRoleIds(freshExisting);
        if ((delegatedPatchTouched || Boolean(freshExisting.delegated_from)
          || rolesTouchControlPlane(freshConfig.roles, freshPreviousRoles.ok ? freshPreviousRoles.roleIds : [])
          || rolesTouchControlPlane(freshConfig.roles, nextRoleIds)) && !(await requireOwnerForOps(request, reply))) return;
        const freshBinding = computeRoleAgentPreviewBinding({
          kind: "agent",
          objectId: updatedUser.id,
          baseObjectVersion: versionMode.baseObjectVersion,
          config: configToWrite,
          patch: request.body?.patch ?? {},
          compileInputsDigest: await readRolesAgentCompileInputsDigest("agent", updatedUser.id, configToWrite, { user: freshExisting }),
          actor: trustedActorFromRequest(request),
          gate: freshGate
        });
        try {
          assertPreviewTokenMatches(request.body?.previewToken, freshBinding.previewEffectDigest);
          publishPreviewEffectDigest = freshBinding.previewEffectDigest;
        } catch (error) {
          const mapped = mapConcurrentEditError(error);
          if (mapped) {
            return reply.status(mapped.status).send({
              ok: false,
              error: { code: mapped.code, message: mapped.message, ...(mapped.detail ? { detail: mapped.detail } : {}) }
            });
          }
          throw error;
        }
        freshDiff = agentWritePreview(fresh.raw, configToWrite).diff;
        expectedVersion = undefined;
      }

      const racsOp = resolveRolesAgentRacsOperation(versionMode, request.body?.operationId);
      if (racsOp.kind === "reject") {
        return reply.status(racsOp.status).send({
          ok: false,
          error: { code: racsOp.code, message: racsOp.message }
        });
      }

      let racsIdempotencyKey: string | undefined;
      let newSummaryPayload: Record<string, unknown> = {
        enabled: updatedUser.enabled !== false,
        role: summaryRole(updatedUser),
        roles: updatedUser.roles,
        hasLegacyAllow: Boolean(updatedUser.allow),
        hasConstraints: updatedUser.constraints !== undefined
      };

      if (racsOp.kind === "racs") {
        if (!publishPreviewEffectDigest) {
          return reply.status(409).send({
            ok: false,
            error: { code: "PREVIEW_TOKEN_REQUIRED", message: "previewToken is required for object-version saves" }
          });
        }
        const objectBase = versionMode.mode === "object" ? versionMode.baseObjectVersion : undefined;
        if (!objectBase) {
          return reply.status(400).send({
            ok: false,
            error: { code: "BAD_REQUEST", message: "baseObjectVersion is required for RACS saves" }
          });
        }
        const receipt = buildRolesAgentRacsReceipt({
          actor: trustedActorFromRequest(request),
          objectKind: "agent",
          objectId: updatedUser.id,
          previewEffectDigest: publishPreviewEffectDigest,
          baseObjectVersionSerialized: serializeBaseObjectVersion(objectBase),
          requestDigest: rolesAgentRequestDigest(request.body ?? {}),
          candidateConfig: configToWrite
        });
        const claim = await evaluateRolesAgentRacsIdempotencyClaim(racsOp.operationId, receipt);
        if (claim.kind === "reject") {
          const mapped = mapRacsIdempotencyRejectToHttp(claim.code);
          return reply.status(mapped.status).send({
            ok: false,
            error: { code: mapped.code, message: mapped.message }
          });
        }
        if (claim.kind === "replay") {
          const replay = await respondRacsIdempotencyReplay(claim.auditId, {
            operationId: racsOp.operationId,
            baseObjectVersion: serializeBaseObjectVersion(computeAgentBaseObjectVersion(updatedUser.id, updatedUser))
          });
          return reply.status(replay.statusCode).send(replay.body);
        }
        racsIdempotencyKey = claim.idempotencyKey;
        newSummaryPayload = attachRacsReceiptToNewSummary(newSummaryPayload, receipt);
      }

      const writeResult = await writeAccessYaml(
        projectRoot,
        configToWrite,
        {
          enabled: true,
          expectedVersion,
          changeType: "agent_patch",
          targetId: updatedUser.id,
          oldSummary: {
            enabled: freshExisting.enabled !== false,
            role: summaryRole(freshExisting),
            roles: freshExisting.roles,
            hasLegacyAllow: Boolean(freshExisting.allow),
            hasConstraints: freshExisting.constraints !== undefined
          },
          newSummary: newSummaryPayload,
          diff: freshDiff,
          idempotencyKey: racsIdempotencyKey,
          ...auditActorFields(trustedActorFromRequest(request))
        },
        updatedUser
      ).catch((error: unknown) => {
        if ((error as { code?: string }).code === "VERSION_CONFLICT") return null;
        throw error;
      });
      if (writeResult === null) {
        return reply.status(409).send({
          ok: false,
          error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" }
        });
      }
      return finishConfirmedAgentWrite(reply, writeResult, {
        gate,
        ...(proposedEffectivePermissions ? { effectivePermissions: proposedEffectivePermissions } : {}),
        ...(versionMode.mode === "object"
          ? {
              baseObjectVersion: serializeBaseObjectVersion(computeAgentBaseObjectVersion(updatedUser.id, updatedUser)),
              operationId: request.body?.operationId
            }
          : {})
      });
    };

    if (versionMode.mode === "object") {
      return runRolesAgentPublishWindow("agent_save", projectRoot, reply, commitAgentPatch);
    }
    return commitAgentPatch(reply);
    };
    return runRolesAgentMutationRequest("agent_save", projectRoot, request, reply, dryRun, executeRequest);
  });

  // DELETE /api/admin/agents/:userId
  app.delete<{
    Params: { userId: string };
    Body?: { override?: AccessGovernanceOverrideRequest; dryRun?: boolean; baseObjectVersion?: string; previewToken?: string; operationId?: string };
  }>("/api/admin/agents/:userId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const dryRun = request.body?.dryRun === true;
    const executeDelete = async (reply: FastifyReply) => {
    if (!dryRun && !(await recheckRolesAgentWriteAccess(request, reply, projectRoot))) return;
    if (!dryRun && request.body?.baseObjectVersion && await replayRecordedRolesAgentWrite(request, reply,
      resolveAccessWriteVersionMode(request.body), "agent", request.params.userId,
      { ...request.body, patch: { action: "delete", value: null, copySourceId: null } })) return;
    const { config } = await readAccessYaml(projectRoot);
    const user = config.users.find((u) => u.id === request.params.userId);
    if (!user) {
      if (request.body?.baseObjectVersion) return reply.status(409).send({ ok: false, error: { code: "OBJECT_TARGET_CHANGED", message: "目标 Agent 已删除或变化，请保留草稿并读取最新状态。" } });
      return reply.status(404).send({ ok: false, error: { code: "AGENT_NOT_FOUND", message: `Agent '${request.params.userId}' not found` } });
    }

    // Access Governance Gate — Agent deletion. Removing a high-traffic Agent
    // or a Role-binding is a P2 cleanup that should be evidence-recorded.
    const stats = await getStats(user);
    const gateInput = await buildAgentGateInput({
      targetKind: "agent",
      targetId: user.id,
      oldUser: user,
      newUser: { id: user.id, role: undefined, allow: undefined },
      // Spec 189 §6 — the Access Governance Gate input stays **Raw Business**
      // Tool Call. It must not become the Default Usage layer (real eval
      // business calls must keep their governance protection) and must not
      // become the raw `callsLast7d` (pure protocol traffic must not inflate
      // the high-traffic count).
      callsLast7d: stats.businessCallsLast7d ?? 0
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

    const candidate: YamlAccessConfig = { ...config, users: config.users.filter((u) => u.id !== request.params.userId) };
    const protocol = await prepareRolesAgentMutation({ request, reply, kind: "agent", objectId: user.id, action: "delete", dryRun,
      config, candidate, gate, fields: request.body ?? {} });
    if (!protocol) return;
    if (dryRun) return { ok: true, data: { ...agentWritePreview((await readAccessYaml(projectRoot)).raw, candidate), gate, ...protocol.preview } };
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
      idempotencyKey: protocol.audit.idempotencyKey,
      changeType: "agent_delete",
      targetId: user.id,
      oldSummary: { userIds: config.users.map((item) => item.id), tokenCount: user.tokens.length },
      newSummary: { userIds: newConfig.users.map((item) => item.id), ...(protocol.audit.racsReceipt ? { racsReceipt: protocol.audit.racsReceipt } : {}) },
      ...auditActorFields(trustedActorFromRequest(request))
    });
    invalidateAccessConfigCache();
    // Spec §14.3.2 — only `committed` is a success. A rolled-back or
    // recovery-required delete must never be reported as `written: true`.
    if (writeResult.status !== "committed") {
      const failure = accessWriteResponseBody(writeResult, { gate });
      return reply.status(failure.statusCode).send(failure.body);
    }
    return {
      ok: true,
      data: {
        written: true,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        runtimeAck: writeResult.runtimeAck,
        gate
      }
    };
    };
    return dryRun ? executeDelete(reply) : runRolesAgentPublishWindow("agent_save", projectRoot, reply, executeDelete);
  });
}

export { computeAgentBaseObjectVersion, computeAgentObjectDigest } from "./access-object-version.js";
