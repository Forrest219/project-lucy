/**
 * P1-78 Task 1/8 — MCP inquiry performance contract + judge tests (pure, no network).
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D3/D5/D6/D8/D21/D22/D23, §4.1.1, §5, §6.3)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 1 / Task 8 (judge part)
 *
 * TDD: written before ../lib/mcp-inquiry-performance.mjs and the contract YAML existed.
 * Every historical false-green fixture from Plan Task 1 step 3 has its own test name.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  ABSOLUTE_BUDGETS,
  AGENT_RELATIVE,
  MCP_RELATIVE,
  OWNER_BUDGET_CLASS_MAP,
  P95_MIN_SAMPLE_COUNT,
  P99_MIN_SAMPLE_COUNT,
  QUESTION_PACK_BLOCKED_REASONS,
  SAMPLE_FLOORS,
  TURN_WALL_CLOCK_HARD_LIMIT_MS,
  aggregatePerformance,
  assertSampleFloors,
  checkAttemptOutcomes,
  checkSampleReachability,
  classifyProviderErrors,
  compareBaseline,
  groupAttempts,
  judgeAbsolute,
  judgeLongFollowChains,
  judgeLongFollowScenario,
  judgeWindowsByClass,
  mapOwnerBudgetClass,
  median,
  nearestRank,
  resolveQuestionPackDependency,
  summarizeLatencies,
  validateWaiver
} from "../lib/mcp-inquiry-performance.mjs";
import {
  CONTRACT_ID,
  DEFAULT_PACK_PATH,
  MIN_CHAINS,
  MIN_CHAIN_TURNS,
  PRONOUN_BLOCKLIST_VERSION,
  computePackDigest
} from "../lib/mcp-inquiry-question-pack.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CONTRACT_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-inquiry-performance.yaml");
const QUESTION_BANK_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-upgrade-journeys.yaml");

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

let seq = 0;

function mcpAttempt(over = {}) {
  seq += 1;
  return {
    attemptId: `m${seq}`,
    planItemId: `mp${seq}`,
    scenarioId: "SIMPLE_WARM",
    lane: "mcp",
    cacheState: "warm",
    clientModel: "client-a/model-a",
    environment: "docker-local",
    concurrencyGroup: "single",
    outcome: "correct",
    journeyMs: 1_000,
    firstCorrectResultMs: 800,
    ...over
  };
}

function agentAttempt(over = {}) {
  seq += 1;
  return {
    attemptId: `a${seq}`,
    planItemId: `ap${seq}`,
    scenarioId: "SIMPLE_WARM",
    lane: "agent",
    cacheState: "warm",
    clientModel: "client-a/model-a",
    environment: "docker-local",
    concurrencyGroup: "single",
    outcome: "correct",
    turnWallClockMs: 1_000,
    finalAnswerReceived: true,
    audit: { reconciled: true, failedCallsThisTurn: 0 },
    ...over
  };
}

function provider429(over = {}) {
  return agentAttempt({
    outcome: "error",
    statusCode: 429,
    timestamp: "2026-11-26T00:00:01Z",
    turnWallClockMs: 300,
    ...over
  });
}

/**
 * A BLOCKED stub: the host was unavailable, does not support multi-turn or the
 * question reference could not be resolved, so no final answer could exist at
 * all (Spec D19/D15). Same shape as the evidence library's stub fixture.
 */
function blockedStubAttempt(over = {}) {
  return agentAttempt({
    outcome: "missing_evidence",
    correctness: "unknown",
    finalAnswerReceived: false,
    blocked: true,
    blockedReason: "host_unavailable",
    turnWallClockMs: null,
    ...over
  });
}

function mcpGroup(over = {}) {
  return {
    scenarioId: "SIMPLE_WARM",
    lane: "mcp",
    budgetClass: "simple",
    cacheState: "warm",
    concurrencyGroup: "single",
    clientModel: "client-a/model-a",
    environment: "docker-local",
    attempts: [],
    ...over
  };
}

function agentGroup(over = {}) {
  return {
    scenarioId: "SIMPLE_WARM",
    lane: "agent",
    budgetClass: "simple",
    cacheState: "warm",
    concurrencyGroup: "single",
    clientModel: "client-a/model-a",
    environment: "docker-local",
    attempts: [],
    ...over
  };
}

function goodBaseline(over = {}) {
  return {
    scenarioId: "SIMPLE_WARM",
    cacheState: "warm",
    concurrencyGroup: "single",
    clientModel: "client-a/model-a",
    environment: "docker-local",
    sampleCount: 100,
    p50Ms: 2_000,
    p95Ms: 3_000,
    medianMs: 2_000,
    evidenceBodyDigest: "sha256:evidence-body",
    ...over
  };
}

function times(n, ms) {
  return Array.from({ length: n }, () => ms);
}

function windowTurns(budgetClass, n, wallClockMs, over = {}) {
  return Array.from({ length: n }, () => ({
    budgetClass,
    wallClockMs,
    outcome: "correct",
    ...over
  }));
}

function soakWindow(windowIndex, { simple = 20, complex = 20, simpleMs = 8_000, complexMs = 20_000 } = {}) {
  return {
    windowIndex,
    startMs: windowIndex * 150_000,
    endMs: (windowIndex + 1) * 150_000,
    turns: [
      ...windowTurns("simple", simple, simpleMs),
      ...windowTurns("complex", complex, complexMs)
    ]
  };
}

const ARRIVAL_1_1 = {
  // design values from docs/qa/uat/scale-baseline.md §1.1 MCP-PERF (frozen source; test mirrors them)
  muSeconds: 60,
  sigmaSeconds: 20,
  clipMinSeconds: 20,
  clipMaxSeconds: 120,
  seed: 20261124,
  classShare: { simple: 0.6, complex: 0.4 }
};

function soakInput(over = {}) {
  const identities = Array.from({ length: 50 }, (_, i) => `id-${i}`);
  const windowsData = Array.from({ length: 12 }, (_, w) => {
    const win = soakWindow(w);
    win.turns.forEach((t, i) => {
      t.identityId = identities[(w * 40 + i) % identities.length];
    });
    return win;
  });
  return {
    identities,
    windowPlan: { count: 12, seconds: 150 },
    arrival: ARRIVAL_1_1,
    longChainIdentities: 5,
    windowsData,
    ...over
  };
}

function chainTurns(n, over = {}) {
  return Array.from({ length: n }, (_, i) => ({
    turnIndex: i,
    wallClockMs: 5_000,
    outcome: "correct",
    budgetClass: "simple",
    cacheState: "warm",
    processId: "proc-1",
    hostSessionId: "sess-1",
    ...over
  }));
}

function longChain(over = {}) {
  return {
    chainId: "chain-1",
    templateId: "QB-LONG-01",
    identityId: "id-0",
    runId: "run-1",
    packDigest: "sha256:pack",
    processId: "proc-1",
    hostSessionId: "sess-1",
    turns: chainTurns(21),
    ...over
  };
}

function waiver(over = {}) {
  return {
    id: "20261126-001",
    candidateDigest: "sha256:candidate",
    reason: "customer incident fix must ship",
    issuedAt: "2026-11-26T00:00:00Z",
    expiresAt: "2026-11-30T00:00:00Z",
    makeupPlan: "rerun the formal gate on the successor candidate",
    approvedBy: "委托人",
    scenarios: [{ scenarioId: "SOAK", verdict: "BLOCKED" }],
    ...over
  };
}

const WAIVER_CONTEXT = {
  candidateDigest: "sha256:candidate",
  now: Date.parse("2026-11-26T12:00:00Z"),
  eligibleScenarioIds: ["SOAK"],
  verdicts: { SOAK: "BLOCKED" }
};

// ---------------------------------------------------------------------------
// nearestRank / summarizeLatencies
// ---------------------------------------------------------------------------

describe("nearestRank and latency summary (Spec D6)", () => {
  test("nearest rank uses sorted[ceil(p*N)-1]", () => {
    const samples = [10, 20, 30, 40, 50];
    assert.equal(nearestRank(samples, 50), 30);
    assert.equal(nearestRank(samples, 95), 50);
    assert.equal(nearestRank(samples, 100), 50);
    const twenty = Array.from({ length: 20 }, (_, i) => i + 1);
    assert.equal(nearestRank(twenty, 95), 19);
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(nearestRank(hundred, 99), 99);
    assert.equal(nearestRank([], 95), null);
  });

  test("N<20 yields no formal P95; N<100 yields P99 not_estimable", () => {
    const s19 = summarizeLatencies(times(19, 1_000));
    assert.equal(s19.sampleCount, 19);
    assert.equal(s19.p95Ms, "not_estimable");
    assert.equal(s19.p99Ms, "not_estimable");
    assert.equal(typeof s19.p50Ms, "number");
    assert.equal(typeof s19.medianMs, "number");

    const s20 = summarizeLatencies(times(20, 1_000));
    assert.equal(s20.p95Ms, 1_000);
    assert.equal(s20.p99Ms, "not_estimable");

    const s100 = summarizeLatencies(times(100, 1_000));
    assert.equal(s100.p99Ms, 1_000);
    assert.equal(P95_MIN_SAMPLE_COUNT, 20);
    assert.equal(P99_MIN_SAMPLE_COUNT, 100);
  });

  test("median is the statistical median, distinct from nearest-rank p50", () => {
    assert.equal(median([10, 20, 30, 40]), 25);
    assert.equal(median([10, 20, 30]), 20);
    const s = summarizeLatencies([10, 20, 30, 40]);
    assert.equal(s.p50Ms, 20);
    assert.equal(s.medianMs, 25);
  });
});

// ---------------------------------------------------------------------------
// grouping / sample floors
// ---------------------------------------------------------------------------

describe("groupAttempts and assertSampleFloors (Spec D5/D6)", () => {
  test("groups by scenarioId×cacheState×clientModel×environment×concurrencyGroup", () => {
    const attempts = [
      mcpAttempt({ scenarioId: "SIMPLE_WARM" }),
      mcpAttempt({ scenarioId: "SIMPLE_WARM" }),
      mcpAttempt({ scenarioId: "JOIN_WARM", budgetClass: "complex" }),
      mcpAttempt({ scenarioId: "SIMPLE_WARM", cacheState: "cold" })
    ];
    const groups = groupAttempts(attempts);
    const keys = Object.keys(groups);
    assert.equal(keys.length, 3);
    const warm = Object.values(groups).find(
      (g) => g.scenarioId === "SIMPLE_WARM" && g.cacheState === "warm"
    );
    assert.equal(warm.attempts.length, 2);
  });

  test("missing grouping fields are reported, not silently merged", () => {
    const groups = groupAttempts([mcpAttempt({ clientModel: null })]);
    const g = Object.values(groups)[0];
    assert.ok(g.missingFields.includes("clientModel"));
    const floors = assertSampleFloors(groups, { tier: "pr" });
    assert.equal(floors.ok, false);
    assert.ok(floors.problems.some((p) => /clientModel/.test(p)));
  });

  test("historical false-green: 43 MCP samples across 34 scenarios are not >=20 per scenario", () => {
    const attempts = [];
    for (let i = 0; i < 34; i += 1) {
      const per = i < 9 ? 2 : 1; // 9×2 + 25×1 = 43 total
      for (let j = 0; j < per; j += 1) {
        attempts.push(mcpAttempt({ scenarioId: `SC-${String(i).padStart(2, "0")}` }));
      }
    }
    assert.equal(attempts.length, 43);
    const groups = groupAttempts(attempts);
    assert.equal(Object.keys(groups).length, 34);
    const floors = assertSampleFloors(groups, { tier: "formal" });
    assert.equal(floors.ok, false);
    for (const entry of Object.values(floors.perGroup)) {
      assert.equal(entry.ok, false);
      assert.ok(entry.count < 20);
    }
    // an aggregate-total reading would claim 43 >= 20; per-scenario judgment must refuse it
    const aggregate = aggregatePerformance({
      tier: "formal",
      groups: Object.values(groups).map((g) => ({
        scenarioId: g.scenarioId,
        lane: "mcp",
        budgetClass: "simple",
        cacheState: g.cacheState,
        concurrencyGroup: g.concurrencyGroup,
        clientModel: g.clientModel,
        environment: g.environment,
        attempts: g.attempts
      }))
    });
    assert.notEqual(aggregate.status, "PASS");
    assert.equal(aggregate.releaseReady, false);
  });

  test("PR vs formal floors: MCP 20/100, Agent 3/20; PR Agent never claims formal P95", () => {
    assert.deepEqual(SAMPLE_FLOORS.pr, { mcp: 20, agent: 3 });
    assert.deepEqual(SAMPLE_FLOORS.formal, { mcp: 100, agent: 20 });

    const mcp100 = assertSampleFloors([{ key: "s", lane: "mcp", attempts: times(100, 0).map(() => mcpAttempt()) }], { tier: "formal" });
    assert.equal(mcp100.ok, true);
    const mcp99 = assertSampleFloors([{ key: "s", lane: "mcp", attempts: times(99, 0).map(() => mcpAttempt()) }], { tier: "formal" });
    assert.equal(mcp99.ok, false);

    const agent20 = assertSampleFloors([{ key: "s", lane: "agent", attempts: times(20, 0).map(() => agentAttempt()) }], { tier: "formal" });
    assert.equal(agent20.ok, true);
    assert.equal(agent20.perGroup.s.p95Formal, true);

    const agentPr = assertSampleFloors([{ key: "s", lane: "agent", attempts: times(19, 0).map(() => agentAttempt()) }], { tier: "pr" });
    assert.equal(agentPr.ok, true);
    assert.equal(agentPr.perGroup.s.p95Formal, false);
  });
});

// ---------------------------------------------------------------------------
// §4.1.1 owner budgetClass mapping
// ---------------------------------------------------------------------------

describe("mapOwnerBudgetClass (Spec §4.1.1 exhaustive mapping)", () => {
  test("mapped owner values land on simple/complex/denial", () => {
    for (const v of ["simple", "simple-metric", "group-metric", "empty-result", "time-window", "filter-metric", "follow-up"]) {
      assert.deepEqual(mapOwnerBudgetClass(v), { ok: true, budgetClass: "simple", ownerBudgetClass: v });
    }
    for (const v of ["complex", "multi-source-join", "multi-db", "follow-up-join"]) {
      assert.equal(mapOwnerBudgetClass(v).budgetClass, "complex");
    }
    assert.equal(mapOwnerBudgetClass("denial").budgetClass, "denial");
    assert.equal(OWNER_BUDGET_CLASS_MAP["follow-up"], "simple");
    assert.equal(OWNER_BUDGET_CLASS_MAP["follow-up-join"], "complex");
  });

  test("unmapped or missing owner values are BLOCKED budgetClass_unmapped, never default simple", () => {
    for (const v of ["ops-w0", "incident-watch", "privacy", "ops-w1", "ops-w2", null, undefined, ""]) {
      const r = mapOwnerBudgetClass(v);
      assert.equal(r.ok, false);
      assert.equal(r.verdict, "BLOCKED");
      assert.equal(r.reason, "budgetClass_unmapped");
      assert.equal(r.budgetClass, null);
    }
  });

  test("historical false-green: an always-simple mapBudgetClass equivalent input is rejected", () => {
    // the retired P1-53 runner mapped every scenario to simple; the new judge must
    // BLOCK the same inputs instead of judging them against the simple budget
    const fast = times(100, 100);
    const unmapped = judgeAbsolute({ lane: "mcp", tier: "formal", ownerBudgetClass: "ops-w0", cacheState: "warm", latencies: fast });
    assert.equal(unmapped.verdict, "BLOCKED");
    assert.ok(unmapped.reasons.some((r) => /budgetClass_unmapped/.test(r)));

    const missing = judgeAbsolute({ lane: "mcp", tier: "formal", cacheState: "warm", latencies: fast });
    assert.equal(missing.verdict, "BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// absolute budgets (Spec §5)
// ---------------------------------------------------------------------------

describe("judgeAbsolute (Spec §5 per-class budgets)", () => {
  test("constants mirror Spec §5 design values", () => {
    assert.equal(ABSOLUTE_BUDGETS.mcp.simple.journeyWarmP95Ms, 10_000);
    assert.equal(ABSOLUTE_BUDGETS.mcp.simple.journeyColdP95Ms, 15_000);
    assert.equal(ABSOLUTE_BUDGETS.mcp.complex.journeyWarmP95Ms, 30_000);
    assert.equal(ABSOLUTE_BUDGETS.mcp.complex.journeyColdP95Ms, 45_000);
    assert.equal(ABSOLUTE_BUDGETS.mcp.denial.p95Ms, 500);
    assert.equal(ABSOLUTE_BUDGETS.mcp.denial.p99Ms, 2_000);
    assert.equal(ABSOLUTE_BUDGETS.agent.simple.warmP95Ms, 30_000);
    assert.equal(ABSOLUTE_BUDGETS.agent.simple.coldP95Ms, 45_000);
    assert.equal(ABSOLUTE_BUDGETS.agent.complex.warmP95Ms, 60_000);
    assert.equal(ABSOLUTE_BUDGETS.agent.complex.coldP95Ms, 90_000);
    assert.equal(TURN_WALL_CLOCK_HARD_LIMIT_MS, 120_000);
  });

  test("MCP simple warm journey P95 within/over 10s", () => {
    const pass = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: [...times(19, 9_000), 11_000] });
    assert.equal(pass.verdict, "PASS");
    const fail = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: [...times(18, 9_000), 11_000, 11_000] });
    assert.equal(fail.verdict, "FAIL");
  });

  test("MCP complex cold journey uses the 45s cold budget", () => {
    const pass = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "complex", cacheState: "cold", latencies: times(20, 44_000) });
    assert.equal(pass.verdict, "PASS");
    const fail = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "complex", cacheState: "cold", latencies: times(20, 46_000) });
    assert.equal(fail.verdict, "FAIL");
  });

  test("MCP denial P95 500ms and P99 2s (P99 only when N>=100)", () => {
    const pass = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "denial", cacheState: "warm", latencies: times(100, 400) });
    assert.equal(pass.verdict, "PASS");
    const p95Fail = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "denial", cacheState: "warm", latencies: [...times(94, 400), ...times(6, 600)] });
    assert.equal(p95Fail.verdict, "FAIL");
    const p99Fail = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "denial", cacheState: "warm", latencies: [...times(97, 400), 1_500, 2_100, 2_500] });
    assert.equal(p99Fail.verdict, "FAIL");
    assert.ok(p99Fail.reasons.some((r) => /p99/i.test(r)));
    // with N=20 P99 is not estimable, so the P99 gate cannot fire
    const small = judgeAbsolute({ lane: "mcp", tier: "pr", budgetClass: "denial", cacheState: "warm", latencies: [...times(19, 400), 2_500] });
    assert.equal(small.summary.p99Ms, "not_estimable");
    assert.equal(small.verdict, "PASS");
  });

  test("MCP first-correct-result budget and single-run deadline", () => {
    const ok = judgeAbsolute({
      lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm",
      latencies: times(20, 5_000), firstCorrectResultSamples: times(20, 4_000)
    });
    assert.equal(ok.verdict, "PASS");
    const slowFirst = judgeAbsolute({
      lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm",
      latencies: times(20, 5_000), firstCorrectResultSamples: [...times(18, 4_000), 6_000, 6_000]
    });
    assert.equal(slowFirst.verdict, "FAIL");
    const pastDeadline = judgeAbsolute({
      lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm",
      latencies: times(20, 5_000), firstCorrectResultSamples: [...times(19, 4_000), 16_000]
    });
    assert.equal(pastDeadline.verdict, "FAIL");
    assert.ok(pastDeadline.reasons.some((r) => /deadline|15/.test(r)));
  });

  test("warm initialize P50<=200ms and zero samples over 30s", () => {
    const ok = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: times(20, 5_000), initializeSamples: times(100, 150) });
    assert.equal(ok.verdict, "PASS");
    const slowP50 = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: times(20, 5_000), initializeSamples: times(100, 300) });
    assert.equal(slowP50.verdict, "FAIL");
    const over30 = judgeAbsolute({ lane: "mcp", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: times(20, 5_000), initializeSamples: [...times(99, 150), 31_000] });
    assert.equal(over30.verdict, "FAIL");
    assert.ok(over30.reasons.some((r) => /30s|30000/.test(r)));
  });

  test("MCP below 20 samples is BLOCKED, never a P95 claim", () => {
    const r = judgeAbsolute({ lane: "mcp", tier: "pr", budgetClass: "simple", cacheState: "warm", latencies: times(19, 100) });
    assert.equal(r.verdict, "BLOCKED");
  });

  test("Agent simple warm/cold and complex warm/cold final-answer budgets", () => {
    const warmPass = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: [...times(19, 29_000), 31_000] });
    assert.equal(warmPass.verdict, "PASS");
    const warmFail = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: [...times(18, 29_000), 31_000, 31_000] });
    assert.equal(warmFail.verdict, "FAIL");
    const coldFail = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "cold", latencies: times(20, 46_000) });
    assert.equal(coldFail.verdict, "FAIL");
    const complexCold = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "complex", cacheState: "cold", latencies: times(20, 91_000) });
    assert.equal(complexCold.verdict, "FAIL");
    const complexWarm = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "complex", cacheState: "warm", latencies: times(20, 59_000) });
    assert.equal(complexWarm.verdict, "PASS");
  });

  test("any single turn over 120s is FAIL even when P95 is fine", () => {
    const r = judgeAbsolute({
      lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "warm",
      latencies: times(20, 5_000),
      turns: [{ turnWallClockMs: 5_000 }, { turnWallClockMs: 121_000 }]
    });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.reasons.some((x) => /120000/.test(x)));
  });

  test("Agent PR small sample judges median, never claims formal P95", () => {
    const ok = judgeAbsolute({ lane: "agent", tier: "pr", budgetClass: "simple", cacheState: "warm", latencies: [10_000, 12_000, 11_000] });
    assert.equal(ok.verdict, "PASS");
    assert.equal(ok.claims.p95Formal, false);
    const overMedian = judgeAbsolute({ lane: "agent", tier: "pr", budgetClass: "simple", cacheState: "warm", latencies: [40_000, 41_000, 39_000] });
    assert.equal(overMedian.verdict, "FAIL");
  });

  test("first token P95 10s when the host supports it; not_available is not a failure", () => {
    const na = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: times(20, 5_000), firstTokenSamples: "not_available" });
    assert.equal(na.verdict, "PASS");
    const slow = judgeAbsolute({ lane: "agent", tier: "formal", budgetClass: "simple", cacheState: "warm", latencies: times(20, 5_000), firstTokenSamples: [...times(18, 5_000), 20_000, 20_000] });
    assert.equal(slow.verdict, "FAIL");
  });
});

// ---------------------------------------------------------------------------
// relative baseline gate (Spec D8)
// ---------------------------------------------------------------------------

describe("compareBaseline (Spec D8 relative regression)", () => {
  const current = { scenarioId: "SIMPLE_WARM", cacheState: "warm", concurrencyGroup: "single", clientModel: "client-a/model-a", environment: "docker-local", sampleCount: 100, p50Ms: 900, p95Ms: 1_250, medianMs: 900 };

  test("MCP P95 +20% and +50ms both required for FAIL", () => {
    const base = goodBaseline({ p95Ms: 1_000 });
    const fail = compareBaseline(current, base, { lane: "mcp" });
    assert.equal(fail.verdict, "FAIL"); // +250ms (+25%)
    const onlyRatio = compareBaseline({ ...current, p95Ms: 1_100 }, base, { lane: "mcp" });
    assert.equal(onlyRatio.verdict, "PASS"); // +100ms but +10%
    const tinyBase = compareBaseline({ ...current, p95Ms: 130 }, goodBaseline({ p95Ms: 100 }), { lane: "mcp" });
    assert.equal(tinyBase.verdict, "PASS"); // +30% but only +30ms
    assert.equal(MCP_RELATIVE.ratio, 0.2);
    assert.equal(MCP_RELATIVE.absMs, 50);
  });

  test("Agent median OR P95 +20% and +2s triggers FAIL", () => {
    const base = goodBaseline({ medianMs: 10_000, p95Ms: 12_000 });
    const medFail = compareBaseline({ ...current, medianMs: 12_500, p95Ms: 12_500 }, base, { lane: "agent" });
    assert.equal(medFail.verdict, "FAIL");
    const p95Fail = compareBaseline({ ...current, medianMs: 10_100, p95Ms: 15_000 }, base, { lane: "agent" });
    assert.equal(p95Fail.verdict, "FAIL");
    const smallBase = compareBaseline({ ...current, medianMs: 5_000, p95Ms: 5_100 }, goodBaseline({ medianMs: 4_000, p95Ms: 4_100 }), { lane: "agent" });
    assert.equal(smallBase.verdict, "PASS"); // +25% but +1000ms < 2s
    assert.equal(AGENT_RELATIVE.absMs, 2_000);
  });

  test("historical false-green: p95Ms:null baseline is BLOCKED instead of skipping the relative gate", () => {
    const r = compareBaseline(current, goodBaseline({ p95Ms: null }), { lane: "mcp" });
    assert.equal(r.verdict, "BLOCKED");
    assert.ok(r.reasons.some((x) => /p95Ms/.test(x)));
  });

  test("historical false-green: medianMs:null baseline is BLOCKED", () => {
    const r = compareBaseline({ ...current, medianMs: 900 }, goodBaseline({ medianMs: null }), { lane: "agent" });
    assert.equal(r.verdict, "BLOCKED");
    assert.ok(r.reasons.some((x) => /medianMs/.test(x)));
  });

  test("baseline without real numbers or evidence digest is BLOCKED", () => {
    assert.equal(compareBaseline(current, goodBaseline({ sampleCount: null }), { lane: "mcp" }).verdict, "BLOCKED");
    assert.equal(compareBaseline(current, goodBaseline({ p50Ms: undefined }), { lane: "mcp" }).verdict, "BLOCKED");
    assert.equal(compareBaseline(current, goodBaseline({ evidenceBodyDigest: null }), { lane: "mcp" }).verdict, "BLOCKED");
    assert.equal(compareBaseline(current, goodBaseline({ sampleCount: 10 }), { lane: "mcp" }).verdict, "BLOCKED");
  });

  test("incomparable baseline key is BLOCKED; missing baseline is SEED_ONLY", () => {
    const cold = compareBaseline(current, goodBaseline({ cacheState: "cold" }), { lane: "mcp" });
    assert.equal(cold.verdict, "BLOCKED");
    const otherClient = compareBaseline(current, goodBaseline({ clientModel: "client-b/model-b" }), { lane: "mcp" });
    assert.equal(otherClient.verdict, "BLOCKED");
    const seed = compareBaseline(current, null, { lane: "mcp" });
    assert.equal(seed.verdict, "SEED_ONLY");
  });

  test("current P95 not estimable cannot feed the MCP relative gate", () => {
    const r = compareBaseline({ ...current, p95Ms: "not_estimable", sampleCount: 19 }, goodBaseline(), { lane: "mcp" });
    assert.equal(r.verdict, "BLOCKED");
  });

  test("agent PR without formal P95 compares median only", () => {
    const r = compareBaseline(
      { ...current, p95Ms: "not_estimable", medianMs: 900 },
      goodBaseline({ medianMs: 2_000 }),
      { lane: "agent", p95Formal: false }
    );
    assert.equal(r.verdict, "PASS");
  });
});

// ---------------------------------------------------------------------------
// correctness precondition / denominators (Spec D3)
// ---------------------------------------------------------------------------

describe("correctness precondition and full denominator (Spec D3)", () => {
  test("historical false-green: fast wrong answer cannot PASS", () => {
    const r = checkAttemptOutcomes([mcpAttempt({ outcome: "wrong_answer", journeyMs: 50 })], { lane: "mcp" });
    assert.equal(r.verdict, "FAIL");
    const agg = aggregatePerformance({
      tier: "pr",
      groups: [mcpGroup({ attempts: [...times(19, 0).map(() => mcpAttempt()), mcpAttempt({ outcome: "wrong_answer", journeyMs: 50 })], baseline: goodBaseline() })]
    });
    assert.equal(agg.status, "FAIL");
    assert.equal(agg.releaseReady, false);
  });

  test("unexpected denial, empty envelope, timeout and crash cannot PASS", () => {
    for (const outcome of ["unexpected_deny", "empty_envelope", "timeout", "crash"]) {
      const r = checkAttemptOutcomes([mcpAttempt({ outcome })], { lane: "mcp" });
      assert.equal(r.verdict, "FAIL", outcome);
    }
  });

  test("missing evidence is BLOCKED (fail closed), not PASS", () => {
    const r = checkAttemptOutcomes([mcpAttempt({ outcome: "missing_evidence" })], { lane: "mcp" });
    assert.equal(r.verdict, "BLOCKED");
  });

  test("historical false-green: keeping only the 3rd successful retry cannot PASS", () => {
    const onlyThird = mcpAttempt({ attemptId: "a3", retryOf: "a2", outcome: "correct" });
    const r = checkAttemptOutcomes([onlyThird], { lane: "mcp" });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.reasons.some((x) => /retryOf|success-only/.test(x)));
  });

  test("historical false-green: initialize-only without an answer cannot PASS", () => {
    const r = checkAttemptOutcomes([mcpAttempt({ initializeOnly: true, journeyMs: 120 })], { lane: "mcp" });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.reasons.some((x) => /initialize/.test(x)));
  });

  test("historical false-green: missing final answer cannot PASS", () => {
    const r = checkAttemptOutcomes([agentAttempt({ finalAnswerReceived: false })], { lane: "agent" });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.reasons.some((x) => /final answer/.test(x)));
  });

  test("expected denial observed is correct; expected denial becoming allow is FAIL", () => {
    const denied = checkAttemptOutcomes([mcpAttempt({ outcome: "denied" })], { lane: "mcp", expectedOutcome: "deny" });
    assert.equal(denied.verdict, "PASS");
    const allowed = checkAttemptOutcomes([mcpAttempt({ outcome: "allowed" })], { lane: "mcp", expectedOutcome: "deny" });
    assert.equal(allowed.verdict, "FAIL");
  });

  test("legal control must still deal: failing control fails the denial scenario", () => {
    const denial = mcpGroup({
      scenarioId: "DENIAL_NO_QUERY_WARM",
      budgetClass: "denial",
      attempts: times(20, 0).map(() => mcpAttempt({ scenarioId: "DENIAL_NO_QUERY_WARM", outcome: "denied", journeyMs: 200 })),
      baseline: goodBaseline({ scenarioId: "DENIAL_NO_QUERY_WARM", p95Ms: 400, medianMs: 200, p50Ms: 200 })
    });
    const control = mcpGroup({
      scenarioId: "SIMPLE_WARM",
      attempts: times(20, 0).map(() => mcpAttempt()),
      baseline: goodBaseline()
    });
    const controls = [{ denialScenarioId: "DENIAL_NO_QUERY_WARM", controlScenarioId: "SIMPLE_WARM" }];
    const pass = aggregatePerformance({ tier: "pr", groups: [denial, control], legalControls: controls });
    assert.equal(pass.status, "PASS");

    const brokenControl = mcpGroup({
      scenarioId: "SIMPLE_WARM",
      attempts: [...times(19, 0).map(() => mcpAttempt()), mcpAttempt({ outcome: "unexpected_deny" })],
      baseline: goodBaseline()
    });
    const fail = aggregatePerformance({ tier: "pr", groups: [denial, brokenControl], legalControls: controls });
    assert.equal(fail.status, "FAIL");
    assert.ok(fail.perScenario.DENIAL_NO_QUERY_WARM.reasons.some((x) => /legal control/.test(x)));
  });

  test("a denial scenario without a legal control entry is FAIL (D16)", () => {
    const denial = mcpGroup({
      scenarioId: "DENIAL_NO_QUERY_WARM",
      budgetClass: "denial",
      attempts: times(20, 0).map(() => mcpAttempt({ scenarioId: "DENIAL_NO_QUERY_WARM", outcome: "denied", journeyMs: 200 })),
      baseline: goodBaseline({ scenarioId: "DENIAL_NO_QUERY_WARM", p95Ms: 400, medianMs: 200, p50Ms: 200 })
    });
    const agg = aggregatePerformance({ tier: "pr", groups: [denial], legalControls: [] });
    assert.equal(agg.status, "FAIL");
  });

  test("planned attempts missing from evidence are BLOCKED", () => {
    const agg = aggregatePerformance({
      tier: "pr",
      groups: [mcpGroup({ attempts: times(20, 0).map(() => mcpAttempt()), plannedCount: 25, baseline: goodBaseline() })]
    });
    assert.equal(agg.status, "BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// BLOCKED stub alignment between the judge and the evidence library
// (D19/D15 — a missing host / question is BLOCKED, not a product failure)
// ---------------------------------------------------------------------------

describe("BLOCKED stub handling in the judge (D19/D15, same caliber as the evidence library)", () => {
  test("a BLOCKED agent stub is not judged a product failure and the scenario stays BLOCKED", () => {
    const stub = blockedStubAttempt();
    const corr = checkAttemptOutcomes([stub], { lane: "agent" });
    assert.equal(corr.verdict, "BLOCKED");
    assert.equal(corr.failReasons.length, 0, JSON.stringify(corr.failReasons));
    assert.ok(!corr.reasons.some((r) => /missing final answer/.test(r)));

    // The stub stays in the denominator and can never buy a PASS.
    const attempts = Array.from({ length: 3 }, (_unused, i) =>
      blockedStubAttempt({ attemptId: `stub-${i}`, planItemId: `plan-${i}` })
    );
    const agg = aggregatePerformance({ tier: "pr", groups: [agentGroup({ attempts })] });
    assert.equal(agg.status, "BLOCKED");
    assert.notEqual(agg.status, "PASS");
    assert.equal(agg.releaseReady, false);
    const entry = agg.perScenario.SIMPLE_WARM;
    assert.equal(entry.verdict, "BLOCKED");
    assert.equal(entry.counts.planned, 3);
    assert.equal(entry.counts.started, 3);
    assert.equal(entry.counts.missingEvidence, 3);
    assert.ok(entry.reasons.some((r) => /BLOCKED stub/.test(r)), entry.reasons.join("; "));
  });

  test("a real agent attempt with tool results but no final answer still fails (D3)", () => {
    const attempt = agentAttempt({
      outcome: "error",
      correctness: "incorrect",
      errorClass: "no_final_answer",
      finalAnswerReceived: false,
      mcpCalls: [{ method: "lucy_query", resultCount: 1 }]
    });
    const corr = checkAttemptOutcomes([attempt], { lane: "agent" });
    assert.equal(corr.verdict, "FAIL");
    assert.ok(corr.failReasons.some((r) => /missing final answer/.test(r)));
  });

  test("blocked without a blockedReason does not buy the narrowing (D3)", () => {
    const noReason = agentAttempt({
      outcome: "error",
      correctness: "incorrect",
      finalAnswerReceived: false,
      blocked: true
    });
    const withoutReason = checkAttemptOutcomes([noReason], { lane: "agent" });
    assert.equal(withoutReason.verdict, "FAIL");
    assert.ok(withoutReason.failReasons.some((r) => /missing final answer/.test(r)));

    const blankReason = agentAttempt({
      outcome: "error",
      correctness: "incorrect",
      finalAnswerReceived: false,
      blocked: true,
      blockedReason: "   "
    });
    const blank = checkAttemptOutcomes([blankReason], { lane: "agent" });
    assert.equal(blank.verdict, "FAIL");
    assert.ok(blank.failReasons.some((r) => /missing final answer/.test(r)));
  });

  test("a BLOCKED stub that also carries a product error is still FAIL (D3 is not weakened)", () => {
    const stubWithError = blockedStubAttempt({ outcome: "timeout", correctness: "incorrect" });
    const corr = checkAttemptOutcomes([stubWithError], { lane: "agent" });
    assert.equal(corr.verdict, "FAIL");
    assert.ok(corr.failReasons.some((r) => /timeout/.test(r)));
  });

  test("the judge and the evidence library agree on which agent attempts are BLOCKED stubs", async () => {
    const { validateAttempt } = await import("../lib/mcp-inquiry-performance-evidence.mjs");
    const variants = [
      ["BLOCKED stub", blockedStubAttempt()],
      ["real attempt with tool results", agentAttempt({ outcome: "error", correctness: "incorrect", finalAnswerReceived: false })],
      ["blocked without a reason", agentAttempt({ outcome: "error", correctness: "incorrect", finalAnswerReceived: false, blocked: true })],
      ["blocked with a blank reason", agentAttempt({ outcome: "error", correctness: "incorrect", finalAnswerReceived: false, blocked: true, blockedReason: "  " })],
      ["final answer received", agentAttempt({ finalAnswerReceived: true })]
    ];
    for (const [label, attempt] of variants) {
      const evidenceFlags = validateAttempt(attempt).problems.some((p) => p.code === "MISSING_FINAL_ANSWER");
      const judgeFlags = checkAttemptOutcomes([attempt], { lane: "agent" }).failReasons.some((r) =>
        /missing final answer/.test(r)
      );
      assert.equal(judgeFlags, evidenceFlags, label);
    }
  });
});

// ---------------------------------------------------------------------------
// provider error classification (Spec D21)
// ---------------------------------------------------------------------------

describe("classifyProviderErrors (Spec D21)", () => {
  test("evidence-complete 429 with successful retry: providerError, original kept, retry is the judgment sample", () => {
    const first = provider429({ attemptId: "p1", planItemId: "plan-1" });
    const retry = agentAttempt({ attemptId: "p1-retry", planItemId: "plan-1", retryOf: "p1", turnWallClockMs: 1_200 });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const r = classifyProviderErrors([first, retry, ...others]);
    const sc = r.scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "OK");
    assert.equal(sc.providerErrorCount, 1);
    assert.equal(sc.retryCount, 1);
    assert.equal(r.attempts.length, 11); // evidence denominator keeps the original record
    const classified = r.attempts.find((a) => a.attemptId === "p1");
    assert.equal(classified.classification, "providerError");
    assert.equal(classified.judgmentSample, false);
    const judgment = r.attempts.filter((a) => a.judgmentSample);
    assert.equal(judgment.length, 10); // judgment denominator takes the retry sample
    assert.equal(judgment.find((a) => a.planItemId === "plan-1").attemptId, "p1-retry");
  });

  test("D21⑧ positive boundary: single 429 + retry success + share <=10% can PASS with disclosure", () => {
    const first = provider429({ attemptId: "p1", planItemId: "plan-1" });
    const retry = agentAttempt({ attemptId: "p1-retry", planItemId: "plan-1", retryOf: "p1", turnWallClockMs: 1_200 });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const agg = aggregatePerformance({
      tier: "pr",
      groups: [agentGroup({ attempts: [first, retry, ...others], baseline: goodBaseline() })]
    });
    assert.equal(agg.status, "PASS");
    assert.equal(agg.releaseReady, true);
    assert.equal(agg.disclosure.providerErrorCount, 1);
    assert.equal(agg.disclosure.retryCount, 1);
    assert.equal(agg.perScenario.SIMPLE_WARM.counts.judgmentSamples, 10);
  });

  test("providerError share >10% is BLOCKED(providerUnavailable) even when retries succeed", () => {
    const attempts = [];
    for (let i = 0; i < 10; i += 1) {
      if (i < 2) {
        const planId = `plan-${i}`;
        attempts.push(provider429({ attemptId: `e${i}`, planItemId: planId }));
        attempts.push(agentAttempt({ attemptId: `e${i}-retry`, planItemId: planId, retryOf: `e${i}` }));
      } else {
        attempts.push(agentAttempt({ planItemId: `plan-${i}` }));
      }
    }
    const r = classifyProviderErrors(attempts);
    const sc = r.scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "BLOCKED");
    assert.equal(sc.blockedReason, "providerUnavailable");
    assert.equal(sc.triggers.shareExceeded, true);
    assert.equal(sc.providerErrorShare, 0.2);
  });

  test("boundary: share exactly 10% does not trigger the share rule", () => {
    const attempts = [provider429({ attemptId: "e0", planItemId: "plan-0" }), agentAttempt({ attemptId: "e0-retry", planItemId: "plan-0", retryOf: "e0" })];
    for (let i = 1; i < 10; i += 1) attempts.push(agentAttempt({ planItemId: `plan-${i}` }));
    const sc = classifyProviderErrors(attempts).scenarios.SIMPLE_WARM;
    assert.equal(sc.triggers.shareExceeded, false);
    assert.equal(sc.verdict, "OK");
  });

  test("3 consecutive providerErrors are BLOCKED(providerUnavailable)", () => {
    const attempts = [];
    // three providerErrors in a row (retries succeed later, so the share stays at 3/30 = 10%)
    for (let i = 0; i < 3; i += 1) attempts.push(provider429({ attemptId: `c${i}`, planItemId: `plan-${i}` }));
    for (let i = 0; i < 3; i += 1) attempts.push(agentAttempt({ attemptId: `c${i}-retry`, planItemId: `plan-${i}`, retryOf: `c${i}` }));
    for (let i = 3; i < 30; i += 1) attempts.push(agentAttempt({ planItemId: `plan-${i}` }));
    const sc = classifyProviderErrors(attempts).scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "BLOCKED");
    assert.equal(sc.triggers.consecutive, true);
    assert.equal(sc.triggers.shareExceeded, false);
    assert.equal(sc.blockedReason, "providerUnavailable");
  });

  test("2 retries still failing is BLOCKED(providerUnavailable), retry success would not convert to PASS", () => {
    const attempts = [
      provider429({ attemptId: "x1", planItemId: "plan-x" }),
      provider429({ attemptId: "x2", planItemId: "plan-x", retryOf: "x1" }),
      provider429({ attemptId: "x3", planItemId: "plan-x", retryOf: "x2" })
    ];
    for (let i = 0; i < 30; i += 1) attempts.push(agentAttempt({ planItemId: `plan-${i}` }));
    const sc = classifyProviderErrors(attempts).scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "BLOCKED");
    assert.equal(sc.triggers.retryExhausted, true);
    assert.equal(sc.blockedReason, "providerUnavailable");
  });

  test("more than 2 retries violates the retry bound", () => {
    const attempts = [
      provider429({ attemptId: "y1", planItemId: "plan-y" }),
      provider429({ attemptId: "y2", planItemId: "plan-y", retryOf: "y1" }),
      provider429({ attemptId: "y3", planItemId: "plan-y", retryOf: "y2" }),
      agentAttempt({ attemptId: "y4", planItemId: "plan-y", retryOf: "y3" })
    ];
    const sc = classifyProviderErrors(attempts).scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "BLOCKED");
    assert.ok(sc.reasons.some((x) => /retry/i.test(x)));
  });

  test("slow without error is FAIL, never a providerError", () => {
    const slow = agentAttempt({ attemptId: "slow-1", planItemId: "plan-s", turnWallClockMs: 130_000 });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const r = classifyProviderErrors([slow, ...others]);
    const slowAttempt = r.attempts.find((a) => a.attemptId === "slow-1");
    assert.equal(slowAttempt.classification, "slow_no_error");
    const sc = r.scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "FAIL");
    assert.equal(sc.providerErrorCount, 0);
    const agg = aggregatePerformance({
      tier: "pr",
      groups: [agentGroup({ attempts: [slow, ...others], baseline: goodBaseline() })]
    });
    assert.equal(agg.status, "FAIL");
  });

  test("Lucy-side error masquerading as providerError is rejected and stays FAIL", () => {
    const lucy = agentAttempt({
      attemptId: "l1",
      planItemId: "plan-l",
      outcome: "error",
      errorKind: "lucy_error",
      claimedClass: "providerError",
      statusCode: 500,
      timestamp: "2026-11-26T00:00:02Z",
      audit: { reconciled: true, failedCallsThisTurn: 2 }
    });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const r = classifyProviderErrors([lucy, ...others]);
    const classified = r.attempts.find((a) => a.attemptId === "l1");
    assert.equal(classified.classification, "lucy_error");
    assert.ok(r.problems.some((x) => /relabel|claimed/i.test(x)));
    const sc = r.scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "FAIL");
    assert.equal(sc.providerErrorCount, 0);
  });

  test("receipt missing status code cannot be marked providerError; missing evidence is BLOCKED", () => {
    const noStatus = agentAttempt({
      attemptId: "n1",
      planItemId: "plan-n",
      outcome: "error",
      errorKind: "http_5xx",
      timestamp: "2026-11-26T00:00:03Z"
      // no statusCode
    });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const r = classifyProviderErrors([noStatus, ...others]);
    const classified = r.attempts.find((a) => a.attemptId === "n1");
    assert.notEqual(classified.classification, "providerError");
    assert.equal(classified.classification, "unclassifiable");
    const sc = r.scenarios.SIMPLE_WARM;
    assert.equal(sc.verdict, "BLOCKED");
    assert.ok(sc.reasons.some((x) => /evidence|statusCode/i.test(x)));
  });

  test("audit showing a failed Lucy call this turn cannot be providerError even with a 429 receipt", () => {
    const conflicted = provider429({ attemptId: "c1", planItemId: "plan-c", audit: { reconciled: true, failedCallsThisTurn: 1 } });
    const others = Array.from({ length: 9 }, () => agentAttempt());
    const r = classifyProviderErrors([conflicted, ...others]);
    assert.equal(r.attempts.find((a) => a.attemptId === "c1").classification, "lucy_error");
    assert.equal(r.scenarios.SIMPLE_WARM.verdict, "FAIL");
  });
});

// ---------------------------------------------------------------------------
// SOAK windows (Spec D23)
// ---------------------------------------------------------------------------

describe("judgeWindowsByClass (Spec D23)", () => {
  const budgets = { simple: 30_000, complex: 60_000 };

  test("window with N=19 falls back to median + no timeout + no error; N=20 judges P95", () => {
    const w19 = soakWindow(0, { simple: 19, complex: 20 });
    const r19 = judgeWindowsByClass([w19], { lane: "agent", budgets });
    const simple19 = r19.perWindow[0].perClass.simple;
    assert.equal(simple19.n, 19);
    assert.equal(simple19.p95Ms, "not_estimable");
    assert.equal(simple19.verdict, "PASS");
    const complex20 = r19.perWindow[0].perClass.complex;
    assert.equal(complex20.p95Ms, 20_000);
    assert.equal(complex20.verdict, "PASS");
    assert.equal(r19.verdict, "PASS");
  });

  test("N=19 fallback fails when the median exceeds the class P95 budget", () => {
    const w = soakWindow(0, { simple: 19, simpleMs: 31_000 });
    const r = judgeWindowsByClass([w], { lane: "agent", budgets });
    assert.equal(r.perWindow[0].perClass.simple.verdict, "FAIL");
    assert.equal(r.verdict, "FAIL");
  });

  test("N=19 fallback fails on any error or timeout in the window", () => {
    const withError = soakWindow(0, { simple: 19 });
    withError.turns[0].outcome = "wrong_answer";
    const r1 = judgeWindowsByClass([withError], { lane: "agent", budgets });
    assert.equal(r1.perWindow[0].perClass.simple.verdict, "FAIL");

    const withTimeout = soakWindow(0, { simple: 19 });
    withTimeout.turns[1].timedOut = true;
    const r2 = judgeWindowsByClass([withTimeout], { lane: "agent", budgets });
    assert.equal(r2.perWindow[0].perClass.simple.verdict, "FAIL");
  });

  test("N=20 window judges P95 against the class budget", () => {
    const over = soakWindow(0, { simple: 20, simpleMs: 31_000 });
    const r = judgeWindowsByClass([over], { lane: "agent", budgets });
    assert.equal(r.perWindow[0].perClass.simple.p95Ms, 31_000);
    assert.equal(r.perWindow[0].perClass.simple.verdict, "FAIL");
  });

  test("window with zero samples for a class is BLOCKED, not skipped", () => {
    const w = soakWindow(0, { simple: 0 });
    const r = judgeWindowsByClass([w], { lane: "agent", budgets });
    assert.equal(r.perWindow[0].perClass.simple.verdict, "BLOCKED");
    assert.equal(r.verdict, "BLOCKED");
  });

  test("adjacent windows compare medians with the D8 dual threshold", () => {
    const windows = Array.from({ length: 12 }, (_, i) => soakWindow(i, { simpleMs: i === 5 ? 26_000 : 8_000 }));
    // window 5 median 26s vs window 4 median 8s: +18s (+225%) -> breach
    const r = judgeWindowsByClass(windows, { lane: "agent", budgets });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.reasons.some((x) => /adjacent/.test(x)));

    const calm = Array.from({ length: 12 }, (_, i) => soakWindow(i, { simpleMs: i === 5 ? 9_000 : 8_000 }));
    const r2 = judgeWindowsByClass(calm, { lane: "agent", budgets });
    assert.equal(r2.verdict, "PASS");
  });

  test("first/last segments merge ceil(W/3) windows and compare P95 with D8 thresholds", () => {
    const windows = Array.from({ length: 12 }, (_, i) => soakWindow(i, { simpleMs: i >= 8 ? 31_000 : 25_000 }));
    const r = judgeWindowsByClass(windows, { lane: "agent", budgets });
    const trend = r.trends.firstLast.simple;
    assert.equal(trend.segmentWindows, 4);
    assert.equal(trend.metric, "p95");
    // last segment P95 31s vs first segment P95 25s: +6s (+24%) -> breach
    assert.equal(trend.breach, true);
    assert.equal(r.verdict, "FAIL");

    const calm = Array.from({ length: 12 }, (_, i) => soakWindow(i, { simpleMs: i >= 8 ? 26_000 : 25_000 }));
    const r2 = judgeWindowsByClass(calm, { lane: "agent", budgets });
    assert.equal(r2.trends.firstLast.simple.breach, false);
    assert.equal(r2.verdict, "PASS");
  });

  test("first/last merged N<20 compares medians instead of P95", () => {
    const windows = Array.from({ length: 12 }, (_, i) => soakWindow(i, { complex: 3, complexMs: i >= 8 ? 70_000 : 30_000 }));
    const r = judgeWindowsByClass(windows, { lane: "agent", budgets });
    const trend = r.trends.firstLast.complex;
    assert.equal(trend.metric, "median");
    assert.equal(trend.breach, true); // 70s vs 30s median: >20% and >2s
    assert.equal(r.verdict, "FAIL");
  });

  test("end-of-window in-flight turns drain up to 120s into the window they were offered in", () => {
    const w0 = soakWindow(0);
    w0.turns.push({ budgetClass: "simple", wallClockMs: 111_000, outcome: "correct", offeredAtMs: 149_000, endedAtMs: 260_000 });
    const ok = judgeWindowsByClass([w0], { lane: "agent", budgets });
    assert.equal(ok.verdict, "PASS");

    const beyondDrain = soakWindow(0);
    beyondDrain.turns.push({ budgetClass: "simple", wallClockMs: 131_000, outcome: "correct", offeredAtMs: 149_000, endedAtMs: 281_000 });
    const r1 = judgeWindowsByClass([beyondDrain], { lane: "agent", budgets });
    assert.equal(r1.verdict, "FAIL");

    const w1 = soakWindow(1);
    w1.turns.push({ budgetClass: "simple", wallClockMs: 5_000, outcome: "correct", offeredAtMs: 149_000, endedAtMs: 155_000 });
    const misplaced = judgeWindowsByClass([soakWindow(0), w1], { lane: "agent", budgets });
    assert.equal(misplaced.verdict, "FAIL");
    assert.ok(misplaced.reasons.some((x) => /window|offered/.test(x)));
  });
});

// ---------------------------------------------------------------------------
// sample reachability (Spec D23③)
// ---------------------------------------------------------------------------

describe("checkSampleReachability (Spec D23③)", () => {
  test("scale-baseline §1.1 design values are reachable", () => {
    const r = checkSampleReachability({
      arrival: ARRIVAL_1_1,
      identities: 50,
      windows: { count: 12, seconds: 150 },
      longChainIdentities: 5
    });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "OK");
    assert.ok(Math.abs(r.expected.perWindowPerClass.simple - 75) < 1e-9);
    assert.ok(Math.abs(r.expected.perWindowPerClass.complex - 50) < 1e-9);
    assert.ok(Math.abs(r.expected.perChainIdentityTotal - 30) < 1e-9);
  });

  test("any window×class expectation <20 is BLOCKED sample_unreachable", () => {
    const r = checkSampleReachability({
      arrival: ARRIVAL_1_1,
      identities: 10, // complex: 10×150/60×0.4 = 10 < 20
      windows: { count: 12, seconds: 150 },
      longChainIdentities: 0
    });
    assert.equal(r.ok, false);
    assert.equal(r.verdict, "BLOCKED");
    assert.equal(r.reason, "sample_unreachable");
    assert.ok(r.problems.some((x) => /complex/.test(x)));
  });

  test("long-chain identity expectation <21 over the full effective window is BLOCKED", () => {
    const r = checkSampleReachability({
      arrival: ARRIVAL_1_1,
      identities: 50,
      windows: { count: 4, seconds: 150 }, // 600s/60s = 10 < 21
      longChainIdentities: 5
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "sample_unreachable");
    assert.ok(r.problems.some((x) => /long-chain|21/.test(x)));
  });

  test("invalid arrival parameters are BLOCKED, not guessed", () => {
    const r = checkSampleReachability({
      arrival: { muSeconds: 0, sigmaSeconds: 20, clipMinSeconds: 20, clipMaxSeconds: 120, seed: 1, classShare: { simple: 1 } },
      identities: 50,
      windows: { count: 12, seconds: 150 }
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "sample_unreachable");
  });
});

// ---------------------------------------------------------------------------
// LONG_FOLLOW chains (Spec D20 / §5.4)
// ---------------------------------------------------------------------------

describe("judgeLongFollowChains (Spec D20, §5.4)", () => {
  test("5 valid chain instances out of 50 planned meet the >=10% ratio", () => {
    const chains = Array.from({ length: 5 }, (_, i) =>
      longChain({ chainId: `c${i}`, templateId: `QB-LONG-0${(i % 3) + 1}`, identityId: `id-${i}` })
    );
    const r = judgeLongFollowChains(chains, { plannedChainCount: 50, expectedPackDigest: "sha256:pack" });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.requiredChains, 5);
    assert.equal(r.validChains, 5);
  });

  test("same chain instance (template×identity×runId) executed twice is invalid; different identities are legal", () => {
    const dup = [longChain({ chainId: "c1" }), longChain({ chainId: "c2" })];
    const r1 = judgeLongFollowChains(dup, { plannedChainCount: 2, expectedPackDigest: "sha256:pack" });
    assert.equal(r1.verdict, "FAIL");
    assert.ok(r1.reasons.some((x) => /twice|instance/.test(x)));

    const legal = [longChain({ chainId: "c1", identityId: "id-0" }), longChain({ chainId: "c2", identityId: "id-1" })];
    const r2 = judgeLongFollowChains(legal, { plannedChainCount: 2, expectedPackDigest: "sha256:pack" });
    assert.equal(r2.verdict, "PASS");
  });

  test("chain below 21 total turns, process/session change, or turnIndex gap is invalid", () => {
    const short = judgeLongFollowChains([longChain({ turns: chainTurns(20) })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(short.verdict, "FAIL");

    const movedTurns = chainTurns(21);
    movedTurns[10].processId = "proc-2";
    const moved = judgeLongFollowChains([longChain({ turns: movedTurns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(moved.verdict, "FAIL");

    const gapTurns = chainTurns(21);
    gapTurns[10].turnIndex = 12;
    const gap = judgeLongFollowChains([longChain({ turns: gapTurns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(gap.verdict, "FAIL");
  });

  test("any single wrong turn fails the whole chain but keeps every turn on record", () => {
    const turns = chainTurns(21);
    turns[13].outcome = "wrong_answer";
    const r = judgeLongFollowChains([longChain({ turns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(r.verdict, "FAIL");
    assert.equal(r.chains[0].turnCount, 21);
    assert.ok(r.chains[0].reasons.some((x) => /turn 13/.test(x)));
  });

  test("per-turn class budget and 120s hard line apply inside chains", () => {
    const slowTurns = chainTurns(21);
    slowTurns[3].wallClockMs = 31_000; // simple warm per-turn budget 30s
    const r1 = judgeLongFollowChains([longChain({ turns: slowTurns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(r1.verdict, "FAIL");

    const hardTurns = chainTurns(21);
    hardTurns[4].wallClockMs = 125_000;
    const r2 = judgeLongFollowChains([longChain({ turns: hardTurns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(r2.verdict, "FAIL");
  });

  test("last-5 vs first-5 median regression uses the D8 dual threshold", () => {
    const turns = chainTurns(21);
    for (let i = 16; i < 21; i += 1) turns[i].wallClockMs = 9_000; // +4s (+80%) vs first-5 median 5s
    const r = judgeLongFollowChains([longChain({ turns })], { plannedChainCount: 1, expectedPackDigest: "sha256:pack" });
    assert.equal(r.verdict, "FAIL");
    assert.ok(r.chains[0].reasons.some((x) => /first-5|last-5/.test(x)));
  });

  test("ratio below ceil(0.1×N) is rejected; missing pack digest is BLOCKED", () => {
    const chains = Array.from({ length: 4 }, (_, i) => longChain({ chainId: `c${i}`, identityId: `id-${i}` }));
    const r = judgeLongFollowChains(chains, { plannedChainCount: 50, expectedPackDigest: "sha256:pack" });
    assert.equal(r.verdict, "FAIL");
    assert.equal(r.ratioOk, false);

    const noDigest = judgeLongFollowChains([longChain()], { plannedChainCount: 1, expectedPackDigest: null });
    assert.equal(noDigest.verdict, "BLOCKED");
  });
});

// ---------------------------------------------------------------------------
// waivers (Spec D22)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// question pack dependency guard (P1-79 consumer side; D19 / D20)
// ---------------------------------------------------------------------------

function buildPackTurn(chainId, index) {
  return {
    turnIndex: index,
    text: `查询 superstore_orders 在 2025 年 ${(index % 12) + 1} 月的订单销售额（${chainId} 第 ${index + 1} 轮）`,
    dependsOnTurn: index === 0 ? null : index - 1,
    carriedContext: ["连接=demo-mysql", "表=superstore_orders", "指标=订单销售额"],
    oracle: {
      kind: "independent-query",
      ref: `fixtures/oracle/${chainId}/turn-${String(index).padStart(2, "0")}.sql`,
      expect: { total_sales: 100_000 + index }
    }
  };
}

function buildPackChain(id, { budgetClass = "simple", identity = "read_only", turnCount = MIN_CHAIN_TURNS } = {}) {
  return {
    id,
    version: 1,
    lane: "long-followup",
    configProfileId: "lucy-mcp-compat-demo",
    budgetClass,
    identity,
    connectionId: "demo-mysql",
    turns: Array.from({ length: turnCount }, (_unused, index) => buildPackTurn(id, index)),
    evidence: ["requestId", "traceId", "identityId", "snapshotId"]
  };
}

function buildPack(chains) {
  const pack = {
    contract: CONTRACT_ID,
    version: 1,
    packDigestSeed: "p1-79-seed-20261126",
    pronounBlocklistVersion: PRONOUN_BLOCKLIST_VERSION,
    cases: chains
  };
  return { ...pack, packDigest: computePackDigest(pack) };
}

function buildValidPack(overrides = {}) {
  const pack = buildPack([
    buildPackChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildPackChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildPackChain("QB-LONG-03", { budgetClass: "complex", identity: "read_only" }),
    buildPackChain("QB-LONG-04", { budgetClass: "complex", identity: "restricted_A" }),
    buildPackChain("QB-LONG-05", { budgetClass: "follow-up-join", identity: "restricted_B" })
  ]);
  return { ...pack, ...overrides };
}

describe("resolveQuestionPackDependency (consumer-side read-only guard, D19/D20)", () => {
  test("the shipped pack passes the guard with the digest the contract froze", () => {
    const contract = parse(readFileSync(CONTRACT_PATH, "utf8"));
    const scenario = contract.scenarios.find((s) => s.scenarioId === "LONG_FOLLOW");
    const result = resolveQuestionPackDependency({
      packPath: DEFAULT_PACK_PATH,
      expectedDigest: scenario.packDigest,
      requiredChainIds: scenario.questionRef
    });
    assert.equal(result.ok, true, result.problems.join("; "));
    assert.equal(result.status, "OK");
    assert.equal(result.reason, null);
    assert.equal(result.digest, scenario.packDigest);
    assert.equal(result.chains.length, MIN_CHAINS);
    for (const chain of result.chains) {
      assert.equal(chain.turnCount, MIN_CHAIN_TURNS);
    }
  });

  test("the contract and the scenario freeze the same pack digest", () => {
    const contract = parse(readFileSync(CONTRACT_PATH, "utf8"));
    const scenario = contract.scenarios.find((s) => s.scenarioId === "LONG_FOLLOW");
    assert.match(contract.longFollowUpPackRef.packDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(scenario.packDigest, contract.longFollowUpPackRef.packDigest);
    // The frozen digest must be the digest of the shipped pack.
    const result = resolveQuestionPackDependency({
      packPath: DEFAULT_PACK_PATH,
      expectedDigest: scenario.packDigest
    });
    assert.equal(result.ok, true, result.problems.join("; "));
  });

  test("a missing pack is BLOCKED with the missing-pack reason code", () => {
    const result = resolveQuestionPackDependency({
      packPath: "scripts/e2e/contracts/mcp-inquiry-long-followups.absent.yaml",
      expectedDigest: "sha256:whatever"
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING);
  });

  test("a pack that cannot be read at all is BLOCKED, never a self-made question", () => {
    const result = resolveQuestionPackDependency({
      loadPack: () => {
        throw new Error("boom");
      },
      expectedDigest: "sha256:whatever"
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.PACK_UNREADABLE);
  });

  test("a digest that does not match the frozen one is BLOCKED", () => {
    const pack = buildValidPack();
    const result = resolveQuestionPackDependency({
      pack,
      expectedDigest: `sha256:${"0".repeat(64)}`
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISMATCH);
    assert.ok(result.problems.some((p) => p.includes(QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISMATCH)));
  });

  test("a scenario without a frozen digest is BLOCKED", () => {
    const result = resolveQuestionPackDependency({ pack: buildValidPack(), expectedDigest: null });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISSING);
  });

  test("too few chain templates are BLOCKED (the consumer never splits chains)", () => {
    const pack = buildPack([
      buildPackChain("QB-LONG-01", { identity: "read_only" }),
      buildPackChain("QB-LONG-02", { identity: "lucy_admin" }),
      buildPackChain("QB-LONG-03", { budgetClass: "complex", identity: "read_only" }),
      buildPackChain("QB-LONG-04", { budgetClass: "complex", identity: "restricted_A" })
    ]);
    const result = resolveQuestionPackDependency({ pack, expectedDigest: pack.packDigest });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.CHAIN_COUNT_INSUFFICIENT);
    assert.ok(result.problems.some((p) => p.includes("need >= 5")));
  });

  test("a chain with too few turns is BLOCKED (the consumer never shortens a chain)", () => {
    const pack = buildPack([
      buildPackChain("QB-LONG-01", { identity: "read_only" }),
      buildPackChain("QB-LONG-02", { identity: "lucy_admin" }),
      buildPackChain("QB-LONG-03", { budgetClass: "complex", identity: "read_only" }),
      buildPackChain("QB-LONG-04", { budgetClass: "complex", identity: "restricted_A" }),
      buildPackChain("QB-LONG-05", { budgetClass: "follow-up-join", identity: "restricted_B", turnCount: 20 })
    ]);
    const result = resolveQuestionPackDependency({ pack, expectedDigest: pack.packDigest });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.CHAIN_TURNS_INSUFFICIENT);
    assert.ok(result.problems.some((p) => /QB-LONG-05/.test(p)));
  });

  test("a scenario that references a chain the pack does not contain is BLOCKED", () => {
    const pack = buildValidPack();
    const result = resolveQuestionPackDependency({
      pack,
      expectedDigest: pack.packDigest,
      requiredChainIds: ["QB-LONG-01", "QB-LONG-99"]
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.CHAIN_REF_UNKNOWN);
    assert.ok(result.problems.some((p) => p.includes("QB-LONG-99")));
  });

  test("an invalid pack is BLOCKED with the validator's own problem codes", () => {
    const pack = { ...buildValidPack(), packDigest: `sha256:${"0".repeat(64)}` };
    const result = resolveQuestionPackDependency({ pack, expectedDigest: computePackDigest(pack) });
    assert.equal(result.ok, false);
    assert.equal(result.reason, QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID);
    assert.ok(result.problems.some((p) => p.includes("E_DIGEST")));
  });

  test("the guard never lowers the chain count or chain length floor", () => {
    const tooFew = buildPack([
      buildPackChain("QB-LONG-01", { identity: "read_only" }),
      buildPackChain("QB-LONG-02", { identity: "lucy_admin" })
    ]);
    const relaxed = resolveQuestionPackDependency({
      pack: tooFew,
      expectedDigest: tooFew.packDigest,
      minChains: 1,
      minTurns: 1
    });
    assert.equal(relaxed.ok, false);
    assert.equal(relaxed.reason, QUESTION_PACK_BLOCKED_REASONS.CHAIN_COUNT_INSUFFICIENT);
  });

  test("the guard is read-only: it never rewrites the pack it reads", () => {
    const pack = buildValidPack();
    const snapshot = JSON.stringify(pack);
    resolveQuestionPackDependency({
      pack,
      expectedDigest: pack.packDigest,
      requiredChainIds: ["QB-LONG-01"]
    });
    assert.equal(JSON.stringify(pack), snapshot);
  });

  test("the guard drives the LONG_FOLLOW judgment entry to BLOCKED, not FAIL and not PASS", () => {
    const blocked = resolveQuestionPackDependency({
      packPath: "scripts/e2e/contracts/mcp-inquiry-long-followups.absent.yaml",
      expectedDigest: "sha256:whatever"
    });
    const judgement = judgeLongFollowScenario({
      chains: [],
      plannedChainCount: 50,
      expectedPackDigest: "sha256:whatever",
      questionPack: blocked
    });
    assert.equal(judgement.verdict, "BLOCKED");
    assert.notEqual(judgement.verdict, "FAIL");
    assert.notEqual(judgement.verdict, "PASS");
    assert.equal(judgement.blockedReason, QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING);
  });

  test("the total verdict stays BLOCKED when the question pack is unavailable", () => {
    const blocked = resolveQuestionPackDependency({
      packPath: "scripts/e2e/contracts/mcp-inquiry-long-followups.absent.yaml",
      expectedDigest: "sha256:whatever"
    });
    const total = aggregatePerformance({
      tier: "formal",
      groups: [mcpGroup({ attempts: Array.from({ length: 100 }, (_unused, i) => mcpAttempt({ attemptId: `m${i}` })) })],
      longFollow: { chains: [], plannedChainCount: 50, expectedPackDigest: "sha256:whatever", questionPack: blocked }
    });
    assert.equal(total.status, "BLOCKED");
    assert.equal(total.releaseReady, false);
    assert.equal(total.longFollow.verdict, "BLOCKED");
  });

  test("a usable pack leaves the chain judgment to the chain rules", () => {
    const pack = buildValidPack();
    const dependency = resolveQuestionPackDependency({ pack, expectedDigest: pack.packDigest });
    assert.equal(dependency.status, "OK");
    const judgement = judgeLongFollowScenario({
      chains: [],
      plannedChainCount: 50,
      expectedPackDigest: pack.packDigest,
      questionPack: dependency
    });
    // No chains were produced: the ratio requirement fails — but the guard is
    // not the reason, the chain inventory is.
    assert.equal(judgement.verdict, "FAIL");
    assert.ok(judgement.reasons.some((r) => /valid long-follow chains 0 < required 5/.test(r)));
  });
});

describe("validateWaiver (Spec D22)", () => {
  test("a valid waiver yields releaseReady=waived, never PASS", () => {
    const r = validateWaiver(waiver(), WAIVER_CONTEXT);
    assert.equal(r.valid, true);
    assert.equal(r.releaseReady, "waived");
  });

  test("expired waiver is rejected", () => {
    const r = validateWaiver(waiver(), { ...WAIVER_CONTEXT, now: Date.parse("2026-12-01T00:00:00Z") });
    assert.equal(r.valid, false);
    assert.ok(r.problems.some((x) => /expired/.test(x)));
  });

  test("waiver validity span beyond 7 days is rejected", () => {
    const r = validateWaiver(waiver({ expiresAt: "2026-12-05T00:00:00Z" }), WAIVER_CONTEXT);
    assert.equal(r.valid, false);
    assert.ok(r.problems.some((x) => /7 days/.test(x)));
  });

  test("candidate digest mismatch is rejected", () => {
    const r = validateWaiver(waiver({ candidateDigest: "sha256:other" }), WAIVER_CONTEXT);
    assert.equal(r.valid, false);
    assert.ok(r.problems.some((x) => /candidateDigest/.test(x)));
  });

  test("scope beyond the eligible non-PASS scenarios is rejected", () => {
    const r = validateWaiver(waiver({ scenarios: [{ scenarioId: "SIMPLE_WARM", verdict: "BLOCKED" }] }), WAIVER_CONTEXT);
    assert.equal(r.valid, false);
    assert.ok(r.problems.some((x) => /scope|eligible/.test(x)));
  });

  test("waiver verdict must match the run verdict for the scenario", () => {
    const r = validateWaiver(waiver({ scenarios: [{ scenarioId: "SOAK", verdict: "SEED_ONLY" }] }), WAIVER_CONTEXT);
    assert.equal(r.valid, false);
    assert.ok(r.problems.some((x) => /does not match/.test(x)));
  });

  test("FAIL without a per-scenario measured list is rejected; with list + named approval it is waivable", () => {
    const ctx = { ...WAIVER_CONTEXT, eligibleScenarioIds: ["SIMPLE_WARM"], verdicts: { SIMPLE_WARM: "FAIL" } };
    const noList = validateWaiver(waiver({ scenarios: [{ scenarioId: "SIMPLE_WARM", verdict: "FAIL" }] }), ctx);
    assert.equal(noList.valid, false);
    assert.ok(noList.problems.some((x) => /measured/.test(x)));

    const withList = validateWaiver(
      waiver({
        scenarios: [{ scenarioId: "SIMPLE_WARM", verdict: "FAIL", measured: { p95Ms: 12_000, budgetP95Ms: 10_000, baselineP95Ms: 9_000 } }],
        failListApprovedBy: "委托人"
      }),
      ctx
    );
    assert.equal(withList.valid, true);
    assert.equal(withList.releaseReady, "waived");
  });

  test("missing required fields are rejected", () => {
    for (const field of ["candidateDigest", "reason", "expiresAt", "makeupPlan", "approvedBy"]) {
      const w = waiver({ [field]: null });
      const r = validateWaiver(w, WAIVER_CONTEXT);
      assert.equal(r.valid, false, field);
    }
    assert.equal(validateWaiver(waiver({ scenarios: [] }), WAIVER_CONTEXT).valid, false);
  });
});

// ---------------------------------------------------------------------------
// aggregatePerformance total verdict (Spec §6.3)
// ---------------------------------------------------------------------------

describe("aggregatePerformance (Spec §6.3 total verdict + releaseReady)", () => {
  test("all groups PASS with accepted baselines => PASS and releaseReady=true", () => {
    const agg = aggregatePerformance({
      tier: "pr",
      groups: [mcpGroup({ attempts: times(20, 0).map(() => mcpAttempt()), baseline: goodBaseline() })]
    });
    assert.equal(agg.status, "PASS");
    assert.equal(agg.releaseReady, true);
    assert.equal(agg.baselineEligible, true);
  });

  test("without a waiver, BLOCKED and SEED_ONLY fail closed (releaseReady=false)", () => {
    const blocked = aggregatePerformance({
      tier: "pr",
      groups: [mcpGroup({ attempts: times(5, 0).map(() => mcpAttempt()), baseline: goodBaseline() })]
    });
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.releaseReady, false);

    const seedOnly = aggregatePerformance({
      tier: "pr",
      groups: [mcpGroup({ attempts: times(20, 0).map(() => mcpAttempt()) })]
    });
    assert.equal(seedOnly.status, "SEED_ONLY");
    assert.equal(seedOnly.releaseReady, false);
    assert.equal(seedOnly.baselineEligible, false);
  });

  test("a valid waiver turns BLOCKED into releaseReady=waived without becoming PASS", () => {
    const groups = [
      mcpGroup({ scenarioId: "SOAK", attempts: times(5, 0).map(() => mcpAttempt({ scenarioId: "SOAK" })), baseline: goodBaseline({ scenarioId: "SOAK" }) })
    ];
    const noWaiver = aggregatePerformance({ tier: "pr", groups, candidateDigest: "sha256:candidate", now: WAIVER_CONTEXT.now });
    assert.equal(noWaiver.status, "BLOCKED");
    assert.equal(noWaiver.releaseReady, false);

    const withWaiver = aggregatePerformance({
      tier: "pr",
      groups,
      candidateDigest: "sha256:candidate",
      now: WAIVER_CONTEXT.now,
      waivers: [waiver()]
    });
    assert.equal(withWaiver.status, "BLOCKED"); // verdict unchanged
    assert.equal(withWaiver.releaseReady, "waived");
    assert.equal(withWaiver.baselineEligible, false); // waived never writes baselines
  });

  test("an invalid waiver does not rescue a blocked run", () => {
    const groups = [
      mcpGroup({ scenarioId: "SOAK", attempts: times(5, 0).map(() => mcpAttempt({ scenarioId: "SOAK" })), baseline: goodBaseline({ scenarioId: "SOAK" }) })
    ];
    const agg = aggregatePerformance({
      tier: "pr",
      groups,
      candidateDigest: "sha256:candidate",
      now: Date.parse("2026-12-02T00:00:00Z"), // waiver expired by then
      waivers: [waiver()]
    });
    assert.equal(agg.releaseReady, false);
  });

  test("a waiver that does not cover every non-PASS scenario leaves releaseReady=false", () => {
    const groups = [
      mcpGroup({ scenarioId: "SOAK", attempts: times(5, 0).map(() => mcpAttempt({ scenarioId: "SOAK" })), baseline: goodBaseline({ scenarioId: "SOAK" }) }),
      mcpGroup({ scenarioId: "JOIN_WARM", attempts: times(5, 0).map(() => mcpAttempt({ scenarioId: "JOIN_WARM" })), baseline: goodBaseline({ scenarioId: "JOIN_WARM" }) })
    ];
    const agg = aggregatePerformance({
      tier: "pr",
      groups,
      candidateDigest: "sha256:candidate",
      now: WAIVER_CONTEXT.now,
      waivers: [waiver()] // covers only SOAK
    });
    assert.equal(agg.releaseReady, false);
  });

  test("SOAK with unreachable samples is BLOCKED sample_unreachable", () => {
    const agg = aggregatePerformance({
      tier: "formal",
      groups: [],
      soak: soakInput({ identities: 10 })
    });
    assert.equal(agg.status, "BLOCKED");
    assert.ok(agg.reasons.some((x) => /sample_unreachable/.test(x)));
  });

  test("SOAK with a shortened effective window is BLOCKED", () => {
    const agg = aggregatePerformance({
      tier: "formal",
      groups: [],
      soak: soakInput({ windowPlan: { count: 4, seconds: 150 }, longChainIdentities: 0 })
    });
    assert.equal(agg.status, "BLOCKED");
    assert.ok(agg.reasons.some((x) => /1800/.test(x)));
  });

  test("SOAK below 50 identities is BLOCKED", () => {
    const agg = aggregatePerformance({
      tier: "formal",
      groups: [],
      soak: soakInput({ identities: Array.from({ length: 49 }, (_, i) => `id-${i}`) })
    });
    assert.equal(agg.status, "BLOCKED");
    assert.ok(agg.reasons.some((x) => /50/.test(x)));
  });

  test("a healthy SOAK passes window judgment", () => {
    const agg = aggregatePerformance({ tier: "formal", groups: [], soak: soakInput() });
    assert.equal(agg.status, "PASS");
    assert.equal(agg.soak.verdict, "PASS");
  });
});

// ---------------------------------------------------------------------------
// contract YAML lint
// ---------------------------------------------------------------------------

describe("contract mcp-inquiry-performance.yaml (Plan Task 1 step 1)", () => {
  const contract = parse(readFileSync(CONTRACT_PATH, "utf8"));
  const bank = parse(readFileSync(QUESTION_BANK_PATH, "utf8"));
  const bankIds = new Set((bank.cases ?? []).map((c) => c.id));
  const scenarios = contract.scenarios ?? [];

  function asList(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  function* walkStrings(node, trail = []) {
    if (typeof node === "string") {
      yield { trail, value: node };
    } else if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) yield* walkStrings(node[i], [...trail, i]);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) yield* walkStrings(v, [...trail, k]);
    }
  }

  function* walkKeys(node, trail = []) {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) yield* walkKeys(node[i], [...trail, i]);
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        yield { trail, key: k };
        yield* walkKeys(v, [...trail, k]);
      }
    }
  }

  test("schemaVersion and scenario list exist; every scenario has the required fields", () => {
    assert.ok(contract.schemaVersion != null);
    assert.ok(Array.isArray(scenarios) && scenarios.length > 0);
    for (const s of scenarios) {
      for (const field of ["scenarioId", "questionRef", "lane", "budgetClass", "cacheState", "concurrencyGroup", "sampleFloors", "oracleRef"]) {
        assert.ok(Object.hasOwn(s, field), `${s.scenarioId} missing ${field}`);
      }
      assert.deepEqual(s.sampleFloors, { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } }, s.scenarioId);
    }
    const ids = scenarios.map((s) => s.scenarioId);
    assert.equal(new Set(ids).size, ids.length, "duplicate scenarioId");
  });

  test("no question text, oracle payload or answer expectation fields (no second question bank)", () => {
    const forbiddenKeys = new Set([
      "turns", "text", "title", "oracle", "expect", "expects", "question", "questionText",
      "answer", "answers", "prompt", "naturalLanguage", "naturalLanguageQuestion", "sql"
    ]);
    for (const { trail, key } of walkKeys(contract)) {
      assert.ok(!forbiddenKeys.has(key), `forbidden field "${key}" at ${trail.join(".")}`);
    }
    for (const { trail, value } of walkStrings(contract)) {
      assert.ok(!/[一-鿿]/.test(value), `CJK (question-text-like) string at ${trail.join(".")}: ${value}`);
      assert.ok(!/[？?]/.test(value), `question mark in string at ${trail.join(".")}`);
    }
  });

  test("every questionRef exists in the P1-54 question bank (QB-LONG-* excepted)", () => {
    const longRefs = [];
    for (const s of scenarios) {
      const refs = asList(s.questionRef);
      assert.ok(refs.length > 0, `${s.scenarioId} has empty questionRef`);
      for (const ref of refs) {
        if (/^QB-LONG-\d+$/.test(ref)) {
          longRefs.push({ scenario: s, ref });
          assert.equal(s.family, "long-follow", `${ref} referenced outside LONG_FOLLOW`);
        } else {
          assert.ok(bankIds.has(ref), `${s.scenarioId} references unknown question ${ref}`);
        }
      }
    }
    assert.ok(longRefs.length > 0, "LONG_FOLLOW scenarios must reference QB-LONG-* template ids");
  });

  test("LONG_FOLLOW scenarios freeze the pack digest of the P1-79 question pack", () => {
    const longScenarios = scenarios.filter((s) => s.family === "long-follow");
    assert.ok(longScenarios.length > 0);
    for (const s of longScenarios) {
      assert.match(s.packDigest, /^sha256:[0-9a-f]{64}$/, `${s.scenarioId} must freeze the pack digest`);
      assert.equal(s.packDigest, contract.longFollowUpPackRef.packDigest);
      // The pack has landed, so the scenario is no longer statically blocked;
      // whether it may run is decided by the consumer-side guard at runtime.
      assert.equal(s.blocked, undefined, `${s.scenarioId} must not stay statically blocked`);
      assert.ok(asList(s.questionRef).every((r) => /^QB-LONG-\d+$/.test(r)));
    }
  });

  test("ownerBudgetClass maps to the declared budgetClass via Spec §4.1.1", () => {
    for (const s of scenarios) {
      if (s.budgetClass === "per-turn") {
        for (const owner of asList(s.ownerBudgetClass)) {
          assert.equal(mapOwnerBudgetClass(owner).ok, true, `${s.scenarioId} owner ${owner}`);
        }
        continue;
      }
      const mapped = mapOwnerBudgetClass(s.ownerBudgetClass);
      assert.equal(mapped.ok, true, `${s.scenarioId} owner ${s.ownerBudgetClass}`);
      assert.equal(mapped.budgetClass, s.budgetClass, `${s.scenarioId} mapping mismatch`);
    }
  });

  test("denial scenarios run the MCP lane and name an existing legal control", () => {
    const denials = scenarios.filter((s) => s.budgetClass === "denial");
    assert.ok(denials.length > 0);
    for (const s of denials) {
      assert.equal(s.lane, "mcp", s.scenarioId);
      assert.ok(s.legalControlRef, `${s.scenarioId} missing legalControlRef`);
      assert.ok(bankIds.has(s.legalControlRef), `${s.scenarioId} legalControlRef ${s.legalControlRef} not in bank`);
    }
  });

  test("all Spec §4.1 scenario families are covered", () => {
    const families = new Set(scenarios.map((s) => s.family));
    for (const required of [
      "simple-single-table", "filter-time", "follow-up", "multi-table-join", "multi-db",
      "denial-with-legal-control", "cold-start", "wide-catalog", "concurrent-fairness", "soak", "long-follow"
    ]) {
      assert.ok(families.has(required), `missing family ${required}`);
    }
  });

  test("SOAK references the arrival model instead of copying its parameters", () => {
    const soak = scenarios.find((s) => s.family === "soak");
    assert.ok(soak);
    assert.ok(soak.arrivalModelRef, "SOAK must reference scale-baseline §1.1");
    for (const key of ["muSeconds", "sigmaSeconds", "clipMinSeconds", "clipMaxSeconds", "seed", "classShare", "arrivalModel"]) {
      assert.ok(!Object.hasOwn(soak, key), `SOAK must not copy arrival parameter ${key}`);
    }
    assert.equal(soak.identityCount, 50);
    assert.ok(soak.windows?.count * soak.windows?.seconds >= 1800);
  });

  test("oracleRef values are reference identifiers, not oracle payloads", () => {
    for (const s of scenarios) {
      for (const ref of asList(s.oracleRef)) {
        assert.match(ref, /^[a-z][a-z0-9-]*:\S+$/, `${s.scenarioId} oracleRef ${ref}`);
      }
    }
  });
});
