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
      timeout: 30_000
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

  it("records positive latency percentiles (p50, p95, p99)", () => {
    const { evidence } = runScript(["--duration", "1", "--workers", "2"]);
    assert.ok(evidence.latency_us.p50 > 0);
    assert.ok(evidence.latency_us.p95 >= evidence.latency_us.p50);
    assert.ok(evidence.latency_us.p99 >= evidence.latency_us.p95);
    assert.ok(evidence.latency_us.sample_count > 0);
  });

  it("emits per_worker entries equal to the worker count", () => {
    const { evidence } = runScript(["--duration", "1", "--workers", "2"]);
    assert.equal(evidence.per_worker.length, 2);
    for (const w of evidence.per_worker) {
      assert.ok(w.worker_id >= 0);
      assert.ok(w.rows > 0);
      assert.equal(w.errors, 0);
      assert.ok(w.rows_per_sec > 0);
    }
  });

  it("higher worker count produces >= rows (4 vs 8)", () => {
    const low = runScript(["--duration", "1", "--workers", "4"]).evidence;
    const high = runScript(["--duration", "1", "--workers", "8"]).evidence;
    assert.ok(high.totals.rows_inserted >= low.totals.rows_inserted);
  });

  it("rejects invalid --duration", () => {
    assert.throws(() => runScript(["--duration", "0", "--workers", "2"]));
    assert.throws(() => runScript(["--duration", "-1", "--workers", "2"]));
  });

  it("rejects invalid --workers", () => {
    assert.throws(() => runScript(["--duration", "1", "--workers", "0"]));
    assert.throws(() => runScript(["--duration", "1", "--workers", "1.5"]));
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
