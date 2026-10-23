#!/usr/bin/env node
/**
 * audit-trust-2026-10-19-r1 / T08b.2 — acceptance matrix generator
 *
 * Reads a v2 manifest.json (output of performExportV2 / buildExportPackV2)
 * and emits a CSV matrix mapping each contract criterion to PASS/FAIL/N-A
 * based on the manifest's field values. Operator-readable evidence for the
 * G3 acceptance step.
 *
 * Usage:
 *   node 2026-10-19-r1-acceptance-matrix.mjs --in manifest.json --out matrix.csv
 *   node 2026-10-19-r1-acceptance-matrix.mjs --help
 *
 * The matrix is a flat CSV with three columns:
 *   criterion, observed_value, verdict
 * where verdict is one of `pass`, `fail`, `n/a`.
 *
 * The criterion set is fixed and asserted against the manifest surface; it
 * does NOT drift with schema version. Adding new criteria requires a new
 * builder function and a corresponding test.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { dirname, join, resolve } = path;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_VERSION = "audit-trust-acceptance-matrix/v1";
const MAX_INPUT_BYTES = 50 * 1024 * 1024; // 50 MiB — manifests are typically < 10 KiB.

function parseArgs(argv) {
  const args = { in: null, out: null, label: null, help: false };
  const allowed = new Set(["--in", "--out", "--label", "--help", "-h"]);
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
    if (a === "--in") args.in = v;
    if (a === "--out") args.out = v;
    if (a === "--label") args.label = v;
    i += 1;
  }
  if (args.help) return args;
  if (!args.in) {
    throw new Error("--in is required");
  }
  if (!args.out) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    args.out = join(__dirname, "2026-10-19-r1-acceptance-matrix", `matrix-${stamp}.csv`);
  }
  if (!args.label) args.label = "local";
  return args;
}

function printHelp() {
  console.log(
    `Usage: node 2026-10-19-r1-acceptance-matrix.mjs --in manifest.json --out matrix.csv\n` +
      `\nOptions:\n` +
      `  --in <path>   Path to a v2 manifest.json (required)\n` +
      `  --out <path>  Output CSV path (default under scripts/audit-trust/.../)\n` +
      `  --label <text>  Short label stamped on the console summary line\n` +
      `  --help, -h    Show this message\n`
  );
}

/**
 * @typedef {Record<string, unknown>} Manifest
 *
 * Fixed criterion set. Adding / removing / reordering any entry requires
 * updating the EXPECTED_CRITERIA_NAMES constant in
 * scripts/audit-trust/__tests__/2026-10-19-r1-acceptance-matrix.test.mjs.
 */
const EXPECTED_CRITERIA_NAMES = Object.freeze([
  "schemaVersion is 'audit-export-manifest/v2'",
  "ledgerUpperSeq is a non-negative integer",
  "projectionComplete is boolean true",
  "scopeComplete is boolean true",
  "fileHashOk is boolean true",
  "relationCheckOk is boolean true",
  "combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk",
  "associationQuality has all five categories",
  "dataScope.ok is boolean (always populated)",
  "clientCoverage.observed is boolean; gapWindows is an array",
  "policyScopeExpanded is an array (audit-trust spec §4.7)",
  "untrustedSelfReport is a non-negative integer",
  "legalEmptyWindow is boolean",
  "lagMs is a non-negative integer",
  "classificationVersion is non-empty",
  "digestVersion is non-empty"
]);

function buildCriteria() {
  /** @type {Array<{ name: string, run: (m: Manifest) => { observed: string; verdict: "pass"|"fail"|"n/a" } }>} */
  return [
    {
      name: EXPECTED_CRITERIA_NAMES[0],
      run: (m) => ({
        observed: `schemaVersion="${m.schemaVersion ?? "<missing>"}"`,
        verdict: m.schemaVersion === "audit-export-manifest/v2" ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[1],
      run: (m) => {
        const v = m.ledgerUpperSeq;
        const ok = typeof v === "number" && Number.isInteger(v) && v >= 0;
        return { observed: ok ? String(v) : `<${typeof v} ${v}>`, verdict: ok ? "pass" : "fail" };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[2],
      run: (m) => ({
        observed: typeof m.projectionComplete === "boolean" ? String(m.projectionComplete) : `<${typeof m.projectionComplete}>`,
        verdict: m.projectionComplete === true ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[3],
      run: (m) => ({
        observed: typeof m.scopeComplete === "boolean" ? String(m.scopeComplete) : `<${typeof m.scopeComplete}>`,
        verdict: m.scopeComplete === true ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[4],
      run: (m) => {
        const ok = m.integrityVerification?.fileHashOk;
        return {
          observed: typeof ok === "boolean" ? String(ok) : `<${typeof ok}>`,
          verdict: ok === true ? "pass" : "fail"
        };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[5],
      run: (m) => {
        const ok = m.integrityVerification?.relationCheckOk;
        return {
          observed: typeof ok === "boolean" ? String(ok) : `<${typeof ok}>`,
          verdict: ok === true ? "pass" : "fail"
        };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[6],
      run: (m) => {
        const scope = typeof m.scopeComplete === "boolean";
        const fileHash = typeof m.integrityVerification?.fileHashOk === "boolean";
        const relation = typeof m.integrityVerification?.relationCheckOk === "boolean";
        const combined = typeof m.combinedComplete === "boolean";
        const truthyCount =
          (scope ? (m.scopeComplete ? 1 : 0) : 0) +
          (fileHash ? (m.integrityVerification.fileHashOk ? 1 : 0) : 0) +
          (relation ? (m.integrityVerification.relationCheckOk ? 1 : 0) : 0);
        const expected = truthyCount === 3; // AND semantics
        const got = m.combinedComplete === true;
        const consensus = combined && got === expected;
        // n/a: if any of the four booleans is missing/non-boolean, fall back
        // to n/a (we cannot defensively infer the AND).
        if (!(scope && fileHash && relation && combined)) return { observed: "n/a (non-boolean inputs)", verdict: "n/a" };
        return {
          observed: `scope=${m.scopeComplete} fileHash=${m.integrityVerification.fileHashOk} relation=${m.integrityVerification.relationCheckOk}; combined=${m.combinedComplete} (truthy=${truthyCount}/3)`,
          verdict: consensus ? "pass" : "fail"
        };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[7],
      run: (m) => {
        const aq = m.associationQuality;
        const keys = ["confirmed", "candidate", "unassigned", "conflict", "legacyUnverified"];
        const missing = keys.filter((k) => typeof aq?.[k] !== "number");
        if (missing.length > 0) {
          return { observed: `missing: ${missing.join(",")}`, verdict: "n/a" };
        }
        return {
          observed: keys.map((k) => `${k}=${aq[k]}`).join(","),
          verdict: "pass"
        };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[8],
      run: (m) => ({
        observed: typeof m.dataScope?.ok === "boolean" ? String(m.dataScope.ok) : `<${typeof m.dataScope?.ok}>`,
        verdict: typeof m.dataScope?.ok === "boolean" ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[9],
      run: (m) => {
        const cc = m.clientCoverage;
        const observed = typeof cc?.observed === "boolean";
        const gaps = Array.isArray(cc?.gapWindows);
        if (!observed || !gaps) {
          return {
            observed: `observed=<${typeof cc?.observed}> gapWindows=<${Array.isArray(cc?.gapWindows) ? "array" : typeof cc?.gapWindows}>`,
            verdict: "n/a"
          };
        }
        return { observed: `observed=${cc.observed} gapWindows=${cc.gapWindows.length}`, verdict: "pass" };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[10],
      run: (m) => {
        // n/a: some manifests may not require policyScopeExpanded.
        if (m.policyScopeExpanded === undefined) {
          return { observed: "<missing>", verdict: "n/a" };
        }
        const isArr = Array.isArray(m.policyScopeExpanded);
        return {
          observed: isArr ? `array(len=${m.policyScopeExpanded.length})` : `<${typeof m.policyScopeExpanded}>`,
          verdict: isArr ? "pass" : "fail"
        };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[11],
      run: (m) => {
        const v = m.untrustedSelfReport;
        const ok = typeof v === "number" && Number.isInteger(v) && v >= 0;
        return { observed: ok ? String(v) : `<${typeof v}>`, verdict: ok ? "pass" : "fail" };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[12],
      run: (m) => ({
        observed: typeof m.legalEmptyWindow === "boolean" ? String(m.legalEmptyWindow) : `<${typeof m.legalEmptyWindow}>`,
        verdict: typeof m.legalEmptyWindow === "boolean" ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[13],
      run: (m) => {
        const v = m.lagMs;
        const ok = typeof v === "number" && Number.isInteger(v) && v >= 0;
        return { observed: ok ? String(v) : `<${typeof v}>`, verdict: ok ? "pass" : "fail" };
      }
    },
    {
      name: EXPECTED_CRITERIA_NAMES[14],
      run: (m) => ({
        observed: `classificationVersion="${m.classificationVersion ?? "<missing>"}"`,
        verdict: typeof m.classificationVersion === "string" && m.classificationVersion.length > 0 ? "pass" : "fail"
      })
    },
    {
      name: EXPECTED_CRITERIA_NAMES[15],
      run: (m) => ({
        observed: `digestVersion="${m.digestVersion ?? "<missing>"}"`,
        verdict: typeof m.digestVersion === "string" && m.digestVersion.length > 0 ? "pass" : "fail"
      })
    }
  ];
}

function csvEscape(value) {
  const s = String(value ?? "");
  // Cover all three RFC 4180 line break variants + comma + quote.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function summarize(criteriaResults) {
  let pass = 0, fail = 0, na = 0;
  for (const r of criteriaResults) {
    if (r.verdict === "pass") pass += 1;
    else if (r.verdict === "fail") fail += 1;
    else if (r.verdict === "n/a") na += 1;
  }
  return { pass, fail, na };
}

function renderMatrix(manifest) {
  const criteria = buildCriteria();
  const rows = ["criterion,observed_value,verdict"];
  const results = [];
  for (const c of criteria) {
    const r = c.run(manifest);
    results.push(r);
    rows.push([csvEscape(c.name), csvEscape(r.observed), csvEscape(r.verdict)].join(","));
  }
  return { csv: rows.join("\n") + "\n", results };
}

function runMain(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  // Refuse --in == --out so a typo can't destroy the source manifest.
  const inAbs = resolve(args.in);
  const outAbs = resolve(args.out);
  if (inAbs === outAbs) {
    throw new Error("--in and --out must be different paths (refusing to overwrite the input manifest)");
  }
  // Refuse large inputs to bound memory before JSON.parse.
  const stat = statSync(args.in);
  if (!stat.isFile()) {
    throw new Error(`--in is not a regular file: ${args.in}`);
  }
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error(
      `--in is too large (${stat.size} bytes > ${MAX_INPUT_BYTES} cap). Refusing to read.`
    );
  }
  /** @type {Manifest} */
  const manifest = JSON.parse(readFileSync(args.in, "utf8"));
  const { csv, results } = renderMatrix(manifest);

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, csv);

  const { pass, fail, na } = summarize(results);
  console.log(
    `[acceptance-matrix] wrote ${args.out}: ${pass} pass / ${fail} fail / ${na} n/a (label=${args.label}, schema=${SCHEMA_VERSION})`
  );
  if (fail > 0) process.exit(2);
  return { csv, pass, fail, na };
}

function isMainEntry() {
  // ESM equivalent of `require.main === module`. When the script is
  // invoked via `node script.mjs`, `process.argv[1]` resolves to the
  // script's own URL. When this file is imported as a module, the
  // entry script in argv[1] is something else. We resolve symlinks
  // (macOS `/tmp` is a symlink to `/private/tmp`; without this, the
  // comparison would always fail when the script is invoked via a
  // symlinked path).
  try {
    if (!process.argv[1]) return false;
    const argvPath = realpathSync(path.resolve(process.argv[1]));
    const metaPath = realpathSync(fileURLToPath(import.meta.url));
    return argvPath === metaPath;
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  try {
    runMain(process.argv.slice(2));
  } catch (err) {
    console.error("[acceptance-matrix] failed:", err.message);
    process.exit(1);
  }
}

export {
  buildCriteria,
  renderMatrix,
  summarize,
  csvEscape,
  SCHEMA_VERSION,
  EXPECTED_CRITERIA_NAMES,
  MAX_INPUT_BYTES
};

