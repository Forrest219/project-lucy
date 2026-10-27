import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  assertMarkdownFrontmatterEngine,
  parseMarkdownFrontmatter,
  stringifyMarkdownFrontmatter
} from "./markdown-frontmatter";
import { assertWritableAcl, parseObjectAcl, type ObjectAcl } from "./proxy/context-acl";
import { previewDiff } from "./diff";
import {
  assertReadable,
  DirectoryNotEmptyError,
  ForbiddenPathError,
  safeMkdir,
  safeRemove,
  safeRemoveDirectory,
  safeRenameDirectory,
  safeWrite
} from "./fs-safe";
import { auditedRemoveFile, auditedWriteFile } from "./admin/config-audit-write.js";
import { auditActorFields, systemActor, type TrustedActor } from "./security/request-actor.js";
import { loadContentPaths } from "./paths";
import { withWikiWriteQueue } from "./wiki-write-queue.js";
import { wikiContentHash } from "./wiki-hash.js";
import { normalizeWikiKey } from "./wiki-key.js";
import {
  applyRawAllowedRoles,
  assertWikiKeyNotHeld,
  computeWikiAccessDigest,
  mutateWikiAccessUnlocked,
  readAclDeclaration,
  resolveUploadAcl,
  suggestUploadAccessSelection,
  WikiAccessError,
  type RawAclDeclaration,
  type WikiUploadAccessSelection
} from "./wiki-access-operation.js";
import {
  buildWikiAccessListEntry,
  canonicalAclKey,
  classifyAccessDirection,
  loadWikiAccessConfigSnapshot,
  resolveWikiAccessEffects,
  type AccessDirection,
  type WikiAccessRoleEffect
} from "./wiki-access-effects.js";
import { readAllWikiAccessPendingChanges, readWikiAccessPendingChange } from "./wiki-access-holds.js";

export type WikiFrontmatter = {
  summary?: string;
  tags?: string[];
  sl_refs?: string[];
  refs?: string[];
  usage_mode?: string;
  /** Spec §4.1 object ACL: the only Wiki authorization source (`sl_refs` / `visibility` never grant). */
  allowed_roles?: string[];
};

export type WikiPage = {
  key: string;
  frontmatter: WikiFrontmatter;
  content: string;
  rawMarkdown: string;
  /** `sha256:<hex>` of the exact file bytes; send back as `expected_version` when saving. */
  file_version: string;
  /** Canonical ACL state so the editor can distinguish "no one" from a corrupt declaration. */
  acl: ObjectAcl;
};

export type WikiSummary = {
  key: string;
  summary?: string;
  tags: string[];
  slRefs: string[];
  /**
   * Spec 193 §6.1 — the authorization status of this row. It comes from the
   * ONE aggregate list response; the list never calls an access API per row.
   */
  access: WikiAccessListEntry;
};

/** The aggregate list entry — no Role effect detail, no Agent id list. */
export type WikiAccessListEntry = {
  file_version: string;
  acl: ObjectAcl;
  declared_role_count: number | null;
  declared_without_discover: number;
  declared_without_read: number;
  pending_change?: { operation_id: string; state: "pending" | "needs_review" };
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

export type WikiDocumentDeleteResult = {
  key: string;
  deleted: boolean;
  filePath: string;
};

export type WikiDirectoryRenameInput = {
  sourcePath: string;
  newName: string;
  /**
   * Spec 193 §8.1 — the per-document baselines captured by the preview.
   * The commit re-checks every one of them inside the write queue.
   */
  expected_versions?: Record<string, string>;
  /** The digest returned by the preview; a stale digest renames nothing. */
  preview_digest?: string;
};

export type WikiDirectoryRenamePreview = {
  sourcePath: string;
  targetPath: string;
  newName: string;
  documentCount: number;
  directoryCount: number;
  documents: Array<{ sourceKey: string; targetKey: string; fileVersion: string }>;
  directories: Array<{ sourcePath: string; targetPath: string }>;
  conflicts: string[];
  warnings: string[];
  /** Binds the source, the target and every per-document baseline. */
  preview_digest: string;
};

export type WikiDirectoryRenameResult = {
  sourcePath: string;
  targetPath: string;
  renamedDocuments: number;
  renamedDirectories: number;
  writtenFiles: string[];
};

export type WikiWriteInput = {
  frontmatter?: WikiFrontmatter;
  content?: string;
  /** Required (428) when the page exists; stale values are rejected (409). */
  expected_version?: string;
};

export type WikiPreview = {
  key: string;
  filePath: string;
  /** `file_version` of the page as currently stored, or `null` when it does not exist yet. */
  currentFileVersion?: string | null;
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
  /** Required (428) when the target page already exists; stale values are rejected (409). */
  expected_version?: string;
  /**
   * Spec 193 §5.4 — the explicit authorization selection.
   *
   * A commit WITHOUT it is refused (`wiki_upload_access_required`); the
   * server never infers an authorization from the uploaded frontmatter.
   */
  access?: WikiUploadAccessSelection;
  /** Required when the final authorization is `[]` (无人可见). */
  confirmed_empty?: boolean;
  /** Required when the final authorization is `["*"]` (所有角色可见). */
  confirmed_all?: boolean;
  /** The digest returned by the preview; a stale digest writes nothing (409). */
  preview_digest?: string;
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
  /** Spec 193 §5.1 — the authorization section, rendered before the diff. */
  access: WikiUploadAccessPreview;
};

/**
 * Spec 193 §5.4 — the authorization facts the upload preflight reports.
 */
export type WikiUploadAccessPreview = {
  /** The persisted authorization, or `null` when the target does not exist. */
  current_acl: ObjectAcl | null;
  /** The declaration inside the uploaded file. */
  uploaded_acl: ObjectAcl;
  /** The authorization that will be written when the current selection commits. */
  final_acl: ObjectAcl;
  /** The selection the server suggests for the current target state. */
  suggested_selection: WikiUploadAccessSelection;
  direction: AccessDirection;
  role_effects: WikiAccessRoleEffect[];
  declared_role_count: number | null;
  declared_without_discover: number;
  declared_without_read: number;
  role_channel_version: string;
  /** Binds the target key, mode, content hash, version, selection and Role version. */
  preview_digest: string;
  /** Blocking problems — a commit is refused while one of them is present. */
  issues: Array<{ code: string; message: string; blocking: boolean }>;
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
  | "delete"
  /** Spec 193 §6.2 — an authorization-only change written by the access drawer. */
  | "access_update";

const WIKI_VERSION_OPERATIONS = new Set<WikiVersionOperation>([
  "create",
  "edit_save",
  "upload_create",
  "upload_replace",
  "restore",
  "move",
  "rename",
  "delete",
  "access_update"
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

export class WikiConcurrencyError extends Error {
  code: string;
  statusCode: number;

  constructor(code: "wiki_expected_version_required" | "wiki_write_conflict", statusCode: 409 | 428) {
    super(code);
    this.name = "WikiConcurrencyError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

/** Spec §4.3 — content and ACL saves share one optimistic-concurrency token. */
function assertExpectedWikiVersion(existed: boolean, currentText: string, expected: string | undefined): void {
  if (!existed) return;
  if (!expected?.trim()) throw new WikiConcurrencyError("wiki_expected_version_required", 428);
  if (expected.trim() !== wikiContentHash(currentText)) throw new WikiConcurrencyError("wiki_write_conflict", 409);
}

export { normalizeWikiKey } from "./wiki-key.js";

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
    usage_mode: typeof data.usage_mode === "string" ? data.usage_mode : undefined,
    // Only a well-formed declaration is echoed back; absent / corrupt stays absent so an editor
    // round-trip can never turn "not chosen yet" into an explicit empty ACL.
    allowed_roles: Array.isArray(data.allowed_roles) && data.allowed_roles.every((item) => typeof item === "string")
      ? (data.allowed_roles as string[])
      : undefined
  };
}

function aclOf(data: Record<string, unknown>): ObjectAcl {
  return parseObjectAcl(data.allowed_roles, Object.prototype.hasOwnProperty.call(data, "allowed_roles"));
}

/**
 * Replace-style writes (upload replace, version restore) must not silently change who can
 * read the page: unless the caller supplies a valid new `allowed_roles`, the current ACL
 * declaration is carried over (and a historical wider ACL is never revived).
 */
function carryCurrentAcl(proposedMarkdown: string, currentText: string, options: { restore?: boolean } = {}): string {
  const proposed = parseMarkdownFrontmatter(proposedMarkdown);
  const proposedDeclares = Object.prototype.hasOwnProperty.call(proposed.data, "allowed_roles");
  if (proposedDeclares && !options.restore) {
    assertWritableAcl(proposed.data.allowed_roles);
    return proposedMarkdown;
  }
  const current = parseMarkdownFrontmatter(currentText);
  const currentDeclares = Object.prototype.hasOwnProperty.call(current.data, "allowed_roles");
  if (!currentDeclares && !proposedDeclares) return proposedMarkdown;
  const data: Record<string, unknown> = { ...proposed.data };
  if (currentDeclares) data.allowed_roles = current.data.allowed_roles;
  else delete data.allowed_roles;
  return stringifyMarkdownFrontmatter(proposed.content, data);
}

function preservedWikiAuth(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const preserved: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(data, "visibility")) preserved.visibility = data.visibility;
  if (Object.prototype.hasOwnProperty.call(data, "allowed_roles")) preserved.allowed_roles = data.allowed_roles;
  return preserved;
}

function serializeWiki(frontmatter: WikiFrontmatter, content: string, preserved: Record<string, unknown> = {}): string {
  const data: Record<string, unknown> = {};
  if (frontmatter.summary) data.summary = frontmatter.summary;
  if (frontmatter.tags?.length) data.tags = frontmatter.tags;
  if (frontmatter.sl_refs?.length) data.sl_refs = frontmatter.sl_refs;
  if (frontmatter.refs?.length) data.refs = frontmatter.refs;
  if (frontmatter.usage_mode) data.usage_mode = frontmatter.usage_mode;
  if (Object.prototype.hasOwnProperty.call(preserved, "visibility")) data.visibility = preserved.visibility;
  if (Object.prototype.hasOwnProperty.call(preserved, "allowed_roles")) data.allowed_roles = preserved.allowed_roles;
  return stringifyMarkdownFrontmatter(content ?? "", data);
}

async function readExisting(projectRoot: string, key: string): Promise<string> {
  try {
    const paths = await loadContentPaths();
    return await readFile(await assertReadable(paths, projectRoot, relPathForKey(key)), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function wikiExists(projectRoot: string, key: string): Promise<boolean> {
  try {
    const paths = await loadContentPaths();
    await stat(await assertReadable(paths, projectRoot, relPathForKey(key)));
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

export { wikiContentHash } from "./wiki-hash.js";

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
  const parsed = parseMarkdownFrontmatter(markdown);
  return uploadTitle(markdown, key, frontmatterFromData(parsed.data));
}

function versionSummary(markdown: string): string | undefined {
  const parsed = parseMarkdownFrontmatter(markdown);
  const frontmatter = frontmatterFromData(parsed.data);
  return frontmatter.summary;
}

async function readWikiHistoryIndex(projectRoot: string): Promise<WikiHistoryIndex> {
  try {
    const paths = await loadContentPaths();
    const raw = await readFile(await assertReadable(paths, projectRoot, WIKI_HISTORY_INDEX_PATH), "utf8");
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
  const paths = await loadContentPaths();
  await safeWrite(paths, projectRoot, WIKI_HISTORY_INDEX_PATH, `${JSON.stringify(normalized, null, 2)}\n`);
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
  await safeWrite((await loadContentPaths()), projectRoot, snapshotPath, markdown);
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
  const paths = await loadContentPaths();
  for (const version of toRemove) {
    await safeRemove(paths, projectRoot, version.snapshotPath);
  }
  document.versions = keep;
}

async function readWikiDirectoryMetadata(projectRoot: string): Promise<WikiDirectoryMetadata> {
  try {
    const paths = await loadContentPaths();
    const raw = await readFile(await assertReadable(paths, projectRoot, WIKI_DIRECTORY_METADATA_PATH), "utf8");
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
  const paths = await loadContentPaths();
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
  await safeWrite(paths, projectRoot, WIKI_DIRECTORY_METADATA_PATH, `${JSON.stringify(next, null, 2)}\n`);
}

function directoryAncestors(directoryPath: string): string[] {
  const segments = normalizeWikiDirectoryPath(directoryPath).split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

function deriveDirectoriesFromPages(pages: Array<{ key: string }>): Set<string> {
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

function countDirectoryDocuments(directoryPath: string, pages: Array<{ key: string }>): number {
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

/** The raw document facts — no authorization projection. */
type WikiSummaryBase = {
  key: string;
  summary?: string;
  tags: string[];
  slRefs: string[];
  file_version: string;
  acl: ObjectAcl;
};

async function readWikiSummaries(projectRoot: string): Promise<WikiSummaryBase[]> {
  const wikiRoot = (await loadContentPaths()).wiki;
  const keys = await walkMarkdown(wikiRoot, "");
  const summaries: WikiSummaryBase[] = [];
  for (const key of keys.sort()) {
    const page = await readWiki(projectRoot, key);
    summaries.push({
      key,
      summary: page.frontmatter.summary,
      tags: page.frontmatter.tags ?? [],
      slRefs: page.frontmatter.sl_refs ?? [],
      file_version: page.file_version,
      acl: page.acl
    });
  }
  return summaries;
}

/**
 * Spec 193 §6.1 — ONE aggregate list response.
 *
 * The Role / Agent configuration is read exactly once per request and every
 * row carries its authorization status. The list never embeds the Markdown
 * body, the full Agent id list or the per-Role effect detail, and the
 * frontend never calls an access API per row.
 */
export async function listWiki(projectRoot: string): Promise<WikiSummary[]> {
  const bases = await readWikiSummaries(projectRoot);
  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
  const pendingChanges = await readAllWikiAccessPendingChanges();
  return bases.map((base) => ({
    key: base.key,
    summary: base.summary,
    tags: base.tags,
    slRefs: base.slRefs,
    access: buildWikiAccessListEntry({
      file_version: base.file_version,
      acl: base.acl,
      snapshot,
      pending_change: pendingChanges.get(base.key)
    })
  }));
}

export async function listWikiDirectories(projectRoot: string): Promise<WikiDirectorySummary[]> {
  const pages = await readWikiSummaries(projectRoot);
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
    const paths = await loadContentPaths();
    const existing = await stat(await assertReadable(paths, projectRoot, relPath));
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

  await safeMkdir((await loadContentPaths()), projectRoot, relPath);

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
  return withWikiWriteQueue(async () => {
    const relPath = relPathForDirectory(normalizedPath);
    const paths = await loadContentPaths();

    try {
      await stat(await assertReadable(paths, projectRoot, relPath));
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
      // The emptiness re-check happens INSIDE the queue, so a document that
      // was written while the dialog was open blocks the delete.
      await safeRemoveDirectory(paths, projectRoot, relPath);
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
  });
}

/**
 * Delete a saved Wiki Markdown document and prune its version history.
 *
 * Spec 118 / UX-WIKI-045: hard delete only (no recycle bin). Config audit
 * records the file removal; version snapshots for this key are removed so
 * orphaned history does not linger under `.lucy-history`.
 */
export async function deleteWiki(
  projectRoot: string,
  key: string,
  actor?: TrustedActor,
  expectedVersion?: string
): Promise<WikiDocumentDeleteResult> {
  const normalized = normalizeWikiKey(key);
  return withWikiWriteQueue(async () => {
    const filePath = relPathForKey(normalized);
    if (!(await wikiExists(projectRoot, normalized))) {
      throw new WikiNotFoundError("Wiki 文档不存在。");
    }
    const currentText = await readExisting(projectRoot, normalized);
    if (!expectedVersion?.trim()) {
      throw new WikiConcurrencyError("wiki_expected_version_required", 428);
    }
    if (expectedVersion.trim() !== wikiContentHash(currentText)) {
      throw new WikiConcurrencyError("wiki_write_conflict", 409);
    }
    await assertWikiKeyNotHeld(normalized);

    await auditedRemoveFile(projectRoot, filePath, {
      enabled: true,
      changeType: "wiki_delete",
      assetKind: "wiki",
      ...auditActorFields(actor),
      source: "wiki_api",
      targetId: normalized,
      operation: "delete"
    });

    const index = await readWikiHistoryIndex(projectRoot);
    const document = index.documents[normalized];
    if (document) {
      const paths = await loadContentPaths();
      for (const version of document.versions) {
        await safeRemove(paths, projectRoot, version.snapshotPath);
      }
      delete index.documents[normalized];
      await writeWikiHistoryIndex(projectRoot, index);
    }

    return {
      key: normalized,
      deleted: true,
      filePath
    };
  });
}

function normalizeWikiDirectoryName(newName: string): string {
  const trimmed = newName.trim();
  if (
    !trimmed ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.startsWith(".")
  ) {
    throw new WikiDirectoryError("WIKI_DIRECTORY_INVALID", "目录名称不合法。");
  }
  return normalizeWikiDirectoryPath(trimmed);
}

function parentOfWikiDirectory(directoryPath: string): string {
  const segments = directoryPath.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}

function rewriteWikiPathPrefix(
  value: string,
  sourcePath: string,
  targetPath: string
): string {
  if (value === sourcePath) {
    return targetPath;
  }
  if (value.startsWith(`${sourcePath}/`)) {
    return `${targetPath}${value.slice(sourcePath.length)}`;
  }
  return value;
}

function isUnderWikiDirectoryPrefix(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`);
}

async function pathExistsUnderWiki(
  projectRoot: string,
  relativeUnderWiki: string
): Promise<"missing" | "file" | "directory"> {
  const relPath = path.posix.join("wiki", relativeUnderWiki);
  try {
    const paths = await loadContentPaths();
    const info = await stat(await assertReadable(paths, projectRoot, relPath));
    return info.isDirectory() ? "directory" : "file";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "missing";
    }
    throw error;
  }
}

/**
 * Spec 109: preview same-parent directory rename (last path segment only).
 */
export async function previewWikiDirectoryRename(
  projectRoot: string,
  input: WikiDirectoryRenameInput
): Promise<WikiDirectoryRenamePreview> {
  const rawSource = input.sourcePath?.trim() ?? "";
  if (!rawSource) {
    throw new WikiDirectoryError(
      "WIKI_DIRECTORY_RENAME_ROOT",
      "根目录不可重命名。",
      400
    );
  }

  const sourcePath = normalizeWikiDirectoryPath(rawSource);
  const newName = normalizeWikiDirectoryName(input.newName ?? "");
  const parent = parentOfWikiDirectory(sourcePath);
  const targetPath = parent ? `${parent}/${newName}` : newName;
  const currentName = sourcePath.split("/").pop() ?? sourcePath;

  if (targetPath === sourcePath || newName === currentName) {
    throw new WikiDirectoryError(
      "WIKI_DIRECTORY_INVALID",
      "新目录名称与当前名称相同。",
      400
    );
  }

  const pages = await readWikiSummaries(projectRoot);
  const listedDirectories = await listWikiDirectories(projectRoot);
  const sourceExists =
    listedDirectories.some((item) => isUnderWikiDirectoryPrefix(item.path, sourcePath)) ||
    pages.some((page) => page.key.startsWith(`${sourcePath}/`)) ||
    (await pathExistsUnderWiki(projectRoot, sourcePath)) === "directory";

  if (!sourceExists) {
    throw new WikiDirectoryError(
      "WIKI_DIRECTORY_NOT_FOUND",
      "目标目录不存在。",
      404
    );
  }

  const directoryMappings = listedDirectories
    .filter((item) => isUnderWikiDirectoryPrefix(item.path, sourcePath))
    .map((item) => ({
      sourcePath: item.path,
      targetPath: rewriteWikiPathPrefix(item.path, sourcePath, targetPath)
    }))
    .sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  if (!directoryMappings.some((item) => item.sourcePath === sourcePath)) {
    directoryMappings.unshift({ sourcePath, targetPath });
  }

  const documentMappings = pages
    .filter((page) => page.key.startsWith(`${sourcePath}/`))
    .map((page) => ({
      sourceKey: page.key,
      targetKey: rewriteWikiPathPrefix(page.key, sourcePath, targetPath),
      fileVersion: page.file_version
    }))
    .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));

  const conflicts: string[] = [];
  const warnings: string[] = [];
  const sourceKeySet = new Set(documentMappings.map((item) => item.sourceKey));
  const sourceDirSet = new Set(directoryMappings.map((item) => item.sourcePath));

  const targetKind = await pathExistsUnderWiki(projectRoot, targetPath);
  if (targetKind === "file") {
    conflicts.push(`目标路径已被文件占用：wiki/${targetPath}`);
  } else if (targetKind === "directory") {
    conflicts.push(`目标目录已存在：wiki/${targetPath}/`);
  }

  for (const directory of listedDirectories) {
    if (sourceDirSet.has(directory.path)) {
      continue;
    }
    if (
      directory.path === targetPath ||
      directory.path.startsWith(`${targetPath}/`)
    ) {
      conflicts.push(`目标目录路径冲突：wiki/${directory.path}/`);
    }
  }

  for (const mapping of documentMappings) {
    if (sourceKeySet.has(mapping.targetKey)) {
      continue;
    }
    if (await wikiExists(projectRoot, mapping.targetKey)) {
      conflicts.push(`目标 Wiki 路径已存在：wiki/${mapping.targetKey}`);
    }
  }

  return {
    sourcePath,
    targetPath,
    newName,
    documentCount: documentMappings.length,
    directoryCount: directoryMappings.length,
    documents: documentMappings,
    directories: directoryMappings,
    conflicts: Array.from(new Set(conflicts)),
    warnings,
    preview_digest: computeDirectoryRenameDigest(sourcePath, targetPath, documentMappings)
  };
}

/** The digest that binds a directory rename to its per-document baselines. */
function computeDirectoryRenameDigest(
  sourcePath: string,
  targetPath: string,
  documents: Array<{ sourceKey: string; targetKey: string; fileVersion: string }>
): string {
  const payload = JSON.stringify({
    sourcePath,
    targetPath,
    documents: documents
      .map((item) => ({ sourceKey: item.sourceKey, targetKey: item.targetKey, fileVersion: item.fileVersion }))
      .sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
  });
  return `wdr-${createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

/**
 * Spec 109: commit same-parent directory rename.
 *
 * Physical tree is renamed first via {@link safeRenameDirectory}; then
 * directory metadata and per-document version history keys are rewritten.
 * Document history uses `operation: "move"` (Spec recommendation) with
 * `previousKey` pointing at the pre-rename path.
 */
export async function renameWikiDirectory(
  projectRoot: string,
  input: WikiDirectoryRenameInput
): Promise<WikiDirectoryRenameResult> {
  return withWikiWriteQueue(async () => {
  const preview = await previewWikiDirectoryRename(projectRoot, input);
  if (preview.conflicts.length > 0) {
    throw new WikiDirectoryError(
      "WIKI_DIRECTORY_CONFLICT",
      preview.conflicts[0] ?? "目标路径冲突。",
      409
    );
  }

  // The commit binds the preview: every per-document baseline and the digest
  // are re-checked INSIDE the queue.
  if (input.preview_digest?.trim()) {
    if (input.preview_digest.trim() !== preview.preview_digest) {
      throw new WikiDirectoryError(
        "WIKI_DIRECTORY_CONFLICT",
        "目录重命名预检已过期，请重新预检。",
        409
      );
    }
  }
  if (input.expected_versions) {
    for (const document of preview.documents) {
      const expected = input.expected_versions[document.sourceKey];
      if (expected && expected !== document.fileVersion) {
        throw new WikiDirectoryError(
          "WIKI_DIRECTORY_CONFLICT",
          `文档已被修改，请重新预检：${document.sourceKey}`,
          409
        );
      }
    }
  }

  const { sourcePath, targetPath, documents, directories } = preview;

  for (const document of documents) {
    await assertWikiKeyNotHeld(document.sourceKey);
  }
  const sourceRel = relPathForDirectory(sourcePath);
  const targetRel = relPathForDirectory(targetPath);
  const writtenFiles: string[] = [`${targetRel}/`];

  // Capture history payloads before the filesystem rename moves content.
  const historyCarries: Array<{
    sourceKey: string;
    targetKey: string;
    markdown: string;
  }> = [];
  for (const mapping of documents) {
    const markdown = await readExisting(projectRoot, mapping.sourceKey);
    historyCarries.push({
      sourceKey: mapping.sourceKey,
      targetKey: mapping.targetKey,
      markdown
    });
  }

  try {
    await safeRenameDirectory((await loadContentPaths()), projectRoot, sourceRel, targetRel);
  } catch (error) {
    if (error instanceof ForbiddenPathError) {
      if (error.message.includes("already exists")) {
        throw new WikiDirectoryError(
          "WIKI_DIRECTORY_CONFLICT",
          `目标目录已存在：wiki/${targetPath}/`,
          409
        );
      }
      if (error.message.includes("does not exist")) {
        throw new WikiDirectoryError(
          "WIKI_DIRECTORY_NOT_FOUND",
          "目标目录不存在。",
          404
        );
      }
    }
    throw error;
  }

  const now = new Date().toISOString();
  const metadata = await readWikiDirectoryMetadata(projectRoot);
  const nextEntries = new Map<string, WikiDirectoryMetadataEntry>();
  for (const entry of metadata.directories) {
    if (isUnderWikiDirectoryPrefix(entry.path, sourcePath)) {
      continue;
    }
    nextEntries.set(entry.path, entry);
  }
  for (const mapping of directories) {
    const previous = metadata.directories.find((item) => item.path === mapping.sourcePath);
    nextEntries.set(mapping.targetPath, {
      path: mapping.targetPath,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now
    });
  }
  // Ensure ancestors of the renamed root remain explicit when needed.
  for (const ancestor of directoryAncestors(targetPath)) {
    if (!nextEntries.has(ancestor)) {
      const previous = metadata.directories.find((item) => item.path === ancestor);
      nextEntries.set(ancestor, {
        path: ancestor,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now
      });
    }
  }
  await writeWikiDirectoryMetadata(projectRoot, {
    schemaVersion: 1,
    directories: Array.from(nextEntries.values())
  });
  writtenFiles.push(WIKI_DIRECTORY_METADATA_PATH);

  const index = await readWikiHistoryIndex(projectRoot);
  for (const carry of historyCarries) {
    const sourceDocument = index.documents[carry.sourceKey];
    if (sourceDocument) {
      const carriedVersions = sourceDocument.versions.map((version) => ({
        ...version,
        key: carry.targetKey,
        snapshotPath: wikiVersionSnapshotPath(carry.targetKey, version.versionId)
      }));
      for (const version of sourceDocument.versions) {
        const paths = await loadContentPaths();
        const oldSnapshot = await assertReadable(paths, projectRoot, version.snapshotPath);
        const snapshotMarkdown = await readFile(oldSnapshot, "utf8");
        const newSnapshotPath = wikiVersionSnapshotPath(carry.targetKey, version.versionId);
        await safeWrite(paths, projectRoot, newSnapshotPath, snapshotMarkdown);
        await safeRemove(paths, projectRoot, version.snapshotPath);
      }
      index.documents[carry.targetKey] = {
        key: carry.targetKey,
        createdAt: sourceDocument.createdAt,
        updatedAt: now,
        currentVersionId: sourceDocument.currentVersionId,
        versions: carriedVersions
      };
      delete index.documents[carry.sourceKey];
    }
  }
  if (historyCarries.length > 0) {
    await writeWikiHistoryIndex(projectRoot, index);
    writtenFiles.push(WIKI_HISTORY_INDEX_PATH);
  }

  for (const carry of historyCarries) {
    const snapshot = await createWikiVersionSnapshot(projectRoot, carry.targetKey, carry.markdown, {
      operation: "move",
      previousKey: carry.sourceKey,
      force: true
    });
    if (!snapshot) {
      throw new WikiDirectoryError(
        "WIKI_DIRECTORY_INVALID",
        "未能写入重命名后的版本记录。",
        500
      );
    }
    writtenFiles.push(relPathForKey(carry.targetKey));
  }

  return {
    sourcePath,
    targetPath,
    renamedDocuments: documents.length,
    renamedDirectories: directories.length,
    writtenFiles: Array.from(new Set(writtenFiles))
  };
  });
}

export async function readWiki(projectRoot: string, key: string): Promise<WikiPage> {
  const normalized = normalizeWikiKey(key);
  const rawMarkdown = await readExisting(projectRoot, normalized);
  const parsed = parseMarkdownFrontmatter(rawMarkdown);
  return {
    key: normalized,
    frontmatter: frontmatterFromData(parsed.data),
    content: parsed.content,
    rawMarkdown,
    file_version: wikiContentHash(rawMarkdown),
    acl: aclOf(parsed.data)
  };
}

export async function previewWikiWrite(projectRoot: string, key: string, input: WikiWriteInput): Promise<WikiPreview> {
  const normalized = normalizeWikiKey(key);
  const oldText = await readExisting(projectRoot, normalized);
  const current = parseMarkdownFrontmatter(oldText);
  const frontmatter = {
    ...frontmatterFromData(current.data),
    ...(input.frontmatter ?? {})
  };
  const preserved = preservedWikiAuth(current.data as Record<string, unknown>);
  if (input.frontmatter?.allowed_roles !== undefined) {
    preserved.allowed_roles = assertWritableAcl(input.frontmatter.allowed_roles);
  }
  const proposedMarkdown = serializeWiki(frontmatter, input.content ?? current.content, preserved);
  const filePath = relPathForKey(normalized);
  return {
    key: normalized,
    filePath,
    currentFileVersion: oldText ? wikiContentHash(oldText) : null,
    diff: previewDiff(oldText, proposedMarkdown, filePath),
    proposedMarkdown
  };
}

/**
 * Spec 193 §8.1 — the combined editor save runs inside the shared write queue.
 *
 * When the save also changes `allowed_roles` it goes through the ONE
 * coordinated mutation (durable security operation + widening hold + audited
 * write). A body-only save keeps the plain audited write, but it still runs
 * in the queue and is still blocked by a held key.
 */
export async function writeWiki(
  projectRoot: string,
  key: string,
  input: WikiWriteInput,
  actor?: TrustedActor
): Promise<WikiPreview> {
  const normalized = normalizeWikiKey(key);
  return withWikiWriteQueue(async () => {
    const existed = await wikiExists(projectRoot, normalized);
    const oldText = await readExisting(projectRoot, normalized);
    assertExpectedWikiVersion(existed, oldText, input.expected_version);
    await assertWikiKeyNotHeld(normalized);
    const preview = await previewWikiWrite(projectRoot, key, input);

    const currentAcl = aclOfDeclaration(readAclDeclaration(oldText));
    const nextAcl = aclOfDeclaration(readAclDeclaration(preview.proposedMarkdown));
    const aclChanged = canonicalAclKey(currentAcl) !== canonicalAclKey(nextAcl);

    if (aclChanged) {
      await mutateWikiAccessUnlocked({
        projectRoot,
        key: normalized,
        expectedVersion: wikiContentHash(oldText),
        existence: existed ? "must_exist" : "must_not_exist",
        buildTarget: () => ({ targetMarkdown: preview.proposedMarkdown, nextAcl }),
        actor: actor ?? systemActor(),
        versionOperation: existed ? "edit_save" : "create",
        changeType: existed ? "wiki_edit_save" : "wiki_create",
        writeVersionSnapshot: async (markdown) => {
          if (existed) {
            await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
          }
          await createWikiVersionSnapshot(projectRoot, normalized, markdown, {
            operation: existed ? "edit_save" : "create"
          });
        }
      });
      return preview;
    }

    await auditedWriteFile(projectRoot, preview.filePath, preview.proposedMarkdown, {
      enabled: true,
      changeType: existed ? "wiki_edit_save" : "wiki_create",
      assetKind: "wiki",
      ...auditActorFields(actor),
      source: "wiki_api",
      targetId: normalized,
      operation: existed ? "edit_save" : "create",
      diff: preview.diff
    });
    if (existed) {
      await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
    }
    await createWikiVersionSnapshot(projectRoot, normalized, preview.proposedMarkdown, {
      operation: existed ? "edit_save" : "create"
    });
    return preview;
  });
}

function validateUploadMarkdown(markdown: string): void {
  const size = Buffer.byteLength(markdown, "utf8");
  if (size > MAX_MARKDOWN_UPLOAD_BYTES) {
    const err = new ForbiddenPathError("Markdown file exceeds the 1MB upload limit");
    err.statusCode = 400;
    err.code = "WIKI_MARKDOWN_TOO_LARGE";
    throw err;
  }
  // V-08 — a non-YAML frontmatter engine is refused before ANY other upload
  // validation, so the refusal code is the engine's own and not the
  // authorization contract's.
  assertMarkdownFrontmatterEngine(markdown);
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

function aclOfDeclaration(declaration: RawAclDeclaration): ObjectAcl {
  return parseObjectAcl(declaration.value, declaration.declared);
}

/**
 * Spec 193 §5 — the upload preflight.
 *
 * The authorization section is part of the preflight: the reader range is a
 * submit decision, not a setting the admin has to find again after the upload.
 *
 * The mode is NEVER silently changed: `create` on an existing target and
 * `replace` on a missing target are refused at commit time, not converted.
 */
export async function previewWikiUpload(projectRoot: string, input: WikiUploadInput): Promise<WikiUploadPreview> {
  const normalized = normalizeWikiKey(input.key);
  validateUploadMarkdown(input.markdown);
  const exists = await wikiExists(projectRoot, normalized);
  const oldText = await readExisting(projectRoot, normalized);
  const uploadedDeclaration = readAclDeclaration(input.markdown);
  const uploadedAcl = aclOfDeclaration(uploadedDeclaration);
  const currentDeclaration = readAclDeclaration(oldText);
  const currentAcl = exists ? aclOfDeclaration(currentDeclaration) : null;

  const explicitMode = input.mode ?? (input.overwrite ? "replace" : "create");
  const suggested = suggestUploadAccessSelection({ exists, uploadedAcl });
  const selection = input.access ?? suggested;

  const filePath = relPathForKey(normalized);
  const sourceFileName = deriveUploadSourceName(input.sourceFileName, normalized);
  const targetKey = normalized;
  const parsedUpload = parseMarkdownFrontmatter(input.markdown);
  const frontmatter = frontmatterFromData(parsedUpload.data);
  const targetTitle = uploadTitle(input.markdown, normalized, frontmatter);
  const existingTitle = exists
    ? uploadTitle(oldText, normalized, frontmatterFromData(parseMarkdownFrontmatter(oldText).data))
    : null;
  const warnings: string[] = [];
  if (explicitMode === "create" && exists) {
    warnings.push("目标文档已存在，新建模式会被拒绝，请改用覆盖。");
  }
  if (explicitMode === "replace" && !exists) {
    warnings.push("覆盖模式下目标文档不存在，覆盖会被拒绝。");
  }
  if (!parsedUpload.content.trim()) {
    warnings.push("Markdown 正文为空。");
  }

  const issues: WikiUploadAccessPreview["issues"] = [];
  let finalAcl: ObjectAcl = currentAcl ?? uploadedAcl;
  let resolvedMarkdown = input.markdown;
  try {
    const resolution = resolveUploadAcl({
      exists,
      currentDeclaration,
      uploadedDeclaration,
      selection
    });
    finalAcl = resolution.acl;
    resolvedMarkdown = applyRawAllowedRoles(input.markdown, resolution.declaration);
  } catch (error) {
    const code = String((error as { code?: unknown } | null)?.code ?? "wiki_upload_access_required");
    issues.push({
      code,
      message: error instanceof Error ? error.message : "上传授权选择不可用。",
      blocking: true
    });
  }
  if (!issues.some((issue) => issue.blocking)) {
    if (finalAcl.state === "empty" || finalAcl.state === "missing") {
      issues.push({
        code: "confirm_empty_required",
        message: "最终授权为空，提交前需要确认上传后 Agent 无人可见。",
        blocking: false
      });
    }
    if (finalAcl.state === "all") {
      issues.push({
        code: "confirm_all_required",
        message: "最终授权为所有角色可见，提交前需要独立确认。",
        blocking: false
      });
    }
    if (uploadedAcl.state === "corrupt" && selection.mode !== "use_uploaded") {
      warnings.push("上传文件内的授权声明已损坏，已按重新设置的授权处理。");
    }
  }
  if (sourceFileName && path.posix.basename(targetKey) !== sourceFileName) {
    warnings.push(
      `本地文件名 ${sourceFileName} 与目标路径文件名 ${path.posix.basename(targetKey)} 不一致，将按目标 Wiki 路径保存。`
    );
  }

  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
  const effects = resolveWikiAccessEffects(finalAcl, snapshot);
  const expectedVersion = exists ? wikiContentHash(oldText) : wikiContentHash("");
  const previewDigest = computeWikiAccessDigest({
    key: normalized,
    expectedVersion,
    nextAcl: finalAcl,
    roleChannelVersion: snapshot.role_channel_version,
    mode: explicitMode,
    contentHash: wikiContentHash(input.markdown)
  });

  return {
    key: normalized,
    filePath,
    diff: previewDiff(oldText, resolvedMarkdown, filePath),
    proposedMarkdown: resolvedMarkdown,
    currentFileVersion: exists ? wikiContentHash(oldText) : null,
    exists,
    mode: explicitMode,
    sourceFileName,
    targetKey,
    existingTitle,
    targetTitle,
    title: targetTitle,
    slRefs: frontmatter.sl_refs ?? [],
    warnings,
    access: {
      current_acl: currentAcl,
      uploaded_acl: uploadedAcl,
      final_acl: finalAcl,
      suggested_selection: suggested,
      direction: classifyAccessDirection(currentAcl ?? { state: "missing" }, finalAcl),
      role_effects: effects.role_effects,
      declared_role_count: effects.declared_role_count,
      declared_without_discover: effects.declared_without_discover,
      declared_without_read: effects.declared_without_read,
      role_channel_version: snapshot.role_channel_version,
      preview_digest: previewDigest,
      issues
    }
  };
}

/**
 * Spec 193 §5.4 — the upload commit.
 *
 * The commit carries the ORIGINAL file text, an explicit authorization
 * selection and the preview digest. The candidate is rebuilt inside the write
 * queue from the ORIGINAL text and the SAME current read that the version
 * check used, so a preview can never be replayed as the write source.
 */
export async function commitWikiUpload(
  projectRoot: string,
  input: WikiUploadInput,
  actor?: TrustedActor
): Promise<WikiUploadPreview> {
  const normalized = normalizeWikiKey(input.key);
  validateUploadMarkdown(input.markdown);
  const access = input.access;
  if (!access) {
    throw new WikiAccessError(
      "wiki_upload_access_required",
      "上传必须携带明确的授权选择。",
      400
    );
  }
  const previewDigest = input.preview_digest?.trim() ?? "";
  if (!previewDigest) {
    throw new WikiAccessError(
      "wiki_upload_preview_stale",
      "缺少上传预检摘要，请重新预检。",
      409
    );
  }
  const resolvedActor = actor ?? undefined;

  return withWikiWriteQueue(async () => {
    const existed = await wikiExists(projectRoot, normalized);
    const oldText = await readExisting(projectRoot, normalized);
    const explicitMode: WikiUploadMode = input.mode ?? (input.overwrite ? "replace" : "create");

    // The mode contract: a create never becomes a replace and a replace
    // never becomes a create.
    if (explicitMode === "create" && existed) {
      throw new WikiAccessError(
        "wiki_write_conflict",
        "目标 Wiki 文档已存在，新建模式已被拒绝。",
        409
      );
    }
    if (explicitMode === "replace" && !existed) {
      throw new WikiAccessError(
        "wiki_write_conflict",
        "目标 Wiki 文档不存在，覆盖模式已被拒绝。",
        409
      );
    }
    if (existed) {
      assertExpectedWikiVersion(existed, oldText, input.expected_version);
    }
    await assertWikiKeyNotHeld(normalized);

    const uploadedDeclaration = readAclDeclaration(input.markdown);
    const currentDeclaration = readAclDeclaration(oldText);
    const resolution = resolveUploadAcl({
      exists: existed,
      currentDeclaration,
      uploadedDeclaration,
      selection: access
    });
    const finalAcl = resolution.acl;

    if ((finalAcl.state === "empty" || finalAcl.state === "missing") && input.confirmed_empty !== true) {
      throw new WikiAccessError(
        "wiki_upload_access_required",
        "最终授权为空，请确认上传后 Agent 无人可见。",
        400
      );
    }
    if (finalAcl.state === "all" && input.confirmed_all !== true) {
      throw new WikiAccessError(
        "wiki_upload_access_required",
        "最终授权为所有角色可见，请完成独立确认。",
        400
      );
    }

    const targetMarkdown = applyRawAllowedRoles(input.markdown, resolution.declaration);
    const expectedVersion = existed ? wikiContentHash(oldText) : wikiContentHash("");
    const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);
    const recomputedDigest = computeWikiAccessDigest({
      key: normalized,
      expectedVersion,
      nextAcl: finalAcl,
      roleChannelVersion: snapshot.role_channel_version,
      mode: explicitMode,
      contentHash: wikiContentHash(input.markdown)
    });
    if (recomputedDigest !== previewDigest) {
      throw new WikiAccessError(
        "wiki_upload_preview_stale",
        "上传预检已过期，请重新预检后提交。",
        409
      );
    }

    const currentAcl = aclOfDeclaration(currentDeclaration);
    const aclChanged = canonicalAclKey(currentAcl) !== canonicalAclKey(finalAcl);
    const versionOperation = existed ? "upload_replace" : "upload_create";
    const changeType = existed ? "wiki_upload_replace" : "wiki_upload_create";

    if (aclChanged) {
      await mutateWikiAccessUnlocked({
        projectRoot,
        key: normalized,
        expectedVersion,
        existence: existed ? "must_exist" : "must_not_exist",
        buildTarget: () => ({ targetMarkdown, nextAcl: finalAcl }),
        actor: resolvedActor ?? systemActor(),
        versionOperation,
        changeType,
        expectedDigest: previewDigest,
        computeDigest: () => recomputedDigest,
        writeVersionSnapshot: async (markdown) => {
          if (existed) {
            await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
          }
          await createWikiVersionSnapshot(projectRoot, normalized, markdown, {
            operation: versionOperation,
            sourceFileName: input.sourceFileName
          });
        }
      });
    } else {
      // The authorization is unchanged: a plain, audited content write.
      await auditedWriteFile(projectRoot, relPathForKey(normalized), targetMarkdown, {
        enabled: true,
        changeType,
        assetKind: "wiki",
        ...auditActorFields(resolvedActor),
        source: "wiki_api",
        targetId: normalized,
        operation: versionOperation,
        diff: previewDiff(oldText, targetMarkdown, relPathForKey(normalized))
      });
      if (existed) {
        await ensureWikiBaselineVersion(projectRoot, normalized, oldText);
      }
      await createWikiVersionSnapshot(projectRoot, normalized, targetMarkdown, {
        operation: versionOperation,
        sourceFileName: input.sourceFileName
      });
    }

    return previewWikiUpload(projectRoot, {
      key: input.key,
      markdown: input.markdown,
      mode: explicitMode,
      sourceFileName: input.sourceFileName,
      access
    });
  });
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
  const paths = await loadContentPaths();
  const rawMarkdown = await readFile(await assertReadable(paths, projectRoot, version.snapshotPath), "utf8");
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
  const currentText = await readExisting(projectRoot, detail.key);
  const restoredMarkdown = carryCurrentAcl(detail.rawMarkdown, currentText, { restore: true });
  return {
    key: detail.key,
    versionId: detail.versionId,
    targetTitle: versionTitle(detail.rawMarkdown, detail.key),
    diff: previewDiff(currentText, restoredMarkdown, relPathForKey(detail.key))
  };
}

export async function restoreWikiVersion(
  projectRoot: string,
  key: string,
  versionId: string,
  actor?: TrustedActor,
  expectedVersion?: string
): Promise<WikiVersionRestoreResult> {
  const normalized = normalizeWikiKey(key);
  return withWikiWriteQueue(async () => {
    const detail = await readWikiVersion(projectRoot, normalized, versionId);
    // Reject non-YAML frontmatter before anything is written (V-08).
    parseMarkdownFrontmatter(detail.rawMarkdown);
    const filePath = relPathForKey(detail.key);
    // Restoring content never revives an older (possibly wider) ACL: the current one is kept.
    const currentText = await readExisting(projectRoot, detail.key);
    if (!expectedVersion?.trim()) {
      throw new WikiConcurrencyError("wiki_expected_version_required", 428);
    }
    if (expectedVersion.trim() !== wikiContentHash(currentText)) {
      throw new WikiConcurrencyError("wiki_write_conflict", 409);
    }
    await assertWikiKeyNotHeld(detail.key);
    const restoredMarkdown = carryCurrentAcl(detail.rawMarkdown, currentText, { restore: true });
    await auditedWriteFile(projectRoot, filePath, restoredMarkdown, {
      enabled: true,
      changeType: "wiki_restore",
      assetKind: "wiki",
      ...auditActorFields(actor),
      source: "wiki_api",
      targetId: detail.key,
      operation: "restore",
      diff: previewDiff(currentText, restoredMarkdown, filePath)
    });
    const restored = await createWikiVersionSnapshot(projectRoot, detail.key, restoredMarkdown, {
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
  });
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

async function assertWikiSourceWritable(projectRoot: string, sourceKey: string): Promise<string> {
  const paths = await loadContentPaths();
  return assertReadable(paths, projectRoot, relPathForKey(sourceKey));
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
  const parsed = parseMarkdownFrontmatter(oldText);
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
  targetDirectory: string,
  actor?: TrustedActor,
  expectedVersion?: string
): Promise<WikiMoveResult> {
  const normalizedSource = normalizeWikiKey(sourceKey);
  return withWikiWriteQueue(async () => {
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
  const currentSourceText = await readExisting(projectRoot, normalizedSource);
  if (!expectedVersion?.trim()) {
    throw new WikiConcurrencyError("wiki_expected_version_required", 428);
  }
  if (expectedVersion.trim() !== wikiContentHash(currentSourceText)) {
    throw new WikiConcurrencyError("wiki_write_conflict", 409);
  }
  await assertWikiKeyNotHeld(normalizedSource);
  // Materialise the destination directory so the file write below has a
  // real parent. We only ever write under wiki/<...>; safeMkdir is
  // bounded by the allowlist in fs-safe.
  const targetDirectoryNormalized = normalizeWikiDirectoryPath(targetDirectory);
  await safeMkdir((await loadContentPaths()), projectRoot, relPathForDirectory(targetDirectoryNormalized));

  const oldText = await readExisting(projectRoot, normalizedSource);
  // Reject non-YAML frontmatter before the target is written (V-08).
  parseMarkdownFrontmatter(oldText);
  await assertWikiSourceWritable(projectRoot, normalizedSource);
  await auditedWriteFile(projectRoot, targetRelPath, oldText, {
    enabled: true,
    changeType: "wiki_move",
    assetKind: "wiki",
    ...auditActorFields(actor),
    source: "wiki_api",
    targetId: targetKey,
    operation: "move",
    diff: previewDiff("", oldText, targetRelPath)
  });
  await safeRemove((await loadContentPaths()), projectRoot, sourceRelPath);

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
      const paths = await loadContentPaths();
      const oldSnapshot = await assertReadable(paths, projectRoot, version.snapshotPath);
      const markdown = await readFile(oldSnapshot, "utf8");
      const newSnapshotPath = wikiVersionSnapshotPath(targetKey, version.versionId);
      await safeWrite(paths, projectRoot, newSnapshotPath, markdown);
      await safeRemove(paths, projectRoot, version.snapshotPath);
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
  });
}
