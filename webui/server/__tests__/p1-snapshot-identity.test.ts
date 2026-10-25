import { describe, expect, it } from "vitest";
import {
  contentVersionOf,
  policyGenerationUnusable,
  policySnapshotIdentity,
  snapshotContextOf,
  withCapabilityDigest
} from "../admin/snapshot-identity.js";
import type { AccessSnapshot } from "../admin/permission-display.js";

function snapshotOf(overrides: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    adminPath: "/project/webui/config/access.yaml",
    runtimePath: "/project/webui/config/access.yaml",
    raw: "users: []\n",
    version: "1700000000000-abc123",
    runtimeConfig: {} as AccessSnapshot["runtimeConfig"],
    ...overrides
  };
}

const generation = { policyVersion: "pv-1", sourceMapVersion: "smv-1" };

describe("P1 shared snapshot identity", () => {
  it("derives a content-based config version so two reads of one file agree", () => {
    const a = contentVersionOf("users: []\n");
    const b = contentVersionOf("users: []\n");
    expect(a).toBe(b);
    expect(a).not.toBe(contentVersionOf("users: [{id: a}]\n"));
  });

  it("ignores the mtime-based admin version when building the identity", () => {
    const first = policySnapshotIdentity(snapshotOf(), generation);
    const second = policySnapshotIdentity(snapshotOf({ version: "1700000009999-def456" }), generation);
    // Same content ⇒ same configVersion, even if the file was touched.
    expect(first.configVersion).toBe(second.configVersion);
    expect(first.policyVersion).toBe("pv-1");
    expect(first.sourceMapVersion).toBe("smv-1");
  });

  it("leaves the capability digest empty until a surface attaches it", () => {
    const base = policySnapshotIdentity(snapshotOf(), generation);
    expect(base.capabilityDigest).toBe("");
    expect(withCapabilityDigest(base, "cap-1").capabilityDigest).toBe("cap-1");
  });

  it("marks an unreadable config unavailable with the concrete problem", () => {
    const context = snapshotContextOf({ snapshot: snapshotOf({ problem: "access_unreadable" }), generation });
    expect(context.state).toBe("unavailable");
    expect(context.problem).toBe("access_unreadable");
  });

  it("marks a path mismatch unavailable rather than serving a mixed generation", () => {
    const context = snapshotContextOf({ snapshot: snapshotOf({ problem: "access_config_path_mismatch" }), generation });
    expect(context.state).toBe("unavailable");
    expect(context.problem).toBe("access_config_path_mismatch");
  });

  it("treats an uncommitted policy generation as unusable, not as a valid empty generation", () => {
    const snapshot = snapshotOf();
    expect(policyGenerationUnusable(snapshot, { policyVersion: "", sourceMapVersion: "smv-1" })).toBe(true);
    expect(policyGenerationUnusable(snapshot, generation)).toBe(false);
    const context = snapshotContextOf({ snapshot, generation: { policyVersion: "", sourceMapVersion: "" } });
    expect(context.state).toBe("unavailable");
  });

  it("reports partial with the failed subject set instead of a zero fill", () => {
    const context = snapshotContextOf({
      snapshot: snapshotOf(),
      generation,
      failures: [{ subjectId: "agent-b", reason: "row_policy_predicates_required" }]
    });
    expect(context.state).toBe("partial");
    expect(context.failures).toEqual([{ subjectId: "agent-b", reason: "row_policy_predicates_required" }]);
  });

  it("reports ok when nothing failed", () => {
    const context = snapshotContextOf({ snapshot: snapshotOf(), generation, capabilityDigest: "cap-1" });
    expect(context.state).toBe("ok");
    expect(context.problem).toBeNull();
    expect(context.identity.capabilityDigest).toBe("cap-1");
  });
});
