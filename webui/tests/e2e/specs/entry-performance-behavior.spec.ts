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
  // Count full document loads only (framenavigated also fires for SPA pushState).
  let documentLoads = 0;
  page.on("load", () => {
    documentLoads += 1;
  });
  let blocked = 0;
  await page.route(/\/assets\/(Catalog|catalog)[^/]*\.js$/, async (route) => {
    blocked += 1;
    await route.fulfill({ status: 404, body: "missing" });
  });
  await page.locator('[data-testid="nav-link-semantic-catalog"]').click();
  await expect(page.locator('[data-testid="route-chunk-retry"]')).toBeVisible({ timeout: 15_000 });
  expect(blocked).toBeGreaterThanOrEqual(1);
  expect(documentLoads).toBeLessThanOrEqual(1);
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

const CLS_INIT = `(() => {
  const state = { cls: 0, shifts: [] };
  Object.defineProperty(window, "__lucyCls", { value: state, configurable: false });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        state.cls += e.value;
        state.shifts.push({ t: e.startTime, v: e.value });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch (_) {}
})();`;

async function delayRoute(page: Page, pattern: string, ms: number, fail = false): Promise<void> {
  await page.route(pattern, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (fail) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "INTERNAL", message: "synthetic failure" } }) });
    } else {
      await route.continue();
    }
  });
}

for (const variant of [
  { name: "runtime + reload history 3 s slow", runtimeMs: 3000, reloadsMs: 3000, fail: false, sourcesMs: 0 },
  { name: "runtime + reload history fail", runtimeMs: 300, reloadsMs: 300, fail: true, sourcesMs: 0 },
  { name: "slow decorations with 3 s slow sources", runtimeMs: 3000, reloadsMs: 3000, fail: false, sourcesMs: 3000 }
]) {
  test(`R5 SC-06/10 PERF-09 ${variant.name}: cards are not held, probes start after paint, CLS ≤ 0.05`, async ({ page }) => {
    await page.addInitScript({ content: CLS_INIT });
    await delayRoute(page, "**/api/admin/mcp-runtime/status", variant.runtimeMs, variant.fail);
    await delayRoute(page, "**/api/catalog/reloads", variant.reloadsMs, variant.fail);
    if (variant.sourcesMs) await delayRoute(page, "**/api/sources", variant.sourcesMs);
    await page.goto("/connections");
    await expect(page.locator(`[data-testid="connection-card-${firstConn()}"]`)).toBeVisible({ timeout: 1500 });
    expect(await connectionCards(page)).toBe(expected.connections);
    await expect(page.locator('[data-testid="create-connection-btn"]')).toBeEnabled();
    if (variant.sourcesMs) {
      await expect(page.locator(`[data-testid^="schema-actions-pending-${firstConn()}-"]`).first()).toBeVisible();
    }
    // Observe through every decoration / sources / probe completion.
    await page.waitForTimeout(Math.max(variant.runtimeMs, variant.reloadsMs, variant.sourcesMs) + 800);
    await expect(page.locator(`[data-testid="connection-health-${firstConn()}"]`)).not.toHaveAttribute("aria-label", /探测中/, { timeout: 15_000 });
    await expect(page.locator(`[data-testid^="schema-actions-pending-${firstConn()}-"]`)).toHaveCount(0, { timeout: 5000 });
    await page.waitForTimeout(300);
    const timing = await page.evaluate(() => {
      const armed = performance.getEntriesByName("lucy-connections-probes-armed")[0]?.startTime ?? null;
      const commit = performance.getEntriesByName("lucy-connections-cards-commit")[0]?.startTime ?? null;
      const probes = performance.getEntriesByType("resource")
        .filter((e) => /\/api\/connections\/[^/]+\/(test|live-schemas)/.test(new URL(e.name).pathname))
        .map((e) => (e as PerformanceResourceTiming).startTime);
      return { armed, commit, probes, cls: (window as unknown as { __lucyCls: { cls: number } }).__lucyCls.cls };
    });
    expect(timing.commit).not.toBeNull();
    expect(timing.armed).not.toBeNull();
    expect(timing.armed!).toBeGreaterThanOrEqual(timing.commit!);
    expect(timing.probes.length).toBeGreaterThanOrEqual(expected.connections * 2);
    expect(Math.min(...timing.probes)).toBeGreaterThanOrEqual(timing.armed!);
    expect(timing.cls).toBeLessThanOrEqual(0.05);
  });
}
