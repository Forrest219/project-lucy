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
import { expectedAskPlan } from "../lib/ask-plan.mjs";
import { expectedExecutions } from "../lib/catalog.mjs";
import { automatedRequiredClients, manualRequiredClients } from "../lib/clients.mjs";
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
const requiredClients = automatedRequiredClients(inputs.clientsDoc.clients).map((c) => c.product);
const manualClients = manualRequiredClients(inputs.clientsDoc.clients).map((c) => c.product);
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
  mkdirSync(path.join(dir, "results", "manual"), { recursive: true });
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
    if (spec.runner === "agent") {
      // A4: per-ask indexed records are REQUIRED for every passed agent case. The expected plan
      // comes from the shared registry; the fixture materializes one ask per expected entry with
      // matching agentId/goldKey/expectation. Multi-ask negative fixtures override the entry's
      // `asks` directly. The per-ask trace/query/policy/fingerprint fields are bound to the
      // per-ask ledger record.
      const plan = expectedAskPlan(spec) ?? [{ agentId: "e2e_finance", goldKey: null, expectation: "answer", suffix: true }];
      entry.asks = plan.map((askSpec, askIndex) => {
        const ask = {
          runId: "run-test-0001",
          instanceId: "inst-1",
          caseId: idPart,
          client: client ?? null,
          run: run ? Number(run) : null,
          askIndex,
          agentId: askSpec.agentId,
          goldKey: askSpec.goldKey ?? null,
          expectation: askSpec.expectation ?? "answer",
          since: "2026-10-18T11:00:00.000Z",
          until: "2026-10-18T11:05:00.000Z",
          traceIds: askIndex === 0 ? entry.serverTraceIds : [`trace_${key.replace(/[@#]/g, "_")}_ask${askIndex}`],
          queryEventIds: askIndex === 0 ? entry.queryEventIds : [],
          tokenFingerprint: askSpec.agentId === "e2e_sales" ? "f1f1f1f1f1f1" : "abcdef123456",
          policyVersion: "pv1",
          contextPolicyVersion: "cv1",
          resultDigest: createHash("sha256").update(`result_${key}_ask${askIndex}`).digest("hex"),
          goldDigest: createHash("sha256").update(`gold_${key}_ask${askIndex}`).digest("hex")
        };
        ledger.push({ caseId: idPart, client, run: Number(run), askIndex, runId: "run-test-0001", instanceId: "inst-1", agentId: ask.agentId, tokenFingerprint: ask.tokenFingerprint, traceIds: ask.traceIds, queryEventIds: ask.queryEventIds, policyVersion: "pv1", contextPolicyVersion: "cv1", resultDigest: ask.resultDigest, goldDigest: ask.goldDigest });
        return ask;
      });
      // The top-level union must equal the EXACT union of per-ask traceIds / queryEventIds so the
      // strict cross-ask laundering check accepts this fixture.
      entry.serverTraceIds = [...new Set(entry.asks.flatMap((a) => a.traceIds))];
      entry.queryEventIds = [...new Set(entry.asks.flatMap((a) => a.queryEventIds))];
      entry.tokenFingerprints = [...new Set(entry.asks.map((a) => a.tokenFingerprint))];
      entry.tokenFingerprint = entry.asks[0]?.tokenFingerprint ?? null;
    } else if (dataCase) {
      ledger.push({ caseId: idPart, tokenFingerprint: "abcdef123456", traceIds: entry.serverTraceIds });
    }
    return entry;
  });
  const serverBody = `${JSON.stringify({ contract: "lucy-server-evidence-v1", source: "instance-ledger", cases: ledger })}\n`;
  writeFileSync(path.join(dir, "results", "server-evidence.json"), serverBody);
  // Write the documented M-01..M-05 packs and reuse the normalized entry so the assembler-computed
  // artifact.sha256 (SHA256 of raw pack bytes) matches the file on disk.
  const manualPackEntries = manualClients.map((product) => {
    const result = writeManualPackIn(dir, product);
    return { product, normalized: result.normalized, packPath: result.packPath, digest: result.digest };
  });
  const count = (s) => entries.filter((e) => e.status === s).length;
  const evidence = {
    contract: "lucy-real-user-e2e-v1", executionMode: "release", stub: false, runId: "run-test-0001", candidate: clone(candidate),
    environment: {
      instanceId: "inst-1", topology: "single-replica-k8s", fixtureDigest: `sha256:${"f".repeat(64)}`, profileDigest: inputs.profileDigest,
      caseCatalogDigest: inputs.catalogDigest, deployedImageDigest: IMAGE, startedAt: "2026-10-18T10:00:00.000Z", finishedAt: "2026-10-18T11:30:00.000Z"
    },
    clients: requiredClients.map((product) => ({ product, version: "1.0.0", adapterDigest: `sha256:${"d".repeat(64)}`, model: "m", transport: "cli", required: true })),
    manualClients: manualPackEntries.map((m) => m.normalized),
    summary: { required: expected.length, executed: entries.length, passed: count("passed"), failed: 0, blocked: 0, skipped: 0, dryRun: 0 },
    cases: entries,
    gates: { contextMigrationPending: 0, projectionBacklog: 0, existing: GATES.map((name) => ({ name, status: "passed", imageDigest: IMAGE })) },
    serverEvidence: { source: "instance-ledger", path: "results/server-evidence.json", sha256: createHash("sha256").update(serverBody).digest("hex") },
    provenance: { trusted: true, runner: "protected-1", ciRunId: "123", ciSha: candidate.gitSha, workflow: "Lucy release gates" },
    status: "passed", releaseReady: false
  };
  return { dir, evidence };
}

const RUN_CREATED_AT = "2026-10-18T09:00:00.000Z";
const RUN_CREATED_AT_MS = Date.parse(RUN_CREATED_AT);

const decide = (evidence, dir, overrides = {}) =>
  verifyRelease({
    evidence,
    candidate,
    ...inputs,
    findings: healthyFindings(),
    audit: HEALTHY_AUDIT,
    readFile: fileReaderFor(dir),
    now: NOW,
    // Production passes these from the run under verification; mirror that so a positive fixture does not
    // silently trip `run_id_mismatch` / `instance_id_mismatch` / `manual_wrong_run`.
    runId: "run-test-0001",
    instanceId: "inst-1",
    runCreatedAtMs: RUN_CREATED_AT_MS,
    schema: inputs.schema,
    ...overrides
  });
const codes = (verdict) => verdict.problems.map((p) => p.code);

/**
 * Write the documented M-01..M-05 pack to disk under `dir/results/manual/<product>.json` and create the
 * per-step artifact files (`evidencePath`) the verifier compares against `evidenceSha256`. Reuse an
 * existing `dir` so multiple products land in the same run-tree the assembler will load.
 *
 * Every step ships with a real `evidencePath` + matching `evidenceSha256`. Without those, the verifier's
 * per-step loop fires `manual_step_evidence_missing` on every step; the negative tests that intentionally
 * break the contract override the `steps` array directly.
 *
 * The pack is written ONCE. The on-disk `artifact.sha256` field is recorded as a placeholder
 * (zero-digest) because a self-referential hash is impossible in JSON. The verifier's tamper detection
 * compares the assembly-computed SHA (taken from the file's actual bytes) with the in-memory entry's
 * recorded SHA — and that is the only binding that's possible here.
 */
function writeManualPackIn(dir, product, overrides = {}) {
  mkdirSync(path.join(dir, "results", "manual"), { recursive: true });
  const stepEvidencePaths = overrides.stepEvidencePaths ?? ["tools", "finance", "wiki-deny", "token-revoke", "export"];
  const steps = overrides.steps ?? [
    { id: "M-01", passed: true, evidencePath: `results/manual/${product}-M-01-${stepEvidencePaths[0]}.json`, evidenceSha256: "PENDING" },
    { id: "M-02", passed: true, evidencePath: `results/manual/${product}-M-02-${stepEvidencePaths[1]}.json`, evidenceSha256: "PENDING" },
    { id: "M-03", passed: true, evidencePath: `results/manual/${product}-M-03-${stepEvidencePaths[2]}.json`, evidenceSha256: "PENDING" },
    { id: "M-04", passed: true, evidencePath: `results/manual/${product}-M-04-${stepEvidencePaths[3]}.json`, evidenceSha256: "PENDING" },
    { id: "M-05", passed: true, evidencePath: `results/manual/${product}-M-05-${stepEvidencePaths[4]}.json`, evidenceSha256: "PENDING" }
  ];
  // Write each per-step evidence file (synthetic; production uses real screenshots/audit dumps).
  const evidenceBodies = [];
  for (const step of steps) {
    const evidenceBody = `${JSON.stringify({ step: step.id, product, ok: true, capturedAt: "2026-10-18T11:00:00.000Z" })}\n`;
    const evidencePath = path.join(dir, step.evidencePath);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, evidenceBody);
    step.evidenceSha256 = createHash("sha256").update(evidenceBody).digest("hex");
    evidenceBodies.push({ step: step.id, path: step.evidencePath, sha: step.evidenceSha256 });
  }
  const pack = {
    product,
    execution: "manual",
    transport: "gui",
    status: overrides.status ?? (steps.every((s) => s.passed === true) ? "passed" : "failed"),
    operator: overrides.operator ?? "tester",
    completedAt: overrides.completedAt ?? "2026-10-18T11:00:00.000Z",
    runId: overrides.runId ?? "run-test-0001",
    productVersion: overrides.productVersion ?? "1.0.0",
    notes: overrides.notes ?? "synthetic fixture pack",
    steps,
    artifact: { path: `results/manual/${product}.json`, sha256: "0".repeat(64) }
  };
  const body = `${JSON.stringify(pack)}\n`;
  const packPath = path.join(dir, "results", "manual", `${product}.json`);
  writeFileSync(packPath, body);
  const digest = createHash("sha256").update(body).digest("hex");
  return {
    dir,
    packPath,
    digest,
    rawPack: pack,
    evidenceBodies,
    // The normalized entry's artifact.sha256 mirrors what the assembler would record when it reads the
    // raw file: SHA256 of the on-disk bytes. The verifier cross-checks this against its own re-read SHA.
    normalized: { ...pack, artifact: { path: `results/manual/${product}.json`, sha256: digest } }
  };
}

describe("the verifier accepts a complete, consistent release evidence set", () => {
  it("passes only when every condition holds, and then releaseReady is true", () => {
    const { dir, evidence } = buildValid();
    const verdict = decide(evidence, dir);
    assert.deepEqual(verdict.problems, []);
    assert.equal(verdict.status, "passed");
    assert.equal(verdict.exitCode, 0);
    assert.equal(verdict.releaseReady, true);
  });

  it("the denominator has no omission and covers 3 runs for each automated required product", () => {
    const expected = expectedExecutions(inputs.cases, requiredClients);
    // v5: automated required = claude-code + openclaw; Codex CLI is optional
    assert.deepEqual(requiredClients.sort(), ["claude-code", "openclaw"]);
    assert.ok(expected.includes("UX-02-V01@claude-code#1") && expected.includes("UX-02-V01@claude-code#3") && expected.includes("UX-02-V01@openclaw#2"));
    assert.ok(!expected.some((k) => k.includes("@codex#")), "Codex CLI is not in the automated denominator (v5)");
    const { evidence } = buildValid();
    assert.equal(evidence.cases.length, expected.length);
  });

  it("[A1 negative] omitting one required execution key fails as omitted_case", () => {
    const { dir, evidence } = buildValid();
    const keys = evidence.cases.map((c) => `${c.id}${c.client ? `@${c.client}#${c.run}` : ""}`);
    const removed = keys[0];
    evidence.cases = evidence.cases.filter((c) => `${c.id}${c.client ? `@${c.client}#${c.run}` : ""}` !== removed);
    evidence.summary = { ...evidence.summary, required: evidence.summary.required, executed: evidence.summary.executed - 1, passed: evidence.summary.passed - 1 };
    assert.ok(codes(decide(evidence, dir)).includes("omitted_case"));
  });

  it("[A1 negative] a duplicated execution key fails as duplicate_case", () => {
    const { dir, evidence } = buildValid();
    const dup = evidence.cases[0];
    evidence.cases.push(clone(dup));
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed + 1, executed: evidence.summary.executed + 1 };
    assert.ok(codes(decide(evidence, dir)).includes("duplicate_case"));
  });

  it("[A1 negative] mixing a manual GUI product into the automated denominator is rejected as unexpected_case", () => {
    const expected = expectedExecutions(inputs.cases, [...requiredClients, "workbuddy"]);
    const keys = evidence => evidence.cases.map((c) => `${c.id}${c.client ? `@${c.client}#${c.run}` : ""}`);
    const { dir, evidence } = buildValid();
    // append a forged workbuddy entry that the runner added on its own
    evidence.cases.push({ id: "UX-02-V01", runner: "agent", client: "workbuddy", run: 1, status: "passed", startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z", serverTraceIds: ["trace_wb"], queryEventIds: ["1"], policyVersion: "pv1", contextPolicyVersion: "cv1", assertions: [{ token: "typed_gold", passed: true }], artifacts: evidence.cases[0].artifacts });
    evidence.summary = { ...evidence.summary, passed: evidence.summary.passed + 1, executed: evidence.summary.executed + 1 };
    assert.ok(expected.some((k) => k.endsWith("@workbuddy#1")), "manual in denominator adds agent keys");
    assert.ok(codes(decide(evidence, dir)).includes("unexpected_case"));
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

describe("A2: manual GUI packs (workbuddy / cursor) are checked as separate required inputs", () => {
  it("positive: the documented M-01..M-05 pack passes every check (workbuddy + cursor)", () => {
    const { dir, evidence } = buildValid();
    assert.deepEqual(decide(evidence, dir).problems, []);
  });

  it("[A2 negative] a missing workbuddy pack entry is rejected as missing_pack (blocked)", () => {
    const { dir, evidence } = buildValid();
    evidence.manualClients = evidence.manualClients.filter((c) => c.product !== "workbuddy");
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_pack"));
  });

  it("[A2 negative] a pack missing a step (only 4 of M-01..M-05) is rejected as manual_bad_steps (or manual_in_memory_drift when the raw file disagrees)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.steps = target.steps.slice(0, 4);
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_bad_steps") || c.includes("manual_in_memory_drift"), `expected manual_bad_steps or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a pack using a J-01 step instead of M-01..M-05 (the old shape) is rejected as schema (id pattern)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.steps = [{ id: "J-01", passed: true }];
    target.status = "passed";
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("schema"), `expected schema code in ${codes(verdict).join(",")}`);
  });

  it("[A2 negative] a pack with a duplicated step is rejected as manual_bad_steps (or manual_in_memory_drift)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    // Keep the schema happy (evidencePath + evidenceSha256 on every step) but introduce a duplicate id,
    // which the per-step / cross-step checks must catch. The raw file still has the original M-01..M-05
    // order, so the in-memory entry disagrees with it.
    const step = (id, evidenceSha256) => ({ id, passed: true, evidencePath: `results/manual/workbuddy-${id}-x.json`, evidenceSha256 });
    target.steps = [step("M-01", target.steps[0].evidenceSha256), step("M-01", target.steps[0].evidenceSha256), step("M-02", target.steps[1].evidenceSha256), step("M-03", target.steps[2].evidenceSha256), step("M-04", target.steps[3].evidenceSha256)];
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_bad_steps") || c.includes("manual_in_memory_drift"), `expected manual_bad_steps or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a pack whose top-level status is 'passed' but a step is failed is rejected as manual_forged_top_passed + manual_client_failed", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "cursor");
    target.steps[0].passed = false;
    target.status = "passed";
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_forged_top_passed") || c.includes("manual_in_memory_drift"), `expected manual_forged_top_passed or manual_in_memory_drift in ${c.join(",")}`);
    assert.ok(c.includes("manual_client_failed") || c.includes("manual_in_memory_drift"));
  });

  it("[A2 negative] a pack declaring the wrong product is rejected as manual_wrong_product (or manual_in_memory_drift)", () => {
    // The schema's product property is just `string` (no enum), so a wrong-but-non-empty product passes
    // schema and reaches the verifier's semantic product check. Use a string distinct from both
    // required products so .find() still matches the entry for `workbuddy` and we exercise the rule.
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.product = "workbuddy-fake";
    const verdict = decide(evidence, dir, { schema: undefined });
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_wrong_product") || c.includes("manual_in_memory_drift"), `expected manual_wrong_product or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a pack with a runId that disagrees with the verifier's current run is rejected as manual_wrong_run (or manual_in_memory_drift)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.runId = "different-run-1234";
    const verdict = decide(evidence, dir, { schema: undefined });
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_wrong_run") || c.includes("manual_in_memory_drift"), `expected manual_wrong_run or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a pack with an empty operator is rejected as manual_empty_operator (or manual_in_memory_drift)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.operator = "";
    const verdict = decide(evidence, dir, { schema: undefined });
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_empty_operator") || c.includes("manual_in_memory_drift"), `expected manual_empty_operator or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a pack with an unparseable completedAt is rejected as manual_invalid_timestamp (or manual_in_memory_drift)", () => {
    // The schema requires minLength 10, so "not-a-date" (10 chars) passes the schema; the verifier's
    // semantic timestamp check fires.
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.completedAt = "not-a-date";
    const verdict = decide(evidence, dir, { schema: undefined });
    assert.equal(verdict.releaseReady, false);
    const c = codes(verdict);
    assert.ok(c.includes("manual_invalid_timestamp") || c.includes("manual_in_memory_drift"), `expected manual_invalid_timestamp or manual_in_memory_drift in ${c.join(",")}`);
  });

  it("[A2 negative] a step with a non-boolean passed field is rejected as schema (boolean type)", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.steps[2].passed = "yes";
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("schema"));
  });

  it("[A2 negative] an artifact whose declared sha256 disagrees with on-disk bytes is rejected as manual_artifact_hash_mismatch", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    target.artifact.sha256 = "0".repeat(64);
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("manual_artifact_hash_mismatch"));
  });

  it("[A2 negative] an artifact whose on-disk file is missing is rejected as missing_pack", () => {
    const { dir, evidence } = buildValid();
    // The artifact.path is the assembly-assigned slot, so we keep the entry pointing at the right
    // product's filename but delete the on-disk file. The verifier finds the entry by path, then
    // cannot read the bytes and reports `missing_pack` (severity blocked).
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    rmSync(path.join(dir, target.artifact.path));
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_pack"));
  });

  it("[A2 negative] modifying the raw pack file after collection is detected as manual_artifact_hash_mismatch", () => {
    // Reproduces a scenario where someone tampers with results/manual/<product>.json after the runner wrote it.
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    const onDisk = path.join(dir, target.artifact.path);
    const original = readFileSync(onDisk, "utf8");
    writeFileSync(onDisk, original.replace("tester", "rogue-operator"));
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("manual_artifact_hash_mismatch"));
  });

  it("[A2 negative] a raw pack with execution='automated' / transport='cli' / blank operator / year-2040 completedAt is rejected with the matching codes (Codex a2-second review item 4)", () => {
    // This is the exact counterexample Codex reproduced: a runner writes a pack with non-manual
    // execution/transport, a whitespace operator, and a 2040 future timestamp; without the
    // raw-binding rule the verifier used to accept it. Each of these must be surfaced by the
    // raw-file reader, not the in-memory entry, so the synthetic normalized entry cannot launder
    // them away.
    const { dir, evidence } = buildValid();
    const target = evidence.manualClients.find((c) => c.product === "workbuddy");
    const onDisk = path.join(dir, target.artifact.path);
    const forged = {
      product: "workbuddy",
      execution: "automated",
      transport: "cli",
      status: "passed",
      operator: " ",
      completedAt: "2040-01-01T00:00:00.000Z",
      runId: evidence.runId,
      productVersion: "1.0.0",
      notes: "codex counterexample",
      steps: [
        { id: "M-01", passed: true, evidencePath: target.steps[0].evidencePath, evidenceSha256: target.steps[0].evidenceSha256 },
        { id: "M-02", passed: true, evidencePath: target.steps[1].evidencePath, evidenceSha256: target.steps[1].evidenceSha256 },
        { id: "M-03", passed: true, evidencePath: target.steps[2].evidencePath, evidenceSha256: target.steps[2].evidenceSha256 },
        { id: "M-04", passed: true, evidencePath: target.steps[3].evidencePath, evidenceSha256: target.steps[3].evidenceSha256 },
        { id: "M-05", passed: true, evidencePath: target.steps[4].evidencePath, evidenceSha256: target.steps[4].evidenceSha256 }
      ],
      artifact: { path: target.artifact.path, sha256: "0".repeat(64) }
    };
    writeFileSync(onDisk, `${JSON.stringify(forged)}\n`);
    const verdict = decide(evidence, dir);
    const c = codes(verdict);
    assert.ok(c.includes("manual_wrong_execution"), `expected manual_wrong_execution in ${c.join(",")}`);
    assert.ok(c.includes("manual_wrong_transport"), `expected manual_wrong_transport in ${c.join(",")}`);
    assert.ok(c.includes("manual_empty_operator"), `expected manual_empty_operator in ${c.join(",")}`);
    assert.ok(c.includes("manual_future_timestamp"), `expected manual_future_timestamp in ${c.join(",")}`);
  });
});

describe("A2: production pipeline (loadResults → assemble → verify) works for the documented contract", () => {
  function fullResultsRun() {
    const root = tmp();
    mkdirSync(path.join(root, "results", "art"), { recursive: true });
    mkdirSync(path.join(root, "results", "manual"), { recursive: true });
    const expected = expectedExecutions(inputs.cases, requiredClients);
    const byId = new Map(inputs.cases.map((c) => [c.id, c]));
    const ledger = [];
    const cases = expected.map((key) => {
      const [idPart, rest] = key.split("@");
      const spec = byId.get(idPart);
      const [client, run] = rest ? rest.split("#") : [undefined, undefined];
      const dataCase = spec.assert.includes("real_query") || spec.assert.includes("server_trace");
      const art = path.join("results", "art", `${key.replace(/[@#]/g, "_")}.json`);
      const body = `${JSON.stringify({ key, ok: true })}\n`;
      writeFileSync(path.join(root, art), body);
      const entry = {
        id: idPart, runner: spec.runner, ...(client ? { client, run: Number(run) } : {}), status: "passed",
        startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z",
        ...(dataCase ? { tokenFingerprint: "abcdef123456" } : {}),
        serverTraceIds: dataCase ? [`trace_${key.replace(/[@#]/g, "_")}`] : [],
        queryEventIds: dataCase && spec.assert.includes("real_query") ? ["1"] : [],
        policyVersion: "pv1", contextPolicyVersion: "cv1",
        assertions: spec.assert.map((token) => ({ token, passed: true })),
        artifacts: [{ path: art, sha256: createHash("sha256").update(body).digest("hex") }]
      };
      if (spec.runner === "agent") {
        // A4: per-ask indexed records for EVERY passed agent case (not just dataCase ones). The
        // expected plan comes from the shared registry; this fixture materializes one ask per
        // expected entry with matching agentId/goldKey/expectation.
        const plan = expectedAskPlan(spec) ?? [{ agentId: "e2e_finance", goldKey: null, expectation: "answer", suffix: true }];
        entry.asks = plan.map((askSpec, askIndex) => {
          const ask = {
            runId: "run-test-int",
            instanceId: "inst-int",
            caseId: idPart,
            client,
            run: Number(run),
            askIndex,
            agentId: askSpec.agentId,
            goldKey: askSpec.goldKey ?? null,
            expectation: askSpec.expectation ?? "answer",
            since: "2026-10-18T11:00:00.000Z",
            until: "2026-10-18T11:05:00.000Z",
            traceIds: askIndex === 0 ? entry.serverTraceIds : [`trace_${key.replace(/[@#]/g, "_")}_ask${askIndex}`],
            queryEventIds: askIndex === 0 ? entry.queryEventIds : [],
            tokenFingerprint: askSpec.agentId === "e2e_sales" ? "f1f1f1f1f1f1" : "abcdef123456",
            policyVersion: "pv1",
            contextPolicyVersion: "cv1",
            resultDigest: createHash("sha256").update(`result_${key}_ask${askIndex}`).digest("hex"),
            goldDigest: createHash("sha256").update(`gold_${key}_ask${askIndex}`).digest("hex")
          };
          ledger.push({ caseId: idPart, client, run: Number(run), askIndex, runId: "run-test-int", instanceId: "inst-int", agentId: ask.agentId, tokenFingerprint: ask.tokenFingerprint, traceIds: ask.traceIds, queryEventIds: ask.queryEventIds, policyVersion: "pv1", contextPolicyVersion: "cv1", resultDigest: ask.resultDigest, goldDigest: ask.goldDigest });
          return ask;
        });
        entry.serverTraceIds = [...new Set(entry.asks.flatMap((a) => a.traceIds))];
        entry.queryEventIds = [...new Set(entry.asks.flatMap((a) => a.queryEventIds))];
        entry.tokenFingerprints = [...new Set(entry.asks.map((a) => a.tokenFingerprint))];
        entry.tokenFingerprint = entry.asks[0]?.tokenFingerprint ?? null;
      } else if (dataCase) {
        ledger.push({ caseId: idPart, ...(client ? { client, run: Number(run) } : {}), tokenFingerprint: "abcdef123456", traceIds: entry.serverTraceIds });
      }
      return entry;
    });
    const serverBody = `${JSON.stringify({ contract: "lucy-server-evidence-v1", source: "instance-ledger", cases: ledger })}\n`;
    writeFileSync(path.join(root, "results", "server-evidence.json"), serverBody);

    const runnerDocs = {
      security: { runId: "run-test-int", caseCatalogDigest: inputs.catalogDigest, profileDigest: inputs.profileDigest, fixtureDigest: `sha256:${"f".repeat(64)}`, startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z", cases: cases.filter((c) => c.runner === "security") },
      management: { runId: "run-test-int", caseCatalogDigest: inputs.catalogDigest, profileDigest: inputs.profileDigest, fixtureDigest: `sha256:${"f".repeat(64)}`, startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z", cases: cases.filter((c) => c.runner === "management") },
      agent: {
        runId: "run-test-int", caseCatalogDigest: inputs.catalogDigest, profileDigest: inputs.profileDigest, fixtureDigest: `sha256:${"f".repeat(64)}`,
        startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z",
        clients: requiredClients.map((product) => ({ product, version: "1.0.0", adapterDigest: `sha256:${"d".repeat(64)}`, model: "m", transport: "cli", required: true })),
        serverEvidence: { source: "instance-ledger", path: "results/server-evidence.json", sha256: createHash("sha256").update(serverBody).digest("hex") },
        cases: cases.filter((c) => c.runner === "agent")
      },
      gates: {
        runId: "run-test-int", caseCatalogDigest: inputs.catalogDigest, profileDigest: inputs.profileDigest, fixtureDigest: `sha256:${"f".repeat(64)}`,
        startedAt: "2026-10-18T11:00:00.000Z", finishedAt: "2026-10-18T11:05:00.000Z",
        contextMigrationPending: 0, projectionBacklog: 0, existing: GATES.map((name) => ({ name, status: "passed", imageDigest: IMAGE })),
        cases: cases.filter((c) => c.runner === "gate")
      },
      deployment: { instanceId: "inst-int", topology: "single-replica-k8s", deployedImageDigest: IMAGE },
      provenance: { trusted: true, runner: "protected-1", ciSha: candidate.gitSha }
    };
    for (const [name, doc] of Object.entries(runnerDocs)) {
      writeFileSync(path.join(root, "results", `${name}.json`), `${JSON.stringify(doc)}\n`);
    }
    for (const product of manualClients) {
      writeManualPackIn(root, product, { runId: "run-test-int", completedAt: "2026-10-18T11:00:00.000Z" });
    }
    return { root };
  }

  it("assembleEvidence+verifyRelease accepts a full fresh release run with both documented M-01..M-05 packs", async () => {
    const { root } = fullResultsRun();
    const run = {
      runId: "run-test-int", executionMode: "release", instanceId: "inst-int", fixtureDigest: `sha256:${"f".repeat(64)}`,
      profileDigest: inputs.profileDigest, caseCatalogDigest: inputs.catalogDigest, candidateDigest: IMAGE,
      paths: { runDir: root }
    };
    const { evidence, missing } = assembleEvidence({
      run,
      results: await import("../lib/assemble.mjs").then((m) => m.loadResults(run)),
      candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount: expectedExecutions(inputs.cases, requiredClients).length,
      clientsDoc: inputs.clientsDoc, runDir: root
    });
    // Manual packs were written by writeManualPack; if either is missing the test would already have failed.
    assert.equal(evidence.manualClients.length, manualClients.length);
    for (const mc of evidence.manualClients) {
      assert.ok(mc.artifact.sha256.length === 64, `${mc.product} gets a SHA256 from the assembler`);
      assert.ok(mc.steps.length === 5, `${mc.product} has 5 steps`);
      assert.deepEqual(mc.steps.map((s) => s.id), ["M-01", "M-02", "M-03", "M-04", "M-05"]);
    }
    const verdict = verifyRelease({
      evidence, candidate, ...inputs, findings: healthyFindings(), audit: HEALTHY_AUDIT,
      readFile: fileReaderFor(root), now: NOW, runId: "run-test-int", instanceId: "inst-int", schema: inputs.schema
    });
    assert.deepEqual(verdict.problems, [], `unexpected problems: ${JSON.stringify(verdict.problems)}`);
    assert.equal(verdict.releaseReady, true);
    // Missing-dependencies list should be empty in the positive case.
    assert.ok(!missing.some((m) => /results\/manual\//.test(m)), `no missing manual deps: ${missing.join(",")}`);
  });

  it("a release run with one M pack file deleted on disk is blocked via absent_dependencies (not silently passed)", async () => {
    const { root } = fullResultsRun();
    rmSync(path.join(root, "results", "manual", "cursor.json"));
    const run = {
      runId: "run-test-int", executionMode: "release", instanceId: "inst-int", fixtureDigest: `sha256:${"f".repeat(64)}`,
      profileDigest: inputs.profileDigest, caseCatalogDigest: inputs.catalogDigest, candidateDigest: IMAGE,
      paths: { runDir: root }
    };
    const { evidence, missing } = assembleEvidence({
      run,
      results: await import("../lib/assemble.mjs").then((m) => m.loadResults(run)),
      candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount: expectedExecutions(inputs.cases, requiredClients).length,
      clientsDoc: inputs.clientsDoc, runDir: root
    });
    assert.ok(missing.some((m) => /results\/manual\/cursor\.json: missing_pack/.test(m)), `missing-pack label surfaced: ${missing.join(",")}`);
    const blocker = evidence.manualClients.find((mc) => mc.product === "cursor");
    assert.equal(blocker.status, "blocked");
    assert.deepEqual(blocker.steps, []);
    assert.equal(blocker.problems?.[0], "missing_pack");
  });
});

describe("A7: finishedAt is preserved from the run, not stamped at assembly time", () => {
  it("evidence whose runId disagrees with the verifier's run is rejected as run_id_mismatch", () => {
    const { dir, evidence } = buildValid();
    evidence.runId = "forged-run-9999";
    const verdict = decide(evidence, dir, { runId: "run-test-0001" });
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("run_id_mismatch"));
  });

  it("evidence whose instanceId disagrees with the verifier's run is rejected as instance_id_mismatch", () => {
    const { dir, evidence } = buildValid();
    evidence.environment.instanceId = "forged-inst-9999";
    const verdict = decide(evidence, dir, { instanceId: "inst-1" });
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("instance_id_mismatch"));
  });

  it("a run with no finishedAt on any runner is BLOCKED, not auto-stamped", () => {
    const { dir, evidence } = buildValid();
    evidence.environment.finishedAt = null;
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_finished_at"));
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
    const target = evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "claude-code" && c.run === 1);
    target.queryEventIds = [];
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("missing_query"));
  });

  it("[GATE-01-V07] a fabricated trace id (not in the instance ledger) is not READY", () => {
    const { dir, evidence } = buildValid();
    const target = evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "claude-code" && c.run === 2);
    target.serverTraceIds = ["trace_made_up_by_the_runner"];
    const verdict = decide(evidence, dir);
    assert.equal(verdict.releaseReady, false);
    assert.ok(codes(verdict).includes("trace_not_in_server_evidence"));
    const untrusted = buildValid();
    untrusted.evidence.serverEvidence.source = "runner";
    assert.ok(codes(decide(untrusted.evidence, untrusted.dir)).includes("trace_source_untrusted"));
    const noTrace = buildValid();
    noTrace.evidence.cases.find((c) => c.id === "UX-02-V01" && c.client === "claude-code" && c.run === 1).serverTraceIds = [];
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
    evidence.clients = evidence.clients.filter((c) => c.product !== "claude-code");
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

describe("A4: per-ask indexed evidence (SEC-14-V12 / multi-ask)", () => {
  function buildMultiAsk() {
    // SEC-14-V12 has two distinct asks (denial then answer) with different Agents/Tokens. The
    // ledger must carry one record per askIndex, and the verifier must validate each ask
    // independently. The positive case has correct per-ask binding for both asks.
    const { dir, evidence } = buildValid();
    // Find the agent case that needs per-ask binding. UX-02-V01 is the simplest single-ask case;
    // SEC-14-V12 is the multi-ask case. We override the SEC-14-V12 case entry to add the per-ask
    // records and the matching ledger records.
    const target = evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1);
    const denialAsk = {
      runId: "run-test-0001",
      instanceId: "inst-1",
      caseId: "SEC-14-V12", client: "claude-code", run: 1, askIndex: 0,
      agentId: "e2e_sales", goldKey: null, expectation: "denied",
      since: "2026-10-18T11:00:00.000Z", until: "2026-10-18T11:02:00.000Z",
      traceIds: ["trace_sec14v12_deny"], queryEventIds: [],
      tokenFingerprint: "f1f1f1f1f1f1", policyVersion: "pv1", contextPolicyVersion: "cv1",
      resultDigest: createHash("sha256").update("result_deny").digest("hex"),
      goldDigest: createHash("sha256").update("gold_deny").digest("hex")
    };
    const answerAsk = {
      runId: "run-test-0001",
      instanceId: "inst-1",
      caseId: "SEC-14-V12", client: "claude-code", run: 1, askIndex: 1,
      agentId: "e2e_finance", goldKey: "Q-CAC-28D", expectation: "answer",
      since: "2026-10-18T11:02:00.000Z", until: "2026-10-18T11:05:00.000Z",
      traceIds: ["trace_sec14v12_answer"], queryEventIds: ["q1"],
      tokenFingerprint: "abcdef123456", policyVersion: "pv1", contextPolicyVersion: "cv1",
      resultDigest: createHash("sha256").update("result_answer").digest("hex"),
      goldDigest: createHash("sha256").update("gold_answer").digest("hex")
    };
    target.asks = [denialAsk, answerAsk];
    target.tokenFingerprints = [denialAsk.tokenFingerprint, answerAsk.tokenFingerprint];
    target.tokenFingerprint = answerAsk.tokenFingerprint;
    target.serverTraceIds = [denialAsk.traceIds[0], answerAsk.traceIds[0]];
    target.queryEventIds = answerAsk.queryEventIds;
    target.assertions = [
      { token: "deny", passed: true, detail: "denial acknowledged" },
      { token: "allow_control", passed: true, detail: "answer correct" },
      { token: "no_leak", passed: true, detail: "no canary leak" },
      { token: "server_trace", passed: true, detail: "traces bound" }
    ];
    // Replace the per-ask ledger records for SEC-14-V12. buildValid already created ledger records
    // from the expected plan; this fixture overrides them with explicit per-ask records that carry
    // distinct Agents/Tokens so the verifier can test the binding.
    const ledgerPath = path.join(dir, "results", "server-evidence.json");
    const old = JSON.parse(readFileSync(ledgerPath, "utf8"));
    old.cases = old.cases.filter((c) => !(c.caseId === "SEC-14-V12" && c.client === "claude-code" && c.run === 1));
    old.cases.push(
      { caseId: "SEC-14-V12", client: "claude-code", run: 1, askIndex: 0, runId: "run-test-0001", instanceId: "inst-1", agentId: "e2e_sales", tokenFingerprint: "f1f1f1f1f1f1", traceIds: ["trace_sec14v12_deny"], queryEventIds: [], policyVersion: "pv1", contextPolicyVersion: "cv1", resultDigest: denialAsk.resultDigest, goldDigest: denialAsk.goldDigest },
      { caseId: "SEC-14-V12", client: "claude-code", run: 1, askIndex: 1, runId: "run-test-0001", instanceId: "inst-1", agentId: "e2e_finance", tokenFingerprint: "abcdef123456", traceIds: ["trace_sec14v12_answer"], queryEventIds: ["q1"], policyVersion: "pv1", contextPolicyVersion: "cv1", resultDigest: answerAsk.resultDigest, goldDigest: answerAsk.goldDigest }
    );
    const newBody = `${JSON.stringify(old, null, 2)}\n`;
    writeFileSync(ledgerPath, newBody);
    const newSha = createHash("sha256").update(newBody).digest("hex");
    evidence.serverEvidence = { source: "instance-ledger", path: "results/server-evidence.json", sha256: newSha };
    return { dir, evidence, target, denialAsk, answerAsk };
  }

  it("[A4 positive] a multi-ask case with distinct Agents/Tokens per ask passes", () => {
    const { dir, evidence } = buildMultiAsk();
    const verdict = decide(evidence, dir);
    assert.deepEqual(verdict.problems, [], `unexpected problems: ${JSON.stringify(verdict.problems)}`);
  });

  it("[A4 negative] a duplicate askIndex is rejected", () => {
    const { dir, evidence, denialAsk, answerAsk } = buildMultiAsk();
    evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1).asks[1].askIndex = 0;
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_duplicate_index"));
  });

  it("[A4 negative] a wrong ask runId is rejected", () => {
    const { dir, evidence } = buildMultiAsk();
    evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1).asks[0].runId = "forged-run-9999";
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_run_mismatch"));
  });

  it("[A4 negative] an ask with a token fingerprint that disagrees with the per-ask ledger record is rejected", () => {
    const { dir, evidence } = buildMultiAsk();
    evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1).asks[1].tokenFingerprint = "000000000000";
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_fingerprint_mismatch"));
  });

  it("[A4 negative] a top-level serverTraceId that is not in any per-ask record is rejected as cross-ask union laundering", () => {
    const { dir, evidence } = buildMultiAsk();
    const target = evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1);
    target.serverTraceIds = ["trace_sec14v12_deny", "trace_sec14v12_answer", "trace_laundered_from_another_case"];
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_trace_laundered"));
  });

  it("[A4 negative] a top-level tokenFingerprint that is not in any per-ask record is rejected", () => {
    const { dir, evidence } = buildMultiAsk();
    const target = evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1);
    target.tokenFingerprints = ["abcdef123456", "f1f1f1f1f1f1", "999999999999"];
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_fingerprint_laundered"));
  });

  it("[A4 negative] an ask with no per-ask ledger record is rejected", () => {
    const { dir, evidence } = buildMultiAsk();
    const target = evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1);
    // Replace the recorded asks with one that has no matching ledger record. The frozen plan has
    // 2 asks; we record 1 ask whose askIndex (99) has no ledger entry. Either ask_not_in_ledger or
    // ask_count_mismatch surfaces the problem.
    target.asks = [{
      runId: "run-test-0001", instanceId: "inst-1", caseId: "SEC-14-V12", client: "claude-code", run: 1, askIndex: 99,
      agentId: "e2e_finance", goldKey: null, expectation: "answer",
      since: "2026-10-18T11:00:00.000Z", until: "2026-10-18T11:05:00.000Z",
      traceIds: ["trace_unknown"], queryEventIds: [],
      tokenFingerprint: "abcdef123456", policyVersion: "pv1", contextPolicyVersion: "cv1",
      resultDigest: createHash("sha256").update("result_unknown").digest("hex"),
      goldDigest: createHash("sha256").update("gold_unknown").digest("hex")
    }];
    target.tokenFingerprints = ["abcdef123456"];
    target.tokenFingerprint = "abcdef123456";
    target.serverTraceIds = ["trace_unknown"];
    target.queryEventIds = [];
    const verdict = decide(evidence, dir);
    const cs = codes(verdict);
    assert.ok(cs.includes("ask_not_in_ledger") || cs.includes("ask_count_mismatch"), `expected ask_not_in_ledger or ask_count_mismatch in ${cs.join(",")}`);
  });

  it("[A4 negative] an ask with since > until (inverted time window) is rejected", () => {
    const { dir, evidence } = buildMultiAsk();
    const ask = evidence.cases.find((c) => c.id === "SEC-14-V12" && c.client === "claude-code" && c.run === 1).asks[0];
    ask.since = "2026-10-18T11:05:00.000Z";
    ask.until = "2026-10-18T11:00:00.000Z";
    const verdict = decide(evidence, dir);
    assert.ok(codes(verdict).includes("ask_time_inverted"));
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
    // After A7: the source tree is copied under outDir/results/ so loadResults(archiveDir) finds
    // results/*.json at the canonical location. The tamper test must therefore edit the
    // archived copy at results/a.json, not the legacy root a.json.
    writeFileSync(path.join(out, "results", "a.json"), '{"ok":false}\n');
    assert.ok(verifyArchive(out, publicPem).problems.some((p) => /modified after signing/.test(p)));
    writeFileSync(path.join(out, "results", "extra.json"), "{}");
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
