import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTokenExpired, normalizeExpiresAtInput } from "../proxy/identity.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { resetAdminsCache } from "../auth/admins-store.js";
import { readSessionClaims, resetSessionSecretCache, sealSession } from "../auth/session.js";
import { readFile } from "node:fs/promises";
import { isPublicApi } from "../auth/guard.js";

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

describe("isPublicApi", () => {
  it("allows help handbook and search without a session", () => {
    expect(isPublicApi("GET", "/api/help/handbook")).toBe(true);
    expect(isPublicApi("GET", "/api/help/search?q=token")).toBe(true);
    expect(isPublicApi("POST", "/api/help/handbook")).toBe(false);
    expect(isPublicApi("GET", "/api/admin/agents")).toBe(false);
  });

  it("allows branding GET without a session (Spec 126)", () => {
    expect(isPublicApi("GET", "/api/branding")).toBe(true);
    expect(isPublicApi("GET", "/api/branding/logo")).toBe(true);
    expect(isPublicApi("PUT", "/api/branding")).toBe(false);
  });
});

describe("isTokenExpired / normalizeExpiresAtInput", () => {
  it("treats null/empty as never expired", () => {
    expect(isTokenExpired(null)).toBe(false);
    expect(isTokenExpired(undefined)).toBe(false);
    expect(isTokenExpired("")).toBe(false);
  });

  it("expires past timestamps and fail-closes on garbage", () => {
    expect(isTokenExpired("2020-01-01T00:00:00.000Z", Date.parse("2026-08-20T00:00:00Z"))).toBe(true);
    expect(isTokenExpired("2099-01-01T00:00:00.000Z", Date.parse("2026-08-20T00:00:00Z"))).toBe(false);
    expect(isTokenExpired("not-a-date")).toBe(true);
  });

  it("treats date-only as end of UTC day", () => {
    expect(isTokenExpired("2026-08-20", Date.parse("2026-08-20T12:00:00.000Z"))).toBe(false);
    expect(isTokenExpired("2026-08-20", Date.parse("2026-08-21T00:00:00.000Z"))).toBe(true);
  });

  it("normalizes date-only create input", () => {
    expect(normalizeExpiresAtInput("2026-08-20")).toBe("2026-08-20T23:59:59.999Z");
    expect(normalizeExpiresAtInput(null)).toBe(null);
    expect(() => normalizeExpiresAtInput("nope")).toThrow(/expires_at/);
  });
});

describe("password hashing", () => {
  it("round-trips scrypt hashes", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("webui session secret persistence", () => {
  let tempRoot: string;
  let previousProjectDir: string | undefined;
  let previousSessionSecret: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-session-"));
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    previousProjectDir = process.env.KTX_PROJECT_ROOT;
    previousSessionSecret = process.env.LUCY_WEBUI_SESSION_SECRET;
    process.env.KTX_PROJECT_ROOT = tempRoot;
    delete process.env.LUCY_WEBUI_SESSION_SECRET;
    resetSessionSecretCache();
  });

  afterEach(async () => {
    if (previousProjectDir === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousProjectDir;
    if (previousSessionSecret === undefined) delete process.env.LUCY_WEBUI_SESSION_SECRET;
    else process.env.LUCY_WEBUI_SESSION_SECRET = previousSessionSecret;
    resetSessionSecretCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("keeps the same secret file across process restarts", async () => {
    const claims = {
      v: 2 as const,
      jti: "jti-a",
      uid: "uid-a",
      ep: 0,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    };
    const first = await sealSession(claims);
    const secretPath = path.join(tempRoot, ".ktx-ui/webui-session-secret");
    const stored = await readFile(secretPath, "utf8");
    resetSessionSecretCache();
    const second = await sealSession({ ...claims, jti: "jti-b" });
    expect(await readFile(secretPath, "utf8")).toBe(stored);
    const cookieOf = (token: string) => ({ headers: { cookie: `lucy_admin_session=${encodeURIComponent(token)}` } }) as never;
    expect((await readSessionClaims(cookieOf(first)))?.uid).toBe("uid-a");
    expect((await readSessionClaims(cookieOf(second)))?.jti).toBe("jti-b");
  });
});

describe("webui admin auth API", () => {
  let tempRoot: string;
  let previousProjectDir: string | undefined;
  let previousAuth: string | undefined;
  let previousAdminsPath: string | undefined;
  let previousSessionSecret: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-auth-"));
    await mkdir(path.join(tempRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await writeFile(
      path.join(tempRoot, "webui", "config", "admins.yaml"),
      'version: "1"\nadmins: []\n',
      "utf8"
    );
    await writeFile(path.join(tempRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");

    previousProjectDir = process.env.KTX_PROJECT_ROOT;
    previousAuth = process.env.LUCY_WEBUI_AUTH;
    previousAdminsPath = process.env.LUCY_ADMINS_CONFIG_PATH;
    previousSessionSecret = process.env.LUCY_WEBUI_SESSION_SECRET;

    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_ADMINS_CONFIG_PATH = path.join(tempRoot, "webui", "config", "admins.yaml");
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    delete process.env.LUCY_WEBUI_AUTH;
    resetAdminsCache();
    resetSessionSecretCache();
  });

  afterEach(async () => {
    if (previousProjectDir === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousProjectDir;
    if (previousAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
    else process.env.LUCY_WEBUI_AUTH = previousAuth;
    if (previousAdminsPath === undefined) delete process.env.LUCY_ADMINS_CONFIG_PATH;
    else process.env.LUCY_ADMINS_CONFIG_PATH = previousAdminsPath;
    if (previousSessionSecret === undefined) delete process.env.LUCY_WEBUI_SESSION_SECRET;
    else process.env.LUCY_WEBUI_SESSION_SECRET = previousSessionSecret;
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("stays open when no admins are configured", async () => {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mode).toBe("open");
    const agents = await app.inject({ method: "GET", url: "/api/admin/agents" });
    expect(agents.statusCode).not.toBe(401);
    await app.close();
  });

  it("bootstraps first owner and requires login afterwards", async () => {
    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();

    const blocked = await app.inject({ method: "GET", url: "/api/admin/agents" });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe("AUTH_BOOTSTRAP_REQUIRED");

    const boot = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { adminId: "xingchen", displayName: "星尘", password: "correct-horse" }
    });
    expect(boot.statusCode).toBe(200);
    expect(boot.json().data.me.id).toBe("xingchen");
    const cookie = boot.headers["set-cookie"];
    expect(cookie).toBeTruthy();

    const cookieHeader = Array.isArray(cookie) ? cookie[0] : cookie;
    const sessionPair = String(cookieHeader).split(";")[0];

    const ok = await app.inject({
      method: "GET",
      url: "/api/admin/admins",
      headers: { cookie: sessionPair }
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.admins).toHaveLength(1);

    const denied = await app.inject({ method: "GET", url: "/api/admin/agents" });
    expect(denied.statusCode).toBe(401);
    expect(denied.json().error.code).toBe("AUTH_REQUIRED");

    const help = await app.inject({ method: "GET", url: "/api/help/handbook" });
    expect(help.statusCode).toBe(200);
    expect(help.json().ok).toBe(true);
    expect(help.json().data?.sourcePath).toBe("docs/SYSTEM_HANDBOOK.md");

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "xingchen", password: "correct-horse" }
    });
    expect(login.statusCode).toBe(200);

    await app.close();
  });

  // Regression: a non-owner asking to create an account was DENIED with 403 and the
  // server then died. `requireOwner` fired `void reply.send(...)` and the route
  // returned `undefined`, so Fastify sent a SECOND response after the first one:
  // `reply.sent` is only true once the response has ENDED, so the framework's own
  // send raced the first one and `writeHead` threw ERR_HTTP_HEADERS_SENT from the
  // onSend hook chain — an uncaught exception that killed the whole process.
  // One request from any authenticated operator could take the instance down.
  it("denies a non-owner creating an account with 403 and keeps the server alive", async () => {
    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { adminId: "xingchen", displayName: "星尘", password: "correct-horse" }
    });
    expect(boot.statusCode).toBe(200);
    const ownerCookie = String(Array.isArray(boot.headers["set-cookie"]) ? boot.headers["set-cookie"][0] : boot.headers["set-cookie"]).split(";")[0];

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "op-one", displayName: "op-one", password: "operator-password-1", role: "operator" }
    });
    expect(created.statusCode).toBe(200);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "op-one", password: "operator-password-1" }
    });
    expect(login.statusCode).toBe(200);
    const operatorCookie = String(Array.isArray(login.headers["set-cookie"]) ? login.headers["set-cookie"][0] : login.headers["set-cookie"]).split(";")[0];

    const denied = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: operatorCookie },
      payload: { adminId: "op-made-admin", displayName: "op-made-admin", password: "op-made-password-1", role: "owner" }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("OWNER_REQUIRED");

    // The instance must still serve requests: before the fix the double send killed it.
    const alive = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(alive.statusCode).toBe(200);
    const stillOwner = await app.inject({ method: "GET", url: "/api/admin/admins", headers: { cookie: ownerCookie } });
    expect(stillOwner.statusCode).toBe(200);

    // On a real server the second send is an uncaught exception that kills the process.
    // Under `inject` the same throw surfaces as an unhandled rejection, so it is captured
    // explicitly here: the regression must be a HARD failure, not a warning.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await app.inject({
        method: "POST",
        url: "/api/admin/admins",
        headers: { cookie: operatorCookie },
        payload: { adminId: "op-made-admin-2", displayName: "op-made-admin-2", password: "op-made-password-2", role: "owner" }
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);

    await app.close();
  });

  it("rejects wrong password", async () => {
    process.env.LUCY_WEBUI_AUTH = "required";
    const password_hash = await hashPassword("correct-horse");
    await writeFile(
      path.join(tempRoot, "webui", "config", "admins.yaml"),
      `version: "1"\nadmins:\n  - id: xingchen\n    display_name: 星尘\n    password_hash: "${password_hash}"\n    role: owner\n    enabled: true\n    created_at: "2026-08-20T00:00:00.000Z"\n`,
      "utf8"
    );
    resetAdminsCache();
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const bad = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "xingchen", password: "wrong-password" }
    });
    expect(bad.statusCode).toBe(401);
    await app.close();
  });
});

describe("SEC-01: unknown or corrupt admin configuration never opens or elevates (T02)", () => {
  let tempRoot: string;
  let adminsPath: string;
  const KEYS = [
    "KTX_PROJECT_ROOT",
    "LUCY_ADMINS_CONFIG_PATH",
    "LUCY_WEBUI_SESSION_SECRET",
    "LUCY_WEBUI_AUTH",
    "LUCY_DEPLOYMENT_MODE"
  ] as const;
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-admin-config-"));
    await mkdir(path.join(tempRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(tempRoot, "wiki", "global"), { recursive: true });
    adminsPath = path.join(tempRoot, "webui", "config", "admins.yaml");
    await writeFile(path.join(tempRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    for (const key of KEYS) saved[key] = process.env[key];
    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_ADMINS_CONFIG_PATH = adminsPath;
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_AUTH;
    resetAdminsCache();
    resetSessionSecretCache();
  });

  afterEach(async () => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function adminRow(role: string | null): Promise<string> {
    const hash = await hashPassword("correct-horse");
    const roleLine = role === null ? "" : `    role: ${role}\n`;
    return `version: "1"\nadmins:\n  - id: xingchen\n    display_name: 星尘\n    password_hash: "${hash}"\n${roleLine}    enabled: true\n    created_at: "2026-10-18T00:00:00.000Z"\n`;
  }

  async function start() {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    return app;
  }

  const WIKI = { method: "PUT" as const, url: "/api/wiki/global%2Fanon-probe.md", payload: { dryRun: false, content: "# probe\n" } };

  it("normalizeWebuiAdminRole accepts owner/operator/admin and rejects everything else (no default owner)", async () => {
    const { normalizeWebuiAdminRole } = await import("../auth/admins-store.js");
    expect(normalizeWebuiAdminRole("owner")).toBe("owner");
    expect(normalizeWebuiAdminRole("operator")).toBe("operator");
    expect(normalizeWebuiAdminRole("admin")).toBe("operator");
    for (const bad of [undefined, null, "", "root", "Owner", "superuser", 1, {}]) {
      expect(() => normalizeWebuiAdminRole(bad)).toThrow();
    }
  });

  it.each([
    ["unknown role", async () => adminRow("superuser")],
    ["missing role", async () => adminRow(null)],
    ["invalid YAML", async () => "version: [unterminated\nadmins: {{{"],
    ["admins is not a list", async () => 'version: "1"\nadmins: owner\n'],
    ["entry without a password hash", async () => 'version: "1"\nadmins:\n  - id: xingchen\n    role: owner\n']
  ])("%s → auth is unavailable (503), not open and not owner", async (_label, content) => {
    await writeFile(adminsPath, await content(), "utf8");
    const app = await start();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.mode).toBe("unavailable");
    expect(status.json().data.authEnabled).toBe(true);

    const put = await app.inject(WIKI);
    expect(put.statusCode).toBe(503);
    expect(put.json().error.code).toBe("AUTH_CONFIG_UNAVAILABLE");
    await expect(readFile(path.join(tempRoot, "wiki", "global", "anon-probe.md"), "utf8")).rejects.toThrow();

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "xingchen", password: "correct-horse" }
    });
    expect(login.statusCode).toBe(503);
    expect(login.headers["set-cookie"]).toBeUndefined();
    await app.close();
  });

  it("missing and empty admins files in customer mode go to bootstrap (401), never open", async () => {
    for (const content of [null, "", 'version: "1"\nadmins: []\n']) {
      if (content === null) await rm(adminsPath, { force: true });
      else await writeFile(adminsPath, content, "utf8");
      resetAdminsCache();
      const app = await start();
      expect((await app.inject({ method: "GET", url: "/api/auth/status" })).json().data.mode).toBe("bootstrap");
      expect((await app.inject(WIKI)).statusCode).toBe(401);
      await app.close();
    }
  });

  it("a valid config still logs in and keeps its role", async () => {
    await writeFile(adminsPath, await adminRow("operator"), "utf8");
    const app = await start();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "xingchen", password: "correct-horse" }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data.me.role).toBe("operator");
    await app.close();
  });
});
