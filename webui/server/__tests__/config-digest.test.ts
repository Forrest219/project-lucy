import { describe, expect, it } from "vitest";
import {
  DIGEST_VOCABULARY_VERSION,
  computeCandidateDigest,
  computePlanDigest,
  computePolicyDigest,
  sha256Hex,
  stableJson
} from "../config-digest.js";

describe("canonical digest vocabulary", () => {
  it("is insensitive to object key order and sensitive to array order", () => {
    expect(stableJson({ b: 1, a: [2, 1] })).toBe(stableJson({ a: [2, 1], b: 1 }));
    expect(stableJson({ a: [1, 2] })).not.toBe(stableJson({ a: [2, 1] }));
  });

  it("computes the same digest for the same logical configuration", () => {
    const one = { users: [{ id: "a", tokens: [] }], roles: { r: { description: "x" } } };
    const two = { roles: { r: { description: "x" } }, users: [{ tokens: [], id: "a" }] };
    expect(computeCandidateDigest(one)).toBe(computeCandidateDigest(two));
    expect(computePolicyDigest(one)).toBe(computePolicyDigest(two));
  });

  it("separates the candidate level from the policy level only by content, never by function", () => {
    const config = { users: [] };
    // Same logical value ⇒ same digest across levels. A preview that is still valid
    // for the current policy depends on exactly this property.
    expect(computeCandidateDigest(config)).toBe(computePolicyDigest(config));
  });

  it("binds a plan to the target set, the expected digests and the candidate digest", () => {
    const base = {
      candidateDigest: computeCandidateDigest({ users: [] }),
      targets: [
        { path: "semantic-layer/a.yaml", expectedDigest: "d1" },
        { path: "semantic-layer/b.yaml", expectedDigest: null }
      ]
    };

    const plan = computePlanDigest(base);
    expect(plan).toBe(computePlanDigest({ ...base, targets: [...base.targets].reverse() }));

    // A different candidate, a different target set or a different expected digest
    // all produce a different plan digest.
    expect(computePlanDigest({ ...base, candidateDigest: "other" })).not.toBe(plan);
    expect(
      computePlanDigest({ ...base, targets: base.targets.slice(0, 1) })
    ).not.toBe(plan);
    expect(
      computePlanDigest({
        ...base,
        targets: [{ path: "semantic-layer/a.yaml", expectedDigest: "d2" }, base.targets[1]!]
      })
    ).not.toBe(plan);
  });

  it("distinguishes a target that must not exist yet from one with a digest", () => {
    const absent = computePlanDigest({
      candidateDigest: "c",
      targets: [{ path: "x.yaml", expectedDigest: null }]
    });
    const present = computePlanDigest({
      candidateDigest: "c",
      targets: [{ path: "x.yaml", expectedDigest: sha256Hex("") }]
    });
    expect(absent).not.toBe(present);
  });

  it("publishes a vocabulary version so a digest change is detectable", () => {
    expect(DIGEST_VOCABULARY_VERSION).toBe("v0.25-digest-1");
  });
});
