#!/usr/bin/env node
// Produces <runDir>/results/gates.json for the verifier from structured sources only:
//   - GATE-01-V01..V16: the verifier's own reverse tests, run through the node:test event API (no stdout parsing);
//   - SEC-23-V01/V02: results/npm-audit.json against docs/qa/security-findings.yaml;
//   - SEC-06-V03/V04/V05, SEC-17-V10: a scan of every artifact this run retained, for credentials;
//   - SEC-23-V05: results/existing-gates.json (G1–G4 + ELF), bound to the candidate image digest;
//   - OPS-01-*: results/ops.json written by the K8s acceptance step (absent => BLOCKED);
//   - existing gates + counters from results/existing-gates.json / context-migration.json / projection.json.
// A source that is absent yields BLOCKED for the cases it feeds; nothing is inferred or defaulted to passed.
//   node scripts/gates/collect-gate-results.mjs --run <run.json> --candidate <identity.json>

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { run as runTests } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { loadCatalog } from "../e2e/lib/catalog.mjs";
import { REPO_ROOT, fail, loadRun, parseArgv } from "../e2e/lib/common.mjs";
import { scanText } from "../e2e/lib/leak-scan.mjs";
import { crossCheckDependencies, FINDINGS_PATH, REQUIRED_EXISTING_GATES } from "../e2e/verify-evidence.mjs";

const GATE_TEST_FILE = path.join(REPO_ROOT, "scripts/e2e/__tests__/evidence-verifier.test.mjs");
const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function writeCase(runDir, entry) {
  const dir = path.join(runDir, "results", "gates");
  mkdirSync(dir, { recursive: true });
  const text = `${JSON.stringify({ id: entry.id, status: entry.status, detail: entry.detail, assertions: entry.assertions }, null, 2)}\n`;
  const file = path.join(dir, `${entry.id}.json`);
  writeFileSync(file, text);
  return { ...entry, artifacts: [{ path: path.relative(runDir, file), sha256: createHash("sha256").update(text).digest("hex") }] };
}

/** Runs the reverse tests through the structured event stream; returns Map(caseId -> {status, detail}). */
export async function runReverseTests(file = GATE_TEST_FILE) {
  const outcomes = new Map();
  for await (const event of runTests({ files: [file], concurrency: false })) {
    if (event.type !== "test:pass" && event.type !== "test:fail") continue;
    const match = /\[(GATE-01-V\d{2})\]/.exec(event.data.name ?? "");
    if (!match) continue;
    const prior = outcomes.get(match[1]);
    const status = event.type === "test:pass" ? "passed" : "failed";
    outcomes.set(match[1], { status: prior?.status === "failed" ? "failed" : status, detail: event.data.name });
  }
  return outcomes;
}

function scanRetained(run, secrets) {
  const roots = [path.join(run.paths.runDir, "results"), run.paths.logs];
  let scanned = 0;
  let hits = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (statSync(full).size < 64 * 1024 * 1024) {
        scanned += 1;
        hits += scanText(readFileSync(full).toString("utf8"), { secrets }).length;
      }
    }
  };
  roots.forEach(walk);
  return { scanned, hits };
}

export async function collectGateResults({ run, candidate, reverseTests = runReverseTests }) {
  const dir = path.join(run.paths.runDir, "results");
  const { cases } = loadCatalog();
  const gateCases = cases.filter((c) => c.runner === "gate");
  const out = [];
  const blocked = (testCase, reason) => out.push(writeCase(run.paths.runDir, { id: testCase.id, runner: "gate", status: "blocked", detail: reason, assertions: [] }));
  const decided = (testCase, passed, assertions, detail) => out.push(writeCase(run.paths.runDir, { id: testCase.id, runner: "gate", status: passed ? "passed" : "failed", detail, assertions }));

  const outcomes = await reverseTests();
  const audit = readJson(path.join(dir, "npm-audit.json"));
  const existingDoc = readJson(path.join(dir, "existing-gates.json"));
  const ops = readJson(path.join(dir, "ops.json"));
  const findings = parse(readFileSync(FINDINGS_PATH, "utf8"));
  const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
  const secrets = [...Object.values(tokens), admins.owner.password, admins.operator.password, readFileSync(path.join(run.secretsDir, "bootstrap-token"), "utf8").trim()];
  const retained = scanRetained(run, secrets);

  for (const testCase of gateCases) {
    const id = testCase.id;
    if (id.startsWith("GATE-01-")) {
      const outcome = outcomes.get(id);
      if (!outcome) blocked(testCase, "reverse test not found");
      else decided(testCase, outcome.status === "passed", [{ token: "deny", passed: outcome.status === "passed", detail: outcome.detail }], outcome.detail);
    } else if (id === "SEC-23-V01") {
      if (!audit) blocked(testCase, "results/npm-audit.json is absent");
      else {
        const counts = audit.metadata?.vulnerabilities ?? {};
        const bad = (counts.high ?? 0) + (counts.critical ?? 0);
        const cross = crossCheckDependencies({ findings, audit });
        decided(testCase, cross.status === "passed", [{ token: "deny", passed: cross.status === "passed", detail: `${bad} high/critical reported, register ${cross.status}` }, { token: "artifact_scan", passed: true, detail: "npm audit result parsed" }], `${bad} high/critical`);
      }
    } else if (id === "SEC-23-V02") {
      if (!audit) blocked(testCase, "results/npm-audit.json is absent");
      else {
        const cross = crossCheckDependencies({ findings, audit });
        decided(testCase, cross.status === "passed", [{ token: "deny", passed: cross.status === "passed", detail: cross.problems.map((p) => p.code).join(",") || "consistent" }, { token: "artifact_scan", passed: true, detail: "register compared to audit" }], "findings vs npm audit");
      }
    } else if (["SEC-06-V03", "SEC-06-V04", "SEC-06-V05", "SEC-17-V10"].includes(id)) {
      decided(testCase, retained.hits === 0 && retained.scanned > 0, [{ token: "no_leak", passed: retained.hits === 0, detail: `${retained.scanned} retained file(s) scanned, ${retained.hits} hit(s)` }, { token: "artifact_scan", passed: retained.scanned > 0, detail: `${retained.scanned} file(s)` }], "retained artifact credential scan");
    } else if (id === "SEC-23-V05") {
      const needed = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version"];
      const found = needed.map((name) => existingDoc?.gates?.find((g) => g.name === name));
      if (!existingDoc || found.some((g) => !g)) blocked(testCase, "G1–G4 results are absent");
      else {
        const ok = found.every((g) => g.status === "passed" && g.imageDigest === candidate.imageDigest);
        decided(testCase, ok, [{ token: "deny", passed: ok, detail: found.map((g) => `${g.name}:${g.status}`).join(",") }, { token: "artifact_scan", passed: true, detail: "digest-bound" }], "G1–G4 on the candidate digest");
      }
    } else if (id.startsWith("OPS-01-")) {
      const entry = ops?.cases?.find((c) => c.id === id);
      if (!entry) blocked(testCase, "K8s acceptance result (results/ops.json) is absent");
      else out.push(writeCase(run.paths.runDir, { id, runner: "gate", status: entry.status, detail: entry.detail ?? "", assertions: entry.assertions ?? [] }));
    } else {
      blocked(testCase, "no structured source produces this gate case yet");
    }
  }

  const contextMigration = readJson(path.join(dir, "context-migration.json"));
  const projection = readJson(path.join(dir, "projection.json"));
  const body = {
    contract: "lucy-gate-results-v1",
    runId: run.runId,
    imageDigest: candidate.imageDigest,
    startedAt: new Date().toISOString(),
    cases: out,
    existing: (existingDoc?.gates ?? []).map(({ name, status, imageDigest }) => ({ name, status, imageDigest })),
    requiredExisting: REQUIRED_EXISTING_GATES,
    ...(contextMigration ? { contextMigrationPending: contextMigration.pending } : {}),
    ...(projection ? { projectionBacklog: projection.backlog } : {})
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "gates.json"), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { run: "value", candidate: "value" });
    if (!args.run || !args.candidate) fail("collect-gate-results: --run and --candidate are required", 1);
    const body = await collectGateResults({ run: loadRun(args.run), candidate: JSON.parse(readFileSync(args.candidate, "utf8")) });
    const count = (status) => body.cases.filter((c) => c.status === status).length;
    process.stdout.write(`${JSON.stringify({ passed: count("passed"), failed: count("failed"), blocked: count("blocked") })}\n`);
    process.exit(count("failed") > 0 ? 1 : count("blocked") > 0 ? 2 : 0);
  } catch (error) {
    fail(`collect-gate-results: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
