import { effectivePermissions } from "./acl.js";
import type { Identity } from "./identity.js";
import type { SkillAsset } from "../skills/types.js";

export interface SkillAclDecision {
  allowed: boolean;
  reason?: string;
}

export async function canAccessSkill(
  identity: Identity,
  skill: SkillAsset
): Promise<SkillAclDecision> {
  const permResult = await effectivePermissions(identity);
  if (!permResult.ok) {
    return {
      allowed: false,
      reason: `role_resolution_failed: ${permResult.reason}`,
    };
  }

  const { roleIds } = permResult.permissions;

  // 1. Check skill's status
  if (skill.status === "deprecated") {
    return {
      allowed: false,
      reason: "skill_deprecated",
    };
  }

  // 2. Check skill's roles_allowed list
  const rolesAllowed = skill.roles_allowed || ["*"];
  if (!rolesAllowed.includes("*")) {
    const hasMatchingRole = roleIds.some((r) => rolesAllowed.includes(r));
    if (!hasMatchingRole) {
      return {
        allowed: false,
        reason: `skill_role_mismatch: requires one of [${rolesAllowed.join(", ")}], but token has [${roleIds.join(", ")}]`,
      };
    }
  }

  // 3. Check prerequisites sources against allowed tables/sources if defined
  // (Fail-soft on prerequisites: warning/filter rather than hard blocking unless table access is completely prohibited)
  return { allowed: true };
}

export async function filterAccessibleSkills(
  identity: Identity,
  skills: SkillAsset[]
): Promise<SkillAsset[]> {
  const accessible: SkillAsset[] = [];
  for (const skill of skills) {
    const decision = await canAccessSkill(identity, skill);
    if (decision.allowed) {
      accessible.push(skill);
    }
  }
  return accessible;
}
