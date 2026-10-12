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

/**
 * Spec 170: published skills are open to every resolved agent.
 * `roles_allowed` and the skill tool channel are not decision inputs.
 * Draft and deprecated status gates stay.
 */
export async function canAccessSkill(
  _identity: Identity,
  skill: SkillAsset,
  action: SkillAclAction = "read"
): Promise<SkillAclDecision> {
  if (skill.status === "deprecated") {
    return { allowed: false, reason: "skill_deprecated", action };
  }
  if (skill.status !== "published") {
    return { allowed: false, reason: "skill_not_published", action };
  }
  return { allowed: true, action };
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
