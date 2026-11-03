/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the fixed mail templates.
 *
 * The mail is a **fixed template plus minimal event metadata** (Spec §4.3 /
 * D09). It carries the instance display name, the event time, a short incident
 * id, the observation boundary and the recovery entry — and nothing else.
 *
 * What must never appear in a body: the SMTP host, the username, the password,
 * the recipient list, the raw error text, the audit diff, any query or table
 * content, any credential or token. There is no HTML body, no attachment and
 * no remote content, so there is no injection surface and nothing to track.
 */

export type NotificationTemplateEvent = "audit_ledger_unavailable" | "audit_ledger_recovered" | "smtp_test";

/** The subject is a closed set: one value per event, never composed. */
export const NOTIFICATION_SUBJECTS: Record<NotificationTemplateEvent, string> = {
  audit_ledger_unavailable: "Lucy 审计账本不可用",
  audit_ledger_recovered: "Lucy 审计账本已恢复",
  smtp_test: "Lucy SMTP 测试邮件"
};

const MAX_INSTANCE_NAME_CHARS = 64;
/** The control characters are stripped, not escaped: a display name is not markup. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export type NotificationTemplateInput = {
  event: NotificationTemplateEvent;
  /** The instance display name; sanitized and length-limited here. */
  instanceName: string;
  /** The ISO timestamp of the observed transition. */
  observedAt: string;
  /** The incident id; only a short prefix is shown. */
  incidentId: string | null;
};

/**
 * Sanitize the instance display name: strip control characters, collapse
 * whitespace and cap the length. A malformed name must never break the mail.
 */
export function sanitizeInstanceName(raw: string): string {
  const cleaned = (raw ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, MAX_INSTANCE_NAME_CHARS).join("");
}

/** Only a short prefix of the incident id is disclosed. */
export function shortIncidentId(incidentId: string | null): string {
  if (!incidentId) return "-";
  return incidentId.replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "-";
}

const OBSERVATION_NOTE = "观测范围：仅当前 Lucy 进程；重启前或其它环境发生的事故不在本次观测范围内。";

const RECOVERY_ENTRY =
  "处理入口：所有者在 Lucy 管理端查看审计健康状态与通知队列（/api/admin/notifications/status）。本邮件只是提醒，不替代审计记录。";

const RECOVERED_NOTE =
  "本邮件只说明账本已恢复；审计记录以 Lucy 内的审计账本为准，不以邮件为准。";

const TEST_NOTE = "这是 Lucy 的 SMTP 测试邮件，用于确认发信链路可用；它不是审计事件。";

/**
 * Render the fixed template. The subject comes from the closed set; the body
 * is plain text built from the four allowed fields and nothing else.
 */
export function renderNotificationTemplate(input: NotificationTemplateInput): {
  subject: string;
  text: string;
} {
  const instanceName = sanitizeInstanceName(input.instanceName);
  const incident = shortIncidentId(input.incidentId);
  const subject = NOTIFICATION_SUBJECTS[input.event];

  const lines: string[] = [];
  if (instanceName) lines.push(instanceName);
  lines.push("");
  lines.push(`事件：${subject}`);
  lines.push(`事件时间：${input.observedAt}`);
  if (input.event !== "smtp_test") {
    lines.push(`事故短 id：${incident}`);
    lines.push(OBSERVATION_NOTE);
    lines.push(input.event === "audit_ledger_recovered" ? RECOVERED_NOTE : RECOVERY_ENTRY);
  } else {
    lines.push(TEST_NOTE);
  }

  return { subject, text: lines.join("\n") };
}
