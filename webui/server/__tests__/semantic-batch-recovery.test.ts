// Lucy v0.25 — D16/D17: the write recovery journal and the failure restore.
//
// Coverage:
//  - The journal is persisted BEFORE any write and records the original
//    bytes / absent marker, the expected new digest and the processing order.
//  - A replacement is atomic (temp file in the same directory + rename).
//  - The restore walks the journal in REVERSE order and puts back only the
//    targets this batch changed.
//  - A target whose content is neither the old nor the new digest is NOT
//    overwritten; the batch is marked `recoveryRequired`.
//  - Startup recovery decides from the actual bytes and never guesses
//    "success" for an undecidable state.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  atomicReplaceTarget,
  completeRecoveryJournal,
  createRecoveryJournal,
  isRecoveryRequired,
  listOpenRecoveryJournals,
  markRecoveryEntryApplied,
  markRecoveryJournalFilesSaved,
  readRecoveryJournal,
  recoverPendingRecoveryJournals,
  restoreRecoveryJournal,
  semanticReadHintsFromArgs,
  semanticRecoveryReadBlock
} from "../semantic-recovery-journal";

let projectRoot: string;
let previousContentRoot: string | undefined;

const TARGET_A = "semantic-layer/shop-db/a.yaml";
const TARGET_B = "semantic-layer/shop-db/b.yaml";

async function writeFileAt(relPath: string, content: string): Promise<void> {
  const abs = path.join(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

async function readFileAt(relPath: string): Promise<string | null> {
  try {
    return await readFile(path.join(projectRoot, relPath), "utf8");
  } catch {
    return null;
  }
}

beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-v025-journal-"));
  await writeFileAt(TARGET_A, "name: a\n");
  await writeFileAt(TARGET_B, "name: b\n");
});

afterEach(async () => {
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
});

describe("D16 recovery journal", () => {
  it("records the original bytes, the expected digest and the order", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [
        { targetPath: TARGET_A, newContent: "name: a2\n" },
        { targetPath: TARGET_B, newContent: "name: b2\n" }
      ]
    });

    expect(journal.status).toBe("open");
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[0]?.order).toBe(0);
    expect(journal.entries[0]?.originalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(journal.entries[0]?.expectedNewDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(journal.entries[0]?.originalBase64).toBeTruthy();
    expect(journal.entries[0]?.originalDigest).not.toBe(journal.entries[0]?.expectedNewDigest);

    const stored = await readRecoveryJournal(projectRoot, journal.journalId);
    expect(stored?.entries).toHaveLength(2);
  });

  it("records the absent marker for a target that does not exist yet", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: "semantic-layer/shop-db/new.yaml", newContent: "name: new\n" }]
    });

    expect(journal.entries[0]?.originalBase64).toBeNull();
    expect(journal.entries[0]?.originalDigest).toBeNull();
  });

  it("records the applied order after each replacement", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });

    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");
    const updated = await markRecoveryEntryApplied(projectRoot, journal.journalId, 0);
    expect(updated?.applied).toEqual([0]);
    expect(updated?.status).toBe("open");
  });

  it("completes the journal when the batch succeeded", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });
    const completed = await completeRecoveryJournal(projectRoot, journal.journalId);
    expect(completed?.status).toBe("completed");
    expect(await listOpenRecoveryJournals(projectRoot)).toHaveLength(0);
  });

  it("writes a target atomically", async () => {
    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");
    expect(await readFileAt(TARGET_A)).toBe("name: a2\n");
  });
});

// ─── D-23：即时恢复不得只信 applied 列表 ───────────────────────────────────
//
// 缺陷：applied 的标记写在 rename **之后**。若 rename 成功而标记写入失败，
// 目标已被替换却不在 applied 里 —— 只遍历 applied 的即时恢复会漏回滚它，
// 并且因为 recoveryRequired 仍为 false 而误报 status=restored。
// 修法：即时恢复遍历日志的**全部 entry**，判定一律按实际字节。
describe("D-23 immediate restore must not only trust the applied list", () => {
  it("写入已落地但 applied 标记丢失时，即时恢复必须回滚", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [
        { targetPath: TARGET_A, newContent: "name: a2\n" },
        { targetPath: TARGET_B, newContent: "name: b2\n" }
      ]
    });

    // TARGET_A：正常流程（写入 + 标记 applied）。
    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");
    await markRecoveryEntryApplied(projectRoot, journal.journalId, 0);
    // TARGET_B：写入已落地，但**标记 applied 失败**（模拟磁盘/进程故障）。
    await atomicReplaceTarget(projectRoot, TARGET_B, "name: b2\n");
    expect((await readRecoveryJournal(projectRoot, journal.journalId))?.applied).toEqual([0]);

    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);
    expect(result?.status).toBe("restored");
    expect(result?.recoveryRequired).toBe(false);
    // 两个目标都必须回到原始内容 —— B 不能被漏掉。
    expect(result?.restored.sort()).toEqual([TARGET_A, TARGET_B].sort());
    expect(await readFileAt(TARGET_A)).toBe("name: a\n");
    expect(await readFileAt(TARGET_B)).toBe("name: b\n");
  });

  it("写入从未落地的目标不算异常，也不算已恢复", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });
    // 从未写入 → 目标仍是原始内容。
    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);
    expect(result?.status).toBe("restored");
    expect(result?.recoveryRequired).toBe(false);
    expect(result?.skipped).toEqual([]);
    expect(result?.restored).toEqual([]);
    expect(await readFileAt(TARGET_A)).toBe("name: a\n");
  });
});

describe("D17 failure restore", () => {
  it("restores the targets this batch changed, in reverse order", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [
        { targetPath: TARGET_A, newContent: "name: a2\n" },
        { targetPath: TARGET_B, newContent: "name: b2\n" }
      ]
    });

    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");
    await markRecoveryEntryApplied(projectRoot, journal.journalId, 0);
    await atomicReplaceTarget(projectRoot, TARGET_B, "name: b2\n");
    await markRecoveryEntryApplied(projectRoot, journal.journalId, 1);

    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);
    expect(result?.status).toBe("restored");
    expect(result?.recoveryRequired).toBe(false);
    expect(result?.restored.sort()).toEqual([TARGET_A, TARGET_B].sort());
    expect(await readFileAt(TARGET_A)).toBe("name: a\n");
    expect(await readFileAt(TARGET_B)).toBe("name: b\n");
  });

  it("removes a file that the batch created", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: "semantic-layer/shop-db/new.yaml", newContent: "name: new\n" }]
    });

    await atomicReplaceTarget(projectRoot, "semantic-layer/shop-db/new.yaml", "name: new\n");
    await markRecoveryEntryApplied(projectRoot, journal.journalId, 0);

    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);
    expect(result?.status).toBe("restored");
    expect(await readFileAt("semantic-layer/shop-db/new.yaml")).toBeNull();
  });

  it("refuses to overwrite a third party's content and marks recovery required", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });

    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");
    await markRecoveryEntryApplied(projectRoot, journal.journalId, 0);
    // Somebody else writes here in the meantime.
    await writeFileAt(TARGET_A, "name: third-party\n");

    const result = await restoreRecoveryJournal(projectRoot, journal.journalId);
    expect(result?.status).toBe("recovery_required");
    expect(result?.recoveryRequired).toBe(true);
    expect(result?.skipped).toEqual([TARGET_A]);
    expect(await readFileAt(TARGET_A)).toBe("name: third-party\n");
    expect(await isRecoveryRequired(projectRoot)).toBe(true);
  });
});

describe("D17 startup recovery", () => {  it("rolls back a write whose journal update was lost", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });

    // The rename happened, the journal update did not.
    await atomicReplaceTarget(projectRoot, TARGET_A, "name: a2\n");

    const outcome = await recoverPendingRecoveryJournals(projectRoot);
    expect(outcome.recovered).toContain(journal.journalId);
    expect(outcome.needsRepair).toHaveLength(0);
    expect(await readFileAt(TARGET_A)).toBe("name: a\n");
  });

  it("does nothing when the write never landed", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });

    const outcome = await recoverPendingRecoveryJournals(projectRoot);
    expect(outcome.recovered).toContain(journal.journalId);
    expect(await readFileAt(TARGET_A)).toBe("name: a\n");
  });

  it("asks for manual repair when the state cannot be decided", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{ targetPath: TARGET_A, newContent: "name: a2\n" }]
    });

    await writeFileAt(TARGET_A, "name: somebody-else\n");

    const outcome = await recoverPendingRecoveryJournals(projectRoot);
    expect(outcome.needsRepair).toContain(journal.journalId);
    expect(outcome.recovered).toHaveLength(0);
    expect(await readFileAt(TARGET_A)).toBe("name: somebody-else\n");
    expect(await isRecoveryRequired(projectRoot)).toBe(true);
  });
});

// ─── D-16：恢复目录读失败不得被当成「没有恢复任务」 ────────────────────────
//
// 缺陷：listOpenRecoveryJournals 曾用 `readdir(dir).catch(() => [])`，
// 于是 EACCES / EIO 等读取故障被吞成「空列表」→ isRecoveryRequired() 返回
// false → 恢复闸门静默失效，发布与手动索引会在未核验的目标上继续跑。
// 修法：只有 ENOENT（目录不存在 = 确实没有恢复任务）才当作空；其余错误传播，
// 调用方对异常一律按拒绝处理（失败关闭）。
describe("D-16 recovery journal directory read failures", () => {
  it("目录不存在时视为没有恢复任务", async () => {
    // 全新工程没有 .ktx-ui/semantic-recovery-journals —— 这是正常的「没有」。
    expect(await isRecoveryRequired(projectRoot)).toBe(false);
    expect(await listOpenRecoveryJournals(projectRoot)).toEqual([]);
  });

  it("目录不可读（非 ENOENT）时传播错误，不得返回 false", async () => {
    // 用「目录位置放一个普通文件」制造 ENOTDIR：它不是 ENOENT，必须传播。
    const dir = path.join(projectRoot, ".ktx-ui", "semantic-recovery-journals");
    await mkdir(path.dirname(dir), { recursive: true });
    await writeFile(dir, "not a directory\n", "utf8");

    await expect(isRecoveryRequired(projectRoot)).rejects.toThrow();
    await expect(listOpenRecoveryJournals(projectRoot)).rejects.toThrow();
  });
});

describe("D3 semantic recovery admission", () => {
  it("closes publish on an ordinary in-progress journal and opens it once the files are saved", async () => {
    const journal = await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{
        targetPath: TARGET_A,
        identity: { connectionId: "shop-db", schema: "public", table: "a" },
        newContent: "name: a2\n"
      }]
    });
    expect(await isRecoveryRequired(projectRoot)).toBe(true);

    await markRecoveryJournalFilesSaved(projectRoot, journal.journalId);
    expect(await isRecoveryRequired(projectRoot)).toBe(false);
  });

  it("closes a Lucy read of the affected asset and leaves a different asset open", async () => {
    await createRecoveryJournal(projectRoot, {
      releaseId: "rel_1",
      operationId: "op_1",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{
        targetPath: TARGET_A,
        identity: { connectionId: "shop-db", schema: "public", table: "a" },
        newContent: "name: a2\n"
      }]
    });

    const blocked = await semanticRecoveryReadBlock(projectRoot, ["shop-db.public.a"]);
    expect(blocked?.code).toBe("semantic_recovery_required");

    const sameConnection = await semanticRecoveryReadBlock(projectRoot, ["shop-db"]);
    expect(sameConnection?.code).toBe("semantic_recovery_required");

    const other = await semanticRecoveryReadBlock(projectRoot, ["shop-db.public.b"]);
    expect(other).toBeNull();

    const unnamed = await semanticRecoveryReadBlock(projectRoot, []);
    expect(unnamed?.code).toBe("semantic_recovery_required");
  });

  it("reads the source qualifier out of a measure and an order_by field", () => {
    expect(semanticReadHintsFromArgs({
      connectionId: "shop-db",
      measures: ["shop-db.public.a.revenue"],
      order_by: [{ field: "shop-db.public.a.dt", direction: "asc" }]
    })).toEqual(expect.arrayContaining(["shop-db", "shop-db.public.a"]));
  });

  it("closes a read when the connection id itself contains a dot", async () => {
    await createRecoveryJournal(projectRoot, {
      releaseId: "rel_2",
      operationId: "op_2",
      actor: "admin-a",
      instanceId: "inst-a",
      targets: [{
        targetPath: TARGET_A,
        identity: { connectionId: "mysql.aliyun", schema: "public", table: "a" },
        newContent: "name: a2\n"
      }]
    });

    const blocked = await semanticRecoveryReadBlock(
      projectRoot,
      semanticReadHintsFromArgs({
        connectionId: "mysql.aliyun",
        measures: ["other.revenue"]
      })
    );
    expect(blocked?.code).toBe("semantic_recovery_required");
  });
});
