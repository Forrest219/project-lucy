import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Lucy v0.25 — access-configuration recovery gate.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §5.3
 * ("恢复失败则受影响读取和后续写入均失败关闭") and §14.3 (R4 恢复关闭顺序与三态对外结果).
 *
 * Contract:
 * - When a configuration write cannot be rolled back and re-verified, Lucy must not keep
 *   serving permissions from an unknown configuration state. This gate records that
 *   state explicitly and fails closed:
 *     · every subsequent access.yaml write is rejected,
 *     · the effective policy runtime degrades globally, so the data plane denies with
 *       `policy_degraded_deny` instead of serving rows under an unverified policy.
 * - Spec §14.3.1 — the IN-MEMORY LATCH is the primary gate:
 *     · closing is SYNCHRONOUS: the latch is set before the first `await`, so the data
 *       plane and every access write entry point are blocked immediately, not only
 *       after the next policy recompile,
 *     · the durable marker is written afterwards, and a marker that cannot be written
 *       does NOT release the latch.
 * - Spec §14.3.1 — the marker only means 「no recovery required」 when it is ABSENT
 *   (ENOENT) AND there is no unterminated row-policy intent. A marker that cannot be
 *   read, cannot be parsed, misses a field, carries the wrong type or names an unknown
 *   `required` state is 「恢复状态不可证明」and fails closed.
 * - The marker is persisted next to the other durable state (`.ktx-ui/`), so a restart
 *   does not silently clear an unresolved recovery.
 * - The marker is cleared only by an explicit, VERIFIED recovery action.
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

/**
 * The IN-MEMORY latch.
 *
 * It is the authoritative gate inside the running process: it is set
 * synchronously, it never depends on the disk, and it is consulted by the data
 * plane hot path and by every access write entry point.
 */
let recoveryLatch: AccessRecoveryState | null = null;

function recoveryPath(projectRoot: string): string {
  return path.resolve(projectRoot, ACCESS_RECOVERY_REL);
}

/**
 * Spec §14.3.1 — close the gate SYNCHRONOUSLY.
 *
 * This is the first step of the closing sequence and it must not await: the
 * affected reads and the subsequent writes have to be blocked before anything
 * else can fail.
 */
export function setInMemoryRecoveryRequiredSync(input: {
  reason: string;
  operationId?: string;
}): AccessRecoveryState {
  const state: AccessRecoveryState = {
    required: true,
    reason: input.reason,
    operationId: input.operationId,
    since: new Date().toISOString()
  };
  recoveryLatch = state;
  return state;
}

/**
 * Release the in-memory latch.
 *
 * Only a VERIFIED recovery may call this. The durable marker is cleared by
 * {@link clearAccessRecoveryRequired}, which re-reads and re-verifies it.
 */
export function clearInMemoryRecoveryRequiredSync(): void {
  recoveryLatch = null;
}

/**
 * Synchronous view of the recovery latch. Used on the request hot path so a
 * restart that did not yet re-read the marker still fails closed, and so a
 * recovery that just happened is denied immediately.
 */
export function getAccessRecoveryStateSync(): AccessRecoveryState {
  return recoveryLatch ?? { required: false };
}

export function isAccessRecoveryRequired(): boolean {
  return getAccessRecoveryStateSync().required;
}

/** How the durable marker could be read. */
export type AccessRecoveryMarkerRead =
  | { status: "absent" }
  | { status: "present"; state: AccessRecoveryState }
  | { status: "unreadable"; reason: string }
  | { status: "corrupt"; reason: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return true;
  return /no such file/i.test(errorMessage(error));
}

/**
 * Read the durable marker and classify what was found.
 *
 * Only a well-formed `required` boolean is a known state. Everything else is
 * 「恢复状态不可证明」and must fail closed.
 */
export async function readAccessRecoveryMarker(
  projectRoot: string
): Promise<AccessRecoveryMarkerRead> {
  let text: string;
  try {
    text = await readFile(recoveryPath(projectRoot), "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return { status: "absent" };
    return { status: "unreadable", reason: errorMessage(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: "corrupt", reason: `invalid_json:${errorMessage(error)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "corrupt", reason: "marker_root_invalid" };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.required !== "boolean") {
    return { status: "corrupt", reason: "marker_required_state_invalid" };
  }
  for (const key of ["reason", "operationId", "since"] as const) {
    const value = record[key];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return { status: "corrupt", reason: `marker_${key}_invalid` };
    }
  }
  return {
    status: "present",
    state: {
      required: record.required,
      reason: typeof record.reason === "string" ? record.reason : undefined,
      operationId: typeof record.operationId === "string" ? record.operationId : undefined,
      since: typeof record.since === "string" ? record.since : undefined
    }
  };
}

/**
 * Count the access-configuration audit intents that were persisted but never
 * terminated.
 *
 * An unterminated intent means a configuration write may have happened without
 * a terminal record — the on-disk state is not provable. The intents of THIS
 * process that are still in flight are excluded: they are legitimate.
 */
export async function countUnterminatedRowPolicyIntents(): Promise<number | undefined> {
  try {
    const { countUnterminatedAccessConfigIntents } = await import(
      "./admin/config-audit-intents.js"
    );
    return await countUnterminatedAccessConfigIntents();
  } catch {
    // The audit store could not be reached: the state is not provable.
    return undefined;
  }
}

/**
 * Spec §14.3.1 — the MARKER-ONLY state.
 *
 * The in-memory latch wins over the disk: once it is set, only an explicit
 * verified recovery clears it. A marker that could not be written must not
 * release the gate just because the next disk read finds no marker.
 *
 * The unterminated row-policy intents are NOT consulted here. This function is
 * on the policy recompile path, and the affected data plane must not depend on
 * the availability of the audit store — a broken audit database must not be
 * able to take the data plane down. The intents are verified exactly where the
 * spec requires it: at process startup and before every access write.
 */
export async function readAccessRecoveryMarkerState(
  projectRoot: string
): Promise<AccessRecoveryState> {
  const latch = recoveryLatch;
  if (latch?.required) return latch;

  const marker = await readAccessRecoveryMarker(projectRoot);
  if (marker.status === "absent") return { required: false };
  if (marker.status === "unreadable" || marker.status === "corrupt") {
    const reason = `recovery_state_unprovable:${marker.status}:${marker.reason}`;
    return setInMemoryRecoveryRequiredSync({ reason });
  }
  // The marker is present and well-formed.
  if (marker.state.required) {
    const state = { ...marker.state };
    recoveryLatch = state;
    return state;
  }
  return { required: false };
}

/**
 * Spec §14.3.1 — the FULL state.
 *
 * 「No recovery required」 requires BOTH an absent marker AND no unterminated
 * row-policy intent. Everything else fails closed: a marker that cannot be
 * read, cannot be parsed, misses a field, carries the wrong type or names an
 * unknown `required` state is 「恢复状态不可证明」; an intent store that cannot
 * be read is undecidable in the same way.
 *
 * This is the check that guards the access WRITE admission and the process
 * startup. The data plane's policy recompile path uses the marker-only state.
 */
export async function readAccessRecoveryState(projectRoot: string): Promise<AccessRecoveryState> {
  const latch = recoveryLatch;
  if (latch?.required) return latch;

  const markerState = await readAccessRecoveryMarkerState(projectRoot);
  if (markerState.required) return markerState;

  const unterminated = await countUnterminatedRowPolicyIntents();
  if (unterminated === undefined) {
    const reason = "recovery_state_unprovable:audit_store_unreachable";
    return setInMemoryRecoveryRequiredSync({ reason });
  }
  if (unterminated > 0) {
    const reason = `unterminated_row_policy_intents:${unterminated}`;
    return setInMemoryRecoveryRequiredSync({ reason });
  }
  return { required: false };
}

/**
 * Mark the configuration as unrecoverable until an explicit recovery is verified.
 *
 * The marker is written ATOMICALLY: a temp file in the same directory plus a
 * rename. A failed write does NOT release the in-memory latch — the caller must
 * report that the marker could not be persisted.
 */
export async function markAccessRecoveryRequired(
  projectRoot: string,
  input: { reason: string; operationId?: string }
): Promise<AccessRecoveryState> {
  const state = setInMemoryRecoveryRequiredSync(input);
  const abs = recoveryPath(projectRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${randomUUID()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, abs);
  return state;
}

/** Clear the marker after a verified recovery. */
export async function clearAccessRecoveryRequired(projectRoot: string): Promise<void> {
  await rm(recoveryPath(projectRoot), { force: true });
  clearInMemoryRecoveryRequiredSync();
}

/** Throw when writes are blocked by an unresolved recovery. */
export function assertAccessWritesAllowed(state: AccessRecoveryState = getAccessRecoveryStateSync()): void {
  if (state.required) throw new AccessRecoveryRequiredError(state);
}

/**
 * Spec §14.3.1 — the startup verification.
 *
 * Before the affected data plane and the access writes are opened, BOTH the
 * recovery marker AND the unterminated row-policy intents must be checked. Any
 * source that cannot be read, is corrupt or cannot be decided closes the gate
 * conservatively. A corrupt marker is never overwritten automatically.
 */
export interface AccessRecoveryStartupVerification {
  /** True when the gate may stay open. */
  ok: boolean;
  /** True when the gate must be closed. */
  required: boolean;
  reason?: string;
  markerStatus: AccessRecoveryMarkerRead["status"];
  unterminatedIntents?: number;
}

export async function verifyAccessRecoveryOnStartup(
  projectRoot: string
): Promise<AccessRecoveryStartupVerification> {
  const marker = await readAccessRecoveryMarker(projectRoot);
  const unterminated = await countUnterminatedRowPolicyIntents();

  if (unterminated === undefined) {
    const reason = "recovery_state_unprovable:audit_store_unreachable";
    setInMemoryRecoveryRequiredSync({ reason });
    return {
      ok: false,
      required: true,
      reason,
      markerStatus: marker.status,
      unterminatedIntents: undefined
    };
  }

  if (marker.status === "unreadable" || marker.status === "corrupt") {
    const reason = `recovery_state_unprovable:${marker.status}:${marker.reason}`;
    setInMemoryRecoveryRequiredSync({ reason });
    return {
      ok: false,
      required: true,
      reason,
      markerStatus: marker.status,
      unterminatedIntents: unterminated
    };
  }

  if (marker.status === "present" && marker.state.required) {
    setInMemoryRecoveryRequiredSync({
      reason: marker.state.reason ?? "access_recovery_required",
      operationId: marker.state.operationId
    });
    return {
      ok: false,
      required: true,
      reason: marker.state.reason ?? "access_recovery_required",
      markerStatus: marker.status,
      unterminatedIntents: unterminated
    };
  }

  if (unterminated > 0) {
    const reason = `unterminated_row_policy_intents:${unterminated}`;
    setInMemoryRecoveryRequiredSync({ reason });
    return {
      ok: false,
      required: true,
      reason,
      markerStatus: marker.status,
      unterminatedIntents: unterminated
    };
  }

  clearInMemoryRecoveryRequiredSync();
  return {
    ok: true,
    required: false,
    markerStatus: marker.status,
    unterminatedIntents: unterminated
  };
}

/**
 * Spec §14.3.1 — the explicit, VERIFIED recovery action.
 *
 * The gate may only be cleared when the proof holds:
 * - the marker is readable and well-formed (a corrupt marker cannot be cleared
 *   automatically),
 * - every row-policy intent is terminated (reconciled),
 * - the disk configuration and the runtime digest match the expected old policy.
 *
 * After the marker is cleared the state is read again: a failed re-read keeps
 * the gate closed.
 */
export async function performVerifiedRecoveryClear(
  projectRoot: string,
  expected: { accessConfigDigest?: string; runtimePolicyDigest?: string } = {}
): Promise<{ ok: boolean; reason?: string }> {
  const marker = await readAccessRecoveryMarker(projectRoot);
  if (marker.status === "unreadable" || marker.status === "corrupt") {
    const reason = `recovery_state_unprovable:${marker.status}:${marker.reason}`;
    setInMemoryRecoveryRequiredSync({ reason });
    return { ok: false, reason };
  }
  const unterminated = await countUnterminatedRowPolicyIntents();
  if (unterminated === undefined || unterminated > 0) {
    const reason = `unterminated_row_policy_intents:${unterminated ?? "unknown"}`;
    setInMemoryRecoveryRequiredSync({ reason });
    return { ok: false, reason };
  }

  if (expected.accessConfigDigest) {
    try {
      const { readAccessYaml } = await import("./admin/access-config.js");
      const { computeAccessConfigDigest } = await import("./proxy/acl.js");
      const { parse } = await import("yaml");
      const file = await readAccessYaml(projectRoot);
      const actual = computeAccessConfigDigest(parse(file.raw) as never);
      if (actual !== expected.accessConfigDigest) {
        const reason = "recovery_verification_failed:access_config_digest_mismatch";
        setInMemoryRecoveryRequiredSync({ reason });
        return { ok: false, reason };
      }
    } catch (error) {
      const reason = `recovery_verification_failed:${errorMessage(error)}`;
      setInMemoryRecoveryRequiredSync({ reason });
      return { ok: false, reason };
    }
  }

  if (expected.runtimePolicyDigest) {
    try {
      const { getPolicyRuntimeStatus } = await import("./proxy/acl.js");
      const status = getPolicyRuntimeStatus();
      if (status.accessConfigDigest !== expected.runtimePolicyDigest) {
        const reason = "recovery_verification_failed:runtime_digest_mismatch";
        setInMemoryRecoveryRequiredSync({ reason });
        return { ok: false, reason };
      }
    } catch (error) {
      const reason = `recovery_verification_failed:${errorMessage(error)}`;
      setInMemoryRecoveryRequiredSync({ reason });
      return { ok: false, reason };
    }
  }

  await clearAccessRecoveryRequired(projectRoot);

  // Re-read and verify: a failed re-read keeps the gate closed.
  const after = await readAccessRecoveryMarker(projectRoot);
  if (after.status !== "absent") {
    const reason = `recovery_verification_failed:marker_not_cleared:${after.status}`;
    setInMemoryRecoveryRequiredSync({ reason });
    return { ok: false, reason };
  }
  return { ok: true };
}
