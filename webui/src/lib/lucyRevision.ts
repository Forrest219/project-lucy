const SHA_RE = /^[0-9a-f]{40}$/;

export function isRecordedCommit(sha: string): boolean {
  return SHA_RE.test(sha);
}

/** Workspace row on 版本信息. Never includes the word dirty. */
export function formatWorkspaceStatus(sha: string, dirty: boolean): string {
  if (!SHA_RE.test(sha)) return "unknown";
  return dirty ? "构建时工作区有未提交改动" : "与记录的提交一致";
}

export function formatBundledKtxVersion(version: string | null | undefined): string {
  const trimmed = typeof version === "string" ? version.trim() : "";
  return trimmed.length > 0 ? trimmed : "unknown";
}
