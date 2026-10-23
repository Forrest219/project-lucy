#!/usr/bin/env node
// Detach run-agent-journey from the parent shell/process group so IDE shell teardown
// cannot SIGKILL the long-running E2E (LucyProcess already uses detached:true; the
// journey itself previously did not).
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { REPO_ROOT, fail, parseArgv } from "./lib/common.mjs";

const args = parseArgv(process.argv.slice(2), {
  run: "value",
  "allow-unisolated-local": "boolean",
  external: "boolean",
  clients: "value"
});
if (!args.run) fail("launch-agent-detached: --run <run.json> is required", 1);

const runJson = path.resolve(REPO_ROOT, args.run);
const run = JSON.parse(readFileSync(runJson, "utf8"));
const logDir = run.paths?.logs ?? path.join(path.dirname(runJson), "logs");
mkdirSync(logDir, { recursive: true });
const outPath = path.join(logDir, "agent-journey.stdout.log");
const pidPath = path.join(logDir, "agent-journey.pid");
const out = openSync(outPath, "a");

const journey = path.join(REPO_ROOT, "scripts", "e2e", "run-agent-journey.mjs");
const argv = [journey, "--run", runJson];
if (args["allow-unisolated-local"]) argv.push("--allow-unisolated-local");
if (args.external) argv.push("--external");
if (args.clients) argv.push("--clients", args.clients);

const child = spawn(process.execPath, argv, {
  cwd: REPO_ROOT,
  env: {
    ...process.env,
    LUCY_REAL_E2E_CAPABILITIES:
      process.env.LUCY_REAL_E2E_CAPABILITIES ?? "ktx-upstream,postgres,agent-client,network-profile",
    PATH: process.env.PATH
  },
  stdio: ["ignore", out, out],
  detached: true
});
closeSync(out);
writeFileSync(pidPath, `${child.pid}\n`);
child.unref();
process.stdout.write(`${JSON.stringify({ pid: child.pid, pidFile: pidPath, log: outPath, run: runJson })}\n`);
process.exit(0);
