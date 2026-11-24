/**
 * P1-53 Task 1 — journey suite loader + three-axis compatibility judge (pure, no network).
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 1
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md
 *
 * INLINE fixtures only for pass/fail; real YAML is optional if A2 has landed.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_QUESTION_BANK_ID,
  DEFAULT_JOURNEY_SUITE_PATH,
  aggregateCompatibility,
  digest,
  digestJourneySuite,
  loadJourneySuite,
  threeAxis,
  validateJourneySuite
} from "../lib/mcp-compatibility.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const REAL_SUITE_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/mcp-upgrade-journeys.yaml");

/** Minimal denominator-complete suite for judge tests (not a second question bank). */
function validSuite(overrides = {}) {
  const base = {
    questionBankId: APPROVED_QUESTION_BANK_ID,
    version: 1,
    requiredConfigFingerprint: "sha256:compat-profile-fixture",
    cases: [
      {
        id: "QB-FOLLOW-01",
        family: "follow-up",
        mapsTo: ["COMPAT-03"],
        turns: [{ text: "nov sales" }, { text: "dec?" }, { text: "vs prior?" }]
      },
      {
        id: "QB-ACL-01",
        family: "permission",
        mapsTo: ["COMPAT-07"],
        turns: [{ text: "orders sales" }],
        identities: [{ id: "deny_no_query", expect: { outcome: "deny" } }]
      },
      {
        id: "QB-DB-01",
        family: "multi-connection",
        mapsTo: ["COMPAT-06"],
        connectionIds: ["demo-mysql", "lucy-ops"],
        turns: [{ text: "compare two connections" }]
      }
    ]
  };
  return {
    ...base,
    ...overrides,
    cases: overrides.cases ?? base.cases
  };
}

function mcpSamples(n, valueMs) {
  return Array.from({ length: n }, () => valueMs);
}

function passingAxes(overrides = {}) {
  return {
    functionalCases: [
      {
        id: "QB-FOLLOW-01",
        expectedOutcome: "allow",
        observedOutcome: "allow",
        expectedNonempty: true,
        observedRowCount: 3,
        expectedMetrics: ["total_sales"],
        observedMetrics: ["total_sales"]
      }
    ],
    mcp: {
      budgetClass: "simple",
      samplesMs: mcpSamples(20, 100)
    },
    agent: {
      turns: [{ turnWallClockMs: 1_000 }, { turnWallClockMs: 1_100 }, { turnWallClockMs: 900 }]
    },
    ...overrides
  };
}

test("rejects a suite missing follow-up, permission or multi-connection cases", () => {
  const missingFollowUp = validSuite({
    cases: [
      { id: "QB-ACL-01", family: "permission", mapsTo: ["COMPAT-07"], turns: [{ text: "x" }] },
      { id: "QB-DB-01", family: "multi-connection", mapsTo: ["COMPAT-06"], turns: [{ text: "y" }] }
    ]
  });
  const v1 = validateJourneySuite(missingFollowUp);
  assert.equal(v1.ok, false);
  assert.ok(v1.problems.some((p) => /follow-up/i.test(p)));

  const missingPermission = validSuite({
    cases: [
      { id: "QB-FOLLOW-01", family: "follow-up", mapsTo: ["COMPAT-03"], turns: [{ text: "a" }, { text: "b" }] },
      { id: "QB-DB-01", family: "multi-connection", mapsTo: ["COMPAT-06"], turns: [{ text: "y" }] }
    ]
  });
  const v2 = validateJourneySuite(missingPermission);
  assert.equal(v2.ok, false);
  assert.ok(v2.problems.some((p) => /permission/i.test(p)));

  const missingMulti = validSuite({
    cases: [
      { id: "QB-FOLLOW-01", family: "follow-up", mapsTo: ["COMPAT-03"], turns: [{ text: "a" }, { text: "b" }] },
      { id: "QB-ACL-01", family: "permission", mapsTo: ["COMPAT-07"], turns: [{ text: "x" }] }
    ]
  });
  const v3 = validateJourneySuite(missingMulti);
  assert.equal(v3.ok, false);
  assert.ok(v3.problems.some((p) => /multi-connection/i.test(p)));
});

test("rejects empty denominator and duplicate case ids", () => {
  const empty = validateJourneySuite(validSuite({ cases: [] }));
  assert.equal(empty.ok, false);
  assert.ok(empty.problems.some((p) => /empty|denominator|no cases/i.test(p)));

  const dup = validateJourneySuite(
    validSuite({
      cases: [
        { id: "QB-FOLLOW-01", family: "follow-up", mapsTo: ["COMPAT-03"], turns: [{ text: "a" }, { text: "b" }] },
        { id: "QB-FOLLOW-01", family: "follow-up", mapsTo: ["COMPAT-03"], turns: [{ text: "a" }, { text: "b" }] },
        { id: "QB-ACL-01", family: "permission", mapsTo: ["COMPAT-07"], turns: [{ text: "x" }] },
        { id: "QB-DB-01", family: "multi-connection", mapsTo: ["COMPAT-06"], turns: [{ text: "y" }] }
      ]
    })
  );
  assert.equal(dup.ok, false);
  assert.ok(dup.problems.some((p) => /duplicate/i.test(p)));
});

test("missing requiredConfigFingerprint => BLOCKED", () => {
  const suite = validSuite({ requiredConfigFingerprint: undefined });
  delete suite.requiredConfigFingerprint;
  const loaded = loadJourneySuite(suite);
  const validation = validateJourneySuite(loaded);
  assert.equal(validation.ok, false);
  assert.ok(validation.problems.some((p) => /requiredConfigFingerprint/i.test(p)));

  const agg = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite: loaded,
    configProfileFingerprint: "sha256:anything",
    ...passingAxes()
  });
  assert.equal(agg.status, "BLOCKED");
  assert.ok(agg.reasons.some((r) => /requiredConfigFingerprint/i.test(r)));
});

test("missing configProfileFingerprint => BLOCKED", () => {
  const suite = loadJourneySuite(validSuite());
  for (const runtimeFp of [undefined, null, "", "   "]) {
    const agg = aggregateCompatibility({
      entrypoint: "certifyCandidate",
      suite,
      configProfileFingerprint: runtimeFp,
      ...passingAxes()
    });
    assert.equal(agg.status, "BLOCKED", `runtimeFp=${JSON.stringify(runtimeFp)}`);
    assert.ok(agg.reasons.some((r) => /configProfileFingerprint/i.test(r)));
  }
});

test("new deny, empty envelope, nonempty-to-empty, missing metric => FAIL", () => {
  const newDeny = threeAxis({
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "deny",
          expectedNonempty: true,
          observedRowCount: 0
        }
      ]
    })
  });
  assert.equal(newDeny.functionalCompatibility, "FAIL");

  const emptyEnvelope = threeAxis({
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "allow",
          envelopeEmpty: true
        }
      ]
    })
  });
  assert.equal(emptyEnvelope.functionalCompatibility, "FAIL");

  const nonemptyToEmpty = threeAxis({
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "allow",
          baselineNonempty: true,
          observedRowCount: 0,
          expectedNonempty: true
        }
      ]
    })
  });
  assert.equal(nonemptyToEmpty.functionalCompatibility, "FAIL");

  const missingMetric = threeAxis({
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "allow",
          expectedMetrics: ["order_count", "total_sales"],
          observedMetrics: ["order_count"],
          observedRowCount: 1
        }
      ]
    })
  });
  assert.equal(missingMetric.functionalCompatibility, "FAIL");
});

test("expected denial becoming allow => FAIL", () => {
  const verdict = threeAxis({
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-ACL-01",
          expectedOutcome: "deny",
          observedOutcome: "allow",
          observedRowCount: 5
        }
      ]
    })
  });
  assert.equal(verdict.functionalCompatibility, "FAIL");
});

test("simple query p95 5001ms => serviceLatency FAIL even if faster than baseline", () => {
  // All samples at 5001ms → p95=5001 exceeds absolute 5s even though faster than baseline 10s.
  const verdict = threeAxis({
    ...passingAxes({
      mcp: {
        budgetClass: "simple",
        samplesMs: mcpSamples(20, 5001),
        baselineP95Ms: 10_000
      }
    })
  });
  assert.equal(verdict.serviceLatency, "FAIL");
});

test("MCP relative needs both >20% and >50ms", () => {
  // +40ms (<50) and +40% (>20%) — must NOT FAIL on relative alone
  const onlyRatio = threeAxis({
    ...passingAxes({
      mcp: {
        budgetClass: "simple",
        samplesMs: mcpSamples(20, 140),
        baselineP95Ms: 100
      }
    })
  });
  assert.equal(onlyRatio.serviceLatency, "PASS");

  // +60ms (>50) but only +10% (<20%) — must NOT FAIL
  const onlyAbs = threeAxis({
    ...passingAxes({
      mcp: {
        budgetClass: "simple",
        samplesMs: mcpSamples(20, 660),
        baselineP95Ms: 600
      }
    })
  });
  assert.equal(onlyAbs.serviceLatency, "PASS");

  // both gates: +100ms and +50%
  const both = threeAxis({
    ...passingAxes({
      mcp: {
        budgetClass: "simple",
        samplesMs: mcpSamples(20, 300),
        baselineP95Ms: 200
      }
    })
  });
  assert.equal(both.serviceLatency, "FAIL");
});

test("agent relative uses median; both >20% and >2s", () => {
  // median 11s vs baseline 10s → +1s (<2s) and +10% — PASS
  const onlySmall = threeAxis({
    ...passingAxes({
      agent: {
        turns: [
          { turnWallClockMs: 10_500 },
          { turnWallClockMs: 11_000 },
          { turnWallClockMs: 11_500 }
        ],
        baselineMedianMs: 10_000
      }
    })
  });
  assert.equal(onlySmall.agentLatency, "PASS");

  // median 13s vs 10s → +3s and +30% — FAIL
  const both = threeAxis({
    ...passingAxes({
      agent: {
        turns: [
          { turnWallClockMs: 12_000 },
          { turnWallClockMs: 13_000 },
          { turnWallClockMs: 14_000 }
        ],
        baselineMedianMs: 10_000
      }
    })
  });
  assert.equal(both.agentLatency, "FAIL");
});

test("agent wall-clock >120s => agentLatency FAIL", () => {
  const verdict = threeAxis({
    ...passingAxes({
      agent: {
        turns: [
          { turnWallClockMs: 1_000 },
          { turnWallClockMs: 120_001 },
          { turnWallClockMs: 2_000 }
        ]
      }
    })
  });
  assert.equal(verdict.agentLatency, "FAIL");
});

test("DEGRADED_PROVIDER_LATENCY cannot make overall PASS", () => {
  const axes = threeAxis({
    ...passingAxes({
      agent: {
        turns: [
          { turnWallClockMs: 1_000 },
          { turnWallClockMs: 130_000 },
          { turnWallClockMs: 2_000 }
        ],
        attribution: "DEGRADED_PROVIDER_LATENCY"
      }
    })
  });
  assert.equal(axes.agentLatency, "FAIL");
  assert.equal(axes.attribution, "DEGRADED_PROVIDER_LATENCY");

  const agg = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite: validSuite(),
    configProfileFingerprint: "sha256:compat-profile-fixture",
    verdicts: axes,
    agent: {
      turns: [
        { turnWallClockMs: 1_000 },
        { turnWallClockMs: 130_000 },
        { turnWallClockMs: 2_000 }
      ],
      attribution: "DEGRADED_PROVIDER_LATENCY"
    }
  });
  assert.notEqual(agg.status, "PASS");
  assert.equal(agg.status, "FAIL");
});

test("overall PASS requires threeAxis all PASS", () => {
  const suite = validSuite();
  const fp = suite.requiredConfigFingerprint;

  const pass = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite,
    configProfileFingerprint: fp,
    ...passingAxes(),
    batchWallClockMs: 12_345
  });
  assert.equal(pass.status, "PASS");
  assert.equal(pass.verdicts.functionalCompatibility, "PASS");
  assert.equal(pass.verdicts.serviceLatency, "PASS");
  assert.equal(pass.verdicts.agentLatency, "PASS");

  const funcFail = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite,
    configProfileFingerprint: fp,
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "deny"
        }
      ]
    })
  });
  assert.equal(funcFail.status, "FAIL");
});

test("fewer than 20 MCP or 3 agent samples => BLOCKED", () => {
  const fewMcp = threeAxis({
    ...passingAxes({
      mcp: { budgetClass: "simple", samplesMs: mcpSamples(19, 100) }
    })
  });
  assert.equal(fewMcp.serviceLatency, "BLOCKED");

  const fewAgent = threeAxis({
    ...passingAxes({
      agent: {
        turns: [{ turnWallClockMs: 1_000 }, { turnWallClockMs: 1_100 }]
      }
    })
  });
  assert.equal(fewAgent.agentLatency, "BLOCKED");
});

test("missing baseline/snapshotId on instance lane => BLOCKED", () => {
  const suite = validSuite();
  const noBaseline = aggregateCompatibility({
    entrypoint: "certifyInstanceUpgrade",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    candidateEvidence: { status: "PASS" },
    baseline: null,
    ...passingAxes()
  });
  assert.equal(noBaseline.status, "BLOCKED");
  assert.ok(noBaseline.reasons.some((r) => /baseline/i.test(r)));

  const noSnapshot = aggregateCompatibility({
    entrypoint: "certifyInstanceUpgrade",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    candidateEvidence: { status: "PASS" },
    baseline: { snapshotId: null, clientFingerprint: "c1", modelFingerprint: "m1" },
    clientFingerprint: "c1",
    modelFingerprint: "m1",
    ...passingAxes()
  });
  assert.equal(noSnapshot.status, "BLOCKED");
  assert.ok(noSnapshot.reasons.some((r) => /snapshotId/i.test(r)));
});

test("client/model fingerprint mismatch => rejected", () => {
  const suite = validSuite();
  const agg = aggregateCompatibility({
    entrypoint: "certifyInstanceUpgrade",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    candidateEvidence: { status: "PASS" },
    baseline: {
      snapshotId: "snap-1",
      clientFingerprint: "client-a",
      modelFingerprint: "model-a"
    },
    clientFingerprint: "client-b",
    modelFingerprint: "model-a",
    snapshotId: "snap-1",
    ...passingAxes()
  });
  assert.equal(agg.status, "BLOCKED");
  assert.ok(agg.reasons.some((r) => /fingerprint/i.test(r)));
});

test("certifyCandidate PASS alone does not satisfy instance upgrade", () => {
  const suite = validSuite();
  const candidate = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    ...passingAxes()
  });
  assert.equal(candidate.status, "PASS");

  const upgrade = aggregateCompatibility({
    entrypoint: "certifyInstanceUpgrade",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    candidateEvidence: { status: "PASS" },
    // no baseline / snapshot — candidate PASS must not satisfy upgrade
    ...passingAxes()
  });
  assert.notEqual(upgrade.status, "PASS");
  assert.equal(upgrade.status, "BLOCKED");
});

test("captureInstanceBaseline does not require prior baseline file", () => {
  const suite = validSuite();
  const capture = aggregateCompatibility({
    entrypoint: "captureInstanceBaseline",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    baseline: null,
    clientFingerprint: "client-a",
    modelFingerprint: "model-a",
    ...passingAxes(),
    batchWallClockMs: 9_000
  });
  assert.equal(capture.status, "PASS");
  assert.ok(!capture.reasons?.some((r) => /prior baseline|baseline missing|BASELINE_MISSING/i.test(r)));
});

test("evidence-pack neg-control is not old-version UAT PASS", () => {
  const suite = validSuite();
  const neg = aggregateCompatibility({
    entrypoint: "evidencePackNegControl",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    ...passingAxes({
      functionalCases: [
        {
          id: "QB-BIZ-01",
          expectedOutcome: "allow",
          observedOutcome: "deny"
        }
      ]
    })
  });
  assert.notEqual(neg.status, "PASS");
  assert.equal(neg.kind, "evidence-pack-neg-control");
  assert.equal(neg.uatPass, false);
  assert.ok(neg.notes?.some((n) => /not.*uat pass|≠.*uat|judge-only|判定器/i.test(n)));
});

test("batchWallClockMs recorded; no total cost ceiling gate", () => {
  const suite = validSuite();
  const agg = aggregateCompatibility({
    entrypoint: "certifyCandidate",
    suite,
    configProfileFingerprint: suite.requiredConfigFingerprint,
    ...passingAxes(),
    batchWallClockMs: 3_600_000,
    modelCallCount: 50_000,
    tokenUsage: { input: 9_999_999, output: 9_999_999 },
    estimatedCostUsd: 9999
  });
  assert.equal(agg.status, "PASS");
  assert.equal(agg.batchWallClockMs, 3_600_000);
  assert.ok(!agg.reasons?.some((r) => /cost|ceiling|budget.*total|wall.?clock.*limit/i.test(r)));
});

describe("loader / digest helpers", () => {
  test("loadJourneySuite accepts inline objects and digests stably", () => {
    const suite = validSuite();
    const loaded = loadJourneySuite(suite);
    assert.equal(loaded.questionBankId, APPROVED_QUESTION_BANK_ID);
    const d1 = digestJourneySuite(loaded);
    const d2 = digest(loaded);
    assert.equal(d1, d2);
    assert.match(d1, /^sha256:[a-f0-9]{64}$/);
    assert.equal(validateJourneySuite(loaded).ok, true);
  });

  test("optionally loads real YAML when present (A2); does not require it to pass", () => {
    assert.equal(DEFAULT_JOURNEY_SUITE_PATH.includes("mcp-upgrade-journeys.yaml"), true);
    if (!existsSync(REAL_SUITE_PATH)) {
      assert.ok(true, "real journeys YAML absent — skip optional load");
      return;
    }
    const suite = loadJourneySuite(REAL_SUITE_PATH);
    assert.equal(typeof suite.questionBankId, "string");
    assert.ok(Array.isArray(suite.cases) && suite.cases.length > 0);
    const v = validateJourneySuite(suite);
    // Real file may still be mid-authoring; only assert load succeeded.
    assert.equal(typeof v.ok, "boolean");
  });
});
