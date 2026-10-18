// webui/tests/e2e/specs/agent-admin.spec.ts
// Spec 129 — Agent Admin browser audit remediation
// Spec 168 — Agent 角色多选
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted
//
// 不做 docker 重建后的人工浏览器验收；本文件覆盖自动化回归契约。

import { test, expect, type Page } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

const SECOND_ROLE_ID = "e2e_second_role";

async function ensureTwoFormalRoles(page: Page) {
  await page.route("**/api/admin/roles**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const json = await response.json();
    const roles = Array.isArray(json?.data?.roles) ? [...json.data.roles] : [];
    const injectRole = (id: string, description: string) => {
      if (roles.some((role) => role?.id === id)) return;
      roles.push({
        id,
        description,
        source: "yaml",
        tools: ["lucy_catalog"],
        connections: [],
        sourceNames: [],
        sourceCount: 0,
        invalid: false,
        warnings: []
      });
    };
    // Spec 168 needs ≥2 selectable formal roles; inject fixtures when demo ACL is thin.
    injectRole(SECOND_ROLE_ID, "Second formal role for multi-select");
    const formalCount = roles.filter((role) => role?.source !== "template" && role?.invalid !== true).length;
    if (formalCount < 2) {
      injectRole("e2e_third_role", "Third formal role for multi-select");
    }
    json.data = { ...(json.data ?? {}), roles };
    await route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify(json)
    });
  });
}

async function expectTwoRolesStayChecked(field: ReturnType<Page["getByTestId"]>) {
  await expect(field).toBeVisible();
  await expect(field.locator("select")).toHaveCount(0);
  const enabled = field.locator("[data-testid='agent-role-option']:not([disabled])");
  await expect(enabled.nth(1)).toBeVisible();
  const first = enabled.nth(0);
  const second = enabled.nth(1);
  await first.check();
  await second.check();
  await expect(first).toBeChecked();
  await expect(second).toBeChecked();
}

test.describe("Spec 129 Agent Admin", () => {
  test.beforeAll(() => {
    assertFixtureOnly({ warnIfMissing: true });
  });

  test("@pr-impacted Agent 列表筛选清除与正式 Role 选择", async ({ page }) => {
    await ensureTwoFormalRoles(page);
    await page.goto("/admin/agents");
    await expect(page.getByTestId("agent-list-section")).toBeVisible();
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    const search = page.getByLabel("搜索显示名或用户 ID");
    await search.fill("__no_such_agent__");
    await expect(page.getByText("未找到符合条件的 Agent")).toBeVisible();
    await page.getByTestId("clear-filters-btn-empty").click();
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    await page.getByRole("button", { name: "新建 Agent" }).click();
    const field = page.getByTestId("agent-role-field");
    await expect(field).toBeVisible();
    await expect(field).not.toContainText("参考模板");
    await expectTwoRolesStayChecked(field);

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted Agent 详情角色可同时勾选多个", async ({ page }) => {
    await ensureTwoFormalRoles(page);
    await page.goto("/admin/agents");
    await expect(page.getByTestId("agent-list-table")).toBeVisible();
    await page.getByRole("link", { name: "编辑" }).first().click();
    await expect(page).toHaveURL(/\/admin\/agents\/[^/?]+/);

    await expectTwoRolesStayChecked(page.getByTestId("agent-role-field"));

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted Agent 详情 URL 页签与数据能力摘要", async ({ page }) => {
    await page.goto("/admin/agents");
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    const editLink = page.getByRole("link", { name: "编辑" }).first();
    await editLink.click();
    await expect(page).toHaveURL(/\/admin\/agents\/[^/?]+/);

    await page.getByRole("tab", { name: "权限预览" }).click();
    await expect(page).toHaveURL(/[?&]tab=permissions/);
    await expect(page.getByTestId("permissions-tree")).toBeVisible();
    await expect(page.getByText("数据能力")).toBeVisible();

    await page.getByRole("tab", { name: "Token" }).click();
    await expect(page).toHaveURL(/[?&]tab=tokens/);

    await page.reload();
    await expect(page).toHaveURL(/[?&]tab=tokens/);
    await expect(page.getByRole("tab", { name: "Token" })).toHaveAttribute("aria-selected", "true");

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted Agent 对象抽屉打开与关闭", async ({ page }) => {
    await page.goto("/admin/agents");
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    const nameLink = page.locator("[data-testid^='agent-name-link-']").first();
    await nameLink.click();
    await expect(page.getByTestId("object-detail-drawer")).toBeVisible();
    await expect(page.getByText("关闭方式")).toHaveCount(0);
    await page.getByTestId("object-detail-close").click();
    await expect(page.getByTestId("object-detail-drawer")).toHaveCount(0);
  });
});
