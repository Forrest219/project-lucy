import { describe, expect, it } from "vitest";
import { formatLucyVersionLabel, normalizeLucyProductVersion } from "./lucyVersion";

describe("Lucy product version label", () => {
  it("normalizes valid numeric versions", () => {
    expect(normalizeLucyProductVersion(" v0.18.0 ")).toBe("0.18.0");
    expect(formatLucyVersionLabel("0.18.0")).toBe("v0.18.0");
  });

  it("does not display malformed build metadata as a product version", () => {
    expect(normalizeLucyProductVersion("garbage")).toBeUndefined();
    expect(formatLucyVersionLabel("garbage")).toBe("vunknown");
  });
});

