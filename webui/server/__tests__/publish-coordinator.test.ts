import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PUBLISH_COORDINATOR_LOCK_REL,
  PublishCoordinatorBusyError,
  isInsidePublishCoordinator,
  isPublishCoordinatorBusy,
  readPublishCoordinatorLock,
  withPublishCoordinator
} from "../publish-coordinator.js";

let projectRoot: string;

async function writeRawLock(payload: Record<string, unknown>): Promise<void> {
  const abs = path.resolve(projectRoot, PUBLISH_COORDINATOR_LOCK_REL);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, JSON.stringify(payload), "utf8");
}

describe("shared single-instance publish coordinator", () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "lucy-publish-coord-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("holds the publish window while the critical section runs and releases it afterwards", async () => {
    let observedHolder: unknown = null;

    await withPublishCoordinator(
      "role_policy_save",
      async () => {
        observedHolder = await readPublishCoordinatorLock(projectRoot);
        expect(isInsidePublishCoordinator()).toBe(true);
      },
      { projectRoot }
    );

    expect(observedHolder).toMatchObject({ kind: "role_policy_save", pid: process.pid });
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
    expect(isInsidePublishCoordinator()).toBe(false);
  });

  it("returns a readable busy error instead of silently queueing a competing write", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });

    const first = withPublishCoordinator(
      "batch_import",
      async () => {
        markAcquired();
        await gate;
      },
      { projectRoot }
    );
    await acquired;

    let innerError: unknown = null;
    try {
      await withPublishCoordinator("manual_reindex", async () => undefined, { projectRoot });
    } catch (err) {
      innerError = err;
    }
    releaseFirst();
    await first;

    expect(innerError).toBeInstanceOf(PublishCoordinatorBusyError);
    const busy = innerError as PublishCoordinatorBusyError;
    expect(busy.code).toBe("PUBLISH_COORDINATOR_BUSY");
    expect(busy.holder).toMatchObject({ kind: "batch_import" });
    expect(busy.message).toContain("batch_import");
  });

  it("serializes different write entry points against each other", async () => {
    const order: string[] = [];

    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });

    const first = withPublishCoordinator(
      "semantic_table_save",
      async () => {
        markAcquired();
        order.push("table_save:start");
        await gate;
        order.push("table_save:end");
      },
      { projectRoot }
    );
    await acquired;

    const second = withPublishCoordinator(
      "manifest_upload",
      async () => {
        order.push("manifest:start");
        order.push("manifest:end");
      },
      { projectRoot }
    ).catch((err) => {
      order.push(`manifest:busy:${(err as PublishCoordinatorBusyError).code}`);
    });

    await second;
    releaseFirst();
    await first;

    expect(order[0]).toBe("table_save:start");
    expect(order).toContain("manifest:busy:PUBLISH_COORDINATOR_BUSY");
    expect(order).not.toContain("manifest:start");
  });

  it("is re-entrant so a nested coordinated call cannot deadlock on itself", async () => {
    const result = await withPublishCoordinator(
      "batch_import",
      async () =>
        withPublishCoordinator("semantic_table_save", async () => "nested-ok", { projectRoot }),
      { projectRoot }
    );

    expect(result).toBe("nested-ok");
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("releases the publish window when the critical section throws", async () => {
    await expect(
      withPublishCoordinator(
        "batch_import",
        async () => {
          throw new Error("publish failed");
        },
        { projectRoot }
      )
    ).rejects.toThrow("publish failed");

    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("reclaims a lock abandoned by a crashed process once it goes stale", async () => {
    const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeRawLock({
      kind: "batch_import",
      operationId: "crashed-run",
      acquiredAt: staleAt,
      pid: process.pid
    });

    const result = await withPublishCoordinator(
      "role_policy_save",
      async () => "reclaimed",
      { projectRoot, staleAfterMs: 30 * 60 * 1000 }
    );

    expect(result).toBe("reclaimed");
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("reclaims a lock whose owning process no longer exists", async () => {
    await writeRawLock({
      kind: "manual_reindex",
      operationId: "dead-pid-run",
      acquiredAt: new Date().toISOString(),
      pid: 2 ** 22
    });

    const result = await withPublishCoordinator(
      "role_policy_save",
      async () => "reclaimed-dead-pid",
      { projectRoot, staleAfterMs: 30 * 60 * 1000 }
    );

    expect(result).toBe("reclaimed-dead-pid");
  });

  it("reports busy for a lock held by a live foreign process", async () => {
    // pid 1 always exists; a lock stamped with it is not ours and not stale.
    await writeRawLock({
      kind: "manifest_upload",
      operationId: "other-instance",
      acquiredAt: new Date().toISOString(),
      pid: 1
    });

    await expect(
      withPublishCoordinator("role_policy_save", async () => "should-not-run", {
        projectRoot,
        staleAfterMs: 30 * 60 * 1000
      })
    ).rejects.toBeInstanceOf(PublishCoordinatorBusyError);

    const busy = await isPublishCoordinatorBusy(projectRoot);
    expect(busy.busy).toBe(true);
    expect(busy.holder).toMatchObject({ kind: "manifest_upload" });

    // The foreign lock is left untouched.
    const raw = JSON.parse(
      await readFile(path.resolve(projectRoot, PUBLISH_COORDINATOR_LOCK_REL), "utf8")
    ) as { operationId: string };
    expect(raw.operationId).toBe("other-instance");
  });

  it("does not treat an absent lock as busy", async () => {
    expect(await isPublishCoordinatorBusy(projectRoot)).toEqual({ busy: false, holder: null });
  });
});
