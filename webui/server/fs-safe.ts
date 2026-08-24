import { lstat, mkdir, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ALLOW = ["semantic-layer", "evals", "skills", "wiki", ".ktx-ui", "webui/config"];
const DENY = [".ktx/secrets", "raw-sources", ".git"];
const ALLOW_FILES = ["ktx.yaml"];

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

function matchesPrefix(relPath: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => relPath === prefix || relPath.startsWith(`${prefix}/`));
}

async function resolveExistingTarget(projectRoot: string, relPath: string): Promise<string> {
  const rootReal = await realpath(projectRoot);
  const parts = relPath.split("/");
  let existing = rootReal;
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

export async function resolveWritable(projectRoot: string, relPath: string): Promise<string> {
  const normalized = normalizeRelative(relPath);
  if (matchesPrefix(normalized, DENY)) {
    throw new ForbiddenPathError(`Writing ${normalized} is forbidden`);
  }

  if (ALLOW_FILES.includes(normalized)) {
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
    if (targetRel !== normalized) {
      throw new ForbiddenPathError(`Resolved path ${targetRel} is not an allowed file`);
    }
    return target;
  }

  if (!matchesPrefix(normalized, ALLOW)) {
    throw new ForbiddenPathError(`Writing ${normalized} is outside allowed directories`);
  }

  const rootReal = await realpath(projectRoot);
  const target = await resolveExistingTarget(projectRoot, normalized);
  if (!isWithin(target, rootReal)) {
    throw new ForbiddenPathError("Resolved path escapes the project root");
  }

  const targetRel = path.relative(rootReal, target).replaceAll(path.sep, "/");
  if (matchesPrefix(targetRel, DENY) || !matchesPrefix(targetRel, ALLOW)) {
    throw new ForbiddenPathError(`Resolved path ${targetRel} is not writable`);
  }

  return target;
}

export async function safeWrite(projectRoot: string, relPath: string, content: string): Promise<void> {
  const target = await resolveWritable(projectRoot, relPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

export async function safeMkdir(projectRoot: string, relPath: string): Promise<void> {
  const target = await resolveWritable(projectRoot, relPath);
  await mkdir(target, { recursive: true });
}

export async function safeRemove(projectRoot: string, relPath: string): Promise<void> {
  const target = await resolveWritable(projectRoot, relPath);
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
export async function safeRemoveDirectory(projectRoot: string, relPath: string): Promise<void> {
  const target = await resolveWritable(projectRoot, relPath);
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
  projectRoot: string,
  sourceRelPath: string,
  targetRelPath: string
): Promise<void> {
  const source = await resolveWritable(projectRoot, sourceRelPath);
  const target = await resolveWritable(projectRoot, targetRelPath);

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

export async function assertReadable(projectRoot: string, relPath: string): Promise<string> {
  const normalized = normalizeRelative(relPath);
  if (matchesPrefix(normalized, [".ktx/secrets"])) {
    throw new ForbiddenPathError(`Reading ${normalized} is forbidden`);
  }

  const rootReal = await realpath(projectRoot);
  const target = await resolveExistingTarget(projectRoot, normalized);
  if (!isWithin(target, rootReal)) {
    throw new ForbiddenPathError("Resolved path escapes the project root");
  }

  const targetRel = path.relative(rootReal, target).replaceAll(path.sep, "/");
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
