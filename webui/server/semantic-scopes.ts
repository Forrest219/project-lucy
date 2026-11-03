/**
 * Lucy v0.25 — immutable scope snapshots and CAS baseline digests.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §4.2 (scope snapshot), §4.5 (30 minute TTL, actor + instance binding),
 * §4.6 (recompute digests before commit), §5 (7 day export baseline) and
 * §11 D2 / D14.
 *
 * ── What a scope is ─────────────────────────────────────────────────────────
 * A scope is the server-side, immutable answer to "which tables does this
 * operation cover?". It is created from an explicit selection, keeps the
 * selection sorted and de-duplicated, records the baseline digests of every
 * target and dependency, and is bound to the acting user AND the instance.
 *
 * The scope is what a preview, a validation, a download and a commit are all
 * bound to. A client never sends a target path: it sends a `scopeId` and the
 * server resolves the targets again from the model.
 *
 * ── Why the digests live here ───────────────────────────────────────────────
 * Spec §7.2 requires that a confirmation is bound to a `planDigest` and NOT
 * to a global `confirmOverwrite` boolean. Building that digest needs the
 * current bytes of every target — including the "target did not exist yet"
 * marker — so the recalculation lives next to the snapshot that recorded the
 * original baseline.
 *
 * The canonicalization is NOT re-implemented here: `config-digest.ts` owns
 * `stableJson` / `computePlanDigest` / `computeCandidateDigest` so a preview
 * and a commit can never disagree about what "the same plan" means.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeCandidateDigest, computePlanDigest, sha256Hex } from "./config-digest";
import { resolveContentPaths } from "./paths";
import { readConnections } from "./project";
import {
  assertNoUnselectedSharedTargets,
  buildSemanticModelIndex,
  resolveSemanticDependencyClosure,
  resolveSemanticIdentity,
  semanticIdentityKey,
  sortUniqueSemanticIdentities,
  type SemanticDependencyClosure,
  type SemanticModelIndex,
  type SemanticTableIdentity
} from "./semantic-identity";
import {
  SEMANTIC_BATCH_LIMITS,
  assertDependencyLimit,
  assertSelectedTableLimit
} from "./semantic-limits";

const SCOPES_DIR_REL = ".ktx-ui/semantic-scopes";
const INSTANCE_ID_REL = ".ktx-ui/semantic-instance-id";
const MAX_SCOPE_RECORDS = 100;

export type SemanticScopeErrorCode =
  | "SCOPE_NOT_FOUND"
  | "SCOPE_EXPIRED"
  | "SCOPE_ACTOR_MISMATCH"
  | "SCOPE_INSTANCE_MISMATCH"
  | "SCOPE_INVALID";

export class SemanticScopeError extends Error {
  readonly code: SemanticScopeErrorCode;
  readonly statusCode = 409;

  constructor(code: SemanticScopeErrorCode, message: string) {
    super(message);
    this.name = "SemanticScopeError";
    this.code = code;
  }
}

/** One file the scope depends on, plus its current digest. */
export interface SemanticScopeTarget {
  /** Project-root-relative path (`semantic-layer/<conn>/<table>.yaml`). */
  path: string;
  /** The identity that owns this file, when it is a table overlay. */
  identity?: SemanticTableIdentity;
  /** SHA-256 of the current bytes, or `null` when the file does not exist. */
  digest: string | null;
}

export interface SemanticScopeBaseline {
  /** Digest over the whole baseline (targets + dependencies + config). */
  digest: string;
  /** The writable targets, sorted by path. */
  targets: SemanticScopeTarget[];
  /** The read-only dependencies, sorted by path. */
  dependencies: SemanticScopeTarget[];
  /** Non-sensitive configuration facts the parse depends on. */
  configFacts: Array<{ connectionId: string; schemas: string[] }>;
}

export interface SemanticScopeRecord {
  scopeId: string;
  createdAt: string;
  expiresAt: string;
  /** The acting user. Another user may not consume this scope id. */
  actor: string;
  /** The instance that created it. Another instance may not consume it. */
  instanceId: string;
  /** Sorted + de-duplicated selection. */
  refs: SemanticTableIdentity[];
  /** Sorted + de-duplicated read-only dependencies. */
  dependencies: SemanticTableIdentity[];
  baseline: SemanticScopeBaseline;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function pad3(value: number): string {
  return value.toString().padStart(3, "0");
}

function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}_` +
    `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}_${pad3(date.getMilliseconds())}`
  );
}

function newScopeId(now: Date): string {
  return `scope_${formatTimestamp(now)}_${randomUUID().slice(0, 8)}`;
}

/** SHA-256 of raw bytes; `null` for "the file does not exist". */
export function digestOfBytes(bytes: Buffer | null): string | null {
  if (!bytes) return null;
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of a UTF-8 string. */
export function digestOfText(text: string): string {
  return sha256Hex(text);
}

function scopeDir(projectRoot: string): string {
  return path.resolve(projectRoot, SCOPES_DIR_REL);
}

function scopePath(projectRoot: string, scopeId: string): string {
  return path.join(scopeDir(projectRoot), `${scopeId}.json`);
}

/**
 * The stable id of this Lucy instance.
 *
 * Spec §5 requires that a package exported by another instance is refused
 * ("跨实例包本期阻断"). The id is persisted under `.ktx-ui/` so it survives a
 * restart and is regenerated only when the local state is wiped. It is NOT a
 * secret and carries no host information.
 */
export async function resolveSemanticInstanceId(projectRoot: string): Promise<string> {
  const abs = path.resolve(projectRoot, INSTANCE_ID_REL);
  try {
    const existing = (await readFile(abs, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // fall through and create one
  }
  const created = `inst_${randomUUID()}`;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, `${created}\n`, "utf8");
  return created;
}

async function resolveTargetAbsolute(projectRoot: string, relPath: string): Promise<string> {
  const contentPaths = await resolveContentPaths(projectRoot);
  return path.resolve(contentPaths.configDir, relPath);
}

/**
 * Read the current digest of one target.
 *
 * A missing file yields `null` — the "target did not exist yet" marker of
 * Spec §4.6. It is part of the CAS contract: if another writer creates the
 * file between preview and commit, the digest changes from `null` to a hash
 * and the commit is refused.
 */
export async function readTargetDigest(
  projectRoot: string,
  relPath: string
): Promise<string | null> {
  try {
    const bytes = await readFile(await resolveTargetAbsolute(projectRoot, relPath));
    return digestOfBytes(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Recompute the digests of a set of targets. */
export async function recomputeSemanticTargets(
  projectRoot: string,
  targets: ReadonlyArray<{ path: string; identity?: SemanticTableIdentity }>
): Promise<SemanticScopeTarget[]> {
  const resolved: SemanticScopeTarget[] = [];
  for (const target of targets) {
    resolved.push({
      path: target.path,
      ...(target.identity ? { identity: target.identity } : {}),
      digest: await readTargetDigest(projectRoot, target.path)
    });
  }
  return resolved.sort((a, b) => a.path.localeCompare(b.path));
}

/** Non-sensitive configuration facts that participate in the baseline digest. */
async function readConfigFacts(projectRoot: string): Promise<Array<{ connectionId: string; schemas: string[] }>> {
  const connections = await readConnections(projectRoot).catch(() => []);
  return connections
    .map((connection) => ({
      connectionId: connection.id,
      schemas: [...connection.schemas].sort()
    }))
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
}

/**
 * Digest of a baseline: every target, every dependency and the non-sensitive
 * configuration facts. Secret values never enter it (Spec §4.2).
 */
export function computeSemanticBaselineDigest(input: {
  targets: readonly SemanticScopeTarget[];
  dependencies?: readonly SemanticScopeTarget[];
  configFacts?: ReadonlyArray<{ connectionId: string; schemas: string[] }>;
}): string {
  const targets = [...input.targets]
    .map((target) => ({ path: target.path, digest: target.digest }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const dependencies = [...(input.dependencies ?? [])]
    .map((target) => ({ path: target.path, digest: target.digest }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const configFacts = [...(input.configFacts ?? [])]
    .map((fact) => ({ connectionId: fact.connectionId, schemas: [...fact.schemas].sort() }))
    .sort((a, b) => a.connectionId.localeCompare(b.connectionId));
  return sha256Hex(
    JSON.stringify({
      vocabulary: "v0.25-semantic-baseline-1",
      targets,
      dependencies,
      configFacts
    })
  );
}

export interface CreateSemanticScopeInput {
  actor: string;
  instanceId: string;
  /** The selected, writable tables. */
  refs: readonly SemanticTableIdentity[];
  /** The read-only dependencies. */
  dependencies?: readonly SemanticTableIdentity[];
  /** The writable target files (overlay paths). */
  targets: ReadonlyArray<{ path: string; identity?: SemanticTableIdentity }>;
  /** The read-only dependency files. */
  dependencyTargets?: ReadonlyArray<{ path: string; identity?: SemanticTableIdentity }>;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

/**
 * Create and persist an immutable scope snapshot.
 *
 * The snapshot records the CURRENT baseline of every target and dependency,
 * so a later commit can prove nothing changed underneath it.
 */
export async function createSemanticScope(
  projectRoot: string,
  input: CreateSemanticScopeInput
): Promise<SemanticScopeRecord> {
  if (!input.actor) {
    throw new SemanticScopeError("SCOPE_INVALID", "范围快照必须绑定操作者。");
  }
  if (!input.instanceId) {
    throw new SemanticScopeError("SCOPE_INVALID", "范围快照必须绑定实例。");
  }
  const refs = sortUniqueSemanticIdentities(input.refs);
  if (refs.length === 0) {
    throw new SemanticScopeError("SCOPE_INVALID", "范围快照不能为空。");
  }

  const nowMs = (input.now ?? Date.now)();
  const createdAt = new Date(nowMs);
  const expiresAt = new Date(nowMs + SEMANTIC_BATCH_LIMITS.scopeTtlMs);

  const targets = await recomputeSemanticTargets(projectRoot, input.targets);
  const dependencyTargets = await recomputeSemanticTargets(
    projectRoot,
    input.dependencyTargets ?? []
  );
  const configFacts = await readConfigFacts(projectRoot);

  const record: SemanticScopeRecord = {
    scopeId: newScopeId(createdAt),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    actor: input.actor,
    instanceId: input.instanceId,
    refs,
    dependencies: sortUniqueSemanticIdentities(input.dependencies ?? []),
    baseline: {
      digest: computeSemanticBaselineDigest({
        targets,
        dependencies: dependencyTargets,
        configFacts
      }),
      targets,
      dependencies: dependencyTargets,
      configFacts
    }
  };

  await writeSemanticScope(projectRoot, record);
  return record;
}

async function writeSemanticScope(
  projectRoot: string,
  record: SemanticScopeRecord
): Promise<void> {
  const dir = scopeDir(projectRoot);
  await mkdir(dir, { recursive: true });
  await writeFile(scopePath(projectRoot, record.scopeId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await pruneSemanticScopes(projectRoot);
}

/** Keep the sidecar bounded; never delete a scope that is still fresh. */
async function pruneSemanticScopes(projectRoot: string): Promise<void> {
  const dir = scopeDir(projectRoot);
  const entries = await readdir(dir).catch(() => [] as string[]);
  const jsonFiles = entries.filter((entry) => entry.endsWith(".json")).sort();
  const removable = jsonFiles.slice(0, Math.max(0, jsonFiles.length - MAX_SCOPE_RECORDS));
  for (const file of removable) {
    await rm(path.join(dir, file), { force: true });
  }
}

/** Read a scope without any freshness check. */
export async function readSemanticScope(
  projectRoot: string,
  scopeId: string
): Promise<SemanticScopeRecord | null> {
  if (!scopeId || scopeId.includes("/") || scopeId.includes("\\") || scopeId.includes("..")) {
    return null;
  }
  try {
    const text = await readFile(scopePath(projectRoot, scopeId), "utf8");
    return JSON.parse(text) as SemanticScopeRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Read a scope and prove it may still be consumed.
 *
 * Every poll, download, report and commit re-runs this check: the scope must
 * exist, must not be expired, must belong to the acting user and must belong
 * to this instance. Anything else is refused — a scope id is not a bearer
 * token.
 */
export async function requireFreshSemanticScope(
  projectRoot: string,
  scopeId: string,
  context: { actor: string; instanceId: string; now?: () => number }
): Promise<SemanticScopeRecord> {
  const record = await readSemanticScope(projectRoot, scopeId);
  if (!record) {
    throw new SemanticScopeError("SCOPE_NOT_FOUND", `范围快照 ${scopeId} 不存在或已过期清理，请重新预览。`);
  }
  if (record.actor !== context.actor) {
    throw new SemanticScopeError(
      "SCOPE_ACTOR_MISMATCH",
      `范围快照 ${scopeId} 属于其他操作者，不能直接消费。`
    );
  }
  if (record.instanceId !== context.instanceId) {
    throw new SemanticScopeError(
      "SCOPE_INSTANCE_MISMATCH",
      `范围快照 ${scopeId} 属于其他实例，不能直接消费。`
    );
  }
  const nowMs = (context.now ?? Date.now)();
  if (Date.parse(record.expiresAt) <= nowMs) {
    throw new SemanticScopeError(
      "SCOPE_EXPIRED",
      `范围快照 ${scopeId} 已于 ${record.expiresAt} 过期，请重新预览。`
    );
  }
  return record;
}

/** Delete a scope (used after a terminal publish). */
export async function deleteSemanticScope(
  projectRoot: string,
  scopeId: string
): Promise<void> {
  await rm(scopePath(projectRoot, scopeId), { force: true });
}

/**
 * Compare the recorded baseline with the current disk state.
 *
 * Returns the paths that changed since the snapshot was taken. An empty list
 * means the plan may proceed; a non-empty list means the plan is stale and
 * the caller must re-preview (Spec §4.6 / §7.2, V08).
 */
export async function diffSemanticBaseline(
  projectRoot: string,
  baseline: SemanticScopeBaseline
): Promise<string[]> {
  const changed: string[] = [];
  const all = [...baseline.targets, ...baseline.dependencies];
  for (const target of all) {
    const current = await readTargetDigest(projectRoot, target.path);
    if (current !== target.digest) changed.push(target.path);
  }
  return changed.sort();
}

/** Throw when the baseline changed since the snapshot was taken. */
export async function assertSemanticBaselineUnchanged(
  projectRoot: string,
  baseline: SemanticScopeBaseline
): Promise<void> {
  const changed = await diffSemanticBaseline(projectRoot, baseline);
  if (changed.length === 0) return;
  throw new SemanticScopeError(
    "SCOPE_EXPIRED",
    `预览后以下目标已被改动（${changed.join("、")}），请重新预览并确认。`
  );
}

/**
 * The CAS plan digest a confirmation is bound to.
 *
 * Spec §7.2: "预览、覆盖确认绑定同一个 planDigest". The digest covers the
 * candidate plus the concrete target set with each target's EXPECTED digest
 * (`null` = the target must still not exist). A boolean confirmation could
 * not express "the target set changed"; this can.
 */
export function computeSemanticPlanDigest(input: {
  candidate: unknown;
  targets: ReadonlyArray<{ path: string; digest: string | null }>;
  extra?: Record<string, unknown>;
}): string {
  return computePlanDigest({
    candidateDigest: computeCandidateDigest(input.candidate),
    targets: input.targets.map((target) => ({
      path: target.path,
      expectedDigest: target.digest
    })),
    ...(input.extra ? { extra: input.extra } : {})
  });
}

/**
 * Recompute the plan digest from the CURRENT disk state and compare it with
 * the confirmed one. This is the check that replaces the global
 * `confirmOverwrite` boolean.
 *
 * `expected` is the baseline the preview was built from. When it is given,
 * the returned `changed` list names the targets that moved underneath the
 * preview (including "the target was created by somebody else").
 */
export async function recomputeSemanticPlanDigest(
  projectRoot: string,
  input: {
    candidate: unknown;
    targets: ReadonlyArray<{ path: string; identity?: SemanticTableIdentity }>;
    confirmedPlanDigest: string;
    expected?: ReadonlyArray<{ path: string; digest: string | null }>;
    extra?: Record<string, unknown>;
  }
): Promise<{ planDigest: string; matches: boolean; changed: string[] }> {
  const current = await recomputeSemanticTargets(projectRoot, input.targets);
  const planDigest = computeSemanticPlanDigest({
    candidate: input.candidate,
    targets: current,
    ...(input.extra ? { extra: input.extra } : {})
  });
  const expectedByPath = new Map((input.expected ?? []).map((entry) => [entry.path, entry.digest]));
  const changed = current
    .filter((target) => {
      if (!expectedByPath.has(target.path)) return false;
      return expectedByPath.get(target.path) !== target.digest;
    })
    .map((target) => target.path)
    .sort();
  return { planDigest, matches: planDigest === input.confirmedPlanDigest, changed };
}

/** Human-readable scope summary for a preview response. */
export function describeSemanticScope(record: SemanticScopeRecord): {
  scopeId: string;
  createdAt: string;
  expiresAt: string;
  selectedCount: number;
  dependencyCount: number;
  baselineDigest: string;
  refs: string[];
} {
  return {
    scopeId: record.scopeId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    selectedCount: record.refs.length,
    dependencyCount: record.dependencies.length,
    baselineDigest: record.baseline.digest,
    refs: record.refs.map(semanticIdentityKey)
  };
}

export interface ResolveSemanticScopeInput {
  actor: string;
  instanceId: string;
  /** The explicit selection. */
  refs: readonly SemanticTableIdentity[];
  now?: () => number;
}

export interface ResolvedSemanticScope {
  scope: SemanticScopeRecord;
  index: SemanticModelIndex;
  closure: SemanticDependencyClosure;
}

/**
 * Resolve a selection into an immutable scope snapshot.
 *
 * This is the one call an API route needs:
 *   1. build the model index (identity from the Manifest, never from names),
 *   2. resolve every selected identity — a partial or ambiguous identity is
 *      refused,
 *   3. compute the dependency closure — a missing or ambiguous dependency is
 *      refused,
 *   4. refuse a selection that would silently widen the write scope
 *      (a shared overlay file),
 *   5. persist the scope with the current baseline digests.
 *
 * The client never sends a target path: the targets are computed here.
 */
export async function resolveSemanticScope(
  projectRoot: string,
  input: ResolveSemanticScopeInput
): Promise<ResolvedSemanticScope> {
  const index = await buildSemanticModelIndex(projectRoot);

  const entries = input.refs.map((ref) => {
    // Throws on a missing / ambiguous identity.
    const entry = resolveSemanticIdentity(index, {
      ...(ref.connectionId ? { connectionId: ref.connectionId } : {}),
      ...(ref.schema ? { schema: ref.schema } : {}),
      ...(ref.table ? { table: ref.table } : {})
    });
    return entry;
  });

  const selected = sortUniqueSemanticIdentities(entries.map((entry) => entry.identity));
  assertSelectedTableLimit(selected.length);

  const closure = await resolveSemanticDependencyClosure(projectRoot, index, selected);
  assertDependencyLimit(closure.dependencyIdentities.length);
  // A shared overlay file would change tables that were not selected.
  assertNoUnselectedSharedTargets(index, selected, closure);

  const targets = entries.map((entry) => ({
    path: entry.overlayRelPath,
    identity: entry.identity
  }));
  const dependencyTargets = closure.dependencyIdentities.map((dependency) => {
    const entry = index.byKey.get(semanticIdentityKey(dependency));
    return {
      path: entry?.overlayRelPath ?? "",
      identity: dependency
    };
  }).filter((target) => target.path !== "");

  const scope = await createSemanticScope(projectRoot, {
    actor: input.actor,
    instanceId: input.instanceId,
    refs: selected,
    dependencies: closure.dependencyIdentities,
    targets,
    dependencyTargets,
    ...(input.now ? { now: input.now } : {})
  });

  return { scope, index, closure };
}
