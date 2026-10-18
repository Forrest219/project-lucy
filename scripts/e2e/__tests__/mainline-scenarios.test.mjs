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
