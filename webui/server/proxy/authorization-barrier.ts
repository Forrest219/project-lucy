import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { ClientRequest, ServerResponse } from "node:http";
import { parse } from "yaml";
import { invalidateAccessConfigCache } from "./identity.js";
import { clearUpstreamSessionsMatching } from "./upstream-session.js";

/**
 * T04-3 / Spec §3.3 — revocation send barrier.
 *
 * A narrowing operation (Token revoke, Agent disable / delete / permission
 * edit, Role edit) is persisted and committed by its admin writer first, then
 * calls `narrowAuthorization`, which in order:
 *   1. commits a new authorization version for the affected subjects;
 *   2. cancels their in-flight requests and streams (and aborts the upstream
 *      calls made on their behalf);
 *   3. clears the caches that could replay older authority (held upstream
 *      sessions, the access-config cache);
 * and only then resolves, so the admin response is the success the caller sees.
 *
 * Every request is stamped with the version sequence read *before* admission.
 * The response is wrapped so each content send point (`writeHead` / `write` /
 * `end`, which covers every SSE chunk) re-checks that stamp; a request
 * admitted under an older version is answered with an access-denied error or,
 * once headers are out, has its stream cut. Bytes already on the wire or in a
 * network buffer cannot be recalled — this barrier only stops new writes.
 *
 * Scope: version state is per process. Multi-replica propagation is out of scope.
 */

/** Detail string clients and audit see when the barrier refuses to send. */
export const AUTHORIZATION_REVOKED_DETAIL = "authorization_revoked";

export type NarrowingScope =
  | { kind: "all" }
  | { kind: "subjects"; agentIds: string[]; tokenHashes: string[] };

/** What the barrier needs to know about the caller of a request. */
export type BarrierSubject = { userId: string; tokenHashPrefix: string };

export interface BarrierHandle {
  readonly agentId: string;
  readonly tokenHash: string;
  /** False once a narrowing covering this request was committed (or it was cancelled). */
  isCurrent(): boolean;
  /** Register an upstream call so a narrowing can abort it. */
  trackUpstream(upstream: ClientRequest): void;
  release(): void;
}

export class AuthorizationRevokedError extends Error {
  constructor() {
    super(AUTHORIZATION_REVOKED_DETAIL);
    this.name = "AuthorizationRevokedError";
  }
}

// ---------------------------------------------------------------- version state

let sequence = 0;
let allNarrowedAt = 0;
const agentNarrowedAt = new Map<string, number>();
const tokenNarrowedAt = new Map<string, number>();
const inflight = new Set<GuardedRequest>();

/** Read this *before* admission; pass it to `beginGuardedRequest`. */
export function currentAuthorizationSequence(): number {
  return sequence;
}

function narrowedAfter(agentId: string, tokenHash: string, stamp: number): boolean {
  return allNarrowedAt > stamp
    || (agentNarrowedAt.get(agentId) ?? 0) > stamp
    || (tokenNarrowedAt.get(tokenHash) ?? 0) > stamp;
}

/** Number of requests / streams currently guarded; narrowed to an Agent when given. */
export function inflightRequestCount(filter: { agentId?: string } = {}): number {
  let count = 0;
  for (const request of inflight) {
    if (filter.agentId === undefined || request.agentId === filter.agentId) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------- guarded request

function deniedBody(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: null,
    error: { code: -32003, message: `Access denied: ${AUTHORIZATION_REVOKED_DETAIL}` }
  });
}

type SendMethods = {
  writeHead: (...args: unknown[]) => unknown;
  write: (...args: unknown[]) => boolean;
  end: (...args: unknown[]) => unknown;
};

class GuardedRequest implements BarrierHandle {
  private cancelled = false;
  private readonly upstreams = new Set<ClientRequest>();
  private readonly send: SendMethods;

  constructor(
    readonly agentId: string,
    readonly tokenHash: string,
    private readonly stamp: number,
    private readonly res: ServerResponse
  ) {
    const target = res as unknown as SendMethods;
    this.send = {
      writeHead: target.writeHead.bind(res),
      write: target.write.bind(res),
      end: target.end.bind(res)
    };
    target.writeHead = (...args: unknown[]) => {
      if (this.isCurrent()) return this.send.writeHead(...args);
      this.deny();
      return res;
    };
    target.write = (...args: unknown[]) => {
      if (this.isCurrent()) return this.send.write(...args);
      this.deny();
      return false;
    };
    target.end = (...args: unknown[]) => {
      if (this.isCurrent()) return this.send.end(...args);
      this.deny();
      return res;
    };
  }

  isCurrent(): boolean {
    return !this.cancelled && !narrowedAfter(this.agentId, this.tokenHash, this.stamp);
  }

  trackUpstream(upstream: ClientRequest): void {
    if (!this.isCurrent()) {
      upstream.destroy(new AuthorizationRevokedError());
      return;
    }
    this.upstreams.add(upstream);
    upstream.once("close", () => this.upstreams.delete(upstream));
  }

  /** Abort upstream work and stop the response; idempotent. */
  cancel(): void {
    this.cancelled = true;
    for (const upstream of [...this.upstreams]) upstream.destroy(new AuthorizationRevokedError());
    this.upstreams.clear();
    this.deny();
    this.release();
  }

  release(): void {
    inflight.delete(this);
  }

  /** Error response before any byte went out; otherwise cut the stream. */
  private deny(): void {
    const { res } = this;
    if (res.writableEnded || res.destroyed) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const body = deniedBody();
    this.send.writeHead(403, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    this.send.end(body);
  }
}

/**
 * Register a request with the barrier and guard its response's send points.
 * `stamp` must have been read via `currentAuthorizationSequence()` before the
 * identity it belongs to was resolved.
 */
export function beginGuardedRequest(subject: BarrierSubject, res: ServerResponse, stamp: number): BarrierHandle {
  const request = new GuardedRequest(subject.userId, subject.tokenHashPrefix, stamp, res);
  inflight.add(request);
  const release = () => request.release();
  res.once("close", release);
  res.once("finish", release);
  return request;
}

// ---------------------------------------------------------------- request context

const requestContext = new AsyncLocalStorage<BarrierHandle>();

export function runWithBarrier<T>(handle: BarrierHandle, fn: () => T): T {
  return requestContext.run(handle, fn);
}

export function currentBarrierHandle(): BarrierHandle | undefined {
  return requestContext.getStore();
}

// ---------------------------------------------------------------- narrowing

function matches(request: GuardedRequest, scope: NarrowingScope): boolean {
  if (scope.kind === "all") return true;
  return scope.agentIds.includes(request.agentId) || scope.tokenHashes.includes(request.tokenHash);
}

/**
 * Commit a narrowing. Call only after the narrower authority is durably
 * persisted and compiled; resolves after in-flight work is cancelled and
 * caches are cleared. A failing step does not skip the remaining ones — the new
 * version stays committed — and is rethrown so the caller never reports success.
 */
export async function narrowAuthorization(scope: NarrowingScope): Promise<void> {
  const stamp = ++sequence;
  if (scope.kind === "all") {
    allNarrowedAt = stamp;
  } else {
    for (const agentId of scope.agentIds) agentNarrowedAt.set(agentId, stamp);
    for (const tokenHash of scope.tokenHashes) tokenNarrowedAt.set(tokenHash, stamp);
  }

  const failures: unknown[] = [];
  const step = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      failures.push(error);
    }
  };
  for (const request of [...inflight]) {
    if (matches(request, scope)) step(() => request.cancel());
  }
  step(() => {
    clearUpstreamSessionsMatching(scope.kind === "all"
      ? { all: true }
      : { agentIds: scope.agentIds, tokenHashes: scope.tokenHashes });
  });
  step(() => invalidateAccessConfigCache());

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "authorization_barrier_failed");
}

// ---------------------------------------------------------------- scope derivation

type TokenLike = { hash?: unknown; value?: unknown; expires_at?: unknown };
type UserLike = { id: string; tokens?: ReadonlyArray<TokenLike> };
export type AccessConfigLike = { users?: ReadonlyArray<UserLike>; roles?: unknown; defaults?: unknown };

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** `Identity.tokenHashPrefix` form (`sha256:` + 12 hex) of a configured token, if derivable. */
export function tokenHashPrefixOf(token: TokenLike): string | null {
  const normalize = (hash: string): string => {
    const lower = hash.trim().toLowerCase();
    return (lower.startsWith("sha256:") ? lower : `sha256:${lower}`).slice(0, 19);
  };
  const raw = token.hash;
  if (typeof raw === "string" && raw.trim()) return normalize(raw);
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key.toLowerCase() === "sha256" && (typeof value === "string" || typeof value === "number")) {
        return normalize(String(value));
      }
    }
  }
  if (typeof token.value === "string" && token.value) {
    return `sha256:${createHash("sha256").update(token.value).digest("hex")}`.slice(0, 19);
  }
  return null;
}

/** Everything about an Agent that grants authority; display-only fields are excluded. */
function agentAuthority(user: UserLike): string {
  const { tokens: _tokens, name: _name, note: _note, ...rest } = user as UserLike & { name?: unknown; note?: unknown };
  return stable(rest);
}

function narrowedTokens(before: UserLike, after: UserLike): { tokenHashes: string[]; agentWide: boolean } {
  const nextByHash = new Map<string, TokenLike>();
  for (const token of after.tokens ?? []) {
    const prefix = tokenHashPrefixOf(token);
    if (prefix) nextByHash.set(prefix, token);
  }
  const tokenHashes: string[] = [];
  for (const token of before.tokens ?? []) {
    const prefix = tokenHashPrefixOf(token);
    if (!prefix) return { tokenHashes: [], agentWide: true };
    const kept = nextByHash.get(prefix);
    if (!kept || stable(kept.expires_at ?? null) !== stable(token.expires_at ?? null)) tokenHashes.push(prefix);
  }
  return { tokenHashes, agentWide: false };
}

/**
 * Which subjects lose or may lose authority between two access configs, or null
 * when nothing was narrowed. Conservative: an edit that might only widen still
 * counts, because cancelling in-flight work is safe and replaying it is not;
 * pure additions (new Agent / Token / Role) are never narrowing.
 */
export function narrowingScopeBetween(before: AccessConfigLike, after: AccessConfigLike): NarrowingScope | null {
  if (stable(before.defaults ?? null) !== stable(after.defaults ?? null)) return { kind: "all" };
  const nextRoles = (after.roles ?? {}) as Record<string, unknown>;
  for (const [roleId, role] of Object.entries((before.roles ?? {}) as Record<string, unknown>)) {
    if (!(roleId in nextRoles) || stable(role) !== stable(nextRoles[roleId])) return { kind: "all" };
  }

  const nextUsers = new Map((after.users ?? []).map((user) => [user.id, user] as const));
  const agentIds = new Set<string>();
  const tokenHashes = new Set<string>();
  for (const user of before.users ?? []) {
    const next = nextUsers.get(user.id);
    if (!next || agentAuthority(user) !== agentAuthority(next)) {
      agentIds.add(user.id);
      continue;
    }
    const tokens = narrowedTokens(user, next);
    if (tokens.agentWide) agentIds.add(user.id);
    for (const hash of tokens.tokenHashes) tokenHashes.add(hash);
  }
  if (agentIds.size === 0 && tokenHashes.size === 0) return null;
  return { kind: "subjects", agentIds: [...agentIds].sort(), tokenHashes: [...tokenHashes].sort() };
}

/**
 * Scope for an access.yaml write, from the file content it replaced. An
 * unreadable previous file cannot be diffed, so it narrows everyone.
 */
export function narrowingScopeForWrite(previousRaw: string | undefined, next: AccessConfigLike): NarrowingScope | null {
  if (previousRaw === undefined) return null;
  let previous: unknown;
  try {
    previous = parse(previousRaw);
  } catch {
    return { kind: "all" };
  }
  if (!previous || typeof previous !== "object") return { kind: "all" };
  return narrowingScopeBetween(previous as AccessConfigLike, next);
}
