/**
 * P1-59 — object-version write protocol for Role / Agent saves (Wave 2 core).
 *
 * Authority: docs/specs/lucy-20261119-roles-agent-concurrent-edit-spec.md §3–§4
 *
 * Routes read fresh compiler inputs on preview and commit. Client digests
 * are diagnostics only, never authoritative inputs to a save.
 */
import { sha256Hex, stableJson } from "../config-digest.js";
import { evaluateGovernanceOverride, type AccessGovernanceOverrideRequest, type AccessGovernanceGateDecision } from "../access-governance-gate.js";
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
import { racsIdempotencyKey, parseRacsReceiptFromSummary } from "./access-write-status.js";
import { getAuditDb } from "./audit.js";
import { computeCandidateConfigDigest } from "./access-object-version.js";
import { trustedActorFromRequest, type TrustedActor } from "../security/request-actor.js";
import { buildAdminPermissionContext, roleCompileInputClosureForAdmin, resolveRoleIds } from "../proxy/acl.js";
import { parseAccessConfigText } from "../proxy/identity.js";
import { stringify } from "yaml";
import { requireWebuiAuthHook } from "../auth/guard.js";
import { readAccessRecoveryState } from "../access-recovery.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { withPublishCoordinator, type PublishEntryKind } from "../publish-coordinator.js";
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
    sensitiveSourceKeys: gate.findings.map((finding) => `${finding.tier}:${finding.code}`).sort(),
    rawCallCount: gate.findings?.length ?? 0
  };
}

export async function readRolesAgentCompileInputsDigest(
  kind: "role" | "agent", objectId: string, config: YamlAccessConfig,
  before?: { role?: YamlRole; user?: YamlUser }
): Promise<string> {
  const context = await buildAdminPermissionContext(parseAccessConfigText(stringify(config)));
  const subject = config.users.find((user) => user.id === objectId);
  const resolved = subject ? resolveRoleIds(subject) : undefined;
  const previousRoles = before?.user ? resolveRoleIds(before.user) : undefined;
  const ids = kind === "role" ? [objectId] : [...new Set([
    ...(resolved?.ok ? resolved.roleIds : []), ...(previousRoles?.ok ? previousRoles.roleIds : [])
  ])];
  const roles = await Promise.all([...ids].sort().map(async (id) => ({
    id, inputs: await roleCompileInputClosureForAdmin(id, context)
  })));
  const previousRole = kind === "role" && before?.role
    ? await roleCompileInputClosureForAdmin(objectId, { ...context,
        config: parseAccessConfigText(stringify({ ...config, roles: { ...config.roles, [objectId]: before.role } })) })
    : undefined;
  return sha256Hex(stableJson({ roles, previousRole,
    // Legacy inline grants cannot prove a narrower compiler closure.
    ...(kind === "agent" && (subject?.allow || before?.user?.allow) ? {
      legacySourceMap: context.sourceMapVersion, legacyEnabled: context.enabledTablesDigest
    } : {}), classification: context.toolClassificationVersion
  }));
}

/** Request-start authentication is not the publish-window authentication. */
export async function recheckRolesAgentWriteAccess(
  request: FastifyRequest, reply: FastifyReply, projectRoot: string
): Promise<boolean> {
  await requireWebuiAuthHook(request, reply);
  if (reply.sent) return false;
  if ((await readAccessRecoveryState(projectRoot)).required) {
    await reply.status(503).send({ ok: false, error: {
      code: "ACCESS_RECOVERY_REQUIRED", message: "访问控制配置处于待恢复状态，请先完成恢复核验后重试。"
    } });
    return false;
  }
  return true;
}

/** Buffer an explicit reply until the durable write AND lock release complete.
 * Fastify's real reply is thenable: sending it inside the coordinator lets the
 * next HTTP request race the coordinator's finally/unlink. Only this request's
 * facade is buffered; headers and status remain normal Fastify operations.
 */
export async function runRolesAgentPublishWindow<T>(
  kind: PublishEntryKind, projectRoot: string, reply: FastifyReply,
  fn: (deferredReply: FastifyReply) => Promise<T>
): Promise<T | FastifyReply> {
  let pending: { payload: unknown } | undefined;
  const facade: FastifyReply = new Proxy(reply, {
    get(target, property) {
      if (property === "then") return undefined;
      if (property === "sent") return Boolean(pending) || target.sent;
      if (property === "send") return (payload: unknown) => { pending = { payload }; return facade; };
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        return result === target ? facade : result;
      };
    }
  });
  let result: T;
  try { result = await withPublishCoordinator(kind, () => fn(facade), { projectRoot }); }
  catch (error) {
    if ((error as { code?: string }).code !== "PUBLISH_COORDINATOR_BUSY") throw error;
    return reply.status(503).send({ ok: false, error: { code: "PUBLISH_COORDINATOR_BUSY",
      message: "有变更正在保存，请稍后重试。" } });
  }
  return pending ? reply.send(pending.payload) : result;
}

/** New writes claim the window before expensive compilation. Recorded operations
 * keep their existing read-only replay path even while another writer is busy. */
const responseAfterPublish = Symbol("roles-agent-response-after-publish");
export function rolesAgentResponseAfterPublish<T>(fn: (reply: FastifyReply) => Promise<T>) {
  return { [responseAfterPublish]: fn };
}
export async function runRolesAgentMutationRequest<T>(
  kind: PublishEntryKind, projectRoot: string, request: FastifyRequest, reply: FastifyReply,
  dryRun: boolean, fn: (deferredReply: FastifyReply) => Promise<T>
): Promise<unknown> {
  const finish = (value: unknown) => value && typeof value === "object" && responseAfterPublish in value
    ? (value as ReturnType<typeof rolesAgentResponseAfterPublish>)[responseAfterPublish](reply) : value;
  const fields = request.body as AccessWriteProtocolFields | undefined;
  if (!dryRun && fields?.baseObjectVersion && typeof fields.operationId === "string" && isValidClientOperationId(fields.operationId.trim())) {
    const recorded = (await getAuditDb()).prepare("SELECT 1 FROM config_change_log WHERE idempotency_key=? LIMIT 1")
      .get(racsIdempotencyKey(fields.operationId));
    if (recorded) return finish(await fn(reply));
  }
  if (dryRun) return finish(await fn(reply));
  const result = await runRolesAgentPublishWindow(kind, projectRoot, reply, async (deferred) => {
    if (!(await recheckRolesAgentWriteAccess(request, deferred, projectRoot))) return;
    return fn(deferred);
  });
  return finish(result);
}

export function rolesAgentRequestDigest(fields: AccessWriteProtocolFields & { patch?: unknown }): string {
  return sha256Hex(stableJson({ baseObjectVersion: fields.baseObjectVersion,
    previewToken: fields.previewToken, patch: digestNormalizedPatch(fields.patch ?? {}) }));
}

/** Creation/copy/deletion use the same preview, receipt and confirmation contract. */
export async function prepareRolesAgentMutation(input: {
  request: FastifyRequest; reply: FastifyReply; kind: RacsObjectKind; objectId: string;
  action: "create" | "delete"; dryRun: boolean; config: YamlAccessConfig;
  candidate: YamlAccessConfig; gate: AccessGovernanceGateDecision;
  fields: AccessWriteProtocolFields; value?: unknown; copySourceId?: string;
}): Promise<{ preview: Record<string, string>; audit: { idempotencyKey?: string; racsReceipt?: RacsReceipt } } | null> {
  const { kind, objectId, fields, config, candidate, request, reply } = input;
  if (!input.dryRun && (input.gate.decision === "block" || (input.gate.decision === "override_required"
      && !evaluateGovernanceOverride((request.body as { override?: AccessGovernanceOverrideRequest })?.override, input.gate).ok))) {
    await reply.status(409).send({ ok: false, error: { code: "GOVERNANCE_GATE_BLOCKED", message: "当前权限影响已变化，请重新预览并确认。" } }); return null;
  }
  if (!input.dryRun && !fields.baseObjectVersion) return { preview: {}, audit: {} }; // legacy
  const baseline = input.action === "create" ? baseObjectVersionForAbsence(kind, objectId)
    : kind === "role" ? readRoleBaseObjectVersion(config, objectId) : readAgentBaseObjectVersion(config, objectId);
  if (!baseline) throw new AccessObjectTargetChangedError();
  const mode = resolveAccessWriteVersionMode({ ...fields, ...(fields.baseObjectVersion ? {} : { version: undefined }),
    baseObjectVersion: fields.baseObjectVersion ?? serializeBaseObjectVersion(baseline) });
  if (mode.mode !== "object") throw new MixedVersionProtocolError();
  if (input.action === "create") {
    if (kind === "role") assertRoleCreateAbsenceBaseline(config, objectId, mode.baseObjectVersion);
    else assertAgentCreateAbsenceBaseline(config, objectId, mode.baseObjectVersion);
  } else if (kind === "role") assertRoleObjectBaseline(config, objectId, mode.baseObjectVersion);
  else assertAgentObjectBaseline(config, objectId, mode.baseObjectVersion);
  const patch = { action: input.action, value: input.value ?? null, copySourceId: input.copySourceId ?? null };
  const bindingConfig = input.action === "create" ? candidate : config;
  const compileInputsDigest = await readRolesAgentCompileInputsDigest(kind, objectId, bindingConfig);
  const binding = computeRoleAgentPreviewBinding({ kind, objectId, baseObjectVersion: mode.baseObjectVersion,
    config: bindingConfig, patch, compileInputsDigest, gate: input.gate, actor: trustedActorFromRequest(request),
    absence: input.action === "create", copySourceObjectVersion: input.copySourceId
      ? readRoleBaseObjectVersion(config, input.copySourceId) : undefined
  });
  const preview = { baseObjectVersion: serializeBaseObjectVersion(mode.baseObjectVersion),
    previewToken: binding.previewToken, compileInputsDigest };
  if (input.dryRun) return { preview, audit: {} };
  assertPreviewTokenMatches(fields.previewToken, binding.previewEffectDigest);
  const operation = resolveRolesAgentRacsOperation(mode, fields.operationId);
  if (operation.kind !== "racs") {
    if (operation.kind === "reject") await reply.status(operation.status).send({ ok: false, error: operation });
    return null;
  }
  const receipt = buildRolesAgentRacsReceipt({ actor: trustedActorFromRequest(request), objectKind: kind, objectId,
    previewEffectDigest: binding.previewEffectDigest, baseObjectVersionSerialized: preview.baseObjectVersion,
    candidateConfig: candidate, requestDigest: rolesAgentRequestDigest({ ...fields, patch }) });
  const claim = await evaluateRolesAgentRacsIdempotencyClaim(operation.operationId, receipt);
  if (claim.kind === "reject") {
    const error = mapRacsIdempotencyRejectToHttp(claim.code);
    await reply.status(error.status).send({ ok: false, error }); return null;
  }
  if (claim.kind === "replay") {
    const { respondRacsIdempotencyReplay } = await import("./access-config.js");
    const replay = await respondRacsIdempotencyReplay(claim.auditId, { operationId: operation.operationId });
    await reply.status(replay.statusCode).send(replay.body); return null;
  }
  return { preview, audit: { idempotencyKey: claim.idempotencyKey, racsReceipt: receipt } };
}

/** Existing operations are resolved before comparing today's object baseline. */
export async function replayRecordedRolesAgentWrite(
  request: FastifyRequest, reply: FastifyReply, mode: AccessWriteVersionMode,
  kind: RacsObjectKind, objectId: string,
  fields: AccessWriteProtocolFields & { patch?: unknown }
): Promise<boolean> {
  const operation = resolveRolesAgentRacsOperation(mode, fields.operationId);
  if (operation.kind === "legacy") return false;
  if (operation.kind === "reject") {
    await reply.status(operation.status).send({ ok: false, error: operation });
    return true;
  }
  const db = await getAuditDb();
  const row = db.prepare("SELECT id, new_summary FROM config_change_log WHERE idempotency_key = ? LIMIT 1")
    .get(racsIdempotencyKey(operation.operationId)) as { id: number; new_summary: string | null } | undefined;
  if (!row) return false;
  let summary: unknown;
  try { summary = JSON.parse(row.new_summary ?? "null"); } catch { summary = null; }
  const receipt = parseRacsReceiptFromSummary(summary);
  const actor = trustedActorFromRequest(request);
  const code = !receipt ? "idempotency_receipt_missing"
    : receipt.submitterAccountUid !== actor.accountUid || receipt.submitterActorId !== actor.actorId
      ? "idempotency_actor_mismatch"
      : receipt.objectKind !== kind || receipt.objectId !== objectId || receipt.requestDigest !== rolesAgentRequestDigest(fields)
        ? "idempotency_payload_mismatch" : undefined;
  if (code) {
    const mapped = mapRacsIdempotencyRejectToHttp(code);
    await reply.status(mapped.status).send({ ok: false, error: mapped });
  } else {
    const { respondRacsIdempotencyReplay } = await import("./access-config.js");
    const replay = await respondRacsIdempotencyReplay(row.id, { operationId: operation.operationId });
    await reply.status(replay.statusCode).send(replay.body);
  }
  return true;
}

export interface RoleAgentPreviewBindingInput {
  kind: "role" | "agent";
  objectId: string;
  baseObjectVersion: BaseObjectVersion;
  config: YamlAccessConfig;
  patch: unknown;
  compileInputsDigest: string;
  gate: AccessGovernanceGateDecision;
  actor?: Pick<TrustedActor, "accountUid" | "actorId" | "role">;
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
    normalizedPatchDigest: input.actor ? sha256Hex(stableJson({ patchDigest, actor: {
      accountUid: input.actor.accountUid, actorId: input.actor.actorId, role: input.actor.role
    } })) : patchDigest,
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
  if (!trimmed) return { kind: "reject", status: 400, code: "OPERATION_ID_REQUIRED", message: "请重新预览并确认保存，以生成本次保存的请求编号。" };
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
  requestDigest?: string;
}): RacsReceipt {
  return buildRacsReceipt({
    submitterAccountUid: input.actor.accountUid,
    submitterActorId: input.actor.actorId,
    objectKind: input.objectKind,
    objectId: input.objectId,
    requestDigest: input.requestDigest ?? input.previewEffectDigest.toLowerCase(),
    baseObjectVersion: input.baseObjectVersionSerialized,
    committedObjectVersion: serializeBaseObjectVersion(
      (input.objectKind === "role" ? readRoleBaseObjectVersion(input.candidateConfig, input.objectId)
        : readAgentBaseObjectVersion(input.candidateConfig, input.objectId))
      ?? baseObjectVersionForAbsence(input.objectKind, input.objectId)
    ),
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
