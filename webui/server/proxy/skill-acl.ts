import type { Identity } from "./identity.js";
import type { SkillAsset } from "../skills/types.js";
import {
  authorizeContext,
  parseObjectAcl,
  type ContextAsset,
  type ContextSnapshot
} from "./context-acl.js";
import { resolveContextSnapshot } from "./context-policy.js";

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

/** Spec §4.1 — Skill `roles_allowed` as the canonical object ACL. */
export function skillToContextAsset(skill: SkillAsset): ContextAsset {
  const acl = skill.roles_allowed_invalid
    ? ({ state: "corrupt", detail: "invalid_roles_allowed" } as const)
    : parseObjectAcl(skill.roles_allowed, true);
  return { kind: "skill", id: skill.uri, acl, status: skill.status };
}

/**
 * Read-only effect of ONE role on Skills (Role detail). Mirrors `authorizeContext` for a
 * single role: object ACL (`roles_allowed`) AND the role's own channel tool.
 */
export function summarizeRoleSkillAccess(
  roleId: string,
  tools: string[],
  skills: SkillAsset[]
): RoleSkillAccessSummary {
  const discoverEnabled = tools.includes("lucy_skill_search");
  const readEnabled = tools.includes("lucy_skill_read");
  const declared = skills
    .filter((skill) => {
      const acl = skillToContextAsset(skill).acl;
      return acl.state === "all" || (acl.state === "roles" && acl.roles.includes(roleId));
    })
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

function toSkillDecision(
  decision: ReturnType<typeof authorizeContext>
): SkillAclDecision {
  if (decision.allowed) return { allowed: true, action: decision.action, matchedRoleId: decision.matchedRoleId };
  return { allowed: false, reason: decision.reason, action: decision.action };
}

/**
 * Spec §4 (supersedes Spec 170): default deny. A published Skill is visible only to a role
 * that matches `roles_allowed` AND grants the action's channel tool.
 */
export async function canAccessSkill(
  identity: Identity,
  skill: SkillAsset,
  action: SkillAclAction = "read",
  snapshot?: ContextSnapshot
): Promise<SkillAclDecision> {
  const resolved = snapshot ?? await resolveContextSnapshot(identity);
  return toSkillDecision(authorizeContext(identity, skillToContextAsset(skill), action, resolved));
}

export async function filterAccessibleSkills(
  identity: Identity,
  skills: SkillAsset[],
  action: SkillAclAction = "discover"
): Promise<SkillAsset[]> {
  const snapshot = await resolveContextSnapshot(identity);
  const accessible: SkillAsset[] = [];
  for (const skill of skills) {
    const decision = await canAccessSkill(identity, skill, action, snapshot);
    if (decision.allowed) {
      accessible.push(skill);
    }
  }
  return accessible;
}
