// A2 follow-up: keep the ktx-facing sibling view in sync with the content root.
//
// M31/A2 made `<contentRoot>/{semantic-layer,wiki,evals,skills}/` (default
// `<projectRoot>/config/`) the single authoring surface for the WebUI, while
// `@kaelio/ktx` still reads those four dirs as siblings of `ktx.yaml` at the
// project root. The Docker entrypoint mirrors the content root into
// `<projectRoot>/runtime/` once per boot, but nothing kept the project-root
// sibling view — the one the ktx daemon and ktx CLI actually read — up to
// date after WebUI writes. The M17 manifest upload was the first visible
// casualty: it wrote to the legacy sibling and the catalog (reading the
// content root) never saw the file.
//
// This module implements a conservative one-way upsert:
//   content root  →  <projectRoot>/{semantic-layer,wiki,evals,skills}/
//
// Rules:
// - Content root wins: a differing or missing destination file is overwritten.
// - Never deletes: files removed from the content root are left alone at the
//   sibling view (pre-A2 customer files must survive; stale-table risk is
//   accepted until ktx natively honours the content root).
// - Never writes through symlinks at either end.
// - `LUCY_CONTENT_ROOT=.` (legacy layout, configDir === projectRoot) is a
//   no-op by construction.

import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { ContentPaths } from "./paths";

const CONTENT_DIR_NAMES = ["semantic-layer", "wiki", "evals", "skills"] as const;

export type ContentMirrorResult = {
  copied: number;
  skipped: number;
  failed: number;
};

/**
 * L25-15 — one file that exists in the content root and differs from (or is
 * missing in) the project-root sibling view. The general mirror upsert copies
 * exactly these files, so they are the "mirror sync write set" of Spec §2.3.
 *
 * The direction is always "sibling view aligns to the content root". A file
 * that only exists in the sibling view is **not** drift: the general mirror
 * never deletes, and the restore plan deletes it on its own terms.
 */
export type MirrorDriftEntry = {
  /** Path relative to the content root, e.g. `semantic-layer/demo/orders.yaml`. */
  contentRelPath: string;
  /** The same relative path under the project root — where ktx reads it. */
  siblingRelPath: string;
  contentDigest: string | null;
  siblingDigest: string | null;
};

async function isRealDir(abs: string): Promise<boolean> {
  try {
    const info = await lstat(abs);
    return info.isDirectory() && !info.isSymbolicLink();
  } catch {
    return false;
  }
}

async function differs(srcAbs: string, destAbs: string): Promise<boolean> {
  try {
    const [src, dest] = await Promise.all([stat(srcAbs), stat(destAbs)]);
    return src.size !== dest.size || src.mtimeMs !== dest.mtimeMs;
  } catch {
    return true;
  }
}

async function mirrorDir(srcDir: string, destDir: string, result: ContentMirrorResult): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const srcAbs = path.join(srcDir, entry.name);
    const destAbs = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (!(await isRealDir(srcAbs))) {
        result.skipped += 1;
        continue;
      }
      await mirrorDir(srcAbs, destAbs, result);
      continue;
    }
    if (!entry.isFile()) {
      result.skipped += 1;
      continue;
    }
    // Source file must not be a symlink; destination must not be one either.
    const srcInfo = await lstat(srcAbs).catch(() => null);
    if (!srcInfo || srcInfo.isSymbolicLink()) {
      result.skipped += 1;
      continue;
    }
    const destInfo = await lstat(destAbs).catch(() => null);
    if (destInfo?.isSymbolicLink()) {
      result.skipped += 1;
      continue;
    }
    if (destInfo && !(await differs(srcAbs, destAbs))) {
      result.skipped += 1;
      continue;
    }
    try {
      await mkdir(path.dirname(destAbs), { recursive: true });
      await copyFile(srcAbs, destAbs);
      // Preserve mtime so the cheap size+mtime `differs` check stays stable
      // across runs instead of re-copying every file on every sync.
      const srcStat = await stat(srcAbs);
      await utimes(destAbs, srcStat.atime, srcStat.mtime);
      result.copied += 1;
    } catch {
      result.failed += 1;
    }
  }
}

/**
 * Mirror one just-written content file into the project-root sibling view.
 * Best-effort and conservative: any symlink in the destination chain aborts
 * the mirror silently — the authoritative copy under the content root is
 * already on disk, and a refused mirror only means the ktx view stays stale
 * until the next full `syncContentToProjectRoot` run.
 *
 * `relPath` must already be normalized (posix separators, no traversal).
 */
export async function mirrorContentFileToProjectRoot(
  projectRootReal: string,
  relPath: string,
  content: string | Buffer
): Promise<void> {
  const destAbs = path.join(projectRootReal, relPath);
  const parts = relPath.split("/").filter((segment) => segment.length > 0);
  let current = projectRootReal;
  for (const segment of parts.slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) break;
    if (info.isSymbolicLink() || !info.isDirectory()) return;
  }
  const destInfo = await lstat(destAbs).catch(() => null);
  if (destInfo?.isSymbolicLink()) return;
  await mkdir(path.dirname(destAbs), { recursive: true });
  await writeFile(destAbs, content);
}

/**
 * One-way upsert of the four content dirs from the content root to the
 * project-root sibling view that ktx reads. Best-effort per file; per-file
 * failures are counted, not thrown, so a single unreadable file cannot break
 * an upload. Check `result.failed` at call sites where staleness is fatal.
 */
export async function syncContentToProjectRoot(
  projectRoot: string,
  contentPaths: ContentPaths
): Promise<ContentMirrorResult> {
  const result: ContentMirrorResult = { copied: 0, skipped: 0, failed: 0 };
  let configDirReal: string;
  let projectRootReal: string;
  try {
    [configDirReal, projectRootReal] = await Promise.all([
      realpath(contentPaths.configDir),
      realpath(projectRoot)
    ]);
  } catch {
    return result;
  }
  if (configDirReal === projectRootReal) {
    // Legacy sibling layout (LUCY_CONTENT_ROOT=.): nothing to mirror.
    return result;
  }
  for (const name of CONTENT_DIR_NAMES) {
    const srcDir = path.join(configDirReal, name);
    if (!(await isRealDir(srcDir))) continue;
    await mirrorDir(srcDir, path.join(projectRootReal, name), result);
  }
  return result;
}

// ─── L25-15: restore-plan controlled mirror surface ───────────────────────
//
// The general mirror above is "upsert everything, never delete". A restore
// needs three things it does not offer:
//
//   1. the exact drift list, so the preview can disclose what the next full
//      upsert would copy (the "mirror sync write set" of Spec §2.3);
//   2. an upsert that copies **only** the verified set, so a drift that
//      appeared after the preview cannot slip through;
//   3. a delete for one exact relative path, because the general mirror never
//      deletes and a restored-to-absent target must disappear from the ktx
//      view as well.
//
// The legacy layout (`LUCY_CONTENT_ROOT=.`) collapses the two surfaces: the
// drift list is empty, the controlled upsert copies nothing, and the
// controlled delete removes nothing — the content root file *is* the file.

function digestOf(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readFileOrNull(abs: string): Promise<Buffer | null> {
  try {
    return await readFile(abs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function resolvedSurfaces(
  projectRoot: string,
  contentPaths: ContentPaths
): Promise<{ contentRootReal: string; projectRootReal: string } | null> {
  try {
    const [contentRootReal, projectRootReal] = await Promise.all([
      realpath(contentPaths.configDir),
      realpath(projectRoot)
    ]);
    if (contentRootReal === projectRootReal) return null;
    return { contentRootReal, projectRootReal };
  } catch {
    return null;
  }
}

async function collectContentRelPaths(
  contentRootReal: string,
  dir: string,
  prefix: string,
  out: string[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name === ".DS_Store") continue;
    const abs = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectContentRelPaths(contentRootReal, abs, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(rel);
  }
}

/**
 * Enumerate the files a full content-root → sibling-view upsert would copy.
 *
 * `exclude` holds relative paths the restore plan handles on its own (the
 * restore write set): those are the restore's controlled mirror targets, not
 * platform drift.
 */
export async function enumerateMirrorDrift(
  projectRoot: string,
  contentPaths: ContentPaths,
  options: { exclude?: ReadonlySet<string> } = {}
): Promise<MirrorDriftEntry[]> {
  const surfaces = await resolvedSurfaces(projectRoot, contentPaths);
  if (!surfaces) return [];
  const { contentRootReal, projectRootReal } = surfaces;
  const rels: string[] = [];
  for (const name of CONTENT_DIR_NAMES) {
    const srcDir = path.join(contentRootReal, name);
    if (!(await isRealDir(srcDir))) continue;
    await collectContentRelPaths(contentRootReal, srcDir, name, rels);
  }
  rels.sort();
  const drift: MirrorDriftEntry[] = [];
  for (const rel of rels) {
    if (options.exclude?.has(rel)) continue;
    const contentAbs = path.join(contentRootReal, rel);
    const siblingAbs = path.join(projectRootReal, rel);
    const [contentBytes, siblingBytes] = await Promise.all([
      readFileOrNull(contentAbs),
      readFileOrNull(siblingAbs)
    ]);
    const contentDigest = contentBytes ? digestOf(contentBytes) : null;
    const siblingDigest = siblingBytes ? digestOf(siblingBytes) : null;
    if (contentDigest === siblingDigest) continue;
    drift.push({
      contentRelPath: rel,
      siblingRelPath: rel,
      contentDigest,
      siblingDigest
    });
  }
  return drift;
}

/**
 * Copy exactly the listed relative paths from the content root to the sibling
 * view. A path outside the four content dirs, or one that resolves through a
 * symlink, is refused rather than written.
 */
export async function upsertVerifiedMirrorFiles(
  projectRoot: string,
  contentPaths: ContentPaths,
  relPaths: readonly string[]
): Promise<{ copied: number; failed: number; failures: string[] }> {
  const result = { copied: 0, failed: 0, failures: [] as string[] };
  const surfaces = await resolvedSurfaces(projectRoot, contentPaths);
  if (!surfaces) return result;
  const { contentRootReal, projectRootReal } = surfaces;
  for (const relPath of relPaths) {
    if (!isMirrorSafeRelPath(relPath)) {
      result.failed += 1;
      result.failures.push(relPath);
      continue;
    }
    const contentAbs = path.join(contentRootReal, relPath);
    const contentBytes = await readFileOrNull(contentAbs);
    if (contentBytes === null) {
      result.failed += 1;
      result.failures.push(relPath);
      continue;
    }
    try {
      await mirrorContentFileToProjectRoot(projectRootReal, relPath, contentBytes);
      result.copied += 1;
    } catch {
      result.failed += 1;
      result.failures.push(relPath);
    }
  }
  return result;
}

/**
 * Delete one exact relative path from the sibling view and read it back.
 *
 * This is the restore plan's controlled delete. It is deliberately separate
 * from `syncContentToProjectRoot`, which keeps its never-deletes contract for
 * every other caller.
 */
export async function deleteMirrorTargetAndVerify(
  projectRoot: string,
  contentPaths: ContentPaths,
  relPath: string
): Promise<{ deleted: boolean; digest: string | null }> {
  const surfaces = await resolvedSurfaces(projectRoot, contentPaths);
  if (!surfaces) {
    // Legacy layout: the content root file is the file. There is no second
    // surface to delete, and the restore's own delete already removed it.
    return { deleted: false, digest: null };
  }
  const { projectRootReal } = surfaces;
  if (!isMirrorSafeRelPath(relPath)) {
    throw new Error(`受控镜像删除拒绝越界路径：${relPath}`);
  }
  const destAbs = path.join(projectRootReal, relPath);
  const parts = relPath.split("/").filter((segment) => segment.length > 0);
  let current = projectRootReal;
  for (const segment of parts.slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (!info) break;
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`受控镜像删除拒绝经过符号链接的路径：${relPath}`);
    }
  }
  const destInfo = await lstat(destAbs).catch(() => null);
  if (destInfo?.isSymbolicLink()) {
    throw new Error(`受控镜像删除拒绝删除符号链接：${relPath}`);
  }
  if (destInfo) {
    await rm(destAbs, { force: true });
  }
  const readBack = await readFileOrNull(destAbs);
  if (readBack !== null) {
    throw new Error(`受控镜像删除后仍能读到目标：${relPath}`);
  }
  return { deleted: destInfo !== null, digest: null };
}

/** Digest of one sibling-view file, or null when it does not exist. */
export async function readMirrorDigest(
  projectRoot: string,
  contentPaths: ContentPaths,
  relPath: string
): Promise<string | null> {
  const surfaces = await resolvedSurfaces(projectRoot, contentPaths);
  if (!surfaces) return null;
  const bytes = await readFileOrNull(path.join(surfaces.projectRootReal, relPath));
  return bytes === null ? null : digestOf(bytes);
}

/** Digests of the listed sibling-view files, keyed by relative path. */
export async function snapshotMirrorDigests(
  projectRoot: string,
  contentPaths: ContentPaths,
  relPaths: readonly string[]
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const relPath of relPaths) {
    out.set(relPath, await readMirrorDigest(projectRoot, contentPaths, relPath));
  }
  return out;
}

function isMirrorSafeRelPath(relPath: string): boolean {
  if (!relPath || relPath.startsWith("/") || relPath.includes("\\") || relPath.includes("\0")) {
    return false;
  }
  const parts = relPath.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) return false;
  return CONTENT_DIR_NAMES.includes(parts[0] as (typeof CONTENT_DIR_NAMES)[number]);
}
