/**
 * P1-78 Task 2 — MCP inquiry performance baselines, raw evidence and the
 * independent verifier.
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D3, D6, D8, D9, D10, D15, D20, D21, D22, §4.2, §4.3, §6.1, §6.2, §6.3)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 2
 *
 * Contract with the runner (D2/E2/F2) and with the independent verifier:
 *
 *   evidence/<runId>/attempts.ndjson       one JSON object per attempt
 *   evidence/<runId>/summary.json          per-scenario stats + total verdict
 *   evidence/<runId>/negative-controls.json D12 negative control record
 *   baselines/<questionSetVersion>-<environmentProfile>-<clientModelHash>-<gitSha>.json
 *   baselines/LATEST.json                  pointer to a NAMED-ACCEPTED baseline only
 *
 * The verifier never trusts the runner's top-level `status` / `verdicts` /
 * `releaseReady`: it re-reads attempts.ndjson and recomputes denominators,
 * percentiles, budgets, the relative gate and the total verdict through the
 * judge pure functions in ./mcp-inquiry-performance.mjs. Any disagreement is
 * FAIL(EVIDENCE_MISMATCH). The summary's `evidenceBodyDigest` must equal the
 * SHA-256 of the attempts body.
 *
 * D22 waivers never produce PASS: they only ever yield releaseReady="waived",
 * are bound to one candidate digest, expire within 7 days and are never
 * written into baselines/ nor promoted into LATEST.json.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

import {
  P95_MIN_SAMPLE_COUNT,
  P99_MIN_SAMPLE_COUNT,
  aggregatePerformance,
  assertSampleFloors,
  checkAttemptOutcomes,
  classifyProviderErrors,
  compareBaseline,
  groupAttempts,
  judgeAbsolute,
  validateWaiver
} from "./mcp-inquiry-performance.mjs";

import { scanText } from "./leak-scan.mjs";

// ---------------------------------------------------------------------------
// contracts and schema
// ---------------------------------------------------------------------------

export const EVIDENCE_CONTRACT = "lucy-mcp-inquiry-performance-evidence-v1";
export const BASELINE_CONTRACT = "lucy-mcp-inquiry-performance-baseline-v1";
export const BASELINE_POINTER_CONTRACT = "lucy-mcp-inquiry-performance-baseline-pointer-v1";
export const NEGATIVE_CONTROLS_CONTRACT = "lucy-mcp-inquiry-performance-negative-controls-v1";

export const EVIDENCE_DIR = "evidence";
export const BASELINES_DIR = "baselines";
export const WAIVERS_DIR = "waivers";

export const ATTEMPTS_FILE = "attempts.ndjson";
export const SUMMARY_FILE = "summary.json";
export const NEGATIVE_CONTROLS_FILE = "negative-controls.json";
export const LATEST_POINTER_FILE = "LATEST.json";

/** Every attempt must carry these fields (Spec §4.3 identity/input/result). */
export const ATTEMPT_REQUIRED_FIELDS = Object.freeze([
  "runId",
  "scenarioId",
  "caseId",
  "attemptId",
  "planItemId",
  "lane",
  "roleClass",
  "cacheState",
  "concurrencyGroup",
  "clientModel",
  "environment",
  "budgetClass",
  "questionSetDigest",
  "configDigest",
  "fixtureDigest",
  "budgetDigest",
  "clientFingerprint",
  "modelFingerprint",
  "environmentFingerprint",
  "outcome",
  "correctness",
  "errorClass",
  "timeoutMs",
  "firstAttempt",
  "finalAttempt"
]);

/** Identity fields that may be absent — the absence reason is then mandatory. */
export const ATTEMPT_NULLABLE_IDENTITY_FIELDS = Object.freeze(["retryOf", "traceId", "rpcRequestId"]);

/** Required fields that may legitimately carry the value null. */
export const ATTEMPT_NULLABLE_FIELDS = Object.freeze(["errorClass", "timeoutMs"]);

/** §4.2 timing milestones carried by every attempt. */
export const ATTEMPT_TIMING_REQUIRED_FIELDS = Object.freeze([
  "questionStartedAt",
  "firstObservableMs",
  "firstTokenMs",
  "firstCorrectResultMs",
  "finalCorrectAnswerMs",
  "turnWallClockMs",
  "unattributedMs",
  "mcpCalls",
  "stages"
]);

/** Extra timing fields required for the MCP lane (judge latency source). */
export const ATTEMPT_MCP_TIMING_FIELDS = Object.freeze(["journeyMs"]);

export const SUMMARY_REQUIRED_FIELDS = Object.freeze([
  "contract",
  "runId",
  "trigger",
  "tier",
  "generatedAt",
  "candidateFingerprint",
  "environmentFingerprint",
  "questionSetDigest",
  "configDigest",
  "fixtureDigest",
  "budgetDigest",
  "clientFingerprint",
  "modelFingerprint",
  "evidenceBodyDigest",
  "scenarios",
  "status",
  "releaseReady"
]);

export const SCENARIO_SUMMARY_REQUIRED_FIELDS = Object.freeze([
  "scenarioId",
  "lane",
  "cacheState",
  "concurrencyGroup",
  "clientModel",
  "environment",
  "budgetClass",
  "plannedCount",
  "sampleCount",
  "correctCount",
  "failedCount",
  "timeoutCount",
  "p50Ms",
  "p95Ms",
  "medianMs",
  "maxMs",
  "absoluteVerdict",
  "relativeVerdict",
  "verdict"
]);

/** Spec §6.2 — every formal baseline scenario must carry the whole set. */
export const BASELINE_SCENARIO_REQUIRED_FIELDS = Object.freeze([
  "scenarioId",
  "cacheState",
  "concurrencyGroup",
  "budgetClass",
  "sampleCount",
  "correctCount",
  "failedCount",
  "timeoutCount",
  "p50Ms",
  "p95Ms",
  "p99Ms",
  "medianMs",
  "maxMs",
  "questionSetDigest",
  "configDigest",
  "fixtureDigest",
  "budgetDigest",
  "candidateFingerprint",
  "environmentFingerprint",
  "clientFingerprint",
  "modelFingerprint",
  "evidenceBodyDigest",
  "acceptedBy",
  "acceptedAt"
]);

export const BASELINE_REQUIRED_TOP_LEVEL = Object.freeze([
  "contract",
  "questionSetVersion",
  "environmentProfile",
  "clientModelHash",
  "gitSha",
  "status",
  "releaseReady",
  "acceptedBy",
  "acceptedAt",
  "evidenceBodyDigest",
  "scenarios"
]);

export const NEGATIVE_CONTROL_REQUIRED_FIELDS = Object.freeze([
  "id",
  "kind",
  "scenarioId",
  "expected",
  "observed",
  "detected"
]);

export const OUTCOME_VALUES = Object.freeze([
  "correct",
  "wrong_answer",
  "unexpected_deny",
  "empty_envelope",
  "timeout",
  "crash",
  "denied",
  "allowed",
  "error",
  "missing_evidence"
]);

export const CORRECTNESS_VALUES = Object.freeze(["correct", "incorrect", "unknown"]);

export const TOTAL_VERDICTS = Object.freeze(["PASS", "SEED_ONLY", "NOT RUN", "BLOCKED", "FAIL"]);

const VERDICT_RANK = Object.freeze({ PASS: 0, "SEED_ONLY": 1, "NOT RUN": 2, BLOCKED: 3, FAIL: 4 });

const DIGEST_FIELDS = Object.freeze([
  "questionSetDigest",
  "configDigest",
  "fixtureDigest",
  "budgetDigest",
  "clientFingerprint",
  "modelFingerprint",
  "environmentFingerprint"
]);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function worstVerdict(a, b) {
  return (VERDICT_RANK[a] ?? 0) >= (VERDICT_RANK[b] ?? 0) ? a : b;
}

function problem(code, message, severity = "failed") {
  return { severity, code, message };
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function finiteOrNull(v) {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sameValue(a, b) {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Stable JSON used for content digests (key order independent). */
export function canonicalJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

export function sha256Hex(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Latency selection for one attempt. Mirrors the judge's private `latencyOf`
 * (scripts/e2e/lib/mcp-inquiry-performance.mjs) so the runner and the
 * verifier cannot drift: MCP lane = journeyMs→mcpJourneyMs→latencyMs,
 * Agent lane = finalCorrectAnswerMs→finalAnswerMs→turnWallClockMs.
 * Any drift surfaces as FAIL(EVIDENCE_MISMATCH) because the recomputed
 * percentiles would no longer match the recorded summary.
 */
export function attemptLatencyMs(attempt, lane) {
  if (!attempt) return null;
  const v =
    lane === "agent"
      ? (attempt.finalCorrectAnswerMs ?? attempt.finalAnswerMs ?? attempt.turnWallClockMs)
      : (attempt.journeyMs ?? attempt.mcpJourneyMs ?? attempt.latencyMs);
  return finiteOrNull(v);
}

/** D5 grouping key — identical to the judge's groupAttempts() key format. */
export function scenarioGroupKey(entry = {}) {
  return ["scenarioId", "cacheState", "clientModel", "environment", "concurrencyGroup"]
    .map((k) => `${k}=${entry[k] ?? "∅"}`)
    .join("|");
}

// ---------------------------------------------------------------------------
// schema validation
// ---------------------------------------------------------------------------

function missingFieldProblem(fields, holder, prefix, code = "SCHEMA_INVALID", nullable = []) {
  const missing = fields.filter((f) => {
    if (holder?.[f] === undefined) return true;
    if (holder[f] === null) return !nullable.includes(f);
    return false;
  });
  return missing.length ? [problem(code, `missing required field(s): ${missing.join(", ")}`, "blocked")] : [];
}

/**
 * A BLOCKED stub record: the host was unavailable, the host does not support
 * multi-turn or the question reference could not be resolved, so no final
 * answer could exist (Spec D19/D15). Such a record is blocked, not failed.
 */
function isBlockedStub(attempt) {
  return (
    attempt?.blocked === true &&
    typeof attempt?.blockedReason === "string" &&
    attempt.blockedReason.trim().length > 0
  );
}

/**
 * One attempt record (Spec §4.3). Missing identity fields must carry a reason.
 */
export function validateAttempt(attempt, { index = null } = {}) {
  const problems = [];
  const where = index == null ? "" : `attempt[${index}] `;
  if (!isPlainObject(attempt)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", `${where}attempt is not an object`, "blocked")] };
  }
  for (const p of missingFieldProblem(ATTEMPT_REQUIRED_FIELDS, attempt, where, "SCHEMA_INVALID", ATTEMPT_NULLABLE_FIELDS)) {
    problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
  }
  for (const p of missingFieldProblem(ATTEMPT_TIMING_REQUIRED_FIELDS, attempt, where)) {
    problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
  }
  if (attempt.lane === "mcp") {
    for (const p of missingFieldProblem(ATTEMPT_MCP_TIMING_FIELDS, attempt, where)) {
      problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
    }
  }
  // A missing final answer is a failed attempt — unless the attempt is a
  // BLOCKED stub (host unavailable / no multi-turn support / unresolved
  // question reference): there the answer could not exist at all, and D19/D15
  // ask for BLOCKED, not FAIL.
  if (attempt.lane === "agent" && attempt.finalAnswerReceived !== true && !isBlockedStub(attempt)) {
    problems.push(
      problem(
        "MISSING_FINAL_ANSWER",
        `${where}agent attempt ${attempt.attemptId ?? "?"} has no completed final answer (finalAnswerReceived !== true)`,
        "failed"
      )
    );
  }
  for (const f of ATTEMPT_NULLABLE_IDENTITY_FIELDS) {
    const v = attempt[f];
    const reason = attempt[`${f}MissingReason`];
    if (v == null || v === "") {
      if (reason == null || String(reason).trim() === "") {
        problems.push(
          problem("SCHEMA_INVALID", `${where}attempt ${attempt.attemptId ?? "?"} is missing ${f} without a missing reason`, "blocked")
        );
      }
    }
  }
  if (attempt.outcome != null && !OUTCOME_VALUES.includes(attempt.outcome)) {
    problems.push(problem("SCHEMA_INVALID", `${where}unknown outcome ${JSON.stringify(attempt.outcome)}`, "blocked"));
  }
  if (attempt.correctness != null && !CORRECTNESS_VALUES.includes(attempt.correctness)) {
    problems.push(
      problem("SCHEMA_INVALID", `${where}unknown correctness ${JSON.stringify(attempt.correctness)}`, "blocked")
    );
  }
  if (attempt.outcome === "timeout" && finiteOrNull(attempt.timeoutMs) == null) {
    problems.push(problem("SCHEMA_INVALID", `${where}timeout attempt without timeoutMs`, "blocked"));
  }
  if (
    attempt.outcome != null &&
    ["wrong_answer", "empty_envelope", "crash", "error", "timeout"].includes(attempt.outcome) &&
    attempt.correctness === "correct"
  ) {
    problems.push(
      problem(
        "SCHEMA_INVALID",
        `${where}attempt ${attempt.attemptId ?? "?"} has outcome ${attempt.outcome} but correctness=correct`,
        "blocked"
      )
    );
  }
  if (!Array.isArray(attempt.mcpCalls)) {
    problems.push(problem("SCHEMA_INVALID", `${where}mcpCalls must be an array`, "blocked"));
  }
  if (!Array.isArray(attempt.stages)) {
    problems.push(problem("SCHEMA_INVALID", `${where}stages must be an array`, "blocked"));
  }
  if (attempt.firstTokenMs !== "not_available" && finiteOrNull(attempt.firstTokenMs) == null) {
    problems.push(
      problem("SCHEMA_INVALID", `${where}firstTokenMs must be a number or the literal "not_available"`, "blocked")
    );
  }
  return { ok: problems.length === 0, problems };
}

/** Whole-file validation: per-attempt schema plus duplicate attemptId detection. */
export function validateAttempts(attempts) {
  const problems = [];
  if (!Array.isArray(attempts)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "attempts must be an array", "blocked")] };
  }
  if (attempts.length === 0) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "attempts.ndjson holds no attempt", "blocked")] };
  }
  const seen = new Map();
  attempts.forEach((a, i) => {
    problems.push(...validateAttempt(a, { index: i }).problems);
    const id = a?.attemptId;
    if (id == null || id === "") {
      problems.push(problem("SCHEMA_INVALID", `attempt[${i}] has no attemptId`, "blocked"));
      return;
    }
    if (seen.has(id)) {
      problems.push(
        problem(
          "DUPLICATE_ATTEMPT_ID",
          `duplicate attemptId ${id} (attempts[${seen.get(id)}] and attempts[${i}])`,
          "failed"
        )
      );
      return;
    }
    seen.set(id, i);
  });
  return { ok: problems.length === 0, problems };
}

/** One scenario entry of summary.json. */
export function validateScenarioSummary(entry, { index = null } = {}) {
  const problems = [];
  const where = index == null ? "" : `scenarios[${index}] `;
  if (!isPlainObject(entry)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", `${where}scenario entry is not an object`, "blocked")] };
  }
  for (const p of missingFieldProblem(SCENARIO_SUMMARY_REQUIRED_FIELDS, entry, where)) {
    problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
  }
  if (entry.key != null && entry.key !== scenarioGroupKey(entry)) {
    problems.push(
      problem("SCHEMA_INVALID", `${where}key ${JSON.stringify(entry.key)} does not match the D5 group key`, "blocked")
    );
  }
  if (finiteOrNull(entry.sampleCount) == null) {
    problems.push(problem("SCHEMA_INVALID", `${where}sampleCount is not numeric`, "blocked"));
  }
  if (!["PASS", "FAIL", "BLOCKED", "SEED_ONLY", "NOT RUN"].includes(entry.absoluteVerdict)) {
    problems.push(problem("SCHEMA_INVALID", `${where}absoluteVerdict ${JSON.stringify(entry.absoluteVerdict)}`, "blocked"));
  }
  if (!["PASS", "FAIL", "BLOCKED", "SEED_ONLY"].includes(entry.relativeVerdict)) {
    problems.push(problem("SCHEMA_INVALID", `${where}relativeVerdict ${JSON.stringify(entry.relativeVerdict)}`, "blocked"));
  }
  return { ok: problems.length === 0, problems };
}

/** summary.json — the runner's claim. The verdict itself is never trusted. */
export function validateSummary(summary) {
  const problems = [];
  if (!isPlainObject(summary)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "summary.json is not an object", "blocked")] };
  }
  if (summary.contract !== EVIDENCE_CONTRACT) {
    problems.push(
      problem("SCHEMA_INVALID", `summary contract must be ${EVIDENCE_CONTRACT}, got ${JSON.stringify(summary.contract)}`, "blocked")
    );
  }
  for (const p of missingFieldProblem(SUMMARY_REQUIRED_FIELDS, summary, "summary ")) {
    problems.push(problem(p.code, `summary ${p.message}`, "blocked"));
  }
  if (!Array.isArray(summary.scenarios) || summary.scenarios.length === 0) {
    problems.push(problem("SCHEMA_INVALID", "summary.scenarios must be a non-empty array", "blocked"));
  } else {
    summary.scenarios.forEach((s, i) => {
      problems.push(...validateScenarioSummary(s, { index: i }).problems);
    });
    const keys = new Set();
    for (const s of summary.scenarios) {
      const key = scenarioGroupKey(s);
      if (keys.has(key)) {
        problems.push(
          problem(
            "DUPLICATE_SCENARIO_KEY",
            `summary lists the same scenario group twice: ${key}`,
            "failed"
          )
        );
      }
      keys.add(key);
    }
    const ids = new Set();
    for (const s of summary.scenarios) {
      const sid = s?.scenarioId;
      if (ids.has(sid)) {
        problems.push(
          problem(
            "SCENARIO_ID_REUSED",
            `scenarioId ${sid} is used by more than one independent group; every group needs its own scenarioId (D5)`,
            "blocked"
          )
        );
      }
      ids.add(sid);
    }
  }
  if (summary.releaseReady !== true && summary.releaseReady !== false && summary.releaseReady !== "waived") {
    problems.push(problem("SCHEMA_INVALID", `summary releaseReady must be true|false|"waived"`, "blocked"));
  }
  if (!TOTAL_VERDICTS.includes(summary.status)) {
    problems.push(problem("SCHEMA_INVALID", `summary status ${JSON.stringify(summary.status)} is not a total verdict`, "blocked"));
  }
  if (summary.status !== "PASS" && summary.releaseReady === true) {
    problems.push(
      problem("SCHEMA_INVALID", `summary status ${summary.status} must not claim releaseReady=true`, "failed")
    );
  }
  return { ok: problems.length === 0, problems };
}

/**
 * A formal baseline (Spec §6.2). Required numbers must be real numbers:
 * p50Ms / p95Ms / medianMs / sampleCount are never null, p99Ms is a number
 * only for N>=100 and "not_estimable" below that. A baseline whose status is
 * "waived" is invalid — D22③ forbids writing waivers into baselines/.
 */
export function validateBaseline(baseline, { requireAcceptance = true } = {}) {
  const problems = [];
  if (!isPlainObject(baseline)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "baseline is not an object", "blocked")] };
  }
  if (baseline.contract !== BASELINE_CONTRACT) {
    problems.push(
      problem("SCHEMA_INVALID", `baseline contract must be ${BASELINE_CONTRACT}, got ${JSON.stringify(baseline.contract)}`, "blocked")
    );
  }
  const acceptanceNullable = baseline.status === "PASS" ? [] : ["acceptedBy", "acceptedAt"];
  for (const p of missingFieldProblem(BASELINE_REQUIRED_TOP_LEVEL, baseline, "baseline ", "SCHEMA_INVALID", acceptanceNullable)) {
    problems.push(problem(p.code, `baseline ${p.message}`, "blocked"));
  }
  if (baseline.status === "waived" || baseline.releaseReady === "waived") {
    problems.push(
      problem("WAIVED_IN_BASELINE", "a waived run must never be written into baselines/ (D22③)", "failed")
    );
  }
  if (baseline.status !== "SEED_ONLY" && baseline.status !== "PASS") {
    problems.push(
      problem("SCHEMA_INVALID", `baseline status ${JSON.stringify(baseline.status)} must be SEED_ONLY or PASS`, "blocked")
    );
  }
  if (requireAcceptance && baseline.status === "PASS") {
    for (const f of ["acceptedBy", "acceptedAt"]) {
      if (baseline[f] == null || String(baseline[f]).trim() === "") {
        problems.push(problem("SCHEMA_INVALID", `baseline ${f} is required for an accepted baseline`, "blocked"));
      }
    }
  }
  if (!Array.isArray(baseline.scenarios) || baseline.scenarios.length === 0) {
    problems.push(problem("SCHEMA_INVALID", "baseline.scenarios must be a non-empty array", "blocked"));
    return { ok: false, problems };
  }
  baseline.scenarios.forEach((s, i) => {
    const where = `baseline.scenarios[${i}] `;
    if (!isPlainObject(s)) {
      problems.push(problem("SCHEMA_INVALID", `${where}is not an object`, "blocked"));
      return;
    }
    for (const p of missingFieldProblem(BASELINE_SCENARIO_REQUIRED_FIELDS, s, where, "SCHEMA_INVALID", acceptanceNullable)) {
      problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
    }
    for (const f of ["sampleCount", "p50Ms", "p95Ms", "medianMs"]) {
      if (finiteOrNull(s[f]) == null) {
        problems.push(
          problem(
            "BASELINE_VALUE_MISSING",
            `${where}${f} is null/missing/not numeric; a formal baseline must carry the real measured value`,
            "blocked"
          )
        );
      }
    }
    const n = finiteOrNull(s.sampleCount);
    if (n != null && n < P95_MIN_SAMPLE_COUNT) {
      problems.push(
        problem(
          "BASELINE_VALUE_MISSING",
          `${where}sampleCount ${n} < ${P95_MIN_SAMPLE_COUNT}; such a baseline cannot back a formal comparison`,
          "blocked"
        )
      );
    }
    if (n != null && n < P99_MIN_SAMPLE_COUNT) {
      if (s.p99Ms !== "not_estimable") {
        problems.push(
          problem(
            "BASELINE_VALUE_MISSING",
            `${where}p99Ms must be "not_estimable" while sampleCount ${n} < ${P99_MIN_SAMPLE_COUNT}`,
            "blocked"
          )
        );
      }
    } else if (n != null && finiteOrNull(s.p99Ms) == null) {
      problems.push(problem("BASELINE_VALUE_MISSING", `${where}p99Ms must be numeric for sampleCount ${n}`, "blocked"));
    }
    if (s.p95Ms === "not_estimable") {
      problems.push(
        problem(
          "BASELINE_VALUE_MISSING",
          `${where}p95Ms is "not_estimable"; a formal baseline must carry a real P95`,
          "blocked"
        )
      );
    }
    if (s.evidenceBodyDigest == null || String(s.evidenceBodyDigest).trim() === "") {
      problems.push(
        problem("BASELINE_VALUE_MISSING", `${where}evidenceBodyDigest is required (no hand-filled baseline)`, "blocked")
      );
    }
    if (requireAcceptance && baseline.status === "PASS") {
      for (const f of ["acceptedBy", "acceptedAt"]) {
        if (s[f] == null || String(s[f]).trim() === "") {
          problems.push(problem("SCHEMA_INVALID", `${where}${f} is required for an accepted baseline`, "blocked"));
        }
      }
    }
  });
  return { ok: problems.length === 0, problems };
}

/** negative-controls.json (D12 / SC-09). */
export function validateNegativeControls(doc) {
  const problems = [];
  if (!isPlainObject(doc)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "negative-controls.json is not an object", "blocked")] };
  }
  if (doc.contract !== NEGATIVE_CONTROLS_CONTRACT) {
    problems.push(
      problem(
        "SCHEMA_INVALID",
        `negative controls contract must be ${NEGATIVE_CONTROLS_CONTRACT}, got ${JSON.stringify(doc.contract)}`,
        "blocked"
      )
    );
  }
  if (!Array.isArray(doc.controls) || doc.controls.length === 0) {
    problems.push(problem("SCHEMA_INVALID", "negative-controls.controls must be a non-empty array", "blocked"));
    return { ok: false, problems };
  }
  doc.controls.forEach((c, i) => {
    const where = `controls[${i}] `;
    for (const p of missingFieldProblem(NEGATIVE_CONTROL_REQUIRED_FIELDS, c, where)) {
      problems.push(problem(p.code, `${where}${p.message}`, "blocked"));
    }
    if (c && typeof c.detected !== "boolean") {
      problems.push(problem("SCHEMA_INVALID", `${where}detected must be a boolean`, "blocked"));
    }
  });
  return { ok: problems.length === 0, problems };
}

/** LATEST.json — pointer to a named-accepted baseline; never "waived". */
export function validateLatestPointer(pointer) {
  const problems = [];
  if (!isPlainObject(pointer)) {
    return { ok: false, problems: [problem("SCHEMA_INVALID", "LATEST.json is not an object", "blocked")] };
  }
  if (pointer.contract !== BASELINE_POINTER_CONTRACT) {
    problems.push(
      problem(
        "SCHEMA_INVALID",
        `LATEST.json contract must be ${BASELINE_POINTER_CONTRACT}, got ${JSON.stringify(pointer.contract)}`,
        "blocked"
      )
    );
  }
  for (const f of ["baselineFile", "baselineDigest", "acceptedBy", "acceptedAt"]) {
    if (pointer[f] == null || String(pointer[f]).trim() === "") {
      problems.push(problem("SCHEMA_INVALID", `LATEST.json missing ${f}`, "blocked"));
    }
  }
  if (pointer.status === "waived" || pointer.releaseReady === "waived") {
    problems.push(
      problem("WAIVED_IN_LATEST", "a waived run must never be promoted into LATEST.json (D22③)", "failed")
    );
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// redaction and leak scanning
// ---------------------------------------------------------------------------

const SECRET_KEY_PATTERN =
  /(token|cookie|session|password|passwd|secret|credential|authorization|bearer|apikey|api_key|privatekey|private_key)/i;
const SECRET_KEY_ALLOWLIST = new Set([
  "clientfingerprint",
  "modelfingerprint",
  "environmentfingerprint",
  "configprofilefingerprint",
  "candidatedigest",
  "questiondigest",
  "suitedigest",
  "tokenref",
  "tokenlabel",
  "tokenid",
  "tokenusage",
  "modelcallcount",
  "sessionscope",
  "sessionidref"
]);
const RAW_ROW_KEY_PATTERN =
  /(^|_)(rows|rowdata|rawrows|businessrows|resultrows|datarows|recordset|cells|rowvalues|tablecontents|rowsample)($|_)/i;
const PROMPT_KEY_PATTERN =
  /(prompt|instruction|questiontext|systemmessage|usermessage|messages|persona|contexttext|customprompt|privateprompt)/i;
const PROMPT_KEY_ALLOWLIST = new Set(["questionref", "questionid", "questiondigest", "questionpackdigest", "packdigest"]);

const REDACTED = "[REDACTED]";
const REDACTED_ROWS = "[REDACTED_ROWS]";
const REDACTED_PROMPT = "[REDACTED_PROMPT]";
const REDACTED_OBJECT = "[REDACTED_OBJECT]";
const REDACTED_SQL = "[REDACTED_SQL]";

function isSecretishKey(key) {
  const k = String(key).toLowerCase();
  if (SECRET_KEY_ALLOWLIST.has(k)) return false;
  return SECRET_KEY_PATTERN.test(k);
}

function isRawRowKey(key) {
  return RAW_ROW_KEY_PATTERN.test(String(key));
}

function isPromptKey(key) {
  const k = String(key).toLowerCase();
  if (PROMPT_KEY_ALLOWLIST.has(k)) return false;
  return PROMPT_KEY_PATTERN.test(k);
}

function scrubString(value, ctx) {
  let out = value;
  for (const secret of ctx.secrets) {
    if (secret && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  for (const name of ctx.customerObjectNames) {
    if (name && out.includes(name)) out = out.split(name).join(REDACTED_OBJECT);
  }
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, REDACTED);
  out = out.replace(/\blucy_(?:e2e_)?[A-Za-z0-9]{16,}/g, REDACTED);
  out = out.replace(/\bSELECT\b[\s\S]{0,400}\bFROM\b/gi, REDACTED_SQL);
  return out;
}

/**
 * Redact a public-evidence payload (Spec §4.3). Tokens, cookies, sessions,
 * passwords, raw business rows, private prompts and customer object names must
 * not survive. Returns a deep copy — the input is never mutated.
 */
export function redactEvidence(value, { secrets = [], customerObjectNames = [] } = {}) {
  const ctx = { secrets: secrets.filter(Boolean), customerObjectNames: customerObjectNames.filter(Boolean) };
  const walk = (node, keyHint) => {
    if (node == null) return node;
    if (typeof node === "string") return scrubString(node, ctx);
    if (typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((v) => walk(v, keyHint));
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (isSecretishKey(k)) {
        out[k] = v == null ? v : REDACTED;
        continue;
      }
      if (isRawRowKey(k)) {
        out[k] = REDACTED_ROWS;
        continue;
      }
      if (isPromptKey(k)) {
        out[k] = REDACTED_PROMPT;
        continue;
      }
      out[k] = walk(v, k);
    }
    return out;
  };
  return walk(value, null);
}

function scanKeyValueHits(text, keyPattern) {
  const hits = [];
  const re = new RegExp(`["']?${keyPattern}["']?\\s*[:=]\\s*["']([^"']*)["']`, "gi");
  let m;
  while ((m = re.exec(text))) {
    const v = m[1];
    if (!v) continue;
    if (/^\[?REDACTED\]?$/i.test(v)) continue;
    if (v === "not_available" || v === "null" || v === "undefined") continue;
    hits.push({ kind: `secret-like-${keyPattern}`, digest: sha256Hex(v).slice(0, 16) });
  }
  return hits;
}

/**
 * Leak scan for public evidence. Returns every hit (kind + short digest only,
 * never the matched secret).
 */
export function scanEvidenceForLeaks(text, { secrets = [], customerObjectNames = [] } = {}) {
  const body = typeof text === "string" ? text : String(text ?? "");
  const hits = [];
  for (const h of scanText(body, { secrets: secrets.filter(Boolean) }).hits ?? []) {
    hits.push(h);
  }
  for (const secret of secrets.filter(Boolean)) {
    if (body.includes(secret)) hits.push({ kind: "exact-secret", digest: sha256Hex(secret).slice(0, 16) });
  }
  for (const name of customerObjectNames.filter(Boolean)) {
    if (body.includes(name)) hits.push({ kind: "customer-object-name", digest: sha256Hex(name).slice(0, 16) });
  }
  for (const keyPattern of ["password", "access[_-]?token", "refresh[_-]?token", "cookie", "authorization", "bearer"]) {
    hits.push(...scanKeyValueHits(body, keyPattern));
  }
  if (/\bSELECT\b[\s\S]{0,400}\bFROM\b/i.test(body)) {
    hits.push({ kind: "raw-business-rows", digest: sha256Hex("raw-business-rows").slice(0, 16) });
  }
  return hits;
}

/** Fail-closed leak assertion used by the writer and the verifier. */
export function assertNoLeaks(text, opts = {}) {
  const hits = scanEvidenceForLeaks(text, opts);
  return { ok: hits.length === 0, hits };
}

// ---------------------------------------------------------------------------
// atomic writes and private file permissions
// ---------------------------------------------------------------------------

/**
 * Atomic write: temp file in the same directory + rename. A crashed or
 * failing write never leaves a half-written target behind.
 * `content` may be a thunk so serialization can fail before anything is created.
 */
export function writeFileAtomic(targetPath, content, { mode = 0o644 } = {}) {
  const dir = path.dirname(targetPath);
  const payload = typeof content === "function" ? content() : content;
  if (typeof payload !== "string" && !Buffer.isBuffer(payload)) {
    throw new TypeError(`writeFileAtomic: content must be a string, Buffer or thunk (${targetPath})`);
  }
  mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  let fd = null;
  try {
    fd = openSync(tmp, "wx", mode);
    writeFileSync(fd, payload);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    chmodSync(tmp, mode);
    renameSync(tmp, targetPath);
  } catch (err) {
    if (fd != null) {
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw err;
  }
  return {
    path: targetPath,
    bytes: Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload),
    digest: sha256Hex(payload)
  };
}

/** Private credential directory: 0700. */
export function ensurePrivateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort on exotic filesystems */
  }
  return dir;
}

/** Private credential file: 0600. */
export function writePrivateFile(targetPath, content) {
  ensurePrivateDir(path.dirname(targetPath));
  return writeFileAtomic(targetPath, content, { mode: 0o600 });
}

/** Check the mode of a private file (0600) or directory (0700). */
export function assertPrivatePermissions(targetPath, { dir = false } = {}) {
  const expected = dir ? 0o700 : 0o600;
  if (!existsSync(targetPath)) {
    return { ok: false, expected: expected.toString(8), actual: null, message: `${targetPath} does not exist` };
  }
  const st = statSync(targetPath);
  const actual = st.mode & 0o777;
  return {
    ok: actual === expected,
    expected: expected.toString(8),
    actual: actual.toString(8),
    message: `${targetPath} mode is ${actual.toString(8)}, expected ${expected.toString(8)}`
  };
}

// ---------------------------------------------------------------------------
// evidence bundle IO
// ---------------------------------------------------------------------------

export function parseNdjson(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const attempts = [];
  const problems = [];
  lines.forEach((line, i) => {
    try {
      attempts.push(JSON.parse(line));
    } catch (err) {
      problems.push(problem("SCHEMA_INVALID", `attempts.ndjson line ${i + 1} is not valid JSON: ${err.message}`, "blocked"));
    }
  });
  return { attempts, problems };
}

/** Read one evidence directory from disk. */
export function readEvidenceBundle(evidenceDir) {
  const attemptsPath = path.join(evidenceDir, ATTEMPTS_FILE);
  const summaryPath = path.join(evidenceDir, SUMMARY_FILE);
  const ncPath = path.join(evidenceDir, NEGATIVE_CONTROLS_FILE);
  const out = {
    dir: evidenceDir,
    attempts: [],
    summary: null,
    negativeControls: null,
    attemptsRaw: null,
    summaryRaw: null,
    negativeControlsRaw: null,
    attemptsDigest: null,
    summaryDigest: null,
    negativeControlsDigest: null,
    problems: []
  };
  if (!existsSync(attemptsPath)) {
    out.problems.push(problem("MISSING_EVIDENCE", `missing ${ATTEMPTS_FILE} in ${evidenceDir}`, "blocked"));
    return out;
  }
  out.attemptsRaw = readFileSync(attemptsPath);
  out.attemptsDigest = sha256Hex(out.attemptsRaw);
  const parsed = parseNdjson(out.attemptsRaw.toString("utf8"));
  out.attempts = parsed.attempts;
  out.problems.push(...parsed.problems);
  if (existsSync(summaryPath)) {
    out.summaryRaw = readFileSync(summaryPath);
    out.summaryDigest = sha256Hex(out.summaryRaw);
    try {
      out.summary = JSON.parse(out.summaryRaw.toString("utf8"));
    } catch (err) {
      out.problems.push(problem("SCHEMA_INVALID", `summary.json is not valid JSON: ${err.message}`, "blocked"));
    }
  } else {
    out.problems.push(problem("MISSING_EVIDENCE", `missing ${SUMMARY_FILE} in ${evidenceDir}`, "blocked"));
  }
  if (existsSync(ncPath)) {
    out.negativeControlsRaw = readFileSync(ncPath);
    out.negativeControlsDigest = sha256Hex(out.negativeControlsRaw);
    try {
      out.negativeControls = JSON.parse(out.negativeControlsRaw.toString("utf8"));
    } catch (err) {
      out.problems.push(problem("SCHEMA_INVALID", `negative-controls.json is not valid JSON: ${err.message}`, "blocked"));
    }
  }
  return out;
}

/**
 * Write one evidence bundle (attempts + summary + negative controls).
 * The summary's evidenceBodyDigest / negativeControlsDigest are computed from
 * the exact bytes written. The write is refused when a leak is detected.
 */
export function writeEvidenceBundle({ evidenceDir, attempts, summary, negativeControls = null, secrets = [], customerObjectNames = [] } = {}) {
  if (!evidenceDir) throw new Error("writeEvidenceBundle requires evidenceDir");
  if (!Array.isArray(attempts)) throw new Error("writeEvidenceBundle requires attempts[]");
  mkdirSync(evidenceDir, { recursive: true });

  const attemptsBody = `${attempts.map((a) => JSON.stringify(a)).join("\n")}\n`;
  const leakAttempts = scanEvidenceForLeaks(attemptsBody, { secrets, customerObjectNames });
  if (leakAttempts.length) {
    throw new Error(
      `writeEvidenceBundle refused: attempts.ndjson leaks ${leakAttempts.map((h) => h.kind).join(", ")} (redact first)`
    );
  }

  const nextSummary = { ...(summary ?? {}) };
  nextSummary.evidenceBodyDigest = sha256Hex(attemptsBody);
  if (negativeControls) {
    const ncBody = `${JSON.stringify(negativeControls, null, 2)}\n`;
    const leakNc = scanEvidenceForLeaks(ncBody, { secrets, customerObjectNames });
    if (leakNc.length) {
      throw new Error(
        `writeEvidenceBundle refused: negative-controls.json leaks ${leakNc.map((h) => h.kind).join(", ")} (redact first)`
      );
    }
    writeFileAtomic(path.join(evidenceDir, NEGATIVE_CONTROLS_FILE), ncBody);
    nextSummary.negativeControlsDigest = sha256Hex(ncBody);
  }
  const summaryBody = `${JSON.stringify(nextSummary, null, 2)}\n`;
  const leakSummary = scanEvidenceForLeaks(summaryBody, { secrets, customerObjectNames });
  if (leakSummary.length) {
    throw new Error(
      `writeEvidenceBundle refused: summary.json leaks ${leakSummary.map((h) => h.kind).join(", ")} (redact first)`
    );
  }
  writeFileAtomic(path.join(evidenceDir, ATTEMPTS_FILE), attemptsBody);
  writeFileAtomic(path.join(evidenceDir, SUMMARY_FILE), summaryBody);
  return {
    dir: evidenceDir,
    summary: nextSummary,
    attemptsDigest: nextSummary.evidenceBodyDigest,
    summaryDigest: sha256Hex(summaryBody)
  };
}

// ---------------------------------------------------------------------------
// recomputation (independent verifier core)
// ---------------------------------------------------------------------------

function classifyGroup(group) {
  if (group.lane !== "agent") return { classified: null, judgment: group.attempts, map: null };
  const classified = classifyProviderErrors(group.attempts);
  return {
    classified,
    judgment: classified.attempts.filter((a) => a.judgmentSample),
    map: new Map(classified.attempts.map((a) => [a.attemptId, a.classification]))
  };
}

function groupAbsInput(group, { tier }) {
  const judgment = group.judgmentAttempts;
  const firstTokenSamples = judgment
    .map((a) => a.firstTokenMs)
    .filter((v) => Number.isFinite(v));
  return {
    lane: group.lane,
    tier,
    budgetClass: group.budgetClass ?? null,
    ownerBudgetClass: group.ownerBudgetClass,
    cacheState: group.cacheState ?? "warm",
    latencies: judgment.map((a) => attemptLatencyMs(a, group.lane)).filter((v) => v != null),
    turns: judgment,
    firstCorrectResultSamples: judgment.map((a) => a.firstCorrectResultMs).filter((v) => Number.isFinite(v)),
    initializeSamples: group.attempts.map((a) => a.initializeMs).filter((v) => Number.isFinite(v)),
    firstTokenSamples: firstTokenSamples.length ? firstTokenSamples : "not_available"
  };
}

/**
 * Recompute everything from the raw attempts.
 * Reuses the judge pure functions — no second implementation of the verdict
 * logic lives here.
 */
export function recomputeFromAttempts(
  attempts,
  {
    tier = "formal",
    baselineScenarios = null,
    legalControls = [],
    waivers = [],
    candidateDigest = null,
    now = Date.now(),
    soak = null,
    longFollow = null,
    plannedCounts = null
  } = {}
) {
  const problems = [];
  const groups = groupAttempts(attempts ?? []);
  const groupList = Object.values(groups);
  const scenarioIds = new Set();
  const prepared = [];

  for (const g of groupList) {
    const lane = g.attempts[0]?.lane ?? "mcp";
    const budgetClass = g.attempts[0]?.budgetClass ?? null;
    const scenarioId = g.scenarioId;
    if (scenarioIds.has(scenarioId)) {
      problems.push(
        problem(
          "SCENARIO_ID_REUSED",
          `scenarioId ${scenarioId} covers more than one independent group; split the scenarioId (D5)`,
          "blocked"
        )
      );
    }
    scenarioIds.add(scenarioId);
    const group = {
      key: g.key,
      scenarioId,
      lane,
      budgetClass,
      ownerBudgetClass: g.attempts[0]?.ownerBudgetClass,
      cacheState: g.cacheState ?? "warm",
      concurrencyGroup: g.concurrencyGroup ?? null,
      clientModel: g.clientModel ?? null,
      environment: g.environment ?? null,
      attempts: g.attempts,
      plannedCount: plannedCounts?.[g.key] ?? new Set(g.attempts.map((a) => a.planItemId ?? a.attemptId)).size
    };
    group.classification = classifyGroup(group);
    group.judgmentAttempts = group.classification.judgment;
    prepared.push(group);
  }

  const baselineMap = new Map();
  for (const s of baselineScenarios ?? []) {
    baselineMap.set(scenarioGroupKey(s), s);
  }

  const aggGroups = prepared.map((g) => ({
    scenarioId: g.scenarioId,
    lane: g.lane,
    budgetClass: g.budgetClass,
    ownerBudgetClass: g.ownerBudgetClass,
    cacheState: g.cacheState,
    concurrencyGroup: g.concurrencyGroup,
    clientModel: g.clientModel,
    environment: g.environment,
    plannedCount: g.plannedCount,
    baseline: baselineMap.get(g.key) ?? null,
    initializeSamples: g.attempts.map((a) => a.initializeMs).filter((v) => Number.isFinite(v)),
    firstTokenSamples: (() => {
      const vals = g.judgmentAttempts.map((a) => a.firstTokenMs).filter((v) => Number.isFinite(v));
      return vals.length ? vals : "not_available";
    })(),
    attempts: g.attempts
  }));

  const aggregate = aggregatePerformance({
    tier,
    groups: aggGroups,
    legalControls,
    waivers,
    candidateDigest,
    now,
    soak,
    longFollow
  });

  const scenarios = {};
  for (const g of prepared) {
    const abs = judgeAbsolute(groupAbsInput(g, { tier }));
    const floors = assertSampleFloors([{ key: g.scenarioId, lane: g.lane, attempts: g.judgmentAttempts }], { tier });
    const p95Formal = floors.perGroup[g.scenarioId]?.p95Formal ?? false;
    const currentSummary = {
      ...abs.summary,
      scenarioId: g.scenarioId,
      cacheState: g.cacheState,
      concurrencyGroup: g.concurrencyGroup,
      clientModel: g.clientModel,
      environment: g.environment
    };
    const baseline = baselineMap.get(g.key) ?? null;
    const relative = compareBaseline(currentSummary, baseline, { lane: g.lane, p95Formal });
    const corr = checkAttemptOutcomes(g.attempts, {
      lane: g.lane,
      expectedOutcome: g.budgetClass === "denial" ? "deny" : "allow",
      classified: g.classification.map
    });
    const aggEntry = aggregate.perScenario[g.scenarioId] ?? null;
    const provider = g.classification.classified?.scenarios[g.scenarioId] ?? null;
    scenarios[g.key] = {
      key: g.key,
      scenarioId: g.scenarioId,
      lane: g.lane,
      cacheState: g.cacheState,
      concurrencyGroup: g.concurrencyGroup,
      clientModel: g.clientModel,
      environment: g.environment,
      budgetClass: g.budgetClass,
      plannedCount: g.plannedCount,
      attemptCount: g.attempts.length,
      judgmentSampleCount: g.judgmentAttempts.length,
      sampleCount: abs.summary.sampleCount,
      correctCount: aggEntry?.counts?.correct ?? 0,
      failedCount: aggEntry?.counts?.failed ?? 0,
      timeoutCount: aggEntry?.counts?.timeout ?? 0,
      missingEvidenceCount: aggEntry?.counts?.missingEvidence ?? 0,
      p50Ms: abs.summary.p50Ms,
      p95Ms: abs.summary.p95Ms,
      p99Ms: abs.summary.p99Ms,
      medianMs: abs.summary.medianMs,
      maxMs: abs.summary.maxMs,
      absoluteVerdict: abs.verdict,
      relativeVerdict: relative.verdict,
      verdict: aggEntry?.verdict ?? "NOT RUN",
      effectiveVerdict: aggEntry?.effectiveVerdict ?? aggEntry?.verdict ?? "NOT RUN",
      reasons: aggEntry?.reasons ?? [],
      correctness: corr,
      provider: provider
        ? {
            providerErrorCount: provider.providerErrorCount,
            retryCount: provider.retryCount,
            rerunCount: provider.rerunCount,
            providerErrorShare: provider.providerErrorShare
          }
        : { providerErrorCount: 0, retryCount: 0, rerunCount: 0, providerErrorShare: 0 },
      baselineKey: baseline ? g.key : null,
      baselinePresent: !!baseline
    };
  }

  return { tier, scenarios, aggregate, problems };
}

// ---------------------------------------------------------------------------
// baseline construction / acceptance
// ---------------------------------------------------------------------------

/**
 * Build a baseline candidate from the raw attempts. The numbers are recomputed
 * from the evidence, never copied from the runner's summary, and the candidate
 * stays SEED_ONLY until a named acceptance promotes it.
 */
export function buildBaselineCandidate({ summary, attempts, evidenceBodyDigest = null, generatedAt = null } = {}) {
  const problems = [];
  if (!isPlainObject(summary)) throw new Error("buildBaselineCandidate requires a summary");
  if (!Array.isArray(attempts)) throw new Error("buildBaselineCandidate requires attempts[]");
  const recomputed = recomputeFromAttempts(attempts, { tier: summary.tier ?? "formal" });
  problems.push(...recomputed.problems);
  const digest = evidenceBodyDigest ?? summary.evidenceBodyDigest ?? null;
  const scenarios = [];
  for (const s of Object.values(recomputed.scenarios)) {
    const first = attempts.find((a) => scenarioGroupKey(a) === s.key) ?? {};
    scenarios.push({
      scenarioId: s.scenarioId,
      lane: s.lane,
      cacheState: s.cacheState,
      concurrencyGroup: s.concurrencyGroup,
      clientModel: s.clientModel,
      environment: s.environment,
      budgetClass: s.budgetClass,
      runId: summary.runId ?? null,
      sampleCount: s.sampleCount,
      correctCount: s.correctCount,
      failedCount: s.failedCount,
      timeoutCount: s.timeoutCount,
      p50Ms: s.p50Ms,
      p95Ms: s.p95Ms,
      p99Ms: s.p99Ms,
      medianMs: s.medianMs,
      maxMs: s.maxMs,
      questionSetDigest: first.questionSetDigest ?? summary.questionSetDigest ?? null,
      configDigest: first.configDigest ?? summary.configDigest ?? null,
      fixtureDigest: first.fixtureDigest ?? summary.fixtureDigest ?? null,
      budgetDigest: first.budgetDigest ?? summary.budgetDigest ?? null,
      candidateFingerprint: summary.candidateFingerprint ?? null,
      environmentFingerprint: first.environmentFingerprint ?? summary.environmentFingerprint ?? null,
      clientFingerprint: first.clientFingerprint ?? summary.clientFingerprint ?? null,
      modelFingerprint: first.modelFingerprint ?? summary.modelFingerprint ?? null,
      evidenceBodyDigest: digest,
      providerErrorCount: s.provider.providerErrorCount,
      retryCount: s.provider.retryCount,
      rerunCount: s.provider.rerunCount,
      acceptedBy: null,
      acceptedAt: null
    });
  }
  return {
    contract: BASELINE_CONTRACT,
    questionSetVersion: summary.questionSetVersion ?? null,
    environmentProfile: summary.environmentProfile ?? null,
    clientModelHash: summary.clientModelHash ?? null,
    gitSha: summary.gitSha ?? null,
    status: "SEED_ONLY",
    releaseReady: false,
    acceptedBy: null,
    acceptedAt: null,
    runId: summary.runId ?? null,
    evidenceBodyDigest: digest,
    generatedAt: generatedAt ?? summary.generatedAt ?? null,
    scenarios,
    problems
  };
}

export function baselineFileName({ questionSetVersion, environmentProfile, clientModelHash, gitSha }) {
  return [questionSetVersion, environmentProfile, clientModelHash, gitSha]
    .map((p) => String(p ?? "unknown"))
    .join("-") + ".json";
}

/**
 * Write a SEED_ONLY baseline candidate. It never touches LATEST.json — a
 * normal run must not promote itself (Spec §6.1).
 */
export function writeBaselineCandidate({ baselinesDir, baseline }) {
  const validation = validateBaseline(baseline, { requireAcceptance: false });
  if (!validation.ok) {
    const err = new Error(`writeBaselineCandidate refused: ${validation.problems.map((p) => p.message).join("; ")}`);
    err.problems = validation.problems;
    throw err;
  }
  mkdirSync(baselinesDir, { recursive: true });
  const file = baselineFileName(baseline);
  const body = `${JSON.stringify(baseline, null, 2)}\n`;
  writeFileAtomic(path.join(baselinesDir, file), body);
  return { path: path.join(baselinesDir, file), file, digest: sha256Hex(body), baseline };
}

/**
 * Explicit, named acceptance of a baseline candidate. This is the only entry
 * point that may update LATEST.json.
 */
export function acceptBaseline({ baselinesDir, baseline, acceptedBy, acceptedAt = null }) {
  if (!acceptedBy || String(acceptedBy).trim() === "") {
    throw new Error("acceptBaseline requires a named approver (acceptedBy)");
  }
  if (baseline?.status === "waived") {
    throw new Error("acceptBaseline refused: a waived run must never become a baseline (D22③)");
  }
  const stamped = {
    ...baseline,
    status: "PASS",
    releaseReady: true,
    acceptedBy,
    acceptedAt: acceptedAt ?? new Date().toISOString(),
    scenarios: (baseline.scenarios ?? []).map((s) => ({ ...s, acceptedBy, acceptedAt: acceptedAt ?? new Date().toISOString() }))
  };
  const validation = validateBaseline(stamped, { requireAcceptance: true });
  if (!validation.ok) {
    const err = new Error(`acceptBaseline refused: ${validation.problems.map((p) => p.message).join("; ")}`);
    err.problems = validation.problems;
    throw err;
  }
  mkdirSync(baselinesDir, { recursive: true });
  const file = baselineFileName(stamped);
  const body = `${JSON.stringify(stamped, null, 2)}\n`;
  writeFileAtomic(path.join(baselinesDir, file), body);
  const pointer = {
    contract: BASELINE_POINTER_CONTRACT,
    baselineFile: file,
    baselineDigest: sha256Hex(body),
    acceptedBy,
    acceptedAt: stamped.acceptedAt,
    questionSetVersion: stamped.questionSetVersion,
    environmentProfile: stamped.environmentProfile,
    clientModelHash: stamped.clientModelHash,
    gitSha: stamped.gitSha
  };
  writeFileAtomic(path.join(baselinesDir, LATEST_POINTER_FILE), `${JSON.stringify(pointer, null, 2)}\n`);
  return {
    path: path.join(baselinesDir, file),
    file,
    digest: pointer.baselineDigest,
    pointer,
    baseline: stamped
  };
}

/** Read LATEST.json read-only and resolve the baseline it points at. */
export function readLatestPointer(baselinesDir) {
  const pointerPath = path.join(baselinesDir, LATEST_POINTER_FILE);
  if (!existsSync(pointerPath)) {
    return { present: false, pointer: null, baseline: null, problems: [] };
  }
  const problems = [];
  let pointer = null;
  try {
    pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
  } catch (err) {
    problems.push(problem("SCHEMA_INVALID", `LATEST.json is not valid JSON: ${err.message}`, "blocked"));
    return { present: true, pointer: null, baseline: null, problems };
  }
  problems.push(...validateLatestPointer(pointer).problems);
  let baseline = null;
  const baselinePath = pointer?.baselineFile ? path.join(baselinesDir, pointer.baselineFile) : null;
  if (baselinePath && existsSync(baselinePath)) {
    const raw = readFileSync(baselinePath);
    const digest = sha256Hex(raw);
    if (pointer?.baselineDigest && pointer.baselineDigest !== digest) {
      problems.push(
        problem("DIGEST_MISMATCH", `LATEST.json baselineDigest does not match ${pointer.baselineFile}`, "failed")
      );
    }
    try {
      baseline = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      problems.push(problem("SCHEMA_INVALID", `${pointer.baselineFile} is not valid JSON: ${err.message}`, "blocked"));
    }
  } else {
    problems.push(problem("MISSING_EVIDENCE", `LATEST.json points at a missing baseline file`, "blocked"));
  }
  return { present: true, pointer, baseline, problems };
}

// ---------------------------------------------------------------------------
// waivers (D22)
// ---------------------------------------------------------------------------

/** Digest of a waiver record over its canonical content (without the digest itself). */
export function computeWaiverDigest(waiver) {
  const copy = { ...(waiver ?? {}) };
  delete copy.waiverDigest;
  return sha256Hex(canonicalJson(copy));
}

/** Extract the structured waiver from a markdown or json waiver file. */
export function parseWaiverFile(text, { filePath = null } = {}) {
  const body = String(text ?? "");
  const problems = [];
  if (/\.json$/i.test(filePath ?? "")) {
    try {
      return { waiver: JSON.parse(body), problems };
    } catch (err) {
      return { waiver: null, problems: [problem("WAIVER_INVALID", `waiver json is invalid: ${err.message}`, "failed")] };
    }
  }
  const fenced = body.match(/```json[ \t]*\r?\n([\s\S]*?)```/);
  if (!fenced) {
    return {
      waiver: null,
      problems: [problem("WAIVER_INVALID", "waiver file has no ```json waiver block", "failed")]
    };
  }
  try {
    return { waiver: JSON.parse(fenced[1]), problems };
  } catch (err) {
    return { waiver: null, problems: [problem("WAIVER_INVALID", `waiver block is invalid JSON: ${err.message}`, "failed")] };
  }
}

function waiverProblemCode(message) {
  if (/expired/i.test(message)) return "WAIVER_EXPIRED";
  if (/candidateDigest/i.test(message)) return "WAIVER_CANDIDATE_MISMATCH";
  if (/outside the eligible|scope/i.test(message)) return "WAIVER_SCOPE_EXCEEDED";
  if (/verdict .* does not match/i.test(message)) return "WAIVER_SCOPE_EXCEEDED";
  return "WAIVER_INVALID";
}

/**
 * Verify one D22 waiver: content digest, expiry, candidate binding and scope.
 * The structural judgment is delegated to the judge's validateWaiver().
 */
export function verifyWaiverFile({ text, filePath = null, waiver = null, context = {} }) {
  const problems = [];
  let doc = waiver;
  if (doc == null) {
    const parsed = parseWaiverFile(text, { filePath });
    problems.push(...parsed.problems);
    doc = parsed.waiver;
  }
  if (!doc) {
    return { valid: false, waiver: null, problems, releaseReady: null };
  }
  if (doc.waiverDigest != null) {
    const recomputed = computeWaiverDigest(doc);
    if (recomputed !== doc.waiverDigest) {
      problems.push(
        problem(
          "WAIVER_DIGEST_MISMATCH",
          `waiver digest ${doc.waiverDigest} does not match the recomputed content digest ${recomputed}`,
          "failed"
        )
      );
    }
  } else {
    problems.push(problem("WAIVER_INVALID", "waiver record has no waiverDigest", "failed"));
  }
  const judged = validateWaiver(doc, context);
  for (const message of judged.problems) {
    problems.push(problem(waiverProblemCode(message), message, "failed"));
  }
  return {
    valid: problems.length === 0,
    waiver: doc,
    problems,
    releaseReady: problems.length === 0 ? "waived" : null
  };
}

/**
 * Verify a set of waiver files against a run. Returns the accepted waivers and
 * the rejected ones with a reason code each.
 */
export function verifyWaivers({ waivers = [], context = {} }) {
  const accepted = [];
  const rejected = [];
  for (const w of waivers) {
    const text = typeof w === "string" ? w : null;
    const doc = typeof w === "string" ? null : w.waiver ?? w;
    const result = verifyWaiverFile({
      text,
      filePath: typeof w === "object" ? (w.filePath ?? null) : null,
      waiver: doc,
      context
    });
    if (result.valid) accepted.push(result.waiver);
    else rejected.push({ id: result.waiver?.id ?? null, problems: result.problems });
  }
  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// the independent verifier
// ---------------------------------------------------------------------------

const STAT_FIELDS = Object.freeze([
  "plannedCount",
  "sampleCount",
  "correctCount",
  "failedCount",
  "timeoutCount",
  "p50Ms",
  "p95Ms",
  "p99Ms",
  "medianMs",
  "maxMs"
]);

const VERDICT_FIELDS = Object.freeze(["absoluteVerdict", "relativeVerdict", "verdict"]);

/**
 * Compare the recomputed scenario with the recorded claim.
 * A statistical difference is always a tamper (FAIL). A gate that could not
 * run (BLOCKED) is reported as BLOCKED — the evidence is not proven wrong,
 * it cannot be judged (Spec D15).
 */
function compareScenarioFields(recomputed, claimed, { relativeVerifiable = true } = {}) {
  const problems = [];
  for (const f of STAT_FIELDS) {
    if (claimed[f] === undefined) continue;
    if (!sameValue(recomputed[f], claimed[f])) {
      problems.push(
        problem(
          "EVIDENCE_MISMATCH",
          `scenario ${recomputed.scenarioId}: ${f}: recomputed ${JSON.stringify(recomputed[f])} vs claimed ${JSON.stringify(claimed[f])}`,
          "failed"
        )
      );
    }
  }
  for (const f of VERDICT_FIELDS) {
    if (claimed[f] === undefined) continue;
    const r = recomputed[f];
    const c = claimed[f];
    if (r === c) continue;
    if (f === "relativeVerdict" && !relativeVerifiable) {
      problems.push(
        problem(
          "RELATIVE_GATE_NOT_VERIFIABLE",
          `scenario ${recomputed.scenarioId}: the relative gate cannot be verified without the accepted baseline (claimed ${c})`,
          "blocked"
        )
      );
      continue;
    }
    if (r === "BLOCKED") {
      problems.push(
        problem(
          "GATE_BLOCKED",
          `scenario ${recomputed.scenarioId}: ${f} recomputed BLOCKED vs claimed ${c}`,
          "blocked"
        )
      );
      continue;
    }
    problems.push(
      problem(
        "EVIDENCE_MISMATCH",
        `scenario ${recomputed.scenarioId}: ${f}: recomputed ${r} vs claimed ${c}`,
        "failed"
      )
    );
  }
  return problems;
}

/**
 * Independent verifier. Re-reads the raw evidence, recomputes denominators,
 * percentiles, budgets, the relative gate and the total verdict, and compares
 * them with the recorded summary. The summary's top-level status / verdicts /
 * releaseReady are untrusted display values.
 */
export function verifyEvidenceBundle({
  evidenceDir,
  baseline = null,
  now = Date.now(),
  waivers = [],
  secrets = [],
  customerObjectNames = [],
  requireNegativeControls = true
} = {}) {
  const problems = [];
  const bundle = readEvidenceBundle(evidenceDir);
  problems.push(...bundle.problems);

  const attemptValidation = validateAttempts(bundle.attempts);
  problems.push(...attemptValidation.problems);

  const summary = bundle.summary;
  const summaryValidation = summary ? validateSummary(summary) : { ok: false, problems: [] };
  problems.push(...summaryValidation.problems);

  const tier = summary?.tier ?? "formal";
  const plannedCounts = {};
  for (const s of summary?.scenarios ?? []) {
    if (s?.key) plannedCounts[s.key] = s.plannedCount;
    else plannedCounts[scenarioGroupKey(s)] = s.plannedCount;
  }

  const baselineScenarios = baseline?.scenarios ?? null;
  if (baseline) {
    const baselineValidation = validateBaseline(baseline);
    if (!baselineValidation.ok) {
      for (const p of baselineValidation.problems) {
        problems.push(problem(p.code, `baseline: ${p.message}`, p.severity));
      }
    }
  }

  // Fingerprint consistency: run level vs evidence level (D9).
  const fingerprintMismatches = [];
  if (summary) {
    for (const f of DIGEST_FIELDS) {
      const claimed = summary[f];
      const observed = new Set(
        bundle.attempts.map((a) => a?.[f]).filter((v) => v != null && v !== "")
      );
      if (claimed == null || claimed === "") continue;
      for (const v of observed) {
        if (v !== claimed) fingerprintMismatches.push(`${f}: summary ${claimed} vs attempt ${v}`);
      }
    }
    for (const f of DIGEST_FIELDS) {
      const seen = new Set(bundle.attempts.map((a) => a?.[f]).filter((v) => v != null && v !== ""));
      if (seen.size > 1) fingerprintMismatches.push(`${f}: attempts disagree (${[...seen].join(", ")})`);
    }
  }
  if (fingerprintMismatches.length) {
    problems.push(
      problem("FINGERPRINT_MISMATCH", `fingerprints are not comparable: ${fingerprintMismatches.join("; ")}`, "failed")
    );
  }

  // Baseline comparability against the run (D9).
  if (baseline && summary) {
    for (const b of baseline.scenarios ?? []) {
      const key = scenarioGroupKey(b);
      const attempt = bundle.attempts.find((a) => scenarioGroupKey(a) === key);
      if (!attempt) continue;
      for (const f of ["questionSetDigest", "configDigest", "fixtureDigest", "budgetDigest", "clientFingerprint", "modelFingerprint", "environmentFingerprint"]) {
        const bv = b[f];
        const av = attempt[f];
        if (bv == null || av == null) continue;
        if (bv !== av) {
          problems.push(
            problem("FINGERPRINT_MISMATCH", `baseline ${b.scenarioId}: ${f} differs from the run (${bv} vs ${av})`, "blocked")
          );
        }
      }
    }
  }

  const recomputed = recomputeFromAttempts(bundle.attempts, {
    tier,
    baselineScenarios,
    legalControls: summary?.legalControls ?? [],
    waivers: [],
    candidateDigest: summary?.candidateFingerprint ?? null,
    now,
    soak: summary?.soak ?? null,
    longFollow: summary?.longFollow ?? null,
    plannedCounts
  });
  problems.push(...recomputed.problems);

  // --- compare the recomputation with the recorded summary -----------------
  const claimedByKey = new Map();
  for (const s of summary?.scenarios ?? []) {
    claimedByKey.set(s.key ?? scenarioGroupKey(s), s);
  }
  const relativeVerifiable = !!baseline && Array.isArray(baseline.scenarios) && baseline.scenarios.length > 0;
  for (const [key, r] of Object.entries(recomputed.scenarios)) {
    const claimed = claimedByKey.get(key);
    if (!claimed) {
      problems.push(
        problem("EVIDENCE_MISMATCH", `evidence holds the scenario group ${key} that the summary does not list`, "failed")
      );
      continue;
    }
    problems.push(...compareScenarioFields(r, claimed, { relativeVerifiable }));
  }
  for (const [key, claimed] of claimedByKey.entries()) {
    if (!recomputed.scenarios[key]) {
      problems.push(
        problem("EVIDENCE_MISMATCH", `summary lists the scenario group ${key} that the evidence does not contain`, "failed")
      );
    }
  }

  // --- digest of the evidence body vs the digest recorded in the summary ---
  if (summary?.evidenceBodyDigest && bundle.attemptsDigest) {
    if (summary.evidenceBodyDigest !== bundle.attemptsDigest) {
      problems.push(
        problem(
          "DIGEST_MISMATCH",
          `summary evidenceBodyDigest ${summary.evidenceBodyDigest} does not match the recomputed body digest ${bundle.attemptsDigest}`,
          "failed"
        )
      );
    }
  }
  if (summary?.negativeControlsDigest && bundle.negativeControlsDigest) {
    if (summary.negativeControlsDigest !== bundle.negativeControlsDigest) {
      problems.push(
        problem(
          "DIGEST_MISMATCH",
          `summary negativeControlsDigest does not match the recomputed negative controls digest`,
          "failed"
        )
      );
    }
  }

  // --- negative controls (D12) --------------------------------------------
  if (!bundle.negativeControls) {
    if (requireNegativeControls) {
      problems.push(problem("MISSING_EVIDENCE", `missing ${NEGATIVE_CONTROLS_FILE}`, "blocked"));
    }
  } else {
    const ncValidation = validateNegativeControls(bundle.negativeControls);
    problems.push(...ncValidation.problems);
    for (const c of bundle.negativeControls.controls ?? []) {
      if (c?.expected === "FAIL" && c?.detected !== true) {
        problems.push(
          problem(
            "NEGATIVE_CONTROL_UNDETECTED",
            `negative control ${c?.id ?? "?"} was not detected by the judge`,
            "failed"
          )
        );
      }
      if (c?.expected === "FAIL" && c?.observed !== "FAIL") {
        problems.push(
          problem(
            "NEGATIVE_CONTROL_UNDETECTED",
            `negative control ${c?.id ?? "?"} was expected to be rejected but the observed verdict is ${JSON.stringify(c?.observed)}`,
            "failed"
          )
        );
      }
    }
    if (bundle.negativeControls.allDetected !== true) {
      problems.push(
        problem("NEGATIVE_CONTROL_UNDETECTED", "negative-controls.allDetected is not true", "failed")
      );
    }
  }

  // --- waivers (D22) -------------------------------------------------------
  const plainVerdicts = {};
  for (const s of Object.values(recomputed.scenarios)) {
    const v = s.effectiveVerdict;
    plainVerdicts[s.scenarioId] = plainVerdicts[s.scenarioId]
      ? worstVerdict(plainVerdicts[s.scenarioId], v)
      : v;
  }
  const eligibleScenarioIds = Object.entries(plainVerdicts)
    .filter(([, v]) => v !== "PASS")
    .map(([k]) => k);
  const waiverContext = {
    candidateDigest: summary?.candidateFingerprint ?? null,
    now,
    eligibleScenarioIds,
    verdicts: plainVerdicts
  };
  const waiverResult = verifyWaivers({ waivers, context: waiverContext });
  for (const r of waiverResult.rejected) {
    for (const p of r.problems) {
      problems.push(problem(p.code, `waiver ${r.id ?? "?"}: ${p.message}`, p.severity));
    }
  }
  // A waiver that names an evidence body must name THIS run's evidence body.
  for (const w of waiverResult.accepted) {
    if (w.evidenceBodyDigest == null) continue;
    if (w.evidenceBodyDigest !== bundle.attemptsDigest) {
      problems.push(
        problem(
          "WAIVER_DIGEST_MISMATCH",
          `waiver ${w.id ?? "?"} binds evidenceBodyDigest ${w.evidenceBodyDigest} but the run body digest is ${bundle.attemptsDigest}`,
          "failed"
        )
      );
    }
  }

  // --- recompute the total verdict and release readiness -------------------
  const status = recomputed.aggregate.status;
  let waiverCovered = false;
  if (status !== "PASS" && waiverResult.accepted.length) {
    const covered = new Set(
      waiverResult.accepted.flatMap((w) => (w.scenarios ?? []).map((x) => x.scenarioId))
    );
    const uncovered = eligibleScenarioIds.filter((sid) => !covered.has(sid));
    if (uncovered.length === 0) {
      waiverCovered = true;
    } else {
      problems.push(
        problem(
          "WAIVER_SCOPE_EXCEEDED",
          `valid waivers do not cover every non-PASS scenario: ${uncovered.join(", ")}`,
          "blocked"
        )
      );
    }
  }

  // --- leak scan of the public evidence ------------------------------------
  const publicTexts = [bundle.attemptsRaw?.toString("utf8"), bundle.summaryRaw?.toString("utf8")].filter(Boolean);
  for (const text of publicTexts) {
    const leak = scanEvidenceForLeaks(text, { secrets, customerObjectNames });
    if (leak.length) {
      problems.push(
        problem("LEAK_DETECTED", `public evidence leaks ${leak.map((h) => h.kind).join(", ")}`, "failed")
      );
    }
  }

  // Provisional verdict before the runner's own claim is compared.
  const provisionalFailed = problems.filter((p) => p.severity === "failed");
  const provisionalBlocked = problems.filter((p) => p.severity === "blocked");
  let verdict = status;
  if (provisionalFailed.length) verdict = "FAIL";
  else if (provisionalBlocked.length) verdict = worstVerdict(verdict, "BLOCKED");

  // releaseReady: true only on PASS. "waived" only from a valid D22 waiver
  // that covers every non-PASS scenario — and never when the evidence itself
  // failed the integrity checks (a tampered run is never waived).
  let releaseReady = false;
  if (verdict === "PASS") releaseReady = true;
  else if (waiverCovered && !provisionalFailed.length) releaseReady = "waived";

  // The runner's own top-level claim is display only — a mismatch is a tamper.
  if (summary?.status && summary.status !== status) {
    problems.push(
      status === "BLOCKED" || status === "SEED_ONLY" || status === "NOT RUN"
        ? problem(
            "GATE_BLOCKED",
            `summary status ${summary.status} vs recomputed ${status}; the run cannot be judged as PASS`,
            "blocked"
          )
        : problem("EVIDENCE_MISMATCH", `summary status ${summary.status} vs recomputed ${status}`, "failed")
    );
  }
  if (summary && summary.releaseReady !== releaseReady) {
    problems.push(
      status === "BLOCKED" || status === "SEED_ONLY" || status === "NOT RUN"
        ? problem(
            "GATE_BLOCKED",
            `summary releaseReady ${JSON.stringify(summary.releaseReady)} vs recomputed ${JSON.stringify(releaseReady)}`,
            "blocked"
          )
        : problem(
            "EVIDENCE_MISMATCH",
            `summary releaseReady ${JSON.stringify(summary.releaseReady)} vs recomputed ${JSON.stringify(releaseReady)}`,
            "failed"
          )
    );
  }

  const failed = problems.filter((p) => p.severity === "failed");
  const blocked = problems.filter((p) => p.severity === "blocked");
  if (failed.length) {
    verdict = "FAIL";
    releaseReady = false;
  } else {
    if (blocked.length) verdict = worstVerdict(verdict, "BLOCKED");
    if (verdict === "PASS") releaseReady = true;
    else if (waiverCovered) releaseReady = "waived";
    else releaseReady = false;
  }

  return {
    ok: verdict === "PASS",
    verdict,
    releaseReady,
    status,
    problems,
    recomputed: {
      status,
      releaseReady,
      scenarios: recomputed.scenarios
    },
    claimed: summary
      ? {
          status: summary.status,
          releaseReady: summary.releaseReady,
          verdicts: summary.verdicts ?? null
        }
      : null,
    evidenceBodyDigest: {
      claimed: summary?.evidenceBodyDigest ?? null,
      actual: bundle.attemptsDigest,
      match: !!summary?.evidenceBodyDigest && summary.evidenceBodyDigest === bundle.attemptsDigest
    },
    attempts: {
      count: bundle.attempts.length,
      duplicateAttemptIds: attemptValidation.problems
        .filter((p) => p.code === "DUPLICATE_ATTEMPT_ID")
        .map((p) => p.message)
    },
    baseline: {
      present: !!baseline,
      valid: baseline ? validateBaseline(baseline).ok : null,
      problems: baseline ? validateBaseline(baseline).problems : []
    },
    waiver: {
      accepted: waiverResult.accepted.map((w) => w.id),
      rejected: waiverResult.rejected,
      eligibleScenarioIds
    }
  };
}
