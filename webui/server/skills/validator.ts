import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
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
    issues.push({ type: "error", field: "name", message: "Skill name is required" });
  } else if (!/^[a-zA-Z0-9_-]+$/.test(skill.name)) {
    issues.push({
      type: "error",
      field: "name",
      message: `Skill name "${skill.name}" must contain only alphanumeric characters, dashes, and underscores`,
    });
  }

  if (!skill.title || skill.title.trim() === "") {
    issues.push({ type: "error", field: "title", message: "Skill title is required" });
  }

  if (!skill.domain || skill.domain.trim() === "") {
    issues.push({ type: "error", field: "domain", message: "Skill domain is required" });
  }

  if (!skill.version || skill.version.trim() === "") {
    issues.push({ type: "warning", field: "version", message: "Skill version is missing, defaulting to 1.0.0" });
  }

  const validStatuses = ["draft", "published", "deprecated"];
  if (!validStatuses.includes(skill.status)) {
    issues.push({
      type: "error",
      field: "status",
      message: `Invalid status "${skill.status}". Must be one of: ${validStatuses.join(", ")}`,
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
          type: "warning",
          field: "prerequisites.sources",
          message: `Source "${source}" could not be verified in semantic-layer directory`,
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
          type: "error",
          field: "prerequisites.wiki_docs",
          message: `Referenced wiki document "${wikiDoc}" does not exist in wiki/ directory`,
        });
      }
    }
  }

  // 3. Eval cases check for published skills
  if (skill.status === "published") {
    if (!skill.eval_cases || skill.eval_cases.length === 0) {
      issues.push({
        type: "error",
        field: "eval_cases",
        message: 'Published skill must have at least one eval case defined in "eval_cases"',
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
            type: "warning",
            field: "eval_cases",
            message: `Eval case file "${evalCase}" not found under evals/ directory`,
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
