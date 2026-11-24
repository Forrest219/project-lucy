/**
 * Spec 174 §3.2 / §7 and Spec 195 §5 / §6 — versioned display snapshots.
 *
 * Only display-derived data is cached here (catalog summaries, Agent list
 * permission previews). Runtime authorization, save validation, dryRun and
 * previews never read it. Payloads are stored pre-serialized, so consumers
 * cannot mutate a published snapshot.
 *
 * Snapshots are only served while the reconciler for the current project
 * verifies them: fs.watch triggers + 1 s metadata reconciliation + 30 s
 * full-content digest. Without that (stopped / failed reconciler, overdue
 * digest, other project root) requests are a retryable DISPLAY_SNAPSHOT_BUSY
 * with no payload until reconciliation recovers.
 *
 * Spec 195: both reconciliations consume ONE file revision ledger, so a
 * confirmed change invalidates its derived scopes exactly once; verification
 * health is tracked per dependency scope, so a broken overlay cannot take the
 * Agent permission display down with it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getAccessRecoveryStateSync } from "./access-recovery";
import { countEntryPerf, markDisplayBuild, markDisplayCache, markDisplayDegraded } from "./entry-performance-timing";
import { eventLoopDelaySnapshot } from "./runtime/event-loop-delay";
import {
  bumpDisplayGeneration,
  canonicalFileId,
  currentScopeContext,
  DISPLAY_SCOPES,
  generationKey,
  displayGenerations,
  hasPendingDisplayWrite,
  isIgnoredSemanticPath,
  onDisplayGenerationChange,
  scopesForPath,
  waitForDisplayWritesSettled,
  type DisplayScope,
  type DisplayWriteToken,
  type ScopeContext
} from "./display-generation";
import {
  currentRevisionLedger,
  ensureRevisionLedger,
  errorMessage,
  markScopeDigestError,
  markScopeDigestOk,
  markScopeMetadataError,
  markScopeMetadataOk,
  MISSING,
  metaSignature,
  readStableRevision,
  resetRevisionLedger,
  sanitizeDiagnosticMessage,
  scopeContextId,
  scopeHealthSnapshot,
  type RevisionCandidate,
  type RevisionLedger
} from "./display-revisions";

export const DISPLAY_SNAPSHOT_BUSY = "DISPLAY_SNAPSHOT_BUSY";
export const MAX_CONCURRENT_DISPLAY_BUILDS = 4;
export const DISPLAY_BUILD_FAILURE_BACKOFF_MS = 1000;
/** Spec 195 §6 — the whole request gets at most three attempts. */
export const MAX_DISPLAY_ATTEMPTS = 3;
/** Spec 195 §6 — the total recovery wait of one request (shared, never reset). */
export const DISPLAY_RECOVERY_WAIT_BUDGET_MS = 1500;
/** P1-75 SC-08 — leave time for the browser to receive a retryable response. */
const DISPLAY_BUILD_WAIT_BUDGET_MS = 4000;
/** Spec 195 §6 — file I/O starts with two concurrent workers. */
export const DISPLAY_FILE_IO_CONCURRENCY = 2;

const METADATA_INTERVAL_MS = 1000;
const FULL_DIGEST_INTERVAL_MS = 30_000;
/** Metadata older than this, or a full digest older than 31 s, means "not verified". */
const METADATA_FRESH_MS = 3000;
const FULL_DIGEST_FRESH_MS = 31_000;
/** P0-1 — bounded degraded read: serve the committed slot while only the freshness window has lapsed. */
const METADATA_GRACE_MS = 120_000;
const FULL_DIGEST_GRACE_MS = 180_000;

/** Scopes a display snapshot may depend on. `sources` needs D+P+C, Agent permissions need P+C. */
export const SOURCES_SCOPES: readonly DisplayScope[] = ["D", "P", "C"];
export const AGENT_PERMISSION_SCOPES: readonly DisplayScope[] = ["P", "C"];

export type DisplayBusyReason =
  | "metadata_overdue"
  | "digest_overdue"
  | "reconcile_failed"
  | "write_pending"
  | "build_capacity"
  | "build_wait_timeout"
  | "generation_changed"
  | "context_mismatch";

export class DisplaySnapshotBusyError extends Error {
  code = DISPLAY_SNAPSHOT_BUSY;
  statusCode = 503;
  retryAfterSeconds = 1;
  reason: DisplayBusyReason;

  constructor(reason: DisplayBusyReason = "metadata_overdue") {
    super("页面数据暂时无法完成刷新，请稍后重试。");
    this.name = "DisplaySnapshotBusyError";
    this.reason = reason;
  }
}

type Slot = { key: string; payload: string; sidecar?: string; version: string; builtAt: number; incarnation: symbol };
type BuildOutcome = { slot: Slot; context: ScopeContext } | { reason: DisplayBusyReason } | { error: unknown };
type BuildTask = { readers: Set<(outcome: BuildOutcome) => void> };
type Entry = { current?: Slot; inflight: Map<string, BuildTask>; failure?: { key: string; until: number; error: unknown } };

const entries = new Map<string, Entry>();
let inflightBuilds = 0;
let stats = { builds: 0, hits: 0, misses: 0, busy: 0, graceServes: 0 };
const busyByReason = new Map<DisplayBusyReason, number>();
/** Spec 195 §7 — request correlation for the diagnostics (no payload, no secrets). */
let lastRequest: { name: string; scopes: DisplayScope[]; attempts: number; reason?: DisplayBusyReason } | null = null;

/**
 * 现场取证：最近 N 次忙碌（503）事件的内存记录，随 `/api/health` 一并导出，
 * 不依赖容器日志是否保留。只含页面名、原因码、时间、核对年龄和运行态读数，无 payload、路径或密钥。
 */
const BUSY_EVENT_LIMIT = 30;
const busyEvents: Array<Record<string, unknown>> = [];
function recordBusyEvent(fields: Record<string, unknown>): void {
  busyEvents.push({
    at: new Date().toISOString(),
    uptimeS: Math.round(process.uptime()),
    inflightBuilds,
    eventLoopMaxMs: eventLoopDelaySnapshot().maxMs,
    ...fields
  });
  if (busyEvents.length > BUSY_EVENT_LIMIT) busyEvents.shift();
}

/** `/api/health` 用：忙碌累计、按原因分布、宽限服务次数与最近事件。 */
export function displayBusySummary(): {
  busy: number;
  graceServes: number;
  byReason: Record<string, number>;
  recent: Array<Record<string, unknown>>;
} {
  return {
    busy: stats.busy,
    graceServes: stats.graceServes,
    byReason: Object.fromEntries(busyByReason),
    recent: busyEvents.map((event) => ({ ...event }))
  };
}

export type DisplaySnapshotResult = { payload: string; sidecar?: string; version: string; cache: "hit" | "miss"; incarnation: symbol };
/**
 * A build returns the serialized payload, optionally with a small serialized
 * sidecar (e.g. compile inputs) the handler evaluates per response.
 */
export type DisplayBuild = (version: string) => Promise<string | { payload: string; sidecar: string }>;

/** Compare the slot instance, not its key-derived version (same-key rebuilds keep that version). */
export function evictDisplaySnapshotSlot(name: string, incarnation: symbol): boolean {
  const entry = entries.get(name);
  if (!entry?.current || entry.current.incarnation !== incarnation) return false;
  entry.current = undefined;
  entry.failure = undefined;
  return true;
}


/**
 * Spec 195 §6 — one request budget: at most three attempts in total and one
 * shared recovery wait. The route layer and the snapshot layer draw from the
 * same budget, so nested retries cannot multiply.
 */
export type DisplayRequestBudget = {
  attemptsLeft: number;
  deadline: number;
  buildDeadline: number;
};

export function createDisplayRequestBudget(
  attempts: number = MAX_DISPLAY_ATTEMPTS,
  waitBudgetMs: number = DISPLAY_RECOVERY_WAIT_BUDGET_MS,
  buildWaitBudgetMs: number = DISPLAY_BUILD_WAIT_BUDGET_MS
): DisplayRequestBudget {
  return { attemptsLeft: attempts, deadline: Date.now() + waitBudgetMs, buildDeadline: performance.now() + buildWaitBudgetMs };
}

function entryFor(name: string): Entry {
  let entry = entries.get(name);
  if (!entry) {
    entry = { inflight: new Map() };
    entries.set(name, entry);
  }
  return entry;
}

function keyFor(name: string, scopes: readonly DisplayScope[], context: ScopeContext, extraKey: string): string {
  return [name, context.projectRoot, context.semanticLayer, context.accessPaths.join(","), generationKey(scopes), extraKey].join("\u0000");
}

function versionOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

async function buildSlot(key: string, build: DisplayBuild): Promise<Slot> {
  stats.builds += 1;
  countEntryPerf("displayBuilds");
  markDisplayBuild();
  const version = versionOf(key);
  const built = await build(version);
  const incarnation = Symbol("display-slot");
  return typeof built === "string"
    ? { key, payload: built, version, builtAt: Date.now(), incarnation }
    : { key, payload: built.payload, sidecar: built.sidecar, version, builtAt: Date.now(), incarnation };
}

function sameContext(a: ScopeContext, b: ScopeContext): boolean {
  return a.projectRoot === b.projectRoot && a.semanticLayer === b.semanticLayer && a.accessPaths.join("\u0000") === b.accessPaths.join("\u0000");
}

// ─── reconciler ─────────────────────────────────────────────────────────────

type ReconcilerState = {
  context: ScopeContext;
  contextId: string;
  ledger: RevisionLedger;
  running: boolean;
  fullRunning: boolean;
  error?: string;
  watchers: FSWatcher[];
  timers: NodeJS.Timeout[];
  scheduled?: NodeJS.Timeout;
  metadataTask?: Promise<void>;
  fullTask?: Promise<void>;
};

let reconciler: ReconcilerState | null = null;

/**
 * Spec 195 §6 — the metadata scan and the full digest scan share ONE bounded
 * file-I/O scheduler. It starts with two concurrent workers; the metadata scan
 * and the known changed paths have priority over the digest fallback.
 */
let fileIoInFlight = 0;
let fileIoPeak = 0;
let fileIoActive = 0;
const fileIoHighPriority: Array<() => void> = [];
const fileIoNormalPriority: Array<() => void> = [];

function drainFileIo(): void {
  while (fileIoActive < DISPLAY_FILE_IO_CONCURRENCY) {
    const job = fileIoHighPriority.shift() ?? fileIoNormalPriority.shift();
    if (!job) return;
    fileIoActive += 1;
    job();
  }
}

function withFileIoSlot<T>(fn: () => Promise<T>, priority: "high" | "normal"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job = () => {
      fileIoInFlight += 1;
      if (fileIoInFlight > fileIoPeak) fileIoPeak = fileIoInFlight;
      void fn().then(resolve, reject).finally(() => {
        fileIoInFlight -= 1;
        fileIoActive -= 1;
        drainFileIo();
      });
    };
    (priority === "high" ? fileIoHighPriority : fileIoNormalPriority).push(job);
    drainFileIo();
  });
}

/** Bounded executor over the shared file-I/O scheduler. */
async function runBounded<T, R>(
  items: readonly T[],
  worker: (item: T) => Promise<R>,
  priority: "high" | "normal" = "high"
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  let cursor = 0;
  const runners = Array.from({ length: Math.min(DISPLAY_FILE_IO_CONCURRENCY, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await withFileIoSlot(() => worker(items[index]), priority);
    }
  });
  await Promise.all(runners);
  return results;
}

/** P0-1 measurement — one structured line per notable event; no payloads, no secrets. */
function probeLog(event: string, fields: Record<string, unknown>): void {
  console.warn(`[display-probe] ${JSON.stringify({ event, t: Date.now(), ...fields })}`);
}
let lastGraceRefusal = "none";
/** Only passes slower than this are logged. */
const PROBE_SLOW_PASS_MS = 1000;

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

async function walkSemanticLayer(dir: string, root: string, out: string[]): Promise<void> {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) return;
    throw error;
  }
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) await walkSemanticLayer(abs, root, out);
    else if (item.isFile() && !isIgnoredSemanticPath(path.relative(root, abs))) out.push(abs);
  }
}

type Discovery = { files: string[]; enumerationError?: string };

/**
 * The watched file set. A semantic layer that cannot be enumerated means the
 * set may hide a Manifest, so D and P cannot be considered covered.
 *
 * Every file is keyed by its canonical id, so the reconciler and the write
 * path agree on one spelling of the same file.
 */
async function discoverWatchedFiles(context: ScopeContext): Promise<Discovery> {
  const files: string[] = [];
  let enumerationError: string | undefined;
  try {
    await walkSemanticLayer(context.semanticLayer, context.semanticLayer, files);
  } catch (error) {
    enumerationError = errorMessage(error);
  }
  files.push(path.join(context.projectRoot, "ktx.yaml"), ...context.accessPaths);
  const canonical = [...new Set(files.map((file) => canonicalFileId(file)))].sort();
  return { files: canonical, enumerationError };
}

function membershipOf(files: readonly string[]): string {
  return files.join("\n");
}

/** The watched set plus the accepted files that are no longer on disk. */
function watchedWithDeletions(files: readonly string[], ledger: RevisionLedger): string[] {
  const known = new Set(files);
  const deleted = ledger.fileIds().filter((file) => !known.has(file));
  return deleted.length === 0 ? [...files] : [...files, ...deleted];
}

type FileProbe = { file: string; meta?: string; error?: string };

/** Which scopes a failure of this file affects. */
function scopesOf(file: string, context: ScopeContext): DisplayScope[] {
  return scopesForPath(file, context);
}

/**
 * Commit guards (Spec 195 §5.2.3): the context, the scope generations, the
 * pending write barrier and the directory membership must all still match the
 * values captured when the pass started.
 *
 * `stable` means the watched file set did not change during the pass — only
 * then may a completion time be advanced. `notify` means nothing else moved,
 * so the observed batch may be committed and invalidate the derived scopes.
 */
type CommitGuard = { stable: boolean; notify: boolean; reason?: DisplayBusyReason };

async function commitGuards(state: ReconcilerState, generation: string, membership: string): Promise<CommitGuard> {
  const current = await currentScopeContext();
  if (scopeContextId(current) !== state.contextId) return { stable: false, notify: false, reason: "context_mismatch" };
  const after = await discoverWatchedFiles(state.context);
  if (after.enumerationError) return { stable: false, notify: false, reason: "reconcile_failed" };
  if (membershipOf(after.files) !== membership) return { stable: false, notify: false, reason: "generation_changed" };
  if (generationKey(DISPLAY_SCOPES) !== generation) return { stable: true, notify: false, reason: "generation_changed" };
  if (hasPendingDisplayWrite(DISPLAY_SCOPES)) return { stable: true, notify: false, reason: "write_pending" };
  return { stable: true, notify: true };
}

/** Scopes whose file set could not be enumerated: a hidden Manifest is possible. */
const ENUMERATION_SENSITIVE: readonly DisplayScope[] = ["D", "P"];

async function runMetadataPass(state: ReconcilerState): Promise<void> {
  const context = state.context;
  const ledger = state.ledger;
  const generation = generationKey(DISPLAY_SCOPES);
  const discovery = await discoverWatchedFiles(context);
  const membership = membershipOf(discovery.files);
  // Files the ledger already accepted but that are no longer on disk are
  // deletions — they must be observed as a missing version, not dropped.
  const watched = watchedWithDeletions(discovery.files, state.ledger);

  const probes = await runBounded<string, FileProbe>(watched, async (file) => {
    try {
      return { file, meta: metaSignature(await stat(file)) };
    } catch (error) {
      if (isEnoent(error)) return { file, meta: MISSING };
      return { file, error: errorMessage(error) };
    }
  }, "high");

  const metaFailures = new Map<DisplayScope, string>();
  const digestFailures = new Map<DisplayScope, string>();
  for (const probe of probes) {
    const scopes = scopesOf(probe.file, context);
    if (probe.error) {
      for (const scope of scopes) metaFailures.set(scope, probe.error);
    }
  }
  if (discovery.enumerationError) {
    for (const scope of ENUMERATION_SENSITIVE) metaFailures.set(scope, discovery.enumerationError);
  }

  // Only files whose metadata signature moved (or that were never accepted)
  // need their content read again. Known changed paths are read first.
  const needsDigest: FileProbe[] = [];
  for (const probe of probes) {
    if (probe.error || probe.meta === undefined || probe.meta === MISSING) continue;
    const accepted = ledger.get(probe.file);
    if (!accepted || accepted.meta !== probe.meta) needsDigest.push(probe);
  }

  const reads = await runBounded<FileProbe, FileProbe & { digest?: string }>(needsDigest, async (probe) => {
    try {
      const read = await readStableRevision(probe.file);
      return { file: probe.file, meta: read.meta, digest: read.digest };
    } catch (error) {
      return { file: probe.file, error: errorMessage(error) };
    }
  }, "high");

  const candidates: RevisionCandidate[] = [];
  for (const probe of probes) {
    if (probe.error || probe.meta === undefined || probe.meta !== MISSING) continue;
    const accepted = ledger.get(probe.file);
    if (accepted && accepted.meta !== MISSING) {
      candidates.push({ fileId: probe.file, meta: MISSING, digest: MISSING, sequence: ledger.nextSequence() });
    }
  }
  for (const read of reads) {
    if (read.error || read.meta === undefined) {
      for (const scope of scopesOf(read.file, context)) digestFailures.set(scope, read.error ?? "read failed");
      continue;
    }
    candidates.push({
      fileId: read.file,
      meta: read.meta,
      digest: read.digest ?? MISSING,
      sequence: ledger.nextSequence()
    });
  }

  const guard = await commitGuards(state, generation, membership);

  // The health of a scope records what this pass could observe. A broken file
  // always marks its scopes unverified, even when the batch is dropped.
  for (const scope of DISPLAY_SCOPES) {
    const failure = metaFailures.get(scope);
    if (failure) markScopeMetadataError(scope, failure);
  }
  for (const scope of DISPLAY_SCOPES) {
    const failure = digestFailures.get(scope);
    if (failure) markScopeDigestError(scope, failure);
  }

  if (!guard.stable) {
    // The file set moved during the pass: the coverage claim is incomplete,
    // so no completion time advances. A re-check is coalesced.
    scheduleReconcile(state);
    return;
  }

  const now = Date.now();
  for (const scope of DISPLAY_SCOPES) {
    if (!metaFailures.has(scope)) markScopeMetadataOk(scope, now);
  }

  if (!guard.notify) {
    // Something else moved meanwhile (a write barrier advanced a generation).
    // The barrier already invalidated the derived data and the write's own
    // final confirmation records the version, so this batch is dropped and a
    // re-check converges the ledger.
    scheduleReconcile(state);
    return;
  }

  const commit = ledger.commit(candidates);
  if (commit.changedScopes.length > 0) {
    probeLog("generation_bump", { pass: "metadata", scopes: commit.changedScopes, candidates: candidates.length });
    bumpDisplayGeneration(commit.changedScopes);
  }
  state.error = undefined;
  // A scope whose digest coverage failed only recovers through a full digest
  // pass — run one now instead of waiting for the 30 s fallback.
  if ([...digestFailures.keys()].length > 0) void sharedFullDigestPass(state);
}

async function runFullDigestPass(state: ReconcilerState): Promise<void> {
  const context = state.context;
  const ledger = state.ledger;
  const generation = generationKey(DISPLAY_SCOPES);
  const discovery = await discoverWatchedFiles(context);
  const membership = membershipOf(discovery.files);

  const reads = await runBounded<string, FileProbe & { digest?: string }>(watchedWithDeletions(discovery.files, ledger), async (file) => {
    try {
      const read = await readStableRevision(file);
      return { file, meta: read.meta, digest: read.digest };
    } catch (error) {
      return { file, error: errorMessage(error) };
    }
  }, "normal");

  const candidates: RevisionCandidate[] = [];
  const digestFailures = new Map<DisplayScope, string>();
  for (const read of reads) {
    if (read.error || read.meta === undefined) {
      for (const scope of scopesOf(read.file, context)) digestFailures.set(scope, read.error ?? "read failed");
      continue;
    }
    candidates.push({ fileId: read.file, meta: read.meta, digest: read.digest ?? MISSING, sequence: ledger.nextSequence() });
  }
  if (discovery.enumerationError) {
    for (const scope of ENUMERATION_SENSITIVE) digestFailures.set(scope, discovery.enumerationError);
  }

  const guard = await commitGuards(state, generation, membership);

  for (const scope of DISPLAY_SCOPES) {
    const failure = digestFailures.get(scope);
    if (failure) markScopeDigestError(scope, failure);
  }
  if (!guard.stable) {
    // The file set moved during the pass: the full coverage claim is
    // incomplete, so no completion time advances.
    scheduleReconcile(state);
    return;
  }
  const now = Date.now();
  for (const scope of DISPLAY_SCOPES) {
    if (!digestFailures.has(scope)) markScopeDigestOk(scope, now);
  }
  if (!guard.notify) {
    scheduleReconcile(state);
    return;
  }

  const commit = ledger.commit(candidates);
  if (commit.changedScopes.length > 0) {
    probeLog("generation_bump", { pass: "digest", scopes: commit.changedScopes, candidates: candidates.length });
    bumpDisplayGeneration(commit.changedScopes);
  }
  state.error = undefined;
}

/** One shared metadata pass — concurrent readers attach to the same task. */
function sharedMetadataPass(state: ReconcilerState): Promise<void> {
  if (!state.metadataTask) {
    const startedAt = Date.now();
    const task = runMetadataPass(state)
      .catch((error) => {
        state.error = errorMessage(error);
      })
      .finally(() => {
        if (Date.now() - startedAt >= PROBE_SLOW_PASS_MS) probeLog("pass", { pass: "metadata", ms: Date.now() - startedAt, files: state.ledger.size, error: state.error ? true : false });
        if (state.metadataTask === task) state.metadataTask = undefined;
      });
    state.metadataTask = task;
  }
  return state.metadataTask;
}

/** One shared full digest pass — concurrent readers attach to the same task. */
function sharedFullDigestPass(state: ReconcilerState): Promise<void> {
  if (!state.fullTask) {
    const startedAt = Date.now();
    const task = runFullDigestPass(state)
      .catch((error) => {
        state.error = errorMessage(error);
      })
      .finally(() => {
        if (Date.now() - startedAt >= PROBE_SLOW_PASS_MS) probeLog("pass", { pass: "digest", ms: Date.now() - startedAt, files: state.ledger.size, error: state.error ? true : false });
        if (state.fullTask === task) state.fullTask = undefined;
      });
    state.fullTask = task;
  }
  return state.fullTask;
}

/**
 * Spec 195 §6 — verification health per dependency scope. A metadata success
 * never clears a digest error, and a scope with no evidence is not verified.
 */
export function displayCacheVerified(
  scopes: readonly DisplayScope[] = SOURCES_SCOPES,
  now: number = Date.now()
): boolean {
  if (!reconciler) return false;
  const health = scopeHealthSnapshot();
  for (const scope of scopes) {
    const entry = health[scope];
    if (!entry) return false;
    if (entry.metadataError) return false;
    if (now - entry.metadataCompletedAt >= METADATA_FRESH_MS) return false;
    if (entry.digestError) return false;
    if (now - entry.digestCompletedAt >= FULL_DIGEST_FRESH_MS) return false;
  }
  return true;
}

function busyReasonFor(scopes: readonly DisplayScope[]): DisplayBusyReason {
  if (!reconciler) return "reconcile_failed";
  if (reconciler.error) return "reconcile_failed";
  const health = scopeHealthSnapshot();
  for (const scope of scopes) {
    const entry = health[scope];
    if (!entry) return "metadata_overdue";
    if (entry.metadataError || entry.digestError) return "reconcile_failed";
  }
  for (const scope of scopes) {
    const entry = health[scope];
    if (!entry) continue;
    if (Date.now() - entry.metadataCompletedAt >= METADATA_FRESH_MS) return "metadata_overdue";
    if (Date.now() - entry.digestCompletedAt >= FULL_DIGEST_FRESH_MS) return "digest_overdue";
  }
  return "metadata_overdue";
}

/** Start (or attach to) the shared passes the scopes need; does not wait. */
function startVerificationTasks(state: ReconcilerState, scopes: readonly DisplayScope[]): Promise<void>[] {
  const health = scopeHealthSnapshot();
  const tasks: Promise<void>[] = [];
  const needsMetadata = scopes.some((scope) => {
    const entry = health[scope];
    return !entry || Date.now() - entry.metadataCompletedAt >= METADATA_FRESH_MS || Boolean(entry.metadataError);
  });
  const needsDigest = scopes.some((scope) => {
    const entry = health[scope];
    return !entry || Date.now() - entry.digestCompletedAt >= FULL_DIGEST_FRESH_MS || Boolean(entry.digestError);
  });
  if (needsMetadata) tasks.push(sharedMetadataPass(state));
  if (needsDigest) tasks.push(sharedFullDigestPass(state));
  return tasks;
}

/**
 * P0-1 — verification is only *aged* (no error, no pending write, same context
 * and generation): the scopes were verified recently enough for a bounded
 * degraded read. Any recorded error or an age beyond the grace limits fails.
 */
function displayCacheWithinGrace(scopes: readonly DisplayScope[], now: number = Date.now()): boolean {
  if (!reconciler || reconciler.error) return false;
  const health = scopeHealthSnapshot();
  for (const scope of scopes) {
    const entry = health[scope];
    if (!entry || entry.metadataError || entry.digestError) return false;
    if (now - entry.metadataCompletedAt >= METADATA_GRACE_MS) return false;
    if (now - entry.digestCompletedAt >= FULL_DIGEST_GRACE_MS) return false;
  }
  return true;
}

/**
 * P0-1 — instead of failing the page with 503 when only the freshness window has
 * lapsed (typically a starved event loop delaying the background pass), serve the
 * already-committed slot for the same key and re-verify in the background. Never
 * builds, never serves across a context or generation change or a pending write.
 */
async function serveWithinGrace(name: string, scopes: readonly DisplayScope[], extraKey: string): Promise<DisplaySnapshotResult | undefined> {
  const state = reconciler;
  const refuse = (cause: string): undefined => { lastGraceRefusal = cause; return undefined; };
  if (!state) return refuse("no_reconciler");
  if (state.error) return refuse("reconciler_error");
  if (!displayCacheWithinGrace(scopes)) return refuse("outside_grace_or_scope_error");
  if (hasPendingDisplayWrite(scopes)) return refuse("write_pending");
  const context = await currentScopeContext();
  if (!displayCacheWithinGrace(scopes)) return refuse("outside_grace_after_context");
  if (hasPendingDisplayWrite(scopes)) return refuse("write_pending_after_context");
  if (!sameContext(state.context, context)) return refuse("context_mismatch");
  const entry = entries.get(name);
  const slot = entry?.current;
  if (!slot) return refuse("no_committed_slot");
  if (slot.key !== keyFor(name, scopes, context, extraKey)) return refuse("slot_key_changed");
  void Promise.all(startVerificationTasks(state, scopes));
  stats.hits += 1;
  stats.graceServes += 1;
  countEntryPerf("displayHits");
  markDisplayCache("hit");
  markDisplayDegraded("grace");
  return { payload: slot.payload, sidecar: slot.sidecar, version: slot.version, cache: "hit", incarnation: slot.incarnation };
}

/**
 * Spec 195 §6 — share the verification task and wait for recovery inside the
 * request's own budget. The task outlives the HTTP subscriber: a cancelled
 * request never releases the work early.
 */
async function ensureVerified(scopes: readonly DisplayScope[], budget: DisplayRequestBudget): Promise<boolean> {
  if (displayCacheVerified(scopes)) return true;
  const state = reconciler;
  if (!state) return false;
  const tasks = startVerificationTasks(state, scopes);
  if (tasks.length === 0) return false;
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) return displayCacheVerified(scopes);
  await Promise.race([
    Promise.all(tasks),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      timer.unref?.();
    })
  ]);
  return displayCacheVerified(scopes);
}

/** Reconciliation is healthy *and* watching exactly this scope context. */
function verifiedFor(context: ScopeContext, scopes: readonly DisplayScope[]): boolean {
  return displayCacheVerified(scopes) && reconciler !== null && sameContext(reconciler.context, context);
}

function invalidBuildReason(name: string, entry: Entry, scopes: readonly DisplayScope[], context: ScopeContext, slot: Slot, extraKey: string): DisplayBusyReason | undefined {
  if (!verifiedFor(context, scopes)) {
    return reconciler && !sameContext(reconciler.context, context) ? "context_mismatch" : busyReasonFor(scopes);
  }
  if (entries.get(name) !== entry || hasPendingDisplayWrite(scopes) || keyFor(name, scopes, context, extraKey) !== slot.key) {
    return "generation_changed";
  }
}

/** Shared work owns validation and publication even after all readers have timed out. */
function startDisplayBuild(name: string, entry: Entry, key: string, scopes: readonly DisplayScope[], extraKey: string, build: DisplayBuild): BuildTask {
  const task: BuildTask = { readers: new Set() };
  entry.inflight.set(key, task);
  inflightBuilds += 1;
  const finish = (outcome: BuildOutcome) => {
    entry.inflight.delete(key);
    inflightBuilds -= 1;
    for (const notify of task.readers) notify(outcome);
  };
  const publish = async (): Promise<BuildOutcome> => {
    let slot: Slot;
    try {
      slot = await buildSlot(key, build);
    } catch (error) {
      entry.failure = { key, until: Date.now() + DISPLAY_BUILD_FAILURE_BACKOFF_MS, error };
      return { error };
    }
    const context = await currentScopeContext();
    const reason = invalidBuildReason(name, entry, scopes, context, slot, extraKey);
    if (reason) return { reason };
    entry.current = slot;
    entry.failure = undefined;
    return { slot, context };
  };
  void publish().then(finish, (error: unknown) => finish({ error }));
  return task;
}

function waitForDisplayBuild(task: BuildTask, deadline: number): Promise<BuildOutcome> {
  return new Promise((resolve) => {
    const unsubscribe = () => task.readers.delete(onComplete);
    const timedOut: BuildOutcome = { reason: "build_wait_timeout" };
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(timedOut);
    }, Math.max(0, Math.ceil(deadline - performance.now())));
    const onComplete = (outcome: BuildOutcome) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(performance.now() < deadline ? outcome : timedOut);
    };
    task.readers.add(onComplete);
  });
}

// ─── committed view served during a note-only write (P1-75 §2.1) ────────────

/**
 * A verified, complete committed view that independent readers may keep using
 * while ONE write barrier is pending. `companion` carries the inputs the
 * reader needs to stay on that same committed revision (e.g. the raw access
 * text the slot was built from), so a reader never stitches live mid-write
 * content with the committed slot.
 *
 * Eligibility is deliberately narrow and short-lived: it is opened as the very
 * first synchronous action inside the write's own barrier. The write's OWN
 * nested file barriers (same async chain, see `runWithCommittedViewServe`) do
 * not count as change; any other generation movement — another writer, an
 * external change seen by the reconciler, the end of this write — withdraws it
 * synchronously, before that mutation can touch the disk.
 */
export type CommittedDisplayView<T = unknown> = {
  readonly name: string;
  readonly scopes: readonly DisplayScope[];
  readonly companion: T;
  /** @internal */ readonly slot: Slot;
  /** @internal */ readonly context: ScopeContext;
  /** @internal generations observed when the view was captured (no write pending) */
  readonly capturedGenerations: Readonly<Record<DisplayScope, number>>;
  /** @internal true while readers may be served */
  open: boolean;
};

const serveLeases = new Map<string, CommittedDisplayView<unknown>>();
const ownWrite = new AsyncLocalStorage<CommittedDisplayView>();
let leaseListenerInstalled = false;

/** A generation bump that does not come from the owning write withdraws its view at once. */
function installLeaseListener(): void {
  if (leaseListenerInstalled) return;
  leaseListenerInstalled = true;
  onDisplayGenerationChange((changed) => {
    const own = ownWrite.getStore();
    for (const view of [...serveLeases.values()]) {
      if (view !== own && changed.some((scope) => view.scopes.includes(scope))) withdrawCommittedViewServe(view);
    }
  });
}

/** Run the write so its own nested barrier bumps are recognised as this view's own. */
export function runWithCommittedViewServe<R>(view: CommittedDisplayView | null, fn: () => Promise<R>): Promise<R> {
  return view ? ownWrite.run(view, fn) : fn();
}

/**
 * Capture the current verified committed view (async part, BEFORE the barrier
 * begins). Returns null unless the entry's current slot is exactly the
 * `extraKey` revision at the current generation, nothing is pending and the
 * reconciler verifies these scopes for this context.
 */
export async function captureCommittedDisplayView<T>(
  name: string,
  scopes: readonly DisplayScope[],
  extraKey: string,
  companion: T
): Promise<CommittedDisplayView<T> | null> {
  const capturedGenerations = displayGenerations();
  const context = await currentScopeContext();
  if (hasPendingDisplayWrite(scopes) || !verifiedFor(context, scopes)) return null;
  const current = entries.get(name)?.current;
  if (!current || current.key !== keyFor(name, scopes, context, extraKey)) return null;
  // A barrier that began and ended while we awaited would have moved a generation.
  const now = displayGenerations();
  if (scopes.some((scope) => now[scope] !== capturedGenerations[scope])) return null;
  return { name, scopes: [...scopes], companion, slot: current, context, capturedGenerations, open: false };
}

/**
 * Open the view for readers. MUST be the first synchronous action inside the
 * write barrier callback: the only generation movement since capture may be
 * this write's own begin (+1 on exactly its scopes).
 */
export function openCommittedViewServe(view: CommittedDisplayView, token: DisplayWriteToken): boolean {
  if (token.ended || !hasPendingDisplayWrite(view.scopes)) return false;
  const now = displayGenerations();
  const exact = view.scopes.every(
    (scope) => now[scope] === view.capturedGenerations[scope] + (token.scopes.includes(scope) ? 1 : 0)
  );
  if (!exact || !token.scopes.some((scope) => view.scopes.includes(scope))) return false;
  installLeaseListener();
  view.open = true;
  serveLeases.set(view.name, view);
  return true;
}

/** Withdraw eligibility. Safe to call repeatedly or for a view that never opened. */
export function withdrawCommittedViewServe(viewOrName: CommittedDisplayView | string): void {
  const name = typeof viewOrName === "string" ? viewOrName : viewOrName.name;
  const open = serveLeases.get(name);
  if (!open || (typeof viewOrName !== "string" && open !== viewOrName)) return;
  open.open = false;
  serveLeases.delete(name);
}

/** The view is still open, its write still pending, its slot current and the scopes verified right now. */
export function committedViewServeValid(view: CommittedDisplayView): boolean {
  if (!view.open || serveLeases.get(view.name) !== view) return false;
  // Recovery state is part of the equivalence: a closed recovery latch refuses (and withdraws) the view.
  if (getAccessRecoveryStateSync().required) {
    withdrawCommittedViewServe(view);
    return false;
  }
  if (!hasPendingDisplayWrite(view.scopes) || entries.get(view.name)?.current !== view.slot) return false;
  return displayCacheVerified(view.scopes) && reconciler !== null && sameContext(reconciler.context, view.context);
}

/** The open committed view for `name` that independent readers may use now, if any. */
export function activeCommittedView<T = unknown>(name: string): CommittedDisplayView<T> | null {
  const view = serveLeases.get(name);
  return view && committedViewServeValid(view) ? (view as CommittedDisplayView<T>) : null;
}

function serveCommittedView(
  name: string,
  scopes: readonly DisplayScope[],
  view: CommittedDisplayView,
  budget: DisplayRequestBudget
): DisplaySnapshotResult {
  // A served attempt is an attempt: the route's retry loop shares this budget.
  const hadAttempt = budget.attemptsLeft > 0;
  if (hadAttempt) budget.attemptsLeft -= 1;
  const sameScopes = view.name === name && view.scopes.length === scopes.length && scopes.every((scope) => view.scopes.includes(scope));
  if (hadAttempt && sameScopes && committedViewServeValid(view)) {
    lastRequest = { name, scopes: [...scopes], attempts: 1 };
    stats.hits += 1;
    countEntryPerf("displayHits");
    markDisplayCache("hit");
    const slot = view.slot;
    return { payload: slot.payload, sidecar: slot.sidecar, version: slot.version, cache: "hit", incarnation: slot.incarnation };
  }
  stats.busy += 1;
  busyByReason.set("generation_changed", (busyByReason.get("generation_changed") ?? 0) + 1);
  recordBusyEvent({ name, reason: "generation_changed", attempts: 1, committedView: true });
  lastRequest = { name, scopes: [...scopes], attempts: 1, reason: "generation_changed" };
  throw new DisplaySnapshotBusyError("generation_changed");
}

/**
 * getSnapshot(keyScope) from Spec 174 §7. Auth already ran in the onRequest
 * hook for this request (cache hit, miss and in-flight attach alike).
 *
 * `committedView` (P1-75): serve this already-committed view while its single
 * note-only write is pending; if the view is no longer valid the call fails
 * with a retryable busy error and never builds from its (stale) companion.
 */
export async function getDisplaySnapshot(
  name: string,
  scopes: readonly DisplayScope[],
  build: DisplayBuild,
  options: { extraKey?: string; budget?: DisplayRequestBudget; committedView?: CommittedDisplayView } = {}
): Promise<DisplaySnapshotResult> {
  const extraKey = options.extraKey ?? "";
  const budget = options.budget ?? createDisplayRequestBudget();
  if (options.committedView) return serveCommittedView(name, scopes, options.committedView, budget);
  let reason: DisplayBusyReason = "metadata_overdue";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_DISPLAY_ATTEMPTS; attempt += 1) {
    if (budget.attemptsLeft <= 0) break;
    budget.attemptsLeft -= 1;
    attempts += 1;
    if (!displayCacheVerified(scopes)) {
      const grace = await serveWithinGrace(name, scopes, extraKey);
      if (grace) {
        lastRequest = { name, scopes: [...scopes], attempts };
        return grace;
      }
    }
    if (!(await ensureVerified(scopes, budget))) {
      reason = busyReasonFor(scopes);
      break;
    }
    if (hasPendingDisplayWrite(scopes)) {
      const remaining = budget.deadline - Date.now();
      if (remaining <= 0) {
        reason = "write_pending";
        break;
      }
      if (!(await waitForDisplayWritesSettled(scopes, remaining))) {
        reason = "write_pending";
        break;
      }
    }
    const context = await currentScopeContext();
    if (!verifiedFor(context, scopes)) {
      // P0-1：等待上下文期间新鲜窗可能刚好过期（事件循环被占）；仍在宽限内则服务已提交快照。
      const grace = await serveWithinGrace(name, scopes, extraKey);
      if (grace) {
        lastRequest = { name, scopes: [...scopes], attempts };
        return grace;
      }
      reason = reconciler && !sameContext(reconciler.context, context) ? "context_mismatch" : busyReasonFor(scopes);
      break;
    }
    const key = keyFor(name, scopes, context, extraKey);
    const entry = entryFor(name);
    if (entry.current?.key === key && !hasPendingDisplayWrite(scopes)) {
      lastRequest = { name, scopes: [...scopes], attempts };
      stats.hits += 1;
      countEntryPerf("displayHits");
      markDisplayCache("hit");
      return { payload: entry.current.payload, sidecar: entry.current.sidecar, version: entry.current.version, cache: "hit", incarnation: entry.current.incarnation };
    }
    if (entry.failure && entry.failure.key === key && Date.now() < entry.failure.until) {
      throw entry.failure.error;
    }
    if (performance.now() >= budget.buildDeadline) {
      reason = "build_wait_timeout";
      break;
    }
    let task = entry.inflight.get(key);
    if (!task) {
      if (inflightBuilds >= MAX_CONCURRENT_DISPLAY_BUILDS) {
        reason = "build_capacity";
        break;
      }
      task = startDisplayBuild(name, entry, key, scopes, extraKey, build);
    }
    const outcome = await waitForDisplayBuild(task, budget.buildDeadline);
    if ("error" in outcome) throw outcome.error;
    if ("reason" in outcome) {
      reason = outcome.reason;
      if (reason === "generation_changed") continue;
      break;
    }
    const { slot, context: publishedContext } = outcome;
    const invalid = invalidBuildReason(name, entry, scopes, publishedContext, slot, extraKey);
    if (invalid) {
      reason = invalid;
      if (reason === "generation_changed") continue;
      break;
    }
    lastRequest = { name, scopes: [...scopes], attempts };
    stats.misses += 1;
    countEntryPerf("displayMisses");
    markDisplayCache("miss");
    return { payload: slot.payload, sidecar: slot.sidecar, version: slot.version, cache: "miss", incarnation: slot.incarnation };
  }
  stats.busy += 1;
  busyByReason.set(reason, (busyByReason.get(reason) ?? 0) + 1);
  {
    const now = Date.now();
    const ages = Object.fromEntries(Object.entries(scopeHealthSnapshot()).map(([scope, e]) => [scope, { m: now - e.metadataCompletedAt, d: now - e.digestCompletedAt, me: Boolean(e.metadataError), de: Boolean(e.digestError) }]));
    const metaTask = Boolean(reconciler?.metadataTask);
    const fullTask = Boolean(reconciler?.fullTask);
    probeLog("busy", { name, reason, graceRefusal: lastGraceRefusal, attempts, ages, metaTask, fullTask });
    recordBusyEvent({ name, reason, lastGraceRefusal, attempts, ages, metaTask, fullTask });
  }
  lastRequest = { name, scopes: [...scopes], attempts, reason };
  throw new DisplaySnapshotBusyError(reason);
}

function installWatchers(state: ReconcilerState): void {
  const trigger = () => scheduleReconcile(state);
  const add = (target: string, options: { recursive: boolean }, filter?: (name: string) => boolean) => {
    try {
      const watcher = watch(target, { recursive: options.recursive, persistent: false }, (_event, name) => {
        if (!filter || (name && filter(String(name)))) trigger();
      });
      watcher.on("error", () => undefined);
      state.watchers.push(watcher);
    } catch {
      // Watcher unavailable: the 1 s metadata reconciliation still covers changes.
    }
  };
  add(state.context.semanticLayer, { recursive: true });
  add(state.context.projectRoot, { recursive: false }, (name) => name === "ktx.yaml");
  for (const accessPath of state.context.accessPaths) {
    add(path.dirname(accessPath), { recursive: false }, (name) => name === path.basename(accessPath));
  }
}

function closeWatchers(state: ReconcilerState): void {
  for (const watcher of state.watchers) watcher.close();
  state.watchers = [];
}

function scheduleReconcile(state: ReconcilerState): void {
  if (state.scheduled || reconciler !== state) return;
  state.scheduled = setTimeout(() => {
    state.scheduled = undefined;
    void reconcileMetadata(state);
  }, 30);
  state.scheduled.unref?.();
}

export async function reconcileMetadata(state: ReconcilerState | null = reconciler): Promise<void> {
  if (!state || reconciler !== state) return;
  await sharedMetadataPass(state);
}

export async function reconcileFullDigest(state: ReconcilerState | null = reconciler): Promise<void> {
  if (!state || reconciler !== state) return;
  await sharedFullDigestPass(state);
}

/**
 * Baseline the ledger and the verification health. The initial observation is
 * not a change: it only establishes what "unchanged" means for this context.
 */
async function baselineReconciler(state: ReconcilerState): Promise<void> {
  const context = state.context;
  const discovery = await discoverWatchedFiles(context);
  const ledger = state.ledger;
  const reads = await runBounded<string, FileProbe & { digest?: string }>(discovery.files, async (file) => {
    try {
      const read = await readStableRevision(file);
      return { file, meta: read.meta, digest: read.digest };
    } catch (error) {
      return { file, error: errorMessage(error) };
    }
  }, "high");

  const candidates: RevisionCandidate[] = [];
  const digestFailures = new Map<DisplayScope, string>();
  for (const read of reads) {
    if (read.error || read.meta === undefined) {
      for (const scope of scopesOf(read.file, context)) digestFailures.set(scope, read.error ?? "read failed");
      candidates.push({ fileId: read.file, meta: MISSING, digest: MISSING, sequence: ledger.nextSequence() });
      continue;
    }
    candidates.push({ fileId: read.file, meta: read.meta, digest: read.digest ?? MISSING, sequence: ledger.nextSequence() });
  }
  ledger.commit(candidates);

  const now = Date.now();
  for (const scope of DISPLAY_SCOPES) {
    const failure = digestFailures.get(scope) ?? (discovery.enumerationError && ENUMERATION_SENSITIVE.includes(scope) ? discovery.enumerationError : undefined);
    if (failure) {
      markScopeMetadataError(scope, failure);
      markScopeDigestError(scope, failure);
    } else {
      markScopeMetadataOk(scope, now);
      markScopeDigestOk(scope, now);
    }
  }
}

export async function startDisplayReconciler(options: { metadataIntervalMs?: number; fullDigestIntervalMs?: number } = {}): Promise<() => void> {
  stopDisplayReconciler();
  const context = await currentScopeContext();
  resetRevisionLedger();
  const ledger = ensureRevisionLedger(context);
  const state: ReconcilerState = {
    context,
    contextId: scopeContextId(context),
    ledger,
    running: false,
    fullRunning: false,
    watchers: [],
    timers: []
  };
  reconciler = state;
  try {
    await baselineReconciler(state);
  } catch (error) {
    // Stay unverified (busy) and let the timers retry until reconciliation recovers.
    state.error = errorMessage(error);
  }
  // Nothing that happened while unverified was observed: no earlier snapshot or build may be served.
  entries.clear();
  serveLeases.clear();
  bumpDisplayGeneration(["D", "P", "C"]);
  installWatchers(state);
  const metaTimer = setInterval(() => void reconcileMetadata(state), options.metadataIntervalMs ?? METADATA_INTERVAL_MS);
  const fullTimer = setInterval(() => void reconcileFullDigest(state), options.fullDigestIntervalMs ?? FULL_DIGEST_INTERVAL_MS);
  metaTimer.unref?.();
  fullTimer.unref?.();
  state.timers.push(metaTimer, fullTimer);
  return () => {
    if (reconciler === state) stopDisplayReconciler();
  };
}

/**
 * Server lifecycle hook: keep a running reconciler for the current scope
 * context, or (re)start one. The returned stopper only stops a reconciler this
 * call started, so closing one server does not unverify another's.
 */
export async function ensureDisplayReconciler(): Promise<() => void> {
  if (reconciler && sameContext(reconciler.context, await currentScopeContext())) return () => undefined;
  return startDisplayReconciler();
}

export function stopDisplayReconciler(): void {
  if (!reconciler) return;
  const state = reconciler;
  reconciler = null;
  closeWatchers(state);
  for (const timer of state.timers) clearInterval(timer);
  if (state.scheduled) clearTimeout(state.scheduled);
  resetRevisionLedger();
}

// ─── prewarm / test hooks ───────────────────────────────────────────────────

const prewarmers = new Map<string, () => Promise<unknown>>();

export function registerDisplayPrewarmer(name: string, fn: () => Promise<unknown>): void {
  prewarmers.set(name, fn);
}

/** Startup prewarm after policy commit + catalog scan; failure only degrades display. */
export async function prewarmDisplaySnapshots(): Promise<void> {
  for (const [name, fn] of prewarmers) {
    try {
      await fn();
    } catch (error) {
      // Spec 195 §7 — internal logs carry no absolute path, token or secret.
      console.warn(`[display-snapshot] prewarm ${name} failed: ${sanitizeDiagnosticMessage(errorMessage(error))}`);
    }
  }
}

/** Test / fixture IPC hook: drop every snapshot, failure and in-flight reference. */
export function resetDisplaySnapshotsForTests(): void {
  entries.clear();
  serveLeases.clear();
  stats = { builds: 0, hits: 0, misses: 0, busy: 0, graceServes: 0 };
  busyByReason.clear();
  busyEvents.length = 0;
  resetRevisionLedger();
}

export function displaySnapshotDiagnostics() {
  const health = scopeHealthSnapshot();
  const now = Date.now();
  const scopeAges = Object.fromEntries(
    Object.entries(health).map(([scope, entry]) => [
      scope,
      {
        metadataAgeMs: now - entry.metadataCompletedAt,
        digestAgeMs: now - entry.digestCompletedAt,
        metadataError: entry.metadataError ?? null,
        digestError: entry.digestError ?? null
      }
    ])
  );
  return {
    verified: displayCacheVerified(),
    reconcilerRunning: reconciler !== null,
    reconcilerError: reconciler?.error ? sanitizeDiagnosticMessage(reconciler.error) : null,
    inflightBuilds,
    fileIoInFlight,
    fileIoPeak,
    entries: [...entries.entries()].map(([name, entry]) => ({
      name,
      hasCurrent: Boolean(entry.current),
      inflight: entry.inflight.size,
      owner: entry.inflight.size > 0,
      attached: entry.inflight.size > 1
    })),
    scopeHealth: health,
    scopeAges,
    watchedFiles: currentRevisionLedger()?.size ?? 0,
    busyByReason: Object.fromEntries(busyByReason),
    lastRequest: lastRequest ? { ...lastRequest } : null,
    ...stats
  };
}
