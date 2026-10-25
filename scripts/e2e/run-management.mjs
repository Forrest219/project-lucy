#!/usr/bin/env node
// Runs the real-user management journey (Playwright, desktop Chromium 1440x900, 1 worker, 0 retries) against the
// run's own Lucy instance, then converts the report to per-case evidence.
//
//   node scripts/e2e/run-management.mjs --run inbox/e2e/<runId>/run.json [--project chromium] [--grep <regex>]
//
// Local runs start (and stop) the run's own Lucy process; the instance is never a pre-existing unknown service.
// Exit codes follow Spec §8.2 and come from the evidence, not from Playwright's own exit status.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadCatalog } from "./lib/catalog.mjs";
import { EXIT_CODES, REPO_ROOT, fail, loadRun, parseArgv } from "./lib/common.mjs";
import { scanRetainedArtifacts } from "./lib/leak-scan.mjs";
import { ExternalInstance, LucyProcess } from "./lib/instance.mjs";
import { startKtxUpstream } from "./lib/ktx-upstream.mjs";
import { withProvenUpstream } from "./lib/upstream-capability.mjs";
import { reconcileExternalFlag, TargetIdentityError } from "./lib/target-identity.mjs";
import { managementCapabilities, writeManagementEvidence } from "./collect-management-results.mjs";
import { writeV025Evidence } from "./collect-v025-results.mjs";
import { loadCoverage } from "./lib/v025-coverage.mjs";

/** Reads a JSON file if it exists; a missing file is not an error here. */
function readJsonIfExists(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function progressLog(run, message) {
  try {
    appendFileSync(path.join(run.paths.logs, "progress.log"), `${new Date().toISOString()} ${message}\n`);
  } catch {
    // best-effort
  }
}

async function runPlaywright(run, { project, grep, upstream }) {
  const webui = path.join(REPO_ROOT, "webui");
  const bin = path.join(webui, "node_modules", ".bin", "playwright");
  const args = ["test", "-c", "playwright.real.config.ts", "--project", project, "--workers", "1", "--retries", "0"];
  if (grep) args.push("--grep", grep);
  const env = { ...process.env, LUCY_REAL_E2E_RUN: path.join(run.paths.runDir, "run.json") };
  for (const key of Object.keys(env)) if (key.startsWith("LUCY_E2E_")) delete env[key];
  env.PATH = (env.PATH ?? "").split(":").filter((entry) => !entry.endsWith("tests/e2e/fixtures/bin")).join(":");
  // The upstream readiness flag is the ONLY thing that grants the `ktx-upstream`
  // capability to the specs. It is set here, after the upstream really answered
  // on its port — never because somebody declared the capability in the env.
  if (upstream?.ok) {
    env.LUCY_PROXY_UPSTREAM_HOST = upstream.host;
    env.LUCY_PROXY_UPSTREAM_PORT = String(upstream.port);
    env.LUCY_REAL_E2E_UPSTREAM_READY = "1";
  } else {
    delete env.LUCY_REAL_E2E_UPSTREAM_READY;
  }
  const child = spawn(bin, args, { cwd: webui, env, stdio: "inherit" });
  return new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

function secretsOf(run) {
  const dir = run.secretsDir;
  const read = (name) => JSON.parse(readFileSync(path.join(dir, name), "utf8"));
  return [
    ...Object.values(read("tokens.json")),
    read("admins.json").owner.password,
    read("admins.json").operator.password,
    readFileSync(path.join(dir, "bootstrap-token"), "utf8").trim()
  ];
}

/**
 * Inventory every file the run actually kept under client-work/ (browser-side artifacts) so the
 * gate collector's carrier scan can prove "no sensitive capture". The captured artifact inventory
 * is recorded in <runDir>/capture-policy.json together with the Playwright config that enforces it.
 * Plan A6 §no-sensitive-capture: trace / screenshot / video are OFF in the Playwright config; this
 * function ALSO scans client-work/ for anything that was actually written so the policy and the
 * truth agree.
 */
function buildCapturePolicyArtifact(run) {
  const configPath = path.join(REPO_ROOT, "webui", "playwright.real.config.ts");
  const configText = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  // Cheap regex: pull the `use:` block's trace/screenshot/video lines from the file we run against.
  const pick = (key) => {
    const m = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`).exec(configText);
    return m ? m[1] : "unknown";
  };
  const enforced = { trace: pick("trace"), screenshot: pick("screenshot"), video: pick("video") };
  const inventory = { clientWork: [], capture: [], screenshots: [], traces: [], attachments: [], other: [] };
  function classify(parentDir) {
    const base = path.basename(parentDir);
    if (base === "screenshots" || base === "screenshot") return "screenshots";
    if (base === "traces" || base === "trace") return "traces";
    if (base === "attachments" || base === "attachment") return "attachments";
    if (base === "capture") return "capture";
    return null;
  }
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const lst = statSync(full);
        const bucket = classify(dir) ?? "other";
        inventory[bucket].push({ path: path.relative(run.paths.runDir, full), bytes: lst.size });
      }
    }
  }
  walk(run.paths["client-work"]);
  return {
    contract: "lucy-capture-policy-v1",
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    policy: { ...enforced, source: "webui/playwright.real.config.ts" },
    inventory,
    violated: enforced.trace !== "off" || enforced.screenshot !== "off" || enforced.video !== "off"
  };
}

/**
 * The capability set the evidence may rely on.
 *
 * `ktx-upstream` is granted only by proof — the run's own upstream really
 * answered on its port. A missing upstream is never papered over, and a
 * declaration alone never grants it.
 */
function v025Capabilities(run, upstream, external, env = process.env) {
  return withProvenUpstream(managementCapabilities(run, env), {
    external,
    upstreamOk: upstream?.ok === true,
    env
  });
}

const args = (() => {
  try {
    return parseArgv(process.argv.slice(2), { run: "value", project: "value", grep: "value", external: "boolean", "ktx-bin": "value" });
  } catch (error) {
    return fail(`run-management: ${error.message}`, 1);
  }
})();
if (!args.run) fail("run-management: --run <run.json> is required", 1);
const run = loadRun(args.run);
const project = args.project ?? "chromium";
if (project !== "chromium") fail(`run-management: only the chromium desktop project is supported (got "${project}")`, 1);
const externalCheck = reconcileExternalFlag({ run, flagValue: args.external === true });
if (!externalCheck.ok) fail(`run-management: ${externalCheck.problems.join("; ")}`, EXIT_CODES.blocked);

mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
mkdirSync(run.paths.logs, { recursive: true });
let lucy = null;
let upstream = null;
let exitCode = 1;
try {
  if (args.external) {
    // External management: preflight FIRST (no auth, no bootstrap consumption). The management
    // journey itself performs first-owner bootstrap on a fresh target (the Playwright UX-01
    // cases), so postflight MUST run AFTER the intended bootstrap, not before. Running both
    // phases up-front would let postflight's ownerLogin consume the bootstrap token before
    // Playwright got a chance, and on a fresh `bootstrap`-mode target postflight refuses with
    // `needs-bootstrap` — the journey would never run.
    lucy = new ExternalInstance(run);
    progressLog(run, "external target: running preflight (no auth, no bootstrap)");
    try {
      await lucy.verifyPreflight();
    } catch (error) {
      if (error instanceof TargetIdentityError) {
        const code = error.classification === "missing_measurement" ? EXIT_CODES.blocked : EXIT_CODES.failed;
        fail(`run-management: preflight refused: ${error.message} (stage=${error.stage} classification=${error.classification})`, code);
      }
      throw error;
    }
    progressLog(run, "external target preflight ok; management journey will perform first-owner bootstrap then we re-verify postflight");
  } else {
    // The data plane needs a KTX upstream. The run starts its OWN upstream for
    // its OWN project instead of trusting a host service that may not exist:
    // without it every query answers empty and the run would record a product
    // defect that is really a missing environment.
    upstream = await startKtxUpstream(run, { ktxBin: args["ktx-bin"] ?? "ktx" });
    if (upstream.ok) {
      progressLog(run, `KTX upstream started for this run on ${upstream.host}:${upstream.port} (log: ${upstream.logPath})`);
    } else {
      progressLog(run, `KTX upstream NOT available: ${upstream.reason}; the specs that need the data plane stay BLOCKED`);
    }
    lucy = new LucyProcess(run, {
      extraEnv: upstream.ok
        ? { LUCY_PROXY_UPSTREAM_HOST: upstream.host, LUCY_PROXY_UPSTREAM_PORT: String(upstream.port) }
        : {}
    });
    await lucy.start();
  }
  const playwrightExit = await runPlaywright(run, { project, grep: args.grep, upstream });
  const reportPath = path.join(run.paths.runDir, "results", "management-playwright.json");
  if (!existsSync(reportPath)) fail(`run-management: Playwright produced no report (exit ${playwrightExit}); see its output above`, 1);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  // External mode: re-run postflight AFTER the management journey so the bootstrap that the
  // Playwright UX-01 cases just performed is observed. Postflight logs in as owner and reads
  // the run-scoped marker; if the target is still in `bootstrap` mode here the run is BLOCKED
  // because the intended UI bootstrap never actually happened (B2 lifecycle contract).
  if (args.external) {
    progressLog(run, "external target: running postflight (after intended UI bootstrap)");
    try {
      await lucy.verifyPostflight();
    } catch (error) {
      if (error instanceof TargetIdentityError) {
        const blocked = error.classification === "missing_measurement" || (error.stage === "postflight" && error.aspects?.ownerLogin?.classification === "missing_measurement");
        const code = blocked ? EXIT_CODES.blocked : EXIT_CODES.failed;
        fail(`run-management: postflight refused: ${error.message} (stage=${error.stage} classification=${error.classification})`, code);
      }
      throw error;
    }
    progressLog(run, "external target postflight ok (marker read after intended bootstrap)");
  }
  const { cases } = loadCatalog();
  // The SAME verified capability set feeds the frozen evidence and the v0.25
  // evidence: a capability the run really has must not be reported missing in one
  // and present in the other.
  const capabilities = v025Capabilities(run, upstream, args.external === true);
  const { evidence, out } = writeManagementEvidence(run, cases, report, capabilities);
  // Capture-policy artifact: required for SEC-06-V04 so the gate collector can prove that
  // trace / screenshot / video are off AND that the run actually produced no client-side
  // attachments. Persisted next to the report; the gate collector reads it from <runDir>/.
  const capturePolicy = buildCapturePolicyArtifact(run);
  writeFileSync(path.join(run.paths.runDir, "capture-policy.json"), `${JSON.stringify(capturePolicy, null, 2)}\n`);
  // Carrier-aware leak scan of the management run's retained artifacts (results + the
  // management client work + the just-written capture policy). verdict priority: failed > blocked.
  const leak = scanRetainedArtifacts(path.join(run.paths.runDir, "results"), { secrets: secretsOf(run), forbiddenCanaries: [] });
  if (leak.status === "failed") evidence.status = "failed";
  evidence.artifactScan = leak;
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  // v0.25 execution items: the 173 new items get their per-dimension status from
  // this run's browser leg. The frozen evidence above is NOT affected by this
  // file — it is a separate report, and a v0.25 item is never a frozen case.
  const v025 = writeV025Evidence(run, {
    coverage: loadCoverage(),
    report,
    capabilities: v025Capabilities(run, upstream, args.external === true),
    journeyState: readJsonIfExists(path.join(run.paths.runDir, "j01-state.json"))
  });
  progressLog(run, `v0.25 execution-item evidence written to ${v025.dir} (${v025.results.length} items)`);
  exitCode = EXIT_CODES[evidence.status];
  process.stdout.write(`${JSON.stringify({ status: evidence.status, exitCode, out, summary: evidence.summary, artifactScan: leak })}\n`);
} finally {
  if (lucy) await lucy.stop("SIGTERM");
  if (upstream?.ok) await upstream.stop();
}
process.exit(exitCode);
