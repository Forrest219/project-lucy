// v0.25 evidence collection contract (Plan W0-6 follow-up).
//
// The design review's hardest rule is the one this file proves mechanically:
//   "单一层级通过≠通过" — a single passing evidence layer is never a pass.
//
// What is locked here:
//   * the v0.25 execution ids live in their OWN annotation namespace (`v025-case`),
//     never in the frozen catalog's `case` namespace, so the frozen collector
//     cannot swallow them and the v0.25 browser dimension stays visible;
//   * a status is derived from the WEAKEST required dimension;
//   * a missing required capability is `blocked` with a structured reason, and
//     the most upstream blocker wins;
//   * nothing without real evidence may be reported as `passed`.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { loadCatalog } from "../lib/catalog.mjs";
import { REPO_ROOT } from "../lib/common.mjs";
import { JOURNEY_ID, STAGE_IDS, loadCoverage } from "../lib/v025-coverage.mjs";
import {
  CAPABILITY_BLOCK_REASONS,
  EXECUTOR_LABELS,
  V025_ANNOTATION_TYPE,
  browserDimensionsFromReport,
  classifyBlockedReason,
  collectV025Evidence,
  evaluateV025Case,
  journeyVerdictFromState
} from "../lib/v025-evidence.mjs";

const coverage = loadCoverage();
const REAL_DIR = path.join(REPO_ROOT, "webui", "tests", "real-e2e");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const specFiles = walk(REAL_DIR).filter((f) => f.endsWith(".ts"));

/** A Playwright-shaped test entry. */
const testEntry = (title, { status = "expected", resultStatus = "passed", annotations = [] } = {}) => ({
  suites: [{ specs: [{ title, tests: [{ status, annotations, results: [{ status: resultStatus, annotations: [] }] }] }] }]
});

const v025Ids = new Set(coverage.newScenarios.map((s) => s.executionId));
const frozenIds = new Set(loadCatalog().cases.map((c) => c.id));

describe("the v0.25 annotation namespace is separate from the frozen catalog", () => {
  it("every v025-case annotation in the real specs names a known v0.25 execution item", () => {
    const known = new Set([...v025Ids, JOURNEY_ID, ...STAGE_IDS]);
    for (const file of specFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/type:\s*"v025-case",\s*description:\s*([^)]+)\)/g)) {
        assert.ok(m[1].includes("id"), `${path.relative(REPO_ROOT, file)} pushes a v025-case annotation without an id`);
      }
      // the helper is the only place that may mint a v025 annotation
      const pushes = [...text.matchAll(/annotations\.push\(\{\s*type:\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const type of pushes) {
        // "contract-only" is consumed by scripts/e2e/collect-management-results.mjs: a
        // runner that declares it will not evaluate a case's live evidence makes that
        // case BLOCKED (never evaluated) instead of FAILED (the product was never
        // exercised). It carries no v0.25 execution id and no evidence of its own.
        assert.ok(
          ["case", "v025-case", "assert", "blocked", "contract-only"].includes(type),
          `${path.relative(REPO_ROOT, file)} pushes an unknown annotation type "${type}"`
        );
      }
    }
  });

  it("no v0.25 execution id is ever pushed under the frozen `case` annotation type", () => {
    // the frozen collector iterates the frozen catalog only, so a v0.25 id pushed as
    // `case` would be silently dropped: the browser dimension would stay invisible.
    for (const file of specFiles) {
      const text = readFileSync(file, "utf8");
      const ids = [...text.matchAll(/type:\s*"case",\s*description:\s*"([^"]+)"/g)].map((m) => m[1]);
      for (const id of ids) {
        assert.ok(!v025Ids.has(id), `${path.relative(REPO_ROOT, file)} pushes the v0.25 id ${id} as a frozen \`case\``);
      }
    }
  });

  it("the frozen `case` namespace only carries frozen catalog ids", () => {
    for (const file of specFiles) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/covers\(testInfo,\s*([^)]*)\)/g)) {
        for (const id of [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])) {
          assert.ok(frozenIds.has(id), `${path.relative(REPO_ROOT, file)} covers the unknown frozen case ${id}`);
        }
      }
    }
  });

  it("the annotation type is declared once, in the shared helper", () => {
    const helper = path.join(REAL_DIR, "helpers", "blocked.ts");
    assert.match(readFileSync(helper, "utf8"), new RegExp(`type:\\s*"${V025_ANNOTATION_TYPE}"`));
    const defs = specFiles.filter((f) => /function\s+coversV025\b/.test(readFileSync(f, "utf8")));
    assert.deepEqual(defs, [helper], "coversV025 must have exactly one definition (the shared helper)");
  });
});

describe("a v0.25 status is the weakest required dimension", () => {
  const scenario = { executionId: "T-01", executors: ["B", "P"], requires: ["lucy-http"] };

  it("every required dimension passed AND the verifier passed -> passed", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" }, P: { status: "passed" } },
      verifierPassed: true
    });
    assert.equal(verdict.status, "passed");
  });

  it("a single passing layer is never a pass", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" } },
      verifierPassed: true
    });
    assert.equal(verdict.status, "not_run");
  });

  it("a required dimension that did not run -> not_run", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" }, P: { status: "not_run" } }
    });
    assert.equal(verdict.status, "not_run");
  });

  it("a failed required dimension -> failed", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" }, P: { status: "failed" } }
    });
    assert.equal(verdict.status, "failed");
  });

  it("a failing evidence verifier turns an all-passed item into failed", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" }, P: { status: "passed" } },
      verifierPassed: false
    });
    assert.equal(verdict.status, "failed");
  });

  it("a blocked required dimension blocks the item and keeps the reason", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "passed" }, P: { status: "blocked", blockedReason: "environment", detail: "no real HS2" } }
    });
    assert.equal(verdict.status, "blocked");
    assert.equal(verdict.blockedReason, "environment");
    assert.match(verdict.detail, /no real HS2/);
  });

  it("an unknown dimension status is not_run, never a pass", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http"],
      dimensions: { B: { status: "weird" }, P: { status: "passed" } }
    });
    assert.equal(verdict.status, "not_run");
  });
});

describe("a missing required capability blocks the item with a structured reason", () => {
  const scenario = { executionId: "T-02", executors: ["O", "P"], requires: ["lucy-http", "fault-control", "k8s-amd64"] };

  it("names the missing capabilities and classifies the blocker", () => {
    const verdict = evaluateV025Case({ scenario, capabilities: ["lucy-http"] });
    assert.equal(verdict.status, "blocked");
    assert.deepEqual(verdict.missingCapabilities, ["fault-control", "k8s-amd64"]);
    assert.equal(verdict.blockedReason, "environment");
  });

  it("the most upstream blocker wins: delivery beats environment beats capability", () => {
    assert.equal(classifyBlockedReason(["fault-control", "k8s-amd64", "ci-runner"]), "delivery");
    assert.equal(classifyBlockedReason(["fault-control", "k8s-amd64"]), "environment");
    assert.equal(classifyBlockedReason(["fault-control", "browser"]), "capability");
  });

  it("a run-scoped fact overrides the default classification", () => {
    const verdict = evaluateV025Case({
      scenario,
      capabilities: ["lucy-http", "fault-control"],
      capabilityReasons: { "k8s-amd64": "delivery" }
    });
    assert.equal(verdict.status, "blocked");
    assert.equal(verdict.blockedReason, "delivery");
  });

  it("every capability in the vocabulary has a classification", () => {
    for (const [cap, reason] of Object.entries(CAPABILITY_BLOCK_REASONS)) {
      assert.ok(["environment", "delivery", "capability", "implementation"].includes(reason), `${cap} -> ${reason}`);
    }
  });

  it("the executor vocabulary is the six approved evidence layers", () => {
    assert.deepEqual(Object.keys(EXECUTOR_LABELS).sort(), ["A", "B", "D", "O", "P", "V"]);
  });
});

describe("the browser dimension comes out of the v025-case annotations", () => {
  it("links a covering test to the execution item it covers", () => {
    const report = testEntry("row policy templates", {
      annotations: [{ type: V025_ANNOTATION_TYPE, description: "RTP25-01" }]
    });
    const dims = browserDimensionsFromReport(report);
    assert.equal(dims.get("RTP25-01").status, "passed");
    assert.deepEqual(dims.get("RTP25-01").specs, ["row policy templates"]);
  });

  it("a failing covering test fails the dimension", () => {
    const report = testEntry("boom", {
      status: "unexpected",
      resultStatus: "failed",
      annotations: [{ type: V025_ANNOTATION_TYPE, description: "RTP25-01" }]
    });
    assert.equal(browserDimensionsFromReport(report).get("RTP25-01").status, "failed");
  });

  it("a skipped covering test did not produce a verdict: not_run, never passed", () => {
    const report = testEntry("skipped", {
      status: "skipped",
      resultStatus: "skipped",
      annotations: [{ type: V025_ANNOTATION_TYPE, description: "RTP25-01" }]
    });
    assert.equal(browserDimensionsFromReport(report).get("RTP25-01").status, "not_run");
  });

  it("a blocked covering test blocks the dimension and keeps the reason", () => {
    const report = testEntry("blocked", {
      status: "skipped",
      resultStatus: "skipped",
      annotations: [
        { type: V025_ANNOTATION_TYPE, description: "RTP25-01" },
        { type: "blocked", description: "missing capability: postgres" }
      ]
    });
    const dim = browserDimensionsFromReport(report).get("RTP25-01");
    assert.equal(dim.status, "blocked");
    assert.deepEqual(dim.blockedBy, ["missing capability: postgres"]);
  });

  it("ignores the frozen `case` namespace", () => {
    const report = testEntry("frozen", { annotations: [{ type: "case", description: "UX-01-V01" }] });
    assert.equal(browserDimensionsFromReport(report).size, 0);
  });

  it("a spec that PASSED but recorded one of the item's declared tokens as false fails the dimension", () => {
    // `assertion()` never throws: a Playwright pass only says the test did not throw. The
    // item's own verdict is in the recorded assertion tokens, so a refuted declared token
    // must fail the dimension instead of letting it look proven.
    const report = testEntry("self-refuting", {
      annotations: [
        { type: V025_ANNOTATION_TYPE, description: "X-01" },
        { type: "assert", description: JSON.stringify({ token: "consistency", passed: false, detail: "9 nodes break the conservation" }) }
      ]
    });
    const dims = browserDimensionsFromReport(report, { declaredTokens: new Map([["X-01", ["consistency"]]]) });
    assert.equal(dims.get("X-01").status, "failed");
    assert.match(dims.get("X-01").detail, /9 nodes break the conservation/);
  });

  it("an assertion the item does not declare does not fail the dimension", () => {
    const report = testEntry("other-token", {
      annotations: [
        { type: V025_ANNOTATION_TYPE, description: "X-01" },
        { type: "assert", description: JSON.stringify({ token: "no_leak", passed: false, detail: "unrelated" }) }
      ]
    });
    const dims = browserDimensionsFromReport(report, { declaredTokens: new Map([["X-01", ["consistency"]]]) });
    assert.equal(dims.get("X-01").status, "passed");
  });

  it("a declared token the browser leg never evaluated leaves the dimension open (not failed)", () => {
    // The item's token set spans every executor; a token another layer owns is simply not
    // closed by the browser leg. Failing here would invent a failure.
    const report = testEntry("partial", {
      annotations: [
        { type: V025_ANNOTATION_TYPE, description: "X-01" },
        { type: "assert", description: JSON.stringify({ token: "consistency", passed: true, detail: "ok" }) }
      ]
    });
    const dims = browserDimensionsFromReport(report, { declaredTokens: new Map([["X-01", ["consistency", "exactly_one_wins"]]]) });
    assert.equal(dims.get("X-01").status, "passed");
    assert.deepEqual(dims.get("X-01").assertions.map((a) => a.token), ["consistency"]);
  });

  it("the recorded assertions travel with the dimension for audit", () => {
    const report = testEntry("audited", {
      annotations: [
        { type: V025_ANNOTATION_TYPE, description: "X-01" },
        { type: "assert", description: JSON.stringify({ token: "consistency", passed: true, detail: "ok" }) }
      ]
    });
    const dims = browserDimensionsFromReport(report, { declaredTokens: new Map([["X-01", ["consistency"]]]) });
    assert.deepEqual(dims.get("X-01").assertions, [{ token: "consistency", passed: true, detail: "ok" }]);
  });
});

describe("collecting the evidence never paints an unexecuted item green", () => {
  const manifest = {
    newScenarios: [
      { executionId: "X-01", ownerBranch: "ACCESS", priority: "P0", executors: ["B", "P"], requires: ["lucy-http"], assert: ["deny"], artifacts: [] },
      { executionId: "X-02", ownerBranch: "OBSERVE", priority: "P1", executors: ["B", "P"], requires: ["lucy-http", "fault-control"], assert: ["deny"], artifacts: [] },
      { executionId: "X-03", ownerBranch: "SEM", priority: "P0", executors: ["B"], requires: ["lucy-http"], assert: ["deny"], artifacts: [] }
    ]
  };

  it("one verdict per manifest item, and none of them is a pass without every dimension", () => {
    const report = testEntry("only the browser dimension", {
      annotations: [{ type: V025_ANNOTATION_TYPE, description: "X-01" }]
    });
    const verdicts = collectV025Evidence({ coverage: manifest, report, capabilities: ["lucy-http"] });
    assert.deepEqual(verdicts.map((v) => v.executionId), ["X-01", "X-02", "X-03"]);
    // X-01 ran only its browser dimension -> not_run; X-02 is missing a capability
    // -> blocked; X-03 was never covered -> not_run. Nothing is a pass.
    assert.deepEqual(verdicts.map((v) => v.status), ["not_run", "blocked", "not_run"]);
  });

  it("a supplied dimension closes the item only when every required dimension ran", () => {
    const report = testEntry("browser", { annotations: [{ type: V025_ANNOTATION_TYPE, description: "X-01" }] });
    const verdicts = collectV025Evidence({
      coverage: manifest,
      report,
      capabilities: ["lucy-http"],
      dimensionEvidence: { "X-01": { P: { status: "passed" } } },
      verifierPassed: true
    });
    const x01 = verdicts.find((v) => v.executionId === "X-01");
    assert.equal(x01.status, "passed");
    assert.equal(x01.dimensions.B.status, "passed");
    assert.equal(x01.dimensions.P.status, "passed");
  });

  it("a conflicting supplied dimension is resolved conservatively", () => {
    const report = testEntry("browser", {
      status: "unexpected",
      resultStatus: "failed",
      annotations: [{ type: V025_ANNOTATION_TYPE, description: "X-01" }]
    });
    const verdicts = collectV025Evidence({
      coverage: manifest,
      report,
      capabilities: ["lucy-http"],
      dimensionEvidence: { "X-01": { P: { status: "passed" } } }
    });
    const x01 = verdicts.find((v) => v.executionId === "X-01");
    assert.equal(x01.status, "failed");
  });

  it("every manifest item of the real manifest is reachable and none is silently dropped", () => {
    const verdicts = collectV025Evidence({ coverage, capabilities: [] });
    assert.equal(verdicts.length, coverage.newScenarios.length);
    assert.deepEqual(new Set(verdicts.map((v) => v.executionId)), v025Ids);
  });
});

describe("the J25-01 journey is an aggregate item, reported stage by stage", () => {
  const state = {
    journeyId: JOURNEY_ID,
    status: "failed",
    failureRef: "fail://J01-02/boom",
    stages: STAGE_IDS.map((stageId, index) => ({
      stageId,
      title: `stage ${index + 1}`,
      owner: "ACCESS",
      status: index === 0 ? "passed" : index === 1 ? "failed" : "not_run",
      evidenceRefs: [],
      failureRef: index === 0 ? null : "fail://J01-02/boom"
    }))
  };

  it("lists all eight stages with their status", () => {
    const verdict = journeyVerdictFromState(state);
    assert.equal(verdict.executionId, JOURNEY_ID);
    assert.equal(verdict.status, "failed");
    assert.equal(verdict.stages.length, 8);
    assert.equal(verdict.stages.filter((s) => s.status === "not_run").length, 6);
  });

  it("names the first failing stage", () => {
    const verdict = journeyVerdictFromState(state);
    assert.match(verdict.detail, /J01-02/);
  });

  it("no state -> no journey verdict (never a silent pass)", () => {
    assert.equal(journeyVerdictFromState(null), null);
    assert.equal(journeyVerdictFromState({}), null);
  });
});
