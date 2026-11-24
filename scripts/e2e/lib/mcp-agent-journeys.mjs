/**
 * P1-53 Task 3 — real Agent multi-turn journey runner (D25).
 * Consumes docs/qa/mcp-compat-clients.yaml (pool, not all-must-run).
 * Detect → single-select → sticky clientFingerprint/modelFingerprint across PRE/POST.
 * Direct MCP / HTTP scripts never count toward the Agent denominator.
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md D9/D13/D16a/D25
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 3
 *
 * B1 imports: `detectCompatClients`, `runAgentJourneys` (and fingerprint helpers).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync as defaultSpawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

import { TOKEN_ENV, locateBinary, validateAdapter } from "../adapters/_contract.mjs";
import { REPO_ROOT } from "./common.mjs";
import {
  AGENT_MIN_SAMPLES,
  AGENT_TURN_WALL_CLOCK_LIMIT_MS,
  loadJourneySuite
} from "./mcp-compatibility.mjs";

export const DEFAULT_COMPAT_CLIENTS_PATH = path.join(REPO_ROOT, "docs", "qa", "mcp-compat-clients.yaml");

/** Ids / transports that must never enter the Agent denominator. */
const DIRECT_MCP_ID_RE = /^(direct[-_]?mcp|mcp[-_]?(http|script|client)|curl|http[-_]?script)$/i;

/**
 * @param {string|object} [source]
 * @returns {{ version: number, candidates: object[] }}
 */
export function loadCompatClients(source = DEFAULT_COMPAT_CLIENTS_PATH) {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return structuredClone(source);
  }
  const file = typeof source === "string" && source.trim()
    ? (path.isAbsolute(source) ? source : path.resolve(REPO_ROOT, source))
    : DEFAULT_COMPAT_CLIENTS_PATH;
  if (!existsSync(file)) {
    throw new Error(`mcp-compat-clients not found: ${file}`);
  }
  const doc = parse(readFileSync(file, "utf8"));
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.candidates)) {
    throw new Error(`mcp-compat-clients invalid or missing candidates: ${file}`);
  }
  return doc;
}

/**
 * @param {object} candidate
 * @param {object|null} probe
 */
export function buildClientFingerprint(candidate, probe = null) {
  const id = candidate?.id ?? "unknown";
  const adapter = candidate?.adapter ?? "";
  const version = probe?.version ?? probe?.binaryVersion ?? "unknown";
  return `client:${id}|adapter:${adapter}|version:${version}`;
}

/**
 * @param {object|null} probe
 * @param {string} [modelOverride]
 */
export function buildModelFingerprint(probe = null, modelOverride) {
  const model = modelOverride ?? probe?.model ?? "default";
  return `model:${model}`;
}

/**
 * True when the candidate / adapter / surface is a direct-MCP masquerade.
 * @param {{ id?: string, transport?: string, surface?: string, executionSurface?: string }} candidate
 * @param {{ transport?: string }|null} [adapter]
 */
export function isDirectMcpMasquerade(candidate, adapter = null) {
  const id = String(candidate?.id ?? "");
  if (DIRECT_MCP_ID_RE.test(id)) return true;
  const surface = candidate?.surface ?? candidate?.executionSurface ?? "";
  if (/^direct[-_]?mcp$/i.test(String(surface)) || String(surface).toLowerCase() === "mcp") {
    return true;
  }
  const transport = adapter?.transport ?? candidate?.transport;
  if (transport === "http" || transport === "raw-http") return true;
  return false;
}

function resolveAdapterPath(adapterField) {
  if (!adapterField || typeof adapterField !== "string") return null;
  return path.isAbsolute(adapterField) ? adapterField : path.resolve(REPO_ROOT, adapterField);
}

async function defaultLoadAdapterModule(adapterField, importFn) {
  const file = resolveAdapterPath(adapterField);
  if (!file || !existsSync(file)) {
    throw new Error(`adapter file missing: ${adapterField ?? "(none)"}`);
  }
  const mod = await importFn(pathToFileURL(file).href);
  const problems = validateAdapter(mod);
  if (problems.length > 0) {
    throw new Error(`adapter contract failed: ${problems.join("; ")}`);
  }
  return { mod, file, digest: `sha256:${createHash("sha256").update(readFileSync(file)).digest("hex")}` };
}

function defaultRunDetect(detectCmd, { spawnSync = defaultSpawnSync, shell = true } = {}) {
  if (!detectCmd || typeof detectCmd !== "string") {
    return { ok: false, detail: "missing detect command" };
  }
  const result = spawnSync(detectCmd, {
    encoding: "utf8",
    shell,
    timeout: 20_000,
    env: process.env
  });
  if (result.error) {
    return { ok: false, detail: result.error.message ?? String(result.error) };
  }
  if (result.status !== 0) {
    return { ok: false, detail: `exit ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 200)}` };
  }
  return { ok: true, detail: (result.stdout || "").trim().slice(0, 200) };
}

/**
 * Detect ready candidates from the pool. Does not select — operator / CI picks one.
 *
 * @param {object} [options]
 * @returns {Promise<{
 *   version: number,
 *   candidates: object[],
 *   ready: object[]
 * }>}
 */
export async function detectCompatClients(options = {}) {
  const {
    clientsPath = DEFAULT_COMPAT_CLIENTS_PATH,
    clientsDoc = null,
    env = process.env,
    deps = {}
  } = options;

  const doc = clientsDoc ?? loadCompatClients(clientsPath);
  const importFn = deps.importModule ?? ((href) => import(href));
  const runDetect = deps.runDetect ?? ((c) => defaultRunDetect(c.detect, deps));
  const loadAdapter = deps.loadAdapter ?? ((c) => defaultLoadAdapterModule(c.adapter, importFn));
  const spawnSync = deps.spawnSync ?? defaultSpawnSync;
  const locate = deps.locate ?? locateBinary;

  const results = [];
  for (const candidate of doc.candidates ?? []) {
    const reasons = [];

    if (isDirectMcpMasquerade(candidate)) {
      reasons.push("direct_mcp_not_agent_denominator");
    }
    if (candidate.multiTurn !== true) {
      reasons.push("multi_turn_unsupported");
    }
    if (!candidate.adapter) {
      reasons.push("adapter_missing");
    }

    const detect = runDetect(candidate);
    if (!detect.ok) {
      reasons.push(`detect_failed: ${detect.detail}`);
    }

    let loaded = null;
    let probe = null;
    if (candidate.adapter && !reasons.includes("direct_mcp_not_agent_denominator")) {
      try {
        loaded = await loadAdapter(candidate);
        if (isDirectMcpMasquerade(candidate, loaded.mod)) {
          reasons.push("direct_mcp_not_agent_denominator");
        }
        probe = loaded.mod.probe({
          env,
          spawnSync,
          locate
        });
        if (probe.status !== "ready") {
          for (const r of probe.reasons ?? ["auth_or_binary_blocked"]) {
            reasons.push(r);
          }
        }
      } catch (error) {
        reasons.push(`adapter_load_failed: ${error?.message ?? String(error)}`);
      }
    }

    const ready = reasons.length === 0;
    const clientFingerprint = ready ? buildClientFingerprint(candidate, probe) : null;
    const modelFingerprint = ready ? buildModelFingerprint(probe) : null;

    results.push({
      id: candidate.id,
      candidate,
      status: ready ? "ready" : "blocked",
      reasons,
      reselect: !ready,
      detect,
      probe,
      adapter: loaded,
      clientFingerprint,
      modelFingerprint,
      authHint: candidate.authHint ?? null
    });
  }

  return {
    version: doc.version ?? 1,
    candidates: results,
    ready: results.filter((r) => r.status === "ready")
  };
}

/**
 * Select exactly one ready candidate. Missing / blocked / direct-MCP ⇒ reselect or BLOCKED.
 *
 * @param {object} detection — result of detectCompatClients
 * @param {string|null} selectedClientId
 * @returns {{ ok: true, selected: object } | { ok: false, status: "BLOCKED", reasons: string[], readyCandidates: string[], reselect: true }}
 */
export function selectCompatClient(detection, selectedClientId) {
  const ready = detection?.ready ?? [];
  const readyIds = ready.map((r) => r.id);

  if (!selectedClientId) {
    return {
      ok: false,
      status: "BLOCKED",
      reasons: ["no client selected; reselect from ready candidates"],
      readyCandidates: readyIds,
      reselect: true
    };
  }

  if (isDirectMcpMasquerade({ id: selectedClientId })) {
    return {
      ok: false,
      status: "BLOCKED",
      reasons: ["direct MCP / HTTP script must never count as Agent denominator"],
      readyCandidates: readyIds,
      reselect: true
    };
  }

  const selected = ready.find((r) => r.id === selectedClientId);
  if (selected) {
    return { ok: true, selected };
  }

  const all = detection?.candidates ?? [];
  const blocked = all.find((r) => r.id === selectedClientId);
  const reasons = blocked
    ? [
        `selected client "${selectedClientId}" is not ready`,
        ...(blocked.reasons ?? [])
      ]
    : [`selected client "${selectedClientId}" is not in the compat candidate pool`];

  return {
    ok: false,
    status: "BLOCKED",
    reasons,
    readyCandidates: readyIds,
    reselect: true
  };
}

/**
 * Assert PRE/POST (or mid-suite) fingerprints stay sticky.
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function assertFingerprintsSticky(current, sticky) {
  if (!sticky) return { ok: true };
  const reasons = [];
  if (
    sticky.clientFingerprint != null &&
    current.clientFingerprint != null &&
    sticky.clientFingerprint !== current.clientFingerprint
  ) {
    reasons.push(
      `clientFingerprint switched (${sticky.clientFingerprint} → ${current.clientFingerprint}); PRE/POST must stay sticky`
    );
  }
  if (
    sticky.modelFingerprint != null &&
    current.modelFingerprint != null &&
    sticky.modelFingerprint !== current.modelFingerprint
  ) {
    reasons.push(
      `modelFingerprint switched (${sticky.modelFingerprint} → ${current.modelFingerprint}); PRE/POST must stay sticky`
    );
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

function defaultNow() {
  return Date.now();
}

/**
 * Default turn runner: adapter prepare → buildInvocation → process → parseResult.
 * Injectable via deps.runTurn for unit tests.
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
  runProcess
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
  const result = await runProcess({
    ...invocation,
    env: { ...invocation.env, [TOKEN_ENV]: token, ...(env ?? {}) },
    timeoutMs
  });
  let lastMessage = "";
  if (prepared.lastMessageFile) {
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
  return {
    ok: Boolean(result.completed !== false && parsed.ok),
    finalAnswer: parsed.finalAnswer ?? "",
    sessionId: parsed.sessionId ?? null,
    model: parsed.model ?? probeInfo.model ?? "default",
    exitCode: result.exitCode,
    timedOut: Boolean(result.timedOut),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

function defaultRunProcess({ command, args, cwd, env, timeoutMs }) {
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
    let timedOut = false;
    const timer = setTimeout(() => {
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
    }, Math.max(1_000, timeoutMs ?? 30_000));
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
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

function caseNeedsAgent(c) {
  return Array.isArray(c?.turns) && c.turns.length > 0;
}

/**
 * Bounded parallel map. Order of `items` is preserved in the result array.
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapPool(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length || 1));
  /** @type {R[]} */
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= list.length) return;
      results[index] = await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results;
}

/** Resolve Agent attempt concurrency (Spec allows parallel cases; sameSession turns stay serial). */
export function resolveAgentConcurrency(options = {}, env = process.env) {
  const raw =
    options.concurrency ??
    options.agentConcurrency ??
    env.LUCY_MCP_COMPAT_AGENT_CONCURRENCY ??
    env.COMPAT_AGENT_CONCURRENCY ??
    1;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 32);
}

/**
 * Run Agent multi-turn journeys for the selected compat client.
 *
 * @param {object} options
 * @param {object|string} options.suite — journey suite object or path
 * @param {string} options.selectedClientId — single selection (CI preset or operator)
 * @param {{ clientFingerprint: string, modelFingerprint: string }|null} [options.stickyFingerprints] — PRE fingerprints; mismatch ⇒ BLOCKED
 * @param {string} [options.mcpUrl]
 * @param {string} [options.token]
 * @param {string} [options.workDir]
 * @param {object} [options.env]
 * @param {number} [options.attemptsPerCase] — default AGENT_MIN_SAMPLES (3); all retained
 * @param {number} [options.concurrency] — parallel independent case×attempt jobs (sameSession turns stay serial)
 * @param {string[]} [options.caseIds] — optional subset; default all cases with turns
 * @param {object} [options.deps] — injectable: detection, runTurn, now, loadAdapter, …
 * @returns {Promise<object>}
 */
export async function runAgentJourneys(options = {}) {
  const {
    suite: suiteSource,
    selectedClientId = null,
    stickyFingerprints = null,
    mcpUrl = "http://127.0.0.1:7879/mcp",
    token = "",
    workDir = null,
    env = process.env,
    attemptsPerCase = AGENT_MIN_SAMPLES,
    caseIds = null,
    clientsPath = DEFAULT_COMPAT_CLIENTS_PATH,
    clientsDoc = null,
    secrets = [],
    timeoutMs = 180_000,
    deps = {}
  } = options;
  const concurrency = resolveAgentConcurrency(options, env);

  const now = deps.now ?? defaultNow;
  const reasons = [];

  if (options.executionSurface === "direct-mcp" || options.denominator === "mcp") {
    return {
      status: "BLOCKED",
      reasons: ["direct MCP must never count as Agent denominator (D2/D25)"],
      clientFingerprint: null,
      modelFingerprint: null,
      selectedClientId: selectedClientId ?? null,
      attempts: [],
      agentTurns: [],
      readyCandidates: [],
      reselect: true
    };
  }

  const detection =
    deps.detection ??
    (await detectCompatClients({
      clientsPath,
      clientsDoc,
      env,
      deps
    }));

  const selection = selectCompatClient(detection, selectedClientId);
  if (!selection.ok) {
    return {
      status: "BLOCKED",
      reasons: selection.reasons,
      clientFingerprint: null,
      modelFingerprint: null,
      selectedClientId: selectedClientId ?? null,
      attempts: [],
      agentTurns: [],
      readyCandidates: selection.readyCandidates,
      reselect: true
    };
  }

  const selected = selection.selected;
  const clientFingerprint = selected.clientFingerprint;
  const modelFingerprint = selected.modelFingerprint;

  const sticky = assertFingerprintsSticky(
    { clientFingerprint, modelFingerprint },
    stickyFingerprints
  );
  if (!sticky.ok) {
    return {
      status: "BLOCKED",
      reasons: sticky.reasons,
      clientFingerprint,
      modelFingerprint,
      selectedClientId: selected.id,
      attempts: [],
      agentTurns: [],
      readyCandidates: detection.ready.map((r) => r.id),
      reselect: false
    };
  }

  // Mid-suite switch: caller may pass switchedSelectedClientId to simulate / enforce.
  if (
    options.switchedSelectedClientId &&
    options.switchedSelectedClientId !== selected.id
  ) {
    return {
      status: "BLOCKED",
      reasons: [
        `client switch mid-suite (${selected.id} → ${options.switchedSelectedClientId}) is BLOCKED (D25)`
      ],
      clientFingerprint,
      modelFingerprint,
      selectedClientId: selected.id,
      attempts: [],
      agentTurns: [],
      readyCandidates: detection.ready.map((r) => r.id),
      reselect: false
    };
  }

  const suite = typeof suiteSource === "string" || suiteSource == null
    ? loadJourneySuite(suiteSource)
    : suiteSource;
  const allCases = Array.isArray(suite?.cases) ? suite.cases.filter(caseNeedsAgent) : [];
  const cases =
    Array.isArray(caseIds) && caseIds.length > 0
      ? allCases.filter((c) => caseIds.includes(c.id))
      : allCases;

  if (cases.length === 0) {
    return {
      status: "BLOCKED",
      reasons: ["no agent journey cases with turns"],
      clientFingerprint,
      modelFingerprint,
      selectedClientId: selected.id,
      attempts: [],
      agentTurns: [],
      readyCandidates: detection.ready.map((r) => r.id),
      reselect: false
    };
  }

  const adapterBundle = selected.adapter;
  const adapterMod = adapterBundle?.mod ?? deps.adapterMod;
  const probeInfo = selected.probe ?? deps.probeInfo;
  if (!adapterMod || !probeInfo) {
    return {
      status: "BLOCKED",
      reasons: ["selected client has no loaded adapter/probe"],
      clientFingerprint,
      modelFingerprint,
      selectedClientId: selected.id,
      attempts: [],
      agentTurns: [],
      readyCandidates: detection.ready.map((r) => r.id),
      reselect: true
    };
  }

  const baseWorkDir = workDir ?? path.join(REPO_ROOT, "inbox", "e2e", "mcp-agent", selected.id);
  mkdirSync(baseWorkDir, { recursive: true });

  const runTurn =
    deps.runTurn ??
    ((args) =>
      defaultRunTurn({
        ...args,
        runProcess: deps.runProcess ?? defaultRunProcess
      }));

  /** @type {object[]} */
  const attempts = [];
  /** Flattened turn samples for threeAxis agentLatency (all retained). */
  const agentTurns = [];

  /** @type {{ testCase: object, attempt: number, sameSession: boolean, turns: object[] }[]} */
  const jobs = [];
  for (const testCase of cases) {
    const sameSession = testCase.agentRequirements?.sameSession === true;
    const turns = testCase.turns ?? [];

    if (sameSession && turns.length > 1 && selected.candidate?.multiTurn !== true) {
      reasons.push(`case ${testCase.id} requires multi-turn but client lacks multiTurn`);
      for (let attempt = 1; attempt <= attemptsPerCase; attempt += 1) {
        attempts.push({
          caseId: testCase.id,
          attempt,
          status: "blocked",
          reason: "multi_turn_unsupported",
          clientFingerprint,
          modelFingerprint,
          sameSession,
          turns: []
        });
      }
      continue;
    }

    for (let attempt = 1; attempt <= attemptsPerCase; attempt += 1) {
      jobs.push({ testCase, attempt, sameSession, turns });
    }
  }

  /**
   * One case×attempt job. Turns inside sameSession stay serial; jobs themselves may run in parallel.
   */
  async function runAttemptJob(job) {
    const { testCase, attempt, sameSession, turns } = job;
    const attemptWorkDir = path.join(baseWorkDir, testCase.id, `attempt-${attempt}`);
    mkdirSync(attemptWorkDir, { recursive: true });
    let sessionId = null;
    const turnRecords = [];
    /** @type {object[]} */
    const jobAgentTurns = [];
    let attemptStatus = "passed";
    let attemptReason = null;
    let modelSwitchTo = null;

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
      const turnText = turns[turnIndex]?.text ?? "";
      const continueSession = sameSession && turnIndex > 0 && Boolean(sessionId);
      const startedMs = now();
      let turnResult;
      try {
        turnResult = await runTurn({
          adapterMod,
          probeInfo,
          question: turnText,
          workDir: attemptWorkDir,
          mcpUrl,
          token,
          env,
          secrets,
          sessionId,
          continueSession,
          timeoutMs,
          caseId: testCase.id,
          attempt,
          turnIndex
        });
      } catch (error) {
        turnResult = {
          ok: false,
          finalAnswer: "",
          sessionId,
          model: probeInfo.model ?? "default",
          error: error?.message ?? String(error)
        };
      }
      const finishedMs = now();
      const turnWallClockMs = Math.max(0, finishedMs - startedMs);

      const observedModelFp = buildModelFingerprint(
        { model: turnResult.model ?? probeInfo.model },
        turnResult.modelFingerprint
      );
      if (observedModelFp !== modelFingerprint && turnResult.model) {
        modelSwitchTo = observedModelFp;
        attemptStatus = "blocked";
        attemptReason = "model_fingerprint_switched";
        break;
      }

      if (turnResult.sessionId) {
        sessionId = turnResult.sessionId;
      }

      const turnRecord = {
        turnIndex,
        text: turnText,
        turnWallClockMs,
        sessionId: turnResult.sessionId ?? sessionId,
        finalAnswer: turnResult.finalAnswer ?? "",
        ok: Boolean(turnResult.ok),
        timedOut: Boolean(turnResult.timedOut),
        exitCode: turnResult.exitCode ?? null,
        model: turnResult.model ?? null
      };
      turnRecords.push(turnRecord);
      jobAgentTurns.push({
        caseId: testCase.id,
        attempt,
        turnIndex,
        turnWallClockMs,
        clientFingerprint,
        modelFingerprint,
        sessionId: turnRecord.sessionId
      });

      if (turnWallClockMs > AGENT_TURN_WALL_CLOCK_LIMIT_MS) {
        attemptStatus = "failed";
        attemptReason = `turnWallClockMs ${turnWallClockMs} > ${AGENT_TURN_WALL_CLOCK_LIMIT_MS}`;
      } else if (!turnResult.ok && attemptStatus === "passed") {
        attemptStatus = "failed";
        attemptReason = turnResult.error ?? `turn ${turnIndex} failed`;
      }

      if (sameSession && turnIndex > 0) {
        const firstSession = turnRecords[0]?.sessionId;
        if (firstSession && turnRecord.sessionId && firstSession !== turnRecord.sessionId) {
          attemptStatus = "failed";
          attemptReason = "sameSession broken: sessionId changed across turns";
        }
      }
    }

    return {
      modelSwitchTo,
      attemptRecord: {
        caseId: testCase.id,
        attempt,
        status: attemptStatus,
        reason: attemptReason,
        clientFingerprint,
        modelFingerprint,
        sameSession,
        sessionId,
        turns: turnRecords
      },
      jobAgentTurns
    };
  }

  const jobResults = await mapPool(jobs, concurrency, runAttemptJob);
  for (const result of jobResults) {
    if (!result) continue;
    if (result.modelSwitchTo) {
      return {
        status: "BLOCKED",
        reasons: [
          `modelFingerprint switched mid-suite (${modelFingerprint} → ${result.modelSwitchTo})`
        ],
        clientFingerprint,
        modelFingerprint,
        selectedClientId: selected.id,
        attempts: [...attempts, result.attemptRecord],
        agentTurns: [...agentTurns, ...result.jobAgentTurns],
        readyCandidates: detection.ready.map((r) => r.id),
        reselect: false,
        concurrency
      };
    }
    attempts.push(result.attemptRecord);
    agentTurns.push(...result.jobAgentTurns);
  }

  const blockedAttempts = attempts.filter((a) => a.status === "blocked");
  const failedAttempts = attempts.filter((a) => a.status === "failed");
  let status = "PASS";
  if (reasons.length || blockedAttempts.length > 0) {
    status = "BLOCKED";
    for (const a of blockedAttempts) {
      if (a.reason) reasons.push(`${a.caseId}#${a.attempt}: ${a.reason}`);
    }
  } else if (failedAttempts.length > 0) {
    status = "FAIL";
    for (const a of failedAttempts) {
      if (a.reason) reasons.push(`${a.caseId}#${a.attempt}: ${a.reason}`);
    }
  }

  // D13: retain every attempt; sample count for latency judge is agentTurns length.
  if (agentTurns.length < AGENT_MIN_SAMPLES && status === "PASS") {
    status = "BLOCKED";
    reasons.push(`agent samples ${agentTurns.length} < ${AGENT_MIN_SAMPLES}`);
  }

  return {
    status,
    reasons,
    clientFingerprint,
    modelFingerprint,
    selectedClientId: selected.id,
    selectedClient: {
      id: selected.id,
      adapter: selected.candidate?.adapter ?? null,
      multiTurn: selected.candidate?.multiTurn === true,
      version: selected.probe?.version ?? null,
      model: selected.probe?.model ?? null
    },
    attempts,
    agentTurns,
    concurrency,
    readyCandidates: detection.ready.map((r) => r.id),
    reselect: false,
    /** Shape ready for threeAxis({ agent: { turns } }). */
    agentLatencyInput: {
      turns: agentTurns.map((t) => ({ turnWallClockMs: t.turnWallClockMs }))
    }
  };
}
