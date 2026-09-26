import { normalizeExpiresAtInput } from "../proxy/identity.js";

export const NEW_TOKEN_DEFAULT_TTL_DAYS = 90;
export const NEW_TOKEN_MAX_TTL_DAYS = 365;

export class TokenExpiryPolicyError extends Error {
  readonly code: "EXPIRES_AT_REQUIRED" | "EXPIRES_AT_INVALID" | "EXPIRES_AT_TOO_FAR";

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
