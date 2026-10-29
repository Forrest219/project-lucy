/**
 * Lucy v0.25 — the write recovery journal.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §7.2 (commit contract, recovery), §10 V14 / V15, and §11 D16 / D17.
 *
 * ── The contract ───────────────────────────────────────────────────────────
 * Before a single formal file is written, the batch persists a journal that
 * records, for EVERY actual target:
 *   - the original bytes (or the explicit "absent" marker),
 *   - the digest of the expected new content,
 *   - the processing order.
 *
 * Each replacement re-verifies the baseline of its own target first, writes
 * through a temporary file in the SAME directory and renames it over the
 * target, and then updates the journal. If anything fails, the journal is
 * the evidence that lets the batch be rolled back.
 *
 * ── Restore (D17) ──────────────────────────────────────────────────────────
 * The restore walks the journal in REVERSE order and puts back only the
 * targets this batch changed. It never triggers a reindex and never touches
 * unrelated disk changes. When the current bytes of a target are neither the
 * old nor the new digest, a third party wrote there: the restore refuses to
 * overwrite it and marks `recoveryRequired = true`, which blocks further
 * publishing and manual reindexing until a human verified the state.
 *
 * ── Startup recovery (capability for D18) ──────────────────────────────────
 * {@link recoverPendingRecoveryJournals} decides what happened by comparing
 * the ACTUAL bytes with the old and the new digest. When the outcome cannot
 * be proven, the state is recorded as "needs manual repair" — never as
 * "success".
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { syncContentToProjectRoot } from "./content-mirror";
import { resolveContentPaths } from "./paths";
import type { SemanticTableIdentity } from "./semantic-identity";

const JOURNALS_DIR_REL = ".ktx-ui/semantic-recovery-journals";

/**
 * Process-local fail-closed latch. Set when a recovery journal cannot be
 * marked `recovery_required` on disk. Reads and publishes stay closed until
 * the process restarts and startup recovery classifies the bytes again.
 */
let semanticRecoveryAdmissionLatched = false;

export function latchSemanticRecoveryAdmission(): void {
  semanticRecoveryAdmissionLatched = true;
}

export function isSemanticRecoveryAdmissionLatched(): boolean {
  return semanticRecoveryAdmissionLatched;
}

export type RecoveryJournalStatus =
  | "open"
  | "restored"
  | "recovery_required"
  | "completed";

/**
 * The phase of a journal (Lucy v0.25 / L25-11 §7.2).
 *
 * The phase decides what a startup recovery is ALLOWED to do:
 *
 *   - `write_in_progress` — the batch was still writing. A startup recovery
 *     rolls the written targets back, because the batch never finished.
 *   - `files_saved` — every target was written, but the index / terminal
 *     outcome is not proven. A startup recovery MUST NOT roll back merely
 *     because the index outcome is unknown: it keeps the files, verifies them
 *     against the saved plan and leaves the activation unconfirmed.
 *   - `activation_pending` — the files are saved and verified; the terminal
 *     evidence is still missing. Same rule as `files_saved`.
 *   - `completed` — every applicable evidence is durable; nothing to recover.
 */
export type RecoveryJournalPhase =
  | "write_in_progress"
  | "files_saved"
  | "activation_pending"
  | "completed";

export interface RecoveryJournalEntry {
  /** Processing order. Restore walks this in reverse. */
  order: number;
  /** Project-root-relative target path. */
  targetPath: string;
  /** The table identity that owns the target, when it is an overlay. */
  identity?: SemanticTableIdentity;
  /** The original bytes (base64), or null when the target did not exist. */
  originalBase64: string | null;
  /** Digest of the original content, or null when the target was absent. */
  originalDigest: string | null;
  /** Digest of the content the batch intends to write. */
  expectedNewDigest: string;
}

export interface RecoveryJournal {
  version: 1;
  journalId: string;
  releaseId: string;
  operationId: string;
  actor: string;
  instanceId: string;
  createdAt: string;
  updatedAt: string;
  status: RecoveryJournalStatus;
  /**
   * The phase of the batch. A legacy journal without the field is treated as
   * `write_in_progress` — the conservative reading, because that is the phase
   * in which a rollback is the correct answer.
   */
  phase?: RecoveryJournalPhase;
  /** Every actual target of the batch, in processing order. */
  entries: RecoveryJournalEntry[];
  /** The orders whose target was already replaced. */
  applied: number[];
  /** Human readable outcome of the last restore / recovery attempt. */
  outcome?: string;
  /** True when a human has to verify the state before publishing resumes. */
  recoveryRequired: boolean;
}

export class RecoveryJournalError extends Error {
  readonly code: string;
  readonly statusCode = 500;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RecoveryJournalError";
    this.code = code;
  }
}

function journalsDir(projectRoot: string): string {
  return path.resolve(projectRoot, JOURNALS_DIR_REL);
}

function journalPath(projectRoot: string, journalId: string): string {
  return path.join(journalsDir(projectRoot), `${journalId}.json`);
}

function digestOf(content: Buffer | string | null): string | null {
  if (content === null) return null;
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha256").update(buffer).digest("hex");
}

/** Digest of content that is known to exist. */
function digestOfRequired(content: Buffer | string): string {
  const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return createHash("sha256").update(buffer).digest("hex");
}

async function resolveTargetAbsolute(projectRoot: string, relPath: string): Promise<string> {
  const contentPaths = await resolveContentPaths(projectRoot);
  return path.resolve(contentPaths.configDir, relPath);
}

/** Read the current bytes of a target, or null when it does not exist. */
export async function readRecoveryTarget(
  projectRoot: string,
  relPath: string
): Promise<Buffer | null> {
  try {
    return await readFile(await resolveTargetAbsolute(projectRoot, relPath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Replace a target atomically: a temporary file in the SAME directory, then a
 * rename. A reader never observes a half-written file, and a crash between
 * the two steps leaves either the old or the new content — never a mix.
 */
export async function atomicReplaceTarget(
  projectRoot: string,
  relPath: string,
  content: string
): Promise<void> {
  const abs = await resolveTargetAbsolute(projectRoot, relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp-${randomUUID()}`);
  try {
    await writeFile(temp, content, "utf8");
    await rename(temp, abs);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Keep the ktx-facing sibling view in sync with the content root. */
export async function syncRuntimeMirror(projectRoot: string): Promise<void> {
  const contentPaths = await resolveContentPaths(projectRoot);
  await syncContentToProjectRoot(projectRoot, contentPaths).catch(() => undefined);
}

export interface CreateRecoveryJournalInput {
  releaseId: string;
  operationId: string;
  actor: string;
  instanceId: string;
  /**
   * The actual targets of this batch, in processing order. The ORIGINAL bytes
   * are read from disk when `originalContent` is not supplied, so the journal
   * always matches the disk state at journal creation.
   */
  targets: ReadonlyArray<{
    targetPath: string;
    identity?: SemanticTableIdentity;
    /** The new content the batch will write. */
    newContent: string;
    /** The original content; null means the target did not exist. */
    originalContent?: string | null;
  }>;
  now?: () => number;
}

/**
 * Create and persist the recovery journal BEFORE any formal write.
 */
export async function createRecoveryJournal(
  projectRoot: string,
  input: CreateRecoveryJournalInput
): Promise<RecoveryJournal> {
  if (input.targets.length === 0) {
    throw new RecoveryJournalError("RECOVERY_EMPTY_PLAN", "恢复日志不能为空批次。");
  }
  const nowMs = (input.now ?? Date.now)();
  const entries: RecoveryJournalEntry[] = [];

  for (let order = 0; order < input.targets.length; order += 1) {
    const target = input.targets[order]!;
    let originalBytes: Buffer | null;
    if (target.originalContent !== undefined) {
      originalBytes =
        target.originalContent === null ? null : Buffer.from(target.originalContent, "utf8");
    } else {
      originalBytes = await readRecoveryTarget(projectRoot, target.targetPath);
    }
    entries.push({
      order,
      targetPath: target.targetPath,
      ...(target.identity ? { identity: target.identity } : {}),
      originalBase64: originalBytes ? originalBytes.toString("base64") : null,
      originalDigest: digestOf(originalBytes),
      expectedNewDigest: digestOfRequired(target.newContent)
    });
  }

  const journal: RecoveryJournal = {
    version: 1,
    journalId: `rj_${randomUUID()}`,
    releaseId: input.releaseId,
    operationId: input.operationId,
    actor: input.actor,
    instanceId: input.instanceId,
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    status: "open",
    phase: "write_in_progress",
    entries,
    applied: [],
    recoveryRequired: false
  };

  await writeRecoveryJournal(projectRoot, journal);
  return journal;
}

/** Persist the journal (atomic: temp file + rename in the same directory). */
export async function writeRecoveryJournal(
  projectRoot: string,
  journal: RecoveryJournal
): Promise<void> {
  const dir = journalsDir(projectRoot);
  await mkdir(dir, { recursive: true });
  const abs = journalPath(projectRoot, journal.journalId);
  const temp = path.join(dir, `.${journal.journalId}.tmp-${randomUUID()}`);
  await writeFile(temp, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
  await rename(temp, abs);
}

/** Read a journal. */
export async function readRecoveryJournal(
  projectRoot: string,
  journalId: string
): Promise<RecoveryJournal | null> {
  if (!journalId || journalId.includes("/") || journalId.includes("\\") || journalId.includes("..")) {
    return null;
  }
  try {
    const text = await readFile(journalPath(projectRoot, journalId), "utf8");
    return JSON.parse(text) as RecoveryJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** List every journal that has not reached a terminal state. */
export async function listOpenRecoveryJournals(
  projectRoot: string
): Promise<RecoveryJournal[]> {
  const dir = journalsDir(projectRoot);
  // ★ 只把「目录不存在」当作「没有恢复任务」。
  // 其他读取故障（EACCES / EIO / …）必须**传播**：把它们吞成空列表等于把
  // 「读不到恢复日志」说成「没有未决恢复」，恢复闸门会静默失效，发布与手动
  // 索引在未核验的目标上继续跑（Spec §7.1 / §7.2 失败关闭优先）。
  // 调用方（publish / manual reindex）对异常一律按拒绝处理 → 失败关闭。
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      files = [];
    } else {
      throw error;
    }
  }
  const journals: RecoveryJournal[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const journal = await readRecoveryJournal(projectRoot, file.replace(/\.json$/, ""));
    if (journal && (journal.status === "open" || journal.status === "recovery_required")) {
      journals.push(journal);
    }
  }
  return journals.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Mark one target as replaced. Called after every successful rename. */
export async function markRecoveryEntryApplied(
  projectRoot: string,
  journalId: string,
  order: number,
  now: () => number = Date.now
): Promise<RecoveryJournal | null> {
  const journal = await readRecoveryJournal(projectRoot, journalId);
  if (!journal) return null;
  if (!journal.applied.includes(order)) journal.applied.push(order);
  journal.applied.sort((a, b) => a - b);
  journal.updatedAt = new Date(now()).toISOString();
  await writeRecoveryJournal(projectRoot, journal);
  return journal;
}

/**
 * Mark the batch as finished: the journal is no longer needed for rollback.
 *
 * ★ L25-11 §7.2: the journal may only be completed once EVERY applicable
 * evidence is durable — the mirror, the index, the final digest and the
 * terminal audit / history / status. Calling this right after the promote
 * would declare a batch finished while its activation is still unknown.
 */
export async function completeRecoveryJournal(
  projectRoot: string,
  journalId: string,
  now: () => number = Date.now
): Promise<RecoveryJournal | null> {
  const journal = await readRecoveryJournal(projectRoot, journalId);
  if (!journal) return null;
  journal.status = "completed";
  journal.phase = "completed";
  journal.updatedAt = new Date(now()).toISOString();
  await writeRecoveryJournal(projectRoot, journal);
  return journal;
}

/**
 * Mark the batch as "files saved, activation not yet proven".
 *
 * This is the stage Spec §7.2 describes: the promote succeeded, but the index
 * and the terminal evidence are still outstanding. The journal stays OPEN so
 * a startup recovery can still decide what happened — and a startup recovery
 * MUST NOT roll back a batch in this phase just because the index outcome is
 * unknown.
 */
export async function markRecoveryJournalFilesSaved(
  projectRoot: string,
  journalId: string,
  now: () => number = Date.now
): Promise<RecoveryJournal | null> {
  const journal = await readRecoveryJournal(projectRoot, journalId);
  if (!journal) return null;
  journal.phase = "files_saved";
  journal.updatedAt = new Date(now()).toISOString();
  await writeRecoveryJournal(projectRoot, journal);
  return journal;
}

/**
 * Mark the batch as "activation pending": the files are saved and verified,
 * the terminal evidence is still missing.
 */
export async function markRecoveryJournalActivationPending(
  projectRoot: string,
  journalId: string,
  now: () => number = Date.now
): Promise<RecoveryJournal | null> {
  const journal = await readRecoveryJournal(projectRoot, journalId);
  if (!journal) return null;
  journal.phase = "activation_pending";
  journal.updatedAt = new Date(now()).toISOString();
  await writeRecoveryJournal(projectRoot, journal);
  return journal;
}

/** The phase of a journal, with the legacy journals read as `write_in_progress`. */
export function recoveryJournalPhase(journal: RecoveryJournal): RecoveryJournalPhase {
  return journal.phase ?? "write_in_progress";
}

export interface RestoreRecoveryJournalResult {
  journalId: string;
  status: RecoveryJournalStatus;
  /** Targets that were put back. */
  restored: string[];
  /** Targets that were left alone because a third party wrote there. */
  skipped: string[];
  /** True when publishing and manual reindexing must stay blocked. */
  recoveryRequired: boolean;
  outcome: string;
}

/**
 * D-23：一次恢复尝试的结果。
 *
 * - `restored`  —— 目标写落地了，已按原始字节回滚。
 * - `unchanged` —— 目标仍是原始内容：**写入从未落地**（或已被回滚），无需恢复。
 * - `conflict`  —— 目标是第三方内容，**不猜、不覆盖**，留给人工。
 */
type RestoreEntryOutcome = "restored" | "unchanged" | "conflict";

async function restoreEntry(
  projectRoot: string,
  entry: RecoveryJournalEntry
): Promise<{ outcome: RestoreEntryOutcome; reason?: string }> {
  const current = await readRecoveryTarget(projectRoot, entry.targetPath);
  const currentDigest = digestOf(current);
  if (currentDigest !== entry.expectedNewDigest) {
    return currentDigest === entry.originalDigest
      ? { outcome: "unchanged", reason: "目标仍是原始内容，无需恢复。" }
      : {
          outcome: "conflict",
          reason: "目标内容既不是原始内容也不是本批次写入的内容，存在第三方改动，拒绝覆盖。"
        };
  }
  if (entry.originalBase64 === null) {
    // The target did not exist before this batch: remove what we created.
    const abs = await resolveTargetAbsolute(projectRoot, entry.targetPath);
    await rm(abs, { force: true });
    return { outcome: "restored" };
  }
  const originalBytes = Buffer.from(entry.originalBase64, "base64");
  const abs = await resolveTargetAbsolute(projectRoot, entry.targetPath);
  await mkdir(path.dirname(abs), { recursive: true });
  const temp = path.join(path.dirname(abs), `.${path.basename(abs)}.restore-${randomUUID()}`);
  try {
    await writeFile(temp, originalBytes);
    await rename(temp, abs);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  return { outcome: "restored" };
}

/**
 * Restore the targets this batch changed, in reverse processing order.
 *
 * ★ D-23：**遍历日志里的全部 entry**，而不是只遍历 `applied` 列表。
 * 原因：`applied` 的标记写在 rename **之后**。若 rename 成功而标记写入失败
 * （磁盘满 / 进程崩溃），目标已被替换却不在 `applied` 里 —— 只信 `applied`
 * 会漏回滚它，并且因为 `recoveryRequired` 仍为 false 而误报 `restored`。
 * 判定一律**按实际字节**（`restoreEntry`），不猜。
 *
 * Only the targets recorded in the journal are touched. The runtime mirror is
 * synchronised afterwards so the mirror never shows a state the content root
 * does not have.
 */
export async function restoreRecoveryJournal(
  projectRoot: string,
  journalId: string,
  options: { now?: () => number } = {}
): Promise<RestoreRecoveryJournalResult | null> {
  const journal = await readRecoveryJournal(projectRoot, journalId);
  if (!journal) return null;
  const now = options.now ?? Date.now;

  const restored: string[] = [];
  const skipped: string[] = [];
  let recoveryRequired = false;

  // 逆序处理：与写入顺序相反，后写的先回滚。
  const ordered = [...journal.entries].sort((a, b) => b.order - a.order);
  for (const entry of ordered) {
    try {
      const result = await restoreEntry(projectRoot, entry);
      if (result.outcome === "restored") {
        restored.push(entry.targetPath);
      } else if (result.outcome === "conflict") {
        skipped.push(entry.targetPath);
        recoveryRequired = true;
        journal.outcome = result.reason;
      }
      // `unchanged`：写入从未落地（或已被回滚），既不算恢复，也不算异常。
      // 该 entry 无论是否曾被标进 applied，都已不再需要恢复。
      journal.applied = journal.applied.filter((item) => item !== entry.order);
    } catch (error) {
      skipped.push(entry.targetPath);
      recoveryRequired = true;
      journal.outcome = error instanceof Error ? error.message : String(error);
    }
  }

  await syncRuntimeMirror(projectRoot);

  journal.status = recoveryRequired ? "recovery_required" : "restored";
  journal.recoveryRequired = recoveryRequired;
  journal.updatedAt = new Date(now()).toISOString();
  await writeRecoveryJournal(projectRoot, journal);

  return {
    journalId,
    status: journal.status,
    restored,
    skipped,
    recoveryRequired,
    outcome:
      journal.outcome ??
      (recoveryRequired
        ? "部分目标未能恢复，已标记为待人工修复。"
        : "本批次已改目标已按日志逆序恢复。")
  };
}

export interface RecoverPendingJournalsResult {
  /** Journals that were fully resolved. */
  recovered: string[];
  /** Journals that need a human. */
  needsRepair: string[];
  /**
   * Journals whose files are saved and verified but whose activation is not
   * proven. They stay open so the index can be retried; they are NOT rolled
   * back (Spec §7.2 / §9 `recoverAfterRestart`).
   */
  activationPending: string[];
}

/**
 * Startup recovery: decide what happened for every unfinished journal.
 *
 * The decision is made from the ACTUAL bytes:
 *   - the old digest  → the write never landed (or was already rolled back)
 *   - the new digest  → the write landed but the journal was not updated
 *   - anything else   → a third party wrote there; the state is NOT guessed
 *
 * ★ L25-11 §7.2: the PHASE decides whether a rollback is allowed at all.
 * A journal in `write_in_progress` is rolled back (the batch never finished).
 * A journal in `files_saved` / `activation_pending` is NOT rolled back merely
 * because the index or the terminal outcome is unknown — the written files are
 * verified against the saved plan and the activation is left unconfirmed.
 *
 * The caller (the server bootstrap) must run this BEFORE publishing or a
 * manual reindex is allowed.
 */
export async function recoverPendingRecoveryJournals(
  projectRoot: string,
  options: { now?: () => number } = {}
): Promise<RecoverPendingJournalsResult> {
  const now = options.now ?? Date.now;
  const recovered: string[] = [];
  const needsRepair: string[] = [];
  const activationPending: string[] = [];

  for (const journal of await listOpenRecoveryJournals(projectRoot)) {
    const phase = recoveryJournalPhase(journal);
    const rollbackAllowed = phase === "write_in_progress";

    let blocked = false;
    for (const entry of journal.entries) {
      const current = await readRecoveryTarget(projectRoot, entry.targetPath);
      const currentDigest = digestOf(current);
      if (currentDigest === entry.originalDigest) continue;
      if (currentDigest === entry.expectedNewDigest) {
        if (!rollbackAllowed) {
          // The write landed and the batch had already saved its files: the
          // index / terminal outcome is unknown, but the CONTENT is proven.
          // Rolling back here would destroy a completed write because of a
          // missing index — the exact "猜成功 / 猜失败" the spec forbids.
          continue;
        }
        // The write landed but the journal update did not. Roll it back.
        const result = await restoreEntry(projectRoot, entry);
        if (result.outcome === "conflict") {
          blocked = true;
          journal.outcome = result.reason;
        }
        continue;
      }
      blocked = true;
      journal.outcome =
        journal.outcome ??
        `目标 ${entry.targetPath} 的内容既不是原始内容也不是本批次写入的内容，无法判定，请人工修复。`;
    }

    if (blocked) {
      journal.status = "recovery_required";
      journal.recoveryRequired = true;
      journal.updatedAt = new Date(now()).toISOString();
      await writeRecoveryJournal(projectRoot, journal);
      needsRepair.push(journal.journalId);
      continue;
    }

    if (!rollbackAllowed) {
      // The written files are verified against the saved plan. The activation
      // is not proven, so the journal stays open and the release keeps
      // `activationStatus = unconfirmed` until the index is retried.
      journal.status = "open";
      journal.recoveryRequired = false;
      journal.phase = "activation_pending";
      journal.updatedAt = new Date(now()).toISOString();
      await writeRecoveryJournal(projectRoot, journal);
      await syncRuntimeMirror(projectRoot);
      activationPending.push(journal.journalId);
      continue;
    }

    journal.status = "restored";
    journal.recoveryRequired = false;
    journal.applied = [];
    journal.updatedAt = new Date(now()).toISOString();
    await writeRecoveryJournal(projectRoot, journal);
    await syncRuntimeMirror(projectRoot);
    recovered.push(journal.journalId);
  }

  return { recovered, needsRepair, activationPending };
}

/**
 * A journal still blocks publishing, manual reindex, and affected reads.
 *
 * `recovery_required` is the human-repair state. An ordinary `write_in_progress`
 * journal is the same kind of unresolved write: the batch has not saved its
 * files, so a missing `recoveryRequired` flag must not let the next publish
 * through (Spec §7.2). `files_saved` / `activation_pending` mean the bytes were
 * verified and only the activation is unconfirmed — those stay open so the
 * index can be retried, and they do not permanently close the next publish.
 */
export function journalBlocksSemanticAccess(journal: RecoveryJournal): boolean {
  if (journal.recoveryRequired || journal.status === "recovery_required") return true;
  return recoveryJournalPhase(journal) === "write_in_progress";
}

/**
 * Is any batch still waiting for a human, or still mid-write?
 *
 * The publish coordinator and the manual reindex route use this to fail
 * closed (Spec §7.1 / §7.2, D3). A journal directory that cannot be read
 * throws — callers must treat that as closed, never as "nothing to recover".
 */
export async function isRecoveryRequired(projectRoot: string): Promise<boolean> {
  if (semanticRecoveryAdmissionLatched) return true;
  const journals = await listOpenRecoveryJournals(projectRoot);
  return journals.some((journal) => journalBlocksSemanticAccess(journal));
}

/**
 * Persist the human-repair state when a restore cannot finish.
 * If the journal cannot be written, latch admission closed so the next
 * publish and Lucy read still fail closed.
 */
export async function markRecoveryJournalBlocked(
  projectRoot: string,
  journalId: string,
  outcome: string,
  now: () => number = Date.now
): Promise<void> {
  try {
    const journal = await readRecoveryJournal(projectRoot, journalId);
    if (!journal) {
      latchSemanticRecoveryAdmission();
      return;
    }
    journal.status = "recovery_required";
    journal.recoveryRequired = true;
    journal.outcome = outcome;
    journal.updatedAt = new Date(now()).toISOString();
    await writeRecoveryJournal(projectRoot, journal);
  } catch (error) {
    latchSemanticRecoveryAdmission();
    throw error;
  }
}

export interface SemanticRecoveryReadBlock {
  code: "semantic_recovery_required" | "semantic_recovery_unreadable";
  message: string;
}

/**
 * Tokens a Lucy read can be matched against: a source name, a
 * `connection.schema.table` qualifier, or the source prefix of a measure.
 */
export function semanticReadHintsFromArgs(args: unknown): string[] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const record = args as Record<string, unknown>;
  const hints = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) hints.add(trimmed);
  };
  for (const key of [
    "connectionId",
    "connection_id",
    "connection",
    "sourceName",
    "source_name",
    "source",
    "table",
    "schema"
  ]) {
    push(record[key]);
  }
  collectSemanticQualifiers(record.measures, hints);
  collectSemanticQualifiers(record.dimensions, hints);
  for (const key of [
    "filters",
    "where",
    "segments",
    "joins",
    "join",
    "orderBy",
    "order_by",
    "sort",
    "sorts",
    "having",
    "groupBy",
    "group_by"
  ]) {
    collectSemanticQualifiers(record[key], hints);
  }
  return [...hints];
}

function collectSemanticQualifiers(value: unknown, hints: Set<string>): void {
  if (typeof value === "string") {
    if (value.includes(".")) hints.add(value.slice(0, value.lastIndexOf(".")));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSemanticQualifiers(item, hints);
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.field === "string") collectSemanticQualifiers(record.field, hints);
    if (typeof record.expr === "string") collectSemanticQualifiers(record.expr, hints);
  }
}

function entryLabels(entry: RecoveryJournalEntry): string[] {
  const labels = new Set<string>();
  const addIdentity = (identity: SemanticTableIdentity) => {
    labels.add(`${identity.connectionId}.${identity.schema}.${identity.table}`);
    labels.add(`${identity.schema}.${identity.table}`);
    labels.add(`${identity.connectionId}.${identity.table}`);
    labels.add(identity.table);
  };
  if (entry.identity) addIdentity(entry.identity);
  const schemaFile = /^semantic-layer\/([^/]+)\/_schema\/([^/]+)\.yaml$/.exec(entry.targetPath);
  if (schemaFile) {
    labels.add(`${schemaFile[1]}.${schemaFile[2]}`);
    return [...labels];
  }
  const overlay = /^semantic-layer\/([^/]+)\/([^/]+)\.yaml$/.exec(entry.targetPath);
  if (overlay) {
    labels.add(`${overlay[1]}.${overlay[2]}`);
    labels.add(overlay[2]!);
  }
  return [...labels];
}

function hintHitsLabel(hint: string, label: string): boolean {
  if (
    hint === label
    || hint.endsWith(`.${label}`)
    || hint.startsWith(`${label}.`)
    || label.startsWith(`${hint}.`)
  ) {
    return true;
  }
  // A bare table or schema token still touches every label that contains it.
  if (!hint.includes(".")) {
    return label.endsWith(`.${hint}`) || label.includes(`.${hint}.`);
  }
  return false;
}

/**
 * Fail closed a Lucy read of an asset whose write is still unresolved.
 *
 * Returns null when every blocking journal names its targets and none of the
 * hints touch them. An empty hint list, or a target that cannot be named,
 * closes the read: the caller cannot prove the request is disjoint
 * (Spec §7.2, D3).
 */
export async function semanticRecoveryReadBlock(
  projectRoot: string,
  hints: readonly string[]
): Promise<SemanticRecoveryReadBlock | null> {
  if (semanticRecoveryAdmissionLatched) {
    return {
      code: "semantic_recovery_unreadable",
      message: "语义恢复日志无法落成待修复状态，涉及资产的读取和查询已关闭。"
    };
  }
  const journals = await listOpenRecoveryJournals(projectRoot);
  const blocking = journals.filter((journal) => journalBlocksSemanticAccess(journal));
  if (blocking.length === 0) return null;

  const labels: string[] = [];
  for (const journal of blocking) {
    for (const entry of journal.entries) {
      const named = entryLabels(entry);
      if (named.length === 0) {
        return {
          code: "semantic_recovery_required",
          message: "存在无法命名的未决语义恢复，本次读取无法判定是否涉及该资产，已关闭。"
        };
      }
      labels.push(...named);
    }
  }

  if (hints.length === 0) {
    return {
      code: "semantic_recovery_required",
      message: "存在未决语义恢复，且本次读取没有指明资产，已关闭。"
    };
  }

  const hit = hints.some((hint) => labels.some((label) => hintHitsLabel(hint, label)));
  if (!hit) return null;
  return {
    code: "semantic_recovery_required",
    message: "该语义资产仍有未决恢复日志，恢复核验完成前不能读取或查询。"
  };
}

/** Whether the target file exists (diagnostics). */
export async function recoveryTargetExists(
  projectRoot: string,
  relPath: string
): Promise<boolean> {
  try {
    await stat(await resolveTargetAbsolute(projectRoot, relPath));
    return true;
  } catch {
    return false;
  }
}
