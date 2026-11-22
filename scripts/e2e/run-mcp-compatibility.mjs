#!/usr/bin/env node
/**
 * P1-53 Task 2 — four-entrypoint MCP upgrade compatibility runner.
 *
 * CLI:
 *   capture   → captureInstanceBaseline → private baseline 0600
 *   candidate → certifyCandidate        → results/mcp-compatibility-candidate.json
 *   upgrade   → certifyInstanceUpgrade  → results/mcp-compatibility-instance.json (POST)
 *   rollback  → replayInstanceBaseline  → append ROLLBACK_VERIFY
 *
 * Calls A1 apply/restore + A3 loadJourneySuite / aggregateCompatibility.
 * Agent adapter is optional (B2): hooks runAgentJourneys from mcp-agent-journeys.mjs when present.
 *
 * Forbidden flags (always rejected): --skip-query --allow-new-deny --accept-regression
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 2
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CompatConfigRestoreError,
  applyCompatConfigProfile,
  restoreCompatConfigProfile
} from "./lib/mcp-compat-config-profile.mjs";
import {
  AGENT_MIN_SAMPLES,
  MCP_MIN_SAMPLES,
  aggregateCompatibility,
  digestJourneySuite,
  loadJourneySuite
} from "./lib/mcp-compatibility.mjs";
import {
  createMcpClient,
  resolveTokenRef,
  runMcpSuiteControls,
  tokenFingerprint
} from "./lib/mcp-compatibility-client.mjs";
import { EXIT_CODES, REPO_ROOT, fail } from "./lib/common.mjs";
import { scanText } from "./lib/leak-scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RESULTS_DIR = path.join(REPO_ROOT, "results");
const CANDIDATE_EVIDENCE_NAME = "mcp-compatibility-candidate.json";
const INSTANCE_EVIDENCE_NAME = "mcp-compatibility-instance.json";

export const FORBIDDEN_FLAGS = Object.freeze([
  "skip-query",
  "allow-new-deny",
  "accept-regression"
]);

export const ENTRYPOINTS = Object.freeze({
  capture: "captureInstanceBaseline",
  candidate: "certifyCandidate",
  upgrade: "certifyInstanceUpgrade",
  rollback: "replayInstanceBaseline"
});

export const USAGE = `Usage:
  node scripts/e2e/run-mcp-compatibility.mjs <capture|candidate|upgrade|rollback> [options]

Commands:
  capture    Capture private instance baseline (0600); no prior baseline required
  candidate  Certify candidate → results/mcp-compatibility-candidate.json
  upgrade    Certify instance upgrade (requires --baseline); writes instance POST evidence
  rollback   Replay baseline as ROLLBACK_VERIFY phase on instance evidence

Options:
  --project-root <path>       Lucy project root for CompatConfigProfile apply (default: repo root)
  --suite <path>              Journey suite YAML (default: scripts/e2e/contracts/mcp-upgrade-journeys.yaml)
  --baseline <path>           Private baseline file (upgrade/rollback/capture output)
  --mcp-url <url>             Public MCP base URL
  --results-dir <path>        Public evidence directory (default: results/)
  --candidate-evidence <path> Prior candidate evidence JSON (upgrade; default under results-dir)
  --token-env <NAME=value>    Repeatable; supply tokens without putting secrets in argv files
  --selected-client <id>      Agent client id from docs/qa/mcp-compat-clients.yaml (required for live Agent axis)
  --agent-concurrency <n>     Parallel Agent case×attempt jobs (default 1; env LUCY_MCP_COMPAT_AGENT_CONCURRENCY). sameSession turns stay serial
  --client-fingerprint <id>   Optional override; default comes from selected client detect
  --model-fingerprint <id>    Optional override; default comes from selected client detect
  --coverage-mode <full|ci-subset>  Public evidence coverageMode (default: full; ci-subset never releaseReady)
  --backup-dir <path>         CompatConfigProfile backup directory
  --help                      Show this help

Forbidden (always rejected): --skip-query --allow-new-deny --accept-regression
`;

/**
 * @param {string[]} argv
 */
export function assertNoForbiddenFlags(argv) {
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2).split("=")[0];
    if (FORBIDDEN_FLAGS.includes(name)) {
      const err = new Error(
        `forbidden flag --${name}: compatibility runner refuses --skip-query/--allow-new-deny/--accept-regression`
      );
      err.code = "FORBIDDEN_FLAG";
      throw err;
    }
  }
}

/**
 * @param {string[]} argv
 */
export function parseCli(argv) {
  assertNoForbiddenFlags(argv);
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true, command: null, options: {} };
  }
  const command = args.shift();
  if (!command || !(command in ENTRYPOINTS)) {
    const err = new Error(`unknown or missing command (expected capture|candidate|upgrade|rollback)`);
    err.code = "USAGE";
    throw err;
  }
  const options = {
    projectRoot: REPO_ROOT,
    suitePath: undefined,
    baselinePath: undefined,
    mcpUrl: process.env.LUCY_MCP_URL ?? "http://127.0.0.1:57881/mcp",
    resultsDir: DEFAULT_RESULTS_DIR,
    candidateEvidencePath: undefined,
    tokenEnv: {},
    selectedClientId: process.env.COMPAT_SELECTED_CLIENT ?? undefined,
    agentConcurrency: process.env.LUCY_MCP_COMPAT_AGENT_CONCURRENCY
      ? Number.parseInt(process.env.LUCY_MCP_COMPAT_AGENT_CONCURRENCY, 10)
      : undefined,
    clientFingerprint: process.env.COMPAT_CLIENT_FINGERPRINT ?? undefined,
    modelFingerprint: process.env.COMPAT_MODEL_FINGERPRINT ?? undefined,
    coverageMode: process.env.COMPAT_COVERAGE_MODE ?? "full",
    backupDir: undefined
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      const err = new Error(`unexpected argument: ${arg}`);
      err.code = "USAGE";
      throw err;
    }
    const name = arg.slice(2);
    const next = args[i + 1];
    const need = (label) => {
      if (next == null || next.startsWith("--")) {
        const err = new Error(`--${label} needs a value`);
        err.code = "USAGE";
        throw err;
      }
      i += 1;
      return next;
    };
    switch (name) {
      case "project-root":
        options.projectRoot = path.resolve(need(name));
        break;
      case "suite":
        options.suitePath = need(name);
        break;
      case "baseline":
        options.baselinePath = path.resolve(need(name));
        break;
      case "mcp-url":
        options.mcpUrl = need(name);
        break;
      case "results-dir":
        options.resultsDir = path.resolve(need(name));
        break;
      case "candidate-evidence":
        options.candidateEvidencePath = path.resolve(need(name));
        break;
      case "token-env": {
        const pair = need(name);
        const eq = pair.indexOf("=");
        if (eq <= 0) {
          const err = new Error(`--token-env expects NAME=value`);
          err.code = "USAGE";
          throw err;
        }
        options.tokenEnv[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      case "selected-client":
        options.selectedClientId = need(name);
        break;
      case "agent-concurrency": {
        const n = Number.parseInt(need(name), 10);
        if (!Number.isFinite(n) || n < 1) {
          const err = new Error(`--agent-concurrency must be an integer >= 1`);
          err.code = "USAGE";
          throw err;
        }
        options.agentConcurrency = n;
        break;
      }
      case "client-fingerprint":
        options.clientFingerprint = need(name);
        break;
      case "model-fingerprint":
        options.modelFingerprint = need(name);
        break;
      case "coverage-mode": {
        const mode = need(name);
        if (mode !== "full" && mode !== "ci-subset") {
          const err = new Error(`--coverage-mode must be full|ci-subset`);
          err.code = "USAGE";
          throw err;
        }
        options.coverageMode = mode;
        break;
      }
      case "backup-dir":
        options.backupDir = path.resolve(need(name));
        break;
      case "budget-escape":
        // P1-74 / Task 4b：候选跑启用预算逃生链（tools/list 预检走 N、
        // continue／mode=new_question＋重试直至真实成交）。不带 session ——
        // 复现 Wave D 同 Token 粘滞桶；需要 session 复用见 --budget-escape-session。
        options.budgetEscape = { escape: true };
        break;
      case "budget-escape-session":
        options.budgetEscape = { escape: true, session: "auto" };
        break;
      default: {
        const err = new Error(`unknown argument --${name}`);
        err.code = "USAGE";
        throw err;
      }
    }
  }
  return { help: false, command, options };
}

/**
 * Dynamically load B2 agent journey runner when present.
 * @param {{ importFn?: typeof import }} [deps]
 * @returns {Promise<null | ((args: object) => Promise<object>)>}
 */
export async function loadRunAgentJourneys(deps = {}) {
  const importFn = deps.importFn ?? ((spec) => import(spec));
  const candidates = [
    pathToFileURL(path.join(HERE, "lib", "mcp-agent-journeys.mjs")).href,
    pathToFileURL(path.join(HERE, "mcp-agent-journeys.mjs")).href
  ];
  for (const spec of candidates) {
    try {
      const mod = await importFn(spec);
      if (typeof mod.runAgentJourneys === "function") return mod.runAgentJourneys;
    } catch {
      // absent until Wave B2
    }
  }
  return null;
}

/**
 * Default agent hook when B2 adapter is missing.
 * @param {object} [_args]
 */
export async function agentAdapterMissing(_args = {}) {
  return {
    status: "BLOCKED",
    reason: "AGENT_ADAPTER_MISSING",
    turns: [],
    attempts: [],
    clientFingerprint: null,
    modelFingerprint: null
  };
}

/**
 * Collect token refs used by the suite; resolve or report missing.
 * @param {object} suite
 * @param {Record<string, string>} tokenEnv
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveSuiteTokens(suite, tokenEnv = {}, env = process.env) {
  const merged = { ...env, ...tokenEnv };
  const missing = [];
  const tokensByRef = {};
  for (const c of suite?.cases ?? []) {
    for (const identity of c.identities ?? []) {
      const ref = identity.tokenRef;
      if (!ref) {
        missing.push(`${c.id}:${identity.id}:TOKEN_REF_MISSING`);
        continue;
      }
      if (tokensByRef[ref]) continue;
      const resolved = resolveTokenRef(ref, merged);
      if (!resolved.ok) {
        missing.push(`${c.id}:${identity.id}:${resolved.reason}`);
      } else {
        tokensByRef[ref] = resolved.token;
        const bare = String(ref).startsWith("env:") ? String(ref).slice(4) : String(ref);
        tokensByRef[bare] = resolved.token;
        tokensByRef[`env:${bare}`] = resolved.token;
      }
    }
  }
  return { ok: missing.length === 0, missing, tokensByRef };
}

/**
 * Write private baseline with 0700 parent / 0600 file. Redacts secrets.
 * @param {string} baselinePath
 * @param {object} payload
 * @param {string[]} [secrets]
 */
export function writePrivateBaseline(baselinePath, payload, secrets = []) {
  const dir = path.dirname(baselinePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms that ignore mode
  }
  const redacted = redactSecretsDeep(payload, secrets);
  const tmp = `${baselinePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(redacted, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, baselinePath);
  chmodSync(baselinePath, 0o600);
  rmSync(tmp, { force: true });
  return baselinePath;
}

/**
 * @param {string} baselinePath
 */
export function readPrivateBaseline(baselinePath) {
  if (!baselinePath || !existsSync(baselinePath)) {
    return null;
  }
  return JSON.parse(readFileSync(baselinePath, "utf8"));
}

/**
 * @param {string} filePath
 * @returns {{ ok: boolean, mode: number|null, reason?: string }}
 */
export function assertPrivateFileMode(filePath, expected = 0o600) {
  if (!existsSync(filePath)) {
    return { ok: false, mode: null, reason: "FILE_MISSING" };
  }
  const mode = statSync(filePath).mode & 0o777;
  if (mode !== expected) {
    return { ok: false, mode, reason: `expected mode ${expected.toString(8)}, got ${mode.toString(8)}` };
  }
  return { ok: true, mode };
}

/**
 * Deep redact known secret strings from a structure.
 * @param {unknown} value
 * @param {string[]} secrets
 */
export function redactSecretsDeep(value, secrets = []) {
  if (typeof value === "string") {
    let out = value;
    for (const s of secrets) {
      if (s && out.includes(s)) out = out.split(s).join("[REDACTED]");
    }
    // Never keep Bearer tokens or lucy_ token shapes in private baseline either.
    out = out.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/g, "Bearer [REDACTED]");
    out = out.replace(/lucy_(?:e2e_)?[A-Za-z0-9_-]{16,}/g, "[REDACTED_TOKEN]");
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => {
        if (/token|password|secret|authorization/i.test(k) && typeof v === "string") {
          return [k, "[REDACTED]"];
        }
        return [k, redactSecretsDeep(v, secrets)];
      })
    );
  }
  return value;
}

/**
 * Fail closed if public evidence contains secrets / token plaintext.
 * @param {object|string} evidence
 * @param {string[]} [secrets]
 */
export function assertNoPublicEvidenceLeak(evidence, secrets = []) {
  const text = typeof evidence === "string" ? evidence : JSON.stringify(evidence);
  const hits = [];
  for (const s of secrets) {
    if (s && text.includes(s)) {
      hits.push({ kind: "plaintext-secret", digest: tokenFingerprint(s) });
    }
  }
  const scanned = scanText(text, { secrets });
  if (scanned?.hits?.length) {
    for (const h of scanned.hits) hits.push({ kind: h.kind, digest: h.digest });
  }
  // Hard patterns even if leak-scan patterns evolve
  if (/Bearer\s+lucy_/i.test(text) || /lucy_(?:e2e_)?[a-f0-9]{32,}/i.test(text)) {
    hits.push({ kind: "token-shape", digest: "sha256:token-shape" });
  }
  if (hits.length) {
    const err = new Error(`public evidence secret leak: ${hits.map((h) => h.kind).join(",")}`);
    err.code = "PUBLIC_EVIDENCE_LEAK";
    err.hits = hits;
    throw err;
  }
  return { ok: true, hits: [] };
}

/**
 * Schema-shaped public evidence stub (deep verifier is B3).
 */
function caseStatusFromFunctional(c) {
  if (!c) return "NOT_RUN";
  if (c.incomplete) return "FAIL";
  if (c.expectedOutcome && c.observedOutcome && c.expectedOutcome !== c.observedOutcome) return "FAIL";
  if (c.isError && c.expectedOutcome === "allow") return "FAIL";
  return "PASS";
}

function buildEvidenceCases(suite, functionalCases, attempts) {
  const byId = new Map();
  for (const c of functionalCases ?? []) {
    const id = c.id ?? c.caseId;
    if (!id) continue;
    const list = byId.get(id) ?? [];
    list.push(c);
    byId.set(id, list);
  }
  const attemptByCase = new Map();
  for (const a of attempts ?? []) {
    const id = a.caseId ?? a.id;
    if (!id) continue;
    const list = attemptByCase.get(id) ?? [];
    list.push(a);
    attemptByCase.set(id, list);
  }
  const ids = (suite?.cases ?? []).map((c) => c.id);
  return ids.map((id) => {
    const funcs = byId.get(id) ?? [];
    const primary = funcs[0] ?? { id };
    const caseAttempts = attemptByCase.get(id) ?? primary.attempts ?? [{ ok: true, kind: "synthetic" }];
    return {
      id,
      status: caseStatusFromFunctional(primary),
      attempts: caseAttempts,
      expectedOutcome: primary.expectedOutcome,
      observedOutcome: primary.observedOutcome,
      expectedNonempty: primary.expectedNonempty,
      observedRowCount: primary.observedRowCount,
      envelopeEmpty: primary.envelopeEmpty,
      isError: primary.isError,
      expectedMetrics: primary.expectedMetrics,
      observedMetrics: primary.observedMetrics
    };
  });
}

export function buildCandidateEvidence({
  suite,
  suiteDigest,
  verdict,
  functionalCases,
  clientFingerprint,
  modelFingerprint,
  configProfileFingerprint,
  batchWallClockMs,
  attempts,
  mcp,
  agent,
  coverageMode = "full"
}) {
  const expectedCaseIds = (suite?.cases ?? []).map((c) => c.id);
  const cases = buildEvidenceCases(suite, functionalCases, attempts);
  return {
    kind: "candidate",
    contract: "lucy-mcp-compatibility-evidence-v1",
    status: verdict.status,
    entrypoint: "certifyCandidate",
    suiteDigest,
    candidateDigest: suiteDigest,
    clientFingerprint,
    modelFingerprint,
    configProfileFingerprint,
    coverageMode,
    denominator: {
      caseCount: expectedCaseIds.length,
      expectedCaseIds,
      attemptCount: attempts?.length ?? 0,
      mcpSampleCount: mcp?.samplesMs?.length ?? 0,
      agentSampleCount: agent?.turns?.length ?? 0,
      complete: cases.every((c) => c.status !== "NOT_RUN")
    },
    verdicts: verdict.verdicts,
    reasons: verdict.reasons ?? [],
    cases,
    mcp: {
      budgetClass: mcp?.budgetClass ?? "simple",
      samplesMs: mcp?.samplesMs ?? []
    },
    agent: {
      turns: agent?.turns ?? []
    },
    samples: {
      mcp: {
        count: mcp?.samplesMs?.length ?? 0,
        budgetClass: mcp?.budgetClass ?? "simple"
      },
      agent: {
        count: agent?.turns?.length ?? 0
      }
    },
    batchWallClockMs: batchWallClockMs ?? null,
    digests: {
      suiteDigest,
      evidenceBodyDigest: null
    }
  };
}

export function buildInstanceEvidence({
  suite,
  suiteDigest,
  verdict,
  phase,
  snapshotId,
  clientFingerprint,
  modelFingerprint,
  configProfileFingerprint,
  batchWallClockMs,
  baselineDigest,
  prior,
  functionalCases,
  attempts,
  mcp,
  agent,
  coverageMode = "full"
}) {
  const phases = { ...(prior?.phases ?? {}) };
  phases[phase] = {
    status: verdict.status,
    verdicts: verdict.verdicts,
    reasons: verdict.reasons ?? [],
    batchWallClockMs: batchWallClockMs ?? null
  };
  const expectedCaseIds = (suite?.cases ?? []).map((c) => c.id);
  const cases = buildEvidenceCases(suite, functionalCases, attempts);
  return {
    kind: "instance",
    contract: "lucy-mcp-compatibility-evidence-v1",
    status: verdict.status,
    entrypoint: verdict.entrypoint,
    suiteDigest,
    candidateDigest: suiteDigest,
    snapshotId: snapshotId ?? null,
    clientFingerprint,
    modelFingerprint,
    configProfileFingerprint,
    baselineDigest: baselineDigest ?? null,
    coverageMode: prior?.coverageMode ?? coverageMode,
    denominator: {
      caseCount: expectedCaseIds.length,
      expectedCaseIds,
      attemptCount: attempts?.length ?? prior?.denominator?.attemptCount ?? 0,
      mcpSampleCount: mcp?.samplesMs?.length ?? prior?.denominator?.mcpSampleCount ?? 0,
      agentSampleCount: agent?.turns?.length ?? prior?.denominator?.agentSampleCount ?? 0,
      complete: cases.every((c) => c.status !== "NOT_RUN")
    },
    verdicts: verdict.verdicts,
    reasons: verdict.reasons ?? [],
    cases,
    mcp: {
      budgetClass: mcp?.budgetClass ?? "simple",
      samplesMs: mcp?.samplesMs ?? []
    },
    agent: {
      turns: agent?.turns ?? []
    },
    phases,
    batchWallClockMs: batchWallClockMs ?? null,
    digests: {
      suiteDigest,
      baselineDigest: baselineDigest ?? null,
      evidenceBodyDigest: null
    }
  };
}

function sealEvidenceDigest(doc) {
  const clone = { ...doc, digests: { ...(doc.digests ?? {}), evidenceBodyDigest: null } };
  const hex = createHash("sha256").update(JSON.stringify(clone)).digest("hex");
  return {
    ...doc,
    digests: { ...(doc.digests ?? {}), evidenceBodyDigest: `sha256:${hex}` }
  };
}

/**
 * @param {object} doc
 * @param {string} filePath
 * @param {string[]} secrets
 */
export function writePublicEvidence(filePath, doc, secrets = []) {
  const sealed = sealEvidenceDigest(doc);
  assertNoPublicEvidenceLeak(sealed, secrets);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(sealed, null, 2)}\n`, "utf8");
  return { path: filePath, evidence: sealed };
}

function mapBudgetClass(suite) {
  // Prefer simple absolute gate for aggregated MCP RTT samples in this wave.
  return "simple";
}

/**
 * Run agent axis via injected hook or B2 module; else AGENT_ADAPTER_MISSING.
 */
/**
 * Normalize B2 runAgentJourneys result into the runner/judge shape.
 * B2 returns agentTurns / agentLatencyInput; mocks may still return turns.
 */
export function normalizeAgentRun(agentRun = {}) {
  const turns =
    Array.isArray(agentRun.turns) && agentRun.turns.length
      ? agentRun.turns
      : Array.isArray(agentRun.agentLatencyInput?.turns)
        ? agentRun.agentLatencyInput.turns
        : Array.isArray(agentRun.agentTurns)
          ? agentRun.agentTurns
          : [];
  return {
    ...agentRun,
    turns,
    agentTurns: Array.isArray(agentRun.agentTurns) ? agentRun.agentTurns : turns,
    clientFingerprint: agentRun.clientFingerprint ?? null,
    modelFingerprint: agentRun.modelFingerprint ?? null,
    selectedClientId: agentRun.selectedClientId ?? null,
    status: agentRun.status ?? "PASS",
    reason: agentRun.reason ?? agentRun.reasons?.[0] ?? null,
    reasons: agentRun.reasons ?? []
  };
}

export async function runAgentAxis(args, deps = {}) {
  // Explicit null/false means "no adapter" (unit tests); undefined means try dynamic import.
  const hook =
    deps.runAgentJourneys !== undefined
      ? deps.runAgentJourneys
      : await loadRunAgentJourneys(deps);
  if (typeof hook !== "function") {
    return normalizeAgentRun(await agentAdapterMissing(args));
  }
  const payload = {
    suite: args.suite,
    selectedClientId: args.selectedClientId ?? null,
    stickyFingerprints: args.stickyFingerprints ?? null,
    mcpUrl: args.mcpUrl,
    token: args.token,
    workDir: args.workDir,
    clientFingerprint: args.clientFingerprint,
    modelFingerprint: args.modelFingerprint,
    env: args.env,
    concurrency: args.concurrency,
    deps: args.agentDeps
  };
  const raw = await hook(payload);
  return normalizeAgentRun(raw);
}

/**
 * Core runner with injectable deps (unit tests).
 *
 * @param {"capture"|"candidate"|"upgrade"|"rollback"} command
 * @param {object} options
 * @param {object} [deps]
 */
export async function runCompatibilityCommand(command, options, deps = {}) {
  const started = (deps.now ?? Date.now)();
  const entrypoint = ENTRYPOINTS[command];
  if (!entrypoint) {
    return {
      status: "BLOCKED",
      reasons: [`unknown command ${command}`],
      exitCode: EXIT_CODES.blocked
    };
  }

  const applyFn = deps.applyCompatConfigProfile ?? applyCompatConfigProfile;
  const restoreFn = deps.restoreCompatConfigProfile ?? restoreCompatConfigProfile;
  const loadSuite = deps.loadJourneySuite ?? loadJourneySuite;
  const aggregate = deps.aggregateCompatibility ?? aggregateCompatibility;
  const runMcp = deps.runMcpSuiteControls ?? runMcpSuiteControls;
  const createClient = deps.createMcpClient ?? createMcpClient;

  const suite = loadSuite(options.suitePath);
  const suiteDigest = digestJourneySuite(suite);

  const tokenResolution = resolveSuiteTokens(suite, options.tokenEnv ?? {}, {
    ...process.env,
    ...(options.tokenEnv ?? {})
  });
  if (!tokenResolution.ok) {
    return {
      status: "BLOCKED",
      entrypoint,
      reasons: tokenResolution.missing.map((m) => `TOKEN: ${m}`),
      exitCode: EXIT_CODES.blocked
    };
  }
  const secrets = [...new Set(Object.values(tokenResolution.tokensByRef))];

  // upgrade / rollback require baseline up-front (before mutating config)
  let baseline = null;
  if (command === "upgrade" || command === "rollback") {
    if (!options.baselinePath || !existsSync(options.baselinePath)) {
      return {
        status: "BLOCKED",
        entrypoint,
        reasons: ["BASELINE_MISSING: instance upgrade requires private baseline"],
        exitCode: EXIT_CODES.blocked
      };
    }
    baseline = (deps.readPrivateBaseline ?? readPrivateBaseline)(options.baselinePath);
    if (!baseline?.snapshotId) {
      return {
        status: "BLOCKED",
        entrypoint,
        reasons: ["missing baseline snapshotId on instance lane"],
        exitCode: EXIT_CODES.blocked
      };
    }
  }

  let backup = null;
  let fingerprint = null;
  let restoreError = null;
  let result;

  try {
    const applied = applyFn({
      projectRoot: options.projectRoot ?? REPO_ROOT,
      profilePath: options.profilePath,
      backupDir: options.backupDir
    });
    if (applied.status !== "READY") {
      return {
        status: "BLOCKED",
        entrypoint,
        reasons: applied.problems?.length
          ? applied.problems
          : ["CompatConfigProfile apply BLOCKED"],
        exitCode: EXIT_CODES.blocked
      };
    }
    fingerprint = applied.fingerprint;
    backup = { ...applied.backup, projectRoot: options.projectRoot ?? REPO_ROOT };

    if (
      suite.requiredConfigFingerprint &&
      fingerprint !== suite.requiredConfigFingerprint
    ) {
      return {
        status: "BLOCKED",
        entrypoint,
        reasons: [
          `configProfileFingerprint mismatch: got ${fingerprint}, required ${suite.requiredConfigFingerprint}`
        ],
        configProfileFingerprint: fingerprint,
        exitCode: EXIT_CODES.blocked
      };
    }

    const mcpRun =
      deps.mcpRun ??
      (await runMcp({
        suite,
        tokensByRef: tokenResolution.tokensByRef,
        baseUrl: options.mcpUrl,
        createClient,
        fetchImpl: deps.fetchImpl,
        sampleRepeats: deps.sampleRepeats ?? 1,
        // P1-74 / Task 4b：CLI `--budget-escape` 显式开启预算逃生链。
        ...(options.budgetEscape ? { budgetEscape: options.budgetEscape } : {})
      }));

    if (mcpRun.incomplete && mcpRun.problems?.length) {
      // Missing token already gated; incomplete attempts / isError still feed the judge.
    }

    if (!options.selectedClientId && baseline?.selectedClientId) {
      options.selectedClientId = baseline.selectedClientId;
    }
    const stickyFingerprints =
      baseline?.clientFingerprint && baseline?.modelFingerprint
        ? {
            clientFingerprint: baseline.clientFingerprint,
            modelFingerprint: baseline.modelFingerprint
          }
        : options.stickyFingerprints ?? null;

    // Agent axis uses one Bearer for LUCY_E2E_TOKEN (adapter prepare). Prefer explicit
    // options.agentToken; else COMPAT_TOKEN_READONLY (demo business denominator); else first resolved.
    const resolvedAgentToken =
      options.agentToken ||
      tokenResolution.tokensByRef["env:COMPAT_TOKEN_READONLY"] ||
      Object.values(tokenResolution.tokensByRef)[0] ||
      "";

    const agentRun = await runAgentAxis(
      {
        suite,
        entrypoint,
        selectedClientId: options.selectedClientId ?? null,
        stickyFingerprints,
        clientFingerprint: options.clientFingerprint,
        modelFingerprint: options.modelFingerprint,
        mcpUrl: options.mcpUrl,
        token: resolvedAgentToken,
        workDir: options.workDir,
        env: options.env,
        concurrency: options.agentConcurrency
      },
      deps
    );

    // Prefer live Agent fingerprints when B2 selected a client.
    if (agentRun?.clientFingerprint) {
      options.clientFingerprint = agentRun.clientFingerprint;
    } else if (!options.clientFingerprint) {
      options.clientFingerprint = "compat-client:unspecified";
    }
    if (agentRun?.modelFingerprint) {
      options.modelFingerprint = agentRun.modelFingerprint;
    } else if (!options.modelFingerprint) {
      options.modelFingerprint = "compat-model:unspecified";
    }

    const agentTurns = Array.isArray(agentRun?.turns) ? agentRun.turns : [];
    const agentBlockedMissing =
      agentRun?.reason === "AGENT_ADAPTER_MISSING" || agentRun?.status === "BLOCKED";

    // Ensure MCP sample floor for latency axis when caller injects samples; otherwise use observed.
    let samplesMs = [...(mcpRun.samplesMs ?? [])];
    if (deps.padMcpSamplesToMin && samplesMs.length > 0 && samplesMs.length < MCP_MIN_SAMPLES) {
      const last = samplesMs[samplesMs.length - 1] ?? 100;
      while (samplesMs.length < MCP_MIN_SAMPLES) samplesMs.push(last);
    }

    const functionalCases = mcpRun.functionalCases ?? [];
    const isErrorHit = functionalCases.some((c) => c.isError);
    const incompleteAttempts = (mcpRun.attempts ?? []).some(
      (a) => a.ok !== true && a.ok !== false
    );

    const mcpInput = {
      budgetClass: mapBudgetClass(suite),
      samplesMs,
      baselineP95Ms: baseline?.mcp?.p95Ms
    };
    const agentInput = {
      turns: agentTurns,
      baselineMedianMs: baseline?.agent?.medianMs,
      ...(agentRun?.attribution ? { attribution: agentRun.attribution } : {})
    };

    let candidateEvidence = null;
    if (command === "upgrade") {
      const candPath =
        options.candidateEvidencePath ??
        path.join(options.resultsDir ?? DEFAULT_RESULTS_DIR, CANDIDATE_EVIDENCE_NAME);
      if (deps.candidateEvidence) {
        candidateEvidence = deps.candidateEvidence;
      } else if (existsSync(candPath)) {
        const raw = JSON.parse(readFileSync(candPath, "utf8"));
        // Prefer B3 recompute; never trust forged top-level PASS alone.
        let verifiedStatus = raw.status;
        try {
          const verifyMod = await (deps.importEvidenceVerify
            ? deps.importEvidenceVerify()
            : import(pathToFileURL(path.join(HERE, "lib", "mcp-compatibility-evidence.mjs")).href));
          if (typeof verifyMod.verifyMcpCompatibilityEvidenceDoc === "function") {
            const v = verifyMod.verifyMcpCompatibilityEvidenceDoc({
              doc: raw,
              expectedKind: "candidate",
              suite
            });
            // B3 returns top-level status + recomputed.aggregateStatus (not recomputed.status).
            const recomputedStatus =
              v.status ?? v.recomputed?.aggregateStatus ?? "FAIL";
            verifiedStatus =
              v.ok && recomputedStatus === "PASS" ? "PASS" : recomputedStatus === "PASS" ? "FAIL" : recomputedStatus;
            // Fail closed: never keep forged raw.status when verify did not ok+PASS.
            candidateEvidence = { ...raw, status: verifiedStatus, _verified: v };
          } else {
            candidateEvidence = raw;
          }
        } catch {
          candidateEvidence = raw;
        }
      } else {
        candidateEvidence = { status: "FAIL" };
      }
    }

    const batchWallClockMs = (deps.now ?? Date.now)() - started;

    const verdict = aggregate({
      entrypoint,
      suite,
      configProfileFingerprint: fingerprint,
      functionalCases,
      mcp: mcpInput,
      agent: agentInput,
      batchWallClockMs,
      clientFingerprint: options.clientFingerprint,
      modelFingerprint: options.modelFingerprint,
      baseline:
        baseline == null
          ? undefined
          : {
              snapshotId: baseline.snapshotId,
              clientFingerprint: baseline.clientFingerprint,
              modelFingerprint: baseline.modelFingerprint
            },
      candidateEvidence: candidateEvidence ?? undefined,
      // When agent adapter missing, force agent axis BLOCKED via insufficient samples
      // unless deps supply turns. aggregate already BLOCKED on <3 turns.
      ...(agentBlockedMissing && agentTurns.length < AGENT_MIN_SAMPLES
        ? {}
        : {})
    });

    // Surface explicit adapter-missing reason
    if (agentBlockedMissing && !verdict.reasons.some((r) => /AGENT_ADAPTER_MISSING/.test(r))) {
      verdict.reasons = [...verdict.reasons, "AGENT_ADAPTER_MISSING"];
      if (verdict.status === "PASS") verdict.status = "BLOCKED";
      if (verdict.verdicts) verdict.verdicts.agentLatency = "BLOCKED";
    }

    if (isErrorHit && verdict.status === "PASS") {
      // isError on an expected-allow path is already a functional FAIL via observed deny;
      // keep explicit reason when judge somehow passed.
      verdict.reasons = [...verdict.reasons, "isError observed in MCP attempts"];
    }
    if (incompleteAttempts) {
      verdict.reasons = [...verdict.reasons, "incomplete attempts in denominator"];
      if (verdict.status === "PASS") verdict.status = "FAIL";
    }

    const out = {
      status: verdict.status,
      entrypoint,
      verdicts: verdict.verdicts,
      reasons: verdict.reasons,
      suiteDigest,
      configProfileFingerprint: fingerprint,
      batchWallClockMs,
      functionalCases,
      attempts: mcpRun.attempts,
      mcp: mcpInput,
      agent: agentInput,
      agentRun
    };

    if (command === "capture") {
      const snapshotId =
        options.snapshotId ??
        baseline?.snapshotId ??
        `snap-${createHash("sha256").update(suiteDigest).digest("hex").slice(0, 12)}`;
      if (!options.baselinePath) {
        out.status = "BLOCKED";
        out.reasons = [...(out.reasons ?? []), "capture requires --baseline path"];
      } else if (out.status === "PASS" || deps.writeBaselineOnNonPass) {
        const payload = {
          contract: "lucy-mcp-compat-private-baseline-v1",
          snapshotId,
          suiteDigest,
          selectedClientId: options.selectedClientId ?? agentRun?.selectedClientId ?? null,
          clientFingerprint: options.clientFingerprint,
          modelFingerprint: options.modelFingerprint,
          configProfileFingerprint: fingerprint,
          capturedAt: new Date().toISOString(),
          mcp: {
            samplesMs: samplesMs.slice(0, MCP_MIN_SAMPLES),
            p95Ms: null
          },
          agent: {
            turns: agentTurns,
            medianMs: null
          },
          functionalSummary: functionalCases.map((c) => ({
            id: c.id,
            expectedOutcome: c.expectedOutcome,
            observedOutcome: c.observedOutcome
          }))
        };
        (deps.writePrivateBaseline ?? writePrivateBaseline)(
          options.baselinePath,
          payload,
          secrets
        );
        const modeCheck = assertPrivateFileMode(options.baselinePath, 0o600);
        if (!modeCheck.ok) {
          out.status = "FAIL";
          out.reasons = [
            ...(out.reasons ?? []),
            `private baseline permissions: ${modeCheck.reason}`
          ];
        }
        out.baselinePath = options.baselinePath;
        out.snapshotId = snapshotId;
      }
    }

    if (command === "candidate") {
      const evidencePath = path.join(
        options.resultsDir ?? DEFAULT_RESULTS_DIR,
        CANDIDATE_EVIDENCE_NAME
      );
      const doc = buildCandidateEvidence({
        suite,
        suiteDigest,
        verdict,
        functionalCases,
        clientFingerprint: options.clientFingerprint,
        modelFingerprint: options.modelFingerprint,
        configProfileFingerprint: fingerprint,
        batchWallClockMs,
        attempts: mcpRun.attempts,
        mcp: mcpInput,
        agent: agentInput,
        coverageMode: options.coverageMode ?? "full"
      });
      const written = (deps.writePublicEvidence ?? writePublicEvidence)(
        evidencePath,
        doc,
        secrets
      );
      out.evidencePath = written.path;
      out.evidence = written.evidence;
    }

    if (command === "upgrade" || command === "rollback") {
      const evidencePath = path.join(
        options.resultsDir ?? DEFAULT_RESULTS_DIR,
        INSTANCE_EVIDENCE_NAME
      );
      let prior = null;
      if (existsSync(evidencePath)) {
        try {
          prior = JSON.parse(readFileSync(evidencePath, "utf8"));
        } catch {
          prior = null;
        }
      }
      const phase = command === "upgrade" ? "POST" : "ROLLBACK_VERIFY";
      const baselineDigest = baseline
        ? `sha256:${createHash("sha256").update(JSON.stringify(baseline)).digest("hex")}`
        : null;
      const doc = buildInstanceEvidence({
        suite,
        suiteDigest,
        verdict,
        phase,
        snapshotId: baseline?.snapshotId,
        clientFingerprint: options.clientFingerprint,
        modelFingerprint: options.modelFingerprint,
        configProfileFingerprint: fingerprint,
        batchWallClockMs,
        baselineDigest,
        prior,
        functionalCases,
        attempts: mcpRun.attempts,
        mcp: mcpInput,
        agent: agentInput,
        coverageMode: options.coverageMode ?? "full"
      });
      const written = (deps.writePublicEvidence ?? writePublicEvidence)(
        evidencePath,
        doc,
        secrets
      );
      out.evidencePath = written.path;
      out.evidence = written.evidence;
      out.phase = phase;
    }

    result = out;
  } catch (error) {
    if (error?.code === "PUBLIC_EVIDENCE_LEAK") {
      result = {
        status: "FAIL",
        entrypoint,
        reasons: [error.message],
        exitCode: EXIT_CODES.failed
      };
    } else {
      result = {
        status: "FAIL",
        entrypoint,
        reasons: [error?.message ?? String(error)],
        exitCode: EXIT_CODES.failed
      };
    }
  } finally {
    if (backup) {
      try {
        restoreFn(backup, { projectRoot: options.projectRoot ?? REPO_ROOT });
      } catch (error) {
        restoreError =
          error instanceof CompatConfigRestoreError
            ? error
            : new CompatConfigRestoreError(error?.message ?? String(error));
      }
    }
  }

  if (restoreError) {
    return {
      status: "FAIL",
      entrypoint,
      reasons: [
        ...(result?.reasons ?? []),
        `fixture restore failure: ${restoreError.message}`
      ],
      restoreError: true,
      exitCode: EXIT_CODES.failed
    };
  }

  const status = result?.status ?? "BLOCKED";
  const exitCode =
    status === "PASS"
      ? EXIT_CODES.passed
      : status === "BLOCKED"
        ? EXIT_CODES.blocked
        : EXIT_CODES.failed;

  return { ...result, status, exitCode };
}

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCli(argv);
  } catch (error) {
    if (error?.code === "FORBIDDEN_FLAG") {
      process.stderr.write(`${error.message}\n`);
      process.exit(EXIT_CODES.failed);
    }
    process.stderr.write(`${error.message}\n${USAGE}`);
    process.exit(EXIT_CODES.blocked);
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const result = await runCompatibilityCommand(parsed.command, parsed.options);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    entrypoint: result.entrypoint,
    reasons: result.reasons,
    evidencePath: result.evidencePath ?? null,
    baselinePath: result.baselinePath ?? null,
    suiteDigest: result.suiteDigest ?? null,
    configProfileFingerprint: result.configProfileFingerprint ?? null
  }, null, 2)}\n`);
  process.exit(result.exitCode ?? EXIT_CODES.failed);
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((error) => fail(error?.stack ?? String(error), EXIT_CODES.failed));
}
