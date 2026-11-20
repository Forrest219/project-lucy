/**
 * P1-59 — object-version write protocol for Role / Agent saves (Wave 2 core).
 *
 * Authority: docs/specs/lucy-20261119-roles-agent-concurrent-edit-spec.md §3–§4
 *
 * `compileInputsDigest` is supplied by the caller (or the route's dryRun body). This module
 * does not claim to read the full compile-input closure automatically.
 */
import { sha256Hex, stableJson } from "../config-digest.js";
import type { AccessGovernanceGateDecision } from "../access-governance-gate.js";
import { expandRowPolicyTemplatesInConfig, type AccessConfigWithTemplates } from "./row-policy-templates.js";
import type { YamlAccessConfig, YamlRole, YamlUser } from "./access-config.js";
import {
  buildRacsReceipt,
  embedRacsReceiptInSummary,
  evaluateRacsIdempotencyClaim,
  isValidClientOperationId,
  type RacsIdempotencyClaimResult,
  type RacsIdempotencyRejectCode,
  type RacsObjectKind,
  type RacsReceipt
} from "./access-write-status.js";
import { getAuditDb } from "./audit.js";
import { computeCandidateConfigDigest } from "./access-object-version.js";
import type { TrustedActor } from "../security/request-actor.js";
import {
  ACCESS_OBJECT_VERSION_VOCABULARY,
  type BaseObjectVersion,
  type GovernanceEffectFacts,
  baseObjectVersionForAbsence,
  baseObjectVersionsEqual,
  collectAgentPreviewDependencies,
  collectRolePreviewDependencies,
  computeAgentBaseObjectVersion,
  computePreviewDependenciesDigest,
  computePreviewEffectDigest,
  computeRoleBaseObjectVersion,
  digestNormalizedPatch,
  serializeBaseObjectVersion
} from "./access-object-version.js";

export const PREVIEW_TOKEN_VOCABULARY = "racs-v1-preview-1";
export const PREVIEW_INPUT_CHANGED_CODE = "PREVIEW_INPUT_CHANGED";
export const MIXED_VERSION_PROTOCOL_CODE = "MIXED_VERSION_PROTOCOL";

export class MixedVersionProtocolError extends Error {
  readonly code = MIXED_VERSION_PROTOCOL_CODE;
  readonly statusCode = 400;

  constructor() {
    super("version and baseObjectVersion cannot be sent together; use legacy file version or object version protocol");
    this.name = "MixedVersionProtocolError";
  }
}

export class AccessObjectTargetChangedError extends Error {
  readonly code = "OBJECT_TARGET_CHANGED";
  readonly statusCode = 409;

  constructor(message = "target object changed or was removed; refresh and compare") {
    super(message);
    this.name = "AccessObjectTargetChangedError";
  }
}

export class AccessObjectVersionMismatchError extends Error {
  readonly code = "VERSION_CONFLICT";
  readonly statusCode = 409;
  readonly conflictKind = "object_version";

  constructor(
    readonly currentObjectVersion?: string,
    readonly requestedObjectVersion?: string
  ) {
    super("配置已变化：目标对象版本不一致，请比较后重新预览");
    this.name = "AccessObjectVersionMismatchError";
  }
}

export class PreviewInputChangedError extends Error {
  readonly code = PREVIEW_INPUT_CHANGED_CODE;
  readonly statusCode = 409;

  constructor() {
    super("preview inputs changed; re-run dryRun and confirm again");
    this.name = "PreviewInputChangedError";
  }
}

export class PreviewTokenRequiredError extends Error {
  readonly code = "PREVIEW_TOKEN_REQUIRED";
  readonly statusCode = 409;

  constructor() {
    super("previewToken is required for object-version saves");
    this.name = "PreviewTokenRequiredError";
  }
}

export type AccessWriteVersionMode =
  | { mode: "legacy" }
  | { mode: "object"; baseObjectVersion: BaseObjectVersion };

export interface AccessWriteProtocolFields {
  version?: string;
  baseObjectVersion?: string;
  previewToken?: string;
  operationId?: string;
  compileInputsDigest?: string;
}

export function parseSerializedBaseObjectVersion(serialized: string): BaseObjectVersion | undefined {
  const parts = serialized.split(":");
  if (parts.length < 3) return undefined;
  const kind = parts[0];
  const objectId = parts[1];
  const canonicalWritableObjectDigest = parts.slice(2).join(":");
  if (kind !== "role" && kind !== "agent") return undefined;
  if (!objectId || !canonicalWritableObjectDigest) return undefined;
  return {
    vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
    kind,
    objectId,
    canonicalWritableObjectDigest
  };
}

/** Re-export for routes that already import from access-object-version. */
export { serializeBaseObjectVersion };

export function resolveAccessWriteVersionMode(fields: AccessWriteProtocolFields): AccessWriteVersionMode {
  const hasLegacy = typeof fields.version === "string" && fields.version.length > 0;
  const hasObject =
    typeof fields.baseObjectVersion === "string" && fields.baseObjectVersion.trim().length > 0;
  if (hasLegacy && hasObject) {
    throw new MixedVersionProtocolError();
  }
  if (hasObject) {
    const parsed = parseSerializedBaseObjectVersion(fields.baseObjectVersion!.trim());
    if (!parsed) {
      throw new Error("invalid baseObjectVersion");
    }
    return { mode: "object", baseObjectVersion: parsed };
  }
  return { mode: "legacy" };
}

/**
 * Caller-supplied compile closure digest; when absent a stable placeholder is used
 * (routes must not claim the full closure was read automatically).
 */
export function resolveCompileInputsDigest(provided: unknown): string {
  if (typeof provided === "string" && /^[0-9a-f]{64}$/i.test(provided.trim())) {
    return provided.trim().toLowerCase();
  }
  return sha256Hex(
    stableJson({
      vocabulary: ACCESS_OBJECT_VERSION_VOCABULARY,
      marker: "compile_inputs_unspecified"
    })
  );
}

export function governanceFactsFromGate(gate: AccessGovernanceGateDecision): GovernanceEffectFacts {
  const tiers = Object.entries(gate.tierSummary ?? {}) as Array<[string, { count: number }]>;
  const active = tiers.filter(([, t]) => t.count > 0).map(([k]) => k);
  const riskLevel = active.length > 0 ? active.sort().join("+") : "none";
  return {
    decision: gate.decision,
    riskLevel,
    requiresConfirmation: gate.decision === "override_required",
    rawCallCount: gate.findings?.length ?? 0
  };
}

export interface RoleAgentPreviewBindingInput {
  kind: "role" | "agent";
  objectId: string;
  baseObjectVersion: BaseObjectVersion;
  config: YamlAccessConfig;
  patch: unknown;
  compileInputsDigest: string;
  gate: AccessGovernanceGateDecision;
  /** Create / copy-from-absent metadata (DEP-11). */
  copySourceObjectVersion?: BaseObjectVersion | null;
  absence?: boolean;
}

export function computeRoleAgentPreviewBinding(input: RoleAgentPreviewBindingInput): {
  previewEffectDigest: string;
  previewDependenciesDigest: string;
  previewToken: string;
} {
  const expansion = expandRowPolicyTemplatesInConfig(input.config as AccessConfigWithTemplates);
  // Expansion returns an envelope. Dependencies need its configuration, while
  // preserving the caller's required users and the expanded role definitions.
  const expanded = { ...input.config, roles: expansion.config.roles as YamlAccessConfig["roles"] };
  const patchDigest = digestNormalizedPatch(input.patch);
  const depInput =
    input.kind === "role"
      ? collectRolePreviewDependencies(
          expanded,
          input.objectId,
          input.config.roles?.[input.objectId] as YamlRole,
          input.compileInputsDigest
        )
      : collectAgentPreviewDependencies(
          expanded,
          input.objectId,
          input.config.users.find((u) => u.id === input.objectId) as YamlUser,
          input.compileInputsDigest
        );
  if (input.copySourceObjectVersion) {
    depInput.copySourceObjectVersion = input.copySourceObjectVersion;
  }
  if (input.absence) {
    depInput.absence = true;
  }
  const previewDependenciesDigest = computePreviewDependenciesDigest(depInput);
  const previewEffectDigest = computePreviewEffectDigest({
    baseObjectVersion: input.baseObjectVersion,
    normalizedPatchDigest: patchDigest,
    previewDependenciesDigest,
    governanceFacts: governanceFactsFromGate(input.gate)
  });
  return {
    previewDependenciesDigest,
    previewEffectDigest,
    previewToken: mintRolesAgentPreviewToken(previewEffectDigest)
  };
}

export function mintRolesAgentPreviewToken(previewEffectDigest: string): string {
  return `${PREVIEW_TOKEN_VOCABULARY}:${previewEffectDigest}`;
}

export function previewEffectDigestFromToken(previewToken: string): string | undefined {
  if (!previewToken.startsWith(`${PREVIEW_TOKEN_VOCABULARY}:`)) return undefined;
  const digest = previewToken.slice(PREVIEW_TOKEN_VOCABULARY.length + 1);
  return /^[0-9a-f]{64}$/i.test(digest) ? digest.toLowerCase() : undefined;
}

export function assertPreviewTokenMatches(previewToken: string | undefined, recomputedEffectDigest: string): void {
  if (!previewToken?.trim()) {
    throw new PreviewTokenRequiredError();
  }
  const bound = previewEffectDigestFromToken(previewToken.trim());
  if (!bound || bound !== recomputedEffectDigest.toLowerCase()) {
    throw new PreviewInputChangedError();
  }
}

export function readRoleBaseObjectVersion(
  config: YamlAccessConfig,
  roleId: string
): BaseObjectVersion | undefined {
  const role = config.roles?.[roleId];
  if (!role?.allow) return undefined;
  return computeRoleBaseObjectVersion(roleId, role);
}

export function readAgentBaseObjectVersion(
  config: YamlAccessConfig,
  agentId: string
): BaseObjectVersion | undefined {
  const user = config.users.find((u) => u.id === agentId);
  if (!user) return undefined;
  return computeAgentBaseObjectVersion(agentId, user);
}

export function assertRoleObjectBaseline(
  config: YamlAccessConfig,
  roleId: string,
  expected: BaseObjectVersion
): void {
  const current = readRoleBaseObjectVersion(config, roleId);
  if (!current) {
    throw new AccessObjectTargetChangedError();
  }
  if (!baseObjectVersionsEqual(current, expected)) {
    throw new AccessObjectVersionMismatchError(
      serializeBaseObjectVersion(current),
      serializeBaseObjectVersion(expected)
    );
  }
}

export function assertAgentObjectBaseline(
  config: YamlAccessConfig,
  agentId: string,
  expected: BaseObjectVersion
): void {
  const current = readAgentBaseObjectVersion(config, agentId);
  if (!current) {
    throw new AccessObjectTargetChangedError();
  }
  if (!baseObjectVersionsEqual(current, expected)) {
    throw new AccessObjectVersionMismatchError(
      serializeBaseObjectVersion(current),
      serializeBaseObjectVersion(expected)
    );
  }
}

export function assertRoleCreateAbsenceBaseline(config: YamlAccessConfig, roleId: string, expected: BaseObjectVersion): void {
  if (config.roles?.[roleId]) {
    throw new AccessObjectTargetChangedError(`role '${roleId}' already exists`);
  }
  const absent = baseObjectVersionForAbsence("role", roleId);
  if (!baseObjectVersionsEqual(absent, expected)) {
    throw new AccessObjectVersionMismatchError(serializeBaseObjectVersion(absent), serializeBaseObjectVersion(expected));
  }
}

export function assertAgentCreateAbsenceBaseline(config: YamlAccessConfig, agentId: string, expected: BaseObjectVersion): void {
  if (config.users.some((u) => u.id === agentId)) {
    throw new AccessObjectTargetChangedError(`agent '${agentId}' already exists`);
  }
  const absent = baseObjectVersionForAbsence("agent", agentId);
  if (!baseObjectVersionsEqual(absent, expected)) {
    throw new AccessObjectVersionMismatchError(serializeBaseObjectVersion(absent), serializeBaseObjectVersion(expected));
  }
}

export function mergeConfigWithRole(config: YamlAccessConfig, roleId: string, role: YamlRole): YamlAccessConfig {
  return {
    ...config,
    roles: { ...(config.roles ?? {}), [roleId]: role }
  };
}

export function mergeConfigWithAgent(config: YamlAccessConfig, user: YamlUser): YamlAccessConfig {
  const users = [...config.users];
  const index = users.findIndex((u) => u.id === user.id);
  if (index === -1) {
    return { ...config, users: [...users, user] };
  }
  users[index] = user;
  return { ...config, users };
}

export type RolesAgentRacsOperationResolution =
  | { kind: "legacy" }
  | { kind: "racs"; operationId: string }
  | { kind: "reject"; status: number; code: string; message: string };

export function resolveRolesAgentRacsOperation(
  versionMode: AccessWriteVersionMode,
  operationId: string | undefined
): RolesAgentRacsOperationResolution {
  if (versionMode.mode !== "object") return { kind: "legacy" };
  const trimmed = operationId?.trim();
  if (!trimmed) return { kind: "legacy" };
  if (!isValidClientOperationId(trimmed)) {
    const mapped = mapRacsIdempotencyRejectToHttp("operation_id_invalid");
    return { kind: "reject", ...mapped };
  }
  return { kind: "racs", operationId: trimmed };
}

export function mapRacsIdempotencyRejectToHttp(code: RacsIdempotencyRejectCode): {
  status: number;
  code: string;
  message: string;
} {
  switch (code) {
    case "operation_id_invalid":
      return { status: 400, code: "INVALID_OPERATION_ID", message: "operationId 必须是客户端 UUID。" };
    case "idempotency_payload_mismatch":
      return {
        status: 409,
        code: "RACS_IDEMPOTENCY_PAYLOAD_MISMATCH",
        message: "同 operationId 已绑定不同请求摘要，请使用新的 operationId。"
      };
    case "idempotency_actor_mismatch":
      return {
        status: 403,
        code: "RACS_IDEMPOTENCY_ACTOR_MISMATCH",
        message: "同 operationId 已由其他账号认领，不能重复提交。"
      };
    case "idempotency_receipt_missing":
      return {
        status: 409,
        code: "RACS_IDEMPOTENCY_RECEIPT_MISSING",
        message: "审计回执不完整，不能认领幂等键。"
      };
  }
}

export function buildRolesAgentRacsReceipt(input: {
  actor: TrustedActor;
  objectKind: RacsObjectKind;
  objectId: string;
  previewEffectDigest: string;
  baseObjectVersionSerialized: string;
  candidateConfig: YamlAccessConfig;
}): RacsReceipt {
  return buildRacsReceipt({
    submitterAccountUid: input.actor.accountUid,
    submitterActorId: input.actor.actorId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    requestDigest: input.previewEffectDigest.toLowerCase(),
    baseObjectVersion: input.baseObjectVersionSerialized,
    candidateConfigDigest: computeCandidateConfigDigest(input.candidateConfig).toLowerCase()
  });
}

export async function evaluateRolesAgentRacsIdempotencyClaim(
  operationId: string,
  receipt: RacsReceipt
): Promise<RacsIdempotencyClaimResult> {
  const database = await getAuditDb();
  return evaluateRacsIdempotencyClaim(database, { operationId, receipt });
}

export function attachRacsReceiptToNewSummary(
  newSummary: Record<string, unknown>,
  receipt: RacsReceipt
): Record<string, unknown> {
  return embedRacsReceiptInSummary(newSummary, receipt);
}

export function mapConcurrentEditError(error: unknown): { status: number; code: string; message: string; detail?: Record<string, unknown> } | undefined {
  if (error instanceof MixedVersionProtocolError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof PreviewInputChangedError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof PreviewTokenRequiredError) {
    return { status: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof AccessObjectTargetChangedError) {
    return { status: error.statusCode, code: error.code, message: error.message, detail: { conflictKind: "target_changed" } };
  }
  if (error instanceof AccessObjectVersionMismatchError) {
    return {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      detail: {
        conflictKind: error.conflictKind,
        currentObjectVersion: error.currentObjectVersion,
        requestedObjectVersion: error.requestedObjectVersion
      }
    };
  }
  return undefined;
}