#!/usr/bin/env node
// Drives the registered REAL product clients through the Agent cases (Spec §6.3, §6.4, §7 UX-02～05, SEC-14/16).
//
//   node scripts/e2e/run-agent-journey.mjs --run inbox/e2e/<runId>/run.json [--clients docs/qa/real-e2e-clients.yaml]
//
// v5 client expectations (docs/qa/real-e2e-clients.yaml, owner decision 2026-10-18):
//   automated required: Claude Code + OpenClaw — driven by adapters under scripts/e2e/adapters/.
//   manual required:   WorkBuddy + Cursor Agent GUI — human-executed forever, never wired here.
//   Codex CLI was dropped from automated required in v5; do not reintroduce it as an automation path
//   or remove WorkBuddy/Cursor's manual gate requirement.
//
// Rules enforced here, not left to convention:
//   - only adapters from scripts/e2e/adapters/ that pass the adapter contract; no direct-HTTP "client";
//   - the question text comes from the gold registry's QUESTION only (gold values never reach the client, and the
//     Token is passed through an environment variable, never argv; there is no --gold / --token argument);
//   - a client whose binary or model credential is absent is BLOCKED, never faked;
//   - before the official questions the same client must prove it cannot reach gold / seed / DB / control plane;
//   - each required product x case runs `repeat` (3) independent times; every run, failed or not, stays in the
//     evidence and a case passes only when all runs pass (R9);
//   - correctness, leakage and server-trace binding are judged by answer-assertions.mjs and server evidence;
//   - --external is REQUIRED when run.instance.startedBy === "external" (real K8s run) and FORBIDDEN
//     otherwise. A registered external target without --external would start a local Lucy child and
//     silently target the wrong deployment (Spec §6.5, §8.3).
// Exit codes: Spec §8.2 (0 passed, 1 failed, 2 blocked).

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";
import { evaluateAnswer, outcomeSignature } from "./answer-assertions.mjs";
import { adapterDigest, locateBinary, validateAdapter, TOKEN_ENV } from "./adapters/_contract.mjs";
import { collectServerEvidence, ensureOwnerBootstrapped, tokenFingerprintOf, writeServerEvidenceFile } from "./collect-server-evidence.mjs";
import { expectedAskPlan } from "./lib/ask-plan.mjs";
import { loadCatalog } from "./lib/catalog.mjs";
import { automatedRequiredClients, countDistinctAutomatedProducts } from "./lib/clients.mjs";
import { EXIT_CODES, REPO_ROOT, fail, loadRun, parseArgv } from "./lib/common.mjs";
import {
  RESOURCE_KIND,
  allocateProbeCanaries,
  boundaryReceipt,
  buildBoundaryBundle,
  buildEnvAllowMatcher,
  cleanupBoundary,
  detectIsolationProvider,
  didProbeDeny,
  probeIsolation,
  sanitizeEnv
} from "./lib/isolation.mjs";
import { ExternalInstance, LucyProcess } from "./lib/instance.mjs";
import { scanText } from "./lib/leak-scan.mjs";
import { reconcileExternalFlag, TargetIdentityError } from "./lib/target-identity.mjs";
import { statusFromAssertions } from "./run-security.mjs";

function progressLog(run, message) {
  try {
    const file = path.join(run.paths.logs, "progress.log");
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // progress is best-effort; never fail the run for logging
  }
}

const ADAPTER_DIR = path.join(REPO_ROOT, "scripts", "e2e", "adapters");
const ANSWER_SUFFIX = "请用中文回答，金额精确到分（元，保留两位小数），并说明口径。";

/** Per-case ask plans. Cases without a plan are BLOCKED (handler_not_implemented), never guessed. */
export function askPlan(testCase) {
  return expectedAskPlan(testCase);
}

/** @deprecated prefer countDistinctAutomatedProducts — kept for tests that pass a flat required list */
export function countDistinctProducts(clients) {
  return countDistinctAutomatedProducts(clients);
}

function redactAll(text, secrets) {
  return secrets.reduce((acc, secret) => (secret ? acc.split(secret).join("[REDACTED]") : acc), String(text ?? ""));
}

/** Default process runner: bounded wall clock, never inherits stdio, OS-bounded child.
 *
 *  A5 enforcement: the runner MUST NEVER spread `process.env` (which on CI may contain
 *  GITHUB_TOKEN, signing-key paths, checker/control credentials) into the child. The child is
 *  sanitized by an explicit allowlist (`buildEnvAllowMatcher`). The runner MUST NEVER let the
 *  real client inherit the runner's HOME; it gets a dedicated `<workDir>` HOME. The runner MUST
 *  only kill its own process group on timeout, never unrelated PIDs.
 *
 *  This is the default process runner used for code that DOES NOT require an isolation boundary
 *  (e.g. probes that run before the boundary is established). The agent journey's
 *  per-ask/official asks use a stricter runner that ALSO wraps the child under the boundary
 *  via `runUnderBoundary`. Keeping this default explicit makes the difference visible.
 */
export function runProcess({ command, args, cwd, env, timeoutMs, bounds }) {
  return new Promise((resolve) => {
    const sanitized = sanitizeEnv({ ...env, PATH: env.PATH ?? process.env.PATH }, buildEnvAllowMatcher(), { clientHome: cwd });
    let child;
    try {
      child = spawn(command, args, { cwd, env: sanitized, stdio: ["ignore", "pipe", "pipe"], detached: true });
    } catch (error) {
      resolve({ completed: false, reason: `spawn_error:${error?.message ?? String(error)}`, exitCode: -1, stdout: "", stderr: "", timedOut: false });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = (target, bound) => bound && target.length > bound ? target.slice(0, bound) : target;
    const timer = setTimeout(() => {
      timedOut = true;
      killOwnedProcessGroup(child, "SIGKILL");
    }, Math.max(1_000, timeoutMs ?? 30_000));
    child.stdout.on("data", (chunk) => { stdout = cap(`${stdout}${chunk}`, bounds?.stdout); });
    child.stderr.on("data", (chunk) => { stderr = cap(`${stderr}${chunk}`, bounds?.stderr); });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ completed: false, reason: `child_error:${error?.message ?? String(error)}`, exitCode: -1, stdout, stderr, timedOut });
    });
    child.once("exit", (code) => {
      if (timedOut) {
        // The exit comes from the SIGKILL we already issued; return `completed: false` so the
        // caller treats it as an incomplete probe and BLOCKS isolation rather than declaring it
        // established on silence.
        clearTimeout(timer);
        resolve({ completed: false, reason: "timed_out", exitCode: code ?? -1, stdout, stderr, timedOut });
        return;
      }
      clearTimeout(timer);
      resolve({ completed: true, exitCode: code ?? -1, stdout, stderr, timedOut });
    });
  });
}

/**
 * Kill ONLY the child + its own process group. Never `process.kill(0)` / sweep unrelated PIDs.
 * `setpgid` + `kill(-pgid)` is the documented pattern for `detached: true` children.
 */
function killOwnedProcessGroup(child, signal) {
  try {
    if (typeof child.pid === "number") process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

/**
 * Local wrapper around `isolation.mjs:runUnderBoundary` that pulls the profile string from
 * `buildBoundaryBundle` so the agent journey's official asks use the SAME boundary as the
 * isolation probe. Without this, the probe would prove isolation but the official asks
 * would run against an unwrapped child — a deliberate laundering path.
 *
 * Returns the same shape `runProcess` does: `{ completed, reason, exitCode, stdout, stderr, timedOut }`.
 */
async function runUnderBoundaryLocal({ provider, profileString, command, args, cwd, env, timeoutMs, bounds }) {
  // Re-import is cheap; the deps object already holds the provider + profileString, we just
  // forward to the library wrapper.
  const mod = await import("./lib/isolation.mjs");
  return mod.runUnderBoundary({ provider, profileString, command, args, cwd, env, timeoutMs, bounds });
}

export async function loadAdapters(clientsDoc, { adapterDir = ADAPTER_DIR } = {}) {
  const adapters = {};
  for (const client of automatedRequiredClients(clientsDoc.clients)) {
    if (!client.adapter) throw new Error(`automated required client ${client.product} has no adapter`);
    const file = path.resolve(REPO_ROOT, client.adapter);
    if (path.dirname(file) !== path.resolve(adapterDir)) throw new Error(`adapter for ${client.product} must live in ${adapterDir}`);
    const mod = await import(pathToFileURL(file));
    const problems = validateAdapter(mod);
    if (problems.length > 0) throw new Error(`adapter ${client.product} violates the contract: ${problems.join("; ")}`);
    adapters[client.product] = { mod, digest: adapterDigest(file), file };
  }
  return adapters;
}

function blockedEntry(testCase, client, runNo, startedAt, reasons, extra = {}) {
  return {
    id: testCase.id, runner: "agent", scenario: testCase.scenario, client, run: runNo, status: "blocked", startedAt, finishedAt: new Date().toISOString(),
    serverTraceIds: [], queryEventIds: [], policyVersion: "unavailable", contextPolicyVersion: "unavailable", assertions: [], artifacts: [],
    detail: reasons.join("; "), blockedBy: reasons, ...extra
  };
}

async function askOnce({ ask, goldDoc, testCase, tokens, secrets, adapter, probeInfo, workDir, deps, run, now, ledger }) {
  const gold = ask.goldKey ? goldDoc.questions[ask.goldKey] : { question: ask.question, forbiddenCanaries: [], expected: null };
  const canaries = goldDoc.canaries;
  const question = `${ask.question ?? gold.question}${ask.suffix ? ` ${ANSWER_SUFFIX}` : ""}`;
  const token = tokens[ask.agentId];
  const fingerprint = tokenFingerprintOf(token);
  const prepared = adapter.mod.prepare({ workDir, mcpUrl: run.instance.mcpUrl });
  // Build the invocation, but the actual `command`/`args`/`env` MUST be wrapped under the
  // boundary for official asks. The deps.boundaryRun is `runUnderBoundary` from isolation.mjs
  // for the production path; tests can substitute a stub. We pass an explicit allowlist and
  // an isolated HOME on the command so `process.env.HOME` / parent PATH / sibling creds /
  // signing material never reach the child.
  const invocation = adapter.mod.buildInvocation({ binaryPath: probeInfo.binaryPath, question, workDir, prepared, env: deps.env, secrets });
  const since = new Date(now()).toISOString();
  const result = await (deps.boundaryRun ?? runProcess)({ ...invocation, env: { ...invocation.env, [TOKEN_ENV]: token }, timeoutMs: deps.timeoutMs, bounds: deps.bounds });
  const until = new Date(now()).toISOString();
  let lastMessage = "";
  if (prepared.lastMessageFile) {
    try {
      lastMessage = readFileSync(prepared.lastMessageFile, "utf8");
    } catch {
      lastMessage = "";
    }
  }
  const parsed = adapter.mod.parseResult({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, lastMessage });
  const evidence = await deps.collect({ run, agentId: ask.agentId, tokenFingerprint: fingerprint, since, until, reader: ledger });
  // A4 atomic-fix: the runner must NOT pre-fill upstreamUnauthorized. The collector is the source of
  // truth — `bindEvidence` accepts an `upstreamExecutionCount` ONLY from an independent upstream
  // execution observation provider. It will NEVER derive a count from the audit ledger's outcome
  // tags (ok/denied/error is a verdict enum, not a raw execution count). When the provider is
  // absent, `upstreamUnauthorized` is `undefined` and evaluateAnswer's BLOCKED
  // `upstream_unmeasured` path fires. When the provider supplies a measured 0, that flows through
  // as a clean zero. Hardcoding 0 here would launder any missing measurement and let unauthorized
  // executions slip past the deny assertion.
  //
  // The runner does NOT defensively infer a missing upstreamUnauthorized from `events` either: a
  // missing count means the collector did not measure, and the case must BLOCK. Tests, fixtures
  // and any collector must supply an explicit non-negative integer (a measured 0 is fine,
  // undefined is not).
  //
  // A5 boundary wrap also records an exit shape that the harness can audit. A `completed:false`
  // outcome from the boundary-wrapped runner is NOT a successful client run: we represent it
  // as a typed_gold failure with the wrapper's reason so the case BLOCKS rather than passing.
  if (result.completed === false) {
    return {
      parsed: { ok: false, sessionId: parsed.sessionId, model: parsed.model, finalAnswer: "" },
      evidence,
      assertions: [{ token: "typed_gold", passed: false, detail: `boundary wrap did not complete: ${result.reason ?? "unknown"}` }],
      fingerprint, since, until, timedOut: Boolean(result.timedOut), exitCode: result.exitCode ?? -1, boundaryIncomplete: true
    };
  }
  if (parsed.ok) {
    const goldForEval = ask.goldKey ? { ...gold, forbiddenCanaries: [...(gold.forbiddenCanaries ?? [])] } : { ...gold };
    const assertions = evaluateAnswer({
      goldQuestion: goldForEval,
      answer: parsed.finalAnswer,
      evidence,
      secrets,
      extraForbidden: (ask.injectionForbidden ?? []).map((name) => canaries[name]),
      expectation: ask.expectation
    });
    return { parsed, evidence, assertions, fingerprint, since, until, timedOut: result.timedOut, exitCode: result.exitCode };
  }
  return { parsed, evidence, assertions: [{ token: "typed_gold", passed: false, detail: result.timedOut ? "client timed out" : `client run failed (exit ${result.exitCode})` }], fingerprint, since, until, timedOut: result.timedOut, exitCode: result.exitCode };
}

/** Pure-ish orchestration (all I/O injected) so the anti-cheating rules are unit-testable. */
export async function runAgentJourney({ run, cases, goldDoc, clientsDoc, adapters, tokens, secrets, deps }) {
  const startedAt = new Date().toISOString();
  const agentCases = cases.filter((c) => c.runner === "agent");
  const requiredClients = automatedRequiredClients(clientsDoc.clients);
  const entries = [];
  const clientInfo = [];
  const serverEvidenceCases = [];
  let modelCalls = 0;
  const budget = deps.maxModelCalls ?? Infinity;

  progressLog(run, `journey start clients=${requiredClients.map((c) => c.product).join(",")} agentCases=${agentCases.length}`);
  for (const client of requiredClients) {
    const adapter = adapters[client.product];
    progressLog(run, `probe ${client.product}`);
    const probeInfo = adapter.mod.probe({ env: deps.env, spawnSync: deps.spawnSync ?? spawnSync, locate: deps.locate ?? locateBinary });
    clientInfo.push({ product: client.product, version: probeInfo.version ?? "unavailable", adapterDigest: adapter.digest, model: probeInfo.model ?? "unavailable", transport: adapter.mod.transport, required: true, probe: probeInfo.status, reasons: probeInfo.reasons });
    const blockAll = (reasons) => {
      for (const testCase of agentCases) for (let n = 1; n <= testCase.repeat; n += 1) entries.push(blockedEntry(testCase, client.product, n, startedAt, reasons));
    };
    if (probeInfo.status !== "ready") {
      progressLog(run, `probe ${client.product} blocked: ${probeInfo.reasons.join("; ")}`);
      blockAll(probeInfo.reasons);
      continue;
    }
    const workDir = path.join(run.paths["client-work"], client.product);
    mkdirSync(workDir, { recursive: true });

    // Isolation proof with the real client before any official question (Spec §6.2).
    const isolation = await deps.isolationProbe({ adapter, probeInfo, workDir, run, secrets });
    if (!isolation.attemptCompleted) {
      progressLog(run, `isolation ${client.product} did not complete: ${isolation.detail}`);
      blockAll([`isolation_not_completed: ${isolation.detail}`]);
      // Persist the receipt so an audit can see WHY; the verifier rejects because
      // attemptCompleted is false AND because the profile hash isn't in the evidence set.
      const lastReceipt = clientInfo[clientInfo.length - 1];
      if (lastReceipt) lastReceipt.isolationReceipt = isolation.receipt ?? null;
      lastReceipt.isolationSummary = { isolated: isolation.isolated ?? false, attemptCompleted: false, attempts: isolation.attempts ?? [] };
      continue;
    }
    if (!isolation.isolated) {
      progressLog(run, `isolation ${client.product} failed: ${isolation.detail}`);
      blockAll([`isolation_not_established: ${isolation.detail}`]);
      const lastReceipt = clientInfo[clientInfo.length - 1];
      if (lastReceipt) lastReceipt.isolationReceipt = isolation.receipt ?? null;
      lastReceipt.isolationSummary = { isolated: false, attemptCompleted: true, attempts: isolation.attempts ?? [] };
      continue;
    }
    progressLog(run, `isolation ${client.product} ok (${isolation.detail})`);
    const lastReceipt = clientInfo[clientInfo.length - 1];
    if (lastReceipt) lastReceipt.isolationReceipt = isolation.receipt ?? null;
    lastReceipt.isolationSummary = { isolated: true, attemptCompleted: true, attempts: isolation.attempts ?? [] };

    for (const testCase of agentCases) {
      const plan = askPlan(testCase);
      const missing = testCase.requires.filter((cap) => !deps.capabilities.has(cap));
      for (let n = 1; n <= testCase.repeat; n += 1) {
        if (!plan || missing.length > 0 || modelCalls >= budget) {
          const reasons = missing.length > 0 ? [`missing capability: ${missing.join(", ")}`] : !plan ? ["handler_not_implemented"] : ["budget_exhausted"];
          entries.push(blockedEntry(testCase, client.product, n, startedAt, reasons));
          continue;
        }
        const caseStarted = new Date(deps.now()).toISOString();
        progressLog(run, `case start ${testCase.id}@${client.product}#${n} asks=${plan.length}`);
        // Per-ask indexed records. A4: one case may have multiple asks with DIFFERENT Agents/Tokens
        // (SEC-14-V12: sales denied then finance allowed). The runner must record each ask's
        // evidence separately and the verifier must validate each ask independently. The previous
        // implementation kept a single `bound` accumulator and let the last ask's tokenFingerprint
        // overwrite every prior one — that laundered any cross-ask mismatch and made it impossible
        // to detect a denial ask with one Token + answer ask with another Token.
        const assertions = [];
        const asks = [];
        let failureDetail = "";
        const transcript = [];
        for (let askIndex = 0; askIndex < plan.length; askIndex += 1) {
          const ask = plan[askIndex];
          modelCalls += 1;
          const outcome = await askOnce({ ask, goldDoc, testCase, tokens, secrets, adapter, probeInfo, workDir, deps, run, now: deps.now, ledger: deps.ledger });
          assertions.push(...outcome.assertions);
          if (!outcome.parsed.ok) failureDetail = outcome.timedOut ? "client timed out" : `client exit ${outcome.exitCode}`;
          // Per-ask gold/result digests. The gold digest is computed from the question's expected
          // typed-gold + definition; the result digest is computed from the runner's recorded
          // answer + outcome. These are recorded but only used by the verifier when it inspects a
          // single ask in isolation (the union at the entry level would re-introduce A4 laundering).
          const goldQuestion = ask.goldKey ? goldDoc.questions[ask.goldKey] : { question: ask.question, expected: null };
          const goldDigest = goldQuestion ? createHash("sha256").update(JSON.stringify({ q: goldQuestion.question ?? "", expected: goldQuestion.expected ?? null })).digest("hex") : null;
          const resultDigest = createHash("sha256").update(JSON.stringify({ a: outcome.parsed.finalAnswer ?? "", ok: outcome.parsed.ok ?? false })).digest("hex");
          // Indexed ask record. ALL of runId/instanceId/caseId/client/run/askIndex/agentId/
          // tokenFingerprint/since/until/traceIds/queryEventIds/policyVersion/contextPolicyVersion/
          // resultDigest/goldDigest are bound for THIS ask. The verifier rejects duplicate or
          // missing ask indices, wrong Token/Agent, wrong time/query/result, and cross-ask union
          // laundering. Distinct Agents/Tokens per ask (SEC-14-V12) are legitimate.
          const askRecord = {
            runId: run.runId,
            instanceId: run.instanceId,
            caseId: testCase.id,
            client: client.product,
            run: n,
            askIndex,
            agentId: ask.agentId,
            goldKey: ask.goldKey ?? null,
            expectation: ask.expectation ?? "answer",
            since: outcome.since,
            until: outcome.until,
            traceIds: [...(outcome.evidence.traceIds ?? [])],
            queryEventIds: [...(outcome.evidence.queryEventIds ?? [])],
            events: outcome.evidence.events ?? [],
            tokenFingerprint: outcome.fingerprint,
            policyVersion: outcome.evidence.policyVersion ?? "unavailable",
            contextPolicyVersion: outcome.evidence.contextPolicyVersion ?? "unavailable",
            bindingProblems: outcome.evidence.bindingProblems ?? [],
            resultDigest,
            goldDigest,
            sessionId: outcome.parsed.sessionId,
            model: outcome.parsed.model,
            answer: redactAll(outcome.parsed.finalAnswer, secrets)
          };
          asks.push(askRecord);
          transcript.push({
            askIndex,
            agentId: ask.agentId,
            goldKey: ask.goldKey,
            sessionId: outcome.parsed.sessionId,
            model: outcome.parsed.model,
            since: outcome.since,
            until: outcome.until,
            tokenFingerprint: outcome.fingerprint,
            answer: redactAll(outcome.parsed.finalAnswer, secrets),
            bindingProblems: outcome.evidence.bindingProblems
          });
          serverEvidenceCases.push({
            caseId: testCase.id, client: client.product, run: n, askIndex,
            runId: run.runId, instanceId: run.instanceId,
            agentId: ask.agentId, tokenFingerprint: outcome.fingerprint,
            since: outcome.since, until: outcome.until,
            events: outcome.evidence.events, traceIds: outcome.evidence.traceIds, queryEventIds: outcome.evidence.queryEventIds,
            policyVersion: outcome.evidence.policyVersion, contextPolicyVersion: outcome.evidence.contextPolicyVersion,
            resultDigest, goldDigest
          });
          progressLog(run, `ask done ${testCase.id}@${client.product}#${n}/${askIndex} agent=${ask.agentId} ok=${outcome.parsed.ok} exit=${outcome.exitCode}`);
        }
        // Assertions of one case run are judged together: a token holds only if every ask satisfied it.
        const merged = [];
        for (const token of new Set(assertions.map((a) => a.token))) {
          const group = assertions.filter((a) => a.token === token);
          merged.push({ token, passed: group.every((a) => a.passed), detail: group.map((a) => a.detail).join(" | ").slice(0, 300) });
        }
        const verdict = statusFromAssertions({ assert: testCase.assert.filter((t) => t !== "repeat3" && t !== "consistency") }, { assertions: merged });
        // Per-ask indexed records bound. `tokenFingerprints` (plural) preserves every ask's
        // measured fingerprint; `tokenFingerprint` (singular) is the FIRST ask's fingerprint for
        // backward compatibility with the previous schema. The verifier MUST use the per-ask
        // indexed records, never the singular value alone, when checking the per-question token
        // binding.
        const allTraceIds = [...new Set(asks.flatMap((a) => a.traceIds))];
        const allQueryEventIds = [...new Set(asks.flatMap((a) => a.queryEventIds))];
        const tokenFingerprints = [...new Set(asks.map((a) => a.tokenFingerprint))];
        const entry = {
          id: testCase.id, runner: "agent", scenario: testCase.scenario, client: client.product, run: n, status: verdict.status,
          startedAt: caseStarted, finishedAt: new Date(deps.now()).toISOString(),
          tokenFingerprint: asks[0]?.tokenFingerprint ?? null,
          tokenFingerprints,
          serverTraceIds: allTraceIds, queryEventIds: allQueryEventIds,
          policyVersion: asks[0]?.policyVersion ?? "unavailable",
          contextPolicyVersion: asks[0]?.contextPolicyVersion ?? "unavailable",
          policyVersions: [...new Set(asks.map((a) => a.policyVersion))],
          contextPolicyVersions: [...new Set(asks.map((a) => a.contextPolicyVersion))],
          asks,
          assertions: merged, artifacts: [], detail: verdict.detail || failureDetail,
          failureClass: verdict.status === "failed" ? "product_defect" : undefined, transcript
        };
        entries.push(entry);
        progressLog(run, `case done ${testCase.id}@${client.product}#${n} status=${entry.status} asks=${asks.length}`);
      }
    }
  }
  progressLog(run, `journey loop done modelCalls=${modelCalls}`);

  applyCrossRunRules(entries, agentCases, requiredClients.map((c) => c.product));
  const count = (status) => entries.filter((e) => e.status === status).length;
  const status = count("failed") > 0 ? "failed" : count("blocked") > 0 ? "blocked" : "passed";
  return { entries, clientInfo, serverEvidenceCases, status, startedAt, modelCalls, summary: { total: entries.length, passed: count("passed"), failed: count("failed"), blocked: count("blocked") } };
}

/**
 * repeat3 (R9): a (case, product) passes only if all of its runs passed - a failed first run is never erased.
 * consistency (UX-05): every required product must reach the same business/security verdicts.
 */
export function applyCrossRunRules(entries, agentCases, products) {
  for (const testCase of agentCases) {
    if (testCase.assert.includes("repeat3")) {
      for (const product of products) {
        const runs = entries.filter((e) => e.id === testCase.id && e.client === product);
        if (runs.length === 0 || runs.some((e) => e.status === "blocked")) continue;
        const passedRuns = runs.filter((e) => e.status === "passed").length;
        const anyFailed = runs.some((e) => e.status === "failed");
        for (const entry of runs) {
          if (entry.status === "passed" && anyFailed) {
            entry.status = "failed";
            entry.detail = `repeat3: ${passedRuns}/${testCase.repeat} runs passed; every run must pass (R9)`;
          }
          entry.assertions = [...entry.assertions, { token: "repeat3", passed: !anyFailed && passedRuns === testCase.repeat, detail: `${passedRuns}/${testCase.repeat} runs passed` }];
        }
      }
    }
    if (testCase.assert.includes("consistency")) {
      const signatures = new Map();
      for (const entry of entries.filter((e) => e.id === testCase.id && e.status !== "blocked")) {
        const key = outcomeSignature(entry.assertions.filter((a) => a.token !== "repeat3" && a.token !== "consistency"));
        signatures.set(entry.client, [...(signatures.get(entry.client) ?? []), key]);
      }
      const distinct = new Set([...signatures.values()].flat());
      const consistent = distinct.size <= 1 && signatures.size === products.length;
      for (const entry of entries.filter((e) => e.id === testCase.id && e.status !== "blocked")) {
        entry.assertions = [...entry.assertions, { token: "consistency", passed: consistent, detail: consistent ? "all products agree" : `${distinct.size} different verdict pattern(s) across ${signatures.size} product(s)` }];
        if (!consistent && entry.status === "passed") {
          entry.status = "failed";
          entry.detail = "consistency: required products disagree on business/security verdicts";
        }
      }
    }
  }
}

/**
 * Real isolation probe: BOTH a synthesized boundary AND a per-resource denial test.
 *
 * The probe returns a strict object so the orchestrator can fail closed:
 *   { isolated, attemptCompleted, attempts, detail, error, receipt }
 *
 * - `attemptCompleted: false` (timeout, error, empty stdout, non-zero exit, unsupported
 *   platform) is NOT treated as "isolated: true" — the runner must BLOCK.
 * - `isolated: true` ONLY when the boundary denies ALL forbidden resources in
 *   `attempts[*].denied`. A regex absence is no longer proof.
 * - `receipt` is the boundary's per-invocation hash + canary tags + provider identity; the
 *   verifier hashes this against the persisted evidence so an audit can re-derive the
 *   boundary state from the persisted bytes.
 *
 * The local override `--allow-unisolated-local` exists for development only and NEVER counts
 * for release. `release` executionMode disables it entirely (the orchestrator refuses to
 * pass `allowUnisolated: true` when the run is a release run).
 */
export async function realIsolationProbe({ adapter, probeInfo, workDir, run, secrets, deps }) {
  if (deps.allowUnisolated) {
    return {
      isolated: false,
      attemptCompleted: true,
      attempts: [],
      detail: "isolation NOT enforced (explicit local override); this runner explicitly marks isolated:false so it cannot count for release",
      allowedByLocalOverride: true
    };
  }

  // Allocate disposable canaries under a per-run /tmp dir. These are the files the probe asks
  // the agent to attempt to read; if any canary tag leaks into stdout/stderr, isolation failed.
  const canaries = deps.canaries ?? allocateProbeCanaries();
  // Build the per-invocation SBPL profile + the allow/deny lists. A `null` provider (Linux,
  // unsupported host) returns `{ provider: null }` and makes the runner BLOCK instead of
  // pretending isolation exists.
  // Build the per-invocation SBPL profile + the allow/deny lists. A `null` provider (Linux,
  // unsupported host) returns `{ provider: null }` and makes the runner BLOCK instead of
  // pretending isolation exists. The MCP host comes from the registered instance, NOT a
  // hardcoded 127.0.0.1 — an external registered target must keep its identity intact so the
  // B1 external target path can still hit the MCP.
  const mcpHost = run.instance.host ?? "127.0.0.1";
  // The client binary must be executable INSIDE the boundary. `denyHome` locks $HOME (to keep
  // OS private credentials out of reach), which also covers the usual install locations of the
  // clients this runner drives. Without re-allowing the RESOLVED binary, sandbox-exec refuses
  // to exec it ("execvp() ... Operation not permitted"), the client never starts, and the probe
  // mis-reads its own exec failure as "the client reached the resource" — a false isolation
  // breach that also blocks every official question (0 model calls).
  const clientBinary = probeInfo?.binaryPath ?? null;
  deps.clientBinaries = [...new Set([...(deps.clientBinaries ?? []), clientBinary].filter(Boolean))];
  const bundle = buildBoundaryBundle({
    run,
    canaries,
    provider: deps.provider,
    mcpHost,
    mcpPort: run.instance.proxyPort,
    clientBinaries: deps.clientBinaries
  });
  if (!bundle.provider) {
    return {
      isolated: false,
      attemptCompleted: false,
      attempts: [],
      detail: `no enforced isolation boundary on this host (provider=${deps.provider?.provider ?? "null"}); the runner fails closed instead of fake-isolating`,
      unsupportedHost: true,
      providerReason: deps.provider?.reason ?? null
    };
  }
  // A non-localhost MCP host cannot be enforced at the SBPL level (macOS sandbox-exec only
  // accepts `localhost:port` / `*:port`; `*:port` admits any host and is a laundering path).
  // We record the gap and require an explicit release-time override to claim isolation; the
  // release orchestrator must refuse to pass the gap without a separate kernel-level network
  // policy provider.
  if (bundle.networkEgressGap && !deps.allowUnisolated) {
    return {
      isolated: false,
      attemptCompleted: false,
      attempts: [],
      detail: `isolation boundary cannot enforce MCP egress to non-localhost host=${mcpHost}: ${bundle.networkEgressGap}; the runner fails closed on remote-MCP runs because macOS sandbox-exec admits only localhost:port literals`,
      networkEgressGap: bundle.networkEgressGap,
      mcpHost,
      providerReason: deps.provider?.reason ?? null
    };
  }
  const probe = await probeIsolation({
    adapter,
    probeInfo,
    workDir,
    run,
    secrets,
    deps: { ...deps, envAllowMatcher: buildEnvAllowMatcher() },
    provider: bundle.provider,
    profileString: bundle.profileString,
    canaries,
    // Propagate the deps.boundaryRun so the probe uses the SAME native runner the official
    // asks use. In production this is the sandbox-exec wrapper; in tests it's a stub. Without
    // this, the probe would call runUnderBoundary directly and the official asks would call
    // deps.boundaryRun — the boundary receipts wouldn't be aligned.
    runner: deps.boundaryRun
  });
  const receipt = boundaryReceipt({
    run,
    provider: bundle.provider,
    profileString: bundle.profileString,
    canaries,
    allow: bundle.allow,
    deny: bundle.deny,
    mcpPorts: bundle.mcpPorts,
    sidecarPort: bundle.sidecarPort,
    mcpHost: bundle.mcpHost,
    mcpHostIsLocal: bundle.mcpHostIsLocal,
    networkEgressGap: bundle.networkEgressGap
  });
  return { ...probe, receipt };
}

async function main() {
  const args = parseArgv(process.argv.slice(2), {
    run: "value",
    clients: "value",
    "allow-unisolated-local": "boolean",
    external: "boolean"
  });
  if (!args.run) fail("run-agent-journey: --run <run.json> is required", 1);
  const run = loadRun(args.run);
  const clientsDoc = parse(readFileSync(path.resolve(REPO_ROOT, args.clients ?? "docs/qa/real-e2e-clients.yaml"), "utf8"));
  if (countDistinctAutomatedProducts(clientsDoc.clients) < 2) fail("run-agent-journey: at least two distinct automated required products are needed (Hermes profiles count once)", 1);
  if (args["allow-unisolated-local"] && run.executionMode === "release") fail("run-agent-journey: the isolation override is not allowed for release runs", 1);
  const { cases } = loadCatalog();
  const goldDoc = JSON.parse(readFileSync(path.join(run.paths.checker, "gold.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
  const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
  const secrets = [...Object.values(tokens), admins.owner.password, admins.operator.password, readFileSync(path.join(run.secretsDir, "bootstrap-token"), "utf8").trim()];
  const adapters = await loadAdapters(clientsDoc);
  const capabilities = new Set(["lucy-http"]);
  if (run.db?.applied) capabilities.add("postgres");
  for (const extra of (process.env.LUCY_REAL_E2E_CAPABILITIES ?? "").split(",")) if (extra.trim()) capabilities.add(extra.trim());
  const profile = parse(readFileSync(path.join(REPO_ROOT, "scripts/e2e/profiles/customer-release.yaml"), "utf8"));
  const timeoutMs = profile.limits.maxAgentCaseWallClockSeconds * 1000;

  // A5: detect the actual isolation provider on this host. The probe is REAL: it asks the
  // OS for `/usr/bin/sandbox-exec -h` and refuses to fake-isolate when absent. The
  // `provider` flows into isolationProbe (for the probe) and boundaryRun (for every
  // official ask) so the runner fails closed on a host without `sandbox-exec`.
  const providerResult = await detectIsolationProvider({ spawnSync });
  const provider = providerResult.provider ? { provider: providerResult.provider, binary: providerResult.binary, reason: providerResult.reason ?? null } : { provider: null, binary: null, reason: providerResult.reason };
  // Allocate the disposable canary bundle ONCE per run; the same bundle binds the probe and
  // the official asks (so a break-between-probe-and-official would show up as a receipt diff).
  const canaries = allocateProbeCanaries();

  const deps = {
    env: { ...process.env }, now: () => Date.now(), capabilities, timeoutMs, maxModelCalls: profile.limits.maxModelCallsPerCandidateRun,
    runProcess, spawnSync, locate: locateBinary, allowUnisolated: args["allow-unisolated-local"] === true,
    collect: collectServerEvidence, ledger: undefined,
    bounds: { stdout: 1_000_000, stderr: 256_000 },
    provider, canaries,
    envAllowMatcher: buildEnvAllowMatcher(),
    boundaryRun: (input) => {
      if (!provider.provider) return { completed: false, reason: "unsupported_provider", exitCode: null, stdout: "", stderr: "", timedOut: false };
      const mcpHost = run.instance.host ?? "127.0.0.1";
      const bundle = buildBoundaryBundle({
        run,
        canaries,
        provider,
        mcpHost,
        mcpPort: run.instance.proxyPort,
        // Same client binaries the isolation probe registered — the official asks must run
        // under the SAME boundary the probe proved.
        clientBinaries: deps.clientBinaries ?? []
      });
      // The boundary runner is the only native runner the agent journey uses in production.
      const sanitized = sanitizeEnv(input.env, deps.envAllowMatcher, { token: input.env?.[TOKEN_ENV], clientHome: input.cwd, clientWork: input.cwd });
      return runUnderBoundaryLocal({ provider, profileString: bundle.profileString, command: input.command, args: input.args, cwd: input.cwd, env: sanitized, timeoutMs: input.timeoutMs, bounds: input.bounds });
    }
  };
  deps.isolationProbe = (input) => realIsolationProbe({ ...input, deps });

  // Local runs own the Lucy process (same contract as run-management / run-security). The --external
  // flag MUST agree with run.instance.startedBy: a registered external target that does not get the
  // flag would accidentally start a local Lucy child and silently target the wrong deployment; a
  // local run with --external would skip the process the runner is supposed to own. Derive and
  // refuse the contradiction (Spec §6.5 / §8.3).
  const externalCheck = reconcileExternalFlag({ run, flagValue: args.external === true });
  if (!externalCheck.ok) fail(`run-agent-journey: ${externalCheck.problems.join("; ")}`, 1);

  // Local runs own the Lucy process (same contract as run-management / run-security). External
  // runs construct an ExternalInstance whose preflight runs FIRST (no auth, no bootstrap), then
  // the orchestrator's bootstrap step (when in `required` mode) lets postflight log in and read
  // the run-scoped marker. A failed preflight, a missing deployment.json, or a needs-bootstrap
  // postflight blocks the run — the agent journey never sees a wrong/missing target.
  let lucy = null;
  let exitCode = 1;
  try {
    mkdirSync(run.paths.logs, { recursive: true });
    if (args.external) {
      lucy = new ExternalInstance(run);
      progressLog(run, "external target: running preflight (no auth, no bootstrap)");
      try {
        await lucy.start();
      } catch (error) {
        if (error instanceof TargetIdentityError) {
          const blocked = error.classification === "missing_measurement" || (error.stage === "postflight" && error.aspects?.ownerLogin?.classification === "missing_measurement");
          const code = blocked ? EXIT_CODES.blocked : EXIT_CODES.failed;
          fail(`run-agent-journey: target verification refused: ${error.message} (stage=${error.stage} classification=${error.classification})`, code);
        }
        throw error;
      }
      progressLog(run, "external target verified (preflight + postflight)");
    } else {
      lucy = new LucyProcess(run);
      await lucy.start();
      progressLog(run, "lucy started; ensuring owner bootstrap");
      await ensureOwnerBootstrapped(run);
      progressLog(run, "owner bootstrap ready");
    }
    const result = await runAgentJourney({ run, cases, goldDoc, clientsDoc, adapters, tokens, secrets, deps });

    const dir = path.join(run.paths.runDir, "results", "agent");
    mkdirSync(dir, { recursive: true });
    for (const entry of result.entries) {
      const body = `${JSON.stringify({ id: entry.id, client: entry.client, run: entry.run, status: entry.status, detail: entry.detail, assertions: entry.assertions, transcript: entry.transcript ?? [] }, null, 2)}\n`;
      if (scanText(body, { secrets }).length > 0) fail(`run-agent-journey: refusing to write ${entry.id}: credential found in transcript`, 1);
      const file = path.join(dir, `${entry.id}@${entry.client}#${entry.run}.json`);
      writeFileSync(file, body);
      entry.artifacts = [{ path: path.relative(run.paths.runDir, file), sha256: createHash("sha256").update(body).digest("hex") }];
      delete entry.transcript;
    }
    const serverEvidence = writeServerEvidenceFile(run, result.serverEvidenceCases);
    const evidence = {
      contract: "lucy-agent-run-v1", runId: run.runId, executionMode: run.executionMode, startedAt: result.startedAt, finishedAt: new Date().toISOString(),
      caseCatalogDigest: run.caseCatalogDigest, clients: result.clientInfo,
      isolation: deps.allowUnisolated ? "not_enforced_local_override" : "probed",
      isolationProvider: deps.provider?.provider ?? null,
      isolationProviderReason: deps.provider?.reason ?? null,
      serverEvidence, modelCalls: result.modelCalls, summary: result.summary, status: result.status, cases: result.entries
    };
    const out = path.join(run.paths.runDir, "results", "agent.json");
    writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
    exitCode = EXIT_CODES[result.status];
    process.stdout.write(`${JSON.stringify({ status: result.status, exitCode, out, summary: result.summary, clients: result.clientInfo.map((c) => ({ product: c.product, probe: c.probe, reasons: c.reasons })) })}\n`);
  } finally {
    if (lucy) await lucy.stop("SIGTERM");
  }
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => fail(`run-agent-journey: ${error instanceof Error ? error.message : String(error)}`, 1));
}
