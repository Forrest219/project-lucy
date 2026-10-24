import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot, readConnections } from "../project.js";
import { loadContentPaths } from "../paths.js";
import { readAccessRecoveryState } from "../access-recovery.js";
import { stableJson as canonicalStableJson } from "../config-digest.js";
import { countEntryPerf } from "../entry-performance-timing.js";
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
  formatRowPolicyAttribution,
  isUpstreamForcedPredicateProven,
  mergeRowGrants,
  rowGrantDigest,
  validateProtectedLucyQueryArgs,
  type ForcedFiltersPayload,
  type RowGrant,
  type ResolvedRowPolicyPredicate
} from "./row-policy.js";
import {
  compileAgentConstraints,
  compileFinalRowsBySource,
  lookupFinalRows
} from "./agent-constraints.js";

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
  "lucy_begin_question",
  "lucy_skill_search",
  "lucy_skill_read",
  // Spec 162 §7.8 — certified route / template run through lucy_query's ACL.
  "lucy_certified_route",
  "lucy_report_template"
] as const;

const ABSOLUTE_DENY_TOOL_SET = new Set<string>(ABSOLUTE_DENY_TOOLS);
const DATA_PLANE_TOOL_SET = new Set<string>(DATA_PLANE_TOOLS);
const META_TOOL_SET = new Set<string>(META_TOOLS);

/**
 * Business context tools (Wiki / Skill discover + read channels). Spec §4.2: a channel is
 * granted only by the formal Role that lists the tool; object ACL is decided separately
 * (`context-acl.ts`). No Agent receives these implicitly.
 */
export const CONTEXT_TOOLS = [
  "wiki_search",
  "wiki_read",
  "lucy_skill_search",
  "lucy_skill_read"
] as const;
const CONTEXT_TOOL_SET = new Set<string>(CONTEXT_TOOLS);

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
  /**
   * Lucy v0.25 (L25-14) — the schema name exactly as the Manifest file is named on
   * disk (`BIDM.yaml` → `BIDM`). Diagnostics and the Admin preview show this so an
   * operator can locate the file. It NEVER feeds a manifest path: the runtime keeps
   * using the normalized `schema`, which is what makes D-03 (G5) observable instead
   * of silently fixed.
   */
  schemaDisplay?: string;
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

  const built = await buildSourceMapFromDisk(now);
  if (!built) {
    // Keep last-known-good map on transient filesystem/glob failure (fail-closed for ACL).
    if (sourceMapState.forward.size > 0) {
      sourceMapState = { ...sourceMapState, loadedAt: now };
      return sourceMapState;
    }
    sourceMapState = emptySourceMapState(now);
    return sourceMapState;
  }
  sourceMapState = built;
  return sourceMapState;
}

/**
 * Pure source-map build: reads Manifests, never touches the module-level
 * `sourceMapState`. Returns null when the Manifest tree cannot be listed.
 */
async function buildSourceMapFromDisk(now: number): Promise<SourceMapState | null> {
  const paths = await loadContentPaths();
  const semanticLayerDir = paths.semanticLayer;
  countEntryPerf("sourceMapBuilds");

  const schemaFiles: string[] = [];
  try {
    for await (const entry of glob("**/_schema/*.yaml", { cwd: semanticLayerDir })) {
      schemaFiles.push(path.join(semanticLayerDir, entry));
    }
  } catch {
    return null;
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
      const schemaFileName = path.basename(schemaFile, ".yaml");
      const schema = normalizeRef(schemaFileName);
      for (const [sourceName, tableDef] of Object.entries(yaml.tables)) {
        if (!tableDef?.table) continue;
        const normalizedSource = normalizeRef(sourceName);
        const physicalTable = normalizeRef(tableDef.table);
        const entry: SourceMapEntry = {
          physicalTable,
          connectionId,
          schema,
          schemaDisplay: schemaFileName,
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
        // `schemaDisplay` is a diagnostics-only field; it must not move the digest.
        .map(([key, entry]) => [
          key,
          {
            physicalTable: entry.physicalTable,
            connectionId: entry.connectionId,
            schema: entry.schema,
            sourceName: entry.sourceName
          }
        ])
    ))
    .digest("hex")
    .slice(0, 16);

  return {
    forward,
    reverse,
    version,
    loadedAt: now,
    compileError
  };
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
  /** Per-role Meta grants, retained so Skill audience and channel grants cannot be stitched across Roles. */
  roleMetaTools?: Record<string, string[]>;
  capabilityDigest: string;
  sourceMapVersion: string;
  snapshotHash: string;
  rolesJson: unknown;
  resolvedJson: unknown;
  legacyAllow: boolean;
  /**
   * Spec 100 — AgentConstraints per source (connectionId\\0sourceName → AND preds).
   * Missing / empty ⇒ Constraints≡TRUE for all sources (AC-P1 behavior).
   */
  agentConstraintsBySource?: Record<string, ResolvedRowPolicyPredicate[]>;
  /**
   * Spec 100 — FinalRows per source after EffectiveRowGrant AND Constraints (DNF pruned).
   * Hot path / explain use this; capability.rowGrant remains EffectiveRowGrant (OR).
   */
  finalRowsBySource?: Record<string, RowGrant>;
}

// Spec 177 — structured role-compile diagnostic. The spec locks the field
// names: `RoleCompileStep`, `IdentityCompileDiagnostic`, `RoleCompileStatus`,
// and the `stage` enum. The diagnostic lives on the policy-runtime entry for
// every degraded Agent and is written to `access_log.compiler_reason` on a
// request-level denial; the outward MCP error text is unchanged.
export type RoleCompileStatus = "compiled" | "failed" | "not_run";
export type RoleCompileStage =
  | "selector_match"
  | "role_declaration"
  | "tool_classification"
  | "source_scope"
  | "row_grant"
  | "other";

export interface RoleCompileStep {
  roleId: string;
  ordinal: number;
  status: RoleCompileStatus;
  code?: string;
  stage?: RoleCompileStage;
  selectorIndex?: number;
  connectionId?: string;
  schema?: string;
  names?: string[];
  matchCount?: number;
  unmatchedNames?: string[];
}

export interface IdentityCompileDiagnostic {
  declaredRoleIds: string[];
  steps: RoleCompileStep[];
  failedRoleId?: string;
  contentRoot: string;
  contentRootSource: string;
  sourceMapVersion: string;
  sourceMapConnectionIds?: string[];
}

/** Spec 177 — admin/audit JSON for `access_log.compiler_reason`. Not an MCP client body. */
export function formatIdentityCompilerReason(diagnostic: IdentityCompileDiagnostic | undefined): string | undefined {
  if (!diagnostic) return undefined;
  try {
    const json = JSON.stringify(diagnostic);
    if (json.length <= 16_000) return json;
    return JSON.stringify({
      truncated: true,
      failedRoleId: diagnostic.failedRoleId,
      sample: json.slice(0, 16_000)
    });
  } catch {
    return JSON.stringify({ truncated: true, reason: "non_serializable" });
  }
}

export type RoleResolutionResult = {
  ok: true;
  permissions: EffectivePermissions;
  /** Spec 177 — diagnostic is always populated, success or failure. */
  diagnostic: IdentityCompileDiagnostic;
} | {
  ok: false;
  reason: string;
  diagnostic: IdentityCompileDiagnostic;
  failedRoleId?: string;
};

function allowedConnections(user: AccessConfig["users"][number]): string[] {
  const allow = user.allow as { connections?: string[] } | undefined;
  return configList(allow?.connections, [], { normalize: true });
}

function isWildcardList(value: string[] | undefined): boolean {
  return Array.isArray(value) && value.includes("*");
}

function stableJson(value: unknown): string {
  // Lucy v0.25 — one canonicalization for every digest in the system.
  return canonicalStableJson(value);
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
    legacyAllow: input.legacyAllow,
    roleMetaTools: input.roleMetaTools ?? null,
    agentConstraintsBySource: input.agentConstraintsBySource ?? null,
    finalRowsBySource: input.finalRowsBySource ?? null
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

type CompiledRoleResult =
  | { ok: true; role: CompiledRole; selectorTraces: RoleCompileStep[] }
  | { ok: false; reason: string };

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

async function loadEnabledTablesByConnection(): Promise<Map<string, Set<string>>> {
  countEntryPerf("enabledTableReads");
  const root = await resolveProjectRoot();
  const connections = await readConnections(root);
  const map = new Map<string, Set<string>>();
  for (const conn of connections) {
    map.set(
      normalizeRef(conn.id),
      new Set((conn.enabledTables ?? []).map((table) => normalizeRef(table)).filter(Boolean))
    );
  }
  return map;
}

/** lucy_admin follows every configured connection, including ones added later. */
const LUCY_ADMIN_ROLE_ID = "lucy_admin";

function resolveCatalogConnections(
  roleId: string,
  declaredConnections: string[],
  enabledByConnection: Map<string, Set<string>>
): { ok: true; connections: string[] } | { ok: false; reason: string } {
  const wildcard = declaredConnections.includes("*");
  if (wildcard && roleId !== LUCY_ADMIN_ROLE_ID) {
    return { ok: false, reason: `role_resolution_failed:${roleId}:catalog_bound_wildcard_forbidden` };
  }
  if (roleId === LUCY_ADMIN_ROLE_ID) {
    return { ok: true, connections: [...enabledByConnection.keys()] };
  }
  return { ok: true, connections: declaredConnections };
}

/**
 * Spec 182 — shared enabled-table-range membership check. Used by both the
 * `catalog_bound` path and the plain `tableSelectors` path so the two cannot
 * drift. A missing connection entry, an empty `enabled_tables` array, and an
 * absent ktx.yaml connection all collapse to "not in range" — never "all
 * sources on that connection".
 */
function isInEnabledTableRange(
  entry: Pick<SourceMapEntry, "connectionId" | "physicalTable">,
  enabledByConnection: Map<string, Set<string>>
): boolean {
  const enabled = enabledByConnection.get(entry.connectionId);
  if (!enabled) return false;
  return enabled.has(normalizeRef(entry.physicalTable));
}

function catalogBoundSources(
  declaredConnections: string[],
  state: SourceMapState,
  enabledByConnection: Map<string, Set<string>>
): EffectiveSource[] {
  const allowedConnections = new Set(declaredConnections);
  const matches: EffectiveSource[] = [];
  for (const entry of state.forward.values()) {
    if (!allowedConnections.has(entry.connectionId)) continue;
    if (!isInEnabledTableRange(entry, enabledByConnection)) continue;
    matches.push({
      connectionId: entry.connectionId,
      schema: entry.schema,
      sourceName: entry.sourceName,
      table: entry.physicalTable
    });
  }
  return [...new Map(matches.map((source) => [`${source.connectionId}:${source.sourceName}`, source])).values()];
}

async function compileRole(
  roleId: string,
  role: NonNullable<AccessConfig["roles"]>[string] | undefined,
  policy: AclPolicy,
  state: SourceMapState,
  enabledTables: Map<string, Set<string>> | undefined,
  stepOut: RoleCompileStep[] | undefined,
  ordinal: number
): Promise<CompiledRoleResult> {
  const recordStep = (step: Omit<RoleCompileStep, "roleId" | "ordinal">) => {
    if (stepOut) stepOut.push({ roleId, ordinal, ...step });
  };
  const selectorTraces: RoleCompileStep[] = [];
  const failed: CompiledRoleResult = { ok: false, reason: `role_resolution_failed:${roleId}` };
  if (!role?.allow) {
    recordStep({ status: "failed", code: "role_resolution_failed", stage: "role_declaration" });
    return failed;
  }
  if (Object.prototype.hasOwnProperty.call(role, "constraints")) {
    recordStep({ status: "failed", code: "constraints_forbidden_on_role", stage: "role_declaration" });
    return { ok: false, reason: "constraints_forbidden_on_role" };
  }

  const modelVersion = normalizePermissionModelVersion(role);
  if (!modelVersion.ok) {
    recordStep({ status: "failed", code: `role_resolution_failed:${modelVersion.reason}`, stage: "role_declaration" });
    return { ok: false, reason: `role_resolution_failed:${roleId}:${modelVersion.reason}` };
  }

  const roleTools = configList(role.allow.tools, []);
  if (roleTools.length === 0 || roleTools.includes("*")) {
    recordStep({ status: "failed", code: "role_resolution_failed", stage: "role_declaration" });
    return failed;
  }
  for (const tool of roleTools) {
    if (!policy.knownTools.has(tool)) {
      recordStep({ status: "failed", code: "role_resolution_failed", stage: "tool_classification" });
      return failed;
    }
    const absoluteOrUnclassified = absoluteDenyOrUnclassifiedReason(tool);
    if (absoluteOrUnclassified) {
      recordStep({ status: "failed", code: `role_resolution_failed:${absoluteOrUnclassified}`, stage: "tool_classification" });
      return { ok: false, reason: `role_resolution_failed:${roleId}:${absoluteOrUnclassified}` };
    }
  }

  const rawScope = typeof role.allow.source_scope === "string" ? normalizeRef(role.allow.source_scope) : undefined;
  const catalogBound = rawScope === "catalog_bound";
  if (rawScope !== undefined && !catalogBound) {
    recordStep({ status: "failed", code: "role_resolution_failed:invalid_source_scope", stage: "source_scope" });
    return { ok: false, reason: `role_resolution_failed:${roleId}:invalid_source_scope` };
  }
  if (catalogBound && modelVersion.version !== 2) {
    recordStep({ status: "failed", code: "role_resolution_failed:catalog_bound_requires_v2", stage: "source_scope" });
    return { ok: false, reason: `role_resolution_failed:${roleId}:catalog_bound_requires_v2` };
  }

  const selectors = Array.isArray(role.allow.tableSelectors) ? role.allow.tableSelectors : [];
  const declaredConnections = configList(role.allow.connections, [], { normalize: true });
  if (catalogBound && selectors.length > 0) {
    recordStep({ status: "failed", code: "role_resolution_failed:catalog_bound_selectors_forbidden", stage: "source_scope" });
    return { ok: false, reason: `role_resolution_failed:${roleId}:catalog_bound_selectors_forbidden` };
  }
  const adminFollowsAll = catalogBound && roleId === LUCY_ADMIN_ROLE_ID;
  if ((catalogBound || selectors.length > 0 || roleToolsTouchTables(roleTools, policy)) && declaredConnections.length === 0 && !adminFollowsAll) {
    recordStep({ status: "failed", code: "role_resolution_failed", stage: "source_scope" });
    return failed;
  }

  const sourceMatches: EffectiveSource[] = [];
  const sourceGrants = new Map<string, RowGrant>();
  let effectiveConnections = declaredConnections;

  // Spec 182 — load enabled_tables for both `catalog_bound` and plain
  // `tableSelectors` paths so the membership check uses the same input.
  const enabledByConnection = enabledTables ?? (selectors.length > 0 || catalogBound
    ? await loadEnabledTablesByConnection()
    : new Map<string, Set<string>>());

  if (catalogBound) {
    const resolvedConnections = resolveCatalogConnections(roleId, declaredConnections, enabledByConnection);
    if (!resolvedConnections.ok) {
      recordStep({ status: "failed", code: `role_resolution_failed:${resolvedConnections.reason}`, stage: "source_scope" });
      return { ok: false, reason: resolvedConnections.reason };
    }
    effectiveConnections = resolvedConnections.connections;
    const matches = catalogBoundSources(effectiveConnections, state, enabledByConnection);
    if (matches.length === 0) {
      recordStep({ status: "failed", code: "selector_zero_match", stage: "selector_match", matchCount: 0 });
      return failed;
    }
    for (const entry of matches) {
      const key = sourceIndexKey(entry.connectionId, entry.table);
      sourceGrants.set(key, { kind: "all" });
      sourceMatches.push(entry);
    }
  } else {
    for (let selectorIndex = 0; selectorIndex < selectors.length; selectorIndex += 1) {
      const selector = selectors[selectorIndex];
      const versionFailure = selectorVersionFailure(modelVersion.version, selector);
      if (versionFailure) {
        recordStep({ status: "failed", code: `role_resolution_failed:${versionFailure}`, stage: "selector_match", selectorIndex });
        return { ok: false, reason: `role_resolution_failed:${roleId}:${versionFailure}` };
      }
      const rawMatches = [...state.forward.values()].filter((entry) => selectorMatches(selector, entry));
      // Spec 182 — intersect with enabled_tables AFTER selectorMatches and
      // BEFORE the zero-match check. Source-map hit but not in
      // `enabled_tables` of the matching connection is filtered out here.
      const matches = rawMatches.filter((entry) => isInEnabledTableRange(entry, enabledByConnection));
      // Spec 177 — record per-selector details so a partial match can be reviewed
      // without leaking the role's whole selector shape. unmatchedNames covers
      // both names absent from the source map and names filtered out by the
      // enabled-table intersection (Spec 182) so the diagnostic does not
      // silently swallow them.
      const declaredNames = Array.isArray(selector.names) ? selector.names.map((n) => normalizeRef(n)) : undefined;
      const matchedNames = new Set(matches.map((entry) => normalizeRef(entry.sourceName)));
      const matchedPhysical = new Set(matches.map((entry) => normalizeRef(entry.physicalTable)));
      const unmatchedNames = declaredNames && declaredNames.length > 0
        ? declaredNames.filter((name) => !matchedNames.has(name) && !matchedPhysical.has(name))
        : undefined;
      if (matches.length === 0) {
        recordStep({
          status: "failed",
          code: "selector_zero_match",
          stage: "selector_match",
          selectorIndex,
          connectionId: typeof selector.connection === "string" ? normalizeRef(selector.connection) : undefined,
          schema: typeof selector.schema === "string" ? normalizeRef(selector.schema) : undefined,
          names: declaredNames,
          matchCount: 0,
          unmatchedNames
        });
        return failed;
      }

      const rowAccess = typeof selector.row_access === "string" ? normalizeRef(selector.row_access) : "all";
      let multiScoped: Extract<RowGrant, { kind: "scoped" }> | undefined;
      if (rowAccess === "scoped") {
        const compiled = await compileScopedRowGrant(
          selector.row_policy,
          matches.map((entry) => ({
            connectionId: entry.connectionId,
            sourceName: entry.sourceName,
            schema: entry.schema,
            schemaDisplay: entry.schemaDisplay
          }))
        );
        if (!compiled.ok) {
          // Lucy v0.25 (L25-14 §3.5) — the failure reason carries the four-tuple
          // (connection / schema / table / field) and the R5 attribution code, so an
          // operator can tell 「字段不存在」 from 「清单不可用」 / 「目录能力未知」.
          const detail = compiled.attribution
            ? `:row_policy_attribution:${formatRowPolicyAttribution(compiled.attribution)}`
            : "";
          const reason = `${compiled.reason}${detail}`;
          recordStep({ status: "failed", code: `role_resolution_failed:${reason}`, stage: "row_grant", selectorIndex });
          return { ok: false, reason: `role_resolution_failed:${roleId}:${reason}` };
        }
        if (compiled.grant.kind !== "scoped") {
          recordStep({ status: "failed", code: "role_resolution_failed:row_policy_invalid", stage: "row_grant", selectorIndex });
          return { ok: false, reason: `role_resolution_failed:${roleId}:row_policy_invalid` };
        }
        multiScoped = compiled.grant;
      }

      let selectorHadUndeclaredConnection = false;
      for (const entry of matches) {
        // U-CAP-04: a capability source on an undeclared connection is a compile failure.
        if (!declaredConnections.includes(entry.connectionId)) {
          selectorHadUndeclaredConnection = true;
          break;
        }
        const grant: RowGrant = multiScoped
          ? scopedGrantForSource(multiScoped, entry.sourceName)
          : { kind: "all" };
        const key = sourceIndexKey(entry.connectionId, entry.physicalTable);
        const existing = sourceGrants.get(key);
        if (existing && grantDigestToken(existing) !== grantDigestToken(grant)) {
          recordStep({ status: "failed", code: "role_resolution_failed:row_grant_conflict", stage: "row_grant", selectorIndex });
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
      if (selectorHadUndeclaredConnection) {
        recordStep({
          status: "failed",
          code: "role_resolution_failed:undeclared_connection",
          stage: "selector_match",
          selectorIndex,
          connectionId: typeof selector.connection === "string" ? normalizeRef(selector.connection) : undefined,
          schema: typeof selector.schema === "string" ? normalizeRef(selector.schema) : undefined,
          names: declaredNames,
          matchCount: matches.length,
          unmatchedNames
        });
        return failed;
      }
      // Spec 177 — even on the success path, record a per-selector trace so a
      // partial match (some names hit, some don't) is reviewable from the
      // diagnostic. The compiled-role step pushed by the caller still carries
      // the role-level status; this entry is the per-selector detail.
      selectorTraces.push({
        roleId,
        ordinal,
        status: "compiled",
        stage: "selector_match",
        selectorIndex,
        connectionId: typeof selector.connection === "string" ? normalizeRef(selector.connection) : undefined,
        schema: typeof selector.schema === "string" ? normalizeRef(selector.schema) : undefined,
        names: declaredNames,
        matchCount: matches.length,
        ...(unmatchedNames && unmatchedNames.length > 0 ? { unmatchedNames } : {})
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
      declaredConnections: catalogBound ? effectiveConnections : declaredConnections,
      hasSelectors: catalogBound || selectors.length > 0
    },
    selectorTraces
  };
}

/** Role Set resolution: legacy `role: x` ≡ `roles: [x]`; declaring both is fail-closed. Spec 168. */
export function resolveRoleIds(user: { role?: string | null; roles?: unknown }): { ok: true; roleIds: string[] } | { ok: false; reason: string } {
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

async function buildContentRootDiagnostic(): Promise<{ contentRoot: string; contentRootSource: string }> {
  try {
    const paths = await loadContentPaths();
    return { contentRoot: paths.configDir, contentRootSource: paths.source };
  } catch {
    return { contentRoot: "", contentRootSource: "default" };
  }
}

async function resolveEffectivePermissions(
  identity: Identity,
  config: AccessConfig,
  policy: AclPolicy,
  options: { freshSourceMap?: boolean; sourceMap?: SourceMapState; enabledTables?: Map<string, Set<string>> } = {}
): Promise<RoleResolutionResult> {
  const user = config.users.find((u) => u.id === identity.userId);
  const { contentRoot, contentRootSource } = await buildContentRootDiagnostic();
  if (!user) {
    return {
      ok: false,
      reason: "tool_forbidden",
      diagnostic: {
        declaredRoleIds: [],
        steps: [],
        contentRoot,
        contentRootSource,
        sourceMapVersion: ""
      }
    };
  }
  if (user.enabled === false) {
    return {
      ok: false,
      reason: "agent_disabled",
      diagnostic: {
        declaredRoleIds: [],
        steps: [],
        contentRoot,
        contentRootSource,
        sourceMapVersion: ""
      }
    };
  }
  const state = options.sourceMap ?? await loadSourceMap({ fresh: options.freshSourceMap ?? true });
  const sourceMapVersion = state.version;
  const sourceMapConnectionIds = uniqueSorted([...state.forward.values()].map((entry) => entry.connectionId));
  const baseDiagnostic = {
    declaredRoleIds: [] as string[],
    steps: [] as RoleCompileStep[],
    contentRoot,
    contentRootSource,
    sourceMapVersion,
    sourceMapConnectionIds
  };
  if (state.compileError) {
    return {
      ok: false,
      reason: `source_map_compile_failed:${state.compileError}`,
      diagnostic: baseDiagnostic
    };
  }
  const roleSet = resolveRoleIds(user);
  if (!roleSet.ok) {
    return { ok: false, reason: roleSet.reason, diagnostic: baseDiagnostic };
  }

  if (roleSet.roleIds.length === 0) {
    if (Object.prototype.hasOwnProperty.call(user, "constraints")) {
      // Spec 100: constraints require DataPlane capability sources from Role Set.
      return { ok: false, reason: "constraints_source_not_in_capability", diagnostic: baseDiagnostic };
    }
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
        roleMetaTools: { __legacy__: uniqueSorted(meta) },
        capabilityDigest: capabilityDigest(capabilities),
        sourceMapVersion,
        rolesJson: null,
        resolvedJson,
        legacyAllow: true
      }),
      diagnostic: baseDiagnostic
    };
  }

  const compiledRoles: CompiledRole[] = [];
  const steps: RoleCompileStep[] = [];
  for (let ordinal = 0; ordinal < roleSet.roleIds.length; ordinal += 1) {
    const roleId = roleSet.roleIds[ordinal];
    const compiled = await compileRole(roleId, config.roles?.[roleId], policy, state, options.enabledTables, steps, ordinal);
    if (!compiled.ok) {
      // Spec 177 — failed role's step is already appended by compileRole with
      // status="failed"; every subsequent declared role is "not_run".
      for (let i = ordinal + 1; i < roleSet.roleIds.length; i += 1) {
        steps.push({ roleId: roleSet.roleIds[i], ordinal: i, status: "not_run" });
      }
      return {
        ok: false,
        reason: compiled.reason,
        failedRoleId: roleId,
        diagnostic: {
          declaredRoleIds: [...roleSet.roleIds],
          steps,
          failedRoleId: roleId,
          contentRoot,
          contentRootSource,
          sourceMapVersion,
          sourceMapConnectionIds
        }
      };
    }
    compiledRoles.push(compiled.role);
    // Per-selector traces precede the role-level "compiled" step so a partial
    // match (some names hit, some don't) is reviewable from the diagnostic.
    for (const trace of compiled.selectorTraces) {
      steps.push(trace);
    }
    steps.push({ roleId, ordinal, status: "compiled" });
  }

  const capabilities = dedupeCapabilities(
    compiledRoles.flatMap((role) => buildCapabilities(role.dataPlaneTools, role.sources, role.sourceGrants))
  );

  let agentConstraintsBySource: Record<string, ResolvedRowPolicyPredicate[]> | undefined;
  let constraintsMap: Map<string, ResolvedRowPolicyPredicate[]> | undefined;
  const capabilityRefs = capabilities.map((capability) => ({
    connectionId: capability.connectionId,
    sourceName: capability.sourceName,
    schema: capability.schema,
    physicalTable: capability.physicalTable,
    rowGrant: capability.rowGrant
  }));

  if (Object.prototype.hasOwnProperty.call(user, "constraints")) {
    const compiledConstraints = await compileAgentConstraints(
      (user as { constraints?: unknown }).constraints,
      capabilityRefs
    );
    if (!compiledConstraints.ok) {
      return {
        ok: false,
        reason: compiledConstraints.reason,
        diagnostic: {
          declaredRoleIds: [...roleSet.roleIds],
          steps,
          contentRoot,
          contentRootSource,
          sourceMapVersion,
          sourceMapConnectionIds
        }
      };
    }
    constraintsMap = compiledConstraints.constraints.bySource;
    agentConstraintsBySource = Object.fromEntries(constraintsMap.entries());
  }

  // Spec 100 §5 — FinalRows AND (DNF prune) for every capability source.
  const compiledFinalRows = compileFinalRowsBySource(capabilityRefs, constraintsMap);
  if (!compiledFinalRows.ok) {
    return {
      ok: false,
      reason: compiledFinalRows.reason,
      diagnostic: {
        declaredRoleIds: [...roleSet.roleIds],
        steps,
        contentRoot,
        contentRootSource,
        sourceMapVersion,
        sourceMapConnectionIds
      }
    };
  }
  const finalRowsBySource = compiledFinalRows.finalRowsBySource;

  const capabilityTools = new Set(capabilities.map((capability) => capability.tool));
  const metaTools = uniqueSorted(compiledRoles.flatMap((role) => role.metaTools));
  const roleMetaTools = Object.fromEntries(
    compiledRoles.map((role) => [role.roleId, uniqueSorted(role.metaTools)])
  );
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
  const resolvedJson = {
    tools,
    deniedTools,
    connections,
    tables,
    sources,
    capabilities,
    roleMetaTools,
    sourceMapVersion,
    agentConstraintsBySource: agentConstraintsBySource ?? null,
    finalRowsBySource
  };

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
      roleMetaTools,
      capabilityDigest: capabilityDigest(capabilities),
      sourceMapVersion,
      rolesJson,
      resolvedJson,
      legacyAllow: false,
      agentConstraintsBySource,
      finalRowsBySource
    }),
    diagnostic: {
      declaredRoleIds: [...roleSet.roleIds],
      steps,
      contentRoot,
      contentRootSource,
      sourceMapVersion,
      sourceMapConnectionIds
    }
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
    return {
      ok: false,
      reason: "policy_degraded_deny",
      diagnostic: {
        declaredRoleIds: [],
        steps: [],
        contentRoot: "",
        contentRootSource: "default",
        sourceMapVersion: runtime.sourceMap.version,
        sourceMapConnectionIds: uniqueSorted([...runtime.sourceMap.forward.values()].map((entry) => entry.connectionId))
      }
    };
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

/**
 * Spec 100 / Spec 14 §0.0a — Admin dryRun / save preview for a candidate Agent
 * (including `constraints`) without writing access.yaml.
 */
export async function previewAgentPermissionsForAdmin(
  user: AccessConfig["users"][number],
  options: {
    freshSourceMap?: boolean;
    roleOverrides?: AccessConfig["roles"];
  } = {}
): Promise<RoleResolutionResult> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  const previewConfig: AccessConfig = {
    ...config,
    roles: options.roleOverrides
      ? {
          ...(config.roles ?? {}),
          ...options.roleOverrides
        }
      : config.roles,
    users: [
      ...config.users.filter((existing) => existing.id !== user.id),
      user
    ]
  };
  return resolveEffectivePermissions(
    { userId: user.id, tokenLabel: "admin-preview", tokenHashPrefix: "admin-preview" },
    previewConfig,
    policy,
    { freshSourceMap: options.freshSourceMap ?? true }
  );
}

/**
 * Lucy v0.25 (L25-14 §3.2) — does a source-map entry match the table identity the
 * Admin asked for?
 *
 * The comparison is case-insensitive on the schema, exactly like the runtime's
 * selector matching: the source map lower-cases the schema name when it reads the
 * Manifest file names, so a requested `BIDM` must still find the entry that carries
 * `bidm`. The entry's `schemaDisplay` keeps the on-disk case for diagnostics.
 */
export function sourceMapEntryMatchesTable(
  entry: SourceMapEntry,
  table: { connection: string; schema: string; name: string }
): boolean {
  const connection = normalizeRef(table.connection);
  const schema = normalizeRef(table.schema);
  const name = normalizeRef(table.name);
  if (entry.connectionId !== connection) return false;
  if (entry.schema !== schema) return false;
  return entry.sourceName === name || entry.physicalTable === name;
}

/**
 * Lucy v0.25 (L25-14 §3.2 / §5.3) — read-only preview entry point.
 *
 * Resolves ONE subject against an in-memory CANDIDATE configuration through the
 * runtime's own compile path (`resolveEffectivePermissions`). Nothing is written,
 * the committed policy is not swapped in, and no second permission algebra is
 * introduced: the preview and the runtime share this exact function.
 *
 * The candidate is built by the caller (draft overlaid on the current config) and
 * is never read back from disk, so a preview can never describe a stale baseline.
 */
export async function previewSubjectPermissionsForCandidate(
  candidate: AccessConfig,
  subject: {
    userId: string;
    name?: string;
    enabled?: boolean;
    role?: string;
    roles?: string[];
    constraints?: unknown;
  },
  options: {
    freshSourceMap?: boolean;
    sourceMap?: SourceMapState;
    enabledTables?: Map<string, Set<string>>;
  } = {}
): Promise<RoleResolutionResult> {
  const policy = aclPolicy(candidate);
  const previewUser = {
    id: subject.userId,
    name: subject.name ?? subject.userId,
    enabled: subject.enabled ?? true,
    ...(subject.role !== undefined ? { role: subject.role } : {}),
    ...(subject.roles !== undefined ? { roles: subject.roles } : {}),
    ...(subject.constraints !== undefined ? { constraints: subject.constraints } : {}),
    tokens: []
  } as AccessConfig["users"][number];
  const previewConfig: AccessConfig = {
    ...candidate,
    users: [...candidate.users.filter((user) => user.id !== subject.userId), previewUser]
  };
  return resolveEffectivePermissions(
    { userId: subject.userId, tokenLabel: "admin-preview", tokenHashPrefix: "admin-preview" },
    previewConfig,
    policy,
    {
      freshSourceMap: options.freshSourceMap ?? true,
      sourceMap: options.sourceMap,
      enabledTables: options.enabledTables
    }
  );
}

/**
 * Spec 174 §3.1 — read-only inputs for one Admin display batch. Built from
 * pure reads: it never updates the identity config cache, `sourceMapState`
 * or the committed EffectivePolicy, so display preparation cannot change
 * runtime authorization.
 */
export interface AdminPermissionContext {
  config: AccessConfig;
  sourceMap: SourceMapState;
  enabledTables: Map<string, Set<string>>;
  accessConfigDigest: string;
  sourceMapVersion: string;
  enabledTablesDigest: string;
  toolClassificationVersion: string;
}

export async function buildAdminPermissionContext(config: AccessConfig): Promise<AdminPermissionContext> {
  const [built, enabledTables] = await Promise.all([
    buildSourceMapFromDisk(Date.now()),
    loadEnabledTablesByConnection()
  ]);
  const sourceMap = built ?? emptySourceMapState(Date.now(), "source_map_unavailable");
  return {
    config,
    sourceMap,
    enabledTables,
    accessConfigDigest: computeAccessConfigDigest(config),
    sourceMapVersion: sourceMap.version,
    enabledTablesDigest: computeEnabledTablesDigest(enabledTables),
    toolClassificationVersion: TOOL_CLASSIFICATION_VERSION
  };
}

/** Spec 174 §3.1 — one context, the existing per-Agent resolver for every id. */
export async function resolveEffectivePermissionsBatchForAdmin(
  userIds: string[],
  context: AdminPermissionContext
): Promise<Map<string, RoleResolutionResult>> {
  const policy = aclPolicy(context.config);
  const results = new Map<string, RoleResolutionResult>();
  for (const userId of userIds) {
    results.set(userId, await resolveEffectivePermissions(
      { userId, tokenLabel: "admin-preview", tokenHashPrefix: "admin-preview" },
      context.config,
      policy,
      { sourceMap: context.sourceMap, enabledTables: context.enabledTables }
    ));
  }
  return results;
}

/** Spec 174 §3.3 — the compile inputs a display permission result was derived from. */
export type DisplayPolicyInputs = Pick<
  AdminPermissionContext,
  "accessConfigDigest" | "sourceMapVersion" | "enabledTablesDigest" | "toolClassificationVersion"
>;

export function displayPolicyInputsOf(context: AdminPermissionContext): DisplayPolicyInputs {
  return {
    accessConfigDigest: context.accessConfigDigest,
    sourceMapVersion: context.sourceMapVersion,
    enabledTablesDigest: context.enabledTablesDigest,
    toolClassificationVersion: context.toolClassificationVersion
  };
}

/**
 * Spec 174 §3.3 — whether the *currently* committed runtime policy was
 * compiled from the same access / source map / enabled tables / classifier
 * inputs and is not degraded. Read-only (never commits); evaluated at each
 * response so cached display results follow runtime commits and degrades.
 */
export function runtimeConsistencyForInputs(inputs: DisplayPolicyInputs | null): "matched" | "unconfirmed" {
  if (!inputs) return "unconfirmed";
  const status = getPolicyRuntimeStatus();
  const matched = status.policyVersion !== ""
    && !status.degradedGlobal
    && status.degradedAgents.length === 0
    && status.accessConfigDigest === inputs.accessConfigDigest
    && status.sourceMapVersion === inputs.sourceMapVersion
    && status.enabledTablesDigest === inputs.enabledTablesDigest
    && effectivePolicyRef?.toolClassificationVersion === inputs.toolClassificationVersion;
  return matched ? "matched" : "unconfirmed";
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

  const listed = uniqueSorted(tools.filter((tool) => {
    if (absoluteDenyOrUnclassifiedReason(tool)) return false;
    if (!policy.knownTools.has(tool) || policy.denyTools.has(tool)) return false;
    // Spec 98 §8.5 — global degrade hides DataPlane / data Meta from listTools; Wiki may remain.
    if (runtime.degradedGlobal && isDegradedBlockedTool(tool)) return false;
    const wildcardTables = resolved.permissions.tables.includes("*");
    // P-GATE-03: DataPlane visible iff ≥1 capability — except legacy tables:* (capability list empty by design).
    if (DATA_PLANE_TOOL_SET.has(tool)) return wildcardTables || capabilityTools.has(tool);
    if (CONTEXT_TOOL_SET.has(tool)) return resolved.permissions.roleIds.length > 0 && !resolved.permissions.legacyAllow;
    if (tool.startsWith("lucy_") || tool === "kx_catalog") {
      return wildcardTables || resolved.permissions.capabilities.length > 0;
    }
    return true;
  }));
  return uniqueSorted(listed);
}

// ─── EffectivePolicy compile / submit (Spec 98 §8 / WP-I5) ───────────────────

/** Spec 177 — one degraded identity. `reason` stays the machine string; `diagnostic` is optional detail. The Admin UI turns `reason` into repair copy. */
export interface PolicyDegradeIssue {
  agentId: string;
  /** Machine reason. The Admin UI turns this into repair copy. */
  reason: string;
  diagnostic?: IdentityCompileDiagnostic;
}

export interface PolicyRuntimeStatus {
  policyVersion: string;
  degradedGlobal: boolean;
  degradedAgents: string[];
  /** Per-agent compile failure, or one global issue when the config cannot be read. Spec 177 adds `diagnostic` on identity failures. */
  issues: PolicyDegradeIssue[];
  accessConfigDigest: string;
  sourceMapVersion: string;
  /** Spec 131 — sha256 of normalized connections→enabled_tables; feeds policyVersion. */
  enabledTablesDigest: string;
}

interface EffectivePolicySnapshot {
  policyVersion: string;
  accessConfigDigest: string;
  sourceMapVersion: string;
  toolClassificationVersion: string;
  enabledTablesDigest: string;
  degradedGlobal: boolean;
  degradedAgents: Set<string>;
  config: AccessConfig;
  sourceMap: SourceMapState;
  byUserId: Map<string, RoleResolutionResult>;
  /** Spec 131 — expandable Roles (v1 prefix / catalog_bound): canonical source keys at last commit. */
  expandableScopeSourceKeys: Map<string, Set<string>>;
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

/** Spec 131 — enabled_tables digest participates in policyVersion for catalog_bound. */
export function computeEnabledTablesDigest(enabledByConnection: Map<string, Set<string>>): string {
  const normalized: Record<string, string[]> = {};
  for (const connectionId of [...enabledByConnection.keys()].sort((a, b) => a.localeCompare(b))) {
    normalized[connectionId] = [...(enabledByConnection.get(connectionId) ?? [])].sort((a, b) => a.localeCompare(b));
  }
  return createHash("sha256").update(stableJson(normalized)).digest("hex");
}

export function computePolicyVersion(
  accessConfigDigest: string,
  sourceMapVersion: string,
  toolClassificationVersion: string = TOOL_CLASSIFICATION_VERSION,
  enabledTablesDigest: string = ""
): string {
  return createHash("sha256")
    .update(`${accessConfigDigest}||${sourceMapVersion}||${toolClassificationVersion}||${enabledTablesDigest}`)
    .digest("hex");
}

function policyDegradeIssues(snapshot: EffectivePolicySnapshot | null): PolicyDegradeIssue[] {
  if (!snapshot) return [];
  if (snapshot.degradedGlobal) {
    return [{ agentId: "", reason: "access_config_unreadable" }];
  }
  const issues: PolicyDegradeIssue[] = [];
  for (const agentId of [...snapshot.degradedAgents].sort()) {
    const resolved = snapshot.byUserId.get(agentId);
    if (!resolved || resolved.ok) {
      issues.push({ agentId, reason: "agent_compile_failed" });
      continue;
    }
    issues.push({
      agentId,
      reason: resolved.reason,
      ...(resolved.diagnostic ? { diagnostic: resolved.diagnostic } : {})
    });
  }
  return issues;
}

export function getPolicyRuntimeStatus(): PolicyRuntimeStatus {
  return {
    policyVersion: effectivePolicyRef?.policyVersion ?? "",
    degradedGlobal: effectivePolicyRef?.degradedGlobal ?? false,
    degradedAgents: effectivePolicyRef ? [...effectivePolicyRef.degradedAgents].sort() : [],
    issues: policyDegradeIssues(effectivePolicyRef),
    accessConfigDigest: effectivePolicyRef?.accessConfigDigest ?? "",
    sourceMapVersion: effectivePolicyRef?.sourceMapVersion ?? "",
    enabledTablesDigest: effectivePolicyRef?.enabledTablesDigest ?? ""
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

function expandableScopeSourceKeys(
  config: AccessConfig,
  state: SourceMapState,
  enabledByConnection?: Map<string, Set<string>>
): Map<string, Set<string>> {
  const keysByRole = new Map<string, Set<string>>();
  for (const [roleId, role] of Object.entries(config.roles ?? {})) {
    const modelVersion = normalizePermissionModelVersion(role);
    if (!modelVersion.ok) continue;
    const scope = typeof role?.allow?.source_scope === "string" ? normalizeRef(role.allow.source_scope) : undefined;
    if (scope === "catalog_bound") {
      if (modelVersion.version !== 2 || !enabledByConnection) continue;
      const declaredConnections = configList(role?.allow?.connections, [], { normalize: true });
      if (declaredConnections.includes("*") && roleId !== LUCY_ADMIN_ROLE_ID) continue;
      const resolved = roleId === LUCY_ADMIN_ROLE_ID
        ? [...enabledByConnection.keys()]
        : declaredConnections;
      if (resolved.length === 0) continue;
      const keys = new Set(
        catalogBoundSources(resolved, state, enabledByConnection).map((source) =>
          canonicalSourceKeyDisplay({
            connectionId: source.connectionId,
            schema: source.schema,
            sourceName: source.sourceName,
            physicalTable: source.table
          })
        )
      );
      keysByRole.set(roleId, keys);
      continue;
    }
    if (modelVersion.version !== 1) continue;
    const selectors = Array.isArray(role.allow?.tableSelectors) ? role.allow.tableSelectors : [];
    const keys = new Set<string>();
    let hasPrefix = false;
    for (const selector of selectors) {
      if (selector?.prefix === undefined) continue;
      hasPrefix = true;
      for (const entry of state.forward.values()) {
        if (!selectorMatches(selector, entry)) continue;
        keys.add(canonicalSourceKeyDisplay(entry));
      }
    }
    if (hasPrefix) keysByRole.set(roleId, keys);
  }
  return keysByRole;
}

async function emitPolicyScopeExpanded(
  roleId: string,
  beforeKeys: Set<string>,
  afterKeys: Set<string>,
  sourceMapVersion: string
): Promise<void> {
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).sort((a, b) => a.localeCompare(b));
  const removed = [...beforeKeys].filter((key) => !afterKeys.has(key)).sort((a, b) => a.localeCompare(b));
  console.warn(
    `[acl] policy_scope_expanded roleId=${roleId} sourcesBefore=${beforeKeys.size} sourcesAfter=${afterKeys.size} added=${added.length} sourceMapVersion=${sourceMapVersion}`
  );
  try {
    const { recordConfigChange } = await import("../admin/audit.js");
    await recordConfigChange({
      filePath: "webui/config/access.yaml",
      changeType: "policy_scope_expanded",
      actorType: "system",
      source: "acl_policy_compile",
      assetKind: "governance",
      targetId: roleId,
      writeStatus: "committed",
      oldSummary: { sourcesBefore: beforeKeys.size, sourceMapVersion, keys: [...beforeKeys].sort() },
      newSummary: { sourcesAfter: afterKeys.size, sourceMapVersion, added, removed, keys: [...afterKeys].sort() }
    });
  } catch (err) {
    console.error("[acl] failed to record policy_scope_expanded", err);
  }
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
      enabledTablesDigest: previous?.enabledTablesDigest ?? "",
      degradedGlobal: true,
      degradedAgents: new Set(),
      config: previous?.config ?? { users: [] },
      sourceMap: previous?.sourceMap ?? emptySourceMapState(Date.now()),
      byUserId: previous?.byUserId ?? new Map(),
      expandableScopeSourceKeys: previous?.expandableScopeSourceKeys ?? new Map()
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

  // Lucy v0.25 (L25-14 §5.3) — an unresolved access-config recovery must fail closed
  // even when the file parses: the on-disk state is not known to be the intended one,
  // so the data plane must not serve rows under an unverified policy.
  const recoveryState = await readAccessRecoveryState(await resolveProjectRoot());
  if (recoveryState.required) {
    const recoveryDegraded: EffectivePolicySnapshot = {
      policyVersion: previous?.policyVersion ?? "",
      accessConfigDigest: previous?.accessConfigDigest ?? "",
      sourceMapVersion: previous?.sourceMapVersion ?? "",
      toolClassificationVersion: TOOL_CLASSIFICATION_VERSION,
      enabledTablesDigest: previous?.enabledTablesDigest ?? "",
      degradedGlobal: true,
      degradedAgents: new Set(),
      config: previous?.config ?? { users: [] },
      sourceMap: previous?.sourceMap ?? emptySourceMapState(Date.now()),
      byUserId: previous?.byUserId ?? new Map(),
      expandableScopeSourceKeys: previous?.expandableScopeSourceKeys ?? new Map()
    };
    effectivePolicyRef = recoveryDegraded;
    console.error(
      `[acl] policy_degraded_global: access config recovery required (${recoveryState.reason ?? "unknown"})`
    );
    if (!previous?.degradedGlobal) {
      await recordPolicyDegradeEvent({
        changeType: "policy_degraded_enter",
        degradedGlobal: true,
        degradedAgents: [],
        policyVersion: recoveryDegraded.policyVersion,
        errorReason: `access_recovery_required:${recoveryState.reason ?? "unknown"}`
      });
    }
    return getPolicyRuntimeStatus();
  }

  primeAccessConfigCache(config, configPath);
  const state = await loadSourceMap({ fresh: true });
  const policy = aclPolicy(config);
  const accessConfigDigest = computeAccessConfigDigest(config);
  const enabledByConnection = await loadEnabledTablesByConnection();
  const enabledTablesDigest = computeEnabledTablesDigest(enabledByConnection);
  const policyVersion = computePolicyVersion(
    accessConfigDigest,
    state.version,
    TOOL_CLASSIFICATION_VERSION,
    enabledTablesDigest
  );
  const expandableScopeKeys = expandableScopeSourceKeys(config, state, enabledByConnection);

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
    enabledTablesDigest,
    degradedGlobal: false,
    degradedAgents,
    config,
    sourceMap: state,
    byUserId,
    expandableScopeSourceKeys: expandableScopeKeys
  };

  // Spec 131 P2-5 — emit expansion audit only after successful atomic switch; compare key sets.
  if (previous && !previous.degradedGlobal) {
    for (const [roleId, afterKeys] of expandableScopeKeys) {
      const beforeKeys = previous.expandableScopeSourceKeys.get(roleId) ?? new Set<string>();
      const added = [...afterKeys].filter((key) => !beforeKeys.has(key));
      if (added.length > 0) {
        await emitPolicyScopeExpanded(roleId, beforeKeys, afterKeys, state.version);
      }
    }
  }

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

/** T04-1 — role facts established at admission; T05 reads them for the context gate. */
export type AdmissionSubject = {
  roleIds: string[];
  /** No formal role, but a valid pre-role `allow.tools` block (data plane only). */
  legacyDirectAllow: boolean;
};

function hasLegacyDirectAllow(user: { allow?: unknown }): boolean {
  const allow = user.allow;
  if (!allow || typeof allow !== "object" || Array.isArray(allow)) return false;
  const tools = (allow as { tools?: unknown }).tools;
  return Array.isArray(tools) && tools.some((tool) => typeof tool === "string" && tool.trim() !== "");
}

/**
 * T0A-3 / T04-1 — entry-level Agent admission. Reads the same committed policy
 * config as `authorizeAndRewrite` (no extra cache) so every MCP method and
 * HTTP verb rejects a disabled Agent, an unresolvable declared role, or an
 * empty identity (no role and no valid direct-allow) before content is produced.
 */
export async function resolveAdmissionSubject(
  userId: string
): Promise<
  | { ok: true; subject: AdmissionSubject }
  | { ok: false; reason: string; diagnostic?: IdentityCompileDiagnostic }
> {
  const runtime = await ensurePolicyRuntime();
  const user = runtime.config.users.find((u) => u.id === userId);
  if (!user) return { ok: false, reason: "agent_unresolved" };
  if (user.enabled === false) return { ok: false, reason: "agent_disabled" };
  const roleSet = resolveRoleIds(user);
  if (!roleSet.ok) return { ok: false, reason: roleSet.reason };
  for (const roleId of roleSet.roleIds) {
    const declared = runtime.config.roles?.[roleId];
    if (!declared || typeof declared !== "object") {
      // Spec 177 — surface a minimal diagnostic so the gate knows it stopped at
      // a declared role without a usable YAML body.
      const { contentRoot, contentRootSource } = await buildContentRootDiagnostic();
      return {
        ok: false,
        reason: `role_resolution_failed:${roleId}`,
        diagnostic: {
          declaredRoleIds: [...roleSet.roleIds],
          steps: [{ roleId, ordinal: roleSet.roleIds.indexOf(roleId), status: "failed", code: "role_resolution_failed:undeclared" }],
          failedRoleId: roleId,
          contentRoot,
          contentRootSource,
          sourceMapVersion: runtime.sourceMap.version,
          sourceMapConnectionIds: uniqueSorted([...runtime.sourceMap.forward.values()].map((entry) => entry.connectionId))
        }
      };
    }
  }
  if (roleSet.roleIds.length > 0) return { ok: true, subject: { roleIds: roleSet.roleIds, legacyDirectAllow: false } };
  if (!hasLegacyDirectAllow(user)) return { ok: false, reason: "role_resolution_failed:no_role_or_direct_allow" };
  return { ok: true, subject: { roleIds: [], legacyDirectAllow: true } };
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
  if (CONTEXT_TOOL_SET.has(toolName)) {
    // Spec §4.1/4.2: a degraded or unresolvable policy cannot prove an ACL → deny; legacy
    // direct-allow has no formal Role → `context_role_required`; otherwise the tool must be
    // listed by one of the caller's Roles (object ACL is decided in the context gate).
    if (!resolved.ok) return { allowed: false, reason: resolved.reason };
    const { roleIds, roleMetaTools, legacyAllow } = resolved.permissions;
    if (legacyAllow || roleIds.length === 0) return { allowed: false, reason: "context_role_required" };
    const granted = roleIds.some((roleId) => roleMetaTools?.[roleId]?.includes(toolName));
    return granted ? { allowed: true } : { allowed: false, reason: "tool_forbidden" };
  }
  if (!resolved.ok) {
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

      // Spec 99 §5 / Spec 100 §5 — FinalRows (EffectiveRowGrant AND Constraints) / forced_filters.
      const protectedSources: Array<{ sourceName: string; grant: Extract<RowGrant, { kind: "scoped" }> }> = [];
      for (const table of requested) {
        const capability = resolveCapabilityForTable(
          toolName,
          table,
          resolved.permissions,
          sourceMap,
          requestedConnection
        );
        if (!capability) continue;
        const finalRows = lookupFinalRows(
          resolved.permissions.finalRowsBySource,
          capability.connectionId,
          capability.sourceName,
          capability.rowGrant
        );
        if (finalRows.kind === "scoped") {
          protectedSources.push({ sourceName: capability.sourceName, grant: finalRows });
        }
      }
      if (protectedSources.length > 0) {
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
          if (protectedSources.length > 1) {
            return { allowed: false, reason: "row_policy_query_shape_forbidden" };
          }
          const primary = protectedSources[0]!;
          const forcedFilters = buildForcedFiltersPayload(primary.grant, primary.sourceName);
          // Spec 100 §7 / Spec 99 — FinalRows≠TRUE must inject; empty payload is fail-closed.
          if (!forcedFilters) {
            return { allowed: false, reason: "row_policy_forced_filters_empty" };
          }
          return { allowed: true, forcedFilters };
        }
        // lucy_explain_query: allow locally without forcedFilters injection.
      }
    }
  }

  return { allowed: true };
}

/** Backward-compatible alias for the canonical gate (Spec 98 §4.6). */
export const check = authorizeAndRewrite;
