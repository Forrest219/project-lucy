/**
 * L25-16 — 通用批量编排（Spec §6.1 / §6.2，R01 / R05 / R08 / R09 / N01 / N03 / F02 / F03 / F05 / F06 / F7-01 / F7-02 / F7-04 / F7-06 / F7-07 / F7-10）。
 *
 * 两段式：preview → commit。**不提供跳过人工复核的直写旁路**（Spec §4.1）。
 *
 * 本模块是 Spec §6.2 伪代码（C0–C7.2）的**唯一实现**；工具差异只体现在
 * {@link OpsToolAdapter} 的三个钩子（算计划 / 执行组 / 撤销组）。
 *
 * ⚠️ 三条不可让步的合同：
 *
 * 1. **认领先于效果（G34）**：本 attempt 的 operation 认领 + operation 审计 + target 认领 +
 *    target 审计在 `audit.sqlite` 的**同一次** `db.transaction()` 里提交；提交前失败返回
 *    `ops_claim_failed`，不留行、不写文件。
 * 2. **结果四分类（Q01）**：判定成败一律读 `result.kind`，**不得**读 `result.ok`。
 *    组回滚**只**由 `kind === "failed"` 触发。
 * 3. **五态聚合唯一（Q02 / F6-01）**：`aggregateOperationState` 只有本模块的
 *    `ops-outcome.ts` 一处实现，重入分派、终结与恢复后聚合三处共用。
 */

import type Database from "better-sqlite3";
import type { ConfigAuditAssetKind } from "../admin/audit.js";
import { getOpsToolSpec, type OpsToolSpec } from "./control-plane.js";
import {
  aggregateOperationState,
  Outcome,
  OpsStateCorruptError,
  type OpsOutcome,
  type OpsPersistentState
} from "./ops-outcome.js";
import {
  claimAttemptTransaction,
  OpsClaimConflictError,
  persistTargetProgress,
  setTargetEffectPhase,
  updateAuditById,
  type OpsTargetAuditDescriptor
} from "./ops-audit.js";
import {
  finalizeOperationRow,
  finalizeTargetRow,
  getOpsDatabase,
  loadOperationMembers,
  loadOperationRow,
  loadPlanRow,
  loadTargetRow,
  newPlanId,
  operationKey,
  opsExecutionId,
  planDigestOf,
  savePlanRow,
  targetKey,
  upsertOperationRow,
  type OpsEffectPhase,
  type OpsOperationRecord,
  type OpsTargetRecord
} from "./ops-idempotency.js";
import { authorizeOpsTargets, type OpsGrant } from "./ops-grants.js";
import { opsDeny, opsOk, OPS_DENIAL_CODES, type OpsEnvelope } from "./ops-envelope.js";
import { recoverPending } from "./ops-recovery.js";

/** 计划有效期（Spec §6.2 preview：30 分钟）。 */
export const OPS_PLAN_TTL_MS = 30 * 60 * 1000;

// ─── 计划模型 ────────────────────────────────────────────────────────────────

export interface OpsPlanTarget {
  /** 目标稳定 id（同一 plan 内唯一）。 */
  id: string;
  /** 所属原子组 id。 */
  groupId: string;
  /** 目标所在连接（连接域授权用）。 */
  connectionId: string;
  /** 工具自定义载荷（各目标的具体变更意图）。 */
  payload: Record<string, unknown>;
  before: unknown;
  after: unknown;
  /** 非空即不可执行；组内任一成员不可执行 → 整组不写。 */
  blockers: string[];
  /** 该目标的写集（共享内容文件）——组身份由**实际写集交集**决定。 */
  writeSet: string[];
  /** target 级审计的落点。 */
  audit: OpsTargetAuditDescriptor;
}

export interface OpsPlanGroup {
  id: string;
  memberIds: string[];
  /** 组内共享的内容文件。 */
  sharedFiles: string[];
}

export interface OpsPlan {
  planId: string;
  toolName: string;
  actor: string;
  delegatedFrom: string | null;
  perTarget: OpsPlanTarget[];
  groups: OpsPlanGroup[];
  blockers: string[];
  createdAt: string;
  expiresAt: string;
  planDigest: string;
}

/**
 * 摘要的**规范化载荷**（N01）。
 *
 * ⚠️ 必须剥掉运行时字段（`state` / `attempt` / `result` / `auditId` / `targetKey`），
 * 否则 commit 阶段加载计划后会算出不同摘要。
 */
export function canonicalPlanPayload(plan: OpsPlan): Record<string, unknown> {
  return {
    toolName: plan.toolName,
    actor: plan.actor,
    delegatedFrom: plan.delegatedFrom,
    blockers: plan.blockers,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt,
    groups: plan.groups.map((group) => ({
      id: group.id,
      memberIds: group.memberIds,
      sharedFiles: group.sharedFiles
    })),
    perTarget: plan.perTarget.map((target) => ({
      id: target.id,
      groupId: target.groupId,
      connectionId: target.connectionId,
      payload: target.payload,
      before: target.before,
      after: target.after,
      blockers: target.blockers,
      writeSet: target.writeSet,
      audit: {
        changeType: target.audit.changeType,
        assetKind: target.audit.assetKind,
        targetId: target.audit.targetId,
        filePath: target.audit.filePath
      }
    }))
  };
}

/** 计划摘要——preview 与 commit **共用**本函数。 */
export function computePlanDigest(plan: OpsPlan): string {
  return planDigestOf(canonicalPlanPayload(plan));
}

// ─── 信封 ────────────────────────────────────────────────────────────────────

export { OPS_DENIAL_CODES, opsDeny, opsOk, type OpsEnvelope } from "./ops-envelope.js";

// ─── 适配器合同 ──────────────────────────────────────────────────────────────

export interface OpsPlanBuildContext {
  projectRoot: string;
  actor: string;
  delegatedFrom: string | null;
  request: Record<string, unknown>;
}

export interface OpsPlanDraft {
  perTarget: OpsPlanTarget[];
  groups: OpsPlanGroup[];
  blockers?: string[];
}

export interface OpsGroupContext {
  projectRoot: string;
  group: OpsPlanGroup;
  members: OpsPlanTarget[];
  actor: string;
  delegatedFrom: string | null;
  /**
   * 本次组执行的身份标识。
   *
   * 适配器用它把组级暂存状态（前像 / 写后摘要）绑定到**具体的一次 attempt**：
   * 同名组的不同 operation、不同 attempt 之间不得互相覆盖；恢复流程也能用同一公式
   * 找回原执行留下的暂存。
   */
  executionId: string;
  /** 记录目标的效果阶段（`none` / `written` / `activated`）——崩溃恢复的依据。 */
  setEffectPhase: (targetId: string, phase: OpsEffectPhase) => void;
}

/**
 * 组执行身份：`operation_key` + attempt + group id。
 *
 * 跨进程可复现（恢复时能算出同一个 id），且不同 operation / 不同 attempt 互不相同。
 */
export { opsExecutionId } from "./ops-idempotency.js";

export interface OpsRollbackResult {
  /** 撤销是否完整完成。false → 该组转 `recovery_required`。 */
  complete: boolean;
  detail?: unknown;
}

export interface OpsGroupVerifyMember {
  id: string;
  state: "succeeded" | "failed" | "unknown";
  detail?: unknown;
}

export interface OpsGroupVerifyResult {
  members: OpsGroupVerifyMember[];
}

export interface OpsToolAdapter {
  toolName: string;
  /** operation 级审计的落点。 */
  operationAudit(): { filePath: string; changeType: string; assetKind: ConfigAuditAssetKind };
  /** 解析请求里的目标列表；非法即抛错（工具层转成拒绝信封）。 */
  parseTargets(request: Record<string, unknown>): unknown[];
  /** 目标稳定 id（幂等键 / 审计 `target_id` / 执行子集）。 */
  targetId(target: unknown): string;
  /** 目标所在连接（逐对象授权判定用）。 */
  connectionId(target: unknown): string;
  /** preview：解析目标、算计划、划分原子组。 */
  buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft>;
  /** 组级执行（一次写入 / 一次合并写）。抛错即失败。 */
  executeGroup(ctx: OpsGroupContext): Promise<void>;
  /** 组级撤销（失败后恢复）。 */
  rollbackGroup(ctx: OpsGroupContext): Promise<OpsRollbackResult>;
  /** 崩溃恢复的核验（可选）。缺省视为不可判定。 */
  verifyGroup?(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult>;
  /** release 终态收敛（可选）。W-A 无语义发布，不提供。 */
  resolveActivation?(ctx: { target: OpsPlanTarget; record: unknown }): Promise<"confirmed" | "failed" | "unknown">;
  /**
   * 组终结（可选）——组内全部成员确认成功后调用一次。
   *
   * 用于**延后到组终结才允许执行**的收尾动作（例：版本索引裁剪）。
   * 组失败时**不得**调用——被裁剪的旧版本必须仍可读。
   */
  finalizeGroup?(ctx: OpsGroupContext): Promise<void>;
  /**
   * 组级撤销完成后的清理（可选）——丢弃该组的暂存状态。
   *
   * 撤销完成后**不得**再执行组终结动作（裁剪等），否则被撤销的历史条目对应的
   * 旧版本会被误裁掉。
   */
  discardGroup?(ctx: OpsGroupContext): Promise<void>;
}

// ─── 运行时成员视图 ──────────────────────────────────────────────────────────

export interface MemberRuntime {
  target: OpsPlanTarget;
  targetKey: string;
  state: OpsPersistentState;
  attempt: number | null;
  result: unknown;
  auditId: number | null;
  prior: OpsTargetRecord | undefined;
}

function runtimeOf(target: OpsPlanTarget, key: string, prior?: OpsTargetRecord): MemberRuntime {
  return {
    target,
    targetKey: key,
    state: prior?.status ?? "pending",
    attempt: prior?.attempt ?? null,
    result: prior?.result ?? null,
    auditId: prior?.auditId ?? null,
    prior
  };
}

// ─── preview ─────────────────────────────────────────────────────────────────

export interface OpsPreviewOptions {
  adapter: OpsToolAdapter;
  projectRoot: string;
  actor: string;
  delegatedFrom: string | null;
  request: Record<string, unknown>;
  now?: () => number;
}

/**
 * preview：算计划 → 算摘要 → 持久化计划。
 *
 * 返回的 `confirm_digest` 必须由调用方在 commit 时**原样带回**。
 */
export async function runOpsPreview(options: OpsPreviewOptions): Promise<OpsEnvelope> {
  const now = options.now ?? Date.now;
  const draft = await options.adapter.buildPlan({
    projectRoot: options.projectRoot,
    actor: options.actor,
    delegatedFrom: options.delegatedFrom,
    request: options.request
  });

  const createdAtMs = now();
  const plan: OpsPlan = {
    planId: newPlanId(),
    toolName: options.adapter.toolName,
    actor: options.actor,
    delegatedFrom: options.delegatedFrom,
    perTarget: draft.perTarget,
    groups: draft.groups,
    blockers: draft.blockers ?? [],
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + OPS_PLAN_TTL_MS).toISOString(),
    planDigest: ""
  };
  plan.planDigest = computePlanDigest(plan);

  const database = await getOpsDatabase();
  savePlanRow(database, {
    planId: plan.planId,
    toolName: plan.toolName,
    actor: plan.actor,
    delegatedFrom: plan.delegatedFrom,
    planDigest: plan.planDigest,
    plan: plan as unknown as Record<string, unknown>,
    createdAt: plan.createdAt,
    expiresAt: plan.expiresAt
  });

  return opsOk({
    mode: "preview",
    plan_id: plan.planId,
    confirm_digest: plan.planDigest,
    expires_at: plan.expiresAt,
    per_target: plan.perTarget.map(publicTarget),
    groups: plan.groups.map((group) => ({
      id: group.id,
      members: group.memberIds,
      shared_files: group.sharedFiles
    })),
    blockers: plan.blockers
  });
}

function publicTarget(target: OpsPlanTarget): Record<string, unknown> {
  return {
    id: target.id,
    group_id: target.groupId,
    connection_id: target.connectionId,
    before: target.before ?? null,
    after: target.after ?? null,
    blockers: target.blockers,
    write_set: target.writeSet
  };
}

// ─── commit ──────────────────────────────────────────────────────────────────

export interface OpsCommitOptions {
  adapter: OpsToolAdapter;
  projectRoot: string;
  actor: string;
  delegatedFrom: string | null;
  idempotencyKey: string;
  planId: string;
  confirmDigest: string;
  /** 本次请求提交的目标 id 集合。 */
  requestTargetIds: string[];
  grants: OpsGrant[];
  tool?: OpsToolSpec;
  now?: () => number;
}

interface CommitRuntime {
  database: Database.Database;
  plan: OpsPlan;
  members: MemberRuntime[];
  opKey: string;
  attempt: number;
  execSet: Set<string>;
  toClaim: MemberRuntime[];
  opAuditId: number | undefined;
  blockedGroups: Set<string>;
}

/**
 * commit —— Spec §6.2 C0–C7.2。
 */
export async function runOpsCommit(options: OpsCommitOptions): Promise<OpsEnvelope> {
  const now = options.now ?? Date.now;
  const adapter = options.adapter;
  const tool = options.tool ?? getOpsToolSpec(adapter.toolName);
  if (!tool) return opsDeny(OPS_DENIAL_CODES.planToolMismatch, undefined, "未登记的控制面工具");

  const database = await getOpsDatabase();
  const opKey = operationKey(options.idempotencyKey, adapter.toolName);

  // ── C0. 先定位已有 operation，再决定是否加载计划 ─────────────────────────
  let opRec: OpsOperationRecord | undefined = loadOperationRow(database, opKey);

  // ── C1. 计划自身校验 ─────────────────────────────────────────────────────
  let plan: OpsPlan;
  if (!opRec) {
    const stored = loadPlanRow(database, options.planId);
    if (!stored) return opsDeny(OPS_DENIAL_CODES.planNotFound);
    if (Date.parse(stored.expiresAt) <= now()) return opsDeny(OPS_DENIAL_CODES.planExpired);
    plan = stored.plan as unknown as OpsPlan;
  } else {
    // 已有 operation：用其**持久化的计划对象**再授权；此分支不检查计划过期。
    plan = opRec.plan as unknown as OpsPlan;
    if (!plan || !Array.isArray(plan.perTarget)) return opsDeny(OPS_DENIAL_CODES.planNotFound);
  }
  if (!Array.isArray(plan.perTarget) || !Array.isArray(plan.groups)) {
    return opsDeny(OPS_DENIAL_CODES.stateCorrupt, undefined, "计划结构损坏");
  }
  if (computePlanDigest(plan) !== plan.planDigest) {
    return opsDeny(OPS_DENIAL_CODES.planDigestMismatch);
  }
  if (plan.actor !== options.actor) return opsDeny(OPS_DENIAL_CODES.planActorMismatch);
  if (plan.toolName !== adapter.toolName) return opsDeny(OPS_DENIAL_CODES.planToolMismatch);
  if (options.confirmDigest !== plan.planDigest) return opsDeny(OPS_DENIAL_CODES.confirmDigestMismatch);
  if (plan.blockers.length > 0) {
    return opsDeny(OPS_DENIAL_CODES.planBlocked, { blockers: plan.blockers });
  }

  // ── C2. 计划对象再授权 ───────────────────────────────────────────────────
  const reauth = authorizeOpsTargets(
    options.grants,
    tool,
    plan.perTarget.map((target) => ({ id: target.id, connectionId: target.connectionId }))
  );
  if (!reauth.ok) {
    return opsDeny(
      OPS_DENIAL_CODES.grantUnmatched,
      { target_id: reauth.denied[0]?.targetId, reasons: reauth.denied[0]?.reasons }
    );
  }
  if (plan.perTarget.length === 0) return opsDeny(OPS_DENIAL_CODES.planTargetSetMismatch);

  const planTargetIds = new Set(plan.perTarget.map((target) => target.id));
  for (const id of options.requestTargetIds) {
    if (!planTargetIds.has(id)) return opsDeny(OPS_DENIAL_CODES.planParamTargetMismatch, { target_id: id });
  }

  // ── 成员视图（持久态 + 运行时） ─────────────────────────────────────────
  const members: MemberRuntime[] = plan.perTarget.map((target) => {
    const key = targetKey(options.idempotencyKey, plan.toolName, target.id);
    return runtimeOf(target, key, loadTargetRow(database, key));
  });

  // ── C3. 执行子集与组完整性【必须在认领之前】 ────────────────────────────
  const execSet = new Set(options.requestTargetIds);
  const priorState = new Map(members.map((member) => [member.target.id, member.state]));
  const touchedGroups = new Set(
    members.filter((member) => execSet.has(member.target.id)).map((member) => member.target.groupId)
  );
  for (const group of plan.groups) {
    if (!touchedGroups.has(group.id)) continue;
    const needed = members
      .filter((member) => member.target.groupId === group.id && priorState.get(member.target.id) !== "succeeded")
      .map((member) => member.target.id);
    if (!needed.every((id) => execSet.has(id))) {
      return opsDeny(OPS_DENIAL_CODES.groupSubsetIncomplete, { group_id: group.id, needed });
    }
  }

  // ── C4. 重入分派（只决定 attempt，不在这里写库） ─────────────────────────
  let attempt: number;
  if (!opRec) {
    attempt = 1;
  } else {
    if (opRec.planDigest !== plan.planDigest) return opsDeny(OPS_DENIAL_CODES.idempotencyConflict);
    if (opRec.actor !== options.actor) return opsDeny(OPS_DENIAL_CODES.idempotencyActorMismatch);

    let opState: OpsPersistentState;
    try {
      opState = aggregateOperationState(
        members.map((member) => ({ state: member.state, attempt: member.attempt }))
      );
    } catch (err) {
      if (err instanceof OpsStateCorruptError) {
        return opsDeny(OPS_DENIAL_CODES.stateCorrupt, err.detail);
      }
      return opsDeny(OPS_DENIAL_CODES.stateCorrupt, undefined, String(err));
    }
    if (opState === "succeeded") {
      return opsOk({ ...(opRec.result as Record<string, unknown>), replayed: true });
    }
    if (opState === "recovery_required") {
      return opsDeny(OPS_DENIAL_CODES.operationRecoveryRequired);
    }
    if (opState === "pending_activation") {
      return opsDeny(OPS_DENIAL_CODES.operationPendingActivation);
    }
    if (opState !== "pending" && opState !== "failed") {
      return opsDeny(OPS_DENIAL_CODES.stateCorrupt);
    }
    if (opState === "pending") {
      const unfinished = members.filter(
        (member) => member.state === "pending" && member.attempt !== null
      );
      if (unfinished.length > 0) {
        // C4.1 已有 operation 的续跑：恢复**只收敛**已认领未终结的成员。
        return recoverPending({
          adapter,
          projectRoot: options.projectRoot,
          actor: options.actor,
          delegatedFrom: options.delegatedFrom,
          database,
          opKey,
          opRec,
          members,
          execSet: unfinished.map((member) => member.target.id)
        });
      }
    }
    const eligible = new Set(
      members
        .filter(
          (member) =>
            (member.state === "pending" && member.attempt === null) || member.state === "failed"
        )
        .map((member) => member.target.id)
    );
    for (const id of options.requestTargetIds) {
      if (!eligible.has(id)) return opsDeny(OPS_DENIAL_CODES.operationScopeMismatch, { target_id: id });
    }
    attempt = opRec.attempt + 1;
  }

  // ── C5. 逐对象分流：只分类，不写库 ───────────────────────────────────────
  const toClaim: MemberRuntime[] = [];
  for (const member of members) {
    const prior = member.prior;
    if (prior) {
      if (!isPersistentState(prior.status)) {
        return opsDeny(OPS_DENIAL_CODES.stateCorrupt, { target_id: member.target.id });
      }
      member.state = prior.status;
      member.attempt = prior.attempt;
      member.result = prior.result;
      member.auditId = prior.auditId;
      if (prior.status === "succeeded") continue;
      if (prior.status === "recovery_required" || prior.status === "pending_activation") {
        return opsDeny(OPS_DENIAL_CODES.operationRecoveryRequired, { target_id: member.target.id });
      }
      if (prior.status === "failed") {
        // 失败痕迹留在旧 attempt；本次范围内的失败成员进入新 attempt 认领。
        if (execSet.has(member.target.id)) toClaim.push(member);
        continue;
      }
      // prior.status === "pending"
      if (prior.attempt !== null) {
        // 已认领未终结：必须先恢复，不得重跑。
        continue;
      }
      if (!execSet.has(member.target.id)) continue;
      toClaim.push(member);
      continue;
    }
    if (!execSet.has(member.target.id)) {
      member.state = "pending";
      member.attempt = null;
      continue;
    }
    toClaim.push(member);
  }

  // ── C5.1 本 attempt 一次事务提交（G34） ─────────────────────────────────
  const runtime: CommitRuntime = {
    database,
    plan,
    members,
    opKey,
    attempt,
    execSet,
    toClaim,
    opAuditId: undefined,
    blockedGroups: new Set<string>()
  };

  let bound;
  try {
    bound = claimAttemptTransaction(database, {
      operationKey: opKey,
      toolName: adapter.toolName,
      actor: options.actor,
      delegatedFrom: options.delegatedFrom,
      planId: plan.planId,
      planDigest: plan.planDigest,
      attempt,
      execSet: [...execSet],
      groupIds: [...touchedGroups],
      plan: plan as unknown as Record<string, unknown>,
      operationFilePath: adapter.operationAudit().filePath,
      operationChangeType: adapter.operationAudit().changeType,
      operationAssetKind: adapter.operationAudit().assetKind,
      targets: toClaim.map((member) => ({
        targetKey: member.targetKey,
        targetId: member.target.id,
        groupId: member.target.groupId,
        descriptor: member.target.audit,
        before: member.target.before,
        after: member.target.after
      }))
    });
  } catch (err) {
    if (err instanceof OpsClaimConflictError) return opsDeny(OPS_DENIAL_CODES.operationInFlight);
    return opsDeny(OPS_DENIAL_CODES.claimFailed, undefined, String(err));
  }
  runtime.opAuditId = bound.opAuditId;
  for (const member of toClaim) {
    member.auditId = bound.targetAuditIds.get(member.target.id) ?? member.auditId;
    member.state = "pending"; // 持久态
    member.attempt = attempt;
  }

  // ── C6. 组级状态机 ───────────────────────────────────────────────────────
  for (const group of plan.groups) {
    const claimed = toClaim.filter((member) => member.target.groupId === group.id);
    if (claimed.length === 0) continue;

    // C6.1 组级预检：组内任一 claimed 成员不可执行 → 整组不写。
    if (claimed.some((member) => member.target.blockers.length > 0)) {
      for (const member of claimed) {
        member.result = Outcome.failed("ops_group_blocked", { stage: "group" });
        member.state = "failed";
      }
      continue;
    }

    // C6.2 组级执行 + 撤销 + 核验 + 结论（同一 try 边界）。
    const groupContext: OpsGroupContext = {
      projectRoot: options.projectRoot,
      group,
      members: claimed.map((member) => member.target),
      actor: options.actor,
      delegatedFrom: options.delegatedFrom,
      executionId: opsExecutionId(opKey, attempt, group.id),
      setEffectPhase: (targetId, phase) => {
        const member = claimed.find((item) => item.target.id === targetId);
        if (!member) return;
        setTargetEffectPhase(database, member.targetKey, phase);
        if (member.prior) member.prior.effectPhase = phase;
      }
    };
    try {
      await adapter.executeGroup(groupContext);
      for (const member of claimed) {
        member.result = Outcome.succeeded(keepOf(member.result));
        member.state = "succeeded";
      }
      // C6.2a 组终结：延后动作（版本索引裁剪等）只在组确认成功后执行一次。
      // 组失败路径不调用——被裁剪的旧版本必须仍可读。
      if (adapter.finalizeGroup) {
        try {
          await adapter.finalizeGroup(groupContext);
        } catch (finalizeErr) {
          // 终结动作失败不改变组的成功结论（写入已生效且已核验），
          // 但必须留痕，不得静默吞掉。
          for (const member of claimed) {
            member.result = Outcome.succeeded({
              ...(keepOf(member.result) ?? {}),
              detail: { finalize_error: String(finalizeErr) }
            });
          }
        }
      }
    } catch (err) {
      const outcome = outcomeOfError(err);
      if (outcome.kind === "failed") {
        // 明确失败且确认无残留效果 → 组级撤销。
        let rollback: OpsRollbackResult = { complete: true };
        try {
          rollback = await adapter.rollbackGroup(groupContext);
        } catch (rollbackErr) {
          rollback = { complete: false, detail: String(rollbackErr) };
        }
        if (!rollback.complete) {
          runtime.blockedGroups.add(group.id);
          for (const member of claimed) {
            member.result = Outcome.recoveryRequired({
              keep: keepOf(member.result),
              detail: rollback
            });
            member.state = "recovery_required";
          }
          continue;
        }
        // 撤销完成 → 丢弃该组的暂存状态，且**不再**执行组终结动作。
        if (adapter.discardGroup) {
          try {
            await adapter.discardGroup(groupContext);
          } catch (discardErr) {
            // 清理失败只影响暂存内存，不改变撤销结论。
          }
        }
        for (const member of claimed) {
          member.result = Outcome.failed("ops_group_rolled_back", {
            stage: "group_rollback",
            detail: { original_failure: outcome.detail, rollback }
          });
          member.state = "failed";
        }
        continue;
      }
      if (outcome.kind === "pending_activation") {
        for (const member of claimed) {
          member.result = Outcome.pendingActivation({
            release: outcome.release,
            activation: outcome.activation,
            keep: keepOf(member.result)
          });
          member.state = "pending_activation";
        }
        continue;
      }
      if (outcome.kind === "recovery_required") {
        runtime.blockedGroups.add(group.id);
        for (const member of claimed) {
          member.result = Outcome.recoveryRequired({
            keep: keepOf(member.result),
            detail: outcome.detail ?? outcome
          });
          member.state = "recovery_required";
        }
        continue;
      }
      // 未知异常：效果可能已发生 → 恢复分支，不得直接判失败。
      runtime.blockedGroups.add(group.id);
      for (const member of claimed) {
        member.result = Outcome.recoveryRequired({ keep: keepOf(member.result), detail: outcome.detail });
        member.state = "recovery_required";
      }
    }
  }

  // ── C7. 统一终结 ─────────────────────────────────────────────────────────
  for (const member of members) {
    if ((member.state === "succeeded" || member.state === "failed") && member.attempt === attempt) {
      try {
        updateAuditById(
          database,
          member.auditId,
          member.state === "succeeded" ? "committed" : "failed",
          member.state === "succeeded" ? null : resultCode(member.result) ?? "ops_target_failed"
        );
        finalizeTargetRow(database, member.targetKey, member.state, member.result);
      } catch (err) {
        member.result = Outcome.recoveryRequired({ keep: keepOf(member.result), detail: String(err) });
        member.state = "recovery_required";
        runtime.blockedGroups.add(member.target.groupId);
      }
    }
  }

  // ── C7.1 非终态目标：只写进度，审计行保持 pending ───────────────────────
  for (const member of members) {
    if (
      member.state === "recovery_required" ||
      member.state === "pending_activation" ||
      member.state === "pending"
    ) {
      persistTargetProgress(database, {
        targetKey: member.targetKey,
        status: member.state,
        attempt: member.attempt,
        auditId: member.auditId,
        result: member.result,
        effectPhase: member.prior?.effectPhase ?? "none"
      });
    }
  }

  // ── C7.2 全集聚合写 operation 记录 ──────────────────────────────────────
  let opState: OpsPersistentState;
  try {
    opState = aggregateOperationState(
      members.map((member) => ({ state: member.state, attempt: member.attempt }))
    );
  } catch (err) {
    return opsDeny(OPS_DENIAL_CODES.stateCorrupt, undefined, String(err));
  }

  const attemptMembers = members.filter(
    (member) => member.attempt === attempt && toClaim.includes(member)
  );
  let attemptState: OpsPersistentState;
  try {
    attemptState = aggregateOperationState(
      attemptMembers.map((member) => ({ state: member.state, attempt: member.attempt }))
    );
  } catch {
    attemptState = "pending";
  }

  const summary = buildSummary(members, opState, runtime.blockedGroups);

  try {
    if ((attemptState === "succeeded" || attemptState === "failed") && runtime.opAuditId !== undefined) {
      updateAuditById(
        database,
        runtime.opAuditId,
        attemptState === "succeeded" ? "committed" : "failed",
        attemptState === "succeeded" ? null : "ops_attempt_failed"
      );
    }
    if (opState === "succeeded" || opState === "failed") {
      finalizeOperationRow(database, opKey, opState, summary);
    } else {
      upsertOperationRow(database, {
        operationKey: opKey,
        toolName: adapter.toolName,
        actor: options.actor,
        delegatedFrom: options.delegatedFrom,
        planId: plan.planId,
        planDigest: plan.planDigest,
        status: opState,
        attempt,
        execSet: [...execSet],
        groupIds: [...touchedGroups],
        result: summary,
        plan: plan as unknown as Record<string, unknown>
      });
    }
  } catch (err) {
    return opsOk({ ...summary, warning: "ops_finalize_incomplete", detail: String(err) });
  }

  return opsOk(summary);
}

function buildSummary(
  members: MemberRuntime[],
  opState: OpsPersistentState,
  blockedGroups: Set<string>
): Record<string, unknown> {
  const results = members.map((member) => ({
    id: member.target.id,
    group_id: member.target.groupId,
    attempt: member.attempt,
    kind: member.state,
    ok: member.state === "succeeded" ? true : member.state === "failed" ? false : null,
    code: resultCode(member.result) ?? null,
    stage: resultStage(member.result) ?? null
  }));
  const succeeded = members.filter((member) => member.state === "succeeded").length;
  const failed = members.filter((member) => member.state === "failed").length;
  const pending = members.length - succeeded - failed;
  return {
    per_target: results,
    succeeded,
    failed,
    pending,
    operation_state: opState,
    blocked_groups: [...blockedGroups]
  };
}

function isPersistentState(value: unknown): value is OpsPersistentState {
  return (
    value === "pending" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "recovery_required" ||
    value === "pending_activation"
  );
}

/** 结果里的稳定原因码。 */
function resultCode(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const code = (result as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** 结果里的阶段标记。 */
function resultStage(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const stage = (result as { stage?: unknown }).stage;
  return typeof stage === "string" ? stage : undefined;
}

/** 保留既有结果字段（`release` / `activation` 等），不得降级。 */
function keepOf(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  const keep: Record<string, unknown> = {};
  if (record.release !== undefined) keep.release = record.release;
  if (record.activation !== undefined) keep.activation = record.activation;
  if (record.detail !== undefined) keep.detail = record.detail;
  return Object.keys(keep).length > 0 ? keep : undefined;
}

/** 组执行异常 → 四分类结果。 */
function outcomeOfError(err: unknown): OpsOutcome & { release?: unknown; activation?: unknown } {
  const candidate = err as { opsOutcome?: OpsOutcome } | undefined;
  if (candidate?.opsOutcome && typeof candidate.opsOutcome === "object") {
    return candidate.opsOutcome;
  }
  return Outcome.failed("ops_group_error", { stage: "group", detail: String(err) });
}
