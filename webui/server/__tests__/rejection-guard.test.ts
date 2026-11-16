/**
 * P1-37 U2 — 重复被拒状态：TTL、单身份 64、全局 1024 的 LRU，以及 policy_version 失效。
 */
import { describe, expect, it } from "vitest";
import {
  RepeatRejectionTracker,
  canonicalJson,
  computeRejectionFingerprint
} from "../proxy/rejection-guard";
import { rememberObservedToolNames, recallObservedToolNames, resetObservedToolNamesForTests } from "../proxy/observed-tool-names";

const parts = (identityId: string, n: number, policyVersion = "p1") => ({
  identityId, sessionScope: "s", tool: "lucy_query", fingerprint: `rf1:${n}`, reason: "r", policyVersion
});

describe("canonicalJson", () => {
  it("对象键排序、数组保持顺序、忽略 undefined", () => {
    expect(canonicalJson({ b: 1, a: [2, 1], c: undefined })).toBe(canonicalJson({ a: [2, 1], b: 1 }));
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
  });
});

describe("computeRejectionFingerprint", () => {
  it("同输入稳定、不同输入不同、不同密钥不同值，版本前缀为 rf1:", async () => {
    process.env.LUCY_REJECTION_FINGERPRINT_KEY = "a".repeat(40);
    const one = await computeRejectionFingerprint({ x: 1 });
    expect(one).toMatch(/^rf1:[0-9a-f]{16}$/);
    expect(await computeRejectionFingerprint({ x: 1 })).toBe(one);
    expect(await computeRejectionFingerprint({ x: 2 })).not.toBe(one);
    process.env.LUCY_REJECTION_FINGERPRINT_KEY = "b".repeat(40);
    expect(await computeRejectionFingerprint({ x: 1 })).not.toBe(one);
    delete process.env.LUCY_REJECTION_FINGERPRINT_KEY;
  });
});

describe("RepeatRejectionTracker", () => {
  it("TTL：60 s 内命中，之后不再命中", () => {
    let now = 0;
    const tracker = new RepeatRejectionTracker({ now: () => now });
    tracker.remember(parts("a", 1));
    now = 59_000;
    expect(tracker.isRepeated(parts("a", 1))).toBe(true);
    now = 61_000;
    expect(tracker.isRepeated(parts("a", 1))).toBe(false);
  });

  it("policy_version 变化后不命中", () => {
    const tracker = new RepeatRejectionTracker();
    tracker.remember(parts("a", 1, "p1"));
    expect(tracker.isRepeated(parts("a", 1, "p2"))).toBe(false);
  });

  it("单身份上限 64：最旧被淘汰，不影响其他身份", () => {
    const tracker = new RepeatRejectionTracker();
    tracker.remember(parts("other", 0));
    for (let n = 1; n <= 65; n += 1) tracker.remember(parts("a", n));
    expect(tracker.isRepeated(parts("a", 1))).toBe(false);
    expect(tracker.isRepeated(parts("a", 2))).toBe(true);
    expect(tracker.isRepeated(parts("a", 65))).toBe(true);
    expect(tracker.isRepeated(parts("other", 0))).toBe(true);
  });

  it("全局上限 1024：最旧被淘汰（17 个身份各 64 条＝1088）", () => {
    const tracker = new RepeatRejectionTracker();
    for (let id = 0; id < 17; id += 1) {
      for (let n = 0; n < 64; n += 1) tracker.remember(parts(`id${id}`, n));
    }
    expect(tracker.size).toBe(1024);
    expect(tracker.isRepeated(parts("id0", 0))).toBe(false);
    expect(tracker.isRepeated(parts("id16", 63))).toBe(true);
  });
});

describe("observed tool names", () => {
  it("只在同一 policy_version 下命中", () => {
    resetObservedToolNamesForTests();
    rememberObservedToolNames("a", "h", "p1", ["b", "a", "a"]);
    expect(recallObservedToolNames("a", "h", "p1")).toEqual(["a", "b"]);
    expect(recallObservedToolNames("a", "h", "p2")).toBeUndefined();
    expect(recallObservedToolNames("x", "h", "p1")).toBeUndefined();
  });
});
