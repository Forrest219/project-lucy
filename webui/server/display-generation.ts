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

export function beginDisplayWrite(scopes: readonly DisplayScope[]): DisplayWriteToken {
  const list = unique(scopes);
  for (const scope of list) pending[scope] += 1;
  bump(list);
  return { scopes: list, ended: false };
}

export function endDisplayWrite(token: DisplayWriteToken): void {
  if (token.ended) return;
  token.ended = true;
  for (const scope of token.scopes) pending[scope] = Math.max(0, pending[scope] - 1);
  bump(token.scopes);
  for (const waiter of [...settleWaiters]) waiter();
}

/** Wrap a real disk mutation (or a whole write → commit → rollback transaction). */
export async function withDisplayWriteBarrier<T>(scopes: readonly DisplayScope[], fn: () => Promise<T>): Promise<T> {
  if (scopes.length === 0) return fn();
  const token = beginDisplayWrite(scopes);
  try {
    return await fn();
  } finally {
    endDisplayWrite(token);
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

/** Scope context for the current project (access override honoured). */
export async function currentScopeContext(): Promise<ScopeContext> {
  const [{ resolveProjectRoot }, { loadContentPaths }] = await Promise.all([import("./project.js"), import("./paths.js")]);
  const projectRoot = await resolveProjectRoot();
  const paths = await loadContentPaths();
  const accessPaths = [path.join(projectRoot, "webui", "config", "access.yaml")];
  const override = process.env.LUCY_ACCESS_CONFIG_PATH?.trim();
  if (override) accessPaths.push(path.resolve(override));
  return { projectRoot, semanticLayer: paths.semanticLayer, accessPaths };
}
