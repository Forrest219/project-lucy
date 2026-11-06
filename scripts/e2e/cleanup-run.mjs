#!/usr/bin/env node
// Tear down one E2E run's disposable infrastructure.
//
//   node scripts/e2e/cleanup-run.mjs --run inbox/e2e/<runId>/run.json
//   node scripts/e2e/cleanup-run.mjs --run inbox/e2e/<runId>/run.json --purge
//
// What it removes
// ---------------
//   * the disposable PostgreSQL container this run started — addressed by the
//     container ID recorded in run.db.disposable.containerId, NEVER by a name
//     pattern (a pattern could hit another run's container, or somebody's
//     unrelated postgres);
//   * with --purge, the run directory itself (inbox/e2e/<runId>/), which is
//     where the run's logs, results and secrets live.
//
// What it never removes
// ---------------------
//   * anything it did not start: no image, no volume, no other container, and
//     never the shared Aliyun RDS (read-only, outside this run's ownership).
//
// Exit codes: 0 cleaned, 1 nothing to clean / nothing recorded, 2 refused.

import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { REPO_ROOT, fail, parseArgv } from "./lib/common.mjs";
import { stopDisposablePostgres } from "./lib/db-pg-fixture.mjs";

const args = parseArgv(process.argv.slice(2), { run: "value", purge: "boolean" });
if (!args.run) fail("cleanup-run: --run <run.json> is required", 1);

const runJsonPath = path.resolve(REPO_ROOT, args.run);
if (!existsSync(runJsonPath)) fail(`cleanup-run: ${runJsonPath} does not exist`, 1);

let run;
try {
  run = JSON.parse(readFileSync(runJsonPath, "utf8"));
} catch (error) {
  fail(`cleanup-run: cannot read ${runJsonPath}: ${error instanceof Error ? error.message : String(error)}`, 1);
}

const disposable = run?.db?.disposable ?? null;
const removed = [];
const problems = [];

if (disposable?.containerId) {
  const result = await stopDisposablePostgres({ containerId: disposable.containerId });
  if (result.removed) removed.push(disposable.containerName ?? disposable.containerId);
  else problems.push(`container ${disposable.containerName ?? disposable.containerId}: ${result.reason}`);
} else {
  problems.push("run.db.disposable is not recorded — this run started no disposable container");
}

let purged = false;
if (args.purge === true) {
  const runDir = path.resolve(path.dirname(runJsonPath));
  // Only ever remove a directory under the repo's run root.
  const root = path.resolve(REPO_ROOT, "inbox", "e2e");
  if (!runDir.startsWith(`${root}${path.sep}`)) {
    problems.push(`refusing to purge ${runDir}: it is not under ${root}`);
  } else {
    rmSync(runDir, { recursive: true, force: true });
    purged = true;
  }
}

process.stdout.write(`${JSON.stringify({ runId: run?.runId ?? null, removed, purged, problems })}\n`);
process.exit(problems.length > 0 ? 2 : 0);
