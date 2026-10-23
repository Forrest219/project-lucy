#!/usr/bin/env node
// The ONE verifier (Spec §8.4, Plan T13). It consumes only schema-valid artifacts and decides:
//   passed  (exit 0)  every release condition holds
//   failed  (exit 1)  schema/contract error, or a behavior / assertion / identity mismatch
//   blocked (exit 2)  a dependency is absent (environment, client, credential, gate result, npm audit …)
//   skipped (exit 3)  skipped / dry-run / collect / local evidence: never publishable
// Child stdout is never parsed. `releaseReady` is true only when status is `passed`.
//
//   node scripts/e2e/verify-evidence.mjs --evidence <release-evidence.json> --candidate <identity.json> \
//        [--findings docs/qa/security-findings.yaml] [--audit-json <npm-audit.json>]
//   node scripts/e2e/verify-evidence.mjs --run <run.json> --candidate <identity.json> --assemble

import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { assembleEvidence, loadResults } from "./lib/assemble.mjs";
import { askPlanIdentity, expectedAskPlan } from "./lib/ask-plan.mjs";
import { CATALOG_PATH, catalogDigest, executionKey, expectedExecutions, loadCatalog } from "./lib/catalog.mjs";
import { automatedRequiredClients, manualRequiredClients } from "./lib/clients.mjs";
import { EXIT_CODES, REPO_ROOT, fail, fileDigest, loadRun, parseArgv } from "./lib/common.mjs";
import { validateAgainstSchema } from "./lib/schema.mjs";

const EXPECTED_STEP_IDS = ["M-01", "M-02", "M-03", "M-04", "M-05"];
const MANUAL_FUTURE_GRACE_MS = 5 * 60 * 1000;
// Manual pack freshness: reuse the same release-evidence maxAgeHours (default 72). Do NOT carve a new
// 1-year window for human packs; a year-old human checklist cannot certify today's candidate.
const MANUAL_MAX_AGE_MS = 72 * 3600 * 1000;
// Allowed extension for run-relative manual evidence files. JSON is the canonical carrier but real
// GUI exports may legitimately be screenshots/text/csv; .json is not enforced. Traversal and absolute
// paths are blocked by `fileReader` itself; this regex only forbids NULs and shell metacharacters.
const SAFE_PATH_RE = /^[A-Za-z0-9_\-./]+$/;

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (path.isAbsolute(value)) return false;
  if (value.includes("..")) return false;
  if (value.includes("\0")) return false;
  return SAFE_PATH_RE.test(value);
}

/**
 * Reads the raw pack file at `expectedPath` and validates every required field directly from the parsed
 * raw JSON. This is the binding rule: the verifier does NOT trust the in-memory `evidence.manualClients`
 * entry as the source of truth for any pack field; instead it re-parses the actual file on disk and
 * validates each field against the run-time limits. A synthetic entry whose bytes don't match the raw
 * file (or whose claimed fields disagree with what is on disk) is rejected even when each object on its
 * own looks schema-valid.
 *
 * The verifier deliberately does NOT compare the on-disk `pack.artifact.sha256` to `rawSha`. A
 * self-referential hash cannot satisfy that equality: writing the file once gives a placeholder value
 * for the field, writing it twice changes the body. The real binding to "did the file change after
 * assembly" is supplied by the caller via `expectedAssemblySha`: the assembler-computed hash from the
 * in-memory `evidence.manualClients` entry, which the caller compares to `rawSha` for tamper detection.
 *
 * `expectedMemoryEntry` is the in-memory `evidence.manualClients` slot. The verifier cross-validates it
 * against the raw file on every key — if a runner fakes the assembled entry while the raw file says
 * something different (or vice versa), the disagreement is surfaced as `manual_in_memory_drift` and the
 * verdict is failed even when each side individually passes schema. This is the binding rule from
 * Codex review item 4.
 */
export function verifyManualPackRaw({ baseDir, expectedProduct, expectedPath, readFile, runId, runCreatedAtMs, now, expectedAssemblySha, expectedMemoryEntry }) {
  const out = [];
  const buffer = readFile(expectedPath);
  if (!buffer) {
    out.push({ severity: "blocked", code: "missing_pack", message: `manual required client ${expectedProduct} has no checklist pack at ${expectedPath}` });
    return out;
  }
  const rawSha = sha256Buffer(buffer);
  // Tamper detection: the assembly recorded the raw bytes' SHA at the moment it bound this entry. If the
  // file changes between assembly and verification, the recorded SHA no longer matches. We surface this
  // as `manual_artifact_hash_mismatch`; the strict `pack.artifact.sha256 === rawSha` check from the
  // earlier draft is impossible to satisfy in JSON (a self-referential hash) and was removed.
  if (typeof expectedAssemblySha === "string" && /^[0-9a-f]{64}$/.test(expectedAssemblySha) && expectedAssemblySha !== rawSha) {
    out.push({ severity: "failed", code: "manual_artifact_hash_mismatch", message: `${expectedProduct} raw file SHA ${rawSha} != assembly-recorded ${expectedAssemblySha}; the pack was modified after assembly` });
  }
  let pack;
  try {
    pack = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    out.push({ severity: "failed", code: "manual_invalid_json", message: `${expectedProduct} pack ${expectedPath} is not valid JSON: ${error.message}` });
    return out;
  }
  // Cross-validation: every identity field that the in-memory entry exposes must agree with the raw
  // file. The same code is reused whether the runner faked the in-memory side or the raw side; the
  // verdict is "the two views disagree, the pack is not consistent".
  if (expectedMemoryEntry && typeof expectedMemoryEntry === "object") {
    const mem = expectedMemoryEntry;
    const pair = (label, a, b) => {
      if (a === b) return;
      out.push({ severity: "failed", code: "manual_in_memory_drift", message: `${expectedProduct} ${label} disagrees between raw file (${JSON.stringify(a)}) and in-memory entry (${JSON.stringify(b)})` });
    };
    pair("product", pack.product, mem.product);
    pair("execution", pack.execution, mem.execution);
    pair("transport", pack.transport, mem.transport);
    pair("status", pack.status, mem.status);
    pair("operator", pack.operator, mem.operator);
    pair("completedAt", pack.completedAt, mem.completedAt);
    pair("runId", pack.runId, mem.runId);
    if (Array.isArray(pack.steps) && Array.isArray(mem.steps)) {
      if (pack.steps.length !== mem.steps.length) {
        out.push({ severity: "failed", code: "manual_in_memory_drift", message: `${expectedProduct} steps.length disagrees between raw file (${pack.steps.length}) and in-memory entry (${mem.steps.length})` });
      } else {
        for (let i = 0; i < pack.steps.length; i += 1) {
          const a = pack.steps[i] ?? {};
          const b = mem.steps[i] ?? {};
          pair(`steps[${i}].id`, a.id, b.id);
          pair(`steps[${i}].passed`, a.passed, b.passed);
          pair(`steps[${i}].evidencePath`, a.evidencePath, b.evidencePath);
          pair(`steps[${i}].evidenceSha256`, a.evidenceSha256, b.evidenceSha256);
        }
      }
    }
  }
  if (pack.product !== expectedProduct) out.push({ severity: "failed", code: "manual_wrong_product", message: `${expectedProduct} pack declares product=${pack.product}` });
  if (pack.execution !== "manual") out.push({ severity: "failed", code: "manual_wrong_execution", message: `${expectedProduct} pack declares execution=${pack.execution}, expected manual` });
  if (pack.transport !== "gui") out.push({ severity: "failed", code: "manual_wrong_transport", message: `${expectedProduct} pack declares transport=${pack.transport}, expected gui` });
  if (typeof pack.runId !== "string" || pack.runId.trim().length === 0) {
    out.push({ severity: "failed", code: "manual_empty_run", message: `${expectedProduct} pack has no runId` });
  } else if (pack.runId !== runId) {
    out.push({ severity: "failed", code: "manual_wrong_run", message: `${expectedProduct} pack runId ${pack.runId} != current run ${runId}` });
  }
  if (typeof pack.operator !== "string" || pack.operator.trim().length === 0) {
    out.push({ severity: "failed", code: "manual_empty_operator", message: `${expectedProduct} operator is empty or whitespace-only` });
  }
  // completedAt: must parse, must lie in [runCreatedAtMs, now+grace] and not older than maxAge.
  if (typeof pack.completedAt !== "string" || pack.completedAt.trim().length === 0) {
    out.push({ severity: "failed", code: "manual_invalid_timestamp", message: `${expectedProduct} completedAt is missing` });
  } else {
    const completedAt = Date.parse(pack.completedAt);
    if (!Number.isFinite(completedAt)) {
      out.push({ severity: "failed", code: "manual_invalid_timestamp", message: `${expectedProduct} completedAt ${pack.completedAt} is unparseable` });
    } else {
      if (Number.isFinite(runCreatedAtMs) && completedAt < runCreatedAtMs) {
        out.push({ severity: "failed", code: "manual_pre_run_timestamp", message: `${expectedProduct} completedAt ${pack.completedAt} is before run createdAt` });
      }
      if (completedAt > now + MANUAL_FUTURE_GRACE_MS) {
        out.push({ severity: "failed", code: "manual_future_timestamp", message: `${expectedProduct} completedAt ${pack.completedAt} is in the future (beyond ${MANUAL_FUTURE_GRACE_MS / 60000} min grace)` });
      } else if (now - completedAt > MANUAL_MAX_AGE_MS) {
        out.push({ severity: "failed", code: "manual_stale_timestamp", message: `${expectedProduct} completedAt ${pack.completedAt} is older than ${MANUAL_MAX_AGE_MS / (365 * 24 * 3600 * 1000)} y` });
      }
    }
  }
  // Steps: M-01..M-05 in order, each with id/passed/evidencePath/evidenceSha256.
  if (!Array.isArray(pack.steps)) {
    out.push({ severity: "failed", code: "manual_bad_steps", message: `${expectedProduct} steps is not an array` });
  } else if (pack.steps.length !== EXPECTED_STEP_IDS.length) {
    out.push({ severity: "failed", code: "manual_bad_steps", message: `${expectedProduct} must have exactly ${EXPECTED_STEP_IDS.length} steps, got ${pack.steps.length}` });
  } else {
    for (let i = 0; i < EXPECTED_STEP_IDS.length; i += 1) {
      const step = pack.steps[i];
      const expected = EXPECTED_STEP_IDS[i];
      if (step?.id !== expected) {
        out.push({ severity: "failed", code: "manual_bad_steps", message: `${expectedProduct} steps must be M-01..M-05 in order; got ${JSON.stringify(pack.steps.map((s) => s?.id))}` });
        break;
      }
      if (step?.passed !== true && step?.passed !== false) {
        out.push({ severity: "failed", code: "manual_bad_steps", message: `${expectedProduct} step ${expected} passed must be boolean` });
      }
      const stepPath = step?.evidencePath;
      const stepSha = step?.evidenceSha256;
      if (!isSafeRelativePath(stepPath)) {
        out.push({ severity: "failed", code: "manual_step_evidence_missing", message: `${expectedProduct} step ${expected} evidencePath is missing or unsafe` });
        continue;
      }
      if (typeof stepSha !== "string" || !/^[0-9a-f]{64}$/.test(stepSha)) {
        out.push({ severity: "failed", code: "manual_step_evidence_missing", message: `${expectedProduct} step ${expected} evidenceSha256 is missing or not 64 hex chars` });
        continue;
      }
      const buf = readFile(stepPath);
      if (!buf) {
        out.push({ severity: "failed", code: "manual_step_evidence_missing", message: `${expectedProduct} step ${expected} artifact ${stepPath} cannot be read` });
        continue;
      }
      const computed = sha256Buffer(buf);
      if (computed !== stepSha) {
        out.push({ severity: "failed", code: "manual_step_evidence_hash_mismatch", message: `${expectedProduct} step ${expected} artifact ${stepPath} hash mismatch: declared=${stepSha} computed=${computed}` });
      }
    }
  }
  // Top-level status: only raw `passed` may continue. The Codex A2 reproduction showed a raw pack with
  // top-level status:"blocked" + all five steps `passed:true` sailing through as PASS. The raw pack
  // is the operator-signed source of truth; we treat its top-level verdict as authoritative.
  //   raw "passed"     → continue, the per-step / freshness / hash rules already gate GO
  //   raw "failed"     → failed (operator marks this human run as failed; the verifier must agree)
  //   raw "blocked"/"pending" → blocked (operator marked it blocked; verifier must agree)
  //   raw anything else or missing → failed (malformed; refuse to green-light a packet the operator
  //                                  never signed off as a successful human pass)
  const stepResults = Array.isArray(pack.steps) ? pack.steps : [];
  const anyFailed = stepResults.some((s) => s?.passed === false);
  const anyUnrun = stepResults.some((s) => s?.passed !== true && s?.passed !== false);
  const stepCountOk = Array.isArray(pack.steps) && pack.steps.length === EXPECTED_STEP_IDS.length;
  if (!stepCountOk) {
    out.push({ severity: "blocked", code: "manual_unrun_steps", message: `${expectedProduct} steps count != ${EXPECTED_STEP_IDS.length}; treating as unrun` });
  } else if (anyUnrun) {
    out.push({ severity: "blocked", code: "manual_unrun_steps", message: `${expectedProduct} has an M-step that is neither passed nor failed` });
  } else if (anyFailed) {
    out.push({ severity: "failed", code: "manual_client_failed", message: `${expectedProduct} has a failed M-step` });
  }
  if (pack.status === "failed") {
    out.push({ severity: "failed", code: "manual_top_failed", message: `${expectedProduct} top-level status is "failed"` });
  } else if (pack.status === "blocked" || pack.status === "pending" || pack.status === "missing") {
    out.push({ severity: "blocked", code: "manual_top_blocked", message: `${expectedProduct} top-level status is "${pack.status}"; cannot green-light` });
  } else if (pack.status === "passed") {
    if (anyFailed) out.push({ severity: "failed", code: "manual_forged_top_passed", message: `${expectedProduct} top-level status is passed but a step is failed` });
  } else if (pack.status === undefined || pack.status === null || pack.status === "") {
    out.push({ severity: "failed", code: "manual_top_missing", message: `${expectedProduct} has no top-level status; refusing to green-light` });
  } else {
    out.push({ severity: "failed", code: "manual_top_unknown", message: `${expectedProduct} top-level status "${pack.status}" is not one of passed/failed/blocked/pending/missing` });
  }
  // Top-level artifact: deliberately NOT required. The assembly record (sha256 of the raw bytes) is
  // the binding; the raw pack itself is operator-signed and the operator does not need to embed a
  // self-referential artifact hash. A pack.artifact is permitted (kept for backward compatibility)
  // but its absence is not a failure. A present artifact must still be a well-formed path/sha pair.
  if (pack.artifact !== undefined && pack.artifact !== null) {
    if (typeof pack.artifact.path !== "string" || pack.artifact.path.length === 0) {
      out.push({ severity: "failed", code: "manual_artifact_invalid", message: `${expectedProduct} artifact.path must be a non-empty string when artifact is present` });
    } else if (pack.artifact.sha256 !== undefined && (typeof pack.artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(pack.artifact.sha256))) {
      out.push({ severity: "failed", code: "manual_artifact_invalid", message: `${expectedProduct} artifact.sha256 is not a 64-hex string` });
    }
  }
  return out;
}

const SCHEMA_PATH = path.join(REPO_ROOT, "scripts/e2e/contracts/release-evidence.schema.json");
export const PROFILE_PATH = path.join(REPO_ROOT, "scripts/e2e/profiles/customer-release.yaml");
export const CLIENTS_PATH = path.join(REPO_ROOT, "docs/qa/real-e2e-clients.yaml");
export const FINDINGS_PATH = path.join(REPO_ROOT, "docs/qa/security-findings.yaml");

/** Spec §8.3a: the findings file must carry all of these; a missing entry is a verification failure. */
export const EXPECTED_FINDING_IDS = ["V-01", "V-02", "V-03", "V-04", "V-05", "V-06", "V-07", "V-08", "D-01", "D-02", "G-01", "G-02", "G-03", "G-04", "G-05"];

/** Existing customer runtime/ELF/K8s gates that must have passed on the SAME candidate digest. */
// `k8s-acceptance` is the fresh install of the candidate digest on the isolated cluster (read-from-cluster digest);
// `k8s-upgrade` is the N-1 PVC in-place upgrade to the same digest. The static Helm gate is a separate repo-level
// workflow dependency (it cannot be bound to an image digest), so it is not listed here.
export const REQUIRED_EXISTING_GATES = ["g1-metadata-arch", "g2-elf-arch", "g3-runtime-smoke", "g4-ktx-version", "g4b-python-runtime", "g8-k8s-contract", "k8s-acceptance", "k8s-upgrade"];

const SECOND_RANK = { failed: 4, blocked: 3, skipped: 2, dry_run: 2 };

class Problems {
  constructor() {
    this.list = [];
  }

  add(severity, code, message) {
    this.list.push({ severity, code, message });
  }

  get status() {
    if (this.list.some((p) => p.severity === "failed")) return "failed";
    if (this.list.some((p) => p.severity === "blocked")) return "blocked";
    if (this.list.some((p) => p.severity === "skipped")) return "skipped";
    return "passed";
  }
}

/**
 * Deny verdict for one probe. A server error or a timeout is never an enforced deny (GATE-01-V01/V02).
 */
export function verifyDenyCase({ httpStatus, reason, timedOut = false, approvedReasons = null }) {
  if (timedOut) return { status: "failed", detail: "timed out: not an explicit deny" };
  if (!Number.isInteger(httpStatus) || httpStatus >= 500) return { status: "failed", detail: `HTTP ${httpStatus} is a server error, not an enforced deny` };
  if (httpStatus < 400) return { status: "failed", detail: `HTTP ${httpStatus} was allowed` };
  if (approvedReasons && !approvedReasons.includes(reason)) return { status: "failed", detail: `deny reason "${reason}" is not an approved reason` };
  return { status: "passed", detail: `HTTP ${httpStatus}` };
}

/**
 * A4: validate per-ask indexed evidence. The runner records one immutable record per ask with its
 * own runId/instanceId/caseId/client/run/askIndex/agentId/tokenFingerprint/since/until/traceIds/
 * queryEventIds/policyVersion/contextPolicyVersion. Each ask is checked against the per-ask ledger
 * record; the verifier rejects duplicate / missing ask indices, mismatched run/instance/case/client/
 * repeat, mismatched Token/Agent, wrong policy/context versions (vs ledger, not just literal
 * "unavailable"), any cross-ask union laundering, cross-ask record/query/trace reuse, and any
 * deviation from the frozen expected ask plan. The top-level passed assertion booleans are NEVER
 * trusted as a substitute for per-ask evidence; we look at the actual indexed records.
 */
export function validateIndexedAsks({ key, entry, ledgerAsks, runId, instanceId, expectedPlan, problems }) {
  const asks = entry.asks;
  if (!Array.isArray(asks) || asks.length === 0) {
    problems.add("failed", "indexed_asks_missing", `${key}: an agent case must carry at least one indexed ask (A4)`);
    return;
  }
  // Frozen expected plan: contiguous askIndex 0..N-1, each with the expected Agent/goldKey/
  // expectation. Removing the second SEC-14-V12 ask still produces contiguous 0..0 — so we require
  // the runner's recorded askCount to equal the frozen expected plan's length, not just contiguous
  // indices.
  if (Array.isArray(expectedPlan)) {
    if (asks.length !== expectedPlan.length) {
      problems.add("failed", "ask_count_mismatch", `${key}: recorded ${asks.length} asks but the frozen plan requires ${expectedPlan.length}; expected ask indices ${expectedPlan.map((_, i) => i).join(",")}`);
    }
    // Reject mismatched Agent/goldKey/expectation per askIndex. The runner cannot satisfy the case
    // by claiming a different plan; every askIndex must match the frozen expected identity.
    const sortedAsks = [...asks].sort((a, b) => (a.askIndex ?? -1) - (b.askIndex ?? -1));
    for (let i = 0; i < sortedAsks.length && i < expectedPlan.length; i += 1) {
      const expected = expectedPlan[i];
      const actual = sortedAsks[i];
      if (!actual) continue;
      if (actual.agentId !== expected.agentId || (actual.goldKey ?? null) !== (expected.goldKey ?? null) || (actual.expectation ?? "answer") !== (expected.expectation ?? "answer")) {
        problems.add("failed", "ask_plan_mismatch", `${key}/askIndex=${actual.askIndex}: ask identity (agent=${actual.agentId}, goldKey=${actual.goldKey}, expectation=${actual.expectation}) does not match the frozen plan (agent=${expected.agentId}, goldKey=${expected.goldKey}, expectation=${expected.expectation})`);
      }
    }
  }
  const seenAskIndices = new Set();
  for (const ask of asks) {
    const idx = ask.askIndex;
    if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
      problems.add("failed", "ask_index_invalid", `${key}: ask has non-integer/non-negative askIndex (${idx})`);
      continue;
    }
    if (seenAskIndices.has(idx)) {
      problems.add("failed", "ask_duplicate_index", `${key}: duplicate askIndex ${idx}`);
    }
    seenAskIndices.add(idx);
    // Identity binding: runId/instanceId/caseId/client/run must be PRESENT and agree with the
    // entry under verification. Missing IDs are no longer accepted — a runner that omits them is
    // laundering the per-ask identity.
    if (typeof ask.runId !== "string" || ask.runId.length === 0) {
      problems.add("failed", "ask_run_missing", `${key}/${idx}: ask runId is missing`);
    } else if (runId && ask.runId !== runId) {
      problems.add("failed", "ask_run_mismatch", `${key}/${idx}: ask runId ${ask.runId} != current run ${runId}`);
    }
    if (typeof ask.instanceId !== "string" || ask.instanceId.length === 0) {
      problems.add("failed", "ask_instance_missing", `${key}/${idx}: ask instanceId is missing`);
    } else if (instanceId && ask.instanceId !== instanceId) {
      problems.add("failed", "ask_instance_mismatch", `${key}/${idx}: ask instanceId ${ask.instanceId} != current instance ${instanceId}`);
    }
    if (ask.caseId !== entry.id) {
      problems.add("failed", "ask_case_mismatch", `${key}/${idx}: ask caseId ${ask.caseId} != entry id ${entry.id}`);
    }
    if (ask.client !== entry.client) {
      problems.add("failed", "ask_client_mismatch", `${key}/${idx}: ask client ${ask.client} != entry client ${entry.client}`);
    }
    if (ask.run !== entry.run) {
      problems.add("failed", "ask_repeat_mismatch", `${key}/${idx}: ask run ${ask.run} != entry run ${entry.run}`);
    }
    if (typeof ask.agentId !== "string" || ask.agentId.trim().length === 0) {
      problems.add("failed", "ask_agent_missing", `${key}/${idx}: ask has no agentId`);
    }
    if (typeof ask.tokenFingerprint !== "string" || !/^[0-9a-f]{12}$/.test(ask.tokenFingerprint)) {
      problems.add("failed", "ask_fingerprint_invalid", `${key}/${idx}: tokenFingerprint ${ask.tokenFingerprint} is not a 12-hex string`);
    }
    // Time window: since must parse, until must parse, since <= until.
    const since = Date.parse(ask.since);
    const until = Date.parse(ask.until);
    if (!Number.isFinite(since) || !Number.isFinite(until)) {
      problems.add("failed", "ask_time_invalid", `${key}/${idx}: ask since/until is unparseable (${ask.since}/${ask.until})`);
    } else if (since > until) {
      problems.add("failed", "ask_time_inverted", `${key}/${idx}: ask since ${ask.since} is after until ${ask.until}`);
    }
    // Per-ask ledger binding: traceIds / queryEventIds / fingerprint / agentId / policyVersion /
    // contextPolicyVersion must match what the instance ledger actually recorded for THIS askIndex.
    // Cross-ask union laundering (passing by stuffing another ask's traces into this one) is rejected
    // by indexing. The ledger's runId/instanceId are also required.
    const ledger = ledgerAsks.get(`${key}:${idx}`);
    if (!ledger) {
      problems.add("failed", "ask_not_in_ledger", `${key}/${idx}: no per-ask ledger record for this askIndex`);
    } else {
      if (typeof ledger.runId === "string" && ledger.runId.length > 0) {
        if (typeof ask.runId !== "string" || ask.runId !== ledger.runId) {
          problems.add("failed", "ask_run_not_in_ledger", `${key}/${idx}: ask runId ${ask.runId} does not match the per-ask ledger runId ${ledger.runId}`);
        }
      } else {
        problems.add("failed", "ask_ledger_run_missing", `${key}/${idx}: per-ask ledger record has no runId`);
      }
      if (typeof ledger.instanceId === "string" && ledger.instanceId.length > 0) {
        if (typeof ask.instanceId !== "string" || ask.instanceId !== ledger.instanceId) {
          problems.add("failed", "ask_instance_not_in_ledger", `${key}/${idx}: ask instanceId ${ask.instanceId} does not match the per-ask ledger instanceId ${ledger.instanceId}`);
        }
      } else {
        problems.add("failed", "ask_ledger_instance_missing", `${key}/${idx}: per-ask ledger record has no instanceId`);
      }
      for (const trace of (ask.traceIds ?? [])) {
        if (!ledger.traces.has(trace)) problems.add("failed", "ask_trace_not_in_ledger", `${key}/${idx}: trace ${trace} is not in the per-ask ledger record`);
      }
      for (const qe of (ask.queryEventIds ?? [])) {
        if (!ledger.queryEventIds.has(qe)) problems.add("failed", "ask_query_not_in_ledger", `${key}/${idx}: query event ${qe} is not in the per-ask ledger record`);
      }
      if (ledger.fingerprint && ask.tokenFingerprint !== ledger.fingerprint) {
        problems.add("failed", "ask_fingerprint_mismatch", `${key}/${idx}: ask tokenFingerprint ${ask.tokenFingerprint} != ledger ${ledger.fingerprint}`);
      }
      if (ledger.agentId && ask.agentId && ledger.agentId !== ask.agentId) {
        problems.add("failed", "ask_agent_mismatch", `${key}/${idx}: ask agentId ${ask.agentId} != ledger ${ledger.agentId}`);
      }
      // Policy/context version: must be present AND must equal the ledger's value. An arbitrary
      // non-"unavailable" string that disagrees with the ledger is a measurement lie.
      if (typeof ask.policyVersion !== "string" || ask.policyVersion.length === 0) {
        problems.add("failed", "ask_version_missing", `${key}/${idx}: ask policyVersion is missing`);
      } else if (typeof ledger.policyVersion === "string" && ledger.policyVersion.length > 0 && ask.policyVersion !== ledger.policyVersion) {
        problems.add("failed", "ask_policy_mismatch", `${key}/${idx}: ask policyVersion ${ask.policyVersion} != ledger ${ledger.policyVersion}`);
      }
      if (typeof ask.contextPolicyVersion !== "string" || ask.contextPolicyVersion.length === 0) {
        problems.add("failed", "ask_version_missing", `${key}/${idx}: ask contextPolicyVersion is missing`);
      } else if (typeof ledger.contextPolicyVersion === "string" && ledger.contextPolicyVersion.length > 0 && ask.contextPolicyVersion !== ledger.contextPolicyVersion) {
        problems.add("failed", "ask_context_policy_mismatch", `${key}/${idx}: ask contextPolicyVersion ${ask.contextPolicyVersion} != ledger ${ledger.contextPolicyVersion}`);
      }
    }
    // Result / gold digests are required and must be 64-hex. The verifier does not re-derive them
    // here; it checks the recorded digests are well-formed and that they agree with the actual
    // answer text + gold the runner saw. A bogus / all-zero digest is rejected.
    if (typeof ask.resultDigest !== "string" || !/^[0-9a-f]{64}$/.test(ask.resultDigest) || ask.resultDigest === "0".repeat(64)) {
      problems.add("failed", "ask_result_digest_missing", `${key}/${idx}: ask resultDigest is missing, not 64-hex, or all-zero`);
    }
    if (typeof ask.goldDigest !== "string" || !/^[0-9a-f]{64}$/.test(ask.goldDigest) || ask.goldDigest === "0".repeat(64)) {
      problems.add("failed", "ask_gold_digest_missing", `${key}/${idx}: ask goldDigest is missing, not 64-hex, or all-zero`);
    }
  }
  // Cross-ask union laundering: the entry's top-level serverTraceIds must equal the EXACT union of
  // per-ask traceIds (no missing, no extras), and entry.tokenFingerprints must equal the EXACT set
  // of per-ask fingerprints. A runner that records the union but lies about per-ask coverage is
  // caught here; a runner that records the union correctly but a runner that drops an ask's traces
  // from the union is also caught.
  const askTraceUnion = [...new Set(asks.flatMap((a) => a.traceIds ?? []))];
  const askFingerprints = [...new Set(asks.map((a) => a.tokenFingerprint).filter(Boolean))];
  const topTraces = entry.serverTraceIds ?? [];
  const topFingerprints = entry.tokenFingerprints ?? [];
  for (const trace of topTraces) {
    if (!askTraceUnion.includes(trace)) problems.add("failed", "ask_trace_laundered", `${key}: top-level serverTraceIds contains ${trace} not in any per-ask record`);
  }
  for (const trace of askTraceUnion) {
    if (!topTraces.includes(trace)) problems.add("failed", "ask_trace_missing_from_union", `${key}: per-ask record includes trace ${trace} that is missing from the top-level serverTraceIds union`);
  }
  for (const fp of topFingerprints) {
    if (!askFingerprints.includes(fp)) problems.add("failed", "ask_fingerprint_laundered", `${key}: top-level tokenFingerprints contains ${fp} not in any per-ask record`);
  }
  for (const fp of askFingerprints) {
    if (!topFingerprints.includes(fp)) problems.add("failed", "ask_fingerprint_missing_from_union", `${key}: per-ask record includes fingerprint ${fp} that is missing from the top-level tokenFingerprints union`);
  }
  // Top-level queryEventIds must equal the union of per-ask queryEventIds. The runner cannot
  // claim a query event that no per-ask record saw; nor can it omit a query event that an ask saw.
  const askQueryUnion = [...new Set(asks.flatMap((a) => a.queryEventIds ?? []))];
  const topQueries = entry.queryEventIds ?? [];
  for (const qe of topQueries) {
    if (!askQueryUnion.includes(qe)) problems.add("failed", "ask_query_laundered", `${key}: top-level queryEventIds contains ${qe} not in any per-ask record`);
  }
  for (const qe of askQueryUnion) {
    if (!topQueries.includes(qe)) problems.add("failed", "ask_query_missing_from_union", `${key}: per-ask record includes query event ${qe} that is missing from the top-level queryEventIds union`);
  }
  // Trace reuse: no trace id may appear in more than one ask's traceIds within the same case run.
  const traceCount = new Map();
  for (const ask of asks) {
    for (const trace of (ask.traceIds ?? [])) {
      traceCount.set(trace, (traceCount.get(trace) ?? 0) + 1);
    }
  }
  for (const [trace, count] of traceCount) if (count > 1) problems.add("failed", "ask_trace_reuse", `${key}: trace ${trace} appears in ${count} per-ask records; cross-ask record reuse is forbidden`);
  // Query event reuse: same rule for queryEventIds.
  const qeCount = new Map();
  for (const ask of asks) {
    for (const qe of (ask.queryEventIds ?? [])) {
      qeCount.set(qe, (qeCount.get(qe) ?? 0) + 1);
    }
  }
  for (const [qe, count] of qeCount) if (count > 1) problems.add("failed", "ask_query_reuse", `${key}: query event ${qe} appears in ${count} per-ask records; cross-ask query reuse is forbidden`);
  // Fingerprint reuse: same rule for tokenFingerprint within the same case run. Distinct Agents/
  // Tokens per ask (SEC-14-V12) are legitimate; a reused fingerprint for two asks of the same case
  // run is a binding problem unless the asks explicitly share an Agent (none in the current plan).
  const fpCount = new Map();
  for (const ask of asks) {
    if (typeof ask.tokenFingerprint === "string") fpCount.set(ask.tokenFingerprint, (fpCount.get(ask.tokenFingerprint) ?? 0) + 1);
  }
  for (const [fp, count] of fpCount) {
    if (count > 1) {
      const expectedFpReuse = Array.isArray(expectedPlan) && expectedPlan.length > 1 && expectedPlan.slice(1).every((_, i) => i === 0 || expectedPlan[i].agentId === expectedPlan[0].agentId);
      if (!expectedFpReuse) problems.add("failed", "ask_fingerprint_reuse", `${key}: tokenFingerprint ${fp} appears in ${count} per-ask records; cross-ask Token reuse is forbidden unless the frozen plan mandates a shared Agent`);
    }
  }
}

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function highCriticalPackages(audit) {
  const vulns = audit?.vulnerabilities ?? {};
  return Object.entries(vulns)
    .filter(([, v]) => v.severity === "high" || v.severity === "critical")
    .map(([name, v]) => ({ name, severity: v.severity }));
}

function checkFindings({ findings, evidence, problems, passedIds, scenarioPassed, audit }) {
  const byId = new Map((findings?.findings ?? []).map((f) => [f.id, f]));
  for (const id of EXPECTED_FINDING_IDS) {
    if (!byId.has(id)) problems.add("failed", "finding_missing", `security-findings.yaml has no entry for ${id}`);
  }
  for (const f of findings?.findings ?? []) {
    const unresolvedRule = f.severity === "P0" || f.severity === "P1";
    if (unresolvedRule && f.status === "accepted_risk") problems.add("failed", "p0_p1_accepted_risk", `${f.id} is ${f.severity}; accepted_risk is not allowed`);
    else if (unresolvedRule && f.status !== "fixed") problems.add("failed", "p0_p1_unresolved", `${f.id} (${f.severity}) is ${f.status}`);
    if (f.status === "fixed") {
      if (!f.fixedIn) problems.add("failed", "finding_fixedIn_missing", `${f.id} is fixed but has no fixedIn`);
      if (!Array.isArray(f.verifiedBy) || f.verifiedBy.length === 0) problems.add("failed", "finding_verifiedBy_missing", `${f.id} is fixed but has no verifiedBy`);
      for (const id of f.verifiedBy ?? []) {
        if (!passedIds.has(id) && !scenarioPassed.has(id)) problems.add("failed", "finding_not_verified", `${f.id} cites ${id}, which is not passed in this release evidence`);
      }
    }
    if (f.severity === "P2" && f.status === "accepted_risk" && !f.acceptedBy) problems.add("failed", "p2_accepted_without_owner", `${f.id} accepted_risk needs acceptedBy`);
  }
  checkDependencies({ findings, audit, problems });
}

/** npm audit (high/critical) vs the dependency register in security-findings.yaml (Spec §8.3a). */
export function checkDependencies({ findings, audit, problems }) {
  if (!audit) {
    problems.add("blocked", "npm_audit_missing", "no `npm audit --omit=dev --json` result was provided to cross-check the dependency register");
    return;
  }
  const dependencies = new Map((findings?.dependencies ?? []).map((d) => [d.package, d]));
  for (const { name, severity } of highCriticalPackages(audit)) {
    const entry = dependencies.get(name);
    if (!entry) problems.add("failed", "dependency_unregistered", `${name} (${severity}) is reported by npm audit but absent from security-findings.yaml`);
    else if (entry.status === "fixed") problems.add("failed", "dependency_fixed_but_audit_reports", `${name} is registered as fixed but npm audit still reports ${severity}`);
    else if (entry.status === "not_reachable" && !String(entry.rationale ?? "").trim()) problems.add("failed", "dependency_not_reachable_without_rationale", `${name} not_reachable needs a reviewable rationale`);
    else if (entry.status === "open") problems.add("failed", "dependency_open", `${name} (${severity}) is still open`);
  }
  for (const d of findings?.dependencies ?? []) {
    if ((d.severity === "high" || d.severity === "critical") && d.status === "open") problems.add("failed", "dependency_open", `${d.package} (${d.severity}) is open`);
  }
}

/** Standalone cross-check used by the gate collector for SEC-23-V02. */
export function crossCheckDependencies({ findings, audit }) {
  const problems = new Problems();
  checkDependencies({ findings, audit, problems });
  return { status: problems.status, problems: problems.list };
}

/**
 * Pure release decision. Everything external (files, clock) is injected so every rule is unit-tested.
 * @param {object} p
 * @param {object} p.evidence parsed lucy-real-user-e2e-v1 document
 * @param {object} p.candidate deployed candidate identity (what the pipeline built and tested)
 * @param {Array}  p.cases frozen catalog (expanded)
 * @param {string} p.catalogDigest digest of the frozen catalog
 * @param {string} p.profileDigest digest of the frozen profile
 * @param {object} p.clientsDoc docs/qa/real-e2e-clients.yaml
 * @param {object} p.findings parsed security-findings.yaml
 * @param {object|null} p.audit parsed `npm audit --json` output
 * @param {(rel: string) => Buffer|null} p.readFile resolves an artifact path relative to the evidence directory
 * @param {number} [p.now]
 * @param {number} [p.maxAgeHours]
 */
export function verifyRelease({ evidence, candidate, cases, catalogDigest: frozenCatalog, profileDigest, clientsDoc, findings, audit, readFile, now = Date.now(), maxAgeHours = 72, schema, runId = null, instanceId = null, runCreatedAtMs = NaN }) {
  const problems = new Problems();
  const schemaProblems = schema ? validateAgainstSchema(schema, evidence) : [];
  if (schemaProblems.length > 0) {
    schemaProblems.slice(0, 20).forEach((p) => problems.add("failed", "schema", p));
    return finish(problems, evidence);
  }

  if (evidence.executionMode !== "release") {
    problems.add("skipped", "not_release_execution", `executionMode "${evidence.executionMode}" can never be published`);
  }
  if (evidence.stub !== false) problems.add("failed", "stub", "stub must be false");

  // run / instance identity (Spec §8.1: mixed inputs across runner files must be rejected)
  if (runId && evidence.runId && evidence.runId !== runId) problems.add("failed", "run_id_mismatch", `evidence runId ${evidence.runId} does not match the run under verification ${runId}`);
  if (instanceId && evidence.environment.instanceId && evidence.environment.instanceId !== instanceId) problems.add("failed", "instance_id_mismatch", `evidence instanceId ${evidence.environment.instanceId} does not match the run under verification ${instanceId}`);
  if (!evidence.environment.finishedAt) problems.add("blocked", "missing_finished_at", "evidence.environment.finishedAt is not recorded; assembly must preserve the run's last finish time");

  // identity: candidate == deployed == every piece of evidence
  for (const key of ["gitSha", "treeDigest", "imageDigest", "platform", "ktxVersion", "chartVersion"]) {
    if (evidence.candidate[key] !== candidate[key]) problems.add("failed", "candidate_mismatch", `evidence candidate.${key} differs from the candidate under verification`);
  }
  if (evidence.environment.deployedImageDigest !== candidate.imageDigest) problems.add("failed", "deployed_digest_mismatch", "the deployed image digest is not the candidate digest");
  if (evidence.candidate.platform !== "linux/amd64") problems.add("failed", "platform", `customer platform must be linux/amd64 (got ${evidence.candidate.platform})`);
  if (evidence.environment.topology !== "single-replica-k8s") problems.add("failed", "topology", `topology must be single-replica-k8s (got ${evidence.environment.topology})`);

  // frozen inputs
  if (evidence.environment.caseCatalogDigest !== frozenCatalog) problems.add("failed", "catalog_digest", "caseCatalogDigest does not match the frozen catalog");
  if (evidence.environment.profileDigest !== profileDigest) problems.add("failed", "profile_digest", "profileDigest does not match the frozen profile");

  // freshness
  const finished = Date.parse(evidence.environment.finishedAt);
  if (!Number.isFinite(finished) || now - finished > maxAgeHours * 3_600_000 || finished > now + 300_000) {
    problems.add("failed", "stale_evidence", `evidence finished at ${evidence.environment.finishedAt} is outside the ${maxAgeHours} h freshness window`);
  }

  // provenance
  if (evidence.provenance.trusted !== true) problems.add("failed", "untrusted_provenance", "evidence was not produced by a trusted CI runner");
  if (evidence.provenance.ciSha && evidence.provenance.ciSha !== candidate.gitSha) problems.add("failed", "provenance_sha", "CI sha differs from the candidate git sha");

  // denominator — automated required clients only (manual GUI packs are checked separately)
  const requiredClients = automatedRequiredClients(clientsDoc.clients).map((c) => c.product);
  const expected = expectedExecutions(cases, requiredClients);
  if (expected.length === 0) problems.add("failed", "empty_denominator", "the required denominator is empty");
  const keys = evidence.cases.map(executionKey);
  const seen = new Set();
  for (const key of keys) {
    if (seen.has(key)) problems.add("failed", "duplicate_case", `duplicate execution ${key}`);
    seen.add(key);
  }
  const expectedSet = new Set(expected);
  for (const key of expected) if (!seen.has(key)) problems.add("failed", "omitted_case", `required execution ${key} is absent from the evidence`);
  for (const key of seen) if (!expectedSet.has(key)) problems.add("failed", "unexpected_case", `execution ${key} is not in the frozen catalog`);
  for (const product of requiredClients) {
    const client = evidence.clients.find((c) => c.product === product);
    if (!client) problems.add("failed", "missing_client", `required client ${product} is absent from the evidence`);
    else if (client.required !== true) problems.add("failed", "client_not_required", `${product} is registered as required but evidence marks it optional`);
  }
  // Scheme A: WorkBuddy / Cursor Agent GUI remain required for GO but are human-executed. The pack is
  // validated by reading the raw JSON file once and checking every claim against the actual on-disk
  // bytes — no field is laundered through `evidence.manualClients` without re-validation against raw.
  // Exactly one entry per expected filename is permitted; duplicates are rejected before per-field
  // checks so a runner cannot satisfy both workbuddy and cursor with a single file.
  for (const client of manualRequiredClients(clientsDoc.clients)) {
    const expectedPath = `results/manual/${client.product}.json`;
    const matches = (evidence.manualClients ?? []).filter((c) => c?.artifact?.path === expectedPath);
    if (matches.length === 0) {
      problems.add("blocked", "missing_pack", `manual required client ${client.product} has no checklist pack at ${expectedPath}`);
      continue;
    }
    if (matches.length > 1) {
      problems.add("failed", "manual_duplicate_pack", `manual required client ${client.product} has ${matches.length} entries claiming ${expectedPath}; exactly one entry per filename is allowed`);
      continue;
    }
    // The in-memory entry was built by the assembler from this same file. We pass the recorded SHA
    // through to verifyManualPackRaw, which uses it for tamper detection (raw vs assembly hash) —
    // the only binding that's actually possible in JSON, since a self-referential hash is impossible.
    // We also pass the in-memory entry itself so the verifier can cross-validate every identity
    // field against the raw file (Codex review item 4: an on-disk failed step and an in-memory
    // passed step must fail even when each object individually matches schema).
    const memEntry = matches[0];
    const expectedAssemblySha = memEntry.artifact?.sha256;
    for (const problem of verifyManualPackRaw({ baseDir: null, expectedProduct: client.product, expectedPath, readFile, runId, runCreatedAtMs, now, expectedAssemblySha, expectedMemoryEntry: memEntry })) {
      problems.add(problem.severity, problem.code, problem.message);
    }
  }
  const summary = evidence.summary;
  const actual = { passed: 0, failed: 0, blocked: 0, skipped: 0, dryRun: 0 };
  for (const c of evidence.cases) actual[c.status === "dry_run" ? "dryRun" : c.status] += 1;
  for (const key of ["passed", "failed", "blocked", "skipped", "dryRun"]) {
    if (summary[key] !== actual[key]) problems.add("failed", "summary_tampered", `summary.${key}=${summary[key]} but the cases contain ${actual[key]}`);
  }
  if (summary.required !== expected.length) problems.add("failed", "summary_tampered", `summary.required=${summary.required} but the frozen denominator is ${expected.length}`);

  // statuses of required executions
  const byKey = new Map(evidence.cases.map((c) => [executionKey(c), c]));
  const catalogById = new Map(cases.map((c) => [c.id, c]));
  for (const key of expected) {
    const entry = byKey.get(key);
    if (!entry) continue;
    if (entry.status === "failed") problems.add("failed", "case_failed", `${key} failed`);
    else if (entry.status === "blocked") problems.add("blocked", "case_blocked", `${key} is blocked`);
    else if (entry.status === "skipped" || entry.status === "dry_run") problems.add("skipped", "case_not_executed", `${key} is ${entry.status}`);
  }

  // per-case content checks
  let serverEvidence = null;
  if (evidence.serverEvidence.source !== "instance-ledger") {
    problems.add("failed", "trace_source_untrusted", `server evidence source "${evidence.serverEvidence.source}" is not the instance ledger`);
  } else {
    const buffer = readFile(evidence.serverEvidence.path);
    if (!buffer) problems.add("failed", "server_evidence_missing", `${evidence.serverEvidence.path} cannot be read`);
    else if (sha256Buffer(buffer) !== evidence.serverEvidence.sha256) problems.add("failed", "server_evidence_hash", "server evidence file hash mismatch");
    else {
      try {
        serverEvidence = JSON.parse(buffer.toString("utf8"));
      } catch {
        problems.add("failed", "server_evidence_unreadable", "server evidence is not valid JSON");
      }
      if (serverEvidence && serverEvidence.source !== "instance-ledger") problems.add("failed", "trace_source_untrusted", "server evidence file does not declare the instance ledger as its source");
    }
  }
  const ledgerTraces = new Map();
  // Per-ask indexed ledger: cases with multiple asks (SEC-14-V12: sales denied then finance
  // allowed) carry one record per askIndex. The legacy (non-indexed) record is preserved at
  // `<key>` for backwards compatibility with the old `tokenFingerprint` check, but the
  // indexed records are the binding source of truth.
  const ledgerAsks = new Map();
  const seenAskLedgerKeys = new Set();
  const ledgerDuplicates = new Set();
  for (const sc of serverEvidence?.cases ?? []) {
    if (sc.client) {
      const k = `${sc.caseId}@${sc.client}#${sc.run}`;
      if (seenAskLedgerKeys.has(k) && typeof sc.askIndex !== "number") {
        // Case-level (non-indexed) ledger record arrived more than once for the same key. The
        // legacy non-indexed slot is meant to be a single record; subsequent arrivals are a
        // measurement lie.
        ledgerDuplicates.add(k);
      }
      seenAskLedgerKeys.add(k);
      // Merge: combine the legacy case-level record's traces with all per-ask traces so the
      // legacy `trace_not_in_server_evidence` check accepts traces that live in any per-ask
      // record. The per-ask indexed map keeps each ask's exact binding for A4 validation.
      const existing = ledgerTraces.get(k);
      const newTraces = new Set([...(existing?.traces ?? []), ...(sc.traceIds ?? [])]);
      const newFingerprints = new Set([...(existing?.fingerprints ?? []), sc.tokenFingerprint].filter(Boolean));
      ledgerTraces.set(k, { traces: newTraces, fingerprints: newFingerprints, fingerprint: sc.tokenFingerprint, policyVersion: sc.policyVersion, contextPolicyVersion: sc.contextPolicyVersion, runId: sc.runId, instanceId: sc.instanceId });
      if (typeof sc.askIndex === "number") {
        const askKey = `${k}:${sc.askIndex}`;
        if (ledgerAsks.has(askKey)) ledgerDuplicates.add(askKey);
        ledgerAsks.set(askKey, { traces: new Set(sc.traceIds ?? []), queryEventIds: new Set(sc.queryEventIds ?? []), fingerprint: sc.tokenFingerprint, agentId: sc.agentId, policyVersion: sc.policyVersion, contextPolicyVersion: sc.contextPolicyVersion, resultDigest: sc.resultDigest, goldDigest: sc.goldDigest, runId: sc.runId, instanceId: sc.instanceId });
      }
    } else {
      ledgerTraces.set(sc.caseId, { traces: new Set(sc.traceIds ?? []), fingerprint: sc.tokenFingerprint, runId: sc.runId, instanceId: sc.instanceId });
    }
  }
  if (ledgerDuplicates.size > 0) {
    for (const dup of ledgerDuplicates) problems.add("failed", "ledger_duplicate_record", `server-evidence ledger has multiple records for ${dup}; duplicates are silently overwriting each other and must be surfaced`);
  }
  for (const key of expected) {
    const entry = byKey.get(key);
    if (!entry || entry.status !== "passed") continue;
    const spec = catalogById.get(entry.id);
    for (const artifact of entry.artifacts) {
      const buffer = readFile(artifact.path);
      if (!buffer) problems.add("failed", "artifact_missing", `${key}: artifact ${artifact.path} cannot be read`);
      else if (sha256Buffer(buffer) !== artifact.sha256) problems.add("failed", "artifact_hash_mismatch", `${key}: artifact ${artifact.path} was modified after collection`);
    }
    if (entry.artifacts.length === 0) problems.add("failed", "artifact_missing", `${key}: a passed case must carry artifacts`);
    const evaluated = new Map(entry.assertions.map((a) => [a.token, a.passed]));
    for (const token of spec.assert) {
      if (!evaluated.has(token)) problems.add("failed", "assertion_missing", `${key}: assertion "${token}" was never evaluated`);
      else if (evaluated.get(token) !== true) problems.add("failed", "assertion_failed", `${key}: assertion "${token}" did not hold`);
    }
    if (entry.leakage && entry.leakage.hits > 0) problems.add("failed", "leakage", `${key}: ${entry.leakage.hits} leakage hit(s)`);
    if (entry.upstreamExecutions !== undefined && entry.upstreamExecutions !== 0 && spec.assert.includes("upstream_exec_zero")) problems.add("failed", "unauthorized_upstream", `${key}: ${entry.upstreamExecutions} unauthorized upstream execution(s)`);
    // A4: per-ask indexed evidence is REQUIRED for every passed agent execution. The previous
    // "missing asks falls back to legacy collapsed Map" path was a delete-asks bypass: the
    // runner could drop the `asks` array, the verifier would still accept the legacy
    // serverTraceIds, and any cross-ask laundering in the parent union would sail through. The
    // expected plan comes from the shared registry; the recorded asks must equal the frozen
    // expected plan, not a runner-fabricated subset.
    if (entry.runner === "agent") {
      const expectedPlan = expectedAskPlan(spec);
      validateIndexedAsks({ key, entry, ledgerAsks, runId, instanceId, expectedPlan, problems });
    }
    const dataCase = spec.assert.includes("real_query") || spec.assert.includes("server_trace");
    if (dataCase) {
      if (entry.queryEventIds.length === 0 && spec.assert.includes("real_query")) problems.add("failed", "missing_query", `${key}: no real query event: a correct-looking answer without a query does not count`);
      if (entry.serverTraceIds.length === 0) problems.add("failed", "missing_server_trace", `${key}: no server trace id`);
      const ledger = ledgerTraces.get(key);
      if (entry.serverTraceIds.length > 0) {
        if (!ledger) problems.add("failed", "trace_not_in_server_evidence", `${key}: the server evidence has no record for this execution`);
        else {
          for (const trace of entry.serverTraceIds) if (!ledger.traces.has(trace)) problems.add("failed", "trace_not_in_server_evidence", `${key}: trace ${trace} is not in the instance ledger`);
        }
        // A4: the legacy tokenFingerprint comparison was unreliable for multi-ask cases (each ask
        // has its own fingerprint, but the legacy ledger has only one). Per-ask binding is now the
        // source of truth and runs unconditionally above; do not also compare the singular
        // tokenFingerprint, which is undefined for multi-ask entries.
      }
      if (entry.policyVersion === "unavailable" || entry.contextPolicyVersion === "unavailable") problems.add("failed", "version_missing", `${key}: policy/context version not recorded`);
    }
  }

  // release-wide gates
  const counter = (value, code, label) => {
    if (value < 0) problems.add("blocked", `${code}_unknown`, `${label} was not measured`);
    else if (value > 0) problems.add("failed", code, `${value} ${label}`);
  };
  counter(evidence.gates.contextMigrationPending, "context_migration_pending", "context ACL migration item(s) pending");
  counter(evidence.gates.projectionBacklog, "projection_backlog", "projection backlog item(s)");
  for (const name of REQUIRED_EXISTING_GATES) {
    const gate = evidence.gates.existing.find((g) => g.name === name);
    if (!gate) problems.add("blocked", "gate_missing", `existing gate ${name} has no result`);
    else {
      if (gate.imageDigest !== candidate.imageDigest) problems.add("failed", "gate_digest_mismatch", `gate ${name} ran on another image digest`);
      if (gate.status === "failed") problems.add("failed", "gate_failed", `gate ${name} failed`);
      else if (gate.status === "blocked") problems.add("blocked", "gate_blocked", `gate ${name} is blocked`);
      else if (gate.status !== "passed") problems.add("skipped", "gate_not_passed", `gate ${name} is ${gate.status}`);
    }
  }

  // findings register vs verified evidence and npm audit
  const passedIds = new Set(evidence.cases.filter((c) => c.status === "passed").map((c) => c.id));
  const scenarioPassed = new Set();
  const scenarioIds = new Set(cases.map((c) => c.scenario));
  for (const scenario of scenarioIds) {
    const variants = cases.filter((c) => c.scenario === scenario && c.required);
    if (variants.every((v) => expected.filter((k) => k === v.id || k.startsWith(`${v.id}@`)).every((k) => byKey.get(k)?.status === "passed"))) scenarioPassed.add(scenario);
  }
  checkFindings({ findings, evidence, problems, passedIds, scenarioPassed, audit });

  return finish(problems, evidence);
}

function finish(problems, evidence) {
  const status = problems.status;
  return {
    contract: "lucy-release-verdict-v1",
    status,
    exitCode: EXIT_CODES[status],
    releaseReady: status === "passed" && evidence?.executionMode === "release",
    problems: problems.list.sort((a, b) => (SECOND_RANK[b.severity] ?? 0) - (SECOND_RANK[a.severity] ?? 0)),
    runId: evidence?.runId ?? null
  };
}

export function loadVerifyInputs({ catalogPath = CATALOG_PATH, profilePath = PROFILE_PATH, clientsPath = CLIENTS_PATH, findingsPath = FINDINGS_PATH } = {}) {
  const { cases } = loadCatalog(catalogPath);
  return {
    cases,
    catalogDigest: catalogDigest(cases),
    profileDigest: fileDigest(profilePath),
    clientsDoc: parse(readFileSync(clientsPath, "utf8")),
    findings: parse(readFileSync(findingsPath, "utf8")),
    schema: JSON.parse(readFileSync(SCHEMA_PATH, "utf8")),
    maxAgeHours: parse(readFileSync(profilePath, "utf8")).evidence?.maxAgeHours ?? 72
  };
}

export function fileReaderFor(baseDir) {
  // Resolve baseDir to its canonical real path. This is the boundary every read must stay inside:
  // a symlink in `rel` that escapes the archive root is blocked, not followed. We also pre-compute
  // the canonical form once so the per-call check is a realpath comparison, not a lexical one.
  const canonicalBase = realpathSync(baseDir);
  return (rel) => {
    if (typeof rel !== "string" || rel.length === 0) return null;
    if (path.isAbsolute(rel) || rel.includes("\0")) return null;
    const lexical = path.resolve(baseDir, rel);
    // Reject anything that lexically escapes the base BEFORE touching the filesystem. A relative
    // path that contains `..` is unsafe even if the resulting realpath is the same.
    if (path.relative(baseDir, lexical).startsWith("..") || path.isAbsolute(path.relative(baseDir, lexical))) return null;
    let lst;
    try { lst = lstatSync(lexical); } catch { return null; }
    if (lst.isSymbolicLink()) return null;
    if (!lst.isFile()) return null;
    // Reject anything that resolves to outside the canonical base via a realpath check. This is the
    // last line of defense: the file is on disk, it is regular, but it could be hard-linked or
    // mount-bound to a sibling directory; we still refuse to follow.
    let canonical;
    try { canonical = realpathSync(lexical); } catch { return null; }
    const relCanonical = path.relative(canonicalBase, canonical);
    if (relCanonical === "" || relCanonical.startsWith("..") || path.isAbsolute(relCanonical)) return null;
    return readFileSync(canonical);
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    const args = parseArgv(process.argv.slice(2), { evidence: "value", run: "value", candidate: "value", findings: "value", "audit-json": "value", assemble: "boolean", out: "value" });
    if (!args.candidate) fail("verify-evidence: --candidate <identity.json> is required", 1);
    const candidate = JSON.parse(readFileSync(args.candidate, "utf8"));
    const inputs = loadVerifyInputs(args.findings ? { findingsPath: path.resolve(args.findings) } : {});
    // Hoist the run context so the assembly branch and the explicit-evidence branch both supply
    // the same runId/instanceId/runCreatedAtMs to verifyRelease. The previous implementation
    // declared `run` INSIDE the if (args.assemble) block, then referenced `run.createdAt`,
    // `run.runId`, `run.instanceId` AFTER both branches — any `--evidence` invocation threw
    // ReferenceError before the verifier ever ran.
    let run = null;
    let evidence;
    let baseDir;
    if (args.assemble) {
      if (!args.run) fail("verify-evidence: --assemble needs --run <run.json>", 1);
      run = loadRun(args.run);
      const { evidence: assembled, missing } = assembleEvidence({ run, results: loadResults(run), candidate, profileDigest: inputs.profileDigest, cases: inputs.cases, expectedCount: expectedExecutions(inputs.cases, automatedRequiredClients(inputs.clientsDoc.clients).map((c) => c.product)).length, clientsDoc: inputs.clientsDoc });
      evidence = assembled;
      baseDir = run.paths.runDir;
      if (missing.length > 0) process.stderr.write(`verify-evidence: absent dependencies: ${missing.join(", ")}\n`);
      writeFileSync(path.join(baseDir, "release-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    } else {
      if (!args.evidence) fail("verify-evidence: --evidence <file> or --run <run.json> --assemble is required", 1);
      evidence = JSON.parse(readFileSync(args.evidence, "utf8"));
      baseDir = path.dirname(path.resolve(args.evidence));
    }
    // When the caller did not provide a sibling run.json (the --evidence path), we cannot invent a
    // run context. The verifier treats null runId/instanceId as "no source binding"; the run/instance
    // identity fields of the evidence document are still cross-checked against its own values.
    const runId = run?.runId ?? null;
    const instanceId = run?.instanceId ?? null;
    const runCreatedAtMs = run?.createdAt && Number.isFinite(Date.parse(run.createdAt)) ? Date.parse(run.createdAt) : NaN;
    const audit = args["audit-json"] ? JSON.parse(readFileSync(args["audit-json"], "utf8")) : null;
    const verdict = verifyRelease({ evidence, candidate, ...inputs, audit, readFile: fileReaderFor(baseDir), runId, instanceId, runCreatedAtMs });
    if (args.out) writeFileSync(args.out, `${JSON.stringify(verdict, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(verdict)}\n`);
    process.exit(verdict.exitCode);
  } catch (error) {
    fail(`verify-evidence: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
}
