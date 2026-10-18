// B3 safe fault + reset control for disposable harness targets (Spec §6.2, §8.3).
//
// The lifecycle manifest (`lib/lifecycle.mjs`) declares every phase's recovery as
// `{ kind: "harness", command, requires }`. This module is the executor: it turns a
// recovery command into a real action against a known-disposable, labeled target.
//
// Hard rules (NEVER violated):
//   - The control plane is the harness, NOT the product. There is no `product`-typed
//     control, no environment back-door, no `LUCY_E2E_FAULT_RESET=1` toggle.
//   - Local actions (kill / restart / chmod / file-replace) only touch children the
//     current Lucy process spawned, or files inside `<runDir>/`.
//   - External actions (kubectl exec / kubectl rollout / network policy changes) only
//     target a namespace + release the run registered with, and only when the registered
//     namespace/release are present in `run.k8s`. A mismatched or unspecified namespace
//     is refused; a production-shaped namespace (`prod`, `default`, `kube-system`) is
//     always refused.
//   - Every fault has an allowlist of allowed operations: `restart`, `clock`, `storage`,
//     `network`. Any other operation is refused.
//   - Every recovery carries an undo: `withFault(...)` returns a rollback function the
//     caller MUST run in a `finally` clause. The rollback is bound to the same identity
//     envelope as the fault.
//   - Missing supported control (no kubectl on PATH, no registered namespace) yields
//     `{ ok: false, problems: [...] }` — never a silent fallback to "nothing happened".

import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ALLOWED_FAULTS = new Set(["restart", "clock", "storage", "network"]);
const REFUSED_NAMESPACES = new Set(["default", "kube-system", "kube-public", "prod", "production"]);
const MAX_BACKLOG_BYTES = 256 * 1024;

/**
 * Classified fault-control failure. Carries every per-aspect verdict so the orchestrator
 * can distinguish "not implemented here" (missing supported control) from "the cluster
 * refused" (cluster said no).
 */
export class FaultControlError extends Error {
  constructor({ stage, problems, aspects, classification }) {
    super(`fault control ${stage}: ${problems.join("; ")}`);
    this.name = "FaultControlError";
    this.stage = stage;
    this.problems = problems;
    this.aspects = aspects ?? {};
    this.classification = classification ?? "refused";
  }
}

/**
 * The contract for a registered fault: `{kind, command, label, requires}`. The
 * `requires` field enumerates the K8s side-effects the command will trigger; a missing
 * supported control (e.g. `k8s-pvc-recreate` not available because there is no
 * `kubectl`) yields `unimplemented`, not a silent pass.
 */
export function validateRecovery(recovery) {
  const problems = [];
  if (!recovery) problems.push("recovery is missing");
  else {
    if (recovery.kind !== "harness") problems.push(`recovery kind must be "harness", got "${recovery.kind}"`);
    if (typeof recovery.command !== "string") problems.push("recovery.command must be a string");
    if (!Array.isArray(recovery.requires)) problems.push("recovery.requires must be an array");
    for (const req of recovery.requires ?? []) {
      if (!ALLOWED_FAULTS.has(req)) problems.push(`recovery.requires contains unsupported control "${req}"`);
    }
    if (recovery.requires?.includes("network") && typeof recovery.networkProfile !== "string") {
      problems.push("network fault requires recovery.networkProfile (the registered network-policy name)");
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Refuses to act on a namespace the run did not register, or on a production-shaped
 * namespace. Returns the safe list of namespaces the control is allowed to touch.
 */
export function resolveAllowedNamespaces(run) {
  const problems = [];
  const requested = run?.k8s?.namespace ?? null;
  if (!requested) {
    problems.push("run.k8s.namespace is not registered (the runner did not declare which namespace to control); refusing to act on a default / unspecified target");
    return { allowed: [], problems };
  }
  if (REFUSED_NAMESPACES.has(requested)) {
    problems.push(`run.k8s.namespace is "${requested}" which is a system / production-shaped namespace; refusing to act`);
    return { allowed: [], problems };
  }
  // The run may optionally pin a single release too; if not present we cannot address a
  // workload safely.
  if (!run.k8s?.release) problems.push("run.k8s.release is not registered; refusing to act without a pinned release");
  return { allowed: [requested], problems };
}

/**
 * Local-only fault: chmod a file inside `<runDir>/` to a specified mode, then chmod back.
 * Returns an undo function. The caller MUST call the undo function (use `withFault`).
 */
export function localChmodFault({ run, file, mode, undoMode }) {
  if (!run?.paths?.runDir) throw new FaultControlError({ stage: "local_chmod", problems: ["run.paths.runDir is missing"] });
  const full = path.isAbsolute(file) ? file : path.join(run.paths.runDir, file);
  if (!existsSync(full)) throw new FaultControlError({ stage: "local_chmod", problems: [`fault target does not exist: ${full}`] });
  if (!isInside(run.paths.runDir, full)) {
    throw new FaultControlError({ stage: "local_chmod", problems: [`fault target is outside the run directory: ${full}`] });
  }
  const original = (lstatSync(full).mode & 0o777);
  chmodSync(full, mode);
  return {
    kind: "storage",
    rollback: () => { try { chmodSync(full, original); } catch { /* best effort */ } }
  };
}

/**
 * Local-only fault: replace a file with a synthetic body, restore the original on undo.
 * The file must live under `<runDir>/` and the new body must be ≤ MAX_BACKLOG_BYTES.
 */
export function localReplaceFileFault({ run, file, body }) {
  if (!run?.paths?.runDir) throw new FaultControlError({ stage: "local_replace", problems: ["run.paths.runDir is missing"] });
  const full = path.isAbsolute(file) ? file : path.join(run.paths.runDir, file);
  if (!isInside(run.paths.runDir, full)) throw new FaultControlError({ stage: "local_replace", problems: [`fault target is outside the run directory: ${full}`] });
  if (Buffer.byteLength(body, "utf8") > MAX_BACKLOG_BYTES) {
    throw new FaultControlError({ stage: "local_replace", problems: [`fault body too large: ${Buffer.byteLength(body, "utf8")} > ${MAX_BACKLOG_BYTES}`] });
  }
  const original = existsSync(full) ? readFileSync(full) : null;
  writeFileSync(full, body);
  return {
    kind: "storage",
    rollback: () => {
      try {
        if (original === null) rmSync(full, { force: true });
        else writeFileSync(full, original);
      } catch { /* best effort */ }
    }
  };
}

/**
 * Wraps a fault in try/finally so the rollback always runs. The function returns the
 * value of `action` or rethrows the action's error after the rollback runs.
 */
export async function withFault(fault, action) {
  let result;
  try {
    result = await action();
  } finally {
    if (fault?.rollback) {
      try { fault.rollback(); } catch { /* best effort */ }
    }
  }
  return result;
}

/**
 * Executes a registered recovery command. The command string is run through the
 * INJECTED `executor` so unit tests can use a synthetic command runner that records the
 * call (and never actually mutates anything). Production uses `defaultExecutor`, which
 * spawns `bash -c "<command>"`. The command MUST be a single, registered, harness-only
 * string from the lifecycle manifest; it is interpolated against the run's identity
 * (`RELEASE`, `NAMESPACE`) so it can call `kubectl rollout restart deploy/${RELEASE} -n
 * ${NAMESPACE}` etc.
 *
 * The executor MUST also be supplied for production, because we want every fault command
 * to go through one chokepoint that records the call.
 */
export function executeRecovery({ run, recovery, executor = defaultExecutor, now = () => new Date().toISOString() }) {
  const problems = [];
  const validated = validateRecovery(recovery);
  if (!validated.ok) {
    return { ok: false, problems: validated.problems, classification: "refused" };
  }
  const allowed = resolveAllowedNamespaces(run);
  if (allowed.problems.length > 0) return { ok: false, problems: allowed.problems, classification: "refused" };
  const namespace = allowed.allowed[0];
  const release = run.k8s?.release;
  // Interpolate ${RELEASE} and ${NAMESPACE} into the command — anything else stays literal.
  const command = recovery.command.replace(/\$\{NAMESPACE\}/g, namespace).replace(/\$\{RELEASE\}/g, release);
  const id = randomUUID();
  const record = { id, command, requires: recovery.requires, namespace, release, runId: run.runId, instanceId: run.instanceId, startedAt: now() };
  const result = executor({ ...record });
  const finishedAt = now();
  if (result?.error) {
    return { ok: false, problems: [`executor errored: ${result.error.message ?? String(result.error)}`], classification: "unimplemented", record: { ...record, finishedAt, status: null, signal: null } };
  }
  if (result.status !== 0) {
    return { ok: false, problems: [`recovery command exited ${result.status}: ${command}`], classification: "refused", record: { ...record, finishedAt, status: result.status, signal: result.signal } };
  }
  return { ok: true, problems: [], classification: "ok", record: { ...record, finishedAt, status: 0, signal: result.signal } };
}

/**
 * Default executor: spawns `bash -c <command>` with the harness environment. Captures
 * stdout/stderr; never echoes secrets. Records the call shape so the verifier can audit
 * which commands ran.
 */
export function defaultExecutor({ command, id, runId, instanceId }) {
  const child = spawnSync("bash", ["-c", command], { encoding: "utf8", env: { ...process.env } });
  return {
    status: child.status,
    signal: child.signal,
    error: child.error,
    stdout: child.stdout ?? "",
    stderr: child.stderr ?? "",
    audit: { id, runId, instanceId, command }
  };
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
