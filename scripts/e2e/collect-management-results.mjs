#!/usr/bin/env node
// Turns a Playwright JSON report of the real-user management specs into per-case evidence (Spec §6.4).
//
//   node scripts/e2e/collect-management-results.mjs --run <run.json> --report <playwright.json>
//
// A catalog case with runner `management` is: passed only when every spec covering it passed and every declared
// assertion token was evaluated true; failed when any covering spec failed; BLOCKED when the spec marked itself
// blocked, a required capability is missing, or no spec covers the case yet. Never skipped-as-passed.
// Specs link to cases through `covers()` annotations, not through titles.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "./lib/catalog.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv } from "./lib/common.mjs";
import { annotationsOf, iterTests, testStatus } from "./lib/playwright-report.mjs";
import { statusFromAssertions } from "./run-security.mjs";

export function managementCapabilities(run, env = process.env) {
  const caps = new Set(["lucy-http", "browser"]);
  if (run.db?.applied) caps.add("postgres");
  for (const extra of (env.LUCY_REAL_E2E_CAPABILITIES ?? "").split(",")) if (extra.trim()) caps.add(extra.trim());
  return caps;
}

/**
 * The declared assertion tokens the covering specs said they DELIBERATELY do not
 * evaluate for this case.
 *
 * A binding-contract runner (e.g. the offline / candidate UX-06 + UX-07 spec) proves
 * which endpoint / command / client set a case is bound to and never produces the live
 * evidence the frozen catalog declares for it. The catalog's rule stays fail-closed —
 * a token that a live runner forgot is still `failed` — but a token that a runner
 * explicitly declared it will not evaluate means the case was NEVER EVALUATED.
 * That is a missing precondition, so it is recorded BLOCKED, not as a product failure.
 */
function contractOnlyTokensFor(tests, caseId) {
  const tokens = new Set();
  for (const { test } of tests) {
    for (const annotation of annotationsOf(test).filter((a) => a.type === "contract-only")) {
      let parsed;
      try {
        parsed = JSON.parse(annotation.description);
      } catch {
        continue;
      }
      const declared = parsed?.[caseId];
      if (Array.isArray(declared)) for (const token of declared) tokens.add(token);
    }
  }
  return tokens;
}

/** Pure: maps a parsed Playwright report to management case results. */
export function collectManagementResults({ run, report, cases, capabilities }) {
  const covering = new Map();
  for (const suite of report.suites ?? []) {
    for (const { title, test } of iterTests(suite)) {
      for (const annotation of annotationsOf(test).filter((a) => a.type === "case")) {
        if (!covering.has(annotation.description)) covering.set(annotation.description, []);
        covering.get(annotation.description).push({ title, test });
      }
    }
  }
  const results = [];
  const startedAt = report.stats?.startTime ?? new Date().toISOString();
  for (const testCase of cases.filter((c) => c.runner === "management")) {
    const tests = covering.get(testCase.id) ?? [];
    const base = { id: testCase.id, runner: "management", scenario: testCase.scenario, startedAt, finishedAt: new Date().toISOString(), serverTraceIds: [], queryEventIds: [], policyVersion: "unavailable", contextPolicyVersion: "unavailable", assertions: [], artifacts: [] };
    const missing = testCase.requires.filter((cap) => !capabilities.has(cap));
    let entry;
    if (tests.length === 0) {
      entry = { ...base, status: "blocked", detail: missing.length > 0 ? `missing capability: ${missing.join(", ")}; no spec covers this case yet` : "spec_not_implemented", blockedBy: missing.length > 0 ? missing : ["spec_not_implemented"] };
    } else {
      const statuses = tests.map(({ test }) => testStatus(test));
      const assertions = tests.flatMap(({ test }) => annotationsOf(test).filter((a) => a.type === "assert").map((a) => JSON.parse(a.description)));
      if (statuses.includes("failed")) {
        const failed = tests.filter(({ test }) => testStatus(test) === "failed").map(({ title }) => title);
        entry = { ...base, status: "failed", assertions, detail: `failing spec(s): ${failed.join(" | ")}`.slice(0, 500) };
      } else if (statuses.includes("blocked")) {
        const reasons = tests.flatMap(({ test }) => annotationsOf(test).filter((a) => a.type === "blocked").map((a) => a.description));
        entry = { ...base, status: "blocked", assertions, detail: reasons.join("; "), blockedBy: reasons };
      } else if (statuses.includes("skipped")) {
        entry = { ...base, status: "skipped", assertions, detail: "spec skipped without a BLOCKED annotation" };
      } else {
        const verdict = statusFromAssertions(testCase, { assertions });
        const evaluated = new Set(assertions.map((a) => a.token));
        const missing = testCase.assert.filter((token) => !evaluated.has(token));
        const contractOnly = contractOnlyTokensFor(tests, testCase.id);
        const allContractOnly = missing.length > 0 && missing.every((token) => contractOnly.has(token));
        if (allContractOnly) {
          entry = {
            ...base,
            status: "blocked",
            assertions,
            detail: `the runner bound to this case asserts only the binding contract; the declared live evidence (${missing.join(", ")}) is produced by no runner in this leg`,
            blockedBy: ["live_evidence_not_evaluated"]
          };
        } else {
          entry = { ...base, status: verdict.status, assertions, detail: verdict.detail };
        }
      }
    }
    results.push(entry);
  }
  return results;
}

export function writeManagementEvidence(run, cases, report, capabilities) {
  const results = collectManagementResults({ run, report, cases, capabilities });
  const dir = path.join(run.paths.runDir, "results", "management");
  mkdirSync(dir, { recursive: true });
  for (const entry of results) {
    const text = `${JSON.stringify({ id: entry.id, status: entry.status, detail: entry.detail, assertions: entry.assertions }, null, 2)}\n`;
    const file = path.join(dir, `${entry.id}.json`);
    writeFileSync(file, text);
    entry.artifacts = [{ path: path.relative(run.paths.runDir, file), sha256: createHash("sha256").update(text).digest("hex") }];
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  const overall = count("failed") > 0 ? "failed" : count("blocked") > 0 ? "blocked" : count("skipped") > 0 ? "skipped" : "passed";
  const evidence = {
    contract: "lucy-management-run-v1",
    runId: run.runId,
    executionMode: run.executionMode,
    finishedAt: new Date().toISOString(),
    caseCatalogDigest: run.caseCatalogDigest,
    capabilities: [...capabilities].sort(),
    summary: { selected: results.length, passed: count("passed"), failed: count("failed"), blocked: count("blocked"), skipped: count("skipped") },
    status: overall,
    cases: results
  };
  const out = path.join(run.paths.runDir, "results", "management.json");
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  return { evidence, out };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", report: "value" });
    if (!args.run || !args.report) fail("collect-management-results: --run and --report are required", 1);
    const run = loadRun(args.run);
    const report = JSON.parse(readFileSync(args.report, "utf8"));
    const { cases } = loadCatalog();
    const { evidence, out } = writeManagementEvidence(run, cases, report, managementCapabilities(run));
    process.stdout.write(`${JSON.stringify({ status: evidence.status, exitCode: EXIT_CODES[evidence.status], out, summary: evidence.summary })}\n`);
    process.exit(EXIT_CODES[evidence.status]);
  } catch (error) {
    fail(`collect-management-results: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
