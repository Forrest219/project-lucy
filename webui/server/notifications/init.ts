/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: startup initialization.
 *
 * The notifier is optional: a failure here never changes how the server starts,
 * how login works, or what the audit ledger records (Spec D01).
 */

import { ensureNotificationOutbox } from "./outbox.js";
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
