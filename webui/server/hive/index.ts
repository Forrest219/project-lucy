/**
 * Hive module public API (compile side + execution-wave bridge).
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md (compile)
 *   - docs/specs/lucy-20261030-hive-query-execution-spec.md (partition / JDBC / MCP)
 *
 * This barrel is the only entry point other waves should import. JDBC workers
 * and the MCP divert hook live here; real HS2 evidence for support-matrix
 * promotion remains out of scope (`planned` until separately authorized).
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

export {
  buildHivePartitionProfile,
  partitionedProfile,
  unknownPartitionProfile,
  unpartitionedProfile,
  type HivePartitionKey,
  type HivePartitionProfile,
  type HivePartitionProfileFailureReason,
  type HivePartitionProfileResult,
  type HivePartitionStatus
} from "./partition-profile.js";

export {
  checkHivePartitionGate,
  conjunctBoundsPartitionKey,
  evaluatePartitionPrefix,
  type HivePartitionGateInput,
  type HivePartitionGateReason,
  type HivePartitionGateResult
} from "./partition-gate.js";

export {
  createSyntheticHiveJdbcWorker,
  unconfiguredHiveJdbcWorker,
  type HiveJdbcColumn,
  type HiveJdbcExecuteFailure,
  type HiveJdbcExecuteRequest,
  type HiveJdbcExecuteResult,
  type HiveJdbcExecuteSuccess,
  type HiveJdbcRow,
  type HiveJdbcWorker,
  type SyntheticHiveTable
} from "./jdbc-worker.js";

export {
  countingJdbcWorker,
  runHiveExecution,
  type HiveExecutionFailure,
  type HiveExecutionInput,
  type HiveExecutionResult,
  type HiveExecutionSuccess,
  type HiveExecutionTool
} from "./execution.js";

export {
  createModuleHiveFixture,
  handleHiveMcpTool,
  hiveDiscoveryFromProfiles,
  lookupHiveConnection,
  resolveHiveMcpRoute,
  type HiveConnectionLookup,
  type HiveDiscoverySource,
  type HiveMcpBridgeRequest,
  type HiveMcpBridgeResponse
} from "./mcp-bridge.js";

export {
  firstConnectionIdFromArgs,
  getHiveProxyExecutionContext,
  registerHiveProxyExecutionContext,
  resolveAndMaybeServeHiveTool,
  type HiveProxyExecutionContext,
  type HiveProxyRouteDecision
} from "./proxy-hook.js";
