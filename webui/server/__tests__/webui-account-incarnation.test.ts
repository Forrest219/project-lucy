import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSessionSecretCache } from "../auth/session.js";
import { closeSecurityStore } from "../security/instance.js";
import { openSecurityStore } from "../security/store.js";
import {
  PASSWORD,
  api,
  createAuthFixture,
  login,
  loginCookie,
  protectedAdminRead,
  restartLucy,
  startLucy,
  type AuthFixture,
  type RunningLucy
} from "./webui-auth-fixture.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const OWNER = { id: "owner1", role: "owner" as const };
const OPERATOR = { id: "ops1", role: "operator" as const };

describe("V-03 / SEC-04: account incarnation, migration and recovery (T03)", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;

  afterEach(async () => {
    vi.restoreAllMocks();
    await lucy?.stop();
    await fx?.restore();
  });

  describe("with a stable session secret", () => {
    beforeEach(async () => {
      fx = await createAuthFixture({ secret: "file" });
      await fx.writeAdmins([OWNER, OPERATOR]);
      lucy = await startLucy();
    });

    it("assigns an immutable account_uid to a legacy account on first login and keeps it", async () => {
      expect((await fx.readAdmins()).every((a) => a.account_uid === undefined)).toBe(true);
      await loginCookie(lucy.baseUrl, OWNER.id);
      const first = (await fx.readAdmins()).find((a) => a.id === OWNER.id)?.account_uid;
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      await loginCookie(lucy.baseUrl, OWNER.id);
      lucy = await restartLucy(lucy);
      await loginCookie(lucy.baseUrl, OWNER.id);
      expect((await fx.readAdmins()).find((a) => a.id === OWNER.id)?.account_uid).toBe(first);
    });

    it("delete then recreate with the same id: the old cookie is dead, the new account gets a new uid", async () => {
      const owner = await loginCookie(lucy.baseUrl, OWNER.id);
      const operatorOld = await loginCookie(lucy.baseUrl, OPERATOR.id);
      const oldUid = (await fx.readAdmins()).find((a) => a.id === OPERATOR.id)?.account_uid;
      expect(oldUid).toBeTruthy();

      expect((await api(lucy.baseUrl, "DELETE", `/api/admin/admins/${OPERATOR.id}`, owner)).status).toBe(200);
      expect((await protectedAdminRead(lucy.baseUrl, operatorOld)).status).toBe(401);

      const recreated = await api(lucy.baseUrl, "POST", "/api/admin/admins", owner, {
        adminId: OPERATOR.id,
        password: PASSWORD,
        role: "operator"
      });
      expect(recreated.status).toBe(200);
      const newUid = (await fx.readAdmins()).find((a) => a.id === OPERATOR.id)?.account_uid;
      expect(newUid).toBeTruthy();
      expect(newUid).not.toBe(oldUid);

      // Same id, same role, same password — and the pre-delete cookie still must not work, now or after a restart.
      expect((await protectedAdminRead(lucy.baseUrl, operatorOld)).status).toBe(401);
      lucy = await restartLucy(lucy);
      expect((await protectedAdminRead(lucy.baseUrl, operatorOld)).status).toBe(401);
      const fresh = await loginCookie(lucy.baseUrl, OPERATOR.id);
      expect((await protectedAdminRead(lucy.baseUrl, fresh)).status).toBe(200);

      closeSecurityStore();
      const store = openSecurityStore(fx.root);
      if (!store.ok) throw new Error(store.message);
      try {
        expect(store.value.getAccount(oldUid as string)).toMatchObject({ ok: true, value: { status: "tombstoned" } });
      } finally {
        store.value.close();
      }
    });

    it("restoring an older admins.yaml after a password reset does not revive the old cookie", async () => {
      const owner = await loginCookie(lucy.baseUrl, OWNER.id);
      const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
      const snapshot = await readFile(fx.adminsPath, "utf8");

      await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, { password: "another-long-password" });
      await writeFile(fx.adminsPath, snapshot, "utf8");
      lucy = await restartLucy(lucy);
      expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
    });

    it("a delete followed by a restored admins.yaml (account is back with its old uid) stays tombstoned", async () => {
      const owner = await loginCookie(lucy.baseUrl, OWNER.id);
      const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
      const snapshot = await readFile(fx.adminsPath, "utf8");

      await api(lucy.baseUrl, "DELETE", `/api/admin/admins/${OPERATOR.id}`, owner);
      await writeFile(fx.adminsPath, snapshot, "utf8");
      lucy = await restartLucy(lucy);
      expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
      expect((await login(lucy.baseUrl, OPERATOR.id)).status).toBe(401);
    });

    it("an older security.sqlite snapshot revives sessions only until the session key is rotated (runbook step)", async () => {
      const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
      await lucy.stop();
      closeSecurityStore();
      const snapshot = `${fx.securityDbPath}.snapshot`;
      await copyFile(fx.securityDbPath, snapshot);

      lucy = await startLucy();
      expect((await api(lucy.baseUrl, "POST", "/api/auth/logout", cookie)).status).toBe(200);
      expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(401);
      await lucy.stop();
      closeSecurityStore();

      // Controlled restore of the older snapshot, as an operator might do from a backup.
      await rm(`${fx.securityDbPath}-wal`, { force: true });
      await rm(`${fx.securityDbPath}-shm`, { force: true });
      await copyFile(snapshot, fx.securityDbPath);

      // Runbook: rotate the session key (and nothing else) before reopening.
      await rm(fx.secretPath, { force: true });
      resetSessionSecretCache(); // the operator restarts the process after rotating
      lucy = await startLucy();
      expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(401);
      expect((await protectedAdminRead(lucy.baseUrl, await loginCookie(lucy.baseUrl, OWNER.id))).status).toBe(200);
    });

    it("a store that marks the account disabled fails closed even if admins.yaml says enabled", async () => {
      const owner = await loginCookie(lucy.baseUrl, OWNER.id);
      const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
      const uid = (await fx.readAdmins()).find((a) => a.id === OPERATOR.id)?.account_uid as string;

      closeSecurityStore();
      const store = openSecurityStore(fx.root);
      if (!store.ok) throw new Error(store.message);
      try {
        expect(store.value.setAccountStatus(uid, "disabled").ok).toBe(true);
      } finally {
        store.value.close();
      }
      expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
      expect((await login(lucy.baseUrl, OPERATOR.id)).status).toBe(401);
      expect((await protectedAdminRead(lucy.baseUrl, owner)).status).toBe(200);
    });
  });

  describe("session secret strength", () => {
    it("rotates a weak persisted secret file to at least 32 bytes (old sessions end with it)", async () => {
      fx = await createAuthFixture({ secret: "file" });
      await fx.writeAdmins([OWNER]);
      await writeFile(fx.secretPath, "short-secret\n", { encoding: "utf8", mode: 0o600 });
      lucy = await startLucy();

      const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
      const stored = (await readFile(fx.secretPath, "utf8")).trim();
      expect(stored).not.toBe("short-secret");
      expect(Buffer.byteLength(stored)).toBeGreaterThanOrEqual(32);
      expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);
    });

    it("refuses sessions (503) when LUCY_WEBUI_SESSION_SECRET is shorter than 32 bytes", async () => {
      fx = await createAuthFixture({ secret: "env" });
      await fx.writeAdmins([OWNER]);
      process.env.LUCY_WEBUI_SESSION_SECRET = "too-short";
      lucy = await startLucy();
      const res = await login(lucy.baseUrl, OWNER.id);
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("AUTH_STATE_UNAVAILABLE");
      expect(res.headers.get("set-cookie")).toBeNull();
    });
  });

  it("bootstrap creates the owner with an account_uid and a v2 session", async () => {
    fx = await createAuthFixture({ secret: "file" });
    await fx.writeAdmins([]);
    const tokenFile = `${fx.root}/bootstrap-token`;
    await writeFile(tokenFile, "bootstrap-token-for-tests-0123456789\n", "utf8");
    const previous = process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE;
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = tokenFile;
    try {
      lucy = await startLucy();
      const res = await fetch(`${lucy.baseUrl}/api/auth/bootstrap`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lucy-bootstrap-token": "bootstrap-token-for-tests-0123456789" },
        body: JSON.stringify({ adminId: "first1", displayName: "First", password: PASSWORD })
      });
      expect(res.status).toBe(200);
      const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
      expect((await fx.readAdmins())[0].account_uid).toMatch(/^[0-9a-f-]{36}$/);
      expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);
      lucy = await restartLucy(lucy);
      expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE;
      else process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = previous;
    }
  });
});
