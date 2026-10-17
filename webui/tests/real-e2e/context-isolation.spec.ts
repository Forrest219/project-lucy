// SEC-14-V11 (UI edits object authorization → Agent channels follow immediately) and SEC-15-V06
// (a browser rendering hostile Markdown executes nothing). Real UI, real MCP proxy; Wiki/Skill are served by
// Lucy itself, so no KTX or database is needed for these two.

import { expect, test } from "@playwright/test";
import { assertion, covers } from "./helpers/blocked";
import { fixtureAgentTokens, fixtureCanaries, mcpCall, ownerContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

const wikiRead = (token: string, key: string) =>
  mcpCall(token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wiki_read", arguments: { path: key } } });

test.describe.configure({ mode: "serial" });

test("an ACL changed in the Wiki editor changes what Agents can read, immediately and consistently", async ({ browser }, testInfo) => {
  covers(testInfo, "SEC-14-V11");
  const tokens = fixtureAgentTokens();
  const canaries = fixtureCanaries();
  const key = "shared/glossary.md";

  const before = await wikiRead(tokens.e2e_finance, key);
  assertion(testInfo, "allow_control", before.text.includes(canaries.sharedWiki), `shared document readable before the change (HTTP ${before.status})`);

  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    await page.goto("/wiki");
    await page.getByTestId("wiki-tree-search").fill("术语表");
    await page.getByTestId("wiki-tree-page").filter({ hasText: "术语表" }).first().click();
    await page.getByTestId("wiki-edit-button").click();
    const acl = page.getByTestId("wiki-acl-field");
    await expect(acl).toBeVisible();
    await acl.getByLabel("无人可见").check();
    await page.getByTestId("wiki-save-preflight-button").click();
    await expect(page.getByTestId("wiki-save-preflight")).toBeVisible();
    await page.getByTestId("wiki-save-preflight-confirm").click();
    await expect(page.getByTestId("wiki-save-preflight")).toBeHidden({ timeout: 30_000 });
  } finally {
    await context.close();
  }

  const finance = await wikiRead(tokens.e2e_finance, key);
  const sales = await wikiRead(tokens.e2e_sales, key);
  const search = await mcpCall(tokens.e2e_finance, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wiki_search", arguments: { q: "术语表" } } });
  assertion(testInfo, "deny", !finance.text.includes(canaries.sharedWiki) && !sales.text.includes(canaries.sharedWiki), "no role can read the page after 无人可见 is saved");
  assertion(testInfo, "consistency", !search.text.includes("shared/glossary"), "the page also disappears from discovery");
  assertion(testInfo, "no_leak", !vault.contains(finance.text + sales.text + search.text), "no credential in any response");

  // Restore through the same UI so later specs see the original state.
  const restoreCtx = await ownerContext(browser);
  try {
    const page = await restoreCtx.newPage();
    await page.goto("/wiki");
    await page.getByTestId("wiki-tree-search").fill("术语表");
    await page.getByTestId("wiki-tree-page").filter({ hasText: "术语表" }).first().click();
    await page.getByTestId("wiki-edit-button").click();
    const acl = page.getByTestId("wiki-acl-field");
    await acl.getByLabel("所有角色可见").check();
    await page.getByTestId("wiki-acl-field-all-confirm").getByLabel("我确认所有角色可见").check();
    await page.getByTestId("wiki-acl-field-all-apply").click();
    await page.getByTestId("wiki-save-preflight-button").click();
    await page.getByTestId("wiki-save-preflight-confirm").click();
    await expect(page.getByTestId("wiki-save-preflight")).toBeHidden({ timeout: 30_000 });
  } finally {
    await restoreCtx.close();
  }
  const restored = await wikiRead(tokens.e2e_sales, key);
  expect(restored.text.includes(canaries.sharedWiki)).toBe(true);

  expect(finance.text.includes(canaries.sharedWiki)).toBe(false);
  expect(sales.text.includes(canaries.sharedWiki)).toBe(false);
  expect(search.text.includes("shared/glossary")).toBe(false);
});

test("hostile Markdown is shown as inert content: no script runs, no dialog opens", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-15-V06");
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const dialogs: string[] = [];
    page.on("dialog", async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    const key = "e2e-fm/browser-xss.md";
    const markdown = [
      "---", "summary: hostile markdown", "allowed_roles: [finance_reader]", "---", "# Hostile",
      "", "<script>window.__e2e_xss = 1; alert('xss')</script>", "<img src=x onerror=\"window.__e2e_xss = 2; alert('xss')\">",
      "[click](javascript:window.__e2e_xss=3)", ""
    ].join("\n");
    const commit = await page.request.post(new URL("/api/wiki/upload/commit", baseURL!).toString(), { data: { key, markdown } });
    expect(commit.status()).toBe(200);
    await page.goto("/wiki");
    await page.getByTestId("wiki-tree-search").fill("Hostile");
    await page.getByTestId("wiki-tree-page").filter({ hasText: "Hostile" }).first().click();
    await expect(page.getByTestId("wiki-read-body")).toBeVisible();
    await page.waitForTimeout(500);
    const executed = await page.evaluate(() => (window as unknown as { __e2e_xss?: number }).__e2e_xss ?? null);
    const scripts = await page.getByTestId("wiki-read-body").locator("script").count();
    const handlers = await page.getByTestId("wiki-read-body").locator("[onerror]").count();
    assertion(testInfo, "deny", executed === null && dialogs.length === 0 && scripts === 0 && handlers === 0, `executed=${executed} dialogs=${dialogs.length} script nodes=${scripts} onerror nodes=${handlers}`);
    assertion(testInfo, "no_side_effect", executed === null, "no global was set by page content");
    const text = await page.locator("body").innerText();
    assertion(testInfo, "no_leak", !vault.contains(text), "no credential rendered");
    expect(executed).toBeNull();
    expect(dialogs).toEqual([]);
  } finally {
    await context.close();
  }
});
