#!/usr/bin/env node
// P1-6 upgrade candidate verification executor (NON-GATING).
//
// Scope: docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md
// Plan:  docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md section 8
//
// The verification channel is: consistent backup of a live instance -> empty volume ->
// whole-volume overwrite -> latest security state -> candidate start -> structure and
// continuity assertions -> cleanup. It proves the candidate's migration of a COMPLETE old
// volume; it can NOT prove that a revocation is not rolled back (only an in-place upgrade
// without replacing the volume can prove that).
//
// It shares the five-state engine with the P1-5 executor (scripts/e2e/run-upgrade.mjs):
//   E1 five-state machine + stable reason codes
//   E2 identity precheck before any mutation
//   E3 isolation / ownership assertions
//   E4 empty-volume start first, whole-volume overwrite second
//   E5 layered security-state injection + session rotation (unknown source => security SKIPPED)
//   E6 structure baseline as a hard assertion (mixed state => FAILED)
//   E7 independent replay on a second fresh empty volume
//   E8 redacted artifacts; never release-readiness.json / ops.json / a signed bundle
//   E9 refusal paths with stable reason codes
//
// This executor never publishes a release decision and never writes release evidence.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, exitCodeFor } from "../e2e/lib/common.mjs";
import {
  BLOCK_CATEGORY,
  CANDIDATE_REQUIRED_CAPABILITIES,
  CANDIDATE_VERIFICATION_CONTRACT,
  REASON,
  RVC_STAGES,
  STATUS,
  aggregateStatus,
  blockedAssertions,
  buildDefaultPlan,
  compareReplay,
  evaluateAdapter,
  evaluateBackup,
  evaluateCapabilities,
  evaluateIdentity,
  evaluateIsolation,
  evaluateSecuritySource,
  evaluateStructureBaseline,
  evaluateVolumeStart,
  loadPlanFile,
  namespacePartition,
  projectEntries,
  renderScenarioReport,
  summarize,
  writeScenarioArtifacts,
  assertArtifactPolicy,
} from "../e2e/run-upgrade.mjs";

export const CANDIDATE_PHASES = Object.freeze([
  { id: "preflight", stage: "preflight" },
  { id: "empty_volume", stage: "empty_volume" },
  { id: "restore", stage: "restore" },
  { id: "security", stage: "security" },
  { id: "start", stage: "start" },
  { id: "structure", stage: "structure" },
  { id: "assertions", stage: "assertions" },
  { id: "replay", stage: "replay" },
  { id: "teardown", stage: "teardown" },
]);

async function callAdapter(ctx, method, args = {}) {
  const fn = ctx.adapter?.[method];
  if (typeof fn !== "function") {
    return { ok: false, status: STATUS.UNIMPLEMENTED, reason: REASON.MISSING_IMPLEMENTATION, category: BLOCK_CATEGORY.IMPLEMENTATION, method };
  }
  try {
    return { ok: true, value: await fn.call(ctx.adapter, { ...args, ctx }) };
  } catch (error) {
    return { ok: false, status: STATUS.FAILED, reason: REASON.ADAPTER_ERROR, category: null, method, detail: error?.message ?? String(error) };
  }
}

function normalizeAssertion(raw) {
  if (!raw || typeof raw !== "object") {
    return { status: STATUS.UNIMPLEMENTED, reason: REASON.MISSING_IMPLEMENTATION, category: BLOCK_CATEGORY.IMPLEMENTATION, evidence: null };
  }
  const status = typeof raw.status === "string" ? raw.status.toUpperCase() : "";
  if (!Object.values(STATUS).includes(status)) {
    return { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, evidence: raw.evidence ?? null };
  }
  return { status, reason: raw.reason ?? null, category: raw.category ?? null, evidence: raw.evidence ?? null };
}

/* ------------------------------------------------------------------ phases */

async function preflightPhase(ctx) {
  const identity = evaluateIdentity(ctx.plan.identity);
  if (identity.status !== STATUS.PASSED) {
    return {
      status: identity.status,
      reason: identity.reason,
      category: identity.category,
      detail: identity.detail,
      assertions: blockedAssertions(["RVC-01", "RVC-02"], identity.reason, identity.category, "identity"),
    };
  }
  const isolation = evaluateIsolation(ctx.plan.deployment);
  if (isolation.status !== STATUS.PASSED) {
    return {
      status: isolation.status,
      reason: isolation.reason,
      category: isolation.category,
      detail: isolation.detail,
      assertions: blockedAssertions(["RVC-01", "RVC-02"], isolation.reason, isolation.category, "isolation"),
    };
  }
  const adapter = evaluateAdapter(ctx.adapter, ctx.plan.deployment?.form);
  if (adapter.status !== STATUS.PASSED) {
    return {
      status: adapter.status,
      reason: adapter.reason,
      category: adapter.category,
      detail: { missing: adapter.missing },
      assertions: blockedAssertions(["RVC-01", "RVC-02"], adapter.reason, adapter.category, "adapter", adapter.status),
    };
  }
  const capabilities = evaluateCapabilities(ctx.plan.capabilities, CANDIDATE_REQUIRED_CAPABILITIES);
  if (capabilities.status !== STATUS.PASSED) {
    return {
      status: capabilities.status,
      reason: capabilities.reason,
      category: capabilities.category,
      detail: { missing: capabilities.missing },
      assertions: blockedAssertions(["RVC-01", "RVC-02"], capabilities.reason, capabilities.category, "capabilities", capabilities.status),
    };
  }
  // RVC-01: backup consistency is verified before anything is created.
  const backup = evaluateBackup(ctx.plan.backup);
  if (backup.status !== STATUS.PASSED) {
    return {
      status: backup.status,
      reason: backup.reason,
      category: backup.category,
      detail: backup.detail,
      assertions: {
        "RVC-01": { status: backup.status, reason: backup.reason, category: backup.category, evidence: { backup: ctx.plan.backup ?? null } },
        "RVC-02": { status: STATUS.PASSED, reason: null, category: null, evidence: { isolation: isolation.detail?.checks ?? [] } },
      },
    };
  }
  return {
    status: STATUS.PASSED,
    assertions: {
      "RVC-01": { status: STATUS.PASSED, reason: null, category: null, evidence: { backup: ctx.plan.backup } },
      "RVC-02": { status: STATUS.PASSED, reason: null, category: null, evidence: { isolation: isolation.detail?.checks ?? [] } },
    },
  };
}

async function emptyVolumePhase(ctx) {
  const created = await callAdapter(ctx, "createEmptyVolume");
  if (!created.ok) {
    return { status: created.status, reason: created.reason, category: created.category, detail: created.detail ?? null, assertions: blockedAssertions(["RVC-03"], created.reason, created.category, "empty_volume", created.status) };
  }
  const volume = created.value ?? {};
  const verdict = evaluateVolumeStart(volume);
  if (verdict.status !== STATUS.PASSED) {
    return {
      status: verdict.status,
      reason: verdict.reason,
      category: verdict.category,
      detail: verdict.detail,
      assertions: { "RVC-03": { status: verdict.status, reason: verdict.reason, category: verdict.category, evidence: { volume } } },
    };
  }
  ctx.state.volume = volume;
  return { status: STATUS.PASSED, assertions: { "RVC-03": { status: STATUS.PASSED, reason: null, category: null, evidence: { volume } } } };
}

async function restorePhase(ctx) {
  const restored = await callAdapter(ctx, "restoreWholeVolume");
  if (!restored.ok) {
    return { status: restored.status, reason: restored.reason, category: restored.category, detail: restored.detail ?? null, assertions: blockedAssertions(["RVC-04"], restored.reason, restored.category, "restore", restored.status) };
  }
  const value = restored.value ?? {};
  if (value.manifestMatched === false) {
    return {
      status: STATUS.FAILED,
      reason: REASON.RESTORE_MANIFEST_MISMATCH,
      category: null,
      detail: { restore: value },
      assertions: { "RVC-04": { status: STATUS.FAILED, reason: REASON.RESTORE_MANIFEST_MISMATCH, category: null, evidence: { restore: value } } },
    };
  }
  ctx.state.restore = value;
  return { status: STATUS.PASSED, assertions: { "RVC-04": { status: STATUS.PASSED, reason: null, category: null, evidence: { restore: value } } } };
}

async function securityPhase(ctx) {
  const security = evaluateSecuritySource(ctx.plan.securitySource);
  ctx.state.security = security;
  if (!security.enabled) {
    // The business migration checks may continue, but the security assertions are skipped.
    return {
      status: STATUS.PASSED,
      detail: { security },
      assertions: { "RVC-10": { status: STATUS.SKIPPED, reason: security.reason, category: security.category, evidence: { note: "最新安全状态来源未确认；安全断言跳过，不得记为通过。" } } },
    };
  }
  const injected = await callAdapter(ctx, "injectSecurityState");
  if (!injected.ok) {
    return { status: injected.status, reason: injected.reason, category: injected.category, detail: injected.detail ?? null, assertions: blockedAssertions(["RVC-10"], injected.reason, injected.category, "security", injected.status) };
  }
  const rotated = await callAdapter(ctx, "rotateSessionSecret");
  if (!rotated.ok) {
    return { status: rotated.status, reason: rotated.reason, category: rotated.category, detail: rotated.detail ?? null, assertions: blockedAssertions(["RVC-10"], rotated.reason, rotated.category, "security", rotated.status) };
  }
  return {
    status: STATUS.PASSED,
    detail: { security, injected: injected.value ?? null, rotated: rotated.value ?? null },
    assertions: { "RVC-10": { status: STATUS.PASSED, reason: null, category: null, evidence: { security, injected: injected.value ?? null, rotated: rotated.value ?? null } } },
  };
}

async function startPhase(ctx) {
  const started = await callAdapter(ctx, "startCandidate");
  if (!started.ok) {
    return { status: started.status, reason: started.reason, category: started.category, detail: started.detail ?? null, assertions: {} };
  }
  const value = started.value ?? {};
  if (value.healthy === false) {
    return { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, detail: { start: value }, assertions: {} };
  }
  ctx.state.start = value;
  return { status: STATUS.PASSED, assertions: {} };
}

async function structurePhase(ctx) {
  const baseline = ctx.plan.structuralBaseline;
  if (!baseline || (!Array.isArray(baseline.expectedPaths) && !Array.isArray(baseline.structuralChangePaths))) {
    return {
      status: STATUS.BLOCKED,
      reason: REASON.STRUCTURE_BASELINE_UNDECLARED,
      category: BLOCK_CATEGORY.DELIVERY,
      detail: { note: "候选未声明结构基线与结构变更路径，无法做硬断言。" },
      assertions: blockedAssertions(["RVC-05"], REASON.STRUCTURE_BASELINE_UNDECLARED, BLOCK_CATEGORY.DELIVERY, "structure"),
    };
  }
  const inspected = await callAdapter(ctx, "inspectStructure");
  if (!inspected.ok) {
    return { status: inspected.status, reason: inspected.reason, category: inspected.category, detail: inspected.detail ?? null, assertions: blockedAssertions(["RVC-05"], inspected.reason, inspected.category, "structure", inspected.status) };
  }
  const verdict = evaluateStructureBaseline({
    expectedPaths: baseline.expectedPaths ?? [],
    structuralChangePaths: baseline.structuralChangePaths ?? [],
    actual: (inspected.value ?? {}).paths ?? {},
  });
  if (verdict.status !== STATUS.PASSED) {
    return {
      status: verdict.status,
      reason: verdict.reason,
      category: verdict.category,
      detail: verdict.detail,
      assertions: { "RVC-05": { status: verdict.status, reason: verdict.reason, category: verdict.category, evidence: verdict.detail } },
    };
  }
  ctx.state.structure = inspected.value ?? null;
  return { status: STATUS.PASSED, assertions: { "RVC-05": { status: STATUS.PASSED, reason: null, category: null, evidence: verdict.detail } } };
}

async function assertionsPhase(ctx) {
  const call = await callAdapter(ctx, "assertBusiness");
  if (!call.ok) {
    return { status: call.status, reason: call.reason, category: call.category, detail: call.detail ?? null, assertions: blockedAssertions(["RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-11"], call.reason, call.category, "assertions", call.status) };
  }
  const raw = call.value ?? {};
  const assertions = {};
  for (const id of ["RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-11"]) assertions[id] = normalizeAssertion(raw[id]);
  const security = ctx.state.security ?? evaluateSecuritySource(ctx.plan.securitySource);
  if (!security.enabled) {
    assertions["RVC-10"] = { status: STATUS.SKIPPED, reason: security.reason, category: security.category, evidence: { note: "最新安全状态来源未确认；安全断言跳过，不得记为通过。" } };
  } else {
    assertions["RVC-10"] = normalizeAssertion(raw["RVC-10"]);
  }
  const status = aggregateStatus(Object.values(assertions).map((item) => item.status));
  if (status === STATUS.PASSED) return { status, assertions };
  const first = Object.values(assertions).find((item) => item.status !== STATUS.PASSED && item.status !== STATUS.SKIPPED);
  return {
    status,
    reason: first?.reason ?? REASON.ASSERTION_FAILED,
    category: first?.category ?? null,
    assertions,
  };
}

async function replayPhase(ctx) {
  const replayed = await callAdapter(ctx, "replay");
  if (!replayed.ok) {
    return { status: replayed.status, reason: replayed.reason, category: replayed.category, detail: replayed.detail ?? null, assertions: blockedAssertions(["RVC-12"], replayed.reason, replayed.category, "replay", replayed.status) };
  }
  const replay = replayed.value ?? {};
  const primary = { entries: ctx.state.primaryEntries ?? [], identity: ctx.state.primaryIdentity ?? null };
  const verdict = compareReplay(primary, replay);
  if (verdict.status !== STATUS.PASSED) {
    return {
      status: verdict.status,
      reason: verdict.reason,
      category: verdict.category,
      detail: verdict.detail,
      assertions: { "RVC-12": { status: verdict.status, reason: verdict.reason, category: verdict.category, evidence: verdict.detail } },
    };
  }
  return { status: STATUS.PASSED, assertions: { "RVC-12": { status: STATUS.PASSED, reason: null, category: null, evidence: verdict.detail } } };
}

async function teardownPhase(ctx) {
  const torn = await callAdapter(ctx, "teardown");
  if (!torn.ok) {
    return { status: torn.status, reason: torn.reason, category: torn.category, detail: torn.detail ?? null, assertions: blockedAssertions(["RVC-13"], torn.reason, torn.category, "teardown", torn.status) };
  }
  const value = torn.value ?? {};
  const residual = Array.isArray(value.residual) ? value.residual : [];
  if (residual.length > 0) {
    return {
      status: STATUS.BLOCKED,
      reason: REASON.CLEANUP_INCOMPLETE,
      category: BLOCK_CATEGORY.ENVIRONMENT,
      detail: { residual },
      assertions: { "RVC-13": { status: STATUS.BLOCKED, reason: REASON.CLEANUP_INCOMPLETE, category: BLOCK_CATEGORY.ENVIRONMENT, evidence: { residual } } },
    };
  }
  return { status: STATUS.PASSED, assertions: { "RVC-13": { status: STATUS.PASSED, reason: null, category: null, evidence: { residual } } } };
}

/* ------------------------------------------------------------------ scenario */

export async function runCandidateVerification(plan, options = {}) {
  const {
    adapter = null,
    contract = CANDIDATE_VERIFICATION_CONTRACT,
    now = () => new Date().toISOString(),
  } = options;
  const ctx = { plan, adapter, trace: [], state: {} };
  const phases = CANDIDATE_PHASES.map((phase) => ({
    ...phase,
    run: async (context) => {
      if (phase.id === "replay") {
        // The replay comparison needs the conclusions of the first environment.
        const primary = projectEntries(RVC_STAGES, context.state.phaseResults ?? [], context.state.stop ?? null);
        context.state.primaryEntries = primary.filter((entry) => entry.id !== "RVC-12" && entry.id !== "RVC-13");
        context.state.primaryIdentity = {
          instanceId: context.state.volume?.volumeId ?? null,
          volumeId: context.state.volume?.volumeId ?? null,
          namespace: plan.deployment?.namespace ?? null,
        };
      }
      return PHASE_IMPLEMENTATIONS[phase.id](context);
    },
  }));
  const run = await runPhasesWithRecording(phases, ctx);
  const entries = projectEntries(RVC_STAGES, run.results, run);
  return {
    contract,
    namespace: "RVC",
    runId: plan.runId ?? null,
    startedAt: now(),
    deployment: plan.deployment ?? null,
    identity: plan.identity ?? null,
    releaseEligible: false,
    status: aggregateStatus(entries.map((entry) => entry.status)),
    entries,
    summary: summarize(entries),
    phases: run.results.map((phase) => ({ id: phase.id, stage: phase.stage, status: phase.status, reason: phase.reason, category: phase.category })),
    stoppedAt: run.stoppedAt,
    stopReason: run.stopReason,
    stopCategory: run.stopCategory,
    trace: ctx.trace,
    namespaces: namespacePartition(),
    delivery: plan.delivery ?? null,
    notes: plan.notes ?? [],
  };
}

const PHASE_IMPLEMENTATIONS = {
  preflight: preflightPhase,
  empty_volume: emptyVolumePhase,
  restore: restorePhase,
  security: securityPhase,
  start: startPhase,
  structure: structurePhase,
  assertions: assertionsPhase,
  replay: replayPhase,
  teardown: teardownPhase,
};

/**
 * `runPhases` from the shared engine does not expose intermediate results. The replay phase
 * needs the conclusions of the first environment, so the phase results are recorded here.
 */
async function runPhasesWithRecording(phases, ctx) {
  const results = [];
  for (const phase of phases) {
    ctx.trace.push(phase.id);
    let outcome;
    try {
      outcome = await phase.run(ctx);
    } catch (error) {
      outcome = { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, detail: error?.message ?? String(error) };
    }
    const status = outcome.status ?? STATUS.FAILED;
    results.push({
      id: phase.id,
      stage: phase.stage,
      status,
      reason: outcome.reason ?? null,
      category: outcome.category ?? null,
      detail: outcome.detail ?? null,
      assertions: outcome.assertions ?? {},
    });
    ctx.state.phaseResults = results;
    if (status === STATUS.FAILED || status === STATUS.BLOCKED || status === STATUS.UNIMPLEMENTED) {
      const stop = { stoppedAt: phase.id, stopStatus: status, stopReason: outcome.reason ?? null, stopCategory: outcome.category ?? null };
      ctx.state.stop = stop;
      return { results, ...stop };
    }
  }
  return { results, stoppedAt: null, stopStatus: null, stopReason: null, stopCategory: null };
}

/* ------------------------------------------------------------------ CLI */

function parseCli(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (name === "help") { out.help = true; continue; }
    out[name] = argv[++i];
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/upgrade/verify-candidate.mjs [--plan <plan.json|yaml>] [--run-id <id>] [--out <dir>]

Options:
  --plan <file>   Verification plan (identity, deployment, backup, security source, capabilities,
                  structural baseline).
  --run-id <id>   Run identifier (default: candidate-verify-<timestamp>).
  --out <dir>     Artifact directory (default: inbox/upgrade-candidate/<run-id>).
  --help          Show this help.

Exit codes: 0 passed, 1 failed, 2 blocked, 3 skipped. Non-gating: this never publishes a release decision.
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseCli(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  const runId = args["run-id"] ?? `candidate-verify-${Date.now()}`;
  const plan = args.plan ? loadPlanFile(args.plan) : buildDefaultPlan({ runId });
  plan.runId = runId;
  const outDir = path.resolve(args.out ?? path.join(REPO_ROOT, "inbox", "upgrade-candidate", runId));
  const result = await runCandidateVerification(plan);
  const artifacts = {
    "run.json": {
      contract: result.contract,
      namespace: result.namespace,
      runId: result.runId,
      deployment: result.deployment,
      identity: result.identity,
      securityStorePresent: plan.backup?.containsSecurityStore === true,
      releaseEligible: false,
      delivery: result.delivery,
      namespaces: result.namespaces,
    },
    "before.json": { captured: false, note: "恢复前清单未采集：身份预检在变更前停止。", state: null },
    "after.json": { captured: false, note: "恢复后清单未采集：恢复未执行。", state: null },
    "backup.json": { method: plan.backup?.method ?? "unknown", evaluated: false, note: "备份未执行：身份预检在变更前停止。", state: null },
    "upgrade.json": { executed: false, note: "本通道不做原地升级；候选启动未执行。", state: null },
    "recovery.json": { executed: false, note: "故障与恢复分支未执行。", state: null },
    "restore.json": { executed: false, note: "整卷覆盖未执行。", state: null },
    "assertions.json": { contract: result.contract, namespace: result.namespace, runId: result.runId, entries: result.entries, summary: result.summary },
    "report.md": renderScenarioReport(result, { title: "Lucy P1-6 upgrade candidate verification report", artifactDir: outDir }),
  };
  const written = writeScenarioArtifacts(outDir, artifacts);
  const policy = assertArtifactPolicy(outDir);
  process.stdout.write(`${JSON.stringify({
    runId,
    contract: result.contract,
    status: result.status,
    summary: result.summary,
    stoppedAt: result.stoppedAt,
    stopReason: result.stopReason,
    artifacts: written.written,
    artifactPolicy: policy.status,
    releaseEligible: false,
  })}\n`);
  // UNIMPLEMENTED and SKIPPED share the non-zero "not executed" exit code of the shared contract.
  return exitCodeFor(result.status === STATUS.PASSED ? "passed" : result.status === STATUS.FAILED ? "failed" : result.status === STATUS.BLOCKED ? "blocked" : "skipped");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
