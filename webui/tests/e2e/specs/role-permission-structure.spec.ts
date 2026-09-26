// webui/tests/e2e/specs/role-permission-structure.spec.ts
// Spec 150 — Role 权限配置结构化重构
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const ACCEPTANCE_DIR = resolve(process.cwd(), "../inbox/role-permission-ia-acceptance-20260926");

function acceptancePath(fileName: string): string | undefined {
  if (process.env.LUCY_CAPTURE_ACCEPTANCE !== "1") return undefined;
  mkdirSync(ACCEPTANCE_DIR, { recursive: true });
  return resolve(ACCEPTANCE_DIR, fileName);
}

type RoleFixture = {
  id: string;
  source: "yaml" | "template";
  usageCount: number;
};

function roleDetail(fixture: RoleFixture) {
  return {
    id: fixture.id,
    version: "role-version-1",
    description: "浏览器验收 Role",
    source: fixture.source,
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["superstore_orders"],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: fixture.usageCount,
    users: fixture.usageCount
      ? [{ id: "demo_agent", name: "Demo Agent", enabled: true, tokenCount: 1 }]
      : [],
    role: {
      description: "浏览器验收 Role",
      allow: {
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        tableSelectors: [{
          connection: "mysql-aliyun",
          schema: "dataforai",
          names: ["superstore_orders"],
        }],
      },
    },
    effectivePermissions: {
      roleIds: [fixture.id],
      snapshotHash: "snapshot-1",
      sourceMapVersion: "source-map-1",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [{
        connectionId: "mysql-aliyun",
        schema: "dataforai",
        sourceName: "superstore_orders",
        table: "dataforai.superstore_orders",
      }],
      legacyAllow: false,
      capabilities: [],
    },
    skillAccess: {
      discoverEnabled: true,
      readEnabled: false,
      declared: ["lucy-skill://finance_ops/quarter-close"],
      discoverable: ["lucy-skill://finance_ops/quarter-close"],
      readable: [],
      declaredWithoutChannel: ["lucy-skill://finance_ops/quarter-close"],
    },
  };
}

async function installRoleApi(page: Page, fixture: RoleFixture = { id: "analyst", source: "yaml", usageCount: 0 }) {
  const writes: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() as Record<string, unknown> | null;

    if (url.pathname === "/api/connections") {
      await route.fulfill({ json: { ok: true, data: { connections: [{ id: "mysql-aliyun", schemas: ["dataforai"], enabledTables: ["dataforai.superstore_orders"] }] } } });
      return;
    }
    if (url.pathname === "/api/connections/mysql-aliyun/tables") {
      await route.fulfill({ json: { ok: true, data: { tables: ["dataforai.superstore_orders", "dataforai.superstore_returns"] } } });
      return;
    }
    if (url.pathname === "/api/admin/mcp-tools") {
      await route.fulfill({ json: { ok: true, data: { tools: [
        { name: "lucy_query", globalDenied: false },
        { name: "lucy_catalog", globalDenied: false },
        { name: "lucy_read_source", globalDenied: false },
        { name: "lucy_explain_query", globalDenied: false },
        { name: "lucy_freshness", globalDenied: false },
        { name: "lucy_begin_question", globalDenied: false },
        { name: "wiki_search", globalDenied: false },
        { name: "wiki_read", globalDenied: false },
        { name: "sl_query", globalDenied: true },
      ] } } });
      return;
    }
    if (url.pathname === "/api/sources/mysql-aliyun/dataforai/superstore_orders") {
      await route.fulfill({ json: { ok: true, data: { model: {
        conn: "mysql-aliyun",
        schema: "dataforai",
        table: "superstore_orders",
        filePath: "semantic-layer/superstore_orders.yaml",
        descriptions: {},
        columns: [{ name: "region", type: "string", descriptions: {} }, { name: "order_id", type: "string", descriptions: {} }],
        measures: [{ name: "total_sales", expr: "sum(sales)" }],
      }, rawYaml: "", completion: "done" } } });
      return;
    }
    if (url.pathname === `/api/admin/roles/${fixture.id}` && method === "GET") {
      await route.fulfill({ json: { ok: true, data: roleDetail(fixture) } });
      return;
    }
    if (url.pathname.startsWith("/api/admin/roles") && method !== "GET") {
      writes.push({ method, url: url.pathname, body: body ?? {} });
      if (body?.dryRun === true) {
        await route.fulfill({ json: { ok: true, data: { diff: "+ role permission change", proposedYaml: "roles: {}", version: "preview-version-1" } } });
      } else {
        await route.fulfill({ json: { ok: true, data: { written: true, runtimeAck: true, policyVersion: "policy-version-2" } } });
      }
      return;
    }
    await route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: url.pathname } } });
  });
  return writes;
}

test.describe("Spec 150 Role permission structure", () => {
  test("@pr-impacted new Role shares one draft and saves through the confirmation Drawer", async ({ page }) => {
    const writes = await installRoleApi(page);
    await page.goto("/admin/roles/new");

    await expect(page.getByRole("tab", { name: "基本信息" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /可访问的表/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /允许的 MCP 工具/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /行级策略/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: "权限配置" })).toHaveCount(0);
    await expect(page.getByTestId("role-dirty-bar")).toHaveCount(0);

    await page.getByLabel(/^角色标识/).fill("browser_role");
    await page.getByRole("tab", { name: /可访问的表/ }).click();
    await page.getByRole("checkbox", { name: "superstore_orders" }).check();
    await page.getByRole("tab", { name: /允许的 MCP 工具/ }).click();
    await page.getByRole("button", { name: "只读问答", exact: true }).click();
    await page.getByRole("tab", { name: /可访问的表/ }).click();
    await expect(page.getByRole("checkbox", { name: "superstore_orders" })).toBeChecked();
    await expect(page.getByTestId("role-dirty-bar")).toBeVisible();
    expect(writes).toHaveLength(0);

    await page.getByRole("button", { name: "保存权限配置" }).click();
    const review = page.getByTestId("role-permission-review-drawer");
    await expect(review).toBeVisible();
    await expect(review.getByText("确认权限变更")).toBeVisible();
    await expect(review.getByText("完整 YAML diff")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body.dryRun).toBe(true);
    expect(JSON.stringify(writes[0]?.body)).not.toContain("prefix");

    await review.getByRole("button", { name: "确认保存" }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]?.body.dryRun).toBe(false);
    expect((writes[1]?.body as any).role).toEqual((writes[0]?.body as any).role);
  });

  test("@pr-impacted legacy permissions deep link opens tables and row policy uses physical columns", async ({ page }) => {
    await installRoleApi(page);
    await page.goto("/admin/roles/analyst?tab=permissions");
    await expect(page).toHaveURL(/[?&]tab=tables/);
    await expect(page.getByRole("tab", { name: /可访问的表/ })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: /行级策略/ }).click();
    const trigger = page.getByRole("button", { name: "编辑 superstore_orders 行级策略" });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "编辑行级策略" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await drawer.getByRole("button", { name: "添加条件" }).click();
    await expect(drawer.getByRole("option", { name: "region" })).toBeAttached();
    await expect(drawer.getByRole("option", { name: "total_sales" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "删除 superstore_orders 条件 1" })).toBeVisible();
    await drawer.getByLabel(/条件 1 字段/).selectOption("region");
    await drawer.getByLabel(/条件 1 取值/).fill("华东");
    await drawer.getByRole("button", { name: "应用" }).click();
    await expect(page.getByText("已配置 1 条条件")).toBeVisible();
  });

  test("@pr-impacted catalog_bound requires confirmation, clears exact grants, and disables row policy", async ({ page }) => {
    await installRoleApi(page);
    await page.goto("/admin/roles/new?tab=tables");
    await page.getByRole("checkbox", { name: "superstore_orders" }).check();
    await page.getByText("高级设置").click();
    await page.getByRole("checkbox", { name: "启用目录绑定" }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button", { name: "确认切换" }).click();

    await expect(page.getByText(/已声明连接上，后续新启用的表自动进入/)).toBeVisible();
    await page.getByRole("tab", { name: /行级策略/ }).click();
    await expect(page.getByTestId("row-policy-catalog-bound-disabled")).toBeVisible();
    await page.getByRole("tab", { name: /可访问的表/ }).click();
    await page.getByRole("checkbox", { name: "允许的连接 mysql-aliyun" }).check();
    await expect(page.getByTestId("role-boundary-summary")).toContainText("目录绑定");
  });

  test("@pr-impacted template is read-only and copy mode starts dirty", async ({ page }) => {
    await installRoleApi(page, { id: "readonly_template", source: "template", usageCount: 0 });
    await page.goto("/admin/roles/readonly_template");
    await expect(page.getByTestId("role-skill-access-summary")).toContainText("通道不完整");
    await expect(page.getByTestId("role-skill-access-summary")).toContainText("lucy-skill://finance_ops/quarter-close");
    await expect(page.getByText("这是参考模板，全部配置只读。可基于模板创建正式 Role。")).toBeVisible();
    await expect(page.getByRole("button", { name: "删除 Role" })).toHaveCount(0);
    await page.getByRole("link", { name: "基于此模板创建 Role" }).click();
    await expect(page).toHaveURL(/mode=copy/);
    await expect(page.getByLabel(/^角色标识/)).toBeEditable();
    await expect(page.getByTestId("role-dirty-bar")).toBeVisible();
  });

  test("@pr-impacted desktop breakpoints keep the workspace and summary usable", async ({ page }) => {
    await installRoleApi(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/roles/new?tab=overview");
    await page.getByLabel(/^角色标识/).fill("acceptance_role");
    await page.getByRole("tab", { name: /可访问的表/ }).click();
    await page.getByRole("checkbox", { name: "superstore_orders", exact: true }).check();

    for (const width of [1440, 1200, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('main[role="tabpanel"]')!;
        const summary = document.querySelector<HTMLElement>('[data-testid="role-boundary-summary"]')!;
        const dirty = document.querySelector<HTMLElement>('[data-testid="role-dirty-bar"]')!;
        return {
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          panelTop: panel.getBoundingClientRect().top,
          summaryTop: summary.getBoundingClientRect().top,
          dirtyBottom: window.innerHeight - dirty.getBoundingClientRect().bottom,
        };
      });
      expect(geometry.dirtyBottom).toBeGreaterThanOrEqual(0);
      if (width >= 1280) expect(Math.abs(geometry.summaryTop - geometry.panelTop)).toBeLessThanOrEqual(2);
      else expect(geometry.summaryTop).toBeLessThan(geometry.panelTop);
      if (width === 1024) expect(geometry.scrollWidth).toBeGreaterThan(geometry.viewportWidth);
      else expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      const path = acceptancePath(`role-create-tables-${width}.png`);
      if (path) await page.screenshot({ path, fullPage: width !== 1024 });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "保存权限配置" }).click();
    await expect(page.getByTestId("role-permission-review-drawer")).toBeVisible();
    const drawerPath = acceptancePath("role-confirmation-drawer-1440.png");
    if (drawerPath) await page.screenshot({ path: drawerPath, fullPage: true });
  });
});
