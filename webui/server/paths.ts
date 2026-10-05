/**
 * Content root resolver (A2).
 *
 * WebUI/MCP Proxy loads `semantic-layer/`, `wiki/`, `evals/`, `skills/` from
 * a single configurable root instead of requiring them as siblings of
 * `ktx.yaml`. Default = `<projectRoot>/config/`. Override via the
 * `LUCY_CONTENT_ROOT` env var or a top-level `paths.content_root` key in
 * `ktx.yaml`. See `docs/plans/M31-config-subdir-migration.md`.
 *
 * NOTE: `@kaelio/ktx` (the MCP server) still requires sibling layout;
 * `runtime/{4 dirs}` mirror continues to be populated by an out-of-process
 * sync step. This module is WebUI-side only.
 */

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { ProjectError } from "./project";

const CONTENT_DIR_NAMES = ["semantic-layer", "wiki", "evals", "skills"] as const;
export type ContentDirName = (typeof CONTENT_DIR_NAMES)[number];

export interface ContentPaths {
  /** Resolved absolute path to the content root. */
  configDir: string;
  semanticLayer: string;
  wiki: string;
  evals: string;
  skills: string;
  /** Which resolution rule won. */
  source: "env" | "yaml" | "default";
}

let cached: ContentPaths | null = null;

/**
 * Resolve the four content directories for `projectRoot`. Pure function —
 * does not read disk beyond `ktx.yaml` and does not create any directories.
 */
export async function resolveContentPaths(projectRoot: string): Promise<ContentPaths> {
  const envValue = process.env.LUCY_CONTENT_ROOT?.trim();
  if (envValue) {
    return build(envValue, projectRoot, "env");
  }

  const yamlValue = await readKtxYamlContentRoot(projectRoot);
  if (yamlValue) {
    return build(yamlValue, projectRoot, "yaml");
  }

  return build(null, projectRoot, "default");
}

/**
 * Cached singleton entry point. Uses `resolveProjectRoot()` internally.
 * On cold start (cache miss), also `ensureContentDirs` so the four subdirs
 * exist before any consumer tries to read or write. Idempotent.
 *
 * Call `invalidateContentPathsCache()` from anywhere that mutates
 * `LUCY_CONTENT_ROOT` or rewrites `ktx.yaml`.
 */
export async function loadContentPaths(): Promise<ContentPaths> {
  if (cached) return cached;
  const { resolveProjectRoot } = await import("./project");
  const projectRoot = await resolveProjectRoot();
  const resolved = await resolveContentPaths(projectRoot);
  await ensureContentDirs(resolved);
  cached = resolved;
  return cached;
}

/** Drop the cached value so the next `loadContentPaths()` re-reads env / ktx.yaml. */
export function invalidateContentPathsCache(): void {
  cached = null;
}

/** mkdir -p the four subdirs under the resolved content root. Idempotent. */
export async function ensureContentDirs(paths: ContentPaths): Promise<void> {
  try {
    await Promise.all(
      CONTENT_DIR_NAMES.map((name) =>
        mkdir(path.join(paths.configDir, name), { recursive: true })
      )
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | { code?: string }).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new ProjectError(
        `Cannot create content dirs under ${paths.configDir} (${code}). ` +
        `Check that the Lucy process has write access. ` +
        `Override via LUCY_CONTENT_ROOT or ktx.yaml paths.content_root.`
      );
    }
    throw error;
  }
}

// --- internals ---------------------------------------------------------------

function build(
  raw: string | null,
  projectRoot: string,
  source: ContentPaths["source"]
): ContentPaths {
  const configDir = raw === null
    ? path.join(projectRoot, "config")
    : resolveAgainstRoot(raw, projectRoot);
  return {
    configDir,
    semanticLayer: path.join(configDir, "semantic-layer"),
    wiki: path.join(configDir, "wiki"),
    evals: path.join(configDir, "evals"),
    skills: path.join(configDir, "skills"),
    source
  };
}

function resolveAgainstRoot(value: string, projectRoot: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(projectRoot, value);
}

async function readKtxYamlContentRoot(projectRoot: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(projectRoot, "ktx.yaml"), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const pathsBlock = (parsed as Record<string, unknown>).paths;
  if (!pathsBlock || typeof pathsBlock !== "object") return null;
  const value = (pathsBlock as Record<string, unknown>).content_root;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}