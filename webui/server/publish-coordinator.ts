import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertSemanticWritesOpen } from "./semantic-recovery-journal.js";

/**
 * Lucy v0.25 — shared single-instance publish coordinator.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §7.1/§7.2
 * (D4) and docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §5.3 (D6).
 *
 * Contract:
 * - Every declared write entry point runs inside the publish window: single-table
 *   semantic save, Schema Manifest upload, batch semantic import, manual reindex, and
 *   the access.yaml writers (Role / row-policy save and Agent CRUD — same file, so the
 *   same lock class).
 * - Baseline re-check, final validation, the formal write, runtime mirror sync, index
 *   activation and terminal state persistence all happen inside ONE critical section.
 *   Write and activation are therefore serialized across every entry point.
 * - Read-only preview, independent validation and report queries do NOT take the lock
 *   and may run in parallel; only submission re-checks digests.
 * - Contention returns a readable busy error. It is never silently queued: silently
 *   queueing would let two callers believe they both hold the publish window.
 * - A lock left behind by a crashed process is reclaimed. Without reclaim, one crash
 *   would block every later publish forever.
 *
 * Deployment boundary: single instance / single replica. The file lock is the
 * cross-restart guard; the in-process re-entrancy guard is what keeps one process from
 * deadlocking on itself.
 */

export const PUBLISH_COORDINATOR_LOCK_REL = ".ktx-ui/semantic-publish.lock";

/** Every declared write entry point that must share one publish window. */
export type PublishEntryKind =
  | "semantic_table_save"
  | "manifest_upload"
  | "batch_import"
  | "manual_reindex"
  | "role_policy_save"
  | "agent_save"
  | "semantic_restore";

export const PUBLISH_ENTRY_KINDS: readonly PublishEntryKind[] = [
  "semantic_table_save",
  "manifest_upload",
  "batch_import",
  "manual_reindex",
  "role_policy_save",
  "agent_save",
  "semantic_restore"
];

/**
 * Where a held publish window is inside its critical section.
 * The entry kind stays one of the six frozen values; the phase tells an
 * operator whether this holder is rebuilding the index, checking digests,
 * or writing the terminal record.
 */
export type PublishWindowPhase = "reindexing" | "verify_digest" | "terminal";

const PUBLISH_WINDOW_PHASES: ReadonlySet<string> = new Set([
  "reindexing",
  "verify_digest",
  "terminal"
]);

const PUBLISH_WINDOW_PHASE_LABEL: Record<PublishWindowPhase, string> = {
  reindexing: "重建索引",
  verify_digest: "核验摘要",
  terminal: "写终态"
};

export interface PublishLockHolder {
  kind: PublishEntryKind;
  operationId: string;
  acquiredAt: string;
  /**
   * The owning process. `undefined` means the owner is unknown — a lock file
   * written by a build that predates the pid field. An unknown owner can only
   * be retired by age; a KNOWN owner is never retired by age alone.
   */
  pid?: number;
  /** Batch identity, when the holder is a publish batch. */
  validationId?: string;
  releaseId?: string;
  /** Set by the publish path while the window stays held across reindex. */
  phase?: PublishWindowPhase;
}

export function formatPublishWindowBusy(
  holder: PublishLockHolder | null,
  requestedKind?: PublishEntryKind
): string {
  if (!holder) {
    return requestedKind
      ? `发布窗口被占用：${requestedKind} 无法取得发布锁。请稍后重试。`
      : "已有发布批次正在执行，请等待当前批次完成后再试";
  }
  const phase = holder.phase ? PUBLISH_WINDOW_PHASE_LABEL[holder.phase] : "";
  const phaseText = phase ? `，阶段 ${phase}` : "";
  return `发布窗口被占用：当前持有者 ${holder.kind}（operationId=${holder.operationId}，${holder.acquiredAt}${phaseText}）。请稍后重试或先确认该发布是否已结束。`;
}

/** True when `current` is the lock file written for `holder`. */
export function publishLockOwnedBy(
  current: PublishLockHolder,
  holder: PublishLockHolder
): boolean {
  const currentId = current.operationId;
  const holderId = holder.operationId;
  if (currentId && holderId && currentId !== "unknown" && holderId !== "unknown") {
    return currentId === holderId;
  }
  return current.acquiredAt === holder.acquiredAt;
}

export class PublishCoordinatorBusyError extends Error {
  readonly code = "PUBLISH_COORDINATOR_BUSY";

  constructor(readonly holder: PublishLockHolder | null, readonly requestedKind: PublishEntryKind) {
    super(formatPublishWindowBusy(holder, requestedKind));
    this.name = "PublishCoordinatorBusyError";
  }
}

export interface PublishCoordinatorOptions {
  projectRoot: string;
  /** Lock older than this is considered abandoned by a crashed process. Default 30 min. */
  staleAfterMs?: number;
  /** Injectable clock, for deterministic tests. */
  now?: () => number;
  /** Optional operation id, recorded in the lock file for readable busy messages. */
  operationId?: string;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Marks the current async context as already holding the coordinator, so nested calls
 * (e.g. a batch publish that internally re-checks a baseline) do not deadlock.
 */
const coordinatorHeld = new AsyncLocalStorage<true>();

/**
 * The holder object this process acquired. Snapshot capture compares this
 * reference (and its pid / acquiredAt) with the lock file. The AsyncLocalStorage
 * flag and a lock file that merely exists are not proof of ownership.
 */
let processPublishHolder: PublishLockHolder | null = null;

export function currentProcessPublishHolder(): PublishLockHolder | null {
  return processPublishHolder;
}

function rememberProcessHolder(holder: PublishLockHolder): void {
  processPublishHolder = holder;
}

function forgetProcessHolder(holder: PublishLockHolder): void {
  if (processPublishHolder && publishLockOwnedBy(processPublishHolder, holder)) {
    processPublishHolder = null;
  }
}

export function isInsidePublishCoordinator(): boolean {
  return coordinatorHeld.getStore() === true;
}

function lockPath(projectRoot: string): string {
  return path.resolve(projectRoot, PUBLISH_COORDINATOR_LOCK_REL);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Decide whether an existing lock file may be reclaimed.
 *
 * A lock is abandoned only when the process that took it is gone. Age alone is
 * NOT sufficient: a long-running publish (or a stalled write) is still a live
 * holder, and reclaiming it would let a second writer into the critical
 * section and overwrite the first writer's targets.
 *
 * The age check remains only as a fallback for a lock file whose owning pid
 * cannot be determined (for example a lock written by a build that predates
 * the pid field). Such a holder is still reclaimed after the stale window, but
 * a holder with a KNOWN live pid is never reclaimed.
 */
function isStaleHolder(
  holder: PublishLockHolder | null,
  nowMs: number,
  staleAfterMs: number
): boolean {
  if (!holder) return false;
  if (Number.isInteger(holder.pid)) {
    // The owner is known: only a dead owner may be reclaimed. This also covers
    // the current process, whose lock must never be stolen.
    return holder.pid !== process.pid && !isProcessAlive(holder.pid);
  }
  const acquiredAt = Date.parse(holder.acquiredAt);
  if (Number.isFinite(acquiredAt) && nowMs - acquiredAt > staleAfterMs) return true;
  return false;
}

export async function readPublishCoordinatorLock(
  projectRoot: string
): Promise<PublishLockHolder | null> {
  const abs = lockPath(projectRoot);
  try {
    const text = await readFile(abs, "utf8");
    const parsed = JSON.parse(text) as Partial<PublishLockHolder> & {
      validationId?: unknown;
      releaseId?: unknown;
    };
    // A lock file written by an older build has no `kind` / `acquiredAt`. It still
    // holds the window, so it is reported as a holder; the file's mtime is used as
    // the acquisition time so the stale-reclaim rule can still retire it.
    const fileStat = await stat(abs);
    const acquiredAt =
      typeof parsed?.acquiredAt === "string"
        ? parsed.acquiredAt
        : new Date(fileStat.mtimeMs).toISOString();
    return {
      kind: (typeof parsed?.kind === "string" ? parsed.kind : "batch_import") as PublishEntryKind,
      operationId: typeof parsed?.operationId === "string" ? parsed.operationId : "unknown",
      acquiredAt,
      // A lock file written by an older build has no `pid`. It must NOT be
      // reported as owned by the current process: that would make an ownerless
      // lock look alive forever and it could never be retired. `pid: undefined`
      // means "owner unknown", and age is then the only available signal.
      pid: typeof parsed?.pid === "number" ? parsed.pid : undefined,
      validationId: typeof parsed?.validationId === "string" ? parsed.validationId : undefined,
      releaseId: typeof parsed?.releaseId === "string" ? parsed.releaseId : undefined,
      phase: PUBLISH_WINDOW_PHASES.has(parsed?.phase ?? "")
        ? (parsed?.phase as PublishWindowPhase)
        : undefined
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Try to claim an abandoned lock file. The rename is the atomic claim: exactly one
 * caller can move the file away, and the loser simply reports busy.
 */
async function reclaimStaleLock(
  projectRoot: string,
  staleHolder: PublishLockHolder
): Promise<boolean> {
  const abs = lockPath(projectRoot);
  const graveyard = `${abs}.stale-${randomUUID()}`;
  try {
    await rename(abs, graveyard);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  // Only remove the graveyard if it still carries the holder we judged stale.
  try {
    const moved = JSON.parse(await readFile(graveyard, "utf8")) as Partial<PublishLockHolder>;
    if (moved?.acquiredAt !== staleHolder.acquiredAt) {
      // Somebody replaced the lock between our read and our rename. Put it back.
      await rename(graveyard, abs).catch(() => undefined);
      return false;
    }
  } catch {
    // Unreadable graveyard: still ours to remove.
  }
  await rm(graveyard, { force: true });
  return true;
}

async function tryCreateLock(
  projectRoot: string,
  holder: PublishLockHolder
): Promise<boolean> {
  const abs = lockPath(projectRoot);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(abs, JSON.stringify(holder), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

export interface PublishLockPayload {
  validationId?: string;
  releaseId?: string;
  phase?: PublishWindowPhase;
}

/**
 * Low-level acquisition for entry points whose critical section spans an asynchronous
 * background step (the batch publish promotes files and then reindexes asynchronously).
 * The scoped {@link withPublishCoordinator} is the default; this variant exists for the
 * publish path, which must keep holding the window across its background reindex.
 */
export async function acquirePublishCoordinatorLock(
  projectRoot: string,
  kind: PublishEntryKind,
  payload: PublishLockPayload = {},
  options: { staleAfterMs?: number; now?: () => number; operationId?: string } = {}
): Promise<{ acquired: boolean; holder: PublishLockHolder }> {
  const now = options.now ?? Date.now;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const holder: PublishLockHolder = {
    kind,
    operationId: options.operationId ?? randomUUID(),
    acquiredAt: new Date(now()).toISOString(),
    pid: process.pid,
    ...(payload.validationId === undefined ? {} : { validationId: payload.validationId }),
    ...(payload.releaseId === undefined ? {} : { releaseId: payload.releaseId })
  };

  if (await tryCreateLock(projectRoot, holder)) {
    rememberProcessHolder(holder);
    return { acquired: true, holder };
  }

  const existing = await readPublishCoordinatorLock(projectRoot);
  if (existing && isStaleHolder(existing, now(), staleAfterMs)) {
    if (await reclaimStaleLock(projectRoot, existing)) {
      if (await tryCreateLock(projectRoot, holder)) {
        rememberProcessHolder(holder);
        return { acquired: true, holder };
      }
    }
  }
  return { acquired: false, holder };
}

/**
 * Release a lock acquired by {@link acquirePublishCoordinatorLock}.
 * Only our own lock is removed. Identity is `operationId`, not the timestamp:
 * two holders can share an `acquiredAt` millisecond. A delete that throws
 * leaves the file in place so the caller can retry the same holder.
 */
export async function releasePublishCoordinatorLock(
  projectRoot: string,
  holder: PublishLockHolder
): Promise<void> {
  const current = await readPublishCoordinatorLock(projectRoot);
  if (current && !publishLockOwnedBy(current, holder)) return;
  await rm(lockPath(projectRoot), { force: true });
  forgetProcessHolder(holder);
}

/**
 * Update the identity of the holder in place (used by the publish path once the batch
 * has a release id). The lock stays held.
 */
export async function updatePublishCoordinatorLockPayload(
  projectRoot: string,
  holder: PublishLockHolder,
  payload: PublishLockPayload
): Promise<void> {
  const next: PublishLockHolder = {
    ...holder,
    ...(payload.validationId === undefined ? {} : { validationId: payload.validationId }),
    ...(payload.releaseId === undefined ? {} : { releaseId: payload.releaseId }),
    ...(payload.phase === undefined ? {} : { phase: payload.phase })
  };
  const current = await readPublishCoordinatorLock(projectRoot);
  if (current && !publishLockOwnedBy(current, holder)) return;
  await writeFile(lockPath(projectRoot), JSON.stringify(next), "utf8");
  holder.validationId = next.validationId;
  holder.releaseId = next.releaseId;
  holder.phase = next.phase;
}

/**
 * Run `fn` inside the shared publish window.
 *
 * Throws `PublishCoordinatorBusyError` when another live holder owns the window.
 */
export async function withPublishCoordinator<T>(
  kind: PublishEntryKind,
  fn: () => Promise<T>,
  options: PublishCoordinatorOptions
): Promise<T> {
  // Re-entrant: the caller already owns the window (nested baseline re-check, or a
  // write path that funnels through another coordinated entry point).
  if (isInsidePublishCoordinator()) {
    return coordinatorHeld.run(true, fn);
  }

  const { acquired, holder } = await acquirePublishCoordinatorLock(options.projectRoot, kind, {}, {
    staleAfterMs: options.staleAfterMs,
    now: options.now,
    operationId: options.operationId
  });

  if (!acquired) {
    throw new PublishCoordinatorBusyError(
      await readPublishCoordinatorLock(options.projectRoot),
      kind
    );
  }

  try {
    // The lock is already ours. A recovery journal opened between the previous
    // check and this one still closes the write, and the finally block drops
    // the window so a rejected entry does not keep it.
    await assertSemanticWritesOpen(options.projectRoot);
    return await coordinatorHeld.run(true, fn);
  } finally {
    await releasePublishCoordinatorLock(options.projectRoot, holder);
  }
}

/**
 * Diagnostic helper used by the manual reindex route: is a publish window currently
 * held by a live holder?
 */
export async function isPublishCoordinatorBusy(
  projectRoot: string,
  now: () => number = Date.now,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS
): Promise<{ busy: boolean; holder: PublishLockHolder | null }> {
  const holder = await readPublishCoordinatorLock(projectRoot);
  if (!holder) return { busy: false, holder: null };
  if (isStaleHolder(holder, now(), staleAfterMs)) {
    return { busy: false, holder };
  }
  return { busy: true, holder };
}
