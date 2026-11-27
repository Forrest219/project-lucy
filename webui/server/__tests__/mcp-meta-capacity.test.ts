import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_META_CAPACITY_LIMITS,
  McpMetaExecutionCapacity,
  resolveMetaCapacityLimits,
  setMcpMetaExecutionCapacityForTests,
} from "../runtime/mcp-execution-capacity.js";
import {
  QUESTION_BUDGET_MAX_INFLIGHT,
  QuestionBudget,
  budgetConcurrencyReject,
  budgetIdentityKey,
} from "../proxy/question-experience.js";

describe("REQ-0122 D2 meta capacity pool", () => {
  afterEach(() => {
    delete process.env.LUCY_MCP_META_TOKEN_MAX_INFLIGHT;
    delete process.env.LUCY_MCP_META_GLOBAL_MAX_INFLIGHT;
    setMcpMetaExecutionCapacityForTests();
  });

  it("defaults to token 16 / global 64", () => {
    expect(resolveMetaCapacityLimits({})).toEqual(DEFAULT_META_CAPACITY_LIMITS);
  });

  it("SC-03: 17th concurrent lucy_read_source-equivalent admit is refused at token 16", () => {
    const pool = new McpMetaExecutionCapacity({ token: 16, global: 64 });
    const leases = [];
    for (let i = 0; i < 16; i += 1) {
      const d = pool.tryAcquire({ tokenKey: "tok" });
      expect(d.allowed).toBe(true);
      if (d.allowed) leases.push(d.lease);
    }
    const rejected = pool.tryAcquire({ tokenKey: "tok" });
    expect(rejected.allowed).toBe(false);
    if (!rejected.allowed) {
      expect(rejected.scope).toBe("token");
      expect(rejected.max).toBe(16);
      expect(rejected.retryAfterMs).toBeGreaterThan(0);
    }
    for (const lease of leases) lease.release();
  });

  it("meta pool does not share counters with a fresh pool instance", () => {
    const a = new McpMetaExecutionCapacity({ token: 2, global: 8 });
    const b = new McpMetaExecutionCapacity({ token: 2, global: 8 });
    expect(a.tryAcquire({ tokenKey: "t" }).allowed).toBe(true);
    expect(a.tryAcquire({ tokenKey: "t" }).allowed).toBe(true);
    expect(a.tryAcquire({ tokenKey: "t" }).allowed).toBe(false);
    expect(b.tryAcquire({ tokenKey: "t" }).allowed).toBe(true);
  });
});

describe("REQ-0122 D2 budget concurrency envelope", () => {
  it("reject payload carries retryable／retryAfterMs／next_step.max_inflight", async () => {
    const envelope = budgetConcurrencyReject();
    expect(envelope).toEqual({
      action: "reject",
      reason: "question_budget_concurrency_exceeded",
      retryable: true,
      retryAfterMs: 1_000,
      nextStep: { action: "reduce_concurrency_and_retry", max_inflight: QUESTION_BUDGET_MAX_INFLIGHT }
    });

    const budget = new QuestionBudget();
    const identityKey = budgetIdentityKey("u", "tok");
    const sessionId = "s-conc";
    for (let i = 0; i < QUESTION_BUDGET_MAX_INFLIGHT; i += 1) {
      const d = await budget.consumePersisted(undefined, 1, undefined, undefined, {
        identityKey,
        sessionId,
        toolName: "lucy_query",
        canContinue: true,
      });
      expect(d.action).toBe("allow");
    }
    const rejected = await budget.consumePersisted(undefined, 1, undefined, undefined, {
      identityKey,
      sessionId,
      toolName: "lucy_query",
      canContinue: true,
    });
    expect(rejected.action).toBe("reject");
    if (rejected.action !== "reject") return;
    expect(rejected.retryable).toBe(true);
    expect(rejected.retryAfterMs).toBe(1_000);
    expect(rejected.nextStep).toEqual({
      action: "reduce_concurrency_and_retry",
      max_inflight: QUESTION_BUDGET_MAX_INFLIGHT
    });
  });
});
