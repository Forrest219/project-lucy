// SEC-06-V01 (Token plaintext is shown once and never again) and SEC-07-V13 (a Token revoked in the UI is dead
// everywhere while a sibling Token of the same Agent keeps working). Real UI, real MCP endpoint, no mocks.
//
// Not covered here, and therefore reported BLOCKED by the collector rather than faked: the full J-01 chain
// (UX-01-*: creating the database connection through the connection wizard, KTX sync, real client Q&A),
// UX-04-V02/V03, SEC-13-V06, UX-06-*, UX-07-*. They need a real database + KTX upstream + real clients.

import { expect, test, type Page } from "@playwright/test";
import { assertion, covers } from "./helpers/blocked";
import { fixtureCanaries, mcpCall, ownerContext, runContext } from "./helpers/run-context";
import { vault } from "./helpers/secret-capture";

test.describe.configure({ mode: "serial" });

const initialize = (token: string) =>
  mcpCall(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "1" } } });
const wikiRead = (token: string, key: string) =>
  mcpCall(token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wiki_read", arguments: { path: key } } });

async function issueToken(page: Page, agentId: string, label: string): Promise<{ token: string; snippet: string }> {
  await page.goto(`/admin/agents/${agentId}/tokens/new`);
  await page.getByLabel("Token 标签").fill(label);
  await page.getByRole("button", { name: "30 天" }).click();
  await page.getByRole("button", { name: "生成 Token" }).click();
  const plaintext = page.getByTestId("plaintext-token");
  await expect(plaintext).toBeVisible();
  const token = vault.register((await plaintext.innerText()).trim());
  const snippet = await page.getByTestId("snippet-active").innerText();
  await page.getByRole("button", { name: "我已保存，关闭" }).click();
  return { token, snippet };
}

test("Token plaintext is shown once, copyable config targets this instance, and never reappears", async ({ browser, baseURL }, testInfo) => {
  covers(testInfo, "SEC-06-V01");
  const run = runContext();
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const { token, snippet } = await issueToken(page, "e2e_finance", `ui-once-${run.runId.slice(-6)}`);

    assertion(testInfo, "allow_control", token.length >= 32 && snippet.includes(token), "plaintext shown once and embedded in the copyable client config");
    assertion(testInfo, "allow_control", snippet.includes(run.instance.mcpUrl), `copyable config targets this run's endpoint (${run.instance.mcpUrl})`);
    const works = await initialize(token);
    assertion(testInfo, "allow_control", works.status === 200, `the new Token authenticates over MCP -> ${works.status}`);

    // After closing, every UI/API surface that could echo the secret is checked.
    const surfaces: string[] = [];
    await page.goto("/admin/tokens");
    await expect(page.getByTestId("tokens-table")).toBeVisible();
    surfaces.push(await page.locator("body").innerText());
    await page.goto(`/admin/agents/e2e_finance/tokens/new`);
    surfaces.push(await page.locator("body").innerText());
    const hasPlaintextNode = await page.getByTestId("plaintext-token").count();
    const api = await page.request.get(new URL("/api/admin/tokens", baseURL!).toString());
    surfaces.push(await api.text());
    const agents = await page.request.get(new URL("/api/admin/agents", baseURL!).toString());
    surfaces.push(await agents.text());
    const browserState = await page.evaluate(() => JSON.stringify({ href: location.href, local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }));
    surfaces.push(browserState);
    const leaked = surfaces.filter((text) => vault.contains(text)).length;
    assertion(testInfo, "no_leak", hasPlaintextNode === 0 && leaked === 0, `plaintext nodes=${hasPlaintextNode}, surfaces containing the secret=${leaked}/${surfaces.length}`);
    expect(hasPlaintextNode).toBe(0);
    expect(leaked).toBe(0);
  } finally {
    await context.close();
  }
});

test("a Token revoked in the UI is rejected on every MCP channel while its sibling keeps working", async ({ browser }, testInfo) => {
  covers(testInfo, "SEC-07-V13");
  const run = runContext();
  const canaries = fixtureCanaries();
  const suffix = run.runId.slice(-6);
  const context = await ownerContext(browser);
  try {
    const page = await context.newPage();
    const revokedLabel = `ui-revoke-${suffix}`;
    const siblingLabel = `ui-sibling-${suffix}`;
    const revoked = await issueToken(page, "e2e_finance", revokedLabel);
    const sibling = await issueToken(page, "e2e_finance", siblingLabel);

    const before = await wikiRead(revoked.token, "finance/cac-definition.md");
    assertion(testInfo, "allow_control", before.text.includes(canaries.financeWiki), `before revocation the Token reads its Wiki (HTTP ${before.status})`);

    await page.goto("/admin/tokens");
    await page.getByRole("button", { name: `吊销 ${revokedLabel}` }).click();
    await page.getByRole("button", { name: "确认吊销" }).click();
    await expect(page.getByText("Token 凭据已成功吊销")).toBeVisible();

    const channels = await Promise.all([
      initialize(revoked.token),
      wikiRead(revoked.token, "finance/cac-definition.md"),
      mcpCall(revoked.token, { jsonrpc: "2.0", id: 3, method: "resources/list" }),
      mcpCall(revoked.token, { jsonrpc: "2.0", id: 4, method: "prompts/list" })
    ]);
    assertion(testInfo, "deny", channels.every((c) => c.status === 401), `revoked Token on initialize/tools/resources/prompts -> ${channels.map((c) => c.status).join("/")}`);
    assertion(testInfo, "no_leak", channels.every((c) => !c.text.includes(canaries.financeWiki) && !c.text.includes(canaries.publishedSkill) && !vault.contains(c.text)), "no content or credential in any refused response");
    const stillWorks = await wikiRead(sibling.token, "finance/cac-definition.md");
    assertion(testInfo, "allow_control", stillWorks.text.includes(canaries.financeWiki), `the sibling Token of the same Agent still reads (HTTP ${stillWorks.status})`);
    expect(channels.map((c) => c.status)).toEqual([401, 401, 401, 401]);
    expect(stillWorks.text.includes(canaries.financeWiki)).toBe(true);
  } finally {
    await context.close();
  }
});
