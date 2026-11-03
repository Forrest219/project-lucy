import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAuditDb } from "../admin/audit.js";
import { withPublishCoordinator } from "../publish-coordinator.js";
import { openPromotingContentRelease, readSemanticAssetRelease, updateReleaseRecord } from "../semantic-assets.js";
import {
  previewSemanticRestore,
  readRestoreIndexScope,
  retryRestoreIndex,
  submitSemanticRestore
} from "../semantic-release-restore.js";
import { readRecoveryJournal } from "../semantic-recovery-journal.js";

const roots: string[] = [];

function digestOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * The normal layout: the content root is `<root>/config` and the ktx
 * sibling view is `<root>/semantic-layer`. The two surfaces are distinct,
 * so the restore has to write and verify both.
 */
async function makeTwoSurfaceRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-l25-15-contract-"));
  roots.push(root);
  delete process.env.LUCY_CONTENT_ROOT;
  await mkdir(path.join(root, "config", "semantic-layer", "demo"), { recursive: true });
  await mkdir(path.join(root, "semantic-layer", "demo"), { recursive: true });
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  return root;
}

const CONTENT_REL = "semantic-layer/demo/orders.yaml";

/** Publish a batch that wrote `after` over `before` and settle it. */
async function publishOverwrite(
  root: string,
  relPath: string,
  before: string,
  after: string,
  options: { mirror?: boolean } = {}
): Promise<string> {
  const contentAbs = path.join(root, "config", relPath);
  await writeFile(contentAbs, before, "utf8");
  if (options.mirror !== false) {
    const siblingAbs = path.join(root, relPath);
    await mkdir(path.dirname(siblingAbs), { recursive: true });
    await writeFile(siblingAbs, before, "utf8");
  }
  const releaseId = await withPublishCoordinator(
    "batch_import",
    async () => {
      const opened = await openPromotingContentRelease({
        projectRoot: root,
        actor: "local-admin",
        targets: [
          {
            targetPath: relPath,
            assetKind: relPath.includes("/_schema/") ? "manifest" : "overlay",
            expectedNewDigest: digestOf(after)
          }
        ]
      });
      await updateReleaseRecord(root, opened.releaseId, {
        status: "published",
        activationStatus: "confirmed",
        terminalAuditPending: false
      });
      return opened.releaseId;
    },
    { projectRoot: root }
  );
  await writeFile(contentAbs, after, "utf8");
  const siblingAbs = path.join(root, relPath);
  await mkdir(path.dirname(siblingAbs), { recursive: true });
  await writeFile(siblingAbs, after, "utf8");
  return releaseId;
}

afterEach(async () => {
  delete process.env.LUCY_CONTENT_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("semantic release restore — write set separation and CAS", () => {
  it("blocks the whole restore when the ktx sibling does not match the content root", async () => {
    const root = await makeTwoSurfaceRoot();
    const sourceId = await publishOverwrite(root, CONTENT_REL, "table: before\n", "table: after\n");
    // The ktx view drifts away from the content root. The restore must not
    // overwrite an unknown mirror state.
    await writeFile(path.join(root, CONTENT_REL), "table: something else\n", "utf8");

    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    expect(preview.verdict).toBe("ready");

    await expect(
      submitSemanticRestore(root, {
        sourceReleaseId: sourceId,
        previewId: preview.previewId,
        planDigest: preview.planDigest,
        idempotencyKey: "cas-once",
        actor: "local-admin",
        syncMirror: async () => undefined,
        reindex: async () => ({ ok: true, exitCode: 0 }),
        writeTerminalAudit: async () => undefined
      })
    ).rejects.toMatchObject({ code: "semantic_restore_conflict" });

    // Zero formal writes: neither surface was touched. The content root
    // still holds the batch's bytes and the ktx view still holds its own.
    expect(await readFile(path.join(root, "config", CONTENT_REL), "utf8")).toBe("table: after\n");
    expect(await readFile(path.join(root, CONTENT_REL), "utf8")).toBe("table: something else\n");
  });

  it("separates the mirror sync write set from the restore write set", async () => {
    const root = await makeTwoSurfaceRoot();
    const sourceId = await publishOverwrite(root, CONTENT_REL, "table: before\n", "table: after\n");
    // A pre-existing drift that this restore does not write.
    await writeFile(path.join(root, "config", "semantic-layer", "demo", "other.yaml"), "table: drift\n", "utf8");

    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    // The drift is disclosed with both sides of the comparison.
    const drift = preview.mirrorSyncWriteSet.find((item) => item.contentRelPath === "semantic-layer/demo/other.yaml");
    expect(drift).toBeTruthy();
    expect(drift?.contentDigest).toBe(digestOf("table: drift\n"));
    expect(drift?.siblingDigest).toBeNull();

    const submitted = await submitSemanticRestore(root, {
      sourceReleaseId: sourceId,
      previewId: preview.previewId,
      planDigest: preview.planDigest,
      idempotencyKey: "split-once",
      actor: "local-admin",
      syncMirror: async () => undefined,
      reindex: async () => ({ ok: true, exitCode: 0 }),
      writeTerminalAudit: async () => undefined
    });
    expect(submitted.release.status).toBe("published");

    // The drift file reached the ktx view through the controlled upsert.
    expect(await readFile(path.join(root, "semantic-layer", "demo", "other.yaml"), "utf8")).toBe("table: drift\n");

    // The journal holds the restore write set only — never the mirror sync
    // write set.
    const journal = await readRecoveryJournal(root, submitted.release.recoveryJournalId!);
    const journalPaths = (journal?.entries ?? []).map((entry) => entry.targetPath);
    expect(journalPaths).toContain(CONTENT_REL);
    expect(journalPaths).not.toContain("semantic-layer/demo/other.yaml");
  });

  it("deletes the ktx sibling of a target the restore returns to absent", async () => {
    const root = await makeTwoSurfaceRoot();
    // The source batch created the file, so the restore returns it to absent.
    const created = "table: created\n";
    const relPath = "semantic-layer/demo/created.yaml";
    const sourceId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [{ targetPath: relPath, assetKind: "overlay", expectedNewDigest: digestOf(created) }]
        });
        await updateReleaseRecord(root, opened.releaseId, {
          status: "published",
          activationStatus: "confirmed",
          terminalAuditPending: false
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );
    await writeFile(path.join(root, "config", relPath), created, "utf8");
    await writeFile(path.join(root, relPath), created, "utf8");

    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    expect(preview.targets.find((t) => t.targetPath === relPath)?.action).toBe("delete");

    const submitted = await submitSemanticRestore(root, {
      sourceReleaseId: sourceId,
      previewId: preview.previewId,
      planDigest: preview.planDigest,
      idempotencyKey: "delete-once",
      actor: "local-admin",
      syncMirror: async () => undefined,
      reindex: async () => ({ ok: true, exitCode: 0 }),
      writeTerminalAudit: async () => undefined
    });
    expect(submitted.release.status).toBe("published");

    // Both surfaces lost the file — the general mirror never deletes, so the
    // restore has to remove the sibling itself.
    await expect(readFile(path.join(root, "config", relPath), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(root, relPath), "utf8")).rejects.toThrow();
  });

  it("retries the index of a failed restore batch against a confirmed scope", async () => {
    const root = await makeTwoSurfaceRoot();
    const sourceId = await publishOverwrite(root, CONTENT_REL, "table: before\n", "table: after\n");
    const preview = await previewSemanticRestore(root, sourceId, "local-admin");

    const failed = await submitSemanticRestore(root, {
      sourceReleaseId: sourceId,
      previewId: preview.previewId,
      planDigest: preview.planDigest,
      idempotencyKey: "index-fail",
      actor: "local-admin",
      syncMirror: async () => undefined,
      reindex: async () => ({ ok: false, exitCode: 1 }),
      writeTerminalAudit: async () => undefined
    });
    expect(failed.release.status).toBe("reindex_failed");
    expect(failed.release.activationStatus).toBe("unconfirmed");

    const scope = await readRestoreIndexScope(root, failed.release.id);
    expect(scope.scope).toContain(CONTENT_REL);

    // A scope that moved is refused — the operator has to confirm again.
    await expect(
      retryRestoreIndex(root, {
        releaseId: failed.release.id,
        scopeDigest: "not-the-current-scope",
        idempotencyKey: "retry-stale",
        actor: "local-admin",
        reindex: async () => ({ ok: true, exitCode: 0 })
      })
    ).rejects.toMatchObject({ code: "semantic_restore_plan_stale" });

    const retried = await retryRestoreIndex(root, {
      releaseId: failed.release.id,
      scopeDigest: scope.scopeDigest,
      idempotencyKey: "retry-once",
      actor: "local-admin",
      reindex: async () => ({ ok: true, exitCode: 0 })
    });
    expect(retried.release.id).toBe(failed.release.id);
    const audit = await getAuditDb();
    const rows = audit
      .prepare("SELECT idempotency_key FROM config_change_log WHERE idempotency_key LIKE ?")
      .all(`${failed.release.id}:%`) as Array<{ idempotency_key: string }>;
    expect(rows).toHaveLength(1);
    const retryAttempt = rows[0]?.idempotency_key.split(":")[1];
    expect(retryAttempt).toMatch(/^att_/);
    expect(retryAttempt).not.toBe(failed.release.attemptId);
    expect(rows[0]?.idempotency_key.startsWith(`${failed.release.id}:`)).toBe(true);
    expect(retried.release.status).toBe("published");
    expect(retried.release.activationStatus).toBe("confirmed");
    // The retry does not write the content again.
    expect(await readFile(path.join(root, "config", CONTENT_REL), "utf8")).toBe("table: before\n");
  });
});
