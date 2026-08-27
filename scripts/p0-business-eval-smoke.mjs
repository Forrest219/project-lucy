#!/usr/bin/env node
import { spawn } from "node:child_process";

const suites = [
  {
    name: "superstore",
    path: "evals/superstore/eval/superstore-eval-cases.yaml",
    minCases: 1
  }
];

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-business-eval-smoke] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      if (code === 0) {
        resolve(`${stdout}\n${stderr}`);
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

try {
  for (const suite of suites) {
    const stdout = await run("node", ["scripts/eval-runner.mjs", "--list-cases", "--cases", suite.path]);
    const match = stdout.match(/# loaded (\d+) case\(s\)/);
    const count = match ? Number(match[1]) : 0;
    if (!Number.isInteger(count) || count < suite.minCases) {
      throw new Error(`${suite.name} suite loaded ${count} cases, expected at least ${suite.minCases}`);
    }
  }
  console.log("\n[p0-business-eval-smoke] PASS");
} catch (error) {
  console.error(`\n[p0-business-eval-smoke] FAIL: ${error.message}`);
  process.exit(1);
}
