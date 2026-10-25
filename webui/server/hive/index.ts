/**
 * Hive compile-side public API.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H1–H7)
 *
 * This barrel is the only entry point other waves should import. It keeps
 * the module boundary explicit: the compile side ends at the compiled SQL
 * and the checks around it. The HS2/JDBC side is NOT part of this surface —
 * the database support status stays `planned` until the real HS2 evidence
 * exists (Spec §8).
 */

export {
  HIVE_CONNECTIONS_REL_PATH,
  HIVE_CONFIG_DISPLAY_SCOPES,
  HiveConfigError,
  mergeUnifiedConnections,
  parseHiveConnectionsYaml,
  readHiveConnections,
  serializeHiveConnections,
  writeHiveConnections,
  type HiveAuth,
  type HiveAuthKind,
  type HiveConfigFailureReason,
  type HiveConfigResult,
  type HiveConnection,
  type HiveConnectionsSnapshot,
  type HiveTlsConfig,
  type HiveTransport,
  type UnifiedConnection,
  type UnifiedConnectionMerge,
  type UnifiedConnectionOrigin
} from "./config.js";

export {
  buildHiveSourceClosure,
  expressionColumnRefs,
  hiveSourceName,
  mapHiveColumnType,
  readHivePublishedGeneration,
  sqlSourcePhysicalTables,
  toCompilerSources,
  type HivePublishedGeneration,
  type HiveResolvedColumn,
  type HiveResolvedJoin,
  type HiveResolvedMeasure,
  type HiveResolvedSegment,
  type HiveResolvedSource,
  type HiveSourceClosure,
  type HiveSourceClosureFailureReason,
  type HiveSourceClosureResult
} from "./source-closure.js";

export {
  DAEMON_INPUT_REJECTED_EXIT_CODE,
  DEFAULT_COMPILE_DEADLINE_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  HIVE_COMPILE_DIALECT,
  buildCompileEnv,
  compileHiveQuery,
  defaultHiveSpawner,
  redactCompileDiagnostic,
  resolveHiveDaemonCommand,
  validateCompileEnvelope,
  type HiveCompileChild,
  type HiveCompileFaultReason,
  type HiveCompileOptions,
  type HiveCompileRejectionReason,
  type HiveCompileResult,
  type HiveDaemonCommand,
  type HiveDaemonResolution,
  type HiveServerQueryPolicy,
  type HiveSpawner
} from "./compile-bridge.js";

export {
  checkHiveSql,
  collectHiveColumnRefs,
  hiveExprEqual,
  parseHiveSql,
  splitHiveConjuncts,
  tokenizeHiveSql,
  unwrapHiveExpr,
  type HiveAstCheckInput,
  type HiveAstCheckReason,
  type HiveAstCheckResult,
  type HiveExpr,
  type HiveJoin,
  type HiveJoinType,
  type HiveQuery,
  type HiveRequiredPredicate,
  type HiveSelectItem,
  type HiveStatement,
  type HiveTableRef,
  type HiveToken,
  type HiveTokenKind
} from "./ast-check.js";

export {
  bindHiveQuerySources,
  buildHiveCompilerQuery,
  buildHiveForcedFilters,
  hiveScopeContradiction,
  normalizeHiveQueryArgs,
  stripClientPolicyOverrides,
  type HiveBindingResult,
  type HiveCompilerQuery,
  type HiveForcedFilterResult,
  type HiveForcedFilters,
  type HiveNormalizationResult,
  type HiveQueryAssemblyResult,
  type HiveQueryRequest,
  type HiveSourceBinding
} from "./row-policy.js";

export {
  HIVE_PIPELINE_STAGES,
  HIVE_UNIMPLEMENTED_STAGES,
  hiveNotImplementedFailure,
  isHiveStageImplemented,
  runHivePipeline,
  upstreamMayHaveExecuted,
  type HivePipelineClassification,
  type HivePipelineFailure,
  type HivePipelineResult,
  type HivePipelineStage,
  type HivePipelineStep
} from "./pipeline.js";
