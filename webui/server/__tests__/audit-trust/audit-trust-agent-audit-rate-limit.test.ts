/**
 * T08a.1 audit-trust 单元 / 集成测试：per-IP rate limit
 *
 * 实施说明: 这不是 "rolling window token bucket"; 这是 fixed-window counter
 *   (首请求锚定 windowStart, 窗口内累加, 超过 max 返回 429 + Retry-After)。
 * 集成端点层 envelope 与 Retry-After header 由 T08c 浏览器实测覆盖 (Fastify
 *   inject API 不支持注入 raw.socket.remoteAddress, 这里不能直接断言 header)。
 *
 * 覆盖:
 * - 单实例 fixed-window counter
 * - 不同 IP 独立计数 / 桶隔离
 * - 窗口过期重置 / 边界
 * - extractIpForRateLimit 行为同 auth/rate-limit.clientSource:
 *   trustProxy=0 / peer 不可信 → 降级 socket peer;
 *   trustProxy=1 + peer 在 CIDRs 内 + 存在非可信 hop → 取 XFF 右起第一个非可信 hop
 * - 非 string headers 容错 (返回值降级, 不抛错)
 * - forgetIpForRateLimit 仅清 1 IP (另 1 IP 留存)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_AUDIT_RATE_LIMIT,
  checkAgentAuditRateLimit,
  extractIpForRateLimit,
  forgetIpForRateLimit,
  resetAgentAuditRateLimits
} from "../../admin/agent-audit-rate-limit";

const ORIGINAL_TRUST_PROXY = process.env.LUCY_TRUST_PROXY;
const ORIGINAL_TRUSTED_CIDRS = process.env.LUCY_TRUSTED_PROXY_CIDRS;

function mockRequest(opts: {
  peer?: string;
  trustProxy?: boolean;
  trustedCidrs?: string;
  xff?: string | string[];
  ip?: string;
}): Parameters<typeof extractIpForRateLimit>[0] {
  if (opts.trustProxy !== undefined) {
    process.env.LUCY_TRUST_PROXY = opts.trustProxy ? "1" : "0";
  }
  if (opts.trustedCidrs !== undefined) {
    process.env.LUCY_TRUSTED_PROXY_CIDRS = opts.trustedCidrs;
  }
  const headers: Record<string, unknown> = {};
  if (opts.xff !== undefined) headers["x-forwarded-for"] = opts.xff;
  return {
    ip: opts.ip,
    headers,
    raw: { socket: { remoteAddress: opts.peer ?? "203.0.113.1" } }
  };
}

beforeEach(() => {
  resetAgentAuditRateLimits();
});

afterEach(() => {
  if (ORIGINAL_TRUST_PROXY === undefined) delete process.env.LUCY_TRUST_PROXY;
  else process.env.LUCY_TRUST_PROXY = ORIGINAL_TRUST_PROXY;
  if (ORIGINAL_TRUSTED_CIDRS === undefined) delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
  else process.env.LUCY_TRUSTED_PROXY_CIDRS = ORIGINAL_TRUSTED_CIDRS;
});

describe("T08a.1 checkAgentAuditRateLimit", () => {
  it("allows under the limit", () => {
    const t = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      const r = checkAgentAuditRateLimit("1.2.3.4", t + i * 1000);
      expect(r.allowed).toBe(true);
    }
  });

  it("returns 429-equivalent on exceedance with positive retry-after", () => {
    const t = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("9.9.9.9", t + i * 10);
    }
    const over = checkAgentAuditRateLimit("9.9.9.9", t + DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow * 10);
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
    expect(over.remaining).toBe(0);
  });

  it("tracks IPs independently", () => {
    const t = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("10.0.0.1", t);
    }
    const overA = checkAgentAuditRateLimit("10.0.0.1", t);
    expect(overA.allowed).toBe(false);
    const firstB = checkAgentAuditRateLimit("10.0.0.2", t);
    expect(firstB.allowed).toBe(true);
    expect(firstB.remaining).toBe(DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow - 1);
  });

  it("resets the window after windowSeconds elapses", () => {
    const windowMs = DEFAULT_AGENT_AUDIT_RATE_LIMIT.windowSeconds * 1000;
    const t0 = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("1.1.1.1", t0 + i);
    }
    const blocked = checkAgentAuditRateLimit("1.1.1.1", t0 + DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow + 1);
    expect(blocked.allowed).toBe(false);
    const afterWindow = checkAgentAuditRateLimit("1.1.1.1", t0 + windowMs + 1000);
    expect(afterWindow.allowed).toBe(true);
    expect(afterWindow.remaining).toBe(DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow - 1);
  });

  it("honors a custom config", () => {
    const t = 1_000_000;
    const r1 = checkAgentAuditRateLimit("5.5.5.5", t, { windowSeconds: 60, maxPerWindow: 2 });
    const r2 = checkAgentAuditRateLimit("5.5.5.5", t + 10, { windowSeconds: 60, maxPerWindow: 2 });
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    const r3 = checkAgentAuditRateLimit("5.5.5.5", t + 20, { windowSeconds: 60, maxPerWindow: 2 });
    expect(r3.allowed).toBe(false);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("remaining correctly reports N-1 on the first request", () => {
    const r = checkAgentAuditRateLimit("7.7.7.7", 1_000_000);
    expect(r.remaining).toBe(DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow - 1);
  });

  it("forgetIpForRateLimit clears the bucket for one IP only", () => {
    const t = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("8.8.8.8", t);
    }
    expect(checkAgentAuditRateLimit("8.8.8.8", t).allowed).toBe(false);
    forgetIpForRateLimit("8.8.8.8");
    const reset = checkAgentAuditRateLimit("8.8.8.8", t);
    expect(reset.allowed).toBe(true);
    // And another IP keeps its counter (G3 C3 follow-up).
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("8.8.8.9", t);
    }
    expect(checkAgentAuditRateLimit("8.8.8.9", t).allowed).toBe(false);
  });

  it("allows the Nth request and only the (N+1)th is 429'd", () => {
    // Per spec: the bucket fills 1..N; the Nth is the last allowed;
    // (N+1) is what triggers 429.
    const t = 1_000_000;
    let lastAllowed = true;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      lastAllowed = checkAgentAuditRateLimit("4.4.4.4", t + i).allowed;
    }
    expect(lastAllowed).toBe(true);
    const over = checkAgentAuditRateLimit("4.4.4.4", t + DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow + 1);
    expect(over.allowed).toBe(false);
  });
});

describe("T08a.1 extractIpForRateLimit (trust-proxy-aware)", () => {
  it("returns socket peer when LUCY_TRUST_PROXY is off", () => {
    const ip = extractIpForRateLimit(
      mockRequest({ peer: "203.0.113.5", trustProxy: false, xff: "198.51.100.99" })
    );
    expect(ip).toBe("203.0.113.5");
  });

  it("returns socket peer when LUCY_TRUST_PROXY is on but peer is not in CIDRs", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "203.0.113.5",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.42, 10.0.0.1"
      })
    );
    // Peer 203.0.113.5 is NOT in 10.0.0.0/8 → XFF is ignored.
    expect(ip).toBe("203.0.113.5");
  });

  it("returns socket peer when LUCY_TRUST_PROXY is on but LUCY_TRUSTED_PROXY_CIDRS is empty", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.1",
        trustProxy: true,
        trustedCidrs: "",
        xff: "198.51.100.7, 10.0.0.1"
      })
    );
    expect(ip).toBe("10.0.0.1");
  });

  it("returns right-most non-trusted hop when peer is trusted and XFF is well-formed", () => {
    // Typical ingress chain: client → edge-proxy → internal-proxy → app.
    // XFF reads left-to-right; we walk right-to-left and pick the first
    // hop that is NOT in the trusted set.
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.7, 10.0.0.20, 10.0.0.50"
      })
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("ignores bogus hops in XFF that fail isIP()", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "not-an-ip, 198.51.100.7"
      })
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("falls back to socket peer when all XFF hops are themselves trusted", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "10.0.0.1, 10.0.0.2"
      })
    );
    expect(ip).toBe("10.0.0.50");
  });

  it("two distinct clients behind a trusted proxy yield two distinct IPs (A5 fix)", () => {
    const clientA = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.7, 10.0.0.20"
      })
    );
    const clientB = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.42, 10.0.0.20"
      })
    );
    expect(clientA).toBe("198.51.100.7");
    expect(clientB).toBe("198.51.100.42");
    expect(clientA).not.toBe(clientB);
    // Same proxy peer, distinct XFF clients → independent buckets.
    const t = 1_000_000;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit(clientA, t);
    }
    expect(checkAgentAuditRateLimit(clientA, t).allowed).toBe(false);
    // Client B is unaffected by Client A exhausting the bucket.
    const firstB = checkAgentAuditRateLimit(clientB, t);
    expect(firstB.allowed).toBe(true);
  });

  it("trusted peer with trustProxy OFF falls back to socket peer (G3 B4 boundary)", () => {
    // Even when the direct peer is in the trusted CIDRs, the env switch
    // OFF means XFF is ignored. This guards against the helper ever
    // forgetting the trustProxy gate.
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: false,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.7"
      })
    );
    expect(ip).toBe("10.0.0.50");
  });

  it("multiple non-trusted hops: picks the right-most (G3 B4 boundary)", () => {
    // Deliberately two valid client hops separated by a trusted hop, with
    // the bogus hop in the middle; right-most non-trusted should win
    // (i.e. error-checking with "left-most-wins" would fail this test).
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.99, 10.0.0.20, 198.51.100.7"
      })
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("bogus hop at the right does not bleed across (G3 B4 boundary)", () => {
    // The valid client address is on the left, then a trusted hop, then
    // a bogus non-IP token on the right. The walker must skip the bogus
    // hop and resolve back to the left valid hop.
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: "198.51.100.7, 10.0.0.20, not-an-ip"
      })
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("accepts an array of xff strings (G3 B4 boundary)", () => {
    // Fastify can surface repeated headers as a string array; the helper
    // must join them with commas before walking.
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: ["198.51.100.7, 10.0.0.20", " 10.0.0.50"]
      })
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("ignores non-string xff without throwing (G3 B new)", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: 12345 as unknown as string
      })
    );
    expect(ip).toBe("10.0.0.50");
  });

  it("ignores nested-array xff without throwing (G3 B new)", () => {
    const ip = extractIpForRateLimit(
      mockRequest({
        peer: "10.0.0.50",
        trustProxy: true,
        trustedCidrs: "10.0.0.0/8",
        xff: [["198.51.100.7"]] as unknown as string
      })
    );
    expect(ip).toBe("10.0.0.50");
  });

  it("never throws when raw.socket is missing", () => {
    const ip = extractIpForRateLimit({
      headers: {},
      raw: {}
    });
    expect(ip).toBe("unknown");
  });

  it("never throws when headers is empty", () => {
    const ip = extractIpForRateLimit(mockRequest({ peer: "203.0.113.10" }));
    expect(ip).toBe("203.0.113.10");
  });
});
