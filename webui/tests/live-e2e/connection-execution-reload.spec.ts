/**
 * Live demo — Spec 191 / Plan Task 5 browser gates.
 *
 *   E2E-MCP-02  写路径与手动「重载执行层」同协议
 *   E2E-CON-07  新建连接后执行层必须加载新连接
 *
 * Prerequisites: running Lucy container with supervise_ktx + capability;
 * external WebUI login file (see helpers/external-secrets.ts).
 *
 * Run:
 *   cd webui && npm run e2e:live:connection-reload
 */

import { expect, test, type Page } from "@playwright/test";
import { DEMO_DB, uniqueConnectionId } from "./helpers/demo-db";
import { liveSecretsAvailable, loadLiveDemoSecrets } from "./helpers/external-secrets";
import {
  bumpKtxYamlDigestInContainer,
  executionOf,
  fetchRuntimeStatus,
  loginViaUi,
  removeConnection,
  waitForActivationCurrent
} from "./helpers/execution-runtime";
import { vault } from "../real-e2e/helpers/secret-capture";

const AGENT_ID = process.env.LUCY_E2E_MCP_AGENT_ID ?? "demo_agent";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  test.skip(!liveSecretsAvailable(), "external WebUI login file not present");
});

async function openMcpPlayground(page: Page): Promise<void> {
  await page.goto(
    `/admin/mcp-playground?agentId=${encodeURIComponent(AGENT_ID)}&mode=live-smoke`
  );
  await expect(page.getByTestId("mcp-playground-page")).toBeVisible({ timeout: 30_000 });
}

test("@live-demo E2E-MCP-02 manual reload shares Spec 191 protocol", async ({ page }) => {
  const { login } = loadLiveDemoSecrets();
  await loginViaUi(page, login);

  const before = executionOf(await fetchRuntimeStatus(page.request));
  if (before.activation !== "reload_required") {
    bumpKtxYamlDigestInContainer();
  }

  await openMcpPlayground(page);

  // Poll until UI reflects reload_required (status query may lag the bump).
  await expect
    .poll(
      async () => executionOf(await fetchRuntimeStatus(page.request)).activation,
      { timeout: 30_000 }
    )
    .toBe("reload_required");

  const remediation = page.getByTestId("mcp-runtime-remediation");
  await expect(remediation).toBeVisible({ timeout: 30_000 });
  await expect(remediation).toContainText("尚未加载");
  await expect(remediation).toContainText("重载执行层");
  await expect(remediation).not.toContainText("重启 Pod");
  await expect(remediation).not.toContainText("请重启");

  const reloadBtn = page.locator("[data-testid^='mcp-runtime-reload-']").first();
  await expect(reloadBtn).toBeVisible();

  const reloadResponsePromise = page.waitForResponse(
    (res) =>
      res.url().includes("/api/admin/mcp-runtime/reload") && res.request().method() === "POST",
    { timeout: 120_000 }
  );
  await reloadBtn.click();
  const reloadRes = await reloadResponsePromise;
  expect(reloadRes.ok()).toBeTruthy();
  const reloadJson = (await reloadRes.json()) as {
    ok?: boolean;
    data?: {
      reloadStatus?: string;
      configVerification?: string;
      requestId?: string;
      ok?: boolean;
      success?: boolean;
    };
  };
  expect(reloadJson.ok).toBe(true);
  const payload = reloadJson.data ?? {};
  expect(payload).toHaveProperty("reloadStatus");
  expect(payload).toHaveProperty("configVerification");
  expect(payload).not.toHaveProperty("ok");
  expect(payload).not.toHaveProperty("success");
  expect(["succeeded", "already_running"]).toContain(payload.reloadStatus);
  if (payload.reloadStatus === "succeeded") {
    expect(payload.configVerification).toBe("verified");
  }

  const outcome = page.getByTestId("mcp-runtime-reload-outcome");
  await expect(outcome).toBeVisible({ timeout: 30_000 });
  await expect(outcome).not.toHaveText(/伪报|已全部生效/);

  const after = await waitForActivationCurrent(page.request, { timeoutMs: 60_000 });
  expect(after.activation).toBe("current");
  expect(after.verification?.state).toBe("verified");

  const bodyText = await page.content();
  expect(vault.contains(bodyText)).toBe(false);
});

test("@live-demo E2E-CON-07 create connection loads execution runtime", async ({ page }) => {
  const { login } = loadLiveDemoSecrets();
  // Session may already exist from the serial prior test.
  if (!page.url().includes("127.0.0.1") && !page.url().includes("localhost")) {
    await loginViaUi(page, login);
  } else if (page.url().includes("/login")) {
    await loginViaUi(page, login);
  } else {
    const probe = await page.request.get("/api/auth/status");
    const status = (await probe.json()) as { data?: { me?: unknown } };
    if (!status.data?.me) {
      await loginViaUi(page, login);
    }
  }

  const connectionId = uniqueConnectionId();
  vault.register(DEMO_DB.password);

  await page.goto("/connections");
  const start = page
    .getByTestId("create-connection-btn")
    .or(page.getByTestId("create-connection-empty-btn"));
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();

  const drawer = page.getByTestId("create-connection-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByTestId("create-connection-id").fill(connectionId);
  await drawer.getByTestId("create-connection-driver").selectOption(DEMO_DB.driver);
  await drawer.getByTestId("create-connection-host").fill(DEMO_DB.host);
  await drawer.getByTestId("create-connection-port").fill(String(DEMO_DB.port));
  await drawer.getByTestId("create-connection-database").first().fill(DEMO_DB.database);
  await drawer.getByTestId("create-connection-username").fill(DEMO_DB.username);
  await drawer.getByTestId("create-connection-password").fill(DEMO_DB.password);
  await drawer.getByTestId("create-connection-schemas").fill(DEMO_DB.schema);

  await drawer.getByTestId("create-connection-test-btn").click();
  const probe = drawer.getByTestId("create-connection-probe-result").first();
  await expect(probe).toBeVisible();
  await expect(probe).not.toHaveText(/正在测试连接/, { timeout: 90_000 });
  const probeText = (await probe.innerText()).trim();
  expect(probeText, `probe failed: ${probeText}`).toContain("连接成功");

  const createResponsePromise = page.waitForResponse(
    (res) => {
      if (!res.url().includes("/api/connections") || res.request().method() !== "POST") {
        return false;
      }
      // Ignore probe endpoint.
      return !res.url().includes("/api/connections/probe");
    },
    { timeout: 180_000 }
  );

  await drawer.getByTestId("create-connection-preview-btn").click();

  const gate = page.getByTestId("endpoint-gate-panel");
  await gate.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  if (await gate.isVisible().catch(() => false)) {
    const separate = page.getByTestId("endpoint-gate-separate");
    const differentDb = page.getByTestId("endpoint-gate-different-database");
    if (await separate.isVisible().catch(() => false)) {
      await separate.click();
    } else if (await differentDb.isVisible().catch(() => false)) {
      await differentDb.click();
      // different-database path re-enters preview then confirm
      await expect(drawer.getByTestId("create-connection-confirm-btn")).toBeVisible({
        timeout: 60_000
      });
      await drawer.getByTestId("create-connection-confirm-btn").click();
    } else {
      throw new Error(
        `endpoint gate visible but no separate/different-database action: ${await gate.innerText()}`
      );
    }
  } else {
    await expect(drawer.getByTestId("create-connection-confirm-btn")).toBeVisible({
      timeout: 60_000
    });
    await drawer.getByTestId("create-connection-confirm-btn").click();
  }

  const createRes = await createResponsePromise;
  const createJson = (await createRes.json()) as {
    ok?: boolean;
    data?: {
      written?: boolean;
      executionRuntimeAck?: boolean;
      executionRuntimeStatus?: string;
      executionDecisionReason?: string;
      test?: { status?: string };
    };
    error?: { code?: string; message?: string };
  };

  // If first POST was dryRun preview, wait for the committing write.
  let commitJson = createJson;
  let commitRes = createRes;
  const body = createRes.request().postDataJSON() as { dryRun?: boolean } | null;
  if (body?.dryRun === true || createRes.status() === 409) {
    commitRes = await page.waitForResponse(
      (res) => {
        if (!res.url().includes("/api/connections") || res.request().method() !== "POST") {
          return false;
        }
        if (res.url().includes("/probe")) return false;
        try {
          const b = res.request().postDataJSON() as { dryRun?: boolean; id?: string };
          return b?.dryRun === false && b?.id === connectionId;
        } catch {
          return false;
        }
      },
      { timeout: 180_000 }
    );
    commitJson = (await commitRes.json()) as typeof createJson;
  }

  expect(commitRes.ok(), JSON.stringify(commitJson).slice(0, 400)).toBeTruthy();
  expect(commitJson.ok).toBe(true);
  expect(commitJson.data?.written).toBe(true);
  expect(commitJson.data?.test?.status).toBe("ok");
  expect(commitJson.data?.executionRuntimeAck).toBe(true);

  await expect(drawer.getByTestId("create-connection-success")).toBeVisible({ timeout: 30_000 });
  const execFace = drawer.getByTestId("create-connection-execution-runtime");
  await expect(execFace).toBeVisible();
  await expect(execFace).toContainText("已加载新连接");
  await expect(execFace).not.toContainText("尚未确认加载");

  await drawer.getByTestId("create-connection-done-btn").click();

  const exec = await waitForActivationCurrent(page.request, {
    connectionId,
    timeoutMs: 60_000
  });
  expect(exec.activation).toBe("current");
  expect(exec.verification?.state).toBe("verified");
  expect(exec.unknownConnections ?? []).not.toContain(connectionId);
  expect(exec.missingConnections ?? []).not.toContain(connectionId);

  try {
    await removeConnection(page.request, connectionId);
  } catch (err) {
    // Cleanup best-effort; failure must not hide the green assertions above.
    console.warn(`cleanup remove failed: ${err instanceof Error ? err.message : err}`);
  }

  const bodyText = await page.content();
  expect(vault.contains(bodyText)).toBe(false);
  expect(vault.contains(JSON.stringify(commitJson))).toBe(false);
});
