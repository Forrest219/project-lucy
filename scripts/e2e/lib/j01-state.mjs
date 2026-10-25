// Run-scoped journey / stage state for the single user mainline J25-01
// (approved Spec §4.3), plus the three anti-cheat assertions of §4.1-4.
//
// Pure module: no I/O, no network, no clock. The runner (management / agent)
// writes the state file; this module owns the RULES:
//
//   * the state shape and the eight canonical stages (stage ids / titles /
//     owners come from lib/mainline-scenarios.mjs — one source of truth);
//   * a stage may only consume state produced by an EARLIER stage of the SAME
//     run; cross-run state is rejected (Spec §4.1-1);
//   * the next stage may not replace the connection / Role / Agent / Token a
//     previous stage produced (Plan W1-2);
//   * Token plaintext, database passwords and model credentials are never
//     written to the state — only controlled references (Spec §4.3);
//   * 失败即停: a failed stage fails the journey and turns every dependent
//     later stage into `not_run` that references the FIRST failure; the
//     journey is NOT split into eight executionIds (Spec §4.1-5).
//
// The three anti-cheat assertions are deliberately three DIFFERENT checks with
// three DIFFERENT evidence requirements. None of them can substitute for
// another: 防泄露 looks at model-visible inputs, 防代答 looks at the client
// transcript vs. the server trace, 防换题 compares the executed prompt with
// gold.question byte for byte.

import {
  JOURNEY_CATALOG_EVIDENCE,
  JOURNEY_ID,
  J01_STAGE_CONTRACT,
  J01_STAGE_IDS
} from "./mainline-scenarios.mjs";

export { JOURNEY_ID, JOURNEY_CATALOG_EVIDENCE };
export const STAGE_IDS = J01_STAGE_IDS;

/** Stage-level statuses. `not_run` also means "never scheduled because an
 *  earlier stage failed" (Spec §8.2). */
export const STAGE_STATUSES = Object.freeze(["not_run", "running", "passed", "failed", "blocked"]);
export const JOURNEY_STATUSES = Object.freeze(["not_run", "running", "passed", "failed", "blocked"]);

/** The state fields a stage is allowed to hand over. Anything else (a
 *  password, a Token plaintext, a model credential) is rejected on write. */
export const HANDOVER_FIELDS = Object.freeze([
  "connectionId",
  "sourceKeys",
  "semanticVersion",
  "policyVersion",
  "roleId",
  "agentId",
  "tokenSecretRef",
  "questionId",
  "clientSessionRef"
]);

/** Which stage owns (produces) each handover field. A stage that does not own
 *  a field may not write it — this is how "下一阶段不能替换 connection／Agent／
 *  Token" is enforced mechanically. */
export const FIELD_PRODUCERS = Object.freeze({
  connectionId: "J01-02",
  sourceKeys: "J01-03",
  semanticVersion: "J01-05",
  policyVersion: "J01-05",
  roleId: "J01-06",
  agentId: "J01-06",
  tokenSecretRef: "J01-06",
  questionId: "J01-07",
  clientSessionRef: "J01-07"
});

/** A controlled secret REFERENCE (never the secret itself). */
export const SECRET_REF_PATTERN = /^(secret|secretref|vault|keyring|file):\/\/\S+$/;

/** Field names that must never appear in the state. `tokenSecretRef` is the
 *  one allowed exception — it holds a reference, not a Token. */
export const FORBIDDEN_STATE_FIELDS = Object.freeze([
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "token",
  "tokenPlaintext",
  "plaintextToken",
  "tokenText",
  "credential",
  "credentials",
  "apiKey",
  "api_key",
  "modelCredential",
  "modelKey",
  "accessToken",
  "dsn",
  "connectionString"
]);

/** Credential shapes that cannot be confused with a digest or a path. */
export const CREDENTIAL_VALUE_PATTERNS = Object.freeze([
  { id: "model-credential", re: /\bsk-[A-Za-z0-9_-]{16,}\b/ },
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "dsn-with-password", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/i }
]);

function cloneStages(stages) {
  return stages.map((s) => ({ ...s, evidenceRefs: [...s.evidenceRefs] }));
}

/** The index of a stage in the canonical order, or -1. */
export function stageIndex(stageId) {
  return J01_STAGE_IDS.indexOf(stageId);
}

/** The canonical stage descriptor, or `null`. */
export function stageContract(stageId) {
  return J01_STAGE_CONTRACT.find((s) => s.stageId === stageId) ?? null;
}

/**
 * The run-scoped journey state (Spec §4.3).
 * @typedef {Object} J01State
 * @property {string} journeyId
 * @property {string[]} catalogEvidenceIds
 * @property {string} runId
 * @property {string} instanceId
 * @property {string} candidateDigest
 * @property {string} status
 * @property {string|null} failureRef
 * @property {Array<{stageId: string, title: string, owner: string, status: string, evidenceRefs: string[], failureRef: string|null}>} stages
 * @property {string|null} connectionId
 * @property {string[]} sourceKeys
 * @property {string|null} semanticVersion
 * @property {string|null} policyVersion
 * @property {string|null} roleId
 * @property {string|null} agentId
 * @property {string|null} tokenSecretRef
 * @property {string|null} questionId
 * @property {string|null} clientSessionRef
 * @property {Record<string, string>} producedBy
 * @property {string[]} evidenceRefs
 */

/**
 * The identity of the run that owns the journey.
 * @typedef {Object} J01Identity
 * @property {string} runId
 * @property {string} instanceId
 * @property {string} candidateDigest
 */

/**
 * A model-visible surface that is scanned for gold.
 * @typedef {Object} J01Surface
 * @property {string} surface
 * @property {string} text
 * @property {boolean} [isFinalAnswer]
 */

/**
 * Creates the initial run-scoped state. The run identity is mandatory: a
 * journey without runId / instanceId / candidateDigest cannot bind evidence.
 * @param {J01Identity} identity
 * @returns {J01State}
 */
export function createJourneyState({ runId, instanceId, candidateDigest } = {}) {
  const problems = [];
  for (const [key, value] of Object.entries({ runId, instanceId, candidateDigest })) {
    if (typeof value !== "string" || value.length === 0) problems.push(`${key} missing`);
  }
  if (problems.length > 0) throw new Error(`cannot create J25-01 state: ${problems.join("; ")}`);
  return {
    journeyId: JOURNEY_ID,
    catalogEvidenceIds: [...JOURNEY_CATALOG_EVIDENCE],
    runId,
    instanceId,
    candidateDigest,
    status: "not_run",
    failureRef: null,
    stages: J01_STAGE_CONTRACT.map((s) => ({
      stageId: s.stageId,
      title: s.title,
      owner: s.owner,
      status: "not_run",
      evidenceRefs: [],
      failureRef: null
    })),
    connectionId: null,
    sourceKeys: [],
    semanticVersion: null,
    policyVersion: null,
    roleId: null,
    agentId: null,
    tokenSecretRef: null,
    questionId: null,
    clientSessionRef: null,
    producedBy: {},
    evidenceRefs: []
  };
}

/** The state of one stage, or `null`. */
/**
 * @param {J01State} state
 * @param {string} stageId
 * @returns {J01State["stages"][number]|null}
 */
export function stageOf(state, stageId) {
  return state?.stages?.find((s) => s.stageId === stageId) ?? null;
}

/** The journey status derived from the stages. A single failed stage fails the
 *  journey; a single blocked stage blocks it; otherwise every stage must have
 *  passed for the journey to be `passed`. */
/**
 * @param {J01State} state
 * @returns {string}
 */
export function journeyStatus(state) {
  const stages = state?.stages ?? [];
  if (stages.length === 0) return "not_run";
  if (stages.some((s) => s.status === "failed")) return "failed";
  if (stages.some((s) => s.status === "blocked")) return "blocked";
  if (stages.every((s) => s.status === "passed")) return "passed";
  if (stages.some((s) => s.status === "running")) return "running";
  return "not_run";
}

/**
 * Cross-run guard: the state may only be consumed by the run that produced it.
 * Throws when runId / instanceId / candidateDigest disagree.
 */
/**
 * @param {J01State} state
 * @param {Partial<J01Identity>} [identity]
 * @returns {boolean}
 */
export function assertSameRun(state, identity = {}) {
  const mismatches = [];
  for (const key of ["runId", "instanceId", "candidateDigest"]) {
    if (identity[key] === undefined || identity[key] === null) continue;
    if (state?.[key] !== identity[key]) mismatches.push(`${key} state=${state?.[key]} != run=${identity[key]}`);
  }
  if (mismatches.length > 0) {
    throw new Error(`cross-run state rejected: ${mismatches.join("; ")}`);
  }
  return true;
}

/** Starts a stage. The stage may only consume state produced by an EARLIER
 *  stage of the SAME run. */
/**
 * @param {J01State} state
 * @param {string} stageId
 * @param {Partial<J01Identity>} [identity]
 * @returns {J01State}
 */
export function startStage(state, stageId, identity = {}) {
  assertSameRun(state, identity);
  const idx = stageIndex(stageId);
  if (idx < 0) throw new Error(`unknown stage ${stageId}`);
  const stages = cloneStages(state.stages);
  const target = stages[idx];
  if (target.status !== "not_run") throw new Error(`stage ${stageId} was already ${target.status}`);
  const unmet = stages
    .slice(0, idx)
    .filter((s) => s.status !== "passed")
    .map((s) => `${s.stageId}(${s.status})`);
  if (unmet.length > 0) {
    throw new Error(
      `stage ${stageId} may only consume state produced by an earlier stage in the same run; unmet: ${unmet.join(", ")}`
    );
  }
  stages[idx] = { ...target, status: "running" };
  return { ...state, status: "running", stages };
}

/**
 * Applies the handover a stage produced. Only the fields the stage owns may be
 * written, and a value a previous stage produced may never be replaced by a
 * different value.
 */
/**
 * @param {J01State} state
 * @param {string} stageId
 * @param {Record<string, unknown>} [handover]
 * @returns {J01State}
 */
export function applyStageHandover(state, stageId, handover = {}) {
  const idx = stageIndex(stageId);
  if (idx < 0) throw new Error(`unknown stage ${stageId}`);
  const next = { ...state, producedBy: { ...(state.producedBy ?? {}) } };
  for (const [key, value] of Object.entries(handover)) {
    if (!HANDOVER_FIELDS.includes(key)) {
      throw new Error(`stage ${stageId} may not hand over "${key}"; only ${HANDOVER_FIELDS.join(", ")} are allowed`);
    }
    const owner = FIELD_PRODUCERS[key];
    if (owner !== stageId) {
      throw new Error(`field "${key}" belongs to stage ${owner}; stage ${stageId} may not write it`);
    }
    const previous = state[key];
    const hasPrevious = previous !== null && previous !== undefined && !(Array.isArray(previous) && previous.length === 0);
    if (hasPrevious && !sameValue(previous, value)) {
      throw new Error(
        `stage ${stageId} may not replace "${key}" produced by stage ${state.producedBy?.[key] ?? "an earlier stage"}`
      );
    }
    next[key] = value;
    next.producedBy[key] = stageId;
  }
  return next;
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  return a === b;
}

/**
 * 失败即停. The failing stage becomes `failed`, the journey becomes `failed`,
 * and every LATER stage becomes `not_run` referencing the FIRST failure.
 */
/**
 * @param {J01State} state
 * @param {{stageId: string, failureRef: string}} options
 * @returns {J01State}
 */
export function failJourney(state, { stageId, failureRef } = {}) {
  const idx = stageIndex(stageId);
  if (idx < 0) throw new Error(`unknown stage ${stageId}`);
  if (typeof failureRef !== "string" || failureRef.length === 0) {
    throw new Error(`stage ${stageId} failure needs a failureRef`);
  }
  const stages = cloneStages(state.stages);
  const firstFailureRef = state.failureRef ?? failureRef;
  stages[idx] = { ...stages[idx], status: "failed", failureRef };
  for (let i = idx + 1; i < stages.length; i += 1) {
    stages[i] = { ...stages[i], status: "not_run", failureRef: firstFailureRef };
  }
  return {
    ...state,
    status: "failed",
    failureRef: firstFailureRef,
    stages,
    evidenceRefs: state.evidenceRefs
  };
}

/** Completes a stage. `passed` closes it; `blocked` stops the journey without
 *  pretending the stage ran; a failure goes through failJourney(). */
/**
 * @param {J01State} state
 * @param {string} stageId
 * @param {{status?: "passed"|"blocked", evidenceRefs?: string[], handover?: Record<string, unknown>|null, failureRef?: string|null}} [options]
 * @returns {J01State}
 */
export function completeStage(state, stageId, { status, evidenceRefs = [], handover = null, failureRef = null } = {}) {
  if (!["passed", "blocked"].includes(status)) {
    throw new Error(`completeStage accepts passed|blocked, got ${status}`);
  }
  const idx = stageIndex(stageId);
  if (idx < 0) throw new Error(`unknown stage ${stageId}`);
  const stages = cloneStages(state.stages);
  if (stages[idx].status === "not_run") throw new Error(`stage ${stageId} was never started`);
  stages[idx] = {
    ...stages[idx],
    status,
    evidenceRefs: [...new Set([...stages[idx].evidenceRefs, ...evidenceRefs])],
    failureRef: failureRef ?? stages[idx].failureRef
  };
  let next = {
    ...state,
    status: status === "blocked" ? "blocked" : state.status,
    stages,
    evidenceRefs: [...new Set([...state.evidenceRefs, ...evidenceRefs])]
  };
  if (handover) next = applyStageHandover(next, stageId, handover);
  return next;
}

/**
 * The needles a gold contributes to the leak scan.
 *
 * The gold QUESTION and the gold ANSWER are treated differently on purpose:
 * the executed prompt MUST be gold.question (防静默换题), so the question is
 * not a leak in the channel that legitimately carries it. The ANSWER — the
 * expected value and the governed definition — must never reach the model
 * through any channel.
 *
 * Short values are skipped: a one- or two-character answer would collide with
 * ordinary text.
 */
/**
 * @param {{question?: string, definition?: string, expected?: {cents?: number, value?: number}}} [gold]
 * @returns {Array<{kind: string, text: string}>}
 */
export function goldNeedles(gold = {}) {
  const needles = [];
  const add = (value, kind) => {
    if (typeof value !== "string") return;
    const text = value.trim();
    if (text.length < 4) return;
    needles.push({ kind, text });
  };
  add(gold.question, "question");
  add(gold.definition, "definition");
  const expected = gold.expected ?? {};
  if (typeof expected.cents === "number" && Number.isFinite(expected.cents)) {
    add((expected.cents / 100).toFixed(2), "answer-money");
    if (expected.cents >= 1000) add(String(expected.cents), "answer-cents");
  }
  if (typeof expected.value === "number" && Number.isFinite(expected.value) && Math.abs(expected.value) >= 100) {
    add(String(expected.value), "answer-value");
  }
  return needles;
}

function isFinalAnswerSurface(surface) {
  if (!surface || typeof surface !== "object") return false;
  const name = typeof surface.surface === "string" ? surface.surface : "";
  return name === "final-answer" || name === "final_answer" || surface.isFinalAnswer === true;
}

/**
 * 防泄露 (no leak). The gold ANSWER must not appear in the Agent prompt, the
 * model-visible context, the Wiki, the Skill, the semantic assets, the MCP
 * config or any tool input.
 *
 * Two deliberate exemptions, both declared by the caller:
 *   * the FINAL ANSWER legitimately contains the answer and is NOT scanned: a
 *     result that matches gold is the expected outcome, not a leak;
 *   * `questionCarriers` names the surfaces that legitimately carry the
 *     EXECUTED question (the Agent prompt). The question text is required
 *     there by 防静默换题, so scanning it there would make the two assertions
 *     contradict each other. The answer needles are still checked there.
 */
/**
 * @param {{gold?: {question?: string, definition?: string, expected?: {cents?: number, value?: number}}, surfaces?: Array<J01Surface|string>, finalAnswer?: string|null, extraNeedles?: string[], questionCarriers?: string[]}} [options]
 * @returns {{ok: boolean, leaks: Array<{surface: string, kind: string, needle: string}>, scannedSurfaces: number, needleCount: number, questionCarriers: string[], finalAnswerExcluded: boolean, reason: string}}
 */
export function assertNoGoldLeak({ gold, surfaces = [], finalAnswer = null, extraNeedles = [], questionCarriers = [] } = {}) {
  const needles = [
    ...goldNeedles(gold),
    ...(Array.isArray(extraNeedles) ? extraNeedles : [])
      .map((t) => ({ kind: "extra", text: String(t).trim() }))
      .filter((n) => n.text.length >= 4)
  ];
  const carriers = new Set(Array.isArray(questionCarriers) ? questionCarriers : []);
  const scanned = (Array.isArray(surfaces) ? surfaces : []).filter((s) => !isFinalAnswerSurface(s));
  const leaks = [];
  for (const surface of scanned) {
    const text = typeof surface === "string" ? surface : String(surface?.text ?? "");
    if (!text) continue;
    const name = typeof surface === "object" ? (surface.surface ?? "unknown") : "unknown";
    for (const needle of needles) {
      if (needle.kind === "question" && carriers.has(name)) continue;
      if (text.includes(needle.text)) {
        leaks.push({ surface: name, kind: needle.kind, needle: needle.text });
      }
    }
  }
  const ok = scanned.length > 0 && leaks.length === 0;
  return {
    ok,
    leaks,
    scannedSurfaces: scanned.length,
    needleCount: needles.length,
    questionCarriers: [...carriers],
    finalAnswerExcluded: finalAnswer !== null,
    reason: scanned.length === 0
      ? "no model-visible surface was scanned"
      : leaks.length > 0
        ? `gold leaked into ${leaks.length} model-visible surface(s)`
        : "no gold in the model-visible surfaces"
  };
}

function traceEventId(event) {
  return event?.callId ?? event?.call_id ?? event?.toolCallId ?? null;
}

function isToolCallEvent(event) {
  const kind = event?.event ?? event?.type ?? event?.kind;
  return kind === "tool_call" || kind === "toolCall" || event?.toolCall === true;
}

/**
 * 防代答 (no runner substitution). The client transcript must contain an
 * Agent-initiated tool call, and that call must be correlatable BY CALL ID to
 * a server-side trace event.
 *
 * Retry attempts are recorded separately: one client call may correlate with
 * SEVERAL server trace events (attempt 1, attempt 2, …). The check therefore
 * requires AT LEAST ONE matching trace event, never exactly one.
 */
/**
 * @param {{transcript?: Array<Record<string, unknown>>, serverTrace?: Array<Record<string, unknown>>, expectedBinding?: Record<string, unknown>|null}} [options]
 * @returns {{ok: boolean, agentToolCalls: number, correlatedCallIds: string[], uncorrelatedCallIds: string[], unboundCallIds: string[], attemptsByCallId: Record<string, number[]>, reason: string}}
 */
export function assertAgentOwnedCalls({ transcript = [], serverTrace = [], expectedBinding = null } = {}) {
  const entries = Array.isArray(transcript) ? transcript : [];
  const traces = Array.isArray(serverTrace) ? serverTrace : [];
  const agentCalls = entries.filter((e) => e && e.role === "assistant" && typeof e.tool === "string" && e.tool.length > 0);
  const reasons = [];
  if (agentCalls.length === 0) {
    reasons.push("the client transcript contains no Agent-initiated tool call");
  }
  const withoutCallId = agentCalls.filter((e) => typeof traceEventId(e) !== "string" || traceEventId(e).length === 0);
  if (withoutCallId.length > 0) {
    reasons.push(`${withoutCallId.length} Agent tool call(s) carry no call id`);
  }
  const toolEvents = traces.filter(isToolCallEvent);
  const attemptsByCallId = {};
  for (const event of toolEvents) {
    const id = traceEventId(event);
    if (!id) continue;
    const attempt = event.attempt ?? event.attemptNumber ?? event.retry ?? 1;
    attemptsByCallId[id] = [...(attemptsByCallId[id] ?? []), attempt];
  }
  const uncorrelated = [];
  const unbound = [];
  for (const call of agentCalls) {
    const id = traceEventId(call);
    if (!id) continue;
    const hits = toolEvents.filter((event) => traceEventId(event) === id);
    if (hits.length === 0) {
      uncorrelated.push(id);
      continue;
    }
    if (expectedBinding) {
      const matching = hits.filter((event) => bindingMatches(event, expectedBinding));
      if (matching.length === 0) unbound.push(id);
    }
  }
  if (uncorrelated.length > 0) {
    reasons.push(`${uncorrelated.length} Agent tool call(s) have no server-side trace event with the same call id`);
  }
  if (unbound.length > 0) {
    reasons.push(`${unbound.length} Agent tool call(s) correlate only with trace events bound to another run/agent/token`);
  }
  const ok = reasons.length === 0;
  return {
    ok,
    agentToolCalls: agentCalls.length,
    correlatedCallIds: agentCalls.map((c) => traceEventId(c)).filter(Boolean).filter((id) => !uncorrelated.includes(id) && !unbound.includes(id)),
    uncorrelatedCallIds: uncorrelated,
    unboundCallIds: unbound,
    attemptsByCallId,
    reason: ok ? "every Agent tool call correlates with a server-side trace event" : reasons.join("; ")
  };
}

function bindingMatches(event, expected) {
  for (const key of ["runId", "instanceId", "agentId", "tokenId", "tokenLabel", "semanticVersion", "policyVersion"]) {
    if (expected[key] === undefined || expected[key] === null) continue;
    if (event?.[key] !== expected[key]) return false;
  }
  return true;
}

/**
 * 防静默换题 (no silent question swap). The executed prompt must satisfy
 * `prompt === gold.question` EXACTLY — no trimming, no case folding, no
 * normalisation. A silently swapped question fails.
 */
/**
 * @param {{executedPrompt?: string, goldQuestion?: string}} [options]
 * @returns {{ok: boolean, reason: string}}
 */
export function assertPromptUnchanged({ executedPrompt, goldQuestion } = {}) {
  if (typeof executedPrompt !== "string") {
    return { ok: false, reason: "the executed prompt is not a string" };
  }
  if (typeof goldQuestion !== "string" || goldQuestion.length === 0) {
    return { ok: false, reason: "gold.question is missing" };
  }
  const ok = executedPrompt === goldQuestion;
  return {
    ok,
    reason: ok
      ? "the executed prompt is byte-identical to gold.question"
      : "the executed prompt differs from gold.question (silent question swap)"
  };
}

/**
 * The three anti-cheat assertions. Each one proves something the other two
 * cannot, and each one needs its own evidence — the requirement sets are
 * pairwise disjoint, so no assertion can stand in for another.
 */
export const ANTI_CHEAT_ASSERTIONS = Object.freeze([
  Object.freeze({
    id: "no_leak",
    proves: "gold 与标准答案未出现在模型可见输入中（最终答案除外）",
    requires: Object.freeze(["gold", "surfaces"]),
    check: assertNoGoldLeak
  }),
  Object.freeze({
    id: "no_runner_substitution",
    proves: "客户端 transcript 含 Agent 自主工具调用，且按 call id 可关联服务端 trace",
    requires: Object.freeze(["transcript", "serverTrace"]),
    check: assertAgentOwnedCalls
  }),
  Object.freeze({
    id: "no_silent_question_swap",
    proves: "执行问题与 gold.question 逐字一致",
    requires: Object.freeze(["executedPrompt", "goldQuestion"]),
    check: assertPromptUnchanged
  })
]);

export const ANTI_CHEAT_ASSERTION_IDS = Object.freeze(ANTI_CHEAT_ASSERTIONS.map((a) => a.id));

/** The assertions whose evidence is missing from the given evidence set. */
/**
 * @param {Record<string, unknown>} [evidence]
 * @returns {string[]}
 */
export function missingAntiCheatEvidence(evidence = {}) {
  return ANTI_CHEAT_ASSERTIONS.filter((a) =>
    a.requires.some((key) => evidence[key] === undefined || evidence[key] === null)
  ).map((a) => a.id);
}

/** Runs all three assertions. `ok` is true only when ALL of them hold. */
/**
 * @param {Record<string, unknown>} [evidence]
 * @returns {{ok: boolean, results: Record<string, {ok: boolean, reason: string}>}}
 */
export function evaluateAntiCheat(evidence = {}) {
  const results = {};
  for (const assertion of ANTI_CHEAT_ASSERTIONS) {
    const missing = assertion.requires.filter((key) => evidence[key] === undefined || evidence[key] === null);
    results[assertion.id] = missing.length > 0
      ? { ok: false, reason: `missing evidence: ${missing.join(", ")}` }
      : assertion.check(evidence);
  }
  return {
    ok: Object.values(results).every((r) => r.ok),
    results
  };
}

/**
 * Secret scan over the state. Two layers:
 *   1. structural — no plaintext-secret field name, and `tokenSecretRef` is a
 *      controlled REFERENCE (never the Token itself);
 *   2. value scan — credential shapes that cannot be confused with a digest
 *      (model credential, private key, DSN with a password).
 * The caller additionally supplies the run's REAL secrets (from the vault) via
 * assertNoSecretsInState(); those are compared literally.
 */
/**
 * @param {J01State} state
 * @returns {string[]}
 */
export function secretProblemsInState(state) {
  const problems = [];
  if (!state || typeof state !== "object") return ["state must be an object"];
  for (const key of Object.keys(state)) {
    if (FORBIDDEN_STATE_FIELDS.includes(key)) problems.push(`state carries the forbidden field "${key}"`);
  }
  for (const stage of state.stages ?? []) {
    for (const key of Object.keys(stage)) {
      if (FORBIDDEN_STATE_FIELDS.includes(key)) problems.push(`stage ${stage.stageId} carries the forbidden field "${key}"`);
    }
  }
  const ref = state.tokenSecretRef;
  if (ref !== null && ref !== undefined) {
    if (typeof ref !== "string" || !SECRET_REF_PATTERN.test(ref)) {
      problems.push("tokenSecretRef must be a controlled reference (secret://…), never the Token plaintext");
    }
  }
  for (const [field, value] of Object.entries(state)) {
    if (field === "candidateDigest") continue; // a digest is a digest, not a secret
    for (const text of collectStrings(value)) {
      for (const pattern of CREDENTIAL_VALUE_PATTERNS) {
        if (pattern.re.test(text)) problems.push(`state field "${field}" carries a ${pattern.id}`);
      }
    }
  }
  return problems;
}

function collectStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => (k === "candidateDigest" ? [] : collectStrings(v)));
  }
  return [];
}

/** Compares the state against the run's real secrets. Returns the problems;
 *  an empty array means no known secret is present in the state. */
/**
 * @param {J01State} state
 * @param {{secrets?: string[]|Record<string, string>}} [options]
 * @returns {string[]}
 */
export function assertNoSecretsInState(state, { secrets = [] } = {}) {
  const problems = secretProblemsInState(state);
  const known = Array.isArray(secrets)
    ? secrets
    : Object.values(secrets ?? {}).filter((v) => typeof v === "string");
  const serialized = JSON.stringify(state ?? null);
  for (const secret of known) {
    if (typeof secret !== "string" || secret.length < 6) continue;
    if (serialized.includes(secret)) problems.push("a run secret is present in the state");
  }
  return problems;
}

/** Throwing wrapper around assertNoSecretsInState(). */
export function assertStateHasNoSecrets(state, { secrets = [] } = {}) {
  const problems = assertNoSecretsInState(state, { secrets });
  if (problems.length > 0) throw new Error(`J25-01 state carries secrets: ${problems.join("; ")}`);
  return true;
}

/** Full validation of the state shape and its failure-stop invariants. */
/**
 * @param {J01State} state
 * @returns {string[]}
 */
export function validateJourneyState(state) {
  const problems = [];
  if (!state || typeof state !== "object") return ["state must be an object"];
  if (state.journeyId !== JOURNEY_ID) problems.push(`journeyId must be ${JOURNEY_ID}`);
  if (!Array.isArray(state.catalogEvidenceIds) || state.catalogEvidenceIds.join(",") !== JOURNEY_CATALOG_EVIDENCE.join(",")) {
    problems.push(`catalogEvidenceIds must be ${JOURNEY_CATALOG_EVIDENCE.join(", ")}`);
  }
  for (const key of ["runId", "instanceId", "candidateDigest"]) {
    if (typeof state[key] !== "string" || state[key].length === 0) problems.push(`${key} missing`);
  }
  if (!Array.isArray(state.stages) || state.stages.length !== 8) {
    problems.push("the journey must carry exactly 8 stages");
  } else {
    state.stages.forEach((stage, i) => {
      if (stage.stageId !== J01_STAGE_IDS[i]) problems.push(`stage ${i} is ${stage.stageId}, expected ${J01_STAGE_IDS[i]}`);
      if (!STAGE_STATUSES.includes(stage.status)) problems.push(`stage ${stage.stageId} has unknown status ${stage.status}`);
      if (!Array.isArray(stage.evidenceRefs)) problems.push(`stage ${stage.stageId} evidenceRefs must be an array`);
      if ("executionId" in stage) {
        problems.push(`stage ${stage.stageId} carries an executionId; J25-01 is one journey, not eight execution items`);
      }
    });
  }
  if ("executionIds" in state) {
    problems.push("the journey state carries executionIds; J25-01 is not split into eight execution items");
  }
  for (const key of HANDOVER_FIELDS) {
    const value = state[key];
    if (key === "sourceKeys") {
      if (!Array.isArray(value)) problems.push("sourceKeys must be an array");
      continue;
    }
    if (value !== null && (typeof value !== "string" || value.length === 0)) {
      problems.push(`${key} must be a non-empty string or null`);
    }
  }
  if (!Array.isArray(state.evidenceRefs)) problems.push("evidenceRefs must be an array");
  if (!JOURNEY_STATUSES.includes(state.status)) problems.push(`unknown journey status ${state.status}`);
  problems.push(...secretProblemsInState(state));
  problems.push(...stageOrderProblems(state));
  problems.push(...failureStopProblems(state));
  return problems;
}

/** The stages form a prefix of `passed`; once the journey stops at a stage,
 *  every later stage stays `not_run`. A stage can never be skipped. */
function stageOrderProblems(state) {
  const problems = [];
  const stages = state?.stages ?? [];
  const firstUnpassed = stages.findIndex((s) => s.status !== "passed");
  if (firstUnpassed < 0) return problems;
  const stopped = stages[firstUnpassed];
  for (const stage of stages.slice(firstUnpassed + 1)) {
    if (stage.status !== "not_run") {
      problems.push(`stage ${stage.stageId} is ${stage.status} but the journey stopped at ${stopped.stageId} (${stopped.status})`);
    }
  }
  return problems;
}

/** The 失败即停 invariants: one failed stage, later stages `not_run` and
 *  referencing the FIRST failure. */
function failureStopProblems(state) {
  const problems = [];
  const stages = state?.stages ?? [];
  const failedIdx = stages.findIndex((s) => s.status === "failed");
  if (failedIdx < 0) {
    if (state?.status === "failed") problems.push("the journey is failed but no stage is failed");
    return problems;
  }
  const first = stages[failedIdx];
  if (typeof first.failureRef !== "string" || first.failureRef.length === 0) {
    problems.push(`stage ${first.stageId} failed without a failureRef`);
  }
  if (state?.status !== "failed") problems.push(`stage ${first.stageId} failed but the journey status is ${state?.status}`);
  for (const stage of stages.slice(0, failedIdx)) {
    if (stage.status !== "passed") problems.push(`stage ${stage.stageId} runs before the failed stage but is ${stage.status}`);
  }
  for (const stage of stages.slice(failedIdx + 1)) {
    if (stage.status !== "not_run") problems.push(`stage ${stage.stageId} runs after the failure but is ${stage.status}`);
    if (stage.failureRef !== first.failureRef) {
      problems.push(`stage ${stage.stageId} must reference the first failure ${first.failureRef}`);
    }
  }
  return problems;
}
