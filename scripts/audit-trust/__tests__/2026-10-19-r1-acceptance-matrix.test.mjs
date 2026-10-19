/**
 * audit-trust-2026-10-19-r1 / T08b.2 — acceptance matrix generator smoke
 *
 * Runs the matrix generator on a fixture v2 manifest and asserts the
 * CSV output conforms. We also exercise the public `buildCriteria`
 * / `renderMatrix` exports directly to verify the criterion set is
 * stable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCriteria, renderMatrix, SCHEMA_VERSION } from "../2026-10-19-r1-acceptance-matrix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "2026-10-19-r1-acceptance-matrix.mjs");

function fixtureManifest(overrides = {}) {
  return {
    schemaVersion: "audit-export-manifest/v2",
    classificationVersion: "audit-trust-2026-10-19-r1.v1",
    digestVersion: "audit-trust-2026-10-19-r1.v1",
    ledgerUpperSeq: 12345,
    projectionComplete: true,
    scopeComplete: true,
    dataScope: { ok: true },
    associationQuality: {
      confirmed: 100,
      candidate: 20,
      unassigned: 5,
      conflict: 0,
      legacyUnverified: 3
    },
    clientCoverage: {
      observed: true,
      gapWindows: []
    },
    integrityVerification: { fileHashOk: true, relationCheckOk: true },
    combinedComplete: true,
    lagMs: 0,
    policyScopeExpanded: [],
    untrustedSelfReport: 0,
    legalEmptyWindow: false,
    ...overrides
  };
}

function runScript(args, options = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "audit-trust-matrix-"));
  const out = join(tmp, `matrix-${Date.now()}.csv`);
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args, "--out", out], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options
    });
    const csv = readFileSync(out, "utf8");
    return { csv, stdout, outPath: out };
  } finally {
    try {
      unlinkSync(out);
    } catch {
      // best-effort
    }
  }
}

describe("T08b.2 acceptance matrix generator", () => {
  it("exports a stable SCHEMA_VERSION", () => {
    assert.equal(SCHEMA_VERSION, "audit-trust-acceptance-matrix/v1");
  });

  it("buildCriteria returns the fixed criterion set", () => {
    const criteria = buildCriteria();
    assert.ok(criteria.length >= 10, `expected >=10 criteria, got ${criteria.length}`);
    // Each criterion has a name and a run() that returns observed/verdict.
    for (const c of criteria) {
      assert.equal(typeof c.name, "string");
      assert.equal(typeof c.run, "function");
    }
  });

  it("renderMatrix produces a CSV header row + one row per criterion", () => {
    const m = fixtureManifest();
    const csv = renderMatrix(m);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "criterion,observed_value,verdict");
    assert.equal(lines.length - 1, buildCriteria().length);
  });

  it("all criteria pass on a fully-valid manifest", () => {
    const csv = renderMatrix(fixtureManifest());
    const verdictLines = csv.trim().split("\n").slice(1).map((l) => l.split(",").pop());
    assert.ok(verdictLines.every((v) => v === "pass"), `non-pass verdicts found: ${verdictLines}`);
  });

  it("flags missing schemaVersion as fail", () => {
    const m = fixtureManifest();
    delete m.schemaVersion;
    const csv = renderMatrix(m);
    assert.match(csv, /,fail$/m);
  });

  it("flags combinedComplete mismatch as fail (conformance invariant)", () => {
    const m = fixtureManifest({ combinedComplete: false });
    const csv = renderMatrix(m);
    assert.match(csv, /combinedComplete =/, "matrix should include the combinedComplete criterion");
    // The CSV must have at least one fail row.
    assert.match(csv, /,fail$/m);
  });

  it("end-to-end: writes CSV to --out path with row count > 10", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-trust-matrix-"));
    const inPath = join(tmp, "manifest.json");
    const outPath = join(tmp, "matrix.csv");
    writeFileSync(inPath, JSON.stringify(fixtureManifest()));
    try {
      const stdout = execFileSync(
        "node",
        [SCRIPT, "--in", inPath, "--out", outPath],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
      );
      const csv = readFileSync(outPath, "utf8");
      assert.match(stdout, /acceptance-matrix/);
      const lines = csv.trim().split("\n");
      assert.ok(lines.length > 10);
      assert.equal(lines[0], "criterion,observed_value,verdict");
      // All verdicts should be `pass` for a fully-valid manifest.
      for (const l of lines.slice(1)) {
        assert.ok(l.endsWith(",pass"), `unexpected verdict in line: ${l}`);
      }
    } finally {
      try {
        unlinkSync(inPath);
        unlinkSync(outPath);
      } catch {
        // best-effort
      }
    }
  });

  it("returns exit code 2 when any criterion fails", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-trust-matrix-fail-"));
    const inPath = join(tmp, "manifest.json");
    const outPath = join(tmp, "matrix.csv");
    writeFileSync(inPath, JSON.stringify(fixtureManifest({ combinedComplete: false })));
    try {
      let exitCode = 0;
      try {
        execFileSync("node", [SCRIPT, "--in", inPath, "--out", outPath], {
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024
        });
      } catch (err) {
        exitCode = typeof err.status === "number" ? err.status : 1;
      }
      assert.equal(exitCode, 2);
      const csv = readFileSync(outPath, "utf8");
      assert.match(csv, /,fail$/m);
    } finally {
      try {
        unlinkSync(inPath);
        unlinkSync(outPath);
      } catch {
        // best-effort
      }
    }
  });
});
