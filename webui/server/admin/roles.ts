import type { FastifyInstance } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "./audit.js";
import {
  expandSelectorSourceNames,
  normalizePermissionModelVersion,
  previewRolePermissionsForAdmin,
  absoluteDenyOrUnclassifiedReason,
  type EffectivePermissions
} from "../proxy/acl.js";
import { parseRowPolicyShape } from "../proxy/row-policy.js";
import { expandTemplate, ROLE_TEMPLATES } from "./role-templates.js";
import {
  ACCESS_YAML_REL,
  ROLE_ID_RE,
  makeDiff,
  readAccessYaml,
  readAccessYamlVersion,
  writeAccessYaml,
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
import { actorIdFromRequest } from "../auth/guard.js";
import type { FastifyRequest } from "fastify";

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
  return config.users.filter((user) => user.role === roleId);
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

function validateRoleShape(role: unknown): { ok: true; value: YamlRole } | { ok: false; reason: string } {
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
    if (key !== "connections" && key !== "tableSelectors" && key !== "tools" && key !== "source_scope") {
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
        const parsed = parseRowPolicyShape(raw.row_policy);
        if (!parsed.ok) {
          return { ok: false, reason: `table selector scoped requires valid row_policy (${parsed.reason})` };
        }
        rowPolicy = { predicates: parsed.predicates };
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

  return {
    ok: true,
    value: {
      description: obj.description as string | undefined,
      permission_model_version: permissionModelVersion,
      allow: {
        connections,
        source_scope: sourceScope,
        tableSelectors,
        tools
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
        const parsed = parseRowPolicyShape(selector.row_policy);
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
            row_policy: { predicates: parsed.predicates }
          });
          selectorsChanged = true;
          continue;
        }
        nextSelectors.push({
          ...selector,
          row_access: "scoped",
          row_policy: { predicates: parsed.predicates }
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

async function resolveRoleForWrite(
  roleId: string,
  role: YamlRole,
  options: { allowTemplateId?: boolean } = {}
): Promise<
  { ok: true; value: YamlRole; migration: RoleMigration }
  | { ok: false; code: string; message: string; status: number }
> {
  if (!ROLE_ID_RE.test(roleId)) {
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
  const resolved = await previewRolePermissionsForAdmin(roleId, { role: migrated.value });
  if (!resolved.ok) {
    return { ok: false, code: "INVALID_ROLE", message: resolved.reason, status: 400 };
  }
  if (resolved.permissions.sources.length === 0 && (migrated.value.allow?.tableSelectors?.length ?? 0) > 0) {
    return { ok: false, code: "INVALID_ROLE", message: "role resolves to 0 source", status: 400 };
  }
  return { ok: true, value: migrated.value, migration: migrated.migration };
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
        effectivePermissions: preview.ok ? effectivePermissionsToPreview(preview.permissions) : undefined
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
    Body: { dryRun?: boolean; override?: AccessGovernanceOverrideRequest; roleId?: string; role?: unknown };
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
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: {
        ...(config.roles ?? {}),
        [roleId]: validated.value
      }
    };
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
      return { ok: true, data: { diff, proposedYaml, gate, migration: validated.migration } };
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

    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "role_create",
      targetId: roleId,
      oldSummary: { roleIds: Object.keys(config.roles ?? {}) },
      newSummary: { roleIds: Object.keys(newConfig.roles ?? {}), description: validated.value.description },
      diff,
      requestId: request.id,
      source: "admin_roles_api"
    });
    const detail = await readAccessYaml(projectRoot);
    const finalResolved = findRole(detail.config, roleId);
    if (!finalResolved) {
      return reply.status(500).send({ ok: false, error: { code: "INTERNAL", message: "role was not persisted" } });
    }
    const summary = buildRoleSummary(detail.config, finalResolved);
    const preview = await previewRolePermissionsForAdmin(roleId, { role: finalResolved.role });
    return {
      ok: true,
      data: {
        written: true,
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck,
        gate,
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
      }
    };
  });

  // PATCH /api/admin/roles/:roleId — edit yaml role
  app.patch<{
    Params: { roleId: string };
    Body: {
      dryRun?: boolean;
      version?: string;
      override?: AccessGovernanceOverrideRequest;
      patch?: { description?: unknown; allow?: unknown };
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
    const patch = request.body?.patch ?? {};
    if (bodyHasOwn(patch, "id") || bodyHasOwn(patch, "roleId")) {
      return reply.status(400).send({ ok: false, error: { code: "BAD_REQUEST", message: "role id cannot be changed" } });
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
    const validated = await resolveRoleForWrite(request.params.roleId, next, { allowTemplateId: true });
    if (!validated.ok) {
      return reply.status(validated.status).send({ ok: false, error: { code: validated.code, message: validated.message } });
    }
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: { ...(config.roles ?? {}), [request.params.roleId]: validated.value }
    };
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
      return { ok: true, data: { diff, proposedYaml, version: currentVersion, gate, migration: validated.migration } };
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

    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "role_patch",
      targetId: request.params.roleId,
      oldSummary: { description: existing.description, allow: existing.allow },
      newSummary: { description: validated.value.description, allow: validated.value.allow },
      diff,
      requestId: request.id,
      source: "admin_roles_api"
    });
    const detail = await readAccessYaml(projectRoot);
    return {
      ok: true,
      data: {
        written: true,
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck,
        gate
      }
    };
  });

  // DELETE /api/admin/roles/:roleId — delete yaml role, blocked if in use
  app.delete<{
    Params: { roleId: string };
    Body?: { dryRun?: boolean; version?: string; override?: AccessGovernanceOverrideRequest };
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
      const existingRole = config.roles[request.params.roleId];
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

      const writeResult = await writeAccessYaml(projectRoot, newConfig, {
        enabled: true,
        changeType: "role_delete",
        targetId: request.params.roleId,
        oldSummary: { roleIds: Object.keys(config.roles ?? {}) },
        newSummary: { roleIds: Object.keys(newConfig.roles ?? {}) },
        diff,
        requestId: request.id,
        source: "admin_roles_api"
      });
      return {
        ok: true,
        data: {
          written: true,
          version: (await readAccessYaml(projectRoot)).version,
          policyVersion: writeResult.policyVersion,
          runtimeAck: writeResult.runtimeAck,
          gate
        }
      };
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
    const newConfig: YamlAccessConfig = {
      ...config,
      roles: { ...(config.roles ?? {}), [newRoleId]: validated.value }
    };
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
      return { ok: true, data: { diff, proposedYaml, gate, migration: validated.migration } };
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

    const writeResult = await writeAccessYaml(projectRoot, newConfig, {
      enabled: true,
      changeType: "role_create",
      targetId: newRoleId,
      oldSummary: { roleIds: Object.keys(config.roles ?? {}), sourceRoleId: request.params.roleId },
      newSummary: { roleIds: Object.keys(newConfig.roles ?? {}), sourceRoleId: request.params.roleId },
      diff,
      requestId: request.id,
      source: "admin_roles_api"
    });
    const detail = await readAccessYaml(projectRoot);
    const finalResolved = findRole(detail.config, newRoleId);
    if (!finalResolved) {
      return reply.status(500).send({ ok: false, error: { code: "INTERNAL", message: "role was not persisted" } });
    }
    const summary = buildRoleSummary(detail.config, finalResolved);
    const preview = await previewRolePermissionsForAdmin(newRoleId, { role: finalResolved.role });
    return {
      ok: true,
      data: {
        written: true,
        version: detail.version,
        policyVersion: writeResult.policyVersion,
        runtimeAck: writeResult.runtimeAck,
        gate,
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
      }
    };
  });
}
