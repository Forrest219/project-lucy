/**
 * Lucy v0.25 (L25-14 §3.5 / §5.5) — provenance-aware Schema Manifest field catalog.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §3.5 (R5 行级条件字段可诊断), §5.5 (清单来源、字段诊断与 0.20.Z 缺陷修复边界),
 *   §9 (V20 / V21).
 *
 * Contract:
 * - The catalog status is derived from REAL I/O and parsing, never from a
 *   field-binding failure. `catalogLoaded = true` only when the Schema Manifest
 *   path resolved, the file was read, the YAML parsed, and the target table's
 *   catalog was built.
 * - Every failure carries a stage (`resolve → read → parse → catalog`) plus the
 *   connection / schema / table identity, so R5 can attribute the failure to
 *   「清单不可用」(operations) instead of 「字段不存在」(the user).
 * - All three outcomes fail closed: a field that cannot be bound stays unbound.
 *
 * ── D-03 / G5 boundary (spec §1.5, §11 D7) ───────────────────────────────────
 * The manifest path is resolved from the schema name the BINDING asked for, and
 * from that name only: `<connection>/_schema/<schema>.yaml`.
 *
 * This module deliberately does NOT look for a case-insensitive match in the
 * real directory. The source map lower-cases the schema name when it reads the
 * Manifest file names, so on a case-sensitive filesystem a disk file
 * `BIDM.yaml` is NOT reachable as `bidm.yaml`. That miss is reported as
 * `manifest_unavailable` / `stage=resolve` — an operations-side fault — and
 * NEVER as 「字段不存在」.
 *
 * The real case-insensitive resolution belongs to the 0.20.Z maintenance line
 * (spec §11 D7; docs/qa/security-findings.yaml D-03 `fixedIn: null`).
 * {@link resolveManifestFilePath} is the single place where that behaviour would
 * be switched on; nothing else in this module may grow a directory scan that
 * matches a differently-cased file name.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { loadContentPaths } from "../paths.js";

export function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

export interface SourceFieldCatalog {
  columns: Set<string>;
  measures: Set<string>;
}

const AGGREGATE_CALL_RE =
  /\b(sum|count|avg|min|max|stddev|std|variance|group_concat|array_agg|string_agg)\s*\(/i;
const WINDOW_RE = /\b(over\s*\(|partition\s+by|rows\s+between|range\s+between)\b/i;
const EXPR_UNSAFE_RE = /;|--|\/\*|\*\//;
/** Keywords / row-level helpers allowed beside physical column identifiers. */
const EXPR_ALLOWED_IDENTS = new Set(
  [
    "and",
    "or",
    "not",
    "case",
    "when",
    "then",
    "else",
    "end",
    "null",
    "true",
    "false",
    "as",
    "in",
    "is",
    "like",
    "between",
    "cast",
    "year",
    "month",
    "day",
    "hour",
    "minute",
    "second",
    "interval",
    "extract",
    "from",
    "distinct"
  ].map((s) => s.toLowerCase())
);

/**
 * Spec 99 §3.2 — prove overlay computed/dimension is row-level and source-local.
 * Exported for unit tests.
 */
export function isProvenRowLevelExpr(
  expr: unknown,
  sourceName: string,
  physicalColumns: Set<string>
): boolean {
  if (typeof expr !== "string" || !expr.trim()) return false;
  const e = expr.trim();
  if (AGGREGATE_CALL_RE.test(e) || WINDOW_RE.test(e) || EXPR_UNSAFE_RE.test(e)) return false;

  for (const match of e.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const left = match[1]!;
    const right = match[2]!;
    if (normalizeRef(left) !== normalizeRef(sourceName)) return false;
    if (!physicalColumns.has(normalizeRef(right))) return false;
  }

  // Fail-closed on bare identifiers that are neither physical columns nor allowlisted helpers.
  const withoutStrings = e.replace(/'[^']*'|"[^"]*"/g, " ");
  const withoutQualified = withoutStrings.replace(
    /\b[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\b/g,
    " "
  );
  const withoutFuncs = withoutQualified.replace(/\b[A-Za-z_][A-Za-z0-9_]*\s*(?=\()/g, " ");
  for (const match of withoutFuncs.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const id = normalizeRef(match[1]!);
    if (EXPR_ALLOWED_IDENTS.has(id) || physicalColumns.has(id)) continue;
    return false;
  }
  return true;
}

export type OverlayField = { name?: string; expr?: unknown };

export function addProvenOverlayFields(
  fields: OverlayField[] | undefined,
  sourceName: string,
  physical: Set<string>,
  into: Set<string>
): void {
  for (const field of fields ?? []) {
    if (typeof field?.name !== "string" || !field.name.trim()) continue;
    const name = normalizeRef(field.name);
    // Overlay name that is already a physical column: allow (documentation / alias).
    if (physical.has(name) && (field.expr === undefined || field.expr === null || field.expr === "")) {
      into.add(name);
      continue;
    }
    if (isProvenRowLevelExpr(field.expr, sourceName, physical)) {
      into.add(name);
    }
  }
}

// ─── R5 provenance contract ────────────────────────────────────────────────────

/** Stage at which the Schema Manifest could not be turned into a field catalog. */
export type RowPolicyCatalogStage = "resolve" | "read" | "parse" | "catalog";

export type RowPolicyCatalogStatus = "loaded" | "manifest_unavailable" | "catalog_capability_unknown";

/** The four-tuple minus the field: connection / schema / table. */
export interface RowPolicyTableIdentity {
  connectionId: string;
  schema: string;
  sourceName: string;
}

/**
 * Deployment / adapter declaration for the field catalog.
 *
 * `schemaManifestCatalogProven === false` means the adapter or deployment cannot
 * prove that a Schema Manifest catalog is available. R5 then attributes the
 * failure to 「目录能力未知」and fails closed — it must never be guessed into
 * 「字段不存在」.
 */
export interface RowPolicyAdapterCapabilities {
  schemaManifestCatalogProven?: boolean;
}

export type RowPolicyCatalogResult =
  | {
      status: "loaded";
      catalogLoaded: true;
      /**
       * The table's field catalog. `null` when the table exposes neither bindable
       * columns nor measures — the legacy `loadSourceFieldCatalog` shape, kept so
       * the existing `row_policy_field_unresolved:{no_catalog|unknown}` reason codes
       * do not drift.
       */
      catalog: SourceFieldCatalog | null;
      /** Semantic-layer-relative manifest path (deployment independent). */
      manifestPath: string;
      manifestPathDigest: string;
      connectionId: string;
      schema: string;
      sourceName: string;
    }
  | {
      status: "manifest_unavailable";
      catalogLoaded: false;
      stage: RowPolicyCatalogStage;
      reason: string;
      /**
       * Best-effort catalog gathered before the failure (the overlay may still
       * expose measures). `null` when nothing usable was found.
       */
      catalog: SourceFieldCatalog | null;
      connectionId: string;
      schema: string;
      sourceName: string;
    }
  | {
      status: "catalog_capability_unknown";
      catalogLoaded: false;
      reason: string;
      catalog: null;
      connectionId: string;
      schema: string;
      sourceName: string;
    };

interface CachedCatalog {
  catalog: SourceFieldCatalog | null;
  status: RowPolicyCatalogStatus;
  stage?: RowPolicyCatalogStage;
  reason?: string;
  manifestPath?: string;
  manifestPathDigest?: string;
}

const catalogCache = new Map<string, CachedCatalog>();

export function resetRowPolicyCatalogCacheForTests(): void {
  catalogCache.clear();
}

function catalogCacheKey(connectionId: string, sourceName: string, schema?: string): string {
  return `${normalizeRef(connectionId)}\0${normalizeRef(sourceName)}\0${normalizeRef(schema ?? "")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A missing file is a RESOLUTION failure (the requested path does not exist);
 * every other I/O failure is a READ failure. Both are `manifest_unavailable`.
 */
function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return true;
  return /no such file/i.test(errorMessage(error));
}

/**
 * ── v0.25 POLICY (D-03 / G5 boundary) ─────────────────────────────────────────
 * Resolve the Schema Manifest file for one schema, from the schema name the
 * BINDING asked for, and from that name ONLY.
 *
 * The function deliberately performs NO case-insensitive lookup in the real
 * directory. The source map lower-cases the schema name when it reads the
 * Manifest file names, so on a case-sensitive filesystem a disk file
 * `BIDM.yaml` is not reachable as `bidm.yaml`; the resulting miss is reported
 * as `manifest_unavailable` / `stage=resolve` (operations), never as
 * 「字段不存在」.
 *
 * D-03 (the real case-insensitive resolution) belongs to the 0.20.Z maintenance
 * line (spec §11 D7; docs/qa/security-findings.yaml D-03 `fixedIn: null`). When
 * that line ships, THIS FUNCTION is the single place to change.
 * ──────────────────────────────────────────────────────────────────────────────
 */
export function resolveManifestFilePath(schemaDir: string, schema: string): string {
  return path.join(schemaDir, `${schema}.yaml`);
}

interface ManifestTableEntry {
  columns?: Array<{ name?: string }>;
}

interface ManifestShape {
  tables?: Record<string, ManifestTableEntry>;
}

function pickManifestTableEntry(
  manifest: ManifestShape | null | undefined,
  sourceName: string
): ManifestTableEntry | undefined {
  const tables = manifest?.tables ?? {};
  const direct = tables[sourceName];
  if (direct) return direct;
  const want = normalizeRef(sourceName);
  const found = Object.entries(tables).find(([key]) => normalizeRef(key) === want);
  return found?.[1];
}

function columnsFromManifestEntry(entry: ManifestTableEntry | undefined): Set<string> {
  const physical = new Set<string>();
  for (const col of entry?.columns ?? []) {
    if (typeof col?.name === "string" && col.name.trim()) {
      physical.add(normalizeRef(col.name));
    }
  }
  return physical;
}

interface PhysicalColumnsOutcome {
  columns: Set<string>;
  status: "loaded" | "manifest_unavailable";
  stage?: RowPolicyCatalogStage;
  reason?: string;
  /** Semantic-layer-relative manifest path. */
  manifestPath?: string;
}

/**
 * Read the physical columns of one table out of the Schema Manifest, with the
 * stage of any failure. When a schema is requested, ONLY the requested path is
 * read (D-03 policy). When no schema is requested, the schema directory is
 * scanned — the legacy behaviour — and every file is still read by its exact
 * disk name.
 */
async function loadPhysicalColumnsWithProvenance(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<PhysicalColumnsOutcome> {
  const empty = new Set<string>();
  const semanticLayer = (await loadContentPaths()).semanticLayer;
  const schemaDir = path.join(semanticLayer, connectionId, "_schema");
  const relDir = `${normalizeRef(connectionId)}/_schema`;

  if (schema) {
    const file = resolveManifestFilePath(schemaDir, schema);
    const relPath = `${relDir}/${schema}.yaml`;
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (error) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: isMissingFileError(error) ? "resolve" : "read",
        reason: `manifest_unreadable:${relPath}:${errorMessage(error)}`
      };
    }
    let manifest: ManifestShape | null;
    try {
      manifest = parse(content) as ManifestShape | null;
    } catch (error) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: "parse",
        reason: `manifest_unparsable:${relPath}:${errorMessage(error)}`
      };
    }
    const entry = pickManifestTableEntry(manifest, sourceName);
    if (!entry) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: "catalog",
        reason: `manifest_table_absent:${relPath}:${normalizeRef(sourceName)}`
      };
    }
    return { columns: columnsFromManifestEntry(entry), status: "loaded", manifestPath: relPath };
  }

  // No schema requested: scan the schema directory (legacy behaviour).
  let entries: string[];
  try {
    entries = await readdir(schemaDir);
  } catch (error) {
    return {
      columns: empty,
      status: "manifest_unavailable",
      stage: "resolve",
      reason: `manifest_dir_unavailable:${relDir}:${errorMessage(error)}`
    };
  }
  const files = entries
    .filter((entry) => entry.endsWith(".yaml") || entry.endsWith(".yml"))
    .sort((a, b) => a.localeCompare(b));
  let firstFailure: { stage: RowPolicyCatalogStage; reason: string } | undefined;
  for (const fileName of files) {
    let content: string;
    try {
      content = await readFile(path.join(schemaDir, fileName), "utf-8");
    } catch (error) {
      firstFailure ??= {
        stage: isMissingFileError(error) ? "resolve" : "read",
        reason: `manifest_unreadable:${relDir}/${fileName}:${errorMessage(error)}`
      };
      continue;
    }
    let manifest: ManifestShape | null;
    try {
      manifest = parse(content) as ManifestShape | null;
    } catch (error) {
      firstFailure ??= {
        stage: "parse",
        reason: `manifest_unparsable:${relDir}/${fileName}:${errorMessage(error)}`
      };
      continue;
    }
    const entry = pickManifestTableEntry(manifest, sourceName);
    if (!entry) continue;
    const columns = columnsFromManifestEntry(entry);
    if (columns.size === 0) continue;
    return { columns, status: "loaded", manifestPath: `${relDir}/${fileName}` };
  }
  return {
    columns: empty,
    status: "manifest_unavailable",
    stage: firstFailure?.stage ?? "catalog",
    reason: firstFailure?.reason ?? `manifest_table_absent:${relDir}:${normalizeRef(sourceName)}`
  };
}

function manifestPathDigest(manifestPath: string): string {
  return createHash("sha256").update(manifestPath).digest("hex").slice(0, 16);
}

async function buildCachedCatalog(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<CachedCatalog> {
  const physical = await loadPhysicalColumnsWithProvenance(connectionId, sourceName, schema);
  const columns = new Set<string>(physical.columns);
  const measures = new Set<string>();

  const overlayPath = path.join(
    (await loadContentPaths()).semanticLayer,
    connectionId,
    `${sourceName}.yaml`
  );
  try {
    const yaml = parse(await readFile(overlayPath, "utf-8")) as {
      columns?: OverlayField[];
      dimensions?: OverlayField[];
      measures?: Array<{ name?: string }>;
    } | null;
    addProvenOverlayFields(yaml?.columns, sourceName, physical.columns, columns);
    addProvenOverlayFields(yaml?.dimensions, sourceName, physical.columns, columns);
    for (const measure of yaml?.measures ?? []) {
      if (typeof measure?.name === "string" && measure.name.trim()) {
        measures.add(normalizeRef(measure.name));
      }
    }
  } catch {
    // Overlay optional when _schema physical columns exist.
  }

  const built: SourceFieldCatalog = { columns, measures };
  const catalog = columns.size === 0 && measures.size === 0 ? null : built;

  if (physical.status === "loaded") {
    const manifestPath = physical.manifestPath ?? `${normalizeRef(connectionId)}/_schema/${schema ?? ""}.yaml`;
    return {
      catalog,
      status: "loaded",
      manifestPath,
      manifestPathDigest: manifestPathDigest(manifestPath)
    };
  }
  return {
    catalog,
    status: "manifest_unavailable",
    stage: physical.stage ?? "resolve",
    reason: physical.reason ?? "manifest_unavailable"
  };
}

async function cachedCatalogEntry(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<CachedCatalog> {
  const key = catalogCacheKey(connectionId, sourceName, schema);
  const cached = catalogCache.get(key);
  if (cached) return cached;
  const built = await buildCachedCatalog(connectionId, sourceName, schema);
  catalogCache.set(key, built);
  return built;
}

/**
 * Legacy helper kept for callers that only need the physical column set.
 *
 * The provenance-aware sibling is {@link loadSourceFieldCatalogWithProvenance};
 * this wrapper keeps the historical signature (and the historical "first file that
 * yields columns wins" behaviour when no schema is requested).
 */
export async function loadPhysicalColumnsFromSchema(
  _projectRoot: string,
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<Set<string>> {
  const outcome = await loadPhysicalColumnsWithProvenance(connectionId, sourceName, schema);
  return outcome.columns;
}

/**
 * Spec 99 §3.2 catalog = _schema physical columns ∪ proven row-level overlay
 * computed/dimensions. Measures are tracked separately and never bindable.
 *
 * Legacy shape, kept unchanged for existing callers: `null` when the table
 * exposes neither columns nor measures.
 */
export async function loadSourceFieldCatalog(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<SourceFieldCatalog | null> {
  const entry = await cachedCatalogEntry(connectionId, sourceName, schema);
  return entry.catalog;
}

/**
 * R5 §5.5 — load the field catalog for one table WITH its provenance.
 *
 * The result is a discriminated union: `loaded`, `manifest_unavailable`
 * (with the failing stage) or `catalog_capability_unknown`. The adapter
 * capability check happens BEFORE any I/O, and its outcome is never cached as a
 * manifest failure.
 */
export async function loadSourceFieldCatalogWithProvenance(
  tableKey: RowPolicyTableIdentity,
  adapterCapabilities?: RowPolicyAdapterCapabilities
): Promise<RowPolicyCatalogResult> {
  const identity = {
    connectionId: tableKey.connectionId,
    schema: tableKey.schema,
    sourceName: tableKey.sourceName
  };

  if (adapterCapabilities?.schemaManifestCatalogProven === false) {
    return {
      status: "catalog_capability_unknown",
      catalogLoaded: false,
      reason: "catalog_capability_not_proven",
      catalog: null,
      ...identity
    };
  }

  const entry = await cachedCatalogEntry(
    tableKey.connectionId,
    tableKey.sourceName,
    tableKey.schema || undefined
  );

  if (entry.status === "loaded") {
    return {
      status: "loaded",
      catalogLoaded: true,
      catalog: entry.catalog,
      manifestPath: entry.manifestPath ?? "",
      manifestPathDigest: entry.manifestPathDigest ?? "",
      ...identity
    };
  }

  return {
    status: "manifest_unavailable",
    catalogLoaded: false,
    stage: entry.stage ?? "resolve",
    reason: entry.reason ?? "manifest_unavailable",
    catalog: entry.catalog,
    ...identity
  };
}
