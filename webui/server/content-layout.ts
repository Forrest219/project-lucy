// Spec 180: read-only layout diagnostic for the content root vs. the
// project-root sibling mirror. No writes. Just lists, then returns a
// deterministic diff that mirrors `syncContentToProjectRoot`'s scope:
//   - files that exist only in the mirror (`mirror_only`)
//   - files that exist only in the content root (`authoring_only`)
//
// The cap (200 entries) caps the total diff size, not per dir. Once the cap
// is hit, `driftTruncated` is true and operators should read it as "more
// drift exists than this snapshot can show."

import { lstat, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { ContentPaths } from "./paths";

const CONTENT_DIR_NAMES = ["semantic-layer", "wiki", "evals", "skills"] as const;

export type ContentLayoutDirName = (typeof CONTENT_DIR_NAMES)[number];

export type ContentLayoutDriftKind = "mirror_only" | "authoring_only";

export interface ContentLayoutDriftEntry {
  dir: ContentLayoutDirName;
  relPath: string;
  kind: ContentLayoutDriftKind;
}

export interface ContentLayoutAuthoringMirror {
  semanticLayer: string;
  wiki: string;
  evals: string;
  skills: string;
}

export interface ContentLayoutStatus {
  contentRoot: string;
  contentRootSource: "env" | "yaml" | "default";
  authoring: ContentLayoutAuthoringMirror;
  mirror: ContentLayoutAuthoringMirror;
  /** `false` when contentRoot and projectRoot resolve to the same directory. */
  mirrorActive: boolean;
  drift: ContentLayoutDriftEntry[];
  driftTruncated: boolean;
}

const DRIFT_LIMIT = 200;

// Spec interface uses camelCase field names (semanticLayer) while drift
// entries use kebab-case dir names (semantic-layer). This map bridges them.
const DIR_FIELD: Record<ContentLayoutDirName, keyof ContentLayoutAuthoringMirror> = {
  "semantic-layer": "semanticLayer",
  wiki: "wiki",
  evals: "evals",
  skills: "skills"
};

export async function collectContentLayout(
  projectRoot: string,
  contentPaths: ContentPaths
): Promise<ContentLayoutStatus> {
  const authoring: ContentLayoutAuthoringMirror = {
    semanticLayer: contentPaths.semanticLayer,
    wiki: contentPaths.wiki,
    evals: contentPaths.evals,
    skills: contentPaths.skills
  };
  const mirror: ContentLayoutAuthoringMirror = {
    semanticLayer: path.join(projectRoot, "semantic-layer"),
    wiki: path.join(projectRoot, "wiki"),
    evals: path.join(projectRoot, "evals"),
    skills: path.join(projectRoot, "skills")
  };

  // Use realpath so symlinks (or `..` chains) at the root level cannot fool
  // the mirrorActive check. A missing dir falls back to its lexical path —
  // we still need an honest answer about what the operator is comparing.
  let projectRootReal = path.resolve(projectRoot);
  let configDirReal = path.resolve(contentPaths.configDir);
  try {
    [projectRootReal, configDirReal] = await Promise.all([
      realpath(projectRoot),
      realpath(contentPaths.configDir)
    ]);
  } catch {
    // keep lexical fallbacks; any ENOENT below simply yields an empty listing.
  }

  const mirrorActive = configDirReal !== projectRootReal;
  if (!mirrorActive) {
    // LUCY_CONTENT_ROOT=. (or anything that resolves to projectRoot) means
    // there is no separate authoring surface — no diff to report.
    return {
      contentRoot: contentPaths.configDir,
      contentRootSource: contentPaths.source,
      authoring,
      mirror,
      mirrorActive,
      drift: [],
      driftTruncated: false
    };
  }

  const drift: ContentLayoutDriftEntry[] = [];
  let driftTruncated = false;

  for (const name of CONTENT_DIR_NAMES) {
    if (driftTruncated) break;
    const field = DIR_FIELD[name];
    const [authoringFiles, mirrorFiles] = await Promise.all([
      listFiles(authoring[field]),
      listFiles(mirror[field])
    ]);

    const onlyMirror: string[] = [];
    const onlyAuthoring: string[] = [];
    for (const rel of mirrorFiles) {
      if (!authoringFiles.has(rel)) onlyMirror.push(rel);
    }
    for (const rel of authoringFiles) {
      if (!mirrorFiles.has(rel)) onlyAuthoring.push(rel);
    }
    onlyMirror.sort();
    onlyAuthoring.sort();

    for (const rel of onlyMirror) {
      if (drift.length >= DRIFT_LIMIT) {
        driftTruncated = true;
        break;
      }
      drift.push({ dir: name, relPath: rel, kind: "mirror_only" });
    }
    if (driftTruncated) break;
    for (const rel of onlyAuthoring) {
      if (drift.length >= DRIFT_LIMIT) {
        driftTruncated = true;
        break;
      }
      drift.push({ dir: name, relPath: rel, kind: "authoring_only" });
    }
  }

  return {
    contentRoot: contentPaths.configDir,
    contentRootSource: contentPaths.source,
    authoring,
    mirror,
    mirrorActive,
    drift,
    driftTruncated
  };
}

async function listFiles(rootDir: string): Promise<Set<string>> {
  const out = new Set<string>();
  await walk(rootDir, "", out);
  return out;
}

async function walk(absDir: string, prefix: string, out: Set<string>): Promise<void> {
  let info;
  try {
    info = await lstat(absDir);
  } catch {
    return;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) return;

  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name === ".DS_Store" || entry.name === "." || entry.name === "..") continue;
    const childAbs = path.join(absDir, entry.name);
    const childRel = prefix ? `${prefix}/${entry.name}` : entry.name;
    let childInfo;
    try {
      childInfo = await lstat(childAbs);
    } catch {
      continue;
    }
    if (childInfo.isSymbolicLink()) continue;
    if (childInfo.isDirectory()) {
      await walk(childAbs, childRel, out);
      continue;
    }
    if (childInfo.isFile()) {
      out.add(childRel);
    }
  }
}
