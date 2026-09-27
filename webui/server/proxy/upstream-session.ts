/**
 * KTX transport-session ownership (Spec 07 §4.3).
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
 * The store is keyed by Lucy `userId`, not by client session: two scripts run
 * by the same user share one KTX transport session. Audit attribution stays on
 * `lucySessionId` / `lucyTurnId` and is unaffected.
 */

const UPSTREAM_SESSION_TTL = 24 * 60 * 60 * 1000;

type UpstreamSession = {
  sessionId: string;
  lastSeen: number;
};

const upstreamSessions = new Map<string, UpstreamSession>();

function purgeExpired(now = Date.now()): void {
  for (const [key, value] of upstreamSessions.entries()) {
    if (now - value.lastSeen > UPSTREAM_SESSION_TTL) upstreamSessions.delete(key);
  }
}

/** Kill switch — `false` restores the pass-through-only behaviour. */
export function upstreamSessionKeepaliveEnabled(): boolean {
  return process.env.LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE !== "false";
}

export function setUpstreamSession(userId: string, sessionId: string): void {
  if (!sessionId) return;
  const now = Date.now();
  purgeExpired(now);
  upstreamSessions.set(userId, { sessionId, lastSeen: now });
}

export function getUpstreamSession(userId: string): string | undefined {
  const now = Date.now();
  purgeExpired(now);
  const value = upstreamSessions.get(userId);
  if (!value) return undefined;
  value.lastSeen = now;
  return value.sessionId;
}

/**
 * Drop a cached session. Called when KTX rejects it as unestablished, when the
 * client terminates the session via `DELETE /mcp`, and when an `initialize`
 * was answered by the proxy's local fallback (KTX unreachable) so no upstream
 * session exists behind the 200 the client received.
 */
export function clearUpstreamSession(userId: string): void {
  upstreamSessions.delete(userId);
}
