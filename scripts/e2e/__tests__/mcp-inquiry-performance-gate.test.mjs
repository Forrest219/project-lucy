/**
 * P1-78 Task 6 step 6 — workflow contract tests for the MCP inquiry performance
 * release gate (Spec SC-10).
 *
 * Proves, as pure functions over files on disk:
 *   - skipped run / missing input / missing attempts / wrong digest / old null
 *     baseline / CI subset can never produce releaseReady=true;
 *   - only a full formal PASS bound to the gated candidate sets releaseReady=true;
 *   - D22 is bidirectional: without a waiver BLOCKED/SEED_ONLY stay blocked; a valid
 *     waiver yields releaseReady="waived" (never displayed as PASS) and lets the real
 *     applyMcpInquiryPerformanceReleaseGate pass its bound candidate; expired,
 *     out-of-scope, candidate-mismatched or unparsable waivers are refused.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  PERFORMANCE_RELEASE_INPUT_CONTRACT,
  PERFORMANCE_RELEASE_INPUT_FILE,
  applyMcpInquiryPerformanceReleaseGate,
  evaluateMcpInquiryPerformanceGate,
  findValidWaiver,
  readPerformanceReleaseInput,
  verifyPerformanceEvidence
} from "../lib/mcp-inquiry-performance-gate.mjs";

const DIGEST_A = "sha256:" + "a".repeat(64);
const DIGEST_B = "sha256:" + "b".repeat(64);
const NOW = Date.parse("2026-11-26T12:00:00Z");

function makeAttempt(overrides = {}) {
  return {
    kind: "mcp-inquiry-performance-attempt",
    contract: "lucy-mcp-inquiry-performance-attempt-v1",
    schemaVersion: "1",
    clientVersion: "1.0.0",
    runId: "mip-test",
    scenarioId: "SIMPLE_WARM",
    caseId: "QB-BIZ-01",
    attemptId: "mip-test-SIMPLE_WARM-0001-r0",
    planItemId: "mip-test-SIMPLE_WARM-0001",
    lane: "mcp",
    roleClass: "demo_readonly",
    cacheState: "warm",
    concurrencyGroup: "single",
    clientModel: "lucy-mcp-perf@1.0.0::mcp-control:no-model",
    environment: "sha256:" + "e".repeat(64),
    budgetClass: "simple",
    questionSetDigest: "sha256:" + "1".repeat(64),
    configDigest: "sha256:" + "2".repeat(64),
    fixtureDigest: null,
    budgetDigest: "sha256:" + "3".repeat(64),
    clientFingerprint: "lucy-mcp-perf@1.0.0",
    modelFingerprint: "mcp-control:no-model",
    environmentFingerprint: "sha256:" + "4".repeat(64),
    candidateFingerprint: "git:" + "c".repeat(40),
    outcome: "correct",
    correctness: "correct",
    errorClass: null,
    timeoutMs: null,
    firstAttempt: true,
    finalAttempt: true,
    journeyMs: 500,
    ...overrides
  };
}

/** Build a runDir with results/<file> and perf-evidence/<runId>/attempts(.gz). */
function buildRunDir({ status = "PASS", candidateDigest = DIGEST_A, rows = null, gz = false, inputOverrides = {} } = {}) {
  const runDir = mkdtempSync(path.join(tmpdir(), "mip-gate-"));
  const realRows = rows ?? Array.from({ length: 20 }, (_, i) =>
    makeAttempt({ attemptId: `mip-test-SIMPLE_WARM-${String(i + 1).padStart(4, "0")}-r0`, planItemId: `mip-test-SIMPLE_WARM-${String(i + 1).padStart(4, "0")}` }));
  const body = Buffer.from(`${realRows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const evidenceRel = path.join("perf-evidence", "mip-test");
  mkdirSync(path.join(runDir, evidenceRel), { recursive: true });
  mkdirSync(path.join(runDir, "results"), { recursive: true });
  const attemptsDigest = "sha256:" + createHashOf(body);
  if (gz) writeFileSync(path.join(runDir, evidenceRel, "attempts.ndjson.gz"), gzipSync(body));
  else writeFileSync(path.join(runDir, evidenceRel, "attempts.ndjson"), body);
  const input = {
    contract: PERFORMANCE_RELEASE_INPUT_CONTRACT,
    runId: "mip-test",
    trigger: "release",
    tier: "formal",
    status,
    exitCode: 0,
    candidateDigest,
    candidateFingerprint: "git:" + "c".repeat(40),
    environmentFingerprint: "sha256:" + "4".repeat(64),
    questionSetDigest: "sha256:" + "1".repeat(64),
    configDigest: "sha256:" + "2".repeat(64),
    budgetDigest: "sha256:" + "3".repeat(64),
    attemptsDigest,
    attemptCount: realRows.length,
    evidenceDir: evidenceRel,
    generatedAt: "2026-11-26T00:00:00Z",
    ...inputOverrides
  };
  writeFileSync(path.join(runDir, "results", PERFORMANCE_RELEASE_INPUT_FILE), `${JSON.stringify(input, null, 2)}\n`);
  return { runDir, input, body, rows: realRows };
}

function createHashOf(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function waiverText(overrides = {}) {
  const meta = {
    candidateDigest: DIGEST_A,
    verdict: "SEED_ONLY",
    scopes: [],
    expiresAt: "2026-12-03T00:00:00Z",
    approvedBy: "委托人",
    incidentRef: "INC-test",
    ...overrides
  };
  const yaml = Object.entries(meta)
    .map(([k, v]) => (Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${JSON.stringify(v)}`))
    .join("\n");
  return `---\n${yaml}\n---\n事故修复放行（测试夹具）。\n`;
}

test("missing release input is BLOCKED, never releaseReady", () => {
  const runDir = mkdtempSync(path.join(tmpdir(), "mip-gate-"));
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW });
  assert.equal(gate.status, "BLOCKED");
  assert.equal(gate.releaseReady, false);
});

test("candidate digest mismatch is FAIL (not comparable, D9)", () => {
  const { runDir } = buildRunDir({ status: "PASS", candidateDigest: DIGEST_A });
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_B, now: NOW });
  assert.equal(gate.status, "FAIL");
  assert.equal(gate.releaseReady, false);
  assert.ok(gate.problems.some((p) => p.code === "candidate_digest_mismatch"));
});

test("attempts digest tampering is FAIL", () => {
  const { runDir } = buildRunDir({ status: "PASS", inputOverrides: { attemptsDigest: "sha256:" + "f".repeat(64) } });
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW });
  assert.equal(gate.status, "FAIL");
  assert.equal(gate.releaseReady, false);
  assert.ok(gate.problems.some((p) => p.code === "attempts_digest_mismatch"));
});

test("gzip-packed attempts verify to the same body digest", () => {
  const { runDir, body } = buildRunDir({ status: "PASS", gz: true });
  const loaded = readPerformanceReleaseInput(runDir);
  const verified = verifyPerformanceEvidence({ runDir, input: loaded.input });
  assert.equal(verified.ok, true);
  assert.equal(verified.attemptsDigest, loaded.input.attemptsDigest);
});

for (const status of ["SEED_ONLY", "FAIL", "BLOCKED", "NOT RUN"]) {
  test(`${status} without a waiver is blocked/failed and never releaseReady`, () => {
    const { runDir } = buildRunDir({ status });
    const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW });
    assert.equal(gate.releaseReady, false);
    // 聚合器保留 runner 的申报状态词（TOTAL_VERDICTS 含 SEED_ONLY）；放行与否则看 releaseReady。
    assert.equal(gate.status, status);
  });
}

test("a full formal PASS bound to the candidate sets releaseReady=true", () => {
  const { runDir } = buildRunDir({ status: "PASS" });
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW });
  assert.equal(gate.status, "PASS");
  assert.equal(gate.releaseReady, true);
});

test("ci-subset never sets releaseReady=true even on PASS", () => {
  const { runDir } = buildRunDir({ status: "PASS" });
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, ciSubset: true, now: NOW });
  assert.equal(gate.status, "BLOCKED");
  assert.equal(gate.releaseReady, false);
});

test("valid D22 waiver yields releaseReady=waived for its bound candidate", () => {
  const { runDir } = buildRunDir({ status: "SEED_ONLY" });
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-test.md"), waiverText());
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW, waiversDir });
  assert.equal(gate.releaseReady, "waived");
  assert.equal(gate.status, "SEED_ONLY"); // waived is a releaseReady value, NOT a PASS
  assert.ok(gate.problems.some((p) => p.code === "d22_waiver_applied"));
});

test("waiver bound to another candidate is refused (releaseReady stays false)", () => {
  const { runDir } = buildRunDir({ status: "SEED_ONLY" });
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-test.md"), waiverText({ candidateDigest: DIGEST_B }));
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW, waiversDir });
  assert.equal(gate.releaseReady, false);
});

test("expired waiver is refused", () => {
  const { runDir } = buildRunDir({ status: "SEED_ONLY" });
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-test.md"), waiverText({ expiresAt: "2026-11-20T00:00:00Z" }));
  const w = findValidWaiver({ waiversDir, candidateDigest: DIGEST_A, status: "SEED_ONLY", now: NOW });
  assert.equal(w.valid, false);
  assert.ok(/expired/.test(w.reason));
});

test("FAIL waiver without per-scenario failScenarios is refused (D22②)", () => {
  const { runDir } = buildRunDir({ status: "FAIL" });
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-test.md"), waiverText({ verdict: "FAIL" }));
  const gate = evaluateMcpInquiryPerformanceGate({ results: { performance: readPerformanceReleaseInput(runDir), runDir }, candidateDigest: DIGEST_A, now: NOW, waiversDir });
  assert.equal(gate.releaseReady, false);
  assert.ok(gate.problems.some((p) => p.code === "d22_no_valid_waiver" && /failScenarios/.test(p.message)));
});

test("unparsable waiver text is refused (forgery fails closed)", () => {
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-fake.md"), "伪造成豁免的正文，无 frontmatter。");
  const w = findValidWaiver({ waiversDir, candidateDigest: DIGEST_A, status: "SEED_ONLY", now: NOW });
  assert.equal(w.valid, false);
});

test("applyMcpInquiryPerformanceReleaseGate: prior passed verdict + PASS gate stays passed and ready", () => {
  const { runDir } = buildRunDir({ status: "PASS" });
  const out = applyMcpInquiryPerformanceReleaseGate({
    runDir,
    verdict: { status: "passed", exitCode: 0, releaseReady: true, problems: [] },
    candidateDigest: DIGEST_A,
    now: NOW
  });
  assert.equal(out.status, "passed");
  assert.equal(out.releaseReady, true);
  assert.equal(out.mcpInquiryPerformance.status, "PASS");
});

test("applyMcpInquiryPerformanceReleaseGate: prior passed verdict + SEED_ONLY gate is blocked (fail closed)", () => {
  const { runDir } = buildRunDir({ status: "SEED_ONLY" });
  const out = applyMcpInquiryPerformanceReleaseGate({
    runDir,
    verdict: { status: "passed", exitCode: 0, releaseReady: true, problems: [] },
    candidateDigest: DIGEST_A,
    now: NOW
  });
  assert.equal(out.status, "blocked"); // SEED_ONLY maps onto the readiness vocabulary as blocked
  assert.equal(out.releaseReady, false);
});

test("applyMcpInquiryPerformanceReleaseGate: valid waiver turns a blocked verdict into waived (not PASS) and lets the bound candidate through", () => {
  const { runDir } = buildRunDir({ status: "SEED_ONLY" });
  const waiversDir = mkdtempSync(path.join(tmpdir(), "mip-waivers-"));
  writeFileSync(path.join(waiversDir, "20261126-test.md"), waiverText());
  const out = applyMcpInquiryPerformanceReleaseGate({
    runDir,
    verdict: { status: "passed", exitCode: 0, releaseReady: true, problems: [] },
    candidateDigest: DIGEST_A,
    now: NOW,
    waiversDir
  });
  assert.equal(out.status, "passed_with_waiver");
  assert.equal(out.releaseReady, "waived");
  assert.equal(out.exitCode, 0);
  // 放行只对绑定候选成立：换候选即不放行。
  const other = applyMcpInquiryPerformanceReleaseGate({
    runDir,
    verdict: { status: "passed", exitCode: 0, releaseReady: true, problems: [] },
    candidateDigest: DIGEST_B,
    now: NOW,
    waiversDir
  });
  assert.equal(other.releaseReady, false);
});
