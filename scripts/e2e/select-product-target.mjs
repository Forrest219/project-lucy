#!/usr/bin/env node
// One product target, or a listing of the seven targets.
// `--list` prints and returns. It does not prepare a run or start Playwright.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { REPO_ROOT, fail } from "./lib/common.mjs";
import {
  LIFECYCLE_COMMAND,
  lifecycleSelectionFromChecklist,
  managementPlaywrightArgs,
  renderSelection,
  selectProductTarget
} from "./lib/product-targets.mjs";

const argv = process.argv.slice(2);
let selected;
try {
  selected = selectProductTarget(argv);
} catch (error) {
  fail(`e2e:product: ${error.message}`, 1);
}
if (!selected.execute) {
  process.stdout.write(renderSelection(selected));
  process.exit(0);
}

const runFlag = argv.indexOf("--run");
const run = runFlag >= 0 ? argv[runFlag + 1] : undefined;
const node = process.execPath;

if (selected.target === "LIFECYCLE") {
  if (argv.some((arg) => arg.includes("run-upgrade.mjs") && !arg.includes("run-upgrade-features.mjs"))) {
    fail("e2e:product: LIFECYCLE does not call run-upgrade.mjs", 1);
  }
  const child = spawnSync(node, [path.join(REPO_ROOT, LIFECYCLE_COMMAND)], { cwd: REPO_ROOT, encoding: "utf8" });
  process.stderr.write(child.stderr ?? "");
  const line = (child.stdout ?? "").trim().split("\n").filter(Boolean).at(-1);
  let summary = null;
  try {
    summary = JSON.parse(line ?? "");
  } catch {
    summary = null;
  }
  if (!summary?.runDir) fail("e2e:product: upgrade-features did not report a child run", child.status || 1);
  const resultFile = path.join(summary.runDir, "upgrade-checklist.json");
  const checklist = JSON.parse(readFileSync(resultFile, "utf8"));
  const selection = lifecycleSelectionFromChecklist(checklist, { childRunId: checklist.runId, resultFile });
  writeFileSync(path.join(summary.runDir, "selection.json"), `${JSON.stringify(selection, null, 2)}\n`);
  process.stdout.write(child.stdout ?? "");
  process.exit(child.status ?? 1);
}

if (!run) fail("e2e:product: --run <run.json> is required", 1);
if (selected.target === "AGENT") {
  const child = spawnSync(node, [
    path.join(REPO_ROOT, "scripts/e2e/run-agent-journey.mjs"),
    "--run", run,
    "--ids", selected.selectedIds.join(",")
  ], { cwd: REPO_ROOT, stdio: "inherit" });
  process.exit(child.status ?? 1);
}

const playwright = managementPlaywrightArgs(selected.target);
const child = spawnSync(node, [
  path.join(REPO_ROOT, "scripts/e2e/run-management.mjs"),
  "--run", run,
  "--target", selected.target,
  "--files", playwright.files.join(",")
], { cwd: REPO_ROOT, stdio: "inherit" });
process.exit(child.status ?? 1);
