import { describe, expect, it } from "vitest";
import {
  buildTokenDisplayHint,
  isValidTokenDisplayHint,
  TOKEN_HINT_ELLIPSIS
} from "../admin/token-display-hint.js";

describe("token-display-hint", () => {
  it("builds fixed prefix…suffix from 64-hex plaintext", () => {
    const plain = `${"a1b2c3"}${"d".repeat(54)}9f0e`;
    expect(plain).toHaveLength(64);
    expect(buildTokenDisplayHint(plain)).toBe(`a1b2c3${TOKEN_HINT_ELLIPSIS}9f0e`);
  });

  it("rejects non-64-hex plaintext", () => {
    expect(() => buildTokenDisplayHint("short")).toThrow(/64 lowercase hex/);
    expect(() => buildTokenDisplayHint("A".repeat(64))).toThrow(/64 lowercase hex/);
  });

  it("validates the contracted hint shape", () => {
    expect(isValidTokenDisplayHint("a1b2c3…9f0e")).toBe(true);
    expect(isValidTokenDisplayHint("a1b2c3...9f0e")).toBe(false);
    expect(isValidTokenDisplayHint("sha256:aabbcc")).toBe(false);
    expect(isValidTokenDisplayHint(null)).toBe(false);
  });
});
