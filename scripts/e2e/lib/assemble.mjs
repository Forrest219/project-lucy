// Assembles the single `lucy-real-user-e2e-v1` evidence document from the per-runner result files
// (Spec §8.1). Statuses and counts are RECOMPUTED here from the case entries; nothing is copied from a child's
// own "status" field, and a missing dependency produces `blocked`, never a placeholder pass.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { catalogDigest } from "./catalog.mjs";

const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;

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
    provenance: readIfExists(path.join(dir, "provenance.json"))
  };
}

const COMPLETE_FIELDS = (entry) => ({
  id: entry.id,
  runner: entry.runner,
  ...(entry.client ? { client: entry.client, run: entry.run } : {}),
  status: entry.status,
  startedAt: entry.startedAt ?? new Date(0).toISOString(),
  finishedAt: entry.finishedAt ?? new Date(0).toISOString(),
  ...(entry.tokenFingerprint ? { tokenFingerprint: entry.tokenFingerprint } : {}),
  serverTraceIds: entry.serverTraceIds ?? [],
  queryEventIds: entry.queryEventIds ?? [],
  policyVersion: entry.policyVersion || "unavailable",
  contextPolicyVersion: entry.contextPolicyVersion || "unavailable",
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
 * @returns {{ evidence: object, missing: string[] }} `missing` lists dependencies that were absent; the caller
 * must treat them as BLOCKED. Cases that no runner produced are not invented here: the verifier reports them as
 * omitted against the frozen denominator.
 */
export function assembleEvidence({ run, results, candidate, profileDigest, cases, expectedCount }) {
  const missing = [];
  const entries = [results.security, results.management, results.agent, results.gates].flatMap((doc) => doc?.cases ?? []);
  for (const [name, doc] of Object.entries({ security: results.security, management: results.management, agent: results.agent, gates: results.gates })) {
    if (!doc) missing.push(`results/${name}.json`);
  }
  const deployment = results.deployment;
  if (!deployment) missing.push("results/deployment.json");
  const gateDoc = results.gates ?? {};
  const merged = entries.map(COMPLETE_FIELDS);
  const candidateBlock = candidate ?? {
    gitSha: "0".repeat(40), treeDigest: ZERO_DIGEST, imageDigest: ZERO_DIGEST, platform: "unavailable", ktxVersion: "unavailable", chartVersion: "unavailable"
  };
  const started = [results.security, results.management, results.agent].map((d) => d?.startedAt).filter(Boolean).sort()[0];
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
      startedAt: started ?? new Date(0).toISOString(),
      finishedAt: new Date().toISOString()
    },
    clients: (results.agent?.clients ?? []).map(({ product, version, adapterDigest, model, transport, required }) => ({ product, version: version || "unavailable", adapterDigest, model: model || "unavailable", transport, required })),
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
    status: overallStatus(merged),
    releaseReady: false
  };
  if (!results.agent?.serverEvidence) missing.push("server-evidence");
  return { evidence, missing };
}
