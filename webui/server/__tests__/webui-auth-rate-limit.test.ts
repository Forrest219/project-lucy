import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAdminsCache } from "../auth/admins-store.js";
import { hashPassword } from "../auth/password.js";
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
  registerAgentAuditRoutes: vi.fn(),
  registerAuditRoutes: vi.fn()
}));

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_ADMINS_CONFIG_PATH",
  "LUCY_WEBUI_SESSION_SECRET",
  "LUCY_WEBUI_AUTH",
  "LUCY_DEPLOYMENT_MODE",
  "LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE",
  "LUCY_TRUST_PROXY",
  "LUCY_TRUSTED_PROXY_CIDRS"
] as const;

const PASSWORD = "correct-horse";
const MINUTE = 60_000;

describe("SEC-05: bounded, durable auth rate limiting and uniform failures (T02)", () => {
  let root: string;
  let adminsPath: string;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  const opened: SecurityStore[] = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "lucy-rate-limit-"));
    await mkdir(path.join(root, "webui", "config"), { recursive: true });
    await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
    adminsPath = path.join(root, "webui", "config", "admins.yaml");
    const hash = await hashPassword(PASSWORD);
    const admin = (id: string, enabled = true) =>
      `  - id: ${id}\n    display_name: ${id}\n    password_hash: "${hash}"\n    role: owner\n    enabled: ${enabled}\n    created_at: "2026-10-18T00:00:00.000Z"\n`;
    await writeFile(
      adminsPath,
      `version: "1"\nadmins:\n${["alice", "bobby", "carol", "dave1", "erin1", "frank", "grace"].map((id) => admin(id)).join("")}${admin("heidi", false)}`,
      "utf8"
    );
    await writeFile(path.join(root, "webui", "config", "access.yaml"), "users: []\n", "utf8");
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
    await writeFile(path.join(root, "bootstrap-token"), "bootstrap-token-for-tests-0123456789\n", "utf8");

    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.KTX_PROJECT_ROOT = root;
    process.env.LUCY_ADMINS_CONFIG_PATH = adminsPath;
    process.env.LUCY_WEBUI_SESSION_SECRET = "test-session-secret-32bytes-min!!";
    process.env.LUCY_DEPLOYMENT_MODE = "customer";
    process.env.LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE = path.join(root, "bootstrap-token");
    delete process.env.LUCY_WEBUI_AUTH;
    delete process.env.LUCY_TRUST_PROXY;
    delete process.env.LUCY_TRUSTED_PROXY_CIDRS;
    resetAdminsCache();
    resetSessionSecretCache();
    closeSecurityStore();
  });

  afterEach(async () => {
    vi.useRealTimers();
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
  type App = Awaited<ReturnType<typeof startApp>>;

  const login = (app: App, adminId: string, password: string, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { adminId, password } });

  const bootstrapWith = (app: App, token: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: "/api/auth/bootstrap",
      headers: { "x-lucy-bootstrap-token": token, ...headers },
      payload: { adminId: "newowner", password: "correct-horse" }
    });

  it("unknown account, disabled account and wrong password are indistinguishable 401s", async () => {
    const app = await startApp();
    const wrong = await login(app, "alice", "wrong-password-1");
    const unknown = await login(app, "nobody", "wrong-password-1");
    const disabled = await login(app, "heidi", PASSWORD);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(disabled.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    expect(disabled.json()).toEqual(wrong.json());
    expect(wrong.json().error.code).toBe("AUTH_INVALID");
    await app.close();
  });

  it("5 failures for one account+source in 15 min → 6th is 429 + Retry-After, even with the right password", async () => {
    const app = await startApp();
    for (let i = 0; i < 5; i += 1) {
      expect((await login(app, "alice", "wrong-password-1")).statusCode).toBe(401);
    }
    const blocked = await login(app, "alice", PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("AUTH_RATE_LIMITED");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(15 * 60);
    // Another account from the same source is not locked by alice's failures.
    expect((await login(app, "bobby", PASSWORD)).statusCode).toBe(200);
    await app.close();
  });

  it("unknown accounts are throttled exactly like real ones", async () => {
    const app = await startApp();
    for (let i = 0; i < 5; i += 1) {
      expect((await login(app, "ghost", "wrong-password-1")).statusCode).toBe(401);
    }
    expect((await login(app, "ghost", "wrong-password-1")).statusCode).toBe(429);
    await app.close();
  });

  it("a successful login clears that account's failure bucket but not the source total", async () => {
    const app = await startApp();
    for (let i = 0; i < 4; i += 1) await login(app, "alice", "wrong-password-1");
    expect((await login(app, "alice", PASSWORD)).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) {
      expect((await login(app, "alice", "wrong-password-1")).statusCode).toBe(401);
    }
    await app.close();
  });

  it("source total: 30 attempts / 5 min across accounts, then 429; resets after the window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T00:00:00Z"));
    const app = await startApp();
    const ids = ["alice", "bobby", "carol", "dave1", "erin1", "frank"];
    for (const id of ids) {
      for (let i = 0; i < 5; i += 1) expect((await login(app, id, "wrong-password-1")).statusCode).toBe(401);
    }
    const blocked = await login(app, "grace", PASSWORD);
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeLessThanOrEqual(5 * 60);

    vi.setSystemTime(new Date("2026-10-18T00:05:01Z"));
    // Source window passed; alice's 15-minute bucket is still hot.
    expect((await login(app, "alice", PASSWORD)).statusCode).toBe(429);
    expect((await login(app, "grace", PASSWORD)).statusCode).toBe(200);

    vi.setSystemTime(new Date("2026-10-18T00:15:02Z"));
    expect((await login(app, "alice", PASSWORD)).statusCode).toBe(200);
    await app.close();
  });

  it("buckets survive a process restart", async () => {
    const first = await startApp();
    for (let i = 0; i < 5; i += 1) await login(first, "alice", "wrong-password-1");
    await first.close();
    closeSecurityStore();

    const second = await startApp();
    expect((await login(second, "alice", PASSWORD)).statusCode).toBe(429);
    await second.close();
  });

  it("bootstrap: 5 failures per source in 15 min, then 429", async () => {
    await writeFile(adminsPath, 'version: "1"\nadmins: []\n', "utf8");
    resetAdminsCache();
    const app = await startApp();
    for (let i = 0; i < 5; i += 1) {
      expect((await bootstrapWith(app, "wrong-token")).statusCode).toBe(401);
    }
    const blocked = await bootstrapWith(app, "bootstrap-token-for-tests-0123456789");
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });

  it("rate-limit event is recorded once, never with passwords or keys", async () => {
    const app = await startApp();
    for (let i = 0; i < 8; i += 1) await login(app, "alice", "super-secret-attempt");
    await app.close();
    closeSecurityStore();

    const store = openSecurityStore(root);
    if (!store.ok) throw new Error(store.message);
    opened.push(store.value);
    const events = store.value.listEventsAfter(0);
    if (!events.ok) throw new Error(events.message);
    const limited = events.value.filter((e) => e.verdict === "rate_limited");
    expect(limited).toHaveLength(1);
    expect(JSON.stringify(events.value)).not.toContain("super-secret-attempt");
  });

  it("bucket capacity is bounded: when full, new keys fail closed with 503", async () => {
    const warm = await startApp();
    await login(warm, "alice", "wrong-password-1");
    await warm.close();
    closeSecurityStore();

    const raw = new Database(path.join(root, ".ktx-ui", "security.sqlite"));
    const insert = raw.prepare("INSERT OR IGNORE INTO auth_rate_buckets (bucket_key, window_start, count, expires_at) VALUES (?, ?, 1, ?)");
    const farFuture = Date.now() + 60 * MINUTE;
    raw.transaction(() => {
      for (let i = 0; i < 10_000; i += 1) insert.run(`filler:${i}`, Date.now(), farFuture);
    })();
    raw.close();

    const app = await startApp();
    const res = await login(app, "bobby", PASSWORD);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("AUTH_STATE_UNAVAILABLE");
    await app.close();
  });

  it("unavailable security store → 503, never unlimited attempts", async () => {
    await writeFile(path.join(root, ".ktx-ui", "security.sqlite"), "garbage, not sqlite", "utf8");
    const app = await startApp();
    const res = await login(app, "alice", PASSWORD);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("AUTH_STATE_UNAVAILABLE");
    await app.close();
  });

  it("spoofed X-Forwarded-For cannot dodge limits unless the peer is a configured trusted proxy", async () => {
    process.env.LUCY_TRUST_PROXY = "1"; // trust flag alone, no trusted proxy CIDRs
    const app = await startApp();
    for (let i = 0; i < 5; i += 1) {
      const res = await login(app, "alice", "wrong-password-1", { "x-forwarded-for": `203.0.113.${i + 1}` });
      expect(res.statusCode).toBe(401);
    }
    const blocked = await login(app, "alice", "wrong-password-1", { "x-forwarded-for": "203.0.113.99" });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it("behind a configured trusted proxy the forwarded client address is the source", async () => {
    process.env.LUCY_TRUST_PROXY = "1";
    process.env.LUCY_TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
    const app = await startApp();
    for (let i = 0; i < 5; i += 1) {
      await login(app, "alice", "wrong-password-1", { "x-forwarded-for": "198.51.100.7" });
    }
    expect((await login(app, "alice", PASSWORD, { "x-forwarded-for": "198.51.100.7" })).statusCode).toBe(429);
    // Same account from a different real client is a different bucket.
    expect((await login(app, "alice", PASSWORD, { "x-forwarded-for": "198.51.100.8" })).statusCode).toBe(200);
    await app.close();
  });
});
