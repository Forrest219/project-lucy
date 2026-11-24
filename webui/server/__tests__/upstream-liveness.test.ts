import { afterEach, describe, expect, it } from "vitest";
import { markUpstreamToolCallResponded, resetUpstreamLivenessForTests, upstreamRespondedWithin } from "../runtime/upstream-liveness";

afterEach(() => resetUpstreamLivenessForTests());

describe("upstream liveness (P1-81)", () => {
  it("is false until KTX answers a tool call, true inside the window, false after it ages out", () => {
    expect(upstreamRespondedWithin(30_000, 1_000)).toBe(false);
    markUpstreamToolCallResponded(10_000);
    expect(upstreamRespondedWithin(30_000, 25_000)).toBe(true);
    expect(upstreamRespondedWithin(30_000, 41_000)).toBe(false);
  });
});
