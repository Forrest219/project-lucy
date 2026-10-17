import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { loadContentPaths } from "../paths.js";
import { readContextFile } from "../fs-safe.js";
import type { Identity } from "./identity.js";
import {
  authorizeContext,
  parseObjectAcl,
  type ContextAction,
  type ContextAsset,
  type ContextSnapshot,
  type ObjectAcl
} from "./context-acl.js";
import { resolveContextSnapshot } from "./context-policy.js";

export interface WikiPage {
  key: string;
  filePath: string;
  title?: string;
  body: string;
  /** `sha256:<hex>` of the exact file bytes — same identity as the admin Wiki `file_version`. */
  fileVersion: string;
  metadata: {
    visibility?: string;
    slRefs: string[];
    allowedRoles: string[];
    /** Canonical object ACL from `allowed_roles` (Spec §4.1); `visibility` / `sl_refs` never grant. */
    acl: ObjectAcl;
    /** Frontmatter `version`, when the page declares one. */
    version?: string;
  };
}

/**
 * Spec 162 §7.7 / SC-12 — Wiki version for audit. Falls back to the page's
 * mtime when the frontmatter declares no version, so an injected article is
 * always traceable to a concrete revision.
 */
export interface WikiInjectionRef {
  key: string;
  version: string;
}

export interface WikiAclDecision {
  allowed: boolean;
  reason?: string;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  if (!content.startsWith("---\n")) return { data: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end < 0) return { data: {}, body: content };
  const raw = content.slice(4, end);
  const body = content.slice(end + "\n---".length).replace(/^\r?\n/, "");
  try {
    const parsed = parse(raw);
    return { data: parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}, body };
  } catch {
    return { data: {}, body };
  }
}

function titleFromBody(body: string): string | undefined {
  const line = body.split(/\r?\n/).find((item) => item.startsWith("# "));
  return line?.replace(/^#\s+/, "").trim();
}

export function canonicalWikiKey(input: string): string | undefined {
  const trimmed = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed || trimmed.includes("..")) return undefined;
  let key = trimmed.replace(/^wiki\//, "");
  if (!key.includes("/") && key.startsWith("global-")) {
    key = `global/${key.slice("global-".length)}`;
  }
  if (!key.endsWith(".md")) key = `${key}.md`;
  return key;
}

export async function resolveWikiPage(input: string): Promise<WikiPage | undefined> {
  const key = canonicalWikiKey(input);
  if (!key) return undefined;
  const wikiRoot = (await loadContentPaths()).wiki;
  const filePath = path.join(wikiRoot, key);

  try {
    // Spec §4.5: symlink-free, open-time identity checked read; any failure is "not found".
    const { content, mtime } = await readContextFile(wikiRoot, key);
    const { data, body } = parseFrontmatter(content);
    return {
      key,
      filePath,
      title: titleFromBody(body),
      body,
      fileVersion: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      metadata: {
        visibility: typeof data.visibility === "string" ? data.visibility.trim().toLowerCase() : undefined,
        slRefs: asStringList(data.sl_refs),
        allowedRoles: asStringList(data.allowed_roles),
        acl: parseObjectAcl(data.allowed_roles, Object.prototype.hasOwnProperty.call(data, "allowed_roles")),
        version: typeof data.version === "string" && data.version.trim()
          ? data.version.trim()
          : mtime.toISOString()
      }
    };
  } catch {
    return undefined;
  }
}

/**
 * Spec 162 §7.7 / SC-12 — audit refs for articles injected into an answer.
 * Every entry has already passed the role check in
 * `searchAccessibleWikiPages` / `canAccessWikiPage`.
 */
export function wikiInjectionRefs(pages: Array<Pick<WikiPage, "key" | "metadata">>): WikiInjectionRef[] {
  return pages.map((page) => ({
    key: page.key,
    version: page.metadata.version ?? "unknown"
  }));
}

export function wikiToContextAsset(page: Pick<WikiPage, "key" | "metadata">): ContextAsset {
  return { kind: "wiki", id: page.key, acl: page.metadata.acl };
}

/**
 * Spec §4 (supersedes Spec 170): default deny. A Wiki page is visible only to a role that
 * matches `allowed_roles` AND grants the action's channel tool (`wiki_search` / `wiki_read`).
 */
export async function canAccessWikiPage(
  identity: Identity,
  page: WikiPage,
  action: ContextAction = "read",
  snapshot?: ContextSnapshot
): Promise<WikiAclDecision> {
  const resolved = snapshot ?? await resolveContextSnapshot(identity);
  const decision = authorizeContext(identity, wikiToContextAsset(page), action, resolved);
  return decision.allowed ? { allowed: true } : { allowed: false, reason: decision.reason };
}

export async function canAccessWikiKey(
  identity: Identity,
  key: string,
  action: ContextAction = "read"
): Promise<{ page?: WikiPage; decision: WikiAclDecision }> {
  const page = await resolveWikiPage(key);
  if (!page) return { decision: { allowed: false, reason: "wiki_not_found" } };
  return { page, decision: await canAccessWikiPage(identity, page, action) };
}

export async function listMarkdownKeys(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      keys.push(...await listMarkdownKeys(fullPath, relative));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      keys.push(relative);
    }
  }
  return keys;
}

export async function searchAccessibleWikiPages(identity: Identity, query: string, limit = 10): Promise<Array<{
  key: string;
  title?: string;
  snippet: string;
  /** Wiki version of the matched article, for audit (SC-12). */
  version?: string;
}>> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const wikiRoot = (await loadContentPaths()).wiki;
  const snapshot = await resolveContextSnapshot(identity);
  let keys: string[];
  try {
    keys = await listMarkdownKeys(wikiRoot);
  } catch {
    return [];
  }

  const matches: Array<{ key: string; title?: string; snippet: string; version?: string; score: number }> = [];
  for (const key of keys) {
    const page = await resolveWikiPage(key);
    if (!page) continue;
    const decision = await canAccessWikiPage(identity, page, "discover", snapshot);
    if (!decision.allowed) continue;
    const searchable = `${page.key}\n${page.title ?? ""}\n${page.body}`.toLowerCase();
    const matchedTerms = terms.filter((term) => searchable.includes(term));
    if (matchedTerms.length === 0) continue;
    const firstTerm = matchedTerms[0] ?? terms[0] ?? "";
    const bodyLower = page.body.toLowerCase();
    const index = firstTerm ? bodyLower.indexOf(firstTerm) : -1;
    const snippet = (index >= 0
      ? page.body.slice(Math.max(0, index - 80), index + 220)
      : page.body.slice(0, 260)).replace(/\s+/g, " ").trim();
    matches.push({
      key: page.key,
      title: page.title,
      snippet,
      version: page.metadata.version,
      score: matchedTerms.length + (page.title?.toLowerCase().includes(normalizedQuery) ? 2 : 0)
    });
  }

  return matches
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, title, snippet, version }) => ({ key, title, snippet, version }));
}
