/**
 * Lucy v0.25 — release activation state (Spec §7.1, D19).
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §7.1 ("发布沿用 blocked / promote_failed / reindexing / published /
 * reindex_failed，增加恢复必要信息 `recoveryRequired` 及独立
 * `activationStatus=unconfirmed / confirmed`，不改写历史状态含义。旧记录缺少
 * 新字段时为 unknown，不从旧 published 自动补 confirmed。")
 *
 * ── Why the two fields are independent ─────────────────────────────────────
 * `recoveryRequired` says: is there an unfinished rollback that a human has
 * to verify? `activationStatus` says: do we KNOW that the agent can read the
 * new semantics? They are separate facts:
 *
 *   - a reindex failure leaves the files saved → `recoveryRequired = false`
 *     but `activationStatus = unconfirmed` (the UI shows 「生效状态待确认」).
 *   - a failed restore leaves the files half written → `recoveryRequired =
 *     true` AND `activationStatus = unconfirmed`.
 *   - a fully published release → `recoveryRequired = false`,
 *     `activationStatus = confirmed`.
 *
 * ── The legacy rule ────────────────────────────────────────────────────────
 * A record written before v0.25 has neither field. It is reported as
 * `unknown` — NOT as `confirmed`, even when its status says `published`. A
 * legacy `published` record does not prove that the index succeeded under
 * the tightened §7.2 contract, so it must not be upgraded silently.
 */

export type SemanticActivationStatus = "unconfirmed" | "confirmed" | "unknown";

/** `true` / `false` for a v0.25 record, `unknown` for a legacy record. */
export type SemanticRecoveryRequiredState = boolean | "unknown";

export interface SemanticReleaseActivationState {
  recoveryRequired: SemanticRecoveryRequiredState;
  activationStatus: SemanticActivationStatus;
}

export const UNKNOWN_ACTIVATION_STATE: SemanticReleaseActivationState = {
  recoveryRequired: "unknown",
  activationStatus: "unknown"
};

function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function readActivationStatus(value: unknown): SemanticActivationStatus | undefined {
  if (value === "unconfirmed" || value === "confirmed") return value;
  return undefined;
}

/**
 * Read the activation state of a release record.
 *
 * A missing field is `unknown`. A legacy `published` record is NOT upgraded
 * to `confirmed`.
 */
export function normalizeSemanticActivationState(
  record: unknown
): SemanticReleaseActivationState {
  if (!record || typeof record !== "object") return { ...UNKNOWN_ACTIVATION_STATE };
  const source = record as { recoveryRequired?: unknown; activationStatus?: unknown };
  const recoveryRequired = readBoolean(source.recoveryRequired);
  const activationStatus = readActivationStatus(source.activationStatus);
  return {
    recoveryRequired: recoveryRequired ?? "unknown",
    activationStatus: activationStatus ?? "unknown"
  };
}

/**
 * The activation state of a release that this build produced.
 *
 * The caller states the facts explicitly; nothing is inferred from the
 * release status alone.
 */
export function buildSemanticActivationState(input: {
  /** A failed restore leaves a human-visible repair obligation. */
  recoveryRequired: boolean;
  /** True only when the index succeeded AND the terminal record was persisted. */
  activationConfirmed: boolean;
}): SemanticReleaseActivationState {
  return {
    recoveryRequired: input.recoveryRequired,
    activationStatus: input.activationConfirmed ? "confirmed" : "unconfirmed"
  };
}

/**
 * May another publish start?
 *
 * While a recovery is required, publishing and manual reindexing are
 * blocked (Spec §7.1 / §7.2, D3).
 */
export function isSemanticPublishBlocked(state: SemanticReleaseActivationState): boolean {
  return state.recoveryRequired === true;
}

/** The UI wording for the activation state. */
export function describeSemanticActivationStatus(
  state: SemanticReleaseActivationState
): string {
  if (state.recoveryRequired === true) return "生效状态待确认（恢复未完成，已阻断后续发布）";
  if (state.activationStatus === "confirmed") return "已生效";
  if (state.activationStatus === "unconfirmed") return "生效状态待确认";
  return "生效状态待确认（历史记录未记录生效结论）";
}
