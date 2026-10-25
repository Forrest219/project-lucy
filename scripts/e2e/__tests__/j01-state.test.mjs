// Contract tests for the J25-01 run-scoped journey / stage state
// (lib/j01-state.mjs) and the three anti-cheat assertions (approved Spec
// §4.1-4, §4.2, §4.3).
//
// These are the locally verifiable half of W1: they prove the handover rules,
// the failure-stop rules, the secret rules and the three anti-cheat assertions
// as PURE functions. They do NOT prove that the browser journey or the real
// Agent ran — that evidence only exists in a prepared run.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ANTI_CHEAT_ASSERTION_IDS,
  ANTI_CHEAT_ASSERTIONS,
  FIELD_PRODUCERS,
  HANDOVER_FIELDS,
  STAGE_IDS,
  applyStageHandover,
  assertAgentOwnedCalls,
  assertNoGoldLeak,
  assertNoSecretsInState,
  assertPromptUnchanged,
  assertSameRun,
  completeStage,
  createJourneyState,
  evaluateAntiCheat,
  failJourney,
  journeyStatus,
  missingAntiCheatEvidence,
  secretProblemsInState,
  stageContract,
  startStage,
  validateJourneyState
} from "../lib/j01-state.mjs";
import { J01_STAGE_CONTRACT, JOURNEY_ID } from "../lib/mainline-scenarios.mjs";

const IDENTITY = { runId: "run-20261025-a1", instanceId: "inst-01", candidateDigest: "sha256:aaaa1111" };
const OTHER_RUN = { runId: "run-20261025-b2", instanceId: "inst-02", candidateDigest: "sha256:bbbb2222" };

function freshState() {
  return createJourneyState(IDENTITY);
}

/** Drives the first `count` stages to `passed`, handing over their fields. */
function runStages(state, count) {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    const stageId = STAGE_IDS[i];
    current = startStage(current, stageId, IDENTITY);
    const handover = handoverFor(stageId);
    current = completeStage(current, stageId, { status: "passed", evidenceRefs: [`ev-${stageId}`], handover });
  }
  return current;
}

function handoverFor(stageId) {
  switch (stageId) {
    case "J01-02": return { connectionId: "conn-j01" };
    case "J01-03": return { sourceKeys: ["analytics.marketing_daily"] };
    case "J01-05": return { semanticVersion: "sem-7", policyVersion: "pol-3" };
    case "J01-06": return { roleId: "role-j01", agentId: "agent-j01", tokenSecretRef: "secret://run/run-20261025-a1/j01-06/token" };
    case "J01-07": return { questionId: "Q-J25-CAC-28D", clientSessionRef: "sess-01" };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Stage contract (W1-1)
// ---------------------------------------------------------------------------

test("the canonical stage contract is the approved eight stages with the approved names and owners", () => {
  assert.equal(JOURNEY_ID, "J25-01");
  assert.deepEqual([...STAGE_IDS], [
    "J01-01", "J01-02", "J01-03", "J01-04", "J01-05", "J01-06", "J01-07", "J01-08"
  ]);
  const expected = [
    ["J01-01", "登录与准备", "ACCESS"],
    ["J01-02", "新建连接", "CONN"],
    ["J01-03", "启用表与 Manifest", "CONN"],
    ["J01-04", "维护业务上下文", "SEM"],
    ["J01-05", "校验并生效", "SEM"],
    ["J01-06", "新建访问主体", "ACCESS"],
    ["J01-07", "真实 Agent 问答", "AGENT"],
    ["J01-08", "审计与对账", "OBSERVE"]
  ];
  assert.deepEqual(
    J01_STAGE_CONTRACT.map((s) => [s.stageId, s.title, s.owner]),
    expected
  );
  for (const stage of J01_STAGE_CONTRACT) {
    assert.ok(stage.requiredAssertions.length > 0, `${stage.stageId} must declare its required assertions`);
    assert.ok(stage.action.length > 0, `${stage.stageId} must declare its user action`);
    assert.ok(stage.input.length > 0 && stage.output.length > 0, `${stage.stageId} must declare input -> output`);
    assert.ok(stage.excludedFromMainline.length > 0, `${stage.stageId} must record the depth it excludes`);
  }
});

test("every stage depends only on earlier stages", () => {
  J01_STAGE_CONTRACT.forEach((stage, i) => {
    for (const dep of stage.dependsOn) {
      assert.ok(STAGE_IDS.indexOf(dep) < i, `${stage.stageId} depends on ${dep}, which is not earlier`);
    }
  });
});

test("the stage contract matches the frozen v0.25 coverage manifest", async () => {
  const { loadCoverage } = await import("../lib/v025-coverage.mjs");
  const { journeys } = loadCoverage();
  assert.equal(journeys.length, 1);
  const journey = journeys[0];
  assert.deepEqual(
    journey.stages.map((s) => [s.stageId, s.title, s.stageOwnerBranch]),
    J01_STAGE_CONTRACT.map((s) => [s.stageId, s.title, s.owner])
  );
});

// ---------------------------------------------------------------------------
// State shape (W1-2)
// ---------------------------------------------------------------------------

test("the initial state has the approved shape, eight stages and no secrets", () => {
  const state = freshState();
  assert.equal(state.journeyId, "J25-01");
  assert.deepEqual(state.catalogEvidenceIds, ["UX-01-V01", "UX-01-V02", "UX-01-V03"]);
  assert.equal(state.runId, IDENTITY.runId);
  assert.equal(state.instanceId, IDENTITY.instanceId);
  assert.equal(state.candidateDigest, IDENTITY.candidateDigest);
  assert.equal(state.stages.length, 8);
  assert.deepEqual(state.stages.map((s) => s.status), Array(8).fill("not_run"));
  assert.deepEqual(state.stages.map((s) => s.stageId), [...STAGE_IDS]);
  for (const key of ["connectionId", "semanticVersion", "policyVersion", "roleId", "agentId", "tokenSecretRef", "questionId", "clientSessionRef"]) {
    assert.equal(state[key], null, `${key} starts empty`);
  }
  assert.deepEqual(state.sourceKeys, []);
  assert.deepEqual(state.evidenceRefs, []);
  assert.deepEqual(validateJourneyState(state), []);
});

test("the journey is not split into eight execution items", () => {
  const state = freshState();
  assert.equal("executionIds" in state, false);
  for (const stage of state.stages) assert.equal("executionId" in stage, false);
  const broken = { ...state, executionIds: STAGE_IDS.map((id) => `J25-${id}`) };
  assert.ok(validateJourneyState(broken).some((p) => /not split into eight execution items/.test(p)));
  const brokenStage = { ...state, stages: state.stages.map((s, i) => (i === 0 ? { ...s, executionId: "J25-J01-01" } : s)) };
  assert.ok(validateJourneyState(brokenStage).some((p) => /not eight execution items/.test(p)));
});

test("a stage may only consume state produced by an earlier stage of the same run", () => {
  const state = freshState();
  assert.throws(() => startStage(state, "J01-03", IDENTITY), /earlier stage in the same run/);
  const afterTwo = runStages(state, 2);
  assert.throws(() => startStage(afterTwo, "J01-04", IDENTITY), /earlier stage in the same run/);
  assert.doesNotThrow(() => startStage(afterTwo, "J01-03", IDENTITY));
});

test("cross-run state is rejected", () => {
  const state = freshState();
  assert.throws(() => startStage(state, "J01-01", OTHER_RUN), /cross-run state rejected/);
  assert.throws(() => assertSameRun(state, OTHER_RUN), /cross-run state rejected/);
  assert.throws(() => startStage(state, "J01-01", { ...IDENTITY, candidateDigest: "sha256:cccc3333" }), /cross-run state rejected/);
  assert.equal(assertSameRun(state, IDENTITY), true);
});

test("the next stage may not replace the connection / Role / Agent / Token a previous stage produced", () => {
  let state = runStages(freshState(), 6);
  assert.equal(state.connectionId, "conn-j01");
  assert.equal(state.roleId, "role-j01");
  assert.equal(state.agentId, "agent-j01");
  assert.equal(state.tokenSecretRef, "secret://run/run-20261025-a1/j01-06/token");
  // A later stage may not write a field an earlier stage owns — that is the
  // strongest form of "may not replace".
  assert.throws(
    () => applyStageHandover(state, "J01-07", { connectionId: "conn-other" }),
    /field "connectionId" belongs to stage J01-02/
  );
  assert.throws(
    () => applyStageHandover(state, "J01-07", { tokenSecretRef: "secret://run/other/token" }),
    /field "tokenSecretRef" belongs to stage J01-06/
  );
  assert.throws(() => applyStageHandover(state, "J01-07", { roleId: "role-other" }), /belongs to stage J01-06/);
  // Only handover fields may be written at all.
  assert.throws(() => applyStageHandover(state, "J01-07", { password: "x" }), /may not hand over "password"/);
  // The owning stage may re-affirm the SAME value, but never swap it.
  assert.doesNotThrow(() => applyStageHandover(state, "J01-02", { connectionId: "conn-j01" }));
  assert.throws(
    () => applyStageHandover(state, "J01-02", { connectionId: "conn-other" }),
    /may not replace "connectionId"/
  );
});

test("every handover field has exactly one producing stage", () => {
  for (const field of HANDOVER_FIELDS) {
    assert.ok(FIELD_PRODUCERS[field], `${field} must have a producing stage`);
    assert.ok(STAGE_IDS.includes(FIELD_PRODUCERS[field]), `${field} producer ${FIELD_PRODUCERS[field]} is not a stage`);
  }
});

// ---------------------------------------------------------------------------
// Secret rules (W1-2 / Spec §4.3)
// ---------------------------------------------------------------------------

test("a Token plaintext in the state is rejected", () => {
  const state = { ...freshState(), tokenSecretRef: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" };
  const problems = secretProblemsInState(state);
  assert.ok(problems.some((p) => /tokenSecretRef must be a controlled reference/.test(p)), problems.join("; "));
  assert.ok(validateJourneyState(state).some((p) => /tokenSecretRef must be a controlled reference/.test(p)));
});

test("a database password or model credential in the state is rejected", () => {
  const withPassword = { ...freshState(), connectionId: "postgres://lucy:hunter2@db.internal/lucy" };
  assert.ok(secretProblemsInState(withPassword).some((p) => /dsn-with-password/.test(p)));
  const withModelKey = { ...freshState(), semanticVersion: "sem-sk-abcdefghijklmnopqrstuvwx" };
  assert.ok(secretProblemsInState(withModelKey).some((p) => /model-credential/.test(p)));
  const withPasswordField = { ...freshState(), password: "hunter2" };
  assert.ok(secretProblemsInState(withPasswordField).some((p) => /forbidden field "password"/.test(p)));
});

test("a known run secret present anywhere in the state is rejected", () => {
  const token = "3f9a1c7e5b2d8046f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f";
  const state = { ...freshState(), clientSessionRef: token };
  const problems = assertNoSecretsInState(state, { secrets: [token] });
  assert.ok(problems.some((p) => /run secret is present/.test(p)), problems.join("; "));
  const clean = assertNoSecretsInState(freshState(), { secrets: [token] });
  assert.deepEqual(clean, []);
});

test("the digest is not mistaken for a secret", () => {
  const state = { ...freshState(), candidateDigest: "a".repeat(64) };
  assert.deepEqual(secretProblemsInState(state), []);
});

// ---------------------------------------------------------------------------
// 失败即停 (W1-8 / Spec §4.1-5)
// ---------------------------------------------------------------------------

test("a failed stage fails the journey and turns every later stage into not_run referencing the FIRST failure", () => {
  let state = runStages(freshState(), 4);
  state = startStage(state, "J01-05", IDENTITY);
  state = failJourney(state, { stageId: "J01-05", failureRef: "fail://J01-05/validation" });
  assert.equal(journeyStatus(state), "failed");
  assert.equal(state.status, "failed");
  assert.equal(state.failureRef, "fail://J01-05/validation");
  assert.equal(state.stages.find((s) => s.stageId === "J01-05").status, "failed");
  assert.equal(state.stages.find((s) => s.stageId === "J01-05").failureRef, "fail://J01-05/validation");
  for (const later of ["J01-06", "J01-07", "J01-08"]) {
    const stage = state.stages.find((s) => s.stageId === later);
    assert.equal(stage.status, "not_run", `${later} must be not_run`);
    assert.equal(stage.failureRef, "fail://J01-05/validation", `${later} must reference the first failure`);
  }
  for (const earlier of ["J01-01", "J01-02", "J01-03", "J01-04"]) {
    assert.equal(state.stages.find((s) => s.stageId === earlier).status, "passed");
  }
  assert.deepEqual(validateJourneyState(state), []);
});

test("the first failure is the one that is referenced, even if a later failure is recorded", () => {
  let state = runStages(freshState(), 4);
  state = failJourney(state, { stageId: "J01-05", failureRef: "fail://first" });
  state = failJourney(state, { stageId: "J01-06", failureRef: "fail://second" });
  assert.equal(state.failureRef, "fail://first");
  assert.equal(state.stages.find((s) => s.stageId === "J01-08").failureRef, "fail://first");
  assert.equal(state.stages.find((s) => s.stageId === "J01-06").failureRef, "fail://second");
});

test("a state that skips a stage or resumes after a failure is invalid", () => {
  let state = runStages(freshState(), 3);
  const broken = { ...state, stages: state.stages.map((s) => (s.stageId === "J01-02" ? { ...s, status: "not_run" } : s)) };
  assert.ok(validateJourneyState(broken).length > 0);
});

test("a blocked stage blocks the journey and is never a pass", () => {
  let state = runStages(freshState(), 2);
  state = startStage(state, "J01-03", IDENTITY);
  state = completeStage(state, "J01-03", { status: "blocked", evidenceRefs: ["ev-blocked"] });
  assert.equal(journeyStatus(state), "blocked");
  assert.notEqual(journeyStatus(state), "passed");
});

// ---------------------------------------------------------------------------
// Anti-cheat assertion 1 — 防泄露
// ---------------------------------------------------------------------------

const GOLD = {
  question: "最近 28 天的获客成本是多少？默认口径是什么？",
  definition: "SUM(spend_cents)/SUM(new_customers)",
  expected: { type: "money_cents", cents: 123456, currency: "CNY" }
};

test("防泄露: gold in a model-visible surface is a leak", () => {
  const result = assertNoGoldLeak({
    gold: GOLD,
    surfaces: [
      { surface: "agent-prompt", text: "请回答用户问题" },
      { surface: "model-context", text: `参考口径 ${GOLD.definition}` }
    ]
  });
  assert.equal(result.ok, false);
  assert.ok(result.leaks.some((l) => l.surface === "model-context"));
});

test("防泄露: the final answer contains the answer and is NOT a leak", () => {
  const finalAnswer = `最近 28 天的获客成本是 ${(GOLD.expected.cents / 100).toFixed(2)} 元，口径为 SUM(spend_cents)/SUM(new_customers)。`;
  const result = assertNoGoldLeak({
    gold: GOLD,
    surfaces: [{ surface: "agent-prompt", text: "请回答用户问题" }],
    finalAnswer
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.leaks, []);
});

test("防泄露: a surface explicitly marked as the final answer is not scanned", () => {
  const result = assertNoGoldLeak({
    gold: GOLD,
    surfaces: [
      { surface: "agent-prompt", text: "请回答用户问题" },
      { surface: "final-answer", text: `获客成本 ${(GOLD.expected.cents / 100).toFixed(2)} 元` }
    ]
  });
  assert.equal(result.ok, true, result.reason);
});

test("防泄露: scanning nothing proves nothing", () => {
  const result = assertNoGoldLeak({ gold: GOLD, surfaces: [] });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no model-visible surface/);
});

test("防泄露: the gold question itself in a surface that must not carry it is a leak", () => {
  const result = assertNoGoldLeak({ gold: GOLD, surfaces: [{ surface: "wiki", text: GOLD.question }] });
  assert.equal(result.ok, false);
  assert.ok(result.leaks.some((l) => l.kind === "question"));
});

test("防泄露: the surface that legitimately carries the executed question is exempt from the question needle only", () => {
  const result = assertNoGoldLeak({
    gold: GOLD,
    surfaces: [{ surface: "agent-prompt", text: GOLD.question }],
    questionCarriers: ["agent-prompt"]
  });
  assert.equal(result.ok, true, result.reason);
  // The ANSWER needles are still checked in that surface.
  const leaked = assertNoGoldLeak({
    gold: GOLD,
    surfaces: [{ surface: "agent-prompt", text: `${GOLD.question} 答案是 ${(GOLD.expected.cents / 100).toFixed(2)}` }],
    questionCarriers: ["agent-prompt"]
  });
  assert.equal(leaked.ok, false);
  assert.ok(leaked.leaks.some((l) => l.kind === "answer-money"));
});

// ---------------------------------------------------------------------------
// Anti-cheat assertion 2 — 防代答
// ---------------------------------------------------------------------------

const TRANSCRIPT = [
  { role: "user", text: GOLD.question },
  { role: "assistant", tool: "lucy_query", callId: "call-1", input: { measure: "cac", days: 28 } },
  { role: "tool", callId: "call-1", text: "1234.56" }
];
const SERVER_TRACE = [
  { event: "tool_call", callId: "call-1", attempt: 1, runId: IDENTITY.runId, agentId: "agent-j01" }
];

test("防代答: an Agent-initiated tool call correlated by call id passes", () => {
  const result = assertAgentOwnedCalls({ transcript: TRANSCRIPT, serverTrace: SERVER_TRACE });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.agentToolCalls, 1);
});

test("防代答: a transcript without an Agent tool call means the runner answered", () => {
  const result = assertAgentOwnedCalls({
    transcript: [{ role: "user", text: GOLD.question }, { role: "assistant", text: "获客成本 1234.56 元" }],
    serverTrace: SERVER_TRACE
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /no Agent-initiated tool call/);
});

test("防代答: a tool call the server never saw is not correlated", () => {
  const result = assertAgentOwnedCalls({
    transcript: TRANSCRIPT,
    serverTrace: [{ event: "tool_call", callId: "call-other", attempt: 1 }]
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.uncorrelatedCallIds, ["call-1"]);
});

test("防代答: a retry attempt is NOT a 1:1 requirement — several attempts per client call still pass", () => {
  const result = assertAgentOwnedCalls({
    transcript: TRANSCRIPT,
    serverTrace: [
      { event: "tool_call", callId: "call-1", attempt: 1 },
      { event: "tool_call", callId: "call-1", attempt: 2 },
      { event: "tool_call", callId: "call-1", attempt: 3 }
    ]
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.attemptsByCallId["call-1"], [1, 2, 3]);
});

test("防代答: an Agent call correlated only with another run's trace is rejected", () => {
  const result = assertAgentOwnedCalls({
    transcript: TRANSCRIPT,
    serverTrace: [{ event: "tool_call", callId: "call-1", attempt: 1, runId: OTHER_RUN.runId }],
    expectedBinding: { runId: IDENTITY.runId }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unboundCallIds, ["call-1"]);
});

// ---------------------------------------------------------------------------
// Anti-cheat assertion 3 — 防静默换题
// ---------------------------------------------------------------------------

test("防换题: an identical prompt passes, any other prompt fails", () => {
  assert.equal(assertPromptUnchanged({ executedPrompt: GOLD.question, goldQuestion: GOLD.question }).ok, true);
  const swapped = assertPromptUnchanged({
    executedPrompt: "顺便问一下最近 7 天的获客成本？",
    goldQuestion: GOLD.question
  });
  assert.equal(swapped.ok, false);
  assert.match(swapped.reason, /silent question swap/);
});

test("防换题: the comparison is byte-exact — whitespace and punctuation count", () => {
  assert.equal(assertPromptUnchanged({ executedPrompt: `${GOLD.question} `, goldQuestion: GOLD.question }).ok, false);
  assert.equal(assertPromptUnchanged({ executedPrompt: GOLD.question.replace("28", "7"), goldQuestion: GOLD.question }).ok, false);
});

// ---------------------------------------------------------------------------
// The three assertions are mutually non-substitutable
// ---------------------------------------------------------------------------

test("the three anti-cheat assertions need pairwise disjoint evidence", () => {
  const [a, b, c] = ANTI_CHEAT_ASSERTIONS;
  const overlap = (x, y) => x.requires.filter((k) => y.requires.includes(k));
  assert.deepEqual(overlap(a, b), []);
  assert.deepEqual(overlap(a, c), []);
  assert.deepEqual(overlap(b, c), []);
  assert.deepEqual([...ANTI_CHEAT_ASSERTION_IDS], ["no_leak", "no_runner_substitution", "no_silent_question_swap"]);
});

test("evidence that satisfies one assertion cannot satisfy the other two", () => {
  const onlyPrompt = { executedPrompt: GOLD.question, goldQuestion: GOLD.question };
  assert.deepEqual(missingAntiCheatEvidence(onlyPrompt), ["no_leak", "no_runner_substitution"]);
  const verdict = evaluateAntiCheat(onlyPrompt);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.results.no_silent_question_swap.ok, true);
  assert.equal(verdict.results.no_leak.ok, false);
  assert.equal(verdict.results.no_runner_substitution.ok, false);

  const onlyLeak = { gold: GOLD, surfaces: [{ surface: "agent-prompt", text: "请回答用户问题" }] };
  const leakVerdict = evaluateAntiCheat(onlyLeak);
  assert.equal(leakVerdict.ok, false);
  assert.equal(leakVerdict.results.no_leak.ok, true);
  assert.equal(leakVerdict.results.no_silent_question_swap.ok, false);

  const onlyTrace = { transcript: TRANSCRIPT, serverTrace: SERVER_TRACE };
  const traceVerdict = evaluateAntiCheat(onlyTrace);
  assert.equal(traceVerdict.ok, false);
  assert.equal(traceVerdict.results.no_runner_substitution.ok, true);
  assert.equal(traceVerdict.results.no_leak.ok, false);
});

test("an unchanged prompt does not excuse a gold leak, and a clean prompt does not excuse a runner substitution", () => {
  const leakedButUnchanged = evaluateAntiCheat({
    gold: GOLD,
    surfaces: [{ surface: "model-context", text: GOLD.definition }],
    executedPrompt: GOLD.question,
    goldQuestion: GOLD.question,
    transcript: TRANSCRIPT,
    serverTrace: SERVER_TRACE
  });
  assert.equal(leakedButUnchanged.ok, false);
  assert.equal(leakedButUnchanged.results.no_leak.ok, false);
  assert.equal(leakedButUnchanged.results.no_silent_question_swap.ok, true);

  const substitutedButClean = evaluateAntiCheat({
    gold: GOLD,
    surfaces: [{ surface: "agent-prompt", text: "请回答用户问题" }],
    executedPrompt: "另一个问题",
    goldQuestion: GOLD.question,
    transcript: [{ role: "assistant", text: "答案" }],
    serverTrace: SERVER_TRACE
  });
  assert.equal(substitutedButClean.ok, false);
  assert.equal(substitutedButClean.results.no_leak.ok, true);
  assert.equal(substitutedButClean.results.no_silent_question_swap.ok, false);
  assert.equal(substitutedButClean.results.no_runner_substitution.ok, false);
});

test("all three assertions together make the journey's anti-cheat gate pass", () => {
  const verdict = evaluateAntiCheat({
    gold: GOLD,
    surfaces: [{ surface: "agent-prompt", text: GOLD.question }],
    questionCarriers: ["agent-prompt"],
    finalAnswer: `获客成本 ${(GOLD.expected.cents / 100).toFixed(2)} 元`,
    transcript: TRANSCRIPT,
    serverTrace: SERVER_TRACE,
    executedPrompt: GOLD.question,
    goldQuestion: GOLD.question
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.results));
});

// ---------------------------------------------------------------------------
// The canonical stage contract is reachable from the state module
// ---------------------------------------------------------------------------

test("stageContract returns the canonical descriptor for every stage id", () => {
  for (const stageId of STAGE_IDS) {
    const stage = stageContract(stageId);
    assert.ok(stage, `${stageId} must have a canonical descriptor`);
    assert.equal(stage.stageId, stageId);
  }
  assert.equal(stageContract("J01-99"), null);
});
