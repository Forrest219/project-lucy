/**
 * T08a.1 audit-trust 集成测试：per-IP rate limit
 * - 单实例 token bucket (rolling window)
 * - 429 envelope + Retry-After header
 * - 401/400/413 rejection 不计入桶
 * - extractIpForRateLimit: request.ip 优先 > X-Forwarded-For 最左 > "unknown"
 * - 不同 IP 独立计数
 * - 窗口过期重置
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_AUDIT_RATE_LIMIT,
  checkAgentAuditRateLimit,
  extractIpForRateLimit,
  forgetIpForRateLimit,
  resetAgentAuditRateLimits
} from "../../admin/agent-audit-rate-limit";

beforeEach(() => {
  resetAgentAuditRateLimits();
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
    // Exhaust IP A.
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      checkAgentAuditRateLimit("10.0.0.1", t);
    }
    const overA = checkAgentAuditRateLimit("10.0.0.1", t);
    expect(overA.allowed).toBe(false);
    // IP B is untouched.
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
  });

  it("does not count unlimited pre-window requests (bucket slot 1..N)", () => {
    // Per spec: the (N+1)th request inside the same window is the one that
    // gets 429'd; the Nth request inside the window still returns allowed.
    const t = 1_000_000;
    let lastAllowed = true;
    for (let i = 0; i < DEFAULT_AGENT_AUDIT_RATE_LIMIT.maxPerWindow; i++) {
      lastAllowed = checkAgentAuditRateLimit("4.4.4.4", t + i).allowed;
    }
    expect(lastAllowed).toBe(true);
  });
});

describe("T08a.1 extractIpForRateLimit", () => {
  it("prefers request.ip", () => {
    const ip = extractIpForRateLimit({
      ip: "203.0.113.5",
      headers: { "x-forwarded-for": "198.51.100.1, 198.51.100.2" }
    });
    expect(ip).toBe("203.0.113.5");
  });

  it("falls back to leftmost x-forwarded-for when ip is missing", () => {
    const ip = extractIpForRateLimit({
      headers: { "x-forwarded-for": "198.51.100.7, 198.51.100.8" }
    });
    expect(ip).toBe("198.51.100.7");
  });

  it("returns 'unknown' when neither ip nor xff is present", () => {
    const ip = extractIpForRateLimit({ headers: {} });
    expect(ip).toBe("unknown");
  });

  it("treats x-forwarded-for as an array (leftmost of first entry)", () => {
    const ip = extractIpForRateLimit({
      headers: { "x-forwarded-for": ["198.51.100.10, 198.51.100.11"] }
    });
    expect(ip).toBe("198.51.100.10");
  });

  it("returns 'unknown' on malformed input without throwing", () => {
    const ip = extractIpForRateLimit({
      headers: { "x-forwarded-for": 12345 as unknown as string }
    });
    expect(ip).toBe("unknown");
  });
});
