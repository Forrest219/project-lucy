/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: startup initialization.
 *
 * The notifier is optional: a failure here never changes how the server starts,
 * how login works, or what the audit ledger records (Spec D01).
 */

import { ensureNotificationOutbox, registerNotificationAuditSchema } from "./outbox.js";
import { startNotificationHealthEvents } from "./health-events.js";
import { getSmtpRuntimeView } from "./runtime.js";

export async function initNotifications(): Promise<void> {
  try {
    // The outbox table exists even when notifications are off: an existing
    // deployment must not change behaviour, it only gains an empty table
    // (Spec §10.2.2).
    await ensureNotificationOutbox();
  } catch (error) {
    console.warn(
      "[notifications] the outbox table could not be created:",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    // The audit schema version registration is startup-only metadata. It must
    // not sit on the enqueue path (it would take a write lock on audit.sqlite
    // for every notification), and its failure cannot disable the notifier:
    // the outbox keeps working without the registration row.
    await registerNotificationAuditSchema();
  } catch (error) {
    console.warn(
      "[notifications] the audit schema version could not be registered:",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const view = await getSmtpRuntimeView();
    if (!view.enabled || view.state !== "ok") {
      // Disabled or unavailable: no worker task, no outbound connection.
      return;
    }
    startNotificationHealthEvents();
  } catch (error) {
    console.warn(
      "[notifications] initialization failed; notifications stay unavailable:",
      error instanceof Error ? error.message : String(error)
    );
  }
}
