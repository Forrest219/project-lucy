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

import { copyFile, lstat, mkdir, readdir, realpath, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ContentPaths } from "./paths";

const CONTENT_DIR_NAMES = ["semantic-layer", "wiki", "evals", "skills"] as const;

export type ContentMirrorResult = {
  copied: number;
  skipped: number;
  failed: number;
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
