/**
 * Lucy v0.25 P1 — one shared snapshot identity for every P1 read surface.
 *
 * Authority:
 *   - P1-1 §3.3  行策略模板与按表反查 Spec  → `snapshot: {configVersion, policyVersion, sourceMapVersion, capabilityDigest}`
 *   - P1-2 §2.1  授权摘要 Spec               → `summaryContext: {..., configVersion, policyVersion, sourceMapVersion, capabilityDigest, ...}`
 *   - P1-3 §6.2  Access Map Spec            → `meta.grant: {state, accessConfigVersion, policyVersion, sourceMapVersion, capabilityDigest}`
 *
 * The four fields are the SAME four fields in all three specs. `accessConfigVersion`
 * (P1-3) is the wire name for `configVersion` (P1-1/P1-2); the value is identical
 * and the Access Map route maps it back to the name its own Spec signed off.
 *
 * Two invariants this module exists to protect:
 *
 *  1. **One generation.** A summary and an access map computed from different
 *     config/policy/source-map generations are not reconcilable. Every P1
 *     acceptance check leans on "同源", so the generation fields are derived
 *     from the existing runtime — never re-read, never re-computed locally.
 *  2. **Degradation is explicit.** An unknown enabled-table denominator is `null`,
 *     never `0`; a failed subject is `partial` with the failed set, never a zero
 *     fill. `ok` with an empty capability set is a legitimate definite answer and
 *     must stay distinguishable from "we could not tell".
 *
 * This module never reads access.yaml itself. It derives from the existing admin
 * snapshot and the existing policy runtime, so a second source of truth cannot
 * appear next to the first.
 */
import { createHash } from "node:crypto";
import { getPolicyRuntimeStatus } from "../proxy/acl.js";
import type { AccessSnapshot, CountState } from "./permission-display.js";

export type SnapshotState = CountState;
export type SnapshotProblem = "access_unreadable" | "access_invalid" | "access_config_path_mismatch";

/** The four fields every P1 surface must publish, verbatim. */
export type SnapshotIdentity = {
  /** Content-based identity of the committed access configuration. */
  configVersion: string;
  /** Runtime policy generation (classification table + enabled tables digests). */
  policyVersion: string;
  /** Source-map generation the policy was built against. */
  sourceMapVersion: string;
  /** Digest of the capability set the surface actually displays. */
  capabilityDigest: string;
};

export type SnapshotContext = {
  identity: SnapshotIdentity;
  state: SnapshotState;
  problem: SnapshotProblem | null;
  /** Subjects that failed to resolve. Empty when `state` is `ok`. */
  failures: Array<{ subjectId: string; reason: string }>;
};

/**
 * Content-based version of the access configuration.
 *
 * Deliberately NOT the admin snapshot's `version`: that one is `mtime-hash`, so
 * two surfaces reading the same unchanged file a second apart would disagree and
 * a legitimate reconciliation would fail. The reconciliation contract is "same
 * content ⇒ same generation", so the digest is over content only.
 */
export function contentVersionOf(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * The policy generation the identity is derived from.
 *
 * Injectable so the derivation stays a pure function: the runtime is the
 * default source, but a caller (and a test) can supply the generation it
 * already read, so a single response cannot mix two generations.
 */
export type PolicyGeneration = {
  policyVersion: string;
  sourceMapVersion: string;
};

/** Read the current policy generation from the runtime. */
export function currentPolicyGeneration(): PolicyGeneration {
  const status = getPolicyRuntimeStatus();
  return { policyVersion: status.policyVersion, sourceMapVersion: status.sourceMapVersion };
}

/**
 * The policy-level identity shared by every P1 surface.
 *
 * `capabilityDigest` is left empty here on purpose: it is a digest of a
 * *surface's* capability set (one Agent's summary, one Agent's grant paths),
 * not of the policy. Use {@link withCapabilityDigest} to attach it.
 */
export function policySnapshotIdentity(
  snapshot: AccessSnapshot,
  generation: PolicyGeneration = currentPolicyGeneration()
): SnapshotIdentity {
  return {
    configVersion: contentVersionOf(snapshot.raw),
    policyVersion: generation.policyVersion,
    sourceMapVersion: generation.sourceMapVersion,
    capabilityDigest: ""
  };
}

/** Attach a surface's capability digest to a policy-level identity. */
export function withCapabilityDigest(base: SnapshotIdentity, capabilityDigest: string): SnapshotIdentity {
  return { ...base, capabilityDigest };
}

/**
 * True when the policy runtime cannot vouch for the generation it reports.
 *
 * `policyVersion === ""` means the runtime has not committed a policy yet, so
 * `policyVersion`/`sourceMapVersion` are not trustworthy identity. A surface
 * must degrade instead of publishing an empty generation as if it were real.
 */
export function policyGenerationUnusable(
  snapshot: AccessSnapshot,
  generation: PolicyGeneration = currentPolicyGeneration()
): boolean {
  if (snapshot.problem) return true;
  return generation.policyVersion === "" || generation.sourceMapVersion === "";
}

/**
 * Build the shared context.
 *
 * `failures` is the explicit failed-subject set: `partial` must say WHICH
 * subjects failed, and `unavailable` must not be produced by a zero fill.
 */
export function snapshotContextOf(input: {
  snapshot: AccessSnapshot;
  capabilityDigest?: string;
  failures?: Array<{ subjectId: string; reason: string }>;
  generation?: PolicyGeneration;
}): SnapshotContext {
  const { snapshot } = input;
  const failures = input.failures ?? [];
  const generation = input.generation ?? currentPolicyGeneration();
  const base = policySnapshotIdentity(snapshot, generation);
  const identity = withCapabilityDigest(base, input.capabilityDigest ?? "");

  if (snapshot.problem) {
    return { identity, state: "unavailable", problem: snapshot.problem, failures };
  }
  if (policyGenerationUnusable(snapshot, generation)) {
    return { identity, state: "unavailable", problem: null, failures };
  }
  if (failures.length > 0) {
    return { identity, state: "partial", problem: null, failures };
  }
  return { identity, state: "ok", problem: null, failures };
}
