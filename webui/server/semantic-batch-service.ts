// Lucy v0.25 / L25-11 — P0-3 semantic batch operations: production services.
//
// Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
//
// This module is the PRODUCTION wiring for the batch loop that the base
// modules (`semantic-scopes`, `semantic-identity`, `semantic-maintenance-package`,
// `semantic-limits`, `semantic-checks`, `semantic-batch-tasks`) already provide.
//
// Three rules shape everything here:
//
//   1. The CLIENT NEVER SENDS A TARGET PATH. Targets are computed server-side
//      from the full `{connectionId, schema, table}` identity (Spec §4.1).
//   2. A CONFLICT IS A CONFLICT. The confirmation is bound to a `planDigest`
//      that covers the candidate, the exact target set and each target's
//      expected digest — not to a global boolean (Spec §7.2).
//   3. FAIL CLOSED. A malformed request, an over-limit package, an unverifiable
//      export baseline or an unresolved recovery journal produces ZERO staging,
//      ZERO formal writes, ZERO mirror writes and ZERO index effects.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildExportBaseline,
  buildMaintenancePackage,
  newMaintenanceExportId,
  persistMaintenanceExportBaseline,
  pruneMaintenanceExportBaselines,
  readTargetContent,
  readZipEntries,
  unpackMaintenancePackage,
  verifyMaintenanceExportBaseline,
  MaintenancePackageError,
  type MaintenancePackageMetadata,
  type UnpackedMaintenancePackage
} from "./semantic-maintenance-package.js";
import {
  assertDependencyLimit,
  assertHttpBodyLimit,
  assertSelectedTableLimit,
  assertYamlEntryLimit,
  SEMANTIC_BATCH_LIMITS
} from "./semantic-limits.js";
import {
  buildSemanticModelIndex,
  resolveSemanticDependencyClosure,
  semanticIdentityKey,
  sortUniqueSemanticIdentities,
  type SemanticModelIndex,
  type SemanticTableIdentity
} from "./semantic-identity.js";
import {
  computeSemanticPlanDigest,
  requireFreshSemanticScope,
  resolveSemanticInstanceId,
  type SemanticScopeRecord
} from "./semantic-scopes.js";
import { resolveLucyVersion } from "./lucy-version.js";
import { loadRuntimeRevision } from "./lucy-revision.js";

// ─── Errors ─────────────────────────────────────────────────────────────────

export type SemanticBatchErrorCode =
  | "INVALID_REQUEST_SHAPE"
  | "SCOPE_NOT_FOUND"
  | "SCOPE_EXPIRED"
  | "SCOPE_ACTOR_MISMATCH"
  | "SCOPE_INSTANCE_MISMATCH"
  | "IDENTITY_AMBIGUOUS"
  | "IDENTITY_NOT_FOUND"
  | "MAINTENANCE_PACKAGE_INVALID"
  | "PACKAGE_BASELINE_UNKNOWN"
  | "PACKAGE_BASELINE_MISMATCH"
  | "PACKAGE_INSTANCE_MISMATCH"
  | "PLAN_DIGEST_MISMATCH"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "BATCH_TASK_NOT_FOUND"
  | "LIMIT_EXCEEDED"
  | "BATCH_NO_CHANGE";

export class SemanticBatchError extends Error {
  readonly code: SemanticBatchErrorCode;
  readonly statusCode: number;
  readonly errors: Array<{ field?: string; index?: number; message: string }>;
  readonly details?: Record<string, unknown>;

  constructor(
    code: SemanticBatchErrorCode,
    message: string,
    options: {
      statusCode?: number;
      errors?: Array<{ field?: string; index?: number; message: string }>;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
    this.name = "SemanticBatchError";
    this.code = code;
    this.statusCode = options.statusCode ?? 400;
    this.errors = options.errors ?? [];
    this.details = options.details;
  }
}

/** Map a base-module error onto the batch error contract. */
export function toSemanticBatchError(error: unknown): SemanticBatchError {
  if (error instanceof SemanticBatchError) return error;
  if (error instanceof MaintenancePackageError) {
    const code = (
      {
        PACKAGE_INSTANCE_MISMATCH: "PACKAGE_INSTANCE_MISMATCH",
        PACKAGE_BASELINE_UNKNOWN: "PACKAGE_BASELINE_UNKNOWN",
        PACKAGE_BASELINE_EXPIRED: "PACKAGE_BASELINE_UNKNOWN",
        PACKAGE_BASELINE_MISMATCH: "PACKAGE_BASELINE_MISMATCH"
      } as Record<string, SemanticBatchErrorCode>
    )[error.code] ?? "MAINTENANCE_PACKAGE_INVALID";
    return new SemanticBatchError(code, error.message, { statusCode: error.statusCode ?? 400 });
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;
  if (code === "SCOPE_NOT_FOUND" || code === "SCOPE_EXPIRED" || code === "SCOPE_ACTOR_MISMATCH") {
    return new SemanticBatchError(code, message, { statusCode: 409 });
  }
  if (code === "IDENTITY_AMBIGUOUS" || code === "IDENTITY_NOT_FOUND") {
    return new SemanticBatchError(code, message, { statusCode: 409 });
  }
  return new SemanticBatchError("MAINTENANCE_PACKAGE_INVALID", message, { statusCode: 400 });
}

// ─── HTTP envelope shape validation (Spec §8) ──────────────────────────────

export type SemanticBatchFileInput = { filename: string; content: string };
export type SemanticBatchPackageInput = { filename: string; contentBase64: string };

export interface SemanticValidateEnvelope {
  files: SemanticBatchFileInput[];
  packages: SemanticBatchPackageInput[];
  defaultConnectionId?: string;
  defaultSchema?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the `files` / `packages` envelope.
 *
 * Spec §8: "缺字段、错类型、`null`、标量或其他错形 entry 必须在进入解包／语义
 * 校验前按原始数组索引定位并**整批拒绝**，不得先 `.filter` 丢弃错误元素再
 * 校验剩余合法项".
 *
 * So: a single malformed entry rejects the WHOLE batch. A non-array `files` is
 * rejected as well — the "absent or empty array" compatibility path must not
 * become a hole that accepts a scalar.
 */
export function parseSemanticValidateEnvelope(body: unknown): SemanticValidateEnvelope {
  if (!isPlainObject(body)) {
    throw new SemanticBatchError(
      "INVALID_REQUEST_SHAPE",
      "请求体必须是 JSON 对象。",
      { statusCode: 400, errors: [{ message: "请求体必须是 JSON 对象。" }] }
    );
  }

  const problems: Array<{ field?: string; index?: number; message: string }> = [];

  const readArray = <T>(
    field: "files" | "packages",
    required: (entry: Record<string, unknown>) => { key: "filename" | "content" | "contentBase64"; label: string }[]
  ): T[] => {
    const raw = body[field];
    if (raw === undefined || raw === null) {
      // An explicitly `null` value is NOT the same as "absent": the contract
      // says a provided value must be an array.
      if (raw === null) {
        problems.push({ field, message: `${field} 必须是数组，不能是 null。` });
      }
      return [];
    }
    if (!Array.isArray(raw)) {
      problems.push({ field, message: `${field} 必须是数组。` });
      return [];
    }
    const out: T[] = [];
    raw.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        problems.push({
          field,
          index,
          message: `${field}[${index}] 必须是对象，不能是 ${entry === null ? "null" : typeof entry}。`
        });
        return;
      }
      const missing = required(entry).filter(({ key }) => typeof entry[key] !== "string");
      if (missing.length > 0) {
        problems.push({
          field,
          index,
          message: `${field}[${index}] 缺少必填字段或字段类型错误：${missing
            .map(({ key, label }) => `${key}（${label}）`)
            .join("、")}。`
        });
        return;
      }
      out.push(entry as unknown as T);
    });
    return out;
  };

  const files = readArray<SemanticBatchFileInput>("files", () => [
    { key: "filename", label: "文件名" },
    { key: "content", label: "内容" }
  ]);
  const packages = readArray<SemanticBatchPackageInput>("packages", () => [
    { key: "filename", label: "文件名" },
    { key: "contentBase64", label: "Base64 内容" }
  ]);

  if (problems.length > 0) {
    throw new SemanticBatchError(
      "INVALID_REQUEST_SHAPE",
      `请求结构不合法，本次提交已整批拒绝（${problems.length} 项）。`,
      { statusCode: 400, errors: problems }
    );
  }

  const envelope: SemanticValidateEnvelope = { files, packages };
  if (typeof body.defaultConnectionId === "string") {
    envelope.defaultConnectionId = body.defaultConnectionId;
  }
  if (typeof body.defaultSchema === "string") {
    envelope.defaultSchema = body.defaultSchema;
  }
  return envelope;
}

/** Enforce the shared HTTP body limit on the RAW request body. */
export function assertSemanticHttpBodySize(rawBodyLength: number): void {
  try {
    assertHttpBodyLimit(rawBodyLength);
  } catch (error) {
    throw new SemanticBatchError("LIMIT_EXCEEDED", (error as Error).message, { statusCode: 413 });
  }
}

/**
 * Is this ZIP a `semantic-maintenance-package/v1`?
 *
 * The check is by CONTENT, not by file name: the package declares its kind in
 * the `package.json` metadata (Spec §5). A generic ZIP of YAML files keeps its
 * existing meaning and must not be mistaken for a maintenance package.
 */
export function isMaintenancePackageZip(buffer: Buffer): boolean {
  let entries;
  try {
    entries = readZipEntries(buffer);
  } catch {
    return false;
  }
  const metadataEntry = entries.find((entry) => entry.name === "package.json");
  if (!metadataEntry) return false;
  try {
    const parsed = JSON.parse(metadataEntry.data.toString("utf8")) as { packageKind?: unknown };
    return parsed?.packageKind === MAINTENANCE_PACKAGE_KIND;
  } catch {
    return false;
  }
}

// ─── Product identity ───────────────────────────────────────────────────────

export function semanticProductIdentity(): { name: string; version: string; revision: string } {
  const revision = loadRuntimeRevision();
  return {
    name: "Lucy",
    version: resolveLucyVersion(),
    revision: `${revision.gitSha}${revision.gitDirty ? "-dirty" : ""}`
  };
}

// ─── Scope → export (Spec §5) ──────────────────────────────────────────────

export interface SemanticMaintenanceExportResult {
  packageKind: typeof MAINTENANCE_PACKAGE_KIND;
  exportId: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
  scopeId: string;
  baselineDigest: string;
  expiresAt: string;
  selected: SemanticTableIdentity[];
  dependencies: SemanticTableIdentity[];
  includedFiles: string[];
  entryCount: number;
}

const MAINTENANCE_PACKAGE_KIND = "semantic-maintenance-package/v1" as const;
const EXPORT_DIR_REL = ".ktx-ui/exports";

/**
 * Build a `semantic-maintenance-package/v1` from a scope snapshot.
 *
 * The package is built from the SERVER-COMPUTED targets of the scope's
 * identities, and the server keeps its own export baseline record. The client
 * can edit the overlay bytes and nothing else (Spec §5).
 */
export async function exportSemanticMaintenancePackage(
  projectRoot: string,
  input: {
    actor: string;
    instanceId: string;
    scopeId: string;
    now?: () => number;
    /**
     * Called after the package is built but BEFORE it is stored and handed
     * out. The export audit must be durable before the operator can act on
     * the package (Spec §7.3, D22) — a failure here fails the export closed.
     */
    beforeDeliver?: (info: {
      exportId: string;
      packageDigest: string;
      entryCount: number;
      selectedCount: number;
      dependencyCount: number;
    }) => Promise<void>;
  }
): Promise<SemanticMaintenanceExportResult> {
  const scope = await requireFreshSemanticScope(projectRoot, input.scopeId, {
    actor: input.actor,
    instanceId: input.instanceId,
    ...(input.now ? { now: input.now } : {})
  });

  const index = await buildSemanticModelIndex(projectRoot);
  const selected = sortUniqueSemanticIdentities(scope.refs);
  const dependencies = sortUniqueSemanticIdentities(scope.dependencies);
  assertSelectedTableLimit(selected.length);
  assertDependencyLimit(dependencies.length);

  const overlays = selected.map((identity) => {
    const entry = index.byKey.get(semanticIdentityKey(identity));
    if (!entry) {
      throw new SemanticBatchError(
        "IDENTITY_NOT_FOUND",
        `所选表 ${semanticIdentityKey(identity)} 在当前模型中不存在，请重新选择。`,
        { statusCode: 409 }
      );
    }
    return { identity, targetPath: entry.overlayRelPath, content: null as string | null };
  });

  // Read the overlay content AFTER the paths are known — the content is read
  // from the server-computed path, never from a client-supplied one.
  for (const overlay of overlays) {
    overlay.content = await readTargetContent(projectRoot, overlay.targetPath);
  }

  const readonlyContexts = await collectReadonlyContexts(projectRoot, index, selected, dependencies);

  const exportId = newMaintenanceExportId(new Date((input.now ?? Date.now)()));
  const built = await buildMaintenancePackage({
    projectRoot,
    exportId,
    instanceId: input.instanceId,
    product: semanticProductIdentity(),
    scopeId: scope.scopeId,
    selected,
    dependencies,
    baselineDigest: scope.baseline.digest,
    overlays,
    readonlyContexts
  });

  // The export record is the ONLY authorization baseline the import will
  // accept (Spec §5). It is written BEFORE the package is handed out.
  const baseline = buildExportBaseline({
    metadata: built.metadata,
    packageDigest: built.packageDigest,
    actor: input.actor,
    ...(input.now ? { now: input.now } : {})
  });
  await persistMaintenanceExportBaseline(projectRoot, baseline);
  await pruneMaintenanceExportBaselines(projectRoot, input.now ?? Date.now).catch(() => undefined);

  // The export audit must be durable BEFORE the package is handed out.
  if (input.beforeDeliver) {
    await input.beforeDeliver({
      exportId,
      packageDigest: built.packageDigest,
      entryCount: built.metadata.entries.length,
      selectedCount: selected.length,
      dependencyCount: dependencies.length
    });
  }

  const dir = path.resolve(projectRoot, EXPORT_DIR_REL);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${exportId}.zip`), built.zip);

  return {
    packageKind: MAINTENANCE_PACKAGE_KIND,
    exportId,
    filename: `lucy-semantic-maintenance-${exportId}.zip`,
    sizeBytes: built.zip.length,
    sha256: built.packageDigest,
    downloadUrl: `/api/semantic-assets/exports/${exportId}/download`,
    scopeId: scope.scopeId,
    baselineDigest: scope.baseline.digest,
    expiresAt: baseline.expiresAt,
    selected,
    dependencies,
    includedFiles: built.metadata.entries.map((entry) => entry.packagePath),
    entryCount: built.metadata.entries.length
  };
}

/**
 * The read-only context of a package: the Schema Manifest of every schema that
 * carries a selected table or a dependency. The Manifest is a STRUCTURAL fact
 * source — it travels with the package as read-only context and must never be
 * written back (Spec §2).
 */
async function collectReadonlyContexts(
  projectRoot: string,
  index: SemanticModelIndex,
  selected: readonly SemanticTableIdentity[],
  dependencies: readonly SemanticTableIdentity[]
): Promise<Array<{ connectionId: string; schema: string; targetPath: string; content: string }>> {
  const seen = new Map<string, { connectionId: string; schema: string; targetPath: string }>();
  for (const identity of [...selected, ...dependencies]) {
    const entry = index.byKey.get(semanticIdentityKey(identity));
    if (!entry?.manifestRelPath) continue;
    const key = `${entry.identity.connectionId}/${entry.identity.schema}`;
    if (seen.has(key)) continue;
    seen.set(key, {
      connectionId: entry.identity.connectionId,
      schema: entry.identity.schema,
      targetPath: entry.manifestRelPath
    });
  }
  const contexts: Array<{ connectionId: string; schema: string; targetPath: string; content: string }> = [];
  for (const context of seen.values()) {
    const content = await readTargetContent(projectRoot, context.targetPath);
    if (content === null) {
      throw new SemanticBatchError(
        "MAINTENANCE_PACKAGE_INVALID",
        `Schema Manifest 缺失：${context.targetPath}。缺少结构事实源时无法生成维护包。`,
        { statusCode: 409 }
      );
    }
    contexts.push({ ...context, content });
  }
  return contexts;
}

// ─── Import → staging (Spec §9 stageImport) ────────────────────────────────

export interface SemanticStagedCandidate {
  /** Server-computed target path (project-root relative). */
  targetPath: string;
  /** The candidate overlay bytes. */
  content: string;
  /** Full table identity of the candidate. */
  identity: SemanticTableIdentity;
  /** True when the candidate is an untouched template (no overlay existed). */
  template: boolean;
  /** True when the target did not exist before this batch. */
  absentBefore: boolean;
}

export interface SemanticStagedImportResult {
  status: "staged" | "no_change";
  batchId: string;
  validationId: string;
  exportId: string;
  scopeId: string;
  candidateDigest: string;
  planDigest: string;
  /** The exact target set the plan covers, with the digest it was built against. */
  targetDigests: Array<{ path: string; digest: string | null }>;
  /** Paths that would be overwritten (the exact overwrite set). */
  overwriteSet: string[];
  candidates: SemanticStagedCandidate[];
  /** The selected identities — part of the plan digest. */
  refs: SemanticTableIdentity[];
  dependencies: SemanticTableIdentity[];
  /** Read-only entries that travelled with the package — never writable. */
  readonlyEntries: Array<{ packagePath: string; identity: SemanticTableIdentity }>;
  changedSources: Array<{ connectionId: string; sourceName: string }>;
  diff: string;
}

/**
 * Stage an uploaded maintenance package.
 *
 * The order matters and is normative (Spec §9 `stageImport`):
 *   envelope shape → safe unpack → server baseline → target resolution →
 *   identity binding → unchanged candidates discarded → plan digest.
 *
 * A failure at ANY step leaves zero staging and zero formal effects.
 */
export async function stageSemanticMaintenanceImport(
  projectRoot: string,
  input: { actor: string; instanceId: string; zip: Buffer; now?: () => number }
): Promise<SemanticStagedImportResult> {
  const instanceId = input.instanceId;
  assertZipSize(input.zip.length);

  let unpacked: UnpackedMaintenancePackage;
  try {
    unpacked = unpackMaintenancePackage(input.zip);
  } catch (error) {
    throw toSemanticBatchError(error);
  }

  const metadata: MaintenancePackageMetadata = unpacked.metadata;
  if (metadata.packageKind !== MAINTENANCE_PACKAGE_KIND) {
    throw new SemanticBatchError(
      "MAINTENANCE_PACKAGE_INVALID",
      `不是语义维护包（packageKind=${metadata.packageKind}）。`,
      { statusCode: 400 }
    );
  }

  // The server-side export record is the ONLY authorization baseline.
  await verifyMaintenanceExportBaseline(projectRoot, unpacked, {
    instanceId,
    ...(input.now ? { now: input.now } : {})
  }).catch((error: unknown) => {
    throw toSemanticBatchError(error);
  });

  // A read-only entry must still carry its exported bytes.
  const readonlyEntriesInPackage = unpacked.entries.filter(
    (entry) => entry.meta.role === "readonly_context"
  );
  for (const entry of readonlyEntriesInPackage) {
    const original = unpacked.metadata.entries.find((meta) => meta.entryId === entry.meta.entryId);
    if (!original) {
      throw new SemanticBatchError(
        "PACKAGE_BASELINE_MISMATCH",
        `包内条目 ${entry.meta.packagePath} 未登记在包元数据中，整包拒绝。`,
        { statusCode: 409 }
      );
    }
    const current = createHash("sha256").update(Buffer.from(entry.content, "utf8")).digest("hex");
    if (current !== original.exportedDigest) {
      throw new SemanticBatchError(
        "PACKAGE_BASELINE_MISMATCH",
        `只读条目 ${entry.meta.packagePath} 的内容被修改；Schema Manifest 是结构事实源，不可由维护包改写。`,
        { statusCode: 409 }
      );
    }
  }

  // The scope the package was exported from must still be fresh.
  if (!metadata.scopeId) {
    throw new SemanticBatchError(
      "PACKAGE_BASELINE_MISMATCH",
      "维护包缺少 scope 绑定，无法核验来源；请在目标实例重新导出。",
      { statusCode: 409 }
    );
  }
  const scope = await requireFreshSemanticScope(projectRoot, metadata.scopeId, {
    actor: input.actor,
    instanceId,
    ...(input.now ? { now: input.now } : {})
  }).catch((error: unknown) => {
    throw toSemanticBatchError(error);
  });

  const index = await buildSemanticModelIndex(projectRoot);
  const candidates = await resolveCandidates(projectRoot, index, unpacked);

  const targetDigests: Array<{ path: string; digest: string | null }> = [];
  for (const candidate of candidates) {
    const current = await readTargetContent(projectRoot, candidate.targetPath);
    targetDigests.push({
      path: candidate.targetPath,
      digest: current === null ? null : createHash("sha256").update(Buffer.from(current, "utf8")).digest("hex")
    });
  }

  const candidateDigest = computeCandidateDigest(candidates);
  const overwriteSet = targetDigests.filter((t) => t.digest !== null).map((t) => t.path).sort();
  const planDigest = computeSemanticPlanDigest(
    computeBatchPlanDigestInput({
      candidates: candidates.map((candidate) => ({
        targetPath: candidate.targetPath,
        content: candidate.content
      })),
      candidateDigest,
      scopeId: scope.scopeId,
      refs: scope.refs,
      dependencies: scope.dependencies,
      targetDigests,
      overwriteSet
    })
  );

  const batchId = `batch_${randomUUID()}`;
  const validationId = `val_${randomUUID()}`;

  const readonlyEntries = unpacked.entries
    .filter((entry) => entry.meta.role === "readonly_context")
    .map((entry) => ({ packagePath: entry.meta.packagePath, identity: entry.meta.identity }));

  const changedSources = candidates.map((candidate) => ({
    connectionId: candidate.identity.connectionId,
    sourceName: candidate.identity.table
  }));

  if (candidates.length === 0) {
    // "空 diff 显示「无变化」，不创建空发布或自动同步其他待处理变更。"
    return {
      status: "no_change",
      batchId,
      validationId,
      exportId: metadata.exportId,
      scopeId: scope.scopeId,
      candidateDigest,
      planDigest,
      targetDigests,
      overwriteSet,
      candidates: [],
      refs: scope.refs,
      dependencies: scope.dependencies,
      readonlyEntries,
      changedSources: [],
      diff: ""
    };
  }

  return {
    status: "staged",
    batchId,
    validationId,
    exportId: metadata.exportId,
    scopeId: scope.scopeId,
    candidateDigest,
    planDigest,
    targetDigests,
    overwriteSet,
    candidates,
    refs: scope.refs,
    dependencies: scope.dependencies,
    readonlyEntries,
    changedSources,
    diff: await buildCandidateDiff(projectRoot, candidates)
  };
}

function assertZipSize(byteLength: number): void {
  if (byteLength > SEMANTIC_BATCH_LIMITS.maxZipBytes) {
    throw new SemanticBatchError(
      "LIMIT_EXCEEDED",
      `语义维护包大小 ${byteLength} 字节超过 ${SEMANTIC_BATCH_LIMITS.maxZipBytes} 字节上限。`,
      { statusCode: 413 }
    );
  }
}

/**
 * Map the package entries onto server-computed targets.
 *
 * The target path is NEVER taken from the package: it is looked up from the
 * model index by the entry's identity. An entry whose identity is unknown, or
 * whose file carries several tables that were not all selected, is refused.
 */
async function resolveCandidates(
  projectRoot: string,
  index: SemanticModelIndex,
  unpacked: UnpackedMaintenancePackage
): Promise<SemanticStagedCandidate[]> {
  const selected = new Set(unpacked.metadata.selected.map(semanticIdentityKey));
  const candidates: SemanticStagedCandidate[] = [];
  let yamlEntryCount = 0;

  for (const entry of unpacked.entries) {
    if (entry.meta.role !== "editable_overlay") continue;
    yamlEntryCount += 1;

    const modelEntry = index.byKey.get(semanticIdentityKey(entry.meta.identity));
    if (!modelEntry) {
      throw new SemanticBatchError(
        "IDENTITY_NOT_FOUND",
        `包内条目 ${entry.meta.packagePath} 的表身份在当前模型中不存在，无法定位写入目标。`,
        { statusCode: 409 }
      );
    }

    // A physical overlay file can carry several tables. Writing it would change
    // every table it serves — so all of them must be selected (Spec §4.4).
    const servedIdentities = index.overlayOwners.get(modelEntry.overlayRelPath) ?? [];
    for (const served of servedIdentities) {
      if (!selected.has(served)) {
        throw new SemanticBatchError(
          "MAINTENANCE_PACKAGE_INVALID",
          `目标 ${modelEntry.overlayRelPath} 同时承载未选中的表 ${served}；请先补选后重新导出，禁止暗中扩大写入范围。`,
          { statusCode: 409 }
        );
      }
    }

    const current = await readTargetContent(projectRoot, modelEntry.overlayRelPath);
    const unchanged = current !== null && current === entry.content;
    if (unchanged) continue; // 无变化候选被丢弃

    candidates.push({
      targetPath: modelEntry.overlayRelPath,
      content: entry.content,
      identity: entry.meta.identity,
      template: entry.meta.template === true,
      absentBefore: current === null
    });
  }

  assertYamlEntryLimit(yamlEntryCount);
  return candidates;
}

function computeCandidateDigest(candidates: readonly SemanticStagedCandidate[]): string {
  const hash = createHash("sha256");
  for (const candidate of [...candidates].sort((a, b) => a.targetPath.localeCompare(b.targetPath))) {
    hash.update(candidate.targetPath);
    hash.update("\0");
    hash.update(createHash("sha256").update(Buffer.from(candidate.content, "utf8")).digest("hex"));
    hash.update("\n");
  }
  return hash.digest("hex");
}

/**
 * The canonical plan-digest input.
 *
 * STAGING and PUBLISH both build the digest through this function, so the
 * confirmation the operator saw is the digest the commit re-derives. The
 * candidate array is sorted by target path because the canonical JSON keeps
 * array order (config-digest.ts `stableJson`).
 */
export function computeBatchPlanDigestInput(input: {
  candidates: ReadonlyArray<{ targetPath: string; content: string }>;
  candidateDigest: string;
  scopeId: string;
  refs: readonly SemanticTableIdentity[];
  dependencies: readonly SemanticTableIdentity[];
  targetDigests: ReadonlyArray<{ path: string; digest: string | null }>;
  overwriteSet: readonly string[];
}): {
  candidate: unknown;
  targets: Array<{ path: string; digest: string | null }>;
  extra: Record<string, unknown>;
} {
  return {
    candidate: {
      candidates: [...input.candidates]
        .sort((a, b) => a.targetPath.localeCompare(b.targetPath))
        .map((candidate) => ({
          targetPath: candidate.targetPath,
          contentDigest: createHash("sha256")
            .update(Buffer.from(candidate.content, "utf8"))
            .digest("hex")
        })),
      candidateDigest: input.candidateDigest,
      scopeId: input.scopeId
    },
    targets: [...input.targetDigests]
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((target) => ({ path: target.path, digest: target.digest })),
    extra: {
      refs: input.refs.map(semanticIdentityKey).sort(),
      dependencies: input.dependencies.map(semanticIdentityKey).sort(),
      overwriteSet: [...input.overwriteSet].sort()
    }
  };
}

async function buildCandidateDiff(
  projectRoot: string,
  candidates: readonly SemanticStagedCandidate[]
): Promise<string> {
  const parts: string[] = [];
  for (const candidate of candidates) {
    const current = await readTargetContent(projectRoot, candidate.targetPath);
    parts.push(
      [
        `--- a/${candidate.targetPath}`,
        `+++ b/${candidate.targetPath}`,
        `@@ 候选覆盖层 @@`,
        ...(current === null ? ["+ (新文件)"] : current.split("\n").map((line) => `- ${line}`)),
        ...candidate.content.split("\n").map((line) => `+ ${line}`)
      ].join("\n")
    );
  }
  return parts.join("\n");
}

// ─── Plan (Spec §9 prepareWorkbench) ───────────────────────────────────────

export interface SemanticBatchPlanEntry {
  targetPath: string;
  identity: SemanticTableIdentity | null;
  /** "candidate" = this batch's staged change; "disk" = an unrelated pending disk change. */
  origin: "candidate" | "disk";
  /** The digest the plan was built against (null = the target must not exist). */
  expectedDigest: string | null;
  /** True when the plan will overwrite an existing file. */
  overwrite: boolean;
}

export interface SemanticBatchPlan {
  planDigest: string;
  candidateDigest: string;
  scopeId: string;
  batchId: string;
  validationId: string;
  /** Every candidate target. */
  candidates: SemanticBatchPlanEntry[];
  /** Existing pending disk changes that are NOT part of this batch. */
  unrelatedDiskChanges: SemanticBatchPlanEntry[];
  /** The exact overwrite set. */
  overwriteSet: string[];
  dependencies: SemanticTableIdentity[];
  /** Everything the batch would write — candidates plus unrelated disk changes. */
  effectiveTargets: string[];
}

/**
 * Build the COMPLETE plan: this batch's staged candidates PLUS the pending
 * disk changes that already exist.
 *
 * Spec §3.2 / §7.2: the plan covers both, the index is batch-wide, and the
 * confirmation is bound to this plan's digest. The client may not pretend that
 * a Catalog selection is a partial activation.
 */
export function buildSemanticBatchPlan(input: {
  planDigest: string;
  candidateDigest: string;
  scopeId: string;
  batchId: string;
  validationId: string;
  candidates: readonly SemanticStagedCandidate[];
  targetDigests: ReadonlyArray<{ path: string; digest: string | null }>;
  dependencies: readonly SemanticTableIdentity[];
  unrelatedDiskChanges: readonly { targetPath: string; digest: string | null }[];
}): SemanticBatchPlan {
  const candidateEntries: SemanticBatchPlanEntry[] = input.candidates.map((candidate) => ({
    targetPath: candidate.targetPath,
    identity: candidate.identity,
    origin: "candidate" as const,
    expectedDigest:
      input.targetDigests.find((target) => target.path === candidate.targetPath)?.digest ?? null,
    overwrite:
      (input.targetDigests.find((target) => target.path === candidate.targetPath)?.digest ?? null) !== null
  }));
  const unrelatedEntries: SemanticBatchPlanEntry[] = input.unrelatedDiskChanges.map((change) => ({
    targetPath: change.targetPath,
    identity: null,
    origin: "disk" as const,
    expectedDigest: change.digest,
    overwrite: change.digest !== null
  }));

  const overwriteSet = [...candidateEntries, ...unrelatedEntries]
    .filter((entry) => entry.overwrite)
    .map((entry) => entry.targetPath)
    .sort();

  return {
    planDigest: input.planDigest,
    candidateDigest: input.candidateDigest,
    scopeId: input.scopeId,
    batchId: input.batchId,
    validationId: input.validationId,
    candidates: candidateEntries,
    unrelatedDiskChanges: unrelatedEntries,
    overwriteSet,
    dependencies: sortUniqueSemanticIdentities(input.dependencies),
    effectiveTargets: [...candidateEntries, ...unrelatedEntries].map((entry) => entry.targetPath).sort()
  };
}
