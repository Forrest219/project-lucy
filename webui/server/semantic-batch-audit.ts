/**
 * Lucy v0.25 — the audit payload builder for semantic batch operations.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §7.3 (audit), §10 V13 / V14, and §11 D22.
 *
 * ── The contract ───────────────────────────────────────────────────────────
 * Spec §7.3: "记录 actor、operationId、scopeId、planDigest、releaseId、
 * attemptId、基线与候选 hash、对象数量、分项结果及恢复状态；不得把下载、
 * 预检或校验记成发布成功。"
 *
 * This module BUILDS the payload. It never writes it: the write goes through
 * `admin/audit.ts` / `config-audit-write.ts`, which are owned by another
 * work stream. The builder therefore produces a record that is structurally
 * compatible with `recordConfigChange`, and it refuses to describe a
 * download, a pre-check or a validation as a successful publish.
 *
 * ── The `publishEffect` flag ───────────────────────────────────────────────
 * `publishEffect` is the machine-readable version of "不得把下载、预检或校验
 * 记成发布成功". It is true for exactly one outcome: a completed publish.
 * Every other outcome — an export, a validation, a staged import, a failure,
 * a block — carries `publishEffect: false`, so a downstream consumer that
 * only looks at the flag can never mistake a download for a publish.
 */

import {
  UNKNOWN_ACTIVATION_STATE,
  type SemanticReleaseActivationState
} from "./semantic-release-status";

export type SemanticBatchAuditOutcome =
  /** 语义维护包已导出（下载）。 */
  | "exported"
  /** 批量校验完成。 */
  | "validated"
  /** 导入语义资产包已暂存（尚未生效）。 */
  | "staged"
  /** 正式文件已保存并已生效。 */
  | "published"
  /** 执行失败。 */
  | "failed"
  /** 被规则阻断。 */
  | "blocked";

/** The only outcome that represents a real publish effect. */
const PUBLISH_EFFECT_OUTCOMES: ReadonlySet<SemanticBatchAuditOutcome> = new Set(["published"]);

export interface SemanticBatchAuditResultCounts {
  passed: number;
  failed: number;
  notRun: number;
  stale: number;
  /** Read-only dependencies, counted separately from the selected tables. */
  dependencies: number;
}

export interface SemanticBatchAuditPayload {
  actor: string;
  actorType: "ui_admin" | "batch_job" | "system";
  operationId: string;
  scopeId?: string;
  planDigest?: string;
  releaseId?: string;
  attemptId?: string;
  /** The baseline hash the operation was bound to. */
  baselineDigest?: string;
  /** The candidate hash the operation produced. */
  candidateDigest?: string;
  /** How many objects the operation covered. */
  objectCount: number;
  outcome: SemanticBatchAuditOutcome;
  /** True only for a completed publish. */
  publishEffect: boolean;
  results: SemanticBatchAuditResultCounts;
  /** The recovery / activation state of the affected release. */
  recovery: SemanticReleaseActivationState;
  /** Extra facts. Must never contain raw YAML, credentials or host paths. */
  details?: Record<string, unknown>;
}

export class SemanticAuditPayloadError extends Error {
  readonly code = "SEMANTIC_AUDIT_PAYLOAD_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "SemanticAuditPayloadError";
  }
}

export interface BuildSemanticBatchAuditPayloadInput {
  actor: string;
  actorType?: "ui_admin" | "batch_job" | "system";
  operationId: string;
  outcome: SemanticBatchAuditOutcome;
  scopeId?: string;
  planDigest?: string;
  releaseId?: string;
  attemptId?: string;
  baselineDigest?: string;
  candidateDigest?: string;
  objectCount: number;
  results?: Partial<SemanticBatchAuditResultCounts>;
  recovery?: SemanticReleaseActivationState;
  details?: Record<string, unknown>;
}

/**
 * Build the audit payload.
 *
 * The `publishEffect` flag is derived from the outcome — it can never be set
 * by the caller, so a download / pre-check / validation cannot be recorded as
 * a successful publish.
 */
export function buildSemanticBatchAuditPayload(
  input: BuildSemanticBatchAuditPayloadInput
): SemanticBatchAuditPayload {
  if (!input.actor.trim()) {
    throw new SemanticAuditPayloadError("审计载荷必须包含操作者。");
  }
  if (!input.operationId.trim()) {
    throw new SemanticAuditPayloadError("审计载荷必须包含 operationId。");
  }

  const publishEffect = PUBLISH_EFFECT_OUTCOMES.has(input.outcome);

  return {
    actor: input.actor,
    actorType: input.actorType ?? "ui_admin",
    operationId: input.operationId,
    ...(input.scopeId ? { scopeId: input.scopeId } : {}),
    ...(input.planDigest ? { planDigest: input.planDigest } : {}),
    ...(input.releaseId ? { releaseId: input.releaseId } : {}),
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    ...(input.baselineDigest ? { baselineDigest: input.baselineDigest } : {}),
    ...(input.candidateDigest ? { candidateDigest: input.candidateDigest } : {}),
    objectCount: Math.max(0, Math.trunc(input.objectCount)),
    outcome: input.outcome,
    publishEffect,
    results: {
      passed: input.results?.passed ?? 0,
      failed: input.results?.failed ?? 0,
      notRun: input.results?.notRun ?? 0,
      stale: input.results?.stale ?? 0,
      dependencies: input.results?.dependencies ?? 0
    },
    recovery: input.recovery ?? { ...UNKNOWN_ACTIVATION_STATE },
    ...(input.details ? { details: input.details } : {})
  };
}

/**
 * Guard: a payload that claims a publish effect must actually carry the
 * release identity and a confirmed activation.
 *
 * This is the machine check behind "不得把下载、预检或校验记成发布成功".
 */
export function assertSemanticAuditPayloadConsistent(
  payload: SemanticBatchAuditPayload
): void {
  if (!payload.publishEffect) {
    if (payload.outcome === "published") {
      throw new SemanticAuditPayloadError("published 结论必须带 publishEffect。");
    }
    return;
  }
  if (payload.outcome !== "published") {
    throw new SemanticAuditPayloadError(
      `非发布结论（${payload.outcome}）不得带 publishEffect。`
    );
  }
  if (!payload.releaseId) {
    throw new SemanticAuditPayloadError("发布成功的审计记录必须包含 releaseId。");
  }
  if (payload.recovery.activationStatus !== "confirmed") {
    throw new SemanticAuditPayloadError(
      "发布成功的审计记录必须带已确认的生效状态；生效状态待确认时只能记为 failed/blocked。"
    );
  }
}

/**
 * The `recordConfigChange`-compatible record for the payload.
 *
 * The shape mirrors `admin/audit.ts` `recordConfigChange` so the caller can
 * hand it over without touching that module. `oldSummary` carries the
 * baseline facts, `newSummary` the candidate facts.
 */
export function buildSemanticBatchAuditRecord(payload: SemanticBatchAuditPayload): {
  changeType: string;
  filePath: string;
  actor: string;
  actorType: "ui_admin" | "batch_job" | "system";
  assetKind: "semantic";
  operation: string;
  writeStatus: "pending" | "committed" | "failed" | "rolled_back";
  targetId?: string;
  oldSummary: Record<string, unknown>;
  newSummary: Record<string, unknown>;
  idempotencyKey?: string;
  requestId?: string;
  errorReason?: string;
} {
  const oldSummary: Record<string, unknown> = {
    outcome: payload.outcome,
    publishEffect: payload.publishEffect,
    scopeId: payload.scopeId ?? null,
    planDigest: payload.planDigest ?? null,
    baselineDigest: payload.baselineDigest ?? null,
    objectCount: payload.objectCount,
    results: payload.results,
    recovery: payload.recovery,
    ...(payload.details ?? {})
  };
  const newSummary: Record<string, unknown> = {
    operationId: payload.operationId,
    releaseId: payload.releaseId ?? null,
    attemptId: payload.attemptId ?? null,
    candidateDigest: payload.candidateDigest ?? null,
    outcome: payload.outcome,
    publishEffect: payload.publishEffect
  };

  return {
    changeType: `semantic_batch_${payload.outcome}`,
    filePath: payload.scopeId ? `scope/${payload.scopeId}` : `operation/${payload.operationId}`,
    actor: payload.actor,
    actorType: payload.actorType,
    assetKind: "semantic",
    operation: payload.outcome,
    writeStatus: payload.outcome === "published" ? "committed" : payload.outcome === "failed" ? "failed" : "pending",
    ...(payload.releaseId ? { targetId: payload.releaseId } : {}),
    oldSummary,
    newSummary,
    ...(payload.operationId ? { requestId: payload.operationId } : {})
  };
}
