import { access } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { auditedRemoveFile, auditedWriteFile } from "../admin/config-audit-write.js";
import { getAccessConfig } from "../proxy/identity.js";
import { SKILL_SEGMENT_RE } from "./identifiers.js";
import { getSkillByUri, invalidateSkillsCache, parseSkillMarkdown } from "./loader.js";
import { validateSkill } from "./validator.js";
import type { SkillAsset, SkillStatus, SkillWithValidation } from "./types.js";

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
  expected_version?: string;
};

function assertSegment(kind: "domain" | "name", value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !SKILL_SEGMENT_RE.test(trimmed)) {
    throw new SkillWriteError(
      `${kind} must be lowercase letters, digits, hyphens, and underscores only (got "${value}")`
    );
  }
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new SkillWriteError(`invalid ${kind}: path segments are not allowed`);
  }
  return trimmed;
}

function normalizeRolesAllowed(value: string[] | undefined): string[] {
  const roles = Array.isArray(value)
    ? [...new Set(value.map((role) => String(role).trim()).filter(Boolean))]
    : [];
  if (roles.includes("*") && roles.length > 1) {
    throw new SkillWriteError("roles_allowed wildcard must not be combined with role ids");
  }
  return roles;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertExpectedVersion(existing: SkillAsset, expectedVersion: string | undefined): void {
  if (!expectedVersion?.trim()) {
    throw new SkillWriteError("skill_expected_version_required", 428);
  }
  if (expectedVersion !== existing.file_version) {
    throw new SkillWriteError("skill_write_conflict", 409);
  }
}

async function authorizationAuditSummary(oldRoles: string[], newRoles: string[]) {
  const oldSet = new Set(oldRoles);
  const newSet = new Set(newRoles);
  const enteredWildcard = !oldSet.has("*") && newSet.has("*");
  const exitedWildcard = oldSet.has("*") && !newSet.has("*");
  let affectedRoleIds = [...new Set([
    ...oldRoles.filter((role) => role !== "*" && !newSet.has(role)),
    ...newRoles.filter((role) => role !== "*" && !oldSet.has(role))
  ])].sort();
  let affectedAgentCount: number | null = null;

  try {
    const config = await getAccessConfig();
    if (enteredWildcard || exitedWildcard) {
      affectedRoleIds = Object.keys(config.roles ?? {}).sort();
    }
    const affected = new Set(affectedRoleIds);
    affectedAgentCount = config.users.filter((user) => {
      if (user.enabled === false) return false;
      if (enteredWildcard || exitedWildcard) return true;
      const assigned = [...(user.roles ?? []), ...(user.role ? [user.role] : [])];
      return assigned.some((role) => affected.has(role));
    }).length;
  } catch {
    // Authorization changes must remain writable even if the admin audit cannot
    // enrich the record from access.yaml. The role delta is still preserved.
  }

  return {
    roles_allowed: newRoles,
    all_roles_visible: newSet.has("*"),
    entered_wildcard: enteredWildcard,
    exited_wildcard: exitedWildcard,
    affected_role_ids: affectedRoleIds,
    affected_agent_count: affectedAgentCount
  };
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
    roles_allowed: normalizeRolesAllowed(input.roles_allowed),
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
    if ((input.name && parsed.name !== input.name.trim()) || (input.domain && parsed.domain !== input.domain.trim())) {
      throw new SkillWriteError("frontmatter name/domain must match the create request");
    }
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

  if (await pathExists(path.join(projectRoot, relPath))) {
    throw new SkillWriteError(`skill_path_conflict:${relPath}`, 409);
  }
  if (await getSkillByUri(parsed.uri)) {
    throw new SkillWriteError(`skill_uri_conflict:${parsed.uri}`, 409);
  }
  const authSummary = await authorizationAuditSummary([], parsed.roles_allowed);
  await auditedWriteFile(projectRoot, relPath, raw, {
    enabled: true,
    changeType: "skill_create",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: parsed.uri,
    operation: "create",
    newSummary: { ...authSummary, file_version: parsed.file_version }
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
  assertExpectedVersion(existing, input.expected_version);

  const nextDomain = assertSegment("domain", input.domain || domain);
  const nextName = assertSegment("name", input.name || name);
  if (nextDomain !== domain || nextName !== name) {
    throw new SkillWriteError("skill_identity_immutable", 409);
  }
  const relPath = existing.relativePath;
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
  if (parsed.uri !== oldUri) {
    throw new SkillWriteError("skill_identity_immutable", 409);
  }

  const oldAuthSummary = await authorizationAuditSummary(existing.roles_allowed, existing.roles_allowed);
  const newAuthSummary = await authorizationAuditSummary(existing.roles_allowed, parsed.roles_allowed);
  await auditedWriteFile(projectRoot, relPath, raw, {
    enabled: true,
    changeType: "skill_edit_save",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: parsed.uri,
    operation: "edit_save",
    oldSummary: { ...oldAuthSummary, file_version: existing.file_version },
    newSummary: { ...newAuthSummary, file_version: parsed.file_version }
  });
  invalidateSkillsCache();
  const saved = await getSkillByUri(parsed.uri);
  if (!saved) throw new SkillWriteError("Skill was written but could not be reloaded", 500);
  return withValidation(saved);
}

export async function deleteSkillFile(
  projectRoot: string,
  domain: string,
  name: string,
  expectedVersion?: string
): Promise<{ uri: string; relativePath: string }> {
  const uri = `lucy-skill://${assertSegment("domain", domain)}/${assertSegment("name", name)}`;
  const existing = await getSkillByUri(uri);
  if (!existing) throw new SkillWriteError(`Skill not found: ${uri}`, 404);
  assertExpectedVersion(existing, expectedVersion);
  const authSummary = await authorizationAuditSummary(existing.roles_allowed, []);
  await auditedRemoveFile(projectRoot, existing.relativePath, {
    enabled: true,
    changeType: "skill_delete",
    assetKind: "skill",
    actorType: "ui_admin",
    source: "skills_api",
    targetId: uri,
    operation: "delete",
    oldSummary: {
      ...authSummary,
      roles_allowed: existing.roles_allowed,
      all_roles_visible: existing.roles_allowed.includes("*"),
      file_version: existing.file_version
    }
  });
  invalidateSkillsCache();
  return { uri, relativePath: existing.relativePath };
}
