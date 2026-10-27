/**
 * Spec 189 — the single usage classification fact source.
 *
 * Every default-usage surface (Agent API, Governance API, call monitor,
 * audit default view, eval field panel, access map, governance evidence) must
 * classify `access_log` rows through THIS module. There is no second
 * protocol list, no second eval-probe rule and no per-page `NOT IN`.
 *
 * Three record layers (Spec 189 §4.1):
 *   - Raw Audit Record  → every row, nothing is deleted
 *   - Raw Business Tool Call → non-protocol rows (incl. eval probes)
 *   - Default Usage Call → Raw Business minus default-view-excluded probes
 *
 * The protocol set and the admission set are **different domains**
 * (Spec 189 §4.2): admission lists the JSON-RPC methods the gateway lets
 * through; protocol lists the methods that carry no business meaning. They
 * must never be asserted equal — `tools/call`, `resources/read` and
 * `prompts/get` are admitted *and* business.
 */

/** Methods that establish a session (Spec 189 §4.2). */
export const MCP_HANDSHAKE_METHODS = [
  "initialize",
  "notifications/initialized",
  "tools/list"
] as const;

/**
 * Methods that discover or probe — not a handshake, and not business usage.
 * `prompts/list` belongs here: listing prompts is pure discovery.
 *
 * `server/*` methods are NOT in this set: they carry their own transport
 * sub-type (`unknown_method`) and are covered by the prefix rule instead.
 */
export const MCP_PROBE_METHODS = [
  "ping",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "notifications/cancelled"
] as const;

/** Named service protocol methods (the `server/*` prefix rule covers the rest). */
export const MCP_SERVER_METHODS = ["server/discover"] as const;

/**
 * The full protocol event set: handshake + probe + named server methods. Any
 * `server/`-prefixed method is a protocol event too (Spec 189 §4.2).
 */
export const MCP_PROTOCOL_METHODS = [
  ...MCP_HANDSHAKE_METHODS,
  ...MCP_PROBE_METHODS,
  ...MCP_SERVER_METHODS
] as const;

export const MCP_HANDSHAKE_METHOD_SET: ReadonlySet<string> = new Set(MCP_HANDSHAKE_METHODS);
export const MCP_PROBE_METHOD_SET: ReadonlySet<string> = new Set(MCP_PROBE_METHODS);
export const MCP_SERVER_METHOD_SET: ReadonlySet<string> = new Set(MCP_SERVER_METHODS);
export const MCP_PROTOCOL_METHOD_SET: ReadonlySet<string> = new Set(MCP_PROTOCOL_METHODS);

/** Any method whose name starts with `server/` is a service protocol method. */
export const MCP_SERVER_METHOD_PREFIX = "server/";

/** Spec 162 §7.6 — probe name markers (lower-case; matched case-insensitively). */
export const PROBE_NAME_MARKERS = ["probe-", "rds-test", "demo-mysql"] as const;

/** Argument keys that may carry a probe-ish connection / table name. */
const PROBE_NAME_KEY_PATTERN = /connection|source|table|database|schema/i;

export function isMcpHandshakeMethod(tool: string | null | undefined): boolean {
  return typeof tool === "string" && MCP_HANDSHAKE_METHOD_SET.has(tool);
}

export function isMcpProbeMethod(tool: string | null | undefined): boolean {
  return typeof tool === "string" && MCP_PROBE_METHOD_SET.has(tool);
}

/**
 * True for every protocol event: the named set plus any `server/*` method.
 * The `server/` check mirrors TypeScript `startsWith` semantics exactly
 * (case-sensitive, not SQLite's case-insensitive `LIKE`).
 */
export function isMcpProtocolMethod(tool: string | null | undefined): boolean {
  if (typeof tool !== "string" || tool.length === 0) return false;
  if (MCP_PROTOCOL_METHOD_SET.has(tool)) return true;
  return tool.startsWith(MCP_SERVER_METHOD_PREFIX);
}

/** Lower-case "contains" semantics shared by the TS and SQLite paths. */
export function hasProbeName(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const lowered = value.toLowerCase();
  return PROBE_NAME_MARKERS.some((marker) => lowered.includes(marker));
}

/**
 * Spec 162 §7.6 — a probe call leaves the default usage view only when BOTH
 * hold: the args or connection name looks like a probe, AND the Token carries
 * an explicit `eval_mark`. Name-only matches stay in the default view.
 *
 * `eval_mark` is never inferred from User-Agent, `token_label` or
 * `actor_kind` (Spec 189 §4.3).
 */
export function isEvalProbeCall(input: {
  evalMark?: boolean | null;
  connectionName?: string | null;
  args?: Record<string, unknown> | null;
}): boolean {
  if (!input.evalMark) return false;
  if (hasProbeName(input.connectionName)) return true;
  const args = input.args;
  if (!args || typeof args !== "object") return false;
  for (const [key, value] of Object.entries(args)) {
    if (!PROBE_NAME_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" && hasProbeName(value)) return true;
  }
  return false;
}

/** The exclusive usage class of one record (Spec 189 §4). */
export type UsageClass = "protocol" | "eval_probe" | "default_usage";

/**
 * Classify one row.
 *
 * Order matters (Spec 189 §7): protocol first, then the eval-probe split.
 * The tool name is authoritative so historical rows with an empty or stale
 * `event_type` are still classified correctly.
 */
export function classifyUsage(row: {
  tool?: string | null;
  evalMark?: boolean | null;
  connectionName?: string | null;
  args?: Record<string, unknown> | null;
}): UsageClass {
  if (isMcpProtocolMethod(row.tool)) return "protocol";
  if (isEvalProbeCall(row)) return "eval_probe";
  return "default_usage";
}

/**
 * Spec 189 §4.1 / §4.3 — does this row leave the default usage view?
 * Protocol rows and default-view-excluded eval probes both do; every other
 * row is a Default Usage Call.
 */
export function defaultUsageExcluded(row: {
  tool?: string | null;
  evalMark?: boolean | null;
  connectionName?: string | null;
  args?: Record<string, unknown> | null;
}): boolean {
  return classifyUsage(row) !== "default_usage";
}

/**
 * Raw Business Tool Call — every non-protocol row, eval probes included.
 */
export function isRawBusinessCall(row: {
  tool?: string | null;
  evalMark?: boolean | null;
  connectionName?: string | null;
  args?: Record<string, unknown> | null;
}): boolean {
  return !isMcpProtocolMethod(row.tool);
}

// ---------------------------------------------------------------------------
// SQL condition generation
// ---------------------------------------------------------------------------

/** Safe SQL literal list: every value is a source-controlled constant. */
export function protocolMethodSqlList(): string {
  return MCP_PROTOCOL_METHODS.map((method) => `'${method.replaceAll("'", "''")}'`).join(", ");
}

/** Safe SQL literal list for the handshake subset. */
export function handshakeMethodSqlList(): string {
  return MCP_HANDSHAKE_METHODS.map((method) => `'${method.replaceAll("'", "''")}'`).join(", ");
}

/** Safe SQL literal list for the probe subset. */
export function probeMethodSqlList(): string {
  return MCP_PROBE_METHODS.map((method) => `'${method.replaceAll("'", "''")}'`).join(", ");
}

export interface SqlCondition {
  /** SQL fragment, `?`-free (all inputs are source-controlled literals). */
  sql: string;
}

function qualifier(alias: string | undefined): string {
  return alias ? `${alias}.` : "";
}

/**
 * SQL predicate matching the protocol set.
 *
 * `substr(tool, 1, 7) = 'server/'` mirrors TypeScript's `startsWith`
 * exactly — SQLite's `LIKE` would be case-insensitive and therefore
 * disagree with the TS path.
 */
export function protocolConditionSql(alias?: string): SqlCondition {
  const q = qualifier(alias);
  return {
    sql: `(${q}tool IN (${protocolMethodSqlList()}) OR substr(${q}tool, 1, ${MCP_SERVER_METHOD_PREFIX.length}) = '${MCP_SERVER_METHOD_PREFIX}')`
  };
}

/**
 * SQL predicate matching the eval-probe rule.
 *
 * `json_valid()` guards malformed / empty `args_summary` so an invalid row
 * degrades to "not a probe" instead of failing the whole aggregation. The
 * key filter mirrors `PROBE_NAME_KEY_PATTERN` and the value filter mirrors
 * `hasProbeName` (lower-case contains, via `instr(lower(...), marker)`).
 */
export function evalProbeConditionSql(alias?: string): SqlCondition {
  const q = qualifier(alias);
  const keyFilters = ["connection", "source", "table", "database", "schema"]
    .map((needle) => `lower(key) LIKE '%${needle}%'`)
    .join(" OR ");
  const valueFilters = PROBE_NAME_MARKERS.map(
    (marker) => `instr(lower(CAST(value AS TEXT)), '${marker}') > 0`
  ).join(" OR ");
  return {
    // COALESCE matters: `eval_mark = 1` is NULL for unmarked rows, and
    // `NOT NULL` is NULL — which would silently drop every unmarked row from
    // the default usage set.
    sql: `(COALESCE(${q}eval_mark, 0) = 1 AND EXISTS (
      SELECT 1 FROM json_each(CASE WHEN json_valid(COALESCE(${q}args_summary, '')) THEN ${q}args_summary ELSE '{}' END)
      WHERE (${keyFilters}) AND (${valueFilters})
    ))`
  };
}

/**
 * The single Default Usage SQL condition: not a protocol event AND not a
 * default-view-excluded eval probe. Raw Business drops only the protocol
 * part.
 */
export function defaultUsageConditionSql(alias?: string): SqlCondition {
  return {
    sql: `NOT ${protocolConditionSql(alias).sql} AND NOT ${evalProbeConditionSql(alias).sql}`
  };
}

/** The single Raw Business SQL condition: not a protocol event. */
export function rawBusinessConditionSql(alias?: string): SqlCondition {
  return { sql: `NOT ${protocolConditionSql(alias).sql}` };
}
