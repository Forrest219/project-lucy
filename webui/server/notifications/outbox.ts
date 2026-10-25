/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the durable outbox.
 *
 * The outbox lives in the existing `.ktx-ui/audit.sqlite`, NOT in the canonical
 * security ledger: a broken security store must not systematically disable the
 * audit-health alert (Spec F-06). The table is created by the notifier's OWN
 * initialization path (Spec F-14), because the audit store keeps two independent
 * connection handles and neither of them is guaranteed to have run yet.
 *
 * The outbox is not an audit source of truth: it records what SHOULD be sent,
 * not what happened. `queued` never means delivered (Spec D04).
 */

import { randomUUID } from "node:crypto";
import { getAuditDb } from "../admin/audit.js";

export type NotificationEventType =
  | "audit_ledger_unavailable"
  | "audit_ledger_recovered"
  | "smtp_test";

export type NotificationRowStatus = "queued" | "sending" | "sent" | "dead";

export const NOTIFICATION_PENDING_LIMIT = 1000;
export const NOTIFICATION_MAX_ATTEMPTS = 8;
export const NOTIFICATION_CLAIM_BATCH_LIMIT = 20;
export const NOTIFICATION_PAYLOAD_MAX_BYTES = 4 * 1024;
export const NOTIFICATION_RECIPIENTS_MAX_BYTES = 8 * 1024;
export const NOTIFICATION_MAX_RECIPIENTS = 20;
export const NOTIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTIFICATION_DEAD_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Bounded backoff, in order: 1m / 5m / 15m / 1h / 4h / 8h / 12h / 24h. */
export const NOTIFICATION_BACKOFF_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
  12 * 60 * 60_000,
  24 * 60 * 60_000
];

export type EnqueueResult =
  | { ok: true; id: number; duplicate: boolean }
  | { ok: false; reason: "queue_full" | "invalid_payload" | "store_unavailable" };

export type NotificationCounts = {
  queued: number;
  sending: number;
  sent: number;
  dead: number;
  pending: number;
};

export type NotificationRow = {
  id: number;
  event_type: NotificationEventType;
  incident_id: string | null;
  status: NotificationRowStatus;
  attempts: number;
  next_attempt_at: string;
  lease_until: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  last_error_code: string | null;
};

/**
 * Create the outbox table and its indexes. Idempotent, and called by the
 * notifier's own startup path so the table exists before the first write.
 */
export async function ensureNotificationOutbox(): Promise<void> {
  const db = await getAuditDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      dedup_key       TEXT    NOT NULL UNIQUE,
      event_type      TEXT    NOT NULL,
      incident_id     TEXT,
      payload_json    TEXT    NOT NULL,
      recipients_json TEXT    NOT NULL,
      status          TEXT    NOT NULL,
      attempts        INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT    NOT NULL,
      lease_until     TEXT,
      expires_at      TEXT    NOT NULL,
      created_at      TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL,
      last_error_code TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_due
      ON notification_outbox(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_notification_outbox_incident
      ON notification_outbox(incident_id, event_type);
  `);
}

export function notificationDedupKey(eventType: NotificationEventType, incidentId: string | null): string {
  return incidentId ? `${incidentId}:${eventType}` : `${eventType}:${randomUUID()}`;
}

/**
 * Enqueue one notification. The caller never awaits SMTP I/O here: the row is
 * written to the outbox and a background worker delivers it (Spec D04).
 */
export async function enqueueNotification(input: {
  eventType: NotificationEventType;
  incidentId?: string | null;
  payload: Record<string, unknown>;
  recipients: string[];
  dedupKey?: string;
  now?: Date;
}): Promise<EnqueueResult> {
  const payloadJson = JSON.stringify(input.payload ?? {});
  const recipientsJson = JSON.stringify(input.recipients ?? []);
  if (Buffer.byteLength(payloadJson, "utf8") > NOTIFICATION_PAYLOAD_MAX_BYTES) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (Buffer.byteLength(recipientsJson, "utf8") > NOTIFICATION_RECIPIENTS_MAX_BYTES) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (input.recipients.length > NOTIFICATION_MAX_RECIPIENTS) {
    return { ok: false, reason: "invalid_payload" };
  }

  try {
    await ensureNotificationOutbox();
    const db = await getAuditDb();
    const counts = await countNotifications();
    if (counts.pending >= NOTIFICATION_PENDING_LIMIT) {
      // The queue is bounded: a new event is dropped, and the main business is
      // never blocked by it.
      return { ok: false, reason: "queue_full" };
    }

    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const dedupKey = input.dedupKey ?? notificationDedupKey(input.eventType, input.incidentId ?? null);
    const expiresAt = new Date(now.getTime() + NOTIFICATION_TTL_MS).toISOString();

    const result = db
      .prepare(
        `INSERT OR IGNORE INTO notification_outbox
           (dedup_key, event_type, incident_id, payload_json, recipients_json, status,
            attempts, next_attempt_at, lease_until, expires_at, created_at, updated_at, last_error_code)
         VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, NULL, ?, ?, ?, NULL)`
      )
      .run(
        dedupKey,
        input.eventType,
        input.incidentId ?? null,
        payloadJson,
        recipientsJson,
        nowIso,
        expiresAt,
        nowIso,
        nowIso
      );

    if (result.changes > 0) {
      return { ok: true, id: Number(result.lastInsertRowid), duplicate: false };
    }
    const existing = db
      .prepare("SELECT id FROM notification_outbox WHERE dedup_key = ?")
      .get(dedupKey) as { id: number } | undefined;
    return { ok: true, id: existing?.id ?? 0, duplicate: true };
  } catch {
    // The outbox is unavailable: the caller reports a notifier failure only.
    return { ok: false, reason: "store_unavailable" };
  }
}

export async function countNotifications(): Promise<NotificationCounts> {
  const counts: NotificationCounts = { queued: 0, sending: 0, sent: 0, dead: 0, pending: 0 };
  try {
    const db = await getAuditDb();
    const rows = db.prepare("SELECT status FROM notification_outbox").all() as {
      status: NotificationRowStatus;
    }[];
    for (const row of rows) {
      if (row.status === "queued") counts.queued += 1;
      else if (row.status === "sending") counts.sending += 1;
      else if (row.status === "sent") counts.sent += 1;
      else if (row.status === "dead") counts.dead += 1;
    }
  } catch {
    return counts;
  }
  counts.pending = counts.queued + counts.sending;
  return counts;
}

/**
 * The recovery event may only be enqueued when the matching incident row was
 * actually persisted: a recovery without an incident would be noise (Spec §4.1).
 */
export async function hasPersistedIncident(incidentId: string, eventType: NotificationEventType): Promise<boolean> {
  try {
    const db = await getAuditDb();
    const row = db
      .prepare("SELECT id FROM notification_outbox WHERE incident_id = ? AND event_type = ? LIMIT 1")
      .get(incidentId, eventType);
    return Boolean(row);
  } catch {
    return false;
  }
}

/** Expired rows are never delivered: they become `dead` with reason `expired`. */
export async function markExpiredNotificationsDead(now: Date = new Date()): Promise<number> {
  try {
    const db = await getAuditDb();
    const result = db
      .prepare(
        `UPDATE notification_outbox
            SET status = 'dead', last_error_code = 'expired', updated_at = ?
          WHERE status IN ('queued', 'sending') AND expires_at <= ?`
      )
      .run(now.toISOString(), now.toISOString());
    return Number(result.changes);
  } catch {
    return 0;
  }
}

/** Bounded retention cleanup: sent rows keep 7 days, dead rows keep 30 days. */
export async function cleanupNotificationRetention(now: Date = new Date()): Promise<number> {
  try {
    const db = await getAuditDb();
    const sentBefore = new Date(now.getTime() - NOTIFICATION_SENT_RETENTION_MS).toISOString();
    const deadBefore = new Date(now.getTime() - NOTIFICATION_DEAD_RETENTION_MS).toISOString();
    const result = db
      .prepare(
        `DELETE FROM notification_outbox
          WHERE (status = 'sent' AND updated_at <= ?)
             OR (status = 'dead' AND updated_at <= ?)`
      )
      .run(sentBefore, deadBefore);
    return Number(result.changes);
  } catch {
    return 0;
  }
}
