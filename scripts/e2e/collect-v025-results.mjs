#!/usr/bin/env node
// Writes the v0.25 execution-item results for one run (Plan W0-6 follow-up).
//
//   node scripts/e2e/collect-v025-results.mjs --run <run.json> \
//        [--report <playwright.json>] [--dimensions <json>] [--journey-state <j01-state.json>]
//
// What it does:
//   * reads the v0.25 coverage manifest (scripts/e2e/contracts/v025-coverage.yaml)
//     for the 173 new execution items and their declared evidence dimensions;
//   * reads the browser (B) dimension out of the Playwright report, via the
//     `v025-case` annotations the v0.25 specs emit;
//   * reads any further dimensions a runner supplied (--dimensions);
//   * derives ONE status per item from the WEAKEST required dimension
//     (approved Spec §核心流程 `runBranchCase`);
//   * writes one result file per item plus the aggregate report.
//
// What it never does: turn a missing dimension into a pass. An item whose
// required dimensions did not all run is `not_run`; an item whose required
// capability is absent is `blocked` with a structured reason.
//
// Output layout (under the run directory):
//   v025/<executionId>.json     one result per execution item (173)
//   v025/coverage-result.json   the aggregate report
//   v025/journey/J25-01.json    the aggregate mainline journey (NOT one of the 173)
//   v025/journey/run-context.json   the run identity and capability set
//
// Exit codes: passed 0, failed 1, blocked 2, not_run 3. `not_run` shares the
// "no verdict" code with `skipped` in the frozen EXIT_CODES contract, which
// has no entry for it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { managementCapabilities } from "./collect-management-results.mjs";
import { fail, loadRun, parseArgv } from "./lib/common.mjs";
import { loadCoverage } from "./lib/v025-coverage.mjs";
import { collectV025Evidence, journeyVerdictFromState } from "./lib/v025-evidence.mjs";
import { createResult, writeReport, writeResult } from "./lib/v025-result.mjs";

const V025_EXIT_CODES = Object.freeze({ passed: 0, failed: 1, blocked: 2, not_run: 3, not_applicable: 3 });

function readJsonIfExists(file) {
  if (!file) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The identity a result record must bind to (Spec §8.2). */
export function runIdentity(run) {
  return {
    runId: run.runId,
    instanceId: run.instanceId,
    candidateDigest: run.candidateDigest ?? run.fixtureDigest ?? "unavailable"
  };
}

/** Flattens the dimension evidence references of one item. */
function evidenceRefsOf(dimensions) {
  const refs = [];
  for (const [letter, d] of Object.entries(dimensions ?? {})) {
    for (const ref of d.evidenceRefs ?? []) refs.push(`${letter}:${ref}`);
  }
  return refs;
}

/**
 * Turns the per-item verdicts into v0.25 result records and writes them.
 * @returns {{results: object[], report: string, dir: string}}
 */
export function writeV025Evidence(run, { coverage, report = null, capabilities = [], dimensionEvidence = {}, verifierPassed, journeyState = null, outDir = null } = {}) {
  const identity = runIdentity(run);
  const verdicts = collectV025Evidence({
    coverage,
    report,
    capabilities: [...capabilities],
    dimensionEvidence,
    verifierPassed,
    capabilityReasons: run.capabilityReasons ?? {}
  });

  const dir = outDir ?? path.join(run.paths?.runDir ?? path.join("inbox", "e2e", run.runId), "v025");
  mkdirSync(dir, { recursive: true });

  const results = [];
  for (const verdict of verdicts) {
    const result = createResult({
      executionId: verdict.executionId,
      ...identity,
      status: verdict.status,
      blockedReason: verdict.blockedReason,
      sourceStatus: null,
      executorResults: verdict.dimensions,
      evidenceRefs: evidenceRefsOf(verdict.dimensions)
    });
    result.ownerBranch = verdict.ownerBranch;
    result.priority = verdict.priority;
    result.sourceRequirementId = verdict.sourceRequirementId;
    result.sourceSpec = verdict.sourceSpec;
    result.executors = verdict.executors;
    result.requires = verdict.requires;
    result.assert = verdict.assert;
    result.artifacts = verdict.artifacts;
    result.detail = verdict.detail;
    result.missingCapabilities = verdict.missingCapabilities;
    writeResult(result, dir);
    results.push(result);
  }

  const reportFile = writeReport(results, dir);

  // The journey is an AGGREGATE item: it is not one of the 173 execution
  // items, so it is kept out of the denominator and reported with its eight
  // stages one by one.
  const journeyDir = path.join(dir, "journey");
  mkdirSync(journeyDir, { recursive: true });
  const journey = journeyVerdictFromState(journeyState);
  if (journey) {
    const journeyResult = createResult({
      executionId: journey.executionId,
      ...identity,
      status: journey.status,
      // a blocked journey always carries a structured reason (the contract requires it)
      blockedReason: journey.status === "blocked" ? journey.blockedReason ?? "environment" : null,
      sourceStatus: null,
      executorResults: {},
      evidenceRefs: journey.evidenceRefs ?? []
    });
    journeyResult.ownerBranch = journey.ownerBranch;
    journeyResult.stages = journey.stages;
    journeyResult.catalogEvidenceIds = journey.catalogEvidenceIds;
    journeyResult.failureRef = journey.failureRef;
    journeyResult.detail = journey.detail;
    writeResult(journeyResult, journeyDir);
  }
  writeFileSync(
    path.join(journeyDir, "run-context.json"),
    `${JSON.stringify(
      {
        contract: "lucy-v025-run-context-v1",
        runId: identity.runId,
        instanceId: identity.instanceId,
        candidateDigest: identity.candidateDigest,
        caseCatalogDigest: run.caseCatalogDigest ?? null,
        executionMode: run.executionMode ?? run.mode ?? null,
        capabilities: [...capabilities].sort(),
        executionItemCount: results.length,
        journeyStatus: journey ? journey.status : "not_run",
        generatedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return { results, report: reportFile, dir };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), {
      run: "value",
      report: "value",
      dimensions: "value",
      journey: "value",
      out: "value"
    });
    if (!args.run) fail("collect-v025-results: --run is required", 1);
    const run = loadRun(args.run);
    const report = readJsonIfExists(args.report);
    const dimensionEvidence = readJsonIfExists(args.dimensions) ?? {};
    const journeyState = readJsonIfExists(args.journey) ?? readJsonIfExists(path.join(run.paths?.runDir ?? "", "j01-state.json"));
    const { results, report: out, dir } = writeV025Evidence(run, {
      coverage: loadCoverage(),
      report,
      capabilities: managementCapabilities(run),
      dimensionEvidence,
      journeyState
    });
    const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    const status = counts.failed > 0 ? "failed" : counts.blocked > 0 ? "blocked" : counts.not_run > 0 ? "not_run" : "passed";
    process.stdout.write(`${JSON.stringify({ status, exitCode: V025_EXIT_CODES[status], out, dir, summary: counts })}\n`);
    process.exit(V025_EXIT_CODES[status]);
  } catch (error) {
    fail(`collect-v025-results: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
