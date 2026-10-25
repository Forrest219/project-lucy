// v0.25 evidence collection: turns one run's artifacts into per-execution-item,
// per-evidence-dimension statuses for the 173 new execution items (and the
// J25-01 journey), so that "implemented" can never be read as "accepted".
//
// The rule that governs everything here is the approved Spec §核心流程
// `runBranchCase` together with §8.2:
//
//   * a missing required capability        -> blocked + structured reason
//   * a required dimension that did not run -> not_run
//   * a required dimension that failed     -> failed
//   * every required dimension passed AND the evidence verifier passed -> passed
//
// A single passing layer is NEVER a pass. `not_run` / `not_applicable` are
// never folded into a pass count.
//
// Pure module: no I/O, no clock, no network. The collector writes the result.

import { EXECUTOR_LETTERS } from "./catalog.mjs";
import { journeyStatus } from "./j01-state.mjs";
import { annotationsOf, iterTests, testStatus } from "./playwright-report.mjs";
import { statusFromDimensions } from "./v025-result.mjs";

/**
 * The annotation type that links a Playwright test to a v0.25 execution item.
 *
 * It is deliberately NOT `case`: the `case` namespace belongs to the frozen
 * release catalog (32 scenarios / 255 required variants). A v0.25 id pushed as
 * `case` would pollute the frozen namespace and would be silently dropped by
 * the frozen collector, which is exactly the failure this module closes.
 */
export const V025_ANNOTATION_TYPE = "v025-case";

/**
 * Executor letter -> the evidence layer it stands for
 * (enterprise security & real-e2e spec §执行器).
 */
export const EXECUTOR_LABELS = Object.freeze({
  B: "browser",
  P: "protocol",
  D: "database",
  A: "agent-client",
  O: "ops-fault",
  V: "evidence-verifier"
});

/**
 * Capability -> why it is missing when the run does not have it.
 *
 * `delivery` beats `environment` beats `capability`: the most upstream blocker
 * wins, because a missing CI runner is a later problem than a missing database.
 */
export const CAPABILITY_BLOCK_REASONS = Object.freeze({
  "ci-runner": "delivery",
  "npm-registry": "delivery",
  "k8s-amd64": "environment",
  "postgres": "environment",
  "agent-client": "capability",
  "browser": "capability",
  "clock-control": "capability",
  "fault-control": "capability",
  "ktx-upstream": "capability",
  "lucy-http": "capability",
  "network-profile": "capability"
});

/** The dimension statuses this module produces. */
export const DIMENSION_STATUSES = Object.freeze(["passed", "failed", "not_run", "blocked"]);

/**
 * When two records describe the same dimension and disagree, the conservative
 * one wins: a definite failure dominates, then a blocker, then "we do not
 * know", and only an unqualified pass may be called a pass.
 */
const DIMENSION_PRECEDENCE = Object.freeze(["failed", "blocked", "not_run", "passed"]);

/**
 * Classifies why a required capability is missing.
 * @param {string[]} missing
 * @param {Record<string, string>} [overrides] run-scoped facts that override the default classification
 * @returns {"environment"|"delivery"|"capability"|"implementation"}
 */
export function classifyBlockedReason(missing = [], overrides = {}) {
  const reasons = missing.map((cap) => overrides[cap] ?? CAPABILITY_BLOCK_REASONS[cap] ?? "capability");
  if (reasons.includes("delivery")) return "delivery";
  if (reasons.includes("environment")) return "environment";
  if (reasons.includes("capability")) return "capability";
  return "implementation";
}

/**
 * The browser (B) dimension of every v0.25 execution item the browser leg
 * touched. One test may cover several items; each of them gets the test's
 * verdict, and a failure anywhere in the covering set is a failure of the item.
 *
 * A skipped test did NOT produce a verdict, so its dimension is `not_run` —
 * never `passed` and never `failed`.
 * @param {any} report a parsed Playwright JSON report
 * @returns {Map<string, {status: string, detail: string, specs: string[], blockedBy: string[]}>}
 */
export function browserDimensionsFromReport(report) {
  const out = new Map();
  for (const suite of report?.suites ?? []) {
    for (const { title, test } of iterTests(suite)) {
      const annotations = annotationsOf(test);
      const ids = annotations.filter((a) => a.type === V025_ANNOTATION_TYPE).map((a) => a.description);
      if (ids.length === 0) continue;
      const raw = testStatus(test);
      const status = raw === "skipped" ? "not_run" : raw;
      const blockedBy = annotations.filter((a) => a.type === "blocked").map((a) => a.description);
      for (const id of ids) {
        // `status: null` means "no record yet" — it must not be confused with a
        // record that says "not_run".
        const entry = out.get(id) ?? { status: null, detail: "", specs: [], blockedBy: [] };
        if (entry.status === null || DIMENSION_PRECEDENCE.indexOf(status) < DIMENSION_PRECEDENCE.indexOf(entry.status)) {
          entry.status = status;
        }
        if (raw === "failed" && !entry.detail) entry.detail = `failing spec: ${title}`;
        if (raw === "blocked") {
          entry.detail = entry.detail || blockedBy.join("; ") || `blocked spec: ${title}`;
          entry.blockedBy.push(...blockedBy);
        }
        if (!entry.specs.includes(title)) entry.specs.push(title);
        out.set(id, entry);
      }
    }
  }
  return out;
}

/**
 * Merges two records of the same dimension. The conservative status wins.
 */
function mergeDimension(a, b) {
  const left = normalizeDimension(a);
  const right = normalizeDimension(b);
  if (!left) return right;
  if (!right) return left;
  const winner = DIMENSION_PRECEDENCE.indexOf(left.status) <= DIMENSION_PRECEDENCE.indexOf(right.status) ? left : right;
  const loser = winner === left ? right : left;
  const evidenceRefs = [...new Set([...(left.evidenceRefs ?? []), ...(right.evidenceRefs ?? [])])];
  const detail = winner.detail || loser.detail || "";
  const merged = { ...winner, evidenceRefs };
  if (winner.status !== loser.status) {
    merged.detail = `${detail} (conflicting records: ${winner.status} vs ${loser.status})`;
  }
  return merged;
}

/**
 * Normalizes one dimension record. An unknown status is `not_run`: a dimension
 * that cannot state its verdict did not produce one.
 */
function normalizeDimension(d) {
  if (!d || typeof d !== "object") return null;
  const status = DIMENSION_STATUSES.includes(d.status) ? d.status : "not_run";
  return {
    status,
    detail: typeof d.detail === "string" ? d.detail : "",
    evidenceRefs: Array.isArray(d.evidenceRefs) ? d.evidenceRefs : [],
    ...(d.blockedReason ? { blockedReason: d.blockedReason } : {}),
    ...(Array.isArray(d.specs) ? { specs: d.specs } : {})
  };
}

/**
 * Evaluates one v0.25 execution item — the executable form of the approved
 * `runBranchCase` pseudocode.
 *
 * @param {object} options
 * @param {object} options.scenario the manifest row (executors / requires / …)
 * @param {Record<string, any>} [options.dimensions] executor letter -> dimension record
 * @param {string[]} [options.capabilities] capabilities this run actually has
 * @param {boolean} [options.verifierPassed] the evidence verifier's verdict
 * @param {Record<string, string>} [options.capabilityReasons] run-scoped classification overrides
 * @returns {{executionId: string, status: string, blockedReason: string|null, detail: string, missingCapabilities: string[], dimensions: Record<string, any>}}
 */
export function evaluateV025Case({ scenario, dimensions = {}, capabilities = [], verifierPassed, capabilityReasons = {} }) {
  const executionId = scenario.executionId;
  const required = [...(scenario.executors ?? [])].filter((l) => EXECUTOR_LETTERS.includes(l));
  const have = new Set(capabilities);
  const missing = (scenario.requires ?? []).filter((cap) => !have.has(cap));
  if (missing.length > 0) {
    return {
      executionId,
      status: "blocked",
      blockedReason: classifyBlockedReason(missing, capabilityReasons),
      detail: `missing capabilities: ${missing.join(", ")}`,
      missingCapabilities: missing,
      dimensions
    };
  }

  const normalized = {};
  for (const letter of EXECUTOR_LETTERS) {
    const d = normalizeDimension(dimensions[letter]);
    if (d) normalized[letter] = d;
  }

  // A required dimension that could not execute blocks the item and carries the
  // reason. `blocked` is decided on evidence, never derived from a pass.
  for (const letter of required) {
    const d = normalized[letter];
    if (d?.status === "blocked") {
      return {
        executionId,
        status: "blocked",
        blockedReason: d.blockedReason ?? "capability",
        detail: d.detail || `dimension ${letter} (${EXECUTOR_LABELS[letter]}) is blocked`,
        missingCapabilities: [],
        dimensions: normalized
      };
    }
  }

  const status = statusFromDimensions(normalized, { required, verifierPassed });
  return {
    executionId,
    status,
    blockedReason: null,
    detail: "",
    missingCapabilities: [],
    dimensions: normalized
  };
}

/**
 * Builds the per-item verdicts for every new execution item in the coverage
 * manifest.
 *
 * @param {object} options
 * @param {object} options.coverage the loaded coverage manifest
 * @param {any} [options.report] the parsed Playwright JSON report (browser dimension)
 * @param {string[]} [options.capabilities] capabilities this run actually has
 * @param {Record<string, Record<string, any>>} [options.dimensionEvidence] runner-supplied dimensions
 * @param {boolean} [options.verifierPassed] the evidence verifier's verdict
 * @param {Record<string, string>} [options.capabilityReasons] run-scoped classification overrides
 * @returns {Array<object>}
 */
export function collectV025Evidence({
  coverage,
  report = null,
  capabilities = [],
  dimensionEvidence = {},
  verifierPassed,
  capabilityReasons = {}
}) {
  const browser = report ? browserDimensionsFromReport(report) : new Map();
  const results = [];
  for (const scenario of coverage?.newScenarios ?? []) {
    const dimensions = {};
    const fromBrowser = browser.get(scenario.executionId);
    if (fromBrowser) {
      dimensions.B = {
        status: fromBrowser.status,
        detail: fromBrowser.detail,
        evidenceRefs: fromBrowser.specs.map((t) => `playwright:${t}`),
        specs: fromBrowser.specs
      };
    }
    for (const [letter, d] of Object.entries(dimensionEvidence?.[scenario.executionId] ?? {})) {
      if (!EXECUTOR_LETTERS.includes(letter)) continue;
      dimensions[letter] = mergeDimension(dimensions[letter], normalizeDimension(d));
    }
    const verdict = evaluateV025Case({
      scenario,
      dimensions,
      capabilities,
      verifierPassed,
      capabilityReasons
    });
    results.push({
      ...verdict,
      ownerBranch: scenario.ownerBranch ?? null,
      priority: scenario.priority ?? null,
      sourceRequirementId: scenario.sourceRequirementId ?? null,
      sourceSpec: scenario.sourceSpec ?? null,
      executors: scenario.executors ?? [],
      requires: scenario.requires ?? [],
      assert: scenario.assert ?? [],
      artifacts: scenario.artifacts ?? []
    });
  }
  return results;
}

/**
 * The J25-01 journey verdict from the run-scoped journey state.
 *
 * The journey is an AGGREGATE item: it is not one of the 173 execution items
 * and it does not split into eight execution ids. Its eight stages are
 * reported one by one, with the owner branch and the first failure reference.
 *
 * @param {any} state the run-scoped journey state (j01-state.json)
 * @returns {object|null} a result record, or null when there is no state
 */
export function journeyVerdictFromState(state) {
  if (!state || typeof state !== "object" || !Array.isArray(state.stages)) return null;
  const status = journeyStatus(state);
  const stages = state.stages.map((s) => ({
    stageId: s.stageId,
    title: s.title,
    owner: s.owner,
    status: s.status,
    evidenceRefs: s.evidenceRefs ?? [],
    failureRef: s.failureRef ?? null
  }));
  const failed = stages.find((s) => s.status === "failed") ?? null;
  return {
    executionId: state.journeyId ?? "J25-01",
    status: status === "running" ? "not_run" : status,
    blockedReason: null,
    detail: failed ? `first failure at ${failed.stageId}` : "",
    missingCapabilities: [],
    ownerBranch: "AGENT",
    priority: "P0",
    sourceRequirementId: null,
    sourceSpec: null,
    executors: [],
    requires: [],
    assert: [],
    artifacts: ["j01-state.json"],
    catalogEvidenceIds: state.catalogEvidenceIds ?? [],
    stages,
    failureRef: state.failureRef ?? null
  };
}
