/**
 * L25-16 — 目标结果四分类与 operation 级五态聚合（Spec §4.2 / §6.2，Q01 / Q02 / F6-01 / F6-06）。
 *
 * 两条 Normative 约束在这里落地：
 *
 * 1. **唯一 Outcome 构造器**：全 Spec 只允许 `Outcome.succeeded / failed / pendingActivation /
 *    recoveryRequired` 产出结果字面量。`kind` 与 `ok` 始终成对，由 `kind` 唯一决定 `ok`。
 *    `keep=` 用于保留既有字段（如 `release` / `activation` / 原始失败细节）。
 * 2. **唯一聚合函数**：`aggregateOperationState` 是 §6.2 的 C4 重入分派、C7.2 终结与恢复后聚合
 *    三处共用的实现。聚合**只接受持久态**；出现五态之外的值（含执行态 `claimed` 与已废止的
 *    `skipped` / `reused`）必须抛错，由调用方返回 `ops_state_corrupt`，不得当作失败重试。
 */

/** 持久态——写入幂等存储与审计的唯一依据。 */
export type OpsPersistentState =
  | "pending"
  | "succeeded"
  | "failed"
  | "recovery_required"
  | "pending_activation";

export const OPS_PERSISTENT_STATES: readonly OpsPersistentState[] = [
  "pending",
  "succeeded",
  "failed",
  "recovery_required",
  "pending_activation"
];

/** 只有 `succeeded` 与 `failed` 是终态。 */
export const OPS_TERMINAL_STATES: readonly OpsPersistentState[] = ["succeeded", "failed"];

/** 结果四分类。 */
export type OpsOutcomeKind = "succeeded" | "failed" | "pending_activation" | "recovery_required";

export interface OpsOutcome {
  kind: OpsOutcomeKind;
  /** succeeded → true；failed → false；其余两类 → null（不得写成 false，否则会被误判为运行失败）。 */
  ok: boolean | null;
  code?: string;
  stage?: string;
  detail?: unknown;
  /** 语义发布受理态的 release 凭据（W-A 不产出，字段保留给 W-B）。 */
  release?: unknown;
  /** 受理态的生效确认状态。 */
  activation?: unknown;
}

export class OpsStateCorruptError extends Error {
  readonly code = "ops_state_corrupt";

  constructor(readonly detail: unknown) {
    super(`ops state corrupt: ${JSON.stringify(detail)}`);
    this.name = "OpsStateCorruptError";
  }
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) (out as Record<string, unknown>)[key] = item;
  }
  return out;
}

function build(
  kind: OpsOutcomeKind,
  ok: boolean | null,
  extra: Record<string, unknown>,
  keep?: object
): OpsOutcome {
  const base = { ...(keep ?? {}) } as Record<string, unknown>;
  return {
    ...base,
    ...definedOnly(extra),
    kind,
    ok
  } as OpsOutcome;
}

export interface OpsFailedOptions {
  stage?: string;
  detail?: unknown;
  /** 保留既有结果字段。 */
  keep?: object;
}

export interface OpsNonTerminalOptions {
  release?: unknown;
  activation?: unknown;
  detail?: unknown;
  /** 保留既有结果字段（如 `release` / `activation`，F7-05）。 */
  keep?: object;
}

/**
 * 唯一 Outcome 构造器。`kind` 与 `ok` 成对；`keep=` 的字段不被降级覆盖。
 */
export const Outcome = {
  succeeded(keep?: object): OpsOutcome {
    return build("succeeded", true, {}, keep);
  },
  failed(code: string, options: OpsFailedOptions = {}): OpsOutcome {
    return build(
      "failed",
      false,
      { code, stage: options.stage, detail: options.detail },
      options.keep
    );
  },
  pendingActivation(options: OpsNonTerminalOptions = {}): OpsOutcome {
    return build(
      "pending_activation",
      null,
      {
        release: options.release,
        activation: options.activation,
        detail: options.detail
      },
      options.keep
    );
  },
  recoveryRequired(options: OpsNonTerminalOptions = {}): OpsOutcome {
    return build(
      "recovery_required",
      null,
      {
        release: options.release,
        activation: options.activation,
        detail: options.detail
      },
      options.keep
    );
  }
};

export interface OpsAggregateMember {
  /** 持久态。执行态 `claimed` 不允许出现在这里。 */
  state: OpsPersistentState;
  /** 认领该成员的 attempt 号；null = 从未被任何 attempt 认领执行。 */
  attempt?: number | null;
}

export function isOpsTerminalState(state: string): state is OpsPersistentState {
  return (OPS_TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * operation 级五态聚合（Spec §4.2 唯一实现）。
 *
 * 优先级（从上到下）：
 * 1. 任一成员 `recovery_required` → `recovery_required`
 * 2. 无 `recovery_required` 但任一成员 `pending_activation` → `pending_activation`
 * 3. 全部成员均为终态且至少一个 `failed` → `failed`
 * 4. 全部成员均为 `succeeded` → `succeeded`
 * 5. 其余（仍有成员 `pending`）→ `pending`
 *
 * ⚠️ 存在未终结成员时**不得**转 `failed` 终态，否则剩余成员的合法提交路径会被关闭。
 */
export function aggregateOperationState(
  members: readonly OpsAggregateMember[]
): OpsPersistentState {
  if (!Array.isArray(members) || members.length === 0) {
    // 空集合没有「全部成功」的证据。
    return "pending";
  }
  const states = members.map((member) => {
    const state = member?.state;
    if (typeof state !== "string" || !(OPS_PERSISTENT_STATES as readonly string[]).includes(state)) {
      throw new OpsStateCorruptError({ member, state });
    }
    return state as OpsPersistentState;
  });

  if (states.includes("recovery_required")) return "recovery_required";
  if (states.includes("pending_activation")) return "pending_activation";
  if (states.every((state) => state === "succeeded" || state === "failed")) {
    return states.some((state) => state === "failed") ? "failed" : "succeeded";
  }
  return "pending";
}
