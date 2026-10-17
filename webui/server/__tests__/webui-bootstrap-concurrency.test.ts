import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";
import { closeSecurityStore } from "../security/instance.js";
import { openSecurityStore, type SecurityStore } from "../security/store.js";

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

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_ADMINS_CONFIG_PATH",
  "LUCY_WEBUI_SESSION_SECRET",
  "LUCY_WEBUI_AUTH",
  "LUCY_DEPLOYMENT_MODE",
  "LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE"
] as const;

const TOKEN = "bootstrap-token-for-tests-0123456789";
const AUTH = { "x-lucy-bootstrap-token": TOKEN };
const BODY_A = { adminId: "alice", displayName: "Alice", password: "correct-horse-a" };
const BODY_B = { adminId: "bobby", displayName: "Bobby", password: "correct-horse-b" };

describe("V-06 / SEC-02: bootstrap is serialized, one-shot and durable (T02)", () => {
  let root: string;
  let adminsPath: string;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  const opened: SecurityStore[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-bootstrap-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
    await mkdir(path.join(root, "wiki", "global"), { recursive: true });
    adminsPath = path.join(root, "webui", "config", "admins.yaml");
    await writeFile(adminsPath, 'version: "1"\nadmins: []\n', "utf8");
    await writeFile(path.join(root, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(root, "bootstrap-token"), `${TOKEN}\n`, "utf8");

    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_ADMINS_CONFIG_PATH = adminsPath;
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = path.join(root, "bootstrap-token");
    delete process.env.LUCY_WEBUI_AUTH;
    resetAdminsCache();
    resetSessionSecretCache();
    closeSecurityStore();
  });

  afterEach(async () => {
    while (opened.length) opened.pop()?.close();
    closeSecurityStore();
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetAdminsCache();
    resetSessionSecretCache();
    await rm(root, { recursive: true, force: true });
  });

  async function startApp() {
    const { buildServer } = await import("../index.js");
    const app = buildServer();
    await app.ready();
    return app;
  }

  function peekStore(): SecurityStore {
    const result = openSecurityStore(root);
    if (!result.ok) throw new Error(`${result.reason}: ${result.message}`);
    opened.push(result.value);
    return result.value;
  }

  async function adminIds(): Promise<string[]> {
    const doc = parse(await readFile(adminsPath, "utf8")) as { admins?: Array<{ id: string }> };
    return (doc.admins ?? []).map((a) => a.id);
  }

  const post = (app: Awaited<ReturnType<typeof startApp>>, body: object, headers: Record<string, string> = AUTH) =>
    app.inject({ method: "POST", url: "/api/auth/bootstrap", headers, payload: body });

  it("two concurrent bootstraps with the valid key: exactly one 200, the other 409, one admin on disk", async () => {
    const app = await startApp();
    const [a, b] = await Promise.all([post(app, BODY_A), post(app, BODY_B)]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.code).toBe("ADMINS_ALREADY_CONFIGURED");
    const ids = await adminIds();
    expect(ids).toHaveLength(1);
    const winner = a.statusCode === 200 ? BODY_A.adminId : BODY_B.adminId;
    expect(ids).toEqual([winner]);
    await app.close();
  });

  it("many concurrent bootstraps never produce more than one success", async () => {
    const app = await startApp();
    const bodies = ["carol", "dave1", "erin1", "frank"].map((adminId) => ({ ...BODY_A, adminId }));
    const results = await Promise.all(bodies.map((body) => post(app, body)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(bodies.length - 1);
    expect(await adminIds()).toHaveLength(1);
    await app.close();
  });

  it("missing, wrong and already-consumed keys are rejected and never write an admin", async () => {
    const app = await startApp();
    for (const headers of [{} as Record<string, string>, { "x-lucy-bootstrap-token": "nope" }]) {
      const res = await post(app, BODY_A, headers);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("BOOTSTRAP_TOKEN_INVALID");
    }
    expect(await adminIds()).toEqual([]);
    expect((await post(app, BODY_A)).statusCode).toBe(200);
    // Same key again: it has been consumed.
    const replay = await post(app, BODY_B);
    expect(replay.statusCode).toBe(409);
    expect(await adminIds()).toEqual(["alice"]);
    await app.close();
  });

  it("persists the consumed state in security.sqlite and survives a restart", async () => {
    const app = await startApp();
    expect((await post(app, BODY_A)).statusCode).toBe(200);
    await app.close();
    closeSecurityStore();

    const state = peekStore().getBootstrapState();
    expect(state).toMatchObject({ ok: true, value: { state: "consumed", consumedByUid: "alice" } });

    const restarted = await startApp();
    const again = await post(restarted, BODY_B);
    expect(again.statusCode).toBe(409);
    await restarted.close();
  });

  it("clearing admins.yaml after a consumed bootstrap does not let anyone claim again (Spec §3.1 item 7)", async () => {
    const app = await startApp();
    expect((await post(app, BODY_A)).statusCode).toBe(200);
    await writeFile(adminsPath, 'version: "1"\nadmins: []\n', "utf8");
    resetAdminsCache();

    const status = await app.inject({ method: "GET", url: "/api/auth/status" });
    expect(status.json().data.mode).toBe("bootstrap");
    const claim = await post(app, BODY_B);
    expect(claim.statusCode).toBe(409);
    expect(claim.json().error.code).toBe("BOOTSTRAP_CONSUMED");
    expect(await adminIds()).toEqual([]);
    const put = await app.inject({
      method: "PUT",
      url: "/api/wiki/global%2Fanon-probe.md",
      payload: { dryRun: false, content: "# probe\n" }
    });
    expect(put.statusCode).toBe(401);
    await app.close();
  });

  it("crash after writing admins but before consuming: restart finishes the consume; clearing admins afterwards stays closed", async () => {
    // Simulate the crash window: prepared op + owner on disk, bootstrap still 'open'.
    const store = peekStore();
    const prepared = store.prepareOperation({
      operationId: "bootstrap-crashed",
      kind: "admin_bootstrap",
      direction: "widen",
      actor: "bootstrap",
      actorType: "bootstrap"
    });
    expect(prepared.ok).toBe(true);
    await writeFile(
      adminsPath,
      `version: "1"\nadmins:\n  - id: alice\n    display_name: Alice\n    password_hash: "scrypt:aa:bb"\n    role: owner\n    enabled: true\n    created_at: "2026-10-18T00:00:00.000Z"\n`,
      "utf8"
    );
    store.close();
    opened.pop();

    const app = await startApp();
    const check = peekStore();
    expect(check.getBootstrapState()).toMatchObject({ ok: true, value: { state: "consumed" } });
    expect(check.getOperation("bootstrap-crashed")).toMatchObject({ ok: true, value: { state: "committed" } });

    await writeFile(adminsPath, 'version: "1"\nadmins: []\n', "utf8");
    resetAdminsCache();
    const claim = await post(app, BODY_B);
    expect(claim.statusCode).toBe(409);
    await app.close();
  });

  it("crash after prepare but before writing admins: the stale operation is aborted and bootstrap can still run", async () => {
    const store = peekStore();
    store.prepareOperation({
      operationId: "bootstrap-stale",
      kind: "admin_bootstrap",
      direction: "widen",
      actor: "bootstrap",
      actorType: "bootstrap"
    });
    store.close();
    opened.pop();

    const app = await startApp();
    expect((await post(app, BODY_A)).statusCode).toBe(200);
    const check = peekStore();
    expect(check.getOperation("bootstrap-stale")).toMatchObject({ ok: true, value: { state: "aborted" } });
    expect(check.getBootstrapState()).toMatchObject({ ok: true, value: { state: "consumed" } });
    await app.close();
  });

  it("an unusable security store fails closed with 503 and writes no admin", async () => {
    await writeFile(path.join(root, ".ktx-ui", "security.sqlite"), "this is not a sqlite database", "utf8");
    const app = await startApp();
    const res = await post(app, BODY_A);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("AUTH_STATE_UNAVAILABLE");
    expect(await adminIds()).toEqual([]);
    await app.close();
  });
});
