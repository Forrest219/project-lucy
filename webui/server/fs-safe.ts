import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
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
