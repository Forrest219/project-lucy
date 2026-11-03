/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the notifier's own failure state.
 *
 * A notifier failure is NOT an audit failure: it never changes what the audit
 * ledger recorded, and it never fails a request. It is surfaced through the
 * owner-only status endpoint as a closed error code (Spec §4.1 / §5.3).
 */

/**
 * The notifier's own closed error codes. They are surfaced through the
 * owner-only status endpoint and stored on the outbox row; the raw reason
 * never reaches the API or the logs (Spec §4.1 / §5.3).
 *
 * The `smtp_*` transport codes come from `smtp-client.ts`; they are the only
 * codes a failed delivery can produce, and the SMTP server's raw response is
 * never one of them.
 */
export const NOTIFIER_ERROR_CODES = [
  "queue_full",
  "store_unavailable",
  "invalid_payload",
  "smtp_profile_invalid",
  "smtp_secret_unavailable",
  "smtp_ca_unavailable",
  "smtp_auth_incomplete",
  "smtp_unreachable",
  "smtp_timeout",
  "smtp_tls_failed",
  "smtp_auth_failed",
  "smtp_rejected",
  "smtp_failed"
] as const;

export type NotifierErrorCode = (typeof NOTIFIER_ERROR_CODES)[number];

let lastErrorCode: NotifierErrorCode | null = null;

export function recordNotifierFailure(code: NotifierErrorCode): void {
  lastErrorCode = code;
}

export function getLastNotifierErrorCode(): NotifierErrorCode | null {
  return lastErrorCode;
}

export function resetNotifierStateForTests(): void {
  lastErrorCode = null;
}
