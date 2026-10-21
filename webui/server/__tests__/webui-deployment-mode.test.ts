import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";

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

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_ADMINS_CONFIG_PATH",
  "LUCY_WEBUI_SESSION_SECRET",
  "LUCY_WEBUI_AUTH",
  "LUCY_DEPLOYMENT_MODE",
  "LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE"
] as const;

const BOOTSTRAP_TOKEN = "bootstrap-token-for-tests-0123456789";
const BOOTSTRAP_BODY = { adminId: "xingchen", displayName: "星尘", password: "correct-horse" };
const WIKI_URL = "/api/wiki/global%2Fanon-probe.md";
const WIKI_BODY = { dryRun: false, content: "# probe\n" };

describe("V-01 minimal: deployment mode and default non-open (T0A-2)", () => {
  let tempRoot: string;
  let tokenFile: string;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-deploy-mode-"));
    await mkdir(path.join(tempRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(tempRoot, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(tempRoot, "wiki", "global"), { recursive: true });
    await writeFile(path.join(tempRoot, "webui", "config", "admins.yaml"), 'version: "1"\nadmins: []\n', "utf8");
    await writeFile(path.join(tempRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(tempRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    tokenFile = path.join(tempRoot, "bootstrap-token");

    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.KTX_PROJECT_ROOT = tempRoot;
    process.env.LUCY_ADMINS_CONFIG_PATH = path.join(tempRoot, "webui", "config", "admins.yaml");
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    delete process.env.LUCY_WEBUI_AUTH;
    delete process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE;
    resetAdminsCache();
    resetSessionSecretCache();
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function startApp() {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    return app;
  }

  it("customer + empty admins + no LUCY_WEBUI_AUTH never opens: status=bootstrap, anonymous PUT wiki 401", async () => {
    const app = await startApp();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().data.mode).toBe("bootstrap");
    const put = await app.inject({ method: "PUT", url: WIKI_URL, payload: WIKI_BODY });
    expect(put.statusCode).toBe(401);
    await expect(readFile(path.join(tempRoot, "wiki", "global", "anon-probe.md"), "utf8")).rejects.toThrow();
    await app.close();
  });

  it("customer ignores LUCY_WEBUI_AUTH=off", async () => {
    process.env.LUCY_WEBUI_AUTH = "off";
    const app = await startApp();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().data.mode).toBe("bootstrap");
    const put = await app.inject({ method: "PUT", url: WIKI_URL, payload: WIKI_BODY });
    expect(put.statusCode).toBe(401);
    await app.close();
  });

  it("customer bootstrap without a provisioned token file is 503 BOOTSTRAP_NOT_PROVISIONED", async () => {
    const app = await startApp();
    const res = await app.inject({ method: "POST", url: "/api/auth/bootstrap", payload: BOOTSTRAP_BODY });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("BOOTSTRAP_NOT_PROVISIONED");
    await app.close();
  });

  it.each([
    ["missing file", async () => undefined],
    ["empty file", async () => writeFile(tokenFile, "\n", "utf8")]
  ])("customer bootstrap with %s is 503", async (_label, prepare) => {
    await prepare();
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = tokenFile;
    const app = await startApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { "x-lucy-bootstrap-token": BOOTSTRAP_TOKEN },
      payload: BOOTSTRAP_BODY
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("BOOTSTRAP_NOT_PROVISIONED");
    await app.close();
  });

  it("customer bootstrap rejects missing/wrong token with 401 and does not write admins", async () => {
    await writeFile(tokenFile, `${BOOTSTRAP_TOKEN}\n`, "utf8");
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = tokenFile;
    const app = await startApp();
    for (const headers of [{}, { "x-lucy-bootstrap-token": "wrong" }, { "x-lucy-bootstrap-token": `${BOOTSTRAP_TOKEN}x` }]) {
      const res = await app.inject({ method: "POST", url: "/api/auth/bootstrap", headers, payload: BOOTSTRAP_BODY });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("BOOTSTRAP_TOKEN_INVALID");
    }
    const yaml = await readFile(process.env.LUCY_ADMINS_CONFIG_PATH!, "utf8");
    expect(yaml).not.toContain("xingchen");
    await app.close();
  });

  it("customer bootstrap with the correct token creates the owner; second attempt is 409", async () => {
    await writeFile(tokenFile, `${BOOTSTRAP_TOKEN}\n`, "utf8");
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = tokenFile;
    const app = await startApp();
    const headers = { "x-lucy-bootstrap-token": BOOTSTRAP_TOKEN };
    const ok = await app.inject({ method: "POST", url: "/api/auth/bootstrap", headers, payload: BOOTSTRAP_BODY });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.me.role).toBe("owner");
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().data.mode).toBe("required");
    const again = await app.inject({ method: "POST", url: "/api/auth/bootstrap", headers, payload: BOOTSTRAP_BODY });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("ADMINS_ALREADY_CONFIGURED");
    await app.close();
  });

  it("development keeps today's behavior: open without admins, bootstrap needs no token", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    const app = await startApp();
    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().data.mode).toBe("open");
    const put = await app.inject({ method: "PUT", url: WIKI_URL, payload: WIKI_BODY });
    expect(put.statusCode).toBe(200);
    await app.close();
  });

  it("development honors LUCY_WEBUI_AUTH=off and =required", async () => {
    process.env.LUCY_DEPLOYMENT_MODE = "development";
    process.env.LUCY_WEBUI_AUTH = "off";
    const off = await startApp();
    expect((await off.inject({ method: "GET", url: "/api/auth/status" })).json().data.mode).toBe("open");
    await off.close();

    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const required = await startApp();
    expect((await required.inject({ method: "GET", url: "/api/auth/status" })).json().data.mode).toBe("bootstrap");
    const boot = await required.inject({ method: "POST", url: "/api/auth/bootstrap", payload: BOOTSTRAP_BODY });
    expect(boot.statusCode).toBe(200);
    await required.close();
  });
});

describe("resolveDeploymentMode", () => {
  const original = process.env.LUCY_DEPLOYMENT_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.LUCY_DEPLOYMENT_MODE;
    else process.env.LUCY_DEPLOYMENT_MODE = original;
  });

  it("defaults to customer, accepts customer|development, throws on anything else", async () => {
    const { resolveDeploymentMode } = await import("../auth/deployment-mode.js");
    delete process.env.LUCY_DEPLOYMENT_MODE;
    expect(resolveDeploymentMode()).toBe("customer");
    process.env.LUCY_DEPLOYMENT_MODE = "";
    expect(resolveDeploymentMode()).toBe("customer");
    process.env.LUCY_DEPLOYMENT_MODE = " Development ";
    expect(resolveDeploymentMode()).toBe("development");
    process.env.LUCY_DEPLOYMENT_MODE = "prod";
    expect(() => resolveDeploymentMode()).toThrow(/LUCY_DEPLOYMENT_MODE/);
  });
});
