import { createHash } from "node:crypto";

/**
 * Lucy v0.25 — one canonical digest vocabulary.
 *
 * Authority: docs/specs/lucy-20261022-v2p5-row-permission-management-spec.md §3.2/§3.4
 * and docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md §7.2.
 *
 * Before this module the same idea carried three names in three modules
 * (`policyDigest` / `planDigest` / `candidateDigest`, plus `computeAccessConfigDigest`),
 * so a preview could be bound to one digest while a commit checked another. The
 * vocabulary below is deliberately split into levels that must never be interchanged:
 *
 *  - `policyDigest`    — digest of the COMMITTED configuration. What the runtime is
 *                        serving right now.
 *  - `candidateDigest` — digest of the CANDIDATE configuration an in-memory overlay
 *                        produced. What a preview is bound to.
 *  - `planDigest`      — digest of the PLAN: the concrete target set, each target's
 *                        expected digest (or `null` for "target did not exist"), and
 *                        the candidate digest. What a confirmation is bound to.
 *
 * A commit must re-derive the candidate digest and the plan digest and compare them
 * with the confirmed values. Comparing a candidate digest against a plan digest is a
 * contract error, not a mismatch.
 *
 * Canonicalization is shared: `stableJson` sorts object keys and preserves array
 * order, so the same logical value always produces the same digest regardless of the
 * key order a caller happened to build it with.
 */

/** Bumped when the canonicalization changes in a way that alters existing digests. */
export const DIGEST_VOCABULARY_VERSION = "v0.25-digest-1";

/** Canonical JSON: object keys sorted, array order preserved. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Digest of a candidate configuration. This is what a read-only preview binds to.
 */
export function computeCandidateDigest(value: unknown): string {
  return sha256Hex(stableJson(value));
}

/**
 * Digest of the committed policy configuration.
 *
 * Same canonicalization as the candidate digest, so a candidate that happens to equal
 * the committed configuration yields the same value — which is exactly the property
 * "the preview still matches the current policy" depends on.
 */
export function computePolicyDigest(accessConfig: unknown): string {
  return sha256Hex(stableJson(accessConfig));
}

export interface DigestPlanTarget {
  /** Project-root-relative target path. */
  path: string;
  /** Expected digest of the target, or `null` when the target must not exist yet. */
  expectedDigest: string | null;
}

/**
 * Digest of a plan: the target set, each target's expected digest, and the candidate
 * digest the plan was built from. Bind a confirmation to this value, never to a
 * boolean.
 */
export function computePlanDigest(input: {
  candidateDigest: string;
  targets: DigestPlanTarget[];
  extra?: Record<string, unknown>;
}): string {
  const targets = [...input.targets]
    .map((target) => ({ path: target.path, expectedDigest: target.expectedDigest }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(
    stableJson({
      vocabulary: DIGEST_VOCABULARY_VERSION,
      candidateDigest: input.candidateDigest,
      targets,
      extra: input.extra ?? {}
    })
  );
}
