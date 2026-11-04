#!/usr/bin/env node
// Strength-B row-policy runner: prepare → Gate-Off → Gate-On → summarize.
//
//   node scripts/e2e/run-row-policy-b.mjs
//   node scripts/e2e/run-row-policy-b.mjs --run inbox/e2e/<runId>/run.json --execute
//   node scripts/e2e/run-row-policy-b.mjs --run-id local-row-policy-b --dry-run
//
// Default is the orchestration skeleton: prepare `--pack row-policy` (no --apply-db),
// write `evidence/phase-off|on/`, mutate only the run instance env, run summarizeBRun
// on not_run rows, and print the exact management / security follow-on commands.
// `--execute` spawns the existing runners after each proven switch (they start Lucy
// from `run.instance.env`; Lucy only reads process.env, so a same-volume restart
// is required between phases).
//
// proven=1 is NEVER left on the run instance: the finally block always clears it.
// Customer sign-off configs are never written.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DEFAULT_RUN_ROOT, EXIT_CODES, REPO_ROOT, fail, loadRun, parseArgv } from "./lib/common.mjs";
import {
  collectPhaseStats,
  defaultNotRunRows,
  formatResultTable,
  phaseCommands,
  phaseEvidenceDir,
  registryEntriesForPhase,
  setForcedPredicateProven,
  summarizeBRun,
  writePhaseEvidence
} from "./lib/row-policy-phase.mjs";
import { assertRowPolicyBDataPlane } from "./lib/rds-dataplane-policy.mjs";
import { PACK_ID } from "./lib/row-policy-pack.mjs";
import { prepareEnvironment } from "./prepare-environment.mjs";

function generateRunId() {
  return `row-policy-b-${Date.now().toString(36)}`;
}

function spawnNodeScript(relFile, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, relFile), ...args], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
}

function readJsonIfExists(file) {
  if (!file || !existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function snapshotPhaseArtifacts(runDir, phase) {
  const dest = phaseEvidenceDir(runDir, phase);
  mkdirSync(dest, { recursive: true });
  const copies = [
    ["results/management-playwright.json", "management-playwright.json"],
    ["results/management.json", "management.json"],
    ["results/security.json", "security.json"]
  ];
  for (const [rel, name] of copies) {
    const src = path.join(runDir, rel);
    if (existsSync(src)) cpSync(src, path.join(dest, name));
  }
  const v025 = path.join(runDir, "v025");
  if (existsSync(v025)) cpSync(v025, path.join(dest, "v025"), { recursive: true });
  return dest;
}

/**
 * Read per-id status from a phase evidence snapshot (v025 files + security.json).
 * Missing owners stay `not_run` so they cannot silently pass.
 */
export function collectExecutedRows(evidenceDir, phase) {
  const security = readJsonIfExists(path.join(evidenceDir, "security.json"));
  const byCatalog = new Map();
  for (const entry of security?.cases ?? []) {
    if (entry?.id) byCatalog.set(entry.id, entry.status ?? "not_run");
  }
  return registryEntriesForPhase(phase).map((entry) => {
    const v025 = readJsonIfExists(path.join(evidenceDir, "v025", `${entry.executionId}.json`));
    let status = "not_run";
    if (v025?.status) status = v025.status;
    else if (entry.catalogId && byCatalog.has(entry.catalogId)) status = byCatalog.get(entry.catalogId);
    return {
      executionId: entry.executionId,
      catalogId: entry.catalogId,
      phase: entry.phase,
      ownerFile: entry.ownerFile,
      status
    };
  });
}

export async function defaultRunPhase({ runJson, runDir, phase }) {
  const spec = phaseCommands(runJson, phase);
  const management = await spawnNodeScript("scripts/e2e/run-management.mjs", [
    "--run",
    runJson,
    "--files",
    spec.files,
    "--grep",
    spec.grep
  ]);
  const security = await spawnNodeScript("scripts/e2e/run-security.mjs", [
    "--run",
    runJson,
    "--only",
    spec.only
  ]);
  const dest = snapshotPhaseArtifacts(runDir, phase);
  return {
    rows: collectExecutedRows(dest, phase),
    spawned: { management: management.code, security: security.code }
  };
}

function writePhasePlan(runDir, phase, runJson) {
  const dir = phaseEvidenceDir(runDir, phase);
  mkdirSync(dir, { recursive: true });
  const commands = phaseCommands(runJson, phase);
  const plan = {
    phase,
    proven: phase === "on" ? "1" : "0",
    ids: registryEntriesForPhase(phase).map((entry) => ({
      executionId: entry.executionId,
      catalogId: entry.catalogId ?? null,
      ownerFile: entry.ownerFile,
      registryPhase: entry.phase
    })),
    commands,
    restartRequired: true,
    restartReason:
      "Lucy reads LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN from process.env. After setForcedPredicateProven, restart the same runDir instance (run-management / run-security start Lucy from run.instance.env)."
  };
  writeFileSync(path.join(dir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  return plan;
}

function mergeStats(off, on) {
  return {
    phaseOff: { failed: off.failed, blockedBlocking: off.blockedBlocking },
    phaseOn: { failed: on.failed, blockedBlocking: on.blockedBlocking },
    registryMissing: [...off.registryMissing, ...on.registryMissing]
  };
}

/**
 * Orchestrate a strength-B row-policy run.
 *
 * @param {{
 *   runId?: string,
 *   runJson?: string,
 *   runRoot?: string,
 *   reset?: boolean,
 *   execute?: boolean,
 *   prepare?: Function,
 *   runPhase?: Function
 * }} options
 */
export async function runRowPolicyB(options = {}) {
  const execute = options.execute === true;
  const prepare = options.prepare ?? prepareEnvironment;
  const runPhase = options.runPhase ?? defaultRunPhase;
  let runJsonPath = options.runJson ?? null;
  let run = null;

  if (runJsonPath) {
    run = loadRun(runJsonPath);
    runJsonPath = path.resolve(runJsonPath);
  } else {
    const prepared = await prepare({
      runId: options.runId ?? generateRunId(),
      mode: "local",
      runRoot: options.runRoot ?? DEFAULT_RUN_ROOT,
      reset: options.reset === true,
      pack: PACK_ID,
      applyDb: false
    });
    run = prepared.run;
    runJsonPath = prepared.runJsonPath;
  }

  const runDir = run.paths?.runDir ?? path.dirname(runJsonPath);
  mkdirSync(phaseEvidenceDir(runDir, "off"), { recursive: true });
  mkdirSync(phaseEvidenceDir(runDir, "on"), { recursive: true });

  const offPlan = writePhasePlan(runDir, "off", runJsonPath);
  const onPlan = writePhasePlan(runDir, "on", runJsonPath);

  let offRows = defaultNotRunRows("off");
  let onRows = defaultNotRunRows("on");
  let offSpawned = null;
  let onSpawned = null;

  try {
    if (execute) {
      assertRowPolicyBDataPlane(run);
    }
    setForcedPredicateProven(runDir, false);
    if (execute) {
      const offOutcome = await runPhase({ runJson: runJsonPath, runDir, phase: "off", run });
      offRows = offOutcome.rows ?? offRows;
      offSpawned = offOutcome.spawned ?? null;
    } else {
      writePhaseEvidence(runDir, "off", { phase: "off", proven: "0", rows: offRows, executed: false });
    }

    setForcedPredicateProven(runDir, true);
    if (execute) {
      const onOutcome = await runPhase({ runJson: runJsonPath, runDir, phase: "on", run });
      onRows = onOutcome.rows ?? onRows;
      onSpawned = onOutcome.spawned ?? null;
    } else {
      writePhaseEvidence(runDir, "on", { phase: "on", proven: "1", rows: onRows, executed: false });
    }
  } finally {
    // Never leave proven=1 on the run instance (customer sign-off decoupling).
    try {
      setForcedPredicateProven(runDir, false);
    } catch {
      // best-effort clear; the caller still sees the summarize verdict
    }
  }

  if (execute) {
    writePhaseEvidence(runDir, "off", { phase: "off", proven: "0", rows: offRows, executed: true, spawned: offSpawned });
    writePhaseEvidence(runDir, "on", { phase: "on", proven: "1", rows: onRows, executed: true, spawned: onSpawned });
  }

  const offStats = collectPhaseStats(offRows, offPlan.ids.map((row) => row.executionId), offSpawned);
  const onStats = collectPhaseStats(onRows, onPlan.ids.map((row) => row.executionId), onSpawned);
  const summary = summarizeBRun(mergeStats(offStats, onStats));
  const tableRows = [
    ...offRows.map((row) => ({ ...row, phase: "off" })),
    ...onRows.map((row) => ({ ...row, phase: "on" }))
  ];
  const table = formatResultTable(tableRows);
  const report = {
    contract: "lucy-row-policy-b-v1",
    runId: run.runId,
    runJson: runJsonPath,
    execute,
    summary,
    phaseOff: { ...offStats, spawned: offSpawned },
    phaseOn: { ...onStats, spawned: onSpawned },
    followOn: { off: offPlan.commands, on: onPlan.commands },
    table
  };
  writeFileSync(path.join(runDir, "evidence", "summary.json"), `${JSON.stringify({ ...report, table: undefined }, null, 2)}\n`);
  writeFileSync(path.join(runDir, "evidence", "results-table.txt"), `${table}\n`);
  return report;
}

function printReport(report) {
  process.stdout.write(`${report.table}\n\n`);
  process.stdout.write(`${JSON.stringify({
    status: report.summary.passed ? "passed" : "failed",
    execute: report.execute,
    runJson: report.runJson,
    runId: report.runId,
    summary: report.summary
  }, null, 2)}\n`);
  if (!report.execute) {
    process.stdout.write("\nFollow-on (same run.json; Lucy restarts from updated instance.env):\n");
    process.stdout.write(`  # Gate-Off (proven=0). Runner already wrote instance.env; re-run with --execute or:\n`);
    process.stdout.write(`  ${report.followOn.off.management}\n`);
    process.stdout.write(`  ${report.followOn.off.security}\n`);
    process.stdout.write(`  # Gate-On (setForcedPredicateProven then same-volume restart):\n`);
    process.stdout.write(`  ${report.followOn.on.management}\n`);
    process.stdout.write(`  ${report.followOn.on.security}\n`);
    process.stdout.write("  # Then: node scripts/e2e/run-row-policy-b.mjs --run <run.json> --execute\n");
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), {
      "run-id": "value",
      run: "value",
      "run-root": "value",
      reset: "boolean",
      execute: "boolean",
      "dry-run": "boolean"
    });
    if (args.execute === true && args["dry-run"] === true) {
      fail("run-row-policy-b: use either --execute or --dry-run, not both", 1);
    }
    const execute = args.execute === true;
    const report = await runRowPolicyB({
      runId: args["run-id"],
      runJson: args.run,
      runRoot: args["run-root"],
      reset: args.reset === true,
      execute
    });
    printReport(report);
    if (!execute) process.exit(EXIT_CODES.dry_run);
    process.exit(report.summary.passed ? 0 : 1);
  } catch (error) {
    fail(`run-row-policy-b: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
