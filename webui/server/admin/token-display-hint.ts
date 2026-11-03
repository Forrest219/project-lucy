/**
 * Spec lucy-20261102-token-display-hint — fixed plaintext truncation for
 * human verification. Never used for auth or audit correlation.
 */

/** Unicode ellipsis — required by the token_hint contract. */
export const TOKEN_HINT_ELLIPSIS = "…";

const PLAIN_TOKEN_RE = /^[0-9a-f]{64}$/;
const TOKEN_HINT_RE = /^[0-9a-f]{6}…[0-9a-f]{4}$/;

export function buildTokenDisplayHint(plainToken: string): string {
  if (!PLAIN_TOKEN_RE.test(plainToken)) {
    throw new Error("plain token must be 64 lowercase hex characters");
  }
  return `${plainToken.slice(0, 6)}${TOKEN_HINT_ELLIPSIS}${plainToken.slice(-4)}`;
}

export function isValidTokenDisplayHint(value: unknown): value is string {
  return typeof value === "string" && TOKEN_HINT_RE.test(value);
}
