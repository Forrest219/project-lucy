/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the audit-health event adapter.
 *
 * The adapter sits between the ledger health module and the outbox. It is
 * synchronous and side-effect free from the ledger's point of view: the ledger
 * hands over a transition, and the adapter only submits an in-memory task. The
 * outbox write happens afterwards and its failure is a NOTIFIER failure — the
 * original audit result never changes (Spec §4.1 / §5.3).
 */

import { onAuditHealthTransition, type AuditHealthTransition } from "../proxy/audit-write-health.js";
import { enqueueNotification, hasPersistedIncident } from "./outbox.js";
import { getSmtpRuntimeView } from "./runtime.js";
import { recordNotifierFailure } from "./state.js";

let unsubscribe: (() => void) | null = null;

async function handleTransition(transition: AuditHealthTransition): Promise<void> {
  const view = await getSmtpRuntimeView();
  if (!view.enabled || view.state !== "ok" || !view.profile) return;
  if (view.profile.notifications.auditHealth !== true) return;

  if (transition.eventType === "audit_ledger_recovered") {
    // A recovery without a persisted incident would be noise: the incident mail
    // may itself have failed to enqueue (Spec §4.1 / SMTP-09).
    const persisted = await hasPersistedIncident(transition.incidentId, "audit_ledger_unavailable");
    if (!persisted) return;
  }

  const result = await enqueueNotification({
    eventType: transition.eventType,
    incidentId: transition.incidentId,
    payload: {
      eventType: transition.eventType,
      incidentId: transition.incidentId,
      observedAt: transition.observedAt
    },
    recipients: view.profile.recipients
  });

  if (!result.ok) {
    // Only the notifier failed. The audit result stands.
    recordNotifierFailure(result.reason);
  }
}

/**
 * Subscribe the notifier to ledger incidents. Safe to call once at startup; a
 * second call replaces the previous subscription instead of stacking listeners.
 */
export function startNotificationHealthEvents(): void {
  if (unsubscribe) return;
  unsubscribe = onAuditHealthTransition((transition) => {
    // Fire and forget: the ledger path must never await I/O.
    void handleTransition(transition);
  });
}

export function stopNotificationHealthEvents(): void {
  unsubscribe?.();
  unsubscribe = null;
}
