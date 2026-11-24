import { describe, expect, it } from "vitest";
import {
  McpExecutionCapacity,
  resolveCapacityLimits,
  type CapacityLease,
  type CapacityRequest
} from "../runtime/mcp-execution-capacity";

const limits = { token: 2, agent: 3, connection: 4, global: 6 };
const req = (over: Partial<CapacityRequest> = {}): CapacityRequest => ({
  agentId: "agent-a",
  tokenKey: "tok-1",
  connectionId: "conn-1",
  enforceToken: true,
  ...over
});

function acquire(cap: McpExecutionCapacity, request: CapacityRequest): CapacityLease {
  const decision = cap.tryAcquire(request);
  if (!decision.allowed) throw new Error(`unexpected refusal at ${decision.scope}`);
  return decision.lease;
}

describe("McpExecutionCapacity (P1-82)", () => {
  it("rejects limits that break agent < connection <= global", () => {
    expect(() => new McpExecutionCapacity({ token: 1, agent: 4, connection: 4, global: 6 })).toThrow(/agent < connection <= global/);
    expect(() => new McpExecutionCapacity({ token: 1, agent: 2, connection: 5, global: 4 })).toThrow(/agent < connection <= global/);
    expect(() => new McpExecutionCapacity({ token: 0, agent: 2, connection: 3, global: 4 })).toThrow(/positive integers/);
  });

  it("SC-02: one Agent cannot exceed its total across Tokens and Sessions", () => {
    const cap = new McpExecutionCapacity(limits);
    acquire(cap, req({ tokenKey: "t1" }));
    acquire(cap, req({ tokenKey: "t1" }));
    acquire(cap, req({ tokenKey: "t2" })); // 3rd, different token
    const fourth = cap.tryAcquire(req({ tokenKey: "t3" }));
    expect(fourth).toMatchObject({ allowed: false, scope: "agent", active: 3, max: 3 });
  });

  it("keeps the historical per-Token cap for lucy_query only", () => {
    const cap = new McpExecutionCapacity(limits);
    acquire(cap, req());
    acquire(cap, req());
    expect(cap.tryAcquire(req())).toMatchObject({ allowed: false, scope: "token" });
    // other semantic tools do not consume or check the Token budget
    expect(cap.tryAcquire(req({ enforceToken: false })).allowed).toBe(true);
  });

  it("SC-03: a saturated Agent leaves room on the same connection for another Agent", () => {
    const cap = new McpExecutionCapacity(limits);
    for (let i = 0; i < 3; i += 1) acquire(cap, req({ tokenKey: `t${i}`, enforceToken: false }));
    expect(cap.tryAcquire(req({ tokenKey: "t9", enforceToken: false })).allowed).toBe(false);
    const b = cap.tryAcquire(req({ agentId: "agent-b", tokenKey: "b1" }));
    expect(b.allowed).toBe(true); // connection has 3/4 used, agent-b still gets the last slot
    expect(cap.tryAcquire(req({ agentId: "agent-c", tokenKey: "c1" }))).toMatchObject({ allowed: false, scope: "connection" });
  });

  it("different connections do not consume each other's connection budget", () => {
    const cap = new McpExecutionCapacity(limits);
    for (let i = 0; i < 3; i += 1) acquire(cap, req({ agentId: `a${i}`, tokenKey: `t${i}`, connectionId: "conn-1" }));
    acquire(cap, req({ agentId: "a9", tokenKey: "t9", connectionId: "conn-1" }));
    expect(cap.tryAcquire(req({ agentId: "a10", tokenKey: "t10", connectionId: "conn-1" }))).toMatchObject({ allowed: false, scope: "connection" });
    expect(cap.tryAcquire(req({ agentId: "a10", tokenKey: "t10", connectionId: "conn-2" })).allowed).toBe(true);
  });

  it("global saturation is refused immediately for everyone", () => {
    const cap = new McpExecutionCapacity({ token: 1, agent: 2, connection: 3, global: 3 });
    for (let i = 0; i < 3; i += 1) acquire(cap, req({ agentId: `a${i}`, tokenKey: `t${i}`, connectionId: `c${i}` }));
    expect(cap.tryAcquire(req({ agentId: "late", tokenKey: "tl", connectionId: "c9" }))).toMatchObject({ allowed: false, scope: "global", retryAfterMs: 3000 });
  });

  it("a refused request holds nothing (no upstream work, no leaked counters)", () => {
    const cap = new McpExecutionCapacity(limits);
    for (let i = 0; i < 3; i += 1) acquire(cap, req({ tokenKey: `t${i}`, enforceToken: false }));
    const before = cap.snapshot();
    for (let i = 0; i < 20; i += 1) expect(cap.tryAcquire(req({ tokenKey: "x", enforceToken: false })).allowed).toBe(false);
    const after = cap.snapshot();
    expect(after.global.active).toBe(before.global.active);
    expect(after.activeByAgent).toEqual(before.activeByAgent);
    expect(after.rejectedByScope.agent).toBe(20);
  });

  it("SC-05: release is idempotent and returns every scope to zero", () => {
    const cap = new McpExecutionCapacity(limits);
    const leases = [0, 1, 2].map((i) => acquire(cap, req({ tokenKey: `t${i}` })));
    for (const lease of leases) {
      lease.release();
      lease.release();
    }
    expect(cap.snapshot()).toMatchObject({ global: { active: 0 }, activeByAgent: {}, activeByConnection: {}, activeTokens: 0, acquired: 3, released: 3 });
    expect(cap.tryAcquire(req()).allowed).toBe(true);
  });

  it("SC-07: snapshot carries ids and counters only", () => {
    const cap = new McpExecutionCapacity(limits);
    acquire(cap, req({ tokenKey: "secret-looking-hash-prefix" }));
    const text = JSON.stringify(cap.snapshot());
    expect(text).not.toContain("secret-looking-hash-prefix");
    expect(text).toContain("agent-a");
  });

  it("env resolution repairs bad ordering instead of failing the process", () => {
    const { limits: resolved, repaired } = resolveCapacityLimits({
      LUCY_QUERY_MAX_INFLIGHT: "10",
      LUCY_MCP_AGENT_MAX_INFLIGHT: "12",
      LUCY_MCP_CONNECTION_MAX_INFLIGHT: "8",
      LUCY_MCP_GLOBAL_MAX_INFLIGHT: "5"
    } as NodeJS.ProcessEnv);
    expect(resolved).toEqual({ token: 10, agent: 12, connection: 13, global: 13 });
    expect(repaired).toHaveLength(2);
    expect(resolveCapacityLimits({} as NodeJS.ProcessEnv).limits).toEqual({ token: 4, agent: 8, connection: 16, global: 24 });
  });
});

describe("publicSummary (P1-82 SC-07)", () => {
  it("exposes aggregates without Agent or connection identifiers", () => {
    const cap = new McpExecutionCapacity({ token: 2, agent: 3, connection: 4, global: 6 });
    const decision = cap.tryAcquire({ agentId: "finance-bot", tokenKey: "abc", connectionId: "prod-mysql", enforceToken: true });
    expect(decision.allowed).toBe(true);
    const text = JSON.stringify(cap.publicSummary());
    expect(text).not.toContain("finance-bot");
    expect(text).not.toContain("prod-mysql");
    expect(cap.publicSummary()).toMatchObject({ activeAgents: 1, activeConnections: 1, global: { active: 1 } });
  });
});
