import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTokenExpired, normalizeExpiresAtInput } from "../proxy/identity.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";
import { isPublicApi } from "../auth/guard.js";

vi.mock("../admin/audit.js", () => ({
  getAuditDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })),
    exec: vi.fn(),
    pragma: vi.fn()
  })),
  recordConfigChange: vi.fn(async () => 1),
  updateConfigChangeStatus: vi.fn(async () => undefined),
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
