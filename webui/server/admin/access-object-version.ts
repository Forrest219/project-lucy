/**
 * P1-59 — per-object version, preview dependency digest and preview effect digest.
 *
 * Authority: docs/specs/lucy-20261119-roles-agent-concurrent-edit-spec.md §3–§3.4
 *
 * Vocabulary:
 *  - `canonicalWritableObjectDigest` — writable semantic fields of one Role / Agent
 *  - `previewDependenciesDigest` — compile closure the target actually depends on (not whole-file hash)
 *  - `previewEffectDigest` — this edit's auth / reference / risk / confirm effect binding
 *  - `candidateConfigDigest` — full in-memory access candidate (`computeCandidateDigest`)
 *
 * Those levels must never be interchanged.
 */
import { resolveRoleIds } from "../proxy/acl.js";
import { computeCandidateDigest, sha256Hex, stableJson } from "../config-digest.js";
import type { YamlAccessConfig, YamlRole, YamlTableSelector, YamlUser } from "./access-config.js";

/** Bumped when object canonicalization shape changes incompatibly. */
export const ACCESS_OBJECT_VERSION_VOCABULARY = "racs-v1-object-1";

export type AccessObjectKind = "role" | "agent";

/** Create / copy-from-absent binds to this marker instead of a writable body digest. */
export const ABSENT_OBJECT_MARKER = "__absent__";

export interface BaseObjectVersion {
  vocabulary: string;
  kind: AccessObjectKind;
  objectId: string;
  canonicalWritableObjectDigest: string;
}

export interface GovernanceEffectFacts {
  decision: string;
  riskLevel: string;
  requiresConfirmation: boolean;
  /** Bound when DEP-07 sensitive sets / impact surface change; sorted in digest. */
  sensitiveSourceKeys?: string[];
  /**
   * Observability only — excluded from previewEffectDigest (DEP-06).
   * Included on the struct so callers can carry it without polluting the effect binding.
   */
  rawCallCount?: number;
}

export type AccessConfigWithTemplates = YamlAccessConfig & {
  row_policy_templates?: Record<string, unknown>;
};

const AGENT_DISPLAY_ONLY_KEYS = new Set([
  "usageCallsLast7d",
  "evalProbeCallsLast7d",
  "businessCallsLast7d",
  "lastSeen",
  "tokenCount",
  "callsLastWindow",
  "deniedLastWindow"
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringLikeScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Leaf field names that are set-semantics when canonicalizing object digests. */
function pathUsesSetSemantics(path: string): boolean {
  const normalized = path.replace(/\[\d+\]/g, "[]");
  if (normalized.endsWith(".roleIds")) return true;
  if (/(?:^|\.)(tools|connections|names|asset_kinds)(?:\.|$)/.test(normalized)) return true;
  return false;
}

/** Ordered rule arrays — predicate order is semantic (DEP-10). */
function pathPreservesArrayOrder(path: string): boolean {
  const normalized = path.replace(/\[\d+\]/g, "[]");
  if (normalized.includes("predicates")) return true;
  if (normalized.includes("tableSelectors")) return true;
  if (normalized.includes("ops")) return true;
  if (normalized.includes("tokens")) return true;
  if (normalized.includes("constraints")) return true;
  return false;
}

/**
 * Recursive canonical form for object digest: unknown keys kept, set fields sorted,
 * ordered arrays keep order.
 */
export function canonicalizeWritableValue(value: unknown, path = ""): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const mapped = value.map((item, index) => canonicalizeWritableValue(item, `${path}[${index}]`));
    if (pathUsesSetSemantics(path) && mapped.every(isStringLikeScalar)) {
      return [...new Set(mapped.map((item) => String(item)))].sort((a, b) => a.localeCompare(b));
    }
    return mapped;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      out[key] = canonicalizeWritableValue(value[key], path ? `${path}.${key}` : key);
    }
    return out;
  }
  return value;
}

export function stripAgentDisplayOnlyFields<T extends Record<string, unknown>>(user: T): T {
  const out = { ...user };
  for (const key of AGENT_DISPLAY_ONLY_KEYS) {
    delete out[key];
  }
  return out;
}

function collectRowPolicyTemplateNames(selectors: YamlTableSelector[] | undefined): string[] {
  if (!selectors?.length) return [];
  const names: string[] = [];
  for (const selector of selectors) {
    const template = selector.row_policy?.template;
    if (typeof template === "string" && template.trim()) names.push(template.trim());
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function digestRowPolicyTemplates(
  config: AccessConfigWithTemplates,
  templateNames: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  const catalog = config.row_policy_templates ?? {};
  for (const name of templateNames) {
    if (!Object.prototype.hasOwnProperty.call(catalog, name)) {
      out[name] = sha256Hex(`missing:${name}`);
      continue;
    }
    out[name] = sha256Hex(
      stableJson({
        vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
        template: name,
        body: canonicalizeWritableValue(catalog[name], `template.${name}`)
      })
    );
  }
  return out;
}

export function canonicalizeRoleWritable(role: YamlRole): Record<string, unknown> {
  return canonicalizeWritableValue(role, "role") as Record<string, unknown>;
}

export function canonicalizeAgentWritable(user: YamlUser): Record<string, unknown> {
  const stripped = stripAgentDisplayOnlyFields({ ...user } as Record<string, unknown>);
  const resolved = resolveRoleIds(stripped as YamlUser);
  const base = { ...stripped } as Record<string, unknown>;
  delete base.role;
  delete base.roles;
  const canonical = canonicalizeWritableValue(base, "agent") as Record<string, unknown>;
  if (resolved.ok) {
    canonical.roleIds = [...resolved.roleIds].sort((a, b) => a.localeCompare(b));
  } else {
    if (typeof user.role === "string") canonical.role = user.role;
    if (Array.isArray(user.roles)) canonical.roles = user.roles;
  }
  return canonical;
}

export function computeCanonicalWritableObjectDigest(
  kind: AccessObjectKind,
  body: Record<string, unknown>
): string {
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      kind,
      body
    })
  );
}

export function computeRoleObjectDigest(role: YamlRole): string {
  return computeCanonicalWritableObjectDigest("role", canonicalizeRoleWritable(role));
}

export function computeAgentObjectDigest(user: YamlUser): string {
  return computeCanonicalWritableObjectDigest("agent", canonicalizeAgentWritable(user));
}

export function baseObjectVersionForAbsence(kind: AccessObjectKind, objectId: string): BaseObjectVersion {
  return {
    vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
    kind,
    objectId,
    canonicalWritableObjectDigest: sha256Hex(
      stableJson({
        vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
        marker: ABSENT_OBJECT_MARKER,
        kind,
        objectId
      })
    )
  };
}

export function computeRoleBaseObjectVersion(roleId: string, role: YamlRole): BaseObjectVersion {
  return {
    vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
    kind: "role",
    objectId: roleId,
    canonicalWritableObjectDigest: computeRoleObjectDigest(role)
  };
}

export function computeAgentBaseObjectVersion(agentId: string, user: YamlUser): BaseObjectVersion {
  return {
    vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
    kind: "agent",
    objectId: agentId,
    canonicalWritableObjectDigest: computeAgentObjectDigest(user)
  };
}

export function serializeBaseObjectVersion(version: BaseObjectVersion): string {
  return `${version.kind}:${version.objectId}:${version.canonicalWritableObjectDigest}`;
}

export function baseObjectVersionsEqual(a: BaseObjectVersion, b: BaseObjectVersion): boolean {
  return (
    a.vocabulary === b.vocabulary &&
    a.kind === b.kind &&
    a.objectId === b.objectId &&
    a.canonicalWritableObjectDigest === b.canonicalWritableObjectDigest
  );
}

export function digestAccessDefaults(defaults: YamlAccessConfig["defaults"] | undefined): string {
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      defaults: canonicalizeWritableValue(defaults ?? {}, "defaults")
    })
  );
}

export interface PreviewDependencyInput {
  compileInputsDigest: string;
  /** Referenced Role definitions by id — object digests, not descriptions of unrelated roles. */
  referencedRoles?: Record<string, string>;
  rowPolicyTemplates?: Record<string, string>;
  defaultsDigest?: string;
  /** Copy / create metadata (DEP-11). */
  copySourceObjectVersion?: BaseObjectVersion | null;
  absence?: boolean;
}

export function computePreviewDependenciesDigest(input: PreviewDependencyInput): string {
  const referencedRoles = Object.fromEntries(
    Object.entries(input.referencedRoles ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  const rowPolicyTemplates = Object.fromEntries(
    Object.entries(input.rowPolicyTemplates ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      compileInputsDigest: input.compileInputsDigest,
      referencedRoles,
      rowPolicyTemplates,
      defaultsDigest: input.defaultsDigest ?? "",
      copySourceObjectVersion: input.copySourceObjectVersion
        ? serializeBaseObjectVersion(input.copySourceObjectVersion)
        : "",
      absence: input.absence === true
    })
  );
}

export function digestGovernanceEffectFacts(facts: GovernanceEffectFacts): string {
  const sensitive = [...(facts.sensitiveSourceKeys ?? [])].sort((a, b) => a.localeCompare(b));
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      decision: facts.decision,
      riskLevel: facts.riskLevel,
      requiresConfirmation: facts.requiresConfirmation,
      sensitiveSourceKeys: sensitive
    })
  );
}

export interface PreviewEffectInput {
  baseObjectVersion: BaseObjectVersion;
  normalizedPatchDigest: string;
  previewDependenciesDigest: string;
  governanceFacts?: GovernanceEffectFacts;
}

/** Binds preview token to target object version + patch + dependencies + governance effect. */
export function computePreviewEffectDigest(input: PreviewEffectInput): string {
  const governanceDigest = input.governanceFacts
    ? digestGovernanceEffectFacts(input.governanceFacts)
    : "";
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      kind: input.baseObjectVersion.kind,
      objectId: input.baseObjectVersion.objectId,
      canonicalWritableObjectDigest: input.baseObjectVersion.canonicalWritableObjectDigest,
      normalizedPatchDigest: input.normalizedPatchDigest,
      previewDependenciesDigest: input.previewDependenciesDigest,
      governanceEffectDigest: governanceDigest
    })
  );
}

export function computeCandidateConfigDigest(config: YamlAccessConfig | AccessConfigWithTemplates): string {
  return computeCandidateDigest(config);
}

export function digestNormalizedPatch(patch: unknown): string {
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      patch: canonicalizeWritableValue(patch, "patch")
    })
  );
}

function referencedRoleDigestsForIds(
  config: YamlAccessConfig,
  roleIds: string[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const roleId of roleIds) {
    const role = config.roles?.[roleId];
    if (role) {
      out[roleId] = computeRoleObjectDigest(role);
    } else {
      out[roleId] = sha256Hex(`missing-role:${roleId}`);
    }
  }
  return out;
}

export function collectRolePreviewDependencies(
  config: AccessConfigWithTemplates,
  roleId: string,
  role: YamlRole,
  compileInputsDigest: string
): PreviewDependencyInput {
  const templateNames = collectRowPolicyTemplateNames(role.allow?.tableSelectors);
  return {
    compileInputsDigest,
    referencedRoles: { [roleId]: computeRoleObjectDigest(role) },
    rowPolicyTemplates: digestRowPolicyTemplates(config, templateNames),
    defaultsDigest: digestAccessDefaults(config.defaults)
  };
}

export function collectAgentPreviewDependencies(
  config: AccessConfigWithTemplates,
  agentId: string,
  user: YamlUser,
  compileInputsDigest: string
): PreviewDependencyInput {
  const resolved = resolveRoleIds(user);
  const roleIds = resolved.ok ? resolved.roleIds : [];
  return {
    compileInputsDigest,
    referencedRoles: referencedRoleDigestsForIds(config, roleIds),
    defaultsDigest: digestAccessDefaults(config.defaults)
  };
}

export function unrelatedRoleChangeDoesNotAlterAgentDependencies(input: {
  before: AccessConfigWithTemplates;
  after: AccessConfigWithTemplates;
  agentId: string;
  compileInputsDigest: string;
}): boolean {
  const userBefore = input.before.users.find((u) => u.id === input.agentId);
  const userAfter = input.after.users.find((u) => u.id === input.agentId);
  if (!userBefore || !userAfter) return false;
  const dBefore = computePreviewDependenciesDigest(
    collectAgentPreviewDependencies(input.before, input.agentId, userBefore, input.compileInputsDigest)
  );
  const dAfter = computePreviewDependenciesDigest(
    collectAgentPreviewDependencies(input.after, input.agentId, userAfter, input.compileInputsDigest)
  );
  return dBefore === dAfter;
}