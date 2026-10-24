import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Lucy v0.25 — access-configuration recovery gate.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §5.3
 * ("恢复失败则受影响读取和后续写入均失败关闭").
 *
 * Contract:
 * - When a configuration write cannot be rolled back and re-verified, Lucy must not keep
 *   serving permissions from an unknown configuration state. This gate records that
 *   state explicitly and fails closed:
 *     · every subsequent access.yaml write is rejected,
 *     · the effective policy runtime degrades globally, so the data plane denies with
 *       `policy_degraded_deny` instead of serving rows under an unverified policy.
 * - The marker is persisted next to the other durable state (`.ktx-ui/`), so a restart
 *   does not silently clear an unresolved recovery.
 * - The marker is cleared only by an explicit, verified recovery action.
 */

export const ACCESS_RECOVERY_REL = ".ktx-ui/access-recovery.json";

export interface AccessRecoveryState {
  required: boolean;
  reason?: string;
  operationId?: string;
  since?: string;
}

export class AccessRecoveryRequiredError extends Error {
  readonly code = "ACCESS_RECOVERY_REQUIRED";

  constructor(state: AccessRecoveryState) {
    super(
      `访问控制配置处于待恢复状态，已阻断后续写入。原因：${state.reason ?? "unknown"}。请先完成恢复核验。`
    );
    this.name = "AccessRecoveryRequiredError";
  }
}

let cachedState: AccessRecoveryState | null = null;

function recoveryPath(projectRoot: string): string {
  return path.resolve(projectRoot, ACCESS_RECOVERY_REL);
}

/** Read the persisted recovery marker. A missing or unreadable marker means "not required". */
export async function readAccessRecoveryState(projectRoot: string): Promise<AccessRecoveryState> {
  try {
    const text = await readFile(recoveryPath(projectRoot), "utf8");
    const parsed = JSON.parse(text) as Partial<AccessRecoveryState>;
    cachedState = { required: parsed?.required === true, reason: parsed?.reason, operationId: parsed?.operationId, since: parsed?.since };
    return cachedState;
  } catch {
    cachedState = { required: false };
    return cachedState;
  }
}

/**
 * Synchronous view of the recovery marker. Used on the request hot path so a restart
 * that did not yet re-read the marker still fails closed.
 */
export function getAccessRecoveryStateSync(): AccessRecoveryState {
  return cachedState ?? { required: false };
}

export function isAccessRecoveryRequired(): boolean {
  return getAccessRecoveryStateSync().required;
}

/** Mark the configuration as unrecoverable until an explicit recovery is verified. */
export async function markAccessRecoveryRequired(
  projectRoot: string,
  input: { reason: string; operationId?: string }
): Promise<AccessRecoveryState> {
  const state: AccessRecoveryState = {
    required: true,
    reason: input.reason,
    operationId: input.operationId,
    since: new Date().toISOString()
  };
  const abs = recoveryPath(projectRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(state, null, 2), "utf8");
  cachedState = state;
  return state;
}

/** Clear the marker after a verified recovery. */
export async function clearAccessRecoveryRequired(projectRoot: string): Promise<void> {
  await rm(recoveryPath(projectRoot), { force: true });
  cachedState = { required: false };
}

/** Throw when writes are blocked by an unresolved recovery. */
export function assertAccessWritesAllowed(state: AccessRecoveryState = getAccessRecoveryStateSync()): void {
  if (state.required) throw new AccessRecoveryRequiredError(state);
}
