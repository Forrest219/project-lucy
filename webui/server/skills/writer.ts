import path from "node:path";
import { stringify } from "yaml";
import { auditedRemoveFile, auditedWriteFile } from "../admin/config-audit-write.js";
import { getSkillByUri, invalidateSkillsCache, parseSkillMarkdown } from "./loader.js";
import { validateSkill } from "./validator.js";
import type { SkillAsset, SkillStatus, SkillWithValidation } from "./types.js";

const SKILL_SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SkillWriteError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SkillWriteError";
    this.statusCode = statusCode;
  }
}

export type SkillWriteInput = {
  name?: string;
  domain?: string;
  title?: string;
  version?: string;
  status?: SkillStatus;
  roles_allowed?: string[];
  triggers?: string[];
  description?: string;
  prerequisites?: {
    sources?: string[];
    measures?: string[];
    wiki_docs?: string[];
  };
  eval_cases?: string[];
  content?: string;
  rawContent?: string;
};

function assertSegment(kind: "domain" | "name", value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !SKILL_SEGMENT_RE.test(trimmed)) {
    throw new SkillWriteError(
      `${kind} must be lowercase letters, digits, and hyphens only (got "${value}")`
    );
  }
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new SkillWriteError(`invalid ${kind}: path segments are not allowed`);
  }
  return trimmed;
}

export function skillRelativePath(domain: string, name: string): string {
  return path.join("skills", assertSegment("domain", domain), `${assertSegment("name", name)}.md`);
}

export function assembleSkillMarkdown(input: SkillWriteInput): string {
  if (typeof input.rawContent === "string") {
    return input.rawContent;
  }
  const name = assertSegment("name", input.name ?? "");
  const domain = assertSegment("domain", input.domain ?? "");
  const frontmatter: Record<string, unknown> = {
    name,
    title: input.title?.trim() || name,
    version: input.version?.trim() || "1.0.0",
    domain,
    status: input.status === "published" || input.status === "deprecated" ? input.status : "draft",
    roles_allowed:
      Array.isArray(input.roles_allowed) && input.roles_allowed.length > 0 ? input.roles_allowed : ["*"],
    triggers: Array.isArray(input.triggers) ? input.triggers : [],
    description:
      input.description?.trim() ||
      `${input.title?.trim() || name} - ${domain} domain governed skill SOP`
  };
  if (input.prerequisites) frontmatter.prerequisites = input.prerequisites;
  if (Array.isArray(input.eval_cases) && input.eval_cases.length > 0) {
    frontmatter.eval_cases = input.eval_cases;
  }
  const body = (input.content ?? "").replace(/^\n+/, "");
  return `---\n${stringify(frontmatter).trim()}\n---\n\n${body}\n`;
}

async function parseOrThrow(projectRoot: string, raw: string, filePath: string): Promise<SkillAsset> {
  const parsed = parseSkillMarkdown(raw, filePath, projectRoot);
  if (!parsed?.name) {
    throw new SkillWriteError("Failed to parse YAML frontmatter or missing required 'name' field");
  }
  assertSegment("name", parsed.name);
  assertSegment("domain", parsed.domain);
  return parsed;
}

async function withValidation(skill: SkillAsset): Promise<SkillWithValidation> {
  return { ...skill, validation: await validateSkill(skill) };
}

export async function createSkillFile(
  projectRoot: string,
  input: SkillWriteInput
): Promise<SkillWithValidation> {
  let relPath: string;
  let raw: string;
  let parsed: SkillAsset;

  if (typeof input.rawContent === "string") {
    raw = input.rawContent;
    parsed = await parseOrThrow(projectRoot, raw, path.join(projectRoot, "skills", "_tmp", "incoming.md"));
    relPath = skillRelativePath(parsed.domain, parsed.name);
    parsed = await parseOrThrow(projectRoot, raw, path.join(projectRoot, relPath));
  } else {
    relPath = skillRelativePath(input.domain ?? "", input.name ?? "");
    raw = assembleSkillMarkdown(input);
    parsed = await parseOrThrow(projectRoot, raw, path.join(projectRoot, relPath));
    if (
      parsed.domain !== assertSegment("domain", input.domain ?? "") ||
      parsed.name !== assertSegment("name", input.name ?? "")
    ) {
      throw new SkillWriteError("frontmatter name/domain must match the create path");
    }
  }

  if (await getSkillByUri(parsed.uri)) {
    throw new SkillWriteError(`Skill already exists: ${parsed.uri}`, 409);
  }
  await auditedWriteFile(projectRoot, relPath, raw, {
    enabled: true,
    changeType: "skill_create",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: parsed.uri,
    operation: "create"
  });
  invalidateSkillsCache();
  const saved = await getSkillByUri(parsed.uri);
  if (!saved) throw new SkillWriteError("Skill was written but could not be reloaded", 500);
  return withValidation(saved);
}

export async function updateSkillFile(
  projectRoot: string,
  domain: string,
  name: string,
  input: SkillWriteInput
): Promise<SkillWithValidation> {
  const oldUri = `lucy-skill://${assertSegment("domain", domain)}/${assertSegment("name", name)}`;
  const existing = await getSkillByUri(oldUri);
  if (!existing) throw new SkillWriteError(`Skill not found: ${oldUri}`, 404);

  const nextDomain = assertSegment("domain", input.domain || domain);
  const nextName = assertSegment("name", input.name || name);
  const relPath = skillRelativePath(nextDomain, nextName);
  const merged: SkillWriteInput = {
    name: nextName,
    domain: nextDomain,
    title: input.title ?? existing.title,
    version: input.version ?? existing.version,
    status: input.status ?? existing.status,
    roles_allowed: input.roles_allowed ?? existing.roles_allowed,
    triggers: input.triggers ?? existing.triggers,
    description: input.description ?? existing.description,
    prerequisites: input.prerequisites ?? existing.prerequisites,
    eval_cases: input.eval_cases ?? existing.eval_cases,
    content: input.content ?? existing.content,
    rawContent: input.rawContent
  };
  const raw = assembleSkillMarkdown(merged);
  const parsed = await parseOrThrow(projectRoot, raw, path.join(projectRoot, relPath));
  if (parsed.uri !== oldUri && (await getSkillByUri(parsed.uri))) {
    throw new SkillWriteError(`Skill already exists: ${parsed.uri}`, 409);
  }

  await auditedWriteFile(projectRoot, relPath, raw, {
    enabled: true,
    changeType: "skill_edit_save",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: parsed.uri,
    operation: "edit_save"
  });
  if (existing.relativePath !== relPath) {
    await auditedRemoveFile(projectRoot, existing.relativePath, {
      enabled: true,
      changeType: "skill_rename_remove_old",
      assetKind: "skill",
      actorType: "ui_admin",
      source: "skills_api",
      targetId: oldUri,
      operation: "delete"
    });
  }
  invalidateSkillsCache();
  const saved = await getSkillByUri(parsed.uri);
  if (!saved) throw new SkillWriteError("Skill was written but could not be reloaded", 500);
  return withValidation(saved);
}

export async function deleteSkillFile(
  projectRoot: string,
  domain: string,
  name: string
): Promise<{ uri: string; relativePath: string }> {
  const uri = `lucy-skill://${assertSegment("domain", domain)}/${assertSegment("name", name)}`;
  const existing = await getSkillByUri(uri);
  if (!existing) throw new SkillWriteError(`Skill not found: ${uri}`, 404);
  await auditedRemoveFile(projectRoot, existing.relativePath, {
    enabled: true,
    changeType: "skill_delete",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: uri,
    operation: "delete"
  });
  invalidateSkillsCache();
  return { uri, relativePath: existing.relativePath };
}
