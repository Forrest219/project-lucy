// B2 first-owner lifecycle: explicit serialized disposable fixture phases/generations/checkpoints.
//
// Tests cover the pure lifecycle contract (buildLifecycle / PhaseQueue / lifecycleDigest /
// defaultPhases) so the assembled evidence can prove that a real release run bound a fixed
// sequence of fresh phases, that every required variant ran in exactly one phase, and that
// missing supported control produces a blocked result, not a silently-lowered denominator.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandCatalog } from "../lib/catalog.mjs";
import { buildLifecycle, defaultPhases, lifecycleDigest, PhaseQueue } from "../lib/lifecycle.mjs";

function buildCases() {
  return expandCatalog({ scenarios: {
    "AAA": { runner: "security", executors: ["P"], requires: ["lucy-http"], assert: ["deny"], gold: "none", artifacts: ["security-case-result.json"], variants: [{ id: "AAA-V01" }] },
    "BBB": { runner: "security", executors: ["P"], requires: ["lucy-http"], assert: ["deny"], gold: "none", artifacts: ["security-case-result.json"], variants: [{ id: "BBB-V01" }] },
    "CCC": { runner: "management", executors: ["B"], requires: ["lucy-http", "browser"], assert: ["allow_control"], gold: "none", artifacts: ["management-case-result.json"], variants: [{ id: "CCC-V01" }] }
  } });
}

describe("B2 lifecycle: explicit serialized fixture phases", () => {
  it("buildLifecycle rejects a variant listed in two phases (no silent cross-phase duplication)", () => {
    const cases = buildCases();
    const phases = [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01", "BBB-V01"], recovery: { kind: "harness", command: "x" } },
      { id: "p2", label: "p2", targetState: "required", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } }
    ];
    const { problems } = buildLifecycle({ cases, phases });
    assert.ok(problems.some((p) => /allowed in more than one phase/.test(p)), `expected duplication problem, got: ${problems.join("; ")}`);
  });

  it("buildLifecycle rejects a required variant that no phase claims (denominator is fixed)", () => {
    const cases = buildCases();
    const phases = [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } }
    ];
    const { problems } = buildLifecycle({ cases, phases });
    assert.ok(problems.some((p) => /BBB-V01.*not assigned/.test(p)), `expected missing-variant problem, got: ${problems.join("; ")}`);
    assert.ok(problems.some((p) => /CCC-V01.*not assigned/.test(p)), `expected missing-variant problem, got: ${problems.join("; ")}`);
  });

  it("buildLifecycle rejects a phase whose recovery kind is not 'harness' (no product back-door)", () => {
    const cases = buildCases();
    const phases = [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01", "BBB-V01", "CCC-V01"], recovery: { kind: "product", command: "/api/admin/reset" } }
    ];
    const { problems } = buildLifecycle({ cases, phases });
    assert.ok(problems.some((p) => /kind:"harness"/.test(p)), `expected harness-only recovery problem, got: ${problems.join("; ")}`);
  });

  it("buildLifecycle accepts a fully-assigned manifest with harness recovery and produces a stable digest", () => {
    const cases = buildCases();
    const phases = [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "kubectl rollout restart" } },
      { id: "p2", label: "p2", targetState: "required", allowedVariants: ["BBB-V01", "CCC-V01"], recovery: { kind: "harness", command: "(none)" } }
    ];
    const { manifest, problems, assigned } = buildLifecycle({ cases, phases });
    assert.deepEqual(problems, [], "no manifest problems");
    assert.equal(assigned.get("AAA-V01"), "p1");
    assert.equal(assigned.get("BBB-V01"), "p2");
    assert.equal(assigned.get("CCC-V01"), "p2");
    // Digest is stable: same manifest -> same digest.
    assert.equal(lifecycleDigest(manifest), lifecycleDigest(manifest));
    // Digest changes when the phase assignment changes.
    const reordered = buildLifecycle({ cases, phases: [phases[1], phases[0]] }).manifest;
    assert.notEqual(lifecycleDigest(manifest), lifecycleDigest(reordered));
  });

  it("PhaseQueue refuses to acquire a phase whose prior phase has no checkpoint (serialization)", () => {
    const cases = buildCases();
    const { manifest } = buildLifecycle({ cases, phases: [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } },
      { id: "p2", label: "p2", targetState: "required", allowedVariants: ["BBB-V01", "CCC-V01"], recovery: { kind: "harness", command: "x" } }
    ] });
    const queue = new PhaseQueue(manifest);
    assert.equal(queue.acquire("p1"), true);
    // Try to skip ahead to p2 without checkpointing p1.
    assert.equal(queue.acquire("p2"), false);
    assert.ok(queue.problems.some((p) => /prior phase "p1" has no checkpoint/.test(p)));
  });

  it("PhaseQueue refuses a checkpoint whose observation contradicts the declared targetState", () => {
    const cases = buildCases();
    const { manifest } = buildLifecycle({ cases, phases: [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } }
    ] });
    const queue = new PhaseQueue(manifest);
    assert.equal(queue.checkpoint("p1", { mode: "required" }), false, "bootstrap phase must reject a 'required' observation");
    assert.ok(queue.problems.some((p) => /expected targetState="bootstrap" but observed mode="required"/.test(p)));
  });

  it("PhaseQueue.verifyComplete flags any phase that never reached a checkpoint", () => {
    const cases = buildCases();
    const { manifest } = buildLifecycle({ cases, phases: [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } },
      { id: "p2", label: "p2", targetState: "required", allowedVariants: ["BBB-V01", "CCC-V01"], recovery: { kind: "harness", command: "x" } }
    ] });
    const queue = new PhaseQueue(manifest);
    // Only checkpoint p1.
    assert.equal(queue.acquire("p1"), true);
    assert.equal(queue.checkpoint("p1", { mode: "bootstrap" }), true);
    // We did not run p2; verifyComplete must flag it.
    assert.equal(queue.verifyComplete(), false);
    assert.ok(queue.problems.some((p) => /never reached a checkpoint/.test(p)));
  });

  it("PhaseQueue serializes a happy path: p1 checkpoint -> p2 acquire -> p2 checkpoint -> verifyComplete ok", () => {
    const cases = buildCases();
    const { manifest } = buildLifecycle({ cases, phases: [
      { id: "p1", label: "p1", targetState: "bootstrap", allowedVariants: ["AAA-V01"], recovery: { kind: "harness", command: "x" } },
      { id: "p2", label: "p2", targetState: "required", allowedVariants: ["BBB-V01", "CCC-V01"], recovery: { kind: "harness", command: "x" } }
    ] });
    const queue = new PhaseQueue(manifest);
    assert.equal(queue.acquire("p1"), true);
    assert.equal(queue.checkpoint("p1", { mode: "bootstrap" }), true);
    assert.equal(queue.acquire("p2"), true);
    assert.equal(queue.checkpoint("p2", { mode: "required" }), true);
    assert.equal(queue.verifyComplete(), true, "every phase reached a checkpoint");
    assert.deepEqual(queue.problems, []);
  });

  it("defaultPhases covers SEC-02-V01/V02/V03 in bootstrap-mode and SEC-02-V06 + UX-01 in first-owner-ui-bootstrap", () => {
    const cases = buildCases();
    const requiredIds = cases.filter((c) => c.required).map((c) => c.id);
    const phases = defaultPhases(requiredIds);
    const bootstrapPhase = phases.find((p) => p.id === "phase-bootstrap-mode");
    const uiPhase = phases.find((p) => p.id === "phase-first-owner-ui-bootstrap");
    const consumedPhase = phases.find((p) => p.id === "phase-consumed");
    // Bootstrap-mode phase must own the SEC-02 still-bootstrap cases.
    for (const id of ["SEC-02-V01", "SEC-02-V02", "SEC-02-V03"]) {
      assert.ok(bootstrapPhase.allowedVariants.includes(id), `${id} must run in the bootstrap-mode phase`);
    }
    // First-owner UI bootstrap must own the management UX-01 first-owner variant.
    assert.ok(uiPhase.allowedVariants.includes("UX-01-V01"), "UX-01-V01 must run in the first-owner-ui phase");
    assert.ok(uiPhase.allowedVariants.includes("SEC-02-V06"), "SEC-02-V06 (browser controlled bootstrap) must run in the first-owner-ui phase");
    // Consumed phase must own SEC-02-V04 (replay of a consumed bootstrap token).
    assert.ok(consumedPhase.allowedVariants.includes("SEC-02-V04"), "SEC-02-V04 (consumed-token replay) must run in the consumed phase");
  });

  it("defaultPhases never assigns the same variant to two phases (no overlap)", () => {
    const cases = buildCases();
    const requiredIds = cases.filter((c) => c.required).map((c) => c.id);
    const phases = defaultPhases(requiredIds);
    const seen = new Map();
    for (const phase of phases) {
      for (const id of phase.allowedVariants) {
        if (seen.has(id)) {
          assert.fail(`variant ${id} appears in both phase "${seen.get(id)}" and phase "${phase.id}"`);
        }
        seen.set(id, phase.id);
      }
    }
  });

  it("defaultPhases: every phase declares a harness-only recovery (no product back-door)", () => {
    const cases = buildCases();
    const requiredIds = cases.filter((c) => c.required).map((c) => c.id);
    for (const phase of defaultPhases(requiredIds)) {
      assert.equal(phase.recovery.kind, "harness", `phase "${phase.id}" recovery kind must be "harness"`);
    }
  });

  it("buildLifecycle: the real catalog builds a valid manifest with the default phases (no missing required variants)", async () => {
    const { loadCatalog } = await import("../lib/catalog.mjs");
    const { cases } = loadCatalog();
    const requiredIds = cases.filter((c) => c.required).map((c) => c.id);
    const phases = defaultPhases(requiredIds);
    const { manifest, problems } = buildLifecycle({ cases, phases });
    // Some problems are acceptable: REQUIRED_EXISTING_GATES-style variants etc. The default
    // catch-all "phase-unassigned-required" absorbs everything not explicitly listed. The
    // manifest must still be valid.
    assert.equal(problems.length, 0, `default lifecycle must be valid for the real catalog: ${problems.join("; ")}`);
    assert.equal(manifest.contract, "lucy-e2e-lifecycle-v1");
  });
});
