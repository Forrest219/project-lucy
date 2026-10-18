// A7 integrity + A6 per-ask canary policy adversarial regressions (Plan §A6/A7, Spec §8.3, §8.4).
//
// These tests cover the concrete faults identified in review-a6-collector.md and task-a7.md:
//   1. The verifier CLI no longer throws ReferenceError in either --assemble or --evidence mode.
//   2. The portable archive places the run's results under <outDir>/results/ so loadResults on the
//      archive dir (not the source dir) returns the same content; deletion / rename of the source
//      does not invalidate the signed archive.
//   3. The same immutable bytes are scanned, hashed, verified, and signed — a verify callback
//      that mutates a case-result file is detected before signing.
//   4. The listFiles helper only excludes the root index files; nested reserved-name files are
//      still in the manifest.
//   5. fileReaderFor rejects absolute paths, traversal, symlinks, and out-of-root realpaths.
//   6. validateRunnerIdentities now refuses documents that omit runId/instanceId/digests instead
//      of silently passing when the field is absent.
//   7. aggregateRunTimes refuses to report a finishedAt when any required runner never reported
//      its times.
//   8. A6 canary policy: with per-ask indexed evidence, a finance-allowed canary in a finance
//      record does not fail the carrier; the same canary in a sales record does. Missing
//      per-ask evidence falls back to the per-question union (still fail-closed when gold is
//      absent).

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { archiveEvidence, MANIFEST_NAME, SIGNATURE_NAME, verifyArchive } from "../archive-evidence.mjs";
import { aggregateRunTimes, validateRunnerIdentities, assembleEvidence, loadResults } from "../lib/assemble.mjs";
import { readPerAskIndexedEvidence, buildCanaryPolicy, indexGoldQuestions } from "../../gates/collect-gate-results.mjs";
import { fileReaderFor } from "../verify-evidence.mjs";
import { expectedAskPlan } from "../lib/ask-plan.mjs";
import { CATALOG_PATH, loadCatalog } from "../lib/catalog.mjs";
import { scanText } from "../lib/leak-scan.mjs";

const roots = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lucy-a7-"));
  roots.push(dir);
  return dir;
};
after(() => roots.forEach((dir) => { try { rmSync(dir, { recursive: true, force: true }); } catch {} }));

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const trusted = { trusted: true, runner: "protected-1", ciRunId: "1", ciSha: "a".repeat(40) };

describe("A7-1: archive layout places source under outDir/results/ so loadResults(archiveDir) finds files", () => {
  it("archiveEvidence copies <source> to <outDir>/results/ (not <outDir> directly)", () => {
    const source = tmp();
    writeFileSync(path.join(source, "agent.json"), '{"cases":[]}\n');
    writeFileSync(path.join(source, "deployment.json"), '{"instanceId":"inst-1","topology":"single-replica-k8s"}\n');
    const runJsonPath = path.join(source, "run.json");
    const runJsonBody = JSON.stringify({
      contract: "lucy-e2e-run-v1",
      runId: "r",
      instanceId: "inst-1",
      paths: { runDir: source, checker: path.join(source, "checker") }
    });
    writeFileSync(runJsonPath, runJsonBody + "\n");

    const out = path.join(tmp(), "archive");
    const r = archiveEvidence({
      sourceDir: source,
      outDir: out,
      secrets: [],
      verify: () => ({ status: "passed", exitCode: 0 }),
      privateKeyPem: privatePem,
      provenance: trusted,
      runId: "r",
      archiveExtras: { runJsonPath }
    });
    assert.equal(r.status, "passed");
    // Source files now live under <outDir>/results/. loadResults(<outDir>) reads from
    // <outDir>/results/*.json — that is the only path the verify-dir glue can use after a
    // portable archive is moved to a different host.
    assert.ok(existsSync(path.join(out, "results", "agent.json")), "agent.json must be at <outDir>/results/agent.json");
    assert.ok(existsSync(path.join(out, "results", "deployment.json")), "deployment.json must be at <outDir>/results/deployment.json");
    assert.ok(existsSync(path.join(out, "run.json")), "run.json must be at <outDir>/run.json (sibling to results/)");
    assert.ok(existsSync(path.join(out, MANIFEST_NAME)), "manifest must be at <outDir>/archive-manifest.json");
    assert.ok(existsSync(path.join(out, SIGNATURE_NAME)), "signature must be at <outDir>/archive-manifest.sig");
  });

  it("loadResults(archiveDir) reads agent.json, deployment.json, etc. from <outDir>/results/", () => {
    const source = tmp();
    writeFileSync(path.join(source, "agent.json"), '{"cases":[],"clients":[]}\n');
    writeFileSync(path.join(source, "deployment.json"), '{"instanceId":"inst-1","topology":"single-replica-k8s","deployedImageDigest":"sha256:abc"}\n');
    writeFileSync(path.join(source, "security.json"), '{"cases":[]}\n');
    writeFileSync(path.join(source, "management.json"), '{"cases":[]}\n');
    writeFileSync(path.join(source, "gates.json"), '{"cases":[],"existing":[],"contextMigrationPending":0,"projectionBacklog":0}\n');
    writeFileSync(path.join(source, "provenance.json"), '{"trusted":true,"runner":"ci"}\n');
    const runJsonPath = path.join(source, "run.json");
    const runJsonBody = JSON.stringify({
      contract: "lucy-e2e-run-v1",
      runId: "r",
      instanceId: "inst-1",
      paths: { runDir: source, checker: path.join(source, "checker") }
    });
    writeFileSync(runJsonPath, runJsonBody + "\n");
    mkdirSync(path.join(source, "manual"), { recursive: true });
    writeFileSync(path.join(source, "manual", "workbuddy.json"), '{"product":"workbuddy","execution":"manual","transport":"gui","status":"passed"}\n');
    writeFileSync(path.join(source, "manual", "cursor.json"), '{"product":"cursor","execution":"manual","transport":"gui","status":"passed"}\n');
    const out = path.join(tmp(), "archive");
    archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r", archiveExtras: { runJsonPath } });
    // Pretend the run is now verified on a different host: load the run.json from the archive and
    // rebase run.paths.runDir to the archive dir. loadResults(archiveDir) must find all the files.
    const run = JSON.parse(readFileSync(path.join(out, "run.json"), "utf8"));
    run.paths = { ...(run.paths ?? {}), runDir: out, resultsDir: path.join(out, "results") };
    const results = loadResults(run);
    assert.ok(results.agent, "loadResults must read agent.json from <outDir>/results/");
    assert.ok(results.deployment, "loadResults must read deployment.json from <outDir>/results/");
    assert.ok(results.gates, "loadResults must read gates.json from <outDir>/results/");
    assert.ok(results.manual.workbuddy, "loadResults must read manual/workbuddy.json from <outDir>/results/");
    assert.ok(results.manual.cursor, "loadResults must read manual/cursor.json from <outDir>/results/");
  });

  it("the signed archive verifies after the source directory is renamed and moved (portable)", () => {
    const source = tmp();
    writeFileSync(path.join(source, "agent.json"), '{"cases":[]}\n');
    writeFileSync(path.join(source, "deployment.json"), '{"instanceId":"inst-1","topology":"single-replica-k8s"}\n');
    const runJsonPath = path.join(source, "run.json");
    const runJsonBody = JSON.stringify({
      contract: "lucy-e2e-run-v1",
      runId: "r",
      instanceId: "inst-1",
      paths: { runDir: source, checker: path.join(source, "checker") }
    });
    writeFileSync(runJsonPath, runJsonBody + "\n");
    const out = path.join(tmp(), "archive");
    archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r", archiveExtras: { runJsonPath } });
    // Move the source to a brand-new location. The archive must still verify from the moved bytes.
    const movedSource = path.join(tmp(), "moved-source");
    renameSync(source, movedSource);
    const result = verifyArchive(out, publicPem);
    assert.equal(result.ok, true, `archive must verify after source rename; problems=${JSON.stringify(result.problems)}`);
  });
});

describe("A7-2: archive scan/hash/verify/sign cover the SAME immutable bytes", () => {
  it("a verify callback that mutates a case-result file is refused before signing", () => {
    const source = tmp();
    writeFileSync(path.join(source, "a.json"), '{"ok":true}\n');
    const out = path.join(tmp(), "archive");
    let callbackInvoked = false;
    const r = archiveEvidence({
      sourceDir: source,
      outDir: out,
      secrets: [],
      // The verify callback mutates a.json between scan and sign. The previous implementation
      // re-hashed the snapshot, but the snapshot was taken AFTER the verify callback ran in
      // the original ordering — this test pins the new contract: a mutation is refused.
      verify: () => {
        callbackInvoked = true;
        const archived = path.join(out, "results", "a.json");
        if (existsSync(archived)) writeFileSync(archived, '{"ok":false}\n');
        return { status: "passed", exitCode: 0 };
      },
      privateKeyPem: privatePem,
      provenance: trusted,
      runId: "r"
    });
    assert.ok(callbackInvoked, "verify callback must be invoked");
    assert.equal(r.status, "failed", "mutated bytes must be refused before signing");
    assert.ok(!existsSync(path.join(out, SIGNATURE_NAME)), "no signature may be written for a mutated archive");
  });

  it("nested reserved-name files appear in the signed manifest (only root index files are excluded)", () => {
    const source = tmp();
    writeFileSync(path.join(source, "a.json"), '{"ok":true}\n');
    mkdirSync(path.join(source, "nested"), { recursive: true });
    writeFileSync(path.join(source, "nested", "archive-manifest.json"), '{"nested":true}\n');
    writeFileSync(path.join(source, "nested", "archive-manifest.sig"), "sigsig\n");
    const out = path.join(tmp(), "archive");
    const r = archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(r.status, "passed");
    const manifest = JSON.parse(readFileSync(path.join(out, MANIFEST_NAME), "utf8"));
    const paths = manifest.files.map((f) => f.path).sort();
    assert.ok(paths.includes("results/nested/archive-manifest.json"), `nested manifest must be in the signed manifest; got ${JSON.stringify(paths)}`);
    assert.ok(paths.includes("results/nested/archive-manifest.sig"), `nested sig must be in the signed manifest; got ${JSON.stringify(paths)}`);
    assert.ok(!paths.includes("archive-manifest.json"), "root index manifest must not appear in itself");
    assert.ok(!paths.includes("archive-manifest.sig"), "root index sig must not appear in itself");
  });

  it("a symlink in the source tree is refused before any output is written", () => {
    const source = tmp();
    writeFileSync(path.join(source, "a.json"), '{"ok":true}\n');
    writeFileSync(path.join(source, "secret.json"), '{"note":"super-secret-value-123 here"}\n');
    symlinkSync(path.join(source, "secret.json"), path.join(source, "link.json"));
    const out = path.join(tmp(), "archive");
    const r = archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(r.status, "blocked");
    assert.ok(!existsSync(path.join(out, MANIFEST_NAME)), "no manifest may be written for a symlinked source");
    assert.ok(!existsSync(path.join(out, SIGNATURE_NAME)));
  });

  it("an outDir nested inside sourceDir is refused", () => {
    const source = tmp();
    writeFileSync(path.join(source, "a.json"), '{"ok":true}\n');
    const out = path.join(source, "archive-nested");
    const r = archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(r.status, "blocked");
    assert.ok(r.reasons.some((x) => /nested inside sourceDir/.test(x)), `expected nested-source reason; got ${JSON.stringify(r.reasons)}`);
  });

  it("a non-empty outDir is refused (we never mix new bytes with an old archive)", () => {
    const source = tmp();
    writeFileSync(path.join(source, "a.json"), '{"ok":true}\n');
    const out = path.join(tmp(), "archive");
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "stale.txt"), "old archive bytes\n");
    const r = archiveEvidence({ sourceDir: source, outDir: out, secrets: [], verify: () => ({ status: "passed", exitCode: 0 }), privateKeyPem: privatePem, provenance: trusted, runId: "r" });
    assert.equal(r.status, "blocked");
    assert.ok(r.reasons.some((x) => /not empty/.test(x)));
  });
});

describe("A7-3: fileReaderFor rejects absolute/traversal/symlink/out-of-root paths", () => {
  it("refuses absolute paths, NUL bytes, and traversal in relative paths", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "in.json"), "ok\n");
    const reader = fileReaderFor(dir);
    assert.equal(reader("/etc/passwd"), null, "absolute path must be refused");
    assert.equal(reader("../outside.json"), null, "traversal must be refused");
    assert.equal(reader("in.json\0evil"), null, "NUL must be refused");
    assert.ok(reader("in.json") !== null, "a normal relative path resolves");
  });

  it("refuses to follow a symlink that escapes the base directory", () => {
    const dir = tmp();
    const outside = tmp();
    writeFileSync(path.join(outside, "secret.json"), "leak\n");
    writeFileSync(path.join(dir, "in.json"), "ok\n");
    symlinkSync(path.join(outside, "secret.json"), path.join(dir, "escape.json"));
    const reader = fileReaderFor(dir);
    assert.equal(reader("escape.json"), null, "escaping symlink must be refused");
    assert.ok(reader("in.json") !== null, "regular file resolves");
  });

  it("refuses to read a non-regular file (e.g. a directory)", () => {
    const dir = tmp();
    mkdirSync(path.join(dir, "subdir"), { recursive: true });
    const reader = fileReaderFor(dir);
    assert.equal(reader("subdir"), null);
  });
});

describe("A7-4: aggregateRunTimes requires ALL three required runners to have parseable times", () => {
  it("returns finishedAt=null when any required runner is missing its times", () => {
    const results = {
      security: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:00:00.000Z" },
      management: { startedAt: "2026-10-18T10:00:00.000Z" /* finishedAt missing */ },
      agent: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:00:00.000Z" }
    };
    const r = aggregateRunTimes({ results });
    assert.equal(r.finishedAt, null, "a missing runner time must null the aggregated finishedAt");
    assert.ok(r.memberProblems.some((p) => /management/.test(p)));
  });

  it("refuses to launder a stale runner with one missing: finishedAt must be null", () => {
    const results = {
      // runner A has very old times
      security: { startedAt: "2026-01-01T10:00:00.000Z", finishedAt: "2026-01-01T11:00:00.000Z" },
      // runner B is missing — assembly must not pretend the run finished
      management: null,
      agent: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:00:00.000Z" }
    };
    const r = aggregateRunTimes({ results });
    assert.equal(r.finishedAt, null);
    assert.ok(r.memberProblems.some((p) => /management/.test(p)));
  });

  it("returns the latest finish across all three required runners when none are missing", () => {
    const results = {
      security: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:00:00.000Z" },
      management: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z" },
      agent: { startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:03:00.000Z" }
    };
    const r = aggregateRunTimes({ results });
    assert.equal(r.startedAt, "2026-10-18T10:00:00.000Z");
    assert.equal(r.finishedAt, "2026-10-18T11:05:00.000Z");
  });
});

describe("A7-5: validateRunnerIdentities refuses documents that omit required identity fields", () => {
  function runFields() {
    return { runId: "r-1", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1", candidateDigest: "img1" };
  }
  // Other three runner slots carry a complete identity envelope so the focused tests below
  // only surface the problem introduced by the security doc.
  const stubOthers = {
    management: { runId: "r-1", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" },
    agent: { runId: "r-1", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" },
    gates: { runId: "r-1", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" }
  };

  it("a runner document that omits runId is refused (no longer silently passed)", () => {
    const doc = { instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" };
    const problems = validateRunnerIdentities({ results: { security: doc, ...stubOthers }, run: runFields() });
    assert.ok(problems.some((p) => /runId is missing/.test(p)), `expected runId missing; got ${JSON.stringify(problems)}`);
  });

  it("a runner document that omits caseCatalogDigest is refused", () => {
    const doc = { runId: "r-1", instanceId: "inst-1", profileDigest: "p1", fixtureDigest: "f1" };
    const problems = validateRunnerIdentities({ results: { security: doc, ...stubOthers }, run: runFields() });
    assert.ok(problems.some((p) => /caseCatalogDigest is missing/.test(p)));
  });

  it("a runner document whose runId disagrees is refused with the explicit message", () => {
    const doc = { runId: "forged", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" };
    const problems = validateRunnerIdentities({ results: { security: doc, ...stubOthers }, run: runFields() });
    assert.ok(problems.some((p) => /runId forged != r-1/.test(p)));
  });

  it("a complete runner document with the same identity is accepted", () => {
    const doc = { runId: "r-1", instanceId: "inst-1", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1" };
    const problems = validateRunnerIdentities({ results: { security: doc, ...stubOthers }, run: runFields() });
    assert.deepEqual(problems, [], `expected no problems; got ${JSON.stringify(problems)}`);
  });
});

describe("A6 per-ask canary policy: each ask is checked against its OWN forbidden canaries", () => {
  // The A6 mandatory two-record fixture: the run has two asks under different identities. The
  // finance ask is allowed to see the finance canary; the sales ask is NOT. The buildCanaryPolicy
  // output must reflect that, not the global union.
  function makeRunWithPerAsk() {
    const dir = tmp();
    const run = {
      runId: "r-2", instanceId: "inst-2", caseCatalogDigest: "c1", profileDigest: "p1", fixtureDigest: "f1", candidateDigest: "img1",
      paths: { runDir: dir, checker: path.join(dir, "checker"), logs: path.join(dir, "logs") }
    };
    // Create the per-ask indexed evidence: one finance ask + one sales denial.
    const agentJson = {
      cases: [
        {
          id: "SEC-14-V12", runner: "agent", client: "claude-code", run: 1, status: "passed",
          asks: [
            { askIndex: 0, caseId: "SEC-14-V12", agentId: "e2e_sales", goldKey: null, expectation: "denied", since: "2026-10-18T10:00:00.000Z", until: "2026-10-18T10:01:00.000Z" },
            { askIndex: 1, caseId: "SEC-14-V12", agentId: "e2e_finance", goldKey: "Q-CAC-28D", expectation: "answer", since: "2026-10-18T10:01:00.000Z", until: "2026-10-18T10:02:00.000Z" }
          ]
        }
      ]
    };
    mkdirSync(path.join(dir, "results"), { recursive: true });
    writeFileSync(path.join(dir, "results", "agent.json"), JSON.stringify(agentJson));
    return run;
  }

  it("with per-ask evidence, the policy mode is per-ask-per-question and canaries are partitioned", () => {
    const run = makeRunWithPerAsk();
    const indexed = readPerAskIndexedEvidence(run);
    assert.equal(indexed.available, true);
    const gold = {
      questions: {
        "Q-CAC-28D": { forbiddenCanaries: ["financeCanary"] },
        // pretend Q-ORDERS-WEST-SALES would forbid the sales canary; we don't ask it here
        "Q-ORDERS-WEST-SALES": { forbiddenCanaries: ["salesCanary"] }
      }
    };
    const goldQuestions = indexGoldQuestions(gold);
    const { canaries, perAskForbidden, policy } = buildCanaryPolicy(run, indexed, goldQuestions);
    assert.equal(policy.mode, "per-ask-per-question");
    assert.equal(policy.available, true);
    // The map key MUST be the full canonical execution key (caseId/client/run/askIndex/agent/goldKey)
    // — never just `${askIndex}@${goldKey}` — so two distinct asks under the same caseId do not
    // collide. The previous key collapsed finance+sales into one slot and the second ask overwrote
    // the first's policy (URGENT A6 identity partition).
    const financeEntry = perAskForbidden.get("SEC-14-V12@claude-code#1/ask1|e2e_finance|Q-CAC-28D");
    const salesEntry = perAskForbidden.get("SEC-14-V12@claude-code#1/ask0|e2e_sales|none");
    assert.ok(financeEntry, "finance ask must be a key in perAskForbidden");
    assert.ok(salesEntry, "sales ask must be a key in perAskForbidden");
    assert.ok(financeEntry.forbidden.has("financeCanary"), "finance ask must forbid the finance canary");
    assert.ok(!financeEntry.forbidden.has("salesCanary"), "finance ask must NOT forbid the sales canary");
    assert.ok(salesEntry.forbidden.has("financeWiki"), "sales denial must forbid the plan's injectionForbidden canaries (financeWiki, publishedSkill)");
    assert.ok(salesEntry.forbidden.has("publishedSkill"));
    // The global `canaries` list is a SUPERSET (kept for callers that need a flat list), but
    // the carrier scan now uses the per-ask map to apply canaries per ask.
    assert.ok(canaries.includes("financeCanary"));
    assert.ok(canaries.includes("financeWiki"));
  });

  it("without per-ask evidence, the policy falls back to per-question-union and records the reason", () => {
    const run = makeRunWithPerAsk();
    // remove the per-ask record so readPerAskIndexedEvidence returns { available: false }
    rmSync(path.join(run.paths.runDir, "results", "agent.json"));
    const indexed = readPerAskIndexedEvidence(run);
    assert.equal(indexed.available, false);
    const gold = { questions: { "Q-CAC-28D": { forbiddenCanaries: ["financeCanary"] } } };
    const { policy } = buildCanaryPolicy(run, indexed, indexGoldQuestions(gold));
    assert.equal(policy.mode, "per-question-union");
    assert.equal(policy.available, false);
    assert.ok(policy.reason);
  });

  it("URGENT: a single file with two indexed records — finance-allowed canary in finance record passes; same canary in sales record fails", () => {
    // URGENT task-a7 §A6 root cause: the previous router did not know which ask's bytes
    // lived in which file, so a canary present in the FINANCE record could be falsely
    // flagged because the same canary was forbidden for the SALES ask. This test forces
    // the precise identity binding: each ask's answerPath points at a different file, and
    // the sales ask's plan-injectionForbidden forbids a canary the finance ask's gold
    // does NOT forbid. The canary MUST be a hit in the sales file, a non-hit in the
    // finance file.
    const run = makeRunWithPerAsk();
    // The run-agent-journey must record an `answerPath` per ask for the carrier router to
    // bind files to asks. Simulate that here.
    const agentPath = path.join(run.paths.runDir, "results", "agent.json");
    const agentDoc = JSON.parse(readFileSync(agentPath, "utf8"));
    agentDoc.cases[0].asks[0].answerPath = "results/client-work/e2e_sales/answer.json";
    agentDoc.cases[0].asks[1].answerPath = "results/client-work/e2e_finance/answer.json";
    writeFileSync(agentPath, JSON.stringify(agentDoc));
    const indexed = readPerAskIndexedEvidence(run);
    // The real plan for SEC-14-V12 puts `financeWiki` in the sales ask's
    // `injectionForbidden` (sales denial must not surface finance internals). The
    // finance gold question Q-CAC-28D has no `financeWiki` in its forbiddenCanaries,
    // so the finance ask does NOT forbid `financeWiki`. The canary is therefore
    // "finance-allowed" (allowed in the finance record) but forbidden in the sales
    // record — exactly the URGENT scenario.
    const gold = { questions: { "Q-CAC-28D": { forbiddenCanaries: [] } } };
    const { perAskForbidden, policy } = buildCanaryPolicy(run, indexed, indexGoldQuestions(gold));
    assert.equal(policy.mode, "per-ask-per-question");
    const salesEntry = perAskForbidden.get("SEC-14-V12@claude-code#1/ask0|e2e_sales|none");
    const financeEntry = perAskForbidden.get("SEC-14-V12@claude-code#1/ask1|e2e_finance|Q-CAC-28D");
    assert.ok(salesEntry.answerPath, "sales ask must expose an answerPath so the router can bind files to it");
    assert.ok(financeEntry.answerPath, "finance ask must expose an answerPath");
    assert.ok(salesEntry.forbidden.has("financeWiki"), "sales ask must forbid financeWiki (from plan injectionForbidden)");
    assert.ok(!financeEntry.forbidden.has("financeWiki"), "finance ask must NOT forbid financeWiki");
    // Build a router that consults answerPath binding, then scan two synthetic files.
    const bound = [];
    for (const [key, entry] of perAskForbidden.entries()) {
      if (entry.answerPath) bound.push({ key, entry });
    }
    const router = (rel) => {
      const matches = bound.filter((b) => b.entry.answerPath === rel || rel.startsWith(`${b.entry.answerPath}/`));
      if (matches.length === 0) return "__LUCY_UNRESOLVED_IDENTITY__";
      const canaries = new Set();
      for (const m of matches) for (const c of m.entry.forbidden) canaries.add(c);
      return [...canaries];
    };
    // Sales file with `financeWiki`: MUST be flagged (sales ask forbids it).
    const salesHits = scanText("payload contains financeWiki token here", { canaryRouter: router, fileRel: "results/client-work/e2e_sales/answer.json" });
    // Finance file with the SAME canary: MUST be allowed (finance ask does not forbid it).
    const financeHits = scanText("payload contains financeWiki token here", { canaryRouter: router, fileRel: "results/client-work/e2e_finance/answer.json" });
    assert.ok(salesHits.some((h) => h.kind === "forbidden-canary"), `financeWiki in SALES record MUST be flagged forbidden-canary; got ${JSON.stringify(salesHits)}`);
    assert.equal(financeHits.length, 0, `financeWiki in FINANCE record MUST be allowed (no canary hit); got ${JSON.stringify(financeHits)}`);
  });

  it("URGENT: scanText with a throwing canaryRouter must surface router-unresolved, not silently empty", () => {
    // The previous implementation's `try { ... } catch { effectiveCanaries = [] }` made a
    // throwing router return zero hits — a finance-allowed canary would silently pass. The
    // new contract: a throwing router is an UNRESOLVED identity, surfaced as a synthetic
    // `router-unresolved` hit that turns the carrier verdict into `failed`.
    const hits = scanText("SYNTHETIC-FORBIDDEN-CANARY", { canaryRouter: () => { throw new Error("identity unresolved"); }, fileRel: "two-identities.json" });
    assert.ok(hits.some((h) => h.kind === "router-unresolved"), `expected router-unresolved hit; got ${JSON.stringify(hits)}`);
  });

  it("URGENT: scanText with a router returning a non-array is UNRESOLVED, not zero canaries", () => {
    const hits = scanText("SYNTHETIC-FORBIDDEN-CANARY", { canaryRouter: () => "not-an-array", fileRel: "two-identities.json" });
    assert.ok(hits.some((h) => h.kind === "router-unresolved"), `expected router-unresolved hit; got ${JSON.stringify(hits)}`);
  });

  it("URGENT: a file that NO ask binds (unbound file) is router-unresolved, not silently allowed", () => {
    // The previous carrier code returned `aggregatedCanaries` for unbound files. That
    // was the A6 false-green root cause: a canary in finance-allowed bytes that some
    // OTHER ask forbids would fail the file even when those bytes were never asked.
    // The new contract: an unbound file under per-ask policy is UNRESOLVED.
    const run = makeRunWithPerAsk();
    const agentPath = path.join(run.paths.runDir, "results", "agent.json");
    const agentDoc = JSON.parse(readFileSync(agentPath, "utf8"));
    agentDoc.cases[0].asks[0].answerPath = "results/client-work/e2e_sales/answer.json";
    agentDoc.cases[0].asks[1].answerPath = "results/client-work/e2e_finance/answer.json";
    writeFileSync(agentPath, JSON.stringify(agentDoc));
    const indexed = readPerAskIndexedEvidence(run);
    const gold = { questions: { "Q-CAC-28D": { forbiddenCanaries: ["financeCanary"] } } };
    const { perAskForbidden } = buildCanaryPolicy(run, indexed, indexGoldQuestions(gold));
    const bound = [];
    for (const [key, entry] of perAskForbidden.entries()) {
      if (entry.answerPath) bound.push({ key, entry });
    }
    const router = (rel) => {
      const matches = bound.filter((b) => b.entry.answerPath === rel || rel.startsWith(`${b.entry.answerPath}/`));
      if (matches.length === 0) return "__LUCY_UNRESOLVED_IDENTITY__";
      const canaries = new Set();
      for (const m of matches) for (const c of m.entry.forbidden) canaries.add(c);
      return [...canaries];
    };
    const hits = scanText("a server log with no ask binding", { canaryRouter: router, fileRel: "results/logs/server.log" });
    assert.ok(hits.some((h) => h.kind === "router-unresolved"), `unbound file must be router-unresolved; got ${JSON.stringify(hits)}`);
  });
});
