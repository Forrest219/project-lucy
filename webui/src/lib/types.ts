export type CompletionStatus = "not_started" | "partial" | "done" | "validation_failed";

export type AuthoredText = {
  db?: string;
  ai?: string;
  human?: string;
};

export type Column = {
  name: string;
  type: "string" | "number" | "time" | "boolean";
  pk?: boolean;
  nullable?: boolean;
  descriptions: AuthoredText;
};

export type Join = {
  to: string;
  on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  alias?: string;
  source?: "formal" | "manual" | "candidate";
};

export type Measure = {
  name: string;
  expr: string;
  filter?: string;
  description?: string;
};

export type Segment = {
  name: string;
  expr: string;
  description?: string;
};

export type TableModel = {
  conn: string;
  schema: string;
  table: string;
  qualifiedName?: string;
  filePath: string;
  qualifiedName?: string;
  descriptions: AuthoredText;
  grain?: string[];
  columns: Column[];
  measures?: Measure[];
  segments?: Segment[];
  joins?: Join[];
  unknownKeys?: string[];
};

export type SourceSummary = {
  conn: string;
  schema: string;
  table: string;
  /** Physical `schema.table` used to match `ktx.yaml` `enabled_tables`. */
  qualifiedName: string;
  filePath: string;
  columnCount: number;
  columnNames: string[];
  hasTableDesc: boolean;
  hasGrain: boolean;
  measureCount: number;
  joinCount: number;
  wikiRefCount: number;
  completion: CompletionStatus;
  mtime: string;
  /**
   * Whether this table appears in the connection's `enabled_tables`.
   * Semantic coverage / Catalog default scope use this flag (Spec 104).
   */
  enabled: boolean;
  /**
   * Number of enabled Agents whose effective permissions include this source.
   * See `webui/server/semantic-layer.ts` for the matching rule.
   */
  authorizedAgentCount: number;
  /**
   * Latest mtime between the Schema Manifest and the table's semantic overlay
   * YAML (when present). ISO 8601.
   */
  semanticUpdatedAt: string;
  semanticUpdatedAtSource: "manifest" | "overlay";
};

export type ManifestSchemaSummary = {
  conn: string;
  schema: string;
  filePath: string;
  tableCount: number;
  mtime: string;
};

export type ConnectionInfo = {
  id: string;
  driver?: string;
  engine?: string;
  wireProtocol?: "mysql" | "postgres" | "native" | "unknown";
  r1Target?: boolean;
  readOnlyExpected?: boolean;
  passwordSource?: "file" | "inline" | "env";
  host?: string;
  port?: string;
  database?: string;
  schemas: string[];
  enabledTables: string[];
};

// ─── MCP Public Endpoint Runtime (M18) ────────────────────────────────────────
//
// Mirrors the backend `McpEndpointInfo`. Frontend pages must read the
// endpoint from the `mcpEndpoint` field returned by `GET /api/project` and
// must not infer the endpoint from `window.location`, `Host`, or other
// browser-derived signals. The runtime state is set by the backend from
// `LUCY_PUBLIC_MCP_URL` (or the local development fallback).

export type McpEndpointStatus = "configured" | "fallback" | "invalid";

export type McpEndpointDiagnosticCode =
  | "MISSING_PUBLIC_MCP_URL"
  | "INVALID_PUBLIC_MCP_URL"
  | "UNSUPPORTED_PUBLIC_MCP_PROTOCOL"
  | "MCP_PATH_RECOMMENDED";

export type McpEndpointDiagnostic = {
  code: McpEndpointDiagnosticCode;
  message: string;
};

export type McpEndpointInfo = {
  url: string | null;
  status: McpEndpointStatus;
  source: "env" | "fallback";
  configured: boolean;
  diagnostics: McpEndpointDiagnostic[];
};

export type ProjectInfo = {
  root: string;
  connections: ConnectionInfo[];
  ktxAvailable: boolean;
  mcpEndpoint: McpEndpointInfo;
};

export type ConnectionsResponse = {
  connections: ConnectionInfo[];
};

export type ConnectionTablesResponse = {
  tables: string[];
};

export type IngestResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ConnectionTestResult = {
  status: "ok" | "error";
  latencyMs?: number;
  detail?: string;
  reason?: string;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type AddSchemaPreview = {
  diff: string;
  proposedYaml: string;
  oldSchemas: string[];
  newSchemas: string[];
};

export type AddSchemaResult = {
  written: true;
  auditId?: number;
  oldSchemas: string[];
  newSchemas: string[];
};

/** Spec 124: dryRun preview for POST /api/connections. */
export type CreateConnectionPreview = {
  diff: string;
  proposedYaml: string;
  secretRelPath: string;
  connection: ConnectionInfo;
};

/** Spec 124: committed create result. */
export type CreateConnectionResult = {
  written: true;
  auditId?: number;
  secretRelPath: string;
  connection: ConnectionInfo;
  test: {
    status: "ok" | "error";
    message?: string;
    durationMs?: number;
  };
};

export type RemoveSchemaImpact = {
  hasManifest: boolean;
  manifestPath: string | null;
  overlayPaths: string[];
  wikiRefCount: number;
  wikiSamplePaths: string[];
};

export type RemoveSchemaPreview = {
  diff: string;
  proposedYaml: string;
  oldSchemas: string[];
  newSchemas: string[];
  removedEnabledTables: string[];
  impact: RemoveSchemaImpact;
};

export type RemoveSchemaResult = {
  written: true;
  auditId?: number;
  oldSchemas: string[];
  newSchemas: string[];
  removedEnabledTables: string[];
  deletedFiles: string[];
};

/** Spec 107: one schema row from live DB catalog discovery. */
export type LiveSchemaSummary = {
  schema: string;
  tableCount: number;
};

/** Spec 107: GET /api/connections/:connId/live-schemas payload. */
export type LiveSchemasResponse = {
  status: "ok" | "error";
  connectionId: string;
  schemas: LiveSchemaSummary[];
  fetchedAt: string;
  cached: boolean;
  latencyMs?: number;
  reason?: string;
  wireProtocol?: "mysql" | "postgres" | "unknown";
};

export type SourcesResponse = {
  tables: SourceSummary[];
  manifestSchemas?: ManifestSchemaSummary[];
};

export type SourceDetail = {
  model: TableModel;
  rawYaml: string;
  completion: CompletionStatus;
};

export type TablePatch = {
  tableDescription?: string;
  grain?: string[];
  measures?: Measure[];
  segments?: Segment[];
  joins?: Join[];
  columns?: Array<{
    name: string;
    description?: string;
  }>;
};

export type SourcePreview = {
  diff: string;
  proposedYaml: string;
  files: Array<{
    filePath: string;
    diff: string;
    proposedYaml: string;
  }>;
};

export type ValidationResult = {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  issues?: Array<{ message: string }>;
};

export type ChangedFile = {
  filePath: string;
  status: string;
  diff: string;
};

export type SourceSaveResponse = {
  written: true;
  validation: ValidationResult;
  changedFiles: ChangedFile[];
  version?: TableYamlVersionSummary | null;
};

export type TableYamlVersionOperation = "save" | "import" | "restore";

export type TableYamlVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: TableYamlVersionOperation;
  contentHash: string;
  sourceFileName?: string;
  restoredFromVersionId?: string;
  affectedFiles: string[];
};

export type TableYamlVersionDetail = TableYamlVersionSummary & {
  rawYaml: string;
  diffFromCurrent: string;
};

export type TableYamlVersionListResponse = {
  key: string;
  retentionLimit: number;
  versions: TableYamlVersionSummary[];
};

export type TableYamlVersionRestoreResult = {
  key: string;
  restoredFromVersionId: string;
  rawYaml: string;
  diff: string;
};

export type ChangedFilesResponse = {
  files: ChangedFile[];
};

export type ValidateChangedResponse = {
  results: Array<{
    conn: string;
    schema: string;
    table: string;
    validation: ValidationResult;
  }>;
};

export type WikiFrontmatter = {
  summary?: string;
  tags?: string[];
  sl_refs?: string[];
  refs?: string[];
  usage_mode?: string;
};

export type WikiSummary = {
  key: string;
  summary?: string;
  tags: string[];
  slRefs: string[];
};

export type WikiDirectorySummary = {
  path: string;
  name: string;
  documentCount: number;
  explicit: boolean;
  empty: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WikiDirectoryCreateInput = {
  path?: string;
  parent?: string;
  name?: string;
};

export type WikiDirectoryCreateResult = {
  directory: WikiDirectorySummary;
  created: boolean;
  filePath: string;
};

export type WikiDirectoryDeleteResult = {
  path: string;
  deleted: boolean;
  filePath: string;
};

export type WikiDocumentDeleteResult = {
  key: string;
  deleted: boolean;
  filePath: string;
};

export type WikiDirectoryRenameInput = {
  sourcePath: string;
  newName: string;
};

export type WikiDirectoryRenamePreview = {
  sourcePath: string;
  targetPath: string;
  newName: string;
  documentCount: number;
  directoryCount: number;
  documents: Array<{ sourceKey: string; targetKey: string }>;
  directories: Array<{ sourcePath: string; targetPath: string }>;
  conflicts: string[];
  warnings: string[];
};

export type WikiDirectoryRenameResult = {
  sourcePath: string;
  targetPath: string;
  renamedDocuments: number;
  renamedDirectories: number;
  writtenFiles: string[];
};

export type WikiMoveInput = {
  targetDirectory: string;
  overwrite?: boolean;
};

export type WikiListResponse = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
};

export type WikiPage = {
  key: string;
  frontmatter: WikiFrontmatter;
  content: string;
  rawMarkdown: string;
};

export type WikiPreview = {
  key: string;
  filePath: string;
  diff: string;
  proposedMarkdown: string;
};

export type WikiUploadMode = "create" | "replace";

export type WikiUploadPreview = WikiPreview & {
  exists: boolean;
  mode: WikiUploadMode;
  /** Local filename the user picked in the browser (basename only). */
  sourceFileName: string;
  /** Wiki key after applying the user's chosen target directory. */
  targetKey: string;
  /** Title currently persisted for the target document, or `null` when creating. */
  existingTitle: string | null;
  /** Title that will be written after the upload commits. */
  targetTitle: string;
  /** Legacy alias for `targetTitle` kept for downstream compatibility. */
  title: string;
  slRefs: string[];
  warnings: string[];
};

export type WikiMovePreview = WikiPreview & {
  sourceKey: string;
  targetKey: string;
  targetDirectory: string;
  exists: boolean;
  title: string;
  /** `true` when the basename of the source and target keys differs. */
  basenameChanged: boolean;
  warnings: string[];
};

export type WikiMoveResult = {
  sourceKey: string;
  key: string;
  targetDirectory: string;
  previousKey: string;
  newVersionId: string;
  filePath: string;
};

export type WikiVersionOperation =
  | "create"
  | "edit_save"
  | "upload_create"
  | "upload_replace"
  | "restore"
  | "move"
  | "rename"
  | "delete";

export type WikiVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: WikiVersionOperation;
  title?: string;
  summary?: string;
  sourceFileName?: string;
  previousKey?: string;
  restoredFromVersionId?: string;
  contentHash: string;
};

export type WikiVersionDetail = WikiVersionSummary & {
  rawMarkdown: string;
  diffFromCurrent: string;
};

export type WikiVersionListResponse = {
  key: string;
  retentionLimit: number;
  versions: WikiVersionSummary[];
};

export type WikiVersionRestorePreview = {
  key: string;
  versionId: string;
  targetTitle: string;
  diff: string;
};

export type WikiVersionRestoreResult = {
  key: string;
  restoredFromVersionId: string;
  newVersionId: string;
  filePath: string;
};

export type HelpTocItem = {
  id: string;
  level: 2 | 3 | 4;
  title: string;
};

export type HelpHandbook = {
  id: "system-handbook";
  title: string;
  sourcePath: string;
  updatedAt: string;
  etag: string;
  toc: HelpTocItem[];
  markdown: string;
};

export type HelpSearchItem = {
  sectionId: string;
  title: string;
  snippet: string;
};

export type HelpSearchResult = {
  query: string;
  items: HelpSearchItem[];
};

export type JoinCandidate = {
  conn: string;
  schema: string;
  fromTable: string;
  join: Join;
  confidence: "candidate" | "rejected";
  note?: string;
};

export type JoinCandidatesResponse = {
  version: 1;
  candidates: JoinCandidate[];
};

export type Agent = {
  id: string;
  name: string;
  note?: string;
  enabled: boolean;
  role?: string;
  createdAt?: string;
  configUpdatedAt?: string;
  tokens: TokenSummary[];
  allow?: { tables: string[] | ["*"]; tools: string[] | ["*"]; connections?: string[] };
  effectivePermissions?: EffectivePermissionsPreview;
  permissionWarnings?: string[];
  stats?: AgentStats;
};

export type Role = {
  id: string;
  description?: string;
  source?: "yaml" | "template";
  tools: string[];
  connections: string[];
  /** Always present; resolved table/source names; [] when resolve failed or zero sources */
  sourceNames: string[];
  sourceCount: number;
  invalid: boolean;
  warnings: string[];
  usageCount?: number;
  users?: Array<{ id: string; name: string; enabled: boolean; tokenCount: number }>;
  /** ISO-8601 from access.yaml mtime; null for reference templates */
  configUpdatedAt?: string | null;
};

export type RoleUserReference = {
  id: string;
  name: string;
  enabled: boolean;
  tokenCount: number;
};

export type RoleSelector =
  | { connection?: string; schema: string; names: string[] }
  | { connection?: string; schema: string; prefix: string };

export type RoleAllowConfig = {
  connections?: string[];
  tableSelectors?: RoleSelector[];
  tools?: string[];
};

export type RoleDetail = Role & {
  version?: string;
  usageCount: number;
  users: RoleUserReference[];
  role: {
    description?: string;
    allow: RoleAllowConfig;
  };
  effectivePermissions?: EffectivePermissionsPreview;
};

export type EffectivePermissionsPreview = {
  roleIds: string[];
  snapshotHash: string;
  sourceMapVersion?: string;
  tools: string[];
  connections: string[];
  sources: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    table: string;
  }>;
  legacyAllow: boolean;
};

export type TokenSummary = {
  hash: string;
  label: string;
  created: string;
  expires_at?: string | null;
  device_name?: string | null;
  last_used?: string | null;
  last_tool?: string | null;
  last_outcome?: string | null;
  last_ip?: string | null;
  last_user_agent?: string | null;
  last_client?: string | null;
  last_client_version?: string | null;
  last_device_name_seen?: string | null;
  distinct_ips_7d?: number;
  revoked?: boolean;
  revoked_at?: string;
  revoke_reason?: string;
};

export type AgentStats = {
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;
  /**
   * Distinct tokens that have appeared in `access_log` for this user
   * inside the last 7 days. May be `undefined` for legacy backends
   * (pre-M55) that do not emit the metric; callers must fall back to
   * `token.last_used` based bookkeeping in that case.
   */
  activeTokensLast7d?: number;
  /**
   * Number of token rows still present in `access.yaml` for this agent
   * (regardless of expiry). Mirrors `Agent.tokens.length`.
   */
  configuredTokens?: number;
  topTables: Array<{ table: string; calls: number }>;
};

/**
 * Aggregate metrics returned by `GET /api/admin/agents` so the
 * AgentList header does not have to re-derive counts from per-row data.
 * Older backends may omit `summary`; the front-end must compute a
 * fallback from `agents[]` in that case.
 */
export type AgentsResponseSummary = {
  agentCount: number;
  enabledAgentCount: number;
  activeAgentCountLast7d?: number;
  configuredTokenCount: number;
  activeTokenCountLast7d: number;
  callsLast7d: number;
  deniedLast7d: number;
};

export type AgentPatch = {
  name?: string;
  note?: string;
  enabled?: boolean;
  role?: string;
};

export type CreateAgentBody = {
  id: string;
  name: string;
  note?: string;
  role: string;
};

export type CreateTokenBody = { label: string; device_name?: string | null; expires_at?: string | null };

export type CreateTokenResponse = {
  token: string;
  hash: string;
  label: string;
  device_name?: string | null;
  created: string;
  expires_at?: string | null;
};

export type AuditLogEntry = {
  id: number;
  ts: string;
  userId: string;
  tokenLabel?: string;
  tokenHashPrefix?: string;
  lucySessionId?: string;
  lucyTurnId?: string;
  lucyPlatform?: string;
  client?: string;
  clientVersion?: string;
  clientIp?: string;
  userAgent?: string;
  deviceName?: string;
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  queryHash?: string;
  queryLength?: number;
  queryOperation?: string;
  queryPreview?: string;
  queryArtifactRef?: string;
  generatedSql?: string;
  outcome: "ok" | "error" | "denied";
  errorDetail?: string;
  durationMs: number;
  responseBytes?: number;
  responseRowCount?: number;
  responseColumnCount?: number;
  responseTruncated?: boolean;
  requestId: string | number;
  traceId?: string;
  roleIds?: string[];
  permissionSnapshotHash?: string;
  effectiveTablesCount?: number;
  decisionReason?: string;
};

export type AuditQuery = {
  user?: string;
  tool?: string;
  outcome?: "ok" | "error" | "denied";
  since?: string;
  until?: string;
  tableSearch?: string;
  sessionId?: string;
  turnId?: string;
  platform?: string;
  clientIp?: string;
  deviceName?: string;
  includeProtocol?: boolean;
  limit?: number;
  offset?: number;
};

export type ConfigAuditEntry = {
  id: number;
  ts: string;
  actor: string;
  actorType: "ui_admin" | "batch_job" | "system";
  source?: string;
  sessionId?: string;
  filePath: string;
  assetKind: "governance" | "semantic" | "wiki" | "eval" | "publish";
  changeType: string;
  operation?: string;
  targetId?: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
  requestId?: string;
  writeStatus: "pending" | "committed" | "failed";
};

export type ConfigAuditResponse = {
  total: number;
  actorMode: "single_local_admin";
  actorNotice: string;
  entries: ConfigAuditEntry[];
};

export type AuditSourcesResponse = {
  connections: Array<{ connection: string; calls: number }>;
  schemas: Array<{ schema: string; calls: number }>;
  topTables: Array<{ table: string; calls: number; denied: number }>;
  deniedTables: Array<{ table: string; calls: number; denied: number }>;
};

export type AuditResponse = {
  total: number;
  entries: AuditLogEntry[];
  summary?: {
    protocolCalls: number;
    businessCalls: number;
    deniedCalls: number;
    dataBearingCalls: number;
  };
};

export type AuditTurnOutcomeSummary = {
  ok: number;
  denied: number;
  error: number;
};

export type AuditTurnEntry = {
  id: string;
  source: "inferred" | "reported";
  userId: string;
  startedAt: string;
  endedAt: string;
  businessCallCount: number;
  questionSummary?: string;
  questionPreview?: string;
  confidence: string;
  tools: string[];
  sources: Array<{ connectionId?: string; schema?: string; sourceName?: string; physicalTable: string }>;
  turnSpanMs?: number;
  totalCallDurationMs?: number;
  maxCallDurationMs?: number;
  slowCallCount?: number;
  outcomeSummary?: AuditTurnOutcomeSummary;
};

export type AuditTurnReferenceLatency = {
  windowHours: 24 | 168;
  p95Ms: number;
  totalCallsInWindow: number;
  slowCallsInFilter: number;
};

export type AuditTurnsResponse = {
  total: number;
  entries: AuditTurnEntry[];
  referenceLatency: AuditTurnReferenceLatency;
  summary: {
    reportedCount: number;
    inferredCount: number;
    reportedShare: number;
  };
};

export type AuditTurnCallLog = {
  id: number;
  ts: string;
  tool: string;
  outcome: string;
  decisionReason?: string;
  durationMs: number;
  isSlowCall: boolean;
  traceId?: string;
  tables?: string[];
  connectionId?: string;
};

export type AuditTurnDetailResponse = {
  id: string;
  source: "inferred" | "reported";
  userId: string;
  startedAt?: string;
  endedAt?: string;
  questionSummary?: string | null;
  questionPreview?: string | null;
  confidence?: string;
  accessLogs: AuditTurnCallLog[];
  sources?: unknown[];
  referenceLatency: { windowHours: 24 | 168; p95Ms: number };
};

export type McpToolInfo = { name: string; description?: string; globalDenied: boolean };

// ─── Eval types ──────────────────────────────────────────────────────────────

export type EvalDomainInfo = {
  domain: string;
  filePath: string;
  caseCount: number;
  metadata?: Record<string, unknown>;
  lastRun?: {
    runId: number;
    passRate: number;
    startedAt: string;
  };
};

export type SqlAssertion = {
  type: "measure_lineage" | "required_ast" | "forbidden_ast" | "required_sql_pattern";
  value: string;
  normalize?: boolean;
  reason: string;
};

export type ResultAssertion = {
  value_type: "scalar" | "dataframe" | "text" | "empty_result";
  compare_mode?: string;
  data?: unknown;
  numeric_tolerance?: number;
  check_schema?: boolean;
  check_row_count?: boolean;
  key_columns?: string[];
};

export type EvalCase = {
  id: string;
  case_type: string;
  question?: string;
  turns?: unknown[];
  domain: string;
  skill_version?: string;
  semantic_version?: string;
  model_id?: string;
  expected_source?: string;
  expected_measures?: string[];
  linked_quiz_questions?: string[];
  sql_assertions?: SqlAssertion[];
  result_assertions?: ResultAssertion[];
  context_assertions?: unknown;
  snapshot_date?: string;
  coverage?: string;
  notes?: string;
};

export type EvalRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type CaseSelection =
  | { mode: "all" }
  | { mode: "ids"; ids: string[] }
  | { mode: "coverage"; coverage: string }
  | { mode: "failed_in_last" };

export type EvalRun = {
  id: number;
  domain: string;
  status: EvalRunStatus;
  startedAt: string;
  finishedAt?: string;
  triggeredBy: string;
  trigger: string;
  triggerReason?: string;
  ktxMcpUrl: string;
  caseSelection: CaseSelection;
  totalCases: number;
  passCount: number;
  failCount: number;
  passRate?: number;
  suiteId?: string;
  suiteHash?: string;
  runnerMetadata?: unknown;
  importSource?: string;
  hashStatus?: EvalResultHashStatus;
};

export type EvalRunWithResults = EvalRun & {
  results: Array<{
    caseId: string;
    status: "PASS" | "FAIL" | "SKIPPED" | "ERROR";
    drift?: string;
    exitCode?: number;
    durationMs?: number;
    sql?: string;
    resultRaw?: unknown;
    expected?: unknown;
    actual?: unknown;
    failedAssertions?: string[];
    errorMessage?: string;
    finalText?: string;
  }>;
};

export type EvalRunResult = {
  runId: number;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
  cases: Array<{
    id: string;
    passed: boolean;
    failedAssertions?: string[];
    errorMessage?: string;
    durationMs?: number;
  }>;
};

export type EvalRunCompare = {
  left: { runId: number };
  right: { runId: number };
  byCase: Array<{
    caseId: string;
    left?: "PASS" | "FAIL";
    right?: "PASS" | "FAIL";
    delta: "regressed" | "fixed" | "unchanged" | "added" | "removed";
  }>;
  summary: {
    regressed: number;
    fixed: number;
    unchanged: number;
  };
};

// ─── Eval Suite canonical (M43) ───────────────────────────────────────────────
// Lucy-recognized canonical Eval YAML protocol. See
// `webui/docs/46-eval-yaml-exchange-and-result-archive-spec.md` §5.

export const EVAL_SUITE_SCHEMA_VERSION = 1 as const;
export const EVAL_SUITE_KIND = "lucy_eval_suite" as const;
export const EVAL_RESULT_VERSION = 1 as const;

export type EvalSuiteSnapshot = {
  mode: "live_readonly" | "snapshot";
  /** YYYY-MM-DD */
  snapshot_date: string;
};

export type EvalRunnerHints = {
  default_mcp_endpoint?: string;
  supported_runners: string[];
};

export type ToolAssertion = {
  type: "required_tool" | "forbidden_tool" | "required_tool_input_regex" | "forbidden_tool_input_regex";
  /** Tool name or regex against tool input. Use `|` to separate multiple tools. */
  value: string;
  reason: string;
};

export type ContextAssertion = {
  inherit_measures?: string[];
  inherit_filters?: string[];
  inherit_dimensions?: string[];
  inherit_time_grain?: string;
  sql_assertions?: SqlAssertion[];
  tool_assertions?: ToolAssertion[];
};

export type EvalSuiteCaseTurn = {
  user: string;
  expected_measures?: string[];
  result_assertions?: ResultAssertion[];
  context_assertions?: ContextAssertion;
};

export type EvalSuiteCase = {
  id: string;
  case_type: "single_turn" | "multi_turn";
  question?: string;
  turns?: EvalSuiteCaseTurn[];
  expected_source: "semantic_layer" | "raw_sql_fallback" | "manual_debug_only";
  expected_measures?: string[];
  model_id?: string;
  skill_version?: string;
  semantic_version?: string;
  sql_assertions?: SqlAssertion[];
  tool_assertions?: ToolAssertion[];
  result_assertions?: ResultAssertion[];
  context_assertions?: ContextAssertion;
  snapshot_date?: string;
  linked_quiz_questions?: string[];
  coverage?: string;
  notes?: string;
};

export type EvalSuite = {
  lucy_eval_schema_version: 1;
  kind: "lucy_eval_suite";
  /** Globally stable ID, matches `[a-z0-9][a-z0-9_-]*`. */
  suite_id: string;
  domain: string;
  title: string;
  snapshot?: EvalSuiteSnapshot;
  runner_hints?: EvalRunnerHints;
  cases: EvalSuiteCase[];
  /** Computed (sha256 over canonical JSON). Empty before first hash. */
  suite_hash?: string;
};

// ─── Eval Result JSON (M43) ──────────────────────────────────────────────────
// Optional archive of locally-run evaluation results. See spec §6.

export type EvalResultStatus = "PASS" | "FAIL" | "SKIPPED" | "ERROR";

export type EvalResultCase = {
  case_id: string;
  status: EvalResultStatus;
  duration_ms?: number;
  sql?: string;
  actual?: Record<string, unknown>;
  expected?: Record<string, unknown>;
  failures?: string[];
  final_text?: string;
  error_message?: string;
};

export type EvalResultRunner = {
  kind: string;
  version?: string;
  model?: string;
  host?: string;
};

export type EvalResultImport = {
  lucy_eval_result_version: 1;
  suite_id: string;
  /** sha256:hex */
  suite_hash: string;
  domain: string;
  runner: EvalResultRunner;
  /** ISO 8601 */
  started_at: string;
  /** ISO 8601 */
  finished_at: string;
  results: EvalResultCase[];
};

export type EvalResultHashStatus = "matched" | "mismatch" | "suite_missing";

export type EvalSuiteImportDiff = {
  suiteId?: string;
  suiteHash?: string;
  added: Array<{ id: string }>;
  modified: Array<{ id: string; reason?: string }>;
  removed: Array<{ id: string }>;
  conflicts: Array<{ id?: string; code: string; path: string; message: string }>;
};

export type EvalResultImportPreview = {
  runId?: number;
  domain?: string;
  totalCases?: number;
  passCount?: number;
  failCount?: number;
  skippedCount?: number;
  errorCount?: number;
  suiteHashMatched?: boolean;
  hashStatus?: EvalResultHashStatus;
  unknownCaseIds: string[];
  unknownSuiteId?: boolean;
  warnings: string[];
};

export type EvalDriftDistribution = {
  items: Array<{
    drift: string;
    count: number;
  }>;
};

export type EvalTrendPoint = {
  date: string;
  passRate: number;
  runs?: number;
  lowestPassRate?: number;
  totalRuns: number;
};

export type EvalThreshold = {
  domain: string;
  minPassRate: number;
};

export type MonitorConfig = {
  domains: Record<string, {
    passRateYellow: number;
    passRateRed: number;
    consecutiveFailThreshold: number;
  }>;
};

// ─── Catalog Reload (M14) ──────────────────────────────────────────────────────
// Static YAML-only catalog reload. No CLI subprocesses; no LLM dependency.
// The deprecated `/api/connections/:connId/ingest` alias route still
// exists for compatibility, but UI pages must use CatalogReloadRun instead of
// the M13 IngestRun shape.

export type CatalogReloadStatus = "success" | "failed";

export type CatalogReloadWarning = {
  code:
    | "SCHEMA_MANIFEST_MISSING"
    | "SCHEMA_MANIFEST_EMPTY"
    | "ENABLED_TABLE_NOT_SCANNED"
    | "MANIFEST_PARSE_FAILED";
  connectionId: string;
  schema?: string;
  table?: string;
  filePath?: string;
  message: string;
};

export type CatalogReloadRun = {
  id: string;
  status: CatalogReloadStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  requestedConnectionId?: string;
  requestedSchema?: string;
  connections: number;
  connectionIds: string[];
  configuredSchemas: number;
  manifestSchemas: number;
  tables: number;
  enabledTables: number;
  warnings: CatalogReloadWarning[];
  source: "static-yaml";
  deprecatedIngestAlias?: boolean;
};

export type CatalogReloadsResponse = {
  runs: CatalogReloadRun[];
  last: CatalogReloadRun | null;
  lastByConnection: Record<string, CatalogReloadRun>;
};

// ─── M17 Catalog Asset Upload (controlled YAML manifest) ───────────────────
// Self-service schema manifest upload that the analyst can run from the WebUI
// instead of handing the file to ops. The backend pins the target path to
// `semantic-layer/<connection>/_schema/<schema>.yaml`; the client never picks
// the file location. Records are stored in a bounded sidecar; YAML content
// itself is never written into the sidecar.

export type CatalogAssetKind = "schema_manifest";
export type LegacyCatalogAssetType = "schemaManifest";
export type CatalogAssetType = LegacyCatalogAssetType;

export type CatalogAssetWarningCode =
  | "EMPTY_MANIFEST"
  | "TARGET_EXISTS"
  | "TABLE_SCHEMA_MISMATCH"
  | "UNKNOWN_MANIFEST_SHAPE";

export type CatalogAssetWarning = {
  code: CatalogAssetWarningCode;
  message: string;
  table?: string;
};

export type CatalogAssetErrorCode =
  | "UNKNOWN_CONNECTION"
  | "SCHEMA_NOT_CONFIGURED"
  | "ASSET_KIND_REQUIRED"
  | "ASSET_KIND_UNSUPPORTED"
  | "ASSET_KIND_ROUTE_MISMATCH"
  | "INVALID_ASSET_TYPE"
  | "INVALID_FILENAME"
  | "FILE_TOO_LARGE"
  | "YAML_PARSE_FAILED"
  | "INVALID_MANIFEST"
  | "SCHEMA_MANIFEST_EXPECTED"
  | "SEMANTIC_OVERLAY_EXPECTED"
  | "OVERLAY_FIELD_IN_MANIFEST"
  | "MANIFEST_SHAPE_IN_OVERLAY"
  | "PATH_NOT_ALLOWED"
  | "ASSET_NOT_FOUND";

export type CatalogAssetError = {
  code: CatalogAssetErrorCode;
  message: string;
};

export type CatalogAssetValidateRequest = {
  connectionId: string;
  schema: string;
  assetKind?: CatalogAssetKind;
  assetType?: LegacyCatalogAssetType;
  filename: string;
  content: string;
};

export type CatalogAssetValidateResponse = {
  valid: boolean;
  connectionId: string;
  schema: string;
  assetKind: CatalogAssetKind;
  assetType: CatalogAssetType;
  targetPath: string;
  exists: boolean;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  tableNames: string[];
  warnings: CatalogAssetWarning[];
  errors: CatalogAssetError[];
};

export type CatalogAssetUploadRequest = CatalogAssetValidateRequest & {
  confirmOverwrite?: boolean;
};

export type CatalogAssetUploadRecord = {
  id: string;
  createdAt: string;
  connectionId: string;
  schema: string;
  assetKind: CatalogAssetKind;
  assetType: CatalogAssetType;
  targetPath: string;
  originalFilename: string;
  sizeBytes: number;
  sha256: string;
  tables: number;
  overwritten: boolean;
  warnings: CatalogAssetWarning[];
  reloadRunId?: string;
};

export type CatalogAssetUploadResponse = {
  uploaded: true;
  record: CatalogAssetUploadRecord;
  validation: CatalogAssetValidateResponse;
  reload: CatalogReloadRun;
};

export type CatalogAssetUploadsResponse = {
  records: CatalogAssetUploadRecord[];
  lastBySchema: Record<string, CatalogAssetUploadRecord>;
};

export type CatalogSchemaManifestReadResponse = {
  connectionId: string;
  schema: string;
  assetKind: CatalogAssetKind;
  assetType: CatalogAssetType;
  targetPath: string;
  filename: string;
  content: string;
  sizeBytes: number;
  sha256: string;
};

// ─── M19 Semantic Asset Self-Service Publish And Export ────────────────────
// Analyst-driven upload of multi-file semantic asset packages: schema
// manifests (`semantic-layer/<conn>/_schema/<schema>.yaml`) and semantic
// source overlays (`semantic-layer/<conn>/<source>.yaml`). The backend
// computes every target path, refuses paths from the client, and the
// publish pipeline never shells out before a staging-validate gate passes.

export type SemanticAssetKind = "schemaManifest" | "semanticSource" | "wiki" | "eval";

export type SemanticAssetWarningCode =
  | "TARGET_EXISTS"
  | "EMPTY_MANIFEST"
  | "TABLE_SCHEMA_MISMATCH"
  | "UNKNOWN_MANIFEST_SHAPE"
  | "PUBLISH_LOCKED"
  | "STRIPPED_MANIFEST_COLUMN_KEYS";

export type SemanticAssetErrorCode =
  | "UNKNOWN_CONNECTION"
  | "SCHEMA_NOT_CONFIGURED"
  | "DUPLICATE_FILENAME"
  | "INVALID_FILENAME"
  | "FILE_TOO_LARGE"
  | "PACKAGE_PARSE_FAILED"
  | "YAML_PARSE_FAILED"
  | "INVALID_MANIFEST"
  | "UNSAFE_SOURCE_NAME"
  | "OVERLAY_MISSING_TABLE"
  | "UNKNOWN_SHAPE"
  | "PATH_NOT_ALLOWED"
  | "VALIDATION_SNAPSHOT_NOT_FOUND"
  | "VALIDATION_GATE_FAILED"
  | "PUBLISH_IN_PROGRESS";

export type SemanticAssetWarning = {
  code: SemanticAssetWarningCode;
  message: string;
  filePath?: string;
};

export type SemanticAssetError = {
  code: SemanticAssetErrorCode;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
};

export type SemanticAssetFilePreview = {
  originalFilename: string;
  kind: SemanticAssetKind;
  targetPath: string;
  exists: boolean;
  sizeBytes: number;
  sha256: string;
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable?: string;
  warnings: SemanticAssetWarning[];
};

export type SemanticAssetChangedSource = {
  connectionId: string;
  sourceName: string;
};

export type SemanticAssetValidateRequest = {
  files: Array<{ filename: string; content: string }>;
  packages?: Array<{ filename: string; contentBase64: string }>;
  defaultConnectionId?: string;
  defaultSchema?: string;
};

export type SemanticAssetValidateResponse = {
  valid: boolean;
  validationId: string;
  files: SemanticAssetFilePreview[];
  changedSources: SemanticAssetChangedSource[];
  diff: string;
  warnings: SemanticAssetWarning[];
  errors: SemanticAssetError[];
};

export type SemanticAssetReleaseStatus =
  | "blocked"
  | "promote_failed"
  | "reindexing"
  | "published"
  | "reindex_failed";

export type SemanticAssetReleaseFile = {
  targetPath: string;
  kind: SemanticAssetKind;
  sha256: string;
  overwritten: boolean;
};

export type SemanticAssetValidationRow = {
  connectionId: string;
  sourceName: string;
  ok: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  issues: Array<{ message: string; filePath?: string; line?: number; column?: number }>;
};

export type SemanticAssetReindexRecord = {
  ok: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
};

export type SemanticAssetReleaseTrigger = "webui_publish" | "webui_manual_reindex";

export type SemanticAssetReleaseRecord = {
  id: string;
  createdAt: string;
  actor: string;
  status: SemanticAssetReleaseStatus;
  trigger?: SemanticAssetReleaseTrigger;
  connectionIds: string[];
  files: SemanticAssetReleaseFile[];
  changedSources: SemanticAssetChangedSource[];
  diff?: string;
  validation: {
    ok: boolean;
    results: SemanticAssetValidationRow[];
  };
  reindex?: SemanticAssetReindexRecord;
};

export type SemanticAssetReleasesResponse = {
  records: SemanticAssetReleaseRecord[];
  /** Total matching records before limit/offset (Spec 113). */
  total: number;
};

export type SemanticAssetReleaseStatusResponse = {
  release: SemanticAssetReleaseRecord;
};

export type SemanticAssetPublishRequest = {
  validationId: string;
  confirmOverwrite?: boolean;
};

export type SemanticAssetPublishResponse = {
  accepted: boolean;
  release: SemanticAssetReleaseRecord;
};

export type SemanticAssetManualReindexResponse = {
  id?: string;
  force: boolean;
  startedAt: string;
  finishedAt: string;
  reindex: SemanticAssetReindexRecord;
};

export type SemanticAssetExportRequest = {
  scope?: { connectionId?: string; schema?: string };
  includeWiki?: boolean;
  includeEvals?: boolean;
  includeSkills?: boolean;
  includeSanitizedKtxYaml?: boolean;
};

export type SemanticAssetExcludedFile = {
  path: string;
  reason: string;
};

export type SemanticAssetExportResponse = {
  exportId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  includedFiles: string[];
  excludedFiles: SemanticAssetExcludedFile[];
};
