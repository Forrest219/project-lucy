/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the owner-only notification APIs.
 *
 * Three endpoints, all owner-only and none of them in the public API
 * whitelist (Spec §7):
 *
 * - `GET  /api/admin/notifications/status` — the redacted runtime status;
 * - `POST /api/admin/notifications/test`   — queue a test mail (202 queued);
 * - `GET  /api/admin/notifications/:id`    — one row's state.
 *
 * The status NEVER returns the host, the username, the from address, the
 * recipient list, or any secret (Spec §3.2 / §7).
 *
 * Two different 503 codes exist and they are not interchangeable (F-15):
 * `NOTIFICATION_UNAVAILABLE` means the configuration cannot send at all;
 * `NOTIFICATION_QUEUE_UNAVAILABLE` means the configuration is fine but the
 * queue cannot take the row right now.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireOwner } from "../auth/guard.js";
import {
  countNotifications,
  enqueueNotification,
  readNotificationById
} from "../notifications/outbox.js";
import { getSmtpRuntimeView, smtpRuntimeStatus } from "../notifications/runtime.js";
import { getLastNotifierErrorCode } from "../notifications/state.js";

const OWNER_MESSAGE = "仅所有者可管理邮件通知";

export function registerNotificationRoutes(app: FastifyInstance): void {
  app.get("/api/admin/notifications/status", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireOwner(request, reply, OWNER_MESSAGE))) return;
    const view = await getSmtpRuntimeView();
    const queue = await countNotifications();
    return reply.send({
      ok: true,
      ...smtpRuntimeStatus(view),
      queue,
      lastErrorCode: getLastNotifierErrorCode()
    });
  });

  /**
   * Queue a test mail. The request never waits for SMTP: 202 means the row is
   * in the queue, NOT that the mail was sent (Spec §4.2 / §9).
   */
  app.post("/api/admin/notifications/test", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireOwner(request, reply, OWNER_MESSAGE))) return;

    const view = await getSmtpRuntimeView();
    if (!view.enabled || view.state !== "ok" || !view.profile) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "NOTIFICATION_UNAVAILABLE",
          message: "邮件通知当前不可用，请检查通知配置后重启"
        }
      });
    }

    const observedAt = new Date().toISOString();
    const result = await enqueueNotification({
      eventType: "smtp_test",
      incidentId: null,
      payload: { eventType: "smtp_test", incidentId: null, observedAt },
      recipients: view.profile.recipients,
      now: new Date(observedAt)
    });

    if (!result.ok) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "NOTIFICATION_QUEUE_UNAVAILABLE",
          message: "通知队列暂不可用，请稍后重试"
        }
      });
    }

    return reply.status(202).send({
      ok: true,
      notificationId: result.id,
      status: "queued",
      message: "测试邮件已加入发送队列"
    });
  });

  /**
   * One notification row. The payload and the recipient list are never
   * returned — only the state (Spec §7).
   */
  app.get("/api/admin/notifications/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!(await requireOwner(request, reply, OWNER_MESSAGE))) return;

    const raw = (request.params as { id?: string }).id ?? "";
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOTIFICATION_NOT_FOUND", message: "未找到该通知记录" }
      });
    }

    const row = await readNotificationById(id);
    if (!row) {
      return reply.status(404).send({
        ok: false,
        error: { code: "NOTIFICATION_NOT_FOUND", message: "未找到该通知记录" }
      });
    }

    return reply.send({
      ok: true,
      notification: {
        id: row.id,
        eventType: row.event_type,
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastErrorCode: row.last_error_code
      }
    });
  });
}
