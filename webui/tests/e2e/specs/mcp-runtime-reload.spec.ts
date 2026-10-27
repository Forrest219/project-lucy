// webui/tests/e2e/specs/mcp-runtime-reload.spec.ts
// Spec 191 — MCP Runtime 执行层重载（浏览器契约层）
// 场景编号：E2E-MCP-01
// 准入层级：L2 PR Impacted
// 标签：@pr-impacted
//
// 范围声明（本文件只覆盖「浏览器契约层」）：
//   本文件断言的是**页面与 API 的契约**——三段事实是否分开呈现、两个动作是否被区分、
//   不可用形态下是否如实拒绝且不伪报成功。
//   成功重载路径（daemon 旧 PID 退出、新 PID 就绪、连接级验证通过）是**进程级事实**，
//   由 scripts/verify/verify-ktx-reload-lifecycle.sh --container 负责。
//   E2E fixture 跑的是 `npm run dev`（vite + tsx），不跑容器入口脚本，因而没有
//   KTX supervisor、没有重载通道能力文件 —— 所以「成功重载」在浏览器层本就不可断言。
//
// fixture 形态：E2E 以 LUCY_WEBUI_AUTH=off 运行（development 部署 ⇒ resolveAuthMode()
// 解析为 open）。open 形态没有登录会话 ⇒ /api/auth/status 的 me 为 null ⇒ 非 owner。
// 这正是「非所有者形态」，据此断言 owner-only 的重载入口不提供、只读检测仍提供。

import { test, expect, type Page } from "@playwright/test";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";
import { assertFixtureOnly } from "../fixtures/helpers/reset";

/**
 * `mode=live-smoke` 让页面直接进入「检查能不能连上」分支，状态面板才会渲染。
 * `agentId` 必填：MCP 调试台在选定 Agent 之前不渲染任务选择与状态面板。
 * `e2e-default` 是 fixture project 里的契约 Agent（access-fixture.yaml / ktx-fixture.yaml）。
 */
const PLAYGROUND_URL = "/admin/mcp-playground?agentId=e2e-default&mode=live-smoke";

/**
 * Spec 191 §5 —— 三段事实的正交性。
 * 注入一个确定的执行层状态：配置待重载、重载空闲、验证未完成。
 *
 * `missingConnections` 刻意为空：Playground 用它推导要检测的连接，空列表 ⇒
 * 面板处于「未选连接」形态（testid 后缀 `unselected`），断言不依赖环境里
 * KTX daemon 到底加载了哪些连接。
 */
const STATUS_FIXTURE = {
  ok: true,
  data: {
    config: { connectionIds: ["mysql-aliyun"] },
    catalog: { lastByConnection: {} },
    policy: { healthy: true },
    execution: {
      status: "stale",
      loadedConnectionIds: [],
      missingConnections: [],
      activation: "reload_required",
      reload: { state: "idle" },
      verification: { state: "unverified" }
    }
  }
};

async function stubRuntimeStatus(page: Page): Promise<void> {
  await page.route("**/api/admin/mcp-runtime/status", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STATUS_FIXTURE)
    });
  });
}

test.describe("Spec 191 MCP Runtime 执行层重载", () => {
  test.beforeAll(() => {
    assertFixtureOnly({ warnIfMissing: true });
  });

  test("@pr-impacted 待重载呈现为待重载，不呈现为已生效", async ({ page }) => {
    await stubRuntimeStatus(page);
    await page.goto(PLAYGROUND_URL);

    await expect(page.getByTestId("mcp-playground-page")).toBeVisible();
    const panel = page.getByTestId("mcp-runtime-status-unselected");
    await expect(panel).toBeVisible();

    // 四段事实各自成一个 chip：配置 / 目录 / 策略运行时 / MCP 执行层。
    const chips = page.getByTestId("mcp-runtime-status-chips");
    await expect(chips).toBeVisible();
    await expect(chips.locator("> span")).toHaveCount(4);
    await expect(chips).toContainText("Config");
    await expect(chips).toContainText("Catalog");
    await expect(chips).toContainText("Policy Runtime");
    await expect(chips).toContainText("MCP Execution");

    // 未选连接时，配置与目录两段事实是「—」，不得伪造为「已读取」或「已同步」。
    await expect(chips).toContainText("—");

    // 「待重载」是**配置状态**，提示文案必须说「尚未加载」，不得说「已生效」。
    const remediation = page.getByTestId("mcp-runtime-remediation");
    await expect(remediation).toBeVisible();
    await expect(remediation).toContainText("配置已写入，执行层尚未加载。");
    await expect(remediation).not.toContainText("已生效");
    // Spec 191：生效方式改为「重载执行层」，不再提示人工重启。
    await expect(remediation).not.toContainText("重启");

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted 「重新检测执行层」与「重载执行层」是两个不同动作", async ({ page }) => {
    await stubRuntimeStatus(page);
    await page.goto(PLAYGROUND_URL);

    // 只读检测：任何形态下都提供。
    const recheck = page.getByTestId("mcp-runtime-recheck-unselected");
    await expect(recheck).toBeVisible();
    await expect(recheck).toHaveText("重新检测执行层");

    // 执行层重载是 owner 确认的动作。非 owner 形态下不提供这个入口，
    // 并且不得用只读的「重新检测执行层」顶替它。
    await expect(page.locator("[data-testid^='mcp-runtime-reload-']")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重载执行层" })).toHaveCount(0);

    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted 状态端点把激活、重载、验证三段事实分开返回", async ({ request }) => {
    const response = await request.get("/api/admin/mcp-runtime/status");
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    const execution = body?.data?.execution ?? {};

    // 三段事实各自独立存在。
    expect(execution).toHaveProperty("activation");
    expect(execution).toHaveProperty("reload");
    expect(execution).toHaveProperty("verification");

    // 各自的取值落在自己的枚举里 —— 证明它们不是同一个字段的三种别名。
    expect(["current", "reload_required", "unknown"]).toContain(execution.activation);
    expect(["idle", "running", "succeeded", "failed"]).toContain(execution.reload?.state);
    expect(["unverified", "verifying", "verified", "failed"]).toContain(
      execution.verification?.state
    );

    // 不得出现一个把三段合并成「成功」的标志位。
    expect(execution).not.toHaveProperty("ok");
    expect(execution).not.toHaveProperty("success");
  });

  test("@pr-impacted 非所有者形态下重载执行层被明确拒绝且不伪报成功", async ({ request }) => {
    const response = await request.post("/api/admin/mcp-runtime/reload", { data: {} });

    // open 形态 ⇒ resolveAuthMode() !== "required" ⇒ 400 AUTH_NOT_CONFIGURED。
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body?.ok).toBe(false);
    expect(body?.error?.code).toBe("AUTH_NOT_CONFIGURED");

    // 拒绝路径不得带回任何「重载成功」的负载。
    expect(body?.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("succeeded");
  });
});
