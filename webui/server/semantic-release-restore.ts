/**
 * Lucy v0.25 / L25-15 — restore a semantic batch to the bytes captured
 * before that batch was written.
 *
 * Preview does not write formal content. Submit holds `semantic_restore`
 * until the attempt reaches a terminal release state. There is no upload path.
 *
 * Two write sets are kept apart for the whole flow (Spec v0.11 §2.3):
 *
 *   - the **restore write set** — the snapshot targets this restore writes,
 *     together with the matching controlled ktx sibling targets. This is what
 *     the journal, the CAS and the rollback act on.
 *   - the **mirror sync write set** — pre-existing drift between the content
 *     root and the ktx sibling view. The general mirror upsert copies it, so
 *     the preview has to disclose it and the submit has to prove that the
 *     drift did not change. It never enters the journal: its direction is
 *     "sibling view aligns to the content root", and rolling that back would
 *     re-introduce stale semantics.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { buildStoredZip } from "./proxy/zip-store.js";
import {
  acquirePublishCoordinatorLock,
  releasePublishCoordinatorLock,
  type PublishLockHolder
} from "./publish-coordinator.js";
import { SEMANTIC_BATCH_LIMITS } from "./semantic-limits.js";
import {
  acquireSnapshotLease,
  readOrCreateSemanticInstanceId,
  readSemanticReleaseSnapshot,
  releaseSnapshotLease,
  type SemanticReleaseSnapshot
} from "./semantic-release-snapshots.js";
import {
  assertNoUnsettledContentRelease,
  openPromotingContentRelease,
  readAllSemanticAssetReleaseRecords,
  readSemanticAssetRelease,
  semanticTerminalAuditKey,
  updateReleaseRecord,
  type SemanticAssetReleaseRecord
} from "./semantic-assets.js";
import {
  atomicReplaceTarget,
  completeRecoveryJournal,
  contentRootAndSiblingAreSameDir,
  createRecoveryJournal,
  listOpenRecoveryJournals,
  markRecoveryEntryApplied,
  markRecoveryJournalFilesSaved,
  readRecoveryJournal,
  restoreRecoveryJournal,
  type RecoveryJournal
} from "./semantic-recovery-journal.js";
import {
  readSemanticIdempotencyKey,
  registerSemanticIdempotencyKey,
  settleSemanticIdempotencyPhase,
  SemanticIdempotencyConflictError,
  SemanticIdempotencyCapacityError
} from "./semantic-idempotency.js";
import {
  deleteMirrorTargetAndVerify,
  enumerateMirrorDrift,
  readMirrorDigest,
  upsertVerifiedMirrorFiles,
  type MirrorDriftEntry
} from "./content-mirror.js";
import {
  deriveSemanticDeletionSet,
  mergedTableKey,
  mergedTableLabel,
  type MergedTableId
} from "./semantic-merged-model.js";
import { recordConfigChange } from "./admin/audit.js";
import { resolveContentPaths } from "./paths.js";

const PREVIEWS_REL = ".ktx-ui/semantic-restore-previews";

export class SemanticRestoreError extends Error {
  readonly statusCode: number;

  constructor(
    readonly code: string,
    message: string,
    statusCode = 409
  ) {
    super(message);
    this.name = "SemanticRestoreError";
    this.statusCode = statusCode;
  }
}

export type RestoreStartupClass = "A" | "B" | "C" | "D" | "E" | "F";

export type RestoreTargetAction = "restore_bytes" | "delete" | "unchanged";

export type RestoreTargetPlan = {
  targetPath: string;
  assetKind: "overlay" | "manifest";
  identity?: { connectionId: string; schema: string; table: string };
  action: RestoreTargetAction;
  /** Digest of the target on disk right now, or null when it is absent. */
  currentDigest: string | null;
  /** Digest the source batch left behind. The CAS compares against this. */
  expectedCurrentDigest: string | null;
  /** Digest after the restore, or null when the restore deletes the target. */
  restoredDigest: string | null;
  /** Digest of the matching ktx sibling target, or null when it is absent. */
  siblingCurrentDigest: string | null;
};

/**
 * What the delete-direction readback has to prove.
 *
 * `table_gone` — the table left the merged model entirely. It must not be
 * retrievable or readable.
 * `extension_invisible` — only the overlay was deleted. The table structure
 * comes from the Manifest and stays visible; the business extension does not.
 */
export type RestoreReadbackExpectation = {
  kind: "table_gone" | "extension_invisible";
  table: MergedTableId;
  targetPath?: string;
};

export type RestorePreview = {
  previewId: string;
  sourceReleaseId: string;
  snapshotId: string;
  planDigest: string;
  expiresAt: string;
  instanceId: string;
  verdict: "ready" | "conflict" | "unavailable";
  conflicts: string[];
  targets: RestoreTargetPlan[];
  reindexMode: "incremental" | "force";
  /** Tables the restore removes from the merged model. */
  semanticDeletionSet: MergedTableId[];
  /** The delete-direction expectations the readback has to verify. */
  readbackExpectations: RestoreReadbackExpectation[];
  /** Files the next full mirror upsert would copy. Not written by this restore. */
  mirrorSyncWriteSet: MirrorDriftEntry[];
  /** The files ktx will actually scan after the restore. */
  fullIndexScope: string[];
  /** Files inside the scope whose content and sibling view differ. */
  knownPending: string[];
  /**
   * Share of the index scope whose difference against the last successful
   * index cannot be decided. Lucy keeps no index digest ledger, so this is
   * honestly large unless the scope is fully covered.
   */
  unknownCoverage: number;
  /** True when every snapshot target is already at its pre-batch state. */
  noChange: boolean;
};

type StoredPreview = RestorePreview & { actor: string };

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function previewPath(projectRoot: string, previewId: string): string {
  if (!/^prv_[0-9a-f-]+$/i.test(previewId)) {
    throw new SemanticRestoreError("semantic_restore_plan_stale", "预检标识无效。", 400);
  }
  return path.resolve(projectRoot, PREVIEWS_REL, `${previewId}.json`);
}

async function readCurrentDigest(projectRoot: string, targetPath: string): Promise<string | null> {
  const contentPaths = await resolveContentPaths(projectRoot);
  const abs = path.resolve(contentPaths.configDir, targetPath);
  try {
    return sha256(await readFile(abs));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Terminal-audit identity: `releaseId + attemptId + "terminal"` (Spec §8.1). */
export function terminalAuditKey(releaseId: string, attemptId: string): string {
  return semanticTerminalAuditKey(releaseId, attemptId);
}

async function listYamlFilesRecursive(dir: string, prefix: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await listYamlFilesRecursive(abs, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    out.push(rel);
  }
}

/**
 * The files `ktx admin reindex` actually scans: the semantic layer of the
 * project-root sibling view. This is not the content root's file set — ktx
 * reads the sibling view (Spec §2.3).
 */
export async function enumerateKtxScanScope(projectRoot: string): Promise<string[]> {
  return enumerateSemanticLayerScope(path.join(projectRoot, "semantic-layer"));
}

/** The semantic layer of one root, as project-relative paths. */
async function enumerateSemanticLayerScope(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  await listYamlFilesRecursive(rootDir, "semantic-layer", files);
  return files.sort();
}

/**
 * The full index scope: the sibling view ktx scans, plus the content root's
 * semantic layer, plus the restore plan's targets.
 *
 * The preview and the index retry must compute this the same way, otherwise
 * a scope confirmation would never match the plan it confirms.
 */
async function enumerateFullIndexScope(
  projectRoot: string,
  contentPaths: { configDir: string },
  planTargets: Array<{ targetPath: string; action: RestoreTargetAction }>
): Promise<string[]> {
  const siblingScope = await enumerateKtxScanScope(projectRoot);
  const contentRootScope = await enumerateSemanticLayerScope(
    path.join(contentPaths.configDir, "semantic-layer")
  );
  const scope = new Set<string>([...siblingScope, ...contentRootScope]);
  for (const target of planTargets) {
    if (target.action === "delete") scope.delete(target.targetPath);
    else scope.add(target.targetPath);
  }
  return [...scope].sort();
}

export type RestorePlan = {
  snapshot: SemanticReleaseSnapshot;
  targets: RestoreTargetPlan[];
  changedTargets: RestoreTargetPlan[];
  conflicts: string[];
  noChange: boolean;
  reindexMode: "incremental" | "force";
  semanticDeletionSet: MergedTableId[];
  readbackExpectations: RestoreReadbackExpectation[];
  mirrorSyncWriteSet: MirrorDriftEntry[];
  fullIndexScope: string[];
  knownPending: string[];
  unknownCoverage: number;
  planDigest: string;
};

function planDigestFor(plan: {
  snapshot: SemanticReleaseSnapshot;
  targets: RestoreTargetPlan[];
  reindexMode: "incremental" | "force";
  semanticDeletionSet: MergedTableId[];
  readbackExpectations: RestoreReadbackExpectation[];
  mirrorSyncWriteSet: MirrorDriftEntry[];
  fullIndexScope: string[];
}): string {
  return sha256(
    JSON.stringify({
      snapshotId: plan.snapshot.snapshotId,
      snapshotDigest: plan.snapshot.snapshotDigest,
      targets: plan.targets.map((target) => ({
        targetPath: target.targetPath,
        action: target.action,
        currentDigest: target.currentDigest,
        expectedCurrentDigest: target.expectedCurrentDigest,
        restoredDigest: target.restoredDigest,
        siblingCurrentDigest: target.siblingCurrentDigest
      })),
      reindexMode: plan.reindexMode,
      semanticDeletionSet: plan.semanticDeletionSet.map(mergedTableKey),
      readbackExpectations: plan.readbackExpectations.map((item) => ({
        kind: item.kind,
        table: mergedTableKey(item.table),
        targetPath: item.targetPath ?? null
      })),
      mirrorSyncWriteSet: plan.mirrorSyncWriteSet.map((item) => ({
        contentRelPath: item.contentRelPath,
        contentDigest: item.contentDigest,
        siblingDigest: item.siblingDigest
      })),
      fullIndexScope: plan.fullIndexScope
    })
  );
}

/**
 * Rebuild the restore plan from the snapshot and the current disk state.
 *
 * Pure read: it writes no preview, no snapshot and no index. Both the preview
 * and the submit call it, so the submit can prove that the plan it executes
 * is the plan the operator confirmed.
 */
export async function buildRestorePlan(
  projectRoot: string,
  sourceReleaseId: string
): Promise<RestorePlan> {
  const release = await readSemanticAssetRelease(projectRoot, sourceReleaseId);
  if (!release) {
    throw new SemanticRestoreError("semantic_release_not_restorable", "发布记录不存在。", 404);
  }
  if (release.trigger === "webui_manual_reindex" || !release.snapshotId) {
    throw new SemanticRestoreError(
      "semantic_release_not_restorable",
      release.trigger === "webui_manual_reindex"
        ? "强制重建索引没有内容写入，不能整批恢复。"
        : "这条发布记录没有批次前快照，不能整批恢复。"
    );
  }
  if (release.status !== "published" && release.status !== "reindex_failed") {
    throw new SemanticRestoreError(
      "semantic_release_not_restorable",
      "只有已发布或索引失败的内容批次可以预检恢复。"
    );
  }
  const snapshot = await readSemanticReleaseSnapshot(projectRoot, sourceReleaseId);
  if (!snapshot || snapshot.snapshotId !== release.snapshotId) {
    throw new SemanticRestoreError("semantic_snapshot_unavailable", "批次前快照不可用。");
  }
  const instanceId = await readOrCreateSemanticInstanceId(projectRoot);
  if (snapshot.instanceId !== instanceId) {
    throw new SemanticRestoreError("semantic_restore_instance_mismatch", "批次前快照不属于当前实例。");
  }

  const contentPaths = await resolveContentPaths(projectRoot);
  const sameSurface = await contentRootAndSiblingAreSameDir(projectRoot);

  const targets: RestoreTargetPlan[] = [];
  const conflicts: string[] = [];
  for (const entry of snapshot.entries) {
    const currentDigest = await readCurrentDigest(projectRoot, entry.targetPath);
    if (currentDigest !== entry.expectedNewDigest) {
      conflicts.push(entry.targetPath);
    }
    const unchanged = entry.originalDigest === entry.expectedNewDigest;
    const action: RestoreTargetAction = unchanged
      ? "unchanged"
      : entry.originalBase64 === null
        ? "delete"
        : "restore_bytes";
    const siblingCurrentDigest = sameSurface
      ? currentDigest
      : await readMirrorDigest(projectRoot, contentPaths, entry.targetPath);
    targets.push({
      targetPath: entry.targetPath,
      assetKind: entry.assetKind,
      ...(entry.identity ? { identity: entry.identity } : {}),
      action,
      currentDigest,
      expectedCurrentDigest: entry.expectedNewDigest,
      restoredDigest: entry.originalDigest,
      siblingCurrentDigest
    });
  }

  const changedTargets = targets.filter((target) => target.action !== "unchanged");

  // §5.5 — the semantic deletion set comes from the merged-model difference,
  // not from "how many targets become absent". A Manifest that is rewritten
  // in place and drops a table is a semantic deletion while the file itself
  // is still a `restore` target.
  const restoredManifestContents = new Map<string, string | null>();
  const deletedOverlayPaths: string[] = [];
  const restoredOverlayPaths: string[] = [];
  for (const entry of snapshot.entries) {
    const changed = entry.originalDigest !== entry.expectedNewDigest;
    if (!changed) continue;
    if (entry.assetKind === "manifest") {
      restoredManifestContents.set(
        entry.targetPath,
        entry.originalBase64 === null
          ? null
          : Buffer.from(entry.originalBase64, "base64").toString("utf8")
      );
    } else if (entry.originalBase64 === null) {
      deletedOverlayPaths.push(entry.targetPath);
    } else {
      restoredOverlayPaths.push(entry.targetPath);
    }
  }
  const deletion = await deriveSemanticDeletionSet({
    projectRoot,
    restoredManifestContents,
    deletedOverlayPaths,
    restoredOverlayPaths
  });
  const semanticDeletionSet = deletion.semanticDeletionSet;
  const reindexMode: "incremental" | "force" =
    semanticDeletionSet.length > 0 ? "force" : "incremental";

  const readbackExpectations: RestoreReadbackExpectation[] = [
    ...semanticDeletionSet.map((table) => ({ kind: "table_gone" as const, table })),
    ...deletion.overlayDeletionReadbacks.flatMap((item) =>
      item.tables.map((table) => ({
        kind: "extension_invisible" as const,
        table,
        targetPath: item.targetPath
      }))
    )
  ];

  // §2.3 — the mirror sync write set is the pre-existing drift the general
  // upsert would copy. The restore write set is excluded: those files are
  // the restore's own controlled mirror targets.
  const exclude = new Set(changedTargets.map((target) => target.targetPath));
  const mirrorSyncWriteSet = await enumerateMirrorDrift(projectRoot, contentPaths, { exclude });

  // §2.3 — the full index scope is the sibling view after the restore, so it
  // is the current scan set plus the content root's semantic layer plus the
  // restore plan, minus the targets the restore deletes.
  const fullIndexScope = await enumerateFullIndexScope(projectRoot, contentPaths, changedTargets);

  const knownPending = mirrorSyncWriteSet
    .filter((item) => fullIndexScope.includes(item.siblingRelPath))
    .map((item) => item.siblingRelPath);
  const unknownCoverage =
    fullIndexScope.length === 0
      ? 0
      : Math.max(0, (fullIndexScope.length - knownPending.length) / fullIndexScope.length);

  const plan = {
    snapshot,
    targets,
    changedTargets,
    conflicts,
    noChange: changedTargets.length === 0,
    reindexMode,
    semanticDeletionSet,
    readbackExpectations,
    mirrorSyncWriteSet,
    fullIndexScope,
    knownPending,
    unknownCoverage
  };
  return { ...plan, planDigest: planDigestFor(plan) };
}

export async function previewSemanticRestore(
  projectRoot: string,
  sourceReleaseId: string,
  actor: string
): Promise<RestorePreview> {
  const plan = await buildRestorePlan(projectRoot, sourceReleaseId);
  const instanceId = await readOrCreateSemanticInstanceId(projectRoot);
  const now = Date.now();
  const preview: StoredPreview = {
    previewId: `prv_${randomUUID()}`,
    sourceReleaseId,
    snapshotId: plan.snapshot.snapshotId,
    planDigest: plan.planDigest,
    expiresAt: new Date(now + SEMANTIC_BATCH_LIMITS.restorePreviewTtlMs).toISOString(),
    instanceId,
    verdict: plan.conflicts.length > 0 ? "conflict" : "ready",
    conflicts: plan.conflicts,
    targets: plan.targets,
    reindexMode: plan.reindexMode,
    semanticDeletionSet: plan.semanticDeletionSet,
    readbackExpectations: plan.readbackExpectations,
    mirrorSyncWriteSet: plan.mirrorSyncWriteSet,
    fullIndexScope: plan.fullIndexScope,
    knownPending: plan.knownPending,
    unknownCoverage: plan.unknownCoverage,
    noChange: plan.noChange,
    actor
  };
  const dir = path.resolve(projectRoot, PREVIEWS_REL);
  await mkdir(dir, { recursive: true });
  const finalPath = previewPath(projectRoot, preview.previewId);
  const temp = path.join(dir, `.preview.tmp-${randomUUID()}`);
  await writeFile(temp, `${JSON.stringify(preview, null, 2)}\n`, "utf8");
  await rename(temp, finalPath);
  await acquireSnapshotLease(projectRoot, {
    snapshotId: plan.snapshot.snapshotId,
    kind: "preview",
    ttlMs: SEMANTIC_BATCH_LIMITS.restorePreviewTtlMs
  });
  return preview;
}

async function readPreview(projectRoot: string, previewId: string): Promise<StoredPreview> {
  try {
    return JSON.parse(await readFile(previewPath(projectRoot, previewId), "utf8")) as StoredPreview;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new SemanticRestoreError("semantic_restore_preview_expired", "恢复预检不存在或已过期。", 410);
    }
    throw error;
  }
}

export type SubmitRestoreInput = {
  sourceReleaseId: string;
  previewId: string;
  planDigest: string;
  idempotencyKey: string;
  actor: string;
  reindex?: (projectRoot: string, mode: "incremental" | "force") => Promise<{ ok: boolean; exitCode: number }>;
  syncMirror?: (projectRoot: string) => Promise<void>;
  /** Terminal audit. Tests can substitute a no-op. Failure leaves the batch unconfirmed. */
  writeTerminalAudit?: (releaseId: string) => Promise<void>;
  /** Delete-direction readback. Tests can substitute a no-op. */
  readback?: (releaseId: string) => Promise<{ ok: boolean }>;
};

/**
 * Read-only idempotency lookup. Runs **before** the publish window is taken:
 * the restore lock covers the background reindex until the terminal state, so
 * an in-lock lookup would hit `semantic_publish_busy` instead of returning the
 * real in-progress batch (Spec §5.3).
 */
async function readReplayState(
  projectRoot: string,
  instanceId: string,
  actor: string,
  idempotencyKey: string
): Promise<{ state: "applied" | "intent" | "failed" | "none"; releaseId: string; planDigest: string }> {
  const record = await readSemanticIdempotencyKey(projectRoot, {
    instanceId,
    actor,
    clientKey: idempotencyKey
  });
  if (!record) return { state: "none", releaseId: "", planDigest: "" };
  return {
    state: record.phase ?? "applied",
    releaseId: record.releaseId,
    planDigest: record.planDigest
  };
}

export async function submitSemanticRestore(
  projectRoot: string,
  input: SubmitRestoreInput
): Promise<{ accepted: boolean; release: SemanticAssetReleaseRecord }> {
  if (!input.idempotencyKey.trim()) {
    throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "恢复提交必须携带幂等键。", 400);
  }
  const stored = await readPreview(projectRoot, input.previewId);
  if (stored.actor !== input.actor || stored.sourceReleaseId !== input.sourceReleaseId) {
    throw new SemanticRestoreError("semantic_restore_plan_stale", "恢复预检与当前提交不一致。");
  }
  if (Date.parse(stored.expiresAt) <= Date.now()) {
    throw new SemanticRestoreError("semantic_restore_preview_expired", "恢复预检已超过 30 分钟，请重新预检。", 410);
  }
  if (stored.planDigest !== input.planDigest) {
    throw new SemanticRestoreError("semantic_restore_plan_stale", "确认的计划摘要与预检不一致。");
  }
  if (stored.verdict !== "ready") {
    throw new SemanticRestoreError("semantic_restore_conflict", "当前内容与所选批次发布后的状态不一致。");
  }

  const instanceId = await readOrCreateSemanticInstanceId(projectRoot);

  // ── Lock-free, strictly read-only replay lookup (Spec §5.3) ────────────
  const replay = await readReplayState(projectRoot, instanceId, input.actor, input.idempotencyKey);
  if (replay.state !== "none") {
    if (replay.planDigest !== input.planDigest) {
      throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "同一幂等键已绑定另一个恢复计划。");
    }
    if (replay.state === "applied") {
      const existing = await readSemanticAssetRelease(projectRoot, replay.releaseId);
      if (!existing) {
        throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "幂等记录指向的批次已不存在。");
      }
      return { accepted: true, release: existing };
    }
    if (replay.state === "intent") {
      // Read-only: report the real in-progress batch. Any settlement belongs
      // inside the lock, where the coordinator actually serialises writers.
      const running = await readSemanticAssetRelease(projectRoot, replay.releaseId);
      if (running && (running.status === "promoting" || running.status === "reindexing")) {
        return { accepted: true, release: running };
      }
    }
  }

  const acquired = await acquirePublishCoordinatorLock(projectRoot, "semantic_restore", {
    releaseId: "pending"
  });
  if (!acquired.acquired) {
    throw new SemanticRestoreError("semantic_publish_busy", "发布窗口被占用，整批恢复没有开始。");
  }
  const holder: PublishLockHolder = acquired.holder;
  let releaseId: string | null = null;
  let settled = false;
  /** True once the formal writes and the mirror verification are done. */
  let formalWritesLanded = false;
  try {
    await assertNoUnsettledContentRelease(projectRoot);

    // ── Inside the lock: redo the full three-state evaluation (Spec §5.3) ──
    const replay2 = await readReplayState(projectRoot, instanceId, input.actor, input.idempotencyKey);
    if (replay2.state !== "none") {
      if (replay2.planDigest !== input.planDigest) {
        throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "同一幂等键已绑定另一个恢复计划。");
      }
      if (replay2.state === "applied") {
        const existing = await readSemanticAssetRelease(projectRoot, replay2.releaseId);
        if (!existing) {
          throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "幂等记录指向的批次已不存在。");
        }
        return { accepted: true, release: existing };
      }
      if (replay2.state === "intent") {
        const running = await readSemanticAssetRelease(projectRoot, replay2.releaseId);
        if (running && (running.status === "promoting" || running.status === "reindexing")) {
          return { accepted: true, release: running };
        }
        // The intent is no longer running. Zero formal writes are only proven
        // when the release settled as promote_failed **and** its rollback was
        // proven — `recoveryRequired` is that proof.
        if (!running || running.status !== "promote_failed" || running.recoveryRequired === true) {
          throw new SemanticRestoreError(
            "semantic_recovery_required",
            "同一幂等键的上一笔恢复结果未知，需要人工核对后才能重试。"
          );
        }
        await settleSemanticIdempotencyPhase(projectRoot, {
          instanceId,
          actor: input.actor,
          clientKey: input.idempotencyKey,
          phase: "failed"
        });
      }
      if (replay2.state === "failed") {
        // §5.3 — only a proven zero-write failure may open a new attempt.
        // `recoveryRequired` is the record of that proof: it is set when the
        // rollback could not be proven.
        const previous = await readSemanticAssetRelease(projectRoot, replay2.releaseId);
        if (!previous || previous.recoveryRequired === true) {
          throw new SemanticRestoreError(
            "semantic_recovery_required",
            "同一幂等键的上一笔恢复结果未知，需要人工核对后才能重试。"
          );
        }
      }
    }

    // ── Rebuild the plan and prove it is the plan the operator confirmed ──
    const rebuilt = await buildRestorePlan(projectRoot, input.sourceReleaseId);
    if (rebuilt.planDigest !== input.planDigest) {
      throw new SemanticRestoreError(
        "semantic_restore_plan_stale",
        "提交时基线已变化，请重新预检。"
      );
    }
    if (rebuilt.conflicts.length > 0) {
      throw new SemanticRestoreError("semantic_restore_conflict", "提交时基线已变化，请重新预检。");
    }
    if (rebuilt.noChange) {
      // §5.1 — every target is already at its pre-batch state. No release, no
      // idempotency record, no index call.
      throw new SemanticRestoreError(
        "semantic_restore_conflict",
        "所选批次的发布前内容已经就位，没有需要恢复的差异。"
      );
    }
    const contentPaths = await resolveContentPaths(projectRoot);
    const sameSurface = await contentRootAndSiblingAreSameDir(projectRoot);

    // ── Double-sided CAS: the ktx sibling baseline must match the content root ──
    for (const target of rebuilt.changedTargets) {
      const sibling = sameSurface
        ? target.currentDigest
        : await readMirrorDigest(projectRoot, contentPaths, target.targetPath);
      if (sibling !== target.expectedCurrentDigest) {
        throw new SemanticRestoreError(
          "semantic_restore_conflict",
          `目标 ${target.targetPath} 的 ktx 视图与内容根不一致，整批恢复已阻断。`
        );
      }
    }

    const snapshot = rebuilt.snapshot;
    const attemptId = `att_${randomUUID()}`;
    const opened = await openPromotingContentRelease({
      projectRoot,
      actor: input.actor,
      trigger: "webui_restore",
      restoreOfReleaseId: input.sourceReleaseId,
      restoreSourceSnapshotId: snapshot.snapshotId,
      restorePlanDigest: input.planDigest,
      idempotencyKey: input.idempotencyKey,
      targets: snapshot.entries.map((entry) => ({
        targetPath: entry.targetPath,
        assetKind: entry.assetKind,
        identity: entry.identity,
        expectedNewDigest: entry.originalDigest
      }))
    });
    releaseId = opened.releaseId;
    try {
      const outcome = await registerSemanticIdempotencyKey(projectRoot, {
        instanceId,
        actor: input.actor,
        clientKey: input.idempotencyKey,
        planDigest: input.planDigest,
        releaseId: opened.releaseId,
        phase: "intent"
      });
      if (outcome.kind === "replay") {
        const existing = await readSemanticAssetRelease(projectRoot, outcome.record.releaseId);
        if (existing && existing.id !== opened.releaseId) {
          await updateReleaseRecord(projectRoot, opened.releaseId, {
            status: "promote_failed",
            activationStatus: "unconfirmed"
          });
          settled = true;
          return { accepted: true, release: existing };
        }
      }
    } catch (error) {
      if (error instanceof SemanticIdempotencyConflictError) {
        throw new SemanticRestoreError("semantic_restore_idempotency_conflict", error.message);
      }
      if (error instanceof SemanticIdempotencyCapacityError) {
        throw new SemanticRestoreError("semantic_idempotency_capacity", error.message);
      }
      throw error;
    }
    await updateReleaseRecord(projectRoot, opened.releaseId, {
      reindexMode: rebuilt.reindexMode,
      idempotencyKey: input.idempotencyKey,
      attemptId
    });

    // The journal registers the restore write set only: the content-root
    // target and its controlled ktx sibling. The mirror sync write set never
    // enters it (Spec §2.3).
    const journalTargets: Array<{
      targetPath: string;
      identity?: { connectionId: string; schema: string; table: string };
      surface: "content_root" | "ktx_sibling";
      newContent: string | null;
    }> = [];
    /** Journal order of each changed target's content-root entry. */
    const journalOrderOf = new Map<string, number>();
    for (const target of rebuilt.changedTargets) {
      const entry = snapshot.entries.find((item) => item.targetPath === target.targetPath)!;
      const newContent =
        entry.originalBase64 === null
          ? null
          : Buffer.from(entry.originalBase64, "base64").toString("utf8");
      journalOrderOf.set(target.targetPath, journalTargets.length);
      journalTargets.push({
        targetPath: target.targetPath,
        identity: entry.identity,
        surface: "content_root",
        newContent
      });
      if (!sameSurface) {
        journalTargets.push({
          targetPath: target.targetPath,
          identity: entry.identity,
          surface: "ktx_sibling",
          newContent
        });
      }
    }
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: opened.releaseId,
      operationId: opened.releaseId,
      actor: input.actor,
      instanceId,
      targets: journalTargets
    });
    await updateReleaseRecord(projectRoot, opened.releaseId, { recoveryJournalId: journal.journalId });

    try {
      for (const target of rebuilt.changedTargets) {
        const entry = snapshot.entries.find((item) => item.targetPath === target.targetPath)!;
        // Re-check the baseline immediately before each write.
        const currentDigest = await readCurrentDigest(projectRoot, target.targetPath);
        if (currentDigest !== target.expectedCurrentDigest) {
          throw new SemanticRestoreError(
            "semantic_restore_conflict",
            `目标 ${target.targetPath} 在写入前发生变化，整批恢复已停止。`
          );
        }
        if (target.action === "delete") {
          const abs = path.resolve(contentPaths.configDir, target.targetPath);
          await rm(abs, { force: true });
          if (!sameSurface) {
            await deleteMirrorTargetAndVerify(projectRoot, contentPaths, target.targetPath);
          }
        } else {
          const content = Buffer.from(entry.originalBase64!, "base64").toString("utf8");
          await atomicReplaceTarget(projectRoot, target.targetPath, content, "content_root");
          if (!sameSurface) {
            const upserted = await upsertVerifiedMirrorFiles(projectRoot, contentPaths, [
              target.targetPath
            ]);
            if (upserted.failed > 0) {
              throw new SemanticRestoreError(
                "semantic_snapshot_unavailable",
                `目标 ${target.targetPath} 的 ktx 视图未能同步，恢复保持阻断。`
              );
            }
            const readBack = await readMirrorDigest(projectRoot, contentPaths, target.targetPath);
            if (readBack !== target.restoredDigest) {
              throw new SemanticRestoreError(
                "semantic_snapshot_unavailable",
                `目标 ${target.targetPath} 的 ktx 视图回读摘要不一致，恢复保持阻断。`
              );
            }
          }
        }
        await markRecoveryEntryApplied(
          projectRoot,
          journal.journalId,
          journalOrderOf.get(target.targetPath) ?? entry.order
        );
      }

      // §5.2 step 8 — verify the drift set BEFORE the full upsert. Drift that
      // the preview did not disclose blocks the restore; it never gets
      // written first and checked afterwards.
      const driftNow = await enumerateMirrorDrift(projectRoot, contentPaths, {
        exclude: new Set(rebuilt.changedTargets.map((target) => target.targetPath))
      });
      if (!sameDriftSet(driftNow, rebuilt.mirrorSyncWriteSet)) {
        throw new SemanticRestoreError(
          "semantic_restore_plan_stale",
          "镜像同步写集与预检披露不一致，整批恢复已阻断，请重新预检。"
        );
      }

      // Copy exactly the verified set. The general upsert would also copy
      // files that appeared after the preview — those are not in the set.
      const upserted = await upsertVerifiedMirrorFiles(
        projectRoot,
        contentPaths,
        rebuilt.mirrorSyncWriteSet.map((item) => item.contentRelPath)
      );
      if (upserted.failed > 0) {
        throw new SemanticRestoreError(
          "semantic_snapshot_unavailable",
          `镜像同步写集有 ${upserted.failed} 个文件未能同步，恢复保持阻断。`
        );
      }

      const driftAfter = await enumerateMirrorDrift(projectRoot, contentPaths, {
        exclude: new Set(rebuilt.changedTargets.map((target) => target.targetPath))
      });
      if (driftAfter.length !== 0) {
        throw new SemanticRestoreError(
          "semantic_snapshot_unavailable",
          "镜像同步写集没有收敛，恢复保持阻断。"
        );
      }

      // The actual scan set must be the scope the preview disclosed.
      const actualScope = await enumerateKtxScanScope(projectRoot);
      if (!sameStringSet(actualScope, rebuilt.fullIndexScope)) {
        throw new SemanticRestoreError(
          "semantic_restore_plan_stale",
          "实际索引范围与预检披露不一致，整批恢复已阻断。"
        );
      }

      await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
      // §5.3 — `applied` is persisted once the formal writes and the mirror
      // verification are done, and before the release turns to `reindexing`.
      // From here on the writes HAVE landed, so the key must not fall back
      // to `failed`: a later failure is an index problem, not a zero-write
      // problem, and the index retry path owns it.
      formalWritesLanded = true;
      await settleSemanticIdempotencyPhase(projectRoot, {
        instanceId,
        actor: input.actor,
        clientKey: input.idempotencyKey,
        phase: "applied"
      });
      const reindexing = await updateReleaseRecord(projectRoot, opened.releaseId, {
        status: "reindexing",
        activationStatus: "unconfirmed",
        recoveryRequired: false,
        // The index scope confirmation object of this batch. An index retry
        // compares against it, so the retry cannot silently run against a
        // scope that moved.
        restoreIndexScope: {
          scope: rebuilt.fullIndexScope,
          restoreWriteSet: rebuilt.changedTargets.map((target) => target.targetPath),
          mirrorSyncWriteSet: rebuilt.mirrorSyncWriteSet.map((item) => ({
            contentRelPath: item.contentRelPath,
            contentDigest: item.contentDigest,
            siblingDigest: item.siblingDigest
          })),
          reindexMode: rebuilt.reindexMode,
          scopeDigest: scopeDigestFor({
            scope: rebuilt.fullIndexScope,
            mirrorSyncWriteSet: rebuilt.mirrorSyncWriteSet.map((item) => ({
              contentRelPath: item.contentRelPath,
              contentDigest: item.contentDigest,
              siblingDigest: item.siblingDigest
            })),
            reindexMode: rebuilt.reindexMode
          })
        }
      });
      if (!reindexing) {
        throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在转入重建索引前消失。");
      }
    } catch (error) {
      // The write failed. The journal rolls the batch back by the actual
      // bytes; whether that rollback is proven decides if a same-key retry
      // may open a new attempt (§5.3).
      let rollbackProven = true;
      try {
        const restored = await restoreRecoveryJournal(projectRoot, journal.journalId);
        if (!restored || restored.recoveryRequired) rollbackProven = false;
      } catch {
        rollbackProven = false;
      }
      await updateReleaseRecord(projectRoot, opened.releaseId, {
        status: "promote_failed",
        activationStatus: "unconfirmed",
        recoveryRequired: !rollbackProven
      }).catch(() => undefined);
      settled = true;
      throw error;
    }

    const reindex = input.reindex ?? (async () => ({ ok: false, exitCode: 1 }));
    const indexed = await reindex(projectRoot, rebuilt.reindexMode);
    if (!indexed.ok) {
      // The files are restored. The index failed, so the activation stays
      // unconfirmed and the journal stays open for an index retry.
      const failed = await updateReleaseRecord(projectRoot, opened.releaseId, {
        status: "reindex_failed",
        activationStatus: "unconfirmed",
        recoveryRequired: false,
        reindex: { ok: false, exitCode: indexed.exitCode },
        terminalAuditPending: false
      });
      settled = true;
      if (!failed) {
        throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
      }
      return { accepted: true, release: failed };
    }

    if (rebuilt.readbackExpectations.length > 0) {
      const readback = input.readback ?? (async () => ({ ok: true }));
      const outcome = await readback(opened.releaseId);
      if (!outcome.ok) {
        const failed = await updateReleaseRecord(projectRoot, opened.releaseId, {
          status: "reindex_failed",
          activationStatus: "unconfirmed",
          recoveryRequired: false,
          reindex: { ok: true, exitCode: indexed.exitCode },
          terminalAuditPending: false
        });
        settled = true;
        if (!failed) {
          throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
        }
        return { accepted: true, release: failed };
      }
    }

    const writeTerminalAudit = input.writeTerminalAudit ?? (async (id: string) => {
      await recordConfigChange({
        filePath: "semantic-layer/",
        changeType: "semantic_restore_terminal",
        assetKind: "publish",
        actor: input.actor,
        actorType: "ui_admin",
        source: "semantic_restore_api",
        targetId: id,
        operation: "restore_terminal",
        requestId: input.previewId,
        idempotencyKey: terminalAuditKey(id, attemptId),
        oldSummary: { sourceReleaseId: input.sourceReleaseId },
        newSummary: {
          releaseId: id,
          attemptId,
          sourceReleaseId: input.sourceReleaseId,
          planDigest: input.planDigest,
          activationStatus: "confirmed"
        }
      });
    });
    // §8.1 — the only order: terminal audit, then the release terminal state
    // with the pending flag, then the audit check that clears it, then the
    // journal.
    await writeTerminalAudit(opened.releaseId);
    await updateReleaseRecord(projectRoot, opened.releaseId, {
      status: "published",
      activationStatus: "confirmed",
      recoveryRequired: false,
      reindex: { ok: true, exitCode: indexed.exitCode },
      terminalAuditPending: true,
      attemptId
    });
    await updateReleaseRecord(projectRoot, opened.releaseId, { terminalAuditPending: false });
    settled = true;
    await completeRecoveryJournal(projectRoot, journal.journalId);
    const release = await readSemanticAssetRelease(projectRoot, opened.releaseId);
    if (!release) {
      throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
    }
    return { accepted: true, release };
  } catch (error) {
    if (!settled && releaseId) {
      await updateReleaseRecord(projectRoot, releaseId, {
        status: "promote_failed",
        activationStatus: "unconfirmed",
        recoveryRequired: true
      }).catch(() => undefined);
      const current = await readSemanticAssetRelease(projectRoot, releaseId);
      if (current?.recoveryJournalId) {
        await restoreRecoveryJournal(projectRoot, current.recoveryJournalId).catch(() => undefined);
      }
    }
    try {
      // §5.3 — `failed` means "settled without a formal write". Once the
      // writes landed the key stays `applied`: the batch owns the index
      // problem, and the index retry path settles it.
      if (!formalWritesLanded) {
        await settleSemanticIdempotencyPhase(projectRoot, {
          instanceId,
          actor: input.actor,
          clientKey: input.idempotencyKey,
          phase: "failed"
        });
      }
    } catch {
      // The idempotency key may not have been reserved yet.
    }
    throw error;
  } finally {
    await releasePublishCoordinatorLock(projectRoot, holder);
  }
}

function sameDriftSet(a: MirrorDriftEntry[], b: MirrorDriftEntry[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Map(a.map((item) => [item.contentRelPath, item.contentDigest]));
  for (const item of b) {
    if (left.get(item.contentRelPath) !== item.contentDigest) return false;
  }
  return true;
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((item) => left.has(item));
}

export async function buildSemanticRestorePackage(
  projectRoot: string,
  releaseId: string
): Promise<{ filename: string; body: Buffer }> {
  const release = await readSemanticAssetRelease(projectRoot, releaseId);
  if (!release?.snapshotId) {
    throw new SemanticRestoreError("semantic_snapshot_unavailable", "这条发布记录没有可导出的批次前快照。");
  }
  const snapshot = await readSemanticReleaseSnapshot(projectRoot, releaseId);
  if (!snapshot) {
    throw new SemanticRestoreError("semantic_snapshot_unavailable", "批次前快照不可用，不能导出恢复包。");
  }
  if (snapshot.entries.length > SEMANTIC_BATCH_LIMITS.restorePackageMaxEntries) {
    throw new SemanticRestoreError(
      "semantic_restore_package_limit",
      "批次前快照超过恢复包条目上限，仍可在服务端恢复，但不能导出。",
      413
    );
  }
  const manifest = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  if (manifest.length > SEMANTIC_BATCH_LIMITS.restorePackageMaxMetadataBytes) {
    throw new SemanticRestoreError("semantic_restore_package_limit", "恢复包元数据超过上限。", 413);
  }
  const files = [{ name: "snapshot.json", data: manifest }];
  let unpacked = manifest.length;
  for (const entry of snapshot.entries) {
    const data = entry.originalBase64 === null ? Buffer.alloc(0) : Buffer.from(entry.originalBase64, "base64");
    const name = entry.originalBase64 === null ? `${entry.targetPath}.absent` : entry.targetPath;
    unpacked += data.length;
    if (unpacked > SEMANTIC_BATCH_LIMITS.restorePackageMaxUnpackedBytes) {
      throw new SemanticRestoreError("semantic_restore_package_limit", "恢复包解压内容超过上限。", 413);
    }
    files.push({ name, data });
  }
  const lease = await acquireSnapshotLease(projectRoot, {
    snapshotId: snapshot.snapshotId,
    kind: "export",
    ttlMs: 10 * 60_000
  });
  try {
    const body = buildStoredZip(files);
    if (body.length > SEMANTIC_BATCH_LIMITS.restorePackageMaxZipBytes) {
      throw new SemanticRestoreError("semantic_restore_package_limit", "恢复包超过体积上限。", 413);
    }
    return { filename: `semantic-restore-${releaseId}.zip`, body };
  } finally {
    await releaseSnapshotLease(projectRoot, lease.leaseId);
  }
}

export function classifySemanticReleaseStartup(input: {
  release: SemanticAssetReleaseRecord;
  journal: RecoveryJournal | null;
  hasTerminalAudit: boolean;
  formalWritesLanded: boolean | null;
}): RestoreStartupClass | null {
  const { release, journal, hasTerminalAudit, formalWritesLanded } = input;
  if (hasTerminalAudit && release.status !== "published") return "A";
  if (release.terminalAuditPending === true) return "C";
  if (release.status === "published" && journal && journal.phase !== "completed" && journal.status !== "completed") {
    return "B";
  }
  if (release.status === "reindexing" && !hasTerminalAudit) return "D";
  if (release.status === "promoting") {
    if (formalWritesLanded === false) return "E";
    return "F";
  }
  if (release.recoveryRequired === true) return "F";
  return null;
}

/**
 * Read back the terminal audit of one attempt.
 *
 * The audit store is the source of truth for "the terminal audit landed". A
 * startup settlement must not assume the release record and the audit agree;
 * it has to read the audit row (Spec v0.11 §8.1).
 */
async function readTerminalAuditRow(
  releaseId: string,
  attemptId: string | undefined
): Promise<{ id: number } | null> {
  if (!attemptId) return null;
  try {
    const { getAuditDb } = await import("./admin/audit.js");
    const database = await getAuditDb();
    const row = database
      .prepare("SELECT id FROM config_change_log WHERE idempotency_key = ? LIMIT 1")
      .get(terminalAuditKey(releaseId, attemptId)) as { id: number } | undefined;
    return row ?? null;
  } catch {
    // An unreadable audit store is not "the audit is missing". The caller
    // treats an unknown answer as "the evidence cannot be checked".
    return null;
  }
}

export type StartupSettlementOptions = {
  /** Index continuation for class D. Production uses the ktx CLI. */
  reindex?: (projectRoot: string, mode: "incremental" | "force") => Promise<{ ok: boolean; exitCode: number }>;
};

export type StartupSettlement = {
  settled: Array<{ releaseId: string; klass: RestoreStartupClass }>;
};

/**
 * Settle crashed content batches before the process accepts traffic.
 *
 * The classification is mutually exclusive and has a priority: the success
 * evidence classes (A / B / C) run before the index continuation class (D).
 * A record classified as A, B or C never produces a new index call.
 */
export async function reconcileSemanticReleaseStartup(
  projectRoot: string,
  options: StartupSettlementOptions = {}
): Promise<StartupSettlement> {
  const records = await readAllSemanticAssetReleaseRecords(projectRoot);
  const journals = await listOpenRecoveryJournals(projectRoot).catch(() => []);
  const settled: StartupSettlement["settled"] = [];
  for (const release of records) {
    const journal =
      journals.find((item) => item.releaseId === release.id) ??
      (release.recoveryJournalId
        ? await readRecoveryJournal(projectRoot, release.recoveryJournalId)
        : null);
    const formalWritesLanded =
      release.status === "promoting"
        ? journal
          ? journal.phase !== "write_in_progress" && journal.applied.length > 0
          : false
        : null;
    // The audit store is read from disk, so a terminal audit that landed
    // before the crash is found even though the release never reached
    // `published`.
    const terminalAudit = await readTerminalAuditRow(release.id, release.attemptId);
    const klass = classifySemanticReleaseStartup({
      release,
      journal,
      hasTerminalAudit: terminalAudit !== null,
      formalWritesLanded
    });
    if (!klass) continue;

    if (klass === "A") {
      // The terminal audit landed but the release never reached `published`.
      // Only the release terminal state is written — no new index call and no
      // second copy of the audit.
      await updateReleaseRecord(projectRoot, release.id, {
        status: "published",
        activationStatus: "confirmed",
        recoveryRequired: false,
        terminalAuditPending: false,
        attemptId: release.attemptId
      });
      settled.push({ releaseId: release.id, klass });
      continue;
    }
    if (klass === "B" && journal) {
      // The release is published but the journal is still open. Only the
      // journal is closed; the release terminal state and the audit stay.
      await completeRecoveryJournal(projectRoot, journal.journalId);
      settled.push({ releaseId: release.id, klass });
      continue;
    }
    if (klass === "C") {
      // `terminalAuditPending` — the terminal audit was written but not yet
      // confirmed. If the audit is on disk, the release terminal state and the
      // pending flag are settled. Otherwise the batch is settled as a
      // retryable failure; it never guesses `published`.
      if (terminalAudit && release.status === "published") {
        await updateReleaseRecord(projectRoot, release.id, {
          status: "published",
          activationStatus: "confirmed",
          terminalAuditPending: false
        });
      } else {
        await updateReleaseRecord(projectRoot, release.id, {
          terminalAuditPending: false,
          status: "reindex_failed",
          activationStatus: "unconfirmed"
        });
      }
      settled.push({ releaseId: release.id, klass });
      continue;
    }
    if (klass === "D") {
      // The index never produced a terminal audit. The index may only be
      // continued when the writes and the mirror are provable — otherwise the
      // batch settles as a retryable failure.
      const provable = await proveContentAndMirror(projectRoot, journal);
      if (!provable) {
        await updateReleaseRecord(projectRoot, release.id, {
          status: "reindex_failed",
          activationStatus: "unconfirmed",
          recoveryRequired: true
        });
        settled.push({ releaseId: release.id, klass });
        continue;
      }
      const mode = release.reindexMode ?? "incremental";
      const reindex = options.reindex ?? (async () => ({ ok: false, exitCode: 1 }));
      const indexed = await reindex(projectRoot, mode);
      if (!indexed.ok) {
        await updateReleaseRecord(projectRoot, release.id, {
          status: "reindex_failed",
          activationStatus: "unconfirmed",
          recoveryRequired: false,
          reindex: { ok: false, exitCode: indexed.exitCode },
          terminalAuditPending: false
        });
        settled.push({ releaseId: release.id, klass });
        continue;
      }
      // §8.1 — the continuation runs the same terminal order as the live path.
      await recordConfigChange({
        filePath: "semantic-layer/",
        changeType: "semantic_publish_terminal",
        assetKind: "publish",
        actor: release.actor,
        actorType: "ui_admin",
        source: "semantic_startup_settlement",
        targetId: release.id,
        operation: "publish_terminal",
        requestId: release.id,
        idempotencyKey: terminalAuditKey(release.id, release.attemptId ?? "unknown"),
        oldSummary: { releaseId: release.id, attemptId: release.attemptId },
        newSummary: {
          releaseId: release.id,
          attemptId: release.attemptId,
          activationStatus: "confirmed"
        }
      });
      await updateReleaseRecord(projectRoot, release.id, {
        status: "published",
        activationStatus: "confirmed",
        recoveryRequired: false,
        terminalAuditPending: true
      });
      await updateReleaseRecord(projectRoot, release.id, { terminalAuditPending: false });
      if (journal) {
        await completeRecoveryJournal(projectRoot, journal.journalId);
      }
      settled.push({ releaseId: release.id, klass });
      continue;
    }
    if (klass === "E") {
      await updateReleaseRecord(projectRoot, release.id, {
        status: "promote_failed",
        activationStatus: "unconfirmed",
        recoveryRequired: false
      });
      settled.push({ releaseId: release.id, klass });
      continue;
    }
    if (klass === "F") {
      await updateReleaseRecord(projectRoot, release.id, {
        recoveryRequired: true,
        activationStatus: "unconfirmed",
        ...(release.status === "promoting" || release.status === "reindexing"
          ? { status: "reindex_failed" as const }
          : {})
      });
      settled.push({ releaseId: release.id, klass });
    }
  }
  return { settled };
}

/**
 * Class D precondition: the files were written and the mirror agrees, so the
 * index can be continued from the index stage without rewriting anything.
 */
async function proveContentAndMirror(
  projectRoot: string,
  journal: RecoveryJournal | null
): Promise<boolean> {
  if (!journal) return false;
  // A journal still in `write_in_progress` means "did the write land?" cannot
  // be decided. It must be settled by the actual bytes first.
  if (journal.phase === "write_in_progress") return false;
  const contentPaths = await resolveContentPaths(projectRoot);
  const sameSurface = await contentRootAndSiblingAreSameDir(projectRoot);
  for (const entry of journal.entries) {
    const surface = entry.surface ?? "content_root";
    const abs = path.resolve(
      surface === "ktx_sibling" ? projectRoot : contentPaths.configDir,
      entry.targetPath
    );
    let digest: string | null;
    try {
      digest = sha256(await readFile(abs));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") digest = null;
      else return false;
    }
    if (digest !== entry.expectedNewDigest) return false;
  }
  if (sameSurface) return true;
  // The sibling view has to agree with the content root for the same targets.
  for (const entry of journal.entries) {
    if ((entry.surface ?? "content_root") !== "content_root") continue;
    const sibling = await readMirrorDigest(projectRoot, contentPaths, entry.targetPath);
    if (sibling !== entry.expectedNewDigest) return false;
  }
  return true;
}

export async function listRestorePreviewFiles(projectRoot: string): Promise<string[]> {
  try {
    return await readdir(path.resolve(projectRoot, PREVIEWS_REL));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

// ─── §5.6 — the restore batch's own index retry ───────────────────────────

export type RestoreIndexScope = {
  releaseId: string;
  scope: string[];
  mirrorSyncWriteSet: Array<{
    contentRelPath: string;
    contentDigest: string | null;
    siblingDigest: string | null;
  }>;
  reindexMode: "incremental" | "force";
  scopeDigest: string;
};

function scopeDigestFor(input: {
  scope: string[];
  mirrorSyncWriteSet: RestoreIndexScope["mirrorSyncWriteSet"];
  reindexMode: "incremental" | "force";
}): string {
  return sha256(
    JSON.stringify({
      scope: input.scope,
      mirrorSyncWriteSet: input.mirrorSyncWriteSet.map((item) => ({
        contentRelPath: item.contentRelPath,
        contentDigest: item.contentDigest,
        siblingDigest: item.siblingDigest
      })),
      reindexMode: input.reindexMode
    })
  );
}

/**
 * The current index scope of a restore batch.
 *
 * This is the "range confirmation" object of Spec §5.6: it confirms the index
 * scope without recomputing a content restore plan. A pre-check against the
 * source batch would fail the CAS (the restore already landed), and a
 * pre-check against the restore batch would build a reverse restore.
 */
export async function readRestoreIndexScope(
  projectRoot: string,
  releaseId: string
): Promise<RestoreIndexScope> {
  const release = await readSemanticAssetRelease(projectRoot, releaseId);
  if (!release) {
    throw new SemanticRestoreError("semantic_release_not_restorable", "发布记录不存在。", 404);
  }
  if (release.trigger !== "webui_restore") {
    throw new SemanticRestoreError(
      "semantic_release_not_restorable",
      "只有整批恢复批次提供自己的索引重试。"
    );
  }
  const contentPaths = await resolveContentPaths(projectRoot);
  // The restore write set is excluded from the drift list for the same reason
  // the preview excludes it: those files are the restore's own controlled
  // mirror targets, not platform drift.
  const exclude = new Set(release.restoreIndexScope?.restoreWriteSet ?? []);
  const scope = await enumerateFullIndexScope(projectRoot, contentPaths, []);
  const mirrorSyncWriteSet = await enumerateMirrorDrift(projectRoot, contentPaths, { exclude });
  const reindexMode = release.reindexMode ?? "incremental";
  return {
    releaseId,
    scope,
    mirrorSyncWriteSet: mirrorSyncWriteSet.map((item) => ({
      contentRelPath: item.contentRelPath,
      contentDigest: item.contentDigest,
      siblingDigest: item.siblingDigest
    })),
    reindexMode,
    scopeDigest: scopeDigestFor({ scope, mirrorSyncWriteSet, reindexMode })
  };
}

export type RetryRestoreIndexInput = {
  releaseId: string;
  /** The scope digest the operator confirmed. */
  scopeDigest: string;
  idempotencyKey: string;
  actor: string;
  reindex?: (projectRoot: string, mode: "incremental" | "force") => Promise<{ ok: boolean; exitCode: number }>;
  readback?: (releaseId: string) => Promise<{ ok: boolean }>;
};

/**
 * Retry the index of a restore batch.
 *
 * The restore write set is not written again: the files are already in their
 * restored state. The retry re-runs the index with the mode the release
 * record persisted, keeps the original failed attempt, and uses a new
 * attempt id. A scope that changed since the confirmation blocks the retry
 * and asks for a new confirmation — it never re-runs the restore.
 */
export async function retryRestoreIndex(
  projectRoot: string,
  input: RetryRestoreIndexInput
): Promise<{ accepted: boolean; release: SemanticAssetReleaseRecord }> {
  if (!input.idempotencyKey.trim()) {
    throw new SemanticRestoreError("semantic_restore_idempotency_conflict", "索引重试必须携带幂等键。", 400);
  }
  const release = await readSemanticAssetRelease(projectRoot, input.releaseId);
  if (!release) {
    throw new SemanticRestoreError("semantic_release_not_restorable", "发布记录不存在。", 404);
  }
  if (release.trigger !== "webui_restore") {
    throw new SemanticRestoreError(
      "semantic_release_not_restorable",
      "只有整批恢复批次提供自己的索引重试。"
    );
  }
  if (release.status !== "reindex_failed") {
    throw new SemanticRestoreError(
      "semantic_release_not_restorable",
      "只有索引失败的恢复批次可以重试索引。"
    );
  }
  const current = await readRestoreIndexScope(projectRoot, input.releaseId);
  if (current.scopeDigest !== input.scopeDigest) {
    throw new SemanticRestoreError(
      "semantic_restore_plan_stale",
      "索引范围已变化，请重新确认范围后再重试索引。"
    );
  }
  if (release.restoreIndexScope && release.restoreIndexScope.scopeDigest !== input.scopeDigest) {
    throw new SemanticRestoreError(
      "semantic_restore_plan_stale",
      "当前索引范围与该恢复批次的记录不一致，请重新确认范围。"
    );
  }

  const acquired = await acquirePublishCoordinatorLock(projectRoot, "semantic_restore", {
    releaseId: input.releaseId
  });
  if (!acquired.acquired) {
    throw new SemanticRestoreError("semantic_publish_busy", "发布窗口被占用，索引重试没有开始。");
  }
  const holder: PublishLockHolder = acquired.holder;
  try {
    // Re-check under the lock: the scope may have moved between the
    // confirmation and the retry.
    const locked = await readRestoreIndexScope(projectRoot, input.releaseId);
    if (locked.scopeDigest !== input.scopeDigest) {
      throw new SemanticRestoreError(
        "semantic_restore_plan_stale",
        "索引范围已变化，请重新确认范围后再重试索引。"
      );
    }
    const attemptId = `att_${randomUUID()}`;
    await updateReleaseRecord(projectRoot, input.releaseId, {
      status: "reindexing",
      activationStatus: "unconfirmed",
      recoveryRequired: false
    });
    const reindex = input.reindex ?? (async () => ({ ok: false, exitCode: 1 }));
    const indexed = await reindex(projectRoot, locked.reindexMode);
    if (!indexed.ok) {
      // The original failed attempt and its audit stay. The record keeps
      // `reindex_failed` so the operator can retry again.
      const failed = await updateReleaseRecord(projectRoot, input.releaseId, {
        status: "reindex_failed",
        activationStatus: "unconfirmed",
        reindex: { ok: false, exitCode: indexed.exitCode },
        terminalAuditPending: false
      });
      if (!failed) {
        throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
      }
      return { accepted: true, release: failed };
    }
    const readback = input.readback ?? (async () => ({ ok: true }));
    const outcome = await readback(input.releaseId);
    if (!outcome.ok) {
      const failed = await updateReleaseRecord(projectRoot, input.releaseId, {
        status: "reindex_failed",
        activationStatus: "unconfirmed",
        reindex: { ok: true, exitCode: indexed.exitCode },
        terminalAuditPending: false
      });
      if (!failed) {
        throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
      }
      return { accepted: true, release: failed };
    }
    await recordConfigChange({
      filePath: "semantic-layer/",
      changeType: "semantic_restore_terminal",
      assetKind: "publish",
      actor: input.actor,
      actorType: "ui_admin",
      source: "semantic_restore_api",
      targetId: input.releaseId,
      operation: "restore_terminal",
      requestId: input.idempotencyKey,
      idempotencyKey: terminalAuditKey(input.releaseId, attemptId),
      oldSummary: { releaseId: input.releaseId, attemptId },
      newSummary: {
        releaseId: input.releaseId,
        attemptId,
        activationStatus: "confirmed",
        indexRetry: true
      }
    });
    await updateReleaseRecord(projectRoot, input.releaseId, {
      status: "published",
      activationStatus: "confirmed",
      recoveryRequired: false,
      reindex: { ok: true, exitCode: indexed.exitCode },
      terminalAuditPending: true
    });
    await updateReleaseRecord(projectRoot, input.releaseId, { terminalAuditPending: false });
    const settled = await readSemanticAssetRelease(projectRoot, input.releaseId);
    if (!settled) {
      throw new SemanticRestoreError("semantic_snapshot_unavailable", "恢复批次记录在终态前消失。");
    }
    return { accepted: true, release: settled };
  } finally {
    await releasePublishCoordinatorLock(projectRoot, holder);
  }
}

export { mergedTableLabel };
