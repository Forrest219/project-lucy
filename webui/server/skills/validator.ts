import { isSkillSegment } from "./identifiers.js";
import { SKILL_OWNER_INVALID_CODE } from "./owner.js";
import type { SkillAsset, SkillValidationIssue, SkillValidationResult } from "./types.js";

/**
 * Structural checks only. A Skill is a shared, centrally uploaded document:
 * missing eval cases, Wiki pages, or semantic sources do not fail validation
 * and do not affect whether an Agent can read it.
 */
export function validateSkill(skill: SkillAsset): SkillValidationResult {
  const issues: SkillValidationIssue[] = [];

  if (!skill.name || skill.name.trim() === "") {
    issues.push({ code: "skill_name_required", type: "error", field: "name", message: "Skill 名称不能为空。" });
  } else if (!isSkillSegment(skill.name)) {
    issues.push({
      code: "skill_name_invalid",
      type: "error",
      field: "name",
      message: `Skill 名称“${skill.name}”只能使用小写字母、数字、连字符和下划线。`,
    });
  }

  if (!skill.title || skill.title.trim() === "") {
    issues.push({ code: "skill_title_required", type: "error", field: "title", message: "Skill 标题不能为空。" });
  }

  if (!skill.domain || skill.domain.trim() === "") {
    issues.push({ code: "skill_domain_required", type: "error", field: "domain", message: "Skill 域不能为空。" });
  } else if (!isSkillSegment(skill.domain)) {
    issues.push({
      code: "skill_domain_invalid",
      type: "error",
      field: "domain",
      message: `Skill 域“${skill.domain}”只能使用小写字母、数字、连字符和下划线。`,
    });
  }

  if (skill.roles_allowed_invalid && !(skill.roles_allowed.includes("*") && skill.roles_allowed.length > 1)) {
    issues.push({
      code: "skill_roles_invalid",
      type: "error",
      field: "roles_allowed",
      message: "可访问角色必须是角色 ID 数组或仅含 * 的数组。",
    });
  }

  if (skill.roles_allowed.includes("*") && skill.roles_allowed.length > 1) {
    issues.push({
      code: "skill_roles_wildcard_mixed",
      type: "error",
      field: "roles_allowed",
      message: "全部角色通配符不能与具体角色 ID 同时使用。",
    });
  }

  const validStatuses = ["draft", "published", "deprecated"];
  if (!validStatuses.includes(skill.status)) {
    issues.push({
      code: "skill_status_invalid",
      type: "error",
      field: "status",
      message: `状态“${skill.status}”无效，必须为 ${validStatuses.join("、")} 之一。`,
    });
  }

  // L25-04: a corrupt `owner` declaration is DISCLOSED, not treated as a failed
  // Skill. It stays a warning on purpose: `owner` carries no runtime meaning, so
  // an existing Skill must not flip from "valid" to "invalid" because of it
  // (Spec §3.2). A corrupt `roles_allowed` above is the opposite case — it denies
  // runtime access, so it is an error.
  if (skill.owner_invalid) {
    issues.push({
      code: SKILL_OWNER_INVALID_CODE,
      type: "warning",
      field: "owner",
      message: "负责人声明无效，请编辑修复。",
    });
  }

  return {
    valid: issues.every((issue) => issue.type !== "error"),
    issues,
  };
}
