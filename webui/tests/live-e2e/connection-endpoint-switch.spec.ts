/**
 * Live demo: switch mysql-aliyun server address to the active endpoint in the
 * local credentials pack, then prove connectivity.
 *
 * Secrets stay outside git:
 *   LUCY_E2E_WEBUI_LOGIN_FILE
 *   LUCY_E2E_MYSQL_ALIYUN_CREDENTIALS_FILE
 * Defaults point at ~/Projects/config-for-agents (not the repo).
 *
 * Run:
 *   cd webui && npm run e2e:live:connection-endpoint
 *
 * CI without those files → skipped (never embeds credentials).
 */

import { expect, test } from "@playwright/test";
import { ensureCanonicalFilePassword } from "./helpers/canonical-password";
import { liveSecretsAvailable, loadLiveDemoSecrets } from "./helpers/external-secrets";
import { vault } from "../real-e2e/helpers/secret-capture";

const CONN_ID = process.env.LUCY_E2E_CONNECTION_ID ?? "mysql-aliyun";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.skip(!liveSecretsAvailable(), "external login + mysql-aliyun credential files not present");
});

test("@live-demo E2E-CON-ENDPOINT-01 edit connection switches host and passes test", async ({
  page
}) => {
  const { login, mysql } = loadLiveDemoSecrets();

  const normalized = ensureCanonicalFilePassword(CONN_ID);
  expect(normalized.ok, normalized.detail).toBe(true);

  await page.goto("/login");
  await page.getByPlaceholder("例：lucy").fill(login.adminId);
  await page.locator("#login-password").fill(login.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });

  await page.goto("/connections");
  await expect(page.getByTestId(`connection-more-${CONN_ID}`)).toBeVisible();

  // Use page.request so the admin session cookie is attached.
  const before = await page.request.get("/api/project");
  expect(before.ok()).toBeTruthy();
  const beforeJson = (await before.json()) as {
    data?: { connections?: Array<{ id: string; host?: string; port?: string | number }> };
  };
  const beforeConn = beforeJson.data?.connections?.find((c) => c.id === CONN_ID);
  expect(beforeConn).toBeTruthy();

  // 「编辑连接」lives under the connection 「更多」 menu (hidden until opened).
  await page.getByTestId(`connection-more-${CONN_ID}`).locator("summary").click();
  await expect(page.getByTestId(`edit-connection-${CONN_ID}`)).toBeVisible();
  await page.getByTestId(`edit-connection-${CONN_ID}`).click();
  const dialog = page.getByTestId("edit-connection-dialog");
  await expect(dialog).toBeVisible();
  const panel = page.getByTestId("edit-connection-dialog-panel");
  await expect(panel.getByTestId("edit-connection-id")).toHaveValue(CONN_ID);

  // Layout contract from the noisy form bug: stacked connection-field + pl-input.
  for (const id of [
    "edit-connection-id",
    "edit-connection-host",
    "edit-connection-port",
    "edit-connection-username",
    "edit-connection-password"
  ] as const) {
    const input = panel.getByTestId(id);
    await expect(input).toHaveClass(/pl-input/);
    const field = input.locator("xpath=ancestor::label[1]");
    await expect(field).toHaveClass(/pl-connection-field/);
  }

  const needsSwitch = beforeConn?.host !== mysql.host;
  if (needsSwitch) {
    await panel.getByTestId("edit-connection-host").fill(mysql.host);
    await panel.getByTestId("edit-connection-port").fill(String(mysql.port));
    await panel.getByTestId("edit-connection-username").fill(mysql.username);
    await panel.getByTestId("edit-connection-password").fill(mysql.password);
    await panel.getByTestId("edit-connection-preview-btn").click();
    await expect(panel.getByTestId("edit-connection-preview")).toBeVisible({ timeout: 60_000 });
    await panel.getByTestId("edit-connection-confirm-btn").click();
    await expect(dialog).toBeHidden({ timeout: 90_000 });
  } else {
    await panel.getByTestId("edit-connection-close").click();
    await expect(dialog).toBeHidden();
  }

  const after = await page.request.get("/api/project");
  expect(after.ok()).toBeTruthy();
  const afterJson = (await after.json()) as {
    data?: { connections?: Array<{ id: string; host?: string }> };
  };
  const afterConn = afterJson.data?.connections?.find((c) => c.id === CONN_ID);
  expect(afterConn?.host).toBe(mysql.host);

  const testRes = await page.request.post(`/api/connections/${encodeURIComponent(CONN_ID)}/test`, {
    data: {}
  });
  expect(testRes.ok()).toBeTruthy();
  const testJson = (await testRes.json()) as {
    ok?: boolean;
    data?: { status?: string; test?: { status?: string } };
  };
  const status = testJson.data?.status ?? testJson.data?.test?.status;
  expect(testJson.ok).toBe(true);
  expect(status).toBe("ok");

  const bodyText = await page.content();
  expect(vault.contains(bodyText)).toBe(false);
  expect(vault.contains(JSON.stringify(afterJson))).toBe(false);
  expect(vault.contains(JSON.stringify(testJson))).toBe(false);
});
