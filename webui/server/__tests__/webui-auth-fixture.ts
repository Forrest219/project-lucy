import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resetAdminsCache } from "../auth/admins-store.js";
import { resetSessionSecretCache } from "../auth/session.js";
import { hashPassword } from "../auth/password.js";
import { closeSecurityStore } from "../security/instance.js";

/**
 * Shared real-HTTP fixture for the session / account-incarnation suites (T03).
 * Suites must `vi.mock("../admin/audit.js", …)` themselves (vi.mock is per file).
 */

const ENV_KEYS = [
  "KTX_PROJECT_ROOT",
  "LUCY_ADMINS_CONFIG_PATH",
  "LUCY_WEBUI_SESSION_SECRET",
  "LUCY_WEBUI_AUTH",
  "LUCY_DEPLOYMENT_MODE",
  "LUCY_WEBUI_COOKIE_SECURE",
  "LUCY_WEBUI_TEST_PROFILE"
] as const;

export const PASSWORD = "correct-horse-battery";
export const ENV_SECRET = "test-session-secret-32bytes-min!!";

export type AuthRow = {
  id: string;
  role: "owner" | "operator";
  password?: string;
  enabled?: boolean;
  uid?: string;
};

export type AuthFixture = {
  root: string;
  adminsPath: string;
  secretPath: string;
  securityDbPath: string;
  writeAdmins(rows: AuthRow[]): Promise<void>;
  readAdmins(): Promise<Array<Record<string, unknown>>>;
  restore(): Promise<void>;
};

export async function createAuthFixture(options: { secret: "env" | "file" }): Promise<AuthFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lucy-session-"));
  await mkdir(path.join(root, "webui", "config"), { recursive: true });
  await mkdir(path.join(root, ".ktx-ui"), { recursive: true });
  await mkdir(path.join(root, "wiki", "global"), { recursive: true });
  await writeFile(path.join(root, "webui", "config", "access.yaml"), "users: []\n", "utf8");
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  const adminsPath = path.join(root, "webui", "config", "admins.yaml");

  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  process.env.KTX_PROJECT_ROOT = root;
  process.env.LUCY_ADMINS_CONFIG_PATH = adminsPath;
  process.env.LUCY_DEPLOYMENT_MODE = "customer";
  delete process.env.LUCY_WEBUI_AUTH;
  delete process.env.LUCY_WEBUI_COOKIE_SECURE;
  delete process.env.LUCY_WEBUI_TEST_PROFILE;
  if (options.secret === "env") process.env.LUCY_WEBUI_SESSION_SECRET = ENV_SECRET;
  else delete process.env.LUCY_WEBUI_SESSION_SECRET;
  resetAdminsCache();
  resetSessionSecretCache();
  closeSecurityStore();

  const hashes = new Map<string, string>();
  const hashOf = async (password: string) => {
    let hash = hashes.get(password);
    if (!hash) {
      hash = await hashPassword(password);
      hashes.set(password, hash);
    }
    return hash;
  };

  return {
    root,
    adminsPath,
    secretPath: path.join(root, ".ktx-ui", "webui-session-secret"),
    securityDbPath: path.join(root, ".ktx-ui", "security.sqlite"),
    async writeAdmins(rows) {
      const lines = ['version: "1"', "admins:"];
      for (const row of rows) {
        lines.push(`  - id: ${row.id}`, `    display_name: ${row.id}`);
        if (row.uid) lines.push(`    account_uid: ${row.uid}`);
        lines.push(
          `    password_hash: "${await hashOf(row.password ?? PASSWORD)}"`,
          `    role: ${row.role}`,
          `    enabled: ${row.enabled === false ? "false" : "true"}`,
          '    created_at: "2026-10-18T00:00:00.000Z"'
        );
      }
      await writeFile(adminsPath, `${lines.join("\n")}\n`, "utf8");
      resetAdminsCache();
    },
    async readAdmins() {
      const doc = parse(await readFile(adminsPath, "utf8")) as { admins?: Array<Record<string, unknown>> };
      return doc.admins ?? [];
    },
    async restore() {
      closeSecurityStore();
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      resetAdminsCache();
      resetSessionSecretCache();
      await rm(root, { recursive: true, force: true });
    }
  };
}

export type RunningLucy = {
  app: Awaited<ReturnType<typeof import("../index.js").buildServer>>;
  baseUrl: string;
  stop(): Promise<void>;
};

/** Boot the real Fastify server on a loopback port; all traffic below goes over real HTTP. */
export async function startLucy(): Promise<RunningLucy> {
  const { buildServer } = await import("../index.js");
  const app = buildServer();
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no listen address");
  return {
    app: app as RunningLucy["app"],
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: async () => {
      await app.close();
    }
  };
}

/**
 * Simulate a process restart: stop the server and drop every in-memory cache,
 * so only what is on disk (`.ktx-ui/`, `webui/config/`) can answer afterwards.
 */
export async function restartLucy(running: RunningLucy): Promise<RunningLucy> {
  await running.stop();
  closeSecurityStore();
  resetAdminsCache();
  resetSessionSecretCache();
  return startLucy();
}

export function cookiePair(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

export async function login(base: string, adminId: string, password = PASSWORD): Promise<Response> {
  return fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId, password })
  });
}

export async function loginCookie(base: string, adminId: string, password = PASSWORD): Promise<string> {
  const res = await login(base, adminId, password);
  if (res.status !== 200) throw new Error(`login ${adminId} failed: ${res.status} ${await res.text()}`);
  return cookiePair(res);
}

export function api(base: string, method: string, url: string, cookie?: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

/** A protected admin read: succeeds only with a live owner/operator session. */
export const protectedAdminRead = (base: string, cookie: string) => api(base, "GET", "/api/admin/admins", cookie);
