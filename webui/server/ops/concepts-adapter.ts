/**
 * P1-11 — 概念注册表 Ops 写适配器（scan / set_canonical / reject）。
 *
 * 内容根：仅信 Proxy `projectRoot` + ktx.yaml `paths.content_root` 或 `<project>/config`（D11/D12）。
 */

import { access, readFile, constants } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { withOpsWriteLocks } from "./ops-locks.js";
import {
  clearConceptsRecovering,
  markConceptsRecovering,
  recoveringBlock,
  OPS_CONCEPT_RECOVERING
} from "./concepts-recovery-fence.js";
import type {
  OpsGroupContext,
  OpsGroupVerifyResult,
  OpsPlanBuildContext,
  OpsPlanDraft,
  OpsPlanGroup,
  OpsPlanTarget,
  OpsRollbackResult,
  OpsToolAdapter
} from "./ops-batch.js";

export const OPS_CONCEPT_SCAN = "lucy_ops_concept_scan";
export const OPS_CONCEPT_SET_CANONICAL = "lucy_ops_concept_set_canonical";
export const OPS_CONCEPT_REJECT = "lucy_ops_concept_reject";

export const OPS_CONCEPT_SCAN_PLACEHOLDER = "concept:__scan__";
export const OPS_EMPTY_PLAN = "ops_empty_plan";
export const OPS_WHITELIST_REF_INVALID = "ops_whitelist_ref_invalid";
export const OPS_EXTERNAL_MODIFICATION_DETECTED = "ops_external_modification_detected";
export const OPS_CONTENT_ROOT_UNAVAILABLE = "ops_content_root_unavailable";
export const OPS_CONCEPT_SUMMARY_REQUIRED = "ops_concept_summary_required";
export const OPS_CONCEPT_REQUEST_MISMATCH = "ops_concept_request_mismatch";
export { OPS_CONCEPT_RECOVERING };

export const CONCEPT_WRITE_TOOLS = new Set<string>([
  OPS_CONCEPT_SCAN,
  OPS_CONCEPT_SET_CANONICAL,
  OPS_CONCEPT_REJECT
]);

const GROUP_ID = "concepts";
const ALLOWED_WHITELIST_REFS = new Set(["seed"]);

export interface OpsConceptRoots {
  contentRoot: string;
  conceptsDir: string;
}

export class OpsConceptError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "OpsConceptError";
  }
}

/** D12：不用 `paths.ts` 软回落；不读 LUCY_CONTENT_ROOT。 */
export async function resolveOpsConceptContentRoot(projectRoot: string): Promise<OpsConceptRoots> {
  const ktxPath = path.join(projectRoot, "ktx.yaml");
  let contentRoot: string;
  try {
    const raw = await readFile(ktxPath, "utf8");
    const doc = parse(raw) as { paths?: { content_root?: string } };
    const yamlValue = doc?.paths?.content_root;
    if (typeof yamlValue === "string" && yamlValue.trim()) {
      const trimmed = yamlValue.trim();
      contentRoot = path.isAbsolute(trimmed) ? trimmed : path.resolve(projectRoot, trimmed);
    } else {
      contentRoot = path.join(projectRoot, "config");
    }
  } catch {
    throw new OpsConceptError(OPS_CONTENT_ROOT_UNAVAILABLE, `无法解析内容根（缺少或不可读 ktx.yaml）：${projectRoot}`);
  }

  try {
    await access(contentRoot, constants.R_OK);
    const { stat } = await import("node:fs/promises");
    const info = await stat(contentRoot);
    if (!info.isDirectory()) {
      throw new OpsConceptError(OPS_CONTENT_ROOT_UNAVAILABLE, `内容根不是目录：${contentRoot}`);
    }
  } catch (err) {
    if (err instanceof OpsConceptError) throw err;
    throw new OpsConceptError(OPS_CONTENT_ROOT_UNAVAILABLE, `内容根不可读：${contentRoot}`);
  }

  return { contentRoot, conceptsDir: path.join(contentRoot, "concepts") };
}

async function importConceptModule<T>(projectRoot: string, rel: string): Promise<T> {
  return import(pathToFileURL(path.join(projectRoot, rel)).href) as Promise<T>;
}

export function resolveConceptWhitelistPath(
  projectRoot: string,
  whitelistRef: unknown
): string {
  const defaultPath = path.join(projectRoot, "scripts/concepts/seed-whitelist.yaml");
  if (whitelistRef === undefined || whitelistRef === null || whitelistRef === "") {
    return defaultPath;
  }
  if (typeof whitelistRef !== "string" || !whitelistRef.trim()) {
    throw new OpsConceptError(OPS_WHITELIST_REF_INVALID, "whitelist_ref 必须是预登记 id");
  }
  const ref = whitelistRef.trim();
  if (!ALLOWED_WHITELIST_REFS.has(ref)) {
    throw new OpsConceptError(OPS_WHITELIST_REF_INVALID, `whitelist_ref 未登记：${ref}`);
  }
  if (ref === "seed") return defaultPath;
  throw new OpsConceptError(OPS_WHITELIST_REF_INVALID, `whitelist_ref 未登记：${ref}`);
}

export function conceptTargetId(conceptId: string): string {
  return `concept:${conceptId}`;
}

/**
 * SC-20／D16：commit 请求参数须与计划载荷 requestEcho 一致。
 */
export function assertConceptCommitRequestMatchesPlan(
  toolName: string,
  args: Record<string, unknown>,
  plan: { toolName: string; perTarget: OpsPlanTarget[] }
): void {
  if (plan.toolName !== toolName) {
    throw new OpsConceptError(OPS_CONCEPT_REQUEST_MISMATCH, "tool 与计划不一致");
  }
  if (toolName === OPS_CONCEPT_SCAN) {
    const planned = plan.perTarget[0]?.payload?.requestEcho as { whitelist_ref?: unknown } | undefined;
    const plannedRef = planned?.whitelist_ref ?? "seed";
    const got = args.whitelist_ref === undefined || args.whitelist_ref === "" ? "seed" : args.whitelist_ref;
    if (String(got) !== String(plannedRef)) {
      throw new OpsConceptError(OPS_CONCEPT_REQUEST_MISMATCH, "whitelist_ref 与计划不一致");
    }
    return;
  }
  if (toolName === OPS_CONCEPT_SET_CANONICAL || toolName === OPS_CONCEPT_REJECT) {
    const echo = plan.perTarget[0]?.payload?.requestEcho as
      | { concept_id?: string; binding_id?: string; summary?: string }
      | undefined;
    if (!echo) {
      throw new OpsConceptError(OPS_CONCEPT_REQUEST_MISMATCH, "计划缺少 requestEcho");
    }
    const conceptId = typeof args.concept_id === "string" ? args.concept_id.trim() : "";
    const bindingId = typeof args.binding_id === "string" ? args.binding_id.trim() : "";
    if (conceptId !== echo.concept_id || bindingId !== echo.binding_id) {
      throw new OpsConceptError(OPS_CONCEPT_REQUEST_MISMATCH, "concept_id／binding_id 与计划不一致");
    }
    if (toolName === OPS_CONCEPT_SET_CANONICAL) {
      const summary = typeof args.summary === "string" ? args.summary.trim() : "";
      if (summary !== String(echo.summary ?? "").trim()) {
        throw new OpsConceptError(OPS_CONCEPT_REQUEST_MISMATCH, "summary 与计划不一致");
      }
    }
  }
}

interface PureConceptPlanTarget {
  conceptId: string;
  beforeBytes: Buffer | null;
  afterBytes: Buffer;
  beforeFingerprint: string;
  afterFingerprint: string;
}

function mapPureTarget(
  pure: PureConceptPlanTarget,
  contentRoot: string,
  changeType: string,
  requestEcho: Record<string, unknown> = {}
): OpsPlanTarget {
  const relFile = path.join("concepts", `${pure.conceptId}.yaml`);
  return {
    id: conceptTargetId(pure.conceptId),
    groupId: GROUP_ID,
    connectionId: "",
    payload: {
      conceptId: pure.conceptId,
      contentRoot,
      beforeBytesBase64: pure.beforeBytes ? pure.beforeBytes.toString("base64") : null,
      afterBytesBase64: pure.afterBytes.toString("base64"),
      beforeFingerprint: pure.beforeFingerprint,
      afterFingerprint: pure.afterFingerprint,
      requestEcho
    },
    before: {
      fingerprint: pure.beforeFingerprint,
      absent: pure.beforeBytes == null
    },
    after: {
      fingerprint: pure.afterFingerprint
    },
    blockers: [],
    writeSet: [relFile],
    audit: {
      changeType,
      assetKind: "governance",
      targetId: pure.conceptId,
      filePath: relFile
    }
  };
}

function decodeApplyTargets(members: OpsPlanTarget[]): PureConceptPlanTarget[] {
  return members.map((member) => {
    const payload = member.payload;
    const conceptId = String(payload.conceptId ?? "");
    const afterB64 = String(payload.afterBytesBase64 ?? "");
    return {
      conceptId,
      beforeBytes:
        typeof payload.beforeBytesBase64 === "string" && payload.beforeBytesBase64
          ? Buffer.from(payload.beforeBytesBase64, "base64")
          : null,
      afterBytes: Buffer.from(afterB64, "base64"),
      beforeFingerprint: String(payload.beforeFingerprint ?? "ABSENT"),
      afterFingerprint: String(payload.afterFingerprint ?? "")
    };
  });
}

interface GroupRollbackState {
  conceptsDir: string;
  targets: PureConceptPlanTarget[];
}

const CONCEPT_GROUP_STATES = new Map<string, GroupRollbackState>();

async function reassertBeforeFingerprints(
  projectRoot: string,
  members: OpsPlanTarget[]
): Promise<void> {
  const { contentRoot } = await resolveOpsConceptContentRoot(projectRoot);
  const store = await importConceptModule<typeof import("../../../scripts/concepts/store.mjs")>(
    projectRoot,
    "scripts/concepts/store.mjs"
  );
  const apply = await importConceptModule<typeof import("../../../scripts/concepts/apply.mjs")>(
    projectRoot,
    "scripts/concepts/apply.mjs"
  );
  const dir = store.resolveFencedConceptsDir(contentRoot, { create: false });
  for (const member of members) {
    const conceptId = String(member.payload.conceptId ?? "");
    const current = store.readConceptBytes(dir, conceptId);
    const fp = apply.fingerprintBytes(current);
    const expected = String(member.payload.beforeFingerprint ?? "ABSENT");
    if (fp !== expected) {
      throw new OpsConceptError(
        OPS_EXTERNAL_MODIFICATION_DETECTED,
        `概念 '${conceptId}' 在预览后被外部修改`
      );
    }
  }
}

async function executeConceptGroup(ctx: OpsGroupContext, _changeType: string): Promise<void> {
  const applyTargets = decodeApplyTargets(ctx.members);
  const conceptIds = applyTargets.map((target) => target.conceptId);
  const { contentRoot } = await resolveOpsConceptContentRoot(ctx.projectRoot);
  const store = await importConceptModule<typeof import("../../../scripts/concepts/store.mjs")>(
    ctx.projectRoot,
    "scripts/concepts/store.mjs"
  );
  const apply = await importConceptModule<typeof import("../../../scripts/concepts/apply.mjs")>(
    ctx.projectRoot,
    "scripts/concepts/apply.mjs"
  );
  const dir = store.resolveFencedConceptsDir(contentRoot, { create: true });

  await withOpsWriteLocks(
    {
      projectRoot: ctx.projectRoot,
      scopes: ["D", "P", "C", "L"],
      publishWindow: false
    },
    async () => {
      await reassertBeforeFingerprints(ctx.projectRoot, ctx.members);
      await markConceptsRecovering(ctx.projectRoot, ctx.executionId, conceptIds);
      CONCEPT_GROUP_STATES.set(ctx.executionId, { conceptsDir: dir, targets: applyTargets });
      try {
        apply.applyConceptPlan(dir, applyTargets);
        const verified = apply.verifyConceptPlanAfterImages(dir, applyTargets);
        const failed = verified.members.some((row) => row.state !== "succeeded");
        if (failed) {
          throw new OpsConceptError("ops_concept_verify_failed", "后像核验失败");
        }
        for (const member of ctx.members) {
          ctx.setEffectPhase(member.id, "activated");
        }
        await clearConceptsRecovering(ctx.projectRoot, ctx.executionId);
      } catch (err) {
        // 保留 recovering 围栏直至 rollback／verify 收敛
        throw err;
      }
    }
  );
}

async function rollbackConceptGroup(ctx: OpsGroupContext): Promise<OpsRollbackResult> {
  const state = CONCEPT_GROUP_STATES.get(ctx.executionId);
  if (!state) {
    return { complete: false, detail: "ops_concept_preimage_unavailable" };
  }
  try {
    const fs = await import("node:fs");
    const store = await importConceptModule<typeof import("../../../scripts/concepts/store.mjs")>(
      ctx.projectRoot,
      "scripts/concepts/store.mjs"
    );
    const dir = store.resolveFencedConceptsDir(state.conceptsDir, { create: false });
    for (const target of state.targets) {
      const file = store.safeConceptPath(dir, target.conceptId);
      if (target.beforeBytes == null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        continue;
      }
      const fd = fs.openSync(file, "w");
      try {
        fs.writeSync(fd, target.beforeBytes);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    await clearConceptsRecovering(ctx.projectRoot, ctx.executionId);
    return { complete: true };
  } catch (err) {
    return { complete: false, detail: String(err) };
  } finally {
    CONCEPT_GROUP_STATES.delete(ctx.executionId);
  }
}

async function verifyConceptGroup(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult> {
  const state = CONCEPT_GROUP_STATES.get(ctx.executionId);
  const apply = await importConceptModule<typeof import("../../../scripts/concepts/apply.mjs")>(
    ctx.projectRoot,
    "scripts/concepts/apply.mjs"
  );
  const contentRoot = state?.conceptsDir
    ? path.dirname(state.conceptsDir)
    : (await resolveOpsConceptContentRoot(ctx.projectRoot)).contentRoot;
  const store = await importConceptModule<typeof import("../../../scripts/concepts/store.mjs")>(
    ctx.projectRoot,
    "scripts/concepts/store.mjs"
  );
  const dir = state?.conceptsDir ?? store.resolveFencedConceptsDir(contentRoot, { create: false });
  const applyTargets = decodeApplyTargets(ctx.members);
  const plannedAfter = applyTargets.map((target) => ({
    conceptId: target.conceptId,
    beforeBytes: target.beforeBytes,
    afterBytes: target.afterBytes
  }));
  const verified = apply.verifyConceptPlanAfterImages(dir, plannedAfter);
  const allOk = verified.members.every((row) => row.state === "succeeded");
  if (allOk) {
    await clearConceptsRecovering(ctx.projectRoot, ctx.executionId);
  }
  return {
    members: verified.members.map((row) => ({
      id: row.id,
      state: row.state === "succeeded" ? "succeeded" : "failed"
    }))
  };
}

abstract class ConceptWriteAdapterBase implements OpsToolAdapter {
  abstract readonly toolName: string;
  abstract readonly planChangeType: string;

  operationAudit() {
    return {
      filePath: "concepts/",
      changeType: this.planChangeType,
      assetKind: "governance" as const
    };
  }

  abstract parseTargets(request: Record<string, unknown>): unknown[];

  targetId(target: unknown): string {
    const record = target as { conceptId?: string; mode?: string };
    if (record.mode === "scan_preview" || record.mode === "scan_commit") {
      return OPS_CONCEPT_SCAN_PLACEHOLDER;
    }
    if (record.conceptId) return conceptTargetId(record.conceptId);
    return OPS_CONCEPT_SCAN_PLACEHOLDER;
  }

  connectionId(): string {
    return "";
  }

  abstract buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft>;

  async executeGroup(ctx: OpsGroupContext): Promise<void> {
    return executeConceptGroup(ctx, this.planChangeType);
  }

  async rollbackGroup(ctx: OpsGroupContext): Promise<OpsRollbackResult> {
    return rollbackConceptGroup(ctx);
  }

  async verifyGroup(ctx: OpsGroupContext): Promise<OpsGroupVerifyResult> {
    return verifyConceptGroup(ctx);
  }
}

export class OpsConceptScanAdapter extends ConceptWriteAdapterBase {
  readonly toolName = OPS_CONCEPT_SCAN;
  readonly planChangeType = "concept_scan";

  parseTargets(request: Record<string, unknown>): unknown[] {
    if (request.targets !== undefined) {
      throw new OpsConceptError("ops_concept_scan_targets_forbidden", "scan 不接受客户端 targets 覆盖");
    }
    if (request.dry_run === true) {
      return [{ mode: "scan_preview", whitelist_ref: request.whitelist_ref }];
    }
    return [{ mode: "scan_commit" }];
  }

  async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const blocked = await recoveringBlock(ctx.projectRoot);
    if (blocked) {
      throw new OpsConceptError(OPS_CONCEPT_RECOVERING, "概念写集处于恢复中，暂不可 scan");
    }
    const whitelistPath = resolveConceptWhitelistPath(
      ctx.projectRoot,
      (ctx.request as { whitelist_ref?: unknown }).whitelist_ref
    );
    const { contentRoot } = await resolveOpsConceptContentRoot(ctx.projectRoot);
    const scan = await importConceptModule<typeof import("../../../scripts/concepts/scan.mjs")>(
      ctx.projectRoot,
      "scripts/concepts/scan.mjs"
    );
    const pure = scan.planScan({ contentRoot, whitelistPath });
    const blockers: string[] = [];
    if (!pure.targets.length) {
      blockers.push(OPS_EMPTY_PLAN);
    }
    const whitelistRef =
      (ctx.request as { whitelist_ref?: unknown }).whitelist_ref === undefined ||
      (ctx.request as { whitelist_ref?: unknown }).whitelist_ref === ""
        ? "seed"
        : String((ctx.request as { whitelist_ref?: unknown }).whitelist_ref);
    const perTarget = pure.targets.map((target) =>
      mapPureTarget(target as PureConceptPlanTarget, contentRoot, this.planChangeType, {
        whitelist_ref: whitelistRef
      })
    );
    const groups: OpsPlanGroup[] =
      perTarget.length > 0
        ? [
            {
              id: GROUP_ID,
              memberIds: perTarget.map((target) => target.id),
              sharedFiles: perTarget.map((target) => target.writeSet[0] ?? "")
            }
          ]
        : [];
    return { perTarget, groups, blockers };
  }
}

function parseCanonicalRejectRequest(
  request: Record<string, unknown>,
  requireSummary: boolean
): { conceptId: string; bindingId: string; summary?: string } {
  const conceptId = typeof request.concept_id === "string" ? request.concept_id.trim() : "";
  const bindingId = typeof request.binding_id === "string" ? request.binding_id.trim() : "";
  if (!conceptId || !bindingId) {
    throw new OpsConceptError("ops_concept_binding_required", "concept_id 与 binding_id 必填");
  }
  const summary = typeof request.summary === "string" ? request.summary : "";
  if (requireSummary && !summary.trim()) {
    throw new OpsConceptError(OPS_CONCEPT_SUMMARY_REQUIRED, "set_canonical 需要非空 summary");
  }
  return { conceptId, bindingId, ...(requireSummary ? { summary } : {}) };
}

export class OpsConceptSetCanonicalAdapter extends ConceptWriteAdapterBase {
  readonly toolName = OPS_CONCEPT_SET_CANONICAL;
  readonly planChangeType = "concept_set_canonical";

  parseTargets(request: Record<string, unknown>): unknown[] {
    const parsed = parseCanonicalRejectRequest(request, true);
    return [{ conceptId: parsed.conceptId, bindingId: parsed.bindingId, summary: parsed.summary }];
  }

  async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const parsed = parseCanonicalRejectRequest(ctx.request, true);
    const blocked = await recoveringBlock(ctx.projectRoot, [parsed.conceptId]);
    if (blocked) {
      throw new OpsConceptError(OPS_CONCEPT_RECOVERING, `概念 '${parsed.conceptId}' 处于恢复中`);
    }
    const { contentRoot } = await resolveOpsConceptContentRoot(ctx.projectRoot);
    const plan = await importConceptModule<typeof import("../../../scripts/concepts/plan.mjs")>(
      ctx.projectRoot,
      "scripts/concepts/plan.mjs"
    );
    const blockers: string[] = [];
    let perTarget: OpsPlanTarget[] = [];
    try {
      const pure = plan.planSetCanonical({
        conceptsDir: path.join(contentRoot, "concepts"),
        conceptId: parsed.conceptId,
        bindingId: parsed.bindingId,
        summary: parsed.summary ?? ""
      });
      perTarget = pure.targets.map((target) =>
        mapPureTarget(target as PureConceptPlanTarget, contentRoot, this.planChangeType, {
          concept_id: parsed.conceptId,
          binding_id: parsed.bindingId,
          summary: parsed.summary ?? ""
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("summary")) {
        blockers.push(OPS_CONCEPT_SUMMARY_REQUIRED);
      } else if (message.includes("not found")) {
        blockers.push("ops_concept_not_found");
      } else {
        blockers.push("ops_concept_plan_failed");
      }
    }
    const groups: OpsPlanGroup[] =
      perTarget.length > 0
        ? [{ id: GROUP_ID, memberIds: perTarget.map((target) => target.id), sharedFiles: perTarget.map((t) => t.writeSet[0] ?? "") }]
        : [];
    return { perTarget, groups, blockers };
  }
}

export class OpsConceptRejectAdapter extends ConceptWriteAdapterBase {
  readonly toolName = OPS_CONCEPT_REJECT;
  readonly planChangeType = "concept_reject";

  parseTargets(request: Record<string, unknown>): unknown[] {
    const parsed = parseCanonicalRejectRequest(request, false);
    return [{ conceptId: parsed.conceptId, bindingId: parsed.bindingId }];
  }

  async buildPlan(ctx: OpsPlanBuildContext): Promise<OpsPlanDraft> {
    const parsed = parseCanonicalRejectRequest(ctx.request, false);
    const blocked = await recoveringBlock(ctx.projectRoot, [parsed.conceptId]);
    if (blocked) {
      throw new OpsConceptError(OPS_CONCEPT_RECOVERING, `概念 '${parsed.conceptId}' 处于恢复中`);
    }
    const { contentRoot } = await resolveOpsConceptContentRoot(ctx.projectRoot);
    const plan = await importConceptModule<typeof import("../../../scripts/concepts/plan.mjs")>(
      ctx.projectRoot,
      "scripts/concepts/plan.mjs"
    );
    const blockers: string[] = [];
    let perTarget: OpsPlanTarget[] = [];
    try {
      const pure = plan.planReject({
        conceptsDir: path.join(contentRoot, "concepts"),
        conceptId: parsed.conceptId,
        bindingId: parsed.bindingId
      });
      perTarget = pure.targets.map((target) =>
        mapPureTarget(target as PureConceptPlanTarget, contentRoot, this.planChangeType, {
          concept_id: parsed.conceptId,
          binding_id: parsed.bindingId
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found")) {
        blockers.push("ops_concept_not_found");
      } else {
        blockers.push("ops_concept_plan_failed");
      }
    }
    const groups: OpsPlanGroup[] =
      perTarget.length > 0
        ? [{ id: GROUP_ID, memberIds: perTarget.map((target) => target.id), sharedFiles: perTarget.map((t) => t.writeSet[0] ?? "") }]
        : [];
    return { perTarget, groups, blockers };
  }
}

export const conceptWriteAdapters: OpsToolAdapter[] = [
  new OpsConceptScanAdapter(),
  new OpsConceptSetCanonicalAdapter(),
  new OpsConceptRejectAdapter()
];
