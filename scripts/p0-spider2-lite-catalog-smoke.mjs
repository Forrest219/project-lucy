#!/usr/bin/env node
/**
 * G-cat: Spider2-lite eval catalog smoke (no DB / no agent).
 * Pass: YAML parseable via eval-runner --list-cases and case count >= min.
 */
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const CASES = "evals/spider2_lite_sqlite/eval/spider2_lite_sqlite-eval-cases.yaml";
const MIN = 17;
const OUT = "inbox/spider2-lite-sqlite/results/p0-spider2-lite-catalog-evidence.json";

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

const started = new Date().toISOString();
const { code, stdout, stderr } = await run(["scripts/eval-runner.mjs", "--list-cases", "--cases", CASES]);
process.stdout.write(stdout);
process.stderr.write(stderr);
const combined = `${stdout}\n${stderr}`;
const match = combined.match(/# loaded (\d+) case\(s\)/);
const count = match ? Number(match[1]) : 0;
const status = code === 0 && count >= MIN ? "pass" : "fail";
const evidence = {
  gateId: "G-cat",
  gateKind: "business-eval-catalog",
  suite: "spider2_lite_sqlite",
  status,
  stub: false,
  startedAt: started,
  finishedAt: new Date().toISOString(),
  casesPath: CASES,
  loadedCases: count,
  minCases: MIN,
  exitCode: code,
};
await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(evidence, null, 2) + "\n");
console.log(`\n[p0-spider2-lite-catalog] ${status.toUpperCase()} loaded=${count} evidence=${OUT}`);
process.exit(status === "pass" ? 0 : 1);
