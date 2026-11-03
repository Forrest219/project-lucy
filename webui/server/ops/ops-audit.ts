/**
 * L25-16 — 控制面双层审计（Spec §4.4，G34）。
 *
 * 一次调用 = **1 条 operation 级**审计（`targetId` 为空）+ **N 条 target 级**审计
 * （每目标每次尝试一条）。
 *
 * ⚠️ **认领与审计必须同事务（Normative，G34）**：本 attempt 的
 * operation 认领 + operation 审计 + target 认领 + target 审计，必须在 `audit.sqlite` 的
 * **同一次** `db.transaction()` 里提交，然后才允许产生文件效果。
 * 事务提交前崩溃或回滚：本 attempt 不留下幂等行，也不留下审计行，返回 `ops_claim_failed`。
 *
 * ⚠️ **审计事件键含 attempt（R10）**：`config_change_log.idempotency_key` 列填
 * `audit_key = hash(<业务键>, attempt)`。同一次尝试内的状态变化按 `auditId` 更新既有行，
 * **不重插**——同键重插会被 `ON CONFLICT(idempotency_key) DO NOTHING` 静默丢弃。
 */

import type Database from "better-sqlite3";
import {
  insertConfigChangeRow,
  updateConfigChangeRow,
  type ConfigAuditAssetKind,
  type ConfigAuditWriteStatus
} from "../admin/audit.js";
import { auditKey, upsertOperationRow, upsertTargetRow, type OpsEffectPhase } from "./ops-idempotency.js";
import type { OpsPersistentState } from "./ops-outcome.js";

/** 控制面来源的审计 actorType（§4.4，G2）。 */
export const OPS_AUDIT_ACTOR_TYPE = "mcp_control_plane" as const;

export interface OpsTargetAuditDescriptor {
  changeType: string;
  assetKind: ConfigAuditAssetKind;
  /** target 级审计的 `target_id`。 */
  targetId: string;
  filePath: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
}

export interface OpsAuditContext {
  actor: string;
  delegatedFrom: string | null;
  operationId: string;
}

export interface OpsClaimTargetInput {
  targetKey: string;
  targetId: string;
  groupId: string | null;
  descriptor: OpsTargetAuditDescriptor;
  before?: unknown;
  after?: unknown;
}

export interface OpsClaimInput {
  operationKey: string;
  toolName: string;
  actor: string;
  delegatedFrom: string | null;
  planId: string;
  planDigest: string;
  attempt: number;
  execSet: string[];
  groupIds: string[];
  plan: Record<string, unknown>;
  /** operation 级审计的落点文件（通常是工具的主写集文件）。 */
  operationFilePath: string;
  /** operation 级审计的 changeType。 */
  operationChangeType: string;
  /** operation 级审计的 assetKind。 */
  operationAssetKind: ConfigAuditAssetKind;
  targets: OpsClaimTargetInput[];
}

export interface OpsClaimBound {
  opAuditId: number | undefined;
  targetAuditIds: Map<string, number | undefined>;
}

/** 并发同键：存储层已存在一个更新的 attempt 认领。 */
export class OpsClaimConflictError extends Error {
  readonly code = "ops_claim_conflict";

  constructor(message = "operation claim conflict") {
    super(message);
    this.name = "OpsClaimConflictError";
  }
}

/**
 * G34 — 本 attempt 的**一次事务**认领。
 *
 * 事务内写入：
 * 1. operation 幂等记录（`status = pending`，`attempt = 本次 attempt`）；
 * 2. 1 条 operation 级 pending 审计行；
 * 3. 每个 target 的幂等记录（`status = pending`，`attempt = 本次 attempt`）；
 * 4. 每个 target 的 1 条 pending 审计行。
 *
 * 任何一步抛错 → 整段回滚 → 调用方返回 `ops_claim_failed`（不留行、不写文件）。
 */
export function claimAttemptTransaction(
  database: Database.Database,
  input: OpsClaimInput
): OpsClaimBound {
  const now = new Date().toISOString();
  const run = database.transaction((): OpsClaimBound => {
    // 并发同键保护：同一 operation 若已被更晚的 attempt 认领，当前认领失败。
    const existing = database
      .prepare("SELECT attempt FROM ops_operations WHERE operation_key = ?")
      .get(input.operationKey) as { attempt: number } | undefined;
    if (existing && existing.attempt >= input.attempt) {
      throw new OpsClaimConflictError(
        `operation ${input.operationKey} already claimed at attempt ${existing.attempt}`
      );
    }

    upsertOperationRow(database, {
      operationKey: input.operationKey,
      toolName: input.toolName,
      actor: input.actor,
      delegatedFrom: input.delegatedFrom,
      planId: input.planId,
      planDigest: input.planDigest,
      status: "pending",
      attempt: input.attempt,
      execSet: input.execSet,
      groupIds: input.groupIds,
      result: null,
      plan: input.plan
    });

    const opAuditId = insertConfigChangeRow(database, {
      filePath: input.operationFilePath,
      changeType: input.operationChangeType,
      actor: input.actor,
      actorType: OPS_AUDIT_ACTOR_TYPE,
      source: `lucy_ops:${input.toolName}`,
      assetKind: input.operationAssetKind,
      operation: input.operationKey,
      targetId: "",
      writeStatus: "pending",
      idempotencyKey: auditKey(input.operationKey, input.attempt),
      requestId: input.operationKey,
      sessionId: null,
      delegatedFrom: input.delegatedFrom,
      oldSummary: { attempt: input.attempt, execSet: input.execSet, groupIds: input.groupIds },
      newSummary: null
    });

    const targetAuditIds = new Map<string, number | undefined>();
    for (const target of input.targets) {
      const auditId = insertConfigChangeRow(database, {
        filePath: target.descriptor.filePath,
        changeType: target.descriptor.changeType,
        actor: input.actor,
        actorType: OPS_AUDIT_ACTOR_TYPE,
        source: `lucy_ops:${input.toolName}`,
        assetKind: target.descriptor.assetKind,
        operation: input.operationKey,
        targetId: target.descriptor.targetId,
        writeStatus: "pending",
        idempotencyKey: auditKey(target.targetKey, input.attempt),
        requestId: input.operationKey,
        sessionId: null,
        delegatedFrom: input.delegatedFrom,
        oldSummary: target.descriptor.oldSummary,
        newSummary: target.descriptor.newSummary,
        diff: target.descriptor.diff
      });
      targetAuditIds.set(target.targetId, auditId);

      upsertTargetRow(database, {
        targetKey: target.targetKey,
        operationKey: input.operationKey,
        targetId: target.targetId,
        groupId: target.groupId,
        status: "pending",
        attempt: input.attempt,
        auditId: auditId ?? null,
        result: null,
        before: target.before,
        after: target.after,
        effectPhase: "none",
        releaseId: null
      });
    }
    void now;
    return { opAuditId, targetAuditIds };
  });
  return run();
}

/** 按 `auditId` 更新既有审计行（**不重插**）。 */
export function updateAuditById(
  database: Database.Database,
  auditId: number | undefined | null,
  writeStatus: ConfigAuditWriteStatus,
  errorReason?: string | null
): void {
  if (auditId === undefined || auditId === null) return;
  updateConfigChangeRow(database, { id: auditId, writeStatus, errorReason: errorReason ?? undefined });
}

/** 记录效果阶段（供恢复流程判定 `none` / `written` / `activated`）。 */
export function setTargetEffectPhase(
  database: Database.Database,
  targetKey: string,
  effectPhase: OpsEffectPhase
): void {
  database
    .prepare("UPDATE ops_targets SET effect_phase = ?, updated_at = ? WHERE target_key = ?")
    .run(effectPhase, new Date().toISOString(), targetKey);
}

/** 写入非终态目标的进度（state / release_id / effect_phase / attempt / audit_id）。 */
export function persistTargetProgress(
  database: Database.Database,
  input: {
    targetKey: string;
    status: OpsPersistentState;
    attempt: number | null;
    auditId: number | null;
    result: unknown;
    effectPhase: OpsEffectPhase;
    releaseId?: string | null;
  }
): void {
  database
    .prepare(
      `UPDATE ops_targets
       SET status = @status, attempt = @attempt, audit_id = COALESCE(@audit_id, audit_id),
           result = @result, effect_phase = @effect_phase, release_id = COALESCE(@release_id, release_id),
           updated_at = @updated_at
       WHERE target_key = @target_key`
    )
    .run({
      target_key: input.targetKey,
      status: input.status,
      attempt: input.attempt,
      audit_id: input.auditId,
      result: input.result === undefined || input.result === null ? null : JSON.stringify(input.result),
      effect_phase: input.effectPhase,
      release_id: input.releaseId ?? null,
      updated_at: new Date().toISOString()
    });
}
