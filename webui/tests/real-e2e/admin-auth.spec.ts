// SEC-01-V06, SEC-02-V06, SEC-03-V05, SEC-04-V11 — real browser against the real instance (auth required).
// The first test needs the instance still awaiting its first owner; the run prepared by prepare-environment.mjs
// is fresh. Sessions are held in memory only (never written to disk, trace or screenshot).

import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { assertion, covers } from "./helpers/blocked";
import { adminCredentials, bootstrapKey, fixtureAgentTokens, uiLogin } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;
const sessions: { owner?: StorageState; operator?: StorageState } = {};

async function authStatus(baseURL: string): Promise<string | undefined> {
  const res = await fetch(new URL("/api/auth/status", baseURL));
  return ((await res.json()) as { data?: { mode?: string } }).data?.mode;
}

async function ownerContext(browser: Browser): Promise<BrowserContext> {
  if (!sessions.owner) throw new Error("owner session is missing: the bootstrap test must run first");
  return browser.newContext({ storageState: sessions.owner, viewport: { width: 1440, height: 900 } });
}

test.describe.configure({ mode: "serial" });

test("anonymous browser access is sent to login and sees no management data", async ({ page, baseURL }, testInfo) => {
  covers(testInfo, "SEC-01-V06");
  const agentIds = Object.keys(fixtureAgentTokens());
  await page.goto("/admin/agents");
  await page.waitForURL(/\/login/);
  const body = await page.locator("body").innerText();
  assertion(testInfo, "deny", /登录|创建首个所有者/.test(body) && !agentIds.some((id) => body.includes(id)), "login/bootstrap form, no Agent ids rendered");
  const api = await page.request.get(new URL("/api/admin/agents", baseURL!).toString());
  assertion(testInfo, "no_side_effect", api.status() === 401 || api.status() === 503, `anonymous API read -> ${api.status()}`);
  const write = await page.request.put(new URL("/api/wiki/shared%2Fglossary.md", baseURL!).toString(), { data: { dryRun: false, content: "# anonymous\n" } });
  assertion(testInfo, "no_side_effect", write.status() === 401 || write.status() === 503, `anonymous API write -> ${write.status()}`);
  expect(body).toMatch(/登录|创建首个所有者/);
  expect(agentIds.some((id) => body.includes(id))).toBe(false);
});

test("the first owner is created through the UI with the one-time bootstrap key", async ({ page, baseURL, context }, testInfo) => {
  covers(testInfo, "SEC-02-V06");
  const mode = await authStatus(baseURL!);
  if (mode !== "bootstrap") {
    testInfo.annotations.push({ type: "blocked", description: `instance is already bootstrapped (mode ${mode}); a fresh instance is required to prove the UI bootstrap` });
    testInfo.skip(true, "BLOCKED: instance already bootstrapped");
  }
  const { owner } = adminCredentials();
  await page.goto("/login");
  await expect(page.getByTestId("login-bootstrap-token")).toBeVisible();
  await page.getByLabel("账户 id").fill(owner.adminId);
  await page.getByTestId("login-bootstrap-token").fill(bootstrapKey());
  await page.getByLabel("密码").fill(owner.password);
  await page.getByRole("button", { name: "创建并登录" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  const me = await page.request.get(new URL("/api/auth/me", baseURL!).toString());
  const body = (await me.json()) as { data?: { me?: { id?: string; role?: string } } };
  assertion(testInfo, "allow_control", me.status() === 200 && body.data?.me?.role === "owner", `bootstrap signed in as ${body.data?.me?.role}`);
  expect(body.data?.me?.id).toBe(owner.adminId);
  // The key must not be persisted by the page (login copy states it stays in memory only).
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
  expect(vault.contains(stored)).toBe(false);
  sessions.owner = await context.storageState();
  const status = await authStatus(baseURL!);
  expect(status).toBe("required");
});

test("owner adds an operator in the UI; the operator cannot govern accounts but can do daily work", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-03-V05");
  const { operator } = adminCredentials();
  const ownerCtx = await ownerContext(browser);
  try {
    const page = await ownerCtx.newPage();
    await page.goto("/admin/admins");
    await expect(page.getByRole("heading", { name: "添加登录账户" })).toBeVisible();
    const form = page.locator("form", { has: page.getByRole("heading", { name: "添加登录账户" }) });
    await form.getByLabel("账户 id").fill(operator.adminId);
    await form.getByLabel("显示名").fill("E2E Operator");
    await form.getByLabel("角色").selectOption("operator");
    await form.getByLabel("初始密码").fill(operator.password);
    await form.getByRole("button", { name: "创建账户" }).click();
    await expect(page.getByTestId("admin-accounts-table").getByText(operator.adminId)).toBeVisible();
  } finally {
    await ownerCtx.close();
  }

  const opCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await opCtx.newPage();
    await uiLogin(page, operator);
    await page.goto("/admin/admins");
    const governs = await page.getByRole("heading", { name: "添加登录账户" }).count();
    const disableButtons = await page.getByRole("button", { name: "禁用" }).count();
    assertion(testInfo, "deny", governs === 0 && disableButtons === 0, `operator sees account governance controls: form=${governs} buttons=${disableButtons}`);
    const apiDenied = await page.request.post(new URL("/api/admin/admins", baseURL!).toString(), {
      data: { adminId: "e2e-ui-made-owner", password: "Ui-made-password-1", role: "owner" }
    });
    assertion(testInfo, "deny", apiDenied.status() === 403, `operator account creation via the session -> ${apiDenied.status()}`);
    await page.goto("/admin/roles");
    await expect(page).not.toHaveURL(/\/login/);
    const roles = await page.request.get(new URL("/api/admin/roles", baseURL!).toString());
    assertion(testInfo, "allow_control", roles.status() === 200, `operator reads roles -> ${roles.status()}`);
    expect(governs).toBe(0);
    expect(disableButtons).toBe(0);
    sessions.operator = await opCtx.storageState();
  } finally {
    await opCtx.close();
  }
});

test("a session revoked from the UI stops working immediately in the other browser", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-04-V11");
  const { operator } = adminCredentials();
  if (!sessions.operator) throw new Error("operator session is missing: the previous test must run first");
  const opCtx = await browser.newContext({ storageState: sessions.operator, viewport: { width: 1440, height: 900 } });
  const opPage = await opCtx.newPage();
  await opPage.goto("/admin/roles");
  await expect(opPage).not.toHaveURL(/\/login/);

  const ownerCtx = await ownerContext(browser);
  try {
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/admin/admins");
    const row = ownerPage.locator("tr", { hasText: operator.adminId });
    await row.getByRole("button", { name: "禁用" }).click();
    await expect(row.getByText("已禁用")).toBeVisible();
  } finally {
    await ownerCtx.close();
  }

  await opPage.reload();
  await opPage.waitForURL(/\/login/);
  const replay = await opPage.request.get(new URL("/api/admin/agents", baseURL!).toString());
  assertion(testInfo, "deny", replay.status() === 401, `revoked session API replay -> ${replay.status()}`);
  const text = await opPage.locator("body").innerText();
  assertion(testInfo, "no_leak", !vault.contains(text) && !/e2e_finance/.test(text), "no management data after revocation");
  await opCtx.close();
  expect(replay.status()).toBe(401);
});
