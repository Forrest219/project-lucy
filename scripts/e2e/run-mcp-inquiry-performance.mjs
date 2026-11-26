#!/usr/bin/env node
/**
 * P1-78 Task 3 — deterministic Public MCP performance runner (MCP control lane).
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D2 dual lane, D3 full denominator, D5 scenario isolation, D6 sample floors,
 *    D8 relative gate, D11 trigger tiers, D15 fail closed, D16 legal control,
 *    §4.1 scenario families, §4.2 timing, §4.3 attempt/evidence fields, §5 budgets,
 *    §6 evidence layout, §7 trigger matrix)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 3
 *
 * The runner owns the *control* lane only (deterministic Public MCP). The real
 * Agent lane lives in scripts/e2e/lib/mcp-inquiry-performance-agent.mjs (Task 4)
 * and the SOAK / LONG_FOLLOW lanes in the soak module (Task 8); both plug into
 * the same evidence schema via TRIGGER_DISPATCH below.
 *
 * Forbidden flags are always rejected: a run that can skip the query, tolerate a
 * new denial or accept a regression must never be able to produce release
 * evidence (Spec D11).
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

import {
  ATTEMPT_NULLABLE_IDENTITY_FIELDS,
  ATTEMPT_REQUIRED_FIELDS,
  PERFORMANCE_CLIENT_VERSION,
  buildAttemptRecord,
  createInFlightTracker,
  createPerformanceMcpClient,
  runMcpPerformanceJourney,
  summarizeRoleFairness
} from "./lib/mcp-inquiry-performance-client.mjs";
import { resolveTokenRef } from "./lib/mcp-compatibility-client.mjs";
import {
  ABSOLUTE_BUDGETS,
  aggregatePerformance,
  judgeLongFollowScenario,
  mapOwnerBudgetClass,
  resolveQuestionPackDependency
} from "./lib/mcp-inquiry-performance.mjs";
import {
  SCALE_BASELINE_RELATIVE_PATH,
  parseArrivalModelFromScaleBaseline,
  runLongFollowScenario,
  runSoakScenario
} from "./lib/mcp-inquiry-performance-soak.mjs";
import { DEFAULT_PACK_PATH } from "./lib/mcp-inquiry-question-pack.mjs";
import { EXIT_CODES, REPO_ROOT, fail } from "./lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_CONTRACT_PATH = path.join(HERE, "contracts", "mcp-inquiry-performance.yaml");
export const DEFAULT_QUESTION_BANK_PATH = path.join(HERE, "contracts", "mcp-upgrade-journeys.yaml");
export const DEFAULT_EVIDENCE_DIR = path.join(
  REPO_ROOT,
  "docs/qa/uat/suites/mcp-inquiry-performance/evidence"
);
export const DEFAULT_MCP_URL = process.env.LUCY_MCP_URL ?? "http://127.0.0.1:57881/mcp";

/** Required attempt fields that may legitimately carry the value null. */
const NULLABLE_ATTEMPT_FIELDS = Object.freeze(["errorClass", "timeoutMs"]);

/** Flags that must never exist: they can turn a failing run into release evidence. */
export const FORBIDDEN_FLAGS = Object.freeze([
  "skip-query",
  "allow-new-deny",
  "accept-regression"
]);

/** Any flag with one of these prefixes is refused as well (no bypass by renaming). */
export const FORBIDDEN_FLAG_PREFIXES = Object.freeze([
  "skip-",
  "allow-",
  "accept-",
  "ignore-",
  "force-",
  "disable-",
  "no-"
]);

const ALL_MCP_FAMILIES = Object.freeze([
  "simple-single-table",
  "filter-time",
  "follow-up",
  "multi-table-join",
  "multi-db",
  "denial-with-legal-control",
  "cold-start",
  "wide-catalog",
  "concurrent-fairness"
]);

/**
 * Trigger → execution scope.
 *
 * `lane` names the runner branch: "mcp" is the deterministic Public MCP
 * control lane, "soak" and "long-follow" are the sustained-pressure and
 * long-follow lanes of Plan Task 8 (Spec §7 trigger matrix, D18/D20/D23).
 */
export const TRIGGER_DISPATCH = Object.freeze({
  pr: Object.freeze({
    trigger: "pr",
    tier: "pr",
    lane: "mcp",
    families: Object.freeze([
      "simple-single-table",
      "follow-up",
      "multi-table-join",
      "denial-with-legal-control"
    ]),
    requiresBaseline: false,
    description: "PR — minimal dual-lane matrix (Spec §7)"
  }),
  nightly: Object.freeze({
    trigger: "nightly",
    tier: "formal",
    lane: "mcp",
    families: ALL_MCP_FAMILIES,
    requiresBaseline: false,
    description: "Nightly — full performance matrix (Spec §7)"
  }),
  release: Object.freeze({
    trigger: "release",
    tier: "formal",
    lane: "mcp",
    families: ALL_MCP_FAMILIES,
    requiresBaseline: true,
    description: "Release — full matrix bound to the candidate digest (Spec §7)"
  }),
  "upgrade-pre": Object.freeze({
    trigger: "upgrade-pre",
    tier: "formal",
    lane: "mcp",
    families: ALL_MCP_FAMILIES,
    requiresBaseline: false,
    description: "Upgrade PRE — same instance/identity/question/client (Spec §7)"
  }),
  "upgrade-post": Object.freeze({
    trigger: "upgrade-post",
    tier: "formal",
    lane: "mcp",
    families: ALL_MCP_FAMILIES,
    requiresBaseline: true,
    description: "Upgrade POST — compared against the accepted PRE baseline (Spec §7)"
  }),
  "optimization-ab": Object.freeze({
    trigger: "optimization-ab",
    tier: "formal",
    lane: "mcp",
    families: ALL_MCP_FAMILIES,
    requiresBaseline: true,
    description: "Optimization A/B — same fixture, one variable (Spec §8)"
  }),
  soak: Object.freeze({
    trigger: "soak",
    tier: "formal",
    lane: "soak",
    families: Object.freeze(["soak"]),
    requiresBaseline: false,
    description: "SOAK — sustained pressure: 50 identities, >=1800s effective window, truncated-normal arrivals (Spec §7 / D18 / D23)"
  }),
  "long_follow": Object.freeze({
    trigger: "long_follow",
    tier: "formal",
    lane: "long-follow",
    families: Object.freeze(["long-follow"]),
    requiresBaseline: false,
    description: "LONG_FOLLOW — long follow-up chains: >=21 turns per chain, >=10% chain instances (Spec §7 / D20)"
  })
});

/**
 * Triggers that are not wired yet. The SOAK / LONG_FOLLOW lanes are wired
 * (Plan Task 8), so the list is empty; it stays exported so that a future
 * trigger has to state itself here instead of failing silently.
 */
export const NOT_WIRED_TRIGGERS = Object.freeze([]);

export const USAGE = `Usage:
  node scripts/e2e/run-mcp-inquiry-performance.mjs --trigger <pr|nightly|release|upgrade-pre|upgrade-post|optimization-ab|soak|long_follow> [options]

Options:
  --trigger <id>           Required trigger tier (see above)
  --scenario <scenarioId>   Repeatable; restrict the run to contract scenarios
  --baseline <path>         Accepted baseline (LATEST.json pointer or baseline JSON)
  --evidence-dir <path>     Evidence root (default: docs/qa/uat/suites/mcp-inquiry-performance/evidence)
  --mcp-url <url>           Public MCP base URL (env: LUCY_MCP_URL)
  --token-env <NAME=value>  Repeatable; supply tokens without putting secrets in argv files
  --contract <path>         Scenario contract YAML (default: scripts/e2e/contracts/mcp-inquiry-performance.yaml)
  --question-bank <path>    P1-54 question bank YAML (default: scripts/e2e/contracts/mcp-upgrade-journeys.yaml)
  --client-fingerprint <id> Comparable client fingerprint (default: lucy-mcp-perf@<version>)
  --model-fingerprint <id>  Comparable model fingerprint (default: mcp-control:no-model)
  --dry-run                 Validate arguments, contract and fingerprints only; writes nothing
  --help                    Show this help

Forbidden (always rejected): --skip-query --allow-new-deny --accept-regression
                              (and any --skip-* / --allow-* / --accept-* / --ignore-* / --force-* / --disable-* / --no-* flag)
`;

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Reject every flag that could turn a failing run into release evidence.
 * @param {string[]} argv
 */
export function assertNoForbiddenFlags(argv) {
  for (const arg of argv ?? []) {
    if (typeof arg !== "string" || !arg.startsWith("--")) continue;
    const name = arg.slice(2).split("=")[0];
    if (FORBIDDEN_FLAGS.includes(name)) {
      const err = new Error(
        `forbidden flag --${name}: the performance runner refuses --skip-query/--allow-new-deny/--accept-regression`
      );
      err.code = "FORBIDDEN_FLAG";
      throw err;
    }
    if (FORBIDDEN_FLAG_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      const err = new Error(
        `forbidden flag --${name}: no skip/allow/accept/ignore/force/disable/no-* switch may produce release evidence`
      );
      err.code = "FORBIDDEN_FLAG";
      throw err;
    }
  }
}

/**
 * @param {string[]} argv
 */
export function parseCli(argv = []) {
  assertNoForbiddenFlags(argv);
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true, options: {} };
  }
  const options = {
    trigger: null,
    scenarioIds: [],
    baselinePath: null,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    mcpUrl: DEFAULT_MCP_URL,
    tokenEnv: {},
    contractPath: DEFAULT_CONTRACT_PATH,
    questionBankPath: DEFAULT_QUESTION_BANK_PATH,
    clientFingerprint: `lucy-mcp-perf@${PERFORMANCE_CLIENT_VERSION}`,
    modelFingerprint: "mcp-control:no-model",
    dryRun: false
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
      case "trigger":
        options.trigger = need(name);
        break;
      case "scenario":
        options.scenarioIds.push(need(name));
        break;
      case "baseline":
        options.baselinePath = path.resolve(need(name));
        break;
      case "evidence-dir":
        options.evidenceDir = path.resolve(need(name));
        break;
      case "mcp-url":
        options.mcpUrl = need(name);
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
      case "contract":
        options.contractPath = path.resolve(need(name));
        break;
      case "question-bank":
        options.questionBankPath = path.resolve(need(name));
        break;
      case "client-fingerprint":
        options.clientFingerprint = need(name);
        break;
      case "model-fingerprint":
        options.modelFingerprint = need(name);
        break;
      case "dry-run":
        options.dryRun = true;
        break;
      default: {
        const err = new Error(`unknown argument --${name}`);
        err.code = "USAGE";
        throw err;
      }
    }
  }
  if (!options.trigger) {
    const err = new Error(`--trigger is required (${Object.keys(TRIGGER_DISPATCH).join("|")})`);
    err.code = "USAGE";
    throw err;
  }
  if (NOT_WIRED_TRIGGERS.includes(options.trigger)) {
    const err = new Error(
      `--trigger ${options.trigger} is not wired yet; extend TRIGGER_DISPATCH when its lane lands.`
    );
    err.code = "TRIGGER_NOT_WIRED";
    throw err;
  }
  if (!(options.trigger in TRIGGER_DISPATCH)) {
    const err = new Error(
      `unknown --trigger ${options.trigger} (expected ${Object.keys(TRIGGER_DISPATCH).join("|")})`
    );
    err.code = "USAGE";
    throw err;
  }
  return { help: false, options };
}

// ---------------------------------------------------------------------------
// contract / question bank loading
// ---------------------------------------------------------------------------

/**
 * @param {string} filePath
 */
export function loadYamlDoc(filePath) {
  if (!filePath || !existsSync(filePath)) {
    const err = new Error(`file not found: ${filePath}`);
    err.code = "MISSING_FILE";
    throw err;
  }
  return parseYaml(readFileSync(filePath, "utf8"));
}

/**
 * @param {string} filePath
 */
export function loadScenarioContract(filePath = DEFAULT_CONTRACT_PATH) {
  const doc = loadYamlDoc(filePath);
  if (!doc || !Array.isArray(doc.scenarios)) {
    const err = new Error(`scenario contract has no scenarios: ${filePath}`);
    err.code = "CONTRACT_INVALID";
    throw err;
  }
  return doc;
}

/**
 * @param {string} filePath
 */
export function loadQuestionBank(filePath = DEFAULT_QUESTION_BANK_PATH) {
  const doc = loadYamlDoc(filePath);
  if (!doc || !Array.isArray(doc.cases)) {
    const err = new Error(`question bank has no cases: ${filePath}`);
    err.code = "CONTRACT_INVALID";
    throw err;
  }
  return doc;
}

/**
 * @param {string} filePath
 */
export function sha256FileDigest(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(filePath)).digest("hex")}`;
}

// ---------------------------------------------------------------------------
// scenario selection & planning
// ---------------------------------------------------------------------------

/**
 * Pick the scenarios a trigger must execute (Spec §7) and validate the
 * explicit `--scenario` selection.
 *
 * The MCP lane never executes the SOAK / LONG_FOLLOW scenarios: they carry
 * their own lane (agent + real host) and are dispatched through the Task 8
 * orchestration instead.
 *
 * @param {{ contract: object, trigger: string, requested?: string[] }} input
 */
export function selectScenarios({ contract, trigger, requested = [] }) {
  const dispatch = TRIGGER_DISPATCH[trigger];
  const problems = [];
  const all = contract.scenarios ?? [];
  const byId = new Map(all.map((s) => [s.scenarioId, s]));
  let selected;
  if (requested.length) {
    selected = [];
    for (const id of requested) {
      if (!byId.has(id)) problems.push(`unknown scenarioId ${id}`);
      else selected.push(byId.get(id));
    }
  } else {
    selected = all.filter((s) => dispatch.families.includes(s.family));
  }
  const lane = dispatch.lane ?? "mcp";
  if (lane === "mcp") {
    // SOAK / LONG_FOLLOW must not silently join an MCP run.
    const excluded = selected.filter((s) => s.family === "soak" || s.family === "long-follow");
    for (const s of excluded) {
      problems.push(`scenario ${s.scenarioId} belongs to the SOAK/LONG_FOLLOW lane`);
    }
    const wired = selected.filter((s) => !excluded.includes(s));
    if (wired.length === 0 && problems.length === 0) {
      problems.push(`trigger ${trigger} selects no scenario`);
    }
    return { scenarios: wired, problems, dispatch, lane };
  }
  // soak / long-follow lane: only the scenarios of that lane may be selected.
  const wired = selected.filter((s) => dispatch.families.includes(s.family));
  for (const s of selected) {
    if (!dispatch.families.includes(s.family)) {
      problems.push(`scenario ${s.scenarioId} does not belong to the ${trigger} lane`);
    }
  }
  if (wired.length === 0 && problems.length === 0) {
    problems.push(`trigger ${trigger} selects no scenario`);
  }
  return { scenarios: wired, problems, dispatch, lane };
}

/**
 * Resolve one contract scenario into an executable plan built from the P1-54
 * question bank (the owner of questions, identities and oracles).
 *
 * @param {{ scenario: object, questionBank: object, scaleProfileSatisfied?: boolean }} input
 */
export function resolveScenarioPlan({ scenario, questionBank, scaleProfileSatisfied = false }) {
  const problems = [];
  const cases = questionBank?.cases ?? [];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const questionCase = byId.get(scenario.questionRef);
  if (!questionCase) {
    problems.push(`${scenario.scenarioId}: questionRef ${scenario.questionRef} not in the question bank`);
  }
  // Wide-catalog scenarios depend on the global scale baseline MCP-PERF profile;
  // until its machine assertions are in place the scenario stays blocked.
  if (scenario.requiresScaleProfile && !scaleProfileSatisfied) {
    problems.push(
      `${scenario.scenarioId}: requires the scale-baseline MCP-PERF profile (${scenario.requiresScaleProfile}); the profile assertions are not effective yet — blocked, no private numbers`
    );
  }
  const expectedOutcome = scenario.budgetClass === "denial" ? "deny" : "allow";
  const identities = questionCase?.identities ?? [];
  const identity = identities.find((i) => (i?.expect?.outcome ?? "allow") === expectedOutcome) ?? null;
  if (questionCase && !identity) {
    problems.push(
      `${scenario.scenarioId}: question ${scenario.questionRef} has no identity with expect.outcome=${expectedOutcome}`
    );
  }
  const control = questionCase?.mcpControls?.find((c) => c.identity === identity?.id) ?? null;
  if (questionCase && identity && !control) {
    problems.push(`${scenario.scenarioId}: no mcpControl for identity ${identity.id}`);
  }
  const oracle = questionCase?.oracle ?? null;
  if (scenario.oracleRef && oracle?.ref && scenario.oracleRef !== oracle.ref) {
    problems.push(
      `${scenario.scenarioId}: oracleRef ${scenario.oracleRef} does not match the question bank oracle ${oracle.ref}`
    );
  }
  const mapped = mapOwnerBudgetClass(scenario.ownerBudgetClass ?? scenario.budgetClass);
  if (!mapped.ok) {
    problems.push(`${scenario.scenarioId}: ${mapped.problems[0]}`);
  }

  let legalControl = null;
  if (expectedOutcome === "deny") {
    const legalCaseId = scenario.legalControlRef ?? null;
    const legalCase = legalCaseId ? byId.get(legalCaseId) : null;
    if (!legalCase) {
      problems.push(
        `${scenario.scenarioId}: legalControlRef ${legalCaseId ?? "(missing)"} not in the question bank (D16)`
      );
    } else {
      const legalIdentity =
        (legalCase.identities ?? []).find((i) => (i?.expect?.outcome ?? "allow") === "allow") ?? null;
      const legalEntry =
        legalCase.mcpControls?.find((c) => c.identity === legalIdentity?.id) ?? null;
      if (!legalIdentity || !legalEntry) {
        problems.push(
          `${scenario.scenarioId}: legal control ${legalCaseId} has no allowed identity/mcpControl (D16)`
        );
      } else {
        legalControl = {
          caseId: legalCaseId,
          scenarioId: `${scenario.scenarioId}__legal_control__${legalCaseId}`,
          identityId: legalIdentity.id,
          role: legalIdentity.role ?? null,
          tokenRef: legalIdentity.tokenRef ?? null,
          control: legalEntry,
          oracle: legalCase.oracle ?? null,
          expectedOutcome: "allow",
          budgetClass: mapOwnerBudgetClass(legalCase.budgetClass).budgetClass ?? "simple",
          ownerBudgetClass: legalCase.budgetClass ?? null
        };
      }
    }
  }

  return {
    scenarioId: scenario.scenarioId,
    scenario,
    questionCaseId: scenario.questionRef,
    caseId: scenario.questionRef,
    identityId: identity?.id ?? null,
    role: identity?.role ?? null,
    tokenRef: identity?.tokenRef ?? null,
    control: control ? { ...control, identityId: identity.id, role: identity.role ?? null } : null,
    oracle,
    oracleRef: scenario.oracleRef ?? null,
    expectedOutcome,
    budgetClass: mapped.budgetClass ?? scenario.budgetClass ?? null,
    ownerBudgetClass: scenario.ownerBudgetClass ?? null,
    cacheState: scenario.cacheState ?? "warm",
    concurrencyGroup: scenario.concurrencyGroup ?? "single",
    lanes: concurrencyLanes(scenario),
    waves: Number(scenario.waves ?? 1) || 1,
    legalControl,
    problems
  };
}

/**
 * Concurrency identity pool (fixtures §5): independent Tokens for the 20/50-way
 * lanes, read from a repo-out private JSON ({"NAME":"plain",...} or string[]).
 * Empty when not configured — single-lane scenarios never use it.
 */
function resolveConcurrencyTokenPool(options, env) {
  const file = env?.MIP_CONCURRENCY_TOKEN_FILE;
  if (!file) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const raw = Array.isArray(parsed) ? parsed : parsed?.tokens ?? parsed;
    const values = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return values.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim());
  } catch {
    return [];
  }
}

/**
 * Lane count for a scenario: the contract encodes 20/50-way concurrency in the
 * `concurrencyGroup` name (Spec §4.1 row 9).
 * @param {object} scenario
 */
export function concurrencyLanes(scenario) {
  const group = String(scenario?.concurrencyGroup ?? "single");
  const match = /^c(\d+)$/.exec(group);
  if (match) return Number(match[1]);
  return 1;
}

/**
 * Sample floor for a scenario and tier (Spec D6).
 * @param {object} scenario
 * @param {"pr"|"formal"} tier
 */
export function sampleFloorFor(scenario, tier) {
  const floors = scenario?.sampleFloors ?? {};
  const key = tier === "pr" ? "pr" : "formal";
  const entry = floors[key] ?? floors.formal ?? floors.pr ?? {};
  return Number(entry.mcp ?? 0) || 0;
}

// ---------------------------------------------------------------------------
// SOAK / LONG_FOLLOW lane (Plan Task 8)
// ---------------------------------------------------------------------------

/** Contract references may be a single id or a list of ids. */
function asRefList(ref) {
  if (ref == null) return [];
  const list = Array.isArray(ref) ? ref : [ref];
  return list.filter((value) => typeof value === "string" && value.length > 0);
}

/**
 * Resolve the LONG_FOLLOW question-pack dependency (read-only).
 *
 * The pack path and the frozen digest come from the scenario contract; the
 * pack itself is loaded and validated by the owner's validator. Nothing here
 * writes to the pack (P1-79 D8).
 *
 * @param {{ scenario?: object|null, contract?: object|null, deps?: object }} input
 */
export function resolveLongFollowPackDependency({ scenario = null, contract = null, deps = {} } = {}) {
  const packPath = deps.packPath ?? DEFAULT_PACK_PATH;
  const expectedDigest =
    deps.expectedPackDigest ?? scenario?.packDigest ?? contract?.longFollowUpPackRef?.packDigest ?? null;
  const requiredChainIds = asRefList(scenario?.questionRef);
  const dependency = resolveQuestionPackDependency({
    pack: deps.pack ?? null,
    packPath,
    expectedDigest,
    requiredChainIds,
    loadPack: deps.loadQuestionPack ?? null
  });
  return { dependency, packPath, expectedDigest, requiredChainIds };
}

/**
 * Build the SOAK run plan from the contract and the scale baseline §1.1.
 *
 * The arrival-model parameters are read from their only owner (scale-baseline
 * §1.1) and are never copied into the contract (D17/D23⑥).
 *
 * @param {{ scenario?: object|null, contract?: object|null, deps?: object }} input
 */
export function buildSoakLanePlan({ scenario = null, contract = null, deps = {} } = {}) {
  const problems = [];
  const parseArrival = deps.parseArrivalModel ?? parseArrivalModelFromScaleBaseline;
  const source = deps.scaleBaselinePath ?? contract?.scaleBaselineRef ?? SCALE_BASELINE_RELATIVE_PATH;
  let arrival = null;
  try {
    arrival = parseArrival(source);
  } catch (error) {
    problems.push(
      `SOAK arrival model cannot be read from ${source}: ${
        error instanceof Error ? error.message : String(error)
      } (D23⑥)`
    );
  }
  const plan = {
    kind: "soak",
    scenarioId: scenario?.scenarioId ?? "SOAK",
    family: scenario?.family ?? "soak",
    identityCount: Number(scenario?.identityCount ?? 0),
    windows: {
      count: Number(scenario?.windows?.count ?? arrival?.windowCount ?? 0),
      seconds: Number(scenario?.windows?.seconds ?? arrival?.windowSeconds ?? 0)
    },
    minEffectiveSeconds: Number(scenario?.windows?.minEffectiveSeconds ?? 1800),
    drainMs: Number(scenario?.drainMs ?? 120000),
    arrivalModelRef: scenario?.arrivalModelRef ?? null,
    arrivalModelSource: arrival?.source ?? source
  };
  return { problems, plan, arrival };
}

/**
 * Dry run of the SOAK / LONG_FOLLOW lane: describe the plan, execute nothing.
 *
 * @param {object} options
 * @param {object} [deps]
 */
export function runSoakLongFollowDryRun(options, deps = {}) {
  const problems = [];
  const dispatch = TRIGGER_DISPATCH[options.trigger];
  const contract = deps.contract ?? loadScenarioContract(options.contractPath);
  const selection = selectScenarios({
    contract,
    trigger: options.trigger,
    requested: options.scenarioIds ?? []
  });
  problems.push(...selection.problems);

  const digests = computeFingerprints({
    contractPath: options.contractPath,
    questionBankPath: options.questionBankPath,
    questionBank: deps.questionBank ?? null,
    deps
  });

  const plans = [];
  for (const scenario of selection.scenarios) {
    if (dispatch.lane === "soak") {
      const { problems: planProblems, plan } = buildSoakLanePlan({ scenario, contract, deps });
      problems.push(...planProblems);
      plans.push(plan);
      continue;
    }
    const { dependency, packPath, expectedDigest, requiredChainIds } = resolveLongFollowPackDependency({
      scenario,
      contract,
      deps
    });
    if (!dependency.ok) problems.push(...dependency.problems);
    digests.questionPackDigest = dependency.digest ?? null;
    plans.push({
      kind: "long-follow",
      scenarioId: scenario.scenarioId,
      family: scenario.family,
      packPath,
      packDigest: dependency.digest ?? null,
      expectedPackDigest: expectedDigest ?? null,
      requiredChainIds,
      chainCount: dependency.chains.length,
      chains: dependency.chains.map((chain) => chain.id),
      minTotalTurns: Number(scenario.minTotalTurns ?? 21),
      minFollowUpTurns: Number(scenario.minFollowUpTurns ?? 20),
      chainInstanceRatio: Number(scenario.chainInstanceRatio ?? 0.1)
    });
  }

  return {
    status: "NOT RUN",
    dryRun: true,
    releaseReady: false,
    trigger: options.trigger,
    tier: dispatch?.tier ?? null,
    lane: dispatch?.lane ?? null,
    scenarios: plans,
    problems,
    digests,
    baseline: { present: false, path: options.baselinePath ?? null },
    evidenceWritten: false,
    baselineWritten: false
  };
}

/**
 * Map a lane verdict onto the total verdict vocabulary (§6.3).
 *
 * A passing lane run is SEED_ONLY, never PASS: the relative baseline gate for
 * the window/chain scenarios is not part of this lane, so the run can never
 * become release evidence here (D8 / §6.3).
 */
function laneStatus(verdict, reasons) {
  if (verdict === "FAIL") return "FAIL";
  if (verdict === "BLOCKED") return "BLOCKED";
  return "SEED_ONLY";
}

/**
 * Execute the SOAK / LONG_FOLLOW lane.
 *
 * The real execution path is complete but is not run by this task (no run was
 * authorized): the clock, the identity roster, the host session factory and
 * the single-turn executor are injected, so a unit test drives it with fakes.
 *
 * @param {object} options
 * @param {object} [deps]
 */
export async function runSoakLongFollowLane(options, deps = {}) {
  const now = deps.now ?? (() => Date.now());
  const startedAtMs = now();
  const dispatch = TRIGGER_DISPATCH[options.trigger];
  const problems = [];
  const contract = deps.contract ?? loadScenarioContract(options.contractPath);
  const selection = selectScenarios({
    contract,
    trigger: options.trigger,
    requested: options.scenarioIds ?? []
  });
  problems.push(...selection.problems);
  const scenario = selection.scenarios[0] ?? null;
  const runId = deps.runId ?? `mip-${startedAtMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const digests = computeFingerprints({
    contractPath: options.contractPath,
    questionBankPath: options.questionBankPath,
    questionBank: deps.questionBank ?? null,
    deps
  });

  const finish = (status, extra = {}) => {
    const reasons = [...problems, ...(extra.reasons ?? [])];
    return {
      ...extra,
      status,
      exitCode:
        status === "PASS"
          ? EXIT_CODES.passed
          : status === "BLOCKED"
            ? EXIT_CODES.blocked
            : EXIT_CODES.failed,
      runId,
      trigger: options.trigger,
      tier: dispatch?.tier ?? null,
      lane: dispatch?.lane ?? null,
      reasons,
      verdict: { status, reasons },
      attempts: [],
      groups: [],
      digests,
      evidence: null,
      evidenceWritten: false,
      startedAtMs,
      finishedAtMs: now()
    };
  };

  if (!scenario) {
    return finish("BLOCKED", { reasons: [`trigger ${options.trigger} selects no scenario`] });
  }

  if (dispatch.lane === "soak") {
    const { problems: planProblems, plan, arrival } = buildSoakLanePlan({ scenario, contract, deps });
    problems.push(...planProblems);
    if (!arrival) {
      return finish("BLOCKED", { reasons: planProblems, soak: plan });
    }
    const runner = deps.runSoakScenario ?? runSoakScenario;
    const result = await runner({
      runId,
      arrival,
      identities: deps.identities ?? [],
      windows: plan.windows,
      minEffectiveSeconds: plan.minEffectiveSeconds,
      drainMs: plan.drainMs,
      requiredIdentityCount: plan.identityCount,
      sessionFactory: deps.sessionFactory ?? null,
      turnExecutor: deps.turnExecutor ?? null,
      clock: deps.clock ?? undefined,
      hostSupportsMultiTurn: deps.hostSupportsMultiTurn ?? true,
      hostConcurrencyQuota: deps.hostConcurrencyQuota ?? null,
      chainOptions: deps.chainOptions ?? null,
      lane: "agent"
    });
    const status = laneStatus(result?.verdict, result?.reasons ?? []);
    const reasons = [...(result?.reasons ?? [])];
    if (status === "SEED_ONLY") {
      reasons.push(
        "SOAK has no accepted baseline comparison in this lane; the run is SEED_ONLY and never release evidence (Spec §6.3 / D8)"
      );
    }
    return finish(status, { reasons, soak: result });
  }

  // LONG_FOLLOW: the question-pack guard decides before anything is executed.
  const { dependency, packPath, expectedDigest } = resolveLongFollowPackDependency({ scenario, contract, deps });
  if (!dependency.ok) {
    return finish("BLOCKED", { reasons: dependency.problems, longFollow: dependency });
  }
  const runner = deps.runLongFollowScenario ?? runLongFollowScenario;
  const result = await runner({
    runId,
    packPath,
    expectedPackDigest: dependency.digest ?? expectedDigest,
    identities: deps.identities ?? [],
    sessionFactory: deps.sessionFactory ?? null,
    turnExecutor: deps.turnExecutor ?? null,
    clock: deps.clock ?? undefined,
    reuseChains: deps.reuseChains ?? null,
    reuseFingerprint: deps.reuseFingerprint ?? null,
    fingerprint: deps.fingerprint ?? null,
    hostSupportsMultiTurn: deps.hostSupportsMultiTurn ?? true
  });
  const judgement = judgeLongFollowScenario({
    chains: result?.chains ?? [],
    plannedChainCount: result?.plannedChainCount ?? null,
    expectedPackDigest: dependency.digest ?? expectedDigest,
    questionPack: dependency
  });
  const reasons = [...(result?.reasons ?? []), ...judgement.reasons];
  const worst = result?.verdict === "FAIL" || judgement.verdict === "FAIL" ? "FAIL" : result?.verdict === "BLOCKED" || judgement.verdict === "BLOCKED" ? "BLOCKED" : "PASS";
  const status = laneStatus(worst, reasons);
  if (status === "SEED_ONLY") {
    reasons.push(
      "LONG_FOLLOW has no accepted baseline comparison in this lane; the run is SEED_ONLY and never release evidence (Spec §6.3 / D8)"
    );
  }
  return finish(status, { reasons, longFollow: { ...result, chainJudgement: judgement } });
}

// ---------------------------------------------------------------------------
// fingerprints
// ---------------------------------------------------------------------------

/**
 * @param {{ contractPath: string, questionBankPath: string, questionBank: object, deps?: object }} input
 */
export function computeFingerprints({ contractPath, questionBankPath, questionBank, deps = {} }) {
  const git = (deps.git ?? defaultGit)();
  const budgetDigest = `sha256:${createHash("sha256")
    .update(JSON.stringify(ABSOLUTE_BUDGETS))
    .digest("hex")}`;
  return {
    contractDigest: sha256FileDigest(contractPath),
    questionSetDigest: sha256FileDigest(questionBankPath),
    configDigest: questionBank?.requiredConfigFingerprint ?? null,
    budgetDigest,
    fixtureDigest: null,
    candidateFingerprint: git.candidateFingerprint,
    environmentFingerprint: null
  };
}

/**
 * Read-only git facts (candidate identity). Never fails the run: an unknown
 * candidate simply stays BLOCKED later on comparability.
 */
function defaultGit() {
  let sha = null;
  let dirty = null;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    dirty =
      execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" }).trim() !== "";
  } catch {
    sha = null;
    dirty = null;
  }
  return {
    candidateFingerprint: sha ? `git:${sha}${dirty ? "+dirty" : ""}` : null,
    gitSha: sha,
    gitDirty: dirty
  };
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------

/**
 * Execute one scenario group: N attempts (single lane) or waves × lanes
 * (concurrent groups). A denial scenario runs its legal control in the same
 * window (Spec D16).
 *
 * @param {object} input
 */
export async function executeScenarioGroup({
  plan,
  sampleCount,
  runId,
  digests,
  options,
  deps = {},
  env = process.env
}) {
  const problems = [];
  const attempts = [];
  const controlAttempts = [];
  const concurrency = { plannedLanes: plan.lanes, plannedWaves: plan.waves, plannedAttempts: 0 };
  const tracker = deps.tracker ?? createInFlightTracker({ now: deps.now });
  const lanes = plan.lanes;
  const waves = plan.waves;
  const total = lanes > 1 ? waves * lanes : sampleCount;
  concurrency.plannedAttempts = total;
  // A single-lane scenario runs its samples one after another; a concurrent
  // group runs `waves` waves of `lanes` parallel journeys.
  const rounds = lanes > 1 ? waves : sampleCount;

  const tokenFor = (tokenRef) => {
    const resolved = resolveTokenRef(tokenRef, { ...env, ...(options.tokenEnv ?? {}) });
    if (!resolved.ok) {
      problems.push(`${plan.scenarioId}:${tokenRef}: ${resolved.reason}`);
      return null;
    }
    return resolved.token;
  };

  const isRetryable = (journey) =>
    journey?.outcome === "timeout" || journey?.errorClass === "transport_error";

  const tokenPool = resolveConcurrencyTokenPool(options, env);
  const runLane = async (laneIndex, attemptIndex) => {
    const planItemId = `${runId}-${plan.scenarioId}-${String(attemptIndex + 1).padStart(4, "0")}`;
    const maxRetries = Math.max(0, Number(deps.maxRetries ?? 0));
    // 并发档按 lane 轮换独立身份（fixtures §5：20／50 个不同合成 Agent 各持
    // 独立 Token；产品按 token 限并发，单 token 高并发必被 admission 拒绝）。
    const token = lanes > 1 && tokenPool.length > 0
      ? tokenPool[laneIndex % tokenPool.length]
      : tokenFor(plan.tokenRef);
    if (!token) return null;
    const records = [];
    const controlRecords = [];
    let previousAttemptId = null;
    let previousControlAttemptId = null;

    for (let retry = 0; retry <= maxRetries; retry += 1) {
      const laneId = `lane-${laneIndex}-a${attemptIndex + 1}-r${retry}`;
      const client = createPerformanceMcpClient({
        baseUrl: options.mcpUrl,
        token,
        fetchImpl: deps.fetchImpl,
        now: deps.now,
        tracker,
        laneId
      });
      let legalClient = null;
      if (plan.legalControl) {
        const legalToken = tokenFor(plan.legalControl.tokenRef);
        if (legalToken) {
          legalClient = createPerformanceMcpClient({
            baseUrl: options.mcpUrl,
            token: legalToken,
            fetchImpl: deps.fetchImpl,
            now: deps.now,
            tracker,
            laneId: `${laneId}-control`
          });
        }
      }
      // The legal control runs in the same window as the denial (Spec D16).
      const [journey, legalJourney] = await Promise.all([
        runMcpPerformanceJourney({
          client,
          scenario: {
            scenarioId: plan.scenarioId,
            questionRef: plan.questionCaseId,
            budgetClass: plan.budgetClass,
            cacheState: plan.cacheState,
            concurrencyGroup: plan.concurrencyGroup
          },
          control: plan.control,
          oracle: plan.oracle,
          expectedOutcome: plan.expectedOutcome,
          deadlineMs: deps.deadlineMs ?? null,
          signal: deps.signal ?? null
        }),
        legalClient
          ? runMcpPerformanceJourney({
              client: legalClient,
              scenario: {
                scenarioId: plan.legalControl.scenarioId,
                questionRef: plan.legalControl.caseId,
                budgetClass: plan.legalControl.budgetClass,
                cacheState: plan.cacheState,
                concurrencyGroup: plan.concurrencyGroup
              },
              control: {
                ...plan.legalControl.control,
                identityId: plan.legalControl.identityId,
                role: plan.legalControl.role
              },
              oracle: plan.legalControl.oracle,
              expectedOutcome: "allow",
              deadlineMs: deps.deadlineMs ?? null,
              signal: deps.signal ?? null
            })
          : Promise.resolve(null)
      ]);

      const retryable = isRetryable(journey) || isRetryable(legalJourney);
      const attemptId = `${planItemId}-r${retry}`;
      const receipts = tracker.receipts.filter(
        (r) => r.laneId === laneId || r.laneId === `${laneId}-control`
      );
      const record = buildAttemptRecord({
        runId,
        scenario: {
          scenarioId: plan.scenarioId,
          questionRef: plan.questionCaseId,
          budgetClass: plan.budgetClass,
          ownerBudgetClass: plan.ownerBudgetClass,
          cacheState: plan.cacheState,
          concurrencyGroup: plan.concurrencyGroup,
          oracleRef: plan.oracleRef
        },
        attemptId,
        planItemId,
        retryOf: previousAttemptId,
        firstAttempt: retry === 0,
        finalAttempt: !retryable || retry === maxRetries,
        journey,
        digests,
        clientFingerprint: options.clientFingerprint ?? null,
        modelFingerprint: options.modelFingerprint ?? null,
        environmentFingerprint: digests.environmentFingerprint ?? null,
        laneId,
        plannedLanes: lanes,
        receipts: receipts.map((r) => ({
          receiptId: r.receiptId,
          admittedAtMs: r.admittedAtMs,
          settledAtMs: r.settledAtMs,
          outcome: r.outcome,
          laneId: r.laneId
        })),
        startedAtUtc: new Date().toISOString(),
        endedAtUtc: new Date().toISOString()
      });
      record.legalControlAttemptId = null;
      records.push(record);
      previousAttemptId = attemptId;

      let controlRecord = null;
      if (legalJourney) {
        const controlAttemptId = `${planItemId}-control-r${retry}`;
        controlRecord = buildAttemptRecord({
          runId,
          scenario: {
            scenarioId: plan.legalControl.scenarioId,
            questionRef: plan.legalControl.caseId,
            budgetClass: plan.legalControl.budgetClass,
            ownerBudgetClass: plan.legalControl.ownerBudgetClass,
            cacheState: plan.cacheState,
            concurrencyGroup: plan.concurrencyGroup,
            oracleRef: plan.legalControl.oracle?.ref ?? null
          },
          attemptId: controlAttemptId,
          planItemId: `${planItemId}-control`,
          retryOf: previousControlAttemptId,
          firstAttempt: retry === 0,
          finalAttempt: !retryable || retry === maxRetries,
          journey: legalJourney,
          digests,
          clientFingerprint: options.clientFingerprint ?? null,
          modelFingerprint: options.modelFingerprint ?? null,
          environmentFingerprint: digests.environmentFingerprint ?? null,
          laneId: `${laneId}-control`,
          plannedLanes: lanes,
          receipts: tracker.receipts
            .filter((r) => r.laneId === `${laneId}-control`)
            .map((r) => ({
              receiptId: r.receiptId,
              admittedAtMs: r.admittedAtMs,
              settledAtMs: r.settledAtMs,
              outcome: r.outcome,
              laneId: r.laneId
            })),
          startedAtUtc: new Date().toISOString(),
          endedAtUtc: new Date().toISOString()
        });
        controlRecord.pairedDenialAttemptId = attemptId;
        controlRecords.push(controlRecord);
        previousControlAttemptId = controlAttemptId;
        record.legalControlAttemptId = controlAttemptId;
      }

      if (!retryable) break;
    }
    return { records, controlRecords };
  };

  for (let round = 0; round < rounds; round += 1) {
    const jobs = [];
    for (let lane = 0; lane < lanes; lane += 1) {
      const attemptIndex = lanes > 1 ? round * lanes + lane : round;
      jobs.push(runLane(lane, attemptIndex));
    }
    const results = await Promise.all(jobs);
    for (const result of results) {
      if (!result) continue;
      attempts.push(...result.records);
      controlAttempts.push(...result.controlRecords);
    }
  }

  const inFlight = tracker.computeInFlight();
  concurrency.actualInFlightPeak = inFlight.peakRequests;
  concurrency.actualConcurrentLanePeak = inFlight.peakLanes;
  concurrency.receiptCount = inFlight.receipts;
  concurrency.droppedInstantReceipts = inFlight.droppedInstant;
  concurrency.achieved = lanes > 1 ? inFlight.peakLanes >= lanes : true;
  concurrency.reasons = [];
  if (lanes > 1 && !concurrency.achieved) {
    concurrency.reasons.push(
      `actual in-flight peak ${inFlight.peakLanes} < planned ${lanes} lanes: the concurrency condition was never reached (Spec §5.3)`
    );
  }
  return { attempts, controlAttempts, concurrency, problems };
}

// ---------------------------------------------------------------------------
// baseline
// ---------------------------------------------------------------------------

/**
 * Read the baseline record for one scenario key out of a baseline document.
 * The baseline may hold the scenarios as an array of entries or as a map
 * keyed by scenarioId (Spec §6.2).
 * @param {object} doc
 * @param {string} scenarioId
 */
export function baselineRecordFor(doc, scenarioId) {
  if (!doc || typeof doc !== "object") return null;
  const buckets = [doc.scenarios, doc.perScenario, doc.baselines, doc];
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object") continue;
    if (Array.isArray(bucket)) {
      const hit = bucket.find((entry) => entry?.scenarioId === scenarioId);
      if (hit) return hit;
      continue;
    }
    if (bucket[scenarioId]) return bucket[scenarioId];
  }
  return null;
}

/**
 * Digest of the fixture material this scenario actually consumed (question,
 * identity, MCP control and oracle from the P1-54 question bank). The global
 * data fixture digest stays owned by the scale baseline / P1-34; this digest
 * binds what the attempt really ran against.
 * @param {object} plan
 */
export function fixtureDigestForPlan(plan) {
  const material = {
    scenarioId: plan?.scenarioId ?? null,
    caseId: plan?.questionCaseId ?? null,
    identityId: plan?.identityId ?? null,
    role: plan?.role ?? null,
    control: plan?.control ?? null,
    oracle: plan?.oracle ?? null,
    legalControl: plan?.legalControl
      ? {
          caseId: plan.legalControl.caseId,
          identityId: plan.legalControl.identityId,
          control: plan.legalControl.control,
          oracle: plan.legalControl.oracle
        }
      : null
  };
  return `sha256:${createHash("sha256").update(JSON.stringify(material)).digest("hex")}`;
}

/**
 * @param {string} baselinePath
 */
export function readBaselineDocument(baselinePath) {
  if (!baselinePath || !existsSync(baselinePath)) return null;
  const raw = JSON.parse(readFileSync(baselinePath, "utf8"));
  // LATEST.json style pointer: follow it relative to the pointer file.
  const target = raw?.baselineFile ?? raw?.pointerTo ?? raw?.baselinePath ?? raw?.path ?? null;
  if (target && !raw.scenarios && !raw.perScenario && !raw.baselines) {
    const resolved = path.resolve(path.dirname(baselinePath), target);
    if (existsSync(resolved)) return JSON.parse(readFileSync(resolved, "utf8"));
  }
  return raw;
}
// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

/**
 * Run the deterministic Public MCP performance lane.
 *
 * @param {object} options
 * @param {object} [deps]
 */
export async function runMcpInquiryPerformance(options, deps = {}) {
  const dispatch = TRIGGER_DISPATCH[options.trigger];
  if (!dispatch) {
    return { status: "BLOCKED", reasons: [`unknown trigger ${options.trigger}`], exitCode: EXIT_CODES.blocked };
  }
  // Task 5 接线：隔离栈测程在规模断言（--profile mcp-perf）PASS 后以
  // MIP_SCALE_PROFILE_SATISFIED=1 声明 WIDE 场景的 profile 前置满足；
  // 未经断言的独立 runner 调用保持 BLOCKED（fail-closed，不缩规模开跑）。
  if (deps.scaleProfileSatisfied === undefined && process.env.MIP_SCALE_PROFILE_SATISFIED === "1") {
    deps = { ...deps, scaleProfileSatisfied: true };
  }
  if (dispatch.lane === "soak" || dispatch.lane === "long-follow") {
    return runSoakLongFollowLane(options, deps);
  }
  const now = deps.now ?? (() => Date.now());
  const startedAtMs = now();
  const problems = [];
  const contract = deps.contract ?? loadScenarioContract(options.contractPath);
  const questionBank = deps.questionBank ?? loadQuestionBank(options.questionBankPath);
  const selection = selectScenarios({
    contract,
    trigger: options.trigger,
    requested: options.scenarioIds ?? []
  });
  problems.push(...selection.problems);

  const digests = {
    ...(deps.digests ??
      computeFingerprints({
        contractPath: options.contractPath,
        questionBankPath: options.questionBankPath,
        questionBank,
        deps
      }))
  };
  digests.environmentFingerprint =
    digests.environmentFingerprint ??
    `sha256:${createHash("sha256")
      .update(JSON.stringify({ baseUrl: options.mcpUrl, profile: questionBank?.configProfileId ?? null }))
      .digest("hex")}`;

  const runId = deps.runId ?? `mip-${startedAtMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const attempts = [];
  const controlAttempts = [];
  const groups = [];
  const legalControls = [];
  const concurrencyReports = [];
  const fairnessReports = [];
  const planProblems = [];

  const baselineDoc = deps.baselineDocument ?? readBaselineDocument(options.baselinePath);
  if (dispatch.requiresBaseline && !baselineDoc) {
    problems.push(
      `${options.trigger} requires an accepted baseline (--baseline); without it the run is BLOCKED (Spec §7)`
    );
  }

  for (const scenario of selection.scenarios) {
    const plan = resolveScenarioPlan({
      scenario,
      questionBank,
      scaleProfileSatisfied: Boolean(deps.scaleProfileSatisfied)
    });
    if (plan.problems.length) {
      planProblems.push(...plan.problems);
      continue;
    }
    const sampleCount =
      deps.sampleCountOverride ?? sampleFloorFor(scenario, dispatch.tier);
    const scenarioDigests = { ...digests, fixtureDigest: fixtureDigestForPlan(plan) };
    const result = await executeScenarioGroup({
      plan,
      sampleCount,
      runId,
      digests: scenarioDigests,
      options,
      deps
    });
    problems.push(...result.problems);
    attempts.push(...result.attempts);
    controlAttempts.push(...result.controlAttempts);
    concurrencyReports.push({
      scenarioId: plan.scenarioId,
      ...result.concurrency
    });
    fairnessReports.push({
      scenarioId: plan.scenarioId,
      ...summarizeRoleFairness(result.attempts)
    });
    groups.push({
      scenarioId: plan.scenarioId,
      lane: "mcp",
      budgetClass: plan.budgetClass,
      ownerBudgetClass: plan.ownerBudgetClass,
      cacheState: plan.cacheState,
      concurrencyGroup: plan.concurrencyGroup,
      clientModel: `${options.clientFingerprint ?? "unknown"}::${options.modelFingerprint ?? "unknown"}`,
      environment: digests.environmentFingerprint,
      expectedOutcome: plan.expectedOutcome,
      plannedCount: result.concurrency.plannedAttempts,
      attempts: result.attempts,
      initializeSamples: result.attempts
        .map((a) => a.initializeRttMs)
        .filter((v) => Number.isFinite(v)),
      baseline: baselineRecordFor(baselineDoc, plan.scenarioId)
    });
    if (plan.legalControl) {
      groups.push({
        scenarioId: plan.legalControl.scenarioId,
        lane: "mcp",
        budgetClass: plan.legalControl.budgetClass,
        ownerBudgetClass: plan.legalControl.ownerBudgetClass,
        cacheState: plan.cacheState,
        concurrencyGroup: plan.concurrencyGroup,
        clientModel: `${options.clientFingerprint ?? "unknown"}::${options.modelFingerprint ?? "unknown"}`,
        environment: digests.environmentFingerprint,
        expectedOutcome: "allow",
        plannedCount: result.controlAttempts.length,
        attempts: result.controlAttempts,
        initializeSamples: result.controlAttempts
          .map((a) => a.initializeRttMs)
          .filter((v) => Number.isFinite(v)),
        baseline: baselineRecordFor(baselineDoc, plan.legalControl.scenarioId)
      });
      legalControls.push({
        denialScenarioId: plan.scenarioId,
        controlScenarioId: plan.legalControl.scenarioId
      });
    }
  }

  problems.push(...planProblems);

  const allAttempts = [...attempts, ...controlAttempts];
  const verdict = aggregatePerformance({
    tier: dispatch.tier,
    groups,
    legalControls,
    candidateDigest: digests.candidateFingerprint,
    now: now()
  });

  // Runner-level gates the judge does not own: real concurrency and role fairness.
  const gateReasons = [];
  for (const report of concurrencyReports) {
    if (report.achieved === false) {
      gateReasons.push(`${report.scenarioId}: ${report.reasons.join("; ")}`);
    }
  }
  for (const report of fairnessReports) {
    if (report.fair === false) {
      gateReasons.push(`${report.scenarioId}: ${report.reasons.join("; ")}`);
    }
  }
  for (const attempt of allAttempts) {
    if (attempt.errorClass === "cancelled") {
      gateReasons.push(`${attempt.attemptId}: cancelled attempt retained in the denominator`);
    }
  }

  let status = verdict.status;
  const reasons = [...(verdict.reasons ?? []), ...problems, ...gateReasons];
  if (gateReasons.length && status === "PASS") status = "BLOCKED";
  if (problems.length && status === "PASS") status = "BLOCKED";

  const evidence = deps.writeEvidence
    ? deps.writeEvidence({ runId, attempts: allAttempts, options })
    : null;

  return {
    status,
    exitCode:
      status === "PASS"
        ? EXIT_CODES.passed
        : status === "BLOCKED"
          ? EXIT_CODES.blocked
          : EXIT_CODES.failed,
    runId,
    trigger: options.trigger,
    tier: dispatch.tier,
    reasons,
    verdict,
    attempts: allAttempts,
    groups,
    concurrencyReports,
    fairnessReports,
    digests,
    evidence,
    startedAtMs,
    finishedAtMs: now()
  };
}

// ---------------------------------------------------------------------------
// dry run
// ---------------------------------------------------------------------------

/**
 * Validate arguments, the scenario contract and the fingerprints — and nothing
 * else. No evidence, no baseline, no performance verdict (Spec §7 / Plan Task 3).
 *
 * @param {object} options
 * @param {object} [deps]
 */
export function runDryRun(options, deps = {}) {
  const dispatch = TRIGGER_DISPATCH[options.trigger];
  if (dispatch && (dispatch.lane === "soak" || dispatch.lane === "long-follow")) {
    return runSoakLongFollowDryRun(options, deps);
  }
  const problems = [];
  if (!dispatch) problems.push(`unknown trigger ${options.trigger}`);
  const contract = deps.contract ?? loadScenarioContract(options.contractPath);
  const questionBank = deps.questionBank ?? loadQuestionBank(options.questionBankPath);
  const selection = selectScenarios({
    contract,
    trigger: options.trigger,
    requested: options.scenarioIds ?? []
  });
  problems.push(...selection.problems);

  const digests = computeFingerprints({
    contractPath: options.contractPath,
    questionBankPath: options.questionBankPath,
    questionBank,
    deps
  });

  const plans = [];
  for (const scenario of selection.scenarios) {
    const plan = resolveScenarioPlan({
      scenario,
      questionBank,
      scaleProfileSatisfied: Boolean(deps.scaleProfileSatisfied)
    });
    problems.push(...plan.problems);
    plans.push({
      scenarioId: plan.scenarioId,
      family: scenario.family,
      budgetClass: plan.budgetClass,
      cacheState: plan.cacheState,
      concurrencyGroup: plan.concurrencyGroup,
      lanes: plan.lanes,
      waves: plan.waves,
      questionRef: plan.questionCaseId,
      oracleRef: plan.oracleRef,
      expectedOutcome: plan.expectedOutcome,
      legalControlRef: plan.legalControl?.caseId ?? null,
      sampleFloorMcp: sampleFloorFor(scenario, dispatch?.tier ?? "pr")
    });
  }

  const baselineDoc = deps.baselineDocument ?? readBaselineDocument(options.baselinePath);
  if (dispatch?.requiresBaseline && !baselineDoc) {
    problems.push(`${options.trigger} requires an accepted baseline (--baseline)`);
  }

  return {
    status: "NOT RUN",
    dryRun: true,
    releaseReady: false,
    trigger: options.trigger,
    tier: dispatch?.tier ?? null,
    scenarios: plans,
    problems,
    digests,
    baseline: baselineDoc ? { present: true, path: options.baselinePath } : { present: false, path: options.baselinePath },
    evidenceWritten: false,
    baselineWritten: false
  };
}

/**
 * Render the dry-run report. It must never claim a performance result.
 * @param {object} report
 */
export function formatDryRunReport(report) {
  const lines = [];
  lines.push("MCP inquiry performance — DRY RUN");
  lines.push(`trigger: ${report.trigger}`);
  lines.push(`tier: ${report.tier ?? "(unknown)"}`);
  lines.push(`scenarios: ${report.scenarios.length}`);
  for (const s of report.scenarios) {
    if (s.kind === "soak") {
      lines.push(
        `  - ${s.scenarioId} [soak] identities=${s.identityCount} ` +
          `windows=${s.windows.count}x${s.windows.seconds}s minEffectiveSeconds=${s.minEffectiveSeconds} ` +
          `arrivalModel=${s.arrivalModelRef ?? "(none)"} source=${s.arrivalModelSource} drainMs=${s.drainMs}`
      );
      continue;
    }
    if (s.kind === "long-follow") {
      lines.push(
        `  - ${s.scenarioId} [long-follow] chains=${s.chainCount} ` +
          `requiredChains=${s.requiredChainIds.join(",") || "(none)"} ` +
          `packDigest=${s.packDigest ?? "(none)"} minTotalTurns=${s.minTotalTurns} ` +
          `minFollowUpTurns=${s.minFollowUpTurns} chainInstanceRatio=${s.chainInstanceRatio}`
      );
      continue;
    }
    lines.push(
      `  - ${s.scenarioId} [${s.budgetClass}/${s.cacheState}/${s.concurrencyGroup}] ` +
        `question=${s.questionRef} oracle=${s.oracleRef ?? "none"} ` +
        `expect=${s.expectedOutcome} lanes=${s.lanes} waves=${s.waves} ` +
        `legalControl=${s.legalControlRef ?? "none"} sampleFloorMcp=${s.sampleFloorMcp}`
    );
  }
  lines.push("fingerprints:");
  for (const [key, value] of Object.entries(report.digests)) {
    lines.push(`  ${key}: ${value ?? "(none)"}`);
  }
  lines.push(`baseline: ${report.baseline.present ? "present" : "absent"}`);
  lines.push("evidence written: no");
  lines.push("baseline written: no");
  if (report.problems.length) {
    lines.push("problems:");
    for (const problem of report.problems) lines.push(`  - ${problem}`);
  }
  lines.push("releaseReady: false");
  lines.push("STATUS: NOT RUN");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// evidence
// ---------------------------------------------------------------------------

/**
 * Write `evidence/<runId>/attempts.ndjson` — one attempt per line, exactly the
 * coordination contract shared with the independent verifier.
 *
 * @param {{ runId: string, attempts: object[], evidenceDir: string }} input
 */
export function writeAttemptsNdjson({ runId, attempts, evidenceDir }) {
  const dir = path.join(evidenceDir, runId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "attempts.ndjson");
  const body = attempts
    .map((attempt) => JSON.stringify(attempt))
    .join("\n");
  writeFileSync(file, body.length ? `${body}\n` : "", "utf8");
  return { dir, file, count: attempts.length };
}

/**
 * Structural check of one attempt record against the coordination contract.
 * @param {object} attempt
 */
export function validateAttemptRecord(attempt) {
  const problems = [];
  for (const field of ATTEMPT_REQUIRED_FIELDS) {
    if (!(field in attempt)) {
      problems.push(`missing field ${field}`);
    } else if (attempt[field] === null && !NULLABLE_ATTEMPT_FIELDS.includes(field)) {
      problems.push(`null required field ${field}`);
    }
  }
  for (const field of ATTEMPT_NULLABLE_IDENTITY_FIELDS) {
    if (attempt?.[field] == null && !attempt?.[`${field}MissingReason`]) {
      problems.push(`${field} is absent without a missing reason`);
    }
  }
  if (!Array.isArray(attempt?.mcpCalls)) problems.push("mcpCalls must be an array");
  if (!Array.isArray(attempt?.stages)) problems.push("stages must be an array");
  if (!Number.isFinite(attempt?.unattributedMs)) problems.push("unattributedMs must be a number");
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

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
    return;
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    process.exit(EXIT_CODES.passed);
    return;
  }
  if (parsed.options.dryRun) {
    let report;
    try {
      report = runDryRun(parsed.options);
    } catch (error) {
      process.stderr.write(`${error?.message ?? String(error)}\n`);
      process.exit(EXIT_CODES.blocked);
      return;
    }
    process.stdout.write(`${formatDryRunReport(report)}\n`);
    process.exit(report.problems.length ? EXIT_CODES.blocked : EXIT_CODES.dry_run);
    return;
  }

  const result = await runMcpInquiryPerformance(parsed.options, {
    writeEvidence: ({ runId, attempts, options }) =>
      writeAttemptsNdjson({ runId, attempts, evidenceDir: options.evidenceDir })
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        runId: result.runId,
        trigger: result.trigger,
        tier: result.tier,
        lane: result.lane ?? "mcp",
        reasons: result.reasons,
        attemptCount: result.attempts.length,
        evidencePath: result.evidence?.file ?? null,
        digests: result.digests
      },
      null,
      2
    )}\n`
  );
  process.exit(result.exitCode ?? EXIT_CODES.failed);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((error) => fail(error?.stack ?? String(error), EXIT_CODES.failed));
}
