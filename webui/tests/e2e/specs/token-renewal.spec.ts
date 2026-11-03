// 独立浏览器契约：Token 续期。
// 关联：docs/specs/lucy-20261101-token-renewal-spec.md
// 准入层级：L2。不进 PR smoke，也不代替 Docker 或客户环境。
// 标签：@pr-impacted
//
// 夹具实例真实调用续期 API 和续期对话框。已过期仍留在 YAML、撤销表半失败，
// 仍由 webui/server/__tests__/token-renewal-closure.test.ts 覆盖。

import { expect, test, type APIRequestContext } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

const AGENT_ID = "demo_agent";

function presetDate(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function issueToken(request: APIRequestContext, label: string, expiresAt: string) {
  const response = await request.post(`/api/admin/agents/${AGENT_ID}/tokens`, {
    data: { label, expires_at: expiresAt, device_name: "e2e-renew" }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const body = await response.json();
  expect(body.data?.token).toEqual(expect.any(String));
  return body.data as { token: string; hash: string; label: string; expires_at: string };
}

async function revokeToken(request: APIRequestContext, label: string) {
  const response = await request.delete(`/api/admin/agents/${AGENT_ID}/tokens/${encodeURIComponent(label)}`);
  expect(response.ok(), await response.text()).toBeTruthy();
}

test.describe("Token 续期独立契约", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeAll(() => {
    assertFixtureOnly({ warnIfMissing: true });
  });

  test("@pr-impacted 续期对话框默认 1 年，确认后只改到期日且不显示明文", async ({ page, request }) => {
    const label = `e2e-renew-${Date.now()}`;
    const issued = await issueToken(request, label, isoInDays(20));
    try {
      await page.goto("/admin/tokens");
      await expect(page.getByTestId("tokens-table")).toBeVisible();
      await expect(page.getByText("需关注续期或换签")).toBeVisible();
      await page.getByTestId("metric-help-kpi-expiring-tokens").hover();
      await expect(page.getByRole("tooltip")).toContainText("续期或换签");

      await page.getByTestId(`token-renew-${label}`).click();
      const dialog = page.getByTestId("renew-token-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByTestId("renew-token-expiry")).toHaveValue(presetDate(365));
      await expect(dialog.getByTestId("renew-token-expiry-preset-365d")).toHaveClass(/pl-segmented-control-item--active/);
      for (const id of ["30d", "90d", "180d"]) {
        await expect(dialog.getByTestId(`renew-token-expiry-preset-${id}`)).not.toHaveClass(/pl-segmented-control-item--active/);
      }
      await expect(dialog.getByTestId("renew-token-confirm")).toHaveClass(/pl-btn--primary/);

      await dialog.getByTestId("renew-token-confirm").click();
      const toast = page.getByText(/已续期至/);
      await expect(toast).toBeVisible();
      await expect(toast).not.toContainText(issued.token);
      await expect(dialog).toBeHidden();

      const listed = await request.get("/api/admin/tokens");
      expect(listed.ok()).toBeTruthy();
      const payload = await listed.json();
      const row = payload.data.tokens.find((token: { label: string }) => token.label === label);
      expect(row.expires_at).not.toBe(issued.expires_at);
      expect(row.hashPrefix.startsWith("sha256:")).toBeTruthy();
      expect(JSON.stringify(payload)).not.toContain(issued.token);
      await assertNoForbiddenTerms(page);
    } finally {
      await revokeToken(request, label);
    }
  });

  test("@pr-impacted 撤销后的 Token 不再提供续期", async ({ page, request }) => {
    const label = `e2e-renew-revoked-${Date.now()}`;
    await issueToken(request, label, isoInDays(40));
    await revokeToken(request, label);

    await page.goto("/admin/tokens");
    await expect(page.getByTestId("tokens-table")).toBeVisible();
    await expect(page.getByTestId(`token-renew-${label}`)).toHaveCount(0);

    const renew = await request.post(`/api/admin/agents/${AGENT_ID}/tokens/${encodeURIComponent(label)}/renew`, {
      data: { expires_at: isoInDays(90) }
    });
    expect(renew.status()).toBe(404);
    const body = await renew.json();
    expect(body.error.code).toBe("TOKEN_NOT_FOUND");
    expect(JSON.stringify(body)).not.toMatch(/"token"\s*:/);
  });
});
