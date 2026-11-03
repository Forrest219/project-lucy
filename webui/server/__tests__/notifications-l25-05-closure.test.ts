import Database from "better-sqlite3";
import Fastify, { type FastifyRequest } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerNotificationRoutes } from "../admin/notifications.js";
import { getAuditDb } from "../admin/audit.js";
import { parseSmtpProfile, SmtpProfileError } from "../notifications/profile.js";
import {
  getSmtpRuntimeView,
  resetSmtpRuntimeViewForTests,
  smtpRuntimeStatus
} from "../notifications/runtime.js";
import {
  countNotifications,
  enqueueNotification,
  ensureNotificationOutbox,
  NOTIFICATION_BACKOFF_MS,
  NOTIFICATION_PENDING_LIMIT,
  readNotificationById
} from "../notifications/outbox.js";
import {
  claimDueNotifications,
  resetNotificationWorkerForTests,
  runNotificationWorkerPass
} from "../notifications/worker.js";
import type { SmtpMessage } from "../notifications/smtp-client.js";
import {
  recordLedgerAppend,
  resetAuditWriteHealthForTests
} from "../proxy/audit-write-health.js";
import {
  startNotificationHealthEvents,
  stopNotificationHealthEvents
} from "../notifications/health-events.js";
import { getLastNotifierErrorCode, resetNotifierStateForTests } from "../notifications/state.js";
import { initNotifications } from "../notifications/init.js";
import { AUDIT_DB_SCHEMA_VERSION } from "../proxy/audit.js";
import {
  initSecuritySchema,
  readSchemaVersion,
  SECURITY_SCHEMA_VERSION
} from "../security/schema.js";

/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the functional-contract closure assertions.
 *
 * These cases exist because the §11 acceptance matrix promises things the
 * repository did not assert anywhere. Every case below falsifies ONE clause of
 * the matrix — none of them restates a constant or a "nothing happened".
 *
 * Nothing here reaches the public network: the only transport used is the
 * in-process fake SMTP server of `notifications-l25-05-smtp.test.ts`, and the
 * worker is driven through its sender seam.
 */

const VALID_PROFILE = `enabled: true
host: smtp.example.internal
port: 587
security: starttls
from: lucy@example.internal
username: lucy-notifier
recipients:
  - data-ops@example.internal
  - sre@example.internal
notifications:
  auditHealth: true
`;

const PASSWORD = "notifier-secret-value";

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
  auditDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-closure-audit-"));
  auditDbPath = path.join(auditDir, "audit.sqlite");
  workDir = await mkdtemp(path.join(os.tmpdir(), "l25-05-closure-work-"));
});

afterAll(async () => {
  await rm(auditDir, { recursive: true, force: true });
  await rm(workDir, { recursive: true, force: true });
});

beforeEach(async () => {
  stopNotificationHealthEvents();
  resetNotificationWorkerForTests();
  setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
  setEnv("LUCY_SMTP_PASSWORD_FILE", undefined);
  setEnv("LUCY_SMTP_CA_FILE", undefined);
  setEnv("LUCY_AUDIT_DB", auditDbPath);
  resetSmtpRuntimeViewForTests();
  resetNotifierStateForTests();
  resetAuditWriteHealthForTests();

  const db = await getAuditDb();
  db.exec("DROP TABLE IF EXISTS notification_outbox");
  await ensureNotificationOutbox();
});

afterEach(() => {
  stopNotificationHealthEvents();
  resetNotificationWorkerForTests();
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv = {};
});

async function writeProfileFile(name: string, content: string): Promise<string> {
  const file = path.join(workDir, name);
  await writeFile(file, content, "utf8");
  setEnv("LUCY_SMTP_PROFILE_FILE", file);
  return file;
}

/** A profile whose secret lives in its own file, as the contract requires. */
async function writeValidProfile(name: string, options?: { auditHealth?: boolean; enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const auditHealth = options?.auditHealth ?? true;
  const yaml = `enabled: ${enabled}
host: smtp.example.internal
port: 587
security: starttls
from: lucy@example.internal
username: lucy-notifier
recipients:
  - data-ops@example.internal
  - sre@example.internal
notifications:
  auditHealth: ${auditHealth}
`;
  const profilePath = await writeProfileFile(name, yaml);
  const passwordPath = path.join(workDir, `${name}.password`);
  await writeFile(passwordPath, `${PASSWORD}\n`, "utf8");
  setEnv("LUCY_SMTP_PASSWORD_FILE", passwordPath);
  return { profilePath, passwordPath };
}

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

/** Fill the outbox up to the pending limit with rows that are never delivered. */
async function fillPendingQueue(): Promise<void> {
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
}

describe("L25-05 closure — 默认关闭与配置合同（SMTP-01／03／04）", () => {
  it("SMTP-01 未配置时不产生任何 SMTP 连接：worker 不领取、不发信", async () => {
    // No profile at all: the notifier is off. A row that was queued earlier
    // must stay untouched — no connection, no attempt, no state change.
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-off",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-off" },
      recipients: ["data-ops@example.internal"]
    });

    let senderCalls = 0;
    const result = await runNotificationWorkerPass(new Date("2026-10-26T00:00:00.000Z"), async () => {
      senderCalls += 1;
      return { ok: true, accepted: 1 };
    });

    expect(result.skipped).toBe(true);
    expect(result.claimed).toBe(0);
    expect(senderCalls).toBe(0);
    const row = await readNotificationById(1);
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(0);
  });

  it("SMTP-01 未配置时不读 profile／password／CA 任何文件", async () => {
    // The secret and CA paths point at files that do not exist. If the notifier
    // read them, the state would be `unavailable` — it must stay `disabled`.
    setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
    setEnv("LUCY_SMTP_PASSWORD_FILE", path.join(workDir, "no-such-password"));
    setEnv("LUCY_SMTP_CA_FILE", path.join(workDir, "no-such-ca.pem"));

    const view = await getSmtpRuntimeView();
    expect(view.state).toBe("disabled");
    expect(view.enabled).toBe(false);
    expect(view.errorCode).toBeNull();
    expect(view.password).toBeNull();
    expect(view.caPem).toBeNull();
  });

  it("SMTP-03 布尔与地址非法一律被拒：enabled／auditHealth 非布尔、from 非法或含 CR-LF", () => {
    const cases: [string, string][] = [
      ["enabled: \"true\"\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: a@b.com\nrecipients: [c@d.com]\n", "enabled"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: a@b.com\nrecipients: [c@d.com]\nnotifications:\n  auditHealth: \"yes\"\n", "auditHealth"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: not-an-address\nrecipients: [c@d.com]\n", "from"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: \"a@b.com\\r\\nBcc: x@y.com\"\nrecipients: [c@d.com]\n", "from"],
      ["enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: tls\nfrom: a@b.com\nrecipients: [\"c@d.com\\r\\nBcc: x@y.com\"]\n", "recipients"]
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

  it("SMTP-03 profile 非法时启动不被拖垮：initNotifications 不抛错，通知 unavailable", async () => {
    await writeProfileFile("profile-broken.yaml", "enabled: true\nhost: nope\n");

    await expect(initNotifications()).resolves.toBeUndefined();

    const view = await getSmtpRuntimeView();
    expect(view.state).toBe("unavailable");
    expect(view.errorCode).toBe("smtp_profile_invalid");
    // The failed configuration must not create a delivery task either.
    const result = await runNotificationWorkerPass(new Date("2026-10-26T00:00:00.000Z"), async () => ({
      ok: true,
      accepted: 1
    }));
    expect(result.skipped).toBe(true);

    // The outbox schema cannot be created either: the startup path must still
    // come up, with the notifier simply unavailable.
    const db = await getAuditDb();
    db.exec("DROP TABLE IF EXISTS notification_outbox");
    db.exec("CREATE TABLE notification_outbox (id INTEGER PRIMARY KEY, event_type TEXT)");
    await expect(initNotifications()).resolves.toBeUndefined();
  });

  it("SMTP-04 密码文件为空时 unavailable 且不连接；修复并重启后恢复 ok", async () => {
    await writeProfileFile("profile-empty-password.yaml", VALID_PROFILE);
    const emptyPassword = path.join(workDir, "empty-password.txt");
    await writeFile(emptyPassword, "\n", "utf8");
    setEnv("LUCY_SMTP_PASSWORD_FILE", emptyPassword);

    const broken = await getSmtpRuntimeView();
    expect(broken.state).toBe("unavailable");
    expect(broken.errorCode).toBe("smtp_secret_unavailable");
    expect(broken.password).toBeNull();

    // Fix the file and restart (the cache is dropped, the profile is re-read).
    const goodPassword = path.join(workDir, "good-password.txt");
    await writeFile(goodPassword, `${PASSWORD}\n`, "utf8");
    setEnv("LUCY_SMTP_PASSWORD_FILE", goodPassword);
    resetSmtpRuntimeViewForTests();

    const repaired = await getSmtpRuntimeView();
    expect(repaired.state).toBe("ok");
    expect(repaired.password).toBe(PASSWORD);
  });

  it("SMTP-04 CA 文件缺失或不是 PEM 时 unavailable；补上合法 CA 后恢复 ok", async () => {
    await writeProfileFile("profile-ca.yaml", VALID_PROFILE);
    const passwordPath = path.join(workDir, "profile-ca.password");
    await writeFile(passwordPath, `${PASSWORD}\n`, "utf8");
    setEnv("LUCY_SMTP_PASSWORD_FILE", passwordPath);

    setEnv("LUCY_SMTP_CA_FILE", path.join(workDir, "missing-ca.pem"));
    const missing = await getSmtpRuntimeView();
    expect(missing.state).toBe("unavailable");
    expect(missing.errorCode).toBe("smtp_ca_unavailable");
    expect(missing.caPem).toBeNull();

    const garbageCa = path.join(workDir, "garbage-ca.pem");
    await writeFile(garbageCa, "not a certificate", "utf8");
    setEnv("LUCY_SMTP_CA_FILE", garbageCa);
    resetSmtpRuntimeViewForTests();
    const garbage = await getSmtpRuntimeView();
    expect(garbage.state).toBe("unavailable");
    expect(garbage.errorCode).toBe("smtp_ca_unavailable");

    const goodCa = path.join(workDir, "good-ca.pem");
    await writeFile(goodCa, "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n", "utf8");
    setEnv("LUCY_SMTP_CA_FILE", goodCa);
    resetSmtpRuntimeViewForTests();
    const repaired = await getSmtpRuntimeView();
    expect(repaired.state).toBe("ok");
    expect(repaired.caPem).toContain("BEGIN CERTIFICATE");
  });
});

describe("L25-05 closure — 事件与队列语义（SMTP-09／10／11）", () => {
  it("SMTP-09 事故入队失败时不发恢复提醒：存储恢复后也不补发", async () => {
    await writeValidProfile("profile-store-down.yaml");
    await getSmtpRuntimeView();

    // Break the outbox store: the schema no longer matches, so every write
    // fails. The incident therefore never persists.
    const db = await getAuditDb();
    db.exec("DROP TABLE IF EXISTS notification_outbox");
    db.exec(
      "CREATE TABLE notification_outbox (id INTEGER PRIMARY KEY, event_type TEXT, note TEXT)"
    );

    startNotificationHealthEvents();
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(false);

    await vi.waitFor(() => {
      expect(getLastNotifierErrorCode()).toBe("store_unavailable");
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM notification_outbox").get()).toEqual({ n: 0 });

    // The store comes back. The recovery must still not go out: there is no
    // persisted incident for it to belong to, and the recovery may only be
    // enqueued when the incident row is there.
    db.exec("DROP TABLE IF EXISTS notification_outbox");
    await ensureNotificationOutbox();

    recordLedgerAppend(true);
    recordLedgerAppend(true);
    recordLedgerAppend(true);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const rows = db.prepare("SELECT event_type FROM notification_outbox").all() as {
      event_type: string;
    }[];
    expect(rows.filter((row) => row.event_type === "audit_ledger_unavailable")).toHaveLength(0);
    expect(rows.filter((row) => row.event_type === "audit_ledger_recovered")).toHaveLength(0);
  });

  it("SMTP-10 未选择 auditHealth 时事故与恢复都不产生行；测试邮件仍可入队", async () => {
    await writeValidProfile("profile-no-audit-health.yaml", { auditHealth: false });
    await getSmtpRuntimeView();

    startNotificationHealthEvents();
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    recordLedgerAppend(true);

    // Give the serialized adapter a chance to run, then prove nothing landed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await countNotifications()).pending).toBe(0);

    // The test mail is not gated by the auditHealth switch.
    const app = await ownerApp("owner");
    const res = await app.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(res.statusCode).toBe(202);
    await app.close();

    const db = await getAuditDb();
    const rows = db.prepare("SELECT event_type FROM notification_outbox").all() as {
      event_type: string;
    }[];
    expect(rows.map((row) => row.event_type)).toEqual(["smtp_test"]);
  });

  it("SMTP-11 enabled=false 时事故与恢复都不产生新行", async () => {
    await writeValidProfile("profile-disabled-events.yaml", { enabled: false });
    await getSmtpRuntimeView();

    startNotificationHealthEvents();
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    recordLedgerAppend(true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await countNotifications()).pending).toBe(0);
  });

  it("SMTP-11 重新启用并重启后：未过期的历史行按原收件人快照投递，过期行不投递", async () => {
    await writeValidProfile("profile-restart.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-fresh",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-fresh" },
      recipients: ["old-ops@example.internal"],
      now
    });
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-stale",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-stale" },
      recipients: ["stale-ops@example.internal"],
      now: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000)
    });

    // The deployment is disabled and restarted: nothing is delivered.
    await writeProfileFile(
      "profile-restart-disabled.yaml",
      "enabled: false\nhost: smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: lucy@example.internal\nrecipients:\n  - new-ops@example.internal\nnotifications:\n  auditHealth: true\n"
    );
    resetSmtpRuntimeViewForTests();
    const disabled = await runNotificationWorkerPass(now, async () => ({ ok: true, accepted: 1 }));
    expect(disabled.skipped).toBe(true);

    // Re-enabled and restarted with different recipients.
    await writeProfileFile(
      "profile-restart-enabled.yaml",
      "enabled: true\nhost: smtp.example.internal\nport: 587\nsecurity: starttls\nfrom: lucy@example.internal\nrecipients:\n  - new-ops@example.internal\nnotifications:\n  auditHealth: true\n"
    );
    resetSmtpRuntimeViewForTests();
    const view = await getSmtpRuntimeView();
    expect(view.profile?.recipients).toEqual(["new-ops@example.internal"]);

    const delivered: SmtpMessage[] = [];
    const result = await runNotificationWorkerPass(now, async (_view, message) => {
      delivered.push(message);
      return { ok: true, accepted: 1 };
    });

    // Only the unexpired row went out, and it kept the recipient snapshot it
    // was enqueued with — not the rotated configuration.
    expect(result.sent).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].bcc).toEqual(["old-ops@example.internal"]);
    expect(delivered[0].bcc).not.toContain("new-ops@example.internal");

    const stale = await readNotificationById(2);
    expect(stale?.status).toBe("dead");
    expect(stale?.last_error_code).toBe("expired");
  });
});

describe("L25-05 closure — 重试、重复与队列上限（SMTP-12／13／14／19）", () => {
  it("SMTP-12 暂时失败后重试成功：状态转 sent 且 attempts 准确", async () => {
    await writeValidProfile("profile-retry.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-retry",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-retry" },
      recipients: ["data-ops@example.internal"],
      now
    });

    const first = await runNotificationWorkerPass(now, async () => ({
      ok: false,
      reason: "smtp_timeout" as const,
      permanent: false
    }));
    expect(first).toMatchObject({ claimed: 1, retried: 1, sent: 0, dead: 0 });
    const afterFailure = await readNotificationById(1);
    expect(afterFailure?.status).toBe("queued");
    expect(afterFailure?.attempts).toBe(1);
    expect(afterFailure?.next_attempt_at).toBe(
      new Date(now.getTime() + NOTIFICATION_BACKOFF_MS[0]).toISOString()
    );

    const retryAt = new Date(now.getTime() + NOTIFICATION_BACKOFF_MS[0]);
    const second = await runNotificationWorkerPass(retryAt, async () => ({ ok: true, accepted: 1 }));
    expect(second).toMatchObject({ claimed: 1, sent: 1, retried: 0, dead: 0 });
    const afterSuccess = await readNotificationById(1);
    expect(afterSuccess?.status).toBe("sent");
    expect(afterSuccess?.attempts).toBe(2);
    expect(afterSuccess?.last_error_code).toBeNull();
  });

  it("SMTP-13 永久故障只影响通知：行转 dead、错误码封闭，账本健康面不受影响", async () => {
    await writeValidProfile("profile-permanent.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-permanent",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-permanent" },
      recipients: ["data-ops@example.internal"],
      now
    });

    const result = await runNotificationWorkerPass(now, async () => ({
      ok: false,
      reason: "smtp_rejected" as const,
      permanent: true
    }));
    expect(result).toMatchObject({ claimed: 1, dead: 1, sent: 0, retried: 0 });
    const row = await readNotificationById(1);
    expect(row?.status).toBe("dead");
    expect(row?.last_error_code).toBe("smtp_rejected");

    // The ledger path is untouched by the notifier's own failure.
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    recordLedgerAppend(true);
    expect(getLastNotifierErrorCode()).toBe("smtp_rejected");
  });

  it("SMTP-14 SMTP 接受后未标 sent 的崩溃：租约过期后重发，重复是文档化的 at-least-once 语义", async () => {
    await writeValidProfile("profile-crash.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-crash",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-crash" },
      recipients: ["data-ops@example.internal"],
      now
    });

    // The crash point: the SMTP server already accepted the message, but the
    // process died before the row could be marked `sent`.
    const db = await getAuditDb();
    db.prepare(
      `UPDATE notification_outbox
          SET status = 'sending', attempts = 1, lease_until = ?, next_attempt_at = ?
        WHERE id = 1`
    ).run("2026-10-26T00:00:00.000Z", "2026-10-26T00:00:00.000Z");

    const deliveries: SmtpMessage[] = [];
    const result = await runNotificationWorkerPass(now, async (_view, message) => {
      deliveries.push(message);
      return { ok: true, accepted: 1 };
    });

    // The row is delivered a second time — the documented at-least-once
    // duplicate — and it ends up `sent` with the attempt count intact.
    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    expect(deliveries).toHaveLength(1);
    const row = await readNotificationById(1);
    expect(row?.status).toBe("sent");
    expect(row?.attempts).toBe(2);
  });

  it("SMTP-19 每批最多领取 20 行，其余留到下一批", async () => {
    const now = new Date("2026-10-26T00:00:00.000Z");
    for (let index = 0; index < 25; index += 1) {
      await enqueueNotification({
        eventType: "audit_ledger_unavailable",
        incidentId: `inc-batch-${index}`,
        payload: { eventType: "audit_ledger_unavailable", incidentId: `inc-batch-${index}` },
        recipients: ["data-ops@example.internal"],
        now
      });
    }

    const first = await claimDueNotifications(now);
    expect(first).toHaveLength(20);
    expect(first.every((row) => row.status === "sending")).toBe(true);

    const second = await claimDueNotifications(now);
    expect(second).toHaveLength(5);

    const third = await claimDueNotifications(now);
    expect(third).toHaveLength(0);
  });
});

describe("L25-05 closure — owner 接口边界（SMTP-06／07／15）", () => {
  it("SMTP-06 测试邮件不接受任意收件人：请求体里的地址被忽略", async () => {
    await writeValidProfile("profile-recipients.yaml");
    await getSmtpRuntimeView();

    const app = await ownerApp("owner");
    const res = await app.inject({
      method: "POST",
      url: "/api/admin/notifications/test",
      payload: {
        recipients: ["attacker@evil.example"],
        to: "attacker@evil.example",
        bcc: ["attacker@evil.example"],
        subject: "任意主题",
        text: "任意正文"
      }
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.stringify(res.json())).not.toContain("attacker@evil.example");
    await app.close();

    const row = await readNotificationById(1);
    expect(row).not.toBeNull();
    expect(JSON.parse(row?.recipients_json ?? "[]")).toEqual([
      "data-ops@example.internal",
      "sre@example.internal"
    ]);
    expect(row?.recipients_json).not.toContain("attacker@evil.example");
  });

  it("SMTP-07 未登录／非 owner 的响应不泄露配置信息，也不产生 outbox 行", async () => {
    await writeValidProfile("profile-leak.yaml");
    await getSmtpRuntimeView();

    const anonymous = await ownerApp(null);
    const anonRes = await anonymous.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(anonRes.statusCode).toBe(401);
    const anonBody = JSON.stringify(anonRes.json());
    expect(anonBody).not.toContain("smtp.example.internal");
    expect(anonBody).not.toContain("data-ops@example.internal");
    expect(anonBody).not.toContain("lucy-notifier");
    expect(anonBody).not.toContain("profile-leak.yaml");
    await anonymous.close();

    const operator = await ownerApp("operator");
    const opRes = await operator.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(opRes.statusCode).toBe(403);
    const opBody = JSON.stringify(opRes.json());
    expect(opBody).not.toContain("smtp.example.internal");
    expect(opBody).not.toContain("data-ops@example.internal");
    expect(opBody).not.toContain("lucy-notifier");
    expect(opBody).not.toContain("profile-leak.yaml");
    await operator.close();

    expect((await countNotifications()).pending).toBe(0);
  });

  it("SMTP-15 队列满时测试接口返回 NOTIFICATION_QUEUE_UNAVAILABLE（503），不是 202 也不是 NOTIFICATION_UNAVAILABLE", async () => {
    await writeValidProfile("profile-full.yaml");
    await getSmtpRuntimeView();
    await fillPendingQueue();

    const app = await ownerApp("owner");
    const res = await app.inject({ method: "POST", url: "/api/admin/notifications/test" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("NOTIFICATION_QUEUE_UNAVAILABLE");
    expect(res.json().error.message).toBe("通知队列暂不可用，请稍后重试");
    expect(res.json().error.code).not.toBe("NOTIFICATION_UNAVAILABLE");
    // A full queue must not be reported as a queued mail.
    expect(res.json()).not.toHaveProperty("notificationId");
    await app.close();
  });
});

describe("L25-05 closure — 注入与内容最小化（SMTP-17／18／20）", () => {
  it("SMTP-17 发出的邮件只有纯文本正文，没有 HTML 部件", async () => {
    await writeValidProfile("profile-injection.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-html",
      payload: { eventType: "audit_ledger_unavailable", incidentId: "inc-html" },
      recipients: ["data-ops@example.internal"],
      now
    });

    const delivered: SmtpMessage[] = [];
    await runNotificationWorkerPass(now, async (_view, message) => {
      delivered.push(message);
      return { ok: true, accepted: 1 };
    });

    expect(delivered).toHaveLength(1);
    const message = delivered[0];
    // No HTML body, no attachment, no tracking: there is no injection surface.
    expect(message).not.toHaveProperty("html");
    expect(message).not.toHaveProperty("attachments");
    expect(Object.keys(message).sort()).toEqual(["bcc", "from", "subject", "text", "to"]);
    expect(message.text).not.toContain("\r");
    expect(
      message.text.split("\n").some((line) => /^\s*(bcc|to|from|subject|content-type)\s*:/i.test(line))
    ).toBe(false);
  });

  it("SMTP-18 密码不出现在 outbox 行、审计登记与状态接口里", async () => {
    await writeValidProfile("profile-secret.yaml");
    await getSmtpRuntimeView();

    // The row is produced by the REAL producer path (the audit-health adapter),
    // not by a hand-written payload, so the assertion covers what the product
    // actually writes.
    startNotificationHealthEvents();
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    recordLedgerAppend(false);
    await vi.waitFor(async () => {
      expect((await countNotifications()).pending).toBe(1);
    });

    const now = new Date("2026-10-26T00:00:00.000Z");
    await runNotificationWorkerPass(now, async () => ({ ok: true, accepted: 1 }));

    const db = await getAuditDb();
    const row = db.prepare("SELECT * FROM notification_outbox WHERE id = 1").get() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
    expect(JSON.stringify(row)).not.toContain("AUTH ");

    const meta = db.prepare("SELECT * FROM audit_meta").all();
    expect(JSON.stringify(meta)).not.toContain(PASSWORD);
    expect(JSON.stringify(meta)).not.toContain("AUTH ");

    const app = await ownerApp("owner");
    const status = await app.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(status.statusCode).toBe(200);
    expect(JSON.stringify(status.json())).not.toContain(PASSWORD);
    expect(JSON.stringify(status.json())).not.toContain("AUTH ");
    await app.close();
  });

  it("SMTP-20 邮件正文与接口都不含查询、表数据、审计 diff、Token 或许可信息", async () => {
    await writeValidProfile("profile-minimal.yaml");
    await getSmtpRuntimeView();

    const now = new Date("2026-10-26T00:00:00.000Z");
    await enqueueNotification({
      eventType: "audit_ledger_unavailable",
      incidentId: "inc-minimal",
      payload: {
        eventType: "audit_ledger_unavailable",
        incidentId: "inc-minimal",
        observedAt: now.toISOString(),
        query: "SELECT secret_column FROM finance",
        tableData: "客户流水 12345",
        auditDiff: "before=old after=new",
        token: "bearer-token-value",
        license: "seat-license-42"
      },
      recipients: ["data-ops@example.internal"],
      now
    });

    const delivered: SmtpMessage[] = [];
    await runNotificationWorkerPass(now, async (_view, message) => {
      delivered.push(message);
      return { ok: true, accepted: 1 };
    });

    expect(delivered).toHaveLength(1);
    const body = delivered[0].text;
    expect(body).not.toContain("SELECT secret_column");
    expect(body).not.toContain("客户流水");
    expect(body).not.toContain("before=old");
    expect(body).not.toContain("bearer-token-value");
    expect(body).not.toContain("seat-license-42");

    const app = await ownerApp("owner");
    const status = await app.inject({ method: "GET", url: "/api/admin/notifications/status" });
    expect(JSON.stringify(status.json())).not.toContain("bearer-token-value");
    const one = await app.inject({ method: "GET", url: "/api/admin/notifications/1" });
    expect(one.statusCode).toBe(200);
    expect(JSON.stringify(one.json())).not.toContain("bearer-token-value");
    expect(JSON.stringify(one.json())).not.toContain("SELECT secret_column");
    await app.close();
  });
});

describe("L25-05 closure — 升级与回滚合同（SMTP-25）", () => {
  it("SMTP-25 通知初始化只升审计库 schema，不触碰安全库", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "l25-05-closure-root-"));
    const securityDb = new Database(path.join(projectRoot, "security.sqlite"));
    try {
      initSecuritySchema(securityDb);
      const before = readSchemaVersion(securityDb);
      expect(before).toBe(SECURITY_SCHEMA_VERSION);

      // Notifications are off in this deployment: the startup path still runs.
      setEnv("LUCY_SMTP_PROFILE_FILE", undefined);
      await initNotifications();

      // The security store keeps its schema version — the notifier is not an
      // authentication or ledger change.
      expect(readSchemaVersion(securityDb)).toBe(before);
      expect(SECURITY_SCHEMA_VERSION).toBe(4);

      // The audit store did move: schema 4 registers the outbox table.
      expect(AUDIT_DB_SCHEMA_VERSION).toBe(4);
      const db = await getAuditDb();
      const meta = db
        .prepare("SELECT audit_db_schema_version, running_actor FROM audit_meta WHERE audit_db_schema_version = ?")
        .get(AUDIT_DB_SCHEMA_VERSION) as { audit_db_schema_version: number; running_actor: string };
      expect(meta.audit_db_schema_version).toBe(4);
      expect(meta.running_actor).toBe("system:notifier-init");

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'notification_outbox'")
        .all() as { name: string }[];
      expect(
        indexes
          .map((entry) => entry.name)
          .filter((name) => !name.startsWith("sqlite_autoindex_"))
          .sort()
      ).toEqual(["idx_notification_outbox_due", "idx_notification_outbox_incident"]);
    } finally {
      securityDb.close();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("SMTP-25 状态摘要仍只暴露脱敏字段，升级后不新增泄露面", async () => {
    await writeValidProfile("profile-upgrade.yaml");
    const view = await getSmtpRuntimeView();
    const status = smtpRuntimeStatus(view);
    expect(Object.keys(status).sort()).toEqual([
      "auditHealth",
      "enabled",
      "errorCode",
      "recipientCount",
      "state"
    ]);
    expect(JSON.stringify(status)).not.toContain(PASSWORD);
    expect(JSON.stringify(status)).not.toContain("smtp.example.internal");
  });
});
