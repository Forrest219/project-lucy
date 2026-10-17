#!/usr/bin/env node
// Records one existing platform gate result (G1–G4, ELF, G4b, G8, Helm, K8s upgrade …) bound to the image digest it
// ran on, into <runDir>/results/existing-gates.json. CI steps call it with the step's own exit code; the status is
// derived from that code only (Spec §8.2), never from output text.
//   node scripts/gates/record-gate-result.mjs --run <run.json> --name g2-elf-arch --exit-code $? --image-digest sha256:…
//   node scripts/gates/record-gate-result.mjs --results-dir release/results --name …   (CI job that has no run yet)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { EXIT_CODES, fail, loadRun, parseArgv } from "../e2e/lib/common.mjs";

export function statusFromExitCode(code) {
  if (code === 0) return "passed";
  if (code === 2 || code === 42) return "blocked";
  if (code === 3) return "skipped";
  return "failed";
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", "results-dir": "value", name: "value", "exit-code": "value", "image-digest": "value" });
    for (const key of ["name", "exit-code", "image-digest"]) if (args[key] === undefined) fail(`record-gate-result: --${key} is required`, 1);
    if ((args.run === undefined) === (args["results-dir"] === undefined)) fail("record-gate-result: give exactly one of --run or --results-dir", 1);
    if (!/^sha256:[0-9a-f]{64}$/.test(args["image-digest"])) fail("record-gate-result: --image-digest must be sha256:<64 hex>", 1);
    const resultsDir = args["results-dir"] ? path.resolve(args["results-dir"]) : path.join(loadRun(args.run).paths.runDir, "results");
    const file = path.join(resultsDir, "existing-gates.json");
    mkdirSync(path.dirname(file), { recursive: true });
    const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { contract: "lucy-existing-gates-v1", gates: [] };
    const status = statusFromExitCode(Number(args["exit-code"]));
    doc.gates = [...doc.gates.filter((g) => g.name !== args.name), { name: args.name, status, imageDigest: args["image-digest"], exitCode: Number(args["exit-code"]), recordedAt: new Date().toISOString() }];
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ name: args.name, status, exitCode: EXIT_CODES[status] })}\n`);
  } catch (error) {
    fail(`record-gate-result: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
