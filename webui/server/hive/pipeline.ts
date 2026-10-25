/**
 * Hive compile pipeline — fixed stage order and failure classification.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §5
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H7)
 *
 * The failure order is fixed and is the whole point of this module:
 *
 *   audit receive → config/asset snapshot → request & ACL → budget/concurrency
 *   → source closure → compile → AST/policy check → admission ledger
 *   → JDBC → type & truncation → response-prepared ledger → release
 *
 * Two rules the runner enforces structurally:
 *
 * 1. **A failed safety precondition never becomes an empty success.** The
 *    runner stops at the first failing stage and returns that failure; no
 *    later stage runs, so there is no path from "denied" to "succeeded with
 *    zero rows".
 *
 * 2. **A failure after the compile stage does not claim that nothing ran.**
 *    The failure carries `upstreamMayHaveExecuted`, so the caller cannot
 *    report "the upstream never executed" for a failure that happened after
 *    the compile step.
 *
 * This wave implements the compile side only. The JDBC stage is explicitly
 * `not_implemented`: it is never reported as executed, and a caller that
 * reaches it gets a typed "not implemented" failure rather than a silent
 * success.
 */

/** The fixed pipeline order. */
export const HIVE_PIPELINE_STAGES = [
  "audit_receive",
  "config_snapshot",
  "request_acl",
  "budget_concurrency",
  "source_closure",
  "compile",
  "ast_policy_check",
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
  | "compile_failed"
  | "check_failed"
  | "admission_failed"
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
 * The JDBC stage belongs to H25-03 (managed JDBC worker). Until it exists,
 * the pipeline must say so instead of pretending the query ran.
 */
export const HIVE_UNIMPLEMENTED_STAGES: readonly HivePipelineStage[] = ["jdbc"];

export function isHiveStageImplemented(stage: HivePipelineStage): boolean {
  return !HIVE_UNIMPLEMENTED_STAGES.includes(stage);
}

/** Build the typed failure for a stage that this wave does not implement. */
export function hiveNotImplementedFailure(stage: HivePipelineStage): HivePipelineFailure {
  return {
    stage,
    classification: "not_implemented",
    reason: `hive_stage_not_implemented:${stage}`,
    detail:
      "The Hive JDBC execution stage is not implemented in this wave; the compile-side result must not be reported as an executed query",
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
