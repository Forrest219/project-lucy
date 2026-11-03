/**
 * Lucy v0.25 P1-2 — Agent 与角色授权摘要（服务端共享派生模型）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md
 *     §2.1（快照与状态）§2.2（计数口径）§2.3（Agent 与 Role 的差异）
 *     §3（授权摘要读取模型）§4（页面与 API 合同）§5（核心流程）§6（一致性与降级）
 *     §8（ASV-01～ASV-14）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B1–B8）、§2.1
 *
 * 这个模块是「一句话说清 Agent／Role 能读什么」的**同源只读投影**，不是新的授权对象，
 * 也不是第二套权限计算：有效权限、每 Role 贡献、最终行约束全部来自运行时自己的编译
 * 路径（`proxy/acl.ts` 的 `resolveEffectivePermissionsBatchForAdmin` /
 * `compileRoleForAdmin` / `previewSubjectPermissionsForCandidate`），行边界来自
 * `proxy/row-policy-preview.ts` 的 `computeFinalRowsForTable`。
 *
 * 三条不变量（本模块存在的理由）：
 *
 *  1. **同源**：一句话、资源卡片、工具分组、行摘要、深链必须来自同一个快照身份
 *     （configVersion／policyVersion／sourceMapVersion／capabilityDigest）。
 *     摘要层不得另读 access.yaml、不得另建目录快照。
 *  2. **不混用计数**（§2.2）：表数是**规范源键去重数**，不是授权路径数，也不是
 *     「工具×表」元组数。授权路径数单独以 `grantPathCount` 表达，两者永不互相冒充。
 *  3. **失败关闭**（§6）：读不到就说读不到。配置／路径问题 → `unavailable`；
 *     部分 Role 失败 → `partial` + 失败清单；启用表分母不可证明 → `null`（绝不填 0）；
 *     行编译不可满足 → 诊断（绝不显示「全部行」）。
 */
import {
  buildAdminPermissionContext,
  capabilityDigest as computeCapabilityDigest,
  classifyTool,
  compileRoleForAdmin,
  computeAccessConfigDigest,
  previewSubjectPermissionsForCandidate,
  resolveEffectivePermissionsBatchForAdmin,
  type AdminPermissionContext,
  type EffectiveCapability,
  type EffectivePermissions
} from "../proxy/acl.js";
import { lookupFinalRows } from "../proxy/agent-constraints.js";
import { computeFinalRowsForTable, type PreviewRoleGrant } from "../proxy/row-policy-preview.js";
import type { AccessConfig } from "../proxy/identity.js";
import type { RowGrant } from "../proxy/row-policy.js";
import { resolveProjectRoot } from "../project.js";
import {
  countGrantPaths,
  countTables,
  tableCountKey,
  type CanonicalSourceRef,
  type GrantPathRef
} from "./counting.js";
import { readAccessSnapshot, type AccessSnapshot } from "./permission-display.js";
import {
  currentPolicyGeneration,
  snapshotContextOf,
  type PolicyGeneration,
  type SnapshotProblem,
  type SnapshotState
} from "./snapshot-identity.js";

/** The subject a summary is about. */
export type AuthorizationSubject = { kind: "agent" | "role"; id: string };

/**
 * `committed` = derived from the committed configuration.
 * `draft` = derived from an in-memory dry-run candidate that is NOT in effect.
 */
export type AuthorizationSummaryBasis = "committed" | "draft";

/**
 * The snapshot context every part of one summary is derived from (Spec §2.1).
 *
 * `configVersion` for a draft summary is the **committed baseline** the draft was
 * built on, NOT the draft itself: a draft is identified by `candidateDigest`.
 * That is what makes the three invalidation inputs of Spec §5 ("草稿变化、配置版本
 * 变化或目录世代变化") directly expressible — draft change moves
 * `candidateDigest`, config change moves `configVersion`, catalog change moves
 * `sourceMapVersion`.
 */
export type AuthorizationSummaryContext = {
  subject: AuthorizationSubject;
  basis: AuthorizationSummaryBasis;
  configVersion: string;
  policyVersion: string;
  sourceMapVersion: string;
  capabilityDigest: string;
  snapshotHash: string | null;
  state: SnapshotState;
  problem: SnapshotProblem | null;
  /** Subjects that failed to resolve. Empty when `state` is `ok`. */
  failures: Array<{ subjectId: string; reason: string }>;
  /** Digest of the in-memory candidate; `null` for a committed summary. */
  candidateDigest: string | null;
  /** True when the summary describes a candidate that is not in effect yet. */
  candidateOnly: boolean;
};

/**
 * The first-screen headline (Spec §3).
 *
 * `enabledTableCount` is `null` when the denominator cannot be proven — never `0`.
 * `scopedTableCount` is `null` when the row basis itself is unknown (an Agent whose
 * final row constraints could not be composed), because a zero there would read as
 * "no table is row-restricted" — a claim we cannot make.
 */
export type AuthorizationSummaryHeadline = {
  connectionCount: number;
  tableCount: number;
  enabledTableCount: number | null;
  /** Why the enabled-table denominator is unknown. */
  enabledTableDenominatorUnavailableReason: string | null;
  scopedTableCount: number | null;
  /**
   * Which product `scopedTableCount` was counted from:
   * `final_rows` for an Agent, `effective_row_grant` for a Role, `unknown` when the
   * basis could not be composed. The two vocabularies are never mixed (Spec §2.2).
   */
  scopedTableCountBasis: "final_rows" | "effective_row_grant" | "unknown";
  /** Authorization paths — a DIFFERENT number from the table count. */
  grantPathCount: number;
  state: SnapshotState;
};

/** Row boundary of one table. */
export type AuthorizationRowSummary = {
  /** `all` = no row restriction; `scoped` = row-restricted; `unknown` = not decidable. */
  kind: "all" | "scoped" | "unknown";
  /**
   * Which product this summary is derived from.
   * `final_rows` = the Agent's final row constraints; `effective_row_grant` = the
   * Role's own row grant. Never interchangeable (Spec §2.3).
   */
  basis: "final_rows" | "effective_row_grant";
  /**
   * The display shape of the boundary: OR across Roles, AND inside one Role's
   * branch. Two restricted Roles stay two OR branches — they are never folded
   * into a single AND, and a restricted union never becomes 「全部行」.
   */
  displayShape: "OR-of-AND";
  /** True when the Agent's final row constraints are actually composed. */
  agentFinalRowsAvailable: boolean;
  /** True when the Agent's personal row limits actually narrow this table. */
  agentPersonalLimitsApplied: boolean;
  /** Template names — configuration provenance only; they never change the semantics. */
  templateRefs: string[];
  /** One line describing what participates in the boundary. */
  constraintSummary: string;
  /** OR arms, one per contributing Role. Never flattened into a single AND. */
  orArms: string[];
  /** Digest of the row grant, for cross-surface reconciliation. */
  digest: string | null;
  /** Compile failure, when the boundary could not be composed. */
  error?: string;
};

/** One data capability on one table: tool × 规范源键 × 行边界. */
export type AuthorizationResourceCapability = {
  tool: string;
  rowGrant: RowGrant;
  /** Agent view only. */
  finalRows?: RowGrant;
};

export type AuthorizationResourceTable = {
  /** 规范源键 four-tuple: `connectionId | schema | sourceName | physicalTable`. */
  sourceKey: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  /** Every Role that contributes to this table. Never inferred from the merged union. */
  roleIds: string[];
  capabilities: AuthorizationResourceCapability[];
  rowSummary: AuthorizationRowSummary;
  /** Deep link into the MCP 调试台 for this exact table (Agent view only). */
  playgroundUrl: string | null;
};

export type AuthorizationResourceSchema = {
  schema: string;
  tables: AuthorizationResourceTable[];
};

export type AuthorizationResourceConnection = {
  connectionId: string;
  schemas: AuthorizationResourceSchema[];
};

/** Tool groups — a DISPLAY classification only (Spec §3). */
export type AuthorizationToolGroups = {
  query: string[];
  semanticRead: string[];
  wikiRead: string[];
  write: string[];
  meta: string[];
};

/** Granted tools that fall into no group. Unclassified tools are never grantable. */
export type AuthorizationUnclassifiedTools = string[];

export type AuthorizationSummaryActions = {
  playgroundUrl: string | null;
  accessMapUrl: string | null;
  rowPolicyViewUrl: string | null;
  /** Agents that reference this Role (Role view only). */
  referencingAgentIds: string[];
};

/** One Role's own contribution — the ONLY source of role attribution (Spec §2.2). */
export type AuthorizationRoleContribution = {
  roleId: string;
  ok: boolean;
  reason?: string;
  /** This Role's own capabilities (tool × 规范源键 × 行授予). */
  capabilities: EffectiveCapability[];
  /** This Role's own granted Meta tools. */
  metaTools?: string[];
};

export type AuthorizationRoleContributionSummary = {
  roleId: string;
  ok: boolean;
  reason?: string;
  /** Distinct 规范源键 count this Role grants. */
  tableCount: number;
};

export type AuthorizationSummary = {
  summaryContext: AuthorizationSummaryContext;
  headline: AuthorizationSummaryHeadline;
  resources: AuthorizationResourceConnection[];
  tools: AuthorizationToolGroups;
  /** Granted tools that fall into no group. */
  unclassifiedTools: AuthorizationUnclassifiedTools;
  actions: AuthorizationSummaryActions;
  roleContributions: AuthorizationRoleContributionSummary[];
  /** True when the subject is authorized through the legacy `allow` block. */
  legacyAllow: boolean;
  /** Compile diagnostics, e.g. `final_rows_unsatisfiable`. */
  diagnostics: Array<{ code: string; detail: string }>;
};

/**
 * Which deep-link targets exist as pages today.
 *
 * Spec §4.1: 「目标页未实施前不得显示可用链接」. The MCP 调试台 exists
 * (`webui/src/pages/admin/McpPlayground.tsx`). The 访问关系图 (W3 / P1-3) and the
 * 行权限视图 (W1 / P1-1) are mounted by W6 (`webui/src/app/App.tsx` routes
 * `/admin/access-map` and `/admin/row-policies`, registered in the sidebar under
 * 「访问治理」), so their links are available from W6 onward.
 */
export const AUTHORIZATION_LINK_TARGETS = {
  playground: true,
  accessMap: true,
  rowPolicyView: true
} as const;

/** 访问关系图 route (P1-3 Spec §SC-01). */
export const ACCESS_MAP_ROUTE = "/admin/access-map";
/** 行权限视图 route (P1-1 Spec §6.2 planning route). */
export const ROW_POLICY_VIEW_ROUTE = "/admin/row-policies";
/** MCP 调试台 route. */
export const MCP_PLAYGROUND_ROUTE = "/admin/mcp-playground";

/**
 * Tool → display group.
 *
 * The groups are presentation only: they never change a tool's classification and
 * never change an authorization decision (Spec §3). A tool that is not listed here
 * falls back to its runtime class, and an `AbsoluteDeny` tool is never shown as a
 * grantable capability at all.
 *
 * The `write` group is intentionally empty in the current permission model: no
 * write tool is grantable today. Leaving it empty is the honest answer — a
 * non-empty write group would imply that database DML／DDL is open.
 */
const TOOL_DISPLAY_GROUP: Record<string, keyof AuthorizationToolGroups> = {
  lucy_query: "query",
  lucy_certified_route: "query",
  lucy_report_template: "query",
  lucy_read_source: "semanticRead",
  lucy_explain_query: "semanticRead",
  lucy_freshness: "semanticRead",
  entity_details: "semanticRead",
  sl_validate: "semanticRead",
  wiki_search: "wikiRead",
  wiki_read: "wikiRead",
  lucy_skill_search: "wikiRead",
  lucy_skill_read: "wikiRead"
};

/** The generic role-preview user id. It carries NO Agent personal row limits. */
export const ROLE_PREVIEW_USER_ID = "__role_preview__";

/** Marker for a table authorized through the legacy `allow` block (no Role source). */
const LEGACY_ACL_MARKER = "legacy_acl";

// ─── Deep links ───────────────────────────────────────────────────────────────

/**
 * MCP 调试台 deep link for one table.
 *
 * `args` carries at least `connectionId` and `sourceName` so the playground can
 * pre-fill the table. The playground only pre-fills and runs its EXISTING ACL
 * decision preview — it never auto-starts a controlled live call, and no token
 * plaintext is involved (Spec §4.1).
 */
export function playgroundUrlForTable(
  agentId: string,
  ref: { connectionId: string; sourceName: string }
): string {
  const args = encodeURIComponent(
    JSON.stringify({ connectionId: ref.connectionId, sourceName: ref.sourceName })
  );
  return (
    `${MCP_PLAYGROUND_ROUTE}?agentId=${encodeURIComponent(agentId)}` +
    `&mode=dry-run&tool=lucy_query&args=${args}`
  );
}

/** 访问关系图 deep link for an Agent. */
export function accessMapUrlForAgent(agentId: string): string {
  return `${ACCESS_MAP_ROUTE}?agent=${encodeURIComponent(agentId)}`;
}

/**
 * 访问关系图 deep link for a Role.
 *
 * P1-3 §4.7 / Spec 187 §3.2: the Role detail page offers the access map too,
 * filtered by the Role. The map page already parses `role=`, but the Role
 * summary never produced the link — so a Role could only reach the map through
 * one of its Agents, and the Role's own edge was unreachable from the page
 * that is about it.
 */
export function accessMapUrlForRole(roleId: string): string {
  return `${ACCESS_MAP_ROUTE}?role=${encodeURIComponent(roleId)}`;
}

/**
 * 行权限视图 deep link for one table.
 *
 * The parameter names are the row-policy view's OWN contract: `RowPolicyView.tsx`
 * reads `connectionId` / `schema` / `sourceName`, and its single-table panel
 * only queries when all three are present. The link used to emit `connection`
 * and `table` instead, so the deep link landed on an empty view and the detail
 * panel never queried at all (P1-2 ASV-10 / RTV-04).
 */
export function rowPolicyViewUrlForTable(ref: {
  connectionId: string;
  schema: string;
  sourceName: string;
}): string {
  const params = new URLSearchParams({
    connectionId: ref.connectionId,
    schema: ref.schema,
    sourceName: ref.sourceName
  });
  return `${ROW_POLICY_VIEW_ROUTE}?${params.toString()}`;
}

// ─── Tool grouping ────────────────────────────────────────────────────────────

/**
 * Partition the granted tools into the five display groups.
 *
 * `AbsoluteDeny` and unclassified tools are dropped: they are not grantable
 * capabilities and must not appear as if they were (Spec §3, ASV-12).
 */
export function partitionToolsForDisplay(tools: string[]): {
  groups: AuthorizationToolGroups;
  unclassified: string[];
} {
  const groups: AuthorizationToolGroups = {
    query: [],
    semanticRead: [],
    wikiRead: [],
    write: [],
    meta: []
  };
  const unclassified: string[] = [];
  for (const tool of [...new Set(tools)].sort()) {
    const toolClass = classifyTool(tool);
    if (toolClass === "AbsoluteDeny") continue;
    const explicit = TOOL_DISPLAY_GROUP[tool];
    if (explicit) {
      groups[explicit].push(tool);
      continue;
    }
    if (toolClass === "Meta") {
      groups.meta.push(tool);
      continue;
    }
    // A DataPlane tool without an explicit group reads the semantic layer.
    groups.semanticRead.push(tool);
  }
  for (const key of Object.keys(groups) as Array<keyof AuthorizationToolGroups>) {
    groups[key] = [...new Set(groups[key])].sort();
  }
  return { groups, unclassified: [...new Set(unclassified)].sort() };
}

// ─── Row boundary ─────────────────────────────────────────────────────────────

function predicateText(predicate: { field: string; op: string; value?: unknown; values?: unknown[] }): string {
  if (predicate.op === "in") {
    const values = Array.isArray(predicate.values) ? predicate.values : [];
    return `${predicate.field} in [${values.map((item) => String(item)).join(",")}]`;
  }
  return `${predicate.field}=${String(predicate.value ?? "")}`;
}

function armText(arm: Array<{ field: string; op: string; value?: unknown; values?: unknown[] }>): string {
  if (arm.length === 0) return "（空分支）";
  return arm.map(predicateText).join(" AND ");
}

/** Human-readable one-liner for a row grant. */
export function rowGrantLabel(grant: RowGrant): string {
  if (grant.kind === "all") return "全部行";
  if (grant.orArms.length === 0) return "受限行（无分支）";
  return grant.orArms.map(armText).join(" OR ");
}

/**
 * Compose the row boundary of one table.
 *
 * The composition itself is delegated to the existing
 * `computeFinalRowsForTable` (Role-OR + per-Agent FinalRows) — the summary only
 * READS it. The two vocabularies are kept apart on purpose:
 *
 *  - Agent view → `finalRows` (effective row grant AND the Agent's personal row
 *    limits). When the Agent's final rows are not composed, the Agent input is
 *    NOT passed at all — passing it with a missing map would silently fall back
 *    to the effective row grant and impersonate the Agent's final boundary.
 *  - Role view → `effective_row_grant` only. The generic `__role_preview__` user
 *    carries no Agent personal row limits and must never be presented as one.
 */
function rowSummaryForTable(input: {
  table: { connectionId: string; schema: string; sourceName: string };
  roleGrants: PreviewRoleGrant[];
  subjectKind: "agent" | "role";
  agentId: string;
  finalRowsBySource: Record<string, RowGrant> | undefined;
  templateRefs: string[];
}): AuthorizationRowSummary {
  const { table, roleGrants, subjectKind, agentId, finalRowsBySource, templateRefs } = input;
  const agentFinalRowsAvailable = subjectKind === "agent" && finalRowsBySource !== undefined;
  const agents = agentFinalRowsAvailable
    ? [{ agentId, finalRowsBySource: finalRowsBySource as Record<string, RowGrant> }]
    : [];

  const computed = computeFinalRowsForTable(
    { connectionId: table.connectionId, schema: table.schema, sourceName: table.sourceName },
    roleGrants,
    agents
  );
  if (!computed.ok) {
    return {
      kind: "unknown",
      basis: agentFinalRowsAvailable ? "final_rows" : "effective_row_grant",
      displayShape: "OR-of-AND",
      agentFinalRowsAvailable,
      agentPersonalLimitsApplied: false,
      templateRefs,
      constraintSummary: "行边界不可判定",
      orArms: [],
      digest: null,
      error: computed.reason
    };
  }

  const effective = computed.preview.effectiveRowGrant;
  const finalRows = computed.preview.finalRowsByAgent[0]?.finalRows;
  const shown = agentFinalRowsAvailable && finalRows ? finalRows : effective;
  const agentPersonalLimitsApplied =
    agentFinalRowsAvailable && finalRows ? !sameRowGrant(effective, finalRows) : false;

  return {
    kind: shown.kind === "scoped" ? "scoped" : "all",
    basis: agentFinalRowsAvailable ? "final_rows" : "effective_row_grant",
    displayShape: "OR-of-AND",
    agentFinalRowsAvailable,
    agentPersonalLimitsApplied,
    templateRefs,
    constraintSummary: agentFinalRowsAvailable
      ? agentPersonalLimitsApplied
        ? "最终行约束＝有效行授予 AND Agent 个人行限制（已生效）"
        : "最终行约束＝有效行授予（该表无 Agent 个人行限制）"
      : subjectKind === "role"
        ? "仅本 Role 的行授予（不含 Agent 个人行限制）"
        : "有效行授予（未合成 Agent 最终行约束）",
    orArms: shown.kind === "scoped" ? shown.orArms.map(armText) : [],
    digest: shown.kind === "scoped" ? shown.digest : null
  };
}

/** Do two row grants describe the same row set? */
function sameRowGrant(a: RowGrant, b: RowGrant): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "all") return true;
  if (b.kind === "all") return false;
  return a.digest === b.digest;
}

// ─── Derivation ───────────────────────────────────────────────────────────────

/** Inputs of the pure derivation. Everything here is already resolved. */
export type AuthorizationDerivationInput = {
  subject: AuthorizationSubject;
  basis: AuthorizationSummaryBasis;
  configVersion: string;
  policyVersion: string;
  sourceMapVersion: string;
  state: SnapshotState;
  problem: SnapshotProblem | null;
  failures: Array<{ subjectId: string; reason: string }>;
  /** The subject's effective capabilities (merged, authoritative). */
  capabilities: EffectiveCapability[];
  /** Per-Role contributions — the only source of role attribution. */
  roleContributions: AuthorizationRoleContribution[];
  /** Agent view only: the composed final row constraints per source. */
  finalRowsBySource?: Record<string, RowGrant>;
  /** Granted tools (data plane + meta). */
  tools: string[];
  legacyAllow: boolean;
  snapshotHash: string | null;
  /** Enabled-table denominator: a count, or the reason it cannot be proven. */
  enabledTableDenominator: { count: number } | { unavailableReason: string };
  /** Digest of the in-memory candidate (basis=draft). */
  candidateDigest?: string;
  /** Template provenance per 规范源键 (configuration provenance only). */
  templateRefsBySourceKey?: Map<string, string[]>;
  /** Which deep-link targets exist as pages today. */
  linkTargets?: { playground: boolean; accessMap: boolean; rowPolicyView: boolean };
  /** Role view: agents that reference this Role. */
  referencingAgentIds?: string[];
  /** Extra diagnostics (e.g. `final_rows_unsatisfiable`). */
  diagnostics?: Array<{ code: string; detail: string }>;
};

/**
 * The pure derivation. No I/O, no clock, no second permission algebra — it turns
 * already-resolved permissions into the readable projection (Spec §5).
 */
export function deriveAuthorizationSummary(input: AuthorizationDerivationInput): AuthorizationSummary {
  const capabilities = input.capabilities;
  const linkTargets = input.linkTargets ?? AUTHORIZATION_LINK_TARGETS;

  // ── tables (规范源键去重) ──────────────────────────────────────────────────
  const tableKeys = new Map<string, { ref: CanonicalSourceRef; capabilities: EffectiveCapability[] }>();
  for (const capability of capabilities) {
    const ref: CanonicalSourceRef = {
      connectionId: capability.connectionId,
      schema: capability.schema,
      sourceName: capability.sourceName,
      physicalTable: capability.physicalTable
    };
    const key = tableCountKey(ref);
    const existing = tableKeys.get(key);
    if (!existing) {
      tableKeys.set(key, { ref, capabilities: [capability] });
      continue;
    }
    existing.capabilities.push(capability);
  }

  // ── role attribution (per-role compilation, never inferred from the union) ──
  const roleIdsByTableKey = new Map<string, Set<string>>();
  for (const contribution of input.roleContributions) {
    if (!contribution.ok) continue;
    for (const capability of contribution.capabilities) {
      const key = tableCountKey(capability);
      const bucket = roleIdsByTableKey.get(key);
      if (!bucket) {
        roleIdsByTableKey.set(key, new Set([contribution.roleId]));
        continue;
      }
      bucket.add(contribution.roleId);
    }
  }

  // ── resource tree: connection → schema → table ─────────────────────────────
  const byConnection = new Map<string, Map<string, Map<string, AuthorizationResourceTable>>>();
  let scopedTableCount = 0;
  // The Agent view counts RESTRICTED tables by `FinalRows`; the Role view counts
  // them by `EffectiveRowGrant` (Spec §2.2). The two vocabularies are never
  // interchangeable — so when the Agent's FinalRows are NOT composed (a Role
  // failed and the merged resolution never produced them), the Agent's count
  // is UNKNOWN, not the Role-level count.
  const agentFinalRowsComposed = input.subject.kind === "agent" && input.finalRowsBySource !== undefined;
  let scopedTableCountBasis: AuthorizationSummaryHeadline["scopedTableCountBasis"] =
    input.subject.kind === "agent"
      ? agentFinalRowsComposed
        ? "final_rows"
        : "unknown"
      : "effective_row_grant";

  for (const [tableKey, entry] of tableKeys) {
    const { ref } = entry;
    const table = {
      connectionId: ref.connectionId,
      schema: ref.schema,
      sourceName: ref.sourceName,
      physicalTable: ref.physicalTable ?? ref.sourceName
    };

    const roleGrants: PreviewRoleGrant[] = [];
    for (const contribution of input.roleContributions) {
      if (!contribution.ok) continue;
      const hit = contribution.capabilities.find(
        (capability) => tableCountKey(capability) === tableKey
      );
      if (!hit) continue;
      roleGrants.push({ roleId: contribution.roleId, grant: hit.rowGrant });
    }

    // The legacy `allow` block has no Role branch at all: its grant is the
    // subject's own legacy grant and carries no Role attribution.
    const legacyGrant =
      roleGrants.length === 0 && input.legacyAllow
        ? entry.capabilities[0]?.rowGrant
        : undefined;
    const effectiveRoleGrants: PreviewRoleGrant[] =
      roleGrants.length > 0
        ? roleGrants
        : legacyGrant
          ? [{ roleId: LEGACY_ACL_MARKER, grant: legacyGrant }]
          : [];

    const rowSummary = rowSummaryForTable({
      table,
      roleGrants: effectiveRoleGrants,
      subjectKind: input.subject.kind,
      agentId: input.subject.id,
      finalRowsBySource: input.finalRowsBySource,
      templateRefs: input.templateRefsBySourceKey?.get(tableKey) ?? []
    });

    if (rowSummary.kind === "unknown") {
      // An undecidable boundary must not be counted as "not row-restricted".
      scopedTableCountBasis = "unknown";
    } else if (rowSummary.kind === "scoped") {
      if (input.subject.kind === "agent" && !agentFinalRowsComposed) {
        // The Agent view's restricted-table count is a FinalRows count. The
        // FinalRows were not composed, so the count stays unknown — the
        // Role-level number must not stand in for it.
        scopedTableCountBasis = "unknown";
      } else {
        scopedTableCount += 1;
      }
    }

    const resourceCapabilities: AuthorizationResourceCapability[] = entry.capabilities.map((capability) => {
      const finalRows = input.finalRowsBySource
        ? lookupFinalRows(
            input.finalRowsBySource,
            capability.connectionId,
            capability.sourceName,
            capability.rowGrant
          )
        : undefined;
      return {
        tool: capability.tool,
        rowGrant: capability.rowGrant,
        ...(finalRows ? { finalRows } : {})
      };
    });

    const resourceTable: AuthorizationResourceTable = {
      sourceKey: `${table.connectionId}|${table.schema}|${table.sourceName}|${table.physicalTable}`,
      connectionId: table.connectionId,
      schema: table.schema,
      sourceName: table.sourceName,
      physicalTable: table.physicalTable,
      roleIds: [...(roleIdsByTableKey.get(tableKey) ?? new Set<string>())].sort(),
      capabilities: resourceCapabilities.sort((a, b) => a.tool.localeCompare(b.tool)),
      rowSummary,
      playgroundUrl:
        linkTargets.playground && input.subject.kind === "agent"
          ? playgroundUrlForTable(input.subject.id, {
              connectionId: table.connectionId,
              sourceName: table.sourceName
            })
          : null
    };

    const schemaMap = byConnection.get(table.connectionId) ?? new Map();
    const tableMap = schemaMap.get(table.schema) ?? new Map();
    tableMap.set(table.sourceName, resourceTable);
    schemaMap.set(table.schema, tableMap);
    byConnection.set(table.connectionId, schemaMap);
  }

  const resources: AuthorizationResourceConnection[] = [...byConnection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([connectionId, schemaMap]) => ({
      connectionId,
      schemas: [...schemaMap.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([schema, tableMap]) => ({
          schema,
          tables: [...tableMap.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName))
        }))
    }));

  // ── counts (Spec §2.2 — one vocabulary, never mixed) ──────────────────────
  const canonicalRefs: CanonicalSourceRef[] = capabilities.map((capability) => ({
    connectionId: capability.connectionId,
    schema: capability.schema,
    sourceName: capability.sourceName,
    physicalTable: capability.physicalTable
  }));
  const readableConnectionIds = [...new Set(canonicalRefs.map((ref) => ref.connectionId))].sort();

  const grantPathRefs: GrantPathRef[] = [];
  for (const contribution of input.roleContributions) {
    if (!contribution.ok) continue;
    for (const capability of contribution.capabilities) {
      grantPathRefs.push({
        agentId: input.subject.id,
        roleId: contribution.roleId,
        connectionId: capability.connectionId,
        schema: capability.schema,
        sourceName: capability.sourceName,
        physicalTable: capability.physicalTable
      });
    }
  }

  const headline: AuthorizationSummaryHeadline = {
    // A connection counts only when it carries at least one effective Data
    // Capability. A merely DECLARED connection never pads the number (§2.2).
    connectionCount: readableConnectionIds.length,
    tableCount: countTables(canonicalRefs),
    enabledTableCount:
      "count" in input.enabledTableDenominator ? input.enabledTableDenominator.count : null,
    enabledTableDenominatorUnavailableReason:
      "count" in input.enabledTableDenominator
        ? null
        : input.enabledTableDenominator.unavailableReason,
    scopedTableCount: scopedTableCountBasis === "unknown" ? null : scopedTableCount,
    scopedTableCountBasis,
    grantPathCount: countGrantPaths(grantPathRefs),
    state: input.state
  };

  const { groups, unclassified } = partitionToolsForDisplay(input.tools);

  const firstPlaygroundTable = resources
    .flatMap((connection) => connection.schemas)
    .flatMap((schema) => schema.tables)
    .find((table) => table.playgroundUrl);

  // The row-policy deep link must point at a table that ACTUALLY has a row
  // constraint — and at THAT table, not at the first resource in the list.
  // Each resource table already carries its own four-tuple identity, so the
  // scoped table's own coordinates are used (P1-2 ASV-10 / RTV-04).
  const scopedTable = resources
    .flatMap((connection) => connection.schemas)
    .flatMap((schema) => schema.tables)
    .find((table) => table.rowSummary.kind === "scoped");

  const actions: AuthorizationSummaryActions = {
    playgroundUrl: linkTargets.playground && input.subject.kind === "agent" ? (firstPlaygroundTable?.playgroundUrl ?? null) : null,
    accessMapUrl:
      linkTargets.accessMap
        ? input.subject.kind === "agent"
          ? accessMapUrlForAgent(input.subject.id)
          : accessMapUrlForRole(input.subject.id)
        : null,
    rowPolicyViewUrl:
      linkTargets.rowPolicyView && scopedTable
        ? rowPolicyViewUrlForTable({
            connectionId: scopedTable.connectionId,
            schema: scopedTable.schema,
            sourceName: scopedTable.sourceName
          })
        : null,
    referencingAgentIds: [...(input.referencingAgentIds ?? [])].sort()
  };

  const summaryContext: AuthorizationSummaryContext = {
    subject: input.subject,
    basis: input.basis,
    configVersion: input.configVersion,
    policyVersion: input.policyVersion,
    sourceMapVersion: input.sourceMapVersion,
    capabilityDigest: computeCapabilityDigest(capabilities),
    snapshotHash: input.snapshotHash,
    state: input.state,
    problem: input.problem,
    failures: input.failures,
    candidateDigest: input.basis === "draft" ? (input.candidateDigest ?? null) : null,
    candidateOnly: input.basis === "draft"
  };

  return {
    summaryContext,
    headline,
    resources,
    tools: groups,
    unclassifiedTools: unclassified,
    actions,
    roleContributions: input.roleContributions.map((contribution) => ({
      roleId: contribution.roleId,
      ok: contribution.ok,
      ...(contribution.reason ? { reason: contribution.reason } : {}),
      tableCount: countTables(
        contribution.capabilities.map((capability) => ({
          connectionId: capability.connectionId,
          schema: capability.schema,
          sourceName: capability.sourceName,
          physicalTable: capability.physicalTable
        }))
      )
    })),
    legacyAllow: input.legacyAllow,
    diagnostics: input.diagnostics ?? []
  };
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/** Options of the summary builder. */
export type AuthorizationSummaryOptions = {
  subject: AuthorizationSubject;
  basis?: AuthorizationSummaryBasis;
  /** Pre-read snapshot (the route reads it once and shares it). */
  snapshot?: AccessSnapshot;
  /** Project root override (tests). */
  projectRoot?: string;
  /**
   * The in-memory candidate for `basis=draft`.
   * It MUST be an overlay built from the committed configuration — the builder
   * never reads a draft back from disk.
   */
  candidate?: AccessConfig;
  /** Digest of the candidate; a change invalidates the previous candidate summary. */
  candidateDigest?: string;
  /** Generation override (tests). */
  generation?: PolicyGeneration;
  /**
   * Which deep-link targets exist as pages right now.
   *
   * Defaults to `AUTHORIZATION_LINK_TARGETS`. A target that does not exist as a page
   * must not be offered as a usable link (Spec §4.1), so the switch is part of the
   * contract rather than a UI detail.
   */
  linkTargets?: { playground: boolean; accessMap: boolean; rowPolicyView: boolean };
};

/**
 * Build the summary for one subject.
 *
 * Resolution order follows Spec §5: configuration/path consistency → candidate
 * construction → runtime-equivalent compilation → catalog denominator and role
 * contributions → presentation. A failure in the CORE resolution never yields a
 * definite authorization conclusion.
 */
export async function buildAuthorizationSummary(
  options: AuthorizationSummaryOptions
): Promise<AuthorizationSummary> {
  const basis: AuthorizationSummaryBasis = options.basis ?? "committed";
  const projectRoot = options.projectRoot ?? (await resolveProjectRoot());
  const snapshot = options.snapshot ?? (await readAccessSnapshot(projectRoot));
  const generation = options.generation ?? currentPolicyGeneration();
  const subject = options.subject;

  const emptyInputs = {
    subject,
    basis,
    configVersion: "",
    policyVersion: "",
    sourceMapVersion: "",
    state: "unavailable" as SnapshotState,
    problem: snapshot.problem ?? null,
    failures: [] as Array<{ subjectId: string; reason: string }>,
    capabilities: [] as EffectiveCapability[],
    roleContributions: [] as AuthorizationRoleContribution[],
    tools: [] as string[],
    legacyAllow: false,
    snapshotHash: null as string | null,
    enabledTableDenominator: { unavailableReason: "access_configuration_unreadable" } as
      | { count: number }
      | { unavailableReason: string },
    linkTargets: options.linkTargets
  };

  if (!snapshot.runtimeConfig) {
    // Configuration missing / invalid / path mismatch → `unavailable` with the
    // matching problem. NEVER an empty resource card and NEVER "0 张表".
    const context = snapshotContextOf({ snapshot, failures: [], generation });
    return deriveAuthorizationSummary({
      ...emptyInputs,
      configVersion: context.identity.configVersion,
      policyVersion: context.identity.policyVersion,
      sourceMapVersion: context.identity.sourceMapVersion,
      problem: context.problem,
      state: "unavailable"
    });
  }

  const committedConfig = snapshot.runtimeConfig;
  const candidate = options.candidate ?? committedConfig;
  const candidateDigest = options.candidateDigest ?? null;

  const baseContext = await buildAdminPermissionContext(committedConfig);
  const context: AdminPermissionContext =
    candidate === committedConfig
      ? baseContext
      : {
          ...baseContext,
          config: candidate,
          accessConfigDigest: computeAccessConfigDigest(candidate)
        };

  const failures: Array<{ subjectId: string; reason: string }> = [];
  const diagnostics: Array<{ code: string; detail: string }> = [];

  // ── resolve the subject through the runtime's own compile path ─────────────
  let resolved:
    | { ok: true; permissions: EffectivePermissions }
    | { ok: false; reason: string; declaredRoleIds: string[]; failedRoleId?: string }
    | null = null;

  if (subject.kind === "agent") {
    // The Agent goes through the EXISTING admin batch resolver: it reads the
    // subject out of `context.config`, so the legacy `allow` block survives.
    // (`previewSubjectPermissionsForCandidate` rebuilds the user from a fixed
    // field list and would silently drop it.)
    const batch = await resolveEffectivePermissionsBatchForAdmin([subject.id], context);
    const result = batch.get(subject.id);
    resolved = !result
      ? { ok: false, reason: "role_resolution_failed:agent_not_found", declaredRoleIds: [] }
      : result.ok
        ? { ok: true, permissions: result.permissions }
        : {
            ok: false,
            reason: result.reason,
            declaredRoleIds: result.diagnostic.declaredRoleIds,
            ...(result.failedRoleId ? { failedRoleId: result.failedRoleId } : {})
          };
  } else {
    // The Role is resolved through the generic role-preview user. That user
    // carries NO Agent personal row limits — the Role view therefore shows the
    // Role's own row grant and never impersonates an Agent's FinalRows.
    const previewed = await previewSubjectPermissionsForCandidate(
      candidate,
      { userId: ROLE_PREVIEW_USER_ID, role: subject.id, enabled: true },
      { sourceMap: context.sourceMap, enabledTables: context.enabledTables }
    );
    resolved = previewed.ok
      ? { ok: true, permissions: previewed.permissions }
      : { ok: false, reason: previewed.reason, declaredRoleIds: previewed.diagnostic.declaredRoleIds };
  }

  // ── per-role contributions (the only source of role attribution) ───────────
  const declaredRoleIds =
    resolved && resolved.ok
      ? resolved.permissions.roleIds.length > 0
        ? resolved.permissions.roleIds
        : []
      : (resolved?.declaredRoleIds ?? []);
  const roleIdsToCompile =
    declaredRoleIds.length > 0
      ? declaredRoleIds
      : subject.kind === "role"
        ? [subject.id]
        : [];

  const roleContributions: AuthorizationRoleContribution[] = [];
  for (const roleId of roleIdsToCompile) {
    const compiled = await compileRoleForAdmin(roleId, context);
    roleContributions.push({
      roleId,
      ok: compiled.ok,
      ...(compiled.reason ? { reason: compiled.reason } : {}),
      capabilities: compiled.ok ? (compiled.capabilities ?? []) : [],
      ...(compiled.metaTools ? { metaTools: compiled.metaTools } : {})
    });
  }

  // ── assemble ───────────────────────────────────────────────────────────────
  const failedRoles = roleContributions.filter((contribution) => !contribution.ok);
  const identityContext = snapshotContextOf({
    snapshot,
    capabilityDigest: "",
    failures: [],
    generation
  });

  if (!resolved || !resolved.ok) {
    const reason = resolved?.reason ?? "role_resolution_failed";
    // A Role-compile failure may be salvaged per Role: the Roles that DO resolve
    // give a definite (partial) set, the failed ones are listed. Any other
    // failure (disabled Agent, unsatisfiable final rows, broken catalog) means
    // the CORE resolution failed — there is no definite authorization conclusion.
    const salvageable = reason.startsWith("role_resolution_failed:");
    const resolvedRoleCount = roleContributions.filter((contribution) => contribution.ok).length;

    if (salvageable && resolvedRoleCount > 0) {
      for (const contribution of failedRoles) {
        failures.push({
          subjectId: contribution.roleId,
          reason: contribution.reason ?? "role_resolution_failed"
        });
      }
      const capabilities = roleContributions.flatMap((contribution) =>
        contribution.ok ? contribution.capabilities : []
      );
      return deriveAuthorizationSummary({
        subject,
        basis,
        linkTargets: options.linkTargets,
        configVersion: identityContext.identity.configVersion,
        policyVersion: identityContext.identity.policyVersion,
        sourceMapVersion: identityContext.identity.sourceMapVersion,
        state: "partial",
        problem: null,
        failures,
        capabilities,
        roleContributions,
        // The Agent's final rows are NOT composed here: the merged resolution
        // failed. Passing no Agent input keeps the row boundary at Role level
        // instead of impersonating the Agent's final constraints.
        finalRowsBySource: undefined,
        tools: [
          ...new Set(
            roleContributions.flatMap((contribution) =>
              contribution.ok
                ? [
                    ...contribution.capabilities.map((capability) => capability.tool),
                    ...(contribution.metaTools ?? [])
                  ]
                : []
            )
          )
        ],
        legacyAllow: false,
        snapshotHash: null,
        enabledTableDenominator: enabledTableDenominatorOf(context, capabilities),
        ...(candidateDigest ? { candidateDigest } : {}),
        templateRefsBySourceKey: templateRefsBySourceKeyOf(candidate, roleContributions),
        diagnostics: [
          ...diagnostics,
          { code: "role_resolution_partial", detail: reason }
        ]
      });
    }

    failures.push({ subjectId: subject.id, reason });
    diagnostics.push({ code: reasonCodeOf(reason), detail: reason });
    return deriveAuthorizationSummary({
      subject,
      basis,
      linkTargets: options.linkTargets,
      configVersion: identityContext.identity.configVersion,
      policyVersion: identityContext.identity.policyVersion,
      sourceMapVersion: identityContext.identity.sourceMapVersion,
      state: "unavailable",
      problem: null,
      failures,
      capabilities: [],
      roleContributions: roleContributions.map((contribution) => ({
        ...contribution,
        capabilities: []
      })),
      tools: [],
      legacyAllow: false,
      snapshotHash: null,
      enabledTableDenominator: { unavailableReason: "subject_resolution_failed" },
      ...(candidateDigest ? { candidateDigest } : {}),
      diagnostics
    });
  }

  const permissions = resolved.permissions;
  for (const contribution of failedRoles) {
    failures.push({
      subjectId: contribution.roleId,
      reason: contribution.reason ?? "role_resolution_failed"
    });
  }

  const capabilities = permissions.capabilities;
  const state: SnapshotState =
    identityContext.state === "unavailable"
      ? "unavailable"
      : failures.length > 0
        ? "partial"
        : "ok";

  const templateRefs = templateRefsBySourceKeyOf(candidate, roleContributions);
  const referencingAgentIds =
    subject.kind === "role" ? agentsReferencingRole(candidate, subject.id) : [];

  return deriveAuthorizationSummary({
    subject,
    basis,
    linkTargets: options.linkTargets,
    configVersion: identityContext.identity.configVersion,
    policyVersion: identityContext.identity.policyVersion,
    sourceMapVersion: identityContext.identity.sourceMapVersion,
    state,
    problem: identityContext.problem,
    failures,
    capabilities,
    roleContributions,
    ...(subject.kind === "agent" && permissions.finalRowsBySource
      ? { finalRowsBySource: permissions.finalRowsBySource }
      : {}),
    tools: permissions.tools,
    legacyAllow: permissions.legacyAllow,
    snapshotHash: permissions.snapshotHash,
    enabledTableDenominator: enabledTableDenominatorOf(context, capabilities),
    ...(candidateDigest ? { candidateDigest } : {}),
    templateRefsBySourceKey: templateRefs,
    referencingAgentIds,
    diagnostics
  });
}

/** Stable machine code for a failure reason. */
function reasonCodeOf(reason: string): string {
  const head = reason.split(":")[0] ?? reason;
  return head || "role_resolution_failed";
}

/** Agents that reference a Role (Role view: 「使用情况」). */
function agentsReferencingRole(config: AccessConfig, roleId: string): string[] {
  const agents: string[] = [];
  for (const user of config.users ?? []) {
    const roles = Array.isArray(user.roles)
      ? user.roles.filter((value): value is string => typeof value === "string")
      : typeof user.role === "string" && user.role.trim()
        ? [user.role.trim()]
        : [];
    if (roles.includes(roleId)) agents.push(user.id);
  }
  return agents;
}

/**
 * Enabled-table denominator (Spec §2.2).
 *
 * The denominator is the number of enabled, provable tables in the SAME catalog
 * snapshot for the connections this subject can read. When the catalog is not
 * complete the denominator is `null` with a reason — never `0`, and never a
 * number borrowed from a stale generation.
 */
export function enabledTableDenominatorOf(
  context: AdminPermissionContext,
  capabilities: EffectiveCapability[]
): { count: number } | { unavailableReason: string } {
  if (context.sourceMap.compileError) {
    return { unavailableReason: `enabled_catalog_unavailable:${context.sourceMap.compileError}` };
  }
  if (!context.sourceMap.version) {
    return { unavailableReason: "enabled_catalog_unavailable:source_map_unavailable" };
  }
  const connectionIds = [...new Set(capabilities.map((capability) => capability.connectionId))].sort();
  const keys = new Set<string>();
  for (const connectionId of connectionIds) {
    const enabled = context.enabledTables.get(connectionId);
    if (!enabled) {
      // The connection is not in the catalog at all → its enabled range is unknown.
      return { unavailableReason: `enabled_catalog_connection_unknown:${connectionId}` };
    }
    for (const entry of context.sourceMap.forward.values()) {
      if (entry.connectionId !== connectionId) continue;
      if (!enabled.has(entry.physicalTable)) continue;
      keys.add(
        tableCountKey({
          connectionId: entry.connectionId,
          schema: entry.schema,
          sourceName: entry.sourceName
        })
      );
    }
  }
  return { count: keys.size };
}

/**
 * Template provenance per 规范源键.
 *
 * Template names are configuration provenance only — the authoritative row
 * boundary always comes from the compiled product. The lookup is defensive: the
 * template model is owned by P1-1 (W1); until it lands there is simply nothing
 * to reference.
 */
function templateRefsBySourceKeyOf(
  config: AccessConfig,
  contributions: AuthorizationRoleContribution[]
): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const contribution of contributions) {
    if (!contribution.ok) continue;
    const role = config.roles?.[contribution.roleId];
    const selectors = role?.allow?.tableSelectors ?? [];
    if (!Array.isArray(selectors)) continue;
    for (const selector of selectors) {
      const rowPolicy = selector.row_policy as { template?: unknown } | undefined;
      const templateName = typeof rowPolicy?.template === "string" ? rowPolicy.template : "";
      if (!templateName) continue;
      const names = (selector.names ?? []).filter((value): value is string => typeof value === "string");
      for (const capability of contribution.capabilities) {
        const selectorConnection =
          typeof selector.connection === "string" ? selector.connection.toLowerCase() : undefined;
        if (selectorConnection && selectorConnection !== capability.connectionId) continue;
        if (typeof selector.schema === "string" && selector.schema.toLowerCase() !== capability.schema) continue;
        if (names.length > 0 && !names.some((name) => name.toLowerCase() === capability.sourceName)) continue;
        const key = tableCountKey(capability);
        const bucket = refs.get(key) ?? [];
        if (!bucket.includes(templateName)) bucket.push(templateName);
        refs.set(key, bucket);
      }
    }
  }
  return refs;
}

/**
 * Overlay a Role draft on the committed configuration.
 *
 * The result is an in-memory candidate only — nothing is written, and the
 * committed policy is never swapped in.
 */
export function overlayRoleDraft(
  committed: AccessConfig,
  roleId: string,
  draft: NonNullable<AccessConfig["roles"]>[string]
): AccessConfig {
  return {
    ...committed,
    roles: {
      ...(committed.roles ?? {}),
      [roleId]: draft
    }
  };
}

/**
 * Overlay an Agent draft on the committed configuration.
 *
 * Only the fields an Agent draft may change are accepted; `allow`, `tokens` and
 * `id` are not editable and are never carried over from the draft.
 */
export function overlayAgentDraft(
  committed: AccessConfig,
  userId: string,
  draft: {
    name?: string;
    enabled?: boolean;
    role?: string;
    roles?: string[];
    constraints?: unknown;
  }
): AccessConfig {
  const existing = (committed.users ?? []).find((user) => user.id === userId);
  if (!existing) {
    return {
      ...committed,
      users: [
        ...(committed.users ?? []),
        {
          id: userId,
          name: draft.name ?? userId,
          enabled: draft.enabled ?? true,
          ...(draft.role !== undefined ? { role: draft.role } : {}),
          ...(draft.roles !== undefined ? { roles: draft.roles } : {}),
          ...(draft.constraints !== undefined ? { constraints: draft.constraints } : {}),
          tokens: []
        } as AccessConfig["users"][number]
      ]
    };
  }
  const next: AccessConfig["users"][number] = { ...existing };
  if (draft.name !== undefined) next.name = draft.name;
  if (draft.enabled !== undefined) next.enabled = draft.enabled;
  // `role` and `roles` are mutually exclusive in the runtime. A draft replaces
  // the whole Role set, so the inherited counterpart is dropped — otherwise the
  // candidate would fail with `role_resolution_failed:role_and_roles`.
  if (draft.role !== undefined) {
    next.role = draft.role;
    delete next.roles;
  }
  if (draft.roles !== undefined) {
    next.roles = draft.roles;
    delete next.role;
  }
  if (draft.constraints !== undefined) next.constraints = draft.constraints;
  return {
    ...committed,
    users: (committed.users ?? []).map((user) => (user.id === userId ? next : user))
  };
}
