// 行级策略删除确认（L25-14）与 Wiki 访问管理（Spec 193）的浏览器用例。
//
// 跑在一次性夹具上（auth off，项目目录 /tmp/lucy-e2e-fixture），不指向 demo 或客户实例。
// 只在桌面 Chromium 跑一次。Wiki 用例读写真实夹具，且不提交授权、不保存草稿。
// 夹具没有可编译的数据目录，带行级策略的 Role 无法真正落盘；删除确认用例因此
// 只替身 Role 读取、预览和删除的响应形状，断言仍是页面上的取消与确认。
//
// 跑法（在 webui/ 下，先准备夹具并让开发服务监听 :5173）：
//   npm run e2e:fixture
//   npx playwright test --project=chromium tests/e2e/specs/p0-row-policy-delete-and-wiki-access.spec.ts
//
// 标签：@pr-impacted

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { assertFixtureOnly } from "../fixtures/helpers/reset";
import { assertNoForbiddenTerms } from "../fixtures/helpers/terminology";

test.describe.configure({ mode: "serial" });

const SCOPED_ROLE_ID = "e2e_row_scoped";

type JsonObject = Record<string, unknown>;

function scopedRoleDetail() {
  return {
    id: SCOPED_ROLE_ID,
    version: "role-version-1",
    description: "E2E 行级策略删除确认",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["superstore_orders"],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    role: {
      description: "E2E 行级策略删除确认",
      permission_model_version: 2,
      allow: {
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        tableSelectors: [{
          connection: "mysql-aliyun",
          schema: "dataforai",
          names: ["superstore_orders"],
          row_access: "scoped",
          row_policy: { predicates: [{ field: "order_id", op: "eq", value: "E2E-1" }] }
        }]
      }
    },
    skillAccess: {
      discoverEnabled: false,
      readEnabled: false,
      declared: [],
      discoverable: [],
      readable: [],
      declaredWithoutChannel: []
    }
  };
}

async function installScopedRoleApi(page: Page): Promise<void> {
  let deleted = false;
  const confirmation = {
    vocabularyVersion: 1,
    baseAccessVersion: "fixture-access",
    candidateDigest: "e2e-row-delete"
  };
  await page.route("**/api/admin/roles/preview-row-policy", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        data: {
          ok: true,
          candidateDigest: confirmation.candidateDigest,
          basePolicyVersion: "fixture-policy",
          confirmation,
          tables: []
        }
      }
    });
  });
  await page.route(`**/api/admin/roles/${SCOPED_ROLE_ID}`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== `/api/admin/roles/${SCOPED_ROLE_ID}`) {
      await route.continue();
      return;
    }
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill(deleted
        ? { status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: "Role 不存在" } } }
        : { json: { ok: true, data: scopedRoleDetail() } });
      return;
    }
    if (method === "DELETE") {
      const body = route.request().postDataJSON() as { dryRun?: boolean; rowPolicyConfirmation?: unknown } | null;
      if (body?.dryRun === true) {
        await route.fulfill({
          json: { ok: true, data: { diff: "- e2e_row_scoped", proposedYaml: "roles: {}\n", version: "role-version-1" } }
        });
        return;
      }
      if (!body?.rowPolicyConfirmation) {
        await route.fulfill({
          status: 409,
          json: {
            ok: false,
            error: { code: "ROW_POLICY_PREVIEW_REQUIRED", message: "最终行约束预览确认缺失或已失效" }
          }
        });
        return;
      }
      deleted = true;
      await route.fulfill({
        json: { ok: true, data: { written: true, runtimeAck: true, status: "committed" } }
      });
      return;
    }
    await route.continue();
  });
}

async function readJson(response: { ok: () => boolean; status: () => number; text: () => Promise<string> }, label: string): Promise<JsonObject> {
  const text = await response.text();
  expect(response.ok(), `${label} HTTP ${response.status()} ${text}`).toBeTruthy();
  return text ? (JSON.parse(text) as JsonObject) : {};
}

function dataOf(body: JsonObject): JsonObject {
  return (body.data as JsonObject | undefined) ?? {};
}

async function wikiKeys(request: APIRequestContext): Promise<string[]> {
  const body = dataOf(await readJson(await request.get("/api/wiki"), "wiki list"));
  const pages = (body.pages as Array<{ key?: string }> | undefined) ?? [];
  return pages.map((page) => page.key ?? "").filter(Boolean).sort();
}

async function openGlobalDirectory(page: Page): Promise<void> {
  await page.goto("/wiki");
  await expect(page.getByTestId("wiki-layout")).toBeVisible();
  await page.getByRole("button", { name: /global \d+ 篇，选择目录/ }).click();
  await expect(page.getByTestId("wiki-library-home")).toHaveAttribute("data-directory", "global");
  await expect(page.getByTestId("wiki-library-summary")).toContainText("篇");
}

test.describe("P0 行级策略与 Wiki 访问", () => {
  test.beforeAll(() => {
    assertFixtureOnly();
  });

  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "These cases own one disposable fixture and run once in desktop Chromium."
    );
  });

  test("@pr-impacted Wiki 目录列出每篇文档的授权，批量抽屉关闭前不写入", async ({ page, request }) => {
    const before = await wikiKeys(request);
    expect(before.length).toBeGreaterThan(0);
    const writes: string[] = [];
    page.on("request", (req) => {
      const path = new URL(req.url()).pathname;
      if (req.method() !== "GET" && path.startsWith("/api/wiki")) {
        writes.push(`${req.method()} ${path}`);
      }
    });

    await openGlobalDirectory(page);
    const documents = page.getByTestId("wiki-library-document");
    await expect(documents.first()).toBeVisible();
    const count = await documents.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(documents.nth(index)).toContainText("无人可见");
    }
    await page.getByRole("button", { name: "无人可见" }).click();
    await expect(documents).toHaveCount(count);

    await page.getByTestId("wiki-library-batch-start").click();
    const continueButton = page.getByTestId("wiki-library-batch-continue");
    await expect(continueButton).toBeDisabled();
    await expect(page.getByTestId("wiki-library-home")).toContainText("请先选择至少一篇文档。");

    await documents.first().getByRole("checkbox").check();
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    const drawer = page.getByTestId("wiki-batch-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("只影响本次显式选中的 1 篇文档");
    await expect(page.getByTestId("wiki-batch-preview")).toBeDisabled();
    await expect(page.getByTestId("wiki-batch-submit")).toBeDisabled();
    await drawer.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(drawer).toBeHidden();

    expect(writes).toEqual([]);
    expect(await wikiKeys(request)).toEqual(before);
    await assertNoForbiddenTerms(page);
  });

  test("@pr-impacted 未保存的 Wiki 正文草稿不能管理访问权限", async ({ page, request }) => {
    const before = await wikiKeys(request);
    const fileName = `e2e-access-draft-${Date.now().toString(36)}.md`;

    await openGlobalDirectory(page);
    await page.getByTestId("wiki-new-button").click();
    const dialog = page.getByTestId("wiki-new-document-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("wiki-new-directory-input").fill("global");
    await dialog.getByTestId("wiki-new-file-input").fill(fileName);
    await dialog.getByTestId("wiki-new-confirm").click();

    // 新 key 会把界面拉回阅读态；从空白草稿开始会把正文标成未保存。
    await page.getByTestId("wiki-read-empty-blank").click();
    await expect(page.getByTestId("wiki-edit-textarea")).toBeVisible();
    await expect(page.getByTestId("wiki-status-pill")).toHaveAttribute("data-status", "dirty");
    await expect(page.getByTestId("wiki-status-pill")).toHaveText("有未保存修改");
    await expect(page.getByTestId("wiki-manage-access-button")).toBeDisabled();
    await expect(page.getByTestId("wiki-manage-access-blocked")).toHaveText("请先保存或放弃正文草稿");

    page.once("dialog", (popup) => popup.accept());
    await page.getByTestId("wiki-back-to-read").click();
    await expect(page.getByTestId("wiki-manage-access-blocked")).toHaveCount(0);
    expect(await wikiKeys(request)).toEqual(before);
    expect(before.some((key) => key.endsWith(fileName))).toBe(false);
  });

  test("@pr-impacted 带行级策略的 Role：取消删除不落盘，确认删除才移除", async ({ page }) => {
    await installScopedRoleApi(page);
    const deletes: Array<{ dryRun?: boolean; rowPolicyConfirmation?: unknown }> = [];
    const previews: Array<{
      removeRole?: boolean;
      roleId?: string;
      tables?: Array<{ connection?: string; schema?: string; name?: string }>;
    }> = [];
    page.on("request", (req) => {
      const path = new URL(req.url()).pathname;
      if (req.method() === "DELETE" && path === `/api/admin/roles/${SCOPED_ROLE_ID}`) {
        deletes.push((req.postDataJSON() as { dryRun?: boolean; rowPolicyConfirmation?: unknown } | null) ?? {});
      }
      if (req.method() === "POST" && path === "/api/admin/roles/preview-row-policy") {
        previews.push((req.postDataJSON() as typeof previews[number] | null) ?? {});
      }
    });

    await page.goto(`/admin/roles/${SCOPED_ROLE_ID}`);
    await expect(page.getByRole("tab", { name: /行级策略/ })).toContainText("1");
    await assertNoForbiddenTerms(page);

    await page.getByRole("button", { name: "删除 Role" }).click();
    const drawer = page.getByTestId("role-permission-review-drawer");
    await expect(drawer.getByRole("heading", { name: "确认删除 Role" })).toBeVisible();
    await expect(drawer).toContainText("删除后无法由此页面恢复");
    await drawer.getByRole("button", { name: "取消" }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/admin/roles/${SCOPED_ROLE_ID}(?:\\?.*)?$`));

    expect(deletes.every((body) => body.dryRun === true)).toBe(true);
    expect(deletes.some((body) => body.dryRun === false)).toBe(false);
    expect(previews.filter((body) => body.removeRole)).toEqual([]);

    await page.getByRole("button", { name: "删除 Role" }).click();
    await expect(drawer.getByRole("heading", { name: "确认删除 Role" })).toBeVisible();
    await drawer.getByRole("button", { name: "确认删除" }).click();
    await expect(page).toHaveURL(/\/admin\/roles\/?(?:\?.*)?$/);

    expect(previews.filter((body) => body.removeRole)).toEqual([{
      removeRole: true,
      roleId: SCOPED_ROLE_ID,
      tables: [{ connection: "mysql-aliyun", schema: "dataforai", name: "superstore_orders" }]
    }]);
    expect(deletes.some((body) => body.dryRun === false && body.rowPolicyConfirmation)).toBe(true);
  });
});
