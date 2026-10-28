// Run context for the real-user E2E specs: reads the prepared run, never invents state.
// Credentials come from <runDir>/checker/secrets (written by prepare-environment.mjs, mode 0600) and are
// registered with the SecretVault immediately, so any later text can be scanned/redacted against them.

import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { vault } from "./secret-capture";

export type RunContext = {
  runId: string;
  executionMode: "local" | "release";
  instance: { baseUrl: string; mcpUrl: string; host: string; markerWikiKey: string };
  paths: { runDir: string; project: string; checker: string; probe: string };
  fixtureDigest: string;
  db: { applied: boolean };
  secretsDir: string;
};

export type Credentials = { adminId: string; password: string };

let cached: RunContext | null = null;

export function runContext(): RunContext {
  if (cached) return cached;
  const file = process.env.LUCY_REAL_E2E_RUN;
  if (!file) throw new Error("LUCY_REAL_E2E_RUN is not set");
  const run = JSON.parse(readFileSync(file, "utf8"));
  if (run.contract !== "lucy-e2e-run-v1") throw new Error("not a lucy-e2e-run-v1 file");
  cached = run as RunContext;
  return cached;
}

function secretsFile<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(runContext().secretsDir, name), "utf8")) as T;
}

export function adminCredentials(): { owner: Credentials; operator: Credentials } {
  const creds = secretsFile<{ owner: Credentials; operator: Credentials }>("admins.json");
  vault.register(creds.owner.password);
  vault.register(creds.operator.password);
  return creds;
}

export function bootstrapKey(): string {
  const key = readFileSync(path.join(runContext().secretsDir, "bootstrap-token"), "utf8").trim();
  vault.register(key);
  return key;
}

/** Agent Token plaintexts the controller itself generated for the fixture (used for MCP-side verification). */
export function fixtureAgentTokens(): Record<string, string> {
  const tokens = secretsFile<Record<string, string>>("tokens.json");
  Object.values(tokens).forEach((token) => vault.register(token));
  return tokens;
}

export function fixtureCanaries(): Record<string, string> {
  return JSON.parse(readFileSync(path.join(runContext().paths.checker, "gold.json"), "utf8")).canaries;
}

/** Fills the real login form. Secrets are typed, never logged or attached to the report. */
export async function uiLogin(page: Page, creds: Credentials): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("登录账户").fill(creds.adminId);
  await page.getByLabel("密码", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

/**
 * How many times a form login is retried when the product's own rate limit refuses it.
 *
 * D-34 (2026-10-29): the login buckets are keyed on the SOURCE address
 * (`webui/server/auth/rate-limit.ts`: `sourceTotal` = 30 per 5 minutes, and
 * `loginAccountSource` = 5 per 15 minutes per account+source). The deliberate
 * rate-limit flood of the security leg now runs from its OWN loopback source, so the
 * legitimate traffic of this leg normally never meets the limit. This retry is the
 * belt-and-braces half of the fix (the "A′" half): if a leg still starts while the
 * bucket is saturated, it WAITS for the window to roll instead of failing its cases.
 */
const LOGIN_RETRY_ATTEMPTS = 3;

/** The seconds the product asked us to wait (`Retry-After`), or null when it is not the limit. */
async function loginRetryAfterSeconds(baseUrl: string, creds: Credentials): Promise<number | null> {
  try {
    const res = await fetch(new URL("/api/auth/login", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adminId: creds.adminId, password: creds.password })
    });
    if (res.status !== 429) return null;
    const seconds = Number(res.headers.get("retry-after"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 30;
  } catch {
    return null;
  }
}

/** A form login that survives the product's own rate limit by waiting it out. */
export async function uiLoginWithRateLimitWait(page: Page, creds: Credentials): Promise<void> {
  const baseUrl = runContext().instance.baseUrl;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await uiLogin(page, creds);
      return;
    } catch (error) {
      if (attempt >= LOGIN_RETRY_ATTEMPTS) throw error;
      const waitSeconds = await loginRetryAfterSeconds(baseUrl, creds);
      if (waitSeconds === null) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitSeconds, 120) * 1000));
    }
  }
}

export async function mcpCall(token: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(runContext().instance.mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body)
  });
  return { status: res.status, text: await res.text() };
}

export async function currentAuthMode(): Promise<string | undefined> {
  const res = await fetch(new URL("/api/auth/status", runContext().instance.baseUrl));
  return ((await res.json()) as { data?: { mode?: string } }).data?.mode;
}

/**
 * The admin session of THIS run, reused by every spec that needs one.
 *
 * The product buckets logins by SOURCE (`webui/server/auth/rate-limit.ts`):
 * `loginAccountSource` = 5 logins per account+source per 15 minutes, and
 * `sourceTotal` = 30 logins per source per 5 minutes — the SECOND one is the one that
 * actually bites a full leg, because it is shared by every account on that source. A full
 * management leg opens one browser context PER SPEC, so logging in again for each spec
 * would trip the guard halfway through the leg and the leg could never finish. So the
 * first spec logs in for real and every later spec reuses that session's storage state.
 */
let cachedSessionState: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

/** Is the cached session still accepted by the instance? */
async function sessionWorks(context: BrowserContext): Promise<boolean> {
  try {
    // A PROTECTED endpoint: `/api/auth/status` only reports the auth MODE, so it
    // cannot tell a valid session from an expired one.
    const res = await context.request.get(new URL("/api/admin/agents", runContext().instance.baseUrl).toString());
    return res.ok();
  } catch {
    return false;
  }
}

/**
 * A fresh browser context signed in as the run's owner through the real login form.
 * When the instance is still awaiting its first owner (a spec run on its own), the owner is created through
 * the real bootstrap form first. Never reuses state written to disk.
 */
export async function ownerContext(browser: Browser): Promise<BrowserContext> {
  const { owner } = adminCredentials();
  const viewport = { viewport: { width: 1440, height: 900 } };

  if (cachedSessionState) {
    const reused = await browser.newContext({ ...viewport, storageState: cachedSessionState });
    if (await sessionWorks(reused)) return reused;
    await reused.close();
    cachedSessionState = null;
  }

  const context = await browser.newContext(viewport);
  const page = await context.newPage();
  if ((await currentAuthMode()) === "bootstrap") {
    await page.goto("/login");
    await page.getByLabel("登录账户").fill(owner.adminId);
    await page.getByTestId("login-bootstrap-token").fill(bootstrapKey());
    await page.getByLabel("密码", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "创建并登录" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  } else {
    await uiLoginWithRateLimitWait(page, owner);
  }
  await page.close();
  try {
    cachedSessionState = await context.storageState();
  } catch {
    // A context whose state cannot be read simply means the next spec logs in again.
    cachedSessionState = null;
  }
  return context;
}

/** Reads the CSV text into rows (RFC 4180 subset: quotes, escaped quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Entries of a STORED (method 0) or DEFLATE zip, as the audit export pack produces. */
export function readZipEntries(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    offset = start + compressedSize;
  }
  return entries;
}
