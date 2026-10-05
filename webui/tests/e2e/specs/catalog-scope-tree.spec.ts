import { expect, test } from "@playwright/test";

test.describe("@pr-smoke Catalog scope tree", () => {
  test("supports deep links, search, counts, expansion and keyboard navigation", async ({ page }) => {
    await page.goto("/catalog?scope=all");
    await expect(page.getByTestId("catalog-scope-tree")).toBeVisible();
    await expect(page.getByTestId("catalog-result-count")).toContainText(/\d+ 条结果/);

    const connection = page.getByRole("treeitem").nth(1);
    await connection.click();
    await expect(page).toHaveURL(/connection=/);
    await expect(connection).toHaveAttribute("aria-expanded", "true");
    const schema = page.getByRole("treeitem").nth(2);
    await schema.click();
    await expect(page).toHaveURL(/schema=/);
    await expect(schema).toHaveAttribute("aria-selected", "true");
    const deepLink = page.url();
    await page.reload();
    await expect(page).toHaveURL(deepLink);

    await page.getByTestId("catalog-tree-root").click();
    await expect(page).not.toHaveURL(/connection=/);
    await expect(page.getByTestId("catalog-tree-root")).toHaveAttribute("aria-selected", "true");

    const root = page.getByTestId("catalog-tree-root");
    await root.focus();
    await root.press("ArrowRight");
    await expect(page.getByRole("treeitem").nth(1)).toBeFocused();
    await page.getByRole("treeitem").nth(1).press("ArrowRight");
    await page.getByRole("treeitem").nth(1).press("ArrowRight");
    await expect(page.getByRole("treeitem").nth(2)).toBeFocused();
    await page.getByRole("treeitem").nth(2).press("ArrowLeft");
    await expect(page.getByRole("treeitem").nth(1)).toBeFocused();
  });
});
