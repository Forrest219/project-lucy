/**
 * Lucy v0.25 (L25-14 §3.2 / §5.2 / §5.3) — final-row-constraint preview (R2).
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.2 (R2 最终行约束预览), §5.2 (最终行约束计算), §5.3 (保存前校验、预览与审计闭环),
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
 * - The result is bound to a candidate digest and reports the baseline policy
 *   version, so the caller can detect a baseline change and require a fresh preview.
 */
import { computeCandidateDigest } from "../config-digest.js";
import {
  buildAdminPermissionContext,
  computePolicyVersion,
  previewSubjectPermissionsForCandidate,
  sourceMapEntryMatchesTable,
  type EffectiveCapability,
  type SourceMapEntry
} from "./acl.js";
import { getAccessConfig, type AccessConfig } from "./identity.js";
import {
  loadSourceFieldCatalogWithProvenance,
  type RowPolicyCatalogStage,
  type RowPolicyCatalogStatus
} from "./row-policy-catalog.js";
import { mergeRowGrants, type RowGrant } from "./row-policy.js";
import { lookupFinalRows } from "./agent-constraints.js";

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
  /** Union across Roles (OR). Wider than any single Role when several Roles apply. */
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

  const finalRowsByAgent = agents.map((agent) => ({
    agentId: agent.agentId,
    finalRows: lookupFinalRows(
      agent.finalRowsBySource,
      tableKey.connectionId,
      tableKey.sourceName,
      effective
    )
  }));

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
}

export interface RowPolicyPreviewRequest {
  /** The Role the draft belongs to. */
  roleId: string;
  /** The candidate Role (draft). When absent the committed Role is previewed. */
  role?: unknown;
  /** The tables to preview. */
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
  tables: RowPolicyPreviewTableOutcome[];
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
 * Spec §5.3 — preview a row-policy draft against the in-memory candidate.
 *
 * Read-only: the candidate is never written and the committed policy is never
 * swapped in. The result is bound to `candidateDigest` and reports
 * `basePolicyVersion` so the caller can require a fresh preview after a baseline
 * change.
 */
export async function previewRowPolicyDraft(
  request: RowPolicyPreviewRequest
): Promise<RowPolicyPreviewOutcome> {
  const currentConfig = await getAccessConfig({ fresh: true });
  const roleId = request.roleId;
  const candidate: AccessConfig = request.role
    ? {
        ...currentConfig,
        roles: {
          ...(currentConfig.roles ?? {}),
          [roleId]: request.role as NonNullable<AccessConfig["roles"]>[string]
        }
      }
    : currentConfig;

  const candidateDigest = computeCandidateDigest(candidate);
  const context = await buildAdminPermissionContext(currentConfig);
  const basePolicyVersion = computePolicyVersion(
    context.accessConfigDigest,
    context.sourceMapVersion,
    context.toolClassificationVersion,
    context.enabledTablesDigest
  );

  const tables = request.tables.map((table) => ({
    requested: { connection: table.connection, schema: table.schema, name: table.name },
    tableKey: {
      connectionId: normalizeRef(table.connection),
      schema: normalizeRef(table.schema),
      sourceName: normalizeRef(table.name)
    }
  }));

  // ── 1) compile every candidate Role ONCE, through the runtime's own path ────
  const roleIds = Object.keys(candidate.roles ?? {}).sort();
  const compiledRoles = new Map<string, { capabilities?: EffectiveCapability[]; error?: string }>();
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

  // ── 2) per table: union across Roles + per-Agent intersection ──────────────
  const outcomes: RowPolicyPreviewTableOutcome[] = [];

  for (const table of tables) {
    const entry: SourceMapEntry | undefined = [...context.sourceMap.forward.values()].find(
      (candidateEntry) => sourceMapEntryMatchesTable(candidateEntry, table.requested)
    );
    const runtimeSchema = entry?.schema ?? table.tableKey.schema;
    const runtimeTableKey: RowPolicyPreviewTableKey = {
      connectionId: table.tableKey.connectionId,
      schema: runtimeSchema,
      sourceName: table.tableKey.sourceName
    };

    // The catalog status uses the SAME schema the runtime uses, so the preview and
    // the runtime agree on 「清单不可用」 (D-03 policy: the requested path only).
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
        catalogResult.status === "loaded" ? catalogResult.manifestPathDigest : undefined
    };

    // Which Roles grant this table?
    const roleGrants: PreviewRoleGrant[] = [];
    const grantingRoleIds = new Set<string>();
    let roleFailure: string | undefined;
    for (const id of roleIds) {
      const compiled = compiledRoles.get(id);
      if (compiled?.error) {
        const relevant =
          roleMayTargetTable(candidate.roles?.[id], table.requested) ||
          errorMentionsTable(compiled.error, table.requested);
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
      requested: table.requested,
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
      const userRoleIds = Array.isArray(user.roles)
        ? user.roles.filter((value): value is string => typeof value === "string")
        : typeof user.role === "string" && user.role.trim()
          ? [user.role.trim()]
          : [];
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

  return {
    ok: outcomes.every((outcome) => Boolean(outcome.preview)),
    candidateDigest,
    basePolicyVersion,
    tables: outcomes
  };
}
