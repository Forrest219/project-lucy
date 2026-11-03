/**
 * Forced row policy for the Hive compile path.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §4.3.2, §4.3.4
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2 (H6)
 *
 * The contract this module implements:
 *
 * 1. **The server decides, the Agent never does.** The forced predicates come
 *    from the ACL/row-policy decision (FinalRows), which already encodes
 *    "Role 内 AND、Role 间 OR、Agent 个人行限制 AND". Whatever the Agent
 *    sent in the `forced_filters` / `forcedFilters` / policy fields is
 *    stripped before the request is normalized.
 *
 * 2. **The compute interface has no `forced_filters` field.** The KTX
 *    `SemanticQuery` model exposes `filters[]` and nothing else, so the
 *    forced predicates are converted into `filters[]` entries and prepended
 *    to the Agent's own filters. The Agent's filters are ANDed with the
 *    forced ones, so an Agent can narrow its result but never widen it.
 *
 * 3. **The predicates are injected before the aggregation.** The conversion
 *    below produces a WHERE-level expression; `ast-check.ts` then proves
 *    that the compiled statement actually carries it in a WHERE clause of a
 *    scope that still sees the protected source.
 *
 * 4. **An empty intersection is a denial, not an empty result.** If the
 *    Agent's own filters contradict the forced scope, the request is denied
 *    before the compile step — the failure must not be reported later as a
 *    successful query that returned no rows (Spec §5).
 */

import {
  buildForcedFiltersPayload,
  compileForcedFiltersToUpstreamFilterExprs,
  isScopeIntersectionEmpty,
  validateProtectedLucyQueryArgs,
  type ForcedFiltersPayload,
  type RowGrant
} from "../proxy/row-policy.js";
import { canonicalizeLucyQueryArgs } from "../proxy/lucy-query-normalization.js";

// ── request normalization ────────────────────────────────────────────────────

/**
 * Client-supplied fields that carry policy authority. They are removed from
 * the request before anything else happens.
 */
const CLIENT_POLICY_OVERRIDE_KEYS = [
  "forced_filters",
  "forcedFilters",
  "predefined_measures_only",
  "predefinedMeasuresOnly",
  "row_policy",
  "rowPolicy",
  "final_rows",
  "finalRows",
  "policy_overrides",
  "policyOverrides"
] as const;

export type HiveQueryRequest = {
  measures: Array<string | Record<string, unknown>>;
  dimensions: Array<{ field: string; granularity?: string }>;
  filters: unknown[];
  segments: string[];
  order_by: Array<{ field: string; direction?: string }>;
  limit?: number;
  include_empty: boolean;
};

export type HiveNormalizationResult =
  | { ok: true; request: HiveQueryRequest; args: Record<string, unknown> }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strip the client-supplied policy override fields.
 *
 * This runs before the request is normalized so that a forged field can never
 * reach the shape gate, the decision or the compile payload.
 */
export function stripClientPolicyOverrides(args: unknown): Record<string, unknown> {
  const record = isRecord(args) ? { ...args } : {};
  for (const key of CLIENT_POLICY_OVERRIDE_KEYS) {
    delete record[key];
  }
  return record;
}

function normalizeDimension(item: unknown): { field: string; granularity?: string } | null {
  if (typeof item === "string") {
    const field = item.trim();
    return field ? { field } : null;
  }
  if (!isRecord(item)) return null;
  const field = typeof item.field === "string" ? item.field.trim() : "";
  if (!field) return null;
  const granularity =
    typeof item.granularity === "string" && item.granularity.trim().length > 0
      ? item.granularity.trim()
      : undefined;
  return { field, granularity };
}

function normalizeOrderItem(item: unknown): { field: string; direction?: string } | null {
  if (typeof item === "string") {
    const field = item.trim();
    return field ? { field } : null;
  }
  if (!isRecord(item)) return null;
  const field = typeof item.field === "string" ? item.field.trim() : "";
  if (!field) return null;
  const direction =
    typeof item.direction === "string" && item.direction.trim().length > 0
      ? item.direction.trim().toLowerCase()
      : undefined;
  return { field, direction };
}

/**
 * Normalize the Agent's request for the Hive path.
 *
 * The order is fixed by Spec §4.3.2: normalize → bind the sources → pass the
 * existing shape gate → only then may the server inject forced predicates.
 * The shape gate is the existing one (`validateProtectedLucyQueryArgs`), so
 * the Hive path cannot drift away from the KTX path's fail-closed rules.
 */
export function normalizeHiveQueryArgs(
  args: unknown
): HiveNormalizationResult {
  const stripped = stripClientPolicyOverrides(args);
  const canonical = canonicalizeLucyQueryArgs(stripped, "lucy_query");
  if (!canonical.ok) {
    return { ok: false, reason: canonical.reason };
  }
  const record = isRecord(canonical.args) ? canonical.args : {};

  const shapeDeny = validateProtectedLucyQueryArgs(record);
  if (shapeDeny) {
    return { ok: false, reason: shapeDeny };
  }

  const measures = Array.isArray(record.measures)
    ? record.measures
        .map((item) => (typeof item === "string" ? item.trim() : item))
        .filter((item): item is string | Record<string, unknown> => item !== undefined && item !== null)
    : [];

  const dimensions = (Array.isArray(record.dimensions) ? record.dimensions : [])
    .map(normalizeDimension)
    .filter((item): item is { field: string; granularity?: string } => item !== null);

  const filters = Array.isArray(record.filters)
    ? record.filters
    : record.filters === undefined || record.filters === null
      ? []
      : [record.filters];

  const segments = Array.isArray(record.segments)
    ? record.segments.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const orderBy = (Array.isArray(record.order_by) ? record.order_by : [])
    .map(normalizeOrderItem)
    .filter((item): item is { field: string; direction?: string } => item !== null);

  const limit = typeof record.limit === "number" && Number.isInteger(record.limit) && record.limit >= 0
    ? record.limit
    : undefined;
  const includeEmpty = record.include_empty === undefined ? true : record.include_empty === true;

  return {
    ok: true,
    request: {
      measures,
      dimensions,
      filters,
      segments,
      order_by: orderBy,
      limit,
      include_empty: includeEmpty
    },
    args: record
  };
}

// ── source binding ──────────────────────────────────────────────────────────

export type HiveSourceBinding = {
  /** Lucy source name (the table name) → KTX source name (the SQL alias). */
  sourceNameByLogicalName: ReadonlyMap<string, string>;
};

export type HiveBindingResult =
  | { ok: true; bindings: Map<string, string> }
  | { ok: false; reason: string };

/**
 * Bind every source the request mentions to its KTX source name.
 *
 * A request that mentions a source which is not part of the authorized
 * closure is denied here — before the compile step, and before any filter is
 * injected.
 */
export function bindHiveQuerySources(
  request: HiveQueryRequest,
  binding: HiveSourceBinding
): HiveBindingResult {
  const bindings = new Map<string, string>();
  const mentions: string[] = [];

  const pushMeasure = (measure: string | Record<string, unknown>): void => {
    const ref = typeof measure === "string" ? measure : measure.ref;
    if (typeof ref !== "string") return;
    const dot = ref.indexOf(".");
    if (dot > 0) mentions.push(ref.slice(0, dot));
  };
  request.measures.forEach(pushMeasure);
  request.dimensions.forEach((dimension) => {
    const dot = dimension.field.indexOf(".");
    if (dot > 0) mentions.push(dimension.field.slice(0, dot));
  });
  request.segments.forEach((segment) => {
    const dot = segment.indexOf(".");
    if (dot > 0) mentions.push(segment.slice(0, dot));
  });
  request.order_by.forEach((item) => {
    const dot = item.field.indexOf(".");
    if (dot > 0) mentions.push(item.field.slice(0, dot));
  });

  for (const logical of mentions) {
    const ktxName = binding.sourceNameByLogicalName.get(logical);
    if (!ktxName) {
      return {
        ok: false,
        reason: `hive_source_not_bound:${logical}`
      };
    }
    bindings.set(logical, ktxName);
  }

  return { ok: true, bindings };
}

// ── forced filters ───────────────────────────────────────────────────────────

export type HiveForcedFilters = {
  /** Filter expressions to prepend to `filters[]`. */
  filters: string[];
  /** Row-grant digests, for the audit record. */
  digests: string[];
  /** The KTX source alias the forced predicates constrain. */
  sourceAlias?: string;
};

export type HiveForcedFilterResult =
  | { ok: true; forced: HiveForcedFilters }
  | { ok: false; reason: string };

function rewritePayloadSourceNames(
  payload: ForcedFiltersPayload,
  logicalSourceName: string,
  ktxSourceName: string
): ForcedFiltersPayload {
  return {
    or: payload.or.map((arm) => ({
      and: arm.and.map((leaf) => {
        const column = leaf.field.includes(".")
          ? leaf.field.slice(leaf.field.indexOf(".") + 1)
          : leaf.field;
        return { ...leaf, field: `${ktxSourceName}.${column}` };
      })
    }))
  };
}

/**
 * Convert the server-side row decision into `filters[]` entries.
 *
 * The Role/Agent algebra is already resolved in the grant: each OR arm is one
 * Role's AND-group, and the Agent's personal row limit has been ANDed into
 * every arm by the FinalRows synthesis. This function only changes the
 * representation.
 *
 * `logicalSourceName` is the Lucy source name the grant was compiled
 * against; `ktxSourceName` is the SQL alias the compiled statement uses. The
 * qualifier is rewritten because Hive source names carry the database
 * (`finance_orders`), while the row policy is bound to the table name.
 */
export function buildHiveForcedFilters(input: {
  grant: RowGrant | undefined;
  logicalSourceName: string;
  ktxSourceName: string;
}): HiveForcedFilterResult {
  const grant = input.grant;
  if (!grant || grant.kind === "all") {
    return { ok: true, forced: { filters: [], digests: [] } };
  }

  const payload = buildForcedFiltersPayload(grant, input.logicalSourceName);
  if (!payload || payload.or.length === 0) {
    // Fail closed: a scoped grant that produces no predicate must not be
    // turned into "no restriction".
    return {
      ok: false,
      reason: "row_policy_forced_filters_empty"
    };
  }

  const rewritten = rewritePayloadSourceNames(
    payload,
    input.logicalSourceName,
    input.ktxSourceName
  );

  let filters: string[];
  try {
    filters = compileForcedFiltersToUpstreamFilterExprs(rewritten);
  } catch (error) {
    return {
      ok: false,
      reason: `row_policy_forced_filter_uncompilable:${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (filters.length === 0) {
    return { ok: false, reason: "row_policy_forced_filters_empty" };
  }

  return {
    ok: true,
    forced: { filters, digests: grant.kind === "scoped" ? [grant.digest] : [], sourceAlias: input.ktxSourceName }
  };
}

// ── compiler query assembly ──────────────────────────────────────────────────

export type HiveCompilerQuery = {
  measures: Array<string | Record<string, unknown>>;
  dimensions: Array<{ field: string; granularity?: string }>;
  filters: string[];
  segments: string[];
  order_by: Array<Record<string, unknown>>;
  limit: number;
  include_empty: boolean;
};

export type HiveQueryAssemblyResult =
  | {
      ok: true;
      query: HiveCompilerQuery;
      forced: HiveForcedFilters;
      /** The predicate expressions the AST check has to prove. */
      requiredPredicates: Array<{ expression: string; sourceAlias: string }>;
    }
  | { ok: false; reason: string };

function rewriteQualified(
  reference: string,
  bindings: ReadonlyMap<string, string>
): string | undefined {
  const dot = reference.indexOf(".");
  if (dot <= 0) return reference;
  const logical = reference.slice(0, dot);
  const rest = reference.slice(dot + 1);
  const ktxName = bindings.get(logical);
  if (!ktxName) return undefined;
  return `${ktxName}.${rest}`;
}

/**
 * Assemble the query the compile bridge receives.
 *
 * The Agent's own filters are preserved and ANDed with the forced ones. The
 * forced filters are placed FIRST so that the intent is visible in the
 * compiled SQL, but the order carries no meaning for the AND semantics.
 */
export function buildHiveCompilerQuery(input: {
  request: HiveQueryRequest;
  bindings: ReadonlyMap<string, string>;
  forced: HiveForcedFilters;
  maxLimit: number;
  includeEmpty?: boolean;
}): HiveQueryAssemblyResult {
  const { request, bindings, forced } = input;

  const measures: Array<string | Record<string, unknown>> = [];
  for (const measure of request.measures) {
    if (typeof measure === "string") {
      const rewritten = rewriteQualified(measure, bindings);
      if (rewritten === undefined) {
        return { ok: false, reason: `hive_source_not_bound:${measure}` };
      }
      measures.push(rewritten);
      continue;
    }
    const record: Record<string, unknown> = { ...measure };
    if (typeof record.ref === "string") {
      const rewritten = rewriteQualified(record.ref, bindings);
      if (rewritten === undefined) {
        return { ok: false, reason: `hive_source_not_bound:${record.ref}` };
      }
      record.ref = rewritten;
    }
    measures.push(record);
  }

  const dimensions: Array<{ field: string; granularity?: string }> = [];
  for (const dimension of request.dimensions) {
    const rewritten = rewriteQualified(dimension.field, bindings);
    if (rewritten === undefined) {
      return { ok: false, reason: `hive_source_not_bound:${dimension.field}` };
    }
    dimensions.push(
      dimension.granularity
        ? { field: rewritten, granularity: dimension.granularity }
        : { field: rewritten }
    );
  }

  const segments: string[] = [];
  for (const segment of request.segments) {
    const rewritten = rewriteQualified(segment, bindings);
    if (rewritten === undefined) {
      return { ok: false, reason: `hive_source_not_bound:${segment}` };
    }
    segments.push(rewritten);
  }

  const orderBy: Array<Record<string, unknown>> = [];
  for (const item of request.order_by) {
    const rewritten = rewriteQualified(item.field, bindings);
    if (rewritten === undefined) {
      return { ok: false, reason: `hive_source_not_bound:${item.field}` };
    }
    orderBy.push(item.direction ? { field: rewritten, direction: item.direction } : { field: rewritten });
  }

  const clientFilters: string[] = [];
  for (const filter of request.filters) {
    if (typeof filter === "string") {
      // A raw SQL fragment is not a filter: it would reach the compute layer
      // neither bound to a source alias nor escaped, and nothing downstream
      // can tell where the fragment ends. The shape gate already refuses this
      // shape (`filters_string_forbidden_on_scoped`); this second gate makes
      // sure a request that skipped normalization cannot smuggle one in.
      // Rejecting is the safe choice — quoting it would silently turn a
      // predicate into a string constant.
      return { ok: false, reason: "hive_filter_string_forbidden" };
    }
    if (!isRecord(filter)) {
      return { ok: false, reason: "hive_filter_invalid" };
    }
    const field = typeof filter.field === "string" ? filter.field.trim() : "";
    if (!field) {
      return { ok: false, reason: "hive_filter_invalid" };
    }
    const rewritten = rewriteQualified(field, bindings);
    if (rewritten === undefined) {
      return { ok: false, reason: `hive_source_not_bound:${field}` };
    }
    const op = typeof filter.op === "string" ? filter.op.trim().toLowerCase() : "";
    if (op !== "eq" && op !== "in") {
      // Only eq/in survive into the compute interface; richer shapes are
      // rejected rather than silently dropped.
      return { ok: false, reason: "hive_filter_op_forbidden" };
    }
    if (op === "eq") {
      clientFilters.push(`${rewritten} = ${sqlLiteral(filter.value)}`);
      continue;
    }
    const values = Array.isArray(filter.values) ? filter.values : Array.isArray(filter.value) ? filter.value : [];
    if (values.length === 0) {
      return { ok: false, reason: "hive_filter_values_invalid" };
    }
    clientFilters.push(
      `${rewritten} IN (${values.map((value) => sqlLiteral(value)).join(", ")})`
    );
  }

  const limit = Math.min(request.limit ?? input.maxLimit, input.maxLimit);

  return {
    ok: true,
    query: {
      measures,
      dimensions,
      filters: [...forced.filters, ...clientFilters],
      segments,
      order_by: orderBy,
      limit,
      include_empty: input.includeEmpty ?? request.include_empty
    },
    forced,
    requiredPredicates: forced.filters.map((expression) => ({
      expression,
      sourceAlias: forced.sourceAlias ?? ""
    }))
  };
}

/**
 * SQL literal rendering for client filters.
 *
 * The escaping matches the existing forced-filter compiler in
 * `proxy/row-policy.ts` so that a user filter and a forced filter cannot be
 * distinguished by their escaping. Backslash handling in Hive string
 * literals is dialect/version dependent and must be confirmed against a real
 * HS2 (Spec V03/V12) — it is not proven here.
 */
function sqlLiteral(value: unknown): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Deny a request whose own filters contradict the forced scope.
 *
 * Without this check the contradiction would surface as a successful query
 * with zero rows, which is exactly the "empty result masquerading as a
 * success" the Spec forbids.
 */
export function hiveScopeContradiction(
  request: HiveQueryRequest,
  forcedPayload: ForcedFiltersPayload | undefined
): boolean {
  if (!forcedPayload) return false;
  return isScopeIntersectionEmpty({ filters: request.filters }, forcedPayload);
}
