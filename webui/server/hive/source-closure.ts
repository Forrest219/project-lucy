/**
 * Hive resolved-source closure builder.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.3
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H3)
 *
 * The builder turns one published generation of a Hive connection's semantic
 * assets into the complete `SourceDefinition` objects the KTX compute layer
 * expects — grain, column overrides, derived columns, excluded columns,
 * segments, joins, hidden/visible columns and all. It never assembles a
 * measures-only stub: a source that loses its grain or its join declarations
 * compiles into a different query than the operator reviewed.
 *
 * Failure policy (Spec §3.3): duplicate names, orphan overlays, missing join
 * targets, unknown references and directory failures are all *explicit
 * errors*. The builder never falls back to the previous snapshot and never
 * reports a partial closure as a success.
 *
 * Naming contract for Hive: the KTX source name doubles as the SQL alias, so
 * it must be a plain identifier and it must be unique inside the connection.
 * Cross-database name clashes are resolved by the canonical Hive source name
 * `<schema>_<table>` — two databases that both contain `orders` become
 * `finance_orders` and `sales_orders`, and they never merge.
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { assertReadable } from "../fs-safe.js";
import { loadContentPaths } from "../paths.js";
import {
  collectHiveColumnRefs,
  expandPhysicalTables,
  parseHiveExpression,
  parseHiveSql,
  type HiveQuery
} from "./ast-check.js";

// ── failure shape ────────────────────────────────────────────────────────────

export type HiveSourceClosureFailureReason =
  | "hive_source_directory_unreadable"
  | "hive_source_manifest_invalid"
  | "hive_source_overlay_invalid"
  | "hive_source_duplicate_name"
  | "hive_source_orphan_overlay"
  | "hive_source_missing_join_target"
  | "hive_source_unknown_reference"
  | "hive_source_dependency_not_allowed"
  | "hive_source_name_mismatch";

export type HiveSourceClosureResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: HiveSourceClosureFailureReason; detail: string };

// ── resolved source shape (mirrors the KTX SourceDefinition contract) ───────

export type HiveColumnType = "string" | "number" | "time" | "boolean";
export type HiveColumnVisibility = "public" | "internal" | "hidden";

export type HiveResolvedColumn = {
  name: string;
  type: HiveColumnType;
  visibility: HiveColumnVisibility;
  role: "time" | "default";
  description?: string;
  descriptions?: Record<string, string>;
  expr?: string;
  natural_granularity?: string;
  constraints?: Record<string, unknown>;
  enum_values?: Record<string, string[]>;
};

export type HiveResolvedJoin = {
  to: string;
  on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  alias?: string;
};

export type HiveResolvedMeasure = {
  name: string;
  expr: string;
  filter?: string;
  segments?: string[];
  description?: string;
};

export type HiveResolvedSegment = {
  name: string;
  expr: string;
  description?: string;
};

export type HiveResolvedSource = {
  /** KTX source name — also the SQL alias. */
  name: string;
  /** Canonical Lucy source key: `connectionId/schema/table`. */
  canonicalKey: string;
  schema: string;
  /** The logical table name inside the schema. */
  tableName: string;
  description?: string;
  descriptions?: Record<string, string>;
  /** Physical `database.table` for table sources (the KTX `table` field). */
  table?: string;
  /** Raw SQL for `sql:` sources. */
  sql?: string;
  grain: string[];
  columns: HiveResolvedColumn[];
  joins: HiveResolvedJoin[];
  measures: HiveResolvedMeasure[];
  segments: HiveResolvedSegment[];
};

export type HiveSourceClosure = {
  connectionId: string;
  /** Digest of the published generation the closure was built from. */
  generation: string;
  sources: HiveResolvedSource[];
  /** Canonical key → KTX source name. */
  sourceNameByCanonicalKey: Map<string, string>;
  /** KTX source name → physical `database.table`. */
  physicalTableBySourceName: Map<string, string>;
  /** Every physical table the closure depends on (including `sql:` sources). */
  physicalTables: string[];
  /** Hidden column names per KTX source name. */
  hiddenColumnsBySourceName: Map<string, string[]>;
  /** CTE names declared inside `sql:` sources — never physical tables. */
  cteNames: string[];
};

// ── published generation input ───────────────────────────────────────────────

export type HiveManifestColumn = {
  name: string;
  type: string;
  pk?: boolean;
  nullable?: boolean;
  descriptions?: Record<string, string>;
  constraints?: Record<string, unknown>;
  enum_values?: Record<string, string[]>;
};

export type HiveManifestJoin = {
  to: string;
  on: string;
  relationship: "many_to_one" | "one_to_many" | "one_to_one";
  source?: string;
};

export type HiveManifestEntry = {
  table: string;
  descriptions?: Record<string, string>;
  columns: HiveManifestColumn[];
  joins?: HiveManifestJoin[];
};

export type HiveOverlayColumn = {
  name: string;
  type?: HiveColumnType;
  expr?: string;
  visibility?: HiveColumnVisibility;
  role?: "time" | "default";
  descriptions?: Record<string, string>;
  natural_granularity?: string;
};

export type HiveOverlay = {
  name?: string;
  descriptions?: Record<string, string>;
  grain?: string[];
  columns?: HiveOverlayColumn[];
  column_overrides?: Array<Record<string, unknown> & { name: string }>;
  exclude_columns?: string[];
  measures?: HiveResolvedMeasure[];
  segments?: HiveResolvedSegment[];
  joins?: HiveResolvedJoin[];
  disable_joins?: string[];
};

/**
 * The overlay after parsing: every list is present (possibly empty), so the
 * composition below never has to re-check for `undefined`.
 */
type HiveResolvedOverlay = {
  name: string;
  descriptions?: Record<string, string>;
  grain: string[];
  columns: HiveOverlayColumn[];
  column_overrides: Array<Record<string, unknown> & { name: string }>;
  exclude_columns: string[];
  measures: HiveResolvedMeasure[];
  segments: HiveResolvedSegment[];
  joins: HiveResolvedJoin[];
  disable_joins: string[];
};

export type HivePublishedGeneration = {
  connectionId: string;
  /** Manifest shards, one per Schema (Hive database). */
  manifests: Array<{ schema: string; tables: Record<string, unknown> }>;
  /** Overlay / standalone documents found next to the manifests. */
  overlays: Array<{ fileName: string; document: unknown }>;
  /** Physical tables the connection enables. */
  enabledTables: readonly string[];
  /** Digest over the raw generation content. */
  generation: string;
};

// ── small helpers ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordOf(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function digestOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/**
 * DB-native type → semantic type.
 *
 * This mapping is the KTX `SourceColumn.type` contract; a resolved source
 * whose type disagrees with the compiler's contract is rejected by the
 * compute layer, so the mapping has to match.
 */
const TYPE_MAP: Record<string, HiveColumnType> = {
  integer: "number", bigint: "number", smallint: "number", numeric: "number",
  decimal: "number", float: "number", double: "number", real: "number",
  int: "number", int2: "number", int4: "number", int8: "number",
  "float4": "number", "float8": "number", "double precision": "number",
  number: "number", tinyint: "number", mediumint: "number",
  timestamp: "time", timestamptz: "time", "timestamp with time zone": "time",
  "timestamp without time zone": "time", timestamp_ntz: "time",
  timestamp_ltz: "time", timestamp_tz: "time", datetime: "time", date: "time",
  time: "time", timetz: "time",
  boolean: "boolean", bool: "boolean"
};

export function mapHiveColumnType(dbType: string): HiveColumnType {
  const normalized = dbType.toLowerCase().split("(")[0]!.trim();
  return TYPE_MAP[normalized] ?? "string";
}

const DESCRIPTION_PRIORITY = ["user", "ai", "dbt", "db"];

function resolveDescription(descriptions: Record<string, string> | undefined): string | undefined {
  if (!descriptions) return undefined;
  for (const source of DESCRIPTION_PRIORITY) {
    const text = descriptions[source];
    if (text) return text;
  }
  for (const text of Object.values(descriptions)) {
    if (text) return text;
  }
  return undefined;
}

/** Canonical Hive source name for a (schema, table) pair. */
export function hiveSourceName(schema: string, table: string): string {
  return `${schema}_${table}`;
}

function canonicalKey(connectionId: string, schema: string, table: string): string {
  return `${connectionId}/${schema}/${table}`;
}

/** Column references used by an expression, split into qualified/unqualified. */
export function expressionColumnRefs(expression: string): string[][] {
  const parsed = parseHiveExpression(expression);
  if (!parsed.ok) return [];
  return collectHiveColumnRefs(parsed.expr);
}

// ── generation reader ────────────────────────────────────────────────────────

const SAFE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Read one published generation of a Hive connection's semantic assets.
 *
 * The Manifest shards (`_schema/<schema>.yaml`) and the overlays
 * (`<source>.yaml`) are read together, and the digest covers both — the
 * closure is therefore built from ONE generation, never from a mixture of two.
 */
export async function readHivePublishedGeneration(
  projectRoot: string,
  connectionId: string,
  options: { enabledTables?: readonly string[] } = {}
): Promise<HiveSourceClosureResult<HivePublishedGeneration>> {
  if (!SAFE_SEGMENT_RE.test(connectionId)) {
    return {
      ok: false,
      reason: "hive_source_directory_unreadable",
      detail: `Connection id '${connectionId}' is not a valid path segment`
    };
  }

  const paths = await loadContentPaths();
  const connectionRel = path.posix.join("semantic-layer", connectionId);

  let schemaFiles: string[];
  try {
    const schemaDir = await assertReadable(paths, projectRoot, path.posix.join(connectionRel, "_schema"));
    schemaFiles = (await readdir(schemaDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: false,
        reason: "hive_source_directory_unreadable",
        detail: `No published semantic assets for connection '${connectionId}'`
      };
    }
    return {
      ok: false,
      reason: "hive_source_directory_unreadable",
      detail: error instanceof Error ? error.message : String(error)
    };
  }

  const manifests: Array<{ schema: string; tables: Record<string, unknown> }> = [];
  for (const fileName of schemaFiles) {
    const schema = fileName.replace(/\.yaml$/, "");
    let text: string;
    try {
      const abs = await assertReadable(
        paths,
        projectRoot,
        path.posix.join(connectionRel, "_schema", fileName)
      );
      text = await readFile(abs, "utf8");
    } catch (error) {
      return {
        ok: false,
        reason: "hive_source_directory_unreadable",
        detail: `Cannot read manifest shard '${fileName}': ${error instanceof Error ? error.message : String(error)}`
      };
    }
    let document: unknown;
    try {
      document = parse(text);
    } catch (error) {
      return {
        ok: false,
        reason: "hive_source_manifest_invalid",
        detail: `Manifest shard '${fileName}' is not valid YAML: ${error instanceof Error ? error.message : String(error)}`
      };
    }
    const tables = recordOf(recordOf(document).tables);
    manifests.push({ schema, tables });
  }

  let overlayFiles: string[];
  try {
    const connectionDir = await assertReadable(paths, projectRoot, connectionRel);
    overlayFiles = (await readdir(connectionDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return {
      ok: false,
      reason: "hive_source_directory_unreadable",
      detail: `Cannot list overlays for connection '${connectionId}': ${error instanceof Error ? error.message : String(error)}`
    };
  }

  const overlays: Array<{ fileName: string; document: unknown }> = [];
  for (const fileName of overlayFiles) {
    try {
      const abs = await assertReadable(paths, projectRoot, path.posix.join(connectionRel, fileName));
      const text = await readFile(abs, "utf8");
      overlays.push({ fileName, document: parse(text) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return {
        ok: false,
        reason: "hive_source_overlay_invalid",
        detail: `Cannot read overlay '${fileName}': ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  const generation = digestOf({
    connectionId,
    manifests: manifests.map((manifest) => ({
      schema: manifest.schema,
      tables: manifest.tables
    })),
    overlays
  });

  return {
    ok: true,
    value: {
      connectionId,
      manifests,
      overlays,
      enabledTables: options.enabledTables ?? [],
      generation
    }
  };
}

// ── closure builder ──────────────────────────────────────────────────────────

function normalizeManifestColumn(raw: unknown): HiveManifestColumn | null {
  const record = recordOf(raw);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (!name || !type) return null;
  return {
    name,
    type,
    pk: record.pk === true,
    nullable: record.nullable !== false,
    descriptions: isRecord(record.descriptions)
      ? (record.descriptions as Record<string, string>)
      : undefined,
    constraints: isRecord(record.constraints)
      ? (record.constraints as Record<string, unknown>)
      : undefined,
    enum_values: isRecord(record.enum_values)
      ? (record.enum_values as Record<string, string[]>)
      : undefined
  };
}

function normalizeManifestJoin(raw: unknown): HiveManifestJoin | null {
  const record = recordOf(raw);
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const on = typeof record.on === "string" ? record.on.trim() : "";
  if (!to || !on) return null;
  const relationship = record.relationship;
  return {
    to,
    on,
    relationship:
      relationship === "one_to_many" || relationship === "one_to_one" || relationship === "many_to_one"
        ? relationship
        : "many_to_one"
  };
}

function projectManifestEntry(
  name: string,
  entry: HiveManifestEntry
): { columns: HiveResolvedColumn[]; grain: string[]; description?: string } {
  const columns: HiveResolvedColumn[] = [];
  for (const column of entry.columns) {
    const type = mapHiveColumnType(column.type);
    columns.push({
      name: column.name,
      type,
      visibility: "public",
      role: type === "time" ? "time" : "default",
      description: resolveDescription(column.descriptions),
      descriptions: column.descriptions,
      constraints: column.constraints,
      enum_values: column.enum_values
    });
  }
  const pkColumns = entry.columns.filter((column) => column.pk).map((column) => column.name);
  const grain = pkColumns.length > 0 ? pkColumns : entry.columns.map((column) => column.name);
  return { columns, grain, description: resolveDescription(entry.descriptions) };
}

function normalizeOverlayMeasure(raw: unknown): HiveResolvedMeasure | null {
  const record = recordOf(raw);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const expr = typeof record.expr === "string" ? record.expr.trim() : "";
  if (!name || !expr) return null;
  const segments = stringList(record.segments);
  return {
    name,
    expr,
    filter: typeof record.filter === "string" ? record.filter : undefined,
    segments: segments.length > 0 ? segments : undefined,
    description: typeof record.description === "string" ? record.description : undefined
  };
}

function normalizeOverlaySegment(raw: unknown): HiveResolvedSegment | null {
  const record = recordOf(raw);
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const expr = typeof record.expr === "string" ? record.expr.trim() : "";
  if (!name || !expr) return null;
  return {
    name,
    expr,
    description: typeof record.description === "string" ? record.description : undefined
  };
}

function normalizeOverlayJoin(raw: unknown): HiveResolvedJoin | null {
  const record = recordOf(raw);
  const to = typeof record.to === "string" ? record.to.trim() : "";
  const on = typeof record.on === "string" ? record.on.trim() : "";
  if (!to || !on) return null;
  const relationship = record.relationship;
  return {
    to,
    on,
    relationship:
      relationship === "one_to_many" || relationship === "one_to_one" || relationship === "many_to_one"
        ? relationship
        : "many_to_one",
    alias: typeof record.alias === "string" ? record.alias : undefined
  };
}

/** Physical tables a `sql:` source depends on, with CTE names excluded. */
export function sqlSourcePhysicalTables(sql: string): { ok: true; tables: string[]; cteNames: string[] } | { ok: false; detail: string } {
  const parsed = parseHiveSql(sql);
  if (!parsed.ok) {
    return { ok: false, detail: parsed.detail };
  }
  const scopes: HiveQuery[] = [];
  const collect = (query: HiveQuery): void => {
    scopes.push(query);
    for (const cte of query.ctes) collect(cte.query);
    if (query.from.kind === "subquery") collect(query.from.query);
    for (const join of query.joins) {
      if (join.ref.kind === "subquery") collect(join.ref.query);
    }
  };
  collect(parsed.statement.query);

  const cteNames = new Set<string>();
  for (const scope of scopes) {
    for (const cte of scope.ctes) cteNames.add(cte.name);
  }

  // A CTE reference is expanded into the physical tables the CTE reads; the
  // CTE name itself is never reported as a physical table.
  const tables = [...new Set(expandPhysicalTables(parsed.statement.query))].sort();

  return { ok: true, tables, cteNames: [...cteNames].sort() };
}

/**
 * Build the complete resolved-source closure for one published generation.
 *
 * Validation performed (each failure is explicit, never a silent drop):
 *  - duplicate source names
 *  - manifest keys that do not follow the Hive source-name convention
 *  - orphan overlays (an overlay without a matching manifest entry)
 *  - missing join targets
 *  - unknown references (grain, measure filter, segment, derived column, join
 *    condition) and columns that neither exist nor are declared as derived
 *  - physical dependencies outside the connection's enabled table scope
 */
export function buildHiveSourceClosure(
  generation: HivePublishedGeneration
): HiveSourceClosureResult<HiveSourceClosure> {
  const sources: HiveResolvedSource[] = [];
  const sourceByName = new Map<string, HiveResolvedSource>();
  const cteNames = new Set<string>();
  const enabled = new Set(generation.enabledTables);

  // ── 1. project the manifest shards ──────────────────────────────────────
  for (const shard of generation.manifests) {
    for (const [key, rawEntry] of Object.entries(shard.tables)) {
      const entry = recordOf(rawEntry);
      const physicalTable = typeof entry.table === "string" ? entry.table.trim() : "";
      if (!physicalTable.includes(".")) {
        return {
          ok: false,
          reason: "hive_source_manifest_invalid",
          detail: `Manifest entry '${shard.schema}.${key}' must declare a qualified 'database.table' physical table`
        };
      }
      const physicalParts = physicalTable.split(".");
      if (physicalParts.length !== 2 || !physicalParts.every((part) => part.length > 0)) {
        return {
          ok: false,
          reason: "hive_source_manifest_invalid",
          detail: `Manifest entry '${shard.schema}.${key}' has an invalid physical table '${physicalTable}'`
        };
      }
      const table = physicalParts[1]!;
      const expectedName = hiveSourceName(shard.schema, table);
      if (key !== expectedName) {
        return {
          ok: false,
          reason: "hive_source_name_mismatch",
          detail: `Manifest entry key '${key}' must be '${expectedName}' for schema '${shard.schema}' and table '${table}'; Hive source names encode the database so that same-named tables in different databases never merge`
        };
      }
      if (sourceByName.has(key)) {
        return {
          ok: false,
          reason: "hive_source_duplicate_name",
          detail: `Duplicate source name '${key}' in the published generation`
        };
      }

      const columns = (Array.isArray(entry.columns) ? entry.columns : [])
        .map(normalizeManifestColumn)
        .filter((column): column is HiveManifestColumn => column !== null);
      if (columns.length === 0) {
        return {
          ok: false,
          reason: "hive_source_manifest_invalid",
          detail: `Manifest entry '${key}' declares no columns`
        };
      }
      const projected = projectManifestEntry(key, {
        table: physicalTable,
        descriptions: isRecord(entry.descriptions)
          ? (entry.descriptions as Record<string, string>)
          : undefined,
        columns,
        joins: (Array.isArray(entry.joins) ? entry.joins : [])
          .map(normalizeManifestJoin)
          .filter((join): join is HiveManifestJoin => join !== null)
      });

      const source: HiveResolvedSource = {
        name: key,
        canonicalKey: canonicalKey(generation.connectionId, shard.schema, table),
        schema: shard.schema,
        tableName: table,
        description: projected.description,
        descriptions: isRecord(entry.descriptions)
          ? (entry.descriptions as Record<string, string>)
          : undefined,
        table: physicalTable,
        grain: projected.grain,
        columns: projected.columns,
        joins: (Array.isArray(entry.joins) ? entry.joins : [])
          .map(normalizeManifestJoin)
          .filter((join): join is HiveManifestJoin => join !== null),
        measures: [],
        segments: []
      };
      sourceByName.set(key, source);
      sources.push(source);
    }
  }

  // ── 2. compose the overlays ─────────────────────────────────────────────
  for (const overlayFile of generation.overlays) {
    const document = recordOf(overlayFile.document);
    const name = typeof document.name === "string" ? document.name.trim() : "";
    if (!name) {
      return {
        ok: false,
        reason: "hive_source_overlay_invalid",
        detail: `Overlay '${overlayFile.fileName}' does not declare a source name`
      };
    }

    const isStandalone = typeof document.sql === "string" && document.sql.trim().length > 0;

    if (isStandalone) {
      // A `sql:` source owns its own physical dependencies.
      const sql = document.sql as string;
      const dependency = sqlSourcePhysicalTables(sql);
      if (!dependency.ok) {
        return {
          ok: false,
          reason: "hive_source_overlay_invalid",
          detail: `The sql source '${name}' is not a parseable Hive statement: ${dependency.detail}`
        };
      }
      if (sourceByName.has(name)) {
        return {
          ok: false,
          reason: "hive_source_duplicate_name",
          detail: `Duplicate source name '${name}': the sql source in '${overlayFile.fileName}' conflicts with an existing source`
        };
      }
      const schema = name.includes("_") ? name.split("_")[0]! : "";
      const table = name.includes("_") ? name.slice(name.indexOf("_") + 1) : name;
      const columns = (Array.isArray(document.columns) ? document.columns : [])
        .map((raw): HiveResolvedColumn | null => {
          const record = recordOf(raw);
          const columnName = typeof record.name === "string" ? record.name.trim() : "";
          if (!columnName) return null;
          const type: HiveColumnType =
            record.type === "number" || record.type === "time" || record.type === "boolean"
              ? record.type
              : "string";
          return {
            name: columnName,
            type,
            visibility:
              record.visibility === "hidden" || record.visibility === "internal"
                ? record.visibility
                : "public",
            role: type === "time" ? "time" : "default",
            description: resolveDescription(
              isRecord(record.descriptions)
                ? (record.descriptions as Record<string, string>)
                : undefined
            ),
            expr: typeof record.expr === "string" ? record.expr : undefined
          };
        })
        .filter((column): column is HiveResolvedColumn => column !== null);
      if (columns.length === 0) {
        return {
          ok: false,
          reason: "hive_source_overlay_invalid",
          detail: `The sql source '${name}' declares no columns`
        };
      }
      const grain = stringList(document.grain);
      if (grain.length === 0) {
        return {
          ok: false,
          reason: "hive_source_overlay_invalid",
          detail: `The sql source '${name}' must declare a non-empty grain`
        };
      }
      for (const tableName of dependency.tables) {
        if (!enabled.has(tableName)) {
          return {
            ok: false,
            reason: "hive_source_dependency_not_allowed",
            detail: `The sql source '${name}' depends on '${tableName}', which is outside the connection's enabled table scope`
          };
        }
      }
      for (const cteName of dependency.cteNames) cteNames.add(cteName);
      const source: HiveResolvedSource = {
        name,
        canonicalKey: canonicalKey(generation.connectionId, schema, table),
        schema,
        tableName: table,
        description: resolveDescription(
          isRecord(document.descriptions)
            ? (document.descriptions as Record<string, string>)
            : undefined
        ),
        sql,
        grain,
        columns,
        joins: (Array.isArray(document.joins) ? document.joins : [])
          .map(normalizeOverlayJoin)
          .filter((join): join is HiveResolvedJoin => join !== null),
        measures: (Array.isArray(document.measures) ? document.measures : [])
          .map(normalizeOverlayMeasure)
          .filter((measure): measure is HiveResolvedMeasure => measure !== null),
        segments: (Array.isArray(document.segments) ? document.segments : [])
          .map(normalizeOverlaySegment)
          .filter((segment): segment is HiveResolvedSegment => segment !== null)
      };
      sourceByName.set(name, source);
      sources.push(source);
      continue;
    }

    const base = sourceByName.get(name);
    if (!base) {
      return {
        ok: false,
        reason: "hive_source_orphan_overlay",
        detail: `Overlay '${overlayFile.fileName}' declares source '${name}', which has no manifest entry`
      };
    }

    const overlay: HiveResolvedOverlay = {
      name,
      descriptions: isRecord(document.descriptions)
        ? (document.descriptions as Record<string, string>)
        : undefined,
      grain: stringList(document.grain),
      columns: (Array.isArray(document.columns) ? document.columns : [])
        .map((raw): HiveOverlayColumn => {
          const record = recordOf(raw);
          return {
            name: typeof record.name === "string" ? record.name.trim() : "",
            type:
              record.type === "number" || record.type === "time" || record.type === "boolean"
                ? record.type
                : undefined,
            expr: typeof record.expr === "string" ? record.expr : undefined,
            visibility:
              record.visibility === "hidden" || record.visibility === "internal"
                ? record.visibility
                : undefined,
            role: record.role === "time" ? "time" : undefined,
            descriptions: isRecord(record.descriptions)
              ? (record.descriptions as Record<string, string>)
              : undefined,
            natural_granularity:
              typeof record.natural_granularity === "string" ? record.natural_granularity : undefined
          };
        })
        .filter((column) => column.name.length > 0),
      column_overrides: (Array.isArray(document.column_overrides)
        ? document.column_overrides
        : []
      ).map((raw) => {
        const record = recordOf(raw);
        return {
          ...record,
          name: typeof record.name === "string" ? record.name.trim() : ""
        };
      }),
      exclude_columns: stringList(document.exclude_columns),
      measures: (Array.isArray(document.measures) ? document.measures : [])
        .map(normalizeOverlayMeasure)
        .filter((measure): measure is HiveResolvedMeasure => measure !== null),
      segments: (Array.isArray(document.segments) ? document.segments : [])
        .map(normalizeOverlaySegment)
        .filter((segment): segment is HiveResolvedSegment => segment !== null),
      joins: (Array.isArray(document.joins) ? document.joins : [])
        .map(normalizeOverlayJoin)
        .filter((join): join is HiveResolvedJoin => join !== null),
      disable_joins: stringList(document.disable_joins)
    };

    const baseColumnNames = new Set(base.columns.map((column) => column.name));

    // exclude_columns / column_overrides must not contradict each other.
    const excluded = new Set(overlay.exclude_columns);
    const overrideNames = new Set(overlay.column_overrides.map((override) => override.name));
    const conflicts = [...overrideNames].filter((name) => excluded.has(name)).sort();
    if (conflicts.length > 0) {
      return {
        ok: false,
        reason: "hive_source_overlay_invalid",
        detail: `Overlay '${name}' excludes and overrides the same column(s): ${conflicts.join(", ")}`
      };
    }
    for (const override of overlay.column_overrides) {
      if (!baseColumnNames.has(override.name)) {
        return {
          ok: false,
          reason: "hive_source_unknown_reference",
          detail: `Overlay '${name}' overrides column '${override.name}', which does not exist on the source`
        };
      }
    }

    // Apply the exclusions, then the overrides, then append derived columns.
    let columns = base.columns.filter((column) => !excluded.has(column.name));
    const columnsByName = new Map(columns.map((column) => [column.name, column]));
    for (const override of overlay.column_overrides) {
      const existing = columnsByName.get(override.name);
      if (!existing) continue;
      const merged: HiveResolvedColumn = { ...existing };
      const descriptions = isRecord(override.descriptions)
        ? (override.descriptions as Record<string, string>)
        : undefined;
      if (descriptions) {
        merged.descriptions = { ...(existing.descriptions ?? {}), ...descriptions };
        merged.description = resolveDescription(merged.descriptions);
      }
      if (override.visibility === "hidden" || override.visibility === "internal") {
        merged.visibility = override.visibility;
      }
      if (override.natural_granularity !== undefined) {
        merged.natural_granularity = String(override.natural_granularity);
      }
      columnsByName.set(override.name, merged);
    }
    columns = [...columnsByName.values()];

    const baseColumnNamesAfterExclusion = new Set(columns.map((column) => column.name));
    for (const derived of overlay.columns) {
      if (baseColumnNames.has(derived.name)) {
        return {
          ok: false,
          reason: "hive_source_overlay_invalid",
          detail: `Overlay '${name}' declares column '${derived.name}', which already exists on the source; use column_overrides to patch an existing column`
        };
      }
      if (baseColumnNamesAfterExclusion.has(derived.name)) {
        return {
          ok: false,
          reason: "hive_source_duplicate_name",
          detail: `Overlay '${name}' declares column '${derived.name}' twice`
        };
      }
      if (!derived.expr) {
        return {
          ok: false,
          reason: "hive_source_overlay_invalid",
          detail: `Overlay '${name}' declares column '${derived.name}' without an 'expr'; a derived column must carry its expression`
        };
      }
      columns.push({
        name: derived.name,
        type: derived.type ?? "string",
        visibility: derived.visibility ?? "public",
        role: derived.role ?? (derived.type === "time" ? "time" : "default"),
        description: resolveDescription(derived.descriptions),
        descriptions: derived.descriptions,
        expr: derived.expr,
        natural_granularity: derived.natural_granularity
      });
      baseColumnNamesAfterExclusion.add(derived.name);
    }

    base.columns = columns;
    if (overlay.grain && overlay.grain.length > 0) base.grain = overlay.grain;
    base.measures = overlay.measures ?? [];
    base.segments = overlay.segments ?? [];
    if (overlay.descriptions) {
      base.descriptions = { ...(base.descriptions ?? {}), ...overlay.descriptions };
      base.description = resolveDescription(base.descriptions);
    }

    // Joins: manifest joins minus the disabled ones, plus the overlay joins.
    const disabled = new Set(overlay.disable_joins.map((value) => value.replace(/\s+/g, " ").trim()));
    const existingJoinKeys = new Set<string>();
    const joins: HiveResolvedJoin[] = [];
    for (const join of base.joins) {
      if (disabled.has(join.on.replace(/\s+/g, " ").trim())) continue;
      joins.push(join);
      existingJoinKeys.add(`${join.to}::${join.on.replace(/\s+/g, " ").trim()}`);
    }
    for (const join of overlay.joins ?? []) {
      const key = `${join.to}::${join.on.replace(/\s+/g, " ").trim()}`;
      if (existingJoinKeys.has(key)) continue;
      joins.push(join);
      existingJoinKeys.add(key);
    }
    base.joins = joins;
  }

  // ── 3. cross-source validation ──────────────────────────────────────────
  for (const source of sources) {
    // Grain must reference existing columns.
    for (const grainColumn of source.grain) {
      if (!source.columns.some((column) => column.name === grainColumn)) {
        return {
          ok: false,
          reason: "hive_source_unknown_reference",
          detail: `Source '${source.name}' declares grain column '${grainColumn}', which does not exist`
        };
      }
    }

    // Join targets must exist in the closure.
    for (const join of source.joins) {
      if (!sourceByName.has(join.to)) {
        return {
          ok: false,
          reason: "hive_source_missing_join_target",
          detail: `Source '${source.name}' joins to '${join.to}', which is not part of the published generation`
        };
      }
    }

    // Column references inside expressions must resolve.
    const aliases = new Map<string, Set<string>>();
    aliases.set(source.name, new Set(source.columns.map((column) => column.name)));
    for (const join of source.joins) {
      const target = sourceByName.get(join.to);
      if (!target) continue;
      aliases.set(join.alias ?? join.to, new Set(target.columns.map((column) => column.name)));
    }

    const checkRefs = (
      expression: string,
      label: string
    ): { ok: false; reason: HiveSourceClosureFailureReason; detail: string } | null => {
      for (const parts of expressionColumnRefs(expression)) {
        if (parts.length === 1) {
          if (!aliases.get(source.name)?.has(parts[0]!)) {
            return {
              ok: false,
              reason: "hive_source_unknown_reference",
              detail: `Source '${source.name}' ${label} references unknown column '${parts[0]}'`
            };
          }
          continue;
        }
        const qualifier = parts[parts.length - 2]!;
        const columnName = parts[parts.length - 1]!;
        const known = aliases.get(qualifier);
        if (!known) {
          return {
            ok: false,
            reason: "hive_source_unknown_reference",
            detail: `Source '${source.name}' ${label} references unknown source '${qualifier}'`
          };
        }
        if (!known.has(columnName)) {
          return {
            ok: false,
            reason: "hive_source_unknown_reference",
            detail: `Source '${source.name}' ${label} references unknown column '${qualifier}.${columnName}'`
          };
        }
      }
      return null;
    };

    for (const measure of source.measures) {
      if (measure.filter) {
        const failure = checkRefs(measure.filter, `measure '${measure.name}' filter`);
        if (failure) return failure;
      }
      const failure = checkRefs(measure.expr, `measure '${measure.name}' expression`);
      if (failure) return failure;
    }
    for (const segment of source.segments) {
      const failure = checkRefs(segment.expr, `segment '${segment.name}' expression`);
      if (failure) return failure;
    }
    for (const column of source.columns) {
      if (!column.expr) continue;
      const failure = checkRefs(column.expr, `derived column '${column.name}' expression`);
      if (failure) return failure;
    }
    for (const join of source.joins) {
      const failure = checkRefs(join.on, `join to '${join.to}' condition`);
      if (failure) return failure;
    }
  }

  // ── 4. physical dependency scope ────────────────────────────────────────
  const physicalTableBySourceName = new Map<string, string>();
  const physicalTables = new Set<string>();
  for (const source of sources) {
    if (source.table) {
      physicalTableBySourceName.set(source.name, source.table);
      physicalTables.add(source.table);
      if (enabled.size > 0 && !enabled.has(source.table)) {
        return {
          ok: false,
          reason: "hive_source_dependency_not_allowed",
          detail: `Source '${source.name}' depends on '${source.table}', which is outside the connection's enabled table scope`
        };
      }
    }
  }

  const sourceNameByCanonicalKey = new Map<string, string>();
  for (const source of sources) {
    sourceNameByCanonicalKey.set(source.canonicalKey, source.name);
  }

  const hiddenColumnsBySourceName = new Map<string, string[]>();
  for (const source of sources) {
    const hidden = source.columns
      .filter((column) => column.visibility === "hidden")
      .map((column) => column.name);
    hiddenColumnsBySourceName.set(source.name, hidden);
  }

  return {
    ok: true,
    value: {
      connectionId: generation.connectionId,
      generation: generation.generation,
      sources,
      sourceNameByCanonicalKey,
      physicalTableBySourceName,
      physicalTables: [...physicalTables].sort(),
      hiddenColumnsBySourceName,
      cteNames: [...cteNames].sort()
    }
  };
}

/**
 * The payload the compute layer receives. Field names follow the KTX
 * `SourceDefinition` contract exactly — the compute layer forbids extra
 * fields, so the shape is produced here and nowhere else.
 */
export function toCompilerSources(sources: readonly HiveResolvedSource[]): Array<Record<string, unknown>> {
  return sources.map((source) => {
    const payload: Record<string, unknown> = {
      name: source.name,
      grain: source.grain,
      columns: source.columns.map((column) => {
        const entry: Record<string, unknown> = {
          name: column.name,
          type: column.type,
          visibility: column.visibility,
          role: column.role
        };
        if (column.description) entry.description = column.description;
        if (column.descriptions) entry.descriptions = column.descriptions;
        if (column.expr) entry.expr = column.expr;
        if (column.natural_granularity) entry.natural_granularity = column.natural_granularity;
        if (column.constraints) entry.constraints = column.constraints;
        if (column.enum_values) entry.enum_values = column.enum_values;
        return entry;
      }),
      joins: source.joins.map((join) => {
        const entry: Record<string, unknown> = {
          to: join.to,
          on: join.on,
          relationship: join.relationship
        };
        if (join.alias) entry.alias = join.alias;
        return entry;
      }),
      measures: source.measures.map((measure) => {
        const entry: Record<string, unknown> = { name: measure.name, expr: measure.expr };
        if (measure.filter) entry.filter = measure.filter;
        if (measure.segments) entry.segments = measure.segments;
        if (measure.description) entry.description = measure.description;
        return entry;
      }),
      segments: source.segments.map((segment) => {
        const entry: Record<string, unknown> = { name: segment.name, expr: segment.expr };
        if (segment.description) entry.description = segment.description;
        return entry;
      })
    };
    if (source.description) payload.description = source.description;
    if (source.descriptions) payload.descriptions = source.descriptions;
    // `table` and `sql` are mutually exclusive in the compute contract.
    if (source.sql) payload.sql = source.sql;
    else payload.table = source.table;
    return payload;
  });
}
