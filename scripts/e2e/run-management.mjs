#!/usr/bin/env node
// Runs the real-user management journey (Playwright, desktop Chromium 1440x900, 1 worker, 0 retries) against the
// run's own Lucy instance, then converts the report to per-case evidence.
//
//   node scripts/e2e/run-management.mjs --run inbox/e2e/<runId>/run.json [--project chromium] [--grep <regex>]
//
// Local runs start (and stop) the run's own Lucy process; the instance is never a pre-existing unknown service.
// Exit codes follow Spec §8.2 and come from the evidence, not from Playwright's own exit status.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadCatalog } from "./lib/catalog.mjs";
import { EXIT_CODES, REPO_ROOT, fail, loadRun, parseArgv } from "./lib/common.mjs";
import { scanText } from "./lib/leak-scan.mjs";
import { LucyProcess } from "./lib/instance.mjs";
import { managementCapabilities, writeManagementEvidence } from "./collect-management-results.mjs";

async function runPlaywright(run, { project, grep }) {
  const webui = path.join(REPO_ROOT, "webui");
  const bin = path.join(webui, "node_modules", ".bin", "playwright");
  const args = ["test", "-c", "playwright.real.config.ts", "--project", project, "--workers", "1", "--retries", "0"];
  if (grep) args.push("--grep", grep);
  const env = { ...process.env, LUCY_REAL_E2E_RUN: path.join(run.paths.runDir, "run.json") };
  for (const key of Object.keys(env)) if (key.startsWith("LUCY_E2E_")) delete env[key];
  env.PATH = (env.PATH ?? "").split(":").filter((entry) => !entry.endsWith("tests/e2e/fixtures/bin")).join(":");
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

/** Every artifact the run kept (Playwright output, per-case results, the report itself) is scanned for credentials. */
function scanRetainedArtifacts(run) {
  const secrets = secretsOf(run);
  const files = [path.join(run.paths.runDir, "results", "management-playwright.json")];
  let hits = 0;
  for (const file of files) if (existsSync(file)) hits += scanText(readFileSync(file, "utf8"), { secrets }).length;
  return { scanned: files.filter(existsSync).length, hits };
}

const args = (() => {
  try {
    return parseArgv(process.argv.slice(2), { run: "value", project: "value", grep: "value", external: "boolean" });
  } catch (error) {
    return fail(`run-management: ${error.message}`, 1);
  }
})();
if (!args.run) fail("run-management: --run <run.json> is required", 1);
const run = loadRun(args.run);
const project = args.project ?? "chromium";
if (project !== "chromium") fail(`run-management: only the chromium desktop project is supported (got "${project}")`, 1);

mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
let lucy = null;
let exitCode = 1;
try {
  if (!args.external) {
    lucy = new LucyProcess(run);
    await lucy.start();
  }
  const playwrightExit = await runPlaywright(run, { project, grep: args.grep });
  const reportPath = path.join(run.paths.runDir, "results", "management-playwright.json");
  if (!existsSync(reportPath)) fail(`run-management: Playwright produced no report (exit ${playwrightExit}); see its output above`, 1);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const { cases } = loadCatalog();
  const { evidence, out } = writeManagementEvidence(run, cases, report, managementCapabilities(run));
  const leak = scanRetainedArtifacts(run);
  if (leak.hits > 0) evidence.status = "failed";
  evidence.artifactScan = leak;
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
  exitCode = EXIT_CODES[evidence.status];
  process.stdout.write(`${JSON.stringify({ status: evidence.status, exitCode, out, summary: evidence.summary, artifactScan: leak })}\n`);
} finally {
  if (lucy) await lucy.stop("SIGTERM");
}
process.exit(exitCode);
