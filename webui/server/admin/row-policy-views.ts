/**
 * Lucy v0.25 P1 — L25-14 R3: 按表反查（行权限视图）.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.3 (R3 按表读取模型), §5.3 (R3 读取与降级), §6.2 (独立行权限视图);
 *   P1-D5（独立只读）、P1-D6（不可满足不是空集授权值）、P1-D7（同源不等于同数）.
 * Upstream: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.3, §5.2, §5.3.
 *
 * This module is READ-ONLY. It never writes configuration, never swaps the
 * committed policy in and never takes the publish lock.
 *
 * Three things it deliberately does NOT do (P1-D6 / §6.2):
 *
 *  1. It does not invent a third `RowGrant` variant. 「不可满足」stays a
 *     diagnostic on the Agent branch; the row grant itself is unchanged.
 *  2. It does not show 「行权限：全部行」unless a compiled branch really is
 *     `all`. Two restricted Roles stay two OR branches.
 *  3. It does not share one empty state between 「无授权」, 「不可满足」,
 *     「编译失败」 and 「空筛选」 — the four are distinct `status` values.
 *
 * The final-row computation is NOT re-implemented here: `computeFinalRowsForTable`
 * (P0-2 §5.2) is the single implementation of 「Role 间 OR 并集 + 每 Agent 交集」,
 * and `lookupFinalRows` is the single implementation of the per-Agent product.
 */
import {
  buildAdminPermissionContext,
  capabilityDigest,
  compileRoleForAdmin,
  resolveEffectivePermissionsBatchForAdmin,
  type AdminPermissionContext,
  type EffectiveCapability
} from "../proxy/acl.js";
import {
  computeFinalRowsForTable,
  type PreviewAgentInput,
  type PreviewRoleGrant,
  type RowPolicyPreviewTableKey
} from "../proxy/row-policy-preview.js";
import { constraintsSourceKey } from "../proxy/agent-constraints.js";
import { loadSourceFieldCatalogWithProvenance } from "../proxy/row-policy-catalog.js";
import type { RowGrant, RowPolicyPredicateInput } from "../proxy/row-policy.js";
import { readAccessSnapshot, type AccessSnapshot } from "./permission-display.js";
import {
  currentPolicyGeneration,
  snapshotContextOf,
  type PolicyGeneration,
  type SnapshotContext
} from "./snapshot-identity.js";
import {
  expandRowPolicyTemplatesInConfig,
  selectorsOfRole,
  templateNameOf,
  type AccessConfigWithTemplates,
  type RowPolicyTemplateSelectorShape
} from "./row-policy-templates.js";
import { tableCountKey } from "./counting.js";

/** The full table identity. Two same-named tables of different Schemas never merge. */
export type RowPolicyTableIdentity = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable?: string;
};

/**
 * The outcome of one table lookup.
 *
 * The four states P1-1 §6.2 / RTV-03 require to be distinguishable are
 * `no_applicable_grant`（无授权）, `final_rows_unsatisfiable`（不可满足）,
 * `compile_failed`（编译失败）and `no_match`（空筛选）. `unavailable` is the
 * additional case where the snapshot itself could not be read.
 */
export type RowPolicyViewStatus =
  | "ok"
  | "no_applicable_grant"
  | "final_rows_unsatisfiable"
  | "compile_failed"
  | "no_match"
  | "unavailable";

/** One Role's branch for the table. */
export type RowPolicyViewRoleBranch = {
  roleId: string;
  /** `all` / `scoped` / `null`（该角色不授予这张表）. */
  rowAccess: "all" | "scoped" | null;
  /** The templates the matching selector(s) reference. */
  templateRefs: string[];
  /** The inline predicates of the matching selector(s), as authored. */
  inlinePredicates: RowPolicyPredicateInput[];
  /** This Role's own row grant for the table. Never merged with another Role. */
  rowGrant: RowGrant | null;
  /** Compile failure reason; present only when the Role could not be compiled. */
  error?: string;
};

/** One Agent's branch for the table. */
export type RowPolicyViewAgentBranch = {
  agentId: string;
  enabled: boolean;
  /** The Agent's personal row limits for this table. */
  constraints: RowPolicyPredicateInput[];
  /** The Agent's runtime product: the union AND the personal row limits. */
  finalRows: RowGrant | null;
  error?: string;
};

export type RowPolicyTableView = {
  snapshot: SnapshotContext;
  table: RowPolicyTableIdentity & { physicalTable: string };
  /** The snapshot degradation state (`ok` / `partial` / `unavailable`). */
  state: SnapshotContext["state"];
  /** The table outcome — the four states never share one empty state. */
  status: RowPolicyViewStatus;
  /** Why the status is what it is. */
  reason?: string;
  roles: RowPolicyViewRoleBranch[];
  /** The union across Roles. `null` when no Role grants the table. */
  effectiveRowGrant: RowGrant | null;
  agents: RowPolicyViewAgentBranch[];
  catalog: {
    status: "loaded" | "manifest_unavailable" | "catalog_capability_unknown";
    catalogLoaded: boolean;
    stage?: string;
    reason?: string;
  };
  /** The Roles / Agents that failed to resolve. */
  failures: Array<{ subjectId: string; reason: string }>;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Does a selector cover this table?
 *
 * Deliberately mirrors the runtime's own selector matching (connection /
 * schema / names / prefix). A selector whose shape is unknown is treated as
 * "may cover the table" — over-approximating keeps a broken Role visible
 * instead of silently dropping it from the view.
 */
export function selectorCoversTable(
  selector: RowPolicyTemplateSelectorShape,
  table: { connectionId: string; schema: string; sourceName: string; physicalTable?: string }
): boolean {
  if (selector.connection && normalize(selector.connection) !== normalize(table.connectionId)) return false;
  if (selector.schema && normalize(selector.schema) !== normalize(table.schema)) return false;
  const names = Array.isArray(selector.names) ? selector.names : [];
  if (names.length > 0) {
    const target = new Set([normalize(table.sourceName)]);
    if (table.physicalTable) target.add(normalize(table.physicalTable));
    return names.some((name) => target.has(normalize(name)));
  }
  if (typeof selector.prefix === "string" && selector.prefix.trim()) {
    return normalize(table.sourceName).startsWith(normalize(selector.prefix));
  }
  return true;
}

function inlinePredicatesOf(selector: RowPolicyTemplateSelectorShape): RowPolicyPredicateInput[] {
  const raw = selector.row_policy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const predicates = (raw as Record<string, unknown>).predicates;
  if (!Array.isArray(predicates)) return [];
  return predicates as RowPolicyPredicateInput[];
}

/** The compiled state shared by the list and the single-table read. */
export type RowPolicyViewBase = {
  snapshot: AccessSnapshot;
  context: AdminPermissionContext;
  config: AccessConfigWithTemplates;
  /** Per Role: the compiled capabilities and the compile error, if any. */
  roles: Array<{ roleId: string; ok: boolean; reason?: string; capabilities: EffectiveCapability[] }>;
  /** The roles whose template reference did not resolve. */
  templateIssueRoleIds: string[];
  generation: PolicyGeneration;
};

/**
 * Read the shared base: snapshot → expanded config → admin context → per-Role compile.
 *
 * The Roles are compiled ONE BY ONE (`compileRoleForAdmin`), never by splitting
 * the merged Agent permissions — a union loses 「which table came from which
 * Role」and P1-1 §3.3 needs the per-Role branch.
 */
export async function readRowPolicyViewBase(projectRoot: string): Promise<
  | { ok: true; base: RowPolicyViewBase }
  | { ok: false; snapshot: AccessSnapshot }
> {
  const snapshot = await readAccessSnapshot(projectRoot);
  if (!snapshot.runtimeConfig) return { ok: false, snapshot };
  const expanded = expandRowPolicyTemplatesInConfig(snapshot.runtimeConfig);
  const context = await buildAdminPermissionContext(expanded.config);
  const roles: RowPolicyViewBase["roles"] = [];
  for (const roleId of Object.keys(expanded.config.roles ?? {}).sort()) {
    const compiled = await compileRoleForAdmin(roleId, context);
    roles.push({
      roleId,
      ok: compiled.ok,
      reason: compiled.reason,
      capabilities: compiled.ok ? (compiled.capabilities ?? []) : []
    });
  }
  const templateIssueRoleIds = [
    ...new Set(expanded.issues.map((issue) => issue.roleId).filter(Boolean))
  ] as string[];
  return {
    ok: true,
    base: {
      snapshot,
      context,
      config: expanded.config,
      roles,
      templateIssueRoleIds,
      generation: currentPolicyGeneration()
    }
  };
}

/** The snapshot identity of one view, with the capability digest of what it displays. */
function snapshotContextOfBase(
  base: RowPolicyViewBase,
  capabilities: EffectiveCapability[],
  failures: Array<{ subjectId: string; reason: string }>
): SnapshotContext {
  return snapshotContextOf({
    snapshot: base.snapshot,
    capabilityDigest: capabilityDigest(capabilities),
    failures,
    generation: base.generation
  });
}

/**
 * The grant a Role gives to one table.
 *
 * The Schema decides when both sides know it: two Schemas of one connection may
 * share a source name, and matching on `(connection, sourceName)` alone made
 * the single-table view show ANOTHER table's grant (possibly `all`) for the
 * requested one — the exact merge RTV-04 / P1-D7 forbid. When either side has
 * no Schema, the comparison stays on connection + source name, because an
 * incomplete identity is not evidence of a different table.
 */
function grantForTable(
  capabilities: EffectiveCapability[],
  table: { connectionId: string; schema: string; sourceName: string }
): RowGrant | null {
  const hit = capabilities.find(
    (capability) =>
      normalize(capability.connectionId) === normalize(table.connectionId) &&
      normalize(capability.sourceName) === normalize(table.sourceName) &&
      (normalize(table.schema) === "" ||
        normalize(capability.schema) === "" ||
        normalize(capability.schema) === normalize(table.schema))
  );
  return hit?.rowGrant ?? null;
}

/**
 * Every required compile failed and nothing was granted ⇒ `unavailable`.
 *
 * P1-1 §5.3 / RTV-05: 「全部失败为 `unavailable`，不显示零授权」. An empty table
 * list would be indistinguishable from 「没有授权」, so the two read paths share
 * this one predicate and can never disagree on the same condition.
 */
function everyCompileFailed(grantedCount: number, failureCount: number): boolean {
  return grantedCount === 0 && failureCount > 0;
}

/**
 * One Role's branch for one table.
 *
 * The Role's OWN grant is used — never the merged union — so the DNF shape
 * stays visible (P1-D5 / §6.2 「OR-of-AND 不得拍平」).
 */
function roleBranch(
  base: RowPolicyViewBase,
  role: RowPolicyViewBase["roles"][number],
  table: RowPolicyTableIdentity
): RowPolicyViewRoleBranch {
  const templateRefs: string[] = [];
  const inlinePredicates: RowPolicyPredicateInput[] = [];
  const roleConfig = base.config.roles?.[role.roleId];
  const selectors = selectorsOfRole(roleConfig);
  let coversTable = false;
  for (const selector of selectors) {
    if (!selectorCoversTable(selector, table)) continue;
    coversTable = true;
    const templateName = templateNameOf(selector);
    if (templateName && !templateRefs.includes(templateName)) templateRefs.push(templateName);
    inlinePredicates.push(...inlinePredicatesOf(selector));
  }
  if (!role.ok) {
    // A Role that failed to compile only fails the tables it MAY target. A
    // broken Role for another table must not turn a healthy table into a
    // partial one.
    if (!coversTable) {
      return { roleId: role.roleId, rowAccess: null, templateRefs, inlinePredicates, rowGrant: null };
    }
    return {
      roleId: role.roleId,
      rowAccess: null,
      templateRefs,
      inlinePredicates,
      rowGrant: null,
      error: role.reason ?? "role_resolution_failed"
    };
  }
  const grant = grantForTable(role.capabilities, table);
  if (!grant) {
    return { roleId: role.roleId, rowAccess: null, templateRefs, inlinePredicates, rowGrant: null };
  }
  return {
    roleId: role.roleId,
    rowAccess: grant.kind === "all" ? "all" : "scoped",
    templateRefs,
    inlinePredicates,
    rowGrant: grant
  };
}

type AgentRead = {
  branches: RowPolicyViewAgentBranch[];
  failures: Array<{ subjectId: string; reason: string }>;
  /** The inputs `computeFinalRowsForTable` needs. */
  inputs: PreviewAgentInput[];
};

/**
 * Resolve the Agents that can reach the table and their personal row limits.
 *
 * The Agents are resolved ONCE — the same resolution the runtime uses — so the
 * view and the runtime cannot drift.
 */
async function readAgentBranches(
  base: RowPolicyViewBase,
  table: RowPolicyTableIdentity,
  grantingRoleIds: string[]
): Promise<AgentRead> {
  const branches: RowPolicyViewAgentBranch[] = [];
  const failures: Array<{ subjectId: string; reason: string }> = [];
  const inputs: PreviewAgentInput[] = [];
  if (grantingRoleIds.length === 0) return { branches, failures, inputs };

  const users = base.config.users ?? [];
  const reachable = users.filter((user) => {
    const roleIds = Array.isArray(user.roles)
      ? user.roles.filter((value): value is string => typeof value === "string")
      : typeof user.role === "string" && user.role.trim()
        ? [user.role.trim()]
        : [];
    return roleIds.some((roleId) => grantingRoleIds.includes(roleId));
  });
  if (reachable.length === 0) return { branches, failures, inputs };

  const batch = await resolveEffectivePermissionsBatchForAdmin(
    reachable.map((user) => user.id),
    base.context
  );
  for (const user of reachable) {
    const enabled = user.enabled !== false;
    const resolved = batch.get(user.id);
    if (!resolved || !resolved.ok) {
      const reason = resolved && !resolved.ok ? resolved.reason : "role_resolution_failed";
      failures.push({ subjectId: user.id, reason });
      branches.push({ agentId: user.id, enabled, constraints: [], finalRows: null, error: reason });
      continue;
    }
    const constraints =
      resolved.permissions.agentConstraintsBySource?.[
        constraintsSourceKey(table.connectionId, table.sourceName)
      ] ?? [];
    branches.push({
      agentId: user.id,
      enabled,
      constraints: constraints as RowPolicyPredicateInput[],
      finalRows: null
    });
    inputs.push({ agentId: user.id, finalRowsBySource: resolved.permissions.finalRowsBySource });
  }
  return { branches, failures, inputs };
}

/**
 * Read the single-table view (P1-1 §3.3).
 *
 * The four states are separated:
 *  - `no_match` — the filter matched no table at all (空筛选).
 *  - `no_applicable_grant` — the table exists but no Role grants it (无授权).
 *  - `final_rows_unsatisfiable` — the Agent's own row limits prune every DNF
 *    arm (不可满足). It stays a DIAGNOSTIC; no third `RowGrant` is invented.
 *  - `compile_failed` — every relevant Role failed to compile (编译失败).
 */
export async function readRowPolicyTableView(
  projectRoot: string,
  requested: { connectionId: string; schema: string; sourceName: string }
): Promise<RowPolicyTableView> {
  const tableKey: RowPolicyPreviewTableKey = {
    connectionId: normalize(requested.connectionId),
    schema: normalize(requested.schema),
    sourceName: normalize(requested.sourceName)
  };
  const read = await readRowPolicyViewBase(projectRoot);
  if (!read.ok) {
    const snapshot = read.snapshot;
    const problem = snapshot.problem ?? "access_unreadable";
    return {
      snapshot: snapshotContextOf({ snapshot, failures: [], generation: currentPolicyGeneration() }),
      table: { ...tableKey, physicalTable: tableKey.sourceName },
      state: "unavailable",
      status: "unavailable",
      reason: problem,
      roles: [],
      effectiveRowGrant: null,
      agents: [],
      catalog: { status: "catalog_capability_unknown", catalogLoaded: false, reason: problem },
      failures: []
    };
  }
  const base = read.base;

  // The canonical table identity comes from the source map, so the same-named
  // table of another Schema never merges (RTV-04).
  const entry = [...base.context.sourceMap.forward.values()].find(
    (candidate) =>
      normalize(candidate.connectionId) === tableKey.connectionId &&
      normalize(candidate.schema) === tableKey.schema &&
      (normalize(candidate.sourceName) === tableKey.sourceName ||
        normalize(candidate.physicalTable) === tableKey.sourceName)
  );
  const table: RowPolicyTableIdentity & { physicalTable: string } = {
    connectionId: tableKey.connectionId,
    schema: entry?.schema ?? tableKey.schema,
    sourceName: entry?.sourceName ?? tableKey.sourceName,
    physicalTable: entry?.physicalTable ?? tableKey.sourceName
  };

  const catalogResult = await loadSourceFieldCatalogWithProvenance({
    connectionId: table.connectionId,
    schema: table.schema,
    sourceName: table.sourceName
  });
  const catalog: RowPolicyTableView["catalog"] =
    catalogResult.status === "loaded"
      ? { status: "loaded", catalogLoaded: true }
      : catalogResult.status === "manifest_unavailable"
        ? {
            status: "manifest_unavailable",
            catalogLoaded: false,
            stage: catalogResult.stage,
            reason: `row_policy_catalog_unavailable:${catalogResult.stage}:${catalogResult.reason}`
          }
        : {
            status: "catalog_capability_unknown",
            catalogLoaded: false,
            reason: `row_policy_catalog_capability_unknown:${catalogResult.reason}`
          };

  const roleBranches = base.roles.map((role) => roleBranch(base, role, table));
  const roleGrants: PreviewRoleGrant[] = roleBranches
    .filter((branch) => branch.rowGrant !== null)
    .map((branch) => ({ roleId: branch.roleId, grant: branch.rowGrant! }));
  const roleFailures = roleBranches
    .filter((branch) => branch.error)
    .map((branch) => ({ subjectId: branch.roleId, reason: branch.error! }));

  const agentRead = await readAgentBranches(
    base,
    table,
    roleGrants.map((grant) => grant.roleId)
  );

  // The final rows are the runtime product: the union AND the Agent's personal
  // row limits. `computeFinalRowsForTable` is the ONE implementation.
  const computed = computeFinalRowsForTable(tableKey, roleGrants, agentRead.inputs);

  const agents: RowPolicyViewAgentBranch[] = agentRead.branches.map((branch) => {
    const final = computed.ok
      ? computed.preview.finalRowsByAgent.find((row) => row.agentId === branch.agentId)?.finalRows ?? null
      : null;
    return { ...branch, finalRows: final };
  });

  const failures = [...roleFailures, ...agentRead.failures];
  const capabilities = base.roles.flatMap((role) => role.capabilities);
  const snapshot = snapshotContextOfBase(base, capabilities, failures);
  // Every required compile failed ⇒ `unavailable`, not a partial table (P1-1 §5.3).
  // A zero-row table would be indistinguishable from 「没有授权」.
  const state: RowPolicyTableView["state"] =
    everyCompileFailed(roleGrants.length, roleFailures.length) ? "unavailable" : snapshot.state;

  let status: RowPolicyViewStatus = "ok";
  let reason: string | undefined;
  let effectiveRowGrant: RowGrant | null = null;

  if (roleGrants.length === 0) {
    if (roleFailures.length > 0) {
      status = "compile_failed";
      reason = roleFailures[0]?.reason;
    } else {
      status = "no_applicable_grant";
      reason = "row_policy_no_applicable_grant";
    }
  } else {
    effectiveRowGrant = computed.ok ? computed.preview.effectiveRowGrant : null;
    const unsatisfiable = agentRead.failures.filter((failure) =>
      failure.reason.includes("final_rows_unsatisfiable")
    );
    if (agentRead.failures.length > 0 && agentRead.failures.length === unsatisfiable.length) {
      status = "final_rows_unsatisfiable";
      reason = "final_rows_unsatisfiable";
    } else if (!computed.ok) {
      status = "compile_failed";
      reason = computed.reason;
    }
  }

  return {
    snapshot,
    table,
    state,
    status,
    reason,
    roles: roleBranches,
    effectiveRowGrant,
    agents,
    catalog,
    failures
  };
}

/** One row of the table list (P1-1 §6.2). */
export type RowPolicyTableListEntry = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  /** How many Roles grant this table. */
  roleCount: number;
  /** How many Agents reach this table. */
  agentCount: number;
  /** The union across Roles, or `null` when no Role grants the table. */
  effectiveRowGrant: RowGrant | null;
  /** `scoped` when any branch restricts rows. */
  restricted: boolean;
};

export type RowPolicyTableListFilters = {
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  roleId?: string;
  agentId?: string;
  /** Only tables whose row access is restricted. */
  restrictedOnly?: boolean;
};

export type RowPolicyTableList = {
  snapshot: SnapshotContext;
  state: SnapshotContext["state"];
  status: RowPolicyViewStatus;
  tables: RowPolicyTableListEntry[];
  failures: Array<{ subjectId: string; reason: string }>;
};

/**
 * List the tables that carry a row policy.
 *
 * The table set is deduplicated by the CANONICAL source key (connection /
 * schema / source name), so the same-named table of two Schemas stays two
 * entries (RTV-04 / P1-D7). The Role and Agent counts are NOT table counts and
 * are reported in their own columns.
 */
export async function listRowPolicyTables(
  projectRoot: string,
  filters: RowPolicyTableListFilters = {}
): Promise<RowPolicyTableList> {
  const read = await readRowPolicyViewBase(projectRoot);
  if (!read.ok) {
    const snapshot = read.snapshot;
    return {
      snapshot: snapshotContextOf({ snapshot, failures: [], generation: currentPolicyGeneration() }),
      state: "unavailable",
      status: "unavailable",
      tables: [],
      failures: []
    };
  }
  const base = read.base;

  const byTable = new Map<
    string,
    {
      table: RowPolicyTableIdentity & { physicalTable: string };
      roleIds: Set<string>;
      grants: Array<{ roleId: string; grant: RowGrant }>;
    }
  >();
  const failures: Array<{ subjectId: string; reason: string }> = [];
  for (const role of base.roles) {
    if (!role.ok) {
      failures.push({ subjectId: role.roleId, reason: role.reason ?? "role_resolution_failed" });
      continue;
    }
    for (const capability of role.capabilities) {
      // The CANONICAL source key, not a hand-rolled concatenation. The old
      // `${conn}${schema}${source}` had no separator, so
      // (conn="wh", schema="c", src="orders") and (conn="w", schema="hc",
      // src="orders") collapsed into one entry — two different tables merged,
      // their grants unioned, and an `all` grant absorbed the `scoped` one
      // (RTV-04 / P1-D7).
      const key = tableCountKey(capability);
      const entry = byTable.get(key) ?? {
        table: {
          connectionId: capability.connectionId,
          schema: capability.schema,
          sourceName: capability.sourceName,
          physicalTable: capability.physicalTable
        },
        roleIds: new Set<string>(),
        grants: []
      };
      entry.roleIds.add(role.roleId);
      entry.grants.push({ roleId: role.roleId, grant: capability.rowGrant });
      byTable.set(key, entry);
    }
  }

  // The Agents that reach a table are the Agents whose Role set intersects the
  // granting Roles of that table.
  const agentReach = new Map<string, Set<string>>();
  const users = base.config.users ?? [];
  for (const user of users) {
    const roleIds = Array.isArray(user.roles)
      ? user.roles.filter((value): value is string => typeof value === "string")
      : typeof user.role === "string" && user.role.trim()
        ? [user.role.trim()]
        : [];
    if (roleIds.length === 0) continue;
    for (const [key, entry] of byTable) {
      if (!roleIds.some((roleId) => entry.roleIds.has(roleId))) continue;
      const agents = agentReach.get(key) ?? new Set<string>();
      agents.add(user.id);
      agentReach.set(key, agents);
    }
  }

  const tables: RowPolicyTableListEntry[] = [];
  for (const [key, entry] of byTable) {
    if (filters.connectionId && normalize(filters.connectionId) !== normalize(entry.table.connectionId)) continue;
    if (filters.schema && normalize(filters.schema) !== normalize(entry.table.schema)) continue;
    if (filters.sourceName && normalize(filters.sourceName) !== normalize(entry.table.sourceName)) continue;
    if (filters.roleId && !entry.roleIds.has(filters.roleId)) continue;
    const agents = agentReach.get(key) ?? new Set<string>();
    if (filters.agentId && !agents.has(filters.agentId)) continue;
    const roleGrants: PreviewRoleGrant[] = entry.grants.map((item) => ({
      roleId: item.roleId,
      grant: item.grant
    }));
    // The union is computed by the SAME helper the single-table view uses.
    const union = computeFinalRowsForTable(
      {
        connectionId: entry.table.connectionId,
        schema: entry.table.schema,
        sourceName: entry.table.sourceName
      },
      roleGrants,
      []
    );
    const restricted = entry.grants.some((item) => item.grant.kind === "scoped");
    if (filters.restrictedOnly && !restricted) continue;
    tables.push({
      ...entry.table,
      roleCount: entry.roleIds.size,
      agentCount: agents.size,
      effectiveRowGrant: union.ok ? union.preview.effectiveRowGrant : null,
      restricted
    });
  }
  tables.sort(
    (a, b) =>
      a.connectionId.localeCompare(b.connectionId) ||
      a.schema.localeCompare(b.schema) ||
      a.sourceName.localeCompare(b.sourceName)
  );

  const capabilities = base.roles.flatMap((role) => role.capabilities);
  const snapshot = snapshotContextOfBase(base, capabilities, failures);
  // Every required compile failed ⇒ `unavailable`, NOT 「0 张表」. The single-
  // table view already answered this with `everyCompileFailed`; the list view
  // answered it with `no_match` + `partial`, so the two read paths of the SAME
  // module disagreed on the same condition (P1-1 §5.3 / RTV-05).
  const unavailable = everyCompileFailed(capabilities.length, failures.length);
  return {
    snapshot,
    state: unavailable ? "unavailable" : snapshot.state,
    status: unavailable ? "unavailable" : tables.length === 0 ? "no_match" : "ok",
    tables,
    failures
  };
}
