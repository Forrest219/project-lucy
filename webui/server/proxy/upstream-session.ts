/**
 * KTX transport-session ownership (Spec 07 §4.3; enterprise security Spec §3.3 / T04-2).
 *
 * KTX treats the MCP session as transport state: any session traffic that
 * arrives before a successful `initialize` is rejected with
 * `400 MCP initialize request is required before session traffic.`
 *
 * Lucy used to only pass `Mcp-Session-Id` through in both directions, which
 * made data access depend on every client retaining that header. Tools served
 * locally by the gateway (`lucy_catalog`) kept working while KTX-bound tools
 * (`lucy_query`, `lucy_read_source`) failed, so a client that dropped the
 * header saw a catalog it could not query. The gateway already terminates
 * identity, ACL and tool rewriting, so it holds the upstream session too.
 *
 * Ownership: every held session is bound to `(Agent id, Token hash,
 * downstreamSessionId)`. The downstream id is the `Mcp-Session-Id` the client
 * was handed at `initialize`; a request may only reuse a session its own
 * (Agent, Token) was issued, so a stolen or guessed id yields no upstream
 * state. A client that sends no header (or an id it does not own) falls back to
 * the default session of its own Token — never to another Token's, not even
 * another Token of the same Agent. Audit attribution stays on
 * `lucySessionId` / `lucyTurnId` and is unaffected.
 */

const UPSTREAM_SESSION_TTL = 24 * 60 * 60 * 1000;

/** Who a held session belongs to: the Agent and the Token it authenticated with. */
export type UpstreamSessionOwner = {
  agentId: string;
  tokenHash: string;
};

type OwnedSession = { lastSeen: number; owner: UpstreamSessionOwner };

/** `(agent, token, downstreamSessionId)` → liveness; the id itself is the upstream id. */
const ownedSessions = new Map<string, OwnedSession>();
/** `(agent, token)` → session used by clients that send no usable `Mcp-Session-Id`. */
const defaultSessions = new Map<string, { sessionId: string; lastSeen: number; owner: UpstreamSessionOwner }>();

// JSON arrays are collision-free for arbitrary id characters.
function ownerKey(owner: UpstreamSessionOwner): string {
  return JSON.stringify([owner.agentId, owner.tokenHash]);
}

function sessionKey(owner: UpstreamSessionOwner, downstreamSessionId: string): string {
  return JSON.stringify([owner.agentId, owner.tokenHash, downstreamSessionId]);
}

/** Owner of a request, from the identity admission produced. */
export function upstreamSessionOwner(identity: { userId: string; tokenHashPrefix: string }): UpstreamSessionOwner {
  return { agentId: identity.userId, tokenHash: identity.tokenHashPrefix };
}

function purgeExpired(now = Date.now()): void {
  for (const [key, value] of ownedSessions.entries()) {
    if (now - value.lastSeen > UPSTREAM_SESSION_TTL) ownedSessions.delete(key);
  }
  for (const [key, value] of defaultSessions.entries()) {
    if (now - value.lastSeen > UPSTREAM_SESSION_TTL) defaultSessions.delete(key);
  }
}

/** Kill switch — `false` restores the pass-through-only behaviour. */
export function upstreamSessionKeepaliveEnabled(): boolean {
  return process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE !== "false";
}

/**
 * Record a session KTX issued for this owner. It becomes both an owned
 * downstream id and the owner's default for header-less requests.
 */
export function setUpstreamSession(owner: UpstreamSessionOwner, sessionId: string): void {
  if (!sessionId) return;
  const now = Date.now();
  purgeExpired(now);
  ownedSessions.set(sessionKey(owner, sessionId), { lastSeen: now, owner });
  defaultSessions.set(ownerKey(owner), { sessionId, lastSeen: now, owner });
}

/** True only when `downstreamSessionId` was issued to exactly this (Agent, Token). */
export function ownsUpstreamSession(owner: UpstreamSessionOwner, downstreamSessionId: string | undefined): boolean {
  if (!downstreamSessionId) return false;
  const now = Date.now();
  purgeExpired(now);
  const value = ownedSessions.get(sessionKey(owner, downstreamSessionId));
  if (!value) return false;
  value.lastSeen = now;
  return true;
}

/**
 * The upstream session this owner may use for a request.
 * - client id the owner holds → that session;
 * - no id, or an id the owner does not hold → the owner's default session, if any.
 * Another owner's session is never returned.
 */
export function getUpstreamSession(owner: UpstreamSessionOwner, downstreamSessionId?: string): string | undefined {
  if (ownsUpstreamSession(owner, downstreamSessionId)) return downstreamSessionId;
  const value = defaultSessions.get(ownerKey(owner));
  if (!value) return undefined;
  value.lastSeen = Date.now();
  return value.sessionId;
}

/**
 * Drop a cached session. Called when KTX rejects it as unestablished, when the
 * client terminates the session via `DELETE /mcp`, and when an `initialize`
 * was answered by the proxy's local fallback (KTX unreachable) so no upstream
 * session exists behind the 200 the client received.
 *
 * With `sessionId`, only that owned session (and the default, if it points at
 * it) is dropped; without, the owner's default session is.
 */
export function clearUpstreamSession(owner: UpstreamSessionOwner, sessionId?: string): void {
  const key = ownerKey(owner);
  const target = sessionId ?? defaultSessions.get(key)?.sessionId;
  if (!target) return;
  ownedSessions.delete(sessionKey(owner, target));
  if (defaultSessions.get(key)?.sessionId === target) defaultSessions.delete(key);
}

/** Which held sessions an authorization narrowing (T04-3) closes. */
export type UpstreamSessionMatch = {
  all?: boolean;
  agentIds?: Iterable<string>;
  tokenHashes?: Iterable<string>;
};

/**
 * Close every held session belonging to a narrowed Agent / Token (or all of
 * them), so a downstream session id issued before the narrowing owns nothing.
 * Returns how many owned sessions were closed.
 */
export function clearUpstreamSessionsMatching(match: UpstreamSessionMatch): number {
  const agents = new Set(match.agentIds ?? []);
  const tokens = new Set(match.tokenHashes ?? []);
  const hit = (owner: UpstreamSessionOwner): boolean =>
    match.all === true || agents.has(owner.agentId) || tokens.has(owner.tokenHash);
  let closed = 0;
  for (const [key, value] of ownedSessions.entries()) {
    if (!hit(value.owner)) continue;
    ownedSessions.delete(key);
    closed += 1;
  }
  for (const [key, value] of defaultSessions.entries()) {
    if (hit(value.owner)) defaultSessions.delete(key);
  }
  return closed;
}
