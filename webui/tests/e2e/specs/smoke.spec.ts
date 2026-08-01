// webui/tests/e2e/specs/smoke.spec.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §3 / §11.2
// 准入层级：L1 PR Smoke（每个 PR 必跑，阻塞合并）
// 浏览器：chromium
// 标签：@pr-smoke
//
// 设计原则：8 条 L1 用例覆盖低成本 PR 阻塞路径。需要完整写盘 / 发布闭环的
//   E2E-PUB-04 / E2E-WIKI-03 等放 L3 Nightly。
//
// v0.4 IA 收敛（docs/qa/changelog.md §2026-08-01）：
//   面包屑 "数据库接入" → "数据接入"；E2E-NAV-02 已对齐。
//   其余 L1 spec（PUB-02 / CON-01 / CON-03 / WIKI-01 / NAV-01 / SEC-01 / I18N-01）
//   全部通过，理由见 changelog。
//
// 跑法：npm run e2e:smoke

import { test, expect } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

test.describe("L1 PR Smoke 8 条", () => {
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

  // 2. E2E-CON-01：连接卡片术语 + Header 治理
  test("@pr-smoke E2E-CON-01 连接概览术语", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.getByTestId("page-header")).toBeVisible();
    // 真实 testid：connection-readonly-${conn.id}
    const readonlyBadge = page.getByTestId("connection-readonly-mysql-aliyun");
    await expect(readonlyBadge).toBeVisible();
    await expect(readonlyBadge).toHaveText("预期只读");
    // Header 右侧不出现跨页导航按钮
    await expect(page.getByRole("button", { name: "表白名单" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "连通测试" })).toHaveCount(0);
    await assertNoForbiddenTerms(page);
  });

  // 3. E2E-CON-03：受控 YAML 上传 Drawer 打开（不实际落盘）
  test("@pr-smoke E2E-CON-03 上传 Drawer 打开", async ({ page }) => {
    await page.goto("/connections");
    // 真实 testid：add-schema-${conn.id} 打开 AddSchemaDrawer
    await page.getByTestId("add-schema-mysql-aliyun").click();
    // 等 Drawer 真正显示
    await expect(page.getByTestId("add-schema-drawer")).toBeVisible();
    // 填入合法 schema 名（仅字母/数字/下划线，不含 -）
    await page.getByTestId("add-schema-input").fill("smoke_schema");
    // preview 按钮需要 schema 名为合法且非空
    const previewBtn = page.getByTestId("add-schema-preview-btn");
    await expect(previewBtn).toBeEnabled({ timeout: 5_000 });
    // 不实际点击以避免触发 preview network（与 L1 目标不符）
    // L1 只断言 Drawer 能打开 + 输入可达 + 关键按钮存在
    await expect(previewBtn).toBeVisible();
  });

  // 4. E2E-WIKI-01：阅读态默认
  test("@pr-smoke E2E-WIKI-01 Wiki 阅读态默认", async ({ page }) => {
    await page.goto("/wiki");
    // 真实 testid：wiki-mode-badge，data-mode="read" 表示阅读态
    const modeBadge = page.getByTestId("wiki-mode-badge");
    await expect(modeBadge).toBeVisible();
    await expect(modeBadge).toHaveAttribute("data-mode", "read");
    // 阅读态下 textarea 不可见（编辑态才有）
    // 注意：wiki-edit-textarea 在 mode=read 时被组件卸载
    await expect(page.getByTestId("wiki-edit-textarea")).toHaveCount(0);
    await expect(page.getByTestId("wiki-tree")).toBeVisible();
  });

  // 5. E2E-NAV-01：一级菜单 语义发布 + 2 个二级
  test("@pr-smoke E2E-NAV-01 语义发布导航", async ({ page }) => {
    await page.goto("/publish/workbench");
    // 侧栏 1 级菜单包含"语义发布"组（按文本定位）
    await expect(page.getByText("语义发布").first()).toBeVisible();
    // 2 个二级：发布工作台 / 发布记录
    const workbenchLink = page.getByRole("link", { name: "发布工作台" });
    await expect(workbenchLink).toBeVisible();
    // 当前页 link 应带 aria-current="page"（实现约定）
    await expect(workbenchLink).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("link", { name: "发布记录" })).toBeVisible();
    // 旧导航词不应出现
    await expect(page.getByRole("link", { name: "变更审阅" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "待发布变更" })).toHaveCount(0);
  });

  // 6. E2E-NAV-02：面包屑 `数据接入 / 连接概览`（v0.4 IA 收敛：原"数据库接入" → "数据接入"）
  test("@pr-smoke E2E-NAV-02 面包屑", async ({ page }) => {
    await page.goto("/connections");
    await expect(page.getByTestId("page-header")).toContainText("数据接入");
    await expect(page.getByTestId("page-header")).toContainText("连接概览");
  });

  // 7. E2E-SEC-01：上传目标路径由服务端计算，客户端 targetPath 不可越权
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

  // 8. E2E-I18N-01：forbidden terms 0 命中
  test("@pr-smoke E2E-I18N-01 关键页 forbidden terms 0 命中", async ({ page }) => {
    await page.goto("/connections");
    await assertNoForbiddenTerms(page);
  });
});
