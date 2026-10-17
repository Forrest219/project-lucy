import { describe, expect, it } from "vitest";
import {
  assertWritableAcl,
  authorizeContext,
  externalContextReason,
  parseObjectAcl,
  type ContextAsset,
  type ContextSnapshot
} from "../proxy/context-acl.js";

/**
 * Spec §4.1–4.2 decision matrix for `authorizeContext` (T05 step 1, RED→GREEN).
 * Synthetic roles/objects only; no I/O.
 */

const identity = { userId: "agent" };

const snapshot = (roleChannels: Record<string, string[]>): ContextSnapshot => ({
  ok: true,
  roleIds: Object.keys(roleChannels),
  roleChannels,
  policyVersion: "p1",
  roleChannelVersion: "r1"
});

const BOTH_SKILL = ["lucy_skill_search", "lucy_skill_read"];
const BOTH_WIKI = ["wiki_search", "wiki_read"];

const skill = (acl: ContextAsset["acl"], status: ContextAsset["status"] = "published"): ContextAsset => ({
  kind: "skill",
  id: "lucy-skill://finance/sop",
  acl,
  status
});
const wiki = (acl: ContextAsset["acl"]): ContextAsset => ({ kind: "wiki", id: "global/page.md", acl });

describe("parseObjectAcl (Spec §4.1)", () => {
  it.each([
    [undefined, false, "missing"],
    [null, true, "missing"],
    [[], true, "empty"],
    [["*"], true, "all"],
    [["a", "b", "a"], true, "roles"],
    [["*", "a"], true, "corrupt"],
    ["finance", true, "corrupt"],
    [{ roles: ["a"] }, true, "corrupt"],
    [["a", 3], true, "corrupt"],
    [["a", " "], true, "corrupt"]
  ])("%j (declared=%s) → %s", (value, declared, state) => {
    expect(parseObjectAcl(value, declared as boolean).state).toBe(state);
  });

  it("dedupes and trims role ids", () => {
    expect(parseObjectAcl([" a ", "a", "b"], true)).toEqual({ state: "roles", roles: ["a", "b"] });
  });

  it("assertWritableAcl rejects corrupt saves and accepts the three explicit forms", () => {
    expect(assertWritableAcl([])).toEqual([]);
    expect(assertWritableAcl(["*"])).toEqual(["*"]);
    expect(assertWritableAcl(["a"])).toEqual(["a"]);
    expect(() => assertWritableAcl(["*", "a"])).toThrow(/wildcard_mixed/);
    expect(() => assertWritableAcl("a")).toThrow(/not_an_array/);
  });
});

describe("authorizeContext matrix (Spec §4.1–4.2)", () => {
  it("allows a role that matches the object ACL AND grants the channel", () => {
    const snap = snapshot({ finance: [...BOTH_SKILL, ...BOTH_WIKI] });
    for (const action of ["discover", "read"] as const) {
      expect(authorizeContext(identity, skill({ state: "roles", roles: ["finance"] }), action, snap)).toMatchObject({
        allowed: true,
        matchedRoleId: "finance"
      });
      expect(authorizeContext(identity, wiki({ state: "roles", roles: ["finance"] }), action, snap)).toMatchObject({
        allowed: true
      });
    }
  });

  it.each([
    ["missing", { state: "missing" } as const, "acl_missing"],
    ["empty", { state: "empty" } as const, "acl_empty"],
    ["corrupt", { state: "corrupt", detail: "x" } as const, "acl_corrupt"]
  ])("denies %s ACL (never shared), even for an all-channel role", (_name, acl, reason) => {
    const snap = snapshot({ finance: [...BOTH_SKILL, ...BOTH_WIKI] });
    expect(authorizeContext(identity, skill(acl), "read", snap)).toEqual({ allowed: false, action: "read", reason });
    expect(authorizeContext(identity, wiki(acl), "discover", snap)).toEqual({ allowed: false, action: "discover", reason });
  });

  it("does not stitch an object-only role to a channel-only role", () => {
    const snap = snapshot({ object_only: [], channel_only: [...BOTH_SKILL, ...BOTH_WIKI] });
    const asset = skill({ state: "roles", roles: ["object_only"] });
    expect(authorizeContext(identity, asset, "read", snap)).toMatchObject({ allowed: false, reason: "channel_not_granted" });
    expect(authorizeContext(identity, asset, "discover", snap)).toMatchObject({ allowed: false, reason: "channel_not_granted" });
  });

  it("splits discover and read: a discover-only role cannot read, a read-only role is not listed", () => {
    const asset = wiki({ state: "roles", roles: ["r"] });
    const discoverOnly = snapshot({ r: ["wiki_search"] });
    const readOnly = snapshot({ r: ["wiki_read"] });
    expect(authorizeContext(identity, asset, "discover", discoverOnly).allowed).toBe(true);
    expect(authorizeContext(identity, asset, "read", discoverOnly).allowed).toBe(false);
    expect(authorizeContext(identity, asset, "read", readOnly).allowed).toBe(true);
    expect(authorizeContext(identity, asset, "discover", readOnly).allowed).toBe(false);
  });

  it("`*` means every validly assigned role with the channel — not anonymous", () => {
    const snap = snapshot({ any_role: BOTH_WIKI });
    expect(authorizeContext(identity, wiki({ state: "all" }), "read", snap).allowed).toBe(true);
    expect(authorizeContext(identity, wiki({ state: "all" }), "read", snapshot({ any_role: ["wiki_search"] })).allowed).toBe(false);
    expect(
      authorizeContext(identity, wiki({ state: "all" }), "read", { ok: false, reason: "context_role_required" })
    ).toMatchObject({ allowed: false, reason: "context_role_required" });
  });

  it("a Wiki/Skill name such as `global`, public visibility or sl_refs never grants (only the ACL does)", () => {
    // These are not inputs of authorizeContext at all: an object with no ACL stays denied.
    const snap = snapshot({ finance: BOTH_WIKI });
    expect(authorizeContext(identity, { kind: "wiki", id: "global/public.md", acl: { state: "missing" } }, "read", snap).allowed).toBe(false);
  });

  it("an unknown / deleted role id in the ACL matches nobody", () => {
    const snap = snapshot({ finance: BOTH_SKILL });
    expect(authorizeContext(identity, skill({ state: "roles", roles: ["deleted_role"] }), "read", snap)).toMatchObject({
      allowed: false,
      reason: "role_not_granted"
    });
  });

  it("multi-role: only a complete (object + channel) branch allows; branches are OR-ed", () => {
    const snap = snapshot({ a: [], b: BOTH_SKILL });
    expect(authorizeContext(identity, skill({ state: "roles", roles: ["a", "b"] }), "read", snap)).toMatchObject({
      allowed: true,
      matchedRoleId: "b"
    });
  });

  it("draft and deprecated Skills are denied regardless of the ACL", () => {
    const snap = snapshot({ r: BOTH_SKILL });
    const acl = { state: "all" } as const;
    expect(authorizeContext(identity, skill(acl, "draft"), "read", snap)).toMatchObject({ reason: "skill_not_published" });
    expect(authorizeContext(identity, skill(acl, "deprecated"), "read", snap)).toMatchObject({ reason: "skill_deprecated" });
  });

  it("legacy / unresolved identities are refused before any object is evaluated", () => {
    const asset = skill({ state: "all" });
    expect(authorizeContext(identity, asset, "read", { ok: false, reason: "context_role_required" })).toMatchObject({
      allowed: false,
      reason: "context_role_required"
    });
    expect(authorizeContext(identity, asset, "read", { ok: false, reason: "context_policy_unavailable" })).toMatchObject({
      allowed: false,
      reason: "context_policy_unavailable"
    });
  });

  it("external responses are uniform for every object-level denial", () => {
    const denials = ["skill_not_published", "skill_deprecated", "acl_missing", "acl_empty", "acl_corrupt", "role_not_granted", "channel_not_granted", "context_policy_unavailable"] as const;
    for (const reason of denials) {
      expect(externalContextReason({ allowed: false, action: "read", reason })).toBe("context_not_available");
    }
    expect(externalContextReason({ allowed: false, action: "read", reason: "context_role_required" })).toBe("context_role_required");
  });
});
