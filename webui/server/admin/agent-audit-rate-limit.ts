/**
 * audit-trust-2026-10-19-r1 / T08a — per-IP rate limit for the
 * controlled-client observation endpoint (POST /api/agent-audit/events).
 *
 * Contract §6.x: per-IP 429 envelope is required.
 *
 * Implementation notes:
 *   - Single-instance assumption (matches product config): bucket state lives
 *     in module-private memory. No SQLite read on the hot path.
 *   - Windowed token counter: rolling fixed window of `windowSeconds`, max
 *     `maxPerWindow` requests per IP. The check is fail-open when the key has
 *     not been seen before; it is fail-closed (HTTP 429) when count exceeds
 *     `maxPerWindow` within the window.
 *   - Counted requests: only those that PASS auth + schema validation. We do
 *     NOT count 401 / 400 / 413 rejections; this prevents a credential
 *     harvester from exhausting the bucket for legitimate clients.
 *   - `extractIpForRateLimit` mirrors `auth/rate-limit.clientSource`
 *     exactly so the two rate limiters stay consistent: forwarded addresses
 *     are honored only when LUCY_TRUST_PROXY is on AND the direct peer is
 *     inside LUCY_TRUSTED_PROXY_CIDRS; the right-most non-trusted hop wins.
 *     Arbitrary X-Forwarded-For is ignored otherwise, so a hostile client
 *     cannot bypass the bucket by spoofing the header.
 *
 * Reset hooks are exposed for tests only; production callers never reset.
 */

import { BlockList, isIP } from "node:net";
import { trustProxyEnabled } from "../web-security.js";

export type RateLimitConfig = {
  windowSeconds: number;
  maxPerWindow: number;
};

export const DEFAULT_AGENT_AUDIT_RATE_LIMIT: RateLimitConfig = {
  windowSeconds: 60,
  maxPerWindow: 60
};

type Bucket = {
  count: number;
  /** Epoch milliseconds at which the current window started. */
  windowStartMs: number;
};

type BucketMap = Map<string, Bucket>;

let buckets: BucketMap = new Map();

export function resetAgentAuditRateLimits(): void {
  buckets = new Map();
}

function pruneBuckets(bucketsRef: BucketMap, nowMs: number, windowMs: number): void {
  // Lazy GC: prune stale buckets periodically to keep memory bounded. We
  // avoid pruning on every check (would be O(n) per request); only when
  // the map exceeds a soft cap. This trades a bounded memory footprint
  // for occasional O(n) sweeps, which is acceptable for a single-instance
  // service with hundreds-to-low-thousands of distinct IPs.
  if (bucketsRef.size < 256) return;
  for (const [k, b] of bucketsRef) {
    if (nowMs - b.windowStartMs >= windowMs) bucketsRef.delete(k);
  }
}

export type RateLimitVerdict = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export function checkAgentAuditRateLimit(
  ip: string,
  nowMs: number = Date.now(),
  config: RateLimitConfig = DEFAULT_AGENT_AUDIT_RATE_LIMIT
): RateLimitVerdict {
  const windowMs = config.windowSeconds * 1000;
  pruneBuckets(buckets, nowMs, windowMs);
  const cur = buckets.get(ip);
  if (!cur || nowMs - cur.windowStartMs >= windowMs) {
    buckets.set(ip, { count: 1, windowStartMs: nowMs });
    return {
      allowed: true,
      retryAfterSeconds: 0,
      remaining: Math.max(0, config.maxPerWindow - 1)
    };
  }
  cur.count += 1;
  if (cur.count > config.maxPerWindow) {
    const elapsed = nowMs - cur.windowStartMs;
    const retry = Math.max(1, Math.ceil((windowMs - elapsed) / 1000));
    return { allowed: false, retryAfterSeconds: retry, remaining: 0 };
  }
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: Math.max(0, config.maxPerWindow - cur.count)
  };
}

// ─── Trusted-proxy-aware client IP extraction (mirrors clientSource) ───────

function normalizeAddress(address: string): string {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return (mapped ? mapped[1] : address).toLowerCase();
}

function trustedProxyList(): BlockList | null {
  const raw = (process.env.LUCY_TRUSTED_PROXY_CIDRS ?? "").trim();
  if (!raw) return null;
  const list = new BlockList();
  for (const entry of raw.split(",").map((part) => part.trim()).filter(Boolean)) {
    const [address, prefix] = entry.split("/");
    if (!isIP(address)) continue;
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
  return list;
}

function listed(list: BlockList, address: string): boolean {
  const version = isIP(address);
  return version !== 0 && list.check(address, version === 6 ? "ipv6" : "ipv4");
}

/**
 * The address used for throttling. Mirrors `auth/rate-limit.clientSource` so
 * the two rate limiters stay consistent. Honors LUCY_TRUST_PROXY only when
 * the direct peer is also inside LUCY_TRUSTED_PROXY_CIDRS — otherwise an
 * attacker controlling X-Forwarded-For could trivially bypass per-IP
 * quotas. Falls back to socket peer; never throws.
 */
export function extractIpForRateLimit(request: {
  ip?: string | undefined;
  headers: Record<string, unknown>;
  raw?: { socket?: { remoteAddress?: string } };
}): string {
  const peer = normalizeAddress(request.raw?.socket?.remoteAddress ?? "unknown");
  if (!trustProxyEnabled()) return peer;
  const trusted = trustedProxyList();
  if (!trusted || !listed(trusted, peer)) return peer;
  const header = request.headers["x-forwarded-for"];
  const chain = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((hop) => normalizeAddress(hop.trim()))
    .filter((hop) => isIP(hop) !== 0);
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!listed(trusted, chain[i])) return chain[i];
  }
  return peer;
}

/**
 * Hook to remove a bucket entry (used by tests and by explicit IP-based
 * reset hooks). Production callers should NOT call this.
 */
export function forgetIpForRateLimit(ip: string): void {
  buckets.delete(ip);
}
