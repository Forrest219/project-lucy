import { loadRuntimeRevision as loadUncachedRuntimeRevision } from "../../scripts/release/lucy-build-revision.mjs";

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
