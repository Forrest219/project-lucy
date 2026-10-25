/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the owner-only status endpoint.
 *
 * Only the status endpoint exists in this stage. The test-email endpoint needs
 * the SMTP client and lands with the worker stage (Spec §12 S2).
 *
 * The status NEVER returns the host, the username, the from address, the
 * recipient list, or any secret (Spec §3.2 / §7).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireOwner } from "../auth/guard.js";
import { countNotifications } from "../notifications/outbox.js";
import { getSmtpRuntimeView, smtpRuntimeStatus } from "../notifications/runtime.js";
import { getLastNotifierErrorCode } from "../notifications/state.js";

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get("/api/admin/notifications/status", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireOwner(request, reply, "仅所有者可管理邮件通知"))) return;
    const view = await getSmtpRuntimeView();
    const queue = await countNotifications();
    return reply.send({
      ok: true,
      ...smtpRuntimeStatus(view),
      queue,
      lastErrorCode: getLastNotifierErrorCode()
    });
  });
}
