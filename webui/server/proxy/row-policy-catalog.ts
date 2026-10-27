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
import type {
  ResolvedCatalogAdapterCapabilities,
  RowPolicyCatalogCapabilityStatus
} from "./row-policy-capability.js";

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
 *
 * Spec §14.4.1: the value is resolved BY THE SERVER. `undefined` is not
 * `proven`; a caller that passes nothing gets the server-resolved capability.
 */
export interface RowPolicyAdapterCapabilities {
  schemaManifestCatalogProven?: boolean;
  /** Why the capability resolved the way it did. */
  reason?: string;
  /** The resolved capability status. */
  status?: RowPolicyCatalogCapabilityStatus;
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
      /**
       * Digest of the Manifest CONTENT (not of its path).
       *
       * Spec §14.2.1: 「只记录 Manifest 路径摘要不足以证明内容未变」. The preview
       * confirmation binds the compile inputs to the actual bytes that were read.
       */
      manifestContentDigest: string;
      /** Digest of the overlay CONTENT that took part in the compilation. */
      overlayContentDigest?: string;
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
  manifestContentDigest?: string;
  overlayContentDigest?: string;
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

/**
 * Spec §14.4.2 — reliable catalog structure.
 *
 * A Manifest is only a RELIABLE catalog when its shape proves the target table's
 * column set. YAML being parseable is NOT enough: `tables: {fin: {}}` and
 * `columns: "oops"` parse fine and would otherwise be reported as 「字段不存在」.
 *
 * The stage split is fixed by the contract:
 * - shape invalid (root / `tables` / table entry / `columns` array / column item /
 *   column name) → `parse`
 * - target table absent, target structure unbuildable, duplicate normalized
 *   column name → `catalog`
 */
interface ShapeFailure {
  stage: RowPolicyCatalogStage;
  reason: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the Manifest root and its `tables` map.
 *
 * Returns the `tables` record on success; a shape failure on failure.
 */
function validateManifestRoot(
  manifest: unknown
): { ok: true; tables: Record<string, unknown> } | { ok: false; failure: ShapeFailure } {
  if (!isPlainObject(manifest)) {
    return { ok: false, failure: { stage: "parse", reason: "manifest_root_invalid" } };
  }
  const tables = manifest.tables;
  if (!isPlainObject(tables)) {
    return { ok: false, failure: { stage: "parse", reason: "manifest_tables_invalid" } };
  }
  return { ok: true, tables };
}

/**
 * Pick the target table entry. A missing target is a `catalog` failure — the
 * document is well-formed, the table simply is not in it.
 */
function pickManifestTableEntry(
  tables: Record<string, unknown>,
  sourceName: string
): { ok: true; entry: unknown } | { ok: false; failure: ShapeFailure } {
  const direct = tables[sourceName];
  if (direct !== undefined) return { ok: true, entry: direct };
  const want = normalizeRef(sourceName);
  const found = Object.entries(tables).find(([key]) => normalizeRef(key) === want);
  if (found) return { ok: true, entry: found[1] };
  return {
    ok: false,
    failure: { stage: "catalog", reason: `manifest_table_absent:${normalizeRef(sourceName)}` }
  };
}

/**
 * Validate one table entry and extract its physical column set.
 *
 * `columns` must be EXPLICITLY present as an array. An absent `columns` is not a
 * zero-column table — it is an unreliable catalog, so it must never be reported
 * as 「字段不存在」.
 */
function validateManifestTableEntry(
  entry: unknown
): { ok: true; columns: Set<string> } | { ok: false; failure: ShapeFailure } {
  if (!isPlainObject(entry)) {
    return { ok: false, failure: { stage: "parse", reason: "manifest_table_entry_invalid" } };
  }
  const columns = entry.columns;
  if (!Array.isArray(columns)) {
    return {
      ok: false,
      failure: {
        stage: "parse",
        reason: columns === undefined ? "manifest_columns_missing" : "manifest_columns_not_array"
      }
    };
  }
  const physical = new Set<string>();
  for (const col of columns) {
    if (!isPlainObject(col)) {
      return { ok: false, failure: { stage: "parse", reason: "manifest_column_invalid" } };
    }
    const name = col.name;
    if (typeof name !== "string" || !name.trim()) {
      return { ok: false, failure: { stage: "parse", reason: "manifest_column_name_invalid" } };
    }
    const normalized = normalizeRef(name);
    if (physical.has(normalized)) {
      // A duplicate normalized column name is a CATALOG conflict: the column set
      // cannot be claimed complete. It must not be silently de-duplicated.
      return {
        ok: false,
        failure: { stage: "catalog", reason: `manifest_duplicate_column:${normalized}` }
      };
    }
    physical.add(normalized);
  }
  return { ok: true, columns: physical };
}

interface PhysicalColumnsOutcome {
  columns: Set<string>;
  status: "loaded" | "manifest_unavailable";
  stage?: RowPolicyCatalogStage;
  reason?: string;
  /** Semantic-layer-relative manifest path. */
  manifestPath?: string;
  /** Digest of the Manifest CONTENT that was read. */
  contentDigest?: string;
}

function contentDigestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 32);
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
    let manifest: unknown;
    try {
      manifest = parse(content);
    } catch (error) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: "parse",
        reason: `manifest_unparsable:${relPath}:${errorMessage(error)}`
      };
    }
    const root = validateManifestRoot(manifest);
    if (!root.ok) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: root.failure.stage,
        reason: `${root.failure.reason}:${relPath}`
      };
    }
    const entry = pickManifestTableEntry(root.tables, sourceName);
    if (!entry.ok) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: entry.failure.stage,
        reason: `${entry.failure.reason}:${relPath}`
      };
    }
    const validated = validateManifestTableEntry(entry.entry);
    if (!validated.ok) {
      return {
        columns: empty,
        status: "manifest_unavailable",
        stage: validated.failure.stage,
        reason: `${validated.failure.reason}:${relPath}`
      };
    }
    return {
      columns: validated.columns,
      status: "loaded",
      manifestPath: relPath,
      contentDigest: contentDigestOf(content)
    };
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
    const relPath = `${relDir}/${fileName}`;
    let content: string;
    try {
      content = await readFile(path.join(schemaDir, fileName), "utf-8");
    } catch (error) {
      firstFailure ??= {
        stage: isMissingFileError(error) ? "resolve" : "read",
        reason: `manifest_unreadable:${relPath}:${errorMessage(error)}`
      };
      continue;
    }
    let manifest: unknown;
    try {
      manifest = parse(content);
    } catch (error) {
      firstFailure ??= {
        stage: "parse",
        reason: `manifest_unparsable:${relPath}:${errorMessage(error)}`
      };
      continue;
    }
    const root = validateManifestRoot(manifest);
    if (!root.ok) {
      firstFailure ??= {
        stage: root.failure.stage,
        reason: `${root.failure.reason}:${relPath}`
      };
      continue;
    }
    const entry = pickManifestTableEntry(root.tables, sourceName);
    if (!entry.ok) {
      firstFailure ??= {
        stage: entry.failure.stage,
        reason: `${entry.failure.reason}:${relPath}`
      };
      continue;
    }
    const validated = validateManifestTableEntry(entry.entry);
    if (!validated.ok) {
      firstFailure ??= {
        stage: validated.failure.stage,
        reason: `${validated.failure.reason}:${relPath}`
      };
      continue;
    }
    const columns = validated.columns;
    if (columns.size === 0) continue;
    return {
      columns,
      status: "loaded",
      manifestPath: relPath,
      contentDigest: contentDigestOf(content)
    };
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

interface OverlayOutcome {
  /** Proven overlay fields and measures. */
  columns: Set<string>;
  measures: Set<string>;
  /** Digest of the overlay CONTENT (absent when the overlay is optional and missing). */
  contentDigest?: string;
  /** Set when the overlay could not be used. */
  failure?: ShapeFailure;
}

/**
 * Spec §14.4.2 — the overlay that takes part in the compilation must be validated.
 *
 * The overlay is OPTIONAL: a missing overlay file is not a fault (the physical
 * columns already form a catalog). Every other overlay fault is a real fault and
 * must NOT be swallowed:
 * - YAML syntax failure → `parse`
 * - read failure (other than "missing") → `catalog`
 * - invalid `columns` / `dimensions` / `measures` structure → `catalog`
 *
 * An overlay fault may never be attributed to 「字段不存在」.
 */
async function loadOverlayWithProvenance(
  connectionId: string,
  sourceName: string,
  physicalColumns: Set<string>
): Promise<OverlayOutcome> {
  const columns = new Set<string>();
  const measures = new Set<string>();
  const overlayPath = path.join(
    (await loadContentPaths()).semanticLayer,
    connectionId,
    `${sourceName}.yaml`
  );
  const relPath = `${normalizeRef(connectionId)}/${sourceName}.yaml`;

  let content: string;
  try {
    content = await readFile(overlayPath, "utf-8");
  } catch (error) {
    if (isMissingFileError(error)) {
      // The overlay is optional. Nothing to add, nothing to blame.
      return { columns, measures };
    }
    return {
      columns,
      measures,
      failure: { stage: "catalog", reason: `overlay_unreadable:${relPath}:${errorMessage(error)}` }
    };
  }

  let yaml: unknown;
  try {
    yaml = parse(content);
  } catch (error) {
    return {
      columns,
      measures,
      failure: { stage: "parse", reason: `overlay_unparsable:${relPath}:${errorMessage(error)}` }
    };
  }

  if (yaml === null || yaml === undefined) {
    // An empty overlay document carries no fields; treat it as an absent overlay.
    return { columns, measures, contentDigest: contentDigestOf(content) };
  }
  if (!isPlainObject(yaml)) {
    return {
      columns,
      measures,
      failure: { stage: "catalog", reason: `overlay_root_invalid:${relPath}` }
    };
  }

  for (const key of ["columns", "dimensions", "measures"] as const) {
    const value = yaml[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      return {
        columns,
        measures,
        failure: { stage: "catalog", reason: `overlay_${key}_not_array:${relPath}` }
      };
    }
    for (const item of value) {
      if (!isPlainObject(item)) {
        return {
          columns,
          measures,
          failure: { stage: "catalog", reason: `overlay_${key}_item_invalid:${relPath}` }
        };
      }
      if (item.name !== undefined && typeof item.name !== "string") {
        return {
          columns,
          measures,
          failure: { stage: "catalog", reason: `overlay_${key}_name_invalid:${relPath}` }
        };
      }
    }
  }

  addProvenOverlayFields(yaml.columns as OverlayField[] | undefined, sourceName, physicalColumns, columns);
  addProvenOverlayFields(yaml.dimensions as OverlayField[] | undefined, sourceName, physicalColumns, columns);
  for (const measure of (yaml.measures as Array<{ name?: unknown }> | undefined) ?? []) {
    if (typeof measure?.name === "string" && measure.name.trim()) {
      measures.add(normalizeRef(measure.name));
    }
  }

  return { columns, measures, contentDigest: contentDigestOf(content) };
}

async function buildCachedCatalog(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<CachedCatalog> {
  const physical = await loadPhysicalColumnsWithProvenance(connectionId, sourceName, schema);
  const columns = new Set<string>(physical.columns);
  const measures = new Set<string>();

  const overlay = await loadOverlayWithProvenance(connectionId, sourceName, physical.columns);
  for (const name of overlay.columns) columns.add(name);
  for (const name of overlay.measures) measures.add(name);

  const built: SourceFieldCatalog = { columns, measures };
  const catalog = columns.size === 0 && measures.size === 0 ? null : built;

  if (physical.status === "loaded" && !overlay.failure) {
    const manifestPath = physical.manifestPath ?? `${normalizeRef(connectionId)}/_schema/${schema ?? ""}.yaml`;
    return {
      catalog,
      status: "loaded",
      manifestPath,
      manifestPathDigest: manifestPathDigest(manifestPath),
      manifestContentDigest: physical.contentDigest ?? "",
      overlayContentDigest: overlay.contentDigest
    };
  }
  if (physical.status === "loaded" && overlay.failure) {
    // The physical columns loaded, but the overlay that takes part in the
    // compilation is not usable. The catalog is NOT reliable, so the failure is
    // attributed to the overlay's stage — never to 「字段不存在」.
    return {
      catalog,
      status: "manifest_unavailable",
      stage: overlay.failure.stage,
      reason: overlay.failure.reason,
      manifestPath: physical.manifestPath,
      manifestPathDigest: manifestPathDigest(physical.manifestPath ?? ""),
      manifestContentDigest: physical.contentDigest ?? "",
      overlayContentDigest: overlay.contentDigest
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
 *
 * Spec §14.4.1: the capability is resolved BY THE SERVER. When the caller does
 * not pass an explicit capability, the server resolves it from the adapter and
 * the deployment — a missing argument is never interpreted as `proven`.
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

  const capabilities = adapterCapabilities ?? (await resolveServerCatalogCapability(tableKey.connectionId));

  if (capabilities.schemaManifestCatalogProven !== true) {
    return {
      status: "catalog_capability_unknown",
      catalogLoaded: false,
      reason: `catalog_capability_not_proven:${capabilities.reason}`,
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
      manifestContentDigest: entry.manifestContentDigest ?? "",
      overlayContentDigest: entry.overlayContentDigest,
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

/**
 * Spec §14.4.1 — the server-side capability resolution, shared by the preview,
 * the pre-save final preview and the runtime compile.
 *
 * The result is the SAME resolution the preview binds into its compile-inputs
 * digest, so a preview can never claim a capability the runtime does not have.
 */
export async function resolveServerCatalogCapability(
  connectionId: string
): Promise<ResolvedCatalogAdapterCapabilities> {
  const { resolveCatalogCapabilityForConnection, toAdapterCapabilities } = await import(
    "./row-policy-capability.js"
  );
  return toAdapterCapabilities(await resolveCatalogCapabilityForConnection(connectionId));
}
