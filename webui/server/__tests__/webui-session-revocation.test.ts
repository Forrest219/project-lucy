import { createHmac } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealSession } from "../auth/session.js";
import { closeSecurityStore } from "../security/instance.js";
import { SecurityStore } from "../security/store.js";
import {
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
const MINUTE = 60_000;

describe("V-03 / SEC-04: durable, revocable v2 sessions over real HTTP (T03)", () => {
  let fx: AuthFixture;
  let lucy: RunningLucy;

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "file" });
    await fx.writeAdmins([OWNER, OPERATOR]);
    lucy = await startLucy();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await lucy.stop();
    await fx.restore();
  });

  it("logout → replay 401 → restart the process → replay is still 401", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);

    const out = await api(lucy.baseUrl, "POST", "/api/auth/logout", cookie);
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");

    const replay = await protectedAdminRead(lucy.baseUrl, cookie);
    expect(replay.status).toBe(401);
    expect((await replay.json()).error.code).toBe("AUTH_REQUIRED");

    lucy = await restartLucy(lucy);
    const afterRestart = await protectedAdminRead(lucy.baseUrl, cookie);
    expect(afterRestart.status).toBe(401);
    expect((await afterRestart.json()).error.code).toBe("AUTH_REQUIRED");

    // The account itself is untouched: a fresh login works.
    const fresh = await loginCookie(lucy.baseUrl, OWNER.id);
    expect((await protectedAdminRead(lucy.baseUrl, fresh)).status).toBe(200);
  });

  it("logging out one session does not end the account's other sessions", async () => {
    const a = await loginCookie(lucy.baseUrl, OWNER.id);
    const b = await loginCookie(lucy.baseUrl, OWNER.id);
    await api(lucy.baseUrl, "POST", "/api/auth/logout", a);
    expect((await protectedAdminRead(lucy.baseUrl, a)).status).toBe(401);
    expect((await protectedAdminRead(lucy.baseUrl, b)).status).toBe(200);
  });

  it("logout without a session cookie is a harmless success", async () => {
    const res = await api(lucy.baseUrl, "POST", "/api/auth/logout");
    expect(res.status).toBe(200);
  });

  it("logout does not report success when the revocation cannot be made durable", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    vi.spyOn(SecurityStore.prototype, "revokeSession").mockReturnValue({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "readonly",
      message: "simulated"
    });
    const out = await api(lucy.baseUrl, "POST", "/api/auth/logout", cookie);
    expect(out.status).toBe(503);
    expect((await out.json()).error.code).toBe("AUTH_STATE_UNAVAILABLE");
    // A cleared cookie is not a substitute for revocation, so the failure keeps the cookie.
    expect(out.headers.get("set-cookie")).toBeNull();

    vi.restoreAllMocks();
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);
  });

  it("an unreadable session store answers 503 AUTH_STATE_UNAVAILABLE, never 'no administrator'", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    vi.spyOn(SecurityStore.prototype, "validateSession").mockReturnValue({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "busy",
      message: "simulated"
    });
    const res = await protectedAdminRead(lucy.baseUrl, cookie);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AUTH_STATE_UNAVAILABLE");
    // No cookie at all is still the ordinary 401.
    expect((await api(lucy.baseUrl, "GET", "/api/admin/admins")).status).toBe(401);
  });

  it("login fails closed (503) when the session cannot be persisted", async () => {
    vi.spyOn(SecurityStore.prototype, "createSession").mockReturnValue({
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "io_error",
      message: "simulated"
    });
    const res = await login(lucy.baseUrl, OWNER.id);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("AUTH_STATE_UNAVAILABLE");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("disabling an account ends its session on the very next request (regression), and re-enabling does not revive it", async () => {
    const owner = await loginCookie(lucy.baseUrl, OWNER.id);
    const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(200);

    const off = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, { enabled: false });
    expect(off.status).toBe(200);
    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);

    const on = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, { enabled: true });
    expect(on.status).toBe(200);
    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
    expect((await protectedAdminRead(lucy.baseUrl, await loginCookie(lucy.baseUrl, OPERATOR.id))).status).toBe(200);
  });

  it("resetting a password invalidates the old cookie but keeps the owner's own session out of it", async () => {
    const owner = await loginCookie(lucy.baseUrl, OWNER.id);
    const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);

    const reset = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, {
      password: "another-long-password"
    });
    expect(reset.status).toBe(200);

    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
    expect((await protectedAdminRead(lucy.baseUrl, owner)).status).toBe(200);
    expect((await login(lucy.baseUrl, OPERATOR.id)).status).toBe(401);
    expect((await login(lucy.baseUrl, OPERATOR.id, "another-long-password")).status).toBe(200);
  });

  it("a role change ends that account's sessions", async () => {
    const owner = await loginCookie(lucy.baseUrl, OWNER.id);
    const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
    const promote = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, { role: "owner" });
    expect(promote.status).toBe(200);
    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
  });

  it("raises the epoch BEFORE the configuration write (narrowing order)", async () => {
    const owner = await loginCookie(lucy.baseUrl, OWNER.id);
    const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
    const before = await readFile(fx.adminsPath, "utf8");

    const bump = SecurityStore.prototype.bumpSessionEpoch;
    let configAtBump: string | null = null;
    vi.spyOn(SecurityStore.prototype, "bumpSessionEpoch").mockImplementation(function (
      this: SecurityStore,
      uid: string
    ) {
      configAtBump = readFileSync(fx.adminsPath, "utf8");
      return bump.call(this, uid);
    });

    const reset = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, {
      password: "another-long-password"
    });
    expect(reset.status).toBe(200);
    expect(configAtBump).toBe(before);
    expect(await readFile(fx.adminsPath, "utf8")).not.toBe(before);
    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
  });

  it("if the configuration write fails after the epoch was raised, the old session stays dead and nothing widens", async () => {
    const owner = await loginCookie(lucy.baseUrl, OWNER.id);
    const operator = await loginCookie(lucy.baseUrl, OPERATOR.id);
    const before = await readFile(fx.adminsPath, "utf8");

    const audit = await import("../admin/audit.js");
    vi.mocked(audit.recordConfigChange).mockRejectedValueOnce(new Error("simulated write failure"));
    const reset = await api(lucy.baseUrl, "PATCH", `/api/admin/admins/${OPERATOR.id}`, owner, {
      password: "another-long-password"
    });
    expect(reset.status).toBeGreaterThanOrEqual(500);
    expect(await readFile(fx.adminsPath, "utf8")).toBe(before);

    expect((await protectedAdminRead(lucy.baseUrl, operator)).status).toBe(401);
    // The old password is unchanged and can still sign in again.
    expect((await login(lucy.baseUrl, OPERATOR.id)).status).toBe(200);
  });

  it("rejects v1 stateless cookies even when correctly signed", async () => {
    await loginCookie(lucy.baseUrl, OWNER.id); // creates the secret file and the account uid
    const secretNow = (await readFile(fx.secretPath, "utf8")).trim();
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ adminId: OWNER.id, iat: now, exp: now + 3600 })).toString("base64url");
    const sig = createHmac("sha256", secretNow).update(body).digest("base64url");
    const res = await protectedAdminRead(lucy.baseUrl, `lucy_admin_session=${encodeURIComponent(`${body}.${sig}`)}`);
    expect(res.status).toBe(401);
  });

  it("rejects a correctly signed v2 cookie whose claims do not match the persisted session", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    const token = decodeURIComponent(cookie.split("=")[1] ?? "");
    const claims = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));

    const forgedEpoch = await sealSession({ ...claims, ep: claims.ep + 1 });
    expect((await protectedAdminRead(lucy.baseUrl, `lucy_admin_session=${encodeURIComponent(forgedEpoch)}`)).status).toBe(401);
    const forgedUid = await sealSession({ ...claims, uid: "00000000-0000-4000-8000-000000000000" });
    expect((await protectedAdminRead(lucy.baseUrl, `lucy_admin_session=${encodeURIComponent(forgedUid)}`)).status).toBe(401);
    const unknownJti = await sealSession({ ...claims, jti: "A".repeat(43) });
    expect((await protectedAdminRead(lucy.baseUrl, `lucy_admin_session=${encodeURIComponent(unknownJti)}`)).status).toBe(401);
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(200);
  });

  it("the session claims carry a 256-bit jti, the immutable account uid and the epoch; the store keeps only a hash", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    const token = decodeURIComponent(cookie.split("=")[1] ?? "");
    const claims = JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8"));
    expect(claims.v).toBe(2);
    expect(Buffer.from(claims.jti, "base64url")).toHaveLength(32);
    expect(claims.uid).toBe((await fx.readAdmins())[0].account_uid);
    expect(claims.ep).toBe(0);
    expect(claims).not.toHaveProperty("adminId");

    closeSecurityStore();
    const raw = await readFile(fx.securityDbPath);
    expect(raw.includes(Buffer.from(claims.jti))).toBe(false);
    expect(raw.includes(Buffer.from(token))).toBe(false);
  });

  it("expires an idle session after 30 minutes, and activity keeps it alive", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const idle = await loginCookie(lucy.baseUrl, OWNER.id);
    const active = await loginCookie(lucy.baseUrl, OWNER.id);

    vi.setSystemTime(Date.now() + 20 * MINUTE);
    expect((await protectedAdminRead(lucy.baseUrl, active)).status).toBe(200);
    vi.setSystemTime(Date.now() + 20 * MINUTE);
    expect((await protectedAdminRead(lucy.baseUrl, active)).status).toBe(200);
    expect((await protectedAdminRead(lucy.baseUrl, idle)).status).toBe(401);
  });

  it("an idle expiry is permanent: the cookie stays dead after later activity windows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(401);
    vi.setSystemTime(Date.now() - 20 * MINUTE);
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(401);
  });

  it("enforces a 12-hour absolute limit even for a continuously active session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    let alive = 0;
    for (let i = 0; i < 40; i += 1) {
      vi.setSystemTime(Date.now() + 20 * MINUTE);
      const status = (await protectedAdminRead(lucy.baseUrl, cookie)).status;
      if (status !== 200) break;
      alive += 1;
    }
    // 12h / 20min = 36 steps; the 36th lands exactly on the limit and must already be refused.
    expect(alive).toBeGreaterThanOrEqual(35);
    expect(alive).toBeLessThan(36);
    expect((await protectedAdminRead(lucy.baseUrl, cookie)).status).toBe(401);
  });

  it("issues the cookie with HttpOnly, SameSite=Lax, Path=/, Secure and an absolute Max-Age of at most 12h", async () => {
    const res = await login(lucy.baseUrl, OWNER.id);
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    const maxAge = Number(/Max-Age=(\d+)/.exec(header)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(12 * 60 * 60);
  });

  it("marks authentication and admin API responses Cache-Control: no-store (success and failure)", async () => {
    const cookie = await loginCookie(lucy.baseUrl, OWNER.id);
    const checks: Response[] = [
      await protectedAdminRead(lucy.baseUrl, cookie),
      await api(lucy.baseUrl, "GET", "/api/auth/me", cookie),
      await api(lucy.baseUrl, "GET", "/api/auth/status", cookie),
      await login(lucy.baseUrl, OWNER.id),
      await login(lucy.baseUrl, OWNER.id, "wrong-password-xx"),
      await api(lucy.baseUrl, "GET", "/api/admin/admins"),
      await api(lucy.baseUrl, "POST", "/api/auth/logout", cookie)
    ];
    for (const res of checks) expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("does not turn a cookie from another secret or garbage into a session", async () => {
    for (const raw of ["garbage", "a.b", `${"x".repeat(20)}.${"y".repeat(43)}`]) {
      expect((await protectedAdminRead(lucy.baseUrl, `lucy_admin_session=${encodeURIComponent(raw)}`)).status).toBe(401);
    }
  });
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

describe("V-03 / SEC-04: logout survives a REAL process restart (separate OS process)", () => {
  let fx: AuthFixture;
  let child: ChildProcess | null = null;

  const spawnLucy = async (port: number, proxyPort: number): Promise<void> => {
    child = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
      cwd: path.resolve(__dirname, "../.."),
      env: {
        ...process.env,
        LUCY_WEBUI_PORT: String(port),
        LUCY_WEBUI_HOST: "127.0.0.1",
        LUCY_PROXY_HOST: "127.0.0.1",
        LUCY_PROXY_PORT: String(proxyPort),
        LUCY_AUDIT_DB: path.join(fx.root, "audit.sqlite"),
        POSTHOG_DISABLED: "1"
      },
      stdio: "ignore"
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline) throw new Error("child server did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  const killLucy = async (): Promise<void> => {
    const current = child;
    child = null;
    if (!current || current.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      current.once("exit", () => resolve());
      current.kill("SIGKILL");
    });
  };

  beforeEach(async () => {
    fx = await createAuthFixture({ secret: "file" });
    await fx.writeAdmins([OWNER]);
  });

  afterEach(async () => {
    await killLucy();
    await fx.restore();
  });

  it("logout → replay 401 → kill -9 and start a new process → replay still 401", async () => {
    const port = await freePort();
    const proxyPort = await freePort();
    const base = `http://127.0.0.1:${port}`;
    await spawnLucy(port, proxyPort);

    const cookie = await loginCookie(base, OWNER.id);
    expect((await protectedAdminRead(base, cookie)).status).toBe(200);
    expect((await api(base, "POST", "/api/auth/logout", cookie)).status).toBe(200);
    expect((await protectedAdminRead(base, cookie)).status).toBe(401);

    await killLucy();
    await spawnLucy(port, proxyPort);
    expect((await protectedAdminRead(base, cookie)).status).toBe(401);
    expect((await protectedAdminRead(base, await loginCookie(base, OWNER.id))).status).toBe(200);
  }, 120_000);
});
