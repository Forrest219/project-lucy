#!/usr/bin/env node
// Aggregate gate for the daily CI workflow (Spec §1.1 item 5, §6).
//
// Contract:
//   - It reads ONLY the `needs.<job>.result` values. It never parses a test total, a test
//     count, a log line or a coverage number.
//   - A dependency whose result is not exactly "success" makes the gate FAIL. That includes
//     failure, skipped, cancelled, timed_out and a dependency that is missing from `needs`.
//   - A job that exists in `needs` but is not in the expected list also FAILS: the aggregate
//     must not silently ignore a job that was added to the workflow.
//
// Usage:
//   node scripts/gates/ci-required-gate.mjs --needs-json '<json>' --expect 'job-a,job-b'

import process from "node:process";

const NON_SUCCESS_HINT = "failure, skipped, cancelled or timed out are all not success";

function parseArgs(argv) {
  const args = { needsJson: null, expect: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--needs-json") args.needsJson = argv[++i];
    else if (arg === "--expect") args.expect = argv[++i];
    else if (arg.startsWith("--needs-json=")) args.needsJson = arg.slice("--needs-json=".length);
    else if (arg.startsWith("--expect=")) args.expect = arg.slice("--expect=".length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

export function evaluate({ needs, expected }) {
  const failures = [];
  const rows = [];

  if (!expected.length) {
    failures.push("the expected job list is empty: an empty aggregate must never pass");
  }

  for (const job of expected) {
    const entry = Object.prototype.hasOwnProperty.call(needs, job) ? needs[job] : undefined;
    if (entry === undefined) {
      failures.push(`${job}: missing from needs — a dependency that did not run cannot be success`);
      rows.push({ job, result: "missing", ok: false });
      continue;
    }
    const result = typeof entry === "string" ? entry : entry?.result;
    const ok = result === "success";
    if (!ok) {
      failures.push(`${job}: result is ${JSON.stringify(result ?? null)} — ${NON_SUCCESS_HINT}`);
    }
    rows.push({ job, result: result ?? null, ok });
  }

  for (const job of Object.keys(needs)) {
    if (!expected.includes(job)) {
      failures.push(`${job}: present in needs but not aggregated — every job of the workflow must be listed`);
      rows.push({ job, result: needs[job]?.result ?? null, ok: false });
    }
  }

  rows.sort((a, b) => a.job.localeCompare(b.job));
  return { failures, rows, ok: failures.length === 0 };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ci-required: ${error.message}`);
    process.exit(2);
  }

  if (!args.needsJson || !args.expect) {
    console.error("ci-required: --needs-json and --expect are required");
    process.exit(2);
  }

  let needs;
  try {
    needs = JSON.parse(args.needsJson);
  } catch (error) {
    console.error(`ci-required: --needs-json is not valid JSON (${error.message})`);
    process.exit(2);
  }
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) {
    console.error("ci-required: --needs-json must be a JSON object of job results");
    process.exit(2);
  }

  const expected = args.expect
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  const { failures, rows, ok } = evaluate({ needs, expected });

  console.log("ci-required: daily job results");
  for (const row of rows) {
    console.log(`  ${row.ok ? "OK  " : "FAIL"}  ${row.job} = ${row.result}`);
  }

  if (!ok) {
    console.error("ci-required: FAILED");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`ci-required: OK — ${rows.length} daily job(s) succeeded`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
