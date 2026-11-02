// webui/tests/e2e/specs/smoke.spec.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §3 / §11.2 & docs/qa/smoke-test-design-upgrade-spec.md
// 准入层级：L1 PR Smoke（每个 PR 必跑，阻塞合并）
// 浏览器：chromium
// 标签：@pr-smoke
//
// 设计原则：10 条 L1 用例覆盖低成本 PR 阻塞路径与核心升级功能。
// 侧栏一级、二级的壳层检查不在本文件。见 e2e:release-ux。
// 跑法：npm run e2e:smoke

import { test, expect } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

test.describe("L1 PR Smoke 10 条 (升级对齐版)", () => {
  test.beforeAll(() => {
    // L1 不需要 fixture；guard 走 warn 模式，仅当 fixture 路径指向真实仓库时拦截
    assertFixtureOnly({ warnIfMissing: true });
  });

  // 1. E2E-PUB-02：/review 自动重定向
  test("@pr-smoke E2E-PUB-02 /review 自动重定向到 /publish/workbench", async ({ page }) => {
    await page.goto("/review");
    await expect(page).toHaveURL(/\/publish\/workbench$/);
    await expect(page.getByTestId("publish-workbench-layout")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 2. E2E-PUB-03：发布工作台 Stepper 流水线与门禁面板
  test("@pr-smoke E2E-PUB-03 发布工作台流水线与门禁", async ({ page }) => {
    await page.goto("/publish/workbench");
    await expect(page.getByTestId("publish-workbench-layout")).toBeVisible();
    await expect(page.getByTestId("publish-flow-steps")).toBeVisible();
    await expect(page.getByTestId("publish-gate-panel")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 3. E2E-CON-01：连接卡片术语 + 开箱向导入口
  test("@pr-smoke E2E-CON-01 连接概览术语与开箱向导入口", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.getByTestId("page-header")).toBeVisible();
    await expect(page.getByTestId("connection-card-demo-mysql")).toBeVisible();
    const onboardingBtn = page.getByTestId("start-onboarding-assistant-btn");
    await expect(onboardingBtn).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 4. E2E-CON-03：受控 YAML 上传 Drawer 打开（不实际落盘）
  test("@pr-smoke E2E-CON-03 上传 Drawer 打开", async ({ page }) => {
    await page.goto("/connections");
    await page.getByTestId("add-schema-demo-mysql").click();
    const drawer = page.getByTestId("add-schema-drawer");
    await expect(drawer).toBeVisible();
    const select = drawer.getByTestId("add-schema-select");
    const input = drawer.getByTestId("add-schema-input");
    await expect.poll(async () => {
      if (await input.isVisible()) return "input";
      if ((await select.count()) > 0 && (await select.isEnabled())) return "select";
      return "loading";
    }).not.toBe("loading");
    if (await input.isVisible()) {
      await input.fill("smoke_schema");
    } else {
      const value = await select.locator("option:not([value=''])").first().getAttribute("value");
      expect(value).toBeTruthy();
      await select.selectOption(value!);
    }
    const previewBtn = page.getByTestId("add-schema-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 5_000 });
    await expect(previewBtn).toBeVisible();
  });

  // 5. E2E-TOK-01：全局 Token 看板与新建 Token 触发器
  test("@pr-smoke E2E-TOK-01 全局 Token 资产看板", async ({ page }) => {
    await page.goto("/admin/tokens");
    await expect(page.getByTestId("create-token-btn")).toBeVisible();
    await expect(page.getByTestId("token-kpis")).toBeVisible();
    await expect(page.getByTestId("tokens-table")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 6. E2E-AUD-01：访问日志单行弹性筛选栏与时间预设
  test("@pr-smoke E2E-AUD-01 访问日志与快捷时间预设", async ({ page }) => {
    await page.goto("/admin/audit");
    await expect(page.getByTestId("audit-view-tabs")).toBeVisible();
    await expect(page.getByTestId("audit-time-presets")).toBeVisible();
    await expect(page.getByTestId("audit-shared-filters")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 7. E2E-USG-01：监控使用概况与复合指标卡
  test("@pr-smoke E2E-USG-01 监控看板与复合指标", async ({ page }) => {
    await page.goto("/admin/usage");
    await expect(page.getByTestId("governance-usage-overview")).toBeVisible();
    await expect(page.getByTestId("governance-usage-metrics")).toBeVisible();
    await expect(page.getByTestId("governance-usage-rank-grid")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 8. Spec 175：旧部署许可地址进入系统概览，不再出现激活码表单
  test("@pr-smoke E2E-LIC-01 旧部署许可地址进入系统概览", async ({ page }) => {
    await page.goto("/admin/license");
    await expect(page).toHaveURL(/\/overview$/);
    await expect(page.getByTestId("license-activation-section")).toHaveCount(0);
    await assertNoForbiddenTerms(page);
  });

  // 9. E2E-WIKI-01：Wiki 工作台与工具栏
  test("@pr-smoke E2E-WIKI-01 Wiki 工作台布局与工具栏", async ({ page }) => {
    await page.goto("/wiki");
    await expect(page.getByTestId("wiki-layout")).toBeVisible();
    await expect(page.getByTestId("wiki-sidebar")).toBeVisible();
    await expect(page.getByTestId("wiki-new-button")).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 10. E2E-SEC-01：上传目标路径由服务端计算，客户端 targetPath 不可越权
  test("@pr-smoke E2E-SEC-01 上传目标路径不可由客户端覆盖", async ({ page }) => {
    await page.goto("/connections");
    const response = await page.request.post("/api/catalog/assets/upload", {
      data: {
        connectionId: "demo-mysql",
        schema: "dataforai",
        assetType: "schemaManifest",
        filename: "../etc/passwd.yaml",
        content: "tables:\n  superstore_orders:\n    table: dataforai.superstore_orders\n",
        targetPath: "../etc/passwd"
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    const body = await response.json() as {
      data?: { validation?: { targetPath?: string } };
      error?: { code?: string };
    };
    expect(body.error?.code).toBe("TARGET_EXISTS");
    expect(body.data?.validation?.targetPath).toBe(
      "semantic-layer/demo-mysql/_schema/dataforai.yaml"
    );
    expect(JSON.stringify(body)).not.toContain("../etc/passwd");
  });
});
