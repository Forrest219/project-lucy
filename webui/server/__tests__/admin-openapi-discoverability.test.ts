import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetAdminsCache } from "../auth/admins-store.js";
import { isPublicApi } from "../auth/guard.js";
import { hashPassword } from "../auth/password.js";
import { resetSessionSecretCache } from "../auth/session.js";
import { resolveLucyVersion } from "../lucy-version.js";
import { buildServer } from "../index.js";

const D2: Array<[string, string]> = [
  ["post", "/api/auth/login"],
  ["get", "/api/auth/status"],
  ["get", "/api/auth/me"],
  ["post", "/api/auth/logout"],
  ["post", "/api/auth/bootstrap"],
  ["post", "/api/auth/oidc/start"],
  ["get", "/api/auth/oidc/callback"],
  ["get", "/api/admin/agents"],
  ["post", "/api/admin/agents"],
  ["get", "/api/admin/agents/{userId}"],
  ["patch", "/api/admin/agents/{userId}"],
  ["delete", "/api/admin/agents/{userId}"],
  ["post", "/api/admin/agents/{userId}/tokens"],
  ["delete", "/api/admin/agents/{userId}/tokens/{label}"],
  ["post", "/api/admin/agents/{userId}/tokens/{label}/renew"],
  ["get", "/api/admin/tokens"],
  ["get", "/api/admin/roles"],
  ["post", "/api/admin/roles"],
  ["get", "/api/admin/roles/{roleId}"],
  ["patch", "/api/admin/roles/{roleId}"],
  ["delete", "/api/admin/roles/{roleId}"]
];

type Operation = {
  description?: string;
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  requestBody?: {
    required?: boolean;
    content?: {
      "application/json"?: {
        schema?: {
          required?: string[];
          anyOf?: Array<{ required?: string[] }>;
          properties?: Record<string, { default?: unknown }>;
        };
      };
    };
  };
  responses?: Record<string, { headers?: Record<string, unknown> }>;
};

type OpenApiDocument = {
  openapi: string;
  info: { version: string; description?: string };
  components: { securitySchemes: Record<string, { type: string; in: string; name: string }> };
  paths: Record<string, Record<string, Operation> & { parameters?: Operation["parameters"] }>;
};

function listedOperations(doc: OpenApiDocument): Array<[string, string]> {
  const methods = ["get", "post", "put", "patch", "delete", "head", "options"];
  const found: Array<[string, string]> = [];
  for (const [url, item] of Object.entries(doc.paths)) {
    for (const method of methods) {
      if (item[method]) found.push([method, url]);
    }
  }
  return found.sort(([aMethod, aUrl], [bMethod, bUrl]) =>
    aUrl === bUrl ? aMethod.localeCompare(bMethod) : aUrl.localeCompare(bUrl)
  );
}

function sampleUrl(openapiPath: string): string {
  return openapiPath
    .replaceAll("{userId}", "agent_1")
    .replaceAll("{roleId}", "analyst")
    .replaceAll("{label}", "laptop");
}

function bodySchema(operation: Operation) {
  return operation.requestBody?.content?.["application/json"]?.schema;
}

function asActor(app: FastifyInstance, role: "owner" | "operator") {
  app.addHook("onRequest", async (request) => {
    request.lucyAdmin = {
      session: null,
      admin: {
        id: role === "owner" ? "owner_1" : "op_1",
        account_uid: "uid",
        display_name: role,
        role,
        enabled: true,
        created_at: "2026-01-01T00:00:00.000Z"
      },
      stateUnavailable: false,
      authMode: "required"
    };
  });
}

describe("admin OpenAPI discoverability", () => {
  let projectRoot: string;
  let previousRoot: string | undefined;
  let previousAuth: string | undefined;
  let previousAdmins: string | undefined;
  let previousSecret: string | undefined;
  let previousContent: string | undefined;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-openapi-"));
    await mkdir(path.join(projectRoot, "webui", "config"), { recursive: true });
    await mkdir(path.join(projectRoot, ".ktx-ui"), { recursive: true });
    await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(projectRoot, "webui", "config", "admins.yaml"), 'version: "1"\nadmins: []\n', "utf8");
    previousRoot = process.env.KTX_PROJECT_ROOT;
    previousAuth = process.env.LUCY_WEBUI_AUTH;
    previousAdmins = process.env.LUCY_ADMINS_CONFIG_PATH;
    previousSecret = process.env.LUCY_WEBUI_SESSION_SECRET;
    previousContent = process.env.LUCY_CONTENT_ROOT;
    process.env.KTX_PROJECT_ROOT = projectRoot;
    process.env.LUCY_CONTENT_ROOT = ".";
    process.env.LUCY_ADMINS_CONFIG_PATH = path.join(projectRoot, "webui", "config", "admins.yaml");
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    delete process.env.LUCY_WEBUI_AUTH;
    resetAdminsCache();
    resetSessionSecretCache();
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
    else process.env.KTX_PROJECT_ROOT = previousRoot;
    if (previousAuth === undefined) delete process.env.LUCY_WEBUI_AUTH;
    else process.env.LUCY_WEBUI_AUTH = previousAuth;
    if (previousAdmins === undefined) delete process.env.LUCY_ADMINS_CONFIG_PATH;
    else process.env.LUCY_ADMINS_CONFIG_PATH = previousAdmins;
    if (previousSecret === undefined) delete process.env.LUCY_WEBUI_SESSION_SECRET;
    else process.env.LUCY_WEBUI_SESSION_SECRET = previousSecret;
    if (previousContent === undefined) delete process.env.LUCY_CONTENT_ROOT;
    else process.env.LUCY_CONTENT_ROOT = previousContent;
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function requiredAdmin() {
    const passwordHash = await hashPassword("correct-horse");
    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      `version: "1"\nadmins:\n  - id: owner\n    display_name: Owner\n    password_hash: "${passwordHash}"\n    role: owner\n    enabled: true\n`,
      "utf8"
    );
    resetAdminsCache();
  }

  it("SC-01 public OpenAPI lists exactly the D2 operations and the live router", async () => {
    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json() as OpenApiDocument;
    expect(doc.openapi.startsWith("3.0.")).toBe(true);
    expect(doc.info.version).toBe(resolveLucyVersion());
    const found = listedOperations(doc);
    const expected = [...D2].sort(([aMethod, aUrl], [bMethod, bUrl]) =>
      aUrl === bUrl ? aMethod.localeCompare(bMethod) : aUrl.localeCompare(bUrl)
    );
    expect(found).toEqual(expected);
    expect(doc.paths["/api/auth/login"]?.get).toBeUndefined();
    expect(Object.keys(doc.paths["/api/auth/login"] ?? {})).toEqual(["post"]);
    for (const [method, url] of found) {
      expect(app.findRoute({ method: method.toUpperCase(), url: sampleUrl(url) }), `${method} ${url}`).not.toBeNull();
    }
    await app.close();
  });

  it("SC-02 declares login, issue, revoke, role PATCH and per-operation dryRun", async () => {
    const app = buildServer();
    await app.ready();
    const doc = (await app.inject({ method: "GET", url: "/api/openapi.json" })).json() as OpenApiDocument;
    const cookie = doc.components.securitySchemes.lucyAdminSession;
    expect(cookie).toMatchObject({ type: "apiKey", in: "cookie", name: "lucy_admin_session" });

    const login = doc.paths["/api/auth/login"]?.post;
    expect(login?.security).toEqual([]);
    expect(login?.requestBody?.required).toBe(true);
    expect(bodySchema(login!)?.required).toEqual(expect.arrayContaining(["adminId", "password"]));
    expect(login?.responses?.["200"]?.headers?.["Set-Cookie"]).toBeTruthy();
    expect(login?.description).toContain("lucy_admin_session");

    const issue = doc.paths["/api/admin/agents/{userId}/tokens"]?.post;
    expect(issue?.security).toEqual([{ lucyAdminSession: [] }]);
    expect(bodySchema(issue!)?.required).toEqual(["label"]);
    expect(bodySchema(issue!)?.properties?.dryRun?.default).toBe(false);
    expect(bodySchema(issue!)?.anyOf).toEqual([
      { required: ["label", "expires_at"] },
      { required: ["label", "expires_in"] }
    ]);
    expect(issue?.description).toContain("delegated_from");
    expect(issue?.description).toContain("OWNER_REQUIRED");
    expect(bodySchema(issue!)?.properties?.override).toBeTruthy();
    expect(issue?.responses?.["409"]).toBeTruthy();
    expect(issue?.responses?.["503"]).toBeTruthy();

    const renew = doc.paths["/api/admin/agents/{userId}/tokens/{label}/renew"]?.post;
    expect(bodySchema(renew!)?.required).toEqual(expect.arrayContaining(["expires_at"]));
    expect(bodySchema(renew!)?.properties?.dryRun?.default).toBe(false);

    const revoke = doc.paths["/api/admin/agents/{userId}/tokens/{label}"]?.delete;
    expect(bodySchema(revoke!)?.properties?.dryRun).toBeUndefined();
    expect(doc.paths["/api/admin/agents/{userId}/tokens/{label}"]?.parameters?.map((item) => item.name)).toEqual([
      "userId",
      "label"
    ]);

    const rolePatch = doc.paths["/api/admin/roles/{roleId}"]?.patch;
    expect(bodySchema(rolePatch!)?.properties?.dryRun?.default).toBe(true);
    expect(bodySchema(rolePatch!)?.properties?.override).toBeTruthy();
    expect(bodySchema(rolePatch!)?.properties?.version).toBeTruthy();
    expect(doc.paths["/api/admin/roles/{roleId}"]?.parameters?.[0]).toMatchObject({
      name: "roleId",
      in: "path",
      required: true
    });

    const agentPost = doc.paths["/api/admin/agents"]?.post;
    const agentPatch = doc.paths["/api/admin/agents/{userId}"]?.patch;
    expect(bodySchema(agentPost!)?.properties?.dryRun?.default).toBe(true);
    expect(bodySchema(agentPatch!)?.properties?.dryRun?.default).toBe(true);
    expect(bodySchema(doc.paths["/api/admin/agents/{userId}"]?.delete!)?.properties?.dryRun).toBeUndefined();
    expect(bodySchema(doc.paths["/api/admin/roles"]?.post!)?.properties?.dryRun?.default).toBe(true);
    expect(bodySchema(doc.paths["/api/admin/roles/{roleId}"]?.delete!)?.properties?.dryRun).toBeUndefined();
    expect(doc.info.description).toContain("Bearer");
    await app.close();
  });

  it("SC-03 required mode without a session returns AUTH_REQUIRED for a real route", async () => {
    await requiredAdmin();
    const app = buildServer();
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/admin/agents" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("AUTH_REQUIRED");
    await app.close();
  });

  it("SC-04 wrong methods are 405 for anonymous and signed-in callers, and CSRF still wins", async () => {
    await requiredAdmin();
    const app = buildServer();
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "owner", password: "correct-horse" }
    });
    expect(login.statusCode).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];

    const anonymous = await app.inject({ method: "PUT", url: "/api/admin/agents" });
    expect(anonymous.statusCode).toBe(405);
    expect(anonymous.json().error.code).toBe("METHOD_NOT_ALLOWED");
    expect(anonymous.json().error.detail.allowedMethods).toEqual(expect.arrayContaining(["GET", "HEAD", "POST"]));
    expect(anonymous.headers.allow).toBe(anonymous.json().error.detail.allowedMethods.join(", "));

    const signedIn = await app.inject({
      method: "PUT",
      url: "/api/admin/agents/zhangsan",
      headers: { cookie }
    });
    expect(signedIn.statusCode).toBe(405);
    expect(signedIn.json().error.detail.allowedMethods).toEqual(expect.arrayContaining(["GET", "HEAD", "PATCH", "DELETE"]));
    expect(signedIn.json().error.detail.allowedMethods).not.toContain("POST");
    expect(signedIn.headers.allow).toBe(signedIn.json().error.detail.allowedMethods.join(", "));

    const head = await app.inject({ method: "HEAD", url: "/api/admin/agents/zhangsan" });
    expect(head.statusCode).toBe(401);
    expect(head.statusCode).not.toBe(405);

    const getLogin = await app.inject({ method: "GET", url: "/api/auth/login" });
    expect(getLogin.statusCode).toBe(405);
    expect(getLogin.json().error.detail.allowedMethods).toEqual(["POST"]);

    const crossMethod = await app.inject({
      method: "PUT",
      url: "/api/admin/agents",
      headers: {
        host: "lucy.example.com",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site"
      }
    });
    expect(crossMethod.statusCode).toBe(403);
    expect(crossMethod.json().error.code).toBe("CSRF_ORIGIN_DENIED");

    const crossMissing = await app.inject({
      method: "POST",
      url: "/api/admin/no-such-route-xyz",
      headers: {
        host: "lucy.example.com",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site"
      }
    });
    expect(crossMissing.statusCode).toBe(403);
    expect(crossMissing.json().error.code).toBe("CSRF_ORIGIN_DENIED");
    await app.close();
  });

  it("SC-05 a signed-in caller gets 404 for an unknown admin path", async () => {
    await requiredAdmin();
    const app = buildServer();
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { adminId: "owner", password: "correct-horse" }
    });
    const setCookie = login.headers["set-cookie"];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/no-such-route-xyz",
      headers: { cookie }
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
    expect(res.json().error.detail.allowedMethods).toEqual([]);
    await app.close();
  });

  it("SC-06 unknown paths are 404 without a session, and public/auth modes stay intact", async () => {
    expect(isPublicApi("GET", "/api/openapi.json")).toBe(true);
    expect(isPublicApi("GET", "/api/openapi.json?x=1")).toBe(true);
    expect(isPublicApi("POST", "/api/openapi.json")).toBe(false);
    expect(isPublicApi("HEAD", "/api/openapi.json")).toBe(false);
    expect(isPublicApi("POST", "/api/auth/login")).toBe(true);
    expect(isPublicApi("GET", "/api/auth/login")).toBe(false);
    expect(isPublicApi("GET", "/api/auth/me")).toBe(false);
    expect(isPublicApi("GET", "/api/auth/me?x=1")).toBe(false);
    expect(isPublicApi("GET", "/api/auth/status?x=1")).toBe(true);
    expect(isPublicApi("HEAD", "/api/health")).toBe(false);
    expect(isPublicApi("GET", "/api/admin/agents")).toBe(false);

    await requiredAdmin();
    const required = buildServer();
    await required.ready();
    const missing = await required.inject({ method: "GET", url: "/api/admin/no-such-route-xyz" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("NOT_FOUND");
    const queried = await required.inject({ method: "GET", url: "/api/admin/agents?x=1" });
    expect(queried.statusCode).toBe(401);
    expect(queried.json().error.code).toBe("AUTH_REQUIRED");
    const me = await required.inject({ method: "GET", url: "/api/auth/me" });
    expect(me.statusCode).toBe(401);
    expect(me.json().error.code).toBe("AUTH_REQUIRED");
    const openapi = await required.inject({ method: "GET", url: "/api/openapi.json?x=1" });
    expect(openapi.statusCode).toBe(200);
    const headOpenapi = await required.inject({ method: "HEAD", url: "/api/openapi.json" });
    expect(headOpenapi.statusCode).toBe(401);
    const login = await required.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    expect(login.statusCode).toBe(400);
    expect(login.json().error.code).toBe("BAD_REQUEST");
    await required.close();

    delete process.env.LUCY_WEBUI_AUTH;
    await writeFile(path.join(projectRoot, "webui", "config", "admins.yaml"), 'version: "1"\nadmins: []\n', "utf8");
    resetAdminsCache();
    const open = buildServer();
    await open.ready();
    const openAgents = await open.inject({ method: "GET", url: "/api/admin/agents" });
    expect(openAgents.statusCode).not.toBe(401);
    const openStatus = await open.inject({ method: "GET", url: "/api/auth/status" });
    expect(openStatus.json().data.mode).toBe("open");
    await open.close();

    process.env.LUCY_WEBUI_AUTH = "required";
    resetAdminsCache();
    const bootstrap = buildServer();
    await bootstrap.ready();
    const bootstrapAgents = await bootstrap.inject({ method: "GET", url: "/api/admin/agents" });
    expect(bootstrapAgents.statusCode).toBe(401);
    expect(bootstrapAgents.json().error.code).toBe("AUTH_BOOTSTRAP_REQUIRED");
    const bootstrapLogin = await bootstrap.inject({ method: "POST", url: "/api/auth/login", payload: { adminId: "a", password: "b" } });
    expect(bootstrapLogin.statusCode).toBe(400);
    expect(bootstrapLogin.json().error.code).toBe("AUTH_BOOTSTRAP_REQUIRED");
    await bootstrap.close();

    await writeFile(
      path.join(projectRoot, "webui", "config", "admins.yaml"),
      "version: \"1\"\nadmins:\n  - id: bad\n    role: superuser\n",
      "utf8"
    );
    resetAdminsCache();
    const unavailable = buildServer();
    await unavailable.ready();
    const denied = await unavailable.inject({ method: "GET", url: "/api/admin/agents" });
    expect(denied.statusCode).toBe(503);
    expect(denied.json().error.code).toBe("AUTH_CONFIG_UNAVAILABLE");
    const status = await unavailable.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.mode).toBe("unavailable");
    const unknown = await unavailable.inject({ method: "GET", url: "/api/admin/no-such-route-xyz" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("NOT_FOUND");
    await unavailable.close();
  });

  it("SC-17 OpenAPI states the owner gate and a non-owner cannot issue for a delegated agent", async () => {
    await writeFile(
      path.join(projectRoot, "webui", "config", "access.yaml"),
      `users:
  - id: delegated_bot
    name: Delegated
    enabled: true
    delegated_from: owner_1
    tokens: []
`,
      "utf8"
    );
    const spec = buildServer();
    await spec.ready();
    const doc = (await spec.inject({ method: "GET", url: "/api/openapi.json" })).json() as OpenApiDocument;
    expect(doc.paths["/api/admin/agents/{userId}/tokens"]?.post?.description).toContain("所有者");
    await spec.close();

    const operator = buildServer();
    asActor(operator, "operator");
    await operator.ready();
    const denied = await operator.inject({
      method: "POST",
      url: "/api/admin/agents/delegated_bot/tokens",
      payload: { label: "ops-token", expires_in: "30d" }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("OWNER_REQUIRED");
    const yaml = await readFile(path.join(projectRoot, "webui/config/access.yaml"), "utf8");
    expect(yaml).not.toContain("ops-token");
    await operator.close();

    const owner = buildServer();
    asActor(owner, "owner");
    await owner.ready();
    const allowed = await owner.inject({
      method: "POST",
      url: "/api/admin/agents/delegated_bot/tokens",
      payload: { label: "owner-token", expires_in: "30d" }
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().data.token).toMatch(/^[0-9a-f]{64}$/);
    await owner.close();
  });
});
