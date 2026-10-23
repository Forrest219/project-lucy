import type { Identity } from "./identity.js";

/**
 * Spec §4.1–4.4 — the single decision point for Wiki / Skill context objects.
 *
 * Object authorization is `roles_allowed` (Skill) / `allowed_roles` (Wiki) and nothing
 * else: `sl_refs`, Skill prerequisites, Wiki directory names and `visibility` never grant.
 * A request is allowed only when ONE role of the caller both matches the object ACL and
 * grants the action's tool channel (no cross-role stitching).
 */

export type ContextAction = "discover" | "read";
export type ContextAssetKind = "skill" | "wiki";

/** Role tool that grants each (kind, action) channel. */
export const CONTEXT_CHANNEL_TOOLS: Record<ContextAssetKind, Record<ContextAction, string>> = {
  skill: { discover: "lucy_skill_search", read: "lucy_skill_read" },
  wiki: { discover: "wiki_search", read: "wiki_read" }
};

export type ObjectAcl =
  | { state: "missing" }
  | { state: "empty" }
  | { state: "all" }
  | { state: "roles"; roles: string[] }
  | { state: "corrupt"; detail: string };

/**
 * Canonicalize an ACL frontmatter value.
 * - absent / `[]` → nobody; exact `['*']` → every validly assigned role (never anonymous)
 * - `*` mixed with ids, non-array, or non-string / blank elements → corrupt (deny, never shared)
 */
export function parseObjectAcl(value: unknown, declared: boolean): ObjectAcl {
  if (!declared || value === undefined || value === null) return { state: "missing" };
  if (!Array.isArray(value)) return { state: "corrupt", detail: "not_an_array" };
  const roles: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) return { state: "corrupt", detail: "invalid_element" };
    const role = item.trim();
    if (!roles.includes(role)) roles.push(role);
  }
  if (roles.length === 0) return { state: "empty" };
  if (roles.includes("*")) {
    return roles.length === 1 ? { state: "all" } : { state: "corrupt", detail: "wildcard_mixed" };
  }
  return { state: "roles", roles };
}

/** Role ids that may be written by a save / import; throws a stable code for anything else. */
export function assertWritableAcl(value: unknown): string[] {
  const acl = parseObjectAcl(value, true);
  if (acl.state === "corrupt") throw new ContextAclInputError(acl.detail);
  if (acl.state === "all") return ["*"];
  if (acl.state === "roles") return acl.roles;
  return [];
}

export class ContextAclInputError extends Error {
  readonly code = "CONTEXT_ACL_INVALID";
  readonly statusCode = 400;
  constructor(readonly detail: string) {
    super(`object ACL is invalid: ${detail}`);
    this.name = "ContextAclInputError";
  }
}

export interface ContextAsset {
  kind: ContextAssetKind;
  /** Skill URI or canonical Wiki key; used only for audit, never in external responses. */
  id: string;
  acl: ObjectAcl;
  /** Skills only; Wiki pages have no lifecycle status. */
  status?: "draft" | "published" | "deprecated";
}

/** The caller's role facts at one policy version. Built by `context-policy.ts`. */
export type ContextSnapshot =
  | {
      ok: true;
      roleIds: string[];
      /** roleId → Meta tools that role grants (discover/read channels). */
      roleChannels: Record<string, string[]>;
      policyVersion: string;
      roleChannelVersion: string;
    }
  | { ok: false; reason: "context_role_required" | "context_policy_unavailable"; detail?: string };

export type ContextDeniedReason =
  | "context_role_required"
  | "context_policy_unavailable"
  | "skill_not_published"
  | "skill_deprecated"
  | "acl_missing"
  | "acl_empty"
  | "acl_corrupt"
  | "role_not_granted"
  | "channel_not_granted";

export type ContextDecision =
  | { allowed: true; action: ContextAction; matchedRoleId: string }
  | { allowed: false; action: ContextAction; reason: ContextDeniedReason };

export function authorizeContext(
  _identity: Pick<Identity, "userId">,
  asset: ContextAsset,
  action: ContextAction,
  snapshot: ContextSnapshot
): ContextDecision {
  if (!snapshot.ok) return { allowed: false, action, reason: snapshot.reason };
  if (asset.kind === "skill") {
    if (asset.status === "deprecated") return { allowed: false, action, reason: "skill_deprecated" };
    if (asset.status !== "published") return { allowed: false, action, reason: "skill_not_published" };
  }
  const { acl } = asset;
  if (acl.state === "missing") return { allowed: false, action, reason: "acl_missing" };
  if (acl.state === "empty") return { allowed: false, action, reason: "acl_empty" };
  if (acl.state === "corrupt") return { allowed: false, action, reason: "acl_corrupt" };

  const tool = CONTEXT_CHANNEL_TOOLS[asset.kind][action];
  let sawObjectMatch = false;
  for (const roleId of snapshot.roleIds) {
    const objectMatch = acl.state === "all" || acl.roles.includes(roleId);
    if (!objectMatch) continue;
    sawObjectMatch = true;
    if (snapshot.roleChannels[roleId]?.includes(tool)) return { allowed: true, action, matchedRoleId: roleId };
  }
  return { allowed: false, action, reason: sawObjectMatch ? "channel_not_granted" : "role_not_granted" };
}

/** Spec §4.4 — one external shape for every unauthorized / unknown / draft / deprecated object. */
export const CONTEXT_NOT_AVAILABLE = "context_not_available";
export const CONTEXT_ROLE_REQUIRED = "context_role_required";

export function externalContextReason(decision: Extract<ContextDecision, { allowed: false }>): string {
  return decision.reason === "context_role_required" ? CONTEXT_ROLE_REQUIRED : CONTEXT_NOT_AVAILABLE;
}
