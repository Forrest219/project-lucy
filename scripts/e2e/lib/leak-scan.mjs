// Output leakage scanner (Spec §7 SEC-17, §6.2). A hit never contains the matched secret: only its kind
// and a short digest, so scan results themselves are safe to keep as artifacts.

import { createHash } from "node:crypto";

const GENERIC_PATTERNS = [
  { kind: "scrypt-password-hash", re: /scrypt:[0-9a-f]{16,}:[0-9a-f]{32,}/g },
  // A masked `password_hash: [REDACTED]` line in a diff is the intended output; only a concrete value is a leak.
  { kind: "password-hash-value", re: /password_hash["']?\s*[:=]\s*(?!\[?REDACTED\]?|\*+|null\b|""|'')[^\s,}]+/gi },
  { kind: "bearer-token", re: /Bearer\s+lucy_[A-Za-z0-9_-]{16,}/g },
  { kind: "lucy-token", re: /lucy_(?:e2e_)?[a-f0-9]{32,}/g }
];

const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 10);

/**
 * @param {string} text
 * @param {{ secrets?: string[], forbiddenCanaries?: string[] }} options
 *   secrets: exact credential values that must never appear (tokens, passwords, bootstrap key)
 *   forbiddenCanaries: out-of-domain canaries for the identity under test
 */
export function scanText(text, { secrets = [], forbiddenCanaries = [] } = {}) {
  const hits = [];
  for (const secret of secrets) {
    if (secret && text.includes(secret)) hits.push({ kind: "exact-secret", digest: digest(secret) });
  }
  for (const canary of forbiddenCanaries) {
    if (canary && text.includes(canary)) hits.push({ kind: "forbidden-canary", digest: digest(canary) });
  }
  for (const { kind, re } of GENERIC_PATTERNS) {
    re.lastIndex = 0;
    const match = re.exec(text);
    if (match) hits.push({ kind, digest: digest(match[0]) });
  }
  return hits;
}

export function scanMany(texts, options) {
  const hits = texts.flatMap((text) => scanText(String(text ?? ""), options));
  return { scanned: true, hits: hits.length, detail: hits };
}
