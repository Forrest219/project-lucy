import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PUBLISH_COORDINATOR_LOCK_REL,
  PublishCoordinatorBusyError,
  acquirePublishCoordinatorLock,
  isInsidePublishCoordinator,
  isPublishCoordinatorBusy,
  readPublishCoordinatorLock,
  releasePublishCoordinatorLock,
  withPublishCoordinator,
  type PublishEntryKind
} from "../publish-coordinator.js";
import {
  SemanticRecoveryClosedError,
  createRecoveryJournal,
  isSemanticRecoveryAdmissionLatched,
  markRecoveryJournalActivationPending,
  markRecoveryJournalBlocked,
  markRecoveryJournalFilesSaved,
  recoverSemanticJournalsAtStartup,
  resetSemanticRecoveryAdmissionForTests
} from "../semantic-recovery-journal.js";

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
    resetSemanticRecoveryAdmissionForTests();
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

  it("does NOT reclaim a live holder just because the lock is old", async () => {
    // A long-running publish is still a live holder. Age alone must not let a
    // second writer into the critical section and overwrite its targets.
    const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeRawLock({
      kind: "batch_import",
      operationId: "long-running-run",
      acquiredAt: staleAt,
      pid: process.pid
    });

    await expect(
      withPublishCoordinator("manual_reindex", async () => "reclaimed", {
        projectRoot,
        staleAfterMs: 30 * 60 * 1000
      })
    ).rejects.toThrowError(PublishCoordinatorBusyError);

    const holder = await readPublishCoordinatorLock(projectRoot);
    expect(holder?.operationId).toBe("long-running-run");
  });

  it("reclaims a lock whose owning process no longer exists", async () => {
    // A crashed process leaves a lock behind. The pid is gone, so the lock is
    // reclaimed immediately — no waiting for the stale window.
    await writeRawLock({
      kind: "manual_reindex",
      operationId: "dead-pid-run",
      acquiredAt: new Date().toISOString(),
      pid: 2 ** 22
    });

    const result = await withPublishCoordinator(
      "manual_reindex",
      async () => "reclaimed-dead-pid",
      { projectRoot, staleAfterMs: 30 * 60 * 1000 }
    );

    expect(result).toBe("reclaimed-dead-pid");
  });

  it("reclaims an old lock whose owning process cannot be determined", async () => {
    // A lock written by a build that predates the pid field has no owner to
    // check; age is then the only available signal.
    const staleAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await writeRawLock({
      kind: "batch_import",
      operationId: "ownerless-run",
      acquiredAt: staleAt
    });

    const result = await withPublishCoordinator(
      "manual_reindex",
      async () => "reclaimed-ownerless",
      { projectRoot, staleAfterMs: 30 * 60 * 1000 }
    );

    expect(result).toBe("reclaimed-ownerless");
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
      withPublishCoordinator("manual_reindex", async () => "should-not-run", {
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

  it("releases only the lock with the same operationId", async () => {
    const { holder } = await acquirePublishCoordinatorLock(projectRoot, "batch_import", {}, {
      operationId: "op-ours"
    });
    await writeRawLock({
      kind: "batch_import",
      operationId: "op-theirs",
      acquiredAt: holder.acquiredAt,
      pid: process.pid
    });

    await releasePublishCoordinatorLock(projectRoot, holder);

    const current = await readPublishCoordinatorLock(projectRoot);
    expect(current?.operationId).toBe("op-theirs");
  });

  it("removes the lock when the operationId matches", async () => {
    const { holder } = await acquirePublishCoordinatorLock(projectRoot, "batch_import", {}, {
      operationId: "op-ours"
    });

    await releasePublishCoordinatorLock(projectRoot, holder);

    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });
});

// ─── REQ-0117 方向 2：发布窗口有界等待（仅 role_policy_save / agent_save） ───

describe("REQ-0117 bounded publish wait (role_policy_save / agent_save)", () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "lucy-req0117-wait-"));
  });

  afterEach(async () => {
    resetSemanticRecoveryAdmissionForTests();
    await rm(projectRoot, { recursive: true, force: true });
  });

  it("SC-02: an overlapping role_policy_save waits and completes when the holder releases within the budget", async () => {
    const first = withPublishCoordinator(
      "role_policy_save",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return "first";
      },
      { projectRoot }
    );
    const second = withPublishCoordinator(
      "role_policy_save",
      async () => "second",
      { projectRoot, wait: { budgetMs: 5000, pollIntervalMs: 20 } }
    );
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe("first");
    expect(secondResult).toBe("second");
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("SC-03: a wait past the budget is an honest refusal with retryAfterSeconds and the CURRENT holder", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPublishCoordinator(
      "agent_save",
      async () => {
        await gate;
      },
      { projectRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    let innerError: unknown = null;
    try {
      await withPublishCoordinator(
        "agent_save",
        async () => undefined,
        { projectRoot, wait: { budgetMs: 120, pollIntervalMs: 20, retryAfterSeconds: 5 } }
      );
    } catch (err) {
      innerError = err;
    }
    release();
    await first;

    expect(innerError).toBeInstanceOf(PublishCoordinatorBusyError);
    const busy = innerError as PublishCoordinatorBusyError;
    expect(busy.code).toBe("PUBLISH_COORDINATOR_BUSY");
    expect(busy.retryAfterSeconds).toBe(5);
    // 持有者信息重读锁文件获得（当前持有者 agent_save，而非候选 holder）
    expect(busy.holder).toMatchObject({ kind: "agent_save" });
    expect(busy.message).toContain("agent_save");
  });

  it("OQ-2: beyond maxWaiters=1 a third writer is refused immediately with retryAfterSeconds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPublishCoordinator(
      "role_policy_save",
      async () => {
        await gate;
      },
      { projectRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    // 第二个写进入有界等待（等待者 1/1）
    const second = withPublishCoordinator(
      "role_policy_save",
      async () => "second",
      { projectRoot, wait: { budgetMs: 8000, pollIntervalMs: 20 } }
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    const started = Date.now();
    let innerError: unknown = null;
    try {
      await withPublishCoordinator(
        "role_policy_save",
        async () => undefined,
        { projectRoot, wait: { budgetMs: 8000, pollIntervalMs: 20, retryAfterSeconds: 5 } }
      );
    } catch (err) {
      innerError = err;
    }
    const refusedAfterMs = Date.now() - started;
    release();
    await first;
    await expect(second).resolves.toBe("second");

    expect(innerError).toBeInstanceOf(PublishCoordinatorBusyError);
    expect((innerError as PublishCoordinatorBusyError).retryAfterSeconds).toBe(5);
    expect(refusedAfterMs).toBeLessThan(1000);
  });

  it("the seven other entry kinds keep busy-immediately (no queueing) while a role save waits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPublishCoordinator(
      "role_policy_save",
      async () => {
        await gate;
      },
      { projectRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const waiter = withPublishCoordinator(
      "role_policy_save",
      async () => "waiter",
      { projectRoot, wait: { budgetMs: 8000, pollIntervalMs: 20 } }
    );
    await new Promise((resolve) => setTimeout(resolve, 60));

    const started = Date.now();
    await expect(
      withPublishCoordinator("manifest_upload", async () => undefined, { projectRoot })
    ).rejects.toMatchObject({ code: "PUBLISH_COORDINATOR_BUSY" });
    expect(Date.now() - started).toBeLessThan(1000);

    release();
    await first;
    await expect(waiter).resolves.toBe("waiter");
  });

  it("stale-lock takeover inside the wait loop enters the critical section (no regression)", async () => {
    // 持有者已死：等待循环里的 acquire 按既有语义接管陈旧锁——无 stale 特判、无裸 break。
    await writeRawLock({
      kind: "role_policy_save",
      operationId: "dead-holder",
      acquiredAt: new Date().toISOString(),
      pid: 2 ** 22
    });

    const result = await withPublishCoordinator(
      "role_policy_save",
      async () => "took-over",
      { projectRoot, wait: { budgetMs: 2000, pollIntervalMs: 20 } }
    );
    expect(result).toBe("took-over");
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("SC-04: after a bounded wait acquires, the caller's own version check still rejects a same-object save", async () => {
    // 路由层的既有 fresh 读＋baseObjectVersion 校验不变；此处以同型断言证明等待成交后
    // 临界区内的版本校验错误原样抛出（409 族），不被等待路径吞掉。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPublishCoordinator(
      "role_policy_save",
      async () => {
        await gate;
      },
      { projectRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = withPublishCoordinator(
      "role_policy_save",
      async () => {
        throw Object.assign(new Error("配置已变化：目标对象版本不一致，请比较后重新预览"), {
          code: "VERSION_CONFLICT",
          statusCode: 409
        });
      },
      { projectRoot, wait: { budgetMs: 5000, pollIntervalMs: 20 } }
    );
    release();
    await first;

    await expect(second).rejects.toMatchObject({ code: "VERSION_CONFLICT", statusCode: 409 });
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("wait: false restores the busy-immediately contract for bounded kinds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withPublishCoordinator(
      "role_policy_save",
      async () => {
        await gate;
      },
      { projectRoot }
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    const started = Date.now();
    await expect(
      withPublishCoordinator("role_policy_save", async () => undefined, { projectRoot, wait: false })
    ).rejects.toMatchObject({ code: "PUBLISH_COORDINATOR_BUSY" });
    expect(Date.now() - started).toBeLessThan(1000);

    release();
    await first;
  });
});

describe("semantic recovery closes the shared write window", () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(tmpdir(), "lucy-publish-coord-"));
    resetSemanticRecoveryAdmissionForTests();
  });

  afterEach(async () => {
    resetSemanticRecoveryAdmissionForTests();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function openJournal(): Promise<string> {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel-gate",
      operationId: "op-gate",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{
        targetPath: "semantic-layer/demo.yaml",
        originalContent: "old\n",
        newContent: "new\n"
      }]
    });
    return journal.journalId;
  }

  async function expectWriteRefused(kind: PublishEntryKind): Promise<void> {
    let called = false;
    await expect(
      withPublishCoordinator(kind, async () => {
        called = true;
      }, { projectRoot })
    ).rejects.toBeInstanceOf(SemanticRecoveryClosedError);
    expect(called).toBe(false);
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  }

  it("refuses table save, manifest upload, and access writes during write_in_progress", async () => {
    await openJournal();
    const kinds: PublishEntryKind[] = [
      "semantic_table_save",
      "manifest_upload",
      "role_policy_save",
      "agent_save"
    ];
    for (const kind of kinds) {
      await expectWriteRefused(kind);
    }
  });

  it("refuses those writes while recovery_required is persisted", async () => {
    const journalId = await openJournal();
    await markRecoveryJournalBlocked(projectRoot, journalId, "needs a human");
    await expectWriteRefused("semantic_table_save");
    await expectWriteRefused("manifest_upload");
    await expectWriteRefused("role_policy_save");
  });

  it("keeps files_saved and activation_pending open for the next write", async () => {
    const saved = await openJournal();
    await markRecoveryJournalFilesSaved(projectRoot, saved);
    let savedCalled = false;
    await withPublishCoordinator("semantic_table_save", async () => {
      savedCalled = true;
    }, { projectRoot });
    expect(savedCalled).toBe(true);

    const pending = await openJournal();
    await markRecoveryJournalActivationPending(projectRoot, pending);
    let pendingCalled = false;
    await withPublishCoordinator("manifest_upload", async () => {
      pendingCalled = true;
    }, { projectRoot });
    expect(pendingCalled).toBe(true);
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("keeps single-table save, manifest upload, batch import, and role save busy while the window is held", async () => {
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      markAcquired = resolve;
    });

    const holder = withPublishCoordinator(
      "semantic_table_save",
      async () => {
        markAcquired();
        await gate;
      },
      { projectRoot }
    );
    await acquired;

    const kinds: Array<PublishEntryKind | { kind: PublishEntryKind; wait: false }> = [
      "semantic_table_save",
      "manifest_upload",
      "batch_import",
      // REQ-0117：role_policy_save 现在对重叠持有者做有界等待；其「忙即拒绝」语义
      // 由 `wait: false` 显式还原（有界等待本身的合同在 REQ-0117 专属用例里覆盖）。
      { kind: "role_policy_save", wait: false }
    ];
    for (const entry of kinds) {
      const kind = typeof entry === "string" ? entry : entry.kind;
      const extra = typeof entry === "string" ? {} : { wait: entry.wait };
      await expect(
        withPublishCoordinator(kind, async () => undefined, { projectRoot, ...extra })
      ).rejects.toMatchObject({ code: "PUBLISH_COORDINATOR_BUSY" });
    }

    releaseFirst();
    await holder;
    expect(await readPublishCoordinatorLock(projectRoot)).toBeNull();
  });

  it("latches admission when startup recovery cannot read the journal directory", async () => {
    const journals = path.join(projectRoot, ".ktx-ui", "semantic-recovery-journals");
    await mkdir(path.dirname(journals), { recursive: true });
    await writeFile(journals, "not-a-directory", "utf8");

    expect(isSemanticRecoveryAdmissionLatched()).toBe(false);
    await expect(recoverSemanticJournalsAtStartup(projectRoot)).resolves.toBeNull();
    expect(isSemanticRecoveryAdmissionLatched()).toBe(true);

    await expectWriteRefused("semantic_table_save");
    await expectWriteRefused("role_policy_save");
  });
});
