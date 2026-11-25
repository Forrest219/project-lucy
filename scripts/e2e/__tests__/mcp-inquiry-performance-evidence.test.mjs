/**
 * P1-78 Task 2 — MCP inquiry performance evidence / baseline / independent
 * verifier tests.
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D3, D6, D8, D9, D10, D12, D15, D22, §4.2, §4.3, §6.1, §6.2, §6.3)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 2
 *
 * Every Plan Task 2 step 3 negative control has its own test name:
 *   delete one failure / change one RTT / hand-filled P95 / forged top-level
 *   PASS / changed question-set, client, model and fixture digests / duplicate
 *   attemptId / missing final answer / summary-vs-body digest mismatch, plus
 *   the D22 waiver negative controls.
 */

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  BASELINE_CONTRACT,
  BASELINE_POINTER_CONTRACT,
  EVIDENCE_CONTRACT,
  NEGATIVE_CONTROLS_CONTRACT,
  acceptBaseline,
  assertPrivatePermissions,
  buildBaselineCandidate,
  computeWaiverDigest,
  ensurePrivateDir,
  redactEvidence,
  scanEvidenceForLeaks,
  sha256Hex,
  validateAttempt,
  validateAttempts,
  validateBaseline,
  validateLatestPointer,
  validateSummary,
  verifyEvidenceBundle,
  verifyWaiverFile,
  writeBaselineCandidate,
  writeEvidenceBundle,
  writeFileAtomic
} from "../lib/mcp-inquiry-performance-evidence.mjs";

// ---------------------------------------------------------------------------
// constants and fixture helpers
// ---------------------------------------------------------------------------

const RUN_ID = "run-20261126-001";
const CANDIDATE = "sha256:candidate-v1";
const DIGESTS = Object.freeze({
  questionSetDigest: "sha256:questionset-v1",
  configDigest: "sha256:config-v1",
  fixtureDigest: "sha256:fixture-v1",
  budgetDigest: "sha256:budget-v1",
  clientFingerprint: "sha256:client-v1",
  modelFingerprint: "sha256:model-v1",
  environmentFingerprint: "sha256:env-v1"
});
const CLIENT_MODEL = "kimi-code/model-x";
const ENVIRONMENT = "docker-local";
const CONCURRENCY = "single";
const CACHE_STATE = "warm";

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), "mip-evidence-"));
}

/** Independent nearest-rank / median so the fixture never borrows the judge. */
function nearestRankExp(sorted, p) {
  return sorted[Math.ceil((p / 100) * sorted.length) - 1];
}
function medianExp(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

let seq = 0;
function baseAttempt(over = {}) {
  seq += 1;
  return {
    runId: RUN_ID,
    scenarioId: "SIMPLE",
    caseId: "QB-BIZ-01",
    attemptId: `att-${seq}`,
    planItemId: `plan-${seq}`,
    retryOf: null,
    retryOfMissingReason: "first attempt, no retry",
    traceId: `trace-${seq}`,
    traceIdMissingReason: null,
    rpcRequestId: `rpc-${seq}`,
    rpcRequestIdMissingReason: null,
    lane: "mcp",
    roleClass: "readonly",
    cacheState: CACHE_STATE,
    concurrencyGroup: CONCURRENCY,
    clientModel: CLIENT_MODEL,
    environment: ENVIRONMENT,
    budgetClass: "simple",
    questionSetDigest: DIGESTS.questionSetDigest,
    configDigest: DIGESTS.configDigest,
    fixtureDigest: DIGESTS.fixtureDigest,
    budgetDigest: DIGESTS.budgetDigest,
    clientFingerprint: DIGESTS.clientFingerprint,
    modelFingerprint: DIGESTS.modelFingerprint,
    environmentFingerprint: DIGESTS.environmentFingerprint,
    outcome: "correct",
    correctness: "correct",
    errorClass: null,
    timeoutMs: null,
    firstAttempt: true,
    finalAttempt: true,
    questionStartedAt: "2026-11-26T00:00:00.000Z",
    firstObservableMs: 120,
    firstTokenMs: "not_available",
    firstCorrectResultMs: 800,
    finalCorrectAnswerMs: 900,
    turnWallClockMs: 1_000,
    initializeMs: 100,
    journeyMs: 1_000,
    unattributedMs: 50,
    mcpCalls: [],
    stages: [],
    ...over
  };
}

function mcpAttempt(over = {}) {
  return baseAttempt(over);
}

function agentAttempt(over = {}) {
  return baseAttempt({
    lane: "agent",
    finalAnswerReceived: true,
    audit: { reconciled: true, failedCallsThisTurn: 0 },
    ...over
  });
}

/**
 * A complete formal run: MCP simple + MCP denial (with the legal control) and
 * the real Agent lane.
 */
function buildAttempts({
  simpleN = 100,
  denialN = 100,
  agentN = 20,
  base = 1_000,
  agentBase = 5_000,
  failAgentIndex = null,
  onlySimple = false
} = {}) {
  const attempts = [];
  for (let i = 0; i < simpleN; i += 1) {
    attempts.push(
      mcpAttempt({
        scenarioId: "SIMPLE",
        caseId: "QB-BIZ-01",
        attemptId: `simple-${i}`,
        planItemId: `simple-${i}`,
        budgetClass: "simple",
        journeyMs: base + i,
        firstCorrectResultMs: base + i - 200
      })
    );
  }
  for (let i = 0; i < (onlySimple ? 0 : denialN); i += 1) {
    attempts.push(
      mcpAttempt({
        scenarioId: "DENIAL",
        caseId: "QB-ACL-01",
        attemptId: `deny-${i}`,
        planItemId: `deny-${i}`,
        budgetClass: "denial",
        outcome: "denied",
        correctness: "correct",
        journeyMs: 100 + i,
        firstCorrectResultMs: 90
      })
    );
  }
  for (let i = 0; i < (onlySimple ? 0 : agentN); i += 1) {
    const over = {
      scenarioId: "AGENT_SIMPLE",
      caseId: "QB-BIZ-01",
      attemptId: `agent-${i}`,
      planItemId: `agent-${i}`,
      lane: "agent",
      budgetClass: "simple",
      turnWallClockMs: agentBase + i,
      finalCorrectAnswerMs: agentBase + i,
      finalAnswerReceived: true,
      audit: { reconciled: true, failedCallsThisTurn: 0 }
    };
    if (failAgentIndex === i) {
      over.outcome = "wrong_answer";
      over.correctness = "incorrect";
      over.errorClass = "wrong_answer";
    }
    attempts.push(agentAttempt(over));
  }
  return attempts;
}

/** The runner's own claim — computed independently from the raw attempts. */
function expectedScenarioEntry(list) {
  const lat = list
    .map((a) => (a.lane === "agent" ? a.finalCorrectAnswerMs : a.journeyMs))
    .filter((v) => Number.isFinite(v))
    .sort((x, y) => x - y);
  const n = lat.length;
  const correct = list.filter((a) => ["correct", "denied", "allowed"].includes(a.outcome)).length;
  const timeout = list.filter((a) => a.outcome === "timeout").length;
  const failed = list.filter((a) => !["correct", "denied", "allowed", "missing_evidence"].includes(a.outcome)).length;
  const failedOutcome = list.some((a) => a.outcome === "wrong_answer");
  return {
    scenarioId: list[0].scenarioId,
    lane: list[0].lane,
    cacheState: list[0].cacheState,
    concurrencyGroup: list[0].concurrencyGroup,
    clientModel: list[0].clientModel,
    environment: list[0].environment,
    budgetClass: list[0].budgetClass,
    plannedCount: list.length,
    sampleCount: n,
    correctCount: correct,
    failedCount: failed,
    timeoutCount: timeout,
    p50Ms: n ? nearestRankExp(lat, 50) : null,
    p95Ms: n >= 20 ? nearestRankExp(lat, 95) : "not_estimable",
    p99Ms: n >= 100 ? nearestRankExp(lat, 99) : "not_estimable",
    medianMs: n ? medianExp(lat) : null,
    maxMs: n ? lat[lat.length - 1] : null,
    absoluteVerdict: "PASS",
    relativeVerdict: "PASS",
    verdict: failedOutcome ? "FAIL" : "PASS"
  };
}

function buildSummary(attempts, { runId = RUN_ID, relativeVerdict = "PASS", status = "PASS", releaseReady = true } = {}) {
  const scenarioIds = [...new Set(attempts.map((a) => a.scenarioId))];
  const scenarios = scenarioIds.map((sid) => {
    const entry = expectedScenarioEntry(attempts.filter((a) => a.scenarioId === sid));
    return { ...entry, relativeVerdict };
  });
  return {
    contract: EVIDENCE_CONTRACT,
    runId,
    trigger: "nightly",
    tier: "formal",
    generatedAt: "2026-11-26T01:00:00.000Z",
    candidateFingerprint: CANDIDATE,
    environmentFingerprint: DIGESTS.environmentFingerprint,
    questionSetDigest: DIGESTS.questionSetDigest,
    configDigest: DIGESTS.configDigest,
    fixtureDigest: DIGESTS.fixtureDigest,
    budgetDigest: DIGESTS.budgetDigest,
    clientFingerprint: DIGESTS.clientFingerprint,
    modelFingerprint: DIGESTS.modelFingerprint,
    questionSetVersion: "qs-v1",
    environmentProfile: ENVIRONMENT,
    clientModelHash: "cmh-v1",
    gitSha: "abc1234",
    legalControls: scenarioIds.includes("DENIAL")
      ? [{ denialScenarioId: "DENIAL", controlScenarioId: "SIMPLE" }]
      : [],
    scenarios,
    status,
    releaseReady
  };
}

function negativeControls(runId = RUN_ID) {
  return {
    contract: NEGATIVE_CONTROLS_CONTRACT,
    runId,
    controls: [
      {
        id: "double-latency",
        kind: "2x-latency",
        scenarioId: "SIMPLE",
        expected: "FAIL",
        observed: "FAIL",
        detected: true,
        detail: "2x latency injection was rejected by the absolute budget gate"
      },
      {
        id: "drop-failed-attempt",
        kind: "drop-failed-attempt",
        scenarioId: "SIMPLE",
        expected: "FAIL",
        observed: "FAIL",
        detected: true,
        detail: "removing one failed attempt was detected by the denominator check"
      }
    ],
    allDetected: true
  };
}

/** Write a complete, self-consistent evidence bundle. */
function writeBundle(dir, { attempts, summary, controls = negativeControls() }) {
  const written = writeEvidenceBundle({ evidenceDir: dir, attempts, summary, negativeControls: controls });
  return { ...written, summary: written.summary, attempts };
}

/** Rewrite a bundle after tampering, keeping the recorded body digest consistent. */
function rewriteBundle(dir, { attempts, summary }) {
  const body = `${attempts.map((a) => JSON.stringify(a)).join("\n")}\n`;
  const next = { ...summary, evidenceBodyDigest: sha256Hex(body) };
  writeFileSync(path.join(dir, "attempts.ndjson"), body);
  writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Build and accept a baseline from a slower previous run. */
function acceptedBaselineFor(dir, { base = 900, agentBase = 4_500, onlySimple = false } = {}) {
  const prevDir = path.join(dir, "previous-run");
  const prevAttempts = buildAttempts({ base, agentBase, onlySimple });
  const prevSummary = buildSummary(prevAttempts, {
    runId: "run-20261125-000",
    relativeVerdict: "SEED_ONLY",
    status: "SEED_ONLY",
    releaseReady: false
  });
  const written = writeEvidenceBundle({
    evidenceDir: prevDir,
    attempts: prevAttempts,
    summary: prevSummary,
    negativeControls: negativeControls("run-20261125-000")
  });
  const candidate = buildBaselineCandidate({
    summary: written.summary,
    attempts: prevAttempts,
    evidenceBodyDigest: written.attemptsDigest
  });
  const baselinesDir = path.join(dir, "baselines");
  const accepted = acceptBaseline({
    baselinesDir,
    baseline: candidate,
    acceptedBy: "委托人",
    acceptedAt: "2026-11-26T02:00:00.000Z"
  });
  return { baselinesDir, candidate, accepted, prevDir };
}

function waiverDoc(over = {}) {
  const waiver = {
    id: "20261126-001",
    candidateDigest: CANDIDATE,
    reason: "客户事故修复必须出包",
    issuedAt: "2026-11-26T00:00:00.000Z",
    expiresAt: "2026-11-30T00:00:00.000Z",
    makeupPlan: "在后继候选上补跑正式门禁并 PASS",
    approvedBy: "委托人",
    scenarios: [{ scenarioId: "AGENT_SIMPLE", verdict: "BLOCKED" }],
    ...over
  };
  return { ...waiver, waiverDigest: computeWaiverDigest(waiver) };
}

function waiverFile(waiver) {
  return `# 豁免记录 ${waiver.id}\n\n\`\`\`json\n${JSON.stringify(waiver, null, 2)}\n\`\`\`\n`;
}

const NOW = Date.parse("2026-11-26T12:00:00.000Z");

function codes(result) {
  return result.problems.map((p) => p.code);
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

describe("evidence schema (Spec §4.3 / §6.2)", () => {
  test("an attempt without a required field is rejected", () => {
    const attempt = buildAttempts({ simpleN: 1, denialN: 0, agentN: 0 })[0];
    delete attempt.questionSetDigest;
    const validation = validateAttempt(attempt);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "SCHEMA_INVALID"));
    assert.ok(validation.problems.some((p) => /questionSetDigest/.test(p.message)));
  });

  test("an identity field that is absent without a missing reason is rejected", () => {
    const attempt = buildAttempts({ simpleN: 1, denialN: 0, agentN: 0 })[0];
    attempt.traceId = null;
    attempt.traceIdMissingReason = null;
    const validation = validateAttempt(attempt);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => /traceId/.test(p.message)));
  });

  test("an agent attempt without a completed final answer is rejected", () => {
    const attempt = agentAttempt({ finalAnswerReceived: false });
    const validation = validateAttempt(attempt);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "MISSING_FINAL_ANSWER"));
  });

  test("a BLOCKED stub record passes validation and raises no failed-level problem", () => {
    // The host was unavailable / does not support multi-turn / the question
    // reference could not be resolved: no final answer could exist at all.
    // D19/D15 ask for BLOCKED, never FAIL.
    const stub = agentAttempt({
      finalAnswerReceived: false,
      blocked: true,
      blockedReason: "host_unavailable",
      outcome: "missing_evidence",
      correctness: "unknown"
    });
    const validation = validateAttempt(stub);
    assert.equal(validation.ok, true, JSON.stringify(validation.problems));
    assert.equal(
      validation.problems.filter((p) => p.severity === "failed").length,
      0,
      "a BLOCKED stub must not produce a failed-level problem"
    );
    assert.equal(validation.problems.length, 0);
  });

  test("a real attempt with tool results but no final answer is still failed", () => {
    const attempt = agentAttempt({
      finalAnswerReceived: false,
      mcpCalls: [{ method: "lucy_query", resultCount: 1 }]
    });
    const validation = validateAttempt(attempt);
    assert.equal(validation.ok, false);
    const failed = validation.problems.filter((p) => p.severity === "failed");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].code, "MISSING_FINAL_ANSWER");
  });

  test("the BLOCKED-stub narrowing needs both the blocked flag and a reason", () => {
    const attempt = agentAttempt({ finalAnswerReceived: false, blocked: true });
    const validation = validateAttempt(attempt);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "MISSING_FINAL_ANSWER"));
  });

  test("a summary without the evidence body digest is rejected", () => {
    const summary = buildSummary(buildAttempts());
    delete summary.evidenceBodyDigest;
    const validation = validateSummary(summary);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => /evidenceBodyDigest/.test(p.message)));
  });

  test("a duplicate attemptId is rejected", () => {
    const attempts = buildAttempts({ simpleN: 2, denialN: 0, agentN: 0 });
    attempts[1].attemptId = attempts[0].attemptId;
    const validation = validateAttempts(attempts);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "DUPLICATE_ATTEMPT_ID"));
  });

  test("a baseline whose p95Ms is null is rejected", () => {
    const baseline = {
      contract: BASELINE_CONTRACT,
      questionSetVersion: "qs-v1",
      environmentProfile: ENVIRONMENT,
      clientModelHash: "cmh-v1",
      gitSha: "abc1234",
      status: "PASS",
      releaseReady: true,
      acceptedBy: "委托人",
      acceptedAt: "2026-11-26T02:00:00.000Z",
      evidenceBodyDigest: "sha256:body",
      scenarios: [
        {
          scenarioId: "SIMPLE",
          cacheState: CACHE_STATE,
          concurrencyGroup: CONCURRENCY,
          budgetClass: "simple",
          sampleCount: 100,
          correctCount: 100,
          failedCount: 0,
          timeoutCount: 0,
          p50Ms: 100,
          p95Ms: null,
          p99Ms: 120,
          medianMs: 100,
          maxMs: 130,
          questionSetDigest: DIGESTS.questionSetDigest,
          configDigest: DIGESTS.configDigest,
          fixtureDigest: DIGESTS.fixtureDigest,
          budgetDigest: DIGESTS.budgetDigest,
          candidateFingerprint: CANDIDATE,
          environmentFingerprint: DIGESTS.environmentFingerprint,
          clientFingerprint: DIGESTS.clientFingerprint,
          modelFingerprint: DIGESTS.modelFingerprint,
          evidenceBodyDigest: "sha256:body",
          acceptedBy: "委托人",
          acceptedAt: "2026-11-26T02:00:00.000Z"
        }
      ]
    };
    const validation = validateBaseline(baseline);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "BASELINE_VALUE_MISSING" && /p95Ms/.test(p.message)));
  });

  test("a baseline keeps p99 not_estimable below 100 samples", () => {
    const dir = tmpDir();
    const { accepted } = acceptedBaselineFor(dir);
    const agent = accepted.baseline.scenarios.find((s) => s.scenarioId === "AGENT_SIMPLE");
    assert.equal(agent.sampleCount, 20);
    assert.equal(agent.p99Ms, "not_estimable");
    assert.equal(typeof agent.p95Ms, "number");
    const simple = accepted.baseline.scenarios.find((s) => s.scenarioId === "SIMPLE");
    assert.equal(simple.sampleCount, 100);
    assert.equal(typeof simple.p99Ms, "number");
  });
});

// ---------------------------------------------------------------------------
// atomic writes, private permissions, redaction
// ---------------------------------------------------------------------------

describe("atomic writes and private credentials", () => {
  test("a failed atomic write leaves the previous file untouched and no temp file behind", () => {
    const dir = tmpDir();
    const target = path.join(dir, "evidence", "summary.json");
    writeFileAtomic(target, '{"ok":true}\n');
    assert.throws(() =>
      writeFileAtomic(target, () => {
        throw new Error("serialization failed");
      })
    );
    assert.equal(readFileSync(target, "utf8"), '{"ok":true}\n');
    const leftovers = readdirSync(path.dirname(target)).filter((f) => f.includes(".tmp"));
    assert.deepEqual(leftovers, []);
  });

  test("an atomic write publishes the complete content and leaves no temp file", () => {
    const dir = tmpDir();
    const target = path.join(dir, "evidence", "attempts.ndjson");
    const body = `${Array.from({ length: 5 }, (_, i) => JSON.stringify({ attemptId: `a${i}` })).join("\n")}\n`;
    const written = writeFileAtomic(target, body);
    assert.equal(readFileSync(target, "utf8"), body);
    assert.equal(written.digest, sha256Hex(body));
    assert.deepEqual(readdirSync(path.dirname(target)).filter((f) => f.includes(".tmp")), []);
  });

  test("private credential files must be 0600 and their directory 0700", () => {
    const dir = tmpDir();
    const secretDir = ensurePrivateDir(path.join(dir, "private"));
    const secretFile = path.join(secretDir, "token.txt");
    writeFileAtomic(secretFile, "secret", { mode: 0o600 });
    assert.equal(assertPrivatePermissions(secretFile).ok, true);
    assert.equal(assertPrivatePermissions(secretDir, { dir: true }).ok, true);
    writeFileSync(secretFile, "secret");
    chmodSync(secretFile, 0o644);
    assert.equal(assertPrivatePermissions(secretFile).ok, false);
  });
});

describe("public evidence redaction (Spec §4.3)", () => {
  test("redaction drops tokens, raw business rows, private prompts and customer object names", () => {
    const payload = {
      runId: RUN_ID,
      attemptId: "a-1",
      accessToken: "lucy_e2e_0123456789abcdef0123456789abcdef",
      cookie: "session=abc123",
      password: "hunter2",
      rows: [{ customer: "张三百", amount: 42 }],
      systemPrompt: "内部提示词：请勿外泄客户名称",
      answer: "客户 张三百 的订单金额是 42 元"
    };
    const redacted = redactEvidence(payload, {
      secrets: ["lucy_e2e_0123456789abcdef0123456789abcdef"],
      customerObjectNames: ["张三百"]
    });
    const text = JSON.stringify(redacted);
    assert.ok(!text.includes("lucy_e2e_0123456789abcdef0123456789abcdef"));
    assert.ok(!text.includes("hunter2"));
    assert.ok(!text.includes("张三百"));
    assert.ok(!text.includes("内部提示词"));
    assert.ok(!text.includes('"amount"'));
    assert.equal(redacted.runId, RUN_ID);
    assert.equal(redacted.accessToken, "[REDACTED]");
    assert.equal(redacted.rows, "[REDACTED_ROWS]");
    assert.equal(redacted.systemPrompt, "[REDACTED_PROMPT]");
  });

  test("the leak scan reports a token left in the public evidence", () => {
    const text = JSON.stringify({ accessToken: "lucy_e2e_0123456789abcdef0123456789abcdef" });
    const hits = scanEvidenceForLeaks(text);
    assert.ok(hits.length > 0);
    assert.ok(hits.every((h) => !h.digest.includes("lucy_e2e")));
  });
});

// ---------------------------------------------------------------------------
// verifier — positive
// ---------------------------------------------------------------------------

describe("independent verifier — positive path", () => {
  test("valid evidence plus an accepted baseline passes the independent verifier", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);

    const result = verifyEvidenceBundle({ evidenceDir, baseline: accepted.baseline, now: NOW });
    assert.deepEqual(result.problems, []);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.ok, true);
    assert.equal(result.releaseReady, true);
    assert.equal(result.evidenceBodyDigest.match, true);
    assert.equal(result.attempts.count, 220);
  });

  test("a candidate baseline stays SEED_ONLY and never promotes LATEST.json", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const written = writeEvidenceBundle({
      evidenceDir: path.join(dir, "evidence", RUN_ID),
      attempts,
      summary,
      negativeControls: negativeControls()
    });
    const candidate = buildBaselineCandidate({
      summary: written.summary,
      attempts,
      evidenceBodyDigest: written.attemptsDigest
    });
    assert.equal(candidate.status, "SEED_ONLY");
    assert.equal(candidate.releaseReady, false);
    const baselinesDir = path.join(dir, "baselines");
    writeBaselineCandidate({ baselinesDir, baseline: candidate });
    assert.equal(existsSync(path.join(baselinesDir, "LATEST.json")), false);
  });

  test("LATEST.json only resolves a named accepted baseline", () => {
    const dir = tmpDir();
    const { baselinesDir, accepted } = acceptedBaselineFor(dir);
    const pointer = JSON.parse(readFileSync(path.join(baselinesDir, "LATEST.json"), "utf8"));
    assert.equal(pointer.contract, BASELINE_POINTER_CONTRACT);
    assert.equal(pointer.acceptedBy, "委托人");
    assert.equal(pointer.baselineFile, accepted.file);
    assert.equal(pointer.baselineDigest, accepted.digest);
    const validation = validateLatestPointer(pointer);
    assert.equal(validation.ok, true);
  });
});

// ---------------------------------------------------------------------------
// verifier — negative controls (Plan Task 2 step 3)
// ---------------------------------------------------------------------------

describe("independent verifier — evidence negative controls", () => {
  test("deleting one failed attempt is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ failAgentIndex: 3 });
    const summary = buildSummary(attempts, { status: "FAIL", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.filter((a) => a.attemptId !== "agent-3");
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("EVIDENCE_MISMATCH"));
  });

  test("changing one RTT is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a, i) => (i === 0 ? { ...a, journeyMs: 9_999 } : a));
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("EVIDENCE_MISMATCH"));
  });

  test("a hand filled baseline p95 blocks the relative comparison instead of skipping it", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ onlySimple: true });
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir, { onlySimple: true });

    const handFilled = {
      ...accepted.baseline,
      scenarios: accepted.baseline.scenarios.map((s) =>
        s.scenarioId === "SIMPLE" ? { ...s, p95Ms: null } : s
      )
    };

    const result = verifyEvidenceBundle({ evidenceDir, baseline: handFilled, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "BLOCKED");
    assert.ok(codes(result).includes("BASELINE_VALUE_MISSING"));
    assert.ok(
      result.problems.some((p) => p.code === "GATE_BLOCKED" && /relativeVerdict recomputed BLOCKED/.test(p.message))
    );
    assert.equal(result.releaseReady, false);
  });

  test("a denial scenario whose legal control can no longer be proven PASS fails (D16)", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);

    const brokenControl = {
      ...accepted.baseline,
      scenarios: accepted.baseline.scenarios.map((s) =>
        s.scenarioId === "SIMPLE" ? { ...s, p95Ms: null } : s
      )
    };

    const result = verifyEvidenceBundle({ evidenceDir, baseline: brokenControl, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    const denial = Object.values(result.recomputed.scenarios).find((s) => s.scenarioId === "DENIAL");
    assert.equal(denial.verdict, "FAIL");
    assert.ok(denial.reasons.some((r) => /legal control/.test(r)));
  });

  test("a forged top-level PASS is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ failAgentIndex: 5 });
    const honest = buildSummary(attempts, { status: "FAIL", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary: honest });

    const forged = { ...honest, status: "PASS", releaseReady: true };
    writeFileSync(
      path.join(evidenceDir, "summary.json"),
      `${JSON.stringify({ ...forged, evidenceBodyDigest: sha256Hex(readFileSync(path.join(evidenceDir, "attempts.ndjson"))) }, null, 2)}\n`
    );

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("EVIDENCE_MISMATCH"));
  });

  test("a changed question set digest is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a, i) =>
      i === 0 ? { ...a, questionSetDigest: "sha256:questionset-tampered" } : a
    );
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("FINGERPRINT_MISMATCH"));
  });

  test("a changed client fingerprint is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a, i) =>
      i === 0 ? { ...a, clientFingerprint: "sha256:client-tampered" } : a
    );
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes("FINGERPRINT_MISMATCH"));
  });

  test("a changed model fingerprint is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a, i) =>
      i === 0 ? { ...a, modelFingerprint: "sha256:model-tampered" } : a
    );
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes("FINGERPRINT_MISMATCH"));
  });

  test("a changed fixture (resource) digest is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a, i) =>
      i === 0 ? { ...a, fixtureDigest: "sha256:fixture-tampered" } : a
    );
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes("FINGERPRINT_MISMATCH"));
  });

  test("a duplicated attemptId is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    const tampered = [...attempts, { ...attempts[0] }];
    const summary = buildSummary(tampered);
    writeBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("DUPLICATE_ATTEMPT_ID"));
  });

  test("a missing final answer is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const tampered = attempts.map((a) =>
      a.attemptId === "agent-2" ? { ...a, finalAnswerReceived: false } : a
    );
    rewriteBundle(evidenceDir, { attempts: tampered, summary });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("MISSING_FINAL_ANSWER"));
  });

  test("a summary body digest that does not match the evidence body is detected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });

    const raw = JSON.parse(readFileSync(path.join(evidenceDir, "summary.json"), "utf8"));
    raw.evidenceBodyDigest = sha256Hex("something else");
    writeFileSync(path.join(evidenceDir, "summary.json"), `${JSON.stringify(raw, null, 2)}\n`);

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("DIGEST_MISMATCH"));
    assert.equal(result.evidenceBodyDigest.match, false);
  });

  test("an undetected negative control fails the run", () => {
    const dir = tmpDir();
    const attempts = buildAttempts();
    const summary = buildSummary(attempts);
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    const controls = negativeControls();
    controls.controls[0].detected = false;
    writeBundle(evidenceDir, { attempts, summary, controls });

    const result = verifyEvidenceBundle({ evidenceDir, now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("NEGATIVE_CONTROL_UNDETECTED"));
  });
});

// ---------------------------------------------------------------------------
// waivers (D22)
// ---------------------------------------------------------------------------

describe("D22 waivers", () => {
  test("a valid waiver yields releaseReady=waived and never PASS", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc({ evidenceBodyDigest: sha256Hex(readFileSync(path.join(evidenceDir, "attempts.ndjson"))) });

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.verdict, "BLOCKED");
    assert.equal(result.ok, false);
    assert.equal(result.releaseReady, "waived");
  });

  test("a waiver whose recorded digest was changed is rejected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc();
    waiver.waiverDigest = sha256Hex("tampered digest");

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("WAIVER_DIGEST_MISMATCH"));
    assert.notEqual(result.releaseReady, "waived");
  });

  test("an expired waiver is rejected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc({
      issuedAt: "2026-11-01T00:00:00.000Z",
      expiresAt: "2026-11-05T00:00:00.000Z"
    });

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("WAIVER_EXPIRED"));
    assert.notEqual(result.releaseReady, "waived");
  });

  test("a waiver bound to another candidate digest is rejected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc({ candidateDigest: "sha256:another-candidate" });

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("WAIVER_CANDIDATE_MISMATCH"));
    assert.notEqual(result.releaseReady, "waived");
  });

  test("a waiver outside the eligible scenario scope is rejected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc({
      scenarios: [
        { scenarioId: "AGENT_SIMPLE", verdict: "BLOCKED" },
        { scenarioId: "SIMPLE", verdict: "PASS" }
      ]
    });

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("WAIVER_SCOPE_EXCEEDED"));
    assert.notEqual(result.releaseReady, "waived");
  });

  test("a waived run must never be written into baselines/", () => {
    const dir = tmpDir();
    const { accepted, baselinesDir } = acceptedBaselineFor(dir);
    const waived = { ...accepted.baseline, status: "waived", releaseReady: "waived" };
    const validation = validateBaseline(waived);
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "WAIVED_IN_BASELINE"));
    assert.throws(
      () => acceptBaseline({ baselinesDir, baseline: waived, acceptedBy: "委托人" }),
      /waived/
    );
  });

  test("a waived run must never be promoted into LATEST.json", () => {
    const dir = tmpDir();
    const { baselinesDir, accepted } = acceptedBaselineFor(dir);
    const pointerPath = path.join(baselinesDir, "LATEST.json");
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
    const validation = validateLatestPointer({ ...pointer, status: "waived" });
    assert.equal(validation.ok, false);
    assert.ok(validation.problems.some((p) => p.code === "WAIVED_IN_LATEST"));
  });

  test("a waiver that binds another run's evidence body is rejected", () => {
    const dir = tmpDir();
    const attempts = buildAttempts({ agentN: 19 });
    const summary = buildSummary(attempts, { status: "BLOCKED", releaseReady: false });
    const evidenceDir = path.join(dir, "evidence", RUN_ID);
    writeBundle(evidenceDir, { attempts, summary });
    const { accepted } = acceptedBaselineFor(dir);
    const waiver = waiverDoc({ evidenceBodyDigest: sha256Hex("a different run body") });

    const result = verifyEvidenceBundle({
      evidenceDir,
      baseline: accepted.baseline,
      waivers: [waiverFile(waiver)],
      now: NOW
    });
    assert.equal(result.ok, false);
    assert.equal(result.verdict, "FAIL");
    assert.ok(codes(result).includes("WAIVER_DIGEST_MISMATCH"));
    assert.notEqual(result.releaseReady, "waived");
  });

  test("a waiver file without a waiver block cannot be verified", () => {
    const result = verifyWaiverFile({
      text: "# 豁免记录\n\n这里没有结构化豁免块。\n",
      filePath: "waivers/20261126-001.md",
      context: { now: NOW }
    });
    assert.equal(result.valid, false);
    assert.ok(result.problems.some((p) => p.code === "WAIVER_INVALID"));
  });
});
