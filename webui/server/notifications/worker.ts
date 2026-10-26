/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the outbox worker.
 *
 * The worker is the only thing that turns a queued row into an SMTP attempt.
 * Its contract (Spec §5.2 / §6):
 *
 * - **single worker, single message in flight** — one row is sent at a time;
 * - **bounded everywhere** — 5 second poll, at most 20 rows per batch, connect
 *   10s / total send 20s, at most 8 attempts, a bounded backoff ladder, and a
 *   bounded retention cleanup;
 * - **at-least-once** — the row is marked `sent` only after the SMTP server
 *   accepted the message. A crash between the acceptance and the commit makes
 *   the lease expire and the row is sent again: a duplicate is possible and is
 *   the documented delivery semantics (D04), not a bug;
 * - **the queue never blocks the business** — a failing SMTP server only
 *   produces `dead` rows and a closed error code.
 */

import { getAuditDb } from "../admin/audit.js";
import { loadBrandingConfig, effectiveProductTitle } from "../branding.js";
import {
  cleanupNotificationRetention,
  markExpiredNotificationsDead,
  NOTIFICATION_BACKOFF_MS,
  NOTIFICATION_CLAIM_BATCH_LIMIT,
  NOTIFICATION_MAX_ATTEMPTS,
  type NotificationRow
} from "./outbox.js";
import { getSmtpRuntimeView, type SmtpRuntimeView } from "./runtime.js";
import { sendSmtpMessage, type SmtpSender } from "./smtp-client.js";
import { recordNotifierFailure } from "./state.js";
import { renderNotificationTemplate, type NotificationTemplateEvent } from "./template.js";

/** The poll interval (Spec §5.2). */
export const NOTIFICATION_POLL_INTERVAL_MS = 5_000;
/**
 * The sending lease. It has to outlast the bounded send (20s) so that a live
 * row is never stolen from the worker that is sending it.
 */
export const NOTIFICATION_LEASE_MS = 60_000;
/** The retention cleanup runs at most this often. */
export const NOTIFICATION_RETENTION_INTERVAL_MS = 10 * 60 * 1000;
/** The instance display name is re-read at most this often. */
const INSTANCE_NAME_TTL_MS = 5 * 60 * 1000;

type WorkerPassResult = {
  claimed: number;
  sent: number;
  retried: number;
  dead: number;
  skipped: boolean;
};

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRetentionAt = 0;
let cachedInstanceName: { value: string; at: number } | null = null;

function parsePayload(raw: string): { event: NotificationTemplateEvent; observedAt: string; incidentId: string | null } | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const event = parsed.eventType;
    if (event !== "audit_ledger_unavailable" && event !== "audit_ledger_recovered" && event !== "smtp_test") {
      return null;
    }
    const observedAt = typeof parsed.observedAt === "string" ? parsed.observedAt : new Date().toISOString();
    const incidentId = typeof parsed.incidentId === "string" ? parsed.incidentId : null;
    return { event, observedAt, incidentId };
  } catch {
    return null;
  }
}

function parseRecipients(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

/**
 * The instance display name, when the branding configuration can provide one.
 * A missing or unreadable branding file is not an error: the mail simply
 * carries no display name.
 */
async function instanceDisplayName(): Promise<string> {
  const now = Date.now();
  if (cachedInstanceName && now - cachedInstanceName.at < INSTANCE_NAME_TTL_MS) {
    return cachedInstanceName.value;
  }
  let value = "";
  try {
    value = effectiveProductTitle(await loadBrandingConfig());
  } catch {
    value = "";
  }
  cachedInstanceName = { value, at: now };
  return value;
}

/**
 * Claim the due rows in one transaction. A row is due when it is `queued` and
 * its next attempt time has come, or when it is `sending` with an expired
 * lease (the worker crashed while sending it). Expired rows are never claimed.
 */
export async function claimDueNotifications(now: Date = new Date()): Promise<NotificationRow[]> {
  const db = await getAuditDb();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + NOTIFICATION_LEASE_MS).toISOString();

  const claim = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT * FROM notification_outbox
          WHERE expires_at > ?
            AND (
              (status = 'queued' AND next_attempt_at <= ?)
              OR (status = 'sending' AND lease_until IS NOT NULL AND lease_until <= ?)
            )
          ORDER BY next_attempt_at ASC, id ASC
          LIMIT ?`
      )
      .all(nowIso, nowIso, nowIso, NOTIFICATION_CLAIM_BATCH_LIMIT) as NotificationRow[];

    const take = db.prepare(
      `UPDATE notification_outbox
          SET status = 'sending', attempts = attempts + 1, lease_until = ?, updated_at = ?
        WHERE id = ?`
    );
    const claimed: NotificationRow[] = [];
    for (const row of rows) {
      take.run(leaseUntil, nowIso, row.id);
      claimed.push({ ...row, status: "sending", attempts: row.attempts + 1, lease_until: leaseUntil });
    }
    return claimed;
  });

  return claim();
}

async function markSent(id: number, now: Date): Promise<void> {
  const db = await getAuditDb();
  db.prepare(
    `UPDATE notification_outbox
        SET status = 'sent', lease_until = NULL, updated_at = ?, last_error_code = NULL
      WHERE id = ?`
  ).run(now.toISOString(), id);
}

async function markRetry(id: number, errorCode: string, nextAttemptAt: Date, now: Date): Promise<void> {
  const db = await getAuditDb();
  db.prepare(
    `UPDATE notification_outbox
        SET status = 'queued', next_attempt_at = ?, lease_until = NULL, updated_at = ?, last_error_code = ?
      WHERE id = ?`
  ).run(nextAttemptAt.toISOString(), now.toISOString(), errorCode, id);
}

async function markDead(id: number, errorCode: string, now: Date): Promise<void> {
  const db = await getAuditDb();
  db.prepare(
    `UPDATE notification_outbox
        SET status = 'dead', lease_until = NULL, updated_at = ?, last_error_code = ?
      WHERE id = ?`
  ).run(now.toISOString(), errorCode, id);
}

/** Deliver one claimed row. Returns what happened to it. */
async function deliverRow(
  view: SmtpRuntimeView,
  row: NotificationRow,
  now: Date,
  sender: SmtpSender
): Promise<"sent" | "retried" | "dead"> {
  const payload = parsePayload(row.payload_json);
  const recipients = parseRecipients(row.recipients_json);
  if (!payload || recipients.length === 0) {
    await markDead(row.id, "invalid_payload", now);
    return "dead";
  }

  const template = renderNotificationTemplate({
    event: payload.event,
    instanceName: await instanceDisplayName(),
    observedAt: payload.observedAt,
    incidentId: payload.incidentId
  });

  const outcome = await sender(view, {
    // The visible recipient is the from address; the real recipients only ever
    // appear in Bcc, so they cannot see each other (Spec §4.3).
    from: view.profile?.from ?? "",
    to: view.profile?.from ?? "",
    bcc: recipients,
    subject: template.subject,
    text: template.text
  });

  if (outcome.ok) {
    await markSent(row.id, now);
    return "sent";
  }

  recordNotifierFailure(outcome.reason);

  const expired = now.getTime() >= Date.parse(row.expires_at);
  if (expired) {
    await markDead(row.id, "expired", now);
    return "dead";
  }
  if (outcome.permanent || row.attempts >= NOTIFICATION_MAX_ATTEMPTS) {
    await markDead(row.id, outcome.reason, now);
    return "dead";
  }

  const ladderIndex = Math.min(Math.max(row.attempts - 1, 0), NOTIFICATION_BACKOFF_MS.length - 1);
  const backoff = NOTIFICATION_BACKOFF_MS[ladderIndex];
  await markRetry(row.id, outcome.reason, new Date(now.getTime() + backoff), now);
  return "retried";
}

/**
 * One worker pass: expire, claim, deliver (one message at a time), and — at
 * most every ten minutes — run the bounded retention cleanup.
 */
export async function runNotificationWorkerPass(
  now: Date = new Date(),
  sender: SmtpSender = sendSmtpMessage
): Promise<WorkerPassResult> {
  const view = await getSmtpRuntimeView();
  if (!view.enabled || view.state !== "ok" || !view.profile) {
    // Disabled or unavailable: no delivery, and the queued rows stay queued
    // until the configuration is fixed and the server restarted (Spec §5.3).
    return { claimed: 0, sent: 0, retried: 0, dead: 0, skipped: true };
  }

  await markExpiredNotificationsDead(now);
  const rows = await claimDueNotifications(now);

  let sent = 0;
  let retried = 0;
  let dead = 0;
  for (const row of rows) {
    const outcome = await deliverRow(view, row, now, sender);
    if (outcome === "sent") sent += 1;
    else if (outcome === "retried") retried += 1;
    else dead += 1;
  }

  const nowMs = now.getTime();
  if (nowMs - lastRetentionAt >= NOTIFICATION_RETENTION_INTERVAL_MS) {
    lastRetentionAt = nowMs;
    await cleanupNotificationRetention(now);
  }

  return { claimed: rows.length, sent, retried, dead, skipped: false };
}

/**
 * Start the worker. The timer is `unref`'d so it never keeps the process
 * alive, and a second call replaces the previous timer instead of stacking
 * two workers on the same rows.
 */
export function startNotificationWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return; // never overlap two passes
    running = true;
    void runNotificationWorkerPass()
      .catch(() => recordNotifierFailure("store_unavailable"))
      .finally(() => {
        running = false;
      });
  }, NOTIFICATION_POLL_INTERVAL_MS);
  timer.unref();
}

export function stopNotificationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

/** Test-only reset; production callers cannot hide a stuck worker. */
export function resetNotificationWorkerForTests(): void {
  stopNotificationWorker();
  lastRetentionAt = 0;
  cachedInstanceName = null;
}
