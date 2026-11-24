/**
 * P1-53 Task 5 — Compose / upgrade / acceptance / release-readiness wiring helpers.
 *
 * Feature flag: LUCY_MCP_COMPAT=1 enables the post-health / post-tools/list hook.
 * Default off → SKIPPED (never invent PASS). When enabled but env/baseline/fingerprint
 * missing → BLOCKED (fail closed). Scripts never auto-trigger production rollback;
 * ROLLBACK_VERIFY only runs after an operator/H4 rollback already happened.
 *
 * Release readiness always re-reads public evidence via evaluateMcpCompatibilityReleaseGate;
 * CI subset and missing files can never set releaseReady=true.
 *
 * Spec: docs/specs/lucy-20261118-mcp-upgrade-compatibility-spec.md §6 / SC-17
 * Plan: docs/plans/lucy-20261118-mcp-upgrade-compatibility-plan.md Task 5
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { EXIT_CODES, REPO_ROOT } from "./common.mjs";
import {
  evaluateMcpCompatibilityReleaseGate,
  verifyMcpCompatibilityEvidenceFiles
} from "./mcp-compatibility-evidence.mjs";

export const MCP_COMPAT_FLAG_ENV = "LUCY_MCP_COMPAT";
export const MCP_COMPAT_ENTRYPOINT_ENV = "LUCY_MCP_COMPAT_ENTRYPOINT";
export const MCP_COMPAT_BASELINE_ENV = "LUCY_MCP_COMPAT_BASELINE";
export const MCP_COMPAT_LANE_ENV = "LUCY_MCP_COMPAT_LANE";
export const MCP_COMPAT_RESULTS_DIR_ENV = "LUCY_MCP_COMPAT_RESULTS_DIR";
export const MCP_COMPAT_MCP_URL_ENV = "LUCY_MCP_URL";
export const MCP_COMPAT_SELECTED_CLIENT_ENV = "COMPAT_SELECTED_CLIENT";

export const MCP_COMPAT_ENTRYPOINTS = Object.freeze(["candidate", "upgrade", "rollback"]);
export const MCP_COMPAT_LANES = Object.freeze(["compose", "customer", "instance", "acceptance"]);

const RUNNER_REL = "scripts/e2e/run-mcp-compatibility.mjs";

function truthyFlag(value) {
  if (value == null || value === "") return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isMcpCompatEnabled(env = process.env) {
  return truthyFlag(env[MCP_COMPAT_FLAG_ENV]);
}

/**
 * Infer entrypoint from explicit env, lane, and whether a rollback already occurred.
 * @param {{ env?: NodeJS.ProcessEnv, lane?: string, rollbackOccurred?: boolean }} opts
 */
export function resolveMcpCompatEntrypoint({
  env = process.env,
  lane = env[MCP_COMPAT_LANE_ENV] ?? "compose",
  rollbackOccurred = false
} = {}) {
  const explicit = env[MCP_COMPAT_ENTRYPOINT_ENV];
  if (explicit) {
    if (!MCP_COMPAT_ENTRYPOINTS.includes(explicit)) {
      return { ok: false, entrypoint: null, reason: `unknown entrypoint ${explicit}` };
    }
    return { ok: true, entrypoint: explicit, reason: null };
  }
  if (rollbackOccurred) {
    return { ok: true, entrypoint: "rollback", reason: null };
  }
  if (lane === "customer" || lane === "instance") {
    return { ok: true, entrypoint: "upgrade", reason: null };
  }
  // compose / acceptance default: candidate certification
  return { ok: true, entrypoint: "candidate", reason: null };
}

/**
 * Build argv for run-mcp-compatibility.mjs (no secrets on argv; tokens via env).
 * @param {{ entrypoint: string, env?: NodeJS.ProcessEnv, repoRoot?: string }} opts
 */
export function buildMcpCompatRunnerArgv({
  entrypoint,
  env = process.env,
  repoRoot = REPO_ROOT
} = {}) {
  if (!MCP_COMPAT_ENTRYPOINTS.includes(entrypoint)) {
    throw new Error(`buildMcpCompatRunnerArgv: bad entrypoint ${entrypoint}`);
  }
  const argv = [entrypoint];
  const mcpUrl = env[MCP_COMPAT_MCP_URL_ENV] ?? env.LUCY_DEMO_MCP_URL;
  if (mcpUrl) {
    argv.push("--mcp-url", mcpUrl);
  }
  const resultsDir = env[MCP_COMPAT_RESULTS_DIR_ENV];
  if (resultsDir) {
    argv.push("--results-dir", path.resolve(resultsDir));
  }
  const baseline = env[MCP_COMPAT_BASELINE_ENV];
  if (baseline) {
    argv.push("--baseline", path.resolve(baseline));
  }
  const selected = env[MCP_COMPAT_SELECTED_CLIENT_ENV] ?? env.COMPAT_SELECTED_CLIENT;
  if (selected) {
    argv.push("--selected-client", selected);
  }
  if (env.COMPAT_COVERAGE_MODE === "ci-subset" || env.LUCY_MCP_COMPAT_COVERAGE_MODE === "ci-subset") {
    argv.push("--coverage-mode", "ci-subset");
  }
  argv.push("--project-root", repoRoot);
  return argv;
}

/**
 * Decide whether the post-acceptance hook should skip, block, or run the runner.
 * Fail closed: enabled + missing required env/baseline → BLOCKED (never fake PASS).
 *
 * @param {object} opts
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.lane]
 * @param {boolean} [opts.rollbackOccurred]
 * @param {boolean} [opts.skipMcp] acceptance --skip-mcp: no publishable evidence
 * @param {string} [opts.repoRoot]
 */
export function resolveMcpCompatHookPlan({
  env = process.env,
  lane = env[MCP_COMPAT_LANE_ENV] ?? "compose",
  rollbackOccurred = false,
  skipMcp = false,
  repoRoot = REPO_ROOT
} = {}) {
  const reasons = [];

  if (skipMcp) {
    return {
      action: "skip",
      status: "SKIPPED",
      entrypoint: null,
      argv: null,
      runnerPath: null,
      reasons: ["--skip-mcp / skipMcp: MCP handshake skipped; no publishable MCP compatibility evidence"],
      exitCode: EXIT_CODES.skipped,
      publishable: false
    };
  }

  if (!isMcpCompatEnabled(env)) {
    return {
      action: "skip",
      status: "SKIPPED",
      entrypoint: null,
      argv: null,
      runnerPath: null,
      reasons: [
        `${MCP_COMPAT_FLAG_ENV} unset/off: hook skipped (health/tools/list alone is not MCP compatibility PASS)`
      ],
      exitCode: EXIT_CODES.skipped,
      publishable: false
    };
  }

  const resolved = resolveMcpCompatEntrypoint({ env, lane, rollbackOccurred });
  if (!resolved.ok) {
    return {
      action: "block",
      status: "BLOCKED",
      entrypoint: null,
      argv: null,
      runnerPath: null,
      reasons: [resolved.reason],
      exitCode: EXIT_CODES.blocked,
      publishable: false
    };
  }
  const entrypoint = resolved.entrypoint;

  const mcpUrl = env[MCP_COMPAT_MCP_URL_ENV] ?? env.LUCY_DEMO_MCP_URL;
  if (!mcpUrl) {
    reasons.push(`missing ${MCP_COMPAT_MCP_URL_ENV} (or LUCY_DEMO_MCP_URL)`);
  }

  // Instance / customer upgrade + rollback require private baseline.
  if (entrypoint === "upgrade" || entrypoint === "rollback") {
    const baseline = env[MCP_COMPAT_BASELINE_ENV];
    if (!baseline) {
      reasons.push(
        `BASELINE_MISSING: ${entrypoint} on ${lane} lane requires ${MCP_COMPAT_BASELINE_ENV}`
      );
    } else if (!existsSync(path.resolve(baseline))) {
      reasons.push(`BASELINE_MISSING: private baseline not found at ${baseline}`);
    }
  }

  if (rollbackOccurred && entrypoint !== "rollback") {
    reasons.push(
      "ROLLBACK_VERIFY required: rollbackOccurred=true but entrypoint is not rollback"
    );
  }

  if (reasons.length) {
    return {
      action: "block",
      status: "BLOCKED",
      entrypoint,
      argv: null,
      runnerPath: path.join(repoRoot, RUNNER_REL),
      reasons,
      exitCode: EXIT_CODES.blocked,
      publishable: false
    };
  }

  const argv = buildMcpCompatRunnerArgv({ entrypoint, env, repoRoot });
  return {
    action: "run",
    status: "READY",
    entrypoint,
    argv,
    runnerPath: path.join(repoRoot, RUNNER_REL),
    reasons: [],
    exitCode: EXIT_CODES.passed,
    publishable: true
  };
}

/**
 * Require ROLLBACK_VERIFY after an operator/H4 rollback when MCP compat is enabled.
 * Does not itself perform helm/docker rollback.
 *
 * @param {{ env?: NodeJS.ProcessEnv, rollbackOccurred: boolean, lane?: string }} opts
 */
export function requireRollbackVerifyPlan({
  env = process.env,
  rollbackOccurred,
  lane = env[MCP_COMPAT_LANE_ENV] ?? "instance"
} = {}) {
  if (!rollbackOccurred) {
    return {
      action: "skip",
      status: "SKIPPED",
      reasons: ["no rollback occurred; ROLLBACK_VERIFY not required"],
      exitCode: EXIT_CODES.skipped
    };
  }
  // Default-off must stay SKIPPED (CI H4 --test-rollback always fires this path).
  // Enabling LUCY_MCP_COMPAT is what makes ROLLBACK_VERIFY mandatory / fail-closed.
  if (!isMcpCompatEnabled(env)) {
    return {
      action: "skip",
      status: "SKIPPED",
      reasons: [
        `rollback occurred but ${MCP_COMPAT_FLAG_ENV} unset/off: ROLLBACK_VERIFY deferred (not a business-recovery PASS claim)`
      ],
      exitCode: EXIT_CODES.skipped,
      publishable: false
    };
  }
  return resolveMcpCompatHookPlan({
    env: { ...env, [MCP_COMPAT_ENTRYPOINT_ENV]: "rollback" },
    lane,
    rollbackOccurred: true
  });
}

/**
 * Fold MCP compatibility evidence into a customer-release verdict.
 * Missing evidence / FAIL / BLOCKED / ci-subset ⇒ releaseReady=false.
 *
 * @param {object} opts
 * @param {string} opts.runDir
 * @param {object} [opts.verdict] existing readiness verdict to gate
 * @param {boolean} [opts.ciSubset]
 * @param {"candidate"|"instance"|"both"} [opts.require]
 * @param {object} [opts.suite]
 * @param {(args: object) => object} [opts.verifyFiles] injectable for tests
 * @param {(args: object) => object} [opts.evaluateGate] injectable for tests
 */
export function applyMcpCompatibilityReleaseGate({
  runDir,
  verdict = null,
  ciSubset = false,
  require = "candidate",
  suite,
  verifyFiles = verifyMcpCompatibilityEvidenceFiles,
  evaluateGate = evaluateMcpCompatibilityReleaseGate
} = {}) {
  if (!runDir || typeof runDir !== "string") {
    throw new Error("applyMcpCompatibilityReleaseGate requires runDir");
  }

  const fileGate = verifyFiles({
    runDir,
    suite,
    require,
    ciSubset
  });

  // Prefer the file verifier's aggregate; re-run evaluate for explicit extension-point coverage.
  const gate =
    evaluateGate({
      results: {
        candidate: fileGate.candidate,
        instance: fileGate.instance
      },
      ciSubset: ciSubset || fileGate.candidate?.coverageMode === "ci-subset"
    }) ?? fileGate;

  const problems = [...(verdict?.problems ?? []), ...(gate.problems ?? [])];
  const releaseReady =
    verdict?.releaseReady === true && gate.releaseReady === true && gate.status === "PASS";

  let status = verdict?.status ?? gate.status;
  if (gate.status === "BLOCKED" || gate.releaseReady !== true) {
    if (status === "passed" || status === "PASS") {
      status = gate.status === "BLOCKED" ? "blocked" : gate.status === "FAIL" ? "failed" : "blocked";
    }
  }

  // Map runner-style PASS/FAIL/BLOCKED onto readiness status vocabulary when no prior verdict.
  if (!verdict) {
    status =
      gate.status === "PASS"
        ? "passed"
        : gate.status === "FAIL"
          ? "failed"
          : gate.status === "BLOCKED"
            ? "blocked"
            : "blocked";
  }

  const exitCode =
    status === "passed"
      ? EXIT_CODES.passed
      : status === "blocked"
        ? EXIT_CODES.blocked
        : status === "failed"
          ? EXIT_CODES.failed
          : EXIT_CODES.blocked;

  return {
    ...verdict,
    status,
    exitCode: verdict && status === verdict.status ? verdict.exitCode : exitCode,
    releaseReady: Boolean(releaseReady),
    problems,
    mcpCompatibility: {
      status: gate.status,
      releaseReady: gate.releaseReady,
      problems: gate.problems,
      candidate: gate.candidate ?? null,
      instance: gate.instance ?? null
    }
  };
}

/**
 * Documented env contract for Compose / upgrade operators (SC-17).
 */
export const MCP_COMPAT_WIRING_ENV_CONTRACT = Object.freeze({
  enableFlag: MCP_COMPAT_FLAG_ENV,
  entrypoint: MCP_COMPAT_ENTRYPOINT_ENV,
  baseline: MCP_COMPAT_BASELINE_ENV,
  lane: MCP_COMPAT_LANE_ENV,
  mcpUrl: MCP_COMPAT_MCP_URL_ENV,
  resultsDir: MCP_COMPAT_RESULTS_DIR_ENV,
  selectedClient: MCP_COMPAT_SELECTED_CLIENT_ENV,
  notes: Object.freeze([
    "Default off: health/tools/list alone is not MCP compatibility PASS.",
    "LUCY_MCP_COMPAT=1 enables post-acceptance candidate/upgrade/rollback hook.",
    "Customer/instance upgrade requires LUCY_MCP_COMPAT_BASELINE (private 0600 file).",
    "After operator/H4 rollback, set entrypoint=rollback (ROLLBACK_VERIFY); scripts never auto-rollback production.",
    "Release readiness calls evaluateMcpCompatibilityReleaseGate; missing evidence or ci-subset ⇒ releaseReady=false.",
    "Wave D (env authorization) still required for full live Agent denominator / UAT INDEX=PASS."
  ])
});
