/**
 * AC-P1 Row Policy — compile-time binding + FinalRows helpers (Spec 99).
 * Gate B approved 2026-08-09.
 */
import { createHash } from "node:crypto";
import {
  loadSourceFieldCatalogWithProvenance,
  normalizeRef,
  type RowPolicyAdapterCapabilities,
  type RowPolicyCatalogStage,
  type RowPolicyCatalogStatus,
  type SourceFieldCatalog
} from "./row-policy-catalog.js";

/**
 * The field-catalog concern (Schema Manifest loading, overlay proving, catalog
 * provenance) lives in `row-policy-catalog.ts` since Lucy v0.25. The names below
 * are re-exported so every existing import path keeps working.
 */
export {
  addProvenOverlayFields,
  isProvenRowLevelExpr,
  loadPhysicalColumnsFromSchema,
  loadSourceFieldCatalog,
  loadSourceFieldCatalogWithProvenance,
  resetRowPolicyCatalogCacheForTests,
  resolveManifestFilePath,
  type OverlayField,
  type RowPolicyAdapterCapabilities,
  type RowPolicyCatalogResult,
  type RowPolicyCatalogStage,
  type RowPolicyCatalogStatus,
  type RowPolicyTableIdentity,
  type SourceFieldCatalog
} from "./row-policy-catalog.js";

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

const UNSAFE_FIELD = /[()'"`;\\]|--|\/\*|\*\/|\bor\b|\band\b|\bunion\b|\bselect\b/i;
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SAFE_QUALIFIED = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/** Spec 99 §6.3 — default false until Gate C sets env after BY matrix green. */
export function isUpstreamForcedPredicateProven(): boolean {
  const raw = process.env.LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN;
  return raw === "1" || raw === "true" || raw === "TRUE";
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * R5 §3.5 — the attribution layer on top of the existing machine reason codes.
 *
 * The reason codes (`row_policy_field_unresolved:*`) stay exactly as they are; the
 * attribution adds the four-tuple (connection / schema / table / field), the failure
 * stage, and the three-way split between 「字段不存在」, 「清单不可用」 and
 * 「目录能力未知」.
 */
export type RowPolicyFieldAttributionCode =
  | "row_policy_field_unknown"
  | "row_policy_catalog_unavailable"
  | "row_policy_catalog_capability_unknown"
  | "row_policy_field_unresolved";

export interface RowPolicyFieldAttribution {
  code: RowPolicyFieldAttributionCode;
  /** Compile stage of the failure. */
  stage: "row_grant";
  /** Catalog stage, when the failure is a catalog failure. */
  catalogStage?: RowPolicyCatalogStage;
  connectionId: string;
  schema: string;
  sourceName: string;
  field: string;
  /** The machine reason code this attribution was derived from. */
  reason: string;
}

/** Context the binder needs to attribute a failure (the four-tuple + catalog provenance). */
export interface RowPolicyBindingContext {
  connectionId?: string;
  schema?: string;
  catalogStatus?: RowPolicyCatalogStatus;
  catalogStage?: RowPolicyCatalogStage;
}

function attributeBindingFailure(
  reason: string,
  rawField: string,
  sourceName: string,
  context?: RowPolicyBindingContext
): RowPolicyFieldAttribution | undefined {
  // Without a context the caller cannot be attributed (e.g. the Agent-constraint
  // binder, which is outside the row-policy path). The machine reason still stands.
  if (!context) return undefined;
  const base = {
    stage: "row_grant" as const,
    connectionId: context.connectionId ?? "",
    schema: context.schema ?? "",
    sourceName,
    field: rawField.trim(),
    reason
  };
  const catalogDriven =
    reason === "row_policy_field_unresolved:no_catalog" ||
    reason === "row_policy_field_unresolved:unknown";
  if (!catalogDriven) {
    // empty / unsafe / shape / cross_source / measure keep their own codes.
    return { code: "row_policy_field_unresolved", ...base };
  }
  if (context.catalogStatus === "catalog_capability_unknown") {
    return { code: "row_policy_catalog_capability_unknown", ...base };
  }
  if (context.catalogStatus === "manifest_unavailable") {
    return { code: "row_policy_catalog_unavailable", catalogStage: context.catalogStage, ...base };
  }
  if (context.catalogStatus === "loaded") {
    // Only a reliably loaded catalog may claim 「字段不存在」.
    return { code: "row_policy_field_unknown", ...base };
  }
  return { code: "row_policy_field_unresolved", ...base };
}

/**
 * Spec 99 §3.2 — bind field to row-level catalog; measures → unresolved.
 *
 * The failure branch now carries the R5 attribution next to the unchanged machine
 * reason code. The attribution never widens a binding: an unbound field stays
 * unbound and the request stays denied.
 */
export function bindRowPolicyField(
  rawField: string,
  sourceName: string,
  catalog: SourceFieldCatalog | null,
  context?: RowPolicyBindingContext
):
  | { ok: true; field: string; sourceName: string }
  | { ok: false; reason: string; attribution?: RowPolicyFieldAttribution } {
  const fail = (reason: string) => ({
    ok: false as const,
    reason,
    attribution: attributeBindingFailure(reason, rawField, sourceName, context)
  });
  const trimmed = rawField.trim();
  if (!trimmed) return fail("row_policy_field_unresolved:empty");
  if (UNSAFE_FIELD.test(trimmed)) return fail("row_policy_field_unresolved:unsafe");
  if (!SAFE_IDENT.test(trimmed) && !SAFE_QUALIFIED.test(trimmed)) {
    return fail("row_policy_field_unresolved:shape");
  }

  let fieldName = trimmed;
  let qualifiedSource: string | undefined;
  if (SAFE_QUALIFIED.test(trimmed)) {
    const [src, field] = trimmed.split(".");
    qualifiedSource = src;
    fieldName = field;
    if (normalizeRef(qualifiedSource) !== normalizeRef(sourceName)) {
      return fail("row_policy_field_unresolved:cross_source");
    }
  }

  if (!catalog) return fail("row_policy_field_unresolved:no_catalog");

  const normField = normalizeRef(fieldName);
  if (catalog.measures.has(normField)) {
    return fail("row_policy_field_unresolved:measure");
  }
  if (!catalog.columns.has(normField)) {
    return fail("row_policy_field_unresolved:unknown");
  }

  return {
    ok: true,
    field: fieldName,
    sourceName
  };
}

/**
 * R5 — human/machine readable rendering of the attribution, appended to the
 * failure reason so the four-tuple travels with the error.
 */
export function formatRowPolicyAttribution(attribution: RowPolicyFieldAttribution): string {
  const parts = [
    `code=${attribution.code}`,
    `connection=${attribution.connectionId}`,
    `schema=${attribution.schema}`,
    `source=${attribution.sourceName}`,
    `field=${attribution.field}`
  ];
  if (attribution.catalogStage) {
    parts.splice(1, 0, `catalog_stage=${attribution.catalogStage}`);
  }
  return parts.join(";");
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

/**
 * Spec 99 §3.2 — compile one scoped row grant.
 *
 * Lucy v0.25 (L25-14 §3.5): the field catalog is loaded WITH its provenance so a
 * binding failure can be attributed to 「字段不存在」, 「清单不可用」 or
 * 「目录能力未知」. The machine reason codes and the granted shape are unchanged;
 * only the failure branch gained an `attribution` field.
 */
export async function compileScopedRowGrant(
  rowPolicyRaw: unknown,
  sources: Array<{
    connectionId: string;
    sourceName: string;
    schema?: string;
    /** Schema as it appears on disk — used for diagnostics only, never for the manifest path. */
    schemaDisplay?: string;
  }>,
  options?: { adapterCapabilities?: RowPolicyAdapterCapabilities }
): Promise<
  | { ok: true; grant: RowGrant }
  | { ok: false; reason: string; attribution?: RowPolicyFieldAttribution }
> {
  const parsed = parseRowPolicyShape(rowPolicyRaw);
  if (!parsed.ok) return parsed;

  const resolved: ResolvedRowPolicyPredicate[] = [];
  for (const source of sources) {
    const catalogResult = await loadSourceFieldCatalogWithProvenance(
      {
        connectionId: source.connectionId,
        schema: source.schema ?? "",
        sourceName: source.sourceName
      },
      options?.adapterCapabilities
    );
    for (const pred of parsed.predicates) {
      const bound = bindRowPolicyField(pred.field, source.sourceName, catalogResult.catalog, {
        connectionId: source.connectionId,
        schema: source.schemaDisplay ?? source.schema ?? "",
        catalogStatus: catalogResult.status,
        catalogStage:
          catalogResult.status === "manifest_unavailable" ? catalogResult.stage : undefined
      });
      if (!bound.ok) return { ok: false, reason: bound.reason, attribution: bound.attribution };
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
  /** Spec 100 — precomputed FinalRows; when set, explain uses FinalRows not bare rowGrant. */
  finalRowsBySource?: Record<string, RowGrant>;
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
    const match = matches[0];
    if (!match) continue;
    const key = `${normalizeRef(match.connectionId)}\0${normalizeRef(match.sourceName)}`;
    const finalRows = input.finalRowsBySource?.[key] ?? match.rowGrant;
    if (finalRows.kind === "scoped") {
      if (
        !protectedSources.some(
          (item) =>
            item.sourceName === normalizeRef(match.sourceName) &&
            item.connectionId === normalizeRef(match.connectionId)
        )
      ) {
        protectedSources.push({
          connectionId: match.connectionId,
          sourceName: match.sourceName,
          digest: finalRows.digest,
          grant: finalRows
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

function normalizeConstraintValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return String(value);
}

function valuesFromLeaf(leaf: { op: string; value?: unknown; values?: unknown[] }): Set<string> | null {
  if (leaf.op === "eq") {
    if (leaf.value === undefined || leaf.value === null) return null;
    return new Set([normalizeConstraintValue(leaf.value)]);
  }
  if (leaf.op === "in") {
    const raw = Array.isArray(leaf.values) ? leaf.values : Array.isArray(leaf.value) ? leaf.value : [];
    if (raw.length === 0) return null;
    return new Set(raw.map(normalizeConstraintValue));
  }
  return null;
}

function setsIntersect(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

/** Extract eq/in field constraints from lucy_query user filters (structured only). */
function extractUserEqInConstraints(filters: unknown): Map<string, Set<string>> {
  const byField = new Map<string, Set<string>>();
  if (filters === undefined || filters === null) return byField;
  const items = Array.isArray(filters) ? filters : [filters];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    if (!field || !SAFE_QUALIFIED.test(field)) continue;
    const op = typeof record.op === "string" ? record.op.trim().toLowerCase() : "";
    if (op !== "eq" && op !== "in") continue;
    const values = valuesFromLeaf({
      op,
      value: record.value,
      values: Array.isArray(record.values) ? (record.values as unknown[]) : undefined
    });
    if (!values || values.size === 0) continue;
    const existing = byField.get(field);
    if (!existing) {
      byField.set(field, values);
      continue;
    }
    // Multiple user constraints on same field AND together → keep intersection.
    const next = new Set<string>();
    for (const value of existing) {
      if (values.has(value)) next.add(value);
    }
    byField.set(field, next);
  }
  return byField;
}

/**
 * True when FinalRows = (forced OR arms) AND user eq/in filters has empty
 * intersection. Only eq/in are considered; unknown filter shapes do not trigger.
 */
export function isScopeIntersectionEmpty(
  userArgs: unknown,
  forcedFilters: ForcedFiltersPayload | undefined
): boolean {
  if (!forcedFilters?.or?.length) return false;
  const record = userArgs && typeof userArgs === "object" && !Array.isArray(userArgs)
    ? (userArgs as Record<string, unknown>)
    : {};
  const userConstraints = extractUserEqInConstraints(record.filters);
  if (userConstraints.size === 0) return false;

  // Empty if every OR arm conflicts with at least one user constraint.
  return forcedFilters.or.every((arm) => {
    for (const leaf of arm.and ?? []) {
      const field = typeof leaf.field === "string" ? leaf.field.trim() : "";
      if (!field) continue;
      const userValues = userConstraints.get(field);
      if (!userValues) continue;
      if (userValues.size === 0) return true;
      const armValues = valuesFromLeaf(leaf);
      if (!armValues) continue;
      if (!setsIntersect(userValues, armValues)) return true;
    }
    return false;
  });
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
