/**
 * P1-78 Task 8 — SOAK（持续压力）与 LONG_FOLLOW（长追问）编排测试。
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   （D18／D19／D20／D21⑦／D23、§4.2、§4.1.1、§5.3、§5.4）
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 8
 *
 * 全部使用假时钟与假会话／假单轮执行器；本文件不发起真实跑次、不写证据目录。
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, test } from "node:test";
import path from "node:path";

import {
  ABSOLUTE_BUDGETS,
  mapOwnerBudgetClass
} from "../lib/mcp-inquiry-performance.mjs";
import {
  CONTRACT_ID,
  DEFAULT_PACK_PATH,
  MIN_CHAINS,
  MIN_CHAIN_TURNS,
  PRONOUN_BLOCKLIST_VERSION,
  computePackDigest
} from "../lib/mcp-inquiry-question-pack.mjs";
import {
  ARRIVAL_MODEL_KS_TOLERANCE,
  LONG_FOLLOW_CHAIN_RATIO,
  SOAK_MIN_EFFECTIVE_SECONDS,
  REPO_ROOT,
  assertChainEvidenceReusable,
  buildWindowRecords,
  chainInstanceKey,
  createArrivalModel,
  createChainInstanceRegistry,
  generateArrivalPlan,
  judgeArrivalModel,
  judgeRoleFairness,
  loadLongFollowPack,
  loadPerformanceContract,
  parseArrivalModelFromScaleBaseline,
  planChainInstances,
  readSoakScenarioContract,
  runLongFollowScenario,
  runSoakScenario,
  summarizeArrivalDistribution
} from "../lib/mcp-inquiry-performance-soak.mjs";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** 到达模型参数唯一来源：scale-baseline §1.1。 */
const ARRIVAL_1_1 = parseArrivalModelFromScaleBaseline();

const ROLE_CLASSES = ["read_only", "lucy_admin", "restricted_A", "restricted_B"];

function buildIdentities(count, roleClasses = ROLE_CLASSES) {
  return Array.from({ length: count }, (_, index) => ({
    identityId: `agent-${String(index + 1).padStart(3, "0")}`,
    roleClass: roleClasses[index % roleClasses.length]
  }));
}

/** 假单调时钟：编排只读时间，不推进真实时间。 */
function createFakeClock(start = 0) {
  let current = start;
  return {
    now: () => current,
    async sleepUntil(ms) {
      if (ms > current) current = ms;
    },
    async advanceTo(ms) {
      if (ms > current) current = ms;
    },
    setNow(ms) {
      current = ms;
    }
  };
}

function createFakeSessionFactory(overrides = {}) {
  const calls = [];
  const factory = async (identityId) => {
    calls.push(identityId);
    return {
      processId: `proc-${identityId}`,
      hostSessionId: `session-${identityId}`,
      supportsMultiTurn: true,
      ...(overrides[identityId] ?? {})
    };
  };
  factory.calls = calls;
  return factory;
}

function createFakeTurnExecutor(overrides = {}) {
  const calls = [];
  const executor = async (turn) => {
    calls.push(turn);
    const custom = typeof overrides === "function" ? overrides(turn) : overrides;
    return { outcome: "correct", wallClockMs: 1_000, ...(custom ?? {}) };
  };
  executor.calls = calls;
  return executor;
}

function buildTurn(chainId, index) {
  return {
    turnIndex: index,
    text: `查询 superstore_orders 在 2025 年 ${(index % 12) + 1} 月的订单销售额（${chainId} 第 ${index + 1} 轮）`,
    dependsOnTurn: index === 0 ? null : index - 1,
    carriedContext: ["连接=demo-mysql", "表=superstore_orders", "指标=订单销售额"],
    oracle: {
      kind: "independent-query",
      ref: `fixtures/oracle/${chainId}/turn-${String(index).padStart(2, "0")}.sql`,
      expect: { total_sales: 100000 + index }
    }
  };
}

function buildChain(id, options = {}) {
  const {
    budgetClass = "simple",
    identity = "read_only",
    connectionId = "demo-mysql",
    turnCount = MIN_CHAIN_TURNS
  } = options;
  return {
    id,
    version: 1,
    lane: "long-followup",
    configProfileId: "lucy-mcp-compat-demo",
    budgetClass,
    identity,
    connectionId,
    turns: Array.from({ length: turnCount }, (_, index) => buildTurn(id, index)),
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

/** 覆盖 3 个预算档与 4 个角色类的合法题组（P1-79 §3.2）。 */
function buildFiveChainPack() {
  return buildPack([
    buildChain("QB-LONG-01", { budgetClass: "simple", identity: "read_only" }),
    buildChain("QB-LONG-02", { budgetClass: "simple", identity: "lucy_admin" }),
    buildChain("QB-LONG-03", { budgetClass: "complex", identity: "read_only" }),
    buildChain("QB-LONG-04", { budgetClass: "complex", identity: "restricted_A" }),
    buildChain("QB-LONG-05", { budgetClass: "follow-up-join", identity: "restricted_B", connectionId: "lucy-ops" })
  ]);
}

/** 把到达计划改成固定间隔（均匀同发）——负控用。 */
function buildUniformPlan(basePlan, intervalMs = 60_000) {
  const windowMs = basePlan.windows.seconds * 1000;
  const byIdentity = new Map();
  for (const arrival of basePlan.arrivals) {
    if (!byIdentity.has(arrival.identityId)) byIdentity.set(arrival.identityId, []);
    byIdentity.get(arrival.identityId).push(arrival);
  }
  const arrivals = [];
  let index = 0;
  for (const [, entries] of byIdentity) {
    entries.forEach((entry, position) => {
      const offeredOffsetMs = (position + 1) * intervalMs;
      arrivals.push({
        ...entry,
        arrivalId: `uniform-arrival-${String(index++).padStart(5, "0")}`,
        offeredOffsetMs,
        offeredAtMs: (basePlan.startAtMs ?? 0) + offeredOffsetMs,
        windowIndex: Math.floor(offeredOffsetMs / windowMs),
        thinkTimeMs: intervalMs
      });
    });
  }
  arrivals.sort((a, b) => a.offeredAtMs - b.offeredAtMs);
  return { ...basePlan, arrivals };
}

// ---------------------------------------------------------------------------
// arrival model
// ---------------------------------------------------------------------------

describe("arrival model (scale-baseline §1.1 is the only source)", () => {
  test("the §1.1 row is parsed into the run parameters", () => {
    assert.equal(ARRIVAL_1_1.muSeconds, 60);
    assert.equal(ARRIVAL_1_1.sigmaSeconds, 20);
    assert.equal(ARRIVAL_1_1.clipMinSeconds, 20);
    assert.equal(ARRIVAL_1_1.clipMaxSeconds, 120);
    assert.equal(ARRIVAL_1_1.seed, 20261124);
    assert.deepEqual(ARRIVAL_1_1.classShare, { simple: 0.6, complex: 0.4 });
    assert.equal(ARRIVAL_1_1.windowCount, 12);
    assert.equal(ARRIVAL_1_1.windowSeconds, 150);
    assert.equal(ARRIVAL_1_1.effectiveSeconds, SOAK_MIN_EFFECTIVE_SECONDS);
  });

  test("a parse failure raises an explicit error instead of falling back to defaults", () => {
    assert.throws(() => parseArrivalModelFromScaleBaseline("# empty document\n"), /cannot find the "### 1\.1" section/);
    const rowWithoutNumbers = [
      "### 1.1 MCP-PERF",
      "",
      "| 维度 | 下限 |",
      "|---|---|",
      "| 持续压力到达模型（设计值） | 思考时间＝截断正态；有效窗口 12×150 秒；随机种子固定整数 20261124 |",
      ""
    ].join("\n");
    assert.throws(() => parseArrivalModelFromScaleBaseline(rowWithoutNumbers), /cannot parse μ/);
    assert.throws(
      () => parseArrivalModelFromScaleBaseline("docs/qa/uat/does-not-exist-scale-baseline.md"),
      /scale baseline not found/
    );
  });

  test("the same seed yields the same think-time sequence and a different seed does not", () => {
    const first = createArrivalModel(ARRIVAL_1_1);
    const second = createArrivalModel(ARRIVAL_1_1);
    const other = createArrivalModel({ ...ARRIVAL_1_1, seed: ARRIVAL_1_1.seed + 1 });
    const sequenceA = Array.from({ length: 32 }, () => first.nextThinkTimeSeconds());
    const sequenceB = Array.from({ length: 32 }, () => second.nextThinkTimeSeconds());
    const sequenceC = Array.from({ length: 32 }, () => other.nextThinkTimeSeconds());
    assert.deepEqual(sequenceA, sequenceB);
    assert.notDeepEqual(sequenceA, sequenceC);
  });

  test("think times are truncated to the configured clip bounds", () => {
    const model = createArrivalModel({ ...ARRIVAL_1_1, sigmaSeconds: 45 });
    const values = Array.from({ length: 4_000 }, () => model.nextThinkTimeSeconds());
    assert.ok(values.every((value) => value >= ARRIVAL_1_1.clipMinSeconds && value <= ARRIVAL_1_1.clipMaxSeconds));
    const stats = model.stats();
    assert.equal(stats.drawn, 4_000);
    assert.ok(stats.clippedLow > 0, "lower clip bound must be exercised");
    assert.ok(stats.clippedHigh > 0, "upper clip bound must be exercised");
    assert.equal(stats.clippedLow + stats.clippedHigh, values.filter((v) => v === ARRIVAL_1_1.clipMinSeconds || v === ARRIVAL_1_1.clipMaxSeconds).length);
  });

  test("the arrival plan honours the configured class share and records the actual distribution", () => {
    const plan = generateArrivalPlan({
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 150 }
    });
    assert.equal(plan.arrivals.length > 1_000, true);
    const distribution = summarizeArrivalDistribution(plan);
    assert.equal(distribution.sampleCount, plan.arrivals.length);
    assert.ok(Math.abs(distribution.perClassShare.simple - 0.6) < 0.01);
    assert.ok(Math.abs(distribution.perClassShare.complex - 0.4) < 0.01);
    assert.ok(distribution.meanMs > 55_000 && distribution.meanMs < 65_000);
    assert.ok(distribution.sdMs > 15_000 && distribution.sdMs < 22_000);
    assert.ok(distribution.minMs >= ARRIVAL_1_1.clipMinSeconds * 1000 - 1);
    assert.ok(distribution.maxMs <= ARRIVAL_1_1.clipMaxSeconds * 1000 + 1);
    assert.equal(typeof distribution.clippedLowCount, "number");
    assert.equal(typeof distribution.clippedHighCount, "number");
    assert.ok(distribution.p95Ms > distribution.p50Ms);
  });

  test("the arrival-model check accepts the configured truncated normal and reports the KS distances", () => {
    const plan = generateArrivalPlan({
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 150 }
    });
    const distribution = summarizeArrivalDistribution(plan);
    const check = judgeArrivalModel({ arrival: ARRIVAL_1_1, thinkTimesMs: distribution.thinkTimesMs });
    assert.equal(check.verdict, "PASS", check.reasons.join("\n"));
    assert.ok(check.ksTruncated < ARRIVAL_MODEL_KS_TOLERANCE);
    assert.ok(check.ksUniform > check.ksTruncated);
  });
});

// ---------------------------------------------------------------------------
// SOAK orchestration
// ---------------------------------------------------------------------------

describe("SOAK orchestration (Spec D18 / D23, §5.4)", () => {
  test("a compliant run covers 12×150s effective windows with 50 identities and no undispatched arrival", async () => {
    const sessionFactory = createFakeSessionFactory();
    const turnExecutor = createFakeTurnExecutor();
    const result = await runSoakScenario({
      runId: "run-soak-1",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 150 },
      sessionFactory,
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "PASS", result.reasons.join("\n"));
    assert.equal(result.effectiveWindowSeconds, 1_800);
    assert.equal(result.identityCount, 50);
    assert.equal(result.offeredCount, result.dispatchedCount);
    assert.equal(result.undispatchedCount, 0);
    assert.equal(result.unfinishedCount, 0);
    assert.equal(result.turns.length, result.offeredCount);
    assert.ok(result.turns.every((turn) => turn.outcome != null), "every planned arrival needs a terminal outcome");
    assert.equal(result.windowRecords.length, 12);
    assert.equal(result.windowJudgement.verdict, "PASS");
    // preparation / warmup / cleanup are listed separately and never count as effective window
    assert.deepEqual(result.phases, { preparationSeconds: 0, warmupSeconds: 0, cleanupSeconds: 0 });
  });

  test("window statistics are grouped by windowIndex×budgetClass and handed to the D23 judge", async () => {
    const result = await runSoakScenario({
      runId: "run-soak-2",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    const first = result.windowRecords[0];
    assert.equal(first.windowIndex, 0);
    assert.ok(first.perClassStats.simple.n >= 20, "simple arrivals per window must reach the P95 floor");
    assert.ok(first.perClassStats.complex.n >= 20, "complex arrivals per window must reach the P95 floor");
    assert.equal(typeof first.perClassStats.simple.p95Ms, "number");
    assert.equal(result.windowJudgement.perWindow.length, 12);
    assert.equal(result.windowJudgement.perWindow[0].perClass.simple.n, first.perClassStats.simple.n);
    assert.ok(result.windowJudgement.trends.adjacent.length > 0);
    assert.equal(result.windowJudgement.trends.firstLast.simple.segmentWindows, 4);
  });

  test("a slow system delays the dispatch instead of merging or dropping the arrival", async () => {
    const slowIdentity = "agent-001";
    const turnExecutor = createFakeTurnExecutor((turn) =>
      turn.identityId === slowIdentity && turn.windowIndex === 0 ? { wallClockMs: 90_000 } : { wallClockMs: 1_000 }
    );
    const result = await runSoakScenario({
      runId: "run-soak-3",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      maxDispatchLagMs: 300_000,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    const lagged = result.turns.filter((turn) => turn.dispatchLagMs > 0);
    assert.ok(lagged.length > 0, "the slow identity must show a dispatch lag");
    assert.ok(lagged.every((turn) => turn.dispatched === true), "a late arrival is dispatched, never silently dropped");
    assert.equal(result.offeredCount, result.dispatchedCount);
    assert.equal(result.undispatchedCount, 0);
  });

  test("an arrival that cannot be dispatched inside the lag budget is counted separately and fails", async () => {
    const slowIdentity = "agent-002";
    const turnExecutor = createFakeTurnExecutor((turn) =>
      turn.identityId === slowIdentity && turn.windowIndex === 0 ? { wallClockMs: 90_000 } : { wallClockMs: 1_000 }
    );
    const result = await runSoakScenario({
      runId: "run-soak-4",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      maxDispatchLagMs: 0,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.undispatchedCount > 0, "the undispatched arrival must be counted on its own");
    assert.ok(result.reasons.some((reason) => /never dispatched/.test(reason)));
    assert.equal(result.offeredCount, result.dispatchedCount + result.undispatchedCount);
  });

  test("a turn without a terminal outcome is counted as unfinished and fails", async () => {
    const turnExecutor = createFakeTurnExecutor((turn) =>
      turn.attemptId.endsWith("00007") ? { outcome: "pending" } : {}
    );
    const result = await runSoakScenario({
      runId: "run-soak-5",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.unfinishedCount, 1);
    assert.ok(result.reasons.some((reason) => /never reached a terminal outcome/.test(reason)));
  });

  test("a turn in flight at the window end drains into the window it was offered in", async () => {
    const windowMs = ARRIVAL_1_1.windowSeconds * 1000;
    const turnExecutor = createFakeTurnExecutor((turn) => {
      const windowEnd = (turn.windowIndex + 1) * windowMs;
      const remaining = windowEnd - turn.offeredAtMs;
      if (remaining > 0 && remaining <= 5_000) {
        return { wallClockMs: remaining + 20_000 };
      }
      return { wallClockMs: 1_000 };
    });
    const result = await runSoakScenario({
      runId: "run-soak-6",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      maxDispatchLagMs: 600_000,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    const drained = result.turns.filter((turn) => turn.endedAtMs > (turn.windowIndex + 1) * windowMs);
    assert.ok(drained.length > 0, "the fixture must produce at least one draining turn");
    for (const turn of drained) {
      const window = result.windowRecords.find((record) => record.windowIndex === turn.windowIndex);
      assert.ok(
        window.turns.some((candidate) => candidate.attemptId === turn.attemptId),
        "a draining turn stays in the window it was offered in"
      );
    }
    assert.equal(result.windowJudgement.verdict, "PASS", result.windowJudgement.reasons.join("\n"));
  });

  test("a turn that drains beyond 120s is rejected", async () => {
    const windowMs = ARRIVAL_1_1.windowSeconds * 1000;
    const turnExecutor = createFakeTurnExecutor((turn) => {
      const windowEnd = (turn.windowIndex + 1) * windowMs;
      const remaining = windowEnd - turn.offeredAtMs;
      if (remaining > 0 && remaining <= 5_000) {
        return { wallClockMs: remaining + 200_000 };
      }
      return { wallClockMs: 1_000 };
    });
    const result = await runSoakScenario({
      runId: "run-soak-7",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      maxDispatchLagMs: 600_000,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.windowJudgement.verdict, "FAIL");
    assert.ok(result.windowJudgement.reasons.some((reason) => /beyond the 120000ms drain/.test(reason)));
  });

  test("role fairness is judged across the whole effective window", async () => {
    const fair = await runSoakScenario({
      runId: "run-soak-8",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(fair.fairness.fair, true, fair.fairness.reasons.join("\n"));
    assert.equal(fair.fairness.groups.length, ROLE_CLASSES.length);

    const unfairExecutor = createFakeTurnExecutor((turn) =>
      turn.roleClass === "restricted_A" ? { wallClockMs: 60_000 } : { wallClockMs: 1_000 }
    );
    const unfair = await runSoakScenario({
      runId: "run-soak-9",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: unfairExecutor,
      clock: createFakeClock()
    });
    assert.equal(unfair.fairness.fair, false);
    assert.ok(unfair.fairness.reasons.some((reason) => /slowest role p95/.test(reason)));
  });

  test("role starvation is detected when an identity never completes a turn", () => {
    const fairness = judgeRoleFairness([
      { identityId: "a", roleClass: "read_only", budgetClass: "simple", wallClockMs: 1_000, outcome: "correct" },
      { identityId: "b", roleClass: "read_only", budgetClass: "simple", wallClockMs: 1_000, outcome: "correct" }
    ]);
    assert.equal(fairness.fair, true);
    const starved = judgeRoleFairness([
      { identityId: "a", roleClass: "read_only", budgetClass: "simple", wallClockMs: 1_000, outcome: "correct" },
      { identityId: "b", roleClass: "lucy_admin", budgetClass: "simple", wallClockMs: 1_000, outcome: "unexpected_deny" }
    ]);
    assert.equal(starved.fair, false);
    assert.ok(starved.reasons.some((reason) => /unexpected denial/.test(reason)));
  });

  test("sample reachability is checked before the run and blocks an unreachable plan", async () => {
    const turnExecutor = createFakeTurnExecutor();
    const result = await runSoakScenario({
      runId: "run-soak-10",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(10),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "sample_unreachable");
    assert.equal(result.turns.length, 0);
    assert.equal(turnExecutor.calls.length, 0, "an unreachable plan must not start the run");
  });

  test("a long-chain identity expectation below 21 over the effective window is BLOCKED sample_unreachable", async () => {
    const pack = buildFiveChainPack();
    const result = await runSoakScenario({
      runId: "run-soak-14",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 100 },
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      chainOptions: {
        pack,
        identities: buildIdentities(50),
        executeCount: 5,
        expectedPackDigest: pack.packDigest,
        sessionFactory: createFakeSessionFactory(),
        turnExecutor: createFakeTurnExecutor()
      },
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "sample_unreachable");
    assert.ok(result.reasons.some((reason) => /long-chain/.test(reason)));
    assert.equal(result.turns.length, 0);
  });

  test("an identity count that is not the profile's 50 identities is rejected before the run", async () => {
    const turnExecutor = createFakeTurnExecutor();
    const result = await runSoakScenario({
      runId: "run-soak-15",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(60),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /identity count 60 != required 50/.test(reason)));
    assert.equal(turnExecutor.calls.length, 0);
  });

  test("a host without multi-turn support is BLOCKED and the plan is not degraded", async () => {
    const result = await runSoakScenario({
      runId: "run-soak-11",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      hostSupportsMultiTurn: false,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "host_multi_turn_unsupported");
    assert.ok(result.reasons.some((reason) => /D19/.test(reason)));
  });

  test("a host concurrency quota below the identity count is BLOCKED", async () => {
    const result = await runSoakScenario({
      runId: "run-soak-12",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      hostConcurrencyQuota: 20,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "provider_unavailable");
    assert.ok(result.reasons.some((reason) => /identity count is never reduced/.test(reason)));
  });

  test("the effective window is the sum of the windows; preparation time never counts", async () => {
    const result = await runSoakScenario({
      runId: "run-soak-13",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      phases: { preparationSeconds: 300, warmupSeconds: 120, cleanupSeconds: 60 },
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.effectiveWindowSeconds, 1_800);
    assert.equal(result.phases.preparationSeconds, 300);
    assert.equal(result.phases.warmupSeconds, 120);
    assert.equal(result.phases.cleanupSeconds, 60);
  });

  test("window records expose the D23 grouping key and the per-class statistics", () => {
    const records = buildWindowRecords({
      turns: [
        { windowIndex: 0, budgetClass: "simple", wallClockMs: 1_000, outcome: "correct", offeredAtMs: 10, endedAtMs: 1_010 },
        { windowIndex: 0, budgetClass: "complex", wallClockMs: 2_000, outcome: "correct", offeredAtMs: 20, endedAtMs: 2_020 }
      ],
      windows: { count: 2, seconds: 150 },
      startAtMs: 0
    });
    assert.equal(records.length, 2);
    assert.equal(records[0].windowIndex, 0);
    assert.equal(records[0].perClassStats.simple.n, 1);
    assert.equal(records[0].perClassStats.complex.n, 1);
    assert.equal(records[0].perClassStats.simple.p95Ms, "not_estimable");
    assert.equal(records[1].turns.length, 0);
  });
});

// ---------------------------------------------------------------------------
// negative controls
// ---------------------------------------------------------------------------

describe("negative controls (Plan Task 8 step 6)", () => {
  test("a shortened effective window (<1800s) is rejected", async () => {
    const result = await runSoakScenario({
      runId: "nc-window",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 140 },
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /effective window 1680s < 1800s/.test(reason)));
    assert.equal(result.turns.length, 0);
  });

  test("uniform arrivals instead of the configured truncated normal are detected", async () => {
    const base = generateArrivalPlan({
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      windows: { count: 12, seconds: 150 }
    });
    const uniform = buildUniformPlan(base);
    const result = await runSoakScenario({
      runId: "nc-uniform",
      arrival: ARRIVAL_1_1,
      arrivalPlan: uniform,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(
      result.reasons.some((reason) => /uniform/i.test(reason)),
      `expected a uniform-arrival rejection, got: ${result.reasons.join(" | ")}`
    );
    assert.ok(result.reasons.some((reason) => /near-constant/.test(reason)));
  });

  test("a long-follow ratio below 10% is rejected", async () => {
    const pack = buildFiveChainPack();
    const result = await runLongFollowScenario({
      runId: "nc-ratio",
      pack,
      identities: buildIdentities(50),
      executeCount: 4,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.equal(result.requiredChains, Math.ceil(LONG_FOLLOW_CHAIN_RATIO * 50));
    assert.equal(result.validChains, 4);
    assert.ok(result.reasons.some((reason) => /valid long-follow chains 4 < required 5/.test(reason)));
  });

  test("a chain whose host process or session changes is invalid", async () => {
    const pack = buildFiveChainPack();
    const turnExecutor = createFakeTurnExecutor((turn) =>
      turn.turnIndex === 10 ? { processId: "proc-restarted" } : {}
    );
    const result = await runLongFollowScenario({
      runId: "nc-process",
      pack,
      identities: buildIdentities(50),
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /processId\/hostSessionId changed/.test(reason)));
  });

  test("a chain with a missing turn is invalid", async () => {
    const pack = buildFiveChainPack();
    const turnExecutor = createFakeTurnExecutor((turn) => (turn.turnIndex === 10 ? { skipped: true } : {}));
    const result = await runLongFollowScenario({
      runId: "nc-missing-turn",
      pack,
      identities: buildIdentities(50),
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /turnIndex gap or duplicate/.test(reason)));
    assert.ok(result.reasons.some((reason) => /turns < 21/.test(reason)));
  });

  test("a chain with a duplicated turnIndex is invalid", async () => {
    const pack = buildFiveChainPack();
    const turnExecutor = createFakeTurnExecutor((turn) => (turn.turnIndex === 10 ? { turnIndex: 9 } : {}));
    const result = await runLongFollowScenario({
      runId: "nc-duplicate-turn",
      pack,
      identities: buildIdentities(50),
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /turnIndex gap or duplicate/.test(reason)));
  });

  test("executing the same chain instance (template×identity×runId) twice is rejected", async () => {
    const pack = buildFiveChainPack();
    const identities = buildIdentities(50);
    // the same identity appears twice -> the same chain instance is planned twice
    identities[1] = { ...identities[0] };
    const turnExecutor = createFakeTurnExecutor();
    const result = await runLongFollowScenario({
      runId: "nc-duplicate-instance",
      pack,
      identities,
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "FAIL");
    assert.ok(result.reasons.some((reason) => /executed twice in the same run/.test(reason)));
    assert.equal(result.validChains, 4);
  });

  test("different identities running the same template are not falsely rejected", async () => {
    const pack = buildFiveChainPack();
    const identities = buildIdentities(50, ["read_only"]);
    const result = await runLongFollowScenario({
      runId: "nc-legal-identity",
      pack,
      identities,
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "PASS", result.reasons.join("\n"));
    assert.equal(result.validChains, 5);
    assert.ok(!result.reasons.some((reason) => /executed twice/.test(reason)));
    const templates = new Set(result.chains.map((chain) => chain.templateId));
    assert.equal(templates.size, 1, "the same template may serve several identities");
  });
});

// ---------------------------------------------------------------------------
// LONG_FOLLOW chain orchestration
// ---------------------------------------------------------------------------

describe("LONG_FOLLOW orchestration (Spec D20, §5.4)", () => {
  test("a missing question pack is BLOCKED", async () => {
    const result = await runLongFollowScenario({
      runId: "lf-missing-pack",
      packPath: "scripts/e2e/contracts/mcp-inquiry-long-followups.absent.yaml",
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "missing_question_pack");
    assert.ok(result.reasons.some((reason) => /D19/.test(reason)));
  });

  test("the packaged long-follow pack loads, or is BLOCKED when absent (never silently skipped)", () => {
    const loaded = loadLongFollowPack();
    if (existsSync(path.resolve(REPO_ROOT, DEFAULT_PACK_PATH))) {
      assert.equal(loaded.ok, true, loaded.problems.join("\n"));
      assert.ok(loaded.digest);
      assert.ok(loaded.pack);
    } else {
      assert.equal(loaded.ok, false);
      assert.equal(loaded.blockedReason, "missing_question_pack");
      assert.equal(loaded.pack, null);
    }
  });

  test("a pack digest mismatch is BLOCKED", async () => {
    const pack = buildFiveChainPack();
    const result = await runLongFollowScenario({
      runId: "lf-digest",
      pack,
      expectedPackDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.blockedReason, "pack_digest_mismatch");
  });

  test("every chain turn runs in one host process and one host session with a strictly increasing turnIndex", async () => {
    const pack = buildFiveChainPack();
    const sessionFactory = createFakeSessionFactory();
    const turnExecutor = createFakeTurnExecutor();
    const result = await runLongFollowScenario({
      runId: "lf-happy",
      pack,
      identities: buildIdentities(50),
      executeCount: 5,
      sessionFactory,
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.verdict, "PASS", result.reasons.join("\n"));
    assert.equal(result.chains.length, 5);
    for (const chain of result.chains) {
      assert.equal(chain.turns.length, MIN_CHAIN_TURNS);
      assert.equal(new Set(chain.turns.map((turn) => turn.processId)).size, 1);
      assert.equal(new Set(chain.turns.map((turn) => turn.hostSessionId)).size, 1);
      const indexes = chain.turns.map((turn) => turn.turnIndex);
      assert.deepEqual(indexes, indexes.map((_, index) => index));
      assert.equal(chain.runId, "lf-happy");
      assert.equal(chain.packDigest, pack.packDigest);
      assert.ok(chain.chainId.startsWith("QB-LONG-"));
    }
  });

  test("the chain budget class is mapped through the Spec §4.1.1 table", async () => {
    const pack = buildFiveChainPack();
    const result = await runLongFollowScenario({
      runId: "lf-class",
      pack,
      identities: buildIdentities(50),
      executeCount: 5,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      clock: createFakeClock()
    });
    const mapped = result.chains.map((chain) => chain.turns[0].budgetClass);
    assert.deepEqual([...new Set(mapped)].sort(), ["complex", "simple"]);
    const followUpJoin = mapOwnerBudgetClass("follow-up-join");
    assert.equal(followUpJoin.ok, true);
    assert.equal(followUpJoin.budgetClass, "complex");
    assert.equal(mapOwnerBudgetClass("ops-w0").ok, false);
  });

  test("the chain-instance registry rejects a repeated template×identity×runId", () => {
    const registry = createChainInstanceRegistry();
    const first = registry.register("QB-LONG-01", "agent-001", "run-1");
    const second = registry.register("QB-LONG-01", "agent-001", "run-1");
    const otherIdentity = registry.register("QB-LONG-01", "agent-002", "run-1");
    const otherRun = registry.register("QB-LONG-01", "agent-001", "run-2");
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);
    assert.equal(second.reason, "chain_instance_duplicate");
    assert.equal(otherIdentity.accepted, true, "a different identity may run the same template");
    assert.equal(otherRun.accepted, true, "another runId is another chain instance");
    assert.equal(registry.size, 3);
    assert.equal(chainInstanceKey("QB-LONG-01", "agent-001", "run-1"), "QB-LONG-01×agent-001×run-1");
  });

  test("the chain ratio counts failed chain instances without dropping them from the denominator", async () => {
    const pack = buildFiveChainPack();
    const failingIdentities = new Set(["agent-005", "agent-006"]);
    const turnExecutor = createFakeTurnExecutor((turn) =>
      failingIdentities.has(turn.identityId) ? { outcome: "wrong_answer" } : {}
    );
    const result = await runLongFollowScenario({
      runId: "lf-failed-instances",
      pack,
      identities: buildIdentities(50),
      executeCount: 6,
      sessionFactory: createFakeSessionFactory(),
      turnExecutor,
      clock: createFakeClock()
    });
    assert.equal(result.plannedChainCount, 50, "failed instances stay in the denominator");
    assert.equal(result.validChains, 4);
    assert.equal(result.requiredChains, 5);
    assert.equal(result.verdict, "FAIL");
  });

  test("chain instances are planned per identity and bound to a template of the identity role class", () => {
    const pack = buildFiveChainPack();
    const plan = planChainInstances({ pack, identities: buildIdentities(50), runId: "run-9" });
    assert.equal(plan.instances.length, 50);
    assert.equal(plan.plannedChainCount, 50);
    assert.equal(plan.unplanned.length, 0);
    for (const instance of plan.instances) {
      const template = pack.cases.find((chain) => chain.id === instance.templateId);
      assert.equal(template.identity, instance.roleClass);
      assert.equal(instance.chainId, chainInstanceKey(instance.templateId, instance.identityId, "run-9"));
    }
    const orphan = planChainInstances({
      pack,
      identities: [{ identityId: "agent-001", roleClass: "no_such_role" }],
      runId: "run-9"
    });
    assert.equal(orphan.instances.length, 0);
    assert.equal(orphan.unplanned[0].reason, "no_template_for_role_class");
  });

  test("LONG_FOLLOW reuses the SOAK run's chain evidence instead of a second long chain round", async () => {
    const pack = buildFiveChainPack();
    const chainTurnExecutor = createFakeTurnExecutor();
    const soak = await runSoakScenario({
      runId: "lf-reuse",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      chainOptions: {
        pack,
        identities: buildIdentities(50),
        executeCount: 5,
        expectedPackDigest: pack.packDigest,
        sessionFactory: createFakeSessionFactory(),
        turnExecutor: chainTurnExecutor
      },
      clock: createFakeClock()
    });
    assert.equal(soak.verdict, "PASS", soak.reasons.join("\n"));
    assert.equal(soak.chains.length, 5);
    const callsAfterSoak = chainTurnExecutor.calls.length;
    assert.ok(callsAfterSoak > 0);

    const longFollow = await runLongFollowScenario({
      runId: "lf-reuse",
      expectedPackDigest: pack.packDigest,
      identities: buildIdentities(50),
      reuseChains: { chains: soak.chains, plannedChainCount: soak.plannedChainCount },
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: chainTurnExecutor,
      clock: createFakeClock()
    });
    assert.equal(longFollow.reused, true);
    assert.equal(longFollow.verdict, "PASS", longFollow.reasons.join("\n"));
    assert.equal(chainTurnExecutor.calls.length, callsAfterSoak, "no second ≥20-turn chain round may be started");
  });

  test("chain defects inside the SOAK run are surfaced for LONG_FOLLOW instead of being merged into the SOAK verdict", async () => {
    const pack = buildFiveChainPack();
    const chainTurnExecutor = createFakeTurnExecutor((turn) =>
      turn.turnIndex === 10 ? { processId: "proc-restarted" } : {}
    );
    const soak = await runSoakScenario({
      runId: "lf-defect",
      arrival: ARRIVAL_1_1,
      identities: buildIdentities(50),
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: createFakeTurnExecutor(),
      chainOptions: {
        pack,
        identities: buildIdentities(50),
        executeCount: 5,
        expectedPackDigest: pack.packDigest,
        sessionFactory: createFakeSessionFactory(),
        turnExecutor: chainTurnExecutor
      },
      clock: createFakeClock()
    });
    assert.equal(soak.verdict, "PASS", soak.reasons.join("\n"));
    assert.equal(soak.chainVerdict, "FAIL");
    assert.ok(soak.chainReasons.some((reason) => /processId\/hostSessionId changed/.test(reason)));

    const longFollow = await runLongFollowScenario({
      runId: "lf-defect",
      expectedPackDigest: pack.packDigest,
      identities: buildIdentities(50),
      reuseChains: { chains: soak.chains, plannedChainCount: soak.plannedChainCount },
      sessionFactory: createFakeSessionFactory(),
      turnExecutor: chainTurnExecutor,
      clock: createFakeClock()
    });
    assert.equal(longFollow.verdict, "FAIL");
    assert.ok(longFollow.reasons.some((reason) => /processId\/hostSessionId changed/.test(reason)));
  });

  test("chain evidence from another run or fingerprint is not reusable", async () => {
    const chains = [
      {
        chainId: "QB-LONG-01×agent-001×run-1",
        templateId: "QB-LONG-01",
        identityId: "agent-001",
        runId: "run-1",
        packDigest: "sha256:pack",
        turns: []
      }
    ];
    assert.equal(assertChainEvidenceReusable(chains, { runId: "run-1", packDigest: "sha256:pack" }).ok, true);
    const otherRun = assertChainEvidenceReusable(chains, { runId: "run-2", packDigest: "sha256:pack" });
    assert.equal(otherRun.ok, false);
    assert.ok(otherRun.problems.some((problem) => /runId/.test(problem)));
    const otherDigest = assertChainEvidenceReusable(chains, { runId: "run-1", packDigest: "sha256:other" });
    assert.equal(otherDigest.ok, false);
    const otherFingerprint = assertChainEvidenceReusable(chains, {
      runId: "run-1",
      packDigest: "sha256:pack",
      fingerprint: { clientModel: "model-b" },
      sourceFingerprint: { clientModel: "model-a" }
    });
    assert.equal(otherFingerprint.ok, false);
    assert.ok(otherFingerprint.problems.some((problem) => /fingerprint clientModel/.test(problem)));
  });
});

// ---------------------------------------------------------------------------
// contract references
// ---------------------------------------------------------------------------

describe("performance contract references (read-only)", () => {
  test("the contract declares the SOAK and LONG_FOLLOW scenarios without copying arrival numbers", () => {
    const contract = loadPerformanceContract();
    const { soak, longFollow } = readSoakScenarioContract(contract);
    assert.ok(soak, "SOAK scenario must exist in the contract");
    assert.ok(longFollow, "LONG_FOLLOW scenario must exist in the contract");
    assert.equal(soak.identityCount, 50);
    assert.equal(soak.windows.count, 12);
    assert.equal(soak.windows.seconds, 150);
    assert.equal(soak.windows.minEffectiveSeconds, SOAK_MIN_EFFECTIVE_SECONDS);
    assert.equal(soak.arrivalModelRef, "scale-baseline:section-1.1/mcp-perf");
    assert.equal(longFollow.minTotalTurns, 21);
    assert.equal(longFollow.minFollowUpTurns, 20);
    assert.equal(longFollow.sameProcessAndSession, true);
    assert.equal(soak.drainMs, 120_000);
  });

  test("the contract does not inline the arrival-model parameters", () => {
    const contract = loadPerformanceContract();
    const soak = readSoakScenarioContract(contract).soak;
    assert.equal(soak.muSeconds, undefined);
    assert.equal(soak.sigmaSeconds, undefined);
    assert.equal(soak.seed, undefined);
  });

  test("the agent budgets used by the window judge are the Spec §5.2 values", () => {
    assert.equal(ABSOLUTE_BUDGETS.agent.simple.warmP95Ms, 30_000);
    assert.equal(ABSOLUTE_BUDGETS.agent.complex.warmP95Ms, 60_000);
    assert.equal(MIN_CHAINS, 5);
  });
});
