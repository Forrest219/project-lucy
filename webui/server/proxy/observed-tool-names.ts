/**
 * P1-37 U2 — 记住某身份在某策略版本下**真实 `tools/list` 返回过的工具名**。
 *
 * 未知工具名被拒时，响应带的清单必须是该身份真实可见的工具名集合（`allowedToolNames`
 * 只是其上界）。真实清单只在服务 `tools/list` 时才知道，所以在那里记一份；
 * 没有记录（或策略版本已变）时由调用方退回 `allowedToolNames`。只存工具名，不存凭据。
 */
const MAX_ENTRIES = 1024;

type Observed = { policyVersion: string; names: string[] };

const observed = new Map<string, Observed>();

function key(identityId: string, tokenHash: string): string {
  return JSON.stringify([identityId, tokenHash]);
}

export function rememberObservedToolNames(
  identityId: string,
  tokenHash: string,
  policyVersion: string,
  names: readonly string[]
): void {
  const k = key(identityId, tokenHash);
  observed.delete(k);
  observed.set(k, { policyVersion, names: [...new Set(names)].sort() });
  while (observed.size > MAX_ENTRIES) {
    const oldest = observed.keys().next().value;
    if (oldest === undefined) break;
    observed.delete(oldest);
  }
}

export function recallObservedToolNames(
  identityId: string,
  tokenHash: string,
  policyVersion: string
): string[] | undefined {
  const entry = observed.get(key(identityId, tokenHash));
  if (!entry || entry.policyVersion !== policyVersion) return undefined;
  return entry.names;
}

/** 测试辅助。 */
export function resetObservedToolNamesForTests(): void {
  observed.clear();
}
