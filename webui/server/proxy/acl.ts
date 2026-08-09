import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import {
  getAccessConfig,
  invalidateAccessConfigCache,
  primeAccessConfigCache,
  resolveAccessConfigPath
} from "./identity.js";
import type { Identity, PermissionModelVersion } from "./identity.js";
import {
  buildForcedFiltersPayload,
  compileScopedRowGrant,
  isUpstreamForcedPredicateProven,
  mergeRowGrants,
  rowGrantDigest,
  validateProtectedLucyQueryArgs,
  type ForcedFiltersPayload,
  type RowGrant
} from "./row-policy.js";

export interface AclDecision {
  allowed: boolean;
  reason?: string; // 'tool_forbidden' | 'table_forbidden:<table>' | 'tool_forbidden_global' | 'tool_absolute_deny:<tool>' | 'tool_unclassified:<tool>' | 'agent_disabled' | 'raw_query_forbidden' | 'query_concurrency_exceeded' | 'explicit_table_required:<table>' | 'sensitive_metadata_forbidden:kx' | 'unknown_or_forbidden_connection:<connection>' | 'role_resolution_failed:<role>' | 'source_map_compile_failed:<detail>' | 'policy_degraded_deny' | 'row_policy_*'
  /** AC-P1 — set when lucy_query is allowed against a protected (scoped) source. */
  forcedFilters?: ForcedFiltersPayload;
}

/** AC-P0 Spec 98 §4.3 — bumps with classification table changes; feeds policyVersion (WP-I5). */
export const TOOL_CLASSIFICATION_VERSION = "ac-p0-cls-1";

export type ToolClass = "AbsoluteDeny" | "DataPlane" | "Meta";

/** Spec 98 §4.2 AbsoluteDeny — code baseline; YAML cannot remove (U-DENY-01). */
export const ABSOLUTE_DENY_TOOLS = [
  "sl_query",
  "sl_read_source",
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status"
] as const;

/** Spec 98 §4.2 DataPlane */
export const DATA_PLANE_TOOLS = [
  "lucy_query",
  "lucy_read_source",
  "lucy_explain_query",
  "lucy_freshness",
  "entity_details",
  "sl_validate"
] as const;

/** Spec 98 §4.2 Meta (incl. sensitive Meta) */
export const META_TOOLS = [
  "dictionary_search",
  "discover_data",
  "lucy_catalog",
  "kx_catalog",
  "connection_list",
  "wiki_search",
  "wiki_read",
  "lucy_begin_question"
] as const;

const ABSOLUTE_DENY_TOOL_SET = new Set<string>(ABSOLUTE_DENY_TOOLS);
const DATA_PLANE_TOOL_SET = new Set<string>(DATA_PLANE_TOOLS);
const META_TOOL_SET = new Set<string>(META_TOOLS);

export function classifyTool(toolName: string): ToolClass {
  if (ABSOLUTE_DENY_TOOL_SET.has(toolName)) return "AbsoluteDeny";
  if (DATA_PLANE_TOOL_SET.has(toolName)) return "DataPlane";
  if (META_TOOL_SET.has(toolName)) return "Meta";
  return "AbsoluteDeny"; // unclassified → fail-closed
}

/** Returns deny reason when tool is AbsoluteDeny baseline or unclassified; undefined if DataPlane/Meta. */
export function absoluteDenyOrUnclassifiedReason(toolName: string): string | undefined {
  if (ABSOLUTE_DENY_TOOL_SET.has(toolName)) return `tool_absolute_deny:${toolName}`;
  if (!DATA_PLANE_TOOL_SET.has(toolName) && !META_TOOL_SET.has(toolName)) {
    return `tool_unclassified:${toolName}`;
  }
  return undefined;
}

const DEFAULT_DENY_TOOLS = [
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status",
  "sl_query",
  "sl_read_source"
] as const;

const DEFAULT_KNOWN_TOOLS = [
  ...ABSOLUTE_DENY_TOOLS,
  ...DATA_PLANE_TOOLS,
  ...META_TOOLS
] as const;

const DEFAULT_TABLE_TOUCHING_TOOLS = [
  "lucy_query",
  "lucy_read_source",
  "lucy_explain_query",
  "lucy_freshness",
  "entity_details",
  "sl_validate",
  // historical extractors retained for deny-path argument diagnostics
  "sl_query",
  "sl_read_source"
] as const;
const DEFAULT_SENSITIVE_METADATA_TOOLS = ["dictionary_search", "discover_data"] as const;
const DEFAULT_SENSITIVE_TABLE_PREFIXES = ["dataforai.kx_"] as const;
const BUILT_IN_TABLE_EXTRACTORS = new Set([
  "sl_query",
  "sl_read_source",
  "sl_validate",
  "entity_details",
  "lucy_query",
  "lucy_read_source",
  "lucy_explain_query",
  "lucy_freshness"
]);
const MAX_ENTITY_REF_DEPTH = 5;

type AccessConfig = Awaited<ReturnType<typeof getAccessConfig>>;

interface AclPolicy {
  denyTools: Set<string>;
  knownTools: Set<string>;
  tableTouchingTools: Set<string>;
  sensitiveMetadataTools: Set<string>;
  sensitiveTablePrefixes: string[];
}

function configList(value: string[] | undefined, fallback: readonly string[], options: { normalize?: boolean } = {}): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .filter((item): item is string => typeof item === "string")
    .map((item) => options.normalize ? normalizeRef(item) : item.trim())
    .filter(Boolean);
}

function mergedConfigList(value: string[] | undefined, fallback: readonly string[], options: { normalize?: boolean } = {}): string[] {
  return [...new Set([
    ...configList(undefined, fallback, options),
    ...configList(value, [], options)
  ])];
}

function aclPolicy(config: AccessConfig): AclPolicy {
  const defaults = config.defaults ?? {};
  return {
    denyTools: new Set(mergedConfigList(defaults.deny_tools, DEFAULT_DENY_TOOLS)),
    knownTools: new Set(mergedConfigList(defaults.known_tools, DEFAULT_KNOWN_TOOLS)),
    tableTouchingTools: new Set(mergedConfigList(defaults.table_touching_tools, DEFAULT_TABLE_TOUCHING_TOOLS)),
    sensitiveMetadataTools: new Set(mergedConfigList(defaults.sensitive_metadata_tools, DEFAULT_SENSITIVE_METADATA_TOOLS)),
    sensitiveTablePrefixes: mergedConfigList(defaults.sensitive_table_prefixes, DEFAULT_SENSITIVE_TABLE_PREFIXES, { normalize: true })
  };
}

// ─── Canonical Source Map: (connectionId, sourceName) / (connectionId, physicalTable) ─

export interface SourceMapEntry {
  physicalTable: string; // e.g. "dataforai.superstore_orders"
  connectionId: string;
  schema: string;
  sourceName: string;
}

export interface CanonicalSourceKey {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
}

export function canonicalSourceKeyDisplay(key: Pick<CanonicalSourceKey, "connectionId" | "schema" | "sourceName" | "physicalTable">): string {
  return `${key.connectionId}|${key.schema}|${key.sourceName}|${key.physicalTable}`;
}

function forwardSourceKey(connectionId: string, sourceName: string): string {
  return `${normalizeRef(connectionId)}\0${normalizeRef(sourceName)}`;
}

function reverseSourceKey(connectionId: string, physicalTable: string): string {
  return `${normalizeRef(connectionId)}\0${normalizeRef(physicalTable)}`;
}

interface SourceMapState {
  forward: Map<string, SourceMapEntry>;
  reverse: Map<string, SourceMapEntry>;
  version: string;
  loadedAt: number;
  /** Set when same connectionId has duplicate sourceName (U-KEY-02). */
  compileError?: string;
}

let sourceMapState: SourceMapState = {
  forward: new Map(),
  reverse: new Map(),
  version: "",
  loadedAt: 0
};
const SOURCE_MAP_TTL = 60_000;

interface SchemaYaml {
  tables?: Record<string, { table?: string }>;
}

function emptySourceMapState(now: number, compileError?: string): SourceMapState {
  return {
    forward: new Map(),
    reverse: new Map(),
    version: "",
    loadedAt: now,
    compileError
  };
}

async function loadSourceMap(options: { fresh?: boolean } = {}): Promise<SourceMapState> {
  const now = Date.now();
  if (!options.fresh && sourceMapState.forward.size > 0 && now - sourceMapState.loadedAt < SOURCE_MAP_TTL) {
    return sourceMapState;
  }

  const projectRoot = await resolveProjectRoot();
  const semanticLayerDir = path.join(projectRoot, "semantic-layer");

  const schemaFiles: string[] = [];
  try {
    for await (const entry of glob("**/_schema/*.yaml", { cwd: semanticLayerDir })) {
      schemaFiles.push(path.join(semanticLayerDir, entry));
    }
  } catch {
    // Keep last-known-good map on transient filesystem/glob failure (fail-closed for ACL).
    if (sourceMapState.forward.size > 0) {
      sourceMapState = { ...sourceMapState, loadedAt: now };
      return sourceMapState;
    }
    sourceMapState = emptySourceMapState(now);
    return sourceMapState;
  }

  const forward = new Map<string, SourceMapEntry>();
  const reverse = new Map<string, SourceMapEntry>();
  let compileError: string | undefined;

  for (const schemaFile of schemaFiles) {
    try {
      const content = await readFile(schemaFile, "utf-8");
      const yaml = parse(content) as SchemaYaml;
      if (!yaml?.tables) continue;
      const rel = path.relative(semanticLayerDir, schemaFile);
      const parts = rel.split(path.sep);
      const connectionId = normalizeRef(parts[0] ?? "");
      const schema = normalizeRef(path.basename(schemaFile, ".yaml"));
      for (const [sourceName, tableDef] of Object.entries(yaml.tables)) {
        if (!tableDef?.table) continue;
        const normalizedSource = normalizeRef(sourceName);
        const physicalTable = normalizeRef(tableDef.table);
        const entry: SourceMapEntry = {
          physicalTable,
          connectionId,
          schema,
          sourceName: normalizedSource
        };
        const fKey = forwardSourceKey(connectionId, normalizedSource);
        if (forward.has(fKey)) {
          compileError = `duplicate_source_name:${connectionId}:${normalizedSource}`;
          continue;
        }
        forward.set(fKey, entry);
        reverse.set(reverseSourceKey(connectionId, physicalTable), entry);
      }
    } catch {
      // skip unreadable files
    }
  }

  const version = createHash("sha256")
    .update(JSON.stringify(
      [...forward.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, entry])
    ))
    .digest("hex")
    .slice(0, 16);

  sourceMapState = {
    forward,
    reverse,
    version,
    loadedAt: now,
    compileError
  };
  return sourceMapState;
}

/** Test / Admin hook: current source map diagnostics (WP-I1). */
export async function getSourceMapDiagnostics(options: { fresh?: boolean } = {}): Promise<{
  sourceMapVersion: string;
  entryCount: number;
  compileError?: string;
  entries: SourceMapEntry[];
}> {
  const state = await loadSourceMap(options);
  return {
    sourceMapVersion: state.version,
    entryCount: state.forward.size,
    compileError: state.compileError,
    entries: [...state.forward.values()].sort((a, b) =>
      `${a.connectionId}:${a.sourceName}`.localeCompare(`${b.connectionId}:${b.sourceName}`)
    )
  };
}

function normalizeRef(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

/**
 * Resolve sourceName → SourceMapEntry using canonical keys.
 * Prefer (connectionId, sourceName). On a scoped miss, fall back to a
 * globally-unique sourceName match so sensitive-prefix ACL cannot be bypassed
 * by a bogus connectionId (fail-closed relative to pre-AC-P0 bare-key lookup).
 * Bare sourceName (no connectionId) only when globally unique.
 */
function resolveSourceEntry(
  sourceName: string,
  state: SourceMapState,
  connectionId?: string
): SourceMapEntry | undefined {
  const normalized = normalizeRef(sourceName);
  if (!normalized) return undefined;

  const uniqueBySourceName = (): SourceMapEntry | undefined => {
    const matches = [...state.forward.values()].filter((entry) => entry.sourceName === normalized);
    if (matches.length === 1) return matches[0];
    const byPhysical = [...state.forward.values()].filter((entry) => entry.physicalTable === normalized);
    if (byPhysical.length === 1) return byPhysical[0];
    return undefined;
  };

  if (connectionId) {
    const scoped = state.forward.get(forwardSourceKey(connectionId, normalized));
    if (scoped) return scoped;
    // Scoped miss: do not invent a cross-connection binding when ambiguous;
    // unique global match preserves sensitive-table resolution.
    return uniqueBySourceName();
  }
  return uniqueBySourceName();
}

function sourceNameToTable(sourceName: string, state: SourceMapState, connectionId?: string): string {
  const normalized = normalizeRef(sourceName);
  return resolveSourceEntry(normalized, state, connectionId)?.physicalTable ?? normalized;
}

function sourceMapEntries(state: SourceMapState): Array<{ source: string; physical: string; connectionId: string }> {
  return [...state.forward.values()].map((entry) => ({
    source: entry.sourceName,
    physical: entry.physicalTable,
    connectionId: entry.connectionId
  }));
}

function hasDelimitedRef(text: string, ref: string): boolean {
  if (!ref) return false;
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`).test(normalizeRef(text));
}

function addTableRefsFromText(
  text: string,
  tables: Set<string>,
  state: SourceMapState,
  options: { fallbackUnknown?: boolean; connectionId?: string } = {}
): void {
  const entries = sourceMapEntries(state);
  let matchedKnownRef = false;
  for (const { source, physical, connectionId } of entries) {
    if (options.connectionId && connectionId !== normalizeRef(options.connectionId)) continue;
    if (hasDelimitedRef(text, physical) || hasDelimitedRef(text, source)) {
      tables.add(physical);
      matchedKnownRef = true;
    }
  }

  if (matchedKnownRef || options.fallbackUnknown === false) return;

  const dottedRef = normalizeRef(text).match(/[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+/);
  if (!dottedRef?.[0]) return;
  const parts = dottedRef[0].split(".");
  const candidate = parts.length >= 3 ? `${parts[0]}.${parts[1]}` : parts[0];
  tables.add(sourceNameToTable(candidate, state, options.connectionId));
}

function collectTableRefs(value: unknown, tables: Set<string>, state: SourceMapState, connectionId?: string): void {
  if (typeof value === "string") {
    addTableRefsFromText(value, tables, state, { fallbackUnknown: false, connectionId });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTableRefs(item, tables, state, connectionId);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectTableRefs(item, tables, state, connectionId);
  }
}

function collectGenericToolTableRefs(value: unknown, tables: Set<string>, state: SourceMapState, connectionId?: string): void {
  collectTableRefs(value, tables, state, connectionId);
  collectMetricRefs(value, tables, state, connectionId);
}

function collectMetricRefs(value: unknown, tables: Set<string>, state: SourceMapState, connectionId?: string): void {
  if (typeof value === "string") {
    addTableRefsFromText(value, tables, state, { connectionId });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMetricRefs(item, tables, state, connectionId);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectMetricRefs(item, tables, state, connectionId);
  }
}

function hasRawQueryArg(args: Record<string, unknown>): boolean {
  return ["query", "sql"].some((key) => typeof args[key] === "string" && String(args[key]).trim().length > 0);
}

function addConnectionRef(value: unknown, connections: Set<string>): void {
  if (typeof value === "string" && value.trim()) {
    connections.add(normalizeRef(value));
  }
}

function collectConnectionRefs(value: unknown, connections: Set<string>, options: { depth?: number } = {}): void {
  const depth = options.depth ?? 0;
  if (depth > MAX_ENTITY_REF_DEPTH || !value) return;
  if (typeof value === "string") {
    addConnectionRef(value, connections);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectConnectionRefs(item, connections, { depth: depth + 1 });
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  for (const key of ["connectionId", "connection_id", "connection", "database"]) {
    addConnectionRef(record[key], connections);
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectConnectionRefs(nested, connections, { depth: depth + 1 });
  }
}

function extractConnectionRefs(toolName: string, args: unknown): string[] {
  const a = args as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || Array.isArray(a)) return [];

  const connections = new Set<string>();
  switch (toolName) {
    case "sl_query":
    case "lucy_query":
    case "lucy_explain_query":
      for (const key of ["connectionId", "connection_id", "connection", "database"]) {
        addConnectionRef(a[key], connections);
      }
      for (const key of ["joins", "join"]) {
        collectConnectionRefs(a[key], connections);
      }
      break;
    case "sl_read_source":
    case "lucy_read_source":
    case "lucy_freshness":
    case "sl_validate":
    case "entity_details":
      for (const key of ["connectionId", "connection_id", "connection", "database"]) {
        addConnectionRef(a[key], connections);
      }
      collectConnectionRefs(a, connections);
      break;
    default:
      break;
  }
  return [...connections].filter(Boolean);
}

// ─── structured source resolution (for access_log_sources) ──────────────────

export interface SourceRef {
  connectionId?: string;
  schema?: string;
  sourceName?: string;
  physicalTable: string;
  extractionMethod: string; // 'args_source_name' | 'field_ref' | 'query_ref' | 'source_map_reverse' | 'unknown'
  confidence: "high" | "medium" | "low";
}

function lookupReverse(
  physicalTable: string,
  state: SourceMapState,
  connectionId?: string
): SourceMapEntry | undefined {
  const normalized = normalizeRef(physicalTable);
  if (connectionId) {
    const scoped = state.reverse.get(reverseSourceKey(connectionId, normalized));
    if (scoped) return scoped;
  }
  const matches = [...state.forward.values()].filter((entry) => entry.physicalTable === normalized);
  if (matches.length === 1) return matches[0];
  return undefined;
}

function toSourceRef(
  table: string,
  state: SourceMapState,
  method: string,
  confidence: "high" | "medium" | "low",
  connectionId?: string
): SourceRef {
  const entry = lookupReverse(table, state, connectionId);
  if (!entry) {
    return { physicalTable: table, extractionMethod: "source_map_reverse", confidence: "medium" };
  }
  return {
    connectionId: entry.connectionId,
    schema: entry.schema,
    sourceName: entry.sourceName,
    physicalTable: table,
    extractionMethod: method,
    confidence
  };
}

function structuredExtractionMethod(toolName: string): string {
  switch (toolName) {
    case "sl_read_source":
    case "lucy_read_source":
    case "lucy_freshness":
    case "sl_validate":
      return "args_source_name";
    case "sl_query":
    case "lucy_query":
    case "lucy_explain_query":
    case "entity_details":
      return "field_ref";
    default:
      return "unknown";
  }
}

/**
 * Like extractTables, but returns structured {connectionId, schema, sourceName, physicalTable}
 * records with an extraction method/confidence, instead of collapsing to physical-table strings.
 */
export async function extractSourceRefs(
  toolName: string,
  args: unknown,
  options: { fresh?: boolean } = {}
): Promise<SourceRef[]> {
  const tables = await extractTables(toolName, args, options);
  if (tables.length === 0) return [];
  const state = await loadSourceMap(options);
  const argsRecord = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : undefined;
  const connectionId = firstString(argsRecord ?? {}, ["connectionId", "connection_id", "connection", "database"]);
  const method = structuredExtractionMethod(toolName);
  const confidence: "high" | "medium" = BUILT_IN_TABLE_EXTRACTORS.has(toolName) ? "high" : "medium";
  return tables.map((table) => toSourceRef(table, state, method, confidence, connectionId));
}

/**
 * Resolves a flat list of physical table names (e.g. from raw-query regex sniffing,
 * or from historical access_log.tables during backfill) into structured SourceRef records.
 * Callers own the extraction_method/confidence semantics for their use case; this defaults
 * to the raw-query best-effort tier ('query_ref' / 'low').
 * Reverse lookup keys by (connectionId, physicalTable); bare physicalTable only when unique.
 */
export async function resolveSourceRefsForTables(
  tables: string[],
  options: {
    fresh?: boolean;
    extractionMethod?: string;
    confidence?: "high" | "medium" | "low";
    connectionId?: string;
  } = {}
): Promise<SourceRef[]> {
  if (tables.length === 0) return [];
  const state = await loadSourceMap(options);
  const method = options.extractionMethod ?? "query_ref";
  const confidence = options.confidence ?? "low";
  return tables.map((table) => toSourceRef(table, state, method, confidence, options.connectionId));
}

function isSensitiveTable(table: string, prefixes: string[]): boolean {
  const normalized = normalizeRef(table);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function sensitiveTables(state: SourceMapState, prefixes: string[]): string[] {
  return [...new Set([...state.forward.values()].map((entry) => entry.physicalTable).filter((table) => isSensitiveTable(table, prefixes)))];
}

function hasExplicitAccessToAllSensitiveTables(allowedTables: string[], state: SourceMapState, prefixes: string[]): boolean {
  const required = sensitiveTables(state, prefixes);
  return required.length > 0 && required.every((table) => allowedTables.includes(table));
}

export interface EffectiveSource {
  connectionId: string;
  schema: string;
  sourceName: string;
  table: string;
}

/** Spec 98 §5.1 / Spec 99 §4 — (tool, canonicalSourceKey, rowGrant). */
export interface EffectiveCapability {
  tool: string;
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  rowGrant: RowGrant;
}

export interface EffectivePermissions {
  roleIds: string[];
  tools: string[];
  tables: string[];
  connections: string[];
  sources: EffectiveSource[];
  /** Spec 98 §5 EffectiveDataCapabilities — union of per-Role tuples, never a cartesian of unions. */
  capabilities: EffectiveCapability[];
  /** Spec 98 §5.1 EffectiveMetaTools */
  metaTools: string[];
  capabilityDigest: string;
  sourceMapVersion: string;
  snapshotHash: string;
  rolesJson: unknown;
  resolvedJson: unknown;
  legacyAllow: boolean;
}

export type RoleResolutionResult = {
  ok: true;
  permissions: EffectivePermissions;
} | {
  ok: false;
  reason: string;
};

function allowedConnections(user: AccessConfig["users"][number]): string[] {
  const allow = user.allow as { connections?: string[] } | undefined;
  return configList(allow?.connections, [], { normalize: true });
}

function isWildcardList(value: string[] | undefined): boolean {
  return Array.isArray(value) && value.includes("*");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function makePermissions(input: Omit<EffectivePermissions, "snapshotHash">): EffectivePermissions {
  const hashInput = {
    roleIds: input.roleIds,
    tools: input.tools,
    tables: input.tables,
    connections: input.connections,
    sources: input.sources,
    capabilities: input.capabilities,
    sourceMapVersion: input.sourceMapVersion,
    rolesJson: input.rolesJson,
    resolvedJson: input.resolvedJson,
    legacyAllow: input.legacyAllow
  };
  return {
    ...input,
    snapshotHash: createHash("sha256").update(stableJson(hashInput)).digest("hex")
  };
}

function roleToolsTouchTables(tools: string[], policy: AclPolicy): boolean {
  return tools.some((tool) => policy.tableTouchingTools.has(tool));
}

export interface SelectorShape {
  connection?: string;
  schema?: string;
  prefix?: string;
  names?: string[];
  row_access?: string;
  row_policy?: unknown;
}

function selectorMatches(
  selector: SelectorShape,
  entry: SourceMapEntry
): boolean {
  const connection = selector.connection ? normalizeRef(selector.connection) : undefined;
  const schema = selector.schema ? normalizeRef(selector.schema) : undefined;
  if (connection && entry.connectionId !== connection) return false;
  if (schema && entry.schema !== schema) return false;
  if (selector.prefix) return entry.sourceName.startsWith(normalizeRef(selector.prefix));
  if (Array.isArray(selector.names)) {
    const names = selector.names.map(normalizeRef);
    return names.includes(entry.sourceName) || names.includes(entry.physicalTable);
  }
  return false;
}

function sourcesForTables(tables: string[], state: SourceMapState): EffectiveSource[] {
  const allowed = new Set(tables.map(normalizeRef));
  return [...state.forward.values()]
    .filter((entry) => allowed.has(entry.physicalTable))
    .map((entry) => ({
      connectionId: entry.connectionId,
      schema: entry.schema,
      sourceName: entry.sourceName,
      table: entry.physicalTable
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.connectionId.localeCompare(b.connectionId));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeRef).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

// ─── Capability algebra (Spec 98 §5) ─────────────────────────────────────────

/** Membership key for the gate: capability identity is (tool, connectionId, physicalTable). */
function capabilityIndexKey(tool: string, connectionId: string, physicalTable: string): string {
  return `${tool}\0${connectionId}\0${physicalTable}`;
}

function sourceIndexKey(connectionId: string, physicalTable: string): string {
  return `${connectionId}\0${physicalTable}`;
}

function grantDigestToken(grant: RowGrant): string {
  return grant.kind === "all" ? "TRUE" : grant.digest;
}

/** RoleCapabilities(r) = (r.allow.tools ∩ DataPlane) \ AbsoluteDeny × SourcesGrantedBy(r). */
function buildCapabilities(
  dataPlaneTools: string[],
  sources: EffectiveSource[],
  sourceGrants?: Map<string, RowGrant>
): EffectiveCapability[] {
  const capabilities: EffectiveCapability[] = [];
  for (const tool of dataPlaneTools) {
    for (const source of sources) {
      const key = sourceIndexKey(source.connectionId, source.table);
      capabilities.push({
        tool,
        connectionId: source.connectionId,
        schema: source.schema,
        sourceName: source.sourceName,
        physicalTable: source.table,
        rowGrant: sourceGrants?.get(key) ?? { kind: "all" }
      });
    }
  }
  return capabilities;
}

/** Union capabilities across Roles; same (tool, source) merges rowGrant with OR. */
function dedupeCapabilities(capabilities: EffectiveCapability[]): EffectiveCapability[] {
  const merged = new Map<string, EffectiveCapability>();
  for (const capability of capabilities) {
    const key = capabilityIndexKey(capability.tool, capability.connectionId, capability.physicalTable);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, capability);
      continue;
    }
    merged.set(key, {
      ...existing,
      rowGrant: mergeRowGrants(existing.rowGrant, capability.rowGrant)
    });
  }
  return [...merged.values()].sort((a, b) =>
    a.tool.localeCompare(b.tool) || canonicalSourceKeyDisplay(a).localeCompare(canonicalSourceKeyDisplay(b))
  );
}

function capabilityDigest(capabilities: EffectiveCapability[]): string {
  return createHash("sha256")
    .update(
      capabilities
        .map((capability) =>
          `${capability.tool}|${canonicalSourceKeyDisplay(capability)}|${grantDigestToken(capability.rowGrant)}`
        )
        .join("\n")
    )
    .digest("hex")
    .slice(0, 16);
}

function sourcesFromCapabilities(capabilities: EffectiveCapability[]): EffectiveSource[] {
  return [...new Map(capabilities.map((capability) => [
    `${capability.connectionId}:${capability.sourceName}`,
    {
      connectionId: capability.connectionId,
      schema: capability.schema,
      sourceName: capability.sourceName,
      table: capability.physicalTable
    }
  ])).values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName) || a.connectionId.localeCompare(b.connectionId));
}

function classifyGrantedTools(tools: string[], policy: AclPolicy): { dataPlane: string[]; meta: string[]; denied: string[] } {
  const dataPlane: string[] = [];
  const meta: string[] = [];
  const denied: string[] = [];
  for (const tool of tools) {
    if (policy.denyTools.has(tool) || absoluteDenyOrUnclassifiedReason(tool)) {
      denied.push(tool);
      continue;
    }
    if (DATA_PLANE_TOOL_SET.has(tool)) dataPlane.push(tool);
    else if (META_TOOL_SET.has(tool)) meta.push(tool);
  }
  return { dataPlane, meta, denied };
}

// ─── Permission model version (Spec 98 §7 / ADR-AC-04) ──────────────────────

export type PermissionModelVersionResult =
  | { ok: true; version: PermissionModelVersion; assumed: boolean }
  | { ok: false; reason: string };

/**
 * Spec 98 §7 — a missing field is read as `1` for the migration window so
 * pre-AC-P0 `access.yaml` keeps resolving; `assumed` marks that soft path.
 * Admin writes always persist the field explicitly (WP-I4 migration).
 */
export function normalizePermissionModelVersion(
  role: { permission_model_version?: unknown } | undefined
): PermissionModelVersionResult {
  const raw = role?.permission_model_version;
  if (raw === undefined || raw === null) return { ok: true, version: 1, assumed: true };
  if (raw === 1 || raw === 2) return { ok: true, version: raw, assumed: false };
  return { ok: false, reason: "invalid_permission_model_version" };
}

/** Spec 98 §7 / Spec 99 §3 / §7 — selector legality for a given generation; undefined when legal. */
function selectorVersionFailure(version: PermissionModelVersion, selector: SelectorShape): string | undefined {
  const rowAccess = typeof selector.row_access === "string" ? normalizeRef(selector.row_access) : undefined;
  if (rowAccess !== undefined && rowAccess !== "all" && rowAccess !== "scoped") return "invalid_row_access";
  if (rowAccess !== "scoped" && selector.row_policy !== undefined) return "row_policy_on_all_forbidden";
  // Spec 99 §7 — generation 1 has no scoped / row_policy surface.
  if (version === 1) {
    if (rowAccess === "scoped" || selector.row_policy !== undefined) return "v1_scoped_forbidden";
    return undefined;
  }
  if (selector.prefix !== undefined) return "v2_prefix_forbidden";
  if (rowAccess === undefined) return "v2_row_access_required";
  return undefined;
}

/**
 * Admin hook (WP-I4): concrete sourceNames a selector currently matches.
 * Used to expand a v1 `prefix` selector into explicit `names` on save.
 */
export async function expandSelectorSourceNames(
  selector: SelectorShape,
  options: { fresh?: boolean } = {}
): Promise<string[]> {
  const state = await loadSourceMap({ fresh: options.fresh ?? true });
  return uniqueSorted(
    [...state.forward.values()]
      .filter((entry) => selectorMatches(selector, entry))
      .map((entry) => entry.sourceName)
  );
}

interface CompiledRole {
  roleId: string;
  dataPlaneTools: string[];
  metaTools: string[];
  deniedTools: string[];
  sources: EffectiveSource[];
  /** Per (connectionId, physicalTable) row grant for this Role. */
  sourceGrants: Map<string, RowGrant>;
  declaredConnections: string[];
  hasSelectors: boolean;
}

type CompiledRoleResult = { ok: true; role: CompiledRole } | { ok: false; reason: string };

function scopedGrantForSource(
  multiSourceGrant: Extract<RowGrant, { kind: "scoped" }>,
  sourceName: string
): RowGrant {
  const predicates = multiSourceGrant.predicates.filter(
    (predicate) => normalizeRef(predicate.sourceName) === normalizeRef(sourceName)
  );
  return {
    kind: "scoped",
    digest: rowGrantDigest(predicates),
    predicates,
    orArms: [predicates]
  };
}

async function compileRole(
  roleId: string,
  role: NonNullable<AccessConfig["roles"]>[string] | undefined,
  policy: AclPolicy,
  state: SourceMapState
): Promise<CompiledRoleResult> {
  const failed: CompiledRoleResult = { ok: false, reason: `role_resolution_failed:${roleId}` };
  if (!role?.allow) return failed;
  if (Object.prototype.hasOwnProperty.call(role, "constraints")) {
    return { ok: false, reason: `role_resolution_failed:${roleId}:constraints_unsupported` };
  }

  const modelVersion = normalizePermissionModelVersion(role);
  if (!modelVersion.ok) return { ok: false, reason: `role_resolution_failed:${roleId}:${modelVersion.reason}` };

  const roleTools = configList(role.allow.tools, []);
  if (roleTools.length === 0 || roleTools.includes("*")) return failed;
  for (const tool of roleTools) {
    if (!policy.knownTools.has(tool)) return failed;
  }

  const selectors = Array.isArray(role.allow.tableSelectors) ? role.allow.tableSelectors : [];
  const declaredConnections = configList(role.allow.connections, [], { normalize: true });
  if ((selectors.length > 0 || roleToolsTouchTables(roleTools, policy)) && declaredConnections.length === 0) {
    return failed;
  }

  const sourceMatches: EffectiveSource[] = [];
  const sourceGrants = new Map<string, RowGrant>();
  for (const selector of selectors) {
    const versionFailure = selectorVersionFailure(modelVersion.version, selector);
    if (versionFailure) return { ok: false, reason: `role_resolution_failed:${roleId}:${versionFailure}` };
    const matches = [...state.forward.values()].filter((entry) => selectorMatches(selector, entry));
    if (matches.length === 0) return failed;

    const rowAccess = typeof selector.row_access === "string" ? normalizeRef(selector.row_access) : "all";
    let multiScoped: Extract<RowGrant, { kind: "scoped" }> | undefined;
    if (rowAccess === "scoped") {
      const compiled = await compileScopedRowGrant(
        selector.row_policy,
        matches.map((entry) => ({
          connectionId: entry.connectionId,
          sourceName: entry.sourceName,
          schema: entry.schema
        }))
      );
      if (!compiled.ok) return { ok: false, reason: `role_resolution_failed:${roleId}:${compiled.reason}` };
      if (compiled.grant.kind !== "scoped") {
        return { ok: false, reason: `role_resolution_failed:${roleId}:row_policy_invalid` };
      }
      multiScoped = compiled.grant;
    }

    for (const entry of matches) {
      // U-CAP-04: a capability source on an undeclared connection is a compile failure.
      if (!declaredConnections.includes(entry.connectionId)) return failed;
      const grant: RowGrant = multiScoped
        ? scopedGrantForSource(multiScoped, entry.sourceName)
        : { kind: "all" };
      const key = sourceIndexKey(entry.connectionId, entry.physicalTable);
      const existing = sourceGrants.get(key);
      if (existing && grantDigestToken(existing) !== grantDigestToken(grant)) {
        return { ok: false, reason: `role_resolution_failed:${roleId}:row_grant_conflict` };
      }
      sourceGrants.set(key, grant);
      sourceMatches.push({
        connectionId: entry.connectionId,
        schema: entry.schema,
        sourceName: entry.sourceName,
        table: entry.physicalTable
      });
    }
  }

  const { dataPlane, meta, denied } = classifyGrantedTools(roleTools, policy);
  return {
    ok: true,
    role: {
      roleId,
      dataPlaneTools: dataPlane,
      metaTools: meta,
      deniedTools: denied,
      sources: [...new Map(sourceMatches.map((source) => [`${source.connectionId}:${source.sourceName}`, source])).values()],
      sourceGrants,
      declaredConnections,
      hasSelectors: selectors.length > 0
    }
  };
}

/** Role Set resolution: legacy `role: x` ≡ `roles: [x]`; declaring both is fail-closed. */
function resolveRoleIds(user: AccessConfig["users"][number]): { ok: true; roleIds: string[] } | { ok: false; reason: string } {
  const singleRole = typeof user.role === "string" && user.role.trim() ? user.role.trim() : undefined;
  const roleList = Array.isArray(user.roles)
    ? user.roles.filter((role): role is string => typeof role === "string").map((role) => role.trim()).filter(Boolean)
    : undefined;

  if (singleRole && roleList && roleList.length > 0) {
    return { ok: false, reason: "role_resolution_failed:role_and_roles" };
  }
  if (Array.isArray(user.roles) && (roleList?.length ?? 0) === 0 && !singleRole) {
    return { ok: true, roleIds: [] };
  }
  if (roleList && roleList.length > 0) return { ok: true, roleIds: [...new Set(roleList)] };
  return { ok: true, roleIds: singleRole ? [singleRole] : [] };
}

async function resolveEffectivePermissions(
  identity: Identity,
  config: AccessConfig,
  policy: AclPolicy,
  options: { freshSourceMap?: boolean; sourceMap?: SourceMapState } = {}
): Promise<RoleResolutionResult> {
  const user = config.users.find((u) => u.id === identity.userId);
  if (!user) return { ok: false, reason: "tool_forbidden" };
  if (user.enabled === false) return { ok: false, reason: "agent_disabled" };
  if (Object.prototype.hasOwnProperty.call(user, "constraints")) {
    return { ok: false, reason: "constraints_unsupported" };
  }

  const state = options.sourceMap ?? await loadSourceMap({ fresh: options.freshSourceMap ?? true });
  if (state.compileError) {
    return { ok: false, reason: `source_map_compile_failed:${state.compileError}` };
  }
  const sourceMapVersion = state.version;
  const roleSet = resolveRoleIds(user);
  if (!roleSet.ok) return { ok: false, reason: roleSet.reason };

  if (roleSet.roleIds.length === 0) {
    const tools = configList(user.allow?.tools, []).filter(
      (tool) => tool === "*" || !absoluteDenyOrUnclassifiedReason(tool)
    );
    const tables = configList(user.allow?.tables, [], { normalize: true });
    const connections = allowedConnections(user);
    const grantedSources = isWildcardList(tables) ? [] : sourcesForTables(tables, state);
    // Legacy single allow block: capabilities are the same cartesian the table allowlist already implied.
    const expandedTools = tools.includes("*") ? [...policy.knownTools] : tools;
    const { dataPlane, meta } = classifyGrantedTools(expandedTools, policy);
    const capabilities = dedupeCapabilities(buildCapabilities(dataPlane, grantedSources));
    const sources = sourcesFromCapabilities(capabilities);
    const resolvedJson = { tools, tables, connections, sources, capabilities, sourceMapVersion };
    return {
      ok: true,
      permissions: makePermissions({
        roleIds: [],
        tools,
        tables,
        connections,
        sources,
        capabilities,
        metaTools: uniqueSorted(meta),
        capabilityDigest: capabilityDigest(capabilities),
        sourceMapVersion,
        rolesJson: null,
        resolvedJson,
        legacyAllow: true
      })
    };
  }

  const compiledRoles: CompiledRole[] = [];
  for (const roleId of roleSet.roleIds) {
    const compiled = await compileRole(roleId, config.roles?.[roleId], policy, state);
    if (!compiled.ok) return { ok: false, reason: compiled.reason };
    compiledRoles.push(compiled.role);
  }

  const capabilities = dedupeCapabilities(
    compiledRoles.flatMap((role) => buildCapabilities(role.dataPlaneTools, role.sources, role.sourceGrants))
  );
  const capabilityTools = new Set(capabilities.map((capability) => capability.tool));
  const metaTools = uniqueSorted(compiledRoles.flatMap((role) => role.metaTools));
  const tools = uniqueSorted([...capabilityTools, ...metaTools]);
  const sources = sourcesFromCapabilities(capabilities);
  const tables = uniqueSorted(sources.map((source) => source.table));
  // Roles with selectors derive their connections from capabilities; pure Meta Roles use the declared list.
  const connections = uniqueSorted([
    ...capabilities.map((capability) => capability.connectionId),
    ...compiledRoles.filter((role) => !role.hasSelectors).flatMap((role) => role.declaredConnections)
  ]);
  const deniedTools = uniqueSorted(compiledRoles.flatMap((role) => role.deniedTools));
  const rolesJson = Object.fromEntries(roleSet.roleIds.map((roleId) => [roleId, config.roles?.[roleId]]));
  const resolvedJson = { tools, deniedTools, connections, tables, sources, capabilities, sourceMapVersion };

  return {
    ok: true,
    permissions: makePermissions({
      roleIds: roleSet.roleIds,
      tools,
      tables,
      connections,
      sources,
      capabilities,
      metaTools,
      capabilityDigest: capabilityDigest(capabilities),
      sourceMapVersion,
      rolesJson,
      resolvedJson,
      legacyAllow: false
    })
  };
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function addEntityDetailRef(value: unknown, tables: Set<string>, state: SourceMapState, options: { depth?: number; directString?: boolean; connectionId?: string } = {}): void {
  const depth = options.depth ?? 0;
  if (depth > MAX_ENTITY_REF_DEPTH || !value) return;
  if (typeof value === "string") {
    if (options.directString) tables.add(sourceNameToTable(value, state, options.connectionId));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addEntityDetailRef(item, tables, state, { depth: depth + 1, directString: true, connectionId: options.connectionId });
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const nestedConnection = firstString(record, ["connectionId", "connection_id", "connection", "database"]) ?? options.connectionId;

  const directRef = firstString(record, [
    "table",
    "sourceName",
    "source",
    "source_name",
    "tableName",
    "table_name",
    "qualifiedName",
    "qualified_name",
    "ref"
  ]);
  if (directRef) tables.add(sourceNameToTable(directRef, state, nestedConnection));

  const schema = firstString(record, ["schema", "schemaName", "schema_name"]);
  const name = firstString(record, ["name", "entityName", "entity_name", "tableName", "table_name"]);
  if (schema && name) tables.add(sourceNameToTable(`${schema}.${name}`, state, nestedConnection));

  const kind = firstString(record, ["type", "kind", "entityType", "entity_type"]);
  const typedName = firstString(record, ["name", "id", "entityId", "entity_id"]);
  if (typedName && kind && ["source", "table", "semantic_source", "physical_table"].includes(normalizeRef(kind))) {
    tables.add(sourceNameToTable(typedName, state, nestedConnection));
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      addEntityDetailRef(nested, tables, state, { depth: depth + 1, connectionId: nestedConnection });
    }
  }
}

export async function extractTables(
  toolName: string,
  args: unknown,
  options: { fresh?: boolean; sourceMap?: SourceMapState } = {}
): Promise<string[]> {
  const a = args as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || Array.isArray(a)) return [];

  // Prefer a pinned EffectivePolicy source map (Spec 98 §8.1 / §8.2); never silently rebuild on hot path.
  const state = options.sourceMap ?? await loadSourceMap(options);
  const connectionId = firstString(a, ["connectionId", "connection_id", "connection", "database"]);
  const tables = new Set<string>();

  switch (toolName) {
    case "sl_query":
    case "lucy_query":
    case "lucy_explain_query": {
      const sourceName = (a.sourceName ?? a.source_name ?? a.source ?? a.table) as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, state, connectionId));
      collectMetricRefs(a.measures, tables, state, connectionId);
      for (const d of (a.dimensions as Array<{ field?: string }> | undefined) ?? []) {
        if (d?.field) addTableRefsFromText(d.field, tables, state, { connectionId });
      }
      for (const key of ["filters", "where", "segments", "joins", "join", "orderBy", "order_by", "sort", "sorts", "having", "groupBy", "group_by"]) {
        collectTableRefs(a[key], tables, state, connectionId);
      }
      break;
    }
    case "sl_read_source":
    case "lucy_read_source":
    case "lucy_freshness": {
      // Accept the same alias set as mcp-proxy validateLucyToolArgs / upstream rewrite.
      const sourceName = (a.sourceName ?? a.source_name ?? a.source ?? a.table) as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, state, connectionId));
      break;
    }
    case "sl_validate": {
      const sourceName = (a.sourceName ?? a.source ?? a.table) as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, state, connectionId));
      break;
    }
    case "entity_details": {
      addEntityDetailRef(a, tables, state, { connectionId });
      addEntityDetailRef(a.entities, tables, state, { directString: true, connectionId });
      break;
    }
    default:
      collectGenericToolTableRefs(a, tables, state, connectionId);
      break;
  }

  return [...tables].filter(Boolean);
}

export async function lucyCatalog(identity: Identity): Promise<{
  connections: string[];
  sources: Array<{ connectionId: string; schema: string; sourceName: string; table: string }>;
  examples: string[];
}> {
  // Spec 98 §8.2 / §8.5 — committed policy only; under global degrade Meta catalog is empty.
  const runtime = await ensurePolicyRuntime();
  if (runtime.degradedGlobal) {
    return { connections: [], sources: [], examples: [] };
  }
  const resolved = await effectivePermissions(identity);
  if (!resolved.ok) {
    return { connections: [], sources: [], examples: [] };
  }
  const connections = resolved.permissions.connections;
  const sources = resolved.permissions.sources
    .map((source) => ({
      connectionId: source.connectionId,
      schema: source.schema,
      sourceName: source.sourceName,
      table: source.table
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  const hasPocAdRevenue = sources.some((source) => source.connectionId === "poc-mysql-aliyun" && source.sourceName === "poc_ad_revenue_daily");
  const hasKxSources = sources.some((source) => source.sourceName.startsWith("kx_") || source.table.includes(".kx_"));

  return {
    connections,
    sources,
    examples: hasPocAdRevenue
      ? [
          "For 本年各月广告收入, call sl_query with exactly this shape: {\"connectionId\":\"poc-mysql-aliyun\",\"measures\":[\"poc_ad_revenue_daily.ad_revenue\"],\"dimensions\":[{\"field\":\"poc_ad_revenue_daily.dt\",\"granularity\":\"month\"}],\"segments\":[\"poc_ad_revenue_daily.domestic\"],\"order_by\":[{\"field\":\"poc_ad_revenue_daily.dt\",\"direction\":\"asc\"}],\"limit\":20}.",
          "Do not rewrite semantic keys to short names such as ad_revenue/dt/domestic; ACL requires explicit source-qualified keys. Do not wrap semantic measures as objects; object measures are only for ad hoc expr/name aggregates.",
          "POC ad revenue data currently covers 2026-01-01 through 2026-05-31."
        ]
      : hasKxSources
      ? [
          "Use connectionId=mysql-aliyun with kx_fact_financial_amount joined to kx_dim_company and kx_dim_financial_item.",
          "For company operation questions, filter company_name in kx_dim_company and period/year in kx_fact_financial_amount or kx_vw_* detail views."
        ]
      : []
  };
}

export async function kxCatalog(identity: Identity): Promise<{
  connections: string[];
  sources: Array<{ connectionId?: string; schema?: string; sourceName: string; table: string }>;
  examples: string[];
}> {
  const catalog = await lucyCatalog(identity);
  const hasKxSources = catalog.sources.some((source) => source.sourceName.startsWith("kx_") || source.table.includes(".kx_"));
  return {
    connections: catalog.connections,
    sources: catalog.sources,
    examples: hasKxSources
      ? [
          "Use connectionId=mysql-aliyun with kx_fact_financial_amount joined to kx_dim_company and kx_dim_financial_item.",
          "For company operation questions, filter company_name in kx_dim_company and period/year in kx_fact_financial_amount or kx_vw_* detail views."
        ]
      : []
  };
}

export async function effectivePermissions(identity: Identity): Promise<RoleResolutionResult> {
  const runtime = await ensurePolicyRuntime();
  // Spec 98 §8.5 — under global degrade keep LKG permissions for Wiki Meta / identity;
  // DataPlane is still blocked in authorizeAndRewrite via degradedGlobal.
  if (runtime.degradedGlobal) {
    const lkg = runtime.byUserId.get(identity.userId);
    if (lkg) return lkg;
    return { ok: false, reason: "policy_degraded_deny" };
  }
  const cached = runtime.byUserId.get(identity.userId);
  if (cached) return cached;
  const policy = aclPolicy(runtime.config);
  return resolveEffectivePermissions(identity, runtime.config, policy, { sourceMap: runtime.sourceMap });
}

export async function permissionSnapshot(identity: Identity): Promise<{
  roleIds: string[];
  hash: string;
  effectiveTablesCount: number;
  rolesJson: unknown;
  resolvedJson: unknown;
  capabilityDigest: string;
  toolClassificationVersion: string;
  policyVersion: string;
} | undefined> {
  const resolved = await effectivePermissions(identity);
  if (!resolved.ok) return undefined;
  const runtime = await ensurePolicyRuntime();
  return {
    roleIds: resolved.permissions.roleIds,
    hash: resolved.permissions.snapshotHash,
    effectiveTablesCount: resolved.permissions.tables.length,
    rolesJson: resolved.permissions.rolesJson,
    resolvedJson: resolved.permissions.resolvedJson,
    capabilityDigest: resolved.permissions.capabilityDigest,
    toolClassificationVersion: TOOL_CLASSIFICATION_VERSION,
    policyVersion: runtime.policyVersion
  };
}

export async function resolveEffectivePermissionsForAdmin(
  userId: string,
  options: { freshSourceMap?: boolean } = {}
): Promise<RoleResolutionResult> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  return resolveEffectivePermissions({ userId, tokenLabel: "admin-preview", tokenHashPrefix: "admin-preview" }, config, policy, {
    freshSourceMap: options.freshSourceMap ?? true
  });
}

export async function previewRolePermissionsForAdmin(
  roleId: string,
  options: {
    freshSourceMap?: boolean;
    role?: NonNullable<AccessConfig["roles"]>[string];
  } = {}
): Promise<RoleResolutionResult> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  const previewUserId = "__role_preview__";
  const previewConfig: AccessConfig = {
    ...config,
    roles: options.role
      ? {
          ...(config.roles ?? {}),
          [roleId]: options.role
        }
      : config.roles,
    users: [
      ...config.users.filter((user) => user.id !== previewUserId),
      { id: previewUserId, role: roleId, enabled: true, tokens: [] }
    ]
  };
  return resolveEffectivePermissions({ userId: previewUserId, tokenLabel: "admin-preview", tokenHashPrefix: "admin-preview" }, previewConfig, policy, {
    freshSourceMap: options.freshSourceMap ?? true
  });
}

export async function allowedToolNames(identity: Identity): Promise<string[]> {
  // Spec 98 §8.2 — listTools must use committed EffectivePolicy (same as authorizeAndRewrite).
  const runtime = await ensurePolicyRuntime();
  const resolved = await effectivePermissions(identity);
  if (!resolved.ok) return [];
  const policy = aclPolicy(runtime.config);

  const tools = resolved.permissions.tools.includes("*")
    ? [...policy.knownTools]
    : resolved.permissions.tools;

  const capabilityTools = new Set(resolved.permissions.capabilities.map((capability) => capability.tool));

  return uniqueSorted(tools.filter((tool) => {
    if (absoluteDenyOrUnclassifiedReason(tool)) return false;
    if (!policy.knownTools.has(tool) || policy.denyTools.has(tool)) return false;
    // Spec 98 §8.5 — global degrade hides DataPlane / data Meta from listTools; Wiki may remain.
    if (runtime.degradedGlobal && isDegradedBlockedTool(tool)) return false;
    const wildcardTables = resolved.permissions.tables.includes("*");
    // P-GATE-03: DataPlane visible iff ≥1 capability — except legacy tables:* (capability list empty by design).
    if (DATA_PLANE_TOOL_SET.has(tool)) return wildcardTables || capabilityTools.has(tool);
    if (tool.startsWith("lucy_") || tool === "kx_catalog") {
      return wildcardTables || resolved.permissions.capabilities.length > 0;
    }
    return true;
  }));
}

// ─── EffectivePolicy compile / submit (Spec 98 §8 / WP-I5) ───────────────────

export interface PolicyRuntimeStatus {
  policyVersion: string;
  degradedGlobal: boolean;
  degradedAgents: string[];
  accessConfigDigest: string;
  sourceMapVersion: string;
}

interface EffectivePolicySnapshot {
  policyVersion: string;
  accessConfigDigest: string;
  sourceMapVersion: string;
  toolClassificationVersion: string;
  degradedGlobal: boolean;
  degradedAgents: Set<string>;
  config: AccessConfig;
  sourceMap: SourceMapState;
  byUserId: Map<string, RoleResolutionResult>;
  /** Per v1 prefix Role: matched source count at last successful compile. */
  v1PrefixSourceCounts: Map<string, number>;
}

let effectivePolicyRef: EffectivePolicySnapshot | null = null;
/** Serialize commits so concurrent Admin saves each observe the latest disk (no coalesce). */
let commitTail: Promise<void> = Promise.resolve();

const DEGRADED_META_DATA_TOOLS = new Set([
  "lucy_catalog",
  "kx_catalog",
  "dictionary_search",
  "discover_data",
  "connection_list"
]);

export function computeAccessConfigDigest(config: AccessConfig): string {
  return createHash("sha256").update(stableJson(config)).digest("hex");
}

export function computePolicyVersion(
  accessConfigDigest: string,
  sourceMapVersion: string,
  toolClassificationVersion: string = TOOL_CLASSIFICATION_VERSION
): string {
  return createHash("sha256")
    .update(`${accessConfigDigest}||${sourceMapVersion}||${toolClassificationVersion}`)
    .digest("hex");
}

export function getPolicyRuntimeStatus(): PolicyRuntimeStatus {
  return {
    policyVersion: effectivePolicyRef?.policyVersion ?? "",
    degradedGlobal: effectivePolicyRef?.degradedGlobal ?? false,
    degradedAgents: effectivePolicyRef ? [...effectivePolicyRef.degradedAgents].sort() : [],
    accessConfigDigest: effectivePolicyRef?.accessConfigDigest ?? "",
    sourceMapVersion: effectivePolicyRef?.sourceMapVersion ?? ""
  };
}

/** Spec 98 §8.4 — shared healthy signal for /api/health and /api/admin/policy-runtime. */
export function isPolicyRuntimeHealthy(status: PolicyRuntimeStatus = getPolicyRuntimeStatus()): boolean {
  return !status.degradedGlobal && status.degradedAgents.length === 0 && status.policyVersion !== "";
}

/** Test helper: clear compiled runtime so the next ensure/commit rebuilds. */
export function resetEffectivePolicyForTests(): void {
  effectivePolicyRef = null;
  commitTail = Promise.resolve();
}

/**
 * Spec 98 §8.2 — runtimeAck only when runtime digest matches the just-written config
 * and global degrade is clear. Per-agent degrade is surfaced via degradedAgents / banner (I6);
 * it must not roll back an otherwise successful Admin write of a legal candidate.
 */
export function evaluateRuntimeAck(
  status: PolicyRuntimeStatus,
  expectedAccessConfigDigest: string
): boolean {
  return (
    !status.degradedGlobal
    && status.accessConfigDigest === expectedAccessConfigDigest
    && status.policyVersion !== ""
  );
}

function countV1PrefixSources(config: AccessConfig, state: SourceMapState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [roleId, role] of Object.entries(config.roles ?? {})) {
    const modelVersion = normalizePermissionModelVersion(role);
    if (!modelVersion.ok || modelVersion.version !== 1) continue;
    const selectors = Array.isArray(role.allow?.tableSelectors) ? role.allow.tableSelectors : [];
    let matched = 0;
    let hasPrefix = false;
    for (const selector of selectors) {
      if (selector?.prefix === undefined) continue;
      hasPrefix = true;
      matched += [...state.forward.values()].filter((entry) => selectorMatches(selector, entry)).length;
    }
    if (hasPrefix) counts.set(roleId, matched);
  }
  return counts;
}

function emitPolicyScopeExpanded(roleId: string, before: number, after: number, sourceMapVersion: string): void {
  console.warn(
    `[acl] policy_scope_expanded roleId=${roleId} sourcesBefore=${before} sourcesAfter=${after} sourceMapVersion=${sourceMapVersion}`
  );
  void import("../admin/audit.js")
    .then(({ recordConfigChange }) => recordConfigChange({
      filePath: "webui/config/access.yaml",
      changeType: "policy_scope_expanded",
      actorType: "system",
      source: "acl_policy_compile",
      assetKind: "governance",
      targetId: roleId,
      writeStatus: "committed",
      oldSummary: { sourcesBefore: before, sourceMapVersion },
      newSummary: { sourcesAfter: after, sourceMapVersion }
    }))
    .catch((err) => {
      console.error("[acl] failed to record policy_scope_expanded", err);
    });
}

async function recordPolicyDegradeEvent(input: {
  changeType: "policy_degraded_enter" | "policy_degraded_recover" | "policy_degraded_scope_changed";
  degradedGlobal: boolean;
  degradedAgents: string[];
  policyVersion: string;
  errorReason?: string;
  addedAgents?: string[];
  removedAgents?: string[];
}): Promise<void> {
  try {
    const { recordConfigChange } = await import("../admin/audit.js");
    await recordConfigChange({
      filePath: "webui/config/access.yaml",
      changeType: input.changeType,
      actorType: "system",
      source: "acl_policy_compile",
      assetKind: "governance",
      writeStatus: input.changeType === "policy_degraded_recover" ? "committed" : "failed",
      errorReason: input.errorReason,
      newSummary: {
        degradedGlobal: input.degradedGlobal,
        degradedAgents: input.degradedAgents,
        policyVersion: input.policyVersion,
        addedAgents: input.addedAgents ?? [],
        removedAgents: input.removedAgents ?? []
      }
    });
  } catch (err) {
    console.error("[acl] failed to record policy degrade event", err);
  }
}

function isDegradedBlockedTool(toolName: string): boolean {
  return classifyTool(toolName) === "DataPlane" || DEGRADED_META_DATA_TOOLS.has(toolName);
}

async function commitEffectivePolicyUnlocked(): Promise<PolicyRuntimeStatus> {
  const previous = effectivePolicyRef;
  const configPath = await resolveAccessConfigPath();

  let config: AccessConfig;
  try {
    const content = await readFile(configPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = parse(content);
    } catch (err) {
      throw err;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as AccessConfig).users)) {
      throw new Error("invalid_access_config_shape");
    }
    config = parsed as AccessConfig;
  } catch (err) {
    const degraded: EffectivePolicySnapshot = {
      policyVersion: previous?.policyVersion ?? "",
      accessConfigDigest: previous?.accessConfigDigest ?? "",
      sourceMapVersion: previous?.sourceMapVersion ?? "",
      toolClassificationVersion: TOOL_CLASSIFICATION_VERSION,
      degradedGlobal: true,
      degradedAgents: new Set(),
      config: previous?.config ?? { users: [] },
      sourceMap: previous?.sourceMap ?? emptySourceMapState(Date.now()),
      byUserId: previous?.byUserId ?? new Map(),
      v1PrefixSourceCounts: previous?.v1PrefixSourceCounts ?? new Map()
    };
    const wasDegraded = Boolean(previous?.degradedGlobal);
    effectivePolicyRef = degraded;
    // Spec 98 §8.5 — keep LKG identity/config cache so Wiki Meta can still resolve under wiki ACL.
    if (previous?.policyVersion) {
      primeAccessConfigCache(previous.config, configPath);
    } else {
      invalidateAccessConfigCache();
    }
    console.error("[acl] policy_degraded_global: access.yaml parse/load failed", err);
    if (!wasDegraded) {
      await recordPolicyDegradeEvent({
        changeType: "policy_degraded_enter",
        degradedGlobal: true,
        degradedAgents: [],
        policyVersion: degraded.policyVersion,
        errorReason: err instanceof Error ? err.message : String(err)
      });
    }
    return getPolicyRuntimeStatus();
  }

  primeAccessConfigCache(config, configPath);
  const state = await loadSourceMap({ fresh: true });
  const policy = aclPolicy(config);
  const accessConfigDigest = computeAccessConfigDigest(config);
  const policyVersion = computePolicyVersion(accessConfigDigest, state.version);
  const v1PrefixSourceCounts = countV1PrefixSources(config, state);

  if (previous && !previous.degradedGlobal && previous.sourceMapVersion !== state.version) {
    for (const [roleId, afterCount] of v1PrefixSourceCounts) {
      const beforeCount = previous.v1PrefixSourceCounts.get(roleId) ?? 0;
      if (afterCount > beforeCount) {
        emitPolicyScopeExpanded(roleId, beforeCount, afterCount, state.version);
      }
    }
  }

  const byUserId = new Map<string, RoleResolutionResult>();
  const degradedAgents = new Set<string>();
  const previewIdentity = (userId: string): Identity => ({
    userId,
    tokenLabel: "policy-compile",
    tokenHashPrefix: "policy-compile"
  });

  for (const user of config.users ?? []) {
    if (!user?.id) continue;
    const resolved = await resolveEffectivePermissions(previewIdentity(user.id), config, policy, {
      sourceMap: state
    });
    if (!resolved.ok && (
      resolved.reason.startsWith("role_resolution_failed")
      || resolved.reason.startsWith("source_map_compile_failed")
    )) {
      degradedAgents.add(user.id);
      console.error(`[acl] policy_degraded_deny agent=${user.id} cause=${resolved.reason}`);
    }
    // Keep the concrete compile reason (e.g. role_resolution_failed:*) for diagnostics;
    // DataPlane calls still fail closed via !resolved.ok.
    byUserId.set(user.id, resolved);
  }

  const previousDegradedGlobal = Boolean(previous?.degradedGlobal);
  const previousAgents = previous?.degradedAgents ?? new Set<string>();
  const nextAgents = [...degradedAgents].sort();
  const addedAgents = nextAgents.filter((id) => !previousAgents.has(id));
  const removedAgents = [...previousAgents].filter((id) => !degradedAgents.has(id)).sort();

  effectivePolicyRef = {
    policyVersion,
    accessConfigDigest,
    sourceMapVersion: state.version,
    toolClassificationVersion: TOOL_CLASSIFICATION_VERSION,
    degradedGlobal: false,
    degradedAgents,
    config,
    sourceMap: state,
    byUserId,
    v1PrefixSourceCounts
  };

  // Spec 98 §8.4 — record global recover, first enter, and subsequent scope changes.
  if (previousDegradedGlobal) {
    await recordPolicyDegradeEvent({
      changeType: "policy_degraded_recover",
      degradedGlobal: false,
      degradedAgents: nextAgents,
      policyVersion,
      addedAgents,
      removedAgents
    });
  }
  if (addedAgents.length > 0 || removedAgents.length > 0) {
    if (degradedAgents.size === 0 && previousAgents.size > 0 && !previousDegradedGlobal) {
      await recordPolicyDegradeEvent({
        changeType: "policy_degraded_recover",
        degradedGlobal: false,
        degradedAgents: nextAgents,
        policyVersion,
        addedAgents,
        removedAgents,
        errorReason: "agent_compile_recovered"
      });
    } else if (degradedAgents.size > 0) {
      await recordPolicyDegradeEvent({
        changeType: previousAgents.size === 0 ? "policy_degraded_enter" : "policy_degraded_scope_changed",
        degradedGlobal: false,
        degradedAgents: nextAgents,
        policyVersion,
        addedAgents,
        removedAgents,
        errorReason: "agent_compile_failed"
      });
    }
  }
  return getPolicyRuntimeStatus();
}

/**
 * Spec 98 §8 — compile access.yaml + source map, compute policyVersion, atomically swap runtime.
 * On unparseable YAML: set degradedGlobal (DataPlane fail-closed).
 * Concurrent callers are queued (not coalesced) so each Admin write can ack against its digest.
 */
export async function commitEffectivePolicy(): Promise<PolicyRuntimeStatus> {
  const run = commitTail.then(() => commitEffectivePolicyUnlocked());
  commitTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Spec 98 §8.2 — hot path reads only the committed EffectivePolicy reference.
 * Does not parse YAML or rebuild source map. Recovery recompile runs only when
 * runtime is missing or already in global degrade (external fix / startup).
 */
async function ensurePolicyRuntime(): Promise<EffectivePolicySnapshot> {
  if (!effectivePolicyRef || effectivePolicyRef.degradedGlobal) {
    await commitEffectivePolicy();
  }
  return effectivePolicyRef!;
}

// ─── ACL check ────────────────────────────────────────────────────────────────

/**
 * Spec 98 §5.2 — per requested source, require (tool, sourceKey) ∈ EffectiveDataCapabilities.
 * Returns the deny reason, or undefined when the capability exists.
 */
function capabilityDenyReason(
  toolName: string,
  table: string,
  permissions: EffectivePermissions,
  state: SourceMapState,
  connectionId: string | undefined
): string | undefined {
  const normalizedTable = normalizeRef(table);
  const entry = lookupReverse(normalizedTable, state, connectionId);
  const resolvedConnection = entry?.connectionId ?? normalizeRef(connectionId ?? "");
  const key = sourceIndexKey(resolvedConnection, normalizedTable);

  if (permissions.capabilities.some((capability) =>
    capability.tool === toolName && sourceIndexKey(capability.connectionId, capability.physicalTable) === key
  )) {
    return undefined;
  }
  // Legacy allow blocks may grant tables that never made it into the source map.
  if (permissions.legacyAllow && permissions.tables.includes(normalizedTable)) return undefined;

  const grantedForOtherTool = permissions.capabilities.some(
    (capability) => sourceIndexKey(capability.connectionId, capability.physicalTable) === key
  );
  if (!grantedForOtherTool) return `table_forbidden:${normalizedTable}`;

  const display = canonicalSourceKeyDisplay(entry ?? {
    connectionId: resolvedConnection,
    schema: "",
    sourceName: "",
    physicalTable: normalizedTable
  });
  return `capability_forbidden:${toolName}:${display}`;
}

const ROW_POLICY_UNWRAPPED_TOOLS = new Set([
  "lucy_freshness",
  "lucy_read_source",
  "entity_details",
  "sl_validate"
]);

function resolveCapabilityForTable(
  toolName: string,
  table: string,
  permissions: EffectivePermissions,
  state: SourceMapState,
  connectionId: string | undefined
): EffectiveCapability | undefined {
  const normalizedTable = normalizeRef(table);
  const entry = lookupReverse(normalizedTable, state, connectionId);
  const resolvedConnection = entry?.connectionId ?? normalizeRef(connectionId ?? "");
  const key = sourceIndexKey(resolvedConnection, normalizedTable);
  return permissions.capabilities.find((capability) =>
    capability.tool === toolName && sourceIndexKey(capability.connectionId, capability.physicalTable) === key
  );
}

/**
 * Spec 98 §4.6 / Spec 99 §5 — the single data gate. Every upstream data call must pass through here.
 * Hot path prefers the committed EffectivePolicy snapshot (Spec 98 §8).
 */
export async function authorizeAndRewrite(
  identity: Identity,
  toolName: string,
  args: unknown
): Promise<AclDecision> {
  const runtime = await ensurePolicyRuntime();
  const config = runtime.config;
  const policy = aclPolicy(config);

  const user = config.users.find((u) => u.id === identity.userId);
  if (!user) return { allowed: false, reason: "tool_forbidden" };
  if (user.enabled === false) {
    return { allowed: false, reason: "agent_disabled" };
  }

  // AbsoluteDeny / unclassified (code baseline; YAML cannot remove — U-DENY-01)
  const absoluteOrUnclassified = absoluteDenyOrUnclassifiedReason(toolName);
  if (absoluteOrUnclassified) {
    return { allowed: false, reason: absoluteOrUnclassified };
  }

  // Spec 98 §8.3 — global DataPlane degrade (Meta wiki may still proceed)
  if (runtime.degradedGlobal && isDegradedBlockedTool(toolName)) {
    return { allowed: false, reason: "policy_degraded_deny" };
  }

  // Global deny_tools (YAML dual insurance)
  if (policy.denyTools.has(toolName)) {
    return { allowed: false, reason: "tool_forbidden_global" };
  }

  const resolved = runtime.byUserId.get(identity.userId)
    ?? await resolveEffectivePermissions(identity, config, policy, { sourceMap: runtime.sourceMap });
  if (!resolved.ok) {
    // Per-agent compile failure: keep concrete reason for DataPlane; Wiki Meta remains available.
    if (
      runtime.degradedAgents.has(identity.userId)
      && (toolName === "wiki_search" || toolName === "wiki_read")
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: resolved.reason };
  }
  const { tools: allowedTools, tables: allowedTables, connections } = resolved.permissions;

  // 2. Tool-level check
  if (allowedTools && !allowedTools.includes("*") && !allowedTools.includes(toolName)) {
    return { allowed: false, reason: "tool_forbidden" };
  }
  if (allowedTools.includes("*") && !policy.knownTools.has(toolName)) {
    return { allowed: false, reason: "tool_forbidden" };
  }

  const sourceMap = policy.tableTouchingTools.has(toolName) || policy.sensitiveMetadataTools.has(toolName)
    ? runtime.sourceMap
    : undefined;

  if (sourceMap?.compileError && policy.tableTouchingTools.has(toolName)) {
    return { allowed: false, reason: `source_map_compile_failed:${sourceMap.compileError}` };
  }

  if (policy.sensitiveMetadataTools.has(toolName) && sourceMap && !hasExplicitAccessToAllSensitiveTables(allowedTables, sourceMap, policy.sensitiveTablePrefixes)) {
    return { allowed: false, reason: "sensitive_metadata_forbidden:kx" };
  }

  // 3. Table-level check (only for tools that touch tables)
  if (policy.tableTouchingTools.has(toolName)) {
    const argsRecord = args as Record<string, unknown> | undefined;
    if ((toolName === "lucy_query" || toolName === "lucy_explain_query") && argsRecord && hasRawQueryArg(argsRecord)) {
      return { allowed: false, reason: "raw_query_forbidden" };
    }
    if (connections.length > 0) {
      const requestedConnections = extractConnectionRefs(toolName, args);
      if (requestedConnections.length === 0) {
        return { allowed: false, reason: "unknown_or_forbidden_connection:<missing>" };
      }
      for (const connection of requestedConnections) {
        if (!connections.includes(connection)) {
          return { allowed: false, reason: `unknown_or_forbidden_connection:${connection}` };
        }
      }
    }
    const requested = await extractTables(toolName, args, { sourceMap: runtime.sourceMap });
    // DataPlane / table-touching tools must resolve at least one source unless legacy tables:* .
    // Covers lucy_read_source alias misses that would otherwise zero-iterate the capability loop.
    if (
      requested.length === 0
      && !allowedTables.includes("*")
      && (DATA_PLANE_TOOL_SET.has(toolName) || policy.tableTouchingTools.has(toolName))
    ) {
      if (toolName === "sl_validate" || toolName === "entity_details") {
        if (sourceMap && !hasExplicitAccessToAllSensitiveTables(allowedTables, sourceMap, policy.sensitiveTablePrefixes)) {
          return { allowed: false, reason: "sensitive_metadata_forbidden:kx" };
        }
      }
      return { allowed: false, reason: "explicit_table_required:<empty>" };
    }
    if ((toolName === "sl_validate" || toolName === "entity_details") && requested.length === 0 && sourceMap && !hasExplicitAccessToAllSensitiveTables(allowedTables, sourceMap, policy.sensitiveTablePrefixes)) {
      return { allowed: false, reason: "sensitive_metadata_forbidden:kx" };
    }
    for (const table of requested) {
      if (isSensitiveTable(table, policy.sensitiveTablePrefixes) && !allowedTables.includes(table)) {
        return { allowed: false, reason: `explicit_table_required:${table}` };
      }
    }
    if (!allowedTables.includes("*") && sourceMap) {
      const requestedConnection = argsRecord && typeof argsRecord === "object" && !Array.isArray(argsRecord)
        ? firstString(argsRecord, ["connectionId", "connection_id", "connection", "database"])
        : undefined;
      for (const table of requested) {
        const reason = capabilityDenyReason(toolName, table, resolved.permissions, sourceMap, requestedConnection);
        if (reason) return { allowed: false, reason };
      }

      // Spec 99 §5 — FinalRows / forced_filters after capability allow.
      const scopedSources: Array<{ sourceName: string; grant: Extract<RowGrant, { kind: "scoped" }> }> = [];
      for (const table of requested) {
        const capability = resolveCapabilityForTable(
          toolName,
          table,
          resolved.permissions,
          sourceMap,
          requestedConnection
        );
        if (capability?.rowGrant.kind === "scoped") {
          scopedSources.push({ sourceName: capability.sourceName, grant: capability.rowGrant });
        }
      }
      if (scopedSources.length > 0) {
        if (ROW_POLICY_UNWRAPPED_TOOLS.has(toolName)) {
          return { allowed: false, reason: "row_policy_requires_wrapped_tool" };
        }
        if (toolName === "lucy_query") {
          // BY-02…05 / BY-12…16 — shape fail-closed before proven gate.
          const shapeDeny = validateProtectedLucyQueryArgs(args);
          if (shapeDeny) return { allowed: false, reason: shapeDeny };
          if (!isUpstreamForcedPredicateProven()) {
            return { allowed: false, reason: "row_policy_upstream_unproven" };
          }
          if (scopedSources.length > 1) {
            return { allowed: false, reason: "row_policy_query_shape_forbidden" };
          }
          const primary = scopedSources[0]!;
          const forcedFilters = buildForcedFiltersPayload(primary.grant, primary.sourceName);
          return forcedFilters ? { allowed: true, forcedFilters } : { allowed: true };
        }
        // lucy_explain_query: allow locally without forcedFilters injection.
      }
    }
  }

  return { allowed: true };
}

/** Backward-compatible alias for the canonical gate (Spec 98 §4.6). */
export const check = authorizeAndRewrite;
