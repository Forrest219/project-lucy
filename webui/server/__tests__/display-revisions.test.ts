import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  displayGenerations,
  hasPendingDisplayWrite,
  resetDisplayGenerationsForTests,
  withDisplayWriteBarrier
} from "../display-generation";
import { RevisionLedger, scopeContextId, type RevisionCandidate } from "../display-revisions";
import { reconcileFullDigest, reconcileMetadata, resetDisplaySnapshotsForTests, startDisplayReconciler, stopDisplayReconciler } from "../display-snapshot";
import { safeWriteAtomic } from "../fs-safe";
import { loadContentPaths } from "../paths";
import { invalidateContentPathsCache } from "../paths";

const CONTEXT = {
  projectRoot: "/p",
  semanticLayer: "/p/config/semantic-layer",
  accessPaths: ["/p/webui/config/access.yaml"]
};

function candidate(fileId: string, meta: string, digest: string, sequence: number): RevisionCandidate {
  return { fileId, meta, digest, sequence };
}

describe("Spec 195 §5 — unified file revision ledger (SI-03)", () => {
  it("a version that was already accepted never invalidates twice", () => {
    const ledger = new RevisionLedger(CONTEXT, scopeContextId(CONTEXT));
    const first = ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m1", "d1", 1)]);
    expect(first.changedScopes).toEqual(["D"]);
    const second = ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m1", "d1", 2)]);
    expect(second.changedScopes).toEqual([]);
    expect(second.changedFiles).toEqual([]);
  });

  it("a late observation never overwrites a newer accepted record", () => {
    const ledger = new RevisionLedger(CONTEXT, scopeContextId(CONTEXT));
    ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m2", "d2", 5)]);
    // An observation that read the file earlier arrives afterwards.
    const late = ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m1", "d1", 3)]);
    expect(late.changedScopes).toEqual([]);
    expect(late.lateFiles).toEqual(["/p/config/semantic-layer/c/t.yaml"]);
    expect(ledger.get("/p/config/semantic-layer/c/t.yaml")?.digest).toBe("d2");
  });

  it("an overlay change invalidates D only; a Manifest change invalidates D and P", () => {
    const ledger = new RevisionLedger(CONTEXT, scopeContextId(CONTEXT));
    const overlay = ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m1", "d1", 1)]);
    expect(overlay.changedScopes).toEqual(["D"]);
    const manifest = ledger.commit([candidate("/p/config/semantic-layer/c/_schema/s.yaml", "m1", "d1", 2)]);
    expect(manifest.changedScopes).toEqual(["D", "P"]);
    const access = ledger.commit([candidate("/p/webui/config/access.yaml", "m1", "d1", 3)]);
    expect(access.changedScopes).toEqual(["P"]);
  });

  it("a confirmed final version is accepted without notifying", () => {
    const ledger = new RevisionLedger(CONTEXT, scopeContextId(CONTEXT));
    ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m1", "d1", 1)]);
    ledger.confirm([candidate("/p/config/semantic-layer/c/t.yaml", "m2", "d2", 9)]);
    const after = ledger.commit([candidate("/p/config/semantic-layer/c/t.yaml", "m2", "d2", 10)]);
    expect(after.changedScopes).toEqual([]);
  });
});

/**
 * Spec 195 §5.3 / SI-05 / SI-06 — a real write keeps its write-before and
 * write-after invalidation, and the final disk version is confirmed once the
 * outermost transaction ends, so the observer does not invalidate it again.
 */
describe("Spec 195 §5.3 — write transactions confirm the final version", () => {
  let projectRoot: string;
  const saved = { root: process.env.KTX_PROJECT_ROOT, content: process.env.LUCY_CONTENT_ROOT };

  const overlayRel = "semantic-layer/warehouse/fin_ledger.yaml";
  const overlayAbs = () => path.join(projectRoot, "semantic-layer", "warehouse", "fin_ledger.yaml");

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-display-revisions-"));
    await mkdir(path.join(projectRoot, "semantic-layer", "warehouse", "_schema"), { recursive: true });
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(projectRoot, "semantic-layer", "warehouse", "_schema", "fin.yaml"), "tables: {}\n", "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    process.env.KTX_PROJECT_ROOT = projectRoot;
    // The legacy layout keeps the semantic layer directly under the project
    // root, so the fixture paths are the ones the reconciler watches.
    process.env.LUCY_CONTENT_ROOT = ".";
    invalidateContentPathsCache();
    resetDisplayGenerationsForTests();
    resetDisplaySnapshotsForTests();
    await startDisplayReconciler({ metadataIntervalMs: 60_000, fullDigestIntervalMs: 60_000 });
  });

  afterEach(async () => {
    stopDisplayReconciler();
    if (saved.root === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = saved.root;
    if (saved.content === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = saved.content;
    invalidateContentPathsCache();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("SI-05 a real write keeps both invalidation edges and is not invalidated again", async () => {
    const paths = await loadContentPaths();
    const before = displayGenerations();
    await safeWriteAtomic(paths, projectRoot, overlayRel, "grain: [id]\n");
    const afterWrite = displayGenerations();
    // The write-before and write-after edges both advance the generation.
    expect(afterWrite.D).toBe(before.D + 2);
    expect(hasPendingDisplayWrite(["D"])).toBe(false);

    // The observer sees the same final version — no second invalidation.
    await reconcileMetadata();
    const afterMeta = displayGenerations();
    expect(afterMeta.D).toBe(afterWrite.D);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterWrite.D);
  });

  it("SI-05 a nested write is only confirmed when the outermost transaction ends", async () => {
    const paths = await loadContentPaths();
    await withDisplayWriteBarrier(["D"], async () => {
      await safeWriteAtomic(paths, projectRoot, overlayRel, "grain: [id]\n");
      // The inner barrier ended; the outer transaction still holds D pending,
      // so the observer must not publish anything while it is open.
      expect(hasPendingDisplayWrite(["D"])).toBe(true);
      const during = displayGenerations().D;
      await reconcileMetadata();
      expect(displayGenerations().D).toBe(during);
    });
    const afterTransaction = displayGenerations();
    await reconcileMetadata();
    expect(displayGenerations().D).toBe(afterTransaction.D);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterTransaction.D);
  });

  it("SI-05 a rename registers both ends and is not invalidated again", async () => {
    const paths = await loadContentPaths();
    await writeFile(overlayAbs(), "grain: [id]\n", "utf8");
    await reconcileMetadata();
    const before = displayGenerations();
    const staged = path.join(projectRoot, "semantic-layer", "warehouse", "staged.yaml");
    await writeFile(staged, "grain: [id, region]\n", "utf8");
    await safeWriteAtomic(paths, projectRoot, "semantic-layer/warehouse/staged.yaml", "grain: [id, region]\n");
    await rename(staged, overlayAbs());
    await reconcileMetadata();
    const afterMeta = displayGenerations();
    expect(afterMeta.D).toBeGreaterThan(before.D);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterMeta.D);
  });

  it("SI-06 a delete is registered and is not invalidated twice", async () => {
    const paths = await loadContentPaths();
    await writeFile(overlayAbs(), "grain: [id]\n", "utf8");
    await reconcileMetadata();
    const before = displayGenerations();
    await rm(overlayAbs());
    await reconcileMetadata();
    const afterDelete = displayGenerations();
    expect(afterDelete.D).toBeGreaterThan(before.D);
    await reconcileFullDigest();
    expect(displayGenerations().D).toBe(afterDelete.D);
  });
});
