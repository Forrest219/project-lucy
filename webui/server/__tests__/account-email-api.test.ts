import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import { findOidcBinding, loadAdminsConfig, resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";

const passwordGate = vi.hoisted(() => ({
  password: "" as string,
  wait: null as Promise<void> | null,
  started: null as (() => void) | null
}));

vi.mock("../auth/password.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/password.js")>("../auth/password.js");
  return {
    ...actual,
    hashPassword: async (password: string) => {
      if (passwordGate.password && password === passwordGate.password) {
        passwordGate.started?.();
        if (passwordGate.wait) await passwordGate.wait;
      }
      return actual.hashPassword(password);
    }
  };
});

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

describe("account contact email", () => {
  let tempRoot: string;
  let previousProjectDir: string | undefined;
  let previousAuth: string | undefined;
  let previousAdminsPath: string | undefined;
  let previousSessionSecret: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-account-email-"));
    await mkdir(path.join(tempRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(tempRoot, "webui", "config", "admins.yaml"), 'version: "1"\nadmins: []\n', "utf8");
    await writeFile(path.join(tempRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");

    previousProjectDir = process.env.KTX_PROJECT_ROOT;
    previousAuth = process.env.LUCY_WEBUI_AUTH;
    previousAdminsPath = process.env.LUCY_ADMINS_CONFIG_PATH;
    previousSessionSecret = process.env.LUCY_WEBUI_SESSION_SECRET;

    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_ADMINS_CONFIG_PATH = path.join(tempRoot, "webui", "config", "admins.yaml");
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    process.env.LUCY_WEBUI_AUTH = "required";
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
    passwordGate.password = "";
    passwordGate.wait = null;
    passwordGate.started = null;
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function bootOwner() {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    const boot = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { adminId: "xingchen", displayName: "星尘", password: "correct-horse" }
    });
    const ownerCookie = String(
      Array.isArray(boot.headers["set-cookie"]) ? boot.headers["set-cookie"][0] : boot.headers["set-cookie"]
    ).split(";")[0];
    return { app, ownerCookie };
  }

  function adminsPath() {
    return path.join(tempRoot, "webui", "config", "admins.yaml");
  }

  it("stores a normalized account email without turning it into a login binding", async () => {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();

    const boot = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      payload: { adminId: "xingchen", displayName: "星尘", password: "correct-horse" }
    });
    const ownerCookie = String(
      Array.isArray(boot.headers["set-cookie"]) ? boot.headers["set-cookie"][0] : boot.headers["set-cookie"]
    ).split(";")[0];

    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: {
        adminId: "ops_li",
        displayName: "李运维",
        password: "operator-password-1",
        role: "operator",
        email: "Li@Example.COM"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().data.admin.email).toBe("li@example.com");
    expect(created.json().data.admin.oidcBindings ?? []).toEqual([]);

    const yaml = await readFile(path.join(tempRoot, "webui", "config", "admins.yaml"), "utf8");
    expect(yaml).toContain("email: li@example.com");
    expect(yaml).not.toContain("oidc_bindings");

    const blank = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "ops_wang", password: "operator-password-1", role: "operator", email: "" }
    });
    expect(blank.statusCode).toBe(200);
    expect(blank.json().data.admin.email).toBeNull();

    const spaced = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "ops_zhao", password: "operator-password-1", email: "zhao @example.com" }
    });
    expect(spaced.statusCode).toBe(400);
    expect(spaced.json().error).toMatchObject({ code: "ACCOUNT_EMAIL_INVALID", message: "邮箱不能包含空格" });

    const noSuffix = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "ops_qian", password: "operator-password-1", email: "qian@example" }
    });
    expect(noSuffix.statusCode).toBe(400);
    expect(noSuffix.json().error.message).toBe("邮箱需要包含域名后缀（如 .com）");

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "ops_sun", password: "operator-password-1", email: "LI@example.com" }
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({
      code: "ACCOUNT_EMAIL_TAKEN",
      message: "该邮箱已被其他登录账户使用"
    });

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/admin/admins/ops_li",
      headers: { cookie: ownerCookie },
      payload: { email: "" }
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.admin.email).toBeNull();

    const listed = await app.inject({
      method: "GET",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie }
    });
    const li = listed.json().data.admins.find((admin: { id: string }) => admin.id === "ops_li");
    expect(li.email).toBeNull();

    await app.close();
  });

  it("does not accept the contact email as a login id and keeps an existing binding", async () => {
    const { app, ownerCookie } = await bootOwner();
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: {
        adminId: "ops_li",
        displayName: "李运维",
        password: "operator-password-1",
        role: "operator",
        email: "li@example.com"
      }
    });
    expect(created.statusCode).toBe(200);

    const asEmail = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "li@example.com", password: "operator-password-1" }
    });
    expect(asEmail.statusCode).toBe(401);

    const asId = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "ops_li", password: "operator-password-1" }
    });
    expect(asId.statusCode).toBe(200);

    const doc = parse(await readFile(adminsPath(), "utf8")) as {
      admins: Array<{ id: string; oidc_bindings?: Array<{ issuer: string; sub: string; email: string }> }>;
    };
    const li = doc.admins.find((admin) => admin.id === "ops_li");
    li!.oidc_bindings = [{ issuer: "https://idp.example.com", sub: "li|1", email: "bind@example.com" }];
    await writeFile(adminsPath(), stringify(doc), "utf8");
    resetAdminsCache();

    const patched = await app.inject({
      method: "PATCH",
      url: "/api/admin/admins/ops_li",
      headers: { cookie: ownerCookie },
      payload: { email: "Other@Example.com" }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.admin.email).toBe("other@example.com");

    const saved = parse(await readFile(adminsPath(), "utf8")) as {
      admins: Array<{ id: string; email?: string; oidc_bindings?: Array<{ issuer: string; sub: string; email: string }> }>;
    };
    const stored = saved.admins.find((admin) => admin.id === "ops_li");
    expect(stored?.email).toBe("other@example.com");
    expect(stored?.oidc_bindings).toEqual([
      { issuer: "https://idp.example.com", sub: "li|1", email: "bind@example.com" }
    ]);

    await app.close();
  });

  it("rejects a conflicting or invalid email patch and keeps an omitted email", async () => {
    const { app, ownerCookie } = await bootOwner();
    for (const account of [
      { adminId: "ops_li", email: "li@example.com" },
      { adminId: "ops_wang", email: "wang@example.com" }
    ]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/admin/admins",
        headers: { cookie: ownerCookie },
        payload: { ...account, password: "operator-password-1", role: "operator" }
      });
      expect(created.statusCode).toBe(200);
    }

    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/admin/admins/ops_li",
      headers: { cookie: ownerCookie },
      payload: { email: "WANG@example.com" }
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("ACCOUNT_EMAIL_TAKEN");

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/admin/admins/ops_li",
      headers: { cookie: ownerCookie },
      payload: { email: "li @example.com" }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("ACCOUNT_EMAIL_INVALID");

    const renamed = await app.inject({
      method: "PATCH",
      url: "/api/admin/admins/ops_li",
      headers: { cookie: ownerCookie },
      payload: { displayName: "李运维" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.admin.email).toBe("li@example.com");

    const yaml = await readFile(adminsPath(), "utf8");
    expect(yaml).toContain("email: li@example.com");
    expect(yaml).toContain("email: wang@example.com");

    await app.close();
  });

  it("does not match a single sign-on subject by the account contact email", async () => {
    const { app, ownerCookie } = await bootOwner();
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: {
        adminId: "ops_li",
        password: "operator-password-1",
        role: "operator",
        email: "li@example.com"
      }
    });
    expect(created.statusCode).toBe(200);

    const doc = parse(await readFile(adminsPath(), "utf8")) as {
      admins: Array<{ id: string; oidc_bindings?: Array<{ issuer: string; sub: string; email: string }> }>;
    };
    const li = doc.admins.find((admin) => admin.id === "ops_li");
    li!.oidc_bindings = [
      { issuer: "https://idp.example.com", sub: "opaque-sub", email: "bind@example.com" }
    ];
    await writeFile(adminsPath(), stringify(doc), "utf8");
    resetAdminsCache();

    const config = await loadAdminsConfig({ fresh: true });
    expect(findOidcBinding(config, "https://idp.example.com", "opaque-sub")?.admin.id).toBe("ops_li");
    expect(findOidcBinding(config, "https://idp.example.com", "li@example.com")).toBeUndefined();
    expect(findOidcBinding(config, "https://idp.example.com", "bind@example.com")).toBeUndefined();

    await app.close();
  });

  it("lets only one concurrent patch keep a contested email", async () => {
    const { app, ownerCookie } = await bootOwner();
    for (const adminId of ["ops_li", "ops_wang"]) {
      const created = await app.inject({
        method: "POST",
        url: "/api/admin/admins",
        headers: { cookie: ownerCookie },
        payload: { adminId, password: "operator-password-1", role: "operator" }
      });
      expect(created.statusCode).toBe(200);
    }

    const [first, second] = await Promise.all([
      app.inject({
        method: "PATCH",
        url: "/api/admin/admins/ops_li",
        headers: { cookie: ownerCookie },
        payload: { email: "shared@example.com" }
      }),
      app.inject({
        method: "PATCH",
        url: "/api/admin/admins/ops_wang",
        headers: { cookie: ownerCookie },
        payload: { email: "Shared@Example.COM" }
      })
    ]);
    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = first.statusCode === 200 ? first : second;
    expect(winner.json().data.admin.email).toBe("shared@example.com");
    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().error.code).toBe("ACCOUNT_EMAIL_TAKEN");

    const yaml = await readFile(adminsPath(), "utf8");
    expect(yaml.match(/email: shared@example.com/g)?.length).toBe(1);

    await app.close();
  });

  it("does not drop an email saved while another admin create is hashing", async () => {
    const { app, ownerCookie } = await bootOwner();
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: {
        adminId: "ops_li",
        password: "operator-password-1",
        role: "operator",
        email: "li@example.com"
      }
    });
    expect(created.statusCode).toBe(200);

    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      passwordGate.started = resolve;
    });
    passwordGate.password = "slow-password-1";
    passwordGate.wait = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    const creating = app.inject({
      method: "POST",
      url: "/api/admin/admins",
      headers: { cookie: ownerCookie },
      payload: { adminId: "ops_slow", password: "slow-password-1", role: "operator" }
    });
    try {
      await started;
      const patching = app.inject({
        method: "PATCH",
        url: "/api/admin/admins/ops_li",
        headers: { cookie: ownerCookie },
        payload: { email: "fresh@example.com" }
      });
      const winner = await Promise.race([
        patching.then(() => "finished" as const),
        new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 100))
      ]);
      expect(winner).toBe("waiting");
      release();
      const [slow, patched] = await Promise.all([creating, patching]);
      expect(slow.statusCode).toBe(200);
      expect(patched.statusCode).toBe(200);
      const yaml = await readFile(adminsPath(), "utf8");
      expect(yaml).toContain("id: ops_slow");
      expect(yaml).toContain("email: fresh@example.com");
      expect(yaml).not.toContain("email: li@example.com");
    } finally {
      release?.();
    }

    await app.close();
  });
});
