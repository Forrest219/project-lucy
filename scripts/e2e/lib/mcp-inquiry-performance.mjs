/**
 * P1-78 Task 1/8 — MCP inquiry performance judge (pure functions).
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D3/D5/D6/D8/D15/D16/D20/D21/D22/D23, §4.1.1, §5, §6.3)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 1 / Task 8 (judge part)
 *
 * Pure functions only: no network, no file I/O, no product-code dependencies.
 * YAML parsing and evidence persistence are the caller's job; every function
 * here accepts already-parsed plain objects.
 *
 * One exception is the question-pack dependency guard
 * (resolveQuestionPackDependency): it may read the P1-79 pack from disk so
 * that the consumer side can decide BLOCKED on its own. Its loader is
 * injectable and every other input is a plain object.
 */

import {
  MIN_CHAIN_TURNS,
  MIN_CHAINS,
  loadQuestionPack,
  validateQuestionPack
} from "./mcp-inquiry-question-pack.mjs";

export const SCHEMA_VERSION = 1;

export const BUDGET_CLASSES = Object.freeze(["simple", "complex", "denial"]);

// D6: N<20 no formal P95; N<100 P99 is not_estimable.
export const P95_MIN_SAMPLE_COUNT = 20;
export const P99_MIN_SAMPLE_COUNT = 100;

export const TURN_WALL_CLOCK_HARD_LIMIT_MS = 120_000;
export const WINDOW_DRAIN_MS = 120_000;

// D6 sample floors per trigger tier.
export const SAMPLE_FLOORS = Object.freeze({
  pr: Object.freeze({ mcp: 20, agent: 3 }),
  formal: Object.freeze({ mcp: 100, agent: 20 })
});

// D8 relative regression dual thresholds.
export const MCP_RELATIVE = Object.freeze({ ratio: 0.2, absMs: 50 });
export const AGENT_RELATIVE = Object.freeze({ ratio: 0.2, absMs: 2_000 });

// D21 provider-error bounds (share/consecutive are design values pending freeze).
export const PROVIDER_ERROR_SHARE_LIMIT = 0.1;
export const PROVIDER_ERROR_CONSECUTIVE_LIMIT = 3;
export const PROVIDER_ERROR_MAX_RETRIES = 2;

// D22 waiver bounds.
export const WAIVER_MAX_SPAN_MS = 7 * 24 * 60 * 60 * 1_000;
export const WAIVABLE_VERDICTS = Object.freeze(["BLOCKED", "SEED_ONLY", "NOT RUN"]);

// Spec §4.1.1 exhaustive owner budgetClass -> performance budget class mapping.
export const OWNER_BUDGET_CLASS_MAP = Object.freeze({
  simple: "simple",
  "simple-metric": "simple",
  "group-metric": "simple",
  "empty-result": "simple",
  "time-window": "simple",
  "filter-metric": "simple",
  "follow-up": "simple",
  complex: "complex",
  "multi-source-join": "complex",
  "multi-db": "complex",
  "follow-up-join": "complex",
  denial: "denial"
});

// Spec §5 first-version absolute budgets (design values pending named freeze).
export const ABSOLUTE_BUDGETS = Object.freeze({
  mcp: Object.freeze({
    initializeWarm: Object.freeze({ p50Ms: 200, p99Ms: 2_000, overMs: 30_000, overCount: 0 }),
    denial: Object.freeze({ p95Ms: 500, p99Ms: 2_000 }),
    simple: Object.freeze({
      firstCorrectResultP95Ms: 5_000,
      singleRunDeadlineMs: 15_000,
      journeyWarmP95Ms: 10_000,
      journeyColdP95Ms: 15_000
    }),
    complex: Object.freeze({
      firstCorrectResultP95Ms: 30_000,
      singleRunDeadlineMs: 60_000,
      journeyWarmP95Ms: 30_000,
      journeyColdP95Ms: 45_000
    })
  }),
  agent: Object.freeze({
    firstTokenP95Ms: 10_000,
    turnWallClockHardLimitMs: TURN_WALL_CLOCK_HARD_LIMIT_MS,
    simple: Object.freeze({ warmP95Ms: 30_000, coldP95Ms: 45_000 }),
    complex: Object.freeze({ warmP95Ms: 60_000, coldP95Ms: 90_000 })
  })
});

export const DEFAULT_GROUP_KEYS = Object.freeze([
  "scenarioId",
  "cacheState",
  "clientModel",
  "environment",
  "concurrencyGroup"
]);

const VERDICT_RANK = Object.freeze({ PASS: 0, SEED_ONLY: 1, "NOT RUN": 2, BLOCKED: 3, FAIL: 4 });
const TRANSIENT_ERROR_KINDS = new Set(["connection_reset", "provider_timeout"]);
const LUCY_SIDE_OUTCOMES = new Set(["wrong_answer", "unexpected_deny", "empty_envelope", "timeout", "crash", "denied"]);
const CLASSIFIER_OWNED = new Set(["providerError", "lucy_error", "unclassifiable"]);

function worstVerdict(a, b) {
  return (VERDICT_RANK[a] ?? 0) >= (VERDICT_RANK[b] ?? 0) ? a : b;
}

function finiteOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// percentiles
// ---------------------------------------------------------------------------

/** Nearest-rank percentile: sorted[ceil(p×N)-1], p in 0–100. */
export function nearestRank(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = samples.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))];
}

export function median(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = samples.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

/**
 * Latency summary with the D6 claim rules baked in: P95 only for N>=20,
 * P99 only for N>=100, otherwise the string "not_estimable".
 */
export function summarizeLatencies(samples = []) {
  const valid = (Array.isArray(samples) ? samples : []).map(Number).filter(Number.isFinite);
  const n = valid.length;
  return {
    sampleCount: n,
    p50Ms: n ? nearestRank(valid, 50) : null,
    p95Ms: n >= P95_MIN_SAMPLE_COUNT ? nearestRank(valid, 95) : "not_estimable",
    p99Ms: n >= P99_MIN_SAMPLE_COUNT ? nearestRank(valid, 99) : "not_estimable",
    medianMs: n ? median(valid) : null,
    maxMs: n ? Math.max(...valid) : null
  };
}

// ---------------------------------------------------------------------------
// grouping / floors (D5/D6)
// ---------------------------------------------------------------------------

/** Group attempts by scenarioId×cacheState×clientModel×environment×concurrencyGroup (D5). */
export function groupAttempts(attempts = [], keyFields = DEFAULT_GROUP_KEYS) {
  const groups = {};
  for (const attempt of attempts ?? []) {
    const fields = {};
    const missing = [];
    for (const k of keyFields) {
      const v = attempt?.[k];
      if (v == null || v === "") missing.push(k);
      fields[k] = v ?? null;
    }
    const key = keyFields.map((k) => `${k}=${fields[k] ?? "∅"}`).join("|");
    if (!groups[key]) {
      groups[key] = { key, ...fields, attempts: [], missingFields: new Set() };
    }
    groups[key].attempts.push(attempt);
    for (const m of missing) groups[key].missingFields.add(m);
  }
  for (const g of Object.values(groups)) g.missingFields = [...g.missingFields];
  return groups;
}

/**
 * D6 floors per scenario group. Never aggregates across scenarios; a total
 * sample count spread over many scenarios cannot satisfy any per-scenario floor.
 */
export function assertSampleFloors(groups, { tier = "formal", floors = null } = {}) {
  const tierFloors = floors ?? SAMPLE_FLOORS[tier] ?? SAMPLE_FLOORS.formal;
  const list = Array.isArray(groups) ? groups : Object.values(groups ?? {});
  const problems = [];
  const perGroup = {};
  for (const g of list) {
    const key = g.key ?? g.scenarioId ?? "(unknown)";
    const lane = g.lane ?? g.attempts?.[0]?.lane ?? "mcp";
    const floor = tierFloors[lane] ?? tierFloors.mcp;
    const count = Array.isArray(g.attempts) ? g.attempts.length : Number(g.count ?? 0);
    const ok = count >= floor;
    // D6: PR agent samples never back a formal P95 claim.
    const p95Formal = count >= P95_MIN_SAMPLE_COUNT && (lane !== "agent" || tier === "formal");
    perGroup[key] = { lane, count, floor, ok, p95Formal };
    if (!ok) problems.push(`${key}: ${lane} samples ${count} < ${tier} floor ${floor}`);
    if (Array.isArray(g.missingFields) && g.missingFields.length) {
      problems.push(`${key}: missing grouping fields: ${g.missingFields.join(", ")}`);
    }
  }
  return { ok: problems.length === 0, problems, perGroup, tier };
}

// ---------------------------------------------------------------------------
// §4.1.1 owner budgetClass mapping
// ---------------------------------------------------------------------------

/**
 * Exhaustive mapping. Anything outside the table (including missing values)
 * is BLOCKED budgetClass_unmapped — never defaulted to simple.
 */
export function mapOwnerBudgetClass(ownerBudgetClass) {
  const key = typeof ownerBudgetClass === "string" ? ownerBudgetClass.trim() : "";
  if (key && OWNER_BUDGET_CLASS_MAP[key]) {
    return { ok: true, budgetClass: OWNER_BUDGET_CLASS_MAP[key], ownerBudgetClass: key };
  }
  return {
    ok: false,
    budgetClass: null,
    ownerBudgetClass: ownerBudgetClass ?? null,
    verdict: "BLOCKED",
    reason: "budgetClass_unmapped",
    problems: [
      `owner budgetClass ${JSON.stringify(ownerBudgetClass ?? null)} is not in the Spec §4.1.1 mapping table (budgetClass_unmapped)`
    ]
  };
}

// ---------------------------------------------------------------------------
// absolute budgets (§5)
// ---------------------------------------------------------------------------

/**
 * Judge one scenario group against the §5 absolute budgets.
 * input: { lane, tier, budgetClass, ownerBudgetClass, cacheState, latencies,
 *          turns, firstCorrectResultSamples, initializeSamples, firstTokenSamples }
 */
export function judgeAbsolute(input = {}) {
  const lane = input.lane ?? "mcp";
  const tier = input.tier ?? "formal";
  const cacheState = input.cacheState ?? "warm";
  const summary = summarizeLatencies(input.latencies ?? []);
  const claims = {
    p95Formal: summary.sampleCount >= P95_MIN_SAMPLE_COUNT && (lane !== "agent" || tier === "formal"),
    p99Estimable: summary.sampleCount >= P99_MIN_SAMPLE_COUNT
  };
  const failReasons = [];
  const blockedReasons = [];
  const notes = [];

  let budgetClass = input.budgetClass ?? null;
  if (budgetClass == null && input.ownerBudgetClass !== undefined) {
    const mapped = mapOwnerBudgetClass(input.ownerBudgetClass);
    if (!mapped.ok) {
      return { verdict: "BLOCKED", reasons: [...mapped.problems], notes, budgetClass: null, summary, claims };
    }
    budgetClass = mapped.budgetClass;
  }
  if (!BUDGET_CLASSES.includes(budgetClass)) {
    return {
      verdict: "BLOCKED",
      reasons: [`budgetClass ${JSON.stringify(budgetClass)} is not one of simple/complex/denial (budgetClass_unmapped)`],
      notes,
      budgetClass: null,
      summary,
      claims
    };
  }

  // §5.2 / D21③: the 120s per-turn hard line is never exempted.
  for (const t of input.turns ?? []) {
    const wall = finiteOrNull(t?.turnWallClockMs ?? t?.wallClockMs);
    if (wall != null && wall > TURN_WALL_CLOCK_HARD_LIMIT_MS) {
      failReasons.push(`turnWallClockMs ${wall} > ${TURN_WALL_CLOCK_HARD_LIMIT_MS} hard limit`);
    }
  }

  if (lane === "mcp") {
    if (summary.sampleCount === 0) {
      blockedReasons.push("no latency samples");
    } else if (summary.sampleCount < P95_MIN_SAMPLE_COUNT) {
      blockedReasons.push(`MCP samples ${summary.sampleCount} < ${P95_MIN_SAMPLE_COUNT}; no formal P95 judgment`);
    } else if (budgetClass === "denial") {
      const b = ABSOLUTE_BUDGETS.mcp.denial;
      if (summary.p95Ms > b.p95Ms) failReasons.push(`MCP denial p95 ${summary.p95Ms}ms exceeds ${b.p95Ms}ms`);
      if (claims.p99Estimable && summary.p99Ms > b.p99Ms) {
        failReasons.push(`MCP denial p99 ${summary.p99Ms}ms exceeds ${b.p99Ms}ms`);
      }
    } else {
      const b = ABSOLUTE_BUDGETS.mcp[budgetClass];
      const journeyBudget = cacheState === "cold" ? b.journeyColdP95Ms : b.journeyWarmP95Ms;
      if (summary.p95Ms > journeyBudget) {
        failReasons.push(`MCP ${budgetClass} ${cacheState} journey p95 ${summary.p95Ms}ms exceeds ${journeyBudget}ms`);
      }
      const fcr = (input.firstCorrectResultSamples ?? []).map(Number).filter(Number.isFinite);
      if (fcr.length) {
        const fcrSummary = summarizeLatencies(fcr);
        if (fcrSummary.p95Ms !== "not_estimable" && fcrSummary.p95Ms > b.firstCorrectResultP95Ms) {
          failReasons.push(
            `MCP ${budgetClass} first correct result p95 ${fcrSummary.p95Ms}ms exceeds ${b.firstCorrectResultP95Ms}ms`
          );
        }
        for (const ms of fcr) {
          if (ms > b.singleRunDeadlineMs) {
            failReasons.push(`MCP ${budgetClass} first correct result ${ms}ms beyond single-run deadline ${b.singleRunDeadlineMs}ms`);
            break;
          }
        }
      }
    }
    const init = (input.initializeSamples ?? []).map(Number).filter(Number.isFinite);
    if (init.length) {
      const b = ABSOLUTE_BUDGETS.mcp.initializeWarm;
      const s = summarizeLatencies(init);
      if (s.p50Ms > b.p50Ms) failReasons.push(`warm initialize p50 ${s.p50Ms}ms exceeds ${b.p50Ms}ms`);
      const over = init.filter((ms) => ms > b.overMs).length;
      if (over > b.overCount) failReasons.push(`${over} warm initialize sample(s) over ${b.overMs}ms (30s)`);
      if (s.p99Ms !== "not_estimable" && s.p99Ms > b.p99Ms) {
        failReasons.push(`warm initialize p99 ${s.p99Ms}ms exceeds ${b.p99Ms}ms`);
      }
    }
  } else {
    if (budgetClass === "denial") {
      blockedReasons.push("agent lane has no denial budget; the legal control is judged as its own class");
    } else if (summary.sampleCount === 0) {
      blockedReasons.push("no latency samples");
    } else {
      const b = ABSOLUTE_BUDGETS.agent[budgetClass];
      const budget = cacheState === "cold" ? b.coldP95Ms : b.warmP95Ms;
      if (claims.p95Formal) {
        if (summary.p95Ms > budget) {
          failReasons.push(`agent ${budgetClass} ${cacheState} final answer p95 ${summary.p95Ms}ms exceeds ${budget}ms`);
        }
      } else {
        notes.push("agent P95 not formally claimed (PR tier or N<20); median judged instead (D6)");
        if (summary.medianMs > budget) {
          failReasons.push(`agent ${budgetClass} ${cacheState} final answer median ${summary.medianMs}ms exceeds ${budget}ms`);
        }
      }
    }
    const ft = input.firstTokenSamples;
    if (ft === "not_available" || ft == null) {
      if (ft === "not_available") notes.push("first token not_available on this host (not a failure)");
    } else {
      const s = summarizeLatencies(ft);
      if (s.p95Ms !== "not_estimable" && s.p95Ms > ABSOLUTE_BUDGETS.agent.firstTokenP95Ms) {
        failReasons.push(`agent first token p95 ${s.p95Ms}ms exceeds ${ABSOLUTE_BUDGETS.agent.firstTokenP95Ms}ms`);
      }
    }
  }

  const verdict = failReasons.length ? "FAIL" : blockedReasons.length ? "BLOCKED" : "PASS";
  return { verdict, reasons: [...failReasons, ...blockedReasons], notes, budgetClass, summary, claims };
}

// ---------------------------------------------------------------------------
// relative baseline gate (D8)
// ---------------------------------------------------------------------------

/**
 * Same-key relative comparison. A baseline with null/missing/hand-filled
 * required numbers is BLOCKED — the relative gate must really execute.
 */
export function compareBaseline(current = {}, baseline = null, { lane = "mcp", p95Formal = true } = {}) {
  if (baseline == null) {
    return { verdict: "SEED_ONLY", reasons: ["no accepted baseline for this key"], deltas: null };
  }
  const blocked = [];
  for (const f of ["p50Ms", "p95Ms", "medianMs", "sampleCount"]) {
    const v = baseline[f];
    if (v == null || !Number.isFinite(Number(v))) {
      blocked.push(`baseline ${f} is null/missing/not numeric`);
    }
  }
  if (baseline.evidenceBodyDigest == null || baseline.evidenceBodyDigest === "") {
    blocked.push("baseline missing evidenceBodyDigest (hand-filled without raw evidence)");
  }
  if (Number.isFinite(Number(baseline.sampleCount)) && Number(baseline.sampleCount) < P95_MIN_SAMPLE_COUNT) {
    blocked.push(`baseline sampleCount ${baseline.sampleCount} < ${P95_MIN_SAMPLE_COUNT} cannot back a formal baseline`);
  }
  for (const k of ["scenarioId", "cacheState", "concurrencyGroup", "clientModel", "environment"]) {
    if (baseline[k] != null && current[k] != null && baseline[k] !== current[k]) {
      blocked.push(`baseline key mismatch on ${k}: ${baseline[k]} vs ${current[k]}`);
    }
  }
  if (blocked.length) return { verdict: "BLOCKED", reasons: blocked, deltas: null };

  const rel = lane === "agent" ? AGENT_RELATIVE : MCP_RELATIVE;
  const reasons = [];
  const deltas = {};
  const compare = (name, baseVal, curVal) => {
    const cur = finiteOrNull(curVal);
    if (cur == null) return "blocked";
    const base = Number(baseVal);
    const delta = cur - base;
    const ratio = base > 0 ? delta / base : 0;
    deltas[name] = { baselineMs: base, currentMs: cur, deltaMs: delta, ratio };
    if (delta > rel.absMs && ratio > rel.ratio) {
      reasons.push(`${name} relative regression: +${delta}ms (+${(ratio * 100).toFixed(1)}%) vs baseline ${base}ms`);
      return "fail";
    }
    return "pass";
  };
  const outcomes = [];
  if (lane === "agent") {
    outcomes.push(compare("medianMs", baseline.medianMs, current.medianMs));
    if (p95Formal) outcomes.push(compare("p95Ms", baseline.p95Ms, current.p95Ms));
  } else {
    outcomes.push(compare("p95Ms", baseline.p95Ms, current.p95Ms));
  }
  if (outcomes.includes("blocked")) {
    return { verdict: "BLOCKED", reasons: [...reasons, "current percentile not estimable; relative gate cannot run"], deltas };
  }
  if (outcomes.includes("fail")) return { verdict: "FAIL", reasons, deltas };
  return { verdict: "PASS", reasons, deltas };
}

// ---------------------------------------------------------------------------
// correctness precondition / denominators (D3)
// ---------------------------------------------------------------------------

/**
 * A BLOCKED stub record: the host was unavailable, the host does not support
 * multi-turn or the question reference could not be resolved, so no final
 * answer could exist at all (Spec D19/D15). The evidence library applies the
 * identical narrowing to its MISSING_FINAL_ANSWER check; the judge has to use
 * the same definition or the two drift apart and a stub is judged as a product
 * failure on one side and as BLOCKED on the other. The flag alone is not
 * enough — a non-empty reason has to accompany it.
 */
function isBlockedStub(attempt) {
  return (
    attempt?.blocked === true &&
    typeof attempt?.blockedReason === "string" &&
    attempt.blockedReason.trim().length > 0
  );
}

/**
 * Every planned attempt stays in the denominator. Fast wrong answers,
 * unexpected denials, empty envelopes, timeouts, crashes, success-only
 * retries, initialize-only journeys and missing final answers never PASS.
 * Attempts owned by the D21 classifier (providerError/lucy_error/unclassifiable)
 * skip outcome checks here; retry-chain integrity is always checked.
 *
 * A BLOCKED stub is the one exception to the "missing final answer" rule: no
 * final answer could exist there, so the attempt is reported as BLOCKED
 * (D19/D15) and stays in the denominator. It never buys a PASS.
 */
export function checkAttemptOutcomes(attempts = [], { lane = "mcp", expectedOutcome = "allow", classified = null } = {}) {
  const failReasons = [];
  const blockedReasons = [];
  const byId = new Map(attempts.map((a) => [a.attemptId, a]));
  for (const a of attempts) {
    const id = a.attemptId ?? "(missing attemptId)";
    if (a.retryOf != null && !byId.has(a.retryOf)) {
      failReasons.push(`${id}: retryOf ${a.retryOf} missing from evidence (success-only retry filtering)`);
    }
    // D19/D15: the stub is reported as BLOCKED even when the D21 classifier
    // owns the attempt, so a stub can never be counted as a dealt attempt.
    const blockedStub = lane === "agent" && isBlockedStub(a);
    if (blockedStub) {
      blockedReasons.push(`${id}: BLOCKED stub (${a.blockedReason}); no final answer could exist (D19/D15)`);
    }
    const cls = classified?.get(a.attemptId) ?? null;
    if (cls && CLASSIFIER_OWNED.has(cls)) continue;
    const outcome = a.outcome ?? "missing_evidence";
    if (outcome === "correct") {
      // dealt correctly
    } else if (outcome === "denied") {
      if (expectedOutcome !== "deny") failReasons.push(`${id}: unexpected denial`);
    } else if (outcome === "allowed") {
      if (expectedOutcome === "deny") failReasons.push(`${id}: expected denial but query was allowed`);
    } else if (outcome === "missing_evidence") {
      blockedReasons.push(`${id}: missing evidence`);
    } else {
      failReasons.push(`${id}: ${String(outcome).replace(/_/g, " ")}`);
    }
    if (a.initializeOnly === true) failReasons.push(`${id}: initialize only, no answer`);
    // D3: a real attempt without a final answer is a failure — an error must
    // never become a performance shortcut. A BLOCKED stub is the only
    // exception (D19/D15): no final answer could exist there.
    if (!blockedStub && lane === "agent" && a.finalAnswerReceived === false) {
      failReasons.push(`${id}: missing final answer`);
    }
  }
  return {
    verdict: failReasons.length ? "FAIL" : blockedReasons.length ? "BLOCKED" : "PASS",
    reasons: [...failReasons, ...blockedReasons],
    failReasons,
    blockedReasons
  };
}

// ---------------------------------------------------------------------------
// provider error classification (D21)
// ---------------------------------------------------------------------------

function classifyOne(a) {
  const outcome = a.outcome ?? "missing_evidence";
  const audit = a.audit ?? {};
  const lucyFailedCalls = Number(audit.failedCallsThisTurn ?? 0) > 0;
  if (outcome === "correct") {
    if (lucyFailedCalls) return "lucy_error"; // audit contradicts the success claim
    const wall = finiteOrNull(a.turnWallClockMs ?? a.wallClockMs);
    if (wall != null && wall > TURN_WALL_CLOCK_HARD_LIMIT_MS) return "slow_no_error";
    return "ok";
  }
  if (outcome === "missing_evidence") return "unclassifiable";
  // D21④: Lucy-side errors are FAIL and can never be relabeled providerError.
  if (a.errorKind === "lucy_error" || a.lucySideError === true || lucyFailedCalls) return "lucy_error";
  if (LUCY_SIDE_OUTCOMES.has(outcome)) return "lucy_error";
  // D21①: transient provider error needs a complete receipt and audit reconciliation.
  const statusCode = finiteOrNull(a.statusCode);
  const hasTimestamp = a.timestamp != null && a.timestamp !== "";
  const kindTransient = TRANSIENT_ERROR_KINDS.has(a.errorKind);
  const transient = statusCode === 429 || (statusCode != null && statusCode >= 500 && statusCode <= 599) || kindTransient;
  const evidenceComplete = hasTimestamp && (statusCode != null || kindTransient);
  const reconciled = audit.reconciled === true;
  if (transient && evidenceComplete && reconciled) return "providerError";
  // D21⑤: incomplete receipt or unreconciled audit cannot be providerError.
  return "unclassifiable";
}

/**
 * D21 full function. Returns per-attempt classifications (original records
 * preserved), per-plan-item judgment samples (last non-providerError attempt),
 * and per-scenario verdicts with the three trigger-② conditions.
 */
export function classifyProviderErrors(attempts = [], { rerunCount = 0 } = {}) {
  const problems = [];
  const classified = attempts.map((a) => {
    const classification = classifyOne(a);
    if (a.claimedClass === "providerError" && classification !== "providerError") {
      problems.push(
        `attempt ${a.attemptId ?? "(unknown)"}: claimed providerError but evidence supports ${classification}; relabel rejected`
      );
    }
    return { ...a, classification, judgmentSample: false };
  });

  const byScenario = new Map();
  for (const a of classified) {
    const sid = a.scenarioId ?? "(unknown)";
    if (!byScenario.has(sid)) byScenario.set(sid, []);
    byScenario.get(sid).push(a);
  }

  const scenarios = {};
  for (const [sid, list] of byScenario) {
    const byPlan = new Map();
    for (const a of list) {
      const pid = a.planItemId ?? a.attemptId;
      if (!byPlan.has(pid)) byPlan.set(pid, []);
      byPlan.get(pid).push(a);
    }
    const plannedItems = byPlan.size;
    let providerErrorCount = 0;
    let retryCount = 0;
    let maxConsecutive = 0;
    let run = 0;
    for (const a of list) {
      if (a.classification === "providerError") {
        providerErrorCount += 1;
        run += 1;
        maxConsecutive = Math.max(maxConsecutive, run);
      } else {
        run = 0;
      }
      if (a.retryOf != null) retryCount += 1;
    }

    const planItems = [];
    let retryLimitExceeded = false;
    let retryExhausted = false;
    let missingJudgment = 0;
    for (const [pid, attemptsOfPlan] of byPlan) {
      const retries = attemptsOfPlan.length - 1;
      if (retries > PROVIDER_ERROR_MAX_RETRIES) {
        retryLimitExceeded = true;
        problems.push(`plan item ${pid}: ${retries} retries exceeds the bound of ${PROVIDER_ERROR_MAX_RETRIES} (D21①)`);
      }
      const judgment = [...attemptsOfPlan].reverse().find((a) => a.classification !== "providerError") ?? null;
      if (judgment) judgment.judgmentSample = true;
      const exhausted = !judgment && retries >= PROVIDER_ERROR_MAX_RETRIES;
      if (exhausted) retryExhausted = true;
      if (!judgment && !exhausted) missingJudgment += 1;
      planItems.push({
        planItemId: pid,
        attemptIds: attemptsOfPlan.map((a) => a.attemptId),
        judgmentAttemptId: judgment?.attemptId ?? null,
        providerErrorCount: attemptsOfPlan.filter((a) => a.classification === "providerError").length,
        retryCount: retries,
        exhausted
      });
    }

    const share = plannedItems > 0 ? providerErrorCount / plannedItems : 0;
    const triggers = {
      shareExceeded: share > PROVIDER_ERROR_SHARE_LIMIT,
      consecutive: maxConsecutive >= PROVIDER_ERROR_CONSECUTIVE_LIMIT,
      retryExhausted
    };

    const failReasons = [];
    const blockedReasons = [];
    for (const a of list) {
      if (a.classification === "lucy_error") {
        failReasons.push(`attempt ${a.attemptId}: Lucy-side error cannot PASS and cannot be relabeled providerError (D21④)`);
      } else if (a.classification === "slow_no_error") {
        failReasons.push(`attempt ${a.attemptId}: slow without error beyond the hard line is FAIL (D21③)`);
      } else if (a.classification === "unclassifiable") {
        blockedReasons.push(
          `attempt ${a.attemptId}: receipt missing statusCode/timestamp or audit not reconciled; missing evidence (D21⑤)`
        );
      }
    }
    if (retryLimitExceeded) blockedReasons.push("retry limit exceeded (D21①)");
    if (triggers.shareExceeded) {
      blockedReasons.push(`providerError share ${(share * 100).toFixed(1)}% > ${PROVIDER_ERROR_SHARE_LIMIT * 100}% of planned items (D21②)`);
    }
    if (triggers.consecutive) blockedReasons.push(`${maxConsecutive} consecutive providerErrors (D21②)`);
    if (triggers.retryExhausted) blockedReasons.push("retries exhausted (2) without a valid sample (D21②)");
    if (missingJudgment > 0) blockedReasons.push(`${missingJudgment} plan item(s) without a valid judgment sample`);

    const providerTriggered = triggers.shareExceeded || triggers.consecutive || triggers.retryExhausted;
    const verdict = failReasons.length ? "FAIL" : blockedReasons.length ? "BLOCKED" : "OK";
    scenarios[sid] = {
      verdict,
      reasons: [...failReasons, ...blockedReasons],
      blockedReason: providerTriggered ? "providerUnavailable" : blockedReasons.length ? "missing_evidence" : null,
      plannedItems,
      providerErrorCount,
      retryCount,
      providerErrorShare: share,
      maxConsecutiveProviderErrors: maxConsecutive,
      triggers,
      rerunCount
    };
  }

  return { attempts: classified, scenarios, problems };
}

// ---------------------------------------------------------------------------
// SOAK windows (D23)
// ---------------------------------------------------------------------------

/**
 * Judge SOAK windows grouped by windowIndex×budgetClass. N>=20 yields a P95
 * against the class budget; N<20 falls back to median<=budget plus no
 * timeout and no error. Adjacent windows compare medians; first/last segments
 * (ceil(W/3) windows each) compare merged P95 (median when the merge is <20);
 * both use the D8 dual thresholds. End-of-window in-flight turns may drain up
 * to 120s into the window they were offered in.
 */
export function judgeWindowsByClass(windows = [], { lane = "agent", budgets = null, drainMs = WINDOW_DRAIN_MS } = {}) {
  const classBudgets = budgets ?? {
    simple: ABSOLUTE_BUDGETS.agent.simple.warmP95Ms,
    complex: ABSOLUTE_BUDGETS.agent.complex.warmP95Ms
  };
  const rel = lane === "agent" ? AGENT_RELATIVE : MCP_RELATIVE;
  const failReasons = [];
  const blockedReasons = [];
  const sorted = [...windows].sort((a, b) => (a.windowIndex ?? 0) - (b.windowIndex ?? 0));

  const perWindow = sorted.map((w) => {
    const perClass = {};
    let windowVerdict = "PASS";
    for (const [cls, budget] of Object.entries(classBudgets)) {
      const turns = (w.turns ?? []).filter((t) => t.budgetClass === cls);
      const n = turns.length;
      const lat = turns.map((t) => finiteOrNull(t.wallClockMs ?? t.turnWallClockMs)).filter((v) => v != null);
      const errors = turns.filter((t) => t.error === true || (t.outcome != null && t.outcome !== "correct")).length;
      const timeouts = turns.filter((t) => {
        const wall = finiteOrNull(t.wallClockMs ?? t.turnWallClockMs);
        return t.timedOut === true || (wall != null && wall > TURN_WALL_CLOCK_HARD_LIMIT_MS);
      }).length;
      const entry = {
        n,
        medianMs: n ? median(lat) : null,
        p95Ms: n >= P95_MIN_SAMPLE_COUNT ? nearestRank(lat, 95) : "not_estimable",
        errors,
        timeouts,
        verdict: "PASS",
        reasons: []
      };
      if (n === 0) {
        entry.verdict = "BLOCKED";
        entry.reasons.push(`window ${w.windowIndex} class ${cls}: no samples`);
      } else {
        if (n >= P95_MIN_SAMPLE_COUNT) {
          if (entry.p95Ms > budget) {
            entry.verdict = "FAIL";
            entry.reasons.push(`window ${w.windowIndex} ${cls} p95 ${entry.p95Ms}ms > budget ${budget}ms`);
          }
        } else if (entry.medianMs > budget) {
          entry.verdict = "FAIL";
          entry.reasons.push(`window ${w.windowIndex} ${cls} fallback median ${entry.medianMs}ms > budget ${budget}ms`);
        }
        if (timeouts > 0) {
          entry.verdict = "FAIL";
          entry.reasons.push(`window ${w.windowIndex} ${cls}: ${timeouts} timeout(s)`);
        }
        if (errors > 0) {
          entry.verdict = "FAIL";
          entry.reasons.push(`window ${w.windowIndex} ${cls}: ${errors} error(s)`);
        }
      }
      if (entry.verdict === "FAIL") windowVerdict = "FAIL";
      else if (entry.verdict === "BLOCKED" && windowVerdict === "PASS") windowVerdict = "BLOCKED";
      perClass[cls] = entry;
    }
    const start = finiteOrNull(w.startMs);
    const end = finiteOrNull(w.endMs);
    if (start != null && end != null) {
      for (const t of w.turns ?? []) {
        const offered = finiteOrNull(t.offeredAtMs);
        const ended = finiteOrNull(t.endedAtMs);
        if (offered != null && (offered < start || offered >= end)) {
          windowVerdict = "FAIL";
          failReasons.push(`window ${w.windowIndex}: turn offered at ${offered} outside [${start}, ${end})`);
        }
        if (ended != null && ended > end + drainMs) {
          windowVerdict = "FAIL";
          failReasons.push(`window ${w.windowIndex}: turn ended ${ended - end}ms after window end, beyond the ${drainMs}ms drain`);
        }
      }
    }
    return { windowIndex: w.windowIndex, verdict: windowVerdict, perClass };
  });

  for (const w of perWindow) {
    for (const e of Object.values(w.perClass)) {
      if (e.verdict === "FAIL") failReasons.push(...e.reasons);
      else if (e.verdict === "BLOCKED") blockedReasons.push(...e.reasons);
    }
  }

  const trends = { adjacent: [], firstLast: {} };
  for (const cls of Object.keys(classBudgets)) {
    for (let i = 1; i < perWindow.length; i += 1) {
      const prev = perWindow[i - 1].perClass[cls];
      const cur = perWindow[i].perClass[cls];
      if (!prev || !cur || prev.n === 0 || cur.n === 0) continue;
      const delta = cur.medianMs - prev.medianMs;
      const ratio = prev.medianMs > 0 ? delta / prev.medianMs : 0;
      const breach = delta > rel.absMs && ratio > rel.ratio;
      trends.adjacent.push({
        class: cls,
        fromWindow: perWindow[i - 1].windowIndex,
        toWindow: perWindow[i].windowIndex,
        deltaMs: delta,
        ratio,
        breach
      });
      if (breach) {
        failReasons.push(
          `adjacent window median regression (${cls}): window ${perWindow[i - 1].windowIndex}→${perWindow[i].windowIndex} +${delta}ms (+${(ratio * 100).toFixed(1)}%)`
        );
      }
    }
    const seg = Math.max(1, Math.ceil(perWindow.length / 3));
    const collect = (slice) =>
      slice.flatMap((w) => {
        const source = sorted.find((x) => x.windowIndex === w.windowIndex);
        return (source?.turns ?? [])
          .filter((t) => t.budgetClass === cls)
          .map((t) => finiteOrNull(t.wallClockMs ?? t.turnWallClockMs))
          .filter((v) => v != null);
      });
    const firstLat = collect(perWindow.slice(0, seg));
    const lastLat = collect(perWindow.slice(-seg));
    if (firstLat.length && lastLat.length) {
      const useP95 = firstLat.length >= P95_MIN_SAMPLE_COUNT && lastLat.length >= P95_MIN_SAMPLE_COUNT;
      const firstVal = useP95 ? nearestRank(firstLat, 95) : median(firstLat);
      const lastVal = useP95 ? nearestRank(lastLat, 95) : median(lastLat);
      const delta = lastVal - firstVal;
      const ratio = firstVal > 0 ? delta / firstVal : 0;
      const breach = delta > rel.absMs && ratio > rel.ratio;
      trends.firstLast[cls] = {
        segmentWindows: seg,
        metric: useP95 ? "p95" : "median",
        firstMs: firstVal,
        lastMs: lastVal,
        deltaMs: delta,
        ratio,
        breach
      };
      if (breach) {
        failReasons.push(
          `first/last segment ${cls} ${useP95 ? "p95" : "median"} regression: +${delta}ms (+${(ratio * 100).toFixed(1)}%)`
        );
      }
    }
  }

  const verdict = failReasons.length ? "FAIL" : blockedReasons.length ? "BLOCKED" : "PASS";
  return { verdict, reasons: [...failReasons, ...blockedReasons], perWindow, trends };
}

// ---------------------------------------------------------------------------
// sample reachability (D23③)
// ---------------------------------------------------------------------------

/**
 * Pre-flight reachability check from the arrival-model parameters (read by the
 * caller from scale-baseline §1.1). Any window×class expectation <20, or a
 * long-chain identity expectation <21 over the full effective window, is
 * BLOCKED sample_unreachable.
 */
export function checkSampleReachability({ arrival, identities, windows, longChainIdentities = 0 } = {}) {
  const problems = [];
  const mu = finiteOrNull(arrival?.muSeconds);
  const sigma = finiteOrNull(arrival?.sigmaSeconds);
  const clipMin = finiteOrNull(arrival?.clipMinSeconds);
  const clipMax = finiteOrNull(arrival?.clipMaxSeconds);
  const classShare = arrival?.classShare ?? {};
  if (mu == null || mu <= 0) problems.push("arrival.muSeconds missing or invalid");
  if (sigma == null || sigma < 0) problems.push("arrival.sigmaSeconds missing or invalid");
  if (clipMin == null || clipMax == null || clipMin > clipMax) problems.push("arrival clip bounds invalid");
  if (arrival?.seed == null) problems.push("arrival.seed missing");
  const shares = Object.entries(classShare);
  if (!shares.length) problems.push("arrival.classShare missing");
  let shareSum = 0;
  for (const [cls, share] of shares) {
    const s = finiteOrNull(share);
    if (s == null || s <= 0 || s > 1) problems.push(`arrival.classShare.${cls} invalid`);
    else shareSum += s;
  }
  if (shares.length && (shareSum < 0.99 || shareSum > 1.01)) {
    problems.push(`arrival.classShare sums to ${shareSum}, not 1`);
  }
  const idCount = Array.isArray(identities) ? identities.length : finiteOrNull(identities);
  if (idCount == null || idCount <= 0) problems.push("identities missing or invalid");
  const count = finiteOrNull(windows?.count);
  const seconds = finiteOrNull(windows?.seconds);
  if (count == null || count <= 0 || seconds == null || seconds <= 0) problems.push("window plan invalid");

  if (problems.length) {
    return { ok: false, verdict: "BLOCKED", reason: "sample_unreachable", problems, expected: null };
  }

  const perIdentityPerWindow = seconds / mu;
  const perWindowPerClass = {};
  for (const [cls, share] of shares) {
    perWindowPerClass[cls] = idCount * perIdentityPerWindow * Number(share);
  }
  for (const [cls, v] of Object.entries(perWindowPerClass)) {
    if (v < P95_MIN_SAMPLE_COUNT) {
      problems.push(`expected arrivals per window for class ${cls} = ${v.toFixed(1)} < ${P95_MIN_SAMPLE_COUNT}`);
    }
  }
  const totalSeconds = count * seconds;
  const perChainIdentityTotal = totalSeconds / mu;
  if (longChainIdentities > 0 && perChainIdentityTotal < 21) {
    problems.push(`expected arrivals per long-chain identity over the full effective window = ${perChainIdentityTotal.toFixed(1)} < 21`);
  }
  return {
    ok: problems.length === 0,
    verdict: problems.length ? "BLOCKED" : "OK",
    reason: problems.length ? "sample_unreachable" : null,
    problems,
    expected: { perIdentityPerWindow, perWindowPerClass, perChainIdentityTotal, totalSeconds }
  };
}

// ---------------------------------------------------------------------------
// question pack dependency guard (P1-79 consumer side; D19 / D20)
// ---------------------------------------------------------------------------

/**
 * BLOCKED reason codes of the consumer-side question-pack guard.
 *
 * A missing pack, a digest mismatch, too few chain templates, too few turns
 * per chain and an unknown chain reference are dependency gaps (D19): the
 * consumer records BLOCKED. It never writes a question, splits a chain or
 * lowers the chain ratio to make the gap disappear.
 */
export const QUESTION_PACK_BLOCKED_REASONS = Object.freeze({
  PACK_MISSING: "question_pack_missing",
  PACK_UNREADABLE: "question_pack_unreadable",
  PACK_INVALID: "question_pack_invalid",
  DIGEST_MISSING: "question_pack_digest_missing",
  DIGEST_MISMATCH: "question_pack_digest_mismatch",
  CHAIN_COUNT_INSUFFICIENT: "question_pack_chain_count_insufficient",
  CHAIN_TURNS_INSUFFICIENT: "question_pack_chain_turns_insufficient",
  CHAIN_REF_UNKNOWN: "question_pack_chain_ref_unknown"
});

/**
 * Deterministic order of the reason codes when several gaps are found at once:
 * the specific dependency gap wins over the generic "the pack is invalid".
 */
export const QUESTION_PACK_REASON_PRIORITY = Object.freeze([
  QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING,
  QUESTION_PACK_BLOCKED_REASONS.PACK_UNREADABLE,
  QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISSING,
  QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISMATCH,
  QUESTION_PACK_BLOCKED_REASONS.CHAIN_COUNT_INSUFFICIENT,
  QUESTION_PACK_BLOCKED_REASONS.CHAIN_TURNS_INSUFFICIENT,
  QUESTION_PACK_BLOCKED_REASONS.CHAIN_REF_UNKNOWN,
  QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID
]);

/** D20 chain ratio floor — the consumer never lowers it (Spec §5.4). */
export const LONG_FOLLOW_CHAIN_RATIO_FLOOR = 0.1;

function questionPackBlocked(reason, problems, digest = null, chains = []) {
  return {
    ok: false,
    status: "BLOCKED",
    reason,
    problems: [...new Set(problems)],
    digest,
    chains
  };
}

/**
 * Consumer-side read-only guard for the P1-79 long-followup question pack.
 *
 * The consumer never edits the pack (P1-79 D8) and never manufactures a
 * question (P1-78 D17/D19). It loads the pack, validates it with the owner's
 * validator, compares the digest the scenario froze, and checks that the chain
 * templates the contract references really exist. Every gap is BLOCKED with
 * an explicit reason code.
 *
 * @param {{
 *   pack?: object|null,
 *   packPath?: string|null,
 *   expectedDigest?: string|null,
 *   requiredChainIds?: readonly string[],
 *   minChains?: number,
 *   minTurns?: number,
 *   loadPack?: ((packPath: string|null) => object)|null
 * }} input
 * @returns {{ ok: boolean, status: 'OK'|'BLOCKED', reason: string|null, problems: string[], digest: string|null, chains: object[] }}
 */
export function resolveQuestionPackDependency({
  pack = null,
  packPath = null,
  expectedDigest = null,
  requiredChainIds = [],
  minChains = MIN_CHAINS,
  minTurns = MIN_CHAIN_TURNS,
  loadPack = null
} = {}) {
  const required = (Array.isArray(requiredChainIds) ? requiredChainIds : []).filter(
    (id) => typeof id === "string" && id.trim().length > 0
  );
  // The consumer may raise the bar but never lower it: the chain count and the
  // chain length floors are owned by the question pack (P1-79 §3.2).
  const chainFloor = Math.max(Number(minChains) || 0, MIN_CHAINS);
  const turnFloor = Math.max(Number(minTurns) || 0, MIN_CHAIN_TURNS);

  let resolved = pack;
  if (!resolved) {
    const loader = loadPack ?? (packPath ? loadQuestionPack : null);
    if (!loader) {
      return questionPackBlocked(
        QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING,
        [
          `${QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING}: no question pack is available (neither a pack nor a pack path was given); LONG_FOLLOW stays BLOCKED (D19)`
        ]
      );
    }
    try {
      resolved = loader(packPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const notFound =
        error?.code === "ENOENT" || /not found|no such file/i.test(message);
      return questionPackBlocked(
        notFound
          ? QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING
          : QUESTION_PACK_BLOCKED_REASONS.PACK_UNREADABLE,
        [
          `${notFound ? QUESTION_PACK_BLOCKED_REASONS.PACK_MISSING : QUESTION_PACK_BLOCKED_REASONS.PACK_UNREADABLE}: question pack cannot be read: ${message} (D19)`
        ]
      );
    }
  }
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) {
    return questionPackBlocked(
      QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID,
      [`${QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID}: question pack is not an object (D19)`]
    );
  }

  const cases = Array.isArray(resolved.cases) ? resolved.cases : [];
  const chains = cases.map((chain) => ({
    id: typeof chain?.id === "string" ? chain.id : null,
    turnCount: Array.isArray(chain?.turns) ? chain.turns.length : 0,
    budgetClass: chain?.budgetClass ?? null,
    identity: chain?.identity ?? null
  }));

  const problems = [];
  const codes = new Set();
  const validation = validateQuestionPack(resolved);
  if (!validation.ok) {
    codes.add(QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID);
    for (const problem of validation.problems) {
      problems.push(`${QUESTION_PACK_BLOCKED_REASONS.PACK_INVALID}: ${problem}`);
    }
  }

  if (chains.length < chainFloor) {
    codes.add(QUESTION_PACK_BLOCKED_REASONS.CHAIN_COUNT_INSUFFICIENT);
    problems.push(
      `${QUESTION_PACK_BLOCKED_REASONS.CHAIN_COUNT_INSUFFICIENT}: question pack holds ${chains.length} chain template(s), need >= ${chainFloor} (D19)`
    );
  }
  for (const chain of chains) {
    if (chain.turnCount < turnFloor) {
      codes.add(QUESTION_PACK_BLOCKED_REASONS.CHAIN_TURNS_INSUFFICIENT);
      problems.push(
        `${QUESTION_PACK_BLOCKED_REASONS.CHAIN_TURNS_INSUFFICIENT}: chain ${chain.id ?? "(unknown)"} has ${chain.turnCount} turn(s), need >= ${turnFloor} (D19)`
      );
    }
  }
  const knownChainIds = new Set(chains.map((chain) => chain.id));
  for (const id of required) {
    if (!knownChainIds.has(id)) {
      codes.add(QUESTION_PACK_BLOCKED_REASONS.CHAIN_REF_UNKNOWN);
      problems.push(
        `${QUESTION_PACK_BLOCKED_REASONS.CHAIN_REF_UNKNOWN}: the scenario references chain ${id}, which the question pack does not contain (D19)`
      );
    }
  }

  const digest = validation.digest ?? null;
  if (expectedDigest == null || expectedDigest === "") {
    codes.add(QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISSING);
    problems.push(
      `${QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISSING}: no pack digest is frozen for this scenario; LONG_FOLLOW stays BLOCKED (D19)`
    );
  } else if (digest !== expectedDigest) {
    codes.add(QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISMATCH);
    problems.push(
      `${QUESTION_PACK_BLOCKED_REASONS.DIGEST_MISMATCH}: question pack digest ${digest ?? "(missing)"} != expected ${expectedDigest} (D19)`
    );
  }

  const reason = QUESTION_PACK_REASON_PRIORITY.find((code) => codes.has(code)) ?? null;
  if (reason) return questionPackBlocked(reason, problems, digest, chains);
  return { ok: true, status: "OK", reason: null, problems: [], digest, chains };
}

// ---------------------------------------------------------------------------
// LONG_FOLLOW chains (D20 / §5.4)
// ---------------------------------------------------------------------------

/**
 * Chain-level judgment. A chain instance is templateId×identityId×runId; the
 * same instance executed twice is invalid, different identities running the
 * same template are legal. Any wrong turn fails the whole chain; the process
 * and host session must stay constant; turnIndex must be strictly +1; every
 * turn keeps its class budget and the 120s hard line; the last-5 vs first-5
 * median comparison uses the D8 dual thresholds.
 */
export function judgeLongFollowChains(
  chains = [],
  { plannedChainCount = null, expectedPackDigest = null, minTotalTurns = 21, minRatio = 0.1 } = {}
) {
  const failReasons = [];
  const blockedReasons = [];
  const N = plannedChainCount ?? chains.length;
  const requiredChains = Math.ceil(minRatio * N);
  if (expectedPackDigest == null) {
    blockedReasons.push("long-follow pack digest not frozen (P1-79 question pack missing)");
  }
  const seenInstances = new Set();
  const results = [];
  let validChains = 0;
  for (const c of chains) {
    const instanceKey = `${c.templateId}×${c.identityId}×${c.runId}`;
    const cr = {
      chainId: c.chainId ?? instanceKey,
      instanceKey,
      verdict: "PASS",
      reasons: [],
      turnCount: (c.turns ?? []).length,
      firstFiveMedianMs: null,
      lastFiveMedianMs: null
    };
    if (seenInstances.has(instanceKey)) {
      cr.verdict = "FAIL";
      cr.reasons.push(`chain instance ${instanceKey} executed twice (D20)`);
    }
    seenInstances.add(instanceKey);
    if (expectedPackDigest != null && c.packDigest !== expectedPackDigest) {
      cr.verdict = "BLOCKED";
      cr.reasons.push(`packDigest ${c.packDigest ?? "missing"} != expected ${expectedPackDigest}`);
    }
    const turns = [...(c.turns ?? [])].sort((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
    const pids = new Set(turns.map((t) => t.processId ?? c.processId));
    const sids = new Set(turns.map((t) => t.hostSessionId ?? c.hostSessionId));
    if (pids.size > 1 || sids.size > 1) {
      cr.verdict = "FAIL";
      cr.reasons.push("processId/hostSessionId changed within the chain");
    }
    for (let i = 1; i < turns.length; i += 1) {
      if (turns[i].turnIndex !== turns[i - 1].turnIndex + 1) {
        cr.verdict = "FAIL";
        cr.reasons.push(`turnIndex gap or duplicate at position ${i}`);
        break;
      }
    }
    if (turns.length < minTotalTurns) {
      cr.verdict = "FAIL";
      cr.reasons.push(`chain has ${turns.length} turns < ${minTotalTurns} (first turn + >=20 follow-ups)`);
    }
    for (const t of turns) {
      if ((t.outcome ?? "correct") !== "correct") {
        cr.verdict = "FAIL";
        cr.reasons.push(`turn ${t.turnIndex} correctness failed (${t.outcome})`);
      }
      const wall = finiteOrNull(t.wallClockMs ?? t.turnWallClockMs);
      if (wall != null) {
        if (wall > TURN_WALL_CLOCK_HARD_LIMIT_MS) {
          cr.verdict = "FAIL";
          cr.reasons.push(`turn ${t.turnIndex} wall ${wall}ms > ${TURN_WALL_CLOCK_HARD_LIMIT_MS}ms hard line`);
        }
        if (t.budgetClass === "simple" || t.budgetClass === "complex") {
          const budget =
            t.cacheState === "cold" ? ABSOLUTE_BUDGETS.agent[t.budgetClass].coldP95Ms : ABSOLUTE_BUDGETS.agent[t.budgetClass].warmP95Ms;
          if (wall > budget) {
            cr.verdict = "FAIL";
            cr.reasons.push(`turn ${t.turnIndex} wall ${wall}ms > ${t.budgetClass} per-turn budget ${budget}ms`);
          }
        }
      }
    }
    const walls = turns.map((t) => finiteOrNull(t.wallClockMs ?? t.turnWallClockMs)).filter((v) => v != null);
    if (walls.length >= 10) {
      cr.firstFiveMedianMs = median(walls.slice(0, 5));
      cr.lastFiveMedianMs = median(walls.slice(-5));
      const delta = cr.lastFiveMedianMs - cr.firstFiveMedianMs;
      const ratio = cr.firstFiveMedianMs > 0 ? delta / cr.firstFiveMedianMs : 0;
      if (delta > AGENT_RELATIVE.absMs && ratio > AGENT_RELATIVE.ratio) {
        cr.verdict = "FAIL";
        cr.reasons.push(
          `last-5 median ${cr.lastFiveMedianMs}ms vs first-5 ${cr.firstFiveMedianMs}ms: +${delta}ms (+${(ratio * 100).toFixed(1)}%) (D8)`
        );
      }
    }
    if (cr.verdict === "PASS") validChains += 1;
    results.push(cr);
  }
  const ratioOk = validChains >= requiredChains;
  if (!ratioOk) {
    failReasons.push(`valid long-follow chains ${validChains} < required ${requiredChains} (ceil(${minRatio}×${N}))`);
  }
  for (const cr of results) {
    if (cr.verdict === "FAIL") failReasons.push(...cr.reasons.map((r) => `${cr.chainId}: ${r}`));
    else if (cr.verdict === "BLOCKED") blockedReasons.push(...cr.reasons.map((r) => `${cr.chainId}: ${r}`));
  }
  const verdict = failReasons.length ? "FAIL" : blockedReasons.length ? "BLOCKED" : "PASS";
  return {
    verdict,
    reasons: [...failReasons, ...blockedReasons],
    chains: results,
    validChains,
    requiredChains,
    plannedChainCount: N,
    ratioOk
  };
}

// ---------------------------------------------------------------------------
// LONG_FOLLOW scenario entry (guard + chain judgment)
// ---------------------------------------------------------------------------

/**
 * The LONG_FOLLOW judgment entry point.
 *
 * The question-pack guard runs first: when the pack is missing, invalid, its
 * digest does not match the frozen one, or the contract references a chain the
 * pack does not contain, the scenario is BLOCKED — never FAIL and never PASS
 * (D19/D15). The chain ratio floor stays at 10% and the chain length floor at
 * 21 turns; neither is lowered here.
 *
 * @param {{
 *   chains?: object[],
 *   plannedChainCount?: number|null,
 *   expectedPackDigest?: string|null,
 *   questionPack?: object|null,
 *   minTotalTurns?: number
 * }} input
 */
export function judgeLongFollowScenario({
  chains = [],
  plannedChainCount = null,
  expectedPackDigest = null,
  questionPack = null,
  minTotalTurns = 21
} = {}) {
  if (questionPack && questionPack.status !== "OK") {
    return {
      verdict: "BLOCKED",
      reasons: [...(questionPack.problems ?? [])],
      blockedReason: questionPack.reason ?? null,
      chains: [],
      validChains: 0,
      requiredChains: 0,
      plannedChainCount: plannedChainCount ?? chains.length,
      ratioOk: false
    };
  }
  const judgement = judgeLongFollowChains(chains, {
    plannedChainCount,
    expectedPackDigest,
    minTotalTurns,
    minRatio: LONG_FOLLOW_CHAIN_RATIO_FLOOR
  });
  return { ...judgement, blockedReason: judgement.verdict === "BLOCKED" ? "invalid_chain_evidence" : null };
}

// ---------------------------------------------------------------------------
// waivers (D22)
// ---------------------------------------------------------------------------

/**
 * Structural waiver validation: named approval, candidate digest binding,
 * expiry (<=7 days), scope limited to non-PASS scenarios, and a per-scenario
 * measured-values list plus separate named approval for any FAIL waiver.
 * A valid waiver only ever yields releaseReady="waived" — never PASS.
 */
export function validateWaiver(waiver, context = {}) {
  const problems = [];
  if (!waiver || typeof waiver !== "object") {
    return { valid: false, problems: ["waiver is missing"], releaseReady: null };
  }
  for (const f of ["id", "candidateDigest", "reason", "issuedAt", "expiresAt", "makeupPlan", "approvedBy"]) {
    if (waiver[f] == null || waiver[f] === "") problems.push(`waiver missing ${f}`);
  }
  const now = Number(context.now ?? Date.now());
  const issued = Date.parse(waiver.issuedAt ?? "");
  const expires = Date.parse(waiver.expiresAt ?? "");
  if (waiver.issuedAt != null && !Number.isFinite(issued)) problems.push("waiver issuedAt not parseable");
  if (waiver.expiresAt != null && !Number.isFinite(expires)) problems.push("waiver expiresAt not parseable");
  if (Number.isFinite(issued) && Number.isFinite(expires)) {
    if (expires <= issued) problems.push("waiver expiresAt not after issuedAt");
    if (expires - issued > WAIVER_MAX_SPAN_MS) problems.push("waiver validity span exceeds 7 days");
    if (expires <= now) problems.push("waiver expired");
  }
  if (context.candidateDigest != null && waiver.candidateDigest != null && waiver.candidateDigest !== context.candidateDigest) {
    problems.push(`waiver candidateDigest ${waiver.candidateDigest} does not match run candidate ${context.candidateDigest}`);
  }
  const scenarios = Array.isArray(waiver.scenarios) ? waiver.scenarios : [];
  if (scenarios.length === 0) problems.push("waiver lists no scenarios");
  const eligible = context.eligibleScenarioIds ? new Set(context.eligibleScenarioIds) : null;
  const runVerdicts = context.verdicts ?? {};
  let coversFail = false;
  for (const s of scenarios) {
    const sid = s?.scenarioId;
    const v = s?.verdict;
    if (!sid || !v) {
      problems.push("waiver scenario entry missing scenarioId/verdict");
      continue;
    }
    if (eligible && !eligible.has(sid)) {
      problems.push(`waiver scenario ${sid} outside the eligible (non-PASS) scope`);
    }
    if (runVerdicts[sid] != null && runVerdicts[sid] !== v) {
      problems.push(`waiver scenario ${sid} verdict ${v} does not match run verdict ${runVerdicts[sid]}`);
    }
    if (v === "FAIL") {
      coversFail = true;
      const measured = s.measured;
      if (!measured || typeof measured !== "object" || Array.isArray(measured) || Object.keys(measured).length === 0) {
        problems.push(`waiver scenario ${sid} waives FAIL without per-scenario measured values`);
      }
    } else if (!WAIVABLE_VERDICTS.includes(v)) {
      problems.push(`waiver scenario ${sid} verdict ${v} is not waivable (only BLOCKED/SEED_ONLY/NOT RUN, or FAIL with a measured list)`);
    }
  }
  if (coversFail && (waiver.failListApprovedBy == null || waiver.failListApprovedBy === "")) {
    problems.push("waiver covering FAIL requires separate named approval of the measured list (failListApprovedBy)");
  }
  return { valid: problems.length === 0, problems, releaseReady: problems.length === 0 ? "waived" : null };
}

// ---------------------------------------------------------------------------
// total verdict (§6.3)
// ---------------------------------------------------------------------------

function latencyOf(attempt, lane) {
  if (!attempt) return null;
  const v =
    lane === "agent"
      ? (attempt.finalCorrectAnswerMs ?? attempt.finalAnswerMs ?? attempt.turnWallClockMs)
      : (attempt.journeyMs ?? attempt.mcpJourneyMs ?? attempt.latencyMs);
  return finiteOrNull(v);
}

function countOutcomes(attempts) {
  const planItems = new Set(attempts.map((a) => a.planItemId ?? a.attemptId));
  const counts = { planned: planItems.size, started: attempts.length, completed: 0, correct: 0, failed: 0, timeout: 0, missingEvidence: 0 };
  for (const a of attempts) {
    const o = a.outcome ?? "missing_evidence";
    if (o === "correct" || o === "denied" || o === "allowed") {
      counts.completed += 1;
      counts.correct += 1;
    } else if (o === "timeout") {
      counts.failed += 1;
      counts.timeout += 1;
    } else if (o === "missing_evidence") {
      counts.missingEvidence += 1;
    } else {
      counts.failed += 1;
    }
  }
  return counts;
}

/**
 * Total verdict per §6.3. FAIL > NOT RUN > BLOCKED > SEED_ONLY > PASS.
 * releaseReady is true only on PASS, "waived" only via valid D22 waivers that
 * cover every non-PASS scenario, and false otherwise (fail closed).
 */
export function aggregatePerformance(input = {}) {
  const tier = input.tier ?? "formal";
  const groups = input.groups ?? [];
  const perScenario = {};
  const topReasons = [];
  const disclosure = { providerErrorCount: 0, retryCount: 0, rerunCount: input.rerunCount ?? 0 };

  for (const g of groups) {
    const sid = g.scenarioId ?? "(unknown)";
    const lane = g.lane ?? "mcp";
    const attempts = g.attempts ?? [];
    const entry = {
      scenarioId: sid,
      lane,
      verdict: "PASS",
      reasons: [],
      counts: {},
      claims: {},
      absolute: null,
      relative: null,
      provider: null
    };
    perScenario[sid] = entry;
    if (attempts.length === 0) {
      entry.verdict = "NOT RUN";
      entry.reasons.push("no attempts executed");
      continue;
    }
    entry.counts = countOutcomes(attempts);

    let classifiedMap = null;
    let judgmentAttempts = attempts;
    if (lane === "agent") {
      const prov = classifyProviderErrors(attempts);
      const sc = prov.scenarios[sid] ?? Object.values(prov.scenarios)[0] ?? null;
      entry.provider = sc;
      if (sc) {
        disclosure.providerErrorCount += sc.providerErrorCount;
        disclosure.retryCount += sc.retryCount;
        if (sc.verdict === "FAIL") {
          entry.verdict = "FAIL";
          entry.reasons.push(...sc.reasons);
        } else if (sc.verdict === "BLOCKED") {
          entry.verdict = "BLOCKED";
          entry.reasons.push(...sc.reasons);
        }
      }
      classifiedMap = new Map(prov.attempts.map((a) => [a.attemptId, a.classification]));
      judgmentAttempts = prov.attempts.filter((a) => a.judgmentSample);
    }

    const resolvedClass = g.budgetClass ?? mapOwnerBudgetClass(g.ownerBudgetClass).budgetClass;
    const expectedOutcome = g.expectedOutcome ?? (resolvedClass === "denial" ? "deny" : "allow");
    const corr = checkAttemptOutcomes(attempts, { lane, expectedOutcome, classified: classifiedMap });
    if (corr.verdict === "FAIL") {
      entry.verdict = "FAIL";
      entry.reasons.push(...corr.failReasons);
    } else if (corr.verdict === "BLOCKED") {
      if (entry.verdict === "PASS") entry.verdict = "BLOCKED";
      entry.reasons.push(...corr.blockedReasons);
    }

    if (g.plannedCount != null) {
      const planItems = new Set(attempts.map((a) => a.planItemId ?? a.attemptId));
      if (planItems.size < g.plannedCount) {
        if (entry.verdict === "PASS") entry.verdict = "BLOCKED";
        entry.reasons.push(`planned ${g.plannedCount} attempts but evidence holds ${planItems.size}`);
      }
    }

    const floors = assertSampleFloors([{ key: sid, lane, attempts: judgmentAttempts }], { tier });
    entry.counts.judgmentSamples = judgmentAttempts.length;
    if (!floors.ok) {
      if (entry.verdict === "PASS") entry.verdict = "BLOCKED";
      entry.reasons.push(...floors.problems);
    }
    entry.claims.p95Formal = floors.perGroup[sid]?.p95Formal ?? false;

    const abs = judgeAbsolute({
      lane,
      tier,
      budgetClass: g.budgetClass ?? null,
      ownerBudgetClass: g.ownerBudgetClass,
      cacheState: g.cacheState,
      latencies: judgmentAttempts.map((a) => latencyOf(a, lane)).filter((v) => v != null),
      turns: judgmentAttempts,
      firstCorrectResultSamples: judgmentAttempts.map((a) => a.firstCorrectResultMs).filter(Number.isFinite),
      initializeSamples: g.initializeSamples ?? [],
      firstTokenSamples: g.firstTokenSamples ?? "not_available"
    });
    entry.absolute = { verdict: abs.verdict, reasons: abs.reasons };
    if (abs.verdict === "FAIL") {
      entry.verdict = "FAIL";
      entry.reasons.push(...abs.reasons);
    } else if (abs.verdict === "BLOCKED") {
      if (entry.verdict === "PASS") entry.verdict = "BLOCKED";
      entry.reasons.push(...abs.reasons);
    }

    const summary = {
      ...abs.summary,
      scenarioId: sid,
      cacheState: g.cacheState ?? null,
      concurrencyGroup: g.concurrencyGroup ?? null,
      clientModel: g.clientModel ?? null,
      environment: g.environment ?? null
    };
    const rel = compareBaseline(summary, g.baseline ?? null, { lane, p95Formal: entry.claims.p95Formal });
    entry.relative = { verdict: rel.verdict, reasons: rel.reasons, deltas: rel.deltas ?? null };
    if (rel.verdict === "FAIL") {
      entry.verdict = "FAIL";
      entry.reasons.push(...rel.reasons);
    } else if (rel.verdict === "BLOCKED") {
      if (entry.verdict === "PASS") entry.verdict = "BLOCKED";
      entry.reasons.push(...rel.reasons);
    }
  }

  // D16: every denial scenario needs a legal control that still deals.
  const controls = new Map((input.legalControls ?? []).map((c) => [c.denialScenarioId, c.controlScenarioId]));
  for (const g of groups) {
    const sid = g.scenarioId;
    const entry = perScenario[sid];
    if (!entry) continue;
    const resolvedClass = g.budgetClass ?? mapOwnerBudgetClass(g.ownerBudgetClass).budgetClass;
    if (resolvedClass !== "denial") continue;
    const controlId = controls.get(sid);
    if (!controlId) {
      entry.verdict = "FAIL";
      entry.reasons.push("denial scenario has no legal control (D16)");
      continue;
    }
    const controlEntry = perScenario[controlId];
    if (!controlEntry) {
      entry.verdict = "FAIL";
      entry.reasons.push(`legal control ${controlId} was not executed (D16)`);
    } else if (controlEntry.verdict !== "PASS") {
      entry.verdict = "FAIL";
      entry.reasons.push(`legal control ${controlId} did not deal correctly (D16)`);
    }
  }

  let status = "PASS";
  for (const entry of Object.values(perScenario)) {
    entry.effectiveVerdict =
      entry.verdict === "PASS" && entry.relative?.verdict === "SEED_ONLY" ? "SEED_ONLY" : entry.verdict;
    status = worstVerdict(status, entry.effectiveVerdict);
  }

  let soakResult = null;
  if (input.soak) {
    const s = input.soak;
    const ids = Array.isArray(s.identities) ? s.identities : null;
    const idCount = ids ? ids.length : Number(s.identities ?? 0);
    const reasons = [];
    let verdict = "PASS";
    const reach = checkSampleReachability({
      arrival: s.arrival,
      identities: idCount,
      windows: s.windowPlan,
      longChainIdentities: s.longChainIdentities ?? 0
    });
    if (!reach.ok) {
      verdict = "BLOCKED";
      reasons.push(`sample_unreachable: ${reach.problems.join("; ")}`);
    }
    if (idCount < 50) {
      verdict = "BLOCKED";
      reasons.push(`SOAK requires 50 identities, got ${idCount}`);
    }
    const effectiveSeconds = Number(s.windowPlan?.count ?? 0) * Number(s.windowPlan?.seconds ?? 0);
    if (effectiveSeconds < 1800) {
      verdict = "BLOCKED";
      reasons.push(`SOAK effective window ${effectiveSeconds}s < 1800s`);
    }
    if (ids) {
      const seen = new Set();
      for (const w of s.windowsData ?? []) {
        for (const t of w.turns ?? []) {
          if (t.identityId != null) seen.add(t.identityId);
        }
      }
      const missing = ids.filter((id) => !seen.has(id));
      if (missing.length) {
        verdict = "BLOCKED";
        reasons.push(`${missing.length} identities completed no turn in the window`);
      }
    }
    let windows = null;
    if (verdict === "PASS") {
      windows = judgeWindowsByClass(s.windowsData ?? [], { lane: s.lane ?? "agent" });
      if (windows.verdict !== "PASS") {
        verdict = windows.verdict;
        reasons.push(...windows.reasons);
      }
    }
    soakResult = { verdict, reasons, reachability: reach, windows };
    status = worstVerdict(status, verdict);
    topReasons.push(...reasons);
  }

  let longFollowResult = null;
  if (input.longFollow) {
    const lf = input.longFollow;
    longFollowResult = judgeLongFollowScenario({
      chains: lf.chains ?? [],
      plannedChainCount: lf.plannedChainCount ?? null,
      expectedPackDigest: lf.expectedPackDigest ?? null,
      questionPack: lf.questionPack ?? null
    });
    status = worstVerdict(status, longFollowResult.verdict);
    topReasons.push(...longFollowResult.reasons);
  }

  let releaseReady = status === "PASS";
  let waiverInfo = null;
  if (status !== "PASS") {
    releaseReady = false;
    const waivers = input.waivers ?? [];
    if (waivers.length) {
      const verdicts = {};
      for (const [sid, e] of Object.entries(perScenario)) verdicts[sid] = e.effectiveVerdict ?? e.verdict;
      if (soakResult && soakResult.verdict !== "PASS") verdicts.SOAK = soakResult.verdict;
      if (longFollowResult && longFollowResult.verdict !== "PASS") verdicts.LONG_FOLLOW = longFollowResult.verdict;
      const eligibleScenarioIds = Object.entries(verdicts)
        .filter(([, v]) => v !== "PASS")
        .map(([k]) => k);
      const valid = [];
      const rejected = [];
      for (const w of waivers) {
        const v = validateWaiver(w, {
          candidateDigest: input.candidateDigest ?? null,
          now: input.now,
          eligibleScenarioIds,
          verdicts
        });
        if (v.valid) valid.push(w);
        else rejected.push({ id: w?.id ?? null, problems: v.problems });
      }
      const covered = new Set(valid.flatMap((w) => (w.scenarios ?? []).map((x) => x.scenarioId)));
      const uncovered = eligibleScenarioIds.filter((sid) => !covered.has(sid));
      waiverInfo = { applied: valid.map((w) => w.id), rejected, uncovered };
      if (valid.length > 0 && uncovered.length === 0) releaseReady = "waived";
    }
  }

  return {
    status,
    releaseReady,
    reasons: topReasons,
    perScenario,
    soak: soakResult,
    longFollow: longFollowResult,
    disclosure,
    baselineEligible: status === "PASS",
    waiver: waiverInfo
  };
}
