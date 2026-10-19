/**
 * audit-trust-2026-10-19-r1 / T08a.2 — perf baseline smoke test
 *
 * Runs the perf baseline script with --duration 1 / --workers 2 (so the
 * suite stays fast), then verifies the evidence JSON is well-formed and
 * the run actually exercised the write path. Production-grade 5-minute
 * 16-worker runs are operator-executed; this smoke test guards against
 * drift in the script (e.g., schema changes breaking all INSERTs, or a
 * worker_threads topology breaking the message protocol).
 *
 * Run with: node --test scripts/audit-trust/__tests__/2026-10-19-r1-perf-baseline.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "2026-10-19-r1-perf-baseline.mjs");

function runScript(args) {
  const tmp = mkdtempSync(join(tmpdir(), "audit-trust-perf-"));
  const out = join(tmp, `perf-${Date.now()}.json`);
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args, "--out", out], {
      encoding: "utf8",
      timeout: 60_000
    });
    const evidence = JSON.parse(readFileSync(out, "utf8"));
    const size = statSync(out).size;
    return { evidence, stdout, outPath: out, size };
  } finally {
    try {
      unlinkSync(out);
    } catch {
      // best-effort
    }
  }
}

function runScriptExpectFailure(args) {
  try {
    execFileSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    throw new Error("script unexpectedly succeeded");
  } catch (err) {
    // Strip the synthetic wrapper; the child process exit code drives the
    // stderr we want to assert against.
    const stderr = String(err.stderr ?? "");
    const stdout = String(err.stdout ?? "");
    if (!/failed:|--duration|--workers|unknown option|requires a value/.test(stderr + stdout)) {
      throw new Error(
        `unexpected error content\nstderr=${stderr}\nstdout=${stdout}\nmessage=${err.message}`
      );
    }
    return { stderr, stdout };
  }
}

describe("T08a.2 perf-baseline script smoke", () => {
  it("runs end-to-end with 2 workers / 1 second and emits valid evidence", () => {
    const { evidence, stdout } = runScript(["--duration", "1", "--workers", "2"]);
    assert.equal(evidence.schema_version, "audit-trust-perf-baseline/v1");
    assert.equal(evidence.config.duration_s, 1);
    assert.equal(evidence.config.workers, 2);
    assert.ok(evidence.totals.rows_inserted > 0);
    assert.equal(evidence.totals.errors, 0);
    assert.ok(evidence.totals.throughput_per_sec > 0);
    assert.match(stdout, /perf-baseline/);
  });

  it("records positive latency percentiles (p50, p95, p99) via reservoir sampling", () => {
    const { evidence } = runScript(["--duration", "1", "--workers", "2"]);
    assert.ok(evidence.latency_us.p50 > 0);
    assert.ok(evidence.latency_us.p95 >= evidence.latency_us.p50);
    assert.ok(evidence.latency_us.p99 >= evidence.latency_us.p95);
    assert.ok(evidence.latency_us.sample_count > 0);
    assert.equal(evidence.latency_us.sampling_method, "reservoir_algorithm_r");
    // Each worker contributes exactly RESERVOIR_PER_WORKER samples once
    // observed >= capacity, so total samples <= workers * RESERVOIR_PER_WORKER.
    assert.ok(
      evidence.latency_us.sample_count <=
        evidence.config.workers * evidence.config.reservoir_per_worker
    );
  });

  it("emits per_worker entries with unique worker_id 0..N-1", () => {
    const { evidence } = runScript(["--duration", "1", "--workers", "4"]);
    assert.equal(evidence.per_worker.length, 4);
    const ids = new Set();
    for (const w of evidence.per_worker) {
      assert.ok(w.worker_id >= 0);
      assert.ok(w.worker_id < 4);
      assert.ok(!ids.has(w.worker_id), `duplicate worker_id ${w.worker_id}`);
      ids.add(w.worker_id);
      assert.ok(w.rows > 0);
      assert.equal(w.errors, 0);
      assert.ok(w.rows_per_sec > 0);
    }
  });

  it("rows_inserted matches the sum across per_worker", () => {
    const { evidence } = runScript(["--duration", "1", "--workers", "4"]);
    const sum = evidence.per_worker.reduce((a, w) => a + w.rows, 0);
    assert.equal(evidence.totals.rows_inserted, sum);
  });

  it("rejects --duration < 1 (zero, negative, fractional, non-numeric)", () => {
    runScriptExpectFailure(["--duration", "0", "--workers", "2"]);
    runScriptExpectFailure(["--duration", "-1", "--workers", "2"]);
    runScriptExpectFailure(["--duration", "0.5", "--workers", "2"]);
    runScriptExpectFailure(["--duration", "abc", "--workers", "2"]);
  });

  it("rejects --workers 0 / non-integer / negative", () => {
    runScriptExpectFailure(["--duration", "1", "--workers", "0"]);
    runScriptExpectFailure(["--duration", "1", "--workers", "1.5"]);
    runScriptExpectFailure(["--duration", "1", "--workers", "-4"]);
  });

  it("rejects unknown options", () => {
    runScriptExpectFailure(["--bogus", "1", "--workers", "2"]);
  });

  it("rejects options with missing values", () => {
    // --duration followed by another option should be rejected.
    runScriptExpectFailure(["--duration", "--workers", "2"]);
    runScriptExpectFailure(["--workers", "2", "--out"]);
  });

  it("writes to the configured --out path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-trust-perf-out-"));
    const customOut = join(tmp, "perf-custom.json");
    try {
      execFileSync(
        "node",
        [SCRIPT, "--duration", "1", "--workers", "2", "--out", customOut],
        { encoding: "utf8", timeout: 30_000 }
      );
      const evidence = JSON.parse(readFileSync(customOut, "utf8"));
      assert.equal(evidence.schema_version, "audit-trust-perf-baseline/v1");
    } finally {
      try {
        unlinkSync(customOut);
      } catch {
        // best-effort
      }
    }
  });

  it("stamps the configured --label on the evidence", () => {
    const { evidence } = runScript([
      "--duration",
      "1",
      "--workers",
      "2",
      "--label",
      "smoke-test-round"
    ]);
    assert.equal(evidence.label, "smoke-test-round");
  });
});
