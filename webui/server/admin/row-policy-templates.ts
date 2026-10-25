/**
 * Lucy v0.25 P1 — L25-14 R1: 行策略模板模型、展开与引用面.
 *
 * Authority: docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
 *   §3.1 (模板与引用), §3.2 (模板读取模型), §4 (管理 API 与写入合同),
 *   §5.1 (展开与编译), §5.2 (模板保存); P1-D1 / P1-D2 / P1-D4.
 * Upstream: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md
 *   §4 (行策略形状约束), §5.1 (展开与编译).
 *
 * Three invariants this module protects, in order of how easily they break:
 *
 *  1. **Expansion happens BEFORE the existing row-policy compiler.** A template
 *     reference is expanded into the SAME `predicates` list as an inline policy,
 *     so the compiler only ever sees one `RowGrant` (P1-D2). The expansion is a
 *     pure config → config transform, so it can be applied by ANY caller that
 *     owns a config — the Admin surfaces here and the runtime alike.
 *  2. **A missing reference fails closed.** `row_policy_template_unresolved` is
 *     returned as an issue; it is NEVER turned into "no predicates" (which would
 *     be indistinguishable from 「行权限：全部行」) and never into an inline
 *     rewrite. The failed selector is replaced by a shape the existing compiler
 *     rejects, so the runtime denies instead of widening.
 *  3. **One permission algebra.** The shape check reuses
 *     `parseRowPolicyShape` and the expansion reuses `expandRowPolicy`; this
 *     module never re-implements predicate parsing.
 *
 * ── RUNTIME INTEGRATION CONTRACT (pending, outside this module's files) ──────
 *
 * The existing compiler (`proxy/row-policy.ts` `parseRowPolicyShape`) accepts a
 * `row_policy` object with exactly ONE key: `predicates`. The Spec's reference
 * shape (`row_policy: { template, predicates }`, P1-1 §3.1) therefore has to be
 * expanded BEFORE it reaches that parser — which happens in the runtime, not in
 * the Admin surfaces.
 *
 * `expandRowPolicyTemplatesInConfig` is that expansion, and it is deliberately
 * a plain config → config function so the runtime can call it with ONE line at
 * each of the two places that turn access.yaml into a runtime config:
 *
 *   - `webui/server/proxy/identity.ts` → `loadConfig()`: expand right after
 *     `parse(content)`, before the config is cached.
 *   - `webui/server/proxy/acl.ts` → `commitEffectivePolicyUnlocked()`: expand
 *     right after `parsed as AccessConfig`, before the policy is compiled and
 *     committed.
 *
 * Until that hook lands, a Role that references a template FAILS CLOSED at the
 * runtime (`row_policy_invalid_key`) — it never widens to 「全部行」. Both hooks
 * are in `webui/server/proxy/**`, which this wave does not own.
 */
import { computeCandidateDigest } from "../config-digest.js";
import { parseRowPolicyShape, type RowPolicyPredicateInput } from "../proxy/row-policy.js";
import {
  loadSourceFieldCatalogWithProvenance,
  type RowPolicyCatalogResult
} from "../proxy/row-policy-catalog.js";
import type { AccessConfig } from "../proxy/identity.js";
import {
  ROW_POLICY_TEMPLATE_NAME_PATTERN,
  expandRowPolicy,
  scanTemplateReferences,
  type RowPolicyTemplateDefinition,
  type RowPolicyTemplateIssue,
  type RowPolicyTemplateReference,
  type RowPolicyTemplateUsability
} from "./row-policy-types.js";

/** access.yaml with the P1 top-level `row_policy_templates` block. */
export type AccessConfigWithTemplates = AccessConfig & {
  row_policy_templates?: Record<string, unknown>;
};

/** Validated templates, keyed by template name. */
export type RowPolicyTemplateCatalog = Record<string, RowPolicyTemplateDefinition>;

/** The selector fields this module reads. Structural — `AccessConfig` does not export them. */
export type RowPolicyTemplateSelectorShape = {
  connection?: string;
  schema?: string;
  names?: string[];
  prefix?: string;
  row_access?: string;
  row_policy?: unknown;
};

/** Stable issue codes. The Admin surfaces map them to operator-facing copy. */
export const ROW_POLICY_TEMPLATE_ISSUE_CODES = {
  nameInvalid: "row_policy_template_name_invalid",
  shapeInvalid: "row_policy_template_shape_invalid",
  exists: "row_policy_template_exists",
  notFound: "row_policy_template_not_found",
  inUse: "row_policy_template_in_use",
  unresolved: "row_policy_template_unresolved",
  predicatesRequired: "row_policy_predicates_required",
  onAllForbidden: "row_policy_on_all_forbidden",
  v1Forbidden: "v1_template_reference_forbidden"
} as const;

function roleShape(role: unknown): { description?: string; permission_model_version?: number; allow?: { tableSelectors?: unknown } } {
  return (role ?? {}) as { description?: string; permission_model_version?: number; allow?: { tableSelectors?: unknown } };
}

/** The selectors of one Role, in configuration order. */
export function selectorsOfRole(role: unknown): RowPolicyTemplateSelectorShape[] {
  const selectors = roleShape(role).allow?.tableSelectors;
  return Array.isArray(selectors) ? (selectors as RowPolicyTemplateSelectorShape[]) : [];
}

/** The Role ids of a configuration, sorted — the stable order every surface renders in. */
export function roleIdsOf(config: AccessConfigWithTemplates): string[] {
  return Object.keys(config.roles ?? {}).sort();
}

// ─── C1: shape validation ─────────────────────────────────────────────────────

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * Normalize the values of one `in` predicate.
 *
 * - 去空: null / undefined entries are dropped. They are already rejected by
 *   `parseRowPolicyShape`, but the helper stays defensive because a template may
 *   be authored outside the Admin UI.
 * - 去重: exact duplicates are dropped, keeping the FIRST occurrence. The type
 *   is preserved, so `1` and `"1"` stay two different values — collapsing them
 *   would change which rows match.
 * - The ORDER is preserved for display; the digest sorts the values separately,
 *   so `in.values` order never changes the semantics or the digest (P1-1 §3.1).
 */
export function normalizeRowPolicyInValues(
  values: ReadonlyArray<string | number | boolean>
): Array<string | number | boolean> {
  const seen = new Set<string>();
  const out: Array<string | number | boolean> = [];
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (!isScalar(value)) continue;
    // The type is part of the identity: `1` and `"1"` are different values.
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * Canonical form of a template's predicates, used for the digest.
 *
 * `in` values are sorted so that re-ordering them cannot change the digest
 * (P1-1 §3.1: 「`in.values` 的顺序不影响语义或摘要」). The predicate order
 * itself is NOT sorted: the display order 「模板谓词在前、内联谓词在后」is
 * what a reviewer reads, and reordering it would change what the reviewer sees.
 */
export function canonicalRowPolicyTemplatePredicates(
  predicates: ReadonlyArray<RowPolicyPredicateInput>
): Array<Record<string, unknown>> {
  return predicates.map((predicate) => {
    if (predicate.op === "in") {
      const values = [...(predicate.values ?? [])].sort((a, b) => {
        const left = `${typeof a}:${String(a)}`;
        const right = `${typeof b}:${String(b)}`;
        return left.localeCompare(right);
      });
      return { field: predicate.field, op: "in", values };
    }
    return { field: predicate.field, op: "eq", value: predicate.value };
  });
}

/**
 * Digest of a template's semantic content.
 *
 * Two templates with the same predicates but a different `in` value order share
 * the digest; two templates that differ in any predicate do not.
 */
export function rowPolicyTemplateDigest(definition: RowPolicyTemplateDefinition): string {
  return computeCandidateDigest({
    name: definition.name,
    predicates: canonicalRowPolicyTemplatePredicates(definition.predicates)
  });
}

export type RowPolicyTemplateValidation =
  | { ok: true; definition: RowPolicyTemplateDefinition }
  | { ok: false; issues: RowPolicyTemplateIssue[] };

/**
 * Validate one template definition.
 *
 * The predicate shape is checked by the EXISTING compiler entry point
 * (`parseRowPolicyShape`) so the template and an inline policy can never
 * disagree about what a valid predicate is (P1-1 §5.1).
 */
export function validateRowPolicyTemplateDefinition(
  name: string,
  raw: unknown
): RowPolicyTemplateValidation {
  const issues: RowPolicyTemplateIssue[] = [];
  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, issues: [{ code: ROW_POLICY_TEMPLATE_ISSUE_CODES.nameInvalid, templateName: name }] };
  }
  const templateName = name.trim();
  if (!ROW_POLICY_TEMPLATE_NAME_PATTERN.test(templateName)) {
    return {
      ok: false,
      issues: [
        {
          code: ROW_POLICY_TEMPLATE_ISSUE_CODES.nameInvalid,
          templateName,
          detail: "template name must match ^[A-Za-z_][A-Za-z0-9_-]*$"
        }
      ]
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [{ code: ROW_POLICY_TEMPLATE_ISSUE_CODES.shapeInvalid, templateName, detail: "template must be an object" }]
    };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "description" && key !== "predicates") {
      return {
        ok: false,
        issues: [
          { code: ROW_POLICY_TEMPLATE_ISSUE_CODES.shapeInvalid, templateName, detail: `template.${key} is not allowed` }
        ]
      };
    }
  }
  if (record.description !== undefined && typeof record.description !== "string") {
    return {
      ok: false,
      issues: [
        { code: ROW_POLICY_TEMPLATE_ISSUE_CODES.shapeInvalid, templateName, detail: "template.description must be a string" }
      ]
    };
  }
  const parsed = parseRowPolicyShape({ predicates: record.predicates });
  if (!parsed.ok) {
    return {
      ok: false,
      issues: [{ code: parsed.reason, templateName, detail: `template predicates rejected (${parsed.reason})` }]
    };
  }
  const predicates: RowPolicyPredicateInput[] = parsed.predicates.map(
    (predicate): RowPolicyPredicateInput =>
      predicate.op === "in"
        ? { field: predicate.field, op: "in", values: normalizeRowPolicyInValues(predicate.values ?? []) }
        : { field: predicate.field, op: "eq", value: predicate.value }
  );
  if (predicates.length === 0) {
    return {
      ok: false,
      issues: [
        { code: ROW_POLICY_TEMPLATE_ISSUE_CODES.predicatesRequired, templateName, detail: "template predicates must not be empty" }
      ]
    };
  }
  return {
    ok: true,
    definition: {
      name: templateName,
      description: record.description as string | undefined,
      predicates
    }
  };
}

/**
 * Validate the whole `row_policy_templates` block.
 *
 * A single broken template must not make the whole block unreadable: the valid
 * templates are returned together with the issues, so the Admin can still show
 * the healthy ones and explain the broken one (P1-1 §3.2 `state`).
 */
export function validateRowPolicyTemplateCatalog(raw: unknown): {
  templates: RowPolicyTemplateCatalog;
  issues: RowPolicyTemplateIssue[];
} {
  const templates: RowPolicyTemplateCatalog = {};
  const issues: RowPolicyTemplateIssue[] = [];
  if (raw === undefined || raw === null) return { templates, issues };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      templates,
      issues: [{ code: ROW_POLICY_TEMPLATE_ISSUE_CODES.shapeInvalid, detail: "row_policy_templates must be an object" }]
    };
  }
  for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
    const validated = validateRowPolicyTemplateDefinition(name, definition);
    if (validated.ok) templates[validated.definition.name] = validated.definition;
    else issues.push(...validated.issues);
  }
  return { templates, issues };
}

// ─── C2: expansion ────────────────────────────────────────────────────────────

export type RowPolicySelectorExpansion =
  | {
      ok: true;
      /** The expanded `row_policy` shape, or `undefined` when the selector has none. */
      rowPolicy?: { predicates: RowPolicyPredicateInput[] };
      templateName?: string;
      templatePredicateCount: number;
      inlinePredicateCount: number;
      /** The inline predicates as authored (before expansion), for the Admin view. */
      inlinePredicates: RowPolicyPredicateInput[];
    }
  | { ok: false; issues: RowPolicyTemplateIssue[] };

/**
 * Expand ONE selector's `row_policy`.
 *
 * The order is fixed: template predicates first, inline predicates after
 * (P1-1 §3.1). A selector without a template reference is left untouched, so an
 * existing configuration behaves exactly as before (RTP-10).
 */
export function expandRowPolicySelector(
  selector: RowPolicyTemplateSelectorShape,
  templates: RowPolicyTemplateCatalog,
  context?: { roleId?: string; permissionModelVersion?: number }
): RowPolicySelectorExpansion {
  const raw = selector.row_policy;
  if (raw === undefined || raw === null) {
    return { ok: true, templatePredicateCount: 0, inlinePredicateCount: 0, inlinePredicates: [] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      issues: [
        {
          code: "row_policy_invalid",
          roleId: context?.roleId,
          detail: "row_policy must be an object"
        }
      ]
    };
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "template" && key !== "predicates") {
      return {
        ok: false,
        issues: [
          {
            code: "row_policy_invalid_key",
            roleId: context?.roleId,
            detail: `row_policy.${key} is not allowed`
          }
        ]
      };
    }
  }

  const templateName = record.template === undefined ? undefined : record.template;
  if (templateName !== undefined && (typeof templateName !== "string" || !templateName.trim())) {
    return {
      ok: false,
      issues: [
        {
          code: ROW_POLICY_TEMPLATE_ISSUE_CODES.nameInvalid,
          roleId: context?.roleId,
          detail: "row_policy.template must be a template name"
        }
      ]
    };
  }
  const reference = typeof templateName === "string" ? templateName.trim() : undefined;

  // `row_access: all` must not carry a row policy at all (P1-1 §3.1).
  if (reference !== undefined && typeof selector.row_access === "string" && selector.row_access.trim().toLowerCase() === "all") {
    return {
      ok: false,
      issues: [
        {
          code: ROW_POLICY_TEMPLATE_ISSUE_CODES.onAllForbidden,
          roleId: context?.roleId,
          templateName: reference,
          detail: "row_access 'all' must not carry row_policy"
        }
      ]
    };
  }
  // Generation 1 has no scoped / row_policy surface (P1-1 §3.1).
  if (reference !== undefined && context?.permissionModelVersion === 1) {
    return {
      ok: false,
      issues: [
        {
          code: ROW_POLICY_TEMPLATE_ISSUE_CODES.v1Forbidden,
          roleId: context?.roleId,
          templateName: reference,
          detail: "permission_model_version 1 forbids row-policy template references"
        }
      ]
    };
  }

  const inlineParsed = record.predicates === undefined
    ? { ok: true as const, predicates: [] as RowPolicyPredicateInput[] }
    : parseRowPolicyShape({ predicates: record.predicates });
  if (!inlineParsed.ok) {
    return {
      ok: false,
      issues: [
        {
          code: inlineParsed.reason,
          roleId: context?.roleId,
          templateName: reference,
          detail: `inline row_policy predicates rejected (${inlineParsed.reason})`
        }
      ]
    };
  }
  const inlinePredicates: RowPolicyPredicateInput[] = inlineParsed.predicates.map(
    (predicate): RowPolicyPredicateInput =>
      predicate.op === "in"
        ? { field: predicate.field, op: "in", values: normalizeRowPolicyInValues(predicate.values ?? []) }
        : { field: predicate.field, op: "eq", value: predicate.value }
  );

  if (reference === undefined) {
    // No template reference: the existing compiler owns this selector unchanged.
    return { ok: true, templatePredicateCount: 0, inlinePredicateCount: inlinePredicates.length, inlinePredicates };
  }

  const template = templates[reference] ?? null;
  const expanded = expandRowPolicy({
    templateName: reference,
    template,
    inlinePredicates
  });
  if (!expanded.ok) {
    return {
      ok: false,
      issues: expanded.issues.map((issue) => ({ ...issue, roleId: context?.roleId }))
    };
  }
  return {
    ok: true,
    rowPolicy: { predicates: expanded.expanded.predicates },
    templateName: reference,
    templatePredicateCount: expanded.expanded.templatePredicateCount,
    inlinePredicateCount: expanded.expanded.inlinePredicateCount,
    inlinePredicates
  };
}

export type RowPolicyTemplateExpansionResult = {
  /** True when the catalog holds no illegal template AND every selector expanded cleanly. */
  ok: boolean;
  /** The expanded configuration. Failed selectors carry a shape the compiler rejects. */
  config: AccessConfigWithTemplates;
  /** Every issue — the catalog-level ones first, then the reference-level ones. */
  issues: RowPolicyTemplateIssue[];
  /**
   * Issues about a template DEFINITION in the catalog (an illegal shape, an illegal
   * name, empty predicates). They say NOTHING about the selectors: an illegal
   * template that no selector references is a diagnostic, not a reason to refuse
   * an unrelated write (P2-2).
   */
  catalogIssues: RowPolicyTemplateIssue[];
  /**
   * Issues about a SELECTOR's reference to a template (unresolved, illegal name,
   * `row_access: all`, a v1 Role). These are the issues that block a write: the
   * Role would deny at request time.
   */
  referenceIssues: RowPolicyTemplateIssue[];
  /** Every selector that references a template, whether or not it resolved. */
  references: RowPolicyTemplateReference[];
};

/**
 * Expand every template reference in a configuration.
 *
 * This is THE expansion used by every surface (Admin templates, the R3 view and
 * the runtime hook). A selector whose reference cannot be resolved is rewritten
 * into a shape the existing compiler REJECTS (`row_policy_predicates_required`),
 * so a broken reference denies at runtime instead of widening to 「全部行」.
 */
export function expandRowPolicyTemplatesInConfig(config: AccessConfigWithTemplates): RowPolicyTemplateExpansionResult {
  const { templates, issues: catalogIssues } = validateRowPolicyTemplateCatalog(config.row_policy_templates);
  const referenceIssues: RowPolicyTemplateIssue[] = [];
  const references: RowPolicyTemplateReference[] = [];

  const roles = config.roles ?? {};
  const nextRoles: Record<string, unknown> = {};
  for (const roleId of roleIdsOf(config)) {
    const role = roles[roleId];
    const permissionModelVersion = roleShape(role).permission_model_version;
    const selectors = selectorsOfRole(role);
    const nextSelectors: RowPolicyTemplateSelectorShape[] = [];
    for (const selector of selectors) {
      const templateName = templateNameOf(selector);
      if (templateName === undefined) {
        // No template reference: the existing compiler owns this selector unchanged.
        // It is passed through byte-identically, so a configuration without templates
        // behaves exactly as it did before this module existed — including the reason
        // code it reports for an invalid INLINE policy.
        nextSelectors.push({ ...selector });
        continue;
      }
      references.push(
        ...scanTemplateReferences(
          [
            {
              roleId,
              connectionId: selector.connection,
              schema: selector.schema,
              sourceNames: selector.names,
              prefixSelector: typeof selector.prefix === "string" && selector.prefix.length > 0,
              templateName
            }
          ],
          templateName
        )
      );
      const expanded = expandRowPolicySelector(selector, templates, {
        roleId,
        permissionModelVersion: permissionModelVersion === 1 ? 1 : permissionModelVersion === 2 ? 2 : undefined
      });
      if (expanded.ok) {
        nextSelectors.push(
          expanded.rowPolicy ? { ...selector, row_policy: expanded.rowPolicy } : { ...selector }
        );
        continue;
      }
      referenceIssues.push(...expanded.issues);
      // Fail closed: the existing compiler must reject this selector.
      nextSelectors.push({ ...selector, row_policy: { predicates: [] } });
    }
    const allow = roleShape(role).allow;
    nextRoles[roleId] = {
      ...(role as Record<string, unknown>),
      ...(allow
        ? {
            allow: {
              ...(allow as Record<string, unknown>),
              tableSelectors: nextSelectors
            }
          }
        : {})
    };
  }

  return {
    ok: catalogIssues.length + referenceIssues.length === 0,
    config: { ...config, roles: nextRoles as AccessConfig["roles"] },
    issues: [...catalogIssues, ...referenceIssues],
    catalogIssues,
    referenceIssues,
    references
  };
}

/** The template name a selector references, if any. */
export function templateNameOf(selector: RowPolicyTemplateSelectorShape): string | undefined {
  const raw = selector.row_policy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const template = (raw as Record<string, unknown>).template;
  return typeof template === "string" && template.trim() ? template.trim() : undefined;
}

// ─── C3: reference impact ─────────────────────────────────────────────────────

/**
 * Every selector that references a template, grouped by template name.
 *
 * The scan covers the WHOLE configuration, not just the roles a caller knows
 * about: a delete or rename must be refused when ANY role still references the
 * template (P1-D4).
 */
export function collectRowPolicyTemplateReferences(
  config: AccessConfigWithTemplates
): Map<string, RowPolicyTemplateReference[]> {
  const byTemplate = new Map<string, RowPolicyTemplateReference[]>();
  for (const roleId of roleIdsOf(config)) {
    const role = config.roles?.[roleId];
    const permissionModelVersion = roleShape(role).permission_model_version;
    for (const selector of selectorsOfRole(role)) {
      const templateName = templateNameOf(selector);
      if (!templateName) continue;
      const reference: RowPolicyTemplateReference = {
        roleId,
        connectionId: selector.connection,
        schema: selector.schema,
        sourceNames: selector.names,
        prefixSelector: typeof selector.prefix === "string" && selector.prefix.length > 0
      };
      const list = byTemplate.get(templateName) ?? [];
      list.push(reference);
      byTemplate.set(templateName, list);
      void permissionModelVersion;
    }
  }
  return byTemplate;
}

/**
 * References whose template does not exist.
 *
 * A normal write can never produce this state (C3 refuses the write), so it
 * means the configuration was changed OUTSIDE Lucy — an external anomaly. It
 * must fail closed, never be auto-repaired into an inline policy or 「全部行」.
 */
export function unresolvedRowPolicyTemplateReferences(
  config: AccessConfigWithTemplates,
  templates: RowPolicyTemplateCatalog
): RowPolicyTemplateReference[] {
  const out: RowPolicyTemplateReference[] = [];
  for (const [templateName, references] of collectRowPolicyTemplateReferences(config)) {
    if (templates[templateName]) continue;
    out.push(...references);
  }
  return out;
}

// ─── Write operations (in memory) ─────────────────────────────────────────────

export type RowPolicyTemplateOperation =
  | { kind: "create"; name: string; definition: unknown }
  | { kind: "patch"; name: string; definition: unknown; newName?: string }
  | { kind: "delete"; name: string };

export type RowPolicyTemplateOperationResult =
  | {
      ok: true;
      config: AccessConfigWithTemplates;
      /** The templates that were added / changed / removed. */
      added: string[];
      changed: string[];
      removed: string[];
      /** The references that made the operation illegal (empty when the write is allowed). */
      blockingReferences: RowPolicyTemplateReference[];
    }
  | { ok: false; issues: RowPolicyTemplateIssue[]; blockingReferences: RowPolicyTemplateReference[] };

/**
 * The template entries of the ORIGINAL catalog that are NOT valid templates.
 *
 * A template write must never touch a block it was not asked to touch: an
 * illegal template definition is preserved VERBATIM, so the write stays inside
 * its own scope (P1-1 §5.2 — 「preview failed ⇒ zero intent and zero writes」).
 * The invalid entry is a diagnostic for the operator, not something a save may
 * silently delete (P2-2).
 */
function invalidTemplateEntries(raw: unknown, valid: RowPolicyTemplateCatalog): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [name, definition] of Object.entries(raw as Record<string, unknown>)) {
    // A VALID template belongs to the operation; an invalid one is preserved.
    if (valid[name.trim()]) continue;
    out[name] = definition;
  }
  return out;
}

/** The names the ORIGINAL catalog holds, trimmed — valid or not. */
function rawTemplateNames(raw: unknown): Set<string> {
  const names = new Set<string>();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return names;
  for (const key of Object.keys(raw as Record<string, unknown>)) names.add(key.trim());
  return names;
}

/** The catalog issues that belong to ONE template name. */
function catalogIssuesForName(issues: RowPolicyTemplateIssue[], name: string): RowPolicyTemplateIssue[] {
  const target = name.trim();
  return issues.filter((issue) => (issue.templateName ?? "").trim() === target);
}

function withTemplates(
  config: AccessConfigWithTemplates,
  templates: RowPolicyTemplateCatalog,
  preserved: Record<string, unknown>
): AccessConfigWithTemplates {
  // The STORED form carries no `name`: the template name is the YAML key. The
  // in-memory definition carries it for convenience; persisting it would make
  // the stored block fail its own shape check.
  //
  // `preserved` holds the illegal entries of the original catalog VERBATIM.
  // They are copied first, so the operation's own templates overwrite them —
  // a create/patch of a name replaces that name, and every OTHER entry stays
  // exactly as it was (P2-2).
  const stored: Record<string, unknown> = { ...preserved };
  for (const name of Object.keys(templates).sort()) {
    const definition = templates[name];
    stored[name] = {
      ...(definition.description === undefined ? {} : { description: definition.description }),
      predicates: definition.predicates
    };
  }
  // Sorted keys → a stable digest and a stable diff.
  const sorted: Record<string, unknown> = {};
  for (const name of Object.keys(stored).sort()) sorted[name] = stored[name];
  return { ...config, row_policy_templates: sorted };
}

/**
 * Apply a template operation to an in-memory configuration.
 *
 * A rename is treated as 「删除旧名 + 新建新名」 (P1-1 §4), so the OLD name must
 * not be referenced. A referenced delete or rename is refused BEFORE anything is
 * written — the caller never reaches the write step (P1-D4, zero writes).
 *
 * The catalog is preserved: the result is 「原始目录 + 本次操作的合法变更」, not
 * 「只剩合法模板」. An illegal template definition that the operation did not
 * touch stays in the block, byte for byte (P2-2).
 */
export function applyRowPolicyTemplateOperation(
  config: AccessConfigWithTemplates,
  operation: RowPolicyTemplateOperation
): RowPolicyTemplateOperationResult {
  const { templates, issues: catalogIssues } = validateRowPolicyTemplateCatalog(config.row_policy_templates);
  const preserved = invalidTemplateEntries(config.row_policy_templates, templates);
  const takenNames = rawTemplateNames(config.row_policy_templates);
  const references = collectRowPolicyTemplateReferences(config);

  if (operation.kind === "create") {
    const validated = validateRowPolicyTemplateDefinition(operation.name, operation.definition);
    if (!validated.ok) return { ok: false, issues: validated.issues, blockingReferences: [] };
    // The name is taken when the catalog holds it — even when the stored
    // definition is ILLEGAL. A create must not overwrite a block it was not
    // asked to touch (P2-2).
    if (templates[validated.definition.name] || takenNames.has(validated.definition.name)) {
      return {
        ok: false,
        issues: [
          {
            code: ROW_POLICY_TEMPLATE_ISSUE_CODES.exists,
            templateName: validated.definition.name,
            detail: "template already exists"
          }
        ],
        blockingReferences: []
      };
    }
    return {
      ok: true,
      config: withTemplates(config, { ...templates, [validated.definition.name]: validated.definition }, preserved),
      added: [validated.definition.name],
      changed: [],
      removed: [],
      blockingReferences: []
    };
  }

  if (operation.kind === "patch") {
    const existing = templates[operation.name];
    if (!existing) {
      // The name may exist in the catalog as an ILLEGAL definition. That is not
      // 「not found」: the operation must fail with the reason, and nothing else
      // in the catalog may be touched (P2-2).
      const targetIssues = catalogIssuesForName(catalogIssues, operation.name);
      if (targetIssues.length > 0) {
        return { ok: false, issues: targetIssues, blockingReferences: [] };
      }
      return {
        ok: false,
        issues: [{ code: ROW_POLICY_TEMPLATE_ISSUE_CODES.notFound, templateName: operation.name }],
        blockingReferences: []
      };
    }
    const validated = validateRowPolicyTemplateDefinition(operation.name, operation.definition);
    if (!validated.ok) return { ok: false, issues: validated.issues, blockingReferences: [] };

    const newName = operation.newName?.trim();
    const renaming = Boolean(newName && newName !== existing.name);
    if (renaming) {
      const renamed = validateRowPolicyTemplateDefinition(newName!, operation.definition);
      if (!renamed.ok) return { ok: false, issues: renamed.issues, blockingReferences: [] };
      if (templates[newName!] || takenNames.has(newName!)) {
        return {
          ok: false,
          issues: [
            { code: ROW_POLICY_TEMPLATE_ISSUE_CODES.exists, templateName: newName!, detail: "target template name already exists" }
          ],
          blockingReferences: []
        };
      }
      const blocking = references.get(existing.name) ?? [];
      if (blocking.length > 0) {
        return {
          ok: false,
          issues: [
            {
              code: ROW_POLICY_TEMPLATE_ISSUE_CODES.inUse,
              templateName: existing.name,
              detail: `template '${existing.name}' is referenced by ${blocking.length} selector(s); rename it after removing the references`
            }
          ],
          blockingReferences: blocking
        };
      }
      const next = { ...templates };
      delete next[existing.name];
      next[newName!] = renamed.definition;
      return {
        ok: true,
        config: withTemplates(config, next, preserved),
        added: [newName!],
        changed: [],
        removed: [existing.name],
        blockingReferences: []
      };
    }

    return {
      ok: true,
      config: withTemplates(config, { ...templates, [existing.name]: validated.definition }, preserved),
      added: [],
      changed: [existing.name],
      removed: [],
      blockingReferences: []
    };
  }

  const existing = templates[operation.name];
  if (!existing) {
    // Same as the patch: an illegal target is not a missing target (P2-2).
    const targetIssues = catalogIssuesForName(catalogIssues, operation.name);
    if (targetIssues.length > 0) {
      return { ok: false, issues: targetIssues, blockingReferences: [] };
    }
    return {
      ok: false,
      issues: [{ code: ROW_POLICY_TEMPLATE_ISSUE_CODES.notFound, templateName: operation.name }],
      blockingReferences: []
    };
  }
  const blocking = references.get(existing.name) ?? [];
  if (blocking.length > 0) {
    return {
      ok: false,
      issues: [
        {
          code: ROW_POLICY_TEMPLATE_ISSUE_CODES.inUse,
          templateName: existing.name,
          detail: `template '${existing.name}' is referenced by ${blocking.length} selector(s)`
        }
      ],
      blockingReferences: blocking
    };
  }
  const next = { ...templates };
  delete next[existing.name];
  return {
    ok: true,
    config: withTemplates(config, next, preserved),
    added: [],
    changed: [],
    removed: [existing.name],
    blockingReferences: []
  };
}

// ─── Usability per table (RTP-08 / §3.2) ──────────────────────────────────────

/**
 * Whether a template can be bound to ONE table.
 *
 * A template carries no table identity, so the answer can only come from the
 * catalog — and it has FOUR distinct outcomes (P1-1 §3.2). Folding them into
 * 「可用／不可用」is how a missing field turns into a silent 「全部行」.
 */
export function rowPolicyTemplateUsability(
  definition: RowPolicyTemplateDefinition,
  catalog: RowPolicyCatalogResult
): RowPolicyTemplateUsability {
  if (catalog.status === "manifest_unavailable") {
    return { status: "manifest_unavailable", reason: `row_policy_catalog_unavailable:${catalog.stage}:${catalog.reason}` };
  }
  if (catalog.status === "catalog_capability_unknown") {
    return { status: "catalog_unknown", reason: `row_policy_catalog_capability_unknown:${catalog.reason}` };
  }
  const fields = definition.predicates.map((predicate) => predicate.field);
  const columns = catalog.catalog?.columns;
  if (!columns) {
    // The catalog loaded but exposes no bindable column: every field of this
    // template is unresolvable on this table.
    return { status: "field_missing", fields };
  }
  const missing = fields.filter((field) => !columns.has(field.trim().toLowerCase()));
  if (missing.length > 0) return { status: "field_missing", fields: missing };
  return { status: "bindable" };
}

/** Usability of a template against one table, loading the catalog for it. */
export async function rowPolicyTemplateUsabilityForTable(
  definition: RowPolicyTemplateDefinition,
  table: { connectionId: string; schema: string; sourceName: string }
): Promise<RowPolicyTemplateUsability> {
  const catalog = await loadSourceFieldCatalogWithProvenance({
    connectionId: table.connectionId,
    schema: table.schema,
    sourceName: table.sourceName
  });
  return rowPolicyTemplateUsability(definition, catalog);
}
