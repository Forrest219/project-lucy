#!/usr/bin/env node
// The single customer-release aggregate gate (Spec §6.4, §8.3, Plan T13). It consumes schema-valid artifacts only:
//   results/{security,management,agent}.json   per-runner case evidence
//   results/gates.json                          existing runtime/ELF/K8s gate results, bound to an image digest
//   results/deployment.json                     what is actually deployed (instance, topology, image digest)
//   results/npm-audit.json                      `npm audit --omit=dev --json` of the candidate
// and hands them to the ONE verifier. It never parses child stdout for words like "PASS".
//
//   node scripts/gates/customer-release-readiness.mjs --candidate <identity.json> --run <run.json>
//   flags: --collect (assemble + verify, never publishable, exit 3)  --dry-run (exit 3)  --list (exit 0, no write)
//
// Exit codes (Spec §8.2): 0 passed, 1 failed, 2 blocked, 3 skipped/dry-run/collect.
// Only a release execution that passes writes <runDir>/release-readiness.json; collect/dry-run/list can never
// create or overwrite it, so a later non-release run cannot erase or fake a release verdict.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assembleEvidence, loadResults } from "../e2e/lib/assemble.mjs";
import { expectedExecutions } from "../e2e/lib/catalog.mjs";
import { automatedRequiredClients } from "../e2e/lib/clients.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv } from "../e2e/lib/common.mjs";
import { fileReaderFor, loadVerifyInputs, verifyRelease } from "../e2e/verify-evidence.mjs";

export const READINESS_STEPS = [
  "spec/unit/selector/dependency checks and existing platform checks",
  "candidate built once (linux/amd64) and its digest recorded",
  "G1–G4 + ELF + G4b/G8 + Helm/PVC gates on the SAME digest (results/gates.json)",
  "candidate deployed to an isolated single-replica K8s (results/deployment.json)",
  "security-integration + real management journey (results/security.json, results/management.json)",
  "all required real product clients (results/agent.json + server-evidence.json)",
  "evidence collected, leakage scanned, verifier decision",
  "promote exactly the tested digest only after this gate passed"
];

/**
 * A child tool's exit code and the status in its own JSON must agree (Spec §8.2). A contradiction is a contract
 * failure, never resolved in favor of the friendlier value.
 */
export function reconcileChild({ jsonStatus, exitCode }) {
  const expected = EXIT_CODES[jsonStatus];
  if (expected === undefined) return { status: "failed", problem: `unknown status "${jsonStatus}"` };
  if (expected !== exitCode) return { status: "failed", problem: `status "${jsonStatus}" implies exit ${expected} but the process exited ${exitCode}` };
  return { status: jsonStatus, problem: null };
}

function readJsonIfExists(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Pure decision from files on disk; used by the CLI and by the tests. */
export function decideReadiness({ run, candidate, mode, now = Date.now(), inputs = loadVerifyInputs() }) {
  const results = loadResults(run);
  const audit = readJsonIfExists(path.join(run.paths.runDir, "results", "npm-audit.json"));
  // Automated required products only; manual GUI products (workbuddy/cursor) are checked separately via
  // `manualRequiredClients` and must not be added to the agent-case denominator.
  const automatedProducts = automatedRequiredClients(inputs.clientsDoc.clients).map((c) => c.product);
  const expectedCount = expectedExecutions(inputs.cases, automatedProducts).length;
  const { evidence, missing } = assembleEvidence({ run, results, candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount, clientsDoc: inputs.clientsDoc });
  if (mode !== "release") evidence.executionMode = mode === "dry-run" ? "dry_run" : "collect";
  const runCreatedAtMs = Number.isFinite(Date.parse(run.createdAt)) ? Date.parse(run.createdAt) : NaN;
  const verdict = verifyRelease({ evidence, candidate, ...inputs, audit, readFile: fileReaderFor(run.paths.runDir), now, runId: run.runId, instanceId: run.instanceId, runCreatedAtMs });
  if (mode !== "release") {
    // Collect / dry-run gathers and reports; it is not a gate and can never be publishable (Spec §8.2: exit 3).
    // The problems stay in the written file so nothing about an incomplete run is hidden.
    return { evidence, verdict: { ...verdict, status: mode === "dry-run" ? "dry_run" : "collect", exitCode: 3, releaseReady: false }, missing };
  }
  if (missing.length > 0 && verdict.status === "passed") {
    return { evidence, verdict: { ...verdict, status: "blocked", exitCode: 2, releaseReady: false, problems: [...verdict.problems, { severity: "blocked", code: "absent_dependencies", message: missing.join(", ") }] }, missing };
  }
  return { evidence, verdict, missing };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { candidate: "value", run: "value", collect: "boolean", "dry-run": "boolean", list: "boolean" });
    if (args.list) {
      process.stdout.write(`${JSON.stringify({ contract: "lucy-customer-release-readiness-v1", mode: "list", steps: READINESS_STEPS })}\n`);
      process.exit(0);
    }
    if (!args.candidate || !args.run) fail("customer-release-readiness: --candidate <identity.json> and --run <run.json> are required", 1);
    const run = loadRun(args.run);
    const candidate = JSON.parse(readFileSync(args.candidate, "utf8"));
    const mode = args["dry-run"] ? "dry-run" : args.collect ? "collect" : "release";
    if (mode === "release" && run.executionMode !== "release") fail(`customer-release-readiness: run ${run.runId} was prepared in ${run.executionMode} mode; only a release run can be gated for release`, 1);
    const { verdict, missing } = decideReadiness({ run, candidate, mode });
    const body = { ...verdict, mode, absentDependencies: missing, checkedAt: new Date().toISOString() };
    const target = mode === "release" ? "release-readiness.json" : `release-readiness.${mode}.json`;
    // A non-release run must never overwrite a previous release verdict, and a release run only writes when it is a real verdict.
    writeFileSync(path.join(run.paths.runDir, target), `${JSON.stringify(body, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: verdict.status, exitCode: verdict.exitCode, releaseReady: verdict.releaseReady, written: target, problems: verdict.problems.length })}\n`);
    process.exit(verdict.exitCode);
  } catch (error) {
    fail(`customer-release-readiness: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
