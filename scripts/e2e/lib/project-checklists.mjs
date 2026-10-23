// Projects a real-user E2E run onto the two release checklists.
// The YAML row files stay unscored. This module only writes a projection.
// A row is failed when any cited result failed, blocked when any cited result
// is missing or not passed, and passed only when every cited result passed.
// An unlinked good line stays blocked even if some other case passed.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { loadResults } from "./assemble.mjs";
import { automatedRequiredClients } from "./clients.mjs";
import { REPO_ROOT } from "./catalog.mjs";

export const E2E_ROWS_PATH = path.join(REPO_ROOT, "docs/qa/checklists/e2e-release-rows.yaml");
export const BIZ_ROWS_PATH = path.join(REPO_ROOT, "docs/qa/checklists/business-eval-rows.yaml");
const MANUAL_STEPS = ["M-01", "M-02", "M-03", "M-04", "M-05"];

export function loadChecklistDocs() {
  return {
    e2e: parse(readFileSync(E2E_ROWS_PATH, "utf8")),
    business: parse(readFileSync(BIZ_ROWS_PATH, "utf8"))
  };
}

export function normalizeStatus(raw) {
  if (raw === "pass" || raw === "passed") return "passed";
  if (raw === "fail" || raw === "failed") return "failed";
  if (raw === "blocked") return "blocked";
  return "blocked";
}

export function normalizeEvalCases(doc) {
  if (!doc || typeof doc !== "object") return [];
  const lists = [doc.cases, doc.results];
  for (const suite of doc.suites ?? []) lists.push(suite?.cases, suite?.results);
  const out = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const id = item?.id ?? item?.case_id ?? item?.caseId;
      const raw = item?.status ?? item?.score?.status;
      if (typeof id === "string" && (typeof raw === "string" || typeof raw === "boolean")) {
        out.push({ id, status: raw === true ? "passed" : raw === false ? "failed" : normalizeStatus(raw) });
      }
    }
  }
  return out;
}

function fold(statuses) {
  if (statuses.length === 0) return "blocked";
  if (statuses.includes("failed")) return "failed";
  if (statuses.every((status) => status === "passed")) return "passed";
  return "blocked";
}

function tally(statuses) {
  const count = (status) => statuses.filter((item) => item === status).length;
  return { total: statuses.length, passed: count("passed"), failed: count("failed"), blocked: count("blocked") };
}

/** One catalog variant. Agent variants need `repeat` passed runs on every automated required client. */
export function variantStatus(testCase, entries, automatedProducts) {
  const relevant = testCase.runner === "agent"
    ? entries.filter((entry) => automatedProducts.includes(entry.client))
    : entries;
  if (relevant.some((entry) => normalizeStatus(entry.status) === "failed")) return "failed";
  if (testCase.runner === "agent") {
    const repeat = testCase.repeat ?? 1;
    for (const product of automatedProducts) {
      const passedRuns = new Set(
        relevant
          .filter((entry) => entry.client === product && normalizeStatus(entry.status) === "passed")
          .map((entry) => entry.run)
      );
      if (passedRuns.size < repeat) return "blocked";
    }
    if (relevant.some((entry) => normalizeStatus(entry.status) !== "passed")) return "blocked";
    return automatedProducts.length === 0 ? "blocked" : "passed";
  }
  if (relevant.length === 0) return "blocked";
  if (relevant.some((entry) => normalizeStatus(entry.status) !== "passed")) return "blocked";
  return "passed";
}

function manualProductStatus(pack) {
  if (!pack || !Array.isArray(pack.steps)) return "blocked";
  const byId = new Map(pack.steps.map((step) => [step.id, step.passed]));
  if (MANUAL_STEPS.some((id) => !byId.has(id))) return "blocked";
  if (MANUAL_STEPS.some((id) => byId.get(id) === false) || pack.status === "failed") return "failed";
  if (MANUAL_STEPS.every((id) => byId.get(id) === true) && pack.status === "passed") return "passed";
  return "blocked";
}

function experienceStatus(pack) {
  if (!pack || typeof pack !== "object") return { status: "blocked", reason: "missing" };
  const operatorOk = typeof pack.operator === "string" && pack.operator.trim().length > 0;
  const questionsOk = Array.isArray(pack.questions) && pack.questions.length > 0 && pack.questions.every((q) => typeof q === "string" && q.trim().length > 0);
  if (!operatorOk || !questionsOk || typeof pack.coherent !== "boolean" || typeof pack.metricUnchanged !== "boolean") {
    return { status: "blocked", reason: "incomplete" };
  }
  if (pack.coherent === true && pack.metricUnchanged === true) return { status: "passed", reason: "experience-pack" };
  return { status: "failed", reason: "experience-pack" };
}

function linkStatus(ids, lookup) {
  return fold(ids.map((id) => lookup(id) ?? "blocked"));
}

/**
 * @param {object} input
 * @param {object} input.e2eDoc
 * @param {object} input.businessDoc
 * @param {object[]} input.cases expanded catalog
 * @param {string[]} input.automatedProducts required automated client product ids
 * @param {object[]} input.evidenceCases {id,status,client?,run?}
 * @param {object} input.manual product -> pack or null
 * @param {object[]} input.evalCases {id,status}
 * @param {object|null} input.experience
 */
export function projectChecklists({
  e2eDoc,
  businessDoc,
  cases,
  automatedProducts,
  evidenceCases = [],
  manual = {},
  evalCases = [],
  experience = null
}) {
  const byId = new Map();
  for (const entry of evidenceCases) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }
  const catalogByScenario = new Map();
  for (const testCase of cases) {
    if (!catalogByScenario.has(testCase.scenario)) catalogByScenario.set(testCase.scenario, []);
    catalogByScenario.get(testCase.scenario).push(testCase);
  }
  const evalById = new Map(evalCases.map((item) => [item.id, normalizeStatus(item.status)]));

  const e2e = (e2eDoc.rows ?? []).map((row) => {
    if (row.manual) {
      const products = (row.manual.products ?? []).map((product) => manualProductStatus(manual[product]));
      return { id: row.id, status: fold(products), variants: tally(products) };
    }
    const variantStatuses = [];
    for (const scenario of row.scenarios ?? []) {
      for (const testCase of catalogByScenario.get(scenario) ?? []) {
        variantStatuses.push(variantStatus(testCase, byId.get(testCase.id) ?? [], automatedProducts));
      }
    }
    return { id: row.id, status: fold(variantStatuses), variants: tally(variantStatuses) };
  });

  const variantLookup = (id) => {
    const testCase = cases.find((item) => item.id === id);
    if (!testCase) return "blocked";
    return variantStatus(testCase, byId.get(id) ?? [], automatedProducts);
  };
  const evalLookup = (id) => evalById.get(id) ?? "blocked";

  const business = (businessDoc.rows ?? []).map((row) => {
    if (row.id === "BE-EXPERIENCE") {
      const pack = experienceStatus(experience);
      return {
        id: row.id,
        blockingEval: pack.status,
        blockingRelease: pack.status,
        good: pack.status,
        goodReason: pack.reason
      };
    }
    const evalIds = row.blocking?.eval ?? [];
    const e2eIds = row.blocking?.e2e ?? [];
    const blockingUnlinked = row.blocking_line === "unlinked" || (evalIds.length === 0 && e2eIds.length === 0);
    const blockingEval = blockingUnlinked ? "blocked" : evalIds.length === 0 ? "passed" : linkStatus(evalIds, evalLookup);
    const e2eStatus = blockingUnlinked || e2eIds.length === 0 ? (blockingUnlinked ? "blocked" : "passed") : linkStatus(e2eIds, variantLookup);
    const blockingRelease = blockingUnlinked ? "blocked" : fold([blockingEval, e2eStatus]);
    const goodUnlinked = row.good_line === "unlinked" || ((row.good?.eval ?? []).length + (row.good?.e2e ?? []).length) === 0;
    let good = "blocked";
    let goodReason = "unlinked";
    if (!goodUnlinked) {
      const goodEval = linkStatus(row.good.eval ?? [], evalLookup);
      const goodE2e = (row.good.e2e ?? []).length === 0 ? "passed" : linkStatus(row.good.e2e, variantLookup);
      const goodLinks = fold([goodEval, goodE2e]);
      if (blockingRelease !== "passed") {
        good = "blocked";
        goodReason = "blocking-not-passed";
      } else {
        good = goodLinks;
        goodReason = goodLinks;
      }
    }
    return { id: row.id, blockingEval, blockingRelease, good, goodReason };
  });

  return {
    contract: "lucy-checklist-projection-v1",
    e2e,
    business,
    summary: {
      e2eRows: e2e.length,
      e2ePassed: e2e.filter((row) => row.status === "passed").length,
      blockingEvalPassed: business.filter((row) => row.blockingEval === "passed").length,
      blockingReleasePassed: business.filter((row) => row.blockingRelease === "passed").length,
      goodPassed: business.filter((row) => row.good === "passed").length,
      businessRows: business.length
    }
  };
}

export function evidenceFromRun(run, { evalDoc = null, clientsDoc } = {}) {
  const results = loadResults(run);
  const evidenceCases = [];
  for (const doc of [results.security, results.management, results.agent, results.gates]) {
    for (const entry of doc?.cases ?? []) if (entry?.id) evidenceCases.push(entry);
  }
  const experiencePath = path.join(run.paths.runDir, "experience.json");
  return {
    evidenceCases,
    manual: results.manual ?? {},
    evalCases: normalizeEvalCases(evalDoc),
    experience: existsSync(experiencePath) ? JSON.parse(readFileSync(experiencePath, "utf8")) : null,
    automatedProducts: automatedRequiredClients(clientsDoc?.clients ?? []).map((client) => client.product)
  };
}
