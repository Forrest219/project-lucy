import { createHash, randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getSecurityStore } from "../security/instance.js";
import { trustProxyEnabled } from "../web-security.js";

const MINUTE_MS = 60_000;

/** Spec §3.1 item 5 proposal defaults. Windows are fixed (not extended by further attempts). */
export const AUTH_RATE_LIMITS = {
  sourceTotal: { limit: 30, windowMs: 5 * MINUTE_MS },
  loginAccountSource: { limit: 5, windowMs: 15 * MINUTE_MS },
  bootstrapSource: { limit: 5, windowMs: 15 * MINUTE_MS },
  maxBuckets: 10_000
} as const;

export type AuthGateResult =
  | { ok: true }
  | { ok: false; status: 429; retryAfterSeconds: number }
  | { ok: false; status: 503 };

type BucketSpec = { name: string; key: string; limit: number; windowMs: number };

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
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (!isIP(address)) continue;
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
 * The address used for throttling. A forwarded address is honored only when
 * LUCY_TRUST_PROXY is on AND the direct peer is inside LUCY_TRUSTED_PROXY_CIDRS;
 * then the right-most forwarded hop that is not itself a trusted proxy wins.
 * Anything else falls back to the socket peer, so arbitrary X-Forwarded-For is ignored.
 */
export function clientSource(request: FastifyRequest): string {
  const peer = normalizeAddress(request.raw.socket?.remoteAddress ?? "unknown");
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

function loginKey(adminId: string, source: string): string {
  const id = createHash("sha256").update(adminId.trim().toLowerCase().slice(0, 128)).digest("hex").slice(0, 32);
  return `login:${id}:${source}`;
}

const sourceKey = (source: string) => `src:${source}`;
const bootstrapKey = (source: string) => `boot:${source}`;

async function hitBuckets(source: string, buckets: BucketSpec[]): Promise<AuthGateResult> {
  const store = await getSecurityStore();
  if (!store.ok) return { ok: false, status: 503 };
  for (const bucket of buckets) {
    const decision = store.value.hitRateBucket({
      key: bucket.key,
      limit: bucket.limit,
      windowMs: bucket.windowMs,
      maxBuckets: AUTH_RATE_LIMITS.maxBuckets
    });
    if (!decision.ok) return { ok: false, status: 503 };
    if (decision.value.allowed) continue;
    // Log once per bucket window (first refused attempt) so a flood cannot grow the ledger.
    if (decision.value.count === bucket.limit + 1) {
      store.value.appendEvent({
        eventId: randomUUID(),
        operationId: randomUUID(),
        phase: "decision",
        actor: "anonymous",
        actorType: "anonymous",
        networkInfo: source,
        verdict: "rate_limited",
        resultSummary: bucket.name
      });
    }
    return { ok: false, status: 429, retryAfterSeconds: decision.value.retryAfterSeconds };
  }
  return { ok: true };
}

/**
 * Counts the attempt before credentials are checked, so parallel guesses cannot
 * outrun the limit. A successful login clears the account+source bucket only.
 */
export function gateLoginAttempt(request: FastifyRequest, adminId: string): Promise<AuthGateResult> {
  const source = clientSource(request);
  const { sourceTotal, loginAccountSource } = AUTH_RATE_LIMITS;
  return hitBuckets(source, [
    { name: "source_total", key: sourceKey(source), ...sourceTotal },
    { name: "login_account_source", key: loginKey(adminId, source), ...loginAccountSource }
  ]);
}

export function gateBootstrapAttempt(request: FastifyRequest): Promise<AuthGateResult> {
  const source = clientSource(request);
  const { sourceTotal, bootstrapSource } = AUTH_RATE_LIMITS;
  return hitBuckets(source, [
    { name: "source_total", key: sourceKey(source), ...sourceTotal },
    { name: "bootstrap_source", key: bootstrapKey(source), ...bootstrapSource }
  ]);
}

async function clearBucket(key: string): Promise<void> {
  const store = await getSecurityStore();
  if (store.ok) store.value.clearRateBucket(key);
}

export function clearLoginFailures(request: FastifyRequest, adminId: string): Promise<void> {
  return clearBucket(loginKey(adminId, clientSource(request)));
}

export function clearBootstrapFailures(request: FastifyRequest): Promise<void> {
  return clearBucket(bootstrapKey(clientSource(request)));
}

/** Sends the shared 429/503 envelope for a refused gate. */
export function replyAuthGate(reply: FastifyReply, gate: Exclude<AuthGateResult, { ok: true }>): FastifyReply {
  if (gate.status === 429) {
    return reply
      .status(429)
      .header("Retry-After", String(gate.retryAfterSeconds))
      .send({ ok: false, error: { code: "AUTH_RATE_LIMITED", message: "尝试过于频繁，请稍后再试" } });
  }
  return reply.status(503).send({
    ok: false,
    error: { code: "AUTH_STATE_UNAVAILABLE", message: "认证状态暂不可用，请稍后重试或联系部署人员" }
  });
}
