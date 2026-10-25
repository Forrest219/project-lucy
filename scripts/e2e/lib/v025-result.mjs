// v0.25 independent result format (Plan W0-6).
//
// Run status lives HERE, never in the static coverage manifest. The manifest
// (v025-coverage.yaml) records ownership and required evidence only; this file
// records what actually ran, at which evidence layer, in which environment.
//
// Hard rules (Spec §8.2 / Plan §2.3):
//   * `passed` means every required evidence dimension passed in the declared
//     environment — a single passing layer is never a pass;
//   * `blocked` is never a pass and never a skip;
//   * `not_run` / `not_applicable` are never aggregated into a pass;
//   * implementation complete, acceptance passed and customer delivery passed
//     are always reported as separate columns.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./common.mjs";

export const RESULT_STATUSES = Object.freeze(["passed", "failed", "blocked", "not_run", "not_applicable"]);
export const BLOCKED_REASONS = Object.freeze(["environment", "delivery", "capability", "implementation"]);
export const RESULT_IDENTITY = Object.freeze(["runId", "instanceId", "candidateDigest"]);

/** Output root for a run's v0.25 evidence. */
export function resultDir(runId, root = path.join(REPO_ROOT, "inbox", "e2e")) {
  return path.join(root, runId, "v025");
}

/**
 * Derives an execution item's status from its per-executor dimensions.
 * Mirrors the approved `runBranchCase` pseudocode (Spec §核心流程): a required
 * dimension that did not execute makes the item not_run, a failed dimension
 * makes it failed, and only all-passed plus a passing evidence verifier yields
 * passed. `blocked` is decided before execution and is never derived here.
 *
 * `required` is the execution item's declared executor set (the coverage
 * manifest's `executors`). A dimension that is not required but happened to
 * run does not turn a partial item into a pass — that is the "single passing
 * layer is never a pass" rule.
 */
export function statusFromDimensions(dimensions, { required, verifierPassed } = {}) {
  const dims = dimensions ?? {};
  const req = required ?? Object.keys(dims);
  if (req.length === 0) return "not_run";
  for (const key of req) {
    const d = dims[key];
    if (!d || d.status === "not_run" || d.status === undefined) return "not_run";
  }
  for (const key of req) {
    if (dims[key]?.status === "failed") return "failed";
  }
  if (verifierPassed === false) return "failed";
  return "passed";
}

/** Builds one result record, validating the identity and status fields. */
export function createResult(input) {
  const result = {
    executionId: input.executionId,
    runId: input.runId,
    instanceId: input.instanceId,
    candidateDigest: input.candidateDigest,
    status: input.status,
    blockedReason: input.blockedReason ?? null,
    sourceStatus: input.sourceStatus ?? null,
    executorResults: input.executorResults ?? {},
    evidenceRefs: input.evidenceRefs ?? []
  };
  const problems = validateResult(result);
  if (problems.length > 0) {
    throw new Error(`invalid v025 result for ${input.executionId}: ${problems.join("; ")}`);
  }
  return result;
}

/** Returns a list of problems; empty means the result record is well formed. */
export function validateResult(result) {
  const problems = [];
  if (!result || typeof result !== "object") return ["result must be an object"];
  for (const key of ["executionId", ...RESULT_IDENTITY]) {
    if (typeof result[key] !== "string" || result[key].length === 0) problems.push(`${key} missing`);
  }
  if (!RESULT_STATUSES.includes(result.status)) problems.push(`status "${result.status}" is not one of ${RESULT_STATUSES.join("|")}`);
  if (result.status === "blocked") {
    if (!BLOCKED_REASONS.includes(result.blockedReason)) {
      problems.push(`blocked requires blockedReason in ${BLOCKED_REASONS.join("|")}`);
    }
  } else if (result.blockedReason !== null) {
    problems.push(`blockedReason is only allowed on a blocked result`);
  }
  if (result.sourceStatus !== null && typeof result.sourceStatus !== "string") problems.push("sourceStatus must be a string or null");
  if (result.executorResults === null || typeof result.executorResults !== "object") problems.push("executorResults must be an object");
  if (!Array.isArray(result.evidenceRefs)) problems.push("evidenceRefs must be an array");
  return problems;
}

/**
 * Aggregates a run's results into a report.
 * `passed` counts only real passes; blocked / not_run / not_applicable are
 * reported separately and are never folded into a pass count.
 */
export function aggregateResults(results) {
  const byStatus = Object.fromEntries(RESULT_STATUSES.map((s) => [s, 0]));
  for (const r of results) {
    if (!byStatus[r.status]) byStatus[r.status] = 0;
    byStatus[r.status] += 1;
  }
  const byOwner = {};
  for (const r of results) {
    const owner = r.ownerBranch ?? "UNASSIGNED";
    byOwner[owner] ??= { passed: 0, failed: 0, blocked: 0, not_run: 0, not_applicable: 0 };
    byOwner[owner][r.status] = (byOwner[owner][r.status] ?? 0) + 1;
  }
  return {
    total: results.length,
    byStatus,
    byOwner,
    // a pass is a pass; anything else is not silently folded in
    passed: byStatus.passed,
    notPassed: results.length - byStatus.passed
  };
}

/** Writes one result file. */
export function writeResult(result, dir) {
  const problems = validateResult(result);
  if (problems.length > 0) throw new Error(`invalid v025 result: ${problems.join("; ")}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${result.executionId}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return file;
}

/** Writes the run's aggregated report. */
export function writeReport(results, dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "coverage-result.json");
  writeFileSync(file, `${JSON.stringify({ generatedBy: "v025-result.mjs", summary: aggregateResults(results), results }, null, 2)}\n`, "utf8");
  return file;
}

/** Reads back a run's result files. */
export function readResults(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "coverage-result.json")
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}
