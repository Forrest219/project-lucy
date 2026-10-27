import type { AccessWriteAck } from "./types";

/**
 * Lucy v0.25 (L25-14 §14.3.2) — the three terminal states of an access write.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §14.3.2 (API 与用户可见结果).
 *
 * Contract:
 * - Only `committed` may be shown as a success.
 * - `rolled_back` means the new change was NOT saved and the old configuration and
 *   the old policy were verified back.
 * - `recovery_required` means the affected reads and the subsequent writes are
 *   blocked and a human has to verify the recovery.
 * - The UI must NOT derive the outcome from the HTTP status alone, from
 *   `runtimeAck` alone or from the local draft state.
 */
export type AccessWriteOutcome = {
  /** True only for `committed`. */
  ok: boolean;
  message: string;
};

const ROLLED_BACK_MESSAGE = "保存未生效：新变更已回滚，旧配置与旧策略已核验恢复。草稿已保留。";
const RECOVERY_REQUIRED_MESSAGE = "保存中断：受影响读取与后续写入已阻断，需要人工核验恢复。草稿已保留。";
const NO_ACK_MESSAGE = "保存未生效：runtime 未确认（runtimeAck=false）。草稿已保留，请检查策略降级状态。";

/**
 * The user-visible outcome of a terminal access write.
 *
 * `message` is the success label when the outcome is `committed`; otherwise it is
 * the reason the write did not take effect.
 */
export function describeAccessWriteOutcome(
  result: AccessWriteAck,
  successMessage: string
): AccessWriteOutcome {
  if (result.status === "recovery_required") {
    return { ok: false, message: RECOVERY_REQUIRED_MESSAGE };
  }
  if (result.status === "rolled_back") {
    return { ok: false, message: ROLLED_BACK_MESSAGE };
  }
  if (result.runtimeAck === false) {
    return { ok: false, message: NO_ACK_MESSAGE };
  }
  const version = result.policyVersion
    ? ` · policyVersion=${result.policyVersion.slice(0, 12)}…`
    : "";
  return { ok: true, message: `${successMessage}${version}` };
}

/**
 * The user-visible outcome of a write that the API REJECTED.
 *
 * A rejected write carries the same three terminal states in its error envelope:
 * `rolled_back` is HTTP 500 and `recovery_required` is HTTP 503, both with
 * `ok:false`. The client raises them as an error, so the terminal state has to be
 * read from the envelope — the HTTP status alone must never be the answer.
 */
export function describeAccessWriteFailure(error: unknown): AccessWriteOutcome {
  const data = (error as { data?: unknown } | null)?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const status = (data as { status?: unknown }).status;
    if (status === "committed" || status === "rolled_back" || status === "recovery_required") {
      return describeAccessWriteOutcome(data as AccessWriteAck, "保存");
    }
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  };
}
