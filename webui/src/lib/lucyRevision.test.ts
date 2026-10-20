import { describe, expect, it } from "vitest";
import { formatLucyRevisionLabel, lucyRevisionTitle } from "./lucyRevision";

const SHA = "e8863b8a".padEnd(40, "0");

describe("Lucy build revision label", () => {
  it("shows a 7-character prefix and the dirty marker", () => {
    expect(formatLucyRevisionLabel(SHA, false)).toBe("e8863b8");
    expect(formatLucyRevisionLabel(SHA, true)).toBe("e8863b8-dirty");
    expect(lucyRevisionTitle(SHA, true)).toBe(`${SHA} dirty`);
  });

  it("does not turn a product version or a short sha into a commit id", () => {
    expect(formatLucyRevisionLabel("2.0.0", false)).toBe("unknown");
    expect(formatLucyRevisionLabel("e8863b8", true)).toBe("unknown");
    expect(lucyRevisionTitle("e8863b8", false)).toBe("unknown");
  });
});
