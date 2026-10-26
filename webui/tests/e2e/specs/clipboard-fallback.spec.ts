// webui/tests/e2e/specs/clipboard-fallback.spec.ts
// Spec 189 / Plan M65 — copy entry points must survive a non-secure context.
//
// The Clipboard API is `[SecureContext]`-gated. On the supported intranet-HTTP
// customer mode (`security.access=http`) the browser never exposes
// `navigator.clipboard`, so a copy button that touches it directly throws and
// silently does nothing. The e2e fixture runs on a loopback origin (a secure
// context), so the only way to exercise that path here is to remove the API
// from the page before any script runs — exactly the shape the production
// intranet-HTTP deployment has.
//
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted

import { test, expect, type Page } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

const E2E_TOKEN = "lucy_e2e_clipboard_token";

/**
 * Remove the Clipboard API and record what the legacy fallback receives.
 * `execCommandResult` decides whether the fallback reports success.
 */
async function installClipboardStub(page: Page, execCommandResult: boolean) {
  await page.addInitScript((result: boolean) => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get: () => undefined
    });
    const recorded: Array<{ command: string; text: string | null }> = [];
    (window as unknown as { __lucyClipboardCalls: typeof recorded }).__lucyClipboardCalls = recorded;
    document.execCommand = ((command: string) => {
      const textarea = document.querySelector("textarea");
      recorded.push({
        command,
        text: textarea ? (textarea as HTMLTextAreaElement).value : null
      });
      return result;
    }) as typeof document.execCommand;
  }, execCommandResult);
}

/** Stub token issuance so the contract run never writes a real credential. */
async function stubTokenCreation(page: Page) {
  await page.route("**/api/admin/agents/*/tokens", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          token: "lucy_e2e_clipboard_token",
          hash: "sha256:e2e-clipboard",
          label: "e2e-clipboard",
          created: "2026-10-26T00:00:00.000Z",
          expires_at: "2027-10-26T23:59:59.999Z"
        }
      })
    });
  });
}

async function openNewTokenPage(page: Page) {
  await page.goto("/admin/agents");
  await expect(page.getByTestId("agent-list-table")).toBeVisible();

  const editLink = page.getByRole("link", { name: "编辑" }).first();
  const href = await editLink.getAttribute("href");
  const agentId = href?.split("/").filter(Boolean).pop();
  expect(agentId).toBeTruthy();

  await page.goto(`/admin/agents/${agentId}/tokens/new`);
  await page.getByLabel("Token 标签").fill("e2e-clipboard");
  await page.getByRole("button", { name: "生成 Token" }).click();
  await expect(page.getByTestId("snippet-active")).toBeVisible();
}

async function readClipboardCalls(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __lucyClipboardCalls: Array<{ command: string; text: string | null }> }).__lucyClipboardCalls
  );
}

test.describe("Spec 189 clipboard fallback", () => {
  test.beforeAll(() => {
    assertFixtureOnly({ warnIfMissing: true });
  });

  test("@pr-impacted 复制当前配置 在没有 Clipboard API 时回退成功", async ({ page }) => {
    await installClipboardStub(page, true);
    await stubTokenCreation(page);
    await openNewTokenPage(page);

    await page.getByRole("button", { name: /复制当前配置/ }).click();

    await expect(page.getByRole("button", { name: /已复制/ })).toBeVisible();

    const calls = await readClipboardCalls(page);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.command).toBe("copy");
    expect(calls[0]?.text).toContain("Bearer lucy_e2e_clipboard_token");

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted 复制当前配置 在两条路径都不可用时提示失败且不谎报成功", async ({ page }) => {
    await installClipboardStub(page, false);
    await stubTokenCreation(page);
    await openNewTokenPage(page);

    await page.getByRole("button", { name: /复制当前配置/ }).click();

    await expect(page.getByText("客户端配置复制失败，请手动选择文本")).toBeVisible();
    await expect(page.getByRole("button", { name: /复制当前配置/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /已复制/ })).toHaveCount(0);
  });
});
