import { isTokenExpired, normalizeExpiresAtInput } from "../proxy/identity.js";

export const NEW_TOKEN_DEFAULT_TTL_DAYS = 365;
export const NEW_TOKEN_MAX_TTL_DAYS = 365;

export class TokenExpiryPolicyError extends Error {
  readonly code:
    | "EXPIRES_AT_REQUIRED"
    | "EXPIRES_AT_INVALID"
    | "EXPIRES_AT_TOO_FAR"
    | "EXPIRES_AT_NOT_EXTENDED";

  constructor(code: TokenExpiryPolicyError["code"], message: string) {
    super(message);
    this.name = "TokenExpiryPolicyError";
    this.code = code;
  }
}

function maxExpiryAt(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + NEW_TOKEN_MAX_TTL_DAYS,
    23,
    59,
    59,
    999
  );
}

/** True when YAML has no finite expiry (omit / null / empty / permanent aliases). */
export function isAbsentExpiry(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return /^(never|none|null|permanent)$/i.test(trimmed);
}

/**
 * Effective end timestamp aligned with Proxy `isTokenExpired` parsing.
 * Returns null for ABSENT (never expires). Throws on unparseable non-absent values.
 */
export function effectiveExpiryMs(raw: unknown): number | null {
  if (isAbsentExpiry(raw)) return null;
  if (raw instanceof Date) {
    const ts = raw.getTime();
    if (Number.isNaN(ts)) {
      throw new TokenExpiryPolicyError("EXPIRES_AT_INVALID", "expires_at is unparseable");
    }
    return ts;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) {
      throw new TokenExpiryPolicyError("EXPIRES_AT_INVALID", "expires_at is unparseable");
    }
    return raw;
  }
  if (typeof raw !== "string") {
    throw new TokenExpiryPolicyError("EXPIRES_AT_INVALID", "expires_at is unparseable");
  }
  const trimmed = raw.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T23:59:59.999Z` : trimmed;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) {
    throw new TokenExpiryPolicyError("EXPIRES_AT_INVALID", "expires_at is unparseable");
  }
  return ts;
}

/** Validate the policy for newly issued Token credentials. Legacy null expiries remain readable. */
export function normalizeNewTokenExpiry(raw: unknown, nowMs = Date.now()): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new TokenExpiryPolicyError("EXPIRES_AT_REQUIRED", "expires_at is required for new tokens");
  }

  let normalized: string | null;
  try {
    normalized = normalizeExpiresAtInput(raw.trim());
  } catch {
    throw new TokenExpiryPolicyError(
      "EXPIRES_AT_INVALID",
      "expires_at must be a valid future ISO-8601 timestamp or YYYY-MM-DD date"
    );
  }

  const expiresAtMs = normalized ? Date.parse(normalized) : Number.NaN;
  if (!normalized || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new TokenExpiryPolicyError("EXPIRES_AT_INVALID", "expires_at must be later than the current time");
  }
  if (expiresAtMs > maxExpiryAt(nowMs)) {
    throw new TokenExpiryPolicyError(
      "EXPIRES_AT_TOO_FAR",
      `expires_at must be within ${NEW_TOKEN_MAX_TTL_DAYS} calendar days`
    );
  }
  return normalized;
}

/** Same bounds as create — used by renew. */
export const normalizeTokenExpiry = normalizeNewTokenExpiry;

/**
 * Ordinary renew: new expiry must strictly extend a still-valid old expiry.
 * Expired or ABSENT old values may take any valid future expiry (still max-bounded by normalize).
 */
export function assertStrictExtension(
  oldExpires: unknown,
  newExpiresIso: string,
  nowMs = Date.now()
): void {
  if (isAbsentExpiry(oldExpires)) return;

  const oldMs = effectiveExpiryMs(oldExpires);
  if (oldMs == null) return;

  if (isTokenExpired(oldExpires as string | number | Date | null | undefined, nowMs)) {
    return;
  }

  const newMs = Date.parse(newExpiresIso);
  if (!Number.isFinite(newMs) || newMs <= oldMs) {
    throw new TokenExpiryPolicyError(
      "EXPIRES_AT_NOT_EXTENDED",
      "expires_at must be strictly later than the current token expiry"
    );
  }
}

export function expiryNormalizedEqual(left: unknown, rightIso: string): boolean {
  if (isAbsentExpiry(left)) return false;
  try {
    const leftMs = effectiveExpiryMs(left);
    const rightMs = Date.parse(rightIso);
    return leftMs != null && Number.isFinite(rightMs) && leftMs === rightMs;
  } catch {
    return false;
  }
}

/** Calendar date string (UTC) for UI presets: today + days. */
export function presetExpiryDateString(days: number, nowMs = Date.now()): string {
  const now = new Date(nowMs);
  const target = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days);
  return new Date(target).toISOString().slice(0, 10);
}
