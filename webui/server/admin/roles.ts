import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import {
  expandSelectorSourceNames,
  normalizePermissionModelVersion,
  previewRolePermissionsForAdmin,
  absoluteDenyOrUnclassifiedReason,
  resolveRoleIds,
  type EffectivePermissions
} from "../proxy/acl.js";
import { parseRowPolicyShape } from "../proxy/row-policy.js";
// L25-16 — 控制面工具登记表（角色保存路径校验 `allow.ops` 用）。
import { isControlPlaneTool, isOpsAssetKind, getOpsToolSpec } from "../ops/control-plane.js";
import { requireOwnerForOps } from "../auth/guard.js";
import { verifyRowPolicyPreviewConfirmation } from "../proxy/row-policy-preview.js";
import { readAccessRecoveryState } from "../access-recovery.js";
import { computeCandidateDigest } from "../config-digest.js";
import { expandTemplate, isDeleteProtectedRole, LUCY_ADMIN_ROLE_ID, ROLE_TEMPLATES } from "./role-templates.js";
import {
  ACCESS_YAML_REL,
  ROLE_ID_RE,
  accessWriteResponseBody,
  makeDiff,
  readAccessYaml,
  readAccessYamlVersion,
  runInAccessPublishWindow,
  writeAccessYaml,
  type AccessConfigWriteResult,
  type YamlAccessConfig,
  type YamlPermissionModelVersion,
  type YamlRole,
  type YamlRowAccess,
  type YamlRowPolicy,
  type YamlTableSelector
} from "./access-config.js";
import {
  evaluateAccessGovernanceGate,
  evaluateGovernanceOverride,
  recordAccessGovernanceGateEvent,
  type AccessGovernanceApprover,
  type AccessGovernanceGateDecision,
  type AccessGovernanceOverrideRequest
} from "../access-governance-gate.js";
import { ROW_POLICY_TEMPLATE_NAME_PATTERN } from "./row-policy-types.js";
import { expandRowPolicyTemplatesInConfig, type AccessConfigWithTemplates } from "./row-policy-templates.js";
import { actorIdFromRequest } from "../auth/guard.js";
import { auditActorFields, trustedActorFromRequest } from "../security/request-actor.js";
import type { FastifyRequest } from "fastify";
import { loadAllSkills } from "../skills/loader.js";
import { summarizeRoleSkillAccess } from "../proxy/skill-acl.js";
import {
  contextReferencesToRole,
  hasContextReferences,
  listContextInventory,
  summarizeRoleWikiAccess
} from "../proxy/context-inventory.js";
import { computeContextPolicyVersion } from "../proxy/context-policy.js";
import { getSecurityStore } from "../security/instance.js";

type RoleSource = "yaml" | "template";

type ResolvedRole = {
  id: string;
  role: YamlRole;
  source: RoleSource;
};

function bodyHasOwn(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function findRole(config: YamlAccessConfig, roleId: string): ResolvedRole | undefined {
  const yamlRole = config.roles?.[roleId];
  if (yamlRole?.allow) {
    return { id: roleId, role: yamlRole, source: "yaml" };
  }
  if (ROLE_TEMPLATES[roleId]) {
    const expanded = expandTemplate(roleId);
    if (expanded) return { id: roleId, role: expanded, source: "template" };
  }
  return undefined;
}

function usersReferencingRole(config: YamlAccessConfig, roleId: string) {
  return config.users.filter((user) => {
    const resolved = resolveRoleIds(user);
    return resolved.ok && resolved.roleIds.includes(roleId);
  });
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
    capabilities: permissions.capabilities.map((capability) => ({
      tool: capability.tool,
      connectionId: capability.connectionId,
      schema: capability.schema,
      sourceName: capability.sourceName,
      physicalTable: capability.physicalTable,
      sourceKey: `${capability.connectionId}|${capability.schema}|${capability.sourceName}|${capability.physicalTable}`,
      rowGrant: capability.rowGrant
    }))
  };
}

/**
 * Resolved source names for a candidate role. Used to feed the
 * Access Governance Gate; returns `[]` when the role cannot be resolved
 * (caller will already have surfaced a 400 upstream).
 */
async function resolveRoleSources(roleId: string, role?: YamlRole): Promise<{
  sources: string[];
  snapshotHash: string | null;
  tools: string[];
  denyTools: string[];
  sensitiveTablePrefixes: string[];
}> {
  const resolved = await previewRolePermissionsForAdmin(roleId, role ? { role } : {});
  if (!resolved.ok) return { sources: [], snapshotHash: null, tools: [], denyTools: [], sensitiveTablePrefixes: [] };
  return {
    sources: resolved.permissions.sources.map((source) => source.table),
    snapshotHash: resolved.permissions.snapshotHash,
    tools: resolved.permissions.tools,
    denyTools: [],
    sensitiveTablePrefixes: []
  };
}

interface BuildRoleGateInputArgs {
  targetKind: "role" | "access_defaults";
  targetId: string;
  oldRole?: YamlRole;
  newRole: YamlRole;
  oldAccessDefaults?: YamlAccessConfig["defaults"];
  newAccessDefaults?: YamlAccessConfig["defaults"];
  oldSources?: string[];
  newSources?: string[];
  oldSnapshotHash?: string | null;
  newSnapshotHash?: string | null;
}

async function buildRoleGateInput(args: BuildRoleGateInputArgs) {
  let oldSources = args.oldSources;
  let newSources = args.newSources;
  let oldHash = args.oldSnapshotHash ?? null;
  let newHash = args.newSnapshotHash ?? null;
  let oldDeny: string[] | undefined;
  let newDeny: string[] | undefined;
  let oldPrefixes: string[] | undefined;
  let newPrefixes: string[] | undefined;
  if (oldSources === undefined && args.oldRole) {
    const before = await resolveRoleSources(args.targetId, args.oldRole);
    oldSources = before.sources;
    oldHash = before.snapshotHash;
  }
  if (newSources === undefined) {
    const after = await resolveRoleSources(args.targetId, args.newRole);
    newSources = after.sources;
    newHash = after.snapshotHash;
  }
  const oldTools = args.oldRole?.allow?.tools ?? [];
  const newTools = args.newRole.allow?.tools ?? [];
  const addedTools = newTools.filter((tool) => !oldTools.includes(tool));
  if (args.oldAccessDefaults && args.newAccessDefaults) {
    oldDeny = args.oldAccessDefaults.deny_tools ?? [];
    newDeny = args.newAccessDefaults.deny_tools ?? [];
    oldPrefixes = args.oldAccessDefaults.sensitive_table_prefixes ?? [];
    newPrefixes = args.newAccessDefaults.sensitive_table_prefixes ?? [];
  }
  return {
    targetKind: args.targetKind,
    targetId: args.targetId,
    oldValue: args.oldRole,
    newValue: args.newRole,
    oldSources,
    newSources,
    oldSnapshotHash: oldHash,
    newSnapshotHash: newHash,
    addedTools,
    oldDenyTools: oldDeny,
    newDenyTools: newDeny,
    oldSensitiveTablePrefixes: oldPrefixes,
    newSensitiveTablePrefixes: newPrefixes
  };
}

function defaultActor(request?: FastifyRequest): AccessGovernanceApprover {
  return {
    actorKind: "admin",
    actorId: request ? actorIdFromRequest(request) : "local-admin",
    identityProvider: "webui-local"
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

function buildRoleSummary(config: YamlAccessConfig, resolved: ResolvedRole) {
  const users = usersReferencingRole(config, resolved.id);
  return {
    id: resolved.id,
    description: resolved.role.description,
    source: resolved.source,
    tools: resolved.role.allow?.tools ?? [],
    connections: resolved.role.allow?.connections ?? [],
    source_scope: resolved.role.allow?.source_scope,
    usageCount: users.length,
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      enabled: user.enabled !== false,
      tokenCount: user.tokens?.length ?? 0
    }))
  };
}

function sourceNamesFromPreview(
  preview: Awaited<ReturnType<typeof previewRolePermissionsForAdmin>>
): string[] {
  if (!preview.ok) return [];
  return [
    ...new Set(
      preview.permissions.sources.flatMap((source) => {
        const full = source.table;
        const short = full.includes(".") ? full.slice(full.lastIndexOf(".") + 1) : full;
        return [full, short, source.sourceName].filter(
          (item): item is string => typeof item === "string" && item.length > 0
        );
      })
    )
  ];
}

function isTableTouchingTool(tool: string): boolean {
  return [
    "sl_query",
    "sl_read_source",
    "sl_validate",
    "entity_details",
    "lucy_read_source",
    "lucy_query",
    "lucy_explain_query",
    "lucy_freshness"
  ].includes(tool);
}

/**
 * Lucy v0.25 (L25-14 §3.4 / §7) — R4 row-permission audit attribution.
 *
 * The durable audit mechanism already exists (`writeAccessConfigFileWithAuditClosure`
 * → durable intent → atomic write → runtime commit/ack → durable terminal, inside the
 * shared publish coordinator). This helper only adds the ROW-POLICY specifics the
 * configuration-audit record must carry:
 *
 * - the affected table identity,
 * - the before / after digest of the Role's row-policy content,
 * - the number of Agents the change reaches.
 *
 * The attribution rides on the existing `config_change_log` channel — no new audit
 * store, and nothing is written to the L25-09 inquiry runtime event stream.
 */
export interface RowPolicyAuditTableIdentity {
  connection: string;
  schema: string;
  name: string;
}

export interface RowPolicyAuditAttribution {
  /** The tables whose row policy changed. */
  tables: RowPolicyAuditTableIdentity[];
  /** Digest of the Role's row-policy content before the change. */
  beforeDigest: string;
  /** Digest of the Role's row-policy content after the change. */
  afterDigest: string;
  /** How many Agents reference the Role (the affected Agents). */
  affectedAgentCount: number;
  /** The operation id of this save; it is stored in the audit record's request id. */
  operationId: string;
}

type RowPolicyTableDigest = RowPolicyAuditTableIdentity & { digest: string };

function rowPolicyTableDigests(role: YamlRole | undefined): RowPolicyTableDigest[] {
  const out = new Map<string, RowPolicyTableDigest>();
  for (const selector of role?.allow?.tableSelectors ?? []) {
    if (!("names" in selector)) continue;
    for (const name of selector.names ?? []) {
      const identity: RowPolicyAuditTableIdentity = {
        connection: selector.connection ?? "",
        schema: selector.schema,
        name
      };
      const key = `${identity.connection}/${identity.schema}/${identity.name}`;
      out.set(key, {
        ...identity,
        digest: computeCandidateDigest({
          row_access: selector.row_access ?? null,
          row_policy: selector.row_policy ?? null
        })
      });
    }
  }
  return [...out.values()].sort((a, b) =>
    `${a.connection}/${a.schema}/${a.name}`.localeCompare(`${b.connection}/${b.schema}/${b.name}`)
  );
}

function agentsReferencingRole(config: YamlAccessConfig, roleId: string): number {
  return config.users.filter((user) => {
    const resolved = resolveRoleIds(user);
    return resolved.ok && resolved.roleIds.includes(roleId);
  }).length;
}

/**
 * Build the R4 attribution for a Role save, or `undefined` when the save does not
 * touch any row policy (a plain Role edit keeps its own change type).
 */
export function buildRowPolicyAuditAttribution(
  roleId: string,
  before: YamlRole | undefined,
  after: YamlRole | undefined,
  config: YamlAccessConfig,
  operationId: string
): RowPolicyAuditAttribution | undefined {
  const beforeTables = rowPolicyTableDigests(before);
  const afterTables = rowPolicyTableDigests(after);
  const beforeDigest = computeCandidateDigest(beforeTables);
  const afterDigest = computeCandidateDigest(afterTables);
  if (beforeDigest === afterDigest) return undefined;

  const changed: RowPolicyAuditTableIdentity[] = [];
  const seen = new Set<string>();
  for (const table of [...beforeTables, ...afterTables]) {
    const key = `${table.connection}/${table.schema}/${table.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    changed.push({ connection: table.connection, schema: table.schema, name: table.name });
  }

  return {
    tables: changed,
    beforeDigest,
    afterDigest,
    affectedAgentCount: agentsReferencingRole(config, roleId),
    operationId
  };
}

/**
 * Lucy v0.25 P1-1 §3.1 — a `row_policy` may reference a template.
 *
 * The reference form is `{ template, predicates? }`:
 *  - `template` must be a template name (`ROW_POLICY_TEMPLATE_NAME_PATTERN`);
 *  - `predicates` are the INLINE predicates and are optional when a template is
 *    referenced — the template's own predicates apply on their own, and inline
 *    predicates AND with them inside the same selector;
 *  - without a template, the inline predicates are still required and must be
 *    non-empty (the existing `parseRowPolicyShape` contract).
 *
 * The reference form is what gets STORED. The expansion into a single predicate
 * list happens in the runtime, right before the row-policy compiler reads the
 * selector (`proxy/acl.ts`), so the configuration never holds expanded products.
 */
function validateRowPolicyShapeWithTemplate(
  raw: unknown
): { ok: true; value: YamlRowPolicy } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "row_policy_invalid" };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "predicates" && key !== "template") {
      return { ok: false, reason: "row_policy_invalid_key" };
    }
  }
  let template: string | undefined;
  if (record.template !== undefined) {
    if (typeof record.template !== "string" || !ROW_POLICY_TEMPLATE_NAME_PATTERN.test(record.template.trim())) {
      return { ok: false, reason: "row_policy_template_name_invalid" };
    }
    template = record.template.trim();
  }
  if (record.predicates === undefined) {
    if (template === undefined) return { ok: false, reason: "row_policy_predicates_required" };
    return { ok: true, value: { template } };
  }
  const parsed = parseRowPolicyShape({ predicates: record.predicates });
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const value: YamlRowPolicy = { predicates: parsed.predicates };
  if (template !== undefined) value.template = template;
  return { ok: true, value };
}

/**
 * Lucy v0.25 P1-1 §5.1 — refuse a candidate configuration whose template references
 * cannot be resolved BEFORE it is written.
 *
 * A reference that only fails at runtime would deny the Role silently at request time;
 * a write-time refusal names the template and the Role instead.
 *
 * TWO CLASSES of issue, with two different consequences (P2-2):
 *
 *  - a REFERENCE issue (a selector references a template that does not exist, or
 *    references one whose definition is illegal) BLOCKS the write — the Role would
 *    deny at request time;
 *  - a CATALOG issue (an illegal template DEFINITION that no selector references) is
 *    only a diagnostic. It must not refuse an unrelated Role save, and the illegal
 *    template must survive the save untouched.
 *
 * Only TEMPLATE issues are reported here: a selector without a template reference is
 * not this check's business, so a legacy invalid INLINE policy never blocks an
 * unrelated save.
 */
function roleTemplateDiagnostics(config: YamlAccessConfig): {
  /** The issue that refuses the write, or null. */
  blocking: { code: string; message: string } | null;
  /** The catalog-level issues — reported, never blocking. */
  warnings: Array<{ code: string; templateName?: string; detail?: string }>;
} {
  const expansion = expandRowPolicyTemplatesInConfig(
    config as unknown as AccessConfigWithTemplates
  );
  const reference = expansion.referenceIssues[0];
  return {
    blocking: reference
      ? {
          code: reference.code,
          message: reference.detail ?? "行策略模板引用无法解析"
        }
      : null,
    warnings: expansion.catalogIssues.map((issue) => ({
      code: issue.code,
      templateName: issue.templateName,
      detail: issue.detail
    }))
  };
}

/**
 * L25-16 / G13 — 该角色是否授予了 **owner-only** 的控制面工具。
 *
 * 授予 owner-only 能力必须与 owner 本身同级。这只是规则 8 的一部分：
 * 任何 `allow.ops` 的创建或修改都要 owner，不能用「工具不是 owner-only」代替。
 */
export function roleGrantsOwnerOnlyTool(role: YamlRole | undefined): boolean {
  for (const grant of role?.allow?.ops ?? []) {
    for (const tool of grant.tools) {
      if (getOpsToolSpec(tool)?.ownerOnly) return true;
    }
  }
  return false;
}

/** 角色是否带控制面授权。创建或修改这类角色必须是 owner（Spec §3.2.2 规则 8）。 */
export function roleCarriesOpsGrant(role: YamlRole | undefined): boolean {
  const ops = role?.allow?.ops;
  return Array.isArray(ops) && ops.length > 0;
}

export function validateRoleShape(role: unknown): { ok: true; value: YamlRole } | { ok: false; reason: string } {
  if (!role || typeof role !== "object" || Array.isArray(role)) {
    return { ok: false, reason: "role must be an object" };
  }
  const obj = role as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "description" && key !== "allow" && key !== "permission_model_version") {
      return { ok: false, reason: `role.${key} is not allowed` };
    }
  }
  if (obj.description !== undefined && typeof obj.description !== "string") {
    return { ok: false, reason: "role.description must be a string" };
  }
  const modelVersion = normalizePermissionModelVersion(obj);
  if (!modelVersion.ok) {
    return { ok: false, reason: "role.permission_model_version must be 1 or 2" };
  }
  const permissionModelVersion = modelVersion.assumed ? undefined : modelVersion.version;
  if (obj.allow === undefined) {
    return {
      ok: true,
      value: { description: obj.description as string | undefined, permission_model_version: permissionModelVersion }
    };
  }
  if (!obj.allow || typeof obj.allow !== "object" || Array.isArray(obj.allow)) {
    return { ok: false, reason: "role.allow must be an object" };
  }
  const allow = obj.allow as Record<string, unknown>;
  for (const key of Object.keys(allow)) {
    // L25-16 — `allow.ops` 必须放行：否则控制面授权无法通过正式角色保存路径落盘
    // （Spec §3.2.1 / G3 / R12）。
    if (key !== "connections" && key !== "tableSelectors" && key !== "tools" && key !== "source_scope" && key !== "ops") {
      return { ok: false, reason: `allow.${key} is not allowed` };
    }
  }
  let sourceScope: "catalog_bound" | undefined;
  if (allow.source_scope !== undefined) {
    if (allow.source_scope !== "catalog_bound") {
      return { ok: false, reason: "allow.source_scope must be catalog_bound when set" };
    }
    sourceScope = "catalog_bound";
    // Explicit v1 only — missing version is assumed-1 and migrated by migrateRoleToV2 (Spec 131 P1-2).
    if (modelVersion.version === 1 && !modelVersion.assumed) {
      return { ok: false, reason: "catalog_bound requires permission_model_version 2" };
    }
  }
  let connections: string[] | undefined;
  if (allow.connections !== undefined) {
    if (!Array.isArray(allow.connections) || allow.connections.some((item) => typeof item !== "string")) {
      return { ok: false, reason: "allow.connections must be a string array" };
    }
    connections = (allow.connections as string[]).map((item) => item.trim()).filter(Boolean);
  }
  let tableSelectors: NonNullable<YamlRole["allow"]>["tableSelectors"] | undefined;
  if (allow.tableSelectors !== undefined) {
    if (!Array.isArray(allow.tableSelectors)) {
      return { ok: false, reason: "allow.tableSelectors must be an array" };
    }
    if (sourceScope === "catalog_bound" && allow.tableSelectors.length > 0) {
      return { ok: false, reason: "catalog_bound forbids tableSelectors" };
    }
    const built: NonNullable<YamlRole["allow"]>["tableSelectors"] = [];
    for (const raw of allow.tableSelectors as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, reason: "table selector must be an object" };
      }
      for (const key of Object.keys(raw)) {
        if (
          key !== "connection"
          && key !== "schema"
          && key !== "names"
          && key !== "prefix"
          && key !== "row_access"
          && key !== "row_policy"
        ) {
          return { ok: false, reason: `table selector ${key} is not allowed` };
        }
      }
      if (raw.connection !== undefined && typeof raw.connection !== "string") {
        return { ok: false, reason: "table selector connection must be a string" };
      }
      if (typeof raw.schema !== "string" || !raw.schema.trim()) {
        return { ok: false, reason: "table selector schema is required" };
      }
      if (raw.row_access !== undefined && raw.row_access !== "all" && raw.row_access !== "scoped") {
        return { ok: false, reason: "table selector row_access must be 'all' or 'scoped'" };
      }
      const rowAccess = raw.row_access as YamlRowAccess | undefined;
      if (rowAccess !== "scoped" && raw.row_policy !== undefined) {
        return { ok: false, reason: "table selector row_policy is only valid with row_access 'scoped'" };
      }
      // Spec 99 §7 — generation 1 (incl. missing version) has no scoped / row_policy.
      if (
        modelVersion.version === 1 &&
        (rowAccess === "scoped" || raw.row_policy !== undefined)
      ) {
        return {
          ok: false,
          reason: "permission_model_version 1 forbids scoped/row_policy (v1_scoped_forbidden)"
        };
      }
      let rowPolicy: YamlRowPolicy | undefined;
      if (rowAccess === "scoped") {
        const parsed = validateRowPolicyShapeWithTemplate(raw.row_policy);
        if (!parsed.ok) {
          return { ok: false, reason: `table selector scoped requires valid row_policy (${parsed.reason})` };
        }
        rowPolicy = parsed.value;
      }
      const hasNames = raw.names !== undefined;
      const hasPrefix = raw.prefix !== undefined;
      if (hasNames === hasPrefix) {
        return { ok: false, reason: "table selector must set exactly one of names or prefix" };
      }
      if (hasNames) {
        if (!Array.isArray(raw.names) || raw.names.length === 0) {
          return { ok: false, reason: "table selector names must be a non-empty array" };
        }
        if (raw.names.some((item) => typeof item !== "string" || !item.trim())) {
          return { ok: false, reason: "table selector names must be a non-empty array of strings" };
        }
        built.push({
          connection: typeof raw.connection === "string" ? raw.connection.trim() || undefined : undefined,
          schema: raw.schema.trim(),
          names: (raw.names as string[]).map((item) => item.trim()).filter(Boolean),
          row_access: rowAccess,
          row_policy: rowPolicy
        });
      } else {
        if (typeof raw.prefix !== "string" || !raw.prefix.trim()) {
          return { ok: false, reason: "table selector prefix must be a non-empty string" };
        }
        built.push({
          connection: typeof raw.connection === "string" ? raw.connection.trim() || undefined : undefined,
          schema: raw.schema.trim(),
          prefix: (raw.prefix as string).trim(),
          row_access: rowAccess,
          row_policy: rowPolicy
        });
      }
    }
    tableSelectors = built;
  }
  let tools: string[] | undefined;
  if (allow.tools !== undefined) {
    if (!Array.isArray(allow.tools) || allow.tools.length === 0) {
      return { ok: false, reason: "allow.tools must be a non-empty array" };
    }
    if (allow.tools.some((item) => typeof item !== "string")) {
      return { ok: false, reason: "allow.tools must be a string array" };
    }
    tools = (allow.tools as string[]).map((item) => item.trim()).filter(Boolean);
    if (tools.includes("*")) {
      return { ok: false, reason: "wildcard tools ('*') are not allowed" };
    }
    for (const tool of tools) {
      const denyReason = absoluteDenyOrUnclassifiedReason(tool);
      if (denyReason) {
        return { ok: false, reason: `allow.tools contains forbidden tool (${denyReason})` };
      }
    }
  }

  const hasTableTouchingTool = (tools ?? []).some(isTableTouchingTool);
  if (
    (sourceScope === "catalog_bound" || (tableSelectors && tableSelectors.length > 0) || hasTableTouchingTool)
    && (!connections || connections.length === 0)
  ) {
    return { ok: false, reason: "connections must be set when role uses table selectors, catalog_bound, or table-touching tools" };
  }

  // L25-16 — 控制面 grant 校验（Spec §3.2.1 / §3.2.2 规则 2、4、5）。
  let ops: NonNullable<YamlRole["allow"]>["ops"] | undefined;
  if (allow.ops !== undefined) {
    if (!Array.isArray(allow.ops)) {
      return { ok: false, reason: "allow.ops must be an array" };
    }
    const built: NonNullable<YamlRole["allow"]>["ops"] = [];
    for (const raw of allow.ops as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, reason: "allow.ops entry must be an object" };
      }
      for (const key of Object.keys(raw)) {
        if (key !== "tools" && key !== "asset_kinds" && key !== "connections" && key !== "instance_scope") {
          return { ok: false, reason: `allow.ops entry ${key} is not allowed` };
        }
      }
      if (!Array.isArray(raw.tools) || raw.tools.length === 0
        || raw.tools.some((item) => typeof item !== "string" || !item.trim())) {
        return { ok: false, reason: "allow.ops tools must be a non-empty string array" };
      }
      const grantTools = (raw.tools as string[]).map((item) => item.trim()).filter(Boolean);
      if (grantTools.includes("*")) {
        return { ok: false, reason: "allow.ops tools must not contain '*'" };
      }
      for (const tool of grantTools) {
        if (!isControlPlaneTool(tool)) {
          return { ok: false, reason: `allow.ops tools contains unknown control-plane tool ${tool}` };
        }
      }
      if (!Array.isArray(raw.asset_kinds) || raw.asset_kinds.length === 0
        || raw.asset_kinds.some((item) => typeof item !== "string" || !item.trim())) {
        return { ok: false, reason: "allow.ops asset_kinds must be a non-empty string array" };
      }
      const assetKinds = (raw.asset_kinds as string[]).map((item) => item.trim()).filter(Boolean);
      for (const kind of assetKinds) {
        if (!isOpsAssetKind(kind)) {
          return { ok: false, reason: `allow.ops asset_kinds contains unknown kind ${kind}` };
        }
      }
      let grantConnections: string[] | undefined;
      if (raw.connections !== undefined) {
        if (!Array.isArray(raw.connections)
          || raw.connections.some((item) => typeof item !== "string")) {
          return { ok: false, reason: "allow.ops connections must be a string array" };
        }
        grantConnections = (raw.connections as string[]).map((item) => item.trim()).filter(Boolean);
      }
      let instanceScope: "read_only" | undefined;
      if (raw.instance_scope !== undefined) {
        if (raw.instance_scope !== "read_only") {
          return { ok: false, reason: "allow.ops instance_scope must be 'read_only' when set" };
        }
        instanceScope = "read_only";
      }
      if (instanceScope === "read_only") {
        const writeTool = grantTools.find((tool) => getOpsToolSpec(tool)?.write);
        if (writeTool) {
          return { ok: false, reason: `allow.ops instance_scope read_only cannot grant write tool ${writeTool}` };
        }
      }
      built.push({
        tools: grantTools,
        asset_kinds: assetKinds,
        ...(grantConnections ? { connections: grantConnections } : {}),
        ...(instanceScope ? { instance_scope: instanceScope } : {})
      });
    }
    ops = built;
  }

  return {
    ok: true,
    value: {
      description: obj.description as string | undefined,
      permission_model_version: permissionModelVersion,
      allow: {
        connections,
        source_scope: sourceScope,
        tableSelectors,
        tools,
        ops
      }
    }
  };
}

export interface RoleMigration {
  fromVersion: YamlPermissionModelVersion;
  toVersion: 2;
  /** True when the stored shape actually changes (version bump / row_access / prefix). */
  changed: boolean;
  expandedPrefixes: Array<{ prefix: string; names: string[] }>;
}

/**
 * Spec 98 §7 / ADR-AC-04 — every Admin write persists generation 2:
 * explicit `row_access: all` per selector and `prefix` expanded to concrete
 * `names` against the current source map. A prefix that expands to 0 sources
 * fails the save rather than silently narrowing the Role.
 */
export async function migrateRoleToV2(
  role: YamlRole
): Promise<{ ok: true; value: YamlRole; migration: RoleMigration } | { ok: false; reason: string }> {
  const before = normalizePermissionModelVersion(role);
  if (!before.ok) return { ok: false, reason: "role.permission_model_version must be 1 or 2" };

  const selectors = role.allow?.tableSelectors;
  const expandedPrefixes: RoleMigration["expandedPrefixes"] = [];
  let selectorsChanged = false;
  let nextSelectors: YamlTableSelector[] | undefined;

  if (selectors) {
    nextSelectors = [];
    for (const selector of selectors) {
      if (selector.row_access === "scoped") {
        // A template reference survives the v1→v2 migration unchanged: the
        // reference form is what is stored, the expansion happens in the runtime.
        const parsed = validateRowPolicyShapeWithTemplate(selector.row_policy);
        if (!parsed.ok) {
          return {
            ok: false,
            reason: `table selector row_access 'scoped' requires valid row_policy (${parsed.reason})`
          };
        }
        if ("prefix" in selector && selector.prefix !== undefined) {
          const names = await expandSelectorSourceNames(selector);
          if (names.length === 0) {
            return { ok: false, reason: `table selector prefix '${selector.prefix}' expands to 0 source` };
          }
          expandedPrefixes.push({ prefix: selector.prefix, names });
          nextSelectors.push({
            connection: selector.connection,
            schema: selector.schema,
            names,
            row_access: "scoped",
            row_policy: parsed.value
          });
          selectorsChanged = true;
          continue;
        }
        nextSelectors.push({
          ...selector,
          row_access: "scoped",
          row_policy: parsed.value
        });
        continue;
      }
      if (selector.row_policy !== undefined) {
        return { ok: false, reason: "table selector row_policy is only valid with row_access 'scoped'" };
      }
      if ("prefix" in selector && selector.prefix !== undefined) {
        const names = await expandSelectorSourceNames(selector);
        if (names.length === 0) {
          return { ok: false, reason: `table selector prefix '${selector.prefix}' expands to 0 source` };
        }
        expandedPrefixes.push({ prefix: selector.prefix, names });
        nextSelectors.push({ connection: selector.connection, schema: selector.schema, names, row_access: "all" });
        selectorsChanged = true;
        continue;
      }
      if (selector.row_access !== "all") selectorsChanged = true;
      nextSelectors.push({ ...selector, row_access: "all" });
    }
  }

  return {
    ok: true,
    value: {
      ...role,
      permission_model_version: 2,
      allow: role.allow ? { ...role.allow, tableSelectors: nextSelectors } : role.allow
    },
    migration: {
      fromVersion: before.version,
      toVersion: 2,
      changed: selectorsChanged || before.assumed || before.version !== 2,
      expandedPrefixes
    }
  };
}

/**
 * The template issue code inside a role-resolution reason, if any.
 *
 * The runtime reports a Role whose template reference cannot be resolved as
 * `role_resolution_failed:<roleId>:row_policy_template_unresolved`. The write
 * path has to name that code instead of a generic `INVALID_ROLE`, so the
 * operator sees that the REFERENCE is the problem (P1-1 §5.1).
 */
function templateIssueCodeOf(reason: string): string | undefined {
  return reason
    .split(":")
    .find((part) => part.startsWith("row_policy_template_"));
}

/**
 * Spec §14.2.1 — normalize a Role draft the way the WRITE path normalizes it.
 *
 * The preview and the save must build the SAME candidate, otherwise the
 * candidate digest could never match. Both sides therefore run the identical
 * normalization (`resolveRoleForWrite`) before the candidate is assembled.
 */
export async function normalizeRoleForSave(
  roleId: string,
  role: unknown
): Promise<
  { ok: true; value: YamlRole }
  | { ok: false; code: string; message: string; status: number }
> {
  const resolved = await resolveRoleForWrite(roleId, role as YamlRole, { allowTemplateId: true });
  if (!resolved.ok) return resolved;
  return { ok: true, value: resolved.value };
}

/**
 * Spec §14.2.1 — does this Role carry a row-policy surface at all?
 *
 * A write entry point that can carry or change a row policy must consume the
 * preview confirmation; a Role that never touches one has no row-policy impact
 * to confirm.
 */
export function roleCarriesRowPolicy(role: YamlRole | undefined): boolean {
  for (const selector of role?.allow?.tableSelectors ?? []) {
    if (selector.row_access === "scoped") return true;
    if (selector.row_policy !== undefined) return true;
  }
  return false;
}

/**
 * Spec §14.2.2 — `requireAccessRecoveryClearOrFailClosed()`.
 *
 * The recovery gate is checked INSIDE the shared publish window and BEFORE the
 * candidate is rebuilt: an unresolved recovery is the real reason, and it must
 * not be reported as a stale preview confirmation.
 */
async function accessRecoveryRejection(
  projectRoot: string
): Promise<{ code: string; message: string } | undefined> {
  const state = await readAccessRecoveryState(projectRoot);
  if (!state.required) return undefined;
  return {
    code: "ACCESS_RECOVERY_REQUIRED",
    message: "访问控制配置处于待恢复状态，已阻断后续写入；请先完成恢复核验。"
  };
}

async function resolveRoleForWrite(
  roleId: string,
  role: YamlRole,
  options: { allowTemplateId?: boolean } = {}
): Promise<
  { ok: true; value: YamlRole; migration: RoleMigration }
  | { ok: false; code: string; message: string; status: number }
> {  if (!ROLE_ID_RE.test(roleId)) {
    return {
      ok: false,
      code: "INVALID_ROLE_ID",
      message: "roleId must match ^[A-Za-z0-9_-]{1,64}$",
      status: 400
    };
  }
  const shape = validateRoleShape(role);
  if (!shape.ok) {
    return { ok: false, code: "INVALID_ROLE", message: shape.reason, status: 400 };
  }
  if (!options.allowTemplateId && ROLE_TEMPLATES[roleId]) {
    return { ok: false, code: "ROLE_ID_TAKEN", message: `role id '${roleId}' conflicts with built-in template`, status: 409 };
  }
  const migrated = await migrateRoleToV2(shape.value);
  if (!migrated.ok) {
    return { ok: false, code: "INVALID_ROLE", message: migrated.reason, status: 400 };
  }
  const allow = migrated.value.allow;
  if (allow?.connections?.includes("*") && roleId !== LUCY_ADMIN_ROLE_ID) {
    return { ok: false, code: "INVALID_ROLE", message: "connections '*' is only valid on lucy_admin", status: 400 };
  }
  if (roleId === LUCY_ADMIN_ROLE_ID && allow?.source_scope === "catalog_bound" && allow) {
    migrated.value = { ...migrated.value, allow: { ...allow, connections: ["*"] } };
  }
  const resolved = await previewRolePermissionsForAdmin(roleId, { role: migrated.value });
  if (!resolved.ok) {
    // A Role that references a template which cannot be resolved gets the
    // TEMPLATE code, not a generic `INVALID_ROLE`: the operator has to know
    // that the reference is the problem (P1-1 §5.1, P2-2).
    return {
      ok: false,
      code: templateIssueCodeOf(resolved.reason) ?? "INVALID_ROLE",
      message: resolved.reason,
      status: 400
    };
  }
  if (resolved.permissions.sources.length === 0 && (migrated.value.allow?.tableSelectors?.length ?? 0) > 0) {
    return { ok: false, code: "INVALID_ROLE", message: "role resolves to 0 source", status: 400 };
  }
  return { ok: true, value: migrated.value, migration: migrated.migration };
}

type RoleContextGuardFailure = { status: number; code: string; message: string; detail?: unknown };

/**
 * Spec §4.3 — a retired Role id is never reusable, and a new Role must not silently activate
 * historical Wiki / Skill ACL references to its id (acknowledgement is an explicit, audited choice).
 */
async function guardRoleIdForCreate(roleId: string, acknowledged: boolean): Promise<RoleContextGuardFailure | undefined> {
  const store = await getSecurityStore();
  const retired = store.ok ? store.value.isRoleIdTombstoned(roleId) : store;
  if (!store.ok || !retired.ok) {
    return { status: 503, code: "SECURITY_STORE_UNAVAILABLE", message: "Role id retirement state is unavailable; try again after the security store recovers" };
  }
  if (retired.value) {
    return { status: 409, code: "ROLE_ID_RETIRED", message: `role id '${roleId}' was deleted and cannot be reused` };
  }
  const refs = contextReferencesToRole(await listContextInventory(), roleId);
  if (hasContextReferences(refs) && !acknowledged) {
    return {
      status: 409,
      code: "ROLE_ID_HAS_CONTEXT_REFERENCES",
      message: `existing Wiki/Skill ACLs already name '${roleId}'; clean them up or acknowledge before creating the role`,
      detail: refs
    };
  }
  return undefined;
}

export function registerRoleRoutes(app: FastifyInstance) {
  // GET /api/admin/roles — list with usageCount and users
  app.get<{ Querystring: { includeTemplates?: string } }>("/api/admin/roles", async (request) => {
    const projectRoot = await resolveProjectRoot();
    const { config, mtimeMs } = await readAccessYaml(projectRoot);
    const configUpdatedAt = new Date(mtimeMs).toISOString();
    const includeTemplates = request.query.includeTemplates !== "false";

    const yamlEntries: ResolvedRole[] = Object.entries(config.roles ?? {})
        .filter(([, role]) => role.allow !== undefined)
        .map(([id, role]) => ({ id, role, source: "yaml" }));
    const templateEntries: ResolvedRole[] = includeTemplates
      ? Object.keys(ROLE_TEMPLATES).flatMap((id) => {
          if (config.roles?.[id]?.allow) return [];
          const expanded = expandTemplate(id);
          return expanded ? [{ id, role: expanded, source: "template" as const }] : [];
        })
      : [];
    const entries: ResolvedRole[] = [...yamlEntries, ...templateEntries];

    const roles = await Promise.all(
      entries.map(async (entry) => {
        const resolved = await previewRolePermissionsForAdmin(
          entry.id,
          entry.source === "template" ? { role: entry.role } : undefined
        );
        const summary = buildRoleSummary(config, entry);
        const sourceNames = sourceNamesFromPreview(resolved);
        return {
          ...summary,
          sourceCount: resolved.ok ? resolved.permissions.sources.length : 0,
          sourceNames,
          invalid: !resolved.ok,
          warnings: resolved.ok ? [] : [resolved.reason],
          configUpdatedAt: entry.source === "yaml" ? configUpdatedAt : null
        };
      })
    );

    return { ok: true, data: { roles } };
  });

  // GET /api/admin/roles/:roleId — single role detail
  app.get<{ Params: { roleId: string } }>("/api/admin/roles/:roleId", async (request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const { config, version, mtimeMs } = await readAccessYaml(projectRoot);
    const resolved = findRole(config, request.params.roleId);
    if (!resolved) {
      return reply.status(404).send({ ok: false, error: { code: "ROLE_NOT_FOUND", message: `Role '${request.params.roleId}' not found` } });
    }
    const summary = buildRoleSummary(config, resolved);
    const preview = await previewRolePermissionsForAdmin(
      resolved.id,
      resolved.source === "template" ? { role: resolved.role } : undefined
    );
    const sourceNames = sourceNamesFromPreview(preview);
    const roleTools = resolved.role.allow?.tools ?? [];
    const skillAccess = summarizeRoleSkillAccess(resolved.id, roleTools, await loadAllSkills());
    const contextEntries = await listContextInventory();
    const wikiAccess = summarizeRoleWikiAccess(resolved.id, roleTools, contextEntries);
    const contextPolicyVersion = computeContextPolicyVersion(contextEntries, `${resolved.id}:${[...roleTools].sort().join(",")}`);
    return {
      ok: true,
      data: {
        ...summary,
        version,
        sourceCount: preview.ok ? preview.permissions.sources.length : 0,
        sourceNames,
        invalid: !preview.ok,
        warnings: preview.ok ? [] : [preview.reason],
        configUpdatedAt: resolved.source === "yaml" ? new Date(mtimeMs).toISOString() : null,
        role: {
          description: resolved.role.description,
          allow: resolved.role.allow ?? {}
        },
        effectivePermissions: preview.ok ? effectivePermissionsToPreview(preview.permissions) : undefined,
        skillAccess,
        wikiAccess,
        contextPolicyVersion
      }
    };
  });

  // POST /api/admin/roles/_preview — preview without writing
  app.post<{ Body: { roleId?: string; role?: unknown } }>("/api/admin/roles/_preview", async (request, reply) => {
    const { roleId, role } = request.body ?? {};
    if (typeof roleId !== "string" || !roleId.trim()) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "roleId is required" } });
    }
    if (!ROLE_ID_RE.test(roleId)) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE_ID", message: "roleId must match ^[A-Za-z0-9_-]{1,64}$" } });
    }
    const shape = validateRoleShape(role);
    if (!shape.ok) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: shape.reason } });
    }
    const resolved = await previewRolePermissionsForAdmin(roleId, { role: shape.value });
    if (!resolved.ok) {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_ROLE", message: resolved.reason } });
    }
    return {
      ok: true,
      data: {
        effectivePermissions: effectivePermissionsToPreview(resolved.permissions),
        warnings: []
      }
    };
  });

  // POST /api/admin/roles — create role (dryRun-first)
  app.post<{
    Body: {
      dryRun?: boolean;
      override?: AccessGovernanceOverrideRequest;
      roleId?: string;
      role?: unknown;
      acknowledgeContextReferences?: boolean;
      /**
       * Spec §14.2.1 — the preview confirmation. Required when the new Role
       * carries a row policy: a create must not be a way around the
       * confirmation the PATCH entry point requires.
       */
      rowPolicyConfirmation?: unknown;
    };
  }>("/api/admin/roles", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const { roleId, role } = request.body ?? {};
    if (typeof roleId !== "string" || !roleId.trim()) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "roleId is required" } });
    }
    const validated = await resolveRoleForWrite(roleId, role as YamlRole, { allowTemplateId: true });
    if (!validated.ok) {
      return reply.status(validated.status).send({ ok: false, error: { code: validated.code, message: validated.message } });
    }
    const projectRoot = await resolveProjectRoot();
    const { config, raw } = await readAccessYaml(projectRoot);
    if (config.roles?.[roleId]) {
      return reply.status(409).send({ ok: false, error: { code: "ROLE_ID_TAKEN", message: `role '${roleId}' already exists` } });
    }
    // L25-16 / G13 — 任何 allow.ops 都是控制面可达范围，创建时必须 owner。
    // 不能只拦 owner-only 工具：W-A 的两个写工具都不是 owner-only。
    if (roleCarriesOpsGrant(validated.value)) {
      if (!(await requireOwnerForOps(request, reply, "仅所有者可授予控制面授权（allow.ops）"))) return;
    }
    const contextGuard = await guardRoleIdForCreate(roleId, request.body?.acknowledgeContextReferences === true);
    if (contextGuard) {
      return reply.status(contextGuard.status).send({
        ok: false,
        error: { code: contextGuard.code, message: contextGuard.message, ...(contextGuard.detail ? { detail: contextGuard.detail } : {}) }
      });
    }
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: {
        ...(config.roles ?? {}),
        [roleId]: validated.value
      }
    };
    // Lucy v0.25 P1-1 §5.1 — a template reference that cannot be resolved must be
    // refused at write time, not at request time. An illegal template DEFINITION
    // that nothing references is only a warning (P2-2).
    const templateDiagnostics = roleTemplateDiagnostics(newConfig);
    if (templateDiagnostics.blocking) {
      return reply.status(400).send({
        ok: false,
        error: { code: templateDiagnostics.blocking.code, message: templateDiagnostics.blocking.message }
      });
    }
    // re-stringify via the same stringify used by write
    const proposedYaml = await import("yaml").then(({ stringify }) => stringify(newConfig, { lineWidth: 0 }));
    const diff = makeDiff(raw, proposedYaml);

    // Access Governance Gate — Tiered Access Governance Gate (P1 / 64).
    const gateInput = await buildRoleGateInput({
      targetKind: "role",
      targetId: roleId,
      oldRole: undefined,
      newRole: validated.value
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, gate, migration: validated.migration, templateWarnings: templateDiagnostics.warnings } };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this role create",
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

    // Lucy v0.25 (L25-14 §3.4) — R4 attribution for a Role create that already
    // carries a row policy.
    const operationId = `row_policy_update:${roleId}:${randomUUID()}`;
    const rowPolicyAttribution = buildRowPolicyAuditAttribution(
      roleId,
      undefined,
      validated.value,
      config,
      operationId
    );
    // ── the create runs INSIDE the shared publish window (spec §14.2.2) ─────
    return runInAccessPublishWindow("role_policy_save", projectRoot, async () => {
      // 0) Spec §14.2.2 — the recovery gate comes first: an unresolved recovery
      //    fails the write closed before any candidate is rebuilt.
      const recovery = await accessRecoveryRejection(projectRoot);
      if (recovery) {
        return reply.status(503).send({ ok: false, error: recovery });
      }
      const fresh = await readAccessYamlVersion(projectRoot);
      const freshConfig = (await import("yaml")).parse(fresh.raw) as YamlAccessConfig;
      if (!freshConfig.users) freshConfig.users = [];
      if (freshConfig.roles?.[roleId]) {
        return reply.status(409).send({
          ok: false,
          error: { code: "ROLE_ID_TAKEN", message: `role '${roleId}' already exists` }
        });
      }

      // Spec §14.2.1 — a create that carries a row policy consumes the same
      // confirmation the PATCH entry point requires.
      if (roleCarriesRowPolicy(validated.value)) {
        const verification = await verifyRowPolicyPreviewConfirmation({
          roleId,
          role: validated.value,
          confirmation: request.body?.rowPolicyConfirmation,
          baseConfig: freshConfig as never,
          baseAccessVersion: fresh.version
        });
        if (!verification.ok) {
          return reply.status(409).send({
            ok: false,
            error: {
              code: "ROW_POLICY_PREVIEW_REQUIRED",
              message: verification.message ?? "最终行约束预览确认缺失或已失效",
              detail: { reason: verification.reason, ...(verification.detail ?? {}) }
            }
          });
        }
      }

      const freshConfigWithRole: YamlAccessConfig = {
        ...freshConfig,
        roles: { ...(freshConfig.roles ?? {}), [roleId]: validated.value }
      };
      const freshDiff = makeDiff(fresh.raw, (await import("yaml")).stringify(freshConfigWithRole, { lineWidth: 0 }));
      const freshAttribution = buildRowPolicyAuditAttribution(
        roleId,
        undefined,
        validated.value,
        freshConfig,
        operationId
      );

      const writeResult = await writeAccessYaml(projectRoot, freshConfigWithRole, {
      enabled: true,
      changeType: freshAttribution ? "row_policy_update" : "role_create",
      operation: freshAttribution ? "row_policy.update" : undefined,
      targetId: roleId,
      oldSummary: {
        roleIds: Object.keys(freshConfig.roles ?? {}),
        ...(freshAttribution
          ? {
              rowPolicy: {
                operationId: freshAttribution.operationId,
                tables: freshAttribution.tables,
                beforeDigest: freshAttribution.beforeDigest,
                affectedAgentCount: freshAttribution.affectedAgentCount
              }
            }
          : {})
      },
      newSummary: {
        roleIds: Object.keys(freshConfigWithRole.roles ?? {}),
        description: validated.value.description,
        ...(freshAttribution
          ? {
              rowPolicy: {
                operationId: freshAttribution.operationId,
                tables: freshAttribution.tables,
                beforeDigest: freshAttribution.beforeDigest,
                afterDigest: freshAttribution.afterDigest,
                affectedAgentCount: freshAttribution.affectedAgentCount
              }
            }
          : {})
      },
      diff: freshDiff,
      ...auditActorFields(trustedActorFromRequest(request)),
      source: "admin_roles_api"
    });

      const detail = await readAccessYaml(projectRoot);
      const finalResolved = findRole(detail.config, roleId);
      if (!finalResolved) {
        return reply.status(500).send({ ok: false, error: { code: "INTERNAL", message: "role was not persisted" } });
      }
      const summary = buildRoleSummary(detail.config, finalResolved);
      const preview = await previewRolePermissionsForAdmin(roleId, { role: finalResolved.role });
      const response = accessWriteResponseBody(writeResult, {
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        auditId: writeResult.auditId,
        rowPolicy: freshAttribution,
        gate,
        templateWarnings: templateDiagnostics.warnings,
        operationId,
        role: {
          ...summary,
          sourceCount: preview.ok ? preview.permissions.sources.length : 0,
          sourceNames: sourceNamesFromPreview(preview),
          invalid: !preview.ok,
          warnings: preview.ok ? [] : [preview.reason],
          role: {
            description: finalResolved.role.description,
            allow: finalResolved.role.allow ?? {}
          },
          effectivePermissions: preview.ok ? effectivePermissionsToPreview(preview.permissions) : undefined
        }
      });
      return reply.status(response.statusCode).send(response.body);
    });
  });

  // PATCH /api/admin/roles/:roleId — edit yaml role
  app.patch<{
    Params: { roleId: string };
    Body: {
      dryRun?: boolean;
      version?: string;
      override?: AccessGovernanceOverrideRequest;
      patch?: { description?: unknown; allow?: unknown; permission_model_version?: unknown };
      /**
       * Spec §14.2.1 — the preview confirmation. Required whenever the Role
       * carries a row-policy surface. The server re-derives every digest inside
       * the publish window; the client is never trusted.
       */
      rowPolicyConfirmation?: unknown;
    };
  }>("/api/admin/roles/:roleId", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const projectRoot = await resolveProjectRoot();
    const { raw, version: currentVersion } = await readAccessYamlVersion(projectRoot);
    if (request.body?.version && request.body.version !== currentVersion) {
      return reply.status(409).send({ ok: false, error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" } });
    }
    const config = (await import("yaml")).parse(raw) as YamlAccessConfig;
    if (!config.users) config.users = [];
    const existing = config.roles?.[request.params.roleId];
    if (!existing || !existing.allow) {
      // template role is read-only
      if (ROLE_TEMPLATES[request.params.roleId]) {
        return reply.status(400).send({ ok: false, error: { code: "TEMPLATE_ROLE_READONLY", message: "template roles are read-only" } });
      }
      return reply.status(404).send({ ok: false, error: { code: "ROLE_NOT_FOUND", message: `role '${request.params.roleId}' not found` } });
    }
    // The write entry point that can change a row policy consumes the preview
    // confirmation (spec §14.2.1). The confirmation is REQUIRED whenever the
    // Role carries a row-policy surface — before or after the change.
    const rowPolicyConfirmationRequired =
      roleCarriesRowPolicy(existing) ||
      roleCarriesRowPolicy(
        request.body?.patch?.allow
          ? ({ allow: request.body.patch.allow } as YamlRole)
          : undefined
      );
    const patch: { description?: unknown; allow?: unknown; permission_model_version?: unknown } = {
      ...(request.body?.patch ?? {})
    };
    if (bodyHasOwn(patch, "id") || bodyHasOwn(patch, "roleId")) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "role id cannot be changed" } });
    }
    // Echoing the stored field is not an edit. A missing field is not equal to 2
    // (or to the assumed v1), so sending a version still cannot upgrade v1 to v2.
    if (
      bodyHasOwn(patch, "permission_model_version")
      && existing.permission_model_version !== undefined
      && patch.permission_model_version === existing.permission_model_version
    ) {
      delete patch.permission_model_version;
    }
    for (const key of Object.keys(patch)) {
      if (key !== "description" && key !== "allow") {
        return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: `patch.${key} is not editable` } });
      }
    }
    const next: YamlRole = {
      ...existing,
      description: patch.description !== undefined
        ? (typeof patch.description === "string" ? patch.description : existing.description)
        : existing.description,
      allow: patch.allow !== undefined
        ? (patch.allow as YamlRole["allow"])
        : existing.allow
    };
    // L25-16 / G13 — 旧角色或改完后的角色带 allow.ops，都必须是 owner。
    // 检查放在合并之后：只看修改前会漏掉「普通角色被 PATCH 进控制面工具」。
    if (roleCarriesOpsGrant(existing) || roleCarriesOpsGrant(next)) {
      if (!(await requireOwnerForOps(request, reply, "仅所有者可修改带控制面授权（allow.ops）的角色"))) return;
    }
    const validated = await resolveRoleForWrite(request.params.roleId, next, { allowTemplateId: true });
    if (!validated.ok) {
      return reply.status(validated.status).send({ ok: false, error: { code: validated.code, message: validated.message } });
    }
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: { ...(config.roles ?? {}), [request.params.roleId]: validated.value }
    };
    // Lucy v0.25 P1-1 §5.1 — a template reference that cannot be resolved must be
    // refused at write time, not at request time. An illegal template DEFINITION
    // that nothing references is only a warning (P2-2).
    const templateDiagnostics = roleTemplateDiagnostics(newConfig);
    if (templateDiagnostics.blocking) {
      return reply.status(400).send({
        ok: false,
        error: { code: templateDiagnostics.blocking.code, message: templateDiagnostics.blocking.message }
      });
    }
    const proposedYaml = (await import("yaml")).stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    // Access Governance Gate — Tiered Access Governance Gate (P1 / 64).
    const gateInput = await buildRoleGateInput({
      targetKind: "role",
      targetId: request.params.roleId,
      oldRole: existing,
      newRole: validated.value
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, version: currentVersion, gate, migration: validated.migration, templateWarnings: templateDiagnostics.warnings } };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this role patch",
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

    // Lucy v0.25 (L25-14 §3.4) — R4 attribution: a save that touches a row policy is
    // recorded as a row-permission change in the existing configuration-audit channel.
    const operationId = `row_policy_update:${request.params.roleId}:${randomUUID()}`;
    const rowPolicyAttribution = buildRowPolicyAuditAttribution(
      request.params.roleId,
      existing,
      validated.value,
      config,
      operationId
    );
    // ── the save runs INSIDE the shared publish window (spec §14.2.2) ────────
    // The window covers the baseline re-read, the candidate rebuild, the final
    // preview and the confirmation comparison, the intent, the write, the
    // runtime swap, the terminal audit and the failure recovery. The submission
    // re-check may NOT be moved outside of it.
    return runInAccessPublishWindow("role_policy_save", projectRoot, async () => {
      // 0) Spec §14.2.2 — the recovery gate comes first: an unresolved recovery
      //    fails the write closed before any candidate is rebuilt.
      const recovery = await accessRecoveryRejection(projectRoot);
      if (recovery) {
        return reply.status(503).send({ ok: false, error: recovery });
      }
      // 1) Re-read the access baseline INSIDE the window. The lock-outside raw
      //    must not be used to decide anything.
      const fresh = await readAccessYamlVersion(projectRoot);
      if (request.body?.version && request.body.version !== fresh.version) {
        return reply.status(409).send({
          ok: false,
          error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" }
        });
      }
      const freshConfig = (await import("yaml")).parse(fresh.raw) as YamlAccessConfig;
      if (!freshConfig.users) freshConfig.users = [];
      const freshExisting = freshConfig.roles?.[request.params.roleId];
      if (!freshExisting || !freshExisting.allow) {
        return reply.status(409).send({
          ok: false,
          error: { code: "ROLE_CHANGED", message: "role changed while saving, please refresh" }
        });
      }
      const freshNext: YamlRole = {
        ...freshExisting,
        description: patch.description !== undefined
          ? (typeof patch.description === "string" ? patch.description : freshExisting.description)
          : freshExisting.description,
        allow: patch.allow !== undefined
          ? (patch.allow as YamlRole["allow"])
          : freshExisting.allow
      };
      const freshValidated = await resolveRoleForWrite(request.params.roleId, freshNext, { allowTemplateId: true });
      if (!freshValidated.ok) {
        return reply.status(freshValidated.status).send({
          ok: false,
          error: { code: freshValidated.code, message: freshValidated.message }
        });
      }

      // 2) The preview confirmation (spec §14.2.1). Every rejection happens
      //    BEFORE the durable intent and before any configuration write:
      //    zero configuration write, zero row-policy intent.
      if (rowPolicyConfirmationRequired) {
        const verification = await verifyRowPolicyPreviewConfirmation({
          roleId: request.params.roleId,
          role: freshValidated.value,
          confirmation: request.body?.rowPolicyConfirmation,
          baseConfig: freshConfig as never,
          baseAccessVersion: fresh.version
        });
        if (!verification.ok) {
          return reply.status(409).send({
            ok: false,
            error: {
              code: "ROW_POLICY_PREVIEW_REQUIRED",
              message: verification.message ?? "最终行约束预览确认缺失或已失效",
              detail: { reason: verification.reason, ...(verification.detail ?? {}) }
            }
          });
        }
      }

      const freshConfigWithRole: YamlAccessConfig = {
        ...freshConfig,
        roles: { ...(freshConfig.roles ?? {}), [request.params.roleId]: freshValidated.value }
      };
      const freshDiff = makeDiff(fresh.raw, (await import("yaml")).stringify(freshConfigWithRole, { lineWidth: 0 }));
      const freshAttribution = buildRowPolicyAuditAttribution(
        request.params.roleId,
        freshExisting,
        freshValidated.value,
        freshConfig,
        operationId
      );

      const writeResult = await writeAccessYaml(projectRoot, freshConfigWithRole, {
        enabled: true,
        expectedVersion: fresh.version,
        changeType: freshAttribution ? "row_policy_update" : "role_patch",
        operation: freshAttribution ? "row_policy.update" : undefined,
        targetId: request.params.roleId,
        oldSummary: {
          description: freshExisting.description,
          allow: freshExisting.allow,
          ...(freshAttribution
            ? {
                rowPolicy: {
                  operationId: freshAttribution.operationId,
                  tables: freshAttribution.tables,
                  beforeDigest: freshAttribution.beforeDigest,
                  affectedAgentCount: freshAttribution.affectedAgentCount
                }
              }
            : {})
        },
        newSummary: {
          description: freshValidated.value.description,
          allow: freshValidated.value.allow,
          ...(freshAttribution
            ? {
                rowPolicy: {
                  operationId: freshAttribution.operationId,
                  tables: freshAttribution.tables,
                  beforeDigest: freshAttribution.beforeDigest,
                  afterDigest: freshAttribution.afterDigest,
                  affectedAgentCount: freshAttribution.affectedAgentCount
                }
              }
            : {})
        },
        diff: freshDiff,
        ...auditActorFields(trustedActorFromRequest(request)),
        source: "admin_roles_api"
      }).catch((error: unknown) => {
        if ((error as { code?: string }).code === "VERSION_CONFLICT") return null;
        throw error;
      });
      if (writeResult === null) {
        return reply.status(409).send({
          ok: false,
          error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" }
        });
      }

      // 3) The tri-state result (spec §14.3.2). A rollback is NOT a success:
      //    only `committed` may report `written: true`.
      const detail = await readAccessYaml(projectRoot);
      const response = accessWriteResponseBody(writeResult, {
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        auditId: writeResult.auditId,
        rowPolicy: freshAttribution,
        gate,
        templateWarnings: templateDiagnostics.warnings,
        operationId
      });
      return reply.status(response.statusCode).send(response.body);
    });
  });

  // DELETE /api/admin/roles/:roleId — delete yaml role, blocked if in use
  app.delete<{
    Params: { roleId: string };
    Body?: {
      dryRun?: boolean;
      version?: string;
      override?: AccessGovernanceOverrideRequest;
      /** Spec §14.2.1 — required when the Role being deleted carries a row policy. */
      rowPolicyConfirmation?: unknown;
    };
  }>(
    "/api/admin/roles/:roleId",
    async (request, reply) => {
      const dryRun = request.body?.dryRun !== false;
      const projectRoot = await resolveProjectRoot();
      const { config, raw, version } = await readAccessYaml(projectRoot);
      if (request.body?.version && request.body.version !== version) {
        return reply.status(409).send({ ok: false, error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" } });
      }
      if (!config.roles?.[request.params.roleId] || !config.roles[request.params.roleId].allow) {
        if (ROLE_TEMPLATES[request.params.roleId]) {
          return reply.status(400).send({ ok: false, error: { code: "TEMPLATE_ROLE_READONLY", message: "template roles are read-only" } });
        }
        return reply.status(404).send({ ok: false, error: { code: "ROLE_NOT_FOUND", message: `role '${request.params.roleId}' not found` } });
      }
      if (isDeleteProtectedRole(request.params.roleId)) {
        return reply.status(403).send({
          ok: false,
          error: {
            code: "PROTECTED_ROLE",
            message: `role '${request.params.roleId}' is a protected system role and cannot be deleted`
          }
        });
      }
      const users = usersReferencingRole(config, request.params.roleId);
      if (users.length > 0) {
        return reply.status(409).send({
          ok: false,
          error: {
            code: "ROLE_IN_USE",
            message: `role '${request.params.roleId}' is used by ${users.length} agent(s)`,
            detail: {
              users: users.map((user) => ({ id: user.id, name: user.name, enabled: user.enabled !== false }))
            }
          }
        });
      }
      const contextRefs = contextReferencesToRole(await listContextInventory(), request.params.roleId);
      if (hasContextReferences(contextRefs)) {
        return reply.status(409).send({
          ok: false,
          error: {
            code: "ROLE_REFERENCED_BY_CONTEXT",
            message: `role '${request.params.roleId}' is named by ${contextRefs.skills.length + contextRefs.wiki.length} Wiki/Skill ACL(s); remove them first`,
            detail: contextRefs
          }
        });
      }
      const existingRole = config.roles[request.params.roleId];
      if (!dryRun && roleCarriesRowPolicy(existingRole)) {
        const fresh = await readAccessYaml(projectRoot);
        if (request.body?.version && request.body.version !== fresh.version) {
          return reply.status(409).send({
            ok: false,
            error: { code: "VERSION_CONFLICT", message: "yaml has been modified by another source, please refresh" }
          });
        }
        const freshConfig = (await import("yaml")).parse(fresh.raw) as YamlAccessConfig;
        const verification = await verifyRowPolicyPreviewConfirmation({
          roleId: request.params.roleId,
          removeRole: true,
          confirmation: request.body?.rowPolicyConfirmation,
          baseConfig: freshConfig as never,
          baseAccessVersion: fresh.version
        });
        if (!verification.ok) {
          return reply.status(409).send({
            ok: false,
            error: {
              code: "ROW_POLICY_PREVIEW_REQUIRED",
              message: verification.message ?? "最终行约束预览确认缺失或已失效",
              detail: { reason: verification.reason, ...(verification.detail ?? {}) }
            }
          });
        }
      }
      const newConfig: YamlAccessConfig = {
        ...config,
        roles: Object.fromEntries(
          Object.entries(config.roles ?? {}).filter(([id]) => id !== request.params.roleId)
        )
      };
      const proposedYaml = (await import("yaml")).stringify(newConfig, { lineWidth: 0 });
      const diff = makeDiff(raw, proposedYaml);

      // Access Governance Gate — Role deletion: an empty `allow` placeholder
      // is fed to the gate so it does not classify deletion as widening.
      const gateInput = await buildRoleGateInput({
        targetKind: "role",
        targetId: request.params.roleId,
        oldRole: existingRole,
        newRole: { description: existingRole.description }
      });
      const gate = evaluateAccessGovernanceGate(gateInput);

      if (dryRun) {
        return { ok: true, data: { diff, proposedYaml, version, gate } };
      }

      if (gate.decision === "block") {
        await writeGateTrace(gate, undefined, undefined, defaultActor(request));
        return reply.status(409).send({
          ok: false,
          error: {
            code: "GOVERNANCE_GATE_BLOCKED",
            message: "Access Governance Gate blocked this role delete",
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

      // Spec §4.3: retire the id durably BEFORE the config write; a failed write leaves the
      // stricter state (id retired), never a reusable id.
      const retireStore = await getSecurityStore();
      const retired = retireStore.ok ? retireStore.value.tombstoneRoleId(request.params.roleId, "role_deleted") : retireStore;
      if (!retireStore.ok || !retired.ok) {
        return reply.status(503).send({
          ok: false,
          error: { code: "SECURITY_STORE_UNAVAILABLE", message: "Role id retirement could not be recorded; the role was not deleted" }
        });
      }
      const writeResult = await writeAccessYaml(projectRoot, newConfig, {
        enabled: true,
        changeType: "role_delete",
        targetId: request.params.roleId,
        oldSummary: { roleIds: Object.keys(config.roles ?? {}) },
        newSummary: { roleIds: Object.keys(newConfig.roles ?? {}) },
        diff,
        ...auditActorFields(trustedActorFromRequest(request)),
        source: "admin_roles_api"
      });
      // Spec §14.3.2 — only `committed` is a success. `recovery_required` is
      // 503 with written:false; a rollback is not a saved deletion.
      const response = accessWriteResponseBody(writeResult, {
        version: (await readAccessYaml(projectRoot)).version,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        gate
      });
      return reply.status(response.statusCode).send(response.body);
    }
  );

  // POST /api/admin/roles/:roleId/copy — copy yaml or template role into a new yaml role
  app.post<{
    Params: { roleId: string };
    Body: {
      dryRun?: boolean;
      override?: AccessGovernanceOverrideRequest;
      newRoleId?: string;
      description?: string;
      role?: unknown;
      acknowledgeContextReferences?: boolean;
      /**
       * Spec §14.2.1 — the preview confirmation. Required when the copied Role
       * carries a row policy: a copy must not be a way around the confirmation
       * the PATCH entry point requires.
       */
      rowPolicyConfirmation?: unknown;
    };
  }>("/api/admin/roles/:roleId/copy", async (request, reply) => {
    const dryRun = request.body?.dryRun !== false;
    const { newRoleId, description, role } = request.body ?? {};
    if (typeof newRoleId !== "string" || !newRoleId.trim()) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "newRoleId is required" } });
    }
    const projectRoot = await resolveProjectRoot();
    const { config, raw } = await readAccessYaml(projectRoot);
    const source = findRole(config, request.params.roleId);
    if (!source) {
      return reply.status(404).send({ ok: false, error: { code: "ROLE_NOT_FOUND", message: `role '${request.params.roleId}' not found` } });
    }
    const clonedRole: YamlRole = role === undefined
      ? {
          description: description ?? source.role.description,
          allow: source.role.allow
        }
      : (role as YamlRole);
    const validated = await resolveRoleForWrite(newRoleId, clonedRole, { allowTemplateId: true });
    if (!validated.ok) {
      return reply.status(validated.status).send({ ok: false, error: { code: validated.code, message: validated.message } });
    }
    if (config.roles?.[newRoleId]) {
      return reply.status(409).send({ ok: false, error: { code: "ROLE_ID_TAKEN", message: `role '${newRoleId}' already exists` } });
    }
    const copyGuard = await guardRoleIdForCreate(newRoleId, request.body?.acknowledgeContextReferences === true);
    if (copyGuard) {
      return reply.status(copyGuard.status).send({
        ok: false,
        error: { code: copyGuard.code, message: copyGuard.message, ...(copyGuard.detail ? { detail: copyGuard.detail } : {}) }
      });
    }
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: { ...(config.roles ?? {}), [newRoleId]: validated.value }
    };
    // Lucy v0.25 P1-1 §5.1 — a copied Role inherits its template references, so the
    // same write-time resolution check applies. An illegal template DEFINITION that
    // nothing references is only a warning (P2-2).
    const templateDiagnostics = roleTemplateDiagnostics(newConfig);
    if (templateDiagnostics.blocking) {
      return reply.status(400).send({
        ok: false,
        error: { code: templateDiagnostics.blocking.code, message: templateDiagnostics.blocking.message }
      });
    }
    const proposedYaml = (await import("yaml")).stringify(newConfig, { lineWidth: 0 });
    const diff = makeDiff(raw, proposedYaml);

    // Access Governance Gate — copy is treated as a Role create with the
    // source role used as `oldRole` baseline so widening into sensitive
    // sources is still detected.
    const gateInput = await buildRoleGateInput({
      targetKind: "role",
      targetId: newRoleId,
      oldRole: source.role,
      newRole: validated.value
    });
    const gate = evaluateAccessGovernanceGate(gateInput);

    if (dryRun) {
      return { ok: true, data: { diff, proposedYaml, gate, migration: validated.migration, templateWarnings: templateDiagnostics.warnings } };
    }

    if (gate.decision === "block") {
      await writeGateTrace(gate, undefined, undefined, defaultActor(request));
      return reply.status(409).send({
        ok: false,
        error: {
          code: "GOVERNANCE_GATE_BLOCKED",
          message: "Access Governance Gate blocked this role copy",
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

    // ── the copy runs INSIDE the shared publish window (spec §14.2.2) ────────
    return runInAccessPublishWindow("role_policy_save", projectRoot, async () => {
      // 0) Spec §14.2.2 — the recovery gate comes first: an unresolved recovery
      //    fails the write closed before any candidate is rebuilt.
      const recovery = await accessRecoveryRejection(projectRoot);
      if (recovery) {
        return reply.status(503).send({ ok: false, error: recovery });
      }
      const fresh = await readAccessYamlVersion(projectRoot);
      const freshConfig = (await import("yaml")).parse(fresh.raw) as YamlAccessConfig;
      if (!freshConfig.users) freshConfig.users = [];
      if (freshConfig.roles?.[newRoleId]) {
        return reply.status(409).send({
          ok: false,
          error: { code: "ROLE_ID_TAKEN", message: `role '${newRoleId}' already exists` }
        });
      }

      // Spec §14.2.1 — a copy that carries a row policy consumes the same
      // confirmation the PATCH entry point requires.
      if (roleCarriesRowPolicy(validated.value)) {
        const verification = await verifyRowPolicyPreviewConfirmation({
          roleId: newRoleId,
          role: validated.value,
          confirmation: request.body?.rowPolicyConfirmation,
          baseConfig: freshConfig as never,
          baseAccessVersion: fresh.version
        });
        if (!verification.ok) {
          return reply.status(409).send({
            ok: false,
            error: {
              code: "ROW_POLICY_PREVIEW_REQUIRED",
              message: verification.message ?? "最终行约束预览确认缺失或已失效",
              detail: { reason: verification.reason, ...(verification.detail ?? {}) }
            }
          });
        }
      }

      const freshConfigWithRole: YamlAccessConfig = {
        ...freshConfig,
        roles: { ...(freshConfig.roles ?? {}), [newRoleId]: validated.value }
      };
      const freshDiff = makeDiff(fresh.raw, (await import("yaml")).stringify(freshConfigWithRole, { lineWidth: 0 }));

      const writeResult = await writeAccessYaml(projectRoot, freshConfigWithRole, {
      enabled: true,
      changeType: "role_create",
      targetId: newRoleId,
      oldSummary: { roleIds: Object.keys(freshConfig.roles ?? {}), sourceRoleId: request.params.roleId },
      newSummary: { roleIds: Object.keys(freshConfigWithRole.roles ?? {}), sourceRoleId: request.params.roleId },
      diff: freshDiff,
      ...auditActorFields(trustedActorFromRequest(request)),
      source: "admin_roles_api"
    });
    const detail = await readAccessYaml(projectRoot);
    const finalResolved = findRole(detail.config, newRoleId);
    if (!finalResolved) {
      return reply.status(500).send({ ok: false, error: { code: "INTERNAL", message: "role was not persisted" } });
    }
    const summary = buildRoleSummary(detail.config, finalResolved);
    const preview = await previewRolePermissionsForAdmin(newRoleId, { role: finalResolved.role });
    const response = accessWriteResponseBody(writeResult, {
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        policyRuntimeAck: writeResult.policyRuntimeAck,
        gate,
        /** Catalog-level template issues — reported, never blocking (P2-2). */
        templateWarnings: templateDiagnostics.warnings,
        role: {
          ...summary,
          sourceCount: preview.ok ? preview.permissions.sources.length : 0,
          sourceNames: sourceNamesFromPreview(preview),
          invalid: !preview.ok,
          warnings: preview.ok ? [] : [preview.reason],
          role: {
            description: finalResolved.role.description,
            allow: finalResolved.role.allow ?? {}
          },
          effectivePermissions: preview.ok ? effectivePermissionsToPreview(preview.permissions) : undefined
        }
      });
      return reply.status(response.statusCode).send(response.body);
    });
  });
}
