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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMA_VERSION = "audit-trust-acceptance-matrix/v1";

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
      `  --label <text>  Short label stamped on metadata rows\n` +
      `  --help, -h    Show this message\n`
  );
}

/**
 * @typedef {Record<string, unknown>} Manifest
 *
 * Build a fixed set of criteria. Each criterion is { name, predicate }
 * where predicate returns { observed: string, verdict: "pass"|"fail"|"n/a" }.
 */
function buildCriteria() {
  /** @type {Array<{ name: string, run: (m: Manifest) => { observed: string; verdict: "pass"|"fail"|"n/a" } }>} */
  return [
    {
      name: "schemaVersion is 'audit-export-manifest/v2'",
      run: (m) => ({
        observed: String(m.schemaVersion ?? ""),
        verdict: m.schemaVersion === "audit-export-manifest/v2" ? "pass" : "fail"
      })
    },
    {
      name: "ledgerUpperSeq is a non-negative integer",
      run: (m) => {
        const v = m.ledgerUpperSeq;
        return {
          observed: typeof v === "number" ? String(v) : "not-a-number",
          verdict:
            typeof v === "number" && Number.isInteger(v) && v >= 0 ? "pass" : "fail"
        };
      }
    },
    {
      name: "projectionComplete is boolean true",
      run: (m) => ({
        observed: String(m.projectionComplete),
        verdict: m.projectionComplete === true ? "pass" : "fail"
      })
    },
    {
      name: "scopeComplete is boolean true",
      run: (m) => ({
        observed: String(m.scopeComplete),
        verdict: m.scopeComplete === true ? "pass" : "fail"
      })
    },
    {
      name: "fileHashOk is boolean true",
      run: (m) => {
        const ok = m.integrityVerification?.fileHashOk;
        return {
          observed: String(ok),
          verdict: ok === true ? "pass" : "fail"
        };
      }
    },
    {
      name: "relationCheckOk is boolean true",
      run: (m) => {
        const ok = m.integrityVerification?.relationCheckOk;
        return {
          observed: String(ok),
          verdict: ok === true ? "pass" : "fail"
        };
      }
    },
    {
      name: "combinedComplete = scopeComplete && fileHashOk && relationCheckOk",
      run: (m) => {
        const eq =
          m.scopeComplete === true &&
          m.integrityVerification?.fileHashOk === true &&
          m.integrityVerification?.relationCheckOk === true;
        const got = m.combinedComplete === true;
        return {
          observed: `scope=${m.scopeComplete} fileHash=${m.integrityVerification?.fileHashOk} relation=${m.integrityVerification?.relationCheckOk}; combined=${m.combinedComplete}`,
          verdict: eq === got ? "pass" : "fail"
        };
      }
    },
    {
      name: "associationQuality has all five categories",
      run: (m) => {
        const aq = m.associationQuality;
        const keys = ["confirmed", "candidate", "unassigned", "conflict", "legacyUnverified"];
        const present = keys.every((k) => typeof aq?.[k] === "number");
        return {
          observed: keys.map((k) => `${k}=${aq?.[k] ?? "n/a"}`).join(","),
          verdict: present ? "pass" : "fail"
        };
      }
    },
    {
      name: "dataScope.ok is boolean (always populated)",
      run: (m) => ({
        observed: String(m.dataScope?.ok),
        verdict: typeof m.dataScope?.ok === "boolean" ? "pass" : "fail"
      })
    },
    {
      name: "clientCoverage.observed is boolean; gapWindows is an array",
      run: (m) => {
        const cc = m.clientCoverage;
        const ok = typeof cc?.observed === "boolean" && Array.isArray(cc?.gapWindows);
        return {
          observed: `observed=${cc?.observed} gapWindows=${Array.isArray(cc?.gapWindows) ? cc.gapWindows.length : "not-array"}`,
          verdict: ok ? "pass" : "fail"
        };
      }
    },
    {
      name: "policyScopeExpanded is an array (audit-trust spec §4.7)",
      run: (m) => ({
        observed: Array.isArray(m.policyScopeExpanded) ? `array(len=${m.policyScopeExpanded.length})` : "not-array",
        verdict: Array.isArray(m.policyScopeExpanded) ? "pass" : "fail"
      })
    },
    {
      name: "untrustedSelfReport is a non-negative integer",
      run: (m) => {
        const v = m.untrustedSelfReport;
        return {
          observed: String(v),
          verdict:
            typeof v === "number" && Number.isInteger(v) && v >= 0 ? "pass" : "fail"
        };
      }
    },
    {
      name: "legalEmptyWindow is boolean",
      run: (m) => ({
        observed: String(m.legalEmptyWindow),
        verdict: typeof m.legalEmptyWindow === "boolean" ? "pass" : "fail"
      })
    },
    {
      name: "lagMs is a non-negative integer",
      run: (m) => {
        const v = m.lagMs;
        return {
          observed: String(v),
          verdict:
            typeof v === "number" && Number.isInteger(v) && v >= 0 ? "pass" : "fail"
        };
      }
    },
    {
      name: "classificationVersion is non-empty",
      run: (m) => ({
        observed: String(m.classificationVersion ?? ""),
        verdict: typeof m.classificationVersion === "string" && m.classificationVersion.length > 0 ? "pass" : "fail"
      })
    },
    {
      name: "digestVersion is non-empty",
      run: (m) => ({
        observed: String(m.digestVersion ?? ""),
        verdict: typeof m.digestVersion === "string" && m.digestVersion.length > 0 ? "pass" : "fail"
      })
    }
  ];
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function renderMatrix(manifest) {
  const criteria = buildCriteria();
  const rows = ["criterion,observed_value,verdict"];
  for (const c of criteria) {
    const r = c.run(manifest);
    rows.push([csvEscape(c.name), csvEscape(r.observed), csvEscape(r.verdict)].join(","));
  }
  return rows.join("\n") + "\n";
}

function runMain(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return null;
  }
  const raw = readFileSync(args.in, "utf8");
  /** @type {Manifest} */
  const manifest = JSON.parse(raw);
  const csv = renderMatrix(manifest);

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, csv);

  // Print summary line.
  const lines = csv.trim().split("\n").slice(1);
  const pass = lines.filter((l) => l.endsWith(",pass")).length;
  const fail = lines.filter((l) => l.endsWith(",fail")).length;
  const na = lines.filter((l) => l.endsWith(",n/a")).length;
  console.log(
    `[acceptance-matrix] wrote ${args.out}: ${pass} pass / ${fail} fail / ${na} n/a (label=${args.label}, schema=${SCHEMA_VERSION})`
  );
  if (fail > 0) {
    process.exit(2);
  }
  return { csv, pass, fail, na };
}

const looksLikeCli = process.argv.slice(2).some((a) =>
  new Set(["--help", "-h", "--in", "--out", "--label"]).has(a)
);
if (looksLikeCli) {
  try {
    runMain(process.argv.slice(2));
  } catch (err) {
    console.error("[acceptance-matrix] failed:", err.message);
    process.exit(1);
  }
}

export { buildCriteria, renderMatrix, SCHEMA_VERSION };
