// Two-phase (Gate-Off → Gate-On) helpers for the row-policy strength-B runner.
//
// Lucy reads LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN from process.env
// (`webui/server/proxy/row-policy.ts` → `isUpstreamForcedPredicateProven`).
// There is no runtime admin switch. Changing the flag on a run instance
// therefore requires restarting the Lucy process that this harness spawned,
// against the same runDir / data volume.
//
// This module mutates ONLY `<runDir>/run.json` `instance.env`. It never writes
// customer sign-off configs (compose, Helm, deploy templates).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REGISTRY } from "./row-policy-pack.mjs";

export const FORCED_PREDICATE_PROVEN_ENV = "LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN";
export const PLAYWRIGHT_SPEC_FILES = Object.freeze([
  "tests/real-e2e/row-policy-v025.spec.ts",
  "tests/real-e2e/row-policy-templates-v025.spec.ts"
]);

/**
 * Strength-B verdict. Both phases must be green; any blocking blocked, failure,
 * or missing registry id refuses the B pass.
 *
 * @param {{
 *   phaseOff: { failed: number, blockedBlocking: number },
 *   phaseOn: { failed: number, blockedBlocking: number },
 *   registryMissing?: string[]
 * }} input
 */
export function summarizeBRun(input) {
  const phaseOff = input?.phaseOff ?? {};
  const phaseOn = input?.phaseOn ?? {};
  const registryMissing = [...(input?.registryMissing ?? [])];
  const reasons = [];
  if (Number(phaseOff.failed) > 0) reasons.push(`phase-off failed=${phaseOff.failed}`);
  if (Number(phaseOn.failed) > 0) reasons.push(`phase-on failed=${phaseOn.failed}`);
  if (Number(phaseOff.blockedBlocking) > 0) reasons.push(`phase-off blockedBlocking=${phaseOff.blockedBlocking}`);
  if (Number(phaseOn.blockedBlocking) > 0) reasons.push(`phase-on blockedBlocking=${phaseOn.blockedBlocking}`);
  if (registryMissing.length > 0) reasons.push(`registryMissing=${registryMissing.join(",")}`);
  return {
    passed: reasons.length === 0,
    phaseOff: { failed: Number(phaseOff.failed) || 0, blockedBlocking: Number(phaseOff.blockedBlocking) || 0 },
    phaseOn: { failed: Number(phaseOn.failed) || 0, blockedBlocking: Number(phaseOn.blockedBlocking) || 0 },
    registryMissing,
    reasons
  };
}

/**
 * Count failed / blocking-blocked / missing ids for one phase.
 * `blocked`, `skip`, `not_run` all block a B pass (design §1.2 / §5).
 *
 * @param {{ executionId: string, status: string }[]} results
 * @param {string[]} expectedIds
 * @param {{ management?: number, security?: number } | null} [spawned]
 */
export function collectPhaseStats(results, expectedIds, spawned) {
  const byId = new Map();
  for (const row of results ?? []) {
    if (row?.executionId) byId.set(row.executionId, row);
  }
  let failed = 0;
  let blockedBlocking = 0;
  const registryMissing = [];
  for (const id of expectedIds) {
    const row = byId.get(id);
    if (!row) {
      registryMissing.push(id);
      continue;
    }
    if (row.status === "failed") failed += 1;
    else if (row.status !== "passed") blockedBlocking += 1;
  }
  if (spawned) {
    if (Number(spawned.management) !== 0) failed += 1;
    if (Number(spawned.security) !== 0) failed += 1;
  }
  return { failed, blockedBlocking, registryMissing };
}

/**
 * Write `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` onto the run instance env only.
 * `enabled=true` sets `"1"`; `enabled=false` deletes the key so a later customer
 * sign-off cannot inherit proven=1 from this mutation.
 *
 * Restart is required: Lucy only sees process.env of the process that was spawned.
 *
 * @param {string} runDir
 * @param {boolean} enabled
 */
export function setForcedPredicateProven(runDir, enabled) {
  if (typeof runDir !== "string" || runDir.length === 0) {
    throw new Error("setForcedPredicateProven: runDir is required");
  }
  const runJsonPath = path.join(runDir, "run.json");
  if (!existsSync(runJsonPath)) {
    throw new Error(`setForcedPredicateProven: missing ${runJsonPath}`);
  }
  const run = JSON.parse(readFileSync(runJsonPath, "utf8"));
  if (!run.instance || typeof run.instance !== "object") {
    throw new Error("setForcedPredicateProven: run.instance is missing");
  }
  run.instance.env = { ...(run.instance.env ?? {}) };
  if (enabled) {
    run.instance.env[FORCED_PREDICATE_PROVEN_ENV] = "1";
  } else {
    delete run.instance.env[FORCED_PREDICATE_PROVEN_ENV];
  }
  writeFileSync(runJsonPath, `${JSON.stringify(run, null, 2)}\n`);
  return {
    runJsonPath,
    enabled: Boolean(enabled),
    envValue: enabled ? "1" : null,
    restartRequired: true,
    restartReason:
      "Lucy reads LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN from process.env (webui/server/proxy/row-policy.ts). Restart the same runDir / data volume after this mutation."
  };
}

/**
 * After mutating run.json, sync a live LucyProcess and restart it so the new
 * env is visible. Callers that spawn run-management / run-security instead
 * do not need this: those runners start Lucy from the updated run.instance.env.
 *
 * @param {string} runDir
 * @param {boolean} enabled
 * @param {{ run?: { instance?: { env?: Record<string, string> } }, extraEnv?: Record<string, string>, child?: unknown, restart?: Function }} [lucy]
 */
export async function applyProvenAndRestart(runDir, enabled, lucy) {
  const result = setForcedPredicateProven(runDir, enabled);
  if (!lucy) return result;
  const run = JSON.parse(readFileSync(result.runJsonPath, "utf8"));
  if (lucy.run?.instance) lucy.run.instance.env = run.instance.env;
  lucy.extraEnv = { ...(lucy.extraEnv ?? {}) };
  if (enabled) lucy.extraEnv[FORCED_PREDICATE_PROVEN_ENV] = "1";
  else delete lucy.extraEnv[FORCED_PREDICATE_PROVEN_ENV];
  if (lucy.child && typeof lucy.restart === "function") {
    await lucy.restart();
  }
  return result;
}

/** @param {"off"|"on"} phase */
export function registryEntriesForPhase(phase) {
  return REGISTRY.filter((entry) => entry.phase === phase || entry.phase === "both");
}

/** Playwright-owned execution ids for a gate phase. */
export function playwrightIdsForPhase(phase) {
  return registryEntriesForPhase(phase)
    .filter((entry) => entry.ownerFile.includes("real-e2e"))
    .map((entry) => entry.executionId);
}

/** Security catalog ids (`SEC-11-BYxx`) for a gate phase. */
export function securityCatalogIdsForPhase(phase) {
  return registryEntriesForPhase(phase)
    .filter((entry) => typeof entry.catalogId === "string")
    .map((entry) => entry.catalogId);
}

export function phaseEvidenceDir(runDir, phase) {
  return path.join(runDir, "evidence", `phase-${phase}`);
}

/**
 * Exact follow-on commands for one phase. Playwright titles may not yet contain
 * every execution id (Tasks 5/6); the grep is still the registry id list.
 *
 * @param {string} runJson
 * @param {"off"|"on"} phase
 */
export function phaseCommands(runJson, phase) {
  const grep = playwrightIdsForPhase(phase).join("|");
  const files = PLAYWRIGHT_SPEC_FILES.join(",");
  const only = securityCatalogIdsForPhase(phase).join(",");
  const management = [
    "node",
    path.join("scripts", "e2e", "run-management.mjs"),
    "--run",
    runJson,
    "--files",
    files,
    "--grep",
    `'${grep}'`
  ].join(" ");
  const security = [
    "node",
    path.join("scripts", "e2e", "run-security.mjs"),
    "--run",
    runJson,
    "--only",
    only
  ].join(" ");
  return { management, security, grep, files, only };
}

export function writePhaseEvidence(runDir, phase, payload) {
  const dir = phaseEvidenceDir(runDir, phase);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "results.json");
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return { dir, file };
}

/**
 * Printable per-id table: executionId, phase, status, ownerFile.
 *
 * @param {{ executionId: string, phase: string, status: string, ownerFile?: string }[]} rows
 */
export function formatResultTable(rows) {
  const header = ["executionId", "phase", "status", "ownerFile"];
  const body = rows.map((row) => [
    row.executionId,
    row.phase,
    row.status,
    row.ownerFile ?? ""
  ]);
  const widths = header.map((name, index) =>
    Math.max(name.length, ...body.map((line) => String(line[index]).length))
  );
  const fmt = (line) => line.map((cell, index) => String(cell).padEnd(widths[index])).join("  ");
  return [fmt(header), fmt(widths.map((width) => "-".repeat(width))), ...body.map(fmt)].join("\n");
}

export function defaultNotRunRows(phase) {
  return registryEntriesForPhase(phase).map((entry) => ({
    executionId: entry.executionId,
    catalogId: entry.catalogId,
    phase: entry.phase,
    ownerFile: entry.ownerFile,
    status: "not_run"
  }));
}
