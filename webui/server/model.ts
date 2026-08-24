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
  role?: "time" | "dimension" | "measure_source";
  visibility?: "public" | "internal" | "hidden";
  descriptions: AuthoredText;
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

export type Join = {
  to: string;
  on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  alias?: string;
  source?: "formal" | "manual" | "candidate";
};

export type TableModel = {
  conn: string;
  schema: string;
  table: string;
  qualifiedName?: string;
  filePath: string;
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
   * Number of enabled Agents whose effective permissions include this source
   * (matches by `connectionId === conn && schema === schema && sourceName === table`).
   * Disabled Agents are not counted. Returns 0 when access config cannot be read.
   */
  authorizedAgentCount: number;
  /**
   * Latest mtime between the Schema Manifest and the table's semantic overlay
   * YAML (when present). Format: ISO 8601.
   */
  semanticUpdatedAt: string;
  /** Source of `semanticUpdatedAt`: `manifest` if the overlay is absent or older. */
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
// `McpEndpointInfo` is the single fact-source that the WebUI uses to render
// and copy MCP config fragments. The backend reads `LUCY_PUBLIC_MCP_URL` from
// the runtime environment; when the variable is missing it returns a local
// development fallback, and when the value is malformed it returns a null URL
// with a diagnostic. Frontend pages must never infer the endpoint from
// `window.location`, `Host`, or other browser-derived signals.

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

/** Spec 124 Phase A: dryRun preview for POST /api/connections. */
export type CreateConnectionPreview = {
  diff: string;
  proposedYaml: string;
  secretRelPath: string;
  connection: ConnectionInfo;
};

/** Spec 124 Phase A: committed create result. */
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

export type ConnectionTestDetail = {
  status: "ok" | "error";
  latencyMs?: number;
  detail?: string;
  reason?: string;
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
