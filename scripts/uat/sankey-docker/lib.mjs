import { chromium } from "../../../webui/node_modules/playwright/index.mjs";
export async function openMap(port) {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await page.goto(`http://127.0.0.1:${port}/admin/access-map?window=168h&inquiryKind=all&accessGrade=all`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("g[data-node-kind]", { timeout: 30000 });
  await page.waitForTimeout(1000);
  return { browser, page };
}
