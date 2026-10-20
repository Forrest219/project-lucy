import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalog } from "../lib/catalog.mjs";
import { loadChecklistDocs, projectChecklists } from "../lib/project-checklists.mjs";

const e2eDoc = {
  rows: [
    { id: "E2E-AUTH", scenarios: ["SEC-01"] },
    { id: "E2E-GUI", manual: { products: ["workbuddy", "cursor"], steps: ["M-01", "M-02", "M-03", "M-04", "M-05"] } }
  ]
};
const cases = [
  { id: "SEC-01-V01", scenario: "SEC-01", runner: "security", repeat: 1 },
  { id: "SEC-01-V02", scenario: "SEC-01", runner: "security", repeat: 1 },
  { id: "UX-02-V01", scenario: "UX-02", runner: "agent", repeat: 3 }
];
const bizDoc = {
  rows: [
    {
      id: "BE-BASE",
      blocking_line: "linked",
      blocking: { eval: ["superstore-ordercount-001"], e2e: ["UX-02-V01"] },
      good_line: "linked",
      good: { eval: ["superstore-discount-004"], e2e: [] }
    },
    {
      id: "BE-ANTIPATTERN",
      blocking_line: "linked",
      blocking: { eval: ["superstore-ordercount-004"], e2e: [] },
      good_line: "unlinked",
      good: { eval: [], e2e: [] }
    },
    {
      id: "BE-EXPERIENCE",
      blocking_line: "unlinked",
      blocking: { eval: [], e2e: [] },
      good_line: "unlinked",
      good: { eval: [], e2e: [] }
    }
  ]
};

function passedManual(product) {
  return {
    product,
    status: "passed",
    steps: ["M-01", "M-02", "M-03", "M-04", "M-05"].map((id) => ({ id, passed: true }))
  };
}

function project(overrides = {}) {
  return projectChecklists({
    e2eDoc,
    businessDoc: bizDoc,
    cases,
    automatedProducts: ["claude-code", "openclaw"],
    evidenceCases: [],
    manual: {},
    evalCases: [],
    experience: null,
    ...overrides
  });
}

describe("checklist projection", () => {
  it("fails a row when any variant failed, and blocks it when any variant is missing", () => {
    const failed = project({
      evidenceCases: [
        { id: "SEC-01-V01", status: "passed" },
        { id: "SEC-01-V02", status: "failed" }
      ]
    });
    assert.equal(failed.e2e.find((row) => row.id === "E2E-AUTH").status, "failed");

    const missing = project({ evidenceCases: [{ id: "SEC-01-V01", status: "passed" }] });
    assert.equal(missing.e2e.find((row) => row.id === "E2E-AUTH").status, "blocked");

    const passed = project({
      evidenceCases: [
        { id: "SEC-01-V01", status: "passed" },
        { id: "SEC-01-V02", status: "passed" }
      ],
      manual: { workbuddy: passedManual("workbuddy"), cursor: passedManual("cursor") }
    });
    assert.equal(passed.e2e.find((row) => row.id === "E2E-AUTH").status, "passed");
    assert.equal(passed.e2e.find((row) => row.id === "E2E-GUI").status, "passed");
    assert.equal(passed.summary.e2ePassed, 2);
  });

  it("keeps an unlinked good line blocked after the blocking line passes", () => {
    const projection = project({
      evalCases: [{ id: "superstore-ordercount-004", status: "pass" }]
    });
    const row = projection.business.find((item) => item.id === "BE-ANTIPATTERN");
    assert.equal(row.blockingEval, "passed");
    assert.equal(row.blockingRelease, "passed");
    assert.equal(row.good, "blocked");
    assert.equal(row.goodReason, "unlinked");
  });

  it("requires 3 passed runs on every automated client before an agent variant is green", () => {
    const oneClient = ["claude-code", "openclaw"].flatMap((client) => (
      client === "claude-code" ? [1, 2, 3].map((run) => ({ id: "UX-02-V01", client, run, status: "passed" })) : []
    ));
    const partial = project({
      evalCases: [{ id: "superstore-ordercount-001", status: "passed" }, { id: "superstore-discount-004", status: "passed" }],
      evidenceCases: oneClient
    });
    const base = partial.business.find((item) => item.id === "BE-BASE");
    assert.equal(base.blockingEval, "passed");
    assert.equal(base.blockingRelease, "blocked");
    assert.equal(base.good, "blocked");
    assert.equal(base.goodReason, "blocking-not-passed");

    const both = ["claude-code", "openclaw"].flatMap((client) => [1, 2, 3].map((run) => ({ id: "UX-02-V01", client, run, status: "passed" })));
    const ready = project({
      evalCases: [{ id: "superstore-ordercount-001", status: "passed" }, { id: "superstore-discount-004", status: "passed" }],
      evidenceCases: both
    });
    const green = ready.business.find((item) => item.id === "BE-BASE");
    assert.equal(green.blockingRelease, "passed");
    assert.equal(green.good, "passed");
  });

  it("paints the experience row from the pack and leaves an incomplete pack blocked", () => {
    const missing = project();
    assert.equal(missing.business.find((item) => item.id === "BE-EXPERIENCE").blockingRelease, "blocked");
    const failed = project({ experience: { operator: "xingchen", questions: ["最近 28 天获客成本"], coherent: false, metricUnchanged: true } });
    assert.equal(failed.business.find((item) => item.id === "BE-EXPERIENCE").good, "failed");
    const passed = project({ experience: { operator: "xingchen", questions: ["最近 28 天获客成本"], coherent: true, metricUnchanged: true } });
    const row = passed.business.find((item) => item.id === "BE-EXPERIENCE");
    assert.equal(row.blockingRelease, "passed");
    assert.equal(row.good, "passed");
  });

  it("projects the real boards as blocked when a run has no results", () => {
    const docs = loadChecklistDocs();
    const { cases: catalog } = loadCatalog();
    const projection = projectChecklists({
      e2eDoc: docs.e2e,
      businessDoc: docs.business,
      cases: catalog,
      automatedProducts: ["claude-code", "openclaw"]
    });
    assert.equal(projection.summary.e2ePassed, 0);
    assert.equal(projection.summary.e2eRows, 10);
    assert.equal(projection.summary.goodPassed, 0);
    assert.equal(projection.business.find((row) => row.id === "BE-ANTIPATTERN").goodReason, "unlinked");
    assert.equal(projection.e2e.find((row) => row.id === "E2E-GUI").status, "blocked");
  });
});
