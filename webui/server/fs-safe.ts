import { lstat, mkdir, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mirrorContentFileToProjectRoot } from "./content-mirror";
import type { ContentPaths } from "./paths";

/**
 * Content-dir prefixes. These resolve relative to {@link ContentPaths.configDir},
 * which defaults to `<projectRoot>/config/` (see `./paths.ts`) and can be
 * overridden via `LUCY_CONTENT_ROOT` or `ktx.yaml` `paths.content_root`.
 *
 * Legacy callers passing `LUCY_CONTENT_ROOT=.` see the old behavior because
 * `configDir` then equals `projectRoot`.
 */
const CONTENT_PREFIXES = ["semantic-layer", "evals", "skills", "wiki"] as const;

/** Project-root-only prefixes (always resolved against `projectRoot`, never against `configDir`). */
const ROOT_PREFIXES = [".ktx-ui", "webui/config"] as const;

const DENY = [".ktx/secrets", "raw-sources", ".git"];
const ROOT_FILES = ["ktx.yaml"];

export class ForbiddenPathError extends Error {
  code = "FORBIDDEN_PATH";
  statusCode = 403;

  constructor(message: string) {
    super(message);
    this.name = "ForbiddenPathError";
  }
}

function normalizeRelative(relPath: string): string {
  if (!relPath || path.isAbsolute(relPath)) {
    throw new ForbiddenPathError("Path must be relative to the project root");
  }

  const normalized = path.normalize(relPath).replaceAll(path.sep, "/");
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new ForbiddenPathError("Path traversal is not allowed");
  }

  return normalized;
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function matchesPrefix(relPath: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}

async function resolveExistingTarget(base: string, relPath: string): Promise<string> {
  const baseReal = await realpath(base);
  const parts = relPath.split("/");
  let existing = baseReal;
  let index = 0;

  for (; index < parts.length; index += 1) {
    const next = path.join(existing, parts[index]);
    try {
      existing = await realpath(next);
    } catch {
      break;
    }
  }

  return path.join(existing, ...parts.slice(index));
}

/**
 * Resolve a content-dir-relative path (`semantic-layer/...`, `wiki/...`, ...).
 * The base is `contentPaths.configDir`, NOT `projectRoot`, so a default
 * WebUI now writes to `<projectRoot>/config/semantic-layer/...`. With
 * `LUCY_CONTENT_ROOT=.`, this degrades to the legacy sibling layout.
 */
async function resolveContentTarget(
  contentPaths: ContentPaths,
  normalized: string
): Promise<string> {
  const configDirReal = await realpath(contentPaths.configDir);
  const target = await resolveExistingTarget(contentPaths.configDir, normalized);
  if (!isWithin(target, configDirReal)) {
    throw new ForbiddenPathError("Resolved path escapes the content root");
  }

  const targetRel = path.relative(configDirReal, target).replaceAll(path.sep, "/");
  if (!matchesPrefix(targetRel, CONTENT_PREFIXES)) {
    throw new ForbiddenPathError(`Resolved path ${targetRel} is not writable`);
  }
  return target;
}

/**
 * Resolve a project-root-relative path (`webui/config/...`, `.ktx-ui/...`,
 * or one of {@link ROOT_FILES} such as `ktx.yaml`). Refuses symlinks for
 * ALLOW_FILES (Spec 124: ktx.yaml must not be a symlink that escapes the
 * project root).
 */
async function resolveRootTarget(projectRoot: string, normalized: string): Promise<string> {
  const rootReal = await realpath(projectRoot);
  const literalTarget = path.join(rootReal, normalized);
  let target = literalTarget;
  try {
    const targetStat = await lstat(literalTarget);
    if (targetStat.isSymbolicLink()) {
      throw new ForbiddenPathError(`Writing symlinked allow-file ${normalized} is forbidden`);
    }
    target = await realpath(literalTarget);
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!isWithin(target, rootReal)) {
    throw new ForbiddenPathError("Resolved path escapes the project root");
  }
  const targetRel = path.relative(rootReal, target).replaceAll(path.sep, "/");
  if (!matchesPrefix(targetRel, ROOT_PREFIXES) && !ROOT_FILES.includes(targetRel)) {
    throw new ForbiddenPathError(`Resolved path ${targetRel} is not writable`);
  }
  return target;
}

/**
 * Resolve a writable path under either the content root (configurable) or
 * the project root (fixed). The function inspects the path prefix to pick
 * the right base — callers don't have to know which namespace they are in.
 *
 *   semantic-layer/... → <configDir>/semantic-layer/...
 *   wiki/...           → <configDir>/wiki/...
 *   evals/...          → <configDir>/evals/...
 *   skills/...         → <configDir>/skills/...
 *   webui/config/...   → <projectRoot>/webui/config/...
 *   .ktx-ui/...        → <projectRoot>/.ktx-ui/...
 *   ktx.yaml           → <projectRoot>/ktx.yaml
 */
export async function resolveWritable(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string
): Promise<string> {
  const normalized = normalizeRelative(relPath);
  if (matchesPrefix(normalized, DENY)) {
    throw new ForbiddenPathError(`Writing ${normalized} is forbidden`);
  }

  if (matchesPrefix(normalized, CONTENT_PREFIXES)) {
    return resolveContentTarget(contentPaths, normalized);
  }
  if (matchesPrefix(normalized, ROOT_PREFIXES) || ROOT_FILES.includes(normalized)) {
    return resolveRootTarget(projectRoot, normalized);
  }

  throw new ForbiddenPathError(`Writing ${normalized} is outside allowed directories`);
}

/**
 * A2: after a successful content-root write, keep the ktx-facing sibling
 * view (`<projectRoot>/{semantic-layer,wiki,evals,skills}/`) in sync. ktx
 * still reads those dirs as siblings of ktx.yaml, so without the mirror a
 * WebUI-authored wiki page or overlay would be invisible to query
 * execution. Best-effort: a refused/failed mirror never fails the primary
 * write; staleness is reconciled by the next full sync
 * (`syncContentToProjectRoot` on upload / before ktx invocations).
 * No-op for the legacy layout (LUCY_CONTENT_ROOT=.).
 */
async function mirrorWriteToSiblingView(
  contentPaths: ContentPaths,
  projectRoot: string,
  normalized: string,
  content: string | Buffer
): Promise<void> {
  if (!matchesPrefix(normalized, CONTENT_PREFIXES)) return;
  let configDirReal: string;
  let rootReal: string;
  try {
    [configDirReal, rootReal] = await Promise.all([
      realpath(contentPaths.configDir),
      realpath(projectRoot)
    ]);
  } catch {
    return;
  }
  if (configDirReal === rootReal) return;
  await mirrorContentFileToProjectRoot(rootReal, normalized, content).catch(() => undefined);
}

export async function safeWrite(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string,
  content: string
): Promise<void> {
  const normalized = normalizeRelative(relPath);
  const target = await resolveWritable(contentPaths, projectRoot, normalized);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  await mirrorWriteToSiblingView(contentPaths, projectRoot, normalized, content);
}

/** Binary-safe write under the same allow-list as `safeWrite` (e.g. customer logo). */
export async function safeWriteBinary(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string,
  content: Buffer
): Promise<void> {
  const normalized = normalizeRelative(relPath);
  const target = await resolveWritable(contentPaths, projectRoot, normalized);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  await mirrorWriteToSiblingView(contentPaths, projectRoot, normalized, content);
}

export async function safeMkdir(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string
): Promise<void> {
  const target = await resolveWritable(contentPaths, projectRoot, relPath);
  await mkdir(target, { recursive: true });
}

export async function safeRemove(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string
): Promise<void> {
  const target = await resolveWritable(contentPaths, projectRoot, relPath);
  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) {
      throw new ForbiddenPathError(`Removing symlinked path ${relPath} is forbidden`);
    }
    if (targetStat.isDirectory()) {
      throw new ForbiddenPathError(`Removing directory ${relPath} is forbidden`);
    }
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  await rm(target, { force: true });
}

/**
 * Raised by `safeRemoveDirectory` when the target directory is not empty.
 *
 * Callers can translate this into a domain-specific error code (for
 * example `WIKI_DIRECTORY_NOT_EMPTY`) without losing the underlying
 * cause. Keeping the class here lets callers stay agnostic to which
 * filesystem call detected the empty state.
 */
export class DirectoryNotEmptyError extends Error {
  code = "DIRECTORY_NOT_EMPTY";
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "DirectoryNotEmptyError";
  }
}

/**
 * Remove an empty directory under an allow-listed prefix (typically `wiki/`).
 *
 * M56 UX-WIKI-010: directory deletion is opt-in and conservative. We refuse
 * symlinks (which may bypass the allow list via realpath) and refuse to
 * recurse — non-empty directories raise {@link DirectoryNotEmptyError} so
 * the caller can prompt the user to clear the contents first.
 */
export async function safeRemoveDirectory(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string
): Promise<void> {
  const target = await resolveWritable(contentPaths, projectRoot, relPath);
  let targetStat: Awaited<ReturnType<typeof lstat>>;
  try {
    targetStat = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (targetStat.isSymbolicLink()) {
    throw new ForbiddenPathError(`Removing symlinked directory ${relPath} is forbidden`);
  }
  if (!targetStat.isDirectory()) {
    throw new ForbiddenPathError(`Path ${relPath} is not a directory`);
  }
  const entries = await readdir(target);
  if (entries.length > 0) {
    throw new DirectoryNotEmptyError(`Directory ${relPath} is not empty`);
  }
  // `rm` on macOS refuses to remove a directory without `recursive`,
  // and `rmdir` already enforces the "empty" invariant we just
  // verified, so it is the safe primitive here.
  await rmdir(target);
}

/**
 * Rename a directory under an allow-listed prefix (typically `wiki/`).
 *
 * Spec 109: used for same-parent Wiki directory rename. Refuses
 * symlinks and refuses to overwrite an existing target.
 */
export async function safeRenameDirectory(
  contentPaths: ContentPaths,
  projectRoot: string,
  sourceRelPath: string,
  targetRelPath: string
): Promise<void> {
  const source = await resolveWritable(contentPaths, projectRoot, sourceRelPath);
  const target = await resolveWritable(contentPaths, projectRoot, targetRelPath);

  let sourceStat: Awaited<ReturnType<typeof lstat>>;
  try {
    sourceStat = await lstat(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ForbiddenPathError(`Source directory ${sourceRelPath} does not exist`);
    }
    throw error;
  }
  if (sourceStat.isSymbolicLink()) {
    throw new ForbiddenPathError(`Renaming symlinked directory ${sourceRelPath} is forbidden`);
  }
  if (!sourceStat.isDirectory()) {
    throw new ForbiddenPathError(`Path ${sourceRelPath} is not a directory`);
  }

  try {
    const targetStat = await lstat(target);
    if (targetStat.isSymbolicLink()) {
      throw new ForbiddenPathError(`Target path ${targetRelPath} is a symlink`);
    }
    throw new ForbiddenPathError(`Target path ${targetRelPath} already exists`);
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await rename(source, target);
}

/**
 * Assert a relative path is readable. Permissive by design — anything under
 * `configDir` or `projectRoot` is readable except `.ktx/secrets/`. Content
 * paths resolve from `contentPaths.configDir` (configurable); root paths
 * resolve from `projectRoot`.
 */
export async function assertReadable(
  contentPaths: ContentPaths,
  projectRoot: string,
  relPath: string
): Promise<string> {
  const normalized = normalizeRelative(relPath);
  if (matchesPrefix(normalized, [".ktx/secrets"])) {
    throw new ForbiddenPathError(`Reading ${normalized} is forbidden`);
  }

  const isContentPath = matchesPrefix(normalized, CONTENT_PREFIXES);
  const base = isContentPath ? contentPaths.configDir : projectRoot;
  const baseReal = await realpath(base);
  const target = await resolveExistingTarget(base, normalized);
  if (!isWithin(target, baseReal)) {
    throw new ForbiddenPathError("Resolved path escapes the project root");
  }

  const targetRel = path.relative(baseReal, target).replaceAll(path.sep, "/");
  if (matchesPrefix(targetRel, [".ktx/secrets"])) {
    throw new ForbiddenPathError(`Reading ${targetRel} is forbidden`);
  }

  return target;
}

/**
 * Spec 124 Phase A: narrow write exception for one-shot connection passwords.
 *
 * General `safeWrite` / `assertReadable` still DENY `.ktx/secrets/**`.
 * Only this helper may create a brand-new file matching:
 * `.ktx/secrets/<connId>-password` where connId is `[a-z][a-z0-9_-]{1,63}`.
 *
 * Refuses: read APIs, listing, overwrite, symlinks, path traversal, other names.
 *
 * Note: secret passwords live under `<projectRoot>/.ktx/secrets/...` —
 * independent of the A2 content root resolver, so this API stays
 * project-root-only and does NOT take a ContentPaths parameter.
 */
export const SECRET_PASSWORD_REL_PATH_PATTERN =
  "^\\.ktx/secrets/([a-z][a-z0-9_-]{1,63})-password$";
const SECRET_PASSWORD_REL_PATH_RE = new RegExp(SECRET_PASSWORD_REL_PATH_PATTERN);

export class SecretAlreadyExistsError extends Error {
  code = "SECRET_ALREADY_EXISTS";
  statusCode = 409;

  constructor(message: string) {
    super(message);
    this.name = "SecretAlreadyExistsError";
  }
}

export function assertSecretPasswordRelPath(relPath: string): string {
  if (typeof relPath !== "string" || relPath.includes("..")) {
    throw new ForbiddenPathError("Path traversal is not allowed");
  }
  const normalized = normalizeRelative(relPath);
  if (!SECRET_PASSWORD_REL_PATH_RE.test(normalized)) {
    throw new ForbiddenPathError(
      `Secret path '${normalized}' is not an allowed connection password file`
    );
  }
  return normalized;
}

async function resolveNewSecretPasswordTarget(
  projectRoot: string,
  relPath: string
): Promise<{ rootReal: string; secretsDirReal: string; target: string; normalized: string }> {
  const normalized = assertSecretPasswordRelPath(relPath);
  const rootReal = await realpath(projectRoot);
  const ktxDir = path.join(rootReal, ".ktx");
  await mkdir(ktxDir, { recursive: true });
  const secretsDir = path.join(ktxDir, "secrets");
  await mkdir(secretsDir, { recursive: true });

  let secretsDirReal: string;
  try {
    const secretsStat = await lstat(secretsDir);
    if (secretsStat.isSymbolicLink()) {
      throw new ForbiddenPathError("Writing through a symlinked .ktx/secrets directory is forbidden");
    }
    secretsDirReal = await realpath(secretsDir);
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    throw error;
  }

  if (!isWithin(secretsDirReal, rootReal)) {
    throw new ForbiddenPathError("Secrets directory escapes the project root");
  }
  const expectedSecretsRel = path.relative(rootReal, secretsDirReal).replaceAll(path.sep, "/");
  if (expectedSecretsRel !== ".ktx/secrets") {
    throw new ForbiddenPathError(`Resolved secrets directory ${expectedSecretsRel} is not writable`);
  }

  const fileName = path.basename(normalized);
  const target = path.join(secretsDirReal, fileName);
  if (!isWithin(target, secretsDirReal)) {
    throw new ForbiddenPathError("Secret path escapes the secrets directory");
  }
  return { rootReal, secretsDirReal, target, normalized };
}

export async function safeWriteNewSecretPassword(
  projectRoot: string,
  relPath: string,
  passwordPlaintext: string
): Promise<{ relPath: string }> {
  if (typeof passwordPlaintext !== "string" || passwordPlaintext.length === 0) {
    throw new ForbiddenPathError("Connection password must be a non-empty string");
  }

  const { target, normalized } = await resolveNewSecretPasswordTarget(projectRoot, relPath);

  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink()) {
      throw new ForbiddenPathError(`Secret path ${normalized} is a symlink`);
    }
    throw new SecretAlreadyExistsError(`Password file '${normalized}' already exists`);
  } catch (error) {
    if (error instanceof ForbiddenPathError || error instanceof SecretAlreadyExistsError) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(target, passwordPlaintext, { encoding: "utf8", mode: 0o600 });
  return { relPath: normalized };
}

/**
 * Rollback helper for Spec 124 create-connection. Only deletes the exact
 * allowed password filename; no-ops on ENOENT. Never follows symlinks.
 */
export async function safeRemoveSecretPasswordIfExists(
  projectRoot: string,
  relPath: string
): Promise<void> {
  const { target, normalized } = await resolveNewSecretPasswordTarget(projectRoot, relPath);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink()) {
      throw new ForbiddenPathError(`Removing symlinked secret ${normalized} is forbidden`);
    }
    if (existing.isDirectory()) {
      throw new ForbiddenPathError(`Secret path ${normalized} is a directory`);
    }
  } catch (error) {
    if (error instanceof ForbiddenPathError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  await rm(target, { force: true });
}