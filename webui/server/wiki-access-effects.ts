import { createHash } from "node:crypto";
import { readAccessYaml } from "./admin/access-config.js";
import { CONTEXT_CHANNEL_TOOLS, type ObjectAcl } from "./proxy/context-acl.js";
import { resolveRoleIds } from "./proxy/acl.js";

/**
 * Spec 193 §4.2 / §10.1 — the Wiki → Role effect projection.
 *
 * The projection answers two DIFFERENT questions and must never merge them:
 *
 * 1. **Declared authorization** — what the document's `allowed_roles` says.
 * 2. **Channel effect** — whether each declared Role actually grants
 *    `wiki_search` / `wiki_read`, and how many enabled Agents really bind it.
 *
 * A declared Role without a channel is "已授权，缺少 Wiki 访问通道" — not
 * "无人可见" and not "Agent 无权限".
 *
 * The resolver is a pure function over ONE access-config snapshot. It never
 * duplicates the allow decision (`authorizeContext` stays the single decision
 * point) and never fabricates an identity to probe one.
 */

/** The two Wiki channels, taken from the single channel-tool registry. */
export const WIKI_CHANNEL_TOOLS = CONTEXT_CHANNEL_TOOLS.wiki;

export interface WikiAccessRoleEffect {
  role_id: string;
  /** `false` when the Role id does not exist any more. */
  known: boolean;
  discover_enabled: boolean;
  read_enabled: boolean;
  /** Enabled Agents that actually bind this formal Role. */
  assigned_agent_count: number;
  assigned_agent_ids: string[];
}

export interface WikiAccessPendingChange {
  operation_id: string;
  state: "pending" | "needs_review";
}

export interface WikiAccessSummary {
  key: string;
  file_version: string;
  acl: ObjectAcl;
  declared_role_count: number | null;
  role_effects: WikiAccessRoleEffect[];
  declared_without_discover: number;
  declared_without_read: number;
  role_channel_version: string;
  pending_change?: WikiAccessPendingChange;
}

/** The aggregate list entry — no Role effect detail, no Agent id list. */
export interface WikiAccessListEntry {
  file_version: string;
  acl: ObjectAcl;
  declared_role_count: number | null;
  declared_without_discover: number;
  declared_without_read: number;
  pending_change?: WikiAccessPendingChange;
}

interface WikiAccessRoleSnapshot {
  role_id: string;
  discover_enabled: boolean;
  read_enabled: boolean;
  assigned_agent_ids: string[];
}

/**
 * ONE read of the Role / Agent configuration.
 *
 * `role_channel_version` is a GLOBAL effect version: it binds the normalized
 * Role channels AND the Agent enablement / Role bindings. It must never be an
 * Agent's `snapshotHash` reused as a global version.
 */
export interface WikiAccessConfigSnapshot {
  roles: Map<string, WikiAccessRoleSnapshot>;
  role_channel_version: string;
}

function roleGrants(roleTools: string[] | undefined, tool: string): boolean {
  return Array.isArray(roleTools) && roleTools.includes(tool);
}

/**
 * Read the access configuration.
 *
 * A project that has not configured `access.yaml` yet has NO formal Role and
 * NO Agent — that is a legitimate state, not a failure. The snapshot then
 * describes an empty Role graph.
 */
async function readAccessConfig(projectRoot: string): Promise<{ config: AccessConfigShape }> {
  try {
    return await readAccessYaml(projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: { roles: {}, users: [] } };
    }
    throw error;
  }
}

type AccessConfigShape = {
  roles?: Record<string, { allow?: { tools?: string[] } }>;
  users: Array<{
    id: string;
    enabled?: boolean;
    role?: string;
    roles?: string[];
  }>;
};

/**
 * Read the formal Roles and the enabled Agents exactly once.
 *
 * Formal Roles are the YAML roles that declare an `allow` block — the same
 * rule the admin Role list uses. Reference templates are excluded: a template
 * cannot be assigned to an Agent, so it can never match an ACL.
 */
export async function loadWikiAccessConfigSnapshot(
  projectRoot: string
): Promise<WikiAccessConfigSnapshot> {
  const { config } = await readAccessConfig(projectRoot);

  const formalRoleIds = Object.entries(config.roles ?? {})
    .filter(([, role]) => role?.allow !== undefined)
    .map(([roleId]) => roleId)
    .sort();

  const enabledAgentRoleIds = new Map<string, string[]>();
  for (const user of config.users ?? []) {
    if (user.enabled === false) continue;
    const resolved = resolveRoleIds(user);
    if (!resolved.ok || resolved.roleIds.length === 0) continue;
    enabledAgentRoleIds.set(user.id, [...resolved.roleIds].sort());
  }

  const roles = new Map<string, WikiAccessRoleSnapshot>();
  const roleVersionRows: Array<{ role_id: string; discover: boolean; read: boolean }> = [];
  const agentVersionRows: Array<{ agent_id: string; roles: string[] }> = [];

  for (const roleId of formalRoleIds) {
    const role = config.roles?.[roleId];
    const discover = roleGrants(role?.allow?.tools, WIKI_CHANNEL_TOOLS.discover);
    const read = roleGrants(role?.allow?.tools, WIKI_CHANNEL_TOOLS.read);
    const assigned = Array.from(enabledAgentRoleIds.entries())
      .filter(([, roleIds]) => roleIds.includes(roleId))
      .map(([agentId]) => agentId)
      .sort();
    roles.set(roleId, {
      role_id: roleId,
      discover_enabled: discover,
      read_enabled: read,
      assigned_agent_ids: assigned
    });
    roleVersionRows.push({ role_id: roleId, discover, read });
  }

  for (const [agentId, roleIds] of enabledAgentRoleIds.entries()) {
    agentVersionRows.push({ agent_id: agentId, roles: roleIds });
  }

  const role_channel_version = `rcv-${createHash("sha256")
    .update(
      JSON.stringify({
        roles: roleVersionRows.sort((a, b) => a.role_id.localeCompare(b.role_id)),
        agents: agentVersionRows.sort((a, b) => a.agent_id.localeCompare(b.agent_id))
      })
    )
    .digest("hex")
    .slice(0, 32)}`;

  return { roles, role_channel_version };
}

export interface WikiAccessEffectProjection {
  declared_role_count: number | null;
  role_effects: WikiAccessRoleEffect[];
  declared_without_discover: number;
  declared_without_read: number;
}

/**
 * Project the declared authorization onto the Role / channel / Agent facts.
 *
 * - `roles` → one effect per declared Role id (unknown ids stay, `known=false`).
 * - `all`   → the effect of every formal Role; unknown ids cannot exist here.
 * - `missing` / `empty` / `corrupt` → no declared Role at all.
 */
export function resolveWikiAccessEffects(
  acl: ObjectAcl,
  snapshot: WikiAccessConfigSnapshot
): WikiAccessEffectProjection {
  if (acl.state === "missing" || acl.state === "empty") {
    return {
      declared_role_count: 0,
      role_effects: [],
      declared_without_discover: 0,
      declared_without_read: 0
    };
  }

  if (acl.state === "corrupt") {
    return {
      declared_role_count: null,
      role_effects: [],
      declared_without_discover: 0,
      declared_without_read: 0
    };
  }

  const declaredIds =
    acl.state === "all"
      ? Array.from(snapshot.roles.keys()).sort()
      : [...new Set(acl.roles)].sort();

  const role_effects: WikiAccessRoleEffect[] = declaredIds.map((roleId) => {
    const known = snapshot.roles.get(roleId);
    return {
      role_id: roleId,
      known: Boolean(known),
      discover_enabled: known?.discover_enabled ?? false,
      read_enabled: known?.read_enabled ?? false,
      assigned_agent_count: known?.assigned_agent_ids.length ?? 0,
      assigned_agent_ids: known ? [...known.assigned_agent_ids] : []
    };
  });

  return {
    declared_role_count: acl.state === "all" ? null : declaredIds.length,
    role_effects,
    declared_without_discover: role_effects.filter((effect) => !effect.discover_enabled).length,
    declared_without_read: role_effects.filter((effect) => !effect.read_enabled).length
  };
}

export function buildWikiAccessSummary(input: {
  key: string;
  file_version: string;
  acl: ObjectAcl;
  snapshot: WikiAccessConfigSnapshot;
  pending_change?: WikiAccessPendingChange;
}): WikiAccessSummary {
  const projection = resolveWikiAccessEffects(input.acl, input.snapshot);
  return {
    key: input.key,
    file_version: input.file_version,
    acl: input.acl,
    declared_role_count: projection.declared_role_count,
    role_effects: projection.role_effects,
    declared_without_discover: projection.declared_without_discover,
    declared_without_read: projection.declared_without_read,
    role_channel_version: input.snapshot.role_channel_version,
    ...(input.pending_change ? { pending_change: input.pending_change } : {})
  };
}

export function buildWikiAccessListEntry(input: {
  file_version: string;
  acl: ObjectAcl;
  snapshot: WikiAccessConfigSnapshot;
  pending_change?: WikiAccessPendingChange;
}): WikiAccessListEntry {
  const projection = resolveWikiAccessEffects(input.acl, input.snapshot);
  return {
    file_version: input.file_version,
    acl: input.acl,
    declared_role_count: projection.declared_role_count,
    declared_without_discover: projection.declared_without_discover,
    declared_without_read: projection.declared_without_read,
    ...(input.pending_change ? { pending_change: input.pending_change } : {})
  };
}

/* -------------------------------------------------------------------------- */
/* Direction (Spec 193 §4.3)                                                  */
/* -------------------------------------------------------------------------- */

export type AccessDirection = "narrow" | "widen" | "neutral";

/**
 * The runtime set of an ACL.
 *
 * `missing` / `empty` / `corrupt` all mean "nobody"; `all` means "every
 * validly assigned formal Role" — the universe.
 */
export type AccessRuntimeSet =
  | { kind: "empty" }
  | { kind: "roles"; roles: Set<string> }
  | { kind: "all" };

export function accessRuntimeSet(acl: ObjectAcl): AccessRuntimeSet {
  if (acl.state === "missing" || acl.state === "empty" || acl.state === "corrupt") {
    return { kind: "empty" };
  }
  if (acl.state === "all") return { kind: "all" };
  return { kind: "roles", roles: new Set(acl.roles) };
}

/**
 * Classify an authorization change.
 *
 * Spec 193 §4.3 defines the comparison on the normalized runtime SET, never on
 * YAML text or Role order:
 *
 * ```text
 * runtimeSet(missing | empty | corrupt) = empty set
 * runtimeSet(roles)                    = declared role ids
 * runtimeSet(all)                      = universe
 *
 * if old == new:                neutral
 * else if new is a strict subset of old: narrow
 * else:                          widen
 * ```
 *
 * A mixed one-add / one-remove change is therefore `widen`: a conservative
 * refusal is preferable to treating an uncertain change as a narrowing.
 * Narrowing to "nobody" (`roles → empty` / `→ missing`) is a strict subset and
 * is classified as `narrow`, so a crash during it commits the narrowing
 * instead of parking the key in `needs_review`.
 */
export function classifyAccessDirection(current: ObjectAcl, next: ObjectAcl): AccessDirection {
  const before = accessRuntimeSet(current);
  const after = accessRuntimeSet(next);

  if (runtimeSetsEqual(before, after)) return "neutral";
  if (isStrictSubset(after, before)) return "narrow";
  return "widen";
}

/** True when the two runtime sets describe exactly the same audience. */
function runtimeSetsEqual(a: AccessRuntimeSet, b: AccessRuntimeSet): boolean {
  if (a.kind === "empty" && b.kind === "empty") return true;
  if (a.kind === "all" && b.kind === "all") return true;
  if (a.kind === "roles" && b.kind === "roles") {
    return a.roles.size === b.roles.size && [...a.roles].every((role) => b.roles.has(role));
  }
  return false;
}

/**
 * True when `sub` is contained in `sup`.
 *
 * The caller has already established that the two sets are not equal, so a
 * containment answer is a strict subset.
 */
function isStrictSubset(sub: AccessRuntimeSet, sup: AccessRuntimeSet): boolean {
  // The universe contains every concrete set.
  if (sup.kind === "all") return true;
  // Only the empty set fits into "nobody", and that case is already equal.
  if (sup.kind === "empty") return false;
  // `sup` is a concrete role set.
  if (sub.kind === "empty") return true;
  if (sub.kind === "all") return false;
  return [...sub.roles].every((role) => sup.roles.has(role));
}

/** A canonical, order-independent key for an ACL. */
export function canonicalAclKey(acl: ObjectAcl): string {
  if (acl.state === "roles") return `roles:${[...acl.roles].sort().join(",")}`;
  if (acl.state === "corrupt") return `corrupt:${acl.detail}`;
  return acl.state;
}

/** True when the two ACLs describe the same authorization. */
export function sameCanonicalAcl(a: ObjectAcl, b: ObjectAcl): boolean {
  return canonicalAclKey(a) === canonicalAclKey(b);
}
