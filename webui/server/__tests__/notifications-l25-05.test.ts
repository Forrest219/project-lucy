import Fastify, { type FastifyRequest } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerNotificationRoutes } from "../admin/notifications.js";
import { parseSmtpProfile, SmtpProfileError } from "../notifications/profile.js";
import { getSmtpRuntimeView, resetSmtpRuntimeViewForTests, smtpRuntimeStatus } from "../notifications/runtime.js";
import {
  countNotifications,
  enqueueNotification,
  ensureNotificationOutbox,
  hasPersistedIncident,
  markExpiredNotificationsDead,
  NOTIFICATION_PENDING_LIMIT
} from "../notifications/outbox.js";
import {
  onAuditHealthTransition,
  recordLedgerAppend,
  resetAuditWriteHealthForTests
} from "../proxy/audit-write-health.js";
import { resetNotifierStateForTests } from "../notifications/state.js";

/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知 (S1): the profile contract, the startup
 * cache, the durable outbox, and the flap-suppressed audit-health events.
 *
 * The SMTP client itself is S2: nothing here opens a network connection.
 */

const VALID_PROFILE = `enabled: true
host: smtp.example.internal
port: 587
security: starttls
from: lucy@example.internal
username: lucy-notifier
recipients:
  - data-ops@example.internal
notifications:
  auditHealth: true
`;

let auditDir: string;
let auditDbPath: string;
let workDir: string;
let previousEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  auditDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-audit-"));
  auditDbPath = path.join(auditDir, "audit.sqlite");
  workDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-work-"));
});

afterAll(async () => {
  await rm(auditDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
  setEnv("LUCY_SMTP_PASSWORD_FILE", undefined);
  setEnv("LUCY_SMTP_CA_FILE", undefined);
  setEnv("LUCY_AUDIT_DB", auditDbPath);
  resetSmtpRuntimeViewForTests();
  resetNotifierStateForTests();
  resetAuditWriteHealthForTests();

  const { getAuditDb } = await import("../admin/audit");
  const db = await getAuditDb();
  db.exec("DROP TABLE IF EXISTS notification_outbox");
  await ensureNotificationOutbox();
});

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv = {};
  vi.useRealTimers();
});

describe("L25-05 profile contract", () => {
  it("SMTP-03 合法 profile 通过校验", () => {
    const profile = parseSmtpProfile(VALID_PROFILE);
    expect(profile.enabled).toBe(true);
    expect(profile.host).toBe("smtp.example.internal");
    expect(profile.port).toBe(587);
    expect(profile.security).toBe("starttls");
    expect(profile.username).toBe("lucy-notifier");
    expect(profile.recipients).toEqual(["data-ops@example.internal"]);
    expect(profile.notifications.auditHealth).toBe(true);
  });

  it("SMTP-03 非法形状一律被拒，且只抛封闭错误码", () => {
    const cases: [string, string][] = [
      ["enabled: true\nhost: smtp.example.internal\nport: 0\nsecurity: starttls\nfrom: a@b.com\nrecipients: [c@d.com]\n", "port"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: plaintext\nfrom: a@b.com\nrecipients: [c@d.com]\n", "security"],
      ["enabled: true\nhost: https://smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: a@b.com\nrecipients: [c@d.com]\n", "scheme"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: a@b.com\nrecipients: []\n", "recipients"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: a@b.com\nrecipients: [\"bad\\r\\nBcc: x@y.com\"]\n", "injection"]
    ];
    for (const [yaml] of cases) {
      expect(() => parseSmtpProfile(yaml)).toThrow(SmtpProfileError);
      try {
        parseSmtpProfile(yaml);
      } catch (error) {
        expect((error as SmtpProfileError).code).toBe("smtp_profile_invalid");
      }
    }
  });

  it("SMTP-18 profile 不得内联密码", () => {
    const yaml = VALID_PROFILE.replace("username: lucy-notifier", "username: lucy-notifier\npassword: hunter2");
    try {
      parseSmtpProfile(yaml);
      throw new Error("the inline password must be rejected");
    } catch (error) {
      expect((error as SmtpProfileError).code).toBe("smtp_profile_invalid");
    }
  });

  it("SMTP-19 收件人上限为 20 且去重", () => {
    const many = Array.from({ length: 21 }, (_, i) => `  - user${i}@example.internal`).join("\n");
    const yaml = `enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: a@b.com\nrecipients:\n${many}\n`;
    expect(() => parseSmtpProfile(yaml)).toThrow(SmtpProfileError);

    const dedup = `enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: a@b.com\nrecipients:\n  - ops@example.internal\n  - ops@example.internal\n`;
    expect(parseSmtpProfile(dedup).recipients).toEqual(["ops@example.internal"]);
  });
});

describe("L25-05 startup cache", () => {
  it("SMTP-01 未配置时不启用，也不读任何文件", async () => {
    setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
    const view = await getSmtpRuntimeView();
    expect(view.enabled).toBe(false);
    expect(view.state).toBe("disabled");
  });

  it("SMTP-04 有 username 但缺密码文件时为 unavailable", async () => {
    const profilePath = path.join(workDir, "profile.yaml");
    await writeFile(profilePath, VALID_PROFILE, "utf8");
    setEnv("LUCY_SMTP_PROFILE_FILE", profilePath);
    setEnv("LUCY_SMTP_PASSWORD_FILE", undefined);

    const view = await getSmtpRuntimeView();
    expect(view.state).toBe("unavailable");
    expect(view.errorCode).toBe("smtp_auth_incomplete");
  });

  it("SMTP-04 没有 username 时不读密码文件", async () => {
    const profilePath = path.join(workDir, "profile-no-auth.yaml");
    await writeFile(
      profilePath,
      VALID_PROFILE.replace("username: lucy-notifier\n", ""),
      "utf8"
    );
    setEnv("LUCY_SMTP_PROFILE_FILE", profilePath);
    // A password path that cannot be read: it must not be touched at all.
    setEnv("LUCY_SMTP_PASSWORD_FILE", path.join(workDir, "does-not-exist"));

    const view = await getSmtpRuntimeView();
    expect(view.state).toBe("ok");
    expect(view.profile?.username).toBeUndefined();
  });

  it("SMTP-03 非法 profile 让通知不可用，但不影响其它东西", async () => {
    const profilePath = path.join(workDir, "profile-broken.yaml");
    await writeFile(profilePath, "enabled: true\nhost: nope\n", "utf8");
    setEnv("LUCY_SMTP_PROFILE_FILE", profilePath);

    const view = await getSmtpRuntimeView();
    expect(view.state).toBe("unavailable");
    expect(view.errorCode).toBe("smtp_profile_invalid");
  });

  it("SMTP-21 配置只加载一次：改动文件不热生效", async () => {
    const profilePath = path.join(workDir, "profile-cached.yaml");
    await writeFile(profilePath, VALID_PROFILE.replace("username: lucy-notifier\n", ""), "utf8");
    setEnv("LUCY_SMTP_PROFILE_FILE", profilePath);

    const first = await getSmtpRuntimeView();
    expect(first.state).toBe("ok");
    expect(first.profile?.host).toBe("smtp.example.internal");

    await writeFile(profilePath, VALID_PROFILE.replace("smtp.example.internal", "smtp2.example.internal"), "utf8");
    const second = await getSmtpRuntimeView();
    expect(second.profile?.host).toBe("smtp.example.internal");
  });

  it("SMTP-02 状态摘要不含 host／username／from／收件人原文", async () => {
    const profilePath = path.join(workDir, "profile-status.yaml");
    await writeFile(profilePath, VALID_PROFILE.replace("username: lucy-notifier\n", ""), "utf8");
    setEnv("LUCY_SMTP_PROFILE_FILE", profilePath);

    const status = smtpRuntimeStatus(await getSmtpRuntimeView());
    expect(status.enabled).toBe(true);
    expect(status.state).toBe("ok");
    expect(status.auditHealth).toBe(true);
    expect(status.recipientCount).toBe(1);
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("smtp.example.internal");
    expect(serialized).not.toContain("lucy-notifier");
    expect(serialized).not.toContain("data-ops@example.internal");
    expect(serialized).not.toContain("lucy@example.internal");
  });
});

describe("L25-05 outbox", () => {
  it("SMTP-08 入队产生一行 queued，去重键命中时不重复入队", async () => {
    const first = await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "incident-1",
      payload: { eventType: "audit_ledger_unavailable" },
      recipients: ["ops@example.internal"]
    });
    expect(first.ok).toBe(true);
    expect(first.ok && first.duplicate).toBe(false);

    const second = await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "incident-1",
      payload: { eventType: "audit_ledger_unavailable" },
      recipients: ["ops@example.internal"]
    });
    expect(second.ok && second.duplicate).toBe(true);

    const counts = await countNotifications();
    expect(counts.queued).toBe(1);
  });

  it("SMTP-09 恢复事件要求事故行已持久化", async () => {
    expect(await hasPersistedIncident("incident-x", "audit_ledger_unavailable")).toBe(false);
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "incident-x",
      payload: { eventType: "audit_ledger_unavailable" },
      recipients: ["ops@example.internal"]
    });
    expect(await hasPersistedIncident("incident-x", "audit_ledger_unavailable")).toBe(true);
  });

  it("SMTP-19 payload 与收件人快照有上限", async () => {
    const oversized = await enqueueNotification({
      eventType: "smtp_test",
      payload: { blob: "x".repeat(5000) },
      recipients: ["ops@example.internal"]
    });
    expect(oversized).toEqual({ ok: false, reason: "invalid_payload" });

    const tooMany = await enqueueNotification({
      eventType: "smtp_test",
      payload: { eventType: "smtp_test" },
      recipients: Array.from({ length: 21 }, (_, i) => `u${i}@example.internal`)
    });
    expect(tooMany).toEqual({ ok: false, reason: "invalid_payload" });
  });

  it("SMTP-15 队列达到上限时拒绝新通知，不影响主业务", async () => {
    const { getAuditDb } = await import("../admin/audit");
    const db = await getAuditDb();
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO notification_outbox
         (dedup_key, event_type, incident_id, payload_json, recipients_json, status,
          attempts, next_attempt_at, lease_until, expires_at, created_at, updated_at, last_error_code)
       VALUES (?, 'audit_ledger_unavailable', NULL, '{}', '[]', 'queued', 0, ?, NULL, ?, ?, ?, NULL)`
    );
    db.exec("BEGIN");
    for (let i = 0; i < NOTIFICATION_PENDING_LIMIT; i += 1) {
      insert.run(`bulk-${i}`, now, now, now, now);
    }
    db.exec("COMMIT");

    const rejected = await enqueueNotification({
      eventType: "smtp_test",
      payload: { eventType: "smtp_test" },
      recipients: ["ops@example.internal"]
    });
    expect(rejected).toEqual({ ok: false, reason: "queue_full" });
  });

  it("SMTP-13 过期行不再投递，转 dead", async () => {
    await enqueueNotification({
      eventType: "smtp_test",
      payload: { eventType: "smtp_test" },
      recipients: ["ops@example.internal"],
      now: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
    });
    const expired = await markExpiredNotificationsDead(new Date());
    expect(expired).toBe(1);
    const counts = await countNotifications();
    expect(counts.dead).toBe(1);
    expect(counts.pending).toBe(0);
  });
});

describe("L25-05 audit-health events (F-13 flap suppression)", () => {
  it("连续失败才升级为事故，且只发一次", () => {
    const seen: string[] = [];
    const off = onAuditHealthTransition((t) => seen.push(t.eventType));

    recordLedgerAppend(false);
    recordLedgerAppend(false);
    expect(seen).toEqual([]);

    recordLedgerAppend(false);
    expect(seen).toEqual(["audit_ledger_unavailable"]);

    recordLedgerAppend(false);
    recordLedgerAppend(false);
    expect(seen).toEqual(["audit_ledger_unavailable"]);
    off();
  });

  it("ok／unavailable 抖动不产生任何事件", () => {
    const seen: string[] = [];
    const off = onAuditHealthTransition((t) => seen.push(t.eventType));

    for (let i = 0; i < 10; i += 1) {
      recordLedgerAppend(false);
      recordLedgerAppend(true);
    }
    expect(seen).toEqual([]);
    off();
  });

  it("恢复需要稳定成功，且复用同一个 incidentId", () => {
    const seen: { eventType: string; incidentId: string }[] = [];
    const off = onAuditHealthTransition((t) => seen.push(t));

    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    expect(seen).toHaveLength(1);

    recordLedgerAppend(true);
    expect(seen).toHaveLength(2);
    expect(seen[1].eventType).toBe("audit_ledger_recovered");
    expect(seen[1].incidentId).toBe(seen[0].incidentId);
    off();
  });

  it("没有事故就不产生恢复事件", () => {
    const seen: string[] = [];
    const off = onAuditHealthTransition((t) => seen.push(t.eventType));

    recordLedgerAppend(true);
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    expect(seen).toEqual([]);
    off();
  });
});

describe("L25-05 status endpoint", () => {
  it("SMTP-07 非 owner 返回 403，未登录返回 401", async () => {
    const app = Fastify();
    app.addHook("onRequest", async (request: FastifyRequest) => {
      request.lucyAdmin = { session: null, admin: null, stateUnavailable: false, authMode: "open" };
    });
    registerNotificationRoutes(app);
    await app.ready();

    const anonymous = await app.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(anonymous.statusCode).toBe(401);
    await app.close();

    const app2 = Fastify();
    app2.addHook("onRequest", async (request: FastifyRequest) => {
      request.lucyAdmin = {
        session: null,
        admin: { id: "op", display_name: "Op", role: "operator", enabled: true, created_at: "2026-01-01" },
        stateUnavailable: false,
        authMode: "open"
      };
    });
    registerNotificationRoutes(app2);
    await app2.ready();

    const operator = await app2.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(operator.statusCode).toBe(403);
    expect(operator.json().error.code).toBe("OWNER_REQUIRED");
    await app2.close();
  });

  it("SMTP-02 owner 看到脱敏状态与队列计数", async () => {
    const app = Fastify();
    app.addHook("onRequest", async (request: FastifyRequest) => {
      request.lucyAdmin = {
        session: null,
        admin: { id: "owner-1", display_name: "Owner", role: "owner", enabled: true, created_at: "2026-01-01" },
        stateUnavailable: false,
        authMode: "open"
      };
    });
    registerNotificationRoutes(app);
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty("state");
    expect(body).toHaveProperty("recipientCount");
    expect(body).toHaveProperty("queue");
    expect(body).not.toHaveProperty("host");
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("from");
    expect(body).not.toHaveProperty("recipients");
    expect(body).not.toHaveProperty("password");
    await app.close();
  });
});
