import { loadContentPaths } from "../paths.js";
import { loadAllSkillsFresh } from "../skills/loader.js";
import type { ContextInventoryEntry } from "./context-policy.js";
import { skillToContextAsset } from "./skill-acl.js";
import { listMarkdownKeys, resolveWikiPage } from "./wiki-acl.js";

/**
 * Metadata-only view of every Wiki / Skill object's authorization facts (no body text).
 * Used for contextPolicyVersion, Role delete / create reference checks and the migration scan.
 * Unreadable or symlinked files are skipped here and are never readable by an Agent either.
 */
export async function listContextInventory(): Promise<ContextInventoryEntry[]> {
  const entries: ContextInventoryEntry[] = [];
  for (const skill of await loadAllSkillsFresh()) {
    const asset = skillToContextAsset(skill);
    entries.push({ kind: "skill", id: skill.uri, acl: asset.acl, status: skill.status, fileVersion: skill.file_version });
  }
  const wikiRoot = (await loadContentPaths()).wiki;
  let keys: string[] = [];
  try {
    keys = await listMarkdownKeys(wikiRoot);
  } catch {
    keys = [];
  }
  for (const key of keys) {
    const page = await resolveWikiPage(key);
    if (!page) continue;
    entries.push({
      kind: "wiki",
      id: page.key,
      acl: page.metadata.acl,
      fileVersion: page.fileVersion,
      ...(page.metadata.visibility ? { legacyVisibility: page.metadata.visibility } : {})
    });
  }
  return entries;
}

export interface RoleContextReferences {
  skills: string[];
  wiki: string[];
}

/** Objects whose explicit ACL names `roleId` (a `*` grant references no role). */
export function contextReferencesToRole(entries: ContextInventoryEntry[], roleId: string): RoleContextReferences {
  const refs: RoleContextReferences = { skills: [], wiki: [] };
  for (const entry of entries) {
    if (entry.acl.state !== "roles" || !entry.acl.roles.includes(roleId)) continue;
    (entry.kind === "skill" ? refs.skills : refs.wiki).push(entry.id);
  }
  refs.skills.sort();
  refs.wiki.sort();
  return refs;
}

export function hasContextReferences(refs: RoleContextReferences): boolean {
  return refs.skills.length + refs.wiki.length > 0;
}

export interface RoleWikiAccessSummary {
  discoverEnabled: boolean;
  readEnabled: boolean;
  declared: string[];
  discoverable: string[];
  readable: string[];
  declaredWithoutChannel: string[];
}

/** Read-only effect of ONE role on Wiki pages (Role detail): object ACL AND that role's own channel tool. */
export function summarizeRoleWikiAccess(
  roleId: string,
  tools: string[],
  entries: ContextInventoryEntry[]
): RoleWikiAccessSummary {
  const discoverEnabled = tools.includes("wiki_search");
  const readEnabled = tools.includes("wiki_read");
  const declared = entries
    .filter((entry) => entry.kind === "wiki" && (entry.acl.state === "all" || (entry.acl.state === "roles" && entry.acl.roles.includes(roleId))))
    .map((entry) => entry.id)
    .sort();
  return {
    discoverEnabled,
    readEnabled,
    declared,
    discoverable: discoverEnabled ? declared : [],
    readable: readEnabled ? declared : [],
    declaredWithoutChannel: discoverEnabled && readEnabled ? [] : declared
  };
}
