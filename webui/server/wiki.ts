import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { previewDiff } from "./diff";
import { assertReadable, ForbiddenPathError, safeWrite } from "./fs-safe";

export type WikiFrontmatter = {
  summary?: string;
  tags?: string[];
  sl_refs?: string[];
  refs?: string[];
  usage_mode?: string;
};

export type WikiPage = {
  key: string;
  frontmatter: WikiFrontmatter;
  content: string;
  rawMarkdown: string;
};

export type WikiSummary = {
  key: string;
  summary?: string;
  tags: string[];
  slRefs: string[];
};

export type WikiWriteInput = {
  frontmatter?: WikiFrontmatter;
  content?: string;
};

export type WikiPreview = {
  key: string;
  filePath: string;
  diff: string;
  proposedMarkdown: string;
};

function normalizeKey(key: string): string {
  const decoded = decodeURIComponent(key);
  if (!decoded || decoded.startsWith("/") || path.isAbsolute(decoded)) {
    throw new ForbiddenPathError("Wiki key must be relative to knowledge/");
  }
  const normalized = path.posix.normalize(decoded).replaceAll("\\", "/");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !normalized.endsWith(".md")
  ) {
    throw new ForbiddenPathError("Wiki key must be a markdown path under knowledge/");
  }
  return normalized;
}

function relPathForKey(key: string): string {
  return path.posix.join("wiki", normalizeKey(key));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function frontmatterFromData(data: Record<string, unknown>): WikiFrontmatter {
  return {
    summary: typeof data.summary === "string" ? data.summary : undefined,
    tags: stringArray(data.tags),
    sl_refs: stringArray(data.sl_refs),
    refs: stringArray(data.refs),
    usage_mode: typeof data.usage_mode === "string" ? data.usage_mode : undefined
  };
}

function serializeWiki(frontmatter: WikiFrontmatter, content: string): string {
  const data: Record<string, unknown> = {};
  if (frontmatter.summary) data.summary = frontmatter.summary;
  if (frontmatter.tags?.length) data.tags = frontmatter.tags;
  if (frontmatter.sl_refs?.length) data.sl_refs = frontmatter.sl_refs;
  if (frontmatter.refs?.length) data.refs = frontmatter.refs;
  if (frontmatter.usage_mode) data.usage_mode = frontmatter.usage_mode;
  return matter.stringify(content ?? "", data);
}

async function readExisting(projectRoot: string, key: string): Promise<string> {
  try {
    return await readFile(await assertReadable(projectRoot, relPathForKey(key)), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function walkMarkdown(dir: string, base: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const keys: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) {
      keys.push(...(await walkMarkdown(abs, rel)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      keys.push(rel);
    }
  }
  return keys;
}

export async function listWiki(projectRoot: string): Promise<WikiSummary[]> {
  const wikiRoot = path.join(projectRoot, "wiki");
  const keys = await walkMarkdown(wikiRoot, "");
  const summaries: WikiSummary[] = [];
  for (const key of keys.sort()) {
    const page = await readWiki(projectRoot, key);
    summaries.push({
      key,
      summary: page.frontmatter.summary,
      tags: page.frontmatter.tags ?? [],
      slRefs: page.frontmatter.sl_refs ?? []
    });
  }
  return summaries;
}

export async function readWiki(projectRoot: string, key: string): Promise<WikiPage> {
  const normalized = normalizeKey(key);
  const rawMarkdown = await readExisting(projectRoot, normalized);
  const parsed = matter(rawMarkdown);
  return {
    key: normalized,
    frontmatter: frontmatterFromData(parsed.data),
    content: parsed.content,
    rawMarkdown
  };
}

export async function previewWikiWrite(projectRoot: string, key: string, input: WikiWriteInput): Promise<WikiPreview> {
  const normalized = normalizeKey(key);
  const oldText = await readExisting(projectRoot, normalized);
  const current = matter(oldText);
  const frontmatter = {
    ...frontmatterFromData(current.data),
    ...(input.frontmatter ?? {})
  };
  const proposedMarkdown = serializeWiki(frontmatter, input.content ?? current.content);
  const filePath = relPathForKey(normalized);
  return {
    key: normalized,
    filePath,
    diff: previewDiff(oldText, proposedMarkdown, filePath),
    proposedMarkdown
  };
}

export async function writeWiki(projectRoot: string, key: string, input: WikiWriteInput): Promise<WikiPreview> {
  const preview = await previewWikiWrite(projectRoot, key, input);
  await safeWrite(projectRoot, preview.filePath, preview.proposedMarkdown);
  return preview;
}
