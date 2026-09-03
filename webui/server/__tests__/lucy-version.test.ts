import { afterEach, describe, expect, it } from "vitest";
import { assertLucyProductVersion, resolveLucyVersion } from "../lucy-version";

const originalLucyVersion = process.env.LUCY_VERSION;

afterEach(() => {
  if (originalLucyVersion === undefined) delete process.env.LUCY_VERSION;
  else process.env.LUCY_VERSION = originalLucyVersion;
});

describe("Lucy product version resolver", () => {
  it("accepts numeric X.Y.Z and trims whitespace", () => {
    expect(assertLucyProductVersion(" 0.17.0\n", "test")).toBe("0.17.0");
  });

  it("rejects prefixed or malformed values", () => {
    expect(() => assertLucyProductVersion("v0.17.0", "test")).toThrow(/numeric X\.Y\.Z/);
    expect(() => assertLucyProductVersion("garbage", "test")).toThrow(/numeric X\.Y\.Z/);
  });

  it("prefers a valid LUCY_VERSION environment value", () => {
    process.env.LUCY_VERSION = "9.8.7";
    expect(resolveLucyVersion()).toBe("9.8.7");
  });

  it("rejects an invalid LUCY_VERSION instead of reporting it in health", () => {
    process.env.LUCY_VERSION = "garbage";
    expect(() => resolveLucyVersion()).toThrow(/LUCY_VERSION must use numeric X\.Y\.Z/);
  });
});

