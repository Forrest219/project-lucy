/**
 * P1-78 Task 4 — real Agent journey lane + 20/50-lane concurrency plan.
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D2/D3/D5/D6/D9/D14/D19/D21, §4.2, §4.3, §5.2, §5.3)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 4
 *
 * TDD: these tests were written against ../lib/mcp-inquiry-performance-agent.mjs
 * and drive it with an INJECTED fake adapter and a MANUAL clock only.
 * No live host, no network, no Docker, no product code.
 * The real host execution path is wired in the module but runs in Task 5/7.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { validateAttempt } from "../lib/mcp-inquiry-performance-evidence.mjs";
import {
  aggregatePerformance,
  checkAttemptOutcomes,
  classifyProviderErrors,
  judgeAbsolute
} from "../lib/mcp-inquiry-performance.mjs";
import {
  DEFAULT_AGENT_SAMPLES,
  FAIRNESS_LIMIT,
  FIRST_OBSERVABLE_COARSE,
  FIRST_OBSERVABLE_OBSERVED,
  FIRST_TOKEN_NOT_AVAILABLE,
  HARNESS_VERSION,
  OBSERVATION_OVERHEAD_LIMIT,
  buildConcurrentPlan,
  compareObservationOverhead,
  computeTurnMilestones,
  createExactOracleChecker,
  createExactResultOracleChecker,
  executeConcurrentPlan,
  judgeRoleFairness,
  measureInFlightPeak,
  planScenarioAttempts,
  resolveScenarioCase,
  runAgentPerformanceJourneys,
  summarizeConcurrency
} from "../lib/mcp-inquiry-performance-agent.mjs";

// ---------------------------------------------------------------------------
// fakes
// ---------------------------------------------------------------------------

const tmpRoots = [];
after(() => {
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function tmpWorkDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-mcp-perf-agent-"));
  tmpRoots.push(dir);
  return dir;
}

function manualClock(start = 0) {
  return {
    t: start,
    now() {
      return this.t;
    },
    advance(ms) {
      this.t += ms;
      return this.t;
    }
  };
}

function fakeAdapter({ multiTurn = true } = {}) {
  return {
    product: "fake-agent",
    transport: "cli",
    credentialEnv: [],
    supportsContinuation: multiTurn,
    probe() {
      return {
        status: "ready",
        reasons: [],
        binaryPath: "/tmp/fake-agent",
        version: "1.2.3",
        model: "fake-model-1"
      };
    },
    prepare({ workDir }) {
      return { env: {}, files: [], workDir };
    },
    buildInvocation({ question }) {
      return { command: "/tmp/fake-agent", args: [question], cwd: "/tmp", env: {} };
    },
    parseResult() {
      return { finalAnswer: "ok", model: "fake-model-1", sessionId: "sess-1", ok: true };
    }
  };
}

function readyDetection({ multiTurn = true, model = "fake-model-1" } = {}) {
  const mod = fakeAdapter({ multiTurn });
  const probe = mod.probe();
  const candidate = { id: "fake-cli", detect: "true", adapter: "fake/adapter.mjs", multiTurn };
  return {
    version: 1,
    candidates: [],
    ready: [
      {
        id: "fake-cli",
        candidate,
        status: "ready",
        reasons: [],
        reselect: false,
        detect: { ok: true, detail: "ok" },
        probe,
        adapter: { mod, file: "fake/adapter.mjs", digest: "sha256:fake" },
        clientFingerprint: `client:fake-cli|adapter:fake/adapter.mjs|version:${probe.version}`,
        modelFingerprint: `model:${model}`,
        authHint: "test"
      }
    ]
  };
}

/** One scripted turn for the fake runTurn. */
function turnScript(over = {}) {
  return {
    latencyMs: 1_000,
    events: null, // null → default [content@latency, final@latency]
    finalAnswer: "订单数是 1000，销售总额是 1459476.0953 元。",
    sessionId: "sess-1",
    model: "fake-model-1",
    ok: true,
    timedOut: false,
    exitCode: 0,
    providerReceipt: null,
    ...over
  };
}

/**
 * Fake runTurn: consumes one script per turn (the last one repeats), advances
 * the manual clock by the scripted latency and materializes the host events
 * at absolute clock times.
 */
function fakeRunTurn(clock, scripts) {
  const queue = [...scripts];
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    const script = queue.length > 1 ? queue.shift() : queue[0];
    const start = clock.now();
    const events = (script.events ?? [
      { offsetMs: script.latencyMs, type: "content", text: script.finalAnswer },
      { offsetMs: script.latencyMs, type: "final", text: script.finalAnswer }
    ]).map((event) => {
      const { offsetMs = 0, ...rest } = event;
      return { ...rest, atMs: start + offsetMs };
    });
    clock.advance(script.latencyMs);
    const end = clock.now();
    return {
      ok: script.ok,
      finalAnswer: script.finalAnswer,
      sessionId: script.sessionId,
      model: script.model,
      exitCode: script.exitCode,
      timedOut: script.timedOut,
      events,
      finalAnswerAt: script.noAnswerTimestamp ? null : script.finalAnswer ? end : null,
      providerReceipt: script.providerReceipt,
      processId: 4242
    };
  };
  fn.calls = calls;
  return fn;
}

function questionBank() {
  return {
    kind: "mcp-upgrade-question-bank",
    questionBankId: "lucy-mcp-upgrade-question-bank",
    version: 1,
    cases: [
      {
        id: "QB-BIZ-01",
        turns: [{ text: "查询 superstore_orders 的订单数和销售总额。" }],
        agentRequirements: { publicMcp: true, sameSession: false },
        identities: [{ id: "allow_readonly", role: "demo_readonly" }],
        oracle: {
          kind: "exact",
          ref: "baseline:demo-mysql.superstore_orders.gold",
          expect: { order_count: 1000, total_sales: 1459476.0953 }
        },
        budgetClass: "simple-metric"
      },
      {
        id: "QB-FOLLOW-01",
        turns: [{ text: "查询 2025 年 11 月订单销售额" }, { text: "那 12 月呢？" }],
        agentRequirements: { publicMcp: true, sameSession: true },
        identities: [{ id: "allow_readonly", role: "demo_readonly" }],
        oracle: {
          kind: "independent-query",
          ref: "sql:demo-mysql.superstore_orders.sales_2025_11_12_mom",
          expect: { sameSession: true }
        },
        budgetClass: "follow-up"
      }
    ]
  };
}

function contractDoc(scenarios) {
  return { kind: "mcp-inquiry-performance-contract", schemaVersion: 1, scenarios };
}

function simpleScenario(over = {}) {
  return {
    scenarioId: "SIMPLE_WARM",
    family: "simple-single-table",
    questionRef: "QB-BIZ-01",
    lane: "agent+mcp",
    budgetClass: "simple",
    ownerBudgetClass: "simple-metric",
    cacheState: "warm",
    concurrencyGroup: "single",
    sampleFloors: { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } },
    oracleRef: "baseline:demo-mysql.superstore_orders.gold",
    ...over
  };
}

function followScenario(over = {}) {
  return {
    scenarioId: "FOLLOW_WARM",
    family: "follow-up",
    questionRef: "QB-FOLLOW-01",
    lane: "agent+mcp",
    budgetClass: "simple",
    ownerBudgetClass: "follow-up",
    cacheState: "warm",
    concurrencyGroup: "single",
    sameSession: true,
    sampleFloors: { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } },
    oracleRef: "sql:demo-mysql.superstore_orders.sales_2025_11_12_mom",
    ...over
  };
}

function concurrentScenario(over = {}) {
  return {
    scenarioId: "CONCURRENT_C20_SIMPLE",
    family: "concurrent-fairness",
    questionRef: "QB-BIZ-01",
    lane: "agent+mcp",
    budgetClass: "simple",
    ownerBudgetClass: "simple-metric",
    cacheState: "warm",
    concurrencyGroup: "c20",
    roleFairness: true,
    waves: 2,
    sampleFloors: { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } },
    oracleRef: "baseline:demo-mysql.superstore_orders.gold",
    ...over
  };
}

function baseOptions(clock, scripts, over = {}) {
  return {
    contract: contractDoc([simpleScenario()]),
    questionBank: questionBank(),
    selectedClientId: "fake-cli",
    runId: "run-test-1",
    environment: "docker-local",
    environmentFingerprint: "env-fp-1",
    digests: {
      questionSetDigest: "qs-digest",
      configDigest: "cfg-digest",
      fixtureDigest: "fx-digest",
      budgetDigest: "bg-digest"
    },
    token: "test-token",
    workDir: tmpWorkDir(),
    samplesPerScenario: 3,
    deps: {
      detection: readyDetection(),
      now: () => clock.now(),
      utcNow: () => "2026-11-26T00:00:00.000Z",
      runTurn: fakeRunTurn(clock, scripts),
      auditLookup: () => ({ reconciled: true, failedCallsThisTurn: 0 })
    },
    ...over
  };
}

// ---------------------------------------------------------------------------
// §4.2 milestone math
// ---------------------------------------------------------------------------

describe("computeTurnMilestones (Spec §4.2)", () => {
  test("tool + content events give an observed first response and a real first token", () => {
    const m = computeTurnMilestones({
      questionStartedAt: 1_000,
      events: [
        { atMs: 1_100, type: "session" },
        { atMs: 1_200, type: "keepalive" },
        { atMs: 1_300, type: "tool", name: "lucy_query" },
        { atMs: 1_500, type: "content", text: "订" },
        { atMs: 1_900, type: "final", text: "订单数 1000" }
      ],
      finalAnswerAt: 1_900,
      turnEndedAt: 2_000
    });
    assert.equal(m.firstObservableMs, 300);
    assert.equal(m.firstObservableQuality, FIRST_OBSERVABLE_OBSERVED);
    assert.equal(m.firstObservableKind, "tool");
    assert.equal(m.firstTokenMs, 500);
    assert.equal(m.finalAnswerMs, 900);
    assert.equal(m.turnWallClockMs, 1_000);
  });

  test("first token is never fabricated from initialize/session or tool events", () => {
    const m = computeTurnMilestones({
      questionStartedAt: 0,
      events: [
        { atMs: 10, type: "session" },
        { atMs: 20, type: "tool", name: "lucy_query" },
        { atMs: 30, type: "tool_result", name: "lucy_query" },
        { atMs: 40, type: "final", text: "答案" }
      ],
      finalAnswerAt: 40,
      turnEndedAt: 40
    });
    assert.equal(m.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
    assert.notEqual(m.firstTokenMs, 10);
    assert.notEqual(m.firstTokenMs, 20);
  });

  test("host exposing only the final answer is coarse and equals the final answer", () => {
    const m = computeTurnMilestones({
      questionStartedAt: 5_000,
      events: [{ atMs: 8_000, type: "final", text: "答案" }],
      finalAnswerAt: 8_000,
      turnEndedAt: 8_100
    });
    assert.equal(m.firstObservableMs, 3_000);
    assert.equal(m.firstObservableQuality, FIRST_OBSERVABLE_COARSE);
    assert.equal(m.firstObservableMs, m.finalAnswerMs);
    assert.equal(m.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
  });

  test("adapter without any streaming events falls back to the coarse final answer", () => {
    const m = computeTurnMilestones({
      questionStartedAt: 0,
      events: [],
      finalAnswerAt: 2_500,
      turnEndedAt: 2_600
    });
    assert.equal(m.firstObservableMs, 2_500);
    assert.equal(m.firstObservableQuality, FIRST_OBSERVABLE_COARSE);
    assert.equal(m.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
  });

  test("turn without a final answer keeps the wall clock and reports no final answer", () => {
    const m = computeTurnMilestones({
      questionStartedAt: 0,
      events: [{ atMs: 100, type: "tool" }],
      finalAnswerAt: null,
      turnEndedAt: 700
    });
    assert.equal(m.finalAnswerMs, null);
    assert.equal(m.turnWallClockMs, 700);
    assert.equal(m.firstObservableMs, 100);
  });

  test("unobservable milestones are the literal not_available, never 0 (D14)", () => {
    const m = computeTurnMilestones({ questionStartedAt: null, events: [], finalAnswerAt: null, turnEndedAt: null });
    assert.equal(m.firstObservableMs, "not_available");
    assert.equal(m.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
    assert.equal(m.unattributedMs, "not_available");
  });
});

// ---------------------------------------------------------------------------
// oracle validity guardrail (D3)
// ---------------------------------------------------------------------------

describe("P1-54 oracle validity checker", () => {
  const testCase = questionBank().cases[0];

  test("exact oracle passes when every expected value appears in the final answer", () => {
    const check = createExactOracleChecker();
    const r = check({
      testCase,
      turnIndex: 0,
      finalAnswer: "订单数为 1,000，销售总额 1459476.0953 元。",
      toolResults: []
    });
    assert.equal(r.verdict, "correct");
  });

  test("exact oracle accepts 万-scaled statements of the gold value", () => {
    const check = createExactOracleChecker();
    const r = check({
      testCase,
      turnIndex: 0,
      finalAnswer: "订单数 1000，销售总额约 145.94760953 万元。",
      toolResults: []
    });
    assert.equal(r.verdict, "correct");
  });

  test("wrong answer is wrong, not unknown and not correct", () => {
    const check = createExactOracleChecker();
    const r = check({ testCase, turnIndex: 0, finalAnswer: "订单数是 999，总额 1 元。", toolResults: [] });
    assert.equal(r.verdict, "wrong");
  });

  test("unsupported oracle kinds are unknown (never guessed)", () => {
    const check = createExactOracleChecker();
    const r = check({ testCase: questionBank().cases[1], turnIndex: 0, finalAnswer: "随便什么", toolResults: [] });
    assert.equal(r.verdict, "unknown");
  });

  test("empty final answer is wrong even when the tool result carries the gold values", () => {
    const check = createExactOracleChecker();
    const r = check({
      testCase,
      turnIndex: 0,
      finalAnswer: "",
      toolResults: [{ rows: [{ order_count: 1000 }] }]
    });
    assert.equal(r.verdict, "wrong");
  });

  test("result oracle matches tool payloads containing every expected value", () => {
    const check = createExactResultOracleChecker();
    assert.equal(
      check({ testCase, toolResult: { rows: [{ order_count: 1000, total_sales: 1459476.0953 }] } }),
      true
    );
    assert.equal(check({ testCase, toolResult: { rows: [{ order_count: 1000, total_sales: 5 }] } }), false);
    assert.equal(check({ testCase: questionBank().cases[1], toolResult: { rows: [] } }), null);
  });
});

// ---------------------------------------------------------------------------
// attempt planning (D6) and question resolution (D17)
// ---------------------------------------------------------------------------

describe("planScenarioAttempts (D6)", () => {
  test("formal agent floor plans >= 20 attempts per scenario by default", () => {
    const plan = planScenarioAttempts({ scenario: simpleScenario() });
    assert.equal(plan.plannedCount, 20);
    assert.equal(plan.planItemIds.length, 20);
    assert.equal(DEFAULT_AGENT_SAMPLES, 20);
  });

  test("explicit samples override but never below 1", () => {
    assert.equal(planScenarioAttempts({ scenario: simpleScenario(), samples: 50 }).plannedCount, 50);
    assert.equal(planScenarioAttempts({ scenario: simpleScenario(), samples: 0 }).plannedCount, 20);
  });
});

describe("resolveScenarioCase", () => {
  test("resolves questionRef to the bank case; missing ref is null (BLOCKED upstream, D17)", () => {
    const bank = questionBank();
    assert.equal(resolveScenarioCase(simpleScenario(), bank)?.id, "QB-BIZ-01");
    assert.equal(resolveScenarioCase(simpleScenario({ questionRef: "QB-NOPE" }), bank), null);
  });
});

// ---------------------------------------------------------------------------
// runAgentPerformanceJourneys — happy path + milestones
// ---------------------------------------------------------------------------

describe("runAgentPerformanceJourneys", () => {
  test("clean run: milestones, oracle, judge input and SEED_ONLY relative gate", async () => {
    const clock = manualClock(10_000);
    const options = baseOptions(clock, [turnScript({ latencyMs: 1_200 })], { samplesPerScenario: 20 });
    const result = await runAgentPerformanceJourneys(options);

    assert.equal(result.status, "PASS", result.reasons.join("; "));
    assert.equal(result.attempts.length, 20);
    assert.equal(result.disclosure.rerunCount, 0);
    assert.equal(result.disclosure.providerErrorCount, 0);
    assert.equal(result.disclosure.retryCount, 0);

    const a = result.attempts[0];
    assert.equal(a.lane, "agent");
    assert.equal(a.runId, "run-test-1");
    assert.equal(a.scenarioId, "SIMPLE_WARM");
    assert.equal(a.caseId, "QB-BIZ-01");
    assert.ok(a.attemptId && a.planItemId);
    assert.equal(a.questionStartedAt, 10_000);
    assert.equal(a.questionStartedAtUtc, "2026-11-26T00:00:00.000Z");
    assert.equal(a.firstObservableMs, 1_200);
    assert.equal(a.firstTokenMs, 1_200);
    assert.equal(a.finalAnswerMs, 1_200);
    assert.equal(a.finalCorrectAnswerMs, 1_200);
    assert.equal(a.turnWallClockMs, 1_200);
    assert.equal(a.outcome, "correct");
    assert.equal(a.correctness, "correct");
    assert.equal(a.finalAnswerReceived, true);
    assert.equal(a.firstAttempt, true);
    assert.equal(a.finalAttempt, true);
    assert.equal(a.firstAttemptId, a.attemptId);
    assert.equal(a.finalAttemptId, a.attemptId);
    assert.equal(a.harnessVersion, HARNESS_VERSION);
    assert.equal(a.observation, "detailed");

    // judge consumes the same attempts without relabeling anything
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "OK");
    const abs = judgeAbsolute({
      lane: "agent",
      tier: "formal",
      budgetClass: "simple",
      cacheState: "warm",
      latencies: result.attempts.map((x) => x.finalCorrectAnswerMs),
      turns: result.attempts,
      firstTokenSamples: result.scenarios[0].firstTokenSamples
    });
    assert.equal(abs.verdict, "PASS", abs.reasons.join("; "));

    const total = aggregatePerformance({ tier: "formal", groups: result.judgeInput.groups });
    assert.equal(total.perScenario.SIMPLE_WARM.verdict, "PASS");
    assert.equal(total.status, "SEED_ONLY"); // no accepted baseline yet
  });

  test("first token not_available is reported, never replaced (D4/§5.2)", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({
        latencyMs: 800,
        events: [
          { offsetMs: 100, type: "session" },
          { offsetMs: 200, type: "tool", name: "lucy_query" },
          {
            offsetMs: 700,
            type: "tool_result",
            name: "lucy_query",
            result: { rows: [{ order_count: 1000, total_sales: 1459476.0953 }] }
          },
          { offsetMs: 800, type: "final", text: "订单数 1000，总额 1459476.0953 元" }
        ]
      })
    ];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts));
    const a = result.attempts[0];
    assert.equal(a.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
    assert.equal(a.firstObservableMs, 200);
    assert.equal(a.firstObservableQuality, FIRST_OBSERVABLE_OBSERVED);
    assert.deepEqual(result.scenarios[0].firstTokenSamples, FIRST_TOKEN_NOT_AVAILABLE);
    assert.equal(a.firstCorrectResultMs, 700);
  });

  test("tool-result-only turn (no final answer) is retained, invalid, and fails the judge (D3)", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({
        latencyMs: 500,
        finalAnswer: "",
        ok: false,
        exitCode: 1,
        events: [
          { offsetMs: 100, type: "tool", name: "lucy_query" },
          {
            offsetMs: 400,
            type: "tool_result",
            name: "lucy_query",
            result: { rows: [{ order_count: 1000, total_sales: 1459476.0953 }] }
          }
        ]
      })
    ];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts));
    assert.equal(result.attempts.length, 3);
    const a = result.attempts[0];
    assert.equal(a.finalAnswerReceived, false);
    assert.equal(a.outcome, "error");
    assert.equal(a.errorClass, "no_final_answer");
    assert.equal(a.finalCorrectAnswerMs, "not_available");
    assert.equal(a.firstCorrectResultMs, 400); // low-latency tool call is still recorded...
    assert.equal(a.toolTrace.length, 2); // ...and the full trace is retained
    const corr = checkAttemptOutcomes(result.attempts, { lane: "agent" });
    assert.equal(corr.verdict, "FAIL");
    assert.ok(corr.failReasons.some((r) => r.includes("missing final answer")));
  });

  test("wrong answer is retained in the denominator and classified Lucy-side (D3/D21④)", async () => {
    const clock = manualClock(0);
    const scripts = [turnScript({ finalAnswer: "订单数是 42。", latencyMs: 300 })];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts));
    const a = result.attempts[0];
    assert.equal(a.outcome, "wrong_answer");
    assert.equal(a.correctness, "incorrect");
    assert.equal(a.finalAnswerReceived, true);
    assert.equal(a.finalAnswerMs, 300); // latency kept for the denominator
    assert.equal(a.finalCorrectAnswerMs, "not_available");
    assert.equal(result.scenarios[0].failedCount, 3);
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.attempts[0].classification, "lucy_error");
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "FAIL");
  });

  test("same-session follow-ups keep one session; every turn gets its own wall clock", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({ latencyMs: 1_000, finalAnswer: "11 月销售额 100 元" }),
      turnScript({ latencyMs: 1_500, finalAnswer: "12 月销售额 200 元" })
    ];
    const options = baseOptions(clock, scripts, {
      contract: contractDoc([followScenario()]),
      samplesPerScenario: 2,
      deps: {
        ...baseOptions(clock, scripts).deps,
        oracleChecker: () => ({ verdict: "correct", reason: "fake oracle" })
      }
    });
    const result = await runAgentPerformanceJourneys(options);
    assert.equal(result.status, "PASS", result.reasons.join("; "));
    const a = result.attempts[0];
    assert.equal(a.turns.length, 2);
    assert.deepEqual(
      a.turns.map((t) => t.sessionId),
      ["sess-1", "sess-1"]
    );
    assert.equal(a.hostSessionId, "sess-1");
    assert.equal(a.turns[0].turnWallClockMs, 1_000);
    assert.equal(a.turns[1].turnWallClockMs, 1_500);
    assert.equal(a.turnWallClockMs, 1_500); // max per-turn wall feeds the 120s hard line
    assert.equal(a.journeyWallClockMs, 2_500);
    assert.equal(a.sameSession, true);
    assert.equal(result.attempts.length, 2);
  });

  test("session break across turns is recorded as a failed attempt", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({ latencyMs: 100, sessionId: "sess-A", finalAnswer: "a" }),
      turnScript({ latencyMs: 100, sessionId: "sess-B", finalAnswer: "b" })
    ];
    const options = baseOptions(clock, scripts, {
      contract: contractDoc([followScenario()]),
      samplesPerScenario: 1,
      deps: { ...baseOptions(clock, scripts).deps, oracleChecker: () => ({ verdict: "correct" }) }
    });
    const result = await runAgentPerformanceJourneys(options);
    const a = result.attempts[0];
    assert.equal(a.outcome, "error");
    assert.equal(a.errorClass, "session_broken");
  });

  test("turn over the 120s hard line is a FAIL candidate handed to the judge (D21③)", async () => {
    const clock = manualClock(0);
    const scripts = [turnScript({ latencyMs: 121_000 })];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts));
    const a = result.attempts[0];
    assert.equal(a.hardLimitExceeded, true);
    assert.equal(a.turnWallClockMs, 121_000);
    assert.equal(a.outcome, "correct"); // oracle still passed; the judge fails the hard line
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.attempts[0].classification, "slow_no_error");
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "FAIL");
    assert.equal(result.scenarios[0].verdict, "FAIL");
  });

  test("multi-turn scenario on a client without multiTurn is BLOCKED, not downgraded (D9)", async () => {
    const clock = manualClock(0);
    const options = baseOptions(clock, [turnScript()], {
      contract: contractDoc([followScenario()]),
      deps: { ...baseOptions(clock, [turnScript()]).deps, detection: readyDetection({ multiTurn: false }) }
    });
    const result = await runAgentPerformanceJourneys(options);
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.scenarios[0].verdict, "BLOCKED");
    assert.ok(result.scenarios[0].reasons.join(" ").includes("multi_turn_unsupported"));
    // planned items stay visible as blocked stubs, never silently dropped
    assert.equal(result.attempts.length, 3);
    assert.ok(
      result.attempts.every((a) => a.outcome === "missing_evidence" && a.blockedReason === "multi_turn_unsupported")
    );
  });

  test("missing client selection is BLOCKED with reselect (D9)", async () => {
    const clock = manualClock(0);
    const result = await runAgentPerformanceJourneys(baseOptions(clock, [turnScript()], { selectedClientId: null }));
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.join(" ").includes("no client selected"));
  });

  test("model fingerprint switch mid-run is BLOCKED (D9)", async () => {
    const clock = manualClock(0);
    const scripts = [turnScript({ model: "fake-model-1" }), turnScript({ model: "other-model" })];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts, { samplesPerScenario: 2 }));
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.join(" ").includes("modelFingerprint switched"));
  });

  test("unresolvable questionRef is BLOCKED, never locally re-authored (D17)", async () => {
    const clock = manualClock(0);
    const result = await runAgentPerformanceJourneys(
      baseOptions(clock, [turnScript()], { contract: contractDoc([simpleScenario({ questionRef: "QB-GHOST" })]) })
    );
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.scenarios[0].reasons.join(" ").includes("questionRef"));
  });

  test("minimal observation mode still captures wall clock and final answer", async () => {
    const clock = manualClock(0);
    const result = await runAgentPerformanceJourneys(
      baseOptions(clock, [turnScript({ latencyMs: 900 })], { observation: "minimal" })
    );
    const a = result.attempts[0];
    assert.equal(a.observation, "minimal");
    assert.equal(a.turnWallClockMs, 900);
    assert.equal(a.outcome, "correct");
    // the detailed trace is not collected in minimal mode
    assert.equal(a.firstObservableQuality, FIRST_OBSERVABLE_COARSE);
    assert.equal(a.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
    assert.equal(a.toolTrace.length, 0);
  });

  test("a host that reports no answer timestamp still yields a coarse final answer, never a token", async () => {
    const clock = manualClock(0);
    const result = await runAgentPerformanceJourneys(
      baseOptions(clock, [turnScript({ latencyMs: 700, noAnswerTimestamp: true, events: [] })])
    );
    const a = result.attempts[0];
    assert.equal(a.finalAnswerMs, 700);
    assert.equal(a.finalCorrectAnswerMs, 700);
    assert.equal(a.firstObservableMs, 700);
    assert.equal(a.firstObservableQuality, FIRST_OBSERVABLE_COARSE);
    assert.equal(a.firstTokenMs, FIRST_TOKEN_NOT_AVAILABLE);
    assert.equal(a.outcome, "correct");
  });

  test("agent attempts satisfy the shared evidence schema (verifier contract)", async () => {
    const clock = manualClock(0);
    const result = await runAgentPerformanceJourneys(baseOptions(clock, [turnScript({ latencyMs: 900 })]));
    for (const attempt of result.attempts) {
      const validation = validateAttempt(attempt);
      assert.equal(
        validation.ok,
        true,
        `${attempt.attemptId}: ${validation.problems.map((p) => p.message).join("; ")}`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// D21 provider receipt evidence + bounded retries
// ---------------------------------------------------------------------------

describe("provider error receipts (D21)", () => {
  test("transient 429 with a complete receipt is claimed, retried with retryOf, and reconciled by the judge", async () => {
    const clock = manualClock(0);
    const receipt = { statusCode: 429, timestamp: "2026-11-26T00:00:01Z", errorKind: "http_error", raw: '{"status":429}' };
    const scripts = [
      turnScript({
        latencyMs: 300,
        ok: false,
        exitCode: 1,
        finalAnswer: "",
        events: [{ offsetMs: 300, type: "error", receipt }],
        providerReceipt: receipt
      }),
      turnScript({ latencyMs: 900 })
    ];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts, { samplesPerScenario: 20 }));
    assert.equal(result.attempts.length, 21); // 20 plan items + 1 bounded retry
    const [failed, retried] = result.attempts;
    assert.equal(failed.outcome, "error");
    assert.equal(failed.statusCode, 429);
    assert.equal(failed.timestamp, "2026-11-26T00:00:01Z");
    assert.equal(failed.errorKind, "http_error");
    assert.equal(failed.claimedClass, "providerError");
    assert.equal(failed.providerReceipt.raw, '{"status":429}');
    assert.equal(failed.audit.reconciled, true);
    assert.equal(retried.retryOf, failed.attemptId);
    assert.equal(retried.planItemId, failed.planItemId);
    assert.notEqual(retried.attemptId, failed.attemptId);
    assert.equal(retried.questionStartedAt, 300); // latency from the retry's own start
    assert.equal(retried.outcome, "correct");
    assert.equal(failed.firstAttempt, true);
    assert.equal(failed.finalAttempt, false);
    assert.equal(failed.finalAttemptId, retried.attemptId);
    assert.equal(retried.firstAttempt, false);
    assert.equal(retried.finalAttempt, true);
    assert.equal(result.disclosure.providerErrorCount, 1);
    assert.equal(result.disclosure.retryCount, 1);

    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.attempts[0].classification, "providerError");
    assert.equal(prov.attempts[1].judgmentSample, true);
    // D21②/⑧: one transient error in 20 planned items (5% <= 10%) with a
    // successful retry does not trigger the provider-unavailable bound.
    assert.equal(prov.scenarios.SIMPLE_WARM.triggers.shareExceeded, false);
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "OK");
  });

  test("a providerError share above 10% of the planned items is BLOCKED (D21②)", async () => {
    const clock = manualClock(0);
    const receipt = { statusCode: 429, timestamp: "2026-11-26T00:00:01Z", errorKind: "http_error" };
    const scripts = [
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt }),
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt })
    ];
    // 1 planned item, 1 providerError → 100% of the plan items (D21②)
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts, { samplesPerScenario: 1 }));
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.scenarios.SIMPLE_WARM.triggers.shareExceeded, true);
    assert.equal(prov.scenarios.SIMPLE_WARM.blockedReason, "providerUnavailable");
    assert.equal(result.scenarios[0].verdict, "BLOCKED");
  });

  test("receipt missing timestamp is recorded truthfully and never claimed (D21⑤)", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({
        latencyMs: 200,
        ok: false,
        exitCode: 1,
        finalAnswer: "",
        providerReceipt: { statusCode: 503, errorKind: "http_error" } // no timestamp
      })
    ];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts, { samplesPerScenario: 1 }));
    assert.equal(result.attempts.length, 1); // an incomplete receipt is never retried nor claimed
    const a = result.attempts[0];
    assert.equal(a.statusCode, 503);
    assert.equal(a.timestamp, null);
    assert.equal(a.claimedClass, null);
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.attempts[0].classification, "unclassifiable");
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "BLOCKED");
  });

  test("Lucy-side failure cannot be relabeled providerError even with a receipt-shaped error (D21④)", async () => {
    const clock = manualClock(0);
    const scripts = [
      turnScript({
        latencyMs: 200,
        ok: false,
        exitCode: 1,
        finalAnswer: "",
        providerReceipt: { statusCode: 500, timestamp: "2026-11-26T00:00:02Z", errorKind: "http_error" }
      })
    ];
    const options = baseOptions(clock, scripts, { samplesPerScenario: 1 });
    options.deps.auditLookup = () => ({ reconciled: true, failedCallsThisTurn: 1 }); // Lucy saw the failed call
    const result = await runAgentPerformanceJourneys(options);
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.attempts[0].classification, "lucy_error");
    assert.equal(prov.scenarios.SIMPLE_WARM.verdict, "FAIL");
    assert.ok(prov.problems.some((p) => p.includes("relabel rejected")));
  });

  test("retries are bounded at 2 per plan item (D21①)", async () => {
    const clock = manualClock(0);
    const receipt = { statusCode: 429, timestamp: "2026-11-26T00:00:01Z", errorKind: "http_error" };
    const scripts = [
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt }),
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt }),
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt }),
      turnScript({ latencyMs: 100, ok: false, exitCode: 1, finalAnswer: "", providerReceipt: receipt })
    ];
    const result = await runAgentPerformanceJourneys(baseOptions(clock, scripts, { samplesPerScenario: 1 }));
    assert.equal(result.attempts.length, 3); // 1 + max 2 retries; the 4th script is never consumed
    const prov = classifyProviderErrors(result.attempts);
    assert.equal(prov.scenarios.SIMPLE_WARM.triggers.retryExhausted, true);
    assert.equal(prov.scenarios.SIMPLE_WARM.blockedReason, "providerUnavailable");
  });
});

// ---------------------------------------------------------------------------
// 20/50-lane concurrency plan + role fairness (§5.3)
// ---------------------------------------------------------------------------

describe("concurrent plan and role fairness (§5.3)", () => {
  const identities = [
    ...Array.from({ length: 20 }, (_, i) => ({ identityId: `id-a${i}`, role: "role_a" })),
    ...Array.from({ length: 20 }, (_, i) => ({ identityId: `id-b${i}`, role: "role_b" })),
    ...Array.from({ length: 10 }, (_, i) => ({ identityId: `id-c${i}`, role: "role_c" }))
  ];

  test("plan offers every identity in every wave at synchronized times; nothing is merged or dropped", () => {
    const plan = buildConcurrentPlan({
      scenario: simpleScenario({ scenarioId: "CONCURRENT_C50_SIMPLE", concurrencyGroup: "c50", waves: 3 }),
      identities,
      startAtMs: 1_000,
      waveSpacingMs: 500
    });
    assert.equal(plan.targetConcurrency, 50);
    assert.equal(plan.waves.length, 3);
    assert.equal(plan.waves[0].offeredAtMs, 1_000);
    assert.equal(plan.waves[1].offeredAtMs, 1_500);
    assert.equal(plan.waves[0].jobs.length, 50);
    const allJobs = plan.waves.flatMap((w) => w.jobs);
    assert.equal(allJobs.length, 150);
    assert.equal(new Set(allJobs.map((j) => j.jobId)).size, 150);
    assert.ok(allJobs.every((j) => j.offeredAtMs === plan.waves[j.waveIndex].offeredAtMs));
  });

  test("execution records dispatch lag, terminal outcomes and actual in-flight peak", async () => {
    const clock = manualClock(0);
    const plan = buildConcurrentPlan({
      scenario: simpleScenario({ scenarioId: "CONCURRENT_C50_SIMPLE", concurrencyGroup: "c50", waves: 2 }),
      identities: identities.slice(0, 20),
      startAtMs: 0,
      waveSpacingMs: 1_000
    });
    const runJob = async (job) => {
      const latency = job.role === "role_a" ? 300 : 500;
      clock.advance(latency);
      return {
        ok: true,
        outcome: "correct",
        latencyMs: latency,
        observedRole: job.role,
        observedIdentityId: job.identityId
      };
    };
    const { executions } = await executeConcurrentPlan(plan, {
      runJob,
      now: () => clock.now(),
      sleep: async (ms) => {
        clock.advance(ms);
      }
    });
    assert.equal(executions.length, 40); // every offered job has a terminal record
    assert.ok(executions.every((e) => e.dispatchLagMs >= 0));
    const peaks = measureInFlightPeak(executions);
    assert.equal(peaks.global, 20); // the whole wave was actually in flight
    const summary = summarizeConcurrency(plan, executions);
    assert.equal(summary.global.inFlightPeak, 20);
    assert.equal(summary.perRole.role_a.offered, 40);
    assert.equal(summary.perRole.role_a.completed, 40);
  });

  test("fair fixture passes; slowest role within fastest×2+2s", () => {
    const mk = (role, lat) =>
      Array.from({ length: 20 }, (_, i) => ({
        jobId: `${role}-${i}`,
        identityId: `${role}-${i}`,
        role,
        waveIndex: 0,
        offeredAtMs: 0,
        dispatchedAtMs: 0,
        dispatchLagMs: 0,
        endedAtMs: lat,
        result: { ok: true, outcome: "correct", latencyMs: lat, observedRole: role, observedIdentityId: `${role}-${i}` }
      }));
    const executions = [...mk("role_a", 1_000), ...mk("role_b", 2_900)];
    const plan = { targetConcurrency: 40, waves: [{ waveIndex: 0, offeredAtMs: 0, jobs: executions }] };
    const summary = summarizeConcurrency(plan, executions);
    const verdict = judgeRoleFairness(summary, { targetConcurrency: 40 });
    assert.equal(verdict.verdict, "PASS", verdict.reasons.join("; "));
    assert.equal(FAIRNESS_LIMIT.ratio, 2);
    assert.equal(FAIRNESS_LIMIT.absMs, 2_000);
    assert.equal(summary.perRole.role_a.p95Ms, 1_000);
    assert.equal(summary.perRole.role_b.p95Ms, 2_900);
  });

  test("unfair fixture (slowest role beyond fastest×2+2s) is identified", () => {
    const mk = (role, lat) =>
      Array.from({ length: 20 }, (_, i) => ({
        jobId: `${role}-${i}`,
        identityId: `${role}-${i}`,
        role,
        waveIndex: 0,
        offeredAtMs: 0,
        dispatchedAtMs: 0,
        dispatchLagMs: 0,
        endedAtMs: lat,
        result: { ok: true, outcome: "correct", latencyMs: lat, observedRole: role, observedIdentityId: `${role}-${i}` }
      }));
    const executions = [...mk("role_fast", 1_000), ...mk("role_slow", 5_000)]; // 5000 > 1000×2+2000
    const plan = { targetConcurrency: 40, waves: [{ waveIndex: 0, offeredAtMs: 0, jobs: executions }] };
    const verdict = judgeRoleFairness(summarizeConcurrency(plan, executions), { targetConcurrency: 40 });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(verdict.reasons.join(" ").includes("fairness"));
  });

  test("role starvation, unexpected denial, cross-role leak and missed in-flight target are all caught", () => {
    const base = (role, i, lat, over = {}) => ({
      jobId: `${role}-${i}`,
      identityId: `${role}-${i}`,
      role,
      waveIndex: 0,
      offeredAtMs: 0,
      dispatchedAtMs: 0,
      dispatchLagMs: 0,
      endedAtMs: lat,
      result: { ok: true, outcome: "correct", latencyMs: lat, observedRole: role, observedIdentityId: `${role}-${i}`, ...over }
    });
    const plan = { targetConcurrency: 40, waves: [{ waveIndex: 0, offeredAtMs: 0, jobs: [] }] };

    // starvation: role_b offered but nothing completed
    const starved = [
      ...Array.from({ length: 20 }, (_, i) => base("role_a", i, 1_000)),
      ...Array.from({ length: 20 }, (_, i) => ({
        ...base("role_b", i, 900),
        result: { ok: false, outcome: "error", latencyMs: 900, observedRole: "role_b", observedIdentityId: `role_b-${i}` }
      }))
    ];
    assert.equal(judgeRoleFairness(summarizeConcurrency(plan, starved), { targetConcurrency: 40 }).verdict, "FAIL");

    // unexpected denial
    const denied = [
      ...Array.from({ length: 20 }, (_, i) => base("role_a", i, 1_000)),
      ...Array.from({ length: 20 }, (_, i) => base("role_b", i, 1_000, { outcome: "denied" }))
    ];
    const deniedVerdict = judgeRoleFairness(summarizeConcurrency(plan, denied), { targetConcurrency: 40 });
    assert.equal(deniedVerdict.verdict, "FAIL");
    assert.ok(deniedVerdict.reasons.join(" ").includes("denial"));

    // cross-role leak: observed role differs from the planned role
    const leaked = [
      ...Array.from({ length: 20 }, (_, i) => base("role_a", i, 1_000)),
      ...Array.from({ length: 20 }, (_, i) => base("role_b", i, 1_000, { observedRole: "role_a" }))
    ];
    const leakVerdict = judgeRoleFairness(summarizeConcurrency(plan, leaked), { targetConcurrency: 40 });
    assert.equal(leakVerdict.verdict, "FAIL");
    assert.ok(leakVerdict.reasons.join(" ").includes("leak"));

    // target concurrency never formed → cannot claim the concurrency test ran
    const thin = Array.from({ length: 4 }, (_, i) => base("role_a", i, 1_000));
    const thinVerdict = judgeRoleFairness(summarizeConcurrency(plan, thin), { targetConcurrency: 40 });
    assert.equal(thinVerdict.verdict, "BLOCKED");
    assert.ok(thinVerdict.reasons.join(" ").includes("target_concurrency_not_reached"));
  });

  test("dropped jobs (no terminal outcome) fail closed", () => {
    const plan = {
      targetConcurrency: 2,
      waves: [
        {
          waveIndex: 0,
          offeredAtMs: 0,
          jobs: [
            { jobId: "j1", identityId: "i1", role: "role_a", waveIndex: 0, offeredAtMs: 0 },
            { jobId: "j2", identityId: "i2", role: "role_a", waveIndex: 0, offeredAtMs: 0 }
          ]
        }
      ]
    };
    const executions = [
      {
        jobId: "j1",
        identityId: "i1",
        role: "role_a",
        waveIndex: 0,
        offeredAtMs: 0,
        dispatchedAtMs: 0,
        dispatchLagMs: 0,
        endedAtMs: 100,
        result: { ok: true, outcome: "correct", latencyMs: 100, observedRole: "role_a", observedIdentityId: "i1" }
      },
      {
        jobId: "j2",
        identityId: "i2",
        role: "role_a",
        waveIndex: 0,
        offeredAtMs: 0,
        dispatchedAtMs: 0,
        dispatchLagMs: 0,
        endedAtMs: null,
        result: null // never terminated
      }
    ];
    const verdict = judgeRoleFairness(summarizeConcurrency(plan, executions), { targetConcurrency: 2 });
    assert.equal(verdict.verdict, "FAIL");
    assert.ok(verdict.reasons.join(" ").includes("terminal"));
  });

  test("the runner drives a concurrent scenario: every identity is offered and the fairness is judged", async () => {
    const clock = manualClock(0);
    const identities = [
      ...Array.from({ length: 2 }, (_, i) => ({ identityId: `id-a${i}`, role: "role_a" })),
      ...Array.from({ length: 2 }, (_, i) => ({ identityId: `id-b${i}`, role: "role_b" }))
    ];
    const options = baseOptions(clock, [turnScript({ latencyMs: 500 })], {
      contract: contractDoc([concurrentScenario()]),
      identities
    });
    const result = await runAgentPerformanceJourneys(options);
    assert.equal(result.attempts.length, 8); // 4 identities × 2 waves
    assert.ok(result.fairness);
    assert.equal(result.fairness.verdict, "PASS", result.fairness.reasons.join("; "));
    assert.equal(result.fairness.targetConcurrency, 4);
    assert.equal(result.fairness.inFlightPeak, 4);
    assert.equal(result.scenarios[0].verdict, "PASS");
    const roles = new Set(result.attempts.map((a) => a.roleClass));
    assert.deepEqual([...roles].sort(), ["role_a", "role_b"]);
  });
});

// ---------------------------------------------------------------------------
// observation on/off A/B (Plan Task 4 step 5)
// ---------------------------------------------------------------------------

describe("observation overhead A/B", () => {
  test("overhead over >20% and >50ms is FIX_HARNESS, never a product regression", () => {
    const minimal = Array.from({ length: 30 }, () => 1_000);
    const detailed = Array.from({ length: 30 }, (_, i) => (i === 29 ? 1_400 : 1_300)); // p95 1300: +300ms (+30%)
    const r = compareObservationOverhead({ detailedSamples: detailed, minimalSamples: minimal });
    assert.equal(OBSERVATION_OVERHEAD_LIMIT.ratio, 0.2);
    assert.equal(OBSERVATION_OVERHEAD_LIMIT.absMs, 50);
    assert.equal(r.verdict, "FIX_HARNESS");
    assert.equal(r.productRegression, false);
    assert.ok(r.conclusion.includes("fix the harness"));
  });

  test("overhead within both thresholds passes", () => {
    const minimal = Array.from({ length: 30 }, () => 1_000);
    const detailed = Array.from({ length: 30 }, () => 1_040); // +40ms (+4%)
    const r = compareObservationOverhead({ detailedSamples: detailed, minimalSamples: minimal });
    assert.equal(r.verdict, "PASS");
    assert.equal(r.productRegression, false);
  });

  test("large relative but small absolute overhead passes the dual threshold", () => {
    const minimal = Array.from({ length: 30 }, () => 100);
    const detailed = Array.from({ length: 30 }, () => 140); // +40ms (+40%) — abs below 50ms
    const r = compareObservationOverhead({ detailedSamples: detailed, minimalSamples: minimal });
    assert.equal(r.verdict, "PASS");
  });

  test("insufficient samples cannot judge the A/B (BLOCKED)", () => {
    const r = compareObservationOverhead({ detailedSamples: [1_000, 1_100], minimalSamples: [1_000] });
    assert.equal(r.verdict, "BLOCKED");
  });
});
