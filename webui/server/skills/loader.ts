import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import type { SkillAsset, SkillFrontmatter } from "./types.js";

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

let skillsCache: SkillAsset[] | null = null;
let lastLoadedTime = 0;
const CACHE_TTL_MS = 2000;

export function invalidateSkillsCache(): void {
  skillsCache = null;
  lastLoadedTime = 0;
}

export function parseSkillMarkdown(rawContent: string, filePath: string, projectRoot: string): SkillAsset | null {
  const match = FRONTMATTER_REGEX.exec(rawContent.trimStart());
  if (!match) {
    return null;
  }

  const [, yamlStr, bodyContent] = match;
  let parsed: Partial<SkillFrontmatter>;
  try {
    parsed = parse(yamlStr) as Partial<SkillFrontmatter>;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || !parsed.name) {
    return null;
  }

  const relativePath = path.relative(projectRoot, filePath);
  // Infer domain from path if not explicitly provided in frontmatter
  let inferredDomain = parsed.domain;
  if (!inferredDomain) {
    const parts = relativePath.split(path.sep);
    const domainIdx = parts.indexOf("domains");
    if (domainIdx !== -1 && parts[domainIdx + 1]) {
      inferredDomain = parts[domainIdx + 1];
    } else if (parts.length > 1) {
      inferredDomain = parts[1]; // e.g. skills/warehouse/SKILL.md -> warehouse
    } else {
      inferredDomain = "global";
    }
  }

  const name = String(parsed.name).trim();
  const domain = String(inferredDomain).trim();
  const title = parsed.title ? String(parsed.title).trim() : name;
  const version = parsed.version ? String(parsed.version).trim() : "1.0.0";
  const status = parsed.status === "draft" || parsed.status === "deprecated" ? parsed.status : "published";
  const roles_allowed = Array.isArray(parsed.roles_allowed)
    ? parsed.roles_allowed.map(r => String(r).trim()).filter(Boolean)
    : ["*"];
  const triggers = Array.isArray(parsed.triggers)
    ? parsed.triggers.map(t => String(t).trim()).filter(Boolean)
    : [];
  const eval_cases = Array.isArray(parsed.eval_cases)
    ? parsed.eval_cases.map(e => String(e).trim()).filter(Boolean)
    : [];

  const prereq = parsed.prerequisites || {};
  const prerequisites = {
    sources: Array.isArray(prereq.sources) ? prereq.sources.map(s => String(s).trim()).filter(Boolean) : [],
    measures: Array.isArray(prereq.measures) ? prereq.measures.map(m => String(m).trim()).filter(Boolean) : [],
    wiki_docs: Array.isArray(prereq.wiki_docs) ? prereq.wiki_docs.map(w => String(w).trim()).filter(Boolean) : [],
  };

  const uri = `lucy-skill://${domain}/${name}`;
  const description = parsed.description
    ? String(parsed.description).trim()
    : `${title} - ${domain} domain governed skill SOP`;

  return {
    name,
    title,
    version,
    domain,
    status,
    roles_allowed,
    prerequisites,
    triggers,
    eval_cases,
    description,
    uri,
    relativePath,
    filePath,
    content: bodyContent.trim(),
    raw: rawContent,
  };
}

async function scanDirectoryForSkills(dir: string, projectRoot: string, accumulator: SkillAsset[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) {
        continue;
      }
      await scanDirectoryForSkills(fullPath, projectRoot, accumulator);
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".markdown"))) {
      try {
        const rawContent = await readFile(fullPath, "utf-8");
        const skill = parseSkillMarkdown(rawContent, fullPath, projectRoot);
        if (skill) {
          accumulator.push(skill);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }
}

export async function loadAllSkills(customSkillsDir?: string, customProjectRoot?: string): Promise<SkillAsset[]> {
  const now = Date.now();
  if (skillsCache && now - lastLoadedTime < CACHE_TTL_MS && !customSkillsDir && !customProjectRoot) {
    return skillsCache;
  }

  const projectRoot = customProjectRoot ?? (await resolveProjectRoot());
  const skillsDir = customSkillsDir ?? path.join(projectRoot, "skills");

  const results: SkillAsset[] = [];
  await scanDirectoryForSkills(skillsDir, projectRoot, results);

  if (!customSkillsDir && !customProjectRoot) {
    skillsCache = results;
    lastLoadedTime = now;
  }

  return results;
}

export async function getSkillByUri(uri: string, customSkillsDir?: string, customProjectRoot?: string): Promise<SkillAsset | null> {
  const skills = await loadAllSkills(customSkillsDir, customProjectRoot);
  const normalized = uri.trim();
  return skills.find(s => s.uri === normalized) ?? null;
}

export async function getSkillByName(name: string, customSkillsDir?: string, customProjectRoot?: string): Promise<SkillAsset | null> {
  const skills = await loadAllSkills(customSkillsDir, customProjectRoot);
  const normalized = name.trim().toLowerCase();
  return skills.find(s => s.name.toLowerCase() === normalized) ?? null;
}
