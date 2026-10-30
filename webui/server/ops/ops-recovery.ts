/**
 * L25-16 — 崩溃恢复与收敛（Spec §6.2 收敛顺序、N07 / R08 / F04 / F6-01 / F7-01 / F7-10，G33）。
 *
 * ⚠️ **恢复合同（F7-10，措辞与实现必须一致）**：`recoverPending` 返回一个信封，调用方据此
 * 决定下一步——
 *
 * ```
 * { operation_state, recovered: [...], still_unfinished: [...],
 *   next_submit_required: bool, next_submit_hint: [...] }
 * ```
 *
 * 恢复**只收敛已认领未终结的成员**，**绝不执行任何新的范围**；剩余成员必须由调用方
 * **再次提交**才会执行。
 *
 * ⚠️ **恢复范围必须绑定 attempt（F5-02）**：恢复**只处理该 attempt 持久化的
 * `execSet`**，未在 `execSet` 内的目标保持原状态，不参与本次恢复。
 *
 * ⚠️ **恢复后的 operation 状态必须重新聚合（F6-01）**：复用 §4.2 的同一个
 * `aggregateOperationState`，不得另写一套判定。
 */

import type Database from "better-sqlite3";
import {
  aggregateOperationState,
  Outcome,
  OpsStateCorruptError,
  type OpsPersistentState
} from "./ops-outcome.js";
import {
  finalizeOperationRow,
  finalizeTargetRow,
  loadOperationMembers,
  loadOperationRow,
  loadTargetRowsByStatus,
  opsExecutionId,
  scanNonTerminalOperations,
  upsertOperationRow,
  type OpsOperationRecord,
  type OpsTargetRecord
} from "./ops-idempotency.js";
import { persistTargetProgress, updateAuditById } from "./ops-audit.js";
import type { OpsGroupContext, OpsPlanTarget, OpsToolAdapter } from "./ops-batch.js";
import { opsDeny, opsOk, OPS_DENIAL_CODES, type OpsEnvelope } from "./ops-envelope.js";

/** 排他所有权：同一 operation 的恢复不得并发进入（F04）。 */
const recovering = new Set<string>();

export interface OpsRecoveryMember {
  target: OpsPlanTarget;
  targetKey: string;
  state: OpsPersistentState;
  attempt: number | null;
  auditId: number | null;
  result: unknown;
  prior: OpsTargetRecord | undefined;
}

export interface OpsRecoverPendingOptions {
  adapter: OpsToolAdapter;
  projectRoot: string;
  actor: string;
  delegatedFrom: string | null;
  database: Database.Database;
  opKey: string;
  opRec: OpsOperationRecord;
  members: OpsRecoveryMember[];
  /** 本 attempt 持久化的执行范围——恢复**只**处理它。 */
  execSet: string[];
}

/**
 * 恢复收敛：核验 → 补记 / 回滚 / 阻断。
 *
 * 分支（Spec §6.2 收敛顺序 1–4）：
 * 1. 全部目标已终结为 `succeeded` → 补记 operation 终态，返回原结果；
 * 2. 部分目标已 `succeeded`、其余无副作用痕迹 → 只对未终结目标继续；
 * 3. 已写入但未确认生效 → **核验实际生效状态**：已生效 → 补记 `committed`；
 *    未生效 → 按组回滚并记 `failed`；有残留且无法确认 → 保持恢复状态并阻断；
 * 4. 状态不可判定 → **阻断**该目标的再次提交，返回稳定原因码，**不得静默重跑**。
 */
export async function recoverPending(options: OpsRecoverPendingOptions): Promise<OpsEnvelope> {
  const { database, opKey, opRec } = options;

  // 排他所有权：并发同键 → in_flight（不得并发进入恢复）。
  if (recovering.has(opKey)) {
    return opsDeny(OPS_DENIAL_CODES.operationInFlight);
  }
  recovering.add(opKey);
  try {
    const inScope = options.members.filter((member) => options.execSet.includes(member.target.id));
    if (inScope.length === 0) {
      const state = safeAggregate(options.members);
      if (state === "succeeded" || state === "failed") {
        finalizeOperationRow(database, opKey, state, opRec.result);
      }
      return opsOk(buildRecoveryEnvelope(state, [], [], false, []));
    }

    const groups = new Map<string, OpsRecoveryMember[]>();
    for (const member of inScope) {
      const list = groups.get(member.target.groupId) ?? [];
      list.push(member);
      groups.set(member.target.groupId, list);
    }

    const recovered: Array<{ id: string; state: OpsPersistentState; detail?: unknown }> = [];

    for (const [groupId, members] of groups) {
      const group = {
        id: groupId,
        memberIds: members.map((member) => member.target.id),
        sharedFiles: []
      };
      const groupContext: OpsGroupContext = {
        projectRoot: options.projectRoot,
        group,
        members: members.map((member) => member.target),
        actor: options.actor,
        delegatedFrom: options.delegatedFrom,
        // 与原执行同一个 id ⇒ 恢复能找回原执行留下的组级暂存（前像 / 写后摘要）。
        executionId: opsExecutionId(options.opKey, opRec.attempt, groupId),
        setEffectPhase: () => undefined
      };

      // 核验实际生效状态。
      let verdicts: Array<{ id: string; state: "succeeded" | "failed" | "unknown"; detail?: unknown }> = [];
      if (options.adapter.verifyGroup) {
        try {
          const verified = await options.adapter.verifyGroup(groupContext);
          verdicts = verified.members;
        } catch (err) {
          verdicts = members.map((member) => ({
            id: member.target.id,
            state: "unknown" as const,
            detail: String(err)
          }));
        }
      } else {
        verdicts = members.map((member) => ({
          id: member.target.id,
          state: "unknown" as const,
          detail: "verify_not_supported"
        }));
      }

      const anyFailed = verdicts.some((verdict) => verdict.state === "failed");
      if (anyFailed) {
        // 未生效 → 按组回滚并记 `failed`；回滚不完整 → 保持恢复状态并阻断。
        let complete = true;
        let detail: unknown;
        try {
          const rollback = await options.adapter.rollbackGroup(groupContext);
          complete = rollback.complete;
          detail = rollback.detail;
        } catch (err) {
          complete = false;
          detail = String(err);
        }
        for (const member of members) {
          const verdict = verdicts.find((item) => item.id === member.target.id);
          if (complete) {
            const result = Outcome.failed("ops_recovery_rolled_back", {
              stage: "recovery",
              detail: { verify: verdict?.detail, rollback: detail }
            });
            updateAuditById(database, member.auditId, "failed", result.code ?? "ops_recovery_rolled_back");
            finalizeTargetRow(database, member.targetKey, "failed", result);
            recovered.push({ id: member.target.id, state: "failed", detail: result.detail });
          } else {
            const result = Outcome.recoveryRequired({ keep: undefined, detail: { verify: verdict?.detail, rollback: detail } });
            persistTargetProgress(database, {
              targetKey: member.targetKey,
              status: "recovery_required",
              attempt: member.attempt,
              auditId: member.auditId,
              result,
              effectPhase: member.prior?.effectPhase ?? "none"
            });
            recovered.push({ id: member.target.id, state: "recovery_required", detail: result.detail });
          }
        }
        continue;
      }

      for (const member of members) {
        const verdict = verdicts.find((item) => item.id === member.target.id);
        if (verdict?.state === "succeeded") {
          // 已生效 → 补记 `committed`。
          const result = Outcome.succeeded({});
          updateAuditById(database, member.auditId, "committed", null);
          finalizeTargetRow(database, member.targetKey, "succeeded", result);
          recovered.push({ id: member.target.id, state: "succeeded" });
          continue;
        }
        // 不可判定 → 保持恢复状态并阻断，**不得静默重跑**。
        const result = Outcome.recoveryRequired({
          detail: verdict?.detail ?? "ops_effect_state_undeterminable"
        });
        persistTargetProgress(database, {
          targetKey: member.targetKey,
          status: "recovery_required",
          attempt: member.attempt,
          auditId: member.auditId,
          result,
          effectPhase: member.prior?.effectPhase ?? "none"
        });
        recovered.push({ id: member.target.id, state: "recovery_required", detail: result.detail });
      }
    }

    // 恢复后重新聚合（复用唯一实现）。
    //
    // ⚠️ 必须聚合**恢复之后**的成员状态：`options.members` 里带的是**恢复前**的持久态
    // （通常是 `pending`）。直接聚合它会让已经收敛的目标永远不被计入，operation 也就
    // 永远停在非终态——恢复入口就变成了「反复扫描同一个 operation」的死循环。
    const resolved = new Map<string, OpsPersistentState>();
    for (const entry of recovered) {
      resolved.set(entry.id, entry.state);
    }
    const stateOf = (member: OpsRecoveryMember): OpsPersistentState =>
      resolved.get(member.target.id) ?? member.state;

    const state = safeAggregate(
      options.members.map((member) => ({ state: stateOf(member), attempt: member.attempt }))
    );
    if (state === "succeeded" || state === "failed") {
      finalizeOperationRow(database, opKey, state, opRec.result);
    } else {
      upsertOperationRow(database, {
        operationKey: opKey,
        toolName: opRec.toolName,
        actor: opRec.actor,
        delegatedFrom: opRec.delegatedFrom,
        planId: opRec.planId,
        planDigest: opRec.planDigest,
        status: state,
        attempt: opRec.attempt,
        execSet: opRec.execSet,
        groupIds: opRec.groupIds,
        result: opRec.result,
        plan: opRec.plan
      });
    }

    const stillUnfinished = options.members
      .filter((member) => {
        const current = stateOf(member);
        return current !== "succeeded" && current !== "failed";
      })
      .map((member) => member.target.id);
    // 需要**再次提交**的成员：从未被任何 attempt 认领的 `pending`，或已失败的成员。
    // 恢复只收敛已认领未终结的成员，剩余成员的合法路径仍然是「再次提交」。
    const hint = options.members
      .filter((member) => {
        const current = stateOf(member);
        return (current === "pending" && member.attempt === null) || current === "failed";
      })
      .map((member) => member.target.id);

    return opsOk(
      buildRecoveryEnvelope(
        state,
        recovered,
        stillUnfinished,
        hint.length > 0,
        hint
      )
    );
  } finally {
    recovering.delete(opKey);
  }
}

function safeAggregate(
  members: readonly { state: OpsPersistentState; attempt?: number | null }[]
): OpsPersistentState {
  try {
    return aggregateOperationState(
      members.map((member) => ({ state: member.state, attempt: member.attempt }))
    );
  } catch (err) {
    if (err instanceof OpsStateCorruptError) return "recovery_required";
    return "recovery_required";
  }
}

function buildRecoveryEnvelope(
  operationState: OpsPersistentState,
  recovered: Array<{ id: string; state: OpsPersistentState; detail?: unknown }>,
  stillUnfinished: string[],
  nextSubmitRequired: boolean,
  nextSubmitHint: string[]
): Record<string, unknown> {
  return {
    mode: "recovery",
    operation_state: operationState,
    recovered,
    still_unfinished: stillUnfinished,
    next_submit_required: nextSubmitRequired,
    next_submit_hint: nextSubmitHint
  };
}

/**
 * 恢复扫描入口（Spec §6.2 收敛入口 ①）：扫描**非终态** operation 并逐个走恢复收敛。
 */
export async function recoverNonTerminalOperations(options: {
  adapterFor: (toolName: string) => OpsToolAdapter | undefined;
  projectRoot: string;
  actor: string;
  delegatedFrom: string | null;
  database: Database.Database;
}): Promise<OpsEnvelope> {
  const nonTerminal = scanNonTerminalOperations(options.database);
  const outcomes: Array<Record<string, unknown>> = [];
  for (const opRec of nonTerminal) {
    const adapter = options.adapterFor(opRec.toolName);
    if (!adapter) continue;
    const persisted = loadOperationMembers(options.database, opRec.operationKey);
    const plan = opRec.plan as unknown as { perTarget?: OpsPlanTarget[] };
    const members: OpsRecoveryMember[] = (plan.perTarget ?? []).map((target) => {
      const record = persisted.find((item) => item.targetId === target.id);
      return {
        target,
        targetKey: record?.targetKey ?? "",
        state: record?.status ?? "pending",
        attempt: record?.attempt ?? null,
        auditId: record?.auditId ?? null,
        result: record?.result ?? null,
        prior: record
      };
    });
    const result = await recoverPending({
      adapter,
      projectRoot: options.projectRoot,
      // ⚠️ 用**该 operation 自己的** actor / 委托人，不用扫描入口的入参——
      // 恢复是对既有 operation 的续接，审计与回写必须归属原发起者。
      actor: opRec.actor || options.actor,
      delegatedFrom:
        typeof opRec.delegatedFrom === "string" ? opRec.delegatedFrom : options.delegatedFrom,
      database: options.database,
      opKey: opRec.operationKey,
      opRec,
      members,
      execSet: opRec.execSet
    });
    outcomes.push({ operation_key: opRec.operationKey, result });
  }
  return opsOk({ scanned: nonTerminal.length, outcomes });
}

/**
 * release 收敛入口（Spec §6.2 收敛入口 ②）：把 release 终态回写到目标与 operation。
 *
 * W-A 无语义发布，`pending_activation` 不会出现；本入口保留为合同要求的显式收敛路径。
 */
export async function convergePendingActivation(options: {
  adapterFor: (toolName: string) => OpsToolAdapter | undefined;
  database: Database.Database;
}): Promise<OpsEnvelope> {
  const rows = loadTargetRowsByStatus(options.database, "pending_activation");
  const converged: Array<Record<string, unknown>> = [];
  for (const record of rows) {
    const opRec = loadOperationRow(options.database, record.operationKey);
    if (!opRec) continue;
    const adapter = options.adapterFor(opRec.toolName);
    if (!adapter?.resolveActivation) continue;
    const plan = opRec.plan as unknown as { perTarget?: OpsPlanTarget[] };
    const target = (plan.perTarget ?? []).find((item) => item.id === record.targetId);
    if (!target) continue;
    const verdict = await adapter.resolveActivation({ target, record });
    if (verdict === "unknown") {
      converged.push({ target_id: record.targetId, state: "pending_activation" });
      continue;
    }
    const confirmed = verdict === "confirmed";
    const result = confirmed ? Outcome.succeeded({}) : Outcome.failed("ops_activation_failed");
    updateAuditById(
      options.database,
      record.auditId,
      confirmed ? "committed" : "failed",
      confirmed ? null : "ops_activation_failed"
    );
    finalizeTargetRow(options.database, record.targetKey, confirmed ? "succeeded" : "failed", result);
    converged.push({ target_id: record.targetId, state: confirmed ? "succeeded" : "failed" });

    // ⚠️ 合同要求「回写到**目标与 operation**」——operation 级审计行与 operation
    // 记录也必须一起收敛，否则 operation 永远停在受理态（非终态）。
    updateOperationAudit(options.database, record.operationKey, confirmed);
    writeBackOperationState(options.database, opRec);
  }
  return opsOk({ converged });
}

/** 更新该 operation 的 operation 级审计行（`target_id` 为空的那一条）。 */
function updateOperationAudit(
  database: Database.Database,
  operationKeyValue: string,
  confirmed: boolean
): void {
  const row = database
    .prepare(
      "SELECT id FROM config_change_log WHERE operation = ? AND (target_id IS NULL OR target_id = '') ORDER BY id DESC LIMIT 1"
    )
    .get(operationKeyValue) as { id: number } | undefined;
  if (!row) return;
  updateAuditById(
    database,
    row.id,
    confirmed ? "committed" : "failed",
    confirmed ? null : "ops_activation_failed"
  );
}

/** 重新聚合并回写 operation 的持久态（复用 §4.2 的唯一聚合实现）。 */
function writeBackOperationState(
  database: Database.Database,
  opRec: OpsOperationRecord
): void {
  const members = loadOperationMembers(database, opRec.operationKey);
  let state: OpsPersistentState;
  try {
    state = aggregateOperationState(
      members.map((member) => ({ state: member.status, attempt: member.attempt }))
    );
  } catch (err) {
    if (err instanceof OpsStateCorruptError) {
      state = "recovery_required";
    } else {
      state = "recovery_required";
    }
  }
  if (state === "succeeded" || state === "failed") {
    finalizeOperationRow(database, opRec.operationKey, state, opRec.result);
    return;
  }
  upsertOperationRow(database, {
    operationKey: opRec.operationKey,
    toolName: opRec.toolName,
    actor: opRec.actor,
    delegatedFrom: opRec.delegatedFrom,
    planId: opRec.planId,
    planDigest: opRec.planDigest,
    status: state,
    attempt: opRec.attempt,
    execSet: opRec.execSet,
    groupIds: opRec.groupIds,
    result: opRec.result,
    plan: opRec.plan
  });
}
