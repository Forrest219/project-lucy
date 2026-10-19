# audit-trust perf baseline evidence

This directory contains evidence JSON produced by
[`scripts/audit-trust/2026-10-19-r1-perf-baseline.mjs`](../../2026-10-19-r1-perf-baseline.mjs)
during operator runs of the perf baseline workload.

## Evidence schema

| Field | Meaning |
|---|---|
| `schema_version` | `audit-trust-perf-baseline/v1` — fixed across the r1 batch. |
| `generated_at` | ISO 8601 timestamp marking the run. |
| `label` | Operator-provided label (e.g. `r1-baseline-<date>-<config>`). |
| `config.duration_s` | Wall-clock seconds the workload ran. |
| `config.workers` | Concurrent worker threads. |
| `config.classification_version` | Stamped to disambiguate baseline reporting. |
| `elapsed_ms` | Actual elapsed wall-clock time (may exceed `duration_s` due to worker startup). |
| `totals.rows_inserted` | Sum across all workers of successful access_log inserts. |
| `totals.errors` | Sum across all workers of failed inserts. |
| `totals.throughput_per_sec` | `rows_inserted * 1000 / elapsed_ms`. |
| `latency_us.p50` | 50th-percentile per-row INSERT latency (microseconds). |
| `latency_us.p95` | 95th-percentile. |
| `latency_us.p99` | 99th-percentile. |
| `latency_us.sample_count` | Total latency samples (bounded per worker to 4096). |
| `per_worker[]` | Per-worker rows / errors / rows_per_sec. |

## Reproducing the r1 baseline

```sh
node scripts/audit-trust/2026-10-19-r1-perf-baseline.mjs \
  --duration 5 \
  --workers 16 \
  --label r1-baseline-2026-10-20 \
  --out scripts/audit-trust/2026-10-19-r1-perf-baseline/evidence/perf-r1-2026-10-20-5s-16w.json
```

The contract-defined production-target run is 5 minutes / 16 workers; the
smoke test (`scripts/audit-trust/__tests__/2026-10-19-r1-perf-baseline.test.mjs`)
runs the script with 1 second / 2–8 workers so the suite stays fast.

## What this DOES measure

- The throughput of the audit schema (DDL + indexes from T01–T07) under
  synthetic INSERT load.
- Per-row INSERT latency distribution.

## What this DOES NOT measure

- Real client integration (`blocked_due_to_no_real_client` per baseline).
- Real K8s target runner (`blocked_due_to_no_target_runner` per baseline).
- Cross-instance replication (the product is single-instance).

These three are operator-performed at the target environment and live in
their own evidence files (T08d per the implementation plan).
