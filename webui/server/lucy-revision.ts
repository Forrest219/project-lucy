import { loadClientRevision, loadRuntimeRevision as loadUncachedRuntimeRevision } from "../../scripts/release/lucy-build-revision.mjs";

export type LucyBuildRevision = {
  gitSha: string;
  gitDirty: boolean;
};

let cached: LucyBuildRevision | undefined;

/** Process-lifetime identity. A later LUCY_GIT_SHA env change cannot replace it. */
export function loadRuntimeRevision(): LucyBuildRevision {
  const resolved = cached ?? loadUncachedRuntimeRevision();
  cached = resolved;
  return resolved;
}

export function loadClientBuildRevision(repoRoot?: string): LucyBuildRevision {
  return loadClientRevision(repoRoot ? { repoRoot } : {});
}

/** Compile-time constants. Vite does not inject these through `import.meta.env`. */
export function lucyBuildRevisionDefine(revision: LucyBuildRevision): Record<string, string> {
  return {
    __LUCY_BUILD_GIT_SHA__: JSON.stringify(revision.gitSha),
    __LUCY_BUILD_GIT_DIRTY__: JSON.stringify(revision.gitDirty ? "1" : "0")
  };
}
