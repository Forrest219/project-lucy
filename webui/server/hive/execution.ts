/**
 * Hive query execution orchestrator (execution-wave M3–M5).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md §6
 *
 * Compiles (or accepts precompiled SQL), runs the partition predicate gate,
 * then optionally dispatches to a JDBC worker. Explain mode never reaches JDBC.
 */

import { checkHivePartitionGate, type HivePartitionGateReason } from "./partition-gate.js";
import type { HivePartitionProfile } from "./partition-profile.js";
import {
  runHivePipeline,
  type HivePipelineResult,
  type HivePipelineStage,
  type HivePipelineStep
} from "./pipeline.js";
import {
  type HiveJdbcExecuteResult,
  type HiveJdbcExecuteSuccess,
  type HiveJdbcWorker
} from "./jdbc-worker.js";

export type HiveExecutionTool = "lucy_query" | "lucy_explain_query" | "lucy_read_source";

export type HiveExecutionInput = {
  tool: HiveExecutionTool;
  connectionId: string;
  /** SQL already produced by the Hive compile bridge (or a synthetic fixture). */
  compiledSql: string;
  profilesByPhysicalTable: Map<string, HivePartitionProfile>;
  jdbcWorker: HiveJdbcWorker;
  deadlineMs: number;
  maxRows: number;
  correlationId?: string;
  /** When true, skip JDBC even for lucy_query (used by explain and dry-run). */
  explainOnly?: boolean;
};

export type HiveExecutionSuccess = {
  columns: HiveJdbcExecuteSuccess["columns"];
  rows: HiveJdbcExecuteSuccess["rows"];
  truncated: boolean;
  canceled: boolean;
  terminalState: HiveJdbcExecuteSuccess["terminalState"];
  /** Always 0 for explain / gate denial; 1 on successful or failed JDBC attempt. */
  jdbcInvokeCount: number;
  gate: { ok: true };
  explainOnly: boolean;
};

export type HiveExecutionFailure = {
  stage: HivePipelineStage;
  reason: string;
  detail?: string;
  jdbcInvokeCount: number;
  upstreamMayHaveExecuted: boolean;
};

export type HiveExecutionResult =
  | { ok: true; value: HiveExecutionSuccess; executedStages: HivePipelineStage[] }
  | { ok: false; failure: HiveExecutionFailure; executedStages: HivePipelineStage[] };

function gateClassification(reason: HivePartitionGateReason): "partition_status_unknown" | "partition_gate_failed" {
  if (reason === "hive_partition_status_unknown") return "partition_status_unknown";
  return "partition_gate_failed";
}

/**
 * Run partition gate → (optional) JDBC for a compiled Hive SQL statement.
 *
 * Gate failure guarantees `jdbcInvokeCount === 0`.
 */
export async function runHiveExecution(input: HiveExecutionInput): Promise<HiveExecutionResult> {
  let jdbcInvokeCount = 0;
  const explainOnly = input.explainOnly === true || input.tool === "lucy_explain_query";

  const steps: HivePipelineStep<HiveExecutionSuccess>[] = [
    {
      stage: "partition_status",
      run: async () => {
        // Unknown is enforced inside the gate against each physical table.
        // This stage exists so failure order matches Spec §6 even when the
        // caller already supplied profiles.
        for (const [table, profile] of input.profilesByPhysicalTable) {
          if (profile.status === "unknown") {
            return {
              ok: false,
              classification: "partition_status_unknown",
              reason: "hive_partition_status_unknown",
              detail: `Partition status for '${table}' is unknown; refusing query`
            };
          }
        }
        return { ok: true, value: null };
      }
    },
    {
      stage: "partition_predicate_gate",
      run: async () => {
        const gate = checkHivePartitionGate({
          sql: input.compiledSql,
          profilesByPhysicalTable: input.profilesByPhysicalTable
        });
        if (!gate.ok) {
          return {
            ok: false,
            classification: gateClassification(gate.reason),
            reason: gate.reason,
            detail: gate.detail
          };
        }
        return { ok: true, value: null };
      }
    },
    {
      stage: "admission_ledger",
      run: async () => ({ ok: true, value: null })
    }
  ];

  if (!explainOnly) {
    steps.push({
      stage: "jdbc",
      run: async () => {
        jdbcInvokeCount += 1;
        const result: HiveJdbcExecuteResult = await input.jdbcWorker.execute({
          connectionId: input.connectionId,
          sql: input.compiledSql,
          deadlineMs: input.deadlineMs,
          maxRows: input.maxRows,
          correlationId: input.correlationId
        });
        if (!result.ok) {
          return {
            ok: false,
            classification: "jdbc_failed",
            reason: result.failure.reason,
            detail: result.failure.detail
          };
        }
        return {
          ok: true,
          value: {
            columns: result.value.columns,
            rows: result.value.rows,
            truncated: result.value.truncated,
            canceled: result.value.canceled,
            terminalState: result.value.terminalState,
            jdbcInvokeCount,
            gate: { ok: true as const },
            explainOnly: false
          }
        };
      }
    });
  } else {
    steps.push({
      stage: "type_truncation",
      run: async () => ({
        ok: true,
        value: {
          columns: [],
          rows: [],
          truncated: false,
          canceled: false,
          terminalState: "completed" as const,
          jdbcInvokeCount: 0,
          gate: { ok: true as const },
          explainOnly: true
        }
      })
    });
  }

  const result: HivePipelineResult<HiveExecutionSuccess> = await runHivePipeline(steps);
  if (!result.ok) {
    return {
      ok: false,
      failure: {
        stage: result.failure.stage,
        reason: result.failure.reason,
        detail: result.failure.detail,
        jdbcInvokeCount,
        upstreamMayHaveExecuted: result.failure.upstreamMayHaveExecuted
      },
      executedStages: result.executedStages
    };
  }
  return {
    ok: true,
    value: { ...result.value, jdbcInvokeCount },
    executedStages: result.executedStages
  };
}

/** Wrap a worker so tests can observe invoke counts without changing the worker. */
export function countingJdbcWorker(inner: HiveJdbcWorker): {
  worker: HiveJdbcWorker;
  invokeCount: () => number;
} {
  let count = 0;
  return {
    invokeCount: () => count,
    worker: {
      kind: inner.kind,
      cancel: inner.cancel?.bind(inner),
      async execute(request) {
        count += 1;
        return inner.execute(request);
      }
    }
  };
}
