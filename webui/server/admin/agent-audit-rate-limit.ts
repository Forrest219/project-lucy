/**
 * audit-trust-2026-10-19-r1 / T08a — per-IP rate limit for the
 * controlled-client observation endpoint (POST /api/agent-audit/events).
 *
 * Contract §6.x: per-IP 429 envelope is required.
 * Implementation notes:
 *   - Single-instance assumption (matches product config): state lives in
 *     module-private memory. No SQLite read on the hot path.
 *   - Windowed token bucket: rolling window of `windowSeconds`, max
 *     `maxPerWindow` requests per IP. The check is fail-open when the key
 *     has not been seen before; it is fail-closed (HTTP 429) when count
 *     exceeds `maxPerWindow` within the window.
 *   - Counted requests: only those that PASS auth + schema validation. We
 *     do NOT count 401 / 400 / 413 rejections; this prevents a credential
 *     harvester from exhausting the bucket for legitimate clients.
 *   - `extractIpForRateLimit` prefers Fastify's `request.ip` (already
 *     resolved under `trustProxy`), then falls back to the leftmost
 *     `X-Forwarded-For` value. Bounded to IPv4/IPv6 textual form only.
 *
 * Reset is exposed for tests only; production callers never reset.
 */

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
  // Lazy GC: prune stale buckets periodically to keep memory bounded.
  // We avoid pruning on every check (would be O(n) per request); only
  // when the map exceeds a soft cap.
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

/**
 * Best-effort IP extraction for rate limiting. `request.ip` is preferred
 * (Fastify resolves it under `trustProxy`); we then fall back to the
 * leftmost `X-Forwarded-For` value, then to the literal `"unknown"`. The
 * fallback never throws on malformed input.
 */
export function extractIpForRateLimit(request: {
  ip?: string | undefined;
  headers: Record<string, unknown>;
}): string {
  if (typeof request.ip === "string" && request.ip.length > 0) {
    return request.ip;
  }
  const xff = request.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  if (Array.isArray(xff) && xff.length > 0 && typeof xff[0] === "string") {
    return xff[0].split(",")[0]?.trim() || "unknown";
  }
  return "unknown";
}

/**
 * Hook to remove a bucket entry (used by tests and by explicit IP-based
 * reset hooks). Production callers should NOT call this.
 */
export function forgetIpForRateLimit(ip: string): void {
  buckets.delete(ip);
}
