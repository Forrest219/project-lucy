// webui/tests/e2e/specs/agent-admin.spec.ts
// Spec 129 — Agent Admin browser audit remediation
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted
//
// 不做 docker 重建后的人工浏览器验收；本文件覆盖自动化回归契约。

import { test, expect } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

test.describe("Spec 129 Agent Admin", () => {
  test.beforeAll(() => {
    assertFixtureOnly({ warnIfMissing: true });
  });

  test("@pr-impacted Agent 列表筛选清除与正式 Role 选择", async ({ page }) => {
    await page.goto("/admin/agents");
    await expect(page.getByTestId("agent-list-section")).toBeVisible();
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    const search = page.getByLabel("搜索显示名或用户 ID");
    await search.fill("__no_such_agent__");
    await expect(page.getByText("未找到符合条件的 Agent")).toBeVisible();
    await page.getByTestId("clear-filters-btn-empty").click();
    await expect(page.getByTestId("agent-list-table")).toBeVisible();

    await page.getByRole("button", { name: "新建 Agent" }).click();
    const roleSelect = page.locator("select").filter({ has: page.locator("option") }).first();
    await expect(roleSelect).toBeVisible();
    const optionTexts = await roleSelect.locator("option").allTextContents();
    expect(optionTexts.some((t) => t.includes("参考模板"))).toBe(false);

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
