/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the notifier's own failure state.
 *
 * A notifier failure is NOT an audit failure: it never changes what the audit
 * ledger recorded, and it never fails a request. It is surfaced through the
 * owner-only status endpoint as a closed error code (Spec §4.1 / §5.3).
 */

export const NOTIFIER_ERROR_CODES = [
  "queue_full",
  "store_unavailable",
  "invalid_payload",
  "smtp_profile_invalid",
  "smtp_secret_unavailable",
  "smtp_ca_unavailable",
  "smtp_auth_incomplete"
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
