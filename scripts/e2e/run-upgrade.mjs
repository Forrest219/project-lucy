#!/usr/bin/env node
// P1-5 customer upgrade E2E executor (NON-GATING).
//
// Scope: docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md
// Plan:  docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md section 8
//
// This file owns implementation items E1-E9 of that plan:
//   E1 five-state machine (PASSED/FAILED/BLOCKED/UNIMPLEMENTED/SKIPPED) + stable reason codes
//   E2 identity precheck, executed BEFORE anything that mutates a target environment
//   E3 isolation / ownership assertions
//   E4 empty-volume start + whole-volume overwrite ordering
//   E5 layered security-state injection + session rotation (unknown source => security SKIPPED)
//   E6 structure baseline as a hard assertion (mixed state => FAILED, never a warning)
//   E7 independent replay on a second fresh empty volume
//   E8 redacted artifacts; never release-readiness.json / ops.json / a signed bundle
//   E9 refusal paths with stable reason codes
//
// Namespace: this executor emits the P1-5 `UPG-01..UPG-16` namespace under the result
// contract `lucy-upgrade-e2e-p1/v1`. The P0 `UPG-01..UPG-14` namespace in
// scripts/e2e/contracts/upgrade-features.yaml is a DIFFERENT numbering (P0 feature coverage).
// The two are reported side by side under `namespaces` and are never merged.
//
// This executor never publishes a release decision and never writes release evidence.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { REPO_ROOT, exitCodeFor } from "./lib/common.mjs";

export const UPGRADE_E2E_P1_CONTRACT = "lucy-upgrade-e2e-p1/v1";
export const CANDIDATE_VERIFICATION_CONTRACT = "lucy-upgrade-candidate-verification/v1";
export const CONTRACT_FILE = "scripts/e2e/contracts/upgrade-e2e-p1.yaml";
export const EXISTING_FEATURE_CONTRACT_FILE = "scripts/e2e/contracts/upgrade-features.yaml";
export const EXISTING_FEATURE_CONTRACT = "lucy-upgrade-checklist/v1";

/** The five states. Only PASSED counts as passing; the other three are explicit non-passes. */
export const STATUS = Object.freeze({
  PASSED: "PASSED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  UNIMPLEMENTED: "UNIMPLEMENTED",
  SKIPPED: "SKIPPED",
});
export const STATUS_VALUES = Object.freeze(Object.values(STATUS));
export const NON_PASSING_STATUSES = Object.freeze([STATUS.BLOCKED, STATUS.UNIMPLEMENTED, STATUS.SKIPPED]);

/** Aggregate severity: FAILED wins, then BLOCKED, then UNIMPLEMENTED, then SKIPPED, then PASSED. */
const SEVERITY = Object.freeze({
  [STATUS.FAILED]: 0,
  [STATUS.BLOCKED]: 1,
  [STATUS.UNIMPLEMENTED]: 2,
  [STATUS.SKIPPED]: 3,
  [STATUS.PASSED]: 4,
});

/** `blocked` must say WHY it is blocked. */
export const BLOCK_CATEGORY = Object.freeze({
  ENVIRONMENT: "environment",
  DELIVERY: "delivery",
  CAPABILITY: "capability",
  IMPLEMENTATION: "implementation",
});

/** Stable reason codes. These are part of the executor contract; do not reword them casually. */
export const REASON = Object.freeze({
  // E2 - identity
  IDENTITY_INCOMPLETE: "IDENTITY_INCOMPLETE",
  IDENTITY_NOT_VERIFIED: "IDENTITY_NOT_VERIFIED",
  // E3 - isolation / ownership
  DEPLOYMENT_NOT_ISOLATED: "DEPLOYMENT_NOT_ISOLATED",
  TARGET_NOT_DISPOSABLE: "TARGET_NOT_DISPOSABLE",
  TARGET_NOT_OWNED_BY_THIS_RUN: "TARGET_NOT_OWNED_BY_THIS_RUN",
  CUSTOMER_NETWORK_REACHABLE: "CUSTOMER_NETWORK_REACHABLE",
  // E4 - backup / volume
  BACKUP_METHOD_UNKNOWN: "BACKUP_METHOD_UNKNOWN",
  BACKUP_METHOD_NOT_CONSISTENT: "BACKUP_METHOD_NOT_CONSISTENT",
  BACKUP_SHA256_UNVERIFIED: "BACKUP_SHA256_UNVERIFIED",
  BACKUP_MANIFEST_UNVERIFIED: "BACKUP_MANIFEST_UNVERIFIED",
  SECURITY_STORE_REQUIRES_QUIESCED_BACKUP: "SECURITY_STORE_REQUIRES_QUIESCED_BACKUP",
  VOLUME_STATE_UNKNOWN: "VOLUME_STATE_UNKNOWN",
  VOLUME_NOT_EMPTY: "VOLUME_NOT_EMPTY",
  SEED_ONLY_ENABLED: "SEED_ONLY_ENABLED",
  RESTORE_MANIFEST_MISMATCH: "RESTORE_MANIFEST_MISMATCH",
  // E5 - security state
  SECURITY_STATE_SOURCE_UNKNOWN: "SECURITY_STATE_SOURCE_UNKNOWN",
  SECURITY_STATE_NOT_VERIFIED: "SECURITY_STATE_NOT_VERIFIED",
  SECURITY_STATE_STALE: "SECURITY_STATE_STALE",
  // E6 - structure baseline
  STRUCTURE_BASELINE_UNDECLARED: "STRUCTURE_BASELINE_UNDECLARED",
  STRUCTURE_PATH_MISSING: "STRUCTURE_PATH_MISSING",
  STRUCTURE_RESIDUAL_PRESENT: "STRUCTURE_RESIDUAL_PRESENT",
  STRUCTURAL_CHANGE_NOT_APPLIED: "STRUCTURAL_CHANGE_NOT_APPLIED",
  STRUCTURE_FINGERPRINT_MISMATCH: "STRUCTURE_FINGERPRINT_MISMATCH",
  STRUCTURE_UNKNOWN_PATH: "STRUCTURE_UNKNOWN_PATH",
  // E7 - replay
  REPLAY_CONCLUSION_MISMATCH: "REPLAY_CONCLUSION_MISMATCH",
  DUPLICATE_IDENTITY: "DUPLICATE_IDENTITY",
  HALF_WRITTEN_CONFIG: "HALF_WRITTEN_CONFIG",
  // E9 - refusal paths
  MISSING_ADAPTER: "MISSING_ADAPTER",
  MISSING_IMPLEMENTATION: "MISSING_IMPLEMENTATION",
  MISSING_CAPABILITY: "MISSING_CAPABILITY",
  // generic
  ADAPTER_ERROR: "ADAPTER_ERROR",
  ASSERTION_FAILED: "ASSERTION_FAILED",
  CLEANUP_INCOMPLETE: "CLEANUP_INCOMPLETE",
});

export const REQUIRED_IDENTITY_FIELDS = Object.freeze([
  "image",
  "imageDigest",
  "imageSha256",
  "sourceSha",
  "buildInputSha256",
  "deploymentConfigVersion",
  "ktxVersion",
]);

export const UPGRADE_REQUIRED_CAPABILITIES = Object.freeze([
  "wholeVolumeBackup",
  "consistentBackup",
  "sessionSecretRotation",
]);

export const CANDIDATE_REQUIRED_CAPABILITIES = Object.freeze([
  "emptyVolumeStart",
  "wholeVolumeRestore",
  "securityStateInjection",
  "sessionSecretRotation",
]);

/** P1-5 acceptance numbering -> the phase that produces its evidence. */
export const UPG_STAGES = Object.freeze({
  "UPG-01": "identity",
  "UPG-02": "backup",
  "UPG-03": "upgrade",
  "UPG-04": "continuity",
  "UPG-05": "continuity",
  "UPG-06": "continuity",
  "UPG-07": "continuity",
  "UPG-08": "admin",
  "UPG-09": "admin",
  "UPG-10": "admin",
  "UPG-11": "recovery",
  "UPG-12": "recovery",
  "UPG-13": "recovery",
  "UPG-14": "recovery",
  "UPG-15": "recovery",
  "UPG-16": "availability",
});

/** P1-6 acceptance numbering -> the phase that produces its evidence. */
export const RVC_STAGES = Object.freeze({
  "RVC-01": "preflight",
  "RVC-02": "preflight",
  "RVC-03": "empty_volume",
  "RVC-04": "restore",
  "RVC-05": "structure",
  "RVC-06": "assertions",
  "RVC-07": "assertions",
  "RVC-08": "assertions",
  "RVC-09": "assertions",
  "RVC-10": "assertions",
  "RVC-11": "assertions",
  "RVC-12": "replay",
  "RVC-13": "teardown",
});

export const ARTIFACT_NAMES = Object.freeze([
  "run.json",
  "before.json",
  "after.json",
  "backup.json",
  "upgrade.json",
  "recovery.json",
  "restore.json",
  "assertions.json",
  "report.md",
]);

export const FORBIDDEN_ARTIFACT_NAMES = Object.freeze([
  "release-readiness.json",
  "ops.json",
  "release-bundle.json",
]);
export const FORBIDDEN_ARTIFACT_PATTERNS = Object.freeze([/\.sig$/i, /\.asc$/i, /^signed[-_.]/i, /^release[-_.].*\.(sig|asc)$/i]);

const SECRET_FIELD_PATTERN = /(token|password|passwd|secret|cookie|credential|api[_-]?key|session[_-]?key|signing[_-]?key)/i;
const REDACTED = "***REDACTED***";

/* ------------------------------------------------------------------ helpers */

function blocked(reason, extra = {}) {
  return {
    status: STATUS.BLOCKED,
    reason,
    category: extra.category ?? BLOCK_CATEGORY.ENVIRONMENT,
    missing: extra.missing ?? [],
    detail: extra.detail ?? null,
  };
}

function unimplemented(reason, extra = {}) {
  return {
    status: STATUS.UNIMPLEMENTED,
    reason,
    category: extra.category ?? BLOCK_CATEGORY.IMPLEMENTATION,
    missing: extra.missing ?? [],
    detail: extra.detail ?? null,
  };
}

function failed(reason, extra = {}) {
  return {
    status: STATUS.FAILED,
    reason,
    category: extra.category ?? null,
    missing: extra.missing ?? [],
    detail: extra.detail ?? null,
  };
}

function passed(extra = {}) {
  return { status: STATUS.PASSED, reason: null, category: null, missing: [], detail: null, ...extra };
}

export function aggregateStatus(statuses) {
  if (!statuses.length) return STATUS.BLOCKED;
  return statuses.reduce((worst, status) => (SEVERITY[status] < SEVERITY[worst] ? status : worst), STATUS.PASSED);
}

export function summarize(entries) {
  const summary = { passed: 0, failed: 0, blocked: 0, unimplemented: 0, skipped: 0 };
  for (const entry of entries) {
    const key = entry.status.toLowerCase();
    if (key in summary) summary[key] += 1;
  }
  summary.total = entries.length;
  summary.passing = summary.passed;
  return summary;
}

/* ------------------------------------------------------------------ E2 identity */

/**
 * Both ends must be pinned: image reference, registry digest, image package SHA256, source SHA,
 * build input digest, deployment config version and KTX version. An incomplete identity is
 * BLOCKED (delivery), never a pass, and the caller must stop before any mutation.
 */
export function evaluateIdentity(identity = {}) {
  const missing = [];
  for (const side of ["baseline", "candidate"]) {
    const value = identity?.[side] ?? {};
    for (const field of REQUIRED_IDENTITY_FIELDS) {
      const raw = value[field];
      if (raw === undefined || raw === null || (typeof raw === "string" && !raw.trim())) missing.push(`${side}.${field}`);
    }
  }
  if (missing.length > 0) {
    return blocked(REASON.IDENTITY_INCOMPLETE, {
      category: identity?.blockCategory ?? BLOCK_CATEGORY.DELIVERY,
      missing,
      detail: { missing },
    });
  }
  const unverified = ["baseline", "candidate"].filter((side) => identity[side].imageDigestVerified !== true);
  if (unverified.length > 0) {
    return blocked(REASON.IDENTITY_NOT_VERIFIED, {
      category: identity?.blockCategory ?? BLOCK_CATEGORY.DELIVERY,
      missing: unverified.map((side) => `${side}.imageDigestVerified`),
      detail: { missing: unverified },
    });
  }
  return passed();
}

/* ------------------------------------------------------------------ E3 isolation */

export const ISOLATION_CHECKS = Object.freeze([
  { id: "isolated", reason: REASON.DEPLOYMENT_NOT_ISOLATED },
  { id: "disposable", reason: REASON.TARGET_NOT_DISPOSABLE },
  { id: "ownedByThisRun", reason: REASON.TARGET_NOT_OWNED_BY_THIS_RUN },
  { id: "customerNetworkUnreachable", reason: REASON.CUSTOMER_NETWORK_REACHABLE },
]);

export function evaluateIsolation(deployment = {}) {
  const checks = ISOLATION_CHECKS.map((check) => {
    const ok = check.id === "customerNetworkUnreachable"
      ? deployment.ingressReachableFromCustomerNetwork !== true
      : deployment[check.id] === true;
    return { id: check.id, ok, reason: ok ? null : check.reason };
  });
  const broken = checks.filter((check) => !check.ok);
  if (broken.length > 0) {
    return blocked(broken[0].reason, {
      category: BLOCK_CATEGORY.ENVIRONMENT,
      missing: broken.map((check) => check.id),
      detail: { checks },
    });
  }
  return passed({ detail: { checks } });
}

/* ------------------------------------------------------------------ E4 backup / volume */

const CONSISTENT_BACKUP_METHODS = new Set(["quiesced", "verified-consistent"]);

export function evaluateBackup(backup = {}) {
  const method = typeof backup.method === "string" ? backup.method.trim().toLowerCase() : "";
  const hasSecurityStore = backup.containsSecurityStore === true;
  if (!method || method === "unknown") {
    return blocked(REASON.BACKUP_METHOD_UNKNOWN, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { method: method || null, hasSecurityStore } });
  }
  const consistent = method === "quiesced" || (method === "verified-consistent" && backup.consistencyVerified === true);
  // A WAL security store is only safe to restore from a quiesced whole-volume backup. This is
  // the more specific refusal, so it is reported before the generic consistency refusal.
  if (hasSecurityStore && method !== "quiesced") {
    return blocked(REASON.SECURITY_STORE_REQUIRES_QUIESCED_BACKUP, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { method, hasSecurityStore } });
  }
  if (!consistent) {
    return blocked(REASON.BACKUP_METHOD_NOT_CONSISTENT, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { method, hasSecurityStore } });
  }
  if (backup.sha256Verified !== true) {
    return blocked(REASON.BACKUP_SHA256_UNVERIFIED, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { method, hasSecurityStore } });
  }
  if (backup.fileManifestVerified !== true) {
    return blocked(REASON.BACKUP_MANIFEST_UNVERIFIED, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { method, hasSecurityStore } });
  }
  return passed({ detail: { method, hasSecurityStore, restorePoint: backup.restorePoint ?? null } });
}

/** R-D2: a non-empty volume or a seed-only start is FAILED, and the candidate must not start. */
export function evaluateVolumeStart(volume = {}) {
  if (!Number.isInteger(volume.fileCount)) {
    return blocked(REASON.VOLUME_STATE_UNKNOWN, { category: BLOCK_CATEGORY.ENVIRONMENT, detail: { fileCount: volume.fileCount ?? null } });
  }
  if (volume.seedOnly === true) {
    return failed(REASON.SEED_ONLY_ENABLED, { detail: { fileCount: volume.fileCount } });
  }
  if (volume.fileCount !== 0) {
    return failed(REASON.VOLUME_NOT_EMPTY, { detail: { fileCount: volume.fileCount } });
  }
  return passed({ detail: { fileCount: 0, seedOnly: volume.seedOnly === true } });
}

/* ------------------------------------------------------------------ E5 security state */

/**
 * Layered restore: business volume first, then the verified latest security state, then a
 * session-secret rotation. When the source is unknown, stale or unverified the security
 * assertions are SKIPPED - never PASSED, and never silently folded into a global pass.
 */
export function evaluateSecuritySource(source) {
  if (!source || source.identified !== true) {
    return { enabled: false, status: STATUS.SKIPPED, reason: REASON.SECURITY_STATE_SOURCE_UNKNOWN, category: BLOCK_CATEGORY.DELIVERY, sourceId: null };
  }
  if (source.verified !== true) {
    return { enabled: false, status: STATUS.SKIPPED, reason: REASON.SECURITY_STATE_NOT_VERIFIED, category: BLOCK_CATEGORY.DELIVERY, sourceId: source.sourceId ?? null };
  }
  if (source.fresh !== true) {
    return { enabled: false, status: STATUS.SKIPPED, reason: REASON.SECURITY_STATE_STALE, category: BLOCK_CATEGORY.DELIVERY, sourceId: source.sourceId ?? null };
  }
  return { enabled: true, status: STATUS.PASSED, reason: null, category: null, sourceId: source.sourceId ?? null, confirmedBy: source.confirmedBy ?? null };
}

/* ------------------------------------------------------------------ E6 structure baseline */

const STRUCTURE_PROBLEM_REASON = Object.freeze({
  missing: REASON.STRUCTURE_PATH_MISSING,
  residual_present: REASON.STRUCTURE_RESIDUAL_PRESENT,
  declared_change_missing: REASON.STRUCTURAL_CHANGE_NOT_APPLIED,
  kind_mismatch: REASON.STRUCTURE_FINGERPRINT_MISMATCH,
  fingerprint_mismatch: REASON.STRUCTURE_FINGERPRINT_MISMATCH,
  unknown_path: REASON.STRUCTURE_UNKNOWN_PATH,
});

/**
 * R-D7: the structure baseline is a hard assertion. A mixed state, a half-written config or an
 * unknown path is FAILED. It is never downgraded to a warning.
 */
export function evaluateStructureBaseline({ expectedPaths = [], structuralChangePaths = [], actual = {} } = {}) {
  const mismatches = [];
  const declared = new Set();
  const compare = (item, missingProblem) => {
    declared.add(item.path);
    const observed = actual[item.path];
    if (!observed) {
      mismatches.push({ path: item.path, problem: missingProblem });
      return;
    }
    if (item.kind && observed.kind !== item.kind) {
      mismatches.push({ path: item.path, problem: "kind_mismatch", expected: item.kind, actual: observed.kind });
    }
    if (item.fingerprint && observed.fingerprint !== item.fingerprint) {
      mismatches.push({ path: item.path, problem: "fingerprint_mismatch", expected: item.fingerprint, actual: observed.fingerprint });
    }
  };
  for (const item of expectedPaths) {
    if (item.expected === "absent") {
      declared.add(item.path);
      if (actual[item.path]) mismatches.push({ path: item.path, problem: "residual_present" });
      continue;
    }
    compare(item, "missing");
  }
  for (const item of structuralChangePaths) compare(item, "declared_change_missing");
  for (const observedPath of Object.keys(actual)) {
    if (!declared.has(observedPath)) mismatches.push({ path: observedPath, problem: "unknown_path" });
  }
  if (mismatches.length > 0) {
    const reason = STRUCTURE_PROBLEM_REASON[mismatches[0].problem] ?? REASON.ASSERTION_FAILED;
    return failed(reason, { detail: { mismatches } });
  }
  return passed({ detail: { checked: declared.size } });
}

/* ------------------------------------------------------------------ E7 replay */

/** Accepts either the result shape (an array of { id, status }) or a plain id -> status map. */
function toStatusMap(entries) {
  const map = new Map();
  if (Array.isArray(entries)) {
    for (const entry of entries) if (entry && entry.id) map.set(entry.id, entry.status);
    return map;
  }
  if (entries && typeof entries === "object") {
    for (const [id, value] of Object.entries(entries)) {
      map.set(id, typeof value === "string" ? value : value?.status ?? null);
    }
  }
  return map;
}

export function compareReplay(primary, replay) {
  const diffs = [];
  const primaryById = toStatusMap(primary?.entries);
  const replayById = toStatusMap(replay?.entries);
  for (const [id, status] of primaryById) {
    const other = replayById.get(id);
    if (other !== status) diffs.push({ id, kind: "conclusion", expected: status, actual: other ?? null });
  }
  for (const key of ["instanceId", "volumeId", "namespace", "releaseName"]) {
    const a = primary?.identity?.[key];
    const b = replay?.identity?.[key];
    if (a && b && a === b) diffs.push({ key, kind: "duplicate_identity", value: a });
  }
  for (const side of [primary, replay]) {
    for (const item of side?.halfWrittenConfig ?? []) diffs.push({ path: item, kind: "half_written_config" });
  }
  if (diffs.length > 0) {
    const kind = diffs[0].kind;
    const reason = kind === "duplicate_identity"
      ? REASON.DUPLICATE_IDENTITY
      : kind === "half_written_config"
        ? REASON.HALF_WRITTEN_CONFIG
        : REASON.REPLAY_CONCLUSION_MISMATCH;
    return failed(reason, { detail: { diffs } });
  }
  return passed({ detail: { compared: primaryById.size } });
}

/* ------------------------------------------------------------------ E8 artifacts */

export function redactText(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 6) out = out.split(secret).join(REDACTED);
  }
  return out;
}

export function redactValue(value, secrets = []) {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_FIELD_PATTERN.test(key) && typeof item === "string" ? REDACTED : redactValue(item, secrets),
      ]),
    );
  }
  return value;
}

export function assertArtifactPolicy(dir) {
  const hits = [];
  const walk = (current) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const base = entry.name;
        if (FORBIDDEN_ARTIFACT_NAMES.includes(base) || FORBIDDEN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(base))) {
          hits.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  return { status: hits.length ? STATUS.FAILED : STATUS.PASSED, hits };
}

export function scanArtifactSecrets(dir, secrets = []) {
  const values = secrets.filter((secret) => typeof secret === "string" && secret.length >= 8);
  const hits = [];
  const walk = (current) => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const content = readFileSync(full, "utf8");
        if (values.some((secret) => content.includes(secret))) hits.push(path.relative(dir, full));
      }
    }
  };
  walk(dir);
  return { status: hits.length ? STATUS.FAILED : STATUS.PASSED, hits };
}

export function writeScenarioArtifacts(dir, files, { secrets = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    if (FORBIDDEN_ARTIFACT_NAMES.includes(name)) throw new Error(`refusing to write forbidden artifact ${name}`);
    const body = typeof content === "string" ? content : `${JSON.stringify(redactValue(content, secrets), null, 2)}\n`;
    const target = path.join(dir, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? redactText(body, secrets) : body);
    written.push(name);
  }
  return { dir, written };
}

/* ------------------------------------------------------------------ capabilities / adapter */

export function evaluateCapabilities(capabilities = {}, required = []) {
  const missing = required.filter((name) => capabilities?.[name] !== true);
  if (missing.length > 0) {
    return unimplemented(REASON.MISSING_CAPABILITY, { category: BLOCK_CATEGORY.CAPABILITY, missing });
  }
  return passed({ missing: [] });
}

export function evaluateAdapter(adapter, form) {
  if (!adapter || typeof adapter !== "object") {
    return unimplemented(REASON.MISSING_ADAPTER, { missing: [form ?? "adapter"] });
  }
  if (form && adapter.form && adapter.form !== form) {
    return unimplemented(REASON.MISSING_ADAPTER, { missing: [form] });
  }
  return passed({ missing: [] });
}

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

function normalizeAssertion(id, raw) {
  if (!raw || typeof raw !== "object") {
    return { status: STATUS.UNIMPLEMENTED, reason: REASON.MISSING_IMPLEMENTATION, category: BLOCK_CATEGORY.IMPLEMENTATION, evidence: null };
  }
  const status = typeof raw.status === "string" ? raw.status.toUpperCase() : "";
  if (!STATUS_VALUES.includes(status)) {
    return { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, evidence: raw.evidence ?? null, detail: raw.detail ?? null };
  }
  return {
    status,
    reason: raw.reason ?? null,
    category: raw.category ?? null,
    evidence: raw.evidence ?? null,
    detail: raw.detail ?? null,
  };
}

function assertionsStatus(assertions) {
  return aggregateStatus(Object.values(assertions).map((item) => item.status));
}

/**
 * A group of acceptance ids that all share one verdict. The status is the phase verdict, so a
 * missing adapter (UNIMPLEMENTED) is never reported as an environment block.
 */
export function blockedAssertions(ids, reason, category, blockedBy, status = STATUS.BLOCKED) {
  return Object.fromEntries(
    ids.map((id) => [id, { status, reason, category, blockedBy, evidence: null }]),
  );
}

/* ------------------------------------------------------------------ phase engine */

/**
 * Runs the phases in order and stops at the first phase that is not PASSED.
 * SKIPPED does not stop the run: a skipped precondition (for example an unverified security
 * state) is recorded and the remaining, independent assertions still run.
 */
export async function runPhases(phases, ctx) {
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
    if (status === STATUS.FAILED || status === STATUS.BLOCKED || status === STATUS.UNIMPLEMENTED) {
      return { results, stoppedAt: phase.id, stopStatus: status, stopReason: outcome.reason ?? null, stopCategory: outcome.category ?? null };
    }
  }
  return { results, stoppedAt: null, stopStatus: null, stopReason: null, stopCategory: null };
}

export function projectEntries(idStages, phaseResults, stop) {
  const entries = [];
  for (const [id, stage] of Object.entries(idStages)) {
    const source = phaseResults.find((phase) => phase.stage === stage && phase.assertions?.[id]);
    if (source) {
      const assertion = source.assertions[id];
      entries.push({
        id,
        stage,
        status: assertion.status,
        reason: assertion.reason ?? null,
        category: assertion.category ?? null,
        blockedBy: assertion.blockedBy ?? null,
        evidence: assertion.evidence ?? null,
        detail: assertion.detail ?? null,
        source: source.id,
      });
      continue;
    }
    if (stop?.stoppedAt) {
      entries.push({
        id,
        stage,
        status: stop.stopStatus,
        reason: stop.stopReason,
        category: stop.stopCategory,
        blockedBy: stop.stoppedAt,
        evidence: null,
        detail: null,
        source: null,
      });
      continue;
    }
    entries.push({
      id,
      stage,
      status: STATUS.UNIMPLEMENTED,
      reason: REASON.MISSING_IMPLEMENTATION,
      category: BLOCK_CATEGORY.IMPLEMENTATION,
      blockedBy: null,
      evidence: null,
      detail: null,
      source: null,
    });
  }
  return entries;
}

/* ------------------------------------------------------------------ namespace partition */

export function namespacePartition() {
  return [
    {
      namespace: "UPG",
      contract: UPGRADE_E2E_P1_CONTRACT,
      range: "UPG-01..UPG-16",
      meaning: "客户升级场景（P1-5）",
      source: "docs/specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md#6-验收矩阵",
      producedByThisRun: true,
    },
    {
      namespace: "UPG",
      contract: EXISTING_FEATURE_CONTRACT,
      range: "UPG-01..UPG-14",
      meaning: "P0 期功能覆盖（管理台登录安全、多角色保存与查询等）",
      source: `scripts/e2e/contracts/upgrade-features.yaml`,
      producedByThisRun: false,
      note: "与 P1-5 的 UPG 编号同号不同义；本执行器不产生该命名空间的任何结论。",
    },
    {
      namespace: "RVC",
      contract: CANDIDATE_VERIFICATION_CONTRACT,
      range: "RVC-01..RVC-13",
      meaning: "升级候选验证场景（P1-6）",
      source: "docs/specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md#6-验收矩阵",
      producedByThisRun: false,
    },
  ];
}

/* ------------------------------------------------------------------ P1-5 phases */

async function upgradeIdentityPhase(ctx) {
  const identity = evaluateIdentity(ctx.plan.identity);
  if (identity.status !== STATUS.PASSED) {
    return { status: identity.status, reason: identity.reason, category: identity.category, detail: identity.detail, assertions: blockedAssertions(["UPG-01"], identity.reason, identity.category, "identity") };
  }
  const isolation = evaluateIsolation(ctx.plan.deployment);
  if (isolation.status !== STATUS.PASSED) {
    return { status: isolation.status, reason: isolation.reason, category: isolation.category, detail: isolation.detail, assertions: blockedAssertions(["UPG-01"], isolation.reason, isolation.category, "isolation") };
  }
  const adapter = evaluateAdapter(ctx.adapter, ctx.plan.deployment?.form);
  if (adapter.status !== STATUS.PASSED) {
    return { status: adapter.status, reason: adapter.reason, category: adapter.category, detail: { missing: adapter.missing }, assertions: blockedAssertions(["UPG-01"], adapter.reason, adapter.category, "adapter", adapter.status) };
  }
  const capabilities = evaluateCapabilities(ctx.plan.capabilities, UPGRADE_REQUIRED_CAPABILITIES);
  if (capabilities.status !== STATUS.PASSED) {
    return { status: capabilities.status, reason: capabilities.reason, category: capabilities.category, detail: { missing: capabilities.missing }, assertions: blockedAssertions(["UPG-01"], capabilities.reason, capabilities.category, "capabilities", capabilities.status) };
  }
  return {
    status: STATUS.PASSED,
    assertions: {
      "UPG-01": {
        status: STATUS.PASSED,
        reason: null,
        category: null,
        evidence: {
          baseline: ctx.plan.identity.baseline,
          candidate: ctx.plan.identity.candidate,
          isolation: isolation.detail?.checks ?? [],
          capabilities: UPGRADE_REQUIRED_CAPABILITIES,
          preflightMutations: 0,
        },
      },
    },
  };
}

async function upgradeBaselinePhase(ctx) {
  const install = await callAdapter(ctx, "installBaseline");
  if (!install.ok) return { status: install.status, reason: install.reason, category: install.category, detail: install.detail ?? null };
  const seed = await callAdapter(ctx, "seedAssets");
  if (!seed.ok) return { status: seed.status, reason: seed.reason, category: seed.category, detail: seed.detail ?? null };
  const capture = await callAdapter(ctx, "captureBaseline");
  if (!capture.ok) return { status: capture.status, reason: capture.reason, category: capture.category, detail: capture.detail ?? null };
  const preflight = await callAdapter(ctx, "preflightCandidate");
  if (!preflight.ok) return { status: preflight.status, reason: preflight.reason, category: preflight.category, detail: preflight.detail ?? null };
  const value = preflight.value ?? {};
  if (value.ok === false) {
    return { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, detail: { preflight: value } };
  }
  ctx.state.baseline = { install: install.value ?? null, seed: seed.value ?? null, capture: capture.value ?? null };
  return { status: STATUS.PASSED, assertions: {} };
}

async function upgradeBackupPhase(ctx) {
  const backup = evaluateBackup(ctx.plan.backup);
  if (backup.status !== STATUS.PASSED) {
    return { status: backup.status, reason: backup.reason, category: backup.category, detail: backup.detail, assertions: blockedAssertions(["UPG-02"], backup.reason, backup.category, "backup") };
  }
  const taken = await callAdapter(ctx, "backupVolume");
  if (!taken.ok) return { status: taken.status, reason: taken.reason, category: taken.category, detail: taken.detail ?? null, assertions: blockedAssertions(["UPG-02"], taken.reason, taken.category, "backup", taken.status) };
  const restored = await callAdapter(ctx, "restoreIndependent");
  if (!restored.ok) return { status: restored.status, reason: restored.reason, category: restored.category, detail: restored.detail ?? null, assertions: blockedAssertions(["UPG-02"], restored.reason, restored.category, "restore", restored.status) };
  const value = restored.value ?? {};
  if (value.manifestMatched === false) {
    return { status: STATUS.FAILED, reason: REASON.RESTORE_MANIFEST_MISMATCH, category: null, detail: { restore: value }, assertions: { "UPG-02": { status: STATUS.FAILED, reason: REASON.RESTORE_MANIFEST_MISMATCH, category: null, evidence: { restore: value } } } };
  }
  ctx.state.backup = taken.value ?? null;
  ctx.state.restore = value;
  return { status: STATUS.PASSED, assertions: { "UPG-02": { status: STATUS.PASSED, reason: null, category: null, evidence: { backup: taken.value ?? null, restore: value } } } };
}

async function upgradeUpgradePhase(ctx) {
  const upgraded = await callAdapter(ctx, "upgradeInPlace");
  if (!upgraded.ok) return { status: upgraded.status, reason: upgraded.reason, category: upgraded.category, detail: upgraded.detail ?? null, assertions: blockedAssertions(["UPG-03"], upgraded.reason, upgraded.category, "upgrade", upgraded.status) };
  const value = upgraded.value ?? {};
  if (value.imageIdentityChanged === false) {
    return { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, detail: { upgrade: value }, assertions: { "UPG-03": { status: STATUS.FAILED, reason: REASON.ASSERTION_FAILED, category: null, evidence: { upgrade: value } } } };
  }
  ctx.state.upgrade = value;
  return { status: STATUS.PASSED, assertions: { "UPG-03": { status: STATUS.PASSED, reason: null, category: null, evidence: { upgrade: value } } } };
}

async function upgradeContinuityPhase(ctx) {
  const call = await callAdapter(ctx, "assertContinuity");
  if (!call.ok) {
    return { status: call.status, reason: call.reason, category: call.category, detail: call.detail ?? null, assertions: blockedAssertions(["UPG-04", "UPG-05", "UPG-06", "UPG-07"], call.reason, call.category, "continuity", call.status) };
  }
  const raw = call.value ?? {};
  const assertions = {
    "UPG-04": normalizeAssertion("UPG-04", raw["UPG-04"]),
    "UPG-06": normalizeAssertion("UPG-06", raw["UPG-06"]),
    "UPG-07": normalizeAssertion("UPG-07", raw["UPG-07"]),
  };
  const security = evaluateSecuritySource(ctx.plan.securitySource);
  assertions["UPG-05"] = security.enabled
    ? normalizeAssertion("UPG-05", raw["UPG-05"])
    : { status: STATUS.SKIPPED, reason: security.reason, category: security.category, evidence: { note: "最新安全状态来源未确认；安全连续性断言未执行，不得记为通过。" } };
  ctx.state.security = security;
  return { status: assertionsStatus(assertions), assertions };
}

async function upgradeAdminPhase(ctx) {
  const call = await callAdapter(ctx, "assertAdmin");
  if (!call.ok) {
    return { status: call.status, reason: call.reason, category: call.category, detail: call.detail ?? null, assertions: blockedAssertions(["UPG-08", "UPG-09", "UPG-10"], call.reason, call.category, "admin", call.status) };
  }
  const raw = call.value ?? {};
  const assertions = {
    "UPG-08": normalizeAssertion("UPG-08", raw["UPG-08"]),
    "UPG-09": normalizeAssertion("UPG-09", raw["UPG-09"]),
    "UPG-10": normalizeAssertion("UPG-10", raw["UPG-10"]),
  };
  return { status: assertionsStatus(assertions), assertions };
}

async function upgradeRecoveryPhase(ctx) {
  const call = await callAdapter(ctx, "assertRecovery");
  if (!call.ok) {
    return { status: call.status, reason: call.reason, category: call.category, detail: call.detail ?? null, assertions: blockedAssertions(["UPG-11", "UPG-12", "UPG-13", "UPG-14", "UPG-15"], call.reason, call.category, "recovery", call.status) };
  }
  const raw = call.value ?? {};
  const assertions = Object.fromEntries(
    ["UPG-11", "UPG-12", "UPG-13", "UPG-14", "UPG-15"].map((id) => [id, normalizeAssertion(id, raw[id])]),
  );
  // UPG-13 (旧快照安全恢复) is a security assertion: without a verified latest security state
  // it is skipped, never passed.
  const security = ctx.state.security ?? evaluateSecuritySource(ctx.plan.securitySource);
  if (!security.enabled && assertions["UPG-13"].status === STATUS.PASSED) {
    assertions["UPG-13"] = { status: STATUS.SKIPPED, reason: security.reason, category: security.category, evidence: { note: "最新安全状态来源未确认；旧快照安全恢复断言未执行。" } };
  }
  ctx.state.recovery = raw;
  return { status: assertionsStatus(assertions), assertions };
}

async function upgradeAvailabilityPhase(ctx) {
  const call = await callAdapter(ctx, "observeAvailability");
  if (!call.ok) {
    return { status: call.status, reason: call.reason, category: call.category, detail: call.detail ?? null, assertions: blockedAssertions(["UPG-16"], call.reason, call.category, "availability", call.status) };
  }
  const value = call.value ?? {};
  const assertions = { "UPG-16": normalizeAssertion("UPG-16", value) };
  return { status: assertionsStatus(assertions), assertions };
}

export const UPGRADE_PHASES = Object.freeze([
  { id: "identity", stage: "identity", run: upgradeIdentityPhase },
  { id: "baseline", stage: "baseline", run: upgradeBaselinePhase },
  { id: "backup", stage: "backup", run: upgradeBackupPhase },
  { id: "upgrade", stage: "upgrade", run: upgradeUpgradePhase },
  { id: "continuity", stage: "continuity", run: upgradeContinuityPhase },
  { id: "admin", stage: "admin", run: upgradeAdminPhase },
  { id: "recovery", stage: "recovery", run: upgradeRecoveryPhase },
  { id: "availability", stage: "availability", run: upgradeAvailabilityPhase },
]);

/* ------------------------------------------------------------------ P1-5 scenario */

export async function runUpgradeScenario(plan, options = {}) {
  const {
    adapter = null,
    contract = UPGRADE_E2E_P1_CONTRACT,
    namespace = "UPG",
    now = () => new Date().toISOString(),
  } = options;
  const ctx = { plan, adapter, trace: [], state: {} };
  const phases = UPGRADE_PHASES.map((phase) => ({ ...phase, run: (context) => phase.run(context) }));
  const run = await runPhases(phases, ctx);
  const entries = projectEntries(UPG_STAGES, run.results, run);
  const result = {
    contract,
    namespace,
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
  return result;
}

/* ------------------------------------------------------------------ shared report */

export function renderScenarioReport(result, { title, artifactDir } = {}) {
  const lines = [];
  lines.push(`# ${title ?? "Upgrade scenario report"}`);
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| result contract | \`${result.contract}\` |`);
  lines.push(`| namespace | \`${result.namespace}\` |`);
  lines.push(`| run id | ${result.runId ?? "-"} |`);
  lines.push(`| aggregate status | **${result.status}** |`);
  lines.push(`| passing / total | ${result.summary.passed} / ${result.summary.total} |`);
  lines.push(`| release eligible | ${result.releaseEligible} |`);
  if (artifactDir) lines.push(`| artifacts | \`${artifactDir}\` |`);
  lines.push("");
  lines.push("## Namespaces (partitioned, with sources)");
  lines.push("");
  lines.push("| namespace | contract | range | meaning | source | produced by this run |");
  lines.push("|---|---|---|---|---|---|");
  for (const namespace of result.namespaces) {
    lines.push(`| ${namespace.namespace} | \`${namespace.contract}\` | ${namespace.range} | ${namespace.meaning} | \`${namespace.source}\` | ${namespace.producedByThisRun ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("> The P0 `UPG-01..UPG-14` feature-coverage namespace and the P1-5 `UPG-01..UPG-16` upgrade-scenario namespace share numbers but not meaning. They are never merged.");
  lines.push("");
  lines.push("## Acceptance results");
  lines.push("");
  lines.push("| id | status | reason | category | blocked by |");
  lines.push("|---|---|---|---|---|");
  for (const entry of result.entries) {
    lines.push(`| ${entry.id} | ${entry.status} | ${entry.reason ?? "-"} | ${entry.category ?? "-"} | ${entry.blockedBy ?? "-"} |`);
  }
  lines.push("");
  lines.push("## Phase trace");
  lines.push("");
  lines.push(`\`${result.trace.join(" -> ")}\``);
  if (result.stoppedAt) {
    lines.push("");
    lines.push(`Stopped at phase \`${result.stoppedAt}\` with \`${result.stopStatus}\` (${result.stopReason ?? "no reason"}).`);
  }
  lines.push("");
  lines.push("## Not covered");
  lines.push("");
  const uncovered = result.entries.filter((entry) => entry.status !== STATUS.PASSED);
  if (uncovered.length === 0) lines.push("None.");
  else for (const entry of uncovered) lines.push(`- ${entry.id}: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}`);
  lines.push("");
  lines.push("This report is non-gating evidence. It does not publish a release decision.");
  lines.push("");
  return lines.join("\n");
}

/* ------------------------------------------------------------------ local identity / CLI */

const BUILD_INPUT_FILES = Object.freeze([
  "scripts/e2e/run-upgrade.mjs",
  "scripts/e2e/contracts/upgrade-e2e-p1.yaml",
  "scripts/upgrade/verify-candidate.mjs",
]);

/** The only identity this repository can prove locally: source commit + build input digest. */
export function localSourceIdentity() {
  const git = (args) => {
    const out = spawnSync("git", args, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
    return out.status === 0 ? out.stdout.toString() : "";
  };
  const head = git(["rev-parse", "HEAD"]).trim();
  if (!head) return null;
  const patch = git(["diff", "HEAD", "--binary"]);
  const files = {};
  for (const file of BUILD_INPUT_FILES) {
    const full = path.join(REPO_ROOT, file);
    files[file] = existsSync(full) ? createHash("sha256").update(readFileSync(full)).digest("hex") : null;
  }
  return {
    sourceSha: head,
    buildInputSha256: createHash("sha256").update(`${patch}\0${JSON.stringify(files)}`).digest("hex"),
    buildInputFiles: files,
  };
}

/**
 * The default plan describes what this round can actually prove. There is no candidate image
 * identity (G-06 registry namespace is not unlocked) and no isolated customer target (G-01),
 * so the scenario must report BLOCKED before touching anything.
 */
export function buildDefaultPlan({ runId, deploymentForm = "docker" } = {}) {
  const local = localSourceIdentity() ?? {};
  return {
    runId: runId ?? null,
    deployment: {
      form: deploymentForm,
      isolated: false,
      disposable: false,
      ownedByThisRun: false,
      ingressReachableFromCustomerNetwork: true,
    },
    identity: { baseline: { ...local }, candidate: { ...local } },
    backup: { method: "unknown" },
    securitySource: null,
    capabilities: {},
    delivery: {
      status: "blocked_delivery",
      blockers: ["G-01-protected-runner-not-registered", "G-06-ghcr-namespace-token-not-unlocked"],
      missing: ["baseline image identity", "candidate image identity", "real backup", "latest security state source"],
    },
    notes: [
      "No baseline or candidate image identity exists in this round; the identity precheck stops the run before any mutation.",
      "This result is non-gating evidence and never a release approval.",
    ],
  };
}

export function loadPlanFile(file) {
  const raw = readFileSync(path.resolve(file), "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return parseYaml(raw);
  }
}

export function loadContract() {
  return parseYaml(readFileSync(path.join(REPO_ROOT, CONTRACT_FILE), "utf8"));
}

export function loadExistingFeatureContract() {
  return parseYaml(readFileSync(path.join(REPO_ROOT, EXISTING_FEATURE_CONTRACT_FILE), "utf8"));
}

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
  node scripts/e2e/run-upgrade.mjs [--plan <plan.json|yaml>] [--run-id <id>] [--out <dir>]

Options:
  --plan <file>   Scenario plan (identity, deployment, backup, security source, capabilities).
  --run-id <id>   Run identifier (default: upgrade-p1-<timestamp>).
  --out <dir>     Artifact directory (default: inbox/upgrade-e2e/<run-id>).
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
  const runId = args["run-id"] ?? `upgrade-p1-${Date.now()}`;
  const plan = args.plan ? { ...loadPlanFile(args.plan) } : buildDefaultPlan({ runId });
  plan.runId = runId;
  const outDir = path.resolve(args.out ?? path.join(REPO_ROOT, "inbox", "upgrade-e2e", runId));
  const result = await runUpgradeScenario(plan);
  const assertions = { contract: result.contract, namespace: result.namespace, runId: result.runId, entries: result.entries, summary: result.summary };
  const artifacts = {
    "run.json": {
      contract: result.contract,
      namespace: result.namespace,
      runId: result.runId,
      deployment: result.deployment,
      identity: result.identity,
      releaseEligible: false,
      delivery: result.delivery,
      namespaces: result.namespaces,
    },
    "before.json": { captured: false, note: "基线资产快照未采集：身份预检在变更前停止。", state: null },
    "after.json": { captured: false, note: "升级后资产快照未采集：升级未执行。", state: null },
    "backup.json": { method: plan.backup?.method ?? "unknown", evaluated: false, note: "备份未执行：身份预检在变更前停止。", state: null },
    "upgrade.json": { executed: false, note: "原地升级未执行。", state: null },
    "recovery.json": { executed: false, note: "故障与恢复分支未执行。", state: null },
    "restore.json": { executed: false, note: "独立实例恢复未执行。", state: null },
    "assertions.json": assertions,
    "report.md": renderScenarioReport(result, { title: "Lucy P1-5 customer upgrade E2E report", artifactDir: outDir }),
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
