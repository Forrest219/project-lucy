/**
 * Spec 195 §5 / §6 — unified file revision ledger and per-scope verification health.
 *
 * One accepted record per watched file holds the metadata signature, the
 * content digest and the observation sequence. The metadata scan and the full
 * digest scan consume the SAME ledger, so one confirmed change notifies the
 * derived scopes exactly once no matter which scan observes it first, and in
 * whatever order the two scans interleave.
 *
 * `sequence` is assigned when the content is READ (not when a pass starts), so
 * an observation that read an older version can never overwrite a newer one.
 *
 * Everything here is process-local state: no external cache, no database
 * schema, no distributed lock, no background daemon.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { canonicalFileId, scopesForPath, type DisplayScope, type ScopeContext } from "./display-generation";

export type ObservedRevision = {
  contextId: string;
  fileId: string;
  meta: string | "missing";
  digest: string | "missing";
  sequence: number;
};

export type RevisionCandidate = {
  fileId: string;
  meta: string | "missing";
  digest: string | "missing";
  /** Observation order — assigned when the content was read. */
  sequence: number;
};

export const MISSING = "missing";

/** Canonical scope order, so derived notifications are deterministic. */
const SCOPE_ORDER: readonly DisplayScope[] = ["D", "P", "C", "L"];

export function orderScopes(scopes: Iterable<DisplayScope>): DisplayScope[] {
  const set = new Set(scopes);
  return SCOPE_ORDER.filter((scope) => set.has(scope));
}

export function scopeContextId(context: ScopeContext): string {
  return [context.projectRoot, context.semanticLayer, ...context.accessPaths].join("\u0000");
}

/** size / mtime / ino / ctime — mtime is part of the version (semantic update time). */
export function metaSignature(info: { size: number; mtimeMs: number; ino: number; ctimeMs: number }): string {
  return `${info.size}:${info.mtimeMs}:${info.ino}:${info.ctimeMs}`;
}

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Spec 195 §7 — diagnostics never expose absolute paths, file contents,
 * tokens or secrets. A path is reduced to its last segment.
 */
export function sanitizeDiagnosticMessage(message: string): string {
  return message.replace(/(?:[A-Za-z]:)?(?:\/[^\s'"()\\]+)+/g, (match) => {
    const base = match.slice(match.lastIndexOf("/") + 1);
    return base.length > 0 ? base : "<path>";
  });
}

/**
 * Read a file and prove it did not change while being read: the metadata
 * signature before and after the read must match, otherwise the observation
 * is unstable and the caller retries.
 */
export async function readStableRevision(file: string): Promise<{ meta: string; digest: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let before;
    try {
      before = await stat(file);
    } catch (error) {
      if (isEnoent(error)) return { meta: MISSING, digest: MISSING };
      throw error;
    }
    const content = await readFile(file);
    let after;
    try {
      after = await stat(file);
    } catch (error) {
      if (isEnoent(error)) return { meta: MISSING, digest: MISSING };
      throw error;
    }
    const metaBefore = metaSignature(before);
    if (metaBefore === metaSignature(after)) {
      return { meta: metaBefore, digest: createHash("sha256").update(content).digest("hex") };
    }
  }
  throw new Error("file changed while reading");
}

export type LedgerCommit = {
  /** Scopes whose derived data must be invalidated — empty when nothing changed. */
  changedScopes: DisplayScope[];
  changedFiles: string[];
  /** Candidates dropped because a newer observation was already accepted. */
  lateFiles: string[];
};

/**
 * The accepted revisions of one scope context. Both scan kinds read and write
 * this single map; there is no second, independent "content baseline".
 */
export class RevisionLedger {
  private readonly accepted = new Map<string, ObservedRevision>();
  private counter = 0;

  constructor(readonly context: ScopeContext, readonly contextId: string) {}

  nextSequence(): number {
    this.counter += 1;
    return this.counter;
  }

  get(fileId: string): ObservedRevision | undefined {
    return this.accepted.get(fileId);
  }

  get size(): number {
    return this.accepted.size;
  }

  /** Every file this ledger has accepted — used to spot deletions. */
  fileIds(): string[] {
    return [...this.accepted.keys()];
  }

  /**
   * Accept candidates and report what changed. A version that was already
   * accepted never notifies again; a candidate older than the accepted record
   * is dropped instead of overwriting it.
   */
  commit(candidates: readonly RevisionCandidate[]): LedgerCommit {
    const changedScopes = new Set<DisplayScope>();
    const changedFiles: string[] = [];
    const lateFiles: string[] = [];
    for (const candidate of candidates) {
      const previous = this.accepted.get(candidate.fileId);
      if (previous && previous.sequence > candidate.sequence) {
        lateFiles.push(candidate.fileId);
        continue;
      }
      if (previous && previous.meta === candidate.meta && previous.digest === candidate.digest) {
        this.accepted.set(candidate.fileId, { ...previous, sequence: candidate.sequence });
        continue;
      }
      this.accepted.set(candidate.fileId, {
        contextId: this.contextId,
        fileId: candidate.fileId,
        meta: candidate.meta,
        digest: candidate.digest,
        sequence: candidate.sequence
      });
      changedFiles.push(candidate.fileId);
      for (const scope of scopesForPath(candidate.fileId, this.context)) changedScopes.add(scope);
    }
    return { changedScopes: orderScopes(changedScopes), changedFiles, lateFiles };
  }

  /**
   * Accept a final disk version without notifying. Used when a write
   * transaction ends: the exit barrier already covered the invalidation, so
   * the observer must not invalidate the same version a second time.
   */
  confirm(candidates: readonly RevisionCandidate[]): void {
    for (const candidate of candidates) {
      const previous = this.accepted.get(candidate.fileId);
      if (previous && previous.sequence > candidate.sequence) continue;
      this.accepted.set(candidate.fileId, {
        contextId: this.contextId,
        fileId: candidate.fileId,
        meta: candidate.meta,
        digest: candidate.digest,
        sequence: candidate.sequence
      });
    }
  }

  reset(): void {
    this.accepted.clear();
    this.counter = 0;
  }
}

// ─── scope verification health ─────────────────────────────────────────────

export type ScopeHealth = {
  /** When the metadata coverage of this scope last completed. */
  metadataCompletedAt: number;
  /** When the full digest coverage of this scope last completed. */
  digestCompletedAt: number;
  metadataError?: string;
  digestError?: string;
};

const health = new Map<DisplayScope, ScopeHealth>();

function healthFor(scope: DisplayScope): ScopeHealth {
  let entry = health.get(scope);
  if (!entry) {
    entry = { metadataCompletedAt: 0, digestCompletedAt: 0 };
    health.set(scope, entry);
  }
  return entry;
}

export function scopeHealthSnapshot(): Record<string, ScopeHealth> {
  const out: Record<string, ScopeHealth> = {};
  for (const [scope, entry] of health) out[scope] = { ...entry };
  return out;
}

export function markScopeMetadataOk(scope: DisplayScope, at: number): void {
  const entry = healthFor(scope);
  entry.metadataCompletedAt = at;
  entry.metadataError = undefined;
}

export function markScopeMetadataError(scope: DisplayScope, message: string): void {
  const entry = healthFor(scope);
  entry.metadataError = sanitizeDiagnosticMessage(message);
}

export function markScopeDigestOk(scope: DisplayScope, at: number): void {
  const entry = healthFor(scope);
  entry.digestCompletedAt = at;
  entry.digestError = undefined;
}

export function markScopeDigestError(scope: DisplayScope, message: string): void {
  const entry = healthFor(scope);
  entry.digestError = sanitizeDiagnosticMessage(message);
}

export function resetScopeHealth(): void {
  health.clear();
}

// ─── process-local singletons ──────────────────────────────────────────────

let ledger: RevisionLedger | null = null;
let ledgerContextId: string | null = null;

/** The ledger for the given context; a context change starts a fresh ledger. */
export function ensureRevisionLedger(context: ScopeContext): RevisionLedger {
  const id = scopeContextId(context);
  if (!ledger || ledgerContextId !== id) {
    ledger = new RevisionLedger(context, id);
    ledgerContextId = id;
    resetScopeHealth();
  }
  return ledger;
}

export function currentRevisionLedger(): RevisionLedger | null {
  return ledger;
}

export function resetRevisionLedger(): void {
  ledger = null;
  ledgerContextId = null;
  resetScopeHealth();
}

/**
 * Confirm the final disk version of the paths a write transaction touched.
 *
 * The transaction's exit barrier already advanced the generation, so this
 * confirmation must NOT notify again: it only records the version so the
 * observer does not treat the same final version as a new change.
 *
 * Secrets are never read into the ledger — their content stays out of every
 * digest baseline. A confirmation that cannot read the final version leaves
 * the affected scopes unverified so a later verification pass recovers them.
 */
export async function confirmDisplayTouchedPaths(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const current = currentRevisionLedger();
  if (!current) return;
  const candidates: RevisionCandidate[] = [];
  const failedScopes = new Set<DisplayScope>();
  for (const file of paths) {
    const fileId = canonicalFileId(file);
    const scopes = scopesForPath(fileId, current.context);
    // Secrets (C/L only) keep their existing barrier semantics and never
    // enter the content ledger.
    if (!scopes.includes("D") && !scopes.includes("P")) continue;
    try {
      const read = await readStableRevision(fileId);
      candidates.push({ fileId, meta: read.meta, digest: read.digest, sequence: current.nextSequence() });
    } catch (error) {
      for (const scope of scopes) {
        failedScopes.add(scope);
        markScopeDigestError(scope, `write confirmation failed: ${errorMessage(error)}`);
      }
    }
  }
  if (candidates.length > 0) current.confirm(candidates);
  if (failedScopes.size > 0) {
    // The final version is unknown: leave the affected scopes unverified and
    // let the next verification pass recover them.
    for (const scope of failedScopes) markScopeDigestError(scope, "write confirmation could not read the final version");
  }
}
