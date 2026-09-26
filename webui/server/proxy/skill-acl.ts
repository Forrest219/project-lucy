import { effectivePermissions } from "./acl.js";
import type { Identity } from "./identity.js";
import type { SkillAsset } from "../skills/types.js";

export interface SkillAclDecision {
  allowed: boolean;
  reason?: string;
  action?: SkillAclAction;
  matchedRoleId?: string;
}

export type SkillAclAction = "discover" | "read";

export interface RoleSkillAccessSummary {
  discoverEnabled: boolean;
  readEnabled: boolean;
  declared: string[];
  discoverable: string[];
  readable: string[];
  declaredWithoutChannel: string[];
}

function requiredTool(action: SkillAclAction): "lucy_skill_search" | "lucy_skill_read" {
  return action === "discover" ? "lucy_skill_search" : "lucy_skill_read";
}

export function summarizeRoleSkillAccess(
  roleId: string,
  tools: string[],
  skills: SkillAsset[]
): RoleSkillAccessSummary {
  const discoverEnabled = tools.includes("lucy_skill_search");
  const readEnabled = tools.includes("lucy_skill_read");
  const declared = skills
    .filter((skill) => skill.roles_allowed.includes("*") || skill.roles_allowed.includes(roleId))
    .map((skill) => skill.uri)
    .sort();
  const published = skills.filter(
    (skill) => skill.status === "published" && declared.includes(skill.uri)
  ).map((skill) => skill.uri).sort();
  return {
    discoverEnabled,
    readEnabled,
    declared,
    discoverable: discoverEnabled ? published : [],
    readable: readEnabled ? published : [],
    declaredWithoutChannel: published.filter(() => !discoverEnabled || !readEnabled)
  };
}

export async function canAccessSkill(
  identity: Identity,
  skill: SkillAsset,
  action: SkillAclAction = "read"
): Promise<SkillAclDecision> {
  const permResult = await effectivePermissions(identity);
  if (!permResult.ok) {
    return {
      allowed: false,
      reason: `role_resolution_failed: ${permResult.reason}`,
    };
  }

  const { roleIds, roleMetaTools = {} } = permResult.permissions;

  // 1. Check skill's status
  if (skill.status === "deprecated") {
    return {
      allowed: false,
      reason: "skill_deprecated",
    };
  }

  // Spec 144: only published skills are agent-visible; drafts (incl. missing status) are denied
  if (skill.status !== "published") {
    return {
      allowed: false,
      reason: "skill_not_published",
    };
  }

  // 2. Check skill's roles_allowed list
  const rolesAllowed = Array.isArray(skill.roles_allowed) ? skill.roles_allowed : [];
  if (rolesAllowed.length === 0) {
    return { allowed: false, reason: "skill_no_roles_allowed", action };
  }

  const tool = requiredTool(action);
  const wildcard = rolesAllowed.includes("*");
  if (roleIds.length === 0) {
    if (wildcard && (roleMetaTools.__legacy__ ?? []).includes(tool)) {
      return { allowed: true, action, matchedRoleId: "__legacy__" };
    }
    return {
      allowed: false,
      reason: wildcard ? `skill_channel_forbidden:${action}` : "skill_role_required",
      action
    };
  }

  let matchedAudience = false;
  for (const roleId of roleIds) {
    if (!wildcard && !rolesAllowed.includes(roleId)) continue;
    matchedAudience = true;
    if ((roleMetaTools[roleId] ?? []).includes(tool)) {
      return { allowed: true, action, matchedRoleId: roleId };
    }
  }

  return {
    allowed: false,
    reason: matchedAudience ? `skill_channel_forbidden:${action}` : "skill_role_mismatch",
    action
  };
}

export async function filterAccessibleSkills(
  identity: Identity,
  skills: SkillAsset[],
  action: SkillAclAction = "discover"
): Promise<SkillAsset[]> {
  const accessible: SkillAsset[] = [];
  for (const skill of skills) {
    const decision = await canAccessSkill(identity, skill, action);
    if (decision.allowed) {
      accessible.push(skill);
    }
  }
  return accessible;
}
