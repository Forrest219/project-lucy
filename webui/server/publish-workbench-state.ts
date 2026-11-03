/**
 * Lucy publish workbench — pending state (Spec
 * `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md` §5).
 *
 * WHAT THIS MODULE IS
 * -------------------
 * The pending list ("待发布变更") is the difference between the CURRENT author
 * content and the last content version that has PROVEN sync evidence. Git
 * diffs and the in-process "written files" set can DISCOVER that something
 * changed; neither can prove that the change has taken effect. This module is
 * the single source of truth for "what is still pending".
 *
 * The state lives in `.ktx-ui/publish-workbench/` — a Lucy-private directory
 * that never enters the content mirror, the Git business diff, or a public
 * export. It holds:
 *
 *   baseline.json          the proven-consumed content version + a monotonic generation
 *   blobs/<sha256>         the raw bytes of the baseline, so a before/after diff is real
 *   attempts/<attemptId>   one record per sync attempt, for crash reconciliation
 *
 * WHAT THIS MODULE IS NOT
 * -----------------------
 * It is not a replacement for the KTX index, and it is not a recoverable
 * history snapshot (that is L25-15's job). It never restores content, never
 * fabricates an "已生效" verdict, and never deletes business files.
 *
 * The baseline advances only through {@link advancePublishBaseline}, which is a
 * compare-and-swap on the generation. The caller is responsible for calling it
 * inside the already-existing publish window — this module never takes a lock
 * of its own.
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveContentPaths, type ContentPaths } from "./paths";

// ─── Layout & limits ────────────────────────────────────────────────────────

export const PUBLISH_WORKBENCH_STATE_DIR_REL = ".ktx-ui/publish-workbench";
export const PUBLISH_BASELINE_REL = `${PUBLISH_WORKBENCH_STATE_DIR_REL}/baseline.json`;
export const PUBLISH_BLOBS_DIR_REL = `${PUBLISH_WORKBENCH_STATE_DIR_REL}/blobs`;
export const PUBLISH_ATTEMPTS_DIR_REL = `${PUBLISH_WORKBENCH_STATE_DIR_REL}/attempts`;

const BASELINE_FORMAT_VERSION = 1;
const ATTEMPT_FORMAT_VERSION = 1;

/**
 * A scan that hits this limit is reported as INCOMPLETE, never as "no pending
 * changes". Truncating the scan and returning an empty list would silently
 * declare the whole content published.
 */
export const PUBLISH_SCAN_FILE_LIMIT = 5000;

/** A single business file larger than this is reported as unreadable, not skipped. */
export const PUBLISH_SCAN_FILE_BYTE_LIMIT = 8 * 1024 * 1024;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Which business surface a file belongs to. */
export type PublishContentKind = "semantic_overlay" | "schema_manifest" | "wiki";

export interface PublishContentFile {
  /** Content-root relative, POSIX separators: `semantic-layer/...` / `wiki/...`. */
  logicalPath: string;
  /** SHA-256 of the raw file bytes. */
  digest: string;
  size: number;
  kind: PublishContentKind;
}

export type PublishBaselineState = "ready" | "uninitialized" | "needs_verification";

export type PublishChangeType = "added" | "modified" | "deleted";

export interface PublishPendingChange {
  logicalPath: string;
  changeType: PublishChangeType;
  kind: PublishContentKind;
  /** Digest of the current bytes; `null` when the file is gone. */
  currentDigest: string | null;
  /** Digest of the baseline bytes; `null` when the file was proven absent. */
  baselineDigest: string | null;
  /** True when there is no trustworthy previous version to compare against. */
  firstVerification: boolean;
}

export interface PublishPendingSnapshot {
  /** Version of the whole content snapshot. Shared by list / validation / confirm / submit. */
  pendingDigest: string;
  baselineState: PublishBaselineState;
  baselineGeneration: number;
  /** Every current business file, sorted by logical path. */
  currentFiles: PublishContentFile[];
  /** The pending subset, sorted by logical path. */
  changes: PublishPendingChange[];
  /** Files that could not be enumerated or read — the snapshot is not complete. */
  unresolved: Array<{ logicalPath: string; reason: string }>;
  /** False when the pending range could not be fully resolved. */
  complete: boolean;
  /** Why the baseline needs verification, when it does. */
  baselineIssue?: string;
}

export interface PublishBaseline {
  version: number;
  /** Monotonic. The CAS key for every baseline advance. */
  generation: number;
  /** Hashed project-root identity — never a raw path. */
  instanceId: string;
  /** Hashed content-root identity — never a raw path. */
  contentRootId: string;
  /** Always true for a baseline this module writes. */
  complete: boolean;
  confirmedAt: string;
  releaseId?: string;
  attemptId?: string;
  /** logical path -> digest of the proven-consumed bytes; `null` = proven absent. */
  files: Record<string, string | null>;
}

export type PublishAttemptStatus = "prepared" | "committed" | "failed" | "uncertain";

export interface PublishAttempt {
  version: number;
  attemptId: string;
  startedAt: string;
  finishedAt?: string;
  status: PublishAttemptStatus;
  /** The baseline generation this attempt expected to advance from. */
  expectedBaselineGeneration: number;
  /** The content version this attempt was about to consume. */
  consumedDigest: string;
  /** logical path -> digest of the bytes this attempt consumed; `null` = absent. */
  consumedFiles: Record<string, string | null>;
  /** The release record this attempt produced. */
  releaseId?: string;
  failureReason?: string;
  /** Paths that changed while the index was running. */
  drift?: Array<{ logicalPath: string; reason: string }>;
}

export class PublishBaselineConflictError extends Error {
  readonly code = "PUBLISH_BASELINE_CONFLICT";

  constructor(
    readonly expectedGeneration: number,
    readonly actualGeneration: number
  ) {
    super(
      `发布基线代次冲突：期望 ${expectedGeneration}，实际 ${actualGeneration}。内容已变化，请重新核对后提交。`
    );
    this.name = "PublishBaselineConflictError";
  }
}

// ─── Content enumeration ────────────────────────────────────────────────────

interface ScanRoot {
  /** Logical prefix, e.g. `semantic-layer`. */
  prefix: string;
  absolute: string;
  accept: (name: string) => boolean;
  kind: (relWithinRoot: string) => PublishContentKind;
}

const YAML_NAMES = /\.ya?ml$/i;

function semanticKind(relWithinRoot: string): PublishContentKind {
  const parts = relWithinRoot.split("/");
  return parts[0] === "_schema" ? "schema_manifest" : "semantic_overlay";
}

/**
 * Files that are NOT business content: editing history, caches, temp files,
 * AppleDouble sidecars, directory indexes. They are recorded as excluded so
 * the count of "what we did not look at" stays auditable — they are never
 * pending and never silently dropped.
 */
function exclusionReason(relPath: string, name: string): string | null {
  if (name.startsWith(".")) return "hidden_or_internal";
  if (name.startsWith("._")) return "apple_double";
  if (name.endsWith("~")) return "editor_backup";
  if (/\.tmp$|\.swp$|\.orig$|\.rej$/i.test(name)) return "temporary_file";
  if (relPath.split("/").some((part) => part.startsWith("."))) return "hidden_or_internal";
  return null;
}

function scanRoots(contentPaths: ContentPaths): ScanRoot[] {
  return [
    {
      prefix: "semantic-layer",
      absolute: contentPaths.semanticLayer,
      accept: (name) => YAML_NAMES.test(name),
      kind: semanticKind
    },
    {
      prefix: "wiki",
      absolute: contentPaths.wiki,
      accept: (name) => /\.md$/i.test(name),
      kind: () => "wiki"
    }
  ];
}

export interface PublishContentScan {
  files: PublishContentFile[];
  excluded: Array<{ logicalPath: string; reason: string }>;
  /** Read failures. Their presence makes the scan incomplete. */
  problems: Array<{ logicalPath: string; reason: string }>;
  truncated: boolean;
}

export async function scanPublishContent(
  projectRoot: string,
  contentPaths?: ContentPaths
): Promise<PublishContentScan> {
  const paths = contentPaths ?? (await resolveContentPaths(projectRoot));
  const files: PublishContentFile[] = [];
  const excluded: Array<{ logicalPath: string; reason: string }> = [];
  const problems: Array<{ logicalPath: string; reason: string }> = [];
  let truncated = false;

  for (const root of scanRoots(paths)) {
    await walkContentDir(root, "", files, excluded, problems, (count) => {
      if (count < PUBLISH_SCAN_FILE_LIMIT) return false;
      truncated = true;
      return true;
    });
  }

  files.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  excluded.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  problems.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
  return { files, excluded, problems, truncated };
}

async function walkContentDir(
  root: ScanRoot,
  relWithinRoot: string,
  files: PublishContentFile[],
  excluded: Array<{ logicalPath: string; reason: string }>,
  problems: Array<{ logicalPath: string; reason: string }>,
  stop: (count: number) => boolean
): Promise<void> {
  if (stop(files.length)) return;
  const dirAbs = relWithinRoot
    ? path.join(root.absolute, relWithinRoot)
    : root.absolute;
  let entries;
  try {
    entries = await readdir(dirAbs, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A missing directory is an empty surface, not a failure.
    if (code === "ENOENT") return;
    problems.push({
      logicalPath: `${root.prefix}${relWithinRoot ? `/${relWithinRoot}` : ""}`,
      reason: `read_failed:${code ?? "unknown"}`
    });
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = relWithinRoot ? `${relWithinRoot}/${entry.name}` : entry.name;
    const logicalPath = `${root.prefix}/${childRel}`;
    const reason = exclusionReason(childRel, entry.name);
    if (reason) {
      excluded.push({ logicalPath, reason });
      continue;
    }
    if (entry.isSymbolicLink()) {
      // A symlink can point outside the content root. It is neither business
      // content nor a safe guess — record it as excluded so the count stays honest.
      excluded.push({ logicalPath, reason: "symlink" });
      continue;
    }
    if (entry.isDirectory()) {
      await walkContentDir(root, childRel, files, excluded, problems, stop);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!root.accept(entry.name)) continue;

    const abs = path.join(root.absolute, childRel);
    try {
      const info = await stat(abs);
      if (info.size > PUBLISH_SCAN_FILE_BYTE_LIMIT) {
        problems.push({ logicalPath, reason: "file_too_large" });
        continue;
      }
      const bytes = await readFile(abs);
      files.push({
        logicalPath,
        digest: sha256(bytes),
        size: info.size,
        kind: root.kind(childRel)
      });
    } catch (error) {
      problems.push({
        logicalPath,
        reason: `read_failed:${(error as NodeJS.ErrnoException).code ?? "unknown"}`
      });
    }
  }
}

// ─── Digests ────────────────────────────────────────────────────────────────

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The pending digest covers the BASELINE GENERATION plus the full current
 * content snapshot (path + presence + digest). It is the single version token
 * shared by the list, the validation, the confirmation and the submission.
 */
export function computePendingDigest(
  baselineGeneration: number,
  files: ReadonlyArray<Pick<PublishContentFile, "logicalPath" | "digest">>
): string {
  const canonical = JSON.stringify({
    generation: baselineGeneration,
    files: [...files]
      .map((file) => [file.logicalPath, file.digest])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  });
  return sha256(canonical);
}

// ─── State directory IO ─────────────────────────────────────────────────────

function stateDir(projectRoot: string, rel: string): string {
  return path.resolve(projectRoot, rel);
}

async function ensureStateDir(projectRoot: string, rel: string): Promise<string> {
  const dir = stateDir(projectRoot, rel);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is masked by umask; chmod makes the 0700 contract explicit.
  await chmod(dir, 0o700).catch(() => undefined);
  return dir;
}

/**
 * Write a file atomically inside the state directory, with 0600 permissions.
 *
 * The content may be raw bytes (a baseline blob). Writing bytes through a
 * string would re-encode them and corrupt any non-UTF-8 byte, so buffers are
 * written as buffers.
 */
async function writeStateFile(absolutePath: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  const tmp = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.tmp-${process.pid}-${Date.now()}`
  );
  try {
    if (typeof content === "string") {
      await writeFile(tmp, content, { encoding: "utf8", mode: 0o600 });
    } else {
      await writeFile(tmp, content, { mode: 0o600 });
    }
    await chmod(tmp, 0o600);
    await rename(tmp, absolutePath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readStateFile(absolutePath: string): Promise<string | null> {
  try {
    return await readFile(absolutePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// ─── Baseline ───────────────────────────────────────────────────────────────

async function hashedIdentity(value: string): Promise<string> {
  return sha256(path.resolve(value));
}

export function parseBaseline(raw: string): PublishBaseline | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<PublishBaseline>;
  if (record.version !== BASELINE_FORMAT_VERSION) return null;
  if (typeof record.generation !== "number" || !Number.isFinite(record.generation)) return null;
  if (typeof record.instanceId !== "string" || !record.instanceId) return null;
  if (typeof record.contentRootId !== "string" || !record.contentRootId) return null;
  if (record.complete !== true) return null;
  if (!record.files || typeof record.files !== "object" || Array.isArray(record.files)) return null;
  const files: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(record.files as Record<string, unknown>)) {
    if (value === null) {
      files[key] = null;
      continue;
    }
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return null;
    files[key] = value;
  }
  return {
    version: record.version,
    generation: record.generation,
    instanceId: record.instanceId,
    contentRootId: record.contentRootId,
    complete: true,
    confirmedAt: typeof record.confirmedAt === "string" ? record.confirmedAt : "",
    ...(typeof record.releaseId === "string" ? { releaseId: record.releaseId } : {}),
    ...(typeof record.attemptId === "string" ? { attemptId: record.attemptId } : {}),
    files
  };
}

export async function readPublishBaseline(
  projectRoot: string
): Promise<PublishBaseline | null> {
  const raw = await readStateFile(stateDir(projectRoot, PUBLISH_BASELINE_REL));
  if (raw === null) return null;
  return parseBaseline(raw);
}

export async function readPublishBaselineIssue(
  projectRoot: string,
  contentPaths?: ContentPaths
): Promise<string | null> {
  const raw = await readStateFile(stateDir(projectRoot, PUBLISH_BASELINE_REL));
  if (raw === null) return null;
  const parsed = parseBaseline(raw);
  if (!parsed) return "发布基线文件损坏，无法解析。";
  const paths = contentPaths ?? (await resolveContentPaths(projectRoot));
  const expectedContentRootId = await hashedIdentity(paths.configDir);
  if (parsed.contentRootId !== expectedContentRootId) {
    return "内容根已变化，现有发布基线与当前实例不匹配，需要重新核对。";
  }
  const expectedInstanceId = await hashedIdentity(projectRoot);
  if (parsed.instanceId !== expectedInstanceId) {
    return "实例标识已变化，现有发布基线不可信，需要重新核对。";
  }
  return null;
}

/**
 * Advance the baseline with a compare-and-swap on the generation.
 *
 * The CAS is the ONLY way the generation moves. A caller that captured a
 * snapshot under generation N can only commit it while the baseline is still
 * at N; if anything advanced it in the meantime, the commit fails instead of
 * silently overwriting newer evidence.
 */
export async function advancePublishBaseline(
  projectRoot: string,
  input: {
    expectedGeneration: number;
    /** logical path -> digest of the proven-consumed bytes; `null` = proven absent. */
    files: Record<string, string | null>;
    releaseId?: string;
    attemptId?: string;
    confirmedAt?: string;
  }
): Promise<PublishBaseline> {
  const current = await readPublishBaseline(projectRoot);
  const actualGeneration = current?.generation ?? 0;
  if (actualGeneration !== input.expectedGeneration) {
    throw new PublishBaselineConflictError(input.expectedGeneration, actualGeneration);
  }

  // The baseline's content references must be READY before the pointer moves.
  // A baseline that points at a blob nobody kept is not a usable baseline:
  // the next diff would have no trustworthy previous version to compare with.
  for (const digest of Object.values(input.files)) {
    if (!digest) continue;
    if (!(await publishBlobExists(projectRoot, digest))) {
      throw new Error(
        "发布基线引用的内容缺失，拒绝推进基线（缺少已生效版本的内容引用）。"
      );
    }
  }

  const paths = await resolveContentPaths(projectRoot);
  const baseline: PublishBaseline = {
    version: BASELINE_FORMAT_VERSION,
    generation: actualGeneration + 1,
    instanceId: await hashedIdentity(projectRoot),
    contentRootId: await hashedIdentity(paths.configDir),
    complete: true,
    confirmedAt: input.confirmedAt ?? new Date().toISOString(),
    ...(input.releaseId ? { releaseId: input.releaseId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    files: input.files
  };

  await ensureStateDir(projectRoot, PUBLISH_WORKBENCH_STATE_DIR_REL);
  // The pointer is replaced only after the content references are in place.
  await writeStateFile(
    stateDir(projectRoot, PUBLISH_BASELINE_REL),
    `${JSON.stringify(baseline, null, 2)}\n`
  );
  return baseline;
}

// ─── Blobs (the baseline's raw content) ─────────────────────────────────────

function blobPath(projectRoot: string, digest: string): string {
  return path.join(stateDir(projectRoot, PUBLISH_BLOBS_DIR_REL), digest);
}

/**
 * Store one blob and verify its digest. A blob whose bytes do not hash to the
 * claimed digest is a broken write and is refused.
 */
export async function writePublishBlob(
  projectRoot: string,
  digest: string,
  bytes: Buffer
): Promise<void> {
  if (sha256(bytes) !== digest) {
    throw new Error("发布基线内容摘要校验失败，拒绝写入。");
  }
  await ensureStateDir(projectRoot, PUBLISH_BLOBS_DIR_REL);
  const target = blobPath(projectRoot, digest);
  try {
    await stat(target);
    return; // Content-addressed: the same digest is the same bytes.
  } catch {
    // Not present yet — fall through and write it.
  }
  await writeStateFile(target, bytes);
}

export async function readPublishBlob(
  projectRoot: string,
  digest: string
): Promise<Buffer | null> {
  try {
    return await readFile(blobPath(projectRoot, digest));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function publishBlobExists(projectRoot: string, digest: string): Promise<boolean> {
  try {
    await stat(blobPath(projectRoot, digest));
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop blobs that neither the current baseline nor an unsettled attempt
 * references. Called from the publish path only — never from a read request.
 */
export async function prunePublishBlobs(
  projectRoot: string,
  keepDigests: ReadonlySet<string>
): Promise<number> {
  const dir = stateDir(projectRoot, PUBLISH_BLOBS_DIR_REL);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (keepDigests.has(entry.name)) continue;
    await rm(path.join(dir, entry.name), { force: true });
    removed += 1;
  }
  return removed;
}

// ─── Pending snapshot ───────────────────────────────────────────────────────

/**
 * Read the current pending snapshot.
 *
 * The rules that matter:
 *   - A scan that could not be completed never returns an empty pending list.
 *     It returns `complete: false` with the unreadable paths named.
 *   - A missing baseline is NOT "everything is published". It is
 *     `uninitialized`: the current content is pending as first verification.
 *   - A damaged baseline or a changed content-root binding is
 *     `needs_verification`: the snapshot is not usable for submission.
 */
export async function readPublishPendingSnapshot(
  projectRoot: string,
  contentPaths?: ContentPaths
): Promise<PublishPendingSnapshot> {
  const paths = contentPaths ?? (await resolveContentPaths(projectRoot));
  const scan = await scanPublishContent(projectRoot, paths);

  const baselineIssue = await readPublishBaselineIssue(projectRoot, paths);
  const baseline = baselineIssue ? null : await readPublishBaseline(projectRoot);
  const baselineGeneration = baseline?.generation ?? 0;

  const pendingDigest = computePendingDigest(baselineGeneration, scan.files);

  if (scan.truncated) {
    return {
      pendingDigest,
      baselineState: baselineIssue ? "needs_verification" : baseline ? "ready" : "uninitialized",
      baselineGeneration,
      currentFiles: scan.files,
      changes: [],
      unresolved: [
        {
          logicalPath: "",
          reason: `业务文件数量超过上限 ${PUBLISH_SCAN_FILE_LIMIT}，扫描未完成。`
        }
      ],
      complete: false,
      ...(baselineIssue ? { baselineIssue } : {})
    };
  }

  if (scan.problems.length > 0) {
    return {
      pendingDigest,
      baselineState: baselineIssue ? "needs_verification" : baseline ? "ready" : "uninitialized",
      baselineGeneration,
      currentFiles: scan.files,
      changes: [],
      unresolved: scan.problems,
      complete: false,
      ...(baselineIssue ? { baselineIssue } : {})
    };
  }

  if (baselineIssue) {
    return {
      pendingDigest,
      baselineState: "needs_verification",
      baselineGeneration,
      currentFiles: scan.files,
      changes: [],
      unresolved: [],
      complete: false,
      baselineIssue
    };
  }

  if (!baseline) {
    // First verification: the current business content is pending, but there is
    // no trustworthy previous version to diff against.
    const changes: PublishPendingChange[] = scan.files.map((file) => ({
      logicalPath: file.logicalPath,
      changeType: "added" as const,
      kind: file.kind,
      currentDigest: file.digest,
      baselineDigest: null,
      firstVerification: true
    }));
    return {
      pendingDigest,
      baselineState: "uninitialized",
      baselineGeneration: 0,
      currentFiles: scan.files,
      changes,
      unresolved: [],
      complete: true
    };
  }

  const changes = computePendingChanges(scan.files, baseline);
  return {
    pendingDigest,
    baselineState: "ready",
    baselineGeneration,
    currentFiles: scan.files,
    changes,
    unresolved: [],
    complete: true
  };
}

export function computePendingChanges(
  currentFiles: ReadonlyArray<PublishContentFile>,
  baseline: PublishBaseline
): PublishPendingChange[] {
  const current = new Map(currentFiles.map((file) => [file.logicalPath, file]));
  const changes: PublishPendingChange[] = [];

  for (const file of currentFiles) {
    const baselineDigest = baseline.files[file.logicalPath];
    if (baselineDigest === undefined) {
      changes.push({
        logicalPath: file.logicalPath,
        changeType: "added",
        kind: file.kind,
        currentDigest: file.digest,
        baselineDigest: null,
        firstVerification: false
      });
      continue;
    }
    if (baselineDigest === null) {
      // The baseline proves this path was absent; the file is back.
      changes.push({
        logicalPath: file.logicalPath,
        changeType: "added",
        kind: file.kind,
        currentDigest: file.digest,
        baselineDigest: null,
        firstVerification: false
      });
      continue;
    }
    if (baselineDigest !== file.digest) {
      changes.push({
        logicalPath: file.logicalPath,
        changeType: "modified",
        kind: file.kind,
        currentDigest: file.digest,
        baselineDigest,
        firstVerification: false
      });
    }
  }

  for (const [logicalPath, baselineDigest] of Object.entries(baseline.files)) {
    if (baselineDigest === null) continue; // Already proven absent.
    if (current.has(logicalPath)) continue;
    changes.push({
      logicalPath,
      changeType: "deleted",
      kind: kindForLogicalPath(logicalPath),
      currentDigest: null,
      baselineDigest,
      firstVerification: false
    });
  }

  return changes.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
}

export function kindForLogicalPath(logicalPath: string): PublishContentKind {
  if (logicalPath.startsWith("wiki/")) return "wiki";
  const parts = logicalPath.split("/");
  if (parts[0] === "semantic-layer" && parts[2] === "_schema") return "schema_manifest";
  return "semantic_overlay";
}

// ─── Consumption snapshot ───────────────────────────────────────────────────

export interface PublishConsumptionSnapshot {
  capturedAt: string;
  /** logical path -> digest of the bytes that were about to be consumed. */
  files: Record<string, string | null>;
  /** The digest of this consumption snapshot. */
  digest: string;
  /** The baseline generation this consumption was captured against. */
  baselineGeneration: number;
  /** The pending digest observed at capture time. */
  pendingDigest: string;
}

/**
 * Capture the content version that is ABOUT TO BE consumed by an index run.
 *
 * This must be called BEFORE the index reads the content root. Reading the
 * disk after the index returns and calling that the consumed version would
 * register whatever happens to be on disk at that moment — including a change
 * that landed during the index and was never consumed.
 */
export async function capturePublishConsumption(
  projectRoot: string,
  contentPaths?: ContentPaths
): Promise<PublishConsumptionSnapshot> {
  const paths = contentPaths ?? (await resolveContentPaths(projectRoot));
  const scan = await scanPublishContent(projectRoot, paths);
  const baseline = await readPublishBaseline(projectRoot);
  const files: Record<string, string | null> = {};

  for (const file of scan.files) {
    files[file.logicalPath] = file.digest;
    const bytes = await readContentBytes(paths, file.logicalPath);
    if (bytes) await writePublishBlob(projectRoot, file.digest, bytes);
  }
  // Paths the baseline proves existed but that are gone now are proven absent.
  for (const [logicalPath, digest] of Object.entries(baseline?.files ?? {})) {
    if (digest === null) continue;
    if (logicalPath in files) continue;
    files[logicalPath] = null;
  }

  const canonical = JSON.stringify(
    Object.entries(files)
      .map(([key, value]) => [key, value])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );

  return {
    capturedAt: new Date().toISOString(),
    files,
    digest: sha256(canonical),
    baselineGeneration: baseline?.generation ?? 0,
    pendingDigest: computePendingDigest(
      baseline?.generation ?? 0,
      scan.files
    )
  };
}

async function readContentBytes(
  paths: ContentPaths,
  logicalPath: string
): Promise<Buffer | null> {
  const roots: Array<[string, string]> = [
    ["semantic-layer/", paths.semanticLayer],
    ["wiki/", paths.wiki]
  ];
  for (const [prefix, root] of roots) {
    if (!logicalPath.startsWith(prefix)) continue;
    try {
      return await readFile(path.join(root, logicalPath.slice(prefix.length)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return null;
}

/**
 * Compare the captured consumption snapshot against the current content.
 *
 * A non-empty result means the content changed while the index was running:
 * the index may have consumed a different version than the one that was
 * confirmed, so the baseline must NOT advance and the range stays pending.
 */
export async function detectPublishConsumptionDrift(
  projectRoot: string,
  captured: PublishConsumptionSnapshot,
  contentPaths?: ContentPaths
): Promise<Array<{ logicalPath: string; reason: string }>> {
  const paths = contentPaths ?? (await resolveContentPaths(projectRoot));
  const scan = await scanPublishContent(projectRoot, paths);
  const drift: Array<{ logicalPath: string; reason: string }> = [];

  for (const file of scan.files) {
    const capturedDigest = captured.files[file.logicalPath];
    if (capturedDigest === undefined) {
      drift.push({ logicalPath: file.logicalPath, reason: "changed_during_index" });
      continue;
    }
    if (capturedDigest !== file.digest) {
      drift.push({ logicalPath: file.logicalPath, reason: "changed_during_index" });
    }
  }

  for (const [logicalPath, capturedDigest] of Object.entries(captured.files)) {
    if (capturedDigest === null) continue;
    if (scan.files.some((file) => file.logicalPath === logicalPath)) continue;
    drift.push({ logicalPath, reason: "removed_during_index" });
  }

  return drift.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath));
}

// ─── Attempts ───────────────────────────────────────────────────────────────

export function attemptPath(projectRoot: string, attemptId: string): string {
  return path.join(stateDir(projectRoot, PUBLISH_ATTEMPTS_DIR_REL), `${attemptId}.json`);
}

export async function writePublishAttempt(
  projectRoot: string,
  attempt: PublishAttempt
): Promise<void> {
  await ensureStateDir(projectRoot, PUBLISH_ATTEMPTS_DIR_REL);
  await writeStateFile(
    attemptPath(projectRoot, attempt.attemptId),
    `${JSON.stringify(attempt, null, 2)}\n`
  );
}

export async function readPublishAttempt(
  projectRoot: string,
  attemptId: string
): Promise<PublishAttempt | null> {
  const raw = await readStateFile(attemptPath(projectRoot, attemptId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as PublishAttempt;
    if (parsed?.version !== ATTEMPT_FORMAT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listPublishAttempts(projectRoot: string): Promise<PublishAttempt[]> {
  const dir = stateDir(projectRoot, PUBLISH_ATTEMPTS_DIR_REL);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const attempts: PublishAttempt[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const attempt = await readPublishAttempt(projectRoot, entry.name.replace(/\.json$/, ""));
    if (attempt) attempts.push(attempt);
  }
  return attempts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** Digests that must survive a blob prune: the current baseline + unsettled attempts. */
export async function collectRetainedBlobDigests(
  projectRoot: string
): Promise<Set<string>> {
  const keep = new Set<string>();
  const baseline = await readPublishBaseline(projectRoot);
  for (const digest of Object.values(baseline?.files ?? {})) {
    if (digest) keep.add(digest);
  }
  for (const attempt of await listPublishAttempts(projectRoot)) {
    if (attempt.status === "committed" || attempt.status === "failed") continue;
    for (const digest of Object.values(attempt.consumedFiles ?? {})) {
      if (digest) keep.add(digest);
    }
  }
  return keep;
}
