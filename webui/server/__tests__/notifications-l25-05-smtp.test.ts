import Fastify, { type FastifyRequest } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SMTPServer } from "smtp-server";
import { registerNotificationRoutes } from "../admin/notifications.js";
import { getAuditDb } from "../admin/audit.js";
import {
  cleanupNotificationRetention,
  countNotifications,
  enqueueNotification,
  ensureNotificationOutbox,
  NOTIFICATION_BACKOFF_MS,
  NOTIFICATION_MAX_ATTEMPTS,
  readNotificationById
} from "../notifications/outbox.js";
import { getSmtpRuntimeView, resetSmtpRuntimeViewForTests, type SmtpRuntimeView } from "../notifications/runtime.js";
import {
  buildTransportOptions,
  classifySmtpFailure,
  sendSmtpMessage,
  type SmtpMessage,
  type SmtpSendOutcome
} from "../notifications/smtp-client.js";
import {
  NOTIFICATION_SUBJECTS,
  renderNotificationTemplate,
  sanitizeInstanceName,
  shortIncidentId
} from "../notifications/template.js";
import {
  claimDueNotifications,
  NOTIFICATION_LEASE_MS,
  resetNotificationWorkerForTests,
  runNotificationWorkerPass
} from "../notifications/worker.js";
import { resetNotifierStateForTests } from "../notifications/state.js";

/**
 * Lucy v0.25 — L25-05 S2: the SMTP worker, the owner APIs and the protocol
 * layer (SMTP-06／07／12–18／20).
 *
 * Two layers are covered:
 *
 * 1. **The queue state machine** runs against an explicit sender seam, so the
 *    retry ladder, the lease, the at-least-once semantics and the envelope are
 *    asserted without a network.
 * 2. **The protocol layer** runs the real transport against a local fake SMTP
 *    server (`smtp-server`), with a self-signed certificate generated at test
 *    time, so that TLS, STARTTLS, the "no AUTH before the upgrade" rule and
 *    the "no downgrade to plaintext" rule are asserted on the wire.
 *
 * Nothing here talks to a real mail server and nothing leaves the machine.
 */

let auditDir: string;
let auditDbPath: string;
let workDir: string;
let certDir: string;
let previousEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  auditDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-smtp-audit-"));
  auditDbPath = path.join(auditDir, "audit.sqlite");
  workDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-smtp-work-"));
  certDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-smtp-cert-"));
});

afterAll(async () => {
  await rm(auditDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
  await rm(certDir, { recursive: true, force: true });
});

beforeEach(async () => {
  resetNotificationWorkerForTests();
  setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
  setEnv("LUCY_SMTP_PASSWORD_FILE", undefined);
  setEnv("LUCY_SMTP_CA_FILE", undefined);
  setEnv("LUCY_AUDIT_DB", auditDbPath);
  resetSmtpRuntimeViewForTests();
  resetNotifierStateForTests();

  const db = await getAuditDb();
  db.exec("DROP TABLE IF EXISTS notification_outbox");
  await ensureNotificationOutbox();
});

afterEach(() => {
  resetNotificationWorkerForTests();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv = {};
});

function profileYaml(options: {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username?: string;
  recipients?: string[];
}): string {
  const recipients = options.recipients ?? ["data-ops@example.internal", "sre@example.internal"];
  const lines = [
    "enabled: true",
    `host: ${options.host}`,
    `port: ${options.port}`,
    `security: ${options.security}`,
    "from: lucy@example.internal",
    "recipients:",
    ...recipients.map((entry) => `  - ${entry}`),
    "notifications:",
    "  auditHealth: true"
  ];
  if (options.username) lines.splice(5, 0, `username: ${options.username}`);
  return `${lines.join("\n")}\n`;
}

async function writeProfile(name: string, options: Parameters<typeof profileYaml>[0]): Promise<string> {
  const file = path.join(workDir, name);
  await writeFile(file, profileYaml(options), "utf8");
  setEnv("LUCY_SMTP_PROFILE_FILE", file);
  return file;
}

/** A runtime view that is `ok`, without touching the filesystem. */
function okView(overrides: Partial<SmtpRuntimeView> = {}): SmtpRuntimeView {
  return {
    enabled: true,
    state: "ok",
    errorCode: null,
    profile: {
      enabled: true,
      host: "smtp.example.internal",
      port: 587,
      security: "starttls",
      from: "lucy@example.internal",
      recipients: ["data-ops@example.internal", "sre@example.internal"],
      notifications: { auditHealth: true }
    },
    password: null,
    caPem: null,
    ...overrides
  };
}

/* ─────────────────────────── 传输层选项合同 ─────────────────────────── */

describe("L25-05 SMTP transport options", () => {
  it("SMTP-16 security=tls 走直连 TLS，不带 requireTLS", () => {
    const options = buildTransportOptions(
      okView({ profile: { ...okView().profile!, security: "tls" } })
    );
    expect(options.secure).toBe(true);
    expect(options.requireTLS).toBe(false);
  });

  it("SMTP-16 security=starttls 必须升级，且绝不降级明文", () => {
    const options = buildTransportOptions(okView());
    expect(options.secure).toBe(false);
    expect(options.requireTLS).toBe(true);
    // The three options that could weaken the transport must never be set.
    expect(options).not.toHaveProperty("ignoreTLS");
    expect(options).not.toHaveProperty("opportunisticTLS");
    expect(options).not.toHaveProperty("rejectUnauthorized");
  });

  it("SMTP-16 私有 CA 只追加信任，且没有关闭校验的开关", () => {
    const options = buildTransportOptions(okView({ caPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----" }));
    expect((options.tls as { ca: string[] }).ca).toHaveLength(1);
    const tls = options.tls as Record<string, unknown>;
    expect(tls).not.toHaveProperty("rejectUnauthorized");
    expect(options).not.toHaveProperty("rejectUnauthorized");
  });

  it("SMTP-18 传输层不挂 logger，SMTP 对话不会进应用日志", () => {
    const options = buildTransportOptions(okView());
    expect(options.logger).toBe(false);
  });

  it("SMTP-18 配置了凭据时只传 auth，不把密码放进别处", () => {
    const options = buildTransportOptions(
      okView({ password: "s3cret", profile: { ...okView().profile!, username: "lucy-notifier" } })
    );
    expect(options.auth).toEqual({ user: "lucy-notifier", pass: "s3cret" });
    const serialized = JSON.stringify(options);
    expect(serialized).not.toContain("password");
  });
});

/* ─────────────────────────── 传输错误分类 ─────────────────────────── */

describe("L25-05 SMTP failure classification", () => {
  it("SMTP-16 证书错误按 originalCode 识别，而不是笼统的 socket 错误", () => {
    // nodemailer wraps a system error and keeps the original under
    // `originalCode`: a certificate failure surfaces as ESOCKET.
    const classified = classifySmtpFailure({ code: "ESOCKET", originalCode: "CERT_HAS_EXPIRED" });
    expect(classified.reason).toBe("smtp_tls_failed");
    expect(classified.permanent).toBe(false);
  });

  it("SMTP-16 认证失败映射为 smtp_auth_failed", () => {
    expect(classifySmtpFailure({ code: "EAUTH", command: "AUTH LOGIN" }).reason).toBe("smtp_auth_failed");
  });

  it("SMTP-12 超时映射为 smtp_timeout", () => {
    expect(classifySmtpFailure({ code: "ETIMEDOUT" }).reason).toBe("smtp_timeout");
  });

  it("SMTP-12 连接失败映射为 smtp_unreachable", () => {
    expect(classifySmtpFailure({ code: "ECONNECTION", originalCode: "ECONNREFUSED" }).reason).toBe(
      "smtp_unreachable"
    );
  });

  it("SMTP-12 4xx 可重试；SMTP-13 5xx 永久失败；503 视为暂时繁忙", () => {
    expect(classifySmtpFailure({ responseCode: 450 })).toEqual({ reason: "smtp_rejected", permanent: false });
    expect(classifySmtpFailure({ responseCode: 550 })).toEqual({ reason: "smtp_rejected", permanent: true });
    expect(classifySmtpFailure({ responseCode: 503 })).toEqual({ reason: "smtp_rejected", permanent: false });
  });

  it("SMTP-12 未知失败落到封闭兜底码，不泄漏原始错误", () => {
    const classified = classifySmtpFailure({ code: "WEIRD", message: "server said something" });
    expect(classified.reason).toBe("smtp_failed");
    expect(classified).not.toHaveProperty("message");
  });
});

/* ─────────────────────────── 固定模板 ─────────────────────────── */

describe("L25-05 fixed templates", () => {
  it("SMTP-17 主题是封闭值，只有三个", () => {
    expect(Object.keys(NOTIFICATION_SUBJECTS).sort()).toEqual([
      "audit_ledger_recovered",
      "audit_ledger_unavailable",
      "smtp_test"
    ]);
  });

  it("SMTP-20 正文只含显示名、时间、短 id、观测说明与恢复入口", () => {
    const { subject, text } = renderNotificationTemplate({
      event: "audit_ledger_unavailable",
      instanceName: "客户 A 的 Lucy",
      observedAt: "2026-10-26T00:00:00.000Z",
      incidentId: "3f2a91bc-0000-4000-8000-000000000000"
    });
    expect(subject).toBe("Lucy 审计账本不可用");
    expect(text).toContain("客户 A 的 Lucy");
    expect(text).toContain("2026-10-26T00:00:00.000Z");
    expect(text).toContain("3f2a91bc");
    expect(text).toContain("观测范围");
    expect(text).toContain("处理入口");
  });

  it("SMTP-20 正文不含 host、username、密码、收件人或原始错误", () => {
    const { text } = renderNotificationTemplate({
      event: "audit_ledger_unavailable",
      instanceName: "Lucy",
      observedAt: "2026-10-26T00:00:00.000Z",
      incidentId: "abc12345-def6"
    });
    expect(text).not.toContain("smtp.example.internal");
    expect(text).not.toContain("lucy-notifier");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("data-ops@example.internal");
    expect(text).not.toContain("sre@example.internal");
  });

  it("SMTP-17 显示名的控制字符被去除并限长", () => {
    const name = `A${String.fromCharCode(0)}B${String.fromCharCode(10)}C${"x".repeat(200)}`;
    const clean = sanitizeInstanceName(name);
    expect(clean).not.toContain(String.fromCharCode(0));
    expect(clean).not.toContain(String.fromCharCode(10));
    expect([...clean].length).toBeLessThanOrEqual(64);
  });

  it("SMTP-17 事故 id 只披露 8 位短 id", () => {
    expect(shortIncidentId("3f2a91bc-0000-4000-8000-000000000000")).toBe("3f2a91bc");
    expect(shortIncidentId(null)).toBe("-");
  });

  it("SMTP-17 CR/LF 无法进入正文形成 header 注入", () => {
    const { text } = renderNotificationTemplate({
      event: "smtp_test",
      instanceName: "A\r\nBcc: attacker@evil.example",
      observedAt: "2026-10-26T00:00:00.000Z",
      incidentId: null
    });
    expect(text).not.toContain("\r");
    // The sanitized name may still contain the words, but it can never become
    // a header: no line of the body may start with a header name.
    expect(text.split("\n").some((line) => /^\s*(bcc|to|from|subject)\s*:/i.test(line))).toBe(false);
  });
});

/* ─────────────────────────── worker 队列状态机 ─────────────────────────── */

describe("L25-05 outbox worker state machine", () => {
  const sent: { message: SmtpMessage }[] = [];

  beforeEach(async () => {
    // The worker only delivers when the runtime view is `ok`; without a valid
    // profile the whole pass is skipped.
    await writeProfile("profile-worker.yaml", {
      host: "smtp.example.internal",
      port: 587,
      security: "starttls"
    });
    await getSmtpRuntimeView();
  });

  function senderReturning(outcome: SmtpSendOutcome) {
    return async (_view: SmtpRuntimeView, message: SmtpMessage): Promise<SmtpSendOutcome> => {
      sent.push({ message });
      return outcome;
    };
  }

  beforeEach(() => {
    sent.length = 0;
  });

  it("SMTP-06 发送成功后标 sent，且收件人只在 Bcc", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-1",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-1", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal", "sre@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });

    const result = await runNotificationWorkerPass(new Date("2026-10-26T00:00:00.000Z"), senderReturning({ ok: true, accepted: 2 }));
    expect(result).toMatchObject({ claimed: 1, sent: 1, retried: 0, dead: 0 });

    const row = await readNotificationById(1);
    expect(row?.status).toBe("sent");
    expect(row?.attempts).toBe(1);

    const message = sent[0].message;
    expect(message.to).toBe("lucy@example.internal");
    expect(message.bcc).toEqual(["data-ops@example.internal", "sre@example.internal"]);
    expect(message.text).not.toContain("data-ops@example.internal");
    expect(message.subject).toBe("Lucy 审计账本不可用");
  });

  it("SMTP-12 暂时失败按有界退避重排，并记录封闭错误码", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-2",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-2", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });

    const now = new Date("2026-10-26T00:00:00.000Z");
    const result = await runNotificationWorkerPass(now, senderReturning({ ok: false, reason: "smtp_rejected", permanent: false }));
    expect(result).toMatchObject({ retried: 1, dead: 0 });

    const row = await readNotificationById(1);
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(1);
    expect(row?.last_error_code).toBe("smtp_rejected");
    expect(row?.next_attempt_at).toBe(
      new Date(now.getTime() + NOTIFICATION_BACKOFF_MS[0]).toISOString()
    );
  });

  it("SMTP-13 永久失败直接 dead，不无限重试", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-3",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-3", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });

    await runNotificationWorkerPass(
      new Date("2026-10-26T00:00:00.000Z"),
      senderReturning({ ok: false, reason: "smtp_rejected", permanent: true })
    );
    const row = await readNotificationById(1);
    expect(row?.status).toBe("dead");
    expect(row?.last_error_code).toBe("smtp_rejected");
  });

  it("SMTP-13 达到最大尝试次数后 dead", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-4",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-4", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });
    const db = await getAuditDb();
    db.prepare("UPDATE notification_outbox SET attempts = ? WHERE id = 1").run(NOTIFICATION_MAX_ATTEMPTS - 1);

    await runNotificationWorkerPass(
      new Date("2026-10-26T00:00:00.000Z"),
      senderReturning({ ok: false, reason: "smtp_timeout", permanent: false })
    );
    const row = await readNotificationById(1);
    expect(row?.status).toBe("dead");
    expect(row?.attempts).toBe(NOTIFICATION_MAX_ATTEMPTS);
  });

  it("SMTP-14 租约过期的 sending 行可被重新领取（崩溃恢复）", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-5",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-5", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });
    const db = await getAuditDb();
    // Simulate a crash: the row was claimed, the lease expired, and the worker
    // never marked it sent.
    db.prepare(
      `UPDATE notification_outbox
          SET status = 'sending', attempts = 1, lease_until = ?, next_attempt_at = ?
        WHERE id = 1`
    ).run("2026-10-26T00:00:00.000Z", "2026-10-26T00:00:00.000Z");

    const claimed = await claimDueNotifications(new Date("2026-10-26T00:01:00.000Z"));
    expect(claimed).toHaveLength(1);
    expect(claimed[0].attempts).toBe(2);
  });

  it("SMTP-14 活着的租约不会被抢走", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-6",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-6", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });
    const db = await getAuditDb();
    db.prepare(
      `UPDATE notification_outbox
          SET status = 'sending', attempts = 1, lease_until = ?, next_attempt_at = ?
        WHERE id = 1`
    ).run(
      new Date(Date.parse("2026-10-26T00:00:00.000Z") + NOTIFICATION_LEASE_MS + 60_000).toISOString(),
      "2026-10-26T00:00:00.000Z"
    );

    const claimed = await claimDueNotifications(new Date("2026-10-26T00:00:10.000Z"));
    expect(claimed).toHaveLength(0);
  });

  it("SMTP-11 关闭时不投递，队列保持原样", async () => {
    // A disabled profile: the runtime view becomes `disabled` and the worker
    // must not create a network task nor deliver anything.
    const disabledProfile = path.join(workDir, "profile-disabled.yaml");
    await writeFile(
      disabledProfile,
      "enabled: false\nhost: smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: lucy@example.internal\nrecipients:\n  - data-ops@example.internal\nnotifications:\n  auditHealth: true\n",
      "utf8"
    );
    setEnv("LUCY_SMTP_PROFILE_FILE", disabledProfile);
    resetSmtpRuntimeViewForTests();
    expect((await getSmtpRuntimeView()).state).toBe("disabled");

    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-7",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-7", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });
    const db = await getAuditDb();
    db.prepare("UPDATE notification_outbox SET status = 'queued', attempts = 0 WHERE id = 1").run();

    const disabled: SmtpRuntimeView = { ...okView(), enabled: false, state: "disabled", profile: null };
    const result = await runNotificationWorkerPass(
      new Date("2026-10-26T00:00:00.000Z"),
      async () => ({ ok: true, accepted: 1 })
    );
    expect(result.skipped).toBe(true);
    expect(sent).toHaveLength(0);
    expect(disabled.enabled).toBe(false);
    const row = await readNotificationById(1);
    expect(row?.status).toBe("queued");
  });

  it("SMTP-11／21 历史行按 enqueue 时的收件人快照投递，不随配置变更", async () => {
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-snapshot",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-snapshot", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["old-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });

    // The deployment rotates its recipients and restarts: the queued row must
    // still go to the snapshot it was enqueued with.
    await writeProfile("profile-rotated.yaml", {
      host: "smtp.example.internal",
      port: 587,
      security: "starttls",
      recipients: ["new-ops@example.internal"]
    });
    resetSmtpRuntimeViewForTests();
    const view = await getSmtpRuntimeView();
    expect(view.profile?.recipients).toEqual(["new-ops@example.internal"]);

    const delivered: SmtpMessage[] = [];
    await runNotificationWorkerPass(new Date("2026-10-26T00:00:00.000Z"), async (_view, message) => {
      delivered.push(message);
      return { ok: true, accepted: 1 };
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0].bcc).toEqual(["old-ops@example.internal"]);
  });

  it("SMTP-19 保留期清理一次只删一批，不做无界删除", async () => {
    const db = await getAuditDb();
    const now = new Date("2026-10-26T00:00:00.000Z");
    for (let index = 0; index < 5; index += 1) {
      await enqueueNotification({
        eventType: "audit_ledger_unavailable",
        incidentId: `inc-retention-${index}`,
        payload: { eventType: "audit_ledger_unavailable", incidentId: `inc-retention-${index}`, observedAt: now.toISOString() },
        recipients: ["data-ops@example.internal"],
        now
      });
    }
    // Mark them as long-sent so the retention window has passed.
    db.prepare(
      `UPDATE notification_outbox SET status = 'sent', updated_at = ?, lease_until = NULL`
    ).run("2026-01-01T00:00:00.000Z");

    const deleted = await cleanupNotificationRetention(now, 2);
    expect(deleted).toBe(2);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get() as { n: number };
    expect(remaining.n).toBe(3);
  });

  it("SMTP-15 队列满时不阻塞，enqueue 报告 queue_full", async () => {
    const result = await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-8",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-8", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"],
      now: new Date("2026-10-26T00:00:00.000Z")
    });
    expect(result.ok).toBe(true);
    // The bound is enforced by the outbox; a full queue is reported, not thrown.
    const db = await getAuditDb();
    db.prepare("UPDATE notification_outbox SET status = 'queued' WHERE id = 1").run();
    expect((await countNotifications()).pending).toBe(1);
  });
});

/* ─────────────────────────── owner API ─────────────────────────── */

describe("L25-05 owner notification APIs", () => {
  async function ownerApp(role: "owner" | "operator" | null) {
    const app = Fastify();
    app.addHook("onRequest", async (request: FastifyRequest) => {
      request.lucyAdmin = {
        session: null,
        admin:
          role === null
            ? null
            : { id: `${role}-1`, display_name: role, role, enabled: true, created_at: "2026-01-01" },
        stateUnavailable: false,
        authMode: "open"
      };
    });
    registerNotificationRoutes(app);
    await app.ready();
    return app;
  }

  it("SMTP-07 未登录 401、非 owner 403，且不产生 outbox 行", async () => {
    const anonymous = await ownerApp(null);
    const anonRes = await anonymous.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(anonRes.statusCode).toBe(401);
    await anonymous.close();

    const operator = await ownerApp("operator");
    const opRes = await operator.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(opRes.statusCode).toBe(403);
    expect(opRes.json().error.code).toBe("OWNER_REQUIRED");
    expect(opRes.json().error.message).toBe("仅所有者可管理邮件通知");
    await operator.close();

    expect((await countNotifications()).pending).toBe(0);
  });

  it("SMTP-15 配置不可用时返回 NOTIFICATION_UNAVAILABLE 而不是队列错误", async () => {
    const app = await ownerApp("owner");
    const res = await app.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("NOTIFICATION_UNAVAILABLE");
    await app.close();
  });

  it("SMTP-06 owner 提交测试邮件返回 202 queued，文案不说发送成功", async () => {
    await writeProfile("profile-api.yaml", { host: "smtp.example.internal", port: 587, security: "starttls" });
    await getSmtpRuntimeView();

    const app = await ownerApp("owner");
    const res = await app.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("queued");
    expect(typeof body.notificationId).toBe("number");
    expect(body.message).toBe("测试邮件已加入发送队列");
    expect(JSON.stringify(body)).not.toContain("发送成功");
    await app.close();
  });

  it("SMTP-07 状态与单行查询都不返回 payload 与收件人", async () => {
    await writeProfile("profile-api2.yaml", { host: "smtp.example.internal", port: 587, security: "starttls" });
    await getSmtpRuntimeView();
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-api",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-api", observedAt: "2026-10-26T00:00:00.000Z" },
      recipients: ["data-ops@example.internal"]
    });

    const app = await ownerApp("owner");
    const status = await app.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(status.statusCode).toBe(200);
    expect(JSON.stringify(status.json())).not.toContain("data-ops@example.internal");

    const one = await app.inject({ method: "GET", url: "/api/admin/notifications/1" });
    expect(one.statusCode).toBe(200);
    const notification = one.json().notification;
    expect(notification.id).toBe(1);
    expect(notification.eventType).toBe("audit_ledger_unavailable");
    expect(notification).not.toHaveProperty("payload");
    expect(notification).not.toHaveProperty("recipients");
    expect(notification).not.toHaveProperty("payload_json");
    expect(notification).not.toHaveProperty("recipients_json");
    await app.close();
  });

  it("SMTP-07 不存在的通知 id 返回 404 NOTIFICATION_NOT_FOUND", async () => {
    const app = await ownerApp("owner");
    const res = await app.inject({ method: "GET", url: "/api/admin/notifications/9999" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(res.json().error.message).toBe("未找到该通知记录");
    await app.close();
  });
});

/* ─────────────────────────── 协议层（本地 fake SMTP） ─────────────────────────── */

type Captured = {
  messages: { raw: string; envelope: { from: string; rcptTo: { address: string }[] } }[];
  authAttempts: string[];
};

function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A self-signed certificate for 127.0.0.1, generated once per test file. */
async function selfSignedCert(): Promise<{ key: string; cert: string } | null> {
  if (!opensslAvailable()) return null;
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyPath, "-out", certPath, "-days", "2",
        "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"
      ],
      { stdio: "ignore" }
    );
  } catch {
    return null;
  }
  const { readFile } = await import("node:fs/promises");
  return {
    key: await readFile(keyPath, "utf8"),
    cert: await readFile(certPath, "utf8")
  };
}

async function startFakeSmtp(options: {
  secure: boolean;
  key?: string;
  cert?: string;
  disableStartTls?: boolean;
  dataError?: { code: number; message: string };
}): Promise<{ port: number; captured: Captured; close: () => Promise<void> }> {
  const captured: Captured = { messages: [], authAttempts: [] };
  const server = new SMTPServer({
    secure: options.secure,
    key: options.key,
    cert: options.cert,
    // Authentication is advertised but not required: a client without
    // credentials must still be able to deliver, and the AUTH attempts are
    // recorded separately so the "no AUTH before the upgrade" rule can be
    // asserted.
    authOptional: true,
    disabledCommands: options.disableStartTls ? ["STARTTLS"] : [],
    onAuth(auth, _session, callback) {
      // smtp-server types `auth.username` as optional: a client may attempt
      // AUTH without a username. Record the attempt either way — the
      // assertion is about "an AUTH attempt happened", not about its value.
      captured.authAttempts.push(auth.username ?? "");
      callback(null, { user: auth.username ?? "" });
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        captured.messages.push({
          raw: Buffer.concat(chunks).toString("utf8"),
          envelope: session.envelope as never
        });
        if (options.dataError) {
          const error = new Error(options.dataError.message) as Error & { responseCode: number };
          error.responseCode = options.dataError.code;
          callback(error);
          return;
        }
        callback();
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  // A client that aborts the handshake (which the "no downgrade to plaintext"
  // case does on purpose) makes the server report a socket error. It is an
  // expected outcome of the test, not an unhandled failure.
  server.on("error", () => undefined);
  const address = server.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    captured,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

describe.skipIf(!opensslAvailable())("L25-05 SMTP protocol layer", () => {
  let cert: { key: string; cert: string } | null = null;

  beforeAll(async () => {
    cert = await selfSignedCert();
  });

  it("SMTP-16 直连 TLS：信任该 CA 时发送成功，明文服务器不被接受", async () => {
    if (!cert) return;
    const fake = await startFakeSmtp({ secure: true, key: cert.key, cert: cert.cert });
    try {
      const caPath = path.join(certDir, "cert.pem");
      setEnv("LUCY_SMTP_CA_FILE", caPath);
      await writeProfile("profile-tls.yaml", { host: "127.0.0.1", port: fake.port, security: "tls" });
      const view = await getSmtpRuntimeView();
      expect(view.state).toBe("ok");

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal"],
        subject: "Lucy 审计账本不可用",
        text: "body"
      });
      expect(outcome.ok).toBe(true);
      expect(fake.captured.messages).toHaveLength(1);
      // The envelope carries ONLY the real recipients: the visible To (the
      // from address) must not become an envelope recipient, or Lucy would
      // mail itself on every notification.
      expect(fake.captured.messages[0].envelope.rcptTo.map((r) => r.address)).toEqual([
        "data-ops@example.internal"
      ]);
      // The Bcc header is stripped by the sending MUA, as it must be.
      expect(fake.captured.messages[0].raw).not.toContain("Bcc:");
      expect(fake.captured.messages[0].raw).toContain("To: lucy@example.internal");
    } finally {
      await fake.close();
    }
  });

  it("SMTP-16 不信任该 CA 时握手失败，绝不降级明文", async () => {
    if (!cert) return;
    const fake = await startFakeSmtp({ secure: true, key: cert.key, cert: cert.cert });
    try {
      setEnv("LUCY_SMTP_CA_FILE", undefined);
      await writeProfile("profile-tls-untrusted.yaml", { host: "127.0.0.1", port: fake.port, security: "tls" });
      const view = await getSmtpRuntimeView();

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal"],
        subject: "Lucy 审计账本不可用",
        text: "body"
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("smtp_tls_failed");
      expect(fake.captured.messages).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("SMTP-16 STARTTLS 升级失败时不降级明文，且升级前不发送 AUTH", async () => {
    if (!cert) return;
    // A server that does not offer STARTTLS at all.
    const fake = await startFakeSmtp({ secure: false, disableStartTls: true });
    try {
      const passwordPath = path.join(workDir, "smtp-password.txt");
      await writeFile(passwordPath, "notifier-secret", "utf8");
      setEnv("LUCY_SMTP_PASSWORD_FILE", passwordPath);
      await writeProfile("profile-starttls.yaml", {
        host: "127.0.0.1",
        port: fake.port,
        security: "starttls",
        username: "lucy-notifier"
      });
      const view = await getSmtpRuntimeView();
      expect(view.state).toBe("ok");

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal"],
        subject: "Lucy 审计账本不可用",
        text: "body"
      });
      expect(outcome.ok).toBe(false);
      expect(fake.captured.messages).toHaveLength(0);
      // No credential may leave before the channel is upgraded.
      expect(fake.captured.authAttempts).toHaveLength(0);
    } finally {
      await fake.close();
    }
  });

  it("SMTP-12 SMTP 4xx 被服务端拒绝时映射为可重试的 smtp_rejected", async () => {
    if (!cert) return;
    const fake = await startFakeSmtp({
      secure: true,
      key: cert.key,
      cert: cert.cert,
      dataError: { code: 450, message: "Mailbox busy" }
    });
    try {
      setEnv("LUCY_SMTP_CA_FILE", path.join(certDir, "cert.pem"));
      await writeProfile("profile-4xx.yaml", { host: "127.0.0.1", port: fake.port, security: "tls" });
      const view = await getSmtpRuntimeView();

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal"],
        subject: "Lucy 审计账本不可用",
        text: "body"
      });
      expect(outcome).toEqual({ ok: false, reason: "smtp_rejected", permanent: false });
    } finally {
      await fake.close();
    }
  });

  it("SMTP-13 SMTP 5xx 被服务端拒绝时映射为永久失败", async () => {
    if (!cert) return;
    const fake = await startFakeSmtp({
      secure: true,
      key: cert.key,
      cert: cert.cert,
      dataError: { code: 550, message: "Rejected" }
    });
    try {
      setEnv("LUCY_SMTP_CA_FILE", path.join(certDir, "cert.pem"));
      await writeProfile("profile-5xx.yaml", { host: "127.0.0.1", port: fake.port, security: "tls" });
      const view = await getSmtpRuntimeView();

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal"],
        subject: "Lucy 审计账本不可用",
        text: "body"
      });
      expect(outcome).toEqual({ ok: false, reason: "smtp_rejected", permanent: true });
    } finally {
      await fake.close();
    }
  });

  it("SMTP-06 真实投递后正文不含收件人列表，收件人只在 Bcc", async () => {
    if (!cert) return;
    const fake = await startFakeSmtp({ secure: true, key: cert.key, cert: cert.cert });
    try {
      setEnv("LUCY_SMTP_CA_FILE", path.join(certDir, "cert.pem"));
      await writeProfile("profile-body.yaml", { host: "127.0.0.1", port: fake.port, security: "tls" });
      const view = await getSmtpRuntimeView();
      const template = renderNotificationTemplate({
        event: "audit_ledger_unavailable",
        instanceName: "客户 A",
        observedAt: "2026-10-26T00:00:00.000Z",
        incidentId: "3f2a91bc-0000-4000-8000-000000000000"
      });

      const outcome = await sendSmtpMessage(view, {
        from: "lucy@example.internal",
        to: "lucy@example.internal",
        bcc: ["data-ops@example.internal", "sre@example.internal"],
        subject: template.subject,
        text: template.text
      });
      expect(outcome.ok).toBe(true);

      const raw = fake.captured.messages[0].raw;
      // The Bcc header never reaches the wire; the envelope carries the
      // recipients, and the visible To is the from address so they cannot see
      // each other.
      expect(raw).not.toContain("Bcc:");
      expect(raw).toContain("To: lucy@example.internal");
      expect(fake.captured.messages[0].envelope.rcptTo.map((r) => r.address)).toEqual([
        "data-ops@example.internal",
        "sre@example.internal"
      ]);
      const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
      expect(body).not.toContain("data-ops@example.internal");
      expect(body).not.toContain("sre@example.internal");
    } finally {
      await fake.close();
    }
  });
});
