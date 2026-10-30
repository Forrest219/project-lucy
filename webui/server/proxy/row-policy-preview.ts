/**
 * Lucy v0.25 (L25-14 §3.2 / §5.2 / §5.3 / §14.2) — final-row-constraint preview (R2).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2 (R2 最终行约束预览), §5.2 (最终行约束计算), §5.3 (保存前校验、预览与审计闭环),
 *   §14.2 (预览确认合同与共享发布窗口), §14.5 (全局展示并集与逐 Agent 实际 Role Set),
 *   §9 (V08–V13).
 *
 * Contract:
 * - The preview input is the IN-MEMORY CANDIDATE (the draft overlaid on the current
 *   configuration). The old configuration is never read to produce the result, and
 *   nothing is written to disk.
 * - The candidate is compiled through the runtime's own compile path
 *   (`previewSubjectPermissionsForCandidate` → `resolveEffectivePermissions`), so
 *   the preview and the runtime share one permission algebra.
 * - The display keeps the DNF shape: the union across Roles is OR-of-AND and is
 *   never flattened into a single AND. Two restricted Roles preview as two OR
 *   branches; only an actual `all` branch makes the union `all`.
 * - The affected table set is COMPLETE: it is derived from the before / after
 *   configuration and the Agent Role Sets, never from the tables the client
 *   happened to expand.
 * - A confirmation is signed ONLY when EVERY affected table produced its final
 *   row constraints (spec §14.2.1).
 */
import { computeCandidateDigest } from "../config-digest.js";
import {
  buildAdminPermissionContext,
  computePolicyVersion,
  previewSubjectPermissionsForCandidate,
  sourceMapEntryMatchesTable,
  type AdminPermissionContext,
  type EffectiveCapability,
  type SourceMapEntry
} from "./acl.js";
import { getAccessConfig, type AccessConfig } from "./identity.js";
import {
  loadSourceFieldCatalogWithProvenance,
  resolveServerCatalogCapability,
  type RowPolicyCatalogStage,
  type RowPolicyCatalogStatus
} from "./row-policy-catalog.js";
import { mergeRowGrants, type RowGrant } from "./row-policy.js";
import { constraintsSourceKey, lookupFinalRows } from "./agent-constraints.js";
import {
  digestCompileInputs,
  digestImpact,
  describeRowPolicyPreviewRejection,
  normalizeAffectedAgentIds,
  normalizeAffectedTables,
  parseRowPolicyConfirmation,
  rowPolicyTableKey,
  ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION,
  type RowPolicyConfirmationTable,
  type RowPolicyPreviewConfirmation,
  type RowPolicyPreviewRejectionReason
} from "../admin/row-policy-confirmation.js";

/** The table a preview is computed for: connection / schema / table. */
export interface RowPolicyPreviewTableKey {
  connectionId: string;
  schema: string;
  sourceName: string;
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

/** One Role's contribution to the table's union. */
export interface PreviewRoleGrant {
  roleId: string;
  /** This Role's row grant for the table. Absent when the Role does not grant it. */
  grant?: RowGrant;
  /** Compile failure for this Role → the table preview fails closed. */
  error?: string;
}

/** One Agent's runtime product for the table's intersection. */
export interface PreviewAgentInput {
  agentId: string;
  /** The Agent's FinalRows by source (the runtime product of `compileFinalRowsBySource`). */
  finalRowsBySource?: Record<string, RowGrant>;
}

export interface RowPolicyPreviewResult {
  tableKey: RowPolicyPreviewTableKey;
  /**
   * The union across ALL Roles that allow the table (OR).
   *
   * Spec §14.5: this is the MANAGEMENT DISPLAY only. Each Agent's FinalRows is
   * computed from that Agent's ACTUAL Role Set — the global union must never be
   * handed to an Agent.
   */
  effectiveRowGrant: RowGrant;
  /** The Roles that contributed a branch to the union. */
  roleIds: string[];
  /** Per-Agent final rows: the union AND the Agent's personal row limits. */
  finalRowsByAgent: Array<{ agentId: string; finalRows: RowGrant }>;
  /** DNF shape. The union is never flattened into one AND condition. */
  displayShape: "OR-of-AND";
}

/**
 * Spec §5.2 — final row constraints for one table.
 *
 * 1) Union across Roles (OR). The empty unit is "no grant", NEVER `all`: two
 *    restricted Roles must preview as two OR branches, and only a real `all`
 *    branch makes the union `all`.
 * 2) Per Agent: the runtime's FinalRows — the union AND the Agent's personal row
 *    limits — looked up with `lookupFinalRows`.
 */
export function computeFinalRowsForTable(
  tableKey: RowPolicyPreviewTableKey,
  roles: PreviewRoleGrant[],
  agents: PreviewAgentInput[]
): { ok: true; preview: RowPolicyPreviewResult } | { ok: false; reason: string } {
  let effective: RowGrant | undefined;
  const roleIds: string[] = [];
  for (const role of roles) {
    if (role.error) return { ok: false, reason: role.error };
    if (!role.grant) continue;
    effective = effective === undefined ? role.grant : mergeRowGrants(effective, role.grant);
    roleIds.push(role.roleId);
  }
  if (effective === undefined) {
    // No Role grants this table. That is NOT 「行权限：全部行」.
    return { ok: false, reason: "row_policy_no_applicable_grant" };
  }

  const sourceKey = constraintsSourceKey(tableKey.connectionId, tableKey.sourceName);
  const finalRowsByAgent = [];
  for (const agent of agents) {
    const own = agent.finalRowsBySource?.[sourceKey];
    if (!own) {
      return { ok: false, reason: "row_policy_no_applicable_grant" };
    }
    finalRowsByAgent.push({
      agentId: agent.agentId,
      finalRows: lookupFinalRows(agent.finalRowsBySource, tableKey.connectionId, tableKey.sourceName, own)
    });
  }

  return {
    ok: true,
    preview: {
      tableKey,
      effectiveRowGrant: effective,
      roleIds,
      finalRowsByAgent,
      displayShape: "OR-of-AND"
    }
  };
}

export interface RowPolicyPreviewCatalogSummary {
  status: RowPolicyCatalogStatus;
  catalogLoaded: boolean;
  stage?: RowPolicyCatalogStage;
  reason?: string;
  manifestPathDigest?: string;
  /** Digest of the Manifest CONTENT — part of the compile-inputs digest. */
  manifestContentDigest?: string;
  /** Digest of the overlay CONTENT — part of the compile-inputs digest. */
  overlayContentDigest?: string;
  /** The server-resolved catalog capability for this connection. */
  catalogCapability?: string;
  catalogCapabilityReason?: string;
}

export interface RowPolicyPreviewRequest {
  /** The Role the draft belongs to. */
  roleId: string;
  /** The candidate Role (draft). When absent the committed Role is previewed. */
  role?: unknown;
  /**
   * Spec §14.2.1 — the candidate is the configuration with this Role removed.
   * Used by Role deletion. It is not an overlay of a replacement Role.
   */
  removeRole?: boolean;
  /** The tables the caller is interested in. The COMPLETE impact set is derived. */
  tables: Array<{ connection: string; schema: string; name: string }>;
}

export interface RowPolicyPreviewTableOutcome {
  tableKey: RowPolicyPreviewTableKey;
  /** The table identity as the Admin asked for it (case preserved). */
  requested: { connection: string; schema: string; name: string };
  catalog: RowPolicyPreviewCatalogSummary;
  preview?: RowPolicyPreviewResult;
  error?: { code: string; message: string; reason: string };
}

export interface RowPolicyPreviewOutcome {
  ok: boolean;
  /** Digest of the in-memory candidate the preview was computed from. */
  candidateDigest: string;
  /** The policy version the preview was based on; a changed baseline needs a fresh preview. */
  basePolicyVersion: string;
  /**
   * The save confirmation. Present ONLY when every affected table produced its
   * final row constraints (spec §14.2.1).
   */
  confirmation?: RowPolicyPreviewConfirmation;
  tables: RowPolicyPreviewTableOutcome[];
}

// ─── the complete impact surface ────────────────────────────────────────────────

/**
 * One candidate Role compiled through the runtime's own compile path.
 *
 * The impact surface and the final preview MUST talk about the same grants, so
 * the compilation happens exactly once per session and is shared by both.
 */
export interface CompiledRole {
  /** The compiled capabilities. Absent when the Role failed to compile. */
  capabilities?: EffectiveCapability[];
  /** The compile failure. Present → the Role grants nothing provable. */
  error?: string;
}

/** The complete affected surface of a Role change. */
export interface RowPolicyImpact {
  tables: RowPolicyConfirmationTable[];
  agentIds: string[];
}

type SelectorLike = {
  connection?: string;
  schema?: string;
  names?: string[];
  prefix?: string;
};

type RoleLike = {
  allow?: {
    connections?: string[];
    source_scope?: "catalog_bound";
    tableSelectors?: SelectorLike[];
  };
};

function roleIdsOf(user: { roles?: unknown; role?: unknown }): string[] {
  if (Array.isArray(user.roles)) {
    return user.roles.filter((value): value is string => typeof value === "string");
  }
  if (typeof user.role === "string" && user.role.trim()) return [user.role.trim()];
  return [];
}

/**
 * Every table a Role grants, expanded through the SAME source map and the SAME
 * enabled-table range the runtime uses.
 */
function tablesGrantedByRole(
  role: RoleLike | undefined,
  context: AdminPermissionContext
): RowPolicyConfirmationTable[] {
  const out: RowPolicyConfirmationTable[] = [];
  const allow = role?.allow;
  if (!allow) return out;

  if (allow.source_scope === "catalog_bound") {
    const declared = (allow.connections ?? []).map(normalizeRef);
    const wildcard = declared.includes("*");
    for (const entry of context.sourceMap.forward.values()) {
      if (!wildcard && !declared.includes(entry.connectionId)) continue;
      const enabled = context.enabledTables.get(entry.connectionId);
      if (!enabled || !enabled.has(normalizeRef(entry.physicalTable))) continue;
      out.push({
        connectionId: entry.connectionId,
        schema: entry.schema,
        sourceName: entry.sourceName
      });
    }
    return out;
  }

  for (const selector of allow.tableSelectors ?? []) {
    const connection = selector.connection ? normalizeRef(selector.connection) : undefined;
    const schema = selector.schema ? normalizeRef(selector.schema) : "";
    if (Array.isArray(selector.names) && selector.names.length > 0) {
      for (const name of selector.names) {
        out.push({ connectionId: connection ?? "", schema, sourceName: normalizeRef(name) });
      }
    }
    if (typeof selector.prefix === "string" && selector.prefix.trim()) {
      const prefix = normalizeRef(selector.prefix);
      for (const entry of context.sourceMap.forward.values()) {
        if (connection && entry.connectionId !== connection) continue;
        if (schema && entry.schema !== schema) continue;
        if (!entry.sourceName.startsWith(prefix)) continue;
        out.push({
          connectionId: entry.connectionId,
          schema: entry.schema,
          sourceName: entry.sourceName
        });
      }
    }
  }
  return out;
}

/**
 * Resolve a declared table identity onto the RUNTIME schema.
 *
 * The runtime reads the Manifest under the schema the source map carries, so the
 * impact set must use the same schema — otherwise the preview and the save would
 * look at two different Manifest files.
 */
function resolveRuntimeTableKey(
  context: AdminPermissionContext,
  identity: RowPolicyConfirmationTable
): RowPolicyConfirmationTable | undefined {
  const requested = {
    connection: identity.connectionId,
    schema: identity.schema,
    name: identity.sourceName
  };
  for (const entry of context.sourceMap.forward.values()) {
    if (sourceMapEntryMatchesTable(entry, requested)) {
      return {
        connectionId: entry.connectionId,
        schema: entry.schema,
        sourceName: entry.sourceName
      };
    }
  }
  if (!identity.connectionId || !identity.schema || !identity.sourceName) return undefined;
  return identity;
}

/**
 * The COMPLETE impact of a Role change.
 *
 * The surface is computed from the before / after configuration and the Agent
 * Role Sets: the tables the changed Role grants (before and after) plus the
 * tables the Agents holding that Role can reach through ANY of their Roles (the
 * union those Agents actually see can change when the Role widens).
 *
 * The Agent set is the Agents that can REACH an affected table through the
 * COMPILED grants — the same grants the final preview reports. A preview that
 * did not cover every affected Agent would be a gap in the evidence, so the two
 * must be the same set.
 *
 * It is never "the tables whose text changed" and never "the tables the client
 * expanded".
 */
export function computeCompleteImpact(
  before: AccessConfig,
  after: AccessConfig,
  changedRoleIds: string[],
  context: AdminPermissionContext,
  compiledRoles: Map<string, CompiledRole>
): RowPolicyImpact {
  const roleIds = new Set(changedRoleIds);
  const tables: RowPolicyConfirmationTable[] = [];
  const agentIds: string[] = [];

  // 1) the tables the changed Roles grant (before and after)
  for (const roleId of roleIds) {
    for (const config of [before, after]) {
      tables.push(...tablesGrantedByRole(config.roles?.[roleId] as RoleLike | undefined, context));
    }
  }

  // 2) every table the Agents holding a changed Role can reach (before and after)
  const users = new Map<string, string[]>();
  for (const config of [before, after]) {
    for (const user of config.users ?? []) {
      if (!user?.id) continue;
      users.set(user.id, roleIdsOf(user));
    }
  }
  for (const roles of users.values()) {
    if (!roles.some((id) => roleIds.has(id))) continue;
    for (const config of [before, after]) {
      for (const roleId of roles) {
        tables.push(...tablesGrantedByRole(config.roles?.[roleId] as RoleLike | undefined, context));
      }
    }
  }

  const resolved: RowPolicyConfirmationTable[] = [];
  for (const identity of tables) {
    const runtime = resolveRuntimeTableKey(context, identity);
    if (runtime) resolved.push(runtime);
  }
  const normalizedTables = normalizeAffectedTables(resolved);

  // 3) the Agents that can reach an affected table, according to the COMPILED
  //    grants — the same grants the final preview reports. The compiled grants
  //    are mandatory: without them the Agent set cannot be proven, and an empty
  //    set would silently understate the impact.
  const grantingRoleIds = new Set<string>();
  for (const [roleId, compiled] of compiledRoles) {
    if (compiled.error) continue;
    for (const capability of compiled.capabilities ?? []) {
      if (normalizedTables.some((table) => capabilityGrantsTable(capability, table))) {
        grantingRoleIds.add(roleId);
        break;
      }
    }
  }
  for (const user of after.users ?? []) {
    if (!user?.id) continue;
    if (roleIdsOf(user).some((id) => grantingRoleIds.has(id))) agentIds.push(user.id);
  }

  return {
    tables: normalizedTables,
    agentIds: normalizeAffectedAgentIds(agentIds)
  };
}

// ─── the preview session ─────────────────────────────────────────────────────────

/** One affected table's compile inputs (spec §14.2.1). */
export interface RowPolicyCompileInputTable {
  connectionId: string;
  schema: string;
  sourceName: string;
  manifestContentDigest: string;
  overlayContentDigest?: string;
  catalogCapability: string;
  catalogCapabilityReason: string;
}

export interface RowPolicyPreviewSession {
  roleId: string;
  currentConfig: AccessConfig;
  candidate: AccessConfig;
  context: AdminPermissionContext;
  /** The candidate Roles compiled ONCE — shared by the impact surface and the preview. */
  compiledRoles: Map<string, CompiledRole>;
  impact: RowPolicyImpact;
  compileInputTables: RowPolicyCompileInputTable[];
  candidateDigest: string;
  impactDigest: string;
  compileInputsDigest: string;
  basePolicyVersion: string;
  baseAccessVersion: string;
}

/**
 * Build the preview session: the candidate, the context, the complete impact
 * surface and every digest a confirmation binds.
 *
 * The session is the SINGLE place the digests are produced, so the standalone
 * preview and the pre-save final preview can never drift apart.
 */
export async function buildRowPolicyPreviewSession(params: {
  roleId: string;
  /** The candidate Role (draft). When absent the committed Role is used. */
  role?: unknown;
  /** The candidate omits this Role. Takes precedence over `role`. */
  removeRole?: boolean;
  /** The configuration the draft is overlaid on. */
  baseConfig: AccessConfig;
  /** The access.yaml version of `baseConfig` (the CAS baseline). */
  baseAccessVersion: string;
}): Promise<RowPolicyPreviewSession> {
  const { roleId, role, removeRole, baseConfig, baseAccessVersion } = params;
  const candidate: AccessConfig = removeRole
    ? {
        ...baseConfig,
        roles: Object.fromEntries(
          Object.entries(baseConfig.roles ?? {}).filter(([id]) => id !== roleId)
        )
      }
    : role
      ? {
          ...baseConfig,
          roles: {
            ...(baseConfig.roles ?? {}),
            [roleId]: role as NonNullable<AccessConfig["roles"]>[string]
          }
        }
      : baseConfig;

  const context = await buildAdminPermissionContext(baseConfig);
  const basePolicyVersion = computePolicyVersion(
    context.accessConfigDigest,
    context.sourceMapVersion,
    context.toolClassificationVersion,
    context.enabledTablesDigest
  );

  const compiledRoles = await compileCandidateRoles(candidate, context);
  const impact = computeCompleteImpact(baseConfig, candidate, [roleId], context, compiledRoles);

  // The compile inputs are read FRESH: the Manifest / overlay CONTENT digests and
  // the server-resolved catalog capability of every affected table.
  const capabilityCache = new Map<string, Awaited<ReturnType<typeof resolveServerCatalogCapability>>>();
  const compileInputTables: RowPolicyCompileInputTable[] = [];
  for (const table of impact.tables) {
    let capability = capabilityCache.get(table.connectionId);
    if (!capability) {
      capability = await resolveServerCatalogCapability(table.connectionId);
      capabilityCache.set(table.connectionId, capability);
    }
    const catalog = await loadSourceFieldCatalogWithProvenance({
      connectionId: table.connectionId,
      schema: table.schema,
      sourceName: table.sourceName
    });
    compileInputTables.push({
      connectionId: table.connectionId,
      schema: table.schema,
      sourceName: table.sourceName,
      manifestContentDigest:
        catalog.status === "loaded" ? catalog.manifestContentDigest : `unavailable:${catalog.status}`,
      overlayContentDigest: catalog.status === "loaded" ? catalog.overlayContentDigest : undefined,
      catalogCapability: capability.status,
      catalogCapabilityReason: capability.reason
    });
  }

  const candidateDigest = computeCandidateDigest(candidate);
  const impactDigest = digestImpact(impact);
  const compileInputsDigest = digestCompileInputs({
    sourceMapVersion: context.sourceMapVersion,
    enabledTablesDigest: context.enabledTablesDigest,
    toolClassificationVersion: context.toolClassificationVersion,
    tables: compileInputTables
  });

  return {
    roleId,
    currentConfig: baseConfig,
    candidate,
    context,
    compiledRoles,
    impact,
    compileInputTables,
    candidateDigest,
    impactDigest,
    compileInputsDigest,
    basePolicyVersion,
    baseAccessVersion
  };
}

/** The confirmation material a successful session signs. */
export function makeRowPolicyPreviewConfirmation(
  session: RowPolicyPreviewSession
): RowPolicyPreviewConfirmation {
  return {
    vocabularyVersion: ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION,
    candidateDigest: session.candidateDigest,
    baseAccessVersion: session.baseAccessVersion,
    basePolicyVersion: session.basePolicyVersion,
    compileInputsDigest: session.compileInputsDigest,
    impactDigest: session.impactDigest,
    affectedTables: session.impact.tables,
    affectedAgentIds: session.impact.agentIds
  };
}

function capabilityGrantForTable(
  capabilities: EffectiveCapability[] | undefined,
  tableKey: RowPolicyPreviewTableKey
): RowGrant | undefined {
  const hit = (capabilities ?? []).find(
    (capability) =>
      capability.connectionId === tableKey.connectionId &&
      (capability.sourceName === tableKey.sourceName || capability.physicalTable === tableKey.sourceName)
  );
  return hit?.rowGrant;
}

/**
 * Does a compiled capability grant the given (normalized) runtime table?
 *
 * The comparison mirrors `capabilityGrantForTable` exactly — the impact surface
 * and the final preview must agree on what a Role grants.
 */
function capabilityGrantsTable(
  capability: EffectiveCapability,
  table: RowPolicyConfirmationTable
): boolean {
  if (capability.connectionId !== table.connectionId) return false;
  return capability.sourceName === table.sourceName || capability.physicalTable === table.sourceName;
}

/**
 * Compile every candidate Role ONCE through the runtime's own compile path.
 *
 * The impact surface and the final preview MUST talk about the same grants, so
 * the compilation is shared: the preview never re-compiles with a different
 * input than the impact surface was derived from.
 */
export async function compileCandidateRoles(
  candidate: AccessConfig,
  context: AdminPermissionContext
): Promise<Map<string, CompiledRole>> {
  const compiledRoles = new Map<string, CompiledRole>();
  const roleIds = Object.keys(candidate.roles ?? {}).sort();
  for (const id of roleIds) {
    const resolved = await previewSubjectPermissionsForCandidate(
      candidate,
      { userId: `__row_policy_role_preview__:${id}`, role: id, enabled: true },
      { sourceMap: context.sourceMap, enabledTables: context.enabledTables }
    );
    if (!resolved.ok) {
      compiledRoles.set(id, { error: resolved.reason });
      continue;
    }
    compiledRoles.set(id, { capabilities: resolved.permissions.capabilities });
  }
  return compiledRoles;
}

/**
 * Conservative relevance filter: may this Role's failure concern the table?
 *
 * This is NOT a permission decision — it only decides whether a broken Role has to
 * fail the preview. It over-approximates on purpose: an unknown selector shape is
 * treated as "may target the table".
 */
function roleMayTargetTable(
  role: NonNullable<AccessConfig["roles"]>[string] | undefined,
  table: { connection: string; schema: string; name: string }
): boolean {
  if (!role?.allow) return false;
  if (role.allow.source_scope === "catalog_bound") return true;
  const selectors = role.allow.tableSelectors ?? [];
  if (selectors.length === 0) return false;
  const connection = normalizeRef(table.connection);
  const schema = normalizeRef(table.schema);
  const name = normalizeRef(table.name);
  return selectors.some((selector) => {
    if (selector.connection && normalizeRef(selector.connection) !== connection) return false;
    if (selector.schema && normalizeRef(selector.schema) !== schema) return false;
    if (Array.isArray(selector.names) && selector.names.length > 0) {
      return selector.names.some((candidate) => normalizeRef(candidate) === name);
    }
    if (typeof selector.prefix === "string" && selector.prefix.trim()) {
      return name.startsWith(normalizeRef(selector.prefix));
    }
    // Unknown shape → assume it may target the table.
    return true;
  });
}

/** Does a compile failure mention this table? (The R5 reason carries the four-tuple.) */
function errorMentionsTable(error: string, table: { connection: string; name: string }): boolean {
  const name = normalizeRef(table.name);
  const connection = normalizeRef(table.connection);
  const lower = error.toLowerCase();
  return lower.includes(name) || lower.includes(connection);
}

/**
 * Compute the per-table preview for every affected table of a session.
 *
 * The SAME function serves the standalone preview and the pre-save final
 * preview, so the two can never diverge.
 */
export async function previewSessionTables(
  session: RowPolicyPreviewSession
): Promise<RowPolicyPreviewTableOutcome[]> {
  const { candidate, context, impact } = session;

  // ── 1) the candidate Roles, compiled ONCE by the session builder ────────────
  // The SAME compilation backs the impact surface, so the affected Agent set and
  // the previewed Agent set can never disagree.
  const compiledRoles = session.compiledRoles;
  const roleIds = Object.keys(candidate.roles ?? {}).sort();

  // ── 2) per table: union across Roles + per-Agent intersection ──────────────
  const outcomes: RowPolicyPreviewTableOutcome[] = [];

  for (const table of impact.tables) {
    const entry: SourceMapEntry | undefined = [...context.sourceMap.forward.values()].find(
      (candidateEntry) =>
        sourceMapEntryMatchesTable(candidateEntry, {
          connection: table.connectionId,
          schema: table.schema,
          name: table.sourceName
        })
    );
    const runtimeSchema = entry?.schema ?? table.schema;
    const runtimeTableKey: RowPolicyPreviewTableKey = {
      connectionId: table.connectionId,
      schema: runtimeSchema,
      sourceName: table.sourceName
    };

    // The catalog status uses the SAME schema the runtime uses, so the preview and
    // the runtime agree on 「清单不可用」 (D-03 policy: the requested path only).
    const capability = await resolveServerCatalogCapability(runtimeTableKey.connectionId);
    const catalogResult = await loadSourceFieldCatalogWithProvenance({
      connectionId: runtimeTableKey.connectionId,
      schema: runtimeSchema,
      sourceName: runtimeTableKey.sourceName
    });
    const catalog: RowPolicyPreviewCatalogSummary = {
      status: catalogResult.status,
      catalogLoaded: catalogResult.catalogLoaded,
      stage: catalogResult.status === "manifest_unavailable" ? catalogResult.stage : undefined,
      reason:
        catalogResult.status === "loaded"
          ? undefined
          : catalogResult.status === "manifest_unavailable"
            ? `row_policy_catalog_unavailable:${catalogResult.stage}:${catalogResult.reason}`
            : `row_policy_catalog_capability_unknown:${catalogResult.reason}`,
      manifestPathDigest:
        catalogResult.status === "loaded" ? catalogResult.manifestPathDigest : undefined,
      manifestContentDigest:
        catalogResult.status === "loaded" ? catalogResult.manifestContentDigest : undefined,
      overlayContentDigest:
        catalogResult.status === "loaded" ? catalogResult.overlayContentDigest : undefined,
      catalogCapability: capability.status,
      catalogCapabilityReason: capability.reason
    };

    // Which Roles grant this table?
    const roleGrants: PreviewRoleGrant[] = [];
    const grantingRoleIds = new Set<string>();
    let roleFailure: string | undefined;
    for (const id of roleIds) {
      const compiled = compiledRoles.get(id);
      if (compiled?.error) {
        const relevant =
          roleMayTargetTable(candidate.roles?.[id], {
            connection: runtimeTableKey.connectionId,
            schema: runtimeTableKey.schema,
            name: runtimeTableKey.sourceName
          }) ||
          errorMentionsTable(compiled.error, {
            connection: runtimeTableKey.connectionId,
            name: runtimeTableKey.sourceName
          });
        if (relevant) {
          roleFailure = compiled.error;
          break;
        }
        continue;
      }
      const grant = compiled?.capabilities
        ? capabilityGrantForTable(compiled.capabilities, runtimeTableKey)
        : undefined;
      if (!grant) continue;
      roleGrants.push({ roleId: id, grant });
      grantingRoleIds.add(id);
    }

    const tableOutcome: RowPolicyPreviewTableOutcome = {
      tableKey: runtimeTableKey,
      requested: {
        connection: runtimeTableKey.connectionId,
        schema: runtimeTableKey.schema,
        name: runtimeTableKey.sourceName
      },
      catalog
    };

    if (roleFailure) {
      tableOutcome.error = {
        code: "ROW_POLICY_PREVIEW_FAILED",
        message: roleFailure,
        reason: roleFailure
      };
      outcomes.push(tableOutcome);
      continue;
    }

    if (roleGrants.length === 0) {
      tableOutcome.error = {
        code: "ROW_POLICY_NO_APPLICABLE_GRANT",
        message: "row_policy_no_applicable_grant",
        reason: "row_policy_no_applicable_grant"
      };
      outcomes.push(tableOutcome);
      continue;
    }

    // Agents that can reach this table: their Role Set intersects the granting Roles.
    const reachableAgents = (candidate.users ?? []).filter((user) => {
      const userRoleIds = roleIdsOf(user);
      return userRoleIds.some((id) => grantingRoleIds.has(id));
    });

    const agentInputs: PreviewAgentInput[] = [];
    for (const agent of reachableAgents) {
      const resolved = await previewSubjectPermissionsForCandidate(
        candidate,
        {
          userId: agent.id,
          name: agent.name,
          enabled: agent.enabled,
          role: agent.role,
          roles: agent.roles,
          constraints: agent.constraints
        },
        { sourceMap: context.sourceMap, enabledTables: context.enabledTables }
      );
      if (!resolved.ok) {
        tableOutcome.error = {
          code: "ROW_POLICY_PREVIEW_FAILED",
          message: resolved.reason,
          reason: resolved.reason
        };
        agentInputs.length = 0;
        break;
      }
      agentInputs.push({
        agentId: agent.id,
        finalRowsBySource: resolved.permissions.finalRowsBySource
      });
    }
    if (tableOutcome.error) {
      outcomes.push(tableOutcome);
      continue;
    }

    const computed = computeFinalRowsForTable(runtimeTableKey, roleGrants, agentInputs);
    if (!computed.ok) {
      tableOutcome.error = {
        code: "ROW_POLICY_PREVIEW_FAILED",
        message: computed.reason,
        reason: computed.reason
      };
      outcomes.push(tableOutcome);
      continue;
    }
    tableOutcome.preview = computed.preview;
    outcomes.push(tableOutcome);
  }

  return outcomes;
}

/**
 * Spec §5.3 / §14.2.2 — preview a row-policy draft against the in-memory candidate.
 *
 * Read-only: the candidate is never written and the committed policy is never
 * swapped in. The result is bound to `candidateDigest` and reports
 * `basePolicyVersion` so the caller can require a fresh preview after a baseline
 * change.
 *
 * The confirmation is signed ONLY when every affected table succeeded.
 */
export async function previewRowPolicyDraft(
  request: RowPolicyPreviewRequest
): Promise<RowPolicyPreviewOutcome> {
  const { readAccessYamlVersion } = await import("../admin/access-config.js");
  const currentVersion = await readAccessYamlVersion(await resolveProjectRootSafe());
  const currentConfig = await getAccessConfig({ fresh: true });

  const session = await buildRowPolicyPreviewSession({
    roleId: request.roleId,
    role: request.removeRole ? undefined : request.role,
    removeRole: request.removeRole,
    baseConfig: currentConfig,
    baseAccessVersion: currentVersion.version
  });

  const tables = await previewSessionTables(session);
  const ok = tables.every((outcome) => previewOutcomeAcceptsConfirmation(outcome, request.removeRole === true));

  return {
    ok,
    candidateDigest: session.candidateDigest,
    basePolicyVersion: session.basePolicyVersion,
    confirmation: ok ? makeRowPolicyPreviewConfirmation(session) : undefined,
    tables
  };
}

async function resolveProjectRootSafe(): Promise<string> {
  const { resolveProjectRoot } = await import("../project.js");
  return resolveProjectRoot();
}

// ─── the pre-save final preview ───────────────────────────────────────────────────

export interface RowPolicyConfirmationVerification {
  ok: boolean;
  reason?: RowPolicyPreviewRejectionReason;
  message?: string;
  detail?: Record<string, unknown>;
  /** The rebuilt session — present when the verification reached the preview step. */
  session?: RowPolicyPreviewSession;
  /** The final per-table preview — present when the verification reached it. */
  outcomes?: RowPolicyPreviewTableOutcome[];
}

/**
 * Spec §14.2.2 — verify a save confirmation INSIDE the shared publish window.
 *
 * The server never trusts the table / Agent list the client echoed back: it
 * rebuilds the candidate from the FRESH access snapshot, re-reads the compile
 * inputs, recomputes the complete impact surface and re-runs the SAME final
 * preview, then compares every digest.
 *
 * The comparison order is the contract's order (spec §14.2.2):
 *   baseline → final preview → policy baseline → compile inputs → impact →
 *   candidate → final preview coverage.
 *
 * Every rejection happens BEFORE the durable intent and before any
 * configuration write: zero configuration write, zero row-policy intent.
 */
/**
 * A table with no remaining grant is a successful description of a Role
 * deletion: the table is not granted. It is not 「全部行」, and it is not a
 * confirmation of any other write.
 */
function previewOutcomeAcceptsConfirmation(
  outcome: RowPolicyPreviewTableOutcome,
  removeRole: boolean
): boolean {
  if (outcome.preview) return true;
  return removeRole && outcome.error?.reason === "row_policy_no_applicable_grant";
}

export async function verifyRowPolicyPreviewConfirmation(params: {
  roleId: string;
  /** The candidate Role (draft) that is about to be written. */
  role?: unknown;
  /** The candidate is the configuration with this Role removed. */
  removeRole?: boolean;
  /** The untrusted confirmation from the request body. */
  confirmation: unknown;
  /** The FRESH access configuration, read inside the publish window. */
  baseConfig: AccessConfig;
  /** The FRESH access.yaml version, read inside the publish window. */
  baseAccessVersion: string;
}): Promise<RowPolicyConfirmationVerification> {
  const { roleId, role, removeRole, confirmation, baseConfig, baseAccessVersion } = params;

  const parsed = parseRowPolicyConfirmation(confirmation);
  if (!parsed) {
    return {
      ok: false,
      reason: "missing",
      message: describeRowPolicyPreviewRejection("missing")
    };
  }
  if (parsed.vocabularyVersion !== ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION) {
    return {
      ok: false,
      reason: "missing",
      message: describeRowPolicyPreviewRejection("missing"),
      detail: {
        expectedVocabularyVersion: ROW_POLICY_CONFIRMATION_VOCABULARY_VERSION,
        actualVocabularyVersion: parsed.vocabularyVersion
      }
    };
  }

  // 1) The access baseline must still be the one the preview was taken against.
  if (baseAccessVersion !== parsed.baseAccessVersion) {
    return {
      ok: false,
      reason: "baseline_changed",
      message: describeRowPolicyPreviewRejection("baseline_changed"),
      detail: {
        expectedBaseAccessVersion: parsed.baseAccessVersion,
        actualBaseAccessVersion: baseAccessVersion
      }
    };
  }

  // 2) Rebuild the candidate from the fresh configuration.
  const session = await buildRowPolicyPreviewSession({
    roleId,
    role: removeRole ? undefined : role,
    removeRole,
    baseConfig,
    baseAccessVersion
  });

  // 3) Re-run the SAME final preview over the complete impact surface.
  //    Spec §14.2.2 — the preview runs BEFORE the digest comparisons: a preview
  //    that cannot be produced is the real reason and must not be reported as a
  //    changed digest.
  const outcomes = await previewSessionTables(session);
  const failed = outcomes.find((outcome) => !previewOutcomeAcceptsConfirmation(outcome, removeRole === true));
  if (failed) {
    return {
      ok: false,
      reason: "preview_failed",
      message: describeRowPolicyPreviewRejection("preview_failed"),
      detail: {
        table: failed.requested,
        error: failed.error ?? null
      },
      session,
      outcomes
    };
  }

  // 4) The runtime policy input baseline.
  if (session.basePolicyVersion !== parsed.basePolicyVersion) {
    return {
      ok: false,
      reason: "baseline_changed",
      message: describeRowPolicyPreviewRejection("baseline_changed"),
      detail: {
        expectedBasePolicyVersion: parsed.basePolicyVersion,
        actualBasePolicyVersion: session.basePolicyVersion
      },
      session
    };
  }

  if (session.compileInputsDigest !== parsed.compileInputsDigest) {
    return {
      ok: false,
      reason: "compile_inputs_changed",
      message: describeRowPolicyPreviewRejection("compile_inputs_changed"),
      detail: {
        expectedCompileInputsDigest: parsed.compileInputsDigest,
        actualCompileInputsDigest: session.compileInputsDigest
      },
      session
    };
  }

  if (session.impactDigest !== parsed.impactDigest) {
    return {
      ok: false,
      reason: "impact_changed",
      message: describeRowPolicyPreviewRejection("impact_changed"),
      detail: {
        expectedImpactDigest: parsed.impactDigest,
        actualImpactDigest: session.impactDigest,
        expectedAffectedTables: parsed.affectedTables,
        actualAffectedTables: session.impact.tables,
        expectedAffectedAgentIds: parsed.affectedAgentIds,
        actualAffectedAgentIds: session.impact.agentIds
      },
      session
    };
  }

  if (session.candidateDigest !== parsed.candidateDigest) {
    return {
      ok: false,
      reason: "candidate_mismatch",
      message: describeRowPolicyPreviewRejection("candidate_mismatch"),
      detail: {
        expectedCandidateDigest: parsed.candidateDigest,
        actualCandidateDigest: session.candidateDigest
      },
      session
    };
  }

  // 5) The final preview must cover EXACTLY the confirmed impact surface.
  const previewedTables = normalizeAffectedTables(
    outcomes.map((outcome) => ({
      connectionId: outcome.tableKey.connectionId,
      schema: outcome.tableKey.schema,
      sourceName: outcome.tableKey.sourceName
    }))
  );
  const previewedAgentIds = normalizeAffectedAgentIds(
    outcomes.flatMap((outcome) =>
      (outcome.preview?.finalRowsByAgent ?? []).map((entry) => entry.agentId)
    )
  );
  const expectedTables = normalizeAffectedTables(parsed.affectedTables);
  const expectedAgentIds = normalizeAffectedAgentIds(parsed.affectedAgentIds);
  const tablesMatch =
    previewedTables.length === expectedTables.length &&
    previewedTables.every(
      (table, index) => rowPolicyTableKey(table) === rowPolicyTableKey(expectedTables[index]!)
    );
  const agentsMatch =
    previewedAgentIds.length === expectedAgentIds.length &&
    previewedAgentIds.every((id, index) => id === expectedAgentIds[index]);

  if (!tablesMatch || !agentsMatch) {
    return {
      ok: false,
      reason: "impact_changed",
      message: describeRowPolicyPreviewRejection("impact_changed"),
      detail: {
        expectedAffectedTables: expectedTables,
        previewedTables,
        expectedAffectedAgentIds: expectedAgentIds,
        previewedAgentIds
      },
      session,
      outcomes
    };
  }

  return { ok: true, session, outcomes };
}
