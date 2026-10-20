#!/usr/bin/env node
// Build identity for the running Lucy source tree.
// Product version stays in VERSION / LUCY_VERSION. This module records the git
// commit that was actually built, and runtime code must not accept a replacement.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/;
export const UNKNOWN_REVISION = Object.freeze({ gitSha: "unknown", gitDirty: false });
export const DEFAULT_STAMP_PATH = "/app/BUILD_REVISION";
export const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function parseStampText(text) {
  const line = String(text ?? "").split(/\r?\n/, 1)[0].trim();
  if (line === "unknown") return { gitSha: "unknown", gitDirty: false };
  const dirty = line.endsWith("-dirty");
  const sha = dirty ? line.slice(0, -"-dirty".length) : line;
  if (!SHA_RE.test(sha)) return null;
  return { gitSha: sha, gitDirty: dirty };
}

export function stampLine(revision) {
  if (!revision || revision.gitSha === "unknown") return "unknown";
  return revision.gitDirty ? `${revision.gitSha}-dirty` : revision.gitSha;
}

export function revisionFromBuildArgs(sha, dirtyFlag) {
  const trimmed = String(sha ?? "").trim();
  if (!SHA_RE.test(trimmed)) return { ...UNKNOWN_REVISION };
  return { gitSha: trimmed, gitDirty: String(dirtyFlag ?? "").trim() === "1" };
}

function readStamp(stampPath) {
  try {
    return parseStampText(readFileSync(stampPath, "utf8")) ?? { ...UNKNOWN_REVISION };
  } catch {
    return { ...UNKNOWN_REVISION };
  }
}

export function readSourceGitRevision(repoRoot) {
  if (!repoRoot || !existsSync(path.join(repoRoot, ".git"))) return null;
  try {
    const sha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    if (!SHA_RE.test(sha)) return null;
    const porcelain = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return { gitSha: sha, gitDirty: porcelain.trim().length > 0 };
  } catch {
    return null;
  }
}

// Image/runtime identity. A stamp file, including an invalid one, is final.
// This function must not read LUCY_GIT_SHA.
export function loadRuntimeRevision({ stampPath = DEFAULT_STAMP_PATH, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  if (existsSync(stampPath)) return readStamp(stampPath);
  return readSourceGitRevision(repoRoot) ?? { ...UNKNOWN_REVISION };
}

// Bundle identity. Source git wins over a build arg so a developer env cannot
// relabel a real checkout. The Docker build writes the stamp before Vite runs.
export function loadClientRevision({ stampPath = DEFAULT_STAMP_PATH, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  if (existsSync(stampPath)) return readStamp(stampPath);
  const git = readSourceGitRevision(repoRoot);
  if (git) return git;
  return revisionFromBuildArgs(process.env.LUCY_GIT_SHA, process.env.LUCY_GIT_DIRTY);
}

function main() {
  const sha = process.env.LUCY_GIT_SHA ?? "";
  if (sha.trim() !== "" && !SHA_RE.test(sha.trim())) {
    console.error(`FAIL: LUCY_GIT_SHA must be 40 lowercase hex or empty; got ${JSON.stringify(sha)}`);
    process.exit(1);
  }
  const revision = revisionFromBuildArgs(sha, process.env.LUCY_GIT_DIRTY);
  const out = process.argv[2] || DEFAULT_STAMP_PATH;
  writeFileSync(out, `${stampLine(revision)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
