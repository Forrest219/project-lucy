/**
 * Spec 174 §3.2 — display read-model generations and write barriers.
 *
 * Scopes (invalidation matrix symbols): D semantic/Manifest summaries,
 * P permission display / Agent references, C connections / project /
 * enabled tables, L live-schemas / health task config generation.
 *
 * Every real write enters a barrier *before* touching disk (generation++,
 * pending++), and leaves it in `finally` (generation++, pending--), so a
 * display build that overlaps a write can never publish, even when the write
 * fails half-way. Barriers are re-entrant: an outer access transaction
 * (write → policy commit → rollback) keeps the scope pending until it ends.
 * Only display caches read these generations; runtime authorization never does.
 */
import { realpathSync } from "node:fs";
import path from "node:path";

export const DISPLAY_SCOPES = ["D", "P", "C", "L"] as const;
export type DisplayScope = (typeof DISPLAY_SCOPES)[number];

type Generations = Record<DisplayScope, number>;

function zero(): Generations {
  return { D: 0, P: 0, C: 0, L: 0 };
}

let generations: Generations = zero();
let pending: Generations = zero();
let epoch = 0;
const settleWaiters = new Set<() => void>();
const changeListeners = new Set<(scopes: DisplayScope[]) => void>();

export function displayGenerations(): Readonly<Generations> {
  return { ...generations };
}

export function displayEpoch(): number {
  return epoch;
}

export function generationKey(scopes: readonly DisplayScope[]): string {
  return scopes.map((scope) => `${scope}${generations[scope]}`).join(".");
}

export function hasPendingDisplayWrite(scopes: readonly DisplayScope[] = DISPLAY_SCOPES): boolean {
  return scopes.some((scope) => pending[scope] > 0);
}

function bump(scopes: readonly DisplayScope[]): void {
  if (scopes.length === 0) return;
  epoch += 1;
  for (const scope of scopes) generations[scope] += 1;
  for (const listener of changeListeners) listener([...scopes]);
}

/** Post-write / external-change notification (watcher, reconciler, reload). */
export function bumpDisplayGeneration(scopes: readonly DisplayScope[]): void {
  bump(unique(scopes));
}

export function onDisplayGenerationChange(listener: (scopes: DisplayScope[]) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function unique(scopes: readonly DisplayScope[]): DisplayScope[] {
  return [...new Set(scopes)];
}

export type DisplayWriteToken = { scopes: DisplayScope[]; ended: boolean };

/** Every open barrier, so a nested / overlapping writer can be detected. */
const activeWrites: DisplayWriteToken[] = [];
/** Paths actually touched, per scope, awaiting final-version confirmation. */
const touchedPaths = new Map<DisplayScope, Set<string>>();

export function beginDisplayWrite(scopes: readonly DisplayScope[]): DisplayWriteToken {
  const list = unique(scopes);
  for (const scope of list) pending[scope] += 1;
  bump(list);
  const token: DisplayWriteToken = { scopes: list, ended: false };
  activeWrites.push(token);
  return token;
}

export function endDisplayWrite(token: DisplayWriteToken): void {
  if (token.ended) return;
  token.ended = true;
  for (const scope of token.scopes) pending[scope] = Math.max(0, pending[scope] - 1);
  bump(token.scopes);
  const index = activeWrites.indexOf(token);
  if (index >= 0) activeWrites.splice(index, 1);
  for (const waiter of [...settleWaiters]) waiter();
}

/**
 * Spec 195 §4 — widen an open barrier before the extra scope is touched.
 *
 * The write-before / write-after generation advance is kept for the newly
 * added scopes: an expansion is a write-before advance for them.
 */
export function expandDisplayWrite(token: DisplayWriteToken, scopes: readonly DisplayScope[]): void {
  if (token.ended) return;
  const list = unique(scopes).filter((scope) => !token.scopes.includes(scope));
  if (list.length === 0) return;
  token.scopes.push(...list);
  for (const scope of list) pending[scope] += 1;
  bump(list);
}

/**
 * Spec 195 §5.3 — register a path this write actually touches, before it
 * reaches the disk. The registration lets the barrier confirm the final disk
 * version when the outermost covering transaction ends, so the observer does
 * not invalidate the same version a second time.
 */
export function registerDisplayTouchedPath(absPath: string, scopes: readonly DisplayScope[]): void {
  if (activeWrites.length === 0) return;
  for (const scope of unique(scopes)) {
    let set = touchedPaths.get(scope);
    if (!set) {
      set = new Set();
      touchedPaths.set(scope, set);
    }
    set.add(absPath);
  }
}

function otherWriteCovers(scope: DisplayScope, token: DisplayWriteToken): boolean {
  return activeWrites.some((other) => other !== token && !other.ended && other.scopes.includes(scope));
}

/**
 * Spec 195 §5.3 — end a write transaction.
 *
 * The final disk version of the touched paths is confirmed while the barrier
 * is still pending (so no observer can publish an older observation in
 * between), and the exit barrier still advances the generation afterwards.
 */
export async function finalizeDisplayWrite(token: DisplayWriteToken): Promise<void> {
  try {
    const finalScopes = token.scopes.filter((scope) => !otherWriteCovers(scope, token));
    if (finalScopes.length > 0) {
      const paths = new Set<string>();
      // Collect and drop in one synchronous block: a concurrent writer must
      // not lose its registration between the two steps.
      for (const scope of finalScopes) {
        const set = touchedPaths.get(scope);
        touchedPaths.delete(scope);
        for (const touched of set ?? []) paths.add(touched);
      }
      if (paths.size > 0) {
        const { confirmDisplayTouchedPaths } = await import("./display-revisions.js");
        await confirmDisplayTouchedPaths([...paths]);
      }
    }
  } catch {
    // A failed confirmation leaves the affected scopes unverified; the exit
    // barrier still advances the generation (conservative invalidation).
  } finally {
    endDisplayWrite(token);
  }
}

/** Token handed to a barrier with no scopes — widening it is a no-op. */
const EMPTY_TOKEN: DisplayWriteToken = { scopes: [], ended: true };

/**
 * Wrap a real disk mutation (or a whole write → commit → rollback transaction).
 *
 * The callback receives the barrier token so a transaction that discovers more
 * paths than it expected can widen its scope before touching them.
 */
export async function withDisplayWriteBarrier<T>(
  scopes: readonly DisplayScope[],
  fn: (token: DisplayWriteToken) => Promise<T>
): Promise<T> {
  if (scopes.length === 0) return fn(EMPTY_TOKEN);
  const token = beginDisplayWrite(scopes);
  try {
    return await fn(token);
  } finally {
    await finalizeDisplayWrite(token);
  }
}

/** Resolve true once the scopes have no pending writes, false on timeout. */
export function waitForDisplayWritesSettled(scopes: readonly DisplayScope[], timeoutMs: number): Promise<boolean> {
  if (!hasPendingDisplayWrite(scopes)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      settleWaiters.delete(check);
      clearTimeout(timer);
      resolve(value);
    };
    const check = () => {
      if (!hasPendingDisplayWrite(scopes)) finish(true);
    };
    const timer = setTimeout(() => finish(!hasPendingDisplayWrite(scopes)), timeoutMs);
    settleWaiters.add(check);
  });
}

export function resetDisplayGenerationsForTests(): void {
  generations = zero();
  pending = zero();
  epoch = 0;
  activeWrites.length = 0;
  touchedPaths.clear();
  for (const waiter of [...settleWaiters]) waiter();
  settleWaiters.clear();
}

/** realpath that tolerates missing leaves (targets about to be created / just removed). */
function canonical(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(canonical(parent), path.basename(resolved));
  }
}

/**
 * Canonical identifier of a watched file. The revision ledger keys on this,
 * so the reconciler and the write path must agree on one spelling of the
 * same file (a symlinked temp directory would otherwise look like two).
 */
export function canonicalFileId(p: string): string {
  return canonical(p);
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Files that never feed the current semantic read model (history, temp, sidecars). */
export function isIgnoredSemanticPath(relToSemanticLayer: string): boolean {
  const parts = relToSemanticLayer.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => part.startsWith("."))) return true;
  const name = parts[parts.length - 1] ?? "";
  return !name.endsWith(".yaml") || /\.(tmp|upload|partial)(\.|$)/.test(name) || name.includes(".tmp-");
}

export type ScopeContext = {
  projectRoot: string;
  semanticLayer: string;
  accessPaths: string[];
};

/**
 * Classify an absolute target into display scopes. Manifests feed D+P (the
 * source map derives from them); overlays only D; ktx.yaml feeds C/D/P/L;
 * access files P; connection secrets C/L (content never fingerprinted).
 */
export function scopesForPath(absPath: string, context: ScopeContext): DisplayScope[] {
  const target = canonical(absPath);
  const semanticLayer = canonical(context.semanticLayer);
  if (inside(target, semanticLayer)) {
    const rel = path.relative(semanticLayer, target);
    if (rel === "") return ["D", "P"];
    if (isIgnoredSemanticPath(rel)) return [];
    return rel.split(path.sep).includes("_schema") ? ["D", "P"] : ["D"];
  }
  const projectRoot = canonical(context.projectRoot);
  if (target === path.join(projectRoot, "ktx.yaml")) return ["C", "D", "P", "L"];
  if (context.accessPaths.some((accessPath) => canonical(accessPath) === target)) return ["P"];
  if (inside(target, path.join(projectRoot, ".ktx", "secrets"))) return ["C", "L"];
  return [];
}

/** Scope context for a specific project root (access override honoured). */
export function scopeContextFor(projectRoot: string, semanticLayer: string): ScopeContext {
  // Canonical roots: the reconciler and the write path must name the same
  // file the same way, otherwise one change looks like two.
  const canonicalRoot = canonical(projectRoot);
  const accessPaths = [path.join(canonicalRoot, "webui", "config", "access.yaml")];
  const override = process.env.LUCY_ACCESS_CONFIG_PATH?.trim();
  if (override) accessPaths.push(canonical(path.resolve(override)));
  return { projectRoot: canonicalRoot, semanticLayer: canonical(semanticLayer), accessPaths };
}

/** Scope context for the current project (access override honoured). */
export async function currentScopeContext(): Promise<ScopeContext> {
  const [{ resolveProjectRoot }, { loadContentPaths }] = await Promise.all([import("./project.js"), import("./paths.js")]);
  const projectRoot = await resolveProjectRoot();
  const paths = await loadContentPaths();
  return scopeContextFor(projectRoot, paths.semanticLayer);
}
