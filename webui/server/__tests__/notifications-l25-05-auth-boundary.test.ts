import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerAdminAccountRoutes, registerAuthRoutes } from "../auth/routes.js";
import { isPublicApi } from "../auth/guard.js";
import {
  ADMIN_ID_RE,
  findAdmin,
  loadAdminsConfig,
  resetAdminsCache
} from "../auth/admins-store.js";
import { registerNotificationRoutes } from "../admin/notifications.js";

/**
 * Lucy v0.25 — L25-05 可选 SMTP 通知: the login / recovery boundary.
 *
 * SMTP-05 asks for a very specific thing: the notification feature must not
 * become a way to recover an account, and the account id must stay the login
 * principal. Both are observable facts about the route table and the account
 * store — not about the mail itself.
 */

const ADMINS_YAML = `version: "1"
admins:
  - id: owner1
    display_name: Owner
    password_hash: "scrypt$not-a-real-hash$not-a-real-hash"
    role: owner
    enabled: true
    created_at: "2026-01-01T00:00:00.000Z"
`;

/** Paths that would mean "the account can be recovered or activated by mail". */
const FORBIDDEN_API_PATH =
  /forgot|reset[-_]?password|password[-_]?reset|verify[-_]?(code|email|otp)|otp|magic[-_]?link|license|licence|activat/i;

let root: string;
let previousEnv: Record<string, string | undefined> = {};

function setEnv(name: string, value: string | undefined): void {
  if (!(name in previousEnv)) previousEnv[name] = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "l25-05-auth-boundary-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  const adminsPath = path.join(root, "admins.yaml");
  await writeFile(adminsPath, ADMINS_YAML, "utf8");
  setEnv("LUCY_ADMINS_CONFIG_PATH", adminsPath);
  setEnv("LUCY_DEPLOYMENT_MODE", "customer");
  setEnv("LUCY_WEBUI_AUTH", undefined);
  resetAdminsCache();
});

afterEach(() => {
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  previousEnv = {};
  resetAdminsCache();
});

describe("L25-05 closure — 登录与恢复边界（SMTP-05）", () => {
  it("SMTP-05 认证与管理路由里没有忘记密码／验证码／许可入口", async () => {
    const routes: string[] = [];
    const app = Fastify();
    app.addHook("onRoute", (route) => {
      routes.push(`${route.method} ${route.url}`);
    });
    registerAuthRoutes(app);
    registerAdminAccountRoutes(app);
    registerNotificationRoutes(app);
    await app.ready();

    const apiRoutes = routes.filter((route) => route.includes("/api/"));

    // Non-vacuity: the enumeration really captured the surfaces under test.
    expect(apiRoutes.length).toBeGreaterThan(5);
    expect(apiRoutes).toContain("POST /api/auth/login");
    expect(apiRoutes).toContain("GET /api/admin/notifications/status");
    expect(apiRoutes).toContain("POST /api/admin/notifications/test");

    // The contract: no mail-driven recovery, no verification code, no licence.
    const forbidden = apiRoutes.filter((route) => FORBIDDEN_API_PATH.test(route));
    expect(forbidden).toEqual([]);

    await app.close();
  });

  it("SMTP-05 通知接口不是认证条件：三条路径都不在公开 API 白名单里", () => {
    expect(isPublicApi("GET", "/api/admin/notifications/status")).toBe(false);
    expect(isPublicApi("POST", "/api/admin/notifications/test")).toBe(false);
    expect(isPublicApi("GET", "/api/admin/notifications/1")).toBe(false);
    // The authentication surface itself is untouched by the notifier.
    expect(isPublicApi("POST", "/api/auth/login")).toBe(true);
    expect(isPublicApi("GET", "/api/auth/status")).toBe(true);
  });

  it("SMTP-05 登录主键仍是账户 id：邮箱既不是合法账户 id，也查不到账户", async () => {
    // The account id grammar has no room for an address.
    expect(ADMIN_ID_RE.test("owner1")).toBe(true);
    expect(ADMIN_ID_RE.test("owner@example.internal")).toBe(false);

    const config = await loadAdminsConfig({ fresh: true });
    expect(findAdmin(config, "owner1")?.role).toBe("owner");
    expect(findAdmin(config, "owner@example.internal")).toBeUndefined();
  });

  it("SMTP-05 只带邮箱的登录请求被拒：登录凭据仍是账户 id 与密码", async () => {
    const app = Fastify();
    registerAuthRoutes(app);
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "owner@example.internal", password: "irrelevant" }
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("BAD_REQUEST");
    expect(res.json().error.message).toBe("需要管理员 id 与密码");

    await app.close();
  });
});
