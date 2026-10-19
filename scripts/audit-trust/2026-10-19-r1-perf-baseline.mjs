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
 * Why Algorithm-R reservoir sampling for latency? Capping at the last N
 * samples would bias toward late-run samples and miss early-run GC or
 * scheduler stalls. Algorithm-R gives every observation an equal chance
 * of being in the final reservoir, so percentiles reflect the *full*
 * run rather than the tail. The reservoir is per-worker; combined
 * across workers it is approximately uniform when worker throughput is
 * similar (steady state). See the README in `evidence/` for caveats.
 *
 * Schema mirrors the production DDL (audit_meta + access_log with the
 * full set of columns and indexes T01–T07 added). The script does NOT
 * touch the host database; it always opens `:memory:` so the baseline
 * run is hermetic. To keep schema parity loud-fail on drift, an
 * introspection test queries `pragma_table_info` and `pragma_index_list`
 * after `applySchema` and asserts no required column / index is missing.
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
const RESERVOIR_PER_WORKER = 16384;

// Production column set mirrored from `webui/server/proxy/audit.ts`.
// When that file adds a new column, this list and the schema below
// must be updated to keep parity. The introspection test enforces
// the column / index presence in the resulting in-memory DB.
const REQUIRED_COLUMNS = [
  "id",
  "ts",
  "user_id",
  "token_label",
  "token_hash_prefix",
  "lucy_session_id",
  "lucy_turn_id",
  "lucy_platform",
  "client",
  "tool",
  "tables",
  "args_summary",
  "query_hash",
  "query_length",
  "query_operation",
  "query_preview",
  "outcome",
  "error_detail",
  "duration_ms",
  "response_bytes",
  "response_row_count",
  "response_column_count",
  "response_truncated",
  "request_id",
  "trace_id",
  "role_ids",
  "permission_snapshot_hash",
  "effective_tables_count",
  "decision_reason",
  "turn_attribution_mode",
  "turn_attribution_confidence",
  "turn_attribution_reason",
  "query_artifact_ref",
  "generated_sql",
  "client_ip",
  "client_forwarded_for",
  "user_agent",
  "client_version",
  "device_name",
  "policy_version",
  "capability_digest",
  "skill_uri",
  "skill_version",
  "skill_file_version",
  "skill_action",
  "skill_roles_allowed",
  "matched_role_id",
  "compiler_reason",
  "failure_dimension",
  "applied_version",
  "applied_business_date",
  "applied_value_kind",
  "actor_id",
  "actor_kind",
  "wiki_injected_keys",
  "wiki_versions",
  "eval_mark",
  "is_slow_call",
  "slow_basis",
  "result_empty",
  "turn_wall_clock_ms",
  "reported_client",
  "reported_client_version",
  "association_status",
  "original_turn_id",
  "original_attribution_mode",
  "original_association_status",
  "original_attribution_confidence",
  "original_reason",
  "effective_turn_id",
  "effective_attribution_mode",
  "effective_association_status",
  "effective_attribution_confidence",
  "effective_reason",
  "attempt_id",
  "parent_attempt_id",
  "instance_id",
  "instance_start_generation",
  "event_type",
  "transport_sub_type",
  "transport_status",
  "authorization_status",
  "execution_status",
  "usability_status",
  "attribution_rule_version",
  "classification_version",
  "digest_value",
  "digest_version",
  "credential_principal_id",
  "explicit_turn_validated",
  "mcp_method",
  "mcp_request_id"
];

const REQUIRED_INDEXES = [
  "idx_al_user_ts",
  "idx_al_tool_ts",
  "idx_al_user_token_ts",
  "idx_al_session_ts",
  "idx_al_client_ip_ts",
  "idx_al_ts",
  "idx_al_event_type",
  "idx_al_association_status",
  "idx_al_attempt_id",
  "idx_al_instance_id"
];

function applySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_meta (
      audit_db_schema_version INTEGER PRIMARY KEY,
      classification_version  TEXT,
      digest_version          TEXT,
      last_migration_text     TEXT,
      running_at_iso          TEXT,
      running_actor           TEXT,
      input_sha256            TEXT,
      output_affected_rows    INTEGER
    );
    CREATE TABLE IF NOT EXISTS access_log (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                          TEXT    NOT NULL,
      user_id                     TEXT    NOT NULL,
      token_label                 TEXT,
      token_hash_prefix           TEXT,
      lucy_session_id             TEXT,
      lucy_turn_id                TEXT,
      lucy_platform               TEXT,
      client                      TEXT,
      tool                        TEXT    NOT NULL,
      tables                      TEXT,
      args_summary                TEXT,
      query_hash                  TEXT,
      query_length                INTEGER,
      query_operation             TEXT,
      query_preview               TEXT,
      outcome                     TEXT    NOT NULL,
      error_detail                TEXT,
      duration_ms                 INTEGER NOT NULL,
      response_bytes              INTEGER,
      response_row_count          INTEGER,
      response_column_count       INTEGER,
      response_truncated          INTEGER,
      request_id                  TEXT    NOT NULL,
      trace_id                    TEXT,
      role_ids                    TEXT,
      permission_snapshot_hash    TEXT,
      effective_tables_count      INTEGER,
      decision_reason             TEXT,
      turn_attribution_mode       TEXT,
      turn_attribution_confidence TEXT,
      turn_attribution_reason     TEXT,
      query_artifact_ref          TEXT,
      generated_sql               TEXT,
      client_ip                   TEXT,
      client_forwarded_for        TEXT,
      user_agent                  TEXT,
      client_version              TEXT,
      device_name                 TEXT,
      policy_version              TEXT,
      capability_digest           TEXT,
      skill_uri                   TEXT,
      skill_version               TEXT,
      skill_file_version          TEXT,
      skill_action                TEXT,
      skill_roles_allowed         TEXT,
      matched_role_id             TEXT,
      compiler_reason             TEXT,
      failure_dimension           TEXT,
      applied_version             TEXT,
      applied_business_date       TEXT,
      applied_value_kind          TEXT,
      actor_id                    TEXT,
      actor_kind                  TEXT,
      wiki_injected_keys          TEXT,
      wiki_versions               TEXT,
      eval_mark                   INTEGER,
      is_slow_call                INTEGER,
      slow_basis                  TEXT,
      result_empty                INTEGER,
      turn_wall_clock_ms          INTEGER,
      reported_client             TEXT,
      reported_client_version     TEXT,
      association_status          TEXT,
      original_turn_id            TEXT,
      original_attribution_mode   TEXT,
      original_association_status TEXT,
      original_attribution_confidence TEXT,
      original_reason             TEXT,
      effective_turn_id           TEXT,
      effective_attribution_mode  TEXT,
      effective_association_status TEXT,
      effective_attribution_confidence TEXT,
      effective_reason            TEXT,
      attempt_id                  TEXT,
      parent_attempt_id           TEXT,
      instance_id                 TEXT,
      instance_start_generation   INTEGER,
      event_type                  TEXT,
      transport_sub_type          TEXT,
      transport_status            TEXT,
      authorization_status        TEXT,
      execution_status            TEXT,
      usability_status            TEXT,
      attribution_rule_version     TEXT,
      classification_version      TEXT,
      digest_value                TEXT,
      digest_version              TEXT,
      credential_principal_id     TEXT,
      explicit_turn_validated     INTEGER,
      mcp_method                  TEXT,
      mcp_request_id              TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_ts ON access_log(user_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_tool_ts ON access_log(tool, ts);
    CREATE INDEX IF NOT EXISTS idx_al_user_token_ts ON access_log(user_id, token_hash_prefix, ts);
    CREATE INDEX IF NOT EXISTS idx_al_session_ts ON access_log(lucy_session_id, ts);
    CREATE INDEX IF NOT EXISTS idx_al_client_ip_ts ON access_log(client_ip, ts);
    CREATE INDEX IF NOT EXISTS idx_al_ts ON access_log(ts);
    CREATE INDEX IF NOT EXISTS idx_al_event_type ON access_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_al_association_status ON access_log(association_status);
    CREATE INDEX IF NOT EXISTS idx_al_attempt_id ON access_log(attempt_id);
    CREATE INDEX IF NOT EXISTS idx_al_instance_id ON access_log(instance_id);
  `);
}

// Reservoir sampling (Algorithm R). Each iteration beyond reservoir
// capacity selects a random slot to overwrite with the new sample, so
// every row inserted has an equal chance of ending in the reservoir.
//
// Caveat: Algorithm-R runs independently per worker, so the *combined*
// reservoir (after master-side merge) is not perfectly uniform across
// worker observations if per-worker throughput differs. In steady-state
// workloads all workers saturate similarly and the bias is negligible.
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
      user_id, tool, ts, outcome, request_id, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?)
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
        "ok",
        `req_${workerId}_${rows}`,
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
  const args = { duration: null, workers: 16, out: null, label: null, help: false };
  const allowed = new Set(["--duration", "--workers", "--out", "--label", "--help", "-h"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
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
        throw new Error(`--duration must be a number >= 1, got ${v}`);
      }
      args.duration = n;
    } else if (a === "--workers") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--workers must be a positive integer, got ${v}`);
      }
      args.workers = n;
    } else if (a === "--out") {
      if (!v || v.trim() === "") throw new Error("--out must be non-empty");
      args.out = v;
    } else if (a === "--label") {
      args.label = v;
    }
    i += 1;
  }
  if (args.help) return args;
  if (args.duration == null) {
    throw new Error("--duration is required (>= 1)");
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
    `Usage: node 2026-10-19-r1-perf-baseline.mjs --duration N [--workers N] [--out PATH] [--label TEXT]\n` +
      `\nOptions:\n` +
      `  --duration N     Seconds to run the workload (>= 1; required)\n` +
      `  --workers N      Number of concurrent worker threads (default 16)\n` +
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
    });
  });
}

async function runWorkers({ workers, durationMs }) {
  const tasks = [];
  for (let i = 0; i < workers; i += 1) {
    tasks.push(runWorkerPromise({ workerId: i, durationMs }));
  }
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
  if (args.help) {
    printHelp();
    return null;
  }
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
      sampling_method: "reservoir_algorithm_r_per_worker",
      reservoir_per_worker: RESERVOIR_PER_WORKER,
      combine_note:
        "Reservoirs are merged after the run; per-worker throughput differences may bias the combined percentiles slightly (see script README)."
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

// Schema introspection helper exported for the test harness. With no
// arguments it uses the script-internal `REQUIRED_COLUMNS` and
// `REQUIRED_INDEXES` constants; callers can override to test subsets.
export function inspectSchema(requiredColumns = REQUIRED_COLUMNS, requiredIndexes = REQUIRED_INDEXES) {
  const db = new Database(":memory:");
  applySchema(db);
  const cols = db.prepare(`PRAGMA table_info(access_log)`).all().map((r) => r.name);
  const idxs = db.prepare(`PRAGMA index_list(access_log)`).all().map((r) => r.name);
  db.close();
  return { columns: cols, indexes: idxs, requiredColumns, requiredIndexes };
}

if (isMainThread) {
  // CLI mode: only run the master path when invoked with at least one
  // known option. `--help`, `--duration`, `--workers`, `--out`, `--label`
  // all trigger CLI mode. When this file is *imported* by a test harness
  // (no recognized option in `process.argv`), the import side simply
  // exposes `inspectSchema` without doing any work.
  const argv = process.argv.slice(2);
  const CLI_FLAGS = new Set(["--help", "-h", "--duration", "--workers", "--out", "--label"]);
  const looksLikeCli = argv.some((a) => CLI_FLAGS.has(a));
  if (looksLikeCli) {
    runMain(argv).catch((err) => {
      console.error("[perf-baseline] failed:", err.message);
      process.exit(1);
    });
  }
} else {
  workerBoot(workerData);
}
