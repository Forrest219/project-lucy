// webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts
// 关联计划：docs/plans/2026-08-26-admin-data-grid-frame-consistency.md
// 标签：@pr-impacted
//
// 验证 /admin/agents、/admin/config-audit、/admin/audit 共享 pl-data-grid-frame，
// 并检查配置审计几何与访问日志有界滚动区落在首屏可达范围。

import { expect, test } from "@playwright/test";

test("@pr-impacted admin data grids share one frame contract", async ({ page }) => {
  await page.goto("/admin/agents");
  const agentsFrame = page.getByTestId("agent-list-section");
  await expect(agentsFrame).toBeVisible();
  await expect(agentsFrame).toHaveClass(/pl-data-grid-frame/);

  await page.goto("/admin/config-audit");
  const configFrame = page.getByTestId("config-audit-grid-frame");
  const configScroll = page.getByTestId("config-audit-grid-scroll");
  await expect(configFrame).toBeVisible();
  await expect(configFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(configScroll).toHaveAttribute("role", "region");

  await page.goto("/admin/audit?range=7d");
  const auditFrame = page.getByTestId("audit-turns-grid-frame");
  const auditScroll = page.getByTestId("audit-turns-grid-scroll");
  await expect(auditFrame).toBeVisible();
  await expect(auditFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(auditScroll).toHaveClass(/pl-audit-grid-scroll/);

  await page.goto("/admin/audit?range=7d&view=calls");
  const callsFrame = page.getByTestId("audit-calls-grid-frame");
  const callsScroll = page.getByTestId("audit-calls-grid-scroll");
  await expect(callsFrame).toBeVisible();
  await expect(callsFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(callsScroll).toHaveClass(/pl-audit-grid-scroll/);
});

test("@pr-impacted grid geometry is usable at the project desktop viewport", async ({ page }) => {
  await page.goto("/admin/config-audit");
  const configGeometry = await page.getByTestId("config-audit-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(configGeometry.scrollWidth).toBeLessThanOrEqual(configGeometry.clientWidth + 1);

  await page.goto("/admin/audit?range=7d");
  const auditGeometry = await page.getByTestId("audit-turns-grid-scroll").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });
  expect(auditGeometry.bottom).toBeLessThanOrEqual(auditGeometry.viewportHeight);
  expect(auditGeometry.clientHeight).toBeLessThanOrEqual(auditGeometry.scrollHeight);
});

test("@pr-impacted config audit wraps long target links inside their column", async ({ page }) => {
  const entryId = "long-semantic-target";
  await page.route("**/api/admin/config-audit**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          total: 1,
          entries: [
            {
              id: entryId,
              ts: "2026-08-26T07:38:52.000Z",
              actor: "local-admin",
              actorType: "ui_admin",
              source: "semantic_layer_import_api",
              filePath:
                "semantic-layer/mysql-aliyun/ai_intl_user_active_30d_uv_daily.yaml",
              assetKind: "semantic",
              changeType: "semantic_table_import",
              targetId: "mysql-aliyun:chatbi:ai_intl_user_active_30d_uv_daily",
              writeStatus: "committed"
            }
          ]
        }
      })
    });
  });

  await page.goto("/admin/config-audit");
  const targetLink = page.getByTestId(`config-audit-target-link-${entryId}`);
  await expect(targetLink).toBeVisible();

  const geometry = await targetLink.evaluate((node) => {
    const cell = node.closest("td");
    if (!cell) throw new Error("Target link is not inside a table cell");
    const cellRect = cell.getBoundingClientRect();
    const linkFragments = Array.from(node.getClientRects());
    const style = getComputedStyle(node);
    return {
      cellRight: cellRect.right,
      maxLinkRight: Math.max(...linkFragments.map((rect) => rect.right)),
      display: style.display,
      whiteSpace: style.whiteSpace
    };
  });
  expect(geometry.display).toBe("inline");
  expect(geometry.whiteSpace).toBe("normal");
  expect(geometry.maxLinkRight).toBeLessThanOrEqual(geometry.cellRight + 1);

  const scrollGeometry = await page.getByTestId("config-audit-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(scrollGeometry.scrollWidth).toBeLessThanOrEqual(scrollGeometry.clientWidth + 1);

  await targetLink.focus();
  await expect(targetLink).toBeFocused();
  await targetLink.click();
  await expect(page).toHaveURL(
    /\/catalog\/mysql-aliyun\/chatbi\/ai_intl_user_active_30d_uv_daily$/
  );
});
