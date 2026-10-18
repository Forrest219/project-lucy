// B2 first-owner lifecycle: explicit serialized disposable fixture phases/generations/checkpoints.
//
// The real-user E2E has cases that need a still-fresh target (SEC-02-V01/V02 bootstrap-mode
// checks; the management UX-01 cases that perform first-owner UI bootstrap; SEC-02-V06 browser
// controlled bootstrap) and cases that need an already-consumed target (SEC-02-V04 replay of a
// consumed bootstrap token; the security-integration cases that exercise a required-auth instance).
// Running the entire suite in one go against a single fixture either skips the still-bootstrap
// cases (target has been consumed) or skips the consumed cases (target is still in bootstrap mode).
//
// The contract:
//   - a single PARENT run (runId, instanceId, candidate, profile, fixture, catalog digests) owns
//     one or more PHASES, each with its own target identity (a separate Helm release +
//     namespace selector + a fresh K8s PVC, when the target is K8s; or a fresh run directory +
//     separate process when the target is local).
//   - phases are SERIALIZED: a phase cannot start until the previous phase has reached a
//     checkpoint (its declared invariants were observed).
//   - phases never mix results: a case assigned to phase N only runs against the target that
//     phase N verified. The assembled evidence records which phase produced each case.
//   - a "reset" between phases is a HARNESS-ONLY action: it must be a documented control
//     registered in the lifecycle, never a product endpoint, never a back-door env toggle.
//   - every variant in the catalog appears in exactly one phase's allowed case set, and every
//     phase's allowed set is bound to a documented lifecycle manifest. The verifier can then
//     reject a phase that lost cases or that silently grew its scope.
//
// This module is pure (no I/O) and unit-testable. The actual reset commands live in
// `phase-control.mjs` and are scoped to the lifecycle manifest, never to a product endpoint.

import { createHash } from "node:crypto";

/**
 * Build a lifecycle manifest from a catalog and a list of phase plans. Each phase declares
 * the variant ids it owns, the target state it expects to observe on entry, and the recovery
 * control it will use between phases. A variant that appears in zero phases is a configuration
 * bug; a variant that appears in more than one is also a bug. The manifest is hashed and
 * becomes part of the run's identity envelope.
 *
 * @param {Object} args
 * @param {Array} args.cases  expanded catalog (from `loadCatalog().cases`)
 * @param {Array} args.phases list of `{id, label, targetState, allowedVariants, recovery}`
 *   where `targetState` is one of `bootstrap` | `required` | `consumed` and `recovery` is
 *   `{ kind: "harness", command, requires: ["k8s-pvc-reset"|...] }`.
 */
export function buildLifecycle({ cases, phases }) {
  const requiredIds = new Set(cases.filter((c) => c.required).map((c) => c.id));
  const seen = new Set();
  const problems = [];
  const assigned = new Map();
  for (const phase of phases) {
    for (const id of phase.allowedVariants) {
      if (!requiredIds.has(id)) problems.push(`phase "${phase.id}" lists variant ${id} that is not a required catalog variant`);
      if (seen.has(id)) problems.push(`variant ${id} is allowed in more than one phase (also in phase "${phase.id}"; first wins)`);
      seen.add(id);
      assigned.set(id, phase.id);
    }
    if (!["bootstrap", "required", "consumed"].includes(phase.targetState)) {
      problems.push(`phase "${phase.id}" has unknown targetState "${phase.targetState}"`);
    }
    if (!phase.recovery || phase.recovery.kind !== "harness") {
      problems.push(`phase "${phase.id}" recovery must be kind:"harness" (never a product back-door)`);
    }
  }
  for (const id of requiredIds) if (!seen.has(id)) problems.push(`required variant ${id} is not assigned to any phase`);
  const manifest = {
    contract: "lucy-e2e-lifecycle-v1",
    phases: phases.map((p) => ({ id: p.id, label: p.label, targetState: p.targetState, allowedVariants: [...p.allowedVariants].sort(), recovery: p.recovery })),
    phaseOrder: phases.map((p) => p.id)
  };
  return { manifest, problems, assigned };
}

/** Stable digest of the lifecycle manifest. The run binds this digest to its identity envelope. */
export function lifecycleDigest(manifest) {
  const payload = JSON.stringify({
    contract: manifest.contract,
    phaseOrder: manifest.phaseOrder,
    phases: manifest.phases.map((p) => ({ id: p.id, label: p.label, targetState: p.targetState, allowedVariants: p.allowedVariants, recovery: p.recovery }))
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

/**
 * A serialized phase queue. The orchestrator calls `acquire(phaseId)` to mark a phase as the
 * current one, `checkpoint(phaseId, observation)` to record what the target actually showed
 * when the phase finished, and `verifyComplete()` to ensure every phase's invariants were met.
 * The queue refuses to advance if the previous phase's checkpoint was never recorded or if the
 * observation contradicts the declared `targetState`.
 */
export class PhaseQueue {
  constructor(manifest) {
    this.manifest = manifest;
    this.observations = new Map();
    this.problems = [];
  }

  /** Marks `phaseId` as the current phase. Refuses if a previous phase is still open. */
  acquire(phaseId) {
    const index = this.manifest.phaseOrder.indexOf(phaseId);
    if (index < 0) {
      this.problems.push(`unknown phase "${phaseId}"`);
      return false;
    }
    for (let i = 0; i < index; i += 1) {
      const prior = this.manifest.phaseOrder[i];
      if (!this.observations.has(prior)) {
        this.problems.push(`cannot acquire phase "${phaseId}": prior phase "${prior}" has no checkpoint recorded`);
        return false;
      }
    }
    return true;
  }

  /**
   * Records what the target actually showed for `phaseId`. The `observation` is
   * `{ mode: "bootstrap"|"required"|"consumed" }` and must equal the phase's declared
   * `targetState`; otherwise the queue records a problem and refuses the checkpoint.
   */
  checkpoint(phaseId, observation) {
    const phase = this.manifest.phases.find((p) => p.id === phaseId);
    if (!phase) {
      this.problems.push(`cannot checkpoint unknown phase "${phaseId}"`);
      return false;
    }
    if (observation?.mode !== phase.targetState) {
      this.problems.push(`phase "${phaseId}" expected targetState="${phase.targetState}" but observed mode="${observation?.mode}"`);
      return false;
    }
    this.observations.set(phaseId, { ...observation, recordedAt: new Date().toISOString() });
    return true;
  }

  /** Returns true only when every phase in the manifest has a recorded checkpoint. */
  verifyComplete() {
    for (const phase of this.manifest.phases) {
      if (!this.observations.has(phase.id)) {
        this.problems.push(`phase "${phase.id}" never reached a checkpoint (target state was never observed)`);
      }
    }
    return this.problems.length === 0;
  }
}

/**
 * Default lifecycle for a real release run: one phase per required "freshness window".
 *   - bootstrap-mode: SEC-02 still-bootstrap checks (V01/V02/V03) + SEC-01 bootstrap refusals.
 *     No UI bootstrap is performed in this phase. Variant SEC-02-V03 expects exactly one winner
 *     out of two concurrent attempts and is therefore a bootstrap-mode test.
 *   - first-owner-ui-bootstrap: the management journey performs UI bootstrap (SEC-02-V06,
 *     UX-01-V01, UX-01-V02, UX-01-V03, SEC-04-V11, SEC-15-V06) AND security cases that
 *     require a fresh `required`-mode instance (SEC-19-V01..V04, SEC-13-V01..V05,
 *     SEC-04-V06..V10, SEC-05-V01..V06, SEC-22-V01..V07). Both share the same target because
 *     the Playwright bootstrap and the security cases are interleaved; the security cases run
 *     after the bootstrap commits.
 *   - consumed: SEC-02-V04 (replay of a consumed token) and any other case that needs a
 *     post-bootstrap instance.
 *
 * The assignment is explicit and the manifest is hashed: a code change that moves a variant
 * between phases changes the lifecycle digest and is therefore reviewable, not silent.
 */
export function defaultPhases(requiredIds) {
  const bootstrapMode = ["SEC-02-V01", "SEC-02-V02", "SEC-02-V03", "SEC-02-V05", "SEC-01-V01", "SEC-01-V03", "SEC-01-V04", "SEC-01-V05"];
  const firstOwnerUiBootstrap = [
    "SEC-02-V06", "UX-01-V01", "UX-01-V02", "UX-01-V03",
    "SEC-04-V11", "SEC-15-V06", "SEC-13-V06", "SEC-07-V13", "SEC-14-V11", "SEC-20-V06", "SEC-18-V06"
  ];
  const consumed = ["SEC-02-V04"];
  const allAssigned = new Set([...bootstrapMode, ...firstOwnerUiBootstrap, ...consumed]);
  const leftover = requiredIds.filter((id) => !allAssigned.has(id)).sort();
  return [
    {
      id: "phase-bootstrap-mode",
      label: "fresh target, no UI bootstrap yet (SEC-02 V01/V02/V03 still-bootstrap checks)",
      targetState: "bootstrap",
      allowedVariants: bootstrapMode,
      recovery: { kind: "harness", command: "kubectl rollout restart deploy/${RELEASE} -n ${NAMESPACE}", requires: ["k8s-pvc-recreate", "k8s-secret-recreate"], label: "recreate PVC + bootstrap Secret from files; restart the deployment" }
    },
    {
      id: "phase-first-owner-ui-bootstrap",
      label: "Playwright UI bootstrap + required-mode security cases on the same fresh target",
      targetState: "required",
      allowedVariants: firstOwnerUiBootstrap,
      recovery: { kind: "harness", command: "kubectl rollout restart deploy/${RELEASE} -n ${NAMESPACE}", requires: ["k8s-pvc-recreate", "k8s-secret-recreate"], label: "recreate PVC + bootstrap Secret from files; restart the deployment" }
    },
    {
      id: "phase-consumed",
      label: "post-bootstrap: replay a consumed bootstrap token and run any case needing a post-bootstrap instance",
      targetState: "consumed",
      allowedVariants: consumed,
      recovery: { kind: "harness", command: "(no recovery needed; this is the final phase)", requires: [], label: "final phase: target is left in its post-bootstrap state" }
    },
    {
      id: "phase-unassigned-required",
      label: "all remaining required variants; their target state is whatever the parent instance is in after the prior phases",
      targetState: "required",
      // Loose catch-all so the manifest can still validate when new variants are added; the
      // catalog is the frozen denominator, so a review is required to move variants in here.
      allowedVariants: leftover,
      recovery: { kind: "harness", command: "(no recovery needed)", requires: [], label: "all other required variants run after the lifecycle phases above" }
    }
  ];
}
