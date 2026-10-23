export type LucyBuildRevision = {
  gitSha: string;
  gitDirty: boolean;
};

export function loadRuntimeRevision(options?: {
  stampPath?: string;
  repoRoot?: string;
}): LucyBuildRevision;

export function loadClientRevision(options?: {
  stampPath?: string;
  repoRoot?: string;
}): LucyBuildRevision;
