import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { isSkillSegment } from "./identifiers.js";
import type { SkillAsset, SkillValidationIssue, SkillValidationResult } from "./types.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateSkill(skill: SkillAsset, customProjectRoot?: string): Promise<SkillValidationResult> {
  const issues: SkillValidationIssue[] = [];
  const projectRoot = customProjectRoot ?? (await resolveProjectRoot());

  // 1. Basic field checks
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

  if (skill.roles_allowed.includes("*") && skill.roles_allowed.length > 1) {
    issues.push({
      code: "skill_roles_wildcard_mixed",
      type: "error",
      field: "roles_allowed",
      message: "全部角色通配符不能与具体角色 ID 同时使用。",
    });
  }

  if (!skill.version || skill.version.trim() === "") {
    issues.push({ code: "skill_version_defaulted", type: "warning", field: "version", message: "Skill 版本为空，将使用默认值 1.0.0。" });
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

  // 2. Prerequisites validation
  // 2.1 Sources check in semantic-layer/
  if (skill.prerequisites?.sources) {
    for (const source of skill.prerequisites.sources) {
      // source can be "mysql-aliyun.superstore_orders" or "superstore_orders"
      const parts = source.split(".");
      const tableName = parts[parts.length - 1];
      const connName = parts.length > 1 ? parts[0] : "";

      // Check if any yaml in semantic-layer references this
      let found = false;
      const semanticLayerDir = path.join(projectRoot, "semantic-layer");
      try {
        const conns = await readdir(semanticLayerDir, { withFileTypes: true });
        for (const conn of conns) {
          if (!conn.isDirectory() || conn.name.startsWith(".")) continue;
          if (connName && conn.name !== connName) continue;
          const connDir = path.join(semanticLayerDir, conn.name);
          const files = await readdir(connDir);
          for (const f of files) {
            if (f.endsWith(".yaml") || f.endsWith(".yml")) {
              if (f.startsWith(tableName)) {
                found = true;
                break;
              }
              // Also check inside schema file
              if (f === "dataforai.yaml" || f.startsWith("_schema")) {
                try {
                  const content = await readFile(path.join(connDir, f), "utf-8");
                  if (content.includes(tableName)) {
                    found = true;
                    break;
                  }
                } catch {}
              }
            }
          }
          if (found) break;
        }
      } catch {
        // semantic-layer directory might not exist in some lightweight test mocks
      }

      if (!found && !customProjectRoot) {
        issues.push({
          code: "skill_source_unverified",
          type: "warning",
          field: "prerequisites.sources",
          message: `无法在 semantic-layer 目录中确认语义源“${source}”。`,
        });
      }
    }
  }

  // 2.2 Wiki docs check in wiki/
  if (skill.prerequisites?.wiki_docs) {
    for (const wikiDoc of skill.prerequisites.wiki_docs) {
      const candidates = [
        path.join(projectRoot, "wiki", wikiDoc),
        path.join(projectRoot, "wiki", "global", wikiDoc),
        path.join(projectRoot, wikiDoc),
      ];
      let exists = false;
      for (const cand of candidates) {
        if (await fileExists(cand)) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        issues.push({
          code: "skill_wiki_missing",
          type: "error",
          field: "prerequisites.wiki_docs",
          message: `引用的 Wiki 文档“${wikiDoc}”不在 wiki/ 目录中。`,
        });
      }
    }
  }

  // 3. Eval cases check for published skills
  if (skill.status === "published") {
    if (!skill.eval_cases || skill.eval_cases.length === 0) {
      issues.push({
        code: "skill_eval_required",
        type: "error",
        field: "eval_cases",
        message: "已发布 Skill 至少需要配置一个 eval_cases 评测用例。",
      });
    } else {
      for (const evalCase of skill.eval_cases) {
        const candidates = [
          path.join(projectRoot, evalCase),
          path.join(projectRoot, "evals", evalCase),
          path.join(projectRoot, "evals", skill.domain, evalCase),
        ];
        let exists = false;
        for (const cand of candidates) {
          if (await fileExists(cand)) {
            exists = true;
            break;
          }
        }
        if (!exists && !customProjectRoot) {
          issues.push({
            code: "skill_eval_missing",
            type: "warning",
            field: "eval_cases",
            message: `未在 evals/ 目录中找到评测用例文件“${evalCase}”。`,
          });
        }
      }
    }
  }

  return {
    valid: issues.filter(i => i.type === "error").length === 0,
    issues,
  };
}
