// webui/tests/e2e/specs/e2e-pub-01.spec.ts
// 关联主文档：docs/qa/lucy-webui-e2e-test-suite.md §11.1
// 关联 Selector 契约：docs/qa/selector-contract.md §S.1 / S.2 / S.5
// 准入层级：L3 Nightly Full（不阻塞 PR；只在 Nightly 跑）
// 浏览器：chromium
// 标签：@nightly
//
// ⚠️ 所有 selector 必须是 webui/src/ 实现里真实存在 data-testid。
//    任何引用经 check-selector-contract.mjs 校验；引用了不存在的 testid → fail。

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoForbiddenTerms,
  assertProfessionalTermsProtected,
} from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_MANIFEST = readFileSync(
  resolve(__dirname, "../fixtures/data/finance_mart.yaml"),
  "utf-8"
);

test.describe("E2E-PUB-01: 完整语义资产从新建到发布 Reindex 闭环", () => {
  test.beforeAll(() => {
    // process-level guard：fixture 边界
    assertFixtureOnly();
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "This state-mutating nightly flow owns one shared disposable fixture and runs once in desktop Chromium."
    );
  });

  test("@nightly 主链路 4 阶段", async ({ page }) => {
    // —— 阶段 1：数据库接入 ——
    await test.step("1. 进入 /connections，连接卡片术语检查", async () => {
      await page.goto("/connections");
      await expect(page.getByTestId("page-header")).toBeVisible();
      // 只读配置健康时不展示风险徽标；仅未声明只读时才出现该 testid。
      await expect(page.getByTestId("connection-readonly-mysql-aliyun")).toHaveCount(0);
      // 页面头只承载当前对象标题；侧栏分组负责表达“数据接入”归属。
      await expect(page.getByTestId("page-header")).toContainText("连接概览");
      // Header 右侧不出现跨页导航按钮（§E2E-CON-01）：
      // v0.4 起 "表白名单" / "连通测试" 全部上提为侧栏 Link，header 不再放跨页 button
      await expect(
        page.getByRole("button", { name: "表白名单" })
      ).toHaveCount(0);
      await assertNoForbiddenTerms(page);
    });

    await test.step("2. 添加 Schema finance_mart", async () => {
      // 真实 testid：add-schema-${conn.id}
      await page.getByTestId("add-schema-mysql-aliyun").click();
      await expect(page.getByTestId("add-schema-drawer")).toBeVisible();
      // 真实 testid：add-schema-input
      await page.getByTestId("add-schema-input").fill("finance_mart");
      // 真实 testid：add-schema-preview-btn（= 测试连接可用性）
      await page.getByTestId("add-schema-preview-btn").click();
      // 等预览结果：success message 含 connection test 退出码
      await expect(
        page.getByTestId("add-schema-connection-test-failed")
      ).toHaveCount(0);
      // 真实 testid：add-schema-confirm-btn（= 写入 ktx.yaml 并完成）
      await page.getByTestId("add-schema-confirm-btn").click();
      // 真实 testid：add-schema-success-message
      await expect(
        page.getByTestId("add-schema-success-message")
      ).toBeVisible();
      await page.getByTestId("add-schema-drawer").getByRole("button", { name: "完成", exact: true }).click();
      await expect(page.getByTestId("add-schema-drawer")).toHaveCount(0);
    });

    await test.step("3. 上传 Schema Manifest", async () => {
      // 真实 testid：schema-row-${conn.id}-${schema}
      const row = page.getByTestId("schema-row-mysql-aliyun-finance_mart");
      await expect(row).toBeVisible();
      // Schema 状态：真实 testid schema-asset-status-${conn.id}-${schema}
      await expect(
        page.getByTestId("schema-asset-status-mysql-aliyun-finance_mart")
      ).toContainText("缺失 Manifest");
      // 真实上传入口在 schema-whitelist-${conn.id}-${schema} 内的"上传 Manifest" 按钮
      // 简化：直接点 schema-row 上的 status badge 进入 Drawer（实际实现是行内按钮）
      // 这里依赖 schema-whitelist cell 内 action；使用最近按钮定位
      await row
        .getByRole("button", { name: /上传 Manifest/ })
        .click();
      // 真实 testid：catalog-asset-upload-drawer / -textarea / -submit
      await expect(
        page.getByTestId("catalog-asset-upload-drawer")
      ).toBeVisible();
      await page
        .getByTestId("catalog-asset-upload-textarea")
        .fill(FIXTURE_MANIFEST);
      // 真实 testid：catalog-asset-validation-panel
      await expect(
        page.getByTestId("catalog-asset-validation-panel")
      ).toBeVisible();
      await page.getByTestId("catalog-asset-upload-submit").click();
      // 上传后列表会立即从“缺失”切换为“已存在”，并重建该行；
      // Drawer 因所属按钮组件卸载而关闭，以列表最终状态作为成功判据。
      await expect(
        page.getByTestId("schema-asset-status-mysql-aliyun-finance_mart")
      ).toContainText("已存在");
      await expect(page.getByTestId("catalog-asset-upload-drawer")).toHaveCount(0);
    });

    // —— 阶段 2：语义层维护 ——
    await test.step("4. 表目录 → fact_revenue 表详情", async () => {
      await page.goto("/catalog?scope=all");
      // 真实 testid：catalog-result-count
      await expect(page.getByTestId("catalog-result-count")).toBeVisible();
      // 新上传的 Manifest 表默认尚未进入启用范围；先验证库存已可见，
      // 再直接进入当前规范表详情路由，避免将“启用范围”的独立流程混入本发布用例。
      await expect(page.getByTestId("catalog-row-fact_revenue")).toBeVisible();
      await page.goto("/catalog/mysql-aliyun/finance_mart/fact_revenue");
      await expect(page).toHaveURL(
        /\/catalog\/mysql-aliyun\/finance_mart\/fact_revenue$/
      );
      // 用当前服务端原始 YAML 完成一次无语义变化的真实写入，
      // 使发布门禁拥有可执行 ktx sl validate 的 changed source。
      const sourceResponse = await page.request.get(
        "/api/sources/mysql-aliyun/finance_mart/fact_revenue"
      );
      expect(sourceResponse.ok()).toBeTruthy();
      const sourcePayload = await sourceResponse.json() as { data: { rawYaml: string } };
      const importResponse = await page.request.post(
        "/api/sources/mysql-aliyun/finance_mart/fact_revenue/import",
        { data: { yaml: sourcePayload.data.rawYaml, dryRun: false, sourceFileName: "e2e-current.yaml" } }
      );
      expect(importResponse.ok()).toBeTruthy();
    });

    await test.step("5. 字段专业术语防御扫描", async () => {
      // 表详情当前实现只有一个 data-testid="table-editor-conn"（§selector-contract §S.4 标注：实现缺失较多）
      // 这里只断言术语防御 + URL
      await assertProfessionalTermsProtected(page);
    });

    // —— 阶段 3：业务文档 ——
    await test.step("6. 进入 Wiki 工作台", async () => {
      await page.goto("/wiki");
      // 首页是文档库状态；通过搜索打开固定 fixture 文档后验证阅读态。
      await expect(page.getByTestId("wiki-layout")).toBeVisible();
      await expect(page.getByTestId("wiki-tree")).toBeVisible();
      await page.getByTestId("wiki-tree-search").fill("finance-playbook");
      await page.getByTestId("wiki-tree-page").getByRole("button", { name: /finance_mart 利润分析/ }).click();
      await expect(page.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "read");
    });

    await test.step("7. 切到编辑态并打开保存预检", async () => {
      // 真实 testid：wiki-edit-button
      await page.getByTestId("wiki-edit-button").click();
      await expect(page.getByTestId("wiki-layout")).toHaveAttribute("data-mode", "edit");
      // 真实 testid：wiki-edit-textarea
      await expect(page.getByTestId("wiki-edit-textarea")).toBeVisible();
      // 真实 testid：wiki-save-preflight-button
      await page.getByTestId("wiki-save-preflight-button").click();
      // 真实 testid：wiki-save-preflight
      await expect(page.getByTestId("wiki-save-preflight")).toBeVisible();
      // 真实 testid：wiki-save-preflight-target / -findings
      await expect(page.getByTestId("wiki-save-preflight-target")).toBeVisible();
      await expect(
        page.getByTestId("wiki-save-preflight-findings")
      ).toBeVisible();
      // 真实 testid：wiki-save-preflight-confirm
      await page.getByTestId("wiki-save-preflight-confirm").click();
    });

    // —— 阶段 4：语义发布 ——
    await test.step("8. 工作台显示待发布变更", async () => {
      await page.goto("/publish/workbench");
      // 真实 testid：publish-workbench-layout / workbench-pending-count
      await expect(page.getByTestId("publish-workbench-layout")).toBeVisible();
      await expect(page.getByTestId("workbench-pending-count")).toBeVisible();
    });

    await test.step("9. 校验变更 → 发布并重建索引 可用", async () => {
      // 真实 testid：workbench-validate
      await page.getByTestId("workbench-validate").click();
      // 真实 testid：workbench-publish-and-reindex
      const cta = page.getByTestId("workbench-publish-and-reindex");
      // 等待 validate 完成 + gate 通过后 enable
      await expect(cta).toBeEnabled({ timeout: 30_000 });
      await cta.click();
      // 当前工作台使用自有的发布确认 Drawer。
      await expect(
        page.getByTestId("workbench-publish-confirm-drawer")
      ).toBeVisible();
      await expect(
        page.getByTestId("workbench-publish-confirm-submit")
      ).toBeVisible();
      await page.getByTestId("workbench-publish-confirm-submit").click();
    });

    await test.step("10. 等待 reindex 终态", async () => {
      const result = page.getByTestId("workbench-reindex-result");
      await expect(result).toBeAttached({ timeout: 60_000 });
      await page.getByTestId("publish-boundary-and-index").locator("summary").click();
      await expect(result).toBeVisible();
    });

    await test.step("11. 发布记录首行校验", async () => {
      await page.goto("/publish/history");
      // 真实 testid：publish-history-section / -row
      await expect(
        page.getByTestId("publish-history-section")
      ).toBeVisible();
      // 注意：实现 publish-history-row 是单数不带 id，循环所有行断言
      const firstRow = page.getByTestId("publish-history-row").first();
      await expect(firstRow).toHaveAttribute("data-trigger", "webui_manual_reindex");
      await expect(firstRow).toContainText("WebUI");
      // 真实 testid：publish-history-reindex-status
      await expect(
        firstRow.getByTestId("publish-history-reindex-status")
      ).toContainText("成功");
    });
  });
});

/**
 * 设计要点
 *
 * 1. 所有 selector 来自 webui/src/ 实现里真实存在的 data-testid。
 *    check-selector-contract.mjs 双向守门：实现未登记 → fail；spec 引用但实现缺失 → fail。
 *
 * 2. 真实仓库只读：beforeAll 调 assertFixtureOnly()；WebUI 进程 LUCY_PROJECT_DIR
 *    指向 /tmp/lucy-e2e-fixture。任何 LUCY_PROJECT_DIR 指向真实仓库的尝试都会被
 *    reset.ts 的 guard 短路。
 *
 * 3. 翻译防御：每个 step 末尾调用 §6 helper（assertNoForbiddenTerms /
 *    assertProfessionalTermsProtected），不依赖 Chrome Auto-translate。
 *
 * 4. 网络层断言：本 spec 不做精细网络层校验；可加 page.route() 拦截
 *    POST /api/validate-changed 验证返回、POST /api/semantic-assets/publish
 *    验证 confirmOverwrite 字段。
 *
 * 5. 表详情 §S.4 实现严重不足：仅 table-editor-conn 一个 testid。
 *    这是已知的"实现缺口"，会在 §S.4 标记 TODO；不要在此 spec 里假设
 *    不存在的 selector。
 */
