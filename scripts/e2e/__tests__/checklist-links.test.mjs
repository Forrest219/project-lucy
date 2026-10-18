// Link integrity for the E2E evidence board and the Business Eval capability board.
// Included by `npm run test:e2e-harness` via scripts/e2e/__tests__/*.test.mjs.
// Checks that cited ids exist. Does not read run evidence and never paints a row passed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { REPO_ROOT, SPEC_SCENARIO_IDS, loadCatalog } from "../lib/catalog.mjs";

const E2E_ROWS = path.join(REPO_ROOT, "docs/qa/checklists/e2e-release-rows.yaml");
const BIZ_ROWS = path.join(REPO_ROOT, "docs/qa/checklists/business-eval-rows.yaml");
const MANUAL_CHECKLIST = path.join(REPO_ROOT, "docs/qa/manual-gui-e2e-checklist.md");
const CLIENTS = path.join(REPO_ROOT, "docs/qa/real-e2e-clients.yaml");
const EVAL_FILES = [
  "evals/superstore/eval/superstore-eval-cases.yaml",
  "evals/agent_reliability/eval/agent-reliability-eval-cases.yaml"
];

function loadYaml(file) {
  return parse(readFileSync(file, "utf8"));
}

function evalCaseIds() {
  const ids = new Set();
  for (const rel of EVAL_FILES) {
    const doc = loadYaml(path.join(REPO_ROOT, rel));
    for (const item of doc.cases ?? []) ids.add(item.id);
  }
  return ids;
}

/**
 * @returns {string[]} problems; empty means the two boards only cite real ids
 * and an unlinked good line is not marked passed.
 */
export function checkChecklistLinks(e2eDoc, bizDoc, ctx) {
  const problems = [];
  const seenScenarios = new Map();

  if (e2eDoc.judgment !== "binary") problems.push("e2e board judgment must stay binary");
  // Strengthened: deny "empty-good" / "unlinked" by structural contract.
  // 1) the e2e board must carry EXACTLY ONE manual row (Spec R7);
  // 2) the e2e board must cover ALL 32 SPEC_SCENARIO_IDS at least once;
  // 3) a scenario id may be cited by AT MOST ONE evidence row (deny duplication);
  // 4) the manual row products set must equal the required manual set exactly;
  // 5) the manual row steps set must equal the GUI checklist step set exactly.
  const requiredIds = new Set(ctx.requiredScenarioIds);
  const rows = e2eDoc.rows ?? [];
  const manualRows = rows.filter((row) => row.manual);
  const scenarioRows = rows.filter((row) => row.scenarios);
  if (rows.length !== 10) problems.push(`e2e board must carry exactly 10 rows (9 scenario rows + 1 manual row), got ${rows.length}`);
  if (manualRows.length !== 1) problems.push(`e2e board must carry exactly ONE manual row, got ${manualRows.length}`);
  for (const row of scenarioRows) {
    if ("good_line" in row || "good" in row) problems.push(`${row.id}: e2e evidence rows have no good line`);
    if (row.status === "passed" || row.color === "green") problems.push(`${row.id}: evidence row cannot be painted passed`);
    for (const id of row.scenarios) {
      if (!ctx.scenarioIds.has(id)) problems.push(`${row.id}: scenario ${id} is not in the frozen catalog`);
      if (seenScenarios.has(id)) problems.push(`${id} is listed on both ${seenScenarios.get(id)} and ${row.id}`);
      seenScenarios.set(id, row.id);
    }
    if (!row.scenarios && !row.manual) problems.push(`${row.id}: evidence row needs scenarios or a manual checklist`);
  }
  for (const id of requiredIds) {
    if (!seenScenarios.has(id)) problems.push(`scenario ${id} is missing from the e2e board`);
  }
  for (const row of manualRows) {
    if (row.manual.doc !== "docs/qa/manual-gui-e2e-checklist.md") {
      problems.push(`${row.id}: manual doc must be the GUI checklist`);
    }
    // exact set equality for products
    const products = new Set(row.manual.products ?? []);
    if (products.size !== ctx.manualProducts.size || ![...products].every((p) => ctx.manualProducts.has(p))) {
      problems.push(`${row.id}: manual products must equal required manual set exactly (${[...ctx.manualProducts].sort().join(",")})`);
    }
    // exact set equality for steps
    const docSteps = new Set();
    for (const line of ctx.manualText.split("\n")) {
      const m = line.match(/^\| (M-\d+) \|/);
      if (m) docSteps.add(m[1]);
    }
    const rowSteps = new Set(row.manual.steps ?? []);
    if (rowSteps.size !== docSteps.size || ![...rowSteps].every((s) => docSteps.has(s))) {
      problems.push(`${row.id}: manual steps must equal GUI checklist steps exactly (${[...docSteps].sort().join(",")})`);
    }
  }

  if (bizDoc.judgment !== "dual") problems.push("business board judgment must stay dual");
  for (const row of bizDoc.rows ?? []) {
    for (const bucket of ["blocking", "good"]) {
      for (const id of row[bucket]?.eval ?? []) {
        if (!ctx.evalIds.has(id)) problems.push(`${row.id}: eval ${id} is not a case in superstore or agent_reliability`);
      }
      for (const id of row[bucket]?.e2e ?? []) {
        if (!ctx.variantIds.has(id)) problems.push(`${row.id}: e2e variant ${id} is not in the frozen catalog`);
      }
    }
    const goodEmpty = (row.good?.eval ?? []).length === 0 && (row.good?.e2e ?? []).length === 0;
    if (row.good_line === "unlinked" && !goodEmpty) problems.push(`${row.id}: unlinked good line must have empty links`);
    if (row.good_line === "linked" && goodEmpty) problems.push(`${row.id}: linked good line needs at least one case`);
    if (row.good_line === "unlinked" && (row.good_status === "passed" || row.good?.status === "passed" || row.color === "green")) {
      problems.push(`${row.id}: unlinked good line cannot be painted passed`);
    }
    if (row.blocking_line === "unlinked") {
      const blockingEmpty = (row.blocking?.eval ?? []).length === 0 && (row.blocking?.e2e ?? []).length === 0;
      if (!blockingEmpty) problems.push(`${row.id}: unlinked blocking line must have empty links`);
    }
  }

  const experience = (bizDoc.rows ?? []).find((row) => row.id === "BE-EXPERIENCE");
  if (!experience) problems.push("BE-EXPERIENCE is missing");
  else if (experience.experience?.status !== "blocked") problems.push("BE-EXPERIENCE status must stay blocked");

  return problems;
}

function context() {
  const { cases } = loadCatalog();
  const clients = loadYaml(CLIENTS);
  const manualProducts = new Set(
    (clients.clients ?? [])
      .filter((client) => client.required === true && client.execution === "manual")
      .map((client) => client.product)
  );
  return {
    scenarioIds: new Set(cases.map((item) => item.scenario)),
    requiredScenarioIds: SPEC_SCENARIO_IDS,
    variantIds: new Set(cases.map((item) => item.id)),
    evalIds: evalCaseIds(),
    manualProducts,
    manualText: readFileSync(MANUAL_CHECKLIST, "utf8")
  };
}

describe("release checklist links", () => {
  const ctx = context();
  const e2eDoc = loadYaml(E2E_ROWS);
  const bizDoc = loadYaml(BIZ_ROWS);

  it("cites only real catalog scenarios, eval cases, and manual GUI steps", () => {
    assert.deepEqual(checkChecklistLinks(e2eDoc, bizDoc, ctx), []);
  });

  it("rejects painting an unlinked good line passed", () => {
    const painted = structuredClone(bizDoc);
    const row = painted.rows.find((item) => item.id === "BE-ANTIPATTERN");
    row.good_status = "passed";
    const problems = checkChecklistLinks(e2eDoc, painted, ctx);
    assert.ok(problems.some((line) => /unlinked good line cannot be painted passed/.test(line)), problems.join("\n"));
  });

  it("rejects an experience row marked passed and a quiz id used as an eval case", () => {
    const painted = structuredClone(bizDoc);
    painted.rows.find((item) => item.id === "BE-EXPERIENCE").experience.status = "passed";
    painted.rows.find((item) => item.id === "BE-BASE").blocking.eval.push("Q1");
    const problems = checkChecklistLinks(e2eDoc, painted, ctx);
    assert.ok(problems.some((line) => /BE-EXPERIENCE status must stay blocked/.test(line)), problems.join("\n"));
    assert.ok(problems.some((line) => /Q1/.test(line)), problems.join("\n"));
  });

  it("rejects the e2e board when the row count drifts away from exactly 10", () => {
    const painted = structuredClone(e2eDoc);
    painted.rows.push({ id: "E2E-EXTRA", title: "extra", scenarios: ["GATE-01"] });
    const problems = checkChecklistLinks(painted, bizDoc, ctx);
    assert.ok(problems.some((line) => /exactly 10 rows/.test(line)), problems.join("\n"));
  });

  it("rejects the e2e board when a second manual row is added (Spec R7 — exactly one manual row)", () => {
    const painted = structuredClone(e2eDoc);
    painted.rows.push({
      id: "E2E-MANUAL2",
      title: "second manual",
      manual: { doc: "docs/qa/manual-gui-e2e-checklist.md", products: ["workbuddy"], steps: ["M-01"] }
    });
    const problems = checkChecklistLinks(painted, bizDoc, ctx);
    assert.ok(problems.some((line) => /exactly ONE manual row/.test(line)), problems.join("\n"));
    // Also: extra row trips the row-count contract
    assert.ok(problems.some((line) => /exactly 10 rows/.test(line)), problems.join("\n"));
  });

  it("rejects the e2e board when a SPEC_SCENARIO_ID is unlinked (missing row)", () => {
    const painted = structuredClone(e2eDoc);
    // drop the E2E-GATE row, leaving GATE-01 un-cited
    painted.rows = painted.rows.filter((row) => row.id !== "E2E-GATE");
    const problems = checkChecklistLinks(painted, bizDoc, ctx);
    assert.ok(problems.some((line) => /GATE-01 is missing from the e2e board/.test(line)), problems.join("\n"));
  });

  it("rejects the e2e board when the manual row products set is not exactly {workbuddy, cursor}", () => {
    const painted = structuredClone(e2eDoc);
    const manual = painted.rows.find((row) => row.manual);
    manual.manual.products = ["workbuddy"]; // missing cursor
    const problems = checkChecklistLinks(painted, bizDoc, ctx);
    assert.ok(problems.some((line) => /manual products must equal required manual set exactly/.test(line)), problems.join("\n"));
  });

  it("rejects the e2e board when the manual row steps set is not exactly the GUI checklist steps", () => {
    const painted = structuredClone(e2eDoc);
    const manual = painted.rows.find((row) => row.manual);
    manual.manual.steps = ["M-01", "M-02", "M-03", "M-04"]; // missing M-05
    const problems = checkChecklistLinks(painted, bizDoc, ctx);
    assert.ok(problems.some((line) => /manual steps must equal GUI checklist steps exactly/.test(line)), problems.join("\n"));
  });
});
