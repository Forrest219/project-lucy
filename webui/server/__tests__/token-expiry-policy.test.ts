import { describe, expect, it } from "vitest";
import {
  NEW_TOKEN_DEFAULT_TTL_DAYS,
  NEW_TOKEN_MAX_TTL_DAYS,
  assertStrictExtension,
  effectiveExpiryMs,
  isAbsentExpiry,
  normalizeNewTokenExpiry,
  presetExpiryDateString,
  resolveIssuedTokenExpiry,
  TokenExpiryPolicyError
} from "../admin/token-expiry-policy.js";

describe("token-expiry-policy", () => {
  it("defaults to 365 days with max 365", () => {
    expect(NEW_TOKEN_DEFAULT_TTL_DAYS).toBe(365);
    expect(NEW_TOKEN_MAX_TTL_DAYS).toBe(365);
  });

  it("treats omit/null/permanent as absent", () => {
    expect(isAbsentExpiry(null)).toBe(true);
    expect(isAbsentExpiry(undefined)).toBe(true);
    expect(isAbsentExpiry("")).toBe(true);
    expect(isAbsentExpiry("permanent")).toBe(true);
    expect(isAbsentExpiry("2026-12-01")).toBe(false);
  });

  it("parses date-only as UTC end of day", () => {
    expect(effectiveExpiryMs("2026-11-01")).toBe(Date.parse("2026-11-01T23:59:59.999Z"));
  });

  it("normalize rejects past and >365 days", () => {
    expect(() => normalizeNewTokenExpiry("2020-01-01T00:00:00.000Z")).toThrow(TokenExpiryPolicyError);
    const tooFar = new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => normalizeNewTokenExpiry(tooFar)).toThrow(TokenExpiryPolicyError);
  });

  it("assertStrictExtension blocks shortening a live expiry", () => {
    const now = Date.now();
    const oldIso = new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString();
    const shorter = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => assertStrictExtension(oldIso, shorter, now)).toThrow(TokenExpiryPolicyError);
  });

  it("assertStrictExtension allows any future after Proxy-expired old value", () => {
    const now = Date.now();
    const future = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => assertStrictExtension("2020-01-01T00:00:00.000Z", future, now)).not.toThrow();
  });

  it("resolves expires_in from a fixed t0 and rejects conflicts", () => {
    const t0 = Date.parse("2026-06-15T08:00:00.000Z");
    const expected = normalizeNewTokenExpiry(presetExpiryDateString(365, t0), t0);
    expect(resolveIssuedTokenExpiry(undefined, "365d", t0)).toBe(expected);
    expect(resolveIssuedTokenExpiry(expected, "365d", t0)).toBe(expected);
    expect(() => resolveIssuedTokenExpiry(undefined, "7d", t0)).toThrow(TokenExpiryPolicyError);
    try {
      resolveIssuedTokenExpiry(undefined, "7d", t0);
    } catch (error) {
      expect((error as TokenExpiryPolicyError).code).toBe("EXPIRES_IN_INVALID");
    }
    expect(() => resolveIssuedTokenExpiry(expected, "30d", t0)).toThrow(TokenExpiryPolicyError);
    try {
      resolveIssuedTokenExpiry(expected, "30d", t0);
    } catch (error) {
      expect((error as TokenExpiryPolicyError).code).toBe("EXPIRES_CONFLICT");
    }
    expect(() => resolveIssuedTokenExpiry(undefined, undefined, t0)).toThrow(TokenExpiryPolicyError);
  });

  it("assertStrictExtension allows first finite expiry from absent", () => {
    const now = Date.now();
    const future = new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(() => assertStrictExtension(null, future, now)).not.toThrow();
  });
});
