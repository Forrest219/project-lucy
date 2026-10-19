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
 * Why reservoir sampling for latency? Capping at the last N samples
 * would bias toward late-run samples and miss early-run GC or scheduler
 * stalls. Algorithm-R reservoir sampling gives every observation an
 * equal chance of being in the final reservoir, so percentiles reflect
 * the full run rather than the tail.
 *
 * Schema mirrors the production DDL (audit_meta + access_log with the
 * full set of columns and indexes T01–T07 added, including the indexes
 * that T03a / T04a added). The script does NOT touch the host database;
 * it always opens `:memory:` so the baseline run is hermetic.
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_VERSION = "audit-trust-perf-baseline/v1";
const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";
const RESERVOIR_PER_WORKER = 4096;

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
      outcome TEXT NOT NULL,
      request_id TEXT,
      error_code TEXT,
      duration_ms INTEGER NOT NULL
    );
    -- Mirrors production indexes from webui/server/proxy/audit.ts.
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_tool_ts ON access_log(tool, ts);
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
    CREATE INDEX IF NOT EXISTS idx_al_session_ts ON access_log(lucy_session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_client_ip_ts ON access_log(client_ip, ts);
    CREATE INDEX IF NOT EXISTS idx_al_event_type ON access_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_al_association_status ON access_log(association_status);
    CREATE INDEX IF NOT EXISTS idx_al_attempt_id ON access_log(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_al_instance_id ON access_log(instance_id);
    CREATE INDEX IF NOT EXISTS idx_al_ts ON access_log(ts);
  `);
}

// Reservoir sampling (Algorithm R). Each iteration beyond reservoir
// capacity selects a random slot to overwrite with the new sample, so
// every row inserted has an equal chance of ending in the reservoir.
class Reservoir {
  constructor(capacity) {
    this.capacity = capacity;
    this.samples = new Array(capacity);
    this.observed = 0;
  }
  add(valueUs) {
    if (this.observed < this.capacity) {
      this.samples[this.observed] = valueUs;
      this.observed += 1;
      return;
    }
    const j = Math.floor(Math.random() * (this.observed + 1));
    if (j < this.capacity) this.samples[j] = valueUs;
    this.observed += 1;
  }
  finalize() {
    return this.samples.slice(0, this.observed);
  }
}

function workerBoot({ workerId, durationMs }) {
  const db = new Database(":memory:");
  applySchema(db);
  const insert = db.prepare(`
    INSERT INTO access_log (
      user_id, tool, ts, classification_version, event_type,
      authorization_status, execution_status, usability_status,
      association_status, attribution_rule_version, attempt_id,
      instance_id, instance_start_generation, explicit_turn_validated,
      mcp_request_id, request_id, outcome, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const start = Date.now();
  let rows = 0;
  let errors = 0;
  const reservoir = new Reservoir(RESERVOIR_PER_WORKER);
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
        1,
        `req_${workerId}_${rows}`,
        `trace_${workerId}_${rows}`,
        "ok",
        0
      );
      rows += 1;
      const t1 = process.hrtime.bigint();
      reservoir.add(Number((t1 - t0) / 1000n));
    } catch (err) {
      errors += 1;
    }
  }
  parentPort.postMessage({
    workerId,
    rows,
    errors,
    samplesUs: reservoir.finalize(),
    observedLatency: reservoir.observed,
    durationMs: Date.now() - start
  });
}

function parseArgs(argv) {
  const args = { duration: 30, workers: 16, out: null, label: null };
  const allowed = new Set(["--duration", "--workers", "--out", "--label"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!allowed.has(a)) {
      throw new Error(`unknown option: ${a}`);
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new Error(`option ${a} requires a value`);
    }
    if (a === "--duration") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1) {
        throw new Error(`--duration must be >= 1, got ${v}`);
      }
      args.duration = n;
      i += 1;
    } else if (a === "--workers") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--workers must be a positive integer, got ${v}`);
      }
      args.workers = n;
      i += 1;
    } else if (a === "--out") {
      if (!v || v.trim() === "") throw new Error("--out must be non-empty");
      args.out = v;
      i += 1;
    } else if (a === "--label") {
      args.label = v;
      i += 1;
    }
  }
  if (args.out == null) {
    args.out = join(
      __dirname,
      "2026-10-19-r1-perf-baseline",
      "evidence",
      `perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
    );
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
      `  --duration N     Seconds to run the workload (>= 1)\n` +
      `  --workers N      Number of concurrent worker threads\n` +
      `  --out <path>     Path for the evidence JSON\n` +
      `  --label <text>   Short label stamped on the evidence\n` +
      `  --help, -h       Show this message\n`
  );
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function runWorkerPromise({ workerId, durationMs }) {
  return new Promise((resolve, reject) => {
    let gotMessage = false;
    const w = new Worker(__filename, {
      workerData: { workerId, durationMs },
      stdout: false,
      stderr: false
    });
    // Hard timeout: 30 s past the configured duration gives the worker
    // generous slack for SQLite shutdown but never lets us hang.
    const timeout = setTimeout(() => {
      try {
        w.terminate();
      } catch {}
      reject(new Error(`worker ${workerId} timed out`));
    }, durationMs + 30_000);
    w.once("message", (msg) => {
      gotMessage = true;
      clearTimeout(timeout);
      resolve(msg);
    });
    w.once("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`worker ${workerId} errored: ${err.message}`));
    });
    w.once("exit", (code) => {
      clearTimeout(timeout);
      if (!gotMessage) {
        reject(new Error(`worker ${workerId} exited (code=${code}) before reporting`));
      }
      // Successful message case has already resolved; nothing else to do.
    });
  });
}

async function runWorkers({ workers, durationMs }) {
  const tasks = [];
  for (let i = 0; i < workers; i += 1) {
    tasks.push(runWorkerPromise({ workerId: i, durationMs }));
  }
  // allSettled so one worker's failure does not strand the others'
  // evidence; we collect what we got and re-throw at the end.
  const results = await Promise.allSettled(tasks);
  const errors = results.filter((r) => r.status === "rejected").map((r) => r.reason);
  const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (errors.length > 0) {
    throw new Error(
      `worker failures (${errors.length}/${workers}): ${errors.map((e) => e.message).join("; ")}`
    );
  }
  return fulfilled;
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
  let totalObserved = 0;
  const allSamples = [];
  for (const w of perWorker) {
    totalRows += w.rows;
    totalErrors += w.errors;
    totalObserved += w.observedLatency ?? 0;
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
      classification_version: CLASSIFICATION_VERSION,
      reservoir_per_worker: RESERVOIR_PER_WORKER
    },
    elapsed_ms: elapsedMs,
    totals: {
      rows_inserted: totalRows,
      errors: totalErrors,
      throughput_per_sec: Number(throughputPerSec.toFixed(2)),
      latency_samples_observed: totalObserved,
      latency_samples_kept: allSamples.length
    },
    latency_us: {
      p50: percentile(allSamples, 50),
      p95: percentile(allSamples, 95),
      p99: percentile(allSamples, 99),
      sample_count: allSamples.length,
      sampling_method: "reservoir_algorithm_r",
      reservoir_per_worker: RESERVOIR_PER_WORKER
    },
    per_worker: perWorker.map((w) => ({
      worker_id: w.workerId,
      rows: w.rows,
      errors: w.errors,
      duration_ms: w.durationMs,
      rows_per_sec: w.durationMs > 0 ? Number(((w.rows * 1000) / w.durationMs).toFixed(2)) : 0,
      observed_latency: w.observedLatency,
      sampled_latency: w.samplesUs.length
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
    console.error("[perf-baseline] failed:", err.message);
    process.exit(1);
  });
} else {
  workerBoot(workerData);
}
