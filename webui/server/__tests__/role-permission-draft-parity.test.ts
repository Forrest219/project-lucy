/**
 * G1 parity: ABSOLUTE_DENY_TOOL_NAMES (src/lib/rolePermissionDraft) 与
 * ABSOLUTE_DENY_TOOLS (server/proxy/acl.ts) 成员集合相等。
 *
 * 两边静态 import，不手写第二份名单。
 */
import { describe, expect, it } from "vitest";
import { ABSOLUTE_DENY_TOOLS } from "../proxy/acl.js";
import { ABSOLUTE_DENY_TOOL_NAMES } from "../../src/lib/rolePermissionDraft.js";

describe("ABSOLUTE_DENY_TOOL_NAMES parity with acl.ts ABSOLUTE_DENY_TOOLS", () => {
  it("both exports contain identical member sets (order-independent)", () => {
    const draftSet = new Set<string>(ABSOLUTE_DENY_TOOL_NAMES);
    const aclSet = new Set<string>(ABSOLUTE_DENY_TOOLS);

    // Every acl.ts member is in the draft set
    for (const tool of aclSet) {
      expect(draftSet).toContain(tool);
    }

    // Every draft member is in the acl.ts set
    for (const tool of draftSet) {
      expect(aclSet).toContain(tool);
    }

    // Sizes match (no extras either way)
    expect(draftSet.size).toBe(aclSet.size);
  });
});
