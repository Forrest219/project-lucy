/**
 * P1-53 Task 4 (D26 / SC-16 / SC-21 / SC-24) — dual public MCP compatibility evidence.
 *
 * Stable contract for B1 runner writers and this verifier. Assembler only registers
 * path + byte SHA256. Verifier reloads the JSON files and RECOMPUTES denominator /
 * threeAxis / aggregate summary via mcp-compatibility.mjs — it never trusts runner
 * top-level `status` / `summary` / claimed `verdicts`.
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md §5.1 / D26
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 4
 *
 * ## B1 field contract (import `MCP_COMPAT_EVIDENCE_FIELD_CONTRACT`)
 *
 * Write `results/mcp-compatibility-candidate.json` (kind=candidate) and/or
 * `results/mcp-compatibility-instance.json` (kind=instance) with:
 *   contract, kind, entrypoint, suiteDigest, candidateDigest, clientFingerprint,
 *   modelFingerprint, configProfileFingerprint, batchWallClockMs, denominator,
 *   cases[], coverageMode ("full"|"ci-subset").
 * Instance also needs phases.POST + snapshotId.
 * cases[].attempts must retain every attempt (D13). Raw mcp/agent samples live on
 * the doc or per-case so the verifier can call threeAxis/aggregateCompatibility.
 * Top-level status/summary/verdicts are optional and UNTRUSTED.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  AGENT_MIN_SAMPLES,
  MCP_MIN_SAMPLES,
  aggregateCompatibility,
  digestJourneySuite,
  threeAxis,
  validateJourneySuite
} from "./mcp-compatibility.mjs";
import { scanText } from "./leak-scan.mjs";

/** Evidence document contract id (B1 must write this exact string). */
export const MCP_COMPAT_EVIDENCE_CONTRACT = "lucy-mcp-compatibility-evidence-v1";

export const CANDIDATE_EVIDENCE_REL = "results/mcp-compatibility-candidate.json";
export const INSTANCE_EVIDENCE_REL = "results/mcp-compatibility-instance.json";

export const EVIDENCE_KINDS = Object.freeze(["candidate", "instance"]);
export const COVERAGE_MODES = Object.freeze(["full", "ci-subset"]);
export const CASE_STATUSES = Object.freeze(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);

/**
 * Field contract B1 must satisfy when writing public evidence JSON.
 * Keep this object as the single documented shape both runner and verifier import.
 */
export const MCP_COMPAT_EVIDENCE_FIELD_CONTRACT = Object.freeze({
  contract: MCP_COMPAT_EVIDENCE_CONTRACT,
  requiredTopLevel: Object.freeze([
    "contract",
    "kind",
    "entrypoint",
    "suiteDigest",
    "candidateDigest",
    "clientFingerprint",
    "modelFingerprint",
    "configProfileFingerprint",
    "batchWallClockMs",
    "denominator",
    "cases",
    "coverageMode"
  ]),
  untrustedTopLevel: Object.freeze(["status", "summary", "verdicts", "reasons"]),
  kindValues: EVIDENCE_KINDS,
  coverageModeValues: COVERAGE_MODES,
  candidateRelPath: CANDIDATE_EVIDENCE_REL,
  instanceRelPath: INSTANCE_EVIDENCE_REL,
  caseFields: Object.freeze({
    required: Object.freeze(["id", "status", "attempts"]),
    optionalObservation: Object.freeze([
      "expectedOutcome",
      "observedOutcome",
      "expectedNonempty",
      "baselineNonempty",
      "observedRowCount",
      "envelopeEmpty",
      "expectedMetrics",
      "observedMetrics",
      "mcp",
      "agent"
    ])
  }),
  instanceExtra: Object.freeze(["phases", "snapshotId", "baselineCompare"]),
  secretsForbidden: Object.freeze([
    "token",
    "bearer",
    "session",
    "password",
    "private baseline row payloads"
  ]),
  notes:
    "Assembler registers only {path, sha256}. Verifier reloads bytes, recomputes digest/denominator/threeAxis/summary. CI subset (coverageMode=ci-subset) can never set releaseReady=true."
});

function sha256Bytes(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function problem(code, message, severity = "failed") {
  return { severity, code, message };
}

/**
 * Register a public evidence file for an assembler index. Only path + byte SHA256.
 * Does not read or trust status/summary.
 *
 * @param {string} runDir absolute run directory
 * @param {"candidate"|"instance"} kind
 * @returns {{ path: string, sha256: string, kind: string, present: boolean }}
 */
export function registerMcpCompatibilityEvidence(runDir, kind) {
  if (!EVIDENCE_KINDS.includes(kind)) {
    throw new Error(`registerMcpCompatibilityEvidence: unknown kind "${kind}"`);
  }
  const rel = kind === "candidate" ? CANDIDATE_EVIDENCE_REL : INSTANCE_EVIDENCE_REL;
  const abs = path.join(runDir, rel);
  if (!existsSync(abs)) {
    return { path: rel, sha256: "0".repeat(64), kind, present: false };
  }
  const raw = readFileSync(abs);
  return { path: rel, sha256: sha256Bytes(raw), kind, present: true };
}

/**
 * Assemble dual-file registry entries (candidate + instance). Missing files are
 * recorded with present=false and a zero digest — never invented as PASS.
 *
 * @param {{ runDir: string }} opts
 */
export function assembleMcpCompatibilityEvidenceIndex({ runDir }) {
  if (!runDir || typeof runDir !== "string") {
    throw new Error("assembleMcpCompatibilityEvidenceIndex requires runDir");
  }
  return {
    contract: MCP_COMPAT_EVIDENCE_CONTRACT,
    artifacts: [
      registerMcpCompatibilityEvidence(runDir, "candidate"),
      registerMcpCompatibilityEvidence(runDir, "instance")
    ]
  };
}

function loadEvidenceFile(runDir, rel) {
  const abs = path.join(runDir, rel);
  if (!existsSync(abs)) {
    return { present: false, abs, rel, raw: null, doc: null, sha256: null };
  }
  const raw = readFileSync(abs);
  const sha256 = sha256Bytes(raw);
  let doc;
  try {
    doc = JSON.parse(raw.toString("utf8"));
  } catch {
    return { present: true, abs, rel, raw, doc: null, sha256, parseError: true };
  }
  return { present: true, abs, rel, raw, doc, sha256 };
}

const SECRETISH_KEY_ALLOWLIST = new Set([
  "tokenusage",
  "modelcallcount",
  "clientfingerprint",
  "modelfingerprint",
  "configprofilefingerprint",
  "candidatedigest",
  "suitedigest",
  "tokenref",
  "tokenlabel",
  "tokenid"
]);

function isSecretishKey(key) {
  const k = String(key).toLowerCase();
  if (SECRETISH_KEY_ALLOWLIST.has(k)) return false;
  const looksLikeTokenField =
    k.endsWith("token") &&
    !k.includes("fingerprint") &&
    !k.includes("usage") &&
    !k.includes("ref") &&
    !k.includes("label") &&
    !k.includes("id");
  return (
    k === "token" ||
    k === "accesstoken" ||
    k === "bearertoken" ||
    looksLikeTokenField ||
    k.includes("password") ||
    k.includes("secret") ||
    (k.includes("session") && !k.includes("ref")) ||
    k === "authorization" ||
    k === "bearer"
  );
}

function collectSecretishLeaves(value, pathParts, out) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectSecretishLeaves(v, [...pathParts, String(i)], out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (
        isSecretishKey(k) &&
        typeof v === "string" &&
        v.trim() &&
        !/^\[?REDACTED\]?$/i.test(v) &&
        v !== "not_available"
      ) {
        out.push({ path: [...pathParts, k].join("."), value: v });
      }
      collectSecretishLeaves(v, [...pathParts, k], out);
    }
  }
}

function minimalSuiteFromDenominator(doc) {
  const ids = doc?.denominator?.expectedCaseIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return {
      questionBankId: "lucy-mcp-upgrade-question-bank",
      version: 1,
      requiredConfigFingerprint: doc?.configProfileFingerprint ?? "sha256:missing",
      cases: []
    };
  }
  const cases = ids.map((id) => {
    let family = "follow-up";
    if (/ACL|PERM|permission/i.test(id)) family = "permission";
    else if (/DB|OPS|multi/i.test(id)) family = "multi-connection";
    else if (/FOLLOW/i.test(id)) family = "follow-up";
    return { id, family, turns: [{ text: "placeholder" }] };
  });
  const families = new Set(cases.map((c) => c.family));
  for (const [family, id] of [
    ["follow-up", "__synth-follow__"],
    ["permission", "__synth-perm__"],
    ["multi-connection", "__synth-multi__"]
  ]) {
    if (!families.has(family)) cases.push({ id, family, turns: [{ text: "placeholder" }] });
  }
  return {
    questionBankId: "lucy-mcp-upgrade-question-bank",
    version: doc?.suiteVersion ?? 1,
    requiredConfigFingerprint: doc?.configProfileFingerprint,
    cases
  };
}

/**
 * Recompute three-axis + aggregate from raw case observations (never from claimed verdicts).
 * @param {object} doc evidence document
 * @param {object} [suite] optional journey suite for aggregate gates
 */
export function recomputeFromEvidenceDoc(doc, suite) {
  const cases = Array.isArray(doc?.cases) ? doc.cases : [];
  const functionalCases = cases.map((c) => ({
    id: c.id,
    expectedOutcome: c.expectedOutcome,
    observedOutcome: c.observedOutcome,
    expectedNonempty: c.expectedNonempty,
    baselineNonempty: c.baselineNonempty,
    observedRowCount: c.observedRowCount,
    envelopeEmpty: c.envelopeEmpty,
    expectedMetrics: c.expectedMetrics,
    observedMetrics: c.observedMetrics
  }));

  let mcp = doc.mcp ?? null;
  let agent = doc.agent ?? null;
  if (!mcp) {
    const samplesMs = [];
    let budgetClass = "simple";
    let baselineP95Ms;
    for (const c of cases) {
      if (c.mcp?.samplesMs) samplesMs.push(...c.mcp.samplesMs);
      if (c.mcp?.budgetClass) budgetClass = c.mcp.budgetClass;
      if (typeof c.mcp?.baselineP95Ms === "number") baselineP95Ms = c.mcp.baselineP95Ms;
    }
    if (samplesMs.length) mcp = { budgetClass, samplesMs, baselineP95Ms };
  }
  if (!agent) {
    const turns = [];
    let baselineMedianMs;
    let attribution;
    for (const c of cases) {
      if (Array.isArray(c.agent?.turns)) turns.push(...c.agent.turns);
      if (typeof c.agent?.baselineMedianMs === "number") baselineMedianMs = c.agent.baselineMedianMs;
      if (c.agent?.attribution) attribution = c.agent.attribution;
    }
    if (turns.length) agent = { turns, baselineMedianMs, attribution };
  }

  const verdicts = threeAxis({ functionalCases, mcp, agent });
  const aggregate = aggregateCompatibility({
    entrypoint: doc.entrypoint ?? (doc.kind === "instance" ? "certifyInstanceUpgrade" : "certifyCandidate"),
    suite: suite ?? doc.suite ?? minimalSuiteFromDenominator(doc),
    configProfileFingerprint: doc.configProfileFingerprint,
    functionalCases,
    mcp,
    agent,
    verdicts,
    batchWallClockMs: doc.batchWallClockMs,
    clientFingerprint: doc.clientFingerprint,
    modelFingerprint: doc.modelFingerprint,
    baseline: doc.baseline,
    candidateEvidence: doc.candidateEvidence,
    modelCallCount: doc.modelCallCount,
    tokenUsage: doc.tokenUsage,
    estimatedCostUsd: doc.estimatedCostUsd
  });

  return { verdicts, aggregate, functionalCases, mcp, agent };
}

/**
 * Recompute denominator completeness: every expected id present, no silent deletes,
 * and no case left as NOT RUN when claiming PASS.
 */
export function recomputeDenominator(doc, expectedCaseIds) {
  const expected = Array.isArray(expectedCaseIds)
    ? [...expectedCaseIds]
    : Array.isArray(doc?.denominator?.expectedCaseIds)
      ? [...doc.denominator.expectedCaseIds]
      : [];
  const cases = Array.isArray(doc?.cases) ? doc.cases : [];
  const observed = cases.map((c) => c?.id).filter(Boolean);
  const observedSet = new Set(observed);
  const missing = expected.filter((id) => !observedSet.has(id));
  const notRun = cases.filter((c) => c?.status === "NOT RUN").map((c) => c.id);
  const complete = missing.length === 0 && notRun.length === 0 && expected.length > 0;
  return {
    expectedCaseIds: expected,
    observedCaseIds: observed,
    missingCaseIds: missing,
    notRunCaseIds: notRun,
    complete,
    claimedComplete: doc?.denominator?.complete === true
  };
}

function attemptsInsufficient(doc) {
  const problems = [];
  const cases = Array.isArray(doc?.cases) ? doc.cases : [];
  for (const c of cases) {
    const attempts = c?.attempts;
    if (!Array.isArray(attempts)) {
      problems.push(`case ${c?.id ?? "?"}: missing attempts[]`);
      continue;
    }
    if (attempts.length < 1) {
      problems.push(`case ${c?.id ?? "?"}: empty attempts[]`);
    }
  }
  const mcpSamples =
    doc?.mcp?.samplesMs?.length ??
    cases.reduce((n, c) => n + (c?.mcp?.samplesMs?.length ?? 0), 0);
  const agentTurns =
    doc?.agent?.turns?.length ??
    cases.reduce((n, c) => n + (c?.agent?.turns?.length ?? 0), 0);

  if (agentTurns > 0 && agentTurns < AGENT_MIN_SAMPLES) {
    problems.push(`agent attempts/samples ${agentTurns} < ${AGENT_MIN_SAMPLES} (single attempt insufficient)`);
  }
  if (mcpSamples > 0 && mcpSamples < MCP_MIN_SAMPLES) {
    problems.push(`MCP samples ${mcpSamples} < ${MCP_MIN_SAMPLES}`);
  }
  for (const c of cases) {
    if (Array.isArray(c.attempts) && c.attempts.length === 1 && Array.isArray(c.agent?.turns)) {
      if (c.agent.turns.length < AGENT_MIN_SAMPLES) {
        problems.push(`case ${c.id}: only one attempt retained (need ≥${AGENT_MIN_SAMPLES} agent samples)`);
      }
    }
  }
  return problems;
}

function notesAcceptRelativeRegression(doc) {
  const bags = [];
  if (Array.isArray(doc?.notes)) bags.push(...doc.notes);
  if (typeof doc?.summary === "string") bags.push(doc.summary);
  if (typeof doc?.statusNote === "string") bags.push(doc.statusNote);
  for (const c of doc?.cases ?? []) {
    if (Array.isArray(c.notes)) bags.push(...c.notes);
  }
  const joined = bags.map(String).join("\n");
  return /accept(ed|ing)?\s+relative\s+regression|relative\s+regression\s+accept|豁免相对|--accept-regression/i.test(
    joined
  );
}

function axesPresent(verdicts) {
  return (
    verdicts &&
    typeof verdicts.functionalCompatibility === "string" &&
    typeof verdicts.serviceLatency === "string" &&
    typeof verdicts.agentLatency === "string"
  );
}

/**
 * Verify one evidence document after reload. Pure aside from optional suite injection.
 */
export function verifyMcpCompatibilityEvidenceDoc({
  doc,
  rawText,
  expectedKind,
  suite,
  expectedCaseIds,
  expectedSuiteDigest,
  requireFullCoverage = true
}) {
  const problems = [];

  if (!doc || typeof doc !== "object") {
    return {
      ok: false,
      status: "FAIL",
      fileReleaseSignal: false,
      problems: [problem("invalid_json", "evidence document missing or not an object")],
      coverageMode: null,
      kind: expectedKind
    };
  }

  if (doc.contract !== MCP_COMPAT_EVIDENCE_CONTRACT) {
    problems.push(
      problem(
        "bad_contract",
        `contract must be ${MCP_COMPAT_EVIDENCE_CONTRACT}, got ${JSON.stringify(doc.contract)}`
      )
    );
  }
  if (doc.kind !== expectedKind) {
    problems.push(problem("wrong_kind", `expected kind=${expectedKind}, got ${JSON.stringify(doc.kind)}`));
  }

  for (const field of MCP_COMPAT_EVIDENCE_FIELD_CONTRACT.requiredTopLevel) {
    if (doc[field] === undefined || doc[field] === null) {
      problems.push(problem("missing_field", `missing required field ${field}`));
    }
  }

  if (expectedKind === "instance") {
    if (!doc.phases || typeof doc.phases !== "object" || !doc.phases.POST) {
      problems.push(problem("missing_phase", "instance evidence requires phases.POST"));
    }
    if (!doc.snapshotId) {
      problems.push(problem("missing_snapshot", "instance evidence requires snapshotId"));
    }
  }

  const coverageMode = doc.coverageMode ?? "full";
  if (!COVERAGE_MODES.includes(coverageMode)) {
    problems.push(problem("bad_coverage_mode", `coverageMode must be full|ci-subset, got ${coverageMode}`));
  }
  if (requireFullCoverage && coverageMode === "ci-subset") {
    problems.push(
      problem(
        "ci_subset",
        "CI subset evidence cannot satisfy full-denominator release gate (D23/SC-21)",
        "blocked"
      )
    );
  }

  const text = rawText ?? JSON.stringify(doc);
  const leak = scanText(text, { secrets: [] });
  if (leak.hits?.length) {
    problems.push(
      problem("secret_leak", `public evidence leak scan hits: ${leak.hits.map((h) => h.kind).join(",")}`)
    );
  }
  const secretLeaves = [];
  collectSecretishLeaves(doc, [], secretLeaves);
  if (secretLeaves.length) {
    problems.push(
      problem(
        "secret_leak",
        `public evidence contains secretish fields: ${secretLeaves.map((s) => s.path).join(",")}`
      )
    );
  }

  const authoritativeSuite = suite ?? doc.suite;
  if (authoritativeSuite) {
    const validation = validateJourneySuite(authoritativeSuite);
    if (!validation.ok) {
      problems.push(
        problem("suite_invalid", `suite validation: ${validation.problems.join("; ")}`, "blocked")
      );
    }
    const dig = digestJourneySuite(authoritativeSuite);
    const claimed = expectedSuiteDigest ?? doc.suiteDigest;
    if (claimed && claimed !== dig) {
      problems.push(problem("old_digest", `suiteDigest mismatch: claimed ${claimed}, recomputed ${dig}`));
    }
  } else if (expectedSuiteDigest && doc.suiteDigest && expectedSuiteDigest !== doc.suiteDigest) {
    problems.push(
      problem(
        "old_digest",
        `suiteDigest mismatch vs expected: claimed ${doc.suiteDigest}, expected ${expectedSuiteDigest}`
      )
    );
  }

  const denom = recomputeDenominator(
    doc,
    expectedCaseIds ?? authoritativeSuite?.cases?.map((c) => c.id)
  );
  if (denom.missingCaseIds.length) {
    problems.push(problem("deleted_cases", `denominator missing cases: ${denom.missingCaseIds.join(",")}`));
  }
  if (denom.notRunCaseIds.length) {
    problems.push(problem("not_run", `cases still NOT RUN: ${denom.notRunCaseIds.join(",")}`));
  }
  if (denom.claimedComplete && !denom.complete) {
    problems.push(
      problem("forged_denominator", "denominator.complete claimed true but recomputation is incomplete")
    );
  }

  for (const msg of attemptsInsufficient(doc)) {
    problems.push(problem("insufficient_attempts", msg));
  }

  if (notesAcceptRelativeRegression(doc)) {
    problems.push(
      problem("relative_regression_accepted", "notes/summary accept relative regression; D12 forbids exemption")
    );
  }

  // Detect missing axis on the *claimed* verdicts object (runner omitted an axis).
  if (doc.verdicts && typeof doc.verdicts === "object") {
    for (const axis of ["functionalCompatibility", "serviceLatency", "agentLatency"]) {
      if (doc.verdicts[axis] == null || doc.verdicts[axis] === "") {
        problems.push(problem("missing_axis", `claimed verdicts missing ${axis}`));
      }
    }
  }

  const { verdicts, aggregate } = recomputeFromEvidenceDoc(doc, authoritativeSuite);

  if (!axesPresent(verdicts)) {
    problems.push(problem("missing_axis", "recomputed verdicts missing one or more of the three axes"));
  } else if (doc.verdicts && typeof doc.verdicts === "object") {
    for (const axis of ["functionalCompatibility", "serviceLatency", "agentLatency"]) {
      if (doc.verdicts[axis] && doc.verdicts[axis] !== verdicts[axis]) {
        problems.push(
          problem(
            "rewritten_verdict",
            `claimed verdicts.${axis}=${doc.verdicts[axis]} but recomputed ${verdicts[axis]}`
          )
        );
      }
    }
  }

  if (
    (verdicts.attribution === "DEGRADED_PROVIDER_LATENCY" ||
      doc.agent?.attribution === "DEGRADED_PROVIDER_LATENCY" ||
      doc.verdicts?.attribution === "DEGRADED_PROVIDER_LATENCY") &&
    verdicts.agentLatency === "FAIL" &&
    doc.status === "PASS"
  ) {
    problems.push(
      problem(
        "attribution_masquerade",
        "DEGRADED_PROVIDER_LATENCY cannot make overall PASS when agentLatency is FAIL"
      )
    );
  }

  if (typeof doc.summary === "string" && /overall\s*PASS|status\s*=\s*PASS/i.test(doc.summary)) {
    if (aggregate.status !== "PASS") {
      problems.push(
        problem("rewritten_summary", `summary claims PASS but recomputed status is ${aggregate.status}`)
      );
    }
  }
  if (doc.status === "PASS" && aggregate.status !== "PASS") {
    problems.push(
      problem("forged_status", `top-level status=PASS but recomputed aggregate is ${aggregate.status}`)
    );
  }
  if (doc.status === "NOT RUN") {
    problems.push(problem("not_run", "evidence top-level status is NOT RUN"));
  }

  for (const c of doc.cases ?? []) {
    if ((c.status === "FAIL" || c.status === "BLOCKED" || c.status === "NOT RUN") && doc.status === "PASS") {
      problems.push(
        problem("case_status_ignored", `case ${c.id} is ${c.status} but top-level status claims PASS`)
      );
    }
  }

  const blocking = problems.filter((p) => p.severity === "blocked");
  const failing = problems.filter((p) => p.severity === "failed");

  let status = aggregate.status;
  if (blocking.length) status = "BLOCKED";
  else if (failing.length) status = "FAIL";
  if (!denom.complete && status === "PASS") status = "FAIL";
  if (["FAIL", "BLOCKED", "NOT RUN"].includes(aggregate.status) && status === "PASS") {
    status = aggregate.status;
  }

  // Explicit runner FAIL/BLOCKED with no other problems: surface as recorded (do not invent PASS).
  if ((doc.status === "FAIL" || doc.status === "BLOCKED") && status === "PASS" && problems.length === 0) {
    status = doc.status;
  }

  const ok = status === "PASS" && problems.length === 0;
  const fileReleaseSignal = ok && coverageMode === "full" && denom.complete && expectedKind === "candidate";

  return {
    ok,
    status,
    fileReleaseSignal,
    problems,
    recomputed: {
      verdicts: {
        functionalCompatibility: verdicts.functionalCompatibility,
        serviceLatency: verdicts.serviceLatency,
        agentLatency: verdicts.agentLatency,
        ...(verdicts.attribution ? { attribution: verdicts.attribution } : {})
      },
      aggregateStatus: aggregate.status,
      reasons: aggregate.reasons,
      denominator: denom,
      batchWallClockMs: aggregate.batchWallClockMs ?? doc.batchWallClockMs ?? null
    },
    coverageMode,
    kind: expectedKind
  };
}

/**
 * Aggregate candidate/instance verifier results into a release gate decision.
 * Clear extension point for customer-release-readiness / Wave C — call this;
 * do not parse runner stdout. CI subset never sets releaseReady=true.
 *
 * @param {{ results: object, ciSubset?: boolean }} input
 */
export function evaluateMcpCompatibilityReleaseGate({ results = {}, ciSubset = false }) {
  const problems = [];
  for (const key of ["candidate", "instance"]) {
    if (results[key]?.problems) problems.push(...results[key].problems);
  }
  const seen = new Set();
  const unique = [];
  for (const p of problems) {
    const k = `${p.code}|${p.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }

  const candidate = results.candidate;
  const instance = results.instance;
  const coverageIsSubset =
    ciSubset === true ||
    candidate?.coverageMode === "ci-subset" ||
    instance?.coverageMode === "ci-subset";

  let status = "PASS";
  if (
    unique.some((p) => p.severity === "blocked") ||
    candidate?.status === "BLOCKED" ||
    instance?.status === "BLOCKED"
  ) {
    status = "BLOCKED";
  } else if (
    unique.length ||
    (candidate && candidate.status !== "PASS") ||
    (instance && instance.status !== "PASS")
  ) {
    status = "FAIL";
  }

  if (coverageIsSubset) {
    unique.push(
      problem(
        "ci_subset_no_release",
        "CI subset must not set releaseReady=true from subset alone",
        "blocked"
      )
    );
    if (status === "PASS") status = "BLOCKED";
  }

  const candidatePass = candidate?.ok === true && candidate?.status === "PASS";
  const instanceOk = instance == null || (instance.ok === true && instance.status === "PASS");
  const releaseReady =
    !coverageIsSubset &&
    status === "PASS" &&
    candidatePass &&
    instanceOk &&
    candidate?.fileReleaseSignal === true;

  return {
    status,
    releaseReady,
    problems: unique,
    candidate,
    instance
  };
}

/**
 * Reload both public evidence files under runDir and verify independently (SC-16).
 * CI subset alone never yields releaseReady=true (D23 / SC-21).
 *
 * @param {object} opts
 * @param {string} opts.runDir
 * @param {object} [opts.suite]
 * @param {string[]} [opts.expectedCaseIds]
 * @param {string} [opts.expectedSuiteDigest]
 * @param {"candidate"|"instance"|"both"} [opts.require="both"]
 * @param {boolean} [opts.ciSubset=false]
 */
export function verifyMcpCompatibilityEvidenceFiles({
  runDir,
  suite,
  expectedCaseIds,
  expectedSuiteDigest,
  require = "both",
  ciSubset = false
}) {
  const results = {};
  const needCandidate = require === "both" || require === "candidate";
  const needInstance = require === "both" || require === "instance";

  if (needCandidate) {
    const loaded = loadEvidenceFile(runDir, CANDIDATE_EVIDENCE_REL);
    if (!loaded.present) {
      results.candidate = {
        ok: false,
        status: "BLOCKED",
        fileReleaseSignal: false,
        problems: [problem("missing_file", `missing ${CANDIDATE_EVIDENCE_REL}`, "blocked")],
        coverageMode: null,
        kind: "candidate"
      };
    } else if (loaded.parseError) {
      results.candidate = {
        ok: false,
        status: "FAIL",
        fileReleaseSignal: false,
        problems: [problem("invalid_json", `${CANDIDATE_EVIDENCE_REL} is not valid JSON`)],
        coverageMode: null,
        kind: "candidate"
      };
    } else {
      results.candidate = verifyMcpCompatibilityEvidenceDoc({
        doc: loaded.doc,
        rawText: loaded.raw.toString("utf8"),
        expectedKind: "candidate",
        suite,
        expectedCaseIds,
        expectedSuiteDigest,
        requireFullCoverage: !ciSubset
      });
    }
  }

  if (needInstance) {
    const loaded = loadEvidenceFile(runDir, INSTANCE_EVIDENCE_REL);
    if (!loaded.present) {
      results.instance = {
        ok: false,
        status: "BLOCKED",
        fileReleaseSignal: false,
        problems: [problem("missing_file", `missing ${INSTANCE_EVIDENCE_REL}`, "blocked")],
        coverageMode: null,
        kind: "instance"
      };
    } else if (loaded.parseError) {
      results.instance = {
        ok: false,
        status: "FAIL",
        fileReleaseSignal: false,
        problems: [problem("invalid_json", `${INSTANCE_EVIDENCE_REL} is not valid JSON`)],
        coverageMode: null,
        kind: "instance"
      };
    } else {
      results.instance = verifyMcpCompatibilityEvidenceDoc({
        doc: loaded.doc,
        rawText: loaded.raw.toString("utf8"),
        expectedKind: "instance",
        suite,
        expectedCaseIds,
        expectedSuiteDigest,
        requireFullCoverage: !ciSubset
      });
    }
  }

  const gate = evaluateMcpCompatibilityReleaseGate({ results, ciSubset });
  return {
    ...gate,
    artifacts: assembleMcpCompatibilityEvidenceIndex({ runDir })
  };
}
