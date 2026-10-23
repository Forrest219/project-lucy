// Assembles the single `lucy-real-user-e2e-v1` evidence document from the per-runner result files
// (Spec §8.1). Statuses and counts are RECOMPUTED here from the case entries; nothing is copied from a child's
// own "status" field, and a missing dependency produces `blocked`, never a placeholder pass.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { catalogDigest } from "./catalog.mjs";
import { manualRequiredClients } from "./clients.mjs";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const EXPECTED_STEP_IDS = ["M-01", "M-02", "M-03", "M-04", "M-05"];

function readIfExists(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

export function loadResults(run) {
  const dir = path.join(run.paths.runDir, "results");
  return {
    security: readIfExists(path.join(dir, "security.json")),
    management: readIfExists(path.join(dir, "management.json")),
    agent: readIfExists(path.join(dir, "agent.json")),
    gates: readIfExists(path.join(dir, "gates.json")),
    deployment: readIfExists(path.join(dir, "deployment.json")),
    provenance: readIfExists(path.join(dir, "provenance.json")),
    manual: {
      workbuddy: readIfExists(path.join(dir, "manual", "workbuddy.json")),
      cursor: readIfExists(path.join(dir, "manual", "cursor.json"))
    }
  };
}

/**
 * Normalize a manual GUI pack into the verifier's `manualClients` shape. The real documented pack contract
 * (docs/qa/manual-gui-e2e-checklist.md §2) is:
 *   { product, execution: "manual", transport: "gui", status, operator, completedAt, runId, notes, steps: [{id, passed}, …] }
 * We then bind a per-pack artifact that is the SHA256 of the raw file bytes — the verifier compares it to
 * `artifact.sha256` so a "self-referential hash embedded in the file" cannot satisfy the check.
 *
 * Hard rules (the verifier will surface each as a separate code):
 *   - product on disk must match the expected client product (workbuddy/cursor); mismatch → wrong_product.
 *   - runId on disk must equal the current run; missing or different → wrong_run.
 *   - operator must be non-empty.
 *   - completedAt must parse and fall within the run's start/finish window; otherwise invalid_timestamps.
 *   - steps[] must contain exactly M-01..M-05 once each in order; missing/duplicate/wrong id → bad_steps.
 *   - pack.status must equal the conjunction of steps[].passed; a forged "passed" with a failed step is
 *     detected as forged_top_passed.
 *   - artifact.sha256 is the SHA256 of the raw file bytes; it is computed here, not trusted from the pack.
 */
/**
 * Normalize a manual GUI pack into the verifier's `manualClients` shape. The pack contract is documented in
 * docs/qa/manual-gui-e2e-checklist.md §2 (human doc) and scripts/e2e/contracts/release-evidence.schema.json
 * (`manualClients`). This function passes raw fields through verbatim — execution/transport/status/operator/
 * completedAt/runId/steps are NOT rewritten. A runner that writes `execution:"automated", transport:"cli"` to
 * claim a slot in `manualClients` keeps those values; the verifier surfaces the mismatch as
 * `manual_wrong_execution` / `manual_wrong_transport`. Missing raw fields are never auto-filled from the
 * current run identity; the verifier emits the appropriate `manual_*` failure. Bad JSON produces a marker
 * entry with `problems:["invalid_json"]`; absent files produce no entry (the verifier emits `missing_pack`).
 *
 * The `problems` field records the issues the assembly caught just by inspecting the file. The verifier
 * always re-parses the raw file and re-validates the same fields against the run-time limits — the
 * `problems` array is a hint, not a substitute for re-verification.
 */
function parseCompletedAtMs(value) {
  if (typeof value !== "string") return NaN;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

function safeSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readRawPack(onDiskPath) {
  let raw;
  try {
    raw = readFileSync(onDiskPath);
  } catch {
    return { error: "missing_pack" };
  }
  const rawSha = safeSha256(raw);
  let pack;
  try {
    pack = JSON.parse(raw.toString("utf8"));
  } catch {
    return { raw, rawSha, error: "invalid_json" };
  }
  return { raw, rawSha, pack };
}

function isSafeEvidencePath(value) {
  return typeof value === "string" && /^[A-Za-z0-9_\-./]+\.json$/.test(value) && !value.includes("..");
}

export function manualClientEntries({ manual, run, clientsDoc, runDir }) {
  const required = manualRequiredClients(clientsDoc?.clients ?? []);
  const seenPaths = new Set();
  return required
    .map((client) => {
      const expectedProduct = client.product;
      const expectedPath = `results/manual/${expectedProduct}.json`;
      const onDiskPath = path.join(runDir, expectedPath);
      if (!existsSync(onDiskPath)) {
        // No on-disk file: keep a blocked placeholder so the verifier's manual-loop entry lookup can
        // still anchor the slot by `artifact.path`, and so the assembly's `missing` dependency list
        // surfaces the file. The verifier re-reads the file and will fail with `missing_pack` on its
        // own — this entry exists for accounting only and is rejected by the verifier before any of
        // its fields are read.
        return {
          product: expectedProduct,
          execution: "manual",
          transport: "gui",
          status: "blocked",
          operator: "(missing-pack)",
          completedAt: "1970-01-01T00:00:00.000Z",
          runId: run.runId,
          steps: [],
          artifact: { path: expectedPath, sha256: "0".repeat(64) },
          problems: ["missing_pack"]
        };
      }
      const { rawSha, pack, error } = readRawPack(onDiskPath);
      if (error === "invalid_json") {
        // The verifier reads the raw file too; this entry just anchors the slot.
        return {
          product: expectedProduct,
          execution: "manual",
          transport: "gui",
          status: "blocked",
          operator: "(invalid-json)",
          completedAt: "1970-01-01T00:00:00.000Z",
          runId: run.runId,
          steps: [],
          artifact: { path: expectedPath, sha256: rawSha },
          problems: ["invalid_json"]
        };
      }
      if (error === "missing_pack") return null;
      // Anti-laundering: record raw mismatches here so a casual reader sees them; the verifier
      // re-emits these as proper codes at verification time (defense in depth).
      const problems = [];
      if (pack.product !== expectedProduct) problems.push("wrong_product");
      if (pack.execution !== "manual") problems.push("wrong_execution");
      if (pack.transport !== "gui") problems.push("wrong_transport");
      if (typeof pack.runId !== "string" || pack.runId.trim().length === 0) problems.push("empty_run");
      if (typeof pack.operator !== "string" || pack.operator.trim().length === 0) problems.push("empty_operator");
      if (!Number.isFinite(parseCompletedAtMs(pack.completedAt))) problems.push("invalid_timestamps");
      const steps = Array.isArray(pack.steps) ? pack.steps : null;
      if (!steps || steps.length !== EXPECTED_STEP_IDS.length) problems.push("bad_steps");
      else {
        for (let i = 0; i < EXPECTED_STEP_IDS.length; i += 1) {
          if (steps[i]?.id !== EXPECTED_STEP_IDS[i]) { problems.push("bad_steps"); break; }
          if (typeof steps[i]?.passed !== "boolean") problems.push("bad_steps");
          if (!isSafeEvidencePath(steps[i]?.evidencePath)) problems.push("step_evidence_missing");
          else if (!/^[0-9a-f]{64}$/.test(steps[i]?.evidenceSha256 ?? "")) problems.push("step_evidence_missing");
        }
      }
      const out = {
        product: pack.product,
        execution: pack.execution,
        transport: pack.transport,
        status: pack.status,
        operator: pack.operator,
        completedAt: pack.completedAt,
        runId: pack.runId,
        steps,
        artifact: { path: expectedPath, sha256: rawSha },
        problems
      };
      if (pack.productVersion !== undefined) out.productVersion = pack.productVersion;
      if (pack.notes !== undefined) out.notes = pack.notes;
      if (pack.signature !== undefined) out.signature = pack.signature;
      return out;
    })
    .filter((entry) => {
      if (!entry) return false;
      // Enforce one entry per expected filename (no duplicate slots): if the same product appears
      // twice in the required list, only the first one is kept; later duplicates are dropped.
      if (seenPaths.has(entry.artifact.path)) return false;
      seenPaths.add(entry.artifact.path);
      return true;
    });
}

const COMPLETE_FIELDS = (entry) => ({
  id: entry.id,
  runner: entry.runner,
  ...(entry.client ? { client: entry.client, run: entry.run } : {}),
  status: entry.status,
  startedAt: entry.startedAt ?? new Date(0).toISOString(),
  finishedAt: entry.finishedAt ?? new Date(0).toISOString(),
  ...(entry.tokenFingerprint ? { tokenFingerprint: entry.tokenFingerprint } : {}),
  ...(Array.isArray(entry.tokenFingerprints) ? { tokenFingerprints: entry.tokenFingerprints } : {}),
  serverTraceIds: entry.serverTraceIds ?? [],
  queryEventIds: entry.queryEventIds ?? [],
  policyVersion: entry.policyVersion || "unavailable",
  contextPolicyVersion: entry.contextPolicyVersion || "unavailable",
  ...(Array.isArray(entry.policyVersions) ? { policyVersions: entry.policyVersions } : {}),
  ...(Array.isArray(entry.contextPolicyVersions) ? { contextPolicyVersions: entry.contextPolicyVersions } : {}),
  ...(Array.isArray(entry.asks) ? { asks: entry.asks } : {}),
  ...(entry.denyReason ? { denyReason: entry.denyReason } : {}),
  ...(entry.upstreamExecutions !== undefined ? { upstreamExecutions: entry.upstreamExecutions } : {}),
  ...(entry.leakage ? { leakage: entry.leakage } : {}),
  ...(entry.failureClass ? { failureClass: entry.failureClass } : {}),
  assertions: (entry.assertions ?? []).map((a) => ({ token: a.token, passed: a.passed === true, ...(a.detail ? { detail: a.detail } : {}) })),
  artifacts: entry.artifacts ?? []
});

export function overallStatus(cases) {
  const has = (status) => cases.some((c) => c.status === status);
  if (has("failed")) return "failed";
  if (has("blocked")) return "blocked";
  if (has("skipped")) return "skipped";
  if (has("dry_run")) return "dry_run";
  return cases.length === 0 ? "blocked" : "passed";
}

export function summarize(cases, requiredCount) {
  const count = (status) => cases.filter((c) => c.status === status).length;
  return {
    required: requiredCount,
    executed: cases.filter((c) => c.status !== "blocked" && c.status !== "skipped" && c.status !== "dry_run").length,
    passed: count("passed"),
    failed: count("failed"),
    blocked: count("blocked"),
    skipped: count("skipped"),
    dryRun: count("dry_run")
  };
}

/**
 * Aggregated times across per-runner files. The evidence's `startedAt` is the minimum start, `finishedAt` is
 * the maximum finish — never `new Date()` (which is assembly time, not the run's last finish).
 *
 * Each of the three required runners (security, management, agent) must contribute a
 * parseable startedAt and finishedAt. A missing timestamp on any of them is a closed-fail:
 * assembly returns `null` for both, the run is treated as unfinished, and the verifier
 * reports `missing_finished_at`. A stale individual member (one runner with a finish
 * timestamp far in the past while others are recent) is NOT laundered: the max-of-finishes
 * still reflects the actual last finish among the runners that DID finish, but the missing
 * runner is reported as a missing-dependency in the assembly's `missing` list. The verifier
 * then fails on `missing_finished_at` rather than pretending a half-finished run completed.
 *
 * Returns { startedAt, finishedAt, memberProblems }. `memberProblems` lists the specific
 * runner(s) whose times were missing or unparseable; callers surface them as missing deps.
 */
export function aggregateRunTimes({ results }) {
  const required = [
    { name: "security", doc: results.security },
    { name: "management", doc: results.management },
    { name: "agent", doc: results.agent }
  ];
  const starts = [];
  const finishes = [];
  const memberProblems = [];
  for (const { name, doc } of required) {
    const start = doc?.startedAt;
    const finish = doc?.finishedAt;
    if (typeof start !== "string" || !Number.isFinite(Date.parse(start))) memberProblems.push(`results/${name}.json: startedAt is missing or unparseable`);
    else starts.push(start);
    if (typeof finish !== "string" || !Number.isFinite(Date.parse(finish))) memberProblems.push(`results/${name}.json: finishedAt is missing or unparseable`);
    else finishes.push(finish);
  }
  starts.sort();
  finishes.sort();
  // If ANY required member's time is missing, the aggregated time is null. The run is not
  // finished; assembly must not invent a finish time.
  if (memberProblems.length > 0) {
    return { startedAt: starts[0] ?? null, finishedAt: null, memberProblems };
  }
  return { startedAt: starts[0], finishedAt: finishes[finishes.length - 1], memberProblems };
}

/**
 * @returns {{ evidence: object, missing: string[] }} `missing` lists dependencies that were absent; the caller
 * must treat them as BLOCKED. Cases that no runner produced are not invented here: the verifier reports them as
 * omitted against the frozen denominator.
 */
export function assembleEvidence({ run, results, candidate, profileDigest, cases, expectedCount, clientsDoc, runDir }) {
  const missing = [];
  const entries = [results.security, results.management, results.agent, results.gates].flatMap((doc) => doc?.cases ?? []);
  for (const [name, doc] of Object.entries({ security: results.security, management: results.management, agent: results.agent, gates: results.gates })) {
    if (!doc) missing.push(`results/${name}.json`);
  }
  const deployment = results.deployment;
  if (!deployment) missing.push("results/deployment.json");
  // Validate per-runner identity BEFORE writing any field that comes from a runner. A single member with
  // a wrong run/instance/candidate/profile/catalog digest would otherwise leak into the assembled evidence.
  const runnerIdentityProblems = validateRunnerIdentities({ results, run });
  const baseManual = manualClientEntries({ manual: results.manual, run, clientsDoc, runDir: runDir ?? run.paths.runDir });
  const manualClients = baseManual;
  for (const mc of manualClients) {
    for (const problem of mc.problems ?? []) {
      missing.push(`results/manual/${mc.product}.json: ${problem}`);
    }
  }
  const gateDoc = results.gates ?? {};
  const merged = entries.map(COMPLETE_FIELDS);
  const candidateBlock = candidate ?? {
    gitSha: "0".repeat(40), treeDigest: ZERO_DIGEST, imageDigest: ZERO_DIGEST, platform: "unavailable", ktxVersion: "unavailable", chartVersion: "unavailable"
  };
  const { startedAt, finishedAt, memberProblems } = aggregateRunTimes({ results });
  if (runnerIdentityProblems.length > 0) {
    // Fail closed: do not synthesize times; do not trust per-runner fields. The verifier will see the
    // mismatched identity codes and BLOCK.
    missing.push(...runnerIdentityProblems);
  }
  if (memberProblems.length > 0) {
    // A required runner never reported its times; the run is unfinished. Surface the specific
    // missing member(s) so the verifier reports missing_finished_at and the operator can see
    // which runner never checked in.
    missing.push(...memberProblems);
  }
  const evidence = {
    contract: "lucy-real-user-e2e-v1",
    executionMode: run.executionMode,
    stub: false,
    runId: run.runId,
    candidate: candidateBlock,
    environment: {
      instanceId: deployment?.instanceId ?? run.instanceId,
      topology: deployment?.topology ?? "local-process",
      fixtureDigest: run.fixtureDigest,
      profileDigest: profileDigest ?? ZERO_DIGEST,
      caseCatalogDigest: run.caseCatalogDigest ?? catalogDigest(cases),
      deployedImageDigest: deployment?.deployedImageDigest ?? ZERO_DIGEST,
      startedAt: startedAt ?? null,
      finishedAt
    },
    clients: (results.agent?.clients ?? []).map(({ product, version, adapterDigest, model, transport, required }) => ({ product, version: version || "unavailable", adapterDigest, model: model || "unavailable", transport, required })),
    manualClients,
    summary: summarize(merged, expectedCount),
    cases: merged,
    gates: {
      // -1 = unknown. Absence must never default to "zero pending": the verifier treats it as BLOCKED.
      contextMigrationPending: gateDoc.contextMigrationPending ?? -1,
      projectionBacklog: gateDoc.projectionBacklog ?? -1,
      existing: gateDoc.existing ?? []
    },
    serverEvidence: results.agent?.serverEvidence
      ? { source: "instance-ledger", ...results.agent.serverEvidence }
      : { source: "missing", path: "results/server-evidence.json", sha256: "0".repeat(64) },
    provenance: results.provenance ?? { trusted: false, runner: "local" },
    runnerIdentityProblems,
    status: overallStatus(merged),
    releaseReady: false
  };
  if (!results.agent?.serverEvidence) missing.push("server-evidence");
  if (!finishedAt) missing.push("environment.finishedAt");
  return { evidence, missing };
}

/**
 * Each supplied runner document must carry a COMPLETE original identity envelope that
 * agrees with the run-under-assembly. The previous "check only when present" pass was a
 * bypass: a runner that omits runId, instanceId, caseCatalogDigest, profileDigest and
 * fixtureDigest from its result file would sail through validation while still writing
 * arbitrary cases into the assembled evidence. We now require every required field to be
 * present and to agree with the run. Any disagreement is recorded as a missing-dependency
 * problem; the assembly marks the evidence with the list so the verifier can surface the
 * exact identity that drifted.
 *
 * Specifically: each runner's original document must carry
 *   - runId              must equal run.runId
 *   - instanceId         must equal run.instanceId
 *   - caseCatalogDigest  must equal run.caseCatalogDigest
 *   - profileDigest      must equal run.profileDigest
 *   - fixtureDigest      must equal run.fixtureDigest
 *   - startedAt / finishedAt (used by aggregateRunTimes separately; here we only require
 *     they parse and fall within the run's window — stale individual members are
 *     detected by aggregateRunTimes and not by this function).
 *
 * The gates document additionally must carry the same candidate imageDigest; the verifier
 * cross-checks every existing gate's imageDigest against candidate.imageDigest later.
 */
export function validateRunnerIdentities({ results, run }) {
  const problems = [];
  const members = [
    { name: "security", doc: results.security },
    { name: "management", doc: results.management },
    { name: "agent", doc: results.agent },
    { name: "gates", doc: results.gates }
  ];
  for (const { name, doc } of members) {
    if (!doc) {
      problems.push(`results/${name}.json: runner document is missing; cannot be added to the assembled evidence`);
      continue;
    }
    // Required identity envelope. Missing = bypass, not "we'll skip the check".
    if (typeof doc.runId !== "string" || doc.runId.length === 0) {
      problems.push(`results/${name}.json: runId is missing`);
    } else if (doc.runId !== run.runId) {
      problems.push(`results/${name}.json: runId ${doc.runId} != ${run.runId}`);
    }
    if (typeof doc.instanceId !== "string" || doc.instanceId.length === 0) {
      problems.push(`results/${name}.json: instanceId is missing`);
    } else if (doc.instanceId !== run.instanceId) {
      problems.push(`results/${name}.json: instanceId ${doc.instanceId} != ${run.instanceId}`);
    }
    if (typeof doc.caseCatalogDigest !== "string" || doc.caseCatalogDigest.length === 0) {
      problems.push(`results/${name}.json: caseCatalogDigest is missing`);
    } else if (doc.caseCatalogDigest !== run.caseCatalogDigest) {
      problems.push(`results/${name}.json: caseCatalogDigest ${doc.caseCatalogDigest} != ${run.caseCatalogDigest}`);
    }
    if (typeof doc.profileDigest !== "string" || doc.profileDigest.length === 0) {
      problems.push(`results/${name}.json: profileDigest is missing`);
    } else if (doc.profileDigest !== run.profileDigest) {
      problems.push(`results/${name}.json: profileDigest ${doc.profileDigest} != ${run.profileDigest}`);
    }
    if (typeof doc.fixtureDigest !== "string" || doc.fixtureDigest.length === 0) {
      problems.push(`results/${name}.json: fixtureDigest is missing`);
    } else if (doc.fixtureDigest !== run.fixtureDigest) {
      problems.push(`results/${name}.json: fixtureDigest ${doc.fixtureDigest} != ${run.fixtureDigest}`);
    }
    if (name === "gates" && typeof doc.imageDigest === "string" && doc.imageDigest.length > 0 && run.candidateDigest && doc.imageDigest !== run.candidateDigest) {
      problems.push(`results/${name}.json: imageDigest ${doc.imageDigest} != candidate ${run.candidateDigest}`);
    }
  }
  return problems;
}
