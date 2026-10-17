#!/usr/bin/env node
// Security-integration runner (Spec §6.4 `run-security.mjs`, Plan T10 step 4).
//
//   node scripts/e2e/run-security.mjs --run inbox/e2e/<runId>/run.json [--only SEC-01,SEC-15-FM-01] [--dry-run]
//   node scripts/e2e/run-security.mjs --list
//
// Executes every catalog case whose runner is `security`, against a real Lucy process started for the run
// (HTTP + SQLite). A case missing a required capability, or lacking an implemented handler, is BLOCKED —
// never skipped and never passed. Exit codes follow Spec §8.2: 0 passed, 1 failed, 2 blocked, 3 dry-run.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { catalogDigest, checkLock, loadCatalog, readLock } from "./lib/catalog.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv, sha256Text } from "./lib/common.mjs";
import { ExternalInstance, LucyProcess, portOpen } from "./lib/instance.mjs";
import { SecurityContext } from "./security/context.mjs";

const HANDLER_MODULES = ["auth-cases", "mcp-cases", "content-cases", "fault-cases"];
const RUN_LAST = ["SEC-05-V01", "SEC-05-V02", "SEC-05-V04", "SEC-05-V05", "SEC-05-V06", "SEC-05-V03"];

export async function loadHandlers() {
  const merged = {};
  for (const name of HANDLER_MODULES) {
    const mod = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "security", `${name}.mjs`)));
    for (const [id, handler] of Object.entries(mod.handlers)) {
      if (merged[id]) throw new Error(`duplicate handler for ${id} (${name})`);
      merged[id] = handler;
    }
  }
  return merged;
}

/** Orders cases so stateful ones (throttling) cannot starve the rest; everything else keeps catalog order. */
export function executionOrder(cases) {
  const rank = (id) => (RUN_LAST.includes(id) ? 1000 + RUN_LAST.indexOf(id) : 0);
  return [...cases].sort((a, b) => rank(a.id) - rank(b.id));
}

export function missingCapabilities(testCase, capabilities) {
  return testCase.requires.filter((cap) => !capabilities[cap]);
}

async function detectCapabilities(run, lucyStarted, external) {
  const profile = run.profileDigest !== null;
  // For a runner-started instance the upstream port is probed locally; for an external (K8s) instance the
  // protected runner declares what the environment really provides.
  const declared = new Set((process.env.LUCY_REAL_E2E_CAPABILITIES ?? "").split(",").map((c) => c.trim()).filter(Boolean));
  return {
    "lucy-http": lucyStarted,
    "fault-control": lucyStarted && !external && run.instance.startedBy === "runner",
    "ktx-upstream": external ? declared.has("ktx-upstream") : await portOpen("127.0.0.1", Number(process.env.LUCY_PROXY_UPSTREAM_PORT ?? 7878)),
    postgres: run.db.applied === true || declared.has("postgres"),
    browser: false,
    "agent-client": false,
    "k8s-amd64": external && declared.has("k8s-amd64"),
    "ci-runner": false,
    "network-profile": external && declared.has("network-profile"),
    "clock-control": false,
    "npm-registry": false,
    _profileBound: profile
  };
}

async function versionsOf(ctx) {
  const out = { policyVersion: "unavailable", contextPolicyVersion: "unavailable" };
  try {
    const health = await ctx.web.request("GET", "/api/health");
    out.policyVersion = health.json?.data?.policy?.policyVersion ?? out.policyVersion;
    if (ctx.cookies.owner) {
      const role = await ctx.adminCall(ctx.cookies.owner, "GET", "/api/admin/roles/finance_reader");
      out.contextPolicyVersion = role.json?.data?.contextPolicyVersion ?? out.contextPolicyVersion;
    }
  } catch {
    // Versions are evidence metadata; a transient failure leaves them "unavailable" rather than invented.
  }
  return out;
}

export function statusFromAssertions(testCase, outcome) {
  const evaluated = new Set(outcome.assertions.map((a) => a.token));
  const missing = testCase.assert.filter((token) => !evaluated.has(token));
  const failed = outcome.assertions.filter((a) => !a.passed);
  if (missing.length > 0) return { status: "failed", detail: `declared assertion(s) never evaluated: ${missing.join(", ")}` };
  if (failed.length > 0) return { status: "failed", detail: failed.map((a) => `${a.token}: ${a.detail ?? "failed"}`).join(" | ") };
  return { status: "passed", detail: "" };
}

function writeCaseResult(run, testCase, body) {
  const dir = path.join(run.paths.runDir, "results", "security");
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify(body, null, 2)}\n`;
  const file = path.join(dir, `${testCase.id}.json`);
  writeFileSync(file, text);
  return { path: path.relative(run.paths.runDir, file), sha256: createHash("sha256").update(text).digest("hex") };
}

/** Runs the selected security cases and returns the evidence document (also written under results/). */
export async function runSecurity({ run, cases, handlers, only, dryRun = false, ctxFactory, external = false }) {
  const selected = executionOrder(cases.filter((c) => c.runner === "security" && (!only || only.has(c.id) || only.has(c.scenario))));
  const startedAt = new Date().toISOString();
  const results = [];
  let lucy = null;
  let ctx = null;
  let capabilities = {};
  try {
    if (!dryRun) {
      lucy = external ? new ExternalInstance(run) : new LucyProcess(run);
      await lucy.start();
      capabilities = await detectCapabilities(run, true, external);
      ctx = ctxFactory ? ctxFactory({ run, lucy, capabilities }) : new SecurityContext({ run, lucy, capabilities });
    }
    for (const testCase of selected) {
      const caseStarted = new Date().toISOString();
      const base = { id: testCase.id, runner: "security", scenario: testCase.scenario, startedAt: caseStarted };
      const finish = (extra) => {
        const entry = { ...base, finishedAt: new Date().toISOString(), serverTraceIds: [], queryEventIds: [], assertions: [], artifacts: [], ...extra };
        results.push(entry);
        return entry;
      };
      if (dryRun) {
        finish({ status: "dry_run", policyVersion: "n/a", contextPolicyVersion: "n/a", detail: "dry run: nothing executed" });
        continue;
      }
      const missing = missingCapabilities(testCase, capabilities);
      if (missing.length > 0) {
        finish({ status: "blocked", policyVersion: "n/a", contextPolicyVersion: "n/a", detail: `missing capability: ${missing.join(", ")}`, blockedBy: missing });
        continue;
      }
      const handler = handlers[testCase.id];
      if (!handler) {
        finish({ status: "blocked", policyVersion: "n/a", contextPolicyVersion: "n/a", detail: "handler_not_implemented", blockedBy: ["handler_not_implemented"] });
        continue;
      }
      let outcome;
      try {
        outcome = await handler(ctx);
      } catch (error) {
        const versions = await versionsOf(ctx);
        const entry = finish({ status: "failed", ...versions, detail: `handler_error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) });
        entry.artifacts = [writeCaseResult(run, testCase, { id: testCase.id, status: "failed", detail: entry.detail })];
        continue;
      }
      const verdict = statusFromAssertions(testCase, outcome);
      const versions = await versionsOf(ctx);
      const entry = finish({
        status: verdict.status,
        ...versions,
        assertions: outcome.assertions,
        ...(outcome.denyReason ? { denyReason: outcome.denyReason } : {}),
        ...(outcome.upstreamExecutions !== undefined ? { upstreamExecutions: outcome.upstreamExecutions } : {}),
        ...(outcome.leakage ? { leakage: outcome.leakage } : {}),
        detail: verdict.detail
      });
      entry.artifacts = [writeCaseResult(run, testCase, { id: testCase.id, status: entry.status, detail: entry.detail, assertions: entry.assertions, denyReason: entry.denyReason, leakage: entry.leakage })];
    }
  } finally {
    if (lucy) await lucy.stop("SIGTERM");
  }

  const count = (status) => results.filter((r) => r.status === status).length;
  const overall = count("failed") > 0 ? "failed" : count("blocked") > 0 ? "blocked" : count("dry_run") > 0 ? "dry_run" : results.length === 0 ? "blocked" : "passed";
  return {
    contract: "lucy-security-run-v1",
    runId: run.runId,
    executionMode: dryRun ? "dry_run" : run.executionMode,
    startedAt,
    finishedAt: new Date().toISOString(),
    caseCatalogDigest: run.caseCatalogDigest,
    capabilities: Object.fromEntries(Object.entries(capabilities).filter(([key]) => !key.startsWith("_"))),
    summary: {
      selected: results.length,
      passed: count("passed"),
      failed: count("failed"),
      blocked: count("blocked"),
      dryRun: count("dry_run"),
      unimplemented: results.filter((r) => r.detail === "handler_not_implemented").map((r) => r.id)
    },
    status: overall,
    cases: results
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", only: "value", "dry-run": "boolean", list: "boolean", external: "boolean" });
    const { cases } = loadCatalog();
    const lockProblems = checkLock(cases, readLock());
    if (lockProblems.length > 0) fail(`run-security: catalog drifted from its lock:\n- ${lockProblems.join("\n- ")}`, 1);
    const handlers = await loadHandlers();
    const security = cases.filter((c) => c.runner === "security");
    if (args.list) {
      process.stdout.write(`${JSON.stringify({ mode: "list", total: security.length, implemented: security.filter((c) => handlers[c.id]).length, cases: security.map((c) => ({ id: c.id, requires: c.requires, implemented: Boolean(handlers[c.id]) })) }, null, 2)}\n`);
      process.exit(0);
    }
    if (!args.run) fail("run-security: --run <run.json> is required (or --list)", 1);
    const run = loadRun(args.run);
    if (run.caseCatalogDigest !== catalogDigest(cases)) fail("run-security: run.json was prepared against a different catalog digest", 1);
    const only = args.only ? new Set(args.only.split(",").map((s) => s.trim()).filter(Boolean)) : null;
    if (only) {
      const known = new Set([...security.map((c) => c.id), ...security.map((c) => c.scenario)]);
      for (const id of only) if (!known.has(id)) fail(`run-security: unknown case or scenario "${id}"`, 1);
    }
    const evidence = await runSecurity({ run, cases, handlers, only, dryRun: args["dry-run"] === true, external: args.external === true });
    const out = path.join(run.paths.runDir, "results", "security.json");
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
    const code = EXIT_CODES[evidence.status];
    process.stdout.write(`${JSON.stringify({ status: evidence.status, exitCode: code, out, summary: evidence.summary, runDigest: sha256Text(JSON.stringify(evidence)).slice(0, 12) })}\n`);
    process.exit(code);
  } catch (error) {
    fail(`run-security: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
