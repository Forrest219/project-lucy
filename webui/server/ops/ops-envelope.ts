/**
 * L25-16 — 控制面统一信封（Spec §3.5：输出统一 `{ ok, data | error }`）。
 *
 * 独立成模块，避免 `ops-batch.ts` 与 `ops-recovery.ts` 之间形成运行时循环依赖。
 */

export type OpsEnvelope =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: string; message?: string; detail?: unknown } };

export function opsOk(data: Record<string, unknown>): OpsEnvelope {
  return { ok: true, data };
}

export function opsDeny(code: string, detail?: unknown, message?: string): OpsEnvelope {
  return {
    ok: false,
    error: {
      code,
      ...(message === undefined ? {} : { message }),
      ...(detail === undefined ? {} : { detail })
    }
  };
}

/** 控制面稳定原因码。 */
export const OPS_DENIAL_CODES = {
  planNotFound: "ops_plan_not_found",
  planExpired: "ops_plan_expired",
  planDigestMismatch: "ops_plan_digest_mismatch",
  planActorMismatch: "ops_plan_actor_mismatch",
  planToolMismatch: "ops_plan_tool_mismatch",
  confirmDigestMismatch: "ops_confirm_digest_mismatch",
  planBlocked: "ops_plan_blocked",
  grantUnmatched: "ops_grant_unmatched",
  planTargetSetMismatch: "ops_plan_target_set_mismatch",
  planParamTargetMismatch: "ops_plan_param_target_mismatch",
  groupSubsetIncomplete: "ops_group_subset_incomplete",
  idempotencyConflict: "ops_idempotency_conflict",
  idempotencyActorMismatch: "ops_idempotency_actor_mismatch",
  operationRecoveryRequired: "ops_operation_recovery_required",
  operationPendingActivation: "ops_operation_pending_activation",
  stateCorrupt: "ops_state_corrupt",
  operationInFlight: "ops_operation_in_flight",
  operationScopeMismatch: "ops_operation_scope_mismatch",
  claimFailed: "ops_claim_failed",
  targetUnresolvable: "ops_target_unresolvable"
} as const;
