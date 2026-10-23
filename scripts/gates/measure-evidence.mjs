// B3 measured evidence producers (Spec §6.5, §8.1, §8.3, R8, R10).
//
// The gate collector (scripts/gates/collect-gate-results.mjs) reads three artifacts:
//   - results/ops.json                 per-OPS-01 case evidence bound to the candidate digest
//   - results/context-migration.json   {pending, source, measuredAt, ...}
//   - results/projection.json          {backlog, cursor, latestSeq, source, measuredAt, ...}
//
// Each of these MUST be a real, measured producer — never a hand-rolled {pending:0} placeholder.
// The collectors downstream treat absent or malformed files as BLOCKED, so an honest "I do not
// have the data" must be visible to the verifier.
//
// Missing values that cannot be measured are recorded as `null` (not 0); the gate collector then
// treats the case as BLOCKED, not passed. `0` only appears when a real measurement returned 0.
//
// Inputs:
//   --run <run.json>     the run manifest (carries projectDir, instanceId, etc.)
//   --out <dir>          the run's results directory (where the artifact is written)
//   --namespace <ns>     (ops only) the K8s namespace holding the candidate
//   --release <name>     (ops only) the Helm release name
//
// Outputs (under <out>):
//   ops.json                 {contract, imageDigest, cases: [{id, status, detail, assertions}], measuredAt}
//   context-migration.json   {contract, runId, instanceId, pending, scanned, source, measuredAt, ...}
//   projection.json          {contract, runId, instanceId, backlog, cursor, latestSeq, source, measuredAt, ...}
//
// No default values for unknown measurements. No zero-fallback. A measurement that the producer
// cannot perform is reported as `null` and the case is BLOCKED downstream.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { loadRun, parseArgv, fail, sha256File } from "../e2e/lib/common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// --- Defaults shared by all producers --------------------------------------------------------------

/**
 * Default read adapter that opens a real SQLite file via better-sqlite3 (already a webui
 * dependency). Each call is wrapped in a short-lived handle and read-only pragma so a
 * misconfigured file cannot mutate the producer's evidence. `sqlQuery` returns the rows in
 * the same shape every other SQLite adapter does:
 *   - `{ rows: [{ column: value, ... }, ...] }` on success
 *   - `{ error: "..." }` on any I/O / SQL failure
 *
 * This adapter MUST be used in production; tests inject their own reader against a real
 * temporary SQLite file with the actual security / audit schema, never an arbitrary SQL
 * stub accepting any string (that hides the schema mismatch this module is fixing).
 */
export function defaultSqliteQuery(dbPath, sql, params) {
  let handle = null;
  try {
    handle = new Database(dbPath, { readonly: true, fileMustExist: true });
    const stmt = handle.prepare(sql);
    const rows = stmt.all(...(params ?? []));
    return { rows };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (handle) {
      try { handle.close(); } catch { /* best effort */ }
    }
  }
}

// --- B3 measured producers ------------------------------------------------------------------------

/**
 * Counts the `pending` entries across every context-ACL migration journal under
 * `<projectDir>/.ktx-ui/context-acl-migration/`. The journal is the durable per-operation log
 * written by `applyContextAclMigration` (webui/server/security/context-migration.ts): when an
 * object is not yet applied the entry's `state` stays "pending".
 *
 * Returns `{pending, scanned, source}` where `pending` is the total count of pending entries
 * (across all journals), `scanned` is the number of journal files read, and `source` is the
 * absolute directory used. A missing directory yields `pending: null` (the measurement cannot
 * be performed, so the gate collector will BLOCK).
 */
export function measureContextMigrationPending({ projectDir, journalDir, readJournalFile = readFileSync, listJournalFiles = defaultListJournals }) {
  const dir = journalDir ?? path.join(projectDir, ".ktx-ui", "context-acl-migration");
  if (!existsSync(dir)) return { pending: null, scanned: 0, source: dir, reason: "journal directory not found" };
  const files = listJournalFiles(dir);
  let pending = 0;
  let scanned = 0;
  for (const file of files) {
    try {
      const raw = readJournalFile(file, "utf8");
      const journal = JSON.parse(raw);
      scanned += 1;
      for (const entry of journal.entries ?? []) {
        if (entry?.state === "pending") pending += 1;
      }
    } catch (error) {
      // A corrupt journal file is an observation problem, not a count. Surface it as a problem
      // list so the caller can record it; the count remains 0 for this file.
      return { pending: null, scanned, source: dir, problem: `corrupt journal ${file}: ${error?.message ?? String(error)}` };
    }
  }
  return { pending, scanned, source: dir };
}

/**
 * Reads the real security + audit stores and computes the projection backlog (events whose
 * seq is greater than the last-projected seq). The projector cursor is the
 * `security_projection_cursor` table in the **target audit database** (the rebuildable
 * projection), NOT in `security.sqlite` (see webui/server/security/projector.ts). The
 * `latestSeq` is the durable ledger in `security.sqlite`'s `security_events` table. Backlog
 * is `max(0, latestSeq - cursor)`; a missing or non-numeric value is reported as `null`
 * (the producer cannot be measured, so the gate collector BLOCKS).
 *
 * `sqlQuery` is injected so the unit tests can pass a real-temporary-SQLite reader; the
 * production default (`defaultSqliteQuery`) opens the file via better-sqlite3 in read-only
 * mode. A missing file, missing table, or query error yields `backlog: null` with a
 * structured `problem` field; the producer never silently substitutes 0.
 *
 * @param {Object} args
 * @param {string} [args.securityDbPath] override path for security.sqlite (default: `<projectDir>/.ktx-ui/security.sqlite`)
 * @param {string} [args.auditDbPath]    override path for audit.sqlite    (default: `<projectDir>/.ktx-ui/audit.sqlite`)
 * @param {string} [args.projectDir]     used to compute the default paths
 * @param {Function} args.sqlQuery       required; production uses `defaultSqliteQuery`
 * @param {string} [args.projectorName]  defaults to `audit.operations`; see projector.ts AUDIT_PROJECTOR_NAME
 */
export function measureProjectionBacklog({ projectDir, securityDbPath, auditDbPath, sqlQuery, projectorName = "audit.operations" }) {
  if (typeof sqlQuery !== "function") {
    throw new Error("measureProjectionBacklog requires a sqlQuery function (production: defaultSqliteQuery; tests: pass a real-temp-SQLite reader)");
  }
  const secPath = securityDbPath ?? path.join(projectDir ?? "", ".ktx-ui", "security.sqlite");
  const audPath = auditDbPath ?? path.join(projectDir ?? "", ".ktx-ui", "audit.sqlite");
  if (!existsSync(secPath)) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, reason: "security store not found" };
  if (!existsSync(audPath)) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, reason: "audit store not found" };
  const cursor = sqlQuery(audPath, "SELECT last_seq FROM security_projection_cursor WHERE projector = ?", [projectorName]);
  if (cursor?.error) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, problem: cursor.error, projector: projectorName };
  const latest = sqlQuery(secPath, "SELECT MAX(seq) AS latest FROM security_events", []);
  if (latest?.error) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, problem: latest.error, projector: projectorName };
  const cursorRow = cursor.rows?.[0];
  const latestRow = latest.rows?.[0];
  // Validate strictly: missing / null / fractional / non-integer / negative are all refused.
  // The cursor lives in audit.sqlite; the latest seq lives in security.sqlite. We do NOT
  // accept `Number(null) === 0` (a fabricated healthy zero), do NOT accept decimals from a
  // corrupt row, and do NOT Math.max(0, ...) a negative backlog — that would mask a
  // cursor-ahead-of-latest condition. A measured zero is a real `rawLatest === rawCursor`
  // case; everything else is `null` and BLOCKS the gate.
  const validateSeq = (raw, label) => {
    if (raw === null || raw === undefined) return { ok: false, reason: `${label} is missing` };
    if (typeof raw !== "number") return { ok: false, reason: `${label} is not a number (got ${typeof raw})` };
    if (!Number.isInteger(raw)) return { ok: false, reason: `${label} is not an integer (got ${raw})` };
    if (raw < 0) return { ok: false, reason: `${label} is negative (got ${raw})` };
    return { ok: true };
  };
  const rawCursor = cursorRow?.last_seq;
  const rawLatest = latestRow?.latest;
  const c = validateSeq(rawCursor, "cursor");
  if (!c.ok) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, problem: c.reason, projector: projectorName };
  const l = validateSeq(rawLatest, "latest seq");
  if (!l.ok) return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, problem: l.reason, projector: projectorName };
  if (rawCursor > rawLatest) {
    return { backlog: null, cursor: null, latestSeq: null, sources: { security: secPath, audit: audPath }, problem: `cursor (${rawCursor}) is ahead of latest (${rawLatest}); the audit store is corrupted or the cursor was reset without a re-projection`, projector: projectorName };
  }
  return { backlog: rawLatest - rawCursor, cursor: rawCursor, latestSeq: rawLatest, sources: { security: secPath, audit: audPath }, projector: projectorName };
}

/**
 * Runs the per-OPS-01 case checks against a live K8s target (Spec §9). Each case verifies a
 * measured property of the actual running cluster for the candidate image digest:
 *   V01: a fresh install of the same digest passes k8s-acceptance.
 *   V02: an N-1 PVC upgrade (in-place) keeps acceptance green.
 *   V03: after the upgrade the revoked-token table still reflects the pre-upgrade state.
 *   V04: after the upgrade the role and ACL state are unchanged.
 *   V05: after the upgrade the security audit rows survive.
 *   V06: post-upgrade, every admin must re-login (cookie integrity).
 *   V07: a backup restore that pre-dates a revoke does NOT resurrect the revoked session.
 *
 * The producer takes a `kubectlRunner` (defaults to `spawnSync` against the system `kubectl`)
 * AND a `runId`/`instanceId` so the produced evidence can be bound back to the run manifest.
 * The runner is REAL: it actually invokes the K8s CLI; the function never returns "passed"
 * from `exit 0` alone — every call must report the measured outcome through the injected
 * runner or be marked as unimplemented (NOT as "live K8s required") when the harness has
 * not yet wired that path.
 *
 * The OPS-01 case checks live outside this producer's own surface: V01 calls the
 * `runK8sAcceptance` helper through the injected runner; V02..V07 each have their own
 * `runOpsXxxCase` helper that the unit tests inject synthetic outcomes through. Production
 * falls back to the unimplemented verdict for V02..V07 because the per-variant live
 * measurement paths are owned by D7 (their implementations land centrally, not here).
 */
export function measureOpsCases({ run, candidate, namespace, release, kubectlRunner = defaultKubectlRunner, runOpsXxxCase, runId, instanceId }) {
  const cases = [];
  const ensure = (id, status, detail, assertions = []) => cases.push({ id, runner: "gate", status, detail, assertions, ...(runId ? { runId } : {}), ...(instanceId ? { instanceId } : {}) });

  // V01: fresh install of the same digest passes acceptance. We drive `k8s-acceptance.sh`
  // through the INJECTED runner (not the global `spawnSync`); the script writes the
  // measured `deployment.json` and we read the actual measured image digest from it. The
  // call requires `--logical-instance-id` whenever `--deployment-evidence` is used; the
  // producer supplies it from the run manifest. Passing an empty/undefined instance id is a
  // refuse-with-problem, not a silent passed.
  const logicalInstanceId = run?.instanceId;
  const v01 = runK8sAcceptance({
    runner: kubectlRunner, namespace, release, candidateDigest: candidate?.imageDigest, logicalInstanceId,
    detail: "fresh install acceptance on the same candidate digest"
  });
  ensure("OPS-01-V01", v01.status, v01.detail, v01.assertions ?? []);

  // V02..V07: each case is a per-variant, per-kind observed invariant. The actual
  // measurement paths (PVC upgrade, revoked-token table, role/ACL survival, audit survival,
  // admin re-login, backup-restore revoke) live in D7 and are not implemented here. The
  // producer reports them as `unimplemented` rather than `blocked` so downstream collectors
  // distinguish "no cluster observed" (truly missing measurement) from "the harness code is
  // missing" (a code gap). Tests inject `runOpsXxxCase` to feed measured verdicts; without
  // the injection the verdict is "unimplemented" (NEVER passed from exit code alone).
  for (const id of ["OPS-01-V02", "OPS-01-V03", "OPS-01-V04", "OPS-01-V05", "OPS-01-V06", "OPS-01-V07"]) {
    if (typeof runOpsXxxCase === "function") {
      const verdict = runOpsXxxCase({ id, run, candidate, namespace, release });
      ensure(id, verdict.status, verdict.detail, verdict.assertions ?? []);
      continue;
    }
    ensure(id, "unimplemented", `case ${id}: per-variant measurement path not wired in measure-evidence (D7 owns the live K8s implementation; absent code is "unimplemented", not "passed")`);
  }
  return cases;
}

// --- Default adapters (production; tests inject their own) ---------------------------------------

function defaultListJournals(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function defaultKubectlRunner(args, options = {}) {
  return spawnSync("kubectl", args, { encoding: "utf8", ...options });
}

/**
 * Drives `k8s-acceptance.sh` through the injected `runner`. The runner is responsible for
 * actually executing the script (default: `bash <path> [args]`). Every flag the script now
 * requires for `--deployment-evidence` is forwarded: `--logical-instance-id` is mandatory,
 * `--expect-image-digest` is forwarded when provided. `--skip-helm` is permitted; we do
 * not block on it because the protected K8s runner may not have `helm` installed. The
 * helper returns the measured verdict:
 *   - `passed` only when the runner exits 0 AND a deployment.json with the expected digest
 *     was actually produced;
 *   - `refused` when the runner reports a controlled refusal (cluster missing, namespace
 *     missing, digest mismatch, etc.);
 *   - `unimplemented` only when the deployment evidence cannot be observed (which would
 *     otherwise be misread as a cluster failure).
 *
 * The function does NOT default `status: "passed"` from a clean exit code alone: every
 * "passed" verdict is bound to the deployment evidence the script wrote.
 */
function runK8sAcceptance({ runner, namespace, release, candidateDigest, logicalInstanceId, detail }) {
  if (!namespace || !release) {
    return { status: "blocked", detail: `${detail}: --namespace and --release are required to observe the cluster`, assertions: [{ token: "namespace_release", passed: false, detail: "namespace/release not provided" }] };
  }
  if (!logicalInstanceId) {
    return { status: "blocked", detail: `${detail}: logicalInstanceId (run.instanceId) is required whenever --deployment-evidence is used; refusing to run without an identity binding`, assertions: [{ token: "logical_instance_id", passed: false, detail: "logicalInstanceId missing" }] };
  }
  // Forward the supported flags. --skip-helm is intentionally omitted: skipping helm status
  // is the supported path for environments without helm, but the production producer must
  // declare that decision (callers can pass {skipHelm: true} through the runner if they want
  // the gate helper to be told to skip helm).
  const args = [
    path.join(HERE, "k8s-acceptance.sh"),
    "--namespace", namespace,
    "--release", release,
    "--skip-mcp", "--skip-ktx", "--skip-secrets-check",
    "--expect-image-digest", candidateDigest ?? "",
    "--logical-instance-id", logicalInstanceId,
    "--deployment-evidence", "/dev/null"
  ];
  const result = runner("bash", args, { encoding: "utf8" });
  if (result.error) {
    return { status: "blocked", detail: `${detail}: k8s-acceptance runner errored (${result.error.message ?? result.error})`, assertions: [] };
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").slice(0, 200);
    return { status: "blocked", detail: `${detail}: k8s-acceptance refused (exit ${result.status}); ${stderr}`, assertions: [] };
  }
  // Exit 0 alone is insufficient: the script MUST have written deployment.json. Without an
  // observed deployment evidence the verdict is "blocked" (not "passed"), because the gate
  // collector downstream depends on the deployment digest to bind the run's image.
  return { status: "blocked", detail: `${detail}: k8s-acceptance exited 0 but no deployment evidence was captured (the gate helper must read /run-dir/results/deployment.json, not --deployment-evidence /dev/null)`, assertions: [] };
}

// --- File writers (idempotent; only writes when measurement succeeded) ----------------------------

export function writeContextMigrationArtifact({ outDir, run, measurement }) {
  const file = path.join(outDir, "context-migration.json");
  mkdirSync(outDir, { recursive: true });
  const body = {
    contract: "lucy-context-migration-v1",
    runId: run.runId,
    instanceId: run.instanceId,
    measuredAt: new Date().toISOString(),
    source: measurement.source,
    scanned: measurement.scanned,
    pending: measurement.pending,
    ...(measurement.problem ? { problem: measurement.problem } : {}),
    ...(measurement.reason ? { reason: measurement.reason } : {})
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { file, body, sha256: sha256File(file) };
}

export function writeProjectionArtifact({ outDir, run, measurement }) {
  const file = path.join(outDir, "projection.json");
  mkdirSync(outDir, { recursive: true });
  const body = {
    contract: "lucy-projection-v1",
    runId: run.runId,
    instanceId: run.instanceId,
    measuredAt: new Date().toISOString(),
    source: measurement.source,
    backlog: measurement.backlog,
    cursor: measurement.cursor,
    latestSeq: measurement.latestSeq,
    ...(measurement.projector ? { projector: measurement.projector } : {}),
    ...(measurement.problem ? { problem: measurement.problem } : {}),
    ...(measurement.reason ? { reason: measurement.reason } : {})
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { file, body, sha256: sha256File(file) };
}

export function writeOpsArtifact({ outDir, run, candidate, cases }) {
  const file = path.join(outDir, "ops.json");
  mkdirSync(outDir, { recursive: true });
  const body = {
    contract: "lucy-ops-v1",
    runId: run.runId,
    imageDigest: candidate?.imageDigest ?? null,
    measuredAt: new Date().toISOString(),
    cases
  };
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  return { file, body, sha256: sha256File(file) };
}

// --- CLI entry -----------------------------------------------------------------------------------

function main() {
  const args = parseArgv(process.argv.slice(2), {
    run: "value", out: "value", namespace: "value", release: "value", "target": "value", "what": "value"
  });
  if (!args.run) fail("measure-evidence: --run <run.json> is required", 1);
  const run = loadRun(args.run);
  const outDir = args.out ?? path.join(run.paths.runDir, "results");
  const what = args.what ?? "all";
  const candidate = run.candidate;
  const results = [];
  if (what === "all" || what === "context-migration") {
    // Production: read the journal directly from the local project tree. External target
    // measurement (kubectl exec into the pod PVC) is wired through the `targetProvider`
    // option in `measureContextMigrationPendingViaTarget`; the workflow wires that path,
    // this CLI keeps the local reading for backwards compatibility.
    const m = measureContextMigrationPending({ projectDir: run.paths.project });
    const w = writeContextMigrationArtifact({ outDir, run, measurement: m });
    results.push({ artifact: "context-migration", file: w.file, body: w.body });
  }
  if (what === "all" || what === "projection") {
    // Production: open BOTH stores with better-sqlite3 (the cursor lives in audit.sqlite,
    // the ledger in security.sqlite). defaultSqliteQuery is read-only and closes the
    // handle on each call.
    const m = measureProjectionBacklog({ projectDir: run.paths.project, sqlQuery: defaultSqliteQuery });
    const w = writeProjectionArtifact({ outDir, run, measurement: m });
    results.push({ artifact: "projection", file: w.file, body: w.body });
  }
  if (what === "all" || what === "ops") {
    const cases = measureOpsCases({
      run, candidate, namespace: args.namespace, release: args.release,
      runId: run.runId, instanceId: run.instanceId
    });
    const w = writeOpsArtifact({ outDir, run, candidate, cases });
    results.push({ artifact: "ops", file: w.file, body: w.body });
  }
  process.stdout.write(`${JSON.stringify({ written: results.map((r) => r.artifact), files: results.map((r) => r.file) })}\n`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try { main(); } catch (error) { fail(`measure-evidence: ${error instanceof Error ? error.message : String(error)}`, 1); }
}
