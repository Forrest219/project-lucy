import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withPublishCoordinator } from "../publish-coordinator.js";
import { applyConnectionIdChange } from "../project.js";
import {
  openPromotingContentRelease,
  readAllSemanticAssetReleaseRecords,
  readSemanticAssetRelease,
  recordManualReindex
} from "../semantic-assets.js";
import { registerSemanticIdempotencyKey } from "../semantic-idempotency.js";
import {
  readOrCreateSemanticInstanceId,
  readSemanticReleaseSnapshot,
  writeSemanticReleaseSnapshot,
  SemanticReleaseSnapshotError
} from "../semantic-release-snapshots.js";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-l25-15-snap-"));
  roots.push(root);
  await mkdir(path.join(root, "semantic-layer", "demo"), { recursive: true });
  await writeFile(path.join(root, "semantic-layer", "demo", "orders.yaml"), "table: orders\n", "utf8");
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  process.env.LUCY_CONTENT_ROOT = ".";
  return root;
}

afterEach(async () => {
  delete process.env.LUCY_CONTENT_ROOT;
  delete process.env.LUCY_SEMANTIC_INSTANCE_ID;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("semantic release snapshots", () => {
  it("refuses to write a snapshot when this process does not hold the publish window", async () => {
    const root = await makeRoot();
    await expect(
      writeSemanticReleaseSnapshot({
        projectRoot: root,
        releaseId: "rel_outside",
        actor: "local-admin",
        entries: [
          {
            order: 0,
            targetPath: "semantic-layer/demo/orders.yaml",
            assetKind: "overlay",
            expectedNewDigest: "a".repeat(64)
          }
        ]
      })
    ).rejects.toBeInstanceOf(SemanticReleaseSnapshotError);
    await expect(
      readFile(path.join(root, ".ktx-ui/semantic-release-snapshots/rel_outside/snapshot.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes the snapshot inside the held window and links it before any formal change", async () => {
    const root = await makeRoot();
    const before = await readFile(path.join(root, "semantic-layer/demo/orders.yaml"), "utf8");
    const opened = await withPublishCoordinator(
      "semantic_table_save",
      () =>
        openPromotingContentRelease({
          projectRoot: root,
          actor: "local-admin",
          targets: [
            {
              targetPath: "semantic-layer/demo/orders.yaml",
              assetKind: "overlay",
              identity: { connectionId: "demo", schema: "shop", table: "orders" },
              expectedNewDigest: "b".repeat(64)
            }
          ]
        }),
      { projectRoot: root }
    );
    const snapshot = await readSemanticReleaseSnapshot(root, opened.releaseId);
    const release = await readSemanticAssetRelease(root, opened.releaseId);
    expect(snapshot?.schemaVersion).toBe("semantic-release-snapshot/v1");
    expect(snapshot?.snapshotId).toBe(opened.snapshotId);
    expect(snapshot?.entries[0]?.originalBase64).toBe(Buffer.from(before, "utf8").toString("base64"));
    expect(release?.status).toBe("promoting");
    expect(release?.snapshotId).toBe(opened.snapshotId);
    expect(await readFile(path.join(root, "semantic-layer/demo/orders.yaml"), "utf8")).toBe(before);
    const instanceId = await readOrCreateSemanticInstanceId(root);
    expect(instanceId).not.toBe("lucy-default");
    expect(snapshot?.instanceId).toBe(instanceId);
  });

  it("keeps a release that an unexpired idempotency record still names", async () => {
    const root = await makeRoot();
    const instanceId = await readOrCreateSemanticInstanceId(root);
    let protectedId = "";
    await withPublishCoordinator(
      "batch_import",
      async () => {
        const first = await openPromotingContentRelease({
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
        protectedId = first.releaseId;
        await registerSemanticIdempotencyKey(root, {
          instanceId,
          actor: "local-admin",
          clientKey: "keep-me",
          planDigest: "plan-1",
          releaseId: protectedId
        });
        for (let i = 0; i < 100; i += 1) {
          await openPromotingContentRelease({
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
        }
      },
      { projectRoot: root }
    );
    const all = await readAllSemanticAssetReleaseRecords(root);
    expect(all.some((record) => record.id === protectedId)).toBe(true);
    expect(all.length).toBeGreaterThan(100);
  });

  it("does not capture a content snapshot for a manual reindex", async () => {
    const root = await makeRoot();
    const record = await recordManualReindex(root, {
      actor: "local-admin",
      force: false,
      reindex: { ok: true, exitCode: 0 }
    });
    expect(record.trigger).toBe("webui_manual_reindex");
    expect(record.snapshotId).toBeUndefined();
    await expect(
      readFile(path.join(root, ".ktx-ui/semantic-release-snapshots/any/snapshot.json"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes the publish window for a connection id change and does not snapshot content", async () => {
    const root = await makeRoot();
    let releaseGate: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const owner = withPublishCoordinator("manual_reindex", () => held, { projectRoot: root });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(
      applyConnectionIdChange(root, "demo", "demo_next", { write: true })
    ).rejects.toThrow(/发布窗口/);
    releaseGate();
    await owner;
    await expect(readFile(path.join(root, ".ktx-ui/semantic-release-snapshots"), "utf8")).rejects.toBeTruthy();
  });
});
