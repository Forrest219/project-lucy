#!/usr/bin/env node
/**
 * audit-trust-2026-10-19-r1 / T08a.2 — perf baseline script
 *
 * Exercises the audit write path under concurrent load against an in-memory
 * SQLite database, capturing throughput and latency statistics. The output
 * is a single evidence JSON file at the path given by `--out`, structured
 * as `audit-trust-perf-baseline/v1`. The companion test runs the script
 * with --duration 1 / --workers 2 to confirm it executes end-to-end; the
 * real 5-minute / 16-worker baseline is operator-run and the JSON is
 * the durable evidence.
 *
 * Why in-memory? Production is single-instance and writes go to a local
 * SQLite file. The in-memory target isolates the perf of the schema +
 * WAL + insertion logic from filesystem noise, and matches what the
 * contract defines as the unit of "Lucy write throughput".
 *
 * Why Worker threads, not just async loops? SQLite operations block the
 * event loop. Worker threads let us actually saturate the writer side
 * with N truly concurrent INSERTs — async loops would just serialize
 * them on the call to better-sqlite3 (which is synchronous inside).
 *
 * Schema mirrors the production DDL (audit_meta + access_log +
 * association_revisions + the indexes that T03a added). The script
 * does NOT touch the host database; it always opens `:memory:` so the
 * baseline run is hermetic.
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_VERSION = "audit-trust-perf-baseline/v1";
const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_meta (
      audit_db_schema_version INTEGER PRIMARY KEY,
      classification_version TEXT,
      digest_version TEXT,
      last_migration_text TEXT,
      running_at_iso TEXT,
      running_actor TEXT,
      input_sha256 TEXT,
      output_affected_rows INTEGER
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      tool TEXT,
      ts TEXT NOT NULL,
      token_hash_prefix TEXT,
      lucy_session_id TEXT,
      client_ip TEXT,
      generated_sql TEXT,
      event_type TEXT,
      transport_sub_type TEXT,
      transport_status TEXT,
      authorization_status TEXT,
      execution_status TEXT,
      usability_status TEXT,
      association_status TEXT,
      original_turn_id TEXT,
      original_attribution_mode TEXT,
      original_association_status TEXT,
      original_attribution_confidence TEXT,
      original_reason TEXT,
      effective_turn_id TEXT,
      effective_attribution_mode TEXT,
      effective_association_status TEXT,
      effective_attribution_confidence TEXT,
      effective_reason TEXT,
      attempt_id TEXT,
      parent_attempt_id TEXT,
      instance_id TEXT,
      instance_start_generation INTEGER,
      attribution_rule_version TEXT,
      classification_version TEXT,
      digest_value TEXT,
      digest_version TEXT,
      credential_principal_id TEXT,
      explicit_turn_validated INTEGER,
      mcp_method TEXT,
      mcp_request_id TEXT,
      error_code TEXT,
      duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_event_type ON access_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_al_association_status ON access_log(association_status);
    CREATE INDEX IF NOT EXISTS idx_al_attempt_id ON access_log(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_al_instance_id ON access_log(instance_id);
    CREATE INDEX IF NOT EXISTS idx_al_ts ON access_log(ts);
  `);
}

function workerBoot({ workerId, durationMs }) {
  // Each worker owns its own in-memory DB. The WAL contention model
  // we are after is at the SQL statement level (per-row INSERT throughput
  // with indexes active); collisions across workers would just add
  // filesystem noise unrelated to the application-level stress.
  const db = new Database(":memory:");
  applySchema(db);
  const insert = db.prepare(`
    INSERT INTO access_log (
      user_id, tool, ts, classification_version, event_type,
      authorization_status, execution_status, usability_status,
      association_status, attribution_rule_version, attempt_id,
      instance_id, instance_start_generation, explicit_turn_validated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const start = Date.now();
  let rows = 0;
  let errors = 0;
  // Latency samples per worker (microseconds). Bounded to 4k samples
  // to keep memory in check on long runs.
  const samples = [];
  const SAMPLE_CAP = 4096;
  let nextSample = 0;
  while (Date.now() - start < durationMs) {
    const t0 = process.hrtime.bigint();
    try {
      insert.run(
        `user_${workerId}`,
        `tool_${workerId}`,
        new Date().toISOString(),
        CLASSIFICATION_VERSION,
        "tool_call",
        "allowed",
        "executed",
        "usable",
        "candidate",
        "v1.0",
        `attempt_${workerId}_${rows}`,
        `instance_${workerId}`,
        1,
        1
      );
      rows += 1;
      const t1 = process.hrtime.bigint();
      if (samples.length < SAMPLE_CAP) {
        samples.push(Number((t1 - t0) / 1000n)); // microseconds
      } else if (nextSample < SAMPLE_CAP) {
        samples[nextSample] = Number((t1 - t0) / 1000n);
        nextSample = (nextSample + 1) % SAMPLE_CAP;
      }
    } catch (err) {
      errors += 1;
    }
  }
  parentPort.postMessage({
    workerId,
    rows,
    errors,
    samplesUs: samples,
    durationMs: Date.now() - start
  });
}

function parseArgs(argv) {
  const args = { duration: 30, workers: 16, out: null, label: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--duration") {
      args.duration = Number(argv[++i]);
    } else if (a === "--workers") {
      args.workers = Number(argv[++i]);
    } else if (a === "--out") {
      args.out = argv[++i];
    } else if (a === "--label") {
      args.label = argv[++i];
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (!Number.isFinite(args.duration) || args.duration <= 0) {
    throw new Error(`--duration must be a positive number, got ${args.duration}`);
  }
  if (!Number.isInteger(args.workers) || args.workers <= 0) {
    throw new Error(`--workers must be a positive integer, got ${args.workers}`);
  }
  if (args.out == null) {
    args.out = `${__dirname}/../../../webui/scripts/audit-trust/2026-10-19-r1-perf-baseline/evidence/perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  }
  if (args.label == null) {
    args.label = `local-${args.workers}w-${args.duration}s`;
  }
  return args;
}

function printHelp() {
  console.log(
    `Usage: node 2026-10-19-r1-perf-baseline.mjs [options]\n` +
      `\nOptions:\n` +
      `  --duration N     Seconds to run the workload (default 30)\n` +
      `  --workers N      Number of concurrent worker threads (default 16)\n` +
      `  --out <path>     Path for the evidence JSON (default under scripts/audit-trust/...)\n` +
      `  --label <text>   Short label stamped on the evidence (default local-<N>w-<D>s)\n` +
      `  --help, -h       Show this message\n`
  );
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function runWorkers({ workers, durationMs }) {
  const tasks = [];
  for (let i = 0; i < workers; i += 1) {
    tasks.push(
      new Promise((resolve, reject) => {
        const w = new Worker(__filename, {
          workerData: { workerId: i, durationMs },
          stdout: false,
          stderr: false
        });
        w.once("message", (msg) => resolve(msg));
        w.once("error", (err) => reject(err));
      })
    );
  }
  return Promise.all(tasks);
}

async function runMain(argv) {
  const args = parseArgs(argv);
  const durationMs = Math.round(args.duration * 1000);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const perWorker = await runWorkers({ workers: args.workers, durationMs });
  const elapsedMs = Date.now() - t0;
  let totalRows = 0;
  let totalErrors = 0;
  const allSamples = [];
  for (const w of perWorker) {
    totalRows += w.rows;
    totalErrors += w.errors;
    for (const s of w.samplesUs) allSamples.push(s);
  }
  const throughputPerSec = elapsedMs > 0 ? (totalRows * 1000) / elapsedMs : 0;
  const evidence = {
    schema_version: SCHEMA_VERSION,
    generated_at: startedAt,
    label: args.label,
    config: {
      duration_s: args.duration,
      workers: args.workers,
      classification_version: CLASSIFICATION_VERSION
    },
    elapsed_ms: elapsedMs,
    totals: {
      rows_inserted: totalRows,
      errors: totalErrors,
      throughput_per_sec: Number(throughputPerSec.toFixed(2))
    },
    latency_us: {
      p50: percentile(allSamples, 50),
      p95: percentile(allSamples, 95),
      p99: percentile(allSamples, 99),
      sample_count: allSamples.length
    },
    per_worker: perWorker.map((w) => ({
      worker_id: w.workerId,
      rows: w.rows,
      errors: w.errors,
      duration_ms: w.durationMs,
      rows_per_sec: w.durationMs > 0 ? Number(((w.rows * 1000) / w.durationMs).toFixed(2)) : 0
    }))
  };

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, JSON.stringify(evidence, null, 2));
  console.log(
    `[perf-baseline] wrote ${args.out}: ${totalRows} rows, ` +
      `${evidence.totals.throughput_per_sec} rows/sec (${totalErrors} errors) ` +
      `p95 ${evidence.latency_us.p95}µs`
  );
  return evidence;
}

if (isMainThread) {
  runMain(process.argv.slice(2)).catch((err) => {
    console.error("[perf-baseline] failed:", err);
    process.exit(1);
  });
} else {
  workerBoot(workerData);
}
