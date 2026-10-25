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
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { catalogDigest, checkLock, loadCatalog, readLock } from "./lib/catalog.mjs";
import { EXIT_CODES, fail, loadRun, parseArgv, sha256Text } from "./lib/common.mjs";
import { ExternalInstance, LucyProcess } from "./lib/instance.mjs";
import { startKtxUpstream } from "./lib/ktx-upstream.mjs";
import { reconcileExternalFlag, TargetIdentityError } from "./lib/target-identity.mjs";
import { SecurityContext } from "./security/context.mjs";

const HANDLER_MODULES = ["auth-cases", "mcp-cases", "content-cases", "fault-cases", "data-cases", "row-policy-cases", "remaining-auth-cases", "remaining-content-cases", "remaining-file-cases", "offline-candidate-cases"];
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

async function detectCapabilities(run, lucyStarted, external, upstream) {
  const profile = run.profileDigest !== null;
  // For a runner-started instance the upstream is the one THIS run started, and the
  // capability is granted by proof. Probing a host default port (the old behaviour) could
  // either miss the run's data plane or hand the run somebody else's upstream — and a
  // data plane that answers empty reads like a product defect and is not one. For an
  // external (K8s) instance the upstream lives in the cluster and cannot be probed from
  // here, so the protected runner declares what the environment really provides.
  const declared = new Set((process.env.LUCY_REAL_E2E_CAPABILITIES ?? "").split(",").map((c) => c.trim()).filter(Boolean));
  return {
    "lucy-http": lucyStarted,
    "fault-control": lucyStarted && !external && run.instance.startedBy === "runner",
    "ktx-upstream": external ? declared.has("ktx-upstream") : upstream?.ok === true,
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

/**
 * True when the handler failed because the TARGET SERVICE was not reachable — not because
 * the product misbehaved. `fetch` reports an unreachable origin as the aggregate `fetch
 * failed`; a local instance that died during (re)start surfaces as "exited during startup".
 *
 * Such a case was never evaluated, so it must be BLOCKED. Scoring it as a product failure
 * would attribute a harness/environment outage to the product (R‑11 / R‑16).
 */
export function isServiceUnreachable(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|exited during startup|socket hang up/i.test(message)) return true;
  const cause = error?.cause;
  if (cause) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|socket hang up/i.test(causeMessage)) return true;
    if (Array.isArray(cause.errors) && cause.errors.some((e) => /ECONNREFUSED|ECONNRESET/i.test(String(e?.code ?? e?.message ?? e)))) return true;
  }
  return false;
}

/**
 * How a handler that THREW must be scored.
 *
 * A case is only a product failure when the product actually answered and answered wrong.
 * Two kinds of throw mean the case was never evaluated at all, and both are BLOCKED:
 *   - a precondition the handler could not obtain (the product's own login rate limit,
 *     a missing turn id, an empty audit trail) — reported as `precondition_unavailable`;
 *   - an unreachable target (the service was down) — reported as `service_unreachable`.
 * Everything else is a real product failure.
 */
export function classifyHandlerError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const blockedReason = error?.blockedReason ?? null;
  if (blockedReason) {
    return { status: "blocked", detail: `precondition_unavailable: ${message}`.slice(0, 500), blockedBy: [blockedReason] };
  }
  if (isServiceUnreachable(error)) {
    return { status: "blocked", detail: `service_unreachable: ${message}`.slice(0, 500), blockedBy: ["service_unreachable"] };
  }
  return { status: "failed", detail: `handler_error: ${message}`.slice(0, 500) };
}

export function statusFromAssertions(testCase, outcome) {
  const evaluated = new Set(outcome.assertions.map((a) => a.token));
  const missing = testCase.assert.filter((token) => !evaluated.has(token));
  const failed = outcome.assertions.filter((a) => !a.passed);
  if (missing.length > 0) return { status: "failed", detail: `declared assertion(s) never evaluated: ${missing.join(", ")}` };
  // Distinguish a measurement gap (the observer returned `unknown` so the case could
  // not prove an authorized-zero / unauthorized-zero claim) from a real feature failure
  // (the gate denied / produced the wrong rows / scanned a leak). A measurement-gap
  // blocks the case so it cannot claim a green pass; a feature-failure is the
  // existing `failed` verdict. A `blocked` verdict ranks LOWER than `failed` in the
  // summary so an unprovable case never masks a real failure.
  const measurementGap = (outcome.upstreamExecutions === "unknown" || (outcome.upstreamExecutions && outcome.upstreamExecutions.upstreamExecutionCount === "unknown"));
  if (measurementGap && failed.length === 0) {
    return { status: "blocked", detail: "independent observer reported 'unknown' for this case window; the runner cannot prove the authorization claim without a measured source" };
  }
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

function progressLog(run, message) {
  try { appendFileSync(path.join(run.paths.logs, "progress.log"), `${new Date().toISOString()} ${message}\n`); } catch { /* best-effort */ }
}

/** Runs the selected security cases and returns the evidence document (also written under results/). */
export async function runSecurity({ run, cases, handlers, only, dryRun = false, ctxFactory, external = false, onTargetRefused = fail, observerFactory = null, ktxBin = "ktx" }) {
  const externalCheck = reconcileExternalFlag({ run, flagValue: external });
  if (!externalCheck.ok) onTargetRefused(`run-security: ${externalCheck.problems.join("; ")}`, EXIT_CODES.blocked);
  const selected = executionOrder(cases.filter((c) => c.runner === "security" && (!only || only.has(c.id) || only.has(c.scenario))));
  const startedAt = new Date().toISOString();
  const results = [];
  let lucy = null;
  let ctx = null;
  let capabilities = {};
  let activeObserver = null;
  let upstream = null;
  try {
    if (!dryRun) {
      if (external) {
        progressLog(run, "external target: running preflight (no auth, no bootstrap)");
        lucy = new ExternalInstance(run);
        try {
          await lucy.start();
        } catch (error) {
          if (error instanceof TargetIdentityError) {
            const blocked = error.classification === "missing_measurement" || (error.stage === "postflight" && error.aspects?.ownerLogin?.classification === "missing_measurement");
            const code = blocked ? EXIT_CODES.blocked : EXIT_CODES.failed;
            onTargetRefused(`run-security: target verification refused: ${error.message} (stage=${error.stage} classification=${error.classification})`, code);
            // onTargetRefused is expected to terminate (process.exit). If a test provided a
            // non-terminating hook we still need to abort the runner.
            throw error;
          }
          throw error;
        }
        progressLog(run, "external target verified (preflight + postflight)");
      } else {
        // The data plane needs a KTX upstream. The run starts its OWN upstream for its OWN
        // project (same recipe as the management and agent legs) instead of probing a host
        // default port: without it every query answers empty, which reads like a product
        // defect and is not one.
        upstream = await startKtxUpstream(run, { ktxBin });
        if (upstream.ok) {
          progressLog(run, `KTX upstream started for this run on ${upstream.host}:${upstream.port} (log: ${upstream.logPath})`);
        } else {
          progressLog(run, `KTX upstream NOT available: ${upstream.reason}; every case that needs the data plane stays BLOCKED`);
        }
        lucy = new LucyProcess(run, upstream.ok
          ? { extraEnv: { LUCY_PROXY_UPSTREAM_HOST: upstream.host, LUCY_PROXY_UPSTREAM_PORT: String(upstream.port) } }
          : {});
        await lucy.start();
      }
      capabilities = await detectCapabilities(run, true, external, upstream);
      // Default observer factory: only used when the caller did not supply one. The
      // factory is bound to the RUN'S registered target type; for external runs it
      // returns null (no in-process recording), so the SecurityContext reports
      // `unknown`. For local runs the factory constructs a loopback observer that
      // sits between the LucyProcess and the upstream; the runner is responsible for
      // calling `ensureStarted(upstreamUrl)` and `stop()` around the case loop.
      let factory = observerFactory;
      if (typeof factory !== "function") {
        try {
          const { createDefaultObserverFactory } = await import("./lib/local-loopback-observer.mjs");
          factory = createDefaultObserverFactory({ run });
        } catch { /* module optional; missing import leaves factory null */ }
      }
      ctx = ctxFactory
        ? ctxFactory({ run, lucy, capabilities, observerFactory: factory })
        : new SecurityContext({ run, lucy, capabilities, observerFactory: factory });
      // Stash the active observer on the context so the runner can start/stop it
      // around the case loop without going through the factory.
      if (factory) {
        const sample = factory({ agentId: "runner-bootstrap", identity: "lucy-e2e-observer", runId: run.runId, instanceId: run.instanceId });
        if (sample && typeof sample.ensureStarted === "function") activeObserver = sample;
      }
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
        const verdict = classifyHandlerError(error);
        const entry = finish({ ...verdict, ...versions });
        entry.artifacts = [writeCaseResult(run, testCase, { id: testCase.id, status: entry.status, detail: entry.detail, blockedBy: entry.blockedBy })];
        // Bring the target back before the next case, otherwise every later case would be
        // scored against a service that is not running.
        if (verdict.blockedBy?.includes("service_unreachable") && lucy && typeof lucy.restart === "function") {
          try {
            await lucy.restart("SIGKILL");
            progressLog(run, `recovered the Lucy instance after a service outage (${testCase.id})`);
          } catch (recoveryError) {
            progressLog(run, `could NOT recover the Lucy instance after a service outage (${testCase.id}): ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
          }
        }
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
    if (activeObserver && typeof activeObserver.stop === "function") {
      try { await activeObserver.stop(); } catch { /* best-effort */ }
    }
    if (lucy) await lucy.stop("SIGTERM");
    if (upstream?.ok) await upstream.stop();
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
    // The data plane this run really had: a local run owns the upstream it started;
    // an external run's upstream lives in the cluster and is only attested, never
    // probed from here.
    upstream: upstream?.ok === true
      ? { status: "proven", host: upstream.host, port: upstream.port, ownedByRun: true }
      : { status: external ? "attested_external" : "unavailable", ownedByRun: false, reason: upstream?.reason ?? null },
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
    const args = parseArgv(process.argv.slice(2), { run: "value", only: "value", "dry-run": "boolean", list: "boolean", external: "boolean", "ktx-bin": "value" });
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
    const evidence = await runSecurity({ run, cases, handlers, only, dryRun: args["dry-run"] === true, external: args.external === true, ktxBin: args["ktx-bin"] ?? "ktx" });
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
