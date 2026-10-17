// GATE-01 reverse tests (Spec §7, §8.4): everything that must NOT produce READY. Test titles carrying
// "[GATE-01-Vnn]" are executed by scripts/gates/collect-gate-results.mjs through the node:test event API and
// recorded as the GATE-01 case results; the catalog variant ids and the titles must stay in step.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateKeyPairSync } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { expectedExecutions } from "../lib/catalog.mjs";
import { REPO_ROOT, fileDigest } from "../lib/common.mjs";
import { assembleEvidence } from "../lib/assemble.mjs";
import { archiveEvidence, canonicalManifest, verifyArchive } from "../archive-evidence.mjs";
import { fileReaderFor, loadVerifyInputs, verifyDenyCase, verifyRelease } from "../verify-evidence.mjs";
import { reconcileChild } from "../../gates/customer-release-readiness.mjs";
import { statusFromExitCode } from "../../gates/record-gate-result.mjs";

const roots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-verifier-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const inputs = loadVerifyInputs();
const requiredClients = inputs.clientsDoc.clients.filter((c) => c.required).map((c) => c.product);
const IMAGE = `sha256:${"c".repeat(64)}`;
const candidate = { gitSha: "a".repeat(40), treeDigest: `sha256:${"b".repeat(64)}`, imageDigest: IMAGE, platform: "linux/amd64", ktxVersion: "0.16.0", chartVersion: "0.17.0" };
const NOW = Date.parse("2026-10-18T12:00:00.000Z");
const clone = (value) => JSON.parse(JSON.stringify(value));

const GATES = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version", "g4b-python-runtime", "g8-k8s-contract", "k8s-acceptance", "k8s-upgrade"];
const HEALTHY_AUDIT = { vulnerabilities: {}, metadata: { vulnerabilities: { high: 0, critical: 0 } } };

/** Synthetic findings: every expected id is fixed and verified by a scenario that the valid evidence passes. */
function healthyFindings() {
  const item = (id, severity, verifiedBy) => ({ id, severity, status: "fixed", spec: "§x", fixedIn: "abc1234", verifiedBy, acceptedBy: null });
  return {
    version: 1,
    findings: [
      item("V-01", "P0", ["SEC-01", "SEC-02"]), item("V-02", "P1", ["SEC-07"]), item("V-03", "P1", ["SEC-04"]), item("V-04", "P1", ["SEC-18"]),
      item("V-05", "P2", ["SEC-17"]), item("V-06", "P2", ["SEC-02"]), item("V-07", "P2", ["SEC-15"]), item("V-08", "P0", ["SEC-15-FM-01"]),
      item("D-01", "P1", ["SEC-14"]), item("D-02", "P1", ["SEC-19"]), item("G-01", "P1", ["OPS-01"]), item("G-02", "P1", ["GATE-01"]),
      item("G-03", "P1", ["UX-02"]), item("G-04", "P1", ["UX-01"]), item("G-05", "P1", ["SEC-23"])
    ],
    dependencies: [{ package: "fast-uri", severity: "high", status: "fixed", rationale: null }]
  };
}

/** A complete, internally consistent release evidence document + artifacts on disk. */
function buildValid() {
  const dir = tmp();
  mkdirSync(path.join(dir, "results", "art"), { recursive: true });
  const expected = expectedExecutions(inputs.cases, requiredClients);
  const byId = new Map(inputs.cases.map((c) => [c.id, c]));
  const ledger = [];
  const entries = expected.map((key) => {
    const [idPart, rest] = key.split("@");
    const spec = byId.get(idPart);
    const [client, run] = rest ? rest.split("#") : [undefined, undefined];
    const dataCase = spec.assert.includes("real_query") || spec.assert.includes("server_trace");
    const art = path.join("results", "art", `${key.replace(/[@#]/g, "_")}.json`);
    const body = `${JSON.stringify({ key, ok: true })}\n`;
    writeFileSync(path.join(dir, art), body);
    const entry = {
      id: idPart, runner: spec.runner, ...(client ? { client, run: Number(run) } : {}), status: "passed",
      startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z",
      ...(dataCase ? { tokenFingerprint: "abcdef123456" } : {}),
      serverTraceIds: dataCase ? [`trace_${key.replace(/[@#]/g, "_")}`] : [], queryEventIds: dataCase && spec.assert.includes("real_query") ? ["1"] : [],
      policyVersion: "pv1", contextPolicyVersion: "cv1",
      assertions: spec.assert.map((token) => ({ token, passed: true })),
      artifacts: [{ path: art, sha256: createHash("sha256").update(body).digest("hex") }]
    };
    if (dataCase) ledger.push({ caseId: idPart, ...(client ? { client, run: Number(run) } : {}), tokenFingerprint: "abcdef123456", traceIds: entry.serverTraceIds });
    return entry;
  });
  const serverBody = `${JSON.stringify({ contract: "lucy-server-evidence-v1", source: "instance-ledger", cases: ledger })}\n`;
  writeFileSync(path.join(dir, "results", "server-evidence.json"), serverBody);
  const count = (s) => entries.filter((e) => e.status === s).length;
  const evidence = {
    contract: "lucy-real-user-e2e-v1", executionMode: "release", stub: false, runId: "run-test-0001", candidate: clone(candidate),
    environment: {
      instanceId: "inst-1", topology: "single-replica-k8s", fixtureDigest: `sha256:${"f".repeat(64)}`, profileDigest: inputs.profileDigest,
      caseCatalogDigest: inputs.catalogDigest, deployedImageDigest: IMAGE, startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:30:00.000Z"
    },
    clients: requiredClients.map((product) => ({ product, version: "1.0.0", adapterDigest: `sha256:${"d".repeat(64)}`, model: "m", transport: "cli", required: true })),
    summary: { required: expected.length, executed: entries.length, passed: count("passed"), failed: 0, blocked: 0, skipped: 0, dryRun: 0 },
    cases: entries,
    gates: { contextMigrationPending: 0, projectionBacklog: 0, existing: GATES.map((name) => ({ name, status: "passed", imageDigest: IMAGE })) },
    serverEvidence: { source: "instance-ledger", path: "results/server-evidence.json", sha256: createHash("sha256").update(serverBody).digest("hex") },
    provenance: { trusted: true, runner: "protected-1", ciRunId: "123", ciSha: candidate.gitSha, workflow: "Lucy release gates" },
    status: "passed", releaseReady: false
  };
  return { dir, evidence };
}

const decide = (evidence, dir, overrides = {}) =>
  verifyRelease({ evidence, candidate, ...inputs, findings: healthyFindings(), audit: HEALTHY_AUDIT, readFile: fileReaderFor(dir), now: NOW, ...overrides });
const codes = (verdict) => verdict.problems.map((p) => p.code);

describe("the verifier accepts a complete, consistent release evidence set", () => {
  it("passes only when every condition holds, and then releaseReady is true", () => {
    const { dir, evidence } = buildValid();
    const verdict = decide(evidence, dir);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.status, "passed");
    assert.equal(verdict.exitCode, 0);
    assert.equal(verdict.releaseReady, true);
  });

  it("the denominator has no omission and covers 3 runs for each of the 2 required products", () => {
    const expected = expectedExecutions(inputs.cases, requiredClients);
    assert.ok(expected.includes("UX-02-V01@codex#1") && expected.includes("UX-02-V01@cursor#3"));
    const { evidence } = buildValid();
    assert.equal(evidence.cases.length, expected.length);
  });

  it("the repository's own findings register keeps releaseReady false until G-01 and G-03 are really proven", () => {
    const { dir, evidence } = buildValid();
    const repoFindings = inputs.findings;
    const verdict = decide(evidence, dir, { findings: repoFindings });
    const open = repoFindings.findings.filter((f) => (f.severity === "P0" || f.severity === "P1") && f.status !== "fixed").map((f) => f.id);
    assert.ok(open.length > 0, "the register must not claim fixed for what was never proven in a release run");
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("p0_p1_unresolved"));
  });
});

describe("GATE-01: nothing below may be READY", () => {
  it("[GATE-01-V01] a 500 is not a correct deny", () => {
    assert.equal(verifyDenyCase({ httpStatus: 500, reason: "upstream_error" }).status, "failed");
    assert.equal(verifyDenyCase({ httpStatus: 503, reason: "AUDIT_UNAVAILABLE" }).status, "failed");
    assert.equal(verifyDenyCase({ httpStatus: 403, reason: "agent_disabled", approvedReasons: ["agent_disabled"] }).status, "passed");
    assert.equal(verifyDenyCase({ httpStatus: 403, reason: "something_else", approvedReasons: ["agent_disabled"] }).status, "failed");
    assert.equal(verifyDenyCase({ httpStatus: 200, reason: "" }).status, "failed");
  });

  it("[GATE-01-V02] a timeout is not a pass", () => {
    assert.equal(verifyDenyCase({ timedOut: true }).status, "failed");
    const { dir, evidence } = buildValid();
    evidence.cases[0].status = "failed";
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed - 1, failed: 1 };
    assert.equal(decide(evidence, dir).releaseReady, false);
  });

  it("[GATE-01-V03] a blocked required case blocks the release (exit 2)", () => {
    const { dir, evidence } = buildValid();
    // SEC-08-V01 is not cited by any finding, so the verdict isolates the blocked case itself.
    evidence.cases.find((c) => c.id === "SEC-08-V01").status = "blocked";
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed - 1, blocked: 1 };
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.equal(verdict.status, "blocked");
    assert.equal(verdict.exitCode, 2);
  });

  it("[GATE-01-V04] a skipped required case is never READY (exit 3)", () => {
    const { dir, evidence } = buildValid();
    evidence.cases.find((c) => c.id === "SEC-08-V02").status = "skipped";
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed - 1, skipped: 1 };
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.equal(verdict.exitCode, 3);
  });

  it("[GATE-01-V05] dry-run / collect / local evidence is never READY (exit 3)", () => {
    for (const mode of ["dry_run", "collect", "local"]) {
      const { dir, evidence } = buildValid();
      evidence.executionMode = mode;
      const verdict = decide(evidence, dir);
      assert.equal(verdict.releaseReady, false, mode);
      assert.equal(verdict.exitCode, 3, mode);
    }
  });

  it("[GATE-01-V06] a data case without a real query event is not READY, even if the answer was right", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "codex" && c.run === 1);
    target.queryEventIds = [];
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_query"));
  });

  it("[GATE-01-V07] a fabricated trace id (not in the instance ledger) is not READY", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "cursor" && c.run === 2);
    target.serverTraceIds = ["trace_made_up_by_the_runner"];
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("trace_not_in_server_evidence"));
    const untrusted = buildValid();
    untrusted.evidence.serverEvidence.source = "runner";
    assert.ok(codes(decide(untrusted.evidence, untrusted.dir)).includes("trace_source_untrusted"));
    const noTrace = buildValid();
    noTrace.evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "codex" && c.run === 1).serverTraceIds = [];
    assert.ok(codes(decide(noTrace.evidence, noTrace.dir)).includes("missing_server_trace"));
  });

  it("[GATE-01-V08] stale evidence cannot certify a candidate", () => {
    const { dir, evidence } = buildValid();
    const verdict = decide(evidence, dir, { now: NOW + 200 * 3_600_000 });
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("stale_evidence"));
    const future = decide(buildValid().evidence, dir, { now: NOW - 3 * 3_600_000 });
    assert.ok(codes(future).includes("stale_evidence"), "evidence from the future is just as invalid");
  });

  it("[GATE-01-V09] evidence for another image digest is not READY", () => {
    const { dir, evidence } = buildValid();
    evidence.candidate.imageDigest = `sha256:${"9".repeat(64)}`;
    assert.ok(codes(decide(evidence, dir)).includes("candidate_mismatch"));
    const deployed = buildValid();
    deployed.evidence.environment.deployedImageDigest = `sha256:${"8".repeat(64)}`;
    assert.ok(codes(decide(deployed.evidence, deployed.dir)).includes("deployed_digest_mismatch"));
    const gate = buildValid();
    gate.evidence.gates.existing[0].imageDigest = `sha256:${"7".repeat(64)}`;
    assert.ok(codes(decide(gate.evidence, gate.dir)).includes("gate_digest_mismatch"));
    const arm = buildValid();
    arm.evidence.candidate.platform = "linux/arm64";
    assert.ok(codes(decide(arm.evidence, arm.dir)).includes("platform"));
  });

  it("[GATE-01-V10] a missing required client is not READY", () => {
    const { dir, evidence } = buildValid();
    evidence.clients = evidence.clients.filter((c) => c.product !== "cursor");
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_client"));
    const optional = buildValid();
    optional.evidence.clients[0].required = false;
    assert.ok(codes(decide(optional.evidence, optional.dir)).includes("client_not_required"));
  });

  it("[GATE-01-V11] a tampered denominator (catalog digest, removed case, edited summary) is not READY", () => {
    const digest = buildValid();
    digest.evidence.environment.caseCatalogDigest = `sha256:${"1".repeat(64)}`;
    assert.ok(codes(decide(digest.evidence, digest.dir)).includes("catalog_digest"));
    const removed = buildValid();
    removed.evidence.cases = removed.evidence.cases.filter((c) => c.id !== "SEC-15-FM-03");
    removed.evidence.summary = { ...removed.evidence.summary, passed: removed.evidence.summary.passed - 1, required: removed.evidence.summary.required - 1 };
    const verdict = decide(removed.evidence, removed.dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("omitted_case"));
    const summary = buildValid();
    summary.evidence.summary.required = 5;
    assert.ok(codes(decide(summary.evidence, summary.dir)).includes("summary_tampered"));
    const profile = buildValid();
    profile.evidence.environment.profileDigest = `sha256:${"2".repeat(64)}`;
    assert.ok(codes(decide(profile.evidence, profile.dir)).includes("profile_digest"));
  });

  it("[GATE-01-V12] an exit code that contradicts the JSON status is a contract failure", () => {
    assert.equal(reconcileChild({ jsonStatus: "passed", exitCode: 1 }).status, "failed");
    assert.equal(reconcileChild({ jsonStatus: "blocked", exitCode: 0 }).status, "failed");
    assert.equal(reconcileChild({ jsonStatus: "failed", exitCode: 0 }).status, "failed");
    assert.equal(reconcileChild({ jsonStatus: "passed", exitCode: 0 }).status, "passed");
    assert.equal(reconcileChild({ jsonStatus: "blocked", exitCode: 2 }).status, "blocked");
    assert.equal(reconcileChild({ jsonStatus: "maybe", exitCode: 0 }).status, "failed");
    assert.equal(statusFromExitCode(0), "passed");
    assert.equal(statusFromExitCode(2), "blocked");
    assert.equal(statusFromExitCode(42), "blocked");
    assert.equal(statusFromExitCode(3), "skipped");
    assert.equal(statusFromExitCode(1), "failed");
    assert.equal(statusFromExitCode(137), "failed");
  });

  it("[GATE-01-V13] an artifact modified after collection is not READY", () => {
    const { dir, evidence } = buildValid();
    const artifact = evidence.cases[10].artifacts[0];
    writeFileSync(path.join(dir, artifact.path), "tampered\n");
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("artifact_hash_mismatch"));
    const missing = buildValid();
    rmSync(path.join(missing.dir, missing.evidence.cases[11].artifacts[0].path));
    assert.ok(codes(decide(missing.evidence, missing.dir)).includes("artifact_missing"));
    const ledger = buildValid();
    writeFileSync(path.join(ledger.dir, ledger.evidence.serverEvidence.path), "{}");
    assert.ok(codes(decide(ledger.evidence, ledger.dir)).includes("server_evidence_hash"));
  });

  it("[GATE-01-V14] a duplicated case is not READY", () => {
    const { dir, evidence } = buildValid();
    evidence.cases.push(clone(evidence.cases[0]));
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed + 1 };
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("duplicate_case"));
  });

  it("[GATE-01-V15] an unresolved P0/P1 (or accepted_risk, or an uncited fix) is not READY", () => {
    const { dir, evidence } = buildValid();
    const open = healthyFindings();
    open.findings.find((f) => f.id === "V-08").status = "open";
    assert.ok(codes(decide(evidence, dir, { findings: open })).includes("p0_p1_unresolved"));
    const accepted = healthyFindings();
    accepted.findings.find((f) => f.id === "D-01").status = "accepted_risk";
    assert.ok(codes(decide(evidence, dir, { findings: accepted })).includes("p0_p1_accepted_risk"));
    const unverified = healthyFindings();
    unverified.findings.find((f) => f.id === "V-02").verifiedBy = ["SEC-99-NOT-A-CASE"];
    assert.ok(codes(decide(evidence, dir, { findings: unverified })).includes("finding_not_verified"));
    const missingEntry = healthyFindings();
    missingEntry.findings = missingEntry.findings.filter((f) => f.id !== "G-03");
    assert.ok(codes(decide(evidence, dir, { findings: missingEntry })).includes("finding_missing"));
    const noFix = healthyFindings();
    noFix.findings.find((f) => f.id === "V-01").fixedIn = null;
    assert.ok(codes(decide(evidence, dir, { findings: noFix })).includes("finding_fixedIn_missing"));
    const failedScenario = buildValid();
    const victim = failedScenario.evidence.cases.find((c) => c.id === "SEC-07-V03");
    victim.status = "failed";
    failedScenario.evidence.summary = { ...failedScenario.evidence.summary, passed: failedScenario.evidence.summary.passed - 1, failed: 1 };
    assert.ok(codes(decide(failedScenario.evidence, failedScenario.dir)).includes("finding_not_verified"), "a fix whose verifying scenario failed is no longer verified");
  });

  it("[GATE-01-V16] npm audit and the dependency register must agree", () => {
    const { dir, evidence } = buildValid();
    const stillVulnerable = { vulnerabilities: { "fast-uri": { severity: "high" } }, metadata: { vulnerabilities: { high: 1, critical: 0 } } };
    assert.ok(codes(decide(evidence, dir, { audit: stillVulnerable })).includes("dependency_fixed_but_audit_reports"));
    const unregistered = { vulnerabilities: { "some-new-package": { severity: "critical" } }, metadata: { vulnerabilities: { high: 0, critical: 1 } } };
    assert.ok(codes(decide(evidence, dir, { audit: unregistered })).includes("dependency_unregistered"));
    const noRationale = healthyFindings();
    noRationale.dependencies = [{ package: "fast-uri", severity: "high", status: "not_reachable", rationale: "" }];
    assert.ok(codes(decide(evidence, dir, { audit: stillVulnerable, findings: noRationale })).includes("dependency_not_reachable_without_rationale"));
    const reachableWithReason = healthyFindings();
    reachableWithReason.dependencies = [{ package: "fast-uri", severity: "high", status: "not_reachable", rationale: "only reachable through dev tooling; verified in review" }];
    assert.ok(!codes(decide(evidence, dir, { audit: stillVulnerable, findings: reachableWithReason })).includes("dependency_fixed_but_audit_reports"));
    const missingAudit = decide(evidence, dir, { audit: null });
    assert.equal(missingAudit.status, "blocked");
    assert.ok(codes(missingAudit).includes("npm_audit_missing"));
  });
});

describe("additional verifier guarantees", () => {
  it("a failed assertion, a never-evaluated assertion, a leak or an unauthorized upstream execution fails the case", () => {
    for (const mutate of [
      (c) => { c.assertions[0].passed = false; },
      (c) => { c.assertions = c.assertions.slice(1); },
      (c) => { c.leakage = { scanned: true, hits: 2 }; },
      (c) => { c.upstreamExecutions = 3; }
    ]) {
      const { dir, evidence } = buildValid();
      const target = evidence.cases.find((c) => c.id === "SEC-12-V01");
      mutate(target);
      assert.equal(decide(evidence, dir).releaseReady, false);
    }
  });

  it("untrusted provenance, a wrong CI sha, a non-amd64 platform or a non single-replica topology fail", () => {
    for (const mutate of [
      (e) => { e.provenance.trusted = false; },
      (e) => { e.provenance.ciSha = "e".repeat(40); },
      (e) => { e.environment.topology = "local-process"; },
      (e) => { e.stub = true; }
    ]) {
      const { dir, evidence } = buildValid();
      mutate(evidence);
      assert.equal(decide(evidence, dir).releaseReady, false);
    }
  });

  it("pending context migrations or a projection backlog fail; unmeasured counters block; missing gates block", () => {
    const pending = buildValid();
    pending.evidence.gates.contextMigrationPending = 2;
    assert.ok(codes(decide(pending.evidence, pending.dir)).includes("context_migration_pending"));
    const backlog = buildValid();
    backlog.evidence.gates.projectionBacklog = 7;
    assert.ok(codes(decide(backlog.evidence, backlog.dir)).includes("projection_backlog"));
    const unknown = buildValid();
    unknown.evidence.gates.projectionBacklog = -1;
    const verdict = decide(unknown.evidence, unknown.dir);
    assert.equal(verdict.status, "blocked");
    const noGate = buildValid();
    noGate.evidence.gates.existing = noGate.evidence.gates.existing.filter((g) => g.name !== "g2-elf-arch");
    const gateVerdict = decide(noGate.evidence, noGate.dir);
    assert.equal(gateVerdict.status, "blocked");
    assert.ok(codes(gateVerdict).includes("gate_missing"));
  });

  it("schema violations are contract failures (exit 1), not blocked", () => {
    const { dir, evidence } = buildValid();
    delete evidence.provenance;
    const verdict = decide(evidence, dir, { schema: inputs.schema });
    assert.equal(verdict.status, "failed");
    assert.equal(verdict.exitCode, 1);
    assert.ok(codes(verdict).includes("schema"));
  });

  it("the assembler recomputes status and never defaults a missing dependency to pass", () => {
    const run = { runId: "run-test-0002", executionMode: "release", instanceId: "i", fixtureDigest: `sha256:${"f".repeat(64)}`, caseCatalogDigest: inputs.catalogDigest, paths: { runDir: tmp() } };
    const { evidence, missing } = assembleEvidence({ run, results: { security: { cases: [{ id: "SEC-01-V01", runner: "security", status: "passed", assertions: [], artifacts: [] }] } }, candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount: 1 });
    assert.ok(missing.includes("results/deployment.json") && missing.includes("server-evidence"));
    assert.equal(evidence.gates.contextMigrationPending, -1);
    assert.equal(evidence.gates.projectionBacklog, -1);
    assert.equal(evidence.releaseReady, false);
    assert.equal(evidence.status, "passed", "status is recomputed from the cases it actually has; the verifier still rejects the omissions");
  });
});

describe("evidence archive: scan -> hash -> verify -> sign, immutable afterwards", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const trusted = { trusted: true, runner: "protected-1", ciRunId: "1", ciSha: "a".repeat(40) };
  const okVerify = () => ({ status: "passed", exitCode: 0 });

  function source() {
    const dir = tmp();
    mkdirSync(path.join(dir, "sub"), { recursive: true });
    writeFileSync(path.join(dir, "a.json"), '{"ok":true}\n');
    writeFileSync(path.join(dir, "sub", "b.json"), '{"also":"ok"}\n');
    return dir;
  }

  it("signs a clean, verified archive and verifyArchive accepts it", () => {
    const out = path.join(tmp(), "archive");
    const result = archiveEvidence({ sourceDir: source(), outDir: out, secrets: ["super-secret"], verify: okVerify, privateKeyPem: privatePem, provenance: trusted, runId: "run-test-0003" });
    assert.equal(result.status, "passed");
    assert.deepEqual(verifyArchive(out, publicPem), { ok: true, problems: [] });
  });

  it("any change after signing is detected: edited file, added file, edited manifest", () => {
    const out = path.join(tmp(), "archive");
    archiveEvidence({ sourceDir: source(), outDir: out, secrets: [], verify: okVerify, privateKeyPem: privatePem, provenance: trusted, runId: "run-test-0004" });
    writeFileSync(path.join(out, "a.json"), '{"ok":false}\n');
    assert.ok(verifyArchive(out, publicPem).problems.some((p) => /modified after signing/.test(p)));
    writeFileSync(path.join(out, "extra.json"), "{}");
    assert.ok(verifyArchive(out, publicPem).problems.some((p) => /not covered by the signed manifest/.test(p)));
    const manifest = JSON.parse(readFileSync(path.join(out, "archive-manifest.json"), "utf8"));
    manifest.files[0].sha256 = "0".repeat(64);
    writeFileSync(path.join(out, "archive-manifest.json"), JSON.stringify(manifest));
    assert.ok(verifyArchive(out, publicPem).problems.some((p) => /signature does not verify/.test(p)));
    assert.ok(canonicalManifest(manifest).length > 0);
  });

  it("a different signer's key does not verify", () => {
    const out = path.join(tmp(), "archive");
    archiveEvidence({ sourceDir: source(), outDir: out, secrets: [], verify: okVerify, privateKeyPem: privatePem, provenance: trusted, runId: "run-test-0005" });
    const other = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    assert.equal(verifyArchive(out, other).ok, false);
  });

  it("missing signing key or untrusted provenance is BLOCKED and writes nothing", () => {
    const out = path.join(tmp(), "archive");
    const noKey = archiveEvidence({ sourceDir: source(), outDir: out, secrets: [], verify: okVerify, privateKeyPem: null, provenance: trusted, runId: "r" });
    assert.equal(noKey.status, "blocked");
    const local = archiveEvidence({ sourceDir: source(), outDir: out, secrets: [], verify: okVerify, privateKeyPem: privatePem, provenance: { trusted: false, runner: "local" }, runId: "r" });
    assert.equal(local.status, "blocked");
    assert.throws(() => readFileSync(path.join(out, "archive-manifest.json")));
  });

  it("a credential anywhere in the evidence refuses the archive before anything is copied", () => {
    const src = source();
    writeFileSync(path.join(src, "leak.json"), '{"note":"token super-secret-value-123"}\n');
    const out = path.join(tmp(), "archive");
    const result = archiveEvidence({ sourceDir: src, outDir: out, secrets: ["super-secret-value-123"], verify: okVerify, privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(result.status, "failed");
    assert.throws(() => readFileSync(path.join(out, "a.json")));
  });

  it("a failing verification is never signed", () => {
    const out = path.join(tmp(), "archive");
    const result = archiveEvidence({ sourceDir: source(), outDir: out, secrets: [], verify: () => ({ status: "failed", exitCode: 1 }), privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(result.status, "failed");
    assert.throws(() => readFileSync(path.join(out, "archive-manifest.sig")));
  });

  it("file digests used by the verifier are the sha256 of file contents", () => {
    const file = path.join(tmp(), "x.txt");
    writeFileSync(file, "hello");
    assert.equal(fileDigest(file), `sha256:${createHash("sha256").update("hello").digest("hex")}`);
    cpSync(file, path.join(path.dirname(file), "y.txt"));
    assert.ok(REPO_ROOT.length > 0);
  });
});
