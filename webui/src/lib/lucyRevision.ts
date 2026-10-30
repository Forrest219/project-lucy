const SHA_RE = /^[0-9a-f]{40}$/;

export function isRecordedCommit(sha: string): boolean {
  return SHA_RE.test(sha);
}

/** Workspace row on 版本信息. Never includes the word dirty. */
export function formatWorkspaceStatus(sha: string, dirty: boolean): string {
  if (!SHA_RE.test(sha)) return "unknown";
  return dirty ? "构建时工作区有未提交改动" : "与记录的提交一致";
}

/**
 * Visible build commit on 版本信息.
 * Only a full lowercase 40-hex sha is shortened. Anything else is shown as-is
 * so a malformed value never looks like a shortened commit. Missing is unknown.
 */
export function formatVisibleBuildCommit(sha: string | null | undefined): string {
  if (typeof sha !== "string" || sha.length === 0) return "unknown";
  return SHA_RE.test(sha) ? sha.slice(0, 12) : sha;
}

export function formatBundledKtxVersion(version: string | null | undefined): string {
  const trimmed = typeof version === "string" ? version.trim() : "";
  return trimmed.length > 0 ? trimmed : "unknown";
}
