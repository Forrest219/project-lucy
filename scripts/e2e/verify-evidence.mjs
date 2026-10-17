#!/usr/bin/env node
// The ONE verifier (Spec §8.4, Plan T13). It consumes only schema-valid artifacts and decides:
//   passed  (exit 0)  every release condition holds
//   failed  (exit 1)  schema/contract error, or a behavior / assertion / identity mismatch
//   blocked (exit 2)  a dependency is absent (environment, client, credential, gate result, npm audit …)
//   skipped (exit 3)  skipped / dry-run / collect / local evidence: never publishable
// Child stdout is never parsed. `releaseReady` is true only when status is `passed`.
//
//   node scripts/e2e/verify-evidence.mjs --evidence <release-evidence.json> --candidate <identity.json> \
//        [--findings docs/qa/security-findings.yaml] [--audit-json <npm-audit.json>]
//   node scripts/e2e/verify-evidence.mjs --run <run.json> --candidate <identity.json> --assemble

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { assembleEvidence, loadResults } from "./lib/assemble.mjs";
import { CATALOG_PATH, catalogDigest, executionKey, expectedExecutions, loadCatalog } from "./lib/catalog.mjs";
import { EXIT_CODES, REPO_ROOT, fail, fileDigest, loadRun, parseArgv } from "./lib/common.mjs";
import { validateAgainstSchema } from "./lib/schema.mjs";

const SCHEMA_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/release-evidence.schema.json");
export const PROFILE_PATH = path.join(REPO_ROOT, "scripts/e2e/profiles/customer-release.yaml");
export const CLIENTS_PATH = path.join(REPO_ROOT, "docs/qa/real-e2e-clients.yaml");
export const FINDINGS_PATH = path.join(REPO_ROOT, "docs/qa/security-findings.yaml");

/** Spec §8.3a: the findings file must carry all of these; a missing entry is a verification failure. */
export const EXPECTED_FINDING_IDS = ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06", "V-07", "V-08", "D-01", "D-02", "G-01", "G-02", "G-03", "G-04", "G-05"];

/** Existing customer runtime/ELF/K8s gates that must have passed on the SAME candidate digest. */
// `k8s-acceptance` is the fresh install of the candidate digest on the isolated cluster (read-from-cluster digest);
// `k8s-upgrade` is the N-1 PVC in-place upgrade to the same digest. The static Helm gate is a separate repo-level
// workflow dependency (it cannot be bound to an image digest), so it is not listed here.
export const REQUIRED_EXISTING_GATES = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version", "g4b-python-runtime", "g8-k8s-contract", "k8s-acceptance", "k8s-upgrade"];

const SECOND_RANK = { failed: 4, blocked: 3, skipped: 2, dry_run: 2 };

class Problems {
  constructor() {
    this.list = [];
  }

  add(severity, code, message) {
    this.list.push({ severity, code, message });
  }

  get status() {
    if (this.list.some((p) => p.severity === "failed")) return "failed";
    if (this.list.some((p) => p.severity === "blocked")) return "blocked";
    if (this.list.some((p) => p.severity === "skipped")) return "skipped";
    return "passed";
  }
}

/**
 * Deny verdict for one probe. A server error or a timeout is never an enforced deny (GATE-01-V01/V02).
 */
export function verifyDenyCase({ httpStatus, reason, timedOut = false, approvedReasons = null }) {
  if (timedOut) return { status: "failed", detail: "timed out: not an explicit deny" };
  if (!Number.isInteger(httpStatus) || httpStatus >= 500) return { status: "failed", detail: `HTTP ${httpStatus} is a server error, not an enforced deny` };
  if (httpStatus < 400) return { status: "failed", detail: `HTTP ${httpStatus} was allowed` };
  if (approvedReasons && !approvedReasons.includes(reason)) return { status: "failed", detail: `deny reason "${reason}" is not an approved reason` };
  return { status: "passed", detail: `HTTP ${httpStatus}` };
}

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function highCriticalPackages(audit) {
  const vulns = audit?.vulnerabilities ?? {};
  return Object.entries(vulns)
    .filter(([, v]) => v.severity === "high" || v.severity === "critical")
    .map(([name, v]) => ({ name, severity: v.severity }));
}

function checkFindings({ findings, evidence, problems, passedIds, scenarioPassed, audit }) {
  const byId = new Map((findings?.findings ?? []).map((f) => [f.id, f]));
  for (const id of EXPECTED_FINDING_IDS) {
    if (!byId.has(id)) problems.add("failed", "finding_missing", `security-findings.yaml has no entry for ${id}`);
  }
  for (const f of findings?.findings ?? []) {
    const unresolvedRule = f.severity === "P0" || f.severity === "P1";
    if (unresolvedRule && f.status === "accepted_risk") problems.add("failed", "p0_p1_accepted_risk", `${f.id} is ${f.severity}; accepted_risk is not allowed`);
    else if (unresolvedRule && f.status !== "fixed") problems.add("failed", "p0_p1_unresolved", `${f.id} (${f.severity}) is ${f.status}`);
    if (f.status === "fixed") {
      if (!f.fixedIn) problems.add("failed", "finding_fixedIn_missing", `${f.id} is fixed but has no fixedIn`);
      if (!Array.isArray(f.verifiedBy) || f.verifiedBy.length === 0) problems.add("failed", "finding_verifiedBy_missing", `${f.id} is fixed but has no verifiedBy`);
      for (const id of f.verifiedBy ?? []) {
        if (!passedIds.has(id) && !scenarioPassed.has(id)) problems.add("failed", "finding_not_verified", `${f.id} cites ${id}, which is not passed in this release evidence`);
      }
    }
    if (f.severity === "P2" && f.status === "accepted_risk" && !f.acceptedBy) problems.add("failed", "p2_accepted_without_owner", `${f.id} accepted_risk needs acceptedBy`);
  }
  checkDependencies({ findings, audit, problems });
}

/** npm audit (high/critical) vs the dependency register in security-findings.yaml (Spec §8.3a). */
export function checkDependencies({ findings, audit, problems }) {
  if (!audit) {
    problems.add("blocked", "npm_audit_missing", "no `npm audit --omit=dev --json` result was provided to cross-check the dependency register");
    return;
  }
  const dependencies = new Map((findings?.dependencies ?? []).map((d) => [d.package, d]));
  for (const { name, severity } of highCriticalPackages(audit)) {
    const entry = dependencies.get(name);
    if (!entry) problems.add("failed", "dependency_unregistered", `${name} (${severity}) is reported by npm audit but absent from security-findings.yaml`);
    else if (entry.status === "fixed") problems.add("failed", "dependency_fixed_but_audit_reports", `${name} is registered as fixed but npm audit still reports ${severity}`);
    else if (entry.status === "not_reachable" && !String(entry.rationale ?? "").trim()) problems.add("failed", "dependency_not_reachable_without_rationale", `${name} not_reachable needs a reviewable rationale`);
    else if (entry.status === "open") problems.add("failed", "dependency_open", `${name} (${severity}) is still open`);
  }
  for (const d of findings?.dependencies ?? []) {
    if ((d.severity === "high" || d.severity === "critical") && d.status === "open") problems.add("failed", "dependency_open", `${d.package} (${d.severity}) is open`);
  }
}

/** Standalone cross-check used by the gate collector for SEC-23-V02. */
export function crossCheckDependencies({ findings, audit }) {
  const problems = new Problems();
  checkDependencies({ findings, audit, problems });
  return { status: problems.status, problems: problems.list };
}

/**
 * Pure release decision. Everything external (files, clock) is injected so every rule is unit-tested.
 * @param {object} p
 * @param {object} p.evidence parsed lucy-real-user-e2e-v1 document
 * @param {object} p.candidate deployed candidate identity (what the pipeline built and tested)
 * @param {Array}  p.cases frozen catalog (expanded)
 * @param {string} p.catalogDigest digest of the frozen catalog
 * @param {string} p.profileDigest digest of the frozen profile
 * @param {object} p.clientsDoc docs/qa/real-e2e-clients.yaml
 * @param {object} p.findings parsed security-findings.yaml
 * @param {object|null} p.audit parsed `npm audit --json` output
 * @param {(rel: string) => Buffer|null} p.readFile resolves an artifact path relative to the evidence directory
 * @param {number} [p.now]
 * @param {number} [p.maxAgeHours]
 */
export function verifyRelease({ evidence, candidate, cases, catalogDigest: frozenCatalog, profileDigest, clientsDoc, findings, audit, readFile, now = Date.now(), maxAgeHours = 72, schema }) {
  const problems = new Problems();
  const schemaProblems = schema ? validateAgainstSchema(schema, evidence) : [];
  if (schemaProblems.length > 0) {
    schemaProblems.slice(0, 20).forEach((p) => problems.add("failed", "schema", p));
    return finish(problems, evidence);
  }

  if (evidence.executionMode !== "release") {
    problems.add("skipped", "not_release_execution", `executionMode "${evidence.executionMode}" can never be published`);
  }
  if (evidence.stub !== false) problems.add("failed", "stub", "stub must be false");

  // identity: candidate == deployed == every piece of evidence
  for (const key of ["gitSha", "treeDigest", "imageDigest", "platform", "ktxVersion", "chartVersion"]) {
    if (evidence.candidate[key] !== candidate[key]) problems.add("failed", "candidate_mismatch", `evidence candidate.${key} differs from the candidate under verification`);
  }
  if (evidence.environment.deployedImageDigest !== candidate.imageDigest) problems.add("failed", "deployed_digest_mismatch", "the deployed image digest is not the candidate digest");
  if (evidence.candidate.platform !== "linux/amd64") problems.add("failed", "platform", `customer platform must be linux/amd64 (got ${evidence.candidate.platform})`);
  if (evidence.environment.topology !== "single-replica-k8s") problems.add("failed", "topology", `topology must be single-replica-k8s (got ${evidence.environment.topology})`);

  // frozen inputs
  if (evidence.environment.caseCatalogDigest !== frozenCatalog) problems.add("failed", "catalog_digest", "caseCatalogDigest does not match the frozen catalog");
  if (evidence.environment.profileDigest !== profileDigest) problems.add("failed", "profile_digest", "profileDigest does not match the frozen profile");

  // freshness
  const finished = Date.parse(evidence.environment.finishedAt);
  if (!Number.isFinite(finished) || now - finished > maxAgeHours * 3_600_000 || finished > now + 300_000) {
    problems.add("failed", "stale_evidence", `evidence finished at ${evidence.environment.finishedAt} is outside the ${maxAgeHours} h freshness window`);
  }

  // provenance
  if (evidence.provenance.trusted !== true) problems.add("failed", "untrusted_provenance", "evidence was not produced by a trusted CI runner");
  if (evidence.provenance.ciSha && evidence.provenance.ciSha !== candidate.gitSha) problems.add("failed", "provenance_sha", "CI sha differs from the candidate git sha");

  // denominator
  const requiredClients = clientsDoc.clients.filter((c) => c.required).map((c) => c.product);
  const expected = expectedExecutions(cases, requiredClients);
  if (expected.length === 0) problems.add("failed", "empty_denominator", "the required denominator is empty");
  const keys = evidence.cases.map(executionKey);
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) problems.add("failed", "duplicate_case", `duplicate execution ${key}`);
    seen.add(key);
  }
  const expectedSet = new Set(expected);
  for (const key of expected) if (!seen.has(key)) problems.add("failed", "omitted_case", `required execution ${key} is absent from the evidence`);
  for (const key of seen) if (!expectedSet.has(key)) problems.add("failed", "unexpected_case", `execution ${key} is not in the frozen catalog`);
  for (const product of requiredClients) {
    const client = evidence.clients.find((c) => c.product === product);
    if (!client) problems.add("failed", "missing_client", `required client ${product} is absent from the evidence`);
    else if (client.required !== true) problems.add("failed", "client_not_required", `${product} is registered as required but evidence marks it optional`);
  }
  const summary = evidence.summary;
  const actual = { passed: 0, failed: 0, blocked: 0, skipped: 0, dryRun: 0 };
  for (const c of evidence.cases) actual[c.status === "dry_run" ? "dryRun" : c.status] += 1;
  for (const key of ["passed", "failed", "blocked", "skipped", "dryRun"]) {
    if (summary[key] !== actual[key]) problems.add("failed", "summary_tampered", `summary.${key}=${summary[key]} but the cases contain ${actual[key]}`);
  }
  if (summary.required !== expected.length) problems.add("failed", "summary_tampered", `summary.required=${summary.required} but the frozen denominator is ${expected.length}`);

  // statuses of required executions
  const byKey = new Map(evidence.cases.map((c) => [executionKey(c), c]));
  const catalogById = new Map(cases.map((c) => [c.id, c]));
  for (const key of expected) {
    const entry = byKey.get(key);
    if (!entry) continue;
    if (entry.status === "failed") problems.add("failed", "case_failed", `${key} failed`);
    else if (entry.status === "blocked") problems.add("blocked", "case_blocked", `${key} is blocked`);
    else if (entry.status === "skipped" || entry.status === "dry_run") problems.add("skipped", "case_not_executed", `${key} is ${entry.status}`);
  }

  // per-case content checks
  let serverEvidence = null;
  if (evidence.serverEvidence.source !== "instance-ledger") {
    problems.add("failed", "trace_source_untrusted", `server evidence source "${evidence.serverEvidence.source}" is not the instance ledger`);
  } else {
    const buffer = readFile(evidence.serverEvidence.path);
    if (!buffer) problems.add("failed", "server_evidence_missing", `${evidence.serverEvidence.path} cannot be read`);
    else if (sha256Buffer(buffer) !== evidence.serverEvidence.sha256) problems.add("failed", "server_evidence_hash", "server evidence file hash mismatch");
    else {
      try {
        serverEvidence = JSON.parse(buffer.toString("utf8"));
      } catch {
        problems.add("failed", "server_evidence_unreadable", "server evidence is not valid JSON");
      }
      if (serverEvidence && serverEvidence.source !== "instance-ledger") problems.add("failed", "trace_source_untrusted", "server evidence file does not declare the instance ledger as its source");
    }
  }
  const ledgerTraces = new Map();
  for (const sc of serverEvidence?.cases ?? []) {
    // Agent executions are keyed id@client#run (same as executionKey); other data cases by their id.
    ledgerTraces.set(sc.client ? `${sc.caseId}@${sc.client}#${sc.run}` : sc.caseId, { traces: new Set(sc.traceIds ?? []), fingerprint: sc.tokenFingerprint });
  }
  for (const key of expected) {
    const entry = byKey.get(key);
    if (!entry || entry.status !== "passed") continue;
    const spec = catalogById.get(entry.id);
    for (const artifact of entry.artifacts) {
      const buffer = readFile(artifact.path);
      if (!buffer) problems.add("failed", "artifact_missing", `${key}: artifact ${artifact.path} cannot be read`);
      else if (sha256Buffer(buffer) !== artifact.sha256) problems.add("failed", "artifact_hash_mismatch", `${key}: artifact ${artifact.path} was modified after collection`);
    }
    if (entry.artifacts.length === 0) problems.add("failed", "artifact_missing", `${key}: a passed case must carry artifacts`);
    const evaluated = new Map(entry.assertions.map((a) => [a.token, a.passed]));
    for (const token of spec.assert) {
      if (!evaluated.has(token)) problems.add("failed", "assertion_missing", `${key}: assertion "${token}" was never evaluated`);
      else if (evaluated.get(token) !== true) problems.add("failed", "assertion_failed", `${key}: assertion "${token}" did not hold`);
    }
    if (entry.leakage && entry.leakage.hits > 0) problems.add("failed", "leakage", `${key}: ${entry.leakage.hits} leakage hit(s)`);
    if (entry.upstreamExecutions !== undefined && entry.upstreamExecutions !== 0 && spec.assert.includes("upstream_exec_zero")) problems.add("failed", "unauthorized_upstream", `${key}: ${entry.upstreamExecutions} unauthorized upstream execution(s)`);
    const dataCase = spec.assert.includes("real_query") || spec.assert.includes("server_trace");
    if (dataCase) {
      if (entry.queryEventIds.length === 0 && spec.assert.includes("real_query")) problems.add("failed", "missing_query", `${key}: no real query event: a correct-looking answer without a query does not count`);
      if (entry.serverTraceIds.length === 0) problems.add("failed", "missing_server_trace", `${key}: no server trace id`);
      const ledger = ledgerTraces.get(key);
      if (entry.serverTraceIds.length > 0) {
        if (!ledger) problems.add("failed", "trace_not_in_server_evidence", `${key}: the server evidence has no record for this execution`);
        else {
          for (const trace of entry.serverTraceIds) if (!ledger.traces.has(trace)) problems.add("failed", "trace_not_in_server_evidence", `${key}: trace ${trace} is not in the instance ledger`);
          if (entry.tokenFingerprint && ledger.fingerprint !== entry.tokenFingerprint) problems.add("failed", "token_fingerprint_mismatch", `${key}: Token fingerprint differs from the ledger`);
        }
      }
      if (entry.policyVersion === "unavailable" || entry.contextPolicyVersion === "unavailable") problems.add("failed", "version_missing", `${key}: policy/context version not recorded`);
    }
  }

  // release-wide gates
  const counter = (value, code, label) => {
    if (value < 0) problems.add("blocked", `${code}_unknown`, `${label} was not measured`);
    else if (value > 0) problems.add("failed", code, `${value} ${label}`);
  };
  counter(evidence.gates.contextMigrationPending, "context_migration_pending", "context ACL migration item(s) pending");
  counter(evidence.gates.projectionBacklog, "projection_backlog", "projection backlog item(s)");
  for (const name of REQUIRED_EXISTING_GATES) {
    const gate = evidence.gates.existing.find((g) => g.name === name);
    if (!gate) problems.add("blocked", "gate_missing", `existing gate ${name} has no result`);
    else {
      if (gate.imageDigest !== candidate.imageDigest) problems.add("failed", "gate_digest_mismatch", `gate ${name} ran on another image digest`);
      if (gate.status === "failed") problems.add("failed", "gate_failed", `gate ${name} failed`);
      else if (gate.status === "blocked") problems.add("blocked", "gate_blocked", `gate ${name} is blocked`);
      else if (gate.status !== "passed") problems.add("skipped", "gate_not_passed", `gate ${name} is ${gate.status}`);
    }
  }

  // findings register vs verified evidence and npm audit
  const passedIds = new Set(evidence.cases.filter((c) => c.status === "passed").map((c) => c.id));
  const scenarioPassed = new Set();
  const scenarioIds = new Set(cases.map((c) => c.scenario));
  for (const scenario of scenarioIds) {
    const variants = cases.filter((c) => c.scenario === scenario && c.required);
    if (variants.every((v) => expected.filter((k) => k === v.id || k.startsWith(`${v.id}@`)).every((k) => byKey.get(k)?.status === "passed"))) scenarioPassed.add(scenario);
  }
  checkFindings({ findings, evidence, problems, passedIds, scenarioPassed, audit });

  return finish(problems, evidence);
}

function finish(problems, evidence) {
  const status = problems.status;
  return {
    contract: "lucy-release-verdict-v1",
    status,
    exitCode: EXIT_CODES[status],
    releaseReady: status === "passed" && evidence?.executionMode === "release",
    problems: problems.list.sort((a, b) => (SECOND_RANK[b.severity] ?? 0) - (SECOND_RANK[a.severity] ?? 0)),
    runId: evidence?.runId ?? null
  };
}

export function loadVerifyInputs({ catalogPath = CATALOG_PATH, profilePath = PROFILE_PATH, clientsPath = CLIENTS_PATH, findingsPath = FINDINGS_PATH } = {}) {
  const { cases } = loadCatalog(catalogPath);
  return {
    cases,
    catalogDigest: catalogDigest(cases),
    profileDigest: fileDigest(profilePath),
    clientsDoc: parse(readFileSync(clientsPath, "utf8")),
    findings: parse(readFileSync(findingsPath, "utf8")),
    schema: JSON.parse(readFileSync(SCHEMA_PATH, "utf8")),
    maxAgeHours: parse(readFileSync(profilePath, "utf8")).evidence?.maxAgeHours ?? 72
  };
}

export function fileReaderFor(baseDir) {
  return (rel) => {
    const resolved = path.resolve(baseDir, rel);
    if (path.relative(baseDir, resolved).startsWith("..") || !existsSync(resolved)) return null;
    return readFileSync(resolved);
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { evidence: "value", run: "value", candidate: "value", findings: "value", "audit-json": "value", assemble: "boolean", out: "value" });
    if (!args.candidate) fail("verify-evidence: --candidate <identity.json> is required", 1);
    const candidate = JSON.parse(readFileSync(args.candidate, "utf8"));
    const inputs = loadVerifyInputs(args.findings ? { findingsPath: path.resolve(args.findings) } : {});
    let evidence;
    let baseDir;
    if (args.assemble) {
      if (!args.run) fail("verify-evidence: --assemble needs --run <run.json>", 1);
      const run = loadRun(args.run);
      const { evidence: assembled, missing } = assembleEvidence({ run, results: loadResults(run), candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount: expectedExecutions(inputs.cases, inputs.clientsDoc.clients.filter((c) => c.required).map((c) => c.product)).length });
      evidence = assembled;
      baseDir = run.paths.runDir;
      if (missing.length > 0) process.stderr.write(`verify-evidence: absent dependencies: ${missing.join(", ")}\n`);
      writeFileSync(path.join(baseDir, "release-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    } else {
      if (!args.evidence) fail("verify-evidence: --evidence <file> or --run <run.json> --assemble is required", 1);
      evidence = JSON.parse(readFileSync(args.evidence, "utf8"));
      baseDir = path.dirname(path.resolve(args.evidence));
    }
    const audit = args["audit-json"] ? JSON.parse(readFileSync(args["audit-json"], "utf8")) : null;
    const verdict = verifyRelease({ evidence, candidate, ...inputs, audit, readFile: fileReaderFor(baseDir) });
    if (args.out) writeFileSync(args.out, `${JSON.stringify(verdict, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exit(verdict.exitCode);
  } catch (error) {
    fail(`verify-evidence: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
