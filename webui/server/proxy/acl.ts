import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";
import { getAccessConfig } from "./identity.js";
import type { Identity } from "./identity.js";

export interface AclDecision {
  allowed: boolean;
  reason?: string; // 'tool_forbidden' | 'table_forbidden:<table>' | 'tool_forbidden_global' | 'agent_disabled' | 'raw_query_forbidden' | 'query_concurrency_exceeded' | 'explicit_table_required:<table>' | 'sensitive_metadata_forbidden:kx' | 'unknown_or_forbidden_connection:<connection>' | 'role_resolution_failed:<role>'
}

const DEFAULT_DENY_TOOLS = ["sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status"] as const;

const DEFAULT_KNOWN_TOOLS = [
  "sl_query",
  "sl_read_source",
  "sl_validate",
  "wiki_search",
  "wiki_read",
  "entity_details",
  "dictionary_search",
  "discover_data",
  "connection_list",
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "kx_catalog",
  "lucy_begin_question",
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status"
] as const;

const DEFAULT_TABLE_TOUCHING_TOOLS = ["sl_query", "sl_read_source", "sl_validate", "entity_details", "lucy_read_source", "lucy_query", "lucy_explain_query", "lucy_freshness"] as const;
const DEFAULT_SENSITIVE_METADATA_TOOLS = ["dictionary_search", "discover_data"] as const;
const DEFAULT_SENSITIVE_TABLE_PREFIXES = ["dataforai.kx_"] as const;
const BUILT_IN_TABLE_EXTRACTORS = new Set(["sl_query", "sl_read_source", "sl_validate", "entity_details"]);
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

// ─── sourceName → "schema.table" cache ───────────────────────────────────────

interface SourceMapEntry {
  physicalTable: string; // e.g. "dataforai.superstore_orders"
  connectionId: string;
  schema: string;
  sourceName: string;
}

let sourceMap: Map<string, SourceMapEntry> = new Map();
let sourceMapLoadedAt = 0;
let sourceMapVersion = "";
const SOURCE_MAP_TTL = 60_000;

interface SchemaYaml {
  tables?: Record<string, { table?: string }>;
}

async function loadSourceMap(options: { fresh?: boolean } = {}): Promise<Map<string, SourceMapEntry>> {
  const now = Date.now();
  if (!options.fresh && sourceMap.size > 0 && now - sourceMapLoadedAt < SOURCE_MAP_TTL) return sourceMap;

  const projectRoot = await resolveProjectRoot();
  const semanticLayerDir = path.join(projectRoot, "semantic-layer");

  // Collect all _schema/*.yaml files
  const schemaFiles: string[] = [];
  try {
    for await (const entry of glob("**/_schema/*.yaml", { cwd: semanticLayerDir })) {
      schemaFiles.push(path.join(semanticLayerDir, entry));
    }
  } catch {
    // semantic-layer may not exist yet
    return sourceMap;
  }

  const newMap = new Map<string, SourceMapEntry>();

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
        if (tableDef?.table) {
          const normalizedSource = normalizeRef(sourceName);
          newMap.set(normalizedSource, {
            physicalTable: normalizeRef(tableDef.table),
            connectionId,
            schema,
            sourceName: normalizedSource
          });
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  sourceMap = newMap;
  sourceMapLoadedAt = now;
  sourceMapVersion = createHash("sha256")
    .update(JSON.stringify([...newMap.entries()].sort(([a], [b]) => a.localeCompare(b))))
    .digest("hex")
    .slice(0, 16);
  return sourceMap;
}

function normalizeRef(value: string): string {
  return value.trim().replace(/[`"']/g, "").toLowerCase();
}

function sourceNameToTable(sourceName: string, map: Map<string, SourceMapEntry>): string {
  const normalized = normalizeRef(sourceName);
  return map.get(normalized)?.physicalTable ?? normalized;
}

function sourceMapEntries(map: Map<string, SourceMapEntry>): Array<{ source: string; physical: string }> {
  return [...map.entries()].map(([source, entry]) => ({
    source: normalizeRef(source),
    physical: normalizeRef(entry.physicalTable)
  }));
}

function hasDelimitedRef(text: string, ref: string): boolean {
  if (!ref) return false;
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`).test(normalizeRef(text));
}

function addTableRefsFromText(text: string, tables: Set<string>, map: Map<string, SourceMapEntry>, options: { fallbackUnknown?: boolean } = {}): void {
  const entries = sourceMapEntries(map);
  let matchedKnownRef = false;
  for (const { source, physical } of entries) {
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
  tables.add(sourceNameToTable(candidate, map));
}

function collectTableRefs(value: unknown, tables: Set<string>, map: Map<string, SourceMapEntry>): void {
  if (typeof value === "string") {
    addTableRefsFromText(value, tables, map, { fallbackUnknown: false });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTableRefs(item, tables, map);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectTableRefs(item, tables, map);
  }
}

function collectGenericToolTableRefs(value: unknown, tables: Set<string>, map: Map<string, SourceMapEntry>): void {
  collectTableRefs(value, tables, map);
  collectMetricRefs(value, tables, map);
}

function collectMetricRefs(value: unknown, tables: Set<string>, map: Map<string, SourceMapEntry>): void {
  if (typeof value === "string") {
    addTableRefsFromText(value, tables, map);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMetricRefs(item, tables, map);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectMetricRefs(item, tables, map);
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

function buildReverseSourceMap(map: Map<string, SourceMapEntry>): Map<string, SourceMapEntry> {
  const reverse = new Map<string, SourceMapEntry>();
  for (const entry of map.values()) reverse.set(normalizeRef(entry.physicalTable), entry);
  return reverse;
}

function toSourceRef(
  table: string,
  reverse: Map<string, SourceMapEntry>,
  method: string,
  confidence: "high" | "medium" | "low"
): SourceRef {
  const entry = reverse.get(normalizeRef(table));
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
  const map = await loadSourceMap(options);
  const reverse = buildReverseSourceMap(map);
  const method = structuredExtractionMethod(toolName);
  const confidence: "high" | "medium" = BUILT_IN_TABLE_EXTRACTORS.has(toolName) ? "high" : "medium";
  return tables.map((table) => toSourceRef(table, reverse, method, confidence));
}

/**
 * Resolves a flat list of physical table names (e.g. from raw-query regex sniffing,
 * or from historical access_log.tables during backfill) into structured SourceRef records.
 * Callers own the extraction_method/confidence semantics for their use case; this defaults
 * to the raw-query best-effort tier ('query_ref' / 'low').
 */
export async function resolveSourceRefsForTables(
  tables: string[],
  options: { fresh?: boolean; extractionMethod?: string; confidence?: "high" | "medium" | "low" } = {}
): Promise<SourceRef[]> {
  if (tables.length === 0) return [];
  const map = await loadSourceMap(options);
  const reverse = buildReverseSourceMap(map);
  const method = options.extractionMethod ?? "query_ref";
  const confidence = options.confidence ?? "low";
  return tables.map((table) => toSourceRef(table, reverse, method, confidence));
}

function isSensitiveTable(table: string, prefixes: string[]): boolean {
  const normalized = normalizeRef(table);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function sensitiveTables(map: Map<string, SourceMapEntry>, prefixes: string[]): string[] {
  return [...new Set([...map.values()].map((entry) => entry.physicalTable).filter((table) => isSensitiveTable(table, prefixes)))];
}

function hasExplicitAccessToAllSensitiveTables(allowedTables: string[], map: Map<string, SourceMapEntry>, prefixes: string[]): boolean {
  const required = sensitiveTables(map, prefixes);
  return required.length > 0 && required.every((table) => allowedTables.includes(table));
}

export interface EffectiveSource {
  connectionId: string;
  schema: string;
  sourceName: string;
  table: string;
}

export interface EffectivePermissions {
  roleIds: string[];
  tools: string[];
  tables: string[];
  connections: string[];
  sources: EffectiveSource[];
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

function selectorMatches(
  selector: { connection?: string; schema?: string; prefix?: string; names?: string[] },
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

function sourcesForTables(tables: string[], map: Map<string, SourceMapEntry>): EffectiveSource[] {
  const allowed = new Set(tables.map(normalizeRef));
  return [...map.entries()]
    .filter(([, entry]) => allowed.has(entry.physicalTable))
    .map(([sourceName, entry]) => ({
      connectionId: entry.connectionId,
      schema: entry.schema,
      sourceName,
      table: entry.physicalTable
    }))
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeRef).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

async function resolveEffectivePermissions(
  identity: Identity,
  config: AccessConfig,
  policy: AclPolicy,
  options: { freshSourceMap?: boolean } = {}
): Promise<RoleResolutionResult> {
  const user = config.users.find((u) => u.id === identity.userId);
  if (!user) return { ok: false, reason: "tool_forbidden" };
  if (user.enabled === false) return { ok: false, reason: "agent_disabled" };

  const map = await loadSourceMap({ fresh: options.freshSourceMap ?? true });
  const userRole = typeof user.role === "string" && user.role.trim() ? user.role.trim() : undefined;
  if (!userRole) {
    const tools = configList(user.allow?.tools, []);
    const tables = configList(user.allow?.tables, [], { normalize: true });
    const connections = allowedConnections(user);
    const sources = isWildcardList(tables) ? [] : sourcesForTables(tables, map);
    const resolvedJson = { tools, tables, connections, sources, sourceMapVersion };
    return {
      ok: true,
      permissions: makePermissions({
        roleIds: [],
        tools,
        tables,
        connections,
        sources,
        sourceMapVersion,
        rolesJson: null,
        resolvedJson,
        legacyAllow: true
      })
    };
  }

  const role = config.roles?.[userRole];
  if (!role?.allow) return { ok: false, reason: `role_resolution_failed:${userRole}` };

  const roleTools = configList(role.allow.tools, []);
  if (roleTools.length === 0 || roleTools.includes("*")) return { ok: false, reason: `role_resolution_failed:${userRole}` };
  for (const tool of roleTools) {
    if (!policy.knownTools.has(tool)) return { ok: false, reason: `role_resolution_failed:${userRole}` };
  }

  const selectors = Array.isArray(role.allow.tableSelectors) ? role.allow.tableSelectors : [];
  const connections = configList(role.allow.connections, [], { normalize: true });
  if ((selectors.length > 0 || roleToolsTouchTables(roleTools, policy)) && connections.length === 0) {
    return { ok: false, reason: `role_resolution_failed:${userRole}` };
  }

  const sourceMatches: EffectiveSource[] = [];
  for (const selector of selectors) {
    const matches = [...map.entries()]
      .filter(([, entry]) => selectorMatches(selector, entry))
      .filter(([, entry]) => connections.length === 0 || connections.includes(entry.connectionId))
      .map(([sourceName, entry]) => ({
        connectionId: entry.connectionId,
        schema: entry.schema,
        sourceName,
        table: entry.physicalTable
      }));
    if (matches.length === 0) return { ok: false, reason: `role_resolution_failed:${userRole}` };
    sourceMatches.push(...matches);
  }

  const sources = [...new Map(sourceMatches.map((source) => [`${source.connectionId}:${source.sourceName}`, source])).values()]
    .sort((a, b) => a.sourceName.localeCompare(b.sourceName));
  const tables = uniqueSorted(sources.map((source) => source.table));
  const tools = uniqueSorted(roleTools.filter((tool) => !policy.denyTools.has(tool)));
  const deniedTools = roleTools.filter((tool) => policy.denyTools.has(tool));
  const rolesJson = { [userRole]: role };
  const resolvedJson = { tools, deniedTools, connections, tables, sources, sourceMapVersion };

  return {
    ok: true,
    permissions: makePermissions({
      roleIds: [userRole],
      tools,
      tables,
      connections,
      sources,
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

function addEntityDetailRef(value: unknown, tables: Set<string>, map: Map<string, SourceMapEntry>, options: { depth?: number; directString?: boolean } = {}): void {
  const depth = options.depth ?? 0;
  if (depth > MAX_ENTITY_REF_DEPTH || !value) return;
  if (typeof value === "string") {
    if (options.directString) tables.add(sourceNameToTable(value, map));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) addEntityDetailRef(item, tables, map, { depth: depth + 1, directString: true });
    return;
  }
  if (typeof value !== "object") return;

  const record = value as Record<string, unknown>;

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
  if (directRef) tables.add(sourceNameToTable(directRef, map));

  const schema = firstString(record, ["schema", "schemaName", "schema_name"]);
  const name = firstString(record, ["name", "entityName", "entity_name", "tableName", "table_name"]);
  if (schema && name) tables.add(sourceNameToTable(`${schema}.${name}`, map));

  const kind = firstString(record, ["type", "kind", "entityType", "entity_type"]);
  const typedName = firstString(record, ["name", "id", "entityId", "entity_id"]);
  if (typedName && kind && ["source", "table", "semantic_source", "physical_table"].includes(normalizeRef(kind))) {
    tables.add(sourceNameToTable(typedName, map));
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      addEntityDetailRef(nested, tables, map, { depth: depth + 1 });
    }
  }
}

export async function extractTables(toolName: string, args: unknown, options: { fresh?: boolean } = {}): Promise<string[]> {
  const a = args as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || Array.isArray(a)) return [];

  const map = await loadSourceMap(options);
  const tables = new Set<string>();

  switch (toolName) {
    case "sl_query":
    case "lucy_query":
    case "lucy_explain_query": {
      // measures: ["superstore_orders.total_sales", "sum(superstore_orders.sales)"]
      // dimensions: [{field: "superstore_orders.region"}, ...]
      const sourceName = (a.sourceName ?? a.source_name ?? a.source ?? a.table) as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      collectMetricRefs(a.measures, tables, map);
      for (const d of (a.dimensions as Array<{ field?: string }> | undefined) ?? []) {
        if (d?.field) addTableRefsFromText(d.field, tables, map);
      }
      for (const key of ["filters", "where", "segments", "joins", "join", "orderBy", "order_by", "sort", "sorts", "having", "groupBy", "group_by"]) {
        collectTableRefs(a[key], tables, map);
      }
      break;
    }
    case "sl_read_source":
    case "lucy_read_source":
    case "lucy_freshness": {
      const sourceName = a.sourceName as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      break;
    }
    case "sl_validate": {
      const sourceName = (a.sourceName ?? a.source ?? a.table) as string | undefined;
      if (sourceName) tables.add(sourceNameToTable(sourceName, map));
      break;
    }
    case "entity_details": {
      addEntityDetailRef(a, tables, map);
      addEntityDetailRef(a.entities, tables, map, { directString: true });
      break;
    }
    default:
      collectGenericToolTableRefs(a, tables, map);
      break;
  }

  return [...tables].filter(Boolean);
}

export async function lucyCatalog(identity: Identity): Promise<{
  connections: string[];
  sources: Array<{ connectionId: string; schema: string; sourceName: string; table: string }>;
  examples: string[];
}> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  const resolved = await resolveEffectivePermissions(identity, config, policy);
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
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  return resolveEffectivePermissions(identity, config, policy);
}

export async function permissionSnapshot(identity: Identity): Promise<{
  roleIds: string[];
  hash: string;
  effectiveTablesCount: number;
  rolesJson: unknown;
  resolvedJson: unknown;
} | undefined> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  const resolved = await resolveEffectivePermissions(identity, config, policy);
  if (!resolved.ok) return undefined;
  return {
    roleIds: resolved.permissions.roleIds,
    hash: resolved.permissions.snapshotHash,
    effectiveTablesCount: resolved.permissions.tables.length,
    rolesJson: resolved.permissions.rolesJson,
    resolvedJson: resolved.permissions.resolvedJson
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
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);
  const user = config.users.find((u) => u.id === identity.userId);
  if (!user || user.enabled === false) return [];

  const resolved = await resolveEffectivePermissions(identity, config, policy);
  if (!resolved.ok) return [];

  const tools = resolved.permissions.tools.includes("*")
    ? [...policy.knownTools]
    : resolved.permissions.tools;

  return uniqueSorted(tools.filter((tool) => {
    if (!policy.knownTools.has(tool) || policy.denyTools.has(tool)) return false;
    if (tool.startsWith("lucy_") || tool === "kx_catalog") return resolved.permissions.sources.length > 0;
    return true;
  }));
}

// ─── ACL check ────────────────────────────────────────────────────────────────

export async function check(
  identity: Identity,
  toolName: string,
  args: unknown
): Promise<AclDecision> {
  const config = await getAccessConfig({ fresh: true });
  const policy = aclPolicy(config);

  const user = config.users.find((u) => u.id === identity.userId);
  if (!user) return { allowed: false, reason: "tool_forbidden" };
  if (user.enabled === false) {
    return { allowed: false, reason: "agent_disabled" };
  }

  // 1. Global deny_tools
  if (policy.denyTools.has(toolName)) {
    return { allowed: false, reason: "tool_forbidden_global" };
  }

  const resolved = await resolveEffectivePermissions(identity, config, policy);
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
    ? await loadSourceMap({ fresh: true })
    : undefined;

  if (policy.sensitiveMetadataTools.has(toolName) && sourceMap && !hasExplicitAccessToAllSensitiveTables(allowedTables, sourceMap, policy.sensitiveTablePrefixes)) {
    return { allowed: false, reason: "sensitive_metadata_forbidden:kx" };
  }

  // 3. Table-level check (only for tools that touch tables)
  if (policy.tableTouchingTools.has(toolName)) {
    const argsRecord = args as Record<string, unknown> | undefined;
    if ((toolName === "sl_query" || toolName === "lucy_query" || toolName === "lucy_explain_query") && argsRecord && hasRawQueryArg(argsRecord)) {
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
    const requested = await extractTables(toolName, args, { fresh: true });
    if ((toolName === "sl_query" || toolName === "lucy_query" || toolName === "lucy_explain_query") && requested.length === 0 && !allowedTables.includes("*")) {
      return { allowed: false, reason: "explicit_table_required:<empty>" };
    }
    if (!BUILT_IN_TABLE_EXTRACTORS.has(toolName) && requested.length === 0) {
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
    if (!allowedTables.includes("*")) {
      for (const table of requested) {
        if (!allowedTables.includes(table)) {
          return { allowed: false, reason: `table_forbidden:${table}` };
        }
      }
    }
  }

  return { allowed: true };
}
