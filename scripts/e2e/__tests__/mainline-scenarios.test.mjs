// Contract tests for C2-C5 mainline scenarios (lib/mainline-scenarios.mjs).
//
// These tests are the entry point that the agent runner, management runner and
// mainline-journey.spec.ts all share: they pin what UX-01..UX-05 variants the
// C2-C5 work owns, what gold each binds, and what the per-variant assertion
// coverage is. If a future commit silently drops a variant, removes a gold
// key, or replaces an assertion with a placeholder "no_leak for everyone",
// these tests fail loudly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLock, loadCatalog, readLock } from "../lib/catalog.mjs";
import {
  CONTINUATION,
  FROZEN_BUDGET,
  goldKeyFor,
  multiTurnFor,
  ownedCatalogIds,
  scenarioFor
} from "../lib/mainline-scenarios.mjs";
import { computeGold, generateDataset } from "../../../examples/security-e2e/gold/compute-gold.mjs";
import {
  computeGold as computeV025Gold,
  generateDataset as generateV025Dataset,
  mainlineQuestions
} from "../../../examples/security-e2e/gold/v025-gold.mjs";
import {
  JOURNEY_CATALOG_EVIDENCE,
  JOURNEY_ID,
  J01_STAGE_CONTRACT,
  J01_STAGE_IDS,
  stageContractFor
} from "../lib/mainline-scenarios.mjs";

const { cases } = loadCatalog();

const REQUIRED_OWNED = [
  // C2
  "UX-01-V01", "UX-01-V02", "UX-01-V03",
  // C3
  "UX-02-V01", "UX-02-V02", "UX-02-V03", "UX-02-V04", "UX-02-V05", "UX-02-V06", "UX-02-S01",
  "UX-05-V01", "UX-05-V02",
  // C4
  "UX-03-V01", "UX-03-V02", "UX-03-V03", "UX-03-V04", "UX-03-V05", "UX-03-V06",
  "UX-03-S01", "UX-03-S02", "UX-03-S03",
  // C5
  "UX-04-V01", "UX-04-V02", "UX-04-V03", "UX-04-S01", "UX-04-S02"
];

const GOLD_KEYS = Object.keys(computeGold(generateDataset("0123456789abcdef0123")).questions);

test("scenarios covers every C2-C5 owned variant", () => {
  for (const id of REQUIRED_OWNED) {
    const scn = scenarioFor({ id });
    assert.ok(scn, `missing scenario descriptor for ${id}`);
    assert.equal(scn.catalog, id);
  }
});

test("ownedCatalogIds is exactly the C2-C5 set (no silent additions)", () => {
  const owned = new Set(ownedCatalogIds());
  for (const id of REQUIRED_OWNED) assert.ok(owned.has(id), `ownedCatalogIds missing ${id}`);
  for (const id of owned) assert.ok(REQUIRED_OWNED.includes(id), `ownedCatalogIds leaked ${id}`);
});

test("catalog lock holds after C2-C5 preparation", () => {
  // Adding a NEW gold key / new scenarios NEVER drifts the catalog digest because
  // case-catalog.yaml is the only thing the digest is computed over. The
  // contract test re-loads and re-validates against the lock so a future commit
  // that touches case-catalog.yaml by accident is caught here.
  const { cases: cases2 } = loadCatalog();
  const problems = checkLock(cases2, readLock());
  assert.equal(problems.length, 0, `catalog drifted: ${problems.join("; ")}`);
});

test("scenarios do not silently cover variants owned by other letters", () => {
  // SEC-16/17, SEC-14 etc. are owned by A/D letters. C2-C5 must NOT pretend to
  // own them. We assert this by ensuring that the only ids exposed by
  // ownedCatalogIds are the C2-C5 set.
  const owned = new Set(ownedCatalogIds());
  for (const c of cases) {
    if (c.id.startsWith("SEC-")) {
      assert.equal(owned.has(c.id), false, `scenarios leaked ${c.id} (owned by another letter)`);
    }
  }
});

test("every scenario's goldKey resolves to a question in computeGold", () => {
  for (const id of REQUIRED_OWNED) {
    const scn = scenarioFor({ id });
    if (!scn.gold) continue; // UX-03-V04..V06, S01/S02/S03 have no typed-gold; they are about deny / no-leak
    assert.ok(
      GOLD_KEYS.includes(scn.gold),
      `${id} binds to unknown gold key ${scn.gold}; available keys: ${GOLD_KEYS.join(", ")}`
    );
  }
});

test("scenarios preserve typed-gold distinctions (no rowCount-as-money laundering)", () => {
  // The catalog's answer-assertions already reject rowCount-as-money; the
  // scenario layer must NOT pretend a rowCount-style answer is acceptable by
  // marking a money_cents question as `int`. The check is structural: a
  // scenario whose gold resolves to a money_cents question MUST NOT also have
  // a `kind: "int"` clause elsewhere — but the scenarios module does not
  // duplicate answer types, so we simply assert no scenario has both `gold`
  // and a `kind` that disagrees.
  const gold = computeGold(generateDataset("0123456789abcdef0123")).questions;
  for (const id of REQUIRED_OWNED) {
    const scn = scenarioFor({ id });
    if (!scn.gold) continue;
    const q = gold[scn.gold];
    assert.ok(q, `${id} gold ${scn.gold} missing from computeGold`);
    // When the gold question is money_cents, the runner uses evaluateAnswer
    // (which already enforces cents units). The scenario must not promise a
    // non-money typed verdict.
    if (q.type === "money_cents") {
      assert.equal(
        scn.asserts.includes("typed_gold"),
        true,
        `${id} gold is money_cents but no typed_gold assertion declared`
      );
    }
    if (q.type === "empty") {
      assert.equal(
        scn.asserts.includes("typed_gold"),
        true,
        `${id} gold is empty but no typed_gold assertion declared`
      );
    }
  }
});

test("UX-02-V04 binds to a date-anchored / timezone-anchored gold key (Q-CAC-DT)", () => {
  const scn = scenarioFor({ id: "UX-02-V04" });
  assert.equal(scn.gold, "Q-CAC-DT", "UX-02-V04 must bind the date/timezone typed gold");
  assert.ok(GOLD_KEYS.includes("Q-CAC-DT"), "Q-CAC-DT must be exported from computeGold");
});

test("UX-02-V05 binds to an actual-vs-forecast typed gold key (Q-CAC-ACTUAL-FORECAST)", () => {
  const scn = scenarioFor({ id: "UX-02-V05" });
  assert.equal(scn.gold, "Q-CAC-ACTUAL-FORECAST");
});

test("UX-04-V01 multi-turn shape uses the same session across 3 turns", () => {
  const scn = scenarioFor({ id: "UX-04-V01" });
  const mt = multiTurnFor({ id: "UX-04-V01" });
  assert.ok(mt, "UX-04-V01 must declare multiTurn");
  assert.equal(mt.kind, "same-session");
  assert.equal(mt.turns.length, 3, "UX-04-V01 must have 3 turns");
  for (const t of mt.turns) {
    assert.ok(GOLD_KEYS.includes(t.goldKey), `turn goldKey ${t.goldKey} missing from computeGold`);
    assert.ok(t.preserve && typeof t.preserve === "object", "turn must declare preserve map");
  }
});

test("UX-03 empty / NULL / zero paths have distinct gold keys (no placeholder laundering)", () => {
  const v01 = scenarioFor({ id: "UX-03-V01" });
  const v02 = scenarioFor({ id: "UX-03-V02" });
  const v03 = scenarioFor({ id: "UX-03-V03" });
  assert.equal(v01.gold, "Q-EMPTY-NORTH");
  assert.equal(v02.gold, "Q-NULL-DAYS");
  assert.equal(v03.gold, "Q-ZERO-DAY");
  // The three golds MUST resolve to distinct typed answers (empty / int(N) / undefined).
  const gold = computeGold(generateDataset("0123456789abcdef0123")).questions;
  const t01 = gold[v01.gold]?.expected?.type;
  const t02 = gold[v02.gold]?.expected?.type;
  const t03 = gold[v03.gold]?.expected?.type;
  assert.equal(t01, "empty", "Q-EMPTY-NORTH must be empty type");
  assert.equal(t02, "int", "Q-NULL-DAYS must be int type (the answer is a COUNT)");
  assert.equal(t03, "undefined", "Q-ZERO-DAY must be undefined type (cannot be computed)");
  assert.notEqual(t01, t02, "empty vs NULL must be distinct types");
  assert.notEqual(t02, t03, "NULL vs zero must be distinct types");
  assert.notEqual(t01, t03, "empty vs zero must be distinct types");
});

test("UX-03-V04..V06 and S01/S02/S03 are NOT given a placeholder noLeak-for-everyone", () => {
  // The catalog contract forbids a case that promises a numeric gold but only
  // has noLeak/noFabricate/noSilentSwap assertions. The reverse is fine:
  // UX-03-V04..V06 / S01/S02/S03 promise "no leak, no silent swap, server
  // trace" — they MUST NOT silently acquire a `gold` they cannot satisfy.
  for (const id of ["UX-03-V04", "UX-03-V05", "UX-03-V06", "UX-03-S01", "UX-03-S02", "UX-03-S03"]) {
    const scn = scenarioFor({ id });
    assert.ok(scn.asserts.includes("server_trace"), `${id} must assert server_trace`);
    assert.ok(scn.asserts.includes("no_leak"), `${id} must assert no_leak`);
  }
});

test("FROZEN_BUDGET matches Spec §162 customer-release profile", () => {
  assert.equal(FROZEN_BUDGET.maxModelCallsPerCandidateRun, 400);
  assert.equal(FROZEN_BUDGET.maxAgentCaseWallClockSeconds, 600);
  assert.equal(FROZEN_BUDGET.maxAgentRunWallClockMinutes, 180);
});

test("CONTINUATION contract forbids synthetic transcript passing", () => {
  assert.equal(CONTINUATION.adapterSupportsContinuation["claude-code"].supported, true);
  assert.equal(CONTINUATION.adapterSupportsContinuation.openclaw.supported, true);
  // The contract text must mention the prohibition, not just the supported flag.
  assert.match(
    CONTINUATION.contract,
    /NOT a substitute|conversation array|native continuation/i
  );
});

test("goldKeyFor returns null for variants that do not have typed-gold (UX-03-V04..S03)", () => {
  for (const id of ["UX-03-V04", "UX-03-V05", "UX-03-V06", "UX-03-S01", "UX-03-S02", "UX-03-S03"]) {
    assert.equal(goldKeyFor({ id }), null, `${id} must not have a typed gold`);
  }
});

// ---------------------------------------------------------------------------
// W1-1: the canonical J25-01 stage contract (approved Spec §4.2).
// ---------------------------------------------------------------------------

test("the canonical stage contract is the approved eight stages with the approved names and owners", () => {
  assert.equal(JOURNEY_ID, "J25-01");
  assert.deepEqual([...JOURNEY_CATALOG_EVIDENCE], ["UX-01-V01", "UX-01-V02", "UX-01-V03"]);
  assert.deepEqual([...J01_STAGE_IDS], [
    "J01-01", "J01-02", "J01-03", "J01-04", "J01-05", "J01-06", "J01-07", "J01-08"
  ]);
  assert.deepEqual(
    J01_STAGE_CONTRACT.map((s) => [s.stageId, s.title, s.owner]),
    [
      ["J01-01", "登录与准备", "ACCESS"],
      ["J01-02", "新建连接", "CONN"],
      ["J01-03", "启用表与 Manifest", "CONN"],
      ["J01-04", "维护业务上下文", "SEM"],
      ["J01-05", "校验并生效", "SEM"],
      ["J01-06", "新建访问主体", "ACCESS"],
      ["J01-07", "真实 Agent 问答", "AGENT"],
      ["J01-08", "审计与对账", "OBSERVE"]
    ]
  );
});

test("every stage declares its user action, its input -> output, its required assertions and the depth it excludes", () => {
  for (const stage of J01_STAGE_CONTRACT) {
    assert.ok(stage.action.length > 0, `${stage.stageId} must declare the real user action`);
    assert.ok(stage.input.length > 0, `${stage.stageId} must declare its input`);
    assert.ok(stage.output.length > 0, `${stage.stageId} must declare its output`);
    assert.ok(stage.requiredAssertions.length > 0, `${stage.stageId} must declare its required assertions`);
    assert.ok(stage.excludedFromMainline.length > 0, `${stage.stageId} must record the branch depth it excludes`);
    for (const dep of stage.dependsOn) {
      assert.ok(J01_STAGE_IDS.indexOf(dep) < J01_STAGE_IDS.indexOf(stage.stageId), `${stage.stageId} may only depend on earlier stages`);
    }
  }
});

test("the stage contract agrees with the frozen v0.25 coverage manifest", async () => {
  const { loadCoverage } = await import("../lib/v025-coverage.mjs");
  const { journeys } = loadCoverage();
  assert.equal(journeys.length, 1, "there is exactly one journey");
  assert.equal(journeys[0].journeyId, JOURNEY_ID);
  assert.deepEqual(
    journeys[0].stages.map((s) => [s.stageId, s.title, s.stageOwnerBranch]),
    J01_STAGE_CONTRACT.map((s) => [s.stageId, s.title, s.owner])
  );
});

test("UX-01-V01..V03 reference the canonical stage contract instead of a private stage list", () => {
  for (const id of ["UX-01-V01", "UX-01-V02", "UX-01-V03"]) {
    const scn = scenarioFor({ id });
    assert.equal(scn.journeyId, JOURNEY_ID, `${id} must belong to the J25-01 journey`);
    assert.deepEqual([...scn.stages], [...J01_STAGE_IDS], `${id} must use the canonical stages`);
    assert.deepEqual([...scn.uiSteps], [...J01_STAGE_IDS], `${id} must use the canonical stage names`);
    assert.equal(scn.stages.length, 8, `${id} must not grow or shrink the mainline`);
  }
});

test("stageContractFor resolves every canonical stage and rejects an unknown one", () => {
  for (const stageId of J01_STAGE_IDS) {
    assert.equal(stageContractFor(stageId)?.stageId, stageId);
  }
  assert.equal(stageContractFor("J01-09"), null);
});

// ---------------------------------------------------------------------------
// W1-6: the v0.25 mainline gold (independently computed from the fixture).
// ---------------------------------------------------------------------------

test("the v0.25 mainline gold computes its typed answer independently of the Agent", () => {
  const gold = computeV025Gold(generateV025Dataset("0123456789abcdef0123"));
  assert.deepEqual(Object.keys(gold.questions), ["Q-J25-CAC-28D", "Q-J25-CAC-7D"]);
  const first = gold.questions["Q-J25-CAC-28D"];
  const followUp = gold.questions["Q-J25-CAC-7D"];
  assert.equal(first.expected.type, "money_cents");
  assert.equal(first.expected.toleranceCents, 0);
  assert.equal(followUp.expected.type, "money_cents");
  assert.ok(Number.isInteger(first.expected.cents) && first.expected.cents > 0);
  assert.ok(Number.isInteger(followUp.expected.cents) && followUp.expected.cents > 0);
  // The follow-up is a natural anaphoric question in the same session.
  assert.match(followUp.question, /那/);
  assert.equal(mainlineQuestions(generateV025Dataset("0123456789abcdef0123")).length, 2);
});

test("the v0.25 gold agrees with the frozen catalog's gold for the same fixture and window", () => {
  // Two independent implementations of the same governed metric must land on
  // the same cents; a drift means one of them changed its semantics.
  const frozen = computeGold(generateDataset("0123456789abcdef0123")).questions;
  const v025 = computeV025Gold(generateV025Dataset("0123456789abcdef0123")).questions;
  assert.equal(v025["Q-J25-CAC-28D"].expected.cents, frozen["Q-CAC-28D"].expected.cents);
  assert.equal(v025["Q-J25-CAC-7D"].expected.cents, frozen["Q-CAC-7D"].expected.cents);
});

test("the v0.25 gold states the NULL / 0 semantics and a discriminating decoy", () => {
  const gold = computeV025Gold(generateV025Dataset("0123456789abcdef0123"));
  const first = gold.questions["Q-J25-CAC-28D"];
  assert.ok(first.nullZeroSemantics.null.rule.includes("NULL"));
  assert.ok(first.nullZeroSemantics.zero.rule.includes("无法计算"));
  assert.equal(gold.rowCounts.nullRows, 1, "the fixture has one NULL-customer row");
  assert.equal(gold.rowCounts.zeroRows, 1, "the fixture has one zero-customer row");
  // The decoys must actually differ from the correct answer, otherwise they
  // cannot detect a wrong run.
  assert.notEqual(first.wrongAnswers.avgOfDailyRatiosCents, first.expected.cents);
  assert.notEqual(first.wrongAnswers.spendIncludingNullRowsCents, first.expected.cents);
});
