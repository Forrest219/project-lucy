/**
 * Spec 174 §3.2 / §7 — versioned display snapshots.
 *
 * Only display-derived data is cached here (catalog summaries, Agent list
 * permission previews). Runtime authorization, save validation, dryRun and
 * previews never read it. Payloads are stored pre-serialized, so consumers
 * cannot mutate a published snapshot.
 *
 * The cache is only trusted while the reconciler runs: fs.watch triggers +
 * 1 s metadata reconciliation + 30 s full-content digest. Without a healthy
 * reconciler (tests, failed watchers, overdue digest) every request builds
 * from disk ("bypass"), which is always correct.
 */
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { countEntryPerf, markDisplayBuild, markDisplayCache } from "./entry-performance-timing";
import {
  bumpDisplayGeneration,
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

export const DISPLAY_SNAPSHOT_BUSY = "DISPLAY_SNAPSHOT_BUSY";
export const MAX_CONCURRENT_DISPLAY_BUILDS = 4;
export const DISPLAY_BUILD_FAILURE_BACKOFF_MS = 1000;
const MAX_ATTEMPTS = 3;
const PENDING_WRITE_WAIT_MS = 1500;
const METADATA_INTERVAL_MS = 1000;
const FULL_DIGEST_INTERVAL_MS = 30_000;
/** Metadata older than this, or a full digest older than 31 s, means "not verified". */
const METADATA_FRESH_MS = 3000;
const FULL_DIGEST_FRESH_MS = 31_000;

export class DisplaySnapshotBusyError extends Error {
  code = DISPLAY_SNAPSHOT_BUSY;
  statusCode = 503;
  retryAfterSeconds = 1;

  constructor() {
    super("页面数据暂时无法完成刷新，请稍后重试。");
    this.name = "DisplaySnapshotBusyError";
  }
}

type Slot = { key: string; payload: string; version: string; builtAt: number };
type Entry = { current?: Slot; inflight: Map<string, Promise<Slot>>; failure?: { key: string; until: number; error: unknown } };

const entries = new Map<string, Entry>();
let inflightBuilds = 0;
let stats = { builds: 0, hits: 0, misses: 0, bypass: 0, busy: 0 };

export type DisplaySnapshotResult = { payload: string; version: string; cache: "hit" | "miss" | "bypass" };
/** `version` is null for uncached (bypass) builds, which should derive a content version. */
export type DisplayBuild = (version: string | null) => Promise<string>;

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

async function buildSlot(key: string, build: DisplayBuild, cached = true): Promise<Slot> {
  inflightBuilds += 1;
  stats.builds += 1;
  countEntryPerf("displayBuilds");
  markDisplayBuild();
  try {
    const version = versionOf(key);
    return { key, payload: await build(cached ? version : null), version, builtAt: Date.now() };
  } finally {
    inflightBuilds -= 1;
  }
}

/**
 * getSnapshot(keyScope) from Spec 174 §7. Auth already ran in the onRequest
 * hook for this request (cache hit, miss and in-flight attach alike).
 */
export async function getDisplaySnapshot(
  name: string,
  scopes: readonly DisplayScope[],
  build: DisplayBuild,
  options: { extraKey?: string } = {}
): Promise<DisplaySnapshotResult> {
  const extraKey = options.extraKey ?? "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (!displayCacheVerified()) {
      const context = await currentScopeContext();
      const slot = await buildSlot(keyFor(name, scopes, context, extraKey), build, false);
      stats.bypass += 1;
      markDisplayCache("bypass");
      return { payload: slot.payload, version: slot.version, cache: "bypass" };
    }
    if (hasPendingDisplayWrite(scopes) && !(await waitForDisplayWritesSettled(scopes, PENDING_WRITE_WAIT_MS))) {
      break;
    }
    const context = await currentScopeContext();
    const key = keyFor(name, scopes, context, extraKey);
    const entry = entryFor(name);
    if (entry.current?.key === key && !hasPendingDisplayWrite(scopes)) {
      stats.hits += 1;
      countEntryPerf("displayHits");
      markDisplayCache("hit");
      return { payload: entry.current.payload, version: entry.current.version, cache: "hit" };
    }
    if (entry.failure && entry.failure.key === key && Date.now() < entry.failure.until) {
      throw entry.failure.error;
    }
    let promise = entry.inflight.get(key);
    const owner = !promise;
    if (!promise) {
      if (inflightBuilds >= MAX_CONCURRENT_DISPLAY_BUILDS) break;
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
    // Publish only if nothing changed while building; otherwise retry with the new key.
    let nowKey: string;
    try {
      nowKey = keyFor(name, scopes, await currentScopeContext(), extraKey);
    } finally {
      release();
    }
    if (!hasPendingDisplayWrite(scopes) && nowKey === slot.key) {
      if (entry.current?.key !== slot.key) entry.current = slot;
      entry.failure = undefined;
      stats.misses += 1;
      countEntryPerf("displayMisses");
      markDisplayCache("miss");
      return { payload: slot.payload, version: slot.version, cache: "miss" };
    }
  }
  stats.busy += 1;
  throw new DisplaySnapshotBusyError();
}

// ─── reconciler ─────────────────────────────────────────────────────────────

type FileMeta = Map<string, string>;

type ReconcilerState = {
  context: ScopeContext;
  meta: FileMeta;
  contentHashes: Map<string, string>;
  lastMetaAt: number;
  lastFullAt: number;
  running: boolean;
  fullRunning: boolean;
  error?: string;
  watchers: FSWatcher[];
  timers: NodeJS.Timeout[];
  scheduled?: NodeJS.Timeout;
};

let reconciler: ReconcilerState | null = null;

export function displayCacheVerified(now = Date.now()): boolean {
  if (!reconciler || reconciler.error) return false;
  return now - reconciler.lastMetaAt < METADATA_FRESH_MS && now - reconciler.lastFullAt < FULL_DIGEST_FRESH_MS;
}

async function walkSemanticLayer(dir: string, root: string, out: string[]): Promise<void> {
  let items;
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const item of items) {
    if (item.name.startsWith(".")) continue;
    const abs = path.join(dir, item.name);
    if (item.isDirectory()) await walkSemanticLayer(abs, root, out);
    else if (item.isFile() && !isIgnoredSemanticPath(path.relative(root, abs))) out.push(abs);
  }
}

async function watchedFiles(context: ScopeContext): Promise<string[]> {
  const files: string[] = [];
  await walkSemanticLayer(context.semanticLayer, context.semanticLayer, files);
  files.push(path.join(context.projectRoot, "ktx.yaml"), ...context.accessPaths);
  return [...new Set(files)].sort();
}

async function scanMetadata(context: ScopeContext): Promise<FileMeta> {
  const meta: FileMeta = new Map();
  for (const file of await watchedFiles(context)) {
    try {
      const info = await stat(file);
      meta.set(file, `${info.size}:${info.mtimeMs}:${info.ino}:${info.ctimeMs}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      meta.set(file, "missing");
    }
  }
  return meta;
}

async function hashContents(files: Iterable<string>): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const file of files) {
    try {
      hashes.set(file, createHash("sha256").update(await readFile(file)).digest("hex"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      hashes.set(file, "missing");
    }
  }
  return hashes;
}

function changedScopes(before: Map<string, string>, after: Map<string, string>, context: ScopeContext): DisplayScope[] {
  const scopes = new Set<DisplayScope>();
  for (const file of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(file) !== after.get(file)) for (const scope of scopesForPath(file, context)) scopes.add(scope);
  }
  return [...scopes];
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
  if (!state || state.running || reconciler !== state) return;
  state.running = true;
  try {
    const next = await scanMetadata(state.context);
    const scopes = changedScopes(state.meta, next, state.context);
    const ktxYaml = path.join(state.context.projectRoot, "ktx.yaml");
    if (state.meta.get(ktxYaml) !== next.get(ktxYaml)) {
      const { invalidateContentPathsCache } = await import("./paths.js");
      invalidateContentPathsCache();
      const context = await currentScopeContext();
      if (context.semanticLayer !== state.context.semanticLayer) {
        // Content root moved: migrate watchers and drop every old-root snapshot.
        closeWatchers(state);
        state.context = context;
        installWatchers(state);
        state.meta = await scanMetadata(context);
        state.contentHashes = await hashContents(state.meta.keys());
        entries.clear();
        bumpDisplayGeneration(DISPLAY_SCOPES);
        state.lastMetaAt = Date.now();
        state.error = undefined;
        return;
      }
    }
    state.meta = next;
    if (scopes.length > 0) bumpDisplayGeneration(scopes);
    state.lastMetaAt = Date.now();
    state.error = undefined;
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.running = false;
  }
}

export async function reconcileFullDigest(state: ReconcilerState | null = reconciler): Promise<void> {
  if (!state || state.fullRunning || reconciler !== state) return;
  state.fullRunning = true;
  try {
    const hashes = await hashContents(state.meta.keys());
    const scopes = changedScopes(state.contentHashes, hashes, state.context);
    state.contentHashes = hashes;
    if (scopes.length > 0) bumpDisplayGeneration(scopes);
    state.lastFullAt = Date.now();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.fullRunning = false;
  }
}

export async function startDisplayReconciler(options: { metadataIntervalMs?: number; fullDigestIntervalMs?: number } = {}): Promise<void> {
  stopDisplayReconciler();
  const context = await currentScopeContext();
  const meta = await scanMetadata(context);
  const now = Date.now();
  const state: ReconcilerState = {
    context,
    meta,
    contentHashes: await hashContents(meta.keys()),
    lastMetaAt: now,
    lastFullAt: now,
    running: false,
    fullRunning: false,
    watchers: [],
    timers: []
  };
  reconciler = state;
  installWatchers(state);
  const metaTimer = setInterval(() => void reconcileMetadata(state), options.metadataIntervalMs ?? METADATA_INTERVAL_MS);
  const fullTimer = setInterval(() => void reconcileFullDigest(state), options.fullDigestIntervalMs ?? FULL_DIGEST_INTERVAL_MS);
  metaTimer.unref?.();
  fullTimer.unref?.();
  state.timers.push(metaTimer, fullTimer);
}

export function stopDisplayReconciler(): void {
  if (!reconciler) return;
  const state = reconciler;
  reconciler = null;
  closeWatchers(state);
  for (const timer of state.timers) clearInterval(timer);
  if (state.scheduled) clearTimeout(state.scheduled);
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
      console.warn(`[display-snapshot] prewarm ${name} failed:`, error instanceof Error ? error.message : error);
    }
  }
}

/** Test / fixture IPC hook: drop every snapshot, failure and in-flight reference. */
export function resetDisplaySnapshotsForTests(): void {
  entries.clear();
  stats = { builds: 0, hits: 0, misses: 0, bypass: 0, busy: 0 };
}

export function displaySnapshotDiagnostics() {
  return {
    verified: displayCacheVerified(),
    reconcilerRunning: reconciler !== null,
    reconcilerError: reconciler?.error ?? null,
    inflightBuilds,
    entries: [...entries.entries()].map(([name, entry]) => ({ name, hasCurrent: Boolean(entry.current), inflight: entry.inflight.size })),
    ...stats
  };
}
