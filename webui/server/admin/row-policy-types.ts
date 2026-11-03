/**
 * Lucy v0.25 P1 — shared row-policy template vocabulary.
 *
 * Authority:
 *   - P1-1 §2 (P1-D1…P1-D7)、§3.1–§3.3、§5.1
 *   - P1-2 §3 (行摘要中的 `templateRefs` 与 `constraintSummary`)
 *
 * P1-1 OWNS the persistence and the compiler integration; P1-2 only READS the
 * template names for provenance. Both sides need the same shapes, so the shapes
 * live here — in a module that holds types and pure functions only, so P1-1 and
 * P1-2 can be implemented in parallel without either of them owning the other's
 * file.
 *
 * The two rules that matter and are easy to break:
 *
 *  1. **Templates are static predicates, nothing else.** No macro, no claim, no
 *     segment, no environment variable, no request-time expression. A template
 *     is a named list of `eq`/`in` predicates that the existing row-policy
 *     compiler already understands.
 *  2. **Expansion happens BEFORE the compiler.** A template reference is
 *     expanded into the same `predicates` list as an inline policy, so the
 *     runtime only ever sees one `RowGrant`. The order is fixed: template
 *     predicates first, inline predicates after — the order a reviewer reads,
 *     not an order chosen to make a digest look stable.
 */
import type { RowPolicyOp, RowPolicyPredicateInput } from "../proxy/row-policy.js";

export type { RowPolicyOp, RowPolicyPredicateInput };

/** A named static predicate set. Never carries a connection, schema or table identity. */
export type RowPolicyTemplateDefinition = {
  name: string;
  description?: string;
  predicates: RowPolicyPredicateInput[];
};

/** Where a template is referenced from, so "引用影响面" can be answered without guessing. */
export type RowPolicyTemplateReference = {
  roleId: string;
  connectionId?: string;
  schema?: string;
  /** Source names the selector covers; empty means a prefix selector. */
  sourceNames?: string[];
  /** True when the selector covers the whole schema by prefix. */
  prefixSelector?: boolean;
};

/**
 * Whether a template can be bound to one table.
 *
 * A template carries no table identity, so usability can only be decided
 * against the catalog — and the answer has FOUR distinct outcomes. Folding
 * them into "可用／不可用" is how a missing field turns into a silent
 * "全部行" (P1-1 P1-D6, P0-2 R5).
 */
export type RowPolicyTemplateUsability =
  | { status: "bindable" }
  | { status: "field_missing"; fields: string[] }
  | { status: "manifest_unavailable"; reason: string }
  | { status: "catalog_unknown"; reason: string };

export type RowPolicyTemplateUsabilityByTable = {
  connectionId: string;
  schema: string;
  sourceName: string;
  usability: RowPolicyTemplateUsability;
};

/**
 * The expanded predicate list handed to the existing compiler.
 *
 * `fromTemplate` keeps the provenance so the UI can show "引用模板／直接写条件／
 * 两者并用" without re-parsing the configuration.
 */
export type ExpandedRowPolicy = {
  predicates: RowPolicyPredicateInput[];
  templateName?: string;
  /** Predicate counts per origin, in display order. */
  templatePredicateCount: number;
  inlinePredicateCount: number;
};

/** One problem found while validating a template or a template reference. */
export type RowPolicyTemplateIssue = {
  code: string;
  /** Template name when the issue is about a template; selector identity otherwise. */
  templateName?: string;
  roleId?: string;
  detail?: string;
};

/** Template names must be usable as YAML keys and as identifiers in the UI. */
export const ROW_POLICY_TEMPLATE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * Expand a template reference into the compiler's predicate list.
 *
 * Returns issues instead of throwing: a missing template is a diagnosable
 * failure (P1-1 §5.1 `row_policy_template_unresolved`), and the caller decides
 * how to fail closed. This function never falls back to "no predicates" —
 * an empty predicate list would be indistinguishable from "no restriction".
 */
export function expandRowPolicy(input: {
  /** The template NAME the selector references, if any. */
  templateName?: string;
  /**
   * The resolved template definition.
   *
   * `null`/`undefined` while `templateName` is set means the reference cannot
   * be resolved — a diagnosable failure (P1-1 §5.1 `row_policy_template_unresolved`),
   * NOT "this selector has no template". Keeping the name and the definition
   * as separate inputs is what makes the two cases distinguishable; passing a
   * single nullable definition would collapse them.
   */
  template?: RowPolicyTemplateDefinition | null;
  inlinePredicates?: RowPolicyPredicateInput[];
}): { ok: true; expanded: ExpandedRowPolicy } | { ok: false; issues: RowPolicyTemplateIssue[] } {
  const issues: RowPolicyTemplateIssue[] = [];
  const inline = input.inlinePredicates ?? [];
  const templateName = input.templateName;

  let templatePredicates: RowPolicyPredicateInput[] = [];
  if (templateName !== undefined) {
    const template = input.template ?? null;
    if (!template) {
      return {
        ok: false,
        issues: [{ code: "row_policy_template_unresolved", templateName }]
      };
    }
    templatePredicates = template.predicates;
    if (templatePredicates.length === 0) {
      issues.push({ code: "row_policy_predicates_required", templateName });
    }
  }

  if (templatePredicates.length === 0 && inline.length === 0) {
    issues.push({ code: "row_policy_predicates_required", templateName });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    expanded: {
      // Display order is fixed: template predicates first, inline after.
      predicates: [...templatePredicates, ...inline],
      templateName,
      templatePredicateCount: templatePredicates.length,
      inlinePredicateCount: inline.length
    }
  };
}

/**
 * Find every selector that references a template.
 *
 * Used for the impact surface of a delete/rename: a referenced template cannot
 * be removed through a normal write, and an externally broken reference must
 * fail closed rather than silently degrade to "no restriction".
 */
export function scanTemplateReferences(
  selectors: Array<{
    roleId: string;
    connectionId?: string;
    schema?: string;
    sourceNames?: string[];
    prefixSelector?: boolean;
    templateName?: string;
  }>,
  templateName: string
): RowPolicyTemplateReference[] {
  const references: RowPolicyTemplateReference[] = [];
  for (const selector of selectors) {
    if (selector.templateName !== templateName) continue;
    references.push({
      roleId: selector.roleId,
      connectionId: selector.connectionId,
      schema: selector.schema,
      sourceNames: selector.sourceNames,
      prefixSelector: selector.prefixSelector
    });
  }
  return references;
}
