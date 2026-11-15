#!/usr/bin/env node
/**
 * Suite-level gate for UAT-SUITE-CONTEXT-CONTENT.
 * INDEX PASS must be recomputable from this script's JSON artifact when runs exist.
 * Without runs: exit 0 and print NOT_RUN (suite may be registered but not executed).
 *
 * Usage:
 *   node scripts/uat/judge-context-content.mjs
 *   node scripts/uat/judge-context-content.mjs --evidence inbox/uat-ctx-content-YYYY-MM-DD
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const suiteRuns = path.join(root, "docs/qa/uat/suites/context-content/runs");

const CLAUDE_RE = /claude.*ctx-content\.md$/i;
const CURSOR_RE = /cursor(-cli)?.*ctx-content\.md$/i;

function listRunFiles() {
  if (!existsSync(suiteRuns)) return [];
  return readdirSync(suiteRuns).filter((f) => f.endsWith(".md") && f !== ".gitkeep");
}

function main() {
  const args = process.argv.slice(2);
  const evIdx = args.indexOf("--evidence");
  const evidenceDir =
    evIdx >= 0 && args[evIdx + 1]
      ? path.resolve(root, args[evIdx + 1])
      : path.join(root, "inbox", `uat-ctx-content-judge-${new Date().toISOString().slice(0, 10)}`);

  const runs = listRunFiles();
  const claude = runs.filter((f) => CLAUDE_RE.test(f));
  const cursor = runs.filter((f) => CURSOR_RE.test(f));

  const report = {
    suiteId: "UAT-SUITE-CONTEXT-CONTENT",
    poolId: "P1-30",
    generatedAt: new Date().toISOString(),
    status: "NOT_RUN",
    hosts: {
      claudeCodeCli: { required: true, runFiles: claude },
      cursorAgentCli: { required: true, runFiles: cursor }
    },
    errors: []
  };

  if (runs.length === 0) {
    report.status = "NOT_RUN";
    report.note = "No run records under docs/qa/uat/suites/context-content/runs/; suite registered only.";
    emit(evidenceDir, report);
    console.log("judge-context-content: NOT_RUN (no run files yet)");
    process.exit(0);
  }

  if (claude.length === 0) {
    report.errors.push("missing Claude Code CLI run (*claude*ctx-content.md)");
  }
  if (cursor.length === 0) {
    report.errors.push("missing Cursor Agent CLI run (*cursor*ctx-content.md)");
  }

  // Presence gate only until a full verdict JSON from a live run is supplied.
  const verdictPath = path.join(evidenceDir, "verdict-cases.json");
  if (existsSync(verdictPath)) {
    try {
      const verdict = JSON.parse(readFileSync(verdictPath, "utf8"));
      report.caseVerdict = verdict;
      const failed = Array.isArray(verdict.cases)
        ? verdict.cases.filter((c) => c.result === "FAIL")
        : [];
      if (failed.length > 0) {
        report.errors.push(`verdict-cases.json has FAIL: ${failed.map((c) => c.id).join(",")}`);
      }
    } catch (e) {
      report.errors.push(`cannot parse verdict-cases.json: ${e.message}`);
    }
  } else {
    report.note =
      "Run files present but no verdict-cases.json yet — dual-host presence only; do not claim INDEX PASS.";
  }

  if (report.errors.length > 0) {
    report.status = "FAIL";
    emit(evidenceDir, report);
    console.error("judge-context-content: FAIL");
    for (const e of report.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  report.status = existsSync(verdictPath) ? "PASS_CANDIDATE" : "HOSTS_PRESENT";
  emit(evidenceDir, report);
  console.log(`judge-context-content: ${report.status}`);
  if (report.status === "HOSTS_PRESENT") {
    console.log("  (add verdict-cases.json under --evidence before INDEX PASS)");
  }
  process.exit(0);
}

function emit(dir, report) {
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "judge-report.json");
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(`wrote ${path.relative(root, out)}`);
}

main();
