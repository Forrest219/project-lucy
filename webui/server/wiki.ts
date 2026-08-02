import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { previewDiff } from "./diff";
import {
  assertReadable,
  DirectoryNotEmptyError,
  ForbiddenPathError,
  safeMkdir,
  safeRemove,
  safeRemoveDirectory,
  safeWrite
} from "./fs-safe";

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

export type WikiDirectorySummary = {
  path: string;
  name: string;
  documentCount: number;
  explicit: boolean;
  empty: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WikiDirectoryCreateInput = {
  path?: string;
  parent?: string;
  name?: string;
};

export type WikiDirectoryCreateResult = {
  directory: WikiDirectorySummary;
  created: boolean;
  filePath: string;
};

export type WikiDirectoryDeleteResult = {
  path: string;
  deleted: boolean;
  filePath: string;
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

export type WikiUploadInput = {
  key: string;
  markdown: string;
  overwrite?: boolean;
  sourceFileName?: string;
  /**
   * Caller-declared intent. `replace` means the user explicitly chose
   * the overwrite path; `create` means the upload should fail if the
   * target already exists. When omitted the server falls back to the
   * legacy `overwrite` boolean.
   */
  mode?: WikiUploadMode;
};

export type WikiUploadMode = "create" | "replace";

export type WikiUploadPreview = WikiPreview & {
  exists: boolean;
  mode: WikiUploadMode;
  /** Basename of the local file the user picked in the browser. */
  sourceFileName: string;
  /** Final Wiki key after applying the current target directory. */
  targetKey: string;
  /** Title currently persisted for the target document, or `null` when creating. */
  existingTitle: string | null;
  /** Title that will be written after the upload commits. */
  targetTitle: string;
  /** Legacy alias for `targetTitle`. Kept for backwards compatibility with
   *  downstream code that already referenced `preview.title`. */
  title: string;
  slRefs: string[];
  warnings: string[];
};

export type WikiMovePreview = WikiPreview & {
  sourceKey: string;
  targetKey: string;
  targetDirectory: string;
  exists: boolean;
  title: string;
  /** `true` when the basename of source and target keys differ. */
  basenameChanged: boolean;
  warnings: string[];
};

export type WikiMoveResult = {
  sourceKey: string;
  key: string;
  targetDirectory: string;
  previousKey: string;
  newVersionId: string;
  filePath: string;
};

export type WikiMoveInput = {
  targetDirectory: string;
};

const MAX_MARKDOWN_UPLOAD_BYTES = 1024 * 1024;
const WIKI_DIRECTORY_METADATA_PATH = "wiki/.lucy-directories.json";
const WIKI_HISTORY_INDEX_PATH = "wiki/.lucy-history/index.json";
const WIKI_HISTORY_SNAPSHOT_ROOT = "wiki/.lucy-history/snapshots";
export const WIKI_VERSION_RETENTION_LIMIT = 5;

type WikiDirectoryMetadataEntry = {
  path: string;
  createdAt: string;
  updatedAt: string;
};

type WikiDirectoryMetadata = {
  schemaVersion: 1;
  directories: WikiDirectoryMetadataEntry[];
};

export class WikiDirectoryError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WikiDirectoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type WikiVersionOperation =
  | "create"
  | "edit_save"
  | "upload_create"
  | "upload_replace"
  | "restore"
  | "move"
  | "rename"
  | "delete";

const WIKI_VERSION_OPERATIONS = new Set<WikiVersionOperation>([
  "create",
  "edit_save",
  "upload_create",
  "upload_replace",
  "restore",
  "move",
  "rename",
  "delete"
]);

export type WikiVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: WikiVersionOperation;
  title?: string;
  summary?: string;
  sourceFileName?: string;
  previousKey?: string;
  restoredFromVersionId?: string;
  contentHash: string;
};

export type WikiVersionDetail = WikiVersionSummary & {
  rawMarkdown: string;
  diffFromCurrent: string;
};

export type WikiVersionListResponse = {
  key: string;
  retentionLimit: number;
  versions: WikiVersionSummary[];
};

export type WikiVersionRestorePreview = {
  key: string;
  versionId: string;
  targetTitle: string;
  diff: string;
};

export type WikiVersionRestoreResult = {
  key: string;
  restoredFromVersionId: string;
  newVersionId: string;
  filePath: string;
};

type WikiVersionMetadataEntry = WikiVersionSummary & {
  snapshotPath: string;
};

type WikiHistoryDocument = {
  key: string;
  createdAt: string;
  updatedAt: string;
  currentVersionId?: string;
  versions: WikiVersionMetadataEntry[];
};

type WikiHistoryIndex = {
  schemaVersion: 1;
  documents: Record<string, WikiHistoryDocument>;
};

class WikiVersionError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WikiVersionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function normalizeWikiKey(key: string): string {
  const decoded = decodeURIComponent(key);
  if (!decoded || decoded.startsWith("/") || path.isAbsolute(decoded)) {
    throw new ForbiddenPathError("Wiki key must be relative to wiki/");
  }
  const normalized = path.posix.normalize(decoded).replaceAll("\\", "/");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    !normalized.endsWith(".md")
  ) {
    throw new ForbiddenPathError("Wiki key must be a markdown path under wiki/");
  }
  return normalized;
}

export function normalizeWikiDirectoryPath(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.startsWith("/") || path.isAbsolute(decoded)) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  if (decoded.includes("\\")) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  const rawSegments = decoded.split("/").filter(Boolean);
  if (
    rawSegments.length === 0 ||
    rawSegments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  const normalized = path.posix.normalize(decoded).replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))
  ) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  return segments.join("/");
}

function relPathForKey(key: string): string {
  return path.posix.join("wiki", normalizeWikiKey(key));
}

function relPathForDirectory(directoryPath: string): string {
  return path.posix.join("wiki", normalizeWikiDirectoryPath(directoryPath));
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

async function wikiExists(projectRoot: string, key: string): Promise<boolean> {
  try {
    await stat(await assertReadable(projectRoot, relPathForKey(key)));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function safeVersionId(value: string): string {
  if (!/^[0-9TZ]+-[a-f0-9]{8,16}$/.test(value)) {
    throw new WikiVersionError("WIKI_VERSION_INVALID", "版本记录格式不合法。");
  }
  return value;
}

function safeVersionOperation(value: string): WikiVersionOperation {
  if (!WIKI_VERSION_OPERATIONS.has(value as WikiVersionOperation)) {
    throw new WikiVersionError("WIKI_VERSION_INVALID", "版本记录格式不合法。");
  }
  return value as WikiVersionOperation;
}

export function wikiDocumentHash(key: string): string {
  return createHash("sha256").update(normalizeWikiKey(key)).digest("hex").slice(0, 16);
}

export function wikiContentHash(markdown: string): string {
  return `sha256:${createHash("sha256").update(markdown).digest("hex")}`;
}

function versionTimestamp(value: Date = new Date()): string {
  return value.toISOString().replace(/[-:.]/g, "");
}

function createVersionId(markdown: string, operation: WikiVersionOperation, at: string): string {
  const shortHash = createHash("sha256")
    .update(`${markdown}\n${operation}\n${at}\n${Math.random()}`)
    .digest("hex")
    .slice(0, 8);
  return `${versionTimestamp(new Date(at))}-${shortHash}`;
}

function wikiVersionSnapshotPath(key: string, versionId: string): string {
  return path.posix.join(
    WIKI_HISTORY_SNAPSHOT_ROOT,
    wikiDocumentHash(key),
    `${safeVersionId(versionId)}.md`
  );
}

function versionTitle(markdown: string, key: string): string {
  const parsed = matter(markdown);
  return uploadTitle(markdown, key, frontmatterFromData(parsed.data));
}

function versionSummary(markdown: string): string | undefined {
  const parsed = matter(markdown);
  const frontmatter = frontmatterFromData(parsed.data);
  return frontmatter.summary;
}

async function readWikiHistoryIndex(projectRoot: string): Promise<WikiHistoryIndex> {
  try {
    const raw = await readFile(await assertReadable(projectRoot, WIKI_HISTORY_INDEX_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<WikiHistoryIndex>;
    if (parsed.schemaVersion !== 1 || !parsed.documents || typeof parsed.documents !== "object") {
      throw new WikiVersionError("WIKI_VERSION_INVALID", "版本记录格式不合法。");
    }
    const documents: Record<string, WikiHistoryDocument> = {};
    for (const [rawKey, rawDocument] of Object.entries(parsed.documents)) {
      const key = normalizeWikiKey(rawKey);
      if (!rawDocument || typeof rawDocument !== "object" || !Array.isArray(rawDocument.versions)) {
        continue;
      }
      const documentSource = rawDocument as Partial<WikiHistoryDocument>;
      const versions = rawDocument.versions.flatMap((rawVersion) => {
        if (!rawVersion || typeof rawVersion !== "object") return [];
        const source = rawVersion as Partial<WikiVersionMetadataEntry>;
        if (
          typeof source.versionId !== "string" ||
          typeof source.createdAt !== "string" ||
          typeof source.operation !== "string" ||
          typeof source.contentHash !== "string" ||
          typeof source.snapshotPath !== "string"
        ) {
          return [];
        }
        const versionId = safeVersionId(source.versionId);
        return [{
          versionId,
          key,
          createdAt: source.createdAt,
          operation: safeVersionOperation(source.operation),
          title: source.title,
          summary: source.summary,
          sourceFileName: source.sourceFileName,
          previousKey: source.previousKey,
          restoredFromVersionId: source.restoredFromVersionId,
          contentHash: source.contentHash,
          snapshotPath: wikiVersionSnapshotPath(key, versionId)
        }];
      });
      documents[key] = {
        key,
        createdAt: typeof documentSource.createdAt === "string" ? documentSource.createdAt : new Date(0).toISOString(),
        updatedAt: typeof documentSource.updatedAt === "string" ? documentSource.updatedAt : new Date(0).toISOString(),
        currentVersionId: typeof documentSource.currentVersionId === "string"
          ? safeVersionId(documentSource.currentVersionId)
          : versions.at(-1)?.versionId,
        versions
      };
    }
    return { schemaVersion: 1, documents };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, documents: {} };
    }
    if (error instanceof WikiVersionError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new WikiVersionError("WIKI_VERSION_INVALID", "版本记录格式不合法。");
    }
    throw error;
  }
}

async function writeWikiHistoryIndex(projectRoot: string, index: WikiHistoryIndex): Promise<void> {
  const normalized: WikiHistoryIndex = { schemaVersion: 1, documents: {} };
  for (const [rawKey, documentSource] of Object.entries(index.documents)) {
    const key = normalizeWikiKey(rawKey);
    normalized.documents[key] = {
      ...documentSource,
      key,
      versions: [...documentSource.versions]
    };
  }
  await safeWrite(projectRoot, WIKI_HISTORY_INDEX_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
}

function publicVersionSummary(version: WikiVersionMetadataEntry): WikiVersionSummary {
  return {
    versionId: version.versionId,
    key: version.key,
    createdAt: version.createdAt,
    operation: version.operation,
    title: version.title,
    summary: version.summary,
    sourceFileName: version.sourceFileName,
    previousKey: version.previousKey,
    restoredFromVersionId: version.restoredFromVersionId,
    contentHash: version.contentHash
  };
}

export async function createWikiVersionSnapshot(
  projectRoot: string,
  key: string,
  markdown: string,
  metadata: {
    operation: WikiVersionOperation;
    sourceFileName?: string;
    previousKey?: string;
    restoredFromVersionId?: string;
    force?: boolean;
  }
): Promise<WikiVersionSummary | null> {
  const normalized = normalizeWikiKey(key);
  const index = await readWikiHistoryIndex(projectRoot);
  const existing = index.documents[normalized];
  const contentHash = wikiContentHash(markdown);
  const latest = existing?.versions.at(-1);
  if (!metadata.force && latest?.contentHash === contentHash) {
    return null;
  }
  const createdAt = new Date().toISOString();
  const versionId = createVersionId(markdown, metadata.operation, createdAt);
  const snapshotPath = wikiVersionSnapshotPath(normalized, versionId);
  const version: WikiVersionMetadataEntry = {
    versionId,
    key: normalized,
    createdAt,
    operation: metadata.operation,
    title: versionTitle(markdown, normalized),
    summary: versionSummary(markdown),
    sourceFileName: metadata.sourceFileName,
    previousKey: metadata.previousKey,
    restoredFromVersionId: metadata.restoredFromVersionId,
    contentHash,
    snapshotPath
  };
  await safeWrite(projectRoot, snapshotPath, markdown);
  index.documents[normalized] = {
    key: normalized,
    createdAt: existing?.createdAt ?? createdAt,
    updatedAt: createdAt,
    currentVersionId: versionId,
    versions: [...(existing?.versions ?? []), version]
  };
  await pruneWikiVersions(projectRoot, index, normalized);
  await writeWikiHistoryIndex(projectRoot, index);
  return publicVersionSummary(version);
}

async function ensureWikiBaselineVersion(
  projectRoot: string,
  key: string,
  markdown: string
): Promise<void> {
  const normalized = normalizeWikiKey(key);
  const index = await readWikiHistoryIndex(projectRoot);
  if (index.documents[normalized]?.versions.length) {
    return;
  }
  await createWikiVersionSnapshot(projectRoot, normalized, markdown, {
    operation: "create",
    force: true
  });
}

async function pruneWikiVersions(
  projectRoot: string,
  index: WikiHistoryIndex,
  key: string
): Promise<void> {
  const document = index.documents[key];
  if (!document || document.versions.length <= WIKI_VERSION_RETENTION_LIMIT) {
    return;
  }
  const toRemove = document.versions.slice(0, Math.max(0, document.versions.length - WIKI_VERSION_RETENTION_LIMIT));
  const keep = document.versions.slice(-WIKI_VERSION_RETENTION_LIMIT);
  for (const version of toRemove) {
    await safeRemove(projectRoot, version.snapshotPath);
  }
  document.versions = keep;
}

async function readWikiDirectoryMetadata(projectRoot: string): Promise<WikiDirectoryMetadata> {
  try {
    const raw = await readFile(await assertReadable(projectRoot, WIKI_DIRECTORY_METADATA_PATH), "utf8");
    const parsed = JSON.parse(raw) as Partial<WikiDirectoryMetadata>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.directories)) {
      throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "Wiki 目录元数据格式不合法。");
    }
    const deduped = new Map<string, WikiDirectoryMetadataEntry>();
    for (const item of parsed.directories) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const source = item as Partial<WikiDirectoryMetadataEntry>;
      if (typeof source.path !== "string") {
        continue;
      }
      const normalized = normalizeWikiDirectoryPath(source.path);
      deduped.set(normalized, {
        path: normalized,
        createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date(0).toISOString(),
        updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date(0).toISOString()
      });
    }
    return {
      schemaVersion: 1,
      directories: Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path))
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { schemaVersion: 1, directories: [] };
    }
    if (error instanceof WikiDirectoryError) {
      throw error;
    }
    if (error instanceof SyntaxError) {
      throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "Wiki 目录元数据格式不合法。");
    }
    throw error;
  }
}

async function writeWikiDirectoryMetadata(
  projectRoot: string,
  metadata: WikiDirectoryMetadata
): Promise<void> {
  const deduped = new Map<string, WikiDirectoryMetadataEntry>();
  for (const item of metadata.directories) {
    const normalized = normalizeWikiDirectoryPath(item.path);
    deduped.set(normalized, {
      ...item,
      path: normalized
    });
  }
  const next: WikiDirectoryMetadata = {
    schemaVersion: 1,
    directories: Array.from(deduped.values()).sort((a, b) => a.path.localeCompare(b.path))
  };
  await safeWrite(projectRoot, WIKI_DIRECTORY_METADATA_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

function directoryAncestors(directoryPath: string): string[] {
  const segments = normalizeWikiDirectoryPath(directoryPath).split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function deriveDirectoriesFromPages(pages: WikiSummary[]): Set<string> {
  const paths = new Set<string>();
  for (const page of pages) {
    const segments = page.key.split("/").filter(Boolean);
    const directorySegments = segments.length > 1 ? segments.slice(0, -1) : [];
    for (let index = 1; index <= directorySegments.length; index += 1) {
      paths.add(directorySegments.slice(0, index).join("/"));
    }
  }
  return paths;
}

function countDirectoryDocuments(directoryPath: string, pages: WikiSummary[]): number {
  const prefix = `${directoryPath}/`;
  return pages.filter((page) => page.key.startsWith(prefix)).length;
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

export async function listWikiDirectories(projectRoot: string): Promise<WikiDirectorySummary[]> {
  const pages = await listWiki(projectRoot);
  const metadata = await readWikiDirectoryMetadata(projectRoot);
  const explicit = new Map(metadata.directories.map((item) => [item.path, item]));
  const paths = deriveDirectoriesFromPages(pages);
  for (const entry of metadata.directories) {
    for (const ancestor of directoryAncestors(entry.path)) {
      paths.add(ancestor);
    }
  }
  if (paths.size === 0) {
    paths.add("global");
  }
  return Array.from(paths)
    .sort((a, b) => a.localeCompare(b))
    .map((directoryPath) => {
      const explicitEntry = explicit.get(directoryPath);
      const documentCount = countDirectoryDocuments(directoryPath, pages);
      const name = directoryPath.split("/").filter(Boolean).pop() ?? directoryPath;
      return {
        path: directoryPath,
        name,
        documentCount,
        explicit: Boolean(explicitEntry),
        empty: documentCount === 0,
        createdAt: explicitEntry?.createdAt,
        updatedAt: explicitEntry?.updatedAt
      };
    });
}

export async function createWikiDirectory(
  projectRoot: string,
  input: WikiDirectoryCreateInput
): Promise<WikiDirectoryCreateResult> {
  // M56: allow callers to send either `{ path: "ops" }` for a top-level
  // directory or `{ parent: "", name: "ops" }`. An empty / whitespace
  // `parent` is treated as the Wiki root so the frontend can stop
  // silently falling back to `global` whenever the user clears the
  // parent input.
  const trimmedPath = input.path?.trim();
  const trimmedParent = input.parent?.trim() ?? "";
  const trimmedName = input.name?.trim() ?? "";
  const rawPath = trimmedPath
    ? trimmedPath
    : [trimmedParent, trimmedName].filter((segment) => Boolean(segment)).join("/");
  if (!rawPath) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  const directoryPath = normalizeWikiDirectoryPath(rawPath);
  const relPath = relPathForDirectory(directoryPath);
  try {
    const existing = await stat(await assertReadable(projectRoot, relPath));
    if (!existing.isDirectory()) {
      throw new WikiDirectoryError("WIKI_DIRECTORY_CONFLICT", "目标路径已被文件占用。", 409);
    }
  } catch (error) {
    if (error instanceof WikiDirectoryError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await safeMkdir(projectRoot, relPath);

  const metadata = await readWikiDirectoryMetadata(projectRoot);
  const existing = new Map(metadata.directories.map((item) => [item.path, item]));
  const requestedAlreadyExists = existing.has(directoryPath);
  const now = new Date().toISOString();
  for (const ancestor of directoryAncestors(directoryPath)) {
    if (!existing.has(ancestor)) {
      existing.set(ancestor, {
        path: ancestor,
        createdAt: now,
        updatedAt: now
      });
    }
  }
  await writeWikiDirectoryMetadata(projectRoot, {
    schemaVersion: 1,
    directories: Array.from(existing.values())
  });

  const directories = await listWikiDirectories(projectRoot);
  const directory = directories.find((item) => item.path === directoryPath);
  if (!directory) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录路径不合法。");
  }
  return {
    directory,
    created: !requestedAlreadyExists,
    filePath: `${relPath}/`
  };
}

/**
 * Remove an empty Wiki directory and prune its metadata entry.
 *
 * M56 UX-WIKI-010: deletions are deliberately conservative. We refuse
 * symlinks / path traversal (delegated to `safeRemoveDirectory`),
 * require the directory to exist, and translate `DirectoryNotEmptyError`
 * from the filesystem helper into `WIKI_DIRECTORY_NOT_EMPTY` so the
 * caller can prompt the user to clear the contents first.
 */
export async function deleteWikiDirectory(
  projectRoot: string,
  directoryPath: string
): Promise<WikiDirectoryDeleteResult> {
  const normalizedPath = normalizeWikiDirectoryPath(directoryPath);
  const relPath = relPathForDirectory(normalizedPath);

  try {
    await stat(await assertReadable(projectRoot, relPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new WikiDirectoryError(
        "WIKI_DIRECTORY_NOT_FOUND",
        "目标目录不存在。",
        404
      );
    }
    throw error;
  }

  try {
    await safeRemoveDirectory(projectRoot, relPath);
  } catch (error) {
    if (error instanceof DirectoryNotEmptyError) {
      throw new WikiDirectoryError(
        "WIKI_DIRECTORY_NOT_EMPTY",
        "该目录下仍有 Markdown 文档或子目录，请先移动或删除内容。",
        409
      );
    }
    throw error;
  }

  const metadata = await readWikiDirectoryMetadata(projectRoot);
  const filtered = metadata.directories.filter((entry) => entry.path !== normalizedPath);
  if (filtered.length !== metadata.directories.length) {
    await writeWikiDirectoryMetadata(projectRoot, {
      schemaVersion: 1,
      directories: filtered
    });
  }

  return {
    path: normalizedPath,
    deleted: true,
    filePath: `${relPath}/`
  };
}

export async function readWiki(projectRoot: string, key: string): Promise<WikiPage> {
  const normalized = normalizeWikiKey(key);
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
  const normalized = normalizeWikiKey(key);
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
  const normalized = normalizeWikiKey(key);
  const existed = await wikiExists(projectRoot, normalized);
  const oldText = await readExisting(projectRoot, normalized);
  const preview = await previewWikiWrite(projectRoot, key, input);
  await safeWrite(projectRoot, preview.filePath, preview.proposedMarkdown);
  if (existed) {
    await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
  }
  await createWikiVersionSnapshot(projectRoot, normalized, preview.proposedMarkdown, {
    operation: existed ? "edit_save" : "create"
  });
  return preview;
}

function validateUploadMarkdown(markdown: string): void {
  const size = Buffer.byteLength(markdown, "utf8");
  if (size > MAX_MARKDOWN_UPLOAD_BYTES) {
    const err = new ForbiddenPathError("Markdown file exceeds the 1MB upload limit");
    err.statusCode = 400;
    err.code = "WIKI_MARKDOWN_TOO_LARGE";
    throw err;
  }
}

function uploadTitle(markdown: string, key: string, frontmatter: WikiFrontmatter): string {
  if (frontmatter.summary?.trim()) {
    return frontmatter.summary.trim();
  }
  const heading = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  if (heading) {
    const title = heading.replace(/^#\s+/, "").trim();
    if (title) return title;
  }
  return path.posix.basename(key).replace(/\.md$/, "");
}

export async function previewWikiUpload(projectRoot: string, input: WikiUploadInput): Promise<WikiUploadPreview> {
  const normalized = normalizeWikiKey(input.key);
  validateUploadMarkdown(input.markdown);
  const exists = await wikiExists(projectRoot, normalized);
  const oldText = await readExisting(projectRoot, normalized);
  const parsed = matter(input.markdown);
  const frontmatter = frontmatterFromData(parsed.data);
  const filePath = relPathForKey(normalized);
  const explicitMode = input.mode ?? (input.overwrite ? "replace" : "create");
  const sourceFileName = deriveUploadSourceName(input.sourceFileName, normalized);
  const targetKey = normalized;
  const targetTitle = uploadTitle(input.markdown, normalized, frontmatter);
  const existingTitle = exists ? uploadTitle(oldText, normalized, frontmatterFromData(matter(oldText).data)) : null;
  const warnings: string[] = [];
  if (explicitMode === "create" && exists) {
    warnings.push("目标文档已存在，确认后将按覆盖处理。");
  }
  if (explicitMode === "replace" && !exists) {
    warnings.push("覆盖模式下目标文档不存在，将改为新建。");
  }
  if (!parsed.content.trim()) {
    warnings.push("Markdown 正文为空。");
  }
  if (sourceFileName && path.posix.basename(targetKey) !== sourceFileName) {
    warnings.push(
      `本地文件名 ${sourceFileName} 与目标路径文件名 ${path.posix.basename(targetKey)} 不一致，将按目标 Wiki 路径保存。`
    );
  }
  return {
    key: normalized,
    filePath,
    diff: previewDiff(oldText, input.markdown, filePath),
    proposedMarkdown: input.markdown,
    exists,
    mode: exists ? "replace" : "create",
    sourceFileName,
    targetKey,
    existingTitle,
    targetTitle,
    title: targetTitle,
    slRefs: frontmatter.sl_refs ?? [],
    warnings
  };
}

export async function commitWikiUpload(projectRoot: string, input: WikiUploadInput): Promise<WikiUploadPreview> {
  const normalized = normalizeWikiKey(input.key);
  const existed = await wikiExists(projectRoot, normalized);
  const oldText = await readExisting(projectRoot, normalized);
  const preview = await previewWikiUpload(projectRoot, input);
  await safeWrite(projectRoot, preview.filePath, preview.proposedMarkdown);
  if (existed) {
    await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
  }
  await createWikiVersionSnapshot(projectRoot, normalized, preview.proposedMarkdown, {
    operation: existed ? "upload_replace" : "upload_create",
    sourceFileName: input.sourceFileName
  });
  return preview;
}

function deriveUploadSourceName(sourceFileName: string | undefined, targetKey: string): string {
  if (sourceFileName && sourceFileName.trim()) {
    return sourceFileName.split(/[\\/]/).filter(Boolean).pop() ?? sourceFileName;
  }
  return path.posix.basename(targetKey);
}

function versionNotFound(): WikiVersionError {
  return new WikiVersionError("WIKI_VERSION_NOT_FOUND", "未找到该历史版本。", 404);
}

async function findWikiVersion(
  projectRoot: string,
  key: string,
  versionId: string
): Promise<{ index: WikiHistoryIndex; document: WikiHistoryDocument; version: WikiVersionMetadataEntry }> {
  const normalized = normalizeWikiKey(key);
  const safeId = safeVersionId(versionId);
  const index = await readWikiHistoryIndex(projectRoot);
  const document = index.documents[normalized];
  const version = document?.versions.find((item) => item.versionId === safeId);
  if (!document || !version) {
    throw versionNotFound();
  }
  return { index, document, version };
}

export async function listWikiVersions(
  projectRoot: string,
  key: string
): Promise<WikiVersionListResponse> {
  const normalized = normalizeWikiKey(key);
  const index = await readWikiHistoryIndex(projectRoot);
  const document = index.documents[normalized];
  return {
    key: normalized,
    retentionLimit: WIKI_VERSION_RETENTION_LIMIT,
    versions: [...(document?.versions ?? [])]
      .reverse()
      .map(publicVersionSummary)
  };
}

export async function readWikiVersion(
  projectRoot: string,
  key: string,
  versionId: string
): Promise<WikiVersionDetail> {
  const { version } = await findWikiVersion(projectRoot, key, versionId);
  const rawMarkdown = await readFile(await assertReadable(projectRoot, version.snapshotPath), "utf8");
  const current = await readExisting(projectRoot, version.key);
  return {
    ...publicVersionSummary(version),
    rawMarkdown,
    diffFromCurrent: previewDiff(current, rawMarkdown, relPathForKey(version.key))
  };
}

export async function previewWikiVersionRestore(
  projectRoot: string,
  key: string,
  versionId: string
): Promise<WikiVersionRestorePreview> {
  const detail = await readWikiVersion(projectRoot, key, versionId);
  return {
    key: detail.key,
    versionId: detail.versionId,
    targetTitle: versionTitle(detail.rawMarkdown, detail.key),
    diff: detail.diffFromCurrent
  };
}

export async function restoreWikiVersion(
  projectRoot: string,
  key: string,
  versionId: string
): Promise<WikiVersionRestoreResult> {
  const detail = await readWikiVersion(projectRoot, key, versionId);
  const filePath = relPathForKey(detail.key);
  await safeWrite(projectRoot, filePath, detail.rawMarkdown);
  const restored = await createWikiVersionSnapshot(projectRoot, detail.key, detail.rawMarkdown, {
    operation: "restore",
    restoredFromVersionId: detail.versionId,
    force: true
  });
  if (!restored) {
    throw new WikiVersionError("WIKI_VERSION_INVALID", "版本记录格式不合法。");
  }
  return {
    key: detail.key,
    restoredFromVersionId: detail.versionId,
    newVersionId: restored.versionId,
    filePath
  };
}

/**
 * Errors raised by `previewWikiMove` / `moveWiki`.
 *
 * The error codes map onto Fastify's envelope directly so the frontend
 * can show actionable copy without re-deriving the cause.
 */
export class WikiMoveError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WikiMoveError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class WikiNotFoundError extends Error {
  code = "WIKI_NOT_FOUND";
  statusCode = 404;

  constructor(message: string) {
    super(message);
    this.name = "WikiNotFoundError";
  }
}

function deriveMoveTarget(sourceKey: string, targetDirectory: string): string {
  const basename = path.posix.basename(sourceKey);
  if (!basename.endsWith(".md")) {
    throw new WikiMoveError("WIKI_MOVE_INVALID", "只能移动 Markdown 文档。", 400);
  }
  const normalizedDirectory = normalizeWikiDirectoryPath(targetDirectory);
  return normalizedDirectory ? path.posix.join(normalizedDirectory, basename) : basename;
}

function assertWikiSourceWritable(projectRoot: string, sourceKey: string): Promise<string> {
  return assertReadable(projectRoot, relPathForKey(sourceKey));
}

export async function previewWikiMove(
  projectRoot: string,
  sourceKey: string,
  targetDirectory: string
): Promise<WikiMovePreview> {
  const normalizedSource = normalizeWikiKey(sourceKey);
  const targetKey = deriveMoveTarget(normalizedSource, targetDirectory);
  const filePath = relPathForKey(targetKey);
  const sourceExists = await wikiExists(projectRoot, normalizedSource);
  if (!sourceExists) {
    throw new WikiNotFoundError("源 Wiki 文档不存在。");
  }
  const targetExists = await wikiExists(projectRoot, targetKey);
  const oldText = await readExisting(projectRoot, normalizedSource);
  const parsed = matter(oldText);
  const frontmatter = frontmatterFromData(parsed.data);
  const targetTitle = uploadTitle(oldText, normalizedSource, frontmatter);
  const targetDirectoryNormalized = normalizeWikiDirectoryPath(targetDirectory);
  const warnings: string[] = [];
  if (targetExists) {
    warnings.push("目标 Wiki 路径已存在，请先移动或重命名现有文档。");
  }
  if (path.posix.basename(normalizedSource) !== path.posix.basename(targetKey)) {
    warnings.push("目标目录中已存在同名文档，将按新文件名保存。");
  }
  return {
    key: targetKey,
    filePath,
    diff: previewDiff("", oldText, filePath),
    proposedMarkdown: oldText,
    sourceKey: normalizedSource,
    targetKey,
    targetDirectory: targetDirectoryNormalized,
    exists: targetExists,
    title: targetTitle,
    basenameChanged: path.posix.basename(normalizedSource) !== path.posix.basename(targetKey),
    warnings
  };
}

export async function moveWiki(
  projectRoot: string,
  sourceKey: string,
  targetDirectory: string
): Promise<WikiMoveResult> {
  const normalizedSource = normalizeWikiKey(sourceKey);
  const targetKey = deriveMoveTarget(normalizedSource, targetDirectory);
  const sourceRelPath = relPathForKey(normalizedSource);
  const targetRelPath = relPathForKey(targetKey);
  const sourceExists = await wikiExists(projectRoot, normalizedSource);
  if (!sourceExists) {
    throw new WikiNotFoundError("源 Wiki 文档不存在。");
  }
  if (normalizedSource === targetKey) {
    throw new WikiMoveError("WIKI_MOVE_INVALID", "源目录与目标目录相同，无需移动。", 400);
  }
  const targetExists = await wikiExists(projectRoot, targetKey);
  if (targetExists) {
    throw new WikiMoveError(
      "WIKI_MOVE_TARGET_EXISTS",
      "目标 Wiki 路径已存在，请先移动或重命名现有文档。",
      409
    );
  }
  // Materialise the destination directory so the file write below has a
  // real parent. We only ever write under wiki/<...>; safeMkdir is
  // bounded by the allowlist in fs-safe.
  const targetDirectoryNormalized = normalizeWikiDirectoryPath(targetDirectory);
  await safeMkdir(projectRoot, relPathForDirectory(targetDirectoryNormalized));

  const oldText = await readExisting(projectRoot, normalizedSource);
  await assertWikiSourceWritable(projectRoot, normalizedSource);
  await safeWrite(projectRoot, targetRelPath, oldText);
  await safeRemove(projectRoot, sourceRelPath);

  // Carry the version history forward so the new key inherits the
  // existing snapshots. We rewrite the snapshots so future prune runs
  // do not accidentally remove them under the old document hash.
  const index = await readWikiHistoryIndex(projectRoot);
  const sourceDocument = index.documents[normalizedSource];
  const now = new Date().toISOString();
  if (sourceDocument) {
    const carriedVersions = sourceDocument.versions.map((version) => ({
      ...version,
      key: targetKey,
      snapshotPath: wikiVersionSnapshotPath(targetKey, version.versionId)
    }));
    // Move snapshot files into the new document's hash directory.
    for (const version of sourceDocument.versions) {
      const oldSnapshot = await assertReadable(projectRoot, version.snapshotPath);
      const markdown = await readFile(oldSnapshot, "utf8");
      const newSnapshotPath = wikiVersionSnapshotPath(targetKey, version.versionId);
      await safeWrite(projectRoot, newSnapshotPath, markdown);
      await safeRemove(projectRoot, version.snapshotPath);
    }
    index.documents[targetKey] = {
      key: targetKey,
      createdAt: sourceDocument.createdAt,
      updatedAt: now,
      currentVersionId: sourceDocument.currentVersionId,
      versions: carriedVersions
    };
    delete index.documents[normalizedSource];
    await writeWikiHistoryIndex(projectRoot, index);
  }

  // Ensure the directory metadata reflects the destination, then drop
  // any lingering explicit entry for the source directory if the
  // document was the only Markdown in it.
  const metadata = await readWikiDirectoryMetadata(projectRoot);
  const existingDirectoryEntries = new Map(metadata.directories.map((item) => [item.path, item]));
  for (const ancestor of directoryAncestors(targetDirectoryNormalized)) {
    if (!existingDirectoryEntries.has(ancestor)) {
      existingDirectoryEntries.set(ancestor, {
        path: ancestor,
        createdAt: now,
        updatedAt: now
      });
    }
  }
  await writeWikiDirectoryMetadata(projectRoot, {
    schemaVersion: 1,
    directories: Array.from(existingDirectoryEntries.values())
  });

  const snapshot = await createWikiVersionSnapshot(projectRoot, targetKey, oldText, {
    operation: "move",
    previousKey: normalizedSource,
    force: true
  });
  if (!snapshot) {
    throw new WikiMoveError("WIKI_MOVE_INVALID", "未能写入移动后的版本记录。", 500);
  }

  return {
    sourceKey: normalizedSource,
    key: targetKey,
    targetDirectory: targetDirectoryNormalized,
    previousKey: normalizedSource,
    newVersionId: snapshot.versionId,
    filePath: targetRelPath
  };
}
