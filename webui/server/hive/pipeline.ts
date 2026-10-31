/**
 * Hive query pipeline — fixed stage order and failure classification.
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §5 (compile stages)
 *   - docs/specs/lucy-20261030-hive-query-execution-spec.md §6 (partition + JDBC)
 *
 * Fixed order:
 *
 *   audit receive → config/asset snapshot → request & ACL → budget/concurrency
 *   → source closure → partition status → compile → AST/policy check
 *   → partition predicate gate → admission ledger → JDBC → type & truncation
 *   → response-prepared ledger → release
 *
 * Two structural rules:
 *
 * 1. A failed safety precondition never becomes an empty success.
 * 2. A failure at or after compile must set `upstreamMayHaveExecuted`.
 */

/** The fixed pipeline order. */
export const HIVE_PIPELINE_STAGES = [
  "audit_receive",
  "config_snapshot",
  "request_acl",
  "budget_concurrency",
  "source_closure",
  "partition_status",
  "compile",
  "ast_policy_check",
  "partition_predicate_gate",
  "admission_ledger",
  "jdbc",
  "type_truncation",
  "response_prepared_ledger",
  "release"
] as const;

export type HivePipelineStage = (typeof HIVE_PIPELINE_STAGES)[number];

export type HivePipelineClassification =
  | "audit_unavailable"
  | "config_unavailable"
  | "denied"
  | "budget_unavailable"
  | "source_closure_failed"
  | "partition_status_unknown"
  | "compile_failed"
  | "check_failed"
  | "partition_gate_failed"
  | "admission_failed"
  | "jdbc_failed"
  | "not_implemented"
  | "internal_error";

export type HivePipelineFailure = {
  stage: HivePipelineStage;
  classification: HivePipelineClassification;
  /** A stable machine reason. */
  reason: string;
  detail?: string;
  /**
   * True when the failure happened at or after the compile stage, so the
   * upstream may already have executed. The caller must not claim the
   * opposite.
   */
  upstreamMayHaveExecuted: boolean;
};

export type HivePipelineResult<T> =
  | { ok: true; value: T; executedStages: HivePipelineStage[] }
  | { ok: false; failure: HivePipelineFailure; executedStages: HivePipelineStage[] };

export type HivePipelineStep<T> = {
  stage: HivePipelineStage;
  run: () => Promise<
    | { ok: true; value: unknown }
    | { ok: false; classification: HivePipelineClassification; reason: string; detail?: string }
  >;
};

/**
 * The stage at which the upstream (compile / database) may have run.
 *
 * Everything from `compile` onwards is "the upstream may have executed".
 * Partition gate failures happen after compile, so they also set the flag —
 * but JDBC must not have been invoked (enforced by short-circuit).
 */
const UPSTREAM_MAY_HAVE_EXECUTED_FROM: HivePipelineStage = "compile";

export function upstreamMayHaveExecuted(stage: HivePipelineStage): boolean {
  const order = HIVE_PIPELINE_STAGES.indexOf(stage);
  const threshold = HIVE_PIPELINE_STAGES.indexOf(UPSTREAM_MAY_HAVE_EXECUTED_FROM);
  return order >= threshold;
}

/**
 * Stages that this wave does not implement.
 *
 * Execution wave M3 enables JDBC via an injected worker; the list is empty.
 * Kept as an export so older compile-wave tests can still assert the helper.
 */
export const HIVE_UNIMPLEMENTED_STAGES: readonly HivePipelineStage[] = [];

export function isHiveStageImplemented(stage: HivePipelineStage): boolean {
  return !HIVE_UNIMPLEMENTED_STAGES.includes(stage);
}

/** Build the typed failure for a stage that this wave does not implement. */
export function hiveNotImplementedFailure(stage: HivePipelineStage): HivePipelineFailure {
  return {
    stage,
    classification: "not_implemented",
    reason: `hive_stage_not_implemented:${stage}`,
    detail: "This Hive pipeline stage is not implemented in the current wave",
    upstreamMayHaveExecuted: upstreamMayHaveExecuted(stage)
  };
}

/**
 * Run the pipeline.
 *
 * The first failing stage short-circuits the run. `executedStages` lists the
 * stages that actually ran, so an observer can tell "the compile never
 * happened" from "the compile happened and the response could not be
 * persisted".
 */
export async function runHivePipeline<T>(
  steps: ReadonlyArray<HivePipelineStep<T>>
): Promise<HivePipelineResult<T>> {
  const executedStages: HivePipelineStage[] = [];
  let value: T | undefined;

  for (const step of steps) {
    if (!isHiveStageImplemented(step.stage)) {
      return {
        ok: false,
        failure: hiveNotImplementedFailure(step.stage),
        executedStages
      };
    }

    let outcome: Awaited<ReturnType<HivePipelineStep<T>["run"]>>;
    try {
      outcome = await step.run();
    } catch (error) {
      return {
        ok: false,
        failure: {
          stage: step.stage,
          classification: "internal_error",
          reason: `hive_stage_threw:${step.stage}`,
          detail: error instanceof Error ? error.message : String(error),
          upstreamMayHaveExecuted: upstreamMayHaveExecuted(step.stage)
        },
        executedStages
      };
    }

    executedStages.push(step.stage);

    if (!outcome.ok) {
      return {
        ok: false,
        failure: {
          stage: step.stage,
          classification: outcome.classification,
          reason: outcome.reason,
          detail: outcome.detail,
          upstreamMayHaveExecuted: upstreamMayHaveExecuted(step.stage)
        },
        executedStages
      };
    }
    value = outcome.value as T;
  }

  if (steps.length === 0) {
    return {
      ok: false,
      failure: {
        stage: "audit_receive",
        classification: "internal_error",
        reason: "hive_pipeline_empty",
        upstreamMayHaveExecuted: false
      },
      executedStages
    };
  }
  return { ok: true, value: value as T, executedStages };
}
