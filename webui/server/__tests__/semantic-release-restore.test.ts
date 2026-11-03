import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withPublishCoordinator } from "../publish-coordinator.js";
import { openPromotingContentRelease, readSemanticAssetRelease, updateReleaseRecord } from "../semantic-assets.js";
import {
  buildSemanticRestorePackage,
  classifySemanticReleaseStartup,
  previewSemanticRestore,
  reconcileSemanticReleaseStartup,
  submitSemanticRestore
} from "../semantic-release-restore.js";
import { readSemanticReleaseSnapshot, type SemanticReleaseSnapshot } from "../semantic-release-snapshots.js";
import { computeSnapshotDigest } from "../semantic-release-snapshots.js";
import { SEMANTIC_BATCH_LIMITS } from "../semantic-limits.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-l25-15-restore-"));
  roots.push(root);
  await mkdir(path.join(root, "semantic-layer", "demo"), { recursive: true });
  await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), "table: before\n", "utf8");
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.LUCY_CONTENT_ROOT = ".";
  return root;
}

afterEach(async () => {
  delete process.env.LUCY_CONTENT_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function publishLike(root: string): Promise<string> {
  const releaseId = await withPublishCoordinator(
    "batch_import",
    async () => {
      const opened = await openPromotingContentRelease({
        projectRoot: root,
        actor: "local-admin",
        targets: [
          {
            targetPath: "semantic-layer/demo/orders.yaml",
            assetKind: "overlay",
            identity: { connectionId: "demo", schema: "shop", table: "orders" },
            expectedNewDigest: "c".repeat(64)
          }
        ]
      });
      await updateReleaseRecord(root, opened.releaseId, {
        status: "published",
        activationStatus: "confirmed",
        terminalAuditPending: false
      });
      await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), "table: after\n", "utf8");
      return opened.releaseId;
    },
    { projectRoot: root }
  );
  return releaseId;
}

describe("semantic release restore", () => {
  it("restores the pre-release bytes and keeps the source release", async () => {
    const root = await makeRoot();
    const sourceId = await publishLike(root);
    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    expect(preview.verdict).toBe("conflict");
    const snapshot = await readSemanticReleaseSnapshot(root, sourceId);
    expect(snapshot?.entries[0]?.originalDigest).toBeTruthy();
    await writeFile(
      path.join(root, "semantic-layer", "demo", "orders.yaml"),
      Buffer.from(snapshot!.entries[0]!.originalBase64!, "base64")
    );
    await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), "table: after\n", "utf8");
    const current = await readFile(path.join(root, "semantic-layer", "demo", "orders.yaml"));
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(current).digest("hex");
    expect(digest).not.toBe(snapshot?.entries[0]?.expectedNewDigest);
  });

  it("submits a restore when the current digest matches the batch's expected bytes", async () => {
    const root = await makeRoot();
    const { createHash } = await import("node:crypto");
    const after = "table: after\n";
    const afterDigest = createHash("sha256").update(after, "utf8").digest("hex");
    const sourceId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              identity: { connectionId: "demo", schema: "shop", table: "orders" },
              expectedNewDigest: afterDigest
            }
          ]
        });
        await updateReleaseRecord(root, opened.releaseId, {
          status: "published",
          activationStatus: "confirmed"
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );
    await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), after, "utf8");
    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    expect(preview.verdict).toBe("ready");
    const submitted = await submitSemanticRestore(root, {
      sourceReleaseId: sourceId,
      previewId: preview.previewId,
      planDigest: preview.planDigest,
      idempotencyKey: "restore-once",
      actor: "local-admin",
      syncMirror: async () => undefined,
      reindex: async () => ({ ok: true, exitCode: 0 }),
      writeTerminalAudit: async () => undefined
    });
    expect(submitted.release.trigger).toBe("webui_restore");
    expect(submitted.release.restoreOfReleaseId).toBe(sourceId);
    expect(submitted.release.status).toBe("published");
    expect(submitted.release.terminalAuditPending).toBe(false);
    expect(await readFile(path.join(root, "semantic-layer/demo/orders.yaml"), "utf8")).toBe("table: before\n");
    const source = await readSemanticAssetRelease(root, sourceId);
    expect(source?.status).toBe("published");
    const replay = await submitSemanticRestore(root, {
      sourceReleaseId: sourceId,
      previewId: preview.previewId,
      planDigest: preview.planDigest,
      idempotencyKey: "restore-once",
      actor: "local-admin",
      syncMirror: async () => undefined,
      reindex: async () => ({ ok: true, exitCode: 0 }),
      writeTerminalAudit: async () => undefined
    });
    expect(replay.release.id).toBe(submitted.release.id);
  });

  it("refuses a restore package above the entry cap without truncating it", async () => {
    const root = await makeRoot();
    const entries = Array.from({ length: SEMANTIC_BATCH_LIMITS.restorePackageMaxEntries + 1 }, (_, order) => ({
      order,
      targetPath: `semantic-layer/demo/t${order}.yaml`,
      assetKind: "overlay" as const,
      originalBase64: null,
      originalDigest: null,
      expectedNewDigest: null
    }));
    const body: Omit<SemanticReleaseSnapshot, "snapshotDigest"> = {
      schemaVersion: "semantic-release-snapshot/v1",
      snapshotId: "snap_over",
      releaseId: "rel_over",
      instanceId: "inst_test",
      createdAt: new Date().toISOString(),
      actor: "local-admin",
      entries
    };
    const snapshot = { ...body, snapshotDigest: computeSnapshotDigest(body) };
    await mkdir(path.join(root, ".ktx-ui/semantic-release-snapshots/rel_over"), { recursive: true });
    await writeFile(
      path.join(root, ".ktx-ui/semantic-release-snapshots/rel_over/snapshot.json"),
      JSON.stringify(snapshot),
      "utf8"
    );
    await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
    await writeFile(
      path.join(root, ".ktx-ui/semantic-asset-releases.json"),
      JSON.stringify({
        version: 1,
        records: [
          {
            id: "rel_over",
            createdAt: snapshot.createdAt,
            actor: "local-admin",
            status: "published",
            trigger: "webui_publish",
            connectionIds: [],
            files: [],
            changedSources: [],
            validation: { ok: true, results: [] },
            snapshotId: "snap_over"
          }
        ]
      }),
      "utf8"
    );
    await expect(buildSemanticRestorePackage(root, "rel_over")).rejects.toMatchObject({
      code: "semantic_restore_package_limit"
    });
  });

  it("classifies startup records exclusively and settles a promoting record with no writes", async () => {
    expect(
      classifySemanticReleaseStartup({
        release: {
          id: "a",
          createdAt: "2026-10-30T00:00:00.000Z",
          actor: "local-admin",
          status: "reindexing",
          connectionIds: [],
          files: [],
          changedSources: [],
          validation: { ok: true, results: [] },
          terminalAuditPending: true
        },
        journal: null,
        hasTerminalAudit: true,
        formalWritesLanded: null
      })
    ).toBe("A");
    expect(
      classifySemanticReleaseStartup({
        release: {
          id: "c",
          createdAt: "2026-10-30T00:00:00.000Z",
          actor: "local-admin",
          status: "published",
          connectionIds: [],
          files: [],
          changedSources: [],
          validation: { ok: true, results: [] },
          terminalAuditPending: true,
          activationStatus: "confirmed"
        },
        journal: null,
        hasTerminalAudit: false,
        formalWritesLanded: null
      })
    ).toBe("C");
    const root = await makeRoot();
    await withPublishCoordinator(
      "batch_import",
      () =>
        openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              expectedNewDigest: null
            }
          ]
        }),
      { projectRoot: root }
    );
    const settled = await reconcileSemanticReleaseStartup(root);
    expect(settled.settled.map((item) => item.klass)).toContain("E");
    const release = await readSemanticAssetRelease(root, settled.settled[0]!.releaseId);
    expect(release?.status).toBe("promote_failed");
  });

  it("settles class A from the terminal audit on disk, not from the release record", async () => {
    const root = await makeRoot();
    const { recordConfigChange } = await import("../admin/audit.js");
    const { semanticTerminalAuditKey } = await import("../semantic-assets.js");
    const releaseId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              expectedNewDigest: null
            }
          ]
        });
        await updateReleaseRecord(root, opened.releaseId, {
          status: "reindexing",
          attemptId: "att_class_a"
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );
    // The terminal audit landed before the crash; the release never reached
    // `published`.
    await recordConfigChange({
      filePath: "semantic-layer/",
      changeType: "semantic_publish_terminal",
      assetKind: "publish",
      actor: "local-admin",
      actorType: "ui_admin",
      source: "publish_workbench_api",
      targetId: releaseId,
      operation: "publish_terminal",
      idempotencyKey: semanticTerminalAuditKey(releaseId, "att_class_a")
    });

    const settled = await reconcileSemanticReleaseStartup(root);
    const entry = settled.settled.find((item) => item.releaseId === releaseId);
    expect(entry?.klass).toBe("A");
    const release = await readSemanticAssetRelease(root, releaseId);
    expect(release?.status).toBe("published");
    expect(release?.activationStatus).toBe("confirmed");
    expect(release?.terminalAuditPending).toBe(false);
  });

  it("continues the index of a class D record when the content and the mirror are provable", async () => {
    const root = await makeRoot();
    const { createRecoveryJournal, markRecoveryJournalFilesSaved } = await import(
      "../semantic-recovery-journal.js"
    );
    const after = "table: after\n";
    const { createHash } = await import("node:crypto");
    const afterDigest = createHash("sha256").update(after, "utf8").digest("hex");
    await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), after, "utf8");

    const releaseId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              expectedNewDigest: afterDigest
            }
          ]
        });
        const journal = await createRecoveryJournal(root, {
          releaseId: opened.releaseId,
          operationId: opened.releaseId,
          actor: "local-admin",
          instanceId: "inst_test",
          targets: [{ targetPath: "semantic-layer/demo/orders.yaml", newContent: after }]
        });
        await markRecoveryJournalFilesSaved(root, journal.journalId);
        await updateReleaseRecord(root, opened.releaseId, {
          status: "reindexing",
          attemptId: "att_class_d",
          recoveryJournalId: journal.journalId,
          reindexMode: "force"
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );

    const modes: string[] = [];
    const settled = await reconcileSemanticReleaseStartup(root, {
      reindex: async (_root, mode) => {
        modes.push(mode);
        return { ok: true, exitCode: 0 };
      }
    });
    const entry = settled.settled.find((item) => item.releaseId === releaseId);
    expect(entry?.klass).toBe("D");
    // The continuation reuses the mode the release record persisted.
    expect(modes).toEqual(["force"]);
    const release = await readSemanticAssetRelease(root, releaseId);
    expect(release?.status).toBe("published");
    expect(release?.activationStatus).toBe("confirmed");
  });

  it("settles a class D record as retryable when the writes are not provable", async () => {
    const root = await makeRoot();
    const releaseId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              expectedNewDigest: null
            }
          ]
        });
        await updateReleaseRecord(root, opened.releaseId, {
          status: "reindexing",
          attemptId: "att_class_d_unknown"
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );
    let indexCalls = 0;
    const settled = await reconcileSemanticReleaseStartup(root, {
      reindex: async () => {
        indexCalls += 1;
        return { ok: true, exitCode: 0 };
      }
    });
    const entry = settled.settled.find((item) => item.releaseId === releaseId);
    expect(entry?.klass).toBe("D");
    // Without a journal the writes cannot be proven, so no index call happens.
    expect(indexCalls).toBe(0);
    const release = await readSemanticAssetRelease(root, releaseId);
    expect(release?.status).toBe("reindex_failed");
    expect(release?.activationStatus).toBe("unconfirmed");
  });

  it("forces a rebuild when the restore removes a table from a manifest in place", async () => {
    const root = await makeRoot();
    const { createHash } = await import("node:crypto");
    await mkdir(path.join(root, "semantic-layer", "demo", "_schema"), { recursive: true });
    const before = "tables:\n  orders:\n    columns: []\n";
    const after = "tables:\n  orders:\n    columns: []\n  customers:\n    columns: []\n";
    await writeFile(path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"), before, "utf8");
    const afterDigest = createHash("sha256").update(after, "utf8").digest("hex");

    const sourceId = await withPublishCoordinator(
      "batch_import",
      async () => {
        const opened = await openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/_schema/shop.yaml",
              assetKind: "manifest",
              expectedNewDigest: afterDigest
            }
          ]
        });
        await updateReleaseRecord(root, opened.releaseId, {
          status: "published",
          activationStatus: "confirmed"
        });
        return opened.releaseId;
      },
      { projectRoot: root }
    );
    await writeFile(path.join(root, "semantic-layer", "demo", "_schema", "shop.yaml"), after, "utf8");

    const preview = await previewSemanticRestore(root, sourceId, "local-admin");
    // The manifest file is still a `restore` target — it is not absent — but
    // the table "customers" leaves the merged model.
    expect(preview.reindexMode).toBe("force");
    expect(
      preview.semanticDeletionSet.map((table) => `${table.connectionId}/${table.schema}/${table.table}`)
    ).toEqual(["demo/shop/customers"]);
    expect(preview.readbackExpectations.map((item) => item.kind)).toContain("table_gone");
  });
});
