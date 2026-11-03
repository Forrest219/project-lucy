#!/usr/bin/env node
// B3 measured disposable PostgreSQL apply (Spec §6.2, §6.4).
//
//   node scripts/e2e/apply-db.mjs --run <run.json>
//
// Reads the run manifest, runs applySyntheticDbSeed against the run's `db` block
// (host/port/owner role + per-run password files), and writes the producer's
// measurement back into the same `run.json`. The producer only sets
// `run.db.applied = true` when every step (real role/db creation, DDL apply,
// INSERTs, dataset-digest verification, per-role SELECT probes, per-role INSERT
// denials) actually passed against the registered DB host.
//
// Exit codes:
//   0  applied successfully (run.db.applied = true, measurement recorded)
//   1  refused or failed (run.db.applied stays false; problems recorded; the
//      harness treats the run as BLOCKED for the postgres capability)
//   2  reserved for missing-infrastructure (the DB host is unreachable)
//
// The script never prints the per-run password; the measurement payload holds
// role names + digests + counts only.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { applySyntheticDbSeed, defaultExecuteSql } from "./lib/db-seed.mjs";
import { loadRun } from "./lib/common.mjs";
import { parseArgv, fail } from "./lib/common.mjs";

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

export async function applyDbToRun({ runJsonPath, executeSql = defaultExecuteSql, runMode = "local" } = {}) {
  if (!runJsonPath) throw new Error("applyDbToRun requires --run <run.json>");
  const run = loadRun(runJsonPath);
  if (!run?.db) {
    throw new Error(`${runJsonPath} has no run.db block; prepare-environment must be run with --apply-db`);
  }
  const engine = run.db.engine ?? "postgres";
  if (engine !== "postgres") {
    throw new Error(`apply-db seeds PostgreSQL only; this run's engine is ${engine}. Prepare with --db-engine postgres to opt into that seed.`);
  }
  // Inject the producer's measurement + applied flag into a copy of the run
  // manifest, then write it back atomically.
  const result = await applySyntheticDbSeed({ run, runMode, executeSql });
  const next = {
    ...run,
    db: {
      ...run.db,
      applied: result.ok,
      measurement: result.measurement
    }
  };
  writeFileSync(runJsonPath, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: result.ok, measurement: result.measurement, runJsonPath };
}

if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value" });
    if (!args.run) fail("apply-db: --run <run.json> is required", 1);
    const { ok, measurement } = await applyDbToRun({ runJsonPath: args.run });
    process.stdout.write(`${JSON.stringify({
      ok,
      applied: measurement.applied,
      finDatabase: measurement.finDatabase,
      salesDatabase: measurement.salesDatabase,
      readerRole: measurement.readerRole,
      seedSqlDigestMeasured: measurement.seedSqlDigestMeasured,
      seedDatasetDigestMeasured: measurement.seedDatasetDigestMeasured,
      readonlyProbes: measurement.readonlyProbes,
      writeAttemptsDenied: measurement.writeAttemptsDenied,
      problems: measurement.problems
    })}\n`);
    process.exit(ok ? 0 : 1);
  } catch (error) {
    fail(`apply-db: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}