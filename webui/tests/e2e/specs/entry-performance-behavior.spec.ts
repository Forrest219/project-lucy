// Spec 174 §9 — desktop Chromium behaviour checks (SC). Launched by
// `npm run perf:entry -- --scenario behavior` against an isolated, disposable
// fixture copy. Slow / failing responses use route mocks and never feed the
// PERF sample set.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const fixtureDir = process.env.PERF_FIXTURE_DIR ?? "";
const expected = JSON.parse(process.env.PERF_EXPECTED ?? "{}") as { connections: number; tables: number; enabledTables: number; agents: number; connectionIds: string[] };
const firstConn = () => expected.connectionIds[0]!;

test.skip(!process.env.PERF_BASE_URL || !fixtureDir, "launched by perf:entry only");
test.describe.configure({ mode: "default" });

async function connectionCards(page: Page): Promise<number> {
  return page.locator('[data-testid^="connection-card-"]').count();
}

test("SC-06/SC-07 slow sources keeps connection cards and shows unknown counts", async ({ page }) => {
  await page.route("**/api/sources", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });
  await page.goto("/connections");
  await expect(page.locator(`[data-testid="connection-card-${firstConn()}"]`)).toBeVisible({ timeout: 1500 });
  expect(await connectionCards(page)).toBe(expected.connections);
  const values = await page.locator('[data-testid="connection-metric-value"]').allTextContents();
  expect(values.map((value) => value.trim())).not.toContain(String(expected.tables));
  expect(values.map((value) => value.trim())).toContain("—");
  await expect(page.locator('[data-testid="create-connection-btn"]')).toBeEnabled();
  await expect(page.locator('[data-testid="connection-metric-value"]').filter({ hasText: String(expected.tables) })).toBeVisible({ timeout: 10_000 });
});

test("SC-07 sources failure stays local with retry, never renders 0 as fact", async ({ page }) => {
  await page.route("**/api/sources", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ ok: false, error: { code: "INTERNAL", message: "synthetic failure" } })
  }));
  await page.goto("/connections");
  await expect(page.locator(`[data-testid="connection-card-${firstConn()}"]`)).toBeVisible();
  const values = (await page.locator('[data-testid="connection-metric-value"]').allTextContents()).map((value) => value.trim());
  expect(values[2]).toBe("—");
  await page.goto("/catalog");
  await expect(page.locator('[data-testid="async-region-error"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="async-region-retry"]').first()).toBeEnabled();
  await expect(page.locator("input.pl-whitelist-search-input")).toBeVisible();
});

test("SC-06 catalog toolbar renders before rows while sources is pending", async ({ page }) => {
  await page.route("**/api/sources", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto("/catalog");
  await expect(page.locator("input.pl-whitelist-search-input")).toBeVisible({ timeout: 1000 });
  expect(await page.locator('tr[data-testid^="catalog-row-"]').count()).toBe(0);
  await expect(page.locator('tr[data-testid^="catalog-row-"]')).toHaveCount(expected.enabledTables, { timeout: 10_000 });
});

test("SC-10 every page entry probes again; SC-21 card header actions kept", async ({ page }) => {
  const logPath = path.join(fixtureDir, "stub", "ktx-stub.log");
  const countTests = () => {
    try {
      return readFileSync(logPath, "utf8").split("\n").filter((line) => line.startsWith("start test ")).length;
    } catch {
      return 0;
    }
  };
  const before = countTests();
  await page.goto("/connections");
  await expect(page.locator(`[data-testid="connection-health-${firstConn()}"]`)).not.toHaveAttribute("aria-label", /探测中/, { timeout: 15_000 });
  await expect.poll(countTests, { timeout: 15_000 }).toBeGreaterThanOrEqual(before + expected.connections);
  const afterFirst = countTests();
  await page.goto("/catalog");
  await page.goto("/connections");
  await expect.poll(countTests, { timeout: 15_000 }).toBeGreaterThanOrEqual(afterFirst + expected.connections);
  await expect(page.locator(`[data-testid="add-schema-${firstConn()}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="connection-more-${firstConn()}"]`)).toBeVisible();
});

test("SC-11 static asset negotiation, cache headers and missing assets", async ({ request, baseURL }) => {
  const html = await request.get("/");
  expect(html.status()).toBe(200);
  expect(html.headers()["cache-control"]).toMatch(/no-cache/);
  const script = (await html.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(script).toBeTruthy();
  const gz = await request.get(script!, { headers: { "Accept-Encoding": "gzip" } });
  expect(gz.status()).toBe(200);
  expect(gz.headers()["content-encoding"]).toBe("gzip");
  expect(gz.headers()["vary"]).toMatch(/Accept-Encoding/i);
  expect(gz.headers()["cache-control"]).toMatch(/immutable/);
  expect(gz.headers()["content-type"]).toMatch(/javascript/);
  const identity = await fetch(`${baseURL}${script}`, { headers: { "Accept-Encoding": "gzip;q=0, identity" } });
  expect(identity.headers.get("content-encoding")).toBeNull();
  const etag = gz.headers()["etag"];
  expect(etag).toBeTruthy();
  const notModified = await fetch(`${baseURL}${script}`, { headers: { "Accept-Encoding": "gzip", "If-None-Match": etag! } });
  expect(notModified.status).toBe(304);
  const missing = await request.get("/assets/missing-0000000.js");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"] ?? "").not.toMatch(/immutable/);
  expect(await missing.text()).not.toContain("<!doctype html>");
});

test("SC-12 lazy deep links and one-shot chunk recovery", async ({ page }) => {
  for (const route of ["/catalog", "/connections", "/overview", "/admin/agents", `/admin/agents/${"perf_admin"}`, "/help"]) {
    await page.goto(route);
    await expect(page.locator('[data-testid="sidebar-search-trigger"]')).toBeVisible();
    await expect(page.locator(".pl-page-stack, .pl-help-center, main").first()).toBeVisible();
  }
  await page.goto("/help");
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  let blocked = 0;
  await page.route(/\/assets\/(Catalog|catalog)[^/]*\.js$/, async (route) => {
    blocked += 1;
    await route.fulfill({ status: 404, body: "missing" });
  });
  await page.locator('[data-testid="nav-link-semantic-catalog"]').click();
  await expect(page.locator('[data-testid="route-chunk-retry"]')).toBeVisible({ timeout: 15_000 });
  expect(blocked).toBeGreaterThanOrEqual(1);
  expect(navigations).toBeLessThanOrEqual(2);
  await expect(page.locator('[data-testid="sidebar-search-trigger"]')).toBeVisible();
  await page.unroute(/\/assets\/(Catalog|catalog)[^/]*\.js$/);
  await page.locator('[data-testid="route-chunk-retry"]').click();
  await expect(page.locator("input.pl-whitelist-search-input")).toBeVisible({ timeout: 15_000 });
});

test("SC-05 same-page mutation and external edits are visible on the next request", async ({ page, request }) => {
  await page.goto("/catalog");
  await expect(page.locator('tr[data-testid^="catalog-row-"]')).toHaveCount(expected.enabledTables, { timeout: 15_000 });
  const project = await (await request.get("/api/project")).json();
  const conn = project.data.connections.find((item: { id: string }) => item.id === firstConn());
  const nextEnabled = conn.enabledTables.slice(1);
  const write = await request.put(`/api/connections/${firstConn()}/enabled-tables`, { data: { enabledTables: nextEnabled, dryRun: false } });
  expect(write.status()).toBe(200);
  const sources = await (await request.get("/api/sources")).json();
  expect(sources.data.tables.filter((table: { enabled: boolean }) => table.enabled)).toHaveLength(expected.enabledTables - 1);

  const manifestDir = path.join(fixtureDir, "project", "config", "semantic-layer", firstConn(), "_schema");
  const manifestPath = path.join(manifestDir, "sales.yaml");
  const original = readFileSync(manifestPath, "utf8");
  writeFileSync(manifestPath, original.replace(/descriptions:\n\s+db: Synthetic table/, (match) => match.replace("Synthetic table", "Synthetic tablX")), "utf8");
  await expect.poll(async () => {
    const body = await (await request.get("/api/sources")).json();
    return body.data.meta?.snapshotVersion ?? "none";
  }, { timeout: 5000 }).not.toBe(sources.data.meta?.snapshotVersion ?? "none");
});
