// webui/tests/e2e/specs/smoke.spec.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §3 / §11.2 & docs/qa/smoke-test-design-upgrade-spec.md
// 准入层级：L1 PR Smoke（每个 PR 必跑，阻塞合并）
// 浏览器：chromium
// 标签：@pr-smoke
//
// 设计原则：12 条 L1 用例覆盖低成本 PR 阻塞路径与核心升级功能。
// 跑法：npm run e2e:smoke

import { test, expect } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

test.describe("L1 PR Smoke 12 条 (升级对齐版)", () => {
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
    await expect(page.getByTestId("connection-card-mysql-aliyun")).toBeVisible();
    const onboardingBtn = page.getByTestId("start-onboarding-assistant-btn");
    await expect(onboardingBtn).toBeVisible();
    await assertNoForbiddenTerms(page);
  });

  // 4. E2E-CON-03：受控 YAML 上传 Drawer 打开（不实际落盘）
  test("@pr-smoke E2E-CON-03 上传 Drawer 打开", async ({ page }) => {
    await page.goto("/connections");
    await page.getByTestId("add-schema-mysql-aliyun").click();
    await expect(page.getByTestId("add-schema-drawer")).toBeVisible();
    await page.getByTestId("add-schema-input").fill("smoke_schema");
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

  // 8. E2E-LIC-01：部署许可设置与激活码区域
  test("@pr-smoke E2E-LIC-01 部署许可设置与激活码", async ({ page }) => {
    await page.goto("/admin/license");
    await expect(page.getByTestId("license-activation-section")).toBeVisible();
    await expect(page.getByTestId("license-status-card")).toBeVisible();
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

  // 10. E2E-NAV-01：一级菜单 语义发布 + 2 个二级
  test("@pr-smoke E2E-NAV-01 语义发布导航", async ({ page }) => {
    await page.goto("/publish/workbench");
    await expect(page.getByText("语义发布").first()).toBeVisible();
    const workbenchLink = page.getByRole("link", { name: "发布工作台" });
    await expect(workbenchLink).toBeVisible();
    await expect(workbenchLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "发布记录" })).toBeVisible();
    await expect(page.getByRole("link", { name: "变更审阅" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "待发布变更" })).toHaveCount(0);
  });

  // 11. E2E-NAV-02：页面标题与侧栏归属
  test("@pr-smoke E2E-NAV-02 页面标题与侧栏归属", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.getByTestId("page-header")).toContainText("连接概览");
    await expect(page.getByText("数据接入").first()).toBeVisible();
  });

  // 12. E2E-SEC-01：上传目标路径由服务端计算，客户端 targetPath 不可越权
  test("@pr-smoke E2E-SEC-01 上传目标路径不可由客户端覆盖", async ({ page }) => {
    await page.goto("/connections");
    const response = await page.request.post("/api/catalog/assets/upload", {
      data: {
        connectionId: "mysql-aliyun",
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
      "semantic-layer/mysql-aliyun/_schema/dataforai.yaml"
    );
    expect(JSON.stringify(body)).not.toContain("../etc/passwd");
  });
});
