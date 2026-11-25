/**
 * P1-78 Task 3 — deterministic Public MCP performance runner tests.
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D2 dual lane, D3 full denominator, D4 timing, D5 scenario isolation,
 *    D11 trigger tiers, D15 fail closed, D16 legal control, §4.2 timing,
 *    §4.3 attempt fields, §5.3 concurrency, §6.1 evidence layout)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 3
 *
 * Everything runs offline: the MCP transport and the monotonic clock are
 * injected. No real Public MCP connection, no Docker, no performance run.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  ATTEMPT_REQUIRED_FIELDS,
  buildAttemptRecord,
  checkOracleAgainstResult,
  createInFlightTracker,
  createPerformanceMcpClient,
  runMcpPerformanceJourney,
  summarizeRoleFairness
} from "../lib/mcp-inquiry-performance-client.mjs";
import {
  FORBIDDEN_FLAGS,
  NOT_WIRED_TRIGGERS,
  TRIGGER_DISPATCH,
  USAGE,
  buildSoakLanePlan,
  formatDryRunReport,
  parseCli,
  resolveScenarioPlan,
  runDryRun,
  runMcpInquiryPerformance,
  selectScenarios,
  validateAttemptRecord,
  writeAttemptsNdjson
} from "../run-mcp-inquiry-performance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const CONTRACT_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-inquiry-performance.yaml");
const QUESTION_BANK_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-upgrade-journeys.yaml");
const RUNNER_PATH = path.join(REPO_ROOT, "scripts/e2e/run-mcp-inquiry-performance.mjs");

const ALL_TOOLS = [
  "lucy_catalog",
  "lucy_query",
  "lucy_begin_question",
  "lucy_continue_question"
];
const NO_QUERY_TOOLS = ["lucy_catalog", "lucy_begin_question"];

const CORRECT_PAYLOAD = {
  measures: [
    { name: "superstore_orders.order_count", value: 1000 },
    { name: "superstore_orders.total_sales", value: 1459476.0953 }
  ],
  rows: [{ order_count: 1000, total_sales: 1459476.0953 }]
};
const WRONG_PAYLOAD = {
  measures: [
    { name: "superstore_orders.order_count", value: 999 },
    { name: "superstore_orders.total_sales", value: 1 }
  ],
  rows: [{ order_count: 999, total_sales: 1 }]
};
const EXACT_ORACLE = {
  kind: "exact",
  ref: "baseline:demo-mysql.superstore_orders.gold",
  expect: { order_count: 1000, total_sales: 1459476.0953 }
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeClock(start = 0) {
  const state = { t: start };
  return {
    now: () => state.t,
    advance(ms) {
      state.t += ms;
    }
  };
}

function jsonResponse(status, body, headers = {}) {
  const text = body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    async text() {
      return text;
    },
    async json() {
      return JSON.parse(text);
    }
  };
}

/**
 * Fake Public MCP surface. The behaviour is selected by the bearer token so a
 * denial identity (no lucy_query) and a legal control identity can live in the
 * same run.
 */
function makeFakeMcp({
  clock,
  latencyMs = 5,
  profiles = {},
  defaultProfile = { tools: ALL_TOOLS, payload: CORRECT_PAYLOAD }
} = {}) {
  const queryCalls = new Map();
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const auth = String(init?.headers?.authorization ?? "");
    const match = Object.entries(profiles).find(([token]) => auth.includes(token));
    const profile = match ? match[1] : defaultProfile;
    if (latencyMs) clock.advance(latencyMs);
    if (body.method === "notifications/initialized") {
      return jsonResponse(202, "");
    }
    if (body.method === "initialize") {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "lucy-fake" }
        }
      });
    }
    if (body.method === "tools/list") {
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: (profile.tools ?? ALL_TOOLS).map((name) => ({ name })) }
      });
    }
    if (body.method === "tools/call") {
      const name = body.params?.name;
      if (name === "lucy_query") {
        const count = (queryCalls.get(auth) ?? 0) + 1;
        queryCalls.set(auth, count);
        if (profile.failFirstQueries && count <= profile.failFirstQueries) {
          throw new Error("simulated transport failure");
        }
        if (profile.queryError) {
          return jsonResponse(200, {
            jsonrpc: "2.0",
            id: body.id,
            result: {
              isError: true,
              content: [{ type: "text", text: JSON.stringify(profile.queryError) }]
            }
          });
        }
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify(profile.payload ?? CORRECT_PAYLOAD) }] }
        });
      }
      if (name === "lucy_catalog") {
        return jsonResponse(200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ sources: ["superstore_orders"] }) }] }
        });
      }
      return jsonResponse(200, {
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] }
      });
    }
    return jsonResponse(404, {
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "method not found" }
    });
  };
  return { fetchImpl };
}

function tmpDir(prefix = "mip-test-") {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function runJourney(overrides = {}) {
  const clock = overrides.clock ?? makeClock();
  const fake = overrides.fake ?? makeFakeMcp({ clock, latencyMs: 5 });
  const client = createPerformanceMcpClient({
    baseUrl: "http://fake.local/mcp",
    token: overrides.token ?? "token",
    fetchImpl: overrides.fetchImpl ?? fake.fetchImpl,
    now: clock.now
  });
  const journey = await runMcpPerformanceJourney({
    client,
    scenario: { scenarioId: "SIMPLE_WARM", questionRef: "QB-BIZ-01" },
    control: {
      begin: "查询 superstore_orders 订单数与销售总额",
      query: { connectionId: "demo-mysql", measures: ["superstore_orders.order_count"] }
    },
    oracle: EXACT_ORACLE,
    expectedOutcome: "allow",
    ...overrides.journey
  });
  return { journey, client, clock };
}

// ---------------------------------------------------------------------------
// journey
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — deterministic Public MCP journey", () => {
  test("runs initialize → notifications/initialized → tools/list → catalog → begin → query → continue in order", async () => {
    const { journey } = await runJourney();
    assert.deepEqual(
      journey.stages.map((s) => s.stage),
      [
        "initialize",
        "notifications_initialized",
        "tools_list",
        "catalog",
        "begin",
        "query",
        "continue"
      ]
    );
    // `continue` is optional and must say why it did not run.
    assert.equal(journey.stages[6].skipped, true);
    assert.equal(journey.stages[6].reason, "not_required");
    assert.equal(journey.outcome, "correct");
    assert.equal(journey.correctness, "correct");
    assert.ok(journey.firstCorrectResultMs <= journey.mcpJourneyMs);
  });

  test("attributes every stage duration and keeps the unattributed remainder", async () => {
    const { journey } = await runJourney();
    const observed = journey.stages
      .filter((s) => !s.skipped)
      .reduce((sum, s) => sum + s.durationMs, 0);
    assert.ok(observed > 0, "stages must carry a duration");
    assert.equal(journey.unattributedMs, journey.mcpJourneyMs - observed);
    assert.ok(journey.unattributedMs >= 0);
    for (const stage of journey.stages) {
      assert.equal(stage.durationMs, stage.endedAtMs - stage.startedAtMs);
    }
  });

  test("records the notification as a protocol receipt and never invents an RTT", async () => {
    const { journey } = await runJourney();
    const notification = journey.mcpCalls.find((c) => c.notification);
    assert.ok(notification, "the notification must be recorded");
    assert.equal(notification.method, "notifications/initialized");
    assert.equal(notification.mcpClientRttMs, null);
    assert.equal(notification.rttMeasured, false);
    assert.equal(notification.notificationReceipt.acknowledged, true);
    assert.equal(notification.notificationReceipt.bodyAbsent, true);
    // The handshake itself does carry a real RTT.
    const initialize = journey.mcpCalls.find((c) => c.method === "initialize");
    assert.equal(typeof initialize.mcpClientRttMs, "number");
    assert.ok(initialize.mcpClientRttMs > 0);
  });

  test("skips begin — with a reason — when tools/list does not expose it", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      defaultProfile: { tools: ["lucy_query"], payload: CORRECT_PAYLOAD }
    });
    const { journey } = await runJourney({ clock, fake });
    const begin = journey.stages.find((s) => s.stage === "begin");
    assert.equal(begin.skipped, true);
    assert.equal(begin.reason, "begin_not_visible");
    assert.equal(
      journey.mcpCalls.some((c) => c.tool === "lucy_begin_question"),
      false,
      "no fabricated begin call"
    );
  });

  test("a missing query tool is recorded as a denial and stays in the denominator", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      defaultProfile: { tools: NO_QUERY_TOOLS, payload: CORRECT_PAYLOAD }
    });
    const { journey } = await runJourney({
      clock,
      fake,
      journey: { expectedOutcome: "deny" }
    });
    assert.equal(journey.outcome, "denied");
    assert.equal(journey.errorClass, "tool_forbidden");
    assert.equal(journey.correctness, "correct");
    const query = journey.stages.find((s) => s.stage === "query");
    assert.equal(query.skipped, true);
    assert.equal(query.reason, "query_tool_not_visible");
    assert.equal(
      journey.mcpCalls.some((c) => c.tool === "lucy_query"),
      false,
      "no fabricated query call"
    );
  });

  test("a wrong answer never passes and an undecidable oracle stays unverified", async () => {
    const wrong = checkOracleAgainstResult({ oracle: EXACT_ORACLE, payload: WRONG_PAYLOAD });
    assert.equal(wrong.status, "mismatched");

    const undecidable = checkOracleAgainstResult({
      oracle: { kind: "independent-query", ref: "sql:demo-mysql.region_order_count_profit_margin" },
      payload: CORRECT_PAYLOAD
    });
    assert.equal(undecidable.status, "not_verifiable");
    assert.ok(undecidable.reason);

    // A partially observable oracle is not a pass either.
    const partial = checkOracleAgainstResult({
      oracle: EXACT_ORACLE,
      payload: { rows: [{ order_count: 1000 }] }
    });
    assert.equal(partial.status, "not_verifiable");
    assert.deepEqual(partial.details.missingKeys, ["total_sales"]);

    const clock = makeClock();
    const fake = makeFakeMcp({ clock, latencyMs: 5, defaultProfile: { tools: ALL_TOOLS, payload: WRONG_PAYLOAD } });
    const { journey } = await runJourney({ clock, fake });
    assert.equal(journey.outcome, "wrong_answer");
    assert.equal(journey.correctness, "incorrect");
    assert.equal(journey.oracle.status, "mismatched");
  });

  test("a timeout keeps the elapsed time and the attempt", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({ clock, latencyMs: 5 });
    const { journey } = await runJourney({
      clock,
      fake,
      journey: { deadlineMs: 1 }
    });
    assert.equal(journey.outcome, "timeout");
    assert.equal(journey.errorClass, "timeout");
    assert.ok(journey.timeoutMs > 0);
    assert.equal(journey.firstCorrectResultMs, null);
  });

  test("a cancellation is recorded and kept", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({ clock, latencyMs: 5 });
    const controller = new AbortController();
    controller.abort();
    const { journey } = await runJourney({
      clock,
      fake,
      journey: { signal: controller.signal }
    });
    assert.equal(journey.outcome, "error");
    assert.equal(journey.errorClass, "cancelled");
    assert.ok(journey.stages.some((s) => s.reason === "cancelled"));
  });
});

// ---------------------------------------------------------------------------
// in-flight receipts
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — in-flight receipts", () => {
  test("recomputes the actual in-flight peak from the entry receipts", async () => {
    const clock = makeClock();
    const tracker = createInFlightTracker({ now: clock.now });
    const fetchImpl = async (url, init) => {
      clock.advance(10);
      return jsonResponse(200, { jsonrpc: "2.0", id: JSON.parse(init.body).id, result: { ok: true } });
    };
    const tracked = tracker.wrapFetch(fetchImpl, { laneId: "lane-a" });
    await Promise.all([
      tracked("http://fake/mcp", { body: "{}" }),
      tracked("http://fake/mcp", { body: "{}" }),
      tracked("http://fake/mcp", { body: "{}" })
    ]);
    const inFlight = tracker.computeInFlight();
    assert.equal(tracker.receipts.length, 3);
    assert.ok(inFlight.peakRequests >= 1);
    for (const receipt of tracker.receipts) {
      assert.ok(receipt.admittedAtMs <= receipt.settledAtMs);
      assert.equal(receipt.outcome, "response");
    }
  });

  test("detects a synchronous burst that never reached the planned in-flight", async () => {
    const clock = makeClock();
    // The transport answers instantly without ever advancing the clock: the
    // requests were "sent" but never observably in flight.
    const fake = makeFakeMcp({ clock, latencyMs: 0 });
    const tracker = createInFlightTracker({ now: clock.now });
    const lanes = 20;
    await Promise.all(
      Array.from({ length: lanes }, async (_unused, index) => {
        const tracked = tracker.wrapFetch(fake.fetchImpl, { laneId: `lane-${index}` });
        await tracked("http://fake/mcp", {
          method: "POST",
          body: JSON.stringify({ jsonrpc: "2.0", id: index, method: "tools/list" })
        });
      })
    );
    const inFlight = tracker.computeInFlight();
    assert.equal(tracker.receipts.length, lanes, "every request produced an admission receipt");
    assert.ok(
      inFlight.peakLanes < lanes,
      `the receipts must show less than ${lanes} lanes in flight (got ${inFlight.peakLanes})`
    );
  });
});

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — CLI contract", () => {
  test("rejects every forbidden flag", () => {
    for (const flag of FORBIDDEN_FLAGS) {
      assert.throws(
        () => parseCli(["--trigger", "pr", `--${flag}`]),
        /forbidden flag/,
        `--${flag} must be rejected`
      );
    }
    // No rename may smuggle a bypass in.
    for (const flag of ["--skip-everything", "--allow-anything", "--accept-it", "--ignore-errors", "--force-pass"]) {
      assert.throws(() => parseCli(["--trigger", "pr", flag]), /forbidden flag/);
    }
  });

  test("names the forbidden flags in the help text", () => {
    for (const flag of FORBIDDEN_FLAGS) {
      assert.ok(USAGE.includes(`--${flag}`), `the help text must name --${flag}`);
    }
    assert.match(USAGE, /--dry-run/);
    assert.match(USAGE, /--trigger/);
    assert.match(USAGE, /--scenario/);
    assert.match(USAGE, /--baseline/);
    assert.match(USAGE, /--evidence-dir/);
  });

  test("refuses the not-yet-wired soak / long_follow triggers but keeps the dispatch table open", () => {
    for (const trigger of NOT_WIRED_TRIGGERS) {
      assert.throws(() => parseCli(["--trigger", trigger]), /not wired yet/);
    }
    for (const trigger of ["pr", "nightly", "release", "upgrade-pre", "upgrade-post", "optimization-ab"]) {
      assert.ok(TRIGGER_DISPATCH[trigger], `${trigger} must be wired`);
      const parsed = parseCli(["--trigger", trigger]);
      assert.equal(parsed.options.trigger, trigger);
    }
  });
});

// ---------------------------------------------------------------------------
// SOAK / LONG_FOLLOW trigger tiers (Plan Task 8)
// ---------------------------------------------------------------------------

describe("P1-78 Task 8 — SOAK / LONG_FOLLOW trigger tiers", () => {
  const contract = parse(readFileSync(CONTRACT_PATH, "utf8"));
  const soakScenario = contract.scenarios.find((s) => s.scenarioId === "SOAK");
  const longFollowScenario = contract.scenarios.find((s) => s.scenarioId === "LONG_FOLLOW");

  test("both trigger tiers are wired into the dispatch table with their own lane", () => {
    for (const trigger of ["soak", "long_follow"]) {
      assert.ok(TRIGGER_DISPATCH[trigger], `${trigger} must be wired`);
      assert.equal(TRIGGER_DISPATCH[trigger].tier, "formal");
      assert.equal(TRIGGER_DISPATCH[trigger].requiresBaseline, false);
      const parsed = parseCli(["--trigger", trigger]);
      assert.equal(parsed.options.trigger, trigger);
    }
    assert.deepEqual(TRIGGER_DISPATCH.soak.families, ["soak"]);
    assert.deepEqual(TRIGGER_DISPATCH.long_follow.families, ["long-follow"]);
    assert.equal(TRIGGER_DISPATCH.soak.lane, "soak");
    assert.equal(TRIGGER_DISPATCH.long_follow.lane, "long-follow");
    assert.equal(NOT_WIRED_TRIGGERS.length, 0, "every trigger of the table is wired");
  });

  test("the MCP lane never picks up the SOAK / LONG_FOLLOW scenarios", () => {
    const selection = selectScenarios({ contract, trigger: "nightly" });
    assert.ok(selection.problems.length === 0, selection.problems.join("; "));
    for (const scenario of selection.scenarios) {
      assert.ok(!["soak", "long-follow"].includes(scenario.family), scenario.scenarioId);
    }
    const forced = selectScenarios({ contract, trigger: "nightly", requested: ["SOAK"] });
    assert.equal(forced.scenarios.length, 0);
    assert.ok(forced.problems.some((p) => /SOAK/.test(p)));
  });

  test("the soak trigger selects the SOAK scenario and the long_follow trigger the LONG_FOLLOW one", () => {
    const soakSelection = selectScenarios({ contract, trigger: "soak" });
    assert.deepEqual(soakSelection.problems, []);
    assert.deepEqual(soakSelection.scenarios.map((s) => s.scenarioId), ["SOAK"]);
    const longSelection = selectScenarios({ contract, trigger: "long_follow" });
    assert.deepEqual(longSelection.problems, []);
    assert.deepEqual(longSelection.scenarios.map((s) => s.scenarioId), ["LONG_FOLLOW"]);
  });

  test("the soak trigger reads the arrival model from scale-baseline §1.1 and the windows from the contract", () => {
    const plan = buildSoakLanePlan({ scenario: soakScenario, contract });
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.arrival.muSeconds, 60);
    assert.equal(plan.arrival.sigmaSeconds, 20);
    assert.equal(plan.arrival.clipMinSeconds, 20);
    assert.equal(plan.arrival.clipMaxSeconds, 120);
    assert.equal(plan.arrival.seed, 20261124);
    assert.deepEqual(plan.plan.windows, { count: 12, seconds: 150 });
    assert.equal(plan.plan.identityCount, 50);
    assert.equal(plan.plan.minEffectiveSeconds, 1800);
  });

  test("the soak trigger dispatches to the SOAK orchestration with the contract parameters", async () => {
    const calls = [];
    const result = await runMcpInquiryPerformance(
      { trigger: "soak", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      {
        now: () => 0,
        runId: "run-soak-1",
        runSoakScenario: async (options) => {
          calls.push(options);
          return { scenarioId: "SOAK", verdict: "PASS", reasons: [], turns: [], windowRecords: [] };
        }
      }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].arrival.muSeconds, 60);
    assert.deepEqual(calls[0].windows, { count: 12, seconds: 150 });
    assert.equal(calls[0].requiredIdentityCount, 50);
    assert.equal(calls[0].minEffectiveSeconds, 1800);
    assert.equal(calls[0].drainMs, 120_000);
    assert.equal(calls[0].runId, "run-soak-1");
    // A lane run without an accepted baseline comparison is never release evidence.
    assert.equal(result.status, "SEED_ONLY");
    assert.equal(result.releaseReady ?? false, false);
  });

  test("the soak trigger fails closed when the host identities are missing", async () => {
    const result = await runMcpInquiryPerformance(
      { trigger: "soak", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      { now: () => 0, runId: "run-soak-2" }
    );
    assert.equal(result.status, "BLOCKED");
    assert.notEqual(result.status, "FAIL");
    assert.ok(result.reasons.some((r) => /identities/i.test(r)));
  });

  test("the whole soak lane runs offline with an injected clock, session factory and turn executor", async () => {
    const roleClasses = ["read_only", "lucy_admin", "restricted_A", "restricted_B"];
    const identities = Array.from({ length: 50 }, (_unused, index) => ({
      identityId: `agent-${String(index + 1).padStart(3, "0")}`,
      roleClass: roleClasses[index % roleClasses.length]
    }));
    const sessionFactory = async (identityId) => ({
      processId: `proc-${identityId}`,
      hostSessionId: `session-${identityId}`,
      supportsMultiTurn: true
    });
    const turnExecutor = async () => ({ outcome: "correct", wallClockMs: 1_000 });
    const result = await runMcpInquiryPerformance(
      { trigger: "soak", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      {
        now: () => 0,
        runId: "run-soak-3",
        identities,
        sessionFactory,
        turnExecutor,
        clock: { now: () => 0 }
      }
    );
    assert.equal(result.soak.verdict, "PASS", result.reasons.join("; "));
    assert.equal(result.soak.effectiveWindowSeconds, 1800);
    assert.equal(result.soak.identityCount, 50);
    assert.equal(result.soak.dispatchedCount, result.soak.offeredCount);
    assert.equal(result.soak.undispatchedCount, 0);
    assert.equal(result.soak.unfinishedCount, 0);
    assert.ok(result.soak.windowRecords.length === 12);
    // The lane never turns into release evidence on its own.
    assert.equal(result.status, "SEED_ONLY");
  });

  test("the long_follow trigger dispatches to the LONG_FOLLOW orchestration with the frozen pack digest", async () => {
    const calls = [];
    const chains = Array.from({ length: 5 }, (_unused, index) => ({
      chainId: `QB-LONG-0${index + 1}×agent-${index + 1}×run-lf-1`,
      templateId: `QB-LONG-0${index + 1}`,
      identityId: `agent-${index + 1}`,
      runId: "run-lf-1",
      packDigest: longFollowScenario.packDigest,
      processId: `proc-${index + 1}`,
      hostSessionId: `session-${index + 1}`,
      turns: Array.from({ length: 21 }, (_turn, turnIndex) => ({
        turnIndex,
        outcome: "correct",
        wallClockMs: 1_000,
        budgetClass: "simple",
        cacheState: "warm"
      }))
    }));
    const result = await runMcpInquiryPerformance(
      { trigger: "long_follow", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      {
        now: () => 0,
        runId: "run-lf-1",
        runLongFollowScenario: async (options) => {
          calls.push(options);
          return { scenarioId: "LONG_FOLLOW", verdict: "PASS", reasons: [], chains, plannedChainCount: 50 };
        }
      }
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expectedPackDigest, longFollowScenario.packDigest);
    assert.match(calls[0].packPath, /mcp-inquiry-long-followups\.yaml$/);
    assert.equal(calls[0].runId, "run-lf-1");
    // A lane run without an accepted baseline comparison is never release evidence.
    assert.equal(result.status, "SEED_ONLY");
  });

  test("the long_follow trigger is BLOCKED when the question pack is unavailable", async () => {
    const result = await runMcpInquiryPerformance(
      { trigger: "long_follow", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      {
        now: () => 0,
        runId: "run-lf-2",
        packPath: "scripts/e2e/contracts/mcp-inquiry-long-followups.absent.yaml"
      }
    );
    assert.equal(result.status, "BLOCKED");
    assert.notEqual(result.status, "FAIL");
    assert.notEqual(result.status, "PASS");
    assert.ok(result.reasons.some((r) => /question_pack_missing/.test(r)));
  });

  test("the long_follow trigger is BLOCKED when the pack digest does not match", async () => {
    const result = await runMcpInquiryPerformance(
      { trigger: "long_follow", contractPath: CONTRACT_PATH, questionBankPath: QUESTION_BANK_PATH, scenarioIds: [] },
      {
        now: () => 0,
        runId: "run-lf-3",
        expectedPackDigest: `sha256:${"0".repeat(64)}`
      }
    );
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.reasons.some((r) => /question_pack_digest_mismatch/.test(r)));
  });

  test("the dry run of both trigger tiers reports NOT RUN and writes nothing", () => {
    for (const trigger of ["soak", "long_follow"]) {
      const dir = tmpDir();
      const evidenceDir = path.join(dir, "evidence");
      const report = runDryRun({
        trigger,
        scenarioIds: [],
        evidenceDir,
        contractPath: CONTRACT_PATH,
        questionBankPath: QUESTION_BANK_PATH,
        baselinePath: null,
        tokenEnv: {}
      });
      assert.equal(report.status, "NOT RUN", trigger);
      assert.equal(report.evidenceWritten, false);
      assert.equal(report.baselineWritten, false);
      const text = formatDryRunReport(report);
      assert.match(text, /NOT RUN/);
      assert.ok(!text.includes("PASS"), `the ${trigger} dry run must never claim a pass`);
      assert.ok(!existsSync(evidenceDir), `the ${trigger} dry run must not write evidence`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the CLI dry run of both trigger tiers prints NOT RUN and creates no evidence", () => {
    for (const trigger of ["soak", "long_follow"]) {
      const dir = tmpDir();
      const evidenceDir = path.join(dir, "evidence");
      let stdout = "";
      let status = 0;
      try {
        stdout = execFileSync(
          process.execPath,
          [RUNNER_PATH, "--trigger", trigger, "--evidence-dir", evidenceDir, "--dry-run"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
      } catch (error) {
        stdout = String(error.stdout ?? "");
        status = error.status ?? 1;
      }
      assert.match(stdout, /NOT RUN/);
      assert.ok(!stdout.includes("PASS"), `the ${trigger} dry run must never claim a pass`);
      assert.notEqual(status, 0, "a dry run is not a success signal");
      assert.ok(!existsSync(evidenceDir), `the ${trigger} dry run must not write evidence`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the dry run of the long_follow tier reports the frozen pack digest and the referenced chains", () => {
    const report = runDryRun({
      trigger: "long_follow",
      scenarioIds: [],
      evidenceDir: path.join(tmpDir(), "evidence"),
      contractPath: CONTRACT_PATH,
      questionBankPath: QUESTION_BANK_PATH,
      baselinePath: null,
      tokenEnv: {}
    });
    assert.deepEqual(report.problems, []);
    const plan = report.scenarios[0];
    assert.equal(plan.kind, "long-follow");
    assert.equal(plan.packDigest, longFollowScenario.packDigest);
    assert.deepEqual(plan.requiredChainIds, ["QB-LONG-01", "QB-LONG-02", "QB-LONG-03"]);
    assert.equal(plan.chainCount, 5);
    assert.equal(plan.minTotalTurns, 21);
    assert.equal(plan.chainInstanceRatio, 0.1);
  });
});

// ---------------------------------------------------------------------------
// dry run
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — dry run", () => {
  test("reports NOT RUN, writes nothing and never claims a result", () => {
    const dir = tmpDir();
    const evidenceDir = path.join(dir, "evidence");
    const report = runDryRun({
      trigger: "pr",
      scenarioIds: ["SIMPLE_WARM"],
      evidenceDir,
      contractPath: CONTRACT_PATH,
      questionBankPath: QUESTION_BANK_PATH,
      baselinePath: null,
      tokenEnv: {}
    });
    assert.equal(report.status, "NOT RUN");
    assert.equal(report.evidenceWritten, false);
    assert.equal(report.baselineWritten, false);
    const text = formatDryRunReport(report);
    assert.match(text, /NOT RUN/);
    assert.ok(!text.includes("PASS"), "a dry run must never claim a pass");
    assert.ok(!existsSync(evidenceDir), "a dry run must not write evidence");
    rmSync(dir, { recursive: true, force: true });
  });

  test("the CLI dry run prints NOT RUN and creates no evidence", () => {
    const dir = tmpDir();
    const evidenceDir = path.join(dir, "evidence");
    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          RUNNER_PATH,
          "--trigger",
          "pr",
          "--scenario",
          "SIMPLE_WARM",
          "--evidence-dir",
          evidenceDir,
          "--dry-run"
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (error) {
      stdout = String(error.stdout ?? "");
      status = error.status ?? 1;
    }
    assert.match(stdout, /NOT RUN/);
    assert.ok(!stdout.includes("PASS"));
    assert.notEqual(status, 0, "a dry run is not a success signal");
    assert.ok(!existsSync(evidenceDir), "the CLI dry run must not write evidence");
    rmSync(dir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// scenario planning
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — scenario planning", () => {
  test("the PR trigger selects the minimal matrix and never the SOAK lane", () => {
    const contract = { scenarios: [
      { scenarioId: "SIMPLE_WARM", family: "simple-single-table" },
      { scenarioId: "JOIN_WARM", family: "multi-table-join" },
      { scenarioId: "DENIAL_NO_QUERY_WARM", family: "denial-with-legal-control" },
      { scenarioId: "WIDE_SIMPLE", family: "wide-catalog" },
      { scenarioId: "SOAK", family: "soak" }
    ] };
    const selection = selectScenarios({ contract, trigger: "pr" });
    const ids = selection.scenarios.map((s) => s.scenarioId);
    assert.ok(ids.includes("SIMPLE_WARM"));
    assert.ok(ids.includes("JOIN_WARM"));
    assert.ok(ids.includes("DENIAL_NO_QUERY_WARM"));
    assert.ok(!ids.includes("WIDE_SIMPLE"), "wide catalog is not part of the PR matrix");
    assert.ok(!ids.includes("SOAK"), "SOAK belongs to the not-yet-wired lane");
  });

  test("a denial scenario resolves its legal control from the question bank", () => {
    const contract = { scenarios: [] };
    const questionBank = {
      cases: [
        {
          id: "QB-ACL-01",
          budgetClass: "denial",
          oracle: { kind: "deny", ref: "deny:tool-forbidden-paired-allow" },
          identities: [
            { id: "deny_no_query", role: "compat_fixture_no_lucy_query", tokenRef: "env:COMPAT_TOKEN_NO_QUERY", expect: { outcome: "deny" } },
            { id: "allow_readonly", role: "demo_readonly", tokenRef: "env:COMPAT_TOKEN_READONLY", expect: { outcome: "allow" } }
          ],
          mcpControls: [
            { identity: "deny_no_query", query: { connectionId: "demo-mysql" } },
            { identity: "allow_readonly", query: { connectionId: "demo-mysql" } }
          ]
        },
        {
          id: "QB-BIZ-01",
          budgetClass: "simple-metric",
          oracle: { kind: "exact", ref: "baseline:demo-mysql.superstore_orders.gold", expect: { order_count: 1000 } },
          identities: [
            { id: "allow_readonly", role: "demo_readonly", tokenRef: "env:COMPAT_TOKEN_READONLY", expect: { outcome: "allow" } }
          ],
          mcpControls: [{ identity: "allow_readonly", query: { connectionId: "demo-mysql" } }]
        }
      ]
    };
    const plan = resolveScenarioPlan({
      scenario: {
        scenarioId: "DENIAL_NO_QUERY_WARM",
        questionRef: "QB-ACL-01",
        oracleRef: "deny:tool-forbidden-paired-allow",
        legalControlRef: "QB-BIZ-01",
        budgetClass: "denial",
        ownerBudgetClass: "denial",
        cacheState: "warm",
        concurrencyGroup: "single"
      },
      questionBank
    });
    assert.deepEqual(plan.problems, []);
    assert.equal(plan.expectedOutcome, "deny");
    assert.equal(plan.identityId, "deny_no_query");
    assert.equal(plan.legalControl.caseId, "QB-BIZ-01");
    assert.equal(plan.legalControl.expectedOutcome, "allow");
    assert.equal(plan.legalControl.scenarioId, "DENIAL_NO_QUERY_WARM__legal_control__QB-BIZ-01");
  });

  test("a missing question reference blocks instead of inventing a question", () => {
    const plan = resolveScenarioPlan({
      scenario: {
        scenarioId: "SIMPLE_WARM",
        questionRef: "QB-DOES-NOT-EXIST",
        oracleRef: "baseline:x",
        budgetClass: "simple",
        ownerBudgetClass: "simple-metric",
        cacheState: "warm",
        concurrencyGroup: "single"
      },
      questionBank: { cases: [] }
    });
    assert.ok(plan.problems.some((p) => /not in the question bank/.test(p)));
  });
});

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — execution", () => {
  const baseOptions = {
    trigger: "pr",
    mcpUrl: "http://fake.local/mcp",
    evidenceDir: "/tmp/mip-not-used",
    contractPath: CONTRACT_PATH,
    questionBankPath: QUESTION_BANK_PATH,
    tokenEnv: {
      COMPAT_TOKEN_READONLY: "readonly-token",
      COMPAT_TOKEN_NO_QUERY: "noquery-token"
    },
    clientFingerprint: "test-client",
    modelFingerprint: "test-model"
  };

  test("runs the denial scenario together with its legal control in the same window", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      profiles: {
        "noquery-token": { tools: NO_QUERY_TOOLS },
        "readonly-token": { tools: ALL_TOOLS, payload: CORRECT_PAYLOAD }
      }
    });
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["DENIAL_NO_QUERY_WARM"] },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-denial", sampleCountOverride: 4 }
    );
    const denials = result.attempts.filter((a) => a.scenarioId === "DENIAL_NO_QUERY_WARM");
    const controls = result.attempts.filter((a) => a.scenarioId.includes("__legal_control__"));
    assert.equal(denials.length, 4);
    assert.equal(controls.length, 4);
    for (const denial of denials) {
      assert.equal(denial.outcome, "denied");
      assert.equal(denial.errorClass, "tool_forbidden");
      assert.ok(denial.legalControlAttemptId, "the denial must point at its paired control");
      const control = controls.find((c) => c.attemptId === denial.legalControlAttemptId);
      assert.ok(control, "the paired control attempt must exist");
      assert.equal(control.pairedDenialAttemptId, denial.attemptId);
      assert.equal(control.outcome, "correct");
      assert.equal(control.expectedOutcome, "allow");
    }
  });

  test("fails the denial scenario when the legal control does not deal (D16)", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      profiles: {
        "noquery-token": { tools: NO_QUERY_TOOLS },
        "readonly-token": { tools: ALL_TOOLS, payload: WRONG_PAYLOAD }
      }
    });
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["DENIAL_NO_QUERY_WARM"] },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-d16", sampleCountOverride: 4 }
    );
    const denialEntry = result.verdict.perScenario.DENIAL_NO_QUERY_WARM;
    assert.equal(denialEntry.verdict, "FAIL");
    assert.ok(
      denialEntry.reasons.some((r) => /D16/.test(r)),
      `the legal control failure must be reported: ${JSON.stringify(denialEntry.reasons)}`
    );
  });

  test("errors, timeouts and retries all stay in the denominator", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      profiles: {
        "readonly-token": { tools: ALL_TOOLS, payload: CORRECT_PAYLOAD, failFirstQueries: 1 }
      }
    });
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["SIMPLE_WARM"] },
      {
        fetchImpl: fake.fetchImpl,
        now: clock.now,
        runId: "run-retry",
        sampleCountOverride: 2,
        maxRetries: 1
      }
    );
    const attempts = result.attempts.filter((a) => a.scenarioId === "SIMPLE_WARM");
    // Plan item 1: one failed attempt + one successful retry. Plan item 2: one
    // successful attempt. Nothing is dropped.
    assert.equal(attempts.length, 3);
    const failed = attempts.filter((a) => a.outcome === "crash");
    const recovered = attempts.filter((a) => a.outcome === "correct");
    assert.equal(failed.length, 1);
    assert.equal(recovered.length, 2);
    assert.equal(failed[0].errorClass, "transport_error");
    assert.equal(failed[0].firstAttempt, true);
    assert.equal(failed[0].finalAttempt, false);
    assert.equal(failed[0].retryOf, null);
    const retry = recovered.find((a) => a.retryOf === failed[0].attemptId);
    assert.ok(retry, "the retry must reference the attempt it retries");
    assert.equal(retry.firstAttempt, false);
    assert.equal(retry.finalAttempt, true);
    assert.equal(retry.planItemId, failed[0].planItemId);
    // The failed attempt stays in the denominator of its plan item.
    const group = result.groups.find((g) => g.scenarioId === "SIMPLE_WARM");
    assert.equal(group.plannedCount, 2);
    assert.equal(group.attempts.length, 3);
    assert.equal(new Set(group.attempts.map((a) => a.planItemId)).size, 2);
  });

  test("a plan item whose retries are exhausted never turns into a pass", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      profiles: {
        "readonly-token": { tools: ALL_TOOLS, payload: CORRECT_PAYLOAD, failFirstQueries: 2 }
      }
    });
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["SIMPLE_WARM"] },
      {
        fetchImpl: fake.fetchImpl,
        now: clock.now,
        runId: "run-retry-exhausted",
        sampleCountOverride: 2,
        maxRetries: 1
      }
    );
    const attempts = result.attempts.filter((a) => a.scenarioId === "SIMPLE_WARM");
    const failed = attempts.filter((a) => a.outcome === "crash");
    assert.equal(failed.length, 2, "the exhausted plan item keeps both failed attempts");
    assert.equal(failed[0].finalAttempt, false);
    assert.equal(failed[1].finalAttempt, true);
    assert.equal(failed[1].retryOf, failed[0].attemptId);
    assert.equal(result.verdict.perScenario.SIMPLE_WARM.verdict, "FAIL");
    assert.notEqual(result.status, "PASS");
  });

  test("the concurrency gate refuses a run that never reached the planned in-flight", async () => {
    const clock = makeClock();
    // Instant answers: the requests are sent but never observably in flight.
    const fake = makeFakeMcp({ clock, latencyMs: 0 });
    const contract = {
      scenarios: [
        {
          scenarioId: "CONCURRENT_C20_SIMPLE",
          family: "concurrent-fairness",
          questionRef: "QB-BIZ-01",
          lane: "agent+mcp",
          budgetClass: "simple",
          ownerBudgetClass: "simple-metric",
          cacheState: "warm",
          concurrencyGroup: "c20",
          waves: 1,
          sampleFloors: { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } },
          oracleRef: "baseline:demo-mysql.superstore_orders.gold"
        }
      ]
    };
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["CONCURRENT_C20_SIMPLE"] },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-c20-burst", contract }
    );
    const report = result.concurrencyReports.find((r) => r.scenarioId === "CONCURRENT_C20_SIMPLE");
    assert.ok(report, "the concurrency report must exist");
    assert.equal(report.plannedLanes, 20);
    assert.ok(report.receiptCount > 0, "the entry receipts must be kept");
    assert.ok(
      report.actualInFlightPeak < 20,
      `the receipts must not prove 20 lanes in flight (got ${report.actualInFlightPeak})`
    );
    assert.equal(report.achieved, false);
    assert.notEqual(result.status, "PASS");
    assert.ok(
      result.reasons.some((r) => /in-flight peak/.test(r)),
      `the concurrency failure must be reported: ${JSON.stringify(result.reasons)}`
    );
  });

  test("the concurrency gate accepts a run whose receipts prove the planned in-flight", async () => {
    const clock = makeClock();
    const fake = makeFakeMcp({ clock, latencyMs: 5 });
    const contract = {
      scenarios: [
        {
          scenarioId: "CONCURRENT_C20_SIMPLE",
          family: "concurrent-fairness",
          questionRef: "QB-BIZ-01",
          lane: "agent+mcp",
          budgetClass: "simple",
          ownerBudgetClass: "simple-metric",
          cacheState: "warm",
          concurrencyGroup: "c20",
          waves: 1,
          sampleFloors: { pr: { mcp: 20, agent: 3 }, formal: { mcp: 100, agent: 20 } },
          oracleRef: "baseline:demo-mysql.superstore_orders.gold"
        }
      ]
    };
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["CONCURRENT_C20_SIMPLE"] },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-c20-real", contract }
    );
    const report = result.concurrencyReports.find((r) => r.scenarioId === "CONCURRENT_C20_SIMPLE");
    assert.ok(report.actualInFlightPeak >= 20, `expected 20 lanes in flight, got ${report.actualInFlightPeak}`);
    assert.equal(report.achieved, true);
  });

  test("an accepted baseline is read and the relative gate really runs", async () => {
    const dir = tmpDir();
    const baselinePath = path.join(dir, "baseline.json");
    writeFileSync(
      baselinePath,
      JSON.stringify({
        contract: "lucy-mcp-inquiry-performance-baseline-v1",
        scenarios: [
          {
            scenarioId: "SIMPLE_WARM",
            cacheState: "warm",
            concurrencyGroup: "single",
            budgetClass: "simple",
            sampleCount: 20,
            p50Ms: 120,
            p95Ms: 900,
            p99Ms: "not_estimable",
            medianMs: 120,
            maxMs: 1500,
            evidenceBodyDigest: "sha256:baseline"
          }
        ]
      }),
      "utf8"
    );
    const clock = makeClock();
    const fake = makeFakeMcp({ clock, latencyMs: 5 });
    const result = await runMcpInquiryPerformance(
      { ...baseOptions, scenarioIds: ["SIMPLE_WARM"], baselinePath },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-baseline", sampleCountOverride: 20 }
    );
    const group = result.groups.find((g) => g.scenarioId === "SIMPLE_WARM");
    assert.ok(group.baseline, "the baseline record must reach the judge");
    assert.equal(group.baseline.p95Ms, 900);
    const entry = result.verdict.perScenario.SIMPLE_WARM;
    assert.notEqual(entry.relative.verdict, "SEED_ONLY", "the relative gate must really run");
    assert.ok(entry.relative.deltas, "the relative deltas must be computed");
    rmSync(dir, { recursive: true, force: true });
  });

  test("role fairness is summarized per role group", () => {
    const attempts = [
      { roleCategory: "demo_readonly", journeyMs: 100 },
      { roleCategory: "demo_readonly", journeyMs: 120 },
      { roleCategory: "demo_ops", journeyMs: 130 }
    ];
    const fairness = summarizeRoleFairness(attempts);
    assert.equal(fairness.groups.length, 2);
    assert.equal(fairness.fair, true);
  });
});

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

describe("P1-78 Task 3 — evidence contract", () => {
  test("attempts.ndjson matches the coordination contract", async () => {
    const dir = tmpDir();
    const clock = makeClock();
    const fake = makeFakeMcp({
      clock,
      latencyMs: 5,
      profiles: {
        "noquery-token": { tools: NO_QUERY_TOOLS },
        "readonly-token": { tools: ALL_TOOLS, payload: CORRECT_PAYLOAD }
      }
    });
    const result = await runMcpInquiryPerformance(
      {
        trigger: "pr",
        scenarioIds: ["DENIAL_NO_QUERY_WARM"],
        mcpUrl: "http://fake.local/mcp",
        evidenceDir: dir,
        contractPath: CONTRACT_PATH,
        questionBankPath: QUESTION_BANK_PATH,
        tokenEnv: {
          COMPAT_TOKEN_READONLY: "readonly-token",
          COMPAT_TOKEN_NO_QUERY: "noquery-token"
        },
        clientFingerprint: "test-client",
        modelFingerprint: "test-model"
      },
      { fetchImpl: fake.fetchImpl, now: clock.now, runId: "run-evidence", sampleCountOverride: 3 }
    );
    const written = writeAttemptsNdjson({
      runId: "run-evidence",
      attempts: result.attempts,
      evidenceDir: dir
    });
    assert.ok(existsSync(written.file));
    const lines = readFileSync(written.file, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, result.attempts.length);
    for (const line of lines) {
      const attempt = JSON.parse(line);
      const check = validateAttemptRecord(attempt);
      assert.ok(check.ok, `attempt record invalid: ${JSON.stringify(check.problems)}`);
      for (const field of ATTEMPT_REQUIRED_FIELDS) {
        assert.ok(field in attempt, `the coordination contract requires ${field}`);
      }
      assert.equal(attempt.runId, "run-evidence");
      assert.ok(Array.isArray(attempt.mcpCalls) && attempt.mcpCalls.length > 0);
      assert.ok(Array.isArray(attempt.stages) && attempt.stages.length > 0);
      assert.equal(typeof attempt.unattributedMs, "number");
      assert.ok(attempt.questionSetDigest);
      assert.ok(attempt.configDigest);
      assert.ok(attempt.budgetDigest);
      assert.ok(attempt.fixtureDigest);
      assert.ok(attempt.budgetClass);
      assert.ok(attempt.cacheState);
      assert.ok(attempt.concurrencyGroup);
      assert.ok(attempt.roleClass);
      assert.ok(attempt.clientFingerprint);
      assert.ok(attempt.modelFingerprint);
      assert.ok(attempt.clientModel);
      assert.ok(attempt.environment);
      assert.ok(attempt.environmentFingerprint);
      assert.ok(attempt.lane);
      // Identity fields that may be absent must carry the reason inline.
      for (const field of ["retryOf", "traceId", "rpcRequestId"]) {
        if (attempt[field] == null) {
          assert.ok(
            attempt[`${field}MissingReason`],
            `${field} is null without a missing reason`
          );
        }
      }
      assert.ok("correctness" in attempt);
      assert.ok("errorClass" in attempt);
      assert.ok("timeoutMs" in attempt);
      assert.equal(typeof attempt.firstAttempt, "boolean");
      assert.equal(typeof attempt.finalAttempt, "boolean");
      assert.ok(Array.isArray(attempt.concurrency.receipts));
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test("an attempt record states why an absent field is absent", () => {
    const record = buildAttemptRecord({
      runId: "run-x",
      scenario: { scenarioId: "SIMPLE_WARM", questionRef: "QB-BIZ-01", budgetClass: "simple" },
      attemptId: "attempt-1",
      journey: { outcome: "correct", correctness: "correct", stages: [], mcpCalls: [] }
    });
    assert.equal(record.retryOf, null);
    assert.equal(record.retryOfMissingReason, "first attempt of the plan item");
    assert.equal(record.traceId, null);
    assert.equal(record.traceIdMissingReason, "server audit trace id not exposed");
    assert.equal(record.rpcRequestId, null);
    assert.equal(record.rpcRequestIdMissingReason, "no decisive rpc call recorded");
    assert.ok(record.missingReasons);
  });
});
