// Spec `lucy-20261030-publish-workbench-three-column-spec.md` §5 — the publish
// workbench pending state.
//
// Coverage:
//  - The pending list is the difference between the CURRENT author content and
//    the last content version with proven sync evidence — not a Git diff.
//  - A missing baseline is "first verification", never "everything published".
//  - A confirmed sync removes the content from the pending list even when the
//    working tree is still dirty (there is no Git here at all).
//  - Deletion, an empty file and a missing file are three different states.
//  - Internal files (editing history, caches, AppleDouble, temp files) never
//    enter the pending list.
//  - The baseline advance is a compare-and-swap on the generation.
//  - A damaged baseline or a changed content-root binding is
//    `needs_verification`, never an inferred "published".
//  - The consumption snapshot is captured BEFORE the index reads the content,
//    and a drift between capture and commit is reported.

import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  advancePublishBaseline,
  capturePublishConsumption,
  computePendingDigest,
  detectPublishConsumptionDrift,
  listPublishAttempts,
  PUBLISH_BASELINE_REL,
  PUBLISH_WORKBENCH_STATE_DIR_REL,
  PublishBaselineConflictError,
  readPublishBaseline,
  readPublishPendingSnapshot,
  readPublishBlob,
  scanPublishContent,
  writePublishAttempt,
  writePublishBlob,
  type PublishAttempt
} from "../publish-workbench-state";

let projectRoot: string;
let previousContentRoot: string | undefined;

async function writeContent(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function removeContent(relPath: string): Promise<void> {
  await rm(path.join(projectRoot, relPath), { force: true });
}

/**
 * Commit the current content as the proven baseline, in the production order:
 * capture the content (which stores the baseline's raw bytes) and only then
 * advance the pointer. A baseline that points at a blob nobody kept is not a
 * usable baseline, so the advance refuses it.
 */
async function commitBaseline(expectedGeneration: number): Promise<void> {
  const capture = await capturePublishConsumption(projectRoot);
  await advancePublishBaseline(projectRoot, {
    expectedGeneration,
    files: capture.files
  });
}

const OVERLAY = `name: orders
grain:
  - order_id
measures:
  - name: total
    expr: sum(amount)
`;

const MANIFEST = `tables:
  orders:
    table: chatbi.orders
    columns:
      - name: order_id
        type: string
`;

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-state-"));
  process.env.LUCY_CONTENT_ROOT = ".";
  await mkdir(path.join(projectRoot, "semantic-layer", "customer-db", "_schema"), {
    recursive: true
  });
  await mkdir(path.join(projectRoot, "wiki"), { recursive: true });
  await writeContent("semantic-layer/customer-db/_schema/chatbi.yaml", MANIFEST);
  await writeContent("semantic-layer/customer-db/orders.yaml", OVERLAY);
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) {
    await rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("publish workbench pending snapshot", () => {
  it("reports every business file as pending on first verification, not as published", async () => {
    const snapshot = await readPublishPendingSnapshot(projectRoot);

    expect(snapshot.baselineState).toBe("uninitialized");
    expect(snapshot.baselineGeneration).toBe(0);
    expect(snapshot.complete).toBe(true);
    expect(snapshot.changes.map((change) => change.logicalPath)).toEqual([
      "semantic-layer/customer-db/_schema/chatbi.yaml",
      "semantic-layer/customer-db/orders.yaml"
    ]);
    expect(snapshot.changes.every((change) => change.firstVerification)).toBe(true);
  });

  it("does not depend on Git: a confirmed sync clears the pending list while the tree stays dirty", async () => {
    const first = await readPublishPendingSnapshot(projectRoot);
    const files = Object.fromEntries(
      first.currentFiles.map((file) => [file.logicalPath, file.digest])
    );

    await commitBaseline(0);
    const baseline = await readPublishBaseline(projectRoot);
    expect(baseline?.generation).toBe(1);

    const afterSync = await readPublishPendingSnapshot(projectRoot);
    expect(afterSync.baselineState).toBe("ready");
    expect(afterSync.changes).toHaveLength(0);

    // The same content, still on disk, still uncommitted: nothing is pending.
    expect(afterSync.currentFiles.length).toBe(2);
  });

  it("brings a file back into the pending list when it is modified again", async () => {
    await commitBaseline(0);

    await writeContent("semantic-layer/customer-db/orders.yaml", `${OVERLAY}segments: []\n`);
    const snapshot = await readPublishPendingSnapshot(projectRoot);

    expect(snapshot.changes).toHaveLength(1);
    expect(snapshot.changes[0]?.logicalPath).toBe("semantic-layer/customer-db/orders.yaml");
    expect(snapshot.changes[0]?.changeType).toBe("modified");
    expect(snapshot.changes[0]?.baselineDigest).toBeTruthy();
  });

  it("distinguishes a deletion from an empty file and from a missing file", async () => {
    await commitBaseline(0);

    await removeContent("semantic-layer/customer-db/orders.yaml");
    await writeContent("semantic-layer/customer-db/empty.yaml", "");

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const deleted = snapshot.changes.find(
      (change) => change.logicalPath === "semantic-layer/customer-db/orders.yaml"
    );
    const empty = snapshot.changes.find(
      (change) => change.logicalPath === "semantic-layer/customer-db/empty.yaml"
    );

    expect(deleted?.changeType).toBe("deleted");
    expect(deleted?.currentDigest).toBeNull();
    expect(deleted?.baselineDigest).toBeTruthy();
    // An empty file is present with a real digest — not the same as absent.
    expect(empty?.changeType).toBe("added");
    expect(empty?.currentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps internal files out of the pending list", async () => {
    await writeContent("wiki/.lucy-history/index.json", "{}\n");
    await writeContent("wiki/.lucy-directories.json", "{}\n");
    await writeContent("wiki/.DS_Store", "junk");
    await writeContent("wiki/._orders.md", "junk");
    await writeContent("wiki/orders.md~", "junk");
    await writeContent("wiki/real.md", "# 业务说明\n");

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    const paths = snapshot.changes.map((change) => change.logicalPath);

    expect(paths).toContain("wiki/real.md");
    expect(paths).not.toContain("wiki/.lucy-history/index.json");
    expect(paths).not.toContain("wiki/.lucy-directories.json");
    expect(paths).not.toContain("wiki/.DS_Store");
    expect(paths).not.toContain("wiki/._orders.md");
    expect(paths).not.toContain("wiki/orders.md~");
  });

  it("excludes a symlink that could point outside the content root", async () => {
    const outside = path.join(projectRoot, "outside.md");
    await writeFile(outside, "# outside\n", "utf8");
    await symlink(outside, path.join(projectRoot, "wiki", "link.md"));

    const scan = await scanPublishContent(projectRoot);
    expect(scan.files.some((file) => file.logicalPath === "wiki/link.md")).toBe(false);
    expect(
      scan.excluded.some((entry) => entry.logicalPath === "wiki/link.md" && entry.reason === "symlink")
    ).toBe(true);
  });

  it("refuses to advance the baseline when the generation moved", async () => {
    await commitBaseline(0);
    const capture = await capturePublishConsumption(projectRoot);

    await expect(
      advancePublishBaseline(projectRoot, {
        expectedGeneration: 0,
        files: capture.files
      })
    ).rejects.toBeInstanceOf(PublishBaselineConflictError);
  });

  it("reports a damaged baseline as needs_verification instead of inferring published", async () => {
    await writeContent(PUBLISH_BASELINE_REL, "{ not json");

    const snapshot = await readPublishPendingSnapshot(projectRoot);
    expect(snapshot.baselineState).toBe("needs_verification");
    expect(snapshot.complete).toBe(false);
    expect(snapshot.changes).toHaveLength(0);
  });

  it("reports a changed content-root binding as needs_verification", async () => {
    await commitBaseline(0);

    const otherRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-pwb-other-"));
    try {
      process.env.LUCY_CONTENT_ROOT = otherRoot;
      const snapshot = await readPublishPendingSnapshot(projectRoot);
      expect(snapshot.baselineState).toBe("needs_verification");
      expect(snapshot.complete).toBe(false);
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("keeps the state directory private (0700 dir, 0600 files)", async () => {
    await commitBaseline(0);

    const dirInfo = await stat(path.join(projectRoot, PUBLISH_WORKBENCH_STATE_DIR_REL));
    expect(dirInfo.mode & 0o777).toBe(0o700);
    const fileInfo = await stat(path.join(projectRoot, PUBLISH_BASELINE_REL));
    expect(fileInfo.mode & 0o777).toBe(0o600);
  });

  it("computes a stable digest for the same content and a different one after a change", async () => {
    const first = await readPublishPendingSnapshot(projectRoot);
    const same = await readPublishPendingSnapshot(projectRoot);
    expect(same.pendingDigest).toBe(first.pendingDigest);

    await writeContent("semantic-layer/customer-db/orders.yaml", `${OVERLAY}\n# touched\n`);
    const changed = await readPublishPendingSnapshot(projectRoot);
    expect(changed.pendingDigest).not.toBe(first.pendingDigest);
  });

  it("changes the digest when the baseline generation moves", async () => {
    const first = await readPublishPendingSnapshot(projectRoot);
    const manual = computePendingDigest(0, first.currentFiles);
    expect(first.pendingDigest).toBe(manual);
    expect(computePendingDigest(1, first.currentFiles)).not.toBe(manual);
  });
});

describe("publish workbench baseline blobs", () => {
  it("verifies the digest before storing a blob and reads the same bytes back", async () => {
    const bytes = Buffer.from("# 中文标题\ncontent\n", "utf8");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(bytes).digest("hex");

    await writePublishBlob(projectRoot, digest, bytes);
    const read = await readPublishBlob(projectRoot, digest);
    expect(read).not.toBeNull();
    expect(read?.toString("utf8")).toBe("# 中文标题\ncontent\n");

    await expect(
      writePublishBlob(projectRoot, digest, Buffer.from("different", "utf8"))
    ).rejects.toThrow(/摘要校验失败/);
  });
});

describe("publish workbench consumption snapshot", () => {
  it("captures the content BEFORE the index reads it and reports later drift", async () => {
    const captured = await capturePublishConsumption(projectRoot);
    expect(captured.baselineGeneration).toBe(0);
    expect(Object.keys(captured.files)).toContain("semantic-layer/customer-db/orders.yaml");

    // A change lands while the index is running.
    await writeContent("semantic-layer/customer-db/orders.yaml", `${OVERLAY}\n# late edit\n`);

    const drift = await detectPublishConsumptionDrift(projectRoot, captured);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.logicalPath).toBe("semantic-layer/customer-db/orders.yaml");
    expect(drift[0]?.reason).toBe("changed_during_index");
  });

  it("reports no drift when the content is unchanged", async () => {
    const captured = await capturePublishConsumption(projectRoot);
    const drift = await detectPublishConsumptionDrift(projectRoot, captured);
    expect(drift).toEqual([]);
  });

  it("records a removal that lands during the index", async () => {
    const captured = await capturePublishConsumption(projectRoot);
    await removeContent("semantic-layer/customer-db/orders.yaml");
    const drift = await detectPublishConsumptionDrift(projectRoot, captured);
    expect(drift.some((entry) => entry.reason === "removed_during_index")).toBe(true);
  });
});

describe("publish workbench attempts", () => {
  it("round-trips an attempt record", async () => {
    const attempt: PublishAttempt = {
      version: 1,
      attemptId: "att_1",
      startedAt: "2026-10-30T00:00:00.000Z",
      status: "prepared",
      expectedBaselineGeneration: 0,
      consumedDigest: "d1",
      consumedFiles: { "semantic-layer/customer-db/orders.yaml": "abc" }
    };
    await writePublishAttempt(projectRoot, attempt);
    const stored = await listPublishAttempts(projectRoot);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.attemptId).toBe("att_1");
    expect(stored[0]?.status).toBe("prepared");
  });
});
