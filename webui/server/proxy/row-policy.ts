/**
 * AC-P1 Row Policy — compile-time binding + FinalRows helpers (Spec 99).
 * Gate B approved 2026-08-09.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { resolveProjectRoot } from "../project.js";

export type RowPolicyOp = "eq" | "in";

export interface RowPolicyPredicateInput {
  field: string;
  op: RowPolicyOp;
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

export interface ResolvedRowPolicyPredicate {
  field: string;
  sourceName: string;
  op: RowPolicyOp;
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

/** TRUE grant (row_access: all) or scoped ForcedPredicateAST (OR of AND groups). */
export type RowGrant =
  | { kind: "all" }
  | {
      kind: "scoped";
      digest: string;
      /** Flattened predicates (debug / digest input). */
      predicates: ResolvedRowPolicyPredicate[];
      /** OR arms: each arm is one Role's AND predicates. */
      orArms: ResolvedRowPolicyPredicate[][];
    };

export interface ForcedFiltersPayload {
  /** OR of Role grants; each inner list is AND (single Role row_policy). */
  or: Array<{ and: Array<{ field: string; op: RowPolicyOp; value?: string | number | boolean; values?: Array<string | number | boolean> }> }>;
}

export interface SourceFieldCatalog {
  columns: Set<string>;
  measures: Set<string>;
}

const UNSAFE_FIELD = /[()'"`;\\]|--|\/\*|\*\/|\bor\b|\band\b|\bunion\b|\bselect\b/i;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

const catalogCache = new Map<string, SourceFieldCatalog | null>();

/** Spec 99 §6.3 — default false until Gate C sets env after BY matrix green. */
export function isUpstreamForcedPredicateProven(): boolean {
  const raw = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  return raw === "1" || raw === "true" || raw === "TRUE";
}

export function resetRowPolicyCatalogCacheForTests(): void {
  catalogCache.clear();
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

function catalogCacheKey(connectionId: string, sourceName: string, schema?: string): string {
  return `${normalizeRef(connectionId)}\0${normalizeRef(sourceName)}\0${normalizeRef(schema ?? "")}`;
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
    "lower",
    "upper",
    "trim",
    "ltrim",
    "rtrim",
    "coalesce",
    "ifnull",
    "nullif",
    "concat",
    "substring",
    "substr",
    "length",
    "abs",
    "round",
    "floor",
    "ceil",
    "greatest",
    "least",
    "date",
    "timestamp",
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

type OverlayField = { name?: string; expr?: unknown };

async function loadPhysicalColumnsFromSchema(
  projectRoot: string,
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<Set<string>> {
  const physical = new Set<string>();
  const schemaDir = path.join(projectRoot, "semantic-layer", connectionId, "_schema");
  const files: string[] = [];
  if (schema) {
    files.push(path.join(schemaDir, `${schema}.yaml`));
  } else {
    try {
      const entries = await readdir(schemaDir);
      for (const entry of entries) {
        if (entry.endsWith(".yaml") || entry.endsWith(".yml")) {
          files.push(path.join(schemaDir, entry));
        }
      }
    } catch {
      return physical;
    }
  }

  const want = normalizeRef(sourceName);
  for (const file of files) {
    try {
      const yaml = parse(await readFile(file, "utf-8")) as {
        tables?: Record<string, { columns?: Array<{ name?: string }> }>;
      } | null;
      const entry =
        yaml?.tables?.[sourceName] ??
        Object.entries(yaml?.tables ?? {}).find(([k]) => normalizeRef(k) === want)?.[1];
      for (const col of entry?.columns ?? []) {
        if (typeof col?.name === "string" && col.name.trim()) {
          physical.add(normalizeRef(col.name));
        }
      }
      if (physical.size > 0) break;
    } catch {
      // try next schema file
    }
  }
  return physical;
}

function addProvenOverlayFields(
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

/**
 * Spec 99 §3.2 catalog = _schema physical columns ∪ proven row-level overlay computed/dimensions.
 * Measures are tracked separately and never bindable.
 */
export async function loadSourceFieldCatalog(
  connectionId: string,
  sourceName: string,
  schema?: string
): Promise<SourceFieldCatalog | null> {
  const key = catalogCacheKey(connectionId, sourceName, schema);
  if (catalogCache.has(key)) return catalogCache.get(key) ?? null;

  const projectRoot = await resolveProjectRoot();
  const physical = await loadPhysicalColumnsFromSchema(projectRoot, connectionId, sourceName, schema);
  const columns = new Set<string>(physical);
  const measures = new Set<string>();

  const overlayPath = path.join(projectRoot, "semantic-layer", connectionId, `${sourceName}.yaml`);
  try {
    const yaml = parse(await readFile(overlayPath, "utf-8")) as {
      columns?: OverlayField[];
      dimensions?: OverlayField[];
      measures?: Array<{ name?: string }>;
    } | null;
    addProvenOverlayFields(yaml?.columns, sourceName, physical, columns);
    addProvenOverlayFields(yaml?.dimensions, sourceName, physical, columns);
    for (const measure of yaml?.measures ?? []) {
      if (typeof measure?.name === "string" && measure.name.trim()) {
        measures.add(normalizeRef(measure.name));
      }
    }
  } catch {
    // Overlay optional when _schema physical columns exist.
  }

  if (columns.size === 0 && measures.size === 0) {
    catalogCache.set(key, null);
    return null;
  }

  const catalog = { columns, measures };
  catalogCache.set(key, catalog);
  return catalog;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Spec 99 §3.2 — bind field to row-level catalog; measures → unresolved.
 */
export function bindRowPolicyField(
  rawField: string,
  sourceName: string,
  catalog: SourceFieldCatalog | null
): { ok: true; field: string; sourceName: string } | { ok: false; reason: string } {
  const trimmed = rawField.trim();
  if (!trimmed) return { ok: false, reason: "row_policy_field_unresolved:empty" };
  if (UNSAFE_FIELD.test(trimmed)) return { ok: false, reason: "row_policy_field_unresolved:unsafe" };
  if (!SAFE_IDENT.test(trimmed) && !SAFE_QUALIFIED.test(trimmed)) {
    return { ok: false, reason: "row_policy_field_unresolved:shape" };
  }

  let fieldName = trimmed;
  let qualifiedSource: string | undefined;
  if (SAFE_QUALIFIED.test(trimmed)) {
    const [src, field] = trimmed.split(".");
    qualifiedSource = src;
    fieldName = field;
    if (normalizeRef(qualifiedSource) !== normalizeRef(sourceName)) {
      return { ok: false, reason: "row_policy_field_unresolved:cross_source" };
    }
  }

  if (!catalog) return { ok: false, reason: "row_policy_field_unresolved:no_catalog" };

  const normField = normalizeRef(fieldName);
  if (catalog.measures.has(normField)) {
    return { ok: false, reason: "row_policy_field_unresolved:measure" };
  }
  if (!catalog.columns.has(normField)) {
    return { ok: false, reason: "row_policy_field_unresolved:unknown" };
  }

  return {
    ok: true,
    field: fieldName,
    sourceName
  };
}

export function parseRowPolicyShape(
  raw: unknown
): { ok: true; predicates: RowPolicyPredicateInput[] } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "row_policy_invalid" };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "predicates") return { ok: false, reason: "row_policy_invalid_key" };
  }
  if (!Array.isArray(record.predicates) || record.predicates.length === 0) {
    return { ok: false, reason: "row_policy_predicates_required" };
  }
  const predicates: RowPolicyPredicateInput[] = [];
  for (const item of record.predicates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, reason: "row_policy_predicate_invalid" };
    }
    const pred = item as Record<string, unknown>;
    if (typeof pred.field !== "string") return { ok: false, reason: "row_policy_field_unresolved:empty" };
    if (pred.op !== "eq" && pred.op !== "in") return { ok: false, reason: "row_policy_op_forbidden" };
    if (pred.op === "eq") {
      if (!isScalar(pred.value)) return { ok: false, reason: "row_policy_value_invalid" };
      predicates.push({ field: pred.field, op: "eq", value: pred.value });
      continue;
    }
    const values = Array.isArray(pred.values)
      ? pred.values
      : Array.isArray(pred.value)
        ? pred.value
        : undefined;
    if (!values || values.length === 0 || values.some((v) => !isScalar(v))) {
      return { ok: false, reason: "row_policy_values_invalid" };
    }
    predicates.push({
      field: pred.field,
      op: "in",
      values: values as Array<string | number | boolean>
    });
  }
  return { ok: true, predicates };
}

export function rowGrantDigest(predicates: ResolvedRowPolicyPredicate[]): string {
  const normalized = predicates
    .map((p) => ({
      field: normalizeRef(p.field),
      sourceName: normalizeRef(p.sourceName),
      op: p.op,
      value: p.value,
      values: p.values ? [...p.values].map((v) => (typeof v === "string" ? normalizeRef(String(v)) : v)).sort() : undefined
    }))
    .sort((a, b) => `${a.sourceName}.${a.field}`.localeCompare(`${b.sourceName}.${b.field}`) || a.op.localeCompare(b.op));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

export async function compileScopedRowGrant(
  rowPolicyRaw: unknown,
  sources: Array<{ connectionId: string; sourceName: string; schema?: string }>
): Promise<{ ok: true; grant: RowGrant } | { ok: false; reason: string }> {
  const parsed = parseRowPolicyShape(rowPolicyRaw);
  if (!parsed.ok) return parsed;

  const resolved: ResolvedRowPolicyPredicate[] = [];
  for (const source of sources) {
    const catalog = await loadSourceFieldCatalog(
      source.connectionId,
      source.sourceName,
      source.schema
    );
    for (const pred of parsed.predicates) {
      const bound = bindRowPolicyField(pred.field, source.sourceName, catalog);
      if (!bound.ok) return { ok: false, reason: bound.reason };
      resolved.push({
        field: bound.field,
        sourceName: bound.sourceName,
        op: pred.op,
        value: pred.value,
        values: pred.values
      });
    }
  }

  // Multi-source selector: digest over all (source, predicate) pairs; runtime injects per requested source.
  return {
    ok: true,
    grant: {
      kind: "scoped",
      digest: rowGrantDigest(resolved),
      predicates: resolved,
      orArms: [resolved]
    }
  };
}

/**
 * Merge capability row grants for the same (tool, source).
 * OR semantics: all wins; scoped arms concatenate.
 */
export function mergeRowGrants(a: RowGrant, b: RowGrant): RowGrant {
  if (a.kind === "all" || b.kind === "all") return { kind: "all" };
  const digests = [a.digest, b.digest].sort();
  return {
    kind: "scoped",
    digest: createHash("sha256").update(digests.join("|")).digest("hex").slice(0, 16),
    predicates: [...a.predicates, ...b.predicates],
    orArms: [...a.orArms, ...b.orArms]
  };
}

export function buildForcedFiltersPayload(grant: RowGrant, sourceName: string): ForcedFiltersPayload | undefined {
  if (grant.kind === "all") return undefined;
  const or = grant.orArms
    .map((arm) => arm.filter((p) => normalizeRef(p.sourceName) === normalizeRef(sourceName)))
    .filter((arm) => arm.length > 0)
    .map((arm) => ({
      and: arm.map((p) => ({
        field: `${p.sourceName}.${p.field}`,
        op: p.op,
        value: p.value,
        values: p.values
      }))
    }));
  if (or.length === 0) return undefined;
  return { or };
}

export function rowGrantIsAll(grant: RowGrant | true | undefined): boolean {
  if (grant === undefined || grant === true) return true;
  return grant.kind === "all";
}

const FORBIDDEN_QUERY_SHAPE_KEYS = [
  "joins",
  "join",
  "leftJoin",
  "left_join",
  "subquery",
  "subqueries",
  "having",
  "from"
] as const;

const FORBIDDEN_FILTER_TREE_KEYS = new Set(["or", "and", "not", "expr", "sql"]);

/**
 * Spec 99 / ADR §5.1 — fail-closed shape checks for lucy_query on FinalRows-scoped sources.
 * Returns a deny reason, or undefined when args are acceptable for Proxy injection.
 */
export function validateProtectedLucyQueryArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const record = args as Record<string, unknown>;

  // Belt: raw SQL/query args (also denied earlier in authorizeAndRewrite).
  for (const key of ["query", "sql"] as const) {
    if (typeof record[key] === "string" && String(record[key]).trim().length > 0) {
      return "raw_query_forbidden";
    }
  }

  for (const key of FORBIDDEN_QUERY_SHAPE_KEYS) {
    if (record[key] !== undefined && record[key] !== null) {
      return "row_policy_query_shape_forbidden";
    }
  }

  if (record.filters !== undefined) {
    const items = Array.isArray(record.filters) ? record.filters : [record.filters];
    for (const item of items) {
      if (typeof item === "string") {
        return "invalid_arguments:lucy_query:filters_string_forbidden_on_scoped";
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item as Record<string, unknown>);
        if (keys.some((key) => FORBIDDEN_FILTER_TREE_KEYS.has(key))) {
          return "row_policy_query_shape_forbidden";
        }
      }
    }
  }

  if (Array.isArray(record.measures)) {
    for (const measure of record.measures) {
      if (
        measure
        && typeof measure === "object"
        && !Array.isArray(measure)
        && Object.prototype.hasOwnProperty.call(measure, "expr")
        && (measure as { expr?: unknown }).expr !== undefined
        && (measure as { expr?: unknown }).expr !== null
      ) {
        return "invalid_arguments:lucy_query:measures_expr_forbidden_on_scoped";
      }
    }
  }

  return undefined;
}

/**
 * ADR §2.1.1 E1–E5 — local explain diagnostics for protected / unprotected sources.
 * Does not execute queries or forward upstream.
 */
export interface ExplainForcedPredicateDiagnostics {
  /** E5 — client-readable semantics */
  semantics: "permission_forced_predicate_diagnostic";
  /** E1 */
  upstreamForwarded: false;
  /** E2 */
  containsResultRows: false;
  /** E3 — FinalRows ≠ TRUE when any requested source is scoped */
  finalRowsNonTrue: boolean;
  /** E3 — ForcedPredicateAST summary / digests (null when FinalRows is TRUE) */
  forcedPredicateAst: null | {
    digests: string[];
    forcedFilters: ForcedFiltersPayload;
    sources: Array<{ connectionId: string; sourceName: string; digest: string }>;
  };
  /** E4 — execution path for lucy_query (explain itself may still succeed) */
  executionPath: {
    tool: "lucy_query";
    upstreamForcedPredicateProven: boolean;
    wouldDeny: boolean;
    denyReason?: "row_policy_upstream_unproven";
    note: string;
  };
}

export function buildExplainForcedPredicateDiagnostics(input: {
  capabilities: Array<{
    tool: string;
    connectionId: string;
    sourceName: string;
    rowGrant: RowGrant;
  }>;
  requestedSources: Array<{ connectionId?: string; sourceName?: string }>;
}): ExplainForcedPredicateDiagnostics {
  const proven = isUpstreamForcedPredicateProven();
  const protectedSources: Array<{
    connectionId: string;
    sourceName: string;
    digest: string;
    grant: Extract<RowGrant, { kind: "scoped" }>;
  }> = [];

  for (const requested of input.requestedSources) {
    const sourceName = typeof requested.sourceName === "string" ? normalizeRef(requested.sourceName) : "";
    const connectionId =
      typeof requested.connectionId === "string" ? normalizeRef(requested.connectionId) : "";
    if (!sourceName) continue;

    const matches = input.capabilities.filter((cap) => {
      if (cap.tool !== "lucy_explain_query" && cap.tool !== "lucy_query") return false;
      if (normalizeRef(cap.sourceName) !== sourceName) return false;
      if (connectionId && normalizeRef(cap.connectionId) !== connectionId) return false;
      return true;
    });
    const scoped = matches.find((cap) => cap.rowGrant.kind === "scoped");
    if (scoped && scoped.rowGrant.kind === "scoped") {
      if (
        !protectedSources.some(
          (item) =>
            item.sourceName === normalizeRef(scoped.sourceName) &&
            item.connectionId === normalizeRef(scoped.connectionId)
        )
      ) {
        protectedSources.push({
          connectionId: scoped.connectionId,
          sourceName: scoped.sourceName,
          digest: scoped.rowGrant.digest,
          grant: scoped.rowGrant
        });
      }
    }
  }

  const finalRowsNonTrue = protectedSources.length > 0;
  let forcedPredicateAst: ExplainForcedPredicateDiagnostics["forcedPredicateAst"] = null;
  if (finalRowsNonTrue) {
    const or: ForcedFiltersPayload["or"] = [];
    for (const item of protectedSources) {
      const payload = buildForcedFiltersPayload(item.grant, item.sourceName);
      if (payload) or.push(...payload.or);
    }
    forcedPredicateAst = {
      digests: protectedSources.map((item) => item.digest),
      forcedFilters: { or },
      sources: protectedSources.map((item) => ({
        connectionId: item.connectionId,
        sourceName: item.sourceName,
        digest: item.digest
      }))
    };
  }

  const wouldDeny = finalRowsNonTrue && !proven;
  return {
    semantics: "permission_forced_predicate_diagnostic",
    upstreamForwarded: false,
    containsResultRows: false,
    finalRowsNonTrue,
    forcedPredicateAst,
    executionPath: {
      tool: "lucy_query",
      upstreamForcedPredicateProven: proven,
      wouldDeny,
      denyReason: wouldDeny ? "row_policy_upstream_unproven" : undefined,
      note: wouldDeny
        ? "Explain is a local diagnostic only. The lucy_query execution path will deny with row_policy_upstream_unproven until upstream forced_filters is proven (Gate C)."
        : finalRowsNonTrue
          ? "Explain is a local diagnostic only. lucy_query may execute with Proxy-injected forced_filters; this response is not a data return."
          : "Explain is a local diagnostic only. FinalRows is TRUE for requested sources; this response is not a data return."
    }
  };
}

function sqlLiteral(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Compile Proxy ForcedPredicateAST into parenthesized filter expressions for
 * bundled `@kaelio/ktx` (currently strips unknown `forced_filters` at MCP schema).
 * Fields must already be safe `source.column` from Lucy compile binding.
 */
export function compileForcedFiltersToUpstreamFilterExprs(
  payload: ForcedFiltersPayload
): string[] {
  const orParts: string[] = [];
  for (const arm of payload.or) {
    const andParts: string[] = [];
    for (const leaf of arm.and) {
      const field = leaf.field.trim();
      if (!SAFE_QUALIFIED.test(field)) {
        throw new Error(`forced_filters field unsafe for upstream emit: ${leaf.field}`);
      }
      if (leaf.op === "eq") {
        if (leaf.value === undefined) {
          throw new Error(`forced_filters eq missing value for ${field}`);
        }
        andParts.push(`${field} = ${sqlLiteral(leaf.value)}`);
      } else if (leaf.op === "in") {
        if (!leaf.values?.length) {
          throw new Error(`forced_filters in missing values for ${field}`);
        }
        andParts.push(`${field} IN (${leaf.values.map((v) => sqlLiteral(v)).join(", ")})`);
      } else {
        throw new Error(`forced_filters op forbidden: ${String((leaf as { op?: unknown }).op)}`);
      }
    }
    if (andParts.length === 0) continue;
    orParts.push(`(${andParts.join(" AND ")})`);
  }
  if (orParts.length === 0) return [];
  if (orParts.length === 1) return [orParts[0]!];
  return [`(${orParts.join(" OR ")})`];
}

/**
 * Spec 99 §6 / BY-05 — strip user-forged forced_* fields, inject Proxy payload.
 *
 * Lucy owns the carrier for bundled KTX `@kaelio/ktx@0.16.0` (Kaelio upstream is
 * out of scope): keep `forced_filters` for audit/forward-compat, and prepend the
 * compiled forced predicate into `filters[]` so stock KTX applies it via AND
 * (Proxy shape gates forbid user OR/string filters on protected sources).
 */
export function applyLucyQueryForcedFilters(
  args: unknown,
  forcedFilters: ForcedFiltersPayload | undefined
): Record<string, unknown> {
  const record = args && typeof args === "object" && !Array.isArray(args)
    ? { ...(args as Record<string, unknown>) }
    : {};
  delete record.forced_filters;
  delete record.forcedFilters;
  if (forcedFilters) {
    record.forced_filters = forcedFilters;
    const forcedExprs = compileForcedFiltersToUpstreamFilterExprs(forcedFilters);
    const existing = Array.isArray(record.filters)
      ? [...record.filters]
      : record.filters === undefined
        ? []
        : [record.filters];
    record.filters = [...forcedExprs, ...existing];
  }
  return record;
}
