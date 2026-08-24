/**
 * AC-P1.5 Agent Constraints — compile + FinalRows AND (Spec 100 / WO-61 WP-I1/I2).
 * Gate B approved 2026-08-09.
 */
import { createHash } from "node:crypto";
import {
  loadSourceFieldCatalog,
  bindRowPolicyField,
  parseRowPolicyShape,
  type ResolvedRowPolicyPredicate,
  type RowGrant,
  type RowPolicyPredicateInput
} from "./row-policy.js";

/** Spec 100 §6 — exact integers. */
export const MAX_ROLE_ARMS_PER_SOURCE = 16;
export const MAX_CONSTRAINT_PREDICATES_PER_SOURCE = 16;
export const MAX_PREDICATES_PER_DNF_ARM = 32;
export const MAX_DNF_ARMS_PER_SOURCE = 64;
export const MAX_DNF_PREDICATES_TOTAL_PER_SOURCE = 512;

export interface ConstraintSourceBindingInput {
  connection: string;
  schema?: string;
  names: string[];
  predicates: RowPolicyPredicateInput[];
}

export interface CompiledAgentConstraints {
  /** Key: connectionId\\0sourceName → AND predicates (AgentConstraints ≠ TRUE). */
  bySource: Map<string, ResolvedRowPolicyPredicate[]>;
}

export type CompileAgentConstraintsResult =
  | { ok: true; constraints: CompiledAgentConstraints }
  | { ok: false; reason: string };

export interface CapabilitySourceRef {
  connectionId: string;
  sourceName: string;
  schema?: string;
  physicalTable: string;
  rowGrant: RowGrant;
}

function normalizeRef(value: string): string {
  return value.trim().toLowerCase();
}

export function constraintsSourceKey(connectionId: string, sourceName: string): string {
  return `${normalizeRef(connectionId)}\0${normalizeRef(sourceName)}`;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function scalarEncode(value: string | number | boolean): string {
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "boolean") return `b:${value ? "1" : "0"}`;
  return `n:${value}`;
}

/**
 * Spec 100 §5.4 — same-field literal unsatisfiability on an AND group.
 * Values compared with typed strict equality (no case fold).
 */
export function isAndGroupUnsatisfiable(predicates: ResolvedRowPolicyPredicate[]): boolean {
  const byField = new Map<string, ResolvedRowPolicyPredicate[]>();
  for (const pred of predicates) {
    const key = `${normalizeRef(pred.sourceName)}\0${normalizeRef(pred.field)}`;
    const list = byField.get(key) ?? [];
    list.push(pred);
    byField.set(key, list);
  }

  for (const group of byField.values()) {
    let domain: Set<string> | null = null;
    for (const pred of group) {
      let next: Set<string>;
      if (pred.op === "eq") {
        if (pred.value === undefined || !isScalar(pred.value)) return true;
        next = new Set([scalarEncode(pred.value)]);
      } else {
        const values = pred.values ?? [];
        if (values.length === 0) return true;
        next = new Set(values.map(scalarEncode));
        if (next.size === 0) return true;
      }
      if (domain === null) {
        domain = next;
      } else {
        domain = new Set([...domain].filter((item) => next.has(item)));
      }
      if (domain.size === 0) return true;
    }
  }
  return false;
}

export function parseAgentConstraintsShape(
  raw: unknown
): { ok: true; bindings: ConstraintSourceBindingInput[] } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "constraints_invalid_shape" };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "sources") return { ok: false, reason: "constraints_invalid_shape" };
  }
  if (!Array.isArray(record.sources) || record.sources.length === 0) {
    return { ok: false, reason: "constraints_invalid_shape" };
  }

  const bindings: ConstraintSourceBindingInput[] = [];
  for (const item of record.sources) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, reason: "constraints_invalid_shape" };
    }
    const binding = item as Record<string, unknown>;
    if (binding.prefix !== undefined) return { ok: false, reason: "constraints_invalid_shape" };
    if (typeof binding.connection !== "string" || !binding.connection.trim()) {
      return { ok: false, reason: "constraints_invalid_shape" };
    }
    if (binding.schema !== undefined && typeof binding.schema !== "string") {
      return { ok: false, reason: "constraints_invalid_shape" };
    }
    if (!Array.isArray(binding.names) || binding.names.length === 0 || binding.names.some((n) => typeof n !== "string" || !n.trim())) {
      return { ok: false, reason: "constraints_invalid_shape" };
    }
    const parsed = parseRowPolicyShape({ predicates: binding.predicates });
    if (!parsed.ok) {
      // Map row_policy shape failures to constraints_invalid_shape except field/op codes tests expect.
      if (parsed.reason.startsWith("row_policy_op_forbidden") || parsed.reason.startsWith("row_policy_field_unresolved")) {
        return { ok: false, reason: parsed.reason };
      }
      return { ok: false, reason: "constraints_invalid_shape" };
    }
    bindings.push({
      connection: binding.connection.trim(),
      schema: typeof binding.schema === "string" ? binding.schema : undefined,
      names: binding.names.map((name) => String(name)),
      predicates: parsed.predicates
    });
  }
  return { ok: true, bindings };
}

function connectionSchemaMatches(
  binding: ConstraintSourceBindingInput,
  source: CapabilitySourceRef
): boolean {
  if (normalizeRef(binding.connection) !== normalizeRef(source.connectionId)) return false;
  if (binding.schema !== undefined && normalizeRef(binding.schema) !== normalizeRef(source.schema ?? "")) {
    return false;
  }
  return true;
}

/** Spec 100 §4 — each `names[]` entry must resolve to ≥1 capability source. */
function nameMatchesSource(name: string, source: CapabilitySourceRef): boolean {
  const n = normalizeRef(name);
  return n === normalizeRef(source.sourceName) || n === normalizeRef(source.physicalTable);
}

function uniqueCapabilitySources(capabilities: CapabilitySourceRef[]): CapabilitySourceRef[] {
  const map = new Map<string, CapabilitySourceRef>();
  for (const source of capabilities) {
    const key = constraintsSourceKey(source.connectionId, source.sourceName);
    if (!map.has(key)) map.set(key, source);
  }
  return [...map.values()];
}

function roleArmsForGrant(grant: RowGrant): number {
  if (grant.kind === "all") return 0;
  return grant.orArms.length;
}

/**
 * Spec 100 §6 — hard limits per sourceKey, counted after field bind / before EffectivePolicy write.
 * Applies with or without Agent `constraints` (absorbed R / C / R∧C).
 */
export function enforceFinalRowsLimits(
  source: CapabilitySourceRef,
  constraintPreds: ResolvedRowPolicyPredicate[]
): string | null {
  const roleArms = roleArmsForGrant(source.rowGrant);
  if (roleArms > MAX_ROLE_ARMS_PER_SOURCE) return "final_rows_limit_exceeded";
  if (constraintPreds.length > MAX_CONSTRAINT_PREDICATES_PER_SOURCE) return "final_rows_limit_exceeded";

  // FinalRows=TRUE — no DNF arm/predicate size checks.
  if (source.rowGrant.kind === "all" && constraintPreds.length === 0) return null;

  // Absorbed C: all ∧ Constraints → single arm C.
  if (source.rowGrant.kind === "all") {
    if (constraintPreds.length > MAX_PREDICATES_PER_DNF_ARM) return "final_rows_limit_exceeded";
    if (constraintPreds.length > MAX_DNF_PREDICATES_TOTAL_PER_SOURCE) return "final_rows_limit_exceeded";
    return null;
  }

  // Absorbed R (C≡TRUE) or R∧C — count pre-prune DNF on Role arms.
  const dnfArms = source.rowGrant.orArms.length;
  if (dnfArms > MAX_DNF_ARMS_PER_SOURCE) return "final_rows_limit_exceeded";
  let total = 0;
  for (const arm of source.rowGrant.orArms) {
    const perArm = arm.length + constraintPreds.length;
    if (perArm > MAX_PREDICATES_PER_DNF_ARM) return "final_rows_limit_exceeded";
    total += perArm;
  }
  if (total > MAX_DNF_PREDICATES_TOTAL_PER_SOURCE) return "final_rows_limit_exceeded";
  return null;
}

/**
 * Compile Agent `constraints` (Spec 100 §3–§6).
 * Caller must already have Role Set capabilities (for source-in-capability checks).
 */
export async function compileAgentConstraints(
  raw: unknown,
  capabilities: CapabilitySourceRef[]
): Promise<CompileAgentConstraintsResult> {
  const parsed = parseAgentConstraintsShape(raw);
  if (!parsed.ok) return parsed;

  const capSources = uniqueCapabilitySources(capabilities);
  const bySource = new Map<string, ResolvedRowPolicyPredicate[]>();

  for (const binding of parsed.bindings) {
    // Spec 100 §4: every name in b.names must fall into EffectiveDataCapabilities.
    // Mixed valid+invalid (e.g. [fin_ledger, typo]) must fail — not silently drop typo.
    const matchedKeys = new Map<string, CapabilitySourceRef>();
    for (const name of binding.names) {
      const nameHits = capSources.filter(
        (source) => connectionSchemaMatches(binding, source) && nameMatchesSource(name, source)
      );
      if (nameHits.length === 0) {
        return { ok: false, reason: "constraints_source_not_in_capability" };
      }
      for (const source of nameHits) {
        matchedKeys.set(constraintsSourceKey(source.connectionId, source.sourceName), source);
      }
    }

    for (const source of matchedKeys.values()) {
      const catalog = await loadSourceFieldCatalog(source.connectionId, source.sourceName, source.schema);
      const resolved: ResolvedRowPolicyPredicate[] = [];
      for (const pred of binding.predicates) {
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

      const key = constraintsSourceKey(source.connectionId, source.sourceName);
      const merged = [...(bySource.get(key) ?? []), ...resolved];
      bySource.set(key, merged);
    }
  }

  for (const [key, preds] of bySource) {
    if (preds.length > MAX_CONSTRAINT_PREDICATES_PER_SOURCE) {
      return { ok: false, reason: "final_rows_limit_exceeded" };
    }
    if (isAndGroupUnsatisfiable(preds)) {
      return { ok: false, reason: "final_rows_unsatisfiable" };
    }
    const source = capSources.find(
      (item) => constraintsSourceKey(item.connectionId, item.sourceName) === key
    );
    if (!source) continue;
    const limitFail = enforceFinalRowsLimits(source, preds);
    if (limitFail) return { ok: false, reason: limitFail };
  }

  // Role-arm overflow even when this source has no constraints (Spec 100 §6).
  for (const source of capSources) {
    if (roleArmsForGrant(source.rowGrant) > MAX_ROLE_ARMS_PER_SOURCE) {
      return { ok: false, reason: "final_rows_limit_exceeded" };
    }
  }

  return { ok: true, constraints: { bySource } };
}

// ─── WP-I2 FinalRows AND / DNF (Spec 100 §5 / §8) ────────────────────────────

type TypedScalar = { t: "string" | "number" | "boolean"; v: string | number | boolean };

function toTypedScalar(value: string | number | boolean): TypedScalar {
  if (typeof value === "string") return { t: "string", v: value };
  if (typeof value === "boolean") return { t: "boolean", v: value };
  return { t: "number", v: value };
}

function typedScalarSortKey(scalar: TypedScalar): string {
  return `${scalar.t}\0${String(scalar.v)}`;
}

function normLeafForDigest(pred: ResolvedRowPolicyPredicate): Record<string, unknown> {
  const leaf: Record<string, unknown> = {
    sourceName: normalizeRef(pred.sourceName),
    field: normalizeRef(pred.field),
    op: pred.op
  };
  if (pred.op === "eq") {
    leaf.value = pred.value === undefined ? null : toTypedScalar(pred.value);
  } else {
    const values = [...(pred.values ?? [])].map(toTypedScalar);
    values.sort((a, b) => typedScalarSortKey(a).localeCompare(typedScalarSortKey(b)));
    // Deduplicate by typed key while preserving first original TypedScalar.
    const seen = new Set<string>();
    leaf.values = values.filter((item) => {
      const key = typedScalarSortKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return leaf;
}

/** Spec 100 §8 — FinalRowsDigest over pruned DNF (values preserve case/type). */
export function finalRowsDigest(orArms: ResolvedRowPolicyPredicate[][]): string {
  if (orArms.length === 0) return "TRUE";
  const normDnf = orArms
    .map((arm) =>
      [...arm]
        .map(normLeafForDigest)
        .sort((a, b) =>
          `${a.sourceName}\0${a.field}\0${a.op}\0${JSON.stringify(a.value ?? a.values)}`.localeCompare(
            `${b.sourceName}\0${b.field}\0${b.op}\0${JSON.stringify(b.value ?? b.values)}`
          )
        )
    )
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(normDnf)).digest("hex").slice(0, 16);
}

function scopedFinalRows(orArms: ResolvedRowPolicyPredicate[]): Extract<RowGrant, { kind: "scoped" }> {
  const predicates = orArms.flat();
  return {
    kind: "scoped",
    digest: finalRowsDigest(orArms),
    predicates,
    orArms
  };
}

/**
 * Spec 100 §5 — FinalRows = EffectiveRowGrant AND AgentConstraints (DNF + prune).
 * Compile-time and hot-path share this function; empty after prune → unsatisfiable.
 */
export function synthesizeFinalRows(
  effectiveGrant: RowGrant,
  constraints: ResolvedRowPolicyPredicate[] | undefined
): { ok: true; finalRows: RowGrant } | { ok: false; reason: "final_rows_unsatisfiable" } {
  const c = constraints && constraints.length > 0 ? constraints : undefined;

  if (effectiveGrant.kind === "all" && !c) {
    return { ok: true, finalRows: { kind: "all" } };
  }
  if (effectiveGrant.kind === "all" && c) {
    if (isAndGroupUnsatisfiable(c)) return { ok: false, reason: "final_rows_unsatisfiable" };
    return { ok: true, finalRows: scopedFinalRows([c]) };
  }
  if (effectiveGrant.kind === "scoped" && !c) {
    return { ok: true, finalRows: effectiveGrant };
  }

  // Both non-TRUE: ∨_i (R_i ∧ C), drop unsatisfiable arms.
  if (effectiveGrant.kind !== "scoped" || !c) {
    return { ok: true, finalRows: effectiveGrant };
  }
  const kept: ResolvedRowPolicyPredicate[][] = [];
  for (const arm of effectiveGrant.orArms) {
    const merged = [...arm, ...c];
    if (!isAndGroupUnsatisfiable(merged)) kept.push(merged);
  }
  if (kept.length === 0) return { ok: false, reason: "final_rows_unsatisfiable" };
  return { ok: true, finalRows: scopedFinalRows(kept) };
}

/**
 * Build per-source FinalRows for an Agent (compile-time).
 * Fails closed if any source's DNF prunes to empty.
 */
export function compileFinalRowsBySource(
  capabilities: CapabilitySourceRef[],
  constraintsBySource: Map<string, ResolvedRowPolicyPredicate[]> | undefined
): { ok: true; finalRowsBySource: Record<string, RowGrant> } | { ok: false; reason: string } {
  const out: Record<string, RowGrant> = {};
  const seen = new Set<string>();
  for (const source of capabilities) {
    const key = constraintsSourceKey(source.connectionId, source.sourceName);
    if (seen.has(key)) continue;
    seen.add(key);
    const preds = constraintsBySource?.get(key) ?? [];
    // Spec 100 §6 — enforce even when Agent has no `constraints` key (absorbed R).
    const limitFail = enforceFinalRowsLimits(source, preds);
    if (limitFail) return { ok: false, reason: limitFail };
    const synthesized = synthesizeFinalRows(source.rowGrant, preds.length > 0 ? preds : undefined);
    if (!synthesized.ok) return synthesized;
    out[key] = synthesized.finalRows;
  }
  return { ok: true, finalRowsBySource: out };
}

export function lookupFinalRows(
  finalRowsBySource: Record<string, RowGrant> | undefined,
  connectionId: string,
  sourceName: string,
  fallbackGrant: RowGrant
): RowGrant {
  const key = constraintsSourceKey(connectionId, sourceName);
  return finalRowsBySource?.[key] ?? fallbackGrant;
}

