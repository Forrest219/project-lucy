export type CompletionStatus = "not_started" | "partial" | "done" | "validation_failed";

export type AuthoredText = {
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
};

export type ConnectionInfo = {
  id: string;
  driver?: string;
  engine?: string;
  wireProtocol?: "mysql" | "postgres" | "native" | "unknown";
  r1Target?: boolean;
  readOnlyExpected?: boolean;
  passwordSource?: "file" | "inline" | "env";
  schemas: string[];
  enabledTables: string[];
};

export type ProjectInfo = {
  root: string;
  connections: ConnectionInfo[];
  ktxAvailable: boolean;
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
  stdout?: string;
  stderr?: string;
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

export type SourcesResponse = {
  tables: SourceSummary[];
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

export type WikiListResponse = {
  pages: WikiSummary[];
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
  sourceCount: number;
  invalid: boolean;
  warnings: string[];
  usageCount?: number;
  users?: Array<{ id: string; name: string; enabled: boolean; tokenCount: number }>;
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
  last_used?: string | null;
  last_tool?: string | null;
  last_outcome?: string | null;
  revoked?: boolean;
  revoked_at?: string;
  revoke_reason?: string;
};

export type AgentStats = {
  callsLast7d: number;
  deniedLast7d: number;
  lastSeen?: string;
  topTables: Array<{ table: string; calls: number }>;
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

export type CreateTokenBody = { label: string; expires_at?: string | null };

export type CreateTokenResponse = {
  token: string;
  hash: string;
  label: string;
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
  tool: string;
  tables?: string[];
  argsSummary?: Record<string, unknown>;
  queryHash?: string;
  queryLength?: number;
  queryOperation?: string;
  queryPreview?: string;
  outcome: "ok" | "error" | "denied";
  errorDetail?: string;
  durationMs: number;
  responseBytes?: number;
  responseRowCount?: number;
  responseColumnCount?: number;
  responseTruncated?: boolean;
  requestId: string | number;
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
  includeProtocol?: boolean;
  limit?: number;
  offset?: number;
};

export type ConfigAuditEntry = {
  id: number;
  ts: string;
  actor: string;
  sessionId?: string;
  filePath: string;
  changeType: string;
  targetId?: string;
  oldSummary?: unknown;
  newSummary?: unknown;
  diff?: string;
  requestId?: string;
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
};

export type EvalRunWithResults = EvalRun & {
  results: Array<{
    caseId: string;
    status: "PASS" | "FAIL";
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

// ─── Ingest runs (M13) ────────────────────────────────────────────────────────

export type IngestScope = "connection" | "schema";

export type IngestRunStatus = "running" | "success" | "failed";

export type IngestRun = {
  id: string;
  connectionId: string;
  schema?: string;
  requestedScope: IngestScope;
  executedScope: IngestScope;
  schemaScopedSupported: boolean;
  status: IngestRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  command: string[];
  scannedTableCount?: number;
  scannedSchemas?: string[];
  hint?: string;
};

export type IngestRunsResponse = {
  runs: IngestRun[];
  lastByConnection: Record<string, IngestRun>;
};
