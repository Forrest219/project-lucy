/**
 * P1-78 Task 4 — real Agent journey lane + this spec's own 20/50-lane plan.
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D2 dual lane, D3 correctness precondition, D5 scenario isolation,
 *    D6 samples, D9 comparable fingerprints, D14 unobservable latencies,
 *    D19 missing dependency ⇒ BLOCKED, D21 provider/host error buckets,
 *    §4.2 timing milestones, §4.3 attempt fields, §5.2 agent budgets,
 *    §5.3 concurrency fairness)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 4
 *
 * Scope of this module
 * -------------------
 * - The host orchestration layer for the REAL Agent lane: question submit,
 *   first observable response event, first answer-body token, final answer
 *   completion, per-turn wall clock, tool trace and per-role concurrency.
 * - The attempt records use the same shape as the deterministic MCP lane
 *   (mcp-inquiry-performance-client.mjs) so the shared judge
 *   (mcp-inquiry-performance.mjs) and the independent verifier
 *   (mcp-inquiry-performance-evidence.mjs) can consume both lanes side by side.
 * - It never judges by itself: verdicts come from the shared judge. This
 *   module only records, plans and classifies.
 *
 * Deliberate non-goals (hard constraints)
 * ---------------------------------------
 * - No product runtime code, no KTX, no Docker, no network at import time.
 * - The real host path is wired but never executed by the unit tests; the
 *   tests inject a fake adapter and a manual clock.
 * - `runAgentJourneys` (P1-53) is NOT reused or modified: its concurrency cap
 *   and its default denominator stay untouched. The 20/50-lane plan here is
 *   this spec's own planner.
 * - Questions/oracles are owned by P1-54; this module only references them.
 *
 * Optional adapter hook (additive, not required by this module)
 * ------------------------------------------------------------
 * An adapter MAY export `parseStreamEvent(line)` to expose the host's own
 * stream events so the harness can timestamp them:
 *
 *   parseStreamEvent(line) -> null | {
 *     type: "session" | "tool" | "tool_result" | "content" | "final" | "error",
 *     text?: string, name?: string, rpcRequestId?: string, model?: string
 *   }
 *
 * Rules the hook must respect (Spec §4.2 / D4):
 * - "content" means a proven partial answer token. A complete assistant
 *   message is "final", never "content" — a whole message is not a token.
 * - `initialize`, session and keepalive events are never a response event.
 * - An adapter that cannot classify a line returns null; the harness then
 *   reports the turn as coarse (first observable == final answer) and the
 *   first token as "not_available". Nothing is ever guessed.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { TOKEN_ENV } from "../adapters/_contract.mjs";
import {
  assertFingerprintsSticky,
  buildClientFingerprint,
  buildModelFingerprint,
  detectCompatClients,
  selectCompatClient
} from "./mcp-agent-journeys.mjs";
import { CORRECTNESS_VALUES, OUTCOME_VALUES } from "./mcp-inquiry-performance-evidence.mjs";
import {
  checkAttemptOutcomes,
  classifyProviderErrors,
  judgeAbsolute,
  median,
  nearestRank
} from "./mcp-inquiry-performance.mjs";

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const HARNESS_VERSION = "1.0.0";

/** D6 formal Agent floor: >= 20 attempts per scenario / host. */
export const DEFAULT_AGENT_SAMPLES = 20;

/** D6: below this count no formal P95 may be claimed. */
export const P95_MIN_SAMPLE_COUNT = 20;

/** §5.3 fairness line: slowest role p95 <= fastest role p95 × 2 + 2s. */
export const FAIRNESS_LIMIT = Object.freeze({ ratio: 2, absMs: 2_000 });

/** Plan Task 4 step 5: detailed observation must not cost >20% AND >50ms p95. */
export const OBSERVATION_OVERHEAD_LIMIT = Object.freeze({ ratio: 0.2, absMs: 50 });

/** §4.2: an unobservable latency is the literal string, never 0. */
export const FIRST_TOKEN_NOT_AVAILABLE = "not_available";
export const NOT_AVAILABLE = "not_available";

/** §4.2: the host only exposed the final answer ⇒ first observable == final. */
export const FIRST_OBSERVABLE_COARSE = "coarse";
export const FIRST_OBSERVABLE_OBSERVED = "observed";

/** Plan Task 4 step 5: the two observation modes. */
export const OBSERVATION_MODES = Object.freeze(["detailed", "minimal"]);

/** D21①: at most 2 retries per plan item. */
export const PROVIDER_MAX_RETRIES = 2;

/** D21①: error kinds the judge treats as transient even without a status code. */
export const TRANSIENT_ERROR_KINDS = Object.freeze(["connection_reset", "provider_timeout"]);

/** Response events that count as "the host answered this question". */
const RESPONSE_EVENT_TYPES = new Set(["tool", "tool_result", "content", "text", "delta", "final", "error"]);
/** Events that carry answer-body text (the first one is the first token). */
const CONTENT_EVENT_TYPES = new Set(["content", "text", "delta"]);
/** Host lifecycle noise — never a response to the question (D4). */
const NON_RESPONSE_EVENT_TYPES = new Set([
  "session",
  "session_id",
  "keepalive",
  "heartbeat",
  "ping",
  "initialize",
  "initialized"
]);
/** Tool traffic — the trace correlated with the MCP lane. */
const TOOL_EVENT_TYPES = new Set(["tool", "tool_result"]);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function finiteOrNull(v) {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function defaultNow() {
  // performance.now() is monotonic; the UTC stamp is carried separately.
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function defaultUtcNow() {
  return new Date().toISOString();
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function worstVerdict(a, b) {
  const rank = { PASS: 0, SEED_ONLY: 1, "NOT RUN": 2, BLOCKED: 3, FAIL: 4 };
  return (rank[b] ?? 0) > (rank[a] ?? 0) ? b : a;
}

function dedupe(values) {
  return [...new Set(values.filter((v) => v != null && v !== ""))];
}

// ---------------------------------------------------------------------------
// §4.2 timing milestones
// ---------------------------------------------------------------------------

/**
 * Compute the §4.2 milestones of one host turn.
 *
 * Rules enforced here (all of them are test-visible):
 * - the first observable response event is the earliest NON keepalive /
 *   non-lifecycle event; tool events and answer-body events stay separate;
 * - a host that only exposes the final answer yields `coarse` and the first
 *   observable equals the final answer;
 * - the first answer token is NEVER taken from `initialize`, a session event
 *   or a tool event — when the host cannot show it, it is "not_available";
 * - every milestone shares the one monotonic clock domain of the turn.
 *
 * @param {object} input
 * @param {number} input.questionStartedAt monotonic start of the turn
 * @param {object[]} [input.events] host events with absolute `atMs`
 * @param {number|null} [input.finalAnswerAt] monotonic completion of the answer
 * @param {number|null} [input.turnEndedAt] monotonic end of the turn
 */
export function computeTurnMilestones({
  questionStartedAt = null,
  events = [],
  finalAnswerAt = null,
  turnEndedAt = null
} = {}) {
  const base = finiteOrNull(questionStartedAt);
  const ordered = (Array.isArray(events) ? events : [])
    .filter((e) => isPlainObject(e) && finiteOrNull(e.atMs) != null)
    .map((e) => ({ ...e, atMs: Number(e.atMs) }))
    .sort((a, b) => a.atMs - b.atMs);

  const observed = ordered.filter(
    (e) => RESPONSE_EVENT_TYPES.has(String(e.type)) && !NON_RESPONSE_EVENT_TYPES.has(String(e.type))
  );
  const first = observed[0] ?? null;
  const content = observed.find((e) => CONTENT_EVENT_TYPES.has(String(e.type))) ?? null;

  const finalEvent = observed.find((e) => String(e.type) === "final") ?? null;
  const answerAt = finiteOrNull(finalAnswerAt) ?? (finalEvent ? finalEvent.atMs : null);
  const endAt = finiteOrNull(turnEndedAt) ?? base;

  const finalAnswerMs = base != null && answerAt != null ? answerAt - base : null;
  const turnWallClockMs = base != null && endAt != null ? Math.max(0, endAt - base) : null;

  let firstObservableMs = NOT_AVAILABLE;
  let firstObservableQuality = NOT_AVAILABLE;
  let firstObservableKind = null;
  if (first) {
    firstObservableKind = String(first.type);
    if (String(first.type) === "final") {
      // The host exposed nothing but the final answer ⇒ coarse.
      firstObservableQuality = FIRST_OBSERVABLE_COARSE;
      firstObservableMs = finalAnswerMs != null ? finalAnswerMs : first.atMs - base;
    } else {
      firstObservableQuality = FIRST_OBSERVABLE_OBSERVED;
      firstObservableMs = first.atMs - base;
    }
  } else if (finalAnswerMs != null) {
    firstObservableQuality = FIRST_OBSERVABLE_COARSE;
    firstObservableMs = finalAnswerMs;
    firstObservableKind = "final";
  }

  const firstTokenMs = base != null && content ? content.atMs - base : FIRST_TOKEN_NOT_AVAILABLE;

  // D14: unattributed wall clock = turn wall clock minus the observed span.
  // Overlapping spans are never summed; the observed span is a single
  // first-event → last-event interval.
  let attributedMs = 0;
  if (observed.length >= 1) {
    const firstAt = observed[0].atMs;
    const lastAt = observed[observed.length - 1].atMs;
    attributedMs = Math.max(0, lastAt - firstAt);
  }
  const unattributedMs =
    turnWallClockMs == null ? NOT_AVAILABLE : Math.max(0, turnWallClockMs - attributedMs);

  return {
    questionStartedAt: base,
    firstObservableMs,
    firstObservableQuality,
    firstObservableKind,
    firstTokenMs,
    finalAnswerMs,
    turnWallClockMs,
    attributedMs,
    unattributedMs,
    observedEventCount: observed.length,
    toolEventCount: observed.filter((e) => TOOL_EVENT_TYPES.has(String(e.type))).length
  };
}

// ---------------------------------------------------------------------------
// P1-54 oracle guardrail (D3)
// ---------------------------------------------------------------------------

const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?/g;

function extractNumbers(text) {
  const out = [];
  const source = String(text ?? "");
  let match;
  NUMBER_RE.lastIndex = 0;
  while ((match = NUMBER_RE.exec(source)) !== null) {
    const n = Number(String(match[0]).replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function collectDeepNumbers(value, out = []) {
  if (value == null) return out;
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.push(value);
    return out;
  }
  if (typeof value === "string") {
    out.push(...extractNumbers(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDeepNumbers(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectDeepNumbers(item, out);
  }
  return out;
}

function collectDeepStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDeepStrings(item, out);
    return out;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectDeepStrings(item, out);
  }
  return out;
}

function toleranceFor(target) {
  return Math.max(1e-9, Math.abs(target) * 1e-12);
}

/**
 * Does the observed text/payload contain the expected value?
 * Numbers match exactly, with the 万 (×10 000) scale the answer style uses.
 */
function valueMatches(expected, numbers, strings) {
  if (typeof expected === "number") {
    if (!Number.isFinite(expected)) return false;
    const tol = toleranceFor(expected);
    return numbers.some((n) => {
      if (Math.abs(n - expected) <= tol) return true;
      if (Math.abs(n * 10_000 - expected) <= tol) return true;
      if (Math.abs(n / 10_000 - expected) <= tol) return true;
      return false;
    });
  }
  if (typeof expected === "string") {
    const needle = expected.replace(/\s+/g, "");
    if (needle === "") return true;
    return strings.some((s) => String(s).replace(/\s+/g, "").includes(needle));
  }
  if (typeof expected === "boolean") return true;
  return false;
}

function expectedEntries(oracle) {
  const expect = oracle?.expect ?? null;
  if (expect == null) return [];
  if (Array.isArray(expect)) return expect.map((v, i) => [String(i), v]);
  if (isPlainObject(expect)) return Object.entries(expect);
  return [["value", expect]];
}

/**
 * Oracle guardrail for the FINAL ANSWER of a turn.
 *
 * Only the P1-54 oracle decides validity; this module never re-authors a
 * question or an expectation. Unsupported oracle kinds return "unknown" so
 * the attempt stays unverified instead of being counted as correct.
 *
 * @returns {{ verdict: "correct"|"wrong"|"unknown", reason: string }}
 */
export function createExactOracleChecker() {
  return function check({ testCase = null, turnIndex = 0, finalAnswer = "", toolResults = [] } = {}) {
    const oracle = testCase?.oracle ?? null;
    if (!oracle || oracle.kind !== "exact") {
      return {
        verdict: "unknown",
        reason: `oracle kind ${oracle?.kind ?? "(none)"} is not verifiable by the agent-lane harness`
      };
    }
    const entries = expectedEntries(oracle);
    if (entries.length === 0) {
      return { verdict: "unknown", reason: "oracle carries no expected values" };
    }
    const text = String(finalAnswer ?? "");
    if (text.trim() === "") {
      // D3: a tool result without a final answer is not a finished answer.
      return { verdict: "wrong", reason: "no final answer to check" };
    }
    const numbers = extractNumbers(text);
    const strings = [text];
    const missing = entries
      .filter(([, value]) => !valueMatches(value, numbers, strings))
      .map(([key]) => key);
    if (missing.length === 0) return { verdict: "correct", reason: "all expected values present" };
    return { verdict: "wrong", reason: `missing expected value(s): ${missing.join(", ")}` };
  };
}

/**
 * Oracle guardrail for a TOOL RESULT payload (the "first correct result"
 * milestone). Returns null when the oracle kind cannot be checked here.
 */
export function createExactResultOracleChecker() {
  return function check({ testCase = null, toolResult = null } = {}) {
    const oracle = testCase?.oracle ?? null;
    if (!oracle || oracle.kind !== "exact") return null;
    const entries = expectedEntries(oracle);
    if (entries.length === 0) return null;
    const numbers = collectDeepNumbers(toolResult);
    const strings = collectDeepStrings(toolResult);
    for (const [, value] of entries) {
      if (!valueMatches(value, numbers, strings)) return false;
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// planning (D6) and question resolution (D17)
// ---------------------------------------------------------------------------

/**
 * Plan the attempts of one scenario. The default is the formal Agent floor
 * (>= 20); an explicit sample count overrides it but never drops below 1.
 */
export function planScenarioAttempts({ scenario = null, samples = null, tier = "formal" } = {}) {
  const floor = finiteOrNull(scenario?.sampleFloors?.[tier]?.agent) ?? DEFAULT_AGENT_SAMPLES;
  const requested = finiteOrNull(samples);
  const count = requested != null && requested >= 1 ? Math.floor(requested) : floor;
  const planItemIds = Array.from(
    { length: count },
    (_, i) => `${scenario?.scenarioId ?? "scenario"}#plan-${String(i + 1).padStart(3, "0")}`
  );
  return {
    scenarioId: scenario?.scenarioId ?? null,
    tier,
    floor,
    plannedCount: count,
    planItemIds
  };
}

/**
 * Resolve a scenario's `questionRef` against the P1-54 question bank.
 * A reference that cannot be resolved stays unresolved (BLOCKED upstream);
 * this module never writes a local question.
 */
export function resolveScenarioCase(scenario, questionBank) {
  const ref = scenario?.questionRef;
  if (typeof ref !== "string" || ref.trim() === "") return null;
  const cases = Array.isArray(questionBank?.cases) ? questionBank.cases : [];
  return cases.find((c) => c?.id === ref) ?? null;
}

// ---------------------------------------------------------------------------
// 20/50-lane concurrency plan (§5.3)
// ---------------------------------------------------------------------------

/**
 * This spec's OWN concurrency plan. It never touches `runAgentJourneys`
 * (P1-53) and never changes the P1-53 default denominator.
 *
 * Every identity is offered in every wave at a synchronized instant; nothing
 * is merged and nothing is dropped (D23-style "no silent load shedding",
 * applied to the burst scenario).
 */
export function buildConcurrentPlan({
  scenario = null,
  identities = [],
  startAtMs = 0,
  waveSpacingMs = 0,
  waves = null
} = {}) {
  const list = Array.isArray(identities) ? identities : [];
  const waveCount = Math.max(1, Math.floor(finiteOrNull(waves ?? scenario?.waves) ?? 1) || 1);
  const base = finiteOrNull(startAtMs) ?? 0;
  const spacing = finiteOrNull(waveSpacingMs) ?? 0;
  const planWaves = [];
  for (let waveIndex = 0; waveIndex < waveCount; waveIndex += 1) {
    const offeredAtMs = base + waveIndex * spacing;
    const jobs = list.map((identity, index) => ({
      jobId: `${scenario?.scenarioId ?? "wave"}-w${waveIndex}-${identity?.identityId ?? identity?.id ?? index}`,
      identityId: identity?.identityId ?? identity?.id ?? `identity-${index}`,
      role: identity?.role ?? identity?.roleClass ?? "unknown",
      waveIndex,
      offeredAtMs,
      scenarioId: scenario?.scenarioId ?? null
    }));
    planWaves.push({ waveIndex, offeredAtMs, jobs });
  }
  return {
    scenarioId: scenario?.scenarioId ?? null,
    concurrencyGroup: scenario?.concurrencyGroup ?? null,
    targetConcurrency: list.length,
    waves: planWaves
  };
}

/**
 * Execute a concurrent plan. The dispatch timestamp of every job of a wave is
 * taken before the first job starts, so "actual in flight" is proven by the
 * evidence and not by the send log (§5.3).
 */
export async function executeConcurrentPlan(plan, { runJob, now = defaultNow, sleep = defaultSleep } = {}) {
  const executions = [];
  for (const wave of plan?.waves ?? []) {
    const jobs = Array.isArray(wave.jobs) ? wave.jobs : [];
    const offeredAtMs = finiteOrNull(wave.offeredAtMs);
    if (offeredAtMs != null) {
      const wait = offeredAtMs - now();
      if (wait > 0) await sleep(wait);
    }
    const dispatchTimes = jobs.map(() => now());
    const settled = await Promise.all(
      jobs.map((job, index) => {
        const dispatchedAtMs = dispatchTimes[index];
        return Promise.resolve()
          .then(() => runJob(job, { waveIndex: wave.waveIndex }))
          .then((result) => ({ job, result, dispatchedAtMs, endedAtMs: now() }))
          .catch((error) => ({
            job,
            result: {
              ok: false,
              outcome: "error",
              error: error?.message ?? String(error)
            },
            dispatchedAtMs,
            endedAtMs: now()
          }));
      })
    );
    for (const entry of settled) {
      const job = entry.job ?? {};
      const jobOfferedAt = finiteOrNull(job.offeredAtMs) ?? offeredAtMs;
      executions.push({
        jobId: job.jobId ?? null,
        identityId: job.identityId ?? null,
        role: job.role ?? null,
        waveIndex: job.waveIndex ?? wave.waveIndex ?? null,
        offeredAtMs: jobOfferedAt,
        dispatchedAtMs: entry.dispatchedAtMs,
        dispatchLagMs: entry.dispatchedAtMs - (jobOfferedAt ?? 0),
        endedAtMs: entry.endedAtMs,
        result: entry.result ?? null
      });
    }
  }
  return { executions, waveCount: (plan?.waves ?? []).length, targetConcurrency: plan?.targetConcurrency ?? 0 };
}

/**
 * Actual in-flight peak, computed from the dispatch/end intervals (not from
 * the send log). A job without a terminal end stays "in flight".
 */
export function measureInFlightPeak(executions = []) {
  const list = Array.isArray(executions) ? executions : [];
  const events = [];
  for (const execution of list) {
    const start = finiteOrNull(execution?.dispatchedAtMs);
    if (start == null) continue;
    const end = finiteOrNull(execution?.endedAtMs);
    const role = execution?.role ?? "(unknown)";
    events.push({ t: start, d: 1, role });
    events.push({ t: end == null ? Number.POSITIVE_INFINITY : end, d: -1, role });
  }
  events.sort((a, b) => {
    if (a.t === b.t) return a.d - b.d; // ends before starts at the same instant
    if (a.t === Number.POSITIVE_INFINITY) return 1;
    if (b.t === Number.POSITIVE_INFINITY) return -1;
    return a.t - b.t;
  });
  let current = 0;
  let peak = 0;
  const roleCurrent = new Map();
  const rolePeak = new Map();
  for (const event of events) {
    current += event.d;
    if (current > peak) peak = current;
    const roleCount = (roleCurrent.get(event.role) ?? 0) + event.d;
    roleCurrent.set(event.role, roleCount);
    if (!rolePeak.has(event.role) || roleCount > rolePeak.get(event.role)) {
      rolePeak.set(event.role, roleCount);
    }
  }
  return { global: peak, perRole: Object.fromEntries(rolePeak) };
}

/**
 * Per-role arrival / in-flight / completion / correctness summary (§5.3).
 */
export function summarizeConcurrency(plan, executions = []) {
  const list = Array.isArray(executions) ? executions : [];
  const targetConcurrency = finiteOrNull(plan?.targetConcurrency) ?? 0;

  const offered = new Map();
  for (const wave of plan?.waves ?? []) {
    for (const job of wave?.jobs ?? []) {
      offered.set(job?.jobId ?? null, {
        jobId: job?.jobId ?? null,
        identityId: job?.identityId ?? null,
        role: job?.role ?? "unknown",
        waveIndex: job?.waveIndex ?? wave?.waveIndex ?? null,
        offeredAtMs: job?.offeredAtMs ?? wave?.offeredAtMs ?? null
      });
    }
  }
  for (const execution of list) {
    if (!execution?.jobId) continue;
    if (offered.has(execution.jobId)) continue;
    offered.set(execution.jobId, {
      jobId: execution.jobId,
      identityId: execution.identityId ?? null,
      role: execution.role ?? "unknown",
      waveIndex: execution.waveIndex ?? null,
      offeredAtMs: execution.offeredAtMs ?? null
    });
  }

  const emptyRole = (role) => ({
    role,
    offered: 0,
    dispatched: 0,
    completed: 0,
    unfinished: 0,
    correct: 0,
    incorrect: 0,
    denied: 0,
    leaked: 0,
    latencies: [],
    p50Ms: null,
    p95Ms: "not_estimable",
    maxMs: null
  });

  const perRole = new Map();
  const roleOf = (role) => role ?? "(unknown)";
  for (const job of offered.values()) {
    const key = roleOf(job.role);
    if (!perRole.has(key)) perRole.set(key, emptyRole(key));
    perRole.get(key).offered += 1;
  }

  const global = {
    offered: offered.size,
    dispatched: 0,
    completed: 0,
    unfinished: 0,
    correct: 0,
    incorrect: 0,
    denied: 0,
    leaked: 0,
    latencies: []
  };

  const unfinishedJobIds = [];
  const leakedJobIds = [];
  const deniedJobIds = [];

  for (const execution of list) {
    const key = roleOf(execution?.role);
    if (!perRole.has(key)) perRole.set(key, emptyRole(key));
    const bucket = perRole.get(key);
    bucket.dispatched += 1;
    global.dispatched += 1;

    const terminal = execution?.result != null && finiteOrNull(execution?.endedAtMs) != null;
    if (!terminal) {
      bucket.unfinished += 1;
      global.unfinished += 1;
      unfinishedJobIds.push(execution?.jobId ?? null);
      continue;
    }
    const result = execution.result;
    const ok = result.ok === true;
    if (ok) {
      bucket.completed += 1;
      global.completed += 1;
    }
    const outcome = result.outcome ?? "missing_evidence";
    if (outcome === "denied") {
      bucket.denied += 1;
      global.denied += 1;
      deniedJobIds.push(execution?.jobId ?? null);
    } else if (outcome === "correct") {
      bucket.correct += 1;
      global.correct += 1;
    } else {
      bucket.incorrect += 1;
      global.incorrect += 1;
    }
    const latency = finiteOrNull(result.latencyMs);
    if (latency != null) {
      bucket.latencies.push(latency);
      global.latencies.push(latency);
    }
    const leaked =
      (result.observedRole != null && result.observedRole !== execution?.role) ||
      (result.observedIdentityId != null && result.observedIdentityId !== execution?.identityId);
    if (leaked) {
      bucket.leaked += 1;
      global.leaked += 1;
      leakedJobIds.push(execution?.jobId ?? null);
    }
  }

  for (const bucket of perRole.values()) {
    const sorted = [...bucket.latencies].sort((a, b) => a - b);
    bucket.p50Ms = sorted.length ? nearestRank(sorted, 50) : null;
    bucket.p95Ms = sorted.length >= P95_MIN_SAMPLE_COUNT ? nearestRank(sorted, 95) : "not_estimable";
    bucket.maxMs = sorted.length ? sorted[sorted.length - 1] : null;
  }
  const sortedGlobal = [...global.latencies].sort((a, b) => a - b);
  global.p50Ms = sortedGlobal.length ? nearestRank(sortedGlobal, 50) : null;
  global.p95Ms = sortedGlobal.length >= P95_MIN_SAMPLE_COUNT ? nearestRank(sortedGlobal, 95) : "not_estimable";
  global.maxMs = sortedGlobal.length ? sortedGlobal[sortedGlobal.length - 1] : null;

  const peaks = measureInFlightPeak(list);
  global.inFlightPeak = peaks.global;
  for (const [role, bucket] of perRole.entries()) {
    bucket.inFlightPeak = peaks.perRole[role] ?? 0;
  }

  return {
    targetConcurrency,
    global,
    perRole: Object.fromEntries(perRole),
    unfinishedJobIds,
    leakedJobIds,
    deniedJobIds,
    peaks
  };
}

/**
 * §5.3 fairness verdict: slowest role p95 <= fastest role p95 × 2 + 2s,
 * plus no role starvation, no unexpected denial, no cross-role leak and a
 * proven in-flight peak (otherwise the concurrency test did not run).
 */
export function judgeRoleFairness(summary, { targetConcurrency = null } = {}) {
  const reasons = [];
  const global = summary?.global ?? {};
  const perRole = summary?.perRole ?? {};
  const target = finiteOrNull(targetConcurrency ?? summary?.targetConcurrency) ?? 0;

  if ((global.unfinished ?? 0) > 0) {
    reasons.push(`${global.unfinished} job(s) never reached a terminal outcome (missing terminal outcome)`);
  }
  if ((global.denied ?? 0) > 0) {
    reasons.push(`${global.denied} unexpected denial(s) in the concurrent run`);
  }
  if ((global.leaked ?? 0) > 0) {
    reasons.push(`${global.leaked} cross-role leak(s) detected`);
  }
  for (const bucket of Object.values(perRole)) {
    if ((bucket.offered ?? 0) > 0 && (bucket.completed ?? 0) < bucket.offered) {
      reasons.push(
        `role ${bucket.role} starved: ${bucket.completed}/${bucket.offered} job(s) completed successfully`
      );
    }
  }

  const p95s = Object.values(perRole)
    .map((bucket) => bucket.p95Ms)
    .filter((value) => typeof value === "number");
  let fairness = null;
  if (p95s.length >= 2) {
    const fastest = Math.min(...p95s);
    const slowest = Math.max(...p95s);
    const limit = fastest * FAIRNESS_LIMIT.ratio + FAIRNESS_LIMIT.absMs;
    fairness = { fastestP95Ms: fastest, slowestP95Ms: slowest, limitMs: limit, ok: slowest <= limit };
    if (slowest > limit) {
      reasons.push(
        `fairness: slowest role p95 ${slowest}ms exceeds fastest role p95 ${fastest}ms × ${FAIRNESS_LIMIT.ratio} + ${FAIRNESS_LIMIT.absMs}ms (§5.3)`
      );
    }
  }

  const peak = finiteOrNull(global.inFlightPeak) ?? 0;
  if (target > 0 && peak < target) {
    reasons.push(`target_concurrency_not_reached: actual in-flight peak ${peak} < ${target}`);
    return {
      verdict: "BLOCKED",
      reasons,
      fairness,
      inFlightPeak: peak,
      targetConcurrency: target,
      summary
    };
  }
  return {
    verdict: reasons.length ? "FAIL" : "PASS",
    reasons,
    fairness,
    inFlightPeak: peak,
    targetConcurrency: target,
    summary
  };
}

// ---------------------------------------------------------------------------
// observation on/off A/B (Plan Task 4 step 5)
// ---------------------------------------------------------------------------

/**
 * Compare the detailed-observation run against the minimal-observation run.
 *
 * When the detailed observation itself costs more than the dual threshold
 * (>20% AND >50ms p95) the verdict is FIX_HARNESS: the measurement must be
 * fixed first, the product is NOT declared regressed.
 */
export function compareObservationOverhead({
  detailedSamples = [],
  minimalSamples = [],
  limit = OBSERVATION_OVERHEAD_LIMIT
} = {}) {
  const detailed = (Array.isArray(detailedSamples) ? detailedSamples : []).map(Number).filter(Number.isFinite);
  const minimal = (Array.isArray(minimalSamples) ? minimalSamples : []).map(Number).filter(Number.isFinite);
  const base = {
    productRegression: false,
    detailedSampleCount: detailed.length,
    minimalSampleCount: minimal.length,
    detailedP95Ms: null,
    minimalP95Ms: null,
    overheadMs: null,
    overheadRatio: null,
    limit
  };
  if (detailed.length < P95_MIN_SAMPLE_COUNT || minimal.length < P95_MIN_SAMPLE_COUNT) {
    return {
      ...base,
      verdict: "BLOCKED",
      reasons: [
        `observation A/B needs >= ${P95_MIN_SAMPLE_COUNT} samples per arm (detailed ${detailed.length}, minimal ${minimal.length})`
      ],
      conclusion: "Observation A/B cannot be judged — collect more samples before comparing."
    };
  }
  const detailedP95Ms = nearestRank(detailed, 95);
  const minimalP95Ms = nearestRank(minimal, 95);
  const overheadMs = detailedP95Ms - minimalP95Ms;
  const overheadRatio = minimalP95Ms > 0 ? overheadMs / minimalP95Ms : 0;
  const overLimit = overheadMs > limit.absMs && overheadRatio > limit.ratio;
  const shared = { ...base, detailedP95Ms, minimalP95Ms, overheadMs, overheadRatio };
  if (overLimit) {
    return {
      ...shared,
      verdict: "FIX_HARNESS",
      reasons: [
        `detailed observation p95 ${detailedP95Ms}ms costs +${overheadMs}ms (+${(overheadRatio * 100).toFixed(1)}%) over the minimal run p95 ${minimalP95Ms}ms — over the ${limit.ratio * 100}% / ${limit.absMs}ms dual threshold`
      ],
      conclusion:
        "Observation overhead is over the dual threshold: fix the harness (the measurement) before judging the product — the product is NOT declared regressed."
    };
  }
  return {
    ...shared,
    verdict: "PASS",
    reasons: [],
    conclusion: `Detailed observation costs +${overheadMs}ms (+${(overheadRatio * 100).toFixed(1)}%) p95 — within the dual threshold.`
  };
}

// ---------------------------------------------------------------------------
// real host execution path (never run by the unit tests)
// ---------------------------------------------------------------------------

function defaultRunProcess({ command, args, cwd, env, timeoutMs, onLine }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true
      });
    } catch (error) {
      resolve({
        completed: false,
        reason: `spawn_error:${error?.message ?? String(error)}`,
        exitCode: -1,
        stdout: "",
        stderr: "",
        timedOut: false
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let buffer = "";
    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        try {
          if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            /* gone */
          }
        }
      },
      Math.max(1_000, timeoutMs ?? 180_000)
    );
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim() !== "") {
          try {
            onLine?.(line);
          } catch {
            /* an adapter event hook must never break the run */
          }
        }
        index = buffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({
        completed: false,
        reason: `child_error:${error?.message ?? String(error)}`,
        exitCode: -1,
        stdout,
        stderr,
        timedOut
      });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({
        completed: !timedOut,
        reason: timedOut ? "timed_out" : undefined,
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut
      });
    });
  });
}

/**
 * Default (real host) turn runner. The adapter drives the product's own CLI;
 * the harness only timestamps the host's own output. Streaming events are
 * additive: an adapter that cannot expose them simply yields no event, and
 * the first token stays "not_available".
 */
async function defaultRunTurn({
  adapterMod,
  probeInfo,
  question,
  workDir,
  mcpUrl,
  token,
  env,
  secrets = [],
  sessionId = null,
  continueSession = false,
  timeoutMs = 180_000,
  observation = "detailed",
  now = defaultNow
}) {
  const prepared = adapterMod.prepare({ workDir, mcpUrl });
  const invocation = adapterMod.buildInvocation({
    binaryPath: probeInfo.binaryPath,
    question,
    workDir,
    prepared,
    env,
    secrets,
    sessionId: continueSession ? sessionId : null,
    continueSession
  });
  const events = [];
  const result = await defaultRunProcess({
    ...invocation,
    env: { ...invocation.env, [TOKEN_ENV]: token, ...(env ?? {}) },
    timeoutMs,
    onLine: (line) => {
      if (observation !== "detailed") return;
      if (typeof adapterMod.parseStreamEvent !== "function") return;
      const parsed = adapterMod.parseStreamEvent(line);
      if (!parsed || !parsed.type) return;
      events.push({ ...parsed, atMs: now() });
    }
  });
  let lastMessage = "";
  if (prepared?.lastMessageFile) {
    try {
      lastMessage = readFileSync(prepared.lastMessageFile, "utf8");
    } catch {
      lastMessage = "";
    }
  }
  const parsed = adapterMod.parseResult({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    lastMessage
  });
  const endedAt = now();
  const answerEvents = events.filter(
    (e) => String(e.type) === "final" || CONTENT_EVENT_TYPES.has(String(e.type))
  );
  // §4.2: when the host exposes no event at all, the answer became observable
  // when the host process finished. That is the "host exposes only the final
  // answer" case — coarse, and never a token. The caller applies the same
  // fallback for adapters that do not report an answer timestamp.
  const finalAnswerAt = answerEvents.length ? answerEvents[answerEvents.length - 1].atMs : null;
  return {
    ok: Boolean(result.completed !== false && parsed.ok),
    finalAnswer: parsed.finalAnswer ?? "",
    sessionId: parsed.sessionId ?? null,
    model: parsed.model ?? probeInfo.model ?? "default",
    exitCode: result.exitCode ?? null,
    timedOut: Boolean(result.timedOut),
    events: observation === "detailed" ? events : [],
    finalAnswerAt: parsed.finalAnswer ? finalAnswerAt : null,
    providerReceipt: parsed.providerReceipt ?? null,
    processId: null
  };
}

// ---------------------------------------------------------------------------
// attempt records (§4.3 — same shape as the MCP lane)
// ---------------------------------------------------------------------------

function buildAttemptRecord({
  runId,
  scenario,
  testCase,
  attemptId,
  planItemId,
  retryOf = null,
  firstAttempt = false,
  finalAttempt = false,
  lane = "agent",
  roleClass = "unknown",
  outcome = "missing_evidence",
  correctness = "unknown",
  errorClass = null,
  timeoutMs = null,
  expectedOutcome = "allow",
  milestones = null,
  turnRecords = [],
  toolTrace = [],
  mcpCalls = [],
  stages = [],
  providerReceipt = null,
  claimedClass = null,
  audit = null,
  digests = {},
  clientFingerprint = null,
  modelFingerprint = null,
  environmentFingerprint = null,
  environment = null,
  questionStartedAtUtc = null,
  blockedReason = null,
  observation = "detailed",
  hardLimitExceeded = false,
  sameSession = false,
  hostSessionId = null,
  processId = null,
  journeyWallClockMs = null,
  finalAnswerReceived = false
}) {
  const missing = {};
  const nullableIdentity = (value, field, reason) => {
    if (value == null || value === "") {
      missing[field] = reason;
      return null;
    }
    return value;
  };
  const traceId = nullableIdentity(
    milestones?.traceId ?? null,
    "traceId",
    "host adapter did not expose a trace id for this turn"
  );
  const rpcRequestId = nullableIdentity(
    milestones?.rpcRequestId ?? null,
    "rpcRequestId",
    "host adapter did not expose an RPC request id for this turn"
  );
  const retry = nullableIdentity(retryOf, "retryOf", "first attempt of the plan item");
  const m = milestones ?? {};
  const outcomeValue = OUTCOME_VALUES.includes(outcome) ? outcome : "missing_evidence";
  const correctnessValue = CORRECTNESS_VALUES.includes(correctness) ? correctness : "unknown";
  const record = {
    kind: "mcp-inquiry-performance-attempt",
    contract: "lucy-mcp-inquiry-performance-attempt-v1",
    schemaVersion: 1,
    harnessVersion: HARNESS_VERSION,
    lane,
    runId: runId ?? null,
    scenarioId: scenario?.scenarioId ?? null,
    caseId: scenario?.questionRef ?? testCase?.id ?? null,
    attemptId: attemptId ?? null,
    planItemId: planItemId ?? attemptId ?? null,
    retryOf: retry,
    retryOfMissingReason: missing.retryOf ?? null,
    traceId,
    traceIdMissingReason: missing.traceId ?? null,
    rpcRequestId,
    rpcRequestIdMissingReason: missing.rpcRequestId ?? null,
    // input (digests / fingerprints)
    roleClass: roleClass ?? "unknown",
    roleCategory: roleClass ?? "unknown",
    budgetClass: scenario?.budgetClass ?? null,
    ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
    cacheState: scenario?.cacheState ?? null,
    concurrencyGroup: scenario?.concurrencyGroup ?? null,
    clientFingerprint: clientFingerprint ?? null,
    modelFingerprint: modelFingerprint ?? null,
    clientModel: `${clientFingerprint ?? "unknown"}::${modelFingerprint ?? "unknown"}`,
    environment: environment ?? environmentFingerprint ?? null,
    environmentFingerprint: environmentFingerprint ?? environment ?? NOT_AVAILABLE,
    questionSetDigest: digests.questionSetDigest ?? NOT_AVAILABLE,
    configDigest: digests.configDigest ?? NOT_AVAILABLE,
    fixtureDigest: digests.fixtureDigest ?? NOT_AVAILABLE,
    budgetDigest: digests.budgetDigest ?? NOT_AVAILABLE,
    contractDigest: digests.contractDigest ?? NOT_AVAILABLE,
    candidateFingerprint: digests.candidateFingerprint ?? null,
    oracleRef: scenario?.oracleRef ?? null,
    // result
    outcome: outcomeValue,
    correctness: correctnessValue,
    errorClass: errorClass ?? null,
    timeoutMs: timeoutMs ?? null,
    expectedOutcome,
    firstAttempt: Boolean(firstAttempt),
    finalAttempt: Boolean(finalAttempt),
    firstAttemptId: firstAttempt ? attemptId ?? null : null,
    finalAttemptId: finalAttempt ? attemptId ?? null : null,
    // timing (§4.2)
    questionStartedAt: m.questionStartedAt ?? NOT_AVAILABLE,
    questionStartedAtUtc: questionStartedAtUtc ?? null,
    firstObservableMs: m.firstObservableMs ?? NOT_AVAILABLE,
    firstObservableQuality: m.firstObservableQuality ?? NOT_AVAILABLE,
    firstObservableKind: m.firstObservableKind ?? null,
    firstTokenMs: m.firstTokenMs ?? FIRST_TOKEN_NOT_AVAILABLE,
    firstCorrectResultMs: m.firstCorrectResultMs ?? NOT_AVAILABLE,
    finalCorrectAnswerMs: m.finalCorrectAnswerMs ?? NOT_AVAILABLE,
    finalAnswerMs: m.finalAnswerMs ?? NOT_AVAILABLE,
    turnWallClockMs: m.turnWallClockMs ?? NOT_AVAILABLE,
    journeyWallClockMs: journeyWallClockMs ?? NOT_AVAILABLE,
    unattributedMs: m.unattributedMs ?? NOT_AVAILABLE,
    // trace
    mcpCalls: Array.isArray(mcpCalls) ? mcpCalls : [],
    stages: Array.isArray(stages) ? stages : [],
    toolTrace: Array.isArray(toolTrace) ? toolTrace : [],
    turns: Array.isArray(turnRecords) ? turnRecords : [],
    // D21
    audit: audit ?? { reconciled: false, failedCallsThisTurn: null },
    statusCode: providerReceipt?.statusCode ?? null,
    timestamp: providerReceipt?.timestamp ?? null,
    errorKind: providerReceipt?.errorKind ?? null,
    providerReceipt: providerReceipt ?? null,
    claimedClass: claimedClass ?? null,
    // misc
    observation: observation ?? "detailed",
    finalAnswerReceived: Boolean(finalAnswerReceived),
    sameSession: Boolean(sameSession),
    hostSessionId: hostSessionId ?? null,
    processId: processId ?? null,
    hardLimitExceeded: Boolean(hardLimitExceeded),
    blocked: blockedReason != null,
    blockedReason: blockedReason ?? null
  };
  record.missingReasons = missing;
  return record;
}

// ---------------------------------------------------------------------------
// the Agent lane runner
// ---------------------------------------------------------------------------

/**
 * Run the real Agent lane.
 *
 * @param {object} options
 * @param {object} options.contract parsed mcp-inquiry-performance.yaml
 * @param {object} options.questionBank parsed P1-54 question bank
 * @param {string|null} options.selectedClientId single selected compat client
 * @param {object} [options.deps] injectable detection / runTurn / now / auditLookup
 * @returns {Promise<object>}
 */
export async function runAgentPerformanceJourneys(options = {}) {
  const {
    contract = null,
    questionBank = null,
    selectedClientId = null,
    stickyFingerprints = null,
    runId = null,
    environment = "unknown",
    environmentFingerprint = null,
    workDir = null,
    token = "",
    env = process.env,
    samplesPerScenario = null,
    scenarioIds = null,
    tier = "formal",
    observation = OBSERVATION_MODES[0],
    identities = null,
    mcpUrl = "http://127.0.0.1:7879/mcp",
    clientsPath = undefined,
    clientsDoc = null,
    secrets = [],
    timeoutMs = 180_000,
    digests = {},
    deps = {}
  } = options;

  const now = deps.now ?? defaultNow;
  const utcNow = deps.utcNow ?? defaultUtcNow;
  const auditLookup = deps.auditLookup ?? null;
  const oracleChecker = deps.oracleChecker ?? createExactOracleChecker();
  const resultOracleChecker = deps.resultOracleChecker ?? createExactResultOracleChecker();
  const observationMode = OBSERVATION_MODES.includes(observation) ? observation : OBSERVATION_MODES[0];

  const base = {
    runId: runId ?? null,
    status: "PASS",
    reasons: [],
    attempts: [],
    scenarios: [],
    fairness: null,
    disclosure: { providerErrorCount: 0, retryCount: 0, rerunCount: 0 },
    clientFingerprint: null,
    modelFingerprint: null,
    selectedClientId: selectedClientId ?? null,
    observation: observationMode,
    harnessVersion: HARNESS_VERSION,
    judgeInput: { groups: [] }
  };

  if (options.executionSurface === "direct-mcp" || options.denominator === "mcp") {
    return {
      ...base,
      status: "BLOCKED",
      reasons: ["direct MCP must never count as Agent denominator (D2)"],
      reselect: true
    };
  }

  const detection =
    deps.detection ??
    (await detectCompatClients({
      ...(clientsPath !== undefined ? { clientsPath } : {}),
      clientsDoc,
      env,
      deps
    }));

  const selection = selectCompatClient(detection, selectedClientId);
  if (!selection.ok) {
    return {
      ...base,
      status: "BLOCKED",
      reasons: selection.reasons,
      readyCandidates: selection.readyCandidates ?? [],
      reselect: true
    };
  }

  const selected = selection.selected;
  const clientFingerprint = selected.clientFingerprint;
  const modelFingerprint = selected.modelFingerprint;
  base.clientFingerprint = clientFingerprint;
  base.modelFingerprint = modelFingerprint;
  base.selectedClientId = selected.id;

  const sticky = assertFingerprintsSticky({ clientFingerprint, modelFingerprint }, stickyFingerprints);
  if (!sticky.ok) {
    return {
      ...base,
      status: "BLOCKED",
      reasons: sticky.reasons,
      reselect: false
    };
  }

  const adapterMod = selected.adapter?.mod ?? deps.adapterMod;
  const probeInfo = selected.probe ?? deps.probeInfo;
  if (!adapterMod || !probeInfo) {
    return {
      ...base,
      status: "BLOCKED",
      reasons: ["selected client has no loaded adapter/probe"],
      reselect: true
    };
  }

  const runTurn =
    deps.runTurn ??
    ((args) => defaultRunTurn({ ...args, now }));

  const scenarios = (Array.isArray(contract?.scenarios) ? contract.scenarios : []).filter(
    (scenario) =>
      !Array.isArray(scenarioIds) || scenarioIds.length === 0 || scenarioIds.includes(scenario.scenarioId)
  );

  const attempts = [];
  const scenarioSummaries = [];
  const reasons = [];

  for (const scenario of scenarios) {
    const plan = planScenarioAttempts({ scenario, samples: samplesPerScenario, tier });
    const testCase = resolveScenarioCase(scenario, questionBank);
    const scenarioId = scenario?.scenarioId ?? "(unknown)";
    const roleClass = identities?.[0]?.role ?? testCase?.identities?.[0]?.role ?? "unknown";

    const blockedScenario = (blockedReason, reasonText) => {
      const stubs = plan.planItemIds.map((planItemId) =>
        buildAttemptRecord({
          runId,
          scenario,
          testCase,
          attemptId: `${runId ?? "run"}#${planItemId}#1`,
          planItemId,
          firstAttempt: true,
          finalAttempt: true,
          roleClass,
          outcome: "missing_evidence",
          correctness: "unknown",
          errorClass: blockedReason,
          milestones: {},
          digests,
          clientFingerprint,
          modelFingerprint,
          environmentFingerprint,
          environment,
          observation: observationMode,
          blockedReason,
          sameSession: scenario?.sameSession === true
        })
      );
      attempts.push(...stubs);
      return {
        scenarioId,
        lane: "agent",
        caseId: scenario?.questionRef ?? null,
        budgetClass: scenario?.budgetClass ?? null,
        ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
        cacheState: scenario?.cacheState ?? null,
        concurrencyGroup: scenario?.concurrencyGroup ?? null,
        roleClass,
        clientFingerprint,
        modelFingerprint,
        environment,
        plannedCount: plan.plannedCount,
        sampleCount: 0,
        correctCount: 0,
        failedCount: 0,
        timeoutCount: 0,
        firstTokenSamples: NOT_AVAILABLE,
        verdict: "BLOCKED",
        reasons: [reasonText]
      };
    };

    if (!testCase) {
      const reasonText = `questionRef ${JSON.stringify(scenario?.questionRef ?? null)} is not in the P1-54 question bank (BLOCKED upstream, D17)`;
      scenarioSummaries.push(blockedScenario("questionRef_unresolved", reasonText));
      reasons.push(`${scenarioId}: ${reasonText}`);
      continue;
    }

    const turns = Array.isArray(testCase.turns) ? testCase.turns : [];
    const needsMultiTurn = turns.length > 1 || scenario?.sameSession === true;
    if (needsMultiTurn && selected.candidate?.multiTurn !== true) {
      const reasonText = `multi_turn_unsupported: client ${selected.id} cannot keep one session for this scenario`;
      scenarioSummaries.push(blockedScenario("multi_turn_unsupported", reasonText));
      reasons.push(`${scenarioId}: ${reasonText}`);
      continue;
    }

    const isConcurrent = scenario?.roleFairness === true || /^c\d+$/.test(String(scenario?.concurrencyGroup ?? ""));
    if (isConcurrent) {
      const concurrent = await runConcurrentScenario({
        scenario,
        testCase,
        plan,
        identities,
        roleClass,
        runId,
        digests,
        clientFingerprint,
        modelFingerprint,
        environmentFingerprint,
        environment,
        observationMode,
        now,
        utcNow,
        runTurn,
        adapterMod,
        probeInfo,
        mcpUrl,
        token,
        env,
        secrets,
        timeoutMs,
        workDir,
        oracleChecker,
        resultOracleChecker,
        auditLookup
      });
      attempts.push(...concurrent.attempts);
      scenarioSummaries.push(concurrent.summary);
      reasons.push(...concurrent.reasons);
      if (concurrent.fairness) base.fairness = concurrent.fairness;
      continue;
    }

    const scenarioAttempts = [];
    for (let index = 0; index < plan.planItemIds.length; index += 1) {
      const planItemId = plan.planItemIds[index];
      const chain = await runPlanItemWithRetries({
        scenario,
        testCase,
        planItemId,
        planIndex: index,
        roleClass,
        runId,
        digests,
        clientFingerprint,
        modelFingerprint,
        environmentFingerprint,
        environment,
        observationMode,
        now,
        utcNow,
        runTurn,
        adapterMod,
        probeInfo,
        mcpUrl,
        token,
        env,
        secrets,
        timeoutMs,
        workDir,
        oracleChecker,
        resultOracleChecker,
        auditLookup
      });
      scenarioAttempts.push(...chain.attempts);
    }
    attempts.push(...scenarioAttempts);

    const summary = summarizeScenario({
      scenario,
      scenarioAttempts,
      plan,
      roleClass,
      clientFingerprint,
      modelFingerprint,
      environment,
      tier
    });
    scenarioSummaries.push(summary);
    reasons.push(...summary.reasons.map((reason) => `${scenarioId}: ${reason}`));
  }

  // ---- disclosure + judge input -----------------------------------------
  const disclosure = {
    providerErrorCount: attempts.filter((a) => a.claimedClass === "providerError").length,
    retryCount: attempts.filter((a) => a.retryOf != null).length,
    rerunCount: 0
  };

  const groups = scenarioSummaries.map((summary) => {
    const groupAttempts = attempts.filter((a) => a.scenarioId === summary.scenarioId);
    return {
      scenarioId: summary.scenarioId,
      lane: "agent",
      budgetClass: summary.budgetClass,
      ownerBudgetClass: summary.ownerBudgetClass,
      cacheState: summary.cacheState,
      concurrencyGroup: summary.concurrencyGroup,
      clientModel: `${summary.clientFingerprint ?? "unknown"}::${summary.modelFingerprint ?? "unknown"}`,
      environment: summary.environment,
      plannedCount: summary.plannedCount,
      attempts: groupAttempts,
      firstTokenSamples: summary.firstTokenSamples,
      baseline: null
    };
  });

  let status = "PASS";
  for (const summary of scenarioSummaries) {
    status = worstVerdict(status, summary.verdict);
  }
  if (base.fairness && base.fairness.verdict !== "PASS") {
    status = worstVerdict(status, base.fairness.verdict);
  }

  return {
    ...base,
    status,
    reasons,
    attempts,
    scenarios: scenarioSummaries,
    disclosure,
    judgeInput: { groups }
  };
}

/**
 * One plan item (one planned attempt) plus its bounded provider retries.
 * Every attempt of the chain keeps its own record and its own timing origin.
 */
async function runPlanItemWithRetries({
  scenario,
  testCase,
  planItemId,
  planIndex,
  roleClass,
  runId,
  digests,
  clientFingerprint,
  modelFingerprint,
  environmentFingerprint,
  environment,
  observationMode,
  now,
  utcNow,
  runTurn,
  adapterMod,
  probeInfo,
  mcpUrl,
  token,
  env,
  secrets,
  timeoutMs,
  workDir,
  oracleChecker,
  resultOracleChecker,
  auditLookup
}) {
  const attempts = [];
  let retryOf = null;
  let attemptSeq = 0;
  for (;;) {
    attemptSeq += 1;
    const attemptId = `${runId ?? "run"}#${planItemId}#${attemptSeq}`;
    const record = await runOneAttempt({
      scenario,
      testCase,
      attemptId,
      planItemId,
      planIndex,
      attemptSeq,
      retryOf,
      roleClass,
      runId,
      digests,
      clientFingerprint,
      modelFingerprint,
      environmentFingerprint,
      environment,
      observationMode,
      now,
      utcNow,
      runTurn,
      adapterMod,
      probeInfo,
      mcpUrl,
      token,
      env,
      secrets,
      timeoutMs,
      workDir,
      oracleChecker,
      resultOracleChecker,
      auditLookup
    });
    attempts.push(record);
    const willRetry = record.claimedClass === "providerError" && attemptSeq <= PROVIDER_MAX_RETRIES;
    if (!willRetry) break;
    retryOf = record.attemptId;
  }
  attempts.forEach((attempt, index) => {
    attempt.firstAttempt = index === 0;
    attempt.finalAttempt = index === attempts.length - 1;
    // every attempt of the chain points at the chain's first / last attempt
    attempt.firstAttemptId = attempts[0].attemptId ?? null;
    attempt.finalAttemptId = attempts[attempts.length - 1].attemptId ?? null;
  });
  return { attempts, planItemId };
}

/** One attempt: the turns of the case inside one host session. */
async function runOneAttempt({
  scenario,
  testCase,
  attemptId,
  planItemId,
  planIndex,
  attemptSeq,
  retryOf,
  roleClass,
  runId,
  digests,
  clientFingerprint,
  modelFingerprint,
  environmentFingerprint,
  environment,
  observationMode,
  now,
  utcNow,
  runTurn,
  adapterMod,
  probeInfo,
  mcpUrl,
  token,
  env,
  secrets,
  timeoutMs,
  workDir,
  oracleChecker,
  resultOracleChecker,
  auditLookup
}) {
  const turns = Array.isArray(testCase?.turns) ? testCase.turns : [];
  const sameSession = scenario?.sameSession === true || testCase?.agentRequirements?.sameSession === true;
  const attemptWorkDir = path.join(
    workDir ?? path.join(process.cwd(), "inbox", "e2e", "mcp-agent-perf"),
    String(scenario?.scenarioId ?? "scenario"),
    String(planItemId),
    `attempt-${attemptSeq}`
  );
  try {
    mkdirSync(attemptWorkDir, { recursive: true });
  } catch {
    /* the work dir is optional for the measurement itself */
  }

  const turnRecords = [];
  const toolTrace = [];
  const mcpCalls = [];
  const stages = [];
  let sessionId = null;
  let hostSessionId = null;
  let modelSwitchTo = null;
  let sessionBroken = false;
  let blockedReason = null;
  let providerReceipt = null;
  let audit = { reconciled: false, failedCallsThisTurn: null };
  let firstTurnStart = null;
  let lastTurnEnd = null;
  let firstCorrectResultMs = NOT_AVAILABLE;
  let firstTurnMilestones = null;
  let lastTurnMilestones = null;
  let totalWallClock = 0;

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const question = String(turns[turnIndex]?.text ?? "");
    const continueSession = sameSession && turnIndex > 0 && Boolean(sessionId);
    const startedAt = now();
    const startedAtUtc = utcNow();
    if (firstTurnStart == null) firstTurnStart = startedAt;

    let turnResult;
    try {
      turnResult = await runTurn({
        adapterMod,
        probeInfo,
        question,
        workDir: attemptWorkDir,
        mcpUrl,
        token,
        env,
        secrets,
        sessionId,
        continueSession,
        timeoutMs,
        caseId: testCase?.id ?? null,
        attempt: planIndex + 1,
        attemptId,
        turnIndex,
        observation: observationMode
      });
    } catch (error) {
      turnResult = {
        ok: false,
        finalAnswer: "",
        sessionId,
        model: probeInfo?.model ?? "default",
        error: error?.message ?? String(error),
        events: [],
        finalAnswerAt: null
      };
    }
    const endedAt = now();
    lastTurnEnd = endedAt;

    const answerText = String(turnResult.finalAnswer ?? "");
    // A host that does not report an answer timestamp still completed its
    // answer when the turn ended ⇒ coarse first observable, never a token.
    const answerAt =
      finiteOrNull(turnResult.finalAnswerAt) ?? (answerText.trim() !== "" ? endedAt : null);

    const observedModelFp = buildModelFingerprint({ model: turnResult.model ?? probeInfo?.model });
    if (turnResult.model && observedModelFp !== modelFingerprint) {
      modelSwitchTo = { from: modelFingerprint, to: observedModelFp };
      blockedReason = "model_fingerprint_switched";
    }

    if (turnResult.sessionId) {
      sessionId = turnResult.sessionId;
      if (turnIndex === 0) hostSessionId = turnResult.sessionId;
    }
    if (sameSession && turnIndex > 0 && hostSessionId && sessionId !== hostSessionId) {
      sessionBroken = true;
    }

    const events = observationMode === "detailed" && Array.isArray(turnResult.events) ? turnResult.events : [];
    const milestones = computeTurnMilestones({
      questionStartedAt: startedAt,
      events,
      finalAnswerAt: answerAt,
      turnEndedAt: endedAt
    });
    if (!firstTurnMilestones) firstTurnMilestones = milestones;
    lastTurnMilestones = milestones;

    const turnToolEvents = events.filter((e) => TOOL_EVENT_TYPES.has(String(e.type)));
    for (const event of turnToolEvents) {
      toolTrace.push({ turnIndex, type: String(event.type), name: event.name ?? null, atMs: event.atMs, rpcRequestId: event.rpcRequestId ?? null });
      mcpCalls.push({
        turnIndex,
        name: event.name ?? null,
        kind: String(event.type),
        rpcRequestId: event.rpcRequestId ?? null,
        rpcRequestIdMissingReason: event.rpcRequestId ? null : "host adapter did not expose an RPC request id",
        atMs: event.atMs,
        rttMs: finiteOrNull(event.rttMs)
      });
      stages.push({
        name: event.name ?? "tool",
        kind: String(event.type) === "tool" ? "tool_call" : "tool_result",
        startMs: event.atMs,
        endMs: event.atMs,
        rpcRequestId: event.rpcRequestId ?? null
      });
    }

    const toolResults = events
      .filter((e) => String(e.type) === "tool_result")
      .map((e) => e.result ?? e.payload ?? e.data ?? null);
    const oracle = oracleChecker({
      testCase,
      turnIndex,
      finalAnswer: turnResult.finalAnswer ?? "",
      toolResults
    });
    const oracleVerdict = oracle?.verdict ?? "unknown";

    if (firstCorrectResultMs === NOT_AVAILABLE) {
      for (const event of events.filter((e) => String(e.type) === "tool_result")) {
        const payload = event.result ?? event.payload ?? event.data ?? null;
        const matched = resultOracleChecker({ testCase, toolResult: payload });
        if (matched === true) {
          firstCorrectResultMs = event.atMs - startedAt;
          break;
        }
      }
    }

    const finalAnswer = answerText;
    const turnRecord = {
      turnIndex,
      text: question,
      questionStartedAt: startedAt,
      questionStartedAtUtc: startedAtUtc,
      turnEndedAt: endedAt,
      turnWallClockMs: milestones.turnWallClockMs,
      firstObservableMs: milestones.firstObservableMs,
      firstObservableQuality: milestones.firstObservableQuality,
      firstTokenMs: milestones.firstTokenMs,
      finalAnswerMs: milestones.finalAnswerMs,
      sessionId: turnResult.sessionId ?? sessionId,
      model: turnResult.model ?? null,
      ok: Boolean(turnResult.ok),
      timedOut: Boolean(turnResult.timedOut),
      exitCode: turnResult.exitCode ?? null,
      oracleVerdict,
      oracleReason: oracle?.reason ?? null,
      finalAnswer
    };
    turnRecords.push(turnRecord);
    totalWallClock += finiteOrNull(milestones.turnWallClockMs) ?? 0;

    if (!providerReceipt && turnResult.providerReceipt) {
      providerReceipt = {
        statusCode: finiteOrNull(turnResult.providerReceipt.statusCode),
        timestamp: turnResult.providerReceipt.timestamp ?? null,
        errorKind: turnResult.providerReceipt.errorKind ?? null,
        raw: turnResult.providerReceipt.raw ?? null,
        source: "host_adapter_receipt"
      };
    }
  }

  // ---- D21: audit reconciliation + provider receipt claim ----------------
  if (auditLookup) {
    try {
      const auditResult = await auditLookup({
        runId,
        scenarioId: scenario?.scenarioId ?? null,
        caseId: testCase?.id ?? null,
        attemptId,
        planItemId,
        turnCount: turnRecords.length
      });
      if (isPlainObject(auditResult)) {
        audit = {
          reconciled: auditResult.reconciled === true,
          failedCallsThisTurn: finiteOrNull(auditResult.failedCallsThisTurn),
          traceId: auditResult.traceId ?? null
        };
      }
    } catch {
      audit = { reconciled: false, failedCallsThisTurn: null, traceId: null };
    }
  }

  const transient =
    providerReceipt != null &&
    (providerReceipt.statusCode === 429 ||
      (providerReceipt.statusCode != null &&
        providerReceipt.statusCode >= 500 &&
        providerReceipt.statusCode <= 599) ||
      TRANSIENT_ERROR_KINDS.includes(providerReceipt.errorKind));
  const receiptComplete =
    providerReceipt != null &&
    providerReceipt.timestamp != null &&
    providerReceipt.timestamp !== "" &&
    (providerReceipt.statusCode != null || TRANSIENT_ERROR_KINDS.includes(providerReceipt.errorKind));
  // The claim is deliberately optimistic: the shared judge re-checks it
  // against the Lucy audit and rejects a relabel of a Lucy-side error (D21④).
  const claimedClass =
    transient && receiptComplete && audit.reconciled === true ? "providerError" : null;

  // ---- outcome / correctness --------------------------------------------
  const hasFinalAnswer = turnRecords.some((t) => String(t.finalAnswer ?? "").trim() !== "");
  const timedOut = turnRecords.some((t) => t.timedOut === true);
  const anyWrong = turnRecords.some((t) => t.oracleVerdict === "wrong");
  const anyUnknown = turnRecords.some((t) => t.oracleVerdict === "unknown");
  const anyMissingAnswer = turnRecords.some((t) => String(t.finalAnswer ?? "").trim() === "");

  let outcome = "correct";
  let correctness = "correct";
  let errorClass = null;
  let attemptTimeoutMs = null;

  if (modelSwitchTo) {
    outcome = "missing_evidence";
    correctness = "unknown";
    errorClass = "model_fingerprint_switched";
  } else if (sessionBroken) {
    outcome = "error";
    correctness = "incorrect";
    errorClass = "session_broken";
  } else if (timedOut) {
    outcome = "timeout";
    correctness = "incorrect";
    errorClass = "host_timeout";
    attemptTimeoutMs = Math.max(...turnRecords.map((t) => finiteOrNull(t.turnWallClockMs) ?? 0));
  } else if (!hasFinalAnswer) {
    // D3: a tool result without a final answer is not a finished answer.
    outcome = "error";
    correctness = "incorrect";
    errorClass = "no_final_answer";
  } else if (anyWrong) {
    outcome = "wrong_answer";
    correctness = "incorrect";
    errorClass = "wrong_answer";
  } else if (anyUnknown) {
    outcome = "missing_evidence";
    correctness = "unknown";
    errorClass = "oracle_unverified";
  }

  const hardLimitExceeded = turnRecords.some(
    (t) => (finiteOrNull(t.turnWallClockMs) ?? 0) > 120_000
  );

  const firstTurn = turnRecords[0] ?? null;
  const lastTurn = turnRecords[turnRecords.length - 1] ?? null;
  const finalAnswerMs = lastTurn?.finalAnswerMs ?? NOT_AVAILABLE;
  const finalCorrectAnswerMs =
    outcome === "correct" && finiteOrNull(finalAnswerMs) != null ? finalAnswerMs : NOT_AVAILABLE;

  const milestones = {
    questionStartedAt: firstTurnStart ?? NOT_AVAILABLE,
    firstObservableMs: firstTurnMilestones?.firstObservableMs ?? NOT_AVAILABLE,
    firstObservableQuality: firstTurnMilestones?.firstObservableQuality ?? NOT_AVAILABLE,
    firstObservableKind: firstTurnMilestones?.firstObservableKind ?? null,
    firstTokenMs: firstTurnMilestones?.firstTokenMs ?? FIRST_TOKEN_NOT_AVAILABLE,
    firstCorrectResultMs,
    finalAnswerMs,
    finalCorrectAnswerMs,
    turnWallClockMs: Math.max(
      0,
      ...turnRecords.map((t) => finiteOrNull(t.turnWallClockMs) ?? 0)
    ),
    unattributedMs: lastTurnMilestones?.unattributedMs ?? NOT_AVAILABLE,
    traceId: audit?.traceId ?? null,
    rpcRequestId: mcpCalls.find((c) => c.rpcRequestId)?.rpcRequestId ?? null
  };

  return buildAttemptRecord({
    runId,
    scenario,
    testCase,
    attemptId,
    planItemId,
    retryOf,
    lane: "agent",
    roleClass,
    outcome,
    correctness,
    errorClass,
    timeoutMs: attemptTimeoutMs,
    expectedOutcome: scenario?.expectedOutcome ?? "allow",
    milestones,
    turnRecords,
    toolTrace,
    mcpCalls,
    stages,
    providerReceipt,
    claimedClass,
    audit,
    digests,
    clientFingerprint,
    modelFingerprint,
    environmentFingerprint,
    environment,
    questionStartedAtUtc: turnRecords[0]?.questionStartedAtUtc ?? null,
    blockedReason,
    observation: observationMode,
    hardLimitExceeded,
    sameSession,
    hostSessionId,
    journeyWallClockMs: totalWallClock,
    finalAnswerReceived: hasFinalAnswer
  });
}

/** Per-scenario summary: counts, percentiles, first-token samples, verdict. */
function summarizeScenario({
  scenario,
  scenarioAttempts,
  plan,
  roleClass,
  clientFingerprint,
  modelFingerprint,
  environment,
  tier = "formal"
}) {
  const scenarioId = scenario?.scenarioId ?? "(unknown)";
  const latencies = scenarioAttempts
    .map((a) => finiteOrNull(a.finalCorrectAnswerMs))
    .filter((v) => v != null);
  const firstTokenSamples = scenarioAttempts
    .map((a) => finiteOrNull(a.firstTokenMs))
    .filter((v) => v != null);

  const classified = classifyProviderErrors(scenarioAttempts);
  const providerScenario = classified.scenarios[scenarioId] ?? null;

  const correctness = checkAttemptOutcomes(scenarioAttempts, {
    lane: "agent",
    expectedOutcome: scenario?.expectedOutcome ?? "allow",
    classified: new Map(classified.attempts.map((a) => [a.attemptId, a.classification]))
  });

  const absolute = judgeAbsolute({
    lane: "agent",
    tier,
    budgetClass: scenario?.budgetClass ?? null,
    ownerBudgetClass: scenario?.ownerBudgetClass,
    cacheState: scenario?.cacheState ?? "warm",
    latencies,
    turns: scenarioAttempts,
    firstTokenSamples: firstTokenSamples.length ? firstTokenSamples : NOT_AVAILABLE
  });

  let verdict = "PASS";
  const reasons = [];
  if (providerScenario && providerScenario.verdict === "FAIL") {
    verdict = "FAIL";
    reasons.push(...providerScenario.reasons);
  } else if (providerScenario && providerScenario.verdict === "BLOCKED") {
    verdict = "BLOCKED";
    reasons.push(...providerScenario.reasons);
  }
  if (correctness.verdict === "FAIL") {
    verdict = "FAIL";
    reasons.push(...correctness.failReasons);
  } else if (correctness.verdict === "BLOCKED") {
    if (verdict === "PASS") verdict = "BLOCKED";
    reasons.push(...correctness.blockedReasons);
  }
  if (absolute.verdict === "FAIL") {
    verdict = "FAIL";
    reasons.push(...absolute.reasons);
  } else if (absolute.verdict === "BLOCKED") {
    if (verdict === "PASS") verdict = "BLOCKED";
    reasons.push(...absolute.reasons);
  }
  for (const attempt of scenarioAttempts) {
    if (!attempt.blockedReason) continue;
    if (attempt.blockedReason === "model_fingerprint_switched") {
      reasons.push(`${attempt.attemptId}: modelFingerprint switched mid-run — BLOCKED (D9)`);
      if (verdict === "PASS") verdict = "BLOCKED";
      continue;
    }
    reasons.push(`${attempt.attemptId}: ${attempt.blockedReason}`);
  }

  return {
    scenarioId,
    lane: "agent",
    caseId: scenario?.questionRef ?? null,
    budgetClass: scenario?.budgetClass ?? null,
    ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
    cacheState: scenario?.cacheState ?? null,
    concurrencyGroup: scenario?.concurrencyGroup ?? null,
    roleClass,
    clientFingerprint,
    modelFingerprint,
    environment,
    plannedCount: plan.plannedCount,
    sampleCount: latencies.length,
    correctCount: scenarioAttempts.filter((a) => a.outcome === "correct").length,
    failedCount: scenarioAttempts.filter((a) => a.outcome !== "correct" && a.outcome !== "missing_evidence").length,
    timeoutCount: scenarioAttempts.filter((a) => a.outcome === "timeout").length,
    missingEvidenceCount: scenarioAttempts.filter((a) => a.outcome === "missing_evidence").length,
    providerErrorCount: providerScenario?.providerErrorCount ?? 0,
    retryCount: providerScenario?.retryCount ?? 0,
    firstTokenSamples: firstTokenSamples.length ? firstTokenSamples : NOT_AVAILABLE,
    p50Ms: latencies.length ? nearestRank(latencies, 50) : null,
    p95Ms: latencies.length >= P95_MIN_SAMPLE_COUNT ? nearestRank(latencies, 95) : "not_estimable",
    medianMs: latencies.length ? median(latencies) : null,
    maxMs: latencies.length ? Math.max(...latencies) : null,
    absoluteVerdict: absolute.verdict,
    correctnessVerdict: correctness.verdict,
    verdict,
    reasons
  };
}

/**
 * The 20/50-lane concurrent scenario: every identity is offered in every wave,
 * the actual in-flight peak is proven from the receipts, and the §5.3
 * fairness line is judged per role group.
 */
async function runConcurrentScenario({
  scenario,
  testCase,
  plan,
  identities,
  roleClass,
  runId,
  digests,
  clientFingerprint,
  modelFingerprint,
  environmentFingerprint,
  environment,
  observationMode,
  now,
  utcNow,
  runTurn,
  adapterMod,
  probeInfo,
  mcpUrl,
  token,
  env,
  secrets,
  timeoutMs,
  workDir,
  oracleChecker,
  resultOracleChecker,
  auditLookup
}) {
  const scenarioId = scenario?.scenarioId ?? "(unknown)";
  const identityList = Array.isArray(identities) && identities.length
    ? identities
    : Array.isArray(testCase?.identities)
      ? testCase.identities.map((i) => ({ identityId: i.id, role: i.role }))
      : [];

  if (identityList.length === 0) {
    const reasonText =
      "no identities for the concurrent scenario — the 50-lane identity set is owned by scale-baseline §1.1 (BLOCKED, D17/D19)";
    const summary = {
      scenarioId,
      lane: "agent",
      caseId: scenario?.questionRef ?? null,
      budgetClass: scenario?.budgetClass ?? null,
      ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
      cacheState: scenario?.cacheState ?? null,
      concurrencyGroup: scenario?.concurrencyGroup ?? null,
      roleClass,
      clientFingerprint,
      modelFingerprint,
      environment,
      plannedCount: plan.plannedCount,
      sampleCount: 0,
      correctCount: 0,
      failedCount: 0,
      timeoutCount: 0,
      firstTokenSamples: NOT_AVAILABLE,
      verdict: "BLOCKED",
      reasons: [reasonText]
    };
    return { attempts: [], summary, reasons: [`${scenarioId}: ${reasonText}`], fairness: null };
  }

  const plan20 = buildConcurrentPlan({
    scenario,
    identities: identityList,
    startAtMs: now(),
    waveSpacingMs: 0
  });

  const question = String(testCase?.turns?.[0]?.text ?? "");
  const runJob = async (job) => {
    const startedAt = now();
    const startedAtUtc = utcNow();
    let turnResult;
    try {
      turnResult = await runTurn({
        adapterMod,
        probeInfo,
        question,
        workDir: path.join(workDir ?? process.cwd(), String(scenarioId), String(job.jobId)),
        mcpUrl,
        token,
        env,
        secrets,
        sessionId: null,
        continueSession: false,
        timeoutMs,
        caseId: testCase?.id ?? null,
        attempt: 1,
        attemptId: job.jobId,
        turnIndex: 0,
        observation: observationMode
      });
    } catch (error) {
      turnResult = { ok: false, finalAnswer: "", model: probeInfo?.model ?? "default", error: error?.message ?? String(error), events: [] };
    }
    const endedAt = now();
    const events = observationMode === "detailed" && Array.isArray(turnResult.events) ? turnResult.events : [];
    const answerText = String(turnResult.finalAnswer ?? "");
    const answerAt =
      finiteOrNull(turnResult.finalAnswerAt) ?? (answerText.trim() !== "" ? endedAt : null);
    const milestones = computeTurnMilestones({
      questionStartedAt: startedAt,
      events,
      finalAnswerAt: answerAt,
      turnEndedAt: endedAt
    });
    const oracle = oracleChecker({
      testCase,
      turnIndex: 0,
      finalAnswer: turnResult.finalAnswer ?? "",
      toolResults: events.filter((e) => String(e.type) === "tool_result").map((e) => e.result ?? null)
    });
    const verdict = oracle?.verdict ?? "unknown";
    const outcome = verdict === "correct" ? "correct" : verdict === "wrong" ? "wrong_answer" : "missing_evidence";
    return {
      ok: Boolean(turnResult.ok) && outcome === "correct",
      outcome,
      latencyMs: milestones.turnWallClockMs,
      observedRole: turnResult.role ?? job.role,
      observedIdentityId: turnResult.identityId ?? job.identityId,
      startedAtUtc,
      milestones
    };
  };

  const { executions } = await executeConcurrentPlan(plan20, { runJob, now });
  const summary = summarizeConcurrency(plan20, executions);
  const fairness = judgeRoleFairness(summary, { targetConcurrency: plan20.targetConcurrency });

  const attempts = executions.map((execution, index) => {
    const result = execution.result ?? {};
    const latencyMs = finiteOrNull(result.latencyMs);
    const milestones = result.milestones ?? {};
    const outcome = result.outcome ?? "missing_evidence";
    const correctness = outcome === "correct" ? "correct" : outcome === "wrong_answer" ? "incorrect" : "unknown";
    return buildAttemptRecord({
      runId,
      scenario,
      testCase,
      attemptId: `${runId ?? "run"}#${execution.jobId ?? index}#1`,
      planItemId: execution.jobId ?? `job-${index}`,
      lane: "agent",
      roleClass: execution.role ?? "unknown",
      outcome,
      correctness,
      errorClass: outcome === "correct" ? null : outcome,
      milestones: {
        questionStartedAt: milestones.questionStartedAt ?? NOT_AVAILABLE,
        firstObservableMs: milestones.firstObservableMs ?? NOT_AVAILABLE,
        firstObservableQuality: milestones.firstObservableQuality ?? NOT_AVAILABLE,
        firstObservableKind: milestones.firstObservableKind ?? null,
        firstTokenMs: milestones.firstTokenMs ?? FIRST_TOKEN_NOT_AVAILABLE,
        firstCorrectResultMs: NOT_AVAILABLE,
        finalAnswerMs: milestones.finalAnswerMs ?? NOT_AVAILABLE,
        finalCorrectAnswerMs: outcome === "correct" && latencyMs != null ? latencyMs : NOT_AVAILABLE,
        turnWallClockMs: latencyMs ?? NOT_AVAILABLE,
        unattributedMs: milestones.unattributedMs ?? NOT_AVAILABLE
      },
      digests,
      clientFingerprint,
      modelFingerprint,
      environmentFingerprint,
      environment,
      questionStartedAtUtc: result.startedAtUtc ?? null,
      observation: observationMode,
      finalAnswerReceived: outcome === "correct"
    });
  });

  const scenarioSummary = {
    scenarioId,
    lane: "agent",
    caseId: scenario?.questionRef ?? null,
    budgetClass: scenario?.budgetClass ?? null,
    ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
    cacheState: scenario?.cacheState ?? null,
    concurrencyGroup: scenario?.concurrencyGroup ?? null,
    roleClass,
    clientFingerprint,
    modelFingerprint,
    environment,
    plannedCount: plan20.targetConcurrency * plan20.waves.length,
    sampleCount: attempts.filter((a) => a.outcome === "correct").length,
    correctCount: attempts.filter((a) => a.outcome === "correct").length,
    failedCount: attempts.filter((a) => a.outcome !== "correct").length,
    timeoutCount: attempts.filter((a) => a.outcome === "timeout").length,
    firstTokenSamples: NOT_AVAILABLE,
    fairness: {
      verdict: fairness.verdict,
      reasons: fairness.reasons,
      inFlightPeak: fairness.inFlightPeak,
      targetConcurrency: fairness.targetConcurrency
    },
    verdict: fairness.verdict,
    reasons: fairness.reasons
  };

  return {
    attempts,
    summary: scenarioSummary,
    reasons: fairness.reasons.map((reason) => `${scenarioId}: ${reason}`),
    fairness
  };
}
