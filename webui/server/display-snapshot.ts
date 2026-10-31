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
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { countEntryPerf, markDisplayBuild, markDisplayCache } from "./entry-performance-timing";
import {
  bumpDisplayGeneration,
  canonicalFileId,
  currentScopeContext,
  DISPLAY_SCOPES,
  generationKey,
  hasPendingDisplayWrite,
  isIgnoredSemanticPath,
  scopesForPath,
  waitForDisplayWritesSettled,
  type DisplayScope,
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
/** Spec 195 §6 — file I/O starts with two concurrent workers. */
export const DISPLAY_FILE_IO_CONCURRENCY = 2;

const METADATA_INTERVAL_MS = 1000;
const FULL_DIGEST_INTERVAL_MS = 30_000;
/** Metadata older than this, or a full digest older than 31 s, means "not verified". */
const METADATA_FRESH_MS = 3000;
const FULL_DIGEST_FRESH_MS = 31_000;

/** Scopes a display snapshot may depend on. `sources` needs D+P+C, Agent permissions need P+C. */
export const SOURCES_SCOPES: readonly DisplayScope[] = ["D", "P", "C"];
export const AGENT_PERMISSION_SCOPES: readonly DisplayScope[] = ["P", "C"];

export type DisplayBusyReason =
  | "metadata_overdue"
  | "digest_overdue"
  | "reconcile_failed"
  | "write_pending"
  | "build_capacity"
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

type Slot = { key: string; payload: string; sidecar?: string; version: string; builtAt: number };
type Entry = { current?: Slot; inflight: Map<string, Promise<Slot>>; failure?: { key: string; until: number; error: unknown } };

const entries = new Map<string, Entry>();
let inflightBuilds = 0;
let stats = { builds: 0, hits: 0, misses: 0, busy: 0 };
const busyByReason = new Map<DisplayBusyReason, number>();
/** Spec 195 §7 — request correlation for the diagnostics (no payload, no secrets). */
let lastRequest: { name: string; scopes: DisplayScope[]; attempts: number; reason?: DisplayBusyReason } | null = null;

export type DisplaySnapshotResult = { payload: string; sidecar?: string; version: string; cache: "hit" | "miss" };
/**
 * A build returns the serialized payload, optionally with a small serialized
 * sidecar (e.g. compile inputs) the handler evaluates per response.
 */
export type DisplayBuild = (version: string) => Promise<string | { payload: string; sidecar: string }>;

/**
 * Spec 195 §6 — one request budget: at most three attempts in total and one
 * shared recovery wait. The route layer and the snapshot layer draw from the
 * same budget, so nested retries cannot multiply.
 */
export type DisplayRequestBudget = {
  attemptsLeft: number;
  deadline: number;
};

export function createDisplayRequestBudget(
  attempts: number = MAX_DISPLAY_ATTEMPTS,
  waitBudgetMs: number = DISPLAY_RECOVERY_WAIT_BUDGET_MS
): DisplayRequestBudget {
  return { attemptsLeft: attempts, deadline: Date.now() + waitBudgetMs };
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
  inflightBuilds += 1;
  stats.builds += 1;
  countEntryPerf("displayBuilds");
  markDisplayBuild();
  try {
    const version = versionOf(key);
    const built = await build(version);
    return typeof built === "string"
      ? { key, payload: built, version, builtAt: Date.now() }
      : { key, payload: built.payload, sidecar: built.sidecar, version, builtAt: Date.now() };
  } finally {
    inflightBuilds -= 1;
  }
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
  if (commit.changedScopes.length > 0) bumpDisplayGeneration(commit.changedScopes);
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
  if (commit.changedScopes.length > 0) bumpDisplayGeneration(commit.changedScopes);
  state.error = undefined;
}

/** One shared metadata pass — concurrent readers attach to the same task. */
function sharedMetadataPass(state: ReconcilerState): Promise<void> {
  if (!state.metadataTask) {
    const task = runMetadataPass(state)
      .catch((error) => {
        state.error = errorMessage(error);
      })
      .finally(() => {
        if (state.metadataTask === task) state.metadataTask = undefined;
      });
    state.metadataTask = task;
  }
  return state.metadataTask;
}

/** One shared full digest pass — concurrent readers attach to the same task. */
function sharedFullDigestPass(state: ReconcilerState): Promise<void> {
  if (!state.fullTask) {
    const task = runFullDigestPass(state)
      .catch((error) => {
        state.error = errorMessage(error);
      })
      .finally(() => {
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

/**
 * Spec 195 §6 — share the verification task and wait for recovery inside the
 * request's own budget. The task outlives the HTTP subscriber: a cancelled
 * request never releases the work early.
 */
async function ensureVerified(scopes: readonly DisplayScope[], budget: DisplayRequestBudget): Promise<boolean> {
  if (displayCacheVerified(scopes)) return true;
  const state = reconciler;
  if (!state) return false;
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

/**
 * getSnapshot(keyScope) from Spec 174 §7. Auth already ran in the onRequest
 * hook for this request (cache hit, miss and in-flight attach alike).
 */
export async function getDisplaySnapshot(
  name: string,
  scopes: readonly DisplayScope[],
  build: DisplayBuild,
  options: { extraKey?: string; budget?: DisplayRequestBudget } = {}
): Promise<DisplaySnapshotResult> {
  const extraKey = options.extraKey ?? "";
  const budget = options.budget ?? createDisplayRequestBudget();
  let reason: DisplayBusyReason = "metadata_overdue";
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_DISPLAY_ATTEMPTS; attempt += 1) {
    if (budget.attemptsLeft <= 0) break;
    budget.attemptsLeft -= 1;
    attempts += 1;
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
      return { payload: entry.current.payload, sidecar: entry.current.sidecar, version: entry.current.version, cache: "hit" };
    }
    if (entry.failure && entry.failure.key === key && Date.now() < entry.failure.until) {
      throw entry.failure.error;
    }
    let promise = entry.inflight.get(key);
    const owner = !promise;
    if (!promise) {
      if (inflightBuilds >= MAX_CONCURRENT_DISPLAY_BUILDS) {
        reason = "build_capacity";
        break;
      }
      promise = buildSlot(key, build);
      entry.inflight.set(key, promise);
    }
    const started = promise;
    // The owner keeps the in-flight entry until its publish decision, so
    // late arrivals attach instead of starting a duplicate build.
    const release = () => {
      if (owner && entry.inflight.get(key) === started) entry.inflight.delete(key);
    };
    let slot: Slot;
    try {
      slot = await started;
    } catch (error) {
      if (owner) entry.failure = { key, until: Date.now() + DISPLAY_BUILD_FAILURE_BACKOFF_MS, error };
      release();
      throw error;
    }
    // Publish / return only if still verified and nothing changed while building;
    // otherwise retry with the new key (or end busy).
    let nowContext: ScopeContext;
    try {
      nowContext = await currentScopeContext();
    } finally {
      release();
    }
    if (!verifiedFor(nowContext, scopes)) {
      reason = reconciler && !sameContext(reconciler.context, nowContext) ? "context_mismatch" : busyReasonFor(scopes);
      break;
    }
    if (!hasPendingDisplayWrite(scopes) && keyFor(name, scopes, nowContext, extraKey) === slot.key) {
      if (entry.current?.key !== slot.key) entry.current = slot;
      entry.failure = undefined;
      lastRequest = { name, scopes: [...scopes], attempts };
      stats.misses += 1;
      countEntryPerf("displayMisses");
      markDisplayCache("miss");
      return { payload: slot.payload, sidecar: slot.sidecar, version: slot.version, cache: "miss" };
    }
    reason = "generation_changed";
  }
  stats.busy += 1;
  busyByReason.set(reason, (busyByReason.get(reason) ?? 0) + 1);
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
  stats = { builds: 0, hits: 0, misses: 0, busy: 0 };
  busyByReason.clear();
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
