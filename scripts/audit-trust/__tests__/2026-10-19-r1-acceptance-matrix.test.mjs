/**
 * audit-trust-2026-10-19-r1 / T08b.2 — acceptance matrix generator smoke
 *
 * Runs the matrix generator on a fixture v2 manifest and asserts the
 * CSV output conforms. We also exercise the public `buildCriteria`
 * / `renderMatrix` / `summarize` exports directly to verify the criterion
 * set is stable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCriteria,
  renderMatrix,
  summarize,
  csvEscape,
  SCHEMA_VERSION,
  EXPECTED_CRITERIA_NAMES,
  MAX_INPUT_BYTES
} from "../2026-10-19-r1-acceptance-matrix.mjs";

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

describe("T08b.2 acceptance matrix generator", () => {
  it("exports a stable SCHEMA_VERSION", () => {
    assert.equal(SCHEMA_VERSION, "audit-trust-acceptance-matrix/v1");
  });

  it("exports a frozen EXPECTED_CRITERIA_NAMES list (drift guard)", () => {
    assert.ok(Object.isFrozen(EXPECTED_CRITERIA_NAMES));
    // The expected list is the canonical fixture for the criterion set.
    // Drift is only allowed when both the script and this test are
    // updated together.
    assert.equal(EXPECTED_CRITERIA_NAMES.length, 16);
    assert.equal(
      new Set(EXPECTED_CRITERIA_NAMES).size,
      EXPECTED_CRITERIA_NAMES.length,
      "EXPECTED_CRITERIA_NAMES must contain unique entries"
    );
    // Specific names that operator-readable output relies on.
    assert.ok(
      EXPECTED_CRITERIA_NAMES.includes("schemaVersion is 'audit-export-manifest/v2'")
    );
    assert.ok(
      EXPECTED_CRITERIA_NAMES.includes(
        "combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk"
      )
    );
  });

  it("buildCriteria returns exactly EXPECTED_CRITERIA_NAMES, in order", () => {
    const criteria = buildCriteria();
    assert.equal(criteria.length, EXPECTED_CRITERIA_NAMES.length);
    assert.deepEqual(
      criteria.map((c) => c.name),
      [...EXPECTED_CRITERIA_NAMES]
    );
  });

  it("renderMatrix produces a CSV header row + one row per criterion", () => {
    const m = fixtureManifest();
    const { csv } = renderMatrix(m);
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "criterion,observed_value,verdict");
    assert.equal(lines.length - 1, buildCriteria().length);
  });

  it("all criteria pass on a fully-valid manifest", () => {
    const { results } = renderMatrix(fixtureManifest());
    assert.ok(results.every((r) => r.verdict === "pass"), `non-pass verdicts found`);
  });

  it("flags missing schemaVersion as fail", () => {
    const m = fixtureManifest();
    delete m.schemaVersion;
    const { csv } = renderMatrix(m);
    assert.match(csv, /,fail$/m);
  });

  it("flags combinedComplete mismatch as fail (conformance invariant)", () => {
    const m = fixtureManifest({ combinedComplete: false });
    const { csv } = renderMatrix(m);
    assert.match(csv, /combinedComplete =/, "matrix should include the combinedComplete criterion");
    assert.match(csv, /,fail$/m);
  });

  it("covers all 8 combinedComplete AND combinations", () => {
    // Truth table for combinedComplete = scope && fileHash && relation.
    for (const [scope, fileHash, relation, expectedCombined] of [
      [true, true, true, true],
      [true, true, false, false],
      [true, false, true, false],
      [true, false, false, false],
      [false, true, true, false],
      [false, true, false, false],
      [false, false, true, false],
      [false, false, false, false]
    ]) {
      const m = fixtureManifest({
        scopeComplete: scope,
        combinedComplete: expectedCombined,
        integrityVerification: { fileHashOk: fileHash, relationCheckOk: relation }
      });
      const { results } = renderMatrix(m);
      // Locate the combinedComplete criterion (entry index 6 per EXPECTED list).
      const combined = results[6];
      assert.equal(
        combined.verdict,
        "pass",
        `scope=${scope}, fileHash=${fileHash}, relation=${relation} should pass`
      );
    }
  });

  it("flags OR-corruption (combinedComplete=true but a factor is false) as fail", () => {
    // scope=false but combinedComplete=true is an OR-error; should fail.
    const m = fixtureManifest({ scopeComplete: false, combinedComplete: true });
    const { results } = renderMatrix(m);
    assert.equal(results[6].verdict, "fail");
  });

  it("returns n/a when a non-boolean is supplied to combinedComplete factors", () => {
    const m = fixtureManifest({
      scopeComplete: "yes" /* non-boolean */,
      combinedComplete: true
    });
    const { results } = renderMatrix(m);
    assert.equal(results[6].verdict, "n/a");
  });

  it("returns n/a when clientCoverage is missing or wrong shape", () => {
    const m1 = fixtureManifest();
    delete m1.clientCoverage;
    assert.equal(renderMatrix(m1).results[9].verdict, "n/a");
    const m2 = fixtureManifest({ clientCoverage: { observed: "yes", gapWindows: [] } });
    assert.equal(renderMatrix(m2).results[9].verdict, "n/a");
  });

  it("returns n/a when associationQuality is missing a category", () => {
    const m = fixtureManifest();
    delete m.associationQuality.confirmed;
    assert.equal(renderMatrix(m).results[7].verdict, "n/a");
  });

  it("returns n/a when policyScopeExpanded is undefined (optional field)", () => {
    const m = fixtureManifest();
    delete m.policyScopeExpanded;
    assert.equal(renderMatrix(m).results[10].verdict, "n/a");
  });

  it("summarize() counts pass/fail/n/a from results", () => {
    const results = [
      { observed: "x", verdict: "pass" },
      { observed: "y", verdict: "pass" },
      { observed: "z", verdict: "fail" },
      { observed: "w", verdict: "n/a" }
    ];
    assert.deepEqual(summarize(results), { pass: 2, fail: 1, na: 1 });
  });

  it("csvEscape covers commas, quotes, CR, and LF", () => {
    assert.equal(csvEscape("a,b"), '"a,b"');
    assert.equal(csvEscape('a"b'), '"a""b"');
    assert.equal(csvEscape("a\nb"), '"a\nb"');
    assert.equal(csvEscape("a\rb"), '"a\rb"');
    assert.equal(csvEscape("a\rb\nc,d"), '"a\rb\nc,d"');
    assert.equal(csvEscape("plain"), "plain");
  });

  it("MAX_INPUT_BYTES is 50 MiB (cap is conservative for manifests)", () => {
    assert.equal(MAX_INPUT_BYTES, 50 * 1024 * 1024);
  });

  it("end-to-end: writes CSV to --out path with row count == 17 (header + 16 criteria)", () => {
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
      assert.equal(lines.length, 17, "expected header + 16 criteria");
      assert.equal(lines[0], "criterion,observed_value,verdict");
      for (const l of lines.slice(1)) {
        assert.ok(l.endsWith(",pass"), `unexpected verdict in line: ${l}`);
      }
    } finally {
      try {
        unlinkSync(inPath);
        unlinkSync(outPath);
      } catch {}
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
      } catch {}
    }
  });

  it("refuses --in == --out (refuses to overwrite the input manifest)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-trust-matrix-same-"));
    const path = join(tmp, "manifest.json");
    writeFileSync(path, JSON.stringify(fixtureManifest()));
    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync("node", [SCRIPT, "--in", path, "--out", path], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (err) {
      exitCode = typeof err.status === "number" ? err.status : 1;
      stderr = String(err.stderr ?? "");
    }
    assert.equal(exitCode, 1);
    assert.match(stderr, /must be different|overwrite/);
    // Input must NOT have been overwritten.
    const after = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(after.schemaVersion, "audit-export-manifest/v2");
  });
});
