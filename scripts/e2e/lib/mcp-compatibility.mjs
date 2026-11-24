/**
 * P1-53 Task 1 — MCP upgrade journey suite load / validate / digest / three-axis judge.
 * Pure functions only: no network, no Token, no CompatConfigProfile apply (A1), no runner (Wave B).
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md (D11/D12/D16a/D24/D27)
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 1
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = path.resolve(HERE, "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "../..");

export const DEFAULT_JOURNEY_SUITE_PATH = path.join(E2E_ROOT, "contracts", "mcp-upgrade-journeys.yaml");
export const APPROVED_QUESTION_BANK_ID = "lucy-mcp-upgrade-question-bank";

/** Required scenario families for denominator completeness (Plan Task 1). */
export const REQUIRED_CASE_FAMILIES = Object.freeze(["follow-up", "permission", "multi-connection"]);

export const AGENT_TURN_WALL_CLOCK_LIMIT_MS = 120_000;
export const MCP_SIMPLE_P95_LIMIT_MS = 5_000;
export const MCP_DENIAL_P95_LIMIT_MS = 500;
export const MCP_DENIAL_P99_LIMIT_MS = 2_000;
export const MCP_COMPLEX_P95_LIMIT_MS = 30_000;
export const MCP_RELATIVE_RATIO = 0.2;
export const MCP_RELATIVE_ABS_MS = 50;
export const AGENT_RELATIVE_RATIO = 0.2;
export const AGENT_RELATIVE_ABS_MS = 2_000;
export const MCP_MIN_SAMPLES = 20;
export const AGENT_MIN_SAMPLES = 3;

const FAMILY_FROM_ID = [
  { re: /^QB-FOLLOW-/i, family: "follow-up" },
  { re: /^QB-ACL-/i, family: "permission" },
  { re: /^QB-DB-/i, family: "multi-connection" }
];

const FAMILY_FROM_MAPSTO = {
  "COMPAT-03": "follow-up",
  "COMPAT-04": "follow-up",
  "COMPAT-05": "follow-up",
  "COMPAT-06": "multi-connection",
  "COMPAT-07": "permission",
  "COMPAT-08": "permission"
};

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

/**
 * Infer case family from explicit field, id prefix, or mapsTo.
 * @param {object} c
 * @returns {string|null}
 */
export function inferCaseFamily(c) {
  if (!c || typeof c !== "object") return null;
  if (typeof c.family === "string" && c.family.trim()) return c.family.trim();
  const id = String(c.id ?? "");
  for (const { re, family } of FAMILY_FROM_ID) {
    if (re.test(id)) return family;
  }
  for (const m of c.mapsTo ?? []) {
    if (FAMILY_FROM_MAPSTO[m]) return FAMILY_FROM_MAPSTO[m];
  }
  return null;
}

/**
 * Load a journey suite from a filesystem path or an already-parsed object.
 * Does not invent a second question bank — only consumes.
 * @param {string|object} source
 */
export function loadJourneySuite(source = DEFAULT_JOURNEY_SUITE_PATH) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return structuredClone(source);
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("loadJourneySuite requires a file path or suite object");
  }
  const file = path.isAbsolute(source) ? source : path.resolve(REPO_ROOT, source);
  if (!existsSync(file)) {
    throw new Error(`journey suite not found: ${file}`);
  }
  const doc = parse(readFileSync(file, "utf8"));
  if (!doc || typeof doc !== "object") {
    throw new Error(`journey suite is empty or invalid YAML: ${file}`);
  }
  return doc;
}

/**
 * Structural / denominator validation. Empty problems ⇒ ok.
 * Missing requiredConfigFingerprint is a validation problem (D27 → BLOCKED at aggregate).
 * @param {object} suite
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateJourneySuite(suite) {
  const problems = [];
  if (!suite || typeof suite !== "object") {
    return { ok: false, problems: ["suite is missing or not an object"] };
  }
  if (suite.questionBankId && suite.questionBankId !== APPROVED_QUESTION_BANK_ID) {
    problems.push(
      `questionBankId "${suite.questionBankId}" is not the approved id "${APPROVED_QUESTION_BANK_ID}"`
    );
  }
  if (
    suite.requiredConfigFingerprint == null ||
    suite.requiredConfigFingerprint === "" ||
    (typeof suite.requiredConfigFingerprint === "string" && !suite.requiredConfigFingerprint.trim())
  ) {
    problems.push("missing requiredConfigFingerprint (D27)");
  }

  const cases = Array.isArray(suite.cases) ? suite.cases : null;
  if (!cases || cases.length === 0) {
    problems.push("empty denominator: no cases");
  } else {
    const seen = new Set();
    const families = new Set();
    for (const c of cases) {
      const id = c?.id;
      if (!id || typeof id !== "string") {
        problems.push("case missing id");
        continue;
      }
      if (seen.has(id)) problems.push(`duplicate case id: ${id}`);
      seen.add(id);
      const family = inferCaseFamily(c);
      if (family) families.add(family);
    }
    for (const required of REQUIRED_CASE_FAMILIES) {
      if (!families.has(required)) {
        problems.push(`missing required family: ${required}`);
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Stable digest over suite identity + ordered cases (canonical JSON).
 * @param {object} suite
 * @returns {string} sha256:<hex>
 */
export function digestJourneySuite(suite) {
  const cases = Array.isArray(suite?.cases) ? [...suite.cases] : [];
  cases.sort((a, b) => String(a?.id ?? "").localeCompare(String(b?.id ?? "")));
  const payload = {
    questionBankId: suite?.questionBankId ?? null,
    version: suite?.version ?? null,
    requiredConfigFingerprint: suite?.requiredConfigFingerprint ?? null,
    cases
  };
  const hex = createHash("sha256").update(stableStringify(payload)).digest("hex");
  return `sha256:${hex}`;
}

/** Plan alias. */
export const digest = digestJourneySuite;

/**
 * @param {number[]} samples
 * @param {number} p 0–100
 */
export function percentile(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].map(Number).sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function median(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].map(Number).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function judgeFunctional(functionalCases = []) {
  const reasons = [];
  if (!Array.isArray(functionalCases) || functionalCases.length === 0) {
    return { verdict: "PASS", reasons };
  }
  for (const c of functionalCases) {
    const id = c.id ?? "(unknown)";
    if (c.envelopeEmpty) {
      reasons.push(`${id}: empty envelope`);
      continue;
    }
    // P1-74 / Task 4（SC-E5／E5b）：按归因分列 —— 预算终止记 budget_*，
    // 不是 `new deny`；并发／不可用与 exhausted 分列；expected deny 只有
    // 真实 ACL 证据才 PASS，不得因 budget stop 假绿。
    const denyClass = c.observedDenyClass ?? null;
    const budgetReasonText = {
      budget_exhausted: "budget_exhausted",
      budget_concurrency_exceeded: "budget_concurrency_exceeded",
      budget_unavailable: "budget_unavailable (platform/storage)",
      budget_escape_rejected: "budget_escape_rejected"
    }[denyClass];
    if (c.expectedOutcome === "allow" && c.observedOutcome === "deny") {
      reasons.push(
        budgetReasonText
          ? `${id}: ${budgetReasonText} (expected allow)`
          : `${id}: new deny (expected allow)`
      );
    }
    if (c.expectedOutcome === "deny" && c.observedOutcome === "allow") {
      reasons.push(`${id}: expected denial becoming allow`);
    }
    if (c.expectedOutcome === "deny" && c.observedOutcome === "deny" && budgetReasonText) {
      reasons.push(`${id}: expected deny observed via ${budgetReasonText} (not ACL)`);
    }
    const nonemptyExpected =
      c.expectedNonempty === true || c.baselineNonempty === true;
    if (
      nonemptyExpected &&
      c.observedOutcome === "allow" &&
      (c.observedRowCount === 0 || c.observedRowCount == null) &&
      !c.envelopeEmpty
    ) {
      // nonempty-to-empty / expected nonempty but empty rows
      reasons.push(`${id}: nonempty-to-empty`);
    }
    if (Array.isArray(c.expectedMetrics) && c.expectedMetrics.length > 0) {
      const observed = new Set(c.observedMetrics ?? []);
      for (const m of c.expectedMetrics) {
        if (!observed.has(m)) reasons.push(`${id}: missing metric ${m}`);
      }
    }
  }
  return { verdict: reasons.length ? "FAIL" : "PASS", reasons };
}

function absoluteMcpLimit(budgetClass) {
  switch (budgetClass) {
    case "denial":
      return MCP_DENIAL_P95_LIMIT_MS;
    case "complex":
      return MCP_COMPLEX_P95_LIMIT_MS;
    case "simple":
    default:
      return MCP_SIMPLE_P95_LIMIT_MS;
  }
}

function judgeServiceLatency(mcp) {
  const reasons = [];
  if (!mcp || typeof mcp !== "object") {
    return { verdict: "PASS", reasons };
  }
  const samples = mcp.samplesMs ?? [];
  if (samples.length < MCP_MIN_SAMPLES) {
    return {
      verdict: "BLOCKED",
      reasons: [`MCP samples ${samples.length} < ${MCP_MIN_SAMPLES}`]
    };
  }
  const p95 = percentile(samples, 95);
  const limit = absoluteMcpLimit(mcp.budgetClass);
  if (p95 != null && p95 > limit) {
    reasons.push(
      `MCP p95 ${p95}ms exceeds absolute ${mcp.budgetClass ?? "simple"} limit ${limit}ms`
    );
  }
  if (typeof mcp.baselineP95Ms === "number" && mcp.baselineP95Ms > 0 && p95 != null) {
    const delta = p95 - mcp.baselineP95Ms;
    const ratio = delta / mcp.baselineP95Ms;
    if (delta > MCP_RELATIVE_ABS_MS && ratio > MCP_RELATIVE_RATIO) {
      reasons.push(
        `MCP relative regression: +${delta}ms (+${(ratio * 100).toFixed(1)}%) vs baseline p95 ${mcp.baselineP95Ms}ms`
      );
    }
  }
  // denial also checks p99 hard gate when budgetClass=denial
  if (mcp.budgetClass === "denial") {
    const p99 = percentile(samples, 99);
    if (p99 != null && p99 > MCP_DENIAL_P99_LIMIT_MS) {
      reasons.push(`MCP denial p99 ${p99}ms exceeds ${MCP_DENIAL_P99_LIMIT_MS}ms`);
    }
  }
  return { verdict: reasons.length ? "FAIL" : "PASS", reasons };
}

function judgeAgentLatency(agent) {
  const reasons = [];
  let attribution;
  if (!agent || typeof agent !== "object") {
    return { verdict: "PASS", reasons, attribution };
  }
  if (agent.attribution) attribution = agent.attribution;
  const turns = Array.isArray(agent.turns) ? agent.turns : [];
  if (turns.length < AGENT_MIN_SAMPLES) {
    return {
      verdict: "BLOCKED",
      reasons: [`agent samples ${turns.length} < ${AGENT_MIN_SAMPLES}`],
      attribution
    };
  }
  const walls = turns.map((t) => Number(t.turnWallClockMs));
  for (const ms of walls) {
    if (ms > AGENT_TURN_WALL_CLOCK_LIMIT_MS) {
      reasons.push(`agent turnWallClockMs ${ms} > ${AGENT_TURN_WALL_CLOCK_LIMIT_MS}`);
      if (!attribution) attribution = "DEGRADED_PROVIDER_LATENCY";
    }
  }
  const med = median(walls);
  if (typeof agent.baselineMedianMs === "number" && agent.baselineMedianMs > 0 && med != null) {
    const delta = med - agent.baselineMedianMs;
    const ratio = delta / agent.baselineMedianMs;
    if (delta > AGENT_RELATIVE_ABS_MS && ratio > AGENT_RELATIVE_RATIO) {
      reasons.push(
        `agent relative regression (median): +${delta}ms (+${(ratio * 100).toFixed(1)}%) vs baseline ${agent.baselineMedianMs}ms`
      );
    }
  }
  return { verdict: reasons.length ? "FAIL" : "PASS", reasons, attribution };
}

/**
 * Three-axis judge (D11 / D12 / D16a / D24). Does not perform I/O.
 * @param {object} input
 * @returns {{
 *   functionalCompatibility: string,
 *   serviceLatency: string,
 *   agentLatency: string,
 *   attribution?: string,
 *   reasons: string[]
 * }}
 */
export function threeAxis(input = {}) {
  const functional = judgeFunctional(input.functionalCases);
  const service = judgeServiceLatency(input.mcp);
  const agent = judgeAgentLatency(input.agent);
  const reasons = [...functional.reasons, ...service.reasons, ...agent.reasons];
  const result = {
    functionalCompatibility: functional.verdict,
    serviceLatency: service.verdict,
    agentLatency: agent.verdict,
    reasons
  };
  if (agent.attribution) result.attribution = agent.attribution;
  return result;
}

function fingerprintsMatch(current, baseline) {
  if (!baseline) return true;
  if (
    baseline.clientFingerprint != null &&
    current.clientFingerprint != null &&
    baseline.clientFingerprint !== current.clientFingerprint
  ) {
    return false;
  }
  if (
    baseline.modelFingerprint != null &&
    current.modelFingerprint != null &&
    baseline.modelFingerprint !== current.modelFingerprint
  ) {
    return false;
  }
  return true;
}

/**
 * Aggregate entrypoint verdict. Overall PASS ⇔ three axes all PASS (D24),
 * subject to D27 fingerprint / baseline gates. No total cost / wall-clock ceiling (D23).
 *
 * @param {object} input
 */
export function aggregateCompatibility(input = {}) {
  const reasons = [];
  const notes = [];
  const entrypoint = input.entrypoint ?? "certifyCandidate";
  const suite = input.suite ?? {};

  const validation = validateJourneySuite(suite);
  if (!validation.ok) {
    reasons.push(...validation.problems);
    return finish({
      status: "BLOCKED",
      entrypoint,
      reasons,
      notes,
      input,
      verdicts: {
        functionalCompatibility: "BLOCKED",
        serviceLatency: "BLOCKED",
        agentLatency: "BLOCKED"
      }
    });
  }

  // D27: suite fingerprint present ⇒ runtime fingerprint required and must match.
  const requiredFp = suite.requiredConfigFingerprint;
  const runtimeFp = input.configProfileFingerprint;
  const runtimeFpMissing =
    runtimeFp == null ||
    runtimeFp === "" ||
    (typeof runtimeFp === "string" && !runtimeFp.trim());
  if (requiredFp && runtimeFpMissing) {
    reasons.push(
      "missing configProfileFingerprint (D27): suite requires matching CompatConfigProfile fingerprint"
    );
    return finish({
      status: "BLOCKED",
      entrypoint,
      reasons,
      notes,
      input,
      verdicts: {
        functionalCompatibility: "BLOCKED",
        serviceLatency: "BLOCKED",
        agentLatency: "BLOCKED"
      }
    });
  }
  if (requiredFp && runtimeFp !== requiredFp) {
    reasons.push(
      `configProfileFingerprint mismatch: got ${runtimeFp}, required ${requiredFp}`
    );
    return finish({
      status: "BLOCKED",
      entrypoint,
      reasons,
      notes,
      input,
      verdicts: {
        functionalCompatibility: "BLOCKED",
        serviceLatency: "BLOCKED",
        agentLatency: "BLOCKED"
      }
    });
  }

  if (entrypoint === "certifyInstanceUpgrade") {
    const baseline = input.baseline;
    if (!baseline) {
      reasons.push("BASELINE_MISSING: instance upgrade requires private baseline");
      return finish({
        status: "BLOCKED",
        entrypoint,
        reasons,
        notes,
        input,
        verdicts: blockedVerdicts()
      });
    }
    if (!baseline.snapshotId) {
      reasons.push("missing baseline snapshotId on instance lane");
      return finish({
        status: "BLOCKED",
        entrypoint,
        reasons,
        notes,
        input,
        verdicts: blockedVerdicts()
      });
    }
    if (!fingerprintsMatch(input, baseline)) {
      reasons.push("client/model fingerprint mismatch vs baseline (rejected)");
      return finish({
        status: "BLOCKED",
        entrypoint,
        reasons,
        notes,
        input,
        verdicts: blockedVerdicts()
      });
    }
    if (input.candidateEvidence?.status !== "PASS") {
      reasons.push("certifyCandidate PASS required before instance upgrade");
      return finish({
        status: "BLOCKED",
        entrypoint,
        reasons,
        notes,
        input,
        verdicts: blockedVerdicts()
      });
    }
  }

  // captureInstanceBaseline: prior baseline file is NOT required
  if (entrypoint === "captureInstanceBaseline") {
    // explicitly do not push BASELINE_MISSING
  }

  const verdicts =
    input.verdicts &&
    input.verdicts.functionalCompatibility &&
    input.verdicts.serviceLatency &&
    input.verdicts.agentLatency
      ? {
          functionalCompatibility: input.verdicts.functionalCompatibility,
          serviceLatency: input.verdicts.serviceLatency,
          agentLatency: input.verdicts.agentLatency,
          ...(input.verdicts.attribution ? { attribution: input.verdicts.attribution } : {}),
          reasons: input.verdicts.reasons ?? []
        }
      : threeAxis({
          functionalCases: input.functionalCases,
          mcp: input.mcp,
          agent: input.agent
        });

  reasons.push(...(verdicts.reasons ?? []));

  const axes = [
    verdicts.functionalCompatibility,
    verdicts.serviceLatency,
    verdicts.agentLatency
  ];
  let status = "PASS";
  if (axes.includes("BLOCKED")) status = "BLOCKED";
  else if (axes.includes("FAIL")) status = "FAIL";

  // D16a: DEGRADED_PROVIDER_LATENCY must never salvage overall PASS
  if (
    status === "PASS" &&
    (verdicts.attribution === "DEGRADED_PROVIDER_LATENCY" ||
      input.agent?.attribution === "DEGRADED_PROVIDER_LATENCY") &&
    verdicts.agentLatency === "FAIL"
  ) {
    status = "FAIL";
    reasons.push("DEGRADED_PROVIDER_LATENCY cannot make overall PASS");
  }
  if (
    verdicts.attribution === "DEGRADED_PROVIDER_LATENCY" &&
    verdicts.agentLatency === "FAIL" &&
    status === "PASS"
  ) {
    status = "FAIL";
  }

  if (entrypoint === "evidencePackNegControl") {
    notes.push("evidence-pack neg-control is judge-only; not old-version UAT PASS");
    return finish({
      status: status === "PASS" ? "FAIL" : status,
      entrypoint,
      reasons: status === "PASS" ? [...reasons, "neg-control must not report PASS as UAT"] : reasons,
      notes,
      input,
      verdicts,
      kind: "evidence-pack-neg-control",
      uatPass: false
    });
  }

  return finish({ status, entrypoint, reasons, notes, input, verdicts });
}

function blockedVerdicts() {
  return {
    functionalCompatibility: "BLOCKED",
    serviceLatency: "BLOCKED",
    agentLatency: "BLOCKED"
  };
}

function finish({ status, entrypoint, reasons, notes, input, verdicts, kind, uatPass }) {
  const out = {
    status,
    entrypoint,
    verdicts: {
      functionalCompatibility: verdicts.functionalCompatibility,
      serviceLatency: verdicts.serviceLatency,
      agentLatency: verdicts.agentLatency,
      ...(verdicts.attribution ? { attribution: verdicts.attribution } : {})
    },
    reasons: [...new Set(reasons)],
    batchWallClockMs: input.batchWallClockMs ?? null
  };
  if (notes?.length) out.notes = notes;
  if (kind) out.kind = kind;
  if (uatPass === false) out.uatPass = false;
  if (input.modelCallCount != null) out.modelCallCount = input.modelCallCount;
  if (input.tokenUsage != null) out.tokenUsage = input.tokenUsage;
  // D23: record cost fields when provided; never gate on them
  if (input.estimatedCostUsd != null) out.estimatedCostUsd = input.estimatedCostUsd;
  return out;
}
